import { strict as assert } from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
	estimateContextTokens,
	runNarrativeAnalyzer,
	runNarrativeHumanizer,
	triageRecapPanels,
	buildRecapVisionContextString,
	type ExtractedPanel,
	type RecapScript,
	type TextEnhancementPort,
	type VisionAdapter,
} from '../../src/recap/index.js';

const tempDirs: string[] = [];

afterEach(async () => {
	while (tempDirs.length > 0) await rm(tempDirs.pop()!, { recursive: true, force: true });
});

async function fixtureDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'aethera-recap-phase2-'));
	tempDirs.push(dir);
	return dir;
}

function makePanel(id: string, imagePath: string, imageHash: string, classification: ExtractedPanel['metadata']['classification'] = 'transition', index = 0): ExtractedPanel {
	return {
		panelId: id,
		pagePath: imagePath,
		metadata: {
			sourceKind: 'panel_crop',
			origin: 'webtoon_extract',
			chapterId: 'phase2-fixture',
			pageNumber: index,
			panelIndex: index,
			readingOrder: 'vertical',
			boundingBox: { x: 0, y: index * 100, w: 100, h: 100 },
			classification,
			ocrStatus: 'not_run',
			ocrConfidence: 0,
		},
		imageHash,
		width: 100,
		height: 100,
	};
}

function result(name: string, confidence = 0.9) {
	return {
		visualDescription: `${name} descreve o painel de forma observável.`,
		characters: [name],
		actions: [{ type: 'observation' as const, description: 'Observa a cena' }],
		emotions: ['neutral' as const],
		setting: 'local da fixture',
		confidence,
	};
}

function adapter(name: string, calls: { count: number }, confidence = 0.9, captured?: string[]): VisionAdapter {
	return {
		name,
		async analyze(_image, context) {
			calls.count++;
			if (captured) captured.push(JSON.stringify(context ?? {}));
			return result(`${name}-${context?.panelIndex ?? 0}`, confidence);
		},
	};
}

describe('Recap Fase 2 — triagem, roteamento, contexto compacto e batching', () => {
	it('preserva todos os painéis e marca sinais sem descartar similaridade', () => {
		const panels = [
			makePanel('p1', 'unused', 'same-hash', 'transition', 0),
			makePanel('p2', 'unused', 'dialogue-hash', 'dialogue', 1),
			makePanel('p3', 'unused', 'same-hash', 'transition', 2),
		];
		const triage = triageRecapPanels({ panels });
		assert.deepEqual(triage.decisions.map((decision) => decision.panelId), ['p1', 'p2', 'p3']);
		assert.equal(triage.stats.preserved, 3);
		assert.ok(triage.decisions[1]!.categories.includes('dialogue_important'));
		assert.ok(triage.decisions[2]!.categories.includes('redundant'));
		assert.equal(triage.decisions[2]!.duplicateOf, 'p1');
	});

	it('reduz chamadas simuladas por rota e deduplicação exata, mantendo a sequência', async () => {
		const dir = await fixtureDir();
		const imagePath = join(dir, 'panel.png');
		await writeFile(imagePath, Buffer.from('phase2-fixture-image'));
		const panels = [
			makePanel('p1', imagePath, 'same-hash', 'transition', 0),
			makePanel('p2', imagePath, 'dialogue-hash', 'dialogue', 1),
			makePanel('p3', imagePath, 'same-hash', 'transition', 2),
			makePanel('p4', imagePath, 'change-hash', 'establishing', 3),
		];
		const baselineCalls = { count: 0 };
		const baseline = await runNarrativeAnalyzer({
			panels,
			visionAdapter: adapter('premium-baseline', baselineCalls),
			analyzedBy: 'premium-baseline',
			triage: { enabled: false },
			compactNarrativeContext: false,
		});
		const localCalls = { count: 0 };
		const economicCalls = { count: 0 };
		const premiumCalls = { count: 0 };
		const optimized = await runNarrativeAnalyzer({
			panels,
			visionAdapter: adapter('fallback-premium', premiumCalls),
			visionRoutes: {
				local: adapter('local', localCalls),
				economic: adapter('economic', economicCalls),
				premium: adapter('premium', premiumCalls),
			},
			analyzedBy: 'fallback-premium',
			triage: { fallbackOnLowConfidence: true },
		});
		assert.equal(baselineCalls.count, 4);
		assert.equal(localCalls.count, 0, 'duplicata exata usa análise da mesma execução');
		assert.equal(economicCalls.count, 2);
		assert.equal(premiumCalls.count, 1, 'mudança de cenário escala para premium');
		assert.equal(optimized.analyses.length, panels.length);
		assert.deepEqual(optimized.analyses.map((analysis) => analysis.panelId), panels.map((panel) => panel.panelId));
		console.log(`[phase2-simulated] calls baseline=${baselineCalls.count} optimized=${localCalls.count + economicCalls.count + premiumCalls.count}`);
	});

	it('faz fallback premium somente quando a rota econômica retorna baixa confiança', async () => {
		const dir = await fixtureDir();
		const imagePath = join(dir, 'panel.png');
		await writeFile(imagePath, Buffer.from('phase2-fallback-image'));
		const economicCalls = { count: 0 };
		const premiumCalls = { count: 0 };
		const analysis = await runNarrativeAnalyzer({
			panels: [makePanel('ambiguous', imagePath, 'ambiguous-hash', 'transition')],
			visionRoutes: {
				economic: adapter('economic-low', economicCalls, 0.2),
				premium: adapter('premium-high', premiumCalls, 0.95),
			},
			analyzedBy: 'economic-low',
			triage: { minConfidence: 0.5, fallbackOnLowConfidence: true },
		});
		assert.equal(economicCalls.count, 1);
		assert.equal(premiumCalls.count, 1);
		assert.equal(analysis.analyses[0]!.analysisConfidence, 0.95);
	});

	it('usa batching apenas com contrato explícito e mantém a ordem dos resultados', async () => {
		const dir = await fixtureDir();
		const imagePath = join(dir, 'panel.png');
		await writeFile(imagePath, Buffer.from('phase2-batch-image'));
		const batchCalls = { count: 0 };
		const singleCalls = { count: 0 };
		const batchAdapter: VisionAdapter = {
			name: 'batch-economic',
			maxImagesPerCall: 2,
			async analyze() {
				singleCalls.count++;
				return result('single');
			},
			async analyzeBatch(inputs) {
				batchCalls.count++;
				return inputs.map((_input, index) => result(`batch-${index}`));
			},
		};
		const panels = Array.from({ length: 4 }, (_, index) => makePanel(`b${index}`, imagePath, `batch-${index}`, 'transition', index));
		const analyzed = await runNarrativeAnalyzer({
			panels,
			visionAdapter: batchAdapter,
			analyzedBy: 'batch-economic',
			compactNarrativeContext: false,
			concurrency: 4,
		});
		assert.equal(batchCalls.count, 2);
		assert.equal(singleCalls.count, 0);
		assert.deepEqual(analyzed.analyses.map((analysis) => analysis.panelId), ['b0', 'b1', 'b2', 'b3']);
	});

	it('mantém contexto incremental compacto e mensura apenas economia simulada', async () => {
		const dir = await fixtureDir();
		const imagePath = join(dir, 'panel.png');
		await writeFile(imagePath, Buffer.from('phase2-context-image'));
		const panels = Array.from({ length: 12 }, (_, index) => makePanel(`c${index}`, imagePath, `context-${index}`, 'transition', index));
		const oldContext: string[] = [];
		const newContext: string[] = [];
		await runNarrativeAnalyzer({ panels, visionAdapter: adapter('old', { count: 0 }, 0.9, oldContext), analyzedBy: 'old', compactNarrativeContext: false });
		await runNarrativeAnalyzer({ panels, visionAdapter: adapter('new', { count: 0 }, 0.9, newContext), analyzedBy: 'new', compactNarrativeContext: true });
		const oldTokens = oldContext.reduce((sum, value) => sum + estimateContextTokens(buildRecapVisionContextString(JSON.parse(value))), 0);
		const newTokens = newContext.reduce((sum, value) => sum + estimateContextTokens(buildRecapVisionContextString(JSON.parse(value))), 0);
		assert.ok(newTokens < oldTokens, `esperado contexto compacto menor: ${newTokens} < ${oldTokens}`);
		console.log(`[phase2-simulated] contextTokens baseline=${oldTokens} compact=${newTokens} reduction=${(((oldTokens - newTokens) / oldTokens) * 100).toFixed(1)}%`);
	});

	it('humaniza somente cenas sinalizadas e preserva o modo all para compatibilidade', async () => {
		const script: RecapScript = {
			chapterId: 'chapter-1',
			title: 'Fixture',
			style: 'natural_recap',
			scenes: ['s1', 's2', 's3'].map((sceneId, index) => ({
				sceneId,
				narrationText: `A cena ${index + 1} mostra um evento observado.`,
				characters: ['A'],
				eventDescription: 'evento observado',
				panelIds: [`p${index + 1}`],
				croppedImagePaths: ['fixture.png'],
				estimatedDurationSec: 3,
				emotion: 'neutral',
				narrativeIntent: 'action',
				confidence: 0.9,
				reviewStatus: 'approved',
			})),
			totalEstimatedDurationSec: 9,
			generatedAtIso: new Date().toISOString(),
			generatedBy: 'fixture',
		};
		const calls = { count: 0 };
		const port: TextEnhancementPort = {
			name: 'mock-humanizer',
			enhance: async (request) => {
				calls.count++;
				return { ok: true, text: JSON.stringify({ humanizedText: request.text }), agentId: 'mock-humanizer', model: 'mock' };
			},
		};
		await runNarrativeHumanizer({ script, panels: [], options: { enabled: true, mode: 'flagged', targetSceneIds: ['s2'], style: 'natural_recap', port } });
		assert.equal(calls.count, 1);
		await runNarrativeHumanizer({ script, panels: [], options: { enabled: true, mode: 'all', style: 'natural_recap', port } });
		assert.equal(calls.count, 4);
	});
});
