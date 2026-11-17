import { describe, expect, it } from 'vitest';
import { applyBrollSelectionsToTimeline, brollSelectionAudit } from '../src/edit/broll-timeline.js';
import { createEmptyCanonicalTimeline, fromFrames } from '../src/ir/timeline-ir.js';

const makeTimeline = () => {
  const timeline = createEmptyCanonicalTimeline({ projectId: 'p2', fps: { value: 30, rate: 1 }, resolution: { width: 1_920, height: 1_080 }, humorProfile: { profileId: 'disabled', label: 'Disabled', humorIntensity: 0, forbiddenContexts: [], maxBeatsPerMinute: 0 } });
  timeline.sourceMedia.main = { mediaId: 'main', uri: 'cyberpunk.mp4', sha256: 'a'.repeat(64), kind: 'video', origin: 'local', license: 'user_owned', duration: fromFrames(300, timeline.fps), width: 1_920, height: 1_080, fps: timeline.fps, hasAudio: false };
  timeline.clips = [
    { clipId: 'c1', trackId: 'v1', mediaId: 'main', label: 'scene-1', shotId: 'scene-1', sourceRange: { start: fromFrames(0, timeline.fps), duration: fromFrames(90, timeline.fps) }, timelineRange: { start: fromFrames(0, timeline.fps), duration: fromFrames(90, timeline.fps) }, speed: 1, approved: false, effects: [], keyframes: [] },
    { clipId: 'c2', trackId: 'v1', mediaId: 'main', label: 'scene-2', shotId: 'scene-2', sourceRange: { start: fromFrames(0, timeline.fps), duration: fromFrames(90, timeline.fps) }, timelineRange: { start: fromFrames(90, timeline.fps), duration: fromFrames(90, timeline.fps) }, speed: 1, approved: false, effects: [], keyframes: [] },
  ];
  return timeline;
};

describe('P2 B-roll timeline integration', () => {
  it('applies distinct source intervals to multiple scenes without changing the measured timeline clock', () => {
    const timeline = makeTimeline();
    const next = applyBrollSelectionsToTimeline(timeline, [
      { sceneId: 'scene-1', segmentId: 'seg-a', mediaId: 'main', sourceStartMs: 1_000, sourceEndMs: 2_000 },
      { sceneId: 'scene-2', segmentId: 'seg-b', mediaId: 'main', sourceStartMs: 5_000, sourceEndMs: 7_000 },
    ]);
    expect(next.clips.map((clip) => [clip.sourceRange.start.value, clip.sourceRange.duration.value])).toEqual([[30, 30], [150, 60]]);
    expect(next.clips.map((clip) => clip.timelineRange.start.value)).toEqual([0, 90]);
    expect(brollSelectionAudit(next, { sceneId: 'scene-2', segmentId: 'seg-b', mediaId: 'main', sourceStartMs: 5_000, sourceEndMs: 7_000 })).toEqual({ mediaId: 'main', segmentId: 'seg-b', sourceStartMs: 5_000, sourceEndMs: 7_000, sourceDurationMs: 10_000 });
  });

  it('rejects unavailable or incomplete source ranges instead of looping or padding them', () => {
    expect(() => applyBrollSelectionsToTimeline(makeTimeline(), [{ sceneId: 'scene-1', segmentId: 'missing', mediaId: 'nope', sourceStartMs: 0, sourceEndMs: 1_000 }])).toThrow(/broll_media_missing/);
    expect(() => applyBrollSelectionsToTimeline(makeTimeline(), [{ sceneId: 'scene-1', segmentId: 'late', mediaId: 'main', sourceStartMs: 9_500, sourceEndMs: 10_500 }])).toThrow(/broll_interval_out_of_bounds/);
  });
});
