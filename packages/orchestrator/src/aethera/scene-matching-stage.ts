import type { ConfidenceThresholds, MatchReviewCandidate, MediaSegmentCandidate, StoryboardScene } from '@neuralbridge/shared';
import { matchCandidateKey, matchReviewCandidateSchema, rankMedia, selectMediaSegments, type RankedSegmentCandidate } from '@neuralbridge/shared';
import { inferSceneSubjects } from './scene-subjects.js';
import type { VisualTitleCandidate } from './visual-index.js';
import type { VelixStoryboardRepository } from '@neuralbridge/database';
import type { ProductionStageAdapter } from '../velix-production.js';

export interface SceneMatchingDeps {
  storyboards: VelixStoryboardRepository;
  /** Reads the persisted AS-05 segments joined to their current asset and identity verdict. */
  segmentCandidates(runId: string): readonly MediaSegmentCandidate[];
  /** Resolves the game spoken about by one scene; an absent subject is never auto-selected. */
  subjectIdForScene?: (runId: string, scene: StoryboardScene) => string | null;
  /** Calibrated thresholds from the active visual policy; null intentionally sends all matches to review. */
  thresholds: (runId: string) => ConfidenceThresholds;
  supportedClaimIds?: (runId: string) => ReadonlySet<string>;
  /** AP-02: the researched games, to infer which one each scene talks about before ranking. */
  subjects?: (runId: string) => readonly VisualTitleCandidate[];
}

/** The review candidates saved in a scene_matching checkpoint; entries saved before AP-02 (other shape) are skipped. */
export function reviewCandidatesOf(state: Record<string, unknown> | null | undefined): MatchReviewCandidate[] {
  const items = Array.isArray(state?.['reviewCandidates']) ? state['reviewCandidates'] as unknown[] : [];
  return items.flatMap((item) => { const parsed = matchReviewCandidateSchema.safeParse(item); return parsed.success ? [parsed.data] : []; });
}

/** AS-06 stage: match persisted visual segments onto an existing storyboard without regenerating narration or sync. */
export function createSceneMatchingStageAdapter(deps: SceneMatchingDeps): ProductionStageAdapter {
  return {
    kind: 'scene_matching',
    async run(context) {
      const stored = deps.storyboards.latest(context.runId);
      if (!stored) throw new Error('invalid: gere o storyboard antes do matching semântico.');
      if (context.state['storyboardVersion'] === stored.version) { context.progress(1); return undefined; }
      // Which game each scene talks about, from what is said (a person's earlier choice is kept).
      const inferred = inferSceneSubjects(stored.storyboard.scenes, deps.subjects?.(context.runId) ?? []);
      const latest = { ...stored, storyboard: { ...stored.storyboard, scenes: inferred.scenes } };
      const candidates = deps.segmentCandidates(context.runId);
      if (!candidates.length) throw new Error('invalid: execute a indexação visual antes do matching semântico.');
      const inputSubject = typeof context.input['subjectId'] === 'string' ? context.input['subjectId'] : null;
      const subjectFor = (scene: StoryboardScene) => scene.subjectId ?? deps.subjectIdForScene?.(context.runId, scene) ?? inputSubject;
      const reviewCandidates = latest.storyboard.scenes.flatMap((scene) => {
        const ranked = rankMedia(scene, candidates, { format: context.brief.format, usedReferenceIds: [], usedSegmentIds: [], subjectId: subjectFor(scene) ?? '', thresholds: deps.thresholds(context.runId) });
        return ranked.filter((item): item is RankedSegmentCandidate => item.reviewRequired).map((item): MatchReviewCandidate => ({ candidateKey: matchCandidateKey(item.match), referenceId: item.candidate.asset.referenceId, title: item.candidate.asset.title, match: item.match }));
      });
      const selectionContext = {
        format: context.brief.format,
        usedReferenceIds: [],
        usedSegmentIds: [],
        subjectId: inputSubject ?? '',
        thresholds: deps.thresholds(context.runId),
        ...(deps.supportedClaimIds ? { supportedClaimIds: deps.supportedClaimIds(context.runId) } : {}),
        subjectIdForScene: subjectFor,
      };
      const next = {
        ...latest.storyboard,
        scenes: selectMediaSegments(latest.storyboard.scenes, candidates, selectionContext),
      };
      if (context.signal.aborted) return undefined;
      const saved = deps.storyboards.save({ runId: context.runId, storyboard: next, source: 'matching', baseVersion: stored.version });
      context.saveState({ ...context.state, storyboardVersion: saved.version, matchedFromVersion: latest.version, matches: saved.storyboard.scenes.flatMap((scene) => scene.visual.type === 'asset' && scene.visual.match ? [scene.visual.match] : []), reviewCandidates, subjectDecisions: inferred.decisions });
      context.progress(1);
      return undefined;
    },
  };
}
