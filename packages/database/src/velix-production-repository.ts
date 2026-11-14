import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  type ApprovalGate,
  type ProductionBrief,
  type ProductionQualityCheck,
  type ProductionRunStatus,
  isSafeProductionPath,
  productionBriefSchema,
  productionQualityCheckSchema,
  qualityExportable,
} from '@neuralbridge/shared';
import { type DatabaseHandle } from './open.js';
import { tasks, videoProjects, velixProductionApprovals, velixProductionArtifacts, velixProductionBudgets, velixProductionRuns, velixProductionStages, velixQualityReports } from './schema.js';

export type VelixProductionRunRow = typeof velixProductionRuns.$inferSelect;
export type VelixProductionStageRow = typeof velixProductionStages.$inferSelect;
export type VelixProductionArtifactRow = typeof velixProductionArtifacts.$inferSelect;
export type VelixProductionBudgetRow = typeof velixProductionBudgets.$inferSelect;

export interface ProductionArtifactInput {
  stageId: string;
  kind: string;
  contentHash: string;
  relativePath?: string | null;
  mime?: string | null;
  metadata?: Record<string, unknown>;
}

/** Persistence of an autonomous Velix production: run, stages, artifacts, budget, approvals and quality reports. */
export class VelixProductionRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  private get db() {
    return this.handle.db;
  }

  createRun(input: { projectId: string; brief: ProductionBrief; estimatedCostUsd?: number; agent?: 'claude' | 'codex' }): VelixProductionRunRow {
    const brief = productionBriefSchema.parse(input.brief);
    const id = randomUUID();
    this.db.transaction((tx) => {
      tx.insert(velixProductionRuns).values({ id, projectId: input.projectId, brief: JSON.stringify(brief), contractVersion: 1, status: 'draft', agent: input.agent ?? null, estimatedCostUsd: input.estimatedCostUsd ?? 0, actualCostUsd: 0 }).run();
      tx.insert(velixProductionBudgets).values({ runId: id, limitUsd: brief.budgetUsd }).run();
    });
    const created = this.getRun(id);
    if (!created) throw new Error('production_run_create_failed');
    return created;
  }

  effectiveAgent(run: VelixProductionRunRow): 'claude' | 'codex' {
    return run.agent ?? 'claude';
  }

  getRun(id: string): VelixProductionRunRow | undefined {
    return this.db.select().from(velixProductionRuns).where(eq(velixProductionRuns.id, id)).get();
  }

  listRuns(projectId: string): VelixProductionRunRow[] {
    return this.db.select().from(velixProductionRuns).where(eq(velixProductionRuns.projectId, projectId)).orderBy(desc(velixProductionRuns.createdAt)).all();
  }

  setRunStatus(id: string, status: ProductionRunStatus): void {
    this.db.update(velixProductionRuns).set({ status, updatedAt: new Date().toISOString() }).where(eq(velixProductionRuns.id, id)).run();
  }

  listStages(runId: string): VelixProductionStageRow[] {
    return this.db.select().from(velixProductionStages).where(eq(velixProductionStages.runId, runId)).orderBy(asc(velixProductionStages.createdAt)).all();
  }

  getStage(id: string): VelixProductionStageRow | undefined {
    return this.db.select().from(velixProductionStages).where(eq(velixProductionStages.id, id)).get();
  }

  stageByTask(taskId: string): VelixProductionStageRow | undefined {
    return this.db.select().from(velixProductionStages).where(eq(velixProductionStages.taskId, taskId)).get();
  }

  /** Stages that were in flight when the app stopped, across every run. */
  inFlightStages(): VelixProductionStageRow[] {
    return this.db.select().from(velixProductionStages).where(inArray(velixProductionStages.status, ['running', 'paused'])).all();
  }

  addStage(input: Omit<typeof velixProductionStages.$inferInsert, 'id'>): VelixProductionStageRow {
    const id = randomUUID();
    this.db.insert(velixProductionStages).values({ ...input, id }).run();
    const stage = this.getStage(id);
    if (!stage) throw new Error('production_stage_create_failed');
    return stage;
  }

  updateStage(id: string, input: Partial<typeof velixProductionStages.$inferInsert>): void {
    this.db.update(velixProductionStages).set({ ...input, updatedAt: new Date().toISOString() }).where(eq(velixProductionStages.id, id)).run();
  }

  /** Absolute root of the video project: every production file is written under it. */
  projectRoot(projectId: string): string | undefined {
    return this.db.select({ rootPath: videoProjects.rootPath }).from(videoProjects).where(eq(videoProjects.id, projectId)).get()?.rootPath;
  }

  getArtifact(id: string): VelixProductionArtifactRow | undefined {
    return this.db.select().from(velixProductionArtifacts).where(eq(velixProductionArtifacts.id, id)).get();
  }

  taskStatus(taskId: string): { status: string; error: string | null } | undefined {
    return this.db.select({ status: tasks.status, error: tasks.error }).from(tasks).where(eq(tasks.id, taskId)).get();
  }

  /** Idempotent by stage + content hash: recording the same output twice (e.g. after a restart) keeps one artifact. */
  recordArtifact(input: ProductionArtifactInput): VelixProductionArtifactRow {
    const stage = this.getStage(input.stageId);
    if (!stage) throw new Error('production_stage_not_found');
    if (!/^[a-f0-9]{16,128}$/i.test(input.contentHash)) throw new Error('invalid: hash de conteúdo inválido.');
    if (input.relativePath != null && !isSafeProductionPath(input.relativePath)) throw new Error('forbidden: o caminho do artefato precisa ficar dentro do projeto.');
    const existing = this.db.select().from(velixProductionArtifacts).where(and(eq(velixProductionArtifacts.stageId, stage.id), eq(velixProductionArtifacts.contentHash, input.contentHash))).get();
    if (existing) return existing;
    const id = randomUUID();
    this.db.transaction((tx) => {
      tx.insert(velixProductionArtifacts).values({ id, runId: stage.runId, stageId: stage.id, kind: input.kind, relativePath: input.relativePath ?? null, contentHash: input.contentHash, mime: input.mime ?? null, metadata: JSON.stringify(input.metadata ?? {}) }).run();
      const ids = JSON.parse(stage.outputArtifactIds) as string[];
      tx.update(velixProductionStages).set({ outputArtifactIds: JSON.stringify([...ids, id]), updatedAt: new Date().toISOString() }).where(eq(velixProductionStages.id, stage.id)).run();
    });
    const created = this.db.select().from(velixProductionArtifacts).where(eq(velixProductionArtifacts.id, id)).get();
    if (!created) throw new Error('production_artifact_create_failed');
    return created;
  }

  listArtifacts(runId: string): VelixProductionArtifactRow[] {
    return this.db.select().from(velixProductionArtifacts).where(eq(velixProductionArtifacts.runId, runId)).orderBy(asc(velixProductionArtifacts.createdAt)).all();
  }

  getBudget(runId: string): VelixProductionBudgetRow {
    const budget = this.db.select().from(velixProductionBudgets).where(eq(velixProductionBudgets.runId, runId)).get();
    if (!budget) throw new Error('production_budget_not_found');
    return budget;
  }

  reserve(runId: string, amountUsd: number): void {
    this.db.update(velixProductionBudgets).set({ reserveUsd: sql`${velixProductionBudgets.reserveUsd} + ${amountUsd}`, updatedAt: new Date().toISOString() }).where(eq(velixProductionBudgets.runId, runId)).run();
  }

  /** Releases the reservation and books the real cost, on the budget and on the run. */
  reconcile(runId: string, reservedUsd: number, actualUsd: number): void {
    this.db.transaction((tx) => {
      tx.update(velixProductionBudgets).set({ reserveUsd: sql`max(0, ${velixProductionBudgets.reserveUsd} - ${reservedUsd})`, consumedUsd: sql`${velixProductionBudgets.consumedUsd} + ${actualUsd}`, updatedAt: new Date().toISOString() }).where(eq(velixProductionBudgets.runId, runId)).run();
      tx.update(velixProductionRuns).set({ actualCostUsd: sql`${velixProductionRuns.actualCostUsd} + ${actualUsd}`, updatedAt: new Date().toISOString() }).where(eq(velixProductionRuns.id, runId)).run();
    });
  }

  /** `gate` and `version` (0108) name which of the four approvals this is and what it approved; legacy approvals leave them null. */
  recordApproval(input: { runId: string; stageId?: string | null; decision: 'approved' | 'rejected'; note?: string | null; gate?: ApprovalGate | null; version?: string | null }) {
    const row = { id: randomUUID(), runId: input.runId, stageId: input.stageId ?? null, decision: input.decision, note: input.note ?? null, gate: input.gate ?? null, version: input.version ?? null };
    this.db.insert(velixProductionApprovals).values(row).run();
    return row;
  }

  listApprovals(runId: string) {
    return this.db.select().from(velixProductionApprovals).where(eq(velixProductionApprovals.runId, runId)).orderBy(asc(velixProductionApprovals.createdAt)).all();
  }

  recordQualityReport(input: { runId: string; stageId?: string | null; checks: ProductionQualityCheck[] }) {
    const checks = input.checks.map((check) => productionQualityCheckSchema.parse(check));
    const row = { id: randomUUID(), runId: input.runId, stageId: input.stageId ?? null, blocking: checks.some((check) => check.severity === 'blocking' && !check.passed && check.approved !== true), checks: JSON.stringify(checks), exportable: qualityExportable(checks) };
    this.db.insert(velixQualityReports).values(row).run();
    return row;
  }

  listQualityReports(runId: string) {
    return this.db.select().from(velixQualityReports).where(eq(velixQualityReports.runId, runId)).orderBy(asc(velixQualityReports.createdAt)).all();
  }
}
