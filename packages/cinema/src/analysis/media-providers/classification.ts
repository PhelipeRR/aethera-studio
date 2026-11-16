import type { MediaClassification, MediaKind, MediaProviderKey } from './types.js';

/**
 * Editorial classification of provider results.
 *
 * The provider's own provenance (a Steam store page, an IGDB game record) is the strongest evidence. Titles and tags
 * only refine it. Any AI-generation signal overrides every other class: AI media is never an official screenshot or
 * authentic gameplay, whatever its source claims.
 */

export type ProviderAssetHint =
  | 'steam_movie'
  | 'steam_screenshot'
  | 'steam_store_art'
  | 'igdb_video'
  | 'igdb_screenshot'
  | 'igdb_artwork'
  | 'igdb_cover'
  | 'youtube_video'
  | 'stock_photo'
  | 'stock_illustration'
  | 'stock_video'
  | 'stock_animation'
  | 'anime_gif'
  | 'anime_image'
  | 'dataset';

export interface ClassificationInput {
  provider: MediaProviderKey;
  hint: ProviderAssetHint;
  kind: MediaKind;
  title?: string;
  description?: string;
  tags?: string[];
  /** Channel / uploader that published the item (YouTube). */
  channelTitle?: string;
  /** Companies known to own the game (IGDB/Steam publishers & developers). */
  officialPublishers?: string[];
  /** The scene is about an anime: classify anime footage instead of forcing trailer/gameplay/stock. */
  animeContext?: boolean;
}

export interface ClassificationResult {
  classification: MediaClassification;
  confidence: number;
  evidence: string[];
  aiGenerated: boolean | 'unknown';
}

const AI_PATTERN =
  /\b(ai[- ]?generated|generated (?:by|with) ai|ai[- ]art|ai[- ]image|generative ai|midjourney|stable[- ]diffusion|dall[- ]?e|sora|runway gen|kling ai|flux(?:\.1)? (?:dev|pro|schnell)|text[- ]to[- ](?:image|video)|gerad[oa] por ia|imagem de ia)\b/i;
const FAN_PATTERN = /\b(fan[- ]?made|fanmade|concept trailer|what if|reimagined|unreal engine 5 (?:fan|concept)|ue5 concept|mod showcase|fan film)\b/i;
const TRAILER_PATTERN = /\b(trailer|teaser|announce(?:ment)?|reveal|launch|cinematic|official)\b/i;
const GAMEPLAY_PATTERN = /\b(gameplay|walkthrough|playthrough|no commentary|longplay|let'?s play|boss fight|first \d+ minutes|demo)\b/i;
const REACTION_PATTERN = /\b(reaction|reacts?|react|review|análise|analise|podcast|tier list|ranking)\b/i;
const ANIME_FOOTAGE_PATTERN =
  /\b(anime|episod(?:e|io)|epis[oó]dio|ep\.?\s*\d+|opening|op\s*\d+|ending|pv|promotional video|trailer|teaser|clip|clipe|scene|cena|fight|luta|batalha|dublado|legendado|sub(?:bed)?|dub(?:bed)?|sakuga|amv)\b/i;
/** Explicit video-game markers: a game adaptation of an anime is a game, not anime footage. */
const GAME_MARKER_PATTERN = /\b(video ?games?|game|gameplay|playthrough|walkthrough|steam|ps[45]|playstation|xbox|nintendo switch|pc gameplay|jogo)\b/i;
/** Markers that only anime footage carries (episode/opening/PV), which outweigh a game marker. */
const STRONG_ANIME_PATTERN = /\b(anime|episod(?:e|io)|epis[oó]dio|ep\.?\s*\d+|opening|ending|pv|sakuga)\b/i;
const AMV_EDIT_PATTERN = /\b(amv|edit|4k edit|twixtor|tiktok|shorts?)\b|#shorts/i;
/** Channels of rights holders / licensed distributors that publish anime footage officially. */
const OFFICIAL_ANIME_CHANNELS = [
  'crunchyroll', 'muse asia', 'muse indonesia', 'ani-one', 'ani one', 'toho animation', 'aniplex', 'toei animation',
  'mappa', 'netflix anime', 'netflix', 'funimation', 'viz media', 'bandai namco filmworks', 'kadokawa', 'pony canyon',
  'tv tokyo', 'sentai', 'hidive', 'medialink', 'warner bros japan', 'tms entertainment', 'shueisha', 'kodansha',
];

function channelIsOfficialAnime(channel: string | undefined): boolean {
  if (!channel) return false;
  const c = norm(channel);
  return OFFICIAL_ANIME_CHANNELS.some((o) => c.includes(norm(o)));
}

const norm = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

export function detectAiGenerated(text: string, tags: readonly string[] = []): boolean {
  return AI_PATTERN.test(text) || tags.some((tag) => AI_PATTERN.test(tag));
}

function channelIsOfficial(channel: string | undefined, publishers: readonly string[] | undefined): boolean {
  if (!channel || !publishers || publishers.length === 0) return false;
  const c = norm(channel);
  if (!c) return false;
  return publishers.some((p) => {
    const n = norm(p);
    if (n.length < 3) return false;
    // "CD PROJEKT RED" ⇄ "CD PROJEKT RED"; "Bandai Namco Entertainment America" ⇄ "BANDAI NAMCO"
    const pFirst = n.split(' ').slice(0, 2).join(' ');
    return c === n || c.includes(n) || n.includes(c) || (pFirst.length >= 5 && c.startsWith(pFirst));
  });
}

export function classifyProviderItem(input: ClassificationInput): ClassificationResult {
  const text = `${input.title ?? ''} ${input.description ?? ''}`;
  const tags = input.tags ?? [];
  const evidence: string[] = [];

  if (detectAiGenerated(text, tags)) {
    evidence.push('Título/tags indicam geração por IA; nunca tratado como oficial ou gameplay real.');
    return { classification: 'ai_generated', confidence: 0.9, evidence, aiGenerated: true };
  }

  switch (input.hint) {
    case 'steam_movie':
      evidence.push('Vídeo publicado na página oficial da loja Steam do jogo.');
      if (GAMEPLAY_PATTERN.test(text) && !TRAILER_PATTERN.test(text)) {
        evidence.push('Nome do vídeo indica gameplay.');
        return { classification: 'authentic_gameplay', confidence: 0.85, evidence, aiGenerated: false };
      }
      return { classification: 'official_game_trailer', confidence: 0.95, evidence, aiGenerated: false };
    case 'steam_screenshot':
      evidence.push('Screenshot publicado pelo desenvolvedor na loja Steam.');
      return { classification: 'official_screenshot', confidence: 0.95, evidence, aiGenerated: false };
    case 'steam_store_art':
      evidence.push('Arte de capa/cabeçalho da loja Steam.');
      return { classification: 'promotional_artwork', confidence: 0.95, evidence, aiGenerated: false };
    case 'igdb_video': {
      evidence.push('Vídeo vinculado ao registro do jogo no IGDB.');
      if (GAMEPLAY_PATTERN.test(text)) {
        return { classification: 'authentic_gameplay', confidence: 0.75, evidence: [...evidence, 'Nome indica gameplay.'], aiGenerated: false };
      }
      return { classification: 'official_game_trailer', confidence: 0.85, evidence, aiGenerated: false };
    }
    case 'igdb_screenshot':
      evidence.push('Screenshot vinculado ao registro do jogo no IGDB (curadoria comunitária).');
      return { classification: 'official_screenshot', confidence: 0.8, evidence, aiGenerated: false };
    case 'igdb_artwork':
    case 'igdb_cover':
      evidence.push('Artwork/capa vinculada ao registro do jogo no IGDB.');
      return { classification: 'promotional_artwork', confidence: 0.8, evidence, aiGenerated: false };
    case 'youtube_video': {
      const official = channelIsOfficial(input.channelTitle, input.officialPublishers);
      const fan = FAN_PATTERN.test(text);
      if (fan) evidence.push('Título indica conteúdo de fã/conceito — não é material oficial.');
      if (official) evidence.push(`Canal "${input.channelTitle}" corresponde a desenvolvedora/publisher conhecida.`);
      else evidence.push('Canal não verificado como oficial.');
      const gameAdaptation = GAME_MARKER_PATTERN.test(text) && !STRONG_ANIME_PATTERN.test(text);
      if (input.animeContext && gameAdaptation) evidence.push('Título indica jogo (adaptação/derivado), não footage do anime.');
      if (input.animeContext && !gameAdaptation && (ANIME_FOOTAGE_PATTERN.test(text) || channelIsOfficialAnime(input.channelTitle))) {
        // Anime footage: an official distributor channel raises confidence; a third-party upload is still candidate
        // footage (identity is decided by frames, not by the uploader), with lower confidence and rights review.
        const officialAnime = channelIsOfficialAnime(input.channelTitle);
        if (officialAnime) evidence.push(`Canal "${input.channelTitle}" é distribuidor/detentor oficial de anime.`);
        const amv = AMV_EDIT_PATTERN.test(text);
        if (amv) evidence.push('Título indica edição/AMV/short (montagem de fã, possível música e cortes).');
        const commentary = REACTION_PATTERN.test(text);
        if (commentary) evidence.push('Título indica react/review/ranking (pode conter comentário ou webcam).');
        return {
          classification: 'anime_footage',
          confidence: fan ? 0.15 : officialAnime ? 0.9 : amv ? 0.3 : commentary ? 0.35 : 0.55,
          evidence: [...evidence, 'Título/canal indicam footage de anime.'],
          aiGenerated: 'unknown',
        };
      }
      if (GAMEPLAY_PATTERN.test(text) && !REACTION_PATTERN.test(text)) {
        return {
          classification: 'authentic_gameplay',
          confidence: fan ? 0.1 : official ? 0.8 : 0.5,
          evidence: [...evidence, 'Título indica gameplay capturado.'],
          aiGenerated: 'unknown',
        };
      }
      if (TRAILER_PATTERN.test(text)) {
        return {
          classification: 'official_game_trailer',
          confidence: fan ? 0.05 : official ? 0.9 : 0.35,
          evidence: [...evidence, 'Título indica trailer.'],
          aiGenerated: 'unknown',
        };
      }
      // A video platform is not a stock library: without signals the type stays open for visual analysis.
      return {
        classification: 'unclassified_video',
        confidence: fan ? 0.1 : 0.3,
        evidence: [...evidence, 'Sem sinais suficientes nos metadados; tipo decidido pela análise visual.'],
        aiGenerated: 'unknown',
      };
    }
    case 'stock_photo':
      return { classification: 'stock_image', confidence: 0.9, evidence: ['Foto de banco de imagens.'], aiGenerated: 'unknown' };
    case 'stock_illustration':
      return { classification: 'stock_image', confidence: 0.7, evidence: ['Ilustração/vetor de banco de imagens.'], aiGenerated: 'unknown' };
    case 'stock_video':
    case 'stock_animation':
      return { classification: 'stock_video', confidence: 0.9, evidence: ['Vídeo de banco de imagens.'], aiGenerated: 'unknown' };
    case 'anime_gif':
      return { classification: 'anime_reaction_gif', confidence: 0.9, evidence: ['GIF de reação de anime.'], aiGenerated: 'unknown' };
    case 'anime_image':
      return { classification: 'anime_image', confidence: 0.85, evidence: ['Imagem de anime de agregador.'], aiGenerated: 'unknown' };
    case 'dataset':
      return { classification: 'dataset_media', confidence: 0.9, evidence: ['Dataset do Hugging Face (licença por dataset, conteúdo não uniforme).'], aiGenerated: 'unknown' };
  }
}

/** Classes that can prove the identity of a specific game/character on screen. */
export const IDENTITY_GRADE_CLASSES: ReadonlySet<MediaClassification> = new Set([
  'anime_footage',
  'official_game_trailer',
  'authentic_gameplay',
  'official_screenshot',
  'promotional_artwork',
]);
