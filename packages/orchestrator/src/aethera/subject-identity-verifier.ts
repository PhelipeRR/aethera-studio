import { randomUUID } from 'node:crypto';
import { identitySignalSchema, subjectIdentitySchema, STRONG_IDENTITY_MISMATCH, type IdentitySignal, type SubjectIdentity } from '@neuralbridge/shared';

// Correlated observations do not buy independent votes: OCR and image matching share the visual origin;
// neighborhood consistency can support inheritance, but cannot identify a game on its own.
const origin: Record<IdentitySignal['source'], string | null> = {
  provenance: 'source', metadata_text: 'publisher_text', ocr: 'visual_content', audio_transcript: 'audio_content', visual_reference: 'visual_content', neighbour_consistency: null,
};

/** Verification consumes evidence supplied by analyzers. It neither discovers nor chooses media, nor invents evidence. */
export class SubjectIdentityVerifier {
  verify(input: { assetId: string; segmentId?: string; subjectId: string; compilation: boolean; signals: readonly IdentitySignal[]; parent?: SubjectIdentity; calibratedConfidence?: number }): SubjectIdentity {
    const signals = input.signals.map((signal) => identitySignalSchema.parse(signal));
    const mismatch = signals.some((signal) => signal.verdict === 'mismatch');
    const strongMismatch = signals.some((signal) => signal.verdict === 'mismatch' && signal.score >= STRONG_IDENTITY_MISMATCH);
    const origins = new Set(signals.filter((signal) => signal.verdict === 'match' && signal.score >= 0.9).map((signal) => origin[signal.source]).filter((value) => value !== null));
    const parent = input.parent;
    const inherits = !!input.segmentId && !input.compilation && parent?.assetId === input.assetId && parent.subjectId === input.subjectId && parent.segmentId === null && parent.status === 'verified'
      && signals.some((signal) => signal.source === 'neighbour_consistency' && signal.verdict === 'match' && signal.score >= 0.9);
    const verified = !mismatch && (origins.size >= 2 || inherits) && (!input.compilation || !!input.segmentId);
    return subjectIdentitySchema.parse({
      schemaVersion: 1, id: randomUUID(), assetId: input.assetId, segmentId: input.segmentId ?? null, subjectId: input.subjectId,
      signals: inherits && !mismatch ? [...parent.signals, ...signals] : signals,
      status: strongMismatch ? 'rejected' : verified ? 'verified' : 'review_required',
      // Rule verification is evidence based; a numerical probability is only reported after actual calibration.
      calibratedConfidence: input.calibratedConfidence ?? 0, verifiedBy: 'rules',
    });
  }
}
