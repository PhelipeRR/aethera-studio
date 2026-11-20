/**
 * E2E Phase 2.2.4 — Aethera Recap Narrative Enhancement
 *
 * Pipeline completo com CBZ real:
 *   CBZ → Import → Extract Panels → Visual Analysis (Claude CLI)
 *   → Continuity → Contextual Research (optional) → Script Generation
 *   → Gate G Initial → Humanize → Gate G Final
 *
 * Dataset: tests/fixtures/real-manga/Nano-Machine-Capitulo-01.cbz
 * Agente: Claude CLI (OAuth autenticado)
 *
 * Execução: npx tsx scripts/e2e-recap-phase224.mts
 */

import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

// Database
import { openDatabase } from '@neuralbridge/database';

// Agents
import { ClaudeCliAdapter, CodexCliAdapter } from '@neuralbridge/agents';

// Orchestrator
import { TaskEngine, createTaskEngineVisionProvider } from '@neuralbridge/orchestrator';

// Cinema / Recap
import {
	importChapter,
	extractPanels,
	createRecapVisionAdapter,
	runStoryEngine,
	saveCheckpoint,
	loadCheckpoint,
	createTaskEngineTextEnhancementAdapter,
	type ExtractedPanel,
	type StoryEngineResult,
} from '@neuralbridge/cinema';

// ─── Configuração ──────────────────────────────────────────────────────────────

const REPO_ROOT = realpathSync(join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..'));
const CBZ_PATH = join(REPO_ROOT, 'tests', 'fixtures', 'real-manga', 'Nano-Machine-Capitulo-01.cbz');
const TEST_DIR = join(tmpdir(), 'recap-e2e-224-' + Date.now());
const OUTPUT_DIR = join(TEST_DIR, 'output');
const DB_FILE = join(TEST_DIR, 'test.db');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'migrations');

// Limite de painéis para análise (começar com 24 conforme especificado)
const MAX_PANELS_TO_ANALYZE = 24;

// ─── Helpers ───────────────────────────────────────────────────────────────────

function log(step: string, message: string, data?: unknown) {
	const ts = new Date().toISOString().slice(11, 23);
	console.log(`[${ts}] ${step}: ${message}`);
	if (data !== undefined) console.log(JSON.stringify(data, null, 2));
}

function elapsed(startMs: number): string {
	return `${((Date.now() - startMs) / 1000).toFixed(1)}s`;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
	const totalStart = Date.now();
	log('INIT', `Test directory: ${TEST_DIR}`);
	log('INIT', `Repository root: ${REPO_ROOT}`);
	log('INIT', `CBZ path: ${CBZ_PATH}`);

	// Validar CBZ
	if (!existsSync(CBZ_PATH)) {
		log('ERROR', `CBZ not found: ${CBZ_PATH}`);
		process.exit(1);
	}

	// Setup directories
	mkdirSync(OUTPUT_DIR, { recursive: true });

	// ═══════════════════════════════════════════════════════════════════════════
	// STAGE 1: Import Chapter from CBZ
	// ═══════════════════════════════════════════════════════════════════════════
	log('STAGE-1', 'Importing chapter from CBZ...');
	const importStart = Date.now();

	const chapter = await importChapter({
		chapterId: 'nano-machine-ch01',
		archivePath: CBZ_PATH,
		outputDir: OUTPUT_DIR,
	});

	log('STAGE-1', `Imported in ${elapsed(importStart)}`, {
		format: chapter.format,
		pageCount: chapter.pageCount,
		readingOrder: chapter.readingOrder,
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// STAGE 2: Extract Panels
	// ═══════════════════════════════════════════════════════════════════════════
	log('STAGE-2', 'Extracting panels from pages...');
	const extractStart = Date.now();

	const extractionResult = await extractPanels({
		chapter,
		outputDir: join(OUTPUT_DIR, chapter.chapterId, 'panels'),
	});

	log('STAGE-2', `Extracted in ${elapsed(extractStart)}`, {
		totalPanels: extractionResult.panels.length,
		warnings: extractionResult.warnings.length,
	});

	// Limitar painéis para análise (conforme especificado: começar com 24)
	const panelsToAnalyze = extractionResult.panels.slice(0, MAX_PANELS_TO_ANALYZE);
	log('STAGE-2', `Using ${panelsToAnalyze.length} panels for analysis (of ${extractionResult.panels.length} total)`);

	// ═══════════════════════════════════════════════════════════════════════════
	// STAGE 3: Setup Agents and TaskEngine
	// ═══════════════════════════════════════════════════════════════════════════
	log('STAGE-3', 'Setting up agents and TaskEngine...');

	// Open database
	const handle = openDatabase(DB_FILE, { migrationsFolder: MIGRATIONS_DIR });
	log('STAGE-3', `Database ready: ${DB_FILE}`);

	// Create agent adapters
	const claudeAdapter = new ClaudeCliAdapter();
	const codexAdapter = new CodexCliAdapter();

	const claudeStatus = await claudeAdapter.detect();
	const codexStatus = await codexAdapter.detect();

	log('STAGE-3', 'Agent detection', {
		claude: { installed: claudeStatus.installed, authenticated: claudeStatus.authenticated, version: claudeStatus.version },
		codex: { installed: codexStatus.installed, authenticated: codexStatus.authenticated },
	});

	if (!claudeStatus.installed || !claudeStatus.authenticated) {
		log('BLOCKED', 'Claude CLI not available or not authenticated.');
		log('BLOCKED', 'Run `claude auth login` and retry.');
		handle.close();
		process.exit(1);
	}

	// Create TaskEngine
	const taskEngine = new TaskEngine({
		handle,
		adapters: { claude: claudeAdapter, codex: codexAdapter },
		availability: async () => ({
			claude: claudeStatus.installed && claudeStatus.problems.length === 0,
			codex: codexStatus.installed && codexStatus.problems.length === 0,
		}),
		limits: { maxIterations: 1, stepTimeoutMs: 180_000, tokenBudget: 1_000_000 },
	});
	log('STAGE-3', 'TaskEngine ready');

	// Create Vision Provider backed by TaskEngine (Claude)
	const taskEngineProvider = createTaskEngineVisionProvider({
		id: 'claude',
		model: '',
		root: TEST_DIR,
		projectId: null,
		enabled: true,
		taskEngine,
		checkAvailable: async () => ({ available: true }),
	});

	const detectResult = await taskEngineProvider.detect();
	if (!('available' in detectResult) || !detectResult.available) {
		log('BLOCKED', 'Vision provider not available', detectResult);
		handle.close();
		process.exit(1);
	}
	log('STAGE-3', 'Vision provider ready');

	// Create RecapVisionAdapter
	const recapAdapter = createRecapVisionAdapter({
		root: TEST_DIR,
		provider: taskEngineProvider as Parameters<typeof createRecapVisionAdapter>[0]['provider'],
	});
	log('STAGE-3', `RecapVisionAdapter: ${recapAdapter.name}`);

	// Create TextEnhancementPort for Humanize (uses TaskEngine with fallback)
	const textEnhancementPort = createTaskEngineTextEnhancementAdapter({
		taskEngine: taskEngine as unknown as Parameters<typeof createTaskEngineTextEnhancementAdapter>[0]['taskEngine'],
		projectId: null,
		agentPriority: ['claude', 'codex'],
	});
	log('STAGE-3', `TextEnhancementPort: ${textEnhancementPort.name}`);

	// ═══════════════════════════════════════════════════════════════════════════
	// STAGE 4: Run Story Engine (full pipeline)
	// ═══════════════════════════════════════════════════════════════════════════
	log('STAGE-4', 'Running Story Engine pipeline...');
	log('STAGE-4', `Processing ${panelsToAnalyze.length} panels with Claude CLI vision...`);

	const pipelineStart = Date.now();

	// Research port stub (disabled for now — will use panel-only evidence)
	// When web search becomes available, enable via createVideoResearchPortAdapter
	const researchDisabled = {
		enabled: false,
		workTitle: 'Nano Machine',
		currentChapter: 1,
		cwd: REPO_ROOT,
		port: {
			name: 'stub-research-port',
			async research() {
				return { references: [], rejectedCount: 0, agentId: 'none', model: null, ok: true };
			},
		},
	};

	const storyEngineResult: StoryEngineResult = await runStoryEngine({
		chapterId: chapter.chapterId,
		panels: panelsToAnalyze,
		outputDir: OUTPUT_DIR,
		visionAdapter: recapAdapter,
		scriptStyle: 'narrative_recap',
		minBeatConfidence: 0.5,
		humanize: {
			enabled: true,
			style: 'narrative_recap',
			maxDurationDeviation: 0.15,
			port: textEnhancementPort,
		},
		research: researchDisabled,
	});

	log('STAGE-4', `Pipeline completed in ${elapsed(pipelineStart)}`, {
		analysesCount: storyEngineResult.analyses.length,
		beatsCount: storyEngineResult.sequence.beats.length,
		scenesCount: storyEngineResult.script.scenes.length,
		gateGVerdict: storyEngineResult.gateGReport.verdict,
		warnings: storyEngineResult.warnings.length,
	});

	// ═══════════════════════════════════════════════════════════════════════════
	// STAGE 5: Report Results
	// ═══════════════════════════════════════════════════════════════════════════
	log('RESULTS', '═══════════════════════════════════════════════════════════');
	log('RESULTS', 'E2E Phase 2.2.4 — Final Report');
	log('RESULTS', '═══════════════════════════════════════════════════════════');

	// Agent info
	log('RESULTS', 'Agent used', {
		provider: recapAdapter.name,
		model: taskEngineProvider.lastReportedModel?.() ?? 'unknown',
	});

	// Panel analysis summary
	const avgConfidence = storyEngineResult.analyses.length > 0
		? storyEngineResult.analyses.reduce((sum, a) => sum + a.analysisConfidence, 0) / storyEngineResult.analyses.length
		: 0;
	log('RESULTS', 'Panel Analysis', {
		panelsAnalyzed: storyEngineResult.analyses.length,
		averageConfidence: avgConfidence.toFixed(3),
		charactersFound: [...new Set(storyEngineResult.analyses.flatMap(a => a.characters))].length,
	});

	// Narrative continuity
	log('RESULTS', 'Narrative Continuity', {
		beatsGenerated: storyEngineResult.sequence.beats.length,
		readingOrder: chapter.readingOrder,
	});

	// Script generation
	log('RESULTS', 'Script Generation', {
		scenesCount: storyEngineResult.script.scenes.length,
		totalDurationSec: storyEngineResult.script.totalEstimatedDurationSec,
		title: storyEngineResult.script.title,
		generatedBy: storyEngineResult.script.generatedBy,
	});

	// Gate G Initial (pre-humanize)
	if (storyEngineResult.preHumanizeGateG) {
		log('RESULTS', 'Gate G Initial (Pre-Humanize)', {
			verdict: storyEngineResult.preHumanizeGateG.verdict,
			reasons: storyEngineResult.preHumanizeGateG.reasons.length,
			hints: storyEngineResult.preHumanizeGateG.hints.length,
			metrics: storyEngineResult.preHumanizeGateG.metrics,
		});
	}

	// Humanize result
	if (storyEngineResult.humanizeResult) {
		const hr = storyEngineResult.humanizeResult;
		log('RESULTS', 'Humanize', {
			agentId: hr.agentId,
			model: hr.model,
			skipped: hr.skipped,
			diffsCount: hr.diffs.length,
			revertedCount: hr.diffs.filter(d => d.reverted).length,
			warnings: hr.warnings.length,
		});

		// Print diffs summary
		for (const diff of hr.diffs) {
			log('DIFF', `Scene ${diff.sceneId}`, {
				reverted: diff.reverted,
				revertReason: diff.revertReason,
				originalLength: diff.originalText.length,
				humanizedLength: diff.humanizedText.length,
			});
		}

		// Gate G Final (post-humanize)
		log('RESULTS', 'Gate G Final (Post-Humanize)', {
			verdict: hr.postHumanizeGateG.verdict,
			reasons: hr.postHumanizeGateG.reasons.length,
			hints: hr.postHumanizeGateG.hints.length,
			metrics: hr.postHumanizeGateG.metrics,
		});
	} else {
		log('RESULTS', 'Humanize', { status: 'not executed' });
	}

	// Contextual research
	if (storyEngineResult.contextualResearchResult) {
		const cr = storyEngineResult.contextualResearchResult;
		log('RESULTS', 'Contextual Research', {
			skipped: cr.skipped,
			accepted: cr.accepted.length,
			rejected: cr.rejected.length,
			agentId: cr.agentId,
		});
	} else {
		log('RESULTS', 'Contextual Research', { status: 'disabled' });
	}

	// Warnings
	if (storyEngineResult.warnings.length > 0) {
		log('RESULTS', 'Warnings', storyEngineResult.warnings);
	}

	// ═══════════════════════════════════════════════════════════════════════════
	// STAGE 6: Save Artifacts
	// ═══════════════════════════════════════════════════════════════════════════
	log('SAVE', 'Saving artifacts...');

	// Save script JSON
	const scriptPath = join(OUTPUT_DIR, chapter.chapterId, 'script.json');
	writeFileSync(scriptPath, JSON.stringify(storyEngineResult.script, null, 2));
	log('SAVE', `Script saved: ${scriptPath}`);

	// Save Gate G report
	const gateGPath = join(OUTPUT_DIR, chapter.chapterId, 'gate-g-final.json');
	writeFileSync(gateGPath, JSON.stringify(storyEngineResult.gateGReport, null, 2));
	log('SAVE', `Gate G report saved: ${gateGPath}`);

	// Save humanize diffs if available
	if (storyEngineResult.humanizeResult) {
		const diffsPath = join(OUTPUT_DIR, chapter.chapterId, 'humanize-diffs.json');
		writeFileSync(diffsPath, JSON.stringify(storyEngineResult.humanizeResult.diffs, null, 2));
		log('SAVE', `Humanize diffs saved: ${diffsPath}`);
	}

	// Save full result
	const resultPath = join(OUTPUT_DIR, chapter.chapterId, 'e2e-result.json');
	writeFileSync(resultPath, JSON.stringify({
		timestamp: new Date().toISOString(),
		totalTimeSec: (Date.now() - totalStart) / 1000,
		panelsAnalyzed: storyEngineResult.analyses.length,
		averageConfidence: avgConfidence,
		scenesCount: storyEngineResult.script.scenes.length,
		gateGVerdict: storyEngineResult.gateGReport.verdict,
		humanizeAgent: storyEngineResult.humanizeResult?.agentId ?? 'none',
		warnings: storyEngineResult.warnings,
	}, null, 2));
	log('SAVE', `Full result saved: ${resultPath}`);

	// Print narration samples
	log('SAMPLES', '═══════════════════════════════════════════════════════════');
	log('SAMPLES', 'Narration Samples (first 3 scenes)');
	log('SAMPLES', '═══════════════════════════════════════════════════════════');
	for (let i = 0; i < Math.min(3, storyEngineResult.script.scenes.length); i++) {
		const scene = storyEngineResult.script.scenes[i]!;
		log('SCENE', `${scene.sceneId}: ${scene.title}`, {
			panelRefs: scene.panelReferences.length,
			narration: scene.narrationText?.slice(0, 200) + (scene.narrationText?.length > 200 ? '...' : ''),
		});
	}

	// Final summary
	log('COMPLETE', '═══════════════════════════════════════════════════════════');
	log('COMPLETE', `E2E Phase 2.2.4 finished in ${elapsed(totalStart)}`);
	log('COMPLETE', '═══════════════════════════════════════════════════════════');
	log('COMPLETE', 'Summary', {
		cbzFile: basename(CBZ_PATH),
		pagesImported: chapter.pageCount,
		panelsExtracted: extractionResult.panels.length,
		panelsAnalyzed: storyEngineResult.analyses.length,
		averageConfidence: avgConfidence.toFixed(3),
		beatsGenerated: storyEngineResult.sequence.beats.length,
		scenesGenerated: storyEngineResult.script.scenes.length,
		totalDurationSec: storyEngineResult.script.totalEstimatedDurationSec,
		gateGInitialVerdict: storyEngineResult.preHumanizeGateG?.verdict ?? 'n/a',
		gateGFinalVerdict: storyEngineResult.gateGReport.verdict,
		humanizeAgent: storyEngineResult.humanizeResult?.agentId ?? 'none',
		humanizeSkipped: storyEngineResult.humanizeResult?.skipped ?? true,
		outputDir: OUTPUT_DIR,
	});

	// Cleanup
	handle.close();
	log('CLEANUP', `Database closed. Artifacts at: ${OUTPUT_DIR}`);
	log('CLEANUP', 'To inspect results, keep the directory. To auto-clean, delete it manually.');
}

main().catch((err) => {
	console.error('FATAL:', err);
	if (err instanceof Error && err.stack) {
		console.error(err.stack);
	}
	process.exit(1);
});