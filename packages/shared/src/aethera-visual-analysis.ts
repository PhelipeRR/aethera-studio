import { z } from 'zod';

/**
 * Universal visual analysis of a media segment (AP-04, D-AP-12): no category vocabulary. A game's "combat", a protest
 * clash or a sports play are all `action`; menus, dashboards and screenshots are `interface`. Category adapters may map
 * their own labels onto these natures; the core never depends on them.
 */
export const sceneNatures = ['action', 'exploration', 'landscape', 'dialogue', 'speech', 'crowd', 'portrait', 'cinematic', 'interface', 'text_card', 'document', 'other', 'unknown'] as const;
export type SceneNature = (typeof sceneNatures)[number];

/** `observed`: visible in the frames. `inferred`: a conclusion (identity, place, work) that the frames suggest but do not show. */
export const evidenceBases = ['observed', 'inferred'] as const;
export const textRegions = ['top', 'center', 'bottom', 'full', 'overlay'] as const;
export const entityTypes = ['person', 'character', 'organization', 'place', 'object', 'creature', 'vehicle', 'work', 'other'] as const;

const confidence = z.number().min(0).max(1);
const text = (max: number) => z.string().trim().min(1).max(max);

export const segmentAnalysisSchema = z.strictObject({
  schemaVersion: z.literal(1),
  nature: z.enum(sceneNatures), natureConfidence: confidence,
  /** Only what is visible; identities and interpretations go to `entities`/`actions` with their basis. */
  description: text(600),
  frames: z.array(z.strictObject({ atMs: z.number().int().nonnegative(), observed: text(300), visibleText: z.array(z.strictObject({ text: text(200), region: z.enum(textRegions) })).max(12) })).min(1).max(8),
  entities: z.array(z.strictObject({ name: text(120), type: z.enum(entityTypes), basis: z.enum(evidenceBases), evidence: text(240), confidence })).max(16),
  actions: z.array(z.strictObject({ description: text(160), basis: z.enum(evidenceBases), confidence })).max(12),
  environment: z.strictObject({ description: text(200), basis: z.enum(evidenceBases), confidence }).nullable(),
  /** Burned-in text competes with captions; webcam and watermark make footage unfit for most edits. */
  // Providers may explicitly return null when no burned-in text is visible; normalize that
  // representation at the domain boundary instead of classifying a valid response as technical failure.
  overlays: z.strictObject({ burnedText: z.boolean(), burnedTextRegion: z.enum(textRegions).nullable().optional(), watermark: z.boolean(), webcam: z.boolean() }),
  limitations: z.array(text(240)).max(8),
  confidence,
});
export type SegmentAnalysis = z.infer<typeof segmentAnalysisSchema>;

/** Provider and prompt behind a stored analysis, so a model or prompt change re-analyzes instead of reusing. */
export const segmentAnalysisRecordSchema = z.strictObject({
  schemaVersion: z.literal(1), assetId: z.string().min(1), segmentId: z.string().min(1), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(),
  frameHashes: z.array(z.string().min(1)).min(1), analysis: segmentAnalysisSchema,
  analyzedBy: z.strictObject({ provider: z.string().min(1), model: z.string().min(1), reportedModel: z.string().nullable(), promptVersion: z.string().min(1) }),
  durationMs: z.number().int().nonnegative(), cached: z.boolean(), analyzedAt: z.string().datetime(),
});
export type SegmentAnalysisRecord = z.infer<typeof segmentAnalysisRecordSchema>;

export const relevanceVerdicts = ['represents', 'partial', 'does_not_represent', 'uncertain'] as const;
export const narrationRelevanceSchema = z.strictObject({
  verdict: z.enum(relevanceVerdicts),
  /** Each aspect of the speech that the footage shows, with the observed evidence. */
  matched: z.array(z.strictObject({ aspect: text(120), evidence: text(240) })).max(8),
  missing: z.array(text(160)).max(8),
  /** True when the only link is the subject's name (title, game, person) and not what is shown. */
  subjectOnly: z.boolean(),
  confidence,
});
export type NarrationRelevance = z.infer<typeof narrationRelevanceSchema>;

export type RelevanceDecision = { decision: 'accept' | 'reject' | 'review'; reason: string };

const MIN_CONFIDENCE = 0.7;

/**
 * Deterministic gate over the judge's answer: a segment is accepted only when the observed content represents the
 * speech with enough confidence. A subject-name-only link, partial matches, low confidence or an unreadable segment go
 * to a person; nothing is filled in.
 */
export function relevanceDecision(judgement: NarrationRelevance, analysis: SegmentAnalysis): RelevanceDecision {
  const parsed = narrationRelevanceSchema.parse(judgement);
  if (parsed.verdict === 'does_not_represent') return { decision: 'reject', reason: `O trecho não representa a fala${parsed.missing.length ? `: falta ${parsed.missing.join(', ')}` : ''}.` };
  if (analysis.nature === 'unknown' || analysis.confidence < MIN_CONFIDENCE) return { decision: 'review', reason: 'A análise visual do trecho é incerta; uma pessoa decide.' };
  if (parsed.subjectOnly) return { decision: 'review', reason: 'A única ligação é o nome do assunto, não o que aparece na imagem.' };
  if (parsed.verdict !== 'represents') return { decision: 'review', reason: parsed.verdict === 'partial' ? 'O trecho representa só parte da fala.' : 'O juiz não teve certeza.' };
  if (!parsed.matched.length) return { decision: 'review', reason: 'Nenhum aspecto da fala tem evidência observada.' };
  if (parsed.confidence < MIN_CONFIDENCE) return { decision: 'review', reason: `Confiança ${parsed.confidence.toFixed(2)} abaixo de ${MIN_CONFIDENCE}.` };
  return { decision: 'accept', reason: parsed.matched.map((item) => `${item.aspect}: ${item.evidence}`).join('; ') };
}

// ---------------------------------------------------------------- source assessment (AP-04 etapa 2, E7)

export const mediaSourceStatuses = ['consistent', 'third_party_commentary', 'divergent_suspected', 'insufficient_evidence'] as const;
export type MediaSourceStatus = (typeof mediaSourceStatuses)[number];
export interface SourceAssessment { status: MediaSourceStatus; webcamRatio: number; persistentTexts: string[]; segments: number; reason: string }

const MIN_SEGMENTS = 4;
const WEBCAM_RATIO = 0.5;
const PERSISTENT_RATIO = 0.4;

/**
 * Compares what a media file was acquired as with what its analysed segments show. Deterministic and category-neutral:
 * a face-cam in most segments is third-party commentary; a promo whose segments keep showing the same overlay text is
 * probably someone else's demo or re-upload. It only raises a flag for the selection and for a person — it never changes
 * rights, provenance or the declared kind.
 */
export function assessSource(input: { declaredKind: string; analyses: readonly SegmentAnalysis[] }): SourceAssessment {
  const segments = input.analyses.length;
  const webcamRatio = segments ? input.analyses.filter((item) => item.overlays.webcam).length / segments : 0;
  const counts = new Map<string, number>();
  for (const item of input.analyses) {
    const texts = new Set(item.frames.flatMap((frame) => frame.visibleText.map((entry) => entry.text.trim().toLocaleLowerCase('pt-BR'))).filter((text) => text.length >= 2 && text.length <= 40));
    for (const text of texts) counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  const persistentTexts = [...counts.entries()].filter(([, count]) => count / Math.max(1, segments) >= PERSISTENT_RATIO).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([text]) => text);
  const base = { webcamRatio: Math.round(webcamRatio * 100) / 100, segments };
  if (segments < MIN_SEGMENTS) return { ...base, persistentTexts: [], status: 'insufficient_evidence', reason: `Só ${segments} trecho(s) analisado(s); são necessários ${MIN_SEGMENTS}.` };
  if (webcamRatio >= WEBCAM_RATIO) return { ...base, persistentTexts: [], status: 'third_party_commentary', reason: `Webcam em ${Math.round(webcamRatio * 100)}% dos trechos: gravação comentada por terceiro.` };
  // Interface text repeats naturally in raw footage; in a promo it points to a badge burned over the whole video.
  if (input.declaredKind !== 'footage' && persistentTexts.length) return { ...base, persistentTexts, status: 'divergent_suspected', reason: `O mesmo texto sobreposto aparece na maioria dos trechos (${persistentTexts.join(', ')}): pode ser demonstração ou reenvio de terceiro.` };
  return { ...base, persistentTexts: [], status: 'consistent', reason: 'Nada nos trechos analisados contradiz a origem declarada.' };
}
