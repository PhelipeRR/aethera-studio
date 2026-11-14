import { asc, eq, inArray } from 'drizzle-orm';
import { taskEvents, tokenAnalytics, type DatabaseHandle } from '@neuralbridge/database';
import type { AgentId } from '@neuralbridge/shared';

export interface TokenAnalyticsRow {
  taskId: string;
  agent: AgentId | null;
  estimatedContextTokens: number;
  reportedInputTokens: number;
  reportedOutputTokens: number;
  cachedTokens: number;
  costUsd: number | null;
}

/** Reads only persisted provider/context measurements; missing provider usage remains zero and is never inferred. */
export function tokenAnalyticsForTask(handle: DatabaseHandle, taskId: string): TokenAnalyticsRow[] {
  const rows = handle.db.select().from(tokenAnalytics).where(eq(tokenAnalytics.taskId, taskId)).orderBy(asc(tokenAnalytics.id)).all();
  return rows.map((row) => ({
    taskId: row.taskId,
    agent: row.agent ?? null,
    estimatedContextTokens: row.estimatedContextTokens ?? 0,
    reportedInputTokens: row.reportedInputTokens ?? 0,
    reportedOutputTokens: row.reportedOutputTokens ?? 0,
    cachedTokens: row.cachedTokens ?? 0,
    costUsd: row.costUsd ?? null,
  }));
}

export type SkillUsageRow = { skillId: string; used: number; loaded: number; failed: number; injected: number; lastAt: string };

/** Counts only what runs recorded: a real Skill call, a read of the skill, a failure or context sent to a run. Nothing is inferred. */
export function skillUsageAnalytics(handle: DatabaseHandle): SkillUsageRow[] {
  const rows = new Map<string, SkillUsageRow>();
  const touch = (skillId: string, at: string) => { const row = rows.get(skillId) ?? { skillId, used: 0, loaded: 0, failed: 0, injected: 0, lastAt: at }; if (at > row.lastAt) row.lastAt = at; rows.set(skillId, row); return row; };
  for (const event of handle.db.select().from(taskEvents).where(inArray(taskEvents.kind, ['skill', 'skills_context'])).all()) {
    let payload: { name?: string; status?: string; skills?: string[] };
    try { payload = JSON.parse(event.data) as typeof payload; } catch { continue; }
    if (event.kind === 'skills_context') { for (const skill of payload.skills ?? []) touch(skill, event.at).injected += 1; continue; }
    if (!payload.name) continue;
    const row = touch(payload.name, event.at);
    if (payload.status === 'used') row.used += 1;
    else if (payload.status === 'failed') row.failed += 1;
    else row.loaded += 1;
  }
  return [...rows.values()].sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}
