import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import type { AnimeProvenanceAdapter } from '../analysis/anime-source-adapters.js';
import type { AetheraEvolutionCore } from '../evolution/evolution-core.js';
import { findMatchingSceneGroundingNegativeExample } from '../evolution/production-learning.js';

export type VisualCategory =
  | 'anime_animation'
  | 'gameplay'
  | 'real_person_camera'
  | 'interview_documentary'
  | 'live_action_bts'
  | 'motion_graphic'
  | 'unknown';

export interface MediaRelevanceCandidate {
  mediaId: string;
  uri: string;
  title?: string;
  description?: string;
  tags?: string[];
  origin?: string;
  url?: string;
  projectId?: string;
  durationSec: number;
  transcriptExcerpt?: string;
  visualCategoryHint?: VisualCategory;
  perceptualFingerprint?: string;
  sha256?: string;
}

export interface ScriptSegmentExpectation {
  segmentId: string;
  prompt: string;
  narrationText: string;
  genre?: string;
  expectedEntities?: string[];
  allowsRealPerson?: boolean;
  expectsAnimeWork?: boolean;
}

export interface DistributedFrameAnalysis {
  timestampSec: number;
  visualCategory: VisualCategory;
  detectedEntities?: string[];
  detectedActions?: string[];
  description?: string;
  /** OCR/transcription of text burned into the frame; never identity proof by itself. */
  visibleText?: string[];
  confidence: number;
}

export interface VisionVerificationDiagnostics {
  status: 'succeeded' | 'partial' | 'technical_blocked' | 'media_unavailable';
  provider?: string | null;
  model?: string | null;
  reportedModel?: string | null;
  durationMs?: number;
  attempts: Array<{ provider: string; outcome: string; detail?: string; durationMs?: number }>;
  error?: string;
}

export type DistributedFrameAnalysisResult = DistributedFrameAnalysis[] & {
  diagnostics?: VisionVerificationDiagnostics;
};

export type MediaCorrespondenceLevel =
  | 'exact_match'
  | 'contextual_support'
  | 'universe_only_coincidence'
  | 'unverified'
  | 'rejected';

export type VisualVerificationStatus = 'visually_verified' | 'unverified_metadata_only';

/** Editorial disposition is deliberately separate from raw provider acceptance. */
export type MediaEditorialStatus =
  | 'candidate'
  | 'contextual'
  | 'visually_verified'
  | 'approved_for_scene'
  | 'human_approved';

export interface NarrativeVisualExpectation {
  segmentId: string;
  entities: string[];
  actionsAndEvents: string[];
  expectedVisualContext: string;
  requiresSpecificEventVisual: boolean;
}

export interface MediaRelevanceDecision {
  mediaId: string;
  accepted: boolean;
  score: number;
  editorialStatus?: MediaEditorialStatus;
  /** Version of the visual policy that produced this decision. */
  policyVersion?: string;
  /** True only when the decision can contribute verified footage to a scene. */
  assemblyEligible?: boolean;
  /** Conservative tri-state outcome: positive visual proof (`verified`), explicit mismatch (`rejected`), or insufficient evidence (`needs_review`). */
  verificationOutcome?: 'verified' | 'rejected' | 'needs_review';
  relevanceTier?: 'exact_segment_match' | 'same_universe_context' | 'rejected';
  correspondenceLevel?: MediaCorrespondenceLevel;
  visualVerificationStatus?: VisualVerificationStatus;
  visualVerificationError?: string;
  /** Infrastructure/media availability state, never an editorial rejection. */
  technicalStatus?: 'technical_blocked' | 'media_unavailable';
  visualConfidence?: number;
  visualEvidence?: Array<{
    timestampSec: number;
    description: string;
    detectedEntities: string[];
    detectedActions: string[];
    visibleText?: string[];
    confidence: number;
  }>;
  matchedActions?: string[];
  matchedIntervals?: Array<{
    startSec: number;
    endSec: number;
    segmentId: string;
    provingTimestampsSec?: number[];
    provingDescriptions?: string[];
  }>;
  eligibleSegmentIds?: string[];
  rejectionCode?:
    | 'unrelated_real_person'
    | 'wrong_anime_or_entity'
    | 'same_universe_wrong_event'
    | 'wrong_game_or_topic'
    | 'cross_project_cache_leak'
    | 'generic_anime_style_without_entity'
    | 'unverified_no_visual_evidence'
    | 'insufficient_metadata_and_visual_match'
    | 'academy_negative_example';
  reason: string;
  sampledTimestampsSec: number[];
  extractedFramePaths?: string[];
  matchedEntities: string[];
  visualCategory: VisualCategory;
  animeProvenance?: {
    origin: string;
    workTitle: string;
    episode?: number | string | null;
    fromSec: number;
    toSec: number;
    confidence: number;
    anilistId?: number;
    malId?: number;
    fromCache: boolean;
    matchesExpectedWork: boolean;
    isAmbiguous?: boolean;
    ambiguityReason?: string;
    provenanceOnly: true;
  };
}

export const SCENE_GROUNDING_POLICY_VERSION = 'scene-grounding-v3';

/**
 * Context can be retained for editorial discovery, but only exact visual proof is footage.
 * The legacy fallback keeps older callers that do not have the new status fields working.
 */
export function isAssemblyEligibleDecision(decision: MediaRelevanceDecision): boolean {
  if (decision.editorialStatus !== undefined) return decision.assemblyEligible === true;
  return (
    decision.accepted &&
    (decision.correspondenceLevel === undefined || decision.correspondenceLevel === 'exact_match') &&
    (decision.visualVerificationStatus === undefined || decision.visualVerificationStatus === 'visually_verified')
  );
}

export interface VisionDecisionCacheInput {
  sha256: string;
  timestampsSec: number[];
  visualIntent?: string;
  expectedEntities: string[];
  modelVersion?: string;
  policyVersion?: string;
}

export function computeVisionDecisionCacheKey(input: VisionDecisionCacheInput): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        sha256: input.sha256,
        timestampsSec: input.timestampsSec.map((t) => Number(t.toFixed(2))),
        visualIntent: input.visualIntent ?? '',
        expectedEntities: [...input.expectedEntities].map((e) => e.toLowerCase().trim()).sort(),
        modelVersion: input.modelVersion ?? 'default',
        policyVersion: input.policyVersion ?? SCENE_GROUNDING_POLICY_VERSION,
      }),
    )
    .digest('hex');
}

export interface CacheIsolationContext {
  projectId: string;
  prompt: string;
  expectedEntities: string[];
}

export interface CacheEntryMetadata {
  projectId?: string;
  topic?: string;
  query?: string;
  url?: string;
  sha256?: string;
  filePath?: string;
}

const STOPWORDS = new Set([
  'para', 'como', 'sobre', 'mais', 'menos', 'entre', 'depois', 'antes', 'ainda', 'muito', 'muita',
  'todo', 'toda', 'todos', 'todas', 'esse', 'essa', 'isso', 'este', 'esta', 'isto', 'aquele', 'aquela',
  'com', 'sem', 'por', 'dos', 'das', 'nos', 'nas', 'uma', 'uns', 'umas', 'nao', 'sim', 'que', 'mas',
  'seu', 'sua', 'seus', 'suas', 'cinco', 'segundos', 'minutos', 'nostalgicos', 'curta', 'curto',
  'cenas', 'cena', 'cada', 'imagens', 'imagem', 'gameplays', 'gameplay', 'abertura', 'encerramento',
  'crie', 'apresente', 'narracao', 'jovem', 'portugues', 'brasileiro', 'legendas', 'animadas', 'fundo',
  'with', 'from', 'that', 'this', 'what', 'when', 'where', 'about', 'into', 'the', 'and', 'for', 'video', 'analise', 'completa',
  'anime', 'manga', 'jogo', 'jogos', 'game', 'games', 'historia', 'episodio', 'capitulo',
]);

const UNIVERSE_ALIASES: Array<[RegExp, string]> = [
  [/\bdbz\b/g, 'dragon ball dragon ball z'],
  [/\bdbs\b/g, 'dragon ball super dragon ball'],
  [/\bssj\b/g, 'super saiyajin super saiyan'],
  [/\bnamek\b/g, 'namekusei namek'],
  [/\bfrieza\b/g, 'freeza frieza'],
  [/\bkrillin\b/g, 'kuririn krillin'],
  [/\bncpd\b/g, 'ncpd night city police department cyberpunk 2077 night city'],
  [/\barasaka\b/g, 'arasaka cyberpunk 2077 night city'],
  [/\bmilitech\b/g, 'militech cyberpunk 2077 night city'],
  [/\bmaxtac\b/g, 'maxtac cyberpunk 2077 night city'],
  [/\btrauma\s+team\b/g, 'trauma team cyberpunk 2077 night city'],
  [/\bmox(?:es)?\b/g, 'mox cyberpunk 2077 night city'],
  [/\bmaelstrom\b/g, 'maelstrom cyberpunk 2077 night city'],
  [/\btyger\s+claws\b/g, 'tyger claws cyberpunk 2077 night city'],
  [/\bjohnny\s+silverhand\b/g, 'johnny silverhand cyberpunk 2077 night city'],
  [/\bdogtown\b/g, 'dogtown cyberpunk 2077 night city'],
  [/\bgrove\s+street\b/g, 'grove street gta san andreas grand theft auto: san andreas los santos'],
  [/\bballas\b/g, 'ballas gta san andreas grand theft auto: san andreas los santos'],
  [/\bcarl\s+johnson\b/g, 'carl johnson cj gta san andreas grand theft auto: san andreas'],
  [/\blos\s+santos\b/g, 'los santos gta san andreas grand theft auto: san andreas'],
  [/\bsan\s+fierro\b/g, 'san fierro gta san andreas grand theft auto: san andreas'],
  [/\blas\s+venturas\b/g, 'las venturas gta san andreas grand theft auto: san andreas'],
  [/\bgreen\s+hill(?:\s+zone)?\b/g, 'green hill zone sonic the hedgehog sonic'],
  [/\beggman\b|\brobotnik\b/g, 'eggman robotnik sonic the hedgehog sonic'],
  [/\bmario(?:\s*64)?\b/g, 'mario super mario 64'],
  [/\b(?:princess\s+)?peach(?:'s)?(?:\s+castle)?\b|\bcastelo\s+da\s+princesa\s+peach\b/g, 'peach super mario 64 mario'],
  [/\bbowser\b|\byoshi\b|\bgoomba\b|\bkoopa\b|\blakitu\b|\bbob-omb\b/g, 'bowser super mario 64 mario'],
  [/\barthur\s+morgan\b|\bjohn\s+marston\b|\bdutch\s+van\s+der\s+linde\b|\bvalentine\b|\bsaint\s+denis\b|\bpinkerton\b/g, 'arthur morgan red dead redemption 2'],
];

export function expandNarrativeAliases(normalizedText: string): string {
  let out = normalizedText;
  for (const [pattern, replacement] of UNIVERSE_ALIASES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function hasNegatedVisualMention(text: string, entity: string): boolean {
  const normalizedEntity = entity
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  if (!normalizedEntity) return false;
  const index = text.indexOf(normalizedEntity);
  if (index < 0) return false;
  const context = text.slice(Math.max(0, index - 48), Math.min(text.length, index + normalizedEntity.length + 48));
  return /\b(?:nao|não|sem|nenhum|nenhuma|nunca|not|without|no)\b[^.!?;]{0,42}(?:aparece|aparecem|visivel|visible|presente|shown|seen|there|surge|surging)/i.test(context)
    || /\b(?:aparece|aparecem|visivel|visible|presente|shown|seen|there|surge|surging)\b[^.!?;]{0,42}\b(?:nao|não|sem|nenhum|nenhuma|nunca|not|without|no)\b/i.test(context);
}

function containsVisualEntityEvidence(text: string, entity: string): boolean {
  const normalizedEntity = entity
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
  return Boolean(normalizedEntity && text.includes(normalizedEntity) && !hasNegatedVisualMention(text, normalizedEntity));
}

export function extractTopicEntities(text: string): string[] {
  const cleaned = expandNarrativeAliases(
    text
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase(),
  );
  const tokens = cleaned.match(/[a-z0-9]{3,}/g) ?? [];
  const unique: string[] = [];
  for (const token of tokens) {
    if (STOPWORDS.has(token)) continue;
    if (!unique.includes(token)) unique.push(token);
  }
  return unique.slice(0, 24);
}

const NARRATIVE_ACTION_PATTERNS: Array<{ key: string; regex: RegExp }> = [
  { key: 'transformacao', regex: /\b(se\s+transforma\w*|transformar-se|transformac(?:ao|oes)|transformation|despert\w*|awaken\w*|super saiyajin|ssj|forma final|final form|phase\s*2|second phase|segunda fase|aura dourada|golden aura|cabelo loiro|cabelo dourado)\b/i },
  { key: 'fusao', regex: /\b(fusao|fusion|funde|fundir|fuse)\b/i },
  { key: 'genki_dama', regex: /\b(genki dama|spirit bomb)\b/i },
  { key: 'morte_sacrificio', regex: /\b(morte|morre\w*|morto|death|die\w*|(?<!red\s)dead(?!\s+redemption)|sacrific\w*|caido|cai diante|fallen)\b/i },
  { key: 'batalha_confronto', regex: /\b(luta\w*|batalha\w*|enfrent\w*|confront\w*|derrot\w*|defeat\w*|ataque|attack\w*|golpe\w*|strike\w*|slash\w*|chute|soco|energia|ki|vs|fight\w*|combat\w*|battle\w*|boss\s+fight|duel\w*|clash\w*|tiroteio|tiro\w*|atir\w*|dispar\w*|shoot\w*|gunfight|arma\w*|weapon\w*|rifle|pistola|katana|espingarda|explos\w*)\b/i },
  { key: 'chegada_desembarque', regex: /\b(chegada|chegam|chega\w*|arriv\w*|desembarc\w*|esconder|nave|capsula|pouso|aterriss\w*|land\w*)\b/i },
  { key: 'explosao', regex: /\b(explos\w*|explod\w*|destruic\w*|destruct\w*)\b/i },
  { key: 'treinamento', regex: /\b(trein\w*|train\w*|gravidade|gravity)\b/i },
  { key: 'habilidade_especifica', regex: /\b(usa\w*|utiliza\w*|lanc[ao]\w*|executa\w*|invoca\w*|tecnica|technique|ability|waterfowl\s+dance|ultimate)\b/i },
];

/**
 * Extracts entities, actions/events, and expected visual context from a narrative segment.
 */
export function extractNarrativeVisualExpectation(
  segment: ScriptSegmentExpectation,
): NarrativeVisualExpectation {
  const normalized = expandNarrativeAliases(
    segment.narrationText
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase(),
  );
  const entities =
    segment.expectedEntities && segment.expectedEntities.length > 0
      ? segment.expectedEntities.map((e) => e.toLowerCase())
      : extractTopicEntities(segment.narrationText);
  const actionsAndEvents = NARRATIVE_ACTION_PATTERNS
    .filter((p) => p.regex.test(normalized))
    .map((p) => p.key);
  const requiresSpecificEventVisual =
    actionsAndEvents.some((a) =>
      ['transformacao', 'fusao', 'genki_dama', 'morte_sacrificio', 'explosao'].includes(a),
    ) ||
    (actionsAndEvents.length > 0 && entities.length >= 1);

  return {
    segmentId: segment.segmentId,
    entities,
    actionsAndEvents,
    expectedVisualContext: `${entities.join(', ')}${actionsAndEvents.length ? ` | ações: ${actionsAndEvents.join(', ')}` : ''}`,
    requiresSpecificEventVisual,
  };
}

/**
 * Computes distributed timestamps across a clip (never only frame 0).
 */
export function sampleDistributedFrameTimestamps(durationSec: number, count = 4): number[] {
  const safeDur = Math.max(1, durationSec);
  const safeCount = Math.max(2, Math.min(8, count));
  const fractions = safeCount === 2 ? [0.2, 0.75] : [0.1, 0.35, 0.62, 0.86];
  const list: number[] = [];
  for (let i = 0; i < safeCount; i += 1) {
    const frac = fractions[i] ?? (i + 1) / (safeCount + 1);
    list.push(Number((safeDur * frac).toFixed(2)));
  }
  return list;
}

export function buildMediaFingerprint(input: {
  uri: string;
  durationSec: number;
  title?: string;
  sampledTimestampsSec?: number[];
}): string {
  const size = existsSync(input.uri) ? statSync(input.uri).size : 0;
  return createHash('sha256')
    .update(`${input.uri}|${size}|${input.durationSec.toFixed(2)}|${input.title ?? ''}|${(input.sampledTimestampsSec ?? []).join(',')}`)
    .digest('hex')
    .slice(0, 24);
}

export function isCacheEntryCompatibleWithProject(
  entry: CacheEntryMetadata,
  context: CacheIsolationContext,
): { compatible: boolean; reason: string } {
  if (entry.projectId && entry.projectId !== context.projectId) {
    return {
      compatible: false,
      reason: `Cache isolado pertence a outro projeto (${entry.projectId} != ${context.projectId}).`,
    };
  }
  const entryText = `${entry.topic ?? ''} ${entry.query ?? ''}`.toLowerCase();
  const entryEntities = extractTopicEntities(entryText);
  if (context.expectedEntities.length > 0 && entryEntities.length > 0) {
    const overlap = context.expectedEntities.filter((e) => entryEntities.includes(e));
    if (overlap.length === 0) {
      return {
        compatible: false,
        reason: 'Entrada de cache sem correspondência de entidades com o projeto atual.',
      };
    }
  }
  return { compatible: true, reason: 'Cache compatível e isolado.' };
}

function inferVisualCategoryFromMetadata(candidate: MediaRelevanceCandidate): VisualCategory {
  if (candidate.visualCategoryHint) return candidate.visualCategoryHint;
  const text = `${candidate.title ?? ''} ${candidate.description ?? ''} ${(candidate.tags ?? []).join(' ')} ${candidate.uri}`.toLowerCase();
  if (/\b(interview|entrevista|podcast|react|reaction|facecam|vlog|unboxing|review\s+webcam)\b/i.test(text)) {
    return 'real_person_camera';
  }
  if (/\b(behind\s+the\s+scenes|making\s+of|bastidores|live\s*action|studio\s+tour|director)\b/i.test(text)) {
    return 'live_action_bts';
  }
  if (/\b(anime|amv|opening|ending|episodio|episode|trailer|pv|sakuga|manga)\b/i.test(text)) {
    return 'anime_animation';
  }
  if (/\b(gameplay|walkthrough|longplay|boss\s+fight|ps5|xbox|pc\s+gameplay|nintendo)\b/i.test(text)) {
    return 'gameplay';
  }
  return 'unknown';
}

function segmentAllowsRealPerson(segment: ScriptSegmentExpectation): boolean {
  if (segment.allowsRealPerson === true) return true;
  const text = `${segment.prompt} ${segment.narrationText}`.toLowerCase();
  return /\b(entrevista|interview|criador|autor|mangaka|diretor|ator|atriz|live[\s-]*action|bastidores|behind the scenes|est[uú]dio|dublador)\b/i.test(text);
}

function segmentExpectsAnime(segment: ScriptSegmentExpectation): boolean {
  if (segment.expectsAnimeWork === true) return true;
  if (segment.genre === 'anime_essay' || segment.genre === 'anime') return true;
  const text = `${segment.prompt} ${segment.narrationText}`.toLowerCase();
  return /\b(anime|mang[aá]|epis[oó]dio|personagem|shonen|seinen|isekai|arco|protagonista|otaku)\b/i.test(text);
}

function normalizedFrameObservedText(frame: DistributedFrameAnalysis): string {
  return expandNarrativeAliases(
    (frame.description ?? '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase(),
  );
}

/** A title card may have a confident OCR result, but it has no depicted subject to ground. */
function isTextOnlyFrame(frame: DistributedFrameAnalysis): boolean {
  const observed = normalizedFrameObservedText(frame);
  const hasText = (frame.visibleText?.length ?? 0) > 0;
  if (!hasText) return false;
  const explicitCard =
    frame.visualCategory === 'motion_graphic' ||
    /\b(cart[aã]o|t[ií]tulo|title card|black screen|fundo preto|fundo branco|texto sobre|text card|quote card|logo)\b/i.test(observed);
  const hasDepictedAction = (frame.detectedActions?.length ?? 0) > 0;
  const hasDepictedEntity = (frame.detectedEntities?.length ?? 0) > 0;
  return explicitCard || (!hasDepictedAction && !hasDepictedEntity);
}

function withDecisionStatus(
  decision: Omit<MediaRelevanceDecision, 'editorialStatus' | 'policyVersion' | 'assemblyEligible'>,
  status: MediaEditorialStatus,
  assemblyEligible = false,
): MediaRelevanceDecision {
  const isExplicitRejection =
    (decision.correspondenceLevel === 'rejected' && decision.rejectionCode !== 'insufficient_metadata_and_visual_match') ||
    decision.rejectionCode === 'wrong_game_or_topic' ||
    decision.rejectionCode === 'wrong_anime_or_entity' ||
    decision.rejectionCode === 'non_anime_real_person' ||
    decision.rejectionCode === 'title_card_only_not_footage' ||
    decision.rejectionCode === 'academy_negative_example';
  const verificationOutcome: MediaRelevanceDecision['verificationOutcome'] =
    decision.verificationOutcome ??
    (assemblyEligible
      ? 'verified'
      : isExplicitRejection
        ? 'rejected'
        : 'needs_review');
  return {
    ...decision,
    editorialStatus: status,
    policyVersion: SCENE_GROUNDING_POLICY_VERSION,
    assemblyEligible,
    verificationOutcome,
  };
}

function parseVisionProviderAttempts(error: string): VisionVerificationDiagnostics['attempts'] {
  const summary = /\[([^\]]+)\]/.exec(error)?.[1];
  if (!summary) return [];
  return summary.split(/;\s*/).flatMap((entry) => {
    const match = /^([^:]+):([^ (]+)(?:\((.*)\))?$/.exec(entry.trim());
    return match
      ? [{ provider: match[1]!, outcome: match[2]!, ...(match[3] ? { detail: match[3] } : {}) }]
      : [];
  });
}

/**
 * Media Relevance Gate: validates distributed frames + metadata + transcript + provenance
 * before allowing a clip into the editorial assembly.
 */
export async function evaluateMediaRelevance(
  candidate: MediaRelevanceCandidate,
  segment: ScriptSegmentExpectation,
  options?: {
    analyzeFrames?: (
      uri: string,
      timestampsSec: number[],
      segment: ScriptSegmentExpectation,
    ) => Promise<DistributedFrameAnalysis[] | DistributedFrameAnalysisResult>;
    onVisualVerification?: (diagnostics: VisionVerificationDiagnostics) => void;
    requireVisualVerification?: boolean;
    evolution?: AetheraEvolutionCore;
    animeProvenance?: AnimeProvenanceAdapter;
    provenanceFrameBuffer?: Buffer;
    extractFrameForProvenance?: (uri: string, timestampSec: number) => Promise<Buffer | null>;
  },
): Promise<MediaRelevanceDecision> {
  const sampledTimestampsSec = sampleDistributedFrameTimestamps(candidate.durationSec, 4);
  const expectation = extractNarrativeVisualExpectation(segment);
  const expectedEntities = expectation.entities;

  // 0. Consult Academy negative examples before wasting vision or accepting repeated false matches
  const workScope = extractTopicEntities(segment.prompt).slice(0, 3).join(' ');
  const eventScope = `${expectation.entities.join(' ')} ${expectation.actionsAndEvents.join(' ')}`.trim();
  if (options?.evolution) {
    const negativeMatch = findMatchingSceneGroundingNegativeExample(options.evolution, {
      ...(candidate.title ? { mediaTitle: candidate.title } : {}),
      ...(candidate.sha256 ? { mediaSha256: candidate.sha256 } : {}),
      ...(workScope ? { workScope } : {}),
      ...(eventScope ? { eventScope } : {}),
      expectedContext: expectation.expectedVisualContext,
      ...(segment.genre ? { genre: segment.genre } : {}),
    });
    if (negativeMatch.matched) {
      return withDecisionStatus({
        mediaId: candidate.mediaId,
        accepted: false,
        score: 0.05,
        relevanceTier: 'rejected',
        correspondenceLevel: 'rejected',
        rejectionCode: 'academy_negative_example',
        reason: negativeMatch.reason,
        sampledTimestampsSec,
        matchedEntities: [],
        visualCategory: candidate.visualCategoryHint ?? 'unknown',
      }, 'candidate');
    }
  }

  // 1. Cross-project isolation check
  if (candidate.projectId && segment.segmentId && candidate.origin?.startsWith('project:') && candidate.origin !== `project:${candidate.projectId}`) {
    return withDecisionStatus({
      mediaId: candidate.mediaId,
      accepted: false,
      score: 0,
      rejectionCode: 'cross_project_cache_leak',
      reason: `Ativo pertence a outro projeto (${candidate.origin}).`,
      sampledTimestampsSec,
      matchedEntities: [],
      visualCategory: candidate.visualCategoryHint ?? 'unknown',
    }, 'candidate');
  }

  // 2. Distributed frame analysis (VisionRouter / caller hook) + 2nd dense pass on promising intervals
  let frameAnalyses: DistributedFrameAnalysis[] = [];
  let visualVerificationError: string | undefined;
  let visualVerificationTechnicalStatus: 'technical_blocked' | 'media_unavailable' | undefined;
  const notifyVisualVerification = (diagnostics: VisionVerificationDiagnostics) => {
    options?.onVisualVerification?.(diagnostics);
  };
  if (options?.analyzeFrames) {
    try {
      const initialAnalysis = await options.analyzeFrames(candidate.uri, sampledTimestampsSec, segment);
      frameAnalyses = initialAnalysis;
      const initialDiagnostics = ('diagnostics' in initialAnalysis ? initialAnalysis.diagnostics : undefined) ?? { status: 'succeeded' as const, attempts: [] };
      if (initialDiagnostics.status === 'media_unavailable' || initialDiagnostics.status === 'technical_blocked') {
        visualVerificationTechnicalStatus = initialDiagnostics.status;
        visualVerificationError = initialDiagnostics.error ?? `Vision verification ${initialDiagnostics.status}.`;
        frameAnalyses = [];
      }
      notifyVisualVerification(initialDiagnostics);
    } catch (err) {
      frameAnalyses = [];
      visualVerificationError = (err as Error).message;
      const diagnostics = (err as Error & { visionDiagnostics?: VisionVerificationDiagnostics }).visionDiagnostics ?? {
        status: 'technical_blocked' as const,
        attempts: parseVisionProviderAttempts(visualVerificationError),
        error: visualVerificationError,
      };
      visualVerificationTechnicalStatus = diagnostics.status === 'media_unavailable' ? 'media_unavailable' : 'technical_blocked';
      notifyVisualVerification({ ...diagnostics, error: diagnostics.error ?? visualVerificationError });
    }

    const isStaticUri = /\.(jpe?g|png|webp)(\?|$)/i.test(candidate.uri) || /\.(jpe?g|png|webp)(\?|$)/i.test(candidate.url ?? '');
    if (frameAnalyses.length > 0 && candidate.durationSec >= 5 && !isStaticUri) {
      const initialValid = frameAnalyses.filter((f) => f.confidence > 0.15);
      const promisingAnchors = initialValid.filter((f) => {
        const fText = expandNarrativeAliases(
          `${f.description ?? ''} ${(f.detectedEntities ?? []).join(' ')} ${(f.detectedActions ?? []).join(' ')}`
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase(),
        );
        const hasEntity = expectedEntities.some((e) => fText.includes(e));
        const hasAction = expectation.actionsAndEvents.some((ak) => {
          const p = NARRATIVE_ACTION_PATTERNS.find((pat) => pat.key === ak);
          return (f.detectedActions ?? []).includes(ak) || Boolean(p?.regex.test(fText));
        });
        return hasEntity || hasAction;
      });

      const minToSatisfy = candidate.durationSec > 10 ? 2 : 1;
      const needsDensePass =
        promisingAnchors.length > 0 &&
        (promisingAnchors.length < minToSatisfy || promisingAnchors.length / Math.max(1, initialValid.length) < 0.4);
      if (needsDensePass) {
        const denseSet: number[] = [];
        const sortedAnchors = promisingAnchors.slice().sort((a, b) => a.timestampSec - b.timestampSec);
        for (let ai = 0; ai < sortedAnchors.length - 1; ai += 1) {
          const gap = sortedAnchors[ai + 1]!.timestampSec - sortedAnchors[ai]!.timestampSec;
          if (gap > 8 && denseSet.length < 6) {
            const mid = Number(((sortedAnchors[ai]!.timestampSec + sortedAnchors[ai + 1]!.timestampSec) / 2).toFixed(2));
            if (![...sampledTimestampsSec, ...denseSet].some((existing) => Math.abs(existing - mid) < 0.7)) {
              denseSet.push(mid);
            }
          }
        }
        for (const anchor of sortedAnchors.slice(0, 2)) {
          for (const delta of [-1.5, 1.5, 3.0]) {
            const t = Number(Math.max(0.4, Math.min(candidate.durationSec - 0.3, anchor.timestampSec + delta)).toFixed(2));
            const alreadyNear = [...sampledTimestampsSec, ...denseSet].some((existing) => Math.abs(existing - t) < 0.7);
            if (!alreadyNear && denseSet.length < 6) {
              denseSet.push(t);
            }
          }
        }
        if (denseSet.length > 0) {
          try {
            const denseFrames = await options.analyzeFrames(candidate.uri, denseSet, segment);
            notifyVisualVerification(('diagnostics' in denseFrames ? denseFrames.diagnostics : undefined) ?? { status: 'succeeded', attempts: [] });
            if (Array.isArray(denseFrames) && denseFrames.length > 0) {
              const merged = [...frameAnalyses];
              for (const df of denseFrames) {
                if (!merged.some((existing) => Math.abs(existing.timestampSec - df.timestampSec) < 0.4)) {
                  merged.push(df);
                }
              }
              merged.sort((a, b) => a.timestampSec - b.timestampSec);
              frameAnalyses = merged;
            }
          } catch (err) {
            // The initial semantic pass remains usable, but the failed refinement must stay visible in diagnostics.
            const error = err instanceof Error ? err.message : String(err);
            const diagnostics = (err as Error & { visionDiagnostics?: VisionVerificationDiagnostics }).visionDiagnostics ?? {
              status: 'partial' as const,
              attempts: parseVisionProviderAttempts(error),
              error,
            };
            notifyVisualVerification({ ...diagnostics, status: 'partial', error: diagnostics.error ?? error });
          }
        }
      }
    }
  }

  const dominantVisualCategory: VisualCategory =
    frameAnalyses.filter((f) => !isTextOnlyFrame(f)).length > 0
      ? frameAnalyses.filter((f) => !isTextOnlyFrame(f)).reduce<Record<string, number>>((acc, f) => {
          acc[f.visualCategory] = (acc[f.visualCategory] ?? 0) + 1;
          return acc;
        }, {}) &&
        (Object.entries(
          frameAnalyses.filter((f) => !isTextOnlyFrame(f)).reduce<Record<string, number>>((acc, f) => {
            acc[f.visualCategory] = (acc[f.visualCategory] ?? 0) + 1;
            return acc;
          }, {}),
        ).sort((a, b) => b[1] - a[1])[0]?.[0] as VisualCategory)
      : inferVisualCategoryFromMetadata(candidate);

  const combinedText = expandNarrativeAliases(
    [
      candidate.title ?? '',
      candidate.description ?? '',
      (candidate.tags ?? []).join(' '),
      candidate.transcriptExcerpt ?? '',
      ...frameAnalyses.filter((f) => !isTextOnlyFrame(f)).map(
        (f) => `${f.description ?? ''} ${(f.detectedEntities ?? []).join(' ')} ${(f.detectedActions ?? []).join(' ')}`,
      ),
    ]
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase(),
  );

  const validVisualFrames = frameAnalyses.filter(
    (f) =>
      f.confidence > 0.15 &&
      !isTextOnlyFrame(f) &&
      !/não foi possível inspecionar|nenhum conteúdo visual|nada visível|unable to inspect|cannot read|blockReadsOutsideWorkingDirectories/i.test(
        f.description ?? '',
      ),
  );
  const visualEvidence = frameAnalyses.map((f) => ({
    timestampSec: f.timestampSec,
    description: f.description ?? '',
    detectedEntities: f.detectedEntities ?? [],
    detectedActions: f.detectedActions ?? [],
    ...(f.visibleText?.length ? { visibleText: f.visibleText } : {}),
    confidence: f.confidence,
  }));
  const visualVerificationStatus: VisualVerificationStatus =
    validVisualFrames.length > 0 ? 'visually_verified' : 'unverified_metadata_only';
  const visualConfidence =
    validVisualFrames.length > 0
      ? Number(
          (validVisualFrames.reduce((acc, f) => acc + f.confidence, 0) / validVisualFrames.length).toFixed(2),
        )
      : 0;

  const normalizeFrameText = (f: DistributedFrameAnalysis): string =>
    expandNarrativeAliases(
      `${normalizedFrameObservedText(f)} ${(f.detectedEntities ?? []).join(' ')} ${(f.detectedActions ?? []).join(' ')}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase(),
    );

  const perFrameMatches = validVisualFrames.map((frame) => {
    const fText = normalizeFrameText(frame);
    const fTopicEntities = extractTopicEntities(fText);
    const fEntities = expectedEntities.filter((entity) => {
      const shortEntity = entity.split(',')[0]?.replace(/\([^)]*\)/g, '').trim() ?? entity;
      return (
        containsVisualEntityEvidence(fText, entity) ||
        (fTopicEntities.includes(entity) && !hasNegatedVisualMention(fText, entity)) ||
        (shortEntity.length >= 3 &&
          (containsVisualEntityEvidence(fText, shortEntity) ||
            (fTopicEntities.includes(shortEntity) && !hasNegatedVisualMention(fText, shortEntity))))
      );
    });
    const fActions = expectation.actionsAndEvents.filter((actionKey) => {
      const pattern = NARRATIVE_ACTION_PATTERNS.find((p) => p.key === actionKey);
      return (frame.detectedActions ?? []).includes(actionKey) || Boolean(pattern?.regex.test(fText));
    });
    const isEventMatch =
      expectation.actionsAndEvents.length > 0
        ? fActions.length > 0 && fEntities.length > 0
        : fEntities.length > 0;
    return {
      frame,
      fEntities,
      fActions,
      isEventMatch,
      matchWeight: fActions.length * 2 + fEntities.length,
    };
  });

  const eventMatchingFrames = perFrameMatches.filter((m) => m.isEventMatch);
  const candidateEntities = extractTopicEntities(combinedText);
  const metadataOnly = frameAnalyses.length === 0;
  const matchedEntities =
    validVisualFrames.length > 0
      ? Array.from(new Set(perFrameMatches.flatMap((m) => m.fEntities)))
      : metadataOnly
        ? expectedEntities.filter((entity) => combinedText.includes(entity) || candidateEntities.includes(entity))
        : [];
  const matchedActions =
    validVisualFrames.length > 0
      ? Array.from(new Set(perFrameMatches.flatMap((m) => m.fActions)))
      : metadataOnly
        ? expectation.actionsAndEvents.filter((actionKey) => {
          const pattern = NARRATIVE_ACTION_PATTERNS.find((p) => p.key === actionKey);
          const inFrames = frameAnalyses.some((f) => f.detectedActions?.includes(actionKey));
          return inFrames || Boolean(pattern?.regex.test(combinedText));
          })
        : [];
  const universeEntities = extractTopicEntities(segment.prompt);
  // Whole-word match: a prompt token such as "com" ("animes com magia") must not match inside "combate".
  const combinedWords = new Set(combinedText.split(/[^a-z0-9]+/).filter(Boolean));
  const matchedUniverseEntities = universeEntities.filter(
    (entity) => (metadataOnly || validVisualFrames.length > 0) && (combinedWords.has(entity) || candidateEntities.includes(entity)),
  );

  const expectsAnime = segmentExpectsAnime(segment);
  const allowsRealPerson = segmentAllowsRealPerson(segment);

  // Optional Anime Provenance (trace.moe): enriches work/episode/timestamp metadata & catches wrong-anime clips,
  // NEVER replaces VisionRouter or auto-approves without visual proof of the narrated action.
  let animeProvenanceMeta: MediaRelevanceDecision['animeProvenance'];
  if (expectsAnime && options?.animeProvenance) {
    try {
      const provBuffer =
        options.provenanceFrameBuffer ??
        (await options.extractFrameForProvenance?.(candidate.uri, sampledTimestampsSec[0] ?? 1)) ??
        null;
      if (provBuffer && provBuffer.length > 0) {
        const provRes = await options.animeProvenance.identifyFrame({
          frameBuffer: provBuffer,
          minConfidence: 0.78,
        });
        if (provRes.status === 'ok' && provRes.topMatch) {
          const m = provRes.topMatch;
          const candidateWorkTexts = [
            m.workTitle,
            m.titles.english ?? '',
            m.titles.romaji ?? '',
            m.titles.native ?? '',
            ...(m.titles.synonyms ?? []),
          ]
            .join(' ')
            .toLowerCase();
          const promptWorkTokens = extractTopicEntities(`${segment.prompt} ${expectedEntities.join(' ')}`);
          const matchesExpectedWork =
            promptWorkTokens.length === 0 ||
            promptWorkTokens.some((tok) => tok.length >= 3 && candidateWorkTexts.includes(tok));
          animeProvenanceMeta = {
            origin: m.origin,
            workTitle: m.workTitle,
            episode: m.episode ?? null,
            fromSec: m.fromSec,
            toSec: m.toSec,
            confidence: m.confidence,
            ...(m.identifiers.anilistId !== undefined ? { anilistId: m.identifiers.anilistId } : {}),
            ...(m.identifiers.malId !== undefined ? { malId: m.identifiers.malId } : {}),
            fromCache: m.evidence.fromCache,
            matchesExpectedWork,
            ...(provRes.isAmbiguous !== undefined ? { isAmbiguous: provRes.isAmbiguous } : {}),
            ...(provRes.ambiguityReason ? { ambiguityReason: provRes.ambiguityReason } : {}),
            provenanceOnly: true,
          };
          if (!matchesExpectedWork && !provRes.isAmbiguous && m.confidence >= 0.88) {
            return withDecisionStatus({
              mediaId: candidate.mediaId,
              accepted: false,
              score: 0.1,
              relevanceTier: 'rejected',
              correspondenceLevel: 'rejected',
              visualVerificationStatus,
              visualConfidence,
              visualEvidence,
              rejectionCode: 'wrong_anime_or_entity',
              reason: `Proveniência (${m.origin}) identificou outra obra (${m.workTitle}, conf=${m.confidence}) incompatível com o roteiro.`,
              sampledTimestampsSec,
              matchedEntities,
              visualCategory: dominantVisualCategory,
              animeProvenance: animeProvenanceMeta,
            }, 'candidate');
          }
        }
      }
    } catch {
      // graceful fallback: provenance unavailability never breaks Scene Grounding
    }
  }

  // 3. Reject unrelated real-person footage when script expects anime/animation (while allowing interviews/BTS/live-action when justified)
  if (
    expectsAnime &&
    !allowsRealPerson &&
    (dominantVisualCategory === 'real_person_camera' ||
      frameAnalyses.some((f) => f.visualCategory === 'real_person_camera' && f.confidence >= 0.6))
  ) {
    return withDecisionStatus({
      mediaId: candidate.mediaId,
      accepted: false,
      score: 0.1,
      relevanceTier: 'rejected',
      correspondenceLevel: 'rejected',
      visualVerificationStatus,
      visualConfidence,
      visualEvidence,
      rejectionCode: 'unrelated_real_person',
      reason:
        'Mídia exibe pessoa real em câmera/vlog/react sem justificativa de entrevista, bastidores ou live-action para roteiro de anime.',
      sampledTimestampsSec,
      matchedEntities,
      visualCategory: dominantVisualCategory,
    }, 'candidate');
  }

  // 4. For anime content, validate specific work/character/context OR same narrative universe — never accept generic anime-style blindly
  if (expectsAnime && expectedEntities.length > 0 && matchedEntities.length === 0 && matchedUniverseEntities.length === 0) {
    const isGenericAnime = dominantVisualCategory === 'anime_animation';
    return withDecisionStatus({
      mediaId: candidate.mediaId,
      accepted: false,
      score: isGenericAnime ? 0.25 : 0.05,
      relevanceTier: 'rejected',
      correspondenceLevel: 'rejected',
      visualVerificationStatus,
      visualConfidence,
      visualEvidence,
      rejectionCode: isGenericAnime ? 'generic_anime_style_without_entity' : 'wrong_anime_or_entity',
      reason: isGenericAnime
        ? `Estilo anime genérico sem comprovação da obra/personagem/contexto esperado (${expectedEntities.slice(0, 4).join(', ')}).`
        : `Obra/personagem/contexto incompatível com o roteiro (${expectedEntities.slice(0, 4).join(', ')}).`,
      sampledTimestampsSec,
      matchedEntities: [],
      visualCategory: dominantVisualCategory,
    }, 'candidate');
  }

  // 5. General entity overlap check for non-anime topics (e.g., different games)
  if (
    !expectsAnime &&
    expectedEntities.length >= 2 &&
    matchedEntities.length === 0 &&
    matchedUniverseEntities.length === 0 &&
    candidateEntities.length > 0
  ) {
    const titleLower = (candidate.title ?? '').toLowerCase();
    const titleMatchesExpected = expectedEntities.some((e) => e.length >= 4 && titleLower.includes(e.toLowerCase()));
    return withDecisionStatus({
      mediaId: candidate.mediaId,
      accepted: false,
      score: titleMatchesExpected ? 0.3 : 0.15,
      relevanceTier: 'rejected',
      correspondenceLevel: 'rejected',
      verificationOutcome: titleMatchesExpected ? 'needs_review' : 'rejected',
      visualVerificationStatus,
      visualConfidence,
      visualEvidence,
      rejectionCode: titleMatchesExpected ? 'insufficient_metadata_and_visual_match' : 'wrong_game_or_topic',
      reason: titleMatchesExpected
        ? `Título menciona ${expectedEntities[0]}, mas os frames não trouxeram evidência visual positiva suficiente (needs_review).`
        : `Mídia incompatível com o tema/jogo esperado (${expectedEntities.slice(0, 4).join(', ')}).`,
      sampledTimestampsSec,
      matchedEntities: [],
      visualCategory: dominantVisualCategory,
    }, 'candidate');
  }

  // 6. Strict visual verification gate when required (metadata alone is never visual proof)
  if (options?.requireVisualVerification && visualVerificationStatus === 'unverified_metadata_only') {
    return withDecisionStatus({
      mediaId: candidate.mediaId,
      accepted: false,
      score: 0.3,
      ...(visualVerificationTechnicalStatus ? { technicalStatus: visualVerificationTechnicalStatus } : {}),
      ...(visualVerificationError ? {} : { relevanceTier: 'rejected' as const, correspondenceLevel: 'unverified' as const }),
      visualVerificationStatus,
      ...(visualVerificationError ? { visualVerificationError } : {}),
      visualConfidence: 0,
      visualEvidence: [],
      ...(visualVerificationError ? {} : { rejectionCode: 'unverified_no_visual_evidence' as const }),
      reason: visualVerificationError
        ? `Falha na verificação visual (${visualVerificationError.slice(0, 160)}): mídia mantida sem aprovação.`
        : 'Não verificada visualmente: apenas metadados disponíveis sem análise de frames distribuídos.',
      sampledTimestampsSec,
      matchedEntities,
      visualCategory: dominantVisualCategory,
    }, 'candidate');
  }

  const promptTokens = new Set(extractTopicEntities(segment.prompt));
  const specificSegmentEntities = expectedEntities.filter((e) => {
    const toks = extractTopicEntities(e);
    return toks.length > 0 && toks.some((t) => !promptTokens.has(t));
  });
  const missingSpecificIdentity =
    validVisualFrames.length > 0 &&
    specificSegmentEntities.length > 0 &&
    !specificSegmentEntities.some((e) => matchedEntities.includes(e)) &&
    (expectation.requiresSpecificEventVisual ||
      (matchedEntities.length > 0 && matchedEntities.every((m) => promptTokens.has(m))));

  const isSameUniverseOnly = matchedEntities.length === 0 && matchedUniverseEntities.length > 0;
  const missingSpecificVisualEvent =
    expectation.requiresSpecificEventVisual &&
    validVisualFrames.length > 0 &&
    eventMatchingFrames.length === 0;
  // Same universe (or generic combat/gameplay without proving the specific character/implant/event) -> cannot satisfy coverage!
  if (missingSpecificIdentity || ((isSameUniverseOnly || missingSpecificVisualEvent) && expectation.requiresSpecificEventVisual)) {
    const contextEntities = matchedEntities.length > 0 ? matchedEntities : matchedUniverseEntities;
    return withDecisionStatus({
      mediaId: candidate.mediaId,
      accepted: true,
      score: 0.38,
      relevanceTier: 'same_universe_context',
      correspondenceLevel: 'universe_only_coincidence',
      visualVerificationStatus,
      visualConfidence,
      visualEvidence,
      matchedActions,
      eligibleSegmentIds: [],
      reason: `Coincidência de universo (${contextEntities.slice(0, 3).join(', ')}): nenhum frame comprovou o acontecimento específico (${expectation.expectedVisualContext}).`,
      sampledTimestampsSec,
      matchedEntities: contextEntities,
      visualCategory: dominantVisualCategory,
      ...(animeProvenanceMeta ? { animeProvenance: animeProvenanceMeta } : {}),
    }, 'contextual');
  }

  const effectiveMatched = matchedEntities.length > 0 ? matchedEntities : matchedUniverseEntities;

  const entityScore = isSameUniverseOnly
    ? 0.55
    : expectedEntities.length > 0
      ? Math.min(1, matchedEntities.length / Math.min(3, expectedEntities.length))
      : 0.25;
  const visualBonus =
    expectsAnime && dominantVisualCategory === 'anime_animation'
      ? 0.25
      : !expectsAnime && dominantVisualCategory !== 'unknown'
        ? 0.15
        : 0;
  const score = Number(Math.min(1, 0.2 + entityScore * 0.6 + visualBonus).toFixed(2));

  // Conservative guard: file title/metadata alone never proves visual correspondence.
  const positiveVisualFramesCount = perFrameMatches.filter((m) => m.fEntities.length > 0).length;
  const knownCompetingWorks = [
    'super mario 64',
    'super mario bros',
    'sonic the hedgehog',
    'gta san andreas',
    'grand theft auto',
    'red dead redemption',
    'cyberpunk 2077',
    'elden ring',
    'dragon ball',
    'naruto',
    'one piece',
  ];
  const expectedLowerJoined = `${segment.prompt ?? ''} ${expectedEntities.join(' ')}`.toLowerCase();
  const observedFramesText = validVisualFrames
    .map((f) => `${f.description} ${f.detectedEntities.join(' ')}`)
    .join(' ')
    .toLowerCase();
  const competingWorkInFrames = knownCompetingWorks.find(
    (w) => !expectedLowerJoined.includes(w) && observedFramesText.includes(w),
  );
  if (competingWorkInFrames) {
    return withDecisionStatus({
      mediaId: candidate.mediaId,
      accepted: false,
      score: 0.12,
      relevanceTier: 'rejected',
      correspondenceLevel: 'rejected',
      verificationOutcome: 'rejected',
      visualVerificationStatus,
      visualConfidence,
      visualEvidence,
      rejectionCode: 'wrong_game_or_topic',
      reason: `Incompatibilidade visual: frames mostram "${competingWorkInFrames}" em vez de ${expectedEntities.slice(0, 3).join(', ')}.`,
      sampledTimestampsSec,
      matchedEntities: [],
      visualCategory: dominantVisualCategory,
    }, 'candidate');
  }
  if (
    validVisualFrames.length > 0 &&
    expectedEntities.length > 0 &&
    positiveVisualFramesCount === 0 &&
    matchedUniverseEntities.length === 0
  ) {
    return withDecisionStatus({
      mediaId: candidate.mediaId,
      accepted: false,
      score: Math.min(score, 0.32),
      relevanceTier: 'rejected',
      correspondenceLevel: 'rejected',
      verificationOutcome: 'needs_review',
      visualVerificationStatus,
      visualConfidence,
      visualEvidence,
      rejectionCode: 'insufficient_metadata_and_visual_match',
      reason: 'Evidência visual insuficiente nos frames para confirmar a obra além do título do arquivo.',
      sampledTimestampsSec,
      matchedEntities: effectiveMatched,
      visualCategory: dominantVisualCategory,
    }, 'candidate');
  }

  if (score < 0.35) {
    return withDecisionStatus({
      mediaId: candidate.mediaId,
      accepted: false,
      score,
      relevanceTier: 'rejected',
      correspondenceLevel: 'rejected',
      verificationOutcome: 'needs_review',
      visualVerificationStatus,
      visualConfidence,
      visualEvidence,
      rejectionCode: 'insufficient_metadata_and_visual_match',
      reason: 'Evidência visual e de metadados insuficiente para confirmar relevância.',
      sampledTimestampsSec,
      matchedEntities: effectiveMatched,
      visualCategory: dominantVisualCategory,
    }, 'candidate');
  }

  const sortedPerFrame = perFrameMatches
    .slice()
    .sort((a, b) => a.frame.timestampSec - b.frame.timestampSec);
  const useEventFilter = eventMatchingFrames.length > 0;
  const isFrameRelevant = (m: (typeof sortedPerFrame)[number]) =>
    useEventFilter ? m.isEventMatch : m.fEntities.length > 0 || m.fActions.length > 0;

  const MAX_VERIFIED_CONTINUOUS_GAP_SEC = 6.0;
  const groupedIntervals: Array<{
    startSec: number;
    endSec: number;
    segmentId: string;
    weight: number;
    provingTimestampsSec: number[];
    provingDescriptions: string[];
  }> = [];
  let activeRun: typeof sortedPerFrame = [];

  const flushRun = (run: typeof sortedPerFrame, nextNonMatchingTs?: number, prevNonMatchingTs?: number) => {
    if (run.length === 0) return;
    const firstTs = run[0]!.frame.timestampSec;
    const lastTs = run[run.length - 1]!.frame.timestampSec;
    const rawStart = Math.max(0, firstTs - 1.2);
    const rawEnd = Math.min(candidate.durationSec, lastTs + 1.5);
    const boundedStart =
      prevNonMatchingTs !== undefined ? Math.max(rawStart, (prevNonMatchingTs + firstTs) / 2) : rawStart;
    const boundedEnd =
      nextNonMatchingTs !== undefined ? Math.min(rawEnd, Math.max(lastTs + 0.25, nextNonMatchingTs - 0.25)) : rawEnd;
    if (boundedEnd > boundedStart) {
      groupedIntervals.push({
        startSec: Number(boundedStart.toFixed(2)),
        endSec: Number(boundedEnd.toFixed(2)),
        segmentId: segment.segmentId,
        weight: run.reduce((acc, item) => acc + item.matchWeight, 0),
        provingTimestampsSec: run.map((item) => item.frame.timestampSec),
        provingDescriptions: run.map((item) => (item.frame.description ?? '').slice(0, 140)),
      });
    }
  };

  let prevNonMatchTs: number | undefined;
  for (const m of sortedPerFrame) {
    if (isFrameRelevant(m)) {
      const lastInRun = activeRun[activeRun.length - 1];
      if (lastInRun && m.frame.timestampSec - lastInRun.frame.timestampSec > MAX_VERIFIED_CONTINUOUS_GAP_SEC) {
        flushRun(activeRun, undefined, prevNonMatchTs);
        activeRun = [];
      }
      activeRun.push(m);
    } else {
      if (activeRun.length > 0) {
        flushRun(activeRun, m.frame.timestampSec, prevNonMatchTs);
        activeRun = [];
      }
      prevNonMatchTs = m.frame.timestampSec;
    }
  }
  if (activeRun.length > 0) {
    flushRun(activeRun, undefined, prevNonMatchTs);
  }
  groupedIntervals.sort((a, b) => b.weight - a.weight);

  const isStaticImageAsset =
    /\.(jpe?g|png|webp)(\?|$)/i.test(candidate.uri ?? '') ||
    /\.(jpe?g|png|webp)(\?|$)/i.test(candidate.url ?? '') ||
    /\.(jpe?g|png|webp)(\?|$)/i.test(candidate.title ?? '');
  let matchedIntervals =
    groupedIntervals.length > 0
      ? groupedIntervals.map(({ startSec, endSec, segmentId, provingTimestampsSec, provingDescriptions }) => ({
          startSec: isStaticImageAsset ? 0 : startSec,
          endSec: isStaticImageAsset ? Math.max(endSec, Number(candidate.durationSec.toFixed(2))) : endSec,
          segmentId,
          provingTimestampsSec,
          provingDescriptions,
        }))
      : [];

  if (matchedIntervals.length === 0) {
    if (visualVerificationStatus === 'visually_verified') {
      // Never extrapolate to the entire video when vision ran: only use frames with positive visual evidence
      const confidentFrames = (visualEvidence ?? []).filter(
        (ev) => ev.confidence >= 0.4 && (ev.detectedEntities.length > 0 || (ev.detectedActions?.length ?? 0) > 0),
      );
      if (confidentFrames.length > 0 && isSameUniverseOnly) {
        matchedIntervals = confidentFrames.map((ev) => ({
          startSec: Number(Math.max(0, ev.timestampSec - 1.5).toFixed(2)),
          endSec: Number(Math.min(candidate.durationSec, ev.timestampSec + 2.5).toFixed(2)),
          segmentId: segment.segmentId,
          provingTimestampsSec: [ev.timestampSec],
          provingDescriptions: [ev.description.slice(0, 140)],
        }));
      } else {
        return withDecisionStatus({
          mediaId: candidate.mediaId,
          accepted: false,
          score: Number(Math.min(score, 0.34).toFixed(2)),
          relevanceTier: 'rejected',
          correspondenceLevel: 'rejected',
          visualVerificationStatus,
          visualConfidence,
          visualEvidence,
          rejectionCode: 'insufficient_metadata_and_visual_match',
          reason:
            'Nenhum intervalo temporal comprovou visualmente o assunto/evento esperado (não extrapolado para o vídeo inteiro).',
          sampledTimestampsSec,
          matchedEntities: effectiveMatched,
          visualCategory: dominantVisualCategory,
        }, 'candidate');
      }
    } else {
      matchedIntervals = [
        {
          startSec: 0,
          endSec: Number(Math.min(candidate.durationSec, 30).toFixed(2)),
          segmentId: segment.segmentId,
          provingTimestampsSec: [],
          provingDescriptions: [],
        },
      ];
    }
  }

  // Strict exact_match gate: low scores, sparse proof, or universe-only matches stay contextual_support.
  const hasProvingIntervals =
    visualVerificationStatus === 'visually_verified' && groupedIntervals.length > 0;
  const minimumProvingFrames = isStaticImageAsset ? 1 : candidate.durationSec > 10 ? 2 : 1;
  const hasEnoughProvingFrames =
    visualVerificationStatus === 'visually_verified' &&
    new Set(eventMatchingFrames.map((m) => m.frame.timestampSec.toFixed(2))).size >= minimumProvingFrames &&
    eventMatchingFrames.length / Math.max(1, validVisualFrames.length) >= (candidate.durationSec > 10 ? 0.4 : 0.3);
  const correspondenceLevel: MediaCorrespondenceLevel =
    score >= 0.65 &&
    !isSameUniverseOnly &&
    matchedEntities.length > 0 &&
    hasProvingIntervals &&
    hasEnoughProvingFrames &&
    (!expectation.requiresSpecificEventVisual || matchedActions.length > 0)
      ? 'exact_match'
      : 'contextual_support';

  const assemblyEligible = correspondenceLevel === 'exact_match';
  const editorialStatus: MediaEditorialStatus = assemblyEligible
    ? 'approved_for_scene'
    : visualVerificationStatus === 'visually_verified'
      ? 'visually_verified'
      : 'candidate';
  return withDecisionStatus({
    mediaId: candidate.mediaId,
    accepted: visualVerificationStatus === 'visually_verified',
    score,
    relevanceTier: correspondenceLevel === 'exact_match' ? 'exact_segment_match' : 'same_universe_context',
    correspondenceLevel,
    visualVerificationStatus,
    visualConfidence,
    visualEvidence,
    matchedActions,
    matchedIntervals,
    eligibleSegmentIds: assemblyEligible ? [segment.segmentId] : [],
    reason:
      correspondenceLevel === 'contextual_support'
        ? `Apoio contextual do mesmo universo (${effectiveMatched.slice(0, 4).join(', ')}); verificação visual: ${visualVerificationStatus}.`
        : `Correspondência exata (${effectiveMatched.slice(0, 4).join(', ')}) em ${sampledTimestampsSec.length} frames distribuídos (${visualVerificationStatus}).`,
    sampledTimestampsSec,
    matchedEntities: effectiveMatched,
    visualCategory: dominantVisualCategory,
    ...(animeProvenanceMeta ? { animeProvenance: animeProvenanceMeta } : {}),
  }, editorialStatus, assemblyEligible);
}
