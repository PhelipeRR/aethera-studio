import { z } from 'zod';
import { confidenceBand, editPlanSchema, sceneMatchSchema, type ConfidenceBand, type ConfidenceThresholds, type EditPlan, type MatchReviewCandidate, type MediaSegment, type SceneMatch, type SemanticEditKind, type SubjectIdentity } from './aethera-studio.js';
import { countWords, normalizeSentence, splitSentences } from './velix-long-script.js';
import type { RenderUseBasis } from './aethera-render-use.js';
import { storyboardNarration, textKey } from './velix-sync.js';
import type { ProductionBrief, VideoFormat } from './velix-production.js';

/**
 * The storyboard of an autonomous Velix production: one scene per stretch of narration, each with an authorized asset
 * or a declared fallback (never a random image to fill time). Every edit makes a new version, so a restart restores
 * exactly what the user left. Ranking and edits are pure; files and rights live elsewhere.
 */

export const sceneTypes = ['broll', 'chart', 'quote', 'title', 'document', 'animation'] as const;
export type SceneType = (typeof sceneTypes)[number];
export const fallbackKinds = ['typography', 'document', 'chart', 'animation'] as const;
export type FallbackKind = (typeof fallbackKinds)[number];
export const sceneTransitions = ['cut', 'fade', 'slide'] as const;
export const rightsStatuses = ['verified_allowed', 'conditional', 'unverified', 'blocked', 'pending_review'] as const;
export type RightsStatus = (typeof rightsStatuses)[number];

export const sceneVisualSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('asset'), referenceId: z.string().min(1), title: z.string(), kind: z.enum(['video', 'image']), score: z.number().min(0).max(1), reason: z.string(), match: sceneMatchSchema.optional() }),
  z.object({ type: z.literal('fallback'), kind: z.enum(fallbackKinds), reason: z.string() }),
  z.object({ type: z.literal('none') }),
]);
export type SceneVisual = z.infer<typeof sceneVisualSchema>;

export const storyboardSceneSchema = z.object({
  id: z.string().min(1),
  chapter: z.number().int().nullable(),
  narration: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  claimIds: z.array(z.string()).default([]),
  visualObjective: z.string().max(300),
  /** The Aethera subject this scene is about; absent in legacy Velix storyboards. */
  subjectId: z.string().min(1).optional(),
  sceneType: z.enum(sceneTypes),
  searchTerms: z.array(z.string().max(60)).max(12),
  visual: sceneVisualSchema,
  /** Up to 400 accepted so an over-long text is reported by the validator (safe area) instead of failing the parse. */
  onScreenText: z.string().max(400).default(''),
  transition: z.enum(sceneTransitions).default('cut'),
  camera: z.enum(['static', 'push-in', 'pan']).default('static'),
  locked: z.boolean().default(false),
  reviewStatus: z.enum(['pending', 'approved']).default('pending'),
  /** This scene's own cut of the measured narration, with its words relative to the clip: moving or splitting the scene keeps the real clock. */
  audio: z.object({
    relativePath: z.string().min(1),
    durationMs: z.number().int().positive(),
    key: z.string().min(1),
    words: z.array(z.object({ w: z.string(), startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative() })).max(4_000),
  }).optional(),
});
export type StoryboardScene = z.infer<typeof storyboardSceneSchema>;
export const storyboardSchema = z.object({
  schemaVersion: z.literal(1),
  scenes: z.array(storyboardSceneSchema).min(1).max(600),
  /** `measured` once a sync put the scenes on the real narration clock; any edit that changes the spoken order estimates again. */
  timing: z.enum(['estimated', 'measured']).default('estimated'),
  /** Key of the narration the measured times belong to. */
  narrationKey: z.string().optional(),
});
export type Storyboard = z.infer<typeof storyboardSchema>;

export interface MediaCandidate {
  referenceId: string;
  kind: string;
  title: string;
  publisher: string;
  url: string;
  publishedAt: string | null;
  rightsStatus: RightsStatus;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  tags?: readonly string[];
  /** AP-02: basis of use of acquired media; when present it replaces the rights-only gate (never a licence by itself). */
  basis?: RenderUseBasis;
}

/** A persisted segment joined with its source asset and the latest independent identity verdict. */
export interface MediaSegmentCandidate {
  asset: MediaCandidate;
  segment: MediaSegment;
  identity: SubjectIdentity | null;
}

/** Scene length target: about 8 s of standard-pace narration, cut at sentence ends and never across chapters. */
export const SCENE_TARGET_WORDS = 20;
const STOPWORDS = new Set('a o os as um uma uns umas de do da dos das no na nos nas em por para com sem que e ou mas se ao aos à às é são foi era ser está estão isso isto esse essa este esta como mais menos muito muita já não sim seu sua seus suas ele ela eles elas the of and to in on for is are was were with by an'.split(' '));

export function keywords(text: string, max = 6): string[] {
  const counts = new Map<string, number>();
  for (const word of normalizeSentence(text).split(' ')) if (word.length > 3 && !STOPWORDS.has(word) && !/^\d+$/u.test(word)) counts.set(word, (counts.get(word) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, max).map(([word]) => word);
}

export function sceneTypeFor(text: string, firstOfChapter: boolean): SceneType {
  if (/[“"«]/u.test(text)) return 'quote';
  if (/\d/u.test(text)) return 'chart';
  return firstOfChapter ? 'title' : 'broll';
}

/** A chart is only a fallback when the numbers on it are backed by a verified claim; otherwise it is typography. */
export function fallbackFor(type: SceneType, hasSupportedClaim: boolean): FallbackKind {
  if (type === 'chart') return hasSupportedClaim ? 'chart' : 'typography';
  if (type === 'document') return 'document';
  if (type === 'broll' || type === 'animation') return 'animation';
  return 'typography';
}

export const msPerWord = (pace: ProductionBrief['pace']) => 60_000 / (pace === 'slow' ? 115 : pace === 'fast' ? 175 : 145);

/** Estimated times from word counts, in order; Phase E replaces them with the measured narration. */
const withoutAudio = (scene: StoryboardScene): StoryboardScene => { const { audio, ...rest } = scene; void audio; return rest; };

/** Contiguous times from each scene's own narration clip; null when any scene has no clip yet. */
export function retimeFromAudio(scenes: readonly StoryboardScene[]): StoryboardScene[] | null {
  if (!scenes.every((scene) => scene.audio)) return null;
  let cursor = 0;
  return scenes.map((scene) => {
    const duration = scene.audio?.durationMs ?? 1;
    const next = { ...scene, startMs: cursor, endMs: cursor + duration };
    cursor += duration;
    return next;
  });
}

/**
 * Where to cut a scene's clip so its first `wordsInFirst` words stay in the first part: halfway through the silence
 * between the last kept word and the next one. Null when the clip has no words to cut between.
 */
export function clipSplitPoint(audio: NonNullable<StoryboardScene['audio']>, wordsInFirst: number): number | null {
  const last = audio.words[wordsInFirst - 1];
  const next = audio.words[wordsInFirst];
  if (!last || !next) return null;
  const cut = Math.round((last.endMs + next.startMs) / 2);
  return cut > 0 && cut < audio.durationMs ? cut : null;
}

export function retime(scenes: readonly StoryboardScene[], pace: ProductionBrief['pace']): StoryboardScene[] {
  let cursor = 0;
  return scenes.map((scene) => {
    const duration = Math.max(1_000, Math.round(countWords(scene.narration) * msPerWord(pace)));
    const next = { ...scene, startMs: cursor, endMs: cursor + duration };
    cursor += duration;
    return next;
  });
}

export interface ScriptPart { chapter: number | null; narration: string }
export interface ClaimLink { id: string; text: string; supported: boolean }

/** Cuts the narration into scenes and links each scene to the claims it speaks. Visuals are chosen afterwards. */
export function buildScenes(parts: readonly ScriptPart[], claims: readonly ClaimLink[], pace: ProductionBrief['pace'], makeId: (index: number) => string): StoryboardScene[] {
  const scenes: StoryboardScene[] = [];
  for (const part of parts) {
    let current: string[] = [];
    let first = true;
    const flush = () => {
      if (!current.length) return;
      const narration = current.join(' ');
      const normalized = normalizeSentence(narration);
      const linked = claims.filter((claim) => normalized.includes(normalizeSentence(claim.text)));
      const sceneType = sceneTypeFor(narration, first);
      const terms = keywords(narration);
      scenes.push({ id: makeId(scenes.length), chapter: part.chapter, narration, startMs: 0, endMs: 1, claimIds: linked.map((claim) => claim.id), visualObjective: `Mostrar: ${terms.slice(0, 3).join(', ') || narration.slice(0, 60)}`, sceneType, searchTerms: terms, visual: { type: 'none' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'pending' });
      current = [];
      first = false;
    };
    for (const sentence of splitSentences(part.narration)) {
      current.push(sentence);
      if (countWords(current.join(' ')) >= SCENE_TARGET_WORDS) flush();
    }
    flush();
  }
  return retime(scenes, pace);
}

const tokens = (values: readonly string[]) => new Set(values.flatMap((value) => normalizeSentence(value).split(' ')).filter((word) => word.length > 2 && !STOPWORDS.has(word)));

export interface RankedCandidate { candidate: MediaCandidate; eligible: boolean; score: number; reason: string; breakdown: Record<'relevance' | 'quality' | 'aspect' | 'duration' | 'recency' | 'diversity' | 'consistency', number> }

const WEIGHTS = { relevance: 0.4, quality: 0.12, aspect: 0.12, duration: 0.1, recency: 0.08, diversity: 0.12, consistency: 0.06 } as const;

/**
 * Explainable ranking of media for one scene. Only verified, still-valid rights make a candidate eligible; the others are
 * listed (found is not authorized) but never chosen.
 */
function rankWholeMedia(scene: StoryboardScene, candidates: readonly MediaCandidate[], context: { format: VideoFormat; usedReferenceIds: readonly string[]; neighbourPublishers?: readonly string[]; now?: Date }): RankedCandidate[] {
  const wanted = tokens([...scene.searchTerms, scene.visualObjective]);
  const now = (context.now ?? new Date()).getTime();
  const used = new Map<string, number>();
  for (const id of context.usedReferenceIds) used.set(id, (used.get(id) ?? 0) + 1);
  const sceneSeconds = (scene.endMs - scene.startMs) / 1_000;
  const targetRatio = context.format.width / context.format.height;
  return candidates
    .filter((candidate) => candidate.kind === 'video' || candidate.kind === 'image')
    .map((candidate) => {
      const have = tokens([candidate.title, ...(candidate.tags ?? [])]);
      const overlap = [...wanted].filter((word) => have.has(word)).length;
      const relevance = wanted.size ? overlap / Math.min(wanted.size, Math.max(have.size, 1)) : 0;
      const quality = candidate.width && candidate.height ? Math.min(1, (candidate.width * candidate.height) / (context.format.width * context.format.height)) : 0.5;
      const aspect = candidate.width && candidate.height ? Math.max(0, 1 - Math.abs(Math.log((candidate.width / candidate.height) / targetRatio))) : 0.5;
      const duration = candidate.kind === 'image' ? 0.7 : candidate.durationSeconds ? Math.min(1, candidate.durationSeconds / Math.max(sceneSeconds, 1)) : 0.5;
      const published = candidate.publishedAt ? Date.parse(candidate.publishedAt) : Number.NaN;
      const recency = Number.isFinite(published) ? Math.max(0, 1 - (now - published) / (5 * 365 * 86_400_000)) : 0.5;
      const diversity = 1 / (1 + (used.get(candidate.referenceId) ?? 0));
      const consistency = context.neighbourPublishers?.includes(candidate.publisher) ? 1 : 0.5;
      const breakdown = { relevance: Math.min(1, relevance), quality, aspect, duration, recency, diversity, consistency };
      const score = Object.entries(WEIGHTS).reduce((sum, [key, weight]) => sum + weight * breakdown[key as keyof typeof WEIGHTS], 0);
      const eligible = candidate.rightsStatus === 'verified_allowed' && breakdown.relevance > 0;
      const reason = candidate.rightsStatus !== 'verified_allowed' ? `Direitos: ${candidate.rightsStatus}; não pode entrar no vídeo.` : breakdown.relevance === 0 ? 'Sem relação com o objetivo visual da cena.' : `Relevância ${Math.round(breakdown.relevance * 100)}%${breakdown.diversity < 1 ? ', já usada antes' : ''}.`;
      return { candidate, eligible, score: Math.round(score * 1_000) / 1_000, reason, breakdown };
    })
    .sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score || a.candidate.referenceId.localeCompare(b.candidate.referenceId));
}

export interface SegmentRankContext {
  format: VideoFormat;
  usedReferenceIds: readonly string[];
  usedSegmentIds: readonly string[];
  subjectId: string;
  thresholds: ConfidenceThresholds;
  neighbourPublishers?: readonly string[];
}

export type SegmentMatchBreakdown = Record<'semantic' | 'subject' | 'kind' | 'quality' | 'diversity' | 'duration', number>;
export interface RankedSegmentCandidate {
  candidate: MediaSegmentCandidate;
  eligible: boolean;
  reviewRequired: boolean;
  confidence: number;
  confidenceBand: ConfidenceBand;
  score: number;
  sourceStartMs: number;
  sourceEndMs: number;
  reason: string;
  breakdown: SegmentMatchBreakdown;
  match: SceneMatch;
}

const segmentKindForScene = (scene: StoryboardScene): MediaSegment['kind'] | null => {
  const text = normalizeSentence([scene.narration, scene.visualObjective, ...scene.searchTerms].join(' '));
  if (/\b(combate|combat|chefe|boss|batalha|luta)\b/u.test(text)) return 'combat';
  if (/\b(exploracao|exploration|mundo aberto|open world|mapa|cidade|descoberta)\b/u.test(text)) return 'exploration';
  if (/\b(cinematica|cinematic|historia|cutscene)\b/u.test(text)) return 'cinematic';
  if (/\b(menu|interface|inventario|mapa)\b/u.test(text)) return 'menu_ui';
  if (/\b(apresentacao|presentation|reveal|trailer)\b/u.test(text)) return 'presentation';
  return null;
};

const bounded = (value: number) => Math.max(0, Math.min(1, value));
const rounded = (value: number) => Math.round(bounded(value) * 1_000) / 1_000;

/** Segment-level ranking used by AS-06. Identity and calibrated confidence are hard gates, not score bonuses. */
export function rankMediaSegments(scene: StoryboardScene, candidates: readonly MediaSegmentCandidate[], context: SegmentRankContext): RankedSegmentCandidate[] {
  const wanted = tokens([...scene.searchTerms, scene.visualObjective, scene.narration]);
  const requestedKind = segmentKindForScene(scene);
  const sceneSeconds = Math.max((scene.endMs - scene.startMs) / 1_000, 1);
  const usedSegments = new Map<string, number>();
  for (const id of context.usedSegmentIds) usedSegments.set(id, (usedSegments.get(id) ?? 0) + 1);
  const scored = candidates.filter((candidate) => candidate.asset.kind === 'video' && candidate.segment.endMs > candidate.segment.startMs).map((candidate) => {
    const { asset, segment, identity } = candidate;
    const have = tokens([asset.title, segment.description, ...segment.tags]);
    const overlap = [...wanted].filter((word) => have.has(word)).length;
    const semantic = wanted.size ? overlap / Math.max(1, wanted.size) : 0;
    const subject = identity?.status === 'verified' && identity.subjectId === context.subjectId ? 1 : identity?.status === 'review_required' && identity.subjectId === context.subjectId ? 0.55 : 0;
    const kind = requestedKind === null ? 0.5 : segment.kind === requestedKind ? 1 : segment.kind === 'unknown' ? 0.25 : 0.05;
    const qualityFlags = [segment.quality.overlayText, segment.quality.watermark, segment.quality.black, segment.quality.frozen].filter(Boolean).length;
    const quality = bounded(1 - segment.quality.blur * 0.55 - qualityFlags * 0.2 + segment.quality.motion * 0.08);
    const diversity = 1 / (1 + (usedSegments.get(segment.id) ?? 0));
    const duration = Math.min(1, (segment.endMs - segment.startMs) / 1_000 / sceneSeconds);
    const breakdown = { semantic: bounded(semantic), subject, kind, quality, diversity, duration } satisfies SegmentMatchBreakdown;
    const score = rounded(0.38 * breakdown.semantic + 0.25 * breakdown.subject + 0.15 * breakdown.kind + 0.1 * breakdown.quality + 0.07 * breakdown.diversity + 0.05 * breakdown.duration);
    const identityMatches = identity?.subjectId === context.subjectId;
    const rawConfidence = Math.min(segment.analysis?.calibratedConfidence ?? segment.analyzedBy.confidence, identity?.calibratedConfidence ?? 0);
    const confidence = rounded(rawConfidence);
    const band = confidenceBand(confidence, context.thresholds);
    // Acquired media is judged by its basis of use (AP-02); legacy media keeps the verified-rights gate.
    const rights = asset.basis ? asset.basis !== 'not_allowed' : asset.rightsStatus === 'verified_allowed';
    const finalUse = asset.basis ? asset.basis === 'licensed' || asset.basis === 'editorial_use' : rights;
    const eligible = rights && finalUse && identityMatches && identity?.status === 'verified' && band === 'automatic' && breakdown.semantic > 0;
    const reviewRequired = rights && identityMatches && identity?.status !== 'rejected' && band === 'review';
    const reason = !rights ? (asset.basis ? 'Sem base de uso permitida (licença ou uso editorial autorizado); o trecho não pode entrar no vídeo.' : `Direitos: ${asset.rightsStatus}; o trecho não pode entrar no vídeo.`)
      : !identityMatches ? 'Identidade do jogo não corresponde à cena; não será selecionado automaticamente.'
        : identity?.status !== 'verified' ? 'Identidade marcada para revisão humana; o trecho permanece visível, mas não é automático.'
          : band !== 'automatic' ? `Confiança calibrada na faixa ${band}; a seleção automática está bloqueada.`
            : breakdown.semantic <= 0 ? 'A descrição do trecho não explica relação com a frase.'
              : `Trecho do tipo ${segment.kind} entre ${segment.startMs} ms e ${segment.endMs} ms; semelhança semântica ${Math.round(breakdown.semantic * 100)}%.`;
    const match = sceneMatchSchema.parse({ sceneId: scene.id, sentenceIds: [scene.id], segmentId: segment.id, assetId: segment.assetId, sourceStartMs: segment.startMs, sourceEndMs: segment.endMs, subjectId: identity?.subjectId, confidence, confidenceBand: band, score, breakdown, reason });
    return { candidate, eligible, reviewRequired, confidence, confidenceBand: band, score, sourceStartMs: segment.startMs, sourceEndMs: segment.endMs, reason, breakdown, match };
  });
  return scored.sort((a, b) => Number(b.eligible) - Number(a.eligible) || Number(b.reviewRequired) - Number(a.reviewRequired) || b.score - a.score || a.candidate.segment.id.localeCompare(b.candidate.segment.id));
}

/** Backward-compatible overload: legacy callers still rank whole assets; Aethera callers can pass persisted segments. */
export function rankMedia(scene: StoryboardScene, candidates: readonly MediaCandidate[], context: { format: VideoFormat; usedReferenceIds: readonly string[]; neighbourPublishers?: readonly string[]; now?: Date }): RankedCandidate[];
export function rankMedia(scene: StoryboardScene, candidates: readonly MediaSegmentCandidate[], context: SegmentRankContext): RankedSegmentCandidate[];
export function rankMedia(scene: StoryboardScene, candidates: readonly (MediaCandidate | MediaSegmentCandidate)[], context: { format: VideoFormat; usedReferenceIds: readonly string[]; neighbourPublishers?: readonly string[]; now?: Date } | SegmentRankContext): RankedCandidate[] | RankedSegmentCandidate[] {
  if ('subjectId' in context || candidates.some((candidate) => 'segment' in candidate)) return rankMediaSegments(scene, candidates as readonly MediaSegmentCandidate[], context as SegmentRankContext);
  return rankWholeMedia(scene, candidates as readonly MediaCandidate[], context);
}

/** Gives every unlocked scene its best eligible asset, preferring media not used yet; otherwise a declared fallback. */
export function selectMedia(scenes: readonly StoryboardScene[], candidates: readonly MediaCandidate[], format: VideoFormat, supportedClaimIds: ReadonlySet<string>): StoryboardScene[] {
  const used: string[] = scenes.filter((scene) => scene.locked && scene.visual.type === 'asset').map((scene) => (scene.visual as { referenceId: string }).referenceId);
  return scenes.map((scene, index) => {
    if (scene.locked) return scene;
    const previous = scenes[index - 1]?.visual;
    const neighbour = previous?.type === 'asset' ? candidates.find((item) => item.referenceId === previous.referenceId)?.publisher : undefined;
    const best = rankMedia(scene, candidates, { format, usedReferenceIds: used, ...(neighbour ? { neighbourPublishers: [neighbour] } : {}) }).find((item) => item.eligible);
    if (best) {
      used.push(best.candidate.referenceId);
      return { ...scene, visual: { type: 'asset', referenceId: best.candidate.referenceId, title: best.candidate.title, kind: best.candidate.kind as 'video' | 'image', score: best.score, reason: best.reason } };
    }
    const kind = fallbackFor(scene.sceneType, scene.claimIds.some((id) => supportedClaimIds.has(id)));
    return { ...scene, visual: { type: 'fallback', kind, reason: 'Nenhuma mídia autorizada combina com a cena.' } };
  });
}

/** Applies segment matches without changing narration, measured times, audio clips or the sync key. */
export function selectMediaSegments(scenes: readonly StoryboardScene[], candidates: readonly MediaSegmentCandidate[], context: SegmentRankContext & { supportedClaimIds?: ReadonlySet<string>; subjectIdForScene?: (scene: StoryboardScene) => string | null }): StoryboardScene[] {
  const usedSegmentIds = scenes.flatMap((scene) => scene.visual.type === 'asset' && scene.visual.match?.segmentId ? [scene.visual.match.segmentId] : []);
  return scenes.map((scene) => {
    if (scene.locked) return scene;
    const subjectId = context.subjectIdForScene?.(scene) ?? scene.subjectId ?? context.subjectId;
    const ranked = rankMedia(scene, candidates, { ...context, subjectId, usedSegmentIds });
    const best = ranked.find((item): item is RankedSegmentCandidate => item.eligible);
    if (!best) return { ...scene, visual: { type: 'fallback', kind: fallbackFor(scene.sceneType, scene.claimIds.some((id) => context.supportedClaimIds?.has(id) ?? false)), reason: ranked.find((item) => item.reviewRequired)?.reason ?? 'Nenhum trecho com identidade verificada e confiança calibrada combina com a cena.' } };
    usedSegmentIds.push(best.candidate.segment.id);
    return { ...scene, visual: { type: 'asset', referenceId: best.candidate.asset.referenceId, title: best.candidate.asset.title, kind: best.candidate.asset.kind as 'video' | 'image', score: best.score, reason: best.reason, match: best.match } };
  });
}

/** Longest on-screen text a line set fits inside the safe area: a rough budget per format, enforced, not guessed later. */
export function onScreenTextLimit(format: VideoFormat): number {
  const usable = format.width - format.safeArea.left - format.safeArea.right;
  return Math.max(24, Math.min(160, Math.round(usable / 22) * 2));
}

export interface StoryboardIssue { sceneId: string; code: 'invalid_interval' | 'overlap' | 'no_visual' | 'unauthorized_asset' | 'text_outside_safe_area' | 'unsupported_claim'; message: string }

/** What keeps a scene out of the render. A storyboard is renderable only with no issues. */
export function validateStoryboard(storyboard: Storyboard, context: { format: VideoFormat; rights: ReadonlyMap<string, RightsStatus>; unsupportedClaimIds: ReadonlySet<string>; basis?: ReadonlyMap<string, RenderUseBasis> }): StoryboardIssue[] {
  // AP-02: acquired media is judged by its basis of use; the final render still refuses preview_only.
  const usable = (referenceId: string) => { const basis = context.basis?.get(referenceId); return basis ? basis !== 'not_allowed' : context.rights.get(referenceId) === 'verified_allowed'; };
  const issues: StoryboardIssue[] = [];
  const limit = onScreenTextLimit(context.format);
  storyboard.scenes.forEach((scene, index) => {
    if (scene.endMs <= scene.startMs) issues.push({ sceneId: scene.id, code: 'invalid_interval', message: `Cena ${index + 1}: fim antes do início.` });
    const before = storyboard.scenes[index - 1];
    if (before && scene.startMs < before.endMs) issues.push({ sceneId: scene.id, code: 'overlap', message: `Cena ${index + 1} começa antes do fim da anterior.` });
    if (scene.visual.type === 'none') issues.push({ sceneId: scene.id, code: 'no_visual', message: `Cena ${index + 1} sem mídia autorizada nem fallback declarado.` });
    if (scene.visual.type === 'asset' && !usable(scene.visual.referenceId)) issues.push({ sceneId: scene.id, code: 'unauthorized_asset', message: `Cena ${index + 1}: a mídia "${scene.visual.title}" não tem direitos verificados vigentes nem uso editorial autorizado.` });
    if (scene.onScreenText.length > limit) issues.push({ sceneId: scene.id, code: 'text_outside_safe_area', message: `Cena ${index + 1}: texto na tela passa de ${limit} caracteres e sai da área segura.` });
    if (scene.claimIds.some((id) => context.unsupportedClaimIds.has(id))) issues.push({ sceneId: scene.id, code: 'unsupported_claim', message: `Cena ${index + 1} afirma um fato sem evidência aprovada.` });
  });
  return issues;
}

export const storyboardEditSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('update'), sceneId: z.string(), patch: z.object({ visualObjective: z.string().max(300).optional(), onScreenText: z.string().max(400).optional(), searchTerms: z.array(z.string().max(60)).max(12).optional(), sceneType: z.enum(sceneTypes).optional(), transition: z.enum(sceneTransitions).optional(), camera: z.enum(['static', 'push-in', 'pan']).optional(), reviewStatus: z.enum(['pending', 'approved']).optional() }).strict() }),
  z.object({ op: z.literal('move'), sceneId: z.string(), toIndex: z.number().int().nonnegative() }),
  z.object({ op: z.literal('replace'), sceneId: z.string(), visual: z.union([z.object({ type: z.literal('asset'), referenceId: z.string() }), z.object({ type: z.literal('fallback'), kind: z.enum(fallbackKinds) })]) }),
  z.object({ op: z.literal('lock'), sceneId: z.string(), locked: z.boolean() }),
  z.object({ op: z.literal('duplicate'), sceneId: z.string() }),
  /** Takes a scene out of the video (AP-04 E7); the remaining scenes keep their order and close the gap. */
  z.object({ op: z.literal('remove'), sceneId: z.string() }),
  z.object({ op: z.literal('semantic'), plan: editPlanSchema }),
  /** AP-02: a person accepts one cut the matching proposed for this scene (by key, never a free range). */
  z.object({ op: z.literal('accept_match'), sceneId: z.string(), candidateKey: z.string().min(1) }),
  /** AP-02: a person sets (or clears) which researched game the scene talks about. */
  z.object({ op: z.literal('assign_subject'), sceneId: z.string(), subjectId: z.string().min(1).nullable() }),
]);
export type StoryboardEdit = z.infer<typeof storyboardEditSchema>;

/**
 * Applies one edit. A locked scene accepts only unlock; replacing with an asset requires verified rights (the caller
 * passes the ranked candidates); duplicating splits the scene's narration in two so the voice is never said twice.
 */
export function applyStoryboardEdit(storyboard: Storyboard, edit: StoryboardEdit, context: { pace: ProductionBrief['pace']; candidates: readonly MediaCandidate[]; makeId: () => string; reviewCandidates?: readonly MatchReviewCandidate[]; subjectIds?: readonly string[] }): Storyboard {
  if (edit.op === 'semantic') throw new Error('invalid: use o plano semântico validado para esta edição.');
  const scenes = [...storyboard.scenes];
  const index = scenes.findIndex((scene) => scene.id === edit.sceneId);
  const scene = scenes[index];
  if (!scene) throw new Error('not_found: cena não encontrada no storyboard.');
  if (scene.locked && !(edit.op === 'lock' && !edit.locked)) throw new Error('forbidden: a cena está bloqueada; desbloqueie antes de editar.');
  // Edits that keep what is said, and in what order, keep the measured clock.
  const keepsTiming = edit.op === 'update' || edit.op === 'lock' || edit.op === 'replace' || edit.op === 'accept_match' || edit.op === 'assign_subject';
  if (edit.op === 'update') scenes[index] = { ...scene, ...(Object.fromEntries(Object.entries(edit.patch).filter(([, value]) => value !== undefined)) as Partial<StoryboardScene>) };
  else if (edit.op === 'lock') scenes[index] = { ...scene, locked: edit.locked };
  else if (edit.op === 'accept_match') {
    const proposal = context.reviewCandidates?.find((item) => item.candidateKey === edit.candidateKey && item.match.sceneId === scene.id);
    if (!proposal) throw new Error('not_found: este trecho não foi proposto pelo matching para esta cena.');
    if (scene.subjectId && proposal.match.subjectId && proposal.match.subjectId !== scene.subjectId) throw new Error('forbidden: o trecho é de outro jogo; ajuste o jogo da cena antes.');
    scenes[index] = { ...scene, reviewStatus: 'approved', visual: { type: 'asset', referenceId: proposal.referenceId, title: proposal.title, kind: 'video', score: proposal.match.score, reason: `Trecho aceito por você: ${proposal.match.reason}`, match: proposal.match } };
  } else if (edit.op === 'assign_subject') {
    if (edit.subjectId !== null && !context.subjectIds?.includes(edit.subjectId)) throw new Error('not_found: o jogo não pertence à pesquisa desta produção.');
    const { subjectId: _previous, ...rest } = scene;
    void _previous;
    const shownSubject = scene.visual.type === 'asset' ? scene.visual.match?.subjectId : undefined;
    // A cut of another game never stays on the scene: the person picks a cut of the new game.
    const visual: SceneVisual = shownSubject && shownSubject !== edit.subjectId ? { type: 'fallback', kind: 'typography', reason: 'O jogo da cena mudou e o trecho era de outro jogo; escolha um trecho do novo jogo.' } : scene.visual;
    scenes[index] = edit.subjectId === null ? { ...rest, visual } : { ...rest, subjectId: edit.subjectId, visual };
  }
  else if (edit.op === 'remove') {
    if (scenes.length === 1) throw new Error('invalid: não é possível remover a única cena do storyboard.');
    scenes.splice(index, 1);
  }
  else if (edit.op === 'move') {
    const target = Math.min(edit.toIndex, scenes.length - 1);
    scenes.splice(index, 1);
    scenes.splice(target, 0, scene);
  } else if (edit.op === 'replace') {
    if (edit.visual.type === 'fallback') scenes[index] = { ...scene, visual: { type: 'fallback', kind: edit.visual.kind, reason: 'Escolhido pelo usuário.' } };
    else {
      const referenceId = edit.visual.referenceId;
      const candidate = context.candidates.find((item) => item.referenceId === referenceId);
      if (!candidate) throw new Error('not_found: mídia não pertence ao projeto.');
      if (candidate.rightsStatus !== 'verified_allowed') throw new Error('forbidden: só mídia com direitos verificados vigentes entra no storyboard.');
      if (candidate.kind !== 'video' && candidate.kind !== 'image') throw new Error('invalid: a cena aceita vídeo ou imagem.');
      scenes[index] = { ...scene, visual: { type: 'asset', referenceId, title: candidate.title, kind: candidate.kind, score: 1, reason: 'Escolhida pelo usuário.' } };
    }
  } else {
    const sentences = splitSentences(scene.narration);
    if (sentences.length < 2) throw new Error('invalid: a cena tem uma frase só; não há como dividi-la.');
    const half = Math.ceil(sentences.length / 2);
    scenes.splice(index, 1, { ...scene, narration: sentences.slice(0, half).join(' ') }, { ...scene, id: context.makeId(), narration: sentences.slice(half).join(' '), locked: false, reviewStatus: 'pending' });
  }
  if (keepsTiming) return { ...storyboard, scenes };
  // A split cannot keep a clip it has not cut yet: the service cuts it (I/O) and retimes; here both halves lose it.
  const settled = edit.op === 'duplicate' ? scenes.map((item) => (item.id === scene.id || !storyboard.scenes.some((old) => old.id === item.id) ? withoutAudio(item) : item)) : scenes;
  const measured = retimeFromAudio(settled);
  if (measured) return { schemaVersion: 1, scenes: measured, timing: 'measured', narrationKey: textKey(storyboardNarration(measured)) };
  return { schemaVersion: 1, scenes: retime(settled, context.pace), timing: 'estimated' };
}

export interface SemanticEditApplyResult { storyboard: Storyboard; affectedSceneIds: string[]; rerenderSegmentIds: string[] }

/** Applies the closed semantic plan without touching narration, TTS, research or provider state. */
export function applySemanticEditPlan(storyboard: Storyboard, input: EditPlan, context: { pace: ProductionBrief['pace']; candidates: readonly MediaCandidate[]; makeId: () => string; segmentIdsForScene: (scene: StoryboardScene) => readonly string[] }): SemanticEditApplyResult {
  const plan = editPlanSchema.parse(input);
  if (plan.status !== 'ready') throw new Error('confirmation_required: o plano semântico precisa de confirmação humana.');
  let next = storyboard;
  const affected: string[] = [];
  const mark = (sceneId: string) => { if (!affected.includes(sceneId)) affected.push(sceneId); };
  const kindLabel: Record<SemanticEditKind, string> = { combat: 'combate', exploration: 'exploração', cinematic: 'cinemática', presentation: 'apresentação', menu_ui: 'interface' };
  for (const operation of plan.operations) {
    if (operation.op === 'replace_subject_visual') {
      const matches = next.scenes.filter((scene) => scene.subjectId === operation.subjectId);
      if (!matches.length) throw new Error('not_found: nenhum jogo da cena corresponde ao subjectId do plano.');
      for (const scene of matches) {
        if (scene.locked) throw new Error('forbidden: a cena está bloqueada; desbloqueie antes da edição semântica.');
        const term = operation.requestedKind;
        const searchTerms = [...new Set([...scene.searchTerms, kindLabel[term]])].slice(0, 12);
        next = { ...next, scenes: next.scenes.map((candidate) => candidate.id === scene.id ? { ...candidate, visualObjective: `Mostrar ${kindLabel[term]}`, searchTerms, visual: { type: 'fallback', kind: 'animation', reason: `Edição semântica: priorizar ${kindLabel[term]}.` }, reviewStatus: 'pending' } : candidate) };
        mark(scene.id);
      }
      continue;
    }
    mark(operation.sceneId);
    next = applyStoryboardEdit(next, operation.op === 'update_scene' ? { op: 'update', sceneId: operation.sceneId, patch: operation.patch } : { op: 'move', sceneId: operation.sceneId, toIndex: operation.toIndex }, context);
  }
  const rerenderSegmentIds = [...new Set(affected.flatMap((sceneId) => {
    const scene = next.scenes.find((item) => item.id === sceneId) ?? storyboard.scenes.find((item) => item.id === sceneId);
    return scene ? context.segmentIdsForScene(scene) : [];
  }))];
  return { storyboard: next, affectedSceneIds: affected, rerenderSegmentIds };
}

export const storyboardIssueSchema = z.strictObject({ sceneId: z.string(), code: z.enum(['invalid_interval', 'overlap', 'no_visual', 'unauthorized_asset', 'text_outside_safe_area', 'unsupported_claim']), message: z.string() });
/** What the renderer sees of the latest storyboard version. */
export const storyboardViewSchema = z.strictObject({
  version: z.number().int().positive(), source: z.enum(['generated', 'edit', 'sync', 'restore', 'matching']), timing: z.enum(['estimated', 'measured']), createdAt: z.string(), scenes: z.array(storyboardSceneSchema),
  issues: z.array(storyboardIssueSchema), renderable: z.boolean(), versions: z.number().int().positive(),
});
export type StoryboardView = z.infer<typeof storyboardViewSchema>;
export const semanticEditResultSchema = z.strictObject({
  status: z.enum(['applied', 'needs_confirmation']), plan: editPlanSchema, view: storyboardViewSchema,
  affectedSceneIds: z.array(z.string()), rerenderSegmentIds: z.array(z.string()), ttsCalled: z.literal(false), researchCalled: z.literal(false),
});
export type SemanticEditResult = z.infer<typeof semanticEditResultSchema>;
export const storyboardCandidateViewSchema = z.strictObject({ referenceId: z.string(), title: z.string(), kind: z.string(), publisher: z.string(), url: z.string(), rightsStatus: z.enum(rightsStatuses), eligible: z.boolean(), score: z.number(), reason: z.string() });
export type StoryboardCandidateView = z.infer<typeof storyboardCandidateViewSchema>;
