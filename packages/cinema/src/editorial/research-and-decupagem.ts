import { createHash } from 'node:crypto';
import type { EditorialScript, EditorialSegment } from './editorial-integrity.js';

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
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);
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
  const countMatch = /\b(?:top\s+)?(\d{1,2})\s+(?:melhores\s+|maiores\s+|principais\s+|piores\s+)?(?:chefes|bosses|upgrades|implantes|cyberwares|cibern[eé]tic[oa]s?|produtos|tecnologias|ferramentas|recursos|armas|builds|jogos|lutas|momentos|fatos|itens|personagens|batalhas|epis[oó]dios)\b/iu.exec(cleaned);
  const requestedCount = countMatch?.[1] ? Math.max(1, Math.min(25, Number(countMatch[1]))) : undefined;

  // Detect duration in prompt if not explicitly provided
  let targetDurationSec = options?.targetDurationSec ?? 0;
  if (!targetDurationSec || targetDurationSec <= 0) {
    const minMatch = /(\d+)\s*min(?:utos?)?/i.exec(cleaned);
    targetDurationSec = minMatch?.[1] ? Number(minMatch[1]) * 60 : 180;
  }

  // Detect domain
  let domain: PromptDomain = 'general';
  if (/\b(elden ring|cyberpunk\s*2077|cyberpunk|dark souls|sekiro|bloodborne|witcher|baldur|hollow knight|god of war|zelda|minecraft|gameplay|boss|chefe|cyberware|implante|cibern[eé]tica|jogo|game|soulslike)\b/i.test(lower)) {
    domain = 'gaming';
  } else if (/\b(dragon ball|naruto|one piece|anime|manga|bleach|jujutsu|attack on titan)\b/i.test(lower)) {
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
  if (!workTitle) {
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
  };
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
  const rawTotalDur = beats.reduce((acc, b) => acc + Math.max(4, b.estimatedDurationSec), 0) || interpretation.targetDurationSec;
  const scale = interpretation.targetDurationSec > 0 ? interpretation.targetDurationSec / rawTotalDur : 1;
  let cursorSec = 0;

  return beats.map((beat, idx) => {
    const matchedEntity = matchBeatToEntity(beat, dossier.entities, dossier.workTitle);
    const entities = matchedEntity ? [matchedEntity.entityName] : [];
    const expectedEvent = matchedEntity
      ? matchedEntity.mechanicsOrEvents[0] ?? matchedEntity.verifiedFacts[0] ?? `Demonstração de ${matchedEntity.entityName}`
      : beat.stage === 'hook' || beat.stage === 'promise'
        ? `Abertura temática de ${dossier.workTitle}`
        : beat.stage === 'cta' || beat.stage === 'resolution'
          ? `Conclusão e síntese de ${dossier.workTitle}`
          : beat.title.trim() || `Contexto narrativo de ${dossier.workTitle}`;

    const visualIntent = classifySceneVisualIntent({
      beat,
      ...(matchedEntity ? { entity: matchedEntity } : {}),
      workTitle: dossier.workTitle,
      domain: interpretation.domain,
      expectedEvent,
    });

    const mediaQueries = buildSpecificMediaQueries(
      dossier.workTitle,
      matchedEntity,
      expectedEvent,
      interpretation.domain,
      visualIntent,
    ).filter((q) => q.toLowerCase() !== interpretation.originalPrompt.toLowerCase());

    const durationSec = Math.max(6, Math.round(beat.estimatedDurationSec * scale));
    const startSec = cursorSec;
    const endSec = cursorSec + durationSec;
    cursorSec = endSec;

    const entityTokens = matchedEntity
      ? [
          ...new Set(
            getEntityAliases(matchedEntity.entityName)
              .flatMap((a) => a.split(/[\s,:-]+/))
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
    };
  });
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
