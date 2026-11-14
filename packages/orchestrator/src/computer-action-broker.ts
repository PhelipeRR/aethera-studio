import { eq } from 'drizzle-orm';
import { computerActionDecisionSchema, computerActionRequestSchema, type ComputerActionDecision, type ComputerActionRequest, type ComputerActionResult } from '@neuralbridge/shared';
import { neuraActionAudits, type DatabaseHandle } from '@neuralbridge/database';

export interface ComputerActionExecutor { execute(request: ComputerActionRequest): Promise<string>; }
export interface ComputerActionBrokerOptions { now?: () => string; executor?: ComputerActionExecutor; }
export interface ComputerActionPreview { actionId: string; risk: ComputerActionRequest['risk']; status: ComputerActionResult['status']; summary: string; requiresConfirmation: boolean; expiresAt: string; }

const SAFE_APPROVAL = 'Ação aprovada pela política segura.';

function current(options: ComputerActionBrokerOptions): string { return options.now?.() ?? new Date().toISOString(); }

export class ComputerActionBroker {
  private readonly payloads = new Map<string, ComputerActionRequest['payload']>();
  constructor(private readonly handle: DatabaseHandle, private readonly options: ComputerActionBrokerOptions = {}) {}

  preview(input: ComputerActionRequest): ComputerActionPreview {
    const request = computerActionRequestSchema.parse(input);
    const expired = Date.parse(request.expiresAt) <= Date.parse(current(this.options));
    const existing = this.handle.db.select().from(neuraActionAudits).where(eq(neuraActionAudits.fingerprint, request.fingerprint)).get();
    return { actionId: request.actionId, risk: request.risk, status: existing?.status as ComputerActionResult['status'] ?? (expired ? 'expired' : request.risk === 'blocked' ? 'blocked' : request.risk === 'safe' ? 'approved' : 'requested'), summary: request.summary, requiresConfirmation: request.risk === 'confirm' && !expired, expiresAt: request.expiresAt };
  }

  request(input: ComputerActionRequest): ComputerActionResult {
    const request = computerActionRequestSchema.parse(input);
    if (request.risk === 'blocked') return this.saveResult(request, 'blocked', 'Esta ação está bloqueada pela política de segurança.');
    if (Date.parse(request.expiresAt) <= Date.parse(request.createdAt)) return this.saveResult(request, 'expired', 'A solicitação já expirou.');
    const existing = this.handle.db.select().from(neuraActionAudits).where(eq(neuraActionAudits.fingerprint, request.fingerprint)).get();
    if (existing) return { actionId: request.actionId, status: existing.status as ComputerActionResult['status'], message: 'Ação já registrada para este fingerprint.' };
    if (request.payload) this.payloads.set(request.actionId, request.payload);
    this.handle.db.insert(neuraActionAudits).values({ id: request.actionId, sessionId: request.sessionId, actionType: request.actionType, risk: request.risk, status: request.risk === 'safe' ? 'approved' : 'requested', fingerprint: request.fingerprint, summary: request.summary, createdAt: request.createdAt, expiresAt: request.expiresAt, decidedAt: request.risk === 'safe' ? request.createdAt : null, completedAt: null }).run();
    return { actionId: request.actionId, status: request.risk === 'safe' ? 'approved' : 'requested', message: request.risk === 'safe' ? SAFE_APPROVAL : 'Aguardando confirmação humana.' };
  }

  /** Requests an action and, when policy already approved it, runs it. A confirm action stops here until `decide`. */
  async run(input: ComputerActionRequest): Promise<ComputerActionResult> {
    const result = this.request(input);
    if (result.status !== 'approved' || result.message !== SAFE_APPROVAL) return result;
    return this.perform(computerActionRequestSchema.parse(input));
  }

  async decide(input: ComputerActionDecision): Promise<ComputerActionResult> {
    const decision = computerActionDecisionSchema.parse(input);
    const row = this.handle.db.select().from(neuraActionAudits).where(eq(neuraActionAudits.id, decision.actionId)).get();
    if (!row) throw new Error(`computer_action_not_found: ${decision.actionId}`);
    if (row.status !== 'requested') return { actionId: row.id, status: row.status as ComputerActionResult['status'], message: 'Ação não está aguardando decisão.' };
    if (Date.parse(current(this.options)) >= Date.parse(row.expiresAt)) { this.handle.db.update(neuraActionAudits).set({ status: 'expired', decidedAt: decision.decidedAt }).where(eq(neuraActionAudits.id, row.id)).run(); return { actionId: row.id, status: 'expired', message: 'A solicitação expirou antes da aprovação.' }; }
    const status = decision.decision === 'allow' ? 'approved' : decision.decision === 'deny' ? 'denied' : 'cancelled';
    this.handle.db.update(neuraActionAudits).set({ status, decidedAt: decision.decidedAt }).where(eq(neuraActionAudits.id, row.id)).run();
    if (status !== 'approved') return { actionId: row.id, status, message: `Ação ${status === 'denied' ? 'negada' : 'cancelada'}.` };
    const payload = this.payloads.get(row.id);
    return this.perform({ actionId: row.id, sessionId: row.sessionId, actionType: row.actionType, risk: row.risk as ComputerActionRequest['risk'], summary: row.summary, fingerprint: row.fingerprint, createdAt: row.createdAt, expiresAt: row.expiresAt, ...(payload ? { payload } : {}) });
  }

  private async perform(request: ComputerActionRequest): Promise<ComputerActionResult> {
    if (!this.options.executor) return { actionId: request.actionId, status: 'approved', message: 'Ação aprovada; executor não configurado.' };
    try {
      const message = await this.options.executor.execute(request);
      this.handle.db.update(neuraActionAudits).set({ status: 'completed', completedAt: current(this.options) }).where(eq(neuraActionAudits.id, request.actionId)).run();
      this.payloads.delete(request.actionId);
      return { actionId: request.actionId, status: 'completed', message };
    } catch (error) {
      this.handle.db.update(neuraActionAudits).set({ status: 'failed', completedAt: current(this.options) }).where(eq(neuraActionAudits.id, request.actionId)).run();
      this.payloads.delete(request.actionId);
      return { actionId: request.actionId, status: 'failed', message: error instanceof Error ? error.message : 'Falha ao executar ação.' };
    }
  }

  cancel(actionId: string): ComputerActionResult { const row = this.handle.db.select().from(neuraActionAudits).where(eq(neuraActionAudits.id, actionId)).get(); if (!row) throw new Error(`computer_action_not_found: ${actionId}`); if (row.status === 'requested') this.handle.db.update(neuraActionAudits).set({ status: 'cancelled', decidedAt: current(this.options) }).where(eq(neuraActionAudits.id, actionId)).run(); return { actionId, status: 'cancelled', message: 'Ação cancelada.' }; }
  private saveResult(request: ComputerActionRequest, status: ComputerActionResult['status'], message: string): ComputerActionResult { this.handle.db.insert(neuraActionAudits).values({ id: request.actionId, sessionId: request.sessionId, actionType: request.actionType, risk: request.risk, status, fingerprint: request.fingerprint, summary: request.summary, createdAt: request.createdAt, expiresAt: request.expiresAt, decidedAt: current(this.options), completedAt: null }).run(); return { actionId: request.actionId, status, message }; }
}
