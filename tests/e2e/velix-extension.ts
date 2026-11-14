import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { extensions, openDatabase } from '@neuralbridge/database';
import { freshDataDir } from './app';

// Velix is an extension: a fresh install hides its navigation until the extension is installed and enabled.
// This registers a minimal, valid local Velix extension in the data dir before the app starts.
export function registerVelixExtension(dataDir: string): void {
  const root = join(dataDir, 'velix-extension');
  const content = 'export default {}';
  const checksum = createHash('sha256').update('main.js').update('\0').update(content).digest('hex');
  const manifest = { schemaVersion: 1, id: 'velix', name: 'Velix', version: '1.0.0', minCoreVersion: '0.1.0', capabilities: ['navigation'], permissions: ['navigation'], entrypoints: { main: 'main.js' }, checksum: `sha256:${checksum}`, signature: { algorithm: 'sha256', value: checksum }, updateChannel: 'local' };
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'extension.json'), JSON.stringify(manifest));
  writeFileSync(join(root, 'main.js'), content);
  const handle = openDatabase(join(dataDir, 'db', 'brain.db'), { migrationsFolder: resolve(import.meta.dirname, '../../packages/database/migrations') });
  const now = new Date().toISOString();
  handle.db.insert(extensions).values({ id: manifest.id, manifest: JSON.stringify(manifest), state: 'enabled', installedAt: now, updatedAt: now, previousManifest: null }).onConflictDoNothing().run();
  handle.close();
}

/** A fresh, isolated data dir where Velix is already installed and enabled, for specs that exercise Velix screens. */
export function velixDataDir(): string {
  const dataDir = freshDataDir();
  registerVelixExtension(dataDir);
  return dataDir;
}
