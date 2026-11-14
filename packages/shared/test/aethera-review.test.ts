import { describe, expect, it } from 'vitest';
import { assembleTimeline, runAetheraReviewCycles, reviewAetheraTimeline, type Storyboard } from '../src/index.js';

const storyboard = (): Storyboard => ({
  schemaVersion: 1, timing: 'estimated', scenes: [
    { id: 'scene-1', chapter: 1, narration: 'Cena com visual.', startMs: 0, endMs: 2_000, claimIds: [], visualObjective: 'Mostrar jogo', subjectId: 'game-1', sceneType: 'broll', searchTerms: ['jogo'], visual: { type: 'asset', referenceId: 'asset-1', title: 'Jogo', kind: 'video', score: .9, reason: 'match' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'pending', audio: { relativePath: 'audio/scene-1.wav', durationMs: 2_000, key: 'narration-1', words: [] } },
    { id: 'scene-2', chapter: 1, narration: 'Cena sem visual.', startMs: 2_000, endMs: 4_000, claimIds: [], visualObjective: 'Mostrar conceito', subjectId: 'game-1', sceneType: 'broll', searchTerms: ['conceito'], visual: { type: 'none' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'pending', audio: { relativePath: 'audio/scene-2.wav', durationMs: 2_000, key: 'narration-2', words: [] } },
  ],
});

const format = { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } } as const;

describe('Aethera AP-10 review cycles', () => {
  it('finds a missing visual and proposes a traceable graphic correction', () => {
    const timeline = assembleTimeline({ runId: 'run-review', storyboard: storyboard(), format });
    const findings = reviewAetheraTimeline(timeline);
    expect(findings.some((finding) => finding.code === 'missing-visual')).toBe(true);
    expect(findings.find((finding) => finding.code === 'missing-visual')?.correction?.[0]).toMatchObject({ op: 'insertGraphic', trackId: 'graphics', subjectId: 'game-1' });
  });

  it('applies at most two low-risk cycles and leaves unresolved rights as review', () => {
    const timeline = assembleTimeline({ runId: 'run-review', storyboard: storyboard(), format });
    const result = runAetheraReviewCycles(timeline, 2);
    expect(result.cycles).toBeLessThanOrEqual(2);
    expect(result.changes.every((change) => change.author === 'review')).toBe(true);
    expect(result.findings.some((finding) => finding.code === 'missing-visual')).toBe(false);
    // The inserted graphic covers the narration, but footage of the same subject exists: D-AP-17 keeps it visible.
    expect(result.findings.find((finding) => finding.code === 'flat-background')).toMatchObject({ severity: 'warning', clipIds: expect.arrayContaining([expect.stringContaining('graphics:')]) });
  });
});
