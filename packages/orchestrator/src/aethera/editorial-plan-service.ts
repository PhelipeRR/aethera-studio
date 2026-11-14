import { applyEditorialPlan, directorSegmentsFromScenes, nextEditorialPlan, scriptKeyOf, type DirectorSegment, type EditorialExecution, type EditorialPlan, type FootageCandidate, type FootageSubject, type MediaProvenance, type MediaSegment, type PlanIssue, type SubjectIdentity, type TimelineDocument } from '@neuralbridge/shared';
import { directProduction, SMART_DIRECTOR_PROMPT_VERSION, type DirectorAsk, type DirectorMaterial } from './smart-director.js';

/*
 * Smart Director in the app flow. The AI director writes a plan for the measured script; the plan is stored as a draft
 * version; only a person approves it (bound to the hash they saw); and only an approved plan for the current script is
 * executed on the timeline, as a new timeline version. Nothing here renders, approves or publishes on its own.
 */

export interface EditorialPlanStore {
  save(runId: string, plan: EditorialPlan): EditorialPlan;
  history(runId: string): EditorialPlan[];
  latest(runId: string, scriptKey?: string): EditorialPlan | null;
  approve(input: { runId: string; version: number; hash: string; approvedBy: string }): EditorialPlan;
}

export interface EditorialScene { id: string; startMs: number; endMs: number; audio?: { words: readonly { w: string; startMs: number; endMs: number }[] } | undefined }

export interface EditorialPlanServiceDeps {
  store: EditorialPlanStore;
  ask: DirectorAsk;
  director: { provider: string; model: string };
}

export type EditorialApplyResult = { applied: true; plan: EditorialPlan; execution: EditorialExecution } | { applied: false; reason: string };

export function createEditorialPlanService(deps: EditorialPlanServiceDeps) {
  const segmentsOf = (scenes: readonly EditorialScene[]): DirectorSegment[] => {
    const segments = directorSegmentsFromScenes(scenes);
    if (!segments.length) throw new Error('invalid: o Smart Director precisa da narração medida (palavras com tempo) antes de planejar.');
    return segments;
  };
  return {
    segmentsOf,
    /** Director pass over the measured script: identical decisions keep the stored version; anything else is a new draft. */
    async direct(input: { runId: string; context: string; scenes: readonly EditorialScene[]; subjects: readonly FootageSubject[]; material: readonly DirectorMaterial[] }): Promise<{ plan: EditorialPlan; issues: PlanIssue[]; attempts: number }> {
      const segments = segmentsOf(input.scenes);
      const result = await directProduction({ productionId: input.runId, context: input.context, segments, subjects: input.subjects, material: input.material }, deps.ask);
      const plan = nextEditorialPlan(deps.store.history(input.runId), { productionId: input.runId, scriptKey: scriptKeyOf(segments), director: { ...deps.director, promptVersion: SMART_DIRECTOR_PROMPT_VERSION }, output: result.output });
      return { plan: deps.store.save(input.runId, plan), issues: result.issues, attempts: result.attempts };
    },
    latest: (runId: string) => deps.store.latest(runId),
    history: (runId: string) => deps.store.history(runId),
    approve: (input: { runId: string; version: number; hash: string; approvedBy: string }) => deps.store.approve(input),
    /**
     * Executes the latest approved plan of the current script on a timeline. A draft, or a plan made for another script
     * (the narration changed since), is not executed: the reason is returned for the interface to show.
     */
    apply(input: { runId: string; document: TimelineDocument; scenes: readonly EditorialScene[]; subjects: readonly FootageSubject[]; candidates: readonly FootageCandidate[]; proxyPaths: ReadonlyMap<string, string> }): EditorialApplyResult {
      const segments = segmentsOf(input.scenes);
      const plan = deps.store.latest(input.runId, scriptKeyOf(segments));
      if (!plan) return { applied: false, reason: 'Não há plano editorial para o roteiro e a narração atuais.' };
      if (plan.status !== 'approved') return { applied: false, reason: `O plano editorial v${plan.version} ainda é rascunho; uma pessoa precisa aprová-lo.` };
      return { applied: true, plan, execution: applyEditorialPlan(input.document, plan, { segments, subjects: input.subjects, candidates: input.candidates, proxyPaths: input.proxyPaths }) };
    },
  };
}
export type EditorialPlanService = ReturnType<typeof createEditorialPlanService>;

/**
 * Footage candidates from what the Studio already knows about acquired media: its measured segments, the subject
 * identities that were verified, and provenance. Segments with no stored visual analysis enter as unanalysed, which
 * the shot planner sends to human review instead of trusting.
 */
export function studioFootageCandidates(input: { assets: ReadonlyArray<{ assetId: string; provenance: MediaProvenance | null; segments: readonly MediaSegment[] }>; identities: readonly SubjectIdentity[] }): FootageCandidate[] {
  return input.assets.flatMap((asset) => {
    const durationMs = Math.max(0, ...asset.segments.map((segment) => segment.endMs));
    return asset.segments.flatMap((segment) => {
      if (segment.quality.black || segment.quality.frozen) return [];
      const identity = input.identities.find((item) => item.status === 'verified' && item.assetId === asset.assetId && (item.segmentId === segment.id || item.segmentId === null));
      if (!identity) return [];
      return [{
        assetId: asset.assetId, segmentId: segment.id, subjectId: identity.subjectId, startMs: segment.startMs, endMs: segment.endMs,
        source: asset.provenance?.official ? 'official' as const : 'unknown' as const, assetDurationMs: durationMs, analysis: null,
      }];
    });
  });
}
