import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AetheraEvolutionCore } from '../../../packages/cinema/src/index.js';
import { StagedCinemaPipeline, type StagedProductionJob } from '../src/main/cinema-pipeline.js';

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

/** Research that only ends when its run is aborted (like a CLI killed by cancel), returning no dossier. */
function researchUntilAborted(calls: AbortSignal[]) {
  return (_interpretation: unknown, signal?: AbortSignal) =>
    new Promise<null>((resolve) => {
      if (signal) calls.push(signal);
      signal?.addEventListener('abort', () => setTimeout(() => resolve(null), 20), { once: true });
    });
}

describe('StagedCinemaPipeline — identidade da execução (jobId + attempt)', () => {
  it('persists independent creative dimensions, delivery preset and preview profile in the contract', async () => {
    const root = makeTempDir('aethera-format-persist-');
    const calls: AbortSignal[] = [];
    const pipeline = new StagedCinemaPipeline({
      jobsDir: join(root, 'jobs'),
      mediaDir: join(root, 'media'),
      outputDir: join(root, 'renders'),
      evolutionCore: new AetheraEvolutionCore(join(root, 'evolution.json')),
      onPackageReady: () => {},
      onRenderReady: () => {},
      runEditorialResearch: researchUntilAborted(calls) as never,
    });

    const run = pipeline.start({
      projectId: 'format_persist',
      prompt: 'Documentário sobre anime com linguagem cinematográfica',
      creativeSelection: {
        schemaVersion: 1,
        narrativeFormatId: 'documentary',
        contentCategoryId: 'anime-manga',
        aestheticDirectionId: 'cinematic',
      },
      deliveryPresetId: 'feed-4-5',
      previewProfile: 'review_720p',
      manuallyChangedFields: ['creativeSelection', 'deliveryPresetId', 'previewProfile'],
      targetDurationSec: 10,
    });
    await waitUntil(() => calls.length === 1);
    const persisted = pipeline.loadJob('format_persist');
    expect(persisted?.creativeSelection).toMatchObject({ narrativeFormatId: 'documentary', contentCategoryId: 'anime-manga', aestheticDirectionId: 'cinematic' });
    expect(persisted?.deliveryPresetId).toBe('feed-4-5');
    expect(persisted?.previewProfile).toBe('review_720p');
    expect(persisted?.contract?.controls.deliveryPresetId).toBe('feed-4-5');
    expect(persisted?.contract?.conflicts.some((conflict) => conflict.field === 'deliveryPresetId')).toBe(true);
    pipeline.cancel('format_persist');
    await run;
  }, 30_000);

  it('gives each production a unique jobId and counts attempts on resume', async () => {
    const root = makeTempDir('aethera-jobid-');
    const calls: AbortSignal[] = [];
    const snapshots: StagedProductionJob[] = [];
    const pipeline = new StagedCinemaPipeline({
      jobsDir: join(root, 'jobs'),
      mediaDir: join(root, 'media'),
      outputDir: join(root, 'renders'),
      evolutionCore: new AetheraEvolutionCore(join(root, 'evolution.json')),
      onPackageReady: () => {},
      onRenderReady: () => {},
      onProgress: (job) => snapshots.push(structuredClone(job)),
      runEditorialResearch: researchUntilAborted(calls) as never,
    });

    // 1st production: cancelled during research. The aborted research must NOT turn into a research pause.
    const first = pipeline.start({ projectId: 'proj_1', prompt: 'Os chefes de Elden Ring', targetDurationSec: 10 });
    await waitUntil(() => calls.length === 1);
    const jobId = pipeline.loadJob('proj_1')?.jobId;
    expect(jobId).toMatch(/^job_/);
    expect(jobId).not.toBe('proj_1');
    pipeline.cancel('proj_1');
    const cancelled = await first;
    expect(cancelled.state).toBe('cancelled');
    expect(pipeline.loadJob('proj_1')?.state).toBe('cancelled');
    expect(snapshots.some((s) => s.state === 'paused_pending_research')).toBe(false);

    // Resume = same job, attempt 2. Cancelling it again still works (its controller was not dropped by the old run).
    const resumed = pipeline.resume('proj_1');
    await waitUntil(() => calls.length === 2);
    expect(pipeline.loadJob('proj_1')).toMatchObject({ jobId, attempt: 2 });
    pipeline.cancel('proj_1');
    expect(calls[1]?.aborted).toBe(true);
    expect((await resumed).state).toBe('cancelled');

    // A new production of the SAME project is a different job; late writes of the previous job cannot overwrite it.
    const second = pipeline.start({ projectId: 'proj_1', prompt: 'Outra produção do mesmo projeto', targetDurationSec: 10 });
    await waitUntil(() => calls.length === 3);
    const secondJobId = pipeline.loadJob('proj_1')?.jobId;
    expect(secondJobId).toMatch(/^job_/);
    expect(secondJobId).not.toBe(jobId);
    expect(pipeline.loadJob('proj_1')?.attempt).toBe(1);
    pipeline.cancel('proj_1');
    await second;

    // Every snapshot names its execution; attempts of the first job never go backwards.
    expect(snapshots.every((s) => typeof s.jobId === 'string' && typeof s.attempt === 'number')).toBe(true);
    const firstJobAttempts = snapshots.filter((s) => s.jobId === jobId).map((s) => s.attempt ?? 1);
    expect([...firstJobAttempts].sort((a, b) => a - b)).toEqual(firstJobAttempts);
  }, 30_000);

  it('a superseded run cannot overwrite the resumed attempt', async () => {
    const root = makeTempDir('aethera-supersede-');
    const calls: AbortSignal[] = [];
    const pipeline = new StagedCinemaPipeline({
      jobsDir: join(root, 'jobs'),
      mediaDir: join(root, 'media'),
      outputDir: join(root, 'renders'),
      evolutionCore: new AetheraEvolutionCore(join(root, 'evolution.json')),
      onPackageReady: () => {},
      onRenderReady: () => {},
      runEditorialResearch: researchUntilAborted(calls) as never,
    });
    const first = pipeline.start({ projectId: 'proj_2', prompt: 'Hollow Knight', targetDurationSec: 10 });
    await waitUntil(() => calls.length === 1);
    // Resume WITHOUT cancelling: runOrResume aborts attempt 1, which unwinds while attempt 2 runs.
    const second = pipeline.resume('proj_2');
    await first;
    await waitUntil(() => calls.length === 2);
    expect(pipeline.loadJob('proj_2')).toMatchObject({ attempt: 2, state: 'pesquisa' });
    pipeline.cancel('proj_2');
    expect((await second).state).toBe('cancelled');
  }, 30_000);
});

async function waitUntil(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeoutMs) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 10));
  }
}
