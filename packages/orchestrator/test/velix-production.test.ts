import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, projects, tasks, videoProjects, VelixProductionRepository, type DatabaseHandle } from '@neuralbridge/database';
import { type ProductionBrief } from '@neuralbridge/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskEngine } from '../src/engine.js';
import { ProductionRunService, type ProductionStageAdapter, type ProductionTaskPort } from '../src/velix-production.js';
import { FakeAdapter, type Turn } from './fake-adapter.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
const HASH = 'a'.repeat(64);
let dbPath: string;
let handle: DatabaseHandle;

const brief = (budgetUsd = 10): ProductionBrief => ({
  schemaVersion: 1, projectId: 'vp', format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } },
  productionType: 'documentary', topic: 'Energia solar', targetDurationSeconds: 600, language: 'pt-BR', audience: 'geral', tone: 'didático', narrativeStyle: 'explicativo', researchDepth: 'standard', sourceCount: 5, pace: 'standard', budgetUsd,
});

function repo(dir: string): string {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'a.txt'), 'a\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: dir });
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'init');
  return dir;
}

beforeEach(() => {
  dbPath = join(mkdtempSync(join(tmpdir(), 'nb-production-')), 'brain.db');
  handle = openDatabase(dbPath, { migrationsFolder: MIGRATIONS });
  const root = repo(join(mkdtempSync(join(tmpdir(), 'nb-production-root-')), 'p'));
  handle.db.insert(projects).values({ id: 'api', name: 'API', rootPath: root }).run();
  handle.db.insert(videoProjects).values({ id: 'vp', name: 'Vídeo', rootPath: join(root, 'video') }).run();
});
afterEach(() => handle.close());

const engineWith = (turns: Turn[]) => new TaskEngine({ handle, adapters: { claude: new FakeAdapter('claude', turns), codex: new FakeAdapter('codex', turns), 'claude-gateway': new FakeAdapter('claude-gateway', []) }, availability: async () => ({ claude: true, codex: true, 'claude-gateway': false }) });
function service(engine: TaskEngine) {
  const production = new ProductionRunService(new VelixProductionRepository(handle), engine);
  engine.on('task', (update) => production.onTaskUpdate(update));
  return production;
}

describe('ProductionRunService over the TaskEngine', () => {
  it('persists adapter dependencies and advances the next stage after completion', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const adapters: ProductionStageAdapter[] = [
      { kind: 'research', run: async () => { await gate; } },
      { kind: 'script', run: async (context) => { context.progress(1); } },
    ];
    const production = new ProductionRunService(new VelixProductionRepository(handle), { start: async () => 'unused', cancel: () => undefined, pause: () => undefined, resumePaused: () => undefined }, adapters);
    const run = production.create('vp', brief());
    const first = await production.scheduleAdapterStage({ runId: run.id, kind: 'research', taskProjectId: 'vp', input: { plan: 'ap-11' } });
    const second = await production.scheduleAdapterStage({ runId: run.id, kind: 'script', taskProjectId: 'vp', input: { plan: 'ap-11' }, dependsOn: ['research'] });
    expect(first.status).toBe('running');
    expect(second.status).toBe('pending');
    release();
    await production.idle();
    const state = production.state(run.id);
    expect(state.stages.map((stage) => stage.status)).toEqual(['completed', 'completed']);
    expect(state.stages[1]?.error).toBeNull();
  });

  it('runs a stage as a read-only TaskEngine task and completes it with the real cost reconciled', async () => {
    const engine = engineWith([{ text: 'roteiro pronto' }]);
    const production = service(engine);
    const run = production.create('vp', brief(), 1);
    const result = await production.scheduleStage({ runId: run.id, kind: 'script', prompt: 'Escreva o roteiro', taskProjectId: 'api', costEstimateUsd: 0.5 });
    expect(result.status).toBe('running');
    expect(production.state(run.id).budget.reserveUsd).toBeCloseTo(0.5);
    await engine.idle();
    const state = production.state(run.id);
    expect(state.stages[0]).toMatchObject({ status: 'completed', progress: 1, actualCostUsd: 0.5, taskId: result.taskId });
    expect(state.budget).toMatchObject({ reserveUsd: 0, consumedUsd: 0.5 });
    expect(state.run.actualCostUsd).toBeCloseTo(0.5);
    expect(state.run.status).toBe('running');
    const again = await production.scheduleStage({ runId: run.id, kind: 'script', prompt: 'Escreva o roteiro', taskProjectId: 'api', costEstimateUsd: 0.5 });
    expect(again).toMatchObject({ stageId: result.stageId, status: 'completed' });
    expect(handle.db.select().from(tasks).all()).toHaveLength(1);
  });

  it('holds paid work over the budget for approval without starting a task', async () => {
    const started: Array<{ prompt: string; externalRef?: { system: string; id: string; revision: number } }> = [];
    const port: ProductionTaskPort = { start: async (input) => { started.push({ prompt: input.prompt, ...(input.externalRef ? { externalRef: input.externalRef } : {}) }); return `t${started.length}`; }, cancel: () => undefined, pause: () => undefined, resumePaused: () => undefined };
    const production = new ProductionRunService(new VelixProductionRepository(handle), port);
    const run = production.create('vp', brief(1));
    const held = await production.scheduleStage({ runId: run.id, kind: 'narration', prompt: 'TTS', taskProjectId: 'api', costEstimateUsd: 2 });
    expect(held.status).toBe('awaiting_approval');
    expect(started).toHaveLength(0);
    expect(production.state(run.id).run.status).toBe('awaiting_approval');
    const approved = await production.decide(held.stageId, 'approved', 'aceito o excedente');
    expect(approved.status).toBe('running');
    expect(started).toEqual([{ prompt: 'TTS', externalRef: { system: 'velix', id: `stage/${held.stageId}/attempt/0`, revision: 0 } }]);
    expect(production.state(run.id).approvals[0]).toMatchObject({ decision: 'approved', stageId: held.stageId });
  });

  it('resumes after a restart mid-stage without duplicating the stage or its artifacts', async () => {
    const engine = engineWith([{ text: 'lento', delayMs: 60_000 }]);
    const production = service(engine);
    const run = production.create('vp', brief());
    const first = await production.scheduleStage({ runId: run.id, kind: 'research', prompt: 'Pesquise', taskProjectId: 'api', costEstimateUsd: 1 });
    const repository = new VelixProductionRepository(handle);
    repository.recordArtifact({ stageId: first.stageId, kind: 'sources', contentHash: HASH, relativePath: 'producao/fontes.json', mime: 'application/json' });
    // Simulate the app closing: the in-memory engine is gone, its task stays "running" in the database.
    engine.removeAllListeners();
    const crashed = handle;
    handle = openDatabase(dbPath, { migrationsFolder: MIGRATIONS });
    const restarted = engineWith([{ text: 'fontes prontas' }]);
    expect(restarted.recover()).toBe(1);
    const after = service(restarted);
    expect(after.recover()).toBe(1);
    let state = after.state(run.id);
    expect(state.stages).toHaveLength(1);
    expect(state.stages[0]).toMatchObject({ id: first.stageId, status: 'pending', taskId: null });
    expect(state.budget.reserveUsd).toBe(0);
    const resumed = await after.resume(run.id);
    expect(resumed).toHaveLength(1);
    await restarted.idle();
    new VelixProductionRepository(handle).recordArtifact({ stageId: first.stageId, kind: 'sources', contentHash: HASH, relativePath: 'producao/fontes.json' });
    state = after.state(run.id);
    expect(state.stages).toHaveLength(1);
    expect(state.stages[0]).toMatchObject({ status: 'completed', retryCount: 1 });
    expect(state.artifacts).toHaveLength(1);
    expect(JSON.parse(state.stages[0]?.outputArtifactIds ?? '[]')).toEqual([state.artifacts[0]?.id]);
    expect(state.budget.consumedUsd).toBeCloseTo(1);
    engine.cancelAll();
    await engine.idle();
    crashed.close();
  });

  it('keeps the provider captured at creation after the repository is reopened', () => {
    const repository = new VelixProductionRepository(handle);
    const run = repository.createRun({ projectId: 'vp', brief: brief(), agent: 'codex' });
    handle.close();
    handle = openDatabase(dbPath, { migrationsFolder: MIGRATIONS });
    const reopened = new VelixProductionRepository(handle).getRun(run.id);
    expect(reopened?.agent).toBe('codex');
    if (!reopened) throw new Error('production run disappeared after reopening the database');
    expect(new VelixProductionRepository(handle).effectiveAgent(reopened)).toBe('codex');
  });

  it('cancels every in-flight stage and refuses new work on a cancelled run', async () => {
    const engine = engineWith([{ text: 'lento', delayMs: 60_000 }]);
    const production = service(engine);
    const run = production.create('vp', brief());
    const stage = await production.scheduleStage({ runId: run.id, kind: 'storyboard', prompt: 'Storyboard', taskProjectId: 'api', costEstimateUsd: 1 });
    production.cancel(run.id);
    await engine.idle();
    const state = production.state(run.id);
    expect(state.run.status).toBe('cancelled');
    expect(state.stages[0]?.status).toBe('cancelled');
    expect(state.budget.reserveUsd).toBe(0);
    expect(handle.db.select({ status: tasks.status }).from(tasks).where(eq(tasks.id, stage.taskId ?? '')).get()?.status).toBe('cancelled');
    await expect(production.scheduleStage({ runId: run.id, kind: 'render', prompt: 'r', taskProjectId: 'api' })).rejects.toThrow(/cancelada/);
  });

  it('marks a failed task as a retryable failed stage', async () => {
    const engine = engineWith([{ ok: false, text: '', errorOutput: 'quebrou' }, { ok: false, text: '', errorOutput: 'quebrou' }]);
    const production = service(engine);
    const run = production.create('vp', brief());
    await production.scheduleStage({ runId: run.id, kind: 'quality', prompt: 'QA', taskProjectId: 'api', costEstimateUsd: 0.2 });
    await engine.idle();
    const state = production.state(run.id);
    expect(state.stages[0]?.status).toBe('failed');
    expect(JSON.parse(state.stages[0]?.error ?? '{}')).toMatchObject({ code: 'task_failed', retryable: true });
    expect(state.run.status).toBe('failed');
    expect(state.budget).toMatchObject({ reserveUsd: 0, consumedUsd: 0 });
  });
});

describe('VelixProductionRepository', () => {
  it('persists the provider chosen at creation and resolves legacy rows to Claude', () => {
    const repository = new VelixProductionRepository(handle);
    const codex = repository.createRun({ projectId: 'vp', brief: brief(), agent: 'codex' });
    expect(codex.agent).toBe('codex');
    expect(repository.effectiveAgent(codex)).toBe('codex');
    const legacy = repository.createRun({ projectId: 'vp', brief: brief() });
    expect(legacy.agent).toBeNull();
    expect(repository.effectiveAgent(legacy)).toBe('claude');
  });

  it('rejects artifact paths outside the project and computes exportability from blocking checks', () => {
    const repository = new VelixProductionRepository(handle);
    const run = repository.createRun({ projectId: 'vp', brief: brief() });
    const stage = repository.addStage({ runId: run.id, kind: 'render', status: 'running', inputHash: 'h', checkpoint: JSON.stringify({ prompt: 'p', taskProjectId: 'api' }) });
    for (const relativePath of ['../fora.mp4', 'C:/fora.mp4', '/abs.mp4', 'file:///x', 'a/../../b', String.raw`..\fora.mp4`, String.raw`a\..\..\b`, String.raw`\\server\share`]) expect(() => repository.recordArtifact({ stageId: stage.id, kind: 'video', contentHash: HASH, relativePath })).toThrow(/forbidden/);
    expect(() => repository.recordArtifact({ stageId: stage.id, kind: 'video', contentHash: 'nope' })).toThrow(/hash/);
    const blocked = repository.recordQualityReport({ runId: run.id, stageId: stage.id, checks: [{ id: 'fps', label: 'FPS', severity: 'blocking', passed: false }, { id: 'loud', label: 'Volume', severity: 'warning', passed: false }] });
    expect(blocked).toMatchObject({ blocking: true, exportable: false });
    const approved = repository.recordQualityReport({ runId: run.id, checks: [{ id: 'fps', label: 'FPS', severity: 'blocking', passed: false, approved: true }] });
    expect(approved).toMatchObject({ blocking: false, exportable: true });
    expect(repository.getBudget(run.id)).toMatchObject({ limitUsd: 10, reserveUsd: 0, consumedUsd: 0, policy: 'approval_required' });
  });
});
