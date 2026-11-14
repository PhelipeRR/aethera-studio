import { and, asc, desc, eq, exists, inArray, isNotNull, notInArray, sql, type SQL } from 'drizzle-orm';
import type { AgentAdapter } from '@neuralbridge/agents';
import { projects, taskEvents, tasks, taskSteps, type DatabaseHandle } from '@neuralbridge/database';
import { createTaskApplicationService, TaskEngine, type EngineOptions } from '@neuralbridge/orchestrator';
import { CONVERSATION_TITLE_MAX, FINAL_TASK_STATUSES, gitReviewReportSchema, IMAGE_TYPES, smartCommitReportSchema, type GitReviewReport, type GitReviewStartInput, type ImageUpload, type KnownModels, type SmartCommitReport, type SmartCommitStartInput } from '@neuralbridge/shared';
import { readStoredImage, removeStoredImages, storeImages, type StoredImage } from './attachments.js';
import type { AgentId, TaskChanged, TaskDetail, TaskEvent, TaskListFilter, TaskStartInput, TaskStep, TaskSummary, TaskTokens } from '@neuralbridge/shared';

/** MCP tools agents may use during NeuralBridge tasks: reading only. What they learn comes back as proposals for the user's review (decision A9). */
const MCP_TOOLS = ['brain_search', 'brain_recall', 'brain_links'];

/** Kept in the database for debugging, but neither shown nor pushed to the windows. */
const HIDDEN_EVENTS = new Set(['raw', 'done', 'session', 'usage', 'result']);
const LIST_LIMIT = 200;

export interface TaskServiceOptions {
  handle: DatabaseHandle;
  adapters: Record<AgentId, AgentAdapter>;
  /** The app executable and the bundled server script (see mcp.ts). */
  appExecutable: string;
  serverScript: string;
  dataDir?: string | undefined;
  onLearnings?: EngineOptions['onLearnings'];
  contextProvider?: EngineOptions['contextProvider'];
  skillPreferences?: EngineOptions['skillPreferences'];
  skillContextProvider?: EngineOptions['skillContextProvider'];
  skillIntelligenceProvider?: EngineOptions['skillIntelligenceProvider'];
  skillAvailabilityProvider?: EngineOptions['skillAvailabilityProvider'];
  /** Per-task token budget from the user's preferences. */
  tokenBudget?: number;
  /** CORE-04/05: executor identity for task leases (the desktop and the Core each have one). */
  instanceId?: string;
}

/** Creates the task engine for the app and fails tasks that a previous run left unfinished. */
export function createTaskEngine(options: TaskServiceOptions): TaskEngine {
  const engine = new TaskEngine({
    handle: options.handle,
    adapters: options.adapters,
    availability: async () => {
      const [claude, codex] = await Promise.all([options.adapters.claude.detect(), options.adapters.codex.detect()]);
      const usable = (status: Awaited<ReturnType<AgentAdapter['detect']>>) => status.installed && status.problems.length === 0;
      return { claude: usable(claude), codex: usable(codex) };
    },
    // Each run gets the NeuralBridge memory, scoped to the task's project, for that run only.
    mcp: (projectId) => ({
      command: options.appExecutable,
      args: [options.serverScript, ...(projectId ? ['--project', projectId] : [])],
      env: { ELECTRON_RUN_AS_NODE: '1', ...(options.dataDir ? { NB_DATA_DIR: options.dataDir } : {}) },
      tools: MCP_TOOLS,
    }),
    ...(options.onLearnings ? { onLearnings: options.onLearnings } : {}),
    ...(options.contextProvider ? { contextProvider: options.contextProvider } : {}),
    ...(options.skillPreferences ? { skillPreferences: options.skillPreferences } : {}),
    ...(options.skillContextProvider ? { skillContextProvider: options.skillContextProvider } : {}),
    ...(options.skillIntelligenceProvider ? { skillIntelligenceProvider: options.skillIntelligenceProvider } : {}),
    ...(options.skillAvailabilityProvider ? { skillAvailabilityProvider: options.skillAvailabilityProvider } : {}),
    ...(options.tokenBudget ? { limits: { tokenBudget: options.tokenBudget } } : {}),
    ...(options.instanceId ? { instanceId: options.instanceId } : {}),
  });
  const interrupted = engine.recover();
  if (interrupted) console.error(`[tasks] ${interrupted} task(s) interrupted by the last shutdown marked as failed`);
  engine.resumeWaiting();
  return engine;
}

type TaskRow = typeof tasks.$inferSelect & { projectName: string | null };
type StepRow = typeof taskSteps.$inferSelect;

function sum(values: (number | null)[]): number | null {
  return values.some((value) => value !== null) ? values.reduce<number>((total, value) => total + (value ?? 0), 0) : null;
}

function tokensOf(steps: StepRow[]): TaskTokens {
  return {
    input: sum(steps.map((step) => step.inputTokens)),
    output: sum(steps.map((step) => step.outputTokens)),
    cached: sum(steps.map((step) => step.cachedTokens)),
    costUsd: sum(steps.map((step) => step.costUsd)),
  };
}

const filesOf = (step: StepRow): string[] => (step.filesChanged ? (JSON.parse(step.filesChanged) as string[]) : []);

/** Read side of the tasks for the Chat and Executions screens, plus the engine's commands. */
/** A task's stored images; a damaged column counts as none. */
function storedImages(raw: string): StoredImage[] {
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value.filter((entry): entry is StoredImage => typeof entry === 'object' && entry !== null && typeof (entry as StoredImage).path === 'string' && (entry as StoredImage).mime in IMAGE_TYPES);
  } catch {
    return [];
  }
}

export function createTaskService({ handle, engine, notify, attachmentsDir }: { handle: DatabaseHandle; engine: TaskEngine; notify: (change: TaskChanged) => void; attachmentsDir: string }) {
  const db = handle.db;
  const application = createTaskApplicationService(engine);

  engine.on('task', (update) => {
    if (update.kind === 'event' && HIDDEN_EVENTS.has(update.event.kind)) return;
    notify({ taskId: update.taskId, status: update.kind === 'status' ? update.status : null });
  });

  const taskColumns = { task: tasks, projectName: projects.name };
  function rows(where: SQL | undefined, order: 'asc' | 'desc', limit = LIST_LIMIT): TaskRow[] {
    const sort = order === 'asc' ? [asc(tasks.createdAt), asc(sql`${tasks}.rowid`)] : [desc(tasks.createdAt), desc(sql`${tasks}.rowid`)];
    return db
      .select(taskColumns)
      .from(tasks)
      .leftJoin(projects, eq(projects.id, tasks.projectId))
      .where(where)
      .orderBy(...sort)
      .limit(limit)
      .all()
      .map(({ task, projectName }) => ({ ...task, projectName }));
  }

  function stepsByTask(ids: string[]): Map<string, StepRow[]> {
    const grouped = new Map<string, StepRow[]>();
    if (!ids.length) return grouped;
    for (const step of db.select().from(taskSteps).where(inArray(taskSteps.taskId, ids)).orderBy(asc(taskSteps.position)).all()) {
      grouped.set(step.taskId, [...(grouped.get(step.taskId) ?? []), step]);
    }
    return grouped;
  }

  /** Walks up the continuation chain; guarded against cycles in corrupted data. */
  function threadIdOf(task: { id: string; parentTaskId: string | null }): string {
    let current = task;
    const seen = new Set([current.id]);
    while (current.parentTaskId && !seen.has(current.parentTaskId)) {
      const parent = db.select({ id: tasks.id, parentTaskId: tasks.parentTaskId }).from(tasks).where(eq(tasks.id, current.parentTaskId)).get();
      if (!parent) break;
      seen.add(parent.id);
      current = parent;
    }
    return current.id;
  }

  /** Every task of the conversations started by `roots` (continuations follow parentTaskId). */
  function threadMembers(roots: string[]): string[] {
    const ids = [...roots];
    for (let frontier = [...roots]; frontier.length; ) {
      frontier = db.select({ id: tasks.id }).from(tasks).where(inArray(tasks.parentTaskId, frontier)).all().map((task) => task.id).filter((child) => !ids.includes(child));
      ids.push(...frontier);
    }
    return ids;
  }

  function summaries(list: TaskRow[]): TaskSummary[] {
    const steps = stepsByTask(list.map((task) => task.id));
    const threadIds = new Map(list.map((task) => [task.id, threadIdOf(task)]));
    const roots = [...new Set(threadIds.values())];
    const titles = new Map(roots.length ? db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(inArray(tasks.id, roots)).all().map((root) => [root.id, root.title]) : []);
    return list.map((task) => {
      const own = steps.get(task.id) ?? [];
      const threadId = threadIds.get(task.id) ?? task.id;
      return {
        id: task.id,
        prompt: task.prompt,
        projectId: task.projectId,
        projectName: task.projectName,
        mode: task.mode,
        status: task.status,
        parentTaskId: task.parentTaskId,
        threadId,
        threadTitle: titles.get(threadId) ?? null,
        model: task.model,
        summary: task.summary,
        error: task.error,
        createdAt: task.createdAt,
        startedAt: task.startedAt,
        finishedAt: task.finishedAt,
        agents: [...new Set(own.map((step) => step.agent))],
        tokens: tokensOf(own),
        filesChanged: new Set(own.flatMap(filesOf)).size,
        images: storedImages(task.images).map(({ name, mime, size }) => ({ name, mime, size })),
      };
    });
  }

  function detail(task: TaskRow): TaskDetail {
    const [summary] = summaries([task]);
    if (!summary) throw new Error('not_found: Tarefa não encontrada.');
    const steps: TaskStep[] = (stepsByTask([task.id]).get(task.id) ?? []).map((step) => ({
      id: step.id,
      position: step.position,
      agent: step.agent,
      kind: step.kind,
      status: step.status,
      tokens: tokensOf([step]),
      filesChanged: filesOf(step),
      error: step.error,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
    }));
    const events: TaskEvent[] = db
      .select()
      .from(taskEvents)
      .where(eq(taskEvents.taskId, task.id))
      .orderBy(asc(taskEvents.id))
      .all()
      .filter((event) => !HIDDEN_EVENTS.has(event.kind))
      .map((event) => ({ id: event.id, stepId: event.stepId, at: event.at, kind: event.kind, data: JSON.parse(event.data) as Record<string, unknown> }));
    return { ...summary, steps, events, executionSnapshot: engine.executionSnapshot(task.id) };
  }

  function row(id: string): TaskRow {
    const [found] = rows(eq(tasks.id, id), 'asc', 1);
    if (!found) throw new Error('not_found: Tarefa não encontrada.');
    return found;
  }

  return {
    list(filter: TaskListFilter): TaskSummary[] {
      // Neura uses the same TaskEngine for safety and observability, but its spoken exchanges are not user chats.
      const conditions: SQL[] = [eq(tasks.origin, 'user')];
      if (filter.status) conditions.push(eq(tasks.status, filter.status));
      if (filter.projectId) conditions.push(eq(tasks.projectId, filter.projectId));
      if (filter.agent) {
        conditions.push(exists(db.select({ one: sql`1` }).from(taskSteps).where(and(eq(taskSteps.taskId, tasks.id), eq(taskSteps.agent, filter.agent)))));
      }
      if (filter.query?.trim()) {
        // The prompt, or the name of the conversation the task belongs to (kept on its first task).
        const query = filter.query.trim();
        const titled = db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(sql`instr(lower(${tasks.title}), lower(${query})) > 0`).all().map((root) => root.id);
        const inTitled = titled.length ? threadMembers(titled) : [];
        conditions.push(inTitled.length ? sql`(instr(lower(${tasks.prompt}), lower(${query})) > 0 OR ${inArray(tasks.id, inTitled)})` : sql`instr(lower(${tasks.prompt}), lower(${query})) > 0`);
      }
      if (filter.externalSystem) conditions.push(eq(tasks.externalSystem, filter.externalSystem));
      return summaries(rows(conditions.length ? and(...conditions) : undefined, 'desc', Math.min(filter.limit ?? LIST_LIMIT, LIST_LIMIT)));
    },

    get(id: string): TaskDetail {
      return detail(row(id));
    },

    /** The whole conversation a task belongs to, oldest first. */
    thread(id: string): TaskDetail[] {
      const ids = threadMembers([threadIdOf(row(id))]);
      return rows(inArray(tasks.id, ids), 'asc', ids.length).map(detail);
    },

    renameThread(id: string, title: string): void {
      const rootId = threadIdOf(row(id));
      const name = title.replace(/\s+/g, ' ').trim().slice(0, CONVERSATION_TITLE_MAX);
      db.update(tasks).set({ title: name || null }).where(eq(tasks.id, rootId)).run();
      notify({ taskId: rootId, status: null });
    },

    /** Erases the conversation (steps, logs and token records go with each task, by cascade). */
    deleteThread(id: string): { deleted: number } {
      const ids = threadMembers([threadIdOf(row(id))]);
      const busy = db.select({ id: tasks.id }).from(tasks).where(and(inArray(tasks.id, ids), notInArray(tasks.status, [...FINAL_TASK_STATUSES]))).get();
      if (busy) throw new Error('conflict: Há uma tarefa em andamento nesta conversa. Cancele-a antes de excluir.');
      const images = db.select({ images: tasks.images }).from(tasks).where(inArray(tasks.id, ids)).all().flatMap((task) => storedImages(task.images).map((image) => image.path));
      const deleted = handle.sqlite.transaction(() => db.delete(tasks).where(inArray(tasks.id, ids)).run().changes).immediate();
      removeStoredImages(attachmentsDir, images);
      notify({ taskId: id, status: null });
      return { deleted };
    },

    /** Models seen in CLI sessions plus those requested before, per agent, sorted. */
    models(): KnownModels {
      const known: Record<AgentId, Set<string>> = { claude: new Set(), codex: new Set() };
      for (const event of db
        .select({ agent: taskSteps.agent, data: taskEvents.data })
        .from(taskEvents)
        .innerJoin(taskSteps, eq(taskSteps.id, taskEvents.stepId))
        .where(eq(taskEvents.kind, 'session'))
        .all()) {
        try {
          const model = (JSON.parse(event.data) as { model?: unknown }).model;
          if (typeof model === 'string' && model.trim()) known[event.agent].add(model.trim());
        } catch {
          // A damaged event says nothing about models.
        }
      }
      for (const task of db.select({ mode: tasks.mode, model: tasks.model }).from(tasks).where(isNotNull(tasks.model)).all()) {
        if ((task.mode === 'claude' || task.mode === 'codex') && task.model) known[task.mode].add(task.model);
      }
      return { claude: [...known.claude].sort(), codex: [...known.codex].sort() };
    },

    async start(input: TaskStartInput): Promise<{ id: string }> {
      const { images: uploads, ...rest } = input;
      const images = storeImages(attachmentsDir, uploads ?? []);
      try {
        return { id: await application.start({ ...rest, images }) };
      } catch (error) {
        removeStoredImages(attachmentsDir, images.map((image) => image.path));
        throw error;
      }
    },
    async startGitReview(input: GitReviewStartInput): Promise<{ id: string }> {
      return { id: await engine.startGitReview(input) };
    },

    async startSmartCommit(input: SmartCommitStartInput): Promise<{ id: string }> {
      return { id: await engine.startSmartCommit(input) };
    },

    gitReview(id: string): GitReviewReport | null {
      row(id);
      const event = db
        .select({ data: taskEvents.data })
        .from(taskEvents)
        .where(and(eq(taskEvents.taskId, id), eq(taskEvents.kind, 'git_review_result')))
        .orderBy(desc(taskEvents.id))
        .get();
      if (!event) return null;
      try {
        const parsed = gitReviewReportSchema.safeParse(JSON.parse(event.data));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },

    smartCommit(id: string): SmartCommitReport | null {
      row(id);
      const event = db
        .select({ data: taskEvents.data })
        .from(taskEvents)
        .where(and(eq(taskEvents.taskId, id), eq(taskEvents.kind, 'smart_commit_result')))
        .orderBy(desc(taskEvents.id))
        .get();
      if (!event) return null;
      try {
        const parsed = smartCommitReportSchema.safeParse(JSON.parse(event.data));
        return parsed.success ? parsed.data : null;
      } catch {
        return null;
      }
    },
    async startWorkflowStep(input: Pick<TaskStartInput, 'prompt' | 'projectId' | 'mode' | 'skillIds'> & { access?: 'read-only' | 'edit'; timeoutMs?: number }): Promise<{ id: string }> {
      return { id: await engine.start(input) };
    },

    async resume(id: string, prompt: string, uploads: ImageUpload[] = []): Promise<{ id: string }> {
      row(id);
      const images = storeImages(attachmentsDir, uploads);
      try {
        return { id: await application.resume(id, prompt, images) };
      } catch (error) {
        removeStoredImages(attachmentsDir, images.map((image) => image.path));
        throw error;
      }
    },

    /** An attached image as a data URL, read only from the attachments folder. */
    image(id: string, index: number): string {
      const image = storedImages(row(id).images)[index];
      if (!image) throw new Error('not_found: Imagem não encontrada.');
      return readStoredImage(attachmentsDir, image.path, image.mime);
    },

    approve(id: string): void {
      application.approve(id);
    },

    async heal(id: string): Promise<{ id: string }> {
      row(id);
      return { id: await engine.heal(id) };
    },

    cancel(id: string): void {
      application.cancel(id);
    },

    pause(id: string): void {
      row(id);
      application.pause(id);
    },

    resumePaused(id: string): void {
      row(id);
      application.resumePaused(id);
    },

    retryCapacity(id: string): void {
      row(id);
      application.retryCapacity(id);
    },

    setCapacityAutoResume(id: string, enabled: boolean): void {
      row(id);
      application.setCapacityAutoResume(id, enabled);
    },

    async idle(): Promise<void> {
      await application.idle();
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
