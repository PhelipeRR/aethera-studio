/**
 * E2E Live Test — Aethera Recap Fase 2.2.4 (Nano Machine Cap. 01)
 *
 * Pipeline completo:
 *   CBZ -> Import/Extracao -> Gate F (com diagnostico detalhado)
 *   -> Analise Visual via VisionRouter + Circuit Breaker + Checkpoints duraveis
 *   -> Continuidade -> Pesquisa Contextual (ResearchPort multiagente)
 *   -> Roteiro -> Gate G Inicial -> Humanize (PT-BR) -> Gate G Final -> Relatorio
 *
 * Pre-requisitos no ambiente de execucao:
 * - Node.js 20+ e dependencias instaladas (`node_modules`)
 * - Pelo menos 1 agente multimodal operacional (Claude CLI, Claude Gateway, Codex CLI ou Antigravity CLI)
 *
 * Execucao:
 *   npx tsx scripts/e2e-recap-phase224.mts
 *   NB_RECAP_E2E_MAX_PANELS=24 NB_RECAP_CONCURRENCY=2 npx tsx scripts/e2e-recap-phase224.mts
 */

import { existsSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';

import { openDatabase } from '@neuralbridge/database';
import { ClaudeCliAdapter, CodexCliAdapter } from '@neuralbridge/agents';
import {
	TaskEngine,
	VisionRouter,
	createAgentAdapterVisionProvider,
	createAntigravityCliVisionProvider,
	runVideoResearch,
	type VisualAnalysisProvider,
	type VisionCachePort,
} from '@neuralbridge/orchestrator';
import {
	importChapter,
	extractPanels,
	createTesseractOcrAdapter,
	runGateFPanelIntegrity,
	createClaudeVisionProvider,
	createRoutedRecapVisionAdapter,
	formatVisionRoutingSummary,
	createTaskEngineTextEnhancementAdapter,
	createMultiAgentVideoResearchPortAdapter,
	runStoryEngine,
	AgentCircuitBreaker,
	AllVisionProvidersUnavailableError,
	sanitizeErrorMessage,
	type ResearchAgentAdapterPort,
} from '@neuralbridge/cinema';

const execFileAsync = promisify(execFile);

const REPO_ROOT = realpathSync(join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..'));
const CBZ_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'real-manga', 'Nano-Machine-Capitulo-01.cbz');

// Durable persistent directory inside the workspace (no exclusive dependency on OS tmpdir)
const WORK_DIR = process.env['NB_RECAP_DATA_DIR'] ?? process.env['NB_RECAP_E2E_DIR'] ?? join(REPO_ROOT, '.aethera-recap-data', 'phase224');
const OUTPUT_DIR = join(WORK_DIR, 'output');
const CHECKPOINT_DIR = join(WORK_DIR, 'checkpoints', 'nano-machine-cap-01');
const DB_FILE = join(WORK_DIR, 'recap-e2e.db');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'migrations');

const MAX_PANELS = Number(process.env['NB_RECAP_E2E_MAX_PANELS'] ?? '24');
const CONCURRENCY = Number(process.env['NB_RECAP_CONCURRENCY'] ?? '2');
const ENABLE_OCR = process.env['NB_RECAP_ENABLE_OCR'] === '1';
const CHAPTER_ID = 'nano-machine-cap-01';

async function detectAgyCli(): Promise<{ installed: boolean; version?: string; detail: string }> {
	try {
		const { stdout } = await execFileAsync('agy', ['--version'], { timeout: 5000, windowsHide: true });
		const ver = /(\d+\.\d+\.\d+)/.exec(stdout)?.[1];
		return { installed: true, ...(ver ? { version: ver } : {}), detail: stdout.trim() };
	} catch (err) {
		return { installed: false, detail: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) };
	}
}

async function runAgyPrompt(req: { prompt: string; cwd: string; model?: string; signal?: AbortSignal }) {
	const args = ['--output-format', 'json', '--mode', 'plan', '--print', req.prompt];
	if (req.model) args.splice(4, 0, '--model', req.model);
	try {
		const { stdout } = await execFileAsync('agy', args, {
			cwd: req.cwd,
			timeout: 90_000,
			windowsHide: true,
			...(req.signal ? { signal: req.signal } : {}),
		});
		return { ok: true, output: stdout };
	} catch (err) {
		const execErr = err as { code?: number | string; stderr?: string; stdout?: string; message?: string };
		const rawDetail = [
			execErr.code !== undefined ? `exit code ${execErr.code}` : '',
			execErr.stderr?.trim() || execErr.stdout?.trim() || execErr.message || String(err),
		].filter(Boolean).join(' — ');
		return { ok: false, output: '', error: sanitizeErrorMessage(rawDetail) };
	}
}

function detectDesktopClaudeGatewayStore(): { found: boolean; storePath?: string } {
	const appData = process.env['APPDATA'];
	const candidates = [
		process.env['NB_AETHERA_USER_DATA_DIR'] ? join(process.env['NB_AETHERA_USER_DATA_DIR'], 'aethera-claude-gateway.bin') : '',
		appData ? join(appData, 'aethera-desktop', 'aethera-claude-gateway.bin') : '',
		appData ? join(appData, 'Aethera Studio', 'aethera-claude-gateway.bin') : '',
		appData ? join(appData, 'neuralbridge-aethera-desktop', 'aethera-claude-gateway.bin') : '',
	].filter(Boolean);
	for (const candidate of candidates) {
		if (existsSync(candidate)) return { found: true, storePath: candidate };
	}
	return { found: false };
}

function log(stage: string, msg: string, data?: unknown) {
	const ts = new Date().toISOString().slice(11, 23);
	console.log(`[${ts}] [${stage}] ${msg}`);
	if (data !== undefined) console.log(JSON.stringify(data, null, 2));
}

function createMemoryVisionCache(): VisionCachePort {
	const store = new Map<string, unknown>();
	return {
		get: (key) => store.get(JSON.stringify(key)),
		put: (key, value) => { store.set(JSON.stringify(key), value); },
	};
}

async function main() {
	const t0 = Date.now();
	if (!existsSync(CBZ_PATH)) {
		throw new Error(`Dataset CBZ nao encontrado: ${CBZ_PATH}`);
	}

	mkdirSync(OUTPUT_DIR, { recursive: true });
	mkdirSync(CHECKPOINT_DIR, { recursive: true });
	log('INIT', `Workspace persistente: ${WORK_DIR}`);
	log('INIT', `Checkpoints duraveis: ${CHECKPOINT_DIR}`);

	// 1. Detectar agentes reais independentemente
	const claudeAdapter = new ClaudeCliAdapter();
	const codexAdapter = new CodexCliAdapter();

	// Claude Gateway: reutiliza configuracao em memoria (env) ou detecta cofre encriptado do Aethera Desktop (safeStorage)
	const desktopGatewayStore = detectDesktopClaudeGatewayStore();
	const gatewayToken = process.env['NB_CLAUDE_GATEWAY_TOKEN'] ?? process.env['ANTHROPIC_AUTH_TOKEN'];
	const gatewayBaseUrl = process.env['NB_CLAUDE_GATEWAY_BASE_URL'] ?? process.env['ANTHROPIC_BASE_URL'];
	const gatewayModel = process.env['NB_CLAUDE_GATEWAY_MODEL'] ?? process.env['ANTHROPIC_MODEL'];
	const gatewayConfigured = Boolean(gatewayToken && gatewayBaseUrl);
	const claudeGatewayAdapter = gatewayConfigured
		? new ClaudeCliAdapter({
			id: 'claude-gateway',
			resolveEnv: () => ({
				ANTHROPIC_AUTH_TOKEN: gatewayToken,
				ANTHROPIC_BASE_URL: gatewayBaseUrl,
				...(gatewayModel ? { ANTHROPIC_MODEL: gatewayModel } : {}),
				ANTHROPIC_API_KEY: undefined,
			}),
		})
		: null;

	const [claudeStatus, gatewayStatus, codexStatus, agyStatus] = await Promise.all([
		claudeAdapter.detect({ refresh: true }),
		claudeGatewayAdapter ? claudeGatewayAdapter.detect({ refresh: true }) : Promise.resolve(null),
		codexAdapter.detect({ refresh: true }),
		detectAgyCli(),
	]);

	const claudeReady = claudeStatus.installed && claudeStatus.authenticated !== false && claudeStatus.problems.length === 0;
	const gatewayReady = Boolean(gatewayStatus && gatewayStatus.installed && gatewayStatus.authenticated !== false && gatewayStatus.problems.length === 0);
	const codexReady = codexStatus.installed && codexStatus.authenticated !== false && codexStatus.problems.length === 0;

	log('AGENTS', 'Status detectado', {
		claude: { installed: claudeStatus.installed, authenticated: claudeStatus.authenticated, problems: claudeStatus.problems },
		claudeGateway: gatewayConfigured
			? { configured: true, source: 'env', installed: gatewayStatus?.installed, authenticated: gatewayStatus?.authenticated }
			: desktopGatewayStore.found
				? {
					configured: false,
					desktopStoreDetected: true,
					reason: 'Cofre safeStorage detectado no Aethera Desktop (criptografado pelo Electron). Em CLI standalone, informe NB_CLAUDE_GATEWAY_BASE_URL e NB_CLAUDE_GATEWAY_TOKEN em memoria na sessao.',
				}
				: { configured: false, desktopStoreDetected: false, reason: 'NB_CLAUDE_GATEWAY_TOKEN / NB_CLAUDE_GATEWAY_BASE_URL nao configurados' },
		codex: { installed: codexStatus.installed, authenticated: codexStatus.authenticated, problems: codexStatus.problems },
		antigravity_agy: agyStatus,
	});

	// 2. Importar CBZ e extrair paineis reais (preservando CBZ original)
	const imported = await importChapter({
		chapterId: CHAPTER_ID,
		archivePath: CBZ_PATH,
		outputDir: OUTPUT_DIR,
		readingOrder: 'vertical',
	});
	log('IMPORT', `${imported.pageCount} paginas importadas de Nano-Machine-Capitulo-01.cbz`);

	const ocrAdapter = ENABLE_OCR ? createTesseractOcrAdapter({ languages: 'por+eng' }) : undefined;
	const extracted = await extractPanels({
		chapter: imported,
		outputDir: OUTPUT_DIR,
		...(ocrAdapter ? { ocrAdapter } : {}),
	});
	log('EXTRACT', `${extracted.panels.length} paineis extraidos (amostra: ${MAX_PANELS}, OCR: ${ENABLE_OCR ? 'ativo' : 'desativado'})`);

	const samplePanels = MAX_PANELS > 0 ? extracted.panels.slice(0, MAX_PANELS) : extracted.panels;
	const gateF = runGateFPanelIntegrity({
		panels: samplePanels,
		minOcrConfidence: 0,
		expectedReadingOrder: 'vertical',
	});
	log('GATE-F', `Veredicto: ${gateF.verdict}`, gateF.metrics);
	if (gateF.verdict === 'fail') {
		throw new Error(`Gate F falhou: ${gateF.reasons.join('; ')}`);
	}

	// 3. Montar VisionRouter real do Orchestrator com fallback multiagente e circuit breaker
	const visionProviders: VisualAnalysisProvider[] = [];
	const policyChain: string[] = [];

	if (claudeReady) {
		const claudeLean = createClaudeVisionProvider({ adapter: claudeAdapter, providerId: 'claude', cwd: OUTPUT_DIR });
		visionProviders.push({
			id: 'claude',
			model: claudeLean.model,
			capabilities: ['analyze'],
			limits: { maxImagesPerCall: 1, costPerImageUsd: 0 },
			detect: () => claudeLean.detect(),
			analyze: (req) => claudeLean.analyze!(req) as ReturnType<NonNullable<VisualAnalysisProvider['analyze']>>,
		});
		policyChain.push('claude');
	}

	if (gatewayReady && claudeGatewayAdapter) {
		const gwLean = createClaudeVisionProvider({ adapter: claudeGatewayAdapter, providerId: 'claude-gateway', cwd: OUTPUT_DIR });
		visionProviders.push({
			id: 'claude-gateway',
			model: gwLean.model,
			capabilities: ['analyze'],
			limits: { maxImagesPerCall: 1, costPerImageUsd: 0 },
			detect: () => gwLean.detect(),
			analyze: (req) => gwLean.analyze!(req) as ReturnType<NonNullable<VisualAnalysisProvider['analyze']>>,
		});
		policyChain.push('claude-gateway');
	}

	if (codexReady) {
		// CodexCliAdapter passes --image=<path> natively to `codex exec`
		visionProviders.push(
			createAgentAdapterVisionProvider({
				id: 'codex',
				root: WORK_DIR,
				adapter: codexAdapter,
			}),
		);
		policyChain.push('codex');
	}

	if (agyStatus.installed) {
		visionProviders.push(
			createAntigravityCliVisionProvider({
				root: WORK_DIR,
				detect: async () => ({ available: true }),
				runPrompt: runAgyPrompt,
			}),
		);
		policyChain.push('antigravity');
	}

	const userPriority = process.env['NB_RECAP_VISION_PRIORITY']
		?.split(',')
		.map((s) => s.trim())
		.filter(Boolean);
	const effectiveChain = userPriority && userPriority.length > 0
		? userPriority.filter((id) => policyChain.includes(id))
		: policyChain;

	log('VISION-ROUTER', `Cadeia multimodal configurada: [${effectiveChain.join(' -> ')}]`);

	const circuitBreaker = new AgentCircuitBreaker();
	const visionRouter = new VisionRouter(visionProviders, createMemoryVisionCache(), [], undefined, undefined, undefined, undefined, 3_000, {
		priority: effectiveChain,
	});

	const visionAdapter = createRoutedRecapVisionAdapter({
		root: WORK_DIR,
		router: visionRouter as unknown as Parameters<typeof createRoutedRecapVisionAdapter>[0]['router'],
		policyChain: effectiveChain,
		maxLatencyMs: 120_000,
		circuitBreaker,
		throwOnAllUnavailable: true,
	});

	// 4. TaskEngine + ResearchPort + TextEnhancementPort
	const handle = openDatabase(DB_FILE, { migrationsFolder: MIGRATIONS_DIR });
	try {
		const taskEngine = new TaskEngine({
			handle,
			adapters: {
				claude: claudeAdapter,
				codex: codexAdapter,
				...(claudeGatewayAdapter ? { 'claude-gateway': claudeGatewayAdapter } : {}),
			},
			availability: async () => ({
				claude: claudeReady && circuitBreaker.isAvailable('claude'),
				codex: codexReady && circuitBreaker.isAvailable('codex'),
				'claude-gateway': gatewayReady && circuitBreaker.isAvailable('claude-gateway'),
			}),
			limits: { maxIterations: 1, stepTimeoutMs: 120_000, tokenBudget: 500_000 },
		});

		const textAgents: string[] = [];
		if (gatewayReady) textAgents.push('claude-gateway');
		if (codexReady) textAgents.push('codex');
		if (claudeReady) textAgents.push('claude');

		const textEnhancementPort = createTaskEngineTextEnhancementAdapter({
			taskEngine,
			projectId: null,
			agentPriority: textAgents,
		});

		const researchAdapters: ResearchAgentAdapterPort[] = [];
		if (codexReady) researchAdapters.push(codexAdapter as unknown as ResearchAgentAdapterPort);
		if (gatewayReady && claudeGatewayAdapter) researchAdapters.push(claudeGatewayAdapter as unknown as ResearchAgentAdapterPort);
		if (claudeReady) researchAdapters.push(claudeAdapter as unknown as ResearchAgentAdapterPort);

		const researchPort = createMultiAgentVideoResearchPortAdapter({
			adapters: researchAdapters,
			cwd: OUTPUT_DIR,
			runVideoResearchFn: (adapter, topic, cwd, signal) =>
				runVideoResearch(adapter as unknown as Parameters<typeof runVideoResearch>[0], topic, cwd, signal),
		});

		// 5. Executar Story Engine completo (Fase 2.2.4)
		const result = await runStoryEngine({
			chapterId: CHAPTER_ID,
			panels: samplePanels,
			outputDir: OUTPUT_DIR,
			checkpointDir: CHECKPOINT_DIR,
			visionAdapter,
			scriptStyle: 'narrative_recap',
			minBeatConfidence: 0.5,
			analysisConcurrency: CONCURRENCY,
			research: {
				enabled: true,
				workTitle: 'Nano Machine',
				currentChapter: 1,
				maxAllowedChapter: 1,
				cwd: OUTPUT_DIR,
				port: researchPort,
			},
			humanize: {
				enabled: true,
				style: 'narrative_recap',
				maxDurationDeviation: 0.15,
				port: textEnhancementPort,
			},
		});

		const totalSec = ((Date.now() - t0) / 1000).toFixed(1);
		const summary = {
			elapsedSec: Number(totalSec),
			panelsAnalyzed: result.analyses.length,
			avgConfidence: Number(
				(result.analyses.reduce((s, a) => s + a.analysisConfidence, 0) / Math.max(1, result.analyses.length)).toFixed(3),
			),
			circuitBreakerState: circuitBreaker.getSnapshot(),
			visionTelemetry: visionRouter.getProviderTelemetry(),
			gateF: { verdict: gateF.verdict, metrics: gateF.metrics },
			preHumanizeGateG: result.preHumanizeGateG?.verdict ?? null,
			finalGateG: result.gateGReport.verdict,
			divergenceReport: result.divergenceReport ?? null,
			researchSkipped: result.contextualResearchResult?.skipped ?? true,
			researchAgent: result.contextualResearchResult?.agentId ?? 'none',
			researchSources: result.contextualResearchResult?.accepted.map((r) => ({ title: r.title, url: r.url })) ?? [],
			humanizeAgent: result.humanizeResult?.agentId ?? 'none',
			checkpointDir: CHECKPOINT_DIR,
			warnings: result.warnings,
		};

		const reportPath = join(OUTPUT_DIR, 'phase224-e2e-report.json');
		writeFileSync(reportPath, JSON.stringify({ summary, result }, null, 2), 'utf-8');
		log('DONE', `Relatorio salvo em ${reportPath}`, summary);
	} catch (err) {
		if (err instanceof AllVisionProvidersUnavailableError) {
			const routingSummary = formatVisionRoutingSummary(visionAdapter.getLastTrace()?.attempts ?? [], circuitBreaker);
			log('BLOCKED', 'Todos os agentes multimodais falharam ou estao indisponiveis', {
				code: err.code,
				message: err.message,
				routingSummary,
				diagnostics: err.diagnostics,
				circuitBreakerState: circuitBreaker.getSnapshot(),
				checkpointDir: CHECKPOINT_DIR,
			});
			process.exitCode = 2;
			return;
		}
		throw err;
	} finally {
		handle.close();
	}
}

main().catch((err) => {
	console.error('[FATAL]', sanitizeErrorMessage(err instanceof Error ? err.message : String(err)));
	process.exit(1);
});
