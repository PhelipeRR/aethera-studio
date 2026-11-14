import { describe, expect, it } from 'vitest';
import { buildCommentaryProduction, buildNewsProduction } from '../src/velix-production-modes.js';

describe('Velix production modes', () => {
  it('builds a commentary brief only from approved clips and keeps their order', () => {
    const result = buildCommentaryProduction({ topic: 'Melhores momentos', style: 'analítico', clips: [{ source: 'source.mp4', start: 2, end: 4, rights: 'verified_allowed' }, { source: 'source.mp4', start: 7, end: 8, rights: 'verified_allowed' }] });
    expect(result.mode).toBe('commentary');
    expect(result.clips.map((clip) => clip.start)).toEqual([2, 7]);
    expect(result.brief).toContain('introdução');
  });
  it('blocks unauthorized commentary clips', () => expect(() => buildCommentaryProduction({ topic: 'x', style: 'neutro', clips: [{ source: 'x.mp4', start: 0, end: 1, rights: 'unverified' }] })).toThrow(/direitos/i));
  it('marks news claims and carries traceable references', () => {
    const result = buildNewsProduction({ topic: 'Atualizações', items: [{ title: 'Fato', url: 'https://example.com/a', publisher: 'Fonte A', publishedAt: '2026-10-31T00:00:00Z', claimType: 'confirmed' }, { title: 'Alegação', url: 'https://example.com/b', publisher: 'Fonte B', publishedAt: null, claimType: 'allegation' }] });
    expect(result.mode).toBe('news');
    expect(result.references).toHaveLength(2);
    expect(result.brief).toContain('alegação');
  });
  it('rejects unverifiable news URLs', () => expect(() => buildNewsProduction({ topic: 'x', items: [{ title: 'x', url: 'not-a-url', publisher: 'x', publishedAt: null, claimType: 'unverified' }] })).toThrow(/URL/i));
});
