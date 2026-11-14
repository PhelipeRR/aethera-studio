import { describe, expect, it } from 'vitest';
import {
  type ConfidenceThresholds,
  type MediaCandidate,
  type MediaSegment,
  type MediaSegmentCandidate,
  type Storyboard,
  type SubjectIdentity,
  VIDEO_FORMATS,
  applyStoryboardEdit,
  buildScenes,
  countWords,
  fallbackFor,
  onScreenTextLimit,
  rankMedia,
  selectMedia,
  validateStoryboard,
} from '../src/index.js';

const format = (() => { const { id, width, height, fps, aspectRatio, safeArea } = VIDEO_FORMATS['youtube-long']; return { id, width, height, fps, aspectRatio, safeArea }; })();
let ids = 0;
const makeId = () => `s${++ids}`;
const narration = 'Os painéis solares cobrem telhados no Brasil inteiro hoje. A instalação de painéis solares cresceu nas cidades pequenas. Em 2025 foram 30 gigawatts instalados no país, segundo a agência. "É uma virada", disse um engenheiro. O futuro depende das baterias e da rede elétrica.';
const media = (referenceId: string, title: string, rightsStatus: MediaCandidate['rightsStatus'] = 'verified_allowed', extra: Partial<MediaCandidate> = {}): MediaCandidate => ({ referenceId, kind: 'video', title, publisher: 'Acervo', url: `https://acervo.exemplo/${referenceId}`, publishedAt: '2025-06-01', rightsStatus, width: 1920, height: 1080, durationSeconds: 20, ...extra });
const segmentCandidate = (id: string, kind: MediaSegment['kind'], description: string, subjectId: string, status: SubjectIdentity['status'] = 'verified', confidence = 0.99): MediaSegmentCandidate => ({
  asset: media(`asset-${id}`, `${description} gameplay`),
  segment: { schemaVersion: 1, id: `segment-${id}`, assetId: `asset-${id}`, startMs: 1_000, endMs: 7_000, frameHashes: [`frame-${id}`], kind, description, tags: description.split(' '), embeddingRefs: [], quality: { blur: 0, motion: 0.8, overlayText: false, watermark: false, black: false, frozen: false }, analyzedBy: { provider: 'synthetic', model: 'synthetic', confidence }, analysis: { version: 'synthetic-v1', band: status === 'verified' ? 'automatic' : 'review', calibratedConfidence: confidence, limitations: [], attempts: [] } },
  identity: { schemaVersion: 1, id: `identity-${id}`, assetId: `asset-${id}`, segmentId: `segment-${id}`, subjectId, signals: [], status, calibratedConfidence: confidence, verifiedBy: 'rules' },
});
const segmentContext = (subjectId: string, thresholds: ConfidenceThresholds = { autoAt: 0.95, reviewAt: 0.8 }) => ({ format, usedReferenceIds: [], usedSegmentIds: [], subjectId, thresholds });

describe('storyboard building and media selection', () => {
  it('cuts the narration into timed scenes at sentence ends and links the claims they speak', () => {
    const scenes = buildScenes([{ chapter: 1, narration }], [{ id: 'c1', text: 'Em 2025 foram 30 gigawatts instalados no país', supported: true }], 'standard', makeId);
    expect(scenes.length).toBeGreaterThanOrEqual(2);
    expect(scenes.map((scene) => scene.narration).join(' ')).toBe(narration);
    expect(scenes[0]?.startMs).toBe(0);
    scenes.slice(1).forEach((scene, index) => expect(scene.startMs).toBe(scenes[index]?.endMs));
    expect(scenes.find((scene) => scene.narration.includes('2025'))?.claimIds).toEqual(['c1']);
    expect(scenes.find((scene) => scene.narration.includes('2025'))?.sceneType).toMatch(/chart|quote/);
    expect(scenes[0]?.searchTerms).toEqual(expect.arrayContaining(['painéis'.normalize('NFD').replace(/\p{M}/gu, ''), 'solares']));
  });

  it('ranks only verified media as eligible, explains why, and prefers media not used yet', () => {
    const [scene] = buildScenes([{ chapter: null, narration: 'Os painéis solares cobrem telhados no Brasil inteiro hoje.' }], [], 'standard', makeId);
    if (!scene) throw new Error('sem cena');
    const ranked = rankMedia(scene, [media('a', 'Painéis solares em telhados'), media('b', 'Painéis solares em telhados', 'pending_review'), media('c', 'Receita de bolo'), media('d', 'Painéis solares no Brasil', 'verified_allowed', { kind: 'audio' })], { format, usedReferenceIds: [] });
    expect(ranked.map((item) => [item.candidate.referenceId, item.eligible])).toEqual([['a', true], ['b', false], ['c', false]]);
    expect(ranked[1]?.reason).toMatch(/pending_review/);
    const reused = rankMedia(scene, [media('a', 'Painéis solares em telhados'), media('e', 'Painéis solares em telhados')], { format, usedReferenceIds: ['a'] });
    expect(reused[0]?.candidate.referenceId).toBe('e');
  });

  it('never fills a scene with unrelated or unauthorized media: it declares a fallback instead', () => {
    const scenes = buildScenes([{ chapter: null, narration }], [{ id: 'c1', text: 'Em 2025 foram 30 gigawatts instalados no país', supported: false }], 'standard', makeId);
    const selected = selectMedia(scenes, [media('a', 'Painéis solares em telhados'), media('x', 'Painéis solares', 'blocked')], format, new Set());
    expect(selected.every((scene) => scene.visual.type !== 'none')).toBe(true);
    expect(selected.filter((scene) => scene.visual.type === 'asset').map((scene) => scene.visual.type === 'asset' && scene.visual.referenceId)).toEqual(['a']);
    const numbers = buildScenes([{ chapter: null, narration: 'Em 2025 foram 30 gigawatts instalados no país, segundo a agência.' }], [{ id: 'c2', text: 'Em 2025 foram 30 gigawatts instalados no país', supported: true }], 'standard', makeId);
    expect(selectMedia(numbers, [media('x', 'Receita de bolo')], format, new Set())[0]?.visual).toMatchObject({ type: 'fallback', kind: 'typography' });
    expect(selectMedia(numbers, [media('x', 'Receita de bolo')], format, new Set(['c2']))[0]?.visual).toMatchObject({ type: 'fallback', kind: 'chart' });
    expect(fallbackFor('chart', false)).toBe('typography');
    expect(fallbackFor('chart', true)).toBe('chart');
  });

  it('ranks persisted segments by the requested scene kind and keeps an explainable source range', () => {
    const [scene] = buildScenes([{ chapter: null, narration: 'O combate contra o chefe termina depois de uma esquiva.' }], [], 'standard', makeId);
    if (!scene) throw new Error('sem cena');
    const ranked = rankMedia(scene, [segmentCandidate('explore', 'exploration', 'exploração de mundo aberto', 'game-1'), segmentCandidate('boss', 'combat', 'combate contra chefe', 'game-1')], segmentContext('game-1'));
    expect(ranked[0]?.candidate.segment.id).toBe('segment-boss');
    expect(ranked[0]?.breakdown.kind).toBeGreaterThan(ranked[1]?.breakdown.kind ?? 0);
    expect(ranked[0]).toMatchObject({ eligible: true, confidenceBand: 'automatic', sourceStartMs: 1_000, sourceEndMs: 7_000 });
    expect(ranked[0]?.reason).toMatch(/combate|tipo/i);
  });

  it('prefers exploration for an open-world exploration phrase', () => {
    const [scene] = buildScenes([{ chapter: null, narration: 'A exploração de mundo aberto mostra uma cidade antiga.' }], [], 'standard', makeId);
    if (!scene) throw new Error('sem cena');
    const ranked = rankMedia(scene, [segmentCandidate('combat-open', 'combat', 'combate em uma arena', 'game-1'), segmentCandidate('explore-open', 'exploration', 'exploração de mundo aberto', 'game-1')], segmentContext('game-1'));
    expect(ranked[0]?.candidate.segment.id).toBe('segment-explore-open');
    expect(ranked[0]?.breakdown.kind).toBeGreaterThan(ranked[1]?.breakdown.kind ?? 0);
  });

  it('never auto-selects another game and marks review-required identity as a review candidate', () => {
    const [scene] = buildScenes([{ chapter: null, narration: 'A exploração de mundo aberto revela uma cidade antiga.' }], [], 'standard', makeId);
    if (!scene) throw new Error('sem cena');
    const wrongGame = rankMedia(scene, [segmentCandidate('wrong', 'exploration', 'exploração de mundo aberto', 'game-2')], segmentContext('game-1'))[0];
    expect(wrongGame).toMatchObject({ eligible: false, reviewRequired: false });
    expect(wrongGame?.reason).toMatch(/jogo|identidade/i);
    const review = rankMedia(scene, [segmentCandidate('review', 'exploration', 'exploração de mundo aberto', 'game-1', 'review_required', 0.85)], segmentContext('game-1'))[0];
    expect(review).toMatchObject({ eligible: false, reviewRequired: true, confidenceBand: 'review' });
    expect(review?.reason).toMatch(/revisão/i);
  });

  it('keeps all segment scores inside the calibrated band contract when no calibration exists', () => {
    const [scene] = buildScenes([{ chapter: null, narration: 'Exploração de mundo aberto.' }], [], 'standard', makeId);
    if (!scene) throw new Error('sem cena');
    const ranked = rankMedia(scene, [segmentCandidate('uncalibrated', 'exploration', 'exploração de mundo aberto', 'game-1')], segmentContext('game-1', null));
    expect(ranked[0]).toMatchObject({ eligible: false, reviewRequired: true, confidenceBand: 'review' });
  });
});

describe('storyboard validation and edits', () => {
  const base = (): Storyboard => ({ schemaVersion: 1, timing: 'estimated', scenes: selectMedia(buildScenes([{ chapter: null, narration }], [], 'standard', makeId), [media('a', 'Painéis solares em telhados'), media('b', 'Baterias e rede elétrica')], format, new Set()) });
  const candidates = [media('a', 'Painéis solares em telhados'), media('b', 'Baterias e rede elétrica'), media('p', 'Painel pendente', 'pending_review')];
  const context = { pace: 'standard' as const, candidates, makeId };

  it('reports what keeps a scene out of the render', () => {
    const storyboard = base();
    const first = storyboard.scenes[0];
    if (!first) throw new Error('sem cena');
    storyboard.scenes[0] = { ...first, visual: { type: 'none' }, onScreenText: 'x'.repeat(onScreenTextLimit(format) + 1), claimIds: ['c9'] };
    const rights = new Map(candidates.map((item) => [item.referenceId, item.rightsStatus]));
    expect(validateStoryboard(storyboard, { format, rights, unsupportedClaimIds: new Set(['c9']) }).map((issue) => issue.code).sort()).toEqual(['no_visual', 'text_outside_safe_area', 'unsupported_claim']);
    expect(validateStoryboard(base(), { format, rights, unsupportedClaimIds: new Set() })).toEqual([]);
    const revoked = new Map(rights); revoked.set('a', 'blocked');
    expect(validateStoryboard(base(), { format, rights: revoked, unsupportedClaimIds: new Set() }).map((issue) => issue.code)).toContain('unauthorized_asset');
  });

  it('removes a scene, keeps the others contiguous and refuses to remove a locked scene or the last one', () => {
    const storyboard = base();
    const [first, second] = storyboard.scenes;
    if (!first || !second) throw new Error('cenas insuficientes');
    const removed = applyStoryboardEdit(storyboard, { op: 'remove', sceneId: second.id }, context);
    expect(removed.scenes.map((scene) => scene.id)).toEqual(storyboard.scenes.filter((scene) => scene.id !== second.id).map((scene) => scene.id));
    expect(removed.scenes[0]?.startMs).toBe(0);
    expect(removed.scenes.every((scene, index) => index === 0 || scene.startMs === removed.scenes[index - 1]?.endMs)).toBe(true);
    const locked = applyStoryboardEdit(storyboard, { op: 'lock', sceneId: first.id, locked: true }, context);
    expect(() => applyStoryboardEdit(locked, { op: 'remove', sceneId: first.id }, context)).toThrow(/bloqueada/);
    expect(() => applyStoryboardEdit({ ...storyboard, scenes: [first] }, { op: 'remove', sceneId: first.id }, context)).toThrow(/única cena/);
  });

  it('moves, replaces, locks and duplicates, keeping times contiguous and the narration said once', () => {
    let storyboard = base();
    const [first, second] = storyboard.scenes;
    if (!first || !second) throw new Error('cenas insuficientes');
    storyboard = applyStoryboardEdit(storyboard, { op: 'move', sceneId: first.id, toIndex: 1 }, context);
    expect(storyboard.scenes.slice(0, 2).map((scene) => scene.id)).toEqual([second.id, first.id]);
    expect(storyboard.scenes[0]?.startMs).toBe(0);
    storyboard = applyStoryboardEdit(storyboard, { op: 'replace', sceneId: first.id, visual: { type: 'fallback', kind: 'document' } }, context);
    expect(storyboard.scenes[1]?.visual).toMatchObject({ type: 'fallback', kind: 'document' });
    expect(() => applyStoryboardEdit(storyboard, { op: 'replace', sceneId: first.id, visual: { type: 'asset', referenceId: 'p' } }, context)).toThrow(/direitos verificados/);
    storyboard = applyStoryboardEdit(storyboard, { op: 'lock', sceneId: first.id, locked: true }, context);
    expect(() => applyStoryboardEdit(storyboard, { op: 'update', sceneId: first.id, patch: { onScreenText: 'novo' } }, context)).toThrow(/bloqueada/);
    expect(selectMedia(storyboard.scenes, candidates, format, new Set())[1]?.visual).toMatchObject({ type: 'fallback', kind: 'document' });
    const multi = storyboard.scenes.find((scene) => !scene.locked && scene.narration.split(/[.!?]\s/).length > 1);
    if (!multi) throw new Error('sem cena com duas frases');
    const before = storyboard.scenes.map((scene) => scene.narration).join(' ');
    storyboard = applyStoryboardEdit(storyboard, { op: 'duplicate', sceneId: multi.id }, context);
    expect(storyboard.scenes.map((scene) => scene.narration).join(' ')).toBe(before);
    expect(countWords(storyboard.scenes.map((scene) => scene.narration).join(' '))).toBe(countWords(before));
    storyboard.scenes.slice(1).forEach((scene, index) => expect(scene.startMs).toBe(storyboard.scenes[index]?.endMs));
  });
});
