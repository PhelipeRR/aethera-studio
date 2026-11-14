import { IpcChannel, type DatabaseRecoveryBackup } from '@neuralbridge/shared';
import { registerIpcHandler, type IpcMainLike } from '../ipc/handle.js';

export interface RecoveryIpcDependencies {
  /** Backups and restore for degraded mode; null when the backups folder cannot be used. */
  recovery: { backups(): DatabaseRecoveryBackup[]; restore(name: string): { preservedAs: string } } | null;
  /** Restarts the app (Electron relaunch + exit). Scheduled after the reply so the renderer gets an answer. */
  relaunch: () => void;
  /** Writes a redacted diagnostics report and returns its path. */
  exportDiagnostics: () => Promise<string> | string;
}

/**
 * Recovery actions offered by the degraded-mode banner: safe retry (restart), restore a verified backup
 * (the unusable files are preserved, never deleted), and a redacted diagnostics export. Paths never come
 * from the renderer: a backup is chosen by name only.
 */
export function registerRecoveryIpcHandlers(ipc: IpcMainLike, dependencies: RecoveryIpcDependencies, isTrustedSender: (url: string) => boolean): void {
  const need = () => {
    if (!dependencies.recovery) throw new Error('unavailable: A pasta de backups não está disponível.');
    return dependencies.recovery;
  };
  registerIpcHandler(ipc, IpcChannel.databaseRecoveryBackups, async () => (dependencies.recovery ? dependencies.recovery.backups() : []), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.databaseRestoreBackup, async ({ name }) => {
    const result = need().restore(name);
    setTimeout(dependencies.relaunch, 250);
    return result;
  }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.appRelaunch, async () => {
    setTimeout(dependencies.relaunch, 250);
    return { ok: true as const };
  }, isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.appExportDiagnostics, async () => ({ file: await dependencies.exportDiagnostics() }), isTrustedSender);
}
