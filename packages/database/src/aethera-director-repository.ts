import { desc, eq } from 'drizzle-orm';
import { directorPlanSchema, presetSchema, type AetheraProductionPreset, type DirectorPlan } from '@neuralbridge/shared/aethera-director';
import type { Db } from './open.js';
import { aetheraDirectorPlans, aetheraPresets } from './schema.js';

/** Persists grammar versions and immutable DirectorPlan history without writing media. */
export class AetheraDirectorRepository {
  constructor(private readonly db: Db) {}

  savePreset(preset: AetheraProductionPreset): AetheraProductionPreset {
    const parsed = presetSchema.parse(preset);
    const now = new Date().toISOString();
    this.db.insert(aetheraPresets).values({ id: parsed.id, version: parsed.version, dataJson: JSON.stringify(parsed), createdAt: now, updatedAt: now }).onConflictDoUpdate({ target: [aetheraPresets.id, aetheraPresets.version], set: { dataJson: JSON.stringify(parsed), updatedAt: now } }).run();
    return parsed;
  }

  preset(id: string, version: number): AetheraProductionPreset | null {
    const row = this.db.select().from(aetheraPresets).where(eq(aetheraPresets.id, id)).all().find((candidate) => candidate.version === version);
    return row ? presetSchema.parse(JSON.parse(row.dataJson)) : null;
  }

  savePlan(input: { runId: string; plan: DirectorPlan }): DirectorPlan {
    const plan = directorPlanSchema.parse(input.plan);
    const current = this.db.select({ version: aetheraDirectorPlans.version }).from(aetheraDirectorPlans).where(eq(aetheraDirectorPlans.runId, input.runId)).orderBy(desc(aetheraDirectorPlans.version)).get()?.version ?? 0;
    const version = current + 1;
    this.db.insert(aetheraDirectorPlans).values({ id: `${input.runId}:director:${version}`, runId: input.runId, version, presetId: plan.presetId, dataJson: JSON.stringify(plan), createdAt: new Date().toISOString() }).run();
    return plan;
  }

  latestPlan(runId: string): DirectorPlan | null {
    const row = this.db.select().from(aetheraDirectorPlans).where(eq(aetheraDirectorPlans.runId, runId)).orderBy(desc(aetheraDirectorPlans.version)).get();
    return row ? directorPlanSchema.parse(JSON.parse(row.dataJson)) : null;
  }
}
