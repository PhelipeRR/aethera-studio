import { z } from 'zod';
import { studioStageKinds } from './velix-production.js';

/**
 * Contracts of the Aethera Autonomous Studio (docs/plans/aethera-autonomous-studio.md §4). Pure and versioned: the
 * stages, repositories and providers build on them, and nothing here calls a provider or touches a file.
 */

const isoDate = z.string().min(1);
const httpUrl = z.string().url().refine((value) => /^https?:\/\//i.test(value), { message: 'A origem precisa ser http(s).' });

export type StudioStageKind = (typeof studioStageKinds)[number];
export function isStudioStageKind(kind: string): kind is StudioStageKind {
  return (studioStageKinds as readonly string[]).includes(kind);
}

// §4.1 — game and research

export const subjectVerifications = ['confirmed', 'unconfirmed', 'conflicting'] as const;
export const verifiedSubjectSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().min(1), kind: z.literal('game'), title: z.string().trim().min(1), aliases: z.array(z.string().trim().min(1)),
  releaseDate: z.string().nullable(), datePrecision: z.enum(['day', 'month', 'quarter', 'year']), platforms: z.array(z.string().min(1)), companies: z.array(z.string().min(1)),
  externalIds: z.strictObject({ igdb: z.string().min(1).optional(), rawg: z.string().min(1).optional(), steam: z.string().min(1).optional() }),
  verification: z.enum(subjectVerifications), evidenceIds: z.array(z.string().min(1)), checkedAt: isoDate,
}).refine((value) => value.verification !== 'confirmed' || value.evidenceIds.length > 0, { message: 'Um jogo confirmado precisa de evidência.', path: ['evidenceIds'] });
export type VerifiedSubject = z.infer<typeof verifiedSubjectSchema>;

export const rankingIntentSchema = z.strictObject({
  kind: z.literal('ranking'), count: z.number().int().min(1).max(50), period: z.strictObject({ from: isoDate, to: isoDate }).optional(), subjectKind: z.literal('game'), criteria: z.string().trim().min(1),
});
export type RankingIntent = z.infer<typeof rankingIntentSchema>;

// §4.2 — acquisition and provenance

export const acquisitionStatuses = ['queued', 'running', 'paused', 'done', 'failed', 'skipped'] as const;
export const acquisitionErrorCodes = ['unavailable', 'forbidden', 'format', 'network', 'tool_missing', 'tool_outdated', 'cancelled'] as const;
export const mediaAcquisitionJobSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().min(1), runId: z.string().min(1), subjectId: z.string().min(1).nullable(), referenceId: z.string().min(1),
  adapter: z.string().min(1), idempotencyKey: z.string().min(1), status: z.enum(acquisitionStatuses), attempt: z.number().int().nonnegative(),
  bytesDone: z.number().int().nonnegative(), bytesTotal: z.number().int().nonnegative().nullable(), partialPath: z.string().min(1).optional(),
  result: z.strictObject({ assetId: z.string().min(1), contentHash: z.string().regex(/^[a-f0-9]{64}$/), width: z.number().int().positive(), height: z.number().int().positive(), fps: z.number().positive(), durationMs: z.number().int().positive(), vcodec: z.string(), acodec: z.string().nullable() }).optional(),
  error: z.strictObject({ code: z.enum(acquisitionErrorCodes), message: z.string(), retryable: z.boolean() }).optional(),
});
export type MediaAcquisitionJob = z.infer<typeof mediaAcquisitionJobSchema>;

/** Same source and format → same key; whitespace and the URL fragment do not make a new download. */
export function acquisitionIdempotencyKey(url: string, format: string): string {
  const parsed = new URL(url.trim());
  parsed.hash = '';
  return `${parsed.toString()}#${format.trim().toLowerCase()}`;
}

/** Internal editorial classification. It says how the channel decided to use the material, never that it is legally cleared. */
export const mediaUsages = ['editorial_use', 'review_required', 'blocked'] as const;
/** The legal situation is recorded apart and is never inferred by an agent. */
export const legalClearances = ['unknown', 'own', 'licensed', 'public_domain', 'creative_commons', 'press_kit_terms'] as const;
export const mediaProvenanceSchema = z.strictObject({
  schemaVersion: z.literal(1), assetId: z.string().min(1), url: httpUrl, platform: z.string().min(1), publisher: z.string().min(1), official: z.boolean(),
  publishedAt: z.string().nullable(), license: z.string().nullable(), knownRestrictions: z.array(z.string().min(1)), adapter: z.string().min(1), adapterVersion: z.string().min(1),
  acquiredAt: isoDate, usage: z.enum(mediaUsages), legalClearance: z.enum(legalClearances).default('unknown'),
});
export type MediaProvenance = z.infer<typeof mediaProvenanceSchema>;

// §4.3 — visual intelligence

export const visionCapabilities = ['describe', 'classify', 'embed_image', 'embed_text', 'ocr', 'analyze'] as const;
export const visionTasks = ['describe', 'classify', 'embed', 'match', 'qa', 'identity'] as const;
export const segmentKinds = ['gameplay', 'combat', 'exploration', 'cinematic', 'presentation', 'logo', 'menu_ui', 'text_card', 'talking', 'unknown'] as const;
export type VisionCapability = (typeof visionCapabilities)[number];
export type VisionTask = (typeof visionTasks)[number];
export type SegmentKind = (typeof segmentKinds)[number];

export const segmentQualitySchema = z.strictObject({ blur: z.number().min(0).max(1), motion: z.number().min(0).max(1), overlayText: z.boolean(), watermark: z.boolean(), black: z.boolean(), frozen: z.boolean() });
export const mediaSegmentSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().min(1), assetId: z.string().min(1), startMs: z.number().int().nonnegative(), endMs: z.number().int().positive(),
  frameHashes: z.array(z.string().min(1)), kind: z.enum(segmentKinds), description: z.string(), tags: z.array(z.string().min(1)),
  embeddingRefs: z.array(z.strictObject({ provider: z.string().min(1), model: z.string().min(1), ref: z.string().min(1) })),
  quality: segmentQualitySchema, analyzedBy: z.strictObject({ provider: z.string().min(1), model: z.string().min(1), confidence: z.number().min(0).max(1) }),
  analysis: z.strictObject({ version: z.string().min(1), band: z.enum(['automatic', 'review', 'reject']), calibratedConfidence: z.number().min(0).max(1).nullable(), limitations: z.array(z.string()),
    attempts: z.array(z.strictObject({ task: z.string(), provider: z.string(), outcome: z.string(), detail: z.string().optional() })),
  }).optional(),
}).refine((value) => value.endMs > value.startMs, { message: 'O segmento precisa terminar depois de começar.', path: ['endMs'] });
export type MediaSegment = z.infer<typeof mediaSegmentSchema>;

/** Calibrated thresholds of one decision (§4.6). `null` means "not calibrated": everything goes to review. */
export type ConfidenceThresholds = { autoAt: number; reviewAt: number } | null;
export const visionPolicySchema = z.strictObject({
  schemaVersion: z.literal(1), task: z.enum(visionTasks), chain: z.array(z.string().min(1)).min(1), budgetUsd: z.number().nonnegative(), maxLatencyMs: z.number().int().positive(),
  scope: z.enum(['global', 'channel', 'project']), thresholds: z.strictObject({ autoAt: z.number().min(0).max(1), reviewAt: z.number().min(0).max(1) }).nullable(), version: z.string().min(1),
}).refine((value) => !value.thresholds || value.thresholds.reviewAt <= value.thresholds.autoAt, { message: 'A faixa de revisão precisa ficar abaixo da automática.', path: ['thresholds'] });
export type VisionPolicy = z.infer<typeof visionPolicySchema>;

export type ConfidenceBand = 'automatic' | 'review' | 'reject';
export function confidenceBand(probability: number, thresholds: ConfidenceThresholds): ConfidenceBand {
  if (!thresholds || !Number.isFinite(probability)) return 'review';
  if (probability >= thresholds.autoAt) return 'automatic';
  return probability >= thresholds.reviewAt ? 'review' : 'reject';
}

/**
 * The lowest threshold whose automatic band keeps at least `targetPrecision` on the calibration set (§4.6). Null when
 * no threshold reaches it, so nothing is selected automatically.
 */
export function calibrateAutoThreshold(samples: ReadonlyArray<{ probability: number; correct: boolean }>, targetPrecision: number): number | null {
  const sorted = samples.filter((sample) => Number.isFinite(sample.probability)).sort((a, b) => b.probability - a.probability);
  let best: number | null = null;
  let correct = 0;
  sorted.forEach((sample, index) => {
    if (sample.correct) correct += 1;
    const next = sorted[index + 1];
    // A threshold sits between distinct probabilities: ties are accepted or refused together.
    if (next && next.probability === sample.probability) return;
    if (correct / (index + 1) >= targetPrecision) best = sample.probability;
  });
  return best;
}

// §4.5 — identity of the game in a piece of media

export const identitySources = ['provenance', 'metadata_text', 'ocr', 'audio_transcript', 'visual_reference', 'neighbour_consistency'] as const;
export const identitySignalSchema = z.strictObject({ source: z.enum(identitySources), verdict: z.enum(['match', 'mismatch', 'inconclusive']), score: z.number().min(0).max(1), evidence: z.string().min(1) });
export type IdentitySignal = z.infer<typeof identitySignalSchema>;
export const identityStatuses = ['verified', 'review_required', 'rejected'] as const;
export type IdentityStatus = (typeof identityStatuses)[number];
export const subjectIdentitySchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().min(1), assetId: z.string().min(1), segmentId: z.string().min(1).nullable(), subjectId: z.string().min(1),
  signals: z.array(identitySignalSchema), status: z.enum(identityStatuses), calibratedConfidence: z.number().min(0).max(1), verifiedBy: z.enum(['rules', 'human']),
});
export type SubjectIdentity = z.infer<typeof subjectIdentitySchema>;

/** A mismatch at or above this score rejects the media for the game, with no silent fallback. */
export const STRONG_IDENTITY_MISMATCH = 0.8;

/**
 * Rules of §4.5: verified needs matches from two different sources and no mismatch; a strong mismatch rejects; a
 * multi-game asset (compilation, event, "top") is never verified as a whole, only segment by segment.
 */
export function subjectIdentityStatus(signals: readonly IdentitySignal[], options: { multiSubjectAsset?: boolean } = {}): IdentityStatus {
  if (signals.some((signal) => signal.verdict === 'mismatch' && signal.score >= STRONG_IDENTITY_MISMATCH)) return 'rejected';
  if (options.multiSubjectAsset) return 'review_required';
  if (signals.some((signal) => signal.verdict === 'mismatch')) return 'review_required';
  const sources = new Set(signals.filter((signal) => signal.verdict === 'match').map((signal) => signal.source));
  return sources.size >= 2 ? 'verified' : 'review_required';
}

// §4.4 — matching

export const sceneMatchSchema = z.strictObject({
  sceneId: z.string().min(1), sentenceIds: z.array(z.string().min(1)).min(1), segmentId: z.string().min(1),
  /** AP-02: the acquired asset the segment belongs to (absent in matches saved before AP-02). */
  assetId: z.string().min(1).optional(), sourceStartMs: z.number().int().nonnegative(), sourceEndMs: z.number().int().positive(),
  subjectId: z.string().min(1).optional(), confidence: z.number().min(0).max(1).optional(), confidenceBand: z.enum(['automatic', 'review', 'reject']).optional(),
  score: z.number().min(0).max(1), breakdown: z.strictObject({ semantic: z.number(), subject: z.number(), kind: z.number(), quality: z.number(), diversity: z.number(), duration: z.number() }), reason: z.string().min(1),
}).refine((value) => value.sourceEndMs > value.sourceStartMs, { message: 'O trecho precisa terminar depois de começar.', path: ['sourceEndMs'] });
export type SceneMatch = z.infer<typeof sceneMatchSchema>;

/** Stable identity of one proposed cut for one scene: the person accepts this key, never a free range. */
export function matchCandidateKey(match: Pick<SceneMatch, 'sceneId' | 'segmentId' | 'sourceStartMs' | 'sourceEndMs'>): string {
  return `${match.sceneId}|${match.segmentId}|${match.sourceStartMs}-${match.sourceEndMs}`;
}

/** A cut the matching proposed for review (no calibration yet, or a band below automatic), kept for a person to accept. */
export const matchReviewCandidateSchema = z.strictObject({ candidateKey: z.string().min(1), referenceId: z.string().min(1), title: z.string(), match: sceneMatchSchema })
  .refine((value) => value.candidateKey === matchCandidateKey(value.match), { message: 'A chave do candidato não corresponde ao trecho.', path: ['candidateKey'] });
export type MatchReviewCandidate = z.infer<typeof matchReviewCandidateSchema>;

// §4.7 — semantic editing. The agent may propose only these data operations; it never receives an edit tool.
export const semanticEditKinds = ['combat', 'exploration', 'cinematic', 'presentation', 'menu_ui'] as const;
export type SemanticEditKind = (typeof semanticEditKinds)[number];
const semanticScenePatchSchema = z.strictObject({
  visualObjective: z.string().max(300).optional(), onScreenText: z.string().max(400).optional(), searchTerms: z.array(z.string().max(60)).max(12).optional(),
  sceneType: z.enum(['broll', 'chart', 'quote', 'title', 'document', 'animation']).optional(), transition: z.enum(['cut', 'fade', 'slide']).optional(),
  camera: z.enum(['static', 'push-in', 'pan']).optional(), reviewStatus: z.enum(['pending', 'approved']).optional(),
}).refine((value) => Object.keys(value).length > 0, { message: 'Uma operação de edição precisa alterar algum campo.' });
export const semanticEditOperationSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('replace_subject_visual'), subjectId: z.string().min(1), requestedKind: z.enum(semanticEditKinds) }),
  z.strictObject({ op: z.literal('update_scene'), sceneId: z.string().min(1), patch: semanticScenePatchSchema }),
  z.strictObject({ op: z.literal('move_scene'), sceneId: z.string().min(1), toIndex: z.number().int().nonnegative() }),
]);
export type SemanticEditOperation = z.infer<typeof semanticEditOperationSchema>;
export const editPlanSchema = z.strictObject({
  schemaVersion: z.literal(1), command: z.string().trim().min(1).max(500), status: z.enum(['ready', 'needs_confirmation']),
  confirmation: z.strictObject({ required: z.boolean(), question: z.string().trim().min(1).nullable() }),
  planner: z.strictObject({ mode: z.literal('read-only'), provider: z.enum(['claude', 'codex']), model: z.string().trim().min(1).max(200) }),
  operations: z.array(semanticEditOperationSchema).max(100),
}).superRefine((value, context) => {
  if (value.status === 'ready' && (value.confirmation.required || value.confirmation.question !== null || value.operations.length === 0)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmation'], message: 'Um plano pronto precisa ter operação e não pode pedir confirmação.' });
  if (value.status === 'needs_confirmation' && (!value.confirmation.required || !value.confirmation.question || value.operations.length > 0)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['confirmation'], message: 'Um plano ambíguo precisa pedir confirmação e não pode editar.' });
});
export type EditPlan = z.infer<typeof editPlanSchema>;

// §2.1 — four separate approval gates

export const approvalGates = ['technical', 'factual', 'editorial', 'publication'] as const;
export type ApprovalGate = (typeof approvalGates)[number];
const REQUIRED: Record<'export' | 'publish', readonly ApprovalGate[]> = { export: ['technical', 'factual', 'editorial'], publish: approvalGates };

/** Export needs G1–G3 and publication G1–G4, all on the same version; the latest decision of a gate counts. */
export function gatesSatisfied(action: 'export' | 'publish', approvals: ReadonlyArray<{ gate: ApprovalGate; version: string; decision: 'approved' | 'rejected' }>, version: string): { satisfied: boolean; missing: ApprovalGate[] } {
  const missing = REQUIRED[action].filter((gate) => approvals.filter((approval) => approval.gate === gate && approval.version === version).at(-1)?.decision !== 'approved');
  return { satisfied: missing.length === 0, missing };
}
