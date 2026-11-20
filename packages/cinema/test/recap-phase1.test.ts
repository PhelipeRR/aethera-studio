import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import sharp from 'sharp';
import {
	importChapter,
	extractPanels,
	runGateFPanelIntegrity,
	saveCheckpoint,
	loadCheckpoint,
	createTesseractOcrAdapter,
	mangaPanelMetadataSchema,
	recapCheckpointSchema,
	type OcrAdapter,
	type ExtractedPanel,
} from '../src/recap/index.js';

// ─── Test Fixtures ───────────────────────────────────────────────────────────

const TEST_DIR = join(tmpdir(), 'aethera-recap-test-' + Date.now());
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

async function createManhwaStrip(width: number, panelHeight: number, gutterHeight: number, panels: number): Promise<Buffer> {
	const totalHeight = panels * panelHeight + (panels - 1) * gutterHeight;
	const channels = 3;
	const data = Buffer.alloc(width * totalHeight * channels, 255);
	for (let p = 0; p < panels; p++) {
		const yStart = p * (panelHeight + gutterHeight);
		for (let y = yStart; y < yStart + panelHeight && y < totalHeight; y++) {
			for (let x = 0; x < width; x++) {
				const idx = (y * width + x) * 3;
				const val = ((x * 3 + y * 5 + p * 41) % 180);
				data[idx] = val; data[idx + 1] = ((val + p * 20) % 200); data[idx + 2] = ((val * 2 + p * 10) % 220);
			}
		}
	}
	return sharp(data, { raw: { width, height: totalHeight, channels } }).png().toBuffer();
}

async function createTextImage(text: string, width: number, height: number): Promise<Buffer> {
	const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
		<rect width="100%" height="100%" fill="#ffffff"/>
		<text x="50%" y="50%" font-family="Arial,sans-serif" font-size="32" fill="#000000" text-anchor="middle" dominant-baseline="middle">${text}</text>
	</svg>`;
	return sharp(Buffer.from(svg)).png().toBuffer();
}

beforeEach(() => {
	mkdirSync(FIXTURES_DIR, { recursive: true });
	mkdirSync(OUTPUT_DIR, { recursive: true });
	mkdirSync(CHECKPOINT_DIR, { recursive: true });
});

afterEach(() => {
	if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

// ─── Risk 1 & 2: OCR on cropped panel + imageHash is panel pixels ───────────

describe('Risk Validation: Panel Crop & Hash', () => {
	it('OCR receives cropped panel buffer, not full page path', async () => {
		const dir = join(FIXTURES_DIR, 'crop-ocr');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'page_000.png'), await createTwoPanelPage(800, 1200));
		const chapter = await importChapter({ chapterId: 'crop-ocr', archivePath: dir, outputDir: OUTPUT_DIR, readingOrder: 'vertical' });

		const received: Array<string | Buffer> = [];
		const tracker: OcrAdapter = { name: 'tracker', recognize: async (i) => { received.push(i); return { text: 'ok', confidence: 0.9 }; } };
		await extractPanels({ chapter, outputDir: OUTPUT_DIR, ocrAdapter: tracker });

		expect(received.length).toBeGreaterThanOrEqual(1);
		for (const input of received) expect(Buffer.isBuffer(input)).toBe(true);
	});

	it('imageHash differs for two distinct panels on same page and differs from page hash', async () => {
		const dir = join(FIXTURES_DIR, 'hash-diff');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'page_000.png'), await createTwoPanelPage(800, 1200));
		const chapter = await importChapter({ chapterId: 'hash-diff', archivePath: dir, outputDir: OUTPUT_DIR, readingOrder: 'vertical' });
		const result = await extractPanels({ chapter, outputDir: OUTPUT_DIR });

		expect(result.panels.length).toBeGreaterThanOrEqual(2);
		const hashes = new Set(result.panels.map((p) => p.imageHash));
		expect(hashes.size).toBe(result.panels.length);
		for (const h of hashes) expect(h).not.toBe(chapter.pages[0]!.sha256);
	});

	it('cropped panel dimensions are smaller than full page', async () => {
		const dir = join(FIXTURES_DIR, 'dims-crop');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'page_000.png'), await createTwoPanelPage(800, 1200));
		const chapter = await importChapter({ chapterId: 'dims-crop', archivePath: dir, outputDir: OUTPUT_DIR, readingOrder: 'vertical' });
		const result = await extractPanels({ chapter, outputDir: OUTPUT_DIR });

		for (const p of result.panels) {
			expect(p.height).toBeLessThan(chapter.pages[0]!.height);
			expect(p.width).toBeGreaterThan(0);
			expect(p.height).toBeGreaterThan(0);
		}
	});
});

// ─── Risk 3: Real CBZ/ZIP/PDF import ────────────────────────────────────────

describe('Risk Validation: Real Archive Import', () => {
	it('CBZ: correct count, order, unique hashes, files on disk', async () => {
		const cbz = join(FIXTURES_DIR, 'real.cbz');
		const zip = new AdmZip();
		for (let i = 0; i < 5; i++) zip.addFile(`page_${String(i).padStart(3, '0')}.png`, await createDistinctPng(640, 960, 1000 + i));
		zip.writeZip(cbz);

		const ch = await importChapter({ chapterId: 'real-cbz', archivePath: cbz, outputDir: OUTPUT_DIR });
		expect(ch.format).toBe('cbz');
		expect(ch.pageCount).toBe(5);
		expect(ch.readingOrder).toBe('rtl');
		for (let i = 0; i < ch.pages.length; i++) {
			expect(ch.pages[i]!.pageNumber).toBe(i);
			expect(ch.pages[i]!.sha256).toMatch(/^[a-f0-9]{64}$/);
			expect(existsSync(ch.pages[i]!.filePath)).toBe(true);
		}
		expect(new Set(ch.pages.map((p) => p.sha256)).size).toBe(5);
	});

	it('ZIP: correct count and reading order', async () => {
		const zp = join(FIXTURES_DIR, 'real.zip');
		const zip = new AdmZip();
		for (let i = 0; i < 3; i++) zip.addFile(`s_${i}.png`, await createDistinctPng(1080, 1920, 2000 + i));
		zip.writeZip(zp);

		const ch = await importChapter({ chapterId: 'real-zip', archivePath: zp, outputDir: OUTPUT_DIR, readingOrder: 'vertical' });
		expect(ch.format).toBe('zip');
		expect(ch.pageCount).toBe(3);
		expect(ch.readingOrder).toBe('vertical');
		expect(new Set(ch.pages.map((p) => p.sha256)).size).toBe(3);
	});

	it('PDF throws explicit error when sharp lacks PDF support', async () => {
		const pdf = join(FIXTURES_DIR, 'test.pdf');
		writeFileSync(pdf, '%PDF-1.4 fake');
		await expect(importChapter({ chapterId: 'pdf-x', archivePath: pdf, outputDir: OUTPUT_DIR }))
			.rejects.toThrow(/PDF|libvips|poppler|mupdf/i);
	});

	it('path traversal neutralized — files stay in output dir', async () => {
		const mz = join(FIXTURES_DIR, 'mal.zip');
		const zip = new AdmZip();
		zip.addFile('../../../etc/passwd', Buffer.from('evil'));
		zip.addFile('page_000.png', await createDistinctPng(100, 100, 99));
		zip.writeZip(mz);

		const ch = await importChapter({ chapterId: 'mal', archivePath: mz, outputDir: OUTPUT_DIR });
		const outDir = join(OUTPUT_DIR, 'mal');
		for (const p of ch.pages) expect(p.filePath.startsWith(outDir)).toBe(true);
		expect(existsSync(join(OUTPUT_DIR, '..', '..', '..', 'etc', 'passwd'))).toBe(false);
	});
});

// ─── Risk 4: Real Tesseract.js OCR ──────────────────────────────────────────

describe('Risk Validation: Real Tesseract OCR', () => {
	let adapter: ReturnType<typeof createTesseractOcrAdapter>;

	beforeEach(async () => { adapter = createTesseractOcrAdapter({ languages: 'por+eng' }); }, 30000);
	afterEach(async () => { await adapter.terminate(); }, 10000);

	it('recognizes English text on panel buffer', async () => {
		const img = await createTextImage('Hello World', 400, 200);
		const r = await adapter.recognize(img);
		expect(r.confidence).toBeGreaterThan(0);
		expect(r.text.toLowerCase()).toContain('hello');
	}, 30000);

	it('recognizes Portuguese text on panel buffer', async () => {
		const img = await createTextImage('Ola Mundo', 400, 200);
		const r = await adapter.recognize(img);
		expect(r.confidence).toBeGreaterThan(0);
		const n = r.text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
		expect(n).toContain('ola');
		expect(n).toContain('mundo');
	}, 30000);

	it('full pipeline: import → real OCR → gate F passes', async () => {
		const dir = join(FIXTURES_DIR, 'real-ocr-pl');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'page_000.png'), await createTextImage('Test dialogue', 800, 600));
		const ch = await importChapter({ chapterId: 'real-ocr-pl', archivePath: dir, outputDir: OUTPUT_DIR });
		const ex = await extractPanels({ chapter: ch, outputDir: OUTPUT_DIR, ocrAdapter: adapter, minOcrConfidence: 0.3 });
		expect(ex.panels.filter((p) => p.metadata.ocrStatus === 'success').length).toBeGreaterThanOrEqual(1);
		const g = runGateFPanelIntegrity({ panels: ex.panels, minOcrConfidence: 0.3, expectedReadingOrder: 'rtl' });
		expect(g.verdict).not.toBe('fail');
	}, 60000);
});

// ─── Schema Validation ──────────────────────────────────────────────────────

describe('Zod Schema Validation', () => {
	it('validates ocrStatus=success', () => {
		expect(() => mangaPanelMetadataSchema.parse({
			sourceKind: 'manga_page', origin: 'manga_scan', chapterId: 'c', pageNumber: 0, panelIndex: 0,
			readingOrder: 'rtl', boundingBox: { x: 0, y: 0, w: 800, h: 1200 }, classification: 'dialogue',
			ocrStatus: 'success', ocrConfidence: 0.95, textContent: 'Hi',
		})).not.toThrow();
	});
	it('validates ocrStatus=not_run', () => {
		expect(() => mangaPanelMetadataSchema.parse({
			sourceKind: 'manga_page', origin: 'webtoon_extract', chapterId: 'c', pageNumber: 0, panelIndex: 0,
			readingOrder: 'vertical', boundingBox: { x: 0, y: 0, w: 800, h: 1200 }, classification: 'establishing',
			ocrStatus: 'not_run', ocrConfidence: 0,
		})).not.toThrow();
	});
	it('validates ocrStatus=failed with error', () => {
		expect(() => mangaPanelMetadataSchema.parse({
			sourceKind: 'panel_crop', origin: 'manga_scan', chapterId: 'c', pageNumber: 0, panelIndex: 0,
			readingOrder: 'rtl', boundingBox: { x: 10, y: 20, w: 400, h: 600 }, classification: 'action',
			ocrStatus: 'failed', ocrConfidence: 0, ocrError: 'crash',
		})).not.toThrow();
	});
	it('rejects invalid ocrStatus', () => {
		expect(() => mangaPanelMetadataSchema.parse({
			sourceKind: 'manga_page', origin: 'manga_scan', chapterId: 'c', pageNumber: 0, panelIndex: 0,
			readingOrder: 'rtl', boundingBox: { x: 0, y: 0, w: 800, h: 1200 }, classification: 'dialogue',
			ocrStatus: 'unknown', ocrConfidence: 0,
		})).toThrow();
	});
	it('checkpoint round-trip', () => {
		const cp = { chapterId: 'c', completedStages: ['import', 'extraction'] as const, lastUpdatedAtIso: new Date().toISOString(), sourceHash: 'h', warnings: ['w'] };
		expect(recapCheckpointSchema.parse(JSON.parse(JSON.stringify(recapCheckpointSchema.parse(cp))))).toEqual(recapCheckpointSchema.parse(cp));
	});
});

// ─── Panel Extraction ────────────────────────────────────────────────────────

describe('Panel Extraction', () => {
	it('ocrStatus=not_run without adapter', async () => {
		const dir = join(FIXTURES_DIR, 'no-ocr');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'p.png'), await createDistinctPng(800, 1200, 100));
		const ch = await importChapter({ chapterId: 'no-ocr', archivePath: dir, outputDir: OUTPUT_DIR });
		const r = await extractPanels({ chapter: ch, outputDir: OUTPUT_DIR });
		for (const p of r.panels) { expect(p.metadata.ocrStatus).toBe('not_run'); expect(p.metadata.ocrConfidence).toBe(0); }
	});
	it('ocrStatus=failed on adapter error', async () => {
		const dir = join(FIXTURES_DIR, 'ocr-fail');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'p.png'), await createDistinctPng(800, 1200, 200));
		const ch = await importChapter({ chapterId: 'ocr-fail', archivePath: dir, outputDir: OUTPUT_DIR });
		const r = await extractPanels({ chapter: ch, outputDir: OUTPUT_DIR, ocrAdapter: { name: 'fail', recognize: async () => { throw new Error('boom'); } } });
		for (const p of r.panels) { expect(p.metadata.ocrStatus).toBe('failed'); expect(p.metadata.ocrError).toContain('boom'); }
	});
	it('detects multiple panels in manhwa strip', async () => {
		const dir = join(FIXTURES_DIR, 'manhwa');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 's.png'), await createManhwaStrip(800, 400, 50, 3));
		const ch = await importChapter({ chapterId: 'manhwa', archivePath: dir, outputDir: OUTPUT_DIR, readingOrder: 'vertical' });
		const r = await extractPanels({ chapter: ch, outputDir: OUTPUT_DIR });
		expect(r.panels.length).toBeGreaterThanOrEqual(2);
	});
});

// ─── Gate F ──────────────────────────────────────────────────────────────────

describe('Gate F Panel Integrity', () => {
	function mp(id: string, meta: Partial<ExtractedPanel['metadata']> = {}): ExtractedPanel {
		return {
			panelId: id, pagePath: '/tmp/p.png', imageHash: `h-${id}`, width: 800, height: 1200,
			metadata: { sourceKind: 'manga_page', origin: 'manga_scan', chapterId: 't', pageNumber: 0, panelIndex: 0, readingOrder: 'rtl', boundingBox: { x: 0, y: 0, w: 800, h: 1200 }, classification: 'establishing', ocrStatus: 'not_run', ocrConfidence: 0, ...meta },
		};
	}
	it('passes clean panels', () => {
		expect(runGateFPanelIntegrity({ panels: [mp('a'), mp('b', { pageNumber: 1 })], minOcrConfidence: 0.5, expectedReadingOrder: 'rtl' }).verdict).toBe('pass');
	});
	it('needs_review on ocr failed', () => {
		const r = runGateFPanelIntegrity({ panels: [mp('a', { ocrStatus: 'failed', ocrError: 't' })], minOcrConfidence: 0.5, expectedReadingOrder: 'rtl' });
		expect(r.verdict).toBe('needs_review');
	});
	it('never auto-passes insufficient evidence', () => {
		const r = runGateFPanelIntegrity({ panels: [mp('a', { classification: 'dialogue', ocrStatus: 'not_run' }), mp('b', { classification: 'dialogue', ocrStatus: 'failed', ocrError: 'e' })], minOcrConfidence: 0.5, expectedReadingOrder: 'rtl' });
		expect(r.verdict).not.toBe('pass');
	});
});

// ─── Checkpoint Persistence ─────────────────────────────────────────────────

describe('Checkpoint Persistence', () => {
	it('save and load', () => {
		const cp = { chapterId: 'c', completedStages: ['import'] as ('import' | 'extraction' | 'narrative' | 'fidelity' | 'manifest' | 'cinema_handoff')[], lastUpdatedAtIso: new Date().toISOString(), sourceHash: 'h', warnings: ['w'] };
		saveCheckpoint(CHECKPOINT_DIR, cp);
		const l = loadCheckpoint(CHECKPOINT_DIR);
		expect(l!.chapterId).toBe('c');
		expect(l!.completedStages).toEqual(['import']);
	});
	it('null for missing', () => { expect(loadCheckpoint(join(CHECKPOINT_DIR, 'no'))).toBeNull(); });
	it('null for corrupt', () => {
		const d = join(CHECKPOINT_DIR, 'bad'); mkdirSync(d, { recursive: true });
		writeFileSync(join(d, 'recap-checkpoint.json'), '{bad');
		expect(loadCheckpoint(d)).toBeNull();
	});
});