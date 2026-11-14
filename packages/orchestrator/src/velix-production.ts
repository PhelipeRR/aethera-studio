import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import {
  type ProductionBrief,
  type ProductionStageError,
  type ProductionStageKind,
  type ProductionQualityCheck,
  type ProductionRunStatus,
  type ProductionRunView,
  type ProductionStageStatus,
  type ProductionState,
  budgetAllows,
  isSafeProductionPath,
  productionBriefSchema,
  productionStageCheckpointSchema,
} from '@neuralbridge/shared';
import { type VelixProductionRepository, type VelixProductionRunRow, type VelixProductionStageRow } from '@neuralbridge/database';
import { type StructuredReadOnlyInput, type TaskEngine, type TaskUpdate } from './engine.js';

/** The part of the TaskEngine a production uses: every stage is a TaskEngine task, never a direct CLI call. */
export type ProductionTaskPort = Pick<TaskEngine, 'start' | 'cancel' | 'pause' | 'resumePaused'> & Partial<Pick<TaskEngine, 'runStructuredReadOnly'>>;

/** What an adapter stage can do: structured read-only TaskEngine calls, its own checkpoint, progress and confined files. */
export interface ProductionStageContext {
  runId: string;
  stageId: string;
  brief: ProductionBrief;
  input: Record<string, unknown>;
  /** What this stage already produced before a pause, a failure or a restart. */
  state: Record<string, unknown>;
  signal: AbortSignal;
  saveState(state: Record<string, unknown>): void;
  progress(value: number): void;
  runStructured(input: { prompt: string; outputSchema: object }): Promise<{ structured: unknown; text: string; taskId: string }>;
  /** Writes under the video project root and records the artifact (idempotent by content hash). */
  writeArtifact(input: { kind: string; relativePath: string; content: string | Buffer; mime: string; metadata?: Record<string, unknown> }): { id: string; relativePath: string };
  /** Records a file a tool already wrote under the project (e.g. FFmpeg output), hashed from disk. */
  recordFile(input: { kind: string; relativePath: string; mime: string; metadata?: Record<string, unknown> }): { id: string; relativePath: string };
  /** Absolute path of a file under the video project root (for FFmpeg/FFprobe); refuses anything outside it. */
  resolvePath(relativePath: string): string;
  /** The latest artifact of a kind this run produced (any stage), read from the project; null when there is none. */
  readArtifact(kind: string): { id: string; stageId: string; relativePath: string; content: string } | null;
  /** The video project the run belongs to. */
  projectId: string;
}

export interface ProductionStageAdapter {
  kind: ProductionStageKind;
  run(context: ProductionStageContext): Promise<{ actualCostUsd?: number } | undefined>;
}

export interface ScheduleAdapterStageInput {
  runId: string;
  kind: ProductionStageKind;
  taskProjectId: string;
  input?: Record<string, unknown>;
  dependsOn?: readonly ProductionStageKind[];
  costEstimateUsd?: number;
}

export interface ScheduleStageInput {
  runId: string;
  kind: ProductionStageKind;
  prompt: string;
  /** General project the TaskEngine runs in (the video project lives inside it). */
  taskProjectId: string;
  costEstimateUsd?: number;
}

export type ScheduleStageResult = { stageId: string; status: 'pending' | 'running' | 'completed' | 'awaiting_approval' | 'cancelled'; taskId: string | null };

const ACTIVE = new Set(['pending', 'running', 'paused', 'awaiting_approval']);
const TERMINAL_TASK = new Set(['completed', 'failed', 'cancelled']);
const MAX_RETRIES = 3;

const runView = (run: VelixProductionRunRow): ProductionRunView => {
  const brief = productionBriefSchema.parse(JSON.parse(run.brief));
  return { id: run.id, projectId: run.projectId, status: run.status as ProductionRunStatus, topic: brief.topic, formatId: brief.format.id, agent: run.agent ?? 'claude', estimatedCostUsd: run.estimatedCostUsd, actualCostUsd: run.actualCostUsd, createdAt: run.createdAt, updatedAt: run.updatedAt };
};
const parseCheckpoint = (stage: VelixProductionStageRow) => productionStageCheckpointSchema.parse(JSON.parse(stage.checkpoint));
const stageError = (error: ProductionStageError) => JSON.stringify(error);

/**
 * Orchestrates a Velix production over the TaskEngine. Each stage is idempotent by input hash, paid work
 * waits for approval when it would exceed the budget, and state lives in the database so a restart resumes
 * without duplicating stages or artifacts.
 */
export class ProductionRunService {
  private readonly adapters = new Map<ProductionStageKind, ProductionStageAdapter>();
  private readonly controllers = new Map<string, AbortController>();
  private readonly running = new Set<Promise<void>>();
  /** Called after an adapter stage changes on its own (progress, completion, failure). */
  onChange: ((runId: string) => void) | undefined;

  constructor(
    private readonly repository: VelixProductionRepository,
    private readonly taskEngine: ProductionTaskPort,
    adapters: readonly ProductionStageAdapter[] = [],
  ) {
    for (const adapter of adapters) this.adapters.set(adapter.kind, adapter);
  }

  /** Resolves when no adapter stage is running (tests and shutdown). */
  async idle(): Promise<void> {
    while (this.running.size) await Promise.allSettled([...this.running]);
  }

  create(projectId: string, brief: ProductionBrief, estimatedCostUsd = 0, agent: 'claude' | 'codex' = 'claude') {
    return this.repository.createRun({ projectId, brief, estimatedCostUsd, agent });
  }

  state(runId: string) {
    const run = this.requireRun(runId);
    return {
      run,
      stages: this.repository.listStages(runId),
      artifacts: this.repository.listArtifacts(runId),
      budget: this.repository.getBudget(runId),
      approvals: this.repository.listApprovals(runId),
      qualityReports: this.repository.listQualityReports(runId),
    };
  }

  /** The renderer's view: parsed JSON, no prompts (they stay in the checkpoint). */
  view(runId: string): ProductionState {
    const state = this.state(runId);
    return {
      run: runView(state.run),
      brief: productionBriefSchema.parse(JSON.parse(state.run.brief)),
      stages: state.stages.map((stage) => ({ id: stage.id, kind: stage.kind as ProductionStageKind, status: stage.status as ProductionStageStatus, progress: stage.progress, retryCount: stage.retryCount, costEstimateUsd: stage.costEstimateUsd, actualCostUsd: stage.actualCostUsd, taskId: stage.taskId, error: stage.error ? (JSON.parse(stage.error) as ProductionStageError) : null, outputArtifactIds: JSON.parse(stage.outputArtifactIds) as string[], updatedAt: stage.updatedAt })),
      artifacts: state.artifacts.map((artifact) => ({ id: artifact.id, stageId: artifact.stageId, kind: artifact.kind, relativePath: artifact.relativePath, mime: artifact.mime, contentHash: artifact.contentHash })),
      budget: { currency: state.budget.currency, limitUsd: state.budget.limitUsd, reserveUsd: state.budget.reserveUsd, consumedUsd: state.budget.consumedUsd, policy: state.budget.policy },
      approvals: state.approvals.map((approval) => ({ id: approval.id, stageId: approval.stageId, decision: approval.decision as 'approved' | 'rejected', note: approval.note, createdAt: approval.createdAt })),
      qualityReports: state.qualityReports.map((report) => ({ id: report.id, stageId: report.stageId, blocking: report.blocking, exportable: report.exportable, checks: JSON.parse(report.checks) as ProductionQualityCheck[] })),
    };
  }

  list(projectId: string): ProductionRunView[] {
    return this.repository.listRuns(projectId).map(runView);
  }

  async scheduleStage(input: ScheduleStageInput): Promise<ScheduleStageResult> {
    return this.schedule(input.runId, input.kind, input.prompt, { prompt: input.prompt, taskProjectId: input.taskProjectId }, input.costEstimateUsd);
  }

  /** Schedules a stage run by its registered adapter, in the background; a restart continues from its saved state. */
  async scheduleAdapterStage(input: ScheduleAdapterStageInput): Promise<ScheduleStageResult> {
    if (!this.adapters.has(input.kind)) throw new Error(`unavailable: não há adaptador para a etapa ${input.kind}.`);
    const stageInput = input.input ?? {};
    return this.schedule(input.runId, input.kind, `adapter:${JSON.stringify(stageInput)}`, { adapter: input.kind, taskProjectId: input.taskProjectId, input: stageInput, state: {}, ...(input.dependsOn?.length ? { dependsOn: [...input.dependsOn] } : {}) }, input.costEstimateUsd);
  }

  private async schedule(runId: string, kind: ProductionStageKind, hashInput: string, checkpointValue: Record<string, unknown>, estimate: number | undefined): Promise<ScheduleStageResult> {
    const run = this.requireRun(runId);
    if (run.status === 'cancelled' || run.status === 'completed') throw new Error(`invalid: a produção está ${run.status === 'cancelled' ? 'cancelada' : 'concluída'}.`);
    const costEstimateUsd = Math.max(0, estimate ?? 0);
    const inputHash = createHash('sha256').update(`${run.brief}\0${kind}\0${hashInput}`).digest('hex');
    const same = this.repository.listStages(run.id).filter((stage) => stage.kind === kind && stage.inputHash === inputHash);
    const done = same.find((stage) => stage.status === 'completed');
    if (done) return { stageId: done.id, status: 'completed', taskId: done.taskId };
    const active = same.find((stage) => ACTIVE.has(stage.status));
    if (active?.status === 'running' || active?.status === 'paused') return { stageId: active.id, status: 'running', taskId: active.taskId };
    if (active?.status === 'awaiting_approval') return { stageId: active.id, status: 'awaiting_approval', taskId: null };
    const checkpoint = JSON.stringify(productionStageCheckpointSchema.parse(checkpointValue));
    const stage = active ?? this.repository.addStage({ runId: run.id, kind, status: 'pending', inputHash, outputArtifactIds: '[]', progress: 0, retryCount: 0, costEstimateUsd, actualCostUsd: 0, checkpoint, error: null, taskId: null });
    const parsedCheckpoint = productionStageCheckpointSchema.parse(JSON.parse(stage.checkpoint));
    if (!this.dependenciesCompleted(run.id, parsedCheckpoint.dependsOn ?? [])) return { stageId: stage.id, status: 'pending', taskId: null };
    if (!budgetAllows(this.repository.getBudget(run.id), stage.costEstimateUsd)) {
      this.repository.updateStage(stage.id, { status: 'awaiting_approval', error: stageError({ code: 'budget_exceeded', message: 'A estimativa ultrapassa o orçamento restante.', retryable: true }) });
      this.repository.setRunStatus(run.id, 'awaiting_approval');
      return { stageId: stage.id, status: 'awaiting_approval', taskId: null };
    }
    const taskId = await this.launch(stage);
    return { stageId: stage.id, status: 'running', taskId };
  }

  /** A human decision on a stage held by the budget: approval runs it (the overrun is accepted), rejection cancels it. */
  async decide(stageId: string, decision: 'approved' | 'rejected', note?: string): Promise<ScheduleStageResult> {
    const stage = this.requireStage(stageId);
    if (stage.status !== 'awaiting_approval') throw new Error('invalid: a etapa não aguarda aprovação.');
    this.repository.recordApproval({ runId: stage.runId, stageId, decision, note: note ?? null });
    if (decision === 'rejected') {
      this.repository.updateStage(stageId, { status: 'cancelled', error: stageError({ code: 'rejected', message: 'Rejeitada pelo usuário.', retryable: false }) });
      this.refreshRun(stage.runId);
      return { stageId, status: 'cancelled', taskId: null };
    }
    const taskId = await this.launch(stage);
    return { stageId, status: 'running', taskId };
  }

  /** Called with every TaskEngine update; only the stage that owns the task changes. */
  onTaskUpdate(update: TaskUpdate): void {
    if (update.kind !== 'status') return;
    const stage = this.repository.stageByTask(update.taskId);
    if (!stage || !ACTIVE.has(stage.status)) return;
    if (update.status === 'completed') this.complete(stage);
    else if (update.status === 'failed') this.fail(stage, update.error ?? 'A tarefa falhou.');
    else if (update.status === 'cancelled') this.repository.updateStage(stage.id, { status: 'cancelled' });
    else if (update.status === 'paused') this.repository.updateStage(stage.id, { status: 'paused' });
    else if (update.status === 'running' && stage.status === 'paused') this.repository.updateStage(stage.id, { status: 'running' });
    else return;
    this.refreshRun(stage.runId);
    this.advance(stage.runId);
  }

  pause(runId: string): void {
    this.requireRun(runId);
    for (const stage of this.repository.listStages(runId)) {
      if (stage.status !== 'running') continue;
      if (stage.taskId) this.taskEngine.pause(stage.taskId);
      else if (this.controllers.has(stage.id)) {
        // An adapter stage stops at its next batch boundary; its saved state is the resume point.
        this.repository.updateStage(stage.id, { status: 'paused' });
        this.repository.reconcile(runId, stage.costEstimateUsd, 0);
        this.controllers.get(stage.id)?.abort();
      }
    }
    this.repository.setRunStatus(runId, 'paused');
  }

  cancel(runId: string): void {
    this.requireRun(runId);
    for (const stage of this.repository.listStages(runId)) {
      if (!ACTIVE.has(stage.status)) continue;
      if (stage.taskId) this.taskEngine.cancel(stage.taskId);
      this.controllers.get(stage.id)?.abort();
      // A paused adapter stage already released its reservation when it stopped.
      if (stage.status === 'running' || (stage.status === 'paused' && stage.taskId)) this.repository.reconcile(runId, stage.costEstimateUsd, 0);
      this.repository.updateStage(stage.id, { status: 'cancelled' });
    }
    this.repository.setRunStatus(runId, 'cancelled');
  }

  /**
   * At startup, after `TaskEngine.recover()`: a stage whose task finished keeps its result; one whose task was
   * interrupted goes back to pending (same stage, same artifacts) so `resume` restarts it without duplicating.
   */
  recover(): number {
    let reset = 0;
    for (const stage of this.repository.inFlightStages()) {
      // A paused adapter stage already released its reservation and keeps its state: `resume` continues it.
      if (stage.status === 'paused' && !stage.taskId) continue;
      const task = stage.taskId ? this.repository.taskStatus(stage.taskId) : undefined;
      if (task?.status === 'completed') this.complete(stage);
      else if (!task || TERMINAL_TASK.has(task.status)) {
        this.repository.reconcile(stage.runId, stage.costEstimateUsd, 0);
        this.repository.updateStage(stage.id, { status: 'pending', taskId: null, error: stageError({ code: 'interrupted', message: 'Interrompida: o NeuralBridge foi fechado durante a etapa.', retryable: true }) });
        reset += 1;
      } else continue;
      this.refreshRun(stage.runId);
    }
    return reset;
  }

  /** Restarts the pending (interrupted or retryable failed) stages of a run; completed stages are never rerun. */
  async resume(runId: string): Promise<string[]> {
    const run = this.requireRun(runId);
    if (run.status === 'cancelled') throw new Error('invalid: a produção está cancelada.');
    const started: string[] = [];
    for (const stage of this.repository.listStages(runId)) {
      if (stage.status === 'paused' && stage.taskId) { this.taskEngine.resumePaused(stage.taskId); this.repository.updateStage(stage.id, { status: 'running' }); continue; }
      // Still winding down after a pause: it stops at its next batch boundary.
      if (stage.status === 'paused' && this.controllers.has(stage.id)) continue;
      const retryable = stage.status === 'failed' && stage.error && (JSON.parse(stage.error) as ProductionStageError).retryable && stage.retryCount < MAX_RETRIES;
      if (stage.status !== 'pending' && stage.status !== 'paused' && !retryable) continue;
      const checkpoint = parseCheckpoint(stage);
      if (!this.dependenciesCompleted(runId, checkpoint.dependsOn ?? [])) continue;
      if (!budgetAllows(this.repository.getBudget(runId), stage.costEstimateUsd)) { this.repository.updateStage(stage.id, { status: 'awaiting_approval' }); continue; }
      await this.launch(stage, stage.status === 'failed' || stage.error !== null);
      started.push(stage.id);
    }
    this.refreshRun(runId);
    return started;
  }

  private async launch(stage: VelixProductionStageRow, retry = false): Promise<string | null> {
    const checkpoint = parseCheckpoint(stage);
    this.repository.reserve(stage.runId, stage.costEstimateUsd);
    // Mark running before the task exists so a concurrent schedule of the same input reuses this stage.
    this.repository.updateStage(stage.id, { status: 'running', error: null, ...(checkpoint.adapter ? {} : { progress: 0 }), ...(retry ? { retryCount: stage.retryCount + 1 } : {}) });
    if (checkpoint.adapter) { this.repository.setRunStatus(stage.runId, 'running'); this.startAdapter(stage.id); return null; }
    try {
      const attempt = stage.retryCount + (retry ? 1 : 0);
      const taskId = await this.taskEngine.start({ prompt: checkpoint.prompt ?? '', projectId: checkpoint.taskProjectId, mode: 'auto', access: 'read-only', externalRef: { system: 'velix', id: `stage/${stage.id}/attempt/${attempt}`, revision: attempt } });
      this.repository.updateStage(stage.id, { taskId });
      this.repository.setRunStatus(stage.runId, 'running');
      return taskId;
    } catch (error) {
      this.repository.reconcile(stage.runId, stage.costEstimateUsd, 0);
      this.repository.updateStage(stage.id, { status: 'failed', error: stageError({ code: 'start_failed', message: error instanceof Error ? error.message : String(error), retryable: true }) });
      this.refreshRun(stage.runId);
      throw error;
    }
  }

  private startAdapter(stageId: string): void {
    const stage = this.requireStage(stageId);
    const checkpoint = parseCheckpoint(stage);
    const adapter = checkpoint.adapter ? this.adapters.get(checkpoint.adapter) : undefined;
    if (!adapter) { this.fail(stage, `Não há adaptador para a etapa ${stage.kind}.`, false); this.refreshRun(stage.runId); return; }
    const run = this.requireRun(stage.runId);
    const brief = productionBriefSchema.parse(JSON.parse(run.brief));
    const controller = new AbortController();
    this.controllers.set(stage.id, controller);
    const root = this.repository.projectRoot(run.projectId);
    const context: ProductionStageContext = {
      runId: run.id, stageId: stage.id, projectId: run.projectId, brief, input: checkpoint.input ?? {}, state: { ...(checkpoint.state ?? {}) }, signal: controller.signal,
      saveState: (state) => {
        if (controller.signal.aborted) return;
        this.repository.updateStage(stage.id, { checkpoint: JSON.stringify(productionStageCheckpointSchema.parse({ ...checkpoint, state })) });
      },
      progress: (value) => {
        if (controller.signal.aborted) return;
        this.repository.updateStage(stage.id, { progress: Math.max(0, Math.min(1, value)) });
        this.onChange?.(run.id);
      },
      runStructured: async ({ prompt, outputSchema }) => {
        if (!this.taskEngine.runStructuredReadOnly) throw new Error('unavailable: o TaskEngine não executa capacidades estruturadas.');
        const agent = checkpoint.input?.['agent'] === 'codex' ? 'codex' : 'claude';
        const request: StructuredReadOnlyInput = { projectId: checkpoint.taskProjectId, agent, prompt, outputSchema, origin: 'neura', signal: controller.signal };
        const result = await this.taskEngine.runStructuredReadOnly(request);
        return { structured: result.structured, text: result.text, taskId: result.taskId };
      },
      resolvePath: (relativePath) => {
        if (!root || !isSafeProductionPath(relativePath)) throw new Error('forbidden: o caminho precisa ficar dentro do projeto.');
        const target = resolve(root, relativePath);
        const inside = relative(resolve(root), target);
        if (!inside || inside.startsWith('..')) throw new Error('forbidden: o caminho precisa ficar dentro do projeto.');
        return target;
      },
      recordFile: ({ kind, relativePath, mime, metadata }) => {
        if (controller.signal.aborted) throw new Error('cancelled: a etapa foi interrompida.');
        const target = context.resolvePath(relativePath);
        if (!existsSync(target)) throw new Error('not_found: o arquivo gerado não existe.');
        const contentHash = createHash('sha256').update(readFileSync(target)).digest('hex');
        const artifact = this.repository.recordArtifact({ stageId: stage.id, kind, contentHash, relativePath: relativePath.split('\\').join('/'), mime, ...(metadata ? { metadata } : {}) });
        return { id: artifact.id, relativePath: artifact.relativePath ?? relativePath };
      },
      readArtifact: (kind) => {
        const artifact = this.repository.listArtifacts(run.id).filter((item) => item.kind === kind && item.relativePath).at(-1);
        if (!artifact?.relativePath || !root || !isSafeProductionPath(artifact.relativePath)) return null;
        const target = resolve(root, artifact.relativePath);
        const inside = relative(resolve(root), target);
        if (!inside || inside.startsWith('..') || !existsSync(target)) return null;
        return { id: artifact.id, stageId: artifact.stageId, relativePath: artifact.relativePath, content: readFileSync(target, 'utf8') };
      },
      writeArtifact: ({ kind, relativePath, content, mime, metadata }) => {
        // After a pause or cancel nothing more lands: the saved state and the artifacts must stay in step.
        if (controller.signal.aborted) throw new Error('cancelled: a etapa foi interrompida.');
        if (!root) throw new Error('not_found: projeto Video sem pasta.');
        if (!isSafeProductionPath(relativePath)) throw new Error('forbidden: o caminho do artefato precisa ficar dentro do projeto.');
        const target = resolve(root, relativePath);
        const inside = relative(resolve(root), target);
        if (!inside || inside.startsWith('..') || resolve(root, inside) !== target) throw new Error('forbidden: o caminho do artefato precisa ficar dentro do projeto.');
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
        const contentHash = createHash('sha256').update(content).digest('hex');
        const artifact = this.repository.recordArtifact({ stageId: stage.id, kind, contentHash, relativePath: relativePath.split('\\').join('/'), mime, ...(metadata ? { metadata } : {}) });
        return { id: artifact.id, relativePath: artifact.relativePath ?? relativePath };
      },
    };
    const work = adapter.run(context).then(
      (result) => {
        if (controller.signal.aborted) return;
        this.complete(this.requireStage(stage.id), typeof result?.actualCostUsd === 'number' ? result.actualCostUsd : undefined);
      },
      (error: unknown) => {
        if (controller.signal.aborted) return;
        this.fail(this.requireStage(stage.id), error instanceof Error ? error.message : String(error));
      },
    ).finally(() => {
      this.controllers.delete(stage.id);
      this.running.delete(work);
      this.refreshRun(stage.runId);
      this.onChange?.(stage.runId);
      this.advance(stage.runId);
    });
    this.running.add(work);
  }

  private complete(stage: VelixProductionStageRow, actualUsd = stage.costEstimateUsd): void {
    this.repository.reconcile(stage.runId, stage.costEstimateUsd, actualUsd);
    this.repository.updateStage(stage.id, { status: 'completed', progress: 1, actualCostUsd: actualUsd, error: null });
  }

  private fail(stage: VelixProductionStageRow, message: string, retryable = true): void {
    this.repository.reconcile(stage.runId, stage.costEstimateUsd, 0);
    this.repository.updateStage(stage.id, { status: 'failed', error: stageError({ code: 'task_failed', message, retryable: retryable && stage.retryCount + 1 < MAX_RETRIES }) });
  }

  /** The run's status follows its stages; it is completed only once the export stage completed. */
  private refreshRun(runId: string): void {
    const run = this.requireRun(runId);
    if (run.status === 'cancelled') return;
    const all = this.repository.listStages(runId);
    // Active work counts wherever it is; a failure counts only while it is the latest attempt of its kind, so a stage
    // retried and completed later (or a refused export followed by a good one) no longer marks the run as failed.
    const latest = [...new Map(all.filter((stage) => stage.status !== 'cancelled').map((stage) => [stage.kind, stage])).values()];
    const stages = all;
    const has = (status: string) => (status === 'failed' ? latest : stages).some((stage) => stage.status === status);
    const next = has('running') ? (run.status === 'paused' ? 'paused' : 'running') : has('awaiting_approval') ? 'awaiting_approval' : has('paused') ? 'paused' : has('failed') ? 'failed' : has('pending') ? 'paused' : stages.some((stage) => stage.kind === 'export' && stage.status === 'completed') ? 'completed' : stages.some((stage) => stage.kind === 'preview' && stage.status === 'completed') ? 'awaiting_approval' : stages.length ? 'running' : 'draft';
    if (next !== run.status) this.repository.setRunStatus(runId, next);
  }

  private dependenciesCompleted(runId: string, dependencies: readonly string[]): boolean {
    if (!dependencies.length) return true;
    const completed = new Set(this.repository.listStages(runId).filter((stage) => stage.status === 'completed').map((stage) => stage.kind));
    return dependencies.every((dependency) => completed.has(dependency));
  }

  /** Starts the next persisted stages after a dependency completes; no in-memory plan is required after restart. */
  private advance(runId: string): void {
    if (!this.repository.listStages(runId).some((stage) => stage.status === 'pending')) return;
    void this.resume(runId).catch(() => {
      this.onChange?.(runId);
    });
  }

  private requireRun(runId: string) {
    const run = this.repository.getRun(runId);
    if (!run) throw new Error('production_run_not_found');
    return run;
  }

  private requireStage(stageId: string) {
    const stage = this.repository.getStage(stageId);
    if (!stage) throw new Error('production_stage_not_found');
    return stage;
  }
}
