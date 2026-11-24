import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { historicalAnalysesForProductiveCache, mergeHistoricalRecapCheckpointReports, resolveHistoricalRecapCheckpoints } from '../../src/recap/historical-checkpoint-cache.js';
import type { ExtractedPanel } from '../../src/recap/recap-types.js';

const root = join(process.cwd(), '.aethera-recap-data', 'phase4b5-qwen35-pilot-20261123', 'qwen-cache', 'panels');

test('resolve histórico classifica conteúdo válido como migratable sem escrever nos artefatos', () => {
	if (!existsSync(root)) return;
	const file = readdirSync(root).find((name) => name.endsWith('.json'));
	assert.ok(file);
	const raw = JSON.parse(readFileSync(join(root, file), 'utf8')) as { panel: { panelId: string; sha256: string; pageNumber: number; panelIndex: number; readingOrder: string; width: number; height: number; boundingBox: { x: number; y: number; w: number; h: number } } };
	const panel = {
		panelId: raw.panel.panelId,
		pagePath: 'fixture-page.webp',
		croppedImagePath: 'fixture-panel.png',
		metadata: {
			sourceKind: 'panel_crop',
			origin: 'manga_scan',
			chapterId: 'fixture',
			pageNumber: raw.panel.pageNumber,
			panelIndex: raw.panel.panelIndex,
			readingOrder: raw.panel.readingOrder,
			boundingBox: raw.panel.boundingBox,
			classification: 'action',
			ocrStatus: 'not_run',
			ocrConfidence: 0,
		},
		imageHash: raw.panel.sha256,
		width: raw.panel.width,
		height: raw.panel.height,
	} as ExtractedPanel;
	const before = readFileSync(join(root, file), 'utf8');
	const report = resolveHistoricalRecapCheckpoints({ rootDirectory: root, panels: [panel], identity: { provider: 'local-vlm', model: 'qwen3.5:4b-q4_K_M', promptVersion: 'productive-v1' } });
	assert.equal(report.results[0]?.status, 'migratable');
	assert.ok(report.results[0]?.analysis);
	const cache = historicalAnalysesForProductiveCache(report);
	assert.equal(cache.analyses.length, 1);
	assert.equal(readFileSync(join(root, file), 'utf8'), before);
});

test('resolve histórico não fabrica cache para painel ausente', () => {
	const report = resolveHistoricalRecapCheckpoints({ rootDirectory: root, panels: [{ panelId: 'missing_panel', imageHash: '0'.repeat(64) } as ExtractedPanel] });
	assert.equal(report.results[0]?.status, 'missing');
	assert.equal(historicalAnalysesForProductiveCache(report).analyses.length, 0);
});

test('resolve histórico remapeia ID divergente somente por SHA e posição determinística', () => {
	if (!existsSync(root)) return;
	const file = readdirSync(root).find((name) => name.endsWith('.json'));
	assert.ok(file);
	const raw = JSON.parse(readFileSync(join(root, file), 'utf8')) as { panel: { sha256: string; pageNumber: number; panelIndex: number; readingOrder: string; width: number; height: number; boundingBox: { x: number; y: number; w: number; h: number } } };
	const panel = {
		panelId: 'nano-machine-capitulo-01_p0_0',
		pagePath: 'fixture-page.webp',
		croppedImagePath: 'fixture-panel.png',
		metadata: {
			sourceKind: 'panel_crop', origin: 'manga_scan', chapterId: 'fixture', pageNumber: raw.panel.pageNumber, panelIndex: raw.panel.panelIndex,
			readingOrder: raw.panel.readingOrder, boundingBox: raw.panel.boundingBox, classification: 'action', ocrStatus: 'not_run', ocrConfidence: 0,
		},
		imageHash: raw.panel.sha256, width: raw.panel.width, height: raw.panel.height,
	} as ExtractedPanel;
	const report = resolveHistoricalRecapCheckpoints({ rootDirectory: root, panels: [panel], identity: { provider: 'local-vlm', model: 'qwen3.5:4b-q4_K_M' } });
	assert.equal(report.results[0]?.status, 'migratable');
	assert.match(report.results[0]?.reason ?? '', /SHA-256 e posição/);
	assert.equal(historicalAnalysesForProductiveCache(report).analyses.length, 1);
});

test('mescla raízes históricas preferindo o resultado válido sobre missing', () => {
	const missing = { rootDirectory: 'a', checkedAtIso: new Date().toISOString(), results: [{ panelId: 'p1', status: 'missing' as const, filePath: null, reason: 'missing', panelSha256: null, analysis: null, source: 'none' as const }], counts: { compatible: 0, migratable: 0, incompatible: 0, corrupted: 0, missing: 1 } };
	const valid = { ...missing, rootDirectory: 'b', results: [{ ...missing.results[0], status: 'migratable' as const, filePath: 'b/p1.json', reason: 'valid', panelSha256: 'a'.repeat(64) }], counts: { compatible: 0, migratable: 1, incompatible: 0, corrupted: 0, missing: 0 } };
	const merged = mergeHistoricalRecapCheckpointReports([missing, valid]);
	assert.deepEqual(merged.counts, { compatible: 0, migratable: 1, incompatible: 0, corrupted: 0, missing: 0 });
});
