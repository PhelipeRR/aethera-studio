import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { executionSnapshots, openDatabase, projects, taskEvents, tasks, taskSteps, tokenAnalytics, type DatabaseHandle } from '@neuralbridge/database';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskEngine, type EngineOptions } from '../src/engine.js';
import { tokenAnalyticsForTask } from '../src/analytics.js';
import { FakeAdapter, type Turn } from './fake-adapter.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
let handle: DatabaseHandle;
let root: string;

function gitRepo(): string {
  const dir = join(mkdtempSync(join(tmpdir(), 'nb-engine-')), 'projeto');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'app.ts'), 'export const a = 1;\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
  return dir;
}

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-engine-db-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  root = gitRepo();
  handle.db.insert(projects).values({ id: 'api', name: 'API', rootPath: root, rules: 'Use TypeScript estrito.' }).run();
});
afterEach(() => handle.close());

function engine(claude: Turn[] | FakeAdapter, codex: Turn[] | FakeAdapter, extra: Partial<EngineOptions> = {}) {
  const adapters = {
    claude: claude instanceof FakeAdapter ? claude : new FakeAdapter('claude', claude),
    codex: codex instanceof FakeAdapter ? codex : new FakeAdapter('codex', codex),
    'claude-gateway': new FakeAdapter('claude-gateway', []),
  };
  return { engine: new TaskEngine({ handle, adapters, availability: async () => ({ claude: true, codex: true, 'claude-gateway': false }), ...extra }), ...adapters };
}

const task = (id: string) => handle.db.select().from(tasks).where(eq(tasks.id, id)).get();
const steps = (id: string) => handle.db.select().from(taskSteps).where(eq(taskSteps.taskId, id)).orderBy(asc(taskSteps.position)).all();
const events = (id: string) => handle.db.select().from(taskEvents).where(eq(taskEvents.taskId, id)).orderBy(asc(taskEvents.id)).all();

describe('single-agent tasks', () => {
  it('reads the skill preferences on every task and records an explicit skill left out', async () => {
    let enabled = false;
    const { engine: tasksEngine, codex } = engine([], [{ text: 'ok' }, { text: 'ok' }], {
      skillPreferences: () => [{ skillId: 'late', taskTypes: [], agents: ['codex'], enabled }],
      skillContextProvider: async (ids, budget) => ({ text: `[skill://${ids[0]}] conteúdo`, references: ids.map((id) => `skill://${id}`), estimatedTokens: Math.min(4, budget) }),
    });
    const before = await tasksEngine.start({ prompt: 'Implemente o endpoint', projectId: 'api', mode: 'auto', skillIds: ['late'] });
    await tasksEngine.idle();
    expect(JSON.parse(events(before).find((event) => event.kind === 'skills_skipped')?.data ?? '{}')).toMatchObject({ skills: ['late'] });
    enabled = true;
    const after = await tasksEngine.start({ prompt: 'Implemente o endpoint', projectId: 'api', mode: 'auto', skillIds: ['late'] });
    await tasksEngine.idle();
    expect(events(after).map((event) => event.kind)).not.toContain('skills_skipped');
    expect(codex.requests[1]?.prompt).toContain('skill://late');
  });

  it('passes only selected skill context to the agent and audits it', async () => {
    const { engine: tasksEngine, codex } = engine([], [{ text: 'ok' }], {
      skillPreferences: [{ skillId: 'tests-skill', taskTypes: ['implementation'], agents: ['codex'], enabled: true }, { skillId: 'off', taskTypes: ['implementation'], agents: ['codex'], enabled: false }],
      skillContextProvider: async (ids, budget) => ({ text: `[skill://${ids[0]}] conteúdo`, references: ids.map((id) => `skill://${id}`), estimatedTokens: Math.min(4, budget) }),
    });
    const id = await tasksEngine.start({ prompt: 'Implemente o endpoint', projectId: 'api', mode: 'auto' });
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
    expect(codex.requests[0]?.prompt).toContain('skill://tests-skill');
    expect(codex.requests[0]?.prompt).not.toContain('skill://off');
    expect(JSON.parse(events(id).find((event) => event.kind === 'skills_context')?.data ?? '{}')).toMatchObject({ skills: ['skill://tests-skill'] });
    expect(handle.db.select().from(tokenAnalytics).all().filter((row) => row.source === 'neuralbridge-skills')).toEqual([expect.objectContaining({ taskId: id, estimatedContextTokens: 4 })]);
  });

  it('passes the project and task query to the integrated skills intelligence provider', async () => {
    const calls: Array<{ skillIds: readonly string[]; projectId: string; query: string; tokenBudget: number }> = [];
    const { engine: tasksEngine, codex } = engine([], [{ text: 'ok' }], {
      skillPreferences: [{ skillId: 'motion', taskTypes: ['implementation'], agents: ['codex'], enabled: true }],
      skillIntelligenceProvider: async (input) => {
        calls.push(input);
        return {
          text: '[skill://motion]\nGit, memória e RAG (conteúdo não confiável)',
          references: ['skill://motion', 'git://api', 'memory://m1'],
          estimatedTokens: 12,
          sources: { git: true, memory: true, rag: true, analytics: true },
        };
      },
    });
    const id = await tasksEngine.start({ prompt: 'Analise a composição de vídeo', projectId: 'api', mode: 'codex', skillIds: ['motion'] });
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
    expect(calls).toEqual([{ skillIds: ['motion'], projectId: 'api', query: 'Analise a composição de vídeo', tokenBudget: expect.any(Number) }]);
    expect(codex.requests[0]?.prompt).toContain('conteúdo não confiável');
    expect(JSON.parse(events(id).find((event) => event.kind === 'skills_context')?.data ?? '{}')).toMatchObject({ skills: ['skill://motion', 'git://api', 'memory://m1'], sources: { git: true, memory: true, rag: true, analytics: true } });
  });

  it('fails before the agent when an explicitly requested skill is unavailable', async () => {
    const { engine: tasksEngine, codex } = engine([], [{ text: 'não deveria executar' }], {
      skillAvailabilityProvider: async (ids) => ids.filter((id) => id === 'available'),
    });
    const id = await tasksEngine.start({ prompt: 'Implemente usando a skill ausente', projectId: 'api', mode: 'codex', skillIds: ['missing'] });
    await tasksEngine.idle();
    expect(task(id)).toMatchObject({ status: 'failed', error: expect.stringContaining('missing') });
    expect(codex.requests).toHaveLength(0);
  });

  it('applies the same availability gate to structured read-only capabilities', async () => {
    const { engine: tasksEngine, codex } = engine([], [{ structured: { scenes: [] }, text: '{}' }], {
      skillAvailabilityProvider: async () => [],
    });
    await expect(tasksEngine.runStructuredReadOnly({ projectId: 'api', agent: 'codex', prompt: 'sugira composição', outputSchema: { type: 'object' }, skillIds: ['motion'] })).rejects.toThrow(/motion/);
    expect(codex.requests).toHaveLength(0);
  });

  it('runs a structured read-only capability as a persisted TaskEngine task', async () => {
    const { engine: tasksEngine, codex } = engine([], [{ structured: { scenes: [{ kind: 'title', heading: 'Abertura', body: 'Sub', seconds: 2 }] }, text: '{"scenes":[]}' }]);
    const result = await tasksEngine.runStructuredReadOnly({ projectId: 'api', agent: 'codex', prompt: 'sugira composição', outputSchema: { type: 'object' } });
    expect(result.taskId).toEqual(expect.any(String));
    expect(result.structured).toEqual({ scenes: [{ kind: 'title', heading: 'Abertura', body: 'Sub', seconds: 2 }] });
    expect(task(result.taskId)).toMatchObject({ status: 'completed', projectId: 'api' });
    expect(codex.requests[0]).toMatchObject({ mode: 'read-only', cwd: root, outputSchema: { type: 'object' } });
  });

  it('hands the structured run images to the CLI request (vision analysis)', async () => {
    const { engine: tasksEngine, claude } = engine([{ structured: { ok: true }, text: '{}' }], []);
    const image = join(root, 'frame.jpg');
    writeFileSync(image, 'jpeg');
    await tasksEngine.runStructuredReadOnly({ projectId: 'api', agent: 'claude', prompt: 'descreva', outputSchema: { type: 'object' }, images: [{ path: image, name: 'frame.jpg', mime: 'image/jpeg', size: 4 }], lean: { systemPrompt: 'visão' } });
    expect(claude.requests[0]).toMatchObject({ images: [{ path: image, mime: 'image/jpeg' }], lean: { systemPrompt: 'visão' } });
  });
  it('routes, runs, records steps, usage, changed files and the final diff', async () => {
    const write: Turn = { text: 'Criei o endpoint.', act: (request) => writeFileSync(join(request.cwd, 'app.ts'), 'export const a = 2;\n'), tokens: 1200 };
    const { engine: tasksEngine, codex } = engine([], [write]);
    const statuses: string[] = [];
    tasksEngine.on('task', (update) => update.kind === 'status' && statuses.push(update.status));

    const id = await tasksEngine.start({ prompt: 'Implemente o endpoint POST /pedidos com validação', projectId: 'api', mode: 'auto' });
    await tasksEngine.idle();

    expect(task(id)).toMatchObject({ status: 'completed', mode: 'auto', summary: 'Criei o endpoint.', error: null, startedAt: expect.any(String), finishedAt: expect.any(String) });
    expect(statuses).toEqual(['running', 'completed']);
    expect(steps(id)).toEqual([
      expect.objectContaining({ agent: 'codex', kind: 'implement', status: 'completed', sessionId: 'codex-session-0', inputTokens: 1200, outputTokens: 10, filesChanged: JSON.stringify(['app.ts']) }),
    ]);
    expect(codex.requests[0]).toMatchObject({ cwd: root, mode: 'edit' });
    expect(codex.requests[0]?.prompt).toContain('Use TypeScript estrito.');
    expect(codex.requests[0]?.prompt).toContain('Implemente o endpoint POST /pedidos');
    const kinds = events(id).map((event) => event.kind);
    expect(kinds).toEqual(expect.arrayContaining(['routed', 'session', 'usage', 'result', 'diff']));
    expect(JSON.parse(events(id).find((event) => event.kind === 'diff')?.data ?? '{}').text).toContain('+export const a = 2;');
    expect(handle.db.select().from(tokenAnalytics).all()).toEqual([
      expect.objectContaining({ taskId: id, agent: 'codex', reportedInputTokens: 1200, reportedOutputTokens: 10, source: 'provider-result' }),
    ]);
    expect(tokenAnalyticsForTask(handle, id)).toEqual([expect.objectContaining({ taskId: id, agent: 'codex', reportedInputTokens: 1200, reportedOutputTokens: 10 })]);
  });

  it('runs analysis read-only and needs no project', async () => {
    const { engine: tasksEngine, claude } = engine([{ text: 'O cache usa Redis.' }], []);
    const id = await tasksEngine.start({ prompt: 'Explique como funciona o cache de produtos', projectId: null, mode: 'auto' });
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
    expect(claude.requests[0]?.mode).toBe('read-only');
    expect(claude.requests[0]?.cwd).not.toBe(root);
  });

  it('hands a read-only task to Codex when the API reports overload only in the result text', async () => {
    const overloaded = 'API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.';
    const { engine: tasksEngine, claude, codex } = engine([{ ok: false, text: overloaded, errorOutput: null }], [{ text: 'Resposta do Codex.' }]);
    const id = await tasksEngine.start({ prompt: 'Explique como funciona o cache de produtos', projectId: null, mode: 'auto' });
    await tasksEngine.idle();
    expect(task(id)).toMatchObject({ status: 'completed', summary: 'Resposta do Codex.' });
    expect(claude.requests).toHaveLength(1);
    expect(codex.requests[0]?.mode).toBe('read-only');
    const failover = handle.db.select().from(taskEvents).where(eq(taskEvents.taskId, id)).all().find((row) => row.kind === 'agent_failover');
    expect(failover).toBeDefined();
  });

  it('lets the agent edit at full access even when the request reads as a question', async () => {
    handle.db.update(projects).set({ permissionLevel: 'full' }).where(eq(projects.id, 'api')).run();
    const { engine: tasksEngine, claude } = engine([{ text: 'Respondido.' }], []);
    const id = await tasksEngine.start({ prompt: 'como funciona o cache?', projectId: 'api', mode: 'auto' });
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
    expect(claude.requests[0]).toMatchObject({ mode: 'edit', access: { full: true } });
  });

  it('keeps an explicit read-only task read-only in a full-access project', async () => {
    handle.db.update(projects).set({ permissionLevel: 'full' }).where(eq(projects.id, 'api')).run();
    const { engine: tasksEngine, claude } = engine([{ text: 'Respondido.' }], []);
    const id = await tasksEngine.start({ prompt: 'analise o endpoint', projectId: 'api', mode: 'auto', access: 'read-only' });
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
    expect(claude.requests[0]?.mode).toBe('read-only');
    expect(claude.requests[0]?.access).toBeUndefined();
  });

  it('keeps questions read-only below full access', async () => {
    const { engine: tasksEngine, claude } = engine([{ text: 'Respondido.' }], []);
    await tasksEngine.start({ prompt: 'como funciona o cache?', projectId: 'api', mode: 'auto' });
    await tasksEngine.idle();
    expect(claude.requests[0]?.mode).toBe('read-only');
  });

  it('still hands a question over to Codex at full access', async () => {
    handle.db.update(projects).set({ permissionLevel: 'full' }).where(eq(projects.id, 'api')).run();
    const { engine: tasksEngine, codex } = engine([{ ok: false, text: 'API Error: 529 Overloaded.', errorOutput: null }], [{ text: 'Resposta do Codex.' }]);
    const id = await tasksEngine.start({ prompt: 'como funciona o cache?', projectId: 'api', mode: 'auto' });
    await tasksEngine.idle();
    expect(task(id)).toMatchObject({ status: 'completed', summary: 'Resposta do Codex.' });
    expect(codex.requests).toHaveLength(1);
  });

  it('does not hand over a task that edits files', async () => {
    const { engine: tasksEngine, codex } = engine([], [{ ok: false, text: 'API Error: 529 Overloaded.', errorOutput: null }]);
    const id = await tasksEngine.start({ prompt: 'Implemente o endpoint X', projectId: 'api', mode: 'codex' });
    await tasksEngine.idle();
    expect(task(id)).toMatchObject({ status: 'failed', error: expect.stringContaining('529') });
    expect(codex.requests).toHaveLength(1);
  });

  it('fails clearly when the agent fails or no agent is available', async () => {
    const failing = engine([], [{ ok: false, text: 'boom' }]);
    const id = await failing.engine.start({ prompt: 'Implemente o endpoint X', projectId: 'api', mode: 'auto' });
    await failing.engine.idle();
    expect(task(id)).toMatchObject({ status: 'failed', error: expect.stringContaining('Codex CLI') });

    const none = engine([], [], { availability: async () => ({ claude: false, codex: false, 'claude-gateway': false }) });
    const id2 = await none.engine.start({ prompt: 'Implemente o endpoint X', projectId: 'api', mode: 'auto' });
    await none.engine.idle();
    expect(task(id2)).toMatchObject({ status: 'failed', error: expect.stringContaining('Nenhum agente disponível') });
  });

  it('refuses projects whose folder is gone', async () => {
    handle.db.update(projects).set({ rootPath: join(root, 'nao-existe') }).where(eq(projects.id, 'api')).run();
    const { engine: tasksEngine } = engine([], [{}]);
    const id = await tasksEngine.start({ prompt: 'Implemente X', projectId: 'api', mode: 'codex' });
    await tasksEngine.idle();
    expect(task(id)).toMatchObject({ status: 'failed', error: expect.stringContaining('pasta do projeto') });
  });
});

describe('approval of destructive requests', () => {
  it('waits for approval, then runs', async () => {
    const { engine: tasksEngine, codex } = engine([], [{ text: 'feito' }]);
    const id = await tasksEngine.start({ prompt: 'Apague a tabela de pedidos antigos', projectId: 'api', mode: 'codex' });
    await new Promise((r) => setTimeout(r, 20));
    expect(task(id)?.status).toBe('awaiting_approval');
    expect(codex.requests).toHaveLength(0);
    expect(JSON.parse(events(id).find((event) => event.kind === 'approval_required')?.data ?? '{}')).toEqual({ reasons: [expect.stringContaining('apagar')] });
    tasksEngine.approve(id);
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
  });

  it('can be cancelled instead, and approved up front', async () => {
    const { engine: tasksEngine, codex } = engine([], [{}]);
    const id = await tasksEngine.start({ prompt: 'drop the users table', projectId: 'api', mode: 'codex' });
    await new Promise((r) => setTimeout(r, 20));
    tasksEngine.cancel(id);
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('cancelled');
    expect(codex.requests).toHaveLength(0);

    const id2 = await tasksEngine.start({ prompt: 'drop the users table', projectId: 'api', mode: 'codex', approved: true });
    await tasksEngine.idle();
    expect(task(id2)?.status).toBe('completed');
  });
});

describe('one task per project at a time', () => {
  it('queues a second task in the same project and runs other projects in parallel', async () => {
    const other = gitRepo();
    handle.db.insert(projects).values({ id: 'web', name: 'Web', rootPath: other }).run();
    const order: string[] = [];
    const codex = new FakeAdapter('codex', (request) => ({
      delayMs: 80,
      act: () => order.push(`${request.cwd === root ? 'api' : 'web'}:${request.prompt.includes('primeira') ? 1 : 2}`),
    }));
    const { engine: tasksEngine } = engine([], codex);
    const first = await tasksEngine.start({ prompt: 'Implemente a primeira coisa', projectId: 'api', mode: 'codex' });
    const second = await tasksEngine.start({ prompt: 'Implemente a segunda coisa', projectId: 'api', mode: 'codex' });
    const web = await tasksEngine.start({ prompt: 'Implemente a primeira coisa web', projectId: 'web', mode: 'codex' });
    await new Promise((r) => setTimeout(r, 30));
    expect([task(first)?.status, task(second)?.status, task(web)?.status]).toEqual(['running', 'pending', 'running']);
    expect(events(second).map((event) => event.kind)).toContain('queued');
    await tasksEngine.idle();
    expect(order.indexOf('api:1')).toBeLessThan(order.indexOf('api:2'));
    expect(order.indexOf('web:1')).toBeLessThan(order.indexOf('api:2'));
  });
});

describe('cancellation', () => {
  it('pauses before agent execution and resumes idempotently', async () => {
    const { engine: tasksEngine, codex } = engine([], [{ text: 'ok' }]);
    const id = await tasksEngine.start({ prompt: 'Implemente algo pausável', projectId: 'api', mode: 'codex' });
    tasksEngine.pause(id);
    expect(task(id)?.status).toBe('paused');
    expect(codex.requests).toHaveLength(0);
    tasksEngine.pause(id);
    tasksEngine.resumePaused(id);
    tasksEngine.resumePaused(id);
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
    expect(codex.requests).toHaveLength(1);
  });
  it('stops a running agent and a queued task', async () => {
    const codex = new FakeAdapter('codex', () => ({ delayMs: 5000 }));
    const { engine: tasksEngine } = engine([], codex);
    const running = await tasksEngine.start({ prompt: 'Implemente algo longo', projectId: 'api', mode: 'codex' });
    const queued = await tasksEngine.start({ prompt: 'Implemente outra coisa', projectId: 'api', mode: 'codex' });
    while (codex.requests.length === 0) await new Promise((r) => setTimeout(r, 10)); // the agent is really running
    tasksEngine.cancel(queued);
    tasksEngine.cancel(running);
    await tasksEngine.idle();
    expect([task(running)?.status, task(queued)?.status]).toEqual(['cancelled', 'cancelled']);
    expect(codex.signals[0]?.aborted).toBe(true);
    expect(codex.requests).toHaveLength(1);
    expect(steps(running)[0]).toMatchObject({ status: 'cancelled' });
  });

  it('never starts the agent when cancelled during preparation', async () => {
    const codex = new FakeAdapter('codex', () => ({}));
    const { engine: tasksEngine } = engine([], codex);
    const id = await tasksEngine.start({ prompt: 'Implemente algo', projectId: 'api', mode: 'codex' });
    tasksEngine.cancel(id);
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('cancelled');
    expect(codex.requests).toHaveLength(0);
  });
});

const PLAN = { summary: 'Somar dois números', steps: [{ title: 'Função', instructions: 'Criar add(a,b) em math.ts', files: ['math.ts'] }], acceptance: ['add(2,3) === 5'] };
const APPROVED = { approved: true, issues: [] };
const REJECTED = { approved: false, issues: [{ description: 'Falta tratar NaN', fix: 'Lançar erro para NaN' }] };
const COMPLEX = 'Analise o módulo de cálculo e implemente a soma com testes';

describe('collaborative mode', () => {
  it('Claude plans, Codex implements, Claude reviews and approves', async () => {
    const { engine: tasksEngine, claude, codex } = engine(
      [{ structured: PLAN }, { structured: APPROVED }],
      [{ text: 'Implementei add.', act: (request) => writeFileSync(join(request.cwd, 'math.ts'), 'export const add = (a: number, b: number) => a + b;\n') }],
    );
    const statuses: string[] = [];
    tasksEngine.on('task', (update) => update.kind === 'status' && statuses.push(update.status));
    const id = await tasksEngine.start({ prompt: COMPLEX, projectId: 'api', mode: 'auto' });
    await tasksEngine.idle();

    expect(task(id)?.status).toBe('completed');
    expect(statuses).toEqual(['planning', 'running', 'validating', 'completed']);
    expect(steps(id).map((step) => [step.agent, step.kind, step.status])).toEqual([
      ['claude', 'plan', 'completed'],
      ['codex', 'implement', 'completed'],
      ['claude', 'review', 'completed'],
    ]);
    expect(claude.requests[0]).toMatchObject({ mode: 'read-only', outputSchema: expect.any(Object) });
    expect(codex.requests[0]?.prompt).toContain('Criar add(a,b) em math.ts');
    expect(codex.requests[0]?.prompt).toContain('add(2,3) === 5');
    expect(claude.requests[1]?.prompt).toContain('+export const add');
    expect(claude.requests[1]?.mode).toBe('read-only');
    // The reviewer can run tests to verify, but cannot edit.
    expect(claude.requests[1]?.allowedTools).toEqual(expect.arrayContaining(['Read', 'Bash(npm test:*)', 'Bash(dotnet test:*)', 'Bash(git diff:*)']));
    expect(claude.requests[1]?.allowedTools).not.toEqual(expect.arrayContaining(['Edit']));
    expect(claude.requests[1]?.allowedTools).not.toEqual(expect.arrayContaining(['Write']));
  });

  it('sends review issues back to Codex, continuing its session, until approved', async () => {
    const { engine: tasksEngine, codex } = engine([{ structured: PLAN }, { structured: REJECTED }, { structured: APPROVED }], [{ text: 'v1' }, { text: 'v2' }]);
    const id = await tasksEngine.start({ prompt: COMPLEX, projectId: 'api', mode: 'collab' });
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
    expect(steps(id).map((step) => step.kind)).toEqual(['plan', 'implement', 'review', 'fix', 'review']);
    expect(codex.requests[1]?.prompt).toContain('Falta tratar NaN');
    expect(codex.requests[1]?.resumeSessionId).toBe('codex-session-0');
  });

  it('stops after the iteration limit instead of looping', async () => {
    const claude = new FakeAdapter('claude', (_request, index) => ({ structured: index === 0 ? PLAN : REJECTED }));
    const codex = new FakeAdapter('codex', () => ({ text: 'tentei' }));
    const { engine: tasksEngine } = engine(claude, codex, { limits: { maxIterations: 2 } });
    const id = await tasksEngine.start({ prompt: COMPLEX, projectId: 'api', mode: 'collab' });
    await tasksEngine.idle();
    expect(task(id)).toMatchObject({ status: 'failed', error: expect.stringContaining('2 correções') });
    expect(steps(id).map((step) => step.kind)).toEqual(['plan', 'implement', 'review', 'fix', 'review', 'fix', 'review']);
    expect(task(id)?.error).toContain('Falta tratar NaN');
  });

  it('fails when the plan does not follow the schema', async () => {
    const { engine: tasksEngine, codex } = engine([{ structured: { nonsense: true } }], []);
    const id = await tasksEngine.start({ prompt: COMPLEX, projectId: 'api', mode: 'collab' });
    await tasksEngine.idle();
    expect(task(id)).toMatchObject({ status: 'failed', error: expect.stringContaining('plano') });
    expect(codex.requests).toHaveLength(0);
  });
});

describe('limits, resume and recovery', () => {
  it('stops before the next step once the token budget is spent', async () => {
    const { engine: tasksEngine, codex } = engine([{ structured: PLAN, tokens: 900 }], [{}], { limits: { tokenBudget: 500 } });
    const id = await tasksEngine.start({ prompt: COMPLEX, projectId: 'api', mode: 'collab' });
    await tasksEngine.idle();
    expect(task(id)).toMatchObject({ status: 'failed', error: expect.stringContaining('Orçamento') });
    expect(codex.requests).toHaveLength(0);
  });

  it('tells an agent joining a conversation what the other agent did, and only that', async () => {
    const { engine: tasksEngine, claude, codex } = engine(
      [{ text: 'Ajustei o estilo.' }],
      [{ text: 'Limitei o ano a 4 dígitos.', act: (request) => writeFileSync(join(request.cwd, 'datas.ts'), 'export const b = 2;\n') }, { text: 'Feito.' }],
    );
    const first = await tasksEngine.start({ prompt: 'Corrija a data com 6 dígitos', projectId: 'api', mode: 'auto' });
    await tasksEngine.idle();
    const second = await tasksEngine.resume(first, 'ajuste o layout da tela');
    await tasksEngine.idle();

    expect(claude.requests[0]?.resumeSessionId).toBeUndefined();
    const received = claude.requests[0]?.prompt ?? '';
    expect(received).toContain('Histórico desta conversa');
    expect(received).toContain('Corrija a data com 6 dígitos');
    expect(received).toContain('Limitei o ano a 4 dígitos.');
    expect(received).toContain('datas.ts');
    expect(events(second).some((event) => event.kind === 'conversation_handoff')).toBe(true);

    await tasksEngine.resume(second, 'Implemente a validação');
    await tasksEngine.idle();
    const back = codex.requests[1]?.prompt ?? '';
    expect(codex.requests[1]?.resumeSessionId).toBe('codex-session-0');
    expect(back).toContain('Ajustei o estilo.');
    expect(back).not.toContain('Corrija a data com 6 dígitos');
  });

  it('reviews changes inside a repository of a folder that groups repositories', async () => {
    const group = mkdtempSync(join(tmpdir(), 'nb-engine-group-'));
    const repository = join(group, 'backoffice');
    mkdirSync(repository);
    const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: repository });
    git('init', '-q', '-b', 'main');
    writeFileSync(join(repository, 'app.ts'), 'export const a = 1;\n');
    git('add', '.');
    git('commit', '-q', '-m', 'inicial');
    handle.db.insert(projects).values({ id: 'grupo', name: 'Grupo', rootPath: group, rules: '' }).run();
    const { engine: tasksEngine } = engine([], [{ text: 'Feito.', act: () => writeFileSync(join(repository, 'app.ts'), 'export const key = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n') }]);
    const id = await tasksEngine.start({ prompt: 'Implemente a chave', projectId: 'grupo', mode: 'codex' });
    await vi.waitFor(() => expect(task(id)?.status).toBe('awaiting_approval'), { timeout: 10_000 });
    const report = JSON.parse(events(id).find((event) => event.kind === 'guardian')?.data ?? '{}') as { risk: string; files: number };
    expect(report).toMatchObject({ risk: 'high', files: 1 });
    tasksEngine.cancel(id);
    await tasksEngine.idle();
  });

  it('adds no history when the same agent continues its own session', async () => {
    const { engine: tasksEngine, codex } = engine([], [{ text: 'Feito.' }, { text: 'Feito de novo.' }]);
    const first = await tasksEngine.start({ prompt: 'Implemente a soma', projectId: 'api', mode: 'auto' });
    await tasksEngine.idle();
    await tasksEngine.resume(first, 'Implemente a subtração');
    await tasksEngine.idle();
    expect(codex.requests[1]?.prompt).not.toContain('Histórico desta conversa');
  });

  it('resumes a previous task in the same agent sessions', async () => {
    const { engine: tasksEngine, codex } = engine([], [{ text: 'primeira' }, { text: 'continuação' }]);
    const first = await tasksEngine.start({ prompt: 'Implemente o cadastro', projectId: 'api', mode: 'codex' });
    await tasksEngine.idle();
    const next = await tasksEngine.resume(first, 'Agora adicione validação de e-mail');
    await tasksEngine.idle();
    expect(task(next)).toMatchObject({ status: 'completed', parentTaskId: first, projectId: 'api' });
    expect(codex.requests[1]).toMatchObject({ resumeSessionId: 'codex-session-0' });
    expect(codex.requests[1]?.prompt).toContain('Agora adicione validação de e-mail');
  });

  it('marks tasks left active by a previous run as interrupted', () => {
    handle.db.insert(tasks).values([
      { id: 't1', prompt: 'x', projectId: 'api', mode: 'auto', status: 'running' },
      { id: 't2', prompt: 'x', projectId: 'api', mode: 'auto', status: 'completed' },
    ]).run();
    handle.db.insert(taskSteps).values({ id: 's1', taskId: 't1', position: 0, agent: 'codex', kind: 'implement', status: 'running' }).run();
    const { engine: tasksEngine } = engine([], []);
    expect(tasksEngine.recover()).toBe(1);
    expect(task('t1')).toMatchObject({ status: 'failed', error: expect.stringContaining('fechado') });
    expect(task('t2')?.status).toBe('completed');
    expect(steps('t1')[0]?.status).toBe('failed');
    expect(handle.db.select().from(executionSnapshots).where(eq(executionSnapshots.taskId, 't1')).get()).toMatchObject({ phase: 'failed', recoveryAction: 'resume', failureCategory: 'unknown' });
  });
});

describe('learnings', () => {
  const block = '\n\n```neuralbridge-learnings\n[{"title":"Pool do Postgres","content":"20 conexões no checkout.","type":"bug_fix","tags":[]}]\n```';

  it('takes the proposals out of the answer and hands them to the app', async () => {
    const learned: unknown[] = [];
    const { engine: tasksEngine } = engine([{ text: `O pool estava pequeno.${block}` }], [], { onLearnings: (learnings) => learned.push(learnings) });
    const id = await tasksEngine.start({ prompt: 'Explique o timeout do checkout', projectId: 'api', mode: 'claude' });
    await tasksEngine.idle();
    expect(task(id)).toMatchObject({ status: 'completed', summary: 'O pool estava pequeno.' });
    expect(learned).toEqual([{ taskId: id, projectId: 'api', agent: 'claude', proposals: [{ title: 'Pool do Postgres', content: '20 conexões no checkout.', type: 'bug_fix', tags: [] }] }]);
    expect(events(id).map((event) => event.kind)).toContain('learnings');
  });

  it('uses what the approving review proposed in collaborative mode', async () => {
    const learned: { agent: string; proposals: unknown[] }[] = [];
    const proposal = { title: 'add em math.ts', content: 'Soma fica em math.ts.', type: 'code_pattern', tags: [] };
    const { engine: tasksEngine } = engine([{ structured: PLAN }, { structured: { ...APPROVED, learnings: [proposal] } }], [{ text: 'feito' }], {
      onLearnings: (learnings) => learned.push(learnings),
    });
    await tasksEngine.start({ prompt: 'Somar', projectId: 'api', mode: 'collab' });
    await tasksEngine.idle();
    expect(learned).toEqual([expect.objectContaining({ agent: 'claude', proposals: [proposal] })]);
  });

  it('never fails the task when recording learnings fails, and asks for nothing when there is nothing', async () => {
    const calls: unknown[] = [];
    const { engine: tasksEngine } = engine([{ text: `ok${block}` }, { text: 'sem bloco' }], [], {
      onLearnings: (learnings) => {
        calls.push(learnings);
        throw new Error('banco ocupado');
      },
    });
    const id = await tasksEngine.start({ prompt: 'Explique o cache', projectId: 'api', mode: 'claude' });
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
    expect(events(id).find((event) => event.kind === 'error')?.data).toContain('banco ocupado');
    await tasksEngine.start({ prompt: 'Explique a fila', projectId: 'api', mode: 'claude' });
    await tasksEngine.idle();
    expect(calls).toHaveLength(1);
  });
});

describe('model choice', () => {
  it('passes the chosen model to the explicitly chosen agent, records it and keeps it when the conversation continues', async () => {
    const { engine: tasksEngine, claude } = engine([{ text: 'a' }, { text: 'b' }], []);
    const id = await tasksEngine.start({ prompt: 'Explique o cache', projectId: 'api', mode: 'claude', model: 'opus' });
    await tasksEngine.idle();
    expect(task(id)?.model).toBe('opus');
    expect(claude.requests[0]?.model).toBe('opus');

    const next = await tasksEngine.resume(id, 'E a fila?');
    await tasksEngine.idle();
    expect(task(next)?.model).toBe('opus');
    expect(claude.requests[1]?.model).toBe('opus');
  });

  it('leaves the model to each CLI in automatic and collaborative modes', async () => {
    const { engine: tasksEngine, claude } = engine([{ text: 'a' }], []);
    const id = await tasksEngine.start({ prompt: 'Explique o cache', projectId: 'api', mode: 'auto', model: 'opus' });
    await tasksEngine.idle();
    expect(task(id)?.model).toBeNull();
    expect(claude.requests[0]?.model).toBeUndefined();
  });
});

describe('project permission levels', () => {
  const setLevel = (permissionLevel: 'standard' | 'commands' | 'full', commands: string[] = []) =>
    handle.db.update(projects).set({ permissionLevel, allowedCommands: JSON.stringify(commands) }).where(eq(projects.id, 'api')).run();

  it('standard: edit runs get no extra access and nothing is recorded', async () => {
    const { engine: tasksEngine, codex } = engine([], [{ text: 'ok' }]);
    const id = await tasksEngine.start({ prompt: 'Implemente o endpoint', projectId: 'api', mode: 'codex' });
    await tasksEngine.idle();
    expect(codex.requests[0]).toMatchObject({ mode: 'edit' });
    expect(codex.requests[0]?.access).toBeUndefined();
    expect(events(id).some((event) => event.kind === 'access')).toBe(false);
  });

  it('commands: Claude edit runs may also run the listed command prefixes, Codex gets the network', async () => {
    setLevel('commands', ['npm run e2e', 'dotnet ef']);
    const { engine: tasksEngine, claude, codex } = engine([{ text: 'ok' }], [{ text: 'ok' }]);
    const first = await tasksEngine.start({ prompt: 'Implemente o endpoint', projectId: 'api', mode: 'claude' });
    await tasksEngine.idle();
    expect(claude.requests[0]).toMatchObject({ mode: 'edit', access: { full: false, network: true } });
    expect(claude.requests[0]?.allowedTools).toEqual(expect.arrayContaining(['Edit', 'Bash(npm test:*)', 'Bash(npm run e2e:*)', 'Bash(dotnet ef:*)']));
    expect(JSON.parse(events(first).find((event) => event.kind === 'access')?.data ?? '{}')).toEqual({ level: 'commands', commands: ['npm run e2e', 'dotnet ef'] });
    await tasksEngine.start({ prompt: 'Implemente o endpoint', projectId: 'api', mode: 'codex' });
    await tasksEngine.idle();
    expect(codex.requests[0]).toMatchObject({ mode: 'edit', access: { full: false, network: true } });
  });

  it('full: planning and review stay read-only; everything else may edit', async () => {
    setLevel('full');
    const { engine: tasksEngine, claude, codex } = engine(
      [{ structured: PLAN }, { structured: APPROVED }, { text: 'O cache usa Redis.' }],
      [{ text: 'Implementei add.' }],
    );
    const id = await tasksEngine.start({ prompt: COMPLEX, projectId: 'api', mode: 'collab' });
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
    expect(codex.requests[0]).toMatchObject({ mode: 'edit', access: { full: true, network: true } });
    expect(claude.requests.map((request) => [request.mode, request.access])).toEqual([
      ['read-only', undefined],
      ['read-only', undefined],
    ]);
    expect(JSON.parse(events(id).find((event) => event.kind === 'access')?.data ?? '{}')).toEqual({ level: 'full', commands: [] });
    await tasksEngine.start({ prompt: 'Explique como funciona o cache de produtos', projectId: 'api', mode: 'claude' });
    await tasksEngine.idle();
    expect(claude.requests[2]).toMatchObject({ mode: 'edit', access: { full: true } });
  });
});

describe('attached images', () => {
  const images = [
    { path: 'C:/nb/attachments/x/0.png', name: 'tela.png', mime: 'image/png' as const, size: 120 },
    { path: 'C:/nb/attachments/x/1.jpg', name: 'erro.jpg', mime: 'image/jpeg' as const, size: 300 },
  ];

  it('go with every step of the task, are kept with it, and do not follow to the next request', async () => {
    const { engine: tasksEngine, claude, codex } = engine(
      [{ structured: PLAN }, { structured: APPROVED }, { text: 'ok' }],
      [{ text: 'Implementei add.' }],
    );
    const id = await tasksEngine.start({ prompt: COMPLEX, projectId: 'api', mode: 'collab', images });
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
    const sent = [{ path: images[0]?.path, mime: 'image/png' }, { path: images[1]?.path, mime: 'image/jpeg' }];
    expect(claude.requests.map((request) => request.images)).toEqual([sent, sent]);
    expect(codex.requests[0]?.images).toEqual(sent);
    expect(JSON.parse(task(id)?.images ?? '[]')).toEqual(images);

    const next = await tasksEngine.resume(id, 'Explique o que mudou');
    await tasksEngine.idle();
    expect(claude.requests[2]?.images).toBeUndefined();
    expect(JSON.parse(task(next)?.images ?? 'null')).toEqual([]);
  });

  it('a continuation can bring its own images', async () => {
    const { engine: tasksEngine, claude } = engine([{ text: 'ok' }, { text: 'ok' }], []);
    const first = await tasksEngine.start({ prompt: 'Explique o cache', projectId: 'api', mode: 'claude' });
    await tasksEngine.idle();
    const next = await tasksEngine.resume(first, 'Explique o que aparece nesta tela', images.slice(0, 1));
    await tasksEngine.idle();
    expect(task(next)).toMatchObject({ status: 'completed', error: null });
    expect(claude.requests[1]?.images).toEqual([{ path: images[0]?.path, mime: 'image/png' }]);
  });
});

describe('token budget setting (Phase 22)', () => {
  it('applies a new budget to the next tasks and records it with each one', async () => {
    const { engine: tasksEngine } = engine([{ text: 'a' }, { text: 'b' }], []);
    const first = await tasksEngine.start({ prompt: 'Explique o cache', projectId: null, mode: 'claude' });
    await tasksEngine.idle();
    tasksEngine.setTokenBudget(500_000);
    const second = await tasksEngine.start({ prompt: 'Explique as filas', projectId: null, mode: 'claude' });
    await tasksEngine.idle();
    const budget = (id: string) => JSON.parse(events(id).find((event) => event.kind === 'token_budget')?.data ?? '{}').configured;
    expect([budget(first), budget(second)]).toEqual([2_000_000, 500_000]);
    expect(() => tasksEngine.setTokenBudget(0)).toThrow();
  });
});

describe('security review before completing (Phase 28)', () => {
  const secret = (request: { cwd: string }) => writeFileSync(join(request.cwd, 'config.ts'), 'export const key = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n');
  const guardian = (id: string) => JSON.parse(events(id).find((event) => event.kind === 'guardian')?.data ?? 'null') as { risk: string; findings: { rule: string; evidence: string }[] } | null;

  it('a high-risk change waits for the user; accepting completes the task', async () => {
    const { engine: tasksEngine } = engine([], [{ text: 'feito', act: secret }]);
    const id = await tasksEngine.start({ prompt: 'Implemente a configuração', projectId: 'api', mode: 'codex' });
    await expect.poll(() => task(id)?.status).toBe('awaiting_approval');
    expect(guardian(id)).toMatchObject({ risk: 'high', findings: [{ rule: 'secret' }] });
    expect(JSON.stringify(guardian(id))).not.toContain('ghp_');
    tasksEngine.approve(id);
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
    expect(events(id).some((event) => event.kind === 'guardian_accepted')).toBe(true);
  });

  it('rejecting stops the task and leaves the files for the user to review', async () => {
    const { engine: tasksEngine } = engine([], [{ text: 'feito', act: secret }]);
    const id = await tasksEngine.start({ prompt: 'Implemente a configuração', projectId: 'api', mode: 'codex' });
    await expect.poll(() => task(id)?.status, { timeout: 10_000 }).toBe('awaiting_approval');
    tasksEngine.cancel(id);
    await tasksEngine.idle();
    expect(task(id)).toMatchObject({ status: 'cancelled', error: expect.stringContaining('revisão de segurança') });
    expect(existsSync(join(root, 'config.ts'))).toBe(true);
  });

  it('reviews only what this task changed, not what was already in the working tree', async () => {
    writeFileSync(join(root, 'antigo.ts'), 'export const key = "ghp_abcdefghijklmnopqrstuvwxyz0123456789";\n');
    const { engine: tasksEngine } = engine([], [{ text: 'feito', act: (request) => writeFileSync(join(request.cwd, 'app.ts'), 'export const a = 4;\n') }]);
    const id = await tasksEngine.start({ prompt: 'Implemente o ajuste', projectId: 'api', mode: 'codex' });
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
    expect(guardian(id)).toMatchObject({ risk: 'none', files: 1 });
  });

  it('an ordinary change completes with the review on record; a read-only task is not reviewed', async () => {
    const { engine: tasksEngine } = engine([{ text: 'O cache usa Redis.' }], [{ text: 'feito', act: (request) => writeFileSync(join(request.cwd, 'app.ts'), 'export const a = 3;\n') }]);
    const edit = await tasksEngine.start({ prompt: 'Implemente o ajuste', projectId: 'api', mode: 'codex' });
    await tasksEngine.idle();
    expect(task(edit)?.status).toBe('completed');
    expect(guardian(edit)).toMatchObject({ risk: 'none', findings: [] });
    const read = await tasksEngine.start({ prompt: 'Explique como funciona o cache', projectId: 'api', mode: 'claude' });
    await tasksEngine.idle();
    expect(guardian(read)).toBeNull();
  });
});

describe('automatic fix of a failed task (Phase 26)', () => {
  const proposal = (extra: Record<string, unknown> = {}) => ({ diagnosis: 'O teste falha porque app.ts exporta 1.', evidence: ['npm test (exit 1): esperado 2'], plan: 'Trocar o valor exportado para 2.', files: ['app.ts'], validation: 'npm test', ...extra });
  const failedTask = () => {
    handle.db.insert(tasks).values({ id: 'falhou', prompt: 'Implemente o ajuste do valor', projectId: 'api', mode: 'codex', status: 'failed', error: 'Codex CLI falhou: npm test (exit 1)' }).run();
    return 'falhou';
  };
  const fix = (value: string) => ({ text: 'corrigido', act: (request: { cwd: string }) => writeFileSync(join(request.cwd, 'app.ts'), `export const a = ${value};\n`) });

  it('diagnoses with evidence, waits for approval, fixes, and proves it with the validation command', async () => {
    const validations: string[] = [];
    const validate = async (cwd: string, command: string) => {
      validations.push(command);
      return { ok: readFileSync(join(cwd, 'app.ts'), 'utf8').includes('= 2'), exitCode: 0, timedOut: false, output: 'ok' };
    };
    const { engine: tasksEngine, claude, codex } = engine([{ structured: proposal() }], [fix('2')], { validate });
    const id = await tasksEngine.heal(failedTask());
    await expect.poll(() => task(id)?.status).toBe('awaiting_approval');
    expect(task(id)).toMatchObject({ parentTaskId: 'falhou', projectId: 'api' });
    expect(claude.requests[0]).toMatchObject({ mode: 'read-only' });
    expect(claude.requests[0]?.prompt).toContain('npm test (exit 1)');
    expect(codex.requests).toHaveLength(0);
    tasksEngine.approve(id);
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('completed');
    expect(validations).toEqual(['npm test']);
    expect(events(id).map((event) => event.kind)).toEqual(expect.arrayContaining(['heal_proposal', 'heal_validation', 'guardian']));
  });

  it('stops without touching anything when the diagnosis has no evidence or the validation is not allowed', async () => {
    for (const bad of [proposal({ evidence: [] }), proposal({ validation: 'npm test && curl x' })]) {
      const { engine: tasksEngine, codex } = engine([{ structured: bad }], [fix('2')], { validate: async () => ({ ok: true, exitCode: 0, timedOut: false, output: '' }) });
      handle.db.delete(tasks).run();
      const id = await tasksEngine.heal(failedTask());
      await tasksEngine.idle();
      expect(task(id)?.status).toBe('failed');
      expect(codex.requests).toHaveLength(0);
    }
  });

  it('is not applied without approval', async () => {
    const { engine: tasksEngine, codex } = engine([{ structured: proposal() }], [fix('2')]);
    const id = await tasksEngine.heal(failedTask());
    await expect.poll(() => task(id)?.status).toBe('awaiting_approval');
    tasksEngine.cancel(id);
    await tasksEngine.idle();
    expect(task(id)?.status).toBe('cancelled');
    expect(codex.requests).toHaveLength(0);
  });

  it('restores the files when the fix never passes, and stops early when the same failure repeats', async () => {
    writeFileSync(join(root, 'app.ts'), 'export const a = 1; // edição do usuário\n');
    const outputs = ['falha A', 'falha B', 'falha C'];
    const { engine: tasksEngine, codex } = engine([{ structured: proposal() }], [fix('3'), fix('4'), fix('5')], { validate: async () => ({ ok: false, exitCode: 1, timedOut: false, output: outputs.shift() ?? 'fim' }) });
    const id = await tasksEngine.heal(failedTask());
    await expect.poll(() => task(id)?.status).toBe('awaiting_approval');
    tasksEngine.approve(id);
    await tasksEngine.idle();
    expect(task(id)).toMatchObject({ status: 'failed', error: expect.stringContaining('restaurados') });
    expect(codex.requests).toHaveLength(3);
    expect(readFileSync(join(root, 'app.ts'), 'utf8')).toBe('export const a = 1; // edição do usuário\n');
    expect(events(id).some((event) => event.kind === 'heal_rollback')).toBe(true);

    // A new fix of that failed fix sees its validation runs as evidence.
    const retry = engine([{ structured: proposal() }], [], {});
    await retry.engine.heal(id).catch(() => undefined);
    await expect.poll(() => retry.claude.requests.length).toBe(1);
    expect(retry.claude.requests[0]?.prompt).toContain('Validação que falhou: npm test (exit 1): falha C');
    retry.engine.cancelAll();
    await retry.engine.idle();

    const same = engine([{ structured: proposal() }], [fix('3'), fix('4'), fix('5')], { validate: async () => ({ ok: false, exitCode: 1, timedOut: false, output: 'sempre igual' }) });
    handle.db.delete(tasks).run();
    const again = await same.engine.heal(failedTask());
    await expect.poll(() => task(again)?.status).toBe('awaiting_approval');
    same.engine.approve(again);
    await same.engine.idle();
    expect(same.codex.requests).toHaveLength(2);
  });
});
