import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AetheraEvolutionCore,
  evaluateMediaRelevance,
  evaluateRenderedVisualCritic,
  extractVerificationFrames,
  renderRealCinemaMp4,
  type DistributedFrameAnalysis,
  type ScriptSegmentExpectation,
} from '@neuralbridge/cinema';
import { VisionRouter, type VisualAnalysisProvider } from '@neuralbridge/orchestrator';
import { StagedCinemaPipeline } from '../src/main/cinema-pipeline.js';

describe('Scene Grounding Real E2E Integration Audit', () => {
  it('validates acquisition -> distributed frame VisionRouter -> coverage -> MP4 trim -> incremental regen -> Visual Critic', async () => {
    const workRoot = join(tmpdir(), `aethera-grounding-e2e-${Date.now()}`);
    const mediaSourceDir = join(workRoot, 'source-library');
    const positiveMediaSourceDir = join(workRoot, 'positive-source-library');
    const framesDir = join(workRoot, 'extracted-frames');
    mkdirSync(mediaSourceDir, { recursive: true });
    mkdirSync(positiveMediaSourceDir, { recursive: true });
    mkdirSync(framesDir, { recursive: true });

    try {
      // 1. Gerar clipes MP4 reais no disco via FFmpeg (com timestamps e conteúdos distintos)
      const gokuClip = join(mediaSourceDir, 'dbz_goku_ssj_namek.mp4');
      const vegetaClip = join(mediaSourceDir, 'dbz_vegeta_vs_zarbon.mp4');
      const personClip = join(mediaSourceDir, 'podcast_pessoa_real.mp4');

      // Clipe 1 (24s): 0-10s azul (Namek), 10-24s dourado (Super Saiyajin)
      execFileSync(
        'ffmpeg',
        [
          '-y',
          '-f', 'lavfi', '-i', 'color=c=0x1e3a8a:s=640x360:d=10',
          '-f', 'lavfi', '-i', 'color=c=0xfacc15:s=640x360:d=14',
          '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
          '-map', '[v]', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', gokuClip,
        ],
        { stdio: 'pipe' },
      );

      // Clipe 2 (16s): verde (Vegeta vs Zarbon)
      execFileSync(
        'ffmpeg',
        [
          '-y', '-f', 'lavfi', '-i', 'color=c=0x166534:s=640x360:d=16',
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', vegetaClip,
        ],
        { stdio: 'pipe' },
      );

      // Clipe 3 (12s): vermelho (Podcast pessoa real)
      execFileSync(
        'ffmpeg',
        [
          '-y', '-f', 'lavfi', '-i', 'color=c=0x991b1b:s=640x360:d=12',
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', personClip,
        ],
        { stdio: 'pipe' },
      );

      // 2. Fallback de provedor único no VisionRouter (claude offline -> apenas codex ativo)
      const visionCache = new Map<string, unknown>();
      const unavailableClaude: VisualAnalysisProvider = {
        id: 'claude',
        model: 'sonnet',
        capabilities: ['analyze', 'describe'],
        limits: { maxImagesPerCall: 4 },
        detect: async () => ({ available: false, reason: 'claude cli offline' }),
      };
      const singleCodexProvider: VisualAnalysisProvider = {
        id: 'codex',
        model: 'gpt-5-codex',
        capabilities: ['analyze', 'describe'],
        limits: { maxImagesPerCall: 4, costPerImageUsd: 0 },
        detect: async () => ({ available: true }),
        analyze: async ({ frames, context }) => {
          const f = frames[0]!;
          const isGokuSsj = f.path.includes('goku') && (f.atMs ?? 0) >= 9000;
          const isGokuBase = f.path.includes('goku') && (f.atMs ?? 0) < 9000;
          const isVegeta = f.path.includes('vegeta');
          return {
            schemaVersion: 1,
            nature: isGokuSsj || isGokuBase || isVegeta ? 'action' : 'portrait',
            natureConfidence: 0.93,
            description: isGokuSsj
              ? 'Anime Dragon Ball Z: Goku se transforma em Super Saiyajin após morte de Kuririn em Namek'
              : isGokuBase
                ? 'Anime Dragon Ball Z: cenário de Namek antes da transformação'
                : isVegeta
                  ? 'Anime Dragon Ball Z: Vegeta enfrenta Zarbon em Namek'
                  : 'Pessoa real em estúdio de podcast',
            frames: [{ atMs: f.atMs ?? 0, observed: 'quadro analisado', visibleText: [] }],
            entities: isGokuSsj
              ? [
                  { name: 'goku', type: 'character', basis: 'observed', evidence: 'aura dourada SSJ', confidence: 0.95 },
                  { name: 'super saiyajin', type: 'other', basis: 'observed', evidence: 'cabelo dourado', confidence: 0.94 },
                  { name: 'kuririn', type: 'character', basis: 'inferred', evidence: 'Namek', confidence: 0.88 },
                ]
              : isGokuBase
                ? [{ name: 'dragon ball', type: 'work', basis: 'observed', evidence: 'anime Namek', confidence: 0.86 }]
                : isVegeta
                  ? [
                      { name: 'vegeta', type: 'character', basis: 'observed', evidence: 'armadura', confidence: 0.91 },
                      { name: 'zarbon', type: 'character', basis: 'observed', evidence: 'Freeza force', confidence: 0.9 },
                    ]
                  : [{ name: 'apresentador', type: 'person', basis: 'observed', evidence: 'câmera real', confidence: 0.96 }],
            actions: isGokuSsj
              ? [{ description: 'transformacao', basis: 'observed', confidence: 0.94 }]
              : isVegeta
                ? [{ description: 'batalha_confronto', basis: 'observed', confidence: 0.9 }]
                : [],
            environment: { description: context ?? 'cena', basis: 'observed', confidence: 0.9 },
            overlays: { burnedText: false, watermark: false, webcam: !isGokuSsj && !isGokuBase && !isVegeta },
            limitations: [],
            confidence: 0.92,
          };
        },
      };

      const router = new VisionRouter([unavailableClaude, singleCodexProvider], {
        get: (k) => visionCache.get(JSON.stringify(k)),
        put: (k, v) => visionCache.set(JSON.stringify(k), v),
      });

      const analyzeFramesViaVisionRouter = async (
        uri: string,
        timestampsSec: number[],
        segment: ScriptSegmentExpectation,
      ): Promise<DistributedFrameAnalysis[]> => {
        const tag = uri.includes('goku') ? 'goku' : uri.includes('vegeta') ? 'vegeta' : 'person';
        const outDir = join(framesDir, `${tag}_${segment.segmentId}`);
        mkdirSync(outDir, { recursive: true });
        const extracted = await extractVerificationFrames(uri, outDir, timestampsSec);
        const out: DistributedFrameAnalysis[] = [];
        for (let i = 0; i < extracted.length; i += 1) {
          const fp = extracted[i]!;
          const ts = timestampsSec[i] ?? 0;
          const hash = createHash('sha256').update(readFileSync(fp)).digest('hex');
          const res = await router.analyze({
            frames: [{ path: fp, hash, atMs: Math.round(ts * 1000) }],
            context: segment.narrationText,
            policy: {
              schemaVersion: 1,
              task: 'describe',
              chain: ['claude', 'codex'],
              scope: 'project',
              thresholds: null,
              version: 'e2e-audit-v1',
              budgetUsd: 1,
              maxLatencyMs: 10000,
            },
          });
          if (!res.value || res.provider === 'ffmpeg-heuristics') continue;
          const desc = res.value.description.toLowerCase();
          out.push({
            timestampSec: ts,
            visualCategory: desc.includes('anime') ? 'anime_animation' : 'real_person_camera',
            detectedEntities: res.value.entities.map((e) => e.name.toLowerCase()),
            detectedActions: res.value.actions.map((a) => a.description.toLowerCase()),
            description: `${res.provider}: ${res.value.description}`,
            confidence: res.value.confidence,
          });
        }
        return out;
      };

      // 3. Sem visão disponível: não inventa evidências nem aprova por metadados
      const noVisionDecision = await evaluateMediaRelevance(
        {
          mediaId: 'no_vision_probe',
          uri: gokuClip,
          title: 'Dragon Ball Z Goku Super Saiyajin',
          origin: 'local_library',
          durationSec: 24,
        },
        {
          segmentId: 'seg_1',
          prompt: 'Dragon Ball Z Saga Namek',
          narrationText: 'A morte de Kuririn desperta a transformação de Goku em Super Saiyajin.',
          genre: 'anime',
          expectedEntities: ['goku', 'kuririn', 'super saiyajin'],
        },
        {
          analyzeFrames: async () => [],
          requireVisualVerification: true,
        },
      );
      expect(noVisionDecision.accepted).toBe(false);
      expect(noVisionDecision.visualVerificationStatus).toBe('unverified_metadata_only');
      expect(noVisionDecision.rejectionCode).toBe('unverified_no_visual_evidence');

      // 4. Caso negativo: a aquisição encontra contexto, mas a cobertura comprovada é insuficiente.
      const evolutionCore = new AetheraEvolutionCore(join(workRoot, 'evolution.json'));
      let latestPkg: any;
      let latestRender: any;

      const pipeline = new StagedCinemaPipeline({
        jobsDir: join(workRoot, 'jobs'),
        mediaDir: join(workRoot, 'media'),
        outputDir: join(workRoot, 'renders'),
        workspacesDir: join(workRoot, 'workspaces'),
        cacheDir: join(workRoot, 'cache'),
        libraryDir: join(workRoot, 'library'),
        evolutionCore,
        requireVisualVerification: true,
        analyzeFrames: analyzeFramesViaVisionRouter,
        autonomousAcquisitionDeps: {
          localMediaDirs: [mediaSourceDir],
          fetchImpl: (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch,
        },
        onPackageReady: (pkg) => {
          latestPkg = pkg;
        },
        onRenderReady: (_id, render) => {
          latestRender = render;
        },
      });

      const job = await pipeline.start({
        projectId: 'e2e_dbz_grounding',
        prompt: 'Dragon Ball Z Saga Namek: transformação de Goku em Super Saiyajin',
        genre: 'documentary',
        targetDurationSec: 32,
        humorIntensity: 0,
        renderProfile: 'draft_540p',
        useNvenc: false,
      });

      expect(job.state).toBe('paused_pending_media');
      expect(job.autonomousAudit).toBeDefined();
      expect(job.acquiredMedia.length).toBeGreaterThan(0);
      expect(job.mediaRelevanceDecisions?.some((d) => d.visualVerificationStatus === 'visually_verified')).toBe(true);
      expect(job.coverageReport?.coverageRatio ?? 1).toBeLessThan(0.8);
      expect(job.pendingMedia.length).toBeGreaterThan(0);
      expect(job.pendingMedia.some((slot) => (slot.uncoveredIntervals?.length ?? 0) > 0)).toBe(true);
      expect(job.autonomousAudit?.recoveryAttempts.length).toBeGreaterThan(0);
      expect(job.autonomousAudit?.affectedSegmentIds.length).toBeGreaterThan(0);
      expect(latestRender).toBeUndefined();

      const resumedNegative = await pipeline.resume('e2e_dbz_grounding');
      expect(resumedNegative.state).toBe('paused_pending_media');
      expect(resumedNegative.acquiredMedia.length).toBe(job.acquiredMedia.length);
      expect(resumedNegative.pendingMedia.length).toBeGreaterThan(0);
      expect(resumedNegative.autonomousAudit?.coverageReport.recoveryGaps.length).toBeGreaterThan(0);

      // 5. Caso positivo: uma fonte local com todos os frames visualmente comprovados chega ao Editor e renderiza MP4.
      const positiveClip = join(positiveMediaSourceDir, 'dragon_ball_z_goku_super_saiyajin_verified.mp4');
      execFileSync(
        'ffmpeg',
        [
          '-y', '-f', 'lavfi', '-i', 'color=c=0xfacc15:s=640x360:d=12',
          '-c:v', 'libx264', '-pix_fmt', 'yuv420p', positiveClip,
        ],
        { stdio: 'pipe' },
      );
      const positiveAnalyzeFrames = async (
        _uri: string,
        timestampsSec: number[],
      ): Promise<DistributedFrameAnalysis[]> => timestampsSec.map((timestampSec) => ({
        timestampSec,
        visualCategory: 'anime_animation' as const,
        detectedEntities: ['dragon ball z', 'goku', 'super saiyajin'],
        detectedActions: ['transformacao'],
        description: 'Footage de anime: Goku libera a transformação em Super Saiyajin durante o confronto.',
        confidence: 0.96,
      }));
      const positivePipeline = new StagedCinemaPipeline({
        jobsDir: join(workRoot, 'positive-jobs'),
        mediaDir: join(workRoot, 'positive-media'),
        outputDir: join(workRoot, 'positive-renders'),
        workspacesDir: join(workRoot, 'positive-workspaces'),
        cacheDir: join(workRoot, 'positive-cache'),
        libraryDir: join(workRoot, 'positive-library'),
        evolutionCore,
        requireVisualVerification: true,
        analyzeFrames: positiveAnalyzeFrames,
        autonomousAcquisitionDeps: {
          localMediaDirs: [positiveMediaSourceDir],
          fetchImpl: (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch,
        },
        generateAgentScript: async () => ({
          treatment: 'Cena comprovada de transformação em Namek.',
          beats: [{ stage: 'climax' as const, summary: 'Goku libera a transformação em Super Saiyajin durante o confronto em Namek.' }],
        }),
        onPackageReady: (pkg) => {
          latestPkg = pkg;
        },
        onRenderReady: (_id, render) => {
          latestRender = render;
        },
      });
      const positiveJob = await positivePipeline.start({
        projectId: 'e2e_dbz_grounding_positive',
        prompt: 'Dragon Ball Z Goku Super Saiyajin: transformação em Namek',
        genre: 'documentary',
        targetDurationSec: 8,
        humorIntensity: 0,
        renderProfile: 'draft_540p',
        useNvenc: false,
      });

      expect(positiveJob.state).toBe('editor');
      expect(positiveJob.autonomousAudit?.coverageReport.gatePassed).toBe(true);
      expect(positiveJob.autonomousAudit?.approvedForAssemblyCount).toBeGreaterThan(0);
      expect(positiveJob.mediaRelevanceDecisions?.some((d) => d.assemblyEligible === true)).toBe(true);
      expect(positiveJob.autonomousAudit?.recoveryAttempts.some((attempt) => attempt.outcome === 'verified_interval')).toBe(true);
      expect(latestRender?.mp4Path).toBeTruthy();
      expect(existsSync(latestRender.mp4Path)).toBe(true);

      // 6. Preservação de cache incremental ao regenerar apenas 1 cena
      const secondRender = await renderRealCinemaMp4({
        pkg: {
          ...latestPkg,
          timeline: {
            ...latestPkg.timeline,
            clips: latestPkg.timeline.clips.map((c: any, idx: number) =>
              c.trackId === 'v1' && idx === 0 ? { ...c, label: 'Cena 1 Editada' } : c,
            ),
          },
        },
        outputDir: join(workRoot, 'renders-regen'),
        fileName: 'e2e_dbz_grounding_regen.mp4',
        useNvenc: false,
        requireRealMedia: true,
        evolution: evolutionCore,
        prompt: positiveJob.prompt,
        genre: 'documentary',
        previewQuality: 'fast_preview',
        segmentCacheDir: join(positiveJob.workspaceDir!, 'temp', 'segment-cache'),
      });
      expect(secondRender.incrementalRenderStats?.cacheHits ?? 0).toBeGreaterThan(0);
      expect(secondRender.incrementalRenderStats?.reRenderedScenes).toBe(1);

      // 7. Visual Critic no MP4 final
      const criticReport = await evaluateRenderedVisualCritic({
        projectId: 'e2e_dbz_grounding_positive',
        mp4Path: latestRender.mp4Path,
        framesDir: join(workRoot, 'critic-check'),
        prompt: positiveJob.prompt,
        genre: 'documentary',
        ...(positiveJob.mediaRelevanceDecisions ? { mediaRelevanceDecisions: positiveJob.mediaRelevanceDecisions } : {}),
        ...(positiveJob.coverageReport ? { coverageReport: positiveJob.coverageReport } : {}),
        scenes: latestPkg.timeline.clips
          .filter((c: any) => c.trackId === 'v1')
          .map((c: any) => ({
            sceneId: c.clipId,
            startSec: c.timelineRange.start.value / c.timelineRange.start.rate,
            durationSec: c.timelineRange.duration.value / c.timelineRange.duration.rate,
            sourceMediaId: c.mediaId,
          })),
      });
      expect(criticReport.sampledFrames.length).toBeGreaterThan(0);
      expect(criticReport.technicalRenderCompleted).toBe(true);

      console.log(
        '[SCENE_GROUNDING_E2E_EVIDENCE]',
        JSON.stringify({
          acquiredMedia: positiveJob.acquiredMedia.map((m) => ({ mediaId: m.mediaId, uri: m.uri })),
          relevanceDecisions: positiveJob.mediaRelevanceDecisions?.map((d) => ({
            mediaId: d.mediaId,
            accepted: d.accepted,
            correspondenceLevel: d.correspondenceLevel,
            visualVerificationStatus: d.visualVerificationStatus,
            sampledTimestampsSec: d.sampledTimestampsSec,
            matchedIntervals: d.matchedIntervals,
            eligibleSegmentIds: d.eligibleSegmentIds,
            rejectionCode: d.rejectionCode,
          })),
          timelineV1Clips: latestPkg.timeline.clips
            .filter((c: any) => c.trackId === 'v1')
            .map((c: any) => ({
              clipId: c.clipId,
              mediaId: c.mediaId,
              sourceStartSec: Number((c.sourceRange.start.value / c.sourceRange.start.rate).toFixed(2)),
            })),
          render1: latestRender.incrementalRenderStats,
          render2TargetedRegen: secondRender.incrementalRenderStats,
          critic: {
            passed: criticReport.passed,
            sampledFramesCount: criticReport.sampledFrames.length,
            findingsCount: criticReport.findings.length,
          },
        }),
      );
    } finally {
      rmSync(workRoot, { recursive: true, force: true });
    }
  }, 120_000);
});
