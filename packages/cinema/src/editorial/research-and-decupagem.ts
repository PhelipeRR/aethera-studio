import { sha256Hex } from '../ir/sha256.js';
import type { EditorialScript, EditorialSegment } from './editorial-integrity.js';
import {
  buildContextualSceneQueries,
  dedupeEquivalentQueries,
  detectReferenceWorks,
  estimateNarrationSec,
  extractVisualKeywords,
  isMultiWorkPrompt,
  normalizeQueryText,
  translateVisualTerms,
} from './contextual-media-queries.js';

export type PromptDomain = 'gaming' | 'anime' | 'technology' | 'documentary' | 'general';
export type PromptFormatIntent = 'top_ranking' | 'narrative_essay' | 'documentary' | 'trailer';

export type SemanticVisualIntent =
  | 'cinematic_intro'
  | 'cinematic_outro'
  | 'gameplay_showcase'
  | 'cyberware_demonstration'
  | 'stealth_demonstration'
  | 'mobility_demonstration'
  | 'combat_demonstration'
  | 'item_comparison'
  | 'interface_explanation'
  | 'cinematic_transition'
  | 'gameplay_boss_fight'
  | 'product_demonstration'
  | 'hardware_benchmark'
  | 'cinematic_cutscene'
  | 'mechanic_breakdown'
  | 'archival_footage'
  | 'historical_context'
  | 'title_graphic'
  | (string & {});

export interface PromptInterpretation {
  promptHash: string;
  originalPrompt: string;
  workTitle: string;
  domain: PromptDomain;
  theme: string;
  formatIntent: PromptFormatIntent;
  requestedCount?: number;
  rankingCriteria: string[];
  targetDurationSec: number;
  tone: string;
  humorIntensity: number;
  language: string;
  /** The prompt asks for several works (a ranking of animes/games), each ranked entity is its own work. */
  multiWork?: boolean;
  /** Works the prompt uses as a reference point ("para quem gostou de Black Clover"). */
  referenceWorks?: string[];
}

export interface ResearchSourceRef {
  title: string;
  kind: 'official' | 'community' | 'agent_synthesis';
  url?: string;
}

export interface ResearchEntityFact {
  entityName: string;
  workTitle: string;
  role: string;
  rankPosition?: number;
  verifiedFacts: string[];
  mechanicsOrEvents: string[];
  attackPatternsOrPhases?: string[];
  communityConsensus?: string;
  uncertainties: string[];
  sources: ResearchSourceRef[];
}

export interface EditorialResearchDossier {
  dossierId: string;
  dossierHash: string;
  promptHash: string;
  workTitle: string;
  theme: string;
  rankingCriteria: string[];
  entities: ResearchEntityFact[];
  uncertainties: string[];
  sourcesUsed: string[];
  providerUsed?: string;
  prefetchedMetadata?: Array<{
    entityName: string;
    candidateQueries: string[];
    discoveredTitles: string[];
  }>;
  createdAt: string;
}

export interface SemanticSceneCut {
  sceneId: string;
  order: number;
  beatStage: EditorialSegment['stage'];
  narrationText: string;
  workTitle: string;
  entities: string[];
  expectedEvent: string;
  durationSec: number;
  startSec?: number;
  endSec?: number;
  visualIntent: SemanticVisualIntent;
  mediaQueries: string[];
  matchingCriteria: {
    requiredEntities: string[];
    expectedActions: string[];
    minVisualConfidence: number;
  };
  allowedAlternatives: Array<
    'alternate_query' | 'alternate_interval' | 'explanatory_graphic' | 'localized_editorial_adjustment'
  >;
  audioDependencies: {
    sfxCues: string[];
    vfxEffects: string[];
    graphicsHints: string[];
  };
  dependencyHash: string;
  /** Work(s) whose footage may illustrate this scene. Overview scenes accept any of the ranked works. */
  works?: string[];
  /** Characters, techniques or places the narration names (search + identity evidence). */
  visualKeywords?: string[];
  /**
   * How the scene's subject was resolved: `entity` named in the narration, `inherited` from the previous scene
   * (continuation of the same item), `reference` work cited by the prompt, `overview` montage of the ranked works.
   */
  subjectResolution?: 'entity' | 'inherited' | 'reference' | 'overview' | 'none';
  /** Narration length estimate (s) the coverage must match. */
  narrationSec?: number;
}

export interface EditorialRecoveryStep {
  step: 1 | 2 | 3 | 4 | 5;
  action:
    | 'alternate_source_or_query'
    | 'alternate_valid_interval'
    | 'explanatory_graphic_composition'
    | 'localized_editorial_adjustment'
    | 'explicit_pending_media';
  description: string;
  autoApproveMotionVisual: false;
  suggestedQueries?: string[];
}

export interface IncrementalInvalidationReport {
  researchValid: boolean;
  scriptValid: boolean;
  decupagemValid: boolean;
  validSceneIds: string[];
  invalidatedSceneIds: string[];
  reasons: string[];
}

function sha12(value: unknown): string {
  return sha256Hex(JSON.stringify(value)).slice(0, 12);
}

export function interpretProductionPrompt(
  prompt: string,
  options?: {
    genre?: string;
    targetDurationSec?: number;
    humorIntensity?: number;
    language?: string;
  },
): PromptInterpretation {
  const cleaned = prompt.trim();
  const lower = cleaned.toLowerCase();

  // Detect requested item count (e.g., "10 chefes", "top 10", "10 melhores upgrades", "5 produtos")
  const countMatch = /\b(?:top\s+)?(\d{1,2})\s+(?:melhores\s+|maiores\s+|principais\s+|piores\s+)?(?:chefes|bosses|upgrades|implantes|cyberwares|cibern[eé]tic[oa]s?|produtos|tecnologias|ferramentas|recursos|armas|builds|jogos|lutas|momentos|fatos|itens|personagens|batalhas|epis[oó]dios|animes|mang[aá]s|filmes|s[eé]ries|obras|games)\b/iu.exec(cleaned);
  const requestedCount = countMatch?.[1] ? Math.max(1, Math.min(25, Number(countMatch[1]))) : undefined;

  // Detect duration in prompt if not explicitly provided (supports both minutes and seconds)
  let targetDurationSec = options?.targetDurationSec ?? 0;
  if (!targetDurationSec || targetDurationSec <= 0) {
    const minMatch = /(\d+)\s*(?:minutos?|min)\b/i.exec(cleaned);
    const secMatch = /(\d+)\s*(?:segundos?|seg|s)\b/i.exec(cleaned);
    if (minMatch?.[1]) {
      targetDurationSec = Number(minMatch[1]) * 60;
    } else if (secMatch?.[1]) {
      targetDurationSec = Number(secMatch[1]);
    } else {
      targetDurationSec = 180;
    }
  }

  // Detect domain
  let domain: PromptDomain = 'general';
  if (/\b(elden ring|cyberpunk\s*2077|cyberpunk|dark souls|sekiro|bloodborne|witcher|baldur|hollow knight|god of war|zelda|minecraft|gameplay|boss|chefe|cyberware|implante|cibern[eé]tica|jogo|game|soulslike)\b/i.test(lower)) {
    domain = 'gaming';
  } else if (/\b(dragon ball|naruto|one piece|animes?|mang[aá]s?|bleach|jujutsu|attack on titan|black clover|fairy tail|hunter x hunter)\b/i.test(lower)) {
    domain = 'anime';
  } else if (/\b(tecnologia|produto|hardware|software|smartphone|iphone|notebook|laptop|placa de v[ií]deo|gpu|rtx|nvidia|amd|intel|apple|samsung|review|benchmark)\b/i.test(lower)) {
    domain = 'technology';
  } else if (/\b(document[aá]rio|hist[oó]ria|guerra|biografia|ci[eê]ncia|apollo|espa[çc]o|civiliza[çc][ãa]o)\b/i.test(lower)) {
    domain = 'documentary';
  }

  // Extract explicit work title
  let workTitle = '';
  const knownWorks: Array<[RegExp, string]> = [
    [/\belden ring\b/i, 'Elden Ring'],
    [/\bcyberpunk\s*2077\b/i, 'Cyberpunk 2077'],
    [/\bcyberpunk\b/i, 'Cyberpunk 2077'],
    [/\bdragon ball z\b/i, 'Dragon Ball Z'],
    [/\bdragon ball super\b/i, 'Dragon Ball Super'],
    [/\bdragon ball\b/i, 'Dragon Ball'],
    [/\bdark souls\s*(?:3|iii)?\b/i, 'Dark Souls'],
    [/\bsekiro\b/i, 'Sekiro: Shadows Die Twice'],
    [/\bbloodborne\b/i, 'Bloodborne'],
  ];
  for (const [re, canonical] of knownWorks) {
    if (re.test(cleaned)) {
      workTitle = canonical;
      break;
    }
  }
  const multiWork = isMultiWorkPrompt(cleaned);
  const referenceWorks = detectReferenceWorks(cleaned);
  if (multiWork) {
    // A ranking of several works has no single "work": the label is the list's theme, never a search prefix.
    const heading = (cleaned.split(/\r?\n/).find((l) => l.trim().length > 0) ?? cleaned)
      .replace(/^[#\s*]+/, '')
      .replace(/\*+/g, '')
      .replace(/\btop\s*\d+\s*/i, '')
      .replace(/\s*\b(?:para|pra)\s+(?:quem|f[aã]s)\b.*$/i, '')
      .trim();
    workTitle = heading.slice(0, 72) || cleaned.slice(0, 48);
  } else if (!workTitle) {
    const deMatch = /\b(?:de|sobre|do|da|in|of)\s+([A-Z][\wÀ-ÿ]+(?:\s+[A-Z0-9][\wÀ-ÿ]+){0,3})/u.exec(cleaned);
    workTitle = deMatch?.[1]?.trim() || cleaned.slice(0, 48);
  }

  const formatIntent: PromptFormatIntent =
    requestedCount !== undefined || options?.genre === 'top_list' || /\b(ranking|top\s*\d+|mais dif[ií]ceis|melhores)\b/i.test(lower)
      ? 'top_ranking'
      : options?.genre === 'documentary' || domain === 'documentary'
        ? 'documentary'
        : options?.genre === 'trailer'
          ? 'trailer'
          : 'narrative_essay';

  const isBossTheme = /\b(chefe|chefes|boss|bosses|luta|lutas|batalha)\b/i.test(lower);
  const isUpgradeOrTechTheme = /\b(upgrade|upgrades|implante|implantes|cyberware|cibern[eé]tica|build|armas|produto|tecnologia|hardware)\b/i.test(lower);
  const rankingCriteria =
    formatIntent === 'top_ranking'
      ? isBossTheme
        ? [
            'Complexidade mecânica e leitura de padrões de ataque',
            'Transições de fase e punição de erros',
            'Agressividade, alcance e pressão sobre o jogador',
            'Consenso histórico de dificuldade na comunidade',
          ]
        : isUpgradeOrTechTheme
          ? [
              'Impacto prático e ganho de desempenho ou combate',
              'Sinergia com estilos de jogo, builds ou ecossistema',
              'Custo de implementação, limitações e risco operacional',
              'Versatilidade e relevância no estado atual',
            ]
          : [
              'Relevância factual e impacto no tema',
              'Qualidade técnica e consistência de execução',
              'Diferencial prático em relação às alternativas',
            ]
      : ['Relevância factual para o tema', 'Impacto narrativo na obra'];

  const theme = cleaned
    .replace(/\b(crie|faça|gere|produza|monte)\s+(um|uma)\s+v[ií]deo\s*(cinematogr[áa]fico|épico|curto|longo)?\s*(sobre|de)?/gi, '')
    .replace(/\bcom\s+narrativa\s+\w+(?:,\s*humor\s+\w+)?(?:\s+e\s+dura[çc][ãa]o\s+de\s+\d+\s*\w+)?/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  const tone = /\b[eé]pic[ao]\b/i.test(cleaned)
    ? 'épico e cinematográfico'
    : 'analítico e envolvente';

  const language = options?.language ?? 'pt-BR';
  const humorIntensity = options?.humorIntensity ?? (/\bhumor\b/i.test(lower) ? 35 : 0);

  return {
    promptHash: sha12({ cleaned, domain, formatIntent, requestedCount, targetDurationSec, language }),
    originalPrompt: cleaned,
    workTitle,
    domain,
    theme: theme || workTitle,
    formatIntent,
    ...(requestedCount !== undefined ? { requestedCount } : {}),
    rankingCriteria,
    targetDurationSec,
    tone,
    humorIntensity,
    language,
    ...(multiWork ? { multiWork: true } : {}),
    ...(referenceWorks.length > 0 ? { referenceWorks } : {}),
  };
}

/** Multi-work production (ranking of several animes/games), including jobs interpreted before the flag existed. */
export function isMultiWorkProduction(
  interpretation: Pick<PromptInterpretation, 'multiWork' | 'formatIntent' | 'originalPrompt'>,
): boolean {
  return interpretation.multiWork === true || (interpretation.formatIntent === 'top_ranking' && isMultiWorkPrompt(interpretation.originalPrompt));
}

export function validateEditorialResearchDossier(
  dossier: EditorialResearchDossier | null | undefined,
  interpretation: PromptInterpretation,
): { valid: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!dossier) {
    return { valid: false, reasons: ['Dossiê de pesquisa ausente.'] };
  }
  if (!dossier.workTitle.trim()) {
    reasons.push('Obra principal não identificada na pesquisa.');
  }
  if (interpretation.requestedCount && dossier.entities.length < interpretation.requestedCount) {
    reasons.push(
      `Pesquisa retornou ${dossier.entities.length} entidade(s), abaixo das ${interpretation.requestedCount} solicitadas.`,
    );
  }
  const uniqueNames = new Set(dossier.entities.map((e) => e.entityName.trim().toLowerCase()).filter(Boolean));
  if (uniqueNames.size !== dossier.entities.length) {
    reasons.push('Entidades duplicadas no dossiê de pesquisa.');
  }
  if (interpretation.formatIntent === 'top_ranking' && dossier.rankingCriteria.length === 0) {
    reasons.push('Critérios explícitos de ranking ausentes.');
  }
  for (const ent of dossier.entities) {
    if (ent.verifiedFacts.length === 0 && ent.mechanicsOrEvents.length === 0) {
      reasons.push(`Entidade "${ent.entityName}" sem fatos verificáveis ou mecânicas documentadas.`);
    }
    if (ent.entityName.toLowerCase().includes(interpretation.originalPrompt.toLowerCase().slice(0, 30))) {
      reasons.push(`Entidade "${ent.entityName}" repete o prompt bruto em vez de identificar um elemento real.`);
    }
  }
  return { valid: reasons.length === 0, reasons };
}

function cleanEntityForQuery(entityName: string): string {
  return entityName.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeMatchText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

const ENTITY_BILINGUAL_ALIASES: Array<[string, string[]]> = [
  ['mantis blades', ['laminas louva-a-deus', 'laminas mantis', 'mantis blade']],
  ['gorilla arms', ['bracos de gorila', 'braco de gorila']],
  ['projectile launch system', ['sistema de lancamento de projeteis', 'lancador de projeteis', 'lancador no braco']],
  ['optical camo', ['camuflagem optica', 'camuflagem otica']],
  ['monowire', ['fio monomolecular', 'monofio']],
  ['sandevistan', ['sandevistan', 'apogee sandevistan', 'militech falcon']],
  ['kerenzikov', ['kerenzikov']],
  ['cyberdeck', ['ciberdeck', 'cyberdeck', 'netrunner deck', 'tetratronic rippler']],
  ['cyberpsychosis', ['ciberpsicose', 'cyberpsychosis', 'ciberpsicopata']],
  ['reinforced tendons', ['tendoes reforcados', 'salto duplo', 'double jump']],
  ['blood pump', ['bomba de sangue']],
  ['biomonitor', ['biomonitor']],
  ['subdermal armor', ['armadura subdermica', 'pele subdermica']],
];

export function getEntityAliases(entityName: string): string[] {
  const norm = normalizeMatchText(cleanEntityForQuery(entityName));
  const out = new Set<string>([norm]);
  for (const [canonical, aliases] of ENTITY_BILINGUAL_ALIASES) {
    if (norm.includes(canonical) || aliases.some((a) => norm.includes(a))) {
      out.add(canonical);
      for (const a of aliases) out.add(a);
    }
  }
  return [...out];
}

export function classifySceneVisualIntent(input: {
  beat: EditorialSegment;
  entity?: ResearchEntityFact;
  workTitle: string;
  domain: PromptDomain;
  expectedEvent: string;
}): SemanticVisualIntent {
  const text = normalizeMatchText(
    `${input.beat.title} ${input.beat.spokenText} ${input.expectedEvent} ${input.entity?.entityName ?? ''} ${input.entity?.role ?? ''} ${input.entity?.mechanicsOrEvents.join(' ') ?? ''}`,
  );

  if (!input.entity) {
    if (input.beat.stage === 'hook' || input.beat.stage === 'promise') return 'cinematic_intro';
    if (input.beat.stage === 'cta' || input.beat.stage === 'resolution') return 'cinematic_outro';
  }

  if (/\b(stealth|camo|camuflagem|furtiv|infiltra|silencios|escond)\b/.test(text)) {
    return 'stealth_demonstration';
  }
  if (/\b(sandevistan|kerenzikov|dash|double jump|salto duplo|tendoes reforcados|mobilidade|parkour|velocidade|deslocamento)\b/.test(text)) {
    return 'mobility_demonstration';
  }
  if (/\b(cyberware|implante|implant|mantis blade|gorilla arm|monowire|projectile launch|cyberdeck|ciberdeck|quickhack|ripperdoc|ciberpsicose|cyberpsychosis|subdermal|biomonitor|blood pump)\b/.test(text)) {
    return 'cyberware_demonstration';
  }
  if (/\b(compar|versus|\bvs\b|diferenca entre|alternativa|melhor que|custo[- ]beneficio)\b/.test(text)) {
    return 'item_comparison';
  }
  if (/\b(menu|interface|hud|arvore de habilidades|skill tree|atributos|especificac|specs|status)\b/.test(text)) {
    return 'interface_explanation';
  }
  if (/\b(boss|chefe|phase 2|fase 2|segunda fase|waterfowl|arena do chefe|confronto final)\b/.test(text)) {
    return 'gameplay_boss_fight';
  }
  if (input.domain === 'technology') {
    return /\b(benchmark|fps|desempenho|teste|throughput|latencia|bateria)\b/.test(text)
      ? 'hardware_benchmark'
      : 'product_demonstration';
  }
  if (input.domain === 'documentary') {
    return /\b(arquivo|historico|epoca|decada|evento|documental|registro)\b/.test(text)
      ? 'archival_footage'
      : 'historical_context';
  }
  if (input.domain === 'anime') {
    return /\b(luta|batalha|golpe|ataque|transforma)\b/.test(text)
      ? 'combat_demonstration'
      : 'cinematic_cutscene';
  }
  if (/\b(combate|luta|ataque|golpe|dano|tiro|espada|fight|batalha)\b/.test(text)) {
    return input.entity && /boss|chefe/i.test(input.entity.role) ? 'gameplay_boss_fight' : 'combat_demonstration';
  }
  if (!input.entity) {
    return 'cinematic_transition';
  }
  return input.domain === 'gaming' ? 'gameplay_showcase' : 'product_demonstration';
}

function buildSpecificMediaQueries(
  workTitle: string,
  entity: ResearchEntityFact | undefined,
  expectedEvent: string,
  domain: PromptDomain,
  visualIntent: SemanticVisualIntent,
): string[] {
  const cleanEvent = expectedEvent.replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
  const shortEvent = cleanEvent.split(/\s+/).slice(0, 5).join(' ').trim();

  if (!entity) {
    if (visualIntent === 'cinematic_intro' || visualIntent === 'cinematic_outro') {
      if (domain === 'gaming') {
        return [
          `${workTitle} official trailer 4k`,
          `${workTitle} cinematic gameplay showcase`,
        ];
      }
      if (domain === 'technology') {
        return [`${workTitle} product keynote overview`, `${workTitle} hands on showcase`];
      }
      if (domain === 'documentary') {
        return [`${workTitle} documentary archival footage`, `${workTitle} historical overview`];
      }
    }
    const suffix =
      domain === 'gaming'
        ? 'gameplay showcase no commentary'
        : domain === 'anime'
          ? 'scene clip'
          : domain === 'technology'
            ? 'hands on demonstration'
            : 'documentary footage';
    return [`${workTitle} ${shortEvent} ${suffix}`.replace(/\s+/g, ' ').trim()];
  }

  const cleanEntity = cleanEntityForQuery(entity.entityName);
  const mechanic = entity.mechanicsOrEvents[0] ?? entity.attackPatternsOrPhases?.[0] ?? '';
  const cleanMechanic = mechanic.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).slice(0, 5).join(' ').trim();
  const base = `${workTitle} ${cleanEntity}`.trim();

  switch (visualIntent) {
    case 'gameplay_boss_fight':
      return [
        `${base} boss fight no commentary`,
        ...(cleanMechanic ? [`${base} ${cleanMechanic}`] : []),
        `${base} phase 2 cutscene gameplay`,
      ].slice(0, 3);
    case 'stealth_demonstration':
      return [
        `${base} stealth gameplay demonstration`,
        `${base} stealth showcase no commentary`,
        ...(cleanMechanic ? [`${base} ${cleanMechanic}`] : []),
      ].slice(0, 3);
    case 'mobility_demonstration':
      return [
        `${base} mobility movement gameplay demonstration`,
        `${base} showcase gameplay`,
        ...(cleanMechanic ? [`${base} ${cleanMechanic}`] : []),
      ].slice(0, 3);
    case 'cyberware_demonstration':
      return [
        `${base} cyberware gameplay showcase`,
        `${base} implant demonstration gameplay`,
        ...(cleanMechanic ? [`${base} ${cleanMechanic}`] : [`${base} combat showcase`]),
      ].slice(0, 3);
    case 'combat_demonstration':
      return [
        `${base} combat gameplay demonstration`,
        ...(cleanMechanic ? [`${base} ${cleanMechanic}`] : []),
        `${base} gameplay showcase no commentary`,
      ].slice(0, 3);
    case 'item_comparison':
      return [
        `${base} comparison showcase`,
        `${base} vs alternatives gameplay`,
      ].slice(0, 3);
    case 'interface_explanation':
      return [
        `${base} menu stats build showcase`,
        `${base} ui explanation`,
      ].slice(0, 3);
    case 'product_demonstration':
    case 'hardware_benchmark':
      return [
        `${base} hands on review`,
        `${base} ${visualIntent === 'hardware_benchmark' ? 'benchmark performance test' : 'feature demonstration'}`.trim(),
        ...(cleanMechanic ? [`${base} ${cleanMechanic}`] : []),
      ].slice(0, 3);
    case 'archival_footage':
    case 'historical_context':
      return [
        `${base} archival footage`,
        `${base} documentary history footage`,
      ].slice(0, 3);
    default:
      if (domain === 'anime') {
        return [
          `${base} ${cleanMechanic || 'scene'} anime clip`,
          `${base} scene`,
        ].slice(0, 3);
      }
      return [
        `${base} gameplay showcase`,
        ...(cleanMechanic ? [`${base} ${cleanMechanic}`] : []),
        `${base} demonstration`,
      ].slice(0, 3);
  }
}

const GENERIC_ENTITY_STOPWORDS = new Set([
  'order', 'beast', 'blade', 'blades', 'black', 'golden', 'consort', 'shadow', 'erdtree',
  'first', 'lord', 'starscourge', 'scourge', 'omen', 'king', 'queen', 'blood',
  'fallen', 'general', 'commander', 'knight', 'dragon', 'cleric', 'promised',
  'ordem', 'aurea', 'áurea', 'fera', 'pristina', 'prístina', 'espada', 'lamina', 'laminas',
  'lâmina', 'lâminas', 'negra', 'consorte', 'prometido', 'chefe', 'boss', 'the', 'and',
  'system', 'sistema', 'launch', 'lancamento', 'projectile', 'projeteis', 'arms', 'bracos',
  'cyberware', 'upgrade', 'upgrades', 'implante', 'implantes', 'implant', 'item', 'modo',
  'arma', 'armas', 'build', 'builds', 'review', 'teste', 'product', 'produto', 'nova', 'novo',
]);

export function doesNarrationMatchEntity(
  narrationAndTitle: string,
  entityName: string,
  workTitle: string,
): boolean {
  const textNorm = normalizeMatchText(narrationAndTitle);
  const aliases = getEntityAliases(entityName);
  for (const alias of aliases) {
    if (alias.length >= 4 && textNorm.includes(alias)) return true;
  }
  const workTokens = new Set(normalizeMatchText(workTitle).split(/[\s,:-]+/).filter((w) => w.length >= 3));
  const tokens = aliases
    .flatMap((a) => a.split(/[\s,&:/-]+/))
    .filter((w) => w.length >= 4 && !workTokens.has(w) && !GENERIC_ENTITY_STOPWORDS.has(w));
  if (tokens.length === 0) return false;
  return tokens.some((t) => textNorm.includes(t));
}

function matchBeatToEntity(
  beat: EditorialSegment,
  entities: ResearchEntityFact[],
  workTitle: string,
): ResearchEntityFact | undefined {
  if (entities.length === 0) return undefined;
  const workTokens = new Set(normalizeMatchText(workTitle).split(/[\s,:-]+/).filter((w) => w.length >= 3));
  const titleNorm = normalizeMatchText(beat.title);
  const textNorm = normalizeMatchText(`${beat.title} ${beat.spokenText}`);

  // 1. Exact primary name or known bilingual alias match (title first, then full text)
  for (const e of entities) {
    const aliases = getEntityAliases(e.entityName);
    if (aliases.some((a) => a.length >= 4 && titleNorm.includes(a))) return e;
  }
  for (const e of entities) {
    const aliases = getEntityAliases(e.entityName);
    if (aliases.some((a) => a.length >= 4 && textNorm.includes(a))) return e;
  }

  // 2. Distinctive proper-noun token scoring (title weighted 3x higher than body)
  let bestEntity: ResearchEntityFact | undefined;
  let bestScore = 0;
  for (const e of entities) {
    const aliases = getEntityAliases(e.entityName);
    const tokens = [
      ...new Set(
        aliases
          .flatMap((a) => a.split(/[\s,&:/-]+/))
          .filter((w) => w.length >= 4 && !workTokens.has(w) && !GENERIC_ENTITY_STOPWORDS.has(w)),
      ),
    ];
    const titleHits = tokens.filter((t) => titleNorm.includes(t)).length;
    const bodyHits = tokens.filter((t) => textNorm.includes(t)).length;
    const score = titleHits * 3 + bodyHits;
    if (score > bestScore) {
      bestScore = score;
      bestEntity = e;
    }
  }
  if (bestEntity && bestScore > 0) return bestEntity;

  // Never blindly recycle or invent an entity when the beat narration does not mention one.
  return undefined;
}

export function buildSemanticDecupagem(
  script: EditorialScript,
  dossier: EditorialResearchDossier,
  interpretation: PromptInterpretation,
): SemanticSceneCut[] {
  const beats = Array.isArray(script.segments) ? script.segments : [];
  const multiWork = isMultiWorkProduction(interpretation);
  const referenceWorks = interpretation.referenceWorks ?? detectReferenceWorks(interpretation.originalPrompt);
  // Narration time follows the words actually written, not targetDuration / beats: a 532s script split into
  // 12 × 50s demanded coverage the voice-over never needed. Beats without real text keep their estimate.
  const narrationDur = beats.map((b) => {
    const words = b.spokenText.split(/\s+/).filter(Boolean).length;
    return words >= 6
      ? Math.max(4, Math.round(estimateNarrationSec(b.spokenText, interpretation.language)))
      : Math.max(4, Math.round(b.estimatedDurationSec));
  });
  let cursorSec = 0;
  let previous: { entity: ResearchEntityFact; stage: EditorialSegment['stage'] } | undefined;

  return beats.map((beat, idx) => {
    const resolved = resolveSceneSubject({
      beat,
      entities: dossier.entities,
      workTitle: dossier.workTitle,
      referenceWorks,
      ...(previous ? { previous: previous.entity } : {}),
    });
    const matchedEntity = resolved.entity;
    if (matchedEntity) previous = { entity: matchedEntity, stage: beat.stage };
    // An overview in a ranking of several works shows those works; in a single-work production the overview is the
    // work itself (its ranked items — bosses, implants — are not required on screen in an intro).
    const overviewWorks =
      resolved.resolution === 'overview' && multiWork ? dossier.entities.map((e) => cleanEntityForQuery(e.entityName)) : [];
    const isIntroOrOutro =
      beat.stage === 'hook' || beat.stage === 'promise' || beat.stage === 'cta' || beat.stage === 'resolution';
    const secondary = multiWork && !isIntroOrOutro ? resolved.secondaryEntity : undefined;
    const sceneWorks = matchedEntity
      ? multiWork
        ? [cleanEntityForQuery(matchedEntity.entityName), ...(secondary ? [cleanEntityForQuery(secondary.entityName)] : [])]
        : [dossier.workTitle]
      : resolved.referenceWork
        ? [resolved.referenceWork]
        : multiWork
          ? overviewWorks
          : [dossier.workTitle];
    const entities = matchedEntity
      ? [matchedEntity.entityName, ...(secondary ? [secondary.entityName] : [])]
      : resolved.referenceWork
        ? [resolved.referenceWork]
        : overviewWorks;
    const visualKeywords = extractVisualKeywords({
      narrationText: beat.spokenText,
      ...(matchedEntity ? { entityName: matchedEntity.entityName } : resolved.referenceWork ? { entityName: resolved.referenceWork } : {}),
      facts: matchedEntity ? [...matchedEntity.verifiedFacts, ...matchedEntity.mechanicsOrEvents] : [],
      excludeNames: [
        ...dossier.entities.filter((e) => e !== matchedEntity && e !== secondary).map((e) => e.entityName),
        ...referenceWorks.filter((w) => w !== resolved.referenceWork),
      ],
    });
    const narrationEvent = summarizeNarrationEvent(beat.spokenText);
    const expectedEvent = matchedEntity
      ? narrationEvent || matchedEntity.mechanicsOrEvents[0] || matchedEntity.verifiedFacts[0] || `Demonstração de ${matchedEntity.entityName}`
      : resolved.referenceWork
        ? narrationEvent || `Referência a ${resolved.referenceWork}`
        : beat.stage === 'hook' || beat.stage === 'promise'
          ? `Abertura: panorama de ${sceneWorks.slice(0, 5).join(', ') || dossier.workTitle}`
          : beat.stage === 'cta' || beat.stage === 'resolution'
            ? `Conclusão: síntese de ${sceneWorks.slice(0, 5).join(', ') || dossier.workTitle}`
            : narrationEvent || `Contexto narrativo de ${dossier.workTitle}`;

    const visualIntent = classifySceneVisualIntent({
      beat,
      ...(matchedEntity ? { entity: matchedEntity } : {}),
      workTitle: dossier.workTitle,
      domain: interpretation.domain,
      expectedEvent,
    });

    const contextualDomain = interpretation.domain === 'anime' || interpretation.domain === 'gaming' ? interpretation.domain : 'general';
    const beatTerms = translateVisualTerms(beat.spokenText);
    const actionTerms = beatTerms.length > 0 ? beatTerms : translateVisualTerms(matchedEntity?.mechanicsOrEvents.join(' ') ?? '');
    const secondaryKeywords = secondary
      ? extractVisualKeywords({
          narrationText: beat.spokenText,
          entityName: secondary.entityName,
          facts: [...secondary.verifiedFacts, ...secondary.mechanicsOrEvents],
          excludeNames: [matchedEntity?.entityName ?? '', ...referenceWorks],
          max: 3,
        })
      : [];
    const entityKeyword = matchedEntity && !multiWork ? [cleanEntityForQuery(matchedEntity.entityName)] : [];
    const contextual =
      multiWork || interpretation.domain === 'anime'
        ? sceneWorks.slice(0, resolved.resolution === 'overview' ? 5 : 2).flatMap((work, wIdx) =>
            buildContextualSceneQueries({
              work,
              keywords: wIdx === 0 ? [...entityKeyword, ...visualKeywords] : secondary ? secondaryKeywords : [],
              actionTerms,
              domain: contextualDomain,
              overview: resolved.resolution === 'overview' || (!matchedEntity && Boolean(resolved.referenceWork) && visualKeywords.length === 0),
              max: resolved.resolution === 'overview' ? 2 : wIdx === 0 ? 6 : 3,
            }),
          )
        : [];
    const legacy = multiWork
      ? []
      : buildSpecificMediaQueries(dossier.workTitle, matchedEntity, expectedEvent, interpretation.domain, visualIntent);
    const mediaQueries = dedupeEquivalentQueries([...contextual, ...legacy]).filter(
      (q) => q.toLowerCase() !== interpretation.originalPrompt.toLowerCase(),
    );

    // Editorial slot = the script's estimate (in the staged pipeline it is itself derived from the narration words);
    // `narrationSec` is the voice-over the scene must actually cover, which drives media acquisition.
    const narrationSec = narrationDur[idx] ?? Math.max(4, Math.round(beat.estimatedDurationSec));
    const durationSec = beat.estimatedDurationSec > 0 ? Math.max(4, Math.round(beat.estimatedDurationSec)) : narrationSec;
    const startSec = cursorSec;
    const endSec = cursorSec + durationSec;
    cursorSec = endSec;

    const entityTokens =
      sceneWorks.length > 0
        ? [
            ...new Set(
              [...entities, ...visualKeywords.slice(0, 2)]
                .flatMap((name) => getEntityAliases(name))
                .flatMap((a) => [a, ...a.split(/[\s,:-]+/)])
                .filter((w) => w.length >= 4 && !GENERIC_ENTITY_STOPWORDS.has(w)),
            ),
          ]
        : dossier.workTitle
            .toLowerCase()
            .split(/\s+/)
            .filter((w) => w.length >= 4);

    const expectedActions = matchedEntity?.mechanicsOrEvents.slice(0, 2) ?? [expectedEvent];
    const sceneId = matchedEntity
      ? `scene_${String(idx + 1).padStart(2, '0')}_${matchedEntity.entityName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}`
      : `scene_${String(idx + 1).padStart(2, '0')}_${beat.stage}`;

    const sfxCues =
      visualIntent === 'gameplay_boss_fight'
        ? ['impact_hit', 'boss_whoosh', 'sub_drop']
        : interpretation.domain === 'gaming'
          ? ['hud_pulse', 'whoosh_transition']
          : ['whoosh_transition', 'ambient_riser'];
    const vfxEffects =
      beat.stage === 'hook' || beat.stage === 'climax'
        ? ['subtle_vignette', 'lower_third_accent']
        : ['lower_third_accent'];
    const graphicsHints = matchedEntity
      ? [`Lower third: ${matchedEntity.rankPosition ? `#${matchedEntity.rankPosition} ` : ''}${matchedEntity.entityName}`]
      : [`Título de capítulo: ${dossier.workTitle}`];

    const dependencyHash = sha12({
      dossierHash: dossier.dossierHash,
      narrationText: beat.spokenText,
      entities,
      expectedEvent,
      visualIntent,
      durationSec,
      mediaQueries,
    });

    return {
      sceneId,
      order: idx + 1,
      beatStage: beat.stage,
      narrationText: beat.spokenText,
      workTitle: dossier.workTitle,
      entities,
      expectedEvent,
      durationSec,
      startSec,
      endSec,
      visualIntent,
      mediaQueries,
      matchingCriteria: {
        requiredEntities: [...new Set(entityTokens)],
        expectedActions,
        minVisualConfidence: 0.7,
      },
      allowedAlternatives: ['alternate_query', 'alternate_interval', 'explanatory_graphic', 'localized_editorial_adjustment'],
      audioDependencies: { sfxCues, vfxEffects, graphicsHints },
      dependencyHash,
      works: sceneWorks,
      visualKeywords,
      subjectResolution: resolved.resolution,
      narrationSec,
    };
  });
}

/** First informative clause of the narration (≤ 90 chars), used as the scene's expected visual event. */
function summarizeNarrationEvent(text: string): string {
  const sentence =
    text
      .split(/(?<=[.!?…])\s+/)
      .map((s) => s.trim())
      .find((s) => s.split(/\s+/).length >= 4 && !/^(primeiro|segundo|terceiro|quarto|quinto|sexto|s[eé]timo|oitavo|nono|d[eé]cimo)\s+lugar/i.test(s)) ?? '';
  return sentence.length > 90 ? `${sentence.slice(0, 87).replace(/\s+\S*$/, '')}…` : sentence;
}

const NAME_GENERIC_TOKENS = new Set([
  'magic', 'magia', 'slayer', 'slayers', 'holder', 'caster', 'spells', 'ancient', 'energy', 'energia', 'tecnicas', 'tecnica',
  'sistema', 'system', 'weekly', 'shonen', 'escola', 'academia', 'cavaleiros', 'esquadroes', 'lei', 'verdade',
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function entityMentionIndex(originalText: string, entity: ResearchEntityFact, workTitle: string): number {
  const textNorm = normalizeMatchText(originalText);
  const workTokens = new Set(normalizeMatchText(workTitle).split(/[\s,:-]+/).filter((w) => w.length >= 3));
  const aliases = getEntityAliases(entity.entityName).filter((a) => a.length >= 4);
  let best = -1;
  const consider = (needle: string) => {
    if (!needle) return;
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`);
    const m = re.exec(textNorm);
    if (m) {
      const pos = m.index + (m[1]?.length ?? 0);
      if (best === -1 || pos < best) best = pos;
    }
  };
  for (const a of aliases) consider(a);
  const tokens = aliases
    .flatMap((a) => a.split(/[\s,&:/-]+/))
    .filter((w) => w.length >= 5 && !workTokens.has(w) && !GENERIC_ENTITY_STOPWORDS.has(w) && !['magic', 'magia', 'muscles'].includes(w));
  for (const t of tokens) consider(t);
  // Characters named in the research facts identify the work too ("Natsu" → Fairy Tail). Only capitalised
  // occurrences count, so "recuperar energia" never matches "Energia Amaldiçoada".
  const names = extractVisualKeywords({
    narrationText: '',
    entityName: entity.entityName,
    facts: [...entity.verifiedFacts, ...entity.mechanicsOrEvents],
    max: 8,
  });
  for (const n of names) {
    const parts = n.split(/\s+/);
    // Full name, or the first name of a two-word person name ("Natsu Dragneel" → "Natsu"); never generic words
    // shared with other titles ("Dragon Slayer Magic" must not match "Mashle: Magic and Muscles").
    const first = parts[0] ?? '';
    const personLike = parts.length === 2 && first.length >= 4 && !NAME_GENERIC_TOKENS.has(normalizeMatchText(first)) && !GENERIC_ENTITY_STOPWORDS.has(normalizeMatchText(first));
    const candidates = parts.length > 1 ? [n, ...(personLike ? [first] : [])] : [n];
    for (const c of candidates) {
      const re = new RegExp(`(^|[^\p{L}\p{N}])${escapeRegExp(c)}(?=[^\p{L}\p{N}]|$)`, 'u');
      const m = re.exec(originalText);
      if (m) {
        const pos = normalizeMatchText(originalText.slice(0, m.index + (m[1]?.length ?? 0))).length;
        if (best === -1 || pos < best) best = pos;
      }
    }
  }
  return best;
}

/**
 * Which work/entity a scene shows. The narration's earliest named entity wins (rank announcements come first:
 * "Primeiro lugar... Fullmetal Alchemist"), then a continuation inherits the previous item, then a reference work
 * the prompt cites (hook about Black Clover), then — for opening/closing beats — an overview of all ranked works.
 */
export function resolveSceneSubject(input: {
  beat: EditorialSegment;
  entities: ResearchEntityFact[];
  workTitle: string;
  referenceWorks?: string[];
  previous?: ResearchEntityFact;
}): {
  entity?: ResearchEntityFact;
  /** A second item the same beat narrates at length (closing one ranking position and opening the next). */
  secondaryEntity?: ResearchEntityFact;
  referenceWork?: string;
  resolution: NonNullable<SemanticSceneCut['subjectResolution']>;
} {
  const text = input.beat.spokenText;
  const textNorm = normalizeMatchText(text);
  const isFraming = ['hook', 'promise', 'cta', 'resolution'].includes(input.beat.stage);
  const mentions = input.entities
    .map((e) => ({ entity: e, pos: entityMentionIndex(text, e, input.workTitle) }))
    .filter((m) => m.pos >= 0)
    .sort((x, y) => x.pos - y.pos);
  if (mentions.length === 0 && input.beat.title && !/^cena\s+\d+$/i.test(input.beat.title.trim())) {
    const byTitle = matchBeatToEntity({ ...input.beat, spokenText: '' }, input.entities, input.workTitle);
    if (byTitle) return { entity: byTitle, resolution: 'entity' };
  }
  if (mentions.length > 0) {
    // Narration share: the text from one entity's first mention to the next belongs to it; text before the first
    // mention continues the previous scene's item. A beat that closes item 3 and opens item 2 shows both.
    const len = Math.max(1, textNorm.length);
    const shares = new Map<ResearchEntityFact, number>();
    const lead = mentions[0]!.pos;
    if (input.previous && !isFraming && lead > 0) shares.set(input.previous, lead);
    for (let i = 0; i < mentions.length; i += 1) {
      const cur = mentions[i]!;
      const end = mentions[i + 1]?.pos ?? len;
      shares.set(cur.entity, (shares.get(cur.entity) ?? 0) + Math.max(0, end - cur.pos));
    }
    const ranked = [...shares.entries()].sort((x, y) => y[1] - x[1]);
    const [primary] = ranked[0]!;
    const secondary = ranked.find(([e, share]) => e !== primary && share / len >= 0.2)?.[0];
    return {
      entity: primary,
      ...(secondary ? { secondaryEntity: secondary } : {}),
      resolution: mentions.some((m) => m.entity === primary) ? 'entity' : 'inherited',
    };
  }
  if (input.previous && !isFraming) return { entity: input.previous, resolution: 'inherited' };
  // "Hoje vamos conhecer cinco animes..." presents the whole list: an overview of the ranked works.
  const listOverview =
    isFraming &&
    input.entities.length > 1 &&
    /\b(cinco|seis|sete|oito|nove|dez|\d+|lista|ranking|top)\b[^.]{0,40}\b(animes|jogos|games|obras|filmes|s[eé]ries|mang[aá]s)\b/i.test(text);
  for (const ref of listOverview ? [] : input.referenceWorks ?? []) {
    const refNorm = normalizeMatchText(ref);
    if (refNorm.length >= 3 && textNorm.includes(refNorm)) return { referenceWork: ref, resolution: 'reference' };
  }
  if (input.entities.length > 0 && (isFraming || !input.previous)) return { resolution: 'overview' };
  return { resolution: 'none' };
}

export function validateScriptAgainstDossier(
  script: EditorialScript | undefined,
  dossier: EditorialResearchDossier,
  interpretation: PromptInterpretation,
): { valid: boolean; missingEntities: string[]; reasons: string[] } {
  const reasons: string[] = [];
  const segments = script?.segments ?? [];
  if (!script || segments.length === 0) {
    return { valid: false, missingEntities: dossier.entities.map((e) => e.entityName), reasons: ['Roteiro vazio.'] };
  }
  const fullNarration = segments.map((b) => b.spokenText).join(' ').toLowerCase();
  const missingEntities: string[] = [];
  for (const entity of dossier.entities) {
    const tokens = entity.entityName
      .toLowerCase()
      .split(/[\s,:-]+/)
      .filter((t) => t.length >= 4);
    const mentioned =
      fullNarration.includes(entity.entityName.toLowerCase()) ||
      tokens.some((t) => fullNarration.includes(t));
    if (!mentioned) {
      missingEntities.push(entity.entityName);
    }
  }
  if (missingEntities.length > 0) {
    reasons.push(`Entidades do dossiê ausentes na narração: ${missingEntities.join(', ')}`);
  }
  const totalSec = segments.reduce((sum, b) => sum + b.estimatedDurationSec, 0);
  if (interpretation.targetDurationSec >= 180 && totalSec < interpretation.targetDurationSec * 0.5) {
    reasons.push(`Duração estimada do roteiro (${totalSec}s) muito abaixo do alvo (${interpretation.targetDurationSec}s).`);
  }
  return { valid: reasons.length === 0, missingEntities, reasons };
}

export function computeIncrementalInvalidation(input: {
  previousPromptHash?: string;
  nextInterpretation: PromptInterpretation;
  previousDossier?: EditorialResearchDossier;
  nextDossier?: EditorialResearchDossier;
  previousScenes?: SemanticSceneCut[];
  nextScenes?: SemanticSceneCut[];
}): IncrementalInvalidationReport {
  const reasons: string[] = [];
  const promptChanged = Boolean(input.previousPromptHash && input.previousPromptHash !== input.nextInterpretation.promptHash);
  const researchValid = Boolean(input.previousDossier && !promptChanged);
  if (promptChanged) reasons.push('Prompt ou parâmetros centrais alterados: pesquisa invalidada.');

  const dossierChanged = Boolean(
    input.previousDossier &&
      input.nextDossier &&
      input.previousDossier.dossierHash !== input.nextDossier.dossierHash,
  );
  const scriptValid = researchValid && !dossierChanged;
  if (dossierChanged) reasons.push('Dossiê factual alterado: roteiro e decupagem dependentes invalidados.');

  const prevById = new Map((input.previousScenes ?? []).map((s) => [s.sceneId, s]));
  const validSceneIds: string[] = [];
  const invalidatedSceneIds: string[] = [];

  for (const scene of input.nextScenes ?? []) {
    const prev = prevById.get(scene.sceneId);
    if (prev && prev.dependencyHash === scene.dependencyHash) {
      validSceneIds.push(scene.sceneId);
    } else {
      invalidatedSceneIds.push(scene.sceneId);
    }
  }
  if (invalidatedSceneIds.length > 0) {
    reasons.push(`${invalidatedSceneIds.length} cena(s) com alteração semântica precisam de reaquisição/validação.`);
  }

  return {
    researchValid,
    scriptValid,
    decupagemValid: scriptValid && invalidatedSceneIds.length === 0,
    validSceneIds,
    invalidatedSceneIds,
    reasons,
  };
}

export function buildEditorialRecoveryPlan(
  scene: SemanticSceneCut,
  failedQueries: string[],
): EditorialRecoveryStep[] {
  const entityLabel = scene.entities[0] ?? scene.workTitle;
  const intentSuffix =
    scene.visualIntent === 'gameplay_boss_fight'
      ? 'boss fight'
      : scene.visualIntent === 'stealth_demonstration'
        ? 'stealth gameplay'
        : scene.visualIntent === 'mobility_demonstration'
          ? 'movement gameplay'
          : scene.visualIntent === 'cyberware_demonstration'
            ? 'cyberware demonstration'
            : 'showcase';
  return [
    {
      step: 1,
      action: 'alternate_source_or_query',
      description: `Reformular consulta para "${entityLabel}" focando no evento "${scene.expectedEvent}" sem repetir o prompt completo.`,
      autoApproveMotionVisual: false,
      suggestedQueries: [
        `${scene.workTitle} ${entityLabel} ${intentSuffix}`.trim(),
        `${scene.workTitle} ${entityLabel} demonstration`.trim(),
      ].filter((q) => !failedQueries.includes(q)),
    },
    {
      step: 2,
      action: 'alternate_valid_interval',
      description: `Reutilizar outro intervalo temporal comprovado por Scene Grounding do mesmo acervo de ${entityLabel}.`,
      autoApproveMotionVisual: false,
    },
    {
      step: 3,
      action: 'explanatory_graphic_composition',
      description: `Gerar cartão gráfico explicativo factual (nome, fase/mecânica de ${entityLabel}) apenas se não induzir o espectador ao erro.`,
      autoApproveMotionVisual: false,
    },
    {
      step: 4,
      action: 'localized_editorial_adjustment',
      description: `Propor ajuste editorial localizado na cena ${scene.sceneId} mantendo as demais cenas intactas.`,
      autoApproveMotionVisual: false,
    },
    {
      step: 5,
      action: 'explicit_pending_media',
      description: `Manter pendência explícita na cena ${scene.sceneId} para revisão humana (Motion Visual não é autorizado automaticamente).`,
      autoApproveMotionVisual: false,
    },
  ];
}
