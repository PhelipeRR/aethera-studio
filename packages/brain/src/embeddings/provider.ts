import type { SemanticUnavailable } from '@neuralbridge/shared';

export type Availability = { ok: true } | { ok: false; reason: SemanticUnavailable };

/** Turns text into normalised vectors (unit length), so the dot product is the cosine similarity. */
export interface EmbeddingProvider {
  /** Stored with each vector; a different model means the vector must be recomputed. */
  readonly model: string;
  readonly dim: number;
  availability(): Promise<Availability>;
  /** Texts to be found (memories). */
  embedPassages(texts: string[]): Promise<Float32Array[]>;
  /** Text used to search. */
  embedQuery(text: string): Promise<Float32Array>;
}
