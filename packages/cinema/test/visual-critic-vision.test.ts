import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AetheraEvolutionCore,
  evaluateRenderedVisualCritic,
  produceCinemaPackage,
  recordProductionCorrectionLesson,
  renderRealCinemaMp4,
  runAutonomousSupervisorPass,
} from '../src/index.js';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aethera-vc-vision-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe('AI Visual Critic with real vision & targeted repairs', () => {
  it('evaluates real PNG frames, typography, SFX/VFX balance, and narration-image fit', async () => {
    const dir = createTempDir();
    const hudFramePng = join(dir, 'hud_frame.png');
    const cleanFramePng = join(dir, 'clean_frame.png');

    // Generate two real PNG images with FFmpeg
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x1e293b:s=640x360:d=1',
      '-vf',
      'drawbox=x=20:y=290:w=240:h=50:color=red@0.8:t=fill,drawbox=x=40:y=300:w=200:h=30:color=white@0.85:t=fill',
      '-frames:v',
      '1',
      hudFramePng,
    ]);
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x0f172a:s=640x360:d=1',
      '-frames:v',
      '1',
      cleanFramePng,
    ]);

    expect(existsSync(hudFramePng)).toBe(true);
    expect(existsSync(cleanFramePng)).toBe(true);

    const evolution = new AetheraEvolutionCore(join(dir, 'evo.json'));
    recordProductionCorrectionLesson(evolution, {
      projectId: 'proj_vc_1',
      sceneId: 'shot_1',
      genre: 'gameplay_essay',
      issueKind: 'hud_overlap',
      userCorrection: 'Não cobrir o HUD do jogo com títulos ou legendas',
      cause: 'Lower-third em cima do HUD',
      ruleInstruction: 'Ocultar lower-third quando houver HUD visível',
    });

    const analyzedCalls: Array<{ framePath: string; sceneId: string }> = [];
    const report = await evaluateRenderedVisualCritic({
      projectId: 'proj_vc_1',
      framesDir: dir,
      evolution,
      genre: 'gameplay_essay',
      prompt: 'Batalha épica contra chefe em Elden Ring',
      scenes: [
        {
          sceneId: 'shot_1',
          startSec: 0,
          durationSec: 4,
          sourceMediaId: 'media_1',
          hasGameplayHud: true,
          hasTextOverlay: true,
          subtitleText: 'A'.repeat(110), // triggers adjust_typography
          vfxEffects: ['heavy_glow'], // conflicts with text/subtitle -> adjust_vfx
          sfxCues: [],
          narrationText: 'No clímax da batalha, o ataque do chefe gera um impacto brutal.', // triggers adjust_sfx
        },
        {
          sceneId: 'shot_2',
          startSec: 4,
          durationSec: 4,
          sourceMediaId: 'media_2',
          hasGameplayHud: false,
          hasTextOverlay: false,
          sfxCues: ['sfx_whoosh'],
          narrationText: 'Exploração tranquila pelos campos.',
        },
      ],
      analyzeFrameWithAI: async (framePath, scene) => {
        analyzedCalls.push({ framePath, sceneId: scene.sceneId });
        if (scene.sceneId === 'shot_1') {
          return {
            issue: 'Composição com texto sobrepondo barra de HUD.',
            severity: 'critical',
            suggestedAction: 'hide_lower_third',
          };
        }
        return null;
      },
    });

    expect(report.passed).toBe(false);
    expect(report.proposedRepairs.some((r) => r.sceneId === 'shot_1' && r.action === 'hide_lower_third')).toBe(true);
    expect(report.proposedRepairs.some((r) => r.sceneId === 'shot_1' && r.action === 'adjust_typography')).toBe(true);
    expect(report.proposedRepairs.some((r) => r.sceneId === 'shot_1' && r.action === 'adjust_vfx')).toBe(true);
    expect(report.proposedRepairs.some((r) => r.sceneId === 'shot_1' && r.action === 'adjust_sfx')).toBe(true);

    // Structured findings include timestamps, scene dependencies, severity, evidence, and fixSuggestion
    const sfxFinding = report.findings.find((f) => f.issueId === 'visual_critic_sfx_shot_1');
    expect(sfxFinding).toBeDefined();
    expect(sfxFinding?.timeRange.start.value).toBe(0);
    expect(sfxFinding?.affectedDependencies).toContain('shot_1');
    expect(sfxFinding?.fixSuggestion.length).toBeGreaterThan(5);

    const sup = runAutonomousSupervisorPass(report, { attempt: 1, maxAttempts: 2 });
    expect(sup.status).toBe('needs_repair');
    expect(sup.rerenderSceneIds).toEqual(['shot_1']); // shot_2 preserved!

    // Loop prevention: repeating identical signatures escalates to user
    const escalated = runAutonomousSupervisorPass(report, {
      attempt: 2,
      maxAttempts: 2,
      previousActionSignatures: sup.actions.map((a) => `${a.sceneId}:${a.action}`),
    });
    expect(escalated.status).toBe('escalate_to_user');
  });

  it('executes targeted repair on real multi-scene FFmpeg video and reuses incremental cache for approved scenes', async () => {
    const dir = createTempDir();
    const segCacheDir = join(dir, 'segment-cache');
    const pkg = produceCinemaPackage({
      prompt: 'Análise de chefes de Elden Ring com foco em ritmo e VFX',
      genre: 'gameplay_essay',
      format: 'youtube_16_9',
      targetDurationSec: 18,
      humorIntensity: 15,
    });
    pkg.timeline.clips = pkg.timeline.clips.slice(0, 3);

    const first = await renderRealCinemaMp4({
      pkg,
      outputDir: join(dir, 'render-1'),
      previewQuality: 'fast_preview',
      segmentCacheDir: segCacheDir,
    });
    expect(existsSync(first.mp4Path)).toBe(true);
    expect(first.incrementalRenderStats?.reRenderedScenes).toBe(3);

    // Single-provider vision critic flags ONLY clip 1 on real extracted frames
    const v1 = pkg.timeline.clips.filter((c) => c.trackId === 'v1');
    const critic = await evaluateRenderedVisualCritic({
      projectId: 'proj_real_vc',
      mp4Path: first.mp4Path,
      framesDir: join(dir, 'frames'),
      scenes: v1.map((c, idx) => ({
        sceneId: c.clipId,
        startSec: c.timelineRange.start.value / Math.max(1, c.timelineRange.start.rate),
        durationSec: c.timelineRange.duration.value / Math.max(1, c.timelineRange.duration.rate),
        sourceMediaId: `unique_media_${idx}`,
        hasGameplayHud: idx === 0,
        hasTextOverlay: true,
      })),
      analyzeFrameWithAI: async (_framePath, scene) =>
        scene.sceneId === v1[0]!.clipId
          ? {
              issue: 'Título cobrindo HUD na primeira cena.',
              severity: 'critical',
              suggestedAction: 'hide_lower_third',
            }
          : null,
    });

    expect(critic.sampledFrames).toHaveLength(3);
    expect(existsSync(critic.sampledFrames[0]!)).toBe(true);
    const sup = runAutonomousSupervisorPass(critic, { attempt: 1, maxAttempts: 2 });
    expect(sup.status).toBe('needs_repair');
    expect(sup.rerenderSceneIds).toEqual([v1[0]!.clipId]);

    // Apply targeted repair ONLY to scene 1
    const repairedPkg = structuredClone(pkg);
    const targetClip = repairedPkg.timeline.clips.find((c) => c.clipId === v1[0]!.clipId)!;
    targetClip.effects.push({
      effectId: 'rep_hide_title_1',
      kind: 'hide_title',
      params: { reason: 'visual_critic_targeted_repair' },
      enabled: true,
      estimatedCostMs: 0,
      fallbackMode: 'skip',
    });

    const second = await renderRealCinemaMp4({
      pkg: repairedPkg,
      outputDir: join(dir, 'render-2'),
      previewQuality: 'fast_preview',
      segmentCacheDir: segCacheDir,
    });
    expect(existsSync(second.mp4Path)).toBe(true);
    // Scenes 2 and 3 reused from cache; only scene 1 re-rendered!
    expect(second.incrementalRenderStats?.cacheHits).toBe(2);
    expect(second.incrementalRenderStats?.reRenderedScenes).toBe(1);
  }, 40000);
});
