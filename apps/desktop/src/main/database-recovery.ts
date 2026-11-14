import { copyFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { isBackupFileName, listBackups, verifyBackup } from '@neuralbridge/database';
import type { DatabaseRecoveryBackup, DatabaseStatus } from '@neuralbridge/shared';

export interface DatabaseRecoveryOptions {
  /** The database file the app failed to open (`<data>/db/brain.db`). */
  file: string;
  backupsDir: string;
  status: () => DatabaseStatus;
  now?: () => Date;
}

const SIDE_FILES = ['', '-wal', '-shm', '-journal'];

/**
 * Recovery while the database is unavailable (degraded mode). Nothing is ever deleted: restoring moves
 * the unusable files to `db/preserved/<time>/` and copies a verified backup into place; the app then
 * restarts so every service opens the restored file from scratch.
 */
export function createDatabaseRecovery(options: DatabaseRecoveryOptions) {
  const now = options.now ?? (() => new Date());

  return {
    backups(): DatabaseRecoveryBackup[] {
      return listBackups(options.backupsDir).map((backup) => {
        const check = verifyBackup(backup.file);
        return { name: backup.name, createdAt: backup.createdAt, sizeBytes: backup.sizeBytes, kind: backup.kind, valid: check.ok, problem: check.ok ? null : check.error };
      });
    },

    restore(name: string): { preservedAs: string } {
      if (options.status().ok) throw new Error('conflict: O banco de dados está funcionando; use Configurações › Backups para restaurar.');
      if (!isBackupFileName(name)) throw new Error('invalid: Nome de backup inválido.');
      const source = listBackups(options.backupsDir).find((entry) => entry.name === name);
      if (!source) throw new Error('not_found: Backup não encontrado.');
      const check = verifyBackup(source.file);
      if (!check.ok) throw new Error(`invalid: Backup recusado: ${check.error}`);
      const preservedAs = join(dirname(options.file), 'preserved', now().toISOString().replace(/[:.]/g, '-'));
      mkdirSync(preservedAs, { recursive: true });
      for (const suffix of SIDE_FILES) {
        const current = `${options.file}${suffix}`;
        if (existsSync(current)) renameSync(current, join(preservedAs, basename(current)));
      }
      copyFileSync(source.file, options.file);
      return { preservedAs };
    },
  };
}

export type DatabaseRecovery = ReturnType<typeof createDatabaseRecovery>;
