import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { embeddings, memories, openDatabase, projects, type DatabaseHandle } from '@neuralbridge/database';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrainService, EmbeddingIndexer, fromBlob, LocalEmbeddingProvider, projectScope, toBlob, type Actor } from '../src/index.js';
import { FakeProvider } from './fake-provider.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
const user: Actor = { kind: 'user', client: 'electron' };
const api = projectScope('api');

let handle: DatabaseHandle;
let brain: BrainService;
let provider: FakeProvider;

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-emb-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  handle.db.insert(projects).values({ id: 'api', name: 'api', rootPath: 'C:\\src\\api' }).run();
  brain = new BrainService(handle);
  provider = new FakeProvider();
});

afterEach(() => handle.close());

const status = (id: string) => handle.db.select({ s: memories.embeddingStatus }).from(memories).where(eq(memories.id, id)).get()?.s;

describe('vector blobs', () => {
  it('round-trips Float32 vectors through BLOB storage', () => {
    const vector = Float32Array.from([0.25, -1.5, 3e-7, 42]);
    expect(Array.from(fromBlob(toBlob(vector)))).toEqual(Array.from(vector));
  });
});

describe('EmbeddingIndexer', () => {
  it('embeds pending memories and records model, dimension and content hash', async () => {
    const a = brain.store({ title: 'Banco', content: 'Usar postgres', type: 'decision' }, api, user).memory;
    const b = brain.store({ title: 'Login', content: 'OAuth com PKCE', type: 'decision' }, api, user).memory;
    const result = await new EmbeddingIndexer(handle, provider).processPending();
    expect(result).toEqual({ indexed: 2, failed: 0, skipped: 0 });
    expect([status(a.id), status(b.id)]).toEqual(['ready', 'ready']);
    const row = handle.db.select().from(embeddings).where(eq(embeddings.memoryId, a.id)).get();
    expect(row).toMatchObject({ model: 'fake-concepts', dim: provider.dim, contentHash: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(fromBlob(row?.vector ?? Buffer.alloc(0))).toHaveLength(provider.dim);
    expect(await new EmbeddingIndexer(handle, provider).processPending()).toEqual({ indexed: 0, failed: 0, skipped: 0 });
  });

  it('re-embeds after an edit and discards a vector computed for text that changed meanwhile', async () => {
    const memory = brain.store({ title: 'Banco', content: 'v1', type: 'decision' }, api, user).memory;
    const slow = new FakeProvider();
    const original = slow.embedPassages.bind(slow);
    slow.embedPassages = async (texts) => {
      brain.store({ title: 'Banco', content: 'v2 changed while embedding', type: 'decision' }, api, user);
      return original(texts);
    };
    expect(await new EmbeddingIndexer(handle, slow).processPending()).toEqual({ indexed: 0, failed: 0, skipped: 1 });
    expect(status(memory.id)).toBe('pending');
    expect(await new EmbeddingIndexer(handle, provider).processPending()).toMatchObject({ indexed: 1 });
    expect(status(memory.id)).toBe('ready');
  });

  it('ignores deleted memories', async () => {
    const memory = brain.store({ title: 'Temp', content: 'x', type: 'learning' }, api, user).memory;
    brain.delete(memory.id, api, user);
    expect(await new EmbeddingIndexer(handle, provider).processPending()).toEqual({ indexed: 0, failed: 0, skipped: 0 });
  });

  it('recomputes vectors made by another model', async () => {
    const memory = brain.store({ title: 'Banco', content: 'x', type: 'decision' }, api, user).memory;
    await new EmbeddingIndexer(handle, provider).processPending();
    const other = new FakeProvider();
    Object.defineProperty(other, 'model', { value: 'another-model' });
    expect(await new EmbeddingIndexer(handle, other).processPending()).toMatchObject({ indexed: 1 });
    expect(handle.db.select({ model: embeddings.model }).from(embeddings).where(eq(embeddings.memoryId, memory.id)).get()).toEqual({ model: 'another-model' });
  });

  it('marks only the memory that breaks the model as failed and indexes the rest', async () => {
    const good = brain.store({ title: 'Banco', content: 'postgres', type: 'decision' }, api, user).memory;
    const bad = brain.store({ title: 'Quebra', content: 'POISON', type: 'decision' }, api, user).memory;
    provider.failOn = 'POISON';
    expect(await new EmbeddingIndexer(handle, provider).processPending()).toEqual({ indexed: 1, failed: 1, skipped: 0 });
    expect([status(good.id), status(bad.id)]).toEqual(['ready', 'failed']);
  });
});

describe('LocalEmbeddingProvider', () => {
  it('reports a missing model without touching the network when downloads are not allowed', async () => {
    const local = new LocalEmbeddingProvider({ cacheDir: mkdtempSync(join(tmpdir(), 'nb-models-')), allowDownload: false });
    expect(await local.availability()).toEqual({ ok: false, reason: 'model_missing' });
    await expect(local.embedQuery('x')).rejects.toThrow(/not downloaded/);
  });
});
