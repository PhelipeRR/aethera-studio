import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AetheraEvolutionCore,
  detectMediaAnomalies,
  evaluateRenderedVisualCritic,
  matchNarrationSegmentsToMedia,
  produceCinemaPackage,
  recordProductionCorrectionLesson,
  renderRealCinemaMp4,
  resolveLearnedSceneConstraints,
  runAutonomousSupervisorPass,
  runRealMediaQc,
  probeRealMp4,
} from '../src/index.js';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aethera-evo2-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('Aethera Studio Evolution 2.0 (Etapas A, B, C)', () => {
  it('Etapa A1: detects black frames and prolonged silence via FFmpeg blackdetect/silencedetect', async () => {
    const dir = createTempDir();
    const defectVideo = join(dir, 'defect.mp4');
    // 1.5s solid black + 2.0s silence
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=320x180:r=24:d=2',
      '-f',
      'lavfi',
      '-i',
      'anullsrc=r=16000:cl=mono:d=2',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      defectVideo,
    ]);

    const probe = await probeRealMp4(defectVideo);
    const anomalies = await detectMediaAnomalies(defectVideo, {
      minBlackSec: 0.4,
      minSilenceSec: 1.0,
      minFreezeSec: 1.5,
    });
    expect(anomalies.blackIntervals.length).toBeGreaterThan(0);
    expect(anomalies.silenceIntervals.length).toBeGreaterThan(0);

    const findings = runRealMediaQc(probe, -14.0, anomalies);
    expect(findings.some((f) => f.issueId.startsWith('real_qc_black_interval_'))).toBe(true);
    expect(findings.some((f) => f.issueId.startsWith('real_qc_silence_interval_'))).toBe(true);
  });

  it('Etapa A2: performs incremental scene-level render caching across consecutive renders', async () => {
    const dir = createTempDir();
    const segCacheDir = join(dir, 'segment-cache');
    const pkg = produceCinemaPackage({
      prompt: 'Mini documentário sobre exploração espacial em 1 minuto',
      genre: 'documentary',
      format: 'youtube_16_9',
      targetDurationSec: 12,
      humorIntensity: 20,
    });

    // Limit to 2 scenes for fast deterministic test render
    pkg.timeline.clips = pkg.timeline.clips.slice(0, 2);

    const first = await renderRealCinemaMp4({
      pkg,
      outputDir: join(dir, 'render-1'),
      previewQuality: 'fast_preview',
      segmentCacheDir: segCacheDir,
    });
    expect(existsSync(first.mp4Path)).toBe(true);
    expect(first.incrementalRenderStats?.cacheHits).toBe(0);
    expect(first.incrementalRenderStats?.reRenderedScenes).toBe(2);

    const second = await renderRealCinemaMp4({
      pkg,
      outputDir: join(dir, 'render-2'),
      previewQuality: 'fast_preview',
      segmentCacheDir: segCacheDir,
    });
    expect(existsSync(second.mp4Path)).toBe(true);
    expect(second.incrementalRenderStats?.cacheHits).toBe(2);
    expect(second.incrementalRenderStats?.reRenderedScenes).toBe(0);
  }, 30000);

  it('Etapa B: semantically matches timestamped narration segments to specific video clips', () => {
    const matches = matchNarrationSegmentsToMedia(
      [
        {
          segmentId: 'seg_1',
          startSec: 0,
          endSec: 6,
          text: 'Quando Malenia inicia seu ataque giratório Waterfowl Dance, o jogador precisa desviar no tempo exato.',
        },
        {
          segmentId: 'seg_2',
          startSec: 6,
          endSec: 12,
          text: 'Já na segunda fase de Radahn, o meteoro cai do céu com impacto devastador.',
        },
      ],
      [
        {
          mediaId: 'clip_limgrave',
          title: 'Passeio inicial em Limgrave',
          tags: ['limgrave', 'paisagem', 'inicio'],
          sceneSummary: 'Personagem cavalgando em campo aberto',
          durationSec: 10,
        },
        {
          mediaId: 'clip_radahn',
          title: 'Radahn fase dois meteoro',
          tags: ['radahn', 'meteoro', 'chefe'],
          sceneSummary: 'Segunda fase de Radahn caindo do céu como meteoro',
          durationSec: 8,
        },
        {
          mediaId: 'clip_malenia',
          title: 'Malenia Waterfowl Dance ataque giratório',
          tags: ['malenia', 'waterfowl', 'ataque', 'chefe'],
          sceneSummary: 'Malenia executando ataque giratório rápido',
          durationSec: 8,
        },
      ],
    );

    expect(matches).toHaveLength(2);
    expect(matches[0].mediaId).toBe('clip_malenia');
    expect(matches[0].matchedTerms).toContain('malenia');
    expect(matches[1].mediaId).toBe('clip_radahn');
    expect(matches[1].matchedTerms).toContain('radahn');
  });

  it('Etapa C: applies Academy Production Learning, AI Visual Critic frame inspection, and Autonomous Supervisor', async () => {
    const dir = createTempDir();
    const evolution = new AetheraEvolutionCore(join(dir, 'evolution.json'));

    const lesson = recordProductionCorrectionLesson(evolution, {
      projectId: 'proj_elden',
      sceneId: 'shot_1',
      genre: 'gameplay_essay',
      issueKind: 'hud_overlap',
      userCorrection: 'Não cobrir o HUD do jogo com títulos ou lower-thirds',
      cause: 'Lower-third posicionado sobre a barra de vida do jogador',
      ruleInstruction: 'Ocultar lower-third em cenas com HUD de gameplay ativo',
    });
    expect(lesson.memoryIds.length).toBeGreaterThan(0);

    const constraints = resolveLearnedSceneConstraints(evolution, {
      prompt: 'Chefes mais difíceis de Elden Ring',
      genre: 'gameplay_essay',
      hasGameplayHud: true,
    });
    expect(constraints.avoidHudOverlap).toBe(true);

    const sampleMp4 = join(dir, 'sample.mp4');
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc=size=320x180:rate=24:duration=4',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      sampleMp4,
    ]);

    const criticReport = await evaluateRenderedVisualCritic({
      projectId: 'proj_elden',
      mp4Path: sampleMp4,
      framesDir: dir,
      evolution,
      genre: 'gameplay_essay',
      prompt: 'Chefes mais difíceis de Elden Ring',
      scenes: [
        {
          sceneId: 'shot_1',
          startSec: 0,
          durationSec: 2,
          sourceMediaId: 'media_boss_1',
          hasGameplayHud: true,
          hasTextOverlay: true,
        },
        {
          sceneId: 'shot_2',
          startSec: 2,
          durationSec: 2,
          sourceMediaId: 'media_boss_1', // consecutive repetition
          hasGameplayHud: true,
          hasTextOverlay: false,
        },
      ],
    });

    expect(criticReport.sampledFrames).toHaveLength(2);
    expect(existsSync(criticReport.sampledFrames[0])).toBe(true);
    expect(criticReport.passed).toBe(false);
    expect(criticReport.proposedRepairs.some((r) => r.action === 'hide_lower_third' && r.sceneId === 'shot_1')).toBe(true);
    expect(criticReport.proposedRepairs.some((r) => r.action === 'swap_duplicate_clip' && r.sceneId === 'shot_2')).toBe(true);

    const decision = runAutonomousSupervisorPass(criticReport);
    expect(decision.status).toBe('needs_repair');
    expect(decision.rerenderSceneIds).toContain('shot_1');
    expect(decision.rerenderSceneIds).toContain('shot_2');
    expect(decision.retryResearchSceneIds).toContain('shot_2');
  });
});
