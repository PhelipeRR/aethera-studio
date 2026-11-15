import { createHash } from 'node:crypto';
import type { EditorialScript, EditorialSegment } from './editorial-integrity.js';

export type PromptDomain = 'gaming' | 'anime' | 'documentary' | 'general';
export type PromptFormatIntent = 'top_ranking' | 'narrative_essay' | 'documentary' | 'trailer';

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
  visualIntent: 'gameplay_boss_fight' | 'cinematic_cutscene' | 'mechanic_breakdown' | 'archival_footage' | 'title_graphic';
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

  // Detect requested item count (e.g., "10 chefes", "top 10", "5 momentos")
  const countMatch = /\b(?:top\s+)?(\d{1,2})\s+(?:chefes|bosses|jogos|lutas|momentos|fatos|itens|personagens|batalhas)\b/i.exec(cleaned);
  const requestedCount = countMatch?.[1] ? Math.max(1, Math.min(25, Number(countMatch[1]))) : undefined;

  // Detect duration in prompt if not explicitly provided
  let targetDurationSec = options?.targetDurationSec ?? 0;
  if (!targetDurationSec || targetDurationSec <= 0) {
    const minMatch = /(\d+)\s*min(?:utos?)?/i.exec(cleaned);
    targetDurationSec = minMatch?.[1] ? Number(minMatch[1]) * 60 : 180;
  }

  // Detect domain
  let domain: PromptDomain = 'general';
  if (/\b(elden ring|dark souls|sekiro|bloodborne|gameplay|boss|chefe|jogo|game|soulslike|zelda|minecraft)\b/i.test(lower)) {
    domain = 'gaming';
  } else if (/\b(dragon ball|naruto|one piece|anime|manga|bleach|jujutsu|attack on titan)\b/i.test(lower)) {
    domain = 'anime';
  } else if (/\b(document[aá]rio|hist[oó]ria|guerra|biografia|ci[eê]ncia)\b/i.test(lower)) {
    domain = 'documentary';
  }

  // Extract explicit work title
  let workTitle = '';
  const knownWorks: Array<[RegExp, string]> = [
    [/\belden ring\b/i, 'Elden Ring'],
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
    requestedCount !== undefined || options?.genre === 'top_list' || /\b(ranking|top\s*\d+|mais dif[ií]ceis)\b/i.test(lower)
      ? 'top_ranking'
      : options?.genre === 'documentary'
        ? 'documentary'
        : options?.genre === 'trailer'
          ? 'trailer'
          : 'narrative_essay';

  const rankingCriteria =
    formatIntent === 'top_ranking'
      ? [
          'Complexidade mecânica e leitura de padrões de ataque',
          'Transições de fase e punição de erros',
          'Agressividade, alcance e pressão sobre o jogador',
          'Consenso histórico de dificuldade na comunidade',
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

function buildSpecificMediaQueries(
  workTitle: string,
  entity: ResearchEntityFact | undefined,
  expectedEvent: string,
  domain: PromptDomain,
): string[] {
  const cleanEvent = expectedEvent.replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!entity) {
    const suffix = domain === 'gaming' ? 'gameplay no commentary' : domain === 'anime' ? 'scene clip' : 'footage';
    return [`${workTitle} ${cleanEvent.split(' ').slice(0, 5).join(' ')} ${suffix}`.trim()];
  }
  const mechanic = entity.mechanicsOrEvents[0] ?? entity.attackPatternsOrPhases?.[0] ?? '';
  const cleanMechanic = mechanic.replace(/[^\p{L}\p{N}\s-]/gu, ' ').split(/\s+/).slice(0, 5).join(' ').trim();
  const base = `${workTitle} ${entity.entityName}`.trim();

  if (domain === 'gaming') {
    return [
      `${base} boss fight no commentary`,
      ...(cleanMechanic ? [`${base} ${cleanMechanic}`] : []),
      `${base} phase 2 cutscene gameplay`,
    ].slice(0, 3);
  }
  if (domain === 'anime') {
    return [
      `${base} ${cleanMechanic || 'scene'} anime clip`,
      `${base} fight scene`,
    ].slice(0, 3);
  }
  return [
    `${base} ${cleanMechanic || 'overview'}`.trim(),
    `${workTitle} ${entity.entityName} footage`,
  ].slice(0, 3);
}

function matchBeatToEntity(
  beat: EditorialSegment,
  beatIndex: number,
  totalBeats: number,
  entities: ResearchEntityFact[],
): ResearchEntityFact | undefined {
  if (entities.length === 0) return undefined;
  const textLower = beat.spokenText.toLowerCase();
  const direct = entities.find((e) => {
    const parts = e.entityName.toLowerCase().split(/[\s,:-]+/).filter((w) => w.length >= 4);
    return textLower.includes(e.entityName.toLowerCase()) || parts.some((p) => textLower.includes(p));
  });
  if (direct) return direct;
  if (beat.stage === 'hook' || beat.stage === 'promise' || beat.stage === 'cta') {
    return undefined;
  }
  const middleIdx = Math.max(0, beatIndex - 1);
  return entities[middleIdx % entities.length];
}

export function buildSemanticDecupagem(
  script: EditorialScript,
  dossier: EditorialResearchDossier,
  interpretation: PromptInterpretation,
): SemanticSceneCut[] {
  const beats = Array.isArray(script.segments) ? script.segments : [];
  const totalBeats = Math.max(1, beats.length);
  const rawTotalDur = beats.reduce((acc, b) => acc + Math.max(4, b.estimatedDurationSec), 0) || interpretation.targetDurationSec;
  const scale = interpretation.targetDurationSec > 0 ? interpretation.targetDurationSec / rawTotalDur : 1;

  return beats.map((beat, idx) => {
    const matchedEntity = matchBeatToEntity(beat, idx, totalBeats, dossier.entities);
    const entities = matchedEntity ? [matchedEntity.entityName] : [];
    const expectedEvent = matchedEntity
      ? matchedEntity.mechanicsOrEvents[0] ?? matchedEntity.verifiedFacts[0] ?? `Confronto com ${matchedEntity.entityName}`
      : beat.stage === 'hook'
        ? `Abertura temática de ${dossier.workTitle}`
        : beat.stage === 'cta' || beat.stage === 'resolution'
          ? `Conclusão e síntese de ${dossier.workTitle}`
          : `Contexto narrativo de ${dossier.workTitle}`;

    const mediaQueries = buildSpecificMediaQueries(
      dossier.workTitle,
      matchedEntity,
      expectedEvent,
      interpretation.domain,
    ).filter((q) => q.toLowerCase() !== interpretation.originalPrompt.toLowerCase());

    const durationSec = Math.max(6, Math.round(beat.estimatedDurationSec * scale));
    const visualIntent: SemanticSceneCut['visualIntent'] = matchedEntity
      ? interpretation.domain === 'gaming'
        ? 'gameplay_boss_fight'
        : 'cinematic_cutscene'
      : beat.stage === 'hook' || beat.stage === 'resolution' || beat.stage === 'cta'
        ? 'cinematic_cutscene'
        : 'archival_footage';

    const entityTokens = matchedEntity
      ? matchedEntity.entityName
          .toLowerCase()
          .split(/[\s,:-]+/)
          .filter((w) => w.length >= 4)
      : dossier.workTitle
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length >= 4);

    const expectedActions = matchedEntity?.mechanicsOrEvents.slice(0, 2) ?? [expectedEvent];
    const sceneId = matchedEntity
      ? `scene_${String(idx + 1).padStart(2, '0')}_${matchedEntity.entityName.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 24)}`
      : `scene_${String(idx + 1).padStart(2, '0')}_${beat.stage}`;

    const sfxCues =
      interpretation.domain === 'gaming'
        ? ['impact_hit', 'boss_whoosh', 'sub_drop']
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
  return [
    {
      step: 1,
      action: 'alternate_source_or_query',
      description: `Reformular consulta para "${entityLabel}" focando no evento "${scene.expectedEvent}" sem repetir o prompt completo.`,
      autoApproveMotionVisual: false,
      suggestedQueries: [
        `${scene.workTitle} ${entityLabel} boss fight`,
        `${scene.workTitle} ${entityLabel} showcase`,
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
