import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { acquisitionIdempotencyKey, assembleTimeline, applyTimelineOps, type BrollIndex, type MediaSegment, type Storyboard, type VerifiedSubject, type VisionBenchmark } from '@neuralbridge/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AetheraAudioLibraryRepository, AetheraDirectorRepository, AetheraMediaProxyRepository, AetheraReviewRepository, AetheraStudioRepository, AetheraTimelineRepository, openDatabase, velixLocalAssets, VelixProductionRepository, videoProjects, type DatabaseHandle } from '../src/index.js';
import { applyDirectorRules, defaultAetheraPresets } from '@neuralbridge/shared';

const MIGRATIONS = resolve(import.meta.dirname, '../migrations');
let handle: DatabaseHandle;
let runId: string;

const subject = (id: string, overrides: Partial<VerifiedSubject> = {}): VerifiedSubject => ({ schemaVersion: 1, id, kind: 'game', title: `Jogo ${id}`, aliases: [], releaseDate: '2027-01-15', datePrecision: 'day', platforms: ['PC'], companies: ['Estúdio'], externalIds: { igdb: id }, verification: 'confirmed', evidenceIds: ['ev-1'], checkedAt: '2026-11-10T00:00:00.000Z', ...overrides });
const segment = (id: string, startMs: number): MediaSegment => ({ schemaVersion: 1, id, assetId: 'asset-1', startMs, endMs: startMs + 2_000, frameHashes: [`frame-${id}`], kind: 'unknown', description: '', tags: [], embeddingRefs: [], quality: { blur: 0, motion: 0.4, overlayText: false, watermark: false, black: false, frozen: false }, analyzedBy: { provider: 'ffmpeg-heuristics', model: 'ffmpeg', confidence: 0.4 } });
const timelineStoryboard = (): Storyboard => ({ schemaVersion: 1, timing: 'measured', narrationKey: 'narration-v1', scenes: [{ id: 'scene-1', chapter: 1, narration: 'Cena.', startMs: 0, endMs: 1_000, claimIds: [], visualObjective: 'Mostrar', subjectId: 'g1', sceneType: 'broll', searchTerms: ['cena'], visual: { type: 'fallback', kind: 'animation', reason: 'fallback' }, onScreenText: '', transition: 'cut', camera: 'static', locked: false, reviewStatus: 'approved' }] });

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-studio-')), 'db.sqlite'), { migrationsFolder: MIGRATIONS });
  handle.db.insert(videoProjects).values({ id: 'vp', name: 'Vídeo', rootPath: join(tmpdir(), 'aethera-vp') }).run();
  handle.db.insert(velixLocalAssets).values({ id: 'asset-1', projectId: 'vp', path: 'media/trailer.mp4', bytes: 10, sha256: 'b'.repeat(64), rightsStatus: 'pending_review' }).run();
  runId = new VelixProductionRepository(handle).createRun({ projectId: 'vp', brief: { schemaVersion: 1, projectId: 'vp', format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } }, productionType: 'ranking', topic: 'Top jogos', targetDurationSeconds: 1_200, language: 'pt-BR', audience: 'gamers', tone: 'empolgado', narrativeStyle: 'ranking', researchDepth: 'standard', sourceCount: 3, pace: 'standard', budgetUsd: 0 }, estimatedCostUsd: 0, agent: 'codex' }).id;
});
afterEach(() => handle.close());

describe('AetheraStudioRepository', () => {
  it('persists a versioned B-roll index and resumes it after database reopen', () => {
    const index: BrollIndex = { schemaVersion: 1, indexVersion: 'p2.1', assetId: 'asset-1', sourceHash: 'b'.repeat(64), sourcePath: 'media/trailer.mp4', durationMs: 5_000, cutsSeconds: [0, 5], contactSheetPath: 'artifacts/broll/asset-1.jpg', segments: [segment('s1', 0)], status: 'complete', diagnostics: ['cache_miss'] };
    const repository = new AetheraStudioRepository(handle.db);
    expect(repository.saveBrollIndex(index)).toEqual(index);
    const file = handle.file;
    handle.close();
    handle = openDatabase(file, { migrationsFolder: MIGRATIONS });
    expect(new AetheraStudioRepository(handle.db).brollIndex('asset-1')).toEqual(index);
  });

  it('preserves identity evidence for unchanged segments on reindex and drops stale evidence on changed content', () => {
    const repository = new AetheraStudioRepository(handle.db);
    repository.saveSubject(runId, subject('g1'));
    repository.replaceSegments('asset-1', [segment('s1', 0)]);
    repository.recordIdentity({ schemaVersion: 1, id: 'identity', assetId: 'asset-1', segmentId: 's1', subjectId: 'g1', signals: [], status: 'review_required', calibratedConfidence: 0, verifiedBy: 'rules' });
    repository.replaceSegments('asset-1', [segment('s1', 0)]);
    expect(repository.listIdentities('g1')).toHaveLength(1);
    repository.replaceSegments('asset-1', [{ ...segment('s1', 0), frameHashes: ['changed'] }]);
    expect(repository.listIdentities('g1')).toHaveLength(0);
  });

  it('persists category-specific benchmark evidence across database reopen', () => {
    const record: VisionBenchmark = { schemaVersion: 1, id: 'synthetic-B1-B', benchmark: 'B-1', category: 'B', datasetVersion: 'synthetic-v1', synthetic: true, provider: 'local-siglip', model: 'uninstalled', promptVersion: 'v1', status: 'unavailable', limitations: ['Model not installed; no real B-1 results.'], sampleIds: [], metrics: {}, perLabel: {}, reliability: [], calibration: null, createdAt: '2026-11-10T00:00:00.000Z' };
    new AetheraStudioRepository(handle.db).saveBenchmark(record);
    const file = handle.file;
    handle.close();
    handle = openDatabase(file, { migrationsFolder: MIGRATIONS });
    expect(new AetheraStudioRepository(handle.db).listBenchmarks('synthetic-v1')).toEqual([record]);
  });
  it('persists visual spend at run scope across stages and database reopen', () => {
    const repository = new AetheraStudioRepository(handle.db);
    expect(repository.visionSpend(runId)).toBe(0);
    expect(repository.addVisionSpend(runId, 0.6)).toBeCloseTo(0.6);
    expect(repository.addVisionSpend(runId, 0.4)).toBeCloseTo(1);
    const file = handle.file;
    handle.close();
    handle = openDatabase(file, { migrationsFolder: MIGRATIONS });
    expect(new AetheraStudioRepository(handle.db).visionSpend(runId)).toBeCloseTo(1);
  });
  it('keeps one verified subject per id and reads it back unchanged', () => {
    const repository = new AetheraStudioRepository(handle.db);
    repository.saveSubject(runId, subject('g1'));
    repository.saveSubject(runId, subject('g1', { verification: 'conflicting', evidenceIds: ['ev-1', 'ev-2'] }));
    repository.saveSubject(runId, subject('g2', { verification: 'unconfirmed', evidenceIds: [], releaseDate: null }));
    expect(repository.listSubjects(runId).map((item) => [item.id, item.verification])).toEqual([['g1', 'conflicting'], ['g2', 'unconfirmed']]);
    expect(repository.listSubjects(runId)[0]?.evidenceIds).toEqual(['ev-1', 'ev-2']);
  });

  it('enqueues an acquisition once per run and source, then tracks resumable progress', () => {
    const repository = new AetheraStudioRepository(handle.db);
    const key = acquisitionIdempotencyKey('https://www.youtube.com/watch?v=abc', 'mp4-1080p');
    const first = repository.enqueueAcquisition({ runId, subjectId: null, referenceId: 'ref-1', adapter: 'yt-dlp', idempotencyKey: key });
    const again = repository.enqueueAcquisition({ runId, subjectId: null, referenceId: 'ref-1', adapter: 'yt-dlp', idempotencyKey: key });
    expect(again.id).toBe(first.id);
    repository.updateAcquisition(first.id, { status: 'paused', attempt: 1, bytesDone: 512, bytesTotal: 2_048, partialPath: 'media/.partial/abc.mp4' });
    expect(repository.listAcquisitions(runId)).toEqual([expect.objectContaining({ id: first.id, status: 'paused', attempt: 1, bytesDone: 512, bytesTotal: 2_048, partialPath: 'media/.partial/abc.mp4' })]);
    expect(() => repository.updateAcquisition(first.id, { partialPath: '../fora.mp4' })).toThrow(/caminho/i);
  });

  it('stores provenance with usage and legal clearance as separate fields', () => {
    const repository = new AetheraStudioRepository(handle.db);
    repository.saveProvenance({ schemaVersion: 1, assetId: 'asset-1', url: 'https://www.youtube.com/watch?v=abc', platform: 'youtube', publisher: 'Publisher', official: true, publishedAt: null, license: null, knownRestrictions: ['sem música'], adapter: 'yt-dlp', adapterVersion: '2026.10.1', acquiredAt: '2026-11-10T00:00:00.000Z', usage: 'editorial_use', legalClearance: 'unknown' });
    expect(repository.provenance('asset-1')).toMatchObject({ usage: 'editorial_use', legalClearance: 'unknown', knownRestrictions: ['sem música'], official: true });
    expect(repository.provenance('missing')).toBeNull();
  });

  it('replaces the segments of an asset in order and records identity per segment', () => {
    const repository = new AetheraStudioRepository(handle.db);
    repository.saveSubject(runId, subject('g1'));
    repository.replaceSegments('asset-1', [segment('s2', 2_000), segment('s1', 0)]);
    repository.replaceSegments('asset-1', [segment('s1', 0), segment('s2', 2_000), segment('s3', 4_000)]);
    expect(repository.listSegments('asset-1').map((item) => item.id)).toEqual(['s1', 's2', 's3']);
    repository.recordIdentity({ schemaVersion: 1, id: 'id-1', assetId: 'asset-1', segmentId: 's1', subjectId: 'g1', signals: [{ source: 'provenance', verdict: 'match', score: 0.9, evidence: 'canal oficial' }], status: 'review_required', calibratedConfidence: 0.6, verifiedBy: 'rules' });
    expect(repository.listIdentities('g1')).toEqual([expect.objectContaining({ segmentId: 's1', status: 'review_required' })]);
  });

  it('caches a vision result by its full key only', () => {
    const repository = new AetheraStudioRepository(handle.db);
    const key = { frameHash: 'f1', provider: 'ffmpeg-heuristics', model: 'ffmpeg', promptVersion: 'v1', task: 'qa' as const };
    expect(repository.visionCache(key)).toBeNull();
    repository.saveVisionCache(key, { kind: 'unknown', confidence: 0.4 });
    expect(repository.visionCache(key)).toEqual({ kind: 'unknown', confidence: 0.4 });
    expect(repository.visionCache({ ...key, promptVersion: 'v2' })).toBeNull();
  });

  it('records approvals with a gate and a version while legacy approvals keep working', () => {
    const production = new VelixProductionRepository(handle);
    production.recordApproval({ runId, decision: 'approved' });
    production.recordApproval({ runId, decision: 'approved', gate: 'technical', version: 'render-hash-1' });
    expect(production.listApprovals(runId).map((item) => [item.gate, item.version])).toEqual([[null, null], ['technical', 'render-hash-1']]);
  });

  it('AP-02: records the editorial-use policy and per-asset decisions apart from the Rights Manager', () => {
    const repository = new AetheraStudioRepository(handle.db);
    expect(repository.editorialPolicy('vp')).toBeNull();
    expect(repository.setEditorialPolicy({ projectId: 'vp', thirdPartyEditorialUse: true, note: 'Ranking com comentário crítico', decidedBy: 'user' })).toMatchObject({ thirdPartyEditorialUse: true });
    repository.setEditorialPolicy({ projectId: 'vp', thirdPartyEditorialUse: false, note: 'Pausado', decidedBy: 'user' });
    expect(repository.editorialPolicy('vp')).toMatchObject({ thirdPartyEditorialUse: false, note: 'Pausado' });
    expect(repository.editorialDecision('vp', 'asset-1')).toBeNull();
    repository.decideEditorialUse({ assetId: 'asset-1', projectId: 'vp', decision: 'approved', note: 'Trecho curto, trailer oficial', decidedBy: 'user' });
    expect(repository.editorialDecision('vp', 'asset-1')).toMatchObject({ decision: 'approved' });
    expect(() => repository.decideEditorialUse({ assetId: 'outro', projectId: 'vp', decision: 'approved', note: 'x', decidedBy: 'user' })).toThrow(/não pertence/);
    // The library rights status is never touched by these decisions.
    expect(handle.db.select().from(velixLocalAssets).all().map((row) => row.rightsStatus)).toEqual(['pending_review']);
  });

  it('keeps the channel voice preset, one active authorization per preset and per-scene directions', () => {
    const repository = new AetheraStudioRepository(handle.db);
    const preset = repository.saveVoicePreset({ schemaVersion: 1, id: 'voz-c', projectId: 'vp', name: 'Aethera — dinâmica', provider: 'voicestudio', modelId: 'omnivoice', origin: 'synthetic_design', design: { instruct: 'male, young adult, moderate pitch', seed: 303, numStep: 32 }, speed: 1.12, language: 'pt-BR', sample: null, createdAt: '2026-11-11T12:00:00.000Z' });
    expect(repository.listVoicePresets('vp')).toEqual([preset]);
    const license = { registryDigest: 'd', license: 'CC-BY-NC', reviewStatus: 'noncommercial', commercialInference: 'restricted', licenseCategory: 'noncommercial' };
    const first = repository.grantVoiceAuthorization({ presetId: 'voz-c', projectId: 'vp', provider: 'voicestudio', modelId: 'omnivoice', license, scope: 'noncommercial', note: 'Sem monetização', grantedBy: 'user' });
    const second = repository.grantVoiceAuthorization({ presetId: 'voz-c', projectId: 'vp', provider: 'voicestudio', modelId: 'omnivoice', license, scope: 'noncommercial', note: 'Renovada', grantedBy: 'user' });
    expect(repository.activeVoiceAuthorization('voz-c', 'vp')?.id).toBe(second.id);
    expect(second.id).not.toBe(first.id);
    repository.revokeVoiceAuthorization(second.id);
    expect(repository.activeVoiceAuthorization('voz-c', 'vp')).toBeNull();
    expect(() => repository.grantVoiceAuthorization({ presetId: 'outra', projectId: 'vp', provider: 'voicestudio', modelId: 'omnivoice', license, scope: 'noncommercial', note: 'x', grantedBy: 'user' })).toThrow(/não encontrada/);
    repository.setNarrationDirection(runId, 'scene-1', { sceneId: 'scene-1', speed: 1.2, pauseAfterMs: 600 });
    expect(repository.listNarrationDirections(runId)).toEqual([{ sceneId: 'scene-1', speed: 1.2, pauseAfterMs: 600 }]);
    repository.setNarrationDirection(runId, 'scene-1', null);
    expect(repository.listNarrationDirections(runId)).toEqual([]);
  });

  it('persists immutable timeline versions, changes and hashes across database reopen', () => {
    const timeline = assembleTimeline({ runId, storyboard: timelineStoryboard(), format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } } });
    const repository = new AetheraTimelineRepository(handle.db);
    repository.save({ runId, document: timeline, source: 'assembled', author: 'assembler' });
    const edited = applyTimelineOps(timeline, [{ op: 'move', selector: { clipIds: ['graphics:scene-1'] }, startMs: 200 }], { author: 'user', command: 'mova a cena' });
    repository.save({ runId, document: edited.document, source: 'edit', author: 'user', change: edited.change });

    expect(repository.history(runId).map((version) => version.version)).toEqual([2, 1]);
    expect(repository.latest(runId)).toMatchObject({ version: 2, hash: expect.any(String), change: edited.change });
    const file = handle.file;
    handle.close();
    handle = openDatabase(file, { migrationsFolder: MIGRATIONS });
    expect(new AetheraTimelineRepository(handle.db).latest(runId)?.document.tracks[1]?.items[0]?.startMs).toBe(200);
  });

  it('restores an older snapshot as a new version without rewriting history', () => {
    const timeline = assembleTimeline({ runId, storyboard: timelineStoryboard(), format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } } });
    const repository = new AetheraTimelineRepository(handle.db);
    repository.save({ runId, document: timeline, source: 'assembled', author: 'assembler' });
    const edited = applyTimelineOps(timeline, [{ op: 'move', selector: { clipIds: ['graphics:scene-1'] }, startMs: 200 }], { author: 'user', command: 'mova a cena' });
    repository.save({ runId, document: edited.document, source: 'edit', author: 'user', change: edited.change });
    const restored = { ...timeline, version: 3 };
    const change = { fromVersion: 2, toVersion: 3, author: 'user' as const, command: 'Desfazer para a versão 1', ops: [], affectedClipIds: ['graphics:scene-1'], summary: 'Restaurada a versão 1 como nova versão 3.' };
    repository.save({ runId, document: restored, source: 'restore', author: 'user', change });

    expect(repository.history(runId).map((version) => version.version)).toEqual([3, 2, 1]);
    expect(repository.latest(runId)).toMatchObject({ version: 3, source: 'restore', change });
    expect(repository.get(runId, 1)?.document).toEqual(timeline);
  });

  it('persists review findings against the timeline version and keeps report history immutable', () => {
    const repository = new AetheraReviewRepository(handle.db);
    const report = repository.save({ runId, timelineVersion: 1, timelineHash: 'hash-v1', requestedCycles: 2, cycles: 1, findings: [], changes: [] });
    expect(repository.latest(runId)).toEqual(report);
    expect(repository.history(runId)).toEqual([report]);
    expect(report).toMatchObject({ runId, timelineVersion: 1, timelineHash: 'hash-v1' });
  });

  it('persists proxy metadata by original hash without touching asset rights', () => {
    const repository = new AetheraMediaProxyRepository(handle.db);
    const proxy = { schemaVersion: 1 as const, assetId: 'asset-1', originalHash: 'b'.repeat(64), relativePath: 'proxies/asset-1-540p.mp4', width: 960, height: 540, fps: 30, codec: 'h264', createdAt: '2026-11-11T12:00:00.000Z' };
    expect(repository.save(proxy)).toEqual(proxy);
    expect(repository.get('asset-1', proxy.originalHash)).toEqual(proxy);
    expect(repository.list('asset-1')).toEqual([proxy]);
    expect(handle.db.select().from(velixLocalAssets).get()?.rightsStatus).toBe('pending_review');
  });

  it('stores only licensed music metadata in the project library', () => {
    const repository = new AetheraAudioLibraryRepository(handle.db);
    const track = { id: 'music-1', relativePath: 'audio/music.mp3', sha256: 'a'.repeat(64), durationMs: 60_000, bpm: 120, mood: ['cinematic'], license: { name: 'CC0', source: 'https://example.com/license', evidence: 'library/music-1.json', scope: 'audiovisual', expiresAt: null }, importedAt: '2026-11-11T00:00:00.000Z' };
    expect(repository.saveMusicTrack('vp', track)).toEqual(track);
    expect(repository.getMusicTrack('vp', 'music-1')).toEqual(track);
    expect(repository.listMusicTracks('vp')).toEqual([track]);
  });

  it('persists a versioned preset and immutable director-plan history', () => {
    const repository = new AetheraDirectorRepository(handle.db);
    const preset = defaultAetheraPresets[0];
    if (!preset) throw new Error('preset missing');
    repository.savePreset(preset);
    expect(repository.preset(preset.id, preset.version)).toEqual(preset);
    const timeline = assembleTimeline({ runId, storyboard: timelineStoryboard(), format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } } });
    const plan = applyDirectorRules({ timeline, preset });
    repository.savePlan({ runId, plan });
    repository.savePlan({ runId, plan });
    expect(repository.latestPlan(runId)).toEqual(plan);
  });
});
