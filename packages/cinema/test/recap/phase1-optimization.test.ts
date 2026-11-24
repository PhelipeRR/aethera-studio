import { strict as assert } from 'node:assert';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, it } from 'node:test';
import {
	RecapBudgetController,
	RecapBudgetExceededError,
	RecapUsageTelemetry,
	computePanelCacheKey,
	runNarrativeAnalyzer,
	createRecapVisionAdapter,
	runRecapProductionOrchestrator,
	type ExtractedPanel,
	type RecapVisualAnalysisPort,
	type StructuredVisionPayload,
} from '../../src/recap/index.js';

const tempDirs: string[] = [];

async function tempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), 'aethera-recap-phase1-'));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	while (tempDirs.length > 0) await rm(tempDirs.pop()!, { recursive: true, force: true });
});

function panel(imageHash = 'image-1'): ExtractedPanel {
	return {
		panelId: 'panel-1',
		pagePath: 'fixture.png',
		metadata: {
			sourceKind: 'panel_crop',
			origin: 'manga_scan',
			chapterId: 'chapter-1',
			pageNumber: 0,
			panelIndex: 0,
			readingOrder: 'ltr',
			boundingBox: { x: 0, y: 0, w: 100, h: 100 },
			classification: 'dialogue',
			ocrStatus: 'not_run',
			ocrConfidence: 0,
		},
		imageHash,
		width: 100,
		height: 100,
	};
}

function visionResult(): Awaited<ReturnType<NonNullable<RecapVisualAnalysisPort['analyze']>>> {
	return {
		nature: 'dialogue',
		natureConfidence: 0.9,
		description: 'Uma personagem fala em uma sala.',
		frames: [{ atMs: 0, observed: 'fala', visibleText: [] }],
		entities: [{ name: 'Personagem A', type: 'character', basis: 'observed', evidence: 'visível', confidence: 0.9 }],
		actions: [{ description: 'fala', basis: 'observed', confidence: 0.9 }],
		environment: { description: 'sala', basis: 'observed', confidence: 0.8 },
		overlays: { burnedText: false, burnedTextRegion: null, watermark: false, webcam: false },
		limitations: [],
		confidence: 0.9,
	};
}

function fakeProvider(options: { id: string; delayMs?: number; fail?: boolean; usage?: StructuredVisionPayload['usage']; onCall?: () => void }): RecapVisualAnalysisPort {
	return {
		id: options.id,
		model: `${options.id}-model`,
		detect: async () => ({ available: true, multimodal: true }),
		analyze: async () => {
			options.onCall?.();
			if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
			if (options.fail) throw new Error(`${options.id} failed`);
			return { ...visionResult(), ...(options.usage ? { usage: options.usage } : {}) };
		},
	};
}

describe('Recap Fase 1 — telemetry, budget and cache', () => {
	it('persiste uso e separa chamadas, tokens, cache, API efetiva e custo estimado', async () => {
		const workspaceDir = await tempDir();
		const first = new RecapUsageTelemetry({ workspaceDir, runId: 'run-1', chapterId: 'chapter-1', jobId: 'job-1' });
		first.record({
			stage: 'vision', operation: 'panel_analysis', unitId: 'panel-1', cacheStatus: 'miss', status: 'completed', attempt: 1,
			provider: 'claude', model: 'sonnet', inputTokens: 100, outputTokens: 20, cachedTokens: 40, cacheWriteTokens: 10,
			effectiveApiCostUsd: null, estimatedCostUsd: 0.03, quotaUnits: 1,
			cliQuotaWindows: [{ id: 'five_hour', utilization: 0.42, resetsAt: null, status: 'ok' }], durationMs: 25,
		});
		first.record({
			stage: 'vision', operation: 'panel_analysis', unitId: 'panel-2', cacheStatus: 'hit', status: 'completed', attempt: 1,
			provider: null, model: null, durationMs: 1,
		});
		const resumed = new RecapUsageTelemetry({ workspaceDir, runId: 'run-1', chapterId: 'chapter-1', jobId: 'job-1' });
		const summary = resumed.summary();
		assert.equal(summary.modelCalls, 1);
		assert.equal(summary.cacheHits, 1);
		assert.equal(summary.cacheMisses, 1);
		assert.equal(summary.inputTokens, 100);
		assert.equal(summary.cachedTokens, 40);
		assert.equal(summary.effectiveApiCostUsd, null);
		assert.equal(summary.estimatedCostUsd, 0.03);
		assert.equal(summary.quotaUnits, 1);
		assert.equal(summary.cliQuotaSnapshots, 1);
		assert.equal(resumed.getEvents()[0]?.jobId, 'job-1');
		assert.equal(resumed.getEvents().length, 2);
	});

	it('bloqueia uma nova chamada antes do provedor quando maxModelCalls foi atingido', async () => {
		const workspaceDir = await tempDir();
		const telemetry = new RecapUsageTelemetry({ workspaceDir, runId: 'run-budget', chapterId: 'chapter-1' });
		const controller = new RecapBudgetController({ maxModelCalls: 1 }, telemetry);
		const release = controller.beforeCall({ stage: 'vision', operation: 'panel_analysis', estimatedInputTokens: 10 });
		release();
		telemetry.record({ stage: 'vision', operation: 'panel_analysis', cacheStatus: 'miss', status: 'completed', attempt: 1, provider: 'mock', model: 'mock' });
		assert.throws(
			() => controller.beforeCall({ stage: 'vision', operation: 'panel_analysis', estimatedInputTokens: 10 }),
			(error: unknown) => error instanceof RecapBudgetExceededError && error.code === 'RECAP_BUDGET_EXCEEDED',
		);
		assert.equal(telemetry.summary().modelCalls, 1);
	});

	it('contabiliza somente segmentos ativos e exclui o intervalo pausado da retomada', async () => {
		const workspaceDir = await tempDir();
		let now = 1_000;
		const first = new RecapUsageTelemetry({ workspaceDir, runId: 'run-active-time', chapterId: 'chapter-1', now: () => now });
		first.beginExecution();
		now = 6_000;
		first.record({ stage: 'vision', operation: 'panel_analysis', cacheStatus: 'miss', status: 'completed', attempt: 1, provider: 'mock', model: 'mock', durationMs: 10 });

		const resumed = new RecapUsageTelemetry({ workspaceDir, runId: 'run-active-time', chapterId: 'chapter-1', now: () => now });
		now = 100_000;
		resumed.beginExecution();
		assert.equal(resumed.activeWallTimeMs(), 5_000);
		now = 102_000;
		const controller = new RecapBudgetController({ maxWallTimeMs: 6_000 }, resumed);
		assert.throws(
			() => controller.beforeCall({ stage: 'vision', operation: 'panel_analysis', estimatedInputTokens: 10 }),
			(error: unknown) => error instanceof RecapBudgetExceededError && error.code === 'RECAP_BUDGET_EXCEEDED',
		);
		resumed.endExecution();
		assert.equal(resumed.activeWallTimeMs(), 7_000);
	});

	it('segmento fechado tardiamente (reparo) cobra só até o último trabalho registrado', async () => {
		const workspaceDir = await tempDir();
		let now = 10_000;
		const telemetry = new RecapUsageTelemetry({ workspaceDir, runId: 'run-late-end', chapterId: 'chapter-1', now: () => now });
		telemetry.beginExecution();
		now = 10_490;
		telemetry.record({ stage: 'vision', operation: 'panel_analysis', cacheStatus: 'hit', status: 'completed', attempt: 1, provider: 'mock', model: 'mock' });
		now = 10_671;
		telemetry.record({ stage: 'vision', operation: 'panel_analysis', cacheStatus: 'miss', status: 'failed', attempt: 1, provider: 'local-vlm', model: 'mock', durationMs: 22 });
		now = 513_033; // end marker written ~8 min later while the job sat paused
		telemetry.endExecution();
		assert.equal(telemetry.activeWallTimeMs(), 671);
		const reread = new RecapUsageTelemetry({ workspaceDir, runId: 'run-late-end', chapterId: 'chapter-1', now: () => 900_000 });
		assert.equal(reread.activeWallTimeMs(), 671, 'idempotente após releitura do ledger');
	});

	it('trabalho medido antes do primeiro marcador continua cobrado', async () => {
		const workspaceDir = await tempDir();
		let now = 1_000;
		const telemetry = new RecapUsageTelemetry({ workspaceDir, runId: 'run-legacy-then-markers', chapterId: 'chapter-1', now: () => now });
		telemetry.record({ stage: 'vision', operation: 'panel_analysis', cacheStatus: 'miss', status: 'completed', attempt: 1, provider: 'mock', model: 'mock', durationMs: 57_000 });
		now = 900_000;
		telemetry.beginExecution();
		now = 900_400;
		telemetry.record({ stage: 'vision', operation: 'panel_analysis', cacheStatus: 'hit', status: 'completed', attempt: 1, provider: 'mock', model: 'mock' });
		telemetry.endExecution();
		assert.equal(telemetry.activeWallTimeMs(), 57_400);
	});

	it('permite a tentativa inicial quando maxRetries=0 e bloqueia somente o retry', async () => {
		const workspaceDir = await tempDir();
		const telemetry = new RecapUsageTelemetry({ workspaceDir, runId: 'run-no-retry', chapterId: 'chapter-1' });
		const controller = new RecapBudgetController({ maxRetries: 0 }, telemetry);
		const release = controller.beforeCall({ stage: 'vision', operation: 'panel_analysis', estimatedInputTokens: 10 });
		release();
		telemetry.record({ stage: 'vision', operation: 'panel_analysis', cacheStatus: 'miss', status: 'failed', attempt: 1, provider: 'mock', model: 'mock' });
		assert.throws(
			() => controller.beforeCall({ stage: 'vision', operation: 'panel_analysis', estimatedInputTokens: 10 }),
			(error: unknown) => error instanceof RecapBudgetExceededError && error.code === 'RECAP_BUDGET_EXCEEDED',
		);
	});

	it('maxRetries=0 por unidade: bloqueia só o retry na mesma execução; retomada explícita nova execução pode tentar', async () => {
		const workspaceDir = await tempDir();
		const telemetry = new RecapUsageTelemetry({ workspaceDir, runId: 'run-unit-retry', chapterId: 'chapter-1' });
		const controller = new RecapBudgetController({ maxRetries: 0 }, telemetry);
		telemetry.beginExecution();
		telemetry.record({ stage: 'vision', operation: 'panel_analysis', unitId: 'panel-37', cacheStatus: 'miss', status: 'completed', attempt: 1, provider: 'mock', model: 'mock' });
		controller.beforeCall({ stage: 'vision', operation: 'panel_analysis', unitId: 'panel-38', estimatedInputTokens: 10 })();
		telemetry.record({ stage: 'vision', operation: 'panel_analysis', unitId: 'panel-38', cacheStatus: 'miss', status: 'failed', attempt: 1, provider: 'mock', model: 'mock' });
		assert.throws(() => controller.beforeCall({ stage: 'vision', operation: 'panel_analysis', unitId: 'panel-38', estimatedInputTokens: 10 }), RecapBudgetExceededError);
		controller.beforeCall({ stage: 'vision', operation: 'panel_analysis', unitId: 'panel-39', estimatedInputTokens: 10 })();
		telemetry.endExecution();
		telemetry.beginExecution();
		controller.beforeCall({ stage: 'vision', operation: 'panel_analysis', unitId: 'panel-38', estimatedInputTokens: 10 })();
	});

	it('pausa o orquestrador com estado retomável quando o orçamento começa esgotado', async () => {
		const workspaceDir = await tempDir();
		let providerCalls = 0;
		const result = await runRecapProductionOrchestrator({
			runId: 'budget-run',
			jobId: 'budget-job',
			chapterId: 'chapter-1',
			workTitle: 'Fixture',
			panels: [panel()],
			workspaceDir,
			providers: [{ id: 'mock', label: 'Mock', detect: async () => ({ available: true }) }],
			visionAdapter: {
				name: 'mock-vision',
				analyze: async () => { providerCalls += 1; return { visualDescription: 'fixture', characters: [], actions: [], emotions: ['neutral'], setting: undefined, confidence: 0.9 }; },
			},
			budget: { maxModelCalls: 0 },
			dryRunRender: true,
		});
		assert.equal(result.record.state, 'paused_budget');
		assert.equal(providerCalls, 0);
		assert.equal(result.record.usage?.modelCalls, 0);
		assert.equal(result.record.usage?.budgetStopReason, 'maxModelCalls=0');
	});

	it('inclui contexto, preprocessing, prompt, modelo e crop na chave e invalida mudanças', () => {
		const base = computePanelCacheKey({
			imageHash: 'image-1', model: 'sonnet', analyzerVersion: 'analyzer-1', cropCoordinates: '0,0,100,100',
			promptVersion: 'prompt-1', preprocessingVersion: 'prep-1', schemaVersion: 'schema-1', locale: 'pt-BR', contextFingerprint: 'ctx-1',
		});
		const changed = computePanelCacheKey({
			imageHash: 'image-1', model: 'sonnet', analyzerVersion: 'analyzer-1', cropCoordinates: '0,0,100,100',
			promptVersion: 'prompt-2', preprocessingVersion: 'prep-1', schemaVersion: 'schema-1', locale: 'pt-BR', contextFingerprint: 'ctx-1',
		});
		assert.notEqual(base, changed);
		assert.equal(base.split('::').length, 9);
	});

	it('reutiliza cache persistente, invalida prompt/contexto e não faz chamada duplicada', async () => {
		const panels = [panel()];
		let calls = 0;
		const adapter = { name: 'mock-vision', analyze: async () => { calls += 1; return { visualDescription: 'fala', characters: ['A'], actions: [{ type: 'dialogue' as const, description: 'fala' }], emotions: ['neutral' as const], setting: 'sala', confidence: 0.9 }; } };
		const cache: Record<string, any> = {};
		const imageHashes: Record<string, string> = {};
		const first = await runNarrativeAnalyzer({
			panels, visionAdapter: adapter, analyzedBy: 'mock-vision', minConfidence: 0.1,
			onPanelAnalyzed: (analysis, currentPanel, cacheKey) => { cache[cacheKey] = analysis; imageHashes[currentPanel.panelId] = currentPanel.imageHash; },
		});
		assert.equal(calls, 1);
		const resumed = await runNarrativeAnalyzer({ panels, visionAdapter: adapter, analyzedBy: 'mock-vision', minConfidence: 0.1, cachedAnalyses: first.analyses, analysisCacheByHash: cache, cachedAnalysisImageHashes: imageHashes });
		assert.equal(calls, 1);
		assert.equal(resumed.cacheHits, 1);
		await runNarrativeAnalyzer({ panels, visionAdapter: adapter, analyzedBy: 'mock-vision', minConfidence: 0.1, cachedAnalyses: first.analyses, analysisCacheByHash: cache, cachedAnalysisImageHashes: imageHashes, promptVersion: 'changed' });
		assert.equal(calls, 2);
	});

	it('deduplica chamadas simultâneas e preserva fallback entre provedores', async () => {
		const root = await tempDir();
		const imagePath = join(root, 'fixture.png');
		await writeFile(imagePath, Buffer.from('synthetic-image-fixture'));
		let calls = 0;
		const adapter = createRecapVisionAdapter({ root, provider: fakeProvider({ id: 'mock', delayMs: 20, onCall: () => { calls += 1; } }) });
		await Promise.all([adapter.analyze(imagePath, { workTitle: 'A' }), adapter.analyze(imagePath, { workTitle: 'A' })]);
		assert.equal(calls, 1);

		const fallback = createRecapVisionAdapter({
			root,
			providers: [fakeProvider({ id: 'first', fail: true }), fakeProvider({ id: 'second' })],
		});
		const result = await fallback.analyze(imagePath, { workTitle: 'A' });
		assert.equal(result.confidence, 0.9);
		assert.deepEqual(fallback.getLastTrace()?.attempts.map((attempt) => attempt.outcome), ['error', 'ok']);
	});
});
