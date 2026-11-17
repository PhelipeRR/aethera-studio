import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { AetheraStudioRepository, openDatabase, velixLocalAssets, videoProjects, VelixProductionRepository } from '@neuralbridge/database';
import type { ProductionBrief, SegmentAnalysis, VisionPolicy } from '@neuralbridge/shared';
import { afterEach, expect, it } from 'vitest';
import { createReferenceClips, FFMPEG } from '../../workspace/test/fixtures/aethera-reference.js';
import { createVisualIndexStageAdapter, resolveTitleMentions } from '../src/aethera/visual-index.js';
import { createVisionProviders } from '../src/aethera/vision-providers.js';
import { type VisualAnalysisProvider } from '../src/aethera/vision-router.js';
import { ProductionRunService, type ProductionTaskPort } from '../src/velix-production.js';

const brief: ProductionBrief = { schemaVersion: 1, projectId: 'vp', format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } }, productionType: 'ranking', topic: 'Synthetic B-1', targetDurationSeconds: 60, language: 'pt-BR', audience: 'gamers', tone: 'neutral', narrativeStyle: 'ranking', researchDepth: 'standard', sourceCount: 3, pace: 'standard', budgetUsd: 0 };
const policy: VisionPolicy = { schemaVersion: 1, task: 'classify', chain: ['local-siglip', 'ffmpeg-heuristics'], scope: 'project', thresholds: null, version: 'as05-v1', budgetUsd: 0, maxLatencyMs: 5_000 };
const handles: Array<{ close(): void }> = [];
afterEach(() => { for (const handle of handles.splice(0)) handle.close(); });

it('indexes real synthetic media through ProductionRunService and reindexes after reopen with zero provider calls', async () => {
  const root = mkdtempSync(join(tmpdir(), 'as05-index-'));
  const clips = await createReferenceClips(root);
  const clip = clips['fixture-game-a'];
  if (!clip) throw new Error('synthetic fixture clip is missing.');
  const file = join(root, 'brain.sqlite');
  const migrationsFolder = resolve(import.meta.dirname, '../../database/migrations');
  let handle = openDatabase(file, { migrationsFolder });
  handles.push(handle);
  handle.db.insert(videoProjects).values({ id: 'vp', name: 'Synthetic', rootPath: root }).run();
  handle.db.insert(velixLocalAssets).values({ id: 'asset', projectId: 'vp', path: clip, bytes: 100, sha256: 'a'.repeat(64), rightsStatus: 'verified_allowed' }).run();
  const production = new VelixProductionRepository(handle);
  const run = production.createRun({ projectId: 'vp', brief, estimatedCostUsd: 0, agent: 'codex' });
  let repository = new AetheraStudioRepository(handle.db);
  repository.saveSubject(run.id, { schemaVersion: 1, id: 'game', kind: 'game', title: 'Fixture Game A', aliases: [], releaseDate: null, datePrecision: 'year', platforms: [], companies: ['Synthetic Publisher'], externalIds: {}, verification: 'unconfirmed', evidenceIds: [], checkedAt: '2026-11-10' });
  repository.saveProvenance({ schemaVersion: 1, assetId: 'asset', url: 'https://example.com/synthetic', platform: 'local', publisher: 'Synthetic Publisher', official: false, publishedAt: null, license: null, knownRestrictions: [], adapter: 'local-import', adapterVersion: '1', acquiredAt: '2026-11-10', usage: 'review_required', legalClearance: 'own' });
  const job = repository.enqueueAcquisition({ runId: run.id, subjectId: 'game', referenceId: 'ref', adapter: 'local-import', idempotencyKey: 'synthetic' });
  repository.updateAcquisition(job.id, { status: 'done', result: { assetId: 'asset', contentHash: 'a'.repeat(64), width: 320, height: 180, fps: 30, durationMs: 5_000, vcodec: 'h264', acodec: null } });
  let calls = 0;
  const provider: VisualAnalysisProvider = { id: 'local-siglip', model: 'synthetic-test-only', capabilities: ['classify', 'describe', 'embed_image', 'embed_text', 'ocr', 'analyze'], limits: { maxImagesPerCall: 2, vramMb: 1 }, detect: async () => ({ available: true }),
    classify: async () => { calls++; return { kind: 'combat', confidence: 0.8 }; },
    describe: async () => { calls++; return { description: 'Synthetic animation only', tags: ['synthetic'] }; },
    embedImage: async ({ frames }) => { calls++; return frames.map(() => [1, 0]); },
    embedText: async ({ texts }) => { calls++; return texts.map(() => [0, 1]); },
    ocr: async ({ frames }) => { calls++; return frames.map(() => ''); },
    analyze: async ({ frames }) => { calls++; return { schemaVersion: 1, nature: 'action', natureConfidence: 0.9, description: 'Synthetic visual action', frames: frames.map((frame) => ({ atMs: frame.atMs ?? 0, observed: 'Synthetic movement visible', visibleText: [] })), entities: [], actions: [{ description: 'moving', basis: 'observed', confidence: 0.9 }], environment: null, overlays: { burnedText: false, burnedTextRegion: 'bottom', watermark: false, webcam: false }, limitations: [] , confidence: 0.9 } satisfies SegmentAnalysis; },
  };
  const noTasks: ProductionTaskPort = { start: async () => { throw new Error('No external task in synthetic test'); }, cancel: () => undefined, pause: () => undefined, resumePaused: () => undefined } as unknown as ProductionTaskPort;
  const adapter = () => createVisualIndexStageAdapter({ repository, providers: createVisionProviders([provider]), policy, projectRoot: () => root, asset: () => ({ path: clip, sha256: 'a'.repeat(64) }), ffmpeg: FFMPEG, ffprobe: FFMPEG.replace('ffmpeg.exe', 'ffprobe.exe') });
  let service = new ProductionRunService(production, noTasks, [adapter()]);
  await service.scheduleAdapterStage({ runId: run.id, kind: 'visual_index', taskProjectId: 'vp', input: { round: 2 } }); await service.idle();
  expect(service.state(run.id).stages.at(-1)).toMatchObject({ status: 'completed' });
  const segments = repository.listSegments('asset');
  expect(segments.length).toBeGreaterThan(0);
  expect(segments.every((segment) => segment.frameHashes.length >= 1 && segment.frameHashes.length <= 3 && segment.description.includes('Synthetic') && segment.embeddingRefs.length >= 2)).toBe(true);
  const brollIndex = repository.brollIndex('asset');
  expect(brollIndex).toMatchObject({ indexVersion: 'p2.1', assetId: 'asset', sourceHash: 'a'.repeat(64), status: 'complete', contactSheetPath: expect.any(String) });
  expect(brollIndex?.contactSheetPath && existsSync(join(root, brollIndex.contactSheetPath))).toBe(true);
  expect(brollIndex?.segments).toHaveLength(segments.length);
  expect(segments.every((segment) => segment.broll?.indexVersion === 'p2.1' && segment.broll?.keyframes.length === segment.frameHashes.length)).toBe(true);
  expect(segments.some((segment) => segment.broll?.technicalStatus === 'technical_blocked')).toBe(true);
  expect(segments.some((segment) => segment.broll?.technicalStatus === 'technical_valid')).toBe(true);
  expect(segments.every((segment) => segment.broll?.diagnostics.some((item) => item.startsWith('temporal_samples=')))).toBe(true);
  expect(segments.every((segment) => segment.broll?.semanticStatus === 'semantic_adequate')).toBe(true);
  expect(segments.every((segment) => segment.analysis?.attempts.some((attempt) => attempt.task === 'analyze'))).toBe(true);
  expect(repository.listIdentities('game').every((identity) => identity.status === 'review_required')).toBe(true);
  expect(calls).toBeGreaterThan(0);
  handles.pop(); handle.close();
  handle = openDatabase(file, { migrationsFolder }); handles.push(handle);
  repository = new AetheraStudioRepository(handle.db);
  calls = 0;
  service = new ProductionRunService(new VelixProductionRepository(handle), noTasks, [adapter()]);
  await service.scheduleAdapterStage({ runId: run.id, kind: 'visual_index', taskProjectId: 'vp' }); await service.idle();
  expect(service.state(run.id).stages.at(-1)).toMatchObject({ status: 'completed' });
  expect(repository.listSegments('asset')).toEqual(segments);
  expect(calls).toBe(0);
}, 60_000);

it('resolves overlapping game titles to the longest unambiguous mention', () => {
  expect(resolveTitleMentions('DOOM Eternal official gameplay', [
    { id: 'doom', title: 'DOOM', aliases: [] },
    { id: 'doom-eternal', title: 'DOOM Eternal', aliases: [] },
  ]).map((item) => item.id)).toEqual(['doom-eternal']);
  expect(resolveTitleMentions('DOOM and DOOM Eternal official showcase', [
    { id: 'doom', title: 'DOOM', aliases: [] },
    { id: 'doom-eternal', title: 'DOOM Eternal', aliases: [] },
  ]).map((item) => item.id)).toEqual(['doom', 'doom-eternal']);
});
