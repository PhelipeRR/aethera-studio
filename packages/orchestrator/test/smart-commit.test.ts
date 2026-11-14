import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { openDatabase, projects, taskEvents, tasks, type DatabaseHandle } from '@neuralbridge/database';
import type { SmartCommitStartInput } from '@neuralbridge/shared';
import { TaskEngine } from '../src/engine.js';
import { FakeAdapter, type Turn } from './fake-adapter.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
let handle: DatabaseHandle;
let root: string;

function gitRepo(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'nb-smart-commit-')), 'repo');
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=smart', '-c', 'user.email=smart@example.dev', ...args], { cwd: dir, encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'app.ts'), 'export const answer = 41;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'initial');
  writeFileSync(join(dir, 'app.ts'), 'export const answer = 42;\n');
  git('add', 'app.ts');
  return dir;
}

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-smart-commit-db-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  root = gitRepo();
  handle.db.insert(projects).values({ id: 'smart-project', name: 'Smart project', rootPath: root, rules: 'Never commit automatically.' }).run();
});

afterEach(() => handle.close());

function smartEngine(turns: Turn[]) {
  const claude = new FakeAdapter('claude', turns);
  const codex = new FakeAdapter('codex', []);
  const engine = new TaskEngine({ handle, adapters: { claude, codex }, availability: async () => ({ claude: true, codex: true }) });
  return { engine, claude };
}

describe('Smart Commit through the existing TaskEngine', () => {
  it('reviews the staged diff read-only and persists an editable commit and PR proposal', async () => {
    const { engine, claude } = smartEngine([{ structured: {
      subject: 'fix(core): update answer',
      body: 'Keep the staged change explicit.',
      prTitle: 'Fix answer calculation',
      prBody: '## Summary\nUpdates the answer.',
      checklist: ['Tests added or updated'],
      changelog: 'Fixed the answer calculation.',
      documentationImpact: 'No documentation change identified.',
    } }]);
    const input: SmartCommitStartInput = { projectId: 'smart-project', agent: 'claude' };

    const id = await engine.startSmartCommit(input);
    await engine.idle();

    expect(handle.db.select().from(tasks).where(eq(tasks.id, id)).get()).toMatchObject({ status: 'completed' });
    expect(claude.requests[0]).toMatchObject({ mode: 'read-only', cwd: root, outputSchema: expect.any(Object) });
    expect(claude.requests[0]?.prompt).toContain('diff staged');
    const event = handle.db.select().from(taskEvents).where(eq(taskEvents.taskId, id)).all().find((row) => row.kind === 'smart_commit_result');
    expect(JSON.parse(event?.data ?? '{}')).toMatchObject({ proposal: { subject: 'fix(core): update answer', prTitle: 'Fix answer calculation' } });
  });

  it('fails without staged changes and never calls the provider', async () => {
    execFileSync('git', ['reset', '-q', 'HEAD', '--', 'app.ts'], { cwd: root, stdio: 'ignore' });
    const { engine, claude } = smartEngine([{ structured: { subject: 'fix(core): not used', body: '', prTitle: 'Not used', prBody: '', checklist: [], changelog: '', documentationImpact: '' } }]);

    const id = await engine.startSmartCommit({ projectId: 'smart-project', agent: 'claude' });
    await engine.idle();

    expect(handle.db.select().from(tasks).where(eq(tasks.id, id)).get()).toMatchObject({ status: 'failed' });
    expect(claude.requests).toHaveLength(0);
    expect(handle.db.select().from(taskEvents).where(eq(taskEvents.taskId, id)).all().some((row) => row.kind === 'smart_commit_result')).toBe(false);
  });

  it('redacts credential-shaped staged content before sending the prompt to a provider', async () => {
    writeFileSync(join(root, 'app.ts'), 'export const token = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n');
    execFileSync('git', ['add', 'app.ts'], { cwd: root, stdio: 'ignore' });
    const { engine, claude } = smartEngine([{ structured: {
      subject: 'chore: redact staged credential', body: '', prTitle: 'Redact credential', prBody: '', checklist: [], changelog: '', documentationImpact: '',
    } }]);

    const id = await engine.startSmartCommit({ projectId: 'smart-project', agent: 'claude' });
    await engine.idle();

    expect(handle.db.select().from(tasks).where(eq(tasks.id, id)).get()).toMatchObject({ status: 'completed' });
    expect(claude.requests[0]?.prompt).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });

  it('redacts credential-shaped provider output before persisting the proposal', async () => {
    const secret = 'ghp_abcdefghijklmnopqrstuvwxyz0123456789';
    const { engine } = smartEngine([{ structured: {
      subject: 'chore: sanitize proposal', body: `Provider echo: ${secret}`, prTitle: 'Sanitize proposal', prBody: '', checklist: [], changelog: '', documentationImpact: '',
    } }]);

    const id = await engine.startSmartCommit({ projectId: 'smart-project', agent: 'claude' });
    await engine.idle();

    expect(handle.db.select().from(tasks).where(eq(tasks.id, id)).get()).toMatchObject({ status: 'completed' });
    const event = handle.db.select().from(taskEvents).where(eq(taskEvents.taskId, id)).all().find((row) => row.kind === 'smart_commit_result');
    expect(event?.data).not.toContain(secret);
  });
});
