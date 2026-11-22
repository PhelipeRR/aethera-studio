import { describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isLikelyOcrGarbage } from '../../src/recap/dialogue-extractor.js';
import {
	runScriptGenerator,
	extractNarrativeEventsFromBeat,
	detectTechnicalVisualDescription,
} from '../../src/recap/script-generator.js';
import { runGateGNarrativeFidelity } from '../../src/recap/gate-g-narrative-fidelity.js';
import { runNarrativeHumanizer } from '../../src/recap/narrative-humanizer.js';
import { runStoryEngine } from '../../src/recap/story-engine.js';
import { computeScriptCacheKey, RECAP_SCRIPT_GENERATOR_VERSION } from '../../src/recap/checkpoint-persistence.js';
import type { ExtractedPanel, NarrativeSequence, RecapScript, VisionAdapter } from '../../src/recap/recap-types.js';

describe('Recap Script Narration Quality & OCR Garbage Filtering', () => {
	it('rejects garbled Tesseract OCR noise while preserving real Portuguese dialogue', () => {
		expect(isLikelyOcrGarbage('a k ie pe', 'Baixa confiança na leitura do texto (41%).')).toBe(true);
		expect(isLikelyOcrGarbage('o. pia ; + : ae pe nia', 'Baixa confiança na leitura do texto (41%).')).toBe(true);
		expect(isLikelyOcrGarbage('1 - y g', 'Baixa confiança na leitura do texto (41%).')).toBe(true);
		expect(isLikelyOcrGarbage('a k ie pe')).toBe(true);
		expect(isLikelyOcrGarbage('1 - y g')).toBe(true);

		expect(isLikelyOcrGarbage('Quem está aí?!')).toBe(false);
		expect(isLikelyOcrGarbage('Não vou recuar diante do clã demoníaco.')).toBe(false);
		expect(isLikelyOcrGarbage('Oi!')).toBe(false);
	});

	it('strips visual alt-text jargon, OCR garbage, and repetitive dialogue prefixes from natural_recap narration', () => {
		const panels: ExtractedPanel[] = [
			{
				panelId: 'nano-machine-cap-1-5_p0_0',
				pageIndex: 0,
				panelIndex: 0,
				croppedImagePath: 'C:/tmp/p0.png',
				bbox: { x: 0, y: 0, width: 800, height: 1400 },
				metadata: {
					aspectRatio: 0.57,
					isSplash: true,
					isDoubleSpread: false,
					ocrStatus: 'success',
					ocrConfidence: 0.41,
					textContent: 'a k ie pe\no. pia ; + : ae pe nia\n1 - y g',
					imageHash: 'hash-p0',
				},
			},
			{
				panelId: 'nano-machine-cap-1-5_p1_0',
				pageIndex: 1,
				panelIndex: 0,
				croppedImagePath: 'C:/tmp/p1.png',
				bbox: { x: 0, y: 0, width: 800, height: 1400 },
				metadata: {
					aspectRatio: 0.57,
					isSplash: false,
					isDoubleSpread: false,
					ocrStatus: 'success',
					ocrConfidence: 0.92,
					textContent: 'Pare agora!\nVocê não tem para onde fugir.',
					imageHash: 'hash-p1',
				},
			},
		];

		const sequence: NarrativeSequence = {
			chapterId: 'nano-machine-cap-1-5',
			workTitle: 'Nano Machine',
			beats: [
				{
					beatId: 'beat-1',
					order: 0,
					panelIds: ['nano-machine-cap-1-5_p0_0'],
					summary: 'Paisagem montanhosa noturna coberta de névoa.',
					visualSummary:
						'Painel vertical de página inteira retratando uma paisagem montanhosa noturna em estilo de pintura digital. O fundo apresenta cinzentas sugerindo movimento brusco ou impacto. Não há personagens, balões de texto ou elementos de interface visíveis.',
					characters: ['Jovem de cabelo escuro ferido'],
					setting: 'montanhas noturnas',
					emotion: 'tension',
					actionType: 'observation',
					dialogues: [
						{ text: 'a k ie pe', originalText: 'a k ie pe', kind: 'dialogue', isNarration: false, readingOrder: 0, uncertainty: 'Baixa confiança na leitura do texto (41%).' },
						{ text: 'o. pia ; + : ae pe nia', originalText: 'o. pia ; + : ae pe nia', kind: 'dialogue', isNarration: false, readingOrder: 1, uncertainty: 'Baixa confiança na leitura do texto (41%).' },
						{ text: '1 - y g', originalText: '1 - y g', kind: 'dialogue', isNarration: false, readingOrder: 2, uncertainty: 'Baixa confiança na leitura do texto (41%).' },
					],
					confidence: 0.85,
				},
				{
					beatId: 'beat-2',
					order: 1,
					panelIds: ['nano-machine-cap-1-5_p1_0'],
					summary: 'Alguém pisa com força sobre um galho na mata noturna.',
					visualSummary:
						'Painel vertical mostrando uma perna pálida descendo do topo e pisando ou batendo contra um galho grosso e escuro que atravessa diagonalmente o painel; folhas e caules aparecem na lateral esquerda, enquanto fragmentos escuros se espalham pelo fundo cinza-azul e um efeito sonoro coreano em pincelada está posicionado no quadrante inferior direito.',
					characters: ['Jovem de cabelo escuro ferido'],
					setting: 'mata noturna',
					emotion: 'tension',
					actionType: 'combat',
					dialogues: [
						{ text: 'Pare agora!', originalText: 'Pare agora!', kind: 'dialogue', isNarration: false, readingOrder: 0, speaker: 'Jovem de cabelo escuro ferido' },
						{ text: 'Você não tem para onde fugir.', originalText: 'Você não tem para onde fugir.', kind: 'dialogue', isNarration: false, readingOrder: 1, speaker: 'Jovem de cabelo escuro ferido' },
					],
					confidence: 0.88,
				},
			],
			totalPanelsCovered: 2,
			continuityNotes: [],
		};

		const { script } = runScriptGenerator({
			sequence,
			panels,
			style: 'natural_recap',
			language: 'pt-BR',
			generatedBy: 'test',
		});

		const scene1 = script.scenes[0]!.narrationText;
		const scene2 = script.scenes[1]!.narrationText;

		// Scene 1: zero alt-text jargon, zero OCR garbage, grammatical Portuguese opening
		expect(scene1.toLowerCase()).not.toContain('painel vertical');
		expect(scene1.toLowerCase()).not.toContain('pintura digital');
		expect(scene1.toLowerCase()).not.toContain('quando uma paisagem');
		expect(scene1).not.toContain('a k ie pe');
		expect(scene1).not.toContain('o. pia');
		expect(scene1).not.toContain('1 - y g');
		expect(scene1).toContain('A história começa em uma paisagem montanhosa noturna');

		// Scene 2: zero layout/SFX jargon, real dialogues preserved without repeating "Nesse momento,"
		expect(scene2.toLowerCase()).not.toContain('painel vertical');
		expect(scene2.toLowerCase()).not.toContain('quadrante inferior direito');
		expect(scene2.toLowerCase()).not.toContain('lateral esquerda');
		expect(scene2.toLowerCase()).not.toContain('efeito sonoro coreano');
		expect(scene2.toLowerCase()).not.toContain('fundo cinza-azul');
		expect(scene2).toContain('Pare agora!');
		expect(scene2).toContain('Você não tem para onde fugir.');
		const nesseMomentoMatches = scene2.match(/Nesse momento,/g) ?? [];
		expect(nesseMomentoMatches.length).toBeLessThanOrEqual(1);
	});

	it('never leaks raw technical visual descriptions (e.g. painel vertical / estilo digital pintado) into natural_recap narration', () => {
		const rawTechnicalDesc =
			'Paisagem montanhosa noturna enevoada sob céu estrelado com lua, painel vertical de paisagem noturna em estilo digital pintado, mostrando céu escuro com nuvens e estrelas. Não há personagens visíveis no primeiro plano.';

		const panels: ExtractedPanel[] = [
			{
				panelId: 'nano-tech_p0_0',
				pageIndex: 0,
				panelIndex: 0,
				croppedImagePath: 'C:/tmp/nano-p0.png',
				bbox: { x: 0, y: 0, width: 800, height: 1400 },
				metadata: {
					aspectRatio: 0.57,
					isSplash: true,
					isDoubleSpread: false,
					ocrStatus: 'success',
					ocrConfidence: 0.1,
					textContent: '',
					imageHash: 'hash-nano-p0',
				},
			},
		];

		const sequence: NarrativeSequence = {
			chapterId: 'nano-tech-test',
			readingOrder: 'vertical',
			generatedAtIso: new Date().toISOString(),
			beats: [
				{
					beatId: 'beat-tech-1',
					panelIds: ['nano-tech_p0_0'],
					summary: rawTechnicalDesc,
					visualSummary: rawTechnicalDesc,
					actions: [
						{ type: 'observation', description: rawTechnicalDesc },
					],
					characters: [],
					setting: 'montanhas cobertas pela névoa sob céu estrelado com lua',
					emotion: 'neutral',
					actionType: 'observation',
					pageNumber: 0,
					confidence: 0.9,
					needsReview: false,
				},
			],
		};

		// 1. Explicit transformation step strips technical jargon from actions/setting
		const event = extractNarrativeEventsFromBeat(sequence.beats[0]!, 'natural_recap');
		for (const act of event.actions) {
			expect(detectTechnicalVisualDescription(act).isTechnical).toBe(false);
		}
		expect(event.setting).toContain('montanhas cobertas pela névoa');

		// 2. Script generator produces clean natural storytelling without technical jargon
		const { script } = runScriptGenerator({
			sequence,
			panels,
			style: 'natural_recap',
			language: 'pt-BR',
			generatedBy: 'test',
		});
		const narration = script.scenes[0]!.narrationText;
		const techCheck = detectTechnicalVisualDescription(narration, rawTechnicalDesc);
		expect(techCheck.isTechnical).toBe(false);
		expect(techCheck.isRawCopy).toBe(false);
		expect(narration.toLowerCase()).not.toContain('painel vertical');
		expect(narration.toLowerCase()).not.toContain('estilo digital pintado');
		expect(narration.toLowerCase()).not.toContain('primeiro plano');
		expect(narration.toLowerCase()).not.toContain('não há personagens visíveis');
		expect(narration).toContain('A história começa em');
	});

	it('Gate G rejects scripts containing technical visual analysis jargon or raw visualSummary copies', () => {
		const panels: ExtractedPanel[] = [
			{
				panelId: 'gate-g-tech_p0_0',
				pageIndex: 0,
				panelIndex: 0,
				croppedImagePath: 'C:/tmp/gate-g-p0.png',
				bbox: { x: 0, y: 0, width: 800, height: 1400 },
				metadata: {
					aspectRatio: 0.57,
					isSplash: false,
					isDoubleSpread: false,
					ocrStatus: 'success',
					ocrConfidence: 0.9,
					textContent: '',
					imageHash: 'hash-gate-g-p0',
				},
			},
		];

		const badScript: RecapScript = {
			chapterId: 'gate-g-tech',
			title: 'Test',
			style: 'natural_recap',
			generatedAtIso: new Date().toISOString(),
			generatedBy: 'test',
			totalEstimatedDurationSec: 5,
			scenes: [
				{
					sceneId: 'gate-g-tech_scene_0000',
					narrationText:
						'Em Paisagem montanhosa noturna enevoada sob céu estrelado com lua, painel vertical de paisagem noturna em estilo digital pintado, mostrando céu escuro com nuvens e estrelas.',
					characters: [],
					eventDescription: 'Paisagem',
					visualSummary:
						'Paisagem montanhosa noturna enevoada sob céu estrelado com lua, painel vertical de paisagem noturna em estilo digital pintado, mostrando céu escuro com nuvens e estrelas.',
					panelIds: ['gate-g-tech_p0_0'],
					croppedImagePaths: [],
					estimatedDurationSec: 5,
					emotion: 'neutral',
					narrativeIntent: 'exposition',
					confidence: 0.9,
					reviewStatus: 'approved',
				},
			],
		};

		const report = runGateGNarrativeFidelity({ script: badScript, panels });
		expect(report.verdict).toBe('fail');
		expect(report.hints.some((h) => h.issueCode === 'technical_visual_description')).toBe(true);
	});

	it('StoryEngine regenerateScriptOnly preserves cached visual analyses without re-running vision and binds script cache key to version+style', async () => {
		const workDir = mkdtempSync(join(tmpdir(), 'recap-cache-test-'));
		try {
			const imgPath = join(workDir, 'p0.png');
			writeFileSync(imgPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

			let visionCalls = 0;
			const visionAdapter: VisionAdapter = {
				name: 'mock-vision',
				async analyze() {
					visionCalls += 1;
					return {
						visualDescription: 'Um jovem corre desesperadamente pela floresta noturna.',
						characters: ['Jovem'],
						actions: [{ type: 'movement', description: 'O jovem corre pela floresta noturna' }],
						emotions: ['fear'],
						setting: 'floresta noturna',
						speechBubbles: [{ text: 'Não posso morrer aqui!', kind: 'dialogue', isNarration: false, speaker: 'Jovem', readingOrder: 0 }],
						confidence: 0.92,
					};
				},
			};

			const panels: ExtractedPanel[] = [
				{
					panelId: 'ch1_p0_0',
					pagePath: imgPath,
					croppedImagePath: imgPath,
					imageHash: 'hash-p0-cache-test',
					width: 800,
					height: 1200,
					metadata: {
						sourceKind: 'panel_crop',
						origin: 'webtoon_extract',
						chapterId: 'ch1',
						pageNumber: 0,
						panelIndex: 0,
						readingOrder: 'vertical',
						boundingBox: { x: 0, y: 0, w: 800, h: 1200 },
						classification: 'dialogue',
						ocrStatus: 'not_run',
						ocrConfidence: 0,
					},
				},
			];

			// First run: analyzes panel once
			const first = await runStoryEngine({
				chapterId: 'ch1',
				panels,
				outputDir: workDir,
				visionAdapter,
				scriptStyle: 'natural_recap',
			});
			expect(visionCalls).toBe(1);
			expect(first.gateGReport.verdict).toBe('pass');
			expect(first.script.scenes[0]!.narrationText).toContain('Não posso morrer aqui!');

			// Second run with regenerateScriptOnly=true: zero vision calls, preserves analyses!
			const second = await runStoryEngine({
				chapterId: 'ch1',
				panels,
				outputDir: workDir,
				visionAdapter,
				scriptStyle: 'natural_recap',
				regenerateScriptOnly: true,
			});
			expect(visionCalls).toBe(1);
			expect(second.script.scenes[0]!.narrationText).toContain('Não posso morrer aqui!');

			const keyNatural = computeScriptCacheKey({ chapterId: 'ch1', scriptStyle: 'natural_recap' });
			const keyCinematic = computeScriptCacheKey({ chapterId: 'ch1', scriptStyle: 'cinematic_recap' });
			expect(keyNatural).toContain(RECAP_SCRIPT_GENERATOR_VERSION);
			expect(keyNatural).not.toBe(keyCinematic);
		} finally {
			rmSync(workDir, { recursive: true, force: true });
		}
	});

	it('blocks Humanizer from adding ungrounded temperature/motivations or anticipating next-scene events, and Gate G catches cross-scene repetition', async () => {
		const panels: ExtractedPanel[] = [
			{
				panelId: 'cont_p0_0',
				pagePath: 'C:/tmp/cont-p0.png',
				croppedImagePath: 'C:/tmp/cont-p0.png',
				imageHash: 'h0',
				width: 800,
				height: 1200,
				metadata: {
					sourceKind: 'panel_crop',
					origin: 'webtoon_extract',
					chapterId: 'cont-test',
					pageNumber: 0,
					panelIndex: 0,
					readingOrder: 'vertical',
					boundingBox: { x: 0, y: 0, w: 800, h: 1200 },
					classification: 'establishing',
					ocrStatus: 'not_run',
					ocrConfidence: 0,
				},
			},
			{
				panelId: 'cont_p1_0',
				pagePath: 'C:/tmp/cont-p1.png',
				croppedImagePath: 'C:/tmp/cont-p1.png',
				imageHash: 'h1',
				width: 800,
				height: 1200,
				metadata: {
					sourceKind: 'panel_crop',
					origin: 'webtoon_extract',
					chapterId: 'cont-test',
					pageNumber: 1,
					panelIndex: 0,
					readingOrder: 'vertical',
					boundingBox: { x: 0, y: 0, w: 800, h: 1200 },
					classification: 'action',
					ocrStatus: 'not_run',
					ocrConfidence: 0,
				},
			},
			{
				panelId: 'cont_p2_0',
				pagePath: 'C:/tmp/cont-p2.png',
				croppedImagePath: 'C:/tmp/cont-p2.png',
				imageHash: 'h2',
				width: 800,
				height: 1200,
				metadata: {
					sourceKind: 'panel_crop',
					origin: 'webtoon_extract',
					chapterId: 'cont-test',
					pageNumber: 2,
					panelIndex: 0,
					readingOrder: 'vertical',
					boundingBox: { x: 0, y: 0, w: 800, h: 1200 },
					classification: 'action',
					ocrStatus: 'not_run',
					ocrConfidence: 0,
				},
			},
		];

		const script: RecapScript = {
			chapterId: 'cont-test',
			title: 'Continuity Test',
			style: 'natural_recap',
			generatedAtIso: new Date().toISOString(),
			generatedBy: 'test',
			totalEstimatedDurationSec: 15,
			scenes: [
				{
					sceneId: 'cont_scene_0000',
					narrationText: 'A história começa sob um céu estrelado com montanhas cobertas pela névoa.',
					characters: [],
					eventDescription: 'Montanhas à noite',
					visualSummary: 'Montanhas cobertas pela névoa sob céu estrelado.',
					setting: 'montanhas noturnas',
					actions: [{ type: 'observation', description: 'Montanhas cobertas pela névoa sob céu estrelado' }],
					panelIds: ['cont_p0_0'],
					croppedImagePaths: [],
					estimatedDurationSec: 5,
					emotion: 'neutral',
					narrativeIntent: 'exposition',
					confidence: 0.9,
					reviewStatus: 'approved',
				},
				{
					sceneId: 'cont_scene_0001',
					narrationText: 'Logo depois, um jovem corre pela floresta noturna e tropeça em um galho.',
					characters: ['o jovem'],
					eventDescription: 'Fuga na floresta',
					visualSummary: 'Um jovem corre pela floresta noturna e tropeça em um galho.',
					setting: 'floresta noturna',
					actions: [{ type: 'movement', description: 'Um jovem corre pela floresta noturna e tropeça em um galho' }],
					panelIds: ['cont_p1_0'],
					croppedImagePaths: [],
					estimatedDurationSec: 5,
					emotion: 'fear',
					narrativeIntent: 'rising_action',
					confidence: 0.9,
					reviewStatus: 'approved',
				},
				{
					sceneId: 'cont_scene_0002',
					narrationText: 'Em seguida, ele despenca por um penhasco rochoso.',
					characters: ['o jovem'],
					eventDescription: 'Queda do penhasco',
					visualSummary: 'O jovem despenca por um penhasco rochoso.',
					setting: 'penhasco rochoso',
					actions: [{ type: 'movement', description: 'Ele despenca por um penhasco rochoso' }],
					panelIds: ['cont_p2_0'],
					croppedImagePaths: [],
					estimatedDurationSec: 5,
					emotion: 'fear',
					narrativeIntent: 'climax',
					confidence: 0.9,
					reviewStatus: 'approved',
				},
			],
		};

		// Humanizer tries to invent "noite fria" in scene 0 and anticipate "penhasco rochoso" in scene 1
		const badHumanizer = {
			name: 'inventive-humanizer',
			async enhance(req: { context: Record<string, unknown> }) {
				const id = String(req.context['sceneId'] ?? '');
				if (id === 'cont_scene_0000') {
					return { text: JSON.stringify({ humanizedText: 'A história começa em uma noite fria sob um céu estrelado.' }), agentId: 'mock', model: 'm', ok: true };
				}
				if (id === 'cont_scene_0001') {
					return { text: JSON.stringify({ humanizedText: 'O jovem corre para se vingar e despenca pelo penhasco rochoso.' }), agentId: 'mock', model: 'm', ok: true };
				}
				return { text: JSON.stringify({ humanizedText: 'Em seguida, ele despenca por um penhasco rochoso.' }), agentId: 'mock', model: 'm', ok: true };
			},
		};

		const humRes = await runNarrativeHumanizer({
			script,
			panels,
			options: { enabled: true, style: 'natural_recap', port: badHumanizer },
		});
		expect(humRes.diffs[0]!.reverted).toBe(true);
		expect(humRes.diffs[0]!.revertReason).toContain('temperatura');
		expect(humRes.diffs[1]!.reverted).toBe(true);
		expect(humRes.diffs[1]!.revertReason).toContain('motivação');

		// Gate G catches cross-scene repetition if two consecutive scenes narrate the same fall
		const repeatedScript: RecapScript = {
			...script,
			scenes: [
				script.scenes[0]!,
				{
					...script.scenes[1]!,
					narrationText: 'O jovem perde o equilíbrio e despenca por um penhasco rochoso.',
				},
				{
					...script.scenes[2]!,
					narrationText: 'Em seguida, ele despenca por um penhasco rochoso.',
				},
			],
		};
		const gateReport = runGateGNarrativeFidelity({ script: repeatedScript, panels });
		expect(gateReport.verdict).toBe('fail');
		expect(gateReport.hints.some((h) => h.issueCode === 'cross_scene_repetition')).toBe(true);
		expect(gateReport.hints.some((h) => h.issueCode === 'anticipated_event')).toBe(true);
	});
});
