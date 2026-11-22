import { afterEach, describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	AgentCircuitBreaker,
	createRecapVisionAdapter,
	createTinyProbePngBuffer,
	loadCheckpoint,
	runMultimodalVisionHealthCheck,
	runRecapProductionOrchestrator,
	type ExtractedPanel,
	type RecapVisualAnalysisPort,
	type StructuredVisionPayload,
} from '../../src/recap/index.js';
import {
	DEFAULT_MULTIMODAL_AGENT_PRIORITY,
	VisionPriorityStore,
} from '../../../../apps/aethera-desktop/src/main/vision-priority-store.js';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	tempDirs.push(dir);
	return dir;
}

function makePanels(dir: string, count: number): ExtractedPanel[] {
	const panelsDir = join(dir, 'panels');
	mkdirSync(panelsDir, { recursive: true });
	const png = createTinyProbePngBuffer(32, 32);
	return Array.from({ length: count }, (_, idx) => {
		const imgPath = join(panelsDir, `panel-${idx + 1}.png`);
		writeFileSync(imgPath, png);
		return {
			panelId: `panel-${String(idx + 1).padStart(3, '0')}`,
			pagePath: imgPath,
			croppedImagePath: imgPath,
			width: 32,
			height: 32,
			imageHash: `hash-panel-${idx + 1}`,
			metadata: {
				sourceKind: 'panel_crop',
				origin: 'webtoon_extract',
				chapterId: 'ch-switch',
				pageNumber: idx,
				panelIndex: 0,
				readingOrder: 'vertical',
				boundingBox: { x: 0, y: 0, w: 32, h: 32 },
				classification: 'dialogue',
				ocrStatus: 'not_run',
				ocrConfidence: 0,
			},
		};
	});
}

function makeStructuredPayload(providerLabel: string, panelHint = ''): StructuredVisionPayload {
	return {
		nature: 'action',
		natureConfidence: 0.92,
		description: `Análise visual real por ${providerLabel}${panelHint ? ` (${panelHint})` : ''}`,
		frames: [
			{
				atMs: 0,
				observed: `Cena observada via ${providerLabel}`,
				visibleText: [{ text: 'GOLPE!', region: 'center' }],
			},
		],
		entities: [
			{
				name: 'Heroi',
				type: 'character',
				basis: 'observed',
				evidence: 'Personagem visível no quadro',
				confidence: 0.9,
			},
		],
		actions: [{ description: 'Avança em combate', basis: 'observed', confidence: 0.9 }],
		environment: { description: 'Arena iluminada', basis: 'observed', confidence: 0.85 },
		overlays: { burnedText: false, burnedTextRegion: null, watermark: false, webcam: false },
		limitations: [],
		confidence: 0.9,
		speechBubbles: [
			{
				originalText: 'GOLPE!',
				translatedText: 'GOLPE!',
				speaker: 'Heroi',
				kind: 'dialogue',
				readingOrder: 1,
			},
		],
	};
}

function makePort(
	id: string,
	model: string,
	opts: {
		available?: boolean;
		reason?: string;
		supportsMultimodal?: boolean;
		detectMultimodal?: boolean;
		failError?: string;
		calls?: string[];
		onAnalyze?: (callIndex: number) => StructuredVisionPayload;
	} = {},
): RecapVisualAnalysisPort {
	let callCount = 0;
	return {
		id,
		model,
		...(opts.supportsMultimodal !== undefined ? { supportsMultimodal: opts.supportsMultimodal } : {}),
		detect: async () => {
			if (opts.available === false) {
				return { available: false, reason: opts.reason ?? `${id} indisponível` };
			}
			if (opts.detectMultimodal === false) {
				return { available: true, multimodal: false };
			}
			return { available: true, multimodal: true };
		},
		analyze: async ({ frames }) => {
			callCount += 1;
			opts.calls?.push(id);
			if (opts.failError) {
				throw new Error(opts.failError);
			}
			if (opts.onAnalyze) {
				return opts.onAnalyze(callCount);
			}
			return makeStructuredPayload(id, frames[0]?.path);
		},
	};
}

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir && existsSync(dir)) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

describe('Aethera VisionRouter — Prioridade, Fallback, Capacidade Multimodal & Persistência', () => {
	it('1. Codex disponível -> utiliza Codex como agente principal', async () => {
		const dir = makeTempDir('vp-1-');
		const panels = makePanels(dir, 1);
		const calls: string[] = [];
		const adapter = createRecapVisionAdapter({
			root: dir,
			providers: [
				makePort('codex', 'codex-default', { available: true, calls }),
				makePort('antigravity', 'antigravity-default', { available: true, calls }),
				makePort('claude', 'claude-sonnet', { available: true, calls }),
				makePort('claude-gateway', 'claude-opus-5-5', { available: true, calls }),
			],
			policyChain: [...DEFAULT_MULTIMODAL_AGENT_PRIORITY],
			throwOnAllUnavailable: true,
		});

		const res = await adapter.analyze(panels[0]!.croppedImagePath);
		expect(res.confidence).toBeGreaterThan(0.5);
		expect(adapter.getLastTrace()?.provider).toBe('codex');
		expect(calls).toEqual(['codex']);
	});

	it('2. Codex indisponível -> utiliza Antigravity', async () => {
		const dir = makeTempDir('vp-2-');
		const panels = makePanels(dir, 1);
		const calls: string[] = [];
		const adapter = createRecapVisionAdapter({
			root: dir,
			providers: [
				makePort('codex', 'codex-default', { available: false, reason: 'Codex CLI não autenticado', calls }),
				makePort('antigravity', 'antigravity-default', { available: true, calls }),
				makePort('claude', 'claude-sonnet', { available: true, calls }),
				makePort('claude-gateway', 'claude-opus-5-5', { available: true, calls }),
			],
			policyChain: [...DEFAULT_MULTIMODAL_AGENT_PRIORITY],
			throwOnAllUnavailable: true,
		});

		const res = await adapter.analyze(panels[0]!.croppedImagePath);
		expect(res.confidence).toBeGreaterThan(0.5);
		expect(adapter.getLastTrace()?.provider).toBe('antigravity');
		expect(calls).toEqual(['antigravity']);
	});

	it('3. Codex e Antigravity indisponíveis -> utiliza Claude Code', async () => {
		const dir = makeTempDir('vp-3-');
		const panels = makePanels(dir, 1);
		const calls: string[] = [];
		const adapter = createRecapVisionAdapter({
			root: dir,
			providers: [
				makePort('codex', 'codex-default', { available: false, reason: 'Codex CLI offline', calls }),
				makePort('antigravity', 'antigravity-default', { failError: 'QUOTA_EXCEEDED: try again in 30m', calls }),
				makePort('claude', 'claude-sonnet', { available: true, calls }),
				makePort('claude-gateway', 'claude-opus-5-5', { available: true, calls }),
			],
			policyChain: [...DEFAULT_MULTIMODAL_AGENT_PRIORITY],
			throwOnAllUnavailable: true,
		});

		const res = await adapter.analyze(panels[0]!.croppedImagePath);
		expect(res.confidence).toBeGreaterThan(0.5);
		expect(adapter.getLastTrace()?.provider).toBe('claude');
		expect(calls).toEqual(['antigravity', 'claude']);
	});

	it('4. Três primeiros agentes indisponíveis -> utiliza Claude Gateway (claude-opus-5-5) como último fallback', async () => {
		const dir = makeTempDir('vp-4-');
		const panels = makePanels(dir, 1);
		const calls: string[] = [];
		const adapter = createRecapVisionAdapter({
			root: dir,
			providers: [
				makePort('codex', 'codex-default', { available: false, reason: 'Codex sem auth', calls }),
				makePort('antigravity', 'antigravity-default', { available: false, reason: 'Antigravity indisponível', calls }),
				makePort('claude', 'claude-sonnet', { failError: 'You have hit your weekly limit · resets Nov 28 at 10am', calls }),
				makePort('claude-gateway', 'claude-opus-5-5', { available: true, calls }),
			],
			policyChain: [...DEFAULT_MULTIMODAL_AGENT_PRIORITY],
			throwOnAllUnavailable: true,
		});

		const res = await adapter.analyze(panels[0]!.croppedImagePath);
		expect(res.confidence).toBeGreaterThan(0.5);
		expect(adapter.getLastTrace()?.provider).toBe('claude-gateway');
		expect(adapter.getLastTrace()?.model).toBe('claude-opus-5-5');
		expect(calls).toEqual(['claude', 'claude-gateway']);
	});

	it('5. Todos os agentes indisponíveis -> pausa produção com diagnóstico claro sem marcar painéis como concluídos', async () => {
		const dir = makeTempDir('vp-5-');
		const panels = makePanels(dir, 2);
		const circuitBreaker = new AgentCircuitBreaker();
		const adapter = createRecapVisionAdapter({
			root: dir,
			providers: [
				makePort('codex', 'codex-default', { available: false, reason: 'Codex sem quota' }),
				makePort('antigravity', 'antigravity-default', { available: false, reason: 'agy não autenticado' }),
				makePort('claude', 'claude-sonnet', { available: false, reason: 'Claude token expirado' }),
				makePort('claude-gateway', 'claude-opus-5-5', { available: false, reason: 'gateway desativado' }),
			],
			policyChain: [...DEFAULT_MULTIMODAL_AGENT_PRIORITY],
			circuitBreaker,
			throwOnAllUnavailable: true,
		});

		const result = await runRecapProductionOrchestrator({
			runId: 'run-all-fail',
			chapterId: 'ch-all-fail',
			workTitle: 'Obra Teste',
			panels,
			workspaceDir: dir,
			providers: [
				{ id: 'codex', label: 'Codex CLI', detect: async () => ({ available: false, code: 'QUOTA_EXCEEDED', resetAtText: '45m', reason: 'Quota esgotada' }) },
				{ id: 'antigravity', label: 'Antigravity CLI', detect: async () => ({ available: false, code: 'AUTHENTICATION_FAILED', reason: 'agy não autenticado' }) },
				{ id: 'claude', label: 'Claude Code', detect: async () => ({ available: false, code: 'AUTHENTICATION_FAILED', reason: 'token expirado' }) },
				{ id: 'claude-gateway', label: 'Claude Gateway', detect: async () => ({ available: false, code: 'PROVIDER_UNAVAILABLE', reason: 'gateway desativado' }) },
			],
			circuitBreaker,
			visionAdapter: adapter,
			dryRunRender: true,
		});

		expect(result.record.state).toBe('paused_provider_unavailable');
		expect(result.record.visionTelemetry?.completedPanels).toBe(0);
		expect(result.record.visionTelemetry?.priorityOrder).toEqual([...DEFAULT_MULTIMODAL_AGENT_PRIORITY]);
		expect(result.record.visionTelemetry?.failedProviders.length).toBe(4);
		expect(loadCheckpoint(join(dir, 'checkpoints', 'ch-all-fail'))?.panelAnalyses.length ?? 0).toBe(0);
	});

	it('6. Troca de agente no meio da execução preserva painéis já analisados no checkpoint sem reprocessar', async () => {
		const dir = makeTempDir('vp-6-');
		const panels = makePanels(dir, 3);
		const circuitBreaker = new AgentCircuitBreaker();
		const callsByProvider: string[] = [];
		let codexCalls = 0;

		const adapter = createRecapVisionAdapter({
			root: dir,
			providers: [
				makePort('codex', 'codex-default', {
					available: true,
					calls: callsByProvider,
					onAnalyze: () => {
						codexCalls += 1;
						if (codexCalls === 1) return makeStructuredPayload('codex', 'panel-1');
						throw new Error('QUOTA_EXCEEDED: weekly limit · try again in 30m');
					},
				}),
				makePort('antigravity', 'antigravity-default', {
					available: true,
					calls: callsByProvider,
					onAnalyze: () => makeStructuredPayload('antigravity'),
				}),
				makePort('claude', 'claude-sonnet', { available: true, calls: callsByProvider }),
				makePort('claude-gateway', 'claude-opus-5-5', { available: true, calls: callsByProvider }),
			],
			policyChain: [...DEFAULT_MULTIMODAL_AGENT_PRIORITY],
			circuitBreaker,
			throwOnAllUnavailable: true,
		});

		const result = await runRecapProductionOrchestrator({
			runId: 'run-switch',
			chapterId: 'ch-switch',
			workTitle: 'Obra Troca',
			panels,
			workspaceDir: dir,
			providers: [
				{ id: 'codex', label: 'Codex CLI', detect: async () => ({ available: true }) },
				{ id: 'antigravity', label: 'Antigravity CLI', detect: async () => ({ available: true }) },
				{ id: 'claude', label: 'Claude Code', detect: async () => ({ available: true }) },
				{ id: 'claude-gateway', label: 'Claude Gateway', detect: async () => ({ available: true }) },
			],
			circuitBreaker,
			visionAdapter: adapter,
			dryRunRender: true,
		});

		expect(callsByProvider).toEqual(['codex', 'codex', 'antigravity', 'antigravity']);
		const ckpt = loadCheckpoint(join(dir, 'checkpoints', 'ch-switch'));
		expect(ckpt?.panelAnalyses.length).toBe(3);
		expect(result.record.visionTelemetry?.completedPanels).toBe(3);
		expect(result.record.visionTelemetry?.activeProvider).toBe('antigravity');
		expect(result.record.visionTelemetry?.nextFallback).toBe('claude');
		expect(result.record.visionTelemetry?.failedProviders.some((f) => f.providerId === 'codex' && f.code === 'QUOTA_EXCEEDED' && Boolean(f.resetAtText))).toBe(true);
	});

	it('7. Agente sem visão real (apenas texto) é ignorado e nunca recebe imagem', async () => {
		const dir = makeTempDir('vp-7-');
		const panels = makePanels(dir, 1);
		const calls: string[] = [];

		const adapter = createRecapVisionAdapter({
			root: dir,
			providers: [
				makePort('codex', 'text-only-codex', { available: true, supportsMultimodal: false, calls }),
				makePort('antigravity', 'text-only-agy', { available: true, detectMultimodal: false, calls }),
				makePort('claude', 'claude-sonnet', { available: true, calls }),
				makePort('claude-gateway', 'claude-opus-5-5', { available: true, calls }),
			],
			policyChain: [...DEFAULT_MULTIMODAL_AGENT_PRIORITY],
			throwOnAllUnavailable: true,
		});

		const res = await adapter.analyze(panels[0]!.croppedImagePath);
		expect(res.confidence).toBeGreaterThan(0.5);
		expect(adapter.getLastTrace()?.provider).toBe('claude');
		expect(calls).toEqual(['claude']);
	});

	it('8. Prioridade permanece persistida após reiniciar o aplicativo (VisionPriorityStore)', () => {
		const dir = makeTempDir('vp-8-');
		const storeFile = join(dir, 'aethera-vision-priority.json');

		const session1 = new VisionPriorityStore(storeFile);
		expect(session1.getPriority()).toEqual(['codex', 'antigravity', 'claude', 'claude-gateway']);

		const saved = session1.save(['claude', 'codex', 'antigravity', 'claude-gateway']);
		expect(saved.priority).toEqual(['claude', 'codex', 'antigravity', 'claude-gateway']);

		// Simulate app restart with a brand new store instance
		const session2 = new VisionPriorityStore(storeFile);
		expect(session2.getPriority()).toEqual(['claude', 'codex', 'antigravity', 'claude-gateway']);

		const reset = session2.reset();
		expect(reset.priority).toEqual(['codex', 'antigravity', 'claude', 'claude-gateway']);
	});

	it('Respeita tempo de reset de QUOTA_EXCEEDED no AgentCircuitBreaker', () => {
		const cb = new AgentCircuitBreaker();
		const now = 1_700_000_000_000;
		const futureResetMs = now + 30 * 60_000;
		cb.open('codex', 'QUOTA_EXCEEDED', 'Quota esgotada', '30m', futureResetMs);

		expect(cb.isAvailable('codex', now + 5 * 60_000)).toBe(false);
		expect(cb.isAvailable('codex', futureResetMs + 1)).toBe(true);
	});

	it('Valida capacidade multimodal real com imagem PNG real via runMultimodalVisionHealthCheck', async () => {
		const dir = makeTempDir('vp-real-probe-');
		const cb = new AgentCircuitBreaker();
		const receivedBytes: number[] = [];

		const port: RecapVisualAnalysisPort = {
			id: 'codex',
			model: 'codex-vision',
			supportsMultimodal: true,
			detect: async () => ({ available: true, multimodal: true }),
			analyze: async ({ frames }) => {
				const buf = readFileSync(frames[0]!.path);
				receivedBytes.push(buf.length);
				expect(buf.subarray(0, 4).toString('hex')).toBe('89504e47');
				return makeStructuredPayload('codex', 'probe');
			},
		};

		const health = await runMultimodalVisionHealthCheck({
			rootDir: dir,
			circuitBreaker: cb,
			force: true,
			candidates: [
				{
					id: 'codex',
					label: 'Codex CLI',
					getCliStatus: async () => ({
						installed: true,
						version: '1.0.0',
						authenticated: true,
						authMethod: 'oauth',
						problems: [],
					}),
					port,
				},
			],
		});

		expect(health).toHaveLength(1);
		expect(health[0]!.multimodalStatus).toBe('multimodal_available');
		expect(health[0]!.testedWithRealImage).toBe(true);
		expect(receivedBytes[0]!).toBeGreaterThan(50);
	});
});
