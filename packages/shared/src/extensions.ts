import { z } from 'zod';

export const extensionPermissionSchema = z.enum(['tasks.read', 'tasks.write', 'navigation', 'settings', 'artifacts', 'diagnostics', 'personal.read', 'personal.write']);
export const extensionCapabilitySchema = z.enum(['commands', 'navigation', 'tasks', 'artifacts', 'renderer', 'settings', 'diagnostics']);
export const extensionEntrypointPathSchema = z.string().min(1).max(512).refine((value) => {
  const normalized = value.replaceAll('\\', '/');
  return !value.includes('\\') && !normalized.startsWith('/') && !/^[A-Za-z]:/u.test(normalized) && !normalized.split('/').some((part) => part === '.' || part === '..');
}, 'extension entrypoint must be a relative path');
export const extensionManifestSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().regex(/^[a-z][a-z0-9-]{1,63}$/), name: z.string().min(1), version: z.string().regex(/^\d+\.\d+\.\d+$/),
  minCoreVersion: z.string().regex(/^\d+\.\d+\.\d+$/), capabilities: z.array(extensionCapabilitySchema).max(32), permissions: z.array(extensionPermissionSchema).max(32),
  entrypoints: z.strictObject({ main: extensionEntrypointPathSchema, renderer: extensionEntrypointPathSchema.optional() }), checksum: z.string().regex(/^sha256:[0-9a-f]{64}$/),
  signature: z.strictObject({ algorithm: z.literal('sha256'), value: z.string().min(1).max(512) }), updateChannel: z.enum(['stable', 'beta', 'local']),
});
export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;
const BUILTIN_CHECKSUM = `sha256:${'0'.repeat(64)}`;
const BUILTIN_SIGNATURE = { algorithm: 'sha256' as const, value: 'builtin' };

/** Built-ins use the same registry and lifecycle as user-installed extensions, but have no package files to install. */
export const BUILTIN_EXTENSION_MANIFESTS: Record<'companion' | 'spotify' | 'personal-agent', ExtensionManifest> = {
  companion: {
    schemaVersion: 1, id: 'companion', name: 'Companion', version: '1.0.0', minCoreVersion: '0.1.0',
    capabilities: ['navigation', 'renderer', 'settings'], permissions: ['navigation', 'settings'],
    entrypoints: { main: 'src/index.ts' }, checksum: BUILTIN_CHECKSUM, signature: BUILTIN_SIGNATURE, updateChannel: 'stable',
  },
  spotify: {
    schemaVersion: 1, id: 'spotify', name: 'Spotify', version: '1.0.0', minCoreVersion: '0.1.0',
    capabilities: ['commands', 'renderer', 'settings'], permissions: ['navigation', 'settings'],
    entrypoints: { main: 'src/index.ts' }, checksum: BUILTIN_CHECKSUM, signature: BUILTIN_SIGNATURE, updateChannel: 'stable',
  },
  'personal-agent': {
    schemaVersion: 1, id: 'personal-agent', name: 'Void Pessoal', version: '1.0.0', minCoreVersion: '0.1.0',
    capabilities: ['commands', 'navigation', 'settings'], permissions: ['personal.read', 'personal.write', 'navigation', 'settings'],
    entrypoints: { main: 'src/index.ts', renderer: 'src/renderer.tsx' }, checksum: BUILTIN_CHECKSUM, signature: BUILTIN_SIGNATURE, updateChannel: 'stable',
  },
};
export const extensionStateSchema = z.enum(['enabled', 'disabled']);
export type ExtensionState = z.infer<typeof extensionStateSchema>;
// Timestamps remain non-empty strings for compatibility with persisted records from older cores.
export const installedExtensionSchema = z.strictObject({
  manifest: extensionManifestSchema,
  state: extensionStateSchema,
  installedAt: z.string().min(1).max(200),
  updatedAt: z.string().min(1).max(200),
  previousManifest: extensionManifestSchema.optional(),
});
export type InstalledExtension = z.infer<typeof installedExtensionSchema>;
export const extensionUninstallResultSchema = z.strictObject({ removed: z.literal(true) });
export type ExtensionUninstallResult = z.infer<typeof extensionUninstallResultSchema>;
export interface ExtensionPackage { manifest: ExtensionManifest; files: Array<{ path: string; content: string }>; }
export const EXTENSION_MAX_PACKAGE_BYTES = 10 * 1024 * 1024;
export const EXTENSION_MAX_FILE_COUNT = 256;
export function extensionCapabilityAllowed(manifest: ExtensionManifest, capability: string): boolean {
  return manifest.capabilities.includes(capability as ExtensionManifest['capabilities'][number]);
}
export function extensionVersionSatisfiesCore(core: string, minimum: string): boolean {
  const [amajor = 0, aminor = 0, apatch = 0] = core.split('.').map(Number); const [bmajor = 0, bminor = 0, bpatch = 0] = minimum.split('.').map(Number);
  return amajor > bmajor || (amajor === bmajor && (aminor > bminor || (aminor === bminor && apatch >= bpatch)));
}
export function extensionVersionCompare(left: string, right: string): number {
  const a = left.split('.').map(Number); const b = right.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) { const delta = (a[i] ?? 0) - (b[i] ?? 0); if (delta !== 0) return delta; }
  return 0;
}
