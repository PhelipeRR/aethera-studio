import { sha256Hex } from './ir/sha256.js';
import type { CinemaGenre, DeliveryFormat } from './director/cinematography-director.js';
import type { RenderQualityProfile } from './edit/editorial-engine.js';
import {
  interpretProductionPrompt,
  type PromptInterpretation,
} from './editorial/research-and-decupagem.js';
import {
  DEFAULT_CREATIVE_SELECTION,
  detectCreativeSelection,
  detectDeliveryPreset,
  type AetheraCreativeSelection,
} from './director/aethera-format-catalog.js';

export const PRODUCTION_CONTRACT_SCHEMA_VERSION = 1 as const;

export type ContractRequirementCategory =
  | 'content'
  | 'format'
  | 'duration'
  | 'language'
  | 'tone'
  | 'humor'
  | 'narrative'
  | 'research'
  | 'media'
  | 'narration'
  | 'editing'
  | 'sfx'
  | 'vfx'
  | 'music'
  | 'mixing'
  | 'quality'
  | 'instruction';

export type ContractRequirementPriority = 'mandatory' | 'preference';
export type ContractRequirementStatus =
  | 'extracted'
  | 'in_progress'
  | 'satisfied'
  | 'adapted'
  | 'pending'
  | 'needs_human_review'
  | 'not_met'
  | 'blocked';

export type ContractControlField =
  | 'genre'
  | 'format'
  | 'creativeSelection'
  | 'deliveryPresetId'
  | 'previewProfile'
  | 'targetDurationSec'
  | 'humorIntensity'
  | 'renderProfile'
  | 'language'
  | 'voiceId';

export interface ProductionContractControls {
  genre: CinemaGenre;
  format: DeliveryFormat;
  creativeSelection?: AetheraCreativeSelection;
  deliveryPresetId?: string;
  previewProfile?: RenderQualityProfile;
  targetDurationSec: number;
  humorIntensity: number;
  renderProfile: RenderQualityProfile;
  language: string;
  voiceId?: string;
}

export interface ContractEvidence {
  evidenceId: string;
  requirementId: string;
  revision: number;
  stage: string;
  kind: 'extraction' | 'control' | 'research' | 'script' | 'storyboard' | 'media' | 'measurement' | 'human' | 'recovery';
  outcome: 'supports' | 'contradicts' | 'inconclusive';
  /** Stage observations are evidence only; an explicit measurement or human decision must satisfy a requirement. */
  satisfiesRequirement?: boolean;
  summary: string;
  observedValue?: unknown;
  artifactIds?: string[];
  recordedAt: string;
}

export interface ContractAcceptanceCriterion {
  id: string;
  requirementId: string;
  label: string;
  kind: 'objective' | 'subjective';
  metric:
    | 'duration_sec'
    | 'resolution'
    | 'chapter_count'
    | 'integrated_lufs'
    | 'true_peak_dbtp'
    | 'media_integrity'
    | 'synchronization'
    | 'export_parameters'
    | 'human_review';
  target: Record<string, number>;
  tolerance?: number;
  blocking: boolean;
  verification: 'preflight' | 'post_render' | 'human';
}

export interface ContractRequirement {
  id: string;
  category: ContractRequirementCategory;
  label: string;
  sourceText: string;
  value?: unknown;
  priority: ContractRequirementPriority;
  status: ContractRequirementStatus;
  criterionIds: string[];
  dependencyKeys: string[];
  evidence: ContractEvidence[];
  justification?: string;
}

export interface ContractConflict {
  id: string;
  field: ContractControlField;
  promptValue: unknown;
  manualValue: unknown;
  resolution: 'manual_value_wins' | 'prompt_value_wins' | 'pending';
  message: string;
  revision: number;
}

export interface ContractManualOverride {
  field: ContractControlField;
  promptValue?: unknown;
  manualValue: unknown;
  revision: number;
  changedAt: string;
  reason: 'user_control' | 'migration';
}

export interface ContractRecoveryState {
  attemptsByRequirement: Record<string, Array<{ signature: string; action: string; outcome: string; at: string }>>;
  maxAttemptsPerRequirement: number;
}

export interface ProductionContract {
  schemaVersion: typeof PRODUCTION_CONTRACT_SCHEMA_VERSION;
  contractId: string;
  projectId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  sourcePrompt: string;
  sourcePromptHash: string;
  interpretation: PromptInterpretation;
  controls: ProductionContractControls;
  inferredControls: Partial<ProductionContractControls>;
  manualOverrides: ContractManualOverride[];
  requirements: ContractRequirement[];
  acceptanceCriteria: ContractAcceptanceCriterion[];
  conflicts: ContractConflict[];
  recovery: ContractRecoveryState;
  /** Independent creative and delivery selections are kept in the same contract as legacy controls. */
  creativeSelection?: AetheraCreativeSelection;
  inferredCreativeSelection?: AetheraCreativeSelection;
  deliveryPresetId?: string;
  inferredDeliveryPresetId?: string;
  revisionReason?: string;
}

export interface ExtractProductionContractInput {
  projectId: string;
  prompt: string;
  controls?: Partial<ProductionContractControls>;
  manuallyChangedFields?: ContractControlField[];
  now?: string;
}

export interface ContractMeasurementSnapshot {
  durationSec?: number;
  chapterCount?: number;
  width?: number;
  height?: number;
  integratedLufs?: number;
  truePeakDbtp?: number;
  mediaIntegrity?: boolean;
  synchronization?: boolean;
  exportParametersValid?: boolean;
  now?: string;
}

export interface ContractComplianceReport {
  checkedAt: string;
  blocking: boolean;
  satisfiedCount: number;
  adaptedCount: number;
  pendingCount: number;
  humanReviewCount: number;
  notMetCount: number;
  blockedCount: number;
  issues: Array<{ criterionId: string; requirementId: string; message: string; blocking: boolean }>;
}

function sha12(value: unknown): string {
  return sha256Hex(JSON.stringify(value)).slice(0, 12);
}

function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function nowOrDefault(now?: string): string {
  return now ?? new Date().toISOString();
}

function cleanLine(line: string): string {
  return line
    .trim()
    .replace(/^[-*]\s+/, '')
    .replace(/^\d+[.)]\s+/, '')
    .replace(/^#{1,6}\s+/, '')
    .replace(/^\*{1,3}|\*{1,3}$/g, '')
    .trim();
}

function firstMatchingLine(prompt: string, pattern: RegExp): string {
  return prompt.split(/\r?\n/).map(cleanLine).find((line) => pattern.test(line)) ?? prompt.slice(0, 180);
}

function explicitResolution(prompt: string): { width: number; height: number } | undefined {
  const match = /(?:full\s*hd\s*\()?\s*(\d{3,4})\s*[x×]\s*(\d{3,4})/i.exec(prompt);
  if (!match?.[1] || !match[2]) return undefined;
  const width = Number(match[1]);
  const height = Number(match[2]);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function explicitHumor(prompt: string): { value: number; min?: number; max?: number; sourceText: string } | undefined {
  const range = /humor[^\n%]{0,80}(\d+)\s*%\s*(?:a|até|[-–])\s*(\d+)\s*%/i.exec(prompt);
  if (range?.[1] && range[2]) {
    return {
      value: Number(range[2]),
      min: Number(range[1]),
      max: Number(range[2]),
      sourceText: range[0],
    };
  }
  const single = /humor[^\n%]{0,80}(\d+)\s*%/i.exec(prompt);
  if (single?.[1]) return { value: Number(single[1]), sourceText: single[0] };
  return undefined;
}

function explicitLanguage(prompt: string): string | undefined {
  if (/portugu[eê]s(?:\s+brasileiro)?|pt[-\s]?br/i.test(prompt)) return 'pt-BR';
  if (/ingl[eê]s|en[-\s]?us/i.test(prompt)) return 'en-US';
  if (/espanhol|es[-\s]?es/i.test(prompt)) return 'es-ES';
  if (/franc[eê]s|fr[-\s]?fr/i.test(prompt)) return 'fr-FR';
  return undefined;
}

function explicitFormat(prompt: string): DeliveryFormat | undefined {
  if (/9\s*:\s*16|shorts?|reels?|tiktok|vertical/i.test(prompt)) return 'shorts_9_16';
  if (/16\s*:\s*9|youtube|horizontal/i.test(prompt)) return 'youtube_16_9';
  return undefined;
}

function inferredRenderProfile(resolution: { width: number; height: number } | undefined): RenderQualityProfile | undefined {
  if (!resolution) return undefined;
  if (resolution.width >= 1920 && resolution.height >= 1080) return 'master_1080p';
  if (resolution.width >= 1280 && resolution.height >= 720) return 'review_720p';
  return 'draft_540p';
}

function categoryForText(text: string, section: string): ContractRequirementCategory {
  const haystack = normalize(`${section} ${text}`);
  if (/pesquis|fonte|fontes|crunchyroll|anime news|verific/.test(haystack)) return 'research';
  if (/narracao|narrador|voz|pronuncia|roteiro/.test(haystack)) return 'narration';
  if (/edicao|corte|transicao|cartela|color grading|rec 709|motion graphic/.test(haystack)) return 'editing';
  if (/sfx|efeito sonoro|whoosh|riser|impacto/.test(haystack)) return 'sfx';
  if (/vfx|particula|brilho|parallax|energia/.test(haystack)) return 'vfx';
  if (/musica|trilha|ducking/.test(haystack)) return 'music';
  if (/mixagem|lufs|dbtp|volume/.test(haystack)) return 'mixing';
  if (/qualidade|validacao|auditoria|sincron|corrija|renderiz|tela preta|congelamento/.test(haystack)) return 'quality';
  if (/abertura|ranking|conclusao|capitulo|estrutura|climax|top\s*\d/.test(haystack)) return 'narrative';
  if (/duracao|minuto|segundo/.test(haystack)) return 'duration';
  if (/idioma|lingua|pt br|portugues|ingles/.test(haystack)) return 'language';
  if (/formato|youtube|resolucao|full hd|16 9|9 16|plataforma/.test(haystack)) return 'format';
  if (/humor|piada|descontra/.test(haystack)) return 'humor';
  if (/tom|cinematograf|epico|analitico/.test(haystack)) return 'tone';
  if (/midia|cena|trailer|imagem|material|direitos/.test(haystack)) return 'media';
  if (/objetivo|tema|anime|manga|black clover/.test(haystack)) return 'content';
  return 'instruction';
}

function priorityForText(text: string): ContractRequirementPriority {
  return /obrigat[oó]ri|deve|n[aã]o pode|proibido|n[aã]o utilize|evite|prioridade m[aá]xima|regra/i.test(text)
    ? 'mandatory'
    : 'preference';
}

function requirementId(category: ContractRequirementCategory, label: string): string {
  return `req_${category}_${sha12(normalize(label))}`;
}

function criterionId(metric: ContractAcceptanceCriterion['metric'], requirementIdValue: string): string {
  return `criterion_${metric}_${sha12(requirementIdValue)}`;
}

function addRequirement(
  requirements: ContractRequirement[],
  input: Omit<ContractRequirement, 'id' | 'status' | 'criterionIds' | 'dependencyKeys' | 'evidence'> & { dependencyKeys?: string[] },
): ContractRequirement {
  const existing = requirements.find((item) => item.id === requirementId(input.category, input.label));
  if (existing) return existing;
  const next: ContractRequirement = {
    id: requirementId(input.category, input.label),
    category: input.category,
    label: input.label,
    sourceText: input.sourceText,
    ...(input.value !== undefined ? { value: input.value } : {}),
    priority: input.priority,
    status: 'extracted',
    criterionIds: [],
    dependencyKeys: input.dependencyKeys ?? [],
    evidence: [],
  };
  requirements.push(next);
  return next;
}

function controlValueEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addCriterion(
  criteria: ContractAcceptanceCriterion[],
  requirement: ContractRequirement,
  input: Omit<ContractAcceptanceCriterion, 'id' | 'requirementId'>,
): ContractAcceptanceCriterion {
  const next = {
    ...input,
    id: criterionId(input.metric, requirement.id),
    requirementId: requirement.id,
  };
  criteria.push(next);
  requirement.criterionIds.push(next.id);
  return next;
}

function buildInferredControls(prompt: string, interpretation: PromptInterpretation): {
  controls: Partial<ProductionContractControls>;
  explicitFields: Set<ContractControlField>;
  sourceLines: Partial<Record<ContractControlField, string>>;
} {
  const resolution = explicitResolution(prompt);
  const humor = explicitHumor(prompt);
  const language = explicitLanguage(prompt);
  const format = explicitFormat(prompt);
  const targetDurationSec = /\d+\s*(?:minuto|minutos|min|segundo|segundos|seg|s)\b/i.test(prompt)
    ? interpretation.targetDurationSec
    : undefined;
  const genre = interpretation.formatIntent === 'top_ranking'
    ? 'top_list'
    : interpretation.formatIntent === 'documentary'
      ? 'documentary'
      : interpretation.formatIntent === 'trailer'
        ? 'trailer'
        : undefined;
  const creativeSelection = detectCreativeSelection(prompt);
  const deliveryPresetId = detectDeliveryPreset(prompt);
  const inferredPreviewProfile = inferredRenderProfile(resolution);
  const controls: Partial<ProductionContractControls> = {
    ...(genre ? { genre } : {}),
    ...(format ? { format } : {}),
    ...(targetDurationSec ? { targetDurationSec } : {}),
    ...(humor ? { humorIntensity: humor.value } : {}),
    ...(inferredPreviewProfile ? { renderProfile: inferredPreviewProfile } : {}),
    ...(language ? { language } : {}),
    creativeSelection,
    deliveryPresetId,
    ...(inferredPreviewProfile ? { previewProfile: inferredPreviewProfile } : {}),
  };
  const explicitFields = new Set<ContractControlField>();
  if (genre) explicitFields.add('genre');
  if (format) explicitFields.add('format');
  if (targetDurationSec) explicitFields.add('targetDurationSec');
  if (humor) explicitFields.add('humorIntensity');
  if (resolution) explicitFields.add('renderProfile');
  if (language) explicitFields.add('language');
  const sourceLines: Partial<Record<ContractControlField, string>> = {
    ...(genre ? { genre: firstMatchingLine(prompt, /ranking|top\s*\d+|melhores/i) } : {}),
    ...(format ? { format: firstMatchingLine(prompt, /youtube|16\s*:\s*9|9\s*:\s*16|shorts?/i) } : {}),
    ...(targetDurationSec ? { targetDurationSec: firstMatchingLine(prompt, /dura[cç][aã]o|\d+\s*(?:minutos?|min|segundos?|seg|s\b)/i) } : {}),
    ...(humor ? { humorIntensity: humor.sourceText } : {}),
    ...(resolution ? { renderProfile: firstMatchingLine(prompt, /full\s*hd|\d{3,4}\s*[x×]\s*\d{3,4}/i) } : {}),
    ...(language ? { language: firstMatchingLine(prompt, /portugu[eê]s|pt[-\s]?br|ingl[eê]s|en[-\s]?us/i) } : {}),
  };
  return { controls, explicitFields, sourceLines };
}

function defaultControls(
  prompt: string,
  interpretation: PromptInterpretation,
  inferred: Partial<ProductionContractControls>,
  controls: Partial<ProductionContractControls> | undefined,
  manualFields: Set<ContractControlField>,
): ProductionContractControls {
  const defaults: ProductionContractControls = {
    genre: interpretation.formatIntent === 'top_ranking' ? 'top_list' : interpretation.formatIntent === 'trailer' ? 'trailer' : interpretation.formatIntent === 'documentary' ? 'documentary' : 'gameplay_essay',
    format: /9\s*:\s*16|shorts?|reels?|tiktok|vertical/i.test(prompt) ? 'shorts_9_16' : 'youtube_16_9',
    targetDurationSec: interpretation.targetDurationSec,
    humorIntensity: interpretation.humorIntensity,
    renderProfile: 'review_720p',
    language: interpretation.language,
  };
  const fields: ContractControlField[] = ['genre', 'format', 'creativeSelection', 'deliveryPresetId', 'previewProfile', 'targetDurationSec', 'humorIntensity', 'renderProfile', 'language', 'voiceId'];
  const result = { ...defaults } as ProductionContractControls;
  for (const field of fields) {
    const inferredValue = inferred[field];
    const manualValue = controls?.[field];
    if (manualFields.has(field) && manualValue !== undefined) {
      (result as unknown as Record<string, unknown>)[field] = manualValue;
    } else if (inferredValue !== undefined) {
      (result as unknown as Record<string, unknown>)[field] = inferredValue;
    } else if (manualValue !== undefined) {
      (result as unknown as Record<string, unknown>)[field] = manualValue;
    }
  }
  return result;
}

function addExplicitRequirements(
  prompt: string,
  interpretation: PromptInterpretation,
  inferred: ReturnType<typeof buildInferredControls>,
  controls: ProductionContractControls,
): { requirements: ContractRequirement[]; acceptanceCriteria: ContractAcceptanceCriterion[] } {
  const requirements: ContractRequirement[] = [];
  const acceptanceCriteria: ContractAcceptanceCriterion[] = [];
  const add = (category: ContractRequirementCategory, label: string, sourceText: string, value?: unknown, priority: ContractRequirementPriority = 'mandatory') =>
    addRequirement(requirements, { category, label, sourceText, ...(value !== undefined ? { value } : {}), priority });

  const duration = add('duration', 'Duração alvo do vídeo', inferred.sourceLines.targetDurationSec ?? `${controls.targetDurationSec}s`, controls.targetDurationSec);
  addCriterion(acceptanceCriteria, duration, {
    label: 'A duração medida deve ficar próxima do alvo do contrato.',
    kind: 'objective',
    metric: 'duration_sec',
    target: { exact: controls.targetDurationSec },
    tolerance: Math.max(2, Math.round(controls.targetDurationSec * 0.05)),
    blocking: true,
    verification: 'post_render',
  });

  const format = add('format', 'Formato e plataforma de entrega', inferred.sourceLines.format ?? `${controls.format}`, controls.format);
  const resolution = explicitResolution(prompt);
  if (resolution) {
    addCriterion(acceptanceCriteria, format, {
      label: 'A resolução medida deve corresponder ao briefing.',
      kind: 'objective',
      metric: 'resolution',
      target: resolution,
      blocking: true,
      verification: 'post_render',
    });
  }

  const language = add('language', 'Idioma da narração e do roteiro', inferred.sourceLines.language ?? controls.language, controls.language);
  language.dependencyKeys.push('script', 'narration');

  // Media integrity is a pipeline gate even when the briefing does not mention the word "mídia".
  // Keeping it in every contract prevents an acquisition/render failure from disappearing silently.
  const pipelineMedia = add('media', 'Mídia audiovisual correspondente, íntegra e rastreável', 'Gate automático da pipeline de aquisição e renderização.');
  addCriterion(acceptanceCriteria, pipelineMedia, {
    label: 'A mídia usada na montagem deve passar pelos gates de integridade e rastreabilidade.',
    kind: 'objective',
    metric: 'media_integrity',
    target: { exact: 1 },
    blocking: true,
    verification: 'preflight',
  });

  const narrative = add('narrative', interpretation.formatIntent === 'top_ranking' ? `Ranking com ${interpretation.requestedCount ?? 'itens'} posições` : 'Estrutura narrativa solicitada', firstMatchingLine(prompt, /ranking|top\s*\d+|abertura|conclus[aã]o/i), interpretation.formatIntent);
  if (interpretation.requestedCount) {
    addCriterion(acceptanceCriteria, narrative, {
      label: 'A quantidade de capítulos/entidades deve corresponder ao ranking solicitado.',
      kind: 'objective',
      metric: 'chapter_count',
      target: { exact: interpretation.requestedCount },
      blocking: true,
      verification: 'preflight',
    });
  }

  const humor = explicitHumor(prompt);
  if (humor) {
    add('humor', 'Intensidade de humor solicitada', humor.sourceText, { min: humor.min ?? humor.value, max: humor.max ?? humor.value });
  }

  if (resolution && controls.renderProfile === 'review_720p' && resolution.width >= 1920) {
    const requirement = add('format', 'Perfil de render compatível com a resolução solicitada', inferred.sourceLines.renderProfile ?? 'resolução explícita', controls.renderProfile, 'mandatory');
    requirement.status = 'pending';
    requirement.justification = 'O perfil atual é uma revisão 720p, enquanto o briefing solicita Full HD; a escolha manual precisa ser resolvida antes da entrega final.';
  }

  if (/m[ií]dia|cena|correspond[eê]ncia|fonte|autorizad|direitos|trailer/i.test(prompt)) {
    pipelineMedia.sourceText = firstMatchingLine(prompt, /m[ií]dia|cena|direitos|autorizad|fonte/i);
    pipelineMedia.label = 'Mídia correspondente, íntegra e autorizada';
  }
  if (/sincron|correspond[eê]ncia entre|cortes sincronizados/i.test(prompt)) {
    const sync = add('quality', 'Sincronização entre narração, cenas e legendas', firstMatchingLine(prompt, /sincron|correspond[eê]ncia entre|legenda/i));
    addCriterion(acceptanceCriteria, sync, {
      label: 'A sincronização medida deve passar sem divergência bloqueante.',
      kind: 'objective',
      metric: 'synchronization',
      target: { exact: 1 },
      blocking: true,
      verification: 'post_render',
    });
  }
  if (/-14\s*LUFS/i.test(prompt)) {
    const mixing = add('mixing', 'Loudness integrado', firstMatchingLine(prompt, /LUFS/i), -14);
    addCriterion(acceptanceCriteria, mixing, {
      label: 'O loudness integrado deve permanecer dentro de 1 LU do alvo.',
      kind: 'objective',
      metric: 'integrated_lufs',
      target: { exact: -14 },
      tolerance: 1,
      blocking: true,
      verification: 'post_render',
    });
  }
  if (/-1\s*dBTP/i.test(prompt)) {
    const mixing = requirements.find((item) => item.category === 'mixing') ?? add('mixing', 'Limite de true peak', firstMatchingLine(prompt, /dBTP/i), -1);
    addCriterion(acceptanceCriteria, mixing, {
      label: 'O true peak não pode ultrapassar o limite do briefing.',
      kind: 'objective',
      metric: 'true_peak_dbtp',
      target: { exact: -1 },
      tolerance: 0,
      blocking: true,
      verification: 'post_render',
    });
  }
  if (/export|render|arquivo|MP4|Full HD|1920/i.test(prompt)) {
    const exportRequirement = add('quality', 'Parâmetros de exportação e integridade do arquivo', firstMatchingLine(prompt, /export|render|arquivo|MP4|Full HD|1920/i));
    addCriterion(acceptanceCriteria, exportRequirement, {
      label: 'O arquivo final deve ser renderizado e validado pelo probe.',
      kind: 'objective',
      metric: 'export_parameters',
      target: { exact: 1 },
      blocking: true,
      verification: 'post_render',
    });
  }
  if (/cinematogr[aá]fic|qualidade|envolvente|humor|correspond[eê]ncia/i.test(prompt)) {
    const quality = add('quality', 'Qualidade audiovisual e correspondência semântica', firstMatchingLine(prompt, /cinematogr[aá]fic|qualidade|envolvente|correspond[eê]ncia/i), undefined, 'preference');
    addCriterion(acceptanceCriteria, quality, {
      label: 'A avaliação subjetiva deve apresentar evidências e revisão humana.',
      kind: 'subjective',
      metric: 'human_review',
      target: { exact: 1 },
      blocking: false,
      verification: 'human',
    });
  }
  const categoryMarkers: Array<[ContractRequirementCategory, RegExp, string]> = [
    ['research', /pesquis|fonte|crunchyroll|anime news|verific/i, 'Pesquisa e fontes verificáveis'],
    ['narration', /narrac|narrador|voz|pron[uú]ncia/i, 'Narração e voz'],
    ['editing', /edi[cç][aã]o|cortes?|cartelas?|transi[cç][aã]o|compara[cç][oõ]es/i, 'Direção de edição'],
    ['sfx', /sfx|whoosh|riser|impactos?|efeitos sonoros?/i, 'Efeitos sonoros'],
    ['vfx', /vfx|part[ií]culas?|brilhos?|rastros?|parallax|efeitos visuais?/i, 'Efeitos visuais'],
    ['music', /m[uú]sica|trilha|ducking/i, 'Música e trilha'],
    ['mixing', /mixagem|lufs|dbtp|volume/i, 'Mixagem e loudness'],
    ['quality', /qualidade|auditoria|valida[cç][aã]o|sincron|corrompida|tela preta|congelamento/i, 'Controle de qualidade'],
  ];
  for (const [category, pattern, label] of categoryMarkers) {
    if (pattern.test(prompt)) add(category, label, firstMatchingLine(prompt, pattern), undefined, category === 'quality' ? 'mandatory' : 'preference');
  }
  return { requirements, acceptanceCriteria };
}

function addLineRequirements(prompt: string, requirements: ContractRequirement[]): void {
  let section = '';
  const seen = new Set(requirements.map((item) => item.sourceText));
  for (const raw of prompt.split(/\r?\n/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s/.test(trimmed)) {
      section = cleanLine(trimmed);
      continue;
    }
    const line = cleanLine(trimmed);
    if (!line || seen.has(line) || /^[-–—]+$/.test(line)) continue;
    seen.add(line);
    const category = categoryForText(line, section);
    const label = line.replace(/^([^:]{1,60}):\s*/, '$1').slice(0, 120);
    addRequirement(requirements, {
      category,
      label,
      sourceText: line,
      priority: priorityForText(line),
    });
  }
}

function createConflict(
  field: ContractControlField,
  promptValue: unknown,
  manualValue: unknown,
  revision: number,
): ContractConflict {
  return {
    id: `conflict_${field}_${sha12({ promptValue, manualValue, revision })}`,
    field,
    promptValue,
    manualValue,
    resolution: 'manual_value_wins',
    message: `O briefing sugere ${JSON.stringify(promptValue)}, mas o controle manual está em ${JSON.stringify(manualValue)}.`,
    revision,
  };
}

export function extractProductionContract(input: ExtractProductionContractInput): ProductionContract {
  const now = nowOrDefault(input.now);
  const interpretation = interpretProductionPrompt(input.prompt);
  const inferred = buildInferredControls(input.prompt, interpretation);
  const manualFields = new Set(input.manuallyChangedFields ?? []);
  const controls = defaultControls(input.prompt, interpretation, inferred.controls, input.controls, manualFields);
  const { requirements, acceptanceCriteria } = addExplicitRequirements(input.prompt, interpretation, inferred, controls);
  addLineRequirements(input.prompt, requirements);

  const manualOverrides: ContractManualOverride[] = [];
  const conflicts: ContractConflict[] = [];
  for (const field of manualFields) {
    const manualValue = input.controls?.[field];
    const promptValue = inferred.controls[field];
    if (manualValue === undefined) continue;
    manualOverrides.push({ field, ...(promptValue !== undefined ? { promptValue } : {}), manualValue, revision: 1, changedAt: now, reason: 'user_control' });
    if (promptValue !== undefined && !controlValueEqual(promptValue, manualValue)) conflicts.push(createConflict(field, promptValue, manualValue, 1));
  }

  const contractId = `contract_${input.projectId}_${sha12({ projectId: input.projectId, prompt: input.prompt })}`;
  for (const criterion of acceptanceCriteria) {
    const requirement = requirements.find((item) => item.id === criterion.requirementId);
    if (requirement && !requirement.criterionIds.includes(criterion.id)) requirement.criterionIds.push(criterion.id);
  }
  return {
    schemaVersion: PRODUCTION_CONTRACT_SCHEMA_VERSION,
    contractId,
    projectId: input.projectId,
    revision: 1,
    createdAt: now,
    updatedAt: now,
    sourcePrompt: input.prompt,
    sourcePromptHash: sha12(input.prompt),
    interpretation,
    controls,
    inferredControls: inferred.controls,
    manualOverrides,
    requirements,
    acceptanceCriteria,
    conflicts,
    recovery: { attemptsByRequirement: {}, maxAttemptsPerRequirement: 3 },
    ...(controls.creativeSelection ? { creativeSelection: controls.creativeSelection } : {}),
    ...(inferred.controls.creativeSelection ? { inferredCreativeSelection: inferred.controls.creativeSelection } : {}),
    ...(controls.deliveryPresetId ? { deliveryPresetId: controls.deliveryPresetId } : {}),
    ...(inferred.controls.deliveryPresetId ? { inferredDeliveryPresetId: inferred.controls.deliveryPresetId } : {}),
  };
}

export function reviseProductionContract(
  previous: ProductionContract,
  input: Omit<ExtractProductionContractInput, 'projectId'> & { reason: string },
): { current: ProductionContract; previous: ProductionContract } {
  const { reason, ...revisionInput } = input;
  const next = extractProductionContract({
    ...revisionInput,
    projectId: previous.projectId,
    manuallyChangedFields: revisionInput.manuallyChangedFields ?? previous.manualOverrides.map((item) => item.field),
  });
  next.contractId = previous.contractId;
  next.revision = previous.revision + 1;
  next.createdAt = previous.createdAt;
  next.revisionReason = reason;
  next.manualOverrides = next.manualOverrides.map((item) => ({ ...item, revision: next.revision }));
  next.conflicts = next.conflicts.map((item) => ({ ...item, revision: next.revision }));
  next.requirements = next.requirements.map((requirement) => {
    const old = previous.requirements.find((candidate) => candidate.id === requirement.id);
    const changed = !old || old.sourceText !== requirement.sourceText || !controlValueEqual(old.value, requirement.value);
    return changed ? { ...requirement, status: 'pending' as const, evidence: [] } : { ...requirement, evidence: [] };
  });
  next.updatedAt = nowOrDefault(input.now);
  return { current: next, previous };
}

export function recordContractEvidence(
  contract: ProductionContract,
  input: Omit<ContractEvidence, 'evidenceId' | 'requirementId' | 'revision' | 'recordedAt'> & { requirementId: string; recordedAt?: string },
): ProductionContract {
  const requirement = contract.requirements.find((item) => item.id === input.requirementId);
  if (!requirement) return contract;
  const evidence: ContractEvidence = {
    ...input,
    evidenceId: `evidence_${sha12({ contractId: contract.contractId, revision: contract.revision, requirementId: input.requirementId, summary: input.summary, stage: input.stage })}`,
    revision: contract.revision,
    recordedAt: input.recordedAt ?? new Date().toISOString(),
  };
  const status: ContractRequirementStatus = input.satisfiesRequirement === true
    ? 'satisfied'
    : input.outcome === 'contradicts'
      ? 'not_met'
      : input.outcome === 'inconclusive'
        ? requirement.status === 'blocked' ? 'blocked' : 'needs_human_review'
        : requirement.status === 'extracted'
          ? 'in_progress'
          : requirement.status;
  return {
    ...contract,
    updatedAt: evidence.recordedAt,
    requirements: contract.requirements.map((item) => item.id === requirement.id ? { ...item, status, evidence: [...item.evidence, evidence] } : item),
  };
}

export function recordContractRecovery(
  contract: ProductionContract,
  input: { requirementId: string; signature: string; action: string; outcome: string; at?: string },
): ProductionContract {
  const requirement = contract.requirements.find((item) => item.id === input.requirementId);
  if (!requirement || !input.signature.trim()) return contract;
  const attempts = contract.recovery.attemptsByRequirement[input.requirementId] ?? [];
  if (attempts.some((attempt) => attempt.signature === input.signature)) return contract;
  const nextAttempts = [...attempts, {
    signature: input.signature,
    action: input.action,
    outcome: input.outcome,
    at: input.at ?? new Date().toISOString(),
  }];
  const nextStatus: ContractRequirementStatus = nextAttempts.length >= contract.recovery.maxAttemptsPerRequirement ? 'blocked' : 'pending';
  return {
    ...contract,
    updatedAt: nextAttempts[nextAttempts.length - 1]?.at ?? contract.updatedAt,
    recovery: {
      ...contract.recovery,
      attemptsByRequirement: { ...contract.recovery.attemptsByRequirement, [input.requirementId]: nextAttempts },
    },
    requirements: contract.requirements.map((item) => item.id === input.requirementId ? {
      ...item,
      status: nextStatus,
      evidence: [...item.evidence, {
        evidenceId: `evidence_recovery_${sha12({ contractId: contract.contractId, revision: contract.revision, requirementId: input.requirementId, signature: input.signature })}`,
        requirementId: input.requirementId,
        revision: contract.revision,
        stage: 'recovery',
        kind: 'recovery',
        outcome: 'inconclusive',
        summary: `${input.action}: ${input.outcome}`,
        observedValue: { signature: input.signature },
        recordedAt: input.at ?? new Date().toISOString(),
      } satisfies ContractEvidence],
    } : item),
  };
}

function criterionResult(criterion: ContractAcceptanceCriterion, measurements: ContractMeasurementSnapshot): { passed: boolean; observed: unknown; message: string } | undefined {
  switch (criterion.metric) {
    case 'duration_sec': {
      if (measurements.durationSec === undefined) return undefined;
      const tolerance = criterion.tolerance ?? 0;
      const target = criterion.target.exact ?? 0;
      return { passed: Math.abs(measurements.durationSec - target) <= tolerance, observed: measurements.durationSec, message: `Duração medida: ${measurements.durationSec}s; alvo: ${target}s ± ${tolerance}s.` };
    }
    case 'chapter_count': {
      if (measurements.chapterCount === undefined) return undefined;
      const target = criterion.target.exact ?? 0;
      return { passed: measurements.chapterCount === target, observed: measurements.chapterCount, message: `Capítulos medidos: ${measurements.chapterCount}; alvo: ${target}.` };
    }
    case 'resolution': {
      if (measurements.width === undefined || measurements.height === undefined) return undefined;
      const passed = measurements.width === criterion.target.width && measurements.height === criterion.target.height;
      return { passed, observed: { width: measurements.width, height: measurements.height }, message: `Resolução medida: ${measurements.width}x${measurements.height}; alvo: ${criterion.target.width}x${criterion.target.height}.` };
    }
    case 'integrated_lufs': {
      if (measurements.integratedLufs === undefined) return undefined;
      const target = criterion.target.exact ?? 0;
      const tolerance = criterion.tolerance ?? 1;
      return { passed: Math.abs(measurements.integratedLufs - target) <= tolerance, observed: measurements.integratedLufs, message: `Loudness medido: ${measurements.integratedLufs} LUFS; alvo: ${target} ± ${tolerance}.` };
    }
    case 'true_peak_dbtp': {
      if (measurements.truePeakDbtp === undefined) return undefined;
      const target = criterion.target.exact ?? 0;
      return { passed: measurements.truePeakDbtp <= target, observed: measurements.truePeakDbtp, message: `True peak medido: ${measurements.truePeakDbtp} dBTP; limite: ${target} dBTP.` };
    }
    case 'media_integrity': {
      if (measurements.mediaIntegrity === undefined) return undefined;
      return { passed: measurements.mediaIntegrity, observed: measurements.mediaIntegrity, message: measurements.mediaIntegrity ? 'Integridade de mídia aprovada.' : 'Integridade de mídia não aprovada.' };
    }
    case 'synchronization': {
      if (measurements.synchronization === undefined) return undefined;
      return { passed: measurements.synchronization, observed: measurements.synchronization, message: measurements.synchronization ? 'Sincronização aprovada.' : 'Sincronização apresenta divergência.' };
    }
    case 'export_parameters': {
      if (measurements.exportParametersValid === undefined) return undefined;
      return { passed: measurements.exportParametersValid, observed: measurements.exportParametersValid, message: measurements.exportParametersValid ? 'Parâmetros de exportação aprovados.' : 'Parâmetros de exportação não aprovados.' };
    }
    case 'human_review':
      return undefined;
  }
}

export function evaluateProductionContract(
  contract: ProductionContract,
  measurements: ContractMeasurementSnapshot,
): { contract: ProductionContract; report: ContractComplianceReport } {
  const checkedAt = measurements.now ?? new Date().toISOString();
  const issues: ContractComplianceReport['issues'] = [];
  const next = structuredClone(contract) as ProductionContract;
  for (const criterion of next.acceptanceCriteria) {
    const requirement = next.requirements.find((item) => item.id === criterion.requirementId);
    if (!requirement) continue;
    if (criterion.kind === 'subjective') {
      const humanDecision = requirement.evidence.find((evidence) => evidence.kind === 'human');
      if (!humanDecision) requirement.status = 'needs_human_review';
      continue;
    }
    const result = criterionResult(criterion, measurements);
    if (!result) continue;
    const evidence: ContractEvidence = {
      evidenceId: `evidence_${sha12({ contractId: next.contractId, revision: next.revision, criterionId: criterion.id, checkedAt })}`,
      requirementId: requirement.id,
      revision: next.revision,
      stage: criterion.verification === 'post_render' ? 'qc' : 'validation',
      kind: 'measurement',
      outcome: result.passed ? 'supports' : 'contradicts',
      summary: result.message,
      observedValue: result.observed,
      recordedAt: checkedAt,
    };
    requirement.evidence.push(evidence);
    requirement.status = result.passed ? 'satisfied' : 'not_met';
    if (!result.passed) issues.push({ criterionId: criterion.id, requirementId: requirement.id, message: result.message, blocking: criterion.blocking });
  }
  const statuses = next.requirements.map((item) => item.status);
  const report: ContractComplianceReport = {
    checkedAt,
    blocking: issues.some((issue) => issue.blocking),
    satisfiedCount: statuses.filter((status) => status === 'satisfied').length,
    adaptedCount: statuses.filter((status) => status === 'adapted').length,
    pendingCount: statuses.filter((status) => status === 'pending' || status === 'in_progress' || status === 'extracted').length,
    humanReviewCount: statuses.filter((status) => status === 'needs_human_review').length,
    notMetCount: statuses.filter((status) => status === 'not_met').length,
    blockedCount: statuses.filter((status) => status === 'blocked').length,
    issues,
  };
  next.updatedAt = checkedAt;
  return { contract: next, report };
}

export function contractContextForAgent(
  contract: ProductionContract,
  categories?: readonly ContractRequirementCategory[],
): {
  contractId: string;
  revision: number;
  controls: ProductionContractControls;
  conflicts: ContractConflict[];
  requirements: Array<{ id: string; category: ContractRequirementCategory; label: string; value?: unknown; priority: ContractRequirementPriority; status: ContractRequirementStatus }>;
} {
  const allowed = categories ? new Set(categories) : undefined;
  return {
    contractId: contract.contractId,
    revision: contract.revision,
    controls: contract.controls,
    conflicts: contract.conflicts,
    requirements: contract.requirements
      .filter((item) => !allowed || allowed.has(item.category))
      .map((item) => ({ id: item.id, category: item.category, label: item.label, ...(item.value !== undefined ? { value: item.value } : {}), priority: item.priority, status: item.status })),
  };
}
