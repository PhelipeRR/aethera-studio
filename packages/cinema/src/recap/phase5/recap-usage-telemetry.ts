import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

export type RecapUsageStage = 'vision' | 'script' | 'humanize' | 'research' | 'tts' | 'other';
export type RecapUsageCacheStatus = 'miss' | 'hit' | 'deduped' | 'invalidated' | 'not_applicable';
export type RecapUsageStatus = 'completed' | 'failed' | 'blocked' | 'skipped';

export interface RecapCliQuotaWindow {
	id: string;
	utilization: number;
	resetsAt: string | null;
	status: string;
}

/** Provider-reported usage. Null means the provider did not expose that metric. */
export interface RecapModelUsage {
	inputTokens?: number | null;
	outputTokens?: number | null;
	cachedTokens?: number | null;
	cacheWriteTokens?: number | null;
	effectiveApiCostUsd?: number | null;
	estimatedCostUsd?: number | null;
	quotaUnits?: number | null;
	quotaKind?: string | null;
	cliQuotaWindows?: readonly RecapCliQuotaWindow[];
}

export interface RecapJobBudget {
	maxModelCalls?: number;
	maxInputTokens?: number;
	maxOutputTokens?: number;
	maxTotalTokens?: number;
	maxEffectiveApiCostUsd?: number;
	maxEstimatedCostUsd?: number;
	maxQuotaUnits?: number;
	maxRetries?: number;
	maxWallTimeMs?: number;
}

export interface RecapUsageEvent extends RecapModelUsage {
	schemaVersion: 1;
	eventId: string;
	runId: string;
	jobId?: string;
	chapterId: string;
	stage: RecapUsageStage;
	operation: string;
	unitId?: string;
	cacheKey?: string;
	cacheStatus: RecapUsageCacheStatus;
	status: RecapUsageStatus;
	attempt: number;
	provider?: string | null;
	model?: string | null;
	policyVersion?: string | null;
	routeTier?: 'local' | 'economic' | 'premium' | null;
	routeReason?: string | null;
	/** First provider failure/unavailability that caused fallback, when applicable. */
	fallbackReason?: string | null;
	hostExecutor?: string | null;
	providerAttempts?: number;
	/** Persisted per-provider attempt detail for a panel request; no prompt/image data. */
	providerAttemptDetails?: readonly { provider: string; outcome: string; detail?: string; durationMs?: number }[];
	retryCount?: number;
	durationMs?: number | null;
	errorCode?: string;
	errorMessage?: string;
	atIso: string;
}

export interface RecapUsageSummary {
	schemaVersion: 1;
	eventCount: number;
	modelCalls: number;
	cacheHits: number;
	cacheMisses: number;
	dedupedCalls: number;
	retryCalls: number;
	inputTokens: number | null;
	outputTokens: number | null;
	cachedTokens: number | null;
	cacheWriteTokens: number | null;
	effectiveApiCostUsd: number | null;
	estimatedCostUsd: number | null;
	quotaUnits: number | null;
	quotaEvents: number;
	cliQuotaSnapshots: number;
	lastCliQuotaWindows?: readonly RecapCliQuotaWindow[];
	budget?: RecapJobBudget;
	budgetStopReason?: string;
	lastEventAtIso?: string;
	/** Active orchestration time only; persisted pauses and app-closed gaps are excluded. */
	activeWallTimeMs?: number;
}

export interface RecapUsageTelemetryOptions {
	workspaceDir: string;
	runId: string;
	chapterId: string;
	jobId?: string;
	budget?: RecapJobBudget;
	now?: () => number;
}

export interface RecapBudgetReservationInput {
	stage: RecapUsageStage;
	operation: string;
	unitId?: string;
	estimatedInputTokens?: number;
	estimatedOutputTokens?: number;
	estimatedCostUsd?: number;
}

export class RecapBudgetExceededError extends Error {
	readonly code = 'RECAP_BUDGET_EXCEEDED';
	readonly stage: RecapUsageStage;
	readonly reason: string;
	constructor(stage: RecapUsageStage, reason: string) {
		super(`Orçamento do job atingido antes de nova chamada (${stage}): ${reason}`);
		this.name = 'RecapBudgetExceededError';
		this.stage = stage;
		this.reason = reason;
	}
}

function numeric(value: number | null | undefined): number | null {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function addNullable(total: number | null, value: number | null | undefined): number | null {
	const n = numeric(value);
	return n === null ? total : (total ?? 0) + n;
}

function safeRunId(runId: string): string {
	return runId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-|-$/g, '') || 'recap-run';
}

/** Persistent, prompt-free usage ledger. A telemetry failure never breaks video production. */
export class RecapUsageTelemetry {
	readonly filePath: string;
	private readonly events: RecapUsageEvent[];
	private readonly now: () => number;
	private readonly options: RecapUsageTelemetryOptions;
	private budgetStopReason: string | undefined;

	constructor(options: RecapUsageTelemetryOptions) {
		this.options = options;
		this.now = options.now ?? Date.now;
		this.filePath = join(options.workspaceDir, 'usage', 'recap', `${safeRunId(options.runId)}.jsonl`);
		this.events = this.readPersisted();
	}

	private readPersisted(): RecapUsageEvent[] {
		if (!existsSync(this.filePath)) return [];
		try {
			return readFileSync(this.filePath, 'utf-8')
				.split(/\r?\n/)
				.filter(Boolean)
				.map((line) => JSON.parse(line) as RecapUsageEvent)
				.filter((event) => event && event.schemaVersion === 1 && event.runId === this.options.runId);
		} catch {
			return [];
		}
	}

	getEvents(): readonly RecapUsageEvent[] {
		return [...this.events];
	}

	/** Original start time for this run, preserved across process restarts/resume. */
	startedAtMs(): number | null {
		const first = this.events[0]?.atIso;
		if (!first) return null;
		const parsed = Date.parse(first);
		return Number.isFinite(parsed) ? parsed : null;
	}

	/** Starts a persisted active-time segment. A prior open segment is closed at its last event,
	 * so time while the app is paused or closed is never charged to the job budget. */
	beginExecution(atMs = this.now()): void {
		const open = this.openExecutionStartedAtMs();
		if (open !== null) {
			const last = this.lastEventAtMs() ?? open;
			if (last >= open) this.record({ stage: 'other', operation: 'execution_ended', cacheStatus: 'not_applicable', status: 'skipped', attempt: 1, durationMs: last - open, atIso: new Date(last).toISOString() });
		}
		this.record({ stage: 'other', operation: 'execution_started', cacheStatus: 'not_applicable', status: 'skipped', attempt: 1, atIso: new Date(atMs).toISOString() });
	}

	/** Closes the current active segment exactly once when orchestration pauses or exits. */
	endExecution(atMs = this.now()): void {
		const open = this.openExecutionStartedAtMs();
		if (open === null) return;
		const endedAt = Math.max(open, atMs);
		this.record({ stage: 'other', operation: 'execution_ended', cacheStatus: 'not_applicable', status: 'skipped', attempt: 1, durationMs: endedAt - open, atIso: new Date(endedAt).toISOString() });
	}

	activeWallTimeMs(atMs = this.now()): number {
		let total = 0;
		let open: number | null = null;
		let lastWorkInSegment: number | null = null;
		let outsideSegmentsMs = 0;
		let hasExecutionMarkers = false;
		for (const event of this.events) {
			const timestamp = Date.parse(event.atIso);
			if (!Number.isFinite(timestamp)) continue;
			if (event.operation === 'execution_started') {
				hasExecutionMarkers = true;
				open = timestamp;
				lastWorkInSegment = null;
				continue;
			}
			if (event.operation === 'execution_ended') {
				hasExecutionMarkers = true;
				if (open !== null) {
					// A segment is active until its last recorded work. An end marker written
					// later (a repair, or a pause closed after the fact) must not charge the idle
					// gap: Fase 4B.11 recorded 503 s for a segment whose work ended after ~0.7 s.
					const end = lastWorkInSegment !== null ? Math.min(timestamp, lastWorkInSegment) : timestamp;
					if (end >= open) total += end - open;
				}
				open = null;
				lastWorkInSegment = null;
				continue;
			}
			if (open !== null && timestamp >= open) lastWorkInSegment = timestamp;
			// Work recorded outside any segment (ledgers that predate the markers) is charged by
			// its measured duration, so adding markers later never drops earlier inference time.
			else if (open === null) outsideSegmentsMs += Math.max(0, event.durationMs ?? 0);
		}
		if (open !== null && atMs >= open) total += atMs - open;
		if (!hasExecutionMarkers) {
			// Legacy ledgers predate execution markers. Charge only measured work
			// durations until the next persisted segment makes the accounting exact.
			return this.events.reduce((sum, event) => sum + Math.max(0, event.durationMs ?? 0), 0);
		}
		return total + outsideSegmentsMs;
	}

	/** Failed attempts for one unit since the current execution segment started (all, if none). */
	failuresInCurrentExecution(unitId: string): number {
		let start = 0;
		this.events.forEach((event, index) => { if (event.operation === 'execution_started') start = index; });
		return this.events.slice(start).filter((event) => event.unitId === unitId && event.status === 'failed').length;
	}

	private openExecutionStartedAtMs(): number | null {
		let open: number | null = null;
		for (const event of this.events) {
			if (event.operation === 'execution_started') open = Date.parse(event.atIso);
			if (event.operation === 'execution_ended') open = null;
		}
		return open !== null && Number.isFinite(open) ? open : null;
	}

	private lastEventAtMs(): number | null {
		const timestamp = this.events.at(-1)?.atIso;
		if (!timestamp) return null;
		const parsed = Date.parse(timestamp);
		return Number.isFinite(parsed) ? parsed : null;
	}

	setBudgetStopReason(reason: string): void {
		this.budgetStopReason = reason;
	}

	record(input: Omit<RecapUsageEvent, 'schemaVersion' | 'eventId' | 'runId' | 'chapterId' | 'atIso'> & { atIso?: string }): RecapUsageEvent {
		const event: RecapUsageEvent = {
			schemaVersion: 1,
			eventId: randomUUID(),
			runId: this.options.runId,
			chapterId: this.options.chapterId,
			...(this.options.jobId ? { jobId: this.options.jobId } : {}),
			...input,
			atIso: input.atIso ?? new Date(this.now()).toISOString(),
		};
		this.events.push(event);
		try {
			mkdirSync(join(this.options.workspaceDir, 'usage', 'recap'), { recursive: true });
			appendFileSync(this.filePath, `${JSON.stringify(event)}\n`, 'utf-8');
		} catch {
			// Usage accounting is best effort and must not make a valid recap fail.
		}
		return event;
	}

	summary(): RecapUsageSummary {
		let modelCalls = 0;
		let cacheHits = 0;
		let cacheMisses = 0;
		let dedupedCalls = 0;
		let retryCalls = 0;
		let inputTokens: number | null = null;
		let outputTokens: number | null = null;
		let cachedTokens: number | null = null;
		let cacheWriteTokens: number | null = null;
		let effectiveApiCostUsd: number | null = null;
		let estimatedCostUsd: number | null = null;
		let quotaUnits: number | null = null;
		let quotaEvents = 0;
		let cliQuotaSnapshots = 0;
		let lastCliQuotaWindows: readonly RecapCliQuotaWindow[] | undefined;
		for (const event of this.events) {
			if (event.cacheStatus === 'hit') cacheHits += 1;
			if (event.cacheStatus === 'deduped') dedupedCalls += 1;
			if (event.status !== 'blocked' && event.operation !== 'execution_started' && event.operation !== 'execution_ended' && (event.cacheStatus === 'miss' || event.cacheStatus === 'invalidated' || event.cacheStatus === 'not_applicable')) {
				if (event.cacheStatus !== 'not_applicable') cacheMisses += 1;
				modelCalls += Math.max(1, event.providerAttempts ?? 1);
			}
			retryCalls += event.retryCount ?? (event.attempt > 1 ? 1 : 0);
			inputTokens = addNullable(inputTokens, event.inputTokens);
			outputTokens = addNullable(outputTokens, event.outputTokens);
			cachedTokens = addNullable(cachedTokens, event.cachedTokens);
			cacheWriteTokens = addNullable(cacheWriteTokens, event.cacheWriteTokens);
			effectiveApiCostUsd = addNullable(effectiveApiCostUsd, event.effectiveApiCostUsd);
			estimatedCostUsd = addNullable(estimatedCostUsd, event.estimatedCostUsd);
			quotaUnits = addNullable(quotaUnits, event.quotaUnits);
			if (event.cliQuotaWindows && event.cliQuotaWindows.length > 0) {
				cliQuotaSnapshots += 1;
				lastCliQuotaWindows = event.cliQuotaWindows;
			}
			if (event.quotaUnits !== null && event.quotaUnits !== undefined || event.errorCode?.includes('QUOTA') || (event.cliQuotaWindows?.length ?? 0) > 0) quotaEvents += 1;
		}
		return {
			schemaVersion: 1,
			eventCount: this.events.length,
			modelCalls,
			cacheHits,
			cacheMisses,
			dedupedCalls,
			retryCalls,
			inputTokens,
			outputTokens,
			cachedTokens,
			cacheWriteTokens,
			effectiveApiCostUsd,
			estimatedCostUsd,
			quotaUnits,
			quotaEvents,
			cliQuotaSnapshots,
			...(lastCliQuotaWindows ? { lastCliQuotaWindows } : {}),
			...(this.options.budget ? { budget: this.options.budget } : {}),
			...(this.budgetStopReason ? { budgetStopReason: this.budgetStopReason } : {}),
			activeWallTimeMs: this.activeWallTimeMs(),
			...(this.events.at(-1)?.atIso ? { lastEventAtIso: this.events.at(-1)!.atIso } : {}),
		};
	}
}

/** Enforces job limits with in-process reservations so concurrent workers cannot oversubscribe them. */
export class RecapBudgetController {
	private readonly reserved = { calls: 0, inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0 };
	constructor(
		private readonly budget: RecapJobBudget | undefined,
		private readonly telemetry: RecapUsageTelemetry,
		/** Kept for source compatibility with callers that passed the legacy wall-clock origin. */
		_startedAtMs?: number,
	) {}

	beforeCall(input: RecapBudgetReservationInput): () => void {
		const limits = this.budget;
		if (!limits) return () => undefined;
		const usage = this.telemetry.summary();
		const inputTokens = Math.max(0, Math.floor(input.estimatedInputTokens ?? 0));
		const outputTokens = Math.max(0, Math.floor(input.estimatedOutputTokens ?? 0));
		const estimatedCostUsd = Math.max(0, input.estimatedCostUsd ?? 0);
		const totalTokens = (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0);
		if (limits.maxWallTimeMs !== undefined && this.telemetry.activeWallTimeMs() >= limits.maxWallTimeMs) {
			return this.block(input.stage, 'tempo máximo do job atingido');
		}
		if (limits.maxModelCalls !== undefined && usage.modelCalls + this.reserved.calls >= limits.maxModelCalls) {
			return this.block(input.stage, `maxModelCalls=${limits.maxModelCalls}`);
		}
		if (limits.maxInputTokens !== undefined && (usage.inputTokens ?? 0) + this.reserved.inputTokens + inputTokens > limits.maxInputTokens) {
			return this.block(input.stage, `maxInputTokens=${limits.maxInputTokens}`);
		}
		if (limits.maxOutputTokens !== undefined && (usage.outputTokens ?? 0) + this.reserved.outputTokens + outputTokens > limits.maxOutputTokens) {
			return this.block(input.stage, `maxOutputTokens=${limits.maxOutputTokens}`);
		}
		if (limits.maxTotalTokens !== undefined && totalTokens + this.reserved.inputTokens + this.reserved.outputTokens + inputTokens + outputTokens > limits.maxTotalTokens) {
			return this.block(input.stage, `maxTotalTokens=${limits.maxTotalTokens}`);
		}
		if (limits.maxEstimatedCostUsd !== undefined && (usage.estimatedCostUsd ?? 0) + this.reserved.estimatedCostUsd + estimatedCostUsd > limits.maxEstimatedCostUsd) {
			return this.block(input.stage, `maxEstimatedCostUsd=${limits.maxEstimatedCostUsd}`);
		}
		// An absent provider invoice/usage value is unknown, never zero. The
		// effective-API ceiling is enforced only once an effective value exists;
		// callers that require a hard stop for unknown pricing must also set a
		// model-call or estimated-cost ceiling.
		if (limits.maxEffectiveApiCostUsd !== undefined && usage.effectiveApiCostUsd !== null && usage.effectiveApiCostUsd >= limits.maxEffectiveApiCostUsd) {
			return this.block(input.stage, `maxEffectiveApiCostUsd=${limits.maxEffectiveApiCostUsd}`);
		}
		if (limits.maxQuotaUnits !== undefined && (usage.quotaUnits ?? 0) >= limits.maxQuotaUnits) {
			return this.block(input.stage, `maxQuotaUnits=${limits.maxQuotaUnits}`);
		}
    // maxRetries limits automatic retries after the initial attempt. With a unit id, a retry is a
    // new call for a unit that already failed in the CURRENT execution segment; an explicit resume
    // opens a new segment and is not an automatic retry. (The job-wide form blocked every call
    // after the first one when maxRetries=0.) Without a unit id the job-wide rule is kept.
    const retryBlocked = limits.maxRetries === undefined
      ? false
      : input.unitId !== undefined
        ? this.telemetry.failuresInCurrentExecution(input.unitId) > limits.maxRetries
        : usage.modelCalls > 0 && usage.retryCalls >= limits.maxRetries;
    if (retryBlocked) {
			return this.block(input.stage, `maxRetries=${limits.maxRetries}`);
		}
		this.reserved.calls += 1;
		this.reserved.inputTokens += inputTokens;
		this.reserved.outputTokens += outputTokens;
		this.reserved.estimatedCostUsd += estimatedCostUsd;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			this.reserved.calls -= 1;
			this.reserved.inputTokens -= inputTokens;
			this.reserved.outputTokens -= outputTokens;
			this.reserved.estimatedCostUsd -= estimatedCostUsd;
		};
	}

	private block(stage: RecapUsageStage, reason: string): never {
		this.telemetry.setBudgetStopReason(reason);
		throw new RecapBudgetExceededError(stage, reason);
	}
}

export function estimateRecapInputTokens(value: unknown): number {
	try {
		return Math.max(1, Math.ceil(JSON.stringify(value).length / 4));
	} catch {
		return 1;
	}
}
