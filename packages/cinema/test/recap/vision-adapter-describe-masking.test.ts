// Fase 4B.11 regression: the describe fallback replaced the analyze evidence in the trace, so a
// local budget pause was recorded as "expected object, received undefined" in the job ledger.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AllVisionProvidersUnavailableError, createRoutedRecapVisionAdapter, ensureVisionHealthProbeImage, type RecapVisionRouterPort } from '../../src/recap/index.js';

describe('Recap vision adapter — describe fallback não mascara a falha do analyze', () => {
	let workDir: string;
	beforeEach(() => { workDir = mkdtempSync(join(tmpdir(), 'describe-masking-')); });
	afterEach(() => { rmSync(workDir, { recursive: true, force: true }); });

	it('pausa de orçamento local não aciona describe e chega intacta ao diagnóstico', async () => {
		let describeCalls = 0;
		const budgetDetail = 'RECAP_PILOT_BUDGET_EXCEEDED: prazo de 1800000 ms excedido.';
		const router: RecapVisionRouterPort = {
			analyze: async () => ({ value: null, provider: null, model: null, costUsd: 0, attempts: [{ provider: 'local-vlm', outcome: 'error', detail: budgetDetail, durationMs: 3 }] }),
			describe: async () => { describeCalls += 1; return { value: null, provider: null, model: null, costUsd: 0, attempts: [{ provider: 'local-vlm', outcome: 'error', detail: 'expected object, received undefined' }] }; },
		};
		const adapter = createRoutedRecapVisionAdapter({ root: workDir, router, policyChain: ['local-vlm'], throwOnAllUnavailable: true });
		const error = await adapter.analyze(ensureVisionHealthProbeImage(workDir), { workTitle: 'Nano Machine', panelIndex: 60, totalPanels: 111 }).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(AllVisionProvidersUnavailableError);
		expect(describeCalls).toBe(0);
		expect(adapter.getLastTrace()?.fallbackReason).toBe(budgetDetail);
	});

	it('quando describe roda, o trace mantém a tentativa do analyze primeiro', async () => {
		const router: RecapVisionRouterPort = {
			analyze: async () => ({ value: null, provider: null, model: null, costUsd: 0, attempts: [{ provider: 'local-vlm', outcome: 'error', detail: 'Ollama /api/chat HTTP 500' }] }),
			describe: async () => ({ value: null, provider: null, model: null, costUsd: 0, attempts: [{ provider: 'local-vlm', outcome: 'unavailable', detail: 'capability describe unavailable' }] }),
		};
		const adapter = createRoutedRecapVisionAdapter({ root: workDir, router, policyChain: ['local-vlm'], throwOnAllUnavailable: true });
		await expect(adapter.analyze(ensureVisionHealthProbeImage(workDir), { workTitle: 'Nano Machine', panelIndex: 60, totalPanels: 111 })).rejects.toBeInstanceOf(AllVisionProvidersUnavailableError);
		const trace = adapter.getLastTrace();
		expect(trace?.attempts.map((attempt) => attempt.detail)).toEqual(['Ollama /api/chat HTTP 500', 'capability describe unavailable']);
		expect(trace?.fallbackReason).toBe('Ollama /api/chat HTTP 500');
	});
});
