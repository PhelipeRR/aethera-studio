import { PersonalAutomationScheduler, type PersonalAutomationAction, type PersonalAutomationRule } from './personal-automation.js';

export interface PersonalAutomationRuntimePort { list(): PersonalAutomationRule[]; saveNextRun(id: string, nextRunAt: number): void; hasRun(idempotencyKey: string): boolean; saveRun(idempotencyKey: string, state: 'running' | 'awaiting_approval' | 'completed' | 'failed', error?: string): void; execute(id: string, action?: PersonalAutomationAction): Promise<unknown>; }
export interface PersonalAutomationRunResult { id: string; state: 'completed' | 'awaiting_approval' | 'failed'; error?: string; actionId?: string; }

export class PersonalAutomationRuntime {
  constructor(private readonly port: PersonalAutomationRuntimePort) {}
  async tick(now: number): Promise<PersonalAutomationRunResult[]> {
    const scheduler = new PersonalAutomationScheduler();
    for (const rule of this.port.list()) scheduler.add(rule);
    const results: PersonalAutomationRunResult[] = [];
    for (const due of scheduler.due(now)) {
      if (this.port.hasRun(due.idempotencyKey)) continue;
      this.port.saveRun(due.idempotencyKey, 'running');
      const rule = this.port.list().find((candidate) => candidate.id === due.id);
      if (rule) this.port.saveNextRun(rule.id, rule.nextRunAt + rule.intervalMs);
      try { const execution = await this.port.execute(due.id, rule?.action) as { status?: string; actionId?: string } | undefined; if (execution?.status === 'requested') { this.port.saveRun(due.idempotencyKey, 'awaiting_approval', execution.actionId); results.push({ id: due.id, state: 'awaiting_approval', ...(execution.actionId ? { actionId: execution.actionId } : {}) }); } else { this.port.saveRun(due.idempotencyKey, 'completed'); results.push({ id: due.id, state: 'completed' }); } }
      catch (error) { const message = error instanceof Error ? error.message : String(error); this.port.saveRun(due.idempotencyKey, 'failed', message); results.push({ id: due.id, state: 'failed', error: message }); }
    }
    return results;
  }
}
