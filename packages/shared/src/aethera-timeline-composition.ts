import { z } from 'zod';
import { captionFontPx, captionLineCharsFor, sceneCaptionCues, type CaptionCue } from './aethera-editorial.js';

// The composition draws captions at the same size and line width the cues were built for.
export { captionFontPx, captionLineCharsFor };
export { SUBJECT_LABEL_STYLE } from './aethera-shot-footage.js';
// Smart Director panels: geometry and props shared by the planner and the composition.
export { diagramPropsSchema, type DiagramProps, kineticPropsSchema, panelClipPath, panelShapes, panelSpanAt, panelsPropsSchema, type KineticProps, type PanelsProps } from './aethera-smart-director.js';
import { clipDepictions, timelineDocumentSchema, timelineHash, type ClipSource, type TimelineClip, type TimelineDocument, type TimelineTextWord } from './aethera-timeline.js';

const compositionWindowSchema = z.strictObject({ fromMs: z.number().int().nonnegative(), durationMs: z.number().int().positive() });
export type AetheraCompositionWindow = z.infer<typeof compositionWindowSchema>;

const compositionWordSchema = z.strictObject({ text: z.string().min(1), startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative() });
const compositionLayerSchema = z.strictObject({
  id: z.string().min(1), clipId: z.string().min(1), trackId: z.string().min(1), trackKind: z.enum(['video', 'graphics', 'text', 'captions', 'narration', 'music', 'sfx']),
  zIndex: z.number().int().nonnegative(), startFrame: z.number().int().nonnegative(), durationInFrames: z.number().int().positive(), clipStartMs: z.number().int().nonnegative(),
  sceneIds: z.array(z.string()), subjectId: z.string().optional(), depiction: z.enum(clipDepictions).optional(), source: z.custom<ClipSource>(), transform: z.custom<TimelineClip['transform']>(), keyframes: z.array(z.custom<TimelineClip['keyframes'][number]>()), effects: z.array(z.custom<TimelineClip['effects'][number]>()), enter: z.custom<NonNullable<TimelineClip['enter']>>().optional(), exit: z.custom<NonNullable<TimelineClip['exit']>>().optional(), words: z.array(compositionWordSchema),
  /** E3: reading cues of a caption layer, on the layer's clock; the composition draws only these, never the paragraph. */
  cues: z.array(z.strictObject({ startMs: z.number().int(), endMs: z.number().int(), lines: z.array(z.string().min(1)).min(1).max(2) })).optional(),
});
export type AetheraCompositionLayer = z.infer<typeof compositionLayerSchema>;

export const aetheraTimelineCompositionPropsSchema = z.strictObject({
  schemaVersion: z.literal(1), compositionId: z.literal('aethera-timeline'), timelineId: z.string(), timelineVersion: z.number().int().positive(), timelineHash: z.string().regex(/^[0-9a-f]+$/u),
  window: compositionWindowSchema, format: z.object({ id: z.string(), width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(), aspectRatio: z.string(), safeArea: z.object({ top: z.number(), right: z.number(), bottom: z.number(), left: z.number() }) }),
  background: z.strictObject({ kind: z.literal('gradient'), from: z.string(), to: z.string(), angle: z.number() }), layers: z.array(compositionLayerSchema),
});
export type AetheraTimelineCompositionProps = z.infer<typeof aetheraTimelineCompositionPropsSchema>;

export interface AetheraTimelineRenderSegment { index: number; fromMs: number; durationMs: number; key: string }

const frameAt = (ms: number, fps: number) => Math.round((ms * fps) / 1_000);
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
const clipEnd = (clip: TimelineClip) => clip.startMs + clip.durationMs;
const active = (clip: TimelineClip, fromMs: number, toMs: number) => clip.startMs < toMs && clipEnd(clip) > fromMs;

function sourceForWindow(source: ClipSource, clip: TimelineClip, overlapStartMs: number, overlapEndMs: number): ClipSource {
  if (source.kind !== 'media') return source;
  const elapsedStart = Math.max(0, overlapStartMs - clip.startMs);
  const elapsedEnd = Math.max(elapsedStart, overlapEndMs - clip.startMs);
  return { ...source, inMs: Math.round(source.inMs + elapsedStart * source.speed), outMs: Math.max(Math.round(source.inMs + elapsedEnd * source.speed), Math.round(source.inMs + 1)) };
}

function wordsFor(source: ClipSource, clip: TimelineClip, overlapStartMs: number, overlapEndMs: number): TimelineTextWord[] {
  if (source.kind !== 'text' || !source.words) return [];
  return source.words.filter((word) => word.startMs < overlapEndMs - clip.startMs && word.endMs > overlapStartMs - clip.startMs).map((word) => ({ text: word.text, startMs: Math.max(0, word.startMs - (overlapStartMs - clip.startMs)), endMs: Math.max(0, word.endMs - (overlapStartMs - clip.startMs)) }));
}

/**
 * Compiles the persisted timeline into serializable Remotion props. Preview and render call this same pure function,
 * so a frame cannot be previewed from a different edit graph than the exported file.
 */
export function compileAetheraTimeline(rawDocument: TimelineDocument, rawWindow: AetheraCompositionWindow): AetheraTimelineCompositionProps {
  const document = timelineDocumentSchema.parse(rawDocument);
  const window = compositionWindowSchema.parse(rawWindow);
  const toMs = window.fromMs + window.durationMs;
  const layers: AetheraCompositionLayer[] = [];
  const captions = timelineCaptionCues(document);
  // A caption layer shows the run's cues that start inside its clip and window, on the layer's own clock.
  const cuesFor = (clip: TimelineClip, overlapStartMs: number, overlapEndMs: number) => captions
    .filter((cue) => cue.startMs >= clip.startMs && cue.startMs < clipEnd(clip) && cue.endMs > overlapStartMs && cue.startMs < overlapEndMs)
    .map((cue) => ({ startMs: cue.startMs - overlapStartMs, endMs: cue.endMs - overlapStartMs, lines: cue.lines }));
  document.tracks.forEach((track, trackIndex) => {
    if (track.hidden || track.muted) return;
    track.items.forEach((clip, itemIndex) => {
      if (!active(clip, window.fromMs, toMs)) return;
      const overlapStartMs = Math.max(window.fromMs, clip.startMs);
      const overlapEndMs = Math.min(toMs, clipEnd(clip));
      const durationInFrames = Math.max(1, frameAt(overlapEndMs - overlapStartMs, document.fps));
      layers.push({
        id: `${track.id}:${clip.id}:${window.fromMs}:${window.durationMs}`,
        clipId: clip.id, trackId: track.id, trackKind: track.kind, zIndex: trackIndex * 10 + itemIndex,
        startFrame: frameAt(overlapStartMs - window.fromMs, document.fps), durationInFrames, clipStartMs: overlapStartMs,
        sceneIds: clip.sceneIds, ...(clip.subjectId ? { subjectId: clip.subjectId } : {}), ...(clip.depiction ? { depiction: clip.depiction } : {}), source: sourceForWindow(clip.source, clip, overlapStartMs, overlapEndMs), transform: clip.transform,
        keyframes: clip.keyframes.map((keyframe) => ({ ...keyframe, atMs: clamp(keyframe.atMs - (overlapStartMs - clip.startMs), 0, overlapEndMs - overlapStartMs) })), effects: clip.effects,
        ...(clip.enter ? { enter: clip.enter } : {}), ...(clip.exit ? { exit: clip.exit } : {}), words: wordsFor(clip.source, clip, overlapStartMs, overlapEndMs),
        ...(track.kind === 'captions' ? { cues: cuesFor(clip, overlapStartMs, overlapEndMs) } : {}),
      });
    });
  });
  return aetheraTimelineCompositionPropsSchema.parse({ schemaVersion: 1, compositionId: 'aethera-timeline', timelineId: document.id, timelineVersion: document.version, timelineHash: timelineHash(document), window, format: document.format, background: { kind: 'gradient', from: '#0d3b3e', to: '#102126', angle: 135 }, layers });
}

/**
 * E3: the reading cues of the whole timeline on its clock, from the measured words of every visible caption clip, with
 * the line width of the format. The composition and the exported SRT both come from here.
 */
export function timelineCaptionCues(rawDocument: TimelineDocument): CaptionCue[] {
  const document = timelineDocumentSchema.parse(rawDocument);
  const scenes = document.tracks.filter((track) => track.kind === 'captions' && !track.hidden && !track.muted)
    .flatMap((track) => track.items)
    .flatMap((clip) => (clip.source.kind === 'text' && clip.source.words?.length ? [{ startMs: clip.startMs, words: clip.source.words.map((word) => ({ w: word.text, startMs: word.startMs, endMs: word.endMs })) }] : []))
    .sort((left, right) => left.startMs - right.startMs);
  return sceneCaptionCues(scenes, { maxLineChars: captionLineCharsFor(document.format) });
}

/** Splits at measured narration boundaries so an edit can invalidate only its own window. */
export function aetheraTimelineSegments(rawDocument: TimelineDocument): AetheraTimelineRenderSegment[] {
  const document = timelineDocumentSchema.parse(rawDocument);
  const narration = document.tracks.find((track) => track.kind === 'narration');
  const boundaries = [...new Set([0, document.durationMs, ...(narration?.items.flatMap((clip) => [clip.startMs, clip.startMs + clip.durationMs]) ?? [])])].sort((left, right) => left - right);
  return boundaries.slice(0, -1).flatMap((fromMs, index) => {
    const next = boundaries[index + 1];
    return next && next > fromMs ? [{ index, fromMs, durationMs: next - fromMs, key: aetheraTimelineSegmentKey(document, { fromMs, durationMs: next - fromMs }) }] : [];
  });
}

/**
 * Cache key for a render window: what that window draws (its compiled layers), never the whole timeline, so an edit in
 * one scene keeps every other window reusable. Proxy hashes count only for assets drawn in the window.
 */
/**
 * Version of how AetheraTimelineComposition draws frames. Bump it with any visual change to the composition (captions,
 * labels, panels…): cached segments rendered by an older composition are then rendered again instead of reused.
 * 2 = E3 review + Smart Director SD-1 (caption size, subject labels, panels with masks).
 * 3 = SD-2 (kinetic words, picture-in-picture inset, card placement and line reveals).
 * 4 = SD-2 review (the card box enters with its first line).
 * 5 = SD-2.1 (diagram: elements on their words, links that draw, over a darkened image).
 * 6 = SD-2.1 review (diagram labels at 4.2% of the height).
 * 7 = SD-2.4 + SD-3 (cinematic VFX layers, wipe transitions, match cut).
 */
export const AETHERA_COMPOSITION_VERSION = 7;

export type WipeDirection = 'left' | 'right' | 'up' | 'down';

/** Computes a CSS clip-path inset for a wipe exit transition (progress: 0 = fully visible, 1 = fully wiped out). */
export function wipeTransitionClipPath(direction: WipeDirection, progress: number): string {
  const pct = Math.max(0, Math.min(100, Math.round(progress * 1000) / 10));
  if (direction === 'left') return `inset(0 ${pct}% 0 0)`;
  if (direction === 'right') return `inset(0 0 0 ${pct}%)`;
  if (direction === 'up') return `inset(0 0 ${pct}% 0)`;
  return `inset(${pct}% 0 0 0)`;
}

export interface ExplainableShotCandidate {
  id: string;
  relevanceScore: number;
  edgeCalmness: number;
  durationMs: number;
  width: number;
  height: number;
  depiction: 'record' | 'illustrative' | 'reconstruction';
}

export interface ExplainableShotScore {
  candidateId: string;
  total: number;
  breakdown: {
    relevance: number;
    visualCalmness: number;
    durationFit: number;
    resolutionFit: number;
    depictionMatch: number;
  };
  reasons: string[];
}

/** SD-3 explainable shot scoring: returns transparent component weights and human-readable reasons. */
export function scoreShotExplainable(
  candidate: ExplainableShotCandidate,
  target: { neededDurationMs: number; preferredDepiction: 'record' | 'illustrative' | 'reconstruction'; hasOnScreenText?: boolean },
): ExplainableShotScore {
  const relevance = clamp(candidate.relevanceScore, 0, 1) * 40;
  const calmnessWeight = target.hasOnScreenText ? 25 : 15;
  const visualCalmness = clamp(candidate.edgeCalmness, 0, 1) * calmnessWeight;
  const durationRatio = Math.min(1, candidate.durationMs / Math.max(1, target.neededDurationMs));
  const durationFit = durationRatio * 20;
  const resolutionFit = candidate.width >= 1920 && candidate.height >= 1080 ? 10 : candidate.width >= 1280 ? 6 : 2;
  const depictionMatch = candidate.depiction === target.preferredDepiction ? (target.hasOnScreenText ? 5 : 15) : 0;
  const total = Math.round((relevance + visualCalmness + durationFit + resolutionFit + depictionMatch) * 10) / 10;

  const reasons: string[] = [
    `relevância semântica: ${relevance.toFixed(1)}/40`,
    `calma visual (safe zone): ${visualCalmness.toFixed(1)}/${calmnessWeight}`,
    `duração (${candidate.durationMs}ms / ${target.neededDurationMs}ms): ${durationFit.toFixed(1)}/20`,
    `resolução (${candidate.width}x${candidate.height}): ${resolutionFit}/10`,
  ];
  if (depictionMatch > 0) reasons.push(`aderência de representação (${candidate.depiction}): +${depictionMatch}`);

  return {
    candidateId: candidate.id,
    total,
    breakdown: { relevance, visualCalmness, durationFit, resolutionFit, depictionMatch },
    reasons,
  };
}

export function aetheraTimelineSegmentKey(rawDocument: TimelineDocument, rawWindow: AetheraCompositionWindow, proxyHashes: ReadonlyMap<string, string> = new Map()): string {
  const compiled = compileAetheraTimeline(rawDocument, { fromMs: rawWindow.fromMs, durationMs: rawWindow.durationMs });
  const drawn = { compositionId: compiled.compositionId, timelineId: compiled.timelineId, window: compiled.window, format: compiled.format, background: compiled.background, layers: compiled.layers };
  const assets = new Set(drawn.layers.flatMap((layer) => layer.source.kind === 'media' ? [layer.source.assetId] : []));
  // The composition's own version is part of the key: a change in how frames are drawn must not reuse old segments.
  const value = JSON.stringify({ keyVersion: 2, composition: AETHERA_COMPOSITION_VERSION, drawn, proxies: [...proxyHashes.entries()].filter(([assetId]) => assets.has(assetId)).sort(([left], [right]) => left.localeCompare(right)) });
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < value.length; index += 1) { const code = value.charCodeAt(index); first = Math.imul(first ^ code, 0x01000193) >>> 0; second = Math.imul(second ^ code ^ (index & 0xff), 0x811c9dc5) >>> 0; }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}
