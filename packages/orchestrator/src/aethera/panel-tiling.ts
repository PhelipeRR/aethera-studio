import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { segmentAnalysisSchema, type SegmentAnalysis } from '@neuralbridge/shared';
import type { RecapPilotBudget } from './recap-pilot-budget.js';
import type { VisionFrame, VisionOcrLine, VisionOcrResult, VisionProviderUsage, VisualAnalysisProvider } from './vision-router.js';

/**
 * Fase 4B.9 — vertical tiling of tall manga/manhwa panels for a local VLM.
 *
 * qwen3.5 encodes an image as ~ceil(w/32)·ceil(h/32) tokens (measured: p0_0 800×1645 → 1615
 * input tokens with a ~316-token prompt). p28_1 (800×8781) needs 4369 and Ollama rejects it at
 * num_ctx 4096; very tall panels that do fit lose balloons. Tiles are sized by the token budget
 * (context − prompt − output reserve − margin), cut at blank full-width gutters when one exists
 * (nothing crosses such a row: no balloon, no character), otherwise cut with overlap and flagged.
 * The original file is never modified; tiles and per-tile analyses are cached by content.
 */

export const TILING_VERSION = 'tiling-v2-ocr-evidence';
export const RECAP_TILE_CONTEXT_TOO_SMALL = 'RECAP_TILE_CONTEXT_TOO_SMALL';
export const RECAP_TILE_ANALYSIS_FAILED = 'RECAP_TILE_ANALYSIS_FAILED';
export const RECAP_TILE_LIMIT = 'RECAP_TILE_LIMIT';
/** Output schema keeps at most 8 frames per analysis: one frame per tile. */
const MAX_TILES = 8;
const UNNAMED = 'personagem nao identificado';

export interface TileBudget {
  contextTokens: number;
  /** Text prompt tokens (measured ~316 for the v3 prompt; keep a margin). */
  promptTokens: number;
  /** num_predict reserved for the answer. */
  outputReserveTokens: number;
  /** Margin for template/estimate error. */
  safetyTokens: number;
  /** Vision patch edge in pixels (qwen3.5 merged patch: 32). */
  patchPx: number;
}

export function estimateImageTokens(width: number, height: number, patchPx = 32): number {
  return Math.ceil(width / patchPx) * Math.ceil(height / patchPx);
}

export interface PanelTextEvidence {
  score: number;
  inkDensity: number;
  rowSignal: number;
}

/**
 * Conservative, deterministic text-density signal. It is only a selector for OCR; it is not
 * a transcription and must never be treated as proof that a panel contains dialogue.
 */
export function estimateTextEvidence(gray: Uint8Array, width: number, height: number): PanelTextEvidence {
  if (width < 1 || height < 1 || gray.length < width * height) return { score: 0, inkDensity: 0, rowSignal: 0 };
  const rowStep = Math.max(1, Math.floor(height / 240));
  const colStep = Math.max(1, Math.floor(width / 160));
  let dark = 0;
  let samples = 0;
  let signalRows = 0;
  for (let y = 0; y < height; y += rowStep) {
    let rowDark = 0;
    let transitions = 0;
    let previousDark = false;
    for (let x = 0; x < width; x += colStep) {
      const isDark = gray[y * width + x]! < 160;
      if (isDark) { dark += 1; rowDark += 1; }
      if (samples > 0 && isDark !== previousDark) transitions += 1;
      previousDark = isDark;
      samples += 1;
    }
    const rowDensity = rowDark / Math.max(1, Math.ceil(width / colStep));
    if (rowDensity >= 0.02 && rowDensity <= 0.55 && transitions >= 4) signalRows += 1;
  }
  const inkDensity = dark / Math.max(1, samples);
  const rowSignal = signalRows / Math.max(1, Math.ceil(height / rowStep));
  const score = Math.min(1, Math.max(0, 0.45 * Math.min(1, inkDensity / 0.18) + 0.55 * Math.min(1, rowSignal / 0.12)));
  return { score, inkDensity, rowSignal };
}

/** Tallest tile (px, multiple of the patch) whose image tokens fit what the context leaves. */
export function maxTileHeightForContext(input: TileBudget & { width: number }): number {
  const imageBudget = input.contextTokens - input.promptTokens - input.outputReserveTokens - input.safetyTokens;
  const columns = Math.ceil(input.width / input.patchPx);
  const patchRows = Math.floor(imageBudget / columns);
  if (patchRows < 4) {
    throw Object.assign(new Error(`${RECAP_TILE_CONTEXT_TOO_SMALL}: contexto ${input.contextTokens} − prompt ${input.promptTokens} − saída ${input.outputReserveTokens} − margem ${input.safetyTokens} = ${imageBudget} tokens de imagem; largura ${input.width}px exige ${columns} por faixa de ${input.patchPx}px.`), { code: RECAP_TILE_CONTEXT_TOO_SMALL });
  }
  return patchRows * input.patchPx;
}

export type TileCut = 'gutter' | 'uncertain' | 'end';
export interface PanelTile { index: number; y0: number; y1: number; /** How this tile's lower edge was cut. */ cutBelow: TileCut }
export interface PanelTilePlan { tiles: PanelTile[]; gutterCuts: number; uncertainCuts: number }

/** Per-row standard deviation of a grayscale image (one byte per pixel). */
function rowDeviation(gray: Uint8Array, width: number, height: number): Float64Array {
  const out = new Float64Array(height);
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    let squares = 0;
    const offset = y * width;
    for (let x = 0; x < width; x += 1) {
      const value = gray[offset + x]!;
      sum += value;
      squares += value * value;
    }
    const mean = sum / width;
    out[y] = Math.sqrt(Math.max(0, squares / width - mean * mean));
  }
  return out;
}

/**
 * Deterministic vertical split. A gutter is a run of ≥ gutterMinRows rows whose deviation is
 * ≤ gutterMaxStd (white/black band across the whole width). Each tile ends at the latest gutter
 * centre inside [start + minTile, start + maxTile]; without one, at the calmest row of that window,
 * with `overlapPx` shared by both tiles, and the cut is flagged uncertain.
 */
export function planPanelTiles(input: {
  width: number; height: number; gray: Uint8Array; maxTileHeight: number; overlapPx: number;
  minTileHeight?: number; gutterMinRows?: number; gutterMaxStd?: number;
}): PanelTilePlan {
  const { width, height, gray, maxTileHeight } = input;
  if (gray.length < width * height) throw new Error(`planPanelTiles: ${gray.length} bytes para ${width}×${height}.`);
  const overlap = Math.max(0, Math.min(Math.floor(input.overlapPx), Math.floor(maxTileHeight / 4)));
  const minTile = Math.max(1, Math.min(input.minTileHeight ?? Math.floor(maxTileHeight / 2), maxTileHeight));
  const minRun = input.gutterMinRows ?? 8;
  const maxStd = input.gutterMaxStd ?? 6;
  const deviation = rowDeviation(gray, width, height);
  // Every row of a gutter run is blank across the width, so any of them is a safe cut; a run
  // that continues past the window (black band fading into a smooth gradient) still counts.
  const gutterRuns: Array<[number, number]> = [];
  for (let y = 0; y < height;) {
    if (deviation[y]! > maxStd) { y += 1; continue; }
    let end = y;
    while (end < height && deviation[end]! <= maxStd) end += 1;
    if (end - y >= minRun && y > 0 && end < height) gutterRuns.push([y, end]);
    y = end;
  }
  /** Latest safe cut inside [lo, hi]: the run centre, clamped into the window. */
  const gutterCut = (lo: number, hi: number): number | undefined => {
    let best: number | undefined;
    for (const [a, b] of gutterRuns) {
      const from = Math.max(a, lo);
      const to = Math.min(b - 1, hi);
      if (from > to) continue;
      const cut = Math.min(Math.max(Math.floor((a + b) / 2), from), to);
      if (best === undefined || cut > best) best = cut;
    }
    return best;
  };

  const tiles: PanelTile[] = [];
  let start = 0;
  let gutterCuts = 0;
  let uncertainCuts = 0;
  while (height - start > maxTileHeight) {
    const windowStart = start + minTile;
    const windowEnd = start + maxTileHeight;
    const gutter = gutterCut(windowStart, windowEnd);
    if (gutter !== undefined) {
      tiles.push({ index: tiles.length, y0: start, y1: gutter, cutBelow: 'gutter' });
      gutterCuts += 1;
      start = gutter;
      continue;
    }
    const half = Math.ceil(overlap / 2);
    let cut = windowEnd - half;
    let calmest = Number.POSITIVE_INFINITY;
    for (let y = windowEnd - half; y >= windowStart; y -= 1) {
      if (deviation[y]! < calmest) { calmest = deviation[y]!; cut = y; }
    }
    tiles.push({ index: tiles.length, y0: start, y1: cut + half, cutBelow: 'uncertain' });
    uncertainCuts += 1;
    start = cut + half - overlap;
  }
  tiles.push({ index: tiles.length, y0: start, y1: height, cutBelow: 'end' });
  return { tiles, gutterCuts, uncertainCuts };
}

// ---------------------------------------------------------------- merge

const fold = (value: string) => value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase();
const textKey = (value: string) => fold(value).replace(/[^\p{L}\p{N}]+/gu, '');
const isUnnamed = (name: string) => fold(name).startsWith(UNNAMED);

function sameLine(a: string, b: string): boolean {
  const ka = textKey(a);
  const kb = textKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  return Math.min(ka.length, kb.length) >= 6 && (ka.includes(kb) || kb.includes(ka));
}

export interface TileMergeResult { analysis: SegmentAnalysis; dedupedLines: number; linesPerTile: number[] }

/**
 * Joins tile analyses in reading order. Only lines read by some tile are kept (nothing is
 * composed); across an overlapped (uncertain) cut, a line seen at the bottom of one tile and the
 * top of the next is kept once, the longer reading. A repeat across a clean gutter is a second
 * balloon and stays. One output frame per tile carries the tile's coordinates.
 */
export function mergeTileAnalyses(input: { tiles: readonly PanelTile[]; analyses: readonly SegmentAnalysis[]; panelHeight: number; atMs: number }): TileMergeResult {
  const { tiles, analyses } = input;
  const count = tiles.length;
  const label = (tile: PanelTile) => `bloco ${tile.index + 1}/${count} y=${tile.y0}–${tile.y1}`;
  const lines = analyses.map((analysis) => analysis.frames.flatMap((frame) => frame.visibleText.map((line) => ({ ...line }))));
  let dedupedLines = 0;
  for (let index = 0; index + 1 < count; index += 1) {
    if (tiles[index]!.cutBelow !== 'uncertain') continue;
    const previous = lines[index]!;
    const tail = previous.slice(-3);
    const next = lines[index + 1]!;
    for (const candidate of next.slice(0, 3)) {
      const match = tail.find((line) => sameLine(line.text, candidate.text));
      if (!match) continue;
      if (textKey(candidate.text).length > textKey(match.text).length) match.text = candidate.text;
      next.splice(next.indexOf(candidate), 1);
      dedupedLines += 1;
    }
  }

  const frames = tiles.map((tile, index) => ({
    atMs: input.atMs,
    observed: `[${label(tile)}] ${analyses[index]!.frames.map((frame) => frame.observed).join(' ')}`.slice(0, 300),
    visibleText: lines[index]!.slice(0, 12),
  }));

  const entities: SegmentAnalysis['entities'] = [];
  const entityKeys = new Set<string>();
  analyses.forEach((analysis, index) => {
    for (const entity of analysis.entities) {
      if (isUnnamed(entity.name)) {
        entities.push({ ...entity, name: `${entity.name} (bloco ${index + 1})`.slice(0, 120) });
        continue;
      }
      const key = textKey(entity.name);
      if (entityKeys.has(key)) continue;
      entityKeys.add(key);
      entities.push(entity);
    }
  });
  const actions: SegmentAnalysis['actions'] = [];
  const actionKeys = new Set<string>();
  for (const action of analyses.flatMap((analysis) => analysis.actions)) {
    const key = textKey(action.description);
    if (actionKeys.has(key)) continue;
    actionKeys.add(key);
    actions.push(action);
  }

  const natureVotes = new Map<SegmentAnalysis['nature'], number>();
  for (const analysis of analyses) natureVotes.set(analysis.nature, (natureVotes.get(analysis.nature) ?? 0) + 1);
  let nature = analyses[0]!.nature;
  for (const [candidate, votes] of natureVotes) if (votes > (natureVotes.get(nature) ?? 0)) nature = candidate;

  const uncertain = tiles.filter((tile) => tile.cutBelow === 'uncertain').length;
  const tilingNote = `Painel alto analisado em ${count} blocos (y=${tiles.map((tile) => `${tile.y0}–${tile.y1}`).join(', ')}); ${uncertain} corte incerto com sobreposição; ${dedupedLines} fala(s) duplicada(s) removida(s) na sobreposição.`;
  const tileNotes: string[] = [];
  analyses.forEach((analysis, index) => {
    for (const note of analysis.limitations) {
      const tagged = `bloco ${index + 1}: ${note}`.slice(0, 240);
      if (!tileNotes.some((existing) => existing.slice(existing.indexOf(':') + 1) === tagged.slice(tagged.indexOf(':') + 1))) tileNotes.push(tagged);
    }
  });
  const overflow = lines.reduce((total, tileLines) => total + Math.max(0, tileLines.length - 12), 0);
  const limitations = [tilingNote.slice(0, 240), ...(overflow ? [`${overflow} fala(s) além do limite de 12 por bloco não incluída(s).`] : []), ...tileNotes].slice(0, 8);

  const analysis: SegmentAnalysis = {
    schemaVersion: 1,
    nature,
    natureConfidence: Math.min(...analyses.map((item) => item.natureConfidence)),
    description: analyses.map((item, index) => `Bloco ${index + 1}/${count}: ${item.description}`).join(' | ').slice(0, 600),
    frames,
    entities: entities.slice(0, 16),
    actions: actions.slice(0, 12),
    environment: analyses.find((item) => item.environment)?.environment ?? null,
    overlays: {
      burnedText: analyses.some((item) => item.overlays.burnedText),
      watermark: analyses.some((item) => item.overlays.watermark),
      webcam: analyses.some((item) => item.overlays.webcam),
    },
    limitations,
    confidence: Math.min(...analyses.map((item) => item.confidence)),
  };
  return { analysis, dedupedLines, linesPerTile: frames.map((frame) => frame.visibleText.length) };
}

// ---------------------------------------------------------------- image backend

export interface PanelImageBackend {
  size(path: string): Promise<{ width: number; height: number }>;
  /** Grayscale, one byte per pixel, row-major. */
  grayRows(path: string): Promise<{ width: number; height: number; data: Uint8Array }>;
  /** Optional deterministic text-density evidence used to select OCR blocks. */
  textEvidence?(path: string): Promise<PanelTextEvidence>;
  /** Writes rows [y0, y1) of `source` as PNG to `out`; the source is never modified. */
  crop(source: string, y0: number, y1: number, out: string): Promise<void>;
}

/** sharp is resolved at runtime (hoisted workspace dependency); a missing module fails explicitly. */
export function createSharpPanelImageBackend(): PanelImageBackend {
  type SharpFactory = (input: string) => {
    metadata(): Promise<{ width?: number; height?: number }>;
    greyscale(): { raw(): { toBuffer(options: { resolveWithObject: true }): Promise<{ data: Buffer; info: { width: number; height: number; channels: number } }> } };
    extract(region: { left: number; top: number; width: number; height: number }): { png(): { toFile(path: string): Promise<unknown> } };
  };
  let factory: SharpFactory | null = null;
  const sharp = async (): Promise<SharpFactory> => {
    if (factory) return factory;
    try {
      const module = (await import('sharp')) as unknown as { default?: SharpFactory };
      factory = (module.default ?? (module as unknown as SharpFactory));
      return factory;
    } catch (error) {
      throw new Error('RECAP_TILE_IMAGE_BACKEND_UNAVAILABLE: módulo sharp não encontrado para recortar painéis altos.', { cause: error });
    }
  };
  return {
    size: async (path) => {
      const meta = await (await sharp())(path).metadata();
      if (!meta.width || !meta.height) throw new Error(`Dimensões ilegíveis: ${path}`);
      return { width: meta.width, height: meta.height };
    },
    grayRows: async (path) => {
      const { data, info } = await (await sharp())(path).greyscale().raw().toBuffer({ resolveWithObject: true });
      if (info.channels === 1) return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
      const gray = new Uint8Array(info.width * info.height);
      for (let index = 0; index < gray.length; index += 1) gray[index] = data[index * info.channels]!;
      return { width: info.width, height: info.height, data: gray };
    },
    textEvidence: async (path) => {
      const gray = await (async () => {
        const { data, info } = await (await sharp())(path).greyscale().raw().toBuffer({ resolveWithObject: true });
        if (info.channels === 1) return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) };
        const single = new Uint8Array(info.width * info.height);
        for (let index = 0; index < single.length; index += 1) single[index] = data[index * info.channels]!;
        return { width: info.width, height: info.height, data: single };
      })();
      return estimateTextEvidence(gray.data, gray.width, gray.height);
    },
    crop: async (source, y0, y1, out) => {
      const { width } = await (await sharp())(source).metadata();
      await (await sharp())(source).extract({ left: 0, top: y0, width: width ?? 0, height: y1 - y0 }).png().toFile(out);
    },
  };
}

// ---------------------------------------------------------------- provider wrapper

export interface TileLedgerEntry {
  ts: string; panelId: string; panelSha: string; tileIndex: number; tileCount: number; y0: number; y1: number; cutBelow: TileCut;
  cacheHit: boolean; model: string; reportedModel: string | null; inputTokens: number | null; outputTokens: number | null;
  wallMs: number; status: 'ok' | 'failed' | 'cancelled'; errorCode: string | null; rssMb: number;
  kind?: 'analysis' | 'ocr'; textEvidence?: PanelTextEvidence | null; ocrSelected?: boolean; sfxFiltered?: number;
}

export interface TilingReport {
  panelId: string; panelSha: string; width: number; height: number; maxTileHeight: number; imageTokensPerFullPanel: number;
  tiles: Array<PanelTile & { cacheKey: string; tilePath: string; cacheHit: boolean; lines: number; inputTokens: number | null; outputTokens: number | null; wallMs: number; ocrCompleted: boolean; ocrSelected: boolean; ocrCacheHit: boolean; ocrRawLinesPersisted: boolean; ocrLines: readonly VisionOcrLine[]; ocrInputTokens: number | null; ocrOutputTokens: number | null; ocrSfxFiltered: number | null; ocrError: string | null }>;
  gutterCuts: number; uncertainCuts: number; dedupedLines: number; manifestPath: string;
}

interface CachedTile {
  version: string;
  tile: PanelTile;
  analysis: SegmentAnalysis;
  usage: VisionProviderUsage | null;
  reportedModel: string | null;
  wallMs: number;
  createdAt: string;
  ocrCompleted?: boolean;
  ocrLines?: readonly VisionOcrLine[];
  ocrUsage?: VisionProviderUsage | null;
  ocrTextEvidence?: PanelTextEvidence | null;
  ocrSfxFiltered?: number | undefined;
  ocrError?: string | null;
}

type VisibleTextLine = SegmentAnalysis['frames'][number]['visibleText'][number];
const visibleRegions = new Set<VisibleTextLine['region']>(['top', 'center', 'bottom', 'full', 'overlay']);

function normalizeOcrRegion(region: string): VisibleTextLine['region'] {
  return visibleRegions.has(region as VisibleTextLine['region']) ? region as VisibleTextLine['region'] : 'center';
}

/** OCR only augments/extends a matching line; unrelated OCR stays visible for review. */
export function mergePanelOcrLines(current: readonly VisibleTextLine[], ocr: VisionOcrResult): { lines: VisibleTextLine[]; matched: number; added: number } {
  const lines = current.map((line) => ({ ...line }));
  let matched = 0;
  let added = 0;
  for (const candidate of ocr.lines) {
    const text = candidate.text.replace(/\s+/gu, ' ').trim().slice(0, 200);
    if (!text) continue;
    const currentKey = textKey(text);
    const match = lines.find((line) => {
      const key = textKey(line.text);
      return key === currentKey || (Math.min(key.length, currentKey.length) >= 6 && (key.includes(currentKey) || currentKey.includes(key)));
    });
    if (match) {
      matched += 1;
      if (text.length > match.text.length && textKey(text).includes(textKey(match.text))) match.text = text;
      continue;
    }
    if (lines.length < 12) {
      lines.push({ text, region: normalizeOcrRegion(candidate.region) });
      added += 1;
    }
  }
  return { lines, matched, added };
}

function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, content);
  renameSync(temp, path);
}

const sha256 = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const errorCode = (error: unknown): string => {
  const code = (error as { code?: unknown })?.code;
  if (typeof code === 'string') return code;
  const message = error instanceof Error ? error.message : String(error);
  return /^[A-Z][A-Z0-9_]{3,}/u.exec(message)?.[0] ?? (/cancel/iu.test(message) ? 'CANCELLED' : 'ERROR');
};

/**
 * Wraps a single-image analysis provider (the local Ollama VLM): panels taller than the
 * token-budget tile are cut and analysed tile by tile with the base provider's own settings
 * (think:false, structured output, SFX filter, visual-only names). Each tile analysis is a
 * checkpoint keyed by panel bytes + coordinates + model + cacheVersion; every tile, fresh or
 * cached, is one ledger line.
 */
export function createTiledPanelProvider(options: TileBudget & {
  base: VisualAnalysisProvider;
  cacheDir: string;
  ledgerPath?: string;
  /** Prompt/config identity of the base provider; changing it re-analyses. */
  cacheVersion: string;
  overlapPx?: number;
  /** Tile height cap as a multiple of width (OCR fidelity); undefined = token budget only. */
  maxTileAspect?: number;
  imageBackend?: PanelImageBackend;
  /** Optional evidence-driven OCR; disabled by default for compatibility. */
  ocr?: { enabled?: boolean; maxCalls?: number; minScore?: number };
  /** Job-local pilot budget. The base provider is expected to share this instance. */
  budget?: RecapPilotBudget;
}): VisualAnalysisProvider & { lastTiling(): TilingReport | null } {
  const { base, cacheDir } = options;
  const ledgerPath = options.ledgerPath ?? join(cacheDir, 'ledger.jsonl');
  const overlapPx = options.overlapPx ?? 160;
  const images = options.imageBackend ?? createSharpPanelImageBackend();
  const ocrOptions = {
    enabled: options.ocr?.enabled ?? false,
    maxCalls: Math.max(0, Math.floor(options.ocr?.maxCalls ?? 12)),
    minScore: Math.min(1, Math.max(0, options.ocr?.minScore ?? 0.22)),
  };
  let lastTiling: TilingReport | null = null;
  let lastUsage: VisionProviderUsage | null = null;
  let lastModel: string | null = null;

  const ledger = (entry: TileLedgerEntry) => {
    mkdirSync(dirname(ledgerPath), { recursive: true });
    appendFileSync(ledgerPath, `${JSON.stringify(entry)}\n`);
  };

  const analyzeTiled = async (frame: VisionFrame, context: string | undefined, signal: AbortSignal | undefined): Promise<SegmentAnalysis | null> => {
    const { width, height } = await images.size(frame.path);
    const budgetHeight = maxTileHeightForContext({ ...options, width });
    const aspectHeight = options.maxTileAspect ? Math.floor(options.maxTileAspect * width) : Number.POSITIVE_INFINITY;
    let maxTileHeight = Math.min(budgetHeight, aspectHeight);
    if (height <= maxTileHeight) return null;
    const panelSha = sha256(readFileSync(frame.path));
    const gray = await images.grayRows(frame.path);
    let plan = planPanelTiles({ width, height, gray: gray.data, maxTileHeight, overlapPx });
    if (plan.tiles.length > MAX_TILES && maxTileHeight < budgetHeight) {
      maxTileHeight = budgetHeight;
      plan = planPanelTiles({ width, height, gray: gray.data, maxTileHeight, overlapPx });
    }
    if (plan.tiles.length > MAX_TILES) {
      throw Object.assign(new Error(`${RECAP_TILE_LIMIT}: ${frame.id ?? frame.path} exige ${plan.tiles.length} blocos (máximo ${MAX_TILES}).`), { code: RECAP_TILE_LIMIT });
    }
    const panelId = frame.id ?? frame.hash;
    const count = plan.tiles.length;
    options.budget?.registerBlocks(count);
    const analyses: SegmentAnalysis[] = [];
    const tileReports: TilingReport['tiles'] = [];
    const tileRecords: Array<{
      tile: PanelTile; cacheKey: string; analysisPath: string; tilePath: string; analysis: SegmentAnalysis;
      usage: VisionProviderUsage | null; reportedModel: string | null; wallMs: number; ocrCompleted: boolean;
      ocrSelected: boolean; ocrCacheHit: boolean; ocrRawLinesPersisted: boolean; ocrLines: readonly VisionOcrLine[]; ocrSfxFiltered: number | null;
      ocrUsage?: VisionProviderUsage | null; ocrEvidence?: PanelTextEvidence | null; ocrError?: string | null;
    }> = [];
    let inputTokens: number | null = 0;
    let outputTokens: number | null = 0;
    let fresh = 0;
    const addUsage = (usage: VisionProviderUsage | null | undefined) => {
      inputTokens = inputTokens === null || usage?.inputTokens === null || usage?.inputTokens === undefined ? null : inputTokens + usage.inputTokens;
      outputTokens = outputTokens === null || usage?.outputTokens === null || usage?.outputTokens === undefined ? null : outputTokens + usage.outputTokens;
    };
    for (const tile of plan.tiles) {
      const started = Date.now();
      const entry = (patch: Partial<TileLedgerEntry>): TileLedgerEntry => ({
        ts: new Date().toISOString(), panelId, panelSha: panelSha.slice(0, 16), tileIndex: tile.index, tileCount: count, y0: tile.y0, y1: tile.y1, cutBelow: tile.cutBelow,
        cacheHit: false, model: base.model, reportedModel: null, inputTokens: null, outputTokens: null, wallMs: Date.now() - started, status: 'ok', errorCode: null, kind: 'analysis',
        rssMb: Math.round(process.memoryUsage().rss / 1_048_576), ...patch,
      });
      if (signal?.aborted) {
        ledger(entry({ status: 'cancelled', errorCode: 'CANCELLED' }));
        throw new Error(`cancelled: recorte interrompido antes do bloco ${tile.index + 1}/${count} de ${panelId}.`);
      }
      const cacheKey = sha256(JSON.stringify({ v: TILING_VERSION, panelSha, y0: tile.y0, y1: tile.y1, width, model: base.model, cacheVersion: options.cacheVersion, ocr: ocrOptions }));
      const analysisPath = join(cacheDir, 'analysis', `${cacheKey}.json`);
      const tilePath = join(cacheDir, 'tiles', `${panelSha.slice(0, 16)}-${tile.y0}-${tile.y1}.png`);
      let cached: CachedTile | null = null;
      if (existsSync(analysisPath)) {
        try {
          const raw = JSON.parse(readFileSync(analysisPath, 'utf8')) as CachedTile;
          cached = { ...raw, analysis: segmentAnalysisSchema.parse(raw.analysis) };
        } catch {
          cached = null; // corrupt checkpoint: re-analyse this tile only
        }
      }
      if (cached) {
        analyses.push(cached.analysis);
        ledger(entry({ cacheHit: true, reportedModel: cached.reportedModel, inputTokens: 0, outputTokens: 0 }));
        tileReports.push({ ...tile, cacheKey, tilePath, cacheHit: true, lines: 0, inputTokens: 0, outputTokens: 0, wallMs: Date.now() - started, ocrCompleted: cached.ocrCompleted === true, ocrSelected: cached.ocrCompleted === true, ocrCacheHit: cached.ocrCompleted === true, ocrRawLinesPersisted: cached.ocrLines !== undefined, ocrLines: cached.ocrLines ?? [], ocrInputTokens: cached.ocrUsage?.inputTokens ?? null, ocrOutputTokens: cached.ocrUsage?.outputTokens ?? null, ocrSfxFiltered: cached.ocrSfxFiltered ?? null, ocrError: cached.ocrError ?? null });
        tileRecords.push({ tile, cacheKey, analysisPath, tilePath, analysis: cached.analysis, usage: cached.usage, reportedModel: cached.reportedModel, wallMs: cached.wallMs, ocrCompleted: cached.ocrCompleted === true, ocrSelected: cached.ocrCompleted === true, ocrCacheHit: cached.ocrCompleted === true, ocrRawLinesPersisted: cached.ocrLines !== undefined, ocrLines: cached.ocrLines ?? [], ocrSfxFiltered: cached.ocrSfxFiltered ?? null, ocrUsage: cached.ocrUsage ?? null, ocrEvidence: cached.ocrTextEvidence ?? null, ocrError: cached.ocrError ?? null });
        continue;
      }
      let analysis: SegmentAnalysis;
      let usage: VisionProviderUsage | null;
      let reportedModel: string | null;
      try {
        if (!existsSync(tilePath)) {
          mkdirSync(dirname(tilePath), { recursive: true });
          const temp = `${tilePath}.${process.pid}.tmp.png`;
          await images.crop(frame.path, tile.y0, tile.y1, temp);
          renameSync(temp, tilePath);
        }
        analysis = segmentAnalysisSchema.parse(await base.analyze!({
          frames: [{ id: `${panelId}#t${tile.index + 1}`, hash: `${frame.hash}#${tile.y0}-${tile.y1}`, path: tilePath, atMs: frame.atMs ?? 0 }],
          ...(context ? { context } : {}),
          ...(signal ? { signal } : {}),
        }));
        usage = base.lastUsage?.() ?? null;
        reportedModel = base.lastReportedModel?.() ?? null;
      } catch (error) {
        const cancelled = signal?.aborted === true;
        const code = cancelled ? 'CANCELLED' : errorCode(error);
        ledger(entry({ status: cancelled ? 'cancelled' : 'failed', errorCode: code }));
        if (cancelled) throw new Error(`cancelled: recorte interrompido no bloco ${tile.index + 1}/${count} de ${panelId}.`, { cause: error });
        const message = error instanceof Error ? error.message : String(error);
        throw Object.assign(new Error(`${RECAP_TILE_ANALYSIS_FAILED}: bloco ${tile.index + 1}/${count} y=${tile.y0}–${tile.y1} de ${panelId}: ${code}: ${message}`.slice(0, 600), { cause: error }), { code: RECAP_TILE_ANALYSIS_FAILED, tileIndex: tile.index });
      }
      const wallMs = Date.now() - started;
      writeAtomic(analysisPath, JSON.stringify({ version: TILING_VERSION, tile, analysis, usage, reportedModel, wallMs, createdAt: new Date().toISOString() } satisfies CachedTile));
      fresh += 1;
      addUsage(usage);
      lastModel = reportedModel ?? lastModel;
      analyses.push(analysis);
      ledger(entry({ reportedModel, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, wallMs }));
      tileReports.push({ ...tile, cacheKey, tilePath, cacheHit: false, lines: 0, inputTokens: usage?.inputTokens ?? null, outputTokens: usage?.outputTokens ?? null, wallMs, ocrCompleted: false, ocrSelected: false, ocrCacheHit: false, ocrRawLinesPersisted: false, ocrLines: [], ocrInputTokens: null, ocrOutputTokens: null, ocrSfxFiltered: null, ocrError: null });
      tileRecords.push({ tile, cacheKey, analysisPath, tilePath, analysis, usage, reportedModel, wallMs, ocrCompleted: false, ocrSelected: false, ocrCacheHit: false, ocrRawLinesPersisted: false, ocrLines: [], ocrSfxFiltered: null });
    }
    if (ocrOptions.enabled && base.analyzeOcr) {
      const candidates: Array<{ record: (typeof tileRecords)[number]; index: number; score: number }> = [];
      for (const [index, record] of tileRecords.entries()) {
        let evidence = record.ocrEvidence ?? null;
        if (!evidence && images.textEvidence) {
          try { evidence = await images.textEvidence(record.tilePath); } catch { evidence = null; }
        }
        record.ocrEvidence = evidence;
        const textInAnalysis = record.analysis.frames.some((item) => item.visibleText.length > 0);
        const textSignal = /(?:dialog|speech|text|balloon|caption|letter|word|fala|texto|legenda)/iu.test(`${record.analysis.description} ${record.analysis.limitations.join(' ')}`);
        const score = evidence?.score ?? 0;
        if (!record.ocrCompleted && (textInAnalysis || textSignal || score >= ocrOptions.minScore)) candidates.push({ record, index, score: Math.max(score, textInAnalysis ? 0.8 : 0.5) });
      }
      candidates.sort((a, b) => b.score - a.score || a.index - b.index);
      const selected = new Set(candidates.slice(0, ocrOptions.maxCalls).map((candidate) => candidate.index));
      for (const candidate of candidates) {
        const record = candidate.record;
        const tile = record.tile;
        record.ocrSelected = selected.has(candidate.index);
        const started = Date.now();
        const ocrEntry = (patch: Partial<TileLedgerEntry>): TileLedgerEntry => ({
          ts: new Date().toISOString(), panelId, panelSha: panelSha.slice(0, 16), tileIndex: tile.index, tileCount: count, y0: tile.y0, y1: tile.y1, cutBelow: tile.cutBelow,
          cacheHit: false, model: base.model, reportedModel: null, inputTokens: null, outputTokens: null, wallMs: Date.now() - started, status: 'ok', errorCode: null, kind: 'ocr',
          textEvidence: record.ocrEvidence ?? null, ocrSelected: true, rssMb: Math.round(process.memoryUsage().rss / 1_048_576), ...patch,
        });
        if (!selected.has(candidate.index)) {
          record.ocrCompleted = true;
          record.ocrError = `OCR não executado: limite de ${ocrOptions.maxCalls} bloco(s) por painel.`;
          record.analysis = segmentAnalysisSchema.parse({ ...record.analysis, limitations: [...record.analysis.limitations, record.ocrError].slice(0, 8) });
          ledger(ocrEntry({ status: 'failed', errorCode: 'OCR_LIMIT', wallMs: Date.now() - started }));
          continue;
        }
        if (signal?.aborted) {
          ledger(ocrEntry({ status: 'cancelled', errorCode: 'CANCELLED' }));
          throw new Error(`cancelled: OCR interrompido antes do bloco ${tile.index + 1}/${count} de ${panelId}.`);
        }
        try {
          const result = await base.analyzeOcr({ frames: [{ id: `${panelId}#t${tile.index + 1}`, hash: `${frame.hash}#${tile.y0}-${tile.y1}`, path: record.tilePath, atMs: frame.atMs ?? 0 }], ...(signal ? { signal } : {}) });
          record.ocrLines = result.lines;
          record.ocrRawLinesPersisted = true;
          record.ocrSfxFiltered = result.sfxFiltered;
          const current = record.analysis.frames[0]?.visibleText ?? [];
          const mergedOcr = mergePanelOcrLines(current, result);
          const note = `OCR por evidência: ${result.lines.length} linha(s), ${mergedOcr.matched} correspondência(s), ${mergedOcr.added} linha(s) acrescentada(s); origem preservada; revisão humana para linhas não correspondentes`;
          record.analysis = segmentAnalysisSchema.parse({
            ...record.analysis,
            frames: record.analysis.frames.map((item, frameIndex) => frameIndex === 0 ? { ...item, visibleText: mergedOcr.lines } : item),
            limitations: [...record.analysis.limitations, note].slice(0, 8),
          });
          record.ocrUsage = base.lastUsage?.() ?? null;
          record.ocrCacheHit = false;
          record.ocrCompleted = true;
          addUsage(record.ocrUsage);
          fresh += 1;
          lastModel = base.lastReportedModel?.() ?? lastModel;
          ledger(ocrEntry({ reportedModel: base.lastReportedModel?.() ?? null, inputTokens: record.ocrUsage?.inputTokens ?? null, outputTokens: record.ocrUsage?.outputTokens ?? null, sfxFiltered: result.sfxFiltered, wallMs: Date.now() - started }));
        } catch (error) {
          const cancelled = signal?.aborted === true;
          record.ocrCompleted = true;
          record.ocrError = cancelled ? 'CANCELLED' : errorCode(error);
          record.analysis = segmentAnalysisSchema.parse({ ...record.analysis, limitations: [...record.analysis.limitations, `OCR por evidência falhou (${record.ocrError}); texto existente preservado para revisão humana.`].slice(0, 8) });
          ledger(ocrEntry({ status: cancelled ? 'cancelled' : 'failed', errorCode: record.ocrError, wallMs: Date.now() - started }));
          if (cancelled) throw new Error(`cancelled: OCR interrompido no bloco ${tile.index + 1}/${count} de ${panelId}.`, { cause: error });
        }
      }
      // The checkpoint records the OCR decision, including failures, so resume does not silently
      // spend another call on the same block. A new cacheVersion is required to retry by policy.
      for (const record of tileRecords) {
        writeAtomic(record.analysisPath, JSON.stringify({ version: TILING_VERSION, tile: record.tile, analysis: record.analysis, usage: record.usage, reportedModel: record.reportedModel, wallMs: record.wallMs, createdAt: new Date().toISOString(), ocrCompleted: record.ocrCompleted, ocrLines: record.ocrLines, ocrUsage: record.ocrUsage ?? null, ocrTextEvidence: record.ocrEvidence ?? null, ocrSfxFiltered: record.ocrSfxFiltered ?? undefined, ocrError: record.ocrError ?? null } satisfies CachedTile));
      }
      for (let index = 0; index < tileRecords.length; index += 1) analyses[index] = tileRecords[index]!.analysis;
    }
    const merged = mergeTileAnalyses({ tiles: plan.tiles, analyses, panelHeight: height, atMs: frame.atMs ?? 0 });
    merged.linesPerTile.forEach((lines, index) => { tileReports[index]!.lines = lines; });
    tileRecords.forEach((record, index) => {
      tileReports[index]!.ocrCompleted = record.ocrCompleted;
      tileReports[index]!.ocrSelected = record.ocrSelected;
      tileReports[index]!.ocrCacheHit = record.ocrCacheHit;
      tileReports[index]!.ocrRawLinesPersisted = record.ocrRawLinesPersisted;
      tileReports[index]!.ocrLines = record.ocrLines;
      tileReports[index]!.ocrInputTokens = record.ocrUsage?.inputTokens ?? null;
      tileReports[index]!.ocrOutputTokens = record.ocrUsage?.outputTokens ?? null;
      tileReports[index]!.ocrSfxFiltered = record.ocrSfxFiltered;
      tileReports[index]!.ocrError = record.ocrError ?? null;
    });
    const manifestPath = join(cacheDir, 'manifests', `${panelSha.slice(0, 16)}.json`);
    lastTiling = {
      panelId, panelSha, width, height, maxTileHeight, imageTokensPerFullPanel: estimateImageTokens(width, height, options.patchPx),
      tiles: tileReports, gutterCuts: plan.gutterCuts, uncertainCuts: plan.uncertainCuts, dedupedLines: merged.dedupedLines, manifestPath,
    };
    writeAtomic(manifestPath, JSON.stringify({ ...lastTiling, source: frame.path, budget: { contextTokens: options.contextTokens, promptTokens: options.promptTokens, outputReserveTokens: options.outputReserveTokens, safetyTokens: options.safetyTokens, patchPx: options.patchPx }, overlapPx, cacheVersion: options.cacheVersion, version: TILING_VERSION }, null, 2));
    lastUsage = { inputTokens: fresh ? inputTokens : 0, outputTokens: fresh ? outputTokens : 0 };
    return segmentAnalysisSchema.parse(merged.analysis);
  };

  return {
    ...base,
    capabilities: base.capabilities,
    lastReportedModel: () => lastModel ?? base.lastReportedModel?.() ?? null,
    lastUsage: () => lastUsage,
    lastTiling: () => lastTiling,
    analyze: async (input) => {
      lastTiling = null;
      lastUsage = null;
      const frame = input.frames[0];
      if (options.budget) {
        if (input.frames.length === 1 && frame) options.budget.registerPanel(frame.id ?? frame.hash);
        else input.frames.forEach((item) => options.budget!.registerPanel(item.id ?? item.hash));
      }
      if (input.frames.length === 1 && frame) {
        const tiled = await analyzeTiled(frame, input.context, input.signal);
        if (tiled) return tiled;
        options.budget?.registerBlocks(1);
      } else {
        options.budget?.registerBlocks(input.frames.length);
      }
      const result = await base.analyze!(input);
      lastUsage = base.lastUsage?.() ?? null;
      lastModel = base.lastReportedModel?.() ?? null;
      return result;
    },
  };
}
