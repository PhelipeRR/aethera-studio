import { describe, expect, it } from 'vitest';
import type { TimelineClip } from '@neuralbridge/cinema';
import { buildSceneMontage, summarizeAssemblyOutcome } from '../src/main/cinema-pipeline.js';

const clip = (durationSec: number): TimelineClip => ({
  clipId: 'clip_3',
  trackId: 'v1',
  mediaId: 'fallback',
  label: 'shot_3',
  sourceRange: { start: { value: 0, rate: 30 }, duration: { value: durationSec * 30, rate: 30 } },
  timelineRange: { start: { value: 300, rate: 30 }, duration: { value: durationSec * 30, rate: 30 } },
  speed: 1,
  approved: true,
  effects: [],
  keyframes: [],
});

const sec = (r: { value: number; rate: number }) => r.value / r.rate;

describe('scene montage', () => {
  it('fills a scene with several verified intervals, each no longer than its proof, keeping the timeline span', () => {
    const { clips, record } = buildSceneMontage({
      clip: clip(20),
      sceneId: 'scene_08',
      label: 'Jujutsu Kaisen — Gojo',
      intervals: [
        { mediaId: 'a', startSec: 10, endSec: 18 },
        { mediaId: 'b', startSec: 40, endSec: 52 },
        { mediaId: 'c', startSec: 0, endSec: 30 },
      ],
      availableMediaIds: new Set(['a', 'b', 'c']),
      allowGraphicRecovery: true,
    });
    expect(clips.map((c) => c.mediaId)).toEqual(['a', 'b']);
    expect(clips.map((c) => sec(c.timelineRange.duration))).toEqual([8, 12]);
    expect(sec(clips[1]!.timelineRange.start)).toBe(10 + 8);
    expect(sec(clips[0]!.sourceRange.start)).toBe(10);
    expect(record).toMatchObject({ status: 'real_footage', realFootageSec: 20, graphicRecoverySec: 0 });
  });

  it('labels the uncovered remainder as graphic recovery instead of looping or repeating footage', () => {
    const { clips, record } = buildSceneMontage({
      clip: clip(20),
      sceneId: 'scene_12',
      label: 'Fullmetal Alchemist',
      intervals: [{ mediaId: 'a', startSec: 0, endSec: 6 }],
      availableMediaIds: new Set(['a']),
      allowGraphicRecovery: true,
    });
    expect(clips).toHaveLength(2);
    const recovery = clips[1]!;
    expect(recovery.effects.map((e) => e.kind)).toEqual(expect.arrayContaining(['allow_procedural', 'graphic_recovery']));
    expect(recovery.effects.find((e) => e.kind === 'graphic_recovery')?.params.presentedAsEvidence).toBe(false);
    expect(sec(recovery.timelineRange.duration)).toBe(14);
    expect(record).toMatchObject({ status: 'partial', realFootageSec: 6, graphicRecoverySec: 14 });
    expect(record.pendingReason).toMatch(/composição gráfica/);
  });

  it('ignores intervals of media that was not acquired', () => {
    const { clips, record } = buildSceneMontage({
      clip: clip(10),
      sceneId: 'scene_01',
      label: 'Black Clover',
      intervals: [{ mediaId: 'missing', startSec: 0, endSec: 10 }],
      availableMediaIds: new Set(),
      allowGraphicRecovery: true,
    });
    expect(clips).toHaveLength(1);
    expect(record.status).toBe('graphic_recovery');
  });

  it('completion message reports partial scenes and pending rights instead of "complete"', () => {
    const msg = summarizeAssemblyOutcome({
      sceneAssembly: [
        { sceneId: 'a', clipId: 'c1', label: 'A', timelineSec: 10, realFootageSec: 10, graphicRecoverySec: 0, mediaIds: ['m'], status: 'real_footage' },
        { sceneId: 'b', clipId: 'c2', label: 'B', timelineSec: 10, realFootageSec: 4, graphicRecoverySec: 6, mediaIds: ['m'], status: 'partial' },
      ],
      autonomousAudit: { pendingLicenseReview: [{ usedInDraft: true }, { usedInDraft: false }] } as never,
    });
    expect(msg).toMatch(/1\/2 cenas/);
    expect(msg).toMatch(/1 cena\(s\) usam composição gráfica/);
    expect(msg).toMatch(/1 mídia\(s\) aguardam revisão de direitos/);
  });
});
