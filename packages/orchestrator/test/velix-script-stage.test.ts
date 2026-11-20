import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, projects, tasks, videoProjects, VelixProductionRepository, type DatabaseHandle } from '@neuralbridge/database';
import { countWords, type ProductionBrief } from '@neuralbridge/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskEngine, type StructuredReadOnlyInput, type StructuredReadOnlyResult } from '../src/engine.js';
import { ProductionRunService, type ProductionTaskPort } from '../src/velix-production.js';
import { chapterPrompt, createScriptStageAdapter, outlinePrompt, scriptFolder, type ScriptStageOutput } from '../src/velix-script-stage.js';
import { FakeAdapter, type Turn } from './fake-adapter.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
const REPEATED = 'A energia solar já responde por uma fatia relevante da matriz elétrica brasileira.';
let dbPath: string;
let handle: DatabaseHandle;
let videoRoot: string;

const brief = (targetWords: number): ProductionBrief => ({
  schemaVersion: 1, projectId: 'vp', format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } },
  productionType: 'documentary', topic: 'Energia solar no Brasil', targetDurationSeconds: Math.round(targetWords / 145 * 60), targetWords, language: 'pt-BR', audience: 'geral', tone: 'sóbrio', narrativeStyle: 'explicativo', researchDepth: 'standard', sourceCount: 3, pace: 'standard', budgetUsd: 10,
});

describe('long script narration guidance', () => {
  it('puts PT-BR pronunciation and optional humor rules in outline and chapter prompts', () => {
    const value = brief(300);
    const plan = [{ n: 1, targetWords: 300 }];
    const outline = { title: 'Energia', canonicalSummary: 'Resumo', entities: [], terms: [], styleDecisions: [], chapters: [{ n: 1, title: 'Abertura', beats: ['Gancho'] }] };
    const context = { canonicalSummary: 'Resumo', entities: [], terms: [], facts: [], styleDecisions: [], previousSummaries: [], previousEnding: '', currentBeats: ['Gancho'], nextBeats: [] };
    const firstPlan = plan[0];
    if (!firstPlan) throw new Error('missing chapter plan');
    expect(outlinePrompt(value, plan, '')).toContain('português brasileiro natural');
    expect(chapterPrompt(value, outline, firstPlan, 1, context, '')).toContain('humor leve e opcional');
  });
});

beforeEach(() => {
  dbPath = join(mkdtempSync(join(tmpdir(), 'nb-script-stage-')), 'brain.db');
  handle = openDatabase(dbPath, { migrationsFolder: MIGRATIONS });
  const root = join(mkdtempSync(join(tmpdir(), 'nb-script-root-')), 'p');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'a.txt'), 'a\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'init');
  videoRoot = join(root, 'video');
  handle.db.insert(projects).values({ id: 'api', name: 'API', rootPath: root }).run();
  handle.db.insert(videoProjects).values({ id: 'vp', name: 'Vídeo', rootPath: videoRoot }).run();
});
afterEach(() => handle.close());

/** The agent's side of the contract: an outline with the asked chapter count, and chapters of the asked length. */
function answer(prompt: string, options: { brokenChapter?: number } = {}): Turn {
  if (prompt.startsWith('<esboco>')) {
    const count = Number(/exatamente (\d+) capítulos/.exec(prompt)?.[1] ?? 1);
    return { structured: { title: 'Energia solar no Brasil', canonicalSummary: 'Do nicho à escala.', entities: ['ANEEL'], terms: ['geração distribuída'], styleDecisions: ['frases curtas'], chapters: Array.from({ length: count }, (_, index) => ({ n: index + 1, title: `Parte ${index + 1}`, beats: [`ponto ${index + 1}`] })) } };
  }
  const n = Number(/capítulo (\d+) de/.exec(prompt)?.[1]);
  if (n === options.brokenChapter) return { text: 'não é JSON' };
  const target = Number(/cerca de (\d+) palavras/.exec(prompt)?.[1] ?? 100);
  const sentences = Array.from({ length: Math.round(target / 11) }, (_, i) => `Capítulo ${n} traz a ideia número ${i + 1} sobre o tema central.`);
  // Chapter 2 repeats a sentence chapter 1 already said: the consolidator removes it.
  const narration = [...(n === 1 || n === 2 ? [REPEATED] : []), ...sentences].join(' ');
  return { structured: { n, title: `ignorado ${n}`, narration, summary: `Resumo do capítulo ${n}.`, facts: [`fato ${n}`], entities: [] } };
}

function engineWith(turn: (prompt: string) => Turn) {
  const fake = (id: 'claude' | 'codex') => new FakeAdapter(id, (request) => turn(request.prompt.slice(request.prompt.indexOf('<'))));
  const adapters = { claude: fake('claude'), codex: fake('codex'), 'claude-gateway': new FakeAdapter('claude-gateway', []) };
  return { engine: new TaskEngine({ handle, adapters, availability: async () => ({ claude: true, codex: true, 'claude-gateway': false }) }), claude: adapters.claude };
}
const prompts = (adapter: FakeAdapter) => adapter.requests.map((request) => request.prompt.slice(request.prompt.indexOf('<')));
const service = (port: ProductionTaskPort) => new ProductionRunService(new VelixProductionRepository(handle), port, [createScriptStageAdapter()]);
const output = (runId: string) => JSON.parse(readFileSync(join(videoRoot, scriptFolder(runId), 'roteiro.json'), 'utf8')) as ScriptStageOutput;

describe('script stage adapter', () => {
  it('writes 3.000+ words in chapter batches through the TaskEngine and consolidates without repetition', async () => {
    const { engine, claude } = engineWith((prompt) => answer(prompt));
    const production = service(engine);
    const run = production.create('vp', brief(3_200));
    const scheduled = await production.scheduleAdapterStage({ runId: run.id, kind: 'script', taskProjectId: 'api', input: { sources: 'Fonte: ANEEL 2025.' }, costEstimateUsd: 0.6 });
    expect(scheduled).toMatchObject({ status: 'running', taskId: null });
    await production.idle();
    const state = production.view(run.id);
    expect(state.stages[0]).toMatchObject({ kind: 'script', status: 'completed', progress: 1, actualCostUsd: 0.6 });
    expect(prompts(claude).map((prompt) => prompt.slice(0, 10))).toEqual(['<esboco> P', ...Array(5).fill('<capitulo>')]);
    expect(prompts(claude)[2]).toContain('"previousSummaries":["1. Parte 1: Resumo do capítulo 1."]');
    expect(prompts(claude)[0]).toContain('<referencias>Fonte: ANEEL 2025.</referencias>');
    expect(handle.db.select().from(tasks).all().every((task) => task.status === 'completed' && task.origin === 'neura')).toBe(true);
    const script = output(run.id);
    expect(script).toMatchObject({ schemaVersion: 1, mode: 'chapters', targetWords: 3_200 });
    expect(script.words).toBeGreaterThanOrEqual(3_000);
    expect(script.words).toBe(countWords(script.narration));
    expect(script.chapters?.map((chapter) => [chapter.n, chapter.title])).toEqual([1, 2, 3, 4, 5].map((n) => [n, `Parte ${n}`]));
    expect(script.removedRepetitions).toEqual([{ chapter: 2, sentence: REPEATED, firstSeenIn: 1 }]);
    expect(script.narration.split(REPEATED)).toHaveLength(2);
    expect(state.artifacts.map((artifact) => artifact.kind)).toEqual(['script-outline', ...Array(5).fill('script-chapter'), 'script']);
    expect(existsSync(join(videoRoot, scriptFolder(run.id), 'capitulo-05.json'))).toBe(true);
  });

  it('continues from the next chapter after a restart without resending finished batches or duplicating artifacts', async () => {
    // First process: the outline and chapter 1 land, chapter 2 never answers (the app closes while it runs).
    const sent: string[] = [];
    const hanging: ProductionTaskPort = {
      start: async () => 'unused', cancel: () => undefined, pause: () => undefined, resumePaused: () => undefined,
      runStructuredReadOnly: async (input: StructuredReadOnlyInput): Promise<StructuredReadOnlyResult> => {
        sent.push(input.prompt);
        if (input.prompt.includes('capítulo 2 de')) return new Promise<StructuredReadOnlyResult>(() => undefined);
        return { taskId: `t${sent.length}`, agent: 'claude', text: '', structured: answer(input.prompt).structured, sessionId: null, model: null };
      },
    };
    const first = service(hanging);
    const run = first.create('vp', brief(2_100));
    await first.scheduleAdapterStage({ runId: run.id, kind: 'script', taskProjectId: 'api', costEstimateUsd: 0.3 });
    await expect.poll(() => sent.length).toBe(3);
    const before = first.view(run.id);
    expect(before.stages[0]?.status).toBe('running');
    expect(before.artifacts.map((artifact) => artifact.kind)).toEqual(['script-outline', 'script-chapter']);

    // Second process on the same database.
    handle = openDatabase(dbPath, { migrationsFolder: MIGRATIONS });
    const { engine, claude } = engineWith((prompt) => answer(prompt));
    engine.recover();
    const second = service(engine);
    expect(second.recover()).toBe(1);
    expect(second.view(run.id).stages[0]).toMatchObject({ status: 'pending', error: { code: 'interrupted' } });
    await second.resume(run.id);
    await second.idle();
    const state = second.view(run.id);
    expect(state.stages).toHaveLength(1);
    expect(state.stages[0]).toMatchObject({ status: 'completed', retryCount: 1 });
    expect(prompts(claude).map((prompt) => /capítulo (\d+) de/.exec(prompt)?.[1])).toEqual(['2', '3']);
    expect(state.artifacts.map((artifact) => artifact.kind)).toEqual(['script-outline', ...Array(3).fill('script-chapter'), 'script']);
    expect(output(run.id).chapters?.map((chapter) => chapter.n)).toEqual([1, 2, 3]);
    expect(state.budget).toMatchObject({ reserveUsd: 0, consumedUsd: 0.3 });
  });

  it('keeps the written chapters when a batch stays out of contract, and finishes on retry', async () => {
    let broken = true;
    const { engine, claude } = engineWith((prompt) => answer(prompt, broken ? { brokenChapter: 2 } : {}));
    const production = service(engine);
    const run = production.create('vp', brief(2_100));
    await production.scheduleAdapterStage({ runId: run.id, kind: 'script', taskProjectId: 'api' });
    await production.idle();
    let state = production.view(run.id);
    expect(state.stages[0]).toMatchObject({ status: 'failed', error: { code: 'task_failed', retryable: true } });
    expect(state.stages[0]?.error?.message).toMatch(/capítulo 2 veio fora do contrato/);
    expect(state.artifacts.filter((artifact) => artifact.kind === 'script-chapter')).toHaveLength(1);
    broken = false;
    const sentBefore = claude.requests.length;
    await production.resume(run.id);
    await production.idle();
    state = production.view(run.id);
    expect(state.stages[0]?.status).toBe('completed');
    expect(prompts(claude).slice(sentBefore).map((prompt) => /capítulo (\d+) de/.exec(prompt)?.[1])).toEqual(['2', '3']);
  });

  it('pauses at a batch boundary and resumes from the saved chapters', async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((done) => { release = done; });
    const sent: string[] = [];
    const port: ProductionTaskPort = {
      start: async () => 'unused', cancel: () => undefined, pause: () => undefined, resumePaused: () => undefined,
      runStructuredReadOnly: async (input) => {
        sent.push(input.prompt);
        if (input.prompt.includes('capítulo 2 de') && sent.filter((prompt) => prompt.includes('capítulo 2 de')).length === 1) await gate;
        return { taskId: `t${sent.length}`, agent: 'claude', text: '', structured: answer(input.prompt).structured, sessionId: null, model: null };
      },
    };
    const production = service(port);
    const run = production.create('vp', brief(2_100));
    await production.scheduleAdapterStage({ runId: run.id, kind: 'script', taskProjectId: 'api', costEstimateUsd: 0.3 });
    await expect.poll(() => sent.length).toBe(3);
    production.pause(run.id);
    release?.();
    await production.idle();
    let state = production.view(run.id);
    expect(state.run.status).toBe('paused');
    expect(state.stages[0]?.status).toBe('paused');
    expect(state.budget.reserveUsd).toBe(0);
    expect(state.artifacts.filter((artifact) => artifact.kind === 'script-chapter')).toHaveLength(1);
    await production.resume(run.id);
    await production.idle();
    state = production.view(run.id);
    expect(state.stages[0]?.status).toBe('completed');
    expect(state.artifacts.filter((artifact) => artifact.kind === 'script-chapter')).toHaveLength(3);
  });

  it('keeps short productions on the Dossiê v1 contract so they still open in the Studio', async () => {
    const dossie: Turn = { structured: { narracao: 'A energia solar cresceu muito no Brasil nos últimos anos, e isso muda a conta de luz.', serie: 'Energia', cenas: [{ frase: 'A energia solar', blocos: [{ tipo: 'texto', frase: 'cresceu muito' }] }] } };
    const { engine, claude } = engineWith(() => dossie);
    const production = service(engine);
    const run = production.create('vp', brief(300));
    await production.scheduleAdapterStage({ runId: run.id, kind: 'script', taskProjectId: 'api' });
    await production.idle();
    const script = output(run.id);
    expect(script).toMatchObject({ mode: 'dossie-v1', targetWords: 300, data: { serie: 'Energia', cenas: [{ blocos: [{ tipo: 'texto' }] }] } });
    expect(prompts(claude)[0]).toMatch(/^<roteiro>/);
    expect(production.view(run.id).stages[0]?.status).toBe('completed');
  });
});
