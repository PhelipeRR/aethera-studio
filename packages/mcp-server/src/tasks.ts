import { and, asc, desc, eq, inArray, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { BrainError, type Scope } from '@neuralbridge/brain';
import { projects, taskSteps, tasks, type DatabaseHandle } from '@neuralbridge/database';
import type { TaskStatus } from '@neuralbridge/shared';

const ACTIVE: TaskStatus[] = ['pending', 'planning', 'running', 'awaiting_approval', 'validating'];
const PROMPT_PREVIEW = 200;

function visibleTasks(scope: Scope): SQL | undefined {
  switch (scope.kind) {
    case 'project':
      return eq(tasks.projectId, scope.projectId);
    case 'global':
      return isNull(tasks.projectId);
    case 'all':
      return scope.includePrivate
        ? undefined
        : or(isNull(tasks.projectId), notInArray(tasks.projectId, sql`(SELECT ${projects.id} FROM ${projects} WHERE ${projects.isPrivate} = 1)`));
  }
}

/** Read-only view of the task engine as recorded in the database. */
export function orchestratorStatus(handle: DatabaseHandle, scope: Scope) {
  const visible = visibleTasks(scope);
  const counts = Object.fromEntries(
    handle.db
      .select({ status: tasks.status, n: sql<number>`count(*)` })
      .from(tasks)
      .where(visible)
      .groupBy(tasks.status)
      .all()
      .map((row) => [row.status, row.n]),
  );
  const active = handle.db
    .select({ id: tasks.id, prompt: tasks.prompt, status: tasks.status, mode: tasks.mode, startedAt: tasks.startedAt })
    .from(tasks)
    .where(and(visible, inArray(tasks.status, ACTIVE)))
    .orderBy(desc(tasks.createdAt))
    .all()
    .map((task) => ({ ...task, prompt: task.prompt.slice(0, PROMPT_PREVIEW) }));
  return { counts, active };
}

export function taskStatus(handle: DatabaseHandle, scope: Scope, taskId: string) {
  const task = handle.db
    .select()
    .from(tasks)
    .where(and(visibleTasks(scope), eq(tasks.id, taskId)))
    .get();
  if (!task) throw new BrainError('not_found', `No task with id ${taskId}.`);
  const steps = handle.db
    .select()
    .from(taskSteps)
    .where(eq(taskSteps.taskId, task.id))
    .orderBy(asc(taskSteps.position))
    .all()
    .map((step) => ({
      position: step.position,
      agent: step.agent,
      kind: step.kind,
      status: step.status,
      inputTokens: step.inputTokens,
      outputTokens: step.outputTokens,
      cachedTokens: step.cachedTokens,
      costUsd: step.costUsd,
      filesChanged: step.filesChanged ? (JSON.parse(step.filesChanged) as string[]) : [],
      error: step.error,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
    }));
  return {
    task: {
      id: task.id,
      prompt: task.prompt,
      projectId: task.projectId,
      mode: task.mode,
      status: task.status,
      parentTaskId: task.parentTaskId,
      summary: task.summary,
      error: task.error,
      createdAt: task.createdAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
    },
    steps,
  };
}
