/**
 * Piloto experimental de visão local do Recap.
 *
 * Sem --execute, somente valida o manifesto; nenhuma chamada é feita.
 * Com --execute, usa exclusivamente Ollama local através de createRecapPilotProvider.
 * Este runner não inicia narrativa, TTS, MotionVelix, FFmpeg ou renderização.
 *
 * Fase 4B.6: cada resposta válida é persistida por painel, inclusive resultados diretos.
 * O conteúdo é content-addressed pela imagem, configuração, prompt, schema e contexto.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { segmentAnalysisSchema } from '@neuralbridge/shared';
import { createRecapPilotProvider, RECAP_PILOT_CACHE_VERSION, RECAP_PILOT_PREPROCESSING_VERSION, RECAP_PILOT_PROMPT_VERSION, RECAP_PILOT_PROVIDER_CONFIG } from '../packages/orchestrator/src/aethera/recap-pilot-config.js';
import { buildRecapPilotPanelResult, recapPilotPanelCacheKey, RecapPilotPanelCheckpointStore, type RecapPilotBlockCheckpoint, type RecapPilotOcrCheckpoint, type RecapPilotPanelIdentity, type RecapPilotPanelManifestEntry, type RecapPilotPanelResult } from '../packages/orchestrator/src/aethera/recap-pilot-checkpoints.js';
import type { TilingReport } from '../packages/orchestrator/src/aethera/panel-tiling.js';
import { DEFAULT_RECAP_PILOT_BUDGET } from '../packages/orchestrator/src/aethera/recap-pilot-budget.js';

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const PREFERRED_IDS = ['p0_0', 'p24_1', 'p28_1', 'p58_12', 'p71_0'];

interface PilotManifest { selection?: RecapPilotPanelManifestEntry[] }
interface PanelRunRecord {
  panelId: string;
  cacheKey: string;
  source: 'panel_checkpoint' | 'tile_checkpoint' | 'inference';
  panelCacheHit: boolean;
  blockCacheHits: number;
  blockCacheMisses: number;
  newAnalysisCalls: number;
  newOcrCalls: number;
  result: RecapPilotPanelResult;
}

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function hasFlag(name: string): boolean { return process.argv.includes(name); }

function numericArg(name: string): number | undefined {
  const value = arg(name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Argumento numérico inválido ${name}: ${value}`);
  return parsed;
}

function imageFiles(root: string): string[] {
  const result: string[] = [];
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (IMAGE_EXTENSIONS.has(extname(entry.name).toLowerCase())) result.push(path);
    }
  };
  visit(root);
  return result.sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
}

function selectForty(paths: readonly string[]): string[] {
  if (paths.length <= 40) return [...paths];
  const selected = new Set<number>();
  for (const preferred of PREFERRED_IDS) {
    const index = paths.findIndex((path) => new RegExp(`(?:^|[_-])${preferred}(?:\\.|[_-])`, 'iu').test(basename(path)));
    if (index >= 0) selected.add(index);
  }
  for (let index = 0; selected.size < 40 && index < paths.length; index += Math.max(1, Math.floor(paths.length / 40))) selected.add(index);
  for (let index = 0; selected.size < 40 && index < paths.length; index += 1) selected.add(index);
  return [...selected].sort((a, b) => a - b).map((index) => paths[index]!);
}

function sha256File(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function sha256Text(value: string): string { return createHash('sha256').update(value, 'utf8').digest('hex'); }

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temp, content, 'utf8');
  renameSync(temp, path);
}

function readManifest(path: string, maxPanels = 40): RecapPilotPanelManifestEntry[] {
  const manifest = JSON.parse(readFileSync(resolve(path), 'utf8')) as PilotManifest;
  const entries = manifest.selection ?? [];
  if (entries.length === 0 || entries.length > maxPanels) throw new Error(`Manifesto deve conter entre 1 e ${maxPanels} painéis: ${resolve(path)}`);
  return entries.map((entry) => {
    // Expansion manifests may carry audit-only selection metadata. Keep it out of the
    // operational panel identity so strict checkpoint schemas remain backwards compatible.
    const { expansionIndex: _expansionIndex, selectionSignals: _selectionSignals, selectionReason: _selectionReason, ...panelEntry } = entry as RecapPilotPanelManifestEntry & { expansionIndex?: number; selectionSignals?: string[]; selectionReason?: string };
    entry = panelEntry;
    if (!entry.panelId || !entry.cropPath || !entry.sha256 || !entry.boundingBox) throw new Error(`Manifesto sem identidade completa para o painel ${entry.panelId ?? '<vazio>'}.`);
    if (!existsSync(entry.cropPath) || !statSync(entry.cropPath).isFile()) throw new Error(`Crop do manifesto não encontrado: ${entry.cropPath}`);
    if (sha256File(entry.cropPath) !== entry.sha256) throw new Error(`Hash do crop diverge do manifesto: ${entry.cropPath}`);
    if (entry.width < 1 || entry.height < 1) throw new Error(`Dimensões inválidas no manifesto: ${entry.panelId}`);
    return entry;
  });
}

function selectSubset(entries: readonly RecapPilotPanelManifestEntry[], count: number): RecapPilotPanelManifestEntry[] {
  if (count >= entries.length) return [...entries];
  const tagged = (entry: RecapPilotPanelManifestEntry): string[] => [
    entry.classification ?? 'unknown',
    entry.aspect >= 2 ? 'tall' : entry.aspect <= 0.5 ? 'short' : entry.aspect >= 1.25 ? 'portrait' : 'compact',
  ];
  const preferredTags = ['establishing', 'tall', 'short', 'portrait', 'compact', 'dialogue'];
  const chosen = new Set<string>();
  for (const tag of preferredTags) {
    const candidate = entries.find((entry) => !chosen.has(entry.panelId) && tagged(entry).includes(tag));
    if (candidate) chosen.add(candidate.panelId);
    if (chosen.size >= count) break;
  }
  for (const entry of entries) {
    if (chosen.size >= count) break;
    chosen.add(entry.panelId);
  }
  return entries.filter((entry) => chosen.has(entry.panelId));
}

function identityForProvider(provider: { id: string; model: string }): RecapPilotPanelIdentity {
  return {
    provider: provider.id,
    model: provider.model,
    promptVersion: RECAP_PILOT_PROMPT_VERSION,
    schemaVersion: 1,
    preprocessingVersion: RECAP_PILOT_PREPROCESSING_VERSION,
    cacheVersion: RECAP_PILOT_CACHE_VERSION,
    contextFingerprint: sha256Text(''),
    settings: {
      think: RECAP_PILOT_PROVIDER_CONFIG.think,
      structuredOutput: RECAP_PILOT_PROVIDER_CONFIG.structuredOutput,
      temperature: RECAP_PILOT_PROVIDER_CONFIG.temperature,
      panelNames: RECAP_PILOT_PROVIDER_CONFIG.panelNames,
      sfxFilter: RECAP_PILOT_PROVIDER_CONFIG.sfxFilter,
      maxImagesPerCall: RECAP_PILOT_PROVIDER_CONFIG.maxImagesPerCall,
      stream: RECAP_PILOT_PROVIDER_CONFIG.stream,
      contextTokens: RECAP_PILOT_PROVIDER_CONFIG.contextTokens,
      maxOutputTokens: RECAP_PILOT_PROVIDER_CONFIG.maxOutputTokens,
      ocrPass: RECAP_PILOT_PROVIDER_CONFIG.ocrPass,
      ocrEnabled: true,
      maxTileAspect: 2,
    },
  };
}

function directBlock(panel: RecapPilotPanelManifestEntry, cacheKey: string, inputTokens: number | null, outputTokens: number | null, wallMs: number): RecapPilotBlockCheckpoint {
  return { index: 0, y0: 0, y1: panel.height, cacheKey: sha256Text(JSON.stringify({ cacheKey, index: 0, y0: 0, y1: panel.height })), tilePath: panel.cropPath, cacheHit: false, status: 'complete', inputTokens, outputTokens, wallMs, ocrCompleted: false, ocrLines: [], ocrSfxFiltered: null, ocrError: null };
}

function tilingBlocks(report: TilingReport): RecapPilotBlockCheckpoint[] {
  return report.tiles.map((tile) => ({ index: tile.index, y0: tile.y0, y1: tile.y1, cacheKey: tile.cacheKey, tilePath: tile.tilePath, cacheHit: tile.cacheHit, status: 'complete' as const, inputTokens: tile.inputTokens, outputTokens: tile.outputTokens, wallMs: tile.wallMs, ocrCompleted: tile.ocrCompleted, ocrLines: tile.ocrLines, ocrSfxFiltered: tile.ocrSfxFiltered, ocrError: tile.ocrError }));
}

function tilingOcr(report: TilingReport): RecapPilotOcrCheckpoint[] {
  return report.tiles.filter((tile) => tile.ocrSelected || tile.ocrCompleted || tile.ocrError !== null).map((tile) => ({ blockIndex: tile.index, status: tile.ocrError ? (/cancel/iu.test(tile.ocrError) ? 'cancelled' : 'failed') : 'completed', rawLinesPersisted: tile.ocrRawLinesPersisted, lines: tile.ocrLines, sfxFiltered: tile.ocrSfxFiltered, inputTokens: tile.ocrInputTokens, outputTokens: tile.ocrOutputTokens, error: tile.ocrError }));
}

function resultFromCheckpoint(result: RecapPilotPanelResult): PanelRunRecord {
  return { panelId: result.panel.panelId, cacheKey: result.cacheKey, source: 'panel_checkpoint', panelCacheHit: true, blockCacheHits: 0, blockCacheMisses: 0, newAnalysisCalls: 0, newOcrCalls: 0, result };
}

function auditRecord(record: PanelRunRecord): Record<string, unknown> {
  const analysis = record.result.analysis;
  return {
    panelId: record.panelId,
    pageNumber: record.result.panel.pageNumber,
    panelIndex: record.result.panel.panelIndex,
    readingOrder: record.result.panel.readingOrder,
    sha256: record.result.panel.sha256,
    cache: { source: record.source, panelHit: record.panelCacheHit, blockHits: record.blockCacheHits, blockMisses: record.blockCacheMisses },
    validation: { schema: record.result.validation.schema, narrative: record.result.validation.narrative, reason: 'Não há transcrição de referência nem revisão visual humana persistida.' },
    dialogues: record.result.provenance.filter((item) => item.kind === 'dialogue'),
    observations: record.result.provenance.filter((item) => item.kind === 'observation'),
    characters: analysis.entities.map((entity) => ({ name: entity.name, basis: entity.basis, evidence: entity.evidence, confidence: entity.confidence })),
    actions: analysis.actions,
    uncertainties: analysis.limitations,
    omittedDialogues: null,
    possiblyInventedSpeech: null,
    continuity: 'unverified',
    deduplicatedOverlapLines: record.result.blocks.length > 1 ? record.result.analysis.limitations.find((item) => /duplicada/iu.test(item)) ?? null : null,
  };
}

function writeNarrativeAudit(outputDir: string, records: readonly PanelRunRecord[], summary: Record<string, unknown>): void {
  const json = { version: 'recap-pilot-narrative-audit-v1', generatedAt: new Date().toISOString(), summary, panels: records.map(auditRecord) };
  atomicWrite(join(outputDir, 'narrative-audit.json'), `${JSON.stringify(json, null, 2)}\n`);
  const lines = ['# Recap Qwen3.5 — auditoria narrativa do piloto', '', 'A fidelidade é `unverified` quando não existe transcrição de referência nem revisão visual humana. Schema válido e confiança do modelo não são usados como prova de fidelidade.', '', `- Painéis: ${records.length}`, `- Chamadas novas nesta execução: ${summary.newCalls ?? 'null'}`, `- Cache hits de painel: ${summary.panelCacheHits ?? 'null'}`, `- Cache hits de bloco: ${summary.blockCacheHits ?? 'null'}`, '', '| Painel | Diálogos recuperados | Personagens | Ações | Fidelidade |', '| --- | ---: | ---: | ---: | --- |'];
  for (const record of records) {
    const item = auditRecord(record) as { panelId: string; dialogues: unknown[]; characters: unknown[]; actions: unknown[]; validation: { narrative: string } };
    lines.push(`| ${item.panelId} | ${item.dialogues.length} | ${item.characters.length} | ${item.actions.length} | ${item.validation.narrative} |`);
  }
  lines.push('', '## Limitações', '', '- Diálogos omitidos e falas inventadas permanecem `null` sem referência independente.', '- A continuidade entre painéis permanece `unverified`; o runner não substitui revisão editorial.', '');
  atomicWrite(join(outputDir, 'narrative-audit.md'), `${lines.join('\n')}\n`);
}

async function main(): Promise<void> {
  const maxPanels = numericArg('--max-panels') ?? 40;
  const requestedCount = numericArg('--count');
  const manifestPath = arg('--manifest');
  let selected: RecapPilotPanelManifestEntry[];
  if (manifestPath) {
    selected = readManifest(manifestPath, maxPanels);
  } else {
    const panelsDir = arg('--panels-dir');
    if (!panelsDir) throw new Error('Informe --panels-dir ou --manifest; o runner não extrai nem baixa o capítulo.');
    const root = resolve(panelsDir);
    if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Diretório de crops não encontrado: ${root}`);
    const paths = selectForty(imageFiles(root));
    selected = paths.map((path, index) => ({ panelId: basename(path, extname(path)), pagePath: path, cropPath: path, pageNumber: index, panelIndex: 0, readingOrder: 'unknown', boundingBox: { x: 0, y: 0, w: 0, h: 0 }, width: 0, height: 0, sha256: sha256File(path), sourceKind: 'panel_crop', origin: 'experimental' }));
  }
  if (selected.length === 0) throw new Error('Nenhum painel encontrado.');
  if (selected.length > maxPanels) throw new Error(`Seleção excedeu o limite rígido de ${maxPanels} painéis.`);
  const excludedPanelIds = new Set((arg('--exclude-panel-ids') ?? '').split(',').map((value) => value.trim()).filter(Boolean));
  if (excludedPanelIds.size > 0) selected = selected.filter((entry) => !excludedPanelIds.has(entry.panelId));
  if (selected.length === 0) throw new Error('A exclusão removeu todos os painéis da seleção.');
  if (requestedCount !== undefined) {
    if (requestedCount < 1 || requestedCount > selected.length) throw new Error(`--count deve estar entre 1 e ${selected.length}.`);
    selected = selectSubset(selected, Math.floor(requestedCount));
  }
  console.log(JSON.stringify({ mode: hasFlag('--execute') ? 'execute' : 'preflight', panels: selected.length, paths: selected.map((entry) => basename(entry.cropPath)) }, null, 2));
  if (!hasFlag('--execute')) return;

  const cacheDir = resolve(arg('--cache-dir') ?? join('.aethera-recap-data', 'recap-pilot-qwen35'));
  const ledgerPath = resolve(arg('--ledger') ?? join(cacheDir, 'ledger.jsonl'));
  const budgetConfig = {
    ...(numericArg('--max-panels') !== undefined ? { maxPanels: Math.floor(maxPanels) } : {}),
    ...(numericArg('--max-blocks') !== undefined ? { maxBlocks: Math.floor(numericArg('--max-blocks')!) } : {}),
    ...(numericArg('--max-calls') !== undefined ? { maxCalls: Math.floor(numericArg('--max-calls')!) } : {}),
    ...(numericArg('--max-ocr-calls') !== undefined ? { maxOcrCalls: Math.floor(numericArg('--max-ocr-calls')!) } : {}),
    ...(numericArg('--max-cpu-fallbacks') !== undefined ? { maxCpuFallbacks: Math.floor(numericArg('--max-cpu-fallbacks')!) } : {}),
    ...(numericArg('--max-input-tokens') !== undefined ? { maxInputTokens: Math.floor(numericArg('--max-input-tokens')!) } : {}),
    ...(numericArg('--max-output-tokens') !== undefined ? { maxOutputTokens: Math.floor(numericArg('--max-output-tokens')!) } : {}),
    ...(numericArg('--max-wall-time-ms') !== undefined ? { maxWallTimeMs: Math.floor(numericArg('--max-wall-time-ms')!) } : {}),
    ...(numericArg('--max-vram-mb') !== undefined ? { maxVramMb: Math.floor(numericArg('--max-vram-mb')!) } : {}),
  };
  const { provider, budget } = createRecapPilotProvider({ jobId: arg('--job-id') ?? `recap-qwen35-${Date.now()}`, cacheDir, ledgerPath, budgetConfig });
  const identity = identityForProvider(provider);
  const store = new RecapPilotPanelCheckpointStore(join(cacheDir, 'panels'));
  const records: PanelRunRecord[] = [];
  let panelCacheHits = 0;
  let blockCacheHits = 0;
  let blockCacheMisses = 0;
  let newCalls = 0;
  let newOcrCalls = 0;

  const detection = await provider.detect();
  if (!detection.available) throw new Error(`Ollama/modelo local indisponível: ${detection.reason}`);
  for (const panel of selected) {
    budget.registerPanel(panel.panelId);
    const cacheKey = recapPilotPanelCacheKey(panel, identity);
    const cached = store.read(panel, identity);
    if (cached) {
      panelCacheHits += 1;
      records.push(resultFromCheckpoint(cached));
      continue;
    }

    const started = Date.now();
    const hash = sha256File(panel.cropPath);
    if (hash !== panel.sha256) throw new Error(`Hash mudou antes da inferência: ${panel.panelId}`);
    const analysis = segmentAnalysisSchema.parse(await provider.analyze!({ frames: [{ id: panel.panelId, hash, path: panel.cropPath, atMs: 0 }] }));
    const wallMs = Date.now() - started;
    const report = provider.lastTiling() as TilingReport | null;
    const usage = provider.lastUsage?.() ?? null;
    const blocks = report ? tilingBlocks(report) : [directBlock(panel, cacheKey, usage?.inputTokens ?? null, usage?.outputTokens ?? null, wallMs)];
    const ocr = report ? tilingOcr(report) : [];
    const result = buildRecapPilotPanelResult({ panel, identity, reportedModel: provider.lastReportedModel?.() ?? null, analysis, blocks, ocr, usages: usage ? [usage] : [], wallMs, vramMb: budget.state().peakVramMb });
    store.write(result);
    const panelRecord: PanelRunRecord = {
      panelId: panel.panelId,
      cacheKey: result.cacheKey,
      source: report && report.tiles.every((tile) => tile.cacheHit) ? 'tile_checkpoint' : 'inference',
      panelCacheHit: false,
      blockCacheHits: report?.tiles.filter((tile) => tile.cacheHit).length ?? 0,
      blockCacheMisses: report?.tiles.filter((tile) => !tile.cacheHit).length ?? 1,
      newAnalysisCalls: report ? report.tiles.filter((tile) => !tile.cacheHit).length : 1,
      newOcrCalls: report?.tiles.filter((tile) => tile.ocrSelected && !tile.ocrCacheHit).length ?? 0,
      result,
    };
    blockCacheHits += panelRecord.blockCacheHits;
    blockCacheMisses += panelRecord.blockCacheMisses;
    newCalls += panelRecord.newAnalysisCalls + panelRecord.newOcrCalls;
    newOcrCalls += panelRecord.newOcrCalls;
    records.push(panelRecord);
    if (budget.state().paused) throw new Error(`Piloto pausado: ${budget.state().pauseReason ?? 'limite atingido'}`);
  }

  const state = budget.state();
  // The shared budget ledger is authoritative for executed attempts. Per-panel derived
  // counters can undercount when a tall panel has OCR or multiple tile records.
  const summary = { completed: true, recoveredPanels: panelCacheHits, panelCacheHits, blockCacheHits, blockCacheMisses, newCalls: state.calls, newOcrCalls: state.ocrCalls, derivedNewCalls: newCalls, derivedNewOcrCalls: newOcrCalls, budget: state, limits: budget.limits ?? DEFAULT_RECAP_PILOT_BUDGET, stopReason: state.paused ? state.pauseReason : null };
  const reportDir = resolve(arg('--report-dir') ?? cacheDir);
  writeNarrativeAudit(reportDir, records, summary);
  atomicWrite(resolve(arg('--summary-path') ?? join(reportDir, 'pilot-run-summary.json')), `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
