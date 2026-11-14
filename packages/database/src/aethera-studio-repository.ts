import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import {
  isSafeProductionPath,
  sourceCandidateSchema,
  mediaAcquisitionJobSchema,
  mediaProvenanceSchema,
  mediaSegmentSchema,
  subjectIdentitySchema,
  verifiedSubjectSchema,
  editorialUsePolicySchema,
  narrationDirectionSchema,
  voiceAuthorizationSchema,
  voicePresetSchema,
  type NarrationDirection,
  type VoiceAuthorization,
  type VoicePreset,
  mediaEditorialDecisionSchema,
  type EditorialUsePolicy,
  type MediaEditorialDecision,
  visionBenchmarkSchema,
  type VisionBenchmark,
  type CandidateStatus,
  type MediaAcquisitionJob,
  type SourceCandidate,
  type MediaProvenance,
  type MediaSegment,
  type SubjectIdentity,
  type VerifiedSubject,
  type VisionTask,
} from '@neuralbridge/shared';
import type { Db } from './open.js';
import { aetheraNarrationDirections, aetheraVoiceAuthorizations, aetheraVoicePresets, aetheraEditorialPolicies, aetheraMediaEditorialDecisions, aetheraMediaAcquisitions, aetheraMediaCandidates, aetheraMediaProvenance, aetheraMediaSegments, aetheraMediaUsageEvents, aetheraSubjectIdentities, aetheraSubjects, aetheraVisionCache, aetheraVisionBenchmarks, aetheraVisionSpend, velixLocalAssets, velixProductionRuns } from './schema.js';

const now = () => new Date().toISOString();

export type MediaUsageEvent = { id: string; runId: string; assetId: string | null; candidateId: string | null; subjectId: string | null; event: string; detail: string; createdAt: string };

export type VisionCacheKey = { frameHash: string; provider: string; model: string; promptVersion: string; task: VisionTask };
const cacheKey = (key: VisionCacheKey) => JSON.stringify([key.frameHash, key.provider, key.model, key.promptVersion, key.task]);

/**
 * Persistence of the Aethera Autonomous Studio (migration 0108): verified games of a run, resumable acquisitions,
 * provenance, indexed segments, identity verdicts and the vision cache. Every row is parsed back through its contract.
 */
export class AetheraStudioRepository {
  constructor(private readonly db: Db) {}

  saveSubject(runId: string, input: VerifiedSubject): VerifiedSubject {
    const subject = verifiedSubjectSchema.parse(input);
    const timestamp = now();
    const values = { kind: subject.kind, title: subject.title, dataJson: JSON.stringify(subject), verification: subject.verification, checkedAt: subject.checkedAt, updatedAt: timestamp };
    this.db.insert(aetheraSubjects).values({ id: subject.id, runId, ...values, createdAt: timestamp }).onConflictDoUpdate({ target: aetheraSubjects.id, set: values }).run();
    return subject;
  }

  listSubjects(runId: string): VerifiedSubject[] {
    return this.db.select().from(aetheraSubjects).where(eq(aetheraSubjects.runId, runId)).orderBy(sql`rowid`).all().map((row) => verifiedSubjectSchema.parse(JSON.parse(row.dataJson)));
  }

  /** Idempotent: the same source and format in the same run returns the job that already exists. */
  enqueueAcquisition(input: Pick<MediaAcquisitionJob, 'runId' | 'subjectId' | 'referenceId' | 'adapter' | 'idempotencyKey'>): MediaAcquisitionJob {
    const existing = this.db.select().from(aetheraMediaAcquisitions).where(and(eq(aetheraMediaAcquisitions.runId, input.runId), eq(aetheraMediaAcquisitions.idempotencyKey, input.idempotencyKey))).get();
    if (existing) return this.parseAcquisition(existing);
    const timestamp = now();
    const job = mediaAcquisitionJobSchema.parse({ schemaVersion: 1, id: randomUUID(), ...input, status: 'queued', attempt: 0, bytesDone: 0, bytesTotal: null });
    this.db.insert(aetheraMediaAcquisitions).values({ id: job.id, runId: job.runId, subjectId: job.subjectId, referenceId: job.referenceId, adapter: job.adapter, idempotencyKey: job.idempotencyKey, status: job.status, attempt: 0, bytesDone: 0, bytesTotal: null, createdAt: timestamp, updatedAt: timestamp }).run();
    return job;
  }

  updateAcquisition(id: string, patch: Partial<Pick<MediaAcquisitionJob, 'status' | 'attempt' | 'bytesDone' | 'bytesTotal' | 'partialPath' | 'result' | 'error'>>): MediaAcquisitionJob {
    if (patch.partialPath !== undefined && !isSafeProductionPath(patch.partialPath)) throw new Error('forbidden: o caminho parcial precisa ficar dentro do projeto.');
    const row = this.db.select().from(aetheraMediaAcquisitions).where(eq(aetheraMediaAcquisitions.id, id)).get();
    if (!row) throw new Error('not_found: aquisição não encontrada.');
    const next = mediaAcquisitionJobSchema.parse({ ...this.parseAcquisition(row), ...patch });
    this.db.update(aetheraMediaAcquisitions).set({ status: next.status, attempt: next.attempt, bytesDone: next.bytesDone, bytesTotal: next.bytesTotal, partialPath: next.partialPath ?? null, resultJson: next.result ? JSON.stringify(next.result) : null, errorJson: next.error ? JSON.stringify(next.error) : null, updatedAt: now() }).where(eq(aetheraMediaAcquisitions.id, id)).run();
    return next;
  }

  listAcquisitions(runId: string): MediaAcquisitionJob[] {
    return this.db.select().from(aetheraMediaAcquisitions).where(eq(aetheraMediaAcquisitions.runId, runId)).orderBy(sql`rowid`).all().map((row) => this.parseAcquisition(row));
  }

  saveProvenance(input: MediaProvenance): MediaProvenance {
    const provenance = mediaProvenanceSchema.parse(input);
    const values = { url: provenance.url, platform: provenance.platform, publisher: provenance.publisher, official: provenance.official, publishedAt: provenance.publishedAt, license: provenance.license, knownRestrictionsJson: JSON.stringify(provenance.knownRestrictions), adapter: provenance.adapter, adapterVersion: provenance.adapterVersion, acquiredAt: provenance.acquiredAt, usage: provenance.usage, legalClearance: provenance.legalClearance, updatedAt: now() };
    this.db.insert(aetheraMediaProvenance).values({ assetId: provenance.assetId, ...values }).onConflictDoUpdate({ target: aetheraMediaProvenance.assetId, set: values }).run();
    return provenance;
  }

  provenance(assetId: string): MediaProvenance | null {
    const row = this.db.select().from(aetheraMediaProvenance).where(eq(aetheraMediaProvenance.assetId, assetId)).get();
    if (!row) return null;
    return mediaProvenanceSchema.parse({ schemaVersion: 1, assetId: row.assetId, url: row.url, platform: row.platform, publisher: row.publisher, official: row.official, publishedAt: row.publishedAt, license: row.license, knownRestrictions: JSON.parse(row.knownRestrictionsJson) as unknown, adapter: row.adapter, adapterVersion: row.adapterVersion, acquiredAt: row.acquiredAt, usage: row.usage, legalClearance: row.legalClearance });
  }

  /** The index of an asset is rebuilt as a whole: a new analysis replaces the previous segments in one transaction. */
  replaceSegments(assetId: string, input: readonly MediaSegment[]): MediaSegment[] {
    const segments = input.map((segment) => mediaSegmentSchema.parse(segment));
    if (segments.some((segment) => segment.assetId !== assetId)) throw new Error('invalid: todos os segmentos precisam ser do mesmo ativo.');
    const timestamp = now();
    this.db.transaction((tx) => {
      const existing = tx.select().from(aetheraMediaSegments).where(eq(aetheraMediaSegments.assetId, assetId)).all();
      for (const row of existing) {
        if (!segments.some((segment) => segment.id === row.id && JSON.stringify(segment) === row.dataJson)) tx.delete(aetheraMediaSegments).where(eq(aetheraMediaSegments.id, row.id)).run();
      }
      for (const segment of segments) tx.insert(aetheraMediaSegments).values({ id: segment.id, assetId, startMs: segment.startMs, endMs: segment.endMs, kind: segment.kind, dataJson: JSON.stringify(segment), createdAt: timestamp }).onConflictDoNothing().run();
    });
    return this.listSegments(assetId);
  }

  listSegments(assetId: string): MediaSegment[] {
    return this.db.select().from(aetheraMediaSegments).where(eq(aetheraMediaSegments.assetId, assetId)).orderBy(asc(aetheraMediaSegments.startMs), asc(aetheraMediaSegments.id)).all().map((row) => mediaSegmentSchema.parse(JSON.parse(row.dataJson)));
  }

  recordIdentity(input: SubjectIdentity): SubjectIdentity {
    const identity = subjectIdentitySchema.parse(input);
    this.db.insert(aetheraSubjectIdentities).values({ id: identity.id, assetId: identity.assetId, segmentId: identity.segmentId, subjectId: identity.subjectId, status: identity.status, dataJson: JSON.stringify(identity), createdAt: now() }).run();
    return identity;
  }

  listIdentities(subjectId: string): SubjectIdentity[] {
    return this.db.select().from(aetheraSubjectIdentities).where(eq(aetheraSubjectIdentities.subjectId, subjectId)).orderBy(sql`rowid`).all().map((row) => subjectIdentitySchema.parse(JSON.parse(row.dataJson)));
  }

  visionCache(key: VisionCacheKey): unknown {
    const row = this.db.select().from(aetheraVisionCache).where(eq(aetheraVisionCache.key, cacheKey(key))).get();
    return row ? (JSON.parse(row.resultJson) as unknown) : null;
  }

  saveBenchmark(input: VisionBenchmark): VisionBenchmark {
    const record = visionBenchmarkSchema.parse(input);
    const values = { datasetVersion: record.datasetVersion, category: record.category, synthetic: record.synthetic, dataJson: JSON.stringify(record), createdAt: record.createdAt };
    this.db.insert(aetheraVisionBenchmarks).values({ id: record.id, ...values }).onConflictDoUpdate({ target: aetheraVisionBenchmarks.id, set: values }).run();
    return record;
  }

  listBenchmarks(datasetVersion: string): VisionBenchmark[] {
    return this.db.select().from(aetheraVisionBenchmarks).where(eq(aetheraVisionBenchmarks.datasetVersion, datasetVersion)).orderBy(asc(aetheraVisionBenchmarks.category), asc(aetheraVisionBenchmarks.id)).all().map((row) => visionBenchmarkSchema.parse(JSON.parse(row.dataJson)));
  }

  visionSpend(runId: string): number {
    return this.db.select({ amountUsd: aetheraVisionSpend.amountUsd }).from(aetheraVisionSpend).where(eq(aetheraVisionSpend.runId, runId)).get()?.amountUsd ?? 0;
  }

  addVisionSpend(runId: string, amountUsd: number): number {
    if (!Number.isFinite(amountUsd) || amountUsd < 0) throw new Error('invalid: visual spend amount.');
    const timestamp = now();
    this.db.insert(aetheraVisionSpend).values({ runId, amountUsd, updatedAt: timestamp }).onConflictDoUpdate({ target: aetheraVisionSpend.runId, set: { amountUsd: sql`${aetheraVisionSpend.amountUsd} + ${amountUsd}`, updatedAt: timestamp } }).run();
    return this.visionSpend(runId);
  }

  saveVisionCache(key: VisionCacheKey, result: unknown): void {
    const values = { provider: key.provider, model: key.model, promptVersion: key.promptVersion, task: key.task, resultJson: JSON.stringify(result), createdAt: now() };
    this.db.insert(aetheraVisionCache).values({ key: cacheKey(key), ...values }).onConflictDoUpdate({ target: aetheraVisionCache.key, set: values }).run();
  }

  /** Candidates are unique per run and URL; rediscovery refreshes the metadata but keeps the person's decision. */
  saveCandidate(input: SourceCandidate): SourceCandidate {
    const candidate = sourceCandidateSchema.parse(input);
    const existing = this.db.select().from(aetheraMediaCandidates).where(and(eq(aetheraMediaCandidates.runId, candidate.runId), eq(aetheraMediaCandidates.url, candidate.url))).get();
    const timestamp = now();
    const kept = existing ? { ...candidate, id: existing.id, status: existing.status === 'proposed' ? candidate.status : (existing.status as CandidateStatus) } : candidate;
    const values = { subjectId: kept.subjectId, referenceId: kept.referenceId, source: kept.source, kind: kept.kind, status: kept.status, score: kept.score, identity: kept.identity, dataJson: JSON.stringify(kept), updatedAt: timestamp };
    if (existing) this.db.update(aetheraMediaCandidates).set(values).where(eq(aetheraMediaCandidates.id, existing.id)).run();
    else this.db.insert(aetheraMediaCandidates).values({ id: kept.id, runId: kept.runId, url: kept.url, ...values, createdAt: timestamp }).run();
    return sourceCandidateSchema.parse(kept);
  }

  listCandidates(runId: string): SourceCandidate[] {
    return this.db.select().from(aetheraMediaCandidates).where(eq(aetheraMediaCandidates.runId, runId)).orderBy(sql`rowid`).all().map((row) => this.parseCandidate(row));
  }

  candidate(id: string): SourceCandidate | null {
    const row = this.db.select().from(aetheraMediaCandidates).where(eq(aetheraMediaCandidates.id, id)).get();
    return row ? this.parseCandidate(row) : null;
  }

  setCandidateStatus(id: string, status: CandidateStatus): SourceCandidate {
    const current = this.candidate(id);
    if (!current) throw new Error('not_found: fonte de mídia não encontrada.');
    const next = sourceCandidateSchema.parse({ ...current, status });
    this.db.update(aetheraMediaCandidates).set({ status, dataJson: JSON.stringify(next), updatedAt: now() }).where(eq(aetheraMediaCandidates.id, id)).run();
    return next;
  }

  /** Usage history of a source or asset: discovered, selected, acquired, reused, identity verdicts, failures. */
  logUsage(input: Omit<MediaUsageEvent, 'id' | 'createdAt' | 'assetId' | 'candidateId' | 'subjectId' | 'detail'> & Partial<Pick<MediaUsageEvent, 'assetId' | 'candidateId' | 'subjectId' | 'detail'>>): MediaUsageEvent {
    const event: MediaUsageEvent = { id: randomUUID(), runId: input.runId, assetId: input.assetId ?? null, candidateId: input.candidateId ?? null, subjectId: input.subjectId ?? null, event: input.event, detail: input.detail ?? '', createdAt: now() };
    this.db.insert(aetheraMediaUsageEvents).values(event).run();
    return event;
  }

  listUsage(filter: { runId: string } | { assetId: string }): MediaUsageEvent[] {
    const where = 'runId' in filter ? eq(aetheraMediaUsageEvents.runId, filter.runId) : eq(aetheraMediaUsageEvents.assetId, filter.assetId);
    return this.db.select().from(aetheraMediaUsageEvents).where(where).orderBy(sql`rowid`).all();
  }

  /** A source already acquired for this video project in any run: reuse it instead of downloading again. */
  acquiredForKey(projectId: string, idempotencyKey: string): MediaAcquisitionJob | null {
    const rows = this.db.select({ job: aetheraMediaAcquisitions }).from(aetheraMediaAcquisitions).innerJoin(velixProductionRuns, eq(velixProductionRuns.id, aetheraMediaAcquisitions.runId))
      .where(and(eq(velixProductionRuns.projectId, projectId), eq(aetheraMediaAcquisitions.idempotencyKey, idempotencyKey), eq(aetheraMediaAcquisitions.status, 'done'))).all();
    const done = rows.map((row) => this.parseAcquisition(row.job)).find((job) => job.result && this.db.select().from(velixLocalAssets).where(eq(velixLocalAssets.id, job.result.assetId)).get());
    return done ?? null;
  }

  /** The library asset of this project with the same content, whatever its source. */
  assetBySha(projectId: string, sha256: string) {
    return this.db.select().from(velixLocalAssets).where(and(eq(velixLocalAssets.projectId, projectId), eq(velixLocalAssets.sha256, sha256))).get() ?? null;
  }

  acquisition(runId: string, idempotencyKey: string): MediaAcquisitionJob | null {
    const row = this.db.select().from(aetheraMediaAcquisitions).where(and(eq(aetheraMediaAcquisitions.runId, runId), eq(aetheraMediaAcquisitions.idempotencyKey, idempotencyKey))).get();
    return row ? this.parseAcquisition(row) : null;
  }

  /** AP-02: the editorial-use policy of a video project; null means never decided (off). */
  editorialPolicy(projectId: string): EditorialUsePolicy | null {
    const row = this.db.select().from(aetheraEditorialPolicies).where(eq(aetheraEditorialPolicies.projectId, projectId)).get();
    return row ? editorialUsePolicySchema.parse({ schemaVersion: 1, ...row }) : null;
  }

  setEditorialPolicy(input: Omit<EditorialUsePolicy, 'schemaVersion' | 'decidedAt'>): EditorialUsePolicy {
    const policy = editorialUsePolicySchema.parse({ schemaVersion: 1, ...input, decidedAt: now() });
    const { schemaVersion: _version, ...row } = policy;
    void _version;
    this.db.insert(aetheraEditorialPolicies).values(row).onConflictDoUpdate({ target: aetheraEditorialPolicies.projectId, set: row }).run();
    return policy;
  }

  /** AP-02: the person's decision on one acquired asset of a project; null when not decided. */
  editorialDecision(projectId: string, assetId: string): MediaEditorialDecision | null {
    const row = this.db.select().from(aetheraMediaEditorialDecisions).where(and(eq(aetheraMediaEditorialDecisions.projectId, projectId), eq(aetheraMediaEditorialDecisions.assetId, assetId))).get();
    return row ? mediaEditorialDecisionSchema.parse({ schemaVersion: 1, ...row }) : null;
  }

  decideEditorialUse(input: Omit<MediaEditorialDecision, 'schemaVersion' | 'decidedAt'>): MediaEditorialDecision {
    const decision = mediaEditorialDecisionSchema.parse({ schemaVersion: 1, ...input, decidedAt: now() });
    if (!this.db.select({ id: velixLocalAssets.id }).from(velixLocalAssets).where(and(eq(velixLocalAssets.id, decision.assetId), eq(velixLocalAssets.projectId, decision.projectId))).get()) throw new Error('not_found: ativo não pertence ao projeto.');
    const { schemaVersion: _version, ...row } = decision;
    void _version;
    this.db.insert(aetheraMediaEditorialDecisions).values(row).onConflictDoUpdate({ target: [aetheraMediaEditorialDecisions.assetId, aetheraMediaEditorialDecisions.projectId], set: row }).run();
    return decision;
  }

  /** Aethera channel voice: a designed preset of a video project. Saving the same id replaces it. */
  saveVoicePreset(input: VoicePreset): VoicePreset {
    const preset = voicePresetSchema.parse(input);
    const row = { id: preset.id, projectId: preset.projectId, dataJson: JSON.stringify(preset), createdAt: preset.createdAt };
    this.db.insert(aetheraVoicePresets).values(row).onConflictDoUpdate({ target: aetheraVoicePresets.id, set: row }).run();
    return preset;
  }

  voicePreset(id: string): VoicePreset | null {
    const row = this.db.select().from(aetheraVoicePresets).where(eq(aetheraVoicePresets.id, id)).get();
    return row ? voicePresetSchema.parse(JSON.parse(row.dataJson)) : null;
  }

  listVoicePresets(projectId: string): VoicePreset[] {
    return this.db.select().from(aetheraVoicePresets).where(eq(aetheraVoicePresets.projectId, projectId)).orderBy(asc(aetheraVoicePresets.createdAt)).all().map((row) => voicePresetSchema.parse(JSON.parse(row.dataJson)));
  }

  /** A new authorization replaces (revokes) the active one of the same preset and project. */
  grantVoiceAuthorization(input: Omit<VoiceAuthorization, 'schemaVersion' | 'id' | 'grantedAt' | 'revokedAt'>): VoiceAuthorization {
    if (!this.voicePreset(input.presetId)) throw new Error('not_found: voz do canal não encontrada.');
    const grantedAt = now();
    const authorization = voiceAuthorizationSchema.parse({ schemaVersion: 1, id: randomUUID(), ...input, grantedAt, revokedAt: null });
    const active = this.activeVoiceAuthorization(input.presetId, input.projectId);
    if (active) this.revokeVoiceAuthorization(active.id, grantedAt);
    this.db.insert(aetheraVoiceAuthorizations).values({ id: authorization.id, presetId: authorization.presetId, projectId: authorization.projectId, dataJson: JSON.stringify(authorization), grantedAt, revokedAt: null }).run();
    return authorization;
  }

  activeVoiceAuthorization(presetId: string, projectId: string): VoiceAuthorization | null {
    const row = this.db.select().from(aetheraVoiceAuthorizations).where(and(eq(aetheraVoiceAuthorizations.presetId, presetId), eq(aetheraVoiceAuthorizations.projectId, projectId), isNull(aetheraVoiceAuthorizations.revokedAt))).orderBy(desc(aetheraVoiceAuthorizations.grantedAt)).get();
    return row ? voiceAuthorizationSchema.parse(JSON.parse(row.dataJson)) : null;
  }

  revokeVoiceAuthorization(id: string, at = now()): void {
    const row = this.db.select().from(aetheraVoiceAuthorizations).where(eq(aetheraVoiceAuthorizations.id, id)).get();
    if (!row) return;
    const revoked = { ...(JSON.parse(row.dataJson) as VoiceAuthorization), revokedAt: at };
    this.db.update(aetheraVoiceAuthorizations).set({ revokedAt: at, dataJson: JSON.stringify(revoked) }).where(eq(aetheraVoiceAuthorizations.id, id)).run();
  }

  /** Per-scene direction; `null` clears the scene back to the preset's defaults. */
  setNarrationDirection(runId: string, sceneId: string, direction: NarrationDirection | null): void {
    if (!direction) { this.db.delete(aetheraNarrationDirections).where(and(eq(aetheraNarrationDirections.runId, runId), eq(aetheraNarrationDirections.sceneId, sceneId))).run(); return; }
    const parsed = narrationDirectionSchema.parse({ ...direction, sceneId });
    const row = { runId, sceneId, dataJson: JSON.stringify(parsed) };
    this.db.insert(aetheraNarrationDirections).values(row).onConflictDoUpdate({ target: [aetheraNarrationDirections.runId, aetheraNarrationDirections.sceneId], set: row }).run();
  }

  listNarrationDirections(runId: string): NarrationDirection[] {
    return this.db.select().from(aetheraNarrationDirections).where(eq(aetheraNarrationDirections.runId, runId)).all().map((row) => narrationDirectionSchema.parse(JSON.parse(row.dataJson)));
  }

  private parseCandidate(row: typeof aetheraMediaCandidates.$inferSelect): SourceCandidate {
    return sourceCandidateSchema.parse({ ...(JSON.parse(row.dataJson) as object), id: row.id, status: row.status });
  }

  private parseAcquisition(row: typeof aetheraMediaAcquisitions.$inferSelect): MediaAcquisitionJob {
    return mediaAcquisitionJobSchema.parse({
      schemaVersion: 1, id: row.id, runId: row.runId, subjectId: row.subjectId, referenceId: row.referenceId, adapter: row.adapter, idempotencyKey: row.idempotencyKey, status: row.status, attempt: row.attempt, bytesDone: row.bytesDone, bytesTotal: row.bytesTotal,
      ...(row.partialPath ? { partialPath: row.partialPath } : {}), ...(row.resultJson ? { result: JSON.parse(row.resultJson) as unknown } : {}), ...(row.errorJson ? { error: JSON.parse(row.errorJson) as unknown } : {}),
    });
  }
}
