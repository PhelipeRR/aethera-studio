import { fork } from 'node:child_process';
import { join } from 'node:path';
import { createFileLogger } from '@neuralbridge/core';
import { CoreSupervisor } from './supervisor.js';
import { readFileSync } from 'node:fs';
import { readDesktopToken } from './standalone.js';
import { callCore } from './task-client.js';

/*
 * CORE-03 wiring: one embedded Core per desktop run, supervised by CoreSupervisor.
 * - NB_CORE_DISABLED=1 turns the child off (rollback switch); the desktop works the same, since nothing uses the Core yet.
 * - Test hooks (simulated crashes, standalone mode) reach the child only in development builds; a packaged app strips them.
 * - Logs: <data>/logs/core.log (the Core) and <data>/logs/core-supervisor.log (this side), both redacted JSON lines.
 */

const DEV_ONLY = ['NB_CORE_ALLOW_TEST_HOOKS', 'NB_CORE_TEST_CRASH', 'NB_CORE_ALLOW_STANDALONE'];

export function coreChildEnv(base: NodeJS.ProcessEnv, options: { dataDir: string; version: string; isPackaged: boolean }): Record<string, string> {
  const dropped = new Set(['ELECTRON_RENDERER_URL', ...(options.isPackaged ? DEV_ONLY : [])]);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(base)) if (value !== undefined && !dropped.has(key)) env[key] = value;
  return { ...env, ELECTRON_RUN_AS_NODE: '1', NB_DATA_DIR: options.dataDir, NB_CORE_MODE: 'embedded', NB_CORE_VERSION: options.version };
}

export function createCoreSupervisor(options: { dataDir: string; version: string; isPackaged: boolean; script: string; execPath: string }): CoreSupervisor {
  const logger = createFileLogger(join(options.dataDir, 'logs', 'core-supervisor.log'), { mirror: (line) => console.error(`[core] ${line}`) });
  const supervisor = new CoreSupervisor({
    fork: (script, args, forkOptions) => fork(script, [...args], forkOptions),
    script: options.script,
    execPath: options.execPath,
    env: coreChildEnv(process.env, options),
    log: (level, event, fields) => logger.log(level, event, fields),
    onStatus: (status) => logger.log('info', 'core.status', { state: status.state, pid: status.pid, port: status.port, restarts: status.restarts, lastExitCode: status.lastExitCode }),
    // CORE-08: a standalone Core writes its port to core.lock and its bearer to the data folder; wait for both (15 s).
    attach: async (owner) => {
      for (let waited = 0; waited < 15_000; waited += 250) {
        let lock: { pid?: number; port?: number | null; instanceId?: string } = {};
        try { lock = JSON.parse(readFileSync(join(options.dataDir, 'core.lock'), 'utf8')) as typeof lock; } catch { /* not yet */ }
        const token = readDesktopToken(options.dataDir);
        if (lock.port && lock.instanceId && token && lock.pid === owner.pid) {
          const connection = { port: lock.port, token, executorId: null as string | null, instanceId: lock.instanceId };
          const executor = await callCore<{ instanceId: string }>(connection, 'GET', '/internal/v1/executor').catch(() => null);
          if (executor) return { ...connection, executorId: executor.instanceId };
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      return null;
    },
    probe: async (connection) => {
      const response = await fetch(`http://127.0.0.1:${connection.port}/api/v1/health`, { signal: AbortSignal.timeout(3_000) }).catch(() => null);
      return response?.status === 200;
    },
  });
  if (process.env['NB_CORE_DISABLED'] === '1') supervisor.disable('NB_CORE_DISABLED=1');
  return supervisor;
}
