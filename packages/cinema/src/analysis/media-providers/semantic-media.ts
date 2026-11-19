import { isAnimeSubjectOrGenre } from '../anime-source-adapters.js';
import type { MediaClassification, MediaProviderKey, ProviderMediaItem, SceneSourceContext } from './types.js';

/**
 * Semantic media contracts.
 *
 * Five independent dimensions that the acquisition pipeline used to collapse into one "class vs. scene intent" check:
 *
 * - **Content domain** of the project/scene (anime, game, movie…). It decides which sources are worth asking.
 *   The narrative format (`gameplay_essay`, `top_list`, `documentary`) is NOT a domain: a top list can be about anime.
 * - **Media type** of a result (anime footage, gameplay, stock…), decided from the item's own evidence. A YouTube
 *   video without signals is `unknown`, never `stock_video`.
 * - **Identity**: expected work vs. detected work, with confidence, evidence and ambiguities. A title is a hint, never
 *   proof; the provider's own record or the visual analysis decide.
 * - **Editorial role**: literal evidence of the narrated event vs. contextual b-roll / transition / background.
 * - **Provenance and rights**: what the provider attests. Rights are never inferred from relevance or from the title.
 */

export type ContentDomain = 'anime' | 'game' | 'movie' | 'series' | 'technology' | 'documentary' | 'generic';

export type MediaType =
  | 'anime_footage'
  | 'gameplay'
  | 'game_trailer'
  | 'movie_footage'
  | 'promotional_artwork'
  | 'screenshot'
  | 'stock_video'
  | 'image'
  | 'unknown';

export type EditorialRole = 'literal_evidence' | 'contextual_broll' | 'transition' | 'background';

export interface WorkReference {
  /** Canonical title of the work the scene is about (e.g. "Frieren: Beyond Journey's End"). */
  canonicalTitle?: string;
  /** Other titles of the same work (romaji, localized, abbreviations). */
  alternativeTitles?: string[];
  characters?: string[];
  /** Event/moment the narration describes (e.g. "Frieren vs. clone"). */
  event?: string;
  /** Preferred language for search (ISO-ish: 'pt', 'en', 'ja'). */
  language?: string;
}

export interface DomainInference {
  domain: ContentDomain;
  confidence: number;
  evidence: string[];
  /** True when two domains had comparable evidence; routing then prefers sources common to both. */
  ambiguous: boolean;
}

export type IdentityStatus = 'confirmed_by_provider' | 'confirmed_by_analysis' | 'probable' | 'unknown' | 'mismatch' | 'not_required';

export interface IdentityAssessment {
  expectedWorks: string[];
  detectedWork?: string;
  status: IdentityStatus;
  confidence: number;
  evidence: string[];
  ambiguities: string[];
  /** The title alone never proves identity: frames (or a provenance lookup) must confirm. */
  requiresVisualConfirmation: boolean;
}

export interface RightsAssessment {
  origin: { provider: MediaProviderKey; pageUrl: string; channel?: string; apiEndpoint: string };
  /** Rights holder only when the provider's license metadata states it (CC/stock author). */
  owner?: string;
  ownerSource: 'provider_license_metadata' | 'unknown';
  licenseId: string;
  restrictions: string[];
  /** Permissions attested by the provider's license metadata — never by relevance, channel name or title. */
  verifiedPermissions: Array<'commercial_use' | 'automated_download' | 'derivatives'>;
  basis: 'provider_license_metadata' | 'publisher_channel_match' | 'none';
  requiresReview: boolean;
  inferredFromTitle: false;
}

export type CandidateVerdict = 'rejected' | 'pending_analysis';

export type CandidateRejectionCode =
  | 'class_not_allowed_for_scene'
  | 'ai_generated_for_identity_scene'
  | 'low_classification_confidence'
  | 'subject_mismatch';

export interface MediaCandidateAssessment {
  domain: ContentDomain;
  mediaType: MediaType;
  mediaTypeConfidence: number;
  identity: IdentityAssessment;
  /** Highest role this item may take before frames are analysed; literal evidence still needs visual proof. */
  maxEditorialRole: EditorialRole;
  /** Whether the item, once verified, could prove the narrated scene literally. */
  canProveScene: boolean;
  narrativeCorrespondence: 'event_in_metadata' | 'work_only' | 'none' | 'not_applicable';
  rights: RightsAssessment;
  verdict: CandidateVerdict;
  rejectionCode?: CandidateRejectionCode;
  reasons: string[];
  /** Classification is uncertain: kept for analysis instead of being rejected. */
  uncertain: boolean;
}

// ---------------------------------------------------------------------------------------------------------------
// Text helpers

export const normalizeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'from', 'dos', 'das', 'del', 'los', 'las', 'une', 'des', 'nos', 'uma', 'por', 'com', 'que', 'vs', 'no', 'na', 'de', 'da', 'do']);

export function significantTokens(value: string): string[] {
  return normalizeText(value)
    .split(' ')
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Whole-word match: every significant token of `name` appears as a word in `text` (so "Magi" ≠ "Magicka"). */
export function mentionsName(text: string, name: string): boolean {
  const words = new Set(normalizeText(text).split(' '));
  const tokens = significantTokens(name);
  if (tokens.length === 0) return false;
  return tokens.every((t) => words.has(t));
}

// ---------------------------------------------------------------------------------------------------------------
// Domain inference

const DOMAIN_PATTERNS: Record<Exclude<ContentDomain, 'generic'>, RegExp> = {
  anime:
    /\b(animes?|mang[aá]s?|manhwas?|shonen|shounen|seinen|shoujo|shojo|isekai|light novel|otaku|sakuga|ovas?|crunchyroll|ufotable|madhouse|mappa|kyoto animation|toei animation|studio ghibli|ghibli|waifu|anim[eê] (?:dublado|legendado)|epis[oó]dio do anime|cour)\b/gi,
  game:
    /\b(games?|jogos?|videogames?|video games?|gameplay|gamer|rpgs?|fps|mmorpg|playstation|ps[45]|xbox|nintendo|switch 2|steam|dlcs?|console|speedrun|boss fight|elden ring|zelda|gta|witcher|halo|mario|minecraft|fortnite|cyberpunk 2077)\b/gi,
  movie: /\b(filmes?|movies?|cinema|longa[- ]metragem|hollywood|bilheteria|box office|oscar|blockbuster)\b/gi,
  series: /\b(s[eé]ries?|tv shows?|sitcom|showrunner|temporadas?|hbo|netflix series|minis[eé]rie)\b/gi,
  technology:
    /\b(tecnologia|technology|tech|computador|computer|smartphone|celular|intelig[eê]ncia artificial|artificial intelligence|programa[cç][aã]o|coding|data center|servidor(?:es)?|software|hardware|chip|semicondutor)\b/gi,
  documentary: /\b(document[aá]rios?|documentary|hist[oó]ria real|true story|segunda guerra|world war|civiliza[cç][aã]o|arqueologia)\b/gi,
};

/** Genres that ARE content domains (legacy values). Narrative formats such as `gameplay_essay`/`top_list` are not. */
const DOMAIN_GENRES: Record<string, ContentDomain> = { anime: 'anime', anime_essay: 'anime', gaming: 'game' };

function countMatches(re: RegExp, text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(re)) found.add(m[0].toLowerCase());
  return [...found];
}

/**
 * Infers the content domain from the briefing and scene text. Explicit `projectDomain` wins; a domain-bearing genre is
 * strong evidence; the narrative format is at most a weak hint (`gameplay_essay` → +1 game).
 */
export function inferContentDomain(context: SceneSourceContext & { query?: string }): DomainInference {
  if (context.projectDomain) {
    const normalizedDomain = String(context.projectDomain) === 'gaming' ? 'game' : context.projectDomain;
    return { domain: normalizedDomain, confidence: 1, evidence: [`Domínio declarado no briefing: ${normalizedDomain}.`], ambiguous: false };
  }
  const work = context.work;
  const projectText = context.prompt ?? '';
  const sceneText = [context.narrationText, context.query, ...(context.entities ?? []), work?.canonicalTitle, ...(work?.alternativeTitles ?? [])]
    .filter(Boolean)
    .join(' ');
  const scores: Record<ContentDomain, number> = { anime: 0, game: 0, movie: 0, series: 0, technology: 0, documentary: 0, generic: 0 };
  const evidence: string[] = [];
  for (const [domain, re] of Object.entries(DOMAIN_PATTERNS) as Array<[Exclude<ContentDomain, 'generic'>, RegExp]>) {
    // The briefing defines the project; scene text refines it. Briefing terms weigh double.
    const p = countMatches(re, projectText);
    const s = countMatches(re, sceneText).filter((t) => !p.includes(t));
    const score = p.length * 2 + s.length;
    if (score > 0) {
      scores[domain] += score;
      evidence.push(`${domain}: ${[...p, ...s].slice(0, 4).join(', ')}`);
    }
  }
  // Known-work hints (detection only, never approval) for anime.
  if (isAnimeSubjectOrGenre(`${projectText} ${sceneText}`)) {
    scores.anime += 1;
  }
  const genre = context.genre ?? '';
  const genreDomain = DOMAIN_GENRES[genre];
  if (genreDomain) {
    scores[genreDomain] += 3;
    evidence.push(`gênero "${genre}" indica domínio ${genreDomain}`);
  } else if (genre === 'gameplay_essay') {
    scores.game += 1;
    evidence.push('formato narrativo gameplay_essay (sinal fraco de jogo; formato não é domínio)');
  }
  // Seasons/episodes are shared by anime and series: when anime evidence exists, series terms belong to it.
  if (scores.anime > 0 && scores.series > 0 && scores.anime >= scores.series) scores.series = 0;

  const ranked = (Object.entries(scores) as Array<[Exclude<ContentDomain, 'generic'>, number]>)
    .filter(([d, v]) => v > 0 && d !== ('generic' as ContentDomain))
    .sort((a, b) => b[1] - a[1]);
  const [top, second] = ranked;
  if (!top) {
    return { domain: 'generic', confidence: 0.3, evidence: ['Nenhum sinal de domínio específico.'], ambiguous: false };
  }
  if (second && second[1] === top[1]) {
    // Equal evidence: prefer the domain the briefing itself names; otherwise stay generic (broad, compatible sources).
    const pTop = countMatches(DOMAIN_PATTERNS[top[0]], projectText).length;
    const pSecond = countMatches(DOMAIN_PATTERNS[second[0]], projectText).length;
    if (pTop !== pSecond) {
      const domain = pTop > pSecond ? top[0] : second[0];
      return { domain, confidence: 0.5, evidence: [...evidence, `Empate resolvido pelo briefing (${domain}).`], ambiguous: true };
    }
    return { domain: 'generic', confidence: 0.3, evidence: [...evidence, `Empate entre ${top[0]} e ${second[0]}.`], ambiguous: true };
  }
  const total = ranked.reduce((acc, [, v]) => acc + v, 0);
  return { domain: top[0], confidence: Number(Math.min(1, 0.4 + (top[1] / total) * 0.6).toFixed(2)), evidence, ambiguous: false };
}

const PROMPT_DOMAIN_MAP: Record<string, ContentDomain> = {
  gaming: 'game',
  game: 'game',
  anime: 'anime',
  technology: 'technology',
  documentary: 'documentary',
  movie: 'movie',
  series: 'series',
  general: 'generic',
  generic: 'generic',
};

/**
 * Project domain from the briefing interpretation (`PromptInterpretation.domain`) reconciled with the semantic
 * inference over the prompt and the researched works. The interpretation's regex checks game words before anime
 * words, so an anime prompt that says "jogo"/"boss" would become gaming; a clear, unambiguous inference wins, and the
 * interpretation is used when the inference has no specific signal.
 */
export function resolveProjectDomain(input: { promptDomain?: string; prompt: string; workTitles?: string[]; genre?: string }): DomainInference {
  const inferred = inferContentDomain({
    prompt: input.prompt,
    ...(input.workTitles && input.workTitles.length ? { entities: input.workTitles } : {}),
    ...(input.genre ? { genre: input.genre } : {}),
  });
  const mapped = input.promptDomain ? PROMPT_DOMAIN_MAP[input.promptDomain] : undefined;
  if (inferred.domain !== 'generic' && !inferred.ambiguous) {
    const note = mapped && mapped !== inferred.domain && mapped !== 'generic' ? [`Interpretação do briefing indicou ${mapped}; evidência semântica indica ${inferred.domain}.`] : [];
    return { ...inferred, evidence: [...inferred.evidence, ...note] };
  }
  if (mapped && mapped !== 'generic') {
    return { domain: mapped, confidence: 0.6, evidence: [...inferred.evidence, `Domínio da interpretação do briefing: ${mapped}.`], ambiguous: inferred.ambiguous };
  }
  return inferred;
}

// ---------------------------------------------------------------------------------------------------------------
// Media type

const STOCK_PROVIDERS: ReadonlySet<MediaProviderKey> = new Set(['pexels', 'pixabay', 'mixkit']);

export function isStockProvider(provider: MediaProviderKey): boolean {
  return STOCK_PROVIDERS.has(provider);
}

/**
 * Media type from the item's own evidence (provider + class the adapter derived from metadata). The scene domain only
 * disambiguates trailers on video platforms (a YouTube "trailer" in a movie project is movie footage).
 */
export function deriveMediaType(item: ProviderMediaItem, domain: ContentDomain = 'generic'): { type: MediaType; confidence: number } {
  const c: MediaClassification = item.classification;
  const conf = item.classificationConfidence;
  switch (c) {
    case 'anime_footage':
      return { type: 'anime_footage', confidence: conf };
    case 'authentic_gameplay':
      return { type: 'gameplay', confidence: conf };
    case 'official_game_trailer':
      if (item.provider === 'youtube' && (domain === 'movie' || domain === 'series')) return { type: 'movie_footage', confidence: Math.min(conf, 0.6) };
      return { type: 'game_trailer', confidence: conf };
    case 'official_screenshot':
      return { type: 'screenshot', confidence: conf };
    case 'promotional_artwork':
      return { type: 'promotional_artwork', confidence: conf };
    case 'stock_video':
      // Only stock libraries produce stock video; a video platform result without signals is unknown, not stock.
      return isStockProvider(item.provider) ? { type: 'stock_video', confidence: conf } : { type: 'unknown', confidence: 0 };
    case 'stock_image':
    case 'anime_image':
    case 'anime_reaction_gif':
      return { type: 'image', confidence: conf };
    case 'unclassified_video':
    case 'dataset_media':
    case 'ai_generated':
    default:
      return { type: 'unknown', confidence: 0 };
  }
}

/** Media types that can literally show the narrated scene of a work in each domain. */
const NATIVE_TYPES: Record<ContentDomain, ReadonlySet<MediaType>> = {
  anime: new Set(['anime_footage']),
  game: new Set(['gameplay', 'game_trailer', 'screenshot']),
  movie: new Set(['movie_footage']),
  series: new Set(['movie_footage']),
  technology: new Set(),
  documentary: new Set(),
  generic: new Set(),
};

// ---------------------------------------------------------------------------------------------------------------
// Identity

export function expectedWorksOf(context: SceneSourceContext): string[] {
  const work = context.work;
  const names = [work?.canonicalTitle, ...(work?.alternativeTitles ?? []), ...(context.entities ?? [])]
    .filter((n): n is string => typeof n === 'string' && significantTokens(n).length > 0);
  return [...new Set(names)];
}

export interface ObservedIdentity {
  detectedWork: string;
  confidence: number;
  source: 'vision' | 'provenance_lookup';
}

/**
 * Identity of the item relative to the works the scene expects. Provider records and visual/provenance analysis are
 * evidence; a matching title only makes the identity `probable` and always requires visual confirmation.
 */
/** What identity assessment reads from a result: registry items and plain pipeline candidates (yt-dlp, Sakugabooru). */
export interface IdentitySubject {
  title: string;
  description?: string;
  tags?: readonly string[];
  provenance?: { subject?: { gameTitle?: string; animeTitle?: string } };
}

export function assessIdentity(item: IdentitySubject, context: SceneSourceContext, observed?: ObservedIdentity): IdentityAssessment {
  const expected = expectedWorksOf(context);
  const characters = context.work?.characters ?? [];
  const evidence: string[] = [];
  const ambiguities: string[] = [];
  if (expected.length === 0) {
    return { expectedWorks: [], status: 'not_required', confidence: 0, evidence: ['Cena sem obra/entidade nomeada.'], ambiguities, requiresVisualConfirmation: false };
  }
  const matchesExpected = (name: string) => expected.some((e) => mentionsName(name, e) || mentionsName(e, name));

  const STUDIO_OR_RATING_SPLASH_PATTERN =
    /^(?:rockstar(?:\s+games|\s+north)?|cd\s*projekt(?:\s*red)?|esrb|pegi|nintendo|sega|capcom|ubisoft|activision|bandai\s*namco|square\s*enix|electronic\s*arts|ea\s+games|take[- ]two|sony|microsoft|xbox|playstation|steam|pc|nvidia|geforce|amd|intel|dlss|rtx|trailer|gameplay|official\s+trailer)$/i;

  if (observed) {
    if (matchesExpected(observed.detectedWork)) {
      if (observed.confidence >= 0.6) {
        return {
          expectedWorks: expected,
          detectedWork: observed.detectedWork,
          status: 'confirmed_by_analysis',
          confidence: observed.confidence,
          evidence: [`Análise (${observed.source}) identificou "${observed.detectedWork}".`],
          ambiguities,
          requiresVisualConfirmation: false,
        };
      }
      ambiguities.push(`Análise (${observed.source}) sugere "${observed.detectedWork}" com confiança baixa (${observed.confidence.toFixed(2)}).`);
    } else if (STUDIO_OR_RATING_SPLASH_PATTERN.test(observed.detectedWork.trim())) {
      ambiguities.push(`Análise (${observed.source}) detectou splash de estúdio/classificação ("${observed.detectedWork}"), insuficiente para confirmar ou rejeitar a obra.`);
    } else if (observed.confidence >= 0.6) {
      return {
        expectedWorks: expected,
        detectedWork: observed.detectedWork,
        status: 'mismatch',
        confidence: observed.confidence,
        evidence: [`Análise (${observed.source}) identificou "${observed.detectedWork}", diferente de ${expected.slice(0, 3).join(', ')}.`],
        ambiguities,
        requiresVisualConfirmation: false,
      };
    } else {
      ambiguities.push(`Análise (${observed.source}) sugere outra obra ("${observed.detectedWork}") com confiança baixa.`);
    }
  }

  const asserted = item.provenance?.subject?.gameTitle ?? item.provenance?.subject?.animeTitle;
  if (asserted) {
    if (matchesExpected(asserted)) {
      return {
        expectedWorks: expected,
        detectedWork: asserted,
        status: 'confirmed_by_provider',
        confidence: 0.85,
        evidence: [`Registro do provedor identifica "${asserted}".`],
        ambiguities,
        requiresVisualConfirmation: true,
      };
    }
    return {
      expectedWorks: expected,
      detectedWork: asserted,
      status: 'mismatch',
      confidence: 0.9,
      evidence: [`Registro do provedor identifica "${asserted}", que não corresponde a ${expected.slice(0, 3).join(', ')}.`],
      ambiguities,
      requiresVisualConfirmation: false,
    };
  }

  const metadata = `${item.title} ${item.description ?? ''} ${(item.tags ?? []).join(' ')}`;
  const mentioned = expected.filter((e) => mentionsName(metadata, e));
  const mentionedCharacters = characters.filter((c) => mentionsName(metadata, c));
  if (mentioned.length > 0 || mentionedCharacters.length > 0) {
    evidence.push(`Metadados mencionam ${[...new Set([...mentioned, ...mentionedCharacters])].slice(0, 4).join(', ')} (indício, não prova).`);
    return {
      expectedWorks: expected,
      detectedWork: [...new Set([...mentioned, ...mentionedCharacters])].join(', '),
      status: 'probable',
      confidence: Math.min(0.5, 0.3 + 0.1 * (mentioned.length + mentionedCharacters.length)),
      evidence,
      ambiguities,
      requiresVisualConfirmation: true,
    };
  }
  ambiguities.push('Metadados não mencionam a obra esperada; a identidade será decidida pela análise visual.');
  return { expectedWorks: expected, status: 'unknown', confidence: 0, evidence, ambiguities, requiresVisualConfirmation: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Rights

const ATTESTED_LICENSE_PREFIXES = ['pexels', 'pixabay', 'mixkit', 'cc0', 'cc-by', 'public_domain', 'pd'];

/** Provenance and rights as the provider attests them. Nothing here looks at the title or at relevance. */
export function assessRights(item: ProviderMediaItem): RightsAssessment {
  const lic = item.license;
  const attested = lic.licenseId !== 'unknown' && ATTESTED_LICENSE_PREFIXES.some((p) => lic.licenseId.toLowerCase().startsWith(p));
  const verifiedPermissions: RightsAssessment['verifiedPermissions'] = [];
  if (attested && lic.commercialUse === 'allowed') verifiedPermissions.push('commercial_use');
  if (attested && lic.automatedDownload === 'allowed') verifiedPermissions.push('automated_download');
  if (attested && !/\bnd\b|no[-_]?deriv/i.test(lic.licenseId)) verifiedPermissions.push('derivatives');
  const basis: RightsAssessment['basis'] = attested ? 'provider_license_metadata' : lic.licenseId === 'publisher_promotional' ? 'publisher_channel_match' : 'none';
  const channel = item.provenance.subject?.channelTitle;
  return {
    origin: { provider: item.provider, pageUrl: item.pageUrl, apiEndpoint: item.provenance.apiEndpoint, ...(channel ? { channel } : {}) },
    ...(attested && lic.author ? { owner: lic.author } : {}),
    ownerSource: attested && lic.author ? 'provider_license_metadata' : 'unknown',
    licenseId: lic.licenseId,
    restrictions: [...lic.restrictions],
    verifiedPermissions,
    basis,
    requiresReview: !(attested && verifiedPermissions.includes('commercial_use')),
    inferredFromTitle: false,
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Candidate assessment

export interface CandidatePolicy {
  domain: ContentDomain;
  requiresIdentity: boolean;
  /** Media types the scene can use at all (literal or contextual). */
  allowedMediaTypes: readonly MediaType[];
  /** Legacy classes still enforced for scenes without identity (stock, reaction GIFs, datasets). */
  allowedClasses: readonly MediaClassification[];
  label: string;
}

const GAME_TYPES: ReadonlySet<MediaType> = new Set(['gameplay', 'game_trailer', 'screenshot']);

/**
 * Progressive pre-download assessment. Only near-certain problems reject (AI media for identity scenes, stock for
 * identity scenes, provider-asserted different work, fan concepts); uncertainty is kept for frame analysis.
 */
export function assessCandidate(item: ProviderMediaItem, policy: CandidatePolicy, context: SceneSourceContext): MediaCandidateAssessment {
  const domain = policy.domain;
  const { type: mediaType, confidence: mediaTypeConfidence } = deriveMediaType(item, domain);
  const identity = assessIdentity(item, context);
  const rights = assessRights(item);
  const reasons: string[] = [];
  const uncertain = mediaType === 'unknown' && item.classification !== 'ai_generated';
  const base = { domain, mediaType, mediaTypeConfidence, identity, rights, uncertain };
  const reject = (code: CandidateRejectionCode, reason: string): MediaCandidateAssessment => ({
    ...base,
    maxEditorialRole: 'background',
    canProveScene: false,
    narrativeCorrespondence: 'not_applicable',
    verdict: 'rejected',
    rejectionCode: code,
    reasons: [reason],
  });

  if (policy.requiresIdentity && (item.aiGenerated === true || item.classification === 'ai_generated')) {
    return reject('ai_generated_for_identity_scene', 'Mídia gerada por IA não pode representar obra/personagem real.');
  }
  if (policy.requiresIdentity && (mediaType === 'stock_video' || item.classification === 'stock_image' || item.classification === 'stock_video')) {
    return reject('class_not_allowed_for_scene', `Mídia de banco de stock (${item.provider}) não prova identidade de obra para cena "${policy.label}".`);
  }
  if (!policy.allowedMediaTypes.includes(mediaType) || (!policy.requiresIdentity && !policy.allowedClasses.includes(item.classification))) {
    return reject('class_not_allowed_for_scene', `Tipo ${mediaType} (classe ${item.classification}) não é adequado para cena "${policy.label}".`);
  }
  if (policy.requiresIdentity && mediaType !== 'unknown' && mediaTypeConfidence < 0.2) {
    return reject(
      'low_classification_confidence',
      `Indícios de material não autêntico (fã/conceito; confiança ${mediaTypeConfidence.toFixed(2)} < 0.20).`,
    );
  }
  if (policy.requiresIdentity && identity.status === 'mismatch') {
    return reject('subject_mismatch', identity.evidence[0] ?? 'Identidade incompatível com a cena.');
  }

  // Editorial role ceiling.
  const native = NATIVE_TYPES[domain];
  let maxEditorialRole: EditorialRole;
  let canProveScene = false;
  if (!policy.requiresIdentity) {
    // No work to identify: whether the footage literally shows the narration is decided by frames alone.
    maxEditorialRole = 'literal_evidence';
    canProveScene = true;
    reasons.push('Cena sem identidade obrigatória: correspondência decidida pelos frames.');
  } else if (native.has(mediaType) || (mediaType === 'unknown' && identity.status !== 'unknown')) {
    maxEditorialRole = 'literal_evidence';
    canProveScene = true;
    reasons.push(
      mediaType === 'unknown'
        ? 'Tipo incerto mantido para análise visual; pode comprovar a cena apenas se os frames confirmarem obra e acontecimento.'
        : `Tipo ${mediaType} compatível com domínio ${domain}; comprovação literal exige frames e correspondência com a narração.`,
    );
  } else if (mediaType === 'unknown') {
    maxEditorialRole = 'contextual_broll';
    canProveScene = true;
    reasons.push('Tipo e identidade incertos: mantido para análise visual (sem rejeição antecipada).');
  } else if (domain === 'anime' && GAME_TYPES.has(mediaType)) {
    maxEditorialRole = 'contextual_broll';
    reasons.push('Jogo relacionado a anime não comprova cena do anime; apenas apoio contextual.');
  } else {
    maxEditorialRole = 'contextual_broll';
    reasons.push(`Tipo ${mediaType} não é footage nativa do domínio ${domain}; apenas apoio contextual.`);
  }

  const event = context.work?.event;
  const metadata = `${item.title} ${item.description ?? ''}`;
  const narrativeCorrespondence: MediaCandidateAssessment['narrativeCorrespondence'] = !policy.requiresIdentity
    ? 'not_applicable'
    : event && mentionsName(metadata, event)
      ? 'event_in_metadata'
      : identity.status === 'probable' || identity.status === 'confirmed_by_provider'
        ? 'work_only'
        : 'none';
  if (canProveScene && narrativeCorrespondence !== 'event_in_metadata' && event) {
    reasons.push(`Metadados não citam o acontecimento "${event}": sem confirmação por frames, uso apenas contextual.`);
  }
  if (rights.requiresReview) reasons.push('Direitos não atestados pelo provedor: revisão humana antes de publicar.');

  return { ...base, maxEditorialRole, canProveScene, narrativeCorrespondence, verdict: 'pending_analysis', reasons };
}

// ---------------------------------------------------------------------------------------------------------------
// Semantic queries

export interface SemanticQuery {
  query: string;
  strategy: 'canonical_event' | 'canonical_characters' | 'alternative_title' | 'media_type' | 'language' | 'character_only';
}

const MEDIA_TERMS: Record<ContentDomain, { en: string[]; pt: string[] }> = {
  anime: { en: ['anime scene', 'anime fight scene', 'anime PV'], pt: ['cena anime'] },
  game: { en: ['gameplay', 'official trailer'], pt: ['gameplay'] },
  movie: { en: ['movie scene', 'official trailer'], pt: ['cena filme'] },
  series: { en: ['series scene', 'official trailer'], pt: ['cena série'] },
  technology: { en: ['footage'], pt: [] },
  documentary: { en: ['archival footage'], pt: [] },
  generic: { en: ['footage'], pt: [] },
};

/**
 * Reformulated queries built from the work's canonical/alternative titles, characters, event, desired media type and
 * language. Each carries its strategy so recovery never repeats the same approach. Empty when no work is known.
 */
export function buildSemanticQueries(context: SceneSourceContext, domain: ContentDomain, max = 6): SemanticQuery[] {
  const work = context.work ?? {};
  const entities = (context.entities ?? []).filter((e) => significantTokens(e).length > 0);
  const canonical = work.canonicalTitle ?? entities[0];
  if (!canonical) return [];
  const characters = (work.characters ?? entities.slice(1)).filter((c) => !mentionsName(canonical, c)).slice(0, 2);
  const terms =
    MEDIA_TERMS[domain] ??
    (String(domain) === 'gaming' ? MEDIA_TERMS.game : MEDIA_TERMS.generic);
  const out: SemanticQuery[] = [];
  const seen = new Set<string>();
  const push = (query: string, strategy: SemanticQuery['strategy']) => {
    const q = query.replace(/\s+/g, ' ').trim();
    const key = normalizeText(q);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ query: q, strategy });
  };
  if (work.event) push(`${canonical} ${work.event}`, 'canonical_event');
  if (characters.length) push(`${canonical} ${characters.join(' ')}`, 'canonical_characters');
  for (const alt of work.alternativeTitles ?? []) push(`${alt} ${terms.en[0] ?? ''}`, 'alternative_title');
  for (const term of terms.en) push(`${canonical} ${term}`, 'media_type');
  if (work.language === 'pt') for (const term of terms.pt) push(`${canonical} ${term}`, 'language');
  if (characters.length) push(`${characters[0]} ${terms.en[0] ?? ''}`, 'character_only');
  return out.slice(0, max);
}
