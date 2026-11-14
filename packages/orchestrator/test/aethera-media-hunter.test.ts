import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { AetheraStudioRepository, openDatabase, VelixDiscoveryRepository, velixLocalAssets, videoProjects, VelixProductionRepository, type DatabaseHandle } from '@neuralbridge/database';
import { type ProductionBrief, type VerifiedSubject } from '@neuralbridge/shared';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createMediaAcquisitionStageAdapter, createMediaDiscoveryStageAdapter, type MediaAcquisitionDeps, type VideoInfo } from '../src/aethera/media-hunter.js';
import { ProductionRunService, type ProductionTaskPort } from '../src/velix-production.js';

// Synthetic games, channels and videos; no real source is contacted.
const MIGRATIONS = resolve(import.meta.dirname, '../../database/migrations');
let handle: DatabaseHandle;
let root: string;
const brief: ProductionBrief = { schemaVersion: 1, projectId: 'vp', format: { id: 'youtube-long', width: 1920, height: 1080, fps: 30, aspectRatio: '16:9', safeArea: { top: 54, right: 96, bottom: 54, left: 96 } }, productionType: 'ranking', topic: 'Top', targetDurationSeconds: 600, language: 'pt-BR', audience: 'gamers', tone: 'empolgado', narrativeStyle: 'ranking', researchDepth: 'standard', sourceCount: 3, pace: 'standard', budgetUsd: 0 };
const noTasks = { start: async () => { throw new Error('not used'); }, cancel: () => undefined, pause: () => undefined, resumePaused: () => undefined } as unknown as ProductionTaskPort;
const subject = (runId: string, id: string, title: string, companies: string[]): VerifiedSubject => ({ schemaVersion: 1, id: `${runId}:igdb:${id}`, kind: 'game', title, aliases: [], releaseDate: '2027-01-15', datePrecision: 'day', platforms: [], companies, externalIds: { igdb: id }, verification: 'confirmed', evidenceIds: ['ev'], checkedAt: '2026-11-10T00:00:00.000Z' });
const video = (id: string, title: string, channel: string, maxHeight = 1080, durationSeconds = 120): VideoInfo => ({ url: `https://www.youtube.com/watch?v=${id}`, title, channel, channelVerified: true, durationSeconds, maxHeight, uploadDate: '2026-06-01', license: null, thumbnail: null });

beforeEach(() => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'aethera-hunter-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  root = mkdtempSync(join(tmpdir(), 'aethera-hunter-root-'));
  handle.db.insert(videoProjects).values({ id: 'vp', name: 'Vídeo', rootPath: root }).run();
});
afterEach(() => handle.close());

function discovery(runId: string, overrides: { igdb?: boolean; search?: (query: string) => VideoInfo[] } = {}) {
  const repository = new AetheraStudioRepository(handle.db);
  repository.saveSubject(runId, subject(runId, '1', 'Fixture Quest', ['Fixture Publishing']));
  repository.saveSubject(runId, subject(runId, '2', 'Other Saga', ['Other Corp']));
  return createMediaDiscoveryStageAdapter({
    repository, library: new VelixDiscoveryRepository(handle.db),
    igdb: () => (overrides.igdb === false ? null : { gameVideos: async (id: number) => (id === 1 ? [{ name: 'Launch Trailer', videoId: 'aaaaaaaaaaa' }] : []) }),
    videoInfo: async (urls) => urls.map((url) => video(url.split('=')[1] ?? 'x', 'Fixture Quest - Launch Trailer', 'Fixture Publishing', 2160, 95)),
    search: async (query) => (overrides.search ? overrides.search(query) : query.startsWith('Fixture Quest') ? [video('bbbbbbbbbbb', `${query} 4K`, 'Fixture Publishing America', 2160, 130), video('ccccccccccc', 'Other Saga gameplay walkthrough', 'Random Clips', 720, 1_800)] : [query.endsWith('gameplay') ? video('eeeeeeeeeee', `${query} 20 minutes of gameplay`, 'Other Corp', 1080, 1_200) : video('ddddddddddd', `${query}`, 'Other Corp', 1080, 100)]),
    now: () => new Date('2026-11-10T12:00:00.000Z'),
  });
}

function acquisitionDeps(overrides: Partial<MediaAcquisitionDeps> & { calls?: string[]; content?: (url: string) => string } = {}): MediaAcquisitionDeps {
  return {
    repository: new AetheraStudioRepository(handle.db), library: new VelixDiscoveryRepository(handle.db),
    acquire: async ({ url, root: base, relativeDir, fileStem }) => {
      overrides.calls?.push(url);
      const relativePath = `${relativeDir}/${fileStem}.mp4`;
      mkdirSync(dirname(join(base, relativePath)), { recursive: true });
      writeFileSync(join(base, relativePath), overrides.content ? overrides.content(url) : `bytes of ${url}`);
      return { relativePath };
    },
    probe: async () => ({ duration: 95, width: 1920, height: 1080, fps: 30, codecs: ['h264', 'aac'] }),
    hashFile: async (path) => { const data = readFileSync(path); return { sha256: createHash('sha256').update(data).digest('hex'), bytes: data.length }; },
    projectRoot: () => root, formatId: 'video-1080p-plus', adapterVersion: async () => '2026.10.26-synthetic', sleep: async () => undefined, now: () => new Date('2026-11-10T12:00:00.000Z'),
    ...overrides,
  };
}

async function discovered(service: ProductionRunService) {
  const run = service.create('vp', brief, 0, 'codex');
  await service.scheduleAdapterStage({ runId: run.id, kind: 'media_discovery', taskProjectId: 'vp' });
  await service.idle();
  return run.id;
}

describe('media_discovery stage', () => {
  it('finds IGDB-linked and searched videos, checks identity and recommends a trailer and a gameplay per game', async () => {
    const production = new VelixProductionRepository(handle);
    const runId = production.createRun({ projectId: 'vp', brief, estimatedCostUsd: 0, agent: 'codex' }).id;
    const service = new ProductionRunService(production, noTasks, [discovery(runId)]);
    await service.scheduleAdapterStage({ runId, kind: 'media_discovery', taskProjectId: 'vp' });
    await service.idle();
    expect(service.state(runId).stages[0]).toMatchObject({ kind: 'media_discovery', status: 'completed' });
    const repository = new AetheraStudioRepository(handle.db);
    const candidates = repository.listCandidates(runId);
    const igdbTrailer = candidates.find((candidate) => candidate.url.endsWith('aaaaaaaaaaa'));
    expect(igdbTrailer).toMatchObject({ source: 'igdb_video', kind: 'trailer', official: true, identity: 'verified', status: 'selected' });
    expect(candidates.find((candidate) => candidate.url.endsWith('ccccccccccc') && candidate.subjectId.endsWith(':1'))).toMatchObject({ identity: 'rejected', score: 0, status: 'proposed' });
    expect(candidates.filter((candidate) => candidate.status === 'selected').map((candidate) => `${candidate.subjectId.split(':').at(-1)}:${candidate.kind}`).sort()).toEqual(['1:trailer', '2:gameplay', '2:trailer']);
    expect(new VelixDiscoveryRepository(handle.db).pendingReferences('vp').length).toBeGreaterThan(0);
    expect(repository.listUsage({ runId }).every((event) => event.event === 'discovered')).toBe(true);
  });

  it('still works through search alone when IGDB is not configured', async () => {
    const production = new VelixProductionRepository(handle);
    const runId = production.createRun({ projectId: 'vp', brief, estimatedCostUsd: 0, agent: 'codex' }).id;
    const service = new ProductionRunService(production, noTasks, [discovery(runId, { igdb: false })]);
    await service.scheduleAdapterStage({ runId, kind: 'media_discovery', taskProjectId: 'vp' });
    await service.idle();
    expect(new AetheraStudioRepository(handle.db).listCandidates(runId).some((candidate) => candidate.source === 'igdb_video')).toBe(false);
    expect(new AetheraStudioRepository(handle.db).listCandidates(runId).length).toBeGreaterThan(0);
  });

  it('refuses to run before the games are researched', async () => {
    const service = new ProductionRunService(new VelixProductionRepository(handle), noTasks, [createMediaDiscoveryStageAdapter({ repository: new AetheraStudioRepository(handle.db), library: new VelixDiscoveryRepository(handle.db), igdb: () => null, videoInfo: async () => [], search: async () => [] })]);
    const runId = await discovered(service);
    expect(service.state(runId).stages[0]?.error).toContain('pesquise os jogos');
  });
});

describe('media_acquisition stage', () => {
  async function prepared(extra: Partial<MediaAcquisitionDeps> & { calls?: string[]; content?: (url: string) => string } = {}) {
    const production = new VelixProductionRepository(handle);
    const runId = production.createRun({ projectId: 'vp', brief, estimatedCostUsd: 0, agent: 'codex' }).id;
    const service = new ProductionRunService(production, noTasks, [discovery(runId), createMediaAcquisitionStageAdapter(acquisitionDeps(extra))]);
    await service.scheduleAdapterStage({ runId, kind: 'media_discovery', taskProjectId: 'vp' });
    await service.idle();
    return { runId, service, repository: new AetheraStudioRepository(handle.db) };
  }

  it('downloads the selected sources with provenance, identity, usage history and the AS-05 manifest', async () => {
    const calls: string[] = [];
    const { runId, service, repository } = await prepared({ calls });
    await service.scheduleAdapterStage({ runId, kind: 'media_acquisition', taskProjectId: 'vp' });
    await service.idle();
    expect(service.state(runId).stages.at(-1)).toMatchObject({ kind: 'media_acquisition', status: 'completed' });
    expect(calls).toHaveLength(3);
    const trailer = repository.listCandidates(runId).find((candidate) => candidate.url.endsWith('aaaaaaaaaaa'));
    expect(trailer?.status).toBe('acquired');
    const job = repository.listAcquisitions(runId).find((item) => item.idempotencyKey.includes('aaaaaaaaaaa'));
    const assetId = job?.result?.assetId ?? '';
    expect(job).toMatchObject({ status: 'done', attempt: 1, result: { width: 1920, height: 1080, vcodec: 'h264', acodec: 'aac' } });
    expect(repository.provenance(assetId)).toMatchObject({ usage: 'editorial_use', legalClearance: 'unknown', official: true, adapter: 'yt-dlp', adapterVersion: '2026.10.26-synthetic', knownRestrictions: ['licença não declarada pela fonte'] });
    expect(handle.db.select().from(velixLocalAssets).where(eq(velixLocalAssets.id, assetId)).get()).toMatchObject({ rightsStatus: 'conditional', path: expect.stringMatching(/^media\/aethera\/fixture-quest\/trailer-/) });
    expect(repository.listIdentities(trailer?.subjectId ?? '')[0]).toMatchObject({ assetId, status: 'verified', verifiedBy: 'rules' });
    expect(repository.listUsage({ assetId }).map((event) => event.event)).toEqual(['acquired']);
    const manifest = JSON.parse(readFileSync(join(root, 'media/aethera/manifest.json'), 'utf8')) as { games: Array<{ title: string; assets: unknown[] }> };
    expect(manifest.games.map((game) => [game.title, game.assets.length])).toEqual([['Fixture Quest', 1], ['Other Saga', 2]]);
  });

  it('never downloads a source whose identity was rejected, even if a person selected it', async () => {
    const calls: string[] = [];
    const { runId, service, repository } = await prepared({ calls });
    const wrong = repository.listCandidates(runId).find((candidate) => candidate.identity === 'rejected');
    await service.scheduleAdapterStage({ runId, kind: 'media_acquisition', taskProjectId: 'vp', input: { candidateIds: [wrong?.id ?? ''] } });
    await service.idle();
    expect(calls).toEqual([]);
    expect(repository.candidate(wrong?.id ?? '')?.status).toBe('skipped');
    expect(repository.listUsage({ runId }).some((event) => event.event === 'identity_rejected')).toBe(true);
  });

  it('retries network failures with backoff and gives up on a removed video without stopping the others', async () => {
    let failures = 2;
    const waits: number[] = [];
    const calls: string[] = [];
    const { runId, service, repository } = await prepared({
      calls, sleep: async (ms) => { waits.push(ms); },
      acquire: async ({ url, root: base, relativeDir, fileStem }) => {
        calls.push(url);
        if (url.endsWith('aaaaaaaaaaa') && failures-- > 0) throw new Error('network: Read timed out.');
        if (url.endsWith('ddddddddddd')) throw new Error('unavailable: Video unavailable');
        const relativePath = `${relativeDir}/${fileStem}.mp4`;
        mkdirSync(dirname(join(base, relativePath)), { recursive: true });
        writeFileSync(join(base, relativePath), `bytes ${url}`);
        return { relativePath };
      },
    });
    await service.scheduleAdapterStage({ runId, kind: 'media_acquisition', taskProjectId: 'vp' });
    await service.idle();
    expect(service.state(runId).stages.at(-1)?.status).toBe('completed');
    expect(waits).toEqual([1_000, 2_000]);
    expect(repository.listAcquisitions(runId).find((job) => job.idempotencyKey.includes('aaaaaaaaaaa'))).toMatchObject({ status: 'done', attempt: 3 });
    expect(repository.listAcquisitions(runId).filter((job) => job.idempotencyKey.includes('ddddddddddd')).every((job) => job.status === 'failed' && job.error?.code === 'unavailable')).toBe(true);
    expect(calls.filter((url) => url.endsWith('ddddddddddd'))).toHaveLength(repository.listAcquisitions(runId).filter((job) => job.idempotencyKey.includes('ddddddddddd')).length);
  });

  it('never downloads nor recommends a gameplay over 60 min (a 12 h walkthrough here)', async () => {
    const calls: string[] = [];
    const production = new VelixProductionRepository(handle);
    const runId = production.createRun({ projectId: 'vp', brief, estimatedCostUsd: 0, agent: 'codex' }).id;
    const marathon = (query: string) => (query.endsWith('gameplay') ? [video('fffffffffff', `${query} FULL GAME walkthrough`, 'Other Corp', 2160, 43_074), video('ggggggggggg', `${query} 20 minutes`, 'Random Clips', 720, 1_200)] : [video('ddddddddddd', query, 'Other Corp', 1080, 100)]);
    const service = new ProductionRunService(production, noTasks, [discovery(runId, { igdb: false, search: marathon }), createMediaAcquisitionStageAdapter(acquisitionDeps({ calls }))]);
    await service.scheduleAdapterStage({ runId, kind: 'media_discovery', taskProjectId: 'vp' });
    await service.idle();
    const repository = new AetheraStudioRepository(handle.db);
    const long = repository.listCandidates(runId).find((candidate) => candidate.url.endsWith('fffffffffff') && candidate.subjectId.endsWith(':2'));
    expect(long).toMatchObject({ status: 'proposed', reasons: ['acima do limite de 60 min para gameplay'] });
    // The 20-minute gameplay from the same search is the one recommended instead.
    expect(repository.listCandidates(runId).find((candidate) => candidate.url.endsWith('ggggggggggg') && candidate.subjectId.endsWith(':2'))?.status).toBe('selected');
    // A person may still select it: the acquisition refuses it before contacting the source.
    await service.scheduleAdapterStage({ runId, kind: 'media_acquisition', taskProjectId: 'vp', input: { candidateIds: [long?.id ?? ''] } });
    await service.idle();
    expect(calls).toEqual([]);
    expect(service.state(runId).stages.at(-1)).toMatchObject({ kind: 'media_acquisition', status: 'completed' });
    expect(repository.candidate(long?.id ?? '')?.status).toBe('skipped');
    expect(repository.listUsage({ runId }).some((event) => event.event === 'too_long')).toBe(true);
  });

  it('marks the job failed, not running, when the downloaded file cannot be accepted, and keeps the other sources', async () => {
    const { runId, service, repository } = await prepared({ probe: async ({ relativePath }) => { if (relativePath.includes('trailer-aaaaaaaaaaa')) throw new Error('vídeo acima do limite de 4 horas'); return { duration: 95, width: 1920, height: 1080, fps: 30, codecs: ['h264', 'aac'] }; } });
    await service.scheduleAdapterStage({ runId, kind: 'media_acquisition', taskProjectId: 'vp' });
    await service.idle();
    expect(service.state(runId).stages.at(-1)?.status).toBe('completed');
    const jobs = repository.listAcquisitions(runId);
    expect(jobs.find((job) => job.idempotencyKey.includes('aaaaaaaaaaa'))).toMatchObject({ status: 'failed', error: { code: 'format', retryable: false, message: expect.stringContaining('4 horas') } });
    expect(jobs.filter((job) => !job.idempotencyKey.includes('aaaaaaaaaaa')).every((job) => job.status === 'done')).toBe(true);
    expect(jobs.some((job) => job.status === 'running')).toBe(false);
  });

  it('fails the stage with guidance when yt-dlp is missing', async () => {
    const { runId, service } = await prepared({ acquire: async () => { throw new Error('tool_missing: yt-dlp não encontrado.'); } });
    await service.scheduleAdapterStage({ runId, kind: 'media_acquisition', taskProjectId: 'vp' });
    await service.idle();
    expect(service.state(runId).stages.at(-1)).toMatchObject({ status: 'failed' });
    expect(service.state(runId).stages.at(-1)?.error).toContain('yt-dlp não encontrado');
  });

  it('reuses a source already acquired by another run of the project instead of downloading again', async () => {
    const calls: string[] = [];
    const first = await prepared({ calls });
    await first.service.scheduleAdapterStage({ runId: first.runId, kind: 'media_acquisition', taskProjectId: 'vp' });
    await first.service.idle();
    const before = calls.length;
    const second = await prepared({ calls });
    await second.service.scheduleAdapterStage({ runId: second.runId, kind: 'media_acquisition', taskProjectId: 'vp' });
    await second.service.idle();
    expect(calls.length).toBe(before);
    expect(second.repository.listUsage({ runId: second.runId }).filter((event) => event.event === 'reused')).toHaveLength(3);
  });

  it('downloads again when an acquired file was deleted from disk, in the same run and keeping the asset', async () => {
    const calls: string[] = [];
    const { runId, service, repository } = await prepared({ calls });
    await service.scheduleAdapterStage({ runId, kind: 'media_acquisition', taskProjectId: 'vp' });
    await service.idle();
    const job = repository.listAcquisitions(runId).find((item) => item.idempotencyKey.includes('aaaaaaaaaaa'));
    const asset = handle.db.select().from(velixLocalAssets).where(eq(velixLocalAssets.id, job?.result?.assetId ?? '')).get();
    rmSync(join(root, asset?.path ?? 'missing'));
    const before = calls.length;
    const acquiredIds = repository.listCandidates(runId).filter((candidate) => candidate.status === 'acquired').map((candidate) => candidate.id);
    await service.scheduleAdapterStage({ runId, kind: 'media_acquisition', taskProjectId: 'vp', input: { round: 1, candidateIds: acquiredIds } });
    await service.idle();
    expect(service.state(runId).stages.at(-1)).toMatchObject({ status: 'completed', error: null });
    expect(calls.slice(before)).toEqual([expect.stringContaining('aaaaaaaaaaa')]);
    expect(existsSync(join(root, asset?.path ?? 'missing'))).toBe(true);
    expect(repository.listAcquisitions(runId).find((item) => item.id === job?.id)).toMatchObject({ status: 'done', result: { assetId: asset?.id } });
    expect(handle.db.select().from(velixLocalAssets).all()).toHaveLength(3);
  });

  it('deduplicates by content when two sources deliver the same file', async () => {
    const { runId, service, repository } = await prepared({ content: () => 'identical bytes' });
    await service.scheduleAdapterStage({ runId, kind: 'media_acquisition', taskProjectId: 'vp' });
    await service.idle();
    const assets = new Set(repository.listAcquisitions(runId).map((job) => job.result?.assetId));
    expect(assets.size).toBe(1);
    expect(repository.listUsage({ runId }).filter((event) => event.event === 'deduplicated')).toHaveLength(2);
    const paths = repository.listAcquisitions(runId).map((job) => job.idempotencyKey);
    expect(paths).toHaveLength(3);
    expect(handle.db.select().from(velixLocalAssets).all()).toHaveLength(1);
  });

  it('pauses on cancel, keeps the job for resumption and continues after a restart', async () => {
    let hang = true;
    const calls: string[] = [];
    const deps = acquisitionDeps({ calls });
    const blocking: MediaAcquisitionDeps = { ...deps, acquire: (input) => (hang && input.url.endsWith('aaaaaaaaaaa') ? new Promise((_, fail) => input.signal.addEventListener('abort', () => fail(new Error('cancelled: aquisição interrompida.')))) : deps.acquire(input)) };
    const production = new VelixProductionRepository(handle);
    const runId = production.createRun({ projectId: 'vp', brief, estimatedCostUsd: 0, agent: 'codex' }).id;
    const service = new ProductionRunService(production, noTasks, [discovery(runId), createMediaAcquisitionStageAdapter(blocking)]);
    await service.scheduleAdapterStage({ runId, kind: 'media_discovery', taskProjectId: 'vp' });
    await service.idle();
    await service.scheduleAdapterStage({ runId, kind: 'media_acquisition', taskProjectId: 'vp' });
    await new Promise((done) => setTimeout(done, 20));
    service.pause(runId);
    await service.idle();
    const repository = new AetheraStudioRepository(handle.db);
    expect(repository.listAcquisitions(runId).find((job) => job.idempotencyKey.includes('aaaaaaaaaaa'))?.status).toBe('paused');
    hang = false;
    const restarted = new ProductionRunService(new VelixProductionRepository(handle), noTasks, [createMediaAcquisitionStageAdapter(blocking)]);
    restarted.recover();
    await restarted.resume(runId);
    await restarted.idle();
    expect(restarted.state(runId).stages.at(-1)?.status).toBe('completed');
    expect(repository.listAcquisitions(runId).every((job) => job.status === 'done')).toBe(true);
    expect(existsSync(join(root, 'media/aethera/manifest.json'))).toBe(true);
  });
});
