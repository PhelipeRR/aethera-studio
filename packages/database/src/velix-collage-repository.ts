import { desc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { velixCollageJobs } from './schema.js';
import type { Db } from './open.js';

export type CollageJobStatus = 'draft' | 'metaphor_approved' | 'still_approved' | 'generating' | 'completed' | 'rejected' | 'failed';
export type CollageJob = typeof velixCollageJobs.$inferSelect;

export class VelixCollageRepository {
  constructor(private readonly db: Db) {}
  create(input: Omit<typeof velixCollageJobs.$inferInsert, 'id'> & { id?: string }): CollageJob {
    const row = { ...input, id: input.id ?? randomUUID() };
    this.db.insert(velixCollageJobs).values(row).run();
    const created = this.get(row.id);
    if (!created) throw new Error(`Colagem não encontrada após criar: ${row.id}`);
    return created;
  }
  get(id: string): CollageJob | null { return this.db.select().from(velixCollageJobs).where(eq(velixCollageJobs.id, id)).get() ?? null; }
  listProject(projectId: string): CollageJob[] { return this.db.select().from(velixCollageJobs).where(eq(velixCollageJobs.projectId, projectId)).orderBy(desc(velixCollageJobs.createdAt)).all(); }
  update(id: string, patch: Partial<typeof velixCollageJobs.$inferInsert>): void { this.db.update(velixCollageJobs).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(velixCollageJobs.id, id)).run(); }
}
