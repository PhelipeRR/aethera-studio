import { IpcChannel, type CoreRemoteStatus } from '@neuralbridge/shared';
import { registerIpcHandler, type IpcMainLike } from '../ipc/handle.js';
import type { CoreSupervisor } from '../core/supervisor.js';
import { launchStandaloneCore, readStandalone, writeStandalone, type LogonTask } from '../core/standalone.js';
import { callCore, type CoreConnection } from '../core/task-client.js';

/*
 * CORE-07: the "Dispositivos e acesso remoto" screen. Every request goes to the Core's desktop-only routes with the
 * desktop bearer, which stays in the main process; the renderer never sees a token or key.
 */

type RemoteAnswer = { enabled?: boolean; state?: string; hostname?: string; serving?: boolean; detail?: string; reason?: string };

export interface StandaloneDeps {
  dataDir: string;
  task: LogonTask;
  /** Command and arguments the logon task runs (packaged: the app exe; development: electron + app folder). */
  command: string;
  args: readonly string[];
  userId: string;
  execPath: string;
  script: string;
  version: string;
}

export function registerCoreIpcHandlers(ipc: IpcMainLike, supervisor: CoreSupervisor, isTrustedSender: (url: string) => boolean, standalone?: StandaloneDeps): void {
  const need = (): CoreConnection => {
    const connection = supervisor.connection();
    if (!connection) throw new Error('unavailable: O Singularity Core não está em execução.');
    return connection;
  };
  const toStatus = (answer: RemoteAnswer | null): CoreRemoteStatus => {
    const known = ['not-installed', 'logged-out', 'stopped', 'ready', 'blocked'] as const;
    const state = answer && known.includes(answer.state as (typeof known)[number]) ? (answer.state as (typeof known)[number]) : 'unavailable';
    return { supervisor: supervisor.current().state, enabled: answer?.enabled === true, state, hostname: answer?.hostname ?? null, serving: answer?.serving === true, detail: (answer?.detail ?? answer?.reason ?? null)?.slice(0, 300) ?? null };
  };

  registerIpcHandler(ipc, IpcChannel.coreStatus, async () => {
    const connection = supervisor.connection();
    return toStatus(connection ? await callCore<RemoteAnswer>(connection, 'GET', '/internal/v1/remote').catch(() => null) : null);
  }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.coreRemoteSet, async ({ enabled }) => toStatus(await callCore<RemoteAnswer>(need(), 'POST', '/internal/v1/remote', { enabled })), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.corePairingStart, async ({ grant }) => callCore(need(), 'POST', '/api/v1/pairing', { grant }), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.corePairings, async () => (await callCore<{ items: [] }>(need(), 'GET', '/internal/v1/pairings')).items, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.corePairingDecide, async ({ pairingId, decision }) => {
    await callCore(need(), 'POST', `/api/v1/pairing/${encodeURIComponent(pairingId)}/decision`, { decision });
    return { ok: true as const };
  }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.coreDevices, async () => (await callCore<{ items: [] }>(need(), 'GET', '/api/v1/devices')).items, isTrustedSender);
  const runtime = async () => {
    const connection = supervisor.connection();
    const status = connection ? await callCore<{ mode: 'embedded' | 'standalone'; pid: number; version: string; uptimeMs: number; memoryBytes: number; cpuPercent: number; tasksRunning: number }>(connection, 'GET', '/internal/v1/status').catch(() => null) : null;
    return {
      mode: status?.mode ?? null, pid: status?.pid ?? null, version: status?.version ?? null, uptimeMs: status?.uptimeMs ?? null,
      memoryBytes: status?.memoryBytes ?? null, cpuPercent: status?.cpuPercent ?? null, tasksRunning: status?.tasksRunning ?? null,
      standaloneEnabled: standalone ? readStandalone(standalone.dataDir).enabled : false,
      taskRegistered: standalone ? await standalone.task.registered() : false,
    };
  };
  registerIpcHandler(ipc, IpcChannel.coreRuntime, runtime, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.coreStandaloneSet, async ({ enabled }) => {
    if (!standalone) throw new Error('unavailable: Modo independente indisponível.');
    if (enabled) {
      await standalone.task.register({ userId: standalone.userId, command: standalone.command, args: standalone.args });
      writeStandalone(standalone.dataDir, { enabled: true });
      // Hand over now: the embedded Core stops, the standalone one starts after it, and this desktop attaches to it.
      const embeddedPid = supervisor.current().state === 'running' ? supervisor.current().pid : null;
      await supervisor.stop({ type: 'shutdown', reason: 'restart' });
      launchStandaloneCore({ execPath: standalone.execPath, script: standalone.script, dataDir: standalone.dataDir, version: standalone.version, ...(embeddedPid ? { waitPid: embeddedPid } : {}) });
      await new Promise((resolve) => setTimeout(resolve, 500));
      supervisor.restart();
    } else {
      writeStandalone(standalone.dataDir, { enabled: false });
      await standalone.task.unregister();
      const connection = supervisor.connection();
      // A standalone Core is stopped cleanly; this desktop then runs its own embedded Core again.
      if (supervisor.current().state === 'attached' && connection) {
        await callCore(connection, 'POST', '/internal/v1/shutdown', {}).catch(() => undefined);
        for (let waited = 0; waited < 10_000; waited += 250) { if (await fetch(`http://127.0.0.1:${connection.port}/api/v1/health`).then(() => true, () => false)) await new Promise((resolve) => setTimeout(resolve, 250)); else break; }
        supervisor.restart();
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    return runtime();
  }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.coreRevoke, async (target) => ({ revoked: (await callCore<{ revoked: string[] }>(need(), 'POST', '/api/v1/devices/revoke', target)).revoked }), isTrustedSender);
}
