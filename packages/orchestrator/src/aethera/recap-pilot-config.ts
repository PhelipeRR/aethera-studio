import { createOllamaLocalVlmProvider } from './vision-providers.js';
import { createTiledPanelProvider } from './panel-tiling.js';
import { DEFAULT_RECAP_PILOT_BUDGET, RecapPilotBudget, sampleNvidiaVramMb, type RecapPilotBudgetConfig, type RecapPilotVramSampler } from './recap-pilot-budget.js';
import { RECAP_PILOT_CACHE_VERSION, RECAP_PILOT_PREPROCESSING_VERSION, RECAP_PILOT_PROMPT_VERSION } from './recap-pilot-checkpoints.js';
import type { VisualAnalysisProvider } from './vision-router.js';

/** Explicit, opt-in provider configuration for the 40-panel local pilot. */
export const RECAP_PILOT_PROVIDER_CONFIG = {
  model: 'qwen3.5:4b-q4_K_M',
  think: false,
  structuredOutput: true,
  temperature: 0.2,
  panelNames: 'visual-only' as const,
  sfxFilter: true,
  ocrPass: 'off' as const,
  maxImagesPerCall: 1,
  stream: false,
  estimateVisualTokensFromImage: true,
  ocrMaxOutputTokens: 400,
  maxCpuFallbacks: 2,
  cpuFallbackOnDegenerateOutput: true,
  maxVramMb: DEFAULT_RECAP_PILOT_BUDGET.maxVramMb,
  contextTokens: 4096,
  maxOutputTokens: 560,
};

export { RECAP_PILOT_CACHE_VERSION, RECAP_PILOT_PREPROCESSING_VERSION, RECAP_PILOT_PROMPT_VERSION };

export interface RecapPilotProviderInput {
  jobId: string;
  cacheDir: string;
  ledgerPath?: string;
  baseUrl?: string;
  budget?: RecapPilotBudget;
  budgetConfig?: Partial<RecapPilotBudgetConfig>;
  vramSampler?: RecapPilotVramSampler;
}

export interface RecapPilotProviderResult {
  provider: VisualAnalysisProvider & { lastTiling(): unknown };
  budget: RecapPilotBudget;
}

/**
 * Builds the experimental path without changing the global Aethera provider defaults. The
 * returned budget is shared by Ollama analysis, CPU fallback, OCR and the tiling checkpoint.
 */
export function createRecapPilotProvider(input: RecapPilotProviderInput): RecapPilotProviderResult {
  const budget = input.budget ?? new RecapPilotBudget({
    jobId: input.jobId,
    ...(input.budgetConfig ? { config: input.budgetConfig } : {}),
    ...(input.ledgerPath ? { ledgerPath: input.ledgerPath } : {}),
    vramSampler: input.vramSampler ?? (() => sampleNvidiaVramMb()),
  });
  const base = createOllamaLocalVlmProvider({
    ...RECAP_PILOT_PROVIDER_CONFIG,
    maxCpuFallbacks: budget.limits.maxCpuFallbacks,
    maxVramMb: budget.limits.maxVramMb,
    ...(input.baseUrl ? { baseUrl: input.baseUrl } : {}),
    budget,
  });
  const provider = createTiledPanelProvider({
    base,
    cacheDir: input.cacheDir,
    ...(input.ledgerPath ? { ledgerPath: input.ledgerPath } : {}),
    cacheVersion: RECAP_PILOT_CACHE_VERSION,
    contextTokens: 4096,
    promptTokens: 420,
    outputReserveTokens: 560,
    safetyTokens: 128,
    patchPx: 32,
    overlapPx: 160,
    maxTileAspect: 2,
    ocr: { enabled: true, maxCalls: budget.limits.maxOcrCalls, minScore: 0.22 },
    budget,
  });
  return { provider, budget };
}
