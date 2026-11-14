import { describe, expect, it } from 'vitest';
import { assembleTimeline, planAetheraTimelineCommand, type Storyboard } from '../src/index.js';

const storyboard = (): Storyboard => ({
  schemaVersion: 1,
  timing: 'measured',
  scenes: [1, 2, 3].map((number) => ({
    id: `scene-${number}`, chapter: 1, narration: `Cena ${number}.`, startMs: (number - 1) * 2_000, endMs: number * 2_000, claimIds: [], visualObjective: `Gameplay ${number}`, subjectId: `game-${number}`, sceneType: 'broll', searchTerms: ['gameplay'],
    visual: { type: 'asset' as const, referenceId: `asset-${number}`, title: `Gameplay ${number}`, kind: 'video' as const, score: .9, reason: 'match', match: { sceneId: `scene-${number}`, sentenceIds: [`scene-${number}`], segmentId: `segment-${number}`, assetId: `asset-${number}`, sourceStartMs: 0, sourceEndMs: 2_000, confidence: .9, confidenceBand: 'automatic' as const, score: .9, breakdown: { semantic: .9, subject: 1, kind: 1, quality: 1, diversity: 1, duration: 1 }, reason: 'cena correta' } },
    onScreenText: `Cena ${number}`, transition: 'cut', camera: 'static', locked: false, reviewStatus: 'approved', audio: { relativePath: `audio/${number}.wav`, durationMs: 2_000, key: `narration-${number}`, words: [] },
  })),
});

const format = { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } } as const;

describe('Aethera AP-09 timeline assistant', () => {
  it('targets only the third subject and returns a reviewable diff plan', () => {
    const timeline = assembleTimeline({ runId: 'run-assistant', storyboard: storyboard(), format });
    const music = timeline.tracks.find((track) => track.kind === 'music');
    music?.items.push({ id: 'music:main', startMs: 0, durationMs: 6_000, sceneIds: [], label: 'Trilha licenciada', source: { kind: 'audio', assetId: 'music-1', inMs: 0, outMs: 6_000, gainDb: -12 }, transform: { x: 0, y: 0, scale: 1, rotation: 0, fit: 'cover' }, keyframes: [], effects: [] });
    const plan = planAetheraTimelineCommand({ timeline, command: 'no terceiro jogo, troque o gameplay, aumente o impacto do título e diminua a música durante a narração' });
    expect(plan.status).toBe('ready');
    expect(plan.ops).toEqual(expect.arrayContaining([
      expect.objectContaining({ op: 'replaceSource', selector: { clipIds: ['video:scene-3'] } }),
      expect.objectContaining({ op: 'insertGraphic', subjectId: 'game-3', component: 'title' }),
      expect.objectContaining({ op: 'setGain', selector: { clipIds: ['music:main'] }, gainDb: -18 }),
    ]));
    expect(plan.affectedClipIds).toContain('video:scene-3');
    expect(plan.affectedClipIds).not.toContain('video:scene-1');
    expect(plan.diff.length).toBeGreaterThan(0);
  });

  it('does not guess when the command cannot be safely targeted', () => {
    const timeline = assembleTimeline({ runId: 'run-assistant', storyboard: storyboard(), format });
    const plan = planAetheraTimelineCommand({ timeline, command: 'faça algo aleatório' });
    expect(plan.status).toBe('unsupported');
    expect(plan.ops).toEqual([]);
  });
});
