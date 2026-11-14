import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { AetheraEvolutionCore, type CinemaProductionPackage, type RealRenderResult } from '../../../packages/cinema/src/index.js';
import { StagedCinemaPipeline } from '../src/main/cinema-pipeline.js';

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('StagedCinemaPipeline — Research Gate, Cancel/Resume & Full Assembly', () => {
  it('pauses in paused_pending_media when real media is missing and completes full pipeline once authorized', async () => {
    const root = makeTempDir('aethera-staged-');
    const evolutionCore = new AetheraEvolutionCore(join(root, 'evolution.json'));
    let savedPkg: CinemaProductionPackage | undefined;
    let savedRender: RealRenderResult | undefined;

    const pipeline = new StagedCinemaPipeline({
      jobsDir: join(root, 'jobs'),
      mediaDir: join(root, 'media'),
      outputDir: join(root, 'renders'),
      evolutionCore,
      onPackageReady: (pkg) => {
        savedPkg = pkg;
      },
      onRenderReady: (_id, render) => {
        savedRender = render;
      },
      acquireExternalMedia: async () => null,
    });

    const paused = await pipeline.start({
      projectId: 'staged_01',
      prompt: 'Cena 1 montanha, Cena 2 oceano, Cena 3 cidade, Cena 4 floresta',
      targetDurationSec: 12,
      humorIntensity: 35,
      renderProfile: 'draft_540p',
      useNvenc: false,
    });

    expect(paused.state).toBe('paused_pending_media');
    expect(paused.pendingMedia.length).toBe(4);
    expect(savedPkg).toBeUndefined();

    const completed = await pipeline.resolvePendingMedia(
      'staged_01',
      paused.pendingMedia.map((s) => ({ slotIndex: s.slotIndex, allowProcedural: true })),
    );

    expect(completed.state).toBe('editor');
    expect(completed.progressPct).toBe(100);
    expect(completed.completedStages).toContain('pesquisa');
    expect(completed.completedStages).toContain('aquisicao');
    expect(completed.completedStages).toContain('montagem');
    expect(completed.completedStages).toContain('previa');
    expect(savedPkg).toBeDefined();
    expect(savedRender?.probe.videoCodec).toBeTruthy();
    expect(savedRender?.probe.audioCodec).toBeTruthy();
  }, 60_000);

  it('supports cancel and resume without losing acquired media checkpoint', async () => {
    const root = makeTempDir('aethera-cancel-');
    const evolutionCore = new AetheraEvolutionCore(join(root, 'evolution.json'));

    const pipeline = new StagedCinemaPipeline({
      jobsDir: join(root, 'jobs'),
      mediaDir: join(root, 'media'),
      outputDir: join(root, 'renders'),
      evolutionCore,
      onPackageReady: () => {},
      onRenderReady: () => {},
      acquireExternalMedia: async () => null,
    });

    await pipeline.start({
      projectId: 'cancel_01',
      prompt: 'Teste cancelamento e retomada',
      targetDurationSec: 12,
      renderProfile: 'draft_540p',
      useNvenc: false,
    });

    const cancelled = pipeline.cancel('cancel_01');
    expect(cancelled?.state).toBe('cancelled');

    const resumed = await pipeline.resume('cancel_01');
    expect(resumed.state).toBe('paused_pending_media');
    expect(resumed.pendingMedia.length).toBeGreaterThan(0);
  });
});
