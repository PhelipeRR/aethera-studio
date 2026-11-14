import { randomUUID } from 'node:crypto';
import { and, asc, eq } from 'drizzle-orm';
import { type ShortCandidate } from '@neuralbridge/shared';
import { type DatabaseHandle } from './open.js';
import { velixDerivatives } from './schema.js';

export type VelixDerivativeRow = typeof velixDerivatives.$inferSelect;

/** Derivatives (Shorts, Reels, TikTok) of a production: candidates, decisions and the child production each became. */
export class VelixDerivativeRepository {
  constructor(private readonly handle: DatabaseHandle) {}

  private get db() {
    return this.handle.db;
  }

  /**
   * Saves the candidates of one storyboard version. A window already known (same scenes) keeps its row and its decision;
   * undecided candidates of older versions are dropped, approved or created ones are never touched.
   */
  saveCandidates(parentRunId: string, storyboardVersion: number, formatId: string, candidates: readonly ShortCandidate[]): void {
    this.db.transaction((tx) => {
      const rows = tx.select().from(velixDerivatives).where(eq(velixDerivatives.parentRunId, parentRunId)).all();
      for (const row of rows) if (row.status === 'candidate' && row.storyboardVersion !== storyboardVersion) tx.delete(velixDerivatives).where(eq(velixDerivatives.id, row.id)).run();
      for (const candidate of candidates) {
        const sceneIds = JSON.stringify(candidate.sceneIds);
        if (rows.some((row) => row.sceneIds === sceneIds && row.formatId === formatId && (row.storyboardVersion === storyboardVersion || row.status !== 'candidate'))) continue;
        tx.insert(velixDerivatives).values({ id: randomUUID(), parentRunId, storyboardVersion, formatId, sceneIds, startMs: candidate.startMs, endMs: candidate.endMs, title: candidate.title, score: candidate.score, reason: candidate.reason, claimIds: JSON.stringify(candidate.claimIds) }).run();
      }
    });
  }

  list(parentRunId: string): VelixDerivativeRow[] {
    return this.db.select().from(velixDerivatives).where(eq(velixDerivatives.parentRunId, parentRunId)).orderBy(asc(velixDerivatives.startMs), asc(velixDerivatives.createdAt)).all();
  }

  get(id: string): VelixDerivativeRow | undefined {
    return this.db.select().from(velixDerivatives).where(eq(velixDerivatives.id, id)).get();
  }

  byChild(childRunId: string): VelixDerivativeRow | undefined {
    return this.db.select().from(velixDerivatives).where(eq(velixDerivatives.childRunId, childRunId)).get();
  }

  decide(id: string, decision: 'approved' | 'rejected'): void {
    const row = this.get(id);
    if (!row) throw new Error('not_found: derivado não encontrado.');
    if (row.status === 'created') throw new Error('invalid: este derivado já virou uma produção.');
    this.db.update(velixDerivatives).set({ status: decision, updatedAt: new Date().toISOString() }).where(eq(velixDerivatives.id, id)).run();
  }

  /** Links the child production; only an approved derivative becomes one, and only once. */
  setChild(id: string, childRunId: string): void {
    const updated = this.db.update(velixDerivatives).set({ childRunId, status: 'created', updatedAt: new Date().toISOString() }).where(and(eq(velixDerivatives.id, id), eq(velixDerivatives.status, 'approved'))).run();
    if (updated.changes !== 1) throw new Error('invalid: só um derivado aprovado vira produção.');
  }
}
