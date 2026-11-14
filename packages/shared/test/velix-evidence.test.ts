import { describe, expect, it } from 'vitest';
import { claimGate, claimGateCheck, classifyEvidence, normalizeUrl, researchAnswerSchema } from '../src/index.js';

const approved = new Set(['https://aneel.gov.br/dados']);

describe('evidence rules', () => {
  it('normalizes http(s) URLs and rejects every other scheme', () => {
    expect(normalizeUrl('https://ANEEL.gov.br/dados/#tabela')).toBe('https://aneel.gov.br/dados');
    expect(normalizeUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeUrl('file:///C:/segredo.txt')).toBeNull();
    expect(normalizeUrl('não é url')).toBeNull();
  });

  it('keeps "evidence" only for approved references: anything else found is a discovery, never authorization', () => {
    expect(classifyEvidence('https://aneel.gov.br/dados/', 'evidence', approved)).toBe('evidence');
    expect(classifyEvidence('https://blog.exemplo.com/post', 'evidence', approved)).toBe('discovery');
    expect(classifyEvidence('https://aneel.gov.br/dados', 'discovery', approved)).toBe('evidence');
    expect(classifyEvidence('https://video.exemplo.com/v', 'media_candidate', approved)).toBe('media_candidate');
    expect(classifyEvidence('ftp://x/y', 'evidence', approved)).toBe('unusable');
  });

  it('blocks a fact without approved evidence and lets labelled opinion, estimate and forecast through', () => {
    const gate = claimGate([
      { id: 'a', text: 'Fato sustentado', kind: 'fact', evidence: [{ status: 'approved', classification: 'evidence' }] },
      { id: 'b', text: 'Fato só com candidata', kind: 'fact', evidence: [{ status: 'candidate', classification: 'evidence' }] },
      { id: 'c', text: 'Fato com descoberta aprovada por engano', kind: 'fact', evidence: [{ status: 'approved', classification: 'discovery' }] },
      { id: 'd', text: 'Opinião', kind: 'opinion', evidence: [] },
      { id: 'e', text: 'Previsão', kind: 'forecast', evidence: [] },
    ]);
    expect(gate).toMatchObject({ total: 5, facts: 3, supported: 1, labelled: 2, passed: false });
    expect(gate.unsupported.map((claim) => claim.id)).toEqual(['b', 'c']);
    expect(claimGateCheck(gate)).toMatchObject({ id: 'claims-supported', severity: 'blocking', passed: false });
    expect(claimGate([{ id: 'd', text: 'Opinião', kind: 'opinion', evidence: [] }]).passed).toBe(true);
  });

  it('parses the research answer with defaults and refuses an unknown kind', () => {
    expect(researchAnswerSchema.parse({ claims: [{ text: 'x', kind: 'fact', confidence: 1, evidence: [{ url: 'https://a.b/c', classification: 'evidence' }] }] }).claims[0]?.evidence[0]).toMatchObject({ title: '', excerpt: '', publishedAt: null });
    expect(researchAnswerSchema.safeParse({ claims: [{ text: 'x', kind: 'rumor', confidence: 1 }] }).success).toBe(false);
  });
});
