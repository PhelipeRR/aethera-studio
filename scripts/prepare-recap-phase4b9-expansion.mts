/**
 * Prepares the Phase 4B.9 incremental manifest from the already extracted 111-panel dataset.
 * It never opens the CBZ or regenerates crops: the previous manifest is the source of truth.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

type Entry = {
  panelId: string;
  pagePath: string;
  cropPath: string;
  pageNumber: number;
  panelIndex: number;
  readingOrder: string;
  classification: string;
  boundingBox: { x: number; y: number; w: number; h: number };
  width: number;
  height: number;
  aspect: number;
  sha256: string;
  sourceKind: string;
  origin: string;
};

const root = resolve('.aethera-recap-data/phase4b9-qwen35-expansion-20261124');
const sourceManifestPath = resolve('.aethera-recap-data/phase4b5-qwen35-pilot-20261123/pilot-dataset-manifest.json');
const outputPath = resolve(root, 'incremental-manifest-20.json');

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, path);
}

function stableOrder(a: Entry, b: Entry): number {
  return a.pageNumber - b.pageNumber || a.panelIndex - b.panelIndex || a.panelId.localeCompare(b.panelId, 'en', { numeric: true });
}

function signals(entry: Entry): string[] {
  const values: string[] = [entry.classification];
  if (entry.aspect >= 2) values.push('tall_panel');
  else if (entry.aspect <= 0.5) values.push('short_panel');
  else if (entry.aspect >= 1.25) values.push('portrait_dense');
  else values.push('compact_panel');
  return values;
}

function selectionReason(entry: Entry): string {
  const tags = signals(entry);
  return `Selecionado deterministicamente por cobertura de ${tags.join(' + ')}; o manifesto original não contém evidência independente de personagens, ações ou SFX.`;
}

const source = JSON.parse(readFileSync(sourceManifestPath, 'utf8')) as {
  sourceArchive: string;
  sourceArchiveSha256: string;
  chapterId: string;
  readingOrder: string;
  pageCount: number;
  extractedPanelCount: number;
  selection: Entry[];
  allExtractedIntegrity: Entry[];
};
const oldIds = new Set(source.selection.map((entry) => entry.panelId));
const oldHashes = new Set(source.selection.map((entry) => entry.sha256));
const candidates = source.allExtractedIntegrity
  .filter((entry) => !oldIds.has(entry.panelId) && !oldHashes.has(entry.sha256))
  .sort(stableOrder);
if (candidates.length < 20) throw new Error(`Somente ${candidates.length} painéis novos estão disponíveis; esperado pelo menos 20.`);
for (const entry of candidates) {
  if (!existsSync(entry.cropPath) || !statSync(entry.cropPath).isFile()) throw new Error(`Crop ausente: ${entry.cropPath}`);
  if (sha256(entry.cropPath) !== entry.sha256) throw new Error(`SHA divergente: ${entry.panelId}`);
}

// One pass per observable geometry/classification bucket, followed by stable fill. This is
// deterministic and does not claim semantic diversity that is not present in the manifest.
const buckets = new Map<string, Entry[]>();
for (const entry of candidates) for (const signal of signals(entry)) {
  const bucket = buckets.get(signal) ?? [];
  bucket.push(entry);
  buckets.set(signal, bucket);
}
const selected: Entry[] = [];
const used = new Set<string>();
const targetBuckets = ['establishing', 'dialogue', 'tall_panel', 'short_panel', 'portrait_dense', 'compact_panel'];
while (selected.length < 20) {
  let added = false;
  for (const bucketName of targetBuckets) {
    const candidate = (buckets.get(bucketName) ?? []).find((entry) => !used.has(entry.panelId));
    if (!candidate) continue;
    used.add(candidate.panelId);
    selected.push(candidate);
    added = true;
    if (selected.length >= 20) break;
  }
  if (!added) break;
}
for (const entry of candidates) {
  if (selected.length >= 20) break;
  if (used.has(entry.panelId)) continue;
  used.add(entry.panelId);
  selected.push(entry);
}
selected.sort(stableOrder);
if (selected.length !== 20) throw new Error(`Seleção incremental produziu ${selected.length} painéis, não 20.`);

const manifest = {
  schemaVersion: 1,
  phase: '4B.9.incremental-expansion',
  createdAt: new Date().toISOString(),
  sourceManifestPath,
  sourceArchive: source.sourceArchive,
  sourceArchiveSha256: source.sourceArchiveSha256,
  chapterId: source.chapterId,
  readingOrder: source.readingOrder,
  pageCount: source.pageCount,
  extractedPanelCount: source.extractedPanelCount,
  previousSelectionCount: source.selection.length,
  selectedPanelCount: selected.length,
  excludedHistoricalPanelIds: [...oldIds].sort(),
  excludedHistoricalHashes: [...oldHashes].sort(),
  selection: selected.map((entry, index) => ({ ...entry, expansionIndex: index, selectionSignals: signals(entry), selectionReason: selectionReason(entry) })),
  limitations: [
    'A seleção usa somente classificação e geometria existentes; SFX, personagens, ações e densidade textual não foram inferidos nesta etapa.',
    'Nenhuma imagem foi enviada a um provider durante a preparação.',
  ],
};
if (existsSync(outputPath)) throw new Error(`Recusando sobrescrever manifesto existente: ${outputPath}`);
atomicWrite(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(JSON.stringify({ outputPath, selected: selected.map((entry) => ({ panelId: entry.panelId, pageNumber: entry.pageNumber, panelIndex: entry.panelIndex, aspect: entry.aspect, classification: entry.classification, signals: signals(entry) })) }, null, 2));
