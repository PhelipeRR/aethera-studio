import { request } from 'node:http';
import { CORE_API_VERSION, CORE_ROUTES } from '@neuralbridge/shared/core-api';
import type { CoreConfig } from './config.js';
import { acquireLock, processAlive, type CoreLock, type LockContent } from './lock.js';
import type { Logger } from './log.js';
import { CORE_TIMING, INSTANCE_HEADER, type CoreMessage } from './protocol.js';
import { LOOPBACK_HOST, startServer, type CoreServer, type DomainHandler, type Health } from './server.js';

/*
 * CORE-03: the Core's lifecycle without process plumbing (main.ts adds IPC, signals and exit codes), so tests run it
 * in-process. This lot has no domain: no TaskEngine, agents, memory, RAG or MCP. Tasks keep running in the desktop,
 * which stays the single executor until CORE-05.
 */

export type CoreState = 'starting' | 'ok' | 'stopping' | 'stopped';

export interface CoreRuntimeDeps {
  instanceId: string;
  pid: number;
  log: Logger;
  send: (message: CoreMessage) => void;
  /** Whether a desktop is attached (embedded: the IPC channel is up). */
  desktopConnected: () => boolean;
  now?: () => Date;
  /** Who owns a live lock answers /health with its instance id (overridable in tests). */
  ownerAnswers?: (owner: LockContent) => Promise<boolean>;
  isAlive?: (pid: number) => boolean;
  /** CORE-05: the domain (tasks, memory…) composed by the host; absent in a bare Core. Started after the lock. */
  domain?: () => Promise<CoreDomain>;
  /** Bearer for the desktop principal, reported on the IPC ready message only. */
  desktopToken?: string;
}

export interface CoreDomain {
  handle: DomainHandler;
  shutdown(): Promise<void>;
  /** Lease identity of the domain's task executor, reported to the desktop adapter. */
  executorId?: string;
  /** CORE-07: tailnet host names accepted while remote access is on. */
  remoteHosts?: () => readonly string[];
  /** Runs once the port is known (remote publication follows the dynamic port). */
  started?: (port: number, health: () => Health) => void;
}

export type StartResult = { kind: 'running'; core: RunningCore } | { kind: 'already-running'; owner: LockContent };

export interface RunningCore {
  port: number;
  state(): CoreState;
  health(): Health;
  shutdown(reason: string): Promise<void>;
}

/** GET /api/v1/health on the lock owner's port; true only when it answers with the same instance id. */
export function probeOwner(owner: LockContent, timeoutMs = 1_000): Promise<boolean> {
  if (owner.port === null) return Promise.resolve(false);
  return new Promise((resolve) => {
    const req = request({ host: LOOPBACK_HOST, port: owner.port, path: CORE_ROUTES.health.path, method: 'GET', timeout: timeoutMs, headers: { Host: `${LOOPBACK_HOST}:${owner.port}` } }, (response) => {
      response.resume();
      resolve(response.headers[INSTANCE_HEADER.toLowerCase()] === owner.instanceId);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
    req.end();
  });
}

export async function startCore(config: CoreConfig, deps: CoreRuntimeDeps): Promise<StartResult> {
  const now = deps.now ?? (() => new Date());
  const startedAt = now().toISOString();
  let state: CoreState = 'starting';
  deps.log.log('info', 'core.starting', { mode: config.mode, version: config.version, pid: deps.pid });
  if (config.testCrash === 'startup') throw new Error('Falha de inicialização simulada (NB_CORE_TEST_CRASH).');

  const content: LockContent = { pid: deps.pid, port: null, instanceId: deps.instanceId, startedAt, version: config.version, mode: config.mode };
  const locked = await acquireLock(config.dataDir, content, { isAlive: deps.isAlive ?? processAlive, ownerAnswers: deps.ownerAnswers ?? probeOwner });
  if (!locked.acquired) {
    deps.log.log('warn', 'core.already_running', { ownerPid: locked.owner.pid, ownerPort: locked.owner.port, ownerMode: locked.owner.mode });
    deps.send({ type: 'already-running', port: locked.owner.port, instanceId: locked.owner.instanceId, pid: locked.owner.pid });
    return { kind: 'already-running', owner: locked.owner };
  }
  const lock: CoreLock = locked.lock;

  const health = (): Health => ({
    status: state === 'ok' ? 'ok' : state === 'starting' ? 'starting' : 'stopping',
    coreVersion: config.version,
    apiVersions: [CORE_API_VERSION],
    mode: config.mode,
    desktopConnected: deps.desktopConnected(),
    // Desktop capabilities register in later lots; until then none is offered through the Core.
    capabilities: { notifications: false, voice: false, screen: false, hud: false, secrets: false },
    startedAt,
  });

  let server: CoreServer;
  let domain: CoreDomain | null = null;
  try {
    // The domain is composed only after the lock: a second Core never opens the database or starts an executor.
    domain = deps.domain ? await deps.domain() : null;
    const handler = domain?.handle;
    server = await startServer({ preferredPort: config.preferredPort, instanceId: deps.instanceId, health, onPortFallback: (port) => deps.log.log('warn', 'core.port_in_use', { preferredPort: port }), ...(handler ? { domain: handler } : {}), ...(domain?.remoteHosts ? { remoteHosts: domain.remoteHosts } : {}) });
  } catch (error) {
    await domain?.shutdown().catch(() => undefined);
    lock.release();
    throw error;
  }
  lock.update({ port: server.port });
  domain?.started?.(server.port, health);
  state = 'ok';
  deps.log.log('info', 'core.ready', { port: server.port, mode: config.mode });
  deps.send({ type: 'ready', port: server.port, instanceId: deps.instanceId, version: config.version, pid: deps.pid, ...(deps.desktopToken ? { desktopToken: deps.desktopToken } : {}), ...(domain?.executorId ? { executorId: domain.executorId } : {}) });

  let stopping: Promise<void> | null = null;
  return {
    kind: 'running',
    core: {
      port: server.port,
      state: () => state,
      health,
      shutdown(reason) {
        stopping ??= (async () => {
          state = 'stopping';
          deps.log.log('info', 'core.stopping', { reason });
          deps.send({ type: 'stopping', reason: reason.slice(0, 40) });
          await Promise.race([Promise.all([server.close(), domain?.shutdown()]), new Promise((resolve) => setTimeout(resolve, CORE_TIMING.shutdownTimeoutMs - 500))]);
          lock.release();
          state = 'stopped';
          deps.log.log('info', 'core.stopped', { reason });
        })();
        return stopping;
      },
    },
  };
}
