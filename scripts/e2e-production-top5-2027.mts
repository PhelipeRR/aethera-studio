import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  AetheraEvolutionCore,
  detectMediaAnomalies,
  evaluateRenderedVisualCritic,
  probeRealMp4,
  runAutonomousSupervisorPass,
  runRealMediaQc,
  type CinemaProductionPackage,
  type RealRenderResult,
} from '../packages/cinema/src/index.js';
import { StagedCinemaPipeline } from '../apps/aethera-desktop/src/main/cinema-pipeline.js';

const execFileAsync = promisify(execFile);
const YT_DLP = 'C:\\Users\\Pheli\\AppData\\Roaming\\Python\\Python314\\Scripts\\yt-dlp.exe';
const USER_DATA = join(process.env.APPDATA ?? 'C:\\Users\\Pheli\\AppData\\Roaming', 'AetheraStudio');
const PROJECT_ID = 'cinema_top5_2027_e2e';

const GAME_SLUGS = [
  'fable_2027',
  'tomb_raider_legacy_of_atlantis',
  'exodus_sci_fi_rpg',
  'final_fantasy_vii_revelation',
  'kingdom_hearts_iv',
  'games_2027_showcase',
];

const GAME_QUERIES = [
  'Fable Xbox official trailer gameplay 2027',
  'Tomb Raider Legacy of Atlantis official trailer',
  'Exodus game official gameplay trailer Archetype',
  'Final Fantasy VII Rebirth Revelation trailer gameplay',
  'Kingdom Hearts IV official trailer gameplay',
  'Most anticipated games 2027 showcase trailer',
];

const VERIFIED_SCRIPT = {
  treatment:
    'Documentário analítico e dinâmico em português sobre os 5 jogos mais aguardados de 2027 (Tomb Raider: Legacy of Atlantis, Exodus, Fable, Final Fantasy VII Revelation e Kingdom Hearts IV), combinando contexto de desenvolvimento, plataformas confirmadas, análise de mecânicas e humor pontual.',
  beats: [
    {
      stage: 'hook' as const,
      summary:
        'Se você acha que 2026 já foi intenso para os videogames, prepare o controle: 2027 promete ser um dos anos mais ambiciosos da geração atual, reunindo retornos históricos de franquias lendárias e novas apostas de veteranos da indústria.',
    },
    {
      stage: 'promise' as const,
      summary:
        'Em quinto lugar, Tomb Raider: Legacy of Atlantis, previsto para 12 de fevereiro de 2027 no PlayStation 5, PC e Switch 2. A nova jornada de Lara Croft resgata a atmosfera clássica de exploração em ruínas submersas e enigmas ambientais com escala cinematográfica moderna.',
    },
    {
      stage: 'progression' as const,
      summary:
        'Na quarta posição aparece Exodus, com janela apontada para 7 de abril de 2027 no PC, PlayStation 5 e Xbox Series X e S. Desenvolvido pela Archetype Entertainment, estúdio fundado por veteranos da BioWare, o RPG de ficção científica explora dilatação temporal e escolhas morais com peso real em gerações inteiras.',
    },
    {
      stage: 'tension' as const,
      summary:
        'Abrindo o pódio em terceiro lugar, Fable da Playground Games, apontado para 23 de fevereiro de 2027 no Xbox Series X e S, PC, PlayStation 5 e Game Pass. Depois de anos de expectativa, Albion retorna com humor britânico afiado, combate fluido e consequências visuais que mudam a reputação do herói a cada decisão.',
    },
    {
      stage: 'climax' as const,
      summary:
        'Em segundo lugar está Final Fantasy VII Revelation, capítulo final da trilogia de remake da Square Enix previsto para 8 de abril de 2027 com lançamento multiplataforma no PlayStation 5, Xbox Series, PC e Switch 2. A expectativa gira em torno da conclusão do arco de Cloud e Sephiroth e da evolução do sistema híbrido de ação e estratégia.',
    },
    {
      stage: 'resolution' as const,
      summary:
        'E no topo da lista, em primeiro lugar, Kingdom Hearts IV, com previsão para o final de 2027. Levando Sora ao mundo realista de Quadratum, o título marca uma virada visual na Unreal Engine e promete conectar décadas de mitologia da franquia com combates ainda mais verticais e cinematográficos. E para você, qual desses cinco merece compra no dia um?',
    },
  ],
};

async function main() {
  const startedAt = new Date().toISOString();
  const reportDir = join(USER_DATA, 'cinema-projects', PROJECT_ID);
  mkdirSync(reportDir, { recursive: true });

  const evolutionCore = new AetheraEvolutionCore(join(USER_DATA, 'evolution', 'aethera-evolution.json'));
  let capturedPkg: CinemaProductionPackage | null = null;
  let capturedRender: RealRenderResult | null = null;
  const providerDegradations: string[] = [];
  const visionFindingsLog: Array<{ sceneId: string; provider: string; issue: string | null }> = [];

  const pipeline = new StagedCinemaPipeline({
    jobsDir: join(USER_DATA, 'cinema-jobs'),
    mediaDir: join(USER_DATA, 'cinema-media'),
    outputDir: join(USER_DATA, 'cinema-renders'),
    cinemaProjectsDir: join(USER_DATA, 'cinema-projects'),
    evolutionCore,
    onProgress: (j) => {
      console.log(`[${j.progressPct}%] (${j.state}) ${j.message}`);
    },
    onPackageReady: (pkg) => {
      capturedPkg = pkg;
    },
    onRenderReady: (_projectId, render) => {
      capturedRender = render;
    },
    searchExternalMedia: async (query, slotIndex, signal) => {
      const searchQ = GAME_QUERIES[slotIndex % GAME_QUERIES.length] ?? query;
      try {
        const { stdout } = await execFileAsync(
          YT_DLP,
          ['--dump-json', '--flat-playlist', '--no-warnings', `ytsearch3:${searchQ}`],
          { signal, timeout: 20_000 },
        );
        const candidates = stdout
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => {
            try {
              const obj = JSON.parse(line) as { id?: string; url?: string; title?: string; uploader?: string };
              const url = obj.url?.startsWith('http') ? obj.url : obj.id ? `https://www.youtube.com/watch?v=${obj.id}` : '';
              return url ? { url, title: obj.title ?? searchQ, origin: obj.uploader ?? 'YouTube', license: 'youtube_trailer_fair_use' } : null;
            } catch {
              return null;
            }
          })
          .filter((x): x is { url: string; title: string; origin: string; license: string } => Boolean(x));
        return candidates;
      } catch (err) {
        providerDegradations.push(`yt-dlp search slot ${slotIndex}: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }
    },
    acquireExternalMedia: async (query, slotIndex, mediaDir, signal, preferredUrl) => {
      const targetUrl = preferredUrl ?? `ytsearch1:${GAME_QUERIES[slotIndex % GAME_QUERIES.length] ?? query}`;
      const slug = GAME_SLUGS[slotIndex] ?? `recovered_scene_${slotIndex}`;
      const outTemplate = join(mediaDir, `${slug}.%(ext)s`);
      try {
        await execFileAsync(
          YT_DLP,
          [
            '--no-playlist',
            '--no-warnings',
            '-f',
            'best[height<=720][ext=mp4]/best[height<=720]/bestvideo[height<=720]+bestaudio/best',
            '--merge-output-format',
            'mp4',
            '-o',
            outTemplate,
            targetUrl,
          ],
          { signal, timeout: 180_000 },
        );
        for (const ext of ['mp4', 'webm', 'mkv']) {
          const candidate = join(mediaDir, `${slug}.${ext}`);
          if (existsSync(candidate)) return candidate;
        }
        return null;
      } catch (err) {
        providerDegradations.push(`yt-dlp download slot ${slotIndex}: ${err instanceof Error ? err.message : String(err)}`);
        return null;
      }
    },
    generateAgentScript: async () => VERIFIED_SCRIPT,
    analyzeFrameWithAI: async (framePath, scene) => {
      // Try real Claude CLI multimodal inspection on the extracted PNG frame
      try {
        const prompt = [
          `Inspecione a imagem do frame em "${framePath}" da cena ${scene.sceneId} (${scene.startSec}s).`,
          `Narração: "${scene.narrationText ?? ''}".`,
          `Se a imagem for claramente de outro jogo diferente da narração, use suggestedAction="retry_media_research" e severity="critical".`,
          `Responda SOMENTE JSON: {"ok":true|false,"issue":"...","severity":"warning"|"critical","suggestedAction":"hide_lower_third"|"adjust_typography"|"adjust_vfx"|"retry_media_research"|"swap_duplicate_clip"|"rerender_scene"|null}`,
        ].join(' ');
        const { stdout } = await execFileAsync(
          'claude',
          ['-p', '--output-format', 'text', prompt],
          { cwd: dirname(framePath), timeout: 30_000 },
        );
        const match = stdout.match(/\{[\s\S]*\}/);
        if (match) {
          const parsed = JSON.parse(match[0]) as {
            ok?: boolean;
            issue?: string;
            severity?: 'warning' | 'critical';
            suggestedAction?: 'hide_lower_third' | 'adjust_typography' | 'adjust_vfx' | 'retry_media_research' | 'swap_duplicate_clip' | 'rerender_scene' | null;
          };
          visionFindingsLog.push({ sceneId: scene.sceneId, provider: 'claude-cli', issue: parsed.ok === false ? (parsed.issue ?? 'issue') : null });
          if (parsed.ok === false && parsed.issue && parsed.suggestedAction) {
            return {
              issue: parsed.issue,
              severity: parsed.severity ?? 'warning',
              suggestedAction: parsed.suggestedAction,
            };
          }
          return null;
        }
      } catch (err) {
        providerDegradations.push(`claude-cli frame ${scene.sceneId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      visionFindingsLog.push({ sceneId: scene.sceneId, provider: 'deterministic-fallback', issue: null });
      return null;
    },
  });

  let job = await pipeline.start({
    projectId: PROJECT_ID,
    prompt: 'TOP 5 jogos mais aguardados de 2027: análise completa de trailers, datas e plataformas',
    genre: 'gameplay_essay',
    format: 'youtube_16_9',
    targetDurationSec: 300,
    humorIntensity: 25,
    renderProfile: 'review_720p',
    useNvenc: true,
    allowProceduralFallback: false,
  });

  if (job.state === 'paused_pending_media' && job.pendingMedia.length > 0) {
    const fallbackMediaDir = join(USER_DATA, 'cinema-workspaces', PROJECT_ID, 'media');
    mkdirSync(fallbackMediaDir, { recursive: true });
    const resolutions: Array<{ slotIndex: number; filePath: string }> = [];
    for (const slot of job.pendingMedia) {
      const q = GAME_QUERIES[slot.slotIndex % GAME_QUERIES.length] ?? slot.query;
      const outTpl = join(fallbackMediaDir, `resolved_slot_${slot.slotIndex + 1}.%(ext)s`);
      await execFileAsync(
        YT_DLP,
        [
          '--no-playlist',
          '--no-warnings',
          '-f',
          'best[height<=720][ext=mp4]/best[height<=720]/bestvideo[height<=720]+bestaudio/best',
          '--merge-output-format',
          'mp4',
          '-o',
          outTpl,
          `ytsearch1:${q}`,
        ],
        { timeout: 180_000 },
      );
      let resolvedPath: string | undefined;
      for (const ext of ['mp4', 'webm', 'mkv']) {
        const candidate = join(fallbackMediaDir, `resolved_slot_${slot.slotIndex + 1}.${ext}`);
        if (existsSync(candidate)) {
          resolvedPath = candidate;
          break;
        }
      }
      if (!resolvedPath) {
        throw new Error(`Falha ao baixar trailer real para slot ${slot.slotIndex} (${q})`);
      }
      resolutions.push({ slotIndex: slot.slotIndex, filePath: resolvedPath });
    }
    job = await pipeline.resolvePendingMedia(PROJECT_ID, resolutions);
  }

  if (!capturedRender) {
    throw new Error(`Render não produzido! Estado final do job: ${job.state} (${job.error ?? job.message})`);
  }

  const probe = await probeRealMp4(capturedRender.mp4Path);
  const anomalies = capturedRender.anomalies ?? (await detectMediaAnomalies(capturedRender.mp4Path));
  const qcFindings = runRealMediaQc(probe, -14.0, anomalies);

  // Also run explicit Visual Critic report for the saved audit JSON
  const v1Clips = capturedPkg ? capturedPkg.timeline.clips.filter((c) => c.trackId === 'v1') : [];
  const criticReport = await evaluateRenderedVisualCritic({
    projectId: PROJECT_ID,
    mp4Path: capturedRender.mp4Path,
    framesDir: join(reportDir, 'temp', 'visual-critic-audit'),
    prompt: job.prompt,
    genre: 'gameplay_essay',
    scenes: v1Clips.map((c, idx) => ({
      sceneId: c.clipId,
      startSec: c.timelineRange.start.value / Math.max(1, c.timelineRange.start.rate),
      durationSec: c.timelineRange.duration.value / Math.max(1, c.timelineRange.duration.rate),
      sourceMediaId: c.mediaId,
      hasTextOverlay: !c.effects.some((e) => e.kind === 'hide_title' && e.enabled),
      hasGameplayHud: true,
      vfxEffects: c.effects.filter((e) => e.enabled).map((e) => e.kind),
      ...(capturedPkg?.direction.narrativeBeats[idx]?.summary
        ? { narrationText: capturedPkg.direction.narrativeBeats[idx].summary }
        : {}),
    })),
    anomalies,
    evolution: evolutionCore,
  });
  const supervisor = runAutonomousSupervisorPass(criticReport, { attempt: 1, maxAttempts: 2 });

  const auditReport = {
    startedAt,
    finishedAt: new Date().toISOString(),
    projectId: PROJECT_ID,
    jobState: job.state,
    mp4Path: capturedRender.mp4Path,
    narrationMode: capturedRender.narrationMode,
    isTechnicalSample: capturedRender.isTechnicalSample,
    acquiredMediaCount: job.acquiredMedia.length,
    acquiredMediaFiles: job.acquiredMedia.map((m) => m.uri),
    probe,
    anomalies,
    qcFindings,
    incrementalRenderStats: capturedRender.incrementalRenderStats ?? null,
    criticReport: {
      passed: criticReport.passed,
      score: criticReport.score,
      sampledFramesCount: criticReport.sampledFrames.length,
      proposedRepairs: criticReport.proposedRepairs,
      summary: criticReport.summary,
    },
    supervisor,
    visionFindingsLog,
    providerDegradations,
  };

  const reportPath = join(reportDir, 'e2e_quality_report.json');
  writeFileSync(reportPath, JSON.stringify(auditReport, null, 2), 'utf8');
  console.log('\n=== E2E PRODUCTION COMPLETE ===');
  console.log(JSON.stringify({ mp4Path: capturedRender.mp4Path, reportPath, probe, incrementalRenderStats: capturedRender.incrementalRenderStats, narrationMode: capturedRender.narrationMode, acquiredMediaCount: job.acquiredMedia.length, criticScore: criticReport.score, supervisorStatus: supervisor.status }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
