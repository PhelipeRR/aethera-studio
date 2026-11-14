import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { accessLog, memories, memoryVersions, openDatabase, projects, type DatabaseHandle } from '@neuralbridge/database';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrainError, BrainService, GLOBAL_SCOPE, projectScope, USER_SCOPE, type Actor } from '../src/index.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
const user: Actor = { kind: 'user', client: 'electron' };
const claude: Actor = { kind: 'claude', client: 'mcp:claude-code' };
const codex: Actor = { kind: 'codex', client: 'mcp:codex' };
const api = projectScope('api');
const web = projectScope('web');

let handle: DatabaseHandle;
let brain: BrainService;
let clock: number;

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-brain-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  handle.db
    .insert(projects)
    .values([
      { id: 'api', name: 'api', rootPath: 'C:\\src\\api' },
      { id: 'web', name: 'web', rootPath: 'C:\\src\\web' },
      { id: 'secret', name: 'secret', rootPath: 'C:\\src\\secret', isPrivate: true },
    ])
    .run();
  clock = Date.UTC(2026, 9, 28, 12, 0, 0);
  brain = new BrainService(handle, { clock: () => new Date((clock += 1000)) });
});

afterEach(() => handle.close());

const decision = (title: string, content = `About ${title}`) => ({ title, content, type: 'decision' as const });

function brainError(fn: () => unknown): BrainError {
  try {
    fn();
  } catch (error) {
    if (error instanceof BrainError) return error;
    throw error;
  }
  throw new Error('expected a BrainError');
}

describe('store', () => {
  it('creates a memory at version 1 in the caller project, with tags normalised and a version snapshot', () => {
    const { memory, created } = brain.store({ ...decision('Logging'), tags: [' Infra ', 'infra', 'Observability'] }, api, claude);
    expect(created).toBe(true);
    expect(memory).toMatchObject({ title: 'Logging', projectId: 'api', version: 1, trust: 'unverified', embeddingStatus: 'pending', source: { kind: 'claude', ref: null } });
    expect(memory.id).toMatch(/^[0-9A-Z]{26}$/);
    expect(memory.tags).toEqual(['infra', 'observability']);
    expect(brain.versions(memory.id, api)).toEqual([expect.objectContaining({ version: 1, title: 'Logging', changedBy: 'claude', tags: ['infra', 'observability'] })]);
  });

  it('updates the live memory with the same title instead of duplicating it', () => {
    const first = brain.store(decision('Logging', 'v1'), api, claude).memory;
    const second = brain.store(decision('LOGGING', 'v2'), api, codex);
    expect(second.created).toBe(false);
    expect(second.memory).toMatchObject({ id: first.id, title: 'LOGGING', content: 'v2', version: 2 });
    expect(brain.versions(first.id, api).map((v) => [v.version, v.changedBy])).toEqual([
      [2, 'codex'],
      [1, 'claude'],
    ]);
  });

  it('updates by id, and rejects unknown ids', () => {
    const { memory } = brain.store(decision('Logging'), api, user);
    expect(brain.store({ ...decision('Structured logging'), id: memory.id }, api, user).memory).toMatchObject({ id: memory.id, title: 'Structured logging', version: 2 });
    expect(brainError(() => brain.store({ ...decision('X'), id: 'nope' }, api, user)).code).toBe('not_found');
  });

  it('does not create a version when nothing changed', () => {
    const first = brain.store({ ...decision('Logging'), tags: ['infra'] }, api, claude).memory;
    const again = brain.store({ ...decision('Logging'), tags: ['INFRA'] }, api, codex);
    expect(again).toMatchObject({ created: false, changed: false });
    expect(again.memory.version).toBe(1);
    expect(again.memory.updatedAt).toBe(first.updatedAt);
  });

  it('lets only the user set trust; agent edits reset it to unverified', () => {
    const { memory } = brain.store({ ...decision('Logging'), trust: 'reviewed' }, api, claude);
    expect(memory.trust).toBe('unverified');
    expect(brain.store({ ...decision('Logging'), trust: 'reviewed' }, api, user).memory.trust).toBe('reviewed');
    expect(brain.store(decision('Logging', 'changed by an agent'), api, codex).memory.trust).toBe('unverified');
  });

  it('marks the embedding stale only when title or content change', () => {
    const { memory } = brain.store(decision('Logging'), api, user);
    handle.db.update(memories).set({ embeddingStatus: 'ready' }).where(eq(memories.id, memory.id)).run();
    expect(brain.store({ ...decision('Logging'), tags: ['infra'] }, api, user).memory.embeddingStatus).toBe('ready');
    expect(brain.store(decision('Logging', 'new text'), api, user).memory.embeddingStatus).toBe('pending');
  });

  it('writes global memories only when asked, and never into another project', () => {
    expect(brain.store({ ...decision('Team style'), projectId: null }, api, user).memory.projectId).toBeNull();
    expect(brainError(() => brain.store({ ...decision('X'), projectId: 'web' }, api, claude)).code).toBe('forbidden');
    expect(brainError(() => brain.store({ ...decision('X'), projectId: null }, projectScope('api', false), claude)).code).toBe('forbidden');
    expect(brain.store(decision('Global from global scope'), GLOBAL_SCOPE, claude).memory.projectId).toBeNull();
    expect(brainError(() => brain.store({ ...decision('X'), projectId: 'api' }, GLOBAL_SCOPE, claude)).code).toBe('forbidden');
  });

  it('refuses to move a memory to another project', () => {
    const { memory } = brain.store(decision('Logging'), USER_SCOPE, user);
    expect(brainError(() => brain.store({ ...decision('Logging'), id: memory.id, projectId: 'web' }, USER_SCOPE, user)).code).toBe('invalid');
  });

  it('requires an existing project', () => {
    expect(brainError(() => brain.store({ ...decision('X'), projectId: 'ghost' }, USER_SCOPE, user)).code).toBe('not_found');
  });

  it('validates input with clear errors', () => {
    expect(brainError(() => brain.store({ title: '', content: 'x', type: 'decision' }, api, user)).code).toBe('invalid');
    expect(brainError(() => brain.store({ title: 'a [[b]]', content: 'x', type: 'decision' }, api, user)).code).toBe('invalid');
    expect(brainError(() => brain.store({ title: 'ok', content: 'x', type: 'gossip' as never }, api, user)).code).toBe('invalid');
    expect(brainError(() => brain.store({ title: 'ok', content: 'x'.repeat(100_001), type: 'decision' }, api, user)).code).toBe('invalid');
  });

  it('holds the write lock from lookup to insert, so another process cannot create the same title in between', () => {
    // A second connection to the same file stands in for an MCP server process; no waiting, fail fast.
    const other = new Database(handle.file);
    other.pragma('busy_timeout = 0');
    let otherWrite: unknown = 'not attempted';
    const original = brain['findLiveByTitle'].bind(brain);
    brain['findLiveByTitle'] = (...args: Parameters<typeof original>) => {
      try {
        other.prepare("INSERT INTO memories (id, title, content, type, project_id, source_kind) VALUES ('racer', 'Logging', 'x', 'decision', 'api', 'codex')").run();
        otherWrite = 'succeeded';
      } catch (error) {
        otherWrite = (error as { code?: string }).code;
      }
      return original(...args);
    };
    const result = brain.store(decision('Logging', 'from this process'), api, claude);
    other.close();
    expect(otherWrite).toBe('SQLITE_BUSY');
    expect(result).toMatchObject({ created: true, memory: { content: 'from this process' } });
    expect(brain.list({}, api).items).toHaveLength(1);
  });

  it('reports renaming onto an existing title as a conflict', () => {
    brain.store(decision('Logging'), api, user);
    const other = brain.store(decision('Tracing'), api, user).memory;
    expect(brainError(() => brain.store({ ...decision('logging'), id: other.id }, api, user)).code).toBe('conflict');
    expect(brain.recall(other.id, api, user)?.title).toBe('Tracing');
  });
});

describe('links', () => {
  it('resolves [[links]] to existing memories and keeps unknown ones pending', () => {
    const redis = brain.store(decision('Redis'), api, user).memory;
    const cache = brain.store(decision('Cache strategy', 'Use [[Redis]] and [[Varnish]]'), api, user).memory;
    expect(brain.links(cache.id, api)).toEqual({
      outgoing: [
        { id: redis.id, title: 'Redis', relation: 'references', origin: 'wikilink' },
        { id: null, title: 'Varnish', relation: 'references', origin: 'wikilink' },
      ],
      backlinks: [],
      pending: ['Varnish'],
    });
    expect(brain.links(redis.id, api).backlinks).toEqual([{ id: cache.id, title: 'Cache strategy', relation: 'references', origin: 'wikilink' }]);
  });

  it('resolves pending links when the target is created or renamed into existence', () => {
    const cache = brain.store(decision('Cache strategy', 'Use [[Varnish]] and [[CDN]]'), api, user).memory;
    const varnish = brain.store(decision('Varnish'), api, user).memory;
    const edge = brain.store(decision('Edge cache'), api, user).memory;
    brain.store({ ...decision('CDN'), id: edge.id }, api, user);
    expect(brain.links(cache.id, api).outgoing.map((link) => link.id)).toEqual([varnish.id, edge.id]);
    expect(brain.links(cache.id, api).pending).toEqual([]);
  });

  it('stores explicit links with their relation and replaces links on update', () => {
    const adr = brain.store(decision('ADR-1'), api, user).memory;
    const bug = brain.store({ ...decision('Bug 42', 'see [[ADR-1]]'), links: [{ target: 'ADR-1', relation: 'violates' }] }, api, user).memory;
    expect(brain.links(bug.id, api).outgoing).toEqual([
      { id: adr.id, title: 'ADR-1', relation: 'references', origin: 'wikilink' },
      { id: adr.id, title: 'ADR-1', relation: 'violates', origin: 'explicit' },
    ]);
    brain.store(decision('Bug 42', 'no links any more'), api, user);
    expect(brain.links(bug.id, api).outgoing).toEqual([]);
    expect(brain.links(adr.id, api).backlinks).toEqual([]);
  });

  it('lets project memories link to global ones, but not the other way round', () => {
    const style = brain.store({ ...decision('Team style'), projectId: null }, api, user).memory;
    const rule = brain.store(decision('API rule', 'Follows [[Team style]] and [[API rule 2]]'), api, user).memory;
    brain.store(decision('API rule 2'), api, user);
    expect(brain.links(rule.id, api).outgoing.map((link) => link.id)).toEqual([style.id, expect.any(String)]);

    const globalNote = brain.store({ ...decision('Global note', 'Mentions [[API rule]]'), projectId: null }, api, user).memory;
    expect(brain.links(globalNote.id, api).pending).toEqual(['API rule']);
  });

  it('a new global memory resolves pending links from any project', () => {
    const apiNote = brain.store(decision('API note', 'see [[Glossary]]'), api, user).memory;
    const webNote = brain.store(decision('Web note', 'see [[Glossary]]'), web, user).memory;
    const glossary = brain.store({ ...decision('Glossary'), projectId: null }, USER_SCOPE, user).memory;
    expect(brain.links(apiNote.id, api).outgoing[0]?.id).toBe(glossary.id);
    expect(brain.links(webNote.id, web).outgoing[0]?.id).toBe(glossary.id);
  });

  it('only shows backlinks from memories the caller can see', () => {
    const style = brain.store({ ...decision('Team style'), projectId: null }, api, user).memory;
    brain.store(decision('API rule', '[[Team style]]'), api, user);
    brain.store(decision('Web rule', '[[Team style]]'), web, user);
    expect(brain.links(style.id, api).backlinks.map((link) => link.title)).toEqual(['API rule']);
    expect(brain.links(style.id, USER_SCOPE).backlinks.map((link) => link.title).sort()).toEqual(['API rule', 'Web rule']);
  });
});

describe('scopes', () => {
  beforeEach(() => {
    brain.store(decision('API only'), api, user);
    brain.store(decision('Web only'), web, user);
    brain.store({ ...decision('Shared'), projectId: null }, api, user);
    brain.store({ ...decision('Secret'), projectId: 'secret' }, USER_SCOPE, user);
  });

  const titles = (scope: Parameters<BrainService['list']>[1]) => brain.list({}, scope).items.map((item) => item.title).sort();

  it('isolates projects from each other', () => {
    expect(titles(api)).toEqual(['API only', 'Shared']);
    expect(titles(projectScope('api', false))).toEqual(['API only']);
    expect(brain.recall('Web only', api, claude)).toBeNull();
  });

  it('global scope sees only global memories', () => {
    expect(titles(GLOBAL_SCOPE)).toEqual(['Shared']);
  });

  it('the user sees everything; other all-project views hide private projects', () => {
    expect(titles(USER_SCOPE)).toEqual(['API only', 'Secret', 'Shared', 'Web only']);
    expect(titles({ kind: 'all', includePrivate: false })).toEqual(['API only', 'Shared', 'Web only']);
  });

  it('cannot update or delete what it cannot see', () => {
    const webOnly = brain.recall('Web only', web, user);
    expect(brainError(() => brain.store({ ...decision('Web only'), id: webOnly?.id }, api, claude)).code).toBe('not_found');
    expect(brainError(() => brain.delete(webOnly?.id ?? '', api, claude)).code).toBe('not_found');
  });
});

describe('recall', () => {
  it('finds by id or title, prefers the project over global, and logs the access', () => {
    const shared = brain.store({ ...decision('Logging', 'global'), projectId: null }, api, user).memory;
    const local = brain.store(decision('Logging', 'project'), api, user).memory;
    expect(brain.recall('logging', api, claude)?.id).toBe(local.id);
    expect(brain.recall(shared.id, api, claude)?.content).toBe('global');
    expect(brain.recall('Logging', web, claude)?.id).toBe(shared.id);
    expect(handle.db.select({ client: accessLog.client, action: accessLog.action }).from(accessLog).all()).toEqual([
      { client: 'mcp:claude-code', action: 'recall' },
      { client: 'mcp:claude-code', action: 'recall' },
      { client: 'mcp:claude-code', action: 'recall' },
    ]);
  });

  it('returns links with the memory', () => {
    brain.store(decision('Redis'), api, user);
    const detail = brain.recall(brain.store(decision('Cache', '[[Redis]] [[Missing]]'), api, user).memory.id, api, user);
    expect(detail).toMatchObject({ title: 'Cache', pending: ['Missing'], outgoing: [expect.objectContaining({ title: 'Redis' }), expect.objectContaining({ title: 'Missing', id: null })] });
  });
});

describe('delete', () => {
  it('soft delete hides the memory, turns links to it into pending ones and frees the title', () => {
    const redis = brain.store(decision('Redis'), api, user).memory;
    const cache = brain.store(decision('Cache', '[[Redis]]'), api, user).memory;
    brain.delete(redis.id, api, claude);
    expect(brain.recall(redis.id, api, user)).toBeNull();
    expect(brain.links(cache.id, api).pending).toEqual(['Redis']);
    expect(brain.list({}, api).items.map((item) => item.title)).toEqual(['Cache']);

    const replacement = brain.store(decision('Redis', 'again'), api, user);
    expect(replacement.created).toBe(true);
    expect(brain.links(cache.id, api).outgoing[0]?.id).toBe(replacement.memory.id);
    expect(handle.db.select().from(memories).all()).toHaveLength(3);
  });

  it('hard delete removes the row and its history', () => {
    const { memory } = brain.store(decision('Redis'), api, user);
    brain.delete(memory.id, api, user, { hard: true });
    expect(handle.db.select().from(memories).all()).toHaveLength(0);
    expect(handle.db.select().from(memoryVersions).all()).toHaveLength(0);
  });

  it('reports unknown ids', () => {
    expect(brainError(() => brain.delete('nope', api, user)).code).toBe('not_found');
  });
});

describe('search', () => {
  beforeEach(() => {
    brain.store({ ...decision('Migrações versionadas', 'Usamos Drizzle para gerar o schema.'), tags: ['db'] }, api, user);
    brain.store({ title: 'Timeout no pool', content: 'A migração do pool de conexões resolveu o timeout.', type: 'bug_fix' }, api, user);
    brain.store(decision('Web routing', 'Next.js app router'), web, user);
    brain.store({ ...decision('Glossário', 'Termos de domínio'), projectId: null }, api, user);
  });

  const titles = (hits: { title: string }[]) => hits.map((hit) => hit.title);

  it('matches ignoring accents and case, with prefixes', () => {
    expect(titles(brain.search('MIGRACOES', {}, api, claude))).toEqual(['Migrações versionadas']);
    expect(titles(brain.search('drizz', {}, api, claude))).toEqual(['Migrações versionadas']);
  });

  it('ranks title matches above content-only matches and returns snippets', () => {
    const hits = brain.search('migra', {}, api, claude);
    expect(titles(hits)).toEqual(['Migrações versionadas', 'Timeout no pool']);
    expect(hits[0]?.score).toBeGreaterThan(hits[1]?.score ?? Infinity);
    expect(hits[1]?.snippet).toContain('[migração]');
  });

  it('respects scope, filters and deletion', () => {
    expect(titles(brain.search('routing', {}, api, claude))).toEqual([]);
    expect(titles(brain.search('termos', {}, api, claude))).toEqual(['Glossário']);
    expect(titles(brain.search('migra', { type: 'bug_fix' }, api, claude))).toEqual(['Timeout no pool']);
    expect(titles(brain.search('migra', { tags: ['db'] }, api, claude))).toEqual(['Migrações versionadas']);
    const pool = brain.recall('Timeout no pool', api, user);
    brain.delete(pool?.id ?? '', api, user);
    expect(titles(brain.search('migra', {}, api, claude))).toEqual(['Migrações versionadas']);
  });

  it('never passes raw FTS syntax through', () => {
    for (const hostile of ['title:foo', '"unbalanced', 'a OR', 'NEAR(x y)', '*', '-drizzle', "'; DROP TABLE memories; --"]) {
      expect(() => brain.search(hostile, {}, api, claude)).not.toThrow();
    }
    expect(brain.search('   ', {}, api, claude)).toEqual([]);
    expect(brain.search('?!', {}, api, claude)).toEqual([]);
  });

  it('honours the limit and logs each returned hit', () => {
    expect(brain.search('migra', { limit: 1 }, api, claude)).toHaveLength(1);
    expect(handle.db.select({ action: accessLog.action }).from(accessLog).all()).toEqual([{ action: 'search_hit' }]);
  });
});

describe('list', () => {
  it('filters by type, tags and trust, newest first, with excerpts', () => {
    brain.store({ ...decision('A', 'x'.repeat(500)), tags: ['infra', 'db'] }, api, user);
    brain.store({ title: 'B', content: 'b', type: 'bug_fix', tags: ['infra'] }, api, user);
    brain.store({ ...decision('C'), tags: ['db'], trust: 'reviewed' }, api, user);

    expect(brain.list({}, api).items.map((item) => item.title)).toEqual(['C', 'B', 'A']);
    expect(brain.list({ type: 'bug_fix' }, api).items.map((item) => item.title)).toEqual(['B']);
    expect(brain.list({ tags: ['DB', 'infra'] }, api).items.map((item) => item.title)).toEqual(['A']);
    expect(brain.list({ trust: 'reviewed' }, api).items.map((item) => item.title)).toEqual(['C']);
    expect(brain.list({ type: 'decision' }, api).items.find((item) => item.title === 'A')?.excerpt).toHaveLength(240);
  });

  it('pages with an opaque cursor without skipping or repeating', () => {
    for (let i = 0; i < 7; i++) brain.store(decision(`Note ${i}`), api, user);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = brain.list({ limit: 3, ...(cursor ? { cursor } : {}) }, api);
      seen.push(...page.items.map((item) => item.title));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(['Note 6', 'Note 5', 'Note 4', 'Note 3', 'Note 2', 'Note 1', 'Note 0']);
  });

  it('filters by project within what the scope allows', () => {
    brain.store(decision('API note'), api, user);
    brain.store({ ...decision('Shared'), projectId: null }, api, user);
    expect(brain.list({ projectId: null }, USER_SCOPE).items.map((item) => item.title)).toEqual(['Shared']);
    expect(brain.list({ projectId: 'web' }, api).items).toEqual([]);
  });

  it('rejects malformed cursors', () => {
    expect(brainError(() => brain.list({ cursor: 'garbage' }, api)).code).toBe('invalid');
  });
});
