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
  evaluateMediaRelevance,
  evaluateReleaseGates,
  evaluateRenderedVisualCritic,
  expandScriptOrientedQueries,
  extractTopicEntities,
  isCacheEntryCompatibleWithProject,
  matchNarrationSegmentsToMedia,
  planMediaCoverage,
  probeRealMp4,
  produceCinemaPackage,
  renderRealCinemaMp4,
  resolveLearnedSceneConstraints,
  runAutonomousMediaAcquisition,
  runAutonomousSupervisorPass,
  type AetheraEvolutionCore,
  type AutonomousAcquisitionAuditReport,
  type CinemaGenre,
  type CinemaProductionPackage,
  type DeliveryFormat,
  type DistributedFrameAnalysis,
  type MediaCoverageReport,
  type MediaRelevanceDecision,
  type NarrativeBeat,
  type RealRenderResult,
  type RenderQualityProfile,
  type ResilientAcquisitionDeps,
  type ScriptSegmentExpectation,
  type ScriptValidationReport,
  type SourceMediaRecord,
  buildEditorialScript,
  type EditorialScript,
  interpretProductionPrompt,
  validateEditorialResearchDossier,
  validateScriptAgainstDossier,
  buildSemanticDecupagem,
  computeIncrementalInvalidation,
  buildEditorialRecoveryPlan,
  type PromptInterpretation,
  type EditorialResearchDossier,
  type SemanticSceneCut,
  type IncrementalInvalidationReport,
  type EditorialRecoveryStep,
  buildEditorialTraceabilityGraph,
  createEmptyEditorialAuditTrail,
  runEditorialIntegrityChecks,
  type EditorialAuditTrail,
  type GroundingEvidenceRecord,
  type MediaCandidateRecord,
  type MediaQueryRecord,
  type TimelinePlacementRecord,
} from '@neuralbridge/cinema';
import { CinemaSmartCache, isPathStrictlyInside } from './cinema-cache.js';

export type ProductionStageState =
  | 'idle'
  | 'prompt'
  | 'interpretacao'
  | 'pesquisa'
  | 'roteiro'
  | 'decupagem'
  | 'aquisicao'
  | 'validacao_visual'
  | 'planejamento'
  | 'montagem'
  | 'audio_sfx_vfx'
  | 'qc'
  | 'previa'
  | 'editor'
  | 'paused_pending_research'
  | 'paused_pending_media'
  | 'paused_pending_script'
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
  language?: string;
  allowDeterministicScriptFallback?: boolean;
  acquisitionBudgetMultiplier?: number;
  editorialScript?: EditorialScript;
  interpretation?: PromptInterpretation;
  researchDossier?: EditorialResearchDossier;
  sceneDecupagem?: SemanticSceneCut[];
  invalidationReport?: IncrementalInvalidationReport;
  editorialRecoveryPlans?: Array<{ sceneId: string; steps: EditorialRecoveryStep[] }>;
  editorialAudit?: EditorialAuditTrail;
  state: ProductionStageState;
  progressPct: number;
  message: string;
  completedStages: ProductionStageState[];
  acquiredMedia: SourceMediaRecord[];
  pendingMedia: PendingMediaSlot[];
  workspaceDir?: string;
  scriptValidation?: ScriptValidationReport;
  mediaRelevanceDecisions?: MediaRelevanceDecision[];
  coverageReport?: MediaCoverageReport;
  autonomousAudit?: AutonomousAcquisitionAuditReport;
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
  analyzeFrames?: (
    uri: string,
    timestampsSec: number[],
    segment: ScriptSegmentExpectation,
  ) => Promise<DistributedFrameAnalysis[]>;
  requireVisualVerification?: boolean;
  autonomousAcquisitionDeps?: ResilientAcquisitionDeps;
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
  runEditorialResearch?: (
    interpretation: PromptInterpretation,
    signal: AbortSignal,
  ) => Promise<EditorialResearchDossier | null>;
  generateAgentScript?: (input: {
    projectId: string;
    prompt: string;
    genre?: CinemaGenre;
    language?: string;
    targetDurationSec: number;
    humorIntensity: number;
    queries: string[];
    interpretation?: PromptInterpretation;
    researchDossier?: EditorialResearchDossier;
  }) => Promise<{
    treatment?: string;
    beats?: Array<{ stage?: NarrativeBeat['stage']; summary: string }>;
    providerUsed?: string;
    academyRulesApplied?: string[];
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

  reviewGroundingEvidence(input: {
    projectId: string;
    candidateId: string;
    decision: 'approved' | 'rejected';
    note?: string;
  }): StagedProductionJob | null {
    const existing = this.loadJob(input.projectId);
    if (!existing?.editorialAudit) return null;
    const ev = existing.editorialAudit.groundingEvidences.find((g) => g.candidateId === input.candidateId);
    if (!ev) return null;
    const now = new Date().toISOString();
    ev.humanReview = {
      status: input.decision,
      ...(input.note ? { reviewerNote: input.note } : {}),
      reviewedAt: now,
    };
    ev.decision = input.decision;
    ev.decisionReason = `Revisão humana: ${input.decision}${input.note ? ` — ${input.note}` : ''}`;
    const cand = existing.editorialAudit.candidates.find((c) => c.candidateId === input.candidateId);
    if (cand) {
      cand.status = input.decision;
      if (input.decision === 'rejected' && input.note) cand.rejectionReason = input.note;
    }
    existing.editorialAudit.events.push({
      eventId: `evt_hr_${Date.now()}`,
      timestamp: now,
      stage: 'human_review',
      sceneId: ev.sceneId,
      message: `Revisão humana (${input.decision}) para candidato ${input.candidateId}`,
    });
    existing.editorialAudit.integrityReport = runEditorialIntegrityChecks({
      ...(existing.interpretation ? { interpretation: existing.interpretation } : {}),
      ...(existing.researchDossier ? { dossier: existing.researchDossier } : {}),
      trail: existing.editorialAudit,
    });
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
    language?: string;
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
      ...(input.language ? { language: input.language } : {}),
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
      const relevanceDecisions: MediaRelevanceDecision[] = [...(job.mediaRelevanceDecisions ?? [])];

      // 1. INTERPRETAÇÃO DO PROMPT + INCREMENTALIDADE
      checkCancelled();
      job.state = 'interpretacao';
      job.progressPct = 8;
      job.message = 'Interpretando prompt, obra, entidades e critérios editoriais...';
      const nextInterpretation = interpretProductionPrompt(job.prompt, {
        ...(job.genre ? { genre: job.genre } : {}),
        targetDurationSec: job.targetDurationSec,
        humorIntensity: job.humorIntensity,
        ...(job.language ? { language: job.language } : {}),
      });
      const invalidation = computeIncrementalInvalidation({
        ...(job.interpretation?.promptHash ? { previousPromptHash: job.interpretation.promptHash } : {}),
        nextInterpretation,
        ...(job.researchDossier ? { previousDossier: job.researchDossier, nextDossier: job.researchDossier } : {}),
        ...(job.sceneDecupagem ? { previousScenes: job.sceneDecupagem, nextScenes: job.sceneDecupagem } : {}),
      });
      job.invalidationReport = invalidation;
      if (!invalidation.researchValid) {
        delete job.researchDossier;
        delete job.editorialScript;
        delete job.sceneDecupagem;
        job.completedStages = job.completedStages.filter(
          (s) => s !== 'pesquisa' && s !== 'roteiro' && s !== 'decupagem' && s !== 'aquisicao' && s !== 'validacao_visual',
        );
      }
      job.interpretation = nextInterpretation;
      job.completedStages = [...new Set([...job.completedStages, 'prompt', 'interpretacao'])] as ProductionStageState[];
      this.saveJob(job);

      // 2. PESQUISA EDITORIAL ESTRUTURADA (antes do roteiro e da aquisição)
      if (!job.completedStages.includes('pesquisa') || !job.researchDossier) {
        checkCancelled();
        job.state = 'pesquisa';
        job.progressPct = 18;
        job.message = `Pesquisando fatos, entidades e critérios sobre ${nextInterpretation.workTitle}...`;
        this.saveJob(job);

        if (this.deps.runEditorialResearch) {
          const dossier = await this.deps.runEditorialResearch(nextInterpretation, signal);
          const check = validateEditorialResearchDossier(dossier, nextInterpretation);
          if (!dossier || !check.valid) {
            job.state = 'paused_pending_research';
            job.progressPct = 20;
            job.error = `research_failed: ${check.reasons.join(' | ')}`;
            job.message =
              `Pesquisa editorial incompleta (${check.reasons[0] ?? 'sem dossiê válido'}). Nenhum fato foi inventado — clique em Retomar Projeto para tentar novamente.`;
            this.saveJob(job);
            return job;
          }
          job.researchDossier = dossier;
        }
        job.completedStages = [...new Set([...job.completedStages, 'pesquisa'])] as ProductionStageState[];
        this.saveJob(job);
      }

      // 3. ROTEIRO BASEADO NA PESQUISA (antes da decupagem e da aquisição)
      checkCancelled();
      job.state = 'roteiro';
      job.progressPct = 32;
      job.message = 'Desenvolvendo roteiro factual e narrativo baseado na pesquisa...';
      this.saveJob(job);
      const activeMemories = this.deps.evolutionCore
        .retrieveRelevantMemories({
          text: job.prompt,
          ...(job.genre ? { genre: job.genre } : {}),
          projectId: job.projectId,
        })
        .map((m) => ({ memoryId: m.memoryId, rule: m.content, directorId: m.directorId }));

      const researchQueries =
        job.researchDossier?.entities.map((e) => `${job.researchDossier!.workTitle} ${e.entityName}`) ??
        extractSceneQueriesFromPrompt(
          job.prompt,
          Math.max(4, Math.min(16, Math.ceil((job.targetDurationSec ?? 90) / 45))),
        );

      let externalDirection:
        | {
            treatment?: string;
            beats?: Array<{ stage?: NarrativeBeat['stage']; summary: string }>;
            providerUsed?: string;
            academyRulesApplied?: string[];
          }
        | undefined;
      if (!job.editorialScript && this.deps.generateAgentScript) {
        try {
          const generated = await this.deps.generateAgentScript({
            projectId: job.projectId,
            prompt: job.prompt,
            ...(job.genre ? { genre: job.genre } : {}),
            ...(job.language ? { language: job.language } : {}),
            targetDurationSec: job.targetDurationSec,
            humorIntensity: job.humorIntensity,
            queries: researchQueries,
            interpretation: nextInterpretation,
            ...(job.researchDossier ? { researchDossier: job.researchDossier } : {}),
          });
          if (generated && (generated.beats?.length || generated.treatment)) {
            externalDirection = generated;
          }
        } catch {
          externalDirection = undefined;
        }
        if (!externalDirection && !job.allowDeterministicScriptFallback) {
          job.state = 'paused_pending_script';
          job.progressPct = 34;
          job.error = 'script_generation_failed';
          job.message =
            'Todos os agentes falharam ao gerar o roteiro. Nenhum template genérico foi usado silenciosamente — clique em Retomar Projeto para tentar novamente.';
          this.saveJob(job);
          return job;
        }
      }
      if (externalDirection?.beats?.length) {
        const beatDur = Math.max(
          4,
          Math.round(job.targetDurationSec / externalDirection.beats.length),
        );
        job.editorialScript = buildEditorialScript({
          scriptId: `${job.projectId}_script`,
          source: 'agent',
          ...(externalDirection.providerUsed ? { providerUsed: externalDirection.providerUsed } : {}),
          treatment: externalDirection.treatment ?? job.prompt,
          academyRulesApplied: externalDirection.academyRulesApplied ?? [],
          segments: externalDirection.beats.map((b, idx) => ({
            segmentId: `seg_${idx + 1}`,
            beatId: `nbeat_${idx + 1}_${b.stage ?? 'progression'}`,
            stage: b.stage ?? 'progression',
            title: `Cena ${idx + 1}`,
            spokenText: b.summary,
            estimatedDurationSec: beatDur,
            approved: true,
          })),
        });
      } else if (!job.editorialScript && job.allowDeterministicScriptFallback && job.researchDossier) {
        const dossier = job.researchDossier;
        const entityBeats = dossier.entities.map((ent, idx) => ({
          segmentId: `seg_${idx + 2}`,
          beatId: `nbeat_${idx + 2}_progression`,
          stage: (idx === dossier.entities.length - 1 ? 'climax' : 'progression') as NarrativeBeat['stage'],
          title: ent.rankPosition ? `#${ent.rankPosition} — ${ent.entityName}` : ent.entityName,
          spokenText: `${ent.entityName} em ${dossier.workTitle}: ${ent.mechanicsOrEvents[0] ?? ent.verifiedFacts[0] ?? ent.role}.`,
          estimatedDurationSec: Math.max(12, Math.round(job.targetDurationSec / Math.max(2, dossier.entities.length + 2))),
          approved: true,
        }));
        job.editorialScript = buildEditorialScript({
          scriptId: `${job.projectId}_script`,
          source: 'deterministic_draft',
          treatment: `${dossier.workTitle}: ${dossier.theme}`,
          academyRulesApplied: [],
          segments: [
            {
              segmentId: 'seg_1',
              beatId: 'nbeat_1_hook',
              stage: 'hook',
              title: 'Introdução',
              spokenText: `Bem-vindo à análise de ${dossier.workTitle}: ${dossier.theme}.`,
              estimatedDurationSec: 20,
              approved: true,
            },
            ...entityBeats,
            {
              segmentId: `seg_${entityBeats.length + 2}`,
              beatId: `nbeat_${entityBeats.length + 2}_resolution`,
              stage: 'resolution',
              title: 'Conclusão',
              spokenText: `Esses foram os destaques de ${dossier.workTitle} segundo os critérios definidos.`,
              estimatedDurationSec: 20,
              approved: true,
            },
          ],
        });
      }
      if (job.editorialScript && job.researchDossier) {
        const scriptCheck = validateScriptAgainstDossier(job.editorialScript, job.researchDossier, nextInterpretation);
        if (!scriptCheck.valid && !job.allowDeterministicScriptFallback) {
          job.error = `script_coverage_warning: ${scriptCheck.reasons.join(' | ')}`;
        }
      }
      job.completedStages = [...new Set([...job.completedStages, 'roteiro'])] as ProductionStageState[];
      this.saveJob(job);

      // 4. DECUPAGEM SEMÂNTICA (gera consultas específicas por cena antes da aquisição)
      checkCancelled();
      job.state = 'decupagem';
      job.progressPct = 44;
      job.message = 'Gerando decupagem semântica e consultas específicas por cena...';
      if (job.editorialScript && job.researchDossier) {
        job.sceneDecupagem = buildSemanticDecupagem(job.editorialScript, job.researchDossier, nextInterpretation);
      } else if (job.editorialScript) {
        const syntheticDossier: EditorialResearchDossier = {
          dossierId: `${job.projectId}_dossier`,
          dossierHash: nextInterpretation.promptHash,
          promptHash: nextInterpretation.promptHash,
          workTitle: nextInterpretation.workTitle,
          theme: nextInterpretation.theme,
          rankingCriteria: nextInterpretation.rankingCriteria,
          entities: [],
          uncertainties: ['Sem dossiê externo configurado; usando entidades extraídas do roteiro.'],
          sourcesUsed: ['script_derived'],
          createdAt: new Date().toISOString(),
        };
        job.sceneDecupagem = buildSemanticDecupagem(job.editorialScript, syntheticDossier, nextInterpretation);
      }
      job.completedStages = [...new Set([...job.completedStages, 'decupagem'])] as ProductionStageState[];
      if (job.researchDossier && job.editorialScript && job.sceneDecupagem) {
        job.editorialAudit = buildEditorialTraceabilityGraph({
          projectId: job.projectId,
          dossier: job.researchDossier,
          script: job.editorialScript,
          decupagem: job.sceneDecupagem,
          ...(job.editorialAudit ? { previousTrail: job.editorialAudit } : {}),
        });
        job.editorialAudit.events.push({
          eventId: `evt_decupagem_${Date.now()}`,
          timestamp: new Date().toISOString(),
          stage: 'decupagem',
          message: `Rastreabilidade construída: ${job.editorialAudit.sources.length} fontes, ${job.editorialAudit.facts.length} fatos, ${job.editorialAudit.scriptBlocks.length} blocos, ${job.editorialAudit.scenes.length} cenas.`,
        });
        job.editorialAudit.integrityReport = runEditorialIntegrityChecks({
          interpretation: nextInterpretation,
          dossier: job.researchDossier,
          trail: job.editorialAudit,
        });
      }
      this.saveJob(job);

      const scenesForAcquisition = job.sceneDecupagem ?? [];
      const queries =
        scenesForAcquisition.length > 0
          ? scenesForAcquisition.map((s) => s.mediaQueries[0] ?? `${s.workTitle} ${s.entities[0] ?? s.expectedEvent}`)
          : researchQueries;
      const expectedEntities = extractTopicEntities(
        `${nextInterpretation.workTitle} ${scenesForAcquisition.flatMap((s) => s.entities).join(' ')}`,
      );

      // 5. AQUISIÇÃO & VALIDAÇÃO VISUAL ORIENTADAS PELA DECUPAGEM
      if (!job.completedStages.includes('aquisicao')) {
        checkCancelled();
        job.state = 'aquisicao';
        job.progressPct = 56;
        job.message = 'Adquirindo mídias orientadas pela decupagem semântica...';
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

        const pending: PendingMediaSlot[] = [];
        if (this.deps.autonomousAcquisitionDeps && job.acquiredMedia.length < queries.length) {
          const initialSegments =
            scenesForAcquisition.length > 0
              ? scenesForAcquisition.map((s) => ({
                  segmentId: s.sceneId,
                  subject: s.entities[0]
                    ? `${s.workTitle} ${s.entities[0].replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()}`
                    : s.expectedEvent,
                  narrationText: s.narrationText,
                  expectedEvent: s.expectedEvent,
                  preferredQueries: s.mediaQueries,
                  entities: (() => {
                    const raw =
                      s.matchingCriteria.requiredEntities.length > 0
                        ? [s.workTitle, ...s.matchingCriteria.requiredEntities]
                        : extractTopicEntities(`${s.workTitle} ${s.entities.join(' ')} ${s.narrationText}`);
                    const expanded = new Set<string>();
                    for (const item of raw) {
                      const clean = item.replace(/\([^)]*\)/g, '').trim();
                      if (clean) expanded.add(clean);
                      const shortName = clean.split(',')[0]?.trim();
                      if (shortName && shortName.length >= 2) expanded.add(shortName);
                    }
                    return [...expanded];
                  })(),
                  expectedDurationSec: Math.max(8, s.durationSec),
                }))
              : queries.map((q, idx) => ({
                  segmentId: `slot_${idx + 1}`,
                  subject: q,
                  narrationText: q,
                  entities: extractTopicEntities(q),
                  expectedDurationSec: Math.max(8, Math.round((job.targetDurationSec ?? 90) / Math.max(1, queries.length))),
                }));

          checkCancelled();
          job.state = 'validacao_visual';
          job.progressPct = 62;
          job.message = 'Validando mídias por Scene Grounding e evidências por frame...';
          this.saveJob(job);

          const baseDeps = this.deps.autonomousAcquisitionDeps;
          const trail = job.editorialAudit ?? createEmptyEditorialAuditTrail(job.projectId);
          job.editorialAudit = trail;

          const resolveSceneForQuery = (queryText: string) => {
            const qLower = queryText.toLowerCase();
            return (
              trail.scenes.find((s) => s.mediaQueries.some((mq) => mq.toLowerCase() === qLower)) ??
              trail.scenes.find((s) =>
                s.entities.some((e) => qLower.includes(e.toLowerCase().split(/[\s,:-]+/)[0] ?? '')),
              ) ??
              trail.scenes[0]
            );
          };

          const auditedDeps: ResilientAcquisitionDeps = {
            ...baseDeps,
            localMediaDirs: [...new Set([projectPaths.mediaDir, ...(baseDeps.localMediaDirs ?? [])])],
            ...(baseDeps.ytDlpSearchFn
              ? {
                  ytDlpSearchFn: async (q, count, sig) => {
                    const matchedScene = resolveSceneForQuery(q);
                    const startedAt = new Date().toISOString();
                    const t0 = Date.now();
                    const prevSameScene = trail.queries.filter((x) => x.sceneId === (matchedScene?.sceneId ?? 'scene_unknown'));
                    const attemptNumber = prevSameScene.length + 1;
                    const queryId = `qry_${trail.queries.length + 1}_${Date.now()}`;
                    try {
                      const rows = await baseDeps.ytDlpSearchFn!(q, count, sig);
                      const finishedAt = new Date().toISOString();
                      const candidateIds: string[] = [];
                      for (let rIdx = 0; rIdx < rows.length; rIdx += 1) {
                        const row = rows[rIdx]!;
                        const candidateId = `cand_${queryId}_${rIdx + 1}`;
                        candidateIds.push(candidateId);
                        trail.candidates.push({
                          candidateId,
                          queryId,
                          sceneId: matchedScene?.sceneId ?? 'scene_unknown',
                          title: row.title ?? row.url,
                          url: row.url,
                          provider: 'yt_dlp',
                          ...(row.durationSec !== undefined ? { durationSec: row.durationSec } : {}),
                          status: 'pending',
                        });
                      }
                      const qRec: MediaQueryRecord = {
                        queryId,
                        sceneId: matchedScene?.sceneId ?? 'scene_unknown',
                        scriptBlockId: matchedScene?.scriptBlockId ?? 'unlinked',
                        narrationExcerpt: (matchedScene?.narrationText ?? '').slice(0, 180),
                        queryText: q,
                        ...(prevSameScene.length > 0 ? { reformulatedFromQueryId: prevSameScene[prevSameScene.length - 1]!.queryId } : {}),
                        provider: 'yt_dlp',
                        attemptNumber,
                        startedAt,
                        finishedAt,
                        durationMs: Date.now() - t0,
                        status: rows.length > 0 ? 'success' : 'empty',
                        resultsCount: rows.length,
                        candidateIds,
                        isPlannedOnly: false,
                      };
                      trail.queries.push(qRec);
                      trail.events.push({
                        eventId: `evt_qry_${Date.now()}`,
                        timestamp: finishedAt,
                        stage: 'aquisicao',
                        sceneId: qRec.sceneId,
                        message: `Consulta executada (${qRec.status}, ${rows.length} resultados): "${q}"`,
                      });
                      this.saveJob(job);
                      return rows;
                    } catch (err) {
                      const finishedAt = new Date().toISOString();
                      const msg = err instanceof Error ? err.message : String(err);
                      const isTimeout = /timeout|abort/i.test(msg);
                      const qRec: MediaQueryRecord = {
                        queryId,
                        sceneId: matchedScene?.sceneId ?? 'scene_unknown',
                        scriptBlockId: matchedScene?.scriptBlockId ?? 'unlinked',
                        narrationExcerpt: (matchedScene?.narrationText ?? '').slice(0, 180),
                        queryText: q,
                        provider: 'yt_dlp',
                        attemptNumber,
                        startedAt,
                        finishedAt,
                        durationMs: Date.now() - t0,
                        status: isTimeout ? 'timeout' : 'error',
                        errorMessage: msg,
                        resultsCount: 0,
                        candidateIds: [],
                        isPlannedOnly: false,
                      };
                      trail.queries.push(qRec);
                      trail.events.push({
                        eventId: `evt_qry_err_${Date.now()}`,
                        timestamp: finishedAt,
                        stage: 'aquisicao',
                        sceneId: qRec.sceneId,
                        message: `Falha na consulta "${q}": ${msg}`,
                      });
                      this.saveJob(job);
                      throw err;
                    }
                  },
                }
              : {}),
          };

          const audit = await runAutonomousMediaAcquisition({
            projectId: job.projectId,
            prompt: job.prompt,
            ...(job.genre ? { genre: job.genre } : {}),
            format: job.format === 'shorts_9_16' ? 'shorts' : 'analysis',
            segments: initialSegments,
            mediaDir: projectPaths.mediaDir,
            deps: auditedDeps,
            probeDurationFn: async (fp) => (await probeRealMp4(fp)).durationSec,
            ...(this.deps.analyzeFrames ? { analyzeFrames: this.deps.analyzeFrames } : {}),
            requireVisualVerification: this.deps.requireVisualVerification ?? true,
            evolution: this.deps.evolutionCore,
            ...(job.acquisitionBudgetMultiplier !== undefined
              ? { limits: { budgetMultiplier: job.acquisitionBudgetMultiplier } }
              : {}),
            signal,
          });
          job.autonomousAudit = audit;
          relevanceDecisions.push(...audit.relevanceDecisions);
          job.coverageReport = audit.coverageReport;

          // Record Grounding Evidences & Placements into EditorialAuditTrail
          for (const dec of audit.relevanceDecisions) {
            const approvedAsset = audit.approvedAssets.find((a) => a.mediaId === dec.mediaId);
            const matchedScene =
              trail.scenes.find((s) =>
                s.entities.some((e) => dec.matchedEntities?.some((me) => me.toLowerCase().includes(e.toLowerCase().split(/[\s,:-]+/)[0] ?? ''))),
              ) ??
              trail.scenes[0];
            const existingCand = trail.candidates.find(
              (c) => c.candidateId === dec.mediaId || (approvedAsset && c.url === approvedAsset.uri),
            );
            const candidateId = existingCand?.candidateId ?? dec.mediaId;
            if (!existingCand) {
              const candRec: MediaCandidateRecord = {
                candidateId,
                queryId: trail.queries.find((q) => q.sceneId === matchedScene?.sceneId)?.queryId ?? 'local_or_direct',
                sceneId: matchedScene?.sceneId ?? 'scene_unknown',
                title: dec.mediaId,
                url: approvedAsset?.uri ?? dec.mediaId,
                ...(approvedAsset?.uri ? { localUri: approvedAsset.uri } : {}),
                provider: approvedAsset?.origin ?? 'local_library',
                ...(approvedAsset?.durationSec !== undefined ? { durationSec: approvedAsset.durationSec } : {}),
                status: dec.accepted ? 'approved' : 'rejected',
                ...(!dec.accepted && dec.reason ? { rejectionReason: dec.reason } : {}),
              };
              trail.candidates.push(candRec);
            } else {
              existingCand.status = dec.accepted ? 'approved' : 'rejected';
              if (approvedAsset?.uri) existingCand.localUri = approvedAsset.uri;
              if (!dec.accepted && dec.reason) existingCand.rejectionReason = dec.reason;
            }

            const framesAnalyzed = (dec.visualEvidence ?? []).map((ve, vIdx) => ({
              timestampSec: ve.timestampSec ?? vIdx * 3,
              summary: ve.description ?? dec.reason ?? '',
              matchedEntities: ve.detectedEntities ?? [],
              matchedActions: ve.detectedActions ?? [],
              isPositive: dec.accepted,
            }));

            const intervalsFromDec = (dec.matchedIntervals ?? []).map((iv) => ({
              startSec: iv.startSec,
              endSec: iv.endSec,
              reason: dec.reason ?? 'Intervalo analisado',
            }));

            const evRec: GroundingEvidenceRecord = {
              evidenceId: `ev_${candidateId}_${Date.now()}`,
              candidateId,
              sceneId: matchedScene?.sceneId ?? 'scene_unknown',
              scriptBlockId: matchedScene?.scriptBlockId ?? 'unlinked',
              expectedWork: matchedScene?.workTitle ?? nextInterpretation.workTitle,
              expectedEvent: matchedScene?.expectedEvent ?? '',
              framesAnalyzed,
              positiveEvidences: dec.accepted ? [dec.reason ?? 'Correspondência visual confirmada'] : [],
              negativeEvidences: !dec.accepted ? [dec.reason ?? 'Rejeitado pelo Scene Grounding'] : [],
              confidence: dec.score,
              approvedIntervals: dec.accepted
                ? intervalsFromDec.length > 0
                  ? intervalsFromDec
                  : [{ startSec: 0, endSec: Math.max(6, approvedAsset?.durationSec ?? 15), reason: dec.reason ?? 'Intervalo validado' }]
                : [],
              rejectedIntervals: !dec.accepted
                ? [{ startSec: 0, endSec: Math.max(6, approvedAsset?.durationSec ?? 15), reason: dec.reason ?? 'Fora do contexto esperado' }]
                : [],
              decision: dec.accepted ? 'approved' : 'rejected',
              decisionReason: dec.reason ?? (dec.accepted ? 'Aprovado' : 'Rejeitado'),
              narrationRelation: matchedScene?.narrationText ?? '',
              humanReview: { status: 'pending' },
            };
            trail.groundingEvidences.push(evRec);

            if (dec.accepted && approvedAsset) {
              const dur = Math.max(6, approvedAsset.durationSec ?? matchedScene?.durationSec ?? 12);
              const plRec: TimelinePlacementRecord = {
                placementId: `pl_${candidateId}`,
                sceneId: evRec.sceneId,
                candidateId,
                evidenceId: evRec.evidenceId,
                clipId: `clip_${candidateId}`,
                startSec: 0,
                endSec: dur,
                durationSec: dur,
                placementHash: createHash('sha256').update(`${evRec.sceneId}:${candidateId}:${dur}`).digest('hex').slice(0, 12),
              };
              trail.timelinePlacements.push(plRec);
            }
          }
          trail.integrityReport = runEditorialIntegrityChecks({
            interpretation: nextInterpretation,
            ...(job.researchDossier ? { dossier: job.researchDossier } : {}),
            trail,
          });
          this.saveJob(job);

          for (let idx = 0; idx < audit.approvedAssets.length; idx += 1) {
            const approved = audit.approvedAssets[idx]!;
            const media = await buildSourceMediaFromFile(approved.uri, approved.mediaId);
            if (!media) continue;
            const detail = audit.approvedMediaDetails.find((d) => d.mediaId === approved.mediaId);
            this.cache.registerConsumer({
              url: detail?.sourceUrl ?? `local://${job.projectId}/${approved.mediaId}`,
              origin: approved.origin ?? 'autonomous_acquisition',
              license: 'verified',
              topic: job.prompt,
              query: queries[idx] ?? job.prompt,
              sourceFilePath: media.uri,
              width: media.width ?? 1280,
              height: media.height ?? 720,
              durationSec: media.duration.value / Math.max(1, media.duration.rate),
              projectId: job.projectId,
            });
            if (!job.acquiredMedia.some((m) => m.mediaId === media.mediaId || m.uri === media.uri)) {
              job.acquiredMedia.push(media);
            }
          }

          if (
            audit.unresolvedGapsForReview.length > 0 &&
            (job.acquiredMedia.length === 0 || (!audit.coverageReport.gatePassed && (job.targetDurationSec ?? 90) >= 180))
          ) {
            for (let gIdx = 0; gIdx < audit.unresolvedGapsForReview.length; gIdx += 1) {
              const gap = audit.unresolvedGapsForReview[gIdx]!;
              pending.push({
                slotIndex: gIdx,
                clipId: gap.segmentId,
                query: gap.suggestedQuery,
                reason: gap.reason,
              });
            }
          }
        } else {
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
                const cacheCompat = cacheHit
                  ? isCacheEntryCompatibleWithProject(
                      { topic: cacheHit.topic, query: cacheHit.query, url: cacheHit.url },
                      { projectId: job.projectId, prompt: job.prompt, expectedEntities },
                    )
                  : { compatible: false, reason: '' };
                if (cacheHit && cacheCompat.compatible) {
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
              const relevance = await evaluateMediaRelevance(
                {
                  mediaId: media.mediaId,
                  uri: media.uri,
                  title: matchedCandidate?.title ?? query,
                  origin: matchedCandidate?.origin ?? 'yt_dlp_search',
                  ...(matchedCandidate?.url ? { url: matchedCandidate.url } : {}),
                  projectId: job.projectId,
                  durationSec,
                },
                {
                  segmentId: `slot_${i + 1}`,
                  prompt: job.prompt,
                  narrationText: query,
                  ...(job.genre ? { genre: job.genre } : {}),
                  expectedEntities,
                },
                {
                  ...(this.deps.analyzeFrames ? { analyzeFrames: this.deps.analyzeFrames } : {}),
                  requireVisualVerification: this.deps.requireVisualVerification ?? true,
                },
              );
              relevanceDecisions.push(relevance);
              if (!relevance.accepted) {
                try {
                  if (existsSync(media.uri)) unlinkSync(media.uri);
                } catch {
                  // ignore cleanup failure
                }
                pending.push({
                  slotIndex: i,
                  clipId: `clip_${i + 1}`,
                  query,
                  reason: `Mídia rejeitada pelo Media Relevance Gate (${relevance.rejectionCode ?? 'incompatível'}): ${relevance.reason}`,
                });
                continue;
              }
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
        }

        job.mediaRelevanceDecisions = relevanceDecisions;
        if (pending.length > 0) {
          const recoveryPlans = pending.map((p) => {
            const matchedScene = scenesForAcquisition.find((s) => s.sceneId === p.clipId) ?? scenesForAcquisition[p.slotIndex];
            return {
              sceneId: matchedScene?.sceneId ?? p.clipId,
              steps: matchedScene ? buildEditorialRecoveryPlan(matchedScene, matchedScene.mediaQueries) : [],
            };
          }).filter((r) => r.steps.length > 0);
          if (recoveryPlans.length > 0) job.editorialRecoveryPlans = recoveryPlans;
          job.pendingMedia = pending;
          job.state = 'paused_pending_media';
          job.progressPct = 64;
          job.message = `${pending.length} mídia(s) pendente(s) antes da montagem final (nenhum Motion Visual foi autorizado automaticamente).`;
          return this.saveJob(job);
        }

        job.pendingMedia = [];
        job.completedStages = [...new Set([...job.completedStages, 'aquisicao', 'validacao_visual'])] as ProductionStageState[];
      }

      // PLANEJAMENTO (usa activeMemories e job.editorialScript já gerados na etapa de Roteiro)
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
        ...(job.editorialScript ? { editorialScript: job.editorialScript } : {}),
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
      const clipSegmentMap = new Map<string, string>();
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
        const decisionByMediaId = new Map(relevanceDecisions.map((d) => [d.mediaId, d]));
        const covSegById = new Map((job.coverageReport?.segments ?? []).map((cs) => [cs.segmentId, cs]));
        const nextClips: typeof pkg.timeline.clips = [];
        for (const c of pkg.timeline.clips) {
          if (c.trackId !== 'v1') {
            nextClips.push(c);
            continue;
          }
          const clipIdx = videoTrackClips.findIndex((vc) => vc.clipId === c.clipId);
          const expectedSegId = pkg.editorialScript?.segments[clipIdx]?.segmentId ?? `slot_${clipIdx + 1}`;
          const covSeg = covSegById.get(expectedSegId);
          if (covSeg && covSeg.relevantIntervals.length > 1) {
            const totalTimelineTicks = c.timelineRange.duration.value;
            const tlRate = Math.max(1, c.timelineRange.duration.rate);
            const startTickBase = c.timelineRange.start.value;
            const totalIntervalSec = covSeg.relevantIntervals.reduce(
              (acc, iv) => acc + Math.max(1, iv.endSec - iv.startSec),
              0,
            );
            let cursorTick = startTickBase;
            for (let pIdx = 0; pIdx < covSeg.relevantIntervals.length; pIdx += 1) {
              const iv = covSeg.relevantIntervals[pIdx]!;
              const ivSec = Math.max(1, iv.endSec - iv.startSec);
              const isLast = pIdx === covSeg.relevantIntervals.length - 1;
              const partTicks = isLast
                ? Math.max(1, startTickBase + totalTimelineTicks - cursorTick)
                : Math.max(1, Math.round((ivSec / Math.max(1, totalIntervalSec)) * totalTimelineTicks));
              const subClipId = pIdx === 0 ? c.clipId : `${c.clipId}_p${pIdx + 1}`;
              clipSegmentMap.set(subClipId, expectedSegId);
              nextClips.push({
                ...c,
                clipId: subClipId,
                mediaId: iv.mediaId,
                timelineRange: {
                  start: { value: cursorTick, rate: tlRate },
                  duration: { value: partTicks, rate: tlRate },
                },
                sourceRange: {
                  start: { value: Math.round(iv.startSec * 30), rate: 30 },
                  duration: { value: Math.round(Math.max(2, ivSec) * 30), rate: 30 },
                },
              });
              cursorTick += partTicks;
            }
            continue;
          }
          const hit = matchByClipId.get(c.clipId);
          const candidateMediaId = hit && hit.mediaId && hit.score > 0 ? hit.mediaId : c.mediaId;
          const decision = decisionByMediaId.get(candidateMediaId);
          const isEligibleForSegment =
            !decision ||
            (decision.accepted &&
              decision.correspondenceLevel !== 'universe_only_coincidence' &&
              decision.correspondenceLevel !== 'unverified' &&
              (!decision.eligibleSegmentIds ||
                decision.eligibleSegmentIds.length === 0 ||
                decision.eligibleSegmentIds.includes(expectedSegId) ||
                decision.eligibleSegmentIds.includes(c.clipId)));
          const finalMediaId = isEligibleForSegment ? candidateMediaId : c.mediaId;
          const finalDecision = decisionByMediaId.get(finalMediaId);
          const matchedInterval =
            finalDecision?.matchedIntervals?.find((iv) => iv.segmentId === expectedSegId || iv.segmentId === c.clipId) ??
            finalDecision?.matchedIntervals?.[0];
          const nextSourceRange = matchedInterval
            ? {
                start: { value: Math.round(matchedInterval.startSec * 30), rate: 30 },
                duration: {
                  value: Math.round(Math.max(2, matchedInterval.endSec - matchedInterval.startSec) * 30),
                  rate: 30,
                },
              }
            : c.sourceRange;
          clipSegmentMap.set(c.clipId, expectedSegId);
          nextClips.push({ ...c, mediaId: finalMediaId, sourceRange: nextSourceRange });
        }
        pkg = {
          ...pkg,
          timeline: {
            ...pkg.timeline,
            clips: nextClips,
          },
        };
      }

      job.completedStages = [...new Set([...job.completedStages, 'planejamento'])] as ProductionStageState[];

      // COVERAGE & ANTI-REPETITION QUALITY GATE (antes da renderização)
      const sceneBySegId = new Map(scenesForAcquisition.map((sc) => [sc.sceneId, sc]));
      const coverageSegments = pkg.editorialScript
        ? pkg.editorialScript.segments.map((s) => {
            const matchedScene = sceneBySegId.get(s.segmentId);
            return {
              segmentId: s.segmentId,
              subject: s.title || s.segmentId,
              narrationText: s.spokenText,
              ...(matchedScene
                ? {
                    entities:
                      matchedScene.matchingCriteria.requiredEntities.length > 0
                        ? [matchedScene.workTitle, ...matchedScene.matchingCriteria.requiredEntities]
                        : matchedScene.entities,
                  }
                : {}),
              expectedDurationSec: Math.max(
                8,
                Math.round((job.targetDurationSec ?? 90) / Math.max(1, pkg.editorialScript!.segments.length)),
              ),
            };
          })
        : pkg.direction.narrativeBeats.map((b, i) => ({
            segmentId: b.beatId || `seg_${i + 1}`,
            subject: String(b.stage),
            narrationText: b.summary,
            expectedDurationSec: Math.max(
              8,
              Math.round((job.targetDurationSec ?? 90) / Math.max(1, pkg.direction.narrativeBeats.length)),
            ),
          }));
      const coverageAssets = job.acquiredMedia.map((m) => {
        const decision = relevanceDecisions.find((d) => d.mediaId === m.mediaId);
        return {
          mediaId: m.mediaId,
          uri: m.uri,
          title: basename(m.uri),
          origin: m.origin,
          durationSec: m.duration.value / Math.max(1, m.duration.rate),
          compatible: decision ? decision.accepted : false,
          ...(decision?.matchedEntities ? { relevantToEntities: decision.matchedEntities } : {}),
          ...(decision && !decision.accepted ? { rejectedReason: decision.reason } : {}),
        };
      });
      const coverageUsages = pkg.timeline.clips
        .filter((c) => c.trackId === 'v1' && c.mediaId)
        .map((c, idx) => ({
          clipId: c.clipId,
          segmentId:
            clipSegmentMap.get(c.clipId) ??
            coverageSegments[idx % Math.max(1, coverageSegments.length)]?.segmentId ??
            `seg_${idx + 1}`,
          mediaId: c.mediaId!,
          sourceStartSec: c.sourceRange.start.value / Math.max(1, c.sourceRange.start.rate),
          sourceEndSec:
            (c.sourceRange.start.value + c.sourceRange.duration.value) /
            Math.max(1, c.sourceRange.start.rate),
          timelineDurationSec: c.timelineRange.duration.value / Math.max(1, c.timelineRange.duration.rate),
        }));
      const coverageReport = planMediaCoverage({
        segments: coverageSegments,
        assets: coverageAssets,
        plannedUsages: coverageUsages,
        format: job.format === 'shorts_9_16' ? 'shorts' : 'analysis',
        relevanceDecisions,
        requireRelevanceApproval: true,
      });
      job.coverageReport = coverageReport;
      if (!coverageReport.gatePassed && job.acquiredMedia.length > 0 && (job.targetDurationSec ?? 90) >= 180) {
        const extraQueries = expandScriptOrientedQueries({
          prompt: job.prompt,
          segments: coverageSegments,
          ...(job.genre ? { genre: job.genre } : {}),
          uncoveredSegmentIds: coverageReport.segments.filter((s) => !s.covered).map((s) => s.segmentId),
        });
        job.pendingMedia = extraQueries.map((q, idx) => ({
          slotIndex: idx,
          clipId: `gap_${idx + 1}`,
          query: q,
          reason: coverageReport.gateReasons[0] ?? 'Cobertura audiovisual insuficiente para evitar repetição.',
        }));
        job.state = 'paused_pending_media';
        job.progressPct = 68;
        job.message = `Cobertura insuficiente (${Math.round(coverageReport.coverageRatio * 100)}%). Produção pausada para evitar repetição.`;
        return this.saveJob(job);
      }

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
        ...(job.language ? { language: job.language } : {}),
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
        mediaRelevanceDecisions: relevanceDecisions,
        coverageReport,
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
          ...(job.language ? { language: job.language } : {}),
        });

        const critic2 = await evaluateRenderedVisualCritic({
          projectId: job.projectId,
          mp4Path: render.mp4Path,
          mediaRelevanceDecisions: relevanceDecisions,
          coverageReport,
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
