import { EventEmitter } from 'node:events';
import type { ChildProcess } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { CORE_EXIT, CORE_TIMING, type ParentMessage } from '@neuralbridge/core/protocol';
import { CoreSupervisor, MAX_RESTARTS, RESTART_BACKOFF_MS } from '../src/main/core/supervisor.js';
import { coreChildEnv } from '../src/main/core/index.js';

const UUID = '0b5f9c1e-6a3e-4a5c-9d2a-1f6c8e2b7a10';

class FakeChild extends EventEmitter {
  static next = 1000;
  pid = FakeChild.next++;
  connected = true;
  exitCode: number | null = null;
  received: ParentMessage[] = [];
  killed = false;
  stderr = Object.assign(new EventEmitter(), { setEncoding: () => undefined });
  send(message: ParentMessage): boolean { this.received.push(message); return true; }
  kill(): boolean { this.killed = true; this.exit(null, 'SIGTERM'); return true; }
  exit(code: number | null, signal: string | null = null): void { if (this.exitCode !== null) return; this.exitCode = code ?? 1; this.connected = false; this.emit('exit', code, signal); }
  ready(port = 43123): void { this.emit('message', { type: 'ready', port, instanceId: UUID, version: '0.1.58', pid: this.pid }); }
}

/** Manual clock: timers fire only when the test advances time. */
function harness(extra: Partial<ConstructorParameters<typeof CoreSupervisor>[0]> = {}) {
  let now = 0;
  const timers: { at: number; fn: () => void; every: number | null; cancelled: boolean }[] = [];
  const children: FakeChild[] = [];
  const logs: string[] = [];
  const supervisor = new CoreSupervisor({
    fork: () => { const child = new FakeChild(); children.push(child); return child as unknown as ChildProcess; },
    script: 'core.js',
    execPath: 'electron.exe',
    env: {},
    log: (_level, event) => logs.push(event),
    now: () => now,
    setTimer: (fn, ms) => { const timer = { at: now + ms, fn, every: null, cancelled: false }; timers.push(timer); return { cancel: () => { timer.cancelled = true; } }; },
    setRepeat: (fn, ms) => { const timer = { at: now + ms, fn, every: ms, cancelled: false }; timers.push(timer); return { cancel: () => { timer.cancelled = true; } }; },
    ...extra,
  });
  const advance = (ms: number) => {
    const target = now + ms;
    for (;;) {
      const due = timers.filter((timer) => !timer.cancelled && timer.at <= target).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      if (due.every) due.at += due.every; else due.cancelled = true;
      due.fn();
    }
    now = target;
  };
  return { supervisor, children, logs, advance, last: () => children.at(-1) as FakeChild };
}

describe('CoreSupervisor', () => {
  it('starts the Core and becomes running on ready, with heartbeats answered', () => {
    const h = harness();
    h.supervisor.start();
    expect(h.supervisor.current().state).toBe('starting');
    h.last().ready();
    expect(h.supervisor.current()).toMatchObject({ state: 'running', port: 43123, instanceId: UUID });
    h.advance(CORE_TIMING.heartbeatMs);
    expect(h.last().received).toEqual([{ type: 'ping', seq: 1 }]);
    h.last().emit('message', { type: 'pong', seq: 1 });
    h.advance(CORE_TIMING.heartbeatMs * 2);
    expect(h.supervisor.current().state).toBe('running');
  });

  it('kills a Core that never gets ready and counts it as a failure', () => {
    const h = harness();
    h.supervisor.start();
    h.advance(CORE_TIMING.readyTimeoutMs);
    expect(h.children[0]?.killed).toBe(true);
    expect(h.supervisor.current().state).toBe('restarting');
    expect(h.logs).toContain('core.ready_timeout');
  });

  it('kills a hung Core (heartbeat lost) and restarts it', () => {
    const h = harness();
    h.supervisor.start();
    h.last().ready();
    h.advance(CORE_TIMING.heartbeatMs * (CORE_TIMING.missedHeartbeats + 2));
    expect(h.children[0]?.killed).toBe(true);
    expect(h.logs).toContain('core.heartbeat_lost');
    h.advance(RESTART_BACKOFF_MS[0]);
    expect(h.children).toHaveLength(2);
  });

  it('restarts after an unexpected exit with growing backoff', () => {
    const h = harness();
    h.supervisor.start();
    h.last().ready();
    h.last().exit(1);
    expect(h.supervisor.current()).toMatchObject({ state: 'restarting', restarts: 1, lastExitCode: 1 });
    h.advance(RESTART_BACKOFF_MS[0] - 1);
    expect(h.children).toHaveLength(1);
    h.advance(1);
    expect(h.children).toHaveLength(2);
    h.last().exit(1);
    h.advance(RESTART_BACKOFF_MS[1]);
    expect(h.children).toHaveLength(3);
    h.last().ready();
    expect(h.supervisor.current().state).toBe('running');
  });

  it('stops restarting after the limit inside the window (no restart loop)', () => {
    const h = harness();
    h.supervisor.start();
    for (let index = 0; index < MAX_RESTARTS + 3; index += 1) {
      h.last().exit(CORE_EXIT.startupFailed);
      h.advance(60_000);
    }
    expect(h.children).toHaveLength(MAX_RESTARTS + 1);
    expect(h.supervisor.current().state).toBe('failed');
    expect(h.logs).toContain('core.restart_limit');
  });

  it('does not restart when another Core already owns the data folder; it attaches', () => {
    const h = harness();
    h.supervisor.start();
    h.last().emit('message', { type: 'already-running', port: 50000, instanceId: UUID, pid: 77 });
    h.last().exit(CORE_EXIT.alreadyRunning);
    h.advance(60_000);
    expect(h.children).toHaveLength(1);
    expect(h.supervisor.current()).toMatchObject({ state: 'attached', port: 50000, pid: 77 });
  });

  it('asks for a graceful shutdown on quit, never restarts after it, and kills after the timeout', async () => {
    const h = harness();
    h.supervisor.start();
    h.last().ready();
    const graceful = h.supervisor.stop();
    expect(h.last().received.at(-1)).toEqual({ type: 'shutdown', reason: 'desktop-quit' });
    h.last().exit(0);
    await graceful;
    h.advance(60_000);
    expect(h.children).toHaveLength(1);
    expect(h.supervisor.current().state).toBe('stopped');

    const stubborn = harness();
    stubborn.supervisor.start();
    stubborn.last().ready();
    const stopping = stubborn.supervisor.stop();
    stubborn.advance(CORE_TIMING.shutdownTimeoutMs + 500);
    await stopping;
    expect(stubborn.last().killed).toBe(true);
    expect(stubborn.supervisor.current().state).toBe('stopped');
  });

  it('can be disabled (rollback switch) and then never forks', async () => {
    const h = harness();
    h.supervisor.disable('NB_CORE_DISABLED=1');
    h.supervisor.start();
    await h.supervisor.stop();
    expect(h.children).toHaveLength(0);
    expect(h.supervisor.current().state).toBe('disabled');
  });

  it('attaches to a standalone Core with its token, and runs its own when that Core disappears (CORE-08)', async () => {
    let alive = true;
    const h = harness({
      attach: async (owner) => ({ port: 50000, token: 'a'.repeat(64), executorId: `${owner.pid}:x`, instanceId: owner.instanceId }),
      probe: async () => alive,
    });
    h.supervisor.start();
    h.last().emit('message', { type: 'already-running', port: 50000, instanceId: UUID, pid: 77 });
    h.last().exit(CORE_EXIT.alreadyRunning);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.supervisor.connection()).toMatchObject({ port: 50000, executorId: '77:x' });
    h.advance(CORE_TIMING.heartbeatMs);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(h.supervisor.current().state).toBe('attached');
    alive = false;
    for (let tick = 0; tick < 2; tick += 1) { h.advance(CORE_TIMING.heartbeatMs); await new Promise((resolve) => setTimeout(resolve, 0)); }
    expect(h.supervisor.connection()).toBeNull();
    expect(h.children).toHaveLength(2);
    expect(h.logs).toContain('core.attached_lost');
    // Quitting while attached leaves the standalone Core alone (no shutdown message to it).
    const other = harness({ attach: async (owner) => ({ port: 1, token: 'b'.repeat(64), executorId: null, instanceId: owner.instanceId }), probe: async () => true });
    other.supervisor.start();
    other.last().emit('message', { type: 'already-running', port: 1, instanceId: UUID, pid: 88 });
    other.last().exit(CORE_EXIT.alreadyRunning);
    await other.supervisor.stop();
    expect(other.children[0]?.received.filter((message) => message.type === 'shutdown')).toHaveLength(0);
  });

  it('ignores malformed messages from the child', () => {
    const h = harness();
    h.supervisor.start();
    h.last().emit('message', { type: 'ready', port: 'x' });
    h.last().emit('message', 'hello');
    expect(h.supervisor.current().state).toBe('starting');
    expect(h.logs.filter((event) => event === 'core.ipc_rejected')).toHaveLength(2);
  });
});

describe('Core child environment', () => {
  it('forces embedded mode and Node runtime, and strips test hooks from packaged builds', () => {
    const base = { PATH: 'C:\\Windows', ELECTRON_RENDERER_URL: 'http://localhost:5173', NB_CORE_TEST_CRASH: 'startup', NB_CORE_ALLOW_TEST_HOOKS: '1', NB_CORE_MODE: 'standalone' };
    const packaged = coreChildEnv(base, { dataDir: 'C:\\data', version: '0.1.58', isPackaged: true });
    expect(packaged).toMatchObject({ PATH: 'C:\\Windows', ELECTRON_RUN_AS_NODE: '1', NB_DATA_DIR: 'C:\\data', NB_CORE_MODE: 'embedded', NB_CORE_VERSION: '0.1.58' });
    expect(packaged['NB_CORE_TEST_CRASH']).toBeUndefined();
    expect(packaged['NB_CORE_ALLOW_TEST_HOOKS']).toBeUndefined();
    expect(packaged['ELECTRON_RENDERER_URL']).toBeUndefined();
    expect(coreChildEnv(base, { dataDir: 'C:\\data', version: '0.1.58', isPackaged: false })['NB_CORE_TEST_CRASH']).toBe('startup');
  });
});
