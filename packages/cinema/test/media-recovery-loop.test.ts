import { describe, expect, it } from 'vitest';
import {
  buildMediaRecoveryPlan,
  planMediaCoverage,
  type ScriptCoverageSegment,
} from '../src/analysis/media-coverage-planner.js';

describe('Media Recovery Loop contracts', () => {
  const segment: ScriptCoverageSegment = {
    segmentId: 'scene_08',
    subject: 'Black Clover Asta',
    narrationText: 'Asta libera a espada durante o confronto específico.',
    entities: ['Black Clover', 'Asta'],
    expectedEvent: 'liberação da espada durante o confronto',
    expectedDurationSec: 10,
    preferredQueries: ['Black Clover Asta espada confronto'],
  };

  it('exposes exact uncovered timeline intervals without extending proven source ranges', () => {
    const report = planMediaCoverage({
      segments: [segment],
      assets: [{ mediaId: 'auto_yt_dlp_8', uri: 'verified.mp4', durationSec: 44, compatible: true }],
      plannedUsages: [
        {
          clipId: 'clip_a',
          segmentId: segment.segmentId,
          mediaId: 'auto_yt_dlp_8',
          sourceStartSec: 0,
          sourceEndSec: 2.6,
          timelineDurationSec: 2.6,
        },
      ],
      relevanceDecisions: [
        {
          mediaId: 'auto_yt_dlp_8',
          accepted: true,
          assemblyEligible: true,
          editorialStatus: 'approved_for_scene',
          correspondenceLevel: 'exact_match',
          visualVerificationStatus: 'visually_verified',
          score: 0.85,
          reason: 'Somente o intervalo observado foi comprovado.',
          sampledTimestampsSec: [1.1, 1.8],
          matchedEntities: ['Black Clover', 'Asta'],
          matchedIntervals: [{ startSec: 0, endSec: 2.6, segmentId: segment.segmentId }],
          eligibleSegmentIds: [segment.segmentId],
          visualCategory: 'anime_animation',
        },
      ],
      requireRelevanceApproval: true,
    });

    expect(report.segments[0]?.provenTimelineIntervals).toEqual([{ startSec: 0, endSec: 2.6 }]);
    expect(report.segments[0]?.uncoveredIntervals).toEqual([{ startSec: 2.6, endSec: 10 }]);
    expect(report.segments[0]?.coverageGapSec).toBe(7.4);
  });

  it('builds bounded gap-specific recovery queries and explicit contextual alternatives', () => {
    const report = planMediaCoverage({
      segments: [segment],
      assets: [],
      requireRelevanceApproval: true,
    });

    const plan = buildMediaRecoveryPlan({
      prompt: 'Análise de Black Clover',
      genre: 'anime_essay',
      segments: [segment],
      coverageReport: report,
      maxAttemptsPerGap: 3,
    });

    expect(plan.gaps).toHaveLength(1);
    expect(plan.gaps[0]?.uncoveredIntervals).toEqual([{ startSec: 0, endSec: 10 }]);
    expect(plan.queries.length).toBeLessThanOrEqual(3);
    expect(plan.queries.every((query) => query.segmentId === segment.segmentId)).toBe(true);
    expect(plan.queries.some((query) => query.query.toLowerCase().includes('espada'))).toBe(true);
    expect(plan.gaps[0]?.editorialAlternatives.some((alternative) => alternative.kind === 'explanatory_graphic')).toBe(true);
  });
});
