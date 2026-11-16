import type { MediaClassification, MediaProviderKey, ProviderMediaItem, SceneSourceContext } from './types.js';
import {
  assessCandidate,
  inferContentDomain,
  type CandidateRejectionCode,
  type ContentDomain,
  type DomainInference,
  type MediaCandidateAssessment,
  type MediaType,
} from './semantic-media.js';

/**
 * Context-aware source selection.
 *
 * The content domain (anime, game, movie…) decides which providers are worth asking; the narrative format
 * (`gameplay_essay`, `top_list`) never does. Identity scenes accept only identity-capable media, but an uncertain
 * classification is kept for frame analysis instead of being rejected. Aesthetic or textual similarity is never
 * accepted as proof of identity.
 */

export type SceneMediaIntent =
  | 'game_specific'
  | 'game_ranking'
  | 'anime_identity'
  | 'anime_reaction'
  /** A named movie/series. */
  | 'screen_identity'
  /** A named subject whose domain is unknown or ambiguous: broad, domain-neutral sources first. */
  | 'named_subject'
  | 'generic_broll'
  | 'dataset_research';

export interface SourcePlan {
  intent: SceneMediaIntent;
  domain: ContentDomain;
  domainInference: DomainInference;
  /** Providers to try in order; later ones are fallbacks. */
  providers: MediaProviderKey[];
  /** Providers used for research/metadata only (never as media for this scene). */
  researchProviders: MediaProviderKey[];
  /** Legacy classes, still enforced for scenes without identity (stock, reaction GIFs, datasets). */
  allowedClasses: MediaClassification[];
  allowedMediaTypes: MediaType[];
  requiresIdentity: boolean;
  rationale: string;
}

const RANKING_PATTERN = /\b(top\s*\d+|\d+\s+(?:melhores|best|maiores|piores|worst)|ranking|melhores jogos|best games|jogos (?:mais )?(?:aguardados|esperados) |most anticipated|jogos de \d{4}|games of \d{4})\b/i;
const REACTION_PATTERN = /\b(reação|reacao|reaction|meme|emoji|emoção|emocao|vergonha|facepalm|chorando|crying|happy dance|celebra(?:ção|r)|surpres[ao]|shocked|blush|hug|abraço|smug)\b/i;
const DATASET_PATTERN = /\b(dataset|datasets|conjunto de dados|training data|dados de treino)\b/i;

const IDENTITY_CLASSES: MediaClassification[] = ['official_game_trailer', 'authentic_gameplay', 'official_screenshot', 'promotional_artwork'];

const namedEntities = (context: SceneSourceContext) =>
  [context.work?.canonicalTitle, ...(context.entities ?? [])].filter((e): e is string => typeof e === 'string' && e.trim().length >= 3);

export function classifySceneIntent(context: SceneSourceContext & { query?: string }, inference: DomainInference = inferContentDomain(context)): SceneMediaIntent {
  const text = `${context.prompt ?? ''} ${context.narrationText ?? ''} ${context.query ?? ''} ${(context.entities ?? []).join(' ')}`;
  if (DATASET_PATTERN.test(text)) return 'dataset_research';
  const named = namedEntities(context).length > 0;
  switch (inference.domain) {
    case 'anime':
      // A reaction beat with no named work/character is the only place reaction GIFs fit.
      return REACTION_PATTERN.test(`${context.narrationText ?? ''} ${context.query ?? ''}`) && !named ? 'anime_reaction' : 'anime_identity';
    case 'game':
      if (RANKING_PATTERN.test(`${context.prompt ?? ''} ${context.query ?? ''}`) && (context.entities ?? []).length === 0) return 'game_ranking';
      return 'game_specific';
    case 'movie':
    case 'series':
      return named ? 'screen_identity' : 'generic_broll';
    case 'technology':
    case 'documentary':
      return 'generic_broll';
    case 'generic':
    default:
      // Unknown or ambiguous domain with a named subject: domain-neutral sources, never game sources by default.
      return named ? 'named_subject' : 'generic_broll';
  }
}

export function planSceneSources(context: SceneSourceContext & { query?: string }): SourcePlan {
  const domainInference = inferContentDomain(context);
  const intent = classifySceneIntent(context, domainInference);
  const base = { intent, domain: domainInference.domain, domainInference };
  switch (intent) {
    case 'game_specific':
      return {
        ...base,
        providers: ['steam', 'igdb', 'youtube'],
        researchProviders: ['igdb'],
        allowedClasses: IDENTITY_CLASSES,
        allowedMediaTypes: ['gameplay', 'game_trailer', 'screenshot', 'promotional_artwork', 'unknown', 'anime_footage'],
        requiresIdentity: true,
        rationale: 'Cena sobre um jogo específico: priorizar Steam (trailers/screenshots oficiais), IGDB e YouTube; stock não prova identidade.',
      };
    case 'game_ranking':
      return {
        ...base,
        providers: ['steam', 'youtube', 'igdb'],
        researchProviders: ['igdb'],
        allowedClasses: IDENTITY_CLASSES,
        allowedMediaTypes: ['gameplay', 'game_trailer', 'screenshot', 'promotional_artwork', 'unknown'],
        requiresIdentity: true,
        rationale: 'Ranking de jogos: IGDB para pesquisa dos títulos; Steam/YouTube para a mídia de cada jogo.',
      };
    case 'anime_identity':
      return {
        ...base,
        providers: ['youtube'],
        researchProviders: [],
        allowedClasses: ['anime_footage', 'promotional_artwork', 'anime_image'],
        allowedMediaTypes: ['anime_footage', 'unknown', 'promotional_artwork', 'image', 'gameplay', 'game_trailer'],
        requiresIdentity: true,
        rationale:
          'Domínio anime: footage da obra no YouTube (canal oficial aumenta a confiança; uploads de terceiros seguem para verificação por frames e revisão de direitos). Steam/IGDB não são consultados; jogos derivados só servem de apoio contextual.',
      };
    case 'screen_identity':
      return {
        ...base,
        providers: ['youtube'],
        researchProviders: [],
        allowedClasses: [],
        allowedMediaTypes: ['movie_footage', 'unknown', 'promotional_artwork', 'image'],
        requiresIdentity: true,
        rationale: 'Filme/série nomeado: trailers e canais oficiais no YouTube; identidade confirmada por frames.',
      };
    case 'named_subject':
      return {
        ...base,
        providers: ['youtube', 'pexels', 'pixabay'],
        researchProviders: [],
        allowedClasses: [],
        allowedMediaTypes: ['anime_footage', 'gameplay', 'game_trailer', 'movie_footage', 'screenshot', 'promotional_artwork', 'image', 'unknown'],
        requiresIdentity: true,
        rationale: 'Assunto nomeado com domínio incerto: YouTube primeiro (fonte comum a todos os domínios); stock não prova identidade.',
      };
    case 'anime_reaction':
      return {
        ...base,
        providers: ['nekos_best', 'kawaii_red'],
        researchProviders: [],
        allowedClasses: ['anime_reaction_gif', 'anime_image'],
        allowedMediaTypes: ['image'],
        requiresIdentity: false,
        rationale: 'Beat de reação/emoção sem personagem nomeado: provedores de reação de anime são apropriados.',
      };
    case 'dataset_research':
      return {
        ...base,
        providers: ['huggingface_datasets'],
        researchProviders: ['huggingface_datasets'],
        allowedClasses: ['dataset_media'],
        allowedMediaTypes: ['unknown'],
        requiresIdentity: false,
        rationale: 'Pedido explícito de datasets: Hugging Face apenas para descoberta, com licença por dataset.',
      };
    case 'generic_broll':
    default:
      return {
        ...base,
        intent: 'generic_broll',
        providers: ['pexels', 'pixabay'],
        researchProviders: [],
        allowedClasses: ['stock_video', 'stock_image'],
        allowedMediaTypes: ['stock_video', 'image'],
        requiresIdentity: false,
        rationale: `Cena genérica (domínio ${domainInference.domain}): bancos de stock (Pexels, Pixabay) com licença conhecida.`,
      };
  }
}

export interface SourceFidelityVerdict {
  pass: boolean;
  code?: CandidateRejectionCode;
  reason: string;
  assessment: MediaCandidateAssessment;
}

/**
 * Pre-download gate: media type, identity and rights of the item against the scene plan.
 * Passing here never approves media — the Media Relevance Gate (frames + vision) still decides.
 */
export function checkSourceFidelity(item: ProviderMediaItem, plan: SourcePlan, context: SceneSourceContext): SourceFidelityVerdict {
  const assessment = assessCandidate(
    item,
    { domain: plan.domain, requiresIdentity: plan.requiresIdentity, allowedMediaTypes: plan.allowedMediaTypes, allowedClasses: plan.allowedClasses, label: plan.intent },
    context,
  );
  if (assessment.verdict === 'rejected') {
    return { pass: false, ...(assessment.rejectionCode ? { code: assessment.rejectionCode } : {}), reason: assessment.reasons[0] ?? 'Rejeitado.', assessment };
  }
  return {
    pass: true,
    reason: `Candidato mantido para análise (${assessment.mediaType}; papel máximo ${assessment.maxEditorialRole}; identidade ${assessment.identity.status}).`,
    assessment,
  };
}
