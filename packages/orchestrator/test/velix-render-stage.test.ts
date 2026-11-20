import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openDatabase, projects, VelixClaimRepository, videoProjects, VelixProductionRepository, VelixStoryboardRepository, type DatabaseHandle } from '@neuralbridge/database';
import { aetheraTimelineSegments, assembleTimeline, captionCuesSrt, type LocalMedia, type MediaCandidate, narrationManifestSchema, type MotionProject, type ProductionBrief, type RightsStatus, type SpokenWord, timelineCaptionCues, type TimelineDocument, VIDEO_FORMATS } from '@neuralbridge/shared';
import { assembleProduction, concatAudio, detectSilences, probeAudioDurationMs, probeVideo, renderAssetSegment } from '@neuralbridge/workspace';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskEngine } from '../src/engine.js';
import { createNarrationStageAdapter, createSyncStageAdapter } from '../src/velix-narration-stage.js';
import { ProductionRunService } from '../src/velix-production.js';
import { createExportStageAdapter, createRenderStageAdapter, RenderService, type RenderStageDeps } from '../src/velix-render-stage.js';
import { createScriptStageAdapter } from '../src/velix-script-stage.js';
import { createStoryboardStageAdapter, StoryboardService } from '../src/velix-storyboard-stage.js';
import { FakeAdapter } from './fake-adapter.js';

const FFMPEG = process.env['NB_FFMPEG'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe';
const FFPROBE = process.env['NB_FFPROBE'] ?? 'C:\\ffmpeg\\bin\\ffprobe.exe';
const HAS_FFMPEG = existsSync(FFMPEG) && existsSync(FFPROBE);
const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
const STEP = 0.3;
const NARRATION = 'Os painéis solares cobrem telhados no Brasil inteiro hoje. A instalação cresceu nas cidades pequenas do interior. As baterias guardam a energia para a noite nas casas. O futuro depende das baterias e de regras novas para a rede.';
const LICENSE = { provider: 'reviewed', model: 'reviewed', voice: 'reviewed', output: 'reviewed', userConfirmed: true };
let handle: DatabaseHandle;
let videoRoot: string;
let rights: Map<string, RightsStatus>;

const brief: ProductionBrief = {
  schemaVersion: 1, projectId: 'vp', format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } },
  productionType: 'documentary', topic: 'Energia solar', targetDurationSeconds: 60, targetWords: 150, language: 'pt-BR', audience: 'geral', tone: 'sóbrio', narrativeStyle: 'explicativo', researchDepth: 'standard', sourceCount: 3, pace: 'standard', budgetUsd: 10,
};

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-render-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  const root = join(mkdtempSync(join(tmpdir(), 'nb-render-root-')), 'p');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'a.txt'), 'a\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'init');
  videoRoot = join(root, 'video');
  mkdirSync(join(videoRoot, 'midia'), { recursive: true });
  if (HAS_FFMPEG) execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0x2266aa:s=1280x720', '-frames:v', '1', join(videoRoot, 'midia', 'paineis.png')]);
  handle.db.insert(projects).values({ id: 'api', name: 'API', rootPath: root }).run();
  handle.db.insert(videoProjects).values({ id: 'vp', name: 'Vídeo', rootPath: videoRoot }).run();
  rights = new Map([['painel', 'verified_allowed']]);
});
afterEach(() => handle.close());

function setup(gates = false, overrides: Partial<RenderStageDeps> = {}) {
  const spoken: string[] = [];
  const motionProjects: MotionProject[] = [];
  const scratch = mkdtempSync(join(tmpdir(), 'nb-render-tts-'));
  const dossie = { structured: { narracao: NARRATION, serie: 'Energia', cenas: [{ blocos: [{ tipo: 'texto', frase: 'Os painéis' }] }] } };
  const engine = new TaskEngine({ handle, adapters: { claude: new FakeAdapter('claude', () => dossie), codex: new FakeAdapter('codex', []), 'claude-gateway': new FakeAdapter('claude-gateway', []) }, availability: async () => ({ claude: true, codex: true, 'claude-gateway': false }) });
  const repository = new VelixProductionRepository(handle);
  const storyboards = new VelixStoryboardRepository(handle);
  const claims = new VelixClaimRepository(handle);
  const candidates = (): MediaCandidate[] => [{ referenceId: 'painel', kind: 'image', title: 'Painéis solares cobrem telhados', publisher: 'Acervo', url: 'https://local.neuralbridge/asset/1', publishedAt: null, rightsStatus: rights.get('painel') ?? 'unverified', width: 1280, height: 720 }];
  const storyboardDeps = { storyboards, claims, mediaCandidates: candidates };
  const deps: RenderStageDeps = {
    storyboards, claims, production: repository,
    localMedia: (): LocalMedia[] => [{ referenceId: 'painel', relativePath: 'midia/paineis.png', kind: 'image', rightsStatus: rights.get('painel') ?? 'unverified' }],
    rights: () => new Map(rights),
    // Stand-in for Remotion (its browser runs in the E2E): a frame-exact clip of the segment's size and length.
    renderMotion: async ({ project, output }) => { motionProjects.push(project); const frames = project.scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0); execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=0x111111:s=${project.width}x${project.height}:r=${project.fps}`, '-frames:v', String(frames), '-pix_fmt', 'yuv420p', output]); },
    renderAsset: (input) => renderAssetSegment({ ffmpeg: FFMPEG, ...input }),
    assemble: (input) => assembleProduction({ ffmpeg: FFMPEG, ...input }),
    probe: (path) => probeVideo(path, FFPROBE),
    silences: (path) => detectSilences(FFMPEG, path),
    backgroundFrame: async () => 'data:image/jpeg;base64,fixture',
    engineName: () => 'ffmpeg (teste)',
    credits: () => ['Acervo, CC BY 4.0'],
    gates,
    ...overrides,
  };
  const renders = new RenderService(deps);
  const production = new ProductionRunService(repository, engine, [
    createScriptStageAdapter(),
    createStoryboardStageAdapter(storyboardDeps),
    createNarrationStageAdapter({ storyboards, checkVoice: async () => undefined, synthesize: async ({ text }) => { spoken.push(text); const out = join(scratch, `${spoken.length}.wav`); execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `sine=frequency=330:duration=${(text.split(/\s+/).length * STEP).toFixed(2)}`, '-ar', '24000', '-ac', '1', out]); return readFileSync(out); }, probeDurationMs: (path) => probeAudioDurationMs(path, FFPROBE), concat: (inputs, output) => concatAudio(inputs, output, FFMPEG) }),
    createSyncStageAdapter({ storyboards, transcribe: async (path): Promise<SpokenWord[]> => { const manifest = narrationManifestSchema.parse(JSON.parse(readFileSync(join(dirname(path), 'manifesto.json'), 'utf8'))); let offset = 0; return manifest.blocks.flatMap((block) => { const text = spoken.slice().reverse().find((item) => block.key.endsWith(`-${item.length}`)) ?? ''; const words = text.split(/\s+/).map((w, i) => ({ w: w.replace(/[.,]/g, ''), s: offset + i * STEP, e: offset + (i + 0.9) * STEP })); offset += block.durationMs / 1_000; return words; }); }, recordQuality: (runId, stageId, checks) => { repository.recordQualityReport({ runId, stageId, checks }); } }),
    createRenderStageAdapter(deps),
    createExportStageAdapter(deps, renders),
  ]);
  return { production, renders, repository, storyboards: new StoryboardService(repository, storyboardDeps), storyboardRepository: storyboards, motionProjects };
}

const step = async (production: ProductionRunService, runId: string, kind: Parameters<ProductionRunService['scheduleAdapterStage']>[0]['kind'], input: Record<string, unknown> = {}) => {
  await production.scheduleAdapterStage({ runId, kind, taskProjectId: 'api', input });
  await production.idle();
  return production.view(runId).stages.filter((stage) => stage.kind === kind).at(-1);
};

describe.skipIf(!HAS_FFMPEG)('render, quality and export (real FFmpeg/FFprobe)', () => {
  it('puts a frame from an already-used asset behind a fallback scene and records that use', async () => {
    const { production, renders, storyboardRepository, motionProjects } = setup(true);
    const run = production.create('vp', brief);
    for (const kind of ['script', 'storyboard'] as const) expect((await step(production, run.id, kind))?.status).toBe('completed');
    expect((await step(production, run.id, 'narration', { modelId: 'm', voiceId: 'v', license: LICENSE }))?.status).toBe('completed');
    expect((await step(production, run.id, 'sync'))?.status).toBe('completed');
    const latest = storyboardRepository.latest(run.id);
    if (!latest) throw new Error('storyboard esperado');
    const first = latest.storyboard.scenes[0];
    if (!first) throw new Error('cena esperada');
    const asset = { ...first, id: 'asset-scene', subjectId: 'game', visual: { type: 'asset' as const, referenceId: 'painel', title: 'Gameplay aceito', kind: 'image' as const, score: 1, reason: 'já usado', match: undefined } };
    const fallback = { ...first, id: 'fallback-scene', subjectId: 'game', startMs: first.endMs, endMs: first.endMs + Math.max(1_000, first.endMs - first.startMs), visual: { type: 'fallback' as const, kind: 'typography' as const, reason: 'sem casada direta' } };
    storyboardRepository.save({ runId: run.id, storyboard: { ...latest.storyboard, timing: 'measured', scenes: [asset, fallback] }, source: 'matching', baseVersion: latest.version });
    const stage = await step(production, run.id, 'render', { formatId: 'youtube-long', attempt: 'background' });
    expect(stage?.status, stage?.error?.message).toBe('completed');
    expect(motionProjects.some((project) => project.scenes.some((scene) => 'background' in scene && scene.background?.kind === 'image'))).toBe(true);
    const render = renders.view(run.id).renders[0];
    const manifestPath = join(videoRoot, render?.relativePath.replace(/\.mp4$/, '.json') ?? '');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { segments: Array<{ kind: string; backgrounds?: Array<{ referenceId: string }> }>; mediaReferenceIds: string[] };
    expect(manifest.segments.some((segment) => segment.kind === 'motion' && segment.backgrounds?.some((background) => background.referenceId === 'painel'))).toBe(true);
    expect(manifest.mediaReferenceIds).toContain('painel');
  }, 120_000);

  it('E3: a timeline render exports the composition cues as SubRip and never burns a second copy of the captions', async () => {
    let timeline: TimelineDocument | null = null;
    const assembled: Array<Parameters<RenderStageDeps['assemble']>[0]['subtitles']> = [];
    const { production, renders, storyboardRepository } = setup(false, {
      aetheraTimeline: () => timeline,
      // Stand-in for the Remotion timeline renderer: one frame-exact clip per segment window.
      renderTimelineSegments: async ({ timeline: document }) => aetheraTimelineSegments(document).map((segment) => {
        const relativePath = `producoes/timeline/${segment.key}.mp4`;
        const output = join(videoRoot, relativePath);
        mkdirSync(dirname(output), { recursive: true });
        execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', `color=c=0x111111:s=${document.format.width}x${document.format.height}:r=${document.format.fps}`, '-frames:v', String(Math.max(1, Math.round(segment.durationMs * document.format.fps / 1_000))), '-pix_fmt', 'yuv420p', output]);
        return { index: segment.index, key: segment.key, relativePath, reused: false, fromMs: segment.fromMs, durationMs: segment.durationMs };
      }),
      assemble: (input) => { assembled.push(input.subtitles); return assembleProduction({ ffmpeg: FFMPEG, ...input }); },
    });
    const run = production.create('vp', brief);
    for (const kind of ['script', 'storyboard'] as const) expect((await step(production, run.id, kind))?.status).toBe('completed');
    expect((await step(production, run.id, 'narration', { modelId: 'm', voiceId: 'v', license: LICENSE }))?.status).toBe('completed');
    expect((await step(production, run.id, 'sync'))?.status).toBe('completed');
    const latest = storyboardRepository.latest(run.id);
    if (!latest) throw new Error('storyboard esperado');
    // Measured words per scene (relative to the scene), as the sync with per-scene clips gives the app.
    const scenes = latest.storyboard.scenes.map((scene) => ({ ...scene, audio: { relativePath: `clip-${scene.id}.wav`, durationMs: scene.endMs - scene.startMs, key: `k-${scene.id}`, words: scene.narration.split(/\s+/u).map((w, index) => ({ w, startMs: index * 300, endMs: index * 300 + 260 })) } }));
    timeline = assembleTimeline({ runId: run.id, storyboard: { ...latest.storyboard, scenes }, format: VIDEO_FORMATS['youtube-long'] });
    // Without measured words the timeline has no cues and the sync phrases are burned instead (single copy either way).
    expect(timelineCaptionCues(assembleTimeline({ runId: run.id, storyboard: latest.storyboard, format: VIDEO_FORMATS['youtube-long'] }))).toEqual([]);
    const stage = await step(production, run.id, 'render', { formatId: 'youtube-long', attempt: 'timeline' });
    expect(stage?.status, stage?.error?.message).toBe('completed');
    const render = renders.view(run.id).renders[0];
    const srt = readFileSync(join(videoRoot, render?.relativePath.replace(/\.mp4$/u, '.srt') ?? ''), 'utf8');
    const cues = timelineCaptionCues(timeline);
    expect(cues.length).toBeGreaterThan(0);
    expect(srt).toBe(`${captionCuesSrt(cues)}\n`);
    expect(assembled).toEqual([null]);
    expect(render?.checks.find((check) => check.id === 'captions-burned')?.passed).toBe(true);
  }, 120_000);

  it('renders each format with the right size, audio and duration, reuses unchanged segments and exports only when allowed', async () => {
    const { production, renders, storyboards } = setup();
    const run = production.create('vp', brief);
    for (const kind of ['script', 'storyboard'] as const) expect((await step(production, run.id, kind))?.status).toBe('completed');
    expect((await step(production, run.id, 'render'))?.error?.message).toMatch(/narração/);
    expect((await step(production, run.id, 'narration', { modelId: 'm', voiceId: 'v', license: LICENSE }))?.status).toBe('completed');
    expect((await step(production, run.id, 'sync'))?.status).toBe('completed');
    const scenes = storyboards.view(run.id)?.scenes ?? [];
    expect(scenes.some((scene) => scene.visual.type === 'asset' && scene.visual.referenceId === 'painel')).toBe(true);

    for (const formatId of ['youtube-long', 'youtube-short'] as const) {
      const stage = await step(production, run.id, 'render', { formatId });
      expect(stage?.status, stage?.error?.message).toBe('completed');
    }
    let view = renders.view(run.id);
    expect(view.renders.map((render) => [render.formatId, render.width, render.height])).toEqual([['youtube-short', 1080, 1920], ['youtube-long', 1920, 1080]]);
    for (const render of view.renders) {
      const probe = await probeVideo(join(videoRoot, render.relativePath), FFPROBE);
      expect(probe).toMatchObject({ hasVideo: true, hasAudio: true, audioCodec: 'aac' });
      expect(Math.round(probe.fps)).toBe(30);
      expect(render.exportable, JSON.stringify(render.checks.filter((check) => !check.passed))).toBe(true);
      expect(render.checks.find((check) => check.id === 'captions-burned')?.passed).toBe(true);
      expect(existsSync(join(videoRoot, render.relativePath.replace(/\.mp4$/, '.srt')))).toBe(true);
    }

    // Rendering the same storyboard again in the same format reuses every segment.
    expect((await step(production, run.id, 'render', { formatId: 'youtube-long', again: 1 }))?.status).toBe('completed');
    const manifest = JSON.parse(readFileSync(join(videoRoot, 'producoes', run.id, 'render', 'youtube-long-v002.json'), 'utf8')) as { segments: Array<{ reused: boolean }> };
    expect(manifest.segments.length).toBeGreaterThanOrEqual(2);
    expect(manifest.segments.every((segment) => segment.reused)).toBe(true);

    // Rights revoked after the render: the recheck blocks export, and rights can never be waived.
    rights.set('painel', 'blocked');
    view = await renders.recheck(run.id, view.renders[1]?.artifactId ?? '', videoRoot);
    const long = view.renders.find((render) => render.formatId === 'youtube-long' && render.artifactId === view.renders[2]?.artifactId) ?? view.renders.at(-1);
    expect(long?.exportable).toBe(false);
    expect(() => renders.approveCheck(run.id, long?.artifactId ?? '', 'rights', 'quero exportar')).toThrow(/não pode ser dispensado/);
    const refused = await step(production, run.id, 'export', { renderArtifactId: long?.artifactId });
    expect(refused?.error?.message).toMatch(/bloqueantes pendentes/);
    rights.set('painel', 'verified_allowed');

    // A long on-screen text breaks the safe area: blocking, but a person may accept it with a note, and then export.
    const first = storyboards.view(run.id)?.scenes[0];
    const latestVersion = storyboards.view(run.id)?.version ?? 0;
    await storyboards.edit(run.id, latestVersion, { op: 'update', sceneId: first?.id ?? '', patch: { onScreenText: 'x'.repeat(300) } });
    expect((await step(production, run.id, 'render', { formatId: 'youtube-short', storyboard: latestVersion + 1 }))?.status).toBe('completed');
    const short = renders.view(run.id).renders[0];
    expect(short?.checks.find((check) => check.id === 'safe-area')?.passed).toBe(false);
    expect(short?.exportable).toBe(false);
    expect(() => renders.approveCheck(run.id, short?.artifactId ?? '', 'safe-area', ' ')).toThrow(/explique/);
    const approved = renders.approveCheck(run.id, short?.artifactId ?? '', 'safe-area', 'texto longo proposital no gancho').renders[0];
    expect(approved).toMatchObject({ exportable: true });
    const exportStage = await step(production, run.id, 'export', { renderArtifactId: short?.artifactId });
    expect(exportStage?.status, exportStage?.error?.message).toBe('completed');
    const exported = renders.view(run.id).renders[0]?.exported ?? '';
    const folder = join(videoRoot, dirname(exported));
    expect(existsSync(join(folder, 'creditos.txt'))).toBe(true);
    expect(JSON.parse(readFileSync(join(videoRoot, exported), 'utf8'))).toMatchObject({ formatId: 'youtube-short', credits: ['Acervo, CC BY 4.0'], media: [{ referenceId: 'painel', rightsStatus: 'verified_allowed' }] });
    expect(production.view(run.id).run.status).toBe('completed');
  }, 120_000);
});

describe('Aethera versioned render gates', () => {
  it('requires G3 for export and G4 for publication on the same storyboard version', () => {
    const { production, renders, repository } = setup(true);
    const run = production.create('vp', brief);
    const stage = repository.addStage({ runId: run.id, kind: 'render', status: 'completed', inputHash: 'gate-test', outputArtifactIds: '[]', progress: 1, retryCount: 0, costEstimateUsd: 0, actualCostUsd: 0, checkpoint: JSON.stringify({ adapter: 'render', taskProjectId: 'api', input: {}, state: {} }), error: null, taskId: null });
    const render = repository.recordArtifact({ stageId: stage.id, kind: 'render', contentHash: 'b'.repeat(64), relativePath: 'producoes/run/render/video.mp4', mime: 'video/mp4', metadata: { formatId: 'youtube-long', storyboardVersion: 1, width: 1920, height: 1080, durationMs: 1_000, manifest: 'produces/run/render/video.json' } });
    repository.recordQualityReport({ runId: run.id, stageId: stage.id, checks: [{ id: 'file', label: 'Arquivo', severity: 'blocking', passed: true }] });
    repository.recordApproval({ runId: run.id, stageId: stage.id, gate: 'technical', version: '1', decision: 'approved', note: 'automatic' });
    repository.recordApproval({ runId: run.id, stageId: stage.id, gate: 'factual', version: '1', decision: 'approved', note: 'automatic' });

    expect(renders.view(run.id).renders[0]).toMatchObject({ exportable: false, gates: { technical: 'approved', factual: 'approved', editorial: 'pending', publication: 'pending' } });
    const editorial = renders.approveGate(run.id, render.id, 'editorial', 'Aprovado editorialmente.');
    expect(editorial.renders[0]).toMatchObject({ exportable: true, gates: { editorial: 'approved', publication: 'pending' } });
    expect(renders.publishable(run.id, render.id)).toBe(false);
    const publication = renders.approveGate(run.id, render.id, 'publication', 'Autorizado para publicação.');
    expect(publication.renders[0]?.gates?.publication).toBe('approved');
    expect(renders.publishable(run.id, render.id)).toBe(true);
  });
});

describe.skipIf(!HAS_FFMPEG)('AP-02: matched range and basis of use of acquired media (real FFmpeg)', () => {
  it('renders the matched cut of an acquired gameplay only on an allowed basis, records it, and never touches the rights', async () => {
    // Ten seconds of synthetic "gameplay": the red channel steps 25 per second, so a frame says which second it is.
    execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', "color=c=black:s=320x180:r=30:d=10,format=rgb24,geq=r='25*floor(T)':g='0':b='0'", '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(videoRoot, 'midia', 'gameplay.mp4')]);
    let basis: NonNullable<LocalMedia['basis']> = 'not_allowed';
    const use = () => new Map([['gameplay', { basis, legalClearance: 'unknown' as const, publisher: 'Fixture Publishing', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }]]);
    const { production, renders, storyboards } = setup(true, {
      localMedia: (): LocalMedia[] => [
        { referenceId: 'painel', relativePath: 'midia/paineis.png', kind: 'image', rightsStatus: rights.get('painel') ?? 'unverified' },
        { referenceId: 'gameplay', relativePath: 'midia/gameplay.mp4', kind: 'video', rightsStatus: 'unverified', basis },
      ],
      mediaUse: use,
    });
    const run = production.create('vp', brief);
    for (const kind of ['script', 'storyboard'] as const) expect((await step(production, run.id, kind))?.status).toBe('completed');
    expect((await step(production, run.id, 'narration', { modelId: 'm', voiceId: 'v', license: LICENSE }))?.status).toBe('completed');
    expect((await step(production, run.id, 'sync'))?.status).toBe('completed');
    const repository = new VelixStoryboardRepository(handle);
    const latest = repository.latest(run.id);
    if (!latest) throw new Error('storyboard esperado');
    const first = latest.storyboard.scenes[0];
    if (!first) throw new Error('cena esperada');
    const match = { sceneId: first.id, sentenceIds: [`${first.id}:0`], segmentId: 'gameplay-asset:7000-9000', sourceStartMs: 7_000, sourceEndMs: 9_000, score: 0.8, breakdown: { semantic: 1, subject: 1, kind: 1, quality: 1, diversity: 1, duration: 1 }, reason: 'combate contra chefe' };
    const scenes = latest.storyboard.scenes.map((scene, index) => (index === 0 ? { ...scene, visual: { type: 'asset' as const, referenceId: 'gameplay', title: 'Gameplay', kind: 'video' as const, score: 0.8, reason: 'trecho aceito', match } } : scene));
    repository.save({ runId: run.id, storyboard: { ...latest.storyboard, scenes }, source: 'matching', baseVersion: latest.version });
    const rightsBefore = JSON.stringify([...rights]);

    expect((await step(production, run.id, 'render', { formatId: 'youtube-long', attempt: 1 }))?.error?.message).toMatch(/base de uso permitida/);
    basis = 'preview_only';
    expect((await step(production, run.id, 'render', { formatId: 'youtube-long', attempt: 2 }))?.error?.message).toMatch(/só entra na prévia/);
    expect((await step(production, run.id, 'render', { formatId: 'youtube-long', draft: true, attempt: 3 }))?.status).toBe('completed');
    basis = 'editorial_use';
    const stage = await step(production, run.id, 'render', { formatId: 'youtube-long', attempt: 4 });
    expect(stage?.status, stage?.error?.message).toBe('completed');

    const render = renders.view(run.id).renders[0];
    expect(render?.checks.find((check) => check.id === 'rights')).toMatchObject({ passed: true, evidence: expect.stringContaining('uso editorial') });
    expect(render?.checks.find((check) => check.id === 'editorial-use')).toMatchObject({ severity: 'warning', evidence: expect.stringContaining('legalClearance: unknown') });
    const manifestPath = join(videoRoot, render?.relativePath.replace(/\.mp4$/, '.json') ?? '');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { segments: Array<{ kind: string; relativePath: string; source?: unknown; basis?: string }>; mediaUse?: unknown[] };
    const segment = manifest.segments.find((item) => item.kind === 'asset' && item.basis === 'editorial_use');
    expect(segment).toMatchObject({ source: { startMs: 7_000, endMs: 9_000 }, basis: 'editorial_use' });
    expect(manifest.mediaUse).toEqual([{ referenceId: 'gameplay', basis: 'editorial_use', legalClearance: 'unknown', publisher: 'Fixture Publishing', url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa' }]);
    // The segment opens on second 7 of the source (red ≈ 175), not on second 0.
    const pixel = execFileSync(FFMPEG, ['-v', 'error', '-i', join(videoRoot, segment?.relativePath ?? ''), '-vf', 'scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
    expect(Math.abs((pixel[0] ?? 0) - 175)).toBeLessThanOrEqual(10);
    expect(JSON.stringify([...rights])).toBe(rightsBefore);
    void storyboards;
  }, 180_000);
});

describe('AP-04 E1: editorial pre-check artifact generation', () => {
  it('persists the editorial report when the storyboard has measured words and keeps G3 pending without human approval', () => {
    const { production, renders, repository } = setup(true);
    const run = production.create('vp', brief);
    const stage = repository.addStage({ runId: run.id, kind: 'render', status: 'completed', inputHash: 'editorial-test', outputArtifactIds: '[]', progress: 1, retryCount: 0, costEstimateUsd: 0, actualCostUsd: 0, checkpoint: JSON.stringify({ adapter: 'render', taskProjectId: 'api', input: {}, state: {} }), error: null, taskId: null });
    const render = repository.recordArtifact({ stageId: stage.id, kind: 'render', contentHash: 'c'.repeat(64), relativePath: 'producoes/run/render/video.mp4', mime: 'video/mp4', metadata: { formatId: 'youtube-long', storyboardVersion: 1, width: 1920, height: 1080, durationMs: 5_000, manifest: 'produces/run/render/video.json' } });
    repository.recordQualityReport({ runId: run.id, stageId: stage.id, checks: [{ id: 'file', label: 'Arquivo', severity: 'blocking', passed: true }] });
    repository.recordApproval({ runId: run.id, stageId: stage.id, gate: 'technical', version: '1', decision: 'approved', note: 'automatic' });
    repository.recordApproval({ runId: run.id, stageId: stage.id, gate: 'factual', version: '1', decision: 'approved', note: 'automatic' });

    // G3 starts pending: the editorial pre-check never approves on its own.
    expect(renders.view(run.id).renders[0]).toMatchObject({ exportable: false, gates: { technical: 'approved', factual: 'approved', editorial: 'pending', publication: 'pending' } });

    // Simulate the editorial pre-check artifact being written by recordEditorialPreCheck during render.
    repository.recordArtifact({ stageId: stage.id, kind: 'editorial-report', contentHash: 'd'.repeat(64), relativePath: `producoes/${run.id}/editorial/relatorio-v001.md`, mime: 'text/markdown', metadata: { status: 'ready_for_human', shots: 3, checks: 2, storyboardVersion: 1 } });

    // The artifact exists but G3 is still pending: only an explicit human approval unlocks export.
    expect(renders.view(run.id).renders[0]?.gates?.editorial).toBe('pending');
    expect(renders.view(run.id).renders[0]?.exportable).toBe(false);

    const editorial = renders.approveGate(run.id, render.id, 'editorial', 'Revisado e aprovado com base no relatório E1.');
    expect(editorial.renders[0]).toMatchObject({ exportable: true, gates: { editorial: 'approved' } });
  });
});
