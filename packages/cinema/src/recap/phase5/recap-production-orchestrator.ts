/**
 * Aethera Recap — Phases 5.1–5.3 & 7.3: Persistent State-Machine Production Orchestrator
 * & Standardized Release Bundle Exporter
 *
 * Connects preflight (circuit breakers), import, Gate F, Story Engine (Gate G + Humanize),
 * Phase 3 audiovisual render (Gate H), preview approval, and standardized project export
 * into an idempotent, crash-resumable state machine.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { ExtractedPanel, GateGReport, RecapScript, VisionAdapter } from '../recap-types.js';
import type { GateFReport } from '../gate-f-panel-integrity.js';
import type { GateHReport, RecapAudiovisualPlan, RecapTtsSynthesisPort, RecapVisualPlannerOptions } from '../phase3/recap-audiovisual-types.js';
import { renderRecapVideo } from '../phase3/recap-mp4-renderer.js';
import { checkRecapProductionReadiness, type ReadinessProviderProbe, type RecapProductionReadinessReport } from '../production-readiness.js';
import { AgentCircuitBreaker } from '../vision-circuit-breaker.js';
import { runStoryEngine } from '../story-engine.js';

export type RecapOrchestratorState =
	| 'idle'
	| 'preflight'
	| 'story_engine'
	| 'audiovisual_preview'
	| 'awaiting_preview_approval'
	| 'master_export'
	| 'completed'
	| 'paused_provider_unavailable'
	| 'failed';

export interface RecapOrchestratorRecord {
	schemaVersion: 1;
	runId: string;
	chapterId: string;
	workTitle: string;
	state: RecapOrchestratorState;
	completedSteps: string[];
	readiness?: RecapProductionReadinessReport;
	gateFVerdict?: GateFReport['verdict'];
	gateGVerdict?: GateGReport['verdict'];
	gateHVerdict?: GateHReport['verdict'];
	previewMp4Path?: string | null;
	masterMp4Path?: string | null;
	exportBundleDir?: string;
	lastError?: string;
	updatedAtIso: string;
}

const STATE_FILE = 'recap-orchestrator-state.json';

export function saveOrchestratorState(stateDir: string, record: RecapOrchestratorRecord): void {
	if (!existsSync(stateDir)) mkdirSync(stateDir, { recursive: true });
	const target = join(stateDir, STATE_FILE);
	const tmp = join(stateDir, `${STATE_FILE}.tmp.${process.pid}.${Date.now()}`);
	writeFileSync(tmp, JSON.stringify(record, null, 2), 'utf-8');
	renameSync(tmp, target);
}

export function loadOrchestratorState(stateDir: string): RecapOrchestratorRecord | null {
	const target = join(stateDir, STATE_FILE);
	if (!existsSync(target)) return null;
	try {
		return JSON.parse(readFileSync(target, 'utf-8')) as RecapOrchestratorRecord;
	} catch {
		return null;
	}
}

export interface RunRecapProductionOrchestratorInput {
	runId: string;
	chapterId: string;
	workTitle: string;
	panels: ExtractedPanel[];
	workspaceDir: string;
	providers: readonly ReadinessProviderProbe[];
	circuitBreaker?: AgentCircuitBreaker;
	visionAdapter?: VisionAdapter;
	/** Optional pre-approved script (allows running Phase 3 directly without LLM agents). */
	existingScript?: RecapScript;
	ttsPort?: RecapTtsSynthesisPort;
	sfxAssetsDir?: string;
	plannerOptions?: RecapVisualPlannerOptions;
	/** Set to true after reviewing preview to authorize master export. */
	masterApproved?: boolean;
	dryRunRender?: boolean;
}

export interface RunRecapProductionOrchestratorResult {
	record: RecapOrchestratorRecord;
	script?: RecapScript;
	plan?: RecapAudiovisualPlan;
	gateGReport?: GateGReport;
	gateHReport?: GateHReport;
}

export async function runRecapProductionOrchestrator(
	input: RunRecapProductionOrchestratorInput,
): Promise<RunRecapProductionOrchestratorResult> {
	const stateDir = join(input.workspaceDir, 'state');
	const checkpointDir = join(input.workspaceDir, 'checkpoints', input.chapterId);
	const renderDir = join(input.workspaceDir, 'render', input.chapterId);
	mkdirSync(stateDir, { recursive: true });
	mkdirSync(checkpointDir, { recursive: true });
	mkdirSync(renderDir, { recursive: true });

	const circuitBreaker = input.circuitBreaker ?? new AgentCircuitBreaker();
	const prev = loadOrchestratorState(stateDir);
	const completedSteps = new Set<string>(prev?.completedSteps ?? []);

	const persist = (state: RecapOrchestratorState, extra: Partial<RecapOrchestratorRecord> = {}): RecapOrchestratorRecord => {
		const rec: RecapOrchestratorRecord = {
			schemaVersion: 1,
			runId: input.runId,
			chapterId: input.chapterId,
			workTitle: input.workTitle,
			state,
			completedSteps: [...completedSteps],
			...(prev?.gateGVerdict ? { gateGVerdict: prev.gateGVerdict } : {}),
			...(prev?.gateHVerdict ? { gateHVerdict: prev.gateHVerdict } : {}),
			...(prev?.previewMp4Path ? { previewMp4Path: prev.previewMp4Path } : {}),
			...(prev?.masterMp4Path ? { masterMp4Path: prev.masterMp4Path } : {}),
			...extra,
			updatedAtIso: new Date().toISOString(),
		};
		saveOrchestratorState(stateDir, rec);
		return rec;
	};

	// ─── Step 1: Preflight (circuit breakers + checkpoint inspection) ─────────
	const readiness = await checkRecapProductionReadiness({
		providers: input.providers,
		circuitBreaker,
		checkpointDir,
		expectedTotalPanels: input.panels.length,
	});
	completedSteps.add('preflight');

	// If no existing script and no operational multimodal agent -> pause cleanly (never invent)
	let script = input.existingScript;
	let gateGReport: GateGReport | undefined;

	if (!script) {
		if (!readiness.ready) {
			const paused = persist('paused_provider_unavailable', {
				readiness,
				lastError: readiness.summaryMessage,
			});
			return { record: paused };
		}

		// ─── Step 2: Story Engine (resumes checkpoint idempotently) ───────────
		persist('story_engine', { readiness });
		const storyResult = await runStoryEngine({
			chapterId: input.chapterId,
			panels: input.panels,
			outputDir: join(input.workspaceDir, 'story'),
			checkpointDir,
			...(input.visionAdapter ? { visionAdapter: input.visionAdapter } : {}),
		});
		script = storyResult.script;
		gateGReport = storyResult.gateGReport;
		completedSteps.add('story_engine');
		if (gateGReport.verdict === 'fail') {
			const failed = persist('failed', {
				readiness,
				gateGVerdict: gateGReport.verdict,
				lastError: `Gate G falhou: ${gateGReport.reasons.join('; ')}`,
			});
			return { record: failed, script, gateGReport };
		}
	}

	// ─── Step 3: Phase 3 Audiovisual Preview Render ──────────────────────────
	persist('audiovisual_preview', {
		readiness,
		...(gateGReport ? { gateGVerdict: gateGReport.verdict } : {}),
	});

	const previewResult = await renderRecapVideo({
		script,
		panels: input.panels,
		outputDir: renderDir,
		checkpointDir: join(checkpointDir, 'phase3'),
		...(input.ttsPort ? { ttsPort: input.ttsPort } : {}),
		...(input.sfxAssetsDir ? { sfxAssetsDir: input.sfxAssetsDir } : {}),
		plannerOptions: { ...input.plannerOptions, renderTarget: 'preview' },
		...(input.dryRunRender ? { dryRunRender: true } : {}),
	});
	completedSteps.add('audiovisual_preview');

	if (previewResult.gateHReport.verdict === 'fail') {
		const failed = persist('failed', {
			readiness,
			gateHVerdict: previewResult.gateHReport.verdict,
			previewMp4Path: previewResult.mp4Path,
			lastError: `Gate H falhou na prévia: ${previewResult.gateHReport.reasons.join('; ')}`,
		});
		return { record: failed, script, plan: previewResult.plan, ...(gateGReport ? { gateGReport } : {}), gateHReport: previewResult.gateHReport };
	}

	// Human review gate before master export
	if (!input.masterApproved) {
		const awaiting = persist('awaiting_preview_approval', {
			readiness,
			...(gateGReport ? { gateGVerdict: gateGReport.verdict } : {}),
			gateHVerdict: previewResult.gateHReport.verdict,
			previewMp4Path: previewResult.mp4Path,
		});
		return { record: awaiting, script, plan: previewResult.plan, ...(gateGReport ? { gateGReport } : {}), gateHReport: previewResult.gateHReport };
	}

	// ─── Step 4: Master Export & Release Bundle (Phase 7.3) ──────────────────
	persist('master_export', { readiness, previewMp4Path: previewResult.mp4Path });
	const masterResult = await renderRecapVideo({
		script,
		panels: input.panels,
		outputDir: join(renderDir, 'master'),
		checkpointDir: join(checkpointDir, 'phase3-master'),
		...(input.ttsPort ? { ttsPort: input.ttsPort } : {}),
		...(input.sfxAssetsDir ? { sfxAssetsDir: input.sfxAssetsDir } : {}),
		plannerOptions: { ...input.plannerOptions, renderTarget: 'master' },
		masterApproved: true,
		...(input.dryRunRender ? { dryRunRender: true } : {}),
	});
	completedSteps.add('master_export');

	const bundleDir = exportRecapReleaseBundle({
		exportRoot: join(input.workspaceDir, 'exports'),
		workTitle: input.workTitle,
		chapterId: input.chapterId,
		version: 'v1',
		script,
		plan: masterResult.plan,
		gateHReport: masterResult.gateHReport,
		...(gateGReport ? { gateGReport } : {}),
		...(masterResult.mp4Path ? { mp4Path: masterResult.mp4Path } : {}),
		captionsPath: masterResult.captionsPath,
		thumbnailPanelPath: input.panels[0]?.croppedImagePath ?? input.panels[0]?.pagePath,
	});
	completedSteps.add('release_bundle');

	const completed = persist('completed', {
		readiness,
		...(gateGReport ? { gateGVerdict: gateGReport.verdict } : {}),
		gateHVerdict: masterResult.gateHReport.verdict,
		previewMp4Path: previewResult.mp4Path,
		masterMp4Path: masterResult.mp4Path,
		exportBundleDir: bundleDir,
	});

	return {
		record: completed,
		script,
		plan: masterResult.plan,
		...(gateGReport ? { gateGReport } : {}),
		gateHReport: masterResult.gateHReport,
	};
}

/**
 * Phase 7.3 — Standardized Project Export & Artifact Organization
 * Creates `<exportRoot>/<slug>/<version>/` with project.json, editable script,
 * audiovisual plan, captions, thumbnail, and MP4.
 */
export function exportRecapReleaseBundle(input: {
	exportRoot: string;
	workTitle: string;
	chapterId: string;
	version: string;
	script: RecapScript;
	plan: RecapAudiovisualPlan;
	gateGReport?: GateGReport;
	gateHReport: GateHReport;
	mp4Path?: string;
	captionsPath?: string;
	thumbnailPanelPath?: string;
}): string {
	const slug = `${input.workTitle}-${input.chapterId}`
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	const bundleDir = join(input.exportRoot, slug || 'recap-project', input.version);
	mkdirSync(bundleDir, { recursive: true });

	const scriptFile = join(bundleDir, 'recap-script.json');
	const planFile = join(bundleDir, 'recap-audiovisual-plan.json');
	const gateHFile = join(bundleDir, 'gate-h-report.json');
	writeFileSync(scriptFile, JSON.stringify(input.script, null, 2), 'utf-8');
	writeFileSync(planFile, JSON.stringify(input.plan, null, 2), 'utf-8');
	writeFileSync(gateHFile, JSON.stringify(input.gateHReport, null, 2), 'utf-8');

	let exportedMp4: string | null = null;
	if (input.mp4Path && existsSync(input.mp4Path)) {
		exportedMp4 = join(bundleDir, `${slug}-${input.version}.mp4`);
		copyFileSync(input.mp4Path, exportedMp4);
	}

	let exportedCaptions: string | null = null;
	if (input.captionsPath && existsSync(input.captionsPath)) {
		exportedCaptions = join(bundleDir, `${slug}-${input.version}.ass`);
		copyFileSync(input.captionsPath, exportedCaptions);
	}

	let exportedThumb: string | null = null;
	if (input.thumbnailPanelPath && existsSync(input.thumbnailPanelPath)) {
		exportedThumb = join(bundleDir, `thumbnail-${basename(input.thumbnailPanelPath)}`);
		copyFileSync(input.thumbnailPanelPath, exportedThumb);
	}

	const manifest = {
		schemaVersion: 1,
		workTitle: input.workTitle,
		chapterId: input.chapterId,
		version: input.version,
		approvalStatus: input.plan.approvalStatus,
		isSyntheticFixture: input.plan.isSyntheticFixture,
		aspectRatio: input.plan.aspectRatio,
		totalDurationMs: input.plan.totalDurationMs,
		gateGVerdict: input.gateGReport?.verdict ?? null,
		gateHVerdict: input.gateHReport.verdict,
		artifacts: {
			script: basename(scriptFile),
			plan: basename(planFile),
			gateH: basename(gateHFile),
			mp4: exportedMp4 ? basename(exportedMp4) : null,
			captions: exportedCaptions ? basename(exportedCaptions) : null,
			thumbnail: exportedThumb ? basename(exportedThumb) : null,
		},
		exportedAtIso: new Date().toISOString(),
	};
	writeFileSync(join(bundleDir, 'project.json'), JSON.stringify(manifest, null, 2), 'utf-8');
	return bundleDir;
}
