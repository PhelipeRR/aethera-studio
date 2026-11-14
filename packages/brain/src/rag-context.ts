import type { RagHit } from './rag-engine.js';
import type { SearchHit } from '@neuralbridge/shared';

export interface RagContext { text: string; references: string[]; estimatedTokens: number; }

/** Builds a bounded, deduplicated reference context. Retrieved text remains data, never executable instructions. */
export function buildRagContext(hits: RagHit[], tokenBudget: number): RagContext {
  const seen = new Set<string>(); const references: string[] = []; const parts: string[] = []; let chars = 0;
  const maxChars = Math.max(0, tokenBudget) * 4;
  for (const hit of hits) {
    if (seen.has(hit.reference)) continue;
    const prefix = '[' + hit.reference + '] ';
    const remaining = maxChars - chars - prefix.length;
    if (remaining <= 0) break;
    const body = hit.content.slice(0, remaining);
    parts.push(prefix + body); references.push(hit.reference); seen.add(hit.reference); chars += prefix.length + body.length;
  }
  return { text: parts.join('\n\n'), references, estimatedTokens: Math.ceil(chars / 4) };
}

/** Adapts existing HybridSearch memory hits to the bounded context contract. */
export function buildMemoryContext(hits: SearchHit[], tokenBudget: number): RagContext {
  return buildRagContext(
    hits.map((hit, index) => ({
      id: hit.id, projectId: hit.projectId ?? '', path: `memory://${hit.id}`,
      // Agents are told when a memory is known to be out of date, so they check before relying on it.
      content: hit.confidence === 'stale' ? `(memória desatualizada: confirme antes de usar) ${hit.snippet}` : hit.snippet,
      symbol: hit.title, startLine: 1, endLine: 1, index, score: hit.score, reference: `memory://${hit.id}`,
    })),
    tokenBudget,
  );
}
