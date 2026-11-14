import { randomUUID } from 'node:crypto';
import { asc, eq, sql } from 'drizzle-orm';
import { velixClipSuggestions, velixDiscoverySearches, velixEditorialDecisions, velixEditorialVersions, velixLocalAssets, velixMediaAnalyses, velixMediaReferences, velixMediaRights, velixMotionJobs, velixMotionProjects, velixProductionIdeas } from './schema.js';
import type { Db } from './open.js';

export class VelixDiscoveryRepository {
  constructor(private readonly db: Db) {}
  createSearch(input: Omit<typeof velixDiscoverySearches.$inferInsert, 'id'>) { const row = { ...input, id: randomUUID() }; this.db.insert(velixDiscoverySearches).values(row).run(); return row; }
  updateSearch(id: string, status: string, cache?: { results: string; nextPageToken: string | null; expiresAt: string }) { this.db.update(velixDiscoverySearches).set({ status, ...cache }).where(eq(velixDiscoverySearches.id, id)).run(); }
  /** An unexpired answer to the same search, so a repeated query spends no API quota. */
  cachedSearch(projectId: string, cacheKey: string, now: string) { return this.db.select().from(velixDiscoverySearches).where(eq(velixDiscoverySearches.projectId, projectId)).all().reverse().find((row) => row.cacheKey === cacheKey && row.status === 'ok' && row.results !== null && row.expiresAt !== null && row.expiresAt > now) ?? null; }
  saveReference(input: Omit<typeof velixMediaReferences.$inferInsert, 'id'>) { const row = { ...input, id: randomUUID() }; this.db.insert(velixMediaReferences).values(row).run(); return row; }
  saveRights(input: Omit<typeof velixMediaRights.$inferInsert, 'id' | 'restrictions'> & { restrictions?: string[] }) { const row = { ...input, id: randomUUID(), restrictions: JSON.stringify(input.restrictions ?? []) }; this.db.insert(velixMediaRights).values(row).run(); return row; }
  saveClip(input: Omit<typeof velixClipSuggestions.$inferInsert, 'id' | 'criteria'> & { criteria?: string[] }) { const row = { ...input, id: randomUUID(), criteria: JSON.stringify(input.criteria ?? []) }; this.db.insert(velixClipSuggestions).values(row).run(); return row; }
  updateClip(id: string, input: { start?: number; end?: number; accepted?: boolean; favorite?: boolean; orderIndex?: number }) { this.db.update(velixClipSuggestions).set(input).where(eq(velixClipSuggestions.id, id)).run(); }
  reorderClips(projectId: string, ids: string[]) {
    const rows = this.db.select({ id: velixClipSuggestions.id }).from(velixClipSuggestions).where(eq(velixClipSuggestions.projectId, projectId)).all();
    const allowed = new Set(rows.map((row) => row.id));
    if (new Set(ids).size !== ids.length || ids.some((id) => !allowed.has(id))) throw new Error('invalid: a ordem contém cortes de outro projeto ou duplicados.');
    ids.forEach((id, index) => this.updateClip(id, { orderIndex: index }));
  }
  saveAsset(input: Omit<typeof velixLocalAssets.$inferInsert, 'id'>) { const row = { ...input, id: randomUUID() }; this.db.insert(velixLocalAssets).values(row).run(); return row; }
  saveAnalysis(input: Omit<typeof velixMediaAnalyses.$inferInsert, 'id' | 'metadata' | 'sceneCuts' | 'silences'> & { metadata: unknown; sceneCuts: number[]; silences: unknown[] }) { const row = { ...input, id: randomUUID(), metadata: JSON.stringify(input.metadata), sceneCuts: JSON.stringify(input.sceneCuts), silences: JSON.stringify(input.silences) }; this.db.insert(velixMediaAnalyses).values(row).run(); return row; }
  createIdea(input: Omit<typeof velixProductionIdeas.$inferInsert, 'id'>) { const row = { ...input, id: randomUUID() }; this.db.insert(velixProductionIdeas).values(row).run(); return row; }
  private referenceRows(projectId: string) { return this.db.select().from(velixMediaReferences).where(eq(velixMediaReferences.projectId, projectId)).orderBy(asc(velixMediaReferences.createdAt)).all(); }
  /** Every URL ever seen in the project, whatever its review, so a rejected source does not come back. */
  referenceUrls(projectId: string) { return new Set(this.referenceRows(projectId).map((row) => row.url)); }
  /** The reference already recorded for a URL in this project, so a source found again is not duplicated (AS-04). */
  referenceByUrl(projectId: string, url: string) { return this.referenceRows(projectId).find((row) => row.url === url) ?? null; }
  /** What an agent found stays here until a person approves it: listProject and every editorial flow see only approved sources. */
  pendingReferences(projectId: string) { return this.referenceRows(projectId).filter((row) => row.reviewStatus === 'pending'); }
  decideReference(projectId: string, id: string, decision: 'approved' | 'rejected') {
    const row = this.pendingReferences(projectId).find((item) => item.id === id);
    if (!row) throw new Error('not_found: referência pendente não pertence ao projeto.');
    this.db.update(velixMediaReferences).set({ reviewStatus: decision }).where(eq(velixMediaReferences.id, id)).run();
    return { ...row, reviewStatus: decision };
  }
  loadMotion(projectId: string) { return this.db.select().from(velixMotionProjects).where(eq(velixMotionProjects.projectId, projectId)).get()?.data ?? null; }
  saveMotion(projectId: string, data: string) { this.db.insert(velixMotionProjects).values({ projectId, data }).onConflictDoUpdate({ target: velixMotionProjects.projectId, set: { data, updatedAt: new Date().toISOString() } }).run(); }
  createMotionJob(input: { id: string; projectId: string; editorialVersionId: string; scriptHash: string; compositionHash: string }) { this.db.insert(velixMotionJobs).values({ ...input, status: 'running' }).run(); }
  finishMotionJob(id: string, input: { status: string; outputPath?: string; error?: string }) { this.db.update(velixMotionJobs).set(input).where(eq(velixMotionJobs.id, id)).run(); }
  motionJob(id: string) { return this.db.select().from(velixMotionJobs).where(eq(velixMotionJobs.id, id)).get() ?? null; }
  /** A render cannot survive a restart: its process died with the app, so the job says so instead of staying "running". */
  recoverMotionJobs() { this.db.update(velixMotionJobs).set({ status: 'failed', error: 'Interrompido pelo reinício do aplicativo.' }).where(eq(velixMotionJobs.status, 'running')).run(); }
  listIdeas(projectId: string) { return this.db.select().from(velixProductionIdeas).where(eq(velixProductionIdeas.projectId, projectId)).orderBy(asc(velixProductionIdeas.createdAt)).all(); }
  getIdea(projectId: string, id: string) { return this.listIdeas(projectId).find((row) => row.id === id) ?? null; }
  updateIdea(projectId: string, id: string, input: { status?: string; payload?: string }) { if (!this.getIdea(projectId, id)) throw new Error('not_found: ideia não pertence ao projeto.'); this.db.update(velixProductionIdeas).set(input).where(eq(velixProductionIdeas.id, id)).run(); }
  saveEditorialVersion(input: Omit<typeof velixEditorialVersions.$inferInsert, 'id' | 'version' | 'approved'>) { const previous = this.db.select().from(velixEditorialVersions).where(eq(velixEditorialVersions.projectId, input.projectId)).all().filter((row) => row.kind === input.kind && row.ideaId === (input.ideaId ?? null)); const row = { ...input, id: randomUUID(), version: previous.length + 1, approved: false }; this.db.insert(velixEditorialVersions).values(row).run(); return row; }
  updateEditorialVersion(_id: string, _content: string): never { void _id; void _content; throw new Error('invalid: versão editorial imutável; crie uma nova versão.'); }
  decideEditorial(input: Omit<typeof velixEditorialDecisions.$inferInsert, 'id'>) { const version = this.db.select().from(velixEditorialVersions).where(eq(velixEditorialVersions.id, input.versionId)).get(); if (!version || version.projectId !== input.projectId) throw new Error('not_found: versão editorial não pertence ao projeto.'); if (input.decision === 'approved' && version.kind === 'script') { if (!version.sourceVersionId) throw new Error('invalid: roteiro não possui brief de origem.'); const source = this.db.select().from(velixEditorialVersions).where(eq(velixEditorialVersions.id, version.sourceVersionId)).get(); if (!source || source.projectId !== input.projectId || source.kind !== 'brief' || !source.approved) throw new Error('invalid: o brief de origem precisa estar aprovado.'); } const row = { ...input, id: randomUUID() }; this.db.insert(velixEditorialDecisions).values(row).run(); this.db.update(velixEditorialVersions).set({ approved: input.decision === 'approved' }).where(eq(velixEditorialVersions.id, input.versionId)).run(); return row; }
  getApprovedScript(projectId: string, versionId: string) { const version = this.db.select().from(velixEditorialVersions).where(eq(velixEditorialVersions.id, versionId)).get(); if (!version || version.projectId !== projectId || version.kind !== 'script' || !version.approved) throw new Error('forbidden: roteiro aprovado não encontrado para este projeto.'); if (!version.sourceVersionId) throw new Error('forbidden: roteiro sem brief de origem.'); const brief = this.db.select().from(velixEditorialVersions).where(eq(velixEditorialVersions.id, version.sourceVersionId)).get(); if (!brief || brief.projectId !== projectId || brief.kind !== 'brief' || !brief.approved) throw new Error('forbidden: brief de origem não aprovado.'); return version; }
  listEditorial(projectId: string) { return { ideas: this.db.select().from(velixProductionIdeas).where(eq(velixProductionIdeas.projectId, projectId)).all(), versions: this.db.select().from(velixEditorialVersions).where(eq(velixEditorialVersions.projectId, projectId)).all(), decisions: this.db.select().from(velixEditorialDecisions).where(eq(velixEditorialDecisions.projectId, projectId)).all() }; }
  listProject(projectId: string) { return { searches: this.db.select().from(velixDiscoverySearches).where(eq(velixDiscoverySearches.projectId, projectId)).orderBy(asc(velixDiscoverySearches.createdAt)).all(), references: this.referenceRows(projectId).filter((row) => row.reviewStatus === 'approved'), rights: this.db.select().from(velixMediaRights).where(eq(velixMediaRights.projectId, projectId)).orderBy(sql`rowid`).all(), clips: this.db.select().from(velixClipSuggestions).where(eq(velixClipSuggestions.projectId, projectId)).orderBy(asc(velixClipSuggestions.orderIndex), asc(velixClipSuggestions.createdAt)).all(), assets: this.db.select().from(velixLocalAssets).where(eq(velixLocalAssets.projectId, projectId)).orderBy(asc(velixLocalAssets.createdAt)).all(), analyses: this.db.select().from(velixMediaAnalyses).where(eq(velixMediaAnalyses.projectId, projectId)).orderBy(asc(velixMediaAnalyses.createdAt)).all() }; }
}
