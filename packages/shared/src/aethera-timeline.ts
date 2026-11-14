import { z } from 'zod';
import type { Storyboard, StoryboardScene } from './velix-storyboard.js';
import type { VideoFormat } from './velix-production.js';
import type { DirectorPlan } from './aethera-director.js';

export const timelineTrackKinds = ['video', 'graphics', 'text', 'captions', 'narration', 'music', 'sfx'] as const;
export type TimelineTrackKind = (typeof timelineTrackKinds)[number];

/** `panels` (Smart Director SD-1): multi-panel composition with masks and progressive reveal; props in aethera-smart-director. */
export const graphicComponentIds = ['title', 'card', 'stat', 'lower-third', 'bars', 'caption', 'panels', 'kinetic', 'diagram'] as const;
export const transitionIds = ['cut', 'fade', 'dissolve', 'match_cut', 'slide', 'wipe', 'wipe-left', 'wipe-right', 'wipe-up', 'wipe-down', 'zoom'] as const;
export const effectIds = ['zoom-emphasis', 'speed-ramp', 'blur', 'color', 'color_grading', 'glitch', 'particles', 'volumetric_light', 'optical_distortion'] as const;
export const keyframeProperties = ['scale', 'x', 'y', 'opacity', 'rotation', 'volume', 'blur'] as const;
export const easingIds = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'spring'] as const;
/** What the footage depicts. Marked by a person (AP-04); `illustrative` and `reconstruction` get an on-screen badge. */
export const clipDepictions = ['real_record', 'illustrative', 'reconstruction'] as const;
export type ClipDepiction = (typeof clipDepictions)[number];

const rectSchema = z.strictObject({ x: z.number(), y: z.number(), width: z.number().nonnegative(), height: z.number().nonnegative() });
const transformSchema = z.strictObject({ x: z.number(), y: z.number(), scale: z.number().positive(), rotation: z.number(), crop: rectSchema.optional(), fit: z.enum(['cover', 'contain']) });
const keyframeSchema = z.strictObject({ property: z.enum(keyframeProperties), atMs: z.number().int().nonnegative(), value: z.number(), easing: z.enum(easingIds) });
const clipIntentSchema = z.strictObject({ reason: z.string().min(1), directorRuleId: z.string().min(1).optional() });
const transitionSchema = z.strictObject({ id: z.enum(transitionIds), durationMs: z.number().int().nonnegative(), intent: clipIntentSchema.optional() });
const effectSchema = z.strictObject({ id: z.enum(effectIds), params: z.record(z.string(), z.unknown()).default({}), intent: clipIntentSchema.optional() });

export const mediaSourceSchema = z.strictObject({ kind: z.literal('media'), assetId: z.string().min(1), proxyPath: z.string().min(1).optional(), inMs: z.number().int().nonnegative(), outMs: z.number().int().positive(), speed: z.number().positive(), volume: z.number() });
export const graphicSourceSchema = z.strictObject({ kind: z.literal('graphic'), component: z.enum(graphicComponentIds), version: z.number().int().positive(), props: z.record(z.string(), z.unknown()).default({}) });
export const textWordSchema = z.strictObject({ text: z.string().min(1), startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative() });
export type TimelineTextWord = z.infer<typeof textWordSchema>;
export const textSourceSchema = z.strictObject({
  kind: z.literal('text'), text: z.string(), styleId: z.string().min(1), words: z.array(textWordSchema).max(4_000).optional(),
  /** E3: where a caption sits; `top` when the shot's analysis finds burned-in text at the bottom. Absent means bottom. */
  captionPlacement: z.enum(['bottom', 'top']).optional(),
});
export const audioSourceSchema = z.strictObject({ kind: z.literal('audio'), assetId: z.string().min(1).optional(), sfxId: z.string().min(1).optional(), narrationKey: z.string().min(1).optional(), musicTrackId: z.string().min(1).optional(), inMs: z.number().int().nonnegative(), outMs: z.number().int().positive(), gainDb: z.number() }).superRefine((source, context) => {
  if (!source.assetId && !source.sfxId && !source.narrationKey && !source.musicTrackId) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Uma fonte de áudio precisa de assetId, sfxId, narrationKey ou musicTrackId.' });
});
export const clipSourceSchema = z.discriminatedUnion('kind', [mediaSourceSchema, graphicSourceSchema, textSourceSchema, audioSourceSchema]);
export type ClipSource = z.infer<typeof clipSourceSchema>;

export const timelineClipSchema = z.strictObject({
  id: z.string().min(1), startMs: z.number().int().nonnegative(), durationMs: z.number().int().positive(), sceneIds: z.array(z.string().min(1)), subjectId: z.string().min(1).optional(), label: z.string(),
  source: clipSourceSchema, transform: transformSchema, keyframes: z.array(keyframeSchema), enter: transitionSchema.optional(), exit: transitionSchema.optional(), effects: z.array(effectSchema),
  locked: z.boolean().optional(), depiction: z.enum(clipDepictions).optional(),
  intent: z.strictObject({ reason: z.string().min(1), directorRuleId: z.string().min(1).optional() }).optional(), provenance: z.strictObject({ assetId: z.string().min(1), legalClearance: z.string(), usage: z.string() }).optional(),
  audio: z.strictObject({ gainDb: z.number(), duckDb: z.number().optional() }).optional(),
});
export type TimelineClip = z.infer<typeof timelineClipSchema>;

export const timelineTrackSchema = z.strictObject({ id: z.string().min(1), kind: z.enum(timelineTrackKinds), label: z.string(), locked: z.boolean(), muted: z.boolean(), hidden: z.boolean(), items: z.array(timelineClipSchema) });
type TimelineTrack = z.infer<typeof timelineTrackSchema>;
export type AetheraTimelineTrack = TimelineTrack;

export const timelineMarkerSchema = z.strictObject({ id: z.string().min(1), atMs: z.number().int().nonnegative(), kind: z.enum(['chapter', 'ranking_position', 'beat', 'review']), label: z.string(), ref: z.string().optional() });
export const audioMixSchema = z.strictObject({ targetLufs: z.number(), truePeakDb: z.number(), musicDuckDb: z.number(), duck: z.strictObject({ attackMs: z.number().int().nonnegative(), releaseMs: z.number().int().nonnegative() }), stems: z.strictObject({ narration: z.number(), music: z.number(), sfx: z.number() }) });

export const timelineDocumentSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().min(1), runId: z.string().min(1), version: z.number().int().positive(),
  basedOn: z.strictObject({ storyboardVersion: z.number().int().positive(), directorPlanVersion: z.number().int().positive(), presetId: z.string().min(1), presetVersion: z.number().int().positive() }),
  format: z.object({ id: z.string(), width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(), aspectRatio: z.string(), safeArea: z.strictObject({ top: z.number().nonnegative(), right: z.number().nonnegative(), bottom: z.number().nonnegative(), left: z.number().nonnegative() }) }),
  fps: z.number().positive(), durationMs: z.number().int().nonnegative(), tracks: z.array(timelineTrackSchema), markers: z.array(timelineMarkerSchema), audio: audioMixSchema,
});
export type TimelineDocument = z.infer<typeof timelineDocumentSchema>;

export const timelineSelectorSchema = z.strictObject({ chapter: z.number().int().positive().optional(), rankingPosition: z.number().int().positive().optional(), subjectId: z.string().min(1).optional(), timeRange: z.strictObject({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).optional(), clipIds: z.array(z.string().min(1)).min(1).optional(), selection: z.enum(['all']).optional() }).superRefine((selector, context) => {
  if (!Object.values(selector).some((value) => value !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom, message: 'O seletor precisa identificar ao menos um alvo.' });
});
export type TimelineSelector = z.infer<typeof timelineSelectorSchema>;

const timelineOpBase = { selector: timelineSelectorSchema } as const;
export const timelineOpSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('replaceSource'), ...timelineOpBase, source: clipSourceSchema }),
  z.strictObject({ op: z.literal('setRange'), ...timelineOpBase, startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }),
  z.strictObject({ op: z.literal('trim'), ...timelineOpBase, durationMs: z.number().int().positive() }),
  z.strictObject({ op: z.literal('move'), ...timelineOpBase, startMs: z.number().int().nonnegative() }),
  z.strictObject({ op: z.literal('delete'), ...timelineOpBase }),
  z.strictObject({ op: z.literal('insertGraphic'), trackId: z.string().min(1), atMs: z.number().int().nonnegative(), durationMs: z.number().int().positive(), component: z.enum(graphicComponentIds), version: z.number().int().positive(), props: z.record(z.string(), z.unknown()).default({}), sceneIds: z.array(z.string()).default([]), subjectId: z.string().optional() }),
  z.strictObject({ op: z.literal('insertAudio'), trackId: z.string().min(1), atMs: z.number().int().nonnegative(), durationMs: z.number().int().positive(), source: audioSourceSchema, label: z.string().min(1), sceneIds: z.array(z.string()).default([]) }),
  z.strictObject({ op: z.literal('setGain'), ...timelineOpBase, gainDb: z.number() }),
  z.strictObject({ op: z.literal('setCamera'), ...timelineOpBase, camera: z.enum(['static', 'push-in', 'pan']) }),
  z.strictObject({ op: z.literal('setTransition'), ...timelineOpBase, transition: z.enum(transitionIds), durationMs: z.number().int().nonnegative() }),
  z.strictObject({ op: z.literal('setText'), ...timelineOpBase, text: z.string() }),
  z.strictObject({ op: z.literal('setClipLock'), ...timelineOpBase, locked: z.boolean() }),
  z.strictObject({ op: z.literal('setDepiction'), ...timelineOpBase, depiction: z.enum(clipDepictions) }),
]);
export type TimelineOp = z.infer<typeof timelineOpSchema>;

export const timelineChangeSchema = z.strictObject({ fromVersion: z.number().int().positive(), toVersion: z.number().int().positive(), author: z.enum(['user', 'agent', 'review', 'assembler']), command: z.string().optional(), ops: z.array(timelineOpSchema), affectedClipIds: z.array(z.string()), summary: z.string() });
export type TimelineChange = z.infer<typeof timelineChangeSchema>;

export const aetheraTimelineVersionSchema = z.strictObject({ id: z.string().uuid(), runId: z.string().uuid(), version: z.number().int().positive(), document: timelineDocumentSchema, hash: z.string().min(1), source: z.enum(['assembled', 'edit', 'review', 'restore']), author: z.enum(['user', 'agent', 'review', 'assembler']), change: timelineChangeSchema.nullable(), createdAt: z.string().datetime() });
export type AetheraTimelineVersion = z.infer<typeof aetheraTimelineVersionSchema>;

const labels: Record<TimelineTrackKind, string> = { video: 'Vídeo', graphics: 'Gráficos', text: 'Texto', captions: 'Legendas', narration: 'Narração', music: 'Música', sfx: 'Efeitos' };
const graphicFor = (scene: StoryboardScene): (typeof graphicComponentIds)[number] => scene.visual.type === 'fallback' && scene.visual.kind === 'chart' ? 'bars' : scene.visual.type === 'fallback' && scene.visual.kind === 'document' ? 'card' : scene.visual.type === 'fallback' && scene.visual.kind === 'animation' ? 'title' : 'title';
const baseTransform = (): TimelineClip['transform'] => ({ x: 0, y: 0, scale: 1, rotation: 0, fit: 'cover' });
const cameraKeyframes = (scene: StoryboardScene, camera = scene.camera): TimelineClip['keyframes'] => {
  const durationMs = scene.endMs - scene.startMs;
  if (camera === 'push-in') return [{ property: 'scale', atMs: 0, value: 1, easing: 'ease-out' }, { property: 'scale', atMs: durationMs, value: 1.08, easing: 'ease-in-out' }];
  if (camera === 'pan') return [{ property: 'x', atMs: 0, value: -3, easing: 'ease-out' }, { property: 'x', atMs: durationMs, value: 3, easing: 'ease-in-out' }];
  return [];
};
const baseClip = (scene: StoryboardScene, id: string, source: ClipSource, direction?: DirectorPlan['sceneDirections'][number]): TimelineClip => {
  const intent = direction?.intent ?? { reason: scene.visualObjective };
  const camera = direction?.shotPlan.includes('push-in') ? 'push-in' : direction?.shotPlan.includes('pan') ? 'pan' : scene.camera;
  const transition = direction?.transitionOut ?? scene.transition;
  const effects: TimelineClip['effects'] = direction?.shotPlan.includes('push-in') ? [{ id: 'zoom-emphasis', params: { maxZoom: 1.08 }, intent }] : [];
  return { id, startMs: scene.startMs, durationMs: scene.endMs - scene.startMs, sceneIds: [scene.id], ...(scene.subjectId ? { subjectId: scene.subjectId } : {}), label: scene.narration.slice(0, 80), source, transform: baseTransform(), keyframes: cameraKeyframes(scene, camera), effects, locked: scene.locked, ...(transition !== 'cut' ? { exit: { id: transition, durationMs: 250, intent } } : {}), intent };
};

const BACKDROP_REASON = 'D-AP-17: texto sobre imagens do mesmo assunto, escurecidas e desfocadas, em vez de fundo chapado.';
const GENERAL_BACKDROP_REASON = 'D-AP-17: cena sem assunto próprio (abertura, transição, encerramento) sobre imagens do tema do vídeo, escurecidas e desfocadas.';

/**
 * Footage behind a scene that has no media of its own: the nearest matched cut of the same subject — or, for a scene
 * without a subject (opening, transition, closing), of any subject of the video — slowed down to at most half speed
 * when needed, blurred and darkened. A scene about one subject never borrows another subject's footage, and without a
 * long enough cut nothing is invented.
 */
function sameSubjectBackdrop(scene: StoryboardScene, scenes: readonly StoryboardScene[]): TimelineClip | null {
  const durationMs = scene.endMs - scene.startMs;
  const donor = scenes
    .filter((candidate) => candidate.id !== scene.id && (scene.subjectId ? candidate.subjectId === scene.subjectId : true) && candidate.visual.type === 'asset' && candidate.visual.kind === 'video' && candidate.visual.match)
    .sort((left, right) => Math.abs(left.startMs - scene.startMs) - Math.abs(right.startMs - scene.startMs) || left.id.localeCompare(right.id))[0];
  if (!donor || donor.visual.type !== 'asset' || !donor.visual.match) return null;
  const { sourceStartMs, sourceEndMs } = donor.visual.match;
  const rangeMs = sourceEndMs - sourceStartMs;
  if (rangeMs * 2 < durationMs) return null;
  const speed = Math.min(1, rangeMs / durationMs);
  const intent = { reason: scene.subjectId ? BACKDROP_REASON : GENERAL_BACKDROP_REASON };
  return {
    id: `video:backdrop:${scene.id}`, startMs: scene.startMs, durationMs, sceneIds: [scene.id], ...(scene.subjectId ? { subjectId: scene.subjectId } : {}), label: `Fundo: ${donor.visual.title}`.slice(0, 80),
    source: { kind: 'media', assetId: donor.visual.referenceId, inMs: sourceStartMs, outMs: sourceStartMs + Math.round(durationMs * speed), speed, volume: 0 },
    transform: baseTransform(), keyframes: [], effects: [{ id: 'blur', params: { radius: 18 }, intent }, { id: 'color', params: { brightness: 0.45, saturation: 0.8 }, intent }], locked: scene.locked, intent,
  };
}

/** Scenes shown only as graphics/text although usable footage exists: same subject, or any footage for a scene without subject (D-AP-17). */
export function avoidableFlatBackgroundSceneIds(document: TimelineDocument): string[] {
  const clips = allClips(document);
  const covered = new Set(clips.filter(({ track }) => track.kind === 'video').flatMap(({ clip }) => clip.sceneIds));
  const subjectsWithFootage = new Set(clips.filter(({ track, clip }) => track.kind === 'video' && clip.source.kind === 'media' && clip.subjectId).map(({ clip }) => clip.subjectId));
  const anyFootage = clips.some(({ track, clip }) => track.kind === 'video' && clip.source.kind === 'media');
  const flat = clips.filter(({ track, clip }) => (track.kind === 'graphics' || track.kind === 'text') && (clip.subjectId ? subjectsWithFootage.has(clip.subjectId) : anyFootage)).flatMap(({ clip }) => clip.sceneIds).filter((sceneId) => !covered.has(sceneId));
  return [...new Set(flat)].sort();
}

export function assembleTimeline(input: { runId: string; storyboard: Storyboard; format: VideoFormat; timelineId?: string; version?: number; presetId?: string; presetVersion?: number; directorPlanVersion?: number; directorPlan?: DirectorPlan }): TimelineDocument {
  const version = input.version ?? 1;
  const tracks = new Map<TimelineTrackKind, TimelineTrack>(timelineTrackKinds.map((kind) => [kind, { id: kind, kind, label: labels[kind], locked: false, muted: false, hidden: false, items: [] }]));
  const markers = new Map<string, z.infer<typeof timelineMarkerSchema>>();
  for (const scene of input.storyboard.scenes) {
    const direction = input.directorPlan?.sceneDirections.find((candidate) => candidate.sceneId === scene.id);
    const durationMs = scene.endMs - scene.startMs;
    const sceneTrack = scene.visual.type === 'asset' ? (scene.visual.kind === 'image' ? 'graphics' : 'video') : scene.visual.type === 'fallback' ? 'graphics' : null;
    if (sceneTrack) {
      const source: ClipSource = scene.visual.type === 'asset' && scene.visual.kind === 'video'
        ? { kind: 'media', assetId: scene.visual.referenceId, inMs: scene.visual.match?.sourceStartMs ?? 0, outMs: scene.visual.match?.sourceEndMs ?? durationMs, speed: 1, volume: 0 }
        : { kind: 'graphic', component: scene.visual.type === 'fallback' ? graphicFor(scene) : 'title', version: 1, props: { sceneId: scene.id, ...(scene.visual.type === 'asset' ? { title: scene.visual.title } : {}) } };
      // A fallback's `reason` explains the editing decision to a person; it is never drawn on screen.
      tracks.get(sceneTrack)?.items.push(baseClip(scene, `${sceneTrack}:${scene.id}`, source, direction));
    }
    const backdrop = sceneTrack === 'graphics' && scene.visual.type === 'fallback' ? sameSubjectBackdrop(scene, input.storyboard.scenes) : null;
    if (backdrop) tracks.get('video')?.items.push(backdrop);
    if (scene.onScreenText.trim()) tracks.get('text')?.items.push(baseClip(scene, `text:${scene.id}`, { kind: 'text', text: scene.onScreenText.trim(), styleId: 'aethera-default' }, direction));
    if (scene.audio) tracks.get('narration')?.items.push(baseClip(scene, `narration:${scene.id}`, { kind: 'audio', narrationKey: scene.audio.key, inMs: 0, outMs: scene.audio.durationMs, gainDb: 0 }, direction));
    tracks.get('captions')?.items.push(baseClip(scene, `captions:${scene.id}`, { kind: 'text', text: scene.narration, styleId: 'aethera-caption', ...(scene.audio?.words ? { words: scene.audio.words.map((word) => ({ text: word.w, startMs: word.startMs, endMs: word.endMs })) } : {}) }, direction));
    if (scene.chapter !== null) markers.set(`chapter:${scene.chapter}`, { id: `chapter:${scene.chapter}`, atMs: scene.startMs, kind: 'chapter', label: `Capítulo ${scene.chapter}`, ref: scene.id });
  }
  const document = { schemaVersion: 1 as const, id: input.timelineId ?? `timeline:${input.runId}`, runId: input.runId, version, basedOn: { storyboardVersion: 1, directorPlanVersion: input.directorPlanVersion ?? 1, presetId: input.directorPlan?.presetId ?? input.presetId ?? 'top-10-dynamic', presetVersion: input.directorPlan?.presetVersion ?? input.presetVersion ?? 1 }, format: input.format, fps: input.format.fps, durationMs: input.storyboard.scenes.at(-1)?.endMs ?? 0, tracks: timelineTrackKinds.map((kind) => tracks.get(kind) as TimelineTrack), markers: [...markers.values()], audio: { targetLufs: -14, truePeakDb: -1, musicDuckDb: -12, duck: { attackMs: 80, releaseMs: 250 }, stems: { narration: 0, music: -12, sfx: 0 } } };
  return timelineDocumentSchema.parse(document);
}

export function timelineHash(document: TimelineDocument): string {
  const value = JSON.stringify(timelineDocumentSchema.parse(document));
  let first = 0x811c9dc5;
  let second = 0x01000193;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    first = Math.imul(first ^ code, 0x01000193) >>> 0;
    second = Math.imul(second ^ code ^ (index & 0xff), 0x811c9dc5) >>> 0;
  }
  return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

function allClips(document: TimelineDocument): Array<{ track: TimelineTrack; clip: TimelineClip }> {
  return document.tracks.flatMap((track) => track.items.map((clip) => ({ track, clip })));
}

function resolveClipIds(document: TimelineDocument, selector: TimelineSelector): string[] {
  const clips = allClips(document);
  if (selector.clipIds) return clips.filter(({ clip }) => selector.clipIds?.includes(clip.id)).map(({ clip }) => clip.id);
  if (selector.subjectId) return clips.filter(({ clip }) => clip.subjectId === selector.subjectId).map(({ clip }) => clip.id);
  const range = selector.timeRange;
  if (range) return clips.filter(({ clip }) => clip.startMs < range.endMs && clip.startMs + clip.durationMs > range.startMs).map(({ clip }) => clip.id);
  if (selector.selection === 'all') return clips.map(({ clip }) => clip.id);
  throw new Error('ambiguous: o seletor não resolve clipes nesta versão da timeline.');
}

export function applyTimelineOps(document: TimelineDocument, rawOps: readonly TimelineOp[], meta: { author: TimelineChange['author']; command?: string }): { document: TimelineDocument; change: TimelineChange } {
  const next = timelineDocumentSchema.parse(document);
  const ops = rawOps.map((op) => timelineOpSchema.parse(op));
  const affected = new Set<string>();
  for (const op of ops) {
    if (op.op === 'insertGraphic') {
      const track = next.tracks.find((candidate) => candidate.id === op.trackId && candidate.kind === 'graphics');
      if (!track) throw new Error('not_found: faixa gráfica não encontrada.');
      const id = `graphics:inserted:${op.atMs}:${track.items.length}`;
      track.items.push({ id, startMs: op.atMs, durationMs: op.durationMs, sceneIds: op.sceneIds, ...(op.subjectId ? { subjectId: op.subjectId } : {}), label: op.component, source: { kind: 'graphic', component: op.component, version: op.version, props: op.props }, transform: baseTransform(), keyframes: [], effects: [], intent: { reason: 'Inserção solicitada pela edição.' } });
      affected.add(id);
      continue;
    }
    if (op.op === 'insertAudio') {
      const track = next.tracks.find((candidate) => candidate.id === op.trackId && ['music', 'sfx', 'narration'].includes(candidate.kind));
      if (!track) throw new Error('not_found: faixa de áudio não encontrada.');
      const id = `${track.kind}:inserted:${op.atMs}:${track.items.length}`;
      track.items.push({ id, startMs: op.atMs, durationMs: op.durationMs, sceneIds: op.sceneIds, label: op.label, source: op.source, transform: baseTransform(), keyframes: [], effects: [], intent: { reason: 'Inserção de áudio solicitada pela produção.' } });
      affected.add(id);
      continue;
    }
    const ids = resolveClipIds(next, op.selector);
    if (!ids.length) throw new Error('not_found: nenhum clipe corresponde ao seletor.');
    for (const track of next.tracks) for (const clip of track.items) if (ids.includes(clip.id)) {
      if (op.op === 'setGain' && clip.source.kind !== 'audio' && !clip.audio) continue;
      affected.add(clip.id);
      if (op.op === 'replaceSource') clip.source = op.source;
      else if (op.op === 'setRange') { clip.startMs = op.startMs; clip.durationMs = op.endMs - op.startMs; }
      else if (op.op === 'trim') clip.durationMs = op.durationMs;
      else if (op.op === 'move') clip.startMs = op.startMs;
      else if (op.op === 'setGain') clip.audio = { ...(clip.audio ?? { gainDb: 0 }), gainDb: op.gainDb };
      else if (op.op === 'setCamera') clip.keyframes = op.camera === 'push-in'
        ? [{ property: 'scale', atMs: 0, value: 1, easing: 'ease-out' }, { property: 'scale', atMs: clip.durationMs, value: 1.08, easing: 'ease-in-out' }]
        : op.camera === 'pan'
          ? [{ property: 'x', atMs: 0, value: -3, easing: 'ease-out' }, { property: 'x', atMs: clip.durationMs, value: 3, easing: 'ease-in-out' }]
          : [];
      else if (op.op === 'setTransition') clip.exit = op.transition === 'cut' ? undefined : { id: op.transition, durationMs: op.durationMs };
      else if (op.op === 'setText' && clip.source.kind === 'text') clip.source = { ...clip.source, text: op.text };
      else if (op.op === 'setClipLock') clip.locked = op.locked;
      else if (op.op === 'setDepiction') clip.depiction = op.depiction;
      else if (op.op === 'delete') track.items = track.items.filter((candidate) => candidate.id !== clip.id);
    }
  }
  const updated = timelineDocumentSchema.parse({ ...next, version: document.version + 1, durationMs: Math.max(0, ...next.tracks.flatMap((track) => track.items.map((clip) => clip.startMs + clip.durationMs))) });
  const change = timelineChangeSchema.parse({ fromVersion: document.version, toVersion: updated.version, author: meta.author, ...(meta.command ? { command: meta.command } : {}), ops, affectedClipIds: [...affected], summary: `${affected.size} clipe(s) alterado(s).` });
  return { document: updated, change };
}
