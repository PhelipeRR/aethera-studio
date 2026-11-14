import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { backupDatabase, backupFileName, openDatabase } from '@neuralbridge/database';
import type { DatabaseStatus } from '@neuralbridge/shared';
import { describe, expect, it } from 'vitest';
import { createDatabaseRecovery } from '../src/main/database-recovery.js';
import { databaseFile, initDatabase } from '../src/main/database.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../../packages/database/migrations');

function setup() {
  const dataDir = mkdtempSync(join(tmpdir(), 'nb-recovery-'));
  const backupsDir = join(dataDir, 'backups', 'brain');
  const healthy = openDatabase(join(dataDir, 'healthy.db'), { migrationsFolder: MIGRATIONS });
  const good = backupFileName('auto', new Date('2026-11-01T10:00:00.000Z'));
  backupDatabase(healthy, join(backupsDir, good));
  healthy.close();
  const broken = backupFileName('manual', new Date('2026-11-02T10:00:00.000Z'));
  writeFileSync(join(backupsDir, broken), 'not a database at all, only bytes in the header area');
  mkdirSync(join(dataDir, 'db'), { recursive: true });
  writeFileSync(databaseFile(dataDir), 'garbage that is definitely not an sqlite header at all, padded');
  let status: DatabaseStatus = initDatabase(dataDir, MIGRATIONS, () => undefined).status;
  // A leftover write-ahead log from the session that broke must be preserved with the database.
  writeFileSync(`${databaseFile(dataDir)}-wal`, 'wal');
  const recovery = createDatabaseRecovery({ file: databaseFile(dataDir), backupsDir, status: () => status, now: () => new Date('2026-11-08T12:00:00.000Z') });
  return { dataDir, recovery, good, broken, setStatus: (next: DatabaseStatus) => { status = next; } };
}

describe('database recovery in degraded mode', () => {
  it('lists backups with their integrity check', () => {
    const { recovery, good, broken } = setup();
    const backups = recovery.backups();
    expect(backups.find((backup) => backup.name === good)).toMatchObject({ valid: true, problem: null });
    expect(backups.find((backup) => backup.name === broken)).toMatchObject({ valid: false, problem: expect.any(String) });
  });

  it('restores a verified backup, preserving the unusable files instead of deleting them', () => {
    const { dataDir, recovery, good } = setup();
    const { preservedAs } = recovery.restore(good);
    expect(preservedAs).toBe(join(dataDir, 'db', 'preserved', '2026-11-08T12-00-00-000Z'));
    expect(readFileSync(join(preservedAs, 'brain.db'), 'utf8')).toContain('garbage');
    expect(existsSync(join(preservedAs, 'brain.db-wal'))).toBe(true);
    expect(existsSync(`${databaseFile(dataDir)}-wal`)).toBe(false);
    const reopened = initDatabase(dataDir, MIGRATIONS, () => undefined);
    expect(reopened.status).toEqual({ ok: true, file: databaseFile(dataDir) });
    reopened.handle?.close();
  });

  it('refuses invalid names, damaged backups, and any restore while the database works', () => {
    const { dataDir, recovery, good, broken, setStatus } = setup();
    expect(() => recovery.restore('../../etc/passwd')).toThrow(/invalid/);
    expect(() => recovery.restore(broken)).toThrow(/Backup recusado/);
    expect(readFileSync(databaseFile(dataDir), 'utf8')).toContain('garbage');
    setStatus({ ok: true, file: databaseFile(dataDir) });
    expect(() => recovery.restore(good)).toThrow(/conflict/);
  });
});
