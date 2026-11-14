import { and, asc, eq, isNull, or, sql } from 'drizzle-orm';
import { embeddings, memories, type DatabaseHandle } from '@neuralbridge/database';
import type { EmbeddingProvider } from './provider.js';
import { contentHash, embeddingText, toBlob } from './vectors.js';

export interface IndexResult {
  indexed: number;
  failed: number;
  /** Changed or deleted while being embedded; left pending for the next run. */
  skipped: number;
}

type Candidate = { id: string; title: string; content: string };

/**
 * Computes vectors for memories whose embedding is pending (new or edited) or was made by another model.
 * Safe to run from several processes: each write re-checks that the text is still the one embedded.
 */
export class EmbeddingIndexer {
  constructor(
    private readonly handle: DatabaseHandle,
    private readonly provider: EmbeddingProvider,
    private readonly options: { batchSize?: number } = {},
  ) {}

  async processPending(limit = 64): Promise<IndexResult> {
    const result: IndexResult = { indexed: 0, failed: 0, skipped: 0 };
    const otherModel = sql`NOT EXISTS (SELECT 1 FROM ${embeddings} WHERE ${embeddings.memoryId} = ${memories.id} AND ${embeddings.model} = ${this.provider.model})`;
    const candidates: Candidate[] = this.handle.db
      .select({ id: memories.id, title: memories.title, content: memories.content })
      .from(memories)
      .where(and(isNull(memories.deletedAt), or(eq(memories.embeddingStatus, 'pending'), and(eq(memories.embeddingStatus, 'ready'), otherModel))))
      .orderBy(asc(memories.seq))
      .limit(limit)
      .all();

    const size = this.options.batchSize ?? 16;
    for (let start = 0; start < candidates.length; start += size) {
      const batch = candidates.slice(start, start + size);
      let vectors: (Float32Array | Error)[];
      try {
        vectors = await this.provider.embedPassages(batch.map((memory) => embeddingText(memory.title, memory.content)));
      } catch {
        // One bad text should not sink the batch: retry one by one.
        vectors = [];
        for (const memory of batch) {
          try {
            vectors.push(...(await this.provider.embedPassages([embeddingText(memory.title, memory.content)])));
          } catch (error) {
            vectors.push(error instanceof Error ? error : new Error(String(error)));
          }
        }
      }
      batch.forEach((memory, i) => {
        const outcome = this.write(memory, vectors[i] ?? new Error('no vector returned'));
        result[outcome]++;
      });
    }
    return result;
  }

  private write(memory: Candidate, vector: Float32Array | Error): keyof IndexResult {
    const hash = contentHash(memory.title, memory.content);
    return this.handle.sqlite
      .transaction((): keyof IndexResult => {
        const current = this.handle.db
          .select({ title: memories.title, content: memories.content, deletedAt: memories.deletedAt })
          .from(memories)
          .where(eq(memories.id, memory.id))
          .get();
        if (!current || current.deletedAt !== null || contentHash(current.title, current.content) !== hash) return 'skipped';

        if (vector instanceof Error || vector.length !== this.provider.dim) {
          this.handle.db.update(memories).set({ embeddingStatus: 'failed' }).where(eq(memories.id, memory.id)).run();
          return 'failed';
        }
        const row = { model: this.provider.model, dim: vector.length, vector: toBlob(vector), contentHash: hash };
        this.handle.db
          .insert(embeddings)
          .values({ memoryId: memory.id, ...row })
          .onConflictDoUpdate({ target: embeddings.memoryId, set: { ...row, createdAt: sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))` } })
          .run();
        this.handle.db.update(memories).set({ embeddingStatus: 'ready' }).where(eq(memories.id, memory.id)).run();
        return 'indexed';
      })
      .immediate();
  }
}
