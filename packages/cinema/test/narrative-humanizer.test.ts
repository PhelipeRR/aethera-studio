import { describe, expect, it, vi } from 'vitest';
import type {
	RecapScript,
	Scene,
	ExtractedPanel,
	TextEnhancementPort,
	TextEnhancementRequest,
	TextEnhancementResult,
	HumanizeOptions,
} from '../src/recap/recap-types.js';
import { runNarrativeHumanizer } from '../src/recap/narrative-humanizer.js';

// ─── Test Fixtures ───────────────────────────────────────────────────────────

function makeScene(overrides: Partial<Scene> = {}): Scene {
	return {
		sceneId: 'scene-001',
		narrationText: 'O herói caminhou pela floresta escura. Ele estava determinado a encontrar o vilão.',
		characters: ['Herói'],
		eventDescription: 'Herói entra na floresta em busca do vilão.',
		panelIds: ['panel-001', 'panel-002'],
		croppedImagePaths: ['/tmp/panel-001.png', '/tmp/panel-002.png'],
		estimatedDurationSec: 5,
		emotion: 'determination',
		narrativeIntent: 'rising_action',
		confidence: 0.85,
		reviewStatus: 'approved',
		...overrides,
	};
}

function makeScript(scenes: Scene[] = [makeScene()]): RecapScript {
	return {
		chapterId: 'chapter-test',
		title: 'Test Chapter',
		style: 'narrative_recap',
		scenes,
		totalEstimatedDurationSec: scenes.reduce((sum, s) => sum + s.estimatedDurationSec, 0),
		generatedAtIso: new Date().toISOString(),
		generatedBy: 'test-story-engine',
	};
}

function makePanels(): ExtractedPanel[] {
	return [
		{
			panelId: 'panel-001',
			pagePath: '/tmp/page-001.png',
			croppedImagePath: '/tmp/panel-001.png',
			metadata: {
				sourceKind: 'panel_crop',
				origin: 'webtoon_extract',
				chapterId: 'chapter-test',
				pageNumber: 1,
				panelIndex: 0,
				readingOrder: 'vertical',
				boundingBox: { x: 0, y: 0, w: 400, h: 600 },
				classification: 'action',
				ocrStatus: 'not_run',
				ocrConfidence: 0,
			},
			imageHash: 'abc123',
			width: 400,
			height: 600,
		},
		{
			panelId: 'panel-002',
			pagePath: '/tmp/page-001.png',
			croppedImagePath: '/tmp/panel-002.png',
			metadata: {
				sourceKind: 'panel_crop',
				origin: 'webtoon_extract',
				chapterId: 'chapter-test',
				pageNumber: 1,
				panelIndex: 1,
				readingOrder: 'vertical',
				boundingBox: { x: 0, y: 600, w: 400, h: 600 },
				classification: 'dialogue',
				ocrStatus: 'not_run',
				ocrConfidence: 0,
			},
			imageHash: 'def456',
			width: 400,
			height: 600,
		},
	];
}

function createMockPort(responses: Record<string, TextEnhancementResult> = {}): TextEnhancementPort & { calls: TextEnhancementRequest[] } {
	const calls: TextEnhancementRequest[] = [];
	return {
		name: 'mock-enhancement-port',
		calls,
		async enhance(input: TextEnhancementRequest): Promise<TextEnhancementResult> {
			calls.push(input);
			const key = input.context.sceneId as string;
			if (responses[key]) return responses[key]!;
			// Default: return improved text with similar duration
			return {
				text: JSON.stringify({ humanizedText: `Com determinação, o herói adentrou a floresta sombria, decidido a confrontar o vilão.` }),
				agentId: 'mock-agent',
				model: 'mock-model-v1',
				ok: true,
			};
		},
	};
}

function makeOptions(port: TextEnhancementPort, overrides: Partial<HumanizeOptions> = {}): HumanizeOptions & { port: TextEnhancementPort } {
	return {
		enabled: true,
		style: 'narrative_recap',
		maxDurationDeviation: 0.10,
		port,
		...overrides,
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Narrative Humanizer — Phase 2.2.1-C', () => {
	it('returns original script unchanged when disabled', async () => {
		const script = makeScript();
		const panels = makePanels();
		const port = createMockPort();
		const options = makeOptions(port, { enabled: false });

		const result = await runNarrativeHumanizer({ script, panels, options });

		expect(result.skipped).toBe(true);
		expect(result.script).toEqual(script);
		expect(result.diffs).toHaveLength(0);
		expect(result.agentId).toBe('none');
		expect(port.calls).toHaveLength(0);
		expect(result.postHumanizeGateG.verdict).toBeDefined();
	});

	it('humanizes narration while preserving characters and panel references', async () => {
		const script = makeScript();
		const panels = makePanels();
		const port = createMockPort();
		const options = makeOptions(port);

		const result = await runNarrativeHumanizer({ script, panels, options });

		expect(result.skipped).toBe(false);
		expect(result.diffs).toHaveLength(1);
		expect(result.diffs[0]!.reverted).toBe(false);
		expect(result.diffs[0]!.originalText).toBe(script.scenes[0]!.narrationText);
		expect(result.diffs[0]!.humanizedText).toContain('determinação');

		// Structural preservation
		const humanizedScene = result.script.scenes[0]!;
		expect(humanizedScene.panelIds).toEqual(['panel-001', 'panel-002']);
		expect(humanizedScene.croppedImagePaths).toEqual(['/tmp/panel-001.png', '/tmp/panel-002.png']);
		expect(humanizedScene.characters).toEqual(['Herói']);
		expect(humanizedScene.sceneId).toBe('scene-001');
		expect(humanizedScene.emotion).toBe('determination');
		expect(humanizedScene.narrativeIntent).toBe('rising_action');

		// Telemetry
		expect(result.agentId).toBe('mock-agent');
		expect(result.model).toBe('mock-model-v1');
	});

	it('reverts scene when enhancement fails', async () => {
		const script = makeScript();
		const panels = makePanels();
		const port = createMockPort({
			'scene-001': { text: '', agentId: 'mock-agent', model: null, ok: false, error: 'timeout' },
		});
		const options = makeOptions(port);

		const result = await runNarrativeHumanizer({ script, panels, options });

		expect(result.diffs).toHaveLength(1);
		expect(result.diffs[0]!.reverted).toBe(true);
		expect(result.diffs[0]!.revertReason).toBe('timeout');
		expect(result.diffs[0]!.humanizedText).toBe(script.scenes[0]!.narrationText);
		expect(result.warnings.some((w) => w.includes('enhancement failed'))).toBe(true);
	});

	it('reverts scene when duration budget is exceeded', async () => {
		const script = makeScript([makeScene({ estimatedDurationSec: 3 })]);
		const panels = makePanels();
		const port = createMockPort({
			'scene-001': {
				// Very long text that exceeds ±10% of 3s (~12 words at 2.5 wps)
				text: JSON.stringify({
					humanizedText: 'Com uma determinação inabalável que queimava em seu coração como uma chama eterna, o herói adentrou a floresta sombria e misteriosa, absolutamente decidido a confrontar o vilão que há tanto tempo aterrorizava o reino inteiro com suas maldades.',
				}),
				agentId: 'mock-agent',
				model: 'mock-model-v1',
				ok: true,
			},
		});
		const options = makeOptions(port, { maxDurationDeviation: 0.10 });

		const result = await runNarrativeHumanizer({ script, panels, options });

		expect(result.diffs).toHaveLength(1);
		expect(result.diffs[0]!.reverted).toBe(true);
		expect(result.diffs[0]!.revertReason).toBe('duration_budget_exceeded');
		expect(result.warnings.some((w) => w.includes('duration budget'))).toBe(true);
	});

	it('reverts all scenes when Gate G fails after humanization', async () => {
		// Create a script where Gate G will fail because the scene references
		// a panel that does NOT exist in the extracted panels list → missing_panel_reference → fail
		const script = makeScript([
			makeScene({
				narrationText: 'O herói caminhou pela estrada.',
				estimatedDurationSec: 5,
				panelIds: ['NONEXISTENT_PANEL_ID'], // Not in makePanels() → Gate G fail
				croppedImagePaths: ['/any/path.png'],
			}),
		]);
		const panels = makePanels(); // Contains panel-001 and panel-002, NOT NONEXISTENT_PANEL_ID
		const port = createMockPort({
			'scene-001': {
				// ~12 words = 4.8s at 2.5 wps, within ±10% of 5s (4.5–5.5s)
				text: JSON.stringify({ humanizedText: 'Com passos decididos, o herói avançou pela estrada empoeirada sob o sol.' }),
				agentId: 'mock-agent',
				model: 'mock-model-v1',
				ok: true,
			},
		});
		const options = makeOptions(port);

		const result = await runNarrativeHumanizer({ script, panels, options });

		// Gate G should fail due to missing panel reference
		// The humanizer should revert all changes
		expect(result.diffs).toHaveLength(1);
		expect(result.diffs[0]!.reverted).toBe(true);
		expect(result.diffs[0]!.revertReason).toBe('gate_g_fail_post_humanize');
		// Script should be the original
		expect(result.script.scenes[0]!.narrationText).toBe('O herói caminhou pela estrada.');
	});

	it('marks scenes as needs_review when Gate G returns needs_review', async () => {
		const script = makeScript([
			makeScene({ confidence: 0.2 }), // Low confidence → needs_review
		]);
		const panels = makePanels();
		const port = createMockPort();
		const options = makeOptions(port);

		const result = await runNarrativeHumanizer({ script, panels, options });

		// Gate G should flag low confidence scene
		expect(result.postHumanizeGateG.verdict).toBe('needs_review');
	});

	it('handles multiple scenes independently', async () => {
		const scenes = [
			makeScene({ sceneId: 'scene-A', narrationText: 'Cena A original.' }),
			makeScene({ sceneId: 'scene-B', narrationText: 'Cena B original.' }),
			makeScene({ sceneId: 'scene-C', narrationText: 'Cena C original.' }),
		];
		const script = makeScript(scenes);
		const panels = makePanels();
		const port = createMockPort({
			'scene-B': { text: '', agentId: 'mock-agent', model: null, ok: false, error: 'parse_error' },
		});
		const options = makeOptions(port);

		const result = await runNarrativeHumanizer({ script, panels, options });

		expect(result.diffs).toHaveLength(3);
		// Scene A and C should succeed
		expect(result.diffs.find((d) => d.sceneId === 'scene-A')!.reverted).toBe(false);
		expect(result.diffs.find((d) => d.sceneId === 'scene-C')!.reverted).toBe(false);
		// Scene B should be reverted
		expect(result.diffs.find((d) => d.sceneId === 'scene-B')!.reverted).toBe(true);
		expect(result.diffs.find((d) => d.sceneId === 'scene-B')!.revertReason).toBe('parse_error');
	});

	it('works with a single agent available (no fallback needed)', async () => {
		const script = makeScript();
		const panels = makePanels();
		// Single agent port — no fallback chain; returns text with similar duration (~13 words for 5s at 2.5 wps)
		const port: TextEnhancementPort = {
			name: 'single-agent-port',
			async enhance() {
				return {
					text: JSON.stringify({ humanizedText: 'Com determinação, o herói adentrou a floresta sombria, decidido a confrontar o vilão.' }),
					agentId: 'only-agent',
					model: 'only-model',
					ok: true,
				};
			},
		};
		const options = makeOptions(port);

		const result = await runNarrativeHumanizer({ script, panels, options });

		expect(result.skipped).toBe(false);
		expect(result.agentId).toBe('only-agent');
		expect(result.model).toBe('only-model');
		expect(result.diffs[0]!.reverted).toBe(false);
	});

	it('handles complete unavailability gracefully', async () => {
		const script = makeScript();
		const panels = makePanels();
		const port: TextEnhancementPort = {
			name: 'unavailable-port',
			async enhance() {
				return { text: '', agentId: 'none', model: null, ok: false, error: 'no_agent_available' };
			},
		};
		const options = makeOptions(port);

		const result = await runNarrativeHumanizer({ script, panels, options });

		expect(result.diffs).toHaveLength(1);
		expect(result.diffs[0]!.reverted).toBe(true);
		expect(result.diffs[0]!.revertReason).toBe('no_agent_available');
		expect(result.warnings.some((w) => w.includes('enhancement failed'))).toBe(true);
		// Original script preserved
		expect(result.script.scenes[0]!.narrationText).toBe(script.scenes[0]!.narrationText);
	});

	it('preserves panelReferences exactly — never modifies IDs or paths', async () => {
		const originalScene = makeScene({
			panelIds: ['p-1', 'p-2', 'p-3'],
			croppedImagePaths: ['/a.png', '/b.png', '/c.png'],
		});
		const script = makeScript([originalScene]);
		const panels = makePanels();
		const port = createMockPort();
		const options = makeOptions(port);

		const result = await runNarrativeHumanizer({ script, panels, options });

		const humanized = result.script.scenes[0]!;
		expect(humanized.panelIds).toEqual(['p-1', 'p-2', 'p-3']);
		expect(humanized.croppedImagePaths).toEqual(['/a.png', '/b.png', '/c.png']);
		expect(humanized.sceneId).toBe(originalScene.sceneId);
	});

	it('does not invent events or dialogues', async () => {
		const script = makeScript([makeScene({
			narrationText: 'O herói caminhou pela floresta.',
			characters: ['Herói'],
		})]);
		const panels = makePanels();
		// Port that tries to inject dialogue
		const port = createMockPort({
			'scene-001': {
				text: JSON.stringify({ humanizedText: 'O herói caminhou pela floresta e disse: "Eu vou vencer!"' }),
				agentId: 'mock-agent',
				model: 'mock-model-v1',
				ok: true,
			},
		});
		const options = makeOptions(port);

		const result = await runNarrativeHumanizer({ script, panels, options });

		// The structural check should catch introduced dialogue quotes
		expect(result.diffs[0]!.reverted).toBe(true);
		expect(result.diffs[0]!.revertReason).toContain('dialogue quotes');
	});

	it('respects abort signal', async () => {
		const scenes = [
			makeScene({ sceneId: 's1' }),
			makeScene({ sceneId: 's2' }),
			makeScene({ sceneId: 's3' }),
		];
		const script = makeScript(scenes);
		const panels = makePanels();
		const controller = new AbortController();
		const port = createMockPort();
		const options = makeOptions(port, { signal: controller.signal });

		// Abort after first call
		const originalEnhance = port.enhance.bind(port);
		let callCount = 0;
		port.enhance = async (input) => {
			callCount++;
			if (callCount >= 2) controller.abort();
			return originalEnhance(input);
		};

		const result = await runNarrativeHumanizer({ script, panels, options });

		expect(result.warnings.some((w) => w.includes('aborted'))).toBe(true);
	});
});