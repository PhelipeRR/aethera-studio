import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AetheraStudioRepository, openDatabase, velixLocalAssets, VelixProductionRepository, VelixStoryboardRepository, videoProjects, type DatabaseHandle } from '@neuralbridge/database';
import { type MediaCandidate, type MediaSegmentCandidate, type ProductionBrief, type Storyboard } from '@neuralbridge/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSceneMatchingStageAdapter, reviewCandidatesOf } from '../src/aethera/scene-matching-stage.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
let handle: DatabaseHandle;
let runId: string;

const brief: ProductionBrief = {
  schemaVersion: 1, projectId: 'vp', format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } },
  productionType: 'ranking', topic: 'Jogos', targetDurationSeconds: 60, targetWords: 150, language: 'pt-BR', audience: 'gamers', tone: 'sóbrio', narrativeStyle: 'ranking', researchDepth: 'standard', sourceCount: 3, pace: 'standard', budgetUsd: 10,
};
const asset: MediaCandidate = { referenceId: 'ref-asset-1', kind: 'video', title: 'Game 1 combate contra chefe', publisher: 'Acervo oficial', url: 'https://example.test/game-1', publishedAt: null, rightsStatus: 'verified_allowed', width: 1920, height: 1080, durationSeconds: 10 };
const storyboard = (): Storyboard => ({ schemaVersion: 1, timing: 'measured', narrationKey: 'narration-before', scenes: [{ id: 'scene-1', chapter: null, narration: 'Combate contra chefe.', startMs: 0, endMs: 4_000, claimIds: [], visualObjective: 'Mostrar combate contra chefe', sceneType: 'broll', searchTerms: ['combate', 'chefe'], visual: { type: 'none' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'pending', audio: { relativePath: 'producoes/run/narracao/scene-1.wav', durationMs: 4_000, key: 'tts-before', words: [{ w: 'Combate', startMs: 0, endMs: 500 }, { w: 'contra', startMs: 500, endMs: 900 }, { w: 'chefe', startMs: 900, endMs: 1_400 }] } }] });

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-match-')), 'db.sqlite'), { migrationsFolder: MIGRATIONS });
  handle.db.insert(videoProjects).values({ id: 'vp', name: 'Vídeo', rootPath: join(tmpdir(), 'aethera-match-project') }).run();
  runId = new VelixProductionRepository(handle).createRun({ projectId: 'vp', brief, estimatedCostUsd: 0, agent: 'codex' }).id;
});
afterEach(() => handle.close());

describe('Aethera semantic scene matching stage', () => {
  it('reads persisted segments and identities, saves the match, and leaves narration/sync unchanged', async () => {
    const aethera = new AetheraStudioRepository(handle.db);
    aethera.saveSubject(runId, { schemaVersion: 1, id: 'game-1', kind: 'game', title: 'Game 1', aliases: [], releaseDate: null, datePrecision: 'year', platforms: ['PC'], companies: ['Studio'], externalIds: {}, verification: 'confirmed', evidenceIds: ['synthetic-evidence'], checkedAt: '2026-11-11T00:00:00.000Z' });
    handle.db.insert(velixLocalAssets).values({ id: 'asset-1', projectId: 'vp', path: 'media/game-1.mp4', bytes: 1, sha256: 'a'.repeat(64), rightsStatus: 'verified_allowed' }).run();
    aethera.replaceSegments('asset-1', [{ schemaVersion: 1, id: 'segment-combat', assetId: 'asset-1', startMs: 2_000, endMs: 8_000, frameHashes: ['frame-1'], kind: 'combat', description: 'combate contra chefe', tags: ['combate', 'chefe'], embeddingRefs: [], quality: { blur: 0, motion: 0.8, overlayText: false, watermark: false, black: false, frozen: false }, analyzedBy: { provider: 'synthetic', model: 'synthetic', confidence: 0.99 }, analysis: { version: 'synthetic-v1', band: 'automatic', calibratedConfidence: 0.99, limitations: [], attempts: [] } }]);
    aethera.recordIdentity({ schemaVersion: 1, id: 'identity-1', assetId: 'asset-1', segmentId: 'segment-combat', subjectId: 'game-1', signals: [], status: 'verified', calibratedConfidence: 0.99, verifiedBy: 'rules' });
    const segments: MediaSegmentCandidate[] = aethera.listSegments('asset-1').map((segment) => ({ asset, segment, identity: aethera.listIdentities('game-1').find((item) => item.segmentId === segment.id) ?? null }));
    const storyboards = new VelixStoryboardRepository(handle);
    const before = storyboards.save({ runId, storyboard: storyboard(), source: 'generated', baseVersion: null });
    const state: Record<string, unknown> = {};
    const adapter = createSceneMatchingStageAdapter({ storyboards, segmentCandidates: () => segments, subjectIdForScene: () => 'game-1', thresholds: () => ({ autoAt: 0.8, reviewAt: 0.6 }) });
    await adapter.run({ runId, stageId: 'matching-stage', projectId: 'vp', brief, input: {}, state, signal: new AbortController().signal, saveState: (next) => Object.assign(state, next), progress: () => undefined, runStructured: async () => { throw new Error('não deveria chamar agente'); }, writeArtifact: () => ({ id: 'artifact', relativePath: 'matching.json' }), recordFile: () => ({ id: 'file', relativePath: 'matching.json' }), resolvePath: (path) => path, readArtifact: () => null });
    const after = storyboards.latest(runId);
    expect(after).toMatchObject({ version: before.version + 1, source: 'matching' });
    expect(after?.storyboard.narrationKey).toBe(before.storyboard.narrationKey);
    expect(after?.storyboard.scenes[0]?.narration).toBe(before.storyboard.scenes[0]?.narration);
    expect(after?.storyboard.scenes[0]?.audio).toEqual(before.storyboard.scenes[0]?.audio);
    expect(after?.storyboard.scenes[0]?.visual).toMatchObject({ type: 'asset', referenceId: asset.referenceId, match: { segmentId: 'segment-combat', assetId: 'asset-1', sourceStartMs: 2_000, sourceEndMs: 8_000, subjectId: 'game-1', confidenceBand: 'automatic' } });
  });

  it('AP-02: infers each scene’s game from the narration and keeps uncalibrated cuts as keyed review candidates', async () => {
    const aethera = new AetheraStudioRepository(handle.db);
    aethera.saveSubject(runId, { schemaVersion: 1, id: 'game-1', kind: 'game', title: 'Game One', aliases: [], releaseDate: null, datePrecision: 'year', platforms: ['PC'], companies: ['Studio'], externalIds: {}, verification: 'confirmed', evidenceIds: ['synthetic-evidence'], checkedAt: '2026-11-11T00:00:00.000Z' });
    handle.db.insert(velixLocalAssets).values({ id: 'asset-1', projectId: 'vp', path: 'media/game-1.mp4', bytes: 1, sha256: 'a'.repeat(64), rightsStatus: 'conditional' }).run();
    aethera.replaceSegments('asset-1', [{ schemaVersion: 1, id: 'segment-combat', assetId: 'asset-1', startMs: 2_000, endMs: 8_000, frameHashes: ['frame-1'], kind: 'combat', description: 'combate contra chefe', tags: ['combate', 'chefe'], embeddingRefs: [], quality: { blur: 0, motion: 0.8, overlayText: false, watermark: false, black: false, frozen: false }, analyzedBy: { provider: 'synthetic', model: 'synthetic', confidence: 0.6 } }]);
    aethera.recordIdentity({ schemaVersion: 1, id: 'identity-1', assetId: 'asset-1', segmentId: 'segment-combat', subjectId: 'game-1', signals: [], status: 'verified', calibratedConfidence: 0.99, verifiedBy: 'rules' });
    const segments: MediaSegmentCandidate[] = aethera.listSegments('asset-1').map((segment) => ({ asset: { ...asset, rightsStatus: 'conditional', basis: 'editorial_use' }, segment, identity: aethera.listIdentities('game-1').find((item) => item.segmentId === segment.id) ?? null }));
    const storyboards = new VelixStoryboardRepository(handle);
    const named = storyboard();
    storyboards.save({ runId, storyboard: { ...named, scenes: named.scenes.map((scene) => ({ ...scene, narration: 'Em Game One, o combate contra chefe.' })) }, source: 'generated', baseVersion: null });
    const state: Record<string, unknown> = {};
    // No calibration and no fallback subject resolver: the game must come from the narration.
    const adapter = createSceneMatchingStageAdapter({ storyboards, segmentCandidates: () => segments, thresholds: () => null, subjects: () => [{ id: 'game-1', title: 'Game One', aliases: [] }] });
    await adapter.run({ runId, stageId: 'matching-stage', projectId: 'vp', brief, input: {}, state, signal: new AbortController().signal, saveState: (next) => Object.assign(state, next), progress: () => undefined, runStructured: async () => { throw new Error('não deveria chamar agente'); }, writeArtifact: () => ({ id: 'artifact', relativePath: 'matching.json' }), recordFile: () => ({ id: 'file', relativePath: 'matching.json' }), resolvePath: (path) => path, readArtifact: () => null });
    const scene = storyboards.latest(runId)?.storyboard.scenes[0];
    expect(scene?.subjectId).toBe('game-1');
    expect(scene?.visual.type).not.toBe('asset');
    const candidates = reviewCandidatesOf(state);
    expect(candidates).toEqual([expect.objectContaining({ candidateKey: 'scene-1|segment-combat|2000-8000', referenceId: asset.referenceId, match: expect.objectContaining({ assetId: 'asset-1', subjectId: 'game-1' }) })]);
    expect(state['subjectDecisions']).toEqual([{ sceneId: 'scene-1', subjectId: 'game-1', reason: expect.stringContaining('narração') }]);
  });
});
