import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
	ExtractedPanel,
	StoryEngineOptions,
	RecapScript,
	GateGReport,
	GateGDivergenceReport,
	VisionAdapter,
	OcrAdapter,
	ScriptStyle,
	NarrativeSequence,
	PanelAnalysis,
	HumanizeResult,
	ContextualResearchResult,
} from './recap-types.js';
import { runNarrativeAnalyzer } from './narrative-analyzer.js';
import { runStoryContinuityEngine } from './story-continuity-engine.js';
import { runScriptGenerator } from './script-generator.js';
import { runGateGNarrativeFidelity, buildGateGDivergenceReport } from './gate-g-narrative-fidelity.js';
import { runNarrativeHumanizer } from './narrative-humanizer.js';
import { runContextualResearch } from './contextual-research.js';
import { saveCheckpoint, loadCheckpoint } from './checkpoint-persistence.js';

export interface StoryEngineResult {
	script: RecapScript;
	gateGReport: GateGReport;
	/** Gate G report before humanization (Phase 2.2). Null when humanize is disabled. */
	preHumanizeGateG?: GateGReport;
	/** Comparative divergence report between pre- and post-humanize Gate G. */
	divergenceReport?: GateGDivergenceReport;
	/** Humanization result with diffs and post-humanize Gate G (Phase 2.2). Null when disabled/skipped. */
	humanizeResult?: HumanizeResult;
	/** Contextual research result (Phase 2.2). Null when disabled/skipped. */
	contextualResearchResult?: ContextualResearchResult;
	sequence: NarrativeSequence;
	analyses: PanelAnalysis[];
	warnings: string[];
}

/**
 * Story Engine — Phase 2 Orchestrator (v2.2.3)
 *
 * Integrates all Phase 2 components into a single pipeline:
 *   Panels → Narrative Analysis → Continuity → Contextual Research (optional)
 *   → Script Generation → Gate G Initial → Humanize (optional) → Gate G Final → Result
 *
 * Supports checkpoint-based resumption to avoid reprocessing completed stages.
 * Records which agent/model produced each analysis step.
 *
 * KEY GUARANTEES:
 * - Never fabricates narrative content not supported by panel evidence.
 * - All scenes reference valid panels with accessible cropped images.
 * - Low-confidence analyses are flagged for human review, never auto-approved.
 * - Checkpoint persistence allows safe interruption and resumption.
 * - Vision and OCR adapters are optional — system degrades gracefully without them.
 * - Contextual research is complementary only; panels remain the primary source.
 * - Humanize preserves facts, characters, panel references and duration.
 * - Gate G fail/needs_review prevents automatic approval of final result.
 */
export async function runStoryEngine(options: StoryEngineOptions): Promise<StoryEngineResult> {
	const {
		chapterId,
		panels,
		outputDir,
		visionAdapter,
		scriptStyle = 'narrative_recap',
		minBeatConfidence = 0.5,
		analysisConcurrency = 1,
		humanize,
		research,
	} = options;

	const warnings: string[] = [];
	const checkpointDir = join(outputDir, chapterId, 'checkpoints');
	if (!existsSync(checkpointDir)) mkdirSync(checkpointDir, { recursive: true });

	// Determine agent identifier for attribution
	const analyzedBy = visionAdapter?.name ?? 'text-only-fallback';
	const generatedBy = `story-engine-${scriptStyle}`;

	// ─── Stage 1: Narrative Analysis ──────────────────────────────────────────
	let analyses: PanelAnalysis[] = [];

	const existingCheckpoint = loadCheckpoint(checkpointDir);
	const cachedAnalyses = (existingCheckpoint?.panelAnalyses ?? []) as PanelAnalysis[];
	const analysisCacheByHash: Record<string, PanelAnalysis> = {
		...((existingCheckpoint?.analysisCacheByHash ?? {}) as Record<string, PanelAnalysis>),
	};
	if (cachedAnalyses.length > 0 || Object.keys(analysisCacheByHash).length > 0) {
		warnings.push(`Resuming from checkpoint with ${cachedAnalyses.length} cached panel analyses and ${Object.keys(analysisCacheByHash).length} hash cache entries.`);
	}

	const analysisResult = await runNarrativeAnalyzer({
		panels,
		visionAdapter,
		analyzedBy,
		minConfidence: minBeatConfidence,
		concurrency: analysisConcurrency,
		cachedAnalyses,
		analysisCacheByHash,
		onPanelAnalyzed: (analysis, panel) => {
			if (analysis.analysisConfidence > 0) {
				analysisCacheByHash[panel.imageHash] = analysis;
			}
		},
	});
	analyses = analysisResult.analyses;
	warnings.push(...analysisResult.warnings);
	for (let idx = 0; idx < analyses.length; idx++) {
		const a = analyses[idx]!;
		const p = panels.find((x) => x.panelId === a.panelId);
		if (p && a.analysisConfidence > 0) {
			analysisCacheByHash[p.imageHash] = a;
		}
	}

	// Save checkpoint after analysis (persisting analyses and hash cache for resume)
	saveCheckpoint(checkpointDir, {
		chapterId,
		completedStages: ['import', 'extraction', 'narrative'],
		lastUpdatedAtIso: new Date().toISOString(),
		sourceHash: panels[0]?.imageHash ?? 'unknown',
		extractedPanels: panels,
		panelAnalyses: analyses,
		analysisCacheByHash,
		warnings,
	});

	// ─── Stage 2: Story Continuity ────────────────────────────────────────────
	const readingOrder = panels[0]?.metadata.readingOrder ?? 'rtl';
	const continuityResult = runStoryContinuityEngine({
		chapterId,
		analyses,
		readingOrder,
		minBeatConfidence,
	});
	warnings.push(...continuityResult.warnings);

	// ─── Stage 3: Contextual Research (optional) ─────────────────────────────
	let contextualResearchResult: ContextualResearchResult | undefined;

	if (research) {
		try {
			const researchOptions: import('./recap-types.js').ContextualResearchOptions = {
				enabled: research.enabled,
				workTitle: research.workTitle,
				currentChapter: research.currentChapter,
				cwd: research.cwd,
			};
			if (research.maxAllowedChapter !== undefined) researchOptions.maxAllowedChapter = research.maxAllowedChapter;
			if (research.allowTheories !== undefined) researchOptions.allowTheories = research.allowTheories;
			if (research.extraTerms !== undefined) researchOptions.extraTerms = research.extraTerms;
			if (research.signal !== undefined) researchOptions.signal = research.signal;
			// StoryEngineResearchPort is structurally compatible with ResearchPort
			contextualResearchResult = await runContextualResearch({
				port: research.port as import('./contextual-research.js').ResearchPort,
				options: researchOptions,
			});
			warnings.push(...contextualResearchResult.warnings);
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			warnings.push(`Contextual research failed: ${msg}. Continuing with panel-only evidence.`);
			contextualResearchResult = {
				accepted: [],
				rejected: [],
				totalRaw: 0,
				agentId: 'none',
				model: null,
				warnings: [`Contextual research error: ${msg}`],
				skipped: true,
			};
		}
	}

	// ─── Stage 4: Script Generation & Scene Mapping ───────────────────────────
	const scriptResult = runScriptGenerator({
		sequence: continuityResult.sequence,
		panels,
		style: scriptStyle,
		generatedBy,
	});
	warnings.push(...scriptResult.warnings);

	// ─── Stage 5: Gate G Initial — Narrative Fidelity ─────────────────────────
	const preHumanizeGateG = runGateGNarrativeFidelity({
		script: scriptResult.script,
		panels,
		minSceneConfidence: minBeatConfidence * 0.8,
	});

	// If initial Gate G fails and no humanize is configured, return early with failure
	if (preHumanizeGateG.verdict === 'fail' && !humanize?.enabled) {
		warnings.push('Gate G FAILED on initial script. No humanization configured to attempt recovery.');
		saveCheckpoint(checkpointDir, {
			chapterId,
			completedStages: ['import', 'extraction', 'narrative', 'fidelity'],
			lastUpdatedAtIso: new Date().toISOString(),
			sourceHash: panels[0]?.imageHash ?? 'unknown',
			extractedPanels: panels,
			warnings,
		});
		const earlyResult: StoryEngineResult = {
			script: scriptResult.script,
			gateGReport: preHumanizeGateG,
			sequence: continuityResult.sequence,
			analyses,
			warnings,
		};
		if (preHumanizeGateG) earlyResult.preHumanizeGateG = preHumanizeGateG;
		if (contextualResearchResult) earlyResult.contextualResearchResult = contextualResearchResult;
		return earlyResult;
	}

	// ─── Stage 6: Humanize (optional) ─────────────────────────────────────────
	let humanizeResult: HumanizeResult | undefined;
	let finalScript = scriptResult.script;
	let finalGateG = preHumanizeGateG;

	if (humanize?.enabled && humanize.port) {
		try {
			const humanizeOpts: import('./recap-types.js').HumanizeOptions & { port: import('./recap-types.js').TextEnhancementPort } = {
					enabled: humanize.enabled,
					style: humanize.style,
					port: humanize.port,
				};
				if (humanize.maxDurationDeviation !== undefined) humanizeOpts.maxDurationDeviation = humanize.maxDurationDeviation;
				if (humanize.wordBudgetPerScene !== undefined) humanizeOpts.wordBudgetPerScene = humanize.wordBudgetPerScene;
				if (humanize.signal !== undefined) humanizeOpts.signal = humanize.signal;
				humanizeResult = await runNarrativeHumanizer({
					script: scriptResult.script,
					panels,
					options: humanizeOpts,
				});
			warnings.push(...humanizeResult.warnings);
			finalScript = humanizeResult.script;
			finalGateG = humanizeResult.postHumanizeGateG;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			warnings.push(`Humanization failed: ${msg}. Using original script.`);
			// Keep original script and pre-humanize Gate G
		}
	} else if (!humanize?.enabled) {
		// Humanize disabled — run Gate G on original script as final
		finalGateG = preHumanizeGateG;
	}

	// ─── Stage 7: Final Gate G Validation ─────────────────────────────────────
	// Prevent automatic approval when Gate G is fail or needs_review
	if (finalGateG.verdict === 'fail') {
		warnings.push('FINAL Gate G FAILED. Script requires manual review before use.');
	} else if (finalGateG.verdict === 'needs_review') {
		warnings.push('FINAL Gate G requires REVIEW. Script should be inspected before use.');
	}

	// Save final checkpoint with fidelity results
	saveCheckpoint(checkpointDir, {
		chapterId,
		completedStages: ['import', 'extraction', 'narrative', 'fidelity'],
		lastUpdatedAtIso: new Date().toISOString(),
		sourceHash: panels[0]?.imageHash ?? 'unknown',
		extractedPanels: panels,
		panelAnalyses: analyses,
		analysisCacheByHash,
		warnings,
	});

	const finalResult: StoryEngineResult = {
		script: finalScript,
		gateGReport: finalGateG,
		sequence: continuityResult.sequence,
		analyses,
		warnings,
	};
	if (humanize?.enabled && preHumanizeGateG) {
		finalResult.preHumanizeGateG = preHumanizeGateG;
		finalResult.divergenceReport = buildGateGDivergenceReport(
			preHumanizeGateG,
			finalGateG,
			humanizeResult?.diffs ?? [],
		);
	}
	if (humanizeResult) finalResult.humanizeResult = humanizeResult;
	if (contextualResearchResult) finalResult.contextualResearchResult = contextualResearchResult;
	return finalResult;
}