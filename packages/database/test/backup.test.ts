import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { backupDatabase, backupFileName, listBackups, pruneBackups, restoreDatabase, verifyBackup } from '../src/backup.js';
import { links, memories, openDatabase, projects, type DatabaseHandle } from '../src/index.js';

/** Fails the test (instead of a TypeError) when an expected value is missing. */
function present<T>(value: T | null | undefined): T {
  expect(value).toBeTruthy();
  return value as T;
}

const MIGRATIONS = resolve(import.meta.dirname, '../migrations');
let dir: string;
let handle: DatabaseHandle;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nb-backup-'));
  handle = openDatabase(join(dir, 'db', 'brain.db'), { migrationsFolder: MIGRATIONS });
});
afterEach(() => handle.close());

function seed(target: DatabaseHandle) {
  target.db.insert(projects).values({ id: 'api', name: 'API', rootPath: 'C:\\src\\api' }).run();
  target.db
    .insert(memories)
    .values([
      { id: 'm1', title: 'Cache', content: 'Use [[Redis]] para sessões', type: 'decision', projectId: 'api', sourceKind: 'user' },
      { id: 'm2', title: 'Redis', content: 'Armazenamento em memória', type: 'documentation', sourceKind: 'claude' },
    ])
    .run();
  target.db.insert(links).values({ sourceId: 'm1', targetId: 'm2', targetTitle: 'Redis', relation: 'references', origin: 'wikilink' }).run();
}

function snapshot(target: DatabaseHandle) {
  const count = (table: string) => (target.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get() as { n: number }).n;
  return {
    counts: Object.fromEntries(['projects', 'memories', 'links', 'memory_versions', 'tasks'].map((table) => [table, count(table)])),
    links: target.sqlite.prepare('SELECT source_id, target_id, target_title, relation FROM links ORDER BY id').all(),
    fts: target.sqlite.prepare("SELECT m.id FROM memories_fts JOIN memories m ON m.seq = memories_fts.rowid WHERE memories_fts MATCH 'sessoes'").all(),
  };
}

describe('backup and restore', () => {
  it('backup, delete the database, restore: same counts, links and full-text index', async () => {
    seed(handle);
    const before = snapshot(handle);
    expect(before.fts).toEqual([{ id: 'm1' }]);
    const file = join(dir, 'backups', backupFileName('manual', new Date('2026-10-28T12:00:00Z')));
    backupDatabase(handle, file);
    expect(verifyBackup(file)).toEqual({ ok: true, memories: 2 });

    // Lose everything: close and delete the database with its WAL files, start from an empty one.
    const dbFile = handle.file;
    handle.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(dbFile + suffix, { force: true });
    handle = openDatabase(dbFile, { migrationsFolder: MIGRATIONS });
    expect(snapshot(handle).counts['memories']).toBe(0);

    await restoreDatabase(handle, file, { migrationsFolder: MIGRATIONS });
    expect(snapshot(handle)).toEqual(before);
  });

  it('restores into the open database while it keeps working, replacing newer changes', async () => {
    seed(handle);
    const file = join(dir, 'backups', backupFileName('auto', new Date()));
    backupDatabase(handle, file);
    const before = snapshot(handle);
    handle.db.insert(memories).values({ id: 'm3', title: 'Depois', content: 'x', type: 'learning', sourceKind: 'user' }).run();
    handle.sqlite.prepare("DELETE FROM links").run();

    await restoreDatabase(handle, file, { migrationsFolder: MIGRATIONS });
    expect(snapshot(handle)).toEqual(before);
    handle.db.insert(memories).values({ id: 'm4', title: 'Novo', content: 'y', type: 'learning', sourceKind: 'user' }).run();
    expect(snapshot(handle).counts['memories']).toBe(3);
  });

  it('refuses files that are not a NeuralBridge backup, leaving the database untouched', async () => {
    seed(handle);
    const before = snapshot(handle);
    const garbage = join(dir, 'lixo.db');
    writeFileSync(garbage, 'isto não é um banco');
    expect(verifyBackup(garbage)).toMatchObject({ ok: false });
    await expect(restoreDatabase(handle, garbage, { migrationsFolder: MIGRATIONS })).rejects.toThrow(/backup/i);

    const other = openDatabase(join(dir, 'outro.db'), { migrationsFolder: MIGRATIONS });
    other.sqlite.prepare('DROP TABLE memories_fts').run();
    other.sqlite.prepare('DROP TABLE memories').run();
    other.close();
    expect(verifyBackup(join(dir, 'outro.db'))).toMatchObject({ ok: false });
    expect(verifyBackup(join(dir, 'nao-existe.db'))).toMatchObject({ ok: false });
    expect(snapshot(handle)).toEqual(before);
  });

  it('never overwrites an existing backup file', () => {
    const file = join(dir, 'backups', 'x.db');
    backupDatabase(handle, file);
    expect(() => backupDatabase(handle, file)).toThrow(/exist/);
  });
});

describe('backup files', () => {
  it('are listed newest first with their kind, and only the oldest automatic ones are pruned', () => {
    const backups = join(dir, 'backups');
    const at = (minute: number) => new Date(Date.UTC(2026, 9, 28, 12, minute));
    for (const minute of [1, 2, 3, 4]) backupDatabase(handle, join(backups, backupFileName('auto', at(minute))));
    backupDatabase(handle, join(backups, backupFileName('manual', at(0))));
    backupDatabase(handle, join(backups, backupFileName('before-restore', at(5))));
    writeFileSync(join(backups, 'anotacoes.txt'), 'não é backup');

    const listed = listBackups(backups);
    expect(listed.map((backup) => [backup.kind, backup.createdAt])).toEqual([
      ['before-restore', at(5).toISOString()],
      ['auto', at(4).toISOString()],
      ['auto', at(3).toISOString()],
      ['auto', at(2).toISOString()],
      ['auto', at(1).toISOString()],
      ['manual', at(0).toISOString()],
    ]);
    expect(present(listed[0]).sizeBytes).toBeGreaterThan(0);

    expect(pruneBackups(backups, 2)).toBe(2);
    expect(listBackups(backups).map((backup) => backup.kind)).toEqual(['before-restore', 'auto', 'auto', 'manual']);
    expect(existsSync(join(backups, 'anotacoes.txt'))).toBe(true);
    expect(listBackups(join(dir, 'sem-pasta'))).toEqual([]);
  });
});
