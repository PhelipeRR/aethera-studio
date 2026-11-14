import { describe, expect, it } from 'vitest';
import { buildMemoryContext, buildRagContext } from '../src/index.js';

describe('RAG context', () => {
  it('deduplicates references and respects the token budget', () => {
    const hit = { id: '1', projectId: 'p', path: 'src/a.ts', content: 'instruction-like data '.repeat(20), symbol: 'run', startLine: 4, endLine: 8, index: 0, score: 1, reference: 'src/a.ts:4-8' };
    const result = buildRagContext([hit, hit], 10);
    expect(result.references).toEqual(['src/a.ts:4-8']);
    expect(result.estimatedTokens).toBeLessThanOrEqual(10);
  });

  it('adapts existing memory search hits with verifiable refs and a hard budget', () => {
    const result = buildMemoryContext([
      { id: 'm1', title: 'Decisão', type: 'decision', projectId: 'p', snippet: 'A'.repeat(100), score: 1, matchedBy: ['text'], tags: [], confidence: 'unverified' },
      { id: 'm1', title: 'Decisão', type: 'decision', projectId: 'p', snippet: 'duplicado', score: 0.9, matchedBy: ['semantic'], tags: [], confidence: 'unverified' },
    ], 8);
    expect(result.references).toEqual(['memory://m1']);
    expect(result.text).toContain('[memory://m1]');
    expect(result.estimatedTokens).toBeLessThanOrEqual(8);
  });
});
