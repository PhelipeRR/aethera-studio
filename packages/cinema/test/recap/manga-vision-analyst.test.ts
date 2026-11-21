import { describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	MANGA_VISION_ANALYST_SCHEMA_VERSION,
	MANGA_VISION_ANALYST_VERSION,
	buildMangaVisionAnalystPrompt,
	consolidateMangaPanelSequence,
	contractToVisionAnalysisResult,
	createMangaVisionVisionAdapter,
	parseMangaVisionContractPayload,
	runMangaVisionQualityGate,
	runStoryEngine,
	stripCinematographicJargon,
	toStoryMemoryPromptContext,
	type ExtractedPanel,
	type PanelAnalysis,
	type RecapVisionRouterPort,
} from '../../src/recap/index.js';

function makePanel(id: string, pageNumber: number, panelIndex: number, imagePath: string): ExtractedPanel {
	return {
		panelId: id,
		pagePath: imagePath,
		croppedImagePath: imagePath,
		metadata: {
			sourceKind: 'panel_crop',
			origin: 'webtoon_extract',
			chapterId: 'nano-machine-cap-01',
			pageNumber,
			panelIndex,
			readingOrder: 'vertical',
			boundingBox: { x: 0, y: panelIndex * 300, w: 600, h: 300 },
			classification: 'action',
			ocrStatus: 'not_run',
			ocrConfidence: 0,
		},
		imageHash: `hash_${id}`,
		width: 600,
		height: 300,
	};
}

describe('Aethera Manga Vision Analyst Skill', () => {
	test('strips cinematographic jargon while preserving concrete story facts', () => {
		const raw = 'Em plano geral visto de cima (plongée), um jovem corre pela floresta à noite.';
		const cleaned = stripCinematographicJargon(raw);
		expect(cleaned).not.toMatch(/plano geral|plong[ée]e/i);
		expect(cleaned).toContain('jovem corre pela floresta à noite');
	});

	test('parses versioned MangaPanelContract and preserves specialized OCR & uncertainty', () => {
		const rawJson = JSON.stringify({
			schemaVersion: MANGA_VISION_ANALYST_SCHEMA_VERSION,
			narrativeSummary: 'Em plano médio, o jovem tropeça em uma raiz e grita assustado.',
			characters: [
				{
					idOrLabel: 'Jovem fugitivo',
					storyMemoryId: 'char_001',
					expression: 'surpresa',
					poseOrAction: 'tropeçando',
					basis: 'observed',
					evidence: 'Pé preso na raiz da árvore',
					confidence: 0.9,
				},
			],
			actions: [
				{
					type: 'movement',
					actor: 'Jovem fugitivo',
					description: 'Tropeça em uma raiz grossa no chão.',
					basis: 'observed',
					confidence: 0.92,
				},
			],
			speechBubbles: [
				{
					kind: 'dialogue',
					originalText: '끄악!!',
					translatedText: 'AAARGH!!',
					readingOrder: 0,
					speaker: null,
					speakerConfidence: 0.25,
					attributionBasis: 'uncertain',
					uncertainty: 'Balão fora do rosto, atribuição incerta.',
				},
				{
					kind: 'thought',
					originalText: 'Não posso parar agora!',
					translatedText: 'Não posso parar agora!',
					readingOrder: 1,
					speaker: 'Jovem fugitivo',
					speakerConfidence: 0.85,
					attributionBasis: 'context',
				},
			],
			expressions: ['surpresa'],
			emotions: ['surprise', 'fear'],
			environment: { setting: 'floresta escura', basis: 'observed', confidence: 0.88 },
			relevantObjects: ['raiz grossa'],
			relationToPrevious: 'Continua a fuga iniciada no painel anterior.',
			relationToNext: 'Prepara a queda do penhasco.',
			visualEvidence: [{ kind: 'visual_observation', detail: 'Pé enroscado na raiz', confidence: 0.9 }],
			uncertainties: [],
			confidence: 0.9,
		});

		const contract = parseMangaVisionContractPayload(rawJson);
		expect(contract).not.toBeNull();
		expect(contract!.narrativeSummary).not.toMatch(/plano m[ée]dio/i);

		const result = contractToVisionAnalysisResult(contract!);
		expect(result.speechBubbles).toHaveLength(2);
		expect(result.speechBubbles![0]!.speaker).toBeUndefined();
		expect(result.speechBubbles![0]!.uncertainty).toContain('incerta');
		expect(result.speechBubbles![1]!.kind).toBe('thought');
		expect(result.speechBubbles![1]!.speaker).toBe('Jovem fugitivo');
		expect(result.relationToPrevious).toContain('fuga');
		expect(result.relationToNext).toContain('penhasco');
	});

	test('consolidates consecutive panels into natural sequence without repetitive appearance traits', () => {
		const now = new Date().toISOString();
		const base = (panelId: string, desc: string, type: PanelAnalysis['actions'][number]['type'], setting: string): PanelAnalysis => ({
			panelId,
			visualDescription: desc,
			characters: ['Jovem'],
			dialogues: [],
			actions: [{ type, description: desc }],
			emotions: ['tension'],
			setting,
			evidence: [{ kind: 'visual_observation', content: desc, confidence: 0.9, sourcePanelId: panelId }],
			analysisConfidence: 0.9,
			analyzedBy: 'test-model',
			analyzedAtIso: now,
		});

		const analyses: PanelAnalysis[] = [
			base('p1', 'O jovem de cabelos escuros desalinhados em túnica clara com faixa roxa corre desesperado pela floresta.', 'movement', 'floresta'),
			base('p2', 'Em plano detalhe, o pé do jovem de cabelos escuros fica preso em uma raiz.', 'movement', 'floresta'),
			base('p3', 'Em close-up, ele demonstra expressão de surpresa.', 'reaction', 'floresta'),
			base('p4', 'O jovem de cabelos escuros cai de um penhasco.', 'movement', 'penhasco'),
		];

		const consolidated = consolidateMangaPanelSequence(analyses, { maxPanelsPerSequence: 4 });
		expect(consolidated.groups.length).toBeGreaterThanOrEqual(1);
		const firstGroup = consolidated.groups[0]!;
		expect(firstGroup.consolidatedNarrative).not.toMatch(/plano detalhe|close-up/i);
		expect(firstGroup.consolidatedNarrative).toContain('corre desesperado pela floresta');
		expect(firstGroup.consolidatedNarrative).toContain('raiz');
	});

	test('builds prompt with anti-spoiler Story Memory context and integrates with VisionRouter', async () => {
		const memPrompt = toStoryMemoryPromptContext({
			projectId: 'nano-machine',
			workTitle: 'Nano Machine',
			targetChapterNumber: 2,
			knownCharacters: [
				{
					characterId: 'char_001',
					displayName: 'Cheon Yeo-woon',
					nameStatus: 'confirmed',
					aliases: ['Jovem de túnica clara'],
					visualTraits: ['cabelos escuros', 'faixa roxa'],
				},
			],
			nameResolutionMap: { 'jovem de túnica clara': 'Cheon Yeo-woon' },
			previousChapterSummaries: [{ chapterNumber: 1, summary: 'O jovem caiu do penhasco.' }],
			immediatePreviousContext: 'Cap. 1 terminou com a queda.',
			ongoingConflicts: ['Perseguição na floresta'],
			openQuestions: [],
			revealedFacts: [],
		});

		const prompt = buildMangaVisionAnalystPrompt({
			workTitle: 'Nano Machine',
			panelIndex: 0,
			totalPanels: 6,
			readingOrder: 'vertical',
			storyMemoryContext: memPrompt,
		});

		expect(prompt).toContain('Cheon Yeo-woon');
		expect(prompt).toContain('capítulos anteriores ao cap. 2');
		expect(prompt).toContain('NUNCA invente nomes');

		let capturedContext = '';
		const mockRouter: RecapVisionRouterPort = {
			async describe() {
				return { value: null, provider: null, model: null, costUsd: 0, attempts: [] };
			},
			async analyze(input) {
				capturedContext = input.context ?? '';
				return {
					value: {
						nature: 'movement',
						natureConfidence: 0.9,
						description: 'Em plano médio, Cheon Yeo-woon corre pela floresta.',
						frames: [{ atMs: 0, observed: 'Cheon Yeo-woon correndo', visibleText: [] }],
						entities: [{ name: 'Cheon Yeo-woon', type: 'character', basis: 'observed', evidence: 'Traços confirmados', confidence: 0.9 }],
						actions: [{ description: 'Corre pela floresta', basis: 'observed', confidence: 0.9 }],
						environment: { description: 'floresta noturna', basis: 'observed', confidence: 0.85 },
						overlays: { burnedText: false, burnedTextRegion: null, watermark: false, webcam: false },
						limitations: [],
						confidence: 0.9,
					},
					provider: 'claude',
					model: 'claude-sonnet',
					costUsd: 0.01,
					attempts: [{ provider: 'claude', outcome: 'ok' }],
				};
			},
		};

		const adapter = createMangaVisionVisionAdapter({
			router: mockRouter,
			storyMemoryContext: memPrompt,
		});

		expect(adapter.name).toBe(`manga-vision-analyst@${MANGA_VISION_ANALYST_VERSION}(router)`);
		const result = await adapter.analyze('dummy-panel.png', { panelIndex: 0, totalPanels: 6 });
		expect(capturedContext).toContain('Cheon Yeo-woon');
		expect(result.visualDescription).not.toMatch(/plano m[ée]dio/i);
		expect(result.visualDescription).toContain('Cheon Yeo-woon corre pela floresta');
		expect(result.confidence).toBe(0.9);
	});

	test('Quality Gate requests punctual review without blocking production for minor doubts, and blocks spoilers', () => {
		const tempDir = join(tmpdir(), `manga-qg-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		const img1 = join(tempDir, 'p1.png');
		const img2 = join(tempDir, 'p2.png');
		writeFileSync(img1, 'png');
		writeFileSync(img2, 'png');

		try {
			const panels = [makePanel('p1', 0, 0, img1), makePanel('p2', 0, 1, img2)];
			const now = new Date().toISOString();

			const minorDoubtAnalyses: PanelAnalysis[] = [
				{
					panelId: 'p1',
					visualDescription: 'O jovem corre pela floresta.',
					characters: ['Jovem'],
					dialogues: [{ text: 'Quem está aí?', kind: 'dialogue', isNarration: false }],
					actions: [{ type: 'movement', description: 'Corre pela floresta' }],
					emotions: ['tension'],
					evidence: [{ kind: 'visual_observation', content: 'Correndo', confidence: 0.85, sourcePanelId: 'p1' }],
					analysisConfidence: 0.85,
					analyzedBy: 'test',
					analyzedAtIso: now,
				},
				{
					panelId: 'p2',
					visualDescription: 'Ele tropeça em uma raiz.',
					characters: ['Jovem'],
					dialogues: [],
					actions: [{ type: 'movement', description: 'Tropeça na raiz' }],
					emotions: ['surprise'],
					evidence: [{ kind: 'visual_observation', content: 'Raiz', confidence: 0.45, sourcePanelId: 'p2' }],
					analysisConfidence: 0.45,
					analyzedBy: 'test',
					analyzedAtIso: now,
				},
			];

			const minorReport = runMangaVisionQualityGate({ panels, analyses: minorDoubtAnalyses, minConfidence: 0.5 });
			expect(minorReport.verdict).toBe('needs_review');
			expect(minorReport.shouldBlockProduction).toBe(false);
			expect(minorReport.reviewItems.length).toBeGreaterThanOrEqual(2);

			const spoilerAnalyses: PanelAnalysis[] = [
				{
					...minorDoubtAnalyses[0]!,
					visualDescription: 'No próximo capítulo ele vai despertar a Nano Máquina.',
				},
				minorDoubtAnalyses[1]!,
			];

			const spoilerReport = runMangaVisionQualityGate({ panels, analyses: spoilerAnalyses });
			expect(spoilerReport.verdict).toBe('fail');
			expect(spoilerReport.shouldBlockProduction).toBe(true);
		} finally {
			if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
		}
	});

	test('StoryEngine runs MangaVisionAnalyst end-to-end with natural_recap', async () => {
		const tempDir = join(tmpdir(), `manga-se-${Date.now()}`);
		mkdirSync(tempDir, { recursive: true });
		const img1 = join(tempDir, 'p1.png');
		const img2 = join(tempDir, 'p2.png');
		writeFileSync(img1, 'png');
		writeFileSync(img2, 'png');

		try {
			const panels = [makePanel('p1', 0, 0, img1), makePanel('p2', 0, 1, img2)];
			const res = await runStoryEngine({
				chapterId: 'nano-machine-cap-01',
				panels,
				outputDir: tempDir,
				scriptStyle: 'natural_recap',
				workTitle: 'Nano Machine',
				mangaVisionAnalyst: { enabled: true, consolidateSequences: true, qualityGate: true },
				visionAdapter: {
					name: 'mock-manga-vision',
					async analyze(pathOrBuf) {
						const p = String(pathOrBuf);
						if (p.endsWith('p1.png')) {
							return {
								visualDescription: 'Em plano geral, um jovem corre desesperado pela floresta.',
								characters: ['Jovem'],
								actions: [{ type: 'movement', description: 'Corre pela floresta' }],
								emotions: ['tension'],
								setting: 'floresta',
								confidence: 0.9,
							};
						}
						return {
							visualDescription: 'Em plano detalhe, ele tropeça em uma raiz e cai do penhasco.',
							characters: ['Jovem'],
							actions: [{ type: 'movement', description: 'Tropeça e cai do penhasco' }],
							emotions: ['surprise'],
							setting: 'penhasco',
							speechBubbles: [{ text: 'AAARGH!!', kind: 'dialogue', isNarration: false }],
							confidence: 0.88,
						};
					},
				},
			});

			expect(res.sequenceGroups).toBeDefined();
			expect(res.mangaQualityGateReport).toBeDefined();
			expect(res.mangaQualityGateReport!.shouldBlockProduction).toBe(false);
			expect(res.script.style).toBe('natural_recap');
			const fullText = res.script.scenes.map((s) => s.narrationText).join(' ');
			expect(fullText).not.toMatch(/plano geral|plano detalhe/i);
			expect(res.gateGReport.verdict).toBe('pass');
		} finally {
			if (existsSync(tempDir)) rmSync(tempDir, { recursive: true, force: true });
		}
	});
});
