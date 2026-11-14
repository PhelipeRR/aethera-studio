import { describe, expect, it } from 'vitest';
import type { SupervisorState } from '../src/main/core/supervisor';
import { waitForCore } from '../src/main/core/wait-for-core';

// Boot recovery waits for the Core so recovered work lands on the executor, never longer than the ready timeout.
function harness(initial: { state: SupervisorState; connected?: boolean }) {
  let state = initial.state;
  let connected = initial.connected ?? false;
  const listeners = new Set<(connection: unknown) => void>();
  let fire: (() => void) | null = null;
  const deps = {
    state: () => state,
    connected: () => connected,
    onConnection: (listener: (connection: unknown) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    timeoutMs: 15_000,
    setTimer: (fn: () => void) => { fire = fn; return { cancel: () => { fire = null; } }; },
  };
  return {
    deps,
    connect: () => { connected = true; state = 'running'; for (const listener of [...listeners]) listener({ port: 1 }); },
    fail: () => { state = 'failed'; for (const listener of [...listeners]) listener(null); },
    timeout: () => fire?.(),
    listeners,
  };
}

describe('waitForCore', () => {
  it('resolves at once when the Core is already connected', async () => {
    await expect(waitForCore(harness({ state: 'running', connected: true }).deps)).resolves.toBe('core');
  });

  it('does not wait for a Core that is disabled, failed or stopped', async () => {
    for (const state of ['disabled', 'failed', 'stopped'] as const) await expect(waitForCore(harness({ state }).deps)).resolves.toBe('desktop');
  });

  it('waits while the Core starts and resolves when it connects, then unsubscribes', async () => {
    const h = harness({ state: 'starting' });
    const waiting = waitForCore(h.deps);
    h.connect();
    await expect(waiting).resolves.toBe('core');
    expect(h.listeners.size).toBe(0);
  });

  it('gives up when the Core fails to start, or at the ready timeout', async () => {
    const failing = harness({ state: 'starting' });
    const first = waitForCore(failing.deps);
    failing.fail();
    await expect(first).resolves.toBe('desktop');
    const silent = harness({ state: 'starting' });
    const second = waitForCore(silent.deps);
    silent.timeout();
    await expect(second).resolves.toBe('desktop');
    expect(silent.listeners.size).toBe(0);
  });
});
