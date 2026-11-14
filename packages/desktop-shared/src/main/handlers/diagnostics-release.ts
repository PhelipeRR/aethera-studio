import { IpcChannel, type IpcOutput } from '@neuralbridge/shared';
import { registerIpcHandler, type IpcMainLike } from '../ipc/handle.js';

export interface DiagnosticsReleaseIpcDependencies {
  getAppInfo: () => IpcOutput<typeof IpcChannel.appInfo> | Promise<IpcOutput<typeof IpcChannel.appInfo>>;
  getAppStatus: () => IpcOutput<typeof IpcChannel.appStatus> | Promise<IpcOutput<typeof IpcChannel.appStatus>>;
}

/**
 * Registers the read-only app identity and health checks used by diagnostics
 * surfaces. The shared strict output contracts are the redaction boundary:
 * credentials and other undeclared fields cannot cross this IPC seam.
 */
export function registerDiagnosticsReleaseIpcHandlers(
  ipc: IpcMainLike,
  dependencies: DiagnosticsReleaseIpcDependencies,
  isTrustedSender: (url: string) => boolean,
): void {
  registerIpcHandler(ipc, IpcChannel.appInfo, async () => dependencies.getAppInfo(), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.appStatus, async () => dependencies.getAppStatus(), isTrustedSender);
}
