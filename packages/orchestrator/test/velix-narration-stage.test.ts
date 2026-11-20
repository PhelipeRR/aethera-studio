import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { openDatabase, projects, VelixClaimRepository, videoProjects, VelixProductionRepository, VelixStoryboardRepository, type DatabaseHandle } from '@neuralbridge/database';
import { NARRATION_MIN_AUTO_SPEED, NARRATION_PACING_STYLES, narrationManifestSchema, sentenceTexts, type NarrationDirection, type ProductionBrief, type SpokenWord, type VoicePreset } from '@neuralbridge/shared';
import { audioGaps, concatAudio, insertSilences, probeAudioDurationMs } from '@neuralbridge/workspace';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskEngine } from '../src/engine.js';
import { createNarrationStageAdapter, createSyncStageAdapter, missingSpeechCheck, pacingPauseChecks, sceneWords } from '../src/velix-narration-stage.js';
import { ProductionRunService } from '../src/velix-production.js';
import { createScriptStageAdapter } from '../src/velix-script-stage.js';
import { createStoryboardStageAdapter, StoryboardService } from '../src/velix-storyboard-stage.js';
import { FakeAdapter } from './fake-adapter.js';

const FFMPEG = process.env['NB_FFMPEG'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe';
const FFPROBE = process.env['NB_FFPROBE'] ?? 'C:\\ffmpeg\\bin\\ffprobe.exe';
const HAS_FFMPEG = existsSync(FFMPEG) && existsSync(FFPROBE);
const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
const SECONDS_PER_WORD = 0.3;
const NARRATION = [
  'Os painéis solares cobrem telhados no Brasil inteiro hoje, de norte a sul do país, em casas e comércios.',
  'A instalação de painéis solares cresceu muito nas cidades pequenas do interior nos últimos cinco anos.',
  'As baterias guardam a energia para a noite e mudam a forma como a rede elétrica das cidades funciona.',
  'O futuro depende das baterias, da rede elétrica e de novas regras para quem gera a própria energia em casa.',
  'Nas fazendas, os sistemas de bombeamento solar levam água para o gado sem depender de diesel caro.',
  'Escolas rurais passaram a ter luz à noite e internet estável graças a pequenas usinas comunitárias.',
  'Os técnicos formados nessas regiões encontram trabalho na manutenção dos equipamentos instalados.',
  'Ainda assim, o preço inicial e o acesso ao crédito seguem como os maiores obstáculos para muitas famílias.',
].join(' ');
const LICENSE = { provider: 'reviewed', model: 'reviewed', voice: 'reviewed', output: 'reviewed', userConfirmed: true };
let handle: DatabaseHandle;
let videoRoot: string;

const brief: ProductionBrief = {
  schemaVersion: 1, projectId: 'vp', format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } },
  productionType: 'documentary', topic: 'Energia solar', targetDurationSeconds: 120, targetWords: 300, language: 'pt-BR', audience: 'geral', tone: 'sóbrio', narrativeStyle: 'explicativo', researchDepth: 'standard', sourceCount: 3, pace: 'standard', budgetUsd: 10,
};

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-narration-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  const root = join(mkdtempSync(join(tmpdir(), 'nb-narration-root-')), 'p');
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, 'a.txt'), 'a\n');
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root });
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-q', '-m', 'init');
  videoRoot = join(root, 'video');
  handle.db.insert(projects).values({ id: 'api', name: 'API', rootPath: root }).run();
  handle.db.insert(videoProjects).values({ id: 'vp', name: 'Vídeo', rootPath: videoRoot }).run();
});
afterEach(() => handle.close());

/** A stand-in for VoiceStudio and the transcriber: real WAV of SECONDS_PER_WORD per word, and the words back, in order. */
function voice(options: { sentenceGapMs?: number; dropSentenceOnSlowTakes?: number } = {}) {
  const spoken = new Map<string, string>();
  const scratch = mkdtempSync(join(tmpdir(), 'nb-fake-tts-'));
  let calls = 0;
  let slowTakes = 0;
  return {
    get calls() { return calls; },
    synthesize: async ({ text, speed }: { text: string; speed?: number }) => {
      calls += 1;
      const out = join(scratch, `${calls}.wav`);
      // With sentenceGapMs the fake voice pauses briefly after each sentence, as the real TTS does (E2 widens those gaps).
      const all = options.sentenceGapMs ? text.split(/(?<=[.!?])\s+/u) : [text];
      // Measured on Voz C at 0.9: a slower take that silently drops a sentence.
      const drop = (speed ?? 1) < 1 && all.length > 1 && (slowTakes += 1) <= (options.dropSentenceOnSlowTakes ?? 0);
      const sentences = drop ? all.slice(1) : all;
      // Like the real voice, a lower speed makes every word longer (200 ppm at 1.0).
      const perWord = SECONDS_PER_WORD / (speed ?? 1);
      const inputs = sentences.flatMap((sentence, index) => [
        '-f', 'lavfi', '-i', `sine=frequency=330:sample_rate=24000:duration=${(sentence.split(/\s+/).length * perWord).toFixed(2)}`,
        ...(index < sentences.length - 1 ? ['-f', 'lavfi', '-i', `anullsrc=r=24000:cl=mono:d=${((options.sentenceGapMs ?? 0) / 1_000).toFixed(3)}`] : []),
      ]);
      const count = sentences.length * 2 - 1;
      execFileSync(FFMPEG, ['-y', '-v', 'error', ...inputs, '-filter_complex', `${Array.from({ length: count }, (_x, index) => `[${index}:a]`).join('')}concat=n=${count}:v=0:a=1[out]`, '-map', '[out]', '-ar', '24000', '-ac', '1', out]);
      const bytes = readFileSync(out);
      spoken.set(bytes.toString('base64').slice(-64) + text.length, text);
      return Object.assign(bytes, { spokenText: text });
    },
    /** Reads the manifest next to the narration to know which block is where, then times each word inside its block. */
    transcribe: async (path: string): Promise<SpokenWord[]> => {
      const manifest = narrationManifestSchema.parse(JSON.parse(readFileSync(join(dirname(path), 'manifesto.json'), 'utf8')));
      const texts = [...spoken.values()];
      let offset = 0;
      return manifest.blocks.flatMap((block) => {
        const text = texts.find((item) => item.length > 0 && block.key.endsWith(`-${item.length}`)) ?? '';
        const words = text.split(/\s+/).map((w, index) => ({ w: w.replace(/[.,]/g, ''), s: offset + index * SECONDS_PER_WORD, e: offset + (index + 0.9) * SECONDS_PER_WORD }));
        offset += block.durationMs / 1_000;
        return words;
      });
    },
  };
}

function setup(fake = voice(), extra: Partial<Parameters<typeof createNarrationStageAdapter>[0]> = {}) {
  const dossie = { structured: { narracao: NARRATION, serie: 'Energia', cenas: [{ blocos: [{ tipo: 'texto', frase: 'Os painéis' }] }] } };
  const engine = new TaskEngine({ handle, adapters: { claude: new FakeAdapter('claude', () => dossie), codex: new FakeAdapter('codex', []), 'claude-gateway': new FakeAdapter('claude-gateway', []) }, availability: async () => ({ claude: true, codex: true, 'claude-gateway': false }) });
  const repository = new VelixProductionRepository(handle);
  const storyboards = new VelixStoryboardRepository(handle);
  const storyboardDeps = { storyboards, claims: new VelixClaimRepository(handle), mediaCandidates: () => [] };
  const production = new ProductionRunService(repository, engine, [
    createScriptStageAdapter(),
    createStoryboardStageAdapter(storyboardDeps),
    createNarrationStageAdapter({ storyboards, checkVoice: async () => undefined, synthesize: fake.synthesize, probeDurationMs: (path) => probeAudioDurationMs(path, FFPROBE), concat: (inputs, output) => concatAudio(inputs, output, FFMPEG), ...extra }),
    createSyncStageAdapter({ storyboards, transcribe: fake.transcribe, recordQuality: (runId, stageId, checks) => { repository.recordQualityReport({ runId, stageId, checks }); } }),
  ]);
  return { production, fake, storyboards, service: new StoryboardService(repository, storyboardDeps) };
}

const run = async (production: ProductionRunService, runId: string, kind: 'script' | 'storyboard' | 'narration' | 'sync', input: Record<string, unknown> = {}) => {
  await production.scheduleAdapterStage({ runId, kind, taskProjectId: 'api', input });
  await production.idle();
  return production.view(runId).stages.filter((stage) => stage.kind === kind).at(-1);
};

describe.skipIf(!HAS_FFMPEG)('narration and sync stages (real FFmpeg/FFprobe)', () => {
  it('speaks the storyboard in blocks, measures the joined audio and puts the scenes on the real clock', async () => {
    const { production, fake, storyboards, service } = setup();
    const created = production.create('vp', brief);
    await run(production, created.id, 'script');
    await run(production, created.id, 'storyboard');
    expect((await run(production, created.id, 'narration', { modelId: 'kitten', voiceId: 'voice-1' }))?.error?.message).toMatch(/license_required/);
    const narration = await run(production, created.id, 'narration', { modelId: 'kitten', voiceId: 'voice-1', license: LICENSE, blockChars: 500 });
    expect(narration?.status).toBe('completed');
    const manifest = narrationManifestSchema.parse(JSON.parse(readFileSync(join(videoRoot, 'producoes', created.id, 'narracao', 'manifesto.json'), 'utf8')));
    expect(manifest.blocks.length).toBeGreaterThanOrEqual(2);
    expect(fake.calls).toBe(manifest.blocks.length);
    const sum = manifest.blocks.reduce((total, block) => total + block.durationMs, 0);
    expect(Math.abs(manifest.durationMs - sum)).toBeLessThan(120);
    expect(existsSync(join(videoRoot, manifest.relativePath))).toBe(true);

    expect((await run(production, created.id, 'sync'))?.status).toBe('completed');
    let view = service.view(created.id);
    expect(view).toMatchObject({ version: 2, source: 'sync', timing: 'measured' });
    const scenes = view?.scenes ?? [];
    expect(scenes[0]?.startMs).toBe(0);
    expect(scenes.at(-1)?.endMs).toBe(manifest.durationMs);
    scenes.slice(1).forEach((scene, index) => expect(scene.startMs).toBe(scenes[index]?.endMs));
    const state = production.view(created.id);
    expect(state.qualityReports.at(-1)?.checks.find((check) => check.id === 'narration-sync')).toMatchObject({ passed: true });
    expect(state.artifacts.some((artifact) => artifact.kind === 'sync-timeline')).toBe(true);

    // A visual edit keeps the measured clock; changing the spoken order estimates again and makes the narration stale.
    view = await service.edit(created.id, 2, { op: 'update', sceneId: scenes[0]?.id ?? '', patch: { onScreenText: 'Solar' } });
    expect(view.timing).toBe('measured');
    const lastBlock = manifest.blocks.at(-1);
    const movable = scenes.find((scene, index) => index > 0 && manifest.blocks[0]?.sceneIds.includes(scene.id));
    if (!lastBlock || !movable) throw new Error('blocos insuficientes');
    view = await service.edit(created.id, 3, { op: 'move', sceneId: movable.id, toIndex: 0 });
    expect(view.timing).toBe('estimated');
    const stale = await run(production, created.id, 'sync', { narration: 'stale-check' });
    expect(stale?.error?.message).toMatch(/gere a narração de novo/);

    // Re-narrating speaks only the block whose text changed; the other block is reused from disk.
    const before = fake.calls;
    const latest = storyboards.latest(created.id);
    expect((await run(production, created.id, 'narration', { modelId: 'kitten', voiceId: 'voice-1', license: LICENSE, blockChars: 500, storyboard: latest?.version }))?.status).toBe('completed');
    expect(fake.calls - before).toBe(1);
    expect((await run(production, created.id, 'sync', { storyboard: latest?.version }))?.status).toBe('completed');
    expect(service.view(created.id)).toMatchObject({ timing: 'measured', source: 'sync' });
  });
});

describe.skipIf(!HAS_FFMPEG)('Aethera channel voice (designed preset, persistent authorization, per-scene direction)', () => {
  const preset: VoicePreset = { schemaVersion: 1, id: 'voz-c', projectId: 'vp', name: 'Aethera — dinâmica', provider: 'voicestudio', modelId: 'omnivoice', origin: 'synthetic_design', design: { instruct: 'male, young adult, moderate pitch', seed: 303, numStep: 32 }, speed: 1.12, language: 'pt-BR', sample: null, createdAt: '2026-11-11T12:00:00.000Z' };

  it('narrates with the designed voice under a valid authorization, no per-run licence, and inserts the asked pauses', async () => {
    const requests: Array<Record<string, unknown>> = [];
    const fake = voice({ sentenceGapMs: 120 });
    let valid = false;
    let directions: NarrationDirection[] = [];
    const breathDeps = {
      silence: async ({ durationMs, output }: { durationMs: number; output: string }) => { execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', (durationMs / 1_000).toFixed(3), output]); },
      audioGaps: (path: string) => audioGaps(path, {}, FFMPEG),
      insertSilences: (input: Parameters<typeof insertSilences>[0]) => insertSilences(input, FFMPEG),
    };
    const { production } = setup({ ...fake, synthesize: async (input: Record<string, unknown> & { text: string }) => { requests.push(input); return fake.synthesize(input); } } as ReturnType<typeof voice>, {
      channelVoice: async ({ presetId }) => ({ preset: { ...preset, id: presetId }, authorization: valid ? { id: 'auth-1', scope: 'noncommercial' } : null, valid, reason: valid ? 'Autorizada para uso não comercial.' : 'Autorize o uso desta voz uma vez.' }),
      directions: () => directions,
      ...breathDeps,
    });
    const created = production.create('vp', brief);
    await run(production, created.id, 'script');
    await run(production, created.id, 'storyboard');
    expect((await run(production, created.id, 'narration', { presetId: 'voz-c' }))?.error?.message).toMatch(/license_required: Autorize/);
    valid = true;
    const scenes = new VelixStoryboardRepository(handle).latest(created.id)?.storyboard.scenes ?? [];
    directions = [{ sceneId: scenes[1]?.id ?? '', pauseAfterMs: 600 }];
    const narration = await run(production, created.id, 'narration', { presetId: 'voz-c' });
    expect(narration?.status, narration?.error?.message).toBe('completed');
    expect(requests.every((request) => request['voiceId'] === undefined && request['instruct'] === 'male, young adult, moderate pitch' && String(request['instructions']).includes('português brasileiro') && request['seed'] === 303 && request['numStep'] === 32 && request['speed'] === 1.12)).toBe(true);
    const manifest = narrationManifestSchema.parse(JSON.parse(readFileSync(join(videoRoot, 'producoes', created.id, 'narracao', 'manifesto.json'), 'utf8')));
    expect(manifest).toMatchObject({ voiceId: 'preset:voz-c', channelVoice: { presetId: 'voz-c', authorizationId: 'auth-1', scope: 'noncommercial', seed: 303 }, pauses: [{ afterSceneId: scenes[1]?.id, durationMs: 600 }] });
    // The first segment ends at the paused scene: a block boundary exactly there.
    expect(manifest.blocks[0]?.sceneIds.at(-1)).toBe(scenes[1]?.id);
    const sum = manifest.blocks.reduce((total, block) => total + block.durationMs, 0);
    expect(Math.abs(manifest.durationMs - (sum + 600))).toBeLessThan(150);

    const beforeOverride = requests.length;
    expect((await run(production, created.id, 'narration', { presetId: 'voz-c', speed: 1, attempt: 'natural-pace' }))?.status).toBe('completed');
    expect(requests.slice(beforeOverride).every((request) => request['speed'] === 1)).toBe(true);

    // E2: a pacing style adds a pause after every scene but the last; the person's own direction for a scene wins.
    const paced = await run(production, created.id, 'narration', { presetId: 'voz-c', speed: 1, pacingStyle: 'documentary', attempt: 'paced' });
    expect(paced?.status, paced?.error?.message).toBe('completed');
    const pacedManifest = narrationManifestSchema.parse(JSON.parse(readFileSync(join(videoRoot, 'producoes', created.id, 'narracao', 'manifesto.json'), 'utf8')));
    expect(pacedManifest.pacingStyle).toBe('documentary');
    expect(pacedManifest.pauses).toHaveLength(scenes.length - 1);
    expect(pacedManifest.pauses?.find((pause) => pause.afterSceneId === scenes[1]?.id)?.durationMs).toBe(600);
    expect(pacedManifest.pauses?.every((pause) => pause.durationMs >= 600)).toBe(true);
    // Each scene is still one request (continuous intonation); the voice's own gaps after sentences grow to the style's pause.
    const boundaries = scenes.reduce((total, scene) => total + Math.max(0, sentenceTexts(scene.narration).length - 1), 0);
    expect(boundaries).toBeGreaterThan(0);
    expect(pacedManifest.blocks).toHaveLength(scenes.length);
    expect(pacedManifest.sentencePauses).toEqual({ boundaries, matched: boundaries, widened: boundaries, durationMs: NARRATION_PACING_STYLES.documentary.sentencePauseMs });
    expect(pacedManifest.blocks.every((block) => /-respiro-/u.test(block.relativePath))).toBe(scenes.every((scene) => sentenceTexts(scene.narration).length > 1));
    // The widened blocks are measured: every sentence end now holds about 280 ms of quiet, the spoken tone is untouched.
    const widened = pacedManifest.blocks.find((block) => /-respiro-/u.test(block.relativePath));
    const quiet = await audioGaps(join(videoRoot, widened?.relativePath ?? ''), {}, FFMPEG);
    expect(quiet.length).toBeGreaterThan(0);
    expect(quiet.every((gap) => Math.abs(gap.durationMs - NARRATION_PACING_STYLES.documentary.sentencePauseMs) <= 25)).toBe(true);
    // E1 review: at 1.0 this voice speaks ~200 ppm, above the documentary range (≤ 170): every scene is spoken once more,
    // slower, but never below the 0.85 floor; the rate measured after the correction is recorded.
    expect(pacedManifest.paceAdjustments).toHaveLength(scenes.length);
    for (const adjustment of pacedManifest.paceAdjustments ?? []) {
      expect(adjustment).toMatchObject({ fromSpeed: 1, toSpeed: NARRATION_MIN_AUTO_SPEED });
      expect(adjustment.wpmBefore).toBeGreaterThan(NARRATION_PACING_STYLES.documentary.targetWpm.max);
      expect(adjustment.wpmAfter).toBeLessThan(adjustment.wpmBefore);
    }
    expect(requests.some((request) => request['speed'] === NARRATION_MIN_AUTO_SPEED)).toBe(true);
    const spokenMs = pacedManifest.blocks.reduce((total, block) => total + block.durationMs, 0);
    const scenePausesMs = (pacedManifest.pauses ?? []).reduce((total, pause) => total + pause.durationMs, 0);
    expect(Math.abs(pacedManifest.durationMs - (spokenMs + scenePausesMs))).toBeLessThan(150);
    // Without the gap detector the style cannot add breath and says so instead of narrating without it.
    const { production: noBreath } = setup(voice(), { channelVoice: async () => ({ preset, authorization: { id: 'auth-1', scope: 'noncommercial' }, valid: true, reason: 'ok' }), silence: breathDeps.silence });
    const bare = noBreath.create('vp', brief);
    await run(noBreath, bare.id, 'script');
    await run(noBreath, bare.id, 'storyboard');
    expect((await run(noBreath, bare.id, 'narration', { presetId: 'voz-c', pacingStyle: 'documentary' }))?.error?.message).toMatch(/respiro entre frases exige/u);
    expect((await run(production, created.id, 'narration', { presetId: 'voz-c', pacingStyle: 'frenetic', attempt: 'bad' }))?.error?.message).toMatch(/cadência desconhecido/u);
  }, 120_000);
});

describe.skipIf(!HAS_FFMPEG)('pace correction guard (E1 review, real FFmpeg)', () => {
  const preset: VoicePreset = { schemaVersion: 1, id: 'voz-c', projectId: 'vp', name: 'Voz C', provider: 'voicestudio', modelId: 'omnivoice', origin: 'synthetic_design', design: { instruct: 'male', seed: 303, numStep: 32 }, speed: 1, language: 'pt-BR', sample: null, createdAt: '2026-11-12T12:00:00.000Z' };
  const deps = (fake: ReturnType<typeof voice>) => ({
    channelVoice: async () => ({ preset, authorization: { id: 'auth-1', scope: 'noncommercial' as const }, valid: true, reason: 'ok' }),
    silence: async ({ durationMs, output }: { durationMs: number; output: string }) => { execFileSync(FFMPEG, ['-y', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', (durationMs / 1_000).toFixed(3), output]); },
    audioGaps: (path: string) => audioGaps(path, {}, FFMPEG),
    insertSilences: (input: Parameters<typeof insertSilences>[0]) => insertSilences(input, FFMPEG),
    synthesize: fake.synthesize,
  });
  const paced = async (fake: ReturnType<typeof voice>) => {
    const { production } = setup(fake, deps(fake));
    const created = production.create('vp', brief);
    await run(production, created.id, 'script');
    await run(production, created.id, 'storyboard');
    const stage = await run(production, created.id, 'narration', { presetId: 'voz-c', pacingStyle: 'documentary' });
    expect(stage?.status, stage?.error?.message).toBe('completed');
    return narrationManifestSchema.parse(JSON.parse(readFileSync(join(videoRoot, 'producoes', created.id, 'narracao', 'manifesto.json'), 'utf8')));
  };

  it('asks again when a slower take reads faster than expected (a dropped sentence) and keeps the good take', async () => {
    const manifest = await paced(voice({ sentenceGapMs: 120, dropSentenceOnSlowTakes: 1 }));
    const first = manifest.paceAdjustments?.[0];
    expect(first).toMatchObject({ toSpeed: NARRATION_MIN_AUTO_SPEED });
    expect(first).not.toHaveProperty('kept');
    // The accepted take reads slower than before, as the speed change predicts.
    expect(first?.wpmAfter).toBeLessThan(first?.wpmBefore ?? 0);
  }, 120_000);

  it('keeps the original take when every slower take drops speech, and says so', async () => {
    const manifest = await paced(voice({ sentenceGapMs: 120, dropSentenceOnSlowTakes: 99 }));
    const multiSentence = manifest.paceAdjustments?.filter((item) => item.kept === 'original') ?? [];
    expect(multiSentence.length).toBeGreaterThan(0);
    for (const item of multiSentence) expect(manifest.blocks.find((block) => block.sceneIds[0] === item.sceneIds[0])?.relativePath).not.toMatch(/take/u);
  }, 120_000);
});

describe('missing speech (E1 review)', () => {
  it('blocks a scene stretch the voice did not say, not a single word the recognizer missed', () => {
    const word = (sceneId: string, text: string, heard: boolean) => ({ sceneId, word: text, startMs: heard ? 0 : null, endMs: heard ? 1 : null });
    const dropped = [word('s3', 'Então', true), word('s3', 'coisa.', true), word('s3', 'Vamos', false), word('s3', 'montar', false), word('s3', 'um', false), word('s3', 'método.', false), word('s3', 'Um', true)];
    expect(missingSpeechCheck(dropped)).toMatchObject({ severity: 'blocking', passed: false });
    expect(missingSpeechCheck(dropped).evidence).toContain('Vamos montar um método.');
    expect(missingSpeechCheck([word('s4', 'grande', true), word('s4', 'vende', false), word('s4', 'um', true)])).toMatchObject({ passed: true });
  });
});

describe('sceneWords (E3)', () => {
  it('spreads a run of missed words over the time between the words heard around it, by length', () => {
    const aligned = [
      { sceneId: 's', word: 'Todo', startMs: 1_000, endMs: 1_200 },
      { sceneId: 's', word: 'jogo', startMs: 1_200, endMs: 1_400 },
      { sceneId: 's', word: 'grande', startMs: 1_400, endMs: 1_700 },
      { sceneId: 's', word: 'vende', startMs: null, endMs: null },
      { sceneId: 's', word: 'um', startMs: 2_200, endMs: 2_300 },
      { sceneId: 's', word: 'fim.', startMs: null, endMs: null },
    ];
    expect(sceneWords('s', 1_000, aligned)).toEqual([
      { w: 'Todo', startMs: 0, endMs: 200 }, { w: 'jogo', startMs: 200, endMs: 400 }, { w: 'grande', startMs: 400, endMs: 700 },
      // "vende" fills the 500 ms before "um" instead of collapsing onto "grande" (no false pause after it).
      { w: 'vende', startMs: 700, endMs: 1_200 }, { w: 'um', startMs: 1_200, endMs: 1_300 },
      // Nothing heard after the last word: it keeps the previous end.
      { w: 'fim.', startMs: 1_300, endMs: 1_300 },
    ]);
  });
});

describe('pacingPauseChecks (E2)', () => {
  const words = [
    { sceneId: 's1', word: 'Três', startMs: 0, endMs: 200 },
    { sceneId: 's1', word: 'jogos.', startMs: 220, endMs: 500 },
    { sceneId: 's1', word: 'Agora', startMs: 600, endMs: 800 },
    { sceneId: 's2', word: 'Mas', startMs: 1_000, endMs: 1_100 },
  ];

  it('adds nothing for a narration without a pacing style', () => {
    expect(pacingPauseChecks(undefined, words)).toEqual([]);
    expect(pacingPauseChecks('frenetic', words)).toEqual([]);
  });

  it('warns about sentence and scene pauses shorter than the style asks, measured on the audio', () => {
    const checks = pacingPauseChecks('documentary', words);
    expect(checks.map((check) => [check.id, check.severity, check.passed])).toEqual([
      ['narration-sentence-pauses', 'warning', false],
      ['narration-scene-pauses', 'warning', false],
    ]);
    expect(checks[0]?.evidence).toContain('1 de 1');
    expect(checks[1]?.evidence).toContain('menor: 200 ms');
  });
});
