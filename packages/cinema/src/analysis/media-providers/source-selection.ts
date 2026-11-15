import { isAnimeSubjectOrGenre } from '../anime-source-adapters.js';
import { IDENTITY_GRADE_CLASSES } from './classification.js';
import type { MediaClassification, MediaProviderKey, ProviderMediaItem, SceneSourceContext } from './types.js';

/**
 * Context-aware source selection.
 *
 * Decides, per scene, which providers are worth asking and in what order, and which result classes the scene may use.
 * Identity scenes (a named game or character) only accept identity-grade classes; aesthetic similarity is never
 * accepted as proof of identity, so stock or reaction media cannot stand in for them.
 */

export type SceneMediaIntent =
  | 'game_specific'
  | 'game_ranking'
  | 'anime_identity'
  | 'anime_reaction'
  | 'generic_broll'
  | 'dataset_research';

export interface SourcePlan {
  intent: SceneMediaIntent;
  /** Providers to try in order; later ones are fallbacks. */
  providers: MediaProviderKey[];
  /** Providers used for research/metadata only (never as media for this scene). */
  researchProviders: MediaProviderKey[];
  allowedClasses: MediaClassification[];
  requiresIdentity: boolean;
  rationale: string;
}

const GAME_PATTERN =
  /\b(game|games|jogo|jogos|gameplay|boss|chefe|rpg|fps|playstation|ps5|xbox|nintendo|switch|steam|dlc|trailer do jogo|cyberpunk|elden ring|zelda|gta|witcher|halo|mario|souls|minecraft|fortnite)\b/i;
const RANKING_PATTERN = /\b(top\s*\d+|\d+\s+(?:melhores|best|maiores|piores|worst)|ranking|melhores jogos|best games|jogos (?:mais )?(?:aguardados|esperados) |most anticipated|jogos de \d{4}|games of \d{4})\b/i;
const REACTION_PATTERN = /\b(reação|reacao|reaction|meme|emoji|emoção|emocao|vergonha|facepalm|chorando|crying|happy dance|celebra(?:ção|r)|surpres[ao]|shocked|blush|hug|abraço|smug)\b/i;
const DATASET_PATTERN = /\b(dataset|datasets|conjunto de dados|training data|dados de treino)\b/i;
const TECH_GENERIC_PATTERN =
  /\b(tecnologia|technology|tech|computador|computer|smartphone|celular|inteligência artificial|artificial intelligence|programação|coding|data center|servidor|cidade|city|natureza|nature|escritório|office|pessoas|people|negócios|business|ciência|science)\b/i;

const IDENTITY_CLASSES: MediaClassification[] = ['official_game_trailer', 'authentic_gameplay', 'official_screenshot', 'promotional_artwork'];

export function classifySceneIntent(context: SceneSourceContext & { query?: string }): SceneMediaIntent {
  const text = `${context.prompt ?? ''} ${context.narrationText ?? ''} ${context.query ?? ''} ${(context.entities ?? []).join(' ')}`;
  const genre = context.genre ?? '';
  if (DATASET_PATTERN.test(text)) return 'dataset_research';
  const anime = isAnimeSubjectOrGenre(text, genre);
  if (anime) {
    // A reaction beat with no named work/character is the only place reaction GIFs fit.
    const named = (context.entities ?? []).some((e) => e.trim().length >= 3);
    return REACTION_PATTERN.test(`${context.narrationText ?? ''} ${context.query ?? ''}`) && !named ? 'anime_reaction' : 'anime_identity';
  }
  const gaming = genre === 'gameplay_essay' || genre === 'gaming' || genre === 'top_list' || GAME_PATTERN.test(text);
  if (gaming) {
    if (RANKING_PATTERN.test(`${context.prompt ?? ''} ${context.query ?? ''}`) && (context.entities ?? []).length === 0) return 'game_ranking';
    return 'game_specific';
  }
  if (REACTION_PATTERN.test(`${context.narrationText ?? ''} ${context.query ?? ''}`) && /\banime\b/i.test(text)) return 'anime_reaction';
  if (TECH_GENERIC_PATTERN.test(text)) return 'generic_broll';
  return 'generic_broll';
}

export function planSceneSources(context: SceneSourceContext & { query?: string }): SourcePlan {
  const intent = classifySceneIntent(context);
  switch (intent) {
    case 'game_specific':
      return {
        intent,
        providers: ['steam', 'igdb', 'youtube'],
        researchProviders: ['igdb'],
        allowedClasses: IDENTITY_CLASSES,
        requiresIdentity: true,
        rationale: 'Cena sobre um jogo específico: priorizar Steam (trailers/screenshots oficiais), IGDB e YouTube oficial; stock não prova identidade.',
      };
    case 'game_ranking':
      return {
        intent,
        providers: ['steam', 'youtube', 'igdb'],
        researchProviders: ['igdb'],
        allowedClasses: IDENTITY_CLASSES,
        requiresIdentity: true,
        rationale: 'Ranking de jogos: IGDB para pesquisa dos títulos; Steam/YouTube para a mídia de cada jogo.',
      };
    case 'anime_identity':
      return {
        intent,
        providers: ['youtube'],
        researchProviders: [],
        allowedClasses: ['official_game_trailer', 'authentic_gameplay', 'promotional_artwork', 'anime_image'],
        requiresIdentity: true,
        rationale: 'Identidade de obra/personagem de anime: somente fontes oficiais; GIFs de reação não provam identidade.',
      };
    case 'anime_reaction':
      return {
        intent,
        providers: ['nekos_best', 'kawaii_red'],
        researchProviders: [],
        allowedClasses: ['anime_reaction_gif', 'anime_image'],
        requiresIdentity: false,
        rationale: 'Beat de reação/emoção sem personagem nomeado: provedores de reação de anime são apropriados.',
      };
    case 'dataset_research':
      return {
        intent,
        providers: ['huggingface_datasets'],
        researchProviders: ['huggingface_datasets'],
        allowedClasses: ['dataset_media'],
        requiresIdentity: false,
        rationale: 'Pedido explícito de datasets: Hugging Face apenas para descoberta, com licença por dataset.',
      };
    case 'generic_broll':
    default:
      return {
        intent: 'generic_broll',
        providers: ['pexels', 'pixabay'],
        researchProviders: [],
        allowedClasses: ['stock_video', 'stock_image'],
        requiresIdentity: false,
        rationale: 'Cena genérica: bancos de stock (Pexels, Pixabay) com licença conhecida.',
      };
  }
}

export interface SourceFidelityVerdict {
  pass: boolean;
  code?: 'class_not_allowed_for_scene' | 'ai_generated_for_identity_scene' | 'low_classification_confidence' | 'subject_mismatch';
  reason: string;
}

const tokens = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);

/**
 * Pre-download gate: does the item's class and the identity the provider asserts fit the scene?
 * Passing here never approves media — the Media Relevance Gate (frames + vision) still decides.
 */
export function checkSourceFidelity(item: ProviderMediaItem, plan: SourcePlan, context: SceneSourceContext): SourceFidelityVerdict {
  if (plan.requiresIdentity && (item.aiGenerated === true || item.classification === 'ai_generated')) {
    return { pass: false, code: 'ai_generated_for_identity_scene', reason: 'Mídia gerada por IA não pode representar jogo/personagem real.' };
  }
  if (!plan.allowedClasses.includes(item.classification)) {
    return {
      pass: false,
      code: 'class_not_allowed_for_scene',
      reason: `Classe ${item.classification} não é adequada para cena "${plan.intent}".`,
    };
  }
  if (plan.requiresIdentity && IDENTITY_GRADE_CLASSES.has(item.classification) && item.classificationConfidence < 0.6) {
    return {
      pass: false,
      code: 'low_classification_confidence',
      reason: `Origem oficial não comprovada (confiança ${item.classificationConfidence.toFixed(2)} < 0.60).`,
    };
  }
  const asserted = item.provenance.subject?.gameTitle ?? item.provenance.subject?.animeTitle;
  const expected = (context.entities ?? []).filter((e) => e.trim().length >= 3);
  if (plan.requiresIdentity && asserted && expected.length > 0) {
    const assertedTokens = new Set(tokens(asserted));
    const overlap = expected.some((e) => tokens(e).some((t) => assertedTokens.has(t)));
    if (!overlap) {
      return {
        pass: false,
        code: 'subject_mismatch',
        reason: `Provedor identifica "${asserted}", que não corresponde às entidades da cena (${expected.slice(0, 3).join(', ')}).`,
      };
    }
  }
  return { pass: true, reason: 'Classe e identidade declarada compatíveis com a cena (sujeito ainda à validação visual).' };
}
