import { describe, expect, it } from 'vitest';
import {
  acquisitionIdempotencyKey,
  calibrateAutoThreshold,
  confidenceBand,
  gatesSatisfied,
  isStudioStageKind,
  mediaAcquisitionJobSchema,
  mediaProvenanceSchema,
  mediaSegmentSchema,
  productionStageKinds,
  subjectIdentityStatus,
  verifiedSubjectSchema,
  type IdentitySignal,
} from '../src/index.js';

const signal = (source: IdentitySignal['source'], verdict: IdentitySignal['verdict'], score = 0.9): IdentitySignal => ({ source, verdict, score, evidence: `${source}:${verdict}` });

describe('Aethera Studio contracts', () => {
  it('adds the Studio stages after the ten existing ones, keeping their order', () => {
    expect(productionStageKinds.slice(0, 10)).toEqual(['briefing', 'research', 'script', 'storyboard', 'narration', 'sync', 'composition', 'render', 'quality', 'export']);
    expect(productionStageKinds.slice(10, 15)).toEqual(['game_research', 'media_acquisition', 'visual_index', 'scene_matching', 'media_discovery']);
    expect(productionStageKinds.at(-1)).toBe('preview');
    expect(isStudioStageKind('visual_index')).toBe(true);
    expect(isStudioStageKind('render')).toBe(false);
  });

  it('flags an unconfirmed game instead of silently accepting it', () => {
    const subject = verifiedSubjectSchema.parse({ schemaVersion: 1, id: 'game-1', kind: 'game', title: 'Jogo', aliases: [], releaseDate: null, datePrecision: 'month', platforms: [], companies: [], externalIds: {}, verification: 'unconfirmed', evidenceIds: [], checkedAt: '2026-11-10T00:00:00.000Z' });
    expect(subject.verification).toBe('unconfirmed');
    expect(() => verifiedSubjectSchema.parse({ ...subject, verification: 'confirmed', evidenceIds: [] })).toThrow(/evid/i);
  });

  it('keeps editorial use separate from legal clearance, which defaults to unknown', () => {
    const provenance = mediaProvenanceSchema.parse({ schemaVersion: 1, assetId: 'asset-1', url: 'https://www.youtube.com/watch?v=abc', platform: 'youtube', publisher: 'Publisher', official: true, publishedAt: null, license: null, knownRestrictions: [], adapter: 'yt-dlp', adapterVersion: '2026.10.1', acquiredAt: '2026-11-10T00:00:00.000Z', usage: 'editorial_use' });
    expect(provenance.legalClearance).toBe('unknown');
    expect(() => mediaProvenanceSchema.parse({ ...provenance, url: 'file:///C:/x.mp4' })).toThrow();
  });

  it('derives the same acquisition key for the same source and format only', () => {
    const key = acquisitionIdempotencyKey('https://www.youtube.com/watch?v=abc', 'mp4-1080p');
    expect(key).toBe(acquisitionIdempotencyKey(' https://www.youtube.com/watch?v=abc ', 'mp4-1080p'));
    expect(key).not.toBe(acquisitionIdempotencyKey('https://www.youtube.com/watch?v=abc', 'mp4-720p'));
    expect(mediaAcquisitionJobSchema.parse({ schemaVersion: 1, id: 'job-1', runId: 'run-1', subjectId: 'game-1', referenceId: 'ref-1', adapter: 'yt-dlp', idempotencyKey: key, status: 'queued', attempt: 0, bytesDone: 0, bytesTotal: null }).status).toBe('queued');
  });

  it('rejects a segment that ends before it starts', () => {
    const base = { schemaVersion: 1, id: 'seg-1', assetId: 'asset-1', startMs: 0, endMs: 1_000, frameHashes: [], kind: 'unknown', description: '', tags: [], embeddingRefs: [], quality: { blur: 0, motion: 0, overlayText: false, watermark: false, black: false, frozen: false }, analyzedBy: { provider: 'ffmpeg-heuristics', model: 'ffmpeg', confidence: 0.5 } };
    expect(mediaSegmentSchema.parse(base).endMs).toBe(1_000);
    expect(() => mediaSegmentSchema.parse({ ...base, startMs: 2_000 })).toThrow();
  });

  it('verifies identity only with two independent matches and no mismatch', () => {
    expect(subjectIdentityStatus([signal('provenance', 'match')])).toBe('review_required');
    expect(subjectIdentityStatus([signal('provenance', 'match'), signal('visual_reference', 'match')])).toBe('verified');
    expect(subjectIdentityStatus([signal('provenance', 'match'), signal('provenance', 'match')])).toBe('review_required');
    expect(subjectIdentityStatus([signal('provenance', 'match'), signal('visual_reference', 'match'), signal('ocr', 'mismatch', 0.5)])).toBe('review_required');
    expect(subjectIdentityStatus([signal('provenance', 'match'), signal('visual_reference', 'match'), signal('ocr', 'mismatch', 0.95)])).toBe('rejected');
    expect(subjectIdentityStatus([signal('provenance', 'match'), signal('metadata_text', 'match')], { multiSubjectAsset: true })).toBe('review_required');
  });

  it('routes a decision by calibrated confidence bands', () => {
    const thresholds = { autoAt: 0.9, reviewAt: 0.5 };
    expect(confidenceBand(0.95, thresholds)).toBe('automatic');
    expect(confidenceBand(0.7, thresholds)).toBe('review');
    expect(confidenceBand(0.2, thresholds)).toBe('reject');
    expect(confidenceBand(0.95, null)).toBe('review');
  });

  it('picks the lowest threshold that keeps the target precision on the calibration set', () => {
    const samples = [
      { probability: 0.99, correct: true }, { probability: 0.95, correct: true }, { probability: 0.9, correct: true },
      { probability: 0.85, correct: false }, { probability: 0.8, correct: true }, { probability: 0.6, correct: false },
    ];
    expect(calibrateAutoThreshold(samples, 0.95)).toBe(0.9);
    expect(calibrateAutoThreshold(samples, 1.01)).toBeNull();
    expect(calibrateAutoThreshold([], 0.95)).toBeNull();
  });

  it('requires G1-G3 to export and G1-G4 on the same version to publish', () => {
    const approvals = [
      { gate: 'technical' as const, version: 'v2', decision: 'approved' as const },
      { gate: 'factual' as const, version: 'v2', decision: 'approved' as const },
      { gate: 'editorial' as const, version: 'v2', decision: 'approved' as const },
      { gate: 'publication' as const, version: 'v1', decision: 'approved' as const },
    ];
    expect(gatesSatisfied('export', approvals, 'v2')).toEqual({ satisfied: true, missing: [] });
    expect(gatesSatisfied('publish', approvals, 'v2')).toEqual({ satisfied: false, missing: ['publication'] });
    expect(gatesSatisfied('export', [...approvals, { gate: 'editorial', version: 'v2', decision: 'rejected' }], 'v2')).toEqual({ satisfied: false, missing: ['editorial'] });
  });
});
