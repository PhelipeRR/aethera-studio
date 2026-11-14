import { describe, expect, it } from 'vitest';
import type { IdentitySignal } from '@neuralbridge/shared';
import { SubjectIdentityVerifier } from '../src/aethera/subject-identity-verifier.js';

const signal = (source: IdentitySignal['source'], verdict: IdentitySignal['verdict'] = 'match', score = 0.99): IdentitySignal => ({ source, verdict, score, evidence: `synthetic:${source}:${verdict}` });
const verifier = new SubjectIdentityVerifier();
const input = { assetId: 'synthetic-asset', subjectId: 'synthetic-game', compilation: false };

describe('independent subject identity verification (synthetic evidence)', () => {
  it('requires two independent origins and preserves all six evidence channels', () => {
    expect(verifier.verify({ ...input, signals: [signal('metadata_text'), signal('metadata_text')] }).status).toBe('review_required');
    // OCR and a visual match of the same frames are one content origin.
    expect(verifier.verify({ ...input, signals: [signal('ocr'), signal('visual_reference')] }).status).toBe('review_required');
    const signals = ['provenance', 'metadata_text', 'ocr', 'audio_transcript', 'visual_reference', 'neighbour_consistency'].map((source) => signal(source as IdentitySignal['source']));
    expect(verifier.verify({ ...input, signals })).toMatchObject({ status: 'verified', signals, verifiedBy: 'rules' });
  });

  it('rejects a misleading reupload or same-franchise strong mismatch without fallback', () => {
    expect(verifier.verify({ ...input, signals: [signal('provenance'), signal('metadata_text'), signal('ocr', 'mismatch')] }).status).toBe('rejected');
    expect(verifier.verify({ ...input, signals: [signal('provenance'), signal('visual_reference', 'mismatch')] }).status).toBe('rejected');
    expect(verifier.verify({ ...input, signals: [signal('provenance'), signal('audio_transcript'), signal('ocr', 'mismatch', 0.6)] }).status).toBe('review_required');
  });

  it('never verifies compilations as a whole and does not inherit across a neighborhood deviation', () => {
    const parent = verifier.verify({ ...input, signals: [signal('provenance'), signal('audio_transcript')] });
    expect(verifier.verify({ ...input, compilation: true, signals: parent.signals }).status).toBe('review_required');
    expect(verifier.verify({ ...input, segmentId: 's1', parent, signals: [signal('neighbour_consistency')] }).status).toBe('verified');
    expect(verifier.verify({ ...input, segmentId: 's1', parent, signals: [] }).status).toBe('review_required');
    expect(verifier.verify({ ...input, segmentId: 's1', parent, signals: [signal('neighbour_consistency', 'mismatch')] }).status).toBe('rejected');
    expect(verifier.verify({ ...input, subjectId: 'other-game', segmentId: 's1', parent, signals: [signal('neighbour_consistency')] }).status).toBe('review_required');
  });
});
