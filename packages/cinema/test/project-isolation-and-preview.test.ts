import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AetheraEvolutionCore,
  produceCinemaPackage,
  renderRealCinemaMp4,
  validateScriptAndBreakdown,
  type CinemaProductionPackage,
} from '../src/index.js';
import { CinemaSmartCache } from '../../../apps/aethera-desktop/src/main/cinema-cache.js';
import { StagedCinemaPipeline } from '../../../apps/aethera-desktop/src/main/cinema-pipeline.js';

const tempRoots: string[] = [];

function makeTempRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

afterEach(() => {
  while (tempRoots.length > 0) {
    const dir = tempRoots.pop();
    if (dir && existsSync(dir)) {
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch {
        // ignore transient Windows handle locks during temp cleanup
      }
    }
  }
});

describe('Project Isolation, Smart Cache, Proportional Script & Full-Length Preview', () => {
  it('generates proportional script, breakdown, and validation for a 12-minute (720s) video', () => {
    const pkg = produceCinemaPackage({
      projectId: 'elden_12min',
      prompt:
        'Crie um vídeo cinematográfico sobre os 10 chefes mais difíceis de Elden Ring, com narrativa épica, humor pontual e duração de 12 minutos.',
      genre: 'gameplay_essay',
      format: 'youtube_16_9',
      targetDurationSec: 720,
      humorIntensity: 35,
    });

    expect(pkg.direction.narrativeBeats.length).toBeGreaterThanOrEqual(12);
    expect(pkg.direction.shots.length).toBe(pkg.direction.narrativeBeats.length);
    expect(pkg.scriptValidation.valid).toBe(true);
    expect(pkg.scriptValidation.coveredTimelineSec).toBeGreaterThanOrEqual(715);
    expect(pkg.scriptValidation.estimatedNarrationSec).toBeGreaterThanOrEqual(400);

    // A short 6-beat stub must NOT pass validation for a 720s video
    const stubValidation = validateScriptAndBreakdown({
      ...pkg.direction,
      treatment: 'Resumo curto.',
      narrativeBeats: pkg.direction.narrativeBeats.slice(0, 6).map((b) => ({
        ...b,
        summary: 'Texto curto.',
      })),
    });
    expect(stubValidation.valid).toBe(false);
    expect(stubValidation.warnings.length).toBeGreaterThan(0);
  });

  it('isolates projects, always runs contextual search even with cache populated, and deletes only exclusive files while preserving shared cache and global library', async () => {
    const root = makeTempRoot('aethera-isolation-');
    const jobsDir = join(root, 'cinema-jobs');
    const globalMediaDir = join(root, 'cinema-media');
    const outputDir = join(root, 'cinema-renders');
    const workspacesDir = join(root, 'cinema-workspaces');
    const cacheDir = join(root, 'cinema-cache');
    const libraryDir = join(root, 'cinema-library');
    const cinemaProjectsDir = join(root, 'cinema-projects');
    const externalDir = join(root, 'external-user-files');

    mkdirSync(globalMediaDir, { recursive: true });
    mkdirSync(libraryDir, { recursive: true });
    mkdirSync(cinemaProjectsDir, { recursive: true });
    mkdirSync(externalDir, { recursive: true });

    // Pre-populate legacy global cinema-media with a file from an unrelated topic
    const legacyFile = join(globalMediaDir, 'unrelated_old_project.png');
    writeFileSync(legacyFile, Buffer.from('fake-png-data-unrelated'));

    // Global library asset that must NEVER be deleted
    const globalSfxFile = join(libraryDir, 'epic_hit_sfx.wav');
    writeFileSync(globalSfxFile, Buffer.from('global-sfx-content'));

    // External user file that must NEVER be deleted
    const externalUserFile = join(externalDir, 'user_original.png');
    writeFileSync(externalUserFile, Buffer.from('external-user-content'));

    const searchCalls: Array<{ query: string; slotIndex: number }> = [];
    const packages = new Map<string, CinemaProductionPackage>();
    const evolutionCore = new AetheraEvolutionCore(join(root, 'evolution.json'));

    const pipeline = new StagedCinemaPipeline({
      jobsDir,
      mediaDir: globalMediaDir,
      outputDir,
      workspacesDir,
      cacheDir,
      libraryDir,
      cinemaProjectsDir,
      evolutionCore,
      onPackageReady: (pkg) => {
        packages.set(pkg.timeline.projectId, pkg);
        writeFileSync(join(cinemaProjectsDir, `${pkg.timeline.projectId}.json`), JSON.stringify(pkg), 'utf8');
      },
      onRenderReady: () => {},
      searchExternalMedia: async (query, slotIndex) => {
        searchCalls.push({ query, slotIndex });
        if (/elden ring/i.test(query)) {
          return [{ url: `https://example.com/elden_${slotIndex}.png`, title: query, origin: 'test_search', license: 'cc' }];
        }
        return [{ url: `https://example.com/astro_${slotIndex}.png`, title: query, origin: 'test_search', license: 'cc' }];
      },
      acquireExternalMedia: async (query, slotIndex, targetMediaDir) => {
        const out = join(targetMediaDir, `acq_${slotIndex + 1}.png`);
        writeFileSync(out, Buffer.from(`media-for-${query}-${slotIndex}`));
        return out;
      },
    });

    // Run Project A (Elden Ring) - note: test stops before FFmpeg render by inspecting up to aquisicao or running with seed
    // To keep test fast & deterministic without requiring FFmpeg on tiny dummy PNGs, we test search + cache + isolation directly via start & inspect:
    const jobA = await pipeline.start({
      projectId: 'proj_elden',
      prompt: 'Documentário sobre chefes de Elden Ring',
      targetDurationSec: 36,
    }).catch(() => pipeline.loadJob('proj_elden'));

    const jobB = await pipeline.start({
      projectId: 'proj_astro',
      prompt: 'Documentário sobre buracos negros na astronomia',
      targetDurationSec: 36,
    }).catch(() => pipeline.loadJob('proj_astro'));

    if (!jobA || !jobB) throw new Error('Expected jobs to be persisted');

    // 1. Contextual search ran for BOTH projects (4 queries each = 8 calls), never skipped!
    expect(searchCalls.length).toBeGreaterThanOrEqual(8);
    expect(searchCalls.some((c) => /elden ring/i.test(c.query))).toBe(true);
    expect(searchCalls.some((c) => /buracos negros|astronomia/i.test(c.query))).toBe(true);

    // 2. Neither project picked up legacyFile from global cinema-media
    expect(jobA.acquiredMedia.every((m) => m.uri !== legacyFile)).toBe(true);
    expect(jobB.acquiredMedia.every((m) => m.uri !== legacyFile)).toBe(true);

    // 3. Each project has its own isolated workspace and acquired media inside it
    const pathsA = pipeline.getProjectPaths('proj_elden');
    const pathsB = pipeline.getProjectPaths('proj_astro');
    expect(pathsA.root).not.toBe(pathsB.root);
    expect(existsSync(pathsA.mediaDir)).toBe(true);
    expect(existsSync(pathsB.mediaDir)).toBe(true);
    expect(jobA.acquiredMedia.every((m) => m.uri.startsWith(pathsA.root))).toBe(true);
    expect(jobB.acquiredMedia.every((m) => m.uri.startsWith(pathsB.root))).toBe(true);

    // 4. Shared cache preservation test: register a shared cache entry consumed by proj_elden AND proj_astro
    const sharedSource = join(pathsA.mediaDir, 'acq_1.png');
    const sharedCacheEntry = pipeline.cache.registerConsumer({
      url: 'https://example.com/shared_cinematic.png',
      origin: 'test_search',
      license: 'cc',
      topic: 'cinematic reference',
      query: 'cinematic',
      sourceFilePath: sharedSource,
      width: 1920,
      height: 1080,
      durationSec: 6,
      projectId: 'proj_elden',
    });
    pipeline.cache.registerConsumer({
      url: 'https://example.com/shared_cinematic.png',
      origin: 'test_search',
      license: 'cc',
      topic: 'cinematic reference',
      query: 'cinematic',
      sourceFilePath: sharedSource,
      width: 1920,
      height: 1080,
      durationSec: 6,
      projectId: 'proj_astro',
    });
    expect(existsSync(sharedCacheEntry.filePath)).toBe(true);

    // Inspect deletion before deleting
    const inspection = pipeline.inspectProjectDeletion('proj_elden');
    expect(inspection.preservedGlobalLibrary).toBe(true);
    expect(inspection.sharedCacheEntriesPreserved).toBe(1);
    expect(inspection.itemsToRemove.length).toBeGreaterThanOrEqual(3);

    // Delete proj_elden
    const delA = pipeline.deleteJob('proj_elden');
    expect(delA.deleted).toBe(true);
    expect(delA.preservedSharedEntries).toBe(1);

    // Assert proj_elden workspace and job/project files are gone
    expect(existsSync(pathsA.root)).toBe(false);
    expect(existsSync(join(jobsDir, 'proj_elden.job.json'))).toBe(false);
    expect(existsSync(join(cinemaProjectsDir, 'proj_elden.json'))).toBe(false);

    // Assert proj_astro, global library, external user file, and shared cache file are ALL intact!
    expect(existsSync(pathsB.root)).toBe(true);
    expect(existsSync(globalSfxFile)).toBe(true);
    expect(existsSync(externalUserFile)).toBe(true);
    expect(existsSync(sharedCacheEntry.filePath)).toBe(true);

    // Now delete proj_astro -> unreferenced cache entry should be cleaned up, while library & external remain intact
    pipeline.deleteJob('proj_astro');
    expect(existsSync(pathsB.root)).toBe(false);
    expect(existsSync(sharedCacheEntry.filePath)).toBe(false);
    expect(existsSync(globalSfxFile)).toBe(true);
    expect(existsSync(externalUserFile)).toBe(true);
  }, 60_000);

  it('rejects cache reuse when topic is inadequate even if file exists', () => {
    const root = makeTempRoot('aethera-cache-topic-');
    const cache = new CinemaSmartCache(join(root, 'cache'));
    const mediaFile = join(root, 'elden_boss.mp4');
    writeFileSync(mediaFile, Buffer.from('dummy-video-bytes'));

    cache.registerConsumer({
      url: 'https://example.com/elden_malenia.mp4',
      origin: 'yt_dlp',
      license: 'cc',
      topic: 'Elden Ring Malenia Boss Fight',
      query: 'elden ring malenia',
      sourceFilePath: mediaFile,
      width: 1280,
      height: 720,
      durationSec: 20,
      projectId: 'proj_1',
    });

    // Adequate topic -> cache hit
    expect(
      cache.findVerifiedMatch({
        url: 'https://example.com/elden_malenia.mp4',
        topic: 'chefes de Elden Ring',
      }),
    ).not.toBeNull();

    // Unrelated topic -> rejected even with same URL
    expect(
      cache.findVerifiedMatch({
        url: 'https://example.com/elden_malenia.mp4',
        topic: 'receita de bolo de chocolate',
      }),
    ).toBeNull();
  });

  it('renders full-length preview without 8-clip cap and explicitly marks technical samples', async () => {
    const root = makeTempRoot('aethera-full-preview-');
    const pkg = produceCinemaPackage({
      projectId: 'full_preview_10clips',
      prompt: 'Documentário completo sobre os 10 planetas e luas do sistema solar',
      genre: 'documentary',
      format: 'youtube_16_9',
      targetDurationSec: 400, // produces >= 10 clips!
      humorIntensity: 0,
    });

    // Ensure at least 10 primary clips and mark procedural authorized for fast self-contained render
    expect(pkg.timeline.clips.length).toBeGreaterThanOrEqual(10);
    const totalClips = pkg.timeline.clips.length;
    const pkgProcedural: CinemaProductionPackage = {
      ...pkg,
      timeline: {
        ...pkg.timeline,
        clips: pkg.timeline.clips.map((c) => ({
          ...c,
          timelineRange: {
            ...c.timelineRange,
            duration: { value: 45, rate: 30 }, // 1.5s per clip so 10+ clips render quickly in test
          },
          effects: [
            ...c.effects,
            {
              effectId: `allow_${c.clipId}`,
              kind: 'allow_procedural',
              params: { authorized: true },
              enabled: true,
              estimatedCostMs: 0,
              fallbackMode: 'skip',
            },
          ],
        })),
      },
    };

    // 1. Technical sample mode must explicitly flag isTechnicalSample
    const sampleRes = await renderRealCinemaMp4({
      pkg: pkgProcedural,
      outputDir: join(root, 'sample'),
      fileName: 'sample.mp4',
      requireRealMedia: false,
      technicalSampleMaxClips: 2,
      previewQuality: 'fast_preview',
    });
    expect(sampleRes.isTechnicalSample).toBe(true);
    expect(sampleRes.sampleLabel).toMatch(/AMOSTRA TÉCNICA/i);
    expect(sampleRes.renderedHeadlines?.length).toBe(2);

    // 2. Full preview mode must render ALL clips (> 8), never capped at 8!
    const fullRes = await renderRealCinemaMp4({
      pkg: pkgProcedural,
      outputDir: join(root, 'full'),
      fileName: 'full.mp4',
      requireRealMedia: false,
      previewQuality: 'fast_preview',
    });
    expect(fullRes.isTechnicalSample).toBe(false);
    expect(fullRes.sampleLabel).toBeUndefined();
    expect(fullRes.renderedHeadlines?.length).toBe(totalClips);
    expect(fullRes.probe.durationSec).toBeGreaterThan(totalClips * 1.0);
  }, 60_000);
});
