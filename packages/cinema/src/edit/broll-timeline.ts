import type { SceneMatch } from '@neuralbridge/shared';
import { fromFrames, rationalToSeconds, toFrames, type CanonicalTimeline } from '../ir/timeline-ir.js';

export interface BrollTimelineSelection extends Pick<SceneMatch, 'sceneId' | 'sourceStartMs' | 'sourceEndMs' | 'segmentId'> {
  mediaId: string;
}

/**
 * Applies already-eligible Scene Grounding matches to the source ranges of existing clips. The measured Audio-First
 * clock lives in `timelineRange` and is intentionally untouched. One asset may supply multiple different intervals.
 */
export function applyBrollSelectionsToTimeline(
  timeline: CanonicalTimeline,
  selections: readonly BrollTimelineSelection[],
): CanonicalTimeline {
  const selectionByScene = new Map(selections.map((selection) => [selection.sceneId, selection]));
  const clips = timeline.clips.map((clip) => {
    const sceneId = clip.shotId ?? clip.clipId;
    const selection = selectionByScene.get(sceneId);
    if (!selection) return clip;
    const media = timeline.sourceMedia[selection.mediaId];
    if (!media || media.kind !== 'video') throw new Error(`broll_media_missing: ${selection.mediaId}`);
    if (!Number.isInteger(selection.sourceStartMs) || !Number.isInteger(selection.sourceEndMs) || selection.sourceStartMs < 0 || selection.sourceEndMs <= selection.sourceStartMs) {
      throw new Error(`broll_interval_invalid: ${selection.segmentId}`);
    }
    const startFrames = Math.max(0, Math.round((selection.sourceStartMs / 1_000) * (timeline.fps.value / timeline.fps.rate)));
    const durationFrames = Math.max(1, Math.round(((selection.sourceEndMs - selection.sourceStartMs) / 1_000) * (timeline.fps.value / timeline.fps.rate)));
    const sourceDurationFrames = toFrames(media.duration, timeline.fps);
    if (startFrames + durationFrames > sourceDurationFrames) throw new Error(`broll_interval_out_of_bounds: ${selection.segmentId}`);
    return { ...clip, mediaId: selection.mediaId, sourceRange: { start: fromFrames(startFrames, timeline.fps), duration: fromFrames(durationFrames, timeline.fps) } };
  });
  return { ...timeline, clips };
}

/** Returns a stable audit record for the source range selected for one clip. */
export function brollSelectionAudit(timeline: CanonicalTimeline, selection: BrollTimelineSelection): { mediaId: string; segmentId: string; sourceStartMs: number; sourceEndMs: number; sourceDurationMs: number } {
  const media = timeline.sourceMedia[selection.mediaId];
  if (!media) throw new Error(`broll_media_missing: ${selection.mediaId}`);
  return { mediaId: selection.mediaId, segmentId: selection.segmentId, sourceStartMs: selection.sourceStartMs, sourceEndMs: selection.sourceEndMs, sourceDurationMs: Math.round(rationalToSeconds(media.duration) * 1_000) };
}
