import { createHash, randomUUID } from 'node:crypto';
import { access, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve, join, normalize } from 'node:path';
import { EXTENSION_MAX_FILE_COUNT, EXTENSION_MAX_PACKAGE_BYTES, extensionManifestSchema, extensionVersionCompare, extensionVersionSatisfiesCore, type ExtensionPackage, type InstalledExtension } from '@neuralbridge/shared';
import type { ExtensionRegistry } from './extension-registry.js';

export interface ExtensionInstaller { install(pkg: ExtensionPackage): Promise<InstalledExtension>; installDirectory(source: string): Promise<InstalledExtension>; update(pkg: ExtensionPackage): Promise<InstalledExtension>; updateDirectory(source: string): Promise<InstalledExtension>; rollback(id: string): Promise<InstalledExtension>; uninstall(id: string): Promise<{ removed: true }>; }
export function createExtensionInstaller(input: { coreVersion: string; registry: ExtensionRegistry; verifySignature: (manifest: ExtensionPackage['manifest']) => boolean; installRoot?: string; activate?: (manifest: ExtensionPackage['manifest'], root?: string) => Promise<void> }): ExtensionInstaller {
  const verify = (pkg: ExtensionPackage) => {
    const manifest = extensionManifestSchema.parse(pkg.manifest);
    if (!extensionVersionSatisfiesCore(input.coreVersion, manifest.minCoreVersion)) throw new Error('extension_core_incompatible');
    if (!input.verifySignature(manifest)) throw new Error('extension_signature_invalid');
    if (pkg.files.length === 0 || pkg.files.length > EXTENSION_MAX_FILE_COUNT) throw new Error('extension_file_count_invalid');
    const seen = new Set<string>(); let bytes = 0;
    for (const file of pkg.files) {
      if (seen.has(file.path) || isAbsolute(file.path) || file.path.includes('\\') || normalize(file.path).startsWith('..')) throw new Error('extension_path_invalid');
      seen.add(file.path); bytes += Buffer.byteLength(file.content, 'utf8');
    }
    if (bytes > EXTENSION_MAX_PACKAGE_BYTES) throw new Error('extension_package_too_large');
    const allowed = new Set([manifest.entrypoints.main, ...(manifest.entrypoints.renderer ? [manifest.entrypoints.renderer] : [])]);
    if (pkg.files.some((file) => !allowed.has(file.path))) throw new Error('extension_unexpected_file');
    if (!seen.has(manifest.entrypoints.main)) throw new Error('extension_entrypoint_missing');
    const hash = createHash('sha256'); for (const file of [...pkg.files].sort((a, b) => a.path.localeCompare(b.path))) hash.update(file.path).update('\0').update(file.content);
    if (`sha256:${hash.digest('hex')}` !== manifest.checksum) throw new Error('extension_checksum_invalid');
    return manifest;
  };
  const writePackage = async (pkg: ExtensionPackage, manifest: ExtensionPackage['manifest']) => {
    if (!input.installRoot) return;
    const versionRoot = resolve(input.installRoot, manifest.id, manifest.version);
    const stagingRoot = resolve(input.installRoot, '.staging', `${manifest.id}-${manifest.version}-${randomUUID()}`);
    try {
      await mkdir(stagingRoot, { recursive: true });
      for (const file of pkg.files) {
        if (isAbsolute(file.path)) throw new Error('extension_path_invalid');
        const target = resolve(stagingRoot, file.path);
        if (relative(stagingRoot, target).startsWith('..')) throw new Error('extension_path_invalid');
        await mkdir(resolve(target, '..'), { recursive: true });
        await writeFile(target, file.content, 'utf8');
      }
      await mkdir(resolve(versionRoot, '..'), { recursive: true });
      await rename(stagingRoot, versionRoot);
    } finally {
      await rm(stagingRoot, { recursive: true, force: true });
    }
  };
  const activate = async (manifest: ExtensionPackage['manifest']) => { if (input.activate) await input.activate(manifest, input.installRoot ? resolve(input.installRoot, manifest.id, manifest.version) : undefined); };
  const install = async (pkg: ExtensionPackage) => { const manifest = verify(pkg); if (input.registry.get(manifest.id)) throw new Error('extension_already_installed'); await writePackage(pkg, manifest); try { await activate(manifest); return input.registry.register(manifest); } catch (error) { if (input.installRoot) await rm(resolve(input.installRoot, manifest.id, manifest.version), { recursive: true, force: true }); throw error; } };
  const readDirectory = async (source: string): Promise<ExtensionPackage> => {
    if ((await lstat(source)).isSymbolicLink()) throw new Error('extension_symlink_forbidden');
    const manifest = JSON.parse(await readFile(join(source, 'extension.json'), 'utf8')) as ExtensionPackage['manifest'];
    const files: ExtensionPackage['files'] = [];
    const walk = async (directory: string) => { for (const entry of await readdir(directory, { withFileTypes: true })) { if (entry.isSymbolicLink()) throw new Error('extension_symlink_forbidden'); const absolute = join(directory, entry.name); const path = relative(source, absolute).replaceAll('\\', '/'); if (entry.isDirectory()) await walk(absolute); else if (path !== 'extension.json') files.push({ path, content: await readFile(absolute, 'utf8') }); } };
    await walk(source); return { manifest, files };
  };
  const update = async (pkg: ExtensionPackage) => { const manifest = verify(pkg); const current = input.registry.get(manifest.id); if (!current) throw new Error('extension_not_found'); if (extensionVersionCompare(manifest.version, current.manifest.version) <= 0) throw new Error('extension_downgrade_or_unchanged'); await writePackage(pkg, manifest); try { await activate(manifest); return input.registry.register(manifest); } catch (error) { if (input.installRoot) await rm(resolve(input.installRoot, manifest.id, manifest.version), { recursive: true, force: true }); throw error; } };
  return { install, installDirectory: async (source) => install(await readDirectory(source)), update, updateDirectory: async (source) => update(await readDirectory(source)), rollback: async (id) => { const item = input.registry.get(id); const previous = item?.previousManifest; if (!previous) throw new Error('extension_rollback_unavailable'); if (input.installRoot) await access(resolve(input.installRoot, id, previous.version)); await activate(previous); return input.registry.rollback(id); }, uninstall: async (id) => { const item = input.registry.get(id); if (!item) throw new Error('extension_not_found'); if (input.installRoot) { await rm(resolve(input.installRoot, id, item.manifest.version), { recursive: true, force: true }); if (item.previousManifest) await rm(resolve(input.installRoot, id, item.previousManifest.version), { recursive: true, force: true }); } return input.registry.uninstall(id); } };
}
