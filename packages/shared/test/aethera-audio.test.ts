import { describe, expect, it } from 'vitest';
import { assembleTimeline, designAetheraAudio, validateAetheraAudioPlan, type Storyboard } from '../src/index.js';

const storyboard = (): Storyboard => ({ schemaVersion: 1, timing: 'measured', narrationKey: 'narration', scenes: [{ id: 'scene-1', chapter: 1, narration: 'Fala curta.', startMs: 0, endMs: 1_000, claimIds: [], visualObjective: 'Mostrar jogo', subjectId: 'game-1', sceneType: 'broll', searchTerms: ['jogo'], visual: { type: 'fallback', kind: 'animation', reason: 'fallback' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'approved', audio: { relativePath: 'audio.wav', durationMs: 1_000, key: 'voice', words: [{ w: 'Fala', startMs: 100, endMs: 350 }, { w: 'curta', startMs: 400, endMs: 700 }] } }] });
const format = { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } } as const;
const music = { id: 'track-1', relativePath: 'audio/music.mp3', sha256: 'a'.repeat(64), durationMs: 60_000, bpm: 120, mood: ['cinematic'], license: { name: 'CC0', source: 'https://example.com/license', evidence: 'licença arquivada em library/track-1.json', scope: 'uso audiovisual não comercial e comercial', expiresAt: null }, importedAt: '2026-11-11T00:00:00.000Z' };

describe('Aethera AP-05 audio designer', () => {
  it('creates word ducking and frame-aligned SFX only with a licensed library track', () => {
    const timeline = assembleTimeline({ runId: 'run-audio', storyboard: storyboard(), format });
    const plan = designAetheraAudio({ timeline, music, sfx: [{ id: 'sfx-1', sfxId: 'whoosh', relativePath: 'audio/whoosh.wav', atMs: 500, durationMs: 200, frame: 0, gainDb: -6, licenseEvidence: 'motionvelix-kit-manifest-v1' }] });
    expect(plan.music).toMatchObject({ kind: 'library', trackId: 'track-1' });
    expect(plan.ducking).toEqual(expect.arrayContaining([expect.objectContaining({ sourceWord: 'Fala', startMs: 100, gainDb: -12 })]));
    expect(plan.sfx[0]).toMatchObject({ frame: 15, atMs: 500 });
    expect(validateAetheraAudioPlan(plan)).toEqual(plan);
  });

  it('does not invent music when no licensed track is available', () => {
    const timeline = assembleTimeline({ runId: 'run-audio', storyboard: storyboard(), format });
    const plan = designAetheraAudio({ timeline });
    expect(plan.music).toBeNull();
    expect(plan.ducking).toEqual([]);
  });

  it('rejects a generated source and a music duck that is too loud', () => {
    const timeline = assembleTimeline({ runId: 'run-audio', storyboard: storyboard(), format });
    const plan = designAetheraAudio({ timeline, music });
    expect(() => validateAetheraAudioPlan({ ...plan, music: { kind: 'generated', providerId: 'none', model: 'none', promptHash: 'x', seed: 1, license: music.license } })).toThrow(/música gerada/iu);
    expect(() => validateAetheraAudioPlan({ ...plan, ducking: plan.ducking.map((item) => ({ ...item, gainDb: -3 })) })).toThrow(/10 dB/iu);
  });

  it('accepts an ACE-Step local track only with its noncommercial generation manifest', () => {
    const timeline = assembleTimeline({ runId: 'run-audio', storyboard: storyboard(), format });
    const generated = {
      ...music,
      id: 'ace-step:track-1',
      license: { ...music.license, name: 'ACE-Step 1.5 — uso não comercial', scope: 'não comercial; revisão comercial pendente' },
      generation: {
        providerId: 'ace-step-local', softwareVersion: '1.5.0', modelId: 'acestep-v15-turbo', modelRevision: 'local-revision', lmModelId: 'acestep-5Hz-lm-0.6B', lmBackend: 'pt' as const,
        promptHash: 'b'.repeat(64), seed: 42, durationMs: 60_000, bpm: 120, inferenceSteps: 8, guidanceScale: 7, taskType: 'text2music' as const, outputSha256: 'a'.repeat(64), format: 'wav' as const, origin: 'local-only' as const,
        timelineId: 'timeline:run-audio', sceneIds: ['scene-1'], createdAt: '2026-11-12T00:00:00.000Z',
        licenseEvidence: { software: { name: 'ACE-Step 1.5', license: 'MIT', source: 'https://github.com/ACE-Step/ACE-Step-1.5/blob/main/LICENSE' }, ditWeights: { model: 'acestep-v15-turbo', license: 'MIT', source: 'https://huggingface.co/ACE-Step/Ace-Step1.5' }, lmWeights: { model: 'acestep-5Hz-lm-0.6B', license: 'MIT', source: 'https://huggingface.co/ACE-Step/Ace-Step1.5' }, outputStatement: 'Uso não comercial; revisão comercial pendente.', evidence: 'docs/aethera/ace-step-1.5-evaluation-2026-11-12.md' },
      },
    };
    const plan = designAetheraAudio({ timeline, music: generated });
    expect(plan.music).toMatchObject({ kind: 'generated', providerId: 'ace-step-local', outputSha256: 'a'.repeat(64) });
    expect(validateAetheraAudioPlan(plan)).toEqual(plan);
  });

  it('accepts another authorized local generator when its manifest and license are complete', () => {
    const timeline = assembleTimeline({ runId: 'run-audio', storyboard: storyboard(), format });
    const generated = {
      ...music,
      id: 'local-provider:track-1',
      license: { ...music.license, name: 'Local provider — uso não comercial', scope: 'não comercial; revisão comercial pendente' },
      generation: {
        providerId: 'local-music-provider', softwareVersion: '1.0.0', modelId: 'local-model', modelRevision: 'local-revision', lmModelId: null, lmBackend: 'pt' as const,
        promptHash: 'c'.repeat(64), seed: 7, durationMs: 60_000, bpm: 120, inferenceSteps: 8, guidanceScale: 7, taskType: 'text2music' as const, outputSha256: 'c'.repeat(64), format: 'wav' as const, origin: 'local-only' as const,
        timelineId: 'timeline:run-audio', sceneIds: ['scene-1'], createdAt: '2026-11-12T00:00:00.000Z',
        licenseEvidence: { software: { name: 'Local provider', license: 'MIT', source: 'https://example.com/software-license' }, ditWeights: { model: 'local-model', license: 'MIT', source: 'https://example.com/model-license' }, lmWeights: null, outputStatement: 'Uso não comercial; revisão comercial pendente.', evidence: 'local-provider-manifest-v1' },
      },
    };
    const plan = designAetheraAudio({ timeline, music: generated });

    expect(validateAetheraAudioPlan(plan)).toEqual(plan);
  });
});
