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
import type {
	ExtractedPanel,
	GateGReport,
	HumanizeOptions,
	RecapScript,
	ScriptStyle,
	TextEnhancementPort,
	VisionAdapter,
} from '../recap-types.js';
import { SCRIPT_STYLE_VALUES } from '../recap-types.js';
import type { GateFReport } from '../gate-f-panel-integrity.js';
import type { GateHReport, RecapAudiovisualPlan, RecapTtsSynthesisPort, RecapVisualPlannerOptions } from '../phase3/recap-audiovisual-types.js';
import { renderRecapVideo } from '../phase3/recap-mp4-renderer.js';
import { checkRecapProductionReadiness, type ReadinessProviderProbe, type RecapProductionReadinessReport } from '../production-readiness.js';
import { AgentCircuitBreaker } from '../vision-circuit-breaker.js';
import { runStoryEngine } from '../story-engine.js';

import type { MotionVelixRenderReport } from '../phase3/recap-motionvelix.js';
import { getRecapProjectDir, saveRecapProjectRecord, type RecapProjectArtifacts } from './recap-project-store.js';

export type RecapOrchestratorState =
	| 'idle'
	| 'importing'
	| 'preflight'
	| 'story_engine'
	| 'audiovisual_preview'
	| 'awaiting_preview_approval'
	| 'master_export'
	| 'completed'
	| 'paused_provider_unavailable'
	| 'failed';

export type RecapPipelineStageId =
	| 'import'
	| 'gate-f'
	| 'vision'
	| 'continuity'
	| 'script'
	| 'humanize'
	| 'motion'
	| 'gate-h';

export interface RecapOrchestratorProgressEvent {
	runId: string;
	chapterId: string;
	workTitle: string;
	state: RecapOrchestratorState;
	currentStage: RecapPipelineStageId | null;
	completedSteps: string[];
	message: string;
	record: RecapOrchestratorRecord;
	updatedAtIso: string;
}

export interface RecapOrchestratorRecord {
	schemaVersion: 1;
	runId: string;
	chapterId: string;
	workTitle: string;
	archivePath?: string;
	language?: string;
	scriptStyle?: string;
	aspectRatio?: '16:9' | '9:16';
	ttsProvider?: string;
	humorVolume?: number;
	enableOcr?: boolean;
	panelCount?: number;
	sceneCount?: number;
	shotCount?: number;
	totalDurationMs?: number;
	state: RecapOrchestratorState;
	currentStage?: RecapPipelineStageId | null;
	completedSteps: string[];
	readiness?: RecapProductionReadinessReport;
	gateFVerdict?: GateFReport['verdict'];
	gateGVerdict?: GateGReport['verdict'];
	gateHVerdict?: GateHReport['verdict'];
	motionVelix?: MotionVelixRenderReport;
	previewMp4Path?: string | null;
	masterMp4Path?: string | null;
	exportBundleDir?: string;
	lastError?: string;
	createdAtIso?: string;
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
	/** Optional LLM port for rich narrative script generation. */
	scriptPort?: TextEnhancementPort;
	/** Optional humanization pass after valid factual script generation. */
	humanize?: HumanizeOptions & { port: TextEnhancementPort };
	/** Optional pre-approved script (allows running Phase 3 directly without LLM agents). */
	existingScript?: RecapScript;
	ttsPort?: RecapTtsSynthesisPort;
	sfxAssetsDir?: string;
	plannerOptions?: RecapVisualPlannerOptions;
	/** Set to true after reviewing preview to authorize master export. */
	masterApproved?: boolean;
	dryRunRender?: boolean;
	/** Project metadata persisted for recent projects listing & resume. */
	archivePath?: string;
	language?: string;
	scriptStyle?: string;
	ttsProvider?: string;
	humorVolume?: number;
	enableOcr?: boolean;
	gateFVerdict?: GateFReport['verdict'];
	initialCompletedSteps?: readonly string[];
	onProgress?: (event: RecapOrchestratorProgressEvent) => void;
}

export interface RunRecapProductionOrchestratorResult {
	record: RecapOrchestratorRecord;
	script?: RecapScript;
	plan?: RecapAudiovisualPlan;
	gateGReport?: GateGReport;
	gateHReport?: GateHReport;
	motionVelix?: MotionVelixRenderReport;
}

export async function runRecapProductionOrchestrator(
	input: RunRecapProductionOrchestratorInput,
): Promise<RunRecapProductionOrchestratorResult> {
	const projectDir = getRecapProjectDir(input.workspaceDir, input.runId);
	const checkpointDir = join(input.workspaceDir, 'checkpoints', input.chapterId);
	const renderDir = join(input.workspaceDir, 'render', input.chapterId);
	mkdirSync(projectDir, { recursive: true });
	mkdirSync(checkpointDir, { recursive: true });
	mkdirSync(renderDir, { recursive: true });

	const circuitBreaker = input.circuitBreaker ?? new AgentCircuitBreaker();
	// Only reuse previous orchestrator state if it belongs to THIS exact runId
	const prevSameRun = loadOrchestratorState(projectDir);
	const prev = prevSameRun && prevSameRun.runId === input.runId ? prevSameRun : null;
	const createdAtIso = prev?.createdAtIso ?? new Date().toISOString();
	const completedSteps = new Set<string>([
		...(prev?.completedSteps ?? []),
		...(input.initialCompletedSteps ?? []),
	]);

	let latestRecord: RecapOrchestratorRecord | null = prev;

	const persist = (
		state: RecapOrchestratorState,
		currentStage: RecapPipelineStageId | null,
		message: string,
		extra: Partial<RecapOrchestratorRecord> = {},
		artifacts?: RecapProjectArtifacts,
	): RecapOrchestratorRecord => {
		const updatedAtIso = new Date().toISOString();
		const base = latestRecord;
		const rec: RecapOrchestratorRecord = {
			schemaVersion: 1,
			runId: input.runId,
			chapterId: input.chapterId,
			workTitle: input.workTitle,
			...(input.archivePath ?? base?.archivePath ? { archivePath: input.archivePath ?? base?.archivePath } : {}),
			...(input.language ?? base?.language ? { language: input.language ?? base?.language } : {}),
			...(input.scriptStyle ?? base?.scriptStyle ? { scriptStyle: input.scriptStyle ?? base?.scriptStyle } : {}),
			...(input.plannerOptions?.aspectRatio ?? base?.aspectRatio
				? { aspectRatio: input.plannerOptions?.aspectRatio ?? base?.aspectRatio }
				: {}),
			...(input.ttsProvider ?? base?.ttsProvider ? { ttsProvider: input.ttsProvider ?? base?.ttsProvider } : {}),
			...(input.humorVolume !== undefined
				? { humorVolume: input.humorVolume }
				: base?.humorVolume !== undefined
					? { humorVolume: base.humorVolume }
					: {}),
			...(input.enableOcr !== undefined
				? { enableOcr: input.enableOcr }
				: base?.enableOcr !== undefined
					? { enableOcr: base.enableOcr }
					: {}),
			panelCount: input.panels.length,
			...(base?.sceneCount !== undefined ? { sceneCount: base.sceneCount } : {}),
			...(base?.shotCount !== undefined ? { shotCount: base.shotCount } : {}),
			...(base?.totalDurationMs !== undefined ? { totalDurationMs: base.totalDurationMs } : {}),
			state,
			currentStage,
			completedSteps: [...completedSteps],
			...(input.gateFVerdict ?? base?.gateFVerdict ? { gateFVerdict: input.gateFVerdict ?? base?.gateFVerdict } : {}),
			...(base?.gateGVerdict ? { gateGVerdict: base.gateGVerdict } : {}),
			...(base?.gateHVerdict ? { gateHVerdict: base.gateHVerdict } : {}),
			...(base?.motionVelix ? { motionVelix: base.motionVelix } : {}),
			...(base?.previewMp4Path ? { previewMp4Path: base.previewMp4Path } : {}),
			...(base?.masterMp4Path ? { masterMp4Path: base.masterMp4Path } : {}),
			...(base?.exportBundleDir ? { exportBundleDir: base.exportBundleDir } : {}),
			...extra,
			createdAtIso,
			updatedAtIso,
		};
		saveRecapProjectRecord(input.workspaceDir, rec, artifacts);
		latestRecord = rec;
		input.onProgress?.({
			runId: rec.runId,
			chapterId: rec.chapterId,
			workTitle: rec.workTitle,
			state: rec.state,
			currentStage: rec.currentStage ?? null,
			completedSteps: rec.completedSteps,
			message,
			record: rec,
			updatedAtIso,
		});
		return rec;
	};

	// ─── Step 1: Preflight (circuit breakers + checkpoint inspection) ─────────
	persist('preflight', 'vision', 'Verificando provedores multimodais e checkpoints…');
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
			const paused = persist('paused_provider_unavailable', 'vision', readiness.summaryMessage, {
				readiness,
				lastError: readiness.summaryMessage,
			});
			return { record: paused };
		}

		// ─── Step 2: Story Engine (resumes checkpoint idempotently) ───────────
		persist('story_engine', 'vision', 'Analisando painéis, continuidade e gerando roteiro…', { readiness });
		try {
			const resolvedStyle: ScriptStyle =
				input.scriptStyle && (SCRIPT_STYLE_VALUES as readonly string[]).includes(input.scriptStyle)
					? (input.scriptStyle as ScriptStyle)
					: 'narrative_recap';
			const storyResult = await runStoryEngine({
				chapterId: input.chapterId,
				panels: input.panels,
				outputDir: join(input.workspaceDir, 'story'),
				checkpointDir,
				scriptStyle: resolvedStyle,
				workTitle: input.workTitle,
				...(input.language ? { language: input.language } : {}),
				...(input.humorVolume !== undefined ? { humorVolume: input.humorVolume } : {}),
				...(input.visionAdapter ? { visionAdapter: input.visionAdapter } : {}),
				...(input.scriptPort ? { scriptPort: input.scriptPort } : {}),
				...(input.humanize ? { humanize: input.humanize } : {}),
			});
			script = storyResult.script;
			gateGReport = storyResult.gateGReport;
			completedSteps.add('vision');
			completedSteps.add('continuity');
			completedSteps.add('script');
			if (storyResult.humanizeResult) {
				completedSteps.add('humanize');
			}
			completedSteps.add('story_engine');
			if (gateGReport.verdict === 'fail') {
				const errMsg = `Gate G falhou: ${gateGReport.reasons.join('; ')}`;
				const failed = persist(
					'failed',
					'script',
					errMsg,
					{
						readiness,
						sceneCount: script.scenes.length,
						gateGVerdict: gateGReport.verdict,
						lastError: errMsg,
					},
					{ script, gateGReport },
				);
				return { record: failed, script, gateGReport };
			}
			persist(
				'story_engine',
				'humanize',
				`Roteiro concluído (${script.scenes.length} cenas) · Gate G: ${gateGReport.verdict}.`,
				{
					readiness,
					sceneCount: script.scenes.length,
					gateGVerdict: gateGReport.verdict,
				},
				{ script, gateGReport },
			);
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			const failed = persist('failed', 'vision', errMsg, {
				readiness,
				lastError: errMsg,
			});
			return { record: failed };
		}
	} else {
		completedSteps.add('vision');
		completedSteps.add('continuity');
		completedSteps.add('script');
		completedSteps.add('story_engine');
	}

	// ─── Step 3: Phase 3 Audiovisual Preview Render ──────────────────────────
	persist(
		'audiovisual_preview',
		'motion',
		'Sintetizando narração, planejando shots e renderizando com MotionVelix + FFmpeg…',
		{
			readiness,
			sceneCount: script.scenes.length,
			...(gateGReport ? { gateGVerdict: gateGReport.verdict } : {}),
		},
		{ script, ...(gateGReport ? { gateGReport } : {}) },
	);

	let previewResult: Awaited<ReturnType<typeof renderRecapVideo>>;
	try {
		previewResult = await renderRecapVideo({
			script,
			panels: input.panels,
			outputDir: renderDir,
			checkpointDir: join(checkpointDir, 'phase3'),
			...(input.ttsPort ? { ttsPort: input.ttsPort } : {}),
			...(input.sfxAssetsDir ? { sfxAssetsDir: input.sfxAssetsDir } : {}),
			plannerOptions: { ...input.plannerOptions, renderTarget: 'preview' },
			...(input.dryRunRender ? { dryRunRender: true } : {}),
		});
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		const failed = persist(
			'failed',
			'motion',
			errMsg,
			{
				readiness,
				sceneCount: script.scenes.length,
				lastError: errMsg,
			},
			{ script, ...(gateGReport ? { gateGReport } : {}) },
		);
		return { record: failed, script, ...(gateGReport ? { gateGReport } : {}) };
	}

	completedSteps.add('motion');
	completedSteps.add('audiovisual_preview');

	// Propagate real TTS measured durations back onto the script scenes (Phase 7)
	if (previewResult.plan.shots.length > 0) {
		const measuredMsByScene = new Map<string, number>();
		for (const shot of previewResult.plan.shots) {
			if (shot.durationMs > 0) {
				measuredMsByScene.set(shot.sceneId, (measuredMsByScene.get(shot.sceneId) ?? 0) + shot.durationMs);
			}
		}
		if (measuredMsByScene.size > 0) {
			script = {
				...script,
				scenes: script.scenes.map((sc) => {
					const measuredMs = measuredMsByScene.get(sc.sceneId);
					return measuredMs !== undefined
						? {
								...sc,
								measuredDurationSec: Math.round((measuredMs / 1000) * 10) / 10,
								durationSource: 'tts_measured' as const,
							}
						: sc;
				}),
			};
		}
	}

	if (previewResult.gateHReport.verdict === 'fail') {
		const errMsg = `Gate H falhou na prévia: ${previewResult.gateHReport.reasons.join('; ')}`;
		const failed = persist(
			'failed',
			'gate-h',
			errMsg,
			{
				readiness,
				sceneCount: script.scenes.length,
				shotCount: previewResult.plan.shots.length,
				totalDurationMs: previewResult.plan.totalDurationMs,
				gateHVerdict: previewResult.gateHReport.verdict,
				motionVelix: previewResult.motionVelix,
				previewMp4Path: previewResult.mp4Path,
				lastError: errMsg,
			},
			{
				script,
				plan: previewResult.plan,
				...(gateGReport ? { gateGReport } : {}),
				gateHReport: previewResult.gateHReport,
			},
		);
		return {
			record: failed,
			script,
			plan: previewResult.plan,
			...(gateGReport ? { gateGReport } : {}),
			gateHReport: previewResult.gateHReport,
			motionVelix: previewResult.motionVelix,
		};
	}

	completedSteps.add('gate-h');

	// Human review gate before master export
	if (!input.masterApproved) {
		const awaiting = persist(
			'awaiting_preview_approval',
			'gate-h',
			'Prévia pronta e auditada pelo Gate H. Aguardando aprovação para exportação master.',
			{
				readiness,
				sceneCount: script.scenes.length,
				shotCount: previewResult.plan.shots.length,
				totalDurationMs: previewResult.plan.totalDurationMs,
				...(gateGReport ? { gateGVerdict: gateGReport.verdict } : {}),
				gateHVerdict: previewResult.gateHReport.verdict,
				motionVelix: previewResult.motionVelix,
				previewMp4Path: previewResult.mp4Path,
				lastError: undefined,
			},
			{
				script,
				plan: previewResult.plan,
				...(gateGReport ? { gateGReport } : {}),
				gateHReport: previewResult.gateHReport,
			},
		);
		return {
			record: awaiting,
			script,
			plan: previewResult.plan,
			...(gateGReport ? { gateGReport } : {}),
			gateHReport: previewResult.gateHReport,
			motionVelix: previewResult.motionVelix,
		};
	}

	// ─── Step 4: Master Export & Release Bundle (Phase 7.3) ──────────────────
	persist('master_export', 'motion', 'Renderizando exportação Master e gerando pacote de entrega…', {
		readiness,
		previewMp4Path: previewResult.mp4Path,
	});
	let masterResult: Awaited<ReturnType<typeof renderRecapVideo>>;
	try {
		masterResult = await renderRecapVideo({
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
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		const failed = persist('failed', 'motion', errMsg, {
			readiness,
			previewMp4Path: previewResult.mp4Path,
			lastError: errMsg,
		});
		return { record: failed, script, plan: previewResult.plan, ...(gateGReport ? { gateGReport } : {}), gateHReport: previewResult.gateHReport };
	}
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
		...((input.panels[0]?.croppedImagePath ?? input.panels[0]?.pagePath) ? { thumbnailPanelPath: (input.panels[0]?.croppedImagePath ?? input.panels[0]?.pagePath)! } : {}),
	});
	completedSteps.add('release_bundle');

	const completed = persist(
		'completed',
		'gate-h',
		'Exportação master concluída e pacote de release salvo.',
		{
			readiness,
			sceneCount: script.scenes.length,
			shotCount: masterResult.plan.shots.length,
			totalDurationMs: masterResult.plan.totalDurationMs,
			...(gateGReport ? { gateGVerdict: gateGReport.verdict } : {}),
			gateHVerdict: masterResult.gateHReport.verdict,
			motionVelix: masterResult.motionVelix,
			previewMp4Path: previewResult.mp4Path,
			masterMp4Path: masterResult.mp4Path,
			exportBundleDir: bundleDir,
			lastError: undefined,
		},
		{
			script,
			plan: masterResult.plan,
			...(gateGReport ? { gateGReport } : {}),
			gateHReport: masterResult.gateHReport,
		},
	);

	return {
		record: completed,
		script,
		plan: masterResult.plan,
		...(gateGReport ? { gateGReport } : {}),
		gateHReport: masterResult.gateHReport,
		motionVelix: masterResult.motionVelix,
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
