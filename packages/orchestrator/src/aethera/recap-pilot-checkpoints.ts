import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { segmentAnalysisSchema, type SegmentAnalysis } from '@neuralbridge/shared';
import { z } from 'zod';
import type { VisionProviderUsage } from './vision-router.js';

/** Versioned identities for the experimental local pilot. Bump the relevant value when its contract changes. */
export const RECAP_PILOT_PANEL_CHECKPOINT_VERSION = 'recap-pilot-panel-v1';
export const RECAP_PILOT_PROMPT_VERSION = 'local-panel-v3';
export const RECAP_PILOT_PREPROCESSING_VERSION = 'crop-v1';
export const RECAP_PILOT_CACHE_VERSION = 'recap-pilot-qwen35-structured-ocr-evidence-v1';

export interface RecapPilotBoundingBox { x: number; y: number; w: number; h: number }

/** The dataset manifest fields used to bind a result to its original location. */
export interface RecapPilotPanelManifestEntry {
  panelId: string;
  pagePath: string;
  cropPath: string;
  pageNumber: number;
  panelIndex: number;
  readingOrder: string;
  classification?: string;
  aspect?: number;
  boundingBox: RecapPilotBoundingBox;
  width: number;
  height: number;
  sha256: string;
  sourceKind: string;
  origin: string;
}

export interface RecapPilotSettings {
  think: boolean;
  structuredOutput: boolean;
  temperature: number;
  panelNames: 'visual-only' | 'model';
  sfxFilter: boolean;
  maxImagesPerCall: number;
  stream: boolean;
  contextTokens: number;
  maxOutputTokens: number;
  ocrPass: 'off' | 'tall' | 'always';
  ocrEnabled: boolean;
  maxTileAspect: number | null;
}

export interface RecapPilotPanelIdentity {
  provider: string;
  model: string;
  promptVersion: string;
  schemaVersion: number;
  preprocessingVersion: string;
  cacheVersion: string;
  contextFingerprint: string;
  settings: RecapPilotSettings;
}

export interface RecapPilotBlockCheckpoint {
  index: number;
  y0: number;
  y1: number;
  cacheKey: string;
  tilePath: string | null;
  cacheHit: boolean;
  status: 'complete' | 'failed' | 'cancelled';
  inputTokens: number | null;
  outputTokens: number | null;
  wallMs: number | null;
  ocrCompleted: boolean;
  ocrLines: readonly { text: string; region: string }[];
  ocrSfxFiltered: number | null;
  ocrError: string | null;
}

export interface RecapPilotOcrCheckpoint {
  blockIndex: number;
  status: 'not_selected' | 'completed' | 'failed' | 'cancelled';
  rawLinesPersisted: boolean;
  lines: readonly { text: string; region: string }[];
  sfxFiltered: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  error: string | null;
}

export interface RecapPilotNarrativeProvenance {
  kind: 'observation' | 'dialogue';
  text: string;
  frameIndex: number;
  blockIndex: number | null;
  y0: number | null;
  y1: number | null;
  region: string | null;
  basis: 'observed' | 'inferred' | null;
}

export interface RecapPilotPanelResult {
  checkpointVersion: string;
  cacheKey: string;
  createdAt: string;
  panel: RecapPilotPanelManifestEntry;
  identity: RecapPilotPanelIdentity;
  reportedModel: string | null;
  analysis: SegmentAnalysis;
  blocks: readonly RecapPilotBlockCheckpoint[];
  ocr: readonly RecapPilotOcrCheckpoint[];
  provenance: readonly RecapPilotNarrativeProvenance[];
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    cachedTokens: number | null;
    cacheWriteTokens: number | null;
    effectiveApiCostUsd: number | null;
    estimatedCostUsd: number | null;
    quotaUnits: number | null;
    wallMs: number | null;
    vramMb: number | null;
  };
  validation: {
    schema: 'pass';
    narrative: 'unverified';
    errors: readonly string[];
  };
}

/** Stable content-addressed key. Context is deliberately part of the identity. */
export function recapPilotPanelCacheKey(panel: RecapPilotPanelManifestEntry, identity: RecapPilotPanelIdentity): string {
  const canonical = JSON.stringify({
    version: RECAP_PILOT_PANEL_CHECKPOINT_VERSION,
    panel: {
      panelId: panel.panelId,
      sha256: panel.sha256,
      pageNumber: panel.pageNumber,
      panelIndex: panel.panelIndex,
      boundingBox: panel.boundingBox,
      width: panel.width,
      height: panel.height,
    },
    identity,
  });
  return createHash('sha256').update(canonical).digest('hex');
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, content, 'utf8');
  renameSync(temp, path);
}

function usageTotals(usages: readonly (VisionProviderUsage | null | undefined)[], wallMs: number | null, vramMb: number | null): RecapPilotPanelResult['usage'] {
  const sum = (selector: (usage: VisionProviderUsage) => number | null | undefined): number | null => {
    let total = 0;
    for (const usage of usages) {
      const value = usage ? selector(usage) : null;
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
      total += value;
    }
    return total;
  };
  return {
    inputTokens: sum((usage) => usage.inputTokens),
    outputTokens: sum((usage) => usage.outputTokens),
    cachedTokens: sum((usage) => usage.cachedTokens),
    cacheWriteTokens: sum((usage) => usage.cacheWriteTokens),
    effectiveApiCostUsd: sum((usage) => usage.effectiveApiCostUsd),
    estimatedCostUsd: sum((usage) => usage.estimatedCostUsd),
    quotaUnits: sum((usage) => usage.quotaUnits),
    wallMs,
    vramMb,
  };
}

export interface BuildRecapPilotPanelResultInput {
  panel: RecapPilotPanelManifestEntry;
  identity: RecapPilotPanelIdentity;
  reportedModel: string | null;
  analysis: SegmentAnalysis;
  blocks: readonly RecapPilotBlockCheckpoint[];
  ocr: readonly RecapPilotOcrCheckpoint[];
  usages: readonly (VisionProviderUsage | null | undefined)[];
  wallMs: number | null;
  vramMb: number | null;
}

export function buildRecapPilotNarrativeProvenance(
  analysis: SegmentAnalysis,
  blocks: readonly RecapPilotBlockCheckpoint[],
): RecapPilotNarrativeProvenance[] {
  return analysis.frames.flatMap((frame, frameIndex) => {
    const block = blocks[frameIndex] ?? null;
    const base = {
      frameIndex,
      blockIndex: block?.index ?? null,
      y0: block?.y0 ?? null,
      y1: block?.y1 ?? null,
    };
    return [
      { kind: 'observation' as const, text: frame.observed, ...base, region: null, basis: 'observed' as const },
      ...frame.visibleText.map((line) => ({ kind: 'dialogue' as const, text: line.text, ...base, region: line.region, basis: 'observed' as const })),
    ];
  });
}

export function buildRecapPilotPanelResult(input: BuildRecapPilotPanelResultInput): RecapPilotPanelResult {
  const analysis = segmentAnalysisSchema.parse(input.analysis);
  return {
    checkpointVersion: RECAP_PILOT_PANEL_CHECKPOINT_VERSION,
    cacheKey: recapPilotPanelCacheKey(input.panel, input.identity),
    createdAt: new Date().toISOString(),
    panel: input.panel,
    identity: input.identity,
    reportedModel: input.reportedModel,
    analysis,
    blocks: input.blocks,
    ocr: input.ocr,
    provenance: buildRecapPilotNarrativeProvenance(analysis, input.blocks),
    usage: usageTotals(input.usages, input.wallMs, input.vramMb),
    validation: { schema: 'pass', narrative: 'unverified', errors: [] },
  };
}

function resultSchema(): import('zod').ZodType<RecapPilotPanelResult> {
  // The domain schema remains authoritative for the model result. This outer schema verifies
  // checkpoint completeness and metadata without loosening the narrative contract.
  const number = z.number().finite().nonnegative();
  const nullable = number.nullable();
  const box = z.strictObject({ x: number, y: number, w: number, h: number });
  const panel = z.strictObject({
    panelId: z.string().min(1), pagePath: z.string().min(1), cropPath: z.string().min(1), pageNumber: z.number().int().nonnegative(), panelIndex: z.number().int().nonnegative(), readingOrder: z.string().min(1), classification: z.string().optional(), aspect: number.optional(), boundingBox: box, width: number, height: number, sha256: z.string().regex(/^[a-f0-9]{64}$/u), sourceKind: z.string().min(1), origin: z.string().min(1),
  });
  const settings = z.strictObject({ think: z.boolean(), structuredOutput: z.boolean(), temperature: number, panelNames: z.enum(['visual-only', 'model']), sfxFilter: z.boolean(), maxImagesPerCall: z.number().int().positive(), stream: z.boolean(), contextTokens: z.number().int().positive(), maxOutputTokens: z.number().int().positive(), ocrPass: z.enum(['off', 'tall', 'always']), ocrEnabled: z.boolean(), maxTileAspect: nullable });
  const identity = z.strictObject({ provider: z.string().min(1), model: z.string().min(1), promptVersion: z.string().min(1), schemaVersion: z.number().int().positive(), preprocessingVersion: z.string().min(1), cacheVersion: z.string().min(1), contextFingerprint: z.string().regex(/^[a-f0-9]{64}$/u), settings });
  const line = z.strictObject({ text: z.string().min(1).max(200), region: z.string().min(1) });
  const block = z.strictObject({ index: z.number().int().nonnegative(), y0: number, y1: number, cacheKey: z.string().min(1), tilePath: z.string().nullable(), cacheHit: z.boolean(), status: z.enum(['complete', 'failed', 'cancelled']), inputTokens: nullable, outputTokens: nullable, wallMs: nullable, ocrCompleted: z.boolean(), ocrLines: z.array(line), ocrSfxFiltered: nullable, ocrError: z.string().nullable() });
  const ocr = z.strictObject({ blockIndex: z.number().int().nonnegative(), status: z.enum(['not_selected', 'completed', 'failed', 'cancelled']), rawLinesPersisted: z.boolean(), lines: z.array(line), sfxFiltered: nullable, inputTokens: nullable, outputTokens: nullable, error: z.string().nullable() });
  const provenance = z.strictObject({ kind: z.enum(['observation', 'dialogue']), text: z.string().min(1), frameIndex: z.number().int().nonnegative(), blockIndex: z.number().int().nonnegative().nullable(), y0: nullable, y1: nullable, region: z.string().nullable(), basis: z.enum(['observed', 'inferred']).nullable() });
  const usage = z.strictObject({ inputTokens: nullable, outputTokens: nullable, cachedTokens: nullable, cacheWriteTokens: nullable, effectiveApiCostUsd: nullable, estimatedCostUsd: nullable, quotaUnits: nullable, wallMs: nullable, vramMb: nullable });
  return z.strictObject({ checkpointVersion: z.literal(RECAP_PILOT_PANEL_CHECKPOINT_VERSION), cacheKey: z.string().regex(/^[a-f0-9]{64}$/u), createdAt: z.string().datetime(), panel, identity, reportedModel: z.string().nullable(), analysis: segmentAnalysisSchema, blocks: z.array(block).min(1), ocr: z.array(ocr), provenance: z.array(provenance), usage, validation: z.strictObject({ schema: z.literal('pass'), narrative: z.literal('unverified'), errors: z.array(z.string()) }) }) as import('zod').ZodType<RecapPilotPanelResult>;
}

export class RecapPilotPanelCheckpointStore {
  private readonly directory: string;
  private readonly schema = resultSchema();

  constructor(directory: string) { this.directory = directory; }

  pathFor(cacheKey: string): string { return join(this.directory, `${cacheKey}.json`); }

  read(panel: RecapPilotPanelManifestEntry, identity: RecapPilotPanelIdentity): RecapPilotPanelResult | null {
    const cacheKey = recapPilotPanelCacheKey(panel, identity);
    const path = this.pathFor(cacheKey);
    if (!existsSync(path)) return null;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { ocr?: unknown };
      let migrated = false;
      // Fase 4B.6 migration: old panel checkpoints did not retain raw OCR lines. They remain
      // valid narrative checkpoints, but the missing provenance is explicitly marked false.
      if (Array.isArray(raw.ocr)) raw.ocr = raw.ocr.map((entry) => {
        if (!entry || typeof entry !== 'object') return entry;
        const source = entry as { rawLinesPersisted?: unknown };
        if (!Object.prototype.hasOwnProperty.call(source, 'rawLinesPersisted')) migrated = true;
        return { ...(entry as Record<string, unknown>), rawLinesPersisted: source.rawLinesPersisted === true };
      });
      const parsed = this.schema.parse(raw);
      if (parsed.cacheKey !== cacheKey || parsed.panel.panelId !== panel.panelId || parsed.panel.sha256 !== panel.sha256) return null;
      if (parsed.analysis.frames.length === 0 || parsed.blocks.length === 0) return null;
      if (migrated) atomicWrite(path, `${JSON.stringify(parsed, null, 2)}\n`);
      return parsed;
    } catch {
      return null;
    }
  }

  write(result: RecapPilotPanelResult): string {
    const parsed = this.schema.parse(result);
    const path = this.pathFor(parsed.cacheKey);
    atomicWrite(path, `${JSON.stringify(parsed, null, 2)}\n`);
    return path;
  }
}

export function usageFromProvider(usage: VisionProviderUsage | null | undefined): VisionProviderUsage | null {
  return usage ?? null;
}
