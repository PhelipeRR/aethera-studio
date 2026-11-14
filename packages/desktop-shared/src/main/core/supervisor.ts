import type { ChildProcess, ForkOptions } from 'node:child_process';
import { CORE_EXIT, CORE_TIMING, coreMessageSchema, type CoreMessage, type ParentMessage } from '@neuralbridge/core/protocol';

/*
 * CORE-03: the desktop supervises the embedded Singularity Core (ADR CORE-01 §2.1).
 * - Starts it as a child (the app executable as Node), waits for `ready` within a timeout.
 * - Heartbeat over the IPC pipe; a Core that stops answering is killed and treated as a crash.
 * - Unexpected exits restart with backoff, at most MAX_RESTARTS within RESTART_WINDOW_MS: then it stays `failed`
 *   until the next launch (no restart loop). The desktop keeps working without the Core: nothing depends on it yet.
 * - "Already running" (another live Core owns core.lock) is not a crash: the desktop attaches to it.
 * - Quitting the desktop asks for a graceful shutdown; the Core also stops by itself when the pipe closes, so a crash
 *   of the desktop never leaves it orphaned.
 */

export const RESTART_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;
export const MAX_RESTARTS = 5;
export const RESTART_WINDOW_MS = 10 * 60 * 1000;

export type SupervisorState = 'disabled' | 'idle' | 'starting' | 'running' | 'attached' | 'restarting' | 'failed' | 'stopping' | 'stopped';

export interface SupervisorStatus {
  state: SupervisorState;
  pid: number | null;
  port: number | null;
  instanceId: string | null;
  restarts: number;
  lastExitCode: number | null;
  lastError: string | null;
}

export interface SupervisorDeps {
  fork: (script: string, args: readonly string[], options: ForkOptions) => ChildProcess;
  script: string;
  /** Environment for the child (built by the caller: data dir, mode, version, ELECTRON_RUN_AS_NODE). */
  env: Record<string, string>;
  execPath: string;
  log: (level: 'info' | 'warn' | 'error', event: string, fields?: Record<string, string | number | boolean | null>) => void;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => { cancel: () => void };
  setRepeat?: (fn: () => void, ms: number) => { cancel: () => void };
  onStatus?: (status: SupervisorStatus) => void;
  /** CORE-08: how to reach a Core this desktop did not start (standalone): bearer and executor, or null. */
  attach?: (owner: { port: number | null; instanceId: string; pid: number }) => Promise<{ port: number; token: string; executorId: string | null; instanceId: string } | null>;
  /** Whether an attached Core still answers. */
  probe?: (connection: { port: number; token: string }) => Promise<boolean>;
}

const defaultTimer = (fn: () => void, ms: number) => { const handle = setTimeout(fn, ms); handle.unref(); return { cancel: () => clearTimeout(handle) }; };
const defaultRepeat = (fn: () => void, ms: number) => { const handle = setInterval(fn, ms); handle.unref(); return { cancel: () => clearInterval(handle) }; };

export class CoreSupervisor {
  private child: ChildProcess | null = null;
  private status: SupervisorStatus = { state: 'idle', pid: null, port: null, instanceId: null, restarts: 0, lastExitCode: null, lastError: null };
  private restartTimes: number[] = [];
  private readyTimer: { cancel: () => void } | null = null;
  private heartbeat: { cancel: () => void } | null = null;
  private restartTimer: { cancel: () => void } | null = null;
  private seq = 0;
  private attachedWatch: { cancel: () => void } | null = null;
  /** Bearer and executor id from the ready message: memory only, never logged or written. */
  private connectionInfo: { port: number; token: string; executorId: string | null; instanceId: string } | null = null;
  private readonly connectionListeners = new Set<(info: { port: number; token: string; executorId: string | null; instanceId: string } | null) => void>();
  private lastPong = 0;
  private readonly now: () => number;
  private readonly setTimer: NonNullable<SupervisorDeps['setTimer']>;
  private readonly setRepeat: NonNullable<SupervisorDeps['setRepeat']>;

  constructor(private readonly deps: SupervisorDeps) {
    this.now = deps.now ?? Date.now;
    this.setTimer = deps.setTimer ?? defaultTimer;
    this.setRepeat = deps.setRepeat ?? defaultRepeat;
  }

  current(): SupervisorStatus { return { ...this.status }; }

  /** How the desktop reaches the running Core (null while it is not running). */
  connection(): { port: number; token: string; executorId: string | null; instanceId: string } | null { return this.connectionInfo; }

  onConnection(listener: (info: { port: number; token: string; executorId: string | null; instanceId: string } | null) => void): () => void {
    this.connectionListeners.add(listener);
    return () => this.connectionListeners.delete(listener);
  }

  private setConnection(info: { port: number; token: string; executorId: string | null; instanceId: string } | null): void {
    this.connectionInfo = info;
    for (const listener of this.connectionListeners) listener(info);
  }

  disable(reason: string): void {
    this.update({ state: 'disabled', lastError: reason });
    this.deps.log('info', 'core.supervisor_disabled', { reason });
  }

  start(): void {
    if (this.status.state === 'disabled' || this.status.state === 'stopping' || this.status.state === 'stopped' || this.child) return;
    this.spawn();
  }

  /** CORE-08: after a deliberate stop (switching between embedded and standalone), supervise again from scratch. */
  restart(): void {
    if (this.status.state === 'disabled' || this.child) return;
    this.attachedWatch?.cancel();
    this.attachedWatch = null;
    if (this.connectionInfo) this.setConnection(null);
    this.restartTimes = [];
    this.update({ state: 'idle', pid: null, port: null, instanceId: null, lastError: null });
    this.spawn();
  }

  /** Graceful stop on quit: asks the Core to shut down and kills it if it does not exit in time. Never restarts. */
  stop(reason: ParentMessage & { type: 'shutdown' } = { type: 'shutdown', reason: 'desktop-quit' }): Promise<void> {
    this.restartTimer?.cancel();
    this.stopHeartbeat();
    this.attachedWatch?.cancel();
    this.attachedWatch = null;
    if (this.status.state === 'disabled') return Promise.resolve();
    const child = this.child;
    this.update({ state: 'stopping' });
    if (!child || child.exitCode !== null) { this.update({ state: 'stopped' }); return Promise.resolve(); }
    return new Promise((resolve) => {
      const force = this.setTimer(() => { this.deps.log('warn', 'core.kill_after_timeout', { pid: child.pid ?? null }); child.kill(); }, CORE_TIMING.shutdownTimeoutMs + 500);
      child.once('exit', () => { force.cancel(); this.update({ state: 'stopped' }); resolve(); });
      this.post(child, reason);
    });
  }

  private update(changes: Partial<SupervisorStatus>): void {
    this.status = { ...this.status, ...changes };
    this.deps.onStatus?.(this.current());
  }

  private post(child: ChildProcess, message: ParentMessage): void {
    if (!child.connected) return;
    try { child.send(message); } catch { /* exit handling follows */ }
  }

  private spawn(): void {
    this.update({ state: this.status.restarts > 0 ? 'restarting' : 'starting', pid: null, port: null, instanceId: null });
    let child: ChildProcess;
    try {
      child = this.deps.fork(this.deps.script, [], { execPath: this.deps.execPath, env: this.deps.env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'json' });
    } catch (error) {
      this.crashed(null, error instanceof Error ? error.message : 'fork falhou');
      return;
    }
    this.child = child;
    this.update({ pid: child.pid ?? null });
    // The Core mirrors its warnings and errors to stderr as already-sanitized JSON lines.
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => { for (const line of chunk.split('\n')) if (line.trim()) this.deps.log('warn', 'core.stderr', { line: line.slice(0, 500) }); });
    this.readyTimer = this.setTimer(() => {
      this.deps.log('error', 'core.ready_timeout', { timeoutMs: CORE_TIMING.readyTimeoutMs });
      this.update({ lastError: 'O Core não ficou pronto a tempo.' });
      child.kill();
    }, CORE_TIMING.readyTimeoutMs);
    child.on('message', (raw) => this.onMessage(child, raw));
    child.on('error', (error) => { this.deps.log('error', 'core.process_error', { message: error.message }); });
    child.once('exit', (code, signal) => this.onExit(child, code, signal));
  }

  private onMessage(child: ChildProcess, raw: unknown): void {
    const parsed = coreMessageSchema.safeParse(raw);
    if (!parsed.success) { this.deps.log('warn', 'core.ipc_rejected', {}); return; }
    const message: CoreMessage = parsed.data;
    if (message.type === 'ready') {
      this.readyTimer?.cancel();
      this.update({ state: 'running', port: message.port, instanceId: message.instanceId, lastError: null });
      if (message.desktopToken) this.setConnection({ port: message.port, token: message.desktopToken, executorId: message.executorId ?? null, instanceId: message.instanceId });
      this.deps.log('info', 'core.ready', { pid: message.pid, port: message.port });
      this.startHeartbeat(child);
    } else if (message.type === 'pong') {
      this.lastPong = this.now();
    } else if (message.type === 'already-running') {
      this.readyTimer?.cancel();
      this.update({ state: 'attached', port: message.port, instanceId: message.instanceId, pid: message.pid });
      this.deps.log('warn', 'core.attached_existing', { pid: message.pid, port: message.port });
      void this.attachTo({ port: message.port, instanceId: message.instanceId, pid: message.pid });
    }
  }

  /** CORE-08: use a standalone Core (bearer from its token file) and watch it; if it disappears, run an embedded one. */
  private async attachTo(owner: { port: number | null; instanceId: string; pid: number }): Promise<void> {
    if (!this.deps.attach) return;
    const connection = await this.deps.attach(owner).catch(() => null);
    if (this.status.state !== 'attached') return;
    if (!connection) { this.deps.log('warn', 'core.attach_failed', { pid: owner.pid }); return; }
    this.setConnection(connection);
    this.update({ port: connection.port, instanceId: connection.instanceId });
    this.deps.log('info', 'core.attached', { pid: owner.pid, port: connection.port });
    let misses = 0;
    this.attachedWatch?.cancel();
    this.attachedWatch = this.setRepeat(() => {
      void (this.deps.probe?.(connection) ?? Promise.resolve(true)).then((alive) => {
        if (this.status.state !== 'attached') return;
        misses = alive ? 0 : misses + 1;
        if (misses < 2) return;
        this.attachedWatch?.cancel();
        this.attachedWatch = null;
        this.setConnection(null);
        this.deps.log('warn', 'core.attached_lost', { pid: owner.pid });
        // The standalone Core is gone: this desktop runs its own until the logon task brings one back.
        this.update({ state: 'idle', pid: null, port: null, instanceId: null });
        this.spawn();
      });
    }, CORE_TIMING.heartbeatMs);
  }

  private startHeartbeat(child: ChildProcess): void {
    this.stopHeartbeat();
    this.lastPong = this.now();
    this.heartbeat = this.setRepeat(() => {
      if (this.now() - this.lastPong > CORE_TIMING.heartbeatMs * CORE_TIMING.missedHeartbeats) {
        this.deps.log('error', 'core.heartbeat_lost', { pid: child.pid ?? null });
        this.update({ lastError: 'O Core parou de responder.' });
        this.stopHeartbeat();
        child.kill();
        return;
      }
      this.post(child, { type: 'ping', seq: (this.seq += 1) });
    }, CORE_TIMING.heartbeatMs);
  }

  private stopHeartbeat(): void {
    this.heartbeat?.cancel();
    this.heartbeat = null;
  }

  private onExit(child: ChildProcess, code: number | null, signal: NodeJS.Signals | null): void {
    this.readyTimer?.cancel();
    // A child that only found another Core (exit 3) may exit after the attach succeeded: keep that connection.
    if (this.connectionInfo && this.status.state !== 'attached') this.setConnection(null);
    this.stopHeartbeat();
    if (this.child === child) this.child = null;
    this.update({ lastExitCode: code });
    const state = this.status.state;
    if (state === 'stopping' || state === 'stopped' || state === 'disabled') return;
    if (code === CORE_EXIT.alreadyRunning) {
      // Another Core owns the folder; it is not ours to restart. Attached state was set by its message.
      if (state !== 'attached') this.update({ state: 'attached' });
      return;
    }
    this.crashed(code, signal ? `sinal ${signal}` : `código ${code ?? 'desconhecido'}`);
  }

  private crashed(code: number | null, reason: string): void {
    const at = this.now();
    this.restartTimes = this.restartTimes.filter((time) => at - time < RESTART_WINDOW_MS);
    if (this.restartTimes.length >= MAX_RESTARTS) {
      this.update({ state: 'failed', pid: null, port: null, lastError: this.status.lastError ?? `O Core encerrou (${reason}).` });
      this.deps.log('error', 'core.restart_limit', { restarts: this.restartTimes.length, windowMs: RESTART_WINDOW_MS, lastExitCode: code });
      return;
    }
    const delay = RESTART_BACKOFF_MS[Math.min(this.restartTimes.length, RESTART_BACKOFF_MS.length - 1)] ?? 30_000;
    this.restartTimes.push(at);
    this.update({ state: 'restarting', pid: null, port: null, restarts: this.status.restarts + 1 });
    this.deps.log('warn', 'core.unexpected_exit', { exitCode: code, reason, restartInMs: delay, attempt: this.restartTimes.length });
    this.restartTimer = this.setTimer(() => { this.restartTimer = null; if (this.status.state === 'restarting') this.spawn(); }, delay);
  }
}
