export type LoraArchitecture = 'sd15' | 'sdxl' | 'flux' | 'unknown';
export type LoraCompatibility = 'compatible' | 'incompatible' | 'unknown';
export type LoraCategory = 'character' | 'style' | 'lighting' | 'effects' | 'identity' | 'games' | 'unknown';
export type LoraPriority = 'essential' | 'high' | 'medium' | 'optional' | 'as_needed';

export interface LoraMetadata {
  architecture?: LoraArchitecture;
  baseModel?: string;
  triggerWords?: string[];
  category?: LoraCategory;
  notes?: string;
}

export interface LoraCatalogEntry {
  model: string;
  label: string;
  architecture: LoraArchitecture;
  compatibility: LoraCompatibility;
  category: LoraCategory;
  priority: LoraPriority;
  purpose: string;
  triggerWords: string[];
  tags: string[];
  metadataVerified: boolean;
  reason: string;
}

export interface LoraSelection {
  model: string;
  strengthModel: number;
  strengthClip: number;
  reason: string;
  confidence: 'high' | 'medium';
}

export interface LoraSelectionResult {
  selected: LoraSelection[];
  explanation: string;
  warnings: string[];
}

const ARCHITECTURE_ALIASES: Record<Exclude<LoraArchitecture, 'unknown'>, string[]> = {
  sd15: ['sd15', 'sd 1.5', 'sd-1.5', 'stable-diffusion-v1', 'v1-5'],
  sdxl: ['sdxl', 'sd xl', 'stable-diffusion-xl', 'xl-base', 'xl_v1', 'animagine', 'illustrious', 'juggernaut-xl'],
  flux: ['flux', 'rectified-flow'],
};

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFKC').replace(/[_./\\-]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokens(value: string): string[] {
  return [...new Set(normalize(value).split(/\s+/u).filter((token) => token.length >= 2))];
}

function architectureFromText(value: string): LoraArchitecture {
  const normalized = normalize(value);
  for (const architecture of ['flux', 'sdxl', 'sd15'] as const) {
    if (ARCHITECTURE_ALIASES[architecture].some((alias) => normalized.includes(normalize(alias)))) return architecture;
  }
  return 'unknown';
}

function checkpointArchitecture(checkpoint: string): LoraArchitecture {
  return architectureFromText(checkpoint);
}

function labelFromModel(model: string): string {
  const file = model.split(/[\\/]/u).pop() ?? model;
  return file.replace(/\.(?:safetensors|ckpt|pt|pth|bin|onnx)$/iu, '').replace(/[_-]+/g, ' ').trim() || model;
}

function categoryFromModel(model: string): LoraCategory {
  const value = normalize(model);
  if (/character|person|identity|face|hero|goku|vegeta|naruto|gojo/u.test(value)) return 'character';
  if (/game|gaming|valorant|fortnite|league|elden|zelda|minecraft/u.test(value)) return 'games';
  if (/light|lighting|illumination|rim/u.test(value)) return 'lighting';
  if (/effect|vfx|energy|fire|smoke|neon/u.test(value)) return 'effects';
  if (/style|anime|cinematic|illustration|lineart/u.test(value)) return 'style';
  return 'unknown';
}

function priorityForCategory(category: LoraCategory): LoraPriority {
  if (category === 'character' || category === 'identity') return 'high';
  if (category === 'style' || category === 'lighting') return 'medium';
  if (category === 'effects') return 'optional';
  if (category === 'games') return 'as_needed';
  return 'as_needed';
}

function purposeForCategory(category: LoraCategory): string {
  if (category === 'character') return 'Fidelidade de personagens específicos.';
  if (category === 'identity') return 'Identidade visual e consistência facial.';
  if (category === 'lighting') return 'Iluminação e atmosfera dramática.';
  if (category === 'effects') return 'Energia, aura e efeitos estilizados.';
  if (category === 'games') return 'Estilos específicos de jogos, conforme necessidade.';
  if (category === 'style') return 'Traço e linguagem visual, incluindo cinematográfico ou mangá.';
  return 'Finalidade ainda não classificada; requer revisão manual.';
}

function cleanWords(words: string[] | undefined): string[] {
  return [...new Set((words ?? []).flatMap((word) => tokens(word)))];
}

export function parseSafetensorsLoraMetadata(header: string | Uint8Array): LoraMetadata & { metadataVerified: boolean } {
  let parsed: Record<string, unknown>;
  try {
    const json = typeof header === 'string' ? header : new TextDecoder().decode(header);
    parsed = JSON.parse(json) as Record<string, unknown>;
  } catch {
    return { architecture: 'unknown', triggerWords: [], metadataVerified: false };
  }
  const raw = parsed['__metadata__'];
  const metadata = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const rawArchitecture = [
    metadata['ss_base_model_version'],
    metadata['modelspec.architecture'],
    metadata['ss_sd_model_name'],
    metadata['ss_network_module'],
  ].filter((value): value is string => typeof value === 'string').join(' ');
  const architecture = architectureFromText(rawArchitecture);
  const rawTriggers = metadata['ss_trigger_words'];
  const triggerWords = Array.isArray(rawTriggers)
    ? cleanWords(rawTriggers.filter((value): value is string => typeof value === 'string'))
    : typeof rawTriggers === 'string'
      ? cleanWords(rawTriggers.split(/[,;\n]/u))
      : [];
  const baseModel = [metadata['ss_sd_model_name'], metadata['modelspec.architecture']]
    .find((value): value is string => typeof value === 'string');
  return {
    architecture,
    ...(baseModel ? { baseModel } : {}),
    triggerWords,
    metadataVerified: architecture !== 'unknown',
  };
}

export function buildLoraCatalog(
  models: string[],
  checkpoint: string,
  metadata: Record<string, LoraMetadata> = {},
): LoraCatalogEntry[] {
  const checkpointFamily = checkpointArchitecture(checkpoint);
  return [...new Set(models.filter((model) => typeof model === 'string' && model.trim()))].sort((a, b) => a.localeCompare(b)).map((model) => {
    const modelMetadata = metadata[model] ?? {};
    const architecture = modelMetadata.architecture ?? 'unknown';
    const compatibility: LoraCompatibility = architecture === 'unknown' || checkpointFamily === 'unknown'
      ? 'unknown'
      : architecture === checkpointFamily ? 'compatible' : 'incompatible';
    const triggerWords = cleanWords(modelMetadata.triggerWords);
    const category = modelMetadata.category ?? categoryFromModel(model);
    const priority = priorityForCategory(category);
    const tags = [...new Set([...tokens(model), ...triggerWords, ...(category === 'unknown' ? [] : [category])])];
    const metadataVerified = architecture !== 'unknown';
    return {
      model,
      label: labelFromModel(model),
      architecture,
      compatibility,
      category,
      priority,
      purpose: purposeForCategory(category),
      triggerWords,
      tags,
      metadataVerified,
      reason: compatibility === 'compatible'
        ? `${architecture} confirmado e compatível com o checkpoint ${checkpoint}.`
        : compatibility === 'incompatible'
          ? `${architecture} não é compatível com o checkpoint ${checkpointFamily}.`
          : 'Compatibilidade não verificada: faltam metadados de arquitetura do LoRA ou do checkpoint.',
    } satisfies LoraCatalogEntry;
  });
}

export function filterLoraCatalog(catalog: LoraCatalogEntry[], query: string): LoraCatalogEntry[] {
  const needle = normalize(query);
  if (!needle) return catalog;
  const queryTokens = tokens(needle);
  return catalog.filter((entry) => {
    const haystack = normalize([entry.model, entry.label, entry.category, ...entry.tags, ...entry.triggerWords].join(' '));
    return haystack.includes(needle) || queryTokens.every((token) => haystack.includes(token));
  });
}

export function selectLorasForPrompt(prompt: string, catalog: LoraCatalogEntry[], max = 2): LoraSelectionResult {
  const promptTokens = new Set(tokens(prompt));
  const eligible = catalog
    .filter((entry) => entry.compatibility === 'compatible' && entry.metadataVerified)
    .map((entry) => {
      const matchedTriggers = entry.triggerWords.filter((word) => promptTokens.has(word));
      const matchedTags = entry.tags.filter((tag) => promptTokens.has(tag));
      const score = matchedTriggers.length * 3 + matchedTags.length;
      return { entry, score, matchedTriggers, matchedTags };
    })
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.model.localeCompare(b.entry.model))
    .slice(0, Math.max(1, Math.min(3, Math.floor(max))));
  if (eligible.length === 0) {
    return {
      selected: [],
      explanation: 'Nenhum LoRA verificado e compatível correspondeu ao prompt; geração segue sem LoRA.',
      warnings: catalog.length === 0
        ? ['Nenhum LoRA foi descoberto no ComfyUI.']
        : ['Os LoRAs instalados não têm compatibilidade/metadados suficientes para seleção automática.'],
    };
  }
  return {
    selected: eligible.map(({ entry, matchedTriggers, matchedTags }) => ({
      model: entry.model,
      strengthModel: 0.45,
      strengthClip: 0.35,
      reason: `correspondência ${[...matchedTriggers, ...matchedTags].join(', ')}`,
      confidence: matchedTriggers.length > 0 ? 'high' : 'medium',
    })),
    explanation: `LoRA(s) selecionado(s) automaticamente: ${eligible.map(({ entry }) => entry.label).join(', ')}.`,
    warnings: [],
  };
}

export interface LoraStackItem {
  model: string;
  strengthModel?: number;
  strengthClip?: number;
  nodeType?: 'LoraLoader' | 'LoraLoaderModelOnly';
}

export function normalizeLoraStack(stack: LoraStackItem[], max = 3): LoraStackItem[] {
  const seen = new Set<string>();
  const result: LoraStackItem[] = [];
  for (const item of stack) {
    const model = item.model.trim();
    if (!model || model.includes('..') || model.includes('\\') || model.startsWith('/') || /^[A-Za-z]:/u.test(model)) {
      throw new Error('LoRA inválido: use apenas o nome relativo reportado pelo ComfyUI.');
    }
    if (seen.has(model)) continue;
    seen.add(model);
    result.push({
      model,
      ...(item.strengthModel !== undefined ? { strengthModel: Math.max(-5, Math.min(5, item.strengthModel)) } : {}),
      ...(item.strengthClip !== undefined ? { strengthClip: Math.max(-5, Math.min(5, item.strengthClip)) } : {}),
      ...(item.nodeType ? { nodeType: item.nodeType } : {}),
    });
    if (result.length >= Math.max(1, Math.min(3, Math.floor(max)))) break;
  }
  return result;
}
