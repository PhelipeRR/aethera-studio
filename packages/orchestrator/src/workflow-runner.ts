import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { tasks, taskSteps, workflowCheckpoints, workflowRuns, workflowRunSteps, workflowStepAttempts, type DatabaseHandle } from '@neuralbridge/database';
import { compileWorkflow, interpolate, type WorkflowDefinitionV2, type WorkflowRecovery, type WorkflowStep } from '@neuralbridge/shared';
import { backoffDelay, decideRecovery, failureKindOf } from './recovery-policy.js';

type NativeStep = Extract<WorkflowStep, { kind: 'rag' | 'validation' | 'git' }>;
type AgentStep = Extract<WorkflowStep, { kind: 'agent' }>;
type StepRow = typeof workflowRunSteps.$inferSelect;
type RunRow = typeof workflowRuns.$inferSelect;

export type WorkflowTrigger = { kind: string; ref?: string; hash?: string; base?: string; head?: string };
export interface WorkflowNativeContext { projectId: string | null; inputs: Record<string, unknown>; outputs: Record<string, unknown>; trigger: WorkflowTrigger | null }
export interface WorkflowTaskRequest { prompt: string; projectId: string | null; mode: 'auto' | 'claude' | 'codex'; access: 'read-only' | 'edit'; timeoutMs?: number; skillIds?: string[]; externalRef?: { system: 'workflow'; id: string; revision: number } }
export interface WorkflowCoordinatorPorts {
  handle: DatabaseHandle;
  startTask: (input: WorkflowTaskRequest) => Promise<{ id: string }>;
  cancelTask?: (id: string) => void;
  pauseTask?: (id: string) => void;
  resumeTask?: (id: string) => void;
  executeNative?: (step: NativeStep, context: WorkflowNativeContext) => Promise<string>;
  /** Which of these skills cannot be used now. Without it, required skills cannot be confirmed and the step stops. */
  missingSkills?: (ids: readonly string[]) => Promise<string[]>;
  /** Injected so tests do not wait for real backoff. */
  delay?: (ms: number, run: () => void) => void;
  random?: () => number;
}
export type WorkflowDecision = 'retry' | 'skip' | 'abort';

const FINAL_RUN = ['completed', 'failed', 'cancelled'];
const FINAL_TASK = ['completed', 'failed', 'cancelled'];
const DONE = ['completed', 'skipped'];
const STARTABLE = ['pending', 'approved'];
/** Temporary provider trouble is worth waiting out even when the workflow sets no policy. */
const DEFAULT_RECOVERY: WorkflowRecovery = { retry: { maxAttempts: 3, baseDelayMs: 2_000, maxDelayMs: 60_000, maxTotalMs: 600_000, jitter: 'full', on: ['rate_limit', 'provider_overloaded', 'network', 'timeout'] } };

/**
 * Runs workflows over the TaskEngine. All state lives in the database and every move is a function of
 * it, so continuing after a restart is the same code as continuing after a step: there is no recovery path
 * of its own. Agent steps are tasks; this module never talks to a CLI.
 */
export function createWorkflowCoordinator(ports: WorkflowCoordinatorPorts) {
  const { handle } = ports;
  const db = handle.db;
  const delay = ports.delay ?? ((ms: number, run: () => void) => void setTimeout(run, ms));
  const random = ports.random ?? Math.random;
  const queues = new Map<string, Promise<unknown>>();
  const inFlight = new Map<string, Set<Promise<unknown>>>();

  /** One move at a time per run: two triggers must not both see a step as free. */
  const serial = <T>(runId: string, work: () => Promise<T>): Promise<T> => {
    const next = (queues.get(runId) ?? Promise.resolve()).then(work, work);
    queues.set(runId, next.catch(() => undefined));
    return next;
  };
  const track = (runId: string, work: Promise<unknown>) => {
    const set = inFlight.get(runId) ?? new Set();
    inFlight.set(runId, set);
    set.add(work);
    void work.finally(() => set.delete(work));
  };

  const now = () => new Date().toISOString();
  const runOf = (id: string): RunRow | undefined => db.select().from(workflowRuns).where(eq(workflowRuns.id, id)).get();
  const stepsOf = (id: string): StepRow[] => db.select().from(workflowRunSteps).where(eq(workflowRunSteps.runId, id)).all();
  const definitionOf = (run: RunRow): WorkflowDefinitionV2 => compileWorkflow(JSON.parse(run.definitionSnapshot ?? '{}')).definition;
  const triggerOf = (run: RunRow): WorkflowTrigger | null => (run.trigger ? (JSON.parse(run.trigger) as WorkflowTrigger) : null);
  const setRun = (id: string, patch: Partial<typeof workflowRuns.$inferInsert>) => db.update(workflowRuns).set({ ...patch, updatedAt: now() }).where(eq(workflowRuns.id, id)).run();
  const setStep = (row: StepRow, patch: Partial<typeof workflowRunSteps.$inferInsert>) => db.update(workflowRunSteps).set(patch).where(eq(workflowRunSteps.id, row.id)).run();
  const outputsOf = (id: string) => Object.fromEntries(stepsOf(id).filter((row) => row.output !== null).map((row) => [row.stepId, row.output]));
  const inputsOf = (run: RunRow) => JSON.parse(run.inputs) as Record<string, unknown>;
  const recoveryOf = (definition: WorkflowDefinitionV2, step: WorkflowStep): WorkflowRecovery => step.recovery ?? definition.recovery ?? DEFAULT_RECOVERY;
  const attemptsOf = (runId: string, stepId: string) => db.select().from(workflowStepAttempts).where(and(eq(workflowStepAttempts.runId, runId), eq(workflowStepAttempts.stepId, stepId))).all().sort((a, b) => a.attempt - b.attempt);

  const checkpoint = (run: RunRow, meta: Record<string, unknown>, provider: string | null = null) => {
    const rows = stepsOf(run.id);
    const sequence = db.select({ id: workflowCheckpoints.id }).from(workflowCheckpoints).where(eq(workflowCheckpoints.runId, run.id)).all().length;
    db.insert(workflowCheckpoints).values({
      id: randomUUID(),
      runId: run.id,
      workflowId: run.workflowId,
      definitionVersion: run.definitionVersion ?? 0,
      sequence,
      completed: JSON.stringify(rows.filter((row) => DONE.includes(row.status)).map((row) => row.stepId)),
      pending: JSON.stringify(rows.filter((row) => !DONE.includes(row.status)).map((row) => row.stepId)),
      artifacts: JSON.stringify(rows.flatMap((row) => (row.taskId ? [`task://${row.taskId}`] : []))),
      provider,
      approvalState: JSON.stringify(rows.filter((row) => row.status === 'awaiting_approval').map((row) => row.stepId)),
      recoveryMeta: JSON.stringify(meta),
    }).run();
  };

  const stopTasks = (run: RunRow, stepRows: StepRow[], status: string, except?: string) => {
    for (const row of stepRows) {
      if (row.stepId === except || row.status !== 'running') continue;
      if (row.taskId) ports.cancelTask?.(row.taskId);
      setStep(row, { status, finishedAt: now() });
    }
    checkpoint(run, { event: status });
  };

  const fail = (run: RunRow, message: string, except?: string) => {
    setRun(run.id, { status: 'failed', error: message });
    stopTasks(run, stepsOf(run.id), 'cancelled', except);
  };

  const finishStep = (run: RunRow, row: StepRow, output: string | null) => {
    setStep(row, { status: 'completed', output, finishedAt: now() });
    checkpoint(run, { event: 'step_completed', step: row.stepId });
  };

  /** A step counts as having side effects if its task recorded changing a file. */
  const changedFiles = (taskId: string | null): boolean => {
    if (!taskId) return false;
    return db.select({ files: taskSteps.filesChanged }).from(taskSteps).where(eq(taskSteps.taskId, taskId)).all().some((row) => (JSON.parse(row.files ?? '[]') as string[]).length > 0);
  };

  const handleFailure = async (run: RunRow, row: StepRow, step: WorkflowStep, error: string): Promise<void> => {
    const definition = definitionOf(run);
    const attempts = attemptsOf(run.id, step.id);
    const failure = failureKindOf(error);
    const treeChanged = changedFiles(row.taskId);
    const access = step.kind === 'agent' ? step.access : 'read-only';
    const decision = decideRecovery({ failure, attempt: attempts.length, treeChanged, access, policy: recoveryOf(definition, step), elapsedMs: Date.now() - Date.parse(run.createdAt) });
    const last = attempts.at(-1);
    if (last) db.update(workflowStepAttempts).set({ failureKind: failure, decision: decision.action, reason: decision.reason, finishedAt: now() }).where(eq(workflowStepAttempts.id, last.id)).run();
    if (decision.action === 'retry') {
      const policy = recoveryOf(definition, step).retry;
      const wait = policy ? backoffDelay(attempts.length, policy.baseDelayMs, policy.maxDelayMs, random) : 0;
      if (last) db.update(workflowStepAttempts).set({ delayMs: Math.round(wait) }).where(eq(workflowStepAttempts.id, last.id)).run();
      setStep(row, { status: 'retry_wait', taskId: null, error });
      setRun(run.id, { status: 'retrying' });
      checkpoint(run, { event: 'retry_scheduled', step: step.id, failure, delayMs: Math.round(wait) });
      delay(wait, () => void serial(run.id, async () => {
        const fresh = stepsOf(run.id).find((item) => item.stepId === step.id);
        const current = runOf(run.id);
        if (fresh?.status !== 'retry_wait' || current?.status !== 'retrying') return;
        setStep(fresh, { status: 'pending' });
        setRun(run.id, { status: 'running' });
        await advanceNow(run.id);
      }));
      return;
    }
    if (decision.action === 'fallback' && step.kind === 'agent') {
      const to = recoveryOf(definition, step).fallback?.to ?? (step.agent === 'codex' ? 'claude' : 'codex');
      if (last) db.update(workflowStepAttempts).set({ provider: to }).where(eq(workflowStepAttempts.id, last.id)).run();
      setStep(row, { status: 'pending', taskId: null, error });
      checkpoint(run, { event: 'fallback', step: step.id, failure, to }, to);
      return;
    }
    if (decision.action === 'decision') {
      setStep(row, { status: 'needs_decision', error });
      setRun(run.id, { status: 'interrupted', error: decision.reason });
      checkpoint(run, { event: 'needs_decision', step: step.id, failure });
      return;
    }
    setStep(row, { status: 'failed', error, finishedAt: now() });
    fail(run, `Etapa ${step.title}: ${error}`, step.id);
  };

  const startAgent = async (run: RunRow, row: StepRow, step: AgentStep, definition: WorkflowDefinitionV2) => {
    const attempts = attemptsOf(run.id, step.id);
    const fallbackTo = attempts.findLast((attempt) => attempt.decision === 'fallback')?.provider;
    const agent = (fallbackTo as AgentStep['agent'] | null | undefined) ?? step.agent;
    const mode = agent !== 'auto' ? agent : step.mode === 'collab' ? 'auto' : step.mode;
    db.insert(workflowStepAttempts).values({ id: randomUUID(), runId: run.id, stepId: step.id, attempt: attempts.length + 1, provider: mode === 'auto' ? null : mode, decision: 'started', startedAt: now() }).run();
    const prompt = interpolate(step.prompt, { inputs: inputsOf(run), outputs: outputsOf(run.id) });
    const required = step.requiredSkillIds ?? [];
    if (required.length > 0) {
      const missing = ports.missingSkills ? await ports.missingSkills(required) : required;
      if (missing.length > 0) {
        await handleFailure(run, row, step, `Skills obrigatórias indisponíveis: ${missing.join(', ')}.`);
        return;
      }
    }
    let id: string;
    try {
      ({ id } = await ports.startTask({ prompt, projectId: definition.projectId, mode, access: step.access, ...(step.timeoutMs !== undefined ? { timeoutMs: step.timeoutMs } : {}), ...(step.skillIds?.length || required.length ? { skillIds: [...new Set([...(step.skillIds ?? []), ...required])] } : {}), externalRef: { system: 'workflow', id: `${run.id}/${step.id}`, revision: attempts.length + 1 } }));
    } catch (error) {
      await handleFailure(run, row, step, error instanceof Error ? error.message : String(error));
      return;
    }
    setStep(row, { taskId: id });
    setRun(run.id, { taskIds: JSON.stringify([...(JSON.parse(runOf(run.id)?.taskIds ?? '[]') as string[]), id]) });
    checkpoint(run, { event: 'step_started', step: step.id }, mode === 'auto' ? null : mode);
    // A short task can finish before the id above is saved, and its event would find no step.
    const task = db.select().from(tasks).where(eq(tasks.id, id)).get();
    if (task && FINAL_TASK.includes(task.status)) await settleTask({ ...row, taskId: id }, task.status, task.summary, task.error);
  };

  const startNative = (run: RunRow, row: StepRow, step: NativeStep, definition: WorkflowDefinitionV2) => {
    const context: WorkflowNativeContext = { projectId: definition.projectId, inputs: inputsOf(run), outputs: outputsOf(run.id), trigger: triggerOf(run) };
    const resolved = step.kind === 'rag' ? { ...step, query: interpolate(step.query, context) } : step;
    const execute = ports.executeNative;
    track(run.id, (async () => {
      let output: string | null = null;
      let failure: string | null = null;
      try {
        if (!execute) throw new Error(`Executor nativo ${step.kind} indisponível.`);
        output = await execute(resolved, context);
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error);
      }
      await serial(run.id, async () => {
        const fresh = runOf(run.id);
        const current = stepsOf(run.id).find((item) => item.stepId === step.id);
        if (!fresh || !current || current.status !== 'running') return;
        if (failure !== null) await handleFailure(fresh, current, step, failure);
        else finishStep(fresh, current, output);
        await advanceNow(run.id);
      });
    })());
  };

  const conditionHolds = (step: Extract<WorkflowStep, { kind: 'condition' }>, outputs: Record<string, unknown>) => {
    const { step: source, contains } = step.when;
    return String(outputs[source] ?? '').includes(contains);
  };

  /** Only what the providers reported counts: a task without usage adds nothing, it is never estimated. */
  const tokensSpent = (runId: string) => {
    const taskIds = stepsOf(runId).flatMap((row) => (row.taskId ? [row.taskId] : []));
    if (taskIds.length === 0) return 0;
    return ports.handle.db.select({ input: taskSteps.inputTokens, output: taskSteps.outputTokens }).from(taskSteps).where(inArray(taskSteps.taskId, taskIds)).all().reduce((sum, row) => sum + (row.input ?? 0) + (row.output ?? 0), 0);
  };

  async function advanceNow(runId: string): Promise<void> {
    for (;;) {
      const run = runOf(runId);
      if (!run || !['running', 'waiting_approval'].includes(run.status)) return;
      const definition = definitionOf(run);
      const limit = definition.limits?.maxDurationMs;
      if (limit !== undefined && run.status === 'running' && Date.now() - Date.parse(run.createdAt) > limit) {
        fail(run, 'A execução passou do limite de duração.');
        return;
      }
      const tokenLimit = definition.limits?.maxTokens;
      if (tokenLimit !== undefined && run.status === 'running' && tokensSpent(runId) > tokenLimit) {
        fail(run, 'A execução passou do limite de tokens.');
        return;
      }
      const rows = new Map(stepsOf(runId).map((row) => [row.stepId, row]));
      const statusOf = (id: string) => rows.get(id)?.status;
      let moved = false;
      for (const step of definition.steps) {
        const row = rows.get(step.id);
        if (row?.status === 'pending' && step.dependsOn.some((id) => statusOf(id) === 'skipped')) {
          setStep(row, { status: 'skipped', finishedAt: now() });
          moved = true;
        }
      }
      if (moved) continue;
      let free = definition.maxParallel - [...rows.values()].filter((row) => row.status === 'running').length;
      for (const step of definition.steps) {
        const row = rows.get(step.id);
        if (!row || !STARTABLE.includes(row.status) || !step.dependsOn.every((id) => DONE.includes(statusOf(id) ?? ''))) continue;
        const automated = triggerOf(run) !== null && step.kind === 'agent' && step.access === 'edit';
        if (row.status === 'pending' && (step.kind === 'approval' || step.requiresApproval || automated)) {
          setStep(row, { status: 'awaiting_approval' });
          checkpoint(run, { event: 'approval_requested', step: step.id });
          continue;
        }
        if (step.kind === 'condition') {
          const holds = conditionHolds(step, outputsOf(runId));
          setStep(row, { status: holds ? 'completed' : 'skipped', finishedAt: now() });
          moved = true;
          break;
        }
        if (free <= 0) continue;
        free -= 1;
        // Conditional update: the row, not this process's memory, decides who owns the step.
        const claimed = db.update(workflowRunSteps).set({ status: 'running', startedAt: now(), error: null }).where(and(eq(workflowRunSteps.id, row.id), inArray(workflowRunSteps.status, STARTABLE))).run();
        if (Number(claimed.changes) !== 1) continue;
        const running = { ...row, status: 'running' };
        if (step.kind === 'agent') {
          await startAgent(run, running, step, definition);
          moved = true;
          break;
        }
        if (step.kind === 'approval') continue;
        startNative(run, running, step, definition);
      }
      if (moved) continue;
      const latest = stepsOf(runId);
      const current = runOf(runId);
      if (!current || !['running', 'waiting_approval'].includes(current.status)) return;
      if (latest.every((row) => DONE.includes(row.status))) {
        setRun(runId, { status: 'completed', error: null, currentLayer: compileWorkflow(definition).layers.length });
        checkpoint(current, { event: 'completed' });
      } else {
        setRun(runId, { status: latest.some((row) => row.status === 'awaiting_approval') ? 'waiting_approval' : 'running', currentLayer: layerOf(definition, latest) });
      }
      return;
    }
  }

  const layerOf = (definition: WorkflowDefinitionV2, rows: StepRow[]) => {
    const done = new Set(rows.filter((row) => DONE.includes(row.status)).map((row) => row.stepId));
    const index = compileWorkflow(definition).layers.findIndex((layer) => layer.some((step) => !done.has(step.id)));
    return index === -1 ? 0 : index;
  };

  async function settleTask(row: StepRow, status: string, summary: string | null, error: string | null): Promise<void> {
    const run = runOf(row.runId);
    if (!run || FINAL_RUN.includes(run.status)) return;
    if (status === 'completed') {
      finishStep(run, row, summary);
      return;
    }
    const step = definitionOf(run).steps.find((item) => item.id === row.stepId);
    if (status === 'cancelled') {
      setStep(row, { status: 'cancelled', finishedAt: now() });
      fail(run, `Etapa ${step?.title ?? row.stepId} foi cancelada.`, row.stepId);
      return;
    }
    if (step) await handleFailure(run, row, step, error ?? `Etapa ${step.title} falhou.`);
  }

  return {
    /** Records the run and all its steps, then starts what is ready. Returns the run id. */
    async start(workflowId: string, definition: WorkflowDefinitionV2, version: number, options: { inputs?: Record<string, unknown>; trigger?: WorkflowTrigger } = {}): Promise<string> {
      const missing = definition.inputs.filter((input) => input.required && !String(options.inputs?.[input.id] ?? '').trim());
      if (missing.length) throw new Error(`invalid: Preencha: ${missing.map((input) => input.label).join(', ')}.`);
      const id = randomUUID();
      handle.sqlite.transaction(() => {
        db.insert(workflowRuns).values({ id, workflowId, status: 'running', approved: true, definitionSnapshot: JSON.stringify(definition), definitionVersion: version, inputs: JSON.stringify(options.inputs ?? {}), trigger: options.trigger ? JSON.stringify(options.trigger) : null }).run();
        for (const step of definition.steps) db.insert(workflowRunSteps).values({ id: randomUUID(), runId: id, stepId: step.id, status: 'pending' }).run();
      }).immediate();
      await serial(id, () => advanceNow(id));
      return id;
    },
    advance: (runId: string) => serial(runId, () => advanceNow(runId)),
    /** Resolves when the native work of a run has landed (tests and shutdown). */
    async settled(runId: string): Promise<void> {
      for (let set = inFlight.get(runId); set?.size; set = inFlight.get(runId)) await Promise.allSettled([...set]);
      await queues.get(runId);
    },
    /** Called for every task status change; ignores tasks that are not workflow steps. */
    async onTask(taskId: string, status: string, error: string | null = null): Promise<void> {
      if (!FINAL_TASK.includes(status)) return;
      const found = db.select().from(workflowRunSteps).where(eq(workflowRunSteps.taskId, taskId)).get();
      if (!found) return;
      await serial(found.runId, async () => {
        const row = stepsOf(found.runId).find((item) => item.id === found.id);
        if (row?.status !== 'running' || row.taskId !== taskId) return;
        const task = db.select({ summary: tasks.summary, error: tasks.error }).from(tasks).where(eq(tasks.id, taskId)).get();
        await settleTask(row, status, task?.summary ?? null, error ?? task?.error ?? null);
        await advanceNow(found.runId);
      });
    },
    approve: (runId: string, stepId: string) => serial(runId, async () => {
      const run = runOf(runId);
      const row = stepsOf(runId).find((item) => item.stepId === stepId);
      if (!run || !row) throw new Error('not_found: Etapa não encontrada.');
      if (row.status !== 'awaiting_approval') return;
      const step = definitionOf(run).steps.find((item) => item.id === stepId);
      setStep(row, step?.kind === 'approval' ? { status: 'completed', finishedAt: now() } : { status: 'approved' });
      if (run.status === 'waiting_approval') setRun(runId, { status: 'running' });
      checkpoint(run, { event: 'approved', step: stepId });
      await advanceNow(runId);
    }),
    reject: (runId: string, stepId: string) => serial(runId, async () => {
      const run = runOf(runId);
      const row = stepsOf(runId).find((item) => item.stepId === stepId);
      if (!run || !row) throw new Error('not_found: Etapa não encontrada.');
      setStep(row, { status: 'cancelled', finishedAt: now() });
      setRun(runId, { status: 'cancelled', error: `Etapa ${stepId} rejeitada.` });
      stopTasks(run, stepsOf(runId), 'cancelled', stepId);
    }),
    pause: (runId: string) => serial(runId, async () => {
      const run = runOf(runId);
      if (!run) throw new Error('not_found: Execução não encontrada.');
      if (FINAL_RUN.includes(run.status)) return;
      setRun(runId, { status: 'paused' });
      for (const row of stepsOf(runId)) if (row.status === 'running' && row.taskId) ports.pauseTask?.(row.taskId);
      checkpoint(run, { event: 'paused' });
    }),
    resume: (runId: string) => serial(runId, async () => {
      const run = runOf(runId);
      if (!run) throw new Error('not_found: Execução não encontrada.');
      if (run.status !== 'paused') return;
      setRun(runId, { status: 'running', error: null });
      for (const row of stepsOf(runId)) if (row.status === 'running' && row.taskId) ports.resumeTask?.(row.taskId);
      await advanceNow(runId);
    }),
    cancel: (runId: string) => serial(runId, async () => {
      const run = runOf(runId);
      if (!run) throw new Error('not_found: Execução não encontrada.');
      if (FINAL_RUN.includes(run.status)) return;
      setRun(runId, { status: 'cancelled' });
      stopTasks(run, stepsOf(runId), 'cancelled');
    }),
    /** The person's answer for a step the coordinator would not decide alone. */
    decide: (runId: string, stepId: string, choice: WorkflowDecision) => serial(runId, async () => {
      const run = runOf(runId);
      const row = stepsOf(runId).find((item) => item.stepId === stepId);
      if (!run || !row) throw new Error('not_found: Etapa não encontrada.');
      if (row.status !== 'needs_decision') return;
      if (choice === 'abort') {
        setStep(row, { status: 'failed', finishedAt: now() });
        fail(run, row.error ?? 'Execução encerrada pelo usuário.', stepId);
        return;
      }
      setStep(row, choice === 'retry' ? { status: 'pending', taskId: null } : { status: 'completed', finishedAt: now() });
      setRun(runId, { status: 'running', error: null });
      checkpoint(run, { event: 'decided', step: stepId, choice });
      await advanceNow(runId);
    }),
    /**
     * Called at startup. A finished step is never repeated, an interrupted read-only one is repeated only
     * if the workflow allows it, and an interrupted edit always waits for a person.
     */
    async recover(): Promise<number> {
      const open = db.select().from(workflowRuns).where(inArray(workflowRuns.status, ['running', 'retrying', 'waiting_approval'])).all();
      for (const run of open) {
        await serial(run.id, async () => {
          let definition: WorkflowDefinitionV2;
          try {
            definition = definitionOf(run);
          } catch {
            setRun(run.id, { status: 'failed', error: 'A definição desta execução não pode mais ser lida.' });
            return;
          }
          const auto = definition.recovery?.autoResume === true;
          let blocked = false;
          for (const row of stepsOf(run.id)) {
            if (row.status === 'retry_wait') { setStep(row, { status: 'pending' }); continue; }
            if (row.status !== 'running') continue;
            const task = row.taskId ? db.select().from(tasks).where(eq(tasks.id, row.taskId)).get() : undefined;
            if (task?.status === 'completed') { finishStep(run, row, task.summary); continue; }
            const step = definition.steps.find((item) => item.id === row.stepId);
            const edits = step?.kind === 'agent' && step.access === 'edit';
            if (!edits && auto) { setStep(row, { status: 'pending', taskId: null }); continue; }
            setStep(row, { status: 'needs_decision', error: 'Interrompida ao fechar o aplicativo.' });
            blocked = true;
          }
          setRun(run.id, blocked ? { status: 'interrupted', error: 'Execução interrompida: confirme como continuar.' } : { status: run.status === 'waiting_approval' ? 'waiting_approval' : 'running' });
          checkpoint(run, { event: 'recovered', blocked });
          if (!blocked) await advanceNow(run.id);
        });
      }
      return open.length;
    },
  };
}
