import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, projects, VelixClaimRepository, videoProjects, VelixProductionRepository, VelixStoryboardRepository, type DatabaseHandle } from '@neuralbridge/database';
import { type MediaCandidate, type ProductionBrief, type Storyboard } from '@neuralbridge/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskEngine } from '../src/engine.js';
import { ProductionRunService } from '../src/velix-production.js';
import { createScriptStageAdapter } from '../src/velix-script-stage.js';
import { createStoryboardStageAdapter, StoryboardService, type StoryboardDeps } from '../src/velix-storyboard-stage.js';
import { FakeAdapter } from './fake-adapter.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
let dbPath: string;
let handle: DatabaseHandle;
let media: MediaCandidate[];

const brief: ProductionBrief = {
  schemaVersion: 1, projectId: 'vp', format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } },
  productionType: 'documentary', topic: 'Energia solar', targetDurationSeconds: 120, targetWords: 300, language: 'pt-BR', audience: 'geral', tone: 'sóbrio', narrativeStyle: 'explicativo', researchDepth: 'standard', sourceCount: 3, pace: 'standard', budgetUsd: 10,
};
const NARRATION = 'Os painéis solares cobrem telhados no Brasil inteiro hoje, de norte a sul do país. A instalação de painéis solares cresceu muito nas cidades pequenas do interior. As baterias guardam a energia para a noite e mudam a rede elétrica das cidades. O futuro depende das baterias, da rede elétrica e de novas regras para quem gera a própria energia.';

beforeEach(() => {
  dbPath = join(mkdtempSync(join(tmpdir(), 'nb-storyboard-')), 'brain.db');
  handle = openDatabase(dbPath, { migrationsFolder: MIGRATIONS });
  const root = join(mkdtempSync(join(tmpdir(), 'nb-storyboard-root-')), 'p');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'a.txt'), 'a\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'init');
  handle.db.insert(projects).values({ id: 'api', name: 'API', rootPath: root }).run();
  handle.db.insert(videoProjects).values({ id: 'vp', name: 'Vídeo', rootPath: join(root, 'video') }).run();
  media = [
    { referenceId: 'painel', kind: 'video', title: 'Painéis solares em telhados', publisher: 'Acervo', url: 'https://a/1', publishedAt: '2025-01-01', rightsStatus: 'verified_allowed', width: 1920, height: 1080, durationSeconds: 30 },
    { referenceId: 'bateria', kind: 'image', title: 'Baterias da rede elétrica', publisher: 'Acervo', url: 'https://a/2', publishedAt: '2025-01-01', rightsStatus: 'verified_allowed', width: 1920, height: 1080 },
    { referenceId: 'pendente', kind: 'video', title: 'Painéis solares no interior', publisher: 'Blog', url: 'https://b/3', publishedAt: null, rightsStatus: 'pending_review' },
  ];
});
afterEach(() => handle.close());

function setup(planSemanticEdit?: StoryboardDeps['planSemanticEdit']) {
  const dossie = { structured: { narracao: NARRATION, serie: 'Energia', cenas: [{ blocos: [{ tipo: 'texto', frase: 'Os painéis' }] }] } };
  const engine = new TaskEngine({ handle, adapters: { claude: new FakeAdapter('claude', () => dossie), codex: new FakeAdapter('codex', []), 'claude-gateway': new FakeAdapter('claude-gateway', []) }, availability: async () => ({ claude: true, codex: true, 'claude-gateway': false }) });
  const repository = new VelixProductionRepository(handle);
  const deps: StoryboardDeps = { storyboards: new VelixStoryboardRepository(handle), claims: new VelixClaimRepository(handle), mediaCandidates: () => media, ...(planSemanticEdit ? { planSemanticEdit } : {}) };
  const production = new ProductionRunService(repository, engine, [createScriptStageAdapter(), createStoryboardStageAdapter(deps)]);
  return { production, storyboards: deps.storyboards, service: new StoryboardService(repository, deps) };
}

describe('storyboard stage and editing', () => {
  it('generates scenes with authorized media or a declared fallback, and restores the exact edited state after a restart', async () => {
    const { production, service } = setup();
    const run = production.create('vp', brief);
    await production.scheduleAdapterStage({ runId: run.id, kind: 'script', taskProjectId: 'api' });
    await production.idle();
    await production.scheduleAdapterStage({ runId: run.id, kind: 'storyboard', taskProjectId: 'api' });
    await production.idle();
    const generated = service.view(run.id);
    if (!generated) throw new Error('storyboard não gerado');
    expect(production.view(run.id).stages.map((stage) => [stage.kind, stage.status])).toEqual([['script', 'completed'], ['storyboard', 'completed']]);
    expect(generated).toMatchObject({ version: 1, source: 'generated', renderable: true, issues: [] });
    expect(generated.scenes.length).toBeGreaterThanOrEqual(2);
    expect(generated.scenes.every((scene) => scene.visual.type === 'asset' || scene.visual.type === 'fallback')).toBe(true);
    expect(generated.scenes.some((scene) => scene.visual.type === 'asset' && scene.visual.referenceId === 'pendente')).toBe(false);
    expect(generated.scenes.map((scene) => scene.narration).join(' ')).toBe(NARRATION);

    // The pending media is listed for the scene, but not eligible.
    const firstId = generated.scenes[0]?.id ?? '';
    const candidates = service.candidates(run.id, firstId);
    expect(candidates.find((item) => item.referenceId === 'pendente')).toMatchObject({ eligible: false, rightsStatus: 'pending_review' });

    let view = await service.edit(run.id, 1, { op: 'update', sceneId: firstId, patch: { onScreenText: 'Brasil solar' } });
    view = await service.edit(run.id, view.version, { op: 'move', sceneId: firstId, toIndex: 1 });
    view = await service.edit(run.id, view.version, { op: 'replace', sceneId: firstId, visual: { type: 'asset', referenceId: 'bateria' } });
    view = await service.edit(run.id, view.version, { op: 'lock', sceneId: firstId, locked: true });
    await expect(service.edit(run.id, view.version, { op: 'replace', sceneId: view.scenes[0]?.id ?? '', visual: { type: 'asset', referenceId: 'pendente' } })).rejects.toThrow(/direitos verificados/);
    await expect(service.edit(run.id, 2, { op: 'lock', sceneId: firstId, locked: false })).rejects.toThrow(/conflict/);
    const edited = service.view(run.id);

    // Restart: a new database handle and new services read back exactly the same state, and generating again keeps it.
    handle.close();
    handle = openDatabase(dbPath, { migrationsFolder: MIGRATIONS });
    const again = setup();
    const restored = again.service.view(run.id);
    expect(restored).toEqual(edited);
    expect(restored?.version).toBe(5);
    expect(restored?.scenes[1]).toMatchObject({ id: firstId, onScreenText: 'Brasil solar', locked: true, visual: { type: 'asset', referenceId: 'bateria' } });
    await again.production.resume(run.id);
    await again.production.idle();
    expect(again.service.view(run.id)?.version).toBe(5);

    // Rights revoked after the edit: the storyboard is no longer renderable, and reselection keeps the locked scene.
    const bateria = media.find((item) => item.referenceId === 'bateria');
    if (bateria) bateria.rightsStatus = 'blocked';
    expect(again.service.view(run.id)?.issues.map((issue) => issue.code)).toContain('unauthorized_asset');
    const reselected = again.service.reselect(run.id, 5);
    expect(reselected.scenes[1]).toMatchObject({ id: firstId, locked: true });
    expect(reselected.scenes.filter((scene) => !scene.locked).every((scene) => scene.visual.type === 'fallback' || (scene.visual.type === 'asset' && scene.visual.referenceId === 'painel'))).toBe(true);
  });

  it('refuses a storyboard before there is a script', async () => {
    const { production } = setup();
    const run = production.create('vp', brief);
    await production.scheduleAdapterStage({ runId: run.id, kind: 'storyboard', taskProjectId: 'api' });
    await production.idle();
    expect(production.view(run.id).stages[0]).toMatchObject({ status: 'failed', error: { message: expect.stringMatching(/gere o roteiro/) } });
  });

  it('plans a semantic edit read-only, rerenders only the target scene and restores the previous storyboard bit-for-bit', async () => {
    let plannerCalls = 0;
    let plan: unknown = { schemaVersion: 1, command: 'troque a cena do jogo 2 por uma de combate', status: 'ready', confirmation: { required: false, question: null }, planner: { mode: 'read-only', provider: 'codex', model: 'synthetic' }, operations: [{ op: 'replace_subject_visual', subjectId: 'game-2', requestedKind: 'combat' }] };
    const { production, storyboards, service } = setup(async ({ storyboard }) => { plannerCalls += 1; expect(storyboard.narrationKey).toBe('narration-key'); return plan; });
    const run = production.create('vp', brief);
    const base: Storyboard = { schemaVersion: 1, timing: 'measured', narrationKey: 'narration-key', scenes: [
      { id: 'game-1-scene', subjectId: 'game-1', chapter: 1, narration: 'Jogo um.', startMs: 0, endMs: 1_000, claimIds: [], visualObjective: 'Mostrar jogo', sceneType: 'broll', searchTerms: ['jogo'], visual: { type: 'asset', referenceId: 'painel', title: 'Jogo um', kind: 'video', score: 1, reason: 'fixture' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'approved', audio: { relativePath: 'audio/one.wav', durationMs: 1_000, key: 'audio-one', words: [{ w: 'Jogo', startMs: 0, endMs: 400 }] } },
      { id: 'game-2-scene', subjectId: 'game-2', chapter: 1, narration: 'Jogo dois.', startMs: 1_000, endMs: 2_000, claimIds: [], visualObjective: 'Mostrar jogo', sceneType: 'broll', searchTerms: ['jogo'], visual: { type: 'asset', referenceId: 'painel', title: 'Jogo dois', kind: 'video', score: 1, reason: 'fixture' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'approved', audio: { relativePath: 'audio/two.wav', durationMs: 1_000, key: 'audio-two', words: [{ w: 'Jogo', startMs: 0, endMs: 400 }] } },
    ] };
    const saved = storyboards.save({ runId: run.id, storyboard: base, source: 'generated', baseVersion: null });
    const before = storyboards.get(run.id, saved.version);
    if (!before) throw new Error('storyboard fixture not saved');

    const applied = await service.semanticEdit(run.id, saved.version, 'troque a cena do jogo 2 por uma de combate');
    expect(plannerCalls).toBe(1);
    expect(applied).toMatchObject({ status: 'applied', affectedSceneIds: ['game-2-scene'], rerenderSegmentIds: ['game-2-scene'], ttsCalled: false, researchCalled: false });
    expect(applied.view.scenes[0]).toEqual(before.storyboard.scenes[0]);
    expect(applied.view.scenes[1]).toMatchObject({ visualObjective: 'Mostrar combate', audio: before.storyboard.scenes[1]?.audio, startMs: 1_000, endMs: 2_000 });

    const restored = service.restore(run.id, applied.view.version, before.version);
    expect(restored.scenes).toEqual(before.storyboard.scenes);
    plan = { schemaVersion: 1, command: 'troque por algo melhor', status: 'needs_confirmation', confirmation: { required: true, question: 'Qual jogo e qual tipo de cena devo trocar?' }, planner: { mode: 'read-only', provider: 'codex', model: 'synthetic' }, operations: [] };
    const confirmation = await service.semanticEdit(run.id, restored.version, 'troque por algo melhor');
    expect(confirmation.status).toBe('needs_confirmation');
    expect(confirmation.view.version).toBe(restored.version);
  });
});
