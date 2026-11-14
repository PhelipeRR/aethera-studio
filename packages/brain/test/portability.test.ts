import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { learningCandidates, memories, openDatabase, projects, tasks, taskSteps, type DatabaseHandle } from '@neuralbridge/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { applyRetention, BrainService, exportBrain, importBrain, toMarkdownFiles, USER_SCOPE, type Actor } from '../src/index.js';

/** Fails the test (instead of a TypeError) when an expected value is missing. */
function present<T>(value: T | null | undefined): T {
  expect(value).toBeTruthy();
  return value as T;
}

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
const user: Actor = { kind: 'user', client: 'test' };
const open = () => openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-port-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
let a: DatabaseHandle;
let b: DatabaseHandle;

beforeEach(() => {
  a = open();
  b = open();
  for (const handle of [a, b]) handle.db.insert(projects).values({ id: 'api', name: 'API', rootPath: 'C:\\src\\api' }).run();
});
afterEach(() => {
  a.close();
  b.close();
});

function seed(brain: BrainService) {
  brain.store({ title: 'Cache', content: 'Use [[Redis]] e veja [[Ainda não existe]].', type: 'decision', projectId: 'api', tags: ['infra', 'cache'], trust: 'reviewed' }, USER_SCOPE, user);
  brain.store({ title: 'Redis', content: 'Armazenamento em memória.', type: 'documentation', links: [{ target: 'Cache', relation: 'used-by' }] }, USER_SCOPE, { kind: 'codex', client: 'mcp' });
  const gone = brain.store({ title: 'Apagada', content: 'x', type: 'learning' }, USER_SCOPE, user).memory;
  brain.delete(gone.id, USER_SCOPE, user);
}

const portable = (dump: ReturnType<typeof exportBrain>) => ({ ...dump, exportedAt: 'x' });

describe('export and import', () => {
  it('round-trip keeps ids, content, origin, tags and links, and leaves deleted memories out', () => {
    seed(new BrainService(a));
    const dump = exportBrain(a);
    expect(dump).toMatchObject({ format: 'neuralbridge-brain', version: 1, projects: [{ id: 'api', name: 'API' }] });
    expect(dump.memories.map((memory) => memory.title).sort()).toEqual(['Cache', 'Redis']);

    const result = importBrain(b, JSON.parse(JSON.stringify(dump)));
    expect(result).toEqual({ imported: 2, skipped: [] });
    expect(portable(exportBrain(b))).toEqual(portable(dump));

    const cache = present(new BrainService(b).recall('Cache', USER_SCOPE, user));
    expect(cache).toMatchObject({ trust: 'reviewed', tags: ['cache', 'infra'], pending: ['Ainda não existe'], source: { kind: 'user' } });
    const redis = present(new BrainService(b).recall('Redis', USER_SCOPE, user));
    expect(redis.backlinks.map((link) => [link.title, link.relation])).toEqual([['Cache', 'references']]);
    // A global memory cannot see project memories, so its explicit link to one stays pending, as at the source.
    expect(redis.pending).toEqual(['Cache']);
    expect(new BrainService(b).search('armazenamento', {}, USER_SCOPE, user).map((hit) => hit.title)).toEqual(['Redis']);
  });

  it('skips what already exists or has no project here, and imports the rest', () => {
    seed(new BrainService(a));
    a.db.insert(projects).values({ id: 'web', name: 'Web', rootPath: 'C:\\src\\web' }).run();
    new BrainService(a).store({ title: 'Só da web', content: 'x', type: 'learning', projectId: 'web' }, USER_SCOPE, user);
    new BrainService(b).store({ title: 'Redis', content: 'Versão local.', type: 'documentation' }, USER_SCOPE, user);

    const result = importBrain(b, exportBrain(a));
    expect(result.imported).toBe(1);
    expect(result.skipped).toEqual(
      expect.arrayContaining([
        { title: 'Redis', reason: 'Já existe uma memória com este título.' },
        { title: 'Só da web', reason: 'O projeto "web" não está registrado aqui.' },
      ]),
    );
    expect(importBrain(b, exportBrain(a)).skipped).toContainEqual({ title: 'Cache', reason: 'Já importada.' });
  });

  it('rejects files that are not a NeuralBridge export', () => {
    expect(() => importBrain(b, { memories: 'nope' })).toThrow(/Singularity/);
    expect(() => importBrain(b, { format: 'neuralbridge-brain', version: 99, projects: [], memories: [] })).toThrow(/versão/);
  });

  it('writes one Markdown file per memory, by project, with front matter', () => {
    seed(new BrainService(a));
    const files = toMarkdownFiles(exportBrain(a));
    expect(files.map((file) => file.path).sort()).toEqual(['api/cache.md', 'global/redis.md']);
    const cache = present(files.find((file) => file.path === 'api/cache.md')).content;
    expect(cache).toMatch(/^---\nid: "[0-9A-Z]+"\ntitle: "Cache"\ntype: "decision"\nproject: "api"\ntags: \["cache","infra"\]\n/);
    expect(cache).toContain('\n---\n\nUse [[Redis]] e veja [[Ainda não existe]].\n');
  });
});

describe('retention', () => {
  const day = 86_400_000;

  it('erases deleted memories and finished tasks past their age, keeping everything else', () => {
    const brain = new BrainService(a);
    seed(brain);
    const now = Date.now();
    const old = new Date(now - 40 * day).toISOString();
    a.sqlite.prepare('UPDATE memories SET deleted_at = ? WHERE deleted_at IS NOT NULL').run(old);
    a.db
      .insert(tasks)
      .values([
        { id: 'antiga', prompt: 'a', mode: 'auto', status: 'completed', createdAt: old, finishedAt: old },
        { id: 'rodando', prompt: 'b', mode: 'auto', status: 'running', createdAt: old },
        { id: 'recente', prompt: 'c', mode: 'auto', status: 'failed', createdAt: new Date(now - day).toISOString() },
      ])
      .run();
    a.db.insert(taskSteps).values({ id: 's1', taskId: 'antiga', position: 0, agent: 'claude', kind: 'plan' }).run();
    a.db.insert(learningCandidates).values({ id: 'l1', taskId: 'antiga', title: 't', content: 'c', type: 'learning', status: 'pending' }).run();

    expect(applyRetention(a, { trashDays: 30, taskDays: 30 }, new Date(now))).toEqual({ memoriesErased: 1, tasksErased: 1 });
    expect(a.db.select().from(memories).all().map((memory) => memory.title).sort()).toEqual(['Cache', 'Redis']);
    expect(a.db.select().from(tasks).all().map((task) => task.id).sort()).toEqual(['recente', 'rodando']);
    expect(a.db.select().from(taskSteps).all()).toEqual([]);
    expect(a.db.select().from(learningCandidates).all()).toEqual([expect.objectContaining({ id: 'l1', taskId: null })]);
  });

  it('keeps everything when the limits are zero', () => {
    seed(new BrainService(a));
    a.sqlite.prepare("UPDATE memories SET deleted_at = '2000-01-01T00:00:00.000Z' WHERE deleted_at IS NOT NULL").run();
    expect(applyRetention(a, { trashDays: 0, taskDays: 0 })).toEqual({ memoriesErased: 0, tasksErased: 0 });
    expect(a.db.select().from(memories).all()).toHaveLength(3);
  });
});
