import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { createDatabaseExtensionRegistry, createExtensionRegistry } from '../src/extensions/extension-registry.js';
import { createExtensionInstaller } from '../src/extensions/extension-installer.js';
import type { ExtensionPackage } from '@neuralbridge/shared';
import { openDatabase } from '@neuralbridge/database';
import { resolve } from 'node:path';
import { readFile as readTextFile } from 'node:fs/promises';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BUILTIN_EXTENSION_MANIFESTS } from '@neuralbridge/shared';

const packageInput: ExtensionPackage = {
  manifest: {
    schemaVersion: 1 as const, id: 'neura', name: 'Neura', version: '1.0.0', minCoreVersion: '0.1.0',
    capabilities: ['navigation'], permissions: ['tasks.read'],
    entrypoints: { main: 'main.js' }, checksum: 'sha256:' + 'a'.repeat(64),
    signature: { algorithm: 'sha256', value: 'sig' }, updateChannel: 'stable',
  },
  files: [{ path: 'main.js', content: 'export default {}' }],
};
packageInput.manifest.checksum = `sha256:${createHash('sha256').update('main.js').update('\0').update('export default {}').digest('hex')}`;

describe('extension platform', () => {
  it('registers built-ins with a new-install default without overriding existing state', () => {
    const registry = createExtensionRegistry();
    const companion = registry.registerBuiltIn(BUILTIN_EXTENSION_MANIFESTS.companion, 'disabled');
    expect(companion.state).toBe('disabled');
    void registry.enable('companion');
    const preserved = registry.registerBuiltIn(BUILTIN_EXTENSION_MANIFESTS.companion, 'disabled');
    expect(preserved.state).toBe('enabled');
  });

  it('ships independent Neura and Velix extension manifests', async () => {
    for (const id of ['neura', 'velix']) {
      const manifest = JSON.parse(await readTextFile(resolve(import.meta.dirname, `../../extensions-${id}/extension.json`), 'utf8')) as { id: string; schemaVersion: number; minCoreVersion: string; entrypoints: { main: string } };
      expect(manifest).toMatchObject({ id, schemaVersion: 1, minCoreVersion: '0.1.0' });
      expect(manifest.entrypoints.main).toBe('src/index.ts');
    }
  });
  it('packs every shipped extension into a folder the app installs (checksum and signature current)', async () => {
    // What `npm run extension:pack -- <id>` produces: extension.json plus only the entrypoint files.
    for (const id of ['neura', 'velix']) {
      const source = resolve(import.meta.dirname, `../../extensions-${id}`);
      const manifest = JSON.parse(await readTextFile(join(source, 'extension.json'), 'utf8')) as ExtensionPackage['manifest'];
      const folder = await mkdtemp(join(tmpdir(), `nb-pack-${id}-`));
      await writeFile(join(folder, 'extension.json'), JSON.stringify(manifest));
      await mkdir(join(folder, 'src'), { recursive: true });
      await writeFile(join(folder, manifest.entrypoints.main), await readTextFile(join(source, manifest.entrypoints.main), 'utf8'));
      // The app's own signature rule (apps/desktop/src/main/index.ts).
      const installer = createExtensionInstaller({ coreVersion: '0.1.59', registry: createExtensionRegistry(), verifySignature: (item) => item.signature.value === item.checksum.slice('sha256:'.length) });
      await expect(installer.installDirectory(folder)).resolves.toMatchObject({ manifest: { id } });
    }
  });

  it('installs, disables, updates and rolls back without losing the prior version', async () => {
    const registry = createExtensionRegistry();
    const installer = createExtensionInstaller({ coreVersion: '0.1.0', registry, verifySignature: () => true });
    await installer.install(packageInput);
    expect(registry.get('neura')?.state).toBe('enabled');
    await registry.disable('neura');
    expect(registry.get('neura')?.state).toBe('disabled');
    await installer.update({ ...packageInput, manifest: { ...packageInput.manifest, version: '1.1.0' } });
    expect(registry.get('neura')?.manifest.version).toBe('1.1.0');
    await installer.rollback('neura');
    expect(registry.get('neura')?.manifest.version).toBe('1.0.0');
  });

  it('rejects a corrupt package before activation', async () => {
    const registry = createExtensionRegistry();
    const installer = createExtensionInstaller({ coreVersion: '0.1.0', registry, verifySignature: () => true });
    await expect(installer.install({ ...packageInput, manifest: { ...packageInput.manifest, checksum: 'sha256:' + 'b'.repeat(64) } })).rejects.toThrow('checksum');
    expect(registry.list()).toHaveLength(0);
  });

  it('rejects a package when the signature verifier fails', async () => {
    const registry = createExtensionRegistry();
    const installer = createExtensionInstaller({ coreVersion: '0.1.0', registry, verifySignature: () => false });
    await expect(installer.install(packageInput)).rejects.toThrow('signature');
    expect(registry.list()).toHaveLength(0);
  });

  it('installs a local package into an isolated version directory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neuralbridge-extension-'));
    const registry = createExtensionRegistry();
    const installer = createExtensionInstaller({ coreVersion: '0.1.0', registry, installRoot: root, verifySignature: () => true });
    await installer.install(packageInput);
    expect(await readFile(join(root, 'neura', '1.0.0', 'main.js'), 'utf8')).toBe('export default {}');
  });

  it('rejects a downgrade and path traversal before activation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neuralbridge-extension-'));
    const registry = createExtensionRegistry();
    const installer = createExtensionInstaller({ coreVersion: '0.1.0', registry, installRoot: root, verifySignature: () => true });
    await installer.install(packageInput);
    await expect(installer.update({ ...packageInput, manifest: { ...packageInput.manifest, version: '0.9.0' } })).rejects.toThrow('downgrade');
    const traversalChecksum = `sha256:${createHash('sha256').update('../escape.js').update('\0').update('bad').digest('hex')}`;
    await expect(installer.install({ ...packageInput, manifest: { ...packageInput.manifest, id: 'velix', checksum: traversalChecksum }, files: [{ path: '../escape.js', content: 'bad' }] })).rejects.toThrow('path');
  });

  it('reloads extension state from SQLite', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neuralbridge-extension-db-'));
    const handle = openDatabase(join(root, 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../../database/migrations') });
    const registry = createDatabaseExtensionRegistry(handle);
    const installer = createExtensionInstaller({ coreVersion: '0.1.0', registry, verifySignature: () => true });
    await installer.install(packageInput);
    await registry.disable('neura');
    await installer.update({ ...packageInput, manifest: { ...packageInput.manifest, version: '1.1.0' } });
    handle.close();
    const reopened = openDatabase(join(root, 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../../database/migrations') });
    const reopenedRegistry = createDatabaseExtensionRegistry(reopened);
    expect(reopenedRegistry.get('neura')).toMatchObject({ state: 'disabled', manifest: { version: '1.1.0' }, previousManifest: { version: '1.0.0' } });
    reopened.close();
  });

  it('loads a local extension directory from extension.json', async () => {
    const source = await mkdtemp(join(tmpdir(), 'neuralbridge-extension-source-'));
    await writeFile(join(source, 'extension.json'), JSON.stringify(packageInput.manifest));
    await writeFile(join(source, 'main.js'), 'export default {}');
    const root = await mkdtemp(join(tmpdir(), 'neuralbridge-extension-install-'));
    const registry = createExtensionRegistry();
    const installer = createExtensionInstaller({ coreVersion: '0.1.0', registry, installRoot: root, verifySignature: () => true });
    await installer.installDirectory(source);
    expect(await readFile(join(root, 'neura', '1.0.0', 'main.js'), 'utf8')).toBe('export default {}');
  });

  it('normalizes nested local entrypoint paths on Windows before validating the package', async () => {
    const source = await mkdtemp(join(tmpdir(), 'neuralbridge-extension-nested-source-'));
    const content = 'export default {}';
    const checksum = `sha256:${createHash('sha256').update('src/main.js').update('\0').update(content).digest('hex')}`;
    await writeFile(join(source, 'extension.json'), JSON.stringify({ ...packageInput.manifest, entrypoints: { main: 'src/main.js' }, checksum }));
    await mkdir(join(source, 'src'));
    await writeFile(join(source, 'src', 'main.js'), content);
    const root = await mkdtemp(join(tmpdir(), 'neuralbridge-extension-nested-install-'));
    const registry = createExtensionRegistry();
    const installer = createExtensionInstaller({ coreVersion: '0.1.0', registry, installRoot: root, verifySignature: () => true });
    await installer.installDirectory(source);
    expect(await readFile(join(root, 'neura', '1.0.0', 'src', 'main.js'), 'utf8')).toBe(content);
  });

  it('activates the previous version when rolling back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neuralbridge-extension-rollback-'));
    const registry = createExtensionRegistry();
    const activated: string[] = [];
    const installer = createExtensionInstaller({ coreVersion: '0.1.0', registry, installRoot: root, verifySignature: () => true, activate: async (manifest) => { activated.push(manifest.version); } });
    await installer.install(packageInput);
    await installer.update({ ...packageInput, manifest: { ...packageInput.manifest, version: '1.1.0' } });
    await installer.rollback('neura');
    expect(activated).toEqual(['1.0.0', '1.1.0', '1.0.0']);
    expect(registry.get('neura')?.manifest.version).toBe('1.0.0');
  });

  it('rejects symlinked extension sources before reading outside files', async () => {
    const source = await mkdtemp(join(tmpdir(), 'neuralbridge-extension-source-'));
    await writeFile(join(source, 'extension.json'), JSON.stringify(packageInput.manifest));
    const outside = await mkdtemp(join(tmpdir(), 'neuralbridge-extension-outside-'));
    await writeFile(join(outside, 'secret.js'), 'export const secret = true');
    symlinkSync(join(outside, 'secret.js'), join(source, 'secret.js'), 'junction');
    const installer = createExtensionInstaller({ coreVersion: '0.1.0', registry: createExtensionRegistry(), verifySignature: () => true });
    await expect(installer.installDirectory(source)).rejects.toThrow('symlink');
  });

  it('rejects undeclared files and rolls back an activation failure atomically', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neuralbridge-extension-hardening-'));
    const registry = createExtensionRegistry();
    const installer = createExtensionInstaller({ coreVersion: '0.1.0', registry, installRoot: root, verifySignature: () => true, activate: async () => { throw new Error('activation_failed'); } });
    await expect(installer.install({ ...packageInput, files: [...packageInput.files, { path: 'secret.txt', content: 'no' }], manifest: { ...packageInput.manifest, checksum: 'sha256:' + 'c'.repeat(64) } })).rejects.toThrow('unexpected_file');
    const extra = { ...packageInput, files: [...packageInput.files, { path: 'secret.txt', content: 'no' }] };
    extra.manifest = { ...extra.manifest, checksum: `sha256:${createHash('sha256').update('main.js').update('\0').update('export default {}').update('secret.txt').update('\0').update('no').digest('hex')}` };
    await expect(installer.install(extra)).rejects.toThrow('unexpected_file');
    await expect(installer.install(packageInput)).rejects.toThrow('activation_failed');
    expect(registry.list()).toHaveLength(0);
    await expect(readFile(join(root, 'neura', '1.0.0', 'main.js'), 'utf8')).rejects.toThrow();
  });

  it('preserves user data when uninstalling an extension', async () => {
    const root = await mkdtemp(join(tmpdir(), 'neuralbridge-extension-user-data-'));
    const registry = createExtensionRegistry();
    const installer = createExtensionInstaller({ coreVersion: '0.1.0', registry, installRoot: root, verifySignature: () => true });
    await installer.install(packageInput);
    await writeFile(join(root, 'neura', 'user-data.json'), '{"keep":true}');
    await installer.uninstall('neura');
    expect(await readFile(join(root, 'neura', 'user-data.json'), 'utf8')).toContain('keep');
  });
});
