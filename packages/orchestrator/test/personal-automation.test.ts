import { describe, expect, it } from 'vitest';
import { PersonalAutomationScheduler } from '../src/personal-automation.js';

describe('PersonalAutomationScheduler', () => {
  it('fires due interval rules once and advances their next run', () => {
    const scheduler = new PersonalAutomationScheduler();
    scheduler.add({ id: 'a1', intervalMs: 60_000, nextRunAt: 1000, state: 'active' });
    expect(scheduler.due(1000)).toEqual([{ id: 'a1', idempotencyKey: 'a1:1000' }]);
    expect(scheduler.due(1000)).toEqual([]);
    expect(scheduler.due(61_000)).toEqual([{ id: 'a1', idempotencyKey: 'a1:61000' }]);
  });

  it('does not run paused rules and deduplicates a repeated event', () => {
    const scheduler = new PersonalAutomationScheduler();
    scheduler.add({ id: 'a1', intervalMs: 1000, nextRunAt: 0, state: 'paused' });
    scheduler.addEvent('a1', 'evt-1');
    expect(scheduler.addEvent('a1', 'evt-1')).toBe(false);
    expect(scheduler.due(10_000)).toEqual([]);
  });
});
