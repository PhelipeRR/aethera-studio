import {
  addRational,
  fromFrames,
  invalidateAffectedSegments,
  recomputeTimelineFingerprints,
  snapshotTimelineRevision,
  toFrames,
  type CanonicalTimeline,
  type TimelineClip,
} from '../ir/timeline-ir.js';
import type { SafeZoneBox } from '../analysis/media-intelligence.js';

export type RenderQualityProfile = 'draft_540p' | 'review_720p' | 'master_1080p' | 'master_4k';

export interface RenderProfileConfig {
  profile: RenderQualityProfile;
  width: number;
  height: number;
  estimatedVramMb: number;
  fits8GbVram: boolean;
}

export const RENDER_PROFILES: Record<RenderQualityProfile, RenderProfileConfig> = {
  draft_540p: { profile: 'draft_540p', width: 960, height: 540, estimatedVramMb: 1400, fits8GbVram: true },
  review_720p: { profile: 'review_720p', width: 1280, height: 720, estimatedVramMb: 2400, fits8GbVram: true },
  master_1080p: { profile: 'master_1080p', width: 1920, height: 1080, estimatedVramMb: 4800, fits8GbVram: true },
  master_4k: { profile: 'master_4k', width: 3840, height: 2160, estimatedVramMb: 9200, fits8GbVram: false },
};

export interface SegmentRenderJob {
  clipId: string;
  fingerprint: string;
  cacheHit: boolean;
  profile: RenderProfileConfig;
  useCpuFallback: boolean;
}

export function trimClipFrameAccurate(
  timeline: CanonicalTimeline,
  clipId: string,
  deltaStartFrames: number,
  deltaDurationFrames: number,
): CanonicalTimeline {
  const clips = timeline.clips.map((clip) => {
    if (clip.clipId !== clipId) return clip;
    const curStart = toFrames(clip.timelineRange.start, timeline.fps);
    const curDur = toFrames(clip.timelineRange.duration, timeline.fps);
    const nextStart = Math.max(0, curStart + deltaStartFrames);
    const nextDur = Math.max(1, curDur + deltaDurationFrames);
    return {
      ...clip,
      timelineRange: {
        start: fromFrames(nextStart, timeline.fps),
        duration: fromFrames(nextDur, timeline.fps),
      },
    };
  });
  return snapshotTimelineRevision({ ...timeline, clips }, 'editorial_engine', `Trim clip ${clipId}`);
}

export function rippleDeleteClip(timeline: CanonicalTimeline, clipId: string): CanonicalTimeline {
  const target = timeline.clips.find((c) => c.clipId === clipId);
  if (!target) return timeline;
  const targetStart = toFrames(target.timelineRange.start, timeline.fps);
  const targetDur = toFrames(target.timelineRange.duration, timeline.fps);

  const clips: TimelineClip[] = timeline.clips
    .filter((c) => c.clipId !== clipId)
    .map((c) => {
      if (c.trackId !== target.trackId) return c;
      const cStart = toFrames(c.timelineRange.start, timeline.fps);
      if (cStart <= targetStart) return c;
      return {
        ...c,
        timelineRange: {
          ...c.timelineRange,
          start: fromFrames(Math.max(0, cStart - targetDur), timeline.fps),
        },
      };
    });

  return snapshotTimelineRevision({ ...timeline, clips }, 'editorial_engine', `Ripple delete ${clipId}`);
}

export function applyJLCutTransition(
  timeline: CanonicalTimeline,
  fromClipId: string,
  toClipId: string,
  kind: 'j_cut' | 'l_cut',
  overlapFrames: number,
  reason: string,
): CanonicalTimeline {
  const transitions = [
    ...timeline.transitions.filter((t) => !(t.fromClipId === fromClipId && t.toClipId === toClipId)),
    {
      transitionId: `tr_${fromClipId}_${toClipId}`,
      fromClipId,
      toClipId,
      kind,
      duration: fromFrames(Math.max(1, overlapFrames), timeline.fps),
      reason,
    },
  ];
  return snapshotTimelineRevision({ ...timeline, transitions }, 'editorial_engine', `Apply ${kind}`);
}

export function applySpeedRamp(
  timeline: CanonicalTimeline,
  clipId: string,
  speed: number,
): CanonicalTimeline {
  const clamped = Math.max(0.25, Math.min(4.0, speed));
  const clips = timeline.clips.map((c) => (c.clipId === clipId ? { ...c, speed: clamped } : c));
  return snapshotTimelineRevision({ ...timeline, clips }, 'editorial_engine', `Speed ramp ${clamped}x on ${clipId}`);
}

/**
 * Computes saliency-safe reframe crop box while preserving HUD and subtitle safe zones.
 */
export function computeSafeReframeBox(input: {
  sourceWidth: number;
  sourceHeight: number;
  targetAspect: '16:9' | '9:16';
  protectedRegions: SafeZoneBox[];
}): { x: number; y: number; width: number; height: number; hudPreserved: boolean } {
  if (input.targetAspect === '16:9') {
    return { x: 0, y: 0, width: input.sourceWidth, height: input.sourceHeight, hudPreserved: true };
  }
  const targetWidth = Math.min(input.sourceWidth, Math.round((input.sourceHeight * 9) / 16));
  const hud = input.protectedRegions.find((r) => r.label === 'hud');
  const preferredCenterX = hud ? Math.max(targetWidth / 2, hud.x * input.sourceWidth + targetWidth / 2) : input.sourceWidth / 2;
  const x = Math.max(0, Math.min(input.sourceWidth - targetWidth, Math.round(preferredCenterX - targetWidth / 2)));
  return {
    x,
    y: 0,
    width: targetWidth,
    height: input.sourceHeight,
    hudPreserved: !hud || x <= hud.x * input.sourceWidth,
  };
}

export class TransactionalUndoStack {
  private readonly past: CanonicalTimeline[] = [];
  private readonly future: CanonicalTimeline[] = [];
  private current: CanonicalTimeline;

  constructor(initial: CanonicalTimeline) {
    this.current = recomputeTimelineFingerprints(initial);
  }

  get state(): CanonicalTimeline {
    return this.current;
  }

  commit(next: CanonicalTimeline): CanonicalTimeline {
    this.past.push(this.current);
    this.future.length = 0;
    this.current = recomputeTimelineFingerprints(next);
    return this.current;
  }

  undo(): CanonicalTimeline | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(this.current);
    this.current = prev;
    return this.current;
  }

  redo(): CanonicalTimeline | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.current);
    this.current = next;
    return this.current;
  }
}

export function planIncrementalSegmentRenders(input: {
  previous: CanonicalTimeline | null;
  next: CanonicalTimeline;
  cachedFingerprints: Set<string>;
  profile: RenderQualityProfile;
  availableVramMb?: number;
}): SegmentRenderJob[] {
  const cfg = RENDER_PROFILES[input.profile];
  const useCpuFallback = (input.availableVramMb ?? 8192) < cfg.estimatedVramMb;
  const changed = input.previous
    ? new Set(invalidateAffectedSegments(input.previous, input.next).changedClipIds)
    : new Set(input.next.clips.map((c) => c.clipId));

  const nextUpdated = recomputeTimelineFingerprints(input.next);
  return nextUpdated.clips.map((clip) => {
    const fp = nextUpdated.segmentFingerprints[clip.clipId] ?? '';
    const cacheHit = !changed.has(clip.clipId) && input.cachedFingerprints.has(fp);
    return {
      clipId: clip.clipId,
      fingerprint: fp,
      cacheHit,
      profile: cfg,
      useCpuFallback,
    };
  });
}

export function buildClipFromShot(input: {
  clipId: string;
  trackId: string;
  mediaId: string;
  label: string;
  startFrames: number;
  durationFrames: number;
  fps: CanonicalTimeline['fps'];
  shotId?: string;
}): TimelineClip {
  return {
    clipId: input.clipId,
    trackId: input.trackId,
    mediaId: input.mediaId,
    label: input.label,
    sourceRange: {
      start: fromFrames(0, input.fps),
      duration: fromFrames(input.durationFrames, input.fps),
    },
    timelineRange: {
      start: fromFrames(input.startFrames, input.fps),
      duration: fromFrames(input.durationFrames, input.fps),
    },
    speed: 1,
    approved: false,
    effects: [],
    keyframes: [],
    ...(input.shotId ? { shotId: input.shotId } : {}),
  };
}

export function totalTimelineDurationSeconds(timeline: CanonicalTimeline): number {
  let maxEndFrames = 0;
  for (const clip of timeline.clips) {
    const end = toFrames(
      addRational(clip.timelineRange.start, clip.timelineRange.duration),
      timeline.fps,
    );
    if (end > maxEndFrames) maxEndFrames = end;
  }
  return maxEndFrames / (timeline.fps.value / timeline.fps.rate);
}
