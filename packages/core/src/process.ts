import { randomBytes, randomUUID } from 'node:crypto';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CoreConfigError, readCoreConfig } from './config.js';
import { createFileLogger } from './log.js';
import { CORE_EXIT, CORE_TIMING, coreMessageSchema, parentMessageSchema, type CoreMessage } from './protocol.js';
import { startCore, type CoreDomain, type RunningCore } from './runtime.js';
import type { CoreConfig } from './config.js';
import type { Logger } from './log.js';

/*
 * CORE-03/05 process runner. The app's Core host (apps/desktop/src/core-host) calls it with the desktop domain; bin.ts
 * runs a bare Core. `out/main/core.js`. Started by the desktop with the app executable as Node (ELECTRON_RUN_AS_NODE=1),
 * the same way as the MCP server; it imports nothing from Electron, so CORE-08 can run it with plain Node.
 * Embedded mode follows its parent: it stops when the IPC channel closes or the desktop stops pinging, so a crashed or
 * killed desktop never leaves an orphan Core holding the lock.
 */

const instanceId = randomUUID();
let core: RunningCore | null = null;
let exiting = false;

function send(message: CoreMessage): void {
  if (!process.send || !process.connected) return;
  try { process.send(coreMessageSchema.parse(message)); } catch { /* the parent is gone; shutdown follows from 'disconnect' */ }
}

function exit(code: number): void {
  if (exiting) return;
  exiting = true;
  // The exit code holds even if the event loop empties first; the timer only bounds how long anything may linger
  // (the IPC message and the log line get a moment to flush).
  process.exitCode = code;
  setTimeout(() => process.exit(code), 50).unref();
}

export interface DomainContext { config: CoreConfig; log: Logger; desktopToken: string; desktopConnected: () => boolean; startedAt: number; requestShutdown: (reason: string) => void }

/** Runs a Core process: config, lock, server, IPC supervision, signals and exit codes, with an optional domain. */
export async function runCoreProcess(options: { domain?: (context: DomainContext) => Promise<CoreDomain> } = {}): Promise<void> {
  let config;
  try { config = readCoreConfig(process.env); } catch (error) {
    process.stderr.write(`${JSON.stringify({ ts: new Date().toISOString(), level: 'error', event: 'core.config_invalid', message: error instanceof CoreConfigError ? error.message : 'erro desconhecido' })}\n`);
    exit(CORE_EXIT.startupFailed);
    return;
  }
  const log = createFileLogger(join(config.dataDir, 'logs', 'core.log'), { mirror: (line) => process.stderr.write(`${line}\n`) });
  const embedded = config.mode === 'embedded';
  let lastPing = Date.now();

  const stop = (reason: string, code: number = CORE_EXIT.ok): void => {
    if (!core) { exit(code); return; }
    const running = core;
    const force = setTimeout(() => { log.log('error', 'core.shutdown_timeout', { reason }); exit(CORE_EXIT.shutdownTimeout); }, CORE_TIMING.shutdownTimeoutMs);
    void running.shutdown(reason).then(() => { clearTimeout(force); exit(code); });
  };

  process.on('message', (raw) => {
    const message = parentMessageSchema.safeParse(raw);
    if (!message.success) { log.log('warn', 'core.ipc_rejected', {}); return; }
    if (message.data.type === 'ping') { lastPing = Date.now(); send({ type: 'pong', seq: message.data.seq }); return; }
    stop(message.data.reason);
  });
  process.on('disconnect', () => { if (embedded) stop('parent-gone'); });
  process.on('SIGTERM', () => stop('sigterm'));
  process.on('SIGINT', () => stop('sigint'));
  process.on('uncaughtException', (error) => { log.log('error', 'core.uncaught', { message: error.message }); stop('uncaught', 1); });
  process.on('unhandledRejection', (error) => { log.log('error', 'core.unhandled_rejection', { message: error instanceof Error ? error.message : 'desconhecido' }); stop('unhandled', 1); });

  // CORE-08: a standalone Core started while an embedded one is still handing over waits for it to exit (max 15 s).
  const waitPid = Number(process.env['NB_CORE_WAIT_PID'] ?? '');
  if (!embedded && Number.isInteger(waitPid) && waitPid > 0) {
    for (let waited = 0; waited < 15_000; waited += 200) {
      try { process.kill(waitPid, 0); } catch { break; }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  const tokenFile = join(config.dataDir, 'core-desktop.token');
  try {
    const desktopToken = randomBytes(32).toString('hex');
    const desktopConnected = () => embedded && process.connected;
    const context: DomainContext = { config, log, desktopToken, desktopConnected, startedAt: Date.now(), requestShutdown: (reason) => stop(reason) };
    const domain = options.domain;
    const result = await startCore(config, { instanceId, pid: process.pid, log, send, desktopConnected, desktopToken, ...(domain ? { domain: () => domain(context) } : {}) });
    if (result.kind === 'already-running') { exit(CORE_EXIT.alreadyRunning); return; }
    core = result.core;
    // Standalone: no IPC pipe, so the desktop reads its bearer from the data folder (the user's own profile, like the
    // other local state). Removed on shutdown; rewritten on every start.
    if (!embedded) { writeFileSync(tokenFile, desktopToken); process.on('exit', () => { try { rmSync(tokenFile, { force: true }); } catch { /* best effort */ } }); }
  } catch (error) {
    log.log('error', 'core.startup_failed', { message: error instanceof Error ? error.message : 'desconhecido', code: (error as NodeJS.ErrnoException).code ?? null });
    exit(CORE_EXIT.startupFailed);
    return;
  }

  if (embedded) {
    if (!process.connected) { stop('no-parent'); return; }
    // A parent that stopped pinging (hung or killed without closing the pipe) must not keep this Core alive.
    setInterval(() => { if (Date.now() - lastPing > CORE_TIMING.parentSilenceMs) stop('parent-silent'); }, CORE_TIMING.heartbeatMs).unref();
  }
  if (config.testCrash === 'after-ready') setTimeout(() => { log.log('warn', 'core.test_crash', {}); process.exit(1); }, 300);
}

