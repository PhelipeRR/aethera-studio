import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { gitAutomationEvents, gitAutomations, gitRefCursors, workflowRuns, type DatabaseHandle } from '@neuralbridge/database';
import { createGitAutomationMonitor, validateGitRef, type GitAutomation, type GitEvent, type GitTrigger } from '@neuralbridge/orchestrator';
import { gitDiffRangeFiles, readGitRefs } from '@neuralbridge/workspace';

const ACTIVE = ['pending', 'running', 'waiting_approval', 'paused', 'retrying', 'interrupted'] as const;
const dedupeKey = (event: GitEvent) => `${event.automationId}:${event.ref}:${event.commitHash ?? event.kind ?? 'manual'}`;

export interface GitAutomationHost {
  handle: DatabaseHandle;
  root: (projectId: string) => string;
  run: (workflowId: string, trigger: { kind: string; ref?: string; hash?: string; base?: string; head?: string }) => Promise<{ runId: string }>;
}

export function createGitAutomationService({ handle, root, run }: GitAutomationHost) {
  const { db } = handle;
  const toAutomation = (row: typeof gitAutomations.$inferSelect): GitAutomation => ({ id: row.id, projectId: row.projectId, workflowId: row.workflowId, trigger: JSON.parse(row.trigger) as GitTrigger, enabled: row.enabled, concurrencyLimit: row.concurrencyLimit, hourlyLimit: row.hourlyLimit, failureBreaker: row.failureBreaker });
  const monitor = createGitAutomationMonitor({
    list: async () => db.select().from(gitAutomations).all().map(toAutomation),
    refs: (projectId) => readGitRefs(root(projectId)),
    paths: (projectId, from, to) => gitDiffRangeFiles(root(projectId), from, to),
    cursor: async (automationId, ref) => db.select({ hash: gitRefCursors.commitHash }).from(gitRefCursors).where(and(eq(gitRefCursors.automationId, automationId), eq(gitRefCursors.ref, ref))).get()?.hash ?? null,
    saveCursor: async (automationId, ref, hash) => {
      const condition = and(eq(gitRefCursors.automationId, automationId), eq(gitRefCursors.ref, ref));
      if (db.select().from(gitRefCursors).where(condition).get()) db.update(gitRefCursors).set({ commitHash: hash, updatedAt: new Date().toISOString() }).where(condition).run();
      else db.insert(gitRefCursors).values({ automationId, ref, commitHash: hash }).run();
    },
    known: async (event) => db.select({ id: gitAutomationEvents.id }).from(gitAutomationEvents).where(eq(gitAutomationEvents.dedupeKey, dedupeKey(event))).get() !== undefined,
    saveEvent: async (event) => {
      db.insert(gitAutomationEvents).values({ id: randomUUID(), automationId: event.automationId, projectId: event.projectId ?? '', kind: event.kind ?? 'ref-updated', ref: event.ref, commitHash: event.commitHash ?? null, dedupeKey: dedupeKey(event), runId: event.runId ?? null, status: event.status, reason: event.reason ?? null }).onConflictDoNothing().run();
    },
    activeRuns: async (automationId) => {
      const ids = db.select({ runId: gitAutomationEvents.runId }).from(gitAutomationEvents).where(eq(gitAutomationEvents.automationId, automationId)).all().flatMap((row) => (row.runId ? [row.runId] : []));
      return ids.length ? db.select({ id: workflowRuns.id }).from(workflowRuns).where(and(inArray(workflowRuns.id, ids), inArray(workflowRuns.status, [...ACTIVE]))).all().length : 0;
    },
    dispatchedSince: async (automationId, since) => db.select({ id: gitAutomationEvents.id }).from(gitAutomationEvents).where(and(eq(gitAutomationEvents.automationId, automationId), eq(gitAutomationEvents.status, 'dispatched'), gte(gitAutomationEvents.createdAt, since))).all().length,
    failedInARow: async (automationId) => {
      let failed = 0;
      for (const event of db.select({ status: gitAutomationEvents.status, runId: gitAutomationEvents.runId }).from(gitAutomationEvents).where(eq(gitAutomationEvents.automationId, automationId)).orderBy(desc(gitAutomationEvents.createdAt)).limit(20).all()) {
        const status = event.runId ? db.select({ status: workflowRuns.status }).from(workflowRuns).where(eq(workflowRuns.id, event.runId)).get()?.status : event.status;
        if (status !== 'failed') break;
        failed += 1;
      }
      return failed;
    },
    dispatch: async (automation, event) => (await run(automation.workflowId, { kind: event.kind ?? 'ref-updated', ref: event.ref, ...(event.commitHash ? { hash: event.commitHash, head: event.commitHash } : {}), ...(event.base ? { base: event.base } : {}) })).runId,
  });
  return {
    poll: () => monitor.poll(),
    list(projectId: string) {
      return db.select().from(gitAutomations).where(eq(gitAutomations.projectId, projectId)).all().map((row) => ({ id: row.id, name: row.name, workflowId: row.workflowId, trigger: JSON.parse(row.trigger) as GitTrigger, enabled: row.enabled, hourlyLimit: row.hourlyLimit }));
    },
    /** New automations start switched off: enabling one is a separate, deliberate step. */
    save(input: { id?: string | undefined; projectId: string; workflowId: string; name: string; trigger: { refs?: string[] | undefined; pathGlobs?: string[] | undefined }; hourlyLimit?: number | undefined }) {
      for (const ref of input.trigger.refs ?? []) if (!validateGitRef(ref)) throw new Error('invalid: Ref inválida.');
      const values = { projectId: input.projectId, workflowId: input.workflowId, name: input.name, trigger: JSON.stringify(input.trigger), ...(input.hourlyLimit ? { hourlyLimit: input.hourlyLimit } : {}) };
      const id = input.id ?? randomUUID();
      if (input.id) db.update(gitAutomations).set(values).where(eq(gitAutomations.id, id)).run();
      else db.insert(gitAutomations).values({ id, ...values }).run();
      return { id };
    },
    toggle(id: string, enabled: boolean) {
      db.update(gitAutomations).set({ enabled }).where(eq(gitAutomations.id, id)).run();
      return { ok: true as const };
    },
    remove(id: string) {
      db.delete(gitAutomations).where(eq(gitAutomations.id, id)).run();
      return { ok: true as const };
    },
    events(automationId: string) {
      return db.select().from(gitAutomationEvents).where(eq(gitAutomationEvents.automationId, automationId)).orderBy(desc(gitAutomationEvents.createdAt)).limit(50).all().map(({ id, kind, ref, commitHash, status, reason, runId, createdAt }) => ({ id, kind, ref, commitHash, status, reason, runId, createdAt }));
    },
    /** A person chose this commit or branch: no dedupe, and edits still wait for approval. */
    runManually(input: { workflowId: string; ref?: string | undefined; hash?: string | undefined; base?: string | undefined; head?: string | undefined }) {
      for (const ref of [input.ref, input.hash, input.base, input.head]) if (ref !== undefined && !validateGitRef(ref)) throw new Error('invalid: Ref inválida.');
      return run(input.workflowId, { kind: 'manual', ...(input.ref ? { ref: input.ref } : {}), ...(input.hash ? { hash: input.hash } : {}), ...(input.base ? { base: input.base } : {}), ...(input.head ? { head: input.head } : {}) });
    },
  };
}
