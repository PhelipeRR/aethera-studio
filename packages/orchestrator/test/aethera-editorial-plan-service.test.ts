import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assembleTimeline, VIDEO_FORMATS, type DirectorSegment, type EditorialPlan, type Storyboard } from '@neuralbridge/shared';
import { describe, expect, it } from 'vitest';
import { createEditorialPlanService, studioFootageCandidates, type EditorialPlanStore } from '../src/aethera/editorial-plan-service.js';

const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../shared/test/fixtures/smart-director/farol.json'), 'utf8')) as { plan: EditorialPlan; segments: DirectorSegment[] };
// One measured scene: its words relative to the scene clip, as the narration stage stores them.
const lastSegment = fixture.segments.at(-1);
if (!lastSegment) throw new Error('missing last segment in fixture');
const scene = { id: 'farol-cena', startMs: 0, endMs: lastSegment.endMs, audio: { words: fixture.segments.flatMap((segment) => segment.words) } };

function memoryStore(): EditorialPlanStore & { plans: EditorialPlan[] } {
  const plans: EditorialPlan[] = [];
  return {
    plans,
    save: (_runId, plan) => { const found = plans.find((item) => item.version === plan.version); if (found) return found; plans.push(plan); return plan; },
    history: () => [...plans],
    latest: (_runId, scriptKey) => [...plans].reverse().find((plan) => !scriptKey || plan.basedOn.scriptKey === scriptKey) ?? null,
    approve: ({ version, hash }) => { const index = plans.findIndex((plan) => plan.version === version && plan.hash === hash); const target = plans[index]; if (!target) throw new Error('plan not found'); const approved = { ...target, status: 'approved' as const }; plans[index] = approved; return approved; },
  };
}

describe('editorial plan service', () => {
  const service = (store: EditorialPlanStore) => createEditorialPlanService({ store, director: { provider: 'claude', model: 'sonnet' }, ask: async () => {
    // The fake director answers the fixture's decisions on the segment ids the app derives from the measured scene.
    const ids = service(store).segmentsOf([scene]).map((segment) => segment.id);
    let text = JSON.stringify({ reading: fixture.plan.reading, concept: fixture.plan.concept, segments: fixture.plan.segments });
    fixture.segments.forEach((segment, index) => { text = text.replaceAll(`"${segment.id}"`, `"${ids[index] ?? segment.id}"`); });
    return JSON.parse(text) as unknown;
  } });

  it('derives director segments from measured scenes on the production clock and refuses unmeasured narration', () => {
    const segments = service(memoryStore()).segmentsOf([scene]);
    expect(segments.map((segment) => segment.text)).toEqual(fixture.segments.map((segment) => segment.text));
    expect(segments.map((segment) => segment.words[0]?.startMs)).toEqual(fixture.segments.map((segment) => segment.words[0]?.startMs));
    expect(() => service(memoryStore()).segmentsOf([{ ...scene, audio: undefined }])).toThrow(/narração medida/u);
  });

  it('stores a draft, keeps the version on identical decisions, and executes only an approved plan of the current script', async () => {
    const store = memoryStore();
    const first = await service(store).direct({ runId: 'run', context: 'YouTube 16:9', scenes: [scene], subjects: [], material: [] });
    expect(first.plan).toMatchObject({ version: 1, status: 'draft' });
    expect((await service(store).direct({ runId: 'run', context: 'YouTube 16:9', scenes: [scene], subjects: [], material: [] })).plan.version).toBe(1);
    const storyboard: Storyboard = { schemaVersion: 1, timing: 'measured', narrationKey: 'n', scenes: [{ id: scene.id, chapter: 1, narration: fixture.segments.map((segment) => segment.text).join(' '), startMs: 0, endMs: scene.endMs, claimIds: [], visualObjective: 'Farol', sceneType: 'broll', searchTerms: ['farol'], visual: { type: 'fallback', kind: 'animation', reason: 'teste' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'approved' }] };
    const document = assembleTimeline({ runId: 'run', storyboard, format: VIDEO_FORMATS['youtube-long'] });
    const input = { runId: 'run', document, scenes: [scene], subjects: [], candidates: [], proxyPaths: new Map<string, string>() };
    expect(service(store).apply(input)).toEqual({ applied: false, reason: expect.stringContaining('rascunho') });
    service(store).approve({ runId: 'run', version: 1, hash: first.plan.hash, approvedBy: 'Editor' });
    const applied = service(store).apply(input);
    expect(applied.applied).toBe(true);
    const changedScript = { ...scene, audio: { words: scene.audio.words.map((word, index) => index === 0 ? { ...word, w: 'Alguém' } : word) } };
    expect(service(store).apply({ ...input, scenes: [changedScript] })).toEqual({ applied: false, reason: expect.stringContaining('roteiro') });
  });

  it('builds footage candidates only from verified identities, skipping black or frozen segments', () => {
    const segment = (id: string, black = false) => ({ schemaVersion: 1 as const, id, assetId: 'a', startMs: 0, endMs: 2_000, frameHashes: ['h'], kind: 'unknown' as const, description: '', tags: [], embeddingRefs: [], quality: { blur: 0, motion: 0.3, overlayText: false, watermark: false, black, frozen: false }, analyzedBy: { provider: 'ffmpeg-heuristics', model: 'ffmpeg', confidence: 0.4 } });
    const identity = (segmentId: string | null, status: 'verified' | 'review_required') => ({ schemaVersion: 1 as const, id: `i-${segmentId}`, assetId: 'a', segmentId, subjectId: 'g1', signals: [], status, calibratedConfidence: 0.9, verifiedBy: 'human' as const });
    const candidates = studioFootageCandidates({ assets: [{ assetId: 'a', provenance: null, segments: [segment('s1'), segment('s2', true), segment('s3')] }], identities: [identity('s1', 'verified'), identity('s3', 'review_required')] });
    expect(candidates.map((candidate) => [candidate.segmentId, candidate.source, candidate.analysis])).toEqual([['s1', 'unknown', null]]);
  });
});
