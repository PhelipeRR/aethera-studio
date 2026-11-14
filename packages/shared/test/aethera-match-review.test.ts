import { describe, expect, it } from 'vitest';
import { applyStoryboardEdit, matchCandidateKey, rankMedia, matchReviewCandidateSchema, type MatchReviewCandidate, type Storyboard, type StoryboardScene } from '../src/index.js';

// Synthetic storyboard and candidates; no real source.
const scene = (id: string, extra: Partial<StoryboardScene> = {}): StoryboardScene => ({ id, chapter: 1, narration: `Cena ${id}.`, startMs: 0, endMs: 4_000, claimIds: [], visualObjective: '', sceneType: 'broll', searchTerms: [], visual: { type: 'fallback', kind: 'typography', reason: '' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'pending', ...extra });
const board: Storyboard = { schemaVersion: 1, scenes: [scene('a', { subjectId: 'er' }), scene('b')], timing: 'measured', narrationKey: 'k' };
const match = { sceneId: 'a', sentenceIds: ['a:0'], segmentId: 'asset-1:12000-20000', assetId: 'asset-1', sourceStartMs: 12_000, sourceEndMs: 20_000, subjectId: 'er', confidenceBand: 'review' as const, score: 0.71, breakdown: { semantic: 0.8, subject: 1, kind: 1, quality: 0.6, diversity: 1, duration: 0.9 }, reason: 'combate contra chefe' };
const candidate: MatchReviewCandidate = matchReviewCandidateSchema.parse({ candidateKey: matchCandidateKey(match), referenceId: 'ref-1', title: 'ELDEN RING gameplay', match });
const context = { pace: 'standard' as const, candidates: [], makeId: () => 'new', reviewCandidates: [candidate], subjectIds: ['er', 'cp'] };

describe('accepting a matched cut under review (AP-02)', () => {
  it('puts exactly the reviewed cut on the scene, marked as a human decision, keeping the measured clock', () => {
    const next = applyStoryboardEdit(board, { op: 'accept_match', sceneId: 'a', candidateKey: candidate.candidateKey }, context);
    expect(next.timing).toBe('measured');
    expect(next.scenes[0]).toMatchObject({ reviewStatus: 'approved', visual: { type: 'asset', referenceId: 'ref-1', kind: 'video', match: { sourceStartMs: 12_000, sourceEndMs: 20_000, assetId: 'asset-1' }, reason: expect.stringContaining('aceito por você') } });
    expect(next.scenes[1]).toEqual(board.scenes[1]);
  });

  it('refuses a key that the matching did not propose, a key of another scene, a locked scene and another game’s cut', () => {
    expect(() => applyStoryboardEdit(board, { op: 'accept_match', sceneId: 'a', candidateKey: 'a|asset-1:0-99999|0-99999' }, context)).toThrow(/não foi proposto/);
    expect(() => applyStoryboardEdit(board, { op: 'accept_match', sceneId: 'b', candidateKey: candidate.candidateKey }, context)).toThrow(/não foi proposto/);
    const locked = { ...board, scenes: [{ ...board.scenes[0] as StoryboardScene, locked: true }, board.scenes[1] as StoryboardScene] };
    expect(() => applyStoryboardEdit(locked, { op: 'accept_match', sceneId: 'a', candidateKey: candidate.candidateKey }, context)).toThrow(/bloqueada/);
    const otherGame = { ...board, scenes: [{ ...board.scenes[0] as StoryboardScene, subjectId: 'cp' }, board.scenes[1] as StoryboardScene] };
    expect(() => applyStoryboardEdit(otherGame, { op: 'accept_match', sceneId: 'a', candidateKey: candidate.candidateKey }, context)).toThrow(/outro jogo/);
  });
});

describe('assigning the game of a scene (AP-02)', () => {
  it('sets or clears the game, and drops a cut of another game the scene was showing', () => {
    const accepted = applyStoryboardEdit(board, { op: 'accept_match', sceneId: 'a', candidateKey: candidate.candidateKey }, context);
    const moved = applyStoryboardEdit(accepted, { op: 'assign_subject', sceneId: 'a', subjectId: 'cp' }, context);
    expect(moved.scenes[0]).toMatchObject({ subjectId: 'cp', visual: { type: 'fallback', reason: expect.stringContaining('outro jogo') } });
    const cleared = applyStoryboardEdit(board, { op: 'assign_subject', sceneId: 'b', subjectId: 'er' }, context);
    expect(cleared.scenes[1]?.subjectId).toBe('er');
    expect(applyStoryboardEdit(cleared, { op: 'assign_subject', sceneId: 'b', subjectId: null }, context).scenes[1]).not.toHaveProperty('subjectId');
    expect(() => applyStoryboardEdit(board, { op: 'assign_subject', sceneId: 'b', subjectId: 'inventado' }, context)).toThrow(/não pertence/);
  });
});

describe('ranking acquired segments by basis of use (AP-02)', () => {
  const segment = { schemaVersion: 1 as const, id: 'seg', assetId: 'asset-1', startMs: 0, endMs: 6_000, frameHashes: [], kind: 'combat' as const, description: 'combate contra chefe', tags: ['combate'], embeddingRefs: [], quality: { blur: 0, motion: 0.8, overlayText: false, watermark: false, black: false, frozen: false }, analyzedBy: { provider: 's', model: 's', confidence: 0.95 } };
  const identity = { schemaVersion: 1 as const, id: 'i', assetId: 'asset-1', segmentId: 'seg', subjectId: 'er', signals: [], status: 'verified' as const, calibratedConfidence: 0.95, verifiedBy: 'rules' as const };
  const asset = (basis: 'licensed' | 'editorial_use' | 'preview_only' | 'not_allowed') => ({ referenceId: 'ref', kind: 'video', title: 'Combate', publisher: 'p', url: 'https://example.test/v', publishedAt: null, rightsStatus: 'conditional' as const, basis });
  const target = scene('a', { subjectId: 'er', narration: 'O combate contra chefe.' });
  const rank = (basis: Parameters<typeof asset>[0], thresholds: { autoAt: number; reviewAt: number } | null) => rankMedia(target, [{ asset: asset(basis), segment, identity }], { format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 0, right: 0, bottom: 0, left: 0 } }, usedReferenceIds: [], usedSegmentIds: [], subjectId: 'er', thresholds })[0];
  it('never proposes not_allowed media, keeps preview_only for review, and lets editorial use be selected', () => {
    expect(rank('not_allowed', null)).toMatchObject({ eligible: false, reviewRequired: false });
    expect(rank('preview_only', null)).toMatchObject({ eligible: false, reviewRequired: true });
    expect(rank('preview_only', { autoAt: 0.8, reviewAt: 0.5 })).toMatchObject({ eligible: false });
    expect(rank('editorial_use', { autoAt: 0.8, reviewAt: 0.5 })).toMatchObject({ eligible: true });
  });
});
