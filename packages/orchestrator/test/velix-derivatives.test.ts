import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openDatabase, projects, VelixClaimRepository, VelixDerivativeRepository, videoProjects, VelixProductionRepository, VelixStoryboardRepository, type DatabaseHandle } from '@neuralbridge/database';
import { narrationManifestSchema, type ProductionBrief, type SpokenWord } from '@neuralbridge/shared';
import { assembleProduction, concatAudio, cutAudio, detectSilences, probeAudioDurationMs, probeVideo, renderAssetSegment } from '@neuralbridge/workspace';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskEngine } from '../src/engine.js';
import { DerivativeService } from '../src/velix-derivative-service.js';
import { createNarrationStageAdapter, createSyncStageAdapter } from '../src/velix-narration-stage.js';
import { ProductionRunService } from '../src/velix-production.js';
import { createExportStageAdapter, createRenderStageAdapter, RenderService, type RenderStageDeps } from '../src/velix-render-stage.js';
import { createScriptStageAdapter } from '../src/velix-script-stage.js';
import { createStoryboardStageAdapter } from '../src/velix-storyboard-stage.js';
import { FakeAdapter } from './fake-adapter.js';

const FFMPEG = process.env['NB_FFMPEG'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe';
const FFPROBE = process.env['NB_FFPROBE'] ?? 'C:\\ffmpeg\\bin\\ffprobe.exe';
const HAS_FFMPEG = existsSync(FFMPEG) && existsSync(FFPROBE);
const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
const STEP = 0.3;
const FACT = 'A geração solar distribuída passou de trinta gigawatts no Brasil em dois mil e vinte e cinco';
const NARRATION = [
  'Por que a conta de luz de tantas casas brasileiras caiu nos últimos anos?',
  `A resposta começa nos telhados das cidades do interior. ${FACT}.`,
  'Cada painel instalado reduz o que a família paga para a distribuidora todo mês. Por isso a conta caiu para milhões de pessoas.',
  'Mas a rede elétrica ainda não acompanha esse ritmo de crescimento em muitas regiões do país.',
  'As baterias domésticas seguem caras e raras nas casas brasileiras de hoje. O futuro depende de regras novas para a rede.',
].join(' ');
const LICENSE = { provider: 'reviewed', model: 'reviewed', voice: 'reviewed', output: 'reviewed', userConfirmed: true };
let handle: DatabaseHandle;
let videoRoot: string;

const brief: ProductionBrief = {
  schemaVersion: 1, projectId: 'vp', format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } },
  productionType: 'documentary', topic: 'Energia solar', targetDurationSeconds: 60, targetWords: 150, language: 'pt-BR', audience: 'geral', tone: 'sóbrio', narrativeStyle: 'explicativo', researchDepth: 'standard', sourceCount: 3, pace: 'standard', budgetUsd: 10,
};

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-derivatives-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  const root = join(mkdtempSync(join(tmpdir(), 'nb-derivatives-root-')), 'p');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'a.txt'), 'a\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'init');
  videoRoot = join(root, 'video');
  handle.db.insert(projects).values({ id: 'api', name: 'API', rootPath: root }).run();
  handle.db.insert(videoProjects).values({ id: 'vp', name: 'Vídeo', rootPath: videoRoot }).run();
});
afterEach(() => handle.close());

function setup() {
  const spoken: string[] = [];
  const calls = { tts: 0 };
  const scratch = mkdtempSync(join(tmpdir(), 'nb-derivatives-tts-'));
  const dossie = { structured: { narracao: NARRATION, serie: 'Energia', cenas: [{ blocos: [{ tipo: 'texto', frase: 'Por que' }] }] } };
  const engine = new TaskEngine({ handle, adapters: { claude: new FakeAdapter('claude', () => dossie), codex: new FakeAdapter('codex', []), 'claude-gateway': new FakeAdapter('claude-gateway', []) }, availability: async () => ({ claude: true, codex: true, 'claude-gateway': false }) });
  const repository = new VelixProductionRepository(handle);
  const storyboards = new VelixStoryboardRepository(handle);
  const claims = new VelixClaimRepository(handle);
  const derivatives = new VelixDerivativeRepository(handle);
  let service: DerivativeService | null = null;
  const deps: RenderStageDeps = {
    storyboards, claims, production: repository, localMedia: () => [], rights: () => new Map(),
    renderMotion: async ({ project, output }) => { const frames = project.scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0); const accent = 'style' in project ? project.style.accent : '#22aa66'; execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=${accent.replace('#', '0x')}:s=${project.width}x${project.height}:r=${project.fps}`, '-frames:v', String(frames), '-pix_fmt', 'yuv420p', output]); },
    renderAsset: (input) => renderAssetSegment({ ffmpeg: FFMPEG, ...input }),
    assemble: (input) => assembleProduction({ ffmpeg: FFMPEG, ...input }),
    probe: (path) => probeVideo(path, FFPROBE), silences: (path) => detectSilences(FFMPEG, path), engineName: () => 'ffmpeg (teste)', credits: () => [],
    concatAudio: (inputs, output) => concatAudio(inputs, output, FFMPEG), probeAudioMs: (path) => probeAudioDurationMs(path, FFPROBE),
    inheritedNarration: (runId) => service?.inheritedNarration(runId) ?? null,
    origin: (runId) => service?.origin(runId) ?? null,
    identity: () => ({ accent: '#22aa66', background: '#101820', name: 'Canal Solar' }),
  };
  const renders = new RenderService(deps);
  const production = new ProductionRunService(repository, engine, [
    createScriptStageAdapter(),
    createStoryboardStageAdapter({ storyboards, claims, mediaCandidates: () => [] }),
    createNarrationStageAdapter({ storyboards, checkVoice: async () => undefined, synthesize: async ({ text }) => { calls.tts += 1; spoken.push(text); const out = join(scratch, `${spoken.length}.wav`); execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${(text.split(/\s+/).length * STEP).toFixed(2)}`, '-ar', '24000', '-ac', '1', out]); return readFileSync(out); }, probeDurationMs: (path) => probeAudioDurationMs(path, FFPROBE), concat: (inputs, output) => concatAudio(inputs, output, FFMPEG) }),
    createSyncStageAdapter({ storyboards, transcribe: async (path): Promise<SpokenWord[]> => { const manifest = narrationManifestSchema.parse(JSON.parse(readFileSync(join(dirname(path), 'manifesto.json'), 'utf8'))); let offset = 0; return manifest.blocks.flatMap((block) => { const text = spoken.slice().reverse().find((item) => block.key.endsWith(`-${item.length}`)) ?? ''; const words = text.split(/\s+/).map((w, i) => ({ w: w.replace(/[.,?]/g, ''), s: offset + i * STEP, e: offset + (i + 0.9) * STEP })); offset += block.durationMs / 1_000; return words; }); }, recordQuality: (runId, stageId, checks) => { repository.recordQualityReport({ runId, stageId, checks }); }, cutAudio: (input) => cutAudio(input, FFMPEG), probeDurationMs: (path) => probeAudioDurationMs(path, FFPROBE) }),
    createRenderStageAdapter(deps),
    createExportStageAdapter(deps, renders),
  ]);
  service = new DerivativeService({ production: repository, storyboards, claims, derivatives, runs: production, renders, identity: () => ({ name: 'Canal Solar' }) });
  return { production, derivatives: service, claims, renders, calls };
}

const step = async (production: ProductionRunService, runId: string, kind: Parameters<ProductionRunService['scheduleAdapterStage']>[0]['kind'], input: Record<string, unknown> = {}) => {
  await production.scheduleAdapterStage({ runId, kind, taskProjectId: 'api', input });
  await production.idle();
  return production.view(runId).stages.filter((stage) => stage.kind === kind).at(-1);
};

describe.skipIf(!HAS_FFMPEG)('Shorts derived from a production (real FFmpeg)', () => {
  it('offers standalone narrative units, creates a 9:16 production per approved one and exports it linked to its origin', async () => {
    const { production, derivatives, claims, renders, calls } = setup();
    const parent = production.create('vp', brief);
    expect((await step(production, parent.id, 'script'))?.status).toBe('completed');
    // A fact with approved evidence, said in the second sentence.
    const claimId = claims.upsertClaim({ runId: parent.id, projectId: 'vp', stageId: null, chapter: null, segmentHash: 's', text: FACT, kind: 'fact', confidence: 0.9 });
    const evidenceId = claims.addEvidence(claimId, { url: 'https://aneel.gov.br/dados', title: 'Dados', publisher: 'ANEEL', publishedAt: null, excerpt: '30 GW', confidence: 0.8, classification: 'evidence', referenceId: null });
    claims.decideEvidence(evidenceId, 'approved');
    for (const kind of ['storyboard'] as const) expect((await step(production, parent.id, kind))?.status).toBe('completed');
    expect(() => derivatives.generate(parent.id)).toThrow(/sincronize/);
    expect((await step(production, parent.id, 'narration', { modelId: 'm', voiceId: 'v', license: LICENSE }))?.status).toBe('completed');
    expect((await step(production, parent.id, 'sync'))?.status).toBe('completed');

    const candidates = derivatives.generate(parent.id);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    for (const candidate of candidates) expect(candidate.title.startsWith('Mas')).toBe(false);
    const best = candidates[0];
    if (!best) throw new Error('sem candidato');
    expect(best).toMatchObject({ status: 'candidate', formatId: 'youtube-short', title: expect.stringMatching(/^Por que a conta de luz/) });
    expect(best.claimIds).toContain(claimId);
    // Generating again for the same version keeps the same rows and decisions.
    expect(derivatives.generate(parent.id).map((item) => item.id)).toEqual(candidates.map((item) => item.id));
    expect(() => derivatives.create(best.id)).toThrow(/aprove/);
    derivatives.decide(best.id, 'approved');
    const childId = derivatives.create(best.id);
    expect(() => derivatives.create(best.id)).toThrow(/aprove/);
    expect(() => derivatives.generate(childId)).toThrow(/não gera derivados/);

    // The child carries the claim with its approved evidence, so its quality gate passes too.
    expect(claims.gate(childId)).toMatchObject({ facts: 1, supported: 1, passed: true });
    const ttsBefore = calls.tts;
    expect(await derivatives.renderAll(parent.id)).toBe(1);
    await production.idle();
    const render = renders.view(childId).renders[0];
    expect(render, JSON.stringify(production.view(childId).stages)).toBeTruthy();
    expect(render).toMatchObject({ formatId: 'youtube-short', width: 1080, height: 1920 });
    expect(render?.exportable, JSON.stringify(render?.checks.filter((check) => !check.passed))).toBe(true);
    expect(Math.abs((render?.durationMs ?? 0) - (best.endMs - best.startMs))).toBeLessThanOrEqual(250);
    expect(calls.tts).toBe(ttsBefore);
    expect(await derivatives.renderAll(parent.id)).toBe(0);

    expect(await derivatives.exportAll(parent.id)).toBe(1);
    await production.idle();
    const view = derivatives.view(parent.id).find((item) => item.id === best.id);
    expect(view).toMatchObject({ status: 'created', childRunId: childId, childStatus: 'completed', exportable: true });
    const manifest = JSON.parse(readFileSync(join(videoRoot, view?.exported ?? ''), 'utf8')) as { origin: { parentRunId: string; sceneIds: string[]; startMs: number; endMs: number }; claims: Array<{ text: string; sources: unknown[] }> };
    expect(manifest.origin).toMatchObject({ parentRunId: parent.id, sceneIds: best.sceneIds, startMs: best.startMs, endMs: best.endMs });
    expect(manifest.claims.find((claim) => claim.text === FACT)?.sources).toHaveLength(1);
    expect(await derivatives.exportAll(parent.id)).toBe(0);
  }, 180_000);
});
