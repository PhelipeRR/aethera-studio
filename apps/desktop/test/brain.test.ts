import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { memories, openDatabase, projects, type DatabaseHandle } from '@neuralbridge/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBrainService } from '../src/main/brain.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../../packages/database/migrations');
let handle: DatabaseHandle;
let changes = 0;

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-app-brain-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  handle.db
    .insert(projects)
    .values([
      { id: 'api', name: 'Loja API', rootPath: 'C:\\src\\api' },
      { id: 'secret', name: 'Privado', rootPath: 'C:\\src\\secret', isPrivate: true },
    ])
    .run();
  changes = 0;
});

afterEach(() => handle.close());

// A ticking clock keeps "most recent" ordering deterministic (several writes can share a millisecond).
let tick = Date.UTC(2026, 9, 28);
const service = () => createBrainService({ handle, provider: null, onChange: () => changes++, clock: () => new Date((tick += 1000)) });

describe('brain service for the app', () => {
  it('writes as the user, sees every project including private ones, and reports changes', () => {
    const brain = service();
    const { memory } = brain.store({ title: 'Regra', content: 'Ver [[Glossário]]', type: 'decision', projectId: 'secret', trust: 'reviewed', tags: ['infra'] });
    expect(memory).toMatchObject({ projectId: 'secret', trust: 'reviewed', source: { kind: 'user' } });
    expect(brain.get(memory.id)).toMatchObject({ title: 'Regra', pending: ['Glossário'] });
    expect(changes).toBe(1);
  });

  it('summarises the brain with real counts only', () => {
    const brain = service();
    brain.store({ title: 'A', content: 'liga [[B]] e [[Fantasma]]', type: 'decision', projectId: 'api' });
    brain.store({ title: 'B', content: 'x', type: 'bug_fix', projectId: 'api' });
    brain.store({ title: 'Global', content: 'x', type: 'preference', projectId: null });
    const removed = brain.store({ title: 'Apagada', content: 'x', type: 'learning', projectId: 'api' }).memory;
    brain.remove(removed.id, false);

    expect(brain.overview()).toEqual({
      total: 3,
      byType: [
        { type: 'bug_fix', count: 1 },
        { type: 'decision', count: 1 },
        { type: 'preference', count: 1 },
      ],
      byProject: [
        { projectId: 'api', name: 'Loja API', count: 2 },
        { projectId: null, name: null, count: 1 },
      ],
      links: { resolved: 1, pending: 1 },
      embeddings: { indexed: 0, pending: 3, failed: 0 },
      recent: [expect.objectContaining({ title: 'Global' }), expect.objectContaining({ title: 'B' }), expect.objectContaining({ title: 'A' })],
    });
  });

  it('searches within one project, only global memories, or everything', async () => {
    const brain = service();
    brain.store({ title: 'Cache na API', content: 'redis', type: 'decision', projectId: 'api' });
    brain.store({ title: 'Cache global', content: 'redis', type: 'decision', projectId: null });
    const titles = async (projectId?: string | null) =>
      (await brain.search({ query: 'redis', ...(projectId === undefined ? {} : { projectId }) })).hits.map((hit) => hit.title).sort();
    expect(await titles()).toEqual(['Cache global', 'Cache na API']);
    expect(await titles('api')).toEqual(['Cache na API']);
    expect(await titles(null)).toEqual(['Cache global']);
    expect(await brain.search({ query: 'redis' })).toMatchObject({ mode: 'fts', degraded: 'disabled' });
  });

  it('deletes softly by default and permanently on request', () => {
    const brain = service();
    const soft = brain.store({ title: 'Soft', content: 'x', type: 'learning' }).memory;
    const hard = brain.store({ title: 'Hard', content: 'x', type: 'learning' }).memory;
    brain.remove(soft.id, false);
    brain.remove(hard.id, true);
    expect(handle.db.select({ title: memories.title, deletedAt: memories.deletedAt }).from(memories).all()).toEqual([{ title: 'Soft', deletedAt: expect.any(String) }]);
    expect(brain.get(soft.id)).toBeNull();
  });

  it('turns domain errors into messages that keep their code', () => {
    const brain = service();
    brain.store({ title: 'Um', content: 'x', type: 'learning' });
    const other = brain.store({ title: 'Dois', content: 'x', type: 'learning' }).memory;
    expect(() => brain.store({ id: other.id, title: 'um', content: 'x', type: 'learning' })).toThrow(/^conflict: /);
    expect(() => brain.remove('nope', false)).toThrow(/^not_found: /);
  });

  it('lists projects and tags for the filters', () => {
    const brain = service();
    brain.store({ title: 'A', content: 'x', type: 'learning', tags: ['db', 'infra'] });
    brain.store({ title: 'B', content: 'x', type: 'learning', tags: ['db'] });
    expect(brain.projects()).toEqual([
      { id: 'api', name: 'Loja API', isPrivate: false },
      { id: 'secret', name: 'Privado', isPrivate: true },
    ]);
    expect(brain.tags()).toEqual([
      { name: 'db', count: 2 },
      { name: 'infra', count: 1 },
    ]);
  });

  it('fails clearly without a database', () => {
    const brain = createBrainService({ handle: null, provider: null });
    expect(() => brain.overview()).toThrow(/banco de dados/);
  });
});

describe('graph snapshot', () => {
  it('returns live memories with tags and every link from them, pending ones included', () => {
    const brain = service();
    const a = brain.store({ title: 'A', content: '[[B]] [[Fantasma]]', type: 'decision', tags: ['db'], projectId: 'api' }).memory;
    const b = brain.store({ title: 'B', content: 'x', type: 'bug_fix', projectId: 'api', links: [{ target: 'A', relation: 'fixes' }] }).memory;
    const gone = brain.store({ title: 'C', content: '[[A]]', type: 'learning' }).memory;
    brain.remove(gone.id, false);

    const graph = brain.graph();
    expect(graph.truncated).toBe(false);
    expect(graph.memories).toEqual(
      expect.arrayContaining([
        { id: a.id, title: 'A', type: 'decision', projectId: 'api', tags: ['db'] },
        { id: b.id, title: 'B', type: 'bug_fix', projectId: 'api', tags: [] },
      ]),
    );
    expect(graph.memories).toHaveLength(2);
    expect(graph.links).toEqual(
      expect.arrayContaining([
        { sourceId: a.id, targetId: b.id, targetTitle: 'B', relation: 'references' },
        { sourceId: a.id, targetId: null, targetTitle: 'Fantasma', relation: 'references' },
        { sourceId: b.id, targetId: a.id, targetTitle: 'A', relation: 'fixes' },
      ]),
    );
    expect(graph.links).toHaveLength(3);
  });
});

describe('memory confidence in the app', () => {
  it('is reviewed or marked stale by the user, and the evidence check only ever lowers it', () => {
    const root = join(mkdtempSync(join(tmpdir(), 'nb-app-evidence-')), 'loja');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src', 'pool.ts'), 'export const size = 20;');
    const old = new Date('2026-01-01T00:00:00Z');
    utimesSync(join(root, 'src', 'pool.ts'), old, old);
    handle.db.insert(projects).values({ id: 'loja', name: 'Loja', rootPath: root }).run();
    const brain = service();
    const { memory } = brain.store({ title: 'Pool', content: 'Pool com 20 conexões.', type: 'decision', projectId: 'loja', sourceRef: 'src/pool.ts:1' });

    // All evidence still in place: nothing changes, and nothing is promoted either.
    expect(brain.revalidate(memory.id)).toEqual({ confidence: 'unverified', findings: [{ kind: 'file', ref: 'src/pool.ts:1', status: 'ok' }] });
    expect(brain.setConfidence(memory.id, 'reviewed')).toEqual({ confidence: 'reviewed' });

    writeFileSync(join(root, 'src', 'pool.ts'), 'export const size = 40;');
    expect(brain.revalidate(memory.id)).toEqual({ confidence: 'stale', findings: [{ kind: 'file', ref: 'src/pool.ts:1', status: 'changed' }] });
    expect(brain.get(memory.id)?.confidence).toBe('stale');
    expect(() => brain.revalidate('nao-existe')).toThrow();
  });
});
