import { describe, expect, it } from 'vitest';
import {
  applyDirectorRules,
  assembleTimeline,
  applyTimelineOps,
  timelineHash,
  timelineOpSchema,
  type Storyboard,
} from '../src/index.js';
import { defaultAetheraPresets } from '../src/index.js';

const storyboard = (): Storyboard => ({
  schemaVersion: 1,
  timing: 'measured',
  narrationKey: 'narration-v1',
  scenes: [
    {
      id: 'scene-1', chapter: 1, narration: 'Primeira cena.', startMs: 0, endMs: 2_000, claimIds: [],
      visualObjective: 'Mostrar a cidade', subjectId: 'game-1', sceneType: 'broll', searchTerms: ['cidade'],
      visual: { type: 'asset', referenceId: 'asset-1', title: 'Cidade', kind: 'video', score: 0.9, reason: 'match', match: {
        sceneId: 'scene-1', sentenceIds: ['scene-1'], segmentId: 'segment-1', assetId: 'asset-1', sourceStartMs: 7_000, sourceEndMs: 9_000,
        confidence: 0.9, confidenceBand: 'automatic', score: 0.9, breakdown: { semantic: 0.9, subject: 1, kind: 1, quality: 1, diversity: 1, duration: 1 }, reason: 'cena correta',
      } },
      onScreenText: 'Cidade', transition: 'fade', camera: 'push-in', locked: false, reviewStatus: 'approved',
      audio: { relativePath: 'audio/scene-1.wav', durationMs: 2_000, key: 'narration-1', words: [{ w: 'Primeira', startMs: 0, endMs: 600 }] },
    },
    {
      id: 'scene-2', chapter: 1, narration: 'Segunda cena.', startMs: 2_000, endMs: 4_000, claimIds: [],
      visualObjective: 'Mostrar combate', subjectId: 'game-2', sceneType: 'broll', searchTerms: ['combate'],
      visual: { type: 'fallback', kind: 'animation', reason: 'sem mídia liberada' },
      onScreenText: 'Combate', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'approved',
      audio: { relativePath: 'audio/scene-2.wav', durationMs: 2_000, key: 'narration-2', words: [{ w: 'Segunda', startMs: 0, endMs: 600 }] },
    },
  ],
});

const format = { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } } as const;

describe('Aethera AP-03 timeline contract', () => {
  it('assembles a deterministic timeline with stable scene clip ids and matched source ranges', () => {
    const input = { runId: 'run-1', storyboard: storyboard(), format };
    const first = assembleTimeline(input);
    const second = assembleTimeline(input);

    expect(timelineHash(first)).toBe(timelineHash(second));
    expect(first.schemaVersion).toBe(1);
    expect(first.basedOn.storyboardVersion).toBe(1);
    expect(first.durationMs).toBe(4_000);
    expect(first.tracks.find((track) => track.kind === 'video')?.items[0]).toMatchObject({
      id: 'video:scene-1', startMs: 0, durationMs: 2_000, sceneIds: ['scene-1'], subjectId: 'game-1',
      source: { kind: 'media', assetId: 'asset-1', inMs: 7_000, outMs: 9_000 },
    });
    expect(first.tracks.find((track) => track.kind === 'graphics')?.items[0]).toMatchObject({ id: 'graphics:scene-2', startMs: 2_000, durationMs: 2_000, subjectId: 'game-2' });
  });

  it('applies a subject selector only to matching clips and records a reversible change', () => {
    const before = assembleTimeline({ runId: 'run-1', storyboard: storyboard(), format });
    const result = applyTimelineOps(before, [{ op: 'setGain', selector: { subjectId: 'game-2' }, gainDb: -6 }], { author: 'user', command: 'abaixe o áudio do jogo 2' });

    expect(result.document.version).toBe(2);
    expect(result.change).toMatchObject({ fromVersion: 1, toVersion: 2, author: 'user', affectedClipIds: ['narration:scene-2'] });
    expect(result.document.tracks.find((track) => track.kind === 'narration')?.items[1]?.audio?.gainDb).toBe(-6);
    expect(result.document.tracks.find((track) => track.kind === 'video')?.items[0]?.audio).toBeUndefined();
  });

  it('rejects open-ended or unknown timeline operations', () => {
    expect(() => timelineOpSchema.parse({ op: 'setGain', selector: {}, gainDb: -3 })).toThrow();
    expect(() => timelineOpSchema.parse({ op: 'executeCode', selector: { clipIds: ['video:scene-1'] }, code: 'rm -rf' })).toThrow();
  });

  it('applies inspector operations to the same persisted document shape', () => {
    const before = assembleTimeline({ runId: 'run-1', storyboard: storyboard(), format });
    const result = applyTimelineOps(before, [
      { op: 'setCamera', selector: { clipIds: ['video:scene-1'] }, camera: 'pan' },
      { op: 'setTransition', selector: { clipIds: ['video:scene-1'] }, transition: 'fade', durationMs: 300 },
      { op: 'setText', selector: { clipIds: ['text:scene-1'] }, text: 'Cidade atualizada' },
      { op: 'setClipLock', selector: { clipIds: ['video:scene-1'] }, locked: true },
    ], { author: 'user', command: 'ajuste do inspetor' });
    const clip = result.document.tracks.find((track) => track.kind === 'video')?.items[0];
    const text = result.document.tracks.find((track) => track.kind === 'text')?.items[0];
    expect(clip).toMatchObject({ locked: true, exit: { id: 'fade', durationMs: 300 } });
    expect(clip?.keyframes).toEqual(expect.arrayContaining([expect.objectContaining({ property: 'x', value: -3 }), expect.objectContaining({ property: 'x', value: 3 })]));
    expect(text?.source).toMatchObject({ kind: 'text', text: 'Cidade atualizada' });
    expect(result.change.affectedClipIds).toEqual(['video:scene-1', 'text:scene-1']);
  });

  it('inserts a music source into the persisted timeline without inventing an external asset', () => {
    const before = assembleTimeline({ runId: 'run-1', storyboard: storyboard(), format });
    const result = applyTimelineOps(before, [{ op: 'insertAudio', trackId: 'music', atMs: 0, durationMs: 4_000, label: 'ACE-Step', sceneIds: ['scene-1', 'scene-2'], source: { kind: 'audio', musicTrackId: 'ace-step:track-1', inMs: 0, outMs: 4_000, gainDb: 0 } }], { author: 'agent', command: 'inserir trilha ACE-Step' });
    expect(result.document.tracks.find((track) => track.kind === 'music')?.items[0]).toMatchObject({ label: 'ACE-Step', source: { kind: 'audio', musicTrackId: 'ace-step:track-1' } });
    expect(result.change).toMatchObject({ author: 'agent', affectedClipIds: ['music:inserted:0:0'] });
  });

  it('carries DirectorPlan intent into generated transitions and effects', () => {
    const base = assembleTimeline({ runId: 'run-1', storyboard: storyboard(), format });
    const preset = defaultAetheraPresets.find((item) => item.id === 'top-10-dynamic');
    if (!preset) throw new Error('preset missing');
    const plan = applyDirectorRules({ timeline: base, preset });
    const directed = assembleTimeline({ runId: 'run-1', storyboard: storyboard(), format, directorPlan: plan, directorPlanVersion: 4 });
    const clip = directed.tracks.find((track) => track.kind === 'video')?.items[0];
    expect(directed.basedOn).toMatchObject({ directorPlanVersion: 4, presetId: 'top-10-dynamic' });
    expect(clip?.intent).toMatchObject({ directorRuleId: 'camera.punchInOnEmphasis' });
    expect(clip?.effects[0]).toMatchObject({ id: 'zoom-emphasis', intent: { directorRuleId: 'camera.punchInOnEmphasis' } });
    expect(clip?.exit).toMatchObject({ intent: { directorRuleId: 'camera.punchInOnEmphasis' } });
  });
});
