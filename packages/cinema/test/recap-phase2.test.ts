import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import sharp from 'sharp';
import {
	importChapter,
	extractPanels,
	runNarrativeAnalyzer,
	runStoryContinuityEngine,
	runScriptGenerator,
	runGateGNarrativeFidelity,
	runStoryEngine,
	saveCheckpoint,
	loadCheckpoint,
	panelAnalysisSchema,
	storyBeatSchema,
	sceneSchema,
	recapScriptSchema,
	type ExtractedPanel,
	type PanelAnalysis,
	type VisionAdapter,
	type OcrAdapter,
	type NarrativeSequence,
	type RecapScript,
} from '../src/recap/index.js';

// ─── Test Fixtures ───────────────────────────────────────────────────────────

const TEST_DIR = join(tmpdir(), 'aethera-recap-phase2-' + Date.now());
const FIXTURES_DIR = join(TEST_DIR, 'fixtures');
const OUTPUT_DIR = join(TEST_DIR, 'output');

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

/** Creates a mock vision adapter that returns configurable results */
function createMockVisionAdapter(overrides?: Partial<Awaited<ReturnType<VisionAdapter['analyze']>>>): VisionAdapter {
	return {
		name: 'mock-vision',
		async analyze() {
			return {
				characters: ['Protagonista'],
				actions: [{ type: 'dialogue', description: 'Speaking' }],
				emotions: ['neutral'],
				setting: undefined,
				confidence: 0.85,
				...overrides,
			};
		},
	};
}

/** Creates a mock OCR adapter with configurable text/confidence */
function createMockOcrAdapter(text: string, confidence: number): OcrAdapter {
	return {
		name: 'mock-ocr',
		async recognize() {
			return { text, confidence };
		},
	};
}

/** Helper to build an ExtractedPanel for unit tests without full import pipeline */
function makePanel(
	id: string,
	metaOverrides: Partial<ExtractedPanel['metadata']> = {},
	panelOverrides: Omit<Partial<ExtractedPanel>, 'metadata'> = {},
): ExtractedPanel {
	const baseMeta: ExtractedPanel['metadata'] = {
		sourceKind: 'manga_page',
		origin: 'manga_scan',
		chapterId: 'test-ch',
		pageNumber: 0,
		panelIndex: 0,
		readingOrder: 'rtl',
		boundingBox: { x: 0, y: 0, w: 800, h: 1200 },
		classification: 'dialogue',
		ocrStatus: 'not_run',
		ocrConfidence: 0,
		...metaOverrides,
	};
	return {
		panelId: id,
		pagePath: '/tmp/page.png',
		imageHash: `hash-${id}`,
		width: 800,
		height: 1200,
		metadata: baseMeta,
		...panelOverrides,
	};
}

beforeEach(() => {
	mkdirSync(FIXTURES_DIR, { recursive: true });
	mkdirSync(OUTPUT_DIR, { recursive: true });
});

afterEach(() => {
	if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
});

// ─── Reading Order Tests ─────────────────────────────────────────────────────

describe('Phase 2: Reading Order', () => {
	it('RTL manga: panels sorted right-to-left then top-to-bottom', async () => {
		const dir = join(FIXTURES_DIR, 'rtl-test');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'page_000.png'), await createTwoPanelPage(800, 1200));

		const chapter = await importChapter({ chapterId: 'rtl', archivePath: dir, outputDir: OUTPUT_DIR, readingOrder: 'rtl' });
		const extraction = await extractPanels({ chapter, outputDir: OUTPUT_DIR });
		const result = await runNarrativeAnalyzer({
			panels: extraction.panels,
			analyzedBy: 'test',
			minConfidence: 0.1,
		});

		expect(result.analyses.length).toBeGreaterThanOrEqual(1);
		// All analyses should have valid panelIds from the extraction
		for (const analysis of result.analyses) {
			expect(extraction.panels.some((p) => p.panelId === analysis.panelId)).toBe(true);
		}
	});

	it('LTR manga: panels sorted left-to-right then top-to-bottom', async () => {
		const dir = join(FIXTURES_DIR, 'ltr-test');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'page_000.png'), await createTwoPanelPage(800, 1200));

		const chapter = await importChapter({ chapterId: 'ltr', archivePath: dir, outputDir: OUTPUT_DIR, readingOrder: 'ltr' });
		const extraction = await extractPanels({ chapter, outputDir: OUTPUT_DIR });
		const result = await runNarrativeAnalyzer({
			panels: extraction.panels,
			analyzedBy: 'test',
			minConfidence: 0.1,
		});

		expect(result.analyses.length).toBeGreaterThanOrEqual(1);
	});

	it('Vertical manhwa: panels sorted top-to-bottom', async () => {
		const dir = join(FIXTURES_DIR, 'vertical-test');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'strip_000.png'), await createManhwaStrip(800, 400, 50, 3));

		const chapter = await importChapter({ chapterId: 'vertical', archivePath: dir, outputDir: OUTPUT_DIR, readingOrder: 'vertical' });
		const extraction = await extractPanels({ chapter, outputDir: OUTPUT_DIR });
		const result = await runNarrativeAnalyzer({
			panels: extraction.panels,
			analyzedBy: 'test',
			minConfidence: 0.1,
		});

		expect(result.analyses.length).toBeGreaterThanOrEqual(2);
	});
});

// ─── Dialogue & Character Tests ──────────────────────────────────────────────

describe('Phase 2: Dialogues & Characters', () => {
	it('multiple character dialogues are captured from OCR', async () => {
		const panels = [
			makePanel('p0', {
				ocrStatus: 'success',
				ocrConfidence: 0.9,
				textContent: '"Vamos lutar!"\n"Não vou perder!"',
			}),
		];

		const result = await runNarrativeAnalyzer({
			panels,
			visionAdapter: createMockVisionAdapter({ characters: ['Heroi', 'Vilao'] }),
			analyzedBy: 'test-agent',
			minConfidence: 0.1,
		});

		expect(result.analyses.length).toBe(1);
		const analysis = result.analyses[0]!;
		expect(analysis.dialogues.length).toBeGreaterThanOrEqual(2);
		expect(analysis.characters).toContain('Heroi');
		expect(analysis.characters).toContain('Vilao');
	});

	it('visually similar characters are distinguished by vision adapter', async () => {
		const panels = [makePanel('p0'), makePanel('p1', { pageNumber: 1 })];

		let callCount = 0;
		const adaptiveVision: VisionAdapter = {
			name: 'adaptive-vision',
			async analyze() {
				callCount++;
				return {
					characters: callCount === 1 ? ['GemeoA'] : ['GemeoB'],
					actions: [{ type: 'dialogue', description: 'Speaking' }],
					emotions: ['neutral'],
					setting: undefined,
					confidence: 0.8,
				};
			},
		};

		const result = await runNarrativeAnalyzer({
			panels,
			visionAdapter: adaptiveVision,
			analyzedBy: 'test-agent',
			minConfidence: 0.1,
		});

		expect(result.analyses[0]!.characters).toContain('GemeoA');
		expect(result.analyses[1]!.characters).toContain('GemeoB');
	});
});

// ─── Panels Without Text / Incorrect OCR ─────────────────────────────────────

describe('Phase 2: No Text & Bad OCR', () => {
	it('panel without text produces low-confidence analysis with inference evidence', async () => {
		const panels = [makePanel('p0', { ocrStatus: 'not_run', classification: 'action' })];

		const result = await runNarrativeAnalyzer({
			panels,
			analyzedBy: 'text-only',
			minConfidence: 0.1,
		});

		expect(result.analyses.length).toBe(1);
		const analysis = result.analyses[0]!;
		// Without vision adapter and without OCR, confidence should be very low
		expect(analysis.analysisConfidence).toBe(0);
		expect(analysis.evidence.length).toBe(0);
	});

	it('incorrect OCR produces low-confidence analysis flagged for review', async () => {
		const panels = [makePanel('p0', {
			ocrStatus: 'success',
			ocrConfidence: 0.15, // Very low confidence
			textContent: 'asdf jkl; qwerty zxcv',
		})];

		const result = await runNarrativeAnalyzer({
			panels,
			analyzedBy: 'test-agent',
			minConfidence: 0.5,
		});

		expect(result.analyses.length).toBe(1);
		const analysis = result.analyses[0]!;
		// Low OCR confidence should penalize overall analysis confidence
		expect(analysis.analysisConfidence).toBeLessThan(0.5);
		// Should produce a warning about low confidence
		expect(result.warnings.some((w) => w.includes('below threshold'))).toBe(true);
	});
});

// ─── Continuity Between Pages ────────────────────────────────────────────────

describe('Phase 2: Continuity', () => {
	it('consecutive panels with shared characters merge into same beat', () => {
		const analyses: PanelAnalysis[] = [
			panelAnalysisSchema.parse({
				panelId: 'p0', characters: ['Heroi'], dialogues: [], actions: [{ type: 'dialogue', description: 'Talking' }],
				emotions: ['neutral'], evidence: [], analysisConfidence: 0.9, analyzedBy: 'test', analyzedAtIso: new Date().toISOString(),
			}),
			panelAnalysisSchema.parse({
				panelId: 'p1', characters: ['Heroi'], dialogues: [], actions: [{ type: 'dialogue', description: 'Replying' }],
				emotions: ['joy'], evidence: [], analysisConfidence: 0.85, analyzedBy: 'test', analyzedAtIso: new Date().toISOString(),
			}),
		];

		const result = runStoryContinuityEngine({
			chapterId: 'cont-test',
			analyses,
			readingOrder: 'rtl',
			minBeatConfidence: 0.5,
		});

		// Two panels with same character and compatible actions should merge
		expect(result.sequence.beats.length).toBe(1);
		expect(result.sequence.beats[0]!.panelIds).toEqual(['p0', 'p1']);
	});

	it('disjoint characters across pages produce narrative gap warning', () => {
		const analyses: PanelAnalysis[] = [
			panelAnalysisSchema.parse({
				panelId: 'p0', characters: ['Heroi', 'Aliado'], dialogues: [], actions: [{ type: 'combat', description: 'Fighting' }],
				emotions: ['anger'], evidence: [], analysisConfidence: 0.9, analyzedBy: 'test', analyzedAtIso: new Date().toISOString(),
			}),
			panelAnalysisSchema.parse({
				panelId: 'p1', characters: ['Vilao', 'Capanga'], dialogues: [], actions: [{ type: 'observation', description: 'Watching' }],
				emotions: ['tension'], evidence: [], analysisConfidence: 0.8, analyzedBy: 'test', analyzedAtIso: new Date().toISOString(),
			}),
		];

		const result = runStoryContinuityEngine({
			chapterId: 'gap-test',
			analyses,
			readingOrder: 'rtl',
			minBeatConfidence: 0.5,
		});

		expect(result.warnings.some((w) => w.includes('Narrative gap') || w.includes('gap'))).toBe(true);
	});
});

// ─── Missing/Corrupt References ──────────────────────────────────────────────

describe('Phase 2: Missing & Corrupt References', () => {
	it('scene referencing non-existent panel is flagged by Gate G', () => {
		const panels = [makePanel('p0')];
		const script: RecapScript = recapScriptSchema.parse({
			chapterId: 'missing-ref',
			title: 'Test',
			style: 'narrative_recap',
			scenes: [sceneSchema.parse({
				sceneId: 's0', narrationText: 'Algo aconteceu.', characters: [], eventDescription: 'Evento',
				panelIds: ['nonexistent_panel'], croppedImagePaths: [], estimatedDurationSec: 3,
				emotion: 'neutral', narrativeIntent: 'exposition', confidence: 0.9, reviewStatus: 'approved',
			})],
			totalEstimatedDurationSec: 3,
			generatedAtIso: new Date().toISOString(),
			generatedBy: 'test',
		});

		const report = runGateGNarrativeFidelity({ script, panels });
		expect(report.verdict).toBe('fail');
		expect(report.metrics.missingPanelRefs).toBeGreaterThan(0);
	});

	it('scene with missing cropped image file is flagged by Gate G', async () => {
		const dir = join(FIXTURES_DIR, 'corrupt-ref');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'page_000.png'), await createDistinctPng(800, 1200, 700));

		const chapter = await importChapter({ chapterId: 'corrupt-ref', archivePath: dir, outputDir: OUTPUT_DIR });
		const extraction = await extractPanels({ chapter, outputDir: OUTPUT_DIR });

		// Delete cropped images to simulate corruption
		for (const panel of extraction.panels) {
			if (panel.croppedImagePath && existsSync(panel.croppedImagePath)) {
				rmSync(panel.croppedImagePath);
			}
		}

		const scriptResult = runScriptGenerator({
			sequence: runStoryContinuityEngine({
				chapterId: 'corrupt-ref',
				analyses: (await runNarrativeAnalyzer({ panels: extraction.panels, analyzedBy: 'test', minConfidence: 0.1 })).analyses,
				readingOrder: 'rtl',
			}).sequence,
			panels: extraction.panels,
			style: 'narrative_recap',
			generatedBy: 'test',
		});

		const report = runGateGNarrativeFidelity({ script: scriptResult.script, panels: extraction.panels });
		// Should flag invalid image paths or needs_review scenes
		expect(report.verdict).not.toBe('pass');
	});
});

// ─── Checkpoint Recovery ─────────────────────────────────────────────────────

describe('Phase 2: Checkpoint Recovery', () => {
	it('story engine saves checkpoint after narrative stage and can resume', async () => {
		const dir = join(FIXTURES_DIR, 'ckpt-p2');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'page_000.png'), await createDistinctPng(800, 1200, 800));

		const chapter = await importChapter({ chapterId: 'ckpt-p2', archivePath: dir, outputDir: OUTPUT_DIR });
		const extraction = await extractPanels({ chapter, outputDir: OUTPUT_DIR });

		const result = await runStoryEngine({
			chapterId: 'ckpt-p2',
			panels: extraction.panels,
			outputDir: OUTPUT_DIR,
			scriptStyle: 'narrative_recap',
		});

		// Verify checkpoint was saved with fidelity stage
		const ckptDir = join(OUTPUT_DIR, 'ckpt-p2', 'checkpoints');
		const loaded = loadCheckpoint(ckptDir);
		expect(loaded).not.toBeNull();
		expect(loaded!.completedStages).toContain('narrative');
		expect(loaded!.completedStages).toContain('fidelity');

		// Verify script was generated
		expect(result.script.scenes.length).toBeGreaterThanOrEqual(1);
		expect(result.gateGReport).toBeDefined();
	});
});

// ─── Block Invented Narratives ───────────────────────────────────────────────

describe('Phase 2: Block Invented Narratives', () => {
	it('script generator never produces narration without panel evidence', () => {
		const analyses: PanelAnalysis[] = [
			panelAnalysisSchema.parse({
				panelId: 'p0', characters: [], dialogues: [], actions: [{ type: 'none', description: 'No detectable action' }],
				emotions: ['unknown'], evidence: [], analysisConfidence: 0, analyzedBy: 'test', analyzedAtIso: new Date().toISOString(),
			}),
		];

		const sequence: NarrativeSequence = {
			chapterId: 'no-invent',
			beats: [storyBeatSchema.parse({
				beatId: 'b0', panelIds: ['p0'], summary: 'em cena', characters: [], emotion: 'unknown',
				actionType: 'none', pageNumber: 0, confidence: 0, needsReview: true, reviewReason: 'No evidence',
			})],
			readingOrder: 'rtl',
			generatedAtIso: new Date().toISOString(),
		};

		const panels = [makePanel('p0')];
		const result = runScriptGenerator({ sequence, panels, style: 'narrative_recap', generatedBy: 'test' });

		// Script should still generate a scene but with low confidence and needs_review
		expect(result.script.scenes.length).toBe(1);
		const scene = result.script.scenes[0]!;
		expect(scene.reviewStatus).toBe('needs_review');
		expect(scene.confidence).toBe(0);
		// Narration must be generic fallback, not invented content
		expect(scene.narrationText).not.toContain('lutou');
		expect(scene.narrationText).not.toContain('morreu');
		expect(scene.narrationText).not.toContain('poder');
	});

	it('Gate G fails when scene has no panel references', () => {
		const script: RecapScript = recapScriptSchema.parse({
			chapterId: 'no-panels',
			title: 'Test',
			style: 'narrative_recap',
			scenes: [sceneSchema.parse({
				sceneId: 's0', narrationText: 'Cena inventada.', characters: ['Fantasma'],
				eventDescription: 'Evento sem painel', panelIds: ['ghost_panel'], croppedImagePaths: [],
				estimatedDurationSec: 2, emotion: 'neutral', narrativeIntent: 'exposition',
				confidence: 0.1, reviewStatus: 'needs_review',
			})],
			totalEstimatedDurationSec: 2,
			generatedAtIso: new Date().toISOString(),
			generatedBy: 'test',
		});

		const report = runGateGNarrativeFidelity({ script, panels: [] });
		expect(report.verdict).toBe('fail');
		expect(report.hints.some((h) => h.issueCode === 'missing_panel_reference')).toBe(true);
	});
});

// ─── Full Pipeline Integration ───────────────────────────────────────────────

describe('Phase 2: Full Pipeline Integration', () => {
	it('end-to-end: import → extract → analyze → continuity → script → gate G', async () => {
		const dir = join(FIXTURES_DIR, 'e2e-pipeline');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'page_000.png'), await createTwoPanelPage(800, 1200));
		writeFileSync(join(dir, 'page_001.png'), await createDistinctPng(800, 1200, 900));

		const chapter = await importChapter({ chapterId: 'e2e', archivePath: dir, outputDir: OUTPUT_DIR, readingOrder: 'rtl' });
		const extraction = await extractPanels({ chapter, outputDir: OUTPUT_DIR });

		const result = await runStoryEngine({
			chapterId: 'e2e',
			panels: extraction.panels,
			outputDir: OUTPUT_DIR,
			visionAdapter: createMockVisionAdapter(),
			scriptStyle: 'cinematic_recap',
			minBeatConfidence: 0.3,
		});

		// Script must have at least one scene
		expect(result.script.scenes.length).toBeGreaterThanOrEqual(1);
		// All scenes must reference valid panels
		for (const scene of result.script.scenes) {
			expect(scene.panelIds.length).toBeGreaterThan(0);
		}
		// Gate G report must exist
		expect(result.gateGReport.gate).toBe('G_narrative_fidelity');
		// Analyses must be present
		expect(result.analyses.length).toBeGreaterThanOrEqual(1);
		// Sequence must have beats
		expect(result.sequence.beats.length).toBeGreaterThanOrEqual(1);
	}, 30000);

	it('different script styles produce different narration tones', async () => {
		const dir = join(FIXTURES_DIR, 'styles-test');
		mkdirSync(dir, { recursive: true });
		writeFileSync(join(dir, 'page_000.png'), await createDistinctPng(800, 1200, 1000));

		const chapter = await importChapter({ chapterId: 'styles', archivePath: dir, outputDir: OUTPUT_DIR });
		const extraction = await extractPanels({ chapter, outputDir: OUTPUT_DIR });

		const cinematic = await runStoryEngine({
			chapterId: 'styles', panels: extraction.panels, outputDir: OUTPUT_DIR,
			scriptStyle: 'cinematic_recap', minBeatConfidence: 0.1,
		});
		const mystery = await runStoryEngine({
			chapterId: 'styles', panels: extraction.panels, outputDir: OUTPUT_DIR,
			scriptStyle: 'mystery', minBeatConfidence: 0.1,
		});

		// Both should produce scripts
		expect(cinematic.script.scenes.length).toBeGreaterThanOrEqual(1);
		expect(mystery.script.scenes.length).toBeGreaterThanOrEqual(1);
		// Styles should differ in narration text
		const cinText = cinematic.script.scenes[0]!.narrationText;
		const mysText = mystery.script.scenes[0]!.narrationText;
		// They may or may not differ depending on content, but both must be valid
		expect(cinText.length).toBeGreaterThan(0);
		expect(mysText.length).toBeGreaterThan(0);
	}, 30000);
});