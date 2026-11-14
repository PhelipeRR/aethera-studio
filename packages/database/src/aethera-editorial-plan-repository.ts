import { and, asc, desc, eq } from 'drizzle-orm';
import { editorialPlanSchema, type EditorialPlan } from '@neuralbridge/shared/aethera-smart-director';
import type { Db } from './open.js';
import { aetheraEditorialPlans } from './schema.js';

/**
 * Smart Director editorial plans, versioned per run. A version is written once: saving identical decisions returns the
 * stored version, and the only change a stored version ever receives is draft → approved, by a named person. An approved
 * plan is never rewritten; new decisions become a new draft version.
 */
export class AetheraEditorialPlanRepository {
  constructor(private readonly db: Db) {}

  save(runId: string, input: EditorialPlan): EditorialPlan {
    const plan = editorialPlanSchema.parse(input);
    const stored = this.db.select().from(aetheraEditorialPlans).where(and(eq(aetheraEditorialPlans.runId, runId), eq(aetheraEditorialPlans.version, plan.version))).get();
    if (stored) {
      if (stored.hash !== plan.hash) throw new Error(`O plano editorial v${plan.version} já existe com outras decisões; uma versão gravada não é reescrita.`);
      return editorialPlanSchema.parse(JSON.parse(stored.dataJson));
    }
    if (plan.status !== 'draft') throw new Error('Um plano editorial entra como rascunho; só uma pessoa o aprova.');
    this.db.insert(aetheraEditorialPlans).values({ id: `${runId}:editorial:${plan.version}`, runId, version: plan.version, status: plan.status, hash: plan.hash, scriptKey: plan.basedOn.scriptKey, dataJson: JSON.stringify(plan), createdAt: new Date().toISOString() }).run();
    return plan;
  }

  history(runId: string): EditorialPlan[] {
    return this.db.select().from(aetheraEditorialPlans).where(eq(aetheraEditorialPlans.runId, runId)).orderBy(asc(aetheraEditorialPlans.version)).all().map((row) => editorialPlanSchema.parse(JSON.parse(row.dataJson)));
  }

  latest(runId: string, scriptKey?: string): EditorialPlan | null {
    const where = scriptKey ? and(eq(aetheraEditorialPlans.runId, runId), eq(aetheraEditorialPlans.scriptKey, scriptKey)) : eq(aetheraEditorialPlans.runId, runId);
    const row = this.db.select().from(aetheraEditorialPlans).where(where).orderBy(desc(aetheraEditorialPlans.version)).get();
    return row ? editorialPlanSchema.parse(JSON.parse(row.dataJson)) : null;
  }

  approval(runId: string, version: number): { approvedBy: string; approvedAt: string } | null {
    const row = this.db.select({ approvedBy: aetheraEditorialPlans.approvedBy, approvedAt: aetheraEditorialPlans.approvedAt }).from(aetheraEditorialPlans).where(and(eq(aetheraEditorialPlans.runId, runId), eq(aetheraEditorialPlans.version, version))).get();
    return row?.approvedBy && row.approvedAt ? { approvedBy: row.approvedBy, approvedAt: row.approvedAt } : null;
  }

  /** Human approval of one version, bound to its hash: a plan that changed since it was shown is not approved. */
  approve(input: { runId: string; version: number; hash: string; approvedBy: string }): EditorialPlan {
    const approvedBy = input.approvedBy.trim();
    if (!approvedBy) throw new Error('A aprovação do plano editorial exige quem aprova.');
    const row = this.db.select().from(aetheraEditorialPlans).where(and(eq(aetheraEditorialPlans.runId, input.runId), eq(aetheraEditorialPlans.version, input.version))).get();
    if (!row) throw new Error(`Plano editorial v${input.version} não encontrado.`);
    if (row.hash !== input.hash) throw new Error('O plano editorial mudou desde que foi exibido; revise a versão atual antes de aprovar.');
    const plan = editorialPlanSchema.parse(JSON.parse(row.dataJson));
    if (row.status === 'approved') return plan;
    const approved = editorialPlanSchema.parse({ ...plan, status: 'approved' });
    this.db.update(aetheraEditorialPlans).set({ status: 'approved', dataJson: JSON.stringify(approved), approvedBy, approvedAt: new Date().toISOString() }).where(and(eq(aetheraEditorialPlans.id, row.id), eq(aetheraEditorialPlans.status, 'draft'))).run();
    return approved;
  }
}
