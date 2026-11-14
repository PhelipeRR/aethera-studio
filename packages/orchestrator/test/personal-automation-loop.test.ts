import { describe, expect, it, vi } from 'vitest';
import { PersonalAutomationLoop } from '../src/personal-automation-loop.js';

describe('PersonalAutomationLoop', () => {
  it('runs on boot, schedules intervals and stops cleanly', async () => {
    vi.useFakeTimers();
    let ticks = 0;
    const loop = new PersonalAutomationLoop({ tick: async () => { ticks += 1; } }, { intervalMs: 60_000, now: () => 0, setInterval, clearInterval });
    loop.start();
    await Promise.resolve();
    expect(ticks).toBe(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ticks).toBe(2);
    loop.stop();
    vi.advanceTimersByTime(60_000);
    expect(ticks).toBe(2);
    vi.useRealTimers();
  });
});
