import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { EmbeddingProvider } from '@neuralbridge/brain';
import { accessLog, embeddings, memories, openDatabase, projects, type DatabaseHandle } from '@neuralbridge/database';
import { IpcChannel, parseIpcInput, parseIpcOutput } from '@neuralbridge/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBrainService } from '../src/main/brain.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../../packages/database/migrations');
let handle: DatabaseHandle;

function provider(ok: boolean): EmbeddingProvider {
  return {
    model: 'test-model',
    dim: 3,
    availability: async () => (ok ? { ok: true } : { ok: false, reason: 'disabled' }),
    embedPassages: async () => [],
    embedQuery: async () => new Float32Array(3),
  };
}

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-brain3d-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  handle.db.insert(projects).values({ id: 'api', name: 'Loja API', rootPath: 'C:\\src\\api' }).run();
  const brain = createBrainService({ handle, provider: null });
  brain.store({ title: 'Cache', content: 'Use [[Redis]] e [[Ainda não existe]].', type: 'decision', projectId: 'api', tags: ['infra'] });
  brain.store({ title: 'Redis', content: 'Armazenamento em memória.', type: 'documentation', projectId: 'api' });
  brain.store({ title: 'Filas', content: 'Mensageria com retry.', type: 'code_pattern' });
  const gone = brain.store({ title: 'Apagada', content: 'x', type: 'learning' });
  brain.remove(gone.memory.id, false);
});
afterEach(() => handle.close());

const id = (title: string) => handle.db.select({ id: memories.id }).from(memories).where(eq(memories.title, title)).get()?.id ?? '';

function embed(title: string, vector: number[]) {
  const length = Math.hypot(...vector);
  const unit = Float32Array.from(vector.map((value) => value / length));
  handle.db.insert(embeddings).values({ memoryId: id(title), model: 'test-model', dim: 3, vector: Buffer.from(unit.buffer), contentHash: 'h' }).run();
  handle.db.update(memories).set({ embeddingStatus: 'ready' }).where(eq(memories.id, id(title))).run();
}

describe('3D brain graph', () => {
  it('lists live memories with project names and resolved links only, within the IPC contract', () => {
    const graph = createBrainService({ handle, provider: null }).graph3d();
    expect(graph.memories.map((memory) => memory.title).sort()).toEqual(['Cache', 'Filas', 'Redis']);
    expect(graph.memories.find((memory) => memory.title === 'Cache')).toMatchObject({ projectId: 'api', projectName: 'Loja API', type: 'decision', trust: 'unverified', sourceKind: 'user', tags: ['infra'] });
    expect(graph.links).toEqual([{ sourceId: id('Cache'), targetId: id('Redis'), relation: 'references', origin: 'wikilink' }]);
    expect(graph.truncated).toBe(false);
    expect(parseIpcOutput(IpcChannel.brainGraph3d, graph)).toEqual(graph);
  });
});

describe('similarity between memories', () => {
  it('pairs memories whose embeddings are close, above the threshold, never with themselves', async () => {
    embed('Cache', [1, 0.05, 0]);
    embed('Redis', [1, 0.1, 0]);
    embed('Filas', [0, 0, 1]);
    const result = await createBrainService({ handle, provider: provider(true) }).similarity();
    expect(result).toMatchObject({ available: true, reason: null, considered: 3, truncated: false });
    expect(result.edges).toEqual([{ sourceId: expect.any(String), targetId: expect.any(String), score: expect.closeTo(0.998, 2) }]);
    expect(new Set([result.edges[0]?.sourceId, result.edges[0]?.targetId])).toEqual(new Set([id('Cache'), id('Redis')]));
    expect(result.edges.every((edge) => edge.score >= result.threshold)).toBe(true);
    expect(parseIpcOutput(IpcChannel.brainSimilarity, result)).toEqual(result);
  });

  it('says why it is unavailable instead of inventing connections', async () => {
    expect(await createBrainService({ handle, provider: null }).similarity()).toMatchObject({ available: false, reason: 'disabled', edges: [] });
    expect(await createBrainService({ handle, provider: provider(false) }).similarity()).toMatchObject({ available: false, reason: 'disabled', edges: [] });
    expect(await createBrainService({ handle, provider: provider(true) }).similarity()).toMatchObject({ available: false, reason: 'no_embeddings', edges: [] });
  });
});

describe('brain activity', () => {
  it('returns access-log rows after a point in time, newest last, with titles but no content', () => {
    handle.db.delete(accessLog).run();
    handle.db
      .insert(accessLog)
      .values([
        { memoryId: id('Cache'), client: 'mcp:claude-code', action: 'search_hit', at: '2026-10-29T10:00:00.000Z' },
        { memoryId: id('Redis'), client: 'mcp:codex-mcp-client', action: 'recall', at: '2026-10-29T10:00:05.000Z' },
        { memoryId: id('Filas'), client: 'electron', action: 'search_hit', at: '2026-10-29T09:00:00.000Z' },
      ])
      .run();
    const service = createBrainService({ handle, provider: null });
    const recent = service.activity('2026-10-29T09:30:00.000Z');
    expect(recent.map((entry) => [entry.title, entry.client, entry.action])).toEqual([
      ['Cache', 'mcp:claude-code', 'search_hit'],
      ['Redis', 'mcp:codex-mcp-client', 'recall'],
    ]);
    expect(JSON.stringify(recent)).not.toContain('Armazenamento');
    expect(parseIpcOutput(IpcChannel.brainActivity, recent)).toEqual(recent);
    expect(() => parseIpcInput(IpcChannel.brainActivity, { since: 'ontem' })).toThrow();
  });
});

describe('Memory Galaxy snapshot (lote 50.06)', () => {
  it('lists every live memory once, the real total and resolved links, within the IPC contract', () => {
    const galaxy = createBrainService({ handle, provider: null }).galaxy();
    expect(galaxy.memories.map((memory) => memory.title).sort()).toEqual(['Cache', 'Filas', 'Redis']);
    expect(new Set(galaxy.memories.map((memory) => memory.id)).size).toBe(galaxy.memories.length);
    expect(galaxy.total).toBe(3);
    expect(galaxy.truncated).toBe(false);
    expect(galaxy.memories.find((memory) => memory.title === 'Cache')).toMatchObject({ projectName: 'Loja API', confidence: 'unverified', tags: ['infra'] });
    expect(galaxy.memories.every((memory) => memory.createdAt.length > 0)).toBe(true);
    expect(galaxy.links).toEqual([{ sourceId: id('Cache'), targetId: id('Redis'), relation: 'references', origin: 'wikilink' }]);
    expect(galaxy.embeddings).toBeNull();
    expect(parseIpcOutput(IpcChannel.brainGalaxy, galaxy)).toEqual(galaxy);
  });

  it('ships stored vectors of one model as Float32 bytes in id order, and never a deleted memory', () => {
    embed('Cache', [1, 0, 0]);
    embed('Redis', [0, 1, 0]);
    const galaxy = createBrainService({ handle, provider: provider(true) }).galaxy();
    expect(galaxy.embeddings?.model).toBe('test-model');
    expect(galaxy.embeddings?.dim).toBe(3);
    expect(galaxy.embeddings?.ids.sort()).toEqual([id('Cache'), id('Redis')].sort());
    const bytes = galaxy.embeddings?.vectors ?? new Uint8Array();
    expect(bytes.byteLength).toBe(2 * 3 * 4);
    const vectors = new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
    const cache = galaxy.embeddings?.ids.indexOf(id('Cache')) ?? -1;
    expect(Array.from(vectors.slice(cache * 3, cache * 3 + 3))).toEqual([1, 0, 0]);
    expect(galaxy.memories.some((memory) => memory.title === 'Apagada')).toBe(false);
    expect(parseIpcOutput(IpcChannel.brainGalaxy, galaxy).embeddings?.ids.length).toBe(2);
  });

  it('rejects vectors whose size does not match ids x dim', () => {
    const galaxy = createBrainService({ handle, provider: null }).galaxy();
    expect(() => parseIpcOutput(IpcChannel.brainGalaxy, { ...galaxy, embeddings: { model: 'm', dim: 3, ids: ['a'], vectors: new Uint8Array(8) } })).toThrow();
  });
});
