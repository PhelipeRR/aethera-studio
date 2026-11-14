export type PersonalAutomationAction = { kind: 'notify'; title: string } | { kind: 'mail.send'; accountId: string; to: string[]; subject: string; body: string } | { kind: 'calendar.create'; accountId: string; summary: string; start: string; end: string };
export interface PersonalAutomationRule { id: string; intervalMs: number; nextRunAt: number; state: 'active' | 'paused'; action?: PersonalAutomationAction; }
export interface DueAutomation { id: string; idempotencyKey: string; }

/** Pure clock-driven scheduler; persistence and execution stay with its caller. */
export class PersonalAutomationScheduler {
  private readonly rules = new Map<string, PersonalAutomationRule>();
  private readonly events = new Set<string>();
  add(rule: PersonalAutomationRule): void { this.rules.set(rule.id, { ...rule }); }
  pause(id: string): void { const rule = this.rules.get(id); if (rule) rule.state = 'paused'; }
  resume(id: string, nextRunAt: number): void { const rule = this.rules.get(id); if (rule) { rule.state = 'active'; rule.nextRunAt = nextRunAt; } }
  addEvent(automationId: string, eventKey: string): boolean { const key = `${automationId}:${eventKey}`; if (this.events.has(key)) return false; this.events.add(key); return true; }
  due(now: number): DueAutomation[] {
    const due: DueAutomation[] = [];
    for (const rule of this.rules.values()) {
      if (rule.state !== 'active' || rule.nextRunAt > now) continue;
      const runAt = rule.nextRunAt;
      rule.nextRunAt = runAt + rule.intervalMs;
      due.push({ id: rule.id, idempotencyKey: `${rule.id}:${runAt}` });
    }
    return due;
  }
}
