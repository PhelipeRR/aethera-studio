import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { BrainService, USER_SCOPE, writeBrainSettings } from '@neuralbridge/brain';
import { memories, openDatabase, tasks, type DatabaseHandle } from '@neuralbridge/database';
import { DEFAULT_BRAIN_SETTINGS } from '@neuralbridge/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBrainAdmin } from '../src/main/brain-admin.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../../packages/database/migrations');
let dir: string;
let handle: DatabaseHandle;
let clock: Date;
let changed: number;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'nb-admin-'));
  handle = openDatabase(join(dir, 'db', 'brain.db'), { migrationsFolder: MIGRATIONS });
  clock = new Date('2026-10-28T12:00:00Z');
  changed = 0;
});
afterEach(() => handle.close());

const admin = () =>
  createBrainAdmin({ handle, backupsDir: join(dir, 'backups', 'brain'), migrationsFolder: MIGRATIONS, clock: () => clock, onMemoriesChanged: () => changed++, log: () => {} });
const store = (title: string) => new BrainService(handle).store({ title, content: `sobre ${title}`, type: 'learning' }, USER_SCOPE, { kind: 'user', client: 'test' });

describe('brain admin', () => {
  it('backs up on schedule only when the newest automatic backup is old enough, and prunes', () => {
    writeBrainSettings(handle, { ...DEFAULT_BRAIN_SETTINGS, backup: { intervalHours: 24, keep: 2 } });
    const service = admin();
    expect(service.runScheduled().backedUp).toBe(true);
    clock = new Date('2026-10-28T20:00:00Z');
    expect(service.runScheduled().backedUp).toBe(false);
    for (const day of ['29', '30', '31']) {
      clock = new Date(`2026-10-${day}T12:00:00Z`);
      expect(service.runScheduled().backedUp).toBe(true);
    }
    expect(service.backups().map((backup) => backup.createdAt)).toEqual(['2026-10-31T12:00:00.000Z', '2026-10-30T12:00:00.000Z']);

    writeBrainSettings(handle, { ...DEFAULT_BRAIN_SETTINGS, backup: { intervalHours: 0, keep: 2 } });
    clock = new Date('2026-11-30T12:00:00Z');
    expect(service.runScheduled().backedUp).toBe(false);
  });

  it('restores a listed backup by name after saving the current state, and refuses anything else', async () => {
    const service = admin();
    store('Antes');
    const { name } = service.createBackup();
    store('Depois');

    await expect(service.restore('..\\..\\brain.db')).rejects.toThrow(/invalid/);
    await expect(service.restore('neuralbridge-2020-01-01T00-00-00-000Z-manual.db')).rejects.toThrow(/not_found/);

    clock = new Date('2026-10-28T13:00:00Z');
    const { safetyBackup } = await service.restore(name);
    expect(safetyBackup.kind).toBe('before-restore');
    expect(handle.db.select().from(memories).all().map((memory) => memory.title)).toEqual(['Antes']);
    expect(changed).toBe(1);

    // The safety backup brings back what the restore replaced.
    clock = new Date('2026-10-28T14:00:00Z');
    await service.restore(safetyBackup.name);
    expect(handle.db.select().from(memories).all().map((memory) => memory.title).sort()).toEqual(['Antes', 'Depois']);
  });

  it('does not restore while a task is running', async () => {
    const service = admin();
    const { name } = service.createBackup();
    handle.db.insert(tasks).values({ id: 't', prompt: 'x', mode: 'auto', status: 'running' }).run();
    await expect(service.restore(name)).rejects.toThrow(/conflict: Há tarefas em andamento/);
  });

  it('exports JSON and Markdown without overwriting, and imports JSON back', () => {
    const service = admin();
    store('Cache');
    const json = join(dir, 'export.json');
    expect(service.exportJson(json)).toEqual({ count: 1 });
    const { count, folder } = service.exportMarkdown(dir);
    expect(count).toBe(1);
    expect(readdirSync(join(folder, 'global'))).toEqual(['cache.md']);
    expect(() => service.exportMarkdown(dir)).toThrow(); // same second, same folder: never merged into

    handle.sqlite.prepare('DELETE FROM memories').run();
    expect(service.importJson(json)).toEqual({ imported: 1, skipped: [] });
    expect(changed).toBe(1);
    writeFileSync(join(dir, 'ruim.json'), '{ não é json');
    expect(() => service.importJson(join(dir, 'ruim.json'))).toThrow(/invalid: O arquivo não é um JSON válido/);
    writeFileSync(join(dir, 'outro.json'), JSON.stringify({ hello: 'world' }));
    expect(() => service.importJson(join(dir, 'outro.json'))).toThrow(/invalid: O arquivo não é uma exportação do Singularity/);
    expect(JSON.parse(readFileSync(json, 'utf8'))).toMatchObject({ format: 'neuralbridge-brain' });
    expect(existsSync(json)).toBe(true);
  });

  it('reports an unavailable database instead of crashing', () => {
    const service = createBrainAdmin({ handle: null, backupsDir: join(dir, 'b'), migrationsFolder: MIGRATIONS });
    expect(() => service.settings()).toThrow(/unavailable/);
    expect(service.runScheduled()).toEqual({ backedUp: false, retention: null });
    expect(service.propose([{ title: 'x', content: 'y' }], { taskId: null, projectId: null, agent: null })).toEqual([]);
  });
});
