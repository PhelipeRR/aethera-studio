import { eq } from 'drizzle-orm';
import { tasks, type DatabaseHandle } from '@neuralbridge/database';
import type { TaskLeases } from '@neuralbridge/orchestrator';
import type { TaskDetail, TaskSummary } from '@neuralbridge/shared';
import type { CoreTask } from '@neuralbridge/shared/core-api';

/*
 * CORE-05: maps the existing task read model (the same rows the desktop shows) to the public CORE-02 `Task`. Nothing is
 * invented: access null is the engine's default (edit); the creator is the desktop unless an orchestrator reference says
 * otherwise (devices arrive with CORE-07 and are recorded then).
 */

const iso = (value: string | null): string | null => (value === null ? null : new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`).toISOString());

export function toCoreTask(task: TaskSummary | TaskDetail, handle: DatabaseHandle, leases: TaskLeases, lastEventId: number): CoreTask {
  const row = handle.db.select({ access: tasks.access, externalSystem: tasks.externalSystem, externalId: tasks.externalId, externalRevision: tasks.externalRevision }).from(tasks).where(eq(tasks.id, task.id)).get();
  const snapshot = 'executionSnapshot' in task ? task.executionSnapshot : null;
  const lease = leases.current(task.id);
  const external = row?.externalSystem && row.externalId ? { system: row.externalSystem, id: row.externalId, revision: row.externalRevision ?? 0 } : null;
  return {
    id: task.id,
    prompt: task.prompt,
    projectId: task.projectId,
    mode: task.mode,
    access: row?.access ?? 'edit',
    status: task.status,
    parentTaskId: task.parentTaskId,
    threadId: task.threadId,
    model: task.model,
    summary: task.summary,
    error: task.error,
    agents: task.agents,
    tokens: task.tokens,
    filesChanged: task.filesChanged,
    approval: snapshot?.approval ?? 'not-required',
    cancellation: snapshot?.cancellation ?? 'none',
    executor: lease ? { instanceId: lease.ownerInstanceId.slice(0, 64).replace(/[^A-Za-z0-9_-]/g, '_'), leaseExpiresAt: lease.leaseExpiresAt, attempt: snapshot?.attempt ?? 0 } : null,
    externalRef: external,
    createdBy: external ? { kind: 'orchestrator', id: external.system, label: null } : { kind: 'desktop', id: 'desktop', label: null },
    correlationId: snapshot?.correlationId && snapshot.correlationId.length >= 8 ? snapshot.correlationId : null,
    createdAt: iso(task.createdAt) ?? task.createdAt,
    startedAt: iso(task.startedAt),
    finishedAt: iso(task.finishedAt),
    lastEventId,
  };
}
