import { createHash, randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  type ClaimKind,
  type ProductionClaim,
  type ResearchAnswer,
  type ResearchClassification,
  claimGate,
  claimKinds,
  normalizeSentence,
  researchAnswerSchema,
} from '@neuralbridge/shared';
import { type DatabaseHandle } from './open.js';
import { velixClaimEvidence, velixEditorialClaims, velixResearchCache } from './schema.js';

export interface ClaimInput {
  runId: string;
  projectId: string;
  stageId: string | null;
  chapter: number | null;
  segmentHash: string;
  text: string;
  kind: ClaimKind;
  confidence: number;
}

export interface EvidenceInput {
  url: string;
  title: string;
  publisher: string;
  publishedAt: string | null;
  excerpt: string;
  confidence: number;
  classification: ResearchClassification;
  referenceId: string | null;
}

const textHash = (value: string) => createHash('sha256').update(normalizeSentence(value)).digest('hex');

/** Claims of a production, their evidence and the research cache. Evidence is approved only by a person. */
export class VelixClaimRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  private get db() {
    return this.handle.db;
  }

  /** Idempotent by run + normalized text: the same claim found twice (or after a restart) is one claim. */
  upsertClaim(input: ClaimInput): string {
    const hash = textHash(input.text);
    const existing = this.db.select({ id: velixEditorialClaims.id }).from(velixEditorialClaims).where(and(eq(velixEditorialClaims.runId, input.runId), eq(velixEditorialClaims.textHash, hash))).get();
    if (existing) return existing.id;
    const id = randomUUID();
    this.db.insert(velixEditorialClaims).values({ id, runId: input.runId, projectId: input.projectId, stageId: input.stageId, chapter: input.chapter, segmentHash: input.segmentHash, text: input.text, textHash: hash, kind: input.kind, confidence: input.confidence }).run();
    return id;
  }

  /** Idempotent by claim + URL; an existing decision is never reset by a new research pass. */
  addEvidence(claimId: string, input: EvidenceInput): string {
    const existing = this.db.select({ id: velixClaimEvidence.id }).from(velixClaimEvidence).where(and(eq(velixClaimEvidence.claimId, claimId), eq(velixClaimEvidence.url, input.url))).get();
    if (existing) return existing.id;
    const id = randomUUID();
    this.db.insert(velixClaimEvidence).values({ id, claimId, ...input, status: 'candidate' }).run();
    return id;
  }

  list(runId: string): ProductionClaim[] {
    const claims = this.db.select().from(velixEditorialClaims).where(eq(velixEditorialClaims.runId, runId)).orderBy(asc(velixEditorialClaims.chapter), asc(velixEditorialClaims.createdAt)).all();
    const evidence = claims.length ? this.db.select().from(velixClaimEvidence).where(inArray(velixClaimEvidence.claimId, claims.map((claim) => claim.id))).orderBy(asc(velixClaimEvidence.createdAt)).all() : [];
    return claims.map((claim) => ({
      id: claim.id, chapter: claim.chapter, text: claim.text, kind: claim.kind as ClaimKind, kindSource: claim.kindSource === 'user' ? 'user' : 'agent', confidence: claim.confidence,
      evidence: evidence.filter((item) => item.claimId === claim.id).map((item) => ({ id: item.id, url: item.url, title: item.title, publisher: item.publisher, publishedAt: item.publishedAt, excerpt: item.excerpt, confidence: item.confidence, classification: item.classification as ResearchClassification, status: item.status as 'candidate' | 'approved' | 'rejected', referenceId: item.referenceId })),
    }));
  }

  gate(runId: string) {
    return claimGate(this.list(runId));
  }

  claimRun(claimId: string): string | undefined {
    return this.db.select({ runId: velixEditorialClaims.runId }).from(velixEditorialClaims).where(eq(velixEditorialClaims.id, claimId)).get()?.runId;
  }

  evidenceRun(evidenceId: string): string | undefined {
    const row = this.db.select({ claimId: velixClaimEvidence.claimId }).from(velixClaimEvidence).where(eq(velixClaimEvidence.id, evidenceId)).get();
    return row ? this.claimRun(row.claimId) : undefined;
  }

  /** Only evidence that cites an approved reference can be approved: a discovery must be reviewed as a source first. */
  decideEvidence(evidenceId: string, decision: 'approved' | 'rejected', note?: string): void {
    const row = this.db.select().from(velixClaimEvidence).where(eq(velixClaimEvidence.id, evidenceId)).get();
    if (!row) throw new Error('not_found: evidência não encontrada.');
    if (decision === 'approved' && row.classification !== 'evidence') throw new Error('forbidden: só evidência de uma referência aprovada pode ser aprovada; revise a fonte na Descoberta primeiro.');
    this.db.update(velixClaimEvidence).set({ status: decision, note: note ?? null, decidedAt: new Date().toISOString() }).where(eq(velixClaimEvidence.id, evidenceId)).run();
  }

  /** A person relabels a claim (e.g. a "fact" that is really an estimate); research never overwrites it again. */
  setKind(claimId: string, kind: ClaimKind): void {
    if (!claimKinds.includes(kind)) throw new Error('invalid: tipo de afirmação inválido.');
    this.db.update(velixEditorialClaims).set({ kind, kindSource: 'user', updatedAt: new Date().toISOString() }).where(eq(velixEditorialClaims.id, claimId)).run();
  }

  /**
   * Copies claims of one run into another (a derivative), keeping kind, who set it, evidence and each human decision.
   * Returns the new id of every copied claim.
   */
  copyClaims(fromRunId: string, toRunId: string, projectId: string, claimIds: readonly string[]): Map<string, string> {
    const wanted = new Set(claimIds);
    const ids = new Map<string, string>();
    this.db.transaction((tx) => {
      for (const claim of tx.select().from(velixEditorialClaims).where(eq(velixEditorialClaims.runId, fromRunId)).all().filter((row) => wanted.has(row.id))) {
        const existing = tx.select({ id: velixEditorialClaims.id }).from(velixEditorialClaims).where(and(eq(velixEditorialClaims.runId, toRunId), eq(velixEditorialClaims.textHash, claim.textHash))).get();
        const id = existing?.id ?? randomUUID();
        if (!existing) tx.insert(velixEditorialClaims).values({ ...claim, id, runId: toRunId, projectId, stageId: null }).run();
        ids.set(claim.id, id);
        for (const evidence of tx.select().from(velixClaimEvidence).where(eq(velixClaimEvidence.claimId, claim.id)).all()) {
          tx.insert(velixClaimEvidence).values({ ...evidence, id: randomUUID(), claimId: id }).onConflictDoNothing().run();
        }
      }
    });
    return ids;
  }

  cached(projectId: string, segmentHash: string, sourcesHash: string): ResearchAnswer | null {
    const row = this.db.select({ answer: velixResearchCache.answer }).from(velixResearchCache).where(and(eq(velixResearchCache.projectId, projectId), eq(velixResearchCache.segmentHash, segmentHash), eq(velixResearchCache.sourcesHash, sourcesHash))).get();
    if (!row) return null;
    const parsed = researchAnswerSchema.safeParse(JSON.parse(row.answer));
    return parsed.success ? parsed.data : null;
  }

  cache(projectId: string, segmentHash: string, sourcesHash: string, answer: ResearchAnswer): void {
    this.db.insert(velixResearchCache).values({ projectId, segmentHash, sourcesHash, answer: JSON.stringify(answer) }).onConflictDoNothing().run();
  }
}
