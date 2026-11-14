import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export const APP_DIR_NAME = 'NeuralBridge';

/**
 * Where NeuralBridge keeps its data (database, models, backups, logs).
 * Shared by the Electron app and the standalone MCP server, which has no `app.getPath`.
 */
export function resolveDataDir(env: Record<string, string | undefined> = process.env): string {
  const override = env['NB_DATA_DIR'];
  if (override) return override;
  const appData = env['APPDATA'];
  if (!appData) throw new Error('Cannot resolve the data directory: APPDATA is not set and NB_DATA_DIR was not provided.');
  return migrateLegacyDataDir(join(appData, APP_DIR_NAME), join(appData, 'Singularity'));
}

/**
 * M2: copy the legacy tree once, never move or delete the source, and fail closed to the legacy path.
 *
 * Two guards keep every process on the same directory:
 * - a database still open in the legacy tree (another process such as the MCP server or a standalone Core holds it)
 *   defers the copy. The caller keeps the legacy path this time; the copy happens on a later start, once it is closed;
 * - when another process wins the race and renames its staging copy first, this one adopts that copy instead of
 *   falling back to the legacy tree.
 */
export function migrateLegacyDataDir(legacyDir: string, targetDir: string): string {
  if (existsSync(targetDir) || !existsSync(legacyDir)) return existsSync(targetDir) ? targetDir : legacyDir;
  const openDatabase = findOpenDatabase(legacyDir);
  if (openDatabase) {
    console.error(`[paths] data directory migration deferred: ${openDatabase} is open`);
    return legacyDir;
  }
  const targetParent = dirname(targetDir);
  let stagingDir: string | undefined;
  try {
    mkdirSync(targetParent, { recursive: true });
    stagingDir = mkdtempSync(join(targetParent, '.singularity-migration-'));
    // The staging directory is intentionally created before copying. `errorOnExist` would
    // reject that directory itself before the contents could be copied; the destination is
    // unique and is never user-selected, so the hash verification below remains the guard.
    cpSync(legacyDir, stagingDir, { recursive: true, force: false });
    const sourceFiles = fileHashes(legacyDir);
    const targetFiles = fileHashes(stagingDir);
    if (sourceFiles.size !== targetFiles.size || [...sourceFiles].some(([file, hash]) => targetFiles.get(file) !== hash)) throw new Error('data copy verification failed');
    writeFileSync(join(stagingDir, 'migrated-from.json'), JSON.stringify({ from: legacyDir, at: new Date().toISOString(), files: sourceFiles.size }) + '\n', { encoding: 'utf8', flag: 'wx' });
    renameSync(stagingDir, targetDir);
    stagingDir = undefined;
    return targetDir;
  } catch (error) {
    if (stagingDir) {
      try { rmSync(stagingDir, { recursive: true, force: true }); } catch { /* preserve the legacy source even if cleanup fails */ }
    }
    // Another process finished the same migration first: use its verified copy, so both write to one directory.
    if (existsSync(join(targetDir, 'migrated-from.json'))) return targetDir;
    console.error(`[paths] keeping legacy data directory after migration failure: ${error instanceof Error ? error.message : String(error)}`);
    return legacyDir;
  }
}

/**
 * A SQLite database in WAL mode is open while its `-shm` file is in use. A leftover `-wal`/`-shm` alone proves nothing
 * (SQLite and Chromium leave them after a clean close), so the probe renames the `-shm` and puts it back: on Windows
 * SQLite opens it without delete sharing, so the rename fails exactly while another process holds the database. The
 * `-shm` is only an index SQLite rebuilds, so the probe cannot damage data even if it is interrupted.
 */
function findOpenDatabase(root: string): string | null {
  for (const entry of readdirSync(root, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile() || !entry.name.endsWith('-shm')) continue;
    const file = join(entry.parentPath, entry.name);
    const probe = `${file}.m2-probe`;
    try {
      renameSync(file, probe);
      renameSync(probe, file);
    } catch {
      return relative(root, file).replaceAll('\\', '/');
    }
  }
  return null;
}

function fileHashes(root: string): Map<string, string> {
  const result = new Map<string, string>();
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile()) result.set(relative(root, full).replaceAll('\\', '/'), createHash('sha256').update(readFileSync(full)).digest('hex'));
    }
  };
  visit(root);
  return result;
}
