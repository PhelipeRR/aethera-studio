import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BackupInfo } from '@neuralbridge/shared';
import type { DatabaseHandle } from './open.js';

type BackupKind = BackupInfo['kind'];
const KINDS: BackupKind[] = ['auto', 'manual', 'before-restore'];
// neuralbridge-2026-10-28T12-00-00-000Z-auto.db: sortable, Windows-safe (no colons), kind in the name.
const NAME = /^neuralbridge-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z-(auto|manual|before-restore)\.db$/;

export function backupFileName(kind: BackupKind, at: Date = new Date()): string {
  return `neuralbridge-${at.toISOString().replace(/[:.]/g, '-')}-${kind}.db`;
}

/**
 * Consistent copy of the live database (VACUUM INTO: a single snapshot, compacted, safe while the app
 * and MCP servers keep writing). Never overwrites an existing file.
 */
export function backupDatabase(handle: DatabaseHandle, file: string): void {
  if (existsSync(file)) throw new Error(`Backup file already exists: ${file}`);
  mkdirSync(dirname(file), { recursive: true });
  handle.sqlite.prepare('VACUUM INTO ?').run(file);
}

export type BackupCheck = { ok: true; memories: number } | { ok: false; error: string };

/** Opens a backup read-only and checks it is an intact NeuralBridge database. */
export function verifyBackup(file: string): BackupCheck {
  if (!existsSync(file)) return { ok: false, error: 'Arquivo não encontrado.' };
  let db: Database.Database | undefined;
  try {
    db = new Database(file, { readonly: true, fileMustExist: true });
    const integrity = db.pragma('integrity_check', { simple: true });
    if (integrity !== 'ok') return { ok: false, error: `O arquivo está danificado (${String(integrity)}).` };
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name));
    if (!['memories', 'links', 'projects', 'memories_fts'].every((table) => tables.has(table))) return { ok: false, error: 'Não é um backup do NeuralBridge.' };
    const { n } = db.prepare('SELECT count(*) AS n FROM memories').get() as { n: number };
    return { ok: true, memories: n };
  } catch (error) {
    return { ok: false, error: `Não é um backup do NeuralBridge válido (${error instanceof Error ? error.message : String(error)}).` };
  } finally {
    db?.close();
  }
}

/**
 * Replaces the contents of the open database with a backup, through SQLite's online backup API: the
 * open connections (app, MCP servers) see the restored data without reopening. Migrations then bring
 * an older backup up to the current schema. The caller makes a safety backup first.
 */
export async function restoreDatabase(handle: DatabaseHandle, backupFile: string, options: { migrationsFolder: string }): Promise<void> {
  const check = verifyBackup(backupFile);
  if (!check.ok) throw new Error(`Backup recusado: ${check.error}`);
  const source = new Database(backupFile, { readonly: true, fileMustExist: true });
  try {
    await source.backup(handle.file);
  } finally {
    source.close();
  }
  migrate(handle.db, { migrationsFolder: options.migrationsFolder });
}

export function listBackups(dir: string): BackupInfo[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .flatMap((name): BackupInfo[] => {
      const match = NAME.exec(name);
      if (!match) return [];
      const [, day, hour, minute, second, ms, kind] = match;
      const file = join(dir, name);
      return [{ file, name, sizeBytes: statSync(file).size, createdAt: `${day}T${hour}:${minute}:${second}.${ms}Z`, kind: kind as BackupKind }];
    })
    .filter((backup) => KINDS.includes(backup.kind))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Deletes the oldest automatic backups beyond `keep`; manual and pre-restore backups are the user's. */
export function pruneBackups(dir: string, keep: number): number {
  const old = listBackups(dir)
    .filter((backup) => backup.kind === 'auto')
    .slice(keep);
  for (const backup of old) rmSync(backup.file, { force: true });
  return old.length;
}

export function isBackupFileName(file: string): boolean {
  return NAME.test(basename(file));
}
