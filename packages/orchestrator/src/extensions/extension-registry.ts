import { installedExtensionSchema, type ExtensionManifest, type ExtensionState, type InstalledExtension } from '@neuralbridge/shared';
import { extensions, type DatabaseHandle } from '@neuralbridge/database';
import { eq } from 'drizzle-orm';

export interface ExtensionRegistry { list(): InstalledExtension[]; get(id: string): InstalledExtension | undefined; register(manifest: ExtensionManifest): InstalledExtension; registerBuiltIn(manifest: ExtensionManifest, defaultState: ExtensionState): InstalledExtension; disable(id: string): Promise<InstalledExtension>; enable(id: string): Promise<InstalledExtension>; rollback(id: string): Promise<InstalledExtension>; uninstall(id: string): Promise<{ removed: true }>; }

export function createExtensionRegistry(initial: InstalledExtension[] = []): ExtensionRegistry {
  const items = new Map(initial.map((item) => [item.manifest.id, { ...item }]));
  const now = () => new Date().toISOString();
  const change = (id: string, state: ExtensionState): InstalledExtension => { const item = items.get(id); if (!item) throw new Error('extension_not_found'); item.state = state; item.updatedAt = now(); return item; };
  return {
    list: () => [...items.values()], get: (id) => items.get(id),
    register: (manifest) => { const previous = items.get(manifest.id); const item: InstalledExtension = { manifest, state: previous?.state ?? 'enabled', installedAt: previous?.installedAt ?? now(), updatedAt: now(), ...(previous?.manifest ? { previousManifest: previous.manifest } : {}) }; items.set(manifest.id, item); return item; },
    registerBuiltIn: (manifest, defaultState) => { const existing = items.get(manifest.id); if (existing) return existing; const item: InstalledExtension = { manifest, state: defaultState, installedAt: now(), updatedAt: now() }; items.set(manifest.id, item); return item; },
    disable: async (id) => change(id, 'disabled'), enable: async (id) => change(id, 'enabled'),
    rollback: async (id) => { const item = items.get(id); if (!item?.previousManifest) throw new Error('extension_rollback_unavailable'); const current = item.manifest; item.manifest = item.previousManifest; item.previousManifest = current; item.updatedAt = now(); return item; },
    uninstall: async (id) => { if (!items.delete(id)) throw new Error('extension_not_found'); return { removed: true }; },
  };
}

export function createDatabaseExtensionRegistry(handle: DatabaseHandle): ExtensionRegistry {
  const persisted = handle.db.select().from(extensions).all().map((row) => {
    const manifest = JSON.parse(row.manifest) as ExtensionManifest;
    const previousManifest = row.previousManifest ? JSON.parse(row.previousManifest) as ExtensionManifest : undefined;
    return installedExtensionSchema.parse({ manifest, state: row.state, installedAt: row.installedAt, updatedAt: row.updatedAt, ...(previousManifest ? { previousManifest } : {}) });
  });
  const memory = createExtensionRegistry(persisted);
  const persist = (item: InstalledExtension) => {
    handle.db.insert(extensions).values({ id: item.manifest.id, manifest: JSON.stringify(item.manifest), state: item.state, installedAt: item.installedAt, updatedAt: item.updatedAt, previousManifest: item.previousManifest ? JSON.stringify(item.previousManifest) : null }).onConflictDoUpdate({ target: extensions.id, set: { manifest: JSON.stringify(item.manifest), state: item.state, updatedAt: item.updatedAt, previousManifest: item.previousManifest ? JSON.stringify(item.previousManifest) : null } }).run();
    return item;
  };
  return { list: () => memory.list(), get: (id) => memory.get(id), register: (manifest) => persist(memory.register(manifest)), registerBuiltIn: (manifest, defaultState) => persist(memory.registerBuiltIn(manifest, defaultState)), disable: async (id) => persist(await memory.disable(id)), enable: async (id) => persist(await memory.enable(id)), rollback: async (id) => persist(await memory.rollback(id)), uninstall: async (id) => { const result = await memory.uninstall(id); handle.db.delete(extensions).where(eq(extensions.id, id)).run(); return result; } };
}
