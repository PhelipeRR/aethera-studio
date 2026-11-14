import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { memories, openDatabase, projects, type DatabaseHandle } from '@neuralbridge/database';
import { BrainService, buildMemoryContext, HybridSearch, USER_SCOPE, type Actor } from '../src/index.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
const user: Actor = { kind: 'user', client: 'electron' };
const handles: DatabaseHandle[] = [];

afterEach(() => { for (const handle of handles.splice(0)) handle.close(); });

describe('memory confidence', () => {
  it('persists confidence and traceable task evidence without changing the source contract', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-confidence-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
    handles.push(handle);
    handle.db.insert(projects).values({ id: 'api', name: 'api', rootPath: 'C:\\src\\api' }).run();
    const brain = new BrainService(handle);
    const result = brain.store({ title: 'Timeout resolvido', content: 'Aumentar o timeout do pool resolveu o erro.', type: 'bug_fix', projectId: 'api', trust: 'reviewed', sourceRef: 'task:run-1' }, USER_SCOPE, user);
    expect(result.memory).toMatchObject({ confidence: 'reviewed', evidence: [{ kind: 'task', ref: 'task:run-1' }] });
    handle.db.update(memories).set({ confidence: 'stale' }).where(eq(memories.id, result.memory.id)).run();
    expect(brain.recall(result.memory.id, USER_SCOPE, user)).toMatchObject({ confidence: 'stale' });
  });

  function setup() {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-confidence-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
    handles.push(handle);
    return { handle, brain: new BrainService(handle) };
  }

  it('is set by the user, refused for unknown memories, and goes back to unverified when the text changes', () => {
    const { brain } = setup();
    const { memory } = brain.store({ title: 'Pool do banco', content: 'Pool com 20 conexões.', type: 'decision', projectId: null }, USER_SCOPE, user);
    expect(memory.confidence).toBe('unverified');
    expect(brain.setConfidence(memory.id, 'reviewed')).toEqual({ confidence: 'reviewed' });
    expect(brain.recall(memory.id, USER_SCOPE, user)?.confidence).toBe('reviewed');
    // Same text again: still reviewed. New text: the review no longer applies.
    brain.store({ id: memory.id, title: 'Pool do banco', content: 'Pool com 20 conexões.', type: 'decision', projectId: null }, USER_SCOPE, user);
    expect(brain.recall(memory.id, USER_SCOPE, user)?.confidence).toBe('reviewed');
    brain.store({ id: memory.id, title: 'Pool do banco', content: 'Pool com 40 conexões.', type: 'decision', projectId: null }, USER_SCOPE, user);
    expect(brain.recall(memory.id, USER_SCOPE, user)?.confidence).toBe('unverified');
    expect(() => brain.setConfidence('nao-existe', 'stale')).toThrow(expect.objectContaining({ code: 'not_found' }));
  });

  it('shows in search hits, and a stale memory ranks below an equally relevant current one', async () => {
    const { brain } = setup();
    const old = brain.store({ title: 'Cache do checkout com Redis', content: 'O checkout usa Redis para o carrinho.', type: 'decision', projectId: null }, USER_SCOPE, user).memory;
    const fresh = brain.store({ title: 'Redis no checkout', content: 'O checkout usa Redis para o carrinho.', type: 'decision', projectId: null }, USER_SCOPE, user).memory;
    brain.setConfidence(old.id, 'stale');
    const { hits } = await new HybridSearch(brain, null).search('checkout redis', {}, USER_SCOPE, user);
    expect(hits.map((hit) => [hit.id, hit.confidence])).toEqual([
      [fresh.id, 'unverified'],
      [old.id, 'stale'],
    ]);
  });

  it('warns agents about a stale memory in the task context instead of passing it as current', () => {
    const hit = { id: 'm1', title: 'Cache', type: 'decision' as const, projectId: null, tags: [], snippet: 'Usa Redis.', score: 1, matchedBy: ['text' as const] };
    expect(buildMemoryContext([{ ...hit, confidence: 'stale' }], 500).text).toContain('desatualizada');
    expect(buildMemoryContext([{ ...hit, confidence: 'reviewed' }], 500).text).not.toContain('desatualizada');
  });
});
