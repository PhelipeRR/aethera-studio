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
  sourceStartFrames?: number;
  durationFrames: number;
  fps: CanonicalTimeline['fps'];
  shotId?: string;
  transitionIn?: TimelineClip['transitionIn'];
  effects?: TimelineClip['effects'];
}): TimelineClip {
  return {
    clipId: input.clipId,
    trackId: input.trackId,
    mediaId: input.mediaId,
    label: input.label,
    sourceRange: {
      start: fromFrames(input.sourceStartFrames ?? 0, input.fps),
      duration: fromFrames(input.durationFrames, input.fps),
    },
    timelineRange: {
      start: fromFrames(input.startFrames, input.fps),
      duration: fromFrames(input.durationFrames, input.fps),
    },
    speed: 1,
    approved: false,
    effects: input.effects ?? [],
    keyframes: [],
    ...(input.transitionIn ? { transitionIn: input.transitionIn } : {}),
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

export type VideoBlendMode = 'normal' | 'screen' | 'multiply' | 'overlay' | 'darken' | 'lighten';

export function splitClipAtFrame(
  timeline: CanonicalTimeline,
  clipId: string,
  splitFrame: number,
): CanonicalTimeline {
  const idx = timeline.clips.findIndex((c) => c.clipId === clipId);
  if (idx < 0) return timeline;
  const target = timeline.clips[idx];
  if (!target) return timeline;
  const startF = toFrames(target.timelineRange.start, timeline.fps);
  const durF = toFrames(target.timelineRange.duration, timeline.fps);
  const offsetF = Math.round(splitFrame - startF);
  if (offsetF < 3 || offsetF > durF - 3) return timeline;

  const srcStartF = toFrames(target.sourceRange.start, timeline.fps);
  const srcOffsetF = Math.round(offsetF * Math.max(0.25, target.speed || 1));

  const leftClip: TimelineClip = {
    ...target,
    clipId: `${target.clipId}_a`,
    sourceRange: {
      start: fromFrames(srcStartF, timeline.fps),
      duration: fromFrames(srcOffsetF, timeline.fps),
    },
    timelineRange: {
      start: fromFrames(startF, timeline.fps),
      duration: fromFrames(offsetF, timeline.fps),
    },
  };

  const rightClip: TimelineClip = {
    ...target,
    clipId: `${target.clipId}_b`,
    label: `${target.label} (pt.2)`,
    sourceRange: {
      start: fromFrames(srcStartF + srcOffsetF, timeline.fps),
      duration: fromFrames(Math.max(3, toFrames(target.sourceRange.duration, timeline.fps) - srcOffsetF), timeline.fps),
    },
    timelineRange: {
      start: fromFrames(startF + offsetF, timeline.fps),
      duration: fromFrames(durF - offsetF, timeline.fps),
    },
    effects: target.effects.map((e) => ({ ...e })),
    keyframes: target.keyframes.map((k) => ({ ...k })),
  };

  const clips = [...timeline.clips];
  clips.splice(idx, 1, leftClip, rightClip);
  return snapshotTimelineRevision({ ...timeline, clips }, 'editorial_engine', `Split clip ${clipId} @ ${splitFrame}f`);
}

export function moveClip(
  timeline: CanonicalTimeline,
  clipId: string,
  targetTrackId: string,
  newStartFrame: number,
): CanonicalTimeline {
  const target = timeline.clips.find((c) => c.clipId === clipId);
  if (!target) return timeline;
  const oldStartF = toFrames(target.timelineRange.start, timeline.fps);
  const clampedStartF = Math.max(0, Math.round(newStartFrame));
  const deltaF = clampedStartF - oldStartF;

  const groupId = target.effects.find((e) => e.kind === 'group')?.params['groupId'];
  const clips = timeline.clips.map((c) => {
    const inSameGroup =
      groupId !== undefined && c.effects.some((e) => e.kind === 'group' && e.params['groupId'] === groupId);
    if (c.clipId !== clipId && !inSameGroup) return c;
    const cStart = toFrames(c.timelineRange.start, timeline.fps);
    return {
      ...c,
      ...(c.clipId === clipId ? { trackId: targetTrackId } : {}),
      timelineRange: {
        ...c.timelineRange,
        start: fromFrames(Math.max(0, cStart + deltaF), timeline.fps),
      },
    };
  });
  return snapshotTimelineRevision({ ...timeline, clips }, 'editorial_engine', `Move ${clipId} to ${targetTrackId}@${clampedStartF}f`);
}

export function groupClips(
  timeline: CanonicalTimeline,
  clipIds: string[],
  groupId = `grp_${Date.now()}`,
): CanonicalTimeline {
  const set = new Set(clipIds);
  if (set.size < 2) return timeline;
  const clips = timeline.clips.map((c) => {
    if (!set.has(c.clipId)) return c;
    const filtered = c.effects.filter((e) => e.kind !== 'group');
    return {
      ...c,
      effects: [
        ...filtered,
        {
          effectId: `group_${c.clipId}`,
          kind: 'group',
          params: { groupId },
          enabled: true,
          estimatedCostMs: 0,
          fallbackMode: 'skip' as const,
        },
      ],
    };
  });
  return snapshotTimelineRevision({ ...timeline, clips }, 'editorial_engine', `Group ${clipIds.length} clips (${groupId})`);
}

export function ungroupClips(timeline: CanonicalTimeline, clipIds: string[]): CanonicalTimeline {
  const set = new Set(clipIds);
  const clips = timeline.clips.map((c) =>
    set.has(c.clipId) ? { ...c, effects: c.effects.filter((e) => e.kind !== 'group') } : c,
  );
  return snapshotTimelineRevision({ ...timeline, clips }, 'editorial_engine', `Ungroup clips`);
}

export function setClipTransformAndBlend(
  timeline: CanonicalTimeline,
  clipId: string,
  patch: {
    blendMode?: VideoBlendMode;
    opacity?: number;
    scale?: number;
    rotationDeg?: number;
    x?: number;
    y?: number;
    keyframeAtFrame?: number;
  },
): CanonicalTimeline {
  const time = fromFrames(Math.max(0, Math.round(patch.keyframeAtFrame ?? 0)), timeline.fps);
  const clips = timeline.clips.map((c) => {
    if (c.clipId !== clipId) return c;
    let effects = [...c.effects];
    if (patch.blendMode) {
      effects = effects.filter((e) => e.kind !== 'blend_mode');
      effects.push({
        effectId: `blend_${c.clipId}`,
        kind: 'blend_mode',
        params: { mode: patch.blendMode },
        enabled: true,
        estimatedCostMs: 4,
        fallbackMode: 'skip',
      });
    }

    const keyframes = [...c.keyframes];
    const upsertKf = (property: string, value: number | undefined) => {
      if (value === undefined || !Number.isFinite(value)) return;
      const existingIdx = keyframes.findIndex(
        (k) => k.property === property && toFrames(k.time, timeline.fps) === toFrames(time, timeline.fps),
      );
      const kf = {
        keyframeId: `kf_${c.clipId}_${property}_${toFrames(time, timeline.fps)}`,
        time,
        property,
        value,
        easing: 'ease_in_out' as const,
      };
      if (existingIdx >= 0) keyframes[existingIdx] = kf;
      else keyframes.push(kf);
    };

    upsertKf('opacity', patch.opacity);
    upsertKf('scale', patch.scale);
    upsertKf('rotation', patch.rotationDeg);
    upsertKf('x', patch.x);
    upsertKf('y', patch.y);

    return { ...c, effects, keyframes };
  });
  return snapshotTimelineRevision({ ...timeline, clips }, 'editorial_engine', `Transform/Blend on ${clipId}`);
}

export function setClipAudioFades(
  timeline: CanonicalTimeline,
  clipId: string,
  patch: { fadeInSec?: number; fadeOutSec?: number; gainDb?: number },
): CanonicalTimeline {
  const clips = timeline.clips.map((c) => {
    if (c.clipId !== clipId) return c;
    const prev = c.effects.find((e) => e.kind === 'audio_envelope')?.params ?? {};
    const nextParams: Record<string, number | string | boolean> = {
      fadeInSec: patch.fadeInSec ?? (typeof prev['fadeInSec'] === 'number' ? prev['fadeInSec'] : 0),
      fadeOutSec: patch.fadeOutSec ?? (typeof prev['fadeOutSec'] === 'number' ? prev['fadeOutSec'] : 0),
      gainDb: patch.gainDb ?? (typeof prev['gainDb'] === 'number' ? prev['gainDb'] : 0),
    };
    return {
      ...c,
      effects: [
        ...c.effects.filter((e) => e.kind !== 'audio_envelope'),
        {
          effectId: `env_${c.clipId}`,
          kind: 'audio_envelope',
          params: nextParams,
          enabled: true,
          estimatedCostMs: 1,
          fallbackMode: 'skip' as const,
        },
      ],
    };
  });
  return snapshotTimelineRevision({ ...timeline, clips }, 'editorial_engine', `Audio fades on ${clipId}`);
}

export function upsertClipTransition(
  timeline: CanonicalTimeline,
  fromClipId: string,
  toClipId: string,
  kind: CanonicalTimeline['transitions'][number]['kind'],
  durationFrames: number,
  reason = 'User NLE transition',
): CanonicalTimeline {
  const transitions = [
    ...timeline.transitions.filter((t) => !(t.fromClipId === fromClipId && t.toClipId === toClipId)),
    {
      transitionId: `tr_${fromClipId}_${toClipId}`,
      fromClipId,
      toClipId,
      kind,
      duration: fromFrames(Math.max(1, Math.round(durationFrames)), timeline.fps),
      reason,
    },
  ];
  // Also reflect on destination clip effect so real-renderer xfade reads it directly
  const durationSec = Number((Math.max(1, durationFrames) / (timeline.fps.value / timeline.fps.rate)).toFixed(2));
  const trKindMap: Record<string, string> = {
    cut: 'fade',
    dissolve: 'dissolve',
    wipe: 'wipeleft',
    match_cut: 'smoothleft',
    j_cut: 'fade',
    l_cut: 'fade',
  };
  const clips = timeline.clips.map((c) => {
    if (c.clipId !== toClipId) return c;
    const filtered = c.effects.filter((e) => e.kind !== 'transition');
    if (kind === 'cut') return { ...c, effects: filtered };
    return {
      ...c,
      effects: [
        ...filtered,
        {
          effectId: `tr_${c.clipId}`,
          kind: 'transition',
          params: { transitionKind: trKindMap[kind] ?? 'dissolve', durationSec },
          enabled: true,
          estimatedCostMs: 5,
          fallbackMode: 'skip' as const,
        },
      ],
    };
  });
  return snapshotTimelineRevision({ ...timeline, transitions, clips }, 'editorial_engine', `Transition ${kind} (${durationSec}s)`);
}

export function upsertSubtitleClip(
  timeline: CanonicalTimeline,
  input: {
    clipId?: string;
    trackId?: string;
    text: string;
    startFrames: number;
    durationFrames: number;
    animation?: 'fade_up' | 'pop' | 'slide' | 'none';
  },
): CanonicalTimeline {
  const trackId = input.trackId ?? 'sub1';
  const clipId = input.clipId ?? `sub_${Date.now()}`;
  const hasTrack = timeline.tracks.some((t) => t.trackId === trackId);
  const tracks = hasTrack
    ? timeline.tracks
    : [...timeline.tracks, { trackId, kind: 'subtitle' as const, label: 'Legendas', muted: false, locked: false }];

  const nextClip: TimelineClip = {
    clipId,
    trackId,
    mediaId: 'subtitle_virtual',
    label: input.text,
    sourceRange: { start: fromFrames(0, timeline.fps), duration: fromFrames(input.durationFrames, timeline.fps) },
    timelineRange: {
      start: fromFrames(Math.max(0, Math.round(input.startFrames)), timeline.fps),
      duration: fromFrames(Math.max(6, Math.round(input.durationFrames)), timeline.fps),
    },
    speed: 1,
    approved: true,
    effects: [
      {
        effectId: `sub_fx_${clipId}`,
        kind: 'subtitle_style',
        params: { text: input.text, animation: input.animation ?? 'fade_up' },
        enabled: true,
        estimatedCostMs: 2,
        fallbackMode: 'skip',
      },
    ],
    keyframes: [],
  };

  const exists = timeline.clips.some((c) => c.clipId === clipId);
  const clips = exists
    ? timeline.clips.map((c) => (c.clipId === clipId ? nextClip : c))
    : [...timeline.clips, nextClip];

  return snapshotTimelineRevision({ ...timeline, tracks, clips }, 'editorial_engine', `Subtitle ${clipId}`);
}
