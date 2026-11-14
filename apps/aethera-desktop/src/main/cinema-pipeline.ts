import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  applyTargetedRepair,
  evaluateEnsemble,
  evaluateReleaseGates,
  probeRealMp4,
  produceCinemaPackage,
  renderRealCinemaMp4,
  type AetheraEvolutionCore,
  type CinemaGenre,
  type CinemaProductionPackage,
  type DeliveryFormat,
  type RealRenderResult,
  type RenderQualityProfile,
  type SourceMediaRecord,
} from '@neuralbridge/cinema';

export type ProductionStageState =
  | 'idle'
  | 'prompt'
  | 'pesquisa'
  | 'aquisicao'
  | 'roteiro'
  | 'planejamento'
  | 'montagem'
  | 'audio_sfx_vfx'
  | 'previa'
  | 'editor'
  | 'paused_pending_media'
  | 'cancelled'
  | 'error';

export interface PendingMediaSlot {
  slotIndex: number;
  clipId: string;
  query: string;
  reason: string;
  resolvedUri?: string;
  allowProcedural?: boolean;
}

export interface StagedProductionJob {
  projectId: string;
  prompt: string;
  genre?: CinemaGenre;
  format?: DeliveryFormat;
  targetDurationSec: number;
  humorIntensity: number;
  renderProfile: RenderQualityProfile;
  useNvenc: boolean;
  state: ProductionStageState;
  progressPct: number;
  message: string;
  completedStages: ProductionStageState[];
  acquiredMedia: SourceMediaRecord[];
  pendingMedia: PendingMediaSlot[];
  error?: string;
  updatedAt: string;
}

export interface StagedPipelineDeps {
  jobsDir: string;
  mediaDir: string;
  outputDir: string;
  evolutionCore: AetheraEvolutionCore;
  onProgress?: (job: StagedProductionJob) => void;
  onPackageReady: (pkg: CinemaProductionPackage, prompt: string) => void;
  onRenderReady: (projectId: string, render: RealRenderResult) => void;
  acquireExternalMedia?: (
    query: string,
    slotIndex: number,
    mediaDir: string,
    signal: AbortSignal,
  ) => Promise<string | null>;
}

const LOCAL_MEDIA_EXT_RE = /\.(mp4|mov|webm|mkv|png|jpe?g|webp)$/i;

export function extractSceneQueriesFromPrompt(prompt: string, sceneCount = 4): string[] {
  const cleaned = prompt.trim();
  if (!cleaned) return ['Cena principal'];
  const parts = cleaned
    .split(/[,;|•\n]+|\be\b/i)
    .map((p) => p.trim())
    .filter((p) => p.length >= 4);
  const queries: string[] = [];
  for (let i = 0; i < sceneCount; i += 1) {
    const base = parts[i % Math.max(1, parts.length)] ?? cleaned.slice(0, 60);
    queries.push(base.slice(0, 80));
  }
  return queries;
}

export function scanLocalMediaDir(mediaDir: string): string[] {
  if (!existsSync(mediaDir)) return [];
  const out: string[] = [];
  try {
    for (const entry of readdirSync(mediaDir, { withFileTypes: true })) {
      if (entry.isFile() && LOCAL_MEDIA_EXT_RE.test(entry.name)) {
        out.push(join(mediaDir, entry.name));
      }
    }
  } catch {
    // ignore unreadable directory
  }
  return out;
}

export async function buildSourceMediaFromFile(
  filePath: string,
  mediaId: string,
): Promise<SourceMediaRecord | null> {
  if (!existsSync(filePath)) return null;
  const isImage = /\.(png|jpe?g|webp)$/i.test(filePath);
  const sha256 = createHash('sha256').update(filePath).digest('hex');
  if (isImage) {
    return {
      mediaId,
      uri: filePath,
      sha256,
      kind: 'image',
      origin: 'local',
      license: 'user_owned',
      duration: { value: 180, rate: 30 },
      width: 1920,
      height: 1080,
      fps: { value: 30, rate: 1 },
      hasAudio: false,
    };
  }
  try {
    const probe = await probeRealMp4(filePath);
    if (!probe.videoCodec || probe.width <= 0 || probe.durationSec <= 0.1) return null;
    return {
      mediaId,
      uri: filePath,
      sha256,
      kind: 'video',
      origin: 'local',
      license: 'user_owned',
      duration: { value: Math.max(30, Math.round(probe.durationSec * 30)), rate: 30 },
      width: probe.width ?? 1280,
      height: probe.height ?? 720,
      fps: { value: 30, rate: 1 },
      hasAudio: Boolean(probe.audioCodec),
    };
  } catch {
    return null;
  }
}

export class StagedCinemaPipeline {
  private readonly controllers = new Map<string, AbortController>();

  constructor(private readonly deps: StagedPipelineDeps) {
    mkdirSync(deps.jobsDir, { recursive: true });
    mkdirSync(deps.mediaDir, { recursive: true });
  }

  private jobFile(projectId: string): string {
    return join(this.deps.jobsDir, `${projectId.replace(/[^a-zA-Z0-9_-]/g, '_')}.job.json`);
  }

  loadJob(projectId: string): StagedProductionJob | null {
    const file = this.jobFile(projectId);
    if (!existsSync(file)) return null;
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as StagedProductionJob;
    } catch {
      return null;
    }
  }

  listJobs(): StagedProductionJob[] {
    if (!existsSync(this.deps.jobsDir)) return [];
    const jobs: StagedProductionJob[] = [];
    for (const file of readdirSync(this.deps.jobsDir)) {
      if (!file.endsWith('.job.json')) continue;
      try {
        const parsed = JSON.parse(readFileSync(join(this.deps.jobsDir, file), 'utf8')) as StagedProductionJob;
        if (parsed?.projectId) jobs.push(parsed);
      } catch {
        // ignore malformed job file
      }
    }
    return jobs.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }

  private saveJob(job: StagedProductionJob): StagedProductionJob {
    job.updatedAt = new Date().toISOString();
    writeFileSync(this.jobFile(job.projectId), JSON.stringify(job, null, 2), 'utf8');
    this.deps.onProgress?.(job);
    return job;
  }

  cancel(projectId: string): StagedProductionJob | null {
    const ctrl = this.controllers.get(projectId);
    if (ctrl) {
      ctrl.abort();
      this.controllers.delete(projectId);
    }
    const existing = this.loadJob(projectId);
    if (!existing) return null;
    existing.state = 'cancelled';
    existing.message = 'Produção cancelada pelo usuário. Progresso preservado para retomada.';
    return this.saveJob(existing);
  }

  async resolvePendingMedia(
    projectId: string,
    resolutions: Array<{ slotIndex: number; filePath?: string; allowProcedural?: boolean; retryQuery?: string }>,
  ): Promise<StagedProductionJob> {
    const job = this.loadJob(projectId);
    if (!job) throw new Error(`not_found: Job de produção ${projectId} não encontrado.`);

    for (const res of resolutions) {
      const slot = job.pendingMedia.find((s) => s.slotIndex === res.slotIndex);
      if (!slot) continue;
      if (res.filePath) {
        const media = await buildSourceMediaFromFile(res.filePath, `${projectId}_slot_${res.slotIndex + 1}`);
        if (!media) {
          throw new Error(`invalid_media: Arquivo inválido ou ilegível para cena ${res.slotIndex + 1}: ${res.filePath}`);
        }
        slot.resolvedUri = media.uri;
        const existingIdx = job.acquiredMedia.findIndex((m) => m.mediaId === media.mediaId);
        if (existingIdx >= 0) job.acquiredMedia[existingIdx] = media;
        else job.acquiredMedia.push(media);
      } else if (res.allowProcedural) {
        slot.allowProcedural = true;
      } else if (res.retryQuery) {
        slot.query = res.retryQuery;
      }
    }

    job.pendingMedia = job.pendingMedia.filter((s) => !s.resolvedUri && !s.allowProcedural);
    if (job.pendingMedia.length === 0) {
      job.completedStages = [...new Set([...job.completedStages, 'pesquisa', 'aquisicao'])] as ProductionStageState[];
    }
    this.saveJob(job);
    return this.runOrResume(job);
  }

  async start(input: {
    projectId: string;
    prompt: string;
    genre?: CinemaGenre;
    format?: DeliveryFormat;
    targetDurationSec?: number;
    humorIntensity?: number;
    renderProfile?: RenderQualityProfile;
    useNvenc?: boolean;
    seedMediaFiles?: string[];
  }): Promise<StagedProductionJob> {
    const job: StagedProductionJob = {
      projectId: input.projectId,
      prompt: input.prompt,
      ...(input.genre ? { genre: input.genre } : {}),
      ...(input.format ? { format: input.format } : {}),
      targetDurationSec: input.targetDurationSec ?? 36,
      humorIntensity: input.humorIntensity ?? 35,
      renderProfile: input.renderProfile ?? 'review_720p',
      useNvenc: input.useNvenc ?? true,
      state: 'prompt',
      progressPct: 5,
      message: 'Analisando prompt e extraindo intenções de cena...',
      completedStages: ['prompt'],
      acquiredMedia: [],
      pendingMedia: [],
      updatedAt: new Date().toISOString(),
    };

    if (input.seedMediaFiles?.length) {
      for (let i = 0; i < input.seedMediaFiles.length; i += 1) {
        const f = input.seedMediaFiles[i];
        if (!f) continue;
        const m = await buildSourceMediaFromFile(f, `${input.projectId}_seed_${i + 1}`);
        if (m) job.acquiredMedia.push(m);
      }
    }

    this.saveJob(job);
    return this.runOrResume(job);
  }

  async resume(projectId: string): Promise<StagedProductionJob> {
    const job = this.loadJob(projectId);
    if (!job) throw new Error(`not_found: Job ${projectId} não encontrado para retomada.`);
    return this.runOrResume(job);
  }

  private async runOrResume(job: StagedProductionJob): Promise<StagedProductionJob> {
    const existingCtrl = this.controllers.get(job.projectId);
    if (existingCtrl) existingCtrl.abort();
    const ctrl = new AbortController();
    this.controllers.set(job.projectId, ctrl);
    const signal = ctrl.signal;

    const checkCancelled = () => {
      if (signal.aborted) {
        const err = new Error('cancelled: Produção cancelada pelo usuário.');
        err.name = 'AbortError';
        throw err;
      }
    };

    try {
      const queries = extractSceneQueriesFromPrompt(job.prompt, 4);

      // PESQUISA & AQUISIÇÃO
      if (!job.completedStages.includes('aquisicao')) {
        checkCancelled();
        job.state = 'pesquisa';
        job.progressPct = 15;
        job.message = 'Pesquisando referências e inventário local de mídias...';
        this.saveJob(job);

        const localFiles = scanLocalMediaDir(this.deps.mediaDir);
        for (let i = 0; i < localFiles.length && job.acquiredMedia.length < queries.length; i += 1) {
          const f = localFiles[i];
          if (!f) continue;
          if (job.acquiredMedia.some((m) => m.uri === f)) continue;
          const media = await buildSourceMediaFromFile(f, `${job.projectId}_local_${i + 1}`);
          if (media) job.acquiredMedia.push(media);
        }
        job.completedStages = [...new Set([...job.completedStages, 'pesquisa'])] as ProductionStageState[];

        checkCancelled();
        job.state = 'aquisicao';
        job.progressPct = 32;
        job.message = 'Adquirindo e validando mídias reais via FFprobe...';
        this.saveJob(job);

        const pending: PendingMediaSlot[] = [];
        for (let i = 0; i < queries.length; i += 1) {
          checkCancelled();
          if (job.acquiredMedia[i]) continue;
          const query = queries[i] ?? `Cena ${i + 1}`;
          let acquiredUri: string | null = null;
          if (this.deps.acquireExternalMedia) {
            try {
              acquiredUri = await this.deps.acquireExternalMedia(query, i, this.deps.mediaDir, signal);
            } catch {
              acquiredUri = null;
            }
          }
          if (acquiredUri) {
            const media = await buildSourceMediaFromFile(acquiredUri, `${job.projectId}_acq_${i + 1}`);
            if (media) {
              job.acquiredMedia.push(media);
              continue;
            }
          }
          pending.push({
            slotIndex: i,
            clipId: `clip_${i + 1}`,
            query,
            reason: `Nenhuma mídia real encontrada automaticamente para "${query}". Importe um arquivo local, tente outra busca ou autorize geração visual explícita.`,
          });
        }

        if (pending.length > 0) {
          job.pendingMedia = pending;
          job.state = 'paused_pending_media';
          job.progressPct = 38;
          job.message = `${pending.length} mídia(s) pendente(s) antes da montagem final.`;
          return this.saveJob(job);
        }

        job.pendingMedia = [];
        job.completedStages = [...new Set([...job.completedStages, 'aquisicao'])] as ProductionStageState[];
      }

      // ROTEIRO
      checkCancelled();
      job.state = 'roteiro';
      job.progressPct = 50;
      job.message = 'Estruturando roteiro e recuperando memórias dos diretores...';
      this.saveJob(job);
      const activeMemories = this.deps.evolutionCore
        .retrieveRelevantMemories({
          text: job.prompt,
          ...(job.genre ? { genre: job.genre } : {}),
          projectId: job.projectId,
        })
        .map((m) => ({ memoryId: m.memoryId, rule: m.content, directorId: m.directorId }));
      job.completedStages = [...new Set([...job.completedStages, 'roteiro'])] as ProductionStageState[];

      // PLANEJAMENTO
      checkCancelled();
      job.state = 'planejamento';
      job.progressPct = 62;
      job.message = 'Planejando decupagem, planos de câmera, humor e paleta Rec.709...';
      this.saveJob(job);

      const fallbackCatalog: SourceMediaRecord[] =
        job.acquiredMedia.length > 0
          ? job.acquiredMedia
          : queries.map((q, idx) => ({
              mediaId: `${job.projectId}_proc_${idx + 1}`,
              uri: `procedural://${basename(job.projectId)}_${idx + 1}`,
              sha256: createHash('sha256').update(`${job.projectId}_${q}_${idx}`).digest('hex'),
              kind: 'video' as const,
              origin: 'generated' as const,
              license: 'procedural_authorized',
              duration: { value: 180, rate: 30 },
              width: 1280,
              height: 720,
              fps: { value: 30, rate: 1 },
              hasAudio: false,
            }));

      let pkg = produceCinemaPackage({
        projectId: job.projectId,
        prompt: job.prompt,
        ...(job.genre ? { genre: job.genre } : {}),
        ...(job.format ? { format: job.format } : {}),
        targetDurationSec: job.targetDurationSec,
        humorIntensity: job.humorIntensity,
        renderProfile: job.renderProfile,
        mediaCatalog: fallbackCatalog,
        ...(activeMemories.length > 0 ? { appliedMemories: activeMemories } : {}),
      });

      // Mark explicitly authorized procedural slots if no real media was provided
      if (job.acquiredMedia.length === 0) {
        pkg = {
          ...pkg,
          timeline: {
            ...pkg.timeline,
            clips: pkg.timeline.clips.map((c) => ({
              ...c,
              effects: c.effects.some((e) => e.kind === 'allow_procedural')
                ? c.effects
                : [
                    ...c.effects,
                    {
                      effectId: `allow_proc_${c.clipId}`,
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
      }
      job.completedStages = [...new Set([...job.completedStages, 'planejamento'])] as ProductionStageState[];

      // MONTAGEM
      checkCancelled();
      job.state = 'montagem';
      job.progressPct = 74;
      job.message = 'Montando timeline multi-track com clipes, transições e durações reais...';
      this.saveJob(job);
      if (pkg.findings.length > 0) {
        const repaired = applyTargetedRepair(pkg.timeline, pkg.findings, { maxBudget: 3 });
        const scorecard = evaluateEnsemble(repaired.timeline, repaired.timeline.qcFindings);
        const releaseGates = evaluateReleaseGates(repaired.timeline.qcFindings, scorecard);
        pkg = {
          ...pkg,
          timeline: repaired.timeline,
          findings: repaired.timeline.qcFindings,
          scorecard,
          releaseGates,
          repairSummary: repaired,
        };
      }
      this.deps.onPackageReady(pkg, job.prompt);
      job.completedStages = [...new Set([...job.completedStages, 'montagem'])] as ProductionStageState[];

      // ÁUDIO / SFX / VFX
      checkCancelled();
      job.state = 'audio_sfx_vfx';
      job.progressPct = 84;
      job.message = 'Preparando narração, música com ducking, SFX, VFX e cor...';
      this.saveJob(job);
      job.completedStages = [...new Set([...job.completedStages, 'audio_sfx_vfx'])] as ProductionStageState[];

      // PRÉVIA (Render MP4 real)
      checkCancelled();
      job.state = 'previa';
      job.progressPct = 92;
      job.message = 'Renderizando prévia audiovisual sincronizada (FFmpeg)...';
      this.saveJob(job);

      const render = await renderRealCinemaMp4({
        pkg,
        outputDir: this.deps.outputDir,
        fileName: `${job.projectId}.mp4`,
        useNvenc: job.useNvenc,
        requireRealMedia: job.acquiredMedia.length > 0,
        voiceStudioVoiceId: '9190edfa',
        evolution: this.deps.evolutionCore,
        prompt: job.prompt,
        ...(job.genre ? { genre: job.genre } : {}),
      });
      this.deps.onRenderReady(job.projectId, render);
      job.completedStages = [...new Set([...job.completedStages, 'previa', 'editor'])] as ProductionStageState[];

      // EDITOR
      job.state = 'editor';
      job.progressPct = 100;
      job.message = 'Montagem completa pronta no Editor!';
      return this.saveJob(job);
    } catch (err) {
      if ((err instanceof Error && err.name === 'AbortError') || signal.aborted) {
        job.state = 'cancelled';
        job.message = 'Produção cancelada pelo usuário.';
        return this.saveJob(job);
      }
      job.state = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      job.message = `Falha na etapa "${job.state}": ${job.error}`;
      return this.saveJob(job);
    } finally {
      this.controllers.delete(job.projectId);
    }
  }
}
