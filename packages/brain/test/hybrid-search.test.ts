import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { accessLog, openDatabase, projects, type DatabaseHandle } from '@neuralbridge/database';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrainService, EmbeddingIndexer, HybridSearch, projectScope, type Actor } from '../src/index.js';
import { FakeProvider } from './fake-provider.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
const user: Actor = { kind: 'user', client: 'electron' };
const claude: Actor = { kind: 'claude', client: 'mcp:claude-code' };
const api = projectScope('api');

let handle: DatabaseHandle;
let brain: BrainService;
let provider: FakeProvider;
let search: HybridSearch;

beforeEach(async () => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-hybrid-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  handle.db
    .insert(projects)
    .values([
      { id: 'api', name: 'api', rootPath: 'C:\\src\\api' },
      { id: 'web', name: 'web', rootPath: 'C:\\src\\web' },
    ])
    .run();
  brain = new BrainService(handle);
  provider = new FakeProvider();
  brain.store({ title: 'Migrações versionadas', content: 'Usamos Drizzle para gerar o schema.', type: 'decision', tags: ['db'] }, api, user);
  brain.store({ title: 'Timeout no pool', content: 'A migração do pool de conexões resolveu o timeout.', type: 'bug_fix' }, api, user);
  brain.store({ title: 'Login com OAuth', content: 'Tokens expiram em uma hora.', type: 'decision' }, api, user);
  brain.store({ title: 'Receita', content: 'bolo de cenoura', type: 'learning' }, api, user);
  brain.store({ title: 'Banco do front', content: 'tabela de usuários no postgres', type: 'decision' }, projectScope('web'), user);
  await new EmbeddingIndexer(handle, provider).processPending();
  search = new HybridSearch(brain, provider, { minSimilarity: 0.5 });
});

afterEach(() => handle.close());

const view = (result: Awaited<ReturnType<HybridSearch['search']>>) => result.hits.map((hit) => [hit.title, hit.matchedBy]);

describe('HybridSearch', () => {
  it('finds memories by meaning when no keyword matches', async () => {
    const result = await search.search('postgres', {}, api, claude);
    expect(result).toMatchObject({ mode: 'hybrid', degraded: null });
    expect(view(result)).toEqual([
      ['Migrações versionadas', ['semantic']],
      ['Timeout no pool', ['semantic']],
    ]);
  });

  it('ranks memories found by both retrievers first (reciprocal rank fusion)', async () => {
    const result = await search.search('schema', {}, api, claude);
    expect(view(result)).toEqual([
      ['Migrações versionadas', ['text', 'semantic']],
      ['Timeout no pool', ['semantic']],
    ]);
    expect(result.hits[0]?.score).toBeGreaterThan(result.hits[1]?.score ?? Infinity);
    expect(result.hits[0]?.snippet).toContain('[schema]');
    expect(result.hits[1]?.snippet).toBe('A migração do pool de conexões resolveu o timeout.');
  });

  it('drops semantic candidates below the similarity threshold', async () => {
    expect(view(await search.search('bolo', {}, api, claude))).toEqual([['Receita', ['text', 'semantic']]]);
  });

  it('applies scope, type and tags to semantic results too', async () => {
    expect(view(await search.search('postgres', { type: 'bug_fix' }, api, claude))).toEqual([['Timeout no pool', ['semantic']]]);
    expect(view(await search.search('postgres', { tags: ['db'] }, api, claude))).toEqual([['Migrações versionadas', ['semantic']]]);
    expect(view(await search.search('postgres', {}, projectScope('web'), claude))).toEqual([['Banco do front', ['text', 'semantic']]]);
  });

  it('still finds memories whose vector is not ready yet, by keyword', async () => {
    brain.store({ title: 'Índice parcial', content: 'postgres partial index', type: 'learning' }, api, user);
    expect(view(await search.search('postgres', {}, api, claude))[0]).toEqual(['Índice parcial', ['text']]);
  });

  it('falls back to keywords and says why when semantic search is unavailable', async () => {
    expect(await new HybridSearch(brain, null).search('migra', {}, api, claude)).toMatchObject({ mode: 'fts', degraded: 'disabled', hits: [{ title: 'Migrações versionadas' }, { title: 'Timeout no pool' }] });

    provider.available = { ok: false, reason: 'model_missing' };
    expect(await search.search('migra', {}, api, claude)).toMatchObject({ mode: 'fts', degraded: 'model_missing' });

    provider.available = { ok: true };
    provider.failOn = 'migra';
    const broken = await search.search('migra', {}, api, claude);
    expect(broken).toMatchObject({ mode: 'fts', degraded: 'model_error' });
    expect(broken.hits.map((hit) => hit.matchedBy)).toEqual([['text'], ['text']]);
  });

  it('returns nothing for queries without words, and logs only the hits it returns', async () => {
    expect((await search.search('?!', {}, api, claude)).hits).toEqual([]);
    expect(await search.search('postgres', { limit: 1 }, api, claude)).toMatchObject({ hits: [{ title: 'Migrações versionadas' }] });
    expect(handle.db.select({ action: accessLog.action }).from(accessLog).all()).toEqual([{ action: 'search_hit' }]);
  });
});
