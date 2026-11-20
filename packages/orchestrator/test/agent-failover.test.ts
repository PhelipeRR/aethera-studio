import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, projects, taskCapacityWaits, taskEvents, tasks, type DatabaseHandle } from '@neuralbridge/database';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { availabilityFromFailure, retryAtFrom } from '../src/agent-availability.js';
import { TaskEngine, type EngineOptions } from '../src/engine.js';
import { handoffBrief } from '../src/prompts.js';
import { FakeAdapter, type Turn } from './fake-adapter.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
const LIMIT = 'You have reached your usage limit reached for this period.';
const failing = (text: string, extra: Partial<Turn> = {}): Turn => ({ ok: false, text, errorOutput: null, ...extra });
let handle: DatabaseHandle;
let root: string;

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-failover-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  root = join(mkdtempSync(join(tmpdir(), 'nb-failover-')), 'projeto');
  mkdirSync(root);
  writeFileSync(join(root, 'app.ts'), 'export const a = 1;\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
  handle.db.insert(projects).values({ id: 'api', name: 'API', rootPath: root, rules: '' }).run();
});
afterEach(() => handle.close());

function engine(claude: Turn[], codex: Turn[], extra: Partial<EngineOptions> = {}) {
  const adapters = { claude: new FakeAdapter('claude', claude), codex: new FakeAdapter('codex', codex), 'claude-gateway': new FakeAdapter('claude-gateway', []) };
  return { engine: new TaskEngine({ handle, adapters, availability: async () => ({ claude: true, codex: true, 'claude-gateway': false }), ...extra }), ...adapters };
}
const task = (id: string) => handle.db.select().from(tasks).where(eq(tasks.id, id)).get();
const events = (id: string) => handle.db.select().from(taskEvents).where(eq(taskEvents.taskId, id)).all();
const waitingFor = (id: string) => vi.waitFor(() => expect(events(id).some((event) => event.kind === 'waiting_capacity')).toBe(true), { timeout: 5_000 });

describe('agent availability', () => {
  it.each([
    ['usage limit reached', 'QUOTA_EXHAUSTED'],
    ['API Error: 429 rate limit', 'RATE_LIMITED'],
    ['Too many requests', 'RATE_LIMITED'],
    ['not logged in', 'AUTH_REQUIRED'],
    ['API Error: 529 Overloaded', 'UNAVAILABLE'],
    ['context window exceeded', null],
    ['erro de compilação', null],
  ])('reads %s', (message, expected) => expect(availabilityFromFailure(message)).toBe(expected));

  it('reports a recovery time only when the provider gave one', () => {
    const now = Date.parse('2026-10-30T12:00:00Z');
    expect(retryAtFrom('rate limit, try again in 30 seconds', now)).toBe('2026-10-30T12:00:30.000Z');
    expect(retryAtFrom('Retry-After: 120', now)).toBe('2026-10-30T12:02:00.000Z');
    expect(retryAtFrom('limit resets at 2026-10-30T15:00:00Z', now)).toBe('2026-10-30T15:00:00.000Z');
    expect(retryAtFrom('usage limit reached', now)).toBeNull();
  });
});

describe('handoff', () => {
  it('is bounded, redacted and marked as untrusted', () => {
    const brief = handoffBrief({ from: 'Claude Code', to: 'Codex CLI', reason: 'limite', request: 'x'.repeat(50_000), done: ['ghp_abcdefghijklmnopqrstuvwxyz0123456789'], files: ['a.ts'], commands: ['npm test'], lastText: 'parei aqui' });
    expect(brief.length).toBeLessThan(14_000);
    expect(brief).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz');
    expect(brief).toContain('dados não confiáveis');
    expect(brief).toContain('a.ts');
    expect(brief).toMatch(/confira o estado real/i);
  });
});

describe('failover in the Chat', () => {
  it('hands an edit over to the other agent in automatic mode, with what was done so far', async () => {
    const { engine: tasksEngine, codex, claude } = engine(
      [{ text: 'Terminei.' }],
      [failing(LIMIT, { act: (request) => writeFileSync(join(request.cwd, 'parcial.ts'), 'export const b = 2;\n') })],
    );
    const id = await tasksEngine.start({ prompt: 'Implemente o endpoint X', projectId: 'api', mode: 'auto' });
    await tasksEngine.idle();
    expect(codex.requests).toHaveLength(1);
    expect(task(id)).toMatchObject({ status: 'completed', summary: 'Terminei.' });
    const received = claude.requests[0]?.prompt ?? '';
    expect(received).toContain('parcial.ts');
    expect(received).toMatch(/confira o estado real/i);
    expect(events(id).find((event) => event.kind === 'agent_failover')?.data).toContain('codex');
  });

  it('waits for the chosen agent in manual mode instead of switching', async () => {
    const { engine: tasksEngine, claude, codex } = engine([], [failing(LIMIT), { text: 'Feito.' }]);
    const id = await tasksEngine.start({ prompt: 'Implemente o endpoint X', projectId: 'api', mode: 'codex' });
    await waitingFor(id);
    expect(claude.requests).toHaveLength(0);
    expect(task(id)?.status).toBe('paused');
    tasksEngine.retryCapacity(id);
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
    expect(codex.requests).toHaveLength(2);
  });

  it('waits when both agents are limited, and continues once when capacity returns', async () => {
    const { engine: tasksEngine, claude, codex } = engine([failing(LIMIT), { text: 'Voltei.' }], [failing(LIMIT)]);
    const id = await tasksEngine.start({ prompt: 'Explique o cache de produtos', projectId: 'api', mode: 'auto' });
    await waitingFor(id);
    const event = events(id).find((item) => item.kind === 'waiting_capacity');
    expect(JSON.parse(event?.data ?? '{}')).toMatchObject({ agents: [{ agent: 'claude', state: 'QUOTA_EXHAUSTED' }, { agent: 'codex', state: 'QUOTA_EXHAUSTED' }], retryAt: null });
    tasksEngine.retryCapacity(id);
    tasksEngine.retryCapacity(id);
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
    expect(claude.requests.length + codex.requests.length).toBe(3);
  });

  it('does not treat a login problem as a limit', async () => {
    const { engine: tasksEngine } = engine([], [failing('not logged in')]);
    const id = await tasksEngine.start({ prompt: 'Implemente o endpoint X', projectId: 'api', mode: 'auto' });
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('failed');
    expect(events(id).some((event) => event.kind === 'waiting_capacity')).toBe(false);
  });

  it('can be cancelled while waiting', async () => {
    const { engine: tasksEngine } = engine([], [failing(LIMIT)]);
    const id = await tasksEngine.start({ prompt: 'Implemente o endpoint X', projectId: 'api', mode: 'codex' });
    await waitingFor(id);
    tasksEngine.cancel(id);
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('cancelled');
    expect(handle.db.select().from(taskCapacityWaits).where(eq(taskCapacityWaits.taskId, id)).get()?.status).toBe('cancelled');
  });

  it('continues a waiting task after a restart, once', async () => {
    const first = engine([], [failing(LIMIT)]);
    const id = await first.engine.start({ prompt: 'Implemente o endpoint X', projectId: 'api', mode: 'codex' });
    await waitingFor(id);
    first.engine.cancelAll();
    await first.engine.idle();
    handle.db.update(tasks).set({ status: 'paused', error: null, finishedAt: null }).where(eq(tasks.id, id)).run();
    handle.db.update(taskCapacityWaits).set({ status: 'waiting' }).where(eq(taskCapacityWaits.taskId, id)).run();

    const second = engine([], [{ text: 'Retomado.' }]);
    expect(second.engine.recover()).toBe(0);
    expect(task(id)?.status).toBe('paused');
    expect(second.engine.resumeWaiting()).toBe(1);
    expect(second.engine.resumeWaiting()).toBe(0);
    await second.engine.idle();
    expect(task(id)).toMatchObject({ status: 'completed', summary: 'Retomado.' });
    expect(second.codex.requests).toHaveLength(1);
  });

  it('keeps a task for the person when automatic resume is off', async () => {
    const { engine: tasksEngine } = engine([], [failing('rate limit, try again in 1 seconds'), { text: 'Feito.' }]);
    const id = await tasksEngine.start({ prompt: 'Implemente o endpoint X', projectId: 'api', mode: 'codex' });
    await waitingFor(id);
    tasksEngine.setCapacityAutoResume(id, false);
    expect(handle.db.select().from(taskCapacityWaits).where(eq(taskCapacityWaits.taskId, id)).get()?.autoResume).toBe(false);
    await new Promise((done) => setTimeout(done, 1_200));
    expect(task(id)?.status).toBe('paused');
    tasksEngine.retryCapacity(id);
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
  });
});
