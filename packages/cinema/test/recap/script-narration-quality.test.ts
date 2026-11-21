import { describe, expect, it } from 'bun:test';
import { isLikelyOcrGarbage } from '../../src/recap/dialogue-extractor.js';
import { runScriptGenerator } from '../../src/recap/script-generator.js';
import type { ExtractedPanel, NarrativeSequence } from '../../src/recap/recap-types.js';

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
});
