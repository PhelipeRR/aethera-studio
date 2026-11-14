import { z } from 'zod';
import { MOTION_LIMITS, type MotionProject, type MotionSceneV2 } from './motion.js';
import { qualityDirectorChecks, type QualityDirectorSignals } from './aethera-quality.js';
import type { ProductionQualityCheck, VideoFormat } from './velix-production.js';
import type { RightsStatus, Storyboard, StoryboardScene } from './velix-storyboard.js';
import { renderUseAllows, type RenderMode, type RenderUseBasis } from './aethera-render-use.js';
import type { MediaProvenance } from './aethera-studio.js';
import type { TimedPhrase } from './velix-sync.js';
/**
 * Composition of a production for one format: the measured storyboard becomes render segments for the existing engine
 * (Remotion for typography, document, chart and animation scenes; FFmpeg for authorized local media), captions from the
 * timed phrases, and the technical/editorial checks that decide whether the MP4 can be exported.
 */

export const MOTION_SEGMENT_MAX_SCENES = 30;
/** Half the engine's frame limit per project, so a long production renders as several shorter Remotion jobs. */
export const MOTION_SEGMENT_MAX_FRAMES = Math.floor(MOTION_LIMITS.maxDurationFrames / 2);
const MOTION_SCENE_MAX_FRAMES = 1_800;

export interface LocalMedia {
  referenceId: string; relativePath: string; kind: 'video' | 'image'; rightsStatus: RightsStatus;
  /** AP-02: basis of use of acquired media (§14.3). Absent for legacy media, which keeps the rights-only rule. */
  basis?: RenderUseBasis;
}

/** The cut of a source a scene shows (AP-02); absent means "from the start", the legacy behaviour. */
export interface SourceRange { startMs: number; endMs: number }

export interface MotionBackgroundCandidate { referenceId: string; media: LocalMedia; source?: SourceRange; basis?: RenderUseBasis }
export interface MotionBackgroundUse { referenceId: string; assetRef: string; source?: SourceRange; basis?: RenderUseBasis }

export type RenderSegment =
  | { index: number; kind: 'motion'; sceneIds: string[]; startFrame: number; frames: number; project: MotionProject; backgrounds?: MotionBackgroundUse[] }
  | { index: number; kind: 'asset'; sceneIds: [string]; startFrame: number; frames: number; media: LocalMedia; source?: SourceRange; basis?: RenderUseBasis };

export interface CompositionIssue { sceneId: string | null; code: 'not_measured' | 'missing_media_file' | 'unauthorized_media' | 'scene_too_long' | 'no_visual'; message: string }

const clip = (value: string, max: number) => (value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`);
const firstSentence = (text: string) => text.split(/(?<=[.!?…])\s/u)[0] ?? text;

/** One storyboard scene as a Remotion scene of the allow-listed kinds; text is data, never markup. */
export function motionSceneFor(scene: StoryboardScene, frames: number, index: number, background?: MotionBackgroundUse): MotionSceneV2 {
  const base = { id: clip(`cena-${index + 1}`, 60), durationInFrames: frames, transition: scene.transition === 'cut' ? 'cut' as const : 'fade' as const };
  const backdrop = background ? { background: { kind: 'image' as const, assetRef: background.assetRef, dim: 0.58 } } : {};
  const kind = scene.visual.type === 'fallback' ? scene.visual.kind : 'typography';
  const headline = clip(scene.onScreenText.trim() || firstSentence(scene.narration), 120);
  if (kind === 'document' || kind === 'chart' || scene.sceneType === 'quote') return { ...base, ...backdrop, kind: 'card', heading: clip(scene.onScreenText.trim() || scene.visualObjective.replace(/^Mostrar:\s*/u, '') || 'Em destaque', 100), body: clip(scene.narration, 400) };
  if (kind === 'animation') return { ...base, ...backdrop, kind: 'title', text: headline, subtitle: clip(scene.visualObjective.replace(/^Mostrar:\s*/u, ''), 200) || undefined } as MotionSceneV2;
  return { ...base, ...backdrop, kind: 'title', text: headline };
}

/**
 * Frame boundaries from the measured milliseconds, rounded once per boundary (not per scene), so the video never drifts
 * from the narration however long it is.
 */
export function frameBounds(scenes: readonly Pick<StoryboardScene, 'startMs' | 'endMs'>[], fps: number): Array<{ start: number; frames: number }> {
  const edges = [...scenes.map((scene) => Math.round((scene.startMs * fps) / 1_000)), Math.round(((scenes.at(-1)?.endMs ?? 0) * fps) / 1_000)];
  return scenes.map((_scene, index) => ({ start: edges[index] ?? 0, frames: Math.max(1, (edges[index + 1] ?? 0) - (edges[index] ?? 0)) }));
}

/** The render plan, or the issues that make rendering impossible (the rest is left to quality control). */
/** Channel identity applied to the generated scenes: accent and background, both #rrggbb. */
export interface CompositionStyle { accent: string; background: string }
const HEX = /^#[0-9a-f]{6}$/iu;

/** Whether this media may enter a render of this mode: legacy media needs verified rights; acquired media its basis. */
export function mediaRenderable(media: LocalMedia, mode: RenderMode): boolean {
  return media.basis ? renderUseAllows(media.basis, mode) : media.rightsStatus === 'verified_allowed';
}

const sourceRangeFor = (scene: StoryboardScene, media: LocalMedia): SourceRange | undefined => {
  const match = scene.visual.type === 'asset' ? scene.visual.match : undefined;
  return media.kind === 'video' && match ? { startMs: match.sourceStartMs, endMs: match.sourceEndMs } : undefined;
};

/** Selects a frame source only from assets already used by the approved storyboard. */
export function selectMotionBackgroundCandidates(storyboard: Storyboard, media: ReadonlyMap<string, LocalMedia>, mode: RenderMode): ReadonlyMap<string, MotionBackgroundCandidate> {
  const used = storyboard.scenes.flatMap((scene, index) => {
    if (scene.visual.type !== 'asset') return [];
    const local = media.get(scene.visual.referenceId);
    if (!local || !mediaRenderable(local, mode)) return [];
    const source = sourceRangeFor(scene, local);
    const candidate: MotionBackgroundCandidate = {
      referenceId: local.referenceId,
      media: local,
      ...(source ? { source } : {}),
      ...(local.basis ? { basis: local.basis } : {}),
    };
    return [{ scene, index, candidate }];
  });
  return new Map(storyboard.scenes.flatMap((scene, index) => {
    if (scene.visual.type !== 'fallback' || !used.length) return [];
    const ordered = used.slice().sort((left, right) => {
      const leftSubject = left.scene.subjectId && left.scene.subjectId === scene.subjectId ? 0 : 1;
      const rightSubject = right.scene.subjectId && right.scene.subjectId === scene.subjectId ? 0 : 1;
      return leftSubject - rightSubject || Math.abs(left.index - index) - Math.abs(right.index - index) || left.candidate.referenceId.localeCompare(right.candidate.referenceId);
    });
    const best = ordered[0]?.candidate;
    return best ? [[scene.id, best] as const] : [];
  }));
}

export function compositionPlan(storyboard: Storyboard, format: VideoFormat, media: ReadonlyMap<string, LocalMedia>, style?: CompositionStyle | null, options: { mode?: RenderMode; motionBackgrounds?: ReadonlyMap<string, MotionBackgroundUse> } = {}): { segments: RenderSegment[]; issues: CompositionIssue[] } {
  const mode = options.mode ?? 'final';
  const issues: CompositionIssue[] = [];
  if (storyboard.timing !== 'measured') issues.push({ sceneId: null, code: 'not_measured', message: 'Sincronize o storyboard com a narração antes de renderizar: os tempos ainda são estimados.' });
  const fps = Math.max(10, Math.min(60, Math.round(format.fps)));
  const bounds = frameBounds(storyboard.scenes, fps);
  const segments: RenderSegment[] = [];
  let pending: Array<{ scene: StoryboardScene; index: number }> = [];
  const flush = () => {
    if (!pending.length) return;
    const first = bounds[pending[0]?.index ?? 0];
    const scenes = pending.map(({ scene, index }) => motionSceneFor(scene, bounds[index]?.frames ?? 1, index, options.motionBackgrounds?.get(scene.id)));
    const backgrounds = pending.flatMap(({ scene }) => { const background = options.motionBackgrounds?.get(scene.id); return background ? [background] : []; });
    const fallbackBackground = style && HEX.test(style.background) && style.background.toLowerCase() !== '#000000' ? style.background : '#183b42';
    const project: MotionProject = { schemaVersion: 2, templateId: 'velix-base', templateVersion: 1, width: format.width, height: format.height, fps, scenes, captions: [], style: { background: { kind: 'gradient', from: fallbackBackground, to: '#102126', angle: 135 }, font: 'inter', accent: style && HEX.test(style.accent) ? style.accent : '#ff6a00', preset: 'base' }, narration: null, licenses: [] };
    segments.push({ index: segments.length, kind: 'motion', sceneIds: pending.map(({ scene }) => scene.id), startFrame: first?.start ?? 0, frames: scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0), project, ...(backgrounds.length ? { backgrounds } : {}) });
    pending = [];
  };
  storyboard.scenes.forEach((scene, index) => {
    const frames = bounds[index]?.frames ?? 1;
    if (scene.visual.type === 'none') issues.push({ sceneId: scene.id, code: 'no_visual', message: `Cena ${index + 1} sem mídia nem fallback.` });
    if (scene.visual.type === 'asset') {
      const local = media.get(scene.visual.referenceId);
      if (!local) { issues.push({ sceneId: scene.id, code: 'missing_media_file', message: `Cena ${index + 1}: a mídia "${scene.visual.title}" está autorizada, mas não há arquivo local no projeto; importe o arquivo ou use um fallback.` }); return; }
      if (!mediaRenderable(local, mode)) {
        const why = local.basis === 'preview_only' ? 'a fonte ainda está em revisão e só entra na prévia' : local.basis ? 'a mídia não tem base de uso permitida (licença ou uso editorial autorizado)' : 'a mídia não tem direitos verificados vigentes';
        issues.push({ sceneId: scene.id, code: 'unauthorized_media', message: `Cena ${index + 1}: ${why}.` });
        return;
      }
      flush();
      const match = scene.visual.match;
      segments.push({ index: segments.length, kind: 'asset', sceneIds: [scene.id], startFrame: bounds[index]?.start ?? 0, frames, media: local, ...(match && local.kind === 'video' ? { source: { startMs: match.sourceStartMs, endMs: match.sourceEndMs } } : {}), ...(local.basis ? { basis: local.basis } : {}) });
      return;
    }
    if (frames > MOTION_SCENE_MAX_FRAMES) issues.push({ sceneId: scene.id, code: 'scene_too_long', message: `Cena ${index + 1} passa de ${MOTION_SCENE_MAX_FRAMES / fps} s; divida a cena.` });
    const pendingFrames = pending.reduce((sum, item) => sum + (bounds[item.index]?.frames ?? 0), 0);
    if (pending.length >= MOTION_SEGMENT_MAX_SCENES || pendingFrames + frames > MOTION_SEGMENT_MAX_FRAMES) flush();
    pending.push({ scene, index });
  });
  flush();
  return { segments, issues };
}

/** Stable key of a segment's content and format: an unchanged segment is not rendered again. */
export function segmentKey(segment: RenderSegment, format: VideoFormat): string {
  const value = JSON.stringify({ format: [format.width, format.height, format.fps], kind: segment.kind, frames: segment.frames, ...(segment.kind === 'motion' ? { project: segment.project, backgrounds: segment.backgrounds?.map((background) => ({ referenceId: background.referenceId, source: background.source, basis: background.basis })) } : { media: segment.media.relativePath, ...(segment.source ? { source: [segment.source.startMs, segment.source.endMs] } : {}) }) });
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let index = 0; index < value.length; index++) { const code = value.charCodeAt(index); a = Math.imul(a ^ code, 0x01000193) >>> 0; b = Math.imul(b ^ code ^ (index & 0xff), 0x811c9dc5) >>> 0; }
  return `${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

const srtTime = (ms: number) => { const value = Math.max(0, Math.round(ms)); const h = Math.floor(value / 3_600_000); const m = Math.floor((value % 3_600_000) / 60_000); const s = Math.floor((value % 60_000) / 1_000); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(value % 1_000).padStart(3, '0')}`; };

/** Wraps a caption in up to two lines; longer phrases become several cues sharing the phrase's time. */
export function captionLines(text: string, maxChars: number): string[][] {
  const words = text.split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const word of words) { if (line && `${line} ${word}`.length > maxChars) { lines.push(line); line = word; } else line = line ? `${line} ${word}` : word; }
  if (line) lines.push(line);
  const cues: string[][] = [];
  for (let index = 0; index < lines.length; index += 2) cues.push(lines.slice(index, index + 2));
  return cues;
}

/** Characters per caption line that keep the text inside the safe area at the caption size used. */
/** Legacy FFmpeg-burned captions (3.5% of the height); the Aethera timeline uses `captionLineCharsFor`. */
export const captionLineChars = (format: VideoFormat) => Math.max(18, Math.min(42, Math.floor((format.width - format.safeArea.left - format.safeArea.right) / (format.height * 0.035 * 0.55))));

/** SubRip captions from the measured phrases; phrases without a measured time are left out and counted. */
export function subtitlesSrt(phrases: readonly TimedPhrase[], format: VideoFormat): { srt: string; cues: number; skipped: number } {
  const blocks: string[] = [];
  let skipped = 0;
  for (const phrase of phrases) {
    if (phrase.startMs === null || phrase.endMs === null || phrase.endMs <= phrase.startMs) { skipped += 1; continue; }
    const cues = captionLines(phrase.text, captionLineChars(format));
    const span = (phrase.endMs - phrase.startMs) / Math.max(1, cues.length);
    cues.forEach((cue, index) => { const start = phrase.startMs ?? 0; blocks.push(`${blocks.length + 1}\n${srtTime(start + span * index)} --> ${srtTime(start + span * (index + 1))}\n${cue.join('\n')}\n`); });
  }
  return { srt: blocks.join('\n'), cues: blocks.length, skipped };
}

/** FFmpeg `force_style` that puts captions above the bottom safe area at a size relative to the frame. */
export const captionStyle = (format: VideoFormat) => `Fontname=Arial,Fontsize=${Math.round(format.height * 0.035 * (288 / format.height))},PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=0,Alignment=2,MarginV=${Math.round(format.safeArea.bottom * (288 / format.height)) + 8}`;

export interface VideoProbe { width: number; height: number; fps: number; durationMs: number; hasVideo: boolean; hasAudio: boolean; videoCodec: string | null; audioCodec: string | null }

export interface QualityInput {
  format: VideoFormat;
  probe: VideoProbe | null;
  narrationDurationMs: number;
  storyboardIssues: ReadonlyArray<{ code: string; message: string }>;
  unsupportedFacts: number;
  scenes: readonly Pick<StoryboardScene, 'id' | 'narration' | 'visual'>[];
  rights: ReadonlyMap<string, RightsStatus>;
  captions: { cues: number; skipped: number; burned: boolean };
  silences: ReadonlyArray<{ startMs: number; durationMs: number }> | null;
  budget: { limitUsd: number; consumedUsd: number };
  qualityDirector?: QualityDirectorSignals;
  /** AP-02: basis of use of acquired media by reference id; references not listed keep the rights-only rule. */
  useBasis?: ReadonlyMap<string, MediaUse>;
}

export interface MediaUse { basis: RenderUseBasis; legalClearance: MediaProvenance['legalClearance'] | null; publisher: string; url: string }

const RATIO_TOLERANCE = 0.01;
const DURATION_TOLERANCE_MS = 250;
export const MAX_SILENCE_MS = 3_000;

/** The minimum quality control of the plan; blocking checks decide whether the MP4 is exportable. */
export function qualityChecks(input: QualityInput): ProductionQualityCheck[] {
  const { probe, format } = input;
  const checks: ProductionQualityCheck[] = [];
  const add = (id: string, label: string, severity: ProductionQualityCheck['severity'], passed: boolean, evidence: string) => checks.push({ id, label, severity, passed, evidence });
  add('file', 'Arquivo MP4 legível com vídeo', 'blocking', !!probe?.hasVideo, probe ? `${probe.videoCodec ?? 'sem codec'} · ${(probe.durationMs / 1_000).toFixed(2)} s` : 'O FFprobe não conseguiu ler o arquivo.');
  if (probe) {
    add('resolution', 'Resolução do formato', 'blocking', probe.width === format.width && probe.height === format.height, `${probe.width}x${probe.height} para ${format.width}x${format.height}.`);
    add('aspect', 'Proporção do formato', 'blocking', Math.abs(probe.width / probe.height - format.width / format.height) <= RATIO_TOLERANCE, `${(probe.width / probe.height).toFixed(3)} para ${format.aspectRatio}.`);
    add('fps', 'Quadros por segundo', 'blocking', Math.abs(probe.fps - format.fps) < 0.5, `${probe.fps.toFixed(2)} fps para ${format.fps}.`);
    add('audio', 'Faixa de áudio presente', 'blocking', probe.hasAudio, probe.audioCodec ?? 'sem áudio');
    add('duration', 'Duração igual à narração medida', 'blocking', Math.abs(probe.durationMs - input.narrationDurationMs) <= DURATION_TOLERANCE_MS, `${(probe.durationMs / 1_000).toFixed(2)} s para ${(input.narrationDurationMs / 1_000).toFixed(2)} s.`);
  }
  const longSilences = input.silences?.filter((item) => item.durationMs >= MAX_SILENCE_MS) ?? [];
  add('silence', 'Sem silêncio longo no áudio', 'warning', input.silences !== null && longSilences.length === 0, input.silences === null ? 'Detecção de silêncio indisponível neste FFmpeg.' : `${longSilences.length} trecho(s) de silêncio de ${MAX_SILENCE_MS / 1_000} s ou mais.`);
  add('captions', 'Legendas sincronizadas', 'blocking', input.captions.cues > 0 && input.captions.skipped === 0, `${input.captions.cues} legenda(s)${input.captions.skipped ? `, ${input.captions.skipped} frase(s) sem tempo medido` : ''}.`);
  add('captions-burned', 'Legendas gravadas no vídeo', 'warning', input.captions.burned, input.captions.burned ? 'Gravadas dentro da área segura.' : 'Este FFmpeg não grava legendas; elas saem como arquivo SRT ao lado do vídeo.');
  const safeArea = input.storyboardIssues.filter((issue) => issue.code === 'text_outside_safe_area');
  add('safe-area', 'Texto dentro da área segura', 'blocking', safeArea.length === 0, safeArea.length ? safeArea.map((issue) => issue.message).join(' ') : 'Todo texto na tela cabe na área segura.');
  const empty = input.scenes.filter((scene) => !scene.narration.trim() || scene.visual.type === 'none');
  const seen = new Set<string>();
  const duplicates = input.scenes.filter((scene) => { const key = scene.narration.trim().toLowerCase(); if (seen.has(key)) return true; seen.add(key); return false; });
  add('scenes', 'Sem cena vazia ou duplicada', 'blocking', empty.length === 0 && duplicates.length === 0, `${empty.length} vazia(s), ${duplicates.length} duplicada(s).`);
  const usedAssets = input.scenes.flatMap((scene) => (scene.visual.type === 'asset' ? [scene.visual.referenceId] : []));
  const editorial = [...new Set(usedAssets.filter((id) => input.useBasis?.get(id)?.basis === 'editorial_use'))];
  // A final render accepts a licence or an authorized editorial use; preview_only and not_allowed never pass.
  const allowed = (id: string) => { const use = input.useBasis?.get(id); return use ? use.basis === 'licensed' || use.basis === 'editorial_use' : input.rights.get(id) === 'verified_allowed'; };
  const unauthorized = input.scenes.filter((scene) => scene.visual.type === 'asset' && !allowed(scene.visual.referenceId));
  const rightsLabel = input.useBasis?.size ? 'Mídias com base de uso válida (licença ou uso editorial autorizado)' : 'Mídias com direitos verificados vigentes';
  add('rights', rightsLabel, 'blocking', unauthorized.length === 0, unauthorized.length ? `${unauthorized.length} cena(s) com mídia sem direito vigente nem uso editorial autorizado.` : editorial.length ? `Toda mídia tem base válida: ${editorial.length} de terceiros em uso editorial (não é licença).` : 'Toda mídia usada tem direito verificado.');
  if (editorial.length) {
    const list = editorial.map((id) => { const use = input.useBasis?.get(id); return `${use?.publisher ?? 'desconhecido'} (${use?.url ?? id}; legalClearance: ${use?.legalClearance ?? 'unknown'})`; });
    add('editorial-use', 'Mídia de terceiros em uso editorial: revise antes de exportar (G3) e publicar (G4)', 'warning', false, list.join(' · '));
  }
  add('claims', 'Afirmações factuais com evidência aprovada', 'blocking', input.unsupportedFacts === 0, input.unsupportedFacts ? `${input.unsupportedFacts} fato(s) sem evidência aprovada.` : 'Todos os fatos têm evidência aprovada.');
  add('budget', 'Custo dentro do orçamento', 'blocking', input.budget.consumedUsd <= input.budget.limitUsd + 1e-9, `US$ ${input.budget.consumedUsd.toFixed(2)} de US$ ${input.budget.limitUsd.toFixed(2)}.`);
  return input.qualityDirector ? [...checks, ...qualityDirectorChecks(input.qualityDirector)] : checks;
}

export const renderManifestSchema = z.object({
  schemaVersion: z.literal(1),
  formatId: z.string(),
  width: z.number().int(), height: z.number().int(), fps: z.number(),
  storyboardVersion: z.number().int().positive(),
  narrationKey: z.string(),
  narrationRelativePath: z.string(),
  narrationDurationMs: z.number().int().positive(),
  relativePath: z.string(),
  subtitlesRelativePath: z.string(),
  captionsBurned: z.boolean(),
  segments: z.array(z.object({ index: z.number().int(), kind: z.enum(['motion', 'asset']), sceneIds: z.array(z.string()), frames: z.number().int().positive(), key: z.string(), relativePath: z.string(), reused: z.boolean(), backgrounds: z.array(z.object({ referenceId: z.string(), source: z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).optional(), basis: z.enum(['licensed', 'editorial_use', 'preview_only', 'not_allowed']).optional() })).optional(),
    /** AP-02: the cut of the source and the basis of use of the media (absent in legacy manifests). */
    source: z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).optional(), basis: z.enum(['licensed', 'editorial_use', 'preview_only', 'not_allowed']).optional(),
    /** How long the source kept playing past the matched cut because the cut was shorter than the scene. */
    extendedMs: z.number().int().positive().optional() })),
  engine: z.object({ remotionTemplate: z.string(), ffmpeg: z.string() }),
  mediaReferenceIds: z.array(z.string()),
  /** AP-02: every acquired medium used, with its basis and untouched legal clearance (absent in legacy manifests). */
  mediaUse: z.array(z.object({ referenceId: z.string(), basis: z.enum(['licensed', 'editorial_use', 'preview_only', 'not_allowed']), legalClearance: z.string().nullable(), publisher: z.string(), url: z.string() })).optional(),
});
export type RenderManifest = z.infer<typeof renderManifestSchema>;

export const renderGateStatusSchema = z.enum(['approved', 'rejected', 'pending']);
export const renderGatesSchema = z.strictObject({
  version: z.string().min(1), technical: renderGateStatusSchema, factual: renderGateStatusSchema, editorial: renderGateStatusSchema, publication: renderGateStatusSchema,
}).nullable();
export type RenderGates = z.infer<typeof renderGatesSchema>;

/** What the renderer sees of the renders of a run and whether each can be exported. */
export const productionRendersViewSchema = z.strictObject({
  renders: z.array(z.strictObject({
    artifactId: z.string(), formatId: z.string(), relativePath: z.string(), storyboardVersion: z.number().int(), width: z.number().int(), height: z.number().int(), durationMs: z.number().int(),
    reportId: z.string().nullable(), exportable: z.boolean(), gates: renderGatesSchema, checks: z.array(z.strictObject({ id: z.string(), label: z.string(), severity: z.enum(['blocking', 'warning', 'info']), passed: z.boolean(), evidence: z.string().optional(), approved: z.boolean().optional() })),
    exported: z.string().nullable(),
  })),
});
export type ProductionRendersView = z.infer<typeof productionRendersViewSchema>;
