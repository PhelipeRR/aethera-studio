import { describe, expect, it } from 'vitest';
import { gatePassedFromQualityChecks, qualityDirectorChecks, type QualityDirectorSignals } from '../src/aethera-quality.js';

const clean = (): QualityDirectorSignals => ({
  silenceIntervals: [], blackIntervals: [], frozenIntervals: [],
  loudness: { integratedLufs: -14, truePeakDb: -1, clippedSamples: 0 },
  captionSyncOffsetsMs: [], subjectMismatches: [], repeatedSegmentIds: [], watermarkSceneIds: [], identityUnverifiedSceneIds: [], unconfirmedSubjectIds: [], flatBackgroundSceneIds: [],
});

describe('Aethera Quality Director', () => {
  it('detects every injected defect and keeps a clean reference free of false positives', () => {
    const cleanChecks = qualityDirectorChecks(clean());
    expect(cleanChecks.every((check) => check.passed)).toBe(true);

    const defects = qualityDirectorChecks({
      ...clean(),
      silenceIntervals: [{ startMs: 2_000, durationMs: 3_500 }],
      blackIntervals: [{ startMs: 4_000, durationMs: 1_000 }],
      frozenIntervals: [{ startMs: 5_000, durationMs: 2_000 }],
      loudness: { integratedLufs: -28, truePeakDb: 1, clippedSamples: 7 },
      captionSyncOffsetsMs: [{ sceneId: 'scene-1', offsetMs: 400 }],
      subjectMismatches: [{ sceneId: 'scene-2', expectedSubjectId: 'game-2', observedSubjectId: 'game-1' }],
      repeatedSegmentIds: ['segment-1', 'segment-1'],
      watermarkSceneIds: ['scene-3'],
      identityUnverifiedSceneIds: ['scene-4'],
      unconfirmedSubjectIds: ['game-3'],
      flatBackgroundSceneIds: ['scene-5'],
    });

    expect(defects.filter((check) => !check.passed).map((check) => check.id)).toEqual([
      'director-silence', 'director-black', 'director-frozen', 'director-loudness', 'director-clipping', 'director-caption-sync',
      'director-subject-mismatch', 'director-repeated-segment', 'director-watermark', 'director-identity', 'director-unconfirmed-subject', 'director-flat-background',
    ]);
    expect(gatePassedFromQualityChecks('technical', defects)).toBe(false);
    expect(gatePassedFromQualityChecks('factual', defects)).toBe(false);
  });

  it('separates technical and factual gates from human editorial/publication gates', () => {
    const checks = qualityDirectorChecks(clean());
    expect(gatePassedFromQualityChecks('technical', checks)).toBe(true);
    expect(gatePassedFromQualityChecks('factual', checks)).toBe(true);
    expect(gatePassedFromQualityChecks('editorial', checks)).toBe(false);
    expect(gatePassedFromQualityChecks('publication', checks)).toBe(false);
  });
});
