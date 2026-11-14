import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
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
  confidence: number;
}

export type MediaCorrespondenceLevel =
  | 'exact_match'
  | 'contextual_support'
  | 'universe_only_coincidence'
  | 'unverified'
  | 'rejected';

export type VisualVerificationStatus = 'visually_verified' | 'unverified_metadata_only';

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
  relevanceTier?: 'exact_segment_match' | 'same_universe_context' | 'rejected';
  correspondenceLevel?: MediaCorrespondenceLevel;
  visualVerificationStatus?: VisualVerificationStatus;
  visualVerificationError?: string;
  visualConfidence?: number;
  visualEvidence?: Array<{
    timestampSec: number;
    description: string;
    detectedEntities: string[];
    detectedActions: string[];
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
  'with', 'from', 'that', 'this', 'what', 'when', 'where', 'about', 'into', 'video', 'analise', 'completa',
  'anime', 'manga', 'jogo', 'jogos', 'game', 'games', 'historia', 'episodio', 'capitulo',
]);

const UNIVERSE_ALIASES: Array<[RegExp, string]> = [
  [/\bdbz\b/g, 'dragon ball dragon ball z'],
  [/\bdbs\b/g, 'dragon ball super dragon ball'],
  [/\bssj\b/g, 'super saiyajin super saiyan'],
  [/\bnamek\b/g, 'namekusei namek'],
  [/\bfrieza\b/g, 'freeza frieza'],
  [/\bkrillin\b/g, 'kuririn krillin'],
];

function expandNarrativeAliases(normalizedText: string): string {
  let out = normalizedText;
  for (const [pattern, replacement] of UNIVERSE_ALIASES) {
    out = out.replace(pattern, replacement);
  }
  return out;
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
  { key: 'transformacao', regex: /\b(transforma\w*|despert\w*|super saiyajin|ssj|forma final|aura dourada|cabelo loiro|cabelo dourado)\b/i },
  { key: 'fusao', regex: /\b(fusao|funde|fundir)\b/i },
  { key: 'genki_dama', regex: /\b(genki dama|spirit bomb)\b/i },
  { key: 'morte_sacrificio', regex: /\b(morte|morre\w*|morto|caido|sacrific\w*|cai diante)\b/i },
  { key: 'batalha_confronto', regex: /\b(luta\w*|batalha\w*|enfrent\w*|confront\w*|derrot\w*|ataque|golpe\w*|chute|soco|energia|ki|vs)\b/i },
  { key: 'chegada_desembarque', regex: /\b(chegada|chegam|chega\w*|desembarc\w*|esconder|nave|capsula|pouso|aterriss\w*)\b/i },
  { key: 'explosao', regex: /\b(explos\w*|destruic\w*)\b/i },
  { key: 'treinamento', regex: /\b(trein\w*|gravidade)\b/i },
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
    ) => Promise<DistributedFrameAnalysis[]>;
    requireVisualVerification?: boolean;
    evolution?: AetheraEvolutionCore;
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
      return {
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
      };
    }
  }

  // 1. Cross-project isolation check
  if (candidate.projectId && segment.segmentId && candidate.origin?.startsWith('project:') && candidate.origin !== `project:${candidate.projectId}`) {
    return {
      mediaId: candidate.mediaId,
      accepted: false,
      score: 0,
      rejectionCode: 'cross_project_cache_leak',
      reason: `Ativo pertence a outro projeto (${candidate.origin}).`,
      sampledTimestampsSec,
      matchedEntities: [],
      visualCategory: candidate.visualCategoryHint ?? 'unknown',
    };
  }

  // 2. Distributed frame analysis (VisionRouter / caller hook) + 2nd dense pass on promising intervals
  let frameAnalyses: DistributedFrameAnalysis[] = [];
  let visualVerificationError: string | undefined;
  if (options?.analyzeFrames) {
    try {
      frameAnalyses = await options.analyzeFrames(candidate.uri, sampledTimestampsSec, segment);
    } catch (err) {
      frameAnalyses = [];
      visualVerificationError = (err as Error).message;
    }

    if (frameAnalyses.length > 0 && candidate.durationSec >= 5) {
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

      if (promisingAnchors.length > 0 && promisingAnchors.length < initialValid.length + 1) {
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
          } catch {
            // Keep initial distributed frames if dense refinement fails
          }
        }
      }
    }
  }

  const dominantVisualCategory: VisualCategory =
    frameAnalyses.length > 0
      ? frameAnalyses.reduce<Record<string, number>>((acc, f) => {
          acc[f.visualCategory] = (acc[f.visualCategory] ?? 0) + 1;
          return acc;
        }, {}) &&
        (Object.entries(
          frameAnalyses.reduce<Record<string, number>>((acc, f) => {
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
      ...frameAnalyses.map(
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
      !/não foi possível inspecionar|nenhum conteúdo visual|nada visível|unable to inspect|cannot read|blockReadsOutsideWorkingDirectories/i.test(
        f.description ?? '',
      ),
  );
  const visualEvidence = frameAnalyses.map((f) => ({
    timestampSec: f.timestampSec,
    description: f.description ?? '',
    detectedEntities: f.detectedEntities ?? [],
    detectedActions: f.detectedActions ?? [],
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
      `${f.description ?? ''} ${(f.detectedEntities ?? []).join(' ')} ${(f.detectedActions ?? []).join(' ')}`
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase(),
    );

  const perFrameMatches = validVisualFrames.map((frame) => {
    const fText = normalizeFrameText(frame);
    const fTopicEntities = extractTopicEntities(fText);
    const fEntities = expectedEntities.filter(
      (entity) => fText.includes(entity) || fTopicEntities.includes(entity),
    );
    const fActions = expectation.actionsAndEvents.filter((actionKey) => {
      const pattern = NARRATIVE_ACTION_PATTERNS.find((p) => p.key === actionKey);
      return (frame.detectedActions ?? []).includes(actionKey) || Boolean(pattern?.regex.test(fText));
    });
    const isEventMatch =
      expectation.actionsAndEvents.length > 0
        ? fActions.length > 0 && (fEntities.length > 0 || fTopicEntities.length > 0)
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
  const matchedEntities =
    validVisualFrames.length > 0
      ? Array.from(new Set(perFrameMatches.flatMap((m) => m.fEntities)))
      : expectedEntities.filter((entity) => combinedText.includes(entity) || candidateEntities.includes(entity));
  const matchedActions =
    validVisualFrames.length > 0
      ? Array.from(new Set(perFrameMatches.flatMap((m) => m.fActions)))
      : expectation.actionsAndEvents.filter((actionKey) => {
          const pattern = NARRATIVE_ACTION_PATTERNS.find((p) => p.key === actionKey);
          const inFrames = frameAnalyses.some((f) => f.detectedActions?.includes(actionKey));
          return inFrames || Boolean(pattern?.regex.test(combinedText));
        });
  const universeEntities = extractTopicEntities(segment.prompt);
  const matchedUniverseEntities = universeEntities.filter(
    (entity) => combinedText.includes(entity) || candidateEntities.includes(entity),
  );

  const expectsAnime = segmentExpectsAnime(segment);
  const allowsRealPerson = segmentAllowsRealPerson(segment);

  // 3. Reject unrelated real-person footage when script expects anime/animation (while allowing interviews/BTS/live-action when justified)
  if (
    expectsAnime &&
    !allowsRealPerson &&
    (dominantVisualCategory === 'real_person_camera' ||
      frameAnalyses.some((f) => f.visualCategory === 'real_person_camera' && f.confidence >= 0.6))
  ) {
    return {
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
    };
  }

  // 4. For anime content, validate specific work/character/context OR same narrative universe — never accept generic anime-style blindly
  if (expectsAnime && expectedEntities.length > 0 && matchedEntities.length === 0 && matchedUniverseEntities.length === 0) {
    const isGenericAnime = dominantVisualCategory === 'anime_animation';
    return {
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
    };
  }

  // 5. General entity overlap check for non-anime topics (e.g., different games)
  if (
    !expectsAnime &&
    expectedEntities.length >= 2 &&
    matchedEntities.length === 0 &&
    matchedUniverseEntities.length === 0 &&
    candidateEntities.length > 0
  ) {
    return {
      mediaId: candidate.mediaId,
      accepted: false,
      score: 0.15,
      relevanceTier: 'rejected',
      correspondenceLevel: 'rejected',
      visualVerificationStatus,
      visualConfidence,
      visualEvidence,
      rejectionCode: 'wrong_game_or_topic',
      reason: `Mídia incompatível com o tema/jogo esperado (${expectedEntities.slice(0, 4).join(', ')}).`,
      sampledTimestampsSec,
      matchedEntities: [],
      visualCategory: dominantVisualCategory,
    };
  }

  // 6. Strict visual verification gate when required (metadata alone is never visual proof)
  if (options?.requireVisualVerification && visualVerificationStatus === 'unverified_metadata_only') {
    return {
      mediaId: candidate.mediaId,
      accepted: false,
      score: 0.3,
      relevanceTier: 'rejected',
      correspondenceLevel: 'unverified',
      visualVerificationStatus,
      ...(visualVerificationError ? { visualVerificationError } : {}),
      visualConfidence: 0,
      visualEvidence: [],
      rejectionCode: 'unverified_no_visual_evidence',
      reason: visualVerificationError
        ? `Falha na verificação visual (${visualVerificationError.slice(0, 160)}): mídia mantida sem aprovação.`
        : 'Não verificada visualmente: apenas metadados disponíveis sem análise de frames distribuídos.',
      sampledTimestampsSec,
      matchedEntities,
      visualCategory: dominantVisualCategory,
    };
  }

  const isSameUniverseOnly = matchedEntities.length === 0 && matchedUniverseEntities.length > 0;
  const missingSpecificVisualEvent =
    expectation.requiresSpecificEventVisual &&
    validVisualFrames.length > 0 &&
    eventMatchingFrames.length === 0;
  // Same universe (or even shared protagonist) without visually depicting the required specific event -> cannot satisfy coverage!
  if ((isSameUniverseOnly || missingSpecificVisualEvent) && expectation.requiresSpecificEventVisual) {
    const contextEntities = matchedEntities.length > 0 ? matchedEntities : matchedUniverseEntities;
    return {
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
    };
  }

  const effectiveMatched = matchedEntities.length > 0 ? matchedEntities : matchedUniverseEntities;
  const correspondenceLevel: MediaCorrespondenceLevel =
    matchedEntities.length > 0 && (!expectation.requiresSpecificEventVisual || matchedActions.length > 0)
      ? 'exact_match'
      : 'contextual_support';

  const entityScore = isSameUniverseOnly
    ? 0.6
    : expectedEntities.length > 0
      ? Math.min(1, matchedEntities.length / Math.min(3, expectedEntities.length))
      : 0.6;
  const visualBonus =
    expectsAnime && dominantVisualCategory === 'anime_animation'
      ? 0.25
      : !expectsAnime && dominantVisualCategory !== 'unknown'
        ? 0.15
        : 0;
  const score = Number(Math.min(1, 0.2 + entityScore * 0.6 + visualBonus).toFixed(2));

  if (score < 0.35) {
    return {
      mediaId: candidate.mediaId,
      accepted: false,
      score,
      relevanceTier: 'rejected',
      correspondenceLevel: 'rejected',
      visualVerificationStatus,
      visualConfidence,
      visualEvidence,
      rejectionCode: 'insufficient_metadata_and_visual_match',
      reason: 'Evidência visual e de metadados insuficiente para confirmar relevância.',
      sampledTimestampsSec,
      matchedEntities: effectiveMatched,
      visualCategory: dominantVisualCategory,
    };
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

  const matchedIntervals =
    groupedIntervals.length > 0
      ? groupedIntervals.map(({ startSec, endSec, segmentId, provingTimestampsSec, provingDescriptions }) => ({
          startSec,
          endSec,
          segmentId,
          provingTimestampsSec,
          provingDescriptions,
        }))
      : [{ startSec: 0, endSec: Number(candidate.durationSec.toFixed(2)), segmentId: segment.segmentId }];

  return {
    mediaId: candidate.mediaId,
    accepted: true,
    score,
    relevanceTier: isSameUniverseOnly ? 'same_universe_context' : 'exact_segment_match',
    correspondenceLevel,
    visualVerificationStatus,
    visualConfidence,
    visualEvidence,
    matchedActions,
    matchedIntervals,
    eligibleSegmentIds: [segment.segmentId],
    reason:
      correspondenceLevel === 'contextual_support'
        ? `Apoio contextual do mesmo universo (${effectiveMatched.slice(0, 4).join(', ')}); verificação visual: ${visualVerificationStatus}.`
        : `Correspondência exata (${effectiveMatched.slice(0, 4).join(', ')}) em ${sampledTimestampsSec.length} frames distribuídos (${visualVerificationStatus}).`,
    sampledTimestampsSec,
    matchedEntities: effectiveMatched,
    visualCategory: dominantVisualCategory,
  };
}
