/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, expect, it } from 'vitest';
import { PersonalAutomationRuntime } from '../src/personal-automation-runtime.js';

describe('PersonalAutomationRuntime', () => {
  it('persists and executes due rules idempotently', async () => {
    const rules = [{ id: 'a1', intervalMs: 1000, nextRunAt: 0, state: 'active' as const }];
    const runs: string[] = [];
    const runtime = new PersonalAutomationRuntime({
      list: () => rules,
      saveNextRun: (id, nextRunAt) => { rules.find((rule) => rule.id === id)!.nextRunAt = nextRunAt; },
      hasRun: (key) => runs.includes(key),
      saveRun: (key, state) => { runs.push(`${key}:${state}`); },
      execute: async (_id, action) => { expect(action).toBeUndefined(); return 'done'; },
    });
    await expect(runtime.tick(0)).resolves.toEqual([{ id: 'a1', state: 'completed' }]);
    await expect(runtime.tick(0)).resolves.toEqual([]);
    expect(rules[0]?.nextRunAt).toBe(1000);
  });

  it('keeps a mutating action awaiting human approval', async () => {
    const states: string[] = []; const runtime = new PersonalAutomationRuntime({ list: () => [{ id: 'a1', intervalMs: 1000, nextRunAt: 0, state: 'active', action: { kind: 'mail.send', accountId: 'a', to: ['x@y.test'], subject: 'x', body: 'y' } }], saveNextRun: () => undefined, hasRun: () => false, saveRun: (_key, state, error) => { states.push(`${state}:${error ?? ''}`); }, execute: async () => ({ status: 'requested', actionId: 'action-1' }) });
    await expect(runtime.tick(0)).resolves.toEqual([{ id: 'a1', state: 'awaiting_approval', actionId: 'action-1' }]);
    expect(states).toEqual(['running:', 'awaiting_approval:action-1']);
  });
});
