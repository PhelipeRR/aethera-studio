import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, projects, taskEvents, tasks, type DatabaseHandle } from '@neuralbridge/database';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskEngine, type EngineOptions } from '../src/engine.js';
import { FakeAdapter, type Turn } from './fake-adapter.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
let handle: DatabaseHandle;
let root: string;

function repository(path: string) {
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, 'a.ts'), 'export const a = 1;\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: path });
  git('init', '-q', '-b', 'main');
  git('add', '.');
  git('commit', '-q', '-m', 'inicial');
}

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-multi-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  root = mkdtempSync(join(tmpdir(), 'nb-multi-'));
  repository(join(root, 'backoffice'));
  repository(join(root, 'suporte-ms'));
  handle.db.insert(projects).values({ id: 'hepta', name: 'Hepta', rootPath: root, rules: '', kind: 'workspace' }).run();
  handle.db.insert(projects).values({ id: 'backoffice', name: 'backoffice', rootPath: join(root, 'backoffice'), rules: 'Use React.', parentProjectId: 'hepta' }).run();
  handle.db.insert(projects).values({ id: 'suporte-ms', name: 'suporte-ms', rootPath: join(root, 'suporte-ms'), rules: 'Use .NET.', parentProjectId: 'hepta' }).run();
});
afterEach(() => handle.close());

function engine(claude: Turn[], codex: Turn[] = [], extra: Partial<EngineOptions> = {}) {
  const adapters = { claude: new FakeAdapter('claude', claude), codex: new FakeAdapter('codex', codex), 'claude-gateway': new FakeAdapter('claude-gateway', []) };
  return { engine: new TaskEngine({ handle, adapters, availability: async () => ({ claude: true, codex: true, 'claude-gateway': false }), ...extra }), ...adapters };
}

describe('tasks across projects of a workspace', () => {
  it('finds the projects named in the request and gives their paths and rules', async () => {
    const { engine: tasksEngine, claude } = engine([{ text: 'ok' }]);
    await tasksEngine.start({ prompt: 'Analise a integração entre backoffice e suporte-ms', projectId: 'hepta', mode: 'claude', access: 'read-only' });
    await tasksEngine.idle();
    const prompt = claude.requests[0]?.prompt ?? '';
    expect(prompt).toContain(join(root, 'backoffice'));
    expect(prompt).toContain(join(root, 'suporte-ms'));
    expect(prompt).toContain('Use React.');
    expect(prompt).toContain('Use .NET.');
    expect(prompt).toMatch(/projeto de origem/i);
  });

  it('uses the chosen projects, and only projects of that workspace', async () => {
    handle.db.insert(projects).values({ id: 'alheio', name: 'alheio', rootPath: join(root, '..', 'alheio'), rules: 'Regra alheia.' }).run();
    const { engine: tasksEngine, claude } = engine([{ text: 'ok' }]);
    await tasksEngine.start({ prompt: 'Veja isso', projectId: 'hepta', mode: 'claude', access: 'read-only', participants: ['backoffice', 'alheio'] });
    await tasksEngine.idle();
    const prompt = claude.requests[0]?.prompt ?? '';
    expect(prompt).toContain('Use React.');
    expect(prompt).not.toContain('Regra alheia.');
    expect(prompt).not.toContain('Use .NET.');
  });

  it('brings the context of each project, labelled with its source', async () => {
    const seen: string[] = [];
    const { engine: tasksEngine, claude } = engine([{ text: 'ok' }], [], { contextProvider: async ({ projectId }) => { seen.push(projectId); return { text: `contexto de ${projectId}`, references: [], estimatedTokens: 1 }; } });
    await tasksEngine.start({ prompt: 'Veja isso', projectId: 'hepta', mode: 'claude', access: 'read-only', participants: ['backoffice'] });
    await tasksEngine.idle();
    expect(seen.sort()).toEqual(['backoffice', 'hepta']);
    expect(claude.requests[0]?.prompt).toContain('[backoffice]');
  });

  it('adds nothing to a task of a project without children', async () => {
    const { engine: tasksEngine, claude } = engine([{ text: 'ok' }]);
    await tasksEngine.start({ prompt: 'Veja isso', projectId: 'backoffice', mode: 'claude', access: 'read-only' });
    await tasksEngine.idle();
    expect(claude.requests[0]?.prompt).not.toContain('Projetos desta tarefa');
  });
});

describe('queue by folder', () => {
  it('holds a task in a child while the workspace runs, and lets sibling projects run together', async () => {
    const slow: Turn = { text: 'ok', delayMs: 400 };
    const first = engine([slow, { text: 'filho' }]);
    const workspace = await first.engine.start({ prompt: 'Implemente algo na raiz', projectId: 'hepta', mode: 'claude' });
    const child = await first.engine.start({ prompt: 'Implemente no filho', projectId: 'backoffice', mode: 'claude' });
    await first.engine.idle();
    expect(handle.db.select().from(taskEvents).where(eq(taskEvents.taskId, child)).all().some((event) => event.kind === 'queued')).toBe(true);
    expect(handle.db.select().from(tasks).where(eq(tasks.id, workspace)).get()?.status).toBe('completed');

    const second = engine([{ text: 'ok', delayMs: 200 }, { text: 'irmão' }]);
    await second.engine.start({ prompt: 'Implemente em um', projectId: 'backoffice', mode: 'claude' });
    const sibling = await second.engine.start({ prompt: 'Implemente no outro', projectId: 'suporte-ms', mode: 'claude' });
    await second.engine.idle();
    expect(handle.db.select().from(taskEvents).where(eq(taskEvents.taskId, sibling)).all().some((event) => event.kind === 'queued')).toBe(false);
  });
});

describe('permissions across the hierarchy', () => {
  it('a workspace at full access reaches its projects, as decided, and keeps their levels', async () => {
    handle.db.update(projects).set({ permissionLevel: 'full' }).where(eq(projects.id, 'hepta')).run();
    const { engine: tasksEngine, claude } = engine([{ text: 'ok' }]);
    await tasksEngine.start({ prompt: 'Implemente na raiz', projectId: 'hepta', mode: 'claude' });
    await tasksEngine.idle();
    expect(claude.requests[0]).toMatchObject({ cwd: root, access: { full: true } });
    expect(handle.db.select().from(projects).where(eq(projects.id, 'backoffice')).get()?.permissionLevel).toBe('standard');
  });

  it('a child uses only its own level, and never the level of the workspace', async () => {
    handle.db.update(projects).set({ permissionLevel: 'full' }).where(eq(projects.id, 'hepta')).run();
    const { engine: tasksEngine, claude } = engine([{ text: 'ok' }]);
    await tasksEngine.start({ prompt: 'Implemente no filho', projectId: 'backoffice', mode: 'claude' });
    await tasksEngine.idle();
    expect(claude.requests[0]?.access?.full ?? false).toBe(false);
  });

  it('the level of a child never rises to the workspace', async () => {
    handle.db.update(projects).set({ permissionLevel: 'full' }).where(eq(projects.id, 'backoffice')).run();
    const { engine: tasksEngine, claude } = engine([{ text: 'ok' }]);
    await tasksEngine.start({ prompt: 'Implemente na raiz', projectId: 'hepta', mode: 'claude' });
    await tasksEngine.idle();
    expect(claude.requests[0]?.access?.full ?? false).toBe(false);
  });
});
