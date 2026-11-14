import { z } from 'zod';

// Velix Motion Engine: data only. A project picks allow-listed scene kinds; text never becomes code, an import or a URL.
const text = (max: number) => z.string().trim().min(1).max(max);
const segmentSchema = z.object({ text: text(500), startChar: z.number().int().nonnegative(), endChar: z.number().int().positive() });
const timing = { id: text(60), durationInFrames: z.number().int().min(1).max(1_800), transition: z.enum(['cut', 'fade']), segment: segmentSchema.optional() };
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
function channel(value: string): number { const parsed = Number.parseInt(value, 16) / 255; return parsed <= 0.03928 ? parsed / 12.92 : ((parsed + 0.055) / 1.055) ** 2.4; }
export function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => { const value = color.replace('#', ''); return 0.2126 * channel(value.slice(0, 2)) + 0.7152 * channel(value.slice(2, 4)) + 0.0722 * channel(value.slice(4, 6)); };
  const a = luminance(foreground); const b = luminance(background); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export function readableTextColor(background: string): '#000000' | '#ffffff' { return contrastRatio('#ffffff', background) >= contrastRatio('#000000', background) ? '#ffffff' : '#000000'; }
export const motionFontFamily = (font: 'inter' | 'ibm-plex-sans' | 'ibm-plex-mono'): string => ({ inter: 'Inter, "Segoe UI", sans-serif', 'ibm-plex-sans': '"IBM Plex Sans", "Segoe UI", sans-serif', 'ibm-plex-mono': '"IBM Plex Mono", Consolas, monospace' })[font];

export const motionSceneSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...timing, kind: z.literal('title'), text: text(120), subtitle: z.string().trim().max(200).optional() }),
  z.strictObject({ ...timing, kind: z.literal('stat'), value: text(24), label: text(100), source: text(200) }),
  z.strictObject({ ...timing, kind: z.literal('lower-third'), name: text(80), role: z.string().trim().max(120).optional() }),
  z.strictObject({ ...timing, kind: z.literal('card'), heading: text(100), body: text(400) }),
  // A chart without a source is refused by the contract: numbers on screen must be auditable.
  z.strictObject({ ...timing, kind: z.literal('bars'), title: text(100), source: text(200), items: z.array(z.strictObject({ label: text(40), value: z.number().finite().nonnegative() })).min(1).max(8) }),
]);

const motionBackgroundSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('solid'), color: hex }),
  z.strictObject({ kind: z.literal('gradient'), from: hex, to: hex, angle: z.number().min(0).max(360) }),
  z.strictObject({ kind: z.literal('image'), assetRef: z.string().trim().min(1).max(2_000_000), dim: z.number().min(0).max(0.8) }),
]);
export const motionV2SceneSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...timing, kind: z.literal('title'), text: text(120), subtitle: z.string().trim().max(200).optional(), segment: z.object({ text: text(500), startChar: z.number().int().nonnegative(), endChar: z.number().int().positive() }).optional(), background: motionBackgroundSchema.optional(), lockedDuration: z.boolean().optional() }),
  z.strictObject({ ...timing, kind: z.literal('stat'), value: text(24), label: text(100), source: text(200), segment: z.object({ text: text(500), startChar: z.number().int().nonnegative(), endChar: z.number().int().positive() }).optional(), background: motionBackgroundSchema.optional(), lockedDuration: z.boolean().optional() }),
  z.strictObject({ ...timing, kind: z.literal('lower-third'), name: text(80), role: z.string().trim().max(120).optional(), segment: z.object({ text: text(500), startChar: z.number().int().nonnegative(), endChar: z.number().int().positive() }).optional(), background: motionBackgroundSchema.optional(), lockedDuration: z.boolean().optional() }),
  z.strictObject({ ...timing, kind: z.literal('card'), heading: text(100), body: text(400), segment: z.object({ text: text(500), startChar: z.number().int().nonnegative(), endChar: z.number().int().positive() }).optional(), background: motionBackgroundSchema.optional(), lockedDuration: z.boolean().optional() }),
  z.strictObject({ ...timing, kind: z.literal('bars'), title: text(100), source: text(200), items: z.array(z.strictObject({ label: text(40), value: z.number().finite().nonnegative() })).min(1).max(8), segment: z.object({ text: text(500), startChar: z.number().int().nonnegative(), endChar: z.number().int().positive() }).optional(), background: motionBackgroundSchema.optional(), lockedDuration: z.boolean().optional() }),
  z.strictObject({ ...timing, kind: z.literal('photo'), assetRef: z.string().trim().min(1).max(500), caption: z.string().trim().max(200).optional(), motion: z.enum(['none', 'zoom-in', 'pan']), segment: z.object({ text: text(500), startChar: z.number().int().nonnegative(), endChar: z.number().int().positive() }).optional(), background: motionBackgroundSchema.optional(), lockedDuration: z.boolean().optional() }),
]);

export const motionCaptionSchema = z.strictObject({ text: text(200), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(), timestampMs: z.number().int().nonnegative().nullable(), confidence: z.number().min(0).max(1).nullable() });

const safeAreaSchema = z.strictObject({ top: z.number().nonnegative(), right: z.number().nonnegative(), bottom: z.number().nonnegative(), left: z.number().nonnegative() });
// Kept local so the standalone Remotion bundle does not pull the whole Studio contract graph into the browser build.
// The fields intentionally mirror verifiedSubjectSchema; the workspace builder validates its input at the boundary.
const rankingVerifiedSubjectSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().min(1), kind: z.literal('game'), title: z.string().trim().min(1), aliases: z.array(z.string().trim().min(1)),
  releaseDate: z.string().nullable(), datePrecision: z.enum(['day', 'month', 'quarter', 'year']), platforms: z.array(z.string().min(1)), companies: z.array(z.string().min(1)),
  externalIds: z.strictObject({ igdb: z.string().min(1).optional(), rawg: z.string().min(1).optional(), steam: z.string().min(1).optional() }),
  verification: z.enum(['confirmed', 'unconfirmed', 'conflicting']), evidenceIds: z.array(z.string().min(1)), checkedAt: z.string().min(1),
}).refine((value) => value.verification !== 'confirmed' || value.evidenceIds.length > 0, { message: 'Um jogo confirmado precisa de evidência.', path: ['evidenceIds'] });
const rankingSceneBase = { id: text(60), durationInFrames: z.number().int().min(1).max(1_800), transition: z.enum(['cut', 'fade']) };
export const rankingTemplateSceneSchema = z.discriminatedUnion('kind', [
  z.strictObject({ ...rankingSceneBase, kind: z.literal('opening') }),
  z.strictObject({ ...rankingSceneBase, kind: z.literal('position'), rank: z.number().int().min(1).max(50) }),
  z.strictObject({ ...rankingSceneBase, kind: z.literal('transition') }),
  z.strictObject({ ...rankingSceneBase, kind: z.literal('lower-third') }),
  z.strictObject({ ...rankingSceneBase, kind: z.literal('closing') }),
]);
export type RankingTemplateScene = z.infer<typeof rankingTemplateSceneSchema>;

export const rankingTemplateDataSchema = z.strictObject({
  schemaVersion: z.literal(1),
  title: text(120),
  criteria: text(200),
  period: z.string().trim().max(40).nullable(),
  entries: z.array(z.strictObject({ rank: z.number().int().min(1).max(50), subject: rankingVerifiedSubjectSchema })).min(1).max(50),
  scenes: z.array(rankingTemplateSceneSchema).min(4).max(200),
  safeArea: safeAreaSchema,
  reducedMotion: z.boolean(),
}).superRefine((value, context) => {
  const ranks = value.entries.map((entry) => entry.rank);
  if (new Set(ranks).size !== ranks.length) context.addIssue({ code: z.ZodIssueCode.custom, path: ['entries'], message: 'As posições do ranking precisam ser únicas.' });
  const sceneRanks = value.scenes.filter((scene): scene is Extract<RankingTemplateScene, { kind: 'position' }> => scene.kind === 'position').map((scene) => scene.rank);
  if (sceneRanks.join(',') !== ranks.join(',')) context.addIssue({ code: z.ZodIssueCode.custom, path: ['scenes'], message: 'Os cartões precisam seguir as posições dos dados verificados.' });
});
export type RankingTemplateData = z.infer<typeof rankingTemplateDataSchema>;

const motionStyleSchema = z.strictObject({ background: motionBackgroundSchema, font: z.enum(['inter', 'ibm-plex-sans', 'ibm-plex-mono']), accent: hex, preset: z.enum(['base', 'editorial', 'one-take', 'colagem-jornal', 'swiss-motion-graphics', 'whiteboard-explainer', 'data-storytelling', 'dark-tech-keynote', 'caption-news', 'halftone-dossier', 'drawn-book', 'drawn-watercolor']).optional() });
const motionNarrationSchema = z.strictObject({ assetId: text(100), relativePath: text(500) }).nullable().optional();
const motionLicensesSchema = z.array(z.strictObject({ assetRef: text(500), source: text(300), license: text(120), credit: z.string().trim().max(300).nullable() })).max(100).default([]);

const motionProjectV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  templateId: z.enum(['velix-base', 'velix-editorial', 'one-take']),
  templateVersion: z.literal(1),
  width: z.number().int().min(320).max(3840),
  height: z.number().int().min(320).max(3840),
  fps: z.number().int().min(10).max(60),
  scenes: z.array(motionSceneSchema).min(1).max(30),
  captions: z.array(motionCaptionSchema).max(500),
});
const motionProjectV2BaseSchema = z.strictObject({
  schemaVersion: z.literal(2), templateId: z.enum(['velix-base', 'velix-editorial', 'one-take']), templateVersion: z.literal(1),
  width: z.number().int().min(320).max(3840), height: z.number().int().min(320).max(3840), fps: z.number().int().min(10).max(60),
  scenes: z.array(motionV2SceneSchema).min(1).max(30), captions: z.array(motionCaptionSchema).max(500), style: motionStyleSchema,
  narration: motionNarrationSchema, licenses: motionLicensesSchema,
});
export const motionRankingProjectSchema = z.strictObject({
  schemaVersion: z.literal(2), templateId: z.literal('aethera-ranking'), templateVersion: z.literal(1),
  width: z.number().int().min(320).max(3840), height: z.number().int().min(320).max(3840), fps: z.literal(30),
  scenes: z.array(motionV2SceneSchema).min(1).max(200), captions: z.array(motionCaptionSchema).max(500), style: motionStyleSchema,
  narration: motionNarrationSchema, licenses: motionLicensesSchema, ranking: rankingTemplateDataSchema,
}).superRefine((value, context) => {
  if (value.ranking.safeArea.left + value.ranking.safeArea.right >= value.width) context.addIssue({ code: z.ZodIssueCode.custom, path: ['ranking', 'safeArea'], message: 'A área segura horizontal precisa caber no quadro.' });
  if (value.ranking.safeArea.top + value.ranking.safeArea.bottom >= value.height) context.addIssue({ code: z.ZodIssueCode.custom, path: ['ranking', 'safeArea'], message: 'A área segura vertical precisa caber no quadro.' });
});
export type AetheraRankingProject = z.infer<typeof motionRankingProjectSchema>;
const motionProjectV2Schema = z.union([motionProjectV2BaseSchema, motionRankingProjectSchema]);
export const motionProjectSchema = z.union([motionProjectV1Schema, motionProjectV2Schema]);

export type MotionScene = z.infer<typeof motionSceneSchema>;
export type MotionCaption = z.infer<typeof motionCaptionSchema>;
export type MotionProject = z.infer<typeof motionProjectSchema>;
export type MotionSceneV2 = z.infer<typeof motionV2SceneSchema>;
export interface MotionVoiceWord { w: string; s: number; e: number; }

const MOTION_SCENES = ['title', 'stat', 'lower-third', 'card', 'bars', 'photo'];
export const MOTION_TEMPLATES = [
  { id: 'velix-base', version: 1, name: 'Aethera Base', license: 'NeuralBridge', scenes: MOTION_SCENES },
  { id: 'velix-editorial', version: 1, name: 'Aethera Editorial', license: 'NeuralBridge', scenes: MOTION_SCENES },
  { id: 'aethera-ranking', version: 1, name: 'Aethera Ranking', license: 'NeuralBridge', scenes: ['opening', 'position', 'transition', 'lower-third', 'closing'] as const },
] as const;
export const MOTION_LIMITS = { maxDurationFrames: 18_000, renderTimeoutMs: 30 * 60 * 1000 } as const;

export function upgradeMotionProject(value: MotionProject): z.infer<typeof motionProjectV2Schema> {
  if (value.schemaVersion === 2) return motionProjectV2Schema.parse(value);
  return motionProjectV2Schema.parse({ ...value, schemaVersion: 2, style: { background: { kind: 'solid', color: '#000000' }, font: 'inter', accent: '#ff6a00' }, narration: null, licenses: [] });
}

export function convertMotionScene(scene: MotionScene | MotionSceneV2, kind: MotionSceneV2['kind']): MotionSceneV2 {
  const base = { id: scene.id, durationInFrames: scene.durationInFrames, transition: scene.transition };
  const textValue: string = 'text' in scene ? String(scene.text) : 'heading' in scene ? String(scene.heading) : 'body' in scene ? String(scene.body) : 'label' in scene ? String(scene.label) : 'name' in scene ? String(scene.name) : 'title' in scene ? String(scene.title) : 'caption' in scene && scene.caption ? String(scene.caption) : 'assetRef' in scene ? String(scene.assetRef) : 'Cena';
  if (kind === 'title') return { ...base, kind, text: textValue };
  if (kind === 'card') return { ...base, kind, heading: textValue.slice(0, 100), body: textValue.slice(0, 400) };
  if (kind === 'lower-third') return { ...base, kind, name: textValue.slice(0, 80) };
  if (kind === 'stat') return { ...base, kind, value: '0', label: textValue.slice(0, 100), source: 'Fonte necessária' };
  if (kind === 'bars') return { ...base, kind, title: textValue.slice(0, 100), source: 'Fonte necessária', items: [{ label: 'Item', value: 0 }] };
  return { ...base, kind: 'photo', assetRef: 'assets/selecionar-foto', caption: textValue.slice(0, 200), motion: 'none' };
}

export function motionDuration(project: Pick<MotionProject, 'scenes'>): number {
  return project.scenes.reduce((sum, scene) => sum + scene.durationInFrames, 0);
}

/** Where each scene starts on the timeline. */
export function motionTimeline(project: { scenes: readonly (MotionScene | MotionSceneV2)[] }): Array<{ scene: MotionScene | MotionSceneV2; from: number }> {
  let from = 0;
  return project.scenes.map((scene) => { const item = { scene, from }; from += scene.durationInFrames; return item; });
}

export function motionCaptionProblems(captions: readonly MotionCaption[], durationMs: number): string[] {
  const problems: string[] = [];
  captions.forEach((caption, index) => {
    if (caption.endMs <= caption.startMs) problems.push(`Legenda ${index + 1}: o fim precisa vir depois do início.`);
    if (caption.endMs > durationMs) problems.push(`Legenda ${index + 1}: passa da duração do vídeo.`);
    const previous = captions[index - 1];
    if (previous && caption.startMs < previous.endMs) problems.push(`Legenda ${index + 1}: sobrepõe a anterior.`);
  });
  return problems;
}

const SRT_TIME = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/;
const srtMs = (value: string) => { const match = SRT_TIME.exec(value); if (!match) return null; const [, h, m, s, ms] = match; return Number(h) * 3_600_000 + Number(m) * 60_000 + Number(s) * 1000 + Number(ms); };

/** Reads SRT into captions and refuses a malformed block instead of guessing its timing. */
export function parseSrt(source: string): MotionCaption[] {
  return source.replace(/\r\n/g, '\n').trim().split(/\n{2,}/).filter(Boolean).map((block, index) => {
    const lines = block.split('\n');
    const timeLine = lines.findIndex((line) => line.includes('-->'));
    const [start, end] = (lines[timeLine] ?? '').split('-->');
    const startMs = start ? srtMs(start) : null;
    const endMs = end ? srtMs(end) : null;
    const body = lines.slice(timeLine + 1).join(' ').trim();
    if (timeLine < 0 || startMs === null || endMs === null || !body) throw new Error(`invalid: bloco ${index + 1} do SRT é inválido.`);
    return motionCaptionSchema.parse({ text: body, startMs, endMs, timestampMs: null, confidence: null });
  });
}

/** Reads a JSON caption list, the other format the plan accepts, through the same contract. */
export function parseCaptionJson(source: string): MotionCaption[] {
  let value: unknown;
  try { value = JSON.parse(source); } catch { throw new Error('invalid: JSON de legendas inválido.'); }
  const parsed = z.array(motionCaptionSchema).max(500).safeParse(value);
  if (!parsed.success) throw new Error('invalid: legendas fora do contrato.');
  return parsed.data;
}

/** Moves every caption to meet the recorded voice; a caption pushed before zero is refused, not silently cut. */
export function shiftCaptions(captions: readonly MotionCaption[], offsetMs: number): MotionCaption[] {
  return captions.map((caption, index) => {
    const startMs = caption.startMs + offsetMs;
    if (startMs < 0) throw new Error(`invalid: o ajuste leva a legenda ${index + 1} para antes do início.`);
    return { ...caption, startMs, endMs: caption.endMs + offsetMs, timestampMs: caption.timestampMs === null ? null : caption.timestampMs + offsetMs };
  });
}

const captionTokens = (value: string): string[] => value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function editDistance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let row = 1; row <= a.length; row++) {
    const current = [row];
    for (let column = 1; column <= b.length; column++) {
      current[column] = Math.min((previous[column] ?? 0) + 1, (current[column - 1] ?? 0) + 1, (previous[column - 1] ?? 0) + (a[row - 1] === b[column - 1] ? 0 : 1));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

const FUZZY_MIN_SIMILARITY = 0.85;
const FUZZY_WINDOW_WORDS = 400;

/** Speech-to-text mishears names ("narrow bridge"), so a caption may differ a little; the score goes into its confidence. */
function closestSpan(wanted: string, words: readonly string[], from: number): { first: number; last: number; similarity: number } | null {
  let best: { first: number; last: number; similarity: number } | null = null;
  for (let first = from; first < Math.min(words.length, from + FUZZY_WINDOW_WORDS); first++) {
    let heard = '';
    for (let last = first; last < words.length && heard.length < wanted.length * 1.2; last++) {
      heard += words[last];
      if (heard.length < wanted.length * 0.8) continue;
      const similarity = 1 - editDistance(wanted, heard) / Math.max(wanted.length, heard.length);
      if (similarity >= FUZZY_MIN_SIMILARITY && similarity > (best?.similarity ?? 0)) best = { first, last, similarity };
    }
  }
  return best;
}

/** Aligns imported caption text to a real transcription; caption text remains data and is never executed. */
export function alignMotionCaptions(captions: readonly MotionCaption[], spoken: readonly MotionVoiceWord[]): { captions: MotionCaption[]; missed: number } {
  const words = spoken.map((word) => captionTokens(word.w).join(''));
  let cursor = 0;
  let missed = 0;
  const aligned = captions.map((caption) => {
    // Letters, not word boundaries: speech-to-text splits names such as "NeuralBridge" into "Neural Bridge".
    const wanted = captionTokens(caption.text).join('');
    let found = -1;
    let last = -1;
    for (let index = cursor; index < words.length && wanted && found < 0; index++) {
      let heard = '';
      for (let end = index; end < words.length && wanted.startsWith(heard) && heard.length < wanted.length; end++) {
        heard += words[end];
        if (heard === wanted) { found = index; last = end; }
      }
    }
    let confidence = 1;
    if (found < 0 && wanted) {
      const close = closestSpan(wanted, words, cursor);
      if (close) { found = close.first; last = close.last; confidence = Math.round(close.similarity * 100) / 100; }
    }
    if (found < 0) { missed += 1; return caption; }
    cursor = last + 1;
    const startMs = Math.round((spoken[found]?.s ?? 0) * 1000);
    const endMs = Math.round((spoken[last]?.e ?? 0) * 1000);
    if (endMs <= startMs) { missed += 1; return caption; }
    return { ...caption, startMs, endMs, timestampMs: startMs, confidence };
  });
  return { captions: aligned, missed };
}

/** Aligns scene timing to captions whose text belongs to the scene segment; unmatched segments are reported. */
export function alignMotionScenes(project: MotionProject, captions: readonly MotionCaption[], totalMs?: number): { project: MotionProject; missed: string[] } {
  const upgraded = upgradeMotionProject(project);
  const missed: string[] = [];
  const spans = upgraded.scenes.map((scene) => {
    if (scene.lockedDuration || !scene.segment) return null;
    const segmentText = scene.segment.text.toLocaleLowerCase();
    const matches = captions.filter((caption) => caption.text.toLocaleLowerCase().includes(segmentText) || segmentText.includes(caption.text.toLocaleLowerCase()));
    if (!matches.length) { missed.push(scene.id); return null; }
    return { start: Math.min(...matches.map((caption) => caption.startMs)), end: Math.max(...matches.map((caption) => caption.endMs)) };
  });
  // With the narration length known, synced scenes run back to back: each one lasts until the next synced scene starts the voice of its segment.
  const frames = (ms: number) => Math.max(1, Math.round((ms / 1000) * upgraded.fps));
  const scenes = upgraded.scenes.map((scene, index) => {
    const span = spans[index];
    if (!span) return scene;
    if (totalMs === undefined) return { ...scene, durationInFrames: frames(span.end - span.start) };
    const start = spans.findIndex(Boolean) === index ? 0 : span.start;
    const next = spans.slice(index + 1).find((item) => item !== null);
    const end = next ? next.start : Math.max(totalMs, span.end);
    return { ...scene, durationInFrames: frames(end - start) };
  });
  return { project: { ...upgraded, scenes }, missed };
}

/** Builds captions from approved script chunks and real spoken words; missing chunks stay explicit. */
export function generateMotionCaptions(script: string, spoken: readonly MotionVoiceWord[], fps = 30): { captions: MotionCaption[]; missed: string[] } {
  const chunks = script.split(/(?<=[.!?])\s+/u).map((text) => text.trim()).filter(Boolean);
  const source = chunks.map((text, index) => ({ text, startChar: script.indexOf(text), endChar: script.indexOf(text) + text.length, id: `caption-${index + 1}` }));
  const initial = source.map((chunk) => ({ text: chunk.text, startMs: 0, endMs: Math.max(1_000, Math.round(1000 / fps)), timestampMs: null, confidence: null }));
  const aligned = alignMotionCaptions(initial, spoken);
  return { captions: aligned.captions.map((caption, index) => ({ ...caption, text: source[index]?.text ?? caption.text })), missed: source.filter((_chunk, index) => aligned.captions[index]?.timestampMs === null).map((chunk) => chunk.id) };
}

export const MOTION_SUGGESTION_SCHEMA = {
  type: 'object',
  properties: { scenes: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['title', 'card', 'stat', 'lower-third', 'bars', 'photo'] }, heading: { type: 'string' }, body: { type: 'string' }, source: { type: 'string' }, seconds: { type: 'integer' }, segment: { type: 'object', properties: { text: { type: 'string' }, startChar: { type: 'integer' }, endChar: { type: 'integer' } }, required: ['text', 'startChar', 'endChar'], additionalProperties: false } }, required: ['kind', 'heading', 'body', 'seconds', 'segment'], additionalProperties: false } } },
  required: ['scenes'],
  additionalProperties: false,
};
