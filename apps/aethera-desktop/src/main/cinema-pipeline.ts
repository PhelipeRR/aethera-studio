import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import {
  applyTargetedRepair,
  evaluateEnsemble,
  evaluateReleaseGates,
  evaluateRenderedVisualCritic,
  matchNarrationSegmentsToMedia,
  probeRealMp4,
  produceCinemaPackage,
  renderRealCinemaMp4,
  resolveLearnedSceneConstraints,
  runAutonomousSupervisorPass,
  type AetheraEvolutionCore,
  type CinemaGenre,
  type CinemaProductionPackage,
  type DeliveryFormat,
  type NarrativeBeat,
  type RealRenderResult,
  type RenderQualityProfile,
  type ScriptValidationReport,
  type SourceMediaRecord,
} from '@neuralbridge/cinema';
import { CinemaSmartCache, isPathStrictlyInside } from './cinema-cache.js';

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
  voiceStudioVoiceId?: string;
  state: ProductionStageState;
  progressPct: number;
  message: string;
  completedStages: ProductionStageState[];
  acquiredMedia: SourceMediaRecord[];
  pendingMedia: PendingMediaSlot[];
  workspaceDir?: string;
  scriptValidation?: ScriptValidationReport;
  isTechnicalSample?: boolean;
  error?: string;
  startedAt?: string;
  updatedAt: string;
}

export interface SearchCandidate {
  url: string;
  title?: string;
  origin?: string;
  license?: string;
}

export interface StagedPipelineDeps {
  jobsDir: string;
  mediaDir: string;
  outputDir: string;
  workspacesDir?: string;
  cacheDir?: string;
  libraryDir?: string;
  cinemaProjectsDir?: string;
  evolutionCore: AetheraEvolutionCore;
  onProgress?: (job: StagedProductionJob) => void;
  onPackageReady: (pkg: CinemaProductionPackage, prompt: string) => void;
  onRenderReady: (projectId: string, render: RealRenderResult) => void;
  analyzeFrameWithAI?: (
    framePath: string,
    scene: {
      sceneId: string;
      startSec: number;
      durationSec: number;
      narrationText?: string;
      subtitleText?: string;
      hasGameplayHud?: boolean;
      framing?: string;
      sfxCues?: string[];
      vfxEffects?: string[];
    },
  ) => Promise<{
    issue?: string;
    severity?: 'warning' | 'critical';
    suggestedAction?:
      | 'hide_lower_third'
      | 'adjust_typography'
      | 'adjust_vfx'
      | 'adjust_sfx'
      | 'adjust_framing'
      | 'swap_duplicate_clip'
      | 'retry_media_research'
      | 'rerender_scene';
  } | null>;
  searchExternalMedia?: (
    query: string,
    slotIndex: number,
    signal: AbortSignal,
  ) => Promise<SearchCandidate[]>;
  acquireExternalMedia?: (
    query: string,
    slotIndex: number,
    mediaDir: string,
    signal: AbortSignal,
    preferredUrl?: string,
  ) => Promise<string | null>;
  generateAgentScript?: (input: {
    projectId: string;
    prompt: string;
    genre?: CinemaGenre;
    targetDurationSec: number;
    humorIntensity: number;
    queries: string[];
  }) => Promise<{
    treatment?: string;
    beats?: Array<{ stage?: NarrativeBeat['stage']; summary: string }>;
  } | null>;
}

const LOCAL_MEDIA_EXT_RE = /\.(mp4|mov|webm|mkv|png|jpe?g|webp)$/i;

export function extractSceneQueriesFromPrompt(prompt: string, sceneCount = 4): string[] {
  const cleaned = prompt.trim();
  if (!cleaned) return ['Cena principal'];

  // Strip meta-directives (format, tone, duration, humor, structured headers) to isolate the actual subject
  const withoutStructuredFields = cleaned
    .replace(/\b(t[ií]tulo|nicho|dura[çc][ãa]o(\s+alvo)?|tom|objetivo|formato|estilo)\s*:\s*/gi, ' ')
    .replace(/\b(nicho|dura[çc][ãa]o(\s+alvo)?|tom|objetivo)\s*:\s*[^|\n]+/gi, ' ');
  const stripped = withoutStructuredFields
    .replace(/\b(crie|faça|gere|produza|monte)\s+(um|uma)\s+v[ií]deo\s*(cinematogr[áa]fico|épico|curto|longo)?\s*(sobre|de|acerca\s+de)?/gi, ' ')
    .replace(/\bcom\s+narrativa\s+\w+/gi, ' ')
    .replace(/\bhumor\s*(pontual|leve|moderado|forte|\d+%)?/gi, ' ')
    .replace(/\b(e\s+)?dura[çc][ãa]o\s*(de)?\s*\d+\s*(min(utos?)?|seg(undos?)?|s|m)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const quotedTerms = [...cleaned.matchAll(/['"“”]([^'"“”]{2,40})['"“”]/g)].map((m) => m[1]?.trim()).filter(Boolean) as string[];
  const rawTopic = (stripped.split(/[,;|•\n]+/)[0] ?? stripped).replace(/[.,;!?]+$/g, '').trim() || cleaned.slice(0, 60);
  const coreTopic = quotedTerms.length > 0 ? quotedTerms.slice(-2).join(' ') : rawTopic.slice(0, 55);
  const isGaming = /\b(elden ring|game|jogo|boss|chefe|gameplay|soulslike|minecraft|gta|valorant|fortnite|zelda)\b/i.test(cleaned);
  const suffixes = isGaming
    ? ['gameplay no commentary', 'boss fight', 'cinematic', 'best moments', 'highlights', 'trailer']
    : ['cinematic 4k', 'documentary footage', 'scenes', 'overview', 'visuals', 'b-roll'];

  const queries: string[] = [];
  for (let i = 0; i < sceneCount; i += 1) {
    const suffix = suffixes[i % suffixes.length] ?? '';
    queries.push(`${coreTopic} ${suffix}`.trim().slice(0, 90));
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
  readonly workspacesDir: string;
  readonly cacheDir: string;
  readonly cache: CinemaSmartCache;

  constructor(private readonly deps: StagedPipelineDeps) {
    mkdirSync(deps.jobsDir, { recursive: true });
    mkdirSync(deps.mediaDir, { recursive: true });
    const baseDir = dirname(deps.jobsDir);
    this.workspacesDir = deps.workspacesDir ?? join(baseDir, 'cinema-workspaces');
    this.cacheDir = deps.cacheDir ?? join(baseDir, 'cinema-cache');
    mkdirSync(this.workspacesDir, { recursive: true });
    this.cache = new CinemaSmartCache(this.cacheDir);
  }

  getProjectPaths(projectId: string) {
    const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const root = join(this.workspacesDir, safeId);
    return {
      safeId,
      root,
      mediaDir: join(root, 'media'),
      narrationDir: join(root, 'narration'),
      rendersDir: join(root, 'renders'),
      thumbsDir: join(root, 'thumbs'),
      tempDir: join(root, 'temp'),
      metadataFile: join(root, 'metadata.json'),
    };
  }

  private ensureProjectWorkspace(projectId: string, prompt: string) {
    const paths = this.getProjectPaths(projectId);
    mkdirSync(paths.mediaDir, { recursive: true });
    mkdirSync(paths.narrationDir, { recursive: true });
    mkdirSync(paths.rendersDir, { recursive: true });
    mkdirSync(paths.thumbsDir, { recursive: true });
    mkdirSync(paths.tempDir, { recursive: true });
    if (!existsSync(paths.metadataFile)) {
      writeFileSync(
        paths.metadataFile,
        JSON.stringify(
          {
            projectId,
            prompt,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      );
    }
    return paths;
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

  inspectProjectDeletion(projectId: string): {
    projectId: string;
    workspaceDir: string;
    itemsToRemove: string[];
    preservedGlobalLibrary: boolean;
    sharedCacheEntriesPreserved: number;
  } {
    const paths = this.getProjectPaths(projectId);
    const itemsToRemove: string[] = [];
    if (existsSync(paths.mediaDir) && readdirSync(paths.mediaDir).length > 0) {
      itemsToRemove.push(`Mídias adquiridas exclusivas (${readdirSync(paths.mediaDir).length} arquivo(s))`);
    } else {
      itemsToRemove.push('Mídias adquiridas exclusivas do projeto');
    }
    itemsToRemove.push('Narrações, renders MP4, thumbnails e arquivos temporários');
    itemsToRemove.push('Roteiro, timeline, metadados e histórico de produção');

    const cacheEntries = this.cache.listEntries();
    const sharedCacheEntriesPreserved = cacheEntries.filter(
      (e) => e.consumers.includes(projectId) && e.consumers.some((id) => id !== projectId),
    ).length;

    return {
      projectId,
      workspaceDir: paths.root,
      itemsToRemove,
      preservedGlobalLibrary: true,
      sharedCacheEntriesPreserved,
    };
  }

  deleteJob(projectId: string): {
    deleted: boolean;
    removedPaths: string[];
    preservedSharedEntries: number;
  } {
    const ctrl = this.controllers.get(projectId);
    if (ctrl) {
      ctrl.abort();
      this.controllers.delete(projectId);
    }

    const removedPaths: string[] = [];
    const safeId = projectId.replace(/[^a-zA-Z0-9_-]/g, '_');
    const paths = this.getProjectPaths(projectId);

    const isProtectedLibrary = (p: string) =>
      Boolean(this.deps.libraryDir && (isPathStrictlyInside(p, this.deps.libraryDir) || p === this.deps.libraryDir));

    if (
      existsSync(paths.root) &&
      isPathStrictlyInside(paths.root, this.workspacesDir) &&
      !isProtectedLibrary(paths.root)
    ) {
      rmSync(paths.root, { recursive: true, force: true });
      removedPaths.push(paths.root);
    }

    const jobFile = this.jobFile(projectId);
    if (existsSync(jobFile) && isPathStrictlyInside(jobFile, this.deps.jobsDir)) {
      unlinkSync(jobFile);
      removedPaths.push(jobFile);
    }

    const legacyRenderFile = join(this.deps.outputDir, `${safeId}.mp4`);
    if (existsSync(legacyRenderFile) && isPathStrictlyInside(legacyRenderFile, this.deps.outputDir)) {
      unlinkSync(legacyRenderFile);
      removedPaths.push(legacyRenderFile);
    }

    if (this.deps.cinemaProjectsDir) {
      const projectJson = join(this.deps.cinemaProjectsDir, `${safeId}.json`);
      if (existsSync(projectJson) && isPathStrictlyInside(projectJson, this.deps.cinemaProjectsDir)) {
        unlinkSync(projectJson);
        removedPaths.push(projectJson);
      }
    }

    const cacheRelease = this.cache.releaseConsumer(projectId);
    removedPaths.push(...cacheRelease.removedCacheFiles);

    return {
      deleted: removedPaths.length > 0,
      removedPaths,
      preservedSharedEntries: cacheRelease.preservedSharedEntries,
    };
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
    voiceStudioVoiceId?: string;
    seedMediaFiles?: string[];
  }): Promise<StagedProductionJob> {
    const projectPaths = this.ensureProjectWorkspace(input.projectId, input.prompt);
    const job: StagedProductionJob = {
      projectId: input.projectId,
      prompt: input.prompt,
      ...(input.genre ? { genre: input.genre } : {}),
      ...(input.format ? { format: input.format } : {}),
      targetDurationSec: input.targetDurationSec ?? 36,
      humorIntensity: input.humorIntensity ?? 35,
      renderProfile: input.renderProfile ?? 'review_720p',
      useNvenc: input.useNvenc ?? true,
      ...(input.voiceStudioVoiceId ? { voiceStudioVoiceId: input.voiceStudioVoiceId } : {}),
      state: 'prompt',
      progressPct: 5,
      message: 'Analisando prompt e extraindo intenções de cena...',
      completedStages: ['prompt'],
      acquiredMedia: [],
      pendingMedia: [],
      workspaceDir: projectPaths.root,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (input.seedMediaFiles?.length) {
      for (let i = 0; i < input.seedMediaFiles.length; i += 1) {
        const f = input.seedMediaFiles[i];
        if (!f) continue;
        const dest = join(projectPaths.mediaDir, `seed_${i + 1}${extname(f) || '.mp4'}`);
        if (existsSync(f) && f !== dest) {
          copyFileSync(f, dest);
        }
        const m = await buildSourceMediaFromFile(existsSync(dest) ? dest : f, `${input.projectId}_seed_${i + 1}`);
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
      const projectPaths = this.ensureProjectWorkspace(job.projectId, job.prompt);
      job.workspaceDir = projectPaths.root;
      const queries = extractSceneQueriesFromPrompt(job.prompt, 4);

      // PESQUISA & AQUISIÇÃO (sempre contextual e isolada por projeto; nunca reaproveita pasta global cegamente)
      if (!job.completedStages.includes('aquisicao')) {
        checkCancelled();
        job.state = 'pesquisa';
        job.progressPct = 15;
        job.message = 'Executando pesquisa contextual e verificando cache inteligente para o projeto...';
        this.saveJob(job);

        // Apenas arquivos já pertencentes ao diretório exclusivo DESTE projeto (em caso de retomada)
        const ownProjectFiles = scanLocalMediaDir(projectPaths.mediaDir);
        for (let i = 0; i < ownProjectFiles.length && job.acquiredMedia.length < queries.length; i += 1) {
          const f = ownProjectFiles[i];
          if (!f) continue;
          if (job.acquiredMedia.some((m) => m.uri === f)) continue;
          const media = await buildSourceMediaFromFile(f, `${job.projectId}_own_${i + 1}`);
          if (media) job.acquiredMedia.push(media);
        }
        job.completedStages = [...new Set([...job.completedStages, 'pesquisa'])] as ProductionStageState[];

        checkCancelled();
        job.state = 'aquisicao';
        job.progressPct = 32;
        job.message = 'Adquirindo mídias contextuais no workspace isolado do projeto...';
        this.saveJob(job);

        const pending: PendingMediaSlot[] = [];
        for (let i = 0; i < queries.length; i += 1) {
          checkCancelled();
          if (job.acquiredMedia[i]) continue;
          const query = queries[i] ?? `Cena ${i + 1}`;
          let acquiredUri: string | null = null;
          let matchedCandidate: SearchCandidate | undefined;

          if (this.deps.searchExternalMedia) {
            try {
              const candidates = await this.deps.searchExternalMedia(query, i, signal);
              matchedCandidate = candidates[i % Math.max(1, candidates.length)] ?? candidates[0];
              if (matchedCandidate?.url) {
                const cacheHit = this.cache.findVerifiedMatch({
                  url: matchedCandidate.url,
                  topic: `${job.prompt} ${query}`,
                });
                if (cacheHit) {
                  const isolatedPath = join(
                    projectPaths.mediaDir,
                    `cached_${i + 1}${extname(cacheHit.filePath) || '.mp4'}`,
                  );
                  copyFileSync(cacheHit.filePath, isolatedPath);
                  this.cache.registerConsumer({
                    url: cacheHit.url,
                    origin: cacheHit.origin,
                    license: cacheHit.license,
                    topic: cacheHit.topic,
                    query,
                    sourceFilePath: isolatedPath,
                    width: cacheHit.width,
                    height: cacheHit.height,
                    durationSec: cacheHit.durationSec,
                    projectId: job.projectId,
                  });
                  acquiredUri = isolatedPath;
                }
              }
            } catch {
              matchedCandidate = undefined;
            }
          }

          if (!acquiredUri && this.deps.acquireExternalMedia) {
            try {
              acquiredUri = await this.deps.acquireExternalMedia(
                query,
                i,
                projectPaths.mediaDir,
                signal,
                matchedCandidate?.url,
              );
            } catch {
              acquiredUri = null;
            }
          }

          if (acquiredUri) {
            const media = await buildSourceMediaFromFile(acquiredUri, `${job.projectId}_acq_${i + 1}`);
            if (media) {
              const durationSec = media.duration.value / Math.max(1, media.duration.rate);
              this.cache.registerConsumer({
                url: matchedCandidate?.url ?? `local://${job.projectId}/${i + 1}/${encodeURIComponent(query)}`,
                origin: matchedCandidate?.origin ?? 'yt_dlp_or_external',
                license: matchedCandidate?.license ?? media.license,
                topic: job.prompt,
                query,
                sourceFilePath: media.uri,
                width: media.width ?? 1280,
                height: media.height ?? 720,
                durationSec,
                projectId: job.projectId,
              });
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

      // ROTEIRO (agentes RF-07 + diretores + validação proporcional à duração)
      checkCancelled();
      job.state = 'roteiro';
      job.progressPct = 50;
      job.message = 'Desenvolvendo roteiro proporcional e recuperando memórias dos diretores RF-07...';
      this.saveJob(job);
      const activeMemories = this.deps.evolutionCore
        .retrieveRelevantMemories({
          text: job.prompt,
          ...(job.genre ? { genre: job.genre } : {}),
          projectId: job.projectId,
        })
        .map((m) => ({ memoryId: m.memoryId, rule: m.content, directorId: m.directorId }));

      let externalDirection:
        | { treatment?: string; beats?: Array<{ stage?: NarrativeBeat['stage']; summary: string }> }
        | undefined;
      if (this.deps.generateAgentScript) {
        try {
          const generated = await this.deps.generateAgentScript({
            projectId: job.projectId,
            prompt: job.prompt,
            ...(job.genre ? { genre: job.genre } : {}),
            targetDurationSec: job.targetDurationSec,
            humorIntensity: job.humorIntensity,
            queries,
          });
          if (generated && (generated.beats?.length || generated.treatment)) {
            externalDirection = generated;
          }
        } catch {
          externalDirection = undefined;
        }
      }
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
        ...(externalDirection ? { externalDirection } : {}),
      });
      job.scriptValidation = pkg.scriptValidation;

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
      // Etapa C (Academy Production Learning): aplicar restrições aprendidas antes da montagem
      const learnedConstraints = resolveLearnedSceneConstraints(this.deps.evolutionCore, {
        prompt: job.prompt,
        ...(job.genre ? { genre: job.genre } : {}),
        hasGameplayHud: job.genre === 'gameplay_essay',
      });
      if (learnedConstraints.avoidHudOverlap) {
        pkg = {
          ...pkg,
          timeline: {
            ...pkg.timeline,
            clips: pkg.timeline.clips.map((c) =>
              c.trackId === 'v1'
                ? {
                    ...c,
                    effects: c.effects.some((e) => e.kind === 'hide_title')
                      ? c.effects
                      : [
                          ...c.effects,
                          {
                            effectId: `learned_no_hud_${c.clipId}`,
                            kind: 'hide_title',
                            params: { reason: 'academy_avoid_hud_overlap' },
                            enabled: true,
                            estimatedCostMs: 0,
                            fallbackMode: 'skip',
                          },
                        ],
                  }
                : c,
            ),
          },
        };
      }

      // Etapa B (Semantic Editing): correlacionar segmentos de narração às mídias adquiridas
      if (job.acquiredMedia.length > 0 && pkg.direction.narrativeBeats.length > 0) {
        const videoTrackClips = pkg.timeline.clips.filter((c) => c.trackId === 'v1');
        const segments = pkg.direction.narrativeBeats.slice(0, videoTrackClips.length).map((beat, idx) => {
          const clip = videoTrackClips[idx];
          const startSec = clip ? clip.timelineRange.start.value / Math.max(1, clip.timelineRange.start.rate) : idx * 6;
          const durSec = clip ? clip.timelineRange.duration.value / Math.max(1, clip.timelineRange.duration.rate) : 6;
          return {
            segmentId: clip?.clipId ?? beat.beatId,
            startSec,
            endSec: startSec + durSec,
            text: `${beat.stage} ${beat.summary}`,
          };
        });
        const mediaDescriptors = job.acquiredMedia.map((m) => ({
          mediaId: m.mediaId,
          title: basename(m.uri),
          durationSec: m.duration.value / Math.max(1, m.duration.rate),
          tags: [m.kind, m.origin],
        }));
        const semanticMatches = matchNarrationSegmentsToMedia(segments, mediaDescriptors);
        const matchByClipId = new Map(semanticMatches.map((m) => [m.segmentId, m]));
        pkg = {
          ...pkg,
          timeline: {
            ...pkg.timeline,
            clips: pkg.timeline.clips.map((c) => {
              const hit = matchByClipId.get(c.clipId);
              return hit && hit.mediaId && hit.score > 0 ? { ...c, mediaId: hit.mediaId } : c;
            }),
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

      // PRÉVIA (Render MP4 real + Cache Incremental + AI Visual Critic + Supervisor sem loop)
      checkCancelled();
      job.state = 'previa';
      job.progressPct = 92;
      job.message = 'Renderizando prévia audiovisual sincronizada (FFmpeg)...';
      this.saveJob(job);

      const segmentCacheDir = join(projectPaths.tempDir, 'segment-cache');
      let render = await renderRealCinemaMp4({
        pkg,
        outputDir: projectPaths.rendersDir,
        fileName: `${job.projectId}.mp4`,
        useNvenc: job.useNvenc,
        requireRealMedia: job.acquiredMedia.length > 0,
        voiceStudioVoiceId: job.voiceStudioVoiceId || '9190edfa',
        evolution: this.deps.evolutionCore,
        prompt: job.prompt,
        previewQuality: 'fast_preview',
        segmentCacheDir,
        ...(job.genre ? { genre: job.genre } : {}),
      });

      const v1Clips = pkg.timeline.clips.filter((c) => c.trackId === 'v1');
      const sfxTrackClips = pkg.timeline.clips.filter((c) => c.trackId === 'a4_sfx' || c.trackId === 'sfx');
      const buildSceneSpecs = (clips: typeof v1Clips) =>
        clips.map((c, idx) => {
          const startSec = c.timelineRange.start.value / Math.max(1, c.timelineRange.start.rate);
          const durationSec = c.timelineRange.duration.value / Math.max(1, c.timelineRange.duration.rate);
          const sceneSfx = sfxTrackClips
            .filter((s) => {
              const sStart = s.timelineRange.start.value / Math.max(1, s.timelineRange.start.rate);
              return sStart >= startSec && sStart < startSec + durationSec;
            })
            .map((s) => s.label || s.clipId);
          return {
            sceneId: c.clipId,
            startSec,
            durationSec,
            sourceMediaId: c.mediaId,
            hasTextOverlay: !c.effects.some((e) => e.kind === 'hide_title' && e.enabled),
            hasGameplayHud: job.genre === 'gameplay_essay',
            vfxEffects: c.effects.filter((e) => e.enabled).map((e) => e.kind),
            sfxCues: sceneSfx,
            ...(pkg.direction.narrativeBeats[idx]?.summary ? { narrationText: pkg.direction.narrativeBeats[idx].summary } : {}),
          };
        });

      const critic1 = await evaluateRenderedVisualCritic({
        projectId: job.projectId,
        mp4Path: render.mp4Path,
        framesDir: join(projectPaths.tempDir, 'visual-critic'),
        prompt: job.prompt,
        ...(job.genre ? { genre: job.genre } : {}),
        scenes: buildSceneSpecs(v1Clips),
        ...(render.anomalies ? { anomalies: render.anomalies } : {}),
        evolution: this.deps.evolutionCore,
        ...(this.deps.analyzeFrameWithAI ? { analyzeFrameWithAI: this.deps.analyzeFrameWithAI } : {}),
      });
      const sup1 = runAutonomousSupervisorPass(critic1, {
        attempt: 1,
        maxAttempts: 2,
        previousActionSignatures: [],
      });

      if (sup1.status === 'needs_repair' && sup1.rerenderSceneIds.length > 0) {
        const repairIds = new Set(sup1.rerenderSceneIds);
        const recoveredMediaByScene = new Map<string, string>();
        if (
          sup1.retryResearchSceneIds.length > 0 &&
          this.deps.searchExternalMedia &&
          this.deps.acquireExternalMedia
        ) {
          for (const [rIdx, sceneId] of sup1.retryResearchSceneIds.entries()) {
            const clipIdx = v1Clips.findIndex((c) => c.clipId === sceneId);
            const sceneBeat = clipIdx >= 0 ? pkg.direction.narrativeBeats[clipIdx] : undefined;
            const recoveryQuery = (sceneBeat?.summary ?? job.prompt)
              .replace(/[^\p{L}\p{N}\s:.-]/gu, ' ')
              .trim()
              .slice(0, 90);
            try {
              const candidates = await this.deps.searchExternalMedia(
                `${recoveryQuery} gameplay trailer`,
                10 + rIdx,
                signal,
              );
              const pickedUrl = candidates[0]?.url;
              const downloadedPath = await this.deps.acquireExternalMedia(
                `${recoveryQuery} gameplay trailer`,
                10 + rIdx,
                projectPaths.mediaDir,
                signal,
                pickedUrl,
              );
              if (downloadedPath) {
                const recoveredRecord = await buildSourceMediaFromFile(
                  downloadedPath,
                  `${job.projectId}_rec_${sceneId}`,
                );
                if (recoveredRecord) {
                  job.acquiredMedia = [...job.acquiredMedia, recoveredRecord];
                  pkg = {
                    ...pkg,
                    timeline: {
                      ...pkg.timeline,
                      sourceMedia: {
                        ...pkg.timeline.sourceMedia,
                        [recoveredRecord.mediaId]: recoveredRecord,
                      },
                    },
                  };
                  recoveredMediaByScene.set(sceneId, recoveredRecord.mediaId);
                }
              }
            } catch {
              // Non-fatal: falls back to existing alternate pool or escalates
            }
          }
        }

        const altMediaPool = job.acquiredMedia.map((m) => m.mediaId);
        pkg = {
          ...pkg,
          timeline: {
            ...pkg.timeline,
            clips: pkg.timeline.clips.map((c) => {
              if (!repairIds.has(c.clipId)) return c;
              const needHideTitle = sup1.actions.some((a) => a.sceneId === c.clipId && a.action === 'hide_lower_third');
              const needSwapClip = sup1.actions.some(
                (a) => a.sceneId === c.clipId && (a.action === 'swap_duplicate_clip' || a.action === 'retry_media_research'),
              );
              const needBlackTrim = sup1.actions.some(
                (a) => a.sceneId === c.clipId && a.action === 'rerender_scene' && /frame preto|black/i.test(a.reason),
              );
              const needAdjustVfx = sup1.actions.some((a) => a.sceneId === c.clipId && a.action === 'adjust_vfx');
              const needAdjustTypo = sup1.actions.some((a) => a.sceneId === c.clipId && a.action === 'adjust_typography');
              const recoveredId = recoveredMediaByScene.get(c.clipId);
              const nextMediaId = recoveredId
                ? recoveredId
                : needSwapClip && altMediaPool.length > 1
                  ? altMediaPool.find((id) => id !== c.mediaId) ?? c.mediaId
                  : c.mediaId;
              const nextSourceRange = needBlackTrim
                ? {
                    ...c.sourceRange,
                    start: {
                      ...c.sourceRange.start,
                      value: c.sourceRange.start.value + 4 * Math.max(1, c.sourceRange.start.rate),
                    },
                  }
                : c.sourceRange;
              let nextEffects = c.effects.map((e) =>
                needAdjustVfx && /blur|shake|glitch|glow/i.test(e.kind) ? { ...e, enabled: false } : e,
              );
              if (needHideTitle && !nextEffects.some((e) => e.kind === 'hide_title')) {
                nextEffects = [
                  ...nextEffects,
                  {
                    effectId: `sup_hide_title_${c.clipId}`,
                    kind: 'hide_title',
                    params: { reason: 'supervisor_targeted_repair' },
                    enabled: true,
                    estimatedCostMs: 0,
                    fallbackMode: 'skip',
                  },
                ];
              }
              if (needAdjustTypo && !nextEffects.some((e) => e.kind === 'safe_typography')) {
                nextEffects = [
                  ...nextEffects,
                  {
                    effectId: `sup_safe_typo_${c.clipId}`,
                    kind: 'safe_typography',
                    params: { maxCharsPerLine: 42, scale: 0.9 },
                    enabled: true,
                    estimatedCostMs: 0,
                    fallbackMode: 'skip',
                  },
                ];
              }
              return {
                ...c,
                mediaId: nextMediaId,
                sourceRange: nextSourceRange,
                effects: nextEffects,
              };
            }),
          },
        };
        this.deps.onPackageReady(pkg, job.prompt);
        render = await renderRealCinemaMp4({
          pkg,
          outputDir: projectPaths.rendersDir,
          fileName: `${job.projectId}.mp4`,
          useNvenc: job.useNvenc,
          requireRealMedia: job.acquiredMedia.length > 0,
          voiceStudioVoiceId: job.voiceStudioVoiceId || '9190edfa',
          evolution: this.deps.evolutionCore,
          prompt: job.prompt,
          previewQuality: 'fast_preview',
          segmentCacheDir,
          ...(job.genre ? { genre: job.genre } : {}),
        });

        const critic2 = await evaluateRenderedVisualCritic({
          projectId: job.projectId,
          mp4Path: render.mp4Path,
          framesDir: join(projectPaths.tempDir, 'visual-critic'),
          prompt: job.prompt,
          ...(job.genre ? { genre: job.genre } : {}),
          scenes: buildSceneSpecs(pkg.timeline.clips.filter((c) => c.trackId === 'v1')),
          ...(render.anomalies ? { anomalies: render.anomalies } : {}),
          evolution: this.deps.evolutionCore,
          ...(this.deps.analyzeFrameWithAI ? { analyzeFrameWithAI: this.deps.analyzeFrameWithAI } : {}),
        });
        runAutonomousSupervisorPass(critic2, {
          attempt: 2,
          maxAttempts: 2,
          previousActionSignatures: sup1.actions.map((a) => `${a.sceneId}:${a.action}`),
        });
      }

      job.isTechnicalSample = render.isTechnicalSample;
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
