import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { neuraActionAudits, neuraSessions, neuraSuggestions, type DatabaseHandle } from '@neuralbridge/database';

export type NeuraSessionKind = 'voice' | 'meeting' | 'general';
export type NeuraSessionStatus = 'idle' | 'listening' | 'processing' | 'paused' | 'completed' | 'failed';
export type NeuraSuggestionStatus = 'pending' | 'accepted' | 'edited' | 'copied' | 'spoken' | 'dismissed' | 'expired';
export type NeuraActionRisk = 'safe' | 'confirm' | 'blocked';
export type NeuraActionStatus = 'requested' | 'approved' | 'denied' | 'expired' | 'cancelled' | 'completed' | 'failed' | 'blocked';

export interface NeuraSessionInput { id?: string; kind: NeuraSessionKind; status: NeuraSessionStatus; consent: boolean; meetingLanguage?: string | null; userPreferredLanguage?: string | null; startedAt?: string; updatedAt?: string; }
export interface NeuraSession extends Omit<NeuraSessionInput, 'id' | 'startedAt' | 'updatedAt'> { id: string; startedAt: string; updatedAt: string; endedAt: string | null; }
export interface NeuraSuggestionInput { id?: string; sessionId: string; text: string; language: string; sourceExcerpt?: string | null; decision?: unknown; confidence: number; status?: NeuraSuggestionStatus; createdAt?: string; }
export interface NeuraSuggestion extends Required<Omit<NeuraSuggestionInput, 'id' | 'createdAt'>> { id: string; createdAt: string; resolvedAt: string | null; }
export interface NeuraActionInput { id?: string; sessionId?: string | null; actionType: string; risk: NeuraActionRisk; status: NeuraActionStatus; fingerprint: string; summary: string; createdAt?: string; expiresAt?: string; }
export interface NeuraActionAudit extends Required<Omit<NeuraActionInput, 'id' | 'createdAt'>> { id: string; createdAt: string; decidedAt: string | null; completedAt: string | null; }

const MAX_TEXT = 20_000;
function nonEmpty(value: string, field: string, max = MAX_TEXT): string { const trimmed = value.trim(); if (!trimmed || trimmed.length > max) throw new Error(`invalid: ${field}`); return trimmed; }
function confidence(value: number): number { if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('invalid: confidence'); return value; }
function now(): string { return new Date().toISOString(); }

export class NeuraRegistry {
  constructor(private readonly handle: DatabaseHandle) {}

  startSession(input: NeuraSessionInput): NeuraSession {
    const id = input.id ?? randomUUID();
    const startedAt = input.startedAt ?? now();
    const updatedAt = input.updatedAt ?? startedAt;
    const kind = input.kind;
    const status = input.status;
    const existing = this.handle.db.select().from(neuraSessions).where(eq(neuraSessions.id, id)).get();
    if (existing) {
      if (existing.kind !== kind) throw new Error(`neura_session_conflict: ${id}`);
      this.handle.db.update(neuraSessions).set({ status, consent: input.consent, meetingLanguage: input.meetingLanguage ?? null, userPreferredLanguage: input.userPreferredLanguage ?? null, updatedAt }).where(eq(neuraSessions.id, id)).run();
    } else {
      this.handle.db.insert(neuraSessions).values({ id, kind, status, consent: input.consent, meetingLanguage: input.meetingLanguage ?? null, userPreferredLanguage: input.userPreferredLanguage ?? null, startedAt, updatedAt, endedAt: null }).run();
    }
    return this.session(id);
  }

  setConsent(id: string, consent: boolean, updatedAt = now()): NeuraSession {
    this.requireSession(id);
    this.handle.db.update(neuraSessions).set({ consent, updatedAt }).where(eq(neuraSessions.id, id)).run();
    return this.session(id);
  }

  updateStatus(id: string, status: NeuraSessionStatus, updatedAt = now()): NeuraSession {
    this.requireSession(id);
    this.handle.db.update(neuraSessions).set({ status, updatedAt, endedAt: ['completed', 'failed'].includes(status) ? updatedAt : null }).where(eq(neuraSessions.id, id)).run();
    return this.session(id);
  }

  recordSuggestion(input: NeuraSuggestionInput): NeuraSuggestion {
    this.requireSession(input.sessionId);
    const id = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? now();
    this.handle.db.insert(neuraSuggestions).values({ id, sessionId: input.sessionId, text: nonEmpty(input.text, 'suggestion.text'), language: nonEmpty(input.language, 'suggestion.language', 32), sourceExcerpt: input.sourceExcerpt?.trim() || null, decision: input.decision === undefined ? null : JSON.stringify(input.decision), confidence: confidence(input.confidence), status: input.status ?? 'pending', createdAt, resolvedAt: null }).run();
    return this.suggestion(id);
  }

  resolveSuggestion(id: string, status: Exclude<NeuraSuggestionStatus, 'pending' | 'expired'>, resolvedAt = now()): NeuraSuggestion {
    const current = this.handle.db.select().from(neuraSuggestions).where(eq(neuraSuggestions.id, id)).get();
    if (!current) throw new Error(`neura_suggestion_not_found: ${id}`);
    this.handle.db.update(neuraSuggestions).set({ status, resolvedAt }).where(eq(neuraSuggestions.id, id)).run();
    return this.suggestion(id);
  }

  /** Derived meeting text is the user's to erase; the action audit is kept on purpose. */
  deleteSuggestions(): number { return this.handle.db.delete(neuraSuggestions).run().changes; }

  recordAction(input: NeuraActionInput): NeuraActionAudit {
    if (input.sessionId) this.requireSession(input.sessionId);
    const id = input.id ?? randomUUID();
    const createdAt = input.createdAt ?? now();
    try {
      this.handle.db.insert(neuraActionAudits).values({ id, sessionId: input.sessionId ?? null, actionType: nonEmpty(input.actionType, 'actionType', 200), risk: input.risk, status: input.status, fingerprint: nonEmpty(input.fingerprint, 'fingerprint', 128), summary: nonEmpty(input.summary, 'summary'), createdAt, expiresAt: input.expiresAt ?? '9999-12-31T23:59:59.999Z', decidedAt: null, completedAt: null }).run();
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error(`neura_action_duplicate: ${input.fingerprint}`, { cause: error });
      throw error;
    }
    return this.action(id);
  }

  listSuggestions(sessionId: string, limit = 50): NeuraSuggestion[] {
    const bounded = Math.max(1, Math.min(limit, 100));
    return this.handle.db.select().from(neuraSuggestions).where(eq(neuraSuggestions.sessionId, sessionId)).orderBy(desc(neuraSuggestions.createdAt)).limit(bounded).all().map((row) => this.toSuggestion(row));
  }

  session(id: string): NeuraSession { const row = this.requireSession(id); return { id: row.id, kind: row.kind as NeuraSessionKind, status: row.status as NeuraSessionStatus, consent: Boolean(row.consent), meetingLanguage: row.meetingLanguage, userPreferredLanguage: row.userPreferredLanguage, startedAt: row.startedAt, updatedAt: row.updatedAt, endedAt: row.endedAt }; }
  private suggestion(id: string): NeuraSuggestion { const row = this.handle.db.select().from(neuraSuggestions).where(eq(neuraSuggestions.id, id)).get(); if (!row) throw new Error(`neura_suggestion_not_found: ${id}`); return this.toSuggestion(row); }
  private action(id: string): NeuraActionAudit { const row = this.handle.db.select().from(neuraActionAudits).where(eq(neuraActionAudits.id, id)).get(); if (!row) throw new Error(`neura_action_not_found: ${id}`); return this.toAction(row); }
  private requireSession(id: string): typeof neuraSessions.$inferSelect { const row = this.handle.db.select().from(neuraSessions).where(eq(neuraSessions.id, id)).get(); if (!row) throw new Error(`neura_session_not_found: ${id}`); return row; }
  private toSuggestion(row: typeof neuraSuggestions.$inferSelect): NeuraSuggestion { let decision: unknown; try { decision = row.decision ? JSON.parse(row.decision) : null; } catch { decision = null; } return { id: row.id, sessionId: row.sessionId, text: row.text, language: row.language, sourceExcerpt: row.sourceExcerpt, decision, confidence: row.confidence, status: row.status as NeuraSuggestionStatus, createdAt: row.createdAt, resolvedAt: row.resolvedAt }; }
  private toAction(row: typeof neuraActionAudits.$inferSelect): NeuraActionAudit { return { id: row.id, sessionId: row.sessionId, actionType: row.actionType, risk: row.risk as NeuraActionRisk, status: row.status as NeuraActionStatus, fingerprint: row.fingerprint, summary: row.summary, createdAt: row.createdAt, expiresAt: row.expiresAt, decidedAt: row.decidedAt, completedAt: row.completedAt }; }
}
