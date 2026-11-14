import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';

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
  description?: string;
  confidence: number;
}

export interface MediaRelevanceDecision {
  mediaId: string;
  accepted: boolean;
  score: number;
  relevanceTier?: 'exact_segment_match' | 'same_universe_context' | 'rejected';
  rejectionCode?:
    | 'unrelated_real_person'
    | 'wrong_anime_or_entity'
    | 'wrong_game_or_topic'
    | 'cross_project_cache_leak'
    | 'generic_anime_style_without_entity'
    | 'insufficient_metadata_and_visual_match';
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
  },
): Promise<MediaRelevanceDecision> {
  const sampledTimestampsSec = sampleDistributedFrameTimestamps(candidate.durationSec, 4);
  const expectedEntities =
    segment.expectedEntities && segment.expectedEntities.length > 0
      ? segment.expectedEntities.map((e) => e.toLowerCase())
      : extractTopicEntities(`${segment.prompt} ${segment.narrationText}`);

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

  // 2. Distributed frame analysis (VisionRouter / caller hook) or metadata inference
  let frameAnalyses: DistributedFrameAnalysis[] = [];
  if (options?.analyzeFrames) {
    try {
      frameAnalyses = await options.analyzeFrames(candidate.uri, sampledTimestampsSec, segment);
    } catch {
      frameAnalyses = [];
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
      ...frameAnalyses.map((f) => `${f.description ?? ''} ${(f.detectedEntities ?? []).join(' ')}`),
    ]
      .join(' ')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase(),
  );

  const candidateEntities = extractTopicEntities(combinedText);
  const matchedEntities = expectedEntities.filter(
    (entity) => combinedText.includes(entity) || candidateEntities.includes(entity),
  );
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
      rejectionCode: 'wrong_game_or_topic',
      reason: `Mídia incompatível com o tema/jogo esperado (${expectedEntities.slice(0, 4).join(', ')}).`,
      sampledTimestampsSec,
      matchedEntities: [],
      visualCategory: dominantVisualCategory,
    };
  }

  const isSameUniverseFallback = matchedEntities.length === 0 && matchedUniverseEntities.length > 0;
  const effectiveMatched = matchedEntities.length > 0 ? matchedEntities : matchedUniverseEntities;
  const entityScore = isSameUniverseFallback
    ? 0.65
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
      rejectionCode: 'insufficient_metadata_and_visual_match',
      reason: 'Evidência visual e de metadados insuficiente para confirmar relevância.',
      sampledTimestampsSec,
      matchedEntities: effectiveMatched,
      visualCategory: dominantVisualCategory,
    };
  }

  return {
    mediaId: candidate.mediaId,
    accepted: true,
    score,
    relevanceTier: isSameUniverseFallback ? 'same_universe_context' : 'exact_segment_match',
    reason: isSameUniverseFallback
      ? `Pertence ao mesmo universo narrativo (${effectiveMatched.slice(0, 4).join(', ')}) do roteiro, embora destaque outro personagem/momento.`
      : effectiveMatched.length > 0
        ? `Relevância confirmada (${effectiveMatched.slice(0, 4).join(', ')}) em ${sampledTimestampsSec.length} frames distribuídos.`
        : 'Relevância contextual compatível.',
    sampledTimestampsSec,
    matchedEntities: effectiveMatched,
    visualCategory: dominantVisualCategory,
  };
}
