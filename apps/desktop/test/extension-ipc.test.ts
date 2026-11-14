import { describe, expect, it } from 'vitest';
import { IpcChannel, type ExtensionManifest, type InstalledExtension } from '@neuralbridge/shared';
import { registerExtensionIpcHandlers } from '../src/main/handlers/extensions.js';
import type { ExtensionInstaller, ExtensionRegistry } from '@neuralbridge/orchestrator';

type Listener = (event: { senderFrame: { url: string } | null }, payload: unknown) => Promise<unknown>;

class FakeIpc {
  readonly handlers = new Map<string, Listener>();
  handle(channel: string, listener: Listener): void { this.handlers.set(channel, listener); }
  async invoke(channel: string, payload: unknown, url = 'file:///app/index.html'): Promise<unknown> {
    const handler = this.handlers.get(channel);
    if (!handler) throw new Error(`missing_handler:${channel}`);
    return handler({ senderFrame: { url } }, payload);
  }
}

const manifest: ExtensionManifest = {
  schemaVersion: 1, id: 'neura', name: 'Neura', version: '1.0.0', minCoreVersion: '0.1.0',
  capabilities: ['navigation'], permissions: ['tasks.read'], entrypoints: { main: 'main.js' },
  checksum: `sha256:${'a'.repeat(64)}`, signature: { algorithm: 'sha256', value: 'sig' }, updateChannel: 'local',
};
const installed: InstalledExtension = { manifest, state: 'enabled', installedAt: '2026-11-06T00:00:00.000Z', updatedAt: '2026-11-06T00:00:00.000Z' };

function setup(
  overrides: { registry?: ExtensionRegistry | null; installer?: ExtensionInstaller | null } = {},
  outputs: { registryList?: unknown; installerResult?: unknown; uninstallResult?: unknown } = {},
) {
  const calls: string[] = [];
  const registry = overrides.registry !== undefined ? overrides.registry : {
    list: () => (outputs.registryList ?? [installed]) as InstalledExtension[], get: () => installed,
    register: () => installed, disable: async () => { calls.push('disable'); return installed; },
    enable: async () => { calls.push('enable'); return installed; }, rollback: async () => installed,
    uninstall: async () => ({ removed: true as const }),
  } as unknown as ExtensionRegistry;
  const installer = overrides.installer !== undefined ? overrides.installer : {
    install: async () => (outputs.installerResult ?? installed) as InstalledExtension,
    installDirectory: async (source: string) => { calls.push(`install:${source}`); return (outputs.installerResult ?? installed) as InstalledExtension; },
    update: async () => (outputs.installerResult ?? installed) as InstalledExtension,
    updateDirectory: async (source: string) => { calls.push(`update:${source}`); return (outputs.installerResult ?? installed) as InstalledExtension; },
    rollback: async (id: string) => { calls.push(`rollback:${id}`); return (outputs.installerResult ?? installed) as InstalledExtension; },
    uninstall: async (id: string) => { calls.push(`uninstall:${id}`); return (outputs.uninstallResult ?? { removed: true as const }) as { removed: true }; },
  } as ExtensionInstaller;
  const ipc = new FakeIpc();
  registerExtensionIpcHandlers(ipc, { registry, installer }, (url) => url === 'file:///app/index.html');
  return { ipc, calls };
}

describe('extension IPC handler group', () => {
  it('keeps valid lifecycle payloads and return values compatible', async () => {
    const { ipc, calls } = setup();
    expect(await ipc.invoke(IpcChannel.extensionsList, undefined)).toEqual([installed]);
    expect(await ipc.invoke(IpcChannel.extensionsInstall, { sourcePath: 'C:\\extensions\\neura' })).toEqual(installed);
    expect(await ipc.invoke(IpcChannel.extensionsEnable, { id: 'neura' })).toEqual(installed);
    expect(await ipc.invoke(IpcChannel.extensionsDisable, { id: 'neura' })).toEqual(installed);
    expect(await ipc.invoke(IpcChannel.extensionsUpdate, { sourcePath: 'C:\\extensions\\neura-v2' })).toEqual(installed);
    expect(await ipc.invoke(IpcChannel.extensionsRollback, { id: 'neura' })).toEqual(installed);
    expect(await ipc.invoke(IpcChannel.extensionsUninstall, { id: 'neura' })).toEqual({ removed: true });
    expect(calls).toEqual(['install:C:\\extensions\\neura', 'enable', 'disable', 'update:C:\\extensions\\neura-v2', 'rollback:neura', 'uninstall:neura']);
  });

  it('rejects invalid payloads and untrusted senders before dependencies run', async () => {
    const { ipc, calls } = setup();
    await expect(ipc.invoke(IpcChannel.extensionsEnable, { id: '../escape' })).rejects.toThrow('Invalid payload');
    await expect(ipc.invoke(IpcChannel.extensionsInstall, { sourcePath: '' })).rejects.toThrow('Invalid payload');
    await expect(ipc.invoke(IpcChannel.extensionsList, {}, 'https://evil.example')).rejects.toThrow('Untrusted sender');
    expect(calls).toEqual([]);
  });

  it('returns dependency failures without adding secret-bearing fields to lifecycle output', async () => {
    const registry = { list: () => { throw new Error('dependency_failed'); } } as unknown as ExtensionRegistry;
    const { ipc } = setup({ registry });
    await expect(ipc.invoke(IpcChannel.extensionsList, undefined)).rejects.toThrow('dependency_failed');
    const result = await ipc.invoke(IpcChannel.extensionsInstall, { sourcePath: 'safe-path' });
    expect(result).not.toHaveProperty('token');
    expect(result).not.toHaveProperty('password');
    expect(result).not.toHaveProperty('apiKey');
  });

  it('fails closed when the database-backed dependencies are unavailable', async () => {
    const { ipc } = setup({ registry: null, installer: null });
    await expect(ipc.invoke(IpcChannel.extensionsList, undefined)).resolves.toEqual([]);
    await expect(ipc.invoke(IpcChannel.extensionsEnable, { id: 'neura' })).rejects.toThrow('indisponível');
    await expect(ipc.invoke(IpcChannel.extensionsInstall, { sourcePath: 'safe-path' })).rejects.toThrow('indisponível');
  });

  it('accepts the optional previous manifest used by update and rollback', async () => {
    const result = { ...installed, previousManifest: manifest };
    const { ipc } = setup({}, { installerResult: result });

    await expect(ipc.invoke(IpcChannel.extensionsUpdate, { sourcePath: 'C:\\extensions\\neura-v2' })).resolves.toEqual(result);
    await expect(ipc.invoke(IpcChannel.extensionsRollback, { id: 'neura' })).resolves.toEqual(result);
  });

  it('rejects unknown fields from extension lifecycle responses', async () => {
    const { ipc } = setup({}, { installerResult: { ...installed, rootPath: 'C:\\Users\\test\\secret' } });

    await expect(ipc.invoke(IpcChannel.extensionsInstall, { sourcePath: 'safe-path' })).rejects.toThrow();
  });

  it('rejects malformed and secret-bearing lifecycle responses without echoing the secret', async () => {
    const secret = 'PAT-never-return-this-value';
    const { ipc } = setup({}, { installerResult: { ...installed, state: 'paused', token: secret } });
    let caught: unknown;

    try {
      await ipc.invoke(IpcChannel.extensionsInstall, { sourcePath: 'safe-path' });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(String(caught)).toContain('estado da extensão inválido');
    expect(String(caught)).not.toContain(secret);
  });

  it('rejects corrupted persisted registry state and sensitive entrypoint paths', async () => {
    const corrupted = { ...installed, manifest: { ...manifest, entrypoints: { main: 'C:\\private\\extension.js' } } };
    const { ipc } = setup({}, { registryList: [corrupted] });

    await expect(ipc.invoke(IpcChannel.extensionsList, undefined)).rejects.toThrow('estado da extensão inválido');
  });

  it('rejects unknown fields from the uninstall response', async () => {
    const { ipc } = setup({}, { uninstallResult: { removed: true, token: 'not-returned' } });

    await expect(ipc.invoke(IpcChannel.extensionsUninstall, { id: 'neura' })).rejects.toThrow();
  });
});
