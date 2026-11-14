import { and, asc, eq, inArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { activeExecutionStatuses, contentAnalyticsSnapshotSchema, contentBriefSchema, contentChannelSchema, contentIdeaSchema, contentProjectSchema, contentPublicationSchema, contentScriptSchema, publicationApprovalSchema, publicationPackageSchema, productionExecutionSchema, type ContentAnalyticsSnapshot, type ContentBrief, type ContentChannel, type ContentIdea, type ContentProject, type ContentPublication, type ContentScript, type ProductionExecution, type PublicationPackage } from '@neuralbridge/shared';
import { contentAnalyticsSnapshots, contentChannels, contentExecutions, contentIdeas, contentProjects, contentPublicationApprovals, contentPublicationPackages, contentPublications } from './schema.js';
import type { Db } from './open.js';

const now = () => new Date().toISOString();
const jsonObject = (value: unknown) => JSON.stringify(value ?? {});

export class ContentOperatingSystemRepository {
  constructor(private readonly db: Db) {}

  listChannels(): ContentChannel[] {
    return this.db.select().from(contentChannels).orderBy(asc(contentChannels.updatedAt)).all().map((row) => contentChannelSchema.parse({ id: row.id, workspaceId: row.workspaceId, name: row.name, niche: row.niche, audience: row.audience, tone: row.tone, autonomy: row.autonomy, budgetUsd: row.budgetUsd, concurrencyLimit: row.concurrencyLimit, identity: parseObject(row.identityJson), editorialStrategy: parseObject(row.editorialStrategyJson), createdAt: row.createdAt, updatedAt: row.updatedAt }));
  }

  listIdeas(workspaceId: string): ContentIdea[] {
    return this.db.select().from(contentIdeas).where(eq(contentIdeas.workspaceId, workspaceId)).orderBy(asc(contentIdeas.updatedAt)).all().map((row) => contentIdeaSchema.parse({ id: row.id, workspaceId: row.workspaceId, channelId: row.channelId, title: row.title, angle: row.angle, source: row.source, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt }));
  }

  createIdea(input: Pick<ContentIdea, 'id' | 'workspaceId' | 'channelId' | 'title' | 'angle' | 'source'>): ContentIdea {
    const timestamp = now();
    const value = contentIdeaSchema.parse({ ...input, status: 'new', createdAt: timestamp, updatedAt: timestamp });
    this.db.insert(contentIdeas).values(value).run();
    return value;
  }

  convertIdea(input: { ideaId: string; projectId: string; videoProjectId: string | null; autonomy: ContentProject['autonomy'] }): ContentProject {
    const idea = this.db.select().from(contentIdeas).where(eq(contentIdeas.id, input.ideaId)).get();
    if (!idea) throw new Error('not_found: ideia não encontrada.');
    const project = this.createProject({ id: input.projectId, workspaceId: idea.workspaceId, channelId: idea.channelId, videoProjectId: input.videoProjectId, title: idea.title, autonomy: input.autonomy });
    this.db.update(contentIdeas).set({ status: 'converted', updatedAt: now() }).where(eq(contentIdeas.id, input.ideaId)).run();
    return project;
  }

  listProjects(workspaceId: string): ContentProject[] {
    return this.db.select().from(contentProjects).where(eq(contentProjects.workspaceId, workspaceId)).orderBy(asc(contentProjects.updatedAt)).all().map((row) => this.parseProject(row));
  }

  project(id: string): ContentProject | null {
    const row = this.db.select().from(contentProjects).where(eq(contentProjects.id, id)).get();
    return row ? this.parseProject(row) : null;
  }

  createChannel(input: Pick<ContentChannel, 'id' | 'workspaceId' | 'name' | 'autonomy'> & Partial<ContentChannel>): ContentChannel {
    const timestamp = now();
    this.db.insert(contentChannels).values({ id: input.id, workspaceId: input.workspaceId, name: input.name, niche: input.niche ?? '', audience: input.audience ?? '', tone: input.tone ?? '', autonomy: input.autonomy, budgetUsd: input.budgetUsd ?? 0, concurrencyLimit: input.concurrencyLimit ?? 1, identityJson: jsonObject(input.identity), editorialStrategyJson: jsonObject(input.editorialStrategy), createdAt: timestamp, updatedAt: timestamp }).run();
    return contentChannelSchema.parse({ ...input, niche: input.niche ?? '', audience: input.audience ?? '', tone: input.tone ?? '', budgetUsd: input.budgetUsd ?? 0, concurrencyLimit: input.concurrencyLimit ?? 1, identity: input.identity ?? {}, editorialStrategy: input.editorialStrategy ?? {}, createdAt: timestamp, updatedAt: timestamp });
  }

  createProject(input: Pick<ContentProject, 'id' | 'workspaceId' | 'channelId' | 'videoProjectId' | 'title' | 'autonomy'>): ContentProject {
    const timestamp = now();
    this.db.insert(contentProjects).values({ ...input, briefJson: '{}', scriptJson: '{}', status: 'active', createdAt: timestamp, updatedAt: timestamp }).run();
    return contentProjectSchema.parse({ ...input, brief: null, script: null, status: 'active', createdAt: timestamp, updatedAt: timestamp });
  }

  deleteProject(projectId: string): { deleted: boolean } {
    const existing = this.project(projectId);
    if (!existing) return { deleted: false };
    const packages = this.db.select({ id: contentPublicationPackages.id }).from(contentPublicationPackages).where(eq(contentPublicationPackages.projectId, projectId)).all();
    const packageIds = packages.map((p) => p.id);
    if (packageIds.length > 0) {
      this.db.delete(contentPublicationApprovals).where(inArray(contentPublicationApprovals.packageId, packageIds)).run();
    }
    this.db.delete(contentAnalyticsSnapshots).where(eq(contentAnalyticsSnapshots.projectId, projectId)).run();
    this.db.delete(contentPublications).where(eq(contentPublications.projectId, projectId)).run();
    this.db.delete(contentPublicationPackages).where(eq(contentPublicationPackages.projectId, projectId)).run();
    this.db.delete(contentExecutions).where(eq(contentExecutions.projectId, projectId)).run();
    this.db.delete(contentProjects).where(eq(contentProjects.id, projectId)).run();
    return { deleted: true };
  }

  saveBrief(projectId: string, brief: ContentBrief): ContentProject {
    const parsed = contentBriefSchema.parse(brief);
    const updatedAt = now();
    this.db.update(contentProjects).set({ briefJson: JSON.stringify(parsed), updatedAt }).where(eq(contentProjects.id, projectId)).run();
    const project = this.project(projectId);
    if (!project) throw new Error('not_found: projeto de conteúdo não encontrado.');
    return project;
  }

  saveScript(projectId: string, script: ContentScript): ContentProject {
    const parsed = contentScriptSchema.parse(script);
    const updatedAt = now();
    this.db.update(contentProjects).set({ scriptJson: JSON.stringify(parsed), updatedAt }).where(eq(contentProjects.id, projectId)).run();
    const project = this.project(projectId);
    if (!project) throw new Error('not_found: projeto de conteúdo não encontrado.');
    return project;
  }

  private parseProject(row: typeof contentProjects.$inferSelect): ContentProject {
    return contentProjectSchema.parse({ id: row.id, workspaceId: row.workspaceId, channelId: row.channelId, videoProjectId: row.videoProjectId, title: row.title, brief: parseBrief(row.briefJson), script: parseScript(row.scriptJson), status: row.status, autonomy: row.autonomy, createdAt: row.createdAt, updatedAt: row.updatedAt });
  }

  addExecution(input: Pick<ProductionExecution, 'id' | 'projectId' | 'status'>): ProductionExecution {
    const timestamp = now();
    this.db.insert(contentExecutions).values({ ...input, createdAt: timestamp, updatedAt: timestamp }).run();
    return productionExecutionSchema.parse({ ...input, createdAt: timestamp, updatedAt: timestamp });
  }

  listExecutions(projectId: string): ProductionExecution[] {
    return this.db.select().from(contentExecutions).where(eq(contentExecutions.projectId, projectId)).orderBy(asc(contentExecutions.createdAt)).all().map((row) => productionExecutionSchema.parse({ id: row.id, projectId: row.projectId, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt }));
  }

  /** Mirrors the production run's status; returns null when the run is not a content execution. */
  updateExecutionStatus(id: string, status: ProductionExecution['status']): ProductionExecution | null {
    const row = this.db.select().from(contentExecutions).where(eq(contentExecutions.id, id)).get();
    if (!row) return null;
    const updatedAt = row.status === status ? row.updatedAt : now();
    if (row.status !== status) this.db.update(contentExecutions).set({ status, updatedAt }).where(eq(contentExecutions.id, id)).run();
    return productionExecutionSchema.parse({ id: row.id, projectId: row.projectId, status, createdAt: row.createdAt, updatedAt });
  }

  /** Executions not yet in a final state, across every project (used to reconcile after a restart). */
  listOpenExecutions(): ProductionExecution[] {
    return this.db.select().from(contentExecutions).where(inArray(contentExecutions.status, [...activeExecutionStatuses])).orderBy(asc(contentExecutions.createdAt)).all()
      .map((row) => productionExecutionSchema.parse({ id: row.id, projectId: row.projectId, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt }));
  }

  /** In-progress executions of a channel (all its projects) or, for a project without channel, of that project. */
  countActiveExecutions(scope: { channelId: string } | { projectId: string }): number {
    const active = inArray(contentExecutions.status, [...activeExecutionStatuses]);
    const rows = 'channelId' in scope
      ? this.db.select({ id: contentExecutions.id }).from(contentExecutions).innerJoin(contentProjects, eq(contentProjects.id, contentExecutions.projectId)).where(and(active, eq(contentProjects.channelId, scope.channelId))).all()
      : this.db.select({ id: contentExecutions.id }).from(contentExecutions).where(and(active, eq(contentExecutions.projectId, scope.projectId))).all();
    return rows.length;
  }

  startProduction(input: { id: string; projectId: string }): ProductionExecution {
    if (!this.project(input.projectId)) throw new Error('not_found: projeto de conteúdo não encontrado.');
    return this.addExecution({ ...input, status: 'draft' });
  }

  savePublicationPackage(input: Pick<PublicationPackage, 'id' | 'projectId' | 'version' | 'title' | 'tags'> & Partial<PublicationPackage>): PublicationPackage {
    const timestamp = now();
    const value = { ...input, description: input.description ?? '', tags: input.tags ?? [], chapters: input.chapters ?? [], thumbnailAssetId: input.thumbnailAssetId ?? null, status: input.status ?? 'draft' as const, createdAt: input.createdAt ?? timestamp, updatedAt: timestamp };
    const parsed = publicationPackageSchema.parse(value);
    this.db.insert(contentPublicationPackages).values({ id: parsed.id, projectId: parsed.projectId, version: parsed.version, title: parsed.title, description: parsed.description, tagsJson: JSON.stringify(parsed.tags), chaptersJson: JSON.stringify(parsed.chapters), thumbnailAssetId: parsed.thumbnailAssetId, status: parsed.status, createdAt: parsed.createdAt, updatedAt: parsed.updatedAt }).run();
    return parsed;
  }

  listPublicationPackages(projectId: string): PublicationPackage[] {
    return this.db.select().from(contentPublicationPackages).where(eq(contentPublicationPackages.projectId, projectId)).orderBy(asc(contentPublicationPackages.version)).all().map((row) => publicationPackageSchema.parse({ id: row.id, projectId: row.projectId, version: row.version, title: row.title, description: row.description, tags: parseArray(row.tagsJson), chapters: parseArray(row.chaptersJson), thumbnailAssetId: row.thumbnailAssetId, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt }));
  }

  publicationPackage(id: string): PublicationPackage | null {
    const row = this.db.select().from(contentPublicationPackages).where(eq(contentPublicationPackages.id, id)).get();
    return row ? publicationPackageSchema.parse({ id: row.id, projectId: row.projectId, version: row.version, title: row.title, description: row.description, tags: parseArray(row.tagsJson), chapters: parseArray(row.chaptersJson), thumbnailAssetId: row.thumbnailAssetId, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt }) : null;
  }

  approvePublicationPackage(id: string, approvedBy = 'user', note = ''): boolean {
    const packageRow = this.db.select().from(contentPublicationPackages).where(eq(contentPublicationPackages.id, id)).get();
    if (!packageRow) return false;
    const timestamp = now();
    const changed = this.db.update(contentPublicationPackages).set({ status: 'approved', updatedAt: timestamp }).where(eq(contentPublicationPackages.id, id)).run().changes > 0;
    if (changed) this.db.insert(contentPublicationApprovals).values({ id: randomUUID(), packageId: packageRow.id, projectId: packageRow.projectId, packageVersion: packageRow.version, decision: 'approved', approvedBy, note, createdAt: timestamp }).run();
    return changed;
  }

  listPublicationApprovals(packageId: string) {
    return this.db.select().from(contentPublicationApprovals).where(eq(contentPublicationApprovals.packageId, packageId)).orderBy(asc(contentPublicationApprovals.createdAt)).all().map((row) => publicationApprovalSchema.parse(row));
  }

  schedulePublication(input: { id: string; projectId: string; packageId: string; platform: string; visibility: 'private' | 'unlisted' | 'public'; scheduledAt: string | null; approved: true }) {
    const packageRow = this.db.select().from(contentPublicationPackages).where(eq(contentPublicationPackages.id, input.packageId)).get();
    if (!packageRow || packageRow.projectId !== input.projectId) throw new Error('not_found: pacote de publicação não pertence ao projeto.');
    if (packageRow.status !== 'approved') throw new Error('approval_required: aprove o pacote antes de agendar.');
    if (input.visibility === 'public' && !packageRow.thumbnailAssetId) throw new Error('approval_required: selecione uma thumbnail aprovada antes de agendar uma publicação pública.');
    const value = { id: input.id, projectId: input.projectId, packageId: input.packageId, platform: input.platform, visibility: input.visibility, status: 'scheduled' as const, approvalRequired: true, scheduledAt: input.scheduledAt, publishedAt: null };
    this.db.insert(contentPublications).values(value).run();
    return value;
  }

  recordPublishedPublication(input: { id: string; projectId: string; packageId: string; platform: string; visibility: 'private' | 'unlisted' | 'public'; publishedAt: string }): ContentPublication {
    const packageRow = this.publicationPackage(input.packageId);
    if (!packageRow || packageRow.projectId !== input.projectId || packageRow.status !== 'approved') throw new Error('approval_required: o pacote precisa estar aprovado.');
    if (input.visibility === 'public' && !packageRow.thumbnailAssetId) throw new Error('approval_required: selecione uma thumbnail aprovada antes de publicar.');
    const value = { id: input.id, projectId: input.projectId, packageId: input.packageId, platform: input.platform, visibility: input.visibility, status: 'published' as const, approvalRequired: true, scheduledAt: null, publishedAt: input.publishedAt };
    this.db.insert(contentPublications).values(value).run();
    return contentPublicationSchema.parse(value);
  }

  listPublications(projectId: string): ContentPublication[] {
    return this.db.select().from(contentPublications).where(eq(contentPublications.projectId, projectId)).orderBy(asc(contentPublications.scheduledAt)).all().map((row) => contentPublicationSchema.parse({ id: row.id, projectId: row.projectId, packageId: row.packageId, platform: row.platform, visibility: row.visibility, status: row.status, approvalRequired: row.approvalRequired, scheduledAt: row.scheduledAt, publishedAt: row.publishedAt }));
  }

  saveAnalyticsSnapshot(input: ContentAnalyticsSnapshot): ContentAnalyticsSnapshot {
    const parsed = contentAnalyticsSnapshotSchema.parse(input);
    this.db.insert(contentAnalyticsSnapshots).values({ id: parsed.id, projectId: parsed.projectId, publicationId: parsed.publicationId, platform: parsed.platform, capturedAt: parsed.capturedAt, metricsJson: JSON.stringify(parsed.metrics), notes: parsed.notes }).run();
    return parsed;
  }

  listAnalyticsSnapshots(projectId: string): ContentAnalyticsSnapshot[] {
    return this.db.select().from(contentAnalyticsSnapshots).where(eq(contentAnalyticsSnapshots.projectId, projectId)).orderBy(asc(contentAnalyticsSnapshots.capturedAt)).all().map((row) => contentAnalyticsSnapshotSchema.parse({ id: row.id, projectId: row.projectId, publicationId: row.publicationId, platform: row.platform, capturedAt: row.capturedAt, metrics: parseNumberObject(row.metricsJson), notes: row.notes }));
  }
}

function parseArray(value: string): unknown[] { try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function parseObject(value: string): Record<string, unknown> { try { const parsed = JSON.parse(value) as unknown; return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}; } catch { return {}; } }
function parseBrief(value: string): ContentBrief | null { try { const parsed = contentBriefSchema.safeParse(JSON.parse(value)); return parsed.success ? parsed.data : null; } catch { return null; } }
function parseScript(value: string): ContentScript | null { try { const parsed = contentScriptSchema.safeParse(JSON.parse(value)); return parsed.success ? parsed.data : null; } catch { return null; } }
function parseNumberObject(value: string): Record<string, number> { try { const parsed = JSON.parse(value) as unknown; if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}; return Object.fromEntries(Object.entries(parsed).filter(([, item]) => typeof item === 'number' && Number.isFinite(item))) as Record<string, number>; } catch { return {}; } }
