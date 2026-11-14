import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { learningCandidates, memories, openDatabase, projects, type DatabaseHandle } from '@neuralbridge/database';
import { DEFAULT_BRAIN_SETTINGS, type BrainSettings } from '@neuralbridge/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BrainService, LearningService, readBrainSettings, USER_SCOPE, writeBrainSettings } from '../src/index.js';

/** Fails the test (instead of a TypeError) when an expected value is missing. */
function present<T>(value: T | null | undefined): T {
  expect(value).toBeTruthy();
  return value as T;
}

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
let handle: DatabaseHandle;
let brain: BrainService;
let stored: string[];

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-learning-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  handle.db.insert(projects).values({ id: 'api', name: 'API', rootPath: 'C:\\src\\api' }).run();
  brain = new BrainService(handle);
  stored = [];
});
afterEach(() => handle.close());

function service(learning: Partial<BrainSettings['learning']> = {}) {
  writeBrainSettings(handle, { ...DEFAULT_BRAIN_SETTINGS, learning: { ...DEFAULT_BRAIN_SETTINGS.learning, ...learning } });
  return new LearningService(handle, brain, { onStored: (id) => stored.push(id) });
}

const ctx = { taskId: null, projectId: 'api', agent: 'codex' as const };
const fix = { title: 'Timeout no checkout', content: 'A causa raiz era o pool do Postgres com 5 conexões; subimos para 20.', type: 'bug_fix', tags: ['postgres'] };

describe('brain settings', () => {
  it('defaults to confirmation, and ignores a stored value that does not parse', () => {
    expect(readBrainSettings(handle)).toEqual(DEFAULT_BRAIN_SETTINGS);
    writeBrainSettings(handle, { ...DEFAULT_BRAIN_SETTINGS, backup: { intervalHours: 6, keep: 3 } });
    expect(readBrainSettings(handle).backup).toEqual({ intervalHours: 6, keep: 3 });
    handle.sqlite.prepare("UPDATE settings SET value = '{\"learning\":42}' WHERE key = 'brain'").run();
    expect(readBrainSettings(handle)).toEqual(DEFAULT_BRAIN_SETTINGS);
  });
});

describe('learning proposals', () => {
  it('queue for review in confirmation mode, and approval stores an unverified memory from the extractor', () => {
    const learning = service();
    const [outcome] = learning.propose([fix], { ...ctx, taskId: null });
    expect(outcome).toMatchObject({ status: 'pending' });
    expect(handle.db.select().from(memories).all()).toHaveLength(0);

    const [candidate] = learning.list('pending');
    expect(candidate).toMatchObject({ title: 'Timeout no checkout', type: 'bug_fix', tags: ['postgres'], projectId: 'api', projectName: 'API', agent: 'codex', mergeTarget: null });

    const { memoryId } = learning.approve(present(candidate).id);
    const memory = brain.recall(memoryId, USER_SCOPE, { kind: 'user', client: 'test' });
    // Trust keeps saying who wrote it; approving is the human review of its content (Phase 20).
    expect(memory).toMatchObject({ title: 'Timeout no checkout', projectId: 'api', trust: 'unverified', confidence: 'reviewed', source: { kind: 'extractor' } });
    expect(stored).toEqual([memoryId]);
    expect(learning.list('approved')[0]).toMatchObject({ memoryId, decidedAt: expect.any(String) });
    expect(learning.list('pending')).toEqual([]);
  });

  it('can be edited before approval, or rejected', () => {
    const learning = service();
    learning.propose([fix, { title: 'Use Redis', content: 'Cache de sessão no Redis.', type: 'decision' }], ctx);
    const [first, second] = learning.list('pending').sort((a, b) => a.title.localeCompare(b.title));
    const { memoryId } = learning.approve(present(first).id, { title: 'Pool do Postgres no checkout', type: 'learning' });
    expect(brain.recall(memoryId, USER_SCOPE, { kind: 'user', client: 'test' })).toMatchObject({ title: 'Pool do Postgres no checkout', type: 'learning' });
    learning.reject(present(second).id);
    expect(learning.list('rejected').map((candidate) => candidate.title)).toEqual(['Use Redis']);
    expect(() => learning.approve(present(second).id)).toThrow(/already/);
  });

  it('block anything that contains a secret: masked, never stored, never approvable', () => {
    const learning = service({ mode: 'categories', categories: ['bug_fix'] });
    const [outcome] = learning.propose([{ ...fix, content: 'Conecte com postgres://app:Sup3rSenha@db:5432/loja e password=hunter2hunter2' }], ctx);
    expect(outcome).toMatchObject({ status: 'blocked' });
    expect(handle.db.select().from(memories).all()).toHaveLength(0);
    const [blocked] = learning.list('blocked');
    expect(present(blocked).content).toBe('Conecte com postgres://app:***@db:5432/loja e password=***');
    expect(present(blocked).reason).toMatch(/credencial/);
    expect(JSON.stringify(handle.sqlite.prepare('SELECT * FROM learning_candidates').all())).not.toMatch(/Sup3rSenha|hunter2/);
    expect(() => learning.approve(present(blocked).id)).toThrow(/secret|segredo|credencial/i);
  });

  it('turn a near-duplicate into a suggested merge, and approving merges into the existing memory', () => {
    const existing = brain.store(
      { title: 'Pool de conexões do Postgres', content: 'Pool do Postgres com 5 conexões causa timeout no checkout.', type: 'bug_fix', projectId: 'api', tags: ['db'] },
      USER_SCOPE,
      { kind: 'user', client: 'test' },
    ).memory;
    const learning = service({ mode: 'categories', categories: ['bug_fix'] });
    const [outcome] = learning.propose([fix], ctx);
    expect(outcome).toMatchObject({ status: 'pending' }); // authorised category, but a duplicate still waits
    const [candidate] = learning.list('pending');
    expect(present(candidate).mergeTarget).toEqual({ id: existing.id, title: 'Pool de conexões do Postgres' });
    expect(present(candidate).reason).toMatch(/Parecid/);

    const { memoryId } = learning.approve(present(candidate).id);
    expect(memoryId).toBe(existing.id);
    const merged = present(brain.recall(existing.id, USER_SCOPE, { kind: 'user', client: 'test' }));
    expect(merged.content).toContain('5 conexões causa timeout');
    expect(merged.content).toContain('subimos para 20');
    expect(merged.tags).toEqual(['db', 'postgres']);
    expect(merged.version).toBe(2);
    expect(handle.db.select().from(memories).all()).toHaveLength(1);
  });

  it('a same-title proposal also merges instead of overwriting', () => {
    brain.store({ title: 'Timeout no checkout', content: 'Primeira análise.', type: 'bug_fix', projectId: 'api' }, USER_SCOPE, { kind: 'user', client: 'test' });
    const learning = service();
    learning.propose([fix], ctx);
    const [candidate] = learning.list('pending');
    expect(present(candidate).mergeTarget?.title).toBe('Timeout no checkout');
    const { memoryId } = learning.approve(present(candidate).id);
    expect(present(brain.recall(memoryId, USER_SCOPE, { kind: 'user', client: 'test' })).content).toMatch(/^Primeira análise\.\n\n.*subimos para 20/s);
  });

  it('store authorised categories at once, queue the others, and ignore everything in manual mode', () => {
    const learning = service({ mode: 'categories', categories: ['decision'] });
    const outcomes = learning.propose([{ title: 'Use Redis', content: 'Cache de sessão no Redis.', type: 'decision' }, fix], ctx);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(['approved', 'pending']);
    expect(stored).toHaveLength(1);
    expect(present(learning.list('approved')[0]).reason).toMatch(/autorizada/);

    const manual = service({ mode: 'manual' });
    expect(manual.propose([{ title: 'Outra', content: 'x', type: 'decision' }], ctx)).toEqual([]);
    expect(handle.db.select().from(learningCandidates).where(eq(learningCandidates.title, 'Outra')).all()).toEqual([]);
  });

  it('clean up malformed proposals and keep at most five per task', () => {
    const learning = service();
    const outcomes = learning.propose(
      [
        { title: '  [[Wiki]] título  ', content: 'conteúdo', type: 'inventado' },
        { title: '', content: 'sem título' },
        { content: 'só conteúdo' },
        'texto solto',
        ...Array.from({ length: 8 }, (_, i) => ({ title: `Item ${i}`, content: `conteúdo ${i}`, type: 'learning' })),
      ],
      ctx,
    );
    expect(outcomes).toHaveLength(5);
    const titles = learning.list('pending').map((candidate) => candidate.title);
    expect(titles).toContain('Wiki título');
    expect(learning.list('pending').find((candidate) => candidate.title === 'Wiki título')?.type).toBe('learning');
    expect(titles).not.toContain('');
  });

  it('do not queue the same proposal twice', () => {
    const learning = service();
    learning.propose([fix], ctx);
    learning.propose([fix], ctx);
    expect(learning.list('pending')).toHaveLength(1);
  });
});
