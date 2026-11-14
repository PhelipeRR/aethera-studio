import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openDatabase, projects, VelixClaimRepository, videoProjects, VelixProductionRepository, VelixStoryboardRepository, type DatabaseHandle } from '@neuralbridge/database';
import { buildTimeline, narrationManifestSchema, renderManifestSchema, type MediaCandidate, type ProductionBrief, type SpokenWord } from '@neuralbridge/shared';
import { assembleProduction, concatAudio, cutAudio, detectSilences, probeAudioDurationMs, probeVideo, renderAssetSegment } from '@neuralbridge/workspace';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskEngine } from '../src/engine.js';
import { createNarrationStageAdapter, createSyncStageAdapter } from '../src/velix-narration-stage.js';
import { ProductionRunService } from '../src/velix-production.js';
import { createRenderStageAdapter, RenderService, type RenderStageDeps } from '../src/velix-render-stage.js';
import { createScriptStageAdapter } from '../src/velix-script-stage.js';
import { createStoryboardStageAdapter, StoryboardService } from '../src/velix-storyboard-stage.js';
import { FakeAdapter } from './fake-adapter.js';

const FFMPEG = process.env['NB_FFMPEG'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe';
const FFPROBE = process.env['NB_FFPROBE'] ?? 'C:\\ffmpeg\\bin\\ffprobe.exe';
const HAS_FFMPEG = existsSync(FFMPEG) && existsSync(FFPROBE);
const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
const STEP = 0.3;
const NARRATION = [
  'Os painéis solares cobrem telhados no Brasil inteiro hoje. A instalação cresceu nas cidades pequenas do interior.',
  'As baterias guardam a energia para a noite nas casas. O preço caiu bastante nos últimos anos para as famílias.',
  'O futuro depende das baterias e de regras novas para a rede. Escolas rurais também ganharam luz estável à noite.',
].join(' ');
const LICENSE = { provider: 'reviewed', model: 'reviewed', voice: 'reviewed', output: 'reviewed', userConfirmed: true };
let handle: DatabaseHandle;
let videoRoot: string;

const brief: ProductionBrief = {
  schemaVersion: 1, projectId: 'vp', format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } },
  productionType: 'documentary', topic: 'Energia solar', targetDurationSeconds: 60, targetWords: 150, language: 'pt-BR', audience: 'geral', tone: 'sóbrio', narrativeStyle: 'explicativo', researchDepth: 'standard', sourceCount: 3, pace: 'standard', budgetUsd: 10,
};

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-timeline-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  const root = join(mkdtempSync(join(tmpdir(), 'nb-timeline-root-')), 'p');
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
  const calls = { tts: 0, asr: 0, motion: 0, asset: 0 };
  const scratch = mkdtempSync(join(tmpdir(), 'nb-timeline-tts-'));
  const dossie = { structured: { narracao: NARRATION, serie: 'Energia', cenas: [{ blocos: [{ tipo: 'texto', frase: 'Os painéis' }] }] } };
  const engine = new TaskEngine({ handle, adapters: { claude: new FakeAdapter('claude', () => dossie), codex: new FakeAdapter('codex', []) }, availability: async () => ({ claude: true, codex: true }) });
  const repository = new VelixProductionRepository(handle);
  const storyboards = new VelixStoryboardRepository(handle);
  const claims = new VelixClaimRepository(handle);
  const mediaCandidates = (): MediaCandidate[] => [];
  const audio = { root: () => videoRoot, cut: (input: Parameters<typeof cutAudio>[0]) => cutAudio(input, FFMPEG), probeDurationMs: (path: string) => probeAudioDurationMs(path, FFPROBE) };
  const storyboardDeps = { storyboards, claims, mediaCandidates, audio };
  const deps: RenderStageDeps = {
    storyboards, claims, production: repository, localMedia: () => [], rights: () => new Map(),
    renderMotion: async ({ project, output }) => { calls.motion += 1; const frames = project.scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0); execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=0x111111:s=${project.width}x${project.height}:r=${project.fps}`, '-frames:v', String(frames), '-pix_fmt', 'yuv420p', output]); },
    renderAsset: (input) => { calls.asset += 1; return renderAssetSegment({ ffmpeg: FFMPEG, ...input }); },
    assemble: (input) => assembleProduction({ ffmpeg: FFMPEG, ...input }),
    probe: (path) => probeVideo(path, FFPROBE), silences: (path) => detectSilences(FFMPEG, path), engineName: () => 'ffmpeg (teste)', credits: () => [],
    concatAudio: (inputs, output) => concatAudio(inputs, output, FFMPEG), probeAudioMs: (path) => probeAudioDurationMs(path, FFPROBE),
  };
  const production = new ProductionRunService(repository, engine, [
    createScriptStageAdapter(),
    createStoryboardStageAdapter(storyboardDeps),
    createNarrationStageAdapter({ storyboards, checkVoice: async () => undefined, synthesize: async ({ text }) => { calls.tts += 1; spoken.push(text); const out = join(scratch, `${spoken.length}.wav`); execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${(text.split(/\s+/).length * STEP).toFixed(2)}`, '-ar', '24000', '-ac', '1', out]); return readFileSync(out); }, probeDurationMs: (path) => probeAudioDurationMs(path, FFPROBE), concat: (inputs, output) => concatAudio(inputs, output, FFMPEG) }),
    createSyncStageAdapter({ storyboards, transcribe: async (path): Promise<SpokenWord[]> => { calls.asr += 1; const manifest = narrationManifestSchema.parse(JSON.parse(readFileSync(join(dirname(path), 'manifesto.json'), 'utf8'))); let offset = 0; return manifest.blocks.flatMap((block) => { const text = spoken.slice().reverse().find((item) => block.key.endsWith(`-${item.length}`)) ?? ''; const words = text.split(/\s+/).map((w, i) => ({ w: w.replace(/[.,]/g, ''), s: offset + i * STEP, e: offset + (i + 0.9) * STEP })); offset += block.durationMs / 1_000; return words; }); }, recordQuality: (runId, stageId, checks) => { repository.recordQualityReport({ runId, stageId, checks }); }, cutAudio: (input) => cutAudio(input, FFMPEG), probeDurationMs: (path) => probeAudioDurationMs(path, FFPROBE) }),
    createRenderStageAdapter(deps),
  ]);
  return { production, calls, renders: new RenderService(deps), storyboards: new StoryboardService(repository, storyboardDeps), repository };
}

const step = async (production: ProductionRunService, runId: string, kind: Parameters<ProductionRunService['scheduleAdapterStage']>[0]['kind'], input: Record<string, unknown> = {}) => {
  await production.scheduleAdapterStage({ runId, kind, taskProjectId: 'api', input });
  await production.idle();
  return production.view(runId).stages.filter((stage) => stage.kind === kind).at(-1);
};
const manifestOf = (runId: string, name: string) => renderManifestSchema.parse(JSON.parse(readFileSync(join(videoRoot, 'producoes', runId, 'render', `${name}.json`), 'utf8')));

describe.skipIf(!HAS_FFMPEG)('timeline editing keeps rights and sync and renders only what changed (real FFmpeg)', () => {
  it('moves, splits, swaps and restores scenes on the measured clock without speaking or transcribing again', async () => {
    const { production, calls, renders, storyboards } = setup();
    const run = production.create('vp', brief);
    for (const kind of ['script', 'storyboard'] as const) expect((await step(production, run.id, kind))?.status).toBe('completed');
    expect((await step(production, run.id, 'narration', { modelId: 'm', voiceId: 'v', license: LICENSE }))?.status).toBe('completed');
    expect((await step(production, run.id, 'sync'))?.status).toBe('completed');
    let view = storyboards.view(run.id);
    if (!view) throw new Error('storyboard ausente');
    expect(view.scenes.length).toBeGreaterThanOrEqual(3);
    expect(view.scenes.every((scene) => scene.audio && existsSync(join(videoRoot, scene.audio.relativePath)))).toBe(true);
    const narrationMs = (view.scenes.at(-1)?.endMs ?? 0);
    expect(Math.abs(narrationMs - view.scenes.reduce((sum, scene) => sum + (scene.audio?.durationMs ?? 0), 0))).toBe(0);
    const timeline = buildTimeline({ scenes: view.scenes, issues: view.issues, timing: view.timing });
    expect(timeline.tracks.map((track) => [track.id, track.items.length > 0])).toEqual([['narration', true], ['video', false], ['images', false], ['graphics', true], ['text', false], ['captions', true], ['music', false], ['sfx', false]]);

    expect((await step(production, run.id, 'render', { formatId: 'youtube-long', storyboard: view.version }))?.status).toBe('completed');
    const baseline = { tts: calls.tts, asr: calls.asr };
    const firstRender = manifestOf(run.id, `youtube-long-v${String(view.version).padStart(3, '0')}`);
    const original = view.version;

    // Move: same voice, new order, still measured; the narration is re-joined from clips and QA passes.
    const moved = view.scenes[0]?.id ?? '';
    view = await storyboards.edit(run.id, view.version, { op: 'move', sceneId: moved, toIndex: view.scenes.length - 1 });
    expect(view).toMatchObject({ timing: 'measured', renderable: true });
    expect(view.scenes.at(-1)?.id).toBe(moved);
    const motionBefore = calls.motion;
    expect((await step(production, run.id, 'render', { formatId: 'youtube-long', storyboard: view.version }))?.status).toBe('completed');
    let latest = renders.view(run.id).renders[0];
    expect(latest?.exportable, JSON.stringify(latest?.checks.filter((check) => !check.passed))).toBe(true);
    expect(calls.motion - motionBefore).toBeGreaterThanOrEqual(1);

    // Split: the clip is cut between two words, both halves keep measured audio.
    const splittable = view.scenes.find((scene) => scene.narration.split(/(?<=[.!?])\s/).length > 1);
    if (!splittable) throw new Error('nenhuma cena com duas frases');
    view = await storyboards.edit(run.id, view.version, { op: 'duplicate', sceneId: splittable.id });
    const halves = view.scenes.filter((scene) => scene.narration !== splittable.narration && splittable.narration.includes(scene.narration));
    expect(halves).toHaveLength(2);
    expect(halves.every((scene) => scene.audio && existsSync(join(videoRoot, scene.audio.relativePath)))).toBe(true);
    expect(view.timing).toBe('measured');
    expect((await step(production, run.id, 'render', { formatId: 'youtube-long', storyboard: view.version }))?.status).toBe('completed');
    latest = renders.view(run.id).renders[0];
    expect(latest?.exportable, JSON.stringify(latest?.checks.filter((check) => !check.passed))).toBe(true);

    // Swapping a visual keeps every clip and the clock.
    view = await storyboards.edit(run.id, view.version, { op: 'replace', sceneId: view.scenes[0]?.id ?? '', visual: { type: 'fallback', kind: 'document' } });
    expect(view.timing).toBe('measured');

    // Restore the version first rendered: every segment of that render is reused, nothing is rendered again.
    view = storyboards.restore(run.id, view.version, original);
    const motionBeforeRestore = calls.motion;
    expect((await step(production, run.id, 'render', { formatId: 'youtube-long', storyboard: view.version }))?.status).toBe('completed');
    expect(calls.motion).toBe(motionBeforeRestore);
    const restored = manifestOf(run.id, `youtube-long-v${String(view.version).padStart(3, '0')}`);
    expect(restored.segments.every((segment) => segment.reused)).toBe(true);
    expect(restored.segments.map((segment) => segment.key)).toEqual(firstRender.segments.map((segment) => segment.key));
    expect(storyboards.history(run.id)[0]).toMatchObject({ source: 'restore' });

    // A draft preview is small, uses the same clock and is never listed for export.
    expect((await step(production, run.id, 'render', { formatId: 'youtube-long', storyboard: view.version, draft: true }))?.status).toBe('completed');
    const draft = production.view(run.id).artifacts.filter((artifact) => artifact.kind === 'render-draft').at(-1);
    const probe = await probeVideo(join(videoRoot, draft?.relativePath ?? ''), FFPROBE);
    expect([probe.width, probe.height]).toEqual([640, 360]);
    expect(renders.view(run.id).renders.some((render) => render.relativePath === draft?.relativePath)).toBe(false);

    // None of this spoke or transcribed again.
    expect({ tts: calls.tts, asr: calls.asr }).toEqual(baseline);
  }, 180_000);
});
