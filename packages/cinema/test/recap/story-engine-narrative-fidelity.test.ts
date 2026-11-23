import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	runStoryEngine,
	runGateGNarrativeFidelity,
	runNarrativeHumanizer,
	isGenericNarration,
	REVIEW_REQUIRED_PREFIX,
	classifyBubbleKind,
	mergeVisionAndOcrDialogues,
	type ExtractedPanel,
	type VisionAdapter,
	type TextEnhancementPort,
	type RecapScript,
} from '../../src/recap/index.js';

const TEST_DIR = join(tmpdir(), `recap-story-fidelity-${Date.now()}`);

function makePanel(dir: string, id: string, pageNumber: number, panelIndex: number, ocrText?: string): ExtractedPanel {
	const cropPath = join(dir, `${id}.png`);
	writeFileSync(cropPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
	return {
		panelId: id,
		pagePath: cropPath,
		croppedImagePath: cropPath,
		metadata: {
			sourceKind: 'panel_crop',
			origin: 'webtoon_extract',
			chapterId: 'nano-test',
			pageNumber,
			panelIndex,
			readingOrder: 'vertical',
			boundingBox: { x: 0, y: panelIndex * 300, w: 800, h: 300 },
			classification: 'action',
			ocrStatus: ocrText ? 'success' : 'not_run',
			ocrConfidence: ocrText ? 0.85 : 0,
			...(ocrText ? { textContent: ocrText } : {}),
		},
		imageHash: `hash-${id}`,
		width: 800,
		height: 300,
	};
}

describe('Story Engine Narrative Fidelity (Phases 2–8)', () => {
	beforeEach(() => {
		mkdirSync(TEST_DIR, { recursive: true });
	});

	afterEach(() => {
		rmSync(TEST_DIR, { recursive: true, force: true });
	});

	it('Phase 2 & 3 & 4 & 5: produces rich grounded narration combining image, speech bubbles, prior and next context', async () => {
		const p1 = makePanel(TEST_DIR, 'ch1_p0_0', 0, 0);
		const p2 = makePanel(TEST_DIR, 'ch1_p0_1', 0, 1);

		let callIdx = 0;
		const visionAdapter: VisionAdapter = {
			name: 'test-multimodal-vision',
			async analyze(_img, ctx) {
				callIdx++;
				if (callIdx === 1) {
					return {
						visualDescription: 'Cheon Yeo-Woon está caído no pátio coberto de poeira, ferido no ombro, tentando se apoiar no chão para se levantar',
						characters: ['Cheon Yeo-Woon'],
						actions: [{ type: 'combat', description: 'Cheon Yeo-Woon tenta se levantar apesar do ferimento no ombro' }],
						emotions: ['determination'],
						expressions: ['determinação sofrida'],
						relevantObjects: ['espada quebrada'],
						setting: 'pátio de treinamento do Culto Demoníaco',
						speechBubbles: [
							{
								originalText: 'Eu ainda não terminei...',
								translatedText: 'Eu ainda não terminei...',
								text: 'Eu ainda não terminei...',
								speaker: 'Cheon Yeo-Woon',
								kind: 'thought',
								isNarration: false,
								readingOrder: 0,
							},
						],
						confidence: 0.92,
					};
				}
				// Verify previous panel context was propagated to VisionAdapter
				expect(ctx?.knownCharacters).toContain('Cheon Yeo-Woon');
				return {
					visualDescription: 'Um adversário de manto escuro se aproxima observando o esforço de Cheon Yeo-Woon com olhar desafiador',
					characters: ['Adversário de manto escuro', 'Cheon Yeo-Woon'],
					actions: [{ type: 'dialogue', description: 'O adversário encara Cheon Yeo-Woon e questiona sua resistência' }],
					emotions: ['tension'],
					expressions: ['desdém tenso'],
					setting: 'pátio de treinamento do Culto Demoníaco',
					speechBubbles: [
						{
							originalText: 'Can you still fight?',
							translatedText: 'Você ainda consegue lutar?',
							text: 'Você ainda consegue lutar?',
							speaker: 'Adversário de manto escuro',
							kind: 'dialogue',
							isNarration: false,
							readingOrder: 0,
						},
					],
					confidence: 0.9,
				};
			},
		};

		const result = await runStoryEngine({
			chapterId: 'nano-test',
			workTitle: 'Nano Machine',
			panels: [p1, p2],
			outputDir: join(TEST_DIR, 'out'),
			visionAdapter,
			scriptStyle: 'narrative_recap',
		});

		expect(result.gateGReport.verdict).toBe('pass');
		expect(result.script.scenes.length).toBeGreaterThanOrEqual(1);

		const fullNarration = result.script.scenes.map((s) => s.narrationText).join(' ');
		expect(fullNarration).not.toContain('A história avançou.');
		expect(fullNarration).toContain('Cheon Yeo-Woon');
		expect(fullNarration).toContain('Você ainda consegue lutar?');

		// Phase 4: continuity state tracks characters, location, events, open questions
		expect(result.sequence.continuityState?.characters.map((c) => c.name)).toContain('Cheon Yeo-Woon');
		expect(result.sequence.continuityState?.currentLocation).toContain('pátio');
		expect(result.sequence.continuityState?.openQuestions).toContain('Você ainda consegue lutar?');

		// Phase 7: realistic estimated duration > 1s and tagged as estimated
		for (const scene of result.script.scenes) {
			expect(scene.durationSource).toBe('estimated');
			expect(scene.estimatedDurationSec).toBeGreaterThan(2);
			expect(scene.visualSummary).toBeTruthy();
		}
	});

	it('Phase 3: classifies dialogue, thought, narration and SFX bubbles and merges VLM + OCR without duplicates', () => {
		expect(classifyBubbleKind('BOOM!')).toBe('sfx');
		expect(classifyBubbleKind('(Preciso escapar agora...)')).toBe('thought');
		expect(classifyBubbleKind('Narração: Naquela noite tudo mudou.')).toBe('narration');
		expect(classifyBubbleKind('"Quem é você?"')).toBe('dialogue');

		const merged = mergeVisionAndOcrDialogues({
			panelId: 'p1',
			visionBubbles: [
				{ text: 'Você ainda consegue lutar?', originalText: 'Can you still fight?', translatedText: 'Você ainda consegue lutar?', speaker: 'Rival', kind: 'dialogue', isNarration: false, readingOrder: 0 },
			],
			ocrDialogues: [
				{ text: 'Can you still fight?', originalText: 'Can you still fight?', kind: 'dialogue', isNarration: false, readingOrder: 0 },
				{ text: 'Naquele instante o silêncio tomou conta do pátio inteiro.', originalText: 'Naquele instante o silêncio tomou conta do pátio inteiro.', kind: 'narration', isNarration: true, readingOrder: 1 },
			],
		});

		expect(merged.dialogues).toHaveLength(2);
		expect(merged.dialogues[0]!.speaker).toBe('Rival');
		expect(merged.dialogues[0]!.translatedText).toBe('Você ainda consegue lutar?');
		expect(merged.dialogues[1]!.kind).toBe('narration');
	});

	it('Phase 5 & 8: never emits "A história avançou." when vision & OCR are empty; flags for human review and fails Gate G', async () => {
		const p1 = makePanel(TEST_DIR, 'empty_p0_0', 0, 0);
		const p2 = makePanel(TEST_DIR, 'empty_p1_0', 1, 0);

		const result = await runStoryEngine({
			chapterId: 'empty-test',
			panels: [p1, p2],
			outputDir: join(TEST_DIR, 'out-empty'),
			// No visionAdapter and no OCR text
		});

		expect(result.gateGReport.verdict).toBe('fail');
		for (const scene of result.script.scenes) {
			expect(scene.narrationText).not.toContain('A história avançou.');
			expect(scene.narrationText.startsWith(REVIEW_REQUIRED_PREFIX)).toBe(true);
			expect(scene.reviewStatus).toBe('needs_review');
		}
		expect(result.gateGReport.hints.some((h) => h.issueCode === 'insufficient_narrative_content')).toBe(true);
	});

	it('Phase 8: Gate G explicitly blocks generic repeated phrases and duration mismatches', () => {
		const p1 = makePanel(TEST_DIR, 'g_p0_0', 0, 0);
		const p2 = makePanel(TEST_DIR, 'g_p1_0', 1, 0);

		const badScript: RecapScript = {
			chapterId: 'bad',
			title: 'Recap — bad',
			style: 'narrative_recap',
			scenes: [
				{
					sceneId: 's1',
					narrationText: 'A história avançou.',
					characters: [],
					eventDescription: 'em cena',
					panelIds: [p1.panelId],
					croppedImagePaths: [p1.croppedImagePath!],
					estimatedDurationSec: 1,
					emotion: 'unknown',
					narrativeIntent: 'exposition',
					confidence: 0,
					reviewStatus: 'needs_review',
				},
				{
					sceneId: 's2',
					narrationText: 'A história avançou.',
					characters: [],
					eventDescription: 'em cena',
					panelIds: [p2.panelId],
					croppedImagePaths: [p2.croppedImagePath!],
					estimatedDurationSec: 1,
					emotion: 'unknown',
					narrativeIntent: 'rising_action',
					confidence: 0,
					reviewStatus: 'needs_review',
				},
			],
			totalEstimatedDurationSec: 2,
			generatedAtIso: new Date().toISOString(),
			generatedBy: 'legacy-broken',
		};

		expect(isGenericNarration('A história avançou.')).toBe(true);
		const gateG = runGateGNarrativeFidelity({ script: badScript, panels: [p1, p2] });
		expect(gateG.verdict).toBe('fail');
		expect(gateG.hints.some((h) => h.issueCode === 'generic_narration')).toBe(true);
	});

	it('recovers a Gate G failure with the configured script fallback without re-running vision', async () => {
		const p1 = makePanel(TEST_DIR, 'fallback_p0_0', 0, 0);
		let visionCalls = 0;
		let fallbackCalls = 0;
		const visionAdapter: VisionAdapter = {
			name: 'codex-vision',
			async analyze() {
				visionCalls++;
				return {
					visualDescription: 'Um jovem ergue a espada diante do adversário.',
					characters: ['o jovem', 'o adversário'],
					actions: [{ type: 'combat', description: 'O jovem se prepara para lutar no próximo capítulo.' }],
					emotions: ['tension'],
					setting: 'pátio de treinamento',
					confidence: 0.95,
				};
			},
		};
		const scriptFallbackPort: TextEnhancementPort = {
			name: 'codex-script-fallback',
			async enhance() {
				fallbackCalls++;
				return {
					text: JSON.stringify({ narrationText: 'O jovem ergue a espada diante do adversário.' }),
					agentId: 'codex',
					model: 'codex-test',
					ok: true,
				};
			},
		};

		const result = await runStoryEngine({
			chapterId: 'fallback-test',
			panels: [p1],
			outputDir: join(TEST_DIR, 'out-fallback'),
			visionAdapter,
			scriptFallbackPort,
		});

		expect(visionCalls).toBe(1);
		expect(fallbackCalls).toBeGreaterThan(0);
		expect(result.gateGReport.verdict).toBe('pass');
		expect(result.script.scenes[0]?.narrationText).toBe('O jovem ergue a espada diante do adversário.');
		expect(result.warnings.some((warning) => warning.includes('fallback'))).toBe(true);
	});

	it('Phase 6: Humanizer reverts if LLM replaces narration with a generic phrase or drops essential dialogue', async () => {
		const p1 = makePanel(TEST_DIR, 'h_p0_0', 0, 0);
		const script: RecapScript = {
			chapterId: 'hum',
			title: 'Recap — hum',
			style: 'narrative_recap',
			scenes: [
				{
					sceneId: 'scene-1',
					narrationText: 'Mesmo ferido, Cheon Yeo-Woon tenta se levantar no pátio enquanto o rival questiona: "Você ainda consegue lutar?".',
					characters: ['Cheon Yeo-Woon'],
					eventDescription: 'Cheon Yeo-Woon tenta se levantar',
					visualSummary: 'Cheon Yeo-Woon ferido no pátio',
					extractedDialogues: [
						{
							text: 'Você ainda consegue lutar?',
							originalText: 'Você ainda consegue lutar?',
							kind: 'dialogue',
							isNarration: false,
						},
					],
					panelIds: [p1.panelId],
					croppedImagePaths: [p1.croppedImagePath!],
					estimatedDurationSec: 8,
					durationSource: 'estimated',
					emotion: 'determination',
					narrativeIntent: 'rising_action',
					confidence: 0.9,
					reviewStatus: 'approved',
				},
			],
			totalEstimatedDurationSec: 8,
			generatedAtIso: new Date().toISOString(),
			generatedBy: 'story-engine',
		};

		const genericPort: TextEnhancementPort = {
			name: 'bad-generic-humanizer',
			async enhance() {
				return {
					ok: true,
					text: JSON.stringify({ humanizedText: 'A história avançou.' }),
					agentId: 'mock',
					model: 'mock',
				};
			},
		};

		const res = await runNarrativeHumanizer({
			script,
			panels: [p1],
			options: { enabled: true, style: 'narrative_recap', port: genericPort },
		});

		expect(res.diffs[0]!.reverted).toBe(true);
		expect(res.script.scenes[0]!.narrationText).toContain('Você ainda consegue lutar?');
	});
});
