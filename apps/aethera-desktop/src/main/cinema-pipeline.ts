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
import { homedir } from 'node:os';
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
  resolveProjectDomain,
  workReferenceForScene,
  runAutonomousSupervisorPass,
  type AetheraEvolutionCore,
  type AutonomousAcquisitionAuditReport,
  type CinemaGenre,
  type CinemaProductionPackage,
  type DeliveryFormat,
  migrateLegacyCreativeSelection,
  type AetheraCreativeSelection,
  type DeliveryQualityProfile,
  type DistributedFrameAnalysis,
  type MediaCoverageReport,
  type MediaRelevanceDecision,
  type NarrativeBeat,
  type RealRenderResult,
  type RealAudioAssetsInput,
  type RenderQualityProfile,
  type ResilientAcquisitionDeps,
  type ScriptSegmentExpectation,
  type ScriptValidationReport,
  type SourceMediaRecord,
  type TimelineClip,
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
  contractContextForAgent,
  createEmptyEditorialAuditTrail,
  evaluateProductionContract,
  extractProductionContract,
  RealRenderError,
  reviseProductionContract,
  recordContractEvidence,
  recordContractRecovery,
  type ContractControlField,
  type ContractEvidence,
  type ContractMeasurementSnapshot,
  type ContractComplianceReport,
  type ProductionContract,
  type ProductionContractControls,
  type ContractRequirementCategory,
  runEditorialIntegrityChecks,
  repairSemanticDecupagem,
  type EditorialAuditTrail,
  type GroundingEvidenceRecord,
  type MediaCandidateRecord,
  type MediaQueryRecord,
  type TimelinePlacementRecord,
  estimateNarrationSec,
  isMultiWorkProduction,
  isAssemblyEligibleDecision,
  SCENE_GROUNDING_POLICY_VERSION,
  buildSceneAudiovisualPlan,
  generateCinematicMusicBed,
  resolveRealAudioAssets,
  runGateAPreAssembly,
  runGateBPreRender,
  runGateCPostRender,
  type QualityGateReport,
  fromFrames,
} from '@neuralbridge/cinema';
import { CinemaSmartCache, isPathStrictlyInside } from './cinema-cache.js';
import { createProductionJobId } from './production-console.js';

/** Maps planned audiovisualPlan SFX cues (sfxEventType + sfxAtMs) to matching MotionVelix WAV assets; never uses hardcoded timestamps. */
function resolvePlannedSfxAssets(
  audiovisualPlan: CinemaProductionPackage['audiovisualPlan'] | undefined,
): RealAudioAssetsInput | undefined {
  const scenes = audiovisualPlan?.scenes ?? [];
  if (scenes.length === 0) return undefined;
  const root = process.env['NB_VELIX_DIR'] ?? join(homedir(), '.claude', 'skills', 'motionvelix', 'assets', 'sfx');
  const license = 'motionvelix-user-kit-original-synthesized';
  const origin = 'motionvelix-user-kit';
  const useConditions = 'uso autorizado no escopo do kit';
  const sfxFileByEvent: Record<string, string> = {
    reveal: 'swish_suave',
    whoosh: 'whoosh_rapido',
    ui_pop: 'deslize',
    comic_sting: 'pop_agudo',
    impact: 'impacto',
    riser: 'riser',
  };
  const sfx = scenes
    .filter((scene) => scene.sfxEventType && typeof scene.sfxAtMs === 'number')
    .map((scene) => {
      const stem = sfxFileByEvent[scene.sfxEventType] ?? 'swish_suave';
      return {
        id: `${scene.sceneId}_${stem}`,
        path: join(root, `${stem}.wav`),
        license,
        origin,
        useConditions,
        atMs: Math.max(0, Math.round(scene.sfxAtMs)),
        gainDb: -20,
      };
    })
    .filter((asset) => existsSync(asset.path));
  if (sfx.length === 0) return undefined;
  return { sfx };
}

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
  uncoveredIntervals?: Array<{ startSec: number; endSec: number }>;
  missingDurationSec?: number;
  attempts?: number;
  editorialAlternatives?: Array<{
    kind: 'explanatory_graphic' | 'localized_editorial_adjustment';
    detail: string;
    countsAsFootage: false;
  }>;
  resolvedUri?: string;
  allowProcedural?: boolean;
}

export interface StagedProductionJob {
  projectId: string;
  /**
   * Unique id of this production execution. A project can run several productions over time, so the console, the
   * stage tracker and the UI key on `jobId`, never on `projectId`. Jobs saved before this field existed use their
   * project id (so their console history stays readable).
   */
  jobId?: string;
  /** 1 on the first run; +1 every time the job is resumed or retried. */
  attempt?: number;
  prompt: string;
  contract?: ProductionContract;
  /** Previous immutable contract snapshots; the current snapshot lives in `contract`. */
  contractHistory?: ProductionContract[];
  contractCompliance?: ContractComplianceReport;
  /** Controls touched manually in the UI; prompt-derived values never overwrite these fields. */
  manuallyChangedFields?: ContractControlField[];
  /** Stages invalidated by the latest natural-language contract revision. */
  contractRevisionAffectedStages?: ProductionStageState[];
  /** Independent creative dimensions and delivery target; legacy genre/format remain persisted for compatibility. */
  creativeSelection?: AetheraCreativeSelection;
  deliveryPresetId?: string;
  deliveryPresetIds?: string[];
  previewProfile?: DeliveryQualityProfile;
  genre?: CinemaGenre;
  format?: DeliveryFormat;
  targetDurationSec: number;
  humorIntensity: number;
  renderProfile: RenderQualityProfile;
  useNvenc: boolean;
  voiceStudioVoiceId?: string;
  ttsProviderId?: string;
  ttsVoiceId?: string;
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
  downloadProgress?: {
    label: string;
    pct: number | null;
    bytesDone: number;
    bytesTotal: number | null;
  };
  completedStages: ProductionStageState[];
  acquiredMedia: SourceMediaRecord[];
  renderExports?: Array<{
    presetId: string;
    mp4Path: string;
    width: number;
    height: number;
    fps: number;
    durationSec: number;
    validationValid: boolean;
    validationErrors: string[];
  }>;
  pendingMedia: PendingMediaSlot[];
  workspaceDir?: string;
  scriptValidation?: ScriptValidationReport;
  mediaRelevanceDecisions?: MediaRelevanceDecision[];
  sceneGroundingPolicyVersion?: string;
  coverageReport?: MediaCoverageReport;
  autonomousAudit?: AutonomousAcquisitionAuditReport;
  /**
   * Per-scene assembly outcome: seconds of verified real footage vs. labeled graphic recovery. Scenes listed with
   * `status: 'graphic_recovery'` or `'partial'` were rendered, but stay pending for human media review.
   */
  sceneAssembly?: SceneAssemblyRecord[];
  isTechnicalSample?: boolean;
  /** Persisted audio-first render audit; credentials never enter this structure. */
  audioFirstTimeline?: RealRenderResult['audioFirstTimeline'];
  captionAlignment?: RealRenderResult['captionAlignment'];
  smartCaptions?: RealRenderResult['smartCaptions'];
  audioSources?: RealRenderResult['audioSources'];
  audioDiagnostics?: RealRenderResult['audioDiagnostics'];
  musicSelection?: RealRenderResult['musicSelection'];
  deliveryGate?: RealRenderResult['deliveryGate'];
  qualityGates?: QualityGateReport[];
  error?: string;
  startedAt?: string;
  updatedAt: string;
}

export function captureRenderFailureDiagnostics(
  job: Pick<StagedProductionJob, 'audioFirstTimeline'>,
  error: unknown,
): void {
  if (error instanceof RealRenderError && error.audioFirstTimeline) {
    job.audioFirstTimeline = error.audioFirstTimeline;
  }
}

export interface SceneAssemblyRecord {
  sceneId: string;
  clipId: string;
  label: string;
  timelineSec: number;
  realFootageSec: number;
  graphicRecoverySec: number;
  mediaIds: string[];
  status: 'real_footage' | 'partial' | 'graphic_recovery';
  /** Why the scene is not fully covered by verified footage (empty when it is). */
  pendingReason?: string;
}

/** Below this share of verified real footage across the whole video, the production pauses for human media review. */
export const MIN_REAL_FOOTAGE_RATIO_TO_ASSEMBLE = 0.35;

type V1Clip = TimelineClip;

/**
 * Preview resolution for a job. An explicit previewProfile wins; legacy jobs that
 * only carry a preview-tier renderProfile (draft_540p/review_720p) keep using it,
 * so the review render never silently scales up. Master tiers fall back to 720p.
 */
export function previewProfileForJob(job: Pick<StagedProductionJob, 'previewProfile' | 'renderProfile'>): DeliveryQualityProfile {
  if (job.previewProfile) return job.previewProfile;
  return job.renderProfile === 'draft_540p' ? 'draft_540p' : 'review_720p';
}

function graphicRecoveryEffects(clipId: string, reason: string): TimelineClip['effects'] {
  return [
    {
      effectId: `allow_proc_${clipId}`,
      kind: 'allow_procedural',
      params: { authorized: true },
      enabled: true,
      estimatedCostMs: 0,
      fallbackMode: 'skip',
    },
    {
      // Explicit marker: this interval is a typographic/graphic composition, never footage of the work.
      effectId: `graphic_recovery_${clipId}`,
      kind: 'graphic_recovery',
      params: { reason: reason.slice(0, 160), presentedAsEvidence: false },
      enabled: true,
      estimatedCostMs: 0,
      fallbackMode: 'skip',
    },
  ];
}

/**
 * Splits one scene clip into a montage of verified source intervals (each source second used once, each part no
 * longer than its proven interval so the renderer never loops it). Whatever the verified footage cannot fill becomes
 * one explicit, labeled graphic-recovery part — never a repeated clip and never unlabeled filler.
 */
export function buildSceneMontage(input: {
  clip: V1Clip;
  sceneId: string;
  label: string;
  intervals: Array<{ mediaId: string; startSec: number; endSec: number }>;
  availableMediaIds: ReadonlySet<string>;
  allowGraphicRecovery: boolean;
}): { clips: V1Clip[]; record: SceneAssemblyRecord } {
  const { clip } = input;
  const rate = Math.max(1, clip.timelineRange.duration.rate);
  const totalTicks = clip.timelineRange.duration.value;
  const totalSec = totalTicks / rate;
  const parts: V1Clip[] = [];
  const usedMedia: string[] = [];
  let cursorTicks = 0;
  let realSec = 0;
  const seen = new Set<string>();
  for (const iv of input.intervals) {
    if (!input.availableMediaIds.has(iv.mediaId)) continue;
    const key = `${iv.mediaId}:${iv.startSec.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const remainingSec = (totalTicks - cursorTicks) / rate;
    if (remainingSec < 1) break;
    const ivSec = iv.endSec - iv.startSec;
    if (ivSec < 1) continue;
    const takeSec = Math.min(ivSec, remainingSec);
    const takeTicks = Math.max(1, Math.round(takeSec * rate));
    const partId = parts.length === 0 ? clip.clipId : `${clip.clipId}_p${parts.length + 1}`;
    const baseEffects = clip.effects.filter((e) => e.kind !== 'allow_procedural');
    const hasMotionEffect = baseEffects.some((e) => e.kind.startsWith('ken_burns') || e.kind.includes('zoom'));
    const motionEffect = hasMotionEffect
      ? []
      : [
          {
            effectId: `fx_motion_${partId}`,
            kind: parts.length % 2 === 0 ? 'ken_burns_in' : 'ken_burns_pan',
            enabled: true,
            params: { zoom: 1.06, easing: 'ease_in_out' },
          },
        ];
    parts.push({
      ...clip,
      clipId: partId,
      mediaId: iv.mediaId,
      label: input.label,
      transitionIn: clip.transitionIn ?? (parts.length === 0 ? 'dissolve' : parts.length % 2 === 0 ? 'j_cut' : 'cut'),
      timelineRange: {
        start: { value: clip.timelineRange.start.value + cursorTicks, rate },
        duration: { value: takeTicks, rate },
      },
      sourceRange: {
        start: { value: Math.round(iv.startSec * 30), rate: 30 },
        duration: { value: Math.round(takeSec * 30), rate: 30 },
      },
      effects: [...baseEffects, ...motionEffect],
    });
    if (!usedMedia.includes(iv.mediaId)) usedMedia.push(iv.mediaId);
    cursorTicks += takeTicks;
    realSec += takeTicks / rate;
  }
  const leftoverTicks = totalTicks - cursorTicks;
  let recoverySec = 0;
  let pendingReason: string | undefined;
  if (leftoverTicks > 0) {
    const last = parts[parts.length - 1];
    if (last && (leftoverTicks / rate < 1 || !input.allowGraphicRecovery)) {
      // A sub-second remainder is absorbed by the previous verified part (it plays on in the same source file).
      last.timelineRange = { ...last.timelineRange, duration: { value: last.timelineRange.duration.value + leftoverTicks, rate } };
      realSec += leftoverTicks / rate;
    } else if (input.allowGraphicRecovery) {
      recoverySec = leftoverTicks / rate;
      pendingReason =
        realSec > 0
          ? `Footage verificada cobre ${realSec.toFixed(1)}s de ${totalSec.toFixed(1)}s; o restante usa composição gráfica rotulada.`
          : 'Nenhum intervalo verificado da obra para esta cena; usada composição gráfica rotulada (não é evidência visual da obra).';
      const partId = parts.length === 0 ? clip.clipId : `${clip.clipId}_g`;
      parts.push({
        ...clip,
        clipId: partId,
        mediaId: `graphic_recovery_${input.sceneId}`,
        label: input.label,
        timelineRange: {
          start: { value: clip.timelineRange.start.value + cursorTicks, rate },
          duration: { value: leftoverTicks, rate },
        },
        sourceRange: { start: { value: 0, rate: 30 }, duration: { value: Math.round(recoverySec * 30), rate: 30 } },
        effects: [...clip.effects.filter((e) => e.kind !== 'allow_procedural'), ...graphicRecoveryEffects(partId, pendingReason)],
      });
    } else {
      parts.push(clip);
    }
  }
  const status: SceneAssemblyRecord['status'] =
    recoverySec <= 0.01 && realSec > 0 ? 'real_footage' : realSec > 0 ? 'partial' : 'graphic_recovery';
  return {
    clips: parts,
    record: {
      sceneId: input.sceneId,
      clipId: clip.clipId,
      label: input.label,
      timelineSec: Number(totalSec.toFixed(2)),
      realFootageSec: Number(realSec.toFixed(2)),
      graphicRecoverySec: Number(recoverySec.toFixed(2)),
      mediaIds: usedMedia,
      status,
      ...(pendingReason ? { pendingReason } : {}),
    },
  };
}

/** Completion message that never hides partial coverage or unresolved rights. */
export function summarizeAssemblyOutcome(job: Pick<StagedProductionJob, 'sceneAssembly' | 'autonomousAudit'>): string {
  const assembly = job.sceneAssembly ?? [];
  const scenes = new Map<string, { real: number; total: number }>();
  for (const r of assembly) {
    const cur = scenes.get(r.sceneId) ?? { real: 0, total: 0 };
    cur.real += r.realFootageSec;
    cur.total += r.timelineSec;
    scenes.set(r.sceneId, cur);
  }
  const rightsPending = job.autonomousAudit?.pendingLicenseReview?.filter((p) => p.usedInDraft).length ?? 0;
  if (scenes.size === 0) {
    return rightsPending > 0
      ? `Montagem completa pronta no Editor. ${rightsPending} mídia(s) aguardam revisão de direitos antes da publicação.`
      : 'Montagem completa pronta no Editor!';
  }
  const full = [...scenes.values()].filter((s) => s.total - s.real < 0.5).length;
  const realSec = [...scenes.values()].reduce((a, s) => a + s.real, 0);
  const totalSec = [...scenes.values()].reduce((a, s) => a + s.total, 0);
  const pendingScenes = scenes.size - full;
  const parts = [
    `Montagem pronta no Editor: ${full}/${scenes.size} cenas com footage verificada completa (${Math.round(realSec)}s de ${Math.round(totalSec)}s).`,
  ];
  if (pendingScenes > 0) parts.push(`${pendingScenes} cena(s) usam composição gráfica rotulada e seguem pendentes de mídia.`);
  if (rightsPending > 0) parts.push(`${rightsPending} mídia(s) aguardam revisão de direitos antes da publicação.`);
  return parts.join(' ');
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
  /** Resolves TTS credentials from the main-process secret store at render time; never persisted in the job. */
  resolveTtsCredentials?: (providerId: string) => { apiKey: string; modelId?: string } | null;
  analyzeFrames?: (
    uri: string,
    timestampsSec: number[],
    segment: ScriptSegmentExpectation,
  ) => Promise<DistributedFrameAnalysis[]>;
  analyzeRemoteFramesFn?: (
    framePaths: string[],
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
    context?: { projectId: string },
  ) => Promise<SearchCandidate[]>;
  acquireExternalMedia?: (
    query: string,
    slotIndex: number,
    mediaDir: string,
    signal: AbortSignal,
    preferredUrl?: string,
    context?: { projectId: string },
  ) => Promise<string | null>;
  runEditorialResearch?: (
    interpretation: PromptInterpretation,
    signal: AbortSignal,
    context?: { projectId: string; contractContext?: ReturnType<typeof contractContextForAgent>; creativeSelection?: AetheraCreativeSelection; deliveryPresetId?: string },
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
    contractContext?: ReturnType<typeof contractContextForAgent>;
    creativeSelection?: AetheraCreativeSelection;
    deliveryPresetId?: string;
    /** Production cancellation: ends the running agent's process tree. */
    signal?: AbortSignal;
  }) => Promise<{
    treatment?: string;
    beats?: Array<{ stage?: NarrativeBeat['stage']; summary: string }>;
    providerUsed?: string;
    academyRulesApplied?: string[];
  } | null>;
}

const LOCAL_MEDIA_EXT_RE = /\.(mp4|mov|webm|mkv|png|jpe?g|webp)$/i;

function classifyContractRevisionStages(instruction: string): ProductionStageState[] {
  const text = instruction.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const from = (start: ProductionStageState): ProductionStageState[] => {
    const order: ProductionStageState[] = ['pesquisa', 'roteiro', 'decupagem', 'aquisicao', 'validacao_visual', 'planejamento', 'montagem', 'audio_sfx_vfx', 'qc', 'previa', 'editor'];
    const index = order.indexOf(start);
    return index >= 0 ? order.slice(index) : order;
  };
  if (/pesquis|fonte|fato|entidade|obra|anime\s*#|personagem/.test(text)) return from('pesquisa');
  if (/midia|cena|b[- ]?roll|visual|clipe|imagem|filmagem/.test(text)) return from('decupagem');
  if (/voz|narrac|idioma|loudness|lufs|dbtp|volume|musica|trilha|sfx|vfx|efeito sonoro/.test(text)) return from('audio_sfx_vfx');
  if (/roteiro|narrativ|abertura|climax|humor|tom|estrutura|duracao|ritmo|corte|transicao/.test(text)) return from('roteiro');
  return from('pesquisa');
}

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
  /**
   * Execution that currently owns each project workspace (job + attempt). A run that was superseded — the job was
   * resumed (new attempt) or a new production of the same project started — keeps unwinding after its abort; its late
   * writes must not overwrite the job file or the console of the run that replaced it.
   */
  private readonly currentRun = new Map<string, { jobId: string; attempt: number }>();
  /** Runs (`jobId#attempt`) the user cancelled: until they unwind, the only state they may still write is `cancelled`. */
  private readonly cancelledRuns = new Set<string>();
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

  private recordStageEvidence(
    contract: ProductionContract | undefined,
    stage: string,
    kind: ContractEvidence['kind'],
    summary: string,
    outcome: ContractEvidence['outcome'] = 'supports',
    artifactIds?: string[],
  ): ProductionContract | undefined {
    if (!contract) return undefined;
    const categoryByStage: Record<string, ContractRequirementCategory[]> = {
      prompt: ['content', 'format', 'duration', 'language', 'tone'],
      interpretacao: ['content', 'format', 'duration', 'language', 'narrative'],
      pesquisa: ['research', 'content'],
      roteiro: ['narrative', 'narration', 'humor'],
      decupagem: ['narrative', 'media', 'editing'],
      aquisicao: ['media', 'research'],
      validacao_visual: ['media', 'quality'],
      planejamento: ['editing', 'sfx', 'vfx', 'music'],
      montagem: ['editing', 'narrative'],
      audio_sfx_vfx: ['narration', 'sfx', 'vfx', 'music', 'mixing'],
      qc: ['quality', 'mixing', 'format', 'duration'],
      previa: ['quality', 'format', 'duration'],
    };
    const categories = categoryByStage[stage] ?? [];
    const requirement = contract.requirements.find((item) => categories.includes(item.category)) ?? contract.requirements[0];
    if (!requirement) return contract;
    return recordContractEvidence(contract, {
      requirementId: requirement.id,
      stage,
      kind,
      outcome,
      summary,
      satisfiesRequirement: false,
      ...(artifactIds ? { artifactIds } : {}),
    });
  }

  private recordMediaRecoveryAttempt(
    contract: ProductionContract | undefined,
    pending: PendingMediaSlot[],
    outcome: string,
  ): ProductionContract | undefined {
    if (!contract || pending.length === 0) return contract;
    const requirement = contract.requirements.find((item) => item.category === 'media');
    if (!requirement) return contract;
    const signature = `media:${pending
      .map((slot) => `${slot.slotIndex}:${slot.query}:${slot.attempts ?? 0}`)
      .sort()
      .join('|')}`;
    return recordContractRecovery(contract, {
      requirementId: requirement.id,
      signature,
      action: 'alternate_source_or_query',
      outcome,
    });
  }

  private ensureContractForJob(job: StagedProductionJob): { job: StagedProductionJob; upgraded: boolean } {
    const migrated = migrateLegacyCreativeSelection({ ...(job.genre ? { genre: job.genre } : {}), ...(job.format ? { format: job.format } : {}) });
    let upgraded = false;
    if (!job.creativeSelection) {
      job.creativeSelection = migrated.creativeSelection;
      upgraded = true;
    }
    if (!job.deliveryPresetId) {
      job.deliveryPresetId = migrated.deliveryPresetId;
      upgraded = true;
    }
    if (job.contract?.schemaVersion === 1) {
      if (!job.contract.creativeSelection) {
        job.contract.creativeSelection = job.creativeSelection;
        job.contract.controls.creativeSelection = job.creativeSelection;
        upgraded = true;
      }
      if (!job.contract.deliveryPresetId) {
        job.contract.deliveryPresetId = job.deliveryPresetId;
        job.contract.controls.deliveryPresetId = job.deliveryPresetId;
        upgraded = true;
      }
      return { job, upgraded };
    }
    const contract = extractProductionContract({
      projectId: job.projectId,
      prompt: job.prompt,
      controls: {
        ...(job.genre ? { genre: job.genre } : {}),
        ...(job.format ? { format: job.format } : {}),
        ...(job.creativeSelection ? { creativeSelection: job.creativeSelection } : {}),
        ...(job.deliveryPresetId ? { deliveryPresetId: job.deliveryPresetId } : {}),
        ...(job.previewProfile ? { previewProfile: job.previewProfile } : {}),
        targetDurationSec: job.targetDurationSec,
        humorIntensity: job.humorIntensity,
        renderProfile: job.renderProfile,
        ...(job.language ? { language: job.language } : {}),
        ...(job.voiceStudioVoiceId ? { voiceId: job.voiceStudioVoiceId } : {}),
      },
      ...(job.manuallyChangedFields ? { manuallyChangedFields: job.manuallyChangedFields } : {}),
    });
    job.contract = this.recordStageEvidence(contract, 'prompt', 'extraction', 'Contrato criado por compatibilidade a partir de um job legado.') ?? contract;
    job.contractHistory = job.contractHistory ?? [];
    return { job, upgraded: true };
  }

  private ttsCredentialsFor(providerId: string | undefined): { ttsApiKey?: string; ttsModelId?: string } {
    if (!providerId || providerId === 'voicestudio') return {};
    const creds = this.deps.resolveTtsCredentials?.(providerId);
    if (!creds) return {};
    return { ttsApiKey: creds.apiKey, ...(creds.modelId ? { ttsModelId: creds.modelId } : {}) };
  }

  private jobFile(projectId: string): string {
    return join(this.deps.jobsDir, `${projectId.replace(/[^a-zA-Z0-9_-]/g, '_')}.job.json`);
  }

  loadJob(projectId: string): StagedProductionJob | null {
    const file = this.jobFile(projectId);
    if (!existsSync(file)) return null;
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as StagedProductionJob;
      const ensured = this.ensureContractForJob(parsed);
      if (ensured.upgraded) writeFileSync(file, JSON.stringify(ensured.job, null, 2), 'utf8');
      return ensured.job;
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
        if (parsed?.projectId) {
          const ensured = this.ensureContractForJob(parsed);
          if (ensured.upgraded) writeFileSync(join(this.deps.jobsDir, file), JSON.stringify(ensured.job, null, 2), 'utf8');
          jobs.push(ensured.job);
        }
      } catch {
        // ignore malformed job file
      }
    }
    return jobs.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }

  private isSuperseded(job: StagedProductionJob): boolean {
    const current = this.currentRun.get(job.projectId);
    if (!current) return false;
    return current.jobId !== (job.jobId ?? job.projectId) || (job.attempt ?? 1) < current.attempt;
  }

  private runKey(job: StagedProductionJob): string {
    return `${job.jobId ?? job.projectId}#${job.attempt ?? 1}`;
  }

  private saveJob(job: StagedProductionJob): StagedProductionJob {
    if (this.isSuperseded(job)) return job;
    if (job.state !== 'cancelled' && this.cancelledRuns.has(this.runKey(job))) return job;
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
    this.cancelledRuns.add(this.runKey(existing));
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
    ev.editorialStatus = input.decision === 'approved' ? 'human_approved' : 'candidate';
    ev.decisionReason = `Revisão humana: ${input.decision}${input.note ? ` — ${input.note}` : ''}`;
    const relevanceDecision = existing.mediaRelevanceDecisions?.find((decision) => decision.mediaId === ev.candidateId);
    if (relevanceDecision && input.decision === 'approved') {
      relevanceDecision.accepted = true;
      relevanceDecision.editorialStatus = 'human_approved';
      relevanceDecision.assemblyEligible = true;
      relevanceDecision.eligibleSegmentIds = [
        ...new Set([...(relevanceDecision.eligibleSegmentIds ?? []), ev.sceneId]),
      ];
    } else if (relevanceDecision) {
      relevanceDecision.accepted = false;
      relevanceDecision.editorialStatus = 'candidate';
      relevanceDecision.assemblyEligible = false;
    }
    const cand = existing.editorialAudit.candidates.find((c) => c.candidateId === input.candidateId);
    if (cand) {
      cand.status = input.decision === 'approved' ? 'human_approved' : 'rejected';
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
    const humanRequirement = existing.contract?.requirements.find((item) =>
      item.category === 'media' || (item.category === 'quality' && item.criterionIds.some((criterionId) =>
        existing.contract?.acceptanceCriteria.find((criterion) => criterion.id === criterionId)?.metric === 'human_review')),
    );
    if (existing.contract && humanRequirement) {
      existing.contract = recordContractEvidence(existing.contract, {
        requirementId: humanRequirement.id,
        stage: 'human_review',
        kind: 'human',
        outcome: input.decision === 'approved' ? 'supports' : 'contradicts',
        satisfiesRequirement: input.decision === 'approved',
        summary: `Revisão humana ${input.decision} para ${input.candidateId}${input.note ? `: ${input.note}` : '.'}`,
        artifactIds: [input.candidateId],
      });
    }
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
    // tombstone: a run still unwinding after the abort must not recreate the deleted job file
    this.currentRun.set(projectId, { jobId: '__deleted__', attempt: Number.MAX_SAFE_INTEGER });

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
    /** Optional caller-provided execution id; a new unique id is generated otherwise. */
    jobId?: string;
    prompt: string;
    genre?: CinemaGenre;
    format?: DeliveryFormat;
    creativeSelection?: AetheraCreativeSelection;
    deliveryPresetId?: string;
    deliveryPresetIds?: string[];
    previewProfile?: DeliveryQualityProfile;
    targetDurationSec?: number;
    humorIntensity?: number;
    renderProfile?: RenderQualityProfile;
    useNvenc?: boolean;
    voiceStudioVoiceId?: string;
    ttsProviderId?: string;
    ttsVoiceId?: string;
    language?: string;
    manuallyChangedFields?: ContractControlField[];
    seedMediaFiles?: string[];
    allowDeterministicScriptFallback?: boolean;
  }): Promise<StagedProductionJob> {
    const projectPaths = this.ensureProjectWorkspace(input.projectId, input.prompt);
    const contractControls: Partial<ProductionContractControls> = {
      ...(input.genre ? { genre: input.genre } : {}),
      ...(input.format ? { format: input.format } : {}),
      ...(input.creativeSelection ? { creativeSelection: input.creativeSelection } : {}),
      ...(input.deliveryPresetId ? { deliveryPresetId: input.deliveryPresetId } : {}),
      ...(input.previewProfile ? { previewProfile: input.previewProfile } : {}),
      ...(input.targetDurationSec !== undefined ? { targetDurationSec: input.targetDurationSec } : {}),
      ...(input.humorIntensity !== undefined ? { humorIntensity: input.humorIntensity } : {}),
      ...(input.renderProfile ? { renderProfile: input.renderProfile } : {}),
      ...(input.language ? { language: input.language } : {}),
      ...(input.voiceStudioVoiceId ? { voiceId: input.voiceStudioVoiceId } : {}),
    };
    const contract = extractProductionContract({
      projectId: input.projectId,
      prompt: input.prompt,
      controls: contractControls,
      ...(input.manuallyChangedFields ? { manuallyChangedFields: input.manuallyChangedFields } : {}),
    });
    const job: StagedProductionJob = {
      projectId: input.projectId,
      jobId: input.jobId ?? createProductionJobId('job'),
      attempt: 1,
      prompt: input.prompt,
      contract,
      contractHistory: [],
      ...(input.manuallyChangedFields ? { manuallyChangedFields: input.manuallyChangedFields } : {}),
      ...(input.genre ? { genre: input.genre } : {}),
      ...(input.format ? { format: input.format } : {}),
      ...(input.creativeSelection ? { creativeSelection: input.creativeSelection } : {}),
      ...(input.deliveryPresetId ? { deliveryPresetId: input.deliveryPresetId } : {}),
      ...(input.deliveryPresetIds?.length ? { deliveryPresetIds: input.deliveryPresetIds } : {}),
      ...(input.previewProfile ? { previewProfile: input.previewProfile } : {}),
      targetDurationSec: input.targetDurationSec ?? contract.controls.targetDurationSec,
      humorIntensity: input.humorIntensity ?? 35,
      renderProfile: input.renderProfile ?? 'review_720p',
      useNvenc: input.useNvenc ?? true,
      ...(input.voiceStudioVoiceId ? { voiceStudioVoiceId: input.voiceStudioVoiceId } : {}),
      ...(input.ttsProviderId ? { ttsProviderId: input.ttsProviderId } : {}),
      ...(input.ttsVoiceId ? { ttsVoiceId: input.ttsVoiceId } : {}),
      ...(input.language ? { language: input.language } : {}),
      ...(input.allowDeterministicScriptFallback !== undefined ? { allowDeterministicScriptFallback: input.allowDeterministicScriptFallback } : {}),
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
    const initialContractEvidence = this.recordStageEvidence(job.contract, 'prompt', 'extraction', 'Briefing original preservado e requisitos extraídos.');
    if (initialContractEvidence) job.contract = initialContractEvidence;
    this.currentRun.set(input.projectId, { jobId: job.jobId ?? input.projectId, attempt: 1 });

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
    return this.runOrResume(job, true);
  }

  async resume(projectId: string): Promise<StagedProductionJob> {
    const job = this.loadJob(projectId);
    if (!job) throw new Error(`not_found: Job ${projectId} não encontrado para retomada.`);
    return this.runOrResume(job);
  }

  async revise(projectId: string, instruction: string): Promise<StagedProductionJob> {
    const job = this.loadJob(projectId);
    if (!job) throw new Error(`not_found: Job ${projectId} não encontrado para revisão.`);
    const normalizedInstruction = instruction.trim();
    if (!normalizedInstruction) throw new Error('invalid_input: A revisão não pode ficar vazia.');
    if (!job.contract) {
      const ensured = this.ensureContractForJob(job);
      if (ensured.job.contract) job.contract = ensured.job.contract;
      if (ensured.job.contractHistory) job.contractHistory = ensured.job.contractHistory;
    }
    if (!job.contract) throw new Error('contract_missing: Não foi possível carregar o contrato da produção.');

    const revisedPrompt = `${job.prompt}\n\n[Revisão solicitada pelo usuário]\n${normalizedInstruction}`;
    const revised = reviseProductionContract(job.contract, {
      prompt: revisedPrompt,
      controls: job.contract.controls,
      ...(job.manuallyChangedFields ? { manuallyChangedFields: job.manuallyChangedFields } : {}),
      reason: normalizedInstruction,
    });
    job.contractHistory = [...(job.contractHistory ?? []), structuredClone(revised.previous)];
    job.contract = revised.current;
    job.prompt = revisedPrompt;
    job.contractRevisionAffectedStages = classifyContractRevisionStages(normalizedInstruction);
    job.genre = revised.current.controls.genre;
    job.format = revised.current.controls.format;
    job.targetDurationSec = revised.current.controls.targetDurationSec;
    job.humorIntensity = revised.current.controls.humorIntensity;
    job.renderProfile = revised.current.controls.renderProfile;
    job.language = revised.current.controls.language;
    if (revised.current.controls.voiceId) job.voiceStudioVoiceId = revised.current.controls.voiceId;
    delete job.contractCompliance;
    job.message = `Revisão ${revised.current.revision} recebida; recalculando apenas dependências afetadas...`;
    this.saveJob(job);
    return this.runOrResume(job);
  }

  private async runOrResume(job: StagedProductionJob, fresh = false): Promise<StagedProductionJob> {
    // Same job, new attempt: the console keeps one history per job and tags each entry with the attempt.
    job.jobId ??= job.projectId;
    job.attempt = fresh ? (job.attempt ?? 1) : (job.attempt ?? 1) + 1;
    this.currentRun.set(job.projectId, { jobId: job.jobId, attempt: job.attempt });
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
      const hasPreviousGroundingState = Boolean(
        job.sceneGroundingPolicyVersion || job.mediaRelevanceDecisions?.length || job.autonomousAudit,
      );
      const groundingPolicyChanged = hasPreviousGroundingState && job.sceneGroundingPolicyVersion !== SCENE_GROUNDING_POLICY_VERSION;
      if (groundingPolicyChanged) {
        // Re-evaluate metadata without deleting the local files. The acquisition stage scans the project directory
        // again, so the new policy can inspect every already-downloaded asset.
        job.acquiredMedia = [];
        job.mediaRelevanceDecisions = [];
        delete job.autonomousAudit;
        delete job.coverageReport;
        delete job.sceneAssembly;
        if (job.editorialAudit) {
          for (const candidate of job.editorialAudit.candidates) {
            if (['approved', 'approved_for_scene', 'human_approved'].includes(candidate.status)) {
              candidate.status = 'candidate';
              candidate.rejectionReason = `Aprovação invalidada para reavaliação pela política ${SCENE_GROUNDING_POLICY_VERSION}.`;
            }
          }
          for (const evidence of job.editorialAudit.groundingEvidences) {
            if (evidence.editorialStatus === 'approved_for_scene' || evidence.editorialStatus === 'human_approved' || evidence.decision === 'approved') {
              evidence.editorialStatus = 'candidate';
              evidence.decision = 'needs_review';
              evidence.positiveEvidences = [];
              evidence.approvedIntervals = [];
              evidence.negativeEvidences = [
                `Evidência antiga invalidada para reavaliação pela política ${SCENE_GROUNDING_POLICY_VERSION}.`,
              ];
              evidence.humanReview = { status: 'pending' };
            }
          }
          job.editorialAudit.timelinePlacements = [];
          delete job.editorialAudit.integrityReport;
        }
        job.pendingMedia = [];
        job.completedStages = job.completedStages.filter(
          (stage) => !['aquisicao', 'validacao_visual', 'planejamento', 'montagem', 'audio_sfx_vfx', 'qc', 'previa', 'editor'].includes(stage),
        );
        job.editorialAudit?.events.push({
          eventId: `evt_grounding_policy_${Date.now()}`,
          timestamp: new Date().toISOString(),
          stage: 'validacao_visual',
          message: `Scene Grounding reavaliado com a política ${SCENE_GROUNDING_POLICY_VERSION}; arquivos baixados preservados.`,
        });
      }
      job.sceneGroundingPolicyVersion = SCENE_GROUNDING_POLICY_VERSION;
      const relevanceDecisions: MediaRelevanceDecision[] = [...(job.mediaRelevanceDecisions ?? [])];
      const mediaRecoveryRequested =
        job.state === 'paused_pending_media' ||
        job.pendingMedia.length > 0 ||
        (job.autonomousAudit?.unresolvedGapsForReview.length ?? 0) > 0;

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
      let invalidation = computeIncrementalInvalidation({
        ...(job.interpretation?.promptHash ? { previousPromptHash: job.interpretation.promptHash } : {}),
        nextInterpretation,
        ...(job.researchDossier ? { previousDossier: job.researchDossier, nextDossier: job.researchDossier } : {}),
        ...(job.sceneDecupagem ? { previousScenes: job.sceneDecupagem, nextScenes: job.sceneDecupagem } : {}),
      });
      const revisionStages = new Set(job.contractRevisionAffectedStages ?? []);
      if (revisionStages.size > 0) {
        const researchAffected = revisionStages.has('pesquisa');
        const scriptAffected = revisionStages.has('roteiro');
        const decupagemAffected = revisionStages.has('decupagem');
        invalidation = {
          ...invalidation,
          researchValid: invalidation.researchValid || !researchAffected,
          scriptValid: invalidation.scriptValid || (!researchAffected && !scriptAffected),
          decupagemValid: invalidation.decupagemValid || (!researchAffected && !scriptAffected && !decupagemAffected),
          reasons: [...invalidation.reasons, `Revisão do contrato limitada às etapas: ${[...revisionStages].join(', ')}.`],
        };
        if (researchAffected) {
          delete job.researchDossier;
          delete job.editorialScript;
          delete job.sceneDecupagem;
        } else if (scriptAffected) {
          delete job.editorialScript;
          delete job.sceneDecupagem;
        } else if (decupagemAffected) {
          delete job.sceneDecupagem;
        }
        job.completedStages = job.completedStages.filter((stage) => !revisionStages.has(stage));
        delete job.contractRevisionAffectedStages;
      }
      job.invalidationReport = invalidation;
      const promptUnchanged = !job.interpretation?.promptHash || job.interpretation.promptHash === nextInterpretation.promptHash;
      const hasReusableSyntheticPlan = Boolean(job.editorialScript && job.sceneDecupagem && promptUnchanged);
      const hasCompletedAcquisitionCheckpoint = promptUnchanged && job.completedStages.includes('aquisicao');
      if (!invalidation.researchValid && !hasReusableSyntheticPlan && !hasCompletedAcquisitionCheckpoint) {
        delete job.researchDossier;
        delete job.editorialScript;
        delete job.sceneDecupagem;
        job.completedStages = job.completedStages.filter(
          (s) => s !== 'pesquisa' && s !== 'roteiro' && s !== 'decupagem' && s !== 'aquisicao' && s !== 'validacao_visual',
        );
      }
      job.interpretation = nextInterpretation;
      const interpretationEvidence = this.recordStageEvidence(
        job.contract,
        'interpretacao',
        'extraction',
        `Interpretação concluída na revisão ${job.contract?.revision ?? 0}: ${nextInterpretation.formatIntent}, ${nextInterpretation.language}, ${nextInterpretation.targetDurationSec}s.`,
      );
      if (interpretationEvidence) job.contract = interpretationEvidence;
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
          const dossier = await this.deps.runEditorialResearch(nextInterpretation, signal, {
            projectId: job.projectId,
            ...(job.creativeSelection ? { creativeSelection: job.creativeSelection } : {}),
            ...(job.deliveryPresetId ? { deliveryPresetId: job.deliveryPresetId } : {}),
            ...(job.contract ? { contractContext: contractContextForAgent(job.contract, ['content', 'research', 'narrative', 'language', 'quality']) } : {}),
          });
          // An aborted research returns no dossier: that is a cancellation, not a research failure.
          checkCancelled();
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
          const researchEvidence = this.recordStageEvidence(job.contract, 'pesquisa', 'research', `Dossiê editorial ${dossier.dossierId} validado com ${dossier.entities.length} entidade(s).`, 'supports', [dossier.dossierId]);
          if (researchEvidence) job.contract = researchEvidence;
        } else if (job.allowDeterministicScriptFallback) {
          const listAfterColon = /:\s*([^.?!\n]+)/.exec(job.prompt)?.[1] ?? '';
          const extractedNames = listAfterColon
            .split(/,|\s+e\s+/i)
            .map((s) => s.trim())
            .filter((s) => s.length >= 3 && s.length <= 60);
          if (extractedNames.length >= 2) {
            const dossier: EditorialResearchDossier = {
              dossierId: `dossier_det_${createHash('sha1').update(job.prompt).digest('hex').slice(0, 8)}`,
              dossierHash: createHash('sha1').update(extractedNames.join('|')).digest('hex').slice(0, 12),
              promptHash: nextInterpretation.promptHash,
              workTitle: extractedNames.slice(0, 2).join(' & '),
              theme: nextInterpretation.theme,
              rankingCriteria: nextInterpretation.rankingCriteria,
              entities: extractedNames.map((name, idx) => ({
                entityName: name,
                workTitle: name,
                role: 'obra_destaque',
                rankPosition: idx + 1,
                verifiedFacts: [`${name} marcou época com seus gráficos e jogabilidade.`],
                mechanicsOrEvents: [`gameplay de ${name}`],
                uncertainties: [],
                sources: [{ title: `Referência ${name}`, kind: 'agent_synthesis' }],
              })),
              uncertainties: [],
              sourcesUsed: ['prompt_explicit_list'],
              createdAt: new Date().toISOString(),
            };
            job.researchDossier = dossier;
          }
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
        job.researchDossier?.entities.map((e) =>
          isMultiWorkProduction(nextInterpretation) ? e.entityName : `${job.researchDossier!.workTitle} ${e.entityName}`,
        ) ??
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
            ...(job.creativeSelection ? { creativeSelection: job.creativeSelection } : {}),
            ...(job.deliveryPresetId ? { deliveryPresetId: job.deliveryPresetId } : {}),
            ...(job.language ? { language: job.language } : {}),
            targetDurationSec: job.targetDurationSec,
            humorIntensity: job.humorIntensity,
            queries: researchQueries,
            interpretation: nextInterpretation,
            ...(job.researchDossier ? { researchDossier: job.researchDossier } : {}),
            ...(job.contract ? { contractContext: contractContextForAgent(job.contract, ['content', 'duration', 'language', 'humor', 'narrative', 'research', 'narration']) } : {}),
            signal,
          });
          if (generated && (generated.beats?.length || generated.treatment)) {
            externalDirection = generated;
          }
        } catch {
          externalDirection = undefined;
        }
        checkCancelled();
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
            // The voice-over length, not targetDuration / beats: coverage must match what the narration needs.
            estimatedDurationSec:
              b.summary.split(/\s+/).filter(Boolean).length >= 6
                ? Math.max(4, Math.round(estimateNarrationSec(b.summary, job.language ?? 'pt-BR')))
                : beatDur,
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
          spokenText:
            ent.workTitle && ent.workTitle !== ent.entityName
              ? `${ent.entityName} em ${ent.workTitle}: ${ent.mechanicsOrEvents[0] ?? ent.verifiedFacts[0] ?? ent.role}.`
              : `${ent.entityName}: ${ent.mechanicsOrEvents[0] ?? ent.verifiedFacts[0] ?? ent.role}.`,
          estimatedDurationSec: Math.max(4, Math.round(job.targetDurationSec / Math.max(2, dossier.entities.length + 2))),
          approved: true,
        }));
        const fallbackIntroDur = Math.max(4, Math.round(job.targetDurationSec / Math.max(2, dossier.entities.length + 2)));
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
              spokenText: `Hoje vamos relembrar ${dossier.entities.map((e) => e.entityName).slice(0, 5).join(', ')}.`,
              estimatedDurationSec: fallbackIntroDur,
              approved: true,
            },
            ...entityBeats,
            {
              segmentId: `seg_${entityBeats.length + 2}`,
              beatId: `nbeat_${entityBeats.length + 2}_resolution`,
              stage: 'resolution',
              title: 'Conclusão',
              spokenText: `Qual desses clássicos marcou a sua história? Comente abaixo!`,
              estimatedDurationSec: fallbackIntroDur,
              approved: true,
            },
          ],
        });
      }
      if (job.editorialScript && job.targetDurationSec > 0) {
        const totalEstSec = job.editorialScript.segments.reduce((s, seg) => s + seg.estimatedDurationSec, 0);
        if (totalEstSec > job.targetDurationSec * 1.05 && job.editorialScript.segments.length > 0) {
          const perSegTargetSec = Math.max(3, (job.targetDurationSec * 1.04) / job.editorialScript.segments.length);
          const maxWordsPerSeg = Math.max(7, Math.floor(perSegTargetSec * 2.35));
          job.editorialScript = {
            ...job.editorialScript,
            segments: job.editorialScript.segments.map((seg) => {
              const words = seg.spokenText.trim().split(/\s+/).filter(Boolean);
              const trimmedText =
                words.length > maxWordsPerSeg ? `${words.slice(0, maxWordsPerSeg).join(' ').replace(/[,;:]$/, '')}.` : seg.spokenText;
              return {
                ...seg,
                spokenText: trimmedText,
                estimatedDurationSec: Math.max(3, Math.round(estimateNarrationSec(trimmedText, job.language ?? 'pt-BR'))),
              };
            }),
          };
        }
      }
      if (job.editorialScript && job.researchDossier) {
        const scriptCheck = validateScriptAgainstDossier(job.editorialScript, job.researchDossier, nextInterpretation);
        if (!scriptCheck.valid && !job.allowDeterministicScriptFallback) {
          job.error = `script_coverage_warning: ${scriptCheck.reasons.join(' | ')}`;
        }
      }
      job.completedStages = [...new Set([...job.completedStages, 'roteiro'])] as ProductionStageState[];
      const scriptEvidence = this.recordStageEvidence(job.contract, 'roteiro', 'script', `Roteiro editorial preparado${externalDirection?.providerUsed ? ` por ${externalDirection.providerUsed}` : ''}.`);
      if (scriptEvidence) job.contract = scriptEvidence;
      this.saveJob(job);

      // 4. DECUPAGEM SEMÂNTICA (gera consultas específicas por cena antes da aquisição)
      checkCancelled();
      job.state = 'decupagem';
      job.progressPct = 44;
      job.message = 'Gerando decupagem semântica e consultas específicas por cena...';
      if (!job.sceneDecupagem && job.editorialScript && job.researchDossier) {
        job.sceneDecupagem = buildSemanticDecupagem(job.editorialScript, job.researchDossier, nextInterpretation);
      } else if (!job.sceneDecupagem && job.editorialScript) {
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
      const storyboardEvidence = this.recordStageEvidence(job.contract, 'decupagem', 'storyboard', `Decupagem semântica preparada para ${job.sceneDecupagem?.length ?? 0} cena(s).`);
      if (storyboardEvidence) job.contract = storyboardEvidence;
      if (job.researchDossier && job.editorialScript && job.sceneDecupagem) {
        const repaired = repairSemanticDecupagem({
          projectId: job.projectId,
          dossier: job.researchDossier,
          script: job.editorialScript,
          interpretation: nextInterpretation,
          decupagem: job.sceneDecupagem,
          ...(job.editorialAudit ? { previousTrail: job.editorialAudit } : {}),
          maxAttempts: 2,
        });
        job.sceneDecupagem = repaired.decupagem;
        job.editorialAudit = repaired.trail;
        job.editorialAudit.events.push({
          eventId: `evt_decupagem_${Date.now()}`,
          timestamp: new Date().toISOString(),
          stage: 'decupagem',
          message:
            repaired.repairedSceneIds.length > 0
              ? `Rastreabilidade construída e reparo editorial aplicado em ${repaired.repairedSceneIds.length} cena(s) (${repaired.attempts} tentativa(s)): ${job.editorialAudit.sources.length} fontes, ${job.editorialAudit.facts.length} fatos, ${job.editorialAudit.scriptBlocks.length} blocos, ${job.editorialAudit.scenes.length} cenas.`
              : `Rastreabilidade construída: ${job.editorialAudit.sources.length} fontes, ${job.editorialAudit.facts.length} fatos, ${job.editorialAudit.scriptBlocks.length} blocos, ${job.editorialAudit.scenes.length} cenas.`,
        });
        job.editorialAudit.integrityReport = repaired.report;
      }
      this.saveJob(job);

      const scenesForAcquisition = job.sceneDecupagem ?? [];
      const multiWorkProduction = isMultiWorkProduction(nextInterpretation);
      // Content domain of the project (anime/game/movie…) from the briefing interpretation, reconciled with the
      // semantic evidence of the prompt and the researched works. The narrative format (genre) never decides it.
      const projectDomainInference = resolveProjectDomain({
        promptDomain: nextInterpretation.domain,
        prompt: job.prompt,
        workTitles: [
          ...new Set(scenesForAcquisition.flatMap((s) => (multiWorkProduction ? (s.works ?? []) : [s.workTitle])).filter(Boolean)),
        ],
        ...(job.genre ? { genre: job.genre } : {}),
      });
      const projectDomain = projectDomainInference.domain;
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
        if (
          this.deps.autonomousAcquisitionDeps &&
          (job.acquiredMedia.length < queries.length || groundingPolicyChanged || mediaRecoveryRequested)
        ) {
          const plannedSceneDurationById = new Map<string, number>();
          if (scenesForAcquisition.length > 0 && job.targetDurationSec > 0) {
            try {
              const dryPkg = produceCinemaPackage({
                projectId: job.projectId,
                prompt: job.prompt,
                ...(job.genre ? { genre: job.genre } : {}),
                ...(job.format ? { format: job.format } : {}),
                ...(job.creativeSelection ? { creativeSelection: job.creativeSelection } : {}),
                ...(job.deliveryPresetId ? { deliveryPresetId: job.deliveryPresetId } : {}),
                ...(job.deliveryPresetIds?.length ? { deliveryPresetIds: job.deliveryPresetIds } : {}),
                previewProfile: previewProfileForJob(job),
                targetDurationSec: job.targetDurationSec,
                humorIntensity: job.humorIntensity,
                renderProfile: job.renderProfile,
                mediaCatalog: [],
                ...(job.editorialScript ? { editorialScript: job.editorialScript } : {}),
                ...(job.contract ? { productionContract: job.contract } : {}),
              });
              const dryV1 = dryPkg.timeline.clips
                .filter((c) => c.trackId === 'v1')
                .sort((a, b) => a.timelineRange.start.value / a.timelineRange.start.rate - b.timelineRange.start.value / b.timelineRange.start.rate);
              dryV1.forEach((clip, idx) => {
                const sceneIdx =
                  dryV1.length === scenesForAcquisition.length
                    ? idx
                    : Math.min(scenesForAcquisition.length - 1, Math.floor((idx * scenesForAcquisition.length) / Math.max(1, dryV1.length)));
                const sc = scenesForAcquisition[sceneIdx];
                if (!sc) return;
                const durSec = clip.timelineRange.duration.value / Math.max(1, clip.timelineRange.duration.rate);
                plannedSceneDurationById.set(sc.sceneId, (plannedSceneDurationById.get(sc.sceneId) ?? 0) + durSec);
              });
            } catch {
              // fallback to scaled narrationSec below
            }
          }
          const rawSceneDurationSum = scenesForAcquisition.reduce(
            (sum, s) => sum + Math.max(4, s.narrationSec ?? s.durationSec),
            0,
          );
          const durationScale =
            job.targetDurationSec > 0 && rawSceneDurationSum > 0 && rawSceneDurationSum < job.targetDurationSec * 0.9
              ? job.targetDurationSec / rawSceneDurationSum
              : 1;
          const initialSegments =
            scenesForAcquisition.length > 0
              ? scenesForAcquisition.map((s) => ({
                  segmentId: s.sceneId,
                  // In a ranking of several works the list label ("Animes com Sistemas de Magia") is not a work:
                  // prefixing it to every subject/entity made searches and the identity gate look for a title
                  // that does not exist.
                  subject: multiWorkProduction
                    ? `${(s.works ?? s.entities).slice(0, 2).join(' / ') || s.expectedEvent}${s.visualKeywords?.[0] ? ` — ${s.visualKeywords[0]}` : ''}`
                    : s.entities[0]
                      ? `${s.workTitle} ${s.entities[0].replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim()}`
                      : s.expectedEvent,
                  narrationText: s.narrationText,
                  expectedEvent: s.expectedEvent,
                  preferredQueries: s.mediaQueries,
                  ...(() => {
                    const work = workReferenceForScene(s, { multiWork: multiWorkProduction, language: nextInterpretation.language });
                    return work ? { work } : {};
                  })(),
                  entities: (() => {
                    const raw =
                      s.matchingCriteria.requiredEntities.length > 0
                        ? multiWorkProduction
                          ? [...(s.works ?? []), ...s.matchingCriteria.requiredEntities]
                          : [s.workTitle, ...s.matchingCriteria.requiredEntities]
                        : extractTopicEntities(`${multiWorkProduction ? '' : s.workTitle} ${s.entities.join(' ')} ${s.narrationText}`);
                    const expanded = new Set<string>();
                    for (const item of raw) {
                      const clean = item.replace(/\([^)]*\)/g, '').trim();
                      if (clean) expanded.add(clean);
                      const shortName = clean.split(',')[0]?.trim();
                      if (shortName && shortName.length >= 2) expanded.add(shortName);
                    }
                    return [...expanded];
                  })(),
                  expectedDurationSec: Math.max(
                    4,
                    Math.round(
                      plannedSceneDurationById.get(s.sceneId) ??
                        Math.max(4, s.narrationSec ?? s.durationSec) * durationScale,
                    ),
                  ),
                }))
              : queries.map((q, idx) => ({
                  segmentId: `slot_${idx + 1}`,
                  subject: q,
                  narrationText: q,
                  entities: extractTopicEntities(q),
                  expectedDurationSec: Math.max(8, Math.round((job.targetDurationSec ?? 90) / Math.max(1, queries.length))),
                }));

          checkCancelled();
          // Keep state as 'aquisicao' until runAutonomousMediaAcquisition actually completes.
          // Setting 'validacao_visual' here and saving would make the stage tracker emit
          // 'aquisicao stage_completed' before any download/validation ran (root cause of the
          // premature-completion bug observed in job_mwjp4upj_31mqyofu / cinema_1794859719031).
          job.progressPct = 58;
          job.message = 'Adquirindo e validando mídias orientadas pela decupagem semântica...';
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

          let lastDownloadProgressEmitMs = 0;
          const auditedDeps: ResilientAcquisitionDeps = {
            ...baseDeps,
            onDownloadProgress: (progress) => {
              const now = Date.now();
              if (progress.pct !== 100 && now - lastDownloadProgressEmitMs < 450) return;
              lastDownloadProgressEmitMs = now;
              const rawLabel = (progress.title ?? progress.url).replace(/\s+/g, ' ').trim();
              const shortLabel = rawLabel.length > 48 ? `${rawLabel.slice(0, 45)}...` : rawLabel;
              const doneMb = (progress.bytesDone / (1024 * 1024)).toFixed(1);
              const progressText =
                progress.pct !== null && progress.bytesTotal
                  ? `${progress.pct}% (${doneMb} / ${(progress.bytesTotal / (1024 * 1024)).toFixed(1)} MB)`
                  : `${doneMb} MB recebidos`;
              job.message = `Baixando mídia "${shortLabel}": ${progressText}`;
              job.downloadProgress = {
                label: shortLabel,
                pct: progress.pct,
                bytesDone: progress.bytesDone,
                bytesTotal: progress.bytesTotal,
              };
              this.deps.onProgress?.(job);
            },
            // Scope provider telemetry and downloads to this job so console lines land in the right production.
            ...(baseDeps.mediaProviders
              ? {
                  mediaProviders: {
                    ...baseDeps.mediaProviders,
                    context: {
                      ...(baseDeps.mediaProviders.context ?? {}),
                      jobId: job.projectId,
                      projectId: job.projectId,
                      prompt: job.prompt,
                      ...(job.genre ? { genre: job.genre } : {}),
                      projectDomain,
                      ...(job.creativeSelection ? { creativeSelection: job.creativeSelection } : {}),
                      ...(job.deliveryPresetId ? { deliveryPresetId: job.deliveryPresetId } : {}),
                      ...(job.contract
                        ? {
                            contractId: job.contract.contractId,
                            contractRevision: job.contract.revision,
                            contractRequirements: contractContextForAgent(job.contract, ['content', 'media', 'research', 'quality', 'narrative']),
                          }
                        : {}),
                    },
                  },
                }
              : {}),
            localMediaDirs: [...new Set([projectPaths.mediaDir, ...(baseDeps.localMediaDirs ?? [])])],
            ...(baseDeps.ytDlpAcquireFn
              ? {
                  ytDlpAcquireFn: async (targetUrl, idx, dir, sig, downloadSection, onProgress) => {
                    job.message = `Iniciando download [slot ${idx + 1}]: ${targetUrl}`;
                    job.downloadProgress = {
                      label: `slot ${idx + 1} · ${targetUrl}`,
                      pct: null,
                      bytesDone: 0,
                      bytesTotal: null,
                    };
                    this.deps.onProgress?.(job);
                    return baseDeps.ytDlpAcquireFn!(targetUrl, idx, dir, sig, downloadSection, onProgress);
                  },
                }
              : {}),
            ...(baseDeps.ytDlpSearchFn
              ? {
                  ytDlpSearchFn: async (q, count, sig) => {
                    const matchedScene = resolveSceneForQuery(q);
                    const qPreview = q.length > 52 ? `${q.slice(0, 49)}...` : q;
                    job.message = `Consultando YouTube (${matchedScene?.sceneId ?? 'mídia'}): "${qPreview}"`;
                    this.deps.onProgress?.(job);
                    const startedAt = new Date().toISOString();
                    const t0 = Date.now();
                    const prevSameScene = trail.queries.filter((x) => x.sceneId === (matchedScene?.sceneId ?? 'scene_unknown'));
                    const attemptNumber = prevSameScene.length + 1;
                    const queryId = `qry_${trail.queries.length + 1}_${Date.now()}`;
                    try {
                      const rows = await baseDeps.ytDlpSearchFn!(q, count, sig);
                      job.message = `YouTube retornou ${rows.length} candidato(s) para "${qPreview}"`;
                      this.deps.onProgress?.(job);
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
            projectDomain,
            format: job.format === 'shorts_9_16' ? 'shorts' : 'analysis',
            segments: initialSegments,
            mediaDir: projectPaths.mediaDir,
            deps: auditedDeps,
            probeDurationFn: async (fp) => (await probeRealMp4(fp)).durationSec,
            ...(this.deps.analyzeFrames
              ? {
                  analyzeFrames: async (uri, timestampsSec, segment) => {
                    job.message = `Analisando frames (${segment.segmentId}) com VisionRouter...`;
                    this.deps.onProgress?.(job);
                    return this.deps.analyzeFrames!(uri, timestampsSec, segment);
                  },
                }
              : {}),
            ...(this.deps.analyzeRemoteFramesFn ? { analyzeRemoteFramesFn: this.deps.analyzeRemoteFramesFn } : {}),
            requireVisualVerification: this.deps.requireVisualVerification ?? true,
            evolution: this.deps.evolutionCore,
            limits: {
              ...(job.acquisitionBudgetMultiplier !== undefined ? { budgetMultiplier: job.acquisitionBudgetMultiplier } : {}),
              // yt-dlp section downloads routinely exceed the 35 s per-operation limit; they were being cut and
              // reported as "cancelled".
              perDownloadTimeoutMs: 150_000,
            },
            // Identity-verified footage with unresolved rights is assembled into the draft and listed for rights
            // review before publication, instead of silently blocking every scene.
            licensePolicy: 'assemble_with_rights_review',
            signal,
          });

          // Only now that acquisition + visual grounding actually finished can we transition out of 'aquisicao'.
          // This prevents the stage tracker from emitting 'aquisicao stage_completed' before downloads/validation ran.
          checkCancelled();
          delete job.downloadProgress;
          job.state = 'validacao_visual';
          job.progressPct = 62;
          job.message = 'Validando mídias por Scene Grounding e evidências por frame...';
          this.saveJob(job);

          job.autonomousAudit = audit;
          const existingDecisionIds = new Set(relevanceDecisions.map((decision) => decision.mediaId));
          const affectedSegmentIds = new Set(audit.affectedSegmentIds);
          const auditMediaIds = new Set(
            audit.recoveryAttempts.flatMap((attempt) => [
              ...attempt.acquiredMediaIds,
              ...attempt.approvedMediaIds,
              ...attempt.rejectedMediaIds,
            ]),
          );
          const newlyAuditedDecisions = audit.relevanceDecisions.filter(
            (decision) =>
              !existingDecisionIds.has(decision.mediaId) &&
              (affectedSegmentIds.size === 0 ||
                auditMediaIds.has(decision.mediaId) ||
                decision.eligibleSegmentIds?.some((segmentId) => affectedSegmentIds.has(segmentId)) ||
                decision.matchedIntervals?.some((interval) => affectedSegmentIds.has(interval.segmentId))),
          );
          relevanceDecisions.push(...newlyAuditedDecisions);
          job.coverageReport = audit.coverageReport;

          // Record Grounding Evidences & Placements into EditorialAuditTrail
          for (const dec of newlyAuditedDecisions) {
            const approvedAsset = audit.approvedAssets.find((a) => a.mediaId === dec.mediaId);
            const assemblyEligible = isAssemblyEligibleDecision(dec);
            const editorialStatus = dec.editorialStatus ?? (assemblyEligible ? 'approved_for_scene' : dec.accepted ? 'contextual' : 'candidate');
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
                status: assemblyEligible ? 'approved_for_scene' : dec.accepted ? editorialStatus : 'rejected',
                ...(!dec.accepted && dec.reason ? { rejectionReason: dec.reason } : {}),
              };
              trail.candidates.push(candRec);
            } else {
              existingCand.status = assemblyEligible ? 'approved_for_scene' : dec.accepted ? editorialStatus : 'rejected';
              if (approvedAsset?.uri) existingCand.localUri = approvedAsset.uri;
              if (!dec.accepted && dec.reason) existingCand.rejectionReason = dec.reason;
            }

            const framesAnalyzed = (dec.visualEvidence ?? []).map((ve, vIdx) => ({
              timestampSec: ve.timestampSec ?? vIdx * 3,
              summary: ve.description ?? dec.reason ?? '',
              matchedEntities: ve.detectedEntities ?? [],
              matchedActions: ve.detectedActions ?? [],
              ...(ve.visibleText?.length ? { visibleText: ve.visibleText } : {}),
              isPositive: assemblyEligible,
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
              positiveEvidences: assemblyEligible ? [dec.reason ?? 'Correspondência visual confirmada'] : [],
              negativeEvidences: !assemblyEligible ? [dec.reason ?? 'Sem prova suficiente para aprovar footage da cena'] : [],
              confidence: dec.score,
              editorialStatus,
              approvedIntervals: assemblyEligible ? intervalsFromDec : [],
              rejectedIntervals: !assemblyEligible ? intervalsFromDec : [],
              decision: assemblyEligible ? 'approved' : dec.accepted ? 'needs_review' : 'rejected',
              decisionReason: dec.reason ?? (dec.accepted ? 'Aprovado' : 'Rejeitado'),
              narrationRelation: matchedScene?.narrationText ?? '',
              humanReview: { status: 'pending' },
            };
            trail.groundingEvidences.push(evRec);

            if (assemblyEligible && approvedAsset && intervalsFromDec.length > 0) {
              const dur = intervalsFromDec.reduce((sum, interval) => sum + Math.max(0, interval.endSec - interval.startSec), 0);
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
            // Relevance verification says nothing about rights: carry the explicit rights status instead of "verified".
            const rightsLicense = detail?.rightsStatus ? `rights:${detail.rightsStatus}` : 'rights:unresolved_third_party';
            media.license = rightsLicense;
            this.cache.registerConsumer({
              url: detail?.sourceUrl ?? `local://${job.projectId}/${approved.mediaId}`,
              origin: approved.origin ?? 'autonomous_acquisition',
              license: rightsLicense,
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

          // Partial completion: uncovered scenes are assembled with labeled graphic recovery and reported as pending.
          // Only when verified footage is too scarce to make a real video does the production stop for human review
          // (with the concrete alternatives in `autonomousAudit.sceneDiagnostics`).
          if (
            audit.unresolvedGapsForReview.length > 0 &&
            (job.acquiredMedia.length === 0 || audit.coverageReport.coverageRatio < MIN_REAL_FOOTAGE_RATIO_TO_ASSEMBLE)
          ) {
            for (let gIdx = 0; gIdx < audit.unresolvedGapsForReview.length; gIdx += 1) {
              const gap = audit.unresolvedGapsForReview[gIdx]!;
              pending.push({
                slotIndex: gIdx,
                clipId: gap.segmentId,
                query: gap.suggestedQuery,
                reason: gap.reason,
                uncoveredIntervals: gap.uncoveredIntervals,
                missingDurationSec: gap.missingDurationSec,
                attempts: gap.attempts,
                editorialAlternatives: gap.editorialAlternatives,
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
              const candidates = await this.deps.searchExternalMedia(query, i, signal, {
                projectId: job.projectId,
              });
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
                { projectId: job.projectId },
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
              if (!isAssemblyEligibleDecision(relevance)) {
                // Keep the downloaded file for re-evaluation and human inspection; only the editorial decision is
                // rejected. A later run with a new grounding policy must not need to download it again.
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
        const visualValidationEvidence = this.recordStageEvidence(job.contract, 'validacao_visual', 'media', `Validação visual registrou ${relevanceDecisions.length} decisão(ões) de relevância.`, pending.length > 0 ? 'inconclusive' : 'supports');
        if (visualValidationEvidence) job.contract = visualValidationEvidence;
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
          const mediaRecoveryContract = this.recordMediaRecoveryAttempt(job.contract, pending, 'mídia pendente; alternativas de pesquisa ou revisão solicitadas');
          if (mediaRecoveryContract) job.contract = mediaRecoveryContract;
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
        ...(job.creativeSelection ? { creativeSelection: job.creativeSelection } : {}),
        ...(job.deliveryPresetId ? { deliveryPresetId: job.deliveryPresetId } : {}),
        ...(job.deliveryPresetIds?.length ? { deliveryPresetIds: job.deliveryPresetIds } : {}),
        previewProfile: previewProfileForJob(job),
        targetDurationSec: job.targetDurationSec,
        humorIntensity: job.humorIntensity,
        renderProfile: job.renderProfile,
        mediaCatalog: fallbackCatalog,
        ...(activeMemories.length > 0 ? { appliedMemories: activeMemories } : {}),
        ...(externalDirection ? { externalDirection } : {}),
        ...(job.editorialScript ? { editorialScript: job.editorialScript } : {}),
        ...(job.contract ? { productionContract: job.contract } : {}),
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
      // Scene-driven montage: v1 clips follow the decupagem order, so clip i belongs to scene i. Each scene is filled
      // with the verified intervals the acquisition coverage plan assigned to it (by sceneId), never by file name.
      const acquisitionCoverage = job.autonomousAudit?.coverageReport;
      const useSceneMontage = scenesForAcquisition.length > 0 && Boolean(acquisitionCoverage) && pkg.direction.narrativeBeats.length > 0;
      const sceneIdByClipId = new Map<string, string>();
      if (useSceneMontage && acquisitionCoverage) {
        const covBySceneId = new Map(acquisitionCoverage.segments.map((s) => [s.segmentId, s]));
        const availableMediaIds = new Set(job.acquiredMedia.map((m) => m.mediaId));
        const remainingByScene = new Map(
          scenesForAcquisition.map((s) => [
            s.sceneId,
            (covBySceneId.get(s.sceneId)?.relevantIntervals ?? []).map((iv) => ({ ...iv })),
          ]),
        );
        const videoTrackClips = pkg.timeline.clips
          .filter((c) => c.trackId === 'v1')
          .sort((a, b) => a.timelineRange.start.value / a.timelineRange.start.rate - b.timelineRange.start.value / b.timelineRange.start.rate);
        const montageByClipId = new Map<string, TimelineClip[]>();
        const assembly: SceneAssemblyRecord[] = [];
        videoTrackClips.forEach((clip, idx) => {
          const sceneIdx =
            videoTrackClips.length === scenesForAcquisition.length
              ? idx
              : Math.min(scenesForAcquisition.length - 1, Math.floor((idx * scenesForAcquisition.length) / videoTrackClips.length));
          const scene = scenesForAcquisition[sceneIdx]!;
          const remaining = remainingByScene.get(scene.sceneId) ?? [];
          const subject = (scene.works ?? scene.entities).slice(0, 2).join(' / ') || scene.expectedEvent;
          const label = scene.visualKeywords?.[0] ? `${subject} — ${scene.visualKeywords[0]}` : subject;
          const { clips, record } = buildSceneMontage({
            clip,
            sceneId: scene.sceneId,
            label,
            intervals: remaining,
            availableMediaIds,
            allowGraphicRecovery: true,
          });
          // Consume what this clip used so a later clip of the same scene never repeats the same source seconds.
          for (const part of clips) {
            const iv = remaining.find(
              (r) => r.mediaId === part.mediaId && Math.abs(r.startSec - part.sourceRange.start.value / part.sourceRange.start.rate) < 0.05,
            );
            if (!iv) continue;
            iv.startSec += part.timelineRange.duration.value / Math.max(1, part.timelineRange.duration.rate);
          }
          remainingByScene.set(scene.sceneId, remaining.filter((r) => r.endSec - r.startSec >= 1));
          for (const part of clips) {
            sceneIdByClipId.set(part.clipId, scene.sceneId);
            clipSegmentMap.set(part.clipId, scene.sceneId);
          }
          montageByClipId.set(clip.clipId, clips);
          assembly.push(record);
        });
        const nextClips: TimelineClip[] = [];
        for (const c of pkg.timeline.clips) {
          if (c.trackId === 'vfx1') continue;
          const replaced = c.trackId === 'v1' ? montageByClipId.get(c.clipId) : undefined;
          if (replaced) nextClips.push(...replaced);
          else nextClips.push(c);
        }
        const refreshedPlan = buildSceneAudiovisualPlan({
          requestedDurationSec: job.targetDurationSec,
          clips: nextClips,
          scenes: scenesForAcquisition.map((s) => ({
            sceneId: s.sceneId,
            subject: (s.works ?? s.entities).slice(0, 2).join(' / ') || s.expectedEvent,
            narrationText: s.narrationText,
            expectedEvent: s.expectedEvent,
          })),
          comedyBeats: pkg.timeline.comedyBeats,
        });
        const vfxFps = pkg.timeline.fps;
        const refreshedVfxClips: TimelineClip[] = refreshedPlan.vfxPlan.map((v, idx) => ({
          clipId: `vfx_clip_${idx + 1}`,
          trackId: 'vfx1',
          mediaId: `vfx_overlay_${v.effect}`,
          label: `${v.effect}: ${v.sceneId}`,
          sourceRange: {
            start: fromFrames(0, vfxFps),
            duration: fromFrames(Math.max(15, Math.round(v.durationSec * vfxFps.value)), vfxFps),
          },
          timelineRange: {
            start: fromFrames(Math.round(v.startSec * vfxFps.value), vfxFps),
            duration: fromFrames(Math.max(15, Math.round(v.durationSec * vfxFps.value)), vfxFps),
          },
          speed: 1,
          approved: true,
          effects: [{ effectId: `vfx_fx_${idx + 1}`, kind: v.effect, enabled: true, params: { sceneId: v.sceneId } }],
          keyframes: [],
        }));
        pkg = {
          ...pkg,
          timeline: { ...pkg.timeline, clips: [...nextClips, ...refreshedVfxClips] },
          audiovisualPlan: refreshedPlan,
          vfxPlan: refreshedPlan.vfxPlan,
          humorBeats: refreshedPlan.humorBeats,
        };
        job.sceneAssembly = assembly;
      } else if (job.acquiredMedia.length > 0 && pkg.direction.narrativeBeats.length > 0) {
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
            (isAssemblyEligibleDecision(decision) &&
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
      const sceneTimelineSec = new Map<string, number>();
      for (const rec of job.sceneAssembly ?? []) {
        sceneTimelineSec.set(rec.sceneId, (sceneTimelineSec.get(rec.sceneId) ?? 0) + rec.timelineSec);
      }
      const coverageSegments = useSceneMontage
        ? scenesForAcquisition.map((sc) => ({
            segmentId: sc.sceneId,
            subject: (sc.works ?? sc.entities).slice(0, 2).join(' / ') || sc.expectedEvent,
            narrationText: sc.narrationText,
            entities: [...new Set([...(sc.works ?? []), ...sc.matchingCriteria.requiredEntities, ...sc.entities])],
            // What the timeline actually gives the scene, not targetDuration ÷ scenes.
            expectedDurationSec: Math.max(4, Math.round(sceneTimelineSec.get(sc.sceneId) ?? sc.narrationSec ?? sc.durationSec)),
          }))
        : pkg.editorialScript
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
      const auditAssetDurationById = new Map(
        (job.autonomousAudit?.approvedAssets ?? []).map((a) => [a.mediaId, a.durationSec]),
      );
      const coverageAssets = job.acquiredMedia.map((m) => {
        const decision = relevanceDecisions.find((d) => d.mediaId === m.mediaId);
        const rawDur = m.duration.value / Math.max(1, m.duration.rate);
        const auditDur = auditAssetDurationById.get(m.mediaId);
        const effectiveDur =
          m.kind === 'image' && auditDur && auditDur > rawDur ? auditDur : rawDur;
        return {
          mediaId: m.mediaId,
          uri: m.uri,
          title: basename(m.uri),
          origin: m.origin,
          durationSec: effectiveDur,
          compatible: decision ? isAssemblyEligibleDecision(decision) : false,
          ...(decision?.matchedEntities ? { relevantToEntities: decision.matchedEntities } : {}),
          ...(decision && !decision.accepted ? { rejectedReason: decision.reason } : {}),
        };
      });
      const coverageUsages = pkg.timeline.clips
        .filter((c) => c.trackId === 'v1' && c.mediaId && !c.effects.some((e) => e.kind === 'graphic_recovery' && e.enabled))
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
      // With the scene montage, gaps are already filled by labeled graphic recovery and repetition is prevented by
      // construction; the decision to stop for human review was taken after acquisition (real-footage ratio).
      if (!useSceneMontage && !coverageReport.gatePassed && job.acquiredMedia.length > 0 && (job.targetDurationSec ?? 90) >= 180) {
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
        const coverageRecoveryContract = this.recordMediaRecoveryAttempt(job.contract, job.pendingMedia, 'cobertura insuficiente; novas consultas geradas');
        if (coverageRecoveryContract) job.contract = coverageRecoveryContract;
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
      const assemblyEvidence = this.recordStageEvidence(job.contract, 'montagem', 'storyboard', 'Pacote audiovisual montado com a revisão atual do contrato.');
      if (assemblyEvidence) job.contract = assemblyEvidence;
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
      const baseAudioAssets = resolvePlannedSfxAssets(pkg.audiovisualPlan);
      const musicBed =
        baseAudioAssets?.music ??
        (await generateCinematicMusicBed(join(projectPaths.tempDir, 'cinematic_music_bed.wav'), job.targetDurationSec));
      const realAudioAssets: RealAudioAssetsInput | undefined =
        baseAudioAssets || musicBed
          ? {
              ...(baseAudioAssets ?? {}),
              ...(musicBed ? { music: musicBed } : {}),
            }
          : undefined;
      const resolvedAudioForGateB = realAudioAssets ? await resolveRealAudioAssets(realAudioAssets) : undefined;
      const gateA = runGateAPreAssembly({
        requestedDurationSec: job.targetDurationSec,
        coverageReport,
        plannedDurationSec: job.targetDurationSec,
      });
      const gateB = runGateBPreRender({
        timeline: pkg.timeline,
        requestedDurationSec: job.targetDurationSec,
        ...(resolvedAudioForGateB ? { realAudio: resolvedAudioForGateB } : {}),
        ...(pkg.audiovisualPlan ? { audiovisualPlan: pkg.audiovisualPlan } : {}),
      });
      job.qualityGates = [gateA, gateB];
      let render = await renderRealCinemaMp4({
        pkg,
        outputDir: projectPaths.rendersDir,
        fileName: `${job.projectId}.mp4`,
        useNvenc: job.useNvenc,
        requireRealMedia: job.acquiredMedia.length > 0,
        voiceStudioVoiceId: job.voiceStudioVoiceId || '9190edfa',
        ...(job.ttsProviderId ? { ttsProviderId: job.ttsProviderId } : {}),
        ...(job.ttsVoiceId ? { ttsVoiceId: job.ttsVoiceId } : {}),
        ...this.ttsCredentialsFor(job.ttsProviderId),
        evolution: this.deps.evolutionCore,
        prompt: job.prompt,
        previewQuality: 'fast_preview',
        renderTarget: 'preview',
        ...(job.deliveryPresetId ? { deliveryPresetId: job.deliveryPresetId } : {}),
        previewProfile: previewProfileForJob(job),
        segmentCacheDir,
        ...(realAudioAssets ? { realAudioAssets } : {}),
        ...(job.genre ? { genre: job.genre } : {}),
        ...(job.language ? { language: job.language } : {}),
      });
      const initialMeasurements: ContractMeasurementSnapshot = {
        durationSec: render.probe.durationSec,
        chapterCount: pkg.direction.narrativeBeats.length,
        width: render.probe.width,
        height: render.probe.height,
        mediaIntegrity: render.probe.videoCodec.length > 0 && render.probe.durationSec > 0 && render.probe.blackFramesCount === 0 && render.probe.frozenSegmentsCount === 0,
        synchronization: render.probe.avDurationDeltaSec <= 0.5,
        exportParametersValid: render.probe.width > 0 && render.probe.height > 0 && render.probe.videoCodec.length > 0 && Boolean(render.probe.audioCodec),
        ...(render.probe.integratedLufs !== null ? { integratedLufs: render.probe.integratedLufs } : {}),
        ...(render.probe.truePeakDbtp !== null ? { truePeakDbtp: render.probe.truePeakDbtp } : {}),
      };
      if (job.contract) {
        const evaluated = evaluateProductionContract(job.contract, initialMeasurements);
        job.contract = evaluated.contract;
        job.contractCompliance = evaluated.report;
      }
      job.audioFirstTimeline = render.audioFirstTimeline;
      job.captionAlignment = render.captionAlignment;
      job.smartCaptions = render.smartCaptions;
      job.audioSources = render.audioSources;
      job.audioDiagnostics = render.audioDiagnostics;
      job.musicSelection = render.musicSelection;
      job.deliveryGate = render.deliveryGate;
      const gateC = runGateCPostRender({
        requestedDurationSec: job.targetDurationSec,
        actualDurationSec: render.probe.durationSec,
        width: render.probe.width,
        height: render.probe.height,
        hasAudio: Boolean(render.probe.audioCodec),
        blackFramesCount: render.probe.blackFramesCount,
        clippingDetected: render.probe.truePeakDbtp !== null && render.probe.truePeakDbtp > -0.1,
      });
      job.qualityGates = [...(job.qualityGates ?? []), gateC];
      const previewEvidence = this.recordStageEvidence(
        job.contract,
        'previa',
        'measurement',
        `Prévia renderizada e medida por FFprobe; narração ${render.audioFirstTimeline?.measuredNarrationDurationMs ?? 'não informada'}ms, timeline final ${render.audioFirstTimeline?.finalTimelineDurationMs ?? Math.round(render.probe.durationSec * 1000)}ms.`,
      );
      if (previewEvidence) job.contract = previewEvidence;

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
                { projectId: job.projectId },
              );
              const pickedUrl = candidates[0]?.url;
              const downloadedPath = await this.deps.acquireExternalMedia(
                `${recoveryQuery} gameplay trailer`,
                10 + rIdx,
                projectPaths.mediaDir,
                signal,
                pickedUrl,
                { projectId: job.projectId },
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
              const clipSegId = clipSegmentMap.get(c.clipId) ?? sceneIdByClipId.get(c.clipId);
              const eligibleAltId = clipSegId
                ? altMediaPool.find(
                    (id) =>
                      id !== c.mediaId &&
                      relevanceDecisions.some(
                        (d) =>
                          d.mediaId === id &&
                          d.verificationOutcome === 'verified' &&
                          d.eligibleSegmentIds?.includes(clipSegId),
                      ),
                  )
                : undefined;
              const nextMediaId = recoveredId
                ? recoveredId
                : needSwapClip && eligibleAltId
                  ? eligibleAltId
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
          ...(job.ttsProviderId ? { ttsProviderId: job.ttsProviderId } : {}),
          ...(job.ttsVoiceId ? { ttsVoiceId: job.ttsVoiceId } : {}),
          ...this.ttsCredentialsFor(job.ttsProviderId),
          evolution: this.deps.evolutionCore,
          prompt: job.prompt,
          previewQuality: 'fast_preview',
          renderTarget: 'preview',
          ...(job.deliveryPresetId ? { deliveryPresetId: job.deliveryPresetId } : {}),
          previewProfile: previewProfileForJob(job),
          segmentCacheDir,
          ...(realAudioAssets ? { realAudioAssets } : {}),
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

      // Extra delivery masters reuse the acquired media, editorial timeline and voice/audio caches. Only scene
      // encoding is repeated when dimensions/FPS/codec make the cached segments incompatible.
      const primaryPresetId = pkg.deliveryProfile?.preset.id;
      const extraPresetIds = [...new Set((job.deliveryPresetIds ?? []).filter((id) => id && id !== primaryPresetId))];
      if (extraPresetIds.length > 0) {
        job.renderExports = [];
        for (const presetId of extraPresetIds) {
          checkCancelled();
          const extra = await renderRealCinemaMp4({
            pkg,
            outputDir: projectPaths.rendersDir,
            fileName: `${job.projectId}.${presetId}.mp4`,
            useNvenc: job.useNvenc,
            requireRealMedia: job.acquiredMedia.length > 0,
            voiceStudioVoiceId: job.voiceStudioVoiceId || '9190edfa',
            ...(job.ttsProviderId ? { ttsProviderId: job.ttsProviderId } : {}),
            ...(job.ttsVoiceId ? { ttsVoiceId: job.ttsVoiceId } : {}),
            evolution: this.deps.evolutionCore,
            prompt: job.prompt,
            deliveryPresetId: presetId,
            renderTarget: 'master',
            previewProfile: previewProfileForJob(job),
            previewQuality: 'standard',
            segmentCacheDir,
            ...(realAudioAssets ? { realAudioAssets } : {}),
            ...(job.genre ? { genre: job.genre } : {}),
            ...(job.language ? { language: job.language } : {}),
          });
          job.renderExports.push({
            presetId,
            mp4Path: extra.mp4Path,
            width: extra.probe.width,
            height: extra.probe.height,
            fps: extra.probe.fps,
            durationSec: extra.probe.durationSec,
            validationValid: extra.deliveryValidation?.valid ?? false,
            validationErrors: extra.deliveryValidation?.errors ?? [],
          });
          this.saveJob(job);
        }
      }

      job.isTechnicalSample = render.isTechnicalSample;
      job.audioFirstTimeline = render.audioFirstTimeline;
      job.captionAlignment = render.captionAlignment;
      job.smartCaptions = render.smartCaptions;
      job.audioSources = render.audioSources;
      job.audioDiagnostics = render.audioDiagnostics;
      job.musicSelection = render.musicSelection;
      job.deliveryGate = render.deliveryGate;
      const gateCFinal = runGateCPostRender({
        requestedDurationSec: job.targetDurationSec,
        actualDurationSec: render.probe.durationSec,
        width: render.probe.width,
        height: render.probe.height,
        hasAudio: Boolean(render.probe.audioCodec),
        blackFramesCount: render.probe.blackFramesCount,
        clippingDetected: render.probe.truePeakDbtp !== null && render.probe.truePeakDbtp > -0.1,
      });
      job.qualityGates = [...(job.qualityGates ?? []), gateCFinal];
      this.deps.onRenderReady(job.projectId, render);
      job.completedStages = [...new Set([...job.completedStages, 'previa', 'editor'])] as ProductionStageState[];

      // EDITOR
      job.state = 'editor';
      job.progressPct = 100;
      job.message = summarizeAssemblyOutcome(job);
      return this.saveJob(job);
    } catch (err) {
      if ((err instanceof Error && err.name === 'AbortError') || signal.aborted) {
        job.state = 'cancelled';
        job.message = 'Produção cancelada pelo usuário.';
        return this.saveJob(job);
      }
      job.state = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      captureRenderFailureDiagnostics(job, err);
      job.message = `Falha na etapa "${job.state}": ${job.error}`;
      return this.saveJob(job);
    } finally {
      // Only the run that still owns the project releases its controller; a superseded run must not drop the
      // controller of the run that replaced it (cancel would stop working).
      if (this.controllers.get(job.projectId) === ctrl) this.controllers.delete(job.projectId);
    }
  }
}
