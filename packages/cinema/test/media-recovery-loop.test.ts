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

  it('keeps per-scene semantic decisions for one shared physical media id', () => {
    const sceneA = { ...segment, segmentId: 'scene_a', subject: 'Black Clover Asta A', expectedDurationSec: 4 };
    const sceneB = { ...segment, segmentId: 'scene_b', subject: 'Black Clover Asta B', expectedDurationSec: 4 };
    const sharedDecision = (segmentId: string) => ({
      mediaId: 'shared-media',
      accepted: true,
      assemblyEligible: true,
      editorialStatus: 'approved_for_scene' as const,
      correspondenceLevel: 'exact_match' as const,
      visualVerificationStatus: 'visually_verified' as const,
      score: 0.95,
      reason: `Prova visual de ${segmentId}.`,
      sampledTimestampsSec: [1, 3],
      matchedEntities: ['Black Clover', 'Asta'],
      matchedIntervals: segmentId === 'scene_a' ? [{ startSec: 0, endSec: 4, segmentId }] : [{ startSec: 8, endSec: 9, segmentId }],
      eligibleSegmentIds: [segmentId],
      visualCategory: 'anime_animation' as const,
    });
    const report = planMediaCoverage({
      segments: [sceneA, sceneB],
      assets: [{ mediaId: 'shared-media', uri: 'shared.mp4', durationSec: 10, compatible: true }],
      relevanceDecisions: [sharedDecision('scene_a'), sharedDecision('scene_b')],
      requireRelevanceApproval: true,
    });
    expect(report.segments.find((scene) => scene.segmentId === 'scene_a')?.candidateMediaIds).toContain('shared-media');
    expect(report.segments.find((scene) => scene.segmentId === 'scene_b')?.candidateMediaIds).toContain('shared-media');
    expect(report.segments.find((scene) => scene.segmentId === 'scene_b')?.coverageGapSec).toBe(3);
  });
});
