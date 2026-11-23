/**
 * Pure, deterministic view-model projections for the Aethera Desktop Mangá Recap UI.
 *
 * Guarantees that:
 * 1. The Pipeline Timeline reflects REAL orchestrator state & completed steps (no simulated percentages).
 * 2. The Audiovisual Timeline reflects REAL shots, narration spans, MotionVelix SFX cues, and captions.
 * 3. The Quality Scorecard reflects REAL Gate F / Gate G / Gate H evaluations (no fabricated scores).
 * 4. "Projetos Recentes" always displays the active/current project plus persisted projects newest-first.
 */

export type RecapStageId =
  | 'import'
  | 'gate-f'
  | 'vision'
  | 'continuity'
  | 'script'
  | 'humanize'
  | 'motion'
  | 'gate-h';

export type StageVisualStatus = 'pending' | 'active' | 'completed' | 'paused' | 'failed';

export interface RecapStageMeta {
  id: RecapStageId;
  label: string;
  shortLabel: string;
}

/** Friendly UI names for the technical release-gate identifiers used in logs and persistence. */
export const RECAP_RELEASE_GATE_LABELS = {
  gateF: { label: 'Validação do capítulo', shortLabel: 'Validação', technicalLabel: 'Gate F' },
  gateG: { label: 'Fidelidade do roteiro', shortLabel: 'Roteiro', technicalLabel: 'Gate G' },
  gateH: { label: 'Qualidade audiovisual', shortLabel: 'Qualidade', technicalLabel: 'Gate H' },
} as const;

export const RECAP_PIPELINE_STAGES: readonly RecapStageMeta[] = [
  { id: 'import', label: 'Importação', shortLabel: 'Import' },
  { id: 'gate-f', label: RECAP_RELEASE_GATE_LABELS.gateF.label, shortLabel: RECAP_RELEASE_GATE_LABELS.gateF.shortLabel },
  { id: 'vision', label: 'Visão Multimodal', shortLabel: 'Visão' },
  { id: 'continuity', label: 'Continuidade', shortLabel: 'Contin.' },
  { id: 'script', label: RECAP_RELEASE_GATE_LABELS.gateG.label, shortLabel: RECAP_RELEASE_GATE_LABELS.gateG.shortLabel },
  { id: 'humanize', label: 'Humanização', shortLabel: 'Human.' },
  { id: 'motion', label: 'MotionVelix & Áudio', shortLabel: 'Motion' },
  { id: 'gate-h', label: RECAP_RELEASE_GATE_LABELS.gateH.label, shortLabel: RECAP_RELEASE_GATE_LABELS.gateH.shortLabel },
] as const;

export interface MotionVelixRenderTelemetry {
  engine: 'ffmpeg_motionvelix_hybrid';
  sfxDirUsed: string | null;
  sfxPlanned: number;
  sfxApplied: number;
  sfxKindsApplied: string[];
  vfxAppliedShots: number;
  transitionsApplied: number;
  motionStylesUsed: string[];
  fallbackUsed: boolean;
}

export interface MotionVelixKitStatusView {
  installed: boolean;
  kitRoot: string | null;
  sfxDir: string | null;
  hasRemotionKit: boolean;
  editingEngine: 'ffmpeg_motionvelix_hybrid';
  availableSfx: Array<{ kind: string; filename: string; path: string }>;
  missingSfx: Array<{ kind: string; filename: string }>;
  checkedPaths: string[];
  summary: string;
}

export interface RecapVisionFailedProviderView {
  providerId: string;
  code: string;
  reason: string;
  resetAtText?: string;
  fallbackTo?: string;
}

export interface RecapVisionLiveTelemetryView {
  activeProvider: string | null;
  activeModel: string | null;
  priorityOrder?: string[];
  nextFallback?: string | null;
  completedPanels: number;
  totalPanels: number;
  currentPanelIndex?: number;
  failedProviders: RecapVisionFailedProviderView[];
  fallbackActive: boolean;
  fallbackFrom?: string | null;
  canResumeFromCheckpoint: boolean;
  updatedAtIso: string;
}

export interface RecapProjectRecordView {
  schemaVersion?: 1;
  runId: string;
  chapterId: string;
  workTitle: string;
  archivePath?: string;
  language?: string;
  scriptStyle?: string;
  aspectRatio?: '16:9' | '9:16';
  ttsProvider?: string;
  humorVolume?: number;
  enableOcr?: boolean;
  panelCount?: number;
  sceneCount?: number;
  shotCount?: number;
  totalDurationMs?: number;
  state: string;
  currentStage?: RecapStageId | null;
  completedSteps: string[];
  visionTelemetry?: RecapVisionLiveTelemetryView;
  gateFVerdict?: 'pass' | 'needs_review' | 'fail';
  gateGVerdict?: 'pass' | 'needs_review' | 'fail';
  gateHVerdict?: 'pass' | 'needs_review' | 'fail';
  motionVelix?: MotionVelixRenderTelemetry;
  previewMp4Path?: string | null;
  masterMp4Path?: string | null;
  exportBundleDir?: string;
  lastError?: string;
  createdAtIso?: string;
  updatedAtIso: string;
}

export interface RecapDialogueEntryView {
  speaker?: string;
  text: string;
  originalText?: string;
  translatedText?: string;
  kind?: 'dialogue' | 'thought' | 'narration' | 'sfx';
  isNarration?: boolean;
  readingOrder?: number;
  uncertainty?: string;
}

export interface RecapScriptSceneView {
  sceneId: string;
  narrationText: string;
  characters?: string[];
  eventDescription?: string;
  visualSummary?: string;
  actions?: Array<{ type: string; description: string }>;
  setting?: string;
  extractedDialogues?: RecapDialogueEntryView[];
  uncertainties?: string[];
  panelIds?: string[];
  croppedImagePaths?: string[];
  estimatedDurationSec: number;
  measuredDurationSec?: number;
  durationSource?: 'estimated' | 'tts_measured';
  emotion?: string;
  narrativeIntent?: string;
  confidence?: number;
  reviewStatus?: string;
  reviewNotes?: string;
}

export interface RecapScriptView {
  chapterId: string;
  title: string;
  style?: string;
  totalEstimatedDurationSec?: number;
  scenes: RecapScriptSceneView[];
}

export interface RecapShotView {
  shotId: string;
  sceneId: string;
  sceneIndex: number;
  panelId: string;
  pageNumber: number;
  imagePath: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  motionStyle: string;
  transitionIn: string;
  balloonSafeZoneProtected: boolean;
  framingCropRisk?: { atRisk: boolean; reason?: string };
  emotion?: string;
  narrativeIntent?: string;
}

export interface RecapSfxCueView {
  cueId: string;
  sceneId: string;
  timeMs: number;
  sfxKind: string;
  gainDb: number;
  reason: string;
}

export interface RecapAudiovisualPlanView {
  chapterId: string;
  scriptTitle: string;
  renderTarget: 'preview' | 'master';
  aspectRatio: '16:9' | '9:16';
  width: number;
  height: number;
  fps: number;
  totalDurationMs: number;
  shots: RecapShotView[];
  sfxCues: RecapSfxCueView[];
  vfxSpecs?: Array<{
    sceneId: string;
    vignetteStrength: number;
    contrastBoost: number;
    shakeIntensity: number;
    balloonSafe: boolean;
  }>;
  captions?: {
    cues?: unknown[];
    ass?: string;
  };
  durationAudit?: {
    plannedTimelineDurationMs: number;
    measuredNarrationDurationMs: number;
    finalTimelineDurationMs: number;
  };
}

export interface RecapGateReportView {
  gate?: string;
  verdict: 'pass' | 'needs_review' | 'fail';
  checkedAtIso?: string;
  reasons: string[];
  metrics?: Record<string, number | string | boolean>;
  findings?: Array<{
    code?: string;
    severity?: 'critical' | 'warning';
    sceneId?: string;
    shotId?: string;
    detail?: string;
  }>;
  hints?: Array<{
    sceneId?: string;
    beatId?: string;
    issueCode: string;
    detail: string;
  }>;
}

export interface DerivedPipelineStage {
  id: RecapStageId;
  label: string;
  shortLabel: string;
  status: StageVisualStatus;
}

export interface DerivedPipelineTimeline {
  stages: DerivedPipelineStage[];
  completedCount: number;
  totalCount: number;
  overallProgressPct: number;
  activeStageId: RecapStageId | null;
  stateLabel: string;
  tone: 'neutral' | 'active' | 'warning' | 'success' | 'error';
  detailMessage: string;
}

export interface DerivedShotBlock {
  shotId: string;
  sceneId: string;
  sceneIndex: number;
  panelId: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  startPct: number;
  widthPct: number;
  motionStyle: string;
  transitionIn: string;
  balloonSafeZoneProtected: boolean;
  framingAtRisk: boolean;
  emotion: string;
}

export interface DerivedSfxMarker {
  cueId: string;
  sceneId: string;
  timeMs: number;
  offsetPct: number;
  sfxKind: string;
  gainDb: number;
  reason: string;
  applied: boolean;
}

export interface DerivedAudiovisualTracks {
  hasRealPlan: boolean;
  renderTarget: 'preview' | 'master' | null;
  resolutionLabel: string;
  fps: number;
  aspectRatio: '16:9' | '9:16' | null;
  totalDurationMs: number;
  measuredNarrationDurationMs: number;
  audioClipped: boolean;
  shots: DerivedShotBlock[];
  sfxMarkers: DerivedSfxMarker[];
  captionCueCount: number;
  vfxActiveCount: number;
}

export interface DerivedQualityScorecard {
  evaluated: boolean;
  approvedForRelease: boolean;
  technicalScore: number | null;
  narrativeScore: number | null;
  audioScore: number | null;
  gateFVerdict: string | null;
  gateGVerdict: string | null;
  gateHVerdict: string | null;
  reasons: string[];
  summary: string;
}

export function formatTimecodeMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '00:00.0';
  const totalTenths = Math.round(ms / 100);
  const tenths = totalTenths % 10;
  const totalSec = Math.floor(totalTenths / 10);
  const sec = totalSec % 60;
  const min = Math.floor(totalSec / 60);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${tenths}`;
}

export function toAetheraMediaUrl(filePath: string): string {
  if (
    filePath.startsWith('aethera-media://') ||
    filePath.startsWith('file://') ||
    filePath.startsWith('http://') ||
    filePath.startsWith('https://')
  ) {
    return filePath;
  }
  return `aethera-media://local?path=${encodeURIComponent(filePath)}`;
}

export function getStateMetadata(state: string): {
  label: string;
  tone: 'neutral' | 'active' | 'warning' | 'success' | 'error';
} {
  switch (state) {
    case 'completed':
      return { label: 'Concluído', tone: 'success' };
    case 'awaiting_preview_approval':
      return { label: 'Aguardando aprovação', tone: 'warning' };
    case 'paused_provider_unavailable':
      return { label: 'Pausado (provedor indisponível)', tone: 'warning' };
    case 'failed':
      return { label: 'Falhou', tone: 'error' };
    case 'importing':
      return { label: 'Importando', tone: 'active' };
    case 'preflight':
    case 'story_engine':
    case 'audiovisual_preview':
    case 'master_export':
      return { label: 'Em produção', tone: 'active' };
    default:
      return { label: 'Aguardando início', tone: 'neutral' };
  }
}

function isStepDone(stageId: RecapStageId, completed: Set<string>, record: RecapProjectRecordView): boolean {
  if (record.state === 'completed') return true;
  if (completed.has(stageId)) return true;

  switch (stageId) {
    case 'import':
      return (
        completed.has('import') ||
        completed.has('preflight') ||
        completed.has('story_engine') ||
        completed.has('audiovisual_preview')
      );
    case 'gate-f':
      return (
        completed.has('gate-f') ||
        record.gateFVerdict === 'pass' ||
        record.gateFVerdict === 'needs_review' ||
        completed.has('story_engine') ||
        completed.has('audiovisual_preview')
      );
    case 'vision':
    case 'continuity':
    case 'script':
      return completed.has('story_engine') || completed.has('audiovisual_preview');
    case 'humanize':
      return completed.has('humanize') || completed.has('audiovisual_preview');
    case 'motion':
      return (
        completed.has('motion') ||
        completed.has('audiovisual_preview') ||
        completed.has('master_export')
      );
    case 'gate-h':
      return (
        completed.has('gate-h') ||
        record.state === 'awaiting_preview_approval' ||
        record.gateHVerdict === 'pass' ||
        record.gateHVerdict === 'needs_review'
      );
    default:
      return false;
  }
}

function inferCurrentStage(record: RecapProjectRecordView): RecapStageId | null {
  if (record.currentStage) return record.currentStage;
  switch (record.state) {
    case 'importing':
      return 'import';
    case 'preflight':
    case 'story_engine':
    case 'paused_provider_unavailable':
      return 'vision';
    case 'audiovisual_preview':
    case 'master_export':
      return 'motion';
    case 'awaiting_preview_approval':
    case 'completed':
      return 'gate-h';
    default:
      return null;
  }
}

/**
 * Projects a real persisted/live orchestrator record into the 8-stage Pipeline Timeline.
 * Zero simulated/hardcoded percentages — progress is strictly derived from real completed stages.
 */
export function derivePipelineTimeline(
  record: RecapProjectRecordView | null,
  liveMessage?: string | null,
): DerivedPipelineTimeline {
  if (!record) {
    return {
      stages: RECAP_PIPELINE_STAGES.map((s) => ({ ...s, status: 'pending' as const })),
      completedCount: 0,
      totalCount: RECAP_PIPELINE_STAGES.length,
      overallProgressPct: 0,
      activeStageId: null,
      stateLabel: 'Aguardando início',
      tone: 'neutral',
      detailMessage: liveMessage ?? 'Importe um capítulo ou abra um projeto recente para acompanhar a timeline real.',
    };
  }

  const completedSet = new Set(record.completedSteps ?? []);
  const currentStage = inferCurrentStage(record);
  const { label: stateLabel, tone } = getStateMetadata(record.state);

  const isRunning =
    record.state === 'importing' ||
    record.state === 'preflight' ||
    record.state === 'story_engine' ||
    record.state === 'audiovisual_preview' ||
    record.state === 'master_export';

  const stages: DerivedPipelineStage[] = RECAP_PIPELINE_STAGES.map((stage) => {
    const done = isStepDone(stage.id, completedSet, record);

    if (record.state === 'failed' && currentStage === stage.id) {
      return { ...stage, status: 'failed' };
    }
    if (record.state === 'paused_provider_unavailable' && currentStage === stage.id) {
      return { ...stage, status: 'paused' };
    }
    if (done) {
      // Master export re-enters motion stage while previous preview was already done
      if (record.state === 'master_export' && stage.id === 'motion') {
        return { ...stage, status: 'active' };
      }
      return { ...stage, status: 'completed' };
    }
    if (isRunning && currentStage === stage.id) {
      return { ...stage, status: 'active' };
    }
    return { ...stage, status: 'pending' };
  });

  const completedCount = stages.filter((s) => s.status === 'completed').length;
  const totalCount = stages.length;
  const overallProgressPct = Math.round((completedCount / totalCount) * 100);

  const detailMessage =
    liveMessage ||
    record.lastError ||
    (record.state === 'completed'
      ? 'Produção finalizada com master renderizado e pacote de entrega exportado.'
      : record.state === 'awaiting_preview_approval'
        ? 'Prévia auditada pronta para revisão e aprovação da exportação master.'
        : `${completedCount} de ${totalCount} etapas reais concluídas.`);

  return {
    stages,
    completedCount,
    totalCount,
    overallProgressPct,
    activeStageId: currentStage,
    stateLabel,
    tone,
    detailMessage,
  };
}

/**
 * Projects a real RecapAudiovisualPlan into proportional NLE timeline tracks (V1, A1, A2 MotionVelix SFX, T1).
 */
export function deriveAudiovisualTracks(
  plan: RecapAudiovisualPlanView | null,
  motionVelix?: MotionVelixRenderTelemetry | null,
): DerivedAudiovisualTracks {
  if (!plan || !Array.isArray(plan.shots) || plan.shots.length === 0) {
    return {
      hasRealPlan: false,
      renderTarget: null,
      resolutionLabel: '—',
      fps: 0,
      aspectRatio: null,
      totalDurationMs: 0,
      measuredNarrationDurationMs: 0,
      audioClipped: false,
      shots: [],
      sfxMarkers: [],
      captionCueCount: 0,
      vfxActiveCount: 0,
    };
  }

  const totalDurationMs = Math.max(
    1,
    plan.totalDurationMs || plan.shots[plan.shots.length - 1]?.endMs || 1,
  );
  const measuredNarrationDurationMs = plan.durationAudit?.measuredNarrationDurationMs ?? totalDurationMs;
  const audioClipped = totalDurationMs < measuredNarrationDurationMs;

  const appliedKinds = new Set(motionVelix?.sfxKindsApplied ?? []);
  const sfxActuallyMixed = (motionVelix?.sfxApplied ?? 0) > 0;

  const shots: DerivedShotBlock[] = plan.shots.map((shot) => ({
    shotId: shot.shotId,
    sceneId: shot.sceneId,
    sceneIndex: shot.sceneIndex,
    panelId: shot.panelId,
    startMs: shot.startMs,
    endMs: shot.endMs,
    durationMs: shot.durationMs,
    startPct: Math.max(0, Math.min(100, (shot.startMs / totalDurationMs) * 100)),
    widthPct: Math.max(2, Math.min(100, (shot.durationMs / totalDurationMs) * 100)),
    motionStyle: shot.motionStyle,
    transitionIn: shot.transitionIn,
    balloonSafeZoneProtected: shot.balloonSafeZoneProtected,
    framingAtRisk: Boolean(shot.framingCropRisk?.atRisk),
    emotion: shot.emotion ?? 'neutral',
  }));

  const sfxMarkers: DerivedSfxMarker[] = (plan.sfxCues ?? []).map((cue) => ({
    cueId: cue.cueId,
    sceneId: cue.sceneId,
    timeMs: cue.timeMs,
    offsetPct: Math.max(0, Math.min(98, (cue.timeMs / totalDurationMs) * 100)),
    sfxKind: cue.sfxKind,
    gainDb: cue.gainDb,
    reason: cue.reason,
    applied: sfxActuallyMixed && (appliedKinds.size === 0 || appliedKinds.has(cue.sfxKind)),
  }));

  const vfxActiveCount = (plan.vfxSpecs ?? []).filter(
    (v) => v.contrastBoost > 1.01 || v.vignetteStrength > 0.05 || v.shakeIntensity > 0,
  ).length;

  return {
    hasRealPlan: true,
    renderTarget: plan.renderTarget,
    resolutionLabel: `${plan.width}×${plan.height}`,
    fps: plan.fps,
    aspectRatio: plan.aspectRatio,
    totalDurationMs,
    measuredNarrationDurationMs,
    audioClipped,
    shots,
    sfxMarkers,
    captionCueCount: Array.isArray(plan.captions?.cues) ? plan.captions.cues.length : 0,
    vfxActiveCount,
  };
}

function verdictToScore(verdict?: string | null): number | null {
  if (verdict === 'pass') return 100;
  if (verdict === 'needs_review') return 75;
  if (verdict === 'fail') return 35;
  return null;
}

/**
 * Computes an honest Quality Scorecard strictly from real Gate F, Gate G, and Gate H outputs.
 * Never fabricates hardcoded placeholder scores.
 */
export function deriveQualityScorecard(
  record: RecapProjectRecordView | null,
  gateGReport: RecapGateReportView | null,
  gateHReport: RecapGateReportView | null,
): DerivedQualityScorecard {
  const gateF = record?.gateFVerdict ?? null;
  const gateG = gateGReport?.verdict ?? record?.gateGVerdict ?? null;
  const gateH = gateHReport?.verdict ?? record?.gateHVerdict ?? null;

  if (!gateF && !gateG && !gateH) {
    return {
      evaluated: false,
      approvedForRelease: false,
      technicalScore: null,
      narrativeScore: null,
      audioScore: null,
      gateFVerdict: null,
      gateGVerdict: null,
      gateHVerdict: null,
      reasons: [],
      summary: 'Aguardando as verificações de qualidade do capítulo, do roteiro e do audiovisual.',
    };
  }

  const findings = gateHReport?.findings ?? [];
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;

  const technicalScore = gateH
    ? Math.max(0, Math.min(100, 100 - criticalCount * 30 - warningCount * 10))
    : verdictToScore(gateF);

  const narrativeScore = verdictToScore(gateG);

  const audioClipped = Boolean(gateHReport?.metrics?.['audioClipped']);
  const narrationFallback = Number(gateHReport?.metrics?.['narrationFallbackCount'] ?? 0);
  const sfxPlanned = Number(gateHReport?.metrics?.['sfxPlanned'] ?? record?.motionVelix?.sfxPlanned ?? 0);
  const sfxApplied = Number(gateHReport?.metrics?.['sfxApplied'] ?? record?.motionVelix?.sfxApplied ?? 0);

  let audioScore: number | null = null;
  if (gateH) {
    let score = 100;
    if (audioClipped) score -= 45;
    if (narrationFallback > 0) score -= 45;
    if (sfxPlanned > 0 && sfxApplied === 0) score -= 30;
    else if (sfxPlanned > 0 && sfxApplied < sfxPlanned) score -= 12;
    audioScore = Math.max(0, score);
  }

  const reasons = [
    ...(gateGReport?.reasons ?? []),
    ...(gateHReport?.reasons ?? []),
  ];

  const approvedForRelease =
    gateH === 'pass' &&
    gateF !== 'fail' &&
    gateG !== 'fail';

  const summary = approvedForRelease
    ? 'Aprovado nas verificações de qualidade.'
    : gateH === 'fail' || gateG === 'fail' || gateF === 'fail'
      ? 'Uma ou mais verificações precisam de atenção — revise os apontamentos abaixo.'
      : 'Requer revisão editorial/técnica antes da publicação final.';

  return {
    evaluated: true,
    approvedForRelease,
    technicalScore,
    narrativeScore,
    audioScore,
    gateFVerdict: gateF,
    gateGVerdict: gateG,
    gateHVerdict: gateH,
    reasons,
    summary,
  };
}

/**
 * Ensures the currently active/in-flight project is always present and up to date
 * in the "Projetos Recentes" list, deduplicated by `runId` and sorted newest-first.
 */
export type RecapWorkflowStepId =
  | 'projeto'
  | 'capitulos'
  | 'analise'
  | 'roteiro'
  | 'narracao'
  | 'storyboard'
  | 'producao'
  | 'revisao';

export type WorkflowStepStatus = 'pending' | 'processing' | 'ready' | 'needs_review' | 'error';

export interface RecapWorkflowStepState {
  id: RecapWorkflowStepId;
  index: number;
  label: string;
  shortLabel: string;
  status: WorkflowStepStatus;
  hint?: string;
}

export interface DeriveWorkflowStepsInput {
  hasSeriesOrProject: boolean;
  hasChapterSource: boolean;
  /** True when the CBZ/PDF archive exists on disk and passed binary integrity validation. Defaults to hasChapterSource when omitted. */
  chapterArchiveValidated?: boolean;
  /** True when a chapter import job or interactive session is currently running. */
  isImportingChapter?: boolean;
  /** True when the current import attempt failed and no valid CBZ is active. */
  hasActiveImportError?: boolean;
  isProducing: boolean;
  record: RecapProjectRecordView | null;
  sceneCount: number;
  hasLowConfidenceScenes: boolean;
  /** True only when valid narration artifacts (measured TTS durations or audiovisual plan/master) exist for the current production. */
  hasValidNarrationArtifacts?: boolean;
  gateGVerdict?: 'pass' | 'needs_review' | 'fail' | null;
  gateHVerdict?: 'pass' | 'needs_review' | 'fail' | null;
  hasAudiovisualPlan: boolean;
  hasRenderedVideo: boolean;
}

/**
 * Derives the honest real-time status of each of the 8 Recap workflow stages:
 * Projeto → Capítulos → Análise → Roteiro → Narração → Storyboard → Produção → Revisão
 *
 * Guarantees:
 * - Once a valid CBZ is imported and verified, "02 · Capítulos" is marked 'ready' ("Pronta"),
 *   even if a previous historical production record failed.
 * - "05 · Narração" is NEVER marked 'ready' merely because a chapter CBZ exists; it requires
 *   valid scenes and narration/audiovisual artifacts from the current production.
 */
export function deriveWorkflowSteps(input: DeriveWorkflowStepsInput): RecapWorkflowStepState[] {
  const completed = new Set(input.record?.completedSteps ?? []);
  const state = input.record?.state ?? 'idle';
  const curStage = input.record?.currentStage ?? null;

  const isArchiveValid =
    input.hasChapterSource && (input.chapterArchiveValidated === undefined ? true : input.chapterArchiveValidated);
  const isArchiveExplicitlyInvalid = input.hasChapterSource && input.chapterArchiveValidated === false;

  // If a valid chapter archive is ready and the attached record is an old failed run with 0 scenes,
  // treat the old failed record as historical so it does not contaminate the current session's stages.
  const isStaleFailedImportRecord =
    state === 'failed' && isArchiveValid && input.sceneCount === 0 && !input.isProducing;

  const stepProjeto: WorkflowStepStatus = input.hasSeriesOrProject ? 'ready' : 'pending';

  const stepCapitulos: WorkflowStepStatus =
    input.isImportingChapter || state === 'importing'
      ? 'processing'
      : isArchiveExplicitlyInvalid || (input.hasActiveImportError && !isArchiveValid)
        ? 'error'
        : isArchiveValid || completed.has('import')
          ? 'ready'
          : state === 'failed' && (curStage === 'import' || curStage === 'gate-f')
            ? 'error'
            : 'pending';

  const stepAnalise: WorkflowStepStatus =
    (state === 'preflight' || (state === 'story_engine' && (curStage === 'vision' || curStage === 'continuity'))) && input.isProducing
      ? 'processing'
      : !isStaleFailedImportRecord && state === 'failed' && (curStage === 'vision' || curStage === 'continuity')
        ? 'error'
        : state === 'paused_provider_unavailable'
          ? 'needs_review'
          : completed.has('vision') || completed.has('story_engine') || input.sceneCount > 0
            ? input.record?.gateFVerdict === 'needs_review'
              ? 'needs_review'
              : 'ready'
            : 'pending';

  const stepRoteiro: WorkflowStepStatus =
    state === 'story_engine' && (curStage === 'script' || curStage === 'humanize') && input.isProducing
      ? 'processing'
      : !isStaleFailedImportRecord && (input.gateGVerdict === 'fail' || (state === 'failed' && curStage === 'script'))
        ? 'error'
        : input.sceneCount > 0
          ? input.gateGVerdict === 'needs_review' || input.hasLowConfidenceScenes
            ? 'needs_review'
            : 'ready'
          : 'pending';

  const hasNarrationArtifacts =
    input.hasValidNarrationArtifacts !== undefined
      ? input.hasValidNarrationArtifacts
      : input.sceneCount > 0 &&
        (input.hasAudiovisualPlan ||
          completed.has('motion') ||
          completed.has('audiovisual_preview') ||
          completed.has('master_export') ||
          state === 'completed');

  const stepNarracao: WorkflowStepStatus =
    input.isProducing && (state === 'audiovisual_preview' || curStage === 'motion') && !hasNarrationArtifacts
      ? 'processing'
      : !isStaleFailedImportRecord && state === 'failed' && curStage === 'motion' && input.sceneCount > 0
        ? 'error'
        : input.sceneCount > 0 && hasNarrationArtifacts
          ? 'ready'
          : 'pending';

  const stepStoryboard: WorkflowStepStatus =
    input.hasAudiovisualPlan ? 'ready' : 'pending';

  const stepProducao: WorkflowStepStatus =
    input.isProducing && (state === 'audiovisual_preview' || state === 'master_export')
      ? 'processing'
      : !isStaleFailedImportRecord && state === 'failed' && (curStage === 'motion' || curStage === 'gate-h')
        ? 'error'
        : input.hasRenderedVideo
          ? input.gateHVerdict === 'needs_review'
            ? 'needs_review'
            : 'ready'
          : 'pending';

  const stepRevisao: WorkflowStepStatus =
    state === 'completed'
      ? 'ready'
      : state === 'awaiting_preview_approval'
        ? 'needs_review'
        : !isStaleFailedImportRecord && input.gateHVerdict === 'fail'
          ? 'error'
          : input.hasRenderedVideo
            ? 'needs_review'
            : 'pending';

  return [
    { id: 'projeto', index: 1, label: 'Projeto', shortLabel: 'Projeto', status: stepProjeto },
    { id: 'capitulos', index: 2, label: 'Capítulos', shortLabel: 'Capítulos', status: stepCapitulos },
    { id: 'analise', index: 3, label: 'Análise', shortLabel: 'Análise', status: stepAnalise },
    { id: 'roteiro', index: 4, label: 'Roteiro', shortLabel: 'Roteiro', status: stepRoteiro },
    { id: 'narracao', index: 5, label: 'Narração', shortLabel: 'Narração', status: stepNarracao },
    { id: 'storyboard', index: 6, label: 'Storyboard', shortLabel: 'Storyboard', status: stepStoryboard },
    { id: 'producao', index: 7, label: 'Produção', shortLabel: 'Produção', status: stepProducao },
    { id: 'revisao', index: 8, label: 'Revisão', shortLabel: 'Revisão', status: stepRevisao },
  ];
}

export interface QueueItemViewLike {
  url: string;
  status: string;
  pagesDone: number;
  pagesTotal: number;
  libraryEntry?: { cbzPath: string; pageCount?: number };
  error?: string;
  blockedByProtection?: boolean;
  universalState?: string;
  universalStateLabel?: string;
  acquisitionMethod?: string;
  acquisitionMethodLabel?: string;
  adapterName?: string;
  formatHint?: string;
  importNotPermitted?: boolean;
  contentNotRecognized?: boolean;
}

export interface QueueJobViewLike<TItem extends QueueItemViewLike = QueueItemViewLike> {
  id: string;
  status: string;
  blockedByProtection?: boolean;
  blockedUrl?: string;
  items: TItem[];
}

/**
 * Derives a consistent, non-contradictory display label and progress percentage for a queue item.
 * Prevents items with status 'skipped_existing' or a valid `libraryEntry.cbzPath` from showing "Na fila"
 * when the job is already COMPLETED.
 */
export function deriveQueueItemDisplayStatus(
  item: QueueItemViewLike,
  jobStatus?: string,
): {
  isDone: boolean;
  pct: number;
  statusLabel: string;
} {
  const hasCbz = Boolean(item.libraryEntry?.cbzPath);
  const isCompletedOrSkipped =
    item.status === 'completed' ||
    item.status === 'skipped_existing' ||
    item.status === 'skipped' ||
    (hasCbz && !item.error) ||
    (jobStatus === 'completed' && !item.error);

  if (isCompletedOrSkipped) {
    const total = item.pagesTotal || item.libraryEntry?.pageCount || item.pagesDone || 0;
    const done = item.pagesDone || total;
    const pageSuffix = total > 0 ? ` (${done}/${total} págs)` : '';
    return {
      isDone: true,
      pct: 100,
      statusLabel: `Importado${pageSuffix}`,
    };
  }

  if (item.status === 'downloading' || item.status === 'packing_cbz') {
    const pct = item.pagesTotal > 0 ? Math.min(99, Math.round((item.pagesDone / item.pagesTotal) * 100)) : 50;
    return {
      isDone: false,
      pct,
      statusLabel: `Importando ${item.pagesDone}/${item.pagesTotal || '?'}`,
    };
  }

  if (item.status === 'analyzing') {
    return {
      isDone: false,
      pct: 15,
      statusLabel: item.universalStateLabel || 'Analisando página',
    };
  }

  if (item.status === 'failed') {
    return {
      isDone: false,
      pct: 0,
      statusLabel: item.universalStateLabel || 'Falhou',
    };
  }

  if (item.status === 'cancelled') {
    return {
      isDone: false,
      pct: 0,
      statusLabel: 'Cancelado',
    };
  }

  return {
    isDone: false,
    pct: 0,
    statusLabel: 'Na fila',
  };
}

/**
 * Reconciles an existing import queue job when a retry, Interactive Persistent Browser session,
 * or Assisted Import succeeds for one or more chapters, clearing stale errors and updating
 * queue items to 'completed' ("Importado").
 */
export function reconcileQueueWithSuccessfulImport<TItem extends QueueItemViewLike>(
  job: QueueJobViewLike<TItem> | null,
  importedEntries: ReadonlyArray<{
    cbzPath: string;
    pageCount: number;
    sourceUrl?: string;
    workTitle?: string;
    chapterNumber?: string;
  }>,
): QueueJobViewLike<TItem> | null {
  if (!job || importedEntries.length === 0) return job;

  const nextItems = job.items.map((item, idx) => {
    const matchedEntry =
      importedEntries.find((e) => e.sourceUrl && e.sourceUrl.trim() === item.url.trim()) ??
      (importedEntries.length === job.items.length ? importedEntries[idx] : undefined) ??
      (job.items.length === 1 ? importedEntries[0] : undefined);

    if (!matchedEntry) return item;

    const updated: TItem = {
      ...item,
      status: 'completed',
      pagesDone: matchedEntry.pageCount,
      pagesTotal: matchedEntry.pageCount,
      libraryEntry: {
        cbzPath: matchedEntry.cbzPath,
      },
      blockedByProtection: false,
      universalState: 'chapter_identified',
      universalStateLabel: `Importado (${matchedEntry.pageCount}/${matchedEntry.pageCount} págs)`,
    };
    delete updated.error;
    return updated;
  });

  const allResolved = nextItems.every(
    (it) => it.status === 'completed' || it.status === 'skipped_existing' || it.status === 'skipped',
  );
  const anyBlocked = nextItems.some((it) => Boolean(it.blockedByProtection));

  return {
    ...job,
    status: allResolved ? 'completed' : job.status,
    blockedByProtection: anyBlocked,
    ...(anyBlocked && job.blockedUrl ? { blockedUrl: job.blockedUrl } : {}),
    items: nextItems,
  };
}

export interface SeparatedImportAndProductionStatus {
  importStatus: {
    state: 'pending' | 'importing' | 'validated' | 'error';
    label: string;
    detail: string;
    tone: 'neutral' | 'active' | 'success' | 'error';
  };
  productionStatus: {
    state: 'awaiting_chapter' | 'ready_to_start' | 'running' | 'paused' | 'awaiting_approval' | 'completed' | 'failed';
    label: string;
    detail: string;
    tone: 'neutral' | 'active' | 'warning' | 'success' | 'error';
  };
  isHistoricalFailedRecord: boolean;
}

/**
 * Explicitly separates the status of the Chapter Import from the status of the Audiovisual Production,
 * preventing previous failed production runs in history from marking a newly imported valid chapter as "Falhou".
 */
export function deriveSeparatedImportAndProductionStatus(input: {
  hasChapterSource: boolean;
  chapterArchiveValidated: boolean;
  archivePageCount?: number;
  archiveLabel?: string | null;
  archiveError?: string | null;
  isImportingChapter: boolean;
  importError: string | null;
  isProducing: boolean;
  activeProject: RecapProjectRecordView | null;
  sceneCount: number;
}): SeparatedImportAndProductionStatus {
  const isValidCbz = input.hasChapterSource && input.chapterArchiveValidated;

  let importStatus: SeparatedImportAndProductionStatus['importStatus'];
  if (input.isImportingChapter) {
    importStatus = {
      state: 'importing',
      label: 'Importando capítulo…',
      detail: 'Validando imagens e preparando pacote CBZ.',
      tone: 'active',
    };
  } else if (isValidCbz) {
    const pagesText =
      input.archivePageCount && input.archivePageCount > 0
        ? `${input.archivePageCount} páginas íntegras`
        : input.archiveLabel || 'CBZ verificado';
    importStatus = {
      state: 'validated',
      label: 'Importado e Validado',
      detail: `CBZ íntegro no disco (${pagesText}).`,
      tone: 'success',
    };
  } else if (input.archiveError || input.importError) {
    importStatus = {
      state: 'error',
      label: 'Erro na Importação',
      detail: input.archiveError || input.importError || 'Não foi possível validar o arquivo CBZ.',
      tone: 'error',
    };
  } else {
    importStatus = {
      state: 'pending',
      label: 'Aguardando Capítulo',
      detail: 'Importe um link, use o navegador persistente ou selecione um CBZ/PDF.',
      tone: 'neutral',
    };
  }

  const projState = input.activeProject?.state ?? 'idle';
  const isHistoricalFailedRecord =
    projState === 'failed' && isValidCbz && input.sceneCount === 0 && !input.isProducing;

  let productionStatus: SeparatedImportAndProductionStatus['productionStatus'];
  if (input.isProducing || ['importing', 'preflight', 'story_engine', 'audiovisual_preview', 'master_export'].includes(projState)) {
    productionStatus = {
      state: 'running',
      label: 'Em Produção',
      detail: 'Executando pipeline Story Engine + MotionVelix.',
      tone: 'active',
    };
  } else if (projState === 'completed') {
    productionStatus = {
      state: 'completed',
      label: 'Produção Concluída',
      detail: 'Vídeo Master renderizado e aprovado nas verificações de qualidade.',
      tone: 'success',
    };
  } else if (projState === 'awaiting_preview_approval') {
    productionStatus = {
      state: 'awaiting_approval',
      label: 'Aguardando Aprovação',
      detail: 'Prévia audiovisual pronta para revisão.',
      tone: 'warning',
    };
  } else if (projState === 'paused_provider_unavailable') {
    productionStatus = {
      state: 'paused',
      label: 'Produção Pausada',
      detail: input.activeProject?.lastError || 'Aguardando provedor multimodal.',
      tone: 'warning',
    };
  } else if (projState === 'failed' && !isHistoricalFailedRecord) {
    productionStatus = {
      state: 'failed',
      label: 'Produção Falhou',
      detail: input.activeProject?.lastError || 'Falha na tentativa de produção.',
      tone: 'error',
    };
  } else if (isValidCbz) {
    productionStatus = {
      state: 'ready_to_start',
      label: 'Pronto para Produzir',
      detail: 'Capítulo validado. Avance para iniciar a Análise e Roteiro.',
      tone: 'neutral',
    };
  } else {
    productionStatus = {
      state: 'awaiting_chapter',
      label: 'Aguardando Capítulo',
      detail: 'Conclua a importação do capítulo para liberar a produção.',
      tone: 'neutral',
    };
  }

  return {
    importStatus,
    productionStatus,
    isHistoricalFailedRecord,
  };
}

export function mergeActiveProjectIntoRecentList(
  persisted: readonly RecapProjectRecordView[],
  activeRecord: RecapProjectRecordView | null,
): RecapProjectRecordView[] {
  const map = new Map<string, RecapProjectRecordView>();
  for (const item of persisted) {
    map.set(item.runId, item);
  }
  if (activeRecord) {
    map.set(activeRecord.runId, activeRecord);
  }
  return [...map.values()].sort((a, b) => {
    const ta = Date.parse(a.updatedAtIso);
    const tb = Date.parse(b.updatedAtIso);
    if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) {
      return tb - ta;
    }
    return b.updatedAtIso.localeCompare(a.updatedAtIso);
  });
}
