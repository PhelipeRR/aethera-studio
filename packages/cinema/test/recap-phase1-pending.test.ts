import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import {
	importChapter,
	extractPanels,
	runGateFPanelIntegrity,
	saveCheckpoint,
	loadCheckpoint,
	renderPdfToImages,
	type ExtractedPanel,
} from '../src/recap/index.js';

// ─── Shared Fixtures ─────────────────────────────────────────────────────────

const TEST_DIR = join(tmpdir(), 'aethera-recap-pending-' + Date.now());
const FIXTURES_DIR = join(TEST_DIR, 'fixtures');
const OUTPUT_DIR = join(TEST_DIR, 'output');
const CHECKPOINT_DIR = join(TEST_DIR, 'checkpoints');

async function createDistinctPng(width: number, height: number, seed: number): Promise<Buffer> {
	const channels = 3;
	const data = Buffer.alloc(width * height * channels);
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const val = ((x * 7 + y * 13 + seed * 31) % 256);
			data[(y * width + x) * 3] = val;
			data[(y * width + x) * 3 + 1] = ((val + seed) % 256);
			data[(y * width + x) * 3 + 2] = ((val * 2 + seed) % 256);
		}
	}
	return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

async function createTwoPanelPage(width: number, height: number): Promise<Buffer> {
	const channels = 3;
	const gutterHeight = Math.round(height * 0.05);
	const panelHeight = Math.round((height - gutterHeight) / 2);
	const data = Buffer.alloc(width * height * channels, 255);
	for (let y = 0; y < panelHeight; y++) {
		for (let x = 0; x < width; x++) {
			const idx = (y * width + x) * 3;
			data[idx] = 30; data[idx + 1] = 40; data[idx + 2] = 120;
		}
	}
	const bottomStart = panelHeight + gutterHeight;
	for (let y = bottomStart; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const idx = (y * width + x) * 3;
			data[idx] = 140; data[idx + 1] = 30; data[idx + 2] = 20;
		}
	}
	return sharp(data, { raw: { width, height, channels } }).png().toBuffer();
}

/** Minimal valid 3-page PDF (blank pages, 612x792 points each) */
function createMinimalPdf(pageCount: number): string {
	const kids: string[] = [];
	const objects: string[] = [];
	let objNum = 3;
	for (let i = 0; i < pageCount; i++) {
		kids.push(`${objNum} 0 R`);
		objects.push(`${objNum} 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj`);
		objNum++;
	}
	const xrefEntries = ['0000000000 65535 f '];
	// Catalog
	objects.unshift('1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj');
	xrefEntries.push('0000000009 00000 n ');
	// Pages
	objects.splice(1, 0, `2 0 obj<</Type/Pages/Kids[${kids.join(' ')}]/Count ${pageCount}>>endobj`);
	xrefEntries.push('0000000058 00000 n ');
	// Page objects
	for (let i = 0; i < objects.length - 2; i++) {
		xrefEntries.push('0000000000 65535 f ');
	}

	return [
		'%PDF-1.4',
		...objects,
		'xref',
		`0 ${objects.length + 1}`,
		...xrefEntries.slice(0, objects.length + 1),
		`trailer<</Size ${objects.length + 1}/Root 1 0 R>>`,
		'startxref',
		'0',
		'%%EOF',
	].join('\n');
}

beforeEach(() => {
	mkdirSync(FIXTURES_DIR, { recursive: true });
	mkdirSync(OUTPUT_DIR, { recursive: true });
	mkdirSync(CHECKPOINT_DIR, { recursive: true });
});

afterEach(() => {
	if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

// ─── Gate F: cropFailed enforcement ──────────────────────────────────────────

describe('Gate F: cropFailed enforcement', () => {
	function mp(id: string, meta: Partial<ExtractedPanel['metadata']> = {}, extra: Partial<ExtractedPanel> = {}): ExtractedPanel {
		return {
			panelId: id, pagePath: '/tmp/p.png', imageHash: 'h-' + id, width: 800, height: 1200,
			metadata: { sourceKind: 'manga_page', origin: 'manga_scan', chapterId: 't', pageNumber: 0, panelIndex: 0, readingOrder: 'rtl', boundingBox: { x: 0, y: 0, w: 800, h: 1200 }, classification: 'establishing', ocrStatus: 'not_run', ocrConfidence: 0, ...meta },
			...extra,
		};
	}

	it('cropFailed=true forces needs_review even when all other checks pass', () => {
		const panels = [mp('a', {}, { cropFailed: true })];
		const report = runGateFPanelIntegrity({ panels, minOcrConfidence: 0.5, expectedReadingOrder: 'rtl' });
		expect(report.verdict).toBe('needs_review');
		expect(report.metrics.cropFailedCount).toBe(1);
		expect(report.repairHints.some((h) => h.issueCode === 'crop_failed')).toBe(true);
	});

	it('cropFailed=true never produces automatic pass', () => {
		const panels = [
			mp('a', {}, { cropFailed: true }),
			mp('b', { pageNumber: 1 }, { cropFailed: false }),
		];
		const report = runGateFPanelIntegrity({ panels, minOcrConfidence: 0.5, expectedReadingOrder: 'rtl' });
		expect(report.verdict).not.toBe('pass');
	});

	it('panels without cropFailed pass normally', () => {
		const panels = [mp('a'), mp('b', { pageNumber: 1 })];
		const report = runGateFPanelIntegrity({ panels, minOcrConfidence: 0.5, expectedReadingOrder: 'rtl' });
		expect(report.verdict).toBe('pass');
		expect(report.metrics.cropFailedCount ?? 0).toBe(0);
	});
});

// ─── Persistence & Recovery with hash verification ───────────────────────────

describe('Persistence & Recovery: hash verification', () => {
	it('croppedImagePath exists, is readable, and SHA-256 matches imageHash', async () => {
		const dir = join(FIXTURES_DIR, 'persist-hash');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'page_000.png'), await createTwoPanelPage(800, 1200));

		const chapter = await importChapter({ chapterId: 'persist-hash', archivePath: dir, outputDir: OUTPUT_DIR, readingOrder: 'vertical' });
		const result = await extractPanels({ chapter, outputDir: OUTPUT_DIR });

		for (const panel of result.panels) {
			if (panel.croppedImagePath) {
				expect(existsSync(panel.croppedImagePath)).toBe(true);
				const fileBuf = readFileSync(panel.croppedImagePath);
				const recalculatedHash = createHash('sha256').update(fileBuf).digest('hex');
				expect(recalculatedHash).toBe(panel.imageHash);
			}
		}
	});

	it('checkpoint round-trip preserves croppedImagePath and imageHash', async () => {
		const dir = join(FIXTURES_DIR, 'ckpt-roundtrip');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'page_000.png'), await createDistinctPng(800, 1200, 500));

		const chapter = await importChapter({ chapterId: 'ckpt-rt', archivePath: dir, outputDir: OUTPUT_DIR });
		const result = await extractPanels({ chapter, outputDir: OUTPUT_DIR });

		const ckptDir = join(CHECKPOINT_DIR, 'ckpt-rt');
		saveCheckpoint(ckptDir, {
			chapterId: 'ckpt-rt',
			completedStages: ['import', 'extraction'],
			lastUpdatedAtIso: new Date().toISOString(),
			sourceHash: chapter.pages[0]!.sha256,
			extractedPanels: result.panels,
		});

		const loaded = loadCheckpoint(ckptDir);
		expect(loaded).not.toBeNull();
		expect(loaded!.extractedPanels).toBeDefined();
		expect(loaded!.extractedPanels!.length).toBe(result.panels.length);

		for (let i = 0; i < result.panels.length; i++) {
			const orig = result.panels[i]!;
			const restored = loaded!.extractedPanels![i]!;
			expect(restored.imageHash).toBe(orig.imageHash);
			expect(restored.croppedImagePath).toBe(orig.croppedImagePath);
			expect(restored.panelId).toBe(orig.panelId);
		}
	});

	it('detects missing cropped image file after checkpoint recovery', async () => {
		const dir = join(FIXTURES_DIR, 'missing-crop');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'page_000.png'), await createDistinctPng(800, 1200, 600));

		const chapter = await importChapter({ chapterId: 'missing-crop', archivePath: dir, outputDir: OUTPUT_DIR });
		const result = await extractPanels({ chapter, outputDir: OUTPUT_DIR });

		// Delete cropped panel files to simulate corruption
		for (const panel of result.panels) {
			if (panel.croppedImagePath && existsSync(panel.croppedImagePath)) {
				rmSync(panel.croppedImagePath);
			}
		}

		// Verify that cropped images are now missing
		for (const panel of result.panels) {
			if (panel.croppedImagePath) {
				expect(existsSync(panel.croppedImagePath)).toBe(false);
			}
		}
	});
});

// ─── PDF multi-page import (real) ────────────────────────────────────────────

describe('PDF multi-page import (real)', () => {
	it('renders a real multi-page PDF and validates page count, order and dimensions', async () => {
		const pdfContent = createMinimalPdf(3);
		const pdfPath = join(FIXTURES_DIR, 'multipage.pdf');
		writeFileSync(pdfPath, pdfContent);

		const pdfOutputDir = join(OUTPUT_DIR, 'pdf-pages');
		const pagePaths = await renderPdfToImages(pdfPath, pdfOutputDir, { dpi: 150 });

		expect(pagePaths.length).toBe(3);

		// Pages must be in order
		for (let i = 0; i < pagePaths.length; i++) {
			const p = pagePaths[i]!;
			expect(p).toContain('page_' + String(i).padStart(4, '0'));
			expect(existsSync(p)).toBe(true);
		}

		// Each rendered page must be a valid PNG with positive dimensions
		for (const pagePath of pagePaths) {
			const meta = await sharp(pagePath).metadata();
			expect(meta.width).toBeGreaterThan(0);
			expect(meta.height).toBeGreaterThan(0);
			expect(meta.format).toBe('png');
		}
	}, 30000);

	it('full pipeline: PDF import → extract → gate F', async () => {
		const pdfContent = createMinimalPdf(2);
		const pdfPath = join(FIXTURES_DIR, 'pipeline.pdf');
		writeFileSync(pdfPath, pdfContent);

		const chapter = await importChapter({
			chapterId: 'pdf-pipeline',
			archivePath: pdfPath,
			outputDir: OUTPUT_DIR,
		});

		expect(chapter.format).toBe('pdf');
		expect(chapter.pageCount).toBe(2);

		const extraction = await extractPanels({ chapter, outputDir: OUTPUT_DIR });
		expect(extraction.panels.length).toBeGreaterThanOrEqual(2);

		const gateReport = runGateFPanelIntegrity({
			panels: extraction.panels,
			minOcrConfidence: 0.5,
			expectedReadingOrder: 'rtl',
		});

		// Should not fail for clean PDF pages
		expect(gateReport.verdict).not.toBe('fail');
	}, 30000);
});