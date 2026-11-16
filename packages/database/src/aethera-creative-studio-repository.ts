import { desc, eq } from 'drizzle-orm';
import type { Db } from './open.js';
import { aetheraCreativeBrandKits, aetheraCreativeGenerationRuns, aetheraCreativeProjects } from './schema.js';

export interface StoredCreativeBrandKitRow {
  id: string;
  channelId: string | null;
  channelName: string;
  dataJson: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredCreativeProjectRow {
  id: string;
  artType: string;
  title: string;
  brandKitId: string | null;
  sourceCinemaProjectId: string | null;
  schemaVersion: number;
  dataJson: string;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredCreativeGenerationRunRow {
  id: string;
  projectId: string | null;
  artType: string;
  prompt: string;
  status: string;
  requestJson: string;
  reportJson: string;
  createdAt: string;
  updatedAt: string;
}

export class AetheraCreativeStudioRepository {
  constructor(private readonly db: Db) {}

  saveBrandKit(input: {
    id: string;
    channelId?: string | null;
    channelName: string;
    dataJson: string;
    createdAt: string;
    updatedAt: string;
  }): void {
    const existing = this.db
      .select({ id: aetheraCreativeBrandKits.id })
      .from(aetheraCreativeBrandKits)
      .where(eq(aetheraCreativeBrandKits.id, input.id))
      .get();
    if (existing) {
      this.db
        .update(aetheraCreativeBrandKits)
        .set({
          channelId: input.channelId ?? null,
          channelName: input.channelName,
          dataJson: input.dataJson,
          updatedAt: input.updatedAt,
        })
        .where(eq(aetheraCreativeBrandKits.id, input.id))
        .run();
      return;
    }
    this.db
      .insert(aetheraCreativeBrandKits)
      .values({
        id: input.id,
        channelId: input.channelId ?? null,
        channelName: input.channelName,
        dataJson: input.dataJson,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      })
      .run();
  }

  getBrandKit(id: string): StoredCreativeBrandKitRow | null {
    return this.db.select().from(aetheraCreativeBrandKits).where(eq(aetheraCreativeBrandKits.id, id)).get() ?? null;
  }

  listBrandKits(): StoredCreativeBrandKitRow[] {
    return this.db.select().from(aetheraCreativeBrandKits).orderBy(desc(aetheraCreativeBrandKits.updatedAt)).all();
  }

  deleteBrandKit(id: string): boolean {
    const res = this.db.delete(aetheraCreativeBrandKits).where(eq(aetheraCreativeBrandKits.id, id)).run();
    return res.changes > 0;
  }

  saveProject(input: {
    id: string;
    artType: string;
    title: string;
    brandKitId?: string | null;
    sourceCinemaProjectId?: string | null;
    schemaVersion: number;
    dataJson: string;
    approvedBy?: string | null;
    approvedAt?: string | null;
    createdAt: string;
    updatedAt: string;
  }): void {
    const existing = this.db
      .select({ id: aetheraCreativeProjects.id })
      .from(aetheraCreativeProjects)
      .where(eq(aetheraCreativeProjects.id, input.id))
      .get();
    if (existing) {
      this.db
        .update(aetheraCreativeProjects)
        .set({
          artType: input.artType,
          title: input.title,
          brandKitId: input.brandKitId ?? null,
          sourceCinemaProjectId: input.sourceCinemaProjectId ?? null,
          schemaVersion: input.schemaVersion,
          dataJson: input.dataJson,
          approvedBy: input.approvedBy ?? null,
          approvedAt: input.approvedAt ?? null,
          updatedAt: input.updatedAt,
        })
        .where(eq(aetheraCreativeProjects.id, input.id))
        .run();
      return;
    }
    this.db
      .insert(aetheraCreativeProjects)
      .values({
        id: input.id,
        artType: input.artType,
        title: input.title,
        brandKitId: input.brandKitId ?? null,
        sourceCinemaProjectId: input.sourceCinemaProjectId ?? null,
        schemaVersion: input.schemaVersion,
        dataJson: input.dataJson,
        approvedBy: input.approvedBy ?? null,
        approvedAt: input.approvedAt ?? null,
        createdAt: input.createdAt,
        updatedAt: input.updatedAt,
      })
      .run();
  }

  getProject(id: string): StoredCreativeProjectRow | null {
    return this.db.select().from(aetheraCreativeProjects).where(eq(aetheraCreativeProjects.id, id)).get() ?? null;
  }

  listProjects(artType?: string): StoredCreativeProjectRow[] {
    if (artType) {
      return this.db
        .select()
        .from(aetheraCreativeProjects)
        .where(eq(aetheraCreativeProjects.artType, artType))
        .orderBy(desc(aetheraCreativeProjects.updatedAt))
        .all();
    }
    return this.db.select().from(aetheraCreativeProjects).orderBy(desc(aetheraCreativeProjects.updatedAt)).all();
  }

  deleteProject(id: string): boolean {
    const res = this.db.delete(aetheraCreativeProjects).where(eq(aetheraCreativeProjects.id, id)).run();
    return res.changes > 0;
  }

  saveGenerationRun(input: {
    id: string;
    projectId?: string | null;
    artType: string;
    prompt: string;
    status: string;
    requestJson: string;
    reportJson: string;
    createdAt: string;
    updatedAt: string;
  }): void {
    this.db.insert(aetheraCreativeGenerationRuns).values({
      id: input.id,
      projectId: input.projectId ?? null,
      artType: input.artType,
      prompt: input.prompt,
      status: input.status,
      requestJson: input.requestJson,
      reportJson: input.reportJson,
      createdAt: input.createdAt,
      updatedAt: input.updatedAt,
    }).run();
  }

  getGenerationRun(id: string): StoredCreativeGenerationRunRow | null {
    return this.db.select().from(aetheraCreativeGenerationRuns).where(eq(aetheraCreativeGenerationRuns.id, id)).get() ?? null;
  }

  listGenerationRuns(limit = 30): StoredCreativeGenerationRunRow[] {
    return this.db.select().from(aetheraCreativeGenerationRuns).orderBy(desc(aetheraCreativeGenerationRuns.createdAt)).limit(Math.max(1, Math.min(100, Math.floor(limit)))).all();
  }
}
