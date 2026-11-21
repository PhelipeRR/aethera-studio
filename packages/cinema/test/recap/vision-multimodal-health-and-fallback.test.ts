import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	AgentCircuitBreaker,
	AllVisionProvidersUnavailableError,
	classifyVisionError,
	createClaudeVisionProvider,
	createRecapVisionAdapter,
	createRoutedRecapVisionAdapter,
	createTinyProbePngBuffer,
	detectImageMimeType,
	ensureVisionHealthProbeImage,
	inspectPassiveMultimodalHealth,
	loadCheckpoint,
	runMultimodalVisionHealthCheck,
	runRecapProductionOrchestrator,
	type ExtractedPanel,
	type RecapVisionRouterPort,
	type RecapVisualAnalysisPort,
} from '../../src/recap/index.js';
import type { ClaudeVisionProviderOptions } from '../../src/recap/claude-vision-provider.js';

type MockAgentAdapter = ClaudeVisionProviderOptions['adapter'];

function makeExtractedPanel(rootDir: string, index: number): ExtractedPanel {
	const panelId = `panel-${String(index).padStart(3, '0')}`;
	const imgPath = join(rootDir, `${panelId}.png`);
	const pngBuf = createTinyProbePngBuffer(32, 32);
	writeFileSync(imgPath, pngBuf);
	return {
		panelId,
		pagePath: imgPath,
		croppedImagePath: imgPath,
		width: 32,
		height: 32,
		imageHash: `hash-panel-${index}`,
		metadata: {
			sourceKind: 'panel_crop',
			origin: 'webtoon_extract',
			chapterId: 'nano-machine-test',
			pageNumber: index,
			panelIndex: 0,
			readingOrder: 'vertical',
			boundingBox: { x: 0, y: 0, w: 32, h: 32 },
			classification: 'dialogue',
			ocrStatus: 'not_run',
			ocrConfidence: 0,
		},
	};
}

describe('Fase 1–6: VisionRouter, Multimodal Health Check, Adapters & Checkpoint Resume', () => {
	let workDir: string;

	beforeEach(() => {
		workDir = join(tmpdir(), `aethera-vision-fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
		mkdirSync(workDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(workDir)) {
			rmSync(workDir, { recursive: true, force: true });
		}
	});

	it('1. Claude Code com imagem real (via createClaudeVisionProvider + VisionRouter scope=recap preserva speechBubbles e characterDetails)', async () => {
		const probePath = ensureVisionHealthProbeImage(workDir);
		expect(detectImageMimeType(probePath)).toBe('image/png');

		const mockClaudeAdapter: MockAgentAdapter = {
			id: 'claude',
			detect: async () => ({
				id: 'claude',
				label: 'Claude Code',
				installed: true,
				path: 'claude.exe',
				version: '2.1.330',
				testedVersion: '2.1.312',
				authenticated: true,
				authMethod: 'claude.ai',
				features: ['stream-json', 'permission-mode', 'allowed-tools'],
				warnings: [],
				problems: [],
				checkedAt: new Date().toISOString(),
			}),
			run: async function* (req) {
				expect(req.images?.[0]?.path).toBe(probePath);
				expect(req.images?.[0]?.mime).toBe('image/png');
				yield {
					kind: 'result' as const,
					ok: true,
					text: JSON.stringify({
						nature: 'combat',
						description: 'Cheon Yeo-Woon ativa a Nano Machine em posição de guarda com lâmina de qi.',
						characters: ['Cheon Yeo-Woon'],
						characterDetails: [
							{
								id: 'Cheon Yeo-Woon',
								appearance: 'túnica escura da academia demoníaca',
								expression: 'determinado',
								poseOrAction: 'empunhando espada com energia azul',
							},
						],
						actions: ['Ativa interface da Nano Machine'],
						emotions: ['determination'],
						expressions: ['olhar focado'],
						relevantObjects: ['espada de qi'],
						setting: 'Arena da Academia Demoníaca',
						speechBubbles: [
							{
								originalText: '[Nano: Modo de combate ativado.]',
								translatedText: '[Nano: Modo de combate ativado.]',
								speaker: 'Nano',
								kind: 'narration',
								readingOrder: 0,
							},
						],
						confidence: 0.94,
					}),
				};
				yield {
					kind: 'done' as const,
					ok: true,
					exitCode: 0,
					timedOut: false,
					cancelled: false,
					sessionId: 'sess-1',
					result: null,
					errorOutput: null,
				};
			},
		};

		const claudeLean = createClaudeVisionProvider({
			adapter: mockClaudeAdapter,
			providerId: 'claude',
			cwd: workDir,
		});

		const routerPort: RecapVisionRouterPort = {
			describe: async () => ({ value: null, provider: null, model: null, costUsd: 0, attempts: [] }),
			analyze: async ({ frames, context }) => {
				const value = await claudeLean.analyze!({ frames, ...(context ? { context } : {}) });
				return {
					value,
					provider: 'claude',
					model: claudeLean.model,
					costUsd: 0,
					attempts: [{ provider: 'claude', outcome: 'ok', durationMs: 12 }],
				};
			},
		};

		const adapter = createRoutedRecapVisionAdapter({
			root: workDir,
			router: routerPort,
			policyChain: ['claude'],
			throwOnAllUnavailable: true,
		});

		const res = await adapter.analyze(probePath, { workTitle: 'Nano Machine', panelIndex: 0, totalPanels: 1 });
		expect(res.confidence).toBeCloseTo(0.94);
		expect(res.visualDescription).toContain('Cheon Yeo-Woon');
		expect(res.characters).toContain('Cheon Yeo-Woon');
		expect(res.speechBubbles).toHaveLength(1);
		expect(res.speechBubbles?.[0]?.text).toContain('Modo de combate ativado');
		expect(res.characterDetails?.[0]?.id).toBe('Cheon Yeo-Woon');
		expect(adapter.getLastTrace()?.provider).toBe('claude');
	});

	it('2. Claude Gateway com imagem real (perfil isolado CLAUDE_CONFIG_DIR + claude-opus-5-5)', async () => {
		const probePath = ensureVisionHealthProbeImage(workDir);
		let capturedModel: string | undefined;

		const mockGatewayAdapter: MockAgentAdapter = {
			id: 'claude-gateway',
			detect: async () => ({
				id: 'claude',
				label: 'Claude Gateway',
				installed: true,
				path: 'claude.exe',
				version: '2.1.330',
				testedVersion: 'gateway',
				authenticated: true,
				authMethod: 'gateway-token',
				features: ['stream-json', 'vision'],
				warnings: [],
				problems: [],
				checkedAt: new Date().toISOString(),
			}),
			run: async function* (req) {
				capturedModel = req.model;
				yield {
					kind: 'result' as const,
					ok: true,
					text: JSON.stringify({
						nature: 'observation',
						description: 'Painel analisado via Claude Gateway com foco no protagonista.',
						characters: ['Cheon Yeo-Woon'],
						actions: ['Observa o oponente'],
						setting: 'Pátio interno',
						confidence: 0.91,
					}),
				};
				yield {
					kind: 'done' as const,
					ok: true,
					exitCode: 0,
					timedOut: false,
					cancelled: false,
					sessionId: 'gw-sess',
					result: null,
					errorOutput: null,
				};
			},
		};

		const gwProvider = createClaudeVisionProvider({
			adapter: mockGatewayAdapter,
			providerId: 'claude-gateway',
			cwd: workDir,
			model: 'claude-opus-5-5',
		});

		const cb = new AgentCircuitBreaker();
		const results = await runMultimodalVisionHealthCheck({
			rootDir: workDir,
			circuitBreaker: cb,
			force: true,
			candidates: [
				{
					id: 'claude-gateway',
					label: 'Claude Gateway',
					getCliStatus: async () => ({
						installed: true,
						version: 'claude-opus-5-5',
						authenticated: true,
						authMethod: 'gateway-token',
						problems: [],
					}),
					port: gwProvider,
				},
			],
		});

		expect(capturedModel).toBe('claude-opus-5-5');
		expect(results[0]?.multimodalStatus).toBe('multimodal_available');
		expect(results[0]?.testedWithRealImage).toBe(true);
		expect(cb.isAvailable('claude-gateway')).toBe(true);
	});

	it('3. Codex CLI com imagem real (via RecapVisualAnalysisPort + runMultimodalVisionHealthCheck)', async () => {
		const probePath = ensureVisionHealthProbeImage(workDir);
		const codexPort: RecapVisualAnalysisPort = {
			id: 'codex',
			model: 'codex-cli',
			detect: async () => ({ available: true }),
			analyze: async ({ frames }) => {
				expect(frames[0]?.path).toBe(probePath);
				return {
					nature: 'action',
					natureConfidence: 0.88,
					description: 'Cena de ação analisada pelo Codex CLI com imagem real.',
					frames: [{ atMs: 0, observed: 'Personagem em movimento de ataque.', visibleText: [] }],
					entities: [{ name: 'Guerreiro', type: 'character', basis: 'observed', evidence: 'Visível no centro', confidence: 0.88 }],
					actions: [{ description: 'Salto com espada', basis: 'observed', confidence: 0.88 }],
					environment: { description: 'Templo antigo', basis: 'observed', confidence: 0.85 },
					overlays: { burnedText: false, burnedTextRegion: null, watermark: false, webcam: false },
					limitations: [],
					confidence: 0.88,
				};
			},
		};

		const cb = new AgentCircuitBreaker();
		const res = await runMultimodalVisionHealthCheck({
			rootDir: workDir,
			circuitBreaker: cb,
			force: true,
			candidates: [
				{
					id: 'codex',
					label: 'Codex CLI',
					getCliStatus: async () => ({
						installed: true,
						version: '0.166.0',
						authenticated: true,
						authMethod: 'chatgpt',
						problems: [],
					}),
					port: codexPort,
				},
			],
		});
		expect(res[0]?.multimodalStatus).toBe('multimodal_available');
		expect(res[0]?.detail).toContain('Codex CLI');
	});

	it('4. Antigravity CLI com imagem real (contrato detect={available:true} + runMultimodalVisionHealthCheck)', async () => {
		const probePath = ensureVisionHealthProbeImage(workDir);
		const agyPort: RecapVisualAnalysisPort = {
			id: 'antigravity',
			model: 'gemini-2.5-pro',
			detect: async () => ({ available: true }),
			analyze: async ({ frames }) => {
				expect(frames[0]?.path).toBe(probePath);
				return {
					nature: 'cinematic',
					natureConfidence: 0.9,
					description: 'Painel analisado pelo Antigravity CLI (agy) com leitura multimodal.',
					frames: [{ atMs: 0, observed: 'Quadro vertical com moldura escura.', visibleText: [] }],
					entities: [],
					actions: [{ description: 'Enquadramento estático', basis: 'observed', confidence: 0.9 }],
					environment: null,
					overlays: { burnedText: false, burnedTextRegion: null, watermark: false, webcam: false },
					limitations: [],
					confidence: 0.9,
				};
			},
		};

		const cb = new AgentCircuitBreaker();
		const res = await runMultimodalVisionHealthCheck({
			rootDir: workDir,
			circuitBreaker: cb,
			force: true,
			candidates: [
				{
					id: 'antigravity',
					label: 'Antigravity CLI (agy)',
					getCliStatus: async () => ({
						installed: true,
						version: '1.5.14',
						authenticated: true,
						authMethod: 'cli',
						problems: [],
					}),
					port: agyPort,
				},
			],
		});
		expect(res[0]?.multimodalStatus).toBe('multimodal_available');
		expect(res[0]?.detail).toContain('Antigravity CLI');
	});

	it('5. Quota esgotada vs exit code 1 genérico (não classifica todo exit code 1 como QUOTA_EXCEEDED)', async () => {
		// Real quota exhaustion with exit code 1 -> QUOTA_EXCEEDED + resetAtText
		const quotaErr = classifyVisionError(
			"codex visual run failed: exit code 1 — You've hit your usage limit. Try again at Nov 23rd, 2026 11:02 AM.",
			'codex',
		);
		expect(quotaErr.code).toBe('QUOTA_EXCEEDED');
		expect(quotaErr.exitCode).toBe(1);
		expect(quotaErr.resetAtText).toContain('Nov 23rd, 2026 11:02 AM');

		// Antigravity low credit balance -> QUOTA_EXCEEDED
		const agyQuotaErr = classifyVisionError(
			'error: Your AI credits balance is too low to continue. (exit code 1)',
			'antigravity',
		);
		expect(agyQuotaErr.code).toBe('QUOTA_EXCEEDED');

		// Generic exit code 1 without quota text -> MUST NOT be classified as QUOTA_EXCEEDED
		const genericExit1 = classifyVisionError(
			'Command failed with exit code 1: unexpected flag --foo',
			'claude',
		);
		expect(genericExit1.code).not.toBe('QUOTA_EXCEEDED');
		expect(genericExit1.code).toBe('UNKNOWN_PROVIDER_ERROR');
		expect(genericExit1.exitCode).toBe(1);
	});

	it('6. Autenticação inválida (separa estado auth_expired e abre circuit breaker)', async () => {
		const cb = new AgentCircuitBreaker();
		const failingAuthPort: RecapVisualAnalysisPort = {
			id: 'claude-gateway',
			model: 'claude-opus-5-5',
			detect: async () => ({ available: true }),
			analyze: async () => {
				throw new Error('HTTP 401 Unauthorized: invalid_api_key or token expired');
			},
		};

		const health = await runMultimodalVisionHealthCheck({
			rootDir: workDir,
			circuitBreaker: cb,
			force: true,
			candidates: [
				{
					id: 'claude-gateway',
					label: 'Claude Gateway',
					getCliStatus: async () => ({
						installed: true,
						version: 'claude-opus-5-5',
						authenticated: true,
						authMethod: 'gateway-token',
						problems: [],
					}),
					port: failingAuthPort,
				},
			],
		});

		expect(health[0]?.multimodalStatus).toBe('auth_expired');
		expect(health[0]?.code).toBe('AUTHENTICATION_FAILED');
		expect(cb.isAvailable('claude-gateway')).toBe(false);
		expect(cb.getState('claude-gateway')?.code).toBe('AUTHENTICATION_FAILED');
	});

	it('7. Modelo sem suporte a imagens (classifica MODEL_INCOMPATIBLE e separa estado model_incompatible)', async () => {
		const cb = new AgentCircuitBreaker();
		const textOnlyModelPort: RecapVisualAnalysisPort = {
			id: 'custom-text-llm',
			model: 'text-only-v1',
			detect: async () => ({ available: true }),
			analyze: async () => {
				throw new Error('400 Bad Request: model text-only-v1 does not support image input');
			},
		};

		const health = await runMultimodalVisionHealthCheck({
			rootDir: workDir,
			circuitBreaker: cb,
			force: true,
			candidates: [
				{
					id: 'custom-text-llm',
					label: 'Text LLM',
					getCliStatus: async () => ({
						installed: true,
						version: '1.0.0',
						authenticated: true,
						authMethod: 'api-key',
						problems: [],
					}),
					port: textOnlyModelPort,
				},
			],
		});

		expect(health[0]?.multimodalStatus).toBe('model_incompatible');
		expect(health[0]?.code).toBe('MODEL_INCOMPATIBLE');
		expect(cb.isAvailable('custom-text-llm')).toBe(false);
	});

	it('8. Falha de um provedor com fallback funcional (não repete provedor com quota esgotada nos painéis seguintes)', async () => {
		const panel1 = makeExtractedPanel(workDir, 1);
		const panel2 = makeExtractedPanel(workDir, 2);
		let claudeCalls = 0;
		let gatewayCalls = 0;

		const claudeQuotaExhausted: RecapVisualAnalysisPort = {
			id: 'claude',
			model: 'claude-sonnet-4-20250514',
			detect: async () => ({ available: true }),
			analyze: async () => {
				claudeCalls++;
				throw new Error("You've hit your weekly limit · resets 3pm (America/Sao_Paulo) · out of usage credits");
			},
		};

		const gatewayWorking: RecapVisualAnalysisPort = {
			id: 'claude-gateway',
			model: 'claude-opus-5-5',
			detect: async () => ({ available: true }),
			analyze: async () => {
				gatewayCalls++;
				return {
					nature: 'action',
					natureConfidence: 0.93,
					description: `Painel analisado pelo fallback Claude Gateway (chamada ${gatewayCalls}).`,
					frames: [{ atMs: 0, observed: 'Ação principal no painel', visibleText: [] }],
					entities: [{ name: 'Cheon Yeo-Woon', type: 'character', basis: 'observed', evidence: 'Visível', confidence: 0.93 }],
					actions: [{ description: 'Golpe de espada', basis: 'observed', confidence: 0.93 }],
					environment: { description: 'Arena', basis: 'observed', confidence: 0.9 },
					overlays: { burnedText: false, burnedTextRegion: null, watermark: false, webcam: false },
					limitations: [],
					confidence: 0.93,
				};
			},
		};

		const cb = new AgentCircuitBreaker();
		const adapter = createRecapVisionAdapter({
			root: workDir,
			providers: [claudeQuotaExhausted, gatewayWorking],
			circuitBreaker: cb,
			throwOnAllUnavailable: true,
		});

		const res1 = await adapter.analyze(panel1.croppedImagePath!);
		expect(res1.confidence).toBeCloseTo(0.93);
		expect(claudeCalls).toBe(1);
		expect(gatewayCalls).toBe(1);
		// Circuit breaker must now be OPEN for 'claude'
		expect(cb.isAvailable('claude')).toBe(false);
		expect(cb.getState('claude')?.code).toBe('QUOTA_EXCEEDED');

		// Second panel must skip 'claude' immediately and go straight to 'claude-gateway'
		const res2 = await adapter.analyze(panel2.croppedImagePath!);
		expect(res2.confidence).toBeCloseTo(0.93);
		expect(claudeCalls).toBe(1); // NOT called again!
		expect(gatewayCalls).toBe(2);
	});

	it('9. Falha de todos os provedores sem gerar conteúdo fictício', async () => {
		const panels = [makeExtractedPanel(workDir, 1), makeExtractedPanel(workDir, 2)];
		const cb = new AgentCircuitBreaker();

		const p1: RecapVisualAnalysisPort = {
			id: 'claude',
			model: 'claude-sonnet-4-20250514',
			detect: async () => ({ available: true }),
			analyze: async () => {
				throw new Error("You've hit your weekly limit · out of usage credits");
			},
		};
		const p2: RecapVisualAnalysisPort = {
			id: 'codex',
			model: 'codex-cli',
			detect: async () => ({ available: true }),
			analyze: async () => {
				throw new Error("You've hit your usage limit. Try again at Nov 23rd, 2026 11:02 AM.");
			},
		};

		const visionAdapter = createRecapVisionAdapter({
			root: workDir,
			providers: [p1, p2],
			circuitBreaker: cb,
			throwOnAllUnavailable: true,
		});

		const outcome = await runRecapProductionOrchestrator({
			runId: 'run-all-fail',
			chapterId: 'ch-all-fail',
			workTitle: 'Nano Machine',
			panels,
			workspaceDir: workDir,
			circuitBreaker: cb,
			visionAdapter,
			providers: [
				{ id: 'claude', label: 'Claude Code', detect: async () => ({ available: true }) },
				{ id: 'codex', label: 'Codex CLI', detect: async () => ({ available: true }) },
			],
		});

		// Must NOT generate any fake script!
		expect(outcome.script).toBeUndefined();
		expect(outcome.record.state).toBe('failed');
		expect(outcome.record.lastError).toContain('claude=QUOTA_EXCEEDED');
		expect(outcome.record.lastError).toContain('codex=QUOTA_EXCEEDED');
		expect(outcome.record.visionTelemetry?.failedProviders.length).toBeGreaterThanOrEqual(2);
	});

	it('10. Retomada de checkpoint sem reprocessar painéis concluídos', async () => {
		const panels = [
			makeExtractedPanel(workDir, 1),
			makeExtractedPanel(workDir, 2),
			makeExtractedPanel(workDir, 3),
		];
		const analyzedPanelHashes: string[] = [];
		let failOnThirdPanel = true;

		const flakyPort: RecapVisualAnalysisPort = {
			id: 'claude-gateway',
			model: 'claude-opus-5-5',
			detect: async () => ({ available: true }),
			analyze: async ({ frames }) => {
				const framePath = frames[0]!.path;
				if (failOnThirdPanel && analyzedPanelHashes.length >= 2) {
					throw new Error("You've hit your usage limit · quota exceeded on panel 3");
				}
				analyzedPanelHashes.push(framePath);
				return {
					nature: 'dialogue',
					natureConfidence: 0.92,
					description: `Painel ${analyzedPanelHashes.length} analisado com sucesso.`,
					frames: [{ atMs: 0, observed: 'Diálogo entre mestres', visibleText: [] }],
					entities: [{ name: 'Cheon Yeo-Woon', type: 'character', basis: 'observed', evidence: 'Visível', confidence: 0.92 }],
					actions: [{ description: 'Conversando', basis: 'observed', confidence: 0.92 }],
					environment: { description: 'Salão principal', basis: 'observed', confidence: 0.9 },
					overlays: { burnedText: false, burnedTextRegion: null, watermark: false, webcam: false },
					limitations: [],
					confidence: 0.92,
				};
			},
		};

		const cb1 = new AgentCircuitBreaker();
		const adapter1 = createRecapVisionAdapter({
			root: workDir,
			providers: [flakyPort],
			circuitBreaker: cb1,
			throwOnAllUnavailable: true,
		});

		// Run 1: panels 1 and 2 succeed and are checkpointed; panel 3 fails with QUOTA_EXCEEDED
		const run1 = await runRecapProductionOrchestrator({
			runId: 'run-resume-test',
			chapterId: 'ch-resume-test',
			workTitle: 'Nano Machine Cap. 1',
			panels,
			workspaceDir: workDir,
			circuitBreaker: cb1,
			visionAdapter: adapter1,
			providers: [{ id: 'claude-gateway', label: 'Claude Gateway', detect: async () => ({ available: true }) }],
			dryRunRender: true,
		});

		expect(run1.script).toBeUndefined();
		expect(run1.record.state).toBe('paused_provider_unavailable');
		expect(run1.record.visionTelemetry?.completedPanels).toBe(2);
		expect(run1.record.visionTelemetry?.canResumeFromCheckpoint).toBe(true);
		expect(analyzedPanelHashes).toHaveLength(2);

		const ckpt = loadCheckpoint(join(workDir, 'checkpoints', 'ch-resume-test'));
		expect(ckpt?.panelAnalyses).toHaveLength(2);

		// Run 2: provider recovers; resume must NOT reprocess panels 1 and 2 (only panel 3 is analyzed!)
		failOnThirdPanel = false;
		const cb2 = new AgentCircuitBreaker();
		const adapter2 = createRecapVisionAdapter({
			root: workDir,
			providers: [flakyPort],
			circuitBreaker: cb2,
			throwOnAllUnavailable: true,
		});

		const run2 = await runRecapProductionOrchestrator({
			runId: 'run-resume-test',
			chapterId: 'ch-resume-test',
			workTitle: 'Nano Machine Cap. 1',
			panels,
			workspaceDir: workDir,
			circuitBreaker: cb2,
			visionAdapter: adapter2,
			providers: [{ id: 'claude-gateway', label: 'Claude Gateway', detect: async () => ({ available: true }) }],
			dryRunRender: true,
		});

		// Total fresh vision calls across BOTH runs must be 3 (2 in run1 + 1 in run2, 0 reprocessed!)
		expect(analyzedPanelHashes).toHaveLength(3);
		expect(run2.script).toBeDefined();
		expect(run2.script?.scenes.length).toBeGreaterThan(0);
		expect(run2.record.visionTelemetry?.completedPanels).toBe(3);
	});
});
