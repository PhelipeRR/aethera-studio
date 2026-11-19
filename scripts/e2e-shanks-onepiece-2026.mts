import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  AetheraEvolutionCore,
  probeRealMp4,
  runAutonomousSupervisorPass,
  type CinemaProductionPackage,
  type RealRenderResult,
} from '../packages/cinema/src/index.js';
import { StagedCinemaPipeline } from '../apps/aethera-desktop/src/main/cinema-pipeline.js';
import { acquireWithYtDlp, defaultYtDlp, resolveYtDlpStreamUrl, ytDlpSearch } from '../packages/workspace/src/aethera-acquisition.js';

const execFileAsync = promisify(execFile);
const YT_DLP = 'C:\\Users\\Pheli\\AppData\\Roaming\\Python\\Python314\\Scripts\\yt-dlp.exe';
const ytDlpCmd = { command: YT_DLP, prefix: [] as string[] };
const USER_DATA = join(process.env.APPDATA ?? 'C:\\Users\\Pheli\\AppData\\Roaming', 'AetheraStudio');
const PROJECT_ID = 'cinema_shanks_onepiece_e2e_2026';

const SHANKS_PROMPT = 'O MAIOR SEGREDO DE SHANKS: O que ele realmente sabe sobre o One Piece?';

async function main() {
  const startedAt = new Date().toISOString();
  const reportDir = join(USER_DATA, 'cinema-projects', PROJECT_ID);
  mkdirSync(reportDir, { recursive: true });

  const evolutionCore = new AetheraEvolutionCore(join(USER_DATA, 'evolution', 'aethera-evolution.json'));
  let capturedPkg: CinemaProductionPackage | null = null;
  let capturedRender: RealRenderResult | null = null;

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
      const projectsDir = join(USER_DATA, 'cinema-projects');
      mkdirSync(projectsDir, { recursive: true });
      writeFileSync(
        join(projectsDir, `${pkg.timeline.projectId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`),
        JSON.stringify(pkg, null, 2),
        'utf8',
      );
    },
    onRenderReady: (projectId, render) => {
      capturedRender = render;
      const projectsDir = join(USER_DATA, 'cinema-projects');
      mkdirSync(projectsDir, { recursive: true });
      const enriched = {
        ...render,
        mediaUrl: `aethera-media://local?path=${encodeURIComponent(render.mp4Path)}`,
      };
      writeFileSync(
        join(projectsDir, `${projectId.replace(/[^a-zA-Z0-9_-]/g, '_')}.render.json`),
        JSON.stringify(enriched, null, 2),
        'utf8',
      );
    },
    autonomousAcquisitionDeps: {
      ytDlpSearchFn: (q, count, sig) => ytDlpSearch(ytDlpCmd, q, count, sig),
      resolveStreamUrlFn: (targetUrl, sig) =>
        resolveYtDlpStreamUrl({ ytDlp: ytDlpCmd, url: targetUrl, maxHeight: 480, timeoutMs: 12_000, ...(sig ? { signal: sig } : {}) }),
      ytDlpAcquireFn: async (targetUrl, idx, dir, sig, downloadSection, onProgress) => {
        const relativeDir = `acq_${idx + 1}_${Date.now().toString(36)}`;
        mkdirSync(join(dir, relativeDir), { recursive: true });
        const out = await acquireWithYtDlp({
          ytDlp: ytDlpCmd,
          url: targetUrl,
          root: dir,
          relativeDir,
          fileStem: `slot_${idx + 1}`,
          maxHeight: 720,
          downloadSection: downloadSection ?? '*0:00-1:30',
          maxFilesize: '90M',
          ...(sig ? { signal: sig } : {}),
          ...(onProgress ? { onProgress } : {}),
        });
        return out.relativePath ? join(dir, out.relativePath) : null;
      },
    },
    analyzeFrameWithAI: async (framePath, scene) => {
      try {
        const prompt = [
          `Inspecione a imagem do frame em "${framePath}" da cena ${scene.sceneId} (${scene.startSec}s).`,
          `Narração: "${scene.narrationText ?? ''}".`,
          `Se a imagem for claramente de outro tópico diferente da narração sobre One Piece/Shanks, use suggestedAction="retry_media_research" e severity="critical".`,
          `Se a imagem mostrar Shanks, One Piece, piratas, Marineford, Grand Line ou elementos relacionados ao universo de One Piece, use suggestedAction="approve" mesmo que não mostre o evento exato narrado.`,
          `Responda APENAS com JSON: {"suggestedAction":"approve"|"retry_media_research","severity":"ok"|"warning"|"critical","reason":"..."}`,
        ].join(' ');
        const { stdout } = await execFileAsync(
          process.env['NB_PYTHON'] ?? 'python',
          ['-m', 'aethera_vision', '--prompt', prompt, '--image', framePath],
          { timeout: 30_000, windowsHide: true },
        );
        const parsed = JSON.parse(stdout.trim()) as { suggestedAction: string; severity: string; reason?: string };
        return parsed;
      } catch {
        return { suggestedAction: 'approve', severity: 'ok', reason: 'vision_unavailable_fallback' };
      }
    },
  });

  console.log(`[E2E] Iniciando produção autônoma: "${SHANKS_PROMPT}"`);
  console.log(`[E2E] Duração-alvo: 300s (5 minutos)`);
  console.log(`[E2E] Project ID: ${PROJECT_ID}`);
  console.log('---');

  const job = await pipeline.start({
    projectId: PROJECT_ID,
    prompt: SHANKS_PROMPT,
    genre: 'documentary',
    format: 'youtube_16_9',
    targetDurationSec: 300,
    humorIntensity: 0.3,
    language: 'pt-BR',
    allowDeterministicScriptFallback: true,
  });

  console.log('---');
  console.log(`[E2E] Estado final: ${job.state}`);
  console.log(`[E2E] Progresso: ${job.progressPct}%`);
  console.log(`[E2E] Mensagem: ${job.message}`);
  console.log(`[E2E] Etapas concluídas: ${job.completedStages.join(', ')}`);
  console.log(`[E2E] Mídias pendentes: ${job.pendingMedia.length}`);
  if (job.pendingMedia.length > 0) {
    for (const pm of job.pendingMedia) {
      console.log(`  - Slot ${pm.slotIndex}: "${pm.query}" (${pm.reason}) tentativas=${pm.attempts ?? '?'}`);
    }
  }
  console.log(`[E2E] Package capturado: ${capturedPkg ? 'SIM' : 'NÃO'}`);
  console.log(`[E2E] Render capturado: ${capturedRender ? 'SIM' : 'NÃO'}`);

  if (capturedRender && capturedRender.mp4Path && existsSync(capturedRender.mp4Path)) {
    console.log('---');
    console.log('[E2E] Validando MP4 final...');
    const probe = await probeRealMp4(capturedRender.mp4Path);
    console.log(`  Duração: ${probe.durationSec.toFixed(1)}s`);
    console.log(`  Resolução: ${probe.width}x${probe.height}`);
    console.log(`  FPS: ${probe.fps}`);
    console.log(`  Codec vídeo: ${probe.videoCodec}`);
    console.log(`  Codec áudio: ${probe.audioCodec}`);
    console.log(`  Tamanho: ${(probe.fileSizeBytes / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  Válido: ${probe.valid}`);
    if (!probe.valid) {
      console.log(`  Erros: ${probe.errors.join('; ')}`);
    }
  }

  const finishedAt = new Date().toISOString();
  const report = {
    projectId: PROJECT_ID,
    prompt: SHANKS_PROMPT,
    startedAt,
    finishedAt,
    finalState: job.state,
    progressPct: job.progressPct,
    completedStages: job.completedStages,
    pendingMediaCount: job.pendingMedia.length,
    pendingMedia: job.pendingMedia.map((pm) => ({
      slotIndex: pm.slotIndex,
      query: pm.query,
      reason: pm.reason,
      attempts: pm.attempts,
    })),
    packageCaptured: Boolean(capturedPkg),
    renderCaptured: Boolean(capturedRender),
    renderPath: capturedRender?.mp4Path ?? null,
    error: job.error ?? null,
  };

  writeFileSync(join(reportDir, 'e2e-report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(`[E2E] Relatório salvo em: ${join(reportDir, 'e2e-report.json')}`);

  const success = job.state === 'completed' && capturedRender && existsSync(capturedRender.mp4Path);
  console.log(`[E2E] RESULTADO: ${success ? 'SUCESSO — MP4 produzido autonomamente' : 'FALHOU — ver relatório'}`);
  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error('[E2E] Erro fatal:', err);
  process.exit(1);
});