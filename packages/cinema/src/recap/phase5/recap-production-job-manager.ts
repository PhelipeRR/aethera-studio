/**
 * Recap production jobs: durable, UI-independent execution.
 *
 * A job is owned by the executor process (the local host), not by whoever asked for it.
 * Callers get the job record back immediately; the work keeps running whether or not any
 * window, tab or SSE/IPC subscriber is connected. Everything needed to observe, control and
 * recover a job lives on disk under `<workspace>/jobs`:
 *
 *   <jobId>.json          the job record, written only by the executor (atomic rename)
 *   <jobId>.control.json  pause / resume / cancel requests, written by any controller
 *
 * Splitting the two files lets another process (Remote Host, Web) request a pause or cancel
 * without racing the executor's progress writes. Requests are honoured at safe checkpoints
 * (between panels and between stages), never by aborting work midway.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export type RecapJobKind = 'production' | 'master_export';

export type RecapJobStatus =
	| 'running'
	| 'pause_requested'
	| 'paused'
	| 'cancel_requested'
	| 'cancelled'
	| 'interrupted'
	| 'awaiting_approval'
	| 'paused_provider_unavailable'
	| 'completed'
	| 'failed';

export type RecapJobControlAction = 'pause' | 'resume' | 'cancel';

/** Statuses in which an executor is (or should be) working on the job. */
export const RECAP_JOB_ACTIVE_STATUSES: readonly RecapJobStatus[] = ['running', 'pause_requested', 'cancel_requested'];
/** Statuses that can be resumed from a checkpoint. */
export const RECAP_JOB_RESUMABLE_STATUSES: readonly RecapJobStatus[] = ['paused', 'interrupted', 'paused_provider_unavailable'];
/** Statuses that end the job for good; a new production may start for the same project. */
export const RECAP_JOB_TERMINAL_STATUSES: readonly RecapJobStatus[] = ['cancelled', 'completed', 'failed', 'awaiting_approval'];

/** Pipeline order used to derive a stable progress percentage. */
export const RECAP_JOB_STEP_ORDER = [
	'import',
	'gate-f',
	'vision',
	'continuity',
	'script',
	'humanize',
	'motion',
	'gate-h',
	'audiovisual_preview',
] as const;

export interface RecapJobError {
	atIso: string;
	stage: string | null;
	message: string;
}

export interface RecapJobProgress {
	completedSteps: string[];
	completedPanels?: number;
	totalPanels?: number;
	percent: number;
}

export interface RecapJobCheckpoint {
	canResume: boolean;
	lastStage: string | null;
	completedPanels?: number;
	totalPanels?: number;
	note?: string;
}

export interface RecapJobRecord {
	schemaVersion: 1;
	jobId: string;
	kind: RecapJobKind;
	/** Recap project id (the orchestrator runId). */
	projectId: string;
	chapterId: string;
	workTitle: string;
	status: RecapJobStatus;
	stage: string | null;
	message: string;
	progress: RecapJobProgress;
	checkpoint: RecapJobCheckpoint;
	errors: RecapJobError[];
	/** Serializable start parameters, replayed on resume. */
	input: Record<string, unknown>;
	attempts: number;
	executor: { instanceId: string; pid: number; heartbeatAtIso: string } | null;
	createdAtIso: string;
	updatedAtIso: string;
	finishedAtIso?: string;
}

export interface RecapJobControlRequest {
	action: RecapJobControlAction;
	requestedAtIso: string;
	requestedBy?: string;
}

/** Thrown at a checkpoint when a pause or cancel was requested. Not a failure. */
export class RecapJobInterruptedError extends Error {
	readonly action: 'pause' | 'cancel';
	constructor(action: 'pause' | 'cancel', stage: string | null) {
		super(action === 'pause' ? `Pausa solicitada (ponto seguro: ${stage ?? 'início'}).` : `Cancelamento solicitado (ponto seguro: ${stage ?? 'início'}).`);
		this.name = 'RecapJobInterruptedError';
		this.action = action;
	}
}

export function isRecapJobInterruptedError(err: unknown): err is RecapJobInterruptedError {
	return err instanceof RecapJobInterruptedError || (err instanceof Error && err.name === 'RecapJobInterruptedError');
}

export interface RecapJobProgressUpdate {
	stage?: string | null;
	message?: string;
	completedSteps?: readonly string[];
	completedPanels?: number;
	totalPanels?: number;
	canResume?: boolean;
}

export interface RecapJobContext {
	readonly jobId: string;
	readonly isResume: boolean;
	/** Throws RecapJobInterruptedError when a pause or cancel is pending. Call only at safe points. */
	checkpoint(stage: string | null): void;
	report(update: RecapJobProgressUpdate): void;
}

export interface RecapJobOutcome {
	status: 'completed' | 'awaiting_approval' | 'paused_provider_unavailable' | 'failed';
	message: string;
	stage?: string | null;
	completedSteps?: readonly string[];
	canResume?: boolean;
}

export type RecapJobExecutor = (job: RecapJobRecord, ctx: RecapJobContext) => Promise<RecapJobOutcome>;

export interface RecapJobEvent {
	type: 'created' | 'updated' | 'finished';
	job: RecapJobRecord;
}

export interface RecapProductionJobManagerOptions {
	workspaceDir: string;
	executor: RecapJobExecutor;
	onEvent?: (event: RecapJobEvent) => void;
	/** Identifies this executor process; a job owned by another instance id is orphaned. */
	instanceId?: string;
	/** Heartbeat + control-file poll interval. 0 disables the timer (tests drive it with tick()). */
	pollIntervalMs?: number;
	now?: () => number;
}

export interface StartRecapJobInput {
	kind: RecapJobKind;
	projectId: string;
	chapterId: string;
	workTitle: string;
	input: Record<string, unknown>;
}

export interface StartRecapJobResult {
	job: RecapJobRecord;
	/** False when an existing job for the same project was returned instead of starting another. */
	created: boolean;
}

export interface RecoverRecapJobsOptions {
	/** Resume interrupted jobs right away from their checkpoint. */
	autoResume?: boolean;
	/** Give up auto-resuming after this many attempts (prevents crash loops). */
	maxAttempts?: number;
	/** Returns a reason when a job cannot be recovered (e.g. its source archive is gone). */
	canRecover?: (job: RecapJobRecord) => string | null;
}

export function computeRecapJobPercent(completedSteps: readonly string[], completedPanels?: number, totalPanels?: number): number {
	const done = new Set(completedSteps);
	const total = RECAP_JOB_STEP_ORDER.length;
	let count = 0;
	for (const step of RECAP_JOB_STEP_ORDER) if (done.has(step)) count += 1;
	let fraction = count / total;
	if (!done.has('vision') && totalPanels && totalPanels > 0 && completedPanels !== undefined) {
		fraction += Math.min(1, Math.max(0, completedPanels / totalPanels)) / total;
	}
	return Math.max(0, Math.min(100, Math.round(fraction * 100)));
}

function writeJsonAtomic(path: string, value: unknown): void {
	const tmp = `${path}.tmp.${process.pid}.${randomUUID().slice(0, 8)}`;
	writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf-8');
	renameSync(tmp, path);
}

function readJson<T>(path: string): T | null {
	if (!existsSync(path)) return null;
	try {
		return JSON.parse(readFileSync(path, 'utf-8')) as T;
	} catch {
		return null;
	}
}

export function getRecapJobsDir(workspaceDir: string): string {
	return join(workspaceDir, 'jobs');
}

/** Reads every persisted job (newest first). Safe to call from any process. */
export function listRecapJobs(workspaceDir: string): RecapJobRecord[] {
	const dir = getRecapJobsDir(workspaceDir);
	if (!existsSync(dir)) return [];
	const jobs: RecapJobRecord[] = [];
	for (const name of readdirSync(dir)) {
		if (!name.endsWith('.json') || name.endsWith('.control.json') || name.includes('.tmp.')) continue;
		const job = readJson<RecapJobRecord>(join(dir, name));
		if (job?.schemaVersion === 1 && job.jobId) jobs.push(job);
	}
	return jobs.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));
}

export function readRecapJob(workspaceDir: string, jobId: string): RecapJobRecord | null {
	if (!/^[A-Za-z0-9_-]+$/.test(jobId)) return null;
	return readJson<RecapJobRecord>(join(getRecapJobsDir(workspaceDir), `${jobId}.json`));
}

/**
 * Records a pause / resume / cancel request for any process to honour. Used by the Remote
 * Host and Web, which observe jobs without executing them.
 */
export function requestRecapJobControl(
	workspaceDir: string,
	jobId: string,
	action: RecapJobControlAction,
	requestedBy?: string,
): RecapJobControlRequest | null {
	const job = readRecapJob(workspaceDir, jobId);
	if (!job) return null;
	const request: RecapJobControlRequest = {
		action,
		requestedAtIso: new Date().toISOString(),
		...(requestedBy ? { requestedBy } : {}),
	};
	writeJsonAtomic(join(getRecapJobsDir(workspaceDir), `${jobId}.control.json`), request);
	return request;
}

export class RecapProductionJobManager {
	private readonly workspaceDir: string;
	private readonly jobsDir: string;
	private readonly executor: RecapJobExecutor;
	private readonly onEvent: ((event: RecapJobEvent) => void) | undefined;
	private readonly instanceId: string;
	private readonly now: () => number;
	private readonly running = new Map<string, Promise<void>>();
	private readonly timer: ReturnType<typeof setInterval> | null;

	constructor(options: RecapProductionJobManagerOptions) {
		this.workspaceDir = options.workspaceDir;
		this.jobsDir = getRecapJobsDir(options.workspaceDir);
		this.executor = options.executor;
		this.onEvent = options.onEvent;
		this.instanceId = options.instanceId ?? randomUUID();
		this.now = options.now ?? (() => Date.now());
		mkdirSync(this.jobsDir, { recursive: true });
		const interval = options.pollIntervalMs ?? 5_000;
		this.timer = interval > 0 ? setInterval(() => this.tick(), interval) : null;
		if (this.timer && typeof this.timer === 'object' && 'unref' in this.timer) this.timer.unref();
	}

	dispose(): void {
		if (this.timer) clearInterval(this.timer);
	}

	list(): RecapJobRecord[] {
		return listRecapJobs(this.workspaceDir);
	}

	get(jobId: string): RecapJobRecord | null {
		return readRecapJob(this.workspaceDir, jobId);
	}

	/** Most recent non-terminal job for a project or chapter, if any. */
	findOpen(filter: { projectId?: string; chapterId?: string }): RecapJobRecord | null {
		return (
			this.list().find(
				(j) =>
					!RECAP_JOB_TERMINAL_STATUSES.includes(j.status) &&
					((filter.projectId && j.projectId === filter.projectId) || (filter.chapterId && j.chapterId === filter.chapterId)),
			) ?? null
		);
	}

	isExecuting(jobId: string): boolean {
		return this.running.has(jobId);
	}

	/** Resolves when the job's current execution settles (tests and graceful shutdown). */
	async waitForIdle(jobId: string): Promise<RecapJobRecord | null> {
		await this.running.get(jobId);
		return this.get(jobId);
	}

	/**
	 * Starts a job, or returns the open job for the same project/chapter instead of a duplicate.
	 * Returns immediately: the execution is detached from the caller.
	 */
	start(input: StartRecapJobInput): StartRecapJobResult {
		const existing = this.findOpen({ projectId: input.projectId, chapterId: input.chapterId });
		if (existing) {
			// A previous executor died without the record noticing: adopt and resume it.
			if (RECAP_JOB_ACTIVE_STATUSES.includes(existing.status) && !this.running.has(existing.jobId)) {
				const orphan = this.markOrphan(existing);
				if (orphan.status === 'interrupted') return { job: this.resume(orphan.jobId) ?? orphan, created: false };
				return { job: orphan, created: false };
			}
			return { job: existing, created: false };
		}
		const nowIso = new Date(this.now()).toISOString();
		const job: RecapJobRecord = {
			schemaVersion: 1,
			jobId: `rjob-${this.now().toString(36)}-${randomUUID().slice(0, 8)}`,
			kind: input.kind,
			projectId: input.projectId,
			chapterId: input.chapterId,
			workTitle: input.workTitle,
			status: 'running',
			stage: null,
			message: 'Job criado; execução iniciada no host local.',
			progress: { completedSteps: [], percent: 0 },
			checkpoint: { canResume: false, lastStage: null },
			errors: [],
			input: input.input,
			attempts: 0,
			executor: null,
			createdAtIso: nowIso,
			updatedAtIso: nowIso,
		};
		this.save(job);
		this.emit('created', job);
		this.launch(job, false);
		return { job: this.get(job.jobId) ?? job, created: true };
	}

	pause(jobId: string, requestedBy?: string): RecapJobRecord | null {
		const job = this.get(jobId);
		if (!job) return null;
		if (job.status === 'running') {
			this.writeControl(jobId, 'pause', requestedBy);
			return this.update(job, { status: 'pause_requested', message: 'Pausa solicitada; será aplicada no próximo ponto seguro.' });
		}
		return job;
	}

	cancel(jobId: string, requestedBy?: string): RecapJobRecord | null {
		const job = this.get(jobId);
		if (!job) return null;
		if (RECAP_JOB_TERMINAL_STATUSES.includes(job.status)) return job;
		if (this.running.has(jobId)) {
			this.writeControl(jobId, 'cancel', requestedBy);
			return this.update(job, { status: 'cancel_requested', message: 'Cancelamento solicitado; será aplicado no próximo ponto seguro.' });
		}
		this.clearControl(jobId);
		const cancelled = this.update(job, {
			status: 'cancelled',
			message: 'Produção cancelada. Checkpoints preservados em disco.',
			finishedAtIso: new Date(this.now()).toISOString(),
		});
		this.emit('finished', cancelled);
		return cancelled;
	}

	resume(jobId: string): RecapJobRecord | null {
		const job = this.get(jobId);
		if (!job) return null;
		if (this.running.has(jobId)) {
			// Withdraw a pending pause/cancel instead of starting a second execution.
			if (job.status === 'pause_requested' || job.status === 'cancel_requested') {
				this.clearControl(jobId);
				return this.update(job, { status: 'running', message: 'Pedido anterior retirado; produção continua.' });
			}
			this.clearControl(jobId);
			return job;
		}
		if (!RECAP_JOB_RESUMABLE_STATUSES.includes(job.status)) return job;
		this.clearControl(jobId);
		const resumed = this.update(job, {
			status: 'running',
			message: job.checkpoint.canResume
				? `Retomando do checkpoint (${job.checkpoint.lastStage ?? 'início'}).`
				: 'Retomando; etapas concluídas são reaproveitadas.',
		});
		this.launch(resumed, true);
		return this.get(jobId) ?? resumed;
	}

	/**
	 * Call once when the executor process starts. Jobs left active by a previous executor are
	 * marked interrupted (or paused/cancelled if that was pending) and optionally resumed.
	 */
	recoverOnStartup(options: RecoverRecapJobsOptions = {}): RecapJobRecord[] {
		const maxAttempts = options.maxAttempts ?? 3;
		const recovered: RecapJobRecord[] = [];
		for (const job of this.list()) {
			if (!RECAP_JOB_ACTIVE_STATUSES.includes(job.status) || this.running.has(job.jobId)) continue;
			let next = this.markOrphan(job);
			if (next.status === 'interrupted') {
				const reason = options.canRecover?.(next) ?? null;
				if (reason) {
					next = this.update(next, {
						status: 'failed',
						message: `Recuperação impossível após reinício do executor: ${reason}`,
						finishedAtIso: new Date(this.now()).toISOString(),
						errors: [...next.errors, { atIso: new Date(this.now()).toISOString(), stage: next.stage, message: `recovery_impossible: ${reason}` }],
					});
					this.emit('finished', next);
				} else if (options.autoResume && next.attempts < maxAttempts) {
					next = this.resume(next.jobId) ?? next;
				} else if (options.autoResume) {
					next = this.update(next, {
						message: `Interrompido ${next.attempts} vezes; retome manualmente para tentar de novo a partir do checkpoint.`,
					});
				}
			}
			recovered.push(next);
		}
		return recovered;
	}

	/** Heartbeat for running jobs and pickup of control requests written by other processes. */
	tick(): void {
		const nowIso = new Date(this.now()).toISOString();
		for (const job of this.list()) {
			const control = this.readControl(job.jobId);
			if (this.running.has(job.jobId)) {
				if (control?.action === 'pause' && job.status === 'running') {
					this.update(job, { status: 'pause_requested', message: 'Pausa solicitada; será aplicada no próximo ponto seguro.' });
				} else if (control?.action === 'cancel' && job.status !== 'cancel_requested') {
					this.update(job, { status: 'cancel_requested', message: 'Cancelamento solicitado; será aplicado no próximo ponto seguro.' });
				} else if (control?.action === 'resume') {
					this.resume(job.jobId);
				} else {
					this.save({ ...job, executor: { instanceId: this.instanceId, pid: process.pid, heartbeatAtIso: nowIso } });
				}
				continue;
			}
			if (control?.action === 'resume' && RECAP_JOB_RESUMABLE_STATUSES.includes(job.status)) this.resume(job.jobId);
			else if (control?.action === 'cancel') this.cancel(job.jobId, control.requestedBy);
		}
	}

	// ─── internals ────────────────────────────────────────────────────────────

	private markOrphan(job: RecapJobRecord): RecapJobRecord {
		const atIso = new Date(this.now()).toISOString();
		const control = this.readControl(job.jobId);
		if (job.status === 'cancel_requested' || control?.action === 'cancel') {
			this.clearControl(job.jobId);
			const cancelled = this.update(job, { status: 'cancelled', message: 'Cancelado (o executor parou antes de confirmar).', finishedAtIso: atIso, executor: null });
			this.emit('finished', cancelled);
			return cancelled;
		}
		if (job.status === 'pause_requested' || control?.action === 'pause') {
			this.clearControl(job.jobId);
			return this.update(job, { status: 'paused', message: 'Pausado (o executor parou antes de confirmar).', executor: null });
		}
		return this.update(job, {
			status: 'interrupted',
			executor: null,
			message: job.checkpoint.canResume
				? `Executor reiniciado durante "${job.stage ?? 'início'}"; retomável do checkpoint.`
				: `Executor reiniciado durante "${job.stage ?? 'início'}"; será refeito a partir da última etapa concluída.`,
			errors: [...job.errors, { atIso, stage: job.stage, message: 'executor_restarted' }],
		});
	}

	private launch(job: RecapJobRecord, isResume: boolean): void {
		const jobId = job.jobId;
		const started = this.update(job, {
			attempts: job.attempts + 1,
			executor: { instanceId: this.instanceId, pid: process.pid, heartbeatAtIso: new Date(this.now()).toISOString() },
		});
		const ctx: RecapJobContext = {
			jobId,
			isResume,
			checkpoint: (stage) => {
				const control = this.readControl(jobId);
				const current = this.get(jobId);
				const action =
					control?.action === 'cancel' || current?.status === 'cancel_requested'
						? 'cancel'
						: control?.action === 'pause' || current?.status === 'pause_requested'
							? 'pause'
							: null;
				if (action) throw new RecapJobInterruptedError(action, stage);
			},
			report: (u) => {
				const current = this.get(jobId);
				if (!current) return;
				const completedSteps = u.completedSteps ? [...new Set(u.completedSteps)] : current.progress.completedSteps;
				const completedPanels = u.completedPanels ?? current.progress.completedPanels;
				const totalPanels = u.totalPanels ?? current.progress.totalPanels;
				const stage = u.stage !== undefined ? u.stage : current.stage;
				this.update(current, {
					stage,
					message: u.message ?? current.message,
					progress: {
						completedSteps,
						...(completedPanels !== undefined ? { completedPanels } : {}),
						...(totalPanels !== undefined ? { totalPanels } : {}),
						percent: computeRecapJobPercent(completedSteps, completedPanels, totalPanels),
					},
					checkpoint: {
						canResume: u.canResume ?? current.checkpoint.canResume,
						lastStage: stage,
						...(completedPanels !== undefined ? { completedPanels } : {}),
						...(totalPanels !== undefined ? { totalPanels } : {}),
					},
				});
			},
		};

		const execution = (async () => {
			try {
				const outcome = await this.executor(started, ctx);
				const current = this.get(jobId) ?? started;
				const completedSteps = outcome.completedSteps ? [...new Set(outcome.completedSteps)] : current.progress.completedSteps;
				const atIso = new Date(this.now()).toISOString();
				const resumable = outcome.status === 'paused_provider_unavailable';
				const finished = this.update(current, {
					status: outcome.status,
					stage: outcome.stage !== undefined ? outcome.stage : current.stage,
					message: outcome.message,
					executor: null,
					progress: {
						...current.progress,
						completedSteps,
						percent: outcome.status === 'completed' ? 100 : computeRecapJobPercent(completedSteps, current.progress.completedPanels, current.progress.totalPanels),
					},
					checkpoint: { ...current.checkpoint, canResume: outcome.canResume ?? resumable },
					...(outcome.status === 'failed' || resumable
						? { errors: [...current.errors, { atIso, stage: outcome.stage ?? current.stage, message: outcome.message }] }
						: {}),
					...(resumable ? {} : { finishedAtIso: atIso }),
				});
				this.clearControl(jobId);
				this.emit('finished', finished);
			} catch (err) {
				const current = this.get(jobId) ?? started;
				const atIso = new Date(this.now()).toISOString();
				if (isRecapJobInterruptedError(err)) {
					this.clearControl(jobId);
					const action = (err as RecapJobInterruptedError).action;
					const next = this.update(current, action === 'cancel'
						? { status: 'cancelled', message: 'Produção cancelada em ponto seguro. Checkpoints preservados.', executor: null, finishedAtIso: atIso }
						: { status: 'paused', message: `Pausado em ponto seguro (${current.stage ?? 'início'}). Retome quando quiser.`, executor: null, checkpoint: { ...current.checkpoint, canResume: true } });
					if (action === 'cancel') this.emit('finished', next);
					return;
				}
				const message = err instanceof Error ? err.message : String(err);
				const failed = this.update(current, {
					status: 'failed',
					message,
					executor: null,
					finishedAtIso: atIso,
					errors: [...current.errors, { atIso, stage: current.stage, message }],
				});
				this.clearControl(jobId);
				this.emit('finished', failed);
			} finally {
				this.running.delete(jobId);
			}
		})();
		this.running.set(jobId, execution);
	}

	private update(job: RecapJobRecord, patch: Partial<RecapJobRecord>): RecapJobRecord {
		// Re-read so concurrent report()/control updates are not lost.
		const base = this.get(job.jobId) ?? job;
		const next: RecapJobRecord = { ...base, ...patch, updatedAtIso: new Date(this.now()).toISOString() };
		this.save(next);
		if (patch.status === undefined || !RECAP_JOB_TERMINAL_STATUSES.includes(patch.status)) this.emit('updated', next);
		return next;
	}

	private save(job: RecapJobRecord): void {
		mkdirSync(this.jobsDir, { recursive: true });
		writeJsonAtomic(join(this.jobsDir, `${job.jobId}.json`), job);
	}

	private controlPath(jobId: string): string {
		return join(this.jobsDir, `${jobId}.control.json`);
	}

	private readControl(jobId: string): RecapJobControlRequest | null {
		return readJson<RecapJobControlRequest>(this.controlPath(jobId));
	}

	private writeControl(jobId: string, action: RecapJobControlAction, requestedBy?: string): void {
		writeJsonAtomic(this.controlPath(jobId), {
			action,
			requestedAtIso: new Date(this.now()).toISOString(),
			...(requestedBy ? { requestedBy } : {}),
		} satisfies RecapJobControlRequest);
	}

	private clearControl(jobId: string): void {
		rmSync(this.controlPath(jobId), { force: true });
	}

	private emit(type: RecapJobEvent['type'], job: RecapJobRecord): void {
		try {
			this.onEvent?.({ type, job });
		} catch {
			// Observers never affect execution.
		}
	}
}
