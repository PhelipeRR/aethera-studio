import { createHash } from 'node:crypto';
import { z } from 'zod';

export const CINEMA_SCHEMA_VERSION = '1.0.0' as const;

export const rationalTimeSchema = z.object({
  value: z.number().int(),
  rate: z.number().int().positive(),
});
export type RationalTime = z.infer<typeof rationalTimeSchema>;

export const timeRangeSchema = z.object({
  start: rationalTimeSchema,
  duration: rationalTimeSchema,
});
export type TimeRange = z.infer<typeof timeRangeSchema>;

export const humorProfileSchema = z.object({
  profileId: z.enum(['cinematic_subtle_humor', 'deadpan_minimal', 'energetic_playful', 'disabled']),
  label: z.string(),
  humorIntensity: z.number().min(0).max(100),
  forbiddenContexts: z.array(z.string()),
  maxBeatsPerMinute: z.number().min(0),
});
export type HumorProfile = z.infer<typeof humorProfileSchema>;

export const DEFAULT_HUMOR_PROFILE: HumorProfile = {
  profileId: 'cinematic_subtle_humor',
  label: 'Cinematográfico com humor pontual',
  humorIntensity: 35,
  forbiddenContexts: ['tragedy', 'grief', 'sensitive_disclosure', 'critical_instruction'],
  maxBeatsPerMinute: 2.5,
};

export interface SourceMediaRecord {
  mediaId: string;
  uri: string;
  sha256: string;
  kind: 'video' | 'audio' | 'image' | 'subtitle';
  origin: 'local' | 'licensed_stock' | 'generated' | 'user_recording';
  license: string;
  duration: RationalTime;
  width?: number;
  height?: number;
  fps?: RationalTime;
  hasAudio?: boolean;
  offline?: boolean;
}

export interface TimelineKeyframe {
  keyframeId: string;
  time: RationalTime;
  property: string;
  value: number | string;
  easing: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out' | 'cubic_bezier';
}

export interface TimelineEffect {
  effectId: string;
  kind: string;
  params: Record<string, number | string | boolean>;
  enabled: boolean;
  estimatedCostMs: number;
  fallbackMode: 'skip' | 'cpu_basic' | 'static_frame';
}

export interface TimelineClip {
  clipId: string;
  trackId: string;
  mediaId: string;
  label: string;
  sourceRange: TimeRange;
  timelineRange: TimeRange;
  speed: number;
  approved: boolean;
  effects: TimelineEffect[];
  keyframes: TimelineKeyframe[];
  comedyBeatId?: string;
  shotId?: string;
  transitionIn?: 'cut' | 'dissolve' | 'j_cut' | 'l_cut' | 'match_cut' | 'wipe';
}

/** Alias semântico usado pelo planejamento audiovisual de cena; equivalente a ComedyBeatPlan. */
export type ComedyBeat = ComedyBeatPlan;

export interface TimelineTrack {
  trackId: string;
  kind: 'video' | 'narration' | 'music' | 'ambience' | 'foley' | 'sfx' | 'subtitle' | 'vfx';
  label: string;
  muted: boolean;
  locked: boolean;
}

export interface TimelineTransition {
  transitionId: string;
  fromClipId: string;
  toClipId: string;
  kind: 'cut' | 'dissolve' | 'j_cut' | 'l_cut' | 'match_cut' | 'wipe';
  duration: RationalTime;
  reason: string;
}

export interface TimelineMarker {
  markerId: string;
  time: RationalTime;
  kind: 'narrative_beat' | 'comedy_beat' | 'qc_issue' | 'chapter' | 'user_note';
  label: string;
}

export interface ComedyBeatPlan {
  beatId: string;
  timeRange: TimeRange;
  setupEvidence: string;
  humorMechanism: 'situational_contrast' | 'epic_mundane' | 'dry_irony' | 'callback' | 'timing_pause';
  punchline: string;
  pauseFrames: number;
  deliveryStyle: 'deadpan' | 'understated' | 'timing_cut' | 'visual_callback';
  editActions: Array<'hard_cut' | 'freeze_frame' | 'punch_zoom' | 'short_replay' | 'intentional_silence'>;
  sfxCues: string[];
  vfxCues: string[];
  confidence: number;
  contextRisk: 'low' | 'medium' | 'high';
  fallbackWithoutHumor: string;
  reviewStatus: 'proposed' | 'approved' | 'rejected';
}

export interface QcFindingRecord {
  issueId: string;
  timeRange: TimeRange;
  category: 'technical' | 'visual' | 'audio' | 'narrative' | 'comedy' | 'rights';
  severity: 'info' | 'warning' | 'critical';
  confidence: number;
  evidence: string;
  owner: 'editor' | 'vfx' | 'color' | 'sound' | 'director' | 'comedy';
  fixSuggestion: string;
  affectedDependencies: string[];
  status: 'open' | 'repaired' | 'waived' | 'escalated';
  beforeAfter?: { beforeFingerprint: string; afterFingerprint: string; notes: string };
  recheckResult?: 'passed' | 'failed';
  waiverReason?: string;
}

export interface TimelineRevisionEntry {
  revisionId: string;
  version: number;
  timestampIso: string;
  author: string;
  summary: string;
  renderFingerprint: string;
}

export interface CanonicalTimeline {
  schemaVersion: string;
  projectId: string;
  version: number;
  fps: RationalTime;
  resolution: { width: number; height: number };
  colorSpace: 'Rec.709' | 'Rec.2020_PQ';
  audioSampleRate: 48000 | 44100;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  transitions: TimelineTransition[];
  markers: TimelineMarker[];
  sourceMedia: Record<string, SourceMediaRecord>;
  provenance: Array<{ mediaId: string; sha256: string; license: string; origin: string }>;
  renderFingerprint: string;
  segmentFingerprints: Record<string, string>;
  qcFindings: QcFindingRecord[];
  humorProfile: HumorProfile;
  comedyBeats: ComedyBeatPlan[];
  revisionHistory: TimelineRevisionEntry[];
}

export function rationalTime(value: number, rate: number): RationalTime {
  return { value: Math.round(value), rate };
}

export function rationalToSeconds(t: RationalTime): number {
  return t.value / t.rate;
}

export function toFrames(t: RationalTime, targetFps: RationalTime): number {
  return Math.round((t.value * targetFps.value) / (t.rate * targetFps.rate));
}

export function fromFrames(frames: number, fps: RationalTime): RationalTime {
  return { value: Math.round(frames * fps.rate), rate: fps.value };
}

export function addRational(a: RationalTime, b: RationalTime): RationalTime {
  if (a.rate === b.rate) return { value: a.value + b.value, rate: a.rate };
  return {
    value: a.value * b.rate + b.value * a.rate,
    rate: a.rate * b.rate,
  };
}

export function computeSegmentFingerprint(clip: TimelineClip, media?: SourceMediaRecord): string {
  const h = createHash('sha256');
  h.update(
    JSON.stringify({
      clipId: clip.clipId,
      mediaId: clip.mediaId,
      mediaHash: media?.sha256 ?? 'missing',
      sourceRange: clip.sourceRange,
      timelineRange: clip.timelineRange,
      speed: clip.speed,
      effects: clip.effects,
      keyframes: clip.keyframes,
    }),
  );
  return h.digest('hex').slice(0, 16);
}

export function recomputeTimelineFingerprints(timeline: CanonicalTimeline): CanonicalTimeline {
  const segmentFingerprints: Record<string, string> = {};
  for (const clip of timeline.clips) {
    segmentFingerprints[clip.clipId] = computeSegmentFingerprint(
      clip,
      timeline.sourceMedia[clip.mediaId],
    );
  }
  const h = createHash('sha256');
  h.update(
    JSON.stringify({
      schemaVersion: timeline.schemaVersion,
      fps: timeline.fps,
      resolution: timeline.resolution,
      colorSpace: timeline.colorSpace,
      segmentFingerprints,
      transitions: timeline.transitions,
    }),
  );
  return {
    ...timeline,
    segmentFingerprints,
    renderFingerprint: h.digest('hex').slice(0, 24),
  };
}

export function invalidateAffectedSegments(
  previous: CanonicalTimeline,
  next: CanonicalTimeline,
): { changedClipIds: string[]; preservedApprovedIds: string[] } {
  const prevUpdated = recomputeTimelineFingerprints(previous);
  const nextUpdated = recomputeTimelineFingerprints(next);
  const changedClipIds: string[] = [];
  const preservedApprovedIds: string[] = [];

  for (const clip of nextUpdated.clips) {
    const prevFp = prevUpdated.segmentFingerprints[clip.clipId];
    const nextFp = nextUpdated.segmentFingerprints[clip.clipId];
    if (prevFp !== nextFp) {
      changedClipIds.push(clip.clipId);
    } else if (clip.approved) {
      preservedApprovedIds.push(clip.clipId);
    }
  }
  return { changedClipIds, preservedApprovedIds };
}

export function createEmptyCanonicalTimeline(input: {
  projectId: string;
  fps?: RationalTime;
  resolution?: { width: number; height: number };
  humorProfile?: Partial<HumorProfile>;
}): CanonicalTimeline {
  const fps = input.fps ?? { value: 30, rate: 1 };
  const resolution = input.resolution ?? { width: 1920, height: 1080 };
  const humorProfile: HumorProfile = {
    ...DEFAULT_HUMOR_PROFILE,
    ...input.humorProfile,
  };
  const base: CanonicalTimeline = {
    schemaVersion: CINEMA_SCHEMA_VERSION,
    projectId: input.projectId,
    version: 1,
    fps,
    resolution,
    colorSpace: 'Rec.709',
    audioSampleRate: 48000,
    tracks: [
      { trackId: 'v1', kind: 'video', label: 'Video Primary', muted: false, locked: false },
      { trackId: 'vfx1', kind: 'vfx', label: 'VFX & Typography', muted: false, locked: false },
      { trackId: 'a_nar', kind: 'narration', label: 'Narration', muted: false, locked: false },
      { trackId: 'a_mus', kind: 'music', label: 'Music Bed', muted: false, locked: false },
      { trackId: 'a_sfx', kind: 'sfx', label: 'SFX & Foley', muted: false, locked: false },
      { trackId: 'sub1', kind: 'subtitle', label: 'Subtitles', muted: false, locked: false },
    ],
    clips: [],
    transitions: [],
    markers: [],
    sourceMedia: {},
    provenance: [],
    renderFingerprint: '',
    segmentFingerprints: {},
    qcFindings: [],
    humorProfile,
    comedyBeats: [],
    revisionHistory: [],
  };
  return recomputeTimelineFingerprints(base);
}

/**
 * Exports canonical timeline to an OpenTimelineIO-compatible JSON structure.
 * Proprietary Aethera effects are serialized under explicit `metadata.aethera`.
 */
export function exportToOtioJson(timeline: CanonicalTimeline): string {
  const fpsNum = timeline.fps.value / timeline.fps.rate;
  const otio = {
    OTIO_SCHEMA: 'Timeline.1',
    name: timeline.projectId,
    metadata: {
      aetheraSchemaVersion: timeline.schemaVersion,
      renderFingerprint: timeline.renderFingerprint,
      humorProfile: timeline.humorProfile,
      unsupportedProprietaryEffectsNotice: 'Aethera VFX/Color metadata stored in clip.metadata.aethera',
    },
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      children: timeline.tracks.map((track) => ({
        OTIO_SCHEMA: 'Track.1',
        name: track.label,
        kind: track.kind === 'video' || track.kind === 'vfx' ? 'Video' : 'Audio',
        metadata: { trackId: track.trackId, aetheraKind: track.kind },
        children: timeline.clips
          .filter((c) => c.trackId === track.trackId)
          .map((clip) => ({
            OTIO_SCHEMA: 'Clip.2',
            name: clip.label,
            source_range: {
              OTIO_SCHEMA: 'TimeRange.1',
              start_time: {
                OTIO_SCHEMA: 'RationalTime.1',
                value: toFrames(clip.sourceRange.start, timeline.fps),
                rate: fpsNum,
              },
              duration: {
                OTIO_SCHEMA: 'RationalTime.1',
                value: toFrames(clip.sourceRange.duration, timeline.fps),
                rate: fpsNum,
              },
            },
            media_reference: {
              OTIO_SCHEMA: 'ExternalReference.1',
              target_url: timeline.sourceMedia[clip.mediaId]?.uri ?? '',
            },
            metadata: {
              aethera: {
                clipId: clip.clipId,
                mediaId: clip.mediaId,
                effects: clip.effects,
                keyframes: clip.keyframes,
                approved: clip.approved,
              },
            },
          })),
      })),
    },
  };
  return JSON.stringify(otio, null, 2);
}

export function snapshotTimelineRevision(
  timeline: CanonicalTimeline,
  author: string,
  summary: string,
): CanonicalTimeline {
  const updated = recomputeTimelineFingerprints({
    ...timeline,
    version: timeline.version + 1,
  });
  return {
    ...updated,
    revisionHistory: [
      ...updated.revisionHistory,
      {
        revisionId: `rev_${updated.version}_${Date.now()}`,
        version: updated.version,
        timestampIso: new Date().toISOString(),
        author,
        summary,
        renderFingerprint: updated.renderFingerprint,
      },
    ],
  };
}
