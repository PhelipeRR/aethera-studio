import type {
  ProductionConsoleService,
  ProductionJobKind,
  ProductionLogEvent,
  ProductionLogOrigin,
  ProductionLogSeverity,
  ProductionLogStage,
} from './production-console.js';

/** The stages a production job goes through, in the order the pipeline runs them. */
export const PRODUCTION_STAGE_ORDER: ProductionLogStage[] = [
  'prompt',
  'interpretacao',
  'pesquisa',
  'roteiro',
  'decupagem',
  'aquisicao',
  'validacao_visual',
  'planejamento',
  'montagem',
  'audio_sfx_vfx',
  'qc',
  'previa',
  'editor',
];

const PRODUCTION_STAGES = new Set<string>(PRODUCTION_STAGE_ORDER);

export function isProductionStage(state: string): state is ProductionLogStage {
  return PRODUCTION_STAGES.has(state);
}

/** Which subsystem owns a stage; used for the origin badge and the origin filter. */
export function stageOrigin(stage: ProductionLogStage): ProductionLogOrigin {
  switch (stage) {
    case 'pesquisa':
      return 'pesquisa';
    case 'aquisicao':
      return 'aquisicao';
    case 'roteiro':
    case 'interpretacao':
    case 'decupagem':
      return 'agent';
    case 'audio_sfx_vfx':
      return 'narracao';
    case 'montagem':
    case 'previa':
    case 'editor':
      return 'renderizacao';
    case 'validacao_visual':
    case 'qc':
      return 'vision';
    default:
      return 'pipeline';
  }
}

export interface PipelineProgressSample {
  projectId: string;
  /** Execution the snapshot belongs to. Tracking is per job: two productions of one project never share state. */
  jobId?: string;
  /** Attempt of the job; a new attempt opens with `job_started` and re-entered stages are reported as retries. */
  attempt?: number;
  state: string;
  progressPct: number;
  message: string;
  completedStages?: string[];
  error?: string;
}

export interface StageTransition {
  stage: ProductionLogStage;
  origin: ProductionLogOrigin;
  event: ProductionLogEvent;
  severity: ProductionLogSeverity;
  message: string;
  pct?: number;
  durationMs?: number;
  details?: Record<string, unknown>;
}

/**
 * Turns the pipeline's job snapshots into lifecycle events. The pipeline writes the job file (and calls `onProgress`)
 * on every state change, so this tracker only names what already happened: a stage started, finished, failed, was
 * re-entered (retry) or paused. It never fabricates a stage the job did not enter.
 */
export class ProductionStageTracker {
  private readonly active = new Map<string, { stage: ProductionLogStage; startedAt: number; lastMessage: string }>();
  private readonly visited = new Map<string, Set<ProductionLogStage>>();
  private readonly attempts = new Map<string, number>();
  /** Terminal state already reported for the current attempt, so a repeated snapshot does not repeat `job_*`. */
  private readonly terminal = new Map<string, string>();

  observe(sample: PipelineProgressSample): StageTransition[] {
    const key = sample.jobId ?? sample.projectId;
    const attempt = sample.attempt ?? 1;
    const pct = Number.isFinite(sample.progressPct) ? Math.min(100, Math.max(0, Math.round(sample.progressPct))) : undefined;
    const opening: StageTransition[] = [];
    const meaningful = isProductionStage(sample.state) || jobEventFor(sample.state) !== null;
    if (meaningful && this.attempts.get(key) !== attempt) {
      const resumed = this.attempts.has(key) || attempt > 1;
      opening.push({
        stage: isProductionStage(sample.state) ? sample.state : 'system',
        origin: 'pipeline',
        event: 'job_started',
        severity: 'info',
        message: resumed ? `Produção retomada (tentativa ${attempt})` : 'Produção iniciada',
        ...(pct !== undefined ? { pct } : {}),
        details: { attempt },
      });
      this.attempts.set(key, attempt);
      this.terminal.delete(key);
      this.active.delete(key); // a stage left open by a previous attempt is not this attempt's stage
    }
    if (this.terminal.get(key) === sample.state) return opening;
    const transitions = [...opening, ...this.observeStages(key, sample, pct)];
    const jobEvent = jobEventFor(sample.state);
    if (jobEvent) {
      const last = transitions[transitions.length - 1];
      transitions.push({
        stage: last?.stage ?? (isProductionStage(sample.state) ? sample.state : 'system'),
        origin: 'pipeline',
        event: jobEvent.event,
        severity: jobEvent.severity,
        message: jobEvent.message(sample),
        ...(pct !== undefined ? { pct } : {}),
        details: { attempt, state: sample.state },
      });
      this.terminal.set(key, sample.state);
    }
    return transitions;
  }

  private observeStages(key: string, sample: PipelineProgressSample, pct: number | undefined): StageTransition[] {
    const transitions: StageTransition[] = [];
    const current = this.active.get(key);

    if (sample.state === 'error') {
      const stage = current?.stage ?? 'system';
      transitions.push({
        stage,
        origin: current ? stageOrigin(stage) : 'pipeline',
        event: 'stage_failed',
        severity: 'error',
        message: sample.message || 'Falha na etapa',
        ...(pct !== undefined ? { pct } : {}),
        ...(current ? { durationMs: Date.now() - current.startedAt } : {}),
        ...(sample.error ? { details: { error: sample.error } } : {}),
      });
      this.active.delete(key);
      return transitions;
    }

    if (sample.state === 'cancelled') {
      const stage = current?.stage ?? 'system';
      transitions.push({
        stage,
        origin: current ? stageOrigin(stage) : 'pipeline',
        event: 'stage_paused',
        severity: 'warn',
        message: sample.message || 'Produção cancelada',
        ...(current ? { durationMs: Date.now() - current.startedAt } : {}),
      });
      this.active.delete(key);
      return transitions;
    }

    if (sample.state.startsWith('paused_pending_')) {
      const stage = current?.stage ?? 'system';
      transitions.push({
        stage,
        origin: current ? stageOrigin(stage) : 'pipeline',
        event: 'stage_paused',
        severity: 'warn',
        message: sample.message || `Aguardando retomada (${sample.state})`,
        ...(pct !== undefined ? { pct } : {}),
        ...(current ? { durationMs: Date.now() - current.startedAt } : {}),
        details: { state: sample.state },
      });
      this.active.delete(key);
      return transitions;
    }

    if (!isProductionStage(sample.state)) return transitions;
    const stage = sample.state;
    const seen = this.visited.get(key) ?? new Set<ProductionLogStage>();

    if (!current) {
      const retry = seen.has(stage);
      transitions.push({
        stage,
        origin: stageOrigin(stage),
        event: retry ? 'stage_retry' : 'stage_started',
        severity: 'info',
        message: sample.message || `Etapa ${stage} iniciada`,
        ...(pct !== undefined ? { pct } : {}),
        ...(retry ? { details: { attempt: (this.visited.get(key)?.size ?? 0) + 1 } } : {}),
      });
      this.active.set(key, { stage, startedAt: Date.now(), lastMessage: sample.message });
      seen.add(stage);
      this.visited.set(key, seen);
      return transitions;
    }

    if (current.stage === stage) {
      // Same stage, new snapshot: report progress only when the human message really changed, so the console is not
      // flooded with identical lines.
      if (sample.message && sample.message !== current.lastMessage) {
        transitions.push({
          stage,
          origin: stageOrigin(stage),
          event: 'log',
          severity: 'info',
          message: sample.message,
          ...(pct !== undefined ? { pct } : {}),
        });
        current.lastMessage = sample.message;
      }
      return transitions;
    }

    transitions.push({
      stage: current.stage,
      origin: stageOrigin(current.stage),
      event: 'stage_completed',
      severity: 'info',
      message: `Etapa ${current.stage} concluída`,
      ...(pct !== undefined ? { pct } : {}),
      durationMs: Date.now() - current.startedAt,
    });
    const retry = seen.has(stage);
    transitions.push({
      stage,
      origin: stageOrigin(stage),
      event: retry ? 'stage_retry' : 'stage_started',
      severity: 'info',
      message: sample.message || `Etapa ${stage} iniciada`,
      ...(pct !== undefined ? { pct } : {}),
    });
    this.active.set(key, { stage, startedAt: Date.now(), lastMessage: sample.message });
    seen.add(stage);
    this.visited.set(key, seen);
    return transitions;
  }

  /** Forgets a job (e.g. when it is removed or restarted from scratch). */
  reset(jobId: string): void {
    this.active.delete(jobId);
    this.visited.delete(jobId);
    this.attempts.delete(jobId);
    this.terminal.delete(jobId);
  }
}

/** Whole-job outcome of a pipeline state, or null while the job is still running. */
function jobEventFor(state: string): {
  event: ProductionLogEvent;
  severity: ProductionLogSeverity;
  message: (sample: PipelineProgressSample) => string;
} | null {
  if (state === 'editor') return { event: 'job_completed', severity: 'info', message: () => 'Produção concluída' };
  if (state === 'error') {
    return { event: 'job_failed', severity: 'error', message: (s) => `Produção falhou${s.error ? `: ${s.error}` : ''}` };
  }
  if (state === 'cancelled') return { event: 'job_cancelled', severity: 'warn', message: () => 'Produção cancelada' };
  if (state.startsWith('paused_pending_')) {
    return { event: 'job_paused', severity: 'warn', message: () => `Produção pausada (${state})` };
  }
  return null;
}

/** The part of a pipeline job snapshot the console needs. */
export interface PipelineJobSnapshot {
  projectId: string;
  jobId?: string;
  attempt?: number;
  prompt?: string;
  state: string;
  progressPct: number;
  message: string;
  error?: string;
}

/**
 * Records one pipeline snapshot in the console of ITS job: binds the project to the job while it runs (so agents,
 * research, media, narration and render lines emitted with only a `projectId` land in this job), writes the stage
 * and job lifecycle events, and releases the binding when the job finishes, pauses or is cancelled.
 */
export function recordPipelineSnapshot(
  consoleService: ProductionConsoleService,
  tracker: ProductionStageTracker,
  job: PipelineJobSnapshot,
  kind: ProductionJobKind = 'video',
): { jobId: string; attempt: number } {
  const jobId = job.jobId ?? job.projectId;
  const attempt = job.attempt ?? 1;
  const finished = jobEventFor(job.state) !== null;
  const bound = consoleService.activeJob(job.projectId);
  if (!finished && (bound?.jobId !== jobId || bound.attempt !== attempt)) {
    consoleService.bindJob({
      jobId,
      projectId: job.projectId,
      attempt,
      kind,
      ...(job.prompt ? { title: job.prompt.slice(0, 140) } : {}),
    });
  }
  const transitions = tracker.observe({
    projectId: job.projectId,
    jobId,
    attempt,
    state: job.state,
    progressPct: job.progressPct,
    message: job.message,
    ...(job.error ? { error: job.error } : {}),
  });
  for (const transition of transitions) {
    consoleService.emit({
      projectId: job.projectId,
      jobId,
      attempt,
      stage: transition.stage,
      origin: transition.origin,
      event: transition.event,
      channel: 'progress',
      severity: transition.severity,
      source: 'pipeline',
      message: transition.message,
      ...(transition.pct !== undefined ? { pct: transition.pct } : {}),
      ...(transition.durationMs !== undefined ? { durationMs: transition.durationMs } : {}),
      ...(transition.details ? { details: transition.details } : {}),
    });
  }
  if (finished) consoleService.releaseJob(jobId);
  return { jobId, attempt };
}
