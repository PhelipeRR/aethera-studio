import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, projects, tasks as taskRows, type DatabaseHandle } from '@neuralbridge/database';
import { TaskEngine } from '@neuralbridge/orchestrator';
import type { TaskChanged } from '@neuralbridge/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeAdapter, type Turn } from '../../../packages/orchestrator/test/fake-adapter.js';
import { createTaskService } from '../src/main/tasks.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../../packages/database/migrations');
let handle: DatabaseHandle;
let root: string;
let attachments: string;

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-tasks-db-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  root = mkdtempSync(join(tmpdir(), 'nb-tasks-project-'));
  attachments = mkdtempSync(join(tmpdir(), 'nb-tasks-attachments-'));
  handle.db.insert(projects).values({ id: 'api', name: 'API de pedidos', rootPath: root }).run();
});
afterEach(() => handle.close());

function service(claude: Turn[], codex: Turn[] = []) {
  const adapters = { claude: new FakeAdapter('claude', claude), codex: new FakeAdapter('codex', codex) };
  const engine = new TaskEngine({
    handle,
    adapters,
    availability: async () => ({ claude: true, codex: true }),
  });
  const changes: TaskChanged[] = [];
  const tasks = createTaskService({ handle, engine, attachmentsDir: attachments, notify: (change) => changes.push(change) });
  return { engine, tasks, changes, ...adapters };
}

describe('task service', () => {
  it('shows a finished task with project, agents, tokens, steps and the events the UI needs', async () => {
    const write: Turn = { text: 'Criei o endpoint.', act: (request) => writeFileSync(join(request.cwd, 'pedidos.ts'), 'export {}\n'), tokens: 500, events: [{ kind: 'file_change', path: 'pedidos.ts', change: 'add' }] };
    const { engine, tasks } = service([], [write]);
    const { id } = await tasks.start({ prompt: 'Implemente o endpoint de pedidos', projectId: 'api', mode: 'auto' });
    await engine.idle();

    const detail = tasks.get(id);
    expect(detail).toMatchObject({
      id,
      prompt: 'Implemente o endpoint de pedidos',
      projectId: 'api',
      projectName: 'API de pedidos',
      mode: 'auto',
      status: 'completed',
      threadId: id,
      parentTaskId: null,
      summary: 'Criei o endpoint.',
      agents: ['codex'],
      tokens: { input: 500, output: 10, cached: 0, costUsd: null },
      filesChanged: 1,
    });
    expect(detail.steps).toEqual([expect.objectContaining({ position: 0, agent: 'codex', kind: 'implement', status: 'completed', filesChanged: ['pedidos.ts'] })]);
    const kinds = detail.events.map((event) => event.kind);
    expect(kinds).toContain('routed');
    expect(kinds).toContain('file_change');
    expect(kinds).not.toContain('raw');
    expect(detail.events.find((event) => event.kind === 'routed')?.data).toMatchObject({ mode: 'codex', edit: true });
  });

  it('notifies the windows of every change and keeps each thread together', async () => {
    const { engine, tasks, changes } = service([{ text: 'Primeira resposta.' }, { text: 'Segunda resposta.' }]);
    const { id: first } = await tasks.start({ prompt: 'Explique o módulo de pedidos', projectId: 'api', mode: 'claude' });
    await engine.idle();
    const { id: second } = await tasks.resume(first, 'E o que falta testar?');
    await engine.idle();

    expect(changes.filter((change) => change.taskId === first).map((change) => change.status).filter(Boolean)).toEqual(['running', 'completed']);
    expect(tasks.get(second)).toMatchObject({ parentTaskId: first, threadId: first, mode: 'claude', projectId: 'api' });
    expect(tasks.thread(second).map((task) => task.id)).toEqual([first, second]);
    expect(tasks.thread(first).map((task) => task.summary)).toEqual(['Primeira resposta.', 'Segunda resposta.']);
  });

  it('lists newest first and filters by status, project, agent and text', async () => {
    const { engine, tasks } = service([{ text: 'a' }, { text: 'b' }], [{ ok: false }]);
    await tasks.start({ prompt: 'Explique o cache', projectId: null, mode: 'claude' });
    await engine.idle();
    await tasks.start({ prompt: 'Implemente o cache de pedidos', projectId: 'api', mode: 'codex' });
    await engine.idle();
    await tasks.start({ prompt: 'Explique as filas', projectId: 'api', mode: 'claude' });
    await engine.idle();

    expect(tasks.list({}).map((task) => task.prompt)).toEqual(['Explique as filas', 'Implemente o cache de pedidos', 'Explique o cache']);
    expect(tasks.list({ status: 'failed' }).map((task) => task.prompt)).toEqual(['Implemente o cache de pedidos']);
    expect(tasks.list({ projectId: 'api', agent: 'claude' }).map((task) => task.prompt)).toEqual(['Explique as filas']);
    expect(tasks.list({ query: 'CACHE' }).map((task) => task.prompt)).toEqual(['Implemente o cache de pedidos', 'Explique o cache']);
    expect(tasks.list({ limit: 1 })).toHaveLength(1);
  });

  it('keeps Neura background runs out of user conversations while retaining direct task access', () => {
    const { tasks } = service([]);
    handle.db.insert(taskRows).values({ id: 'neura-background', prompt: 'You are Neura, a personal desktop assistant.', projectId: null, mode: 'claude', status: 'completed', origin: 'neura' }).run();

    expect(tasks.list({})).toEqual([]);
    expect(tasks.get('neura-background')).toMatchObject({ id: 'neura-background', prompt: expect.stringContaining('You are Neura') });
  });

  it('approves and cancels through the engine and reports unknown tasks clearly', async () => {
    const { engine, tasks } = service([{ text: 'ok', delayMs: 10_000 }]);
    const { id } = await tasks.start({ prompt: 'Apague a pasta dist e explique o build', projectId: 'api', mode: 'claude' });
    await expect.poll(() => tasks.get(id).status).toBe('awaiting_approval');
    tasks.approve(id);
    await expect.poll(() => tasks.get(id).steps.length).toBe(1);
    tasks.cancel(id);
    await engine.idle();
    expect(tasks.get(id).status).toBe('cancelled');

    expect(() => tasks.get('nao-existe')).toThrow(/not_found/);
    await expect(tasks.resume('nao-existe', 'continue')).rejects.toThrow(/not_found/);
  });
});

describe('conversations', () => {
  it('can be renamed: the name shows on every task of the conversation and is searchable', async () => {
    const { engine, tasks } = service([{ text: 'a' }, { text: 'b' }]);
    const { id: first } = await tasks.start({ prompt: 'Explique o módulo de pedidos', projectId: 'api', mode: 'claude' });
    await engine.idle();
    const { id: second } = await tasks.resume(first, 'E os testes?');
    await engine.idle();

    tasks.renameThread(second, '  Pedidos: visão geral  ');
    expect(tasks.get(first).threadTitle).toBe('Pedidos: visão geral');
    expect(tasks.get(second).threadTitle).toBe('Pedidos: visão geral');
    expect(tasks.list({ query: 'visão geral' }).map((task) => task.id).sort()).toEqual([first, second].sort());

    tasks.renameThread(first, '   ');
    expect(tasks.get(second).threadTitle).toBeNull();
  });

  it('can be deleted with everything recorded for it, but not while a task in it is running', async () => {
    const { engine, tasks } = service([{ text: 'a' }, { text: 'b' }, { text: 'lento', delayMs: 10_000 }]);
    const { id: kept } = await tasks.start({ prompt: 'Explique o cache', projectId: null, mode: 'claude' });
    await engine.idle();
    const { id: first } = await tasks.start({ prompt: 'Explique as filas', projectId: 'api', mode: 'claude' });
    await engine.idle();
    const { id: running } = await tasks.resume(first, 'Continue');
    await expect.poll(() => tasks.get(running).status).toBe('running');

    expect(() => tasks.deleteThread(first)).toThrow(/conflict/);
    tasks.cancel(running);
    await engine.idle();

    expect(tasks.deleteThread(running)).toEqual({ deleted: 2 });
    expect(() => tasks.get(first)).toThrow(/not_found/);
    expect(handle.sqlite.prepare('SELECT count(*) AS n FROM task_steps WHERE task_id IN (?, ?)').get(first, running)).toEqual({ n: 0 });
    expect(tasks.list({}).map((task) => task.id)).toEqual([kept]);
  });

  it('lists the models each CLI has reported, without inventing any', async () => {
    const { engine, tasks } = service([{ text: 'a' }]);
    expect(tasks.models()).toEqual({ claude: [], codex: [] });
    await tasks.start({ prompt: 'Explique', projectId: null, mode: 'claude', model: 'opus' });
    await engine.idle();
    handle.sqlite
      .prepare("INSERT INTO task_events (task_id, step_id, kind, data) SELECT task_id, id, 'session', '{\"sessionId\":\"s\",\"model\":\"claude-opus-4-1\"}' FROM task_steps")
      .run();
    expect(tasks.models()).toEqual({ claude: ['claude-opus-4-1', 'opus'], codex: [] });
  });
});

describe('attached images', () => {
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

  it('are stored by the app, sent to the agent, shown by name and read back only through the task', async () => {
    const { engine, tasks, claude } = service([{ text: 'Vejo um botão vermelho.' }]);
    const { id } = await tasks.start({ prompt: 'Explique o que aparece na imagem', projectId: null, mode: 'claude', images: [{ name: String.raw`C:\Users\eu\tela.png`, data: PNG }] });
    await engine.idle();
    const detail = tasks.get(id);
    expect(detail.images).toEqual([{ name: 'tela.png', mime: 'image/png', size: PNG.byteLength }]);
    // The screens never get the file's location.
    expect(JSON.stringify(detail)).not.toContain('attachments');
    const sent = claude.requests[0]?.images ?? [];
    expect(sent).toEqual([{ path: expect.stringMatching(/\.png$/), mime: 'image/png' }]);
    expect(sent[0]?.path.startsWith(attachments)).toBe(true);
    expect(tasks.image(id, 0)).toBe(`data:image/png;base64,${Buffer.from(PNG).toString('base64')}`);
    expect(() => tasks.image(id, 1)).toThrow(/not_found/);
  });

  it('refuse a request with an invalid image before anything runs', async () => {
    const { tasks, claude } = service([{ text: 'nunca' }]);
    await expect(tasks.start({ prompt: 'Explique', projectId: null, mode: 'claude', images: [{ name: 'falso.png', data: Uint8Array.from([0x4d, 0x5a]) }] })).rejects.toThrow(/invalid: .*falso.png/);
    expect(tasks.list({})).toEqual([]);
    expect(claude.requests).toHaveLength(0);
    expect(readdirSync(attachments)).toEqual([]);
  });

  it('go away with their conversation', async () => {
    const { engine, tasks } = service([{ text: 'a' }, { text: 'b' }]);
    const { id: first } = await tasks.start({ prompt: 'Explique a tela', projectId: 'api', mode: 'claude', images: [{ name: 'a.png', data: PNG }] });
    await engine.idle();
    const { id: second } = await tasks.resume(first, 'Explique esta outra tela', [{ name: 'b.png', data: PNG }]);
    await engine.idle();
    expect(tasks.get(second).images).toEqual([{ name: 'b.png', mime: 'image/png', size: PNG.byteLength }]);
    expect(readdirSync(attachments)).toHaveLength(2);
    tasks.deleteThread(first);
    expect(readdirSync(attachments)).toEqual([]);
    expect(existsSync(attachments)).toBe(true);
  });
});
