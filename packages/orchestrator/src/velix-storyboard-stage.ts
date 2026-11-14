import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type VelixClaimRepository, type VelixProductionRepository, type VelixStoryboardRepository } from '@neuralbridge/database';
import {
  applySemanticEditPlan,
  type ClaimLink,
  type EditPlan,
  type MediaCandidate,
  type ProductionBrief,
  type RightsStatus,
  type ScriptPart,
  type SemanticEditResult,
  type Storyboard,
  type StoryboardEdit,
  type StoryboardView,
  type StoryboardCandidateView,
  applyStoryboardEdit,
  buildScenes,
  editPlanSchema,
  productionBriefSchema,
  productionScriptSchema,
  rankMedia,
  selectMedia,
  storyboardEditSchema,
  clipSplitPoint,
  retimeFromAudio,
  storyboardNarration,
  textKey,
  type StoryboardScene,
  type MatchReviewCandidate,
  validateStoryboard,
} from '@neuralbridge/shared';
import { type ProductionStageAdapter } from './velix-production.js';

export interface StoryboardDeps {
  storyboards: VelixStoryboardRepository;
  claims: VelixClaimRepository;
  /** Every video/image the project knows, with the current rights status of each (found is listed, not authorized). */
  mediaCandidates(projectId: string): MediaCandidate[];
  /** Cuts a scene clip when a scene is split, so both halves keep the measured narration. */
  audio?: {
    root(projectId: string): string | undefined;
    cut(input: { source: string; fromMs: number; toMs: number; output: string }): Promise<void>;
    probeDurationMs(path: string): Promise<number>;
  };
  /** Read-only agent seam: returns data that is parsed by editPlanSchema; it never receives an edit tool. */
  planSemanticEdit?: (input: { projectId: string; command: string; storyboard: Storyboard; signal: AbortSignal }) => Promise<unknown>;
  /** Maps a scene to the render cache segments that must be invalidated after a semantic edit. */
  segmentIdsForScene?: (scene: StoryboardScene) => readonly string[];
  /** AP-02: cuts the matching proposed for review, the only ones a person may accept. */
  reviewCandidates?: (runId: string) => readonly MatchReviewCandidate[];
  /** AP-02: the researched games of the run, the only ones a scene may be assigned to. */
  subjectIds?: (runId: string) => readonly string[];
}

const claimLinks = (claims: VelixClaimRepository, runId: string): { links: ClaimLink[]; supported: Set<string>; unsupported: Set<string> } => {
  const unsupported = new Set(claims.gate(runId).unsupported.map((claim) => claim.id));
  const links = claims.list(runId).map((claim) => ({ id: claim.id, text: claim.text, supported: claim.kind === 'fact' ? !unsupported.has(claim.id) : true }));
  return { links, supported: new Set(links.filter((link) => link.supported).map((link) => link.id)), unsupported };
};

/**
 * The `storyboard` stage: cuts the run's script into scenes, links the claims each scene speaks and gives every scene the
 * best authorized asset or a declared fallback. It is deterministic and calls no agent; generating again for the same
 * script after a restart keeps the version already saved (and every edit made on it).
 */
export function createStoryboardStageAdapter(deps: StoryboardDeps): ProductionStageAdapter {
  return {
    kind: 'storyboard',
    async run(context) {
      const artifact = context.readArtifact('script');
      if (!artifact) throw new Error('invalid: gere o roteiro antes do storyboard.');
      const existing = deps.storyboards.latest(context.runId);
      if (existing && context.state['scriptArtifactId'] === artifact.id) { context.progress(1); return undefined; }
      const script = productionScriptSchema.parse(JSON.parse(artifact.content));
      const parts: ScriptPart[] = script.chapters?.length ? script.chapters.filter((chapter) => chapter.words > 0).map((chapter) => ({ chapter: chapter.n, narration: chapter.narration })) : [{ chapter: null, narration: script.narration }];
      const { links, supported } = claimLinks(deps.claims, context.runId);
      const scenes = buildScenes(parts, links, context.brief.pace, () => randomUUID());
      const storyboard: Storyboard = { schemaVersion: 1, timing: 'estimated', scenes: selectMedia(scenes, deps.mediaCandidates(context.projectId), context.brief.format, supported) };
      if (context.signal.aborted) return undefined;
      const saved = deps.storyboards.save({ runId: context.runId, storyboard, source: 'generated', baseVersion: existing?.version ?? null });
      context.saveState({ scriptArtifactId: artifact.id, version: saved.version });
      context.writeArtifact({ kind: 'storyboard', relativePath: `producoes/${context.runId}/storyboard/v${String(saved.version).padStart(3, '0')}.json`, content: `${JSON.stringify(saved.storyboard, null, 2)}\n`, mime: 'application/json', metadata: { version: saved.version, scenes: storyboard.scenes.length } });
      context.progress(1);
      return undefined;
    },
  };
}

/** Reads, validates and edits the storyboard of a run; every change is a new version saved on top of the one shown. */
export class StoryboardService {
  constructor(private readonly production: VelixProductionRepository, private readonly deps: StoryboardDeps) {}

  private context(runId: string): { brief: ProductionBrief; projectId: string; candidates: MediaCandidate[] } {
    const run = this.production.getRun(runId);
    if (!run) throw new Error('not_found: produção não encontrada.');
    return { brief: productionBriefSchema.parse(JSON.parse(run.brief)), projectId: run.projectId, candidates: this.deps.mediaCandidates(run.projectId) };
  }

  view(runId: string): StoryboardView | null {
    const latest = this.deps.storyboards.latest(runId);
    if (!latest) return null;
    const { brief, candidates } = this.context(runId);
    const rights = new Map<string, RightsStatus>(candidates.map((candidate) => [candidate.referenceId, candidate.rightsStatus]));
    const basis = new Map(candidates.flatMap((candidate) => (candidate.basis ? [[candidate.referenceId, candidate.basis] as const] : [])));
    const issues = validateStoryboard(latest.storyboard, { format: brief.format, rights, unsupportedClaimIds: claimLinks(this.deps.claims, runId).unsupported, ...(basis.size ? { basis } : {}) });
    return { version: latest.version, source: latest.source, timing: latest.storyboard.timing, createdAt: latest.createdAt, scenes: latest.storyboard.scenes, issues, renderable: issues.length === 0, versions: this.deps.storyboards.history(runId).length };
  }

  /** AP-02: the cuts proposed for review in this run, for the person to accept scene by scene. */
  reviewCandidates(runId: string): MatchReviewCandidate[] {
    if (!this.production.getRun(runId)) throw new Error('not_found: produção não encontrada.');
    return [...(this.deps.reviewCandidates?.(runId) ?? [])];
  }

  candidates(runId: string, sceneId: string): StoryboardCandidateView[] {
    const latest = this.deps.storyboards.latest(runId);
    const scene = latest?.storyboard.scenes.find((item) => item.id === sceneId);
    if (!latest || !scene) throw new Error('not_found: cena não encontrada no storyboard.');
    const { brief, candidates } = this.context(runId);
    const used = latest.storyboard.scenes.flatMap((item) => (item.id !== sceneId && item.visual.type === 'asset' ? [item.visual.referenceId] : []));
    return rankMedia(scene, candidates, { format: brief.format, usedReferenceIds: used }).map((item) => ({ referenceId: item.candidate.referenceId, title: item.candidate.title, kind: item.candidate.kind, publisher: item.candidate.publisher, url: item.candidate.url, rightsStatus: item.candidate.rightsStatus, eligible: item.eligible, score: item.score, reason: item.reason }));
  }

  async edit(runId: string, baseVersion: number, edit: StoryboardEdit): Promise<StoryboardView> {
    const latest = this.deps.storyboards.latest(runId);
    if (!latest) throw new Error('not_found: gere o storyboard primeiro.');
    if (latest.version !== baseVersion) throw new Error(`conflict: o storyboard mudou (versão ${latest.version}); recarregue antes de editar.`);
    const { brief, candidates, projectId } = this.context(runId);
    const parsed = storyboardEditSchema.parse(edit);
    let next = applyStoryboardEdit(latest.storyboard, parsed, { pace: brief.pace, candidates, makeId: () => randomUUID(), reviewCandidates: this.deps.reviewCandidates?.(runId) ?? [], subjectIds: this.deps.subjectIds?.(runId) ?? [] });
    if (parsed.op === 'duplicate') next = await this.splitClip(projectId, latest.storyboard, next, parsed.sceneId);
    this.deps.storyboards.save({ runId, storyboard: next, source: 'edit', edit, baseVersion });
    return this.require(runId);
  }

  /** Plans through a read-only agent, validates the closed plan, saves one immutable storyboard version and reports the exact rerender scope. */
  async semanticEdit(runId: string, baseVersion: number, command: string, signal = new AbortController().signal): Promise<SemanticEditResult> {
    const latest = this.deps.storyboards.latest(runId);
    if (!latest) throw new Error('not_found: gere o storyboard primeiro.');
    if (latest.version !== baseVersion) throw new Error(`conflict: o storyboard mudou (versão ${latest.version}); recarregue antes de editar.`);
    if (!this.deps.planSemanticEdit) throw new Error('unavailable: o planejador semântico read-only não está configurado.');
    const { brief, candidates, projectId } = this.context(runId);
    const plan = (await this.deps.planSemanticEdit({ projectId, command, storyboard: latest.storyboard, signal })) as EditPlan;
    const parsed = editPlanSchema.parse(plan);
    if (parsed.status === 'needs_confirmation') return { status: 'needs_confirmation', plan: parsed, view: this.require(runId), affectedSceneIds: [], rerenderSegmentIds: [], ttsCalled: false, researchCalled: false };
    const applied = applySemanticEditPlan(latest.storyboard, parsed, { pace: brief.pace, candidates, makeId: () => randomUUID(), segmentIdsForScene: this.deps.segmentIdsForScene ?? ((scene) => [scene.id]) });
    this.deps.storyboards.save({ runId, storyboard: applied.storyboard, source: 'edit', edit: { op: 'semantic', plan: parsed }, baseVersion });
    return { status: 'applied', plan: parsed, view: this.require(runId), affectedSceneIds: applied.affectedSceneIds, rerenderSegmentIds: applied.rerenderSegmentIds, ttsCalled: false, researchCalled: false };
  }

  /**
   * After a split, cuts the original scene's clip between the last word of the first half and the first word of the
   * second, so the storyboard stays on the measured clock. Without the audio port (or words to cut between) the split
   * keeps estimated times and the next sync measures again.
   */
  private async splitClip(projectId: string, before: Storyboard, after: Storyboard, sceneId: string): Promise<Storyboard> {
    const original = before.scenes.find((scene) => scene.id === sceneId);
    const index = after.scenes.findIndex((scene) => scene.id === sceneId);
    const first = after.scenes[index];
    const second = after.scenes[index + 1];
    const root = this.deps.audio?.root(projectId);
    if (!original?.audio || !first || !second || !this.deps.audio || !root) return after;
    const firstWords = first.narration.split(/\s+/u).filter(Boolean).length;
    const cut = clipSplitPoint(original.audio, firstWords);
    if (cut === null) return after;
    const source = join(root, original.audio.relativePath);
    const folder = dirname(original.audio.relativePath);
    const parts = await Promise.all([
      { scene: first, fromMs: 0, toMs: cut, words: original.audio.words.slice(0, firstWords), shift: 0, tag: 'a' },
      { scene: second, fromMs: cut, toMs: original.audio.durationMs, words: original.audio.words.slice(firstWords), shift: cut, tag: 'b' },
    ].map(async (part) => {
      const key = textKey(`${original.audio?.key}|${cut}|${part.tag}`);
      const relativePath = `${folder}/${key}.wav`.replace(/\\/gu, '/');
      const output = join(root, relativePath);
      if (!existsSync(output)) await this.deps.audio?.cut({ source, fromMs: part.fromMs, toMs: part.toMs, output });
      const durationMs = (await this.deps.audio?.probeDurationMs(output)) ?? part.toMs - part.fromMs;
      return { ...part.scene, audio: { relativePath, durationMs, key, words: part.words.map((word) => ({ ...word, startMs: Math.max(0, word.startMs - part.shift), endMs: Math.max(0, word.endMs - part.shift) })) } };
    }));
    const scenes = after.scenes.map((scene, position) => (position === index ? parts[0] : position === index + 1 ? parts[1] : scene)).filter((scene): scene is StoryboardScene => !!scene);
    const measured = retimeFromAudio(scenes);
    return measured ? { schemaVersion: 1, scenes: measured, timing: 'measured', narrationKey: textKey(storyboardNarration(measured)) } : { ...after, scenes };
  }

  /** Restores an earlier version as a new one: history is never rewritten, and the restored state is the latest. */
  restore(runId: string, baseVersion: number, version: number): StoryboardView {
    const latest = this.deps.storyboards.latest(runId);
    const target = this.deps.storyboards.get(runId, version);
    if (!latest || !target) throw new Error('not_found: versão do storyboard não encontrada.');
    if (latest.version !== baseVersion) throw new Error(`conflict: o storyboard mudou (versão ${latest.version}); recarregue antes de restaurar.`);
    this.deps.storyboards.save({ runId, storyboard: target.storyboard, source: 'restore', edit: null, baseVersion });
    return this.require(runId);
  }

  history(runId: string) {
    return this.deps.storyboards.history(runId).map(({ version, source, createdAt, edit }) => ({ version, source, createdAt, op: edit?.op ?? null }));
  }

  /** Chooses media again for the unlocked scenes (e.g. after new rights were verified); locked scenes stay as they are. */
  reselect(runId: string, baseVersion: number): StoryboardView {
    const latest = this.deps.storyboards.latest(runId);
    if (!latest) throw new Error('not_found: gere o storyboard primeiro.');
    const { brief, candidates } = this.context(runId);
    const next: Storyboard = { ...latest.storyboard, scenes: selectMedia(latest.storyboard.scenes.map((scene) => (scene.locked ? scene : { ...scene, visual: { type: 'none' } })), candidates, brief.format, claimLinks(this.deps.claims, runId).supported) };
    this.deps.storyboards.save({ runId, storyboard: next, source: 'edit', edit: null, baseVersion });
    return this.require(runId);
  }

  private require(runId: string): StoryboardView {
    const view = this.view(runId);
    if (!view) throw new Error('not_found: storyboard não encontrado.');
    return view;
  }
}
