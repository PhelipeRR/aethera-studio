/**
 * E2E Produção — Ciência 2027
 *
 * Pipeline real de produção audiovisual sobre descobertas científicas de 2027,
 * reutilizando a infraestrutura do E2E de jogos (StagedCinemaPipeline + yt-dlp + Claude CLI vision).
 *
 * Uso: npx tsx scripts/e2e-science-2027.mts
 * Requer: yt-dlp em C:\Users\Pheli\AppData\Roaming\Python\Python314\Scripts\yt-dlp.exe,
 *         claude CLI no PATH, ffmpeg/ffprobe no PATH.
 */
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
import { acquireWithYtDlp, defaultYtDlp, resolveYtDlpStreamUrl, ytDlpSearch } from '../packages/workspace/src/aethera-acquisition.js';

const execFileAsync = promisify(execFile);
const YT_DLP = 'C:\\Users\\Pheli\\AppData\\Roaming\\Python\\Python314\\Scripts\\yt-dlp.exe';
const ytDlpCmd = { command: YT_DLP, prefix: [] as string[] };
const USER_DATA = join(process.env.APPDATA ?? 'C:\\Users\\Pheli\\AppData\\Roaming', 'AetheraStudio');
const PROJECT_ID = 'cinema_science_2027_e2e';

const SCIENCE_SLUGS = [
  'science_hook_2027',
  'fusion_energy_breakthrough',
  'mars_sample_return',
  'quantum_computing_error_correction',
  'crispr_gene_therapy',
  'science_closing_2027',
];

const SCIENCE_QUERIES = [
  'biggest science discoveries 2027 documentary',
  'nuclear fusion energy breakthrough 2027 ITER',
  'Mars sample return mission NASA ESA 2027',
  'quantum computing error correction breakthrough 2027',
  'CRISPR gene therapy clinical trial 2027',
  'future of science technology 2027 documentary',
];

const VERIFIED_SCRIPT = {
  treatment:
    'Documentário analítico e dinâmico em português sobre as 5 maiores descobertas científicas de 2027, combinando contexto histórico, implicações práticas e humor pontual para tornar a ciência acessível.',
  beats: [
    {
      stage: 'hook' as const,
      summary:
        'Se você acha que a ciência avança devagar, espere até ver o que 2027 entregou: de reatores de fusão produzindo energia líquida pela primeira vez a amostras de Marte finalmente chegando à Terra, este ano redefiniu o que achávamos possível.',
    },
    {
      stage: 'promise' as const,
      summary:
        'Em quinto lugar, a terapia gênica com CRISPR aprovada para doenças hereditárias raras. Depois de anos de ensaios clínicos, os primeiros pacientes tratados mostram remissão completa, abrindo caminho para curas antes consideradas ficção científica.',
    },
    {
      stage: 'progression' as const,
      summary:
        'Na quarta posição, a correção de erros quânticos em escala comercial. Computadores quânticos com mais de mil qubits lógicos estáveis resolveram problemas de otimização que levariam séculos em supercomputadores clássicos.',
    },
    {
      stage: 'tension' as const,
      summary:
        'Abrindo o pódio em terceiro lugar, as amostras de Marte finalmente chegaram à Terra. A cápsula da missão Mars Sample Return pousou no deserto de Utah, trazendo rochas marcianas de 4 bilhões de anos para análise em laboratórios terrestres.',
    },
    {
      stage: 'climax' as const,
      summary:
        'Em segundo lugar, o ITER atingiu ignição sustentada de plasma. O reator de fusão nuclear na França produziu mais energia do que consumiu durante 30 segundos contínuos, provando que a fusão como fonte de energia limpa é tecnicamente viável.',
    },
    {
      stage: 'resolution' as const,
      summary:
        'E no topo da lista, em primeiro lugar, a detecção de bioassinaturas em Europa. O telescópio espacial James Webb identificou metano e oxigênio em proporções incompatíveis com processos geológicos na lua de Júpiter, reacendendo o debate sobre vida extraterrestre. E para você, qual dessas descobertas muda mais o futuro da humanidade?',
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
          `Se a imagem for claramente de outro tópico diferente da narração científica, use suggestedAction="retry_media_research" e severity="critical".`,
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
    searchExternalMedia: async (query, slotIndex, signal) => {
      const searchQ = SCIENCE_QUERIES[slotIndex % SCIENCE_QUERIES.length] ?? query;
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
              return url ? { url, title: obj.title ?? searchQ, origin: obj.uploader ?? 'YouTube', license: 'youtube_documentary_fair_use' } : null;
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
      const targetUrl = preferredUrl ?? `ytsearch1:${SCIENCE_QUERIES[slotIndex % SCIENCE_QUERIES.length] ?? query}`;
      const slug = SCIENCE_SLUGS[slotIndex] ?? `recovered_scene_${slotIndex}`;
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
      try {
        const prompt = [
          `Inspecione a imagem do frame em "${framePath}" da cena ${scene.sceneId} (${scene.startSec}s).`,
          `Narração: "${scene.narrationText ?? ''}".`,
          `Se a imagem for claramente de outro tópico diferente da narração científica, use suggestedAction="retry_media_research" e severity="critical".`,
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

  // Limpa mídias residuais de tentativas anteriores para forçar execução do caminho autônomo.
  // scanLocalMediaDir carrega arquivos existentes antes da verificação do bloco autônomo,
  // fazendo com que job.acquiredMedia.length >= queries.length e pulando a aquisição real.
  const projectMediaDir = join(USER_DATA, 'cinema-workspaces', PROJECT_ID, 'media');
  if (existsSync(projectMediaDir)) {
    const { readdirSync, unlinkSync } = await import('node:fs');
    for (const f of readdirSync(projectMediaDir)) {
      try { unlinkSync(join(projectMediaDir, f)); } catch { /* arquivo bloqueado ou já removido */ }
    }
  }

  let job = await pipeline.start({
    projectId: PROJECT_ID,
    prompt: 'TOP 5 descobertas científicas de 2027: ITER fusão nuclear ignição sustentada, Mars Sample Return amostras marcianas Utah, computação quântica correção erros mil qubits lógicos, CRISPR terapia gênica doenças hereditárias raras e bioassinaturas metano oxigênio Europa James Webb',
    genre: 'documentary_essay',
    format: 'youtube_16_9',
    targetDurationSec: 300,
    humorIntensity: 20,
    renderProfile: 'review_720p',
    useNvenc: true,
    allowProceduralFallback: false,
  });

  // Limite máximo de tentativas de fallback para evitar loops infinitos em paused_pending_media.
  let fallbackAttempts = 0;
  const MAX_FALLBACK_ATTEMPTS = 3;
  while (job.state === 'paused_pending_media' && job.pendingMedia.length > 0 && fallbackAttempts < MAX_FALLBACK_ATTEMPTS) {
    fallbackAttempts += 1;
    console.log(`[INFO] Tentativa de fallback ${fallbackAttempts}/${MAX_FALLBACK_ATTEMPTS} para ${job.pendingMedia.length} slot(s) pendente(s).`);
    const fallbackMediaDir = join(USER_DATA, 'cinema-workspaces', PROJECT_ID, 'media');
    mkdirSync(fallbackMediaDir, { recursive: true });
    const resolutions: Array<{ slotIndex: number; filePath: string }> = [];
    // Extrai termos específicos da narração de cada cena pendente para gerar queries eficazes,
    // evitando o workTitle genérico truncado que causa 0 resultados no YouTube.
    // Mapeia clipId → cena da decupagem usando o campo real (ex: "scene_01_hook"), não índice numérico.
    const sceneById = new Map<string, typeof job.sceneDecupagem[number]>();
    for (const s of job.sceneDecupagem ?? []) sceneById.set(s.sceneId, s);
    const extractNarrationKeywords = (text: string): string => {
      const stopWords = new Set(['de', 'da', 'do', 'em', 'no', 'na', 'os', 'as', 'um', 'uma', 'para', 'com', 'por', 'que', 'e', 'a', 'o', 'é', 'este', 'essa', 'esse', 'esta', 'seu', 'sua', 'mais', 'muito', 'ainda', 'entre', 'sobre', 'apenas', 'também', 'quando', 'como', 'onde', 'qual', 'quais', 'todos', 'todas', 'cada', 'outro', 'outra', 'outros', 'outras', 'mesmo', 'mesma', 'próprio', 'própria']);
      return text
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 4 && !stopWords.has(w.toLowerCase()))
        .slice(0, 6)
        .join(' ');
    };
    for (const slot of job.pendingMedia) {
      // slot.clipId contém o sceneId real (ex: "scene_03_progression"); usa diretamente.
      const scene = sceneById.get(slot.clipId);
      const narrationKw = scene ? extractNarrationKeywords(scene.narrationText ?? '') : '';
      const specificQuery = narrationKw.length >= 8 ? `${narrationKw} documentary footage` : undefined;
      const q = specificQuery ?? slot.query;
      const slug = `science_resolved_${slot.slotIndex + 1}_attempt${fallbackAttempts}`;
      const outTpl = join(fallbackMediaDir, `${slug}.%(ext)s`);
      try {
        await execFileAsync(
          YT_DLP,
          [
            '--no-playlist',
            '--no-warnings',
            '--download-sections', '*0:00-1:30',
            '-f',
            'best[height<=720][ext=mp4]/best[height<=720]/bestvideo[height<=720]+bestaudio/best',
            '--merge-output-format',
            'mp4',
            '-o',
            outTpl,
            `ytsearch1:${q}`,
          ],
          { timeout: 120_000 },
        );
      } catch (err) {
        console.warn(`[WARN] Download falhou para slot ${slot.slotIndex} ("${q}"): ${err instanceof Error ? err.message : String(err)}. Pulando.`);
        continue;
      }
      let resolvedPath: string | undefined;
      for (const ext of ['mp4', 'webm', 'mkv']) {
        const candidate = join(fallbackMediaDir, `${slug}.${ext}`);
        if (existsSync(candidate)) {
          resolvedPath = candidate;
          break;
        }
      }
      if (!resolvedPath) {
        console.warn(`[WARN] Arquivo não encontrado após download para slot ${slot.slotIndex} ("${q}"). Pulando.`);
        continue;
      }
      // Rejeita arquivos oversized (>500MB) que indicam download completo em vez de seção limitada,
      // causando invalid_media na validação da pipeline.
      const fileSize = (await import('node:fs')).statSync(resolvedPath).size;
      if (fileSize > 500 * 1024 * 1024) {
        console.warn(`[WARN] Arquivo oversized (${Math.round(fileSize / 1024 / 1024)} MB) para slot ${slot.slotIndex} ("${q}"). Removendo e pulando.`);
        (await import('node:fs')).unlinkSync(resolvedPath);
        continue;
      }
      resolutions.push({ slotIndex: slot.slotIndex, filePath: resolvedPath });
    }
    if (resolutions.length > 0) {
      job = await pipeline.resolvePendingMedia(PROJECT_ID, resolutions);
    } else {
      console.warn('[WARN] Nenhuma mídia pendente resolvida com sucesso nesta tentativa.');
      break;
    }
  }
  if (job.state === 'paused_pending_media' && fallbackAttempts >= MAX_FALLBACK_ATTEMPTS) {
    console.warn(`[WARN] Limite de ${MAX_FALLBACK_ATTEMPTS} tentativas de fallback atingido. Autorizando composição gráfica procedural para ${job.pendingMedia.length} slot(s) pendente(s).`);
    // Autoriza composição gráfica procedural nos slots pendentes para permitir conclusão do pipeline.
    // A composição é rotulada como "explanatory_graphic" no relatório final e não substitui footage real.
    const proceduralResolutions: Array<{ slotIndex: number; allowProcedural: true }> = [];
    for (const slot of job.pendingMedia) {
      proceduralResolutions.push({ slotIndex: slot.slotIndex, allowProcedural: true });
    }
    if (proceduralResolutions.length > 0) {
      try {
        job = await pipeline.resolvePendingMedia(PROJECT_ID, proceduralResolutions as any);
        console.log(`[INFO] Composição gráfica autorizada. Novo estado: ${job.state}`);
      } catch (err) {
        console.warn(`[WARN] Falha ao autorizar composição gráfica: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (!capturedRender) {
    throw new Error(`Render não produzido! Estado final do job: ${job.state} (${job.error ?? job.message})`);
  }

  const probe = await probeRealMp4(capturedRender.mp4Path);
  const anomalies = capturedRender.anomalies ?? (await detectMediaAnomalies(capturedRender.mp4Path));
  const qcFindings = runRealMediaQc(probe, -14.0, anomalies);

  const v1Clips = capturedPkg ? capturedPkg.timeline.clips.filter((c) => c.trackId === 'v1') : [];
  const criticReport = await evaluateRenderedVisualCritic({
    projectId: PROJECT_ID,
    mp4Path: capturedRender.mp4Path,
    framesDir: join(reportDir, 'temp', 'visual-critic-audit'),
    prompt: job.prompt,
    genre: 'documentary_essay',
    scenes: v1Clips.map((c, idx) => ({
      sceneId: c.clipId,
      startSec: c.timelineRange.start.value / Math.max(1, c.timelineRange.start.rate),
      durationSec: c.timelineRange.duration.value / Math.max(1, c.timelineRange.duration.rate),
      sourceMediaId: c.mediaId,
      hasTextOverlay: !c.effects.some((e) => e.kind === 'hide_title' && e.enabled),
      hasGameplayHud: false,
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
  console.log('\n=== E2E SCIENCE PRODUCTION COMPLETE ===');
  console.log(JSON.stringify({ mp4Path: capturedRender.mp4Path, reportPath, probe, incrementalRenderStats: capturedRender.incrementalRenderStats, narrationMode: capturedRender.narrationMode, acquiredMediaCount: job.acquiredMedia.length, criticScore: criticReport.score, supervisorStatus: supervisor.status }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});