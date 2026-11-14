import { describe, expect, it } from 'vitest';
import { extensionManifestSchema, extensionPermissionSchema, extensionVersionSatisfiesCore, installedExtensionSchema } from '../src/extensions.js';

const manifest = {
  schemaVersion: 1,
  id: 'neura',
  name: 'Neura',
  version: '1.2.0',
  minCoreVersion: '0.1.0',
  capabilities: ['navigation', 'commands'],
  permissions: ['tasks.read'],
  entrypoints: { main: 'dist/main.js', renderer: 'dist/renderer.js' },
  checksum: 'sha256:' + 'a'.repeat(64),
  signature: { algorithm: 'sha256', value: 'sig' },
  updateChannel: 'stable',
};

describe('extension contracts', () => {
  it('parses a versioned manifest and exposes permission contracts', () => {
    expect(extensionManifestSchema.parse(manifest).id).toBe('neura');
    expect(extensionPermissionSchema.parse('tasks.read')).toBe('tasks.read');
  });

  it('rejects an extension requiring a newer core', () => {
    expect(extensionVersionSatisfiesCore('0.1.0', '0.2.0')).toBe(false);
    expect(extensionVersionSatisfiesCore('0.2.1', '0.2.0')).toBe(true);
  });

  it('rejects unknown manifest fields and unsafe entrypoint paths', () => {
    expect(() => extensionManifestSchema.parse({ ...manifest, publisherSecret: 'nope' })).toThrow();
    expect(() => extensionManifestSchema.parse({ ...manifest, entrypoints: { main: 'C:\\private\\main.js' } })).toThrow();
    expect(() => extensionManifestSchema.parse({ ...manifest, entrypoints: { main: '../private/main.js' } })).toThrow();
  });

  it('rejects incomplete installed state and accepts a previous manifest', () => {
    expect(() => installedExtensionSchema.parse({ manifest, state: 'enabled', installedAt: '' })).toThrow();
    expect(installedExtensionSchema.parse({ manifest, state: 'enabled', installedAt: '2026-11-06T00:00:00.000Z', updatedAt: '2026-11-06T00:00:00.000Z', previousManifest: manifest }).previousManifest?.id).toBe('neura');
  });
});
