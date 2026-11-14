import type { SearchFilter, SearchHit, SearchResult, SemanticUnavailable } from '@neuralbridge/shared';
import { parseSearchFilter, type BrainService, type SnippetMarkers } from './brain-service.js';
import type { EmbeddingProvider } from './embeddings/provider.js';
import { dot, fromBlob } from './embeddings/vectors.js';
import type { Actor, Scope } from './scope.js';
import type { RagEngine } from './rag-engine.js';

export interface HybridOptions {
  /** Around matched terms in keyword snippets (default [ and ]). */
  snippetMarkers?: SnippetMarkers;
  /**
   * Floor below which a semantic candidate is unrelated. multilingual-e5-small packs most texts into 0.80-0.90
   * (an off-topic query scored 0.847 in the relevance test), so this only removes clear noise; ranking does the rest.
   */
  minSimilarity?: number;
  /** Keyword candidates taken before fusion. */
  candidates?: number;
  /** Semantic candidates taken before fusion: few, because their tail is mostly noise. */
  semanticCandidates?: number;
  /** Reciprocal Rank Fusion constant. */
  k?: number;
}

const EXCERPT = 200;

/**
 * Keyword (FTS5) + meaning (embeddings) search fused with Reciprocal Rank Fusion:
 * score = Σ 1 / (k + rank) over the retrievers that found the memory. Without a usable model it
 * returns keyword results and reports why in `degraded`.
 */
export class HybridSearch {
  private readonly minSimilarity: number;
  private readonly candidates: number;
  private readonly semanticCandidates: number;
  private readonly k: number;
  private readonly markers: SnippetMarkers | undefined;

  constructor(
    private readonly brain: BrainService,
    private readonly provider: EmbeddingProvider | null,
    options: HybridOptions = {},
    private readonly rag?: RagEngine,
  ) {
    this.minSimilarity = options.minSimilarity ?? 0.75;
    this.candidates = options.candidates ?? 50;
    this.semanticCandidates = options.semanticCandidates ?? 10;
    this.k = options.k ?? 60;
    this.markers = options.snippetMarkers;
  }

  async search(query: string, filter: SearchFilter, scope: Scope, actor: Actor): Promise<SearchResult> {
    const parsed = parseSearchFilter(filter);
    const text = this.brain.textCandidates(query, parsed, scope, this.candidates, this.markers);
    const semantic = text.length || /[\p{L}\p{N}]/u.test(query) ? await this.semantic(query, parsed, scope) : { degraded: null, hits: [] };

    const fused = new Map<string, Omit<SearchHit, 'tags' | 'confidence'>>();
    const add = (entry: Omit<SearchHit, 'tags' | 'score' | 'matchedBy' | 'confidence'>, rank: number, by: 'text' | 'semantic') => {
      const current = fused.get(entry.id);
      const contribution = 1 / (this.k + rank + 1);
      if (current) {
        current.score += contribution;
        current.matchedBy.push(by);
      } else {
        fused.set(entry.id, { ...entry, score: contribution, matchedBy: [by] });
      }
    };
    text.forEach((row, rank) => add(row, rank, 'text'));
    semantic.hits.forEach((row, rank) => add(row, rank, 'semantic'));
    if (this.rag && scope.kind === 'project' && this.provider) {
      const ragHits = await this.rag.semanticSearch(this.provider, scope.projectId, query, this.semanticCandidates);
      ragHits.forEach((row, rank) =>
        add({ id: row.id, title: row.symbol ?? row.path, type: 'documentation', projectId: row.projectId, snippet: row.content.slice(0, EXCERPT) }, rank, 'semantic'),
      );
    }

    // Stale memories keep showing up, a quarter as strong, so a current one wins when both match.
    const confidence = this.brain.confidenceFor([...fused.keys()]);
    const weighted = (entry: { id: string; score: number }) => entry.score * (confidence.get(entry.id) === 'stale' ? 0.25 : 1);
    const top = [...fused.values()].sort((a, b) => weighted(b) - weighted(a)).slice(0, parsed.limit);
    this.brain.logSearchHits(
      top.map((hit) => hit.id),
      actor,
    );
    return {
      hits: this.brain.toSearchHits(top),
      mode: semantic.degraded ? 'fts' : 'hybrid',
      degraded: semantic.degraded,
    };
  }

  private async semantic(
    query: string,
    filter: ReturnType<typeof parseSearchFilter>,
    scope: Scope,
  ): Promise<{ degraded: SemanticUnavailable | null; hits: Omit<SearchHit, 'tags' | 'score' | 'matchedBy' | 'confidence'>[] }> {
    if (!this.provider) return { degraded: 'disabled', hits: [] };
    const availability = await this.provider.availability();
    if (!availability.ok) return { degraded: availability.reason, hits: [] };

    let queryVector: Float32Array;
    try {
      queryVector = await this.provider.embedQuery(query);
    } catch {
      return { degraded: 'model_error', hits: [] };
    }
    const hits = this.brain
      .vectorCandidates(filter, scope, this.provider.model)
      .map((row) => ({ row, similarity: dot(queryVector, fromBlob(row.vector)) }))
      .filter(({ similarity }) => similarity >= this.minSimilarity)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.semanticCandidates)
      .map(({ row }) => ({ id: row.id, title: row.title, type: row.type, projectId: row.projectId, snippet: row.content.slice(0, EXCERPT) }));
    return { degraded: null, hits };
  }
}
