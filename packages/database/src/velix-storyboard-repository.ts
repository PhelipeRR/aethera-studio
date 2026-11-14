import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { type Storyboard, type StoryboardEdit, storyboardSchema } from '@neuralbridge/shared';
import { type DatabaseHandle } from './open.js';
import { velixStoryboards } from './schema.js';

export interface StoryboardVersion { id: string; runId: string; version: number; storyboard: Storyboard; source: 'generated' | 'edit' | 'sync' | 'restore' | 'matching'; edit: StoryboardEdit | null; createdAt: string }

/** Every storyboard change is a new immutable version; the latest one is the state the user left. */
export class VelixStoryboardRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  private get db() {
    return this.handle.db;
  }

  latest(runId: string): StoryboardVersion | null {
    const row = this.db.select().from(velixStoryboards).where(eq(velixStoryboards.runId, runId)).orderBy(desc(velixStoryboards.version)).get();
    return row ? this.toVersion(row) : null;
  }

  get(runId: string, version: number): StoryboardVersion | null {
    const row = this.db.select().from(velixStoryboards).where(and(eq(velixStoryboards.runId, runId), eq(velixStoryboards.version, version))).get();
    return row ? this.toVersion(row) : null;
  }

  history(runId: string): Array<Omit<StoryboardVersion, 'storyboard'>> {
    return this.db.select().from(velixStoryboards).where(eq(velixStoryboards.runId, runId)).orderBy(desc(velixStoryboards.version)).all().map((row) => {
      const { storyboard: _storyboard, ...rest } = this.toVersion(row);
      void _storyboard;
      return rest;
    });
  }

  /**
   * Saves a new version on top of `baseVersion`. A stale base (another edit landed first) is refused, so two edits never
   * silently overwrite each other.
   */
  save(input: { runId: string; storyboard: Storyboard; source: 'generated' | 'edit' | 'sync' | 'restore' | 'matching'; edit?: StoryboardEdit | null; baseVersion: number | null }): StoryboardVersion {
    const storyboard = storyboardSchema.parse(input.storyboard);
    return this.db.transaction((tx) => {
      const current = tx.select({ version: velixStoryboards.version }).from(velixStoryboards).where(eq(velixStoryboards.runId, input.runId)).orderBy(desc(velixStoryboards.version)).get()?.version ?? null;
      if (current !== input.baseVersion) throw new Error(`conflict: o storyboard mudou (versão ${current ?? 'nenhuma'}); recarregue antes de editar.`);
      const row = { id: randomUUID(), runId: input.runId, version: (current ?? 0) + 1, content: JSON.stringify(storyboard), source: input.source, edit: input.edit ? JSON.stringify(input.edit) : null, createdAt: new Date().toISOString() };
      tx.insert(velixStoryboards).values(row).run();
      return this.toVersion(row);
    });
  }

  private toVersion(row: typeof velixStoryboards.$inferSelect): StoryboardVersion {
    return { id: row.id, runId: row.runId, version: row.version, storyboard: storyboardSchema.parse(JSON.parse(row.content)), source: row.source === 'edit' || row.source === 'sync' || row.source === 'restore' || row.source === 'matching' ? row.source : 'generated', edit: row.edit ? (JSON.parse(row.edit) as StoryboardEdit) : null, createdAt: row.createdAt };
  }
}
