import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, projects, taskEvents, tasks, type DatabaseHandle } from '@neuralbridge/database';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskEngine } from '../src/engine.js';
import type { GitReviewStartInput } from '@neuralbridge/shared';
import { FakeAdapter, type Turn } from './fake-adapter.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
let handle: DatabaseHandle;
let root: string;

function gitRepo(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'nb-git-review-')), 'repo');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'app.ts'), 'export const answer = 41;\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=review', '-c', 'user.email=review@example.dev', ...args], { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'initial');
  writeFileSync(join(dir, 'app.ts'), 'export const answer = 42;\n');
  return dir;
}

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-git-review-db-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  root = gitRepo();
  handle.db.insert(projects).values({ id: 'review-project', name: 'Review project', rootPath: root, rules: 'Keep reviews read-only.' }).run();
});

afterEach(() => handle.close());

function reviewEngine(turns: Turn[], contextProvider?: NonNullable<ConstructorParameters<typeof TaskEngine>[0]['contextProvider']>) {
  const claude = new FakeAdapter('claude', turns);
  const codex = new FakeAdapter('codex', []);
  const engine = new TaskEngine({
    handle,
    adapters: { claude, codex, 'claude-gateway': new FakeAdapter('claude-gateway', []) },
    availability: async () => ({ claude: true, codex: true, 'claude-gateway': false }),
    ...(contextProvider ? { contextProvider } : {}),
  });
  return { engine, claude };
}

describe('Git review through the existing TaskEngine', () => {
  it('runs a real working-tree review read-only and persists structured findings', async () => {
    const finding = { severity: 'high', confidence: 'high', title: 'Off-by-one', description: 'The answer changed unexpectedly.', file: 'app.ts', startLine: 1, endLine: 1, evidence: 'answer = 41', suggestion: 'Review the changed constant.', patch: null } as const;
    const { engine, claude } = reviewEngine([{ structured: { summary: 'One finding.', findings: [finding] } }], async () => ({ text: 'RAG decision', references: ['memory://decision-1'], estimatedTokens: 3 }));
    const input: GitReviewStartInput = { projectId: 'review-project', agent: 'claude', scope: { kind: 'working-tree' } };

    const id = await engine.startGitReview(input);
    await engine.idle();

    expect(handle.db.select().from(tasks).where(eq(tasks.id, id)).get()).toMatchObject({ status: 'completed', projectId: 'review-project' });
    expect(claude.requests[0]).toMatchObject({ mode: 'read-only', cwd: root, outputSchema: expect.any(Object) });
    expect(claude.requests[0]?.prompt).toContain('dados não confiáveis');
    expect(claude.requests[0]?.prompt).toContain('app.ts');
    const event = handle.db.select().from(taskEvents).where(eq(taskEvents.taskId, id)).all().find((row) => row.kind === 'git_review_result');
    expect(JSON.parse(event?.data ?? '{}')).toMatchObject({ summary: 'One finding.', findings: [expect.objectContaining({ file: 'app.ts', severity: 'high' })] });
  });

  it('does not let invalid provider output become an approved review', async () => {
    const { engine } = reviewEngine([{ structured: { findings: [{ title: 'missing required fields' }] } }]);
    const id = await engine.startGitReview({ projectId: 'review-project', agent: 'claude', scope: { kind: 'working-tree' } });
    await engine.idle();
    expect(handle.db.select().from(tasks).where(eq(tasks.id, id)).get()).toMatchObject({ status: 'failed' });
    expect(handle.db.select().from(taskEvents).where(eq(taskEvents.taskId, id)).all().some((row) => row.kind === 'git_review_result')).toBe(false);
  });

  it('accepts a Codex JSON answer delivered as final text and still validates it', async () => {
    const finding = { severity: 'medium', confidence: 'high', title: 'Boolean bypass', description: 'The guard is always true.', file: 'app.ts', startLine: 1, endLine: 1, evidence: 'answer = 42', suggestion: 'Restore the authorization check.', patch: null };
    const codex = new FakeAdapter('codex', [{ text: JSON.stringify({ summary: 'Codex review.', findings: [finding] }) }]);
    const engine = new TaskEngine({ handle, adapters: { claude: new FakeAdapter('claude', []), codex, 'claude-gateway': new FakeAdapter('claude-gateway', []) }, availability: async () => ({ claude: true, codex: true, 'claude-gateway': false }) });
    const id = await engine.startGitReview({ projectId: 'review-project', agent: 'codex', scope: { kind: 'working-tree' } });
    await engine.idle();
    expect(handle.db.select().from(tasks).where(eq(tasks.id, id)).get()).toMatchObject({ status: 'completed' });
    expect(handle.db.select().from(taskEvents).where(eq(taskEvents.taskId, id)).all().some((row) => row.kind === 'git_review_result')).toBe(true);
  });
});
