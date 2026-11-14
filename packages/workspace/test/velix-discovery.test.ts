import { describe, expect, it } from 'vitest';
import { authorizeAsset, buildAttribution, deduplicateReferences, suggestClipIntervals, type VelixAssetRights, type VelixMediaReference } from '../src/velix-discovery.js';

describe('Velix discovery rights', () => {
  it('blocks unverified and blocked assets from production', () => {
    const base: VelixAssetRights = { owner: 'u', sourceUrl: 'https://example.com/a.mp4', license: 'unknown', evidence: null, verifiedAt: null, credit: null, restrictions: [], status: 'unverified' };
    expect(authorizeAsset(base)).toEqual({ allowed: false, reason: expect.stringContaining('unverified') });
    expect(authorizeAsset({ ...base, status: 'verified_allowed', evidence: 'email-1', verifiedAt: '2026-10-31T00:00:00.000Z' })).toEqual({ allowed: true, reason: null });
  });

  it('deduplicates references by canonical URL while retaining the newest evidence', () => {
    const refs: VelixMediaReference[] = [
      { url: 'https://example.com/a?utm_source=x', title: 'A', publisher: 'P', publishedAt: null, language: 'pt', query: 'q', retrievedAt: '2026-10-30T00:00:00.000Z', kind: 'article' },
      { url: 'https://example.com/a', title: 'A atualizado', publisher: 'P', publishedAt: null, language: 'pt', query: 'q', retrievedAt: '2026-10-31T00:00:00.000Z', kind: 'article' },
    ];
    expect(deduplicateReferences(refs)).toHaveLength(1);
    expect(deduplicateReferences(refs)[0]?.title).toBe('A atualizado');
  });

  it('suggests editable intervals from scene cuts and silence boundaries', () => {
    expect(suggestClipIntervals({ duration: 12, sceneCuts: [0, 4.2, 8.9, 12], silences: [{ start: 5, end: 6 }] })).toEqual([
      expect.objectContaining({ start: 0, end: 4.2, confidence: expect.any(Number) }),
      expect.objectContaining({ start: 6, end: 8.9 }),
      expect.objectContaining({ start: 8.9, end: 12 }),
    ]);
  });
});

describe('Velix attribution', () => {
  it('produces an auditable attribution record and does not claim fair use', () => {
    expect(buildAttribution({ owner: 'Autor', sourceUrl: 'https://example.com', license: 'CC BY 4.0', evidence: 'licence-page', verifiedAt: '2026-10-31', credit: 'Autor', restrictions: [], status: 'verified_allowed' })).toContain('não declara fair use');
  });
});
