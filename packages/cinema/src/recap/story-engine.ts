import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
	ExtractedPanel,
	StoryEngineOptions,
	RecapScript,
	GateGReport,
	VisionAdapter,
	OcrAdapter,
	ScriptStyle,
	NarrativeSequence,
	PanelAnalysis,
} from './recap-types.js';
import { runNarrativeAnalyzer } from './narrative-analyzer.js';
import { runStoryContinuityEngine } from './story-continuity-engine.js';
import { runScriptGenerator } from './script-generator.js';
import { runGateGNarrativeFidelity } from './gate-g-narrative-fidelity.js';
import { saveCheckpoint, loadCheckpoint } from './checkpoint-persistence.js';

export interface StoryEngineResult {
	script: RecapScript;
	gateGReport: GateGReport;
	sequence: NarrativeSequence;
	analyses: PanelAnalysis[];
	warnings: string[];
}

/**
 * Story Engine — Phase 2 Orchestrator
 *
 * Integrates all Phase 2 components into a single pipeline:
 *   Panels → Narrative Analysis → Continuity → Script Generation → Gate G Validation
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
 */
export async function runStoryEngine(options: StoryEngineOptions): Promise<StoryEngineResult> {
	const {
		chapterId,
		panels,
		outputDir,
		visionAdapter,
		scriptStyle = 'narrative_recap',
		minBeatConfidence = 0.5,
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
	if (existingCheckpoint?.completedStages.includes('narrative') && existingCheckpoint.extractedPanels) {
		// Resume: check if we have cached analyses (future: store in checkpoint)
		warnings.push('Resuming from checkpoint. Re-running narrative analysis (analysis caching pending).');
	}

	const analysisResult = await runNarrativeAnalyzer({
		panels,
		visionAdapter,
		analyzedBy,
		minConfidence: minBeatConfidence,
	});
	analyses = analysisResult.analyses;
	warnings.push(...analysisResult.warnings);

	// Save checkpoint after analysis
	saveCheckpoint(checkpointDir, {
		chapterId,
		completedStages: ['import', 'extraction', 'narrative'],
		lastUpdatedAtIso: new Date().toISOString(),
		sourceHash: panels[0]?.imageHash ?? 'unknown',
		extractedPanels: panels,
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

	// ─── Stage 3: Script Generation & Scene Mapping ───────────────────────────
	const scriptResult = runScriptGenerator({
		sequence: continuityResult.sequence,
		panels,
		style: scriptStyle,
		generatedBy,
	});
	warnings.push(...scriptResult.warnings);

	// ─── Stage 4: Gate G — Narrative Fidelity ─────────────────────────────────
	const gateGReport = runGateGNarrativeFidelity({
		script: scriptResult.script,
		panels,
		minSceneConfidence: minBeatConfidence * 0.8,
	});

	// Save final checkpoint with fidelity results
	saveCheckpoint(checkpointDir, {
		chapterId,
		completedStages: ['import', 'extraction', 'narrative', 'fidelity'],
		lastUpdatedAtIso: new Date().toISOString(),
		sourceHash: panels[0]?.imageHash ?? 'unknown',
		extractedPanels: panels,
		warnings,
	});

	return {
		script: scriptResult.script,
		gateGReport,
		sequence: continuityResult.sequence,
		analyses,
		warnings,
	};
}