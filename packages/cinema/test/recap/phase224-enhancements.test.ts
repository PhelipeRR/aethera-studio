import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	runNarrativeAnalyzer,
	runStoryEngine,
	saveCheckpoint,
	loadCheckpoint,
	createMultiAgentVideoResearchPortAdapter,
	buildGateGDivergenceReport,
	runNarrativeHumanizer,
	type ExtractedPanel,
	type VisionAdapter,
	type TextEnhancementPort,
	type ResearchAgentAdapterPort,
	type RecapScript,
} from '../../src/recap/index.js';

function makePanel(id: string, pageNumber: number, imagePath: string, imageHash: string): ExtractedPanel {
	return {
		panelId: id,
		pagePath: imagePath,
		croppedImagePath: imagePath,
		metadata: {
			sourceKind: 'panel_crop',
			origin: 'webtoon_extract',
			chapterId: 'ch-test',
			pageNumber,
			panelIndex: pageNumber,
			readingOrder: 'vertical',
			boundingBox: { x: 0, y: pageNumber * 100, w: 800, h: 600 },
			classification: 'action',
			ocrStatus: 'not_run',
			ocrConfidence: 0,
		},
		imageHash,
		width: 800,
		height: 600,
	};
}

describe('Phase 2.2.4 Enhancements (Cache, Concurrency, Research Fallback, Humanize & Gate G)', () => {
	it('reuses cached analyses by panelId and imageHash without re-calling VisionAdapter', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-cache-test-'));
		try {
			const img1 = join(dir, 'p1.png');
			const img2 = join(dir, 'p2.png');
			writeFileSync(img1, 'img1');
			writeFileSync(img2, 'img2');

			const panels = [
				makePanel('p-1', 0, img1, 'hash-aaa'),
				makePanel('p-2', 1, img2, 'hash-bbb'),
				makePanel('p-3', 2, img1, 'hash-aaa'), // same imageHash as p-1
			];

			let visionCalls = 0;
			const visionAdapter: VisionAdapter = {
				name: 'test-vision',
				async analyze() {
					visionCalls++;
					return {
						characters: ['Cheon Yeo-Woon'],
						actions: [{ type: 'combat', description: 'Esquiva de ataque' }],
						emotions: ['determination'],
						setting: 'Pátio de treinamento',
						confidence: 0.85,
					};
				},
			};

			const first = await runNarrativeAnalyzer({
				panels,
				visionAdapter,
				analyzedBy: 'test-vision',
				concurrency: 2,
			});

			expect(first.analyses).toHaveLength(3);
			expect(first.analyses.map((a) => a.panelId)).toEqual(['p-1', 'p-2', 'p-3']);
			// p-3 shares hash-aaa with p-1 when analyzed sequentially or cached, at most 3 calls, at least 2
			expect(visionCalls).toBeGreaterThanOrEqual(2);

			// Resume from checkpoint: 0 fresh calls
			const callsBeforeResume = visionCalls;
			const second = await runNarrativeAnalyzer({
				panels,
				visionAdapter,
				analyzedBy: 'test-vision',
				cachedAnalyses: first.analyses,
			});
			expect(visionCalls).toBe(callsBeforeResume);
			expect(second.cacheHits).toBe(3);
			expect(second.analyzedFresh).toBe(0);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('persists panelAnalyses and analysisCacheByHash in StoryEngine checkpoint', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-ckpt-test-'));
		try {
			const img1 = join(dir, 'p1.png');
			writeFileSync(img1, 'img1');
			const panels = [makePanel('p-1', 0, img1, 'hash-111')];

			let calls = 0;
			const visionAdapter: VisionAdapter = {
				name: 'test-vision',
				async analyze() {
					calls++;
					return {
						characters: ['Protagonista'],
						actions: [{ type: 'observation', description: 'Observa o horizonte' }],
						emotions: ['tension'],
						setting: 'Montanha',
						confidence: 0.9,
					};
				},
			};

			await runStoryEngine({
				chapterId: 'ch-ckpt',
				panels,
				outputDir: dir,
				visionAdapter,
			});
			expect(calls).toBe(1);

			const ckpt = loadCheckpoint(join(dir, 'ch-ckpt', 'checkpoints'));
			expect(ckpt?.panelAnalyses).toHaveLength(1);
			expect(ckpt?.analysisCacheByHash?.['hash-111']).toBeDefined();

			// Second run resumes from checkpoint without calling visionAdapter again
			await runStoryEngine({
				chapterId: 'ch-ckpt',
				panels,
				outputDir: dir,
				visionAdapter,
			});
			expect(calls).toBe(1);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('falls back across compatible agents in createMultiAgentVideoResearchPortAdapter', async () => {
		const codexAdapter: ResearchAgentAdapterPort = {
			id: 'codex',
			async detect() {
				return { installed: true, authenticated: true, problems: [] };
			},
			async *run() {},
		};
		const claudeAdapter: ResearchAgentAdapterPort = {
			id: 'claude',
			async detect() {
				return { installed: true, authenticated: true, problems: [] };
			},
			async *run() {},
		};

		const port = createMultiAgentVideoResearchPortAdapter({
			adapters: [codexAdapter, claudeAdapter],
			cwd: '.',
			async runVideoResearchFn(adapter) {
				if (adapter.id === 'codex') {
					throw new Error('Codex usage limit reached until 2026-11-23');
				}
				return {
					references: [
						{
							kind: 'texto',
							title: 'Nano Machine Cap 1',
							url: 'https://www.webtoons.com/nano-machine',
							license: 'citação',
							note: 'Referência oficial capítulo 1.',
						},
					],
					rejected: 0,
					generation: { executionId: 'exec-claude-1', model: 'claude-sonnet' },
				};
			},
		});

		const res = await port.research({ topic: 'Nano Machine' });
		expect(res.ok).toBe(true);
		expect(res.agentId).toBe('claude');
		expect(res.references).toHaveLength(1);
	});

	it('reverts humanized scene when named character is omitted and builds divergence report', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-hum-test-'));
		try {
			const img1 = join(dir, 'p1.png');
			writeFileSync(img1, 'img1');
			const panels = [makePanel('p-1', 0, img1, 'hash-h1')];
			const script: RecapScript = {
				chapterId: 'ch-hum',
				title: 'Teste',
				style: 'narrative_recap',
				generatedAtIso: new Date().toISOString(),
				generatedBy: 'story-engine',
				totalEstimatedDurationSec: 5,
				scenes: [
					{
						sceneId: 'scene-1',
						narrationText: 'Cheon Yeo-Woon encara os guardas no pátio.',
						characters: ['Cheon Yeo-Woon'],
						eventDescription: 'Cheon Yeo-Woon encara os guardas.',
						panelIds: ['p-1'],
						croppedImagePaths: [img1],
						estimatedDurationSec: 5,
						emotion: 'tension',
						narrativeIntent: 'exposition',
						confidence: 0.9,
						reviewStatus: 'approved',
					},
				],
			};

			const port: TextEnhancementPort = {
				name: 'omitting-port',
				async enhance() {
					return {
						ok: true,
						agentId: 'claude',
						model: 'claude-sonnet',
						text: JSON.stringify({ humanizedText: 'O jovem encara os guardas no pátio em silêncio.' }),
					};
				},
			};

			const hum = await runNarrativeHumanizer({
				script,
				panels,
				options: { enabled: true, style: 'narrative_recap', maxDurationDeviation: 0.25, port },
			});

			expect(hum.diffs[0]?.reverted).toBe(true);
			expect(hum.diffs[0]?.revertReason).toContain('Cheon Yeo-Woon');
			expect(hum.script.scenes[0]?.narrationText).toBe(script.scenes[0]?.narrationText);

			const div = buildGateGDivergenceReport(hum.postHumanizeGateG, hum.postHumanizeGateG, hum.diffs);
			expect(div.revertedScenes).toBe(1);
			expect(div.evidencePreserved).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
