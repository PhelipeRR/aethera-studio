import { describe, expect, it } from 'vitest';
import { editorialUsePolicySchema, mediaEditorialDecisionSchema, renderUseAllows, renderUseBasis, type RenderUseInput } from '../src/index.js';

// Synthetic provenance of a third-party trailer; not a real source.
const provenance: NonNullable<RenderUseInput['provenance']> = {
  url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', publisher: 'Fixture Publishing', adapter: 'yt-dlp', adapterVersion: '2026.10.26',
  acquiredAt: '2026-11-11T12:00:00.000Z', usage: 'editorial_use', legalClearance: 'unknown',
};
const base: RenderUseInput = { rightsStatus: null, provenance, policyEnabled: true, decision: null };

describe('render use basis (AP-02): acquired media is never licensed media', () => {
  it('keeps media with verified rights in the Rights Manager as licensed, whatever the provenance says', () => {
    expect(renderUseBasis({ ...base, rightsStatus: 'verified_allowed', policyEnabled: false, provenance: null }).basis).toBe('licensed');
    expect(renderUseBasis({ ...base, rightsStatus: 'verified_allowed' }).basis).toBe('licensed');
  });

  it('turns acquired editorial_use media into editorial_use only with the project policy on and complete provenance', () => {
    expect(renderUseBasis(base)).toMatchObject({ basis: 'editorial_use', legalClearance: 'unknown' });
    expect(renderUseBasis({ ...base, policyEnabled: false })).toMatchObject({ basis: 'not_allowed', reason: expect.stringContaining('política') });
    expect(renderUseBasis({ ...base, provenance: { ...provenance, publisher: ' ' } }).basis).toBe('not_allowed');
    expect(renderUseBasis({ ...base, provenance: { ...provenance, adapterVersion: '' } }).basis).toBe('not_allowed');
  });

  it('never makes acquired media licensed, for any usage, decision or policy', () => {
    for (const usage of ['editorial_use', 'review_required', 'blocked'] as const) {
      for (const decision of ['approved', 'rejected', null] as const) {
        for (const policyEnabled of [true, false]) {
          for (const rightsStatus of [null, 'conditional', 'unverified', 'pending_review'] as const) {
            expect(renderUseBasis({ rightsStatus, provenance: { ...provenance, usage }, policyEnabled, decision }).basis).not.toBe('licensed');
          }
        }
      }
    }
  });

  it('keeps review_required media in preview until a person approves it, and refuses it after a rejection', () => {
    const review = { ...base, provenance: { ...provenance, usage: 'review_required' as const } };
    expect(renderUseBasis(review).basis).toBe('preview_only');
    expect(renderUseBasis({ ...review, decision: 'approved' }).basis).toBe('editorial_use');
    expect(renderUseBasis({ ...review, decision: 'rejected' }).basis).toBe('not_allowed');
    expect(renderUseBasis({ ...base, decision: 'rejected' }).basis).toBe('not_allowed');
  });

  it('refuses blocked media and media without rights or provenance, as the legacy render did', () => {
    expect(renderUseBasis({ ...base, rightsStatus: 'blocked' }).basis).toBe('not_allowed');
    expect(renderUseBasis({ ...base, provenance: { ...provenance, usage: 'blocked' }, decision: 'approved' }).basis).toBe('not_allowed');
    expect(renderUseBasis({ rightsStatus: 'conditional', provenance: null, policyEnabled: true, decision: null }).basis).toBe('not_allowed');
    expect(renderUseBasis({ rightsStatus: null, provenance: null, policyEnabled: true, decision: null }).basis).toBe('not_allowed');
  });

  it('allows preview_only in drafts and never in the final render', () => {
    expect(renderUseAllows('licensed', 'final')).toBe(true);
    expect(renderUseAllows('editorial_use', 'final')).toBe(true);
    expect(renderUseAllows('preview_only', 'draft')).toBe(true);
    expect(renderUseAllows('preview_only', 'final')).toBe(false);
    expect(renderUseAllows('not_allowed', 'draft')).toBe(false);
  });

  it('validates the policy and the per-asset decision records', () => {
    expect(editorialUsePolicySchema.parse({ schemaVersion: 1, projectId: 'vp', thirdPartyEditorialUse: true, note: 'Ranking com comentário', decidedBy: 'user', decidedAt: '2026-11-11T12:00:00.000Z' })).toMatchObject({ thirdPartyEditorialUse: true });
    expect(() => editorialUsePolicySchema.parse({ schemaVersion: 1, projectId: 'vp', thirdPartyEditorialUse: true, note: '  ', decidedBy: 'user', decidedAt: '2026-11-11T12:00:00.000Z' })).toThrow();
    expect(() => mediaEditorialDecisionSchema.parse({ schemaVersion: 1, assetId: 'a', projectId: 'vp', decision: 'approved', note: '', decidedBy: 'user', decidedAt: '2026-11-11T12:00:00.000Z' })).toThrow();
  });
});
