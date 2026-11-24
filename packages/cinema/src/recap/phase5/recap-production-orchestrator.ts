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
	ReadingOrder,
	RecapScript,
	ScriptStyle,
	TextEnhancementPort,
	VisionAdapter,
	RecapPanelTriageOptions,
	RecapAnalysisSettings,
} from '../recap-types.js';
import type { RecapFidelityGateReport } from '../recap-fidelity-gate.js';
import { SCRIPT_STYLE_VALUES } from '../recap-types.js';
import { loadCheckpoint } from '../checkpoint-persistence.js';
import type { GateFReport } from '../gate-f-panel-integrity.js';
import type { GateHReport, RecapAudiovisualPlan, RecapTtsSynthesisPort, RecapVisualPlannerOptions } from '../phase3/recap-audiovisual-types.js';
import type { GateIReport, GateJReport } from '../phase3/recap-semantic-alignment.js';
import { renderRecapVideo } from '../phase3/recap-mp4-renderer.js';
import { checkRecapProductionReadiness, type ReadinessProviderProbe, type RecapProductionReadinessReport } from '../production-readiness.js';
import { AgentCircuitBreaker } from '../vision-circuit-breaker.js';
import { AllVisionProvidersUnavailableError } from '../vision-error-classifier.js';
import { formatVisionRoutingSummary } from '../recap-vision-adapter.js';
import { runStoryEngine } from '../story-engine.js';
import {
	RecapBudgetController,
	RecapBudgetExceededError,
	RecapUsageTelemetry,
	estimateRecapInputTokens,
	type RecapJobBudget,
	type RecapModelUsage,
	type RecapUsageStage,
} from './recap-usage-telemetry.js';

import type { MotionVelixRenderReport } from '../phase3/recap-motionvelix.js';
import { getRecapProjectDir, saveRecapProjectRecord, type RecapProjectArtifacts } from './recap-project-store.js';
import { isRecapJobInterruptedError } from './recap-production-job-manager.js';
import { buildRecapFidelityProgress, saveRecapFidelityProgress } from '../fidelity-progress.js';
import { buildRecapFidelityGateFromReviews, type RecapFidelityReviewLedger } from '../recap-fidelity-review-ledger.js';

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
	| 'paused_budget'
	| 'failed';

export type RecapPipelineStageId =
	| 'import'
	| 'gate-f'
	| 'vision'
	| 'continuity'
	| 'script'
	| 'humanize'
	| 'motion'
	| 'gate-h'
	| 'gate-i'
	| 'gate-j';

export interface RecapOrchestratorProgressEvent {
	runId: string;
	chapterId: string;
	workTitle: string;
	readingOrder?: ReadingOrder;
	state: RecapOrchestratorState;
	currentStage: RecapPipelineStageId | null;
	completedSteps: string[];
	message: string;
	record: RecapOrchestratorRecord;
	updatedAtIso: string;
}

export interface RecapVisionFailedProviderItem {
	providerId: string;
	code: string;
	reason: string;
	resetAtText?: string;
	fallbackTo?: string;
}

export interface RecapVisionLiveTelemetry {
	activeProvider: string | null;
	activeModel: string | null;
	priorityOrder?: string[];
	nextFallback?: string | null;
	completedPanels: number;
	totalPanels: number;
	currentPanelIndex?: number;
	failedProviders: RecapVisionFailedProviderItem[];
	fallbackActive: boolean;
	fallbackFrom?: string | null;
	canResumeFromCheckpoint: boolean;
	updatedAtIso: string;
}

export interface RecapOrchestratorRecord {
	schemaVersion: 1;
	runId: string;
	chapterId: string;
	workTitle: string;
	archivePath?: string;
	readingOrder?: ReadingOrder;
	language?: string;
	scriptStyle?: string;
	aspectRatio?: '16:9' | '9:16';
	ttsProvider?: string;
	humorVolume?: number;
	humanizeMode?: 'disabled' | 'flagged' | 'all';
	enableOcr?: boolean;
	analysisSettings?: RecapAnalysisSettings;
	/** Evidence-backed panel fidelity report used by strict Story Engine runs. */
	fidelityGate?: RecapFidelityGateReport;
	panelCount?: number;
	sceneCount?: number;
	shotCount?: number;
	totalDurationMs?: number;
	state: RecapOrchestratorState;
	currentStage?: RecapPipelineStageId | null;
	completedSteps: string[];
	readiness?: RecapProductionReadinessReport;
	visionTelemetry?: RecapVisionLiveTelemetry;
	gateFVerdict?: GateFReport['verdict'];
	gateGVerdict?: GateGReport['verdict'];
	gateHVerdict?: GateHReport['verdict'];
	gateIVerdict?: GateIReport['verdict'];
	gateJVerdict?: GateJReport['verdict'];
	motionVelix?: MotionVelixRenderReport;
	previewMp4Path?: string | null;
	masterMp4Path?: string | null;
	exportBundleDir?: string;
	lastError?: string;
	createdAtIso?: string;
	updatedAtIso: string;
	usage?: import('./recap-usage-telemetry.js').RecapUsageSummary;
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
	jobId?: string;
	chapterId: string;
	workTitle: string;
	panels: ExtractedPanel[];
	workspaceDir: string;
	providers: readonly ReadinessProviderProbe[];
	circuitBreaker?: AgentCircuitBreaker;
	visionAdapter?: VisionAdapter;
	/** Optional local/economic/premium routes selected by deterministic panel triage. */
	visionRoutes?: Partial<Record<'local' | 'economic' | 'premium', VisionAdapter>>;
	triage?: RecapPanelTriageOptions;
	compactNarrativeContext?: boolean;
	/** Optional LLM port for rich narrative script generation. */
	scriptPort?: TextEnhancementPort;
	/** Optional text-agent fallback used only when the generated script fails Gate G. */
	scriptFallbackPort?: TextEnhancementPort;
	/** Optional humanization pass after valid factual script generation. */
	humanize?: HumanizeOptions & { port: TextEnhancementPort };
	/** Optional pre-approved script (allows running Phase 3 directly without LLM agents). */
	existingScript?: RecapScript;
	ttsPort?: RecapTtsSynthesisPort;
	/** Stable provider/voice/model identity for invalidating audio checkpoints. */
	ttsCheckpointIdentity?: string;
	sfxAssetsDir?: string;
	plannerOptions?: RecapVisualPlannerOptions;
	/** Set to true after reviewing preview to authorize master export. */
	masterApproved?: boolean;
	dryRunRender?: boolean;
	/** Optional Story Memory series project ID and chapter number for cross-chapter continuity. */
	seriesProjectId?: string;
	chapterNumber?: number;
	/** Project metadata persisted for recent projects listing & resume. */
	archivePath?: string;
	readingOrder?: ReadingOrder;
	language?: string;
	scriptStyle?: string;
	ttsProvider?: string;
	humorVolume?: number;
	humanizeMode?: 'disabled' | 'flagged' | 'all';
	enableOcr?: boolean;
	analysisSettings?: RecapAnalysisSettings;
	/** Read-only, identity-validated historical analyses migrated into the productive cache. */
	historicalPanelAnalyses?: readonly import('../recap-types.js').PanelAnalysis[];
	historicalPanelImageHashes?: Readonly<Record<string, string>>;
	/** Optional independent fidelity evidence. Strict mode never infers approval from confidence. */
	panelFidelityGate?: {
		report: RecapFidelityGateReport;
		enforce?: boolean;
	};
	/** Runs independent evaluation/recovery only after visual analysis is available. */
	fidelityRecovery?: import('../recap-types.js').StoryEngineOptions['fidelityRecovery'];
	/**
	 * Independent per-panel review evidence (bound to crop SHA and analysis fingerprint).
	 * Used to build the strict fidelity gate after analysis when no explicit gate/recovery is supplied.
	 */
	fidelityReviewLedger?: RecapFidelityReviewLedger | null;
	gateFVerdict?: GateFReport['verdict'];
	initialCompletedSteps?: readonly string[];
	onProgress?: (event: RecapOrchestratorProgressEvent) => void;
	/**
	 * Cooperative job control. `checkpoint` is called only at safe points (before each fresh
	 * panel analysis and between stages) and throws RecapJobInterruptedError to pause/cancel.
	 * The interruption propagates to the caller; the record keeps its last persisted state.
	 */
	control?: { checkpoint(stage: string | null): void };
	/** Per-job AI budget. Missing limits remain unbounded and are reported as unknown. */
	budget?: RecapJobBudget;
}

export interface RunRecapProductionOrchestratorResult {
	record: RecapOrchestratorRecord;
	script?: RecapScript;
	plan?: RecapAudiovisualPlan;
	gateGReport?: GateGReport;
	gateHReport?: GateHReport;
	gateIReport?: GateIReport;
	gateJReport?: GateJReport;
	motionVelix?: MotionVelixRenderReport;
}

/** Keeps resume messaging truthful when the visual checkpoint is already complete. */
export function formatVisionProgressMessage(completedPanels: number, totalPanels: number, provider = 'VisionRouter'): string {
	const safeTotal = Math.max(0, totalPanels);
	const safeCompleted = Math.max(0, Math.min(completedPanels, safeTotal));
	if (safeTotal > 0 && safeCompleted >= safeTotal) {
		return `Análise visual concluída (${safeTotal}/${safeTotal}); continuando para o roteiro…`;
	}
	if (safeCompleted > 0) {
		return `Retomando análise visual do painel ${safeCompleted + 1}/${safeTotal} (${safeCompleted} em checkpoint)…`;
	}
	return `Analisando painéis (0/${safeTotal}) via ${provider}…`;
}

export type MandatoryRecapGateId = 'H' | 'I' | 'J';

export function getMandatoryRecapGateFailures(reports: ReadonlyArray<{
	gate: MandatoryRecapGateId;
	verdict: 'pass' | 'needs_review' | 'fail';
}>): MandatoryRecapGateId[] {
	return reports.filter((report) => report.verdict === 'fail').map((report) => report.gate);
}

export function hasMandatoryRecapGateReview(reports: ReadonlyArray<{
	gate: MandatoryRecapGateId;
	verdict: 'pass' | 'needs_review' | 'fail';
}>): boolean {
	return reports.some((report) => report.verdict === 'needs_review');
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
	const usageTelemetry = new RecapUsageTelemetry({
		workspaceDir: input.workspaceDir,
		runId: input.runId,
		chapterId: input.chapterId,
		...(input.jobId ? { jobId: input.jobId } : {}),
		...(input.budget ? { budget: input.budget } : {}),
	});
	usageTelemetry.beginExecution();
	const budgetController = new RecapBudgetController(input.budget, usageTelemetry);
	// Gate built from the independent review ledger once analyses exist (never from model confidence).
	let reviewGateReport: RecapFidelityGateReport | undefined;
	const reviewFidelityRecovery: RunRecapProductionOrchestratorInput['fidelityRecovery'] =
		input.fidelityReviewLedger && !input.fidelityRecovery && !input.panelFidelityGate
			? {
				run: async ({ panels, analyses }) => {
					const result = buildRecapFidelityGateFromReviews({ panels, analyses, ledger: input.fidelityReviewLedger ?? null });
					reviewGateReport = result.report;
					return { gateReport: result.report };
				},
			}
			: undefined;
	const effectiveFidelityRecovery = input.fidelityRecovery ?? reviewFidelityRecovery;

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
	let panelAnalysesForFidelity: import('../recap-types.js').PanelAnalysis[] = [];

	const persist = (
		state: RecapOrchestratorState,
		currentStage: RecapPipelineStageId | null,
		message: string,
		extra: Partial<RecapOrchestratorRecord> = {},
		artifacts?: RecapProjectArtifacts,
	): RecapOrchestratorRecord => {
		if (state === 'paused' || state === 'paused_budget' || state === 'paused_provider_unavailable' || state === 'failed' || state === 'completed' || state === 'awaiting_approval') {
			usageTelemetry.endExecution();
		}
		const updatedAtIso = new Date().toISOString();
		const base = latestRecord;
		const archivePath = input.archivePath ?? base?.archivePath;
		const readingOrder = input.readingOrder ?? base?.readingOrder;
		const language = input.language ?? base?.language;
		const scriptStyle = input.scriptStyle ?? base?.scriptStyle;
		const aspectRatio = input.plannerOptions?.aspectRatio ?? base?.aspectRatio;
		const ttsProvider = input.ttsProvider ?? base?.ttsProvider;
		const humanizeMode = input.humanizeMode ?? base?.humanizeMode;
		const analysisSettings = input.analysisSettings ?? base?.analysisSettings;
		const rec: RecapOrchestratorRecord = {
			schemaVersion: 1,
			runId: input.runId,
			chapterId: input.chapterId,
			workTitle: input.workTitle,
			...(archivePath ? { archivePath } : {}),
			...(readingOrder ? { readingOrder } : {}),
			...(language ? { language } : {}),
			...(scriptStyle ? { scriptStyle } : {}),
			...(aspectRatio ? { aspectRatio } : {}),
			...(ttsProvider ? { ttsProvider } : {}),
			...(humanizeMode ? { humanizeMode } : {}),
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
			...(analysisSettings ? { analysisSettings } : {}),
			...(input.panelFidelityGate?.report ? { fidelityGate: input.panelFidelityGate.report } : reviewGateReport ? { fidelityGate: reviewGateReport } : base?.fidelityGate ? { fidelityGate: base.fidelityGate } : {}),
			panelCount: input.panels.length,
			...(base?.sceneCount !== undefined ? { sceneCount: base.sceneCount } : {}),
			...(base?.shotCount !== undefined ? { shotCount: base.shotCount } : {}),
			...(base?.totalDurationMs !== undefined ? { totalDurationMs: base.totalDurationMs } : {}),
			state,
			currentStage,
			completedSteps: [...completedSteps],
			...(input.gateFVerdict ? { gateFVerdict: input.gateFVerdict } : base?.gateFVerdict ? { gateFVerdict: base.gateFVerdict } : {}),
			...(base?.gateGVerdict ? { gateGVerdict: base.gateGVerdict } : {}),
			...(base?.gateHVerdict ? { gateHVerdict: base.gateHVerdict } : {}),
			...(base?.gateIVerdict ? { gateIVerdict: base.gateIVerdict } : {}),
			...(base?.gateJVerdict ? { gateJVerdict: base.gateJVerdict } : {}),
			...(base?.visionTelemetry ? { visionTelemetry: base.visionTelemetry } : {}),
			usage: usageTelemetry.summary(),
			...(base?.motionVelix ? { motionVelix: base.motionVelix } : {}),
			...(base?.previewMp4Path ? { previewMp4Path: base.previewMp4Path } : {}),
			...(base?.masterMp4Path ? { masterMp4Path: base.masterMp4Path } : {}),
			...(base?.exportBundleDir ? { exportBundleDir: base.exportBundleDir } : {}),
			...extra,
			createdAtIso,
			updatedAtIso,
		};
		saveRecapFidelityProgress(projectDir, buildRecapFidelityProgress({
			panels: input.panels,
			analyses: panelAnalysesForFidelity,
			gateReport: input.panelFidelityGate?.report ?? reviewGateReport ?? base?.fidelityGate,
			updatedAtIso,
		}));
		saveRecapProjectRecord(input.workspaceDir, rec, artifacts);
		latestRecord = rec;
		input.onProgress?.({
			runId: rec.runId,
			chapterId: rec.chapterId,
			workTitle: rec.workTitle,
			...(rec.readingOrder ? { readingOrder: rec.readingOrder } : {}),
			state: rec.state,
			currentStage: rec.currentStage ?? null,
			completedSteps: rec.completedSteps,
			message,
			record: rec,
			updatedAtIso,
		});
		return rec;
	};

	const instrumentTextPort = (port: TextEnhancementPort, stage: RecapUsageStage): TextEnhancementPort => ({
		name: port.name,
		enhance: async (request) => {
			const startedAt = Date.now();
			const unitId = typeof request.context['sceneId'] === 'string' ? request.context['sceneId'] : undefined;
			let release: (() => void) | undefined;
			try {
				release = budgetController.beforeCall({
					stage,
					operation: 'text_enhancement',
					...(unitId ? { unitId } : {}),
					estimatedInputTokens: estimateRecapInputTokens({ text: request.text, context: request.context, systemPrompt: request.systemPrompt }),
				});
				const result = await port.enhance(request);
				usageTelemetry.record({
					stage,
					operation: 'text_enhancement',
					...(unitId ? { unitId } : {}),
					cacheStatus: 'not_applicable',
					status: result.ok ? 'completed' : 'failed',
					attempt: 1,
					provider: result.agentId,
					model: result.model,
					...(result.usage ?? {}),
					durationMs: Date.now() - startedAt,
					...(result.ok ? {} : { errorCode: 'TEXT_ENHANCEMENT_FAILED', ...(result.error ? { errorMessage: result.error.slice(0, 240) } : {}) }),
				});
				return result;
			} catch (err) {
				if (err instanceof RecapBudgetExceededError) {
					usageTelemetry.record({
						stage,
						operation: 'text_enhancement',
						...(unitId ? { unitId } : {}),
						cacheStatus: 'not_applicable',
						status: 'blocked',
						attempt: 1,
						errorCode: err.code,
						errorMessage: err.reason,
						durationMs: Date.now() - startedAt,
					});
				} else {
					usageTelemetry.record({
						stage,
						operation: 'text_enhancement',
						...(unitId ? { unitId } : {}),
						cacheStatus: 'not_applicable',
						status: 'failed',
						attempt: 1,
						provider: port.name,
						model: null,
						errorCode: 'TEXT_ENHANCEMENT_ERROR',
						errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 240),
						durationMs: Date.now() - startedAt,
					});
				}
				throw err;
			} finally {
				release?.();
			}
		},
	});

	const instrumentTtsPort = (port: RecapTtsSynthesisPort): RecapTtsSynthesisPort => {
		const run = async <T extends { provider?: string; modelId?: string }>(
			operation: string,
			unitId: string,
			request: unknown,
			invoke: () => Promise<T>,
		): Promise<T> => {
			const startedAt = Date.now();
			let release: (() => void) | undefined;
			try {
				release = budgetController.beforeCall({
					stage: 'tts',
					operation,
					unitId,
					estimatedInputTokens: estimateRecapInputTokens(request),
				});
				const result = await invoke();
				const observable = result as T & { usage?: RecapModelUsage };
				usageTelemetry.record({
					stage: 'tts',
					operation,
					unitId,
					cacheStatus: 'not_applicable',
					status: 'completed',
					attempt: 1,
					provider: result.provider ?? port.name,
					model: result.modelId ?? null,
					...(observable.usage ?? {}),
					durationMs: Date.now() - startedAt,
				});
				return result;
			} catch (err) {
				usageTelemetry.record({
					stage: 'tts',
					operation,
					unitId,
					cacheStatus: 'not_applicable',
					status: err instanceof RecapBudgetExceededError ? 'blocked' : 'failed',
					attempt: 1,
					provider: port.name,
					model: null,
					errorCode: err instanceof RecapBudgetExceededError ? err.code : 'TTS_FAILED',
					errorMessage: (err instanceof RecapBudgetExceededError ? err.reason : err instanceof Error ? err.message : String(err)).slice(0, 240),
					durationMs: Date.now() - startedAt,
				});
				throw err;
			} finally {
				release?.();
			}
		};

		return {
			name: port.name,
			synthesizeScene: (request) => run('scene_tts', request.sceneId, request, () => port.synthesizeScene(request)),
			...(port.synthesizeContinuous
				? {
						synthesizeContinuous: (request: Parameters<NonNullable<RecapTtsSynthesisPort['synthesizeContinuous']>>[0]) =>
							run('continuous_tts', request.chapterId, request, () => port.synthesizeContinuous!(request)),
				  }
				: {}),
		};
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
	let panelAnalyses: import('../recap-types.js').PanelAnalysis[] | undefined;

	const priorityOrder = input.providers.map((p) => p.id);
	const resolveNextFallback = (
		activeProvider: string | null,
		failedProviders: readonly RecapVisionFailedProviderItem[],
	): string | null => {
		const failedIds = new Set(failedProviders.map((f) => f.providerId));
		const startIdx = activeProvider ? priorityOrder.indexOf(activeProvider) + 1 : 0;
		for (let i = Math.max(0, startIdx); i < priorityOrder.length; i += 1) {
			const candidate = priorityOrder[i]!;
			if (candidate !== activeProvider && !failedIds.has(candidate) && circuitBreaker.isAvailable(candidate)) {
				return candidate;
			}
		}
		return null;
	};

	if (!script) {
		if (!readiness.ready) {
			const failedProviders: RecapVisionFailedProviderItem[] = readiness.providers
				.filter((p) => p.status !== 'available')
				.map((p) => ({
					providerId: p.providerId,
					code: p.code ?? 'PROVIDER_UNAVAILABLE',
					reason: p.reason ?? 'Indisponível',
					...(p.resetAtText ? { resetAtText: p.resetAtText } : {}),
				}));
			const paused = persist('paused_provider_unavailable', 'vision', readiness.summaryMessage, {
				readiness,
				visionTelemetry: {
					activeProvider: null,
					activeModel: null,
					priorityOrder,
					nextFallback: null,
					completedPanels: readiness.checkpoint.completedPanels,
					totalPanels: input.panels.length,
					failedProviders,
					fallbackActive: false,
					fallbackFrom: failedProviders[0]?.providerId ?? null,
					canResumeFromCheckpoint: readiness.checkpoint.canResume,
					updatedAtIso: new Date().toISOString(),
				},
				lastError: readiness.summaryMessage,
			});
			return { record: paused };
		}

		// ─── Step 2: Story Engine (resumes checkpoint idempotently) ───────────
		let liveCompletedPanels = readiness.checkpoint.completedPanels;
		const totalPanelsCount = input.panels.length;

		const buildFailedProvidersSnapshot = (
			traceAttempts?: readonly { provider: string; outcome: string; detail?: string }[],
		): RecapVisionFailedProviderItem[] => {
			const map = new Map<string, RecapVisionFailedProviderItem>();
			for (const cb of circuitBreaker.getSnapshot()) {
				if (cb.state === 'open' || cb.failureCount > 0) {
					map.set(cb.providerId, {
						providerId: cb.providerId,
						code: cb.code ?? 'PROVIDER_UNAVAILABLE',
						reason: cb.reason ?? 'Indisponível',
						...(cb.resetAtText ? { resetAtText: cb.resetAtText } : {}),
					});
				}
			}
			if (traceAttempts && traceAttempts.length > 0) {
				const summary = formatVisionRoutingSummary(traceAttempts, circuitBreaker);
				for (const item of summary) {
					if (item.outcome !== 'ok' && item.outcome !== 'cached') {
						const existing = map.get(item.provider);
						map.set(item.provider, {
							providerId: item.provider,
							code: item.code ?? existing?.code ?? 'PROVIDER_UNAVAILABLE',
							reason: item.reason ?? existing?.reason ?? 'Falha na análise visual',
							...(existing?.resetAtText ? { resetAtText: existing.resetAtText } : {}),
							...(item.fallbackTo ? { fallbackTo: item.fallbackTo } : {}),
						});
					}
				}
			}
			return [...map.values()];
		};

		const initialFailed = buildFailedProvidersSnapshot();
		const initialActive = readiness.operationalProviders[0] ?? null;
		const initialTelemetry: RecapVisionLiveTelemetry = {
			activeProvider: initialActive,
			activeModel: null,
			priorityOrder,
			nextFallback: resolveNextFallback(initialActive, initialFailed),
			completedPanels: liveCompletedPanels,
			totalPanels: totalPanelsCount,
			failedProviders: initialFailed,
			fallbackActive: initialFailed.length > 0 && readiness.operationalProviders.length > 0,
			fallbackFrom: initialFailed[0]?.providerId ?? null,
			canResumeFromCheckpoint: readiness.checkpoint.canResume,
			updatedAtIso: new Date().toISOString(),
		};

		const visionCheckpointComplete = totalPanelsCount > 0 && liveCompletedPanels >= totalPanelsCount;
		if (visionCheckpointComplete) completedSteps.add('vision');
		persist(
			'story_engine',
			visionCheckpointComplete ? 'continuity' : 'vision',
			formatVisionProgressMessage(liveCompletedPanels, totalPanelsCount, initialTelemetry.activeProvider ?? 'VisionRouter'),
			{ readiness, visionTelemetry: initialTelemetry },
		);

		type TraceableVisionAdapter = VisionAdapter & {
			getLastTrace?: () => {
				provider: string | null;
				model: string | null;
				reportedModel?: string | null;
				costUsd?: number;
				attempts: readonly { provider: string; outcome: string; detail?: string }[];
				usage?: import('../recap-types.js').VisionAnalysisResult['usage'];
				policyVersion?: string;
				routeTier?: 'local' | 'economic' | 'premium' | null;
				routeReason?: string | null;
				fallbackReason?: string | null;
				hostExecutor?: string | null;
				providerAttemptDetails?: readonly { provider: string; outcome: string; detail?: string; durationMs?: number }[];
			} | null;
		};

		const rawVisionAdapter = input.visionAdapter as TraceableVisionAdapter | undefined;
		const instrumentedVisionAdapter: VisionAdapter | undefined = rawVisionAdapter
			? {
					name: rawVisionAdapter.name,
					analyze: async (imagePathOrBuffer, context) => {
						// Every earlier panel is already in the incremental checkpoint: safe to stop here.
						input.control?.checkpoint('vision');
						const startedAt = Date.now();
						let release: (() => void) | undefined;
						try {
							release = budgetController.beforeCall({
								stage: 'vision',
								operation: 'panel_analysis',
								...(context?.panelIndex !== undefined ? { unitId: `panel-${context.panelIndex}` } : {}),
								estimatedInputTokens: estimateRecapInputTokens(context),
							});
							const res = await rawVisionAdapter.analyze(imagePathOrBuffer, context);
							const trace = rawVisionAdapter.getLastTrace?.() ?? null;
							const providerAttempts = res.deduped ? 0 : Math.max(1, trace?.attempts.filter((a) => a.outcome === 'ok' || a.outcome === 'error').length ?? 1);
							const retryCount = res.deduped ? 0 : Math.max(0, providerAttempts - 1);
							usageTelemetry.record({
								stage: 'vision',
								operation: 'panel_analysis',
								...(context?.panelIndex !== undefined ? { unitId: `panel-${context.panelIndex}` } : {}),
								...(context?.cacheKey ? { cacheKey: context.cacheKey } : {}),
								cacheStatus: res.deduped ? 'deduped' : (context?.cacheStatus ?? 'miss'),
								status: 'completed',
								attempt: 1,
								provider: trace?.provider ?? null,
								model: trace?.reportedModel ?? trace?.model ?? null,
								policyVersion: trace?.policyVersion ?? null,
								routeTier: trace?.routeTier ?? null,
								routeReason: trace?.routeReason ?? null,
								fallbackReason: trace?.fallbackReason ?? null,
								hostExecutor: trace?.hostExecutor ?? null,
								...(trace?.attempts ? { providerAttemptDetails: trace.attempts } : {}),
								providerAttempts,
								retryCount,
								...((trace?.costUsd ?? 0) > 0 ? { estimatedCostUsd: trace?.costUsd ?? 0 } : {}),
								...(res.usage ?? {}),
								durationMs: Date.now() - startedAt,
							});
							liveCompletedPanels = Math.min(totalPanelsCount, liveCompletedPanels + 1);
							const failedList = buildFailedProvidersSnapshot(trace?.attempts);
							const activeProvider = trace?.provider ?? readiness.operationalProviders[0] ?? null;
							const activeModel = trace?.reportedModel ?? trace?.model ?? null;
							const fallbackFrom = failedList.find((f) => f.providerId !== activeProvider)?.providerId ?? null;
							const visionTelemetry: RecapVisionLiveTelemetry = {
								activeProvider,
								activeModel,
								priorityOrder,
								nextFallback: resolveNextFallback(activeProvider, failedList),
								completedPanels: liveCompletedPanels,
								totalPanels: totalPanelsCount,
								...(context?.panelIndex !== undefined ? { currentPanelIndex: context.panelIndex + 1 } : {}),
								failedProviders: failedList,
								fallbackActive: Boolean(fallbackFrom && activeProvider),
								fallbackFrom,
								canResumeFromCheckpoint: liveCompletedPanels > 0 && liveCompletedPanels < totalPanelsCount,
								updatedAtIso: new Date().toISOString(),
							};
							const providerBadge = activeProvider
								? `${activeProvider}${activeModel ? ` (${activeModel})` : ''}`
								: 'VisionRouter';
							const fallbackNote =
								visionTelemetry.fallbackActive && fallbackFrom
									? ` · fallback de ${fallbackFrom}`
									: '';
							persist(
								'story_engine',
								'vision',
								`Painel ${liveCompletedPanels}/${totalPanelsCount} analisado via ${providerBadge}${fallbackNote}`,
								{ readiness, visionTelemetry },
							);
							return res;
						} catch (err) {
							if (err instanceof RecapBudgetExceededError) {
								usageTelemetry.record({
									stage: 'vision',
									operation: 'panel_analysis',
									...(context?.panelIndex !== undefined ? { unitId: `panel-${context.panelIndex}` } : {}),
									cacheStatus: 'not_applicable',
									status: 'blocked',
									attempt: 1,
									errorCode: err.code,
									errorMessage: err.reason,
									durationMs: Date.now() - startedAt,
								});
							} else {
								const trace = rawVisionAdapter.getLastTrace?.() ?? null;
								const providerAttempts = Math.max(1, trace?.attempts.filter((a) => a.outcome === 'ok' || a.outcome === 'error').length ?? 1);
								usageTelemetry.record({
									stage: 'vision',
									operation: 'panel_analysis',
									...(context?.panelIndex !== undefined ? { unitId: `panel-${context.panelIndex}` } : {}),
									...(context?.cacheKey ? { cacheKey: context.cacheKey } : {}),
									cacheStatus: context?.cacheStatus ?? 'miss',
									status: 'failed',
									attempt: 1,
									provider: trace?.provider ?? null,
									model: trace?.reportedModel ?? trace?.model ?? null,
								policyVersion: trace?.policyVersion ?? null,
								routeTier: trace?.routeTier ?? null,
								routeReason: trace?.routeReason ?? null,
								fallbackReason: trace?.fallbackReason ?? null,
								hostExecutor: trace?.hostExecutor ?? null,
								...(trace?.attempts ? { providerAttemptDetails: trace.attempts } : {}),
									providerAttempts,
									retryCount: Math.max(0, providerAttempts - 1),
									errorCode: err instanceof Error ? err.name : 'VISION_CALL_FAILED',
									errorMessage: (err instanceof Error ? err.message : String(err)).slice(0, 240),
									durationMs: Date.now() - startedAt,
								});
							}
							throw err;
						} finally {
							release?.();
						}
					},
				}
			: undefined;

		try {
			input.control?.checkpoint('vision');
			const resolvedStyle: ScriptStyle =
				input.scriptStyle && (SCRIPT_STYLE_VALUES as readonly string[]).includes(input.scriptStyle)
					? (input.scriptStyle as ScriptStyle)
					: 'natural_recap';
			const storyResult = await runStoryEngine({
				chapterId: input.chapterId,
				panels: input.panels,
				outputDir: join(input.workspaceDir, 'story'),
				checkpointDir,
				scriptStyle: resolvedStyle,
				workTitle: input.workTitle,
				...(input.language ? { language: input.language } : {}),
				...(input.humorVolume !== undefined ? { humorVolume: input.humorVolume } : {}),
				...(instrumentedVisionAdapter ? { visionAdapter: instrumentedVisionAdapter } : {}),
				...(input.visionRoutes ? { visionRoutes: input.visionRoutes } : {}),
				...(input.triage ? { triage: input.triage } : {}),
				...(input.compactNarrativeContext !== undefined ? { compactNarrativeContext: input.compactNarrativeContext } : {}),
				...(input.analysisSettings?.strictFidelity !== undefined ? { strictFidelity: input.analysisSettings.strictFidelity } : {}),
				...(input.historicalPanelAnalyses?.length
					? {
						historicalPanelAnalyses: input.historicalPanelAnalyses,
						...(input.historicalPanelImageHashes ? { historicalPanelImageHashes: input.historicalPanelImageHashes } : {}),
						allowHistoricalPanelCache: true,
					}
					: {}),
				...(input.panelFidelityGate ? { panelFidelityGate: input.panelFidelityGate } : {}),
				...(effectiveFidelityRecovery ? { fidelityRecovery: effectiveFidelityRecovery } : {}),
				...(input.scriptPort ? { scriptPort: instrumentTextPort(input.scriptPort, 'script') } : {}),
				...(input.scriptFallbackPort ? { scriptFallbackPort: instrumentTextPort(input.scriptFallbackPort, 'script') } : {}),
				...(input.humanize ? { humanize: { ...input.humanize, port: instrumentTextPort(input.humanize.port, 'humanize') } } : {}),
				onAnalysisEvent: (event) => {
					if (event.cacheStatus === 'hit') {
						usageTelemetry.record({
							stage: 'vision',
							operation: 'panel_analysis',
							unitId: event.panel.panelId,
							cacheKey: event.cacheKey,
							cacheStatus: 'hit',
							status: 'completed',
							attempt: 1,
							provider: null,
							model: null,
						});
					}
				},
				...(input.seriesProjectId && input.chapterNumber
					? {
							storyMemory: {
								workspaceDir: input.workspaceDir,
								projectId: input.seriesProjectId,
								chapterNumber: input.chapterNumber,
							},
						}
					: {}),
			});
			script = storyResult.script;
			gateGReport = storyResult.gateGReport;
			panelAnalyses = storyResult.analyses;
			panelAnalysesForFidelity = storyResult.analyses;
			completedSteps.add('vision');
			completedSteps.add('continuity');
			completedSteps.add('script');
			if (storyResult.humanizeResult) {
				completedSteps.add('humanize');
			}
			completedSteps.add('story_engine');
			const trace = rawVisionAdapter?.getLastTrace?.() ?? null;
			const finalFailed = buildFailedProvidersSnapshot(trace?.attempts);
			const finalProvider = trace?.provider ?? readiness.operationalProviders[0] ?? null;
			const finalModel = trace?.reportedModel ?? trace?.model ?? null;
			const finalFallbackFrom = finalFailed.find((f) => f.providerId !== finalProvider)?.providerId ?? null;
			const finalVisionTelemetry: RecapVisionLiveTelemetry = {
				activeProvider: finalProvider,
				activeModel: finalModel,
				priorityOrder,
				nextFallback: resolveNextFallback(finalProvider, finalFailed),
				completedPanels: totalPanelsCount,
				totalPanels: totalPanelsCount,
				failedProviders: finalFailed,
				fallbackActive: Boolean(finalFallbackFrom && finalProvider),
				fallbackFrom: finalFallbackFrom,
				canResumeFromCheckpoint: false,
				updatedAtIso: new Date().toISOString(),
			};
			if (gateGReport.verdict === 'fail') {
				const errMsg = `Gate G falhou: ${gateGReport.reasons.join('; ')}`;
				const failed = persist(
					'failed',
					'script',
					errMsg,
					{
						readiness,
						visionTelemetry: finalVisionTelemetry,
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
					visionTelemetry: finalVisionTelemetry,
					sceneCount: script.scenes.length,
					gateGVerdict: gateGReport.verdict,
				},
				{ script, gateGReport },
			);
		} catch (err) {
			if (isRecapJobInterruptedError(err)) throw err;
			const errMsg = err instanceof Error ? err.message : String(err);
			// The Story Engine throws before returning its analyses when a gate (strict fidelity,
			// budget, provider) stops it, so the incremental fidelity report would keep every panel
			// as "pending_analysis". The durable checkpoint is the source of truth for analysed panels.
			if (panelAnalysesForFidelity.length === 0) {
				const durable = loadCheckpoint(checkpointDir)?.panelAnalyses;
				if (Array.isArray(durable)) panelAnalysesForFidelity = durable as typeof panelAnalysesForFidelity;
			}
			if (err instanceof RecapBudgetExceededError) {
				const budgetStage: RecapPipelineStageId = err.stage === 'vision' ? 'vision' : err.stage === 'humanize' ? 'humanize' : err.stage === 'tts' ? 'motion' : 'script';
				const paused = persist('paused_budget', budgetStage, errMsg, {
					lastError: errMsg,
				});
				return { record: paused };
			}
			const postFailReadiness = await checkRecapProductionReadiness({
				providers: input.providers,
				circuitBreaker,
				checkpointDir,
				expectedTotalPanels: input.panels.length,
			});
			const trace = rawVisionAdapter?.getLastTrace?.() ?? null;
			const failedList = buildFailedProvidersSnapshot(trace?.attempts);
			if (err instanceof AllVisionProvidersUnavailableError) {
				for (const d of err.diagnostics) {
					if (!failedList.some((f) => f.providerId === d.providerId)) {
						failedList.push({
							providerId: d.providerId,
							code: d.code,
							reason: d.message,
							...(d.resetAtText ? { resetAtText: d.resetAtText } : {}),
						});
					}
				}
			}
			const visionTelemetry: RecapVisionLiveTelemetry = {
				activeProvider: null,
				activeModel: null,
				priorityOrder,
				nextFallback: null,
				completedPanels: postFailReadiness.checkpoint.completedPanels,
				totalPanels: totalPanelsCount,
				failedProviders: failedList,
				fallbackActive: false,
				fallbackFrom: failedList[0]?.providerId ?? null,
				canResumeFromCheckpoint: postFailReadiness.checkpoint.canResume,
				updatedAtIso: new Date().toISOString(),
			};
			const nextState: RecapOrchestratorState =
				err instanceof AllVisionProvidersUnavailableError && postFailReadiness.checkpoint.canResume
					? 'paused_provider_unavailable'
					: 'failed';
			const failed = persist(nextState, 'vision', errMsg, {
				readiness: postFailReadiness,
				visionTelemetry,
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
	input.control?.checkpoint('motion');
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
			...(panelAnalyses ? { analyses: panelAnalyses } : {}),
			outputDir: renderDir,
			checkpointDir: join(checkpointDir, 'phase3'),
			...(input.ttsPort ? { ttsPort: instrumentTtsPort(input.ttsPort) } : {}),
			...(input.ttsPort ? { ttsCheckpointIdentity: input.ttsCheckpointIdentity ?? input.ttsPort.name } : {}),
			...(input.sfxAssetsDir ? { sfxAssetsDir: input.sfxAssetsDir } : {}),
			plannerOptions: { ...input.plannerOptions, renderTarget: 'preview' },
			...(input.dryRunRender ? { dryRunRender: true } : {}),
		});
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		if (err instanceof RecapBudgetExceededError) {
			const paused = persist('paused_budget', 'motion', errMsg, {
				readiness,
				sceneCount: script.scenes.length,
				lastError: errMsg,
			}, { script, ...(gateGReport ? { gateGReport } : {}) });
			return { record: paused, script, ...(gateGReport ? { gateGReport } : {}) };
		}
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

	const previewGateReports = [
		{ gate: 'H' as const, report: previewResult.gateHReport },
		{ gate: 'I' as const, report: previewResult.gateIReport },
		{ gate: 'J' as const, report: previewResult.gateJReport },
	];
	const failedPreviewGates = getMandatoryRecapGateFailures(previewGateReports.map(({ gate, report }) => ({ gate, verdict: report.verdict })));
	const previewNeedsHumanReview = hasMandatoryRecapGateReview(previewGateReports.map(({ gate, report }) => ({ gate, verdict: report.verdict })));
	completedSteps.add('gate-h');
	completedSteps.add('gate-i');
	completedSteps.add('gate-j');

	if (failedPreviewGates.length > 0) {
		const failedReasons = previewGateReports
			.filter(({ gate }) => failedPreviewGates.includes(gate))
			.map(({ gate, report }) => `Gate ${gate}: ${report.reasons.join('; ')}`)
			.join(' | ');
		const errMsg = `Gates obrigatórios falharam na prévia: ${failedReasons}`;
		const failed = persist(
			'failed',
			failedPreviewGates[0] === 'I' ? 'gate-i' : failedPreviewGates[0] === 'J' ? 'gate-j' : 'gate-h',
			errMsg,
			{
				readiness,
				sceneCount: script.scenes.length,
				shotCount: previewResult.plan.shots.length,
				totalDurationMs: previewResult.plan.totalDurationMs,
				gateHVerdict: previewResult.gateHReport.verdict,
				gateIVerdict: previewResult.gateIReport.verdict,
				gateJVerdict: previewResult.gateJReport.verdict,
				motionVelix: previewResult.motionVelix,
				previewMp4Path: previewResult.mp4Path,
				lastError: errMsg,
			},
			{
				script,
				plan: previewResult.plan,
				...(gateGReport ? { gateGReport } : {}),
				gateHReport: previewResult.gateHReport,
				gateIReport: previewResult.gateIReport,
				gateJReport: previewResult.gateJReport,
			},
		);
		return {
			record: failed,
			script,
			plan: previewResult.plan,
			...(gateGReport ? { gateGReport } : {}),
			gateHReport: previewResult.gateHReport,
			gateIReport: previewResult.gateIReport,
			gateJReport: previewResult.gateJReport,
			motionVelix: previewResult.motionVelix,
		};
	}

	// Human review gate before master export
	if (!input.masterApproved) {
		const reviewMessage = previewNeedsHumanReview
			? 'Prévia exige revisão humana nos Gates H/I/J antes da aprovação master.'
			: 'Prévia aprovada tecnicamente pelos Gates H/I/J; aguardando aprovação explícita para exportação master.';
		const awaiting = persist(
			'awaiting_preview_approval',
			'gate-j',
			reviewMessage,
			{
				readiness,
				sceneCount: script.scenes.length,
				shotCount: previewResult.plan.shots.length,
				totalDurationMs: previewResult.plan.totalDurationMs,
				...(gateGReport ? { gateGVerdict: gateGReport.verdict } : {}),
				gateHVerdict: previewResult.gateHReport.verdict,
				gateIVerdict: previewResult.gateIReport.verdict,
				gateJVerdict: previewResult.gateJReport.verdict,
				motionVelix: previewResult.motionVelix,
				previewMp4Path: previewResult.mp4Path,
			},
			{
				script,
				plan: previewResult.plan,
				...(gateGReport ? { gateGReport } : {}),
				gateHReport: previewResult.gateHReport,
				gateIReport: previewResult.gateIReport,
				gateJReport: previewResult.gateJReport,
			},
		);
		return {
			record: awaiting,
			script,
			plan: previewResult.plan,
			...(gateGReport ? { gateGReport } : {}),
			gateHReport: previewResult.gateHReport,
			gateIReport: previewResult.gateIReport,
			gateJReport: previewResult.gateJReport,
			motionVelix: previewResult.motionVelix,
		};
	}

	// ─── Step 4: Master Export & Release Bundle (Phase 7.3) ──────────────────
	input.control?.checkpoint('master_export');
	persist('master_export', 'motion', 'Renderizando exportação Master e gerando pacote de entrega…', {
		readiness,
		previewMp4Path: previewResult.mp4Path,
	});
	let masterResult: Awaited<ReturnType<typeof renderRecapVideo>>;
	try {
		masterResult = await renderRecapVideo({
			script,
			panels: input.panels,
			...(panelAnalyses ? { analyses: panelAnalyses } : {}),
			outputDir: join(renderDir, 'master'),
			checkpointDir: join(checkpointDir, 'phase3-master'),
			...(input.ttsPort ? { ttsPort: instrumentTtsPort(input.ttsPort) } : {}),
			...(input.ttsPort ? { ttsCheckpointIdentity: input.ttsCheckpointIdentity ?? input.ttsPort.name } : {}),
			...(input.sfxAssetsDir ? { sfxAssetsDir: input.sfxAssetsDir } : {}),
			plannerOptions: { ...input.plannerOptions, renderTarget: 'master' },
			masterApproved: true,
			...(input.dryRunRender ? { dryRunRender: true } : {}),
		});
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		if (err instanceof RecapBudgetExceededError) {
			const paused = persist('paused_budget', 'motion', errMsg, {
				readiness,
				previewMp4Path: previewResult.mp4Path,
				lastError: errMsg,
			});
			return { record: paused, script, plan: previewResult.plan, ...(gateGReport ? { gateGReport } : {}), gateHReport: previewResult.gateHReport, gateIReport: previewResult.gateIReport, gateJReport: previewResult.gateJReport };
		}
		const failed = persist('failed', 'motion', errMsg, {
			readiness,
			previewMp4Path: previewResult.mp4Path,
			lastError: errMsg,
		});
		return {
			record: failed,
			script,
			plan: previewResult.plan,
			...(gateGReport ? { gateGReport } : {}),
			gateHReport: previewResult.gateHReport,
			gateIReport: previewResult.gateIReport,
			gateJReport: previewResult.gateJReport,
		};
	}
	completedSteps.add('master_export');

	const masterGateReports = [
		{ gate: 'H' as const, report: masterResult.gateHReport },
		{ gate: 'I' as const, report: masterResult.gateIReport },
		{ gate: 'J' as const, report: masterResult.gateJReport },
	];
	const failedMasterGates = getMandatoryRecapGateFailures(masterGateReports.map(({ gate, report }) => ({ gate, verdict: report.verdict })));
	if (failedMasterGates.length > 0) {
		const errMsg = `Gates obrigatórios falharam no master: ${masterGateReports
			.filter(({ gate }) => failedMasterGates.includes(gate))
			.map(({ gate, report }) => `Gate ${gate}: ${report.reasons.join('; ')}`)
			.join(' | ')}`;
		const failed = persist(
			'failed',
			failedMasterGates[0] === 'I' ? 'gate-i' : failedMasterGates[0] === 'J' ? 'gate-j' : 'gate-h',
			errMsg,
			{
				readiness,
				gateHVerdict: masterResult.gateHReport.verdict,
				gateIVerdict: masterResult.gateIReport.verdict,
				gateJVerdict: masterResult.gateJReport.verdict,
				masterMp4Path: masterResult.mp4Path,
				lastError: errMsg,
			},
			{
				script,
				plan: masterResult.plan,
				...(gateGReport ? { gateGReport } : {}),
				gateHReport: masterResult.gateHReport,
				gateIReport: masterResult.gateIReport,
				gateJReport: masterResult.gateJReport,
			},
		);
		return {
			record: failed,
			script,
			plan: masterResult.plan,
			...(gateGReport ? { gateGReport } : {}),
			gateHReport: masterResult.gateHReport,
			gateIReport: masterResult.gateIReport,
			gateJReport: masterResult.gateJReport,
			motionVelix: masterResult.motionVelix,
		};
	}

	const bundleDir = exportRecapReleaseBundle({
		exportRoot: join(input.workspaceDir, 'exports'),
		workTitle: input.workTitle,
		chapterId: input.chapterId,
		version: 'v1',
		script,
		plan: masterResult.plan,
		gateHReport: masterResult.gateHReport,
		gateIReport: masterResult.gateIReport,
		gateJReport: masterResult.gateJReport,
		...(gateGReport ? { gateGReport } : {}),
		...(masterResult.mp4Path ? { mp4Path: masterResult.mp4Path } : {}),
		captionsPath: masterResult.captionsPath,
		...((input.panels[0]?.croppedImagePath ?? input.panels[0]?.pagePath) ? { thumbnailPanelPath: (input.panels[0]?.croppedImagePath ?? input.panels[0]?.pagePath)! } : {}),
	});
	completedSteps.add('release_bundle');

	const completed = persist(
		'completed',
		'gate-j',
		'Exportação master concluída e pacote de release salvo.',
		{
			readiness,
			sceneCount: script.scenes.length,
			shotCount: masterResult.plan.shots.length,
			totalDurationMs: masterResult.plan.totalDurationMs,
			...(gateGReport ? { gateGVerdict: gateGReport.verdict } : {}),
			gateHVerdict: masterResult.gateHReport.verdict,
			gateIVerdict: masterResult.gateIReport.verdict,
			gateJVerdict: masterResult.gateJReport.verdict,
			motionVelix: masterResult.motionVelix,
			previewMp4Path: previewResult.mp4Path,
			masterMp4Path: masterResult.mp4Path,
			exportBundleDir: bundleDir,
		},
		{
			script,
			plan: masterResult.plan,
			...(gateGReport ? { gateGReport } : {}),
			gateHReport: masterResult.gateHReport,
			gateIReport: masterResult.gateIReport,
			gateJReport: masterResult.gateJReport,
		},
	);

	return {
		record: completed,
		script,
		plan: masterResult.plan,
		...(gateGReport ? { gateGReport } : {}),
		gateHReport: masterResult.gateHReport,
		gateIReport: masterResult.gateIReport,
		gateJReport: masterResult.gateJReport,
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
	gateIReport: GateIReport;
	gateJReport: GateJReport;
	mp4Path?: string;
	captionsPath?: string;
	thumbnailPanelPath?: string;
}): string {
	const failedGates = getMandatoryRecapGateFailures([
		{ gate: 'H', verdict: input.gateHReport.verdict },
		{ gate: 'I', verdict: input.gateIReport.verdict },
		{ gate: 'J', verdict: input.gateJReport.verdict },
	]);
	if (failedGates.length > 0) {
		throw new Error(`master_export_blocked_by_quality_gates: ${failedGates.join(', ')}`);
	}
	const slug = `${input.workTitle}-${input.chapterId}`
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
	const bundleDir = join(input.exportRoot, slug || 'recap-project', input.version);
	mkdirSync(bundleDir, { recursive: true });

	const scriptFile = join(bundleDir, 'recap-script.json');
	const planFile = join(bundleDir, 'recap-audiovisual-plan.json');
	const gateHFile = join(bundleDir, 'gate-h-report.json');
	const gateIFile = join(bundleDir, 'gate-i-report.json');
	const gateJFile = join(bundleDir, 'gate-j-report.json');
	writeFileSync(scriptFile, JSON.stringify(input.script, null, 2), 'utf-8');
	writeFileSync(planFile, JSON.stringify(input.plan, null, 2), 'utf-8');
	writeFileSync(gateHFile, JSON.stringify(input.gateHReport, null, 2), 'utf-8');
	writeFileSync(gateIFile, JSON.stringify(input.gateIReport, null, 2), 'utf-8');
	writeFileSync(gateJFile, JSON.stringify(input.gateJReport, null, 2), 'utf-8');

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
		gateIVerdict: input.gateIReport.verdict,
		gateJVerdict: input.gateJReport.verdict,
		artifacts: {
			script: basename(scriptFile),
			plan: basename(planFile),
			gateH: basename(gateHFile),
			gateI: basename(gateIFile),
			gateJ: basename(gateJFile),
			mp4: exportedMp4 ? basename(exportedMp4) : null,
			captions: exportedCaptions ? basename(exportedCaptions) : null,
			thumbnail: exportedThumb ? basename(exportedThumb) : null,
		},
		exportedAtIso: new Date().toISOString(),
	};
	writeFileSync(join(bundleDir, 'project.json'), JSON.stringify(manifest, null, 2), 'utf-8');
	return bundleDir;
}
