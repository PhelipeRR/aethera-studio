import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { acquisitionIdempotencyKey, type SourceCandidate, type VerifiedSubject } from '@neuralbridge/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AetheraStudioRepository, openDatabase, velixLocalAssets, VelixProductionRepository, videoProjects, type DatabaseHandle } from '../src/index.js';

const MIGRATIONS = resolve(import.meta.dirname, '../migrations');
let handle: DatabaseHandle;
const brief = { schemaVersion: 1 as const, projectId: 'vp', format: { id: 'youtube-long' as const, width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } }, productionType: 'ranking', topic: 'Top', targetDurationSeconds: 600, language: 'pt-BR', audience: 'gamers', tone: 'empolgado', narrativeStyle: 'ranking', researchDepth: 'standard' as const, sourceCount: 3, pace: 'standard' as const, budgetUsd: 0 };
const subject = (runId: string): VerifiedSubject => ({ schemaVersion: 1, id: `${runId}:igdb:1`, kind: 'game', title: 'Fixture Quest', aliases: [], releaseDate: '2027-01-15', datePrecision: 'day', platforms: [], companies: ['Fixture Studio'], externalIds: { igdb: '1' }, verification: 'confirmed', evidenceIds: ['ev'], checkedAt: '2026-11-10T00:00:00.000Z' });
const candidate = (runId: string, overrides: Partial<SourceCandidate> = {}): SourceCandidate => ({
  schemaVersion: 1, id: `cand-${runId}`, runId, subjectId: `${runId}:igdb:1`, referenceId: null, url: 'https://www.youtube.com/watch?v=aaaaaaaaaaa', source: 'igdb_video', kind: 'trailer', title: 'Fixture Quest Trailer',
  channel: 'Fixture Studio', channelVerified: true, official: true, durationSeconds: 90, maxHeight: 1080, publishedAt: null, license: null, thumbnailUrl: null, score: 0.8, reasons: [], identity: 'verified', status: 'proposed', discoveredAt: '2026-11-10T00:00:00.000Z', ...overrides,
});

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-media-')), 'db.sqlite'), { migrationsFolder: MIGRATIONS });
  handle.db.insert(videoProjects).values({ id: 'vp', name: 'Vídeo', rootPath: join(tmpdir(), 'aethera-media-vp') }).run();
});
afterEach(() => handle.close());

describe('AetheraStudioRepository — media candidates and acquisition history', () => {
  it('keeps one candidate per run and URL and preserves the person decision on rediscovery', () => {
    const runId = new VelixProductionRepository(handle).createRun({ projectId: 'vp', brief, estimatedCostUsd: 0, agent: 'codex' }).id;
    const repository = new AetheraStudioRepository(handle.db);
    repository.saveSubject(runId, subject(runId));
    const saved = repository.saveCandidate(candidate(runId));
    repository.setCandidateStatus(saved.id, 'rejected');
    const again = repository.saveCandidate(candidate(runId, { id: 'other-id', score: 0.9, status: 'selected' }));
    expect(again).toMatchObject({ id: saved.id, status: 'rejected', score: 0.9 });
    expect(repository.listCandidates(runId)).toHaveLength(1);
    expect(() => repository.setCandidateStatus('missing', 'selected')).toThrow(/não encontrada/);
  });

  it('finds a source already acquired in another run of the same project, and an asset by content hash', () => {
    const production = new VelixProductionRepository(handle);
    const first = production.createRun({ projectId: 'vp', brief, estimatedCostUsd: 0, agent: 'codex' }).id;
    const second = production.createRun({ projectId: 'vp', brief, estimatedCostUsd: 0, agent: 'codex' }).id;
    const repository = new AetheraStudioRepository(handle.db);
    handle.db.insert(velixLocalAssets).values({ id: 'asset-1', projectId: 'vp', path: 'media/aethera/a.mp4', bytes: 10, sha256: 'c'.repeat(64), rightsStatus: 'conditional' }).run();
    const key = acquisitionIdempotencyKey('https://www.youtube.com/watch?v=aaaaaaaaaaa', 'video-1080p-plus');
    const job = repository.enqueueAcquisition({ runId: first, subjectId: null, referenceId: 'ref', adapter: 'yt-dlp', idempotencyKey: key });
    expect(repository.acquiredForKey('vp', key)).toBeNull();
    repository.updateAcquisition(job.id, { status: 'done', result: { assetId: 'asset-1', contentHash: 'c'.repeat(64), width: 1920, height: 1080, fps: 30, durationMs: 90_000, vcodec: 'h264', acodec: 'aac' } });
    expect(repository.acquiredForKey('vp', key)?.result?.assetId).toBe('asset-1');
    expect(repository.acquisition(second, key)).toBeNull();
    expect(repository.assetBySha('vp', 'c'.repeat(64))?.id).toBe('asset-1');
    expect(repository.assetBySha('vp', 'd'.repeat(64))).toBeNull();
  });

  it('records the usage history of an asset in order', () => {
    const runId = new VelixProductionRepository(handle).createRun({ projectId: 'vp', brief, estimatedCostUsd: 0, agent: 'codex' }).id;
    const repository = new AetheraStudioRepository(handle.db);
    handle.db.insert(velixLocalAssets).values({ id: 'asset-1', projectId: 'vp', path: 'media/aethera/a.mp4', bytes: 10, sha256: 'c'.repeat(64), rightsStatus: 'conditional' }).run();
    repository.logUsage({ runId, event: 'discovered', detail: 'igdb_video' });
    repository.logUsage({ runId, assetId: 'asset-1', event: 'acquired' });
    repository.logUsage({ runId, assetId: 'asset-1', event: 'reused', detail: 'outra produção' });
    expect(repository.listUsage({ assetId: 'asset-1' }).map((event) => event.event)).toEqual(['acquired', 'reused']);
    expect(repository.listUsage({ runId })).toHaveLength(3);
  });
});
