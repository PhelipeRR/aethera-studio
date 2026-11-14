import type { EmbeddingProvider } from '../src/embeddings/provider.js';

/**
 * Deterministic stand-in for the real model: each "concept" is one axis, and any of its words in the
 * text lights it up. Lets tests express synonyms that keyword search cannot match.
 */
export const CONCEPTS: Record<string, string[]> = {
  database: ['database', 'banco', 'sql', 'postgres', 'schema', 'migration', 'migração', 'migrações', 'tabela'],
  auth: ['auth', 'login', 'senha', 'password', 'oauth', 'token', 'autenticação'],
  frontend: ['react', 'css', 'layout', 'componente', 'interface', 'ui'],
  performance: ['lento', 'slow', 'latência', 'latency', 'cache', 'performance', 'desempenho'],
};

export class FakeProvider implements EmbeddingProvider {
  readonly model = 'fake-concepts';
  readonly dim = Object.keys(CONCEPTS).length + 1;
  calls = 0;
  failOn: string | null = null;
  available: Awaited<ReturnType<EmbeddingProvider['availability']>> = { ok: true };

  async availability() {
    return this.available;
  }

  async embedPassages(texts: string[]): Promise<Float32Array[]> {
    this.calls++;
    return texts.map((text) => this.vector(text));
  }

  async embedQuery(text: string): Promise<Float32Array> {
    return this.vector(text);
  }

  private vector(text: string): Float32Array {
    if (this.failOn && text.includes(this.failOn)) throw new Error('model crashed');
    const words = text.toLowerCase().split(/[^\p{L}\p{N}]+/u);
    const axes = Object.values(CONCEPTS).map((synonyms) => (synonyms.some((word) => words.includes(word)) ? 1 : 0));
    const values = [...axes, 0.05]; // small constant axis keeps unrelated texts from being zero vectors
    const norm = Math.hypot(...values);
    return Float32Array.from(values, (value) => value / norm);
  }
}
