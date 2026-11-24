import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	annotateRecapDialogue,
	classifyRecapTextContent,
	runNarrativeAnalyzer,
	type ExtractedPanel,
	type VisionAdapter,
} from '../../src/recap/index.js';

function panel(id = 'p1_1'): ExtractedPanel {
	return {
		panelId: id,
		pagePath: 'fixture.png',
		metadata: {
			sourceKind: 'panel_crop',
			origin: 'manga_scan',
			chapterId: 'chapter-1',
			pageNumber: 1,
			panelIndex: 1,
			readingOrder: 'rtl',
			boundingBox: { x: 0, y: 0, w: 800, h: 800 },
			classification: 'action',
			ocrStatus: 'not_run',
			ocrConfidence: 0,
		},
		imageHash: `sha-${id}`,
		width: 800,
		height: 800,
	};
}

describe('Phase 4B.10 — structured text content boundary', () => {
	it('uses balloon, typography and context signals to separate a reaction SFX from speech', () => {
		const result = classifyRecapTextContent({
			text: '!!!',
			explicitKind: 'dialogue',
			balloon: 'reaction',
			balloonPresent: true,
			typography: { stylized: true, oversized: true },
			visualContext: { reactionGlyph: true, impactOrMotion: true },
			source: 'vision',
			panelId: 'p1_1',
		});

		assert.equal(result.kind, 'sound_effect');
		assert.equal(result.narrativeEligible, false);
		assert.ok(result.evidence.some((item) => item.source === 'balloon'));
		assert.equal(result.provenance.panelId, 'p1_1');
	});

	it('keeps original text and provenance while mapping captions to narrative text', () => {
		const result = classifyRecapTextContent({
			text: 'Enquanto isso: a noite caiu sobre a cidade.',
			balloon: 'narration',
			source: 'ocr',
			panelId: 'p2_0',
			lineIndex: 0,
		});

		assert.equal(result.kind, 'narrative_caption');
		assert.equal(result.originalText, 'Enquanto isso: a noite caiu sobre a cidade.');
		assert.equal(result.narrativeEligible, true);
		assert.deepEqual(result.provenance, { source: 'ocr', panelId: 'p2_0', lineIndex: 0, ref: 'p2_0:0' });
	});

	it('does not treat a short normal sentence as a fact without balloon/context evidence', () => {
		const result = classifyRecapTextContent({ text: 'Ele chegou.' });
		assert.equal(result.kind, 'dialogue');
		assert.equal(result.narrativeEligible, true);
		assert.ok((result.confidence ?? 1) < 0.7);
	});

	it('normalizes model bubbles before Story Engine and exposes motion metadata', async () => {
		const adapter: VisionAdapter = {
			name: 'fixture-local-vlm',
			analyze: async () => ({
				visualDescription: 'Uma figura golpeia um objeto.',
				characters: ['figura mascarada'],
				actions: [{ type: 'combat', description: 'A figura golpeia o objeto.' }],
				emotions: ['surprise'],
				speechBubbles: [{ text: '!!!', originalText: '!!!', kind: 'dialogue', isNarration: false, readingOrder: 0 }],
				setting: 'corredor',
				confidence: 0.8,
			}),
		};

		const result = await runNarrativeAnalyzer({
			panels: [panel()],
			visionAdapter: adapter,
			analyzedBy: adapter.name,
			minConfidence: 0.5,
		});
		const dialogue = result.analyses[0]?.dialogues[0];
		assert.equal(dialogue?.kind, 'sfx');
		assert.equal(dialogue?.contentKind, 'sound_effect');
		assert.equal(result.analyses[0]?.motionMetadata?.soundEffects[0], '!!!');
		assert.equal(result.analyses[0]?.motionMetadata?.impacts.length, 1);
	});

	it('preserves explicit dialogue as eligible content', () => {
		const entry = annotateRecapDialogue({
			entry: { text: 'Não pare!', originalText: 'Não pare!', kind: 'dialogue', isNarration: false, readingOrder: 0 },
			panelId: 'p3_0',
			source: 'vision',
			balloon: 'speech',
			balloonPresent: true,
		});
		assert.equal(entry.kind, 'dialogue');
		assert.equal(entry.contentKind, 'dialogue');
		assert.ok(entry.contentEvidence?.some((item) => item.source === 'balloon'));
	});
});
