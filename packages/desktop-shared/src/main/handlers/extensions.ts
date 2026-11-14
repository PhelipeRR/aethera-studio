import { IpcChannel, parseIpcOutput, type IpcChannelName, type IpcOutput, type InstalledExtension } from '@neuralbridge/shared';
import type { ExtensionInstaller, ExtensionRegistry } from '@neuralbridge/orchestrator';
import { registerIpcHandler, type IpcMainLike } from '../ipc/handle.js';

export interface ExtensionIpcDependencies {
  registry: ExtensionRegistry | null;
  installer: ExtensionInstaller | null;
  onStateChanged?: (id: string, item: InstalledExtension | null) => void | Promise<void>;
}

function requireRegistry(registry: ExtensionRegistry | null): ExtensionRegistry {
  if (!registry) throw new Error('unavailable: banco de dados indisponível.');
  return registry;
}

function requireInstaller(installer: ExtensionInstaller | null): ExtensionInstaller {
  if (!installer) throw new Error('unavailable: banco de dados indisponível.');
  return installer;
}

async function safeExtensionOutput<C extends IpcChannelName>(channel: C, produce: () => unknown | Promise<unknown>): Promise<IpcOutput<C>> {
  const value = await produce();
  try {
    return parseIpcOutput(channel, value);
  } catch {
    throw new Error('invalid: estado da extensão inválido.');
  }
}

export function registerExtensionIpcHandlers(
  ipc: IpcMainLike,
  dependencies: ExtensionIpcDependencies,
  isTrustedSender: (url: string) => boolean,
): void {
  registerIpcHandler(ipc, IpcChannel.extensionsList, async () => safeExtensionOutput(IpcChannel.extensionsList, () => dependencies.registry?.list() ?? []), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.extensionsInstall, async ({ sourcePath }) => safeExtensionOutput(IpcChannel.extensionsInstall, () => requireInstaller(dependencies.installer).installDirectory(sourcePath)), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.extensionsEnable, async ({ id }) => safeExtensionOutput(IpcChannel.extensionsEnable, async () => { const item = await requireRegistry(dependencies.registry).enable(id); await dependencies.onStateChanged?.(id, item); return item; }), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.extensionsDisable, async ({ id }) => safeExtensionOutput(IpcChannel.extensionsDisable, async () => { const item = await requireRegistry(dependencies.registry).disable(id); await dependencies.onStateChanged?.(id, item); return item; }), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.extensionsUpdate, async ({ sourcePath }) => safeExtensionOutput(IpcChannel.extensionsUpdate, () => requireInstaller(dependencies.installer).updateDirectory(sourcePath)), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.extensionsRollback, async ({ id }) => safeExtensionOutput(IpcChannel.extensionsRollback, () => requireInstaller(dependencies.installer).rollback(id)), isTrustedSender);
  registerIpcHandler(ipc, IpcChannel.extensionsUninstall, async ({ id }) => safeExtensionOutput(IpcChannel.extensionsUninstall, async () => { const result = await requireInstaller(dependencies.installer).uninstall(id); await dependencies.onStateChanged?.(id, null); return result; }), isTrustedSender);
}
