/** Rebuilds the local Nano Machine pilot dataset using Cinema's deterministic importer/extractor. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import sharp from 'sharp';
import { extractPanels, importChapter } from '../packages/cinema/src/recap/index.js';

const CBZ_PATH = resolve(process.env['NB_RECAP_PILOT_CBZ'] ?? 'tests/fixtures/real-manga/Nano-Machine-Capitulo-01.cbz');
const WORK_DIR = resolve(process.env['NB_RECAP_PILOT_DIR'] ?? '.aethera-recap-data/phase4b5-qwen35-pilot-20261123');
const CHAPTER_ID = 'nanomachine-cap-1-5';
const HISTORICAL_SUFFIXES = ['p0_0', 'p28_1', 'p58_12', 'p71_0'];

function sha256(data: Buffer): string { return createHash('sha256').update(data).digest('hex'); }

function selectForty<T extends { panelId: string; metadata: { pageNumber: number; panelIndex: number }; height: number; width: number }>(panels: readonly T[]): T[] {
  if (panels.length < 40) throw new Error(`RECAP_PILOT_DATASET_TOO_SMALL: ${panels.length} painéis; mínimo 40.`);
  const selected = new Set<number>();
  for (const suffix of HISTORICAL_SUFFIXES) {
    const index = panels.findIndex((panel) => panel.panelId.endsWith(`_${suffix}`));
    if (index >= 0) selected.add(index);
  }
  // Deterministic spread across the complete chapter, then stable source order.
  for (let ordinal = 0; selected.size < 40 && ordinal < 40; ordinal += 1) {
    selected.add(Math.round(ordinal * (panels.length - 1) / 39));
  }
  for (let index = 0; selected.size < 40 && index < panels.length; index += 1) selected.add(index);
  return [...selected].sort((a, b) => a - b).map((index) => panels[index]!);
}

async function main(): Promise<void> {
  if (!existsSync(CBZ_PATH) || !statSync(CBZ_PATH).isFile()) throw new Error(`CBZ não encontrado: ${CBZ_PATH}`);
  const archiveBytes = readFileSync(CBZ_PATH);
  const archiveSha256 = sha256(archiveBytes);
  const imported = await importChapter({ chapterId: CHAPTER_ID, archivePath: CBZ_PATH, outputDir: WORK_DIR });
  const extracted = await extractPanels({ chapter: imported, outputDir: WORK_DIR });
  if (extracted.panels.length < 40) throw new Error(`RECAP_PILOT_DATASET_TOO_SMALL: ${extracted.panels.length} painéis extraídos; mínimo 40.`);

  const ordered = [...extracted.panels];
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1]!;
    const current = ordered[index]!;
    if (current.metadata.pageNumber < previous.metadata.pageNumber || (current.metadata.pageNumber === previous.metadata.pageNumber && current.metadata.panelIndex <= previous.metadata.panelIndex)) {
      throw new Error(`RECAP_PILOT_ORDER_INVALID: ${previous.panelId} antes de ${current.panelId}.`);
    }
  }

  const integrity = [];
  for (const panel of ordered) {
    if (!panel.croppedImagePath || panel.cropFailed || !existsSync(panel.croppedImagePath)) throw new Error(`RECAP_PILOT_CROP_INVALID: ${panel.panelId}.`);
    const bytes = readFileSync(panel.croppedImagePath);
    const metadata = await sharp(bytes).metadata();
    const hash = sha256(bytes);
    if (hash !== panel.imageHash || metadata.width !== panel.width || metadata.height !== panel.height) throw new Error(`RECAP_PILOT_CROP_INTEGRITY_INVALID: ${panel.panelId}.`);
    integrity.push({
      panelId: panel.panelId,
      pagePath: panel.pagePath,
      cropPath: panel.croppedImagePath,
      pageNumber: panel.metadata.pageNumber,
      panelIndex: panel.metadata.panelIndex,
      readingOrder: panel.metadata.readingOrder,
      classification: panel.metadata.classification,
      boundingBox: panel.metadata.boundingBox,
      width: panel.width,
      height: panel.height,
      aspect: Number((panel.height / panel.width).toFixed(4)),
      sha256: hash,
      sourceKind: panel.metadata.sourceKind,
      origin: panel.metadata.origin,
    });
  }
  const selected = selectForty(ordered);
  const selectedIds = new Set(selected.map((panel) => panel.panelId));
  const manifest = {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    sourceArchive: CBZ_PATH,
    sourceArchiveSha256: archiveSha256,
    chapterId: CHAPTER_ID,
    readingOrder: imported.readingOrder,
    pageCount: imported.pageCount,
    extractedPanelCount: ordered.length,
    selectedPanelCount: selected.length,
    historicalIdChecks: Object.fromEntries(HISTORICAL_SUFFIXES.map((suffix) => {
      const panel = ordered.find((item) => item.panelId.endsWith(`_${suffix}`));
      return [suffix, panel ? { reproducedId: panel.panelId, cropPath: panel.croppedImagePath, sha256: panel.imageHash, width: panel.width, height: panel.height } : { reproducedId: null }];
    })),
    selection: integrity.filter((item) => selectedIds.has(item.panelId)),
    allExtractedIntegrity: integrity,
    warnings: extracted.warnings,
    diversityNote: 'A extração determinística não executa visão/OCR; diálogos, personagens e SFX serão auditados após a inferência. Painéis altos e casos históricos foram incluídos por ID/geometry quando presentes.',
  };
  writeFileSync(join(WORK_DIR, 'pilot-dataset-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ workDir: WORK_DIR, archiveSha256, readingOrder: imported.readingOrder, pageCount: imported.pageCount, extractedPanelCount: ordered.length, selectedPanelCount: selected.length, historicalIdChecks: manifest.historicalIdChecks, warnings: extracted.warnings.length }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
