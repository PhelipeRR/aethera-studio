import { describe, expect, it } from 'bun:test';
import { refineScriptWithPort } from '../../src/recap/script-generator.js';
import { formatVisionProgressMessage } from '../../src/recap/phase5/recap-production-orchestrator.js';
import type { NarrativeSequence, RecapScript, TextEnhancementPort } from '../../src/recap/recap-types.js';

function makeScript(sceneCount: number): RecapScript {
	return {
		chapterId: 'chapter-1',
		title: 'Chapter 1',
		style: 'natural_recap',
		scenes: Array.from({ length: sceneCount }, (_, index) => ({
			sceneId: `scene-${index}`,
			narrationText: `O personagem avança na cena ${index}.`,
			characters: ['o personagem'],
			eventDescription: 'O personagem avança.',
			visualSummary: 'O personagem avança pelo corredor.',
			actions: [{ type: 'movement', description: 'avança pelo corredor' }],
			panelIds: [`panel-${index}`],
			croppedImagePaths: [`/tmp/panel-${index}.png`],
			estimatedDurationSec: 1,
			durationSource: 'estimated',
			emotion: 'neutral',
			narrativeIntent: 'rising_action',
			confidence: 0.9,
			reviewStatus: 'approved',
		})),
		totalEstimatedDurationSec: sceneCount,
		generatedAtIso: new Date().toISOString(),
		generatedBy: 'test',
	};
}

function makeSequence(sceneCount: number): NarrativeSequence {
	return {
		chapterId: 'chapter-1',
		beats: Array.from({ length: sceneCount }, (_, index) => ({
			beatId: `beat-${index}`,
			panelIds: [`panel-${index}`],
			summary: 'O personagem avança pelo corredor.',
			visualSummary: 'O personagem avança pelo corredor.',
			actions: [{ type: 'movement', description: 'avança pelo corredor' }],
			characters: ['o personagem'],
			emotion: 'neutral',
			actionType: 'movement',
			pageNumber: index,
			confidence: 0.9,
		})),
		readingOrder: 'ltr',
		generatedAtIso: new Date().toISOString(),
	};
}

describe('recap resume guards', () => {
	it('refines only Gate G target scenes instead of calling the agent for every scene', async () => {
		const calls: string[] = [];
		const port: TextEnhancementPort = {
			name: 'test-port',
			async enhance(request) {
				calls.push(String(request.context.sceneId));
				return {
					text: JSON.stringify({ narrationText: 'O personagem continua avançando.' }),
					agentId: 'test-agent',
					model: null,
					ok: true,
				};
			},
		};

		const result = await refineScriptWithPort({
			script: makeScript(437),
			sequence: makeSequence(437),
			port,
			sceneIds: new Set(['scene-3', 'scene-219']),
		});

		expect(calls).toEqual(['scene-3', 'scene-219']);
		expect(result.script.scenes[3]?.narrationText).toBe('O personagem continua avançando.');
		expect(result.script.scenes[219]?.narrationText).toBe('O personagem continua avançando.');
		expect(result.script.scenes[220]?.narrationText).toBe('O personagem avança na cena 220.');
	});

	it('does not render an impossible next panel after a complete checkpoint', () => {
		expect(formatVisionProgressMessage(437, 437)).toBe(
			'Análise visual concluída (437/437); continuando para o roteiro…',
		);
		expect(formatVisionProgressMessage(436, 437)).toContain('437/437');
	});
});
