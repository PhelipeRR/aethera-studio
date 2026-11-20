import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { executionSnapshots, openDatabase, projects, taskEvidence, tasks, type DatabaseHandle } from '@neuralbridge/database';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskEngine, type EngineOptions } from '../src/engine.js';
import { withCorrelation } from '../src/correlation.js';
import { FakeAdapter, type Turn } from './fake-adapter.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
let handle: DatabaseHandle;
let dbFile: string;

beforeEach(() => {
  const dir = join(mkdtempSync(join(tmpdir(), 'nb-contract-')), 'projeto');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'app.ts'), 'export const a = 1;\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
  dbFile = join(mkdtempSync(join(tmpdir(), 'nb-contract-db-')), 'brain.db');
  handle = openDatabase(dbFile, { migrationsFolder: MIGRATIONS });
  handle.db.insert(projects).values({ id: 'api', name: 'API', rootPath: dir }).run();
});
afterEach(() => handle.close());

function engine(codex: Turn[] | FakeAdapter, extra: Partial<EngineOptions> = {}) {
  const adapter = codex instanceof FakeAdapter ? codex : new FakeAdapter('codex', codex);
  return { engine: new TaskEngine({ handle, adapters: { claude: new FakeAdapter('claude', []), codex: adapter, 'claude-gateway': new FakeAdapter('claude-gateway', []) }, availability: async () => ({ claude: true, codex: true, 'claude-gateway': false }), ...extra }), codex: adapter };
}
const waitFor = async (check: () => boolean) => { for (let i = 0; i < 200 && !check(); i++) await new Promise((r) => setTimeout(r, 10)); };
const status = (id: string) => handle.db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, id)).get()?.status;
const evidenceRows = (id: string) => handle.db.select().from(taskEvidence).where(eq(taskEvidence.taskId, id)).all();

describe('execution contract', () => {
  it('records one structured, redacted evidence record per agent step with the task correlation id', async () => {
    const { engine: tasksEngine } = engine([{ text: 'pronto, token=sk-abcdefghijklmnop123456 usado', act: (request) => writeFileSync(join(request.cwd, 'novo.ts'), 'x') }]);
    const id = await withCorrelation('ipc-request-1', () => tasksEngine.start({ prompt: 'Implemente algo', projectId: 'api', mode: 'codex' }));
    await tasksEngine.idle();
    const snapshot = tasksEngine.executionSnapshot(id);
    expect(snapshot).toMatchObject({ phase: 'completed', attempt: 1, correlationId: 'ipc-request-1', recoveryAction: 'none' });
    const rows = evidenceRows(id);
    expect(rows).toHaveLength(1);
    const payload = JSON.parse(rows[0]?.payload ?? '{}') as Record<string, unknown>;
    expect(payload).toMatchObject({ agent: 'codex', attempt: 1, correlationId: 'ipc-request-1', files: ['novo.ts'] });
    expect(String(payload.output)).not.toContain('sk-abcdefghijklmnop123456');
    expect(snapshot?.evidenceIds).toEqual([rows[0]?.id]);
  });

  it('records approval and its cancellation in the snapshot', async () => {
    const { engine: tasksEngine, codex } = engine([{}]);
    const id = await tasksEngine.start({ prompt: 'drop the users table', projectId: 'api', mode: 'codex' });
    await waitFor(() => status(id) === 'awaiting_approval');
    expect(tasksEngine.executionSnapshot(id)).toMatchObject({ phase: 'awaiting_approval', approval: 'pending', attempt: 0 });
    tasksEngine.cancel(id);
    await tasksEngine.idle();
    expect(codex.requests).toHaveLength(0);
    expect(tasksEngine.executionSnapshot(id)).toMatchObject({ phase: 'cancelled', approval: 'cancelled', cancellation: 'acknowledged', attempt: 0, recoveryAction: 'manual-review' });
  });

  it('marks an approved run as approved and starts exactly one attempt even when approve is sent twice', async () => {
    const { engine: tasksEngine, codex } = engine([{ text: 'feito' }]);
    const id = await tasksEngine.start({ prompt: 'Apague a tabela de pedidos antigos', projectId: 'api', mode: 'codex' });
    await waitFor(() => status(id) === 'awaiting_approval');
    tasksEngine.approve(id);
    tasksEngine.approve(id);
    await tasksEngine.idle();
    expect(codex.requests).toHaveLength(1);
    expect(tasksEngine.executionSnapshot(id)).toMatchObject({ phase: 'completed', approval: 'approved', attempt: 1 });
  });

  it('ignores an approve that arrives while the task is not awaiting approval', async () => {
    const codex = new FakeAdapter('codex', () => ({ delayMs: 80, text: 'ok' }));
    const { engine: tasksEngine } = engine(codex);
    const id = await tasksEngine.start({ prompt: 'Implemente algo', projectId: 'api', mode: 'codex' });
    await waitFor(() => codex.requests.length === 1);
    tasksEngine.approve(id);
    await tasksEngine.idle();
    expect(tasksEngine.executionSnapshot(id)).toMatchObject({ approval: 'not-required', attempt: 1 });
  });

  it('does not persist a replayed evidence event twice', async () => {
    const event = { kind: 'evidence', eventId: 'evt-1', command: 'npm test', agent: 'codex', files: [], tests: ['npm test'], output: 'ok' } as never;
    const { engine: tasksEngine } = engine([{ events: [event, event], text: 'ok' }]);
    const id = await tasksEngine.start({ prompt: 'Implemente algo', projectId: 'api', mode: 'codex' });
    await tasksEngine.idle();
    const payloads = evidenceRows(id).map((row) => JSON.parse(row.payload) as { command: string | null });
    expect(payloads.filter((payload) => payload.command === 'npm test')).toHaveLength(1);
    expect(new Set(tasksEngine.executionSnapshot(id)?.evidenceIds).size).toBe(tasksEngine.executionSnapshot(id)?.evidenceIds.length);
  });

  it('classifies a provider timeout and recommends retry', async () => {
    const { engine: tasksEngine } = engine([{ ok: false, errorOutput: 'Error: request timed out after 900000ms' }]);
    const id = await tasksEngine.start({ prompt: 'Implemente algo', projectId: 'api', mode: 'codex' });
    await tasksEngine.idle();
    expect(status(id)).toBe('failed');
    expect(tasksEngine.executionSnapshot(id)).toMatchObject({ phase: 'failed', failureCategory: 'timeout', recoveryAction: 'retry', attempt: 1 });
    expect(evidenceRows(id)).toHaveLength(1);
  });

  it('treats a missing agent CLI as a configuration problem that needs the user, not a blind retry', async () => {
    const { engine: tasksEngine, codex } = engine([{ text: 'ok' }], { availability: async () => ({ claude: false, codex: false, 'claude-gateway': false }) });
    const id = await tasksEngine.start({ prompt: 'Implemente algo', projectId: 'api', mode: 'codex' });
    await tasksEngine.idle();
    expect(codex.requests).toHaveLength(0);
    expect(status(id)).toBe('failed');
    expect(tasksEngine.executionSnapshot(id)).toMatchObject({ phase: 'failed', failureCategory: 'configuration', recoveryAction: 'manual-review', attempt: 0 });
  });

  it('stamps the snapshot and evidence with the injected clock', async () => {
    const at = new Date('2026-11-08T09:30:00.000Z');
    const { engine: tasksEngine } = engine([{ text: 'ok' }], { clock: { now: () => at } });
    const id = await tasksEngine.start({ prompt: 'Implemente algo', projectId: 'api', mode: 'codex' });
    await tasksEngine.idle();
    expect(tasksEngine.executionSnapshot(id)?.updatedAt).toBe(at.toISOString());
    expect(JSON.parse(evidenceRows(id)[0]?.payload ?? '{}')).toMatchObject({ startedAt: at.toISOString(), finishedAt: at.toISOString() });
  });

  it('keeps a valid phase while paused', async () => {
    const { engine: tasksEngine } = engine([{ text: 'ok' }]);
    const id = await tasksEngine.start({ prompt: 'Implemente algo pausável', projectId: 'api', mode: 'codex' });
    tasksEngine.pause(id);
    expect(tasksEngine.executionSnapshot(id)).toMatchObject({ checkpoint: 'paused' });
    expect(['pending', 'planning', 'awaiting_approval', 'executing', 'validating']).toContain(tasksEngine.executionSnapshot(id)?.phase);
    tasksEngine.resumePaused(id);
    await tasksEngine.idle();
    expect(tasksEngine.executionSnapshot(id)).toMatchObject({ phase: 'completed', checkpoint: null, attempt: 1 });
  });

  it('recovers a stale worker after restart, preserving attempt, evidence and correlation', async () => {
    const codex = new FakeAdapter('codex', () => ({ delayMs: 5000 }));
    const first = engine(codex).engine;
    const id = await first.start({ prompt: 'Implemente algo longo', projectId: 'api', mode: 'codex' });
    await waitFor(() => codex.requests.length === 1);
    const before = first.executionSnapshot(id);
    if (!before) throw new Error('missing snapshot');
    // The process dies: a new engine over the same database sees the task still marked active.
    const restarted = new TaskEngine({ handle: openDatabase(dbFile, { migrationsFolder: MIGRATIONS }), adapters: { claude: new FakeAdapter('claude', []), codex: new FakeAdapter('codex', []), 'claude-gateway': new FakeAdapter('claude-gateway', []) }, availability: async () => ({ claude: true, codex: true, 'claude-gateway': false }) });
    expect(restarted.recover()).toBe(1);
    expect(restarted.recover()).toBe(0);
    expect(restarted.executionSnapshot(id)).toMatchObject({ phase: 'failed', recoveryAction: 'resume', attempt: before.attempt, correlationId: before.correlationId, cancellation: 'none' });
    first.cancel(id);
    await first.idle();
  });

  it('does not touch tasks still running in this process when recovering', async () => {
    const codex = new FakeAdapter('codex', () => ({ delayMs: 200, text: 'ok' }));
    const { engine: tasksEngine } = engine(codex);
    const id = await tasksEngine.start({ prompt: 'Implemente algo', projectId: 'api', mode: 'codex' });
    await waitFor(() => codex.requests.length === 1);
    expect(tasksEngine.recover()).toBe(0);
    await tasksEngine.idle();
    expect(handle.db.select().from(executionSnapshots).where(eq(executionSnapshots.taskId, id)).get()).toMatchObject({ phase: 'completed' });
  });
});
