import { and, eq } from 'drizzle-orm';
import { validateStyleChoice, type ProductionStyleChoice } from '@neuralbridge/shared';
import { velixVideoStyles } from './schema.js';
import type { Db } from './open.js';

/** The project default lives under the empty video name. */
export const PROJECT_DEFAULT_VIDEO = '';

/** Stores the style of each video; a video without its own choice uses the project default, and then the Dossiê. */
export class VelixStyleRepository {
  constructor(private readonly db: Db) {}
  save(projectId: string, video: string, choice: ProductionStyleChoice): void {
    const data = JSON.stringify(validateStyleChoice(choice));
    this.db.insert(velixVideoStyles).values({ projectId, videoName: video, data }).onConflictDoUpdate({ target: [velixVideoStyles.projectId, velixVideoStyles.videoName], set: { data, updatedAt: new Date().toISOString() } }).run();
  }
  /** A stored choice the registry no longer knows reads as no choice, so the video falls back instead of failing. */
  private read(projectId: string, video: string): ProductionStyleChoice | null {
    const row = this.db.select().from(velixVideoStyles).where(and(eq(velixVideoStyles.projectId, projectId), eq(velixVideoStyles.videoName, video))).get();
    if (!row) return null;
    try { return validateStyleChoice(JSON.parse(row.data) as unknown); } catch { return null; }
  }
  load(projectId: string, video: string): ProductionStyleChoice | null { return this.read(projectId, video) ?? (video === PROJECT_DEFAULT_VIDEO ? null : this.read(projectId, PROJECT_DEFAULT_VIDEO)); }
  /** Whether this exact video has its own choice (not inherited from the project). */
  hasOwn(projectId: string, video: string): boolean { return this.read(projectId, video) !== null; }
  clear(projectId: string, video: string): void { this.db.delete(velixVideoStyles).where(and(eq(velixVideoStyles.projectId, projectId), eq(velixVideoStyles.videoName, video))).run(); }
}
