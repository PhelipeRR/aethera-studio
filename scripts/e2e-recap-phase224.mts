/**
 * E2E Live Test — Aethera Recap Fase 2.2.4 (Nano Machine Cap. 01)
 *
 * Pipeline completo:
 *   CBZ -> Import/Extracao -> Gate F -> Analise Visual (com checkpoint/hash cache)
 *   -> Continuidade -> Pesquisa Contextual (ResearchPort + runVideoResearch)
 *   -> Roteiro -> Gate G Inicial -> Humanize (PT-BR) -> Gate G Final -> Relatorio
 *
 * Pre-requisitos no ambiente de execucao:
 * - Node.js 20+ e dependencias instaladas (`node_modules`)
 * - Pelo menos 1 agente autenticado (Claude CLI, Claude Gateway ou Codex CLI)
 *
 * Execucao:
 *   npx tsx scripts/e2e-recap-phase224.mts
 *   NB_RECAP_E2E_MAX_PANELS=24 NB_RECAP_CONCURRENCY=2 npx tsx scripts/e2e-recap-phase224.mts
 */

import { existsSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';

import { openDatabase } from '@neuralbridge/database';
import { ClaudeCliAdapter, CodexCliAdapter } from '@neuralbridge/agents';
import { TaskEngine, runVideoResearch } from '@neuralbridge/orchestrator';
import {
	importChapter,
	extractPanels,
	runGateFPanelIntegrity,
	createClaudeVisionProvider,
	createRecapVisionAdapter,
	createTaskEngineTextEnhancementAdapter,
	createMultiAgentVideoResearchPortAdapter,
	runStoryEngine,
	type ResearchAgentAdapterPort,
} from '@neuralbridge/cinema';

const execFileAsync = promisify(execFile);

const REPO_ROOT = realpathSync(join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..'));
const CBZ_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'real-manga', 'Nano-Machine-Capitulo-01.cbz');
const WORK_DIR = process.env['NB_RECAP_E2E_DIR'] ?? join(tmpdir(), `recap-phase224-${Date.now()}`);
const OUTPUT_DIR = join(WORK_DIR, 'output');
const DB_FILE = join(WORK_DIR, 'recap-e2e.db');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'migrations');

const MAX_PANELS = Number(process.env['NB_RECAP_E2E_MAX_PANELS'] ?? '24');
const CONCURRENCY = Number(process.env['NB_RECAP_CONCURRENCY'] ?? '2');
const CHAPTER_ID = 'nano-machine-cap-01';

async function detectAgyCli(): Promise<{ installed: boolean; detail: string }> {
	try {
		const { stdout } = await execFileAsync('agy', ['--version'], { timeout: 3000 });
		return { installed: true, detail: stdout.trim() };
	} catch (err) {
		return { installed: false, detail: err instanceof Error ? err.message : String(err) };
	}
}

function log(stage: string, msg: string, data?: unknown) {
	const ts = new Date().toISOString().slice(11, 23);
	console.log(`[${ts}] [${stage}] ${msg}`);
	if (data !== undefined) console.log(JSON.stringify(data, null, 2));
}

async function main() {
	const t0 = Date.now();
	if (!existsSync(CBZ_PATH)) {
		throw new Error(`Dataset CBZ nao encontrado: ${CBZ_PATH}`);
	}

	mkdirSync(OUTPUT_DIR, { recursive: true });
	log('INIT', `Workspace: ${WORK_DIR}`);

	// 1. Detectar agentes reais
	const claudeAdapter = new ClaudeCliAdapter();
	const codexAdapter = new CodexCliAdapter();
	const [claudeStatus, codexStatus, agyStatus] = await Promise.all([
		claudeAdapter.detect({ refresh: true }),
		codexAdapter.detect({ refresh: true }),
		detectAgyCli(),
	]);

	const claudeReady = claudeStatus.installed && claudeStatus.authenticated !== false && claudeStatus.problems.length === 0;
	const codexReady = codexStatus.installed && codexStatus.authenticated !== false && codexStatus.problems.length === 0;

	log('AGENTS', 'Status detectado', {
		claude: { installed: claudeStatus.installed, authenticated: claudeStatus.authenticated, problems: claudeStatus.problems },
		codex: { installed: codexStatus.installed, authenticated: codexStatus.authenticated, problems: codexStatus.problems },
		antigravity_agy: agyStatus,
	});

	if (!claudeReady && !codexReady) {
		throw new Error('Nenhum agente CLI autenticado (Claude ou Codex) disponivel no ambiente.');
	}

	// 2. Importar CBZ e extrair paineis reais
	const imported = await importChapter({
		chapterId: CHAPTER_ID,
		archivePath: CBZ_PATH,
		outputDir: OUTPUT_DIR,
		readingOrder: 'vertical',
	});
	log('IMPORT', `${imported.pageCount} paginas importadas de Nano-Machine-Capitulo-01.cbz`);

	const extracted = await extractPanels({
		chapter: imported,
		outputDir: OUTPUT_DIR,
	});
	log('EXTRACT', `${extracted.panels.length} paineis extraidos (limitando amostra a ${MAX_PANELS})`);

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

	// 3. TaskEngine e adapters multiagente
	const handle = openDatabase(DB_FILE, { migrationsFolder: MIGRATIONS_DIR });
	try {
		const taskEngine = new TaskEngine({
			handle,
			adapters: { claude: claudeAdapter, codex: codexAdapter },
			availability: async () => ({
				claude: claudeReady,
				codex: codexReady,
			}),
			limits: { maxIterations: 1, stepTimeoutMs: 120_000, tokenBudget: 500_000 },
		});

		const visionProvider = createClaudeVisionProvider({
			adapter: claudeAdapter,
			cwd: OUTPUT_DIR,
		});
		const visionAdapter = createRecapVisionAdapter({
			root: WORK_DIR,
			provider: visionProvider,
		});

		const agentPriority: string[] = [];
		if (claudeReady) agentPriority.push('claude');
		if (codexReady) agentPriority.push('codex');

		const textEnhancementPort = createTaskEngineTextEnhancementAdapter({
			taskEngine,
			projectId: null,
			agentPriority,
		});

		const researchAdapters: ResearchAgentAdapterPort[] = [];
		if (claudeReady) researchAdapters.push(claudeAdapter as unknown as ResearchAgentAdapterPort);
		if (codexReady) researchAdapters.push(codexAdapter as unknown as ResearchAgentAdapterPort);

		const researchPort = createMultiAgentVideoResearchPortAdapter({
			adapters: researchAdapters,
			cwd: OUTPUT_DIR,
			runVideoResearchFn: (adapter, topic, cwd, signal) =>
				runVideoResearch(adapter as unknown as Parameters<typeof runVideoResearch>[0], topic, cwd, signal),
		});

		// 4. Executar Story Engine completo (Fase 2.2.4)
		const result = await runStoryEngine({
			chapterId: CHAPTER_ID,
			panels: samplePanels,
			outputDir: OUTPUT_DIR,
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
			preHumanizeGateG: result.preHumanizeGateG?.verdict ?? null,
			finalGateG: result.gateGReport.verdict,
			divergenceReport: result.divergenceReport ?? null,
			researchSkipped: result.contextualResearchResult?.skipped ?? true,
			researchSources: result.contextualResearchResult?.accepted.map((r) => ({ title: r.title, url: r.url })) ?? [],
			humanizeAgent: result.humanizeResult?.agentId ?? 'none',
			warnings: result.warnings,
		};

		const reportPath = join(OUTPUT_DIR, 'phase224-e2e-report.json');
		writeFileSync(reportPath, JSON.stringify({ summary, result }, null, 2), 'utf-8');
		log('DONE', `Relatorio salvo em ${reportPath}`, summary);
	} finally {
		handle.close();
	}
}

main().catch((err) => {
	console.error('[FATAL]', err);
	process.exit(1);
});
