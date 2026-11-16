import React, { useEffect, useRef, useState } from 'react';
import {
  AESTHETIC_DIRECTIONS,
  CONTENT_CATEGORIES,
  DEFAULT_CREATIVE_SELECTION,
  DELIVERY_PRESETS,
  NARRATIVE_FORMATS,
  detectCreativeSelection,
  detectDeliveryPreset,
  groupFormatsByCategory,
  searchAudiovisualFormats,
  type AetheraCreativeSelection,
  type DeliveryQualityProfile,
} from '@neuralbridge/cinema/browser';
import type {
  ContractComplianceReport,
  ContractConflict,
  ContractControlField,
  ProductionContract,
} from '@neuralbridge/cinema/browser';
import {
  Activity,
  Bot,
  Camera,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleX,
  Download,
  Film,
  Info,
  Laugh,
  LoaderCircle,
  PauseCircle,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Settings2,
  ShieldAlert,
  Sparkles,
  SquareTerminal,
  Trash2,
  TriangleAlert,
  Undo2,
  Volume2,
  Wrench,
  X,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { ProductionConsoleAccordion } from './ProductionConsoleAccordion';
import { healthOf, useAgents } from '@/app/useAgents';
import { notify } from '@/components/NotificationsOverlay';
import type { AppliedTrendIdeaPayload, TrendRadarBridgeApi } from './TrendRadarPanel';
import { IdeasColumn } from './cinema/IdeasColumn';
import { JobStatusIcon, STATUS_TONE } from './cinema/JobStatusIcon';
import { ProductionRail } from './cinema/ProductionRail';
import { ProductionStepper } from './cinema/ProductionStepper';
import {
  FAVORITE_DELIVERY_PRESET_IDS,
  FAVORITE_NARRATIVE_FORMAT_IDS,
  RENDER_PROFILE_OPTIONS,
  STAGE_DISPLAY_LABELS,
  favoriteOptionsWith,
  humorLabelOf,
  jobStatusOf,
  stageProgressOf,
} from './cinema/production-status-model';
import { MediaCoveragePanel } from './MediaCoveragePanel';
import { VoiceDirectorPanel } from './VoiceDirectorPanel';
import { DeletePromptDialog, promptDeleteLabel } from './DeletePromptDialog';
import {
  EditorialAuditPanel,
  type EditorialAuditTrailView,
  type EditorialDossierView,
} from './EditorialAuditPanel';
import { ProductionContractCompliancePanel } from './ProductionContractCompliancePanel';
import {
  resolveContractControlConflict,
  syncPromptToControls,
  type ProductionControlDraft,
  type PromptControlSyncState,
} from './production-contract-ui-model';

interface CinemaBridgeApi {
  cinemaCapabilities?: () => Promise<{
    ffmpeg: boolean;
    ffprobe: boolean;
    whisper: boolean;
    visionModel: boolean;
    remotion: boolean;
    gpuNvenc: boolean;
    degradedReasons: string[];
  }>;
  cinemaProduce?: (input: Record<string, unknown>) => Promise<CinemaPackageView>;
  cinemaExportOtio?: (projectId: string) => Promise<{
    projectId: string;
    otioJson: string;
    renderFingerprint: string;
  }>;
  cinemaRepair?: (projectId: string) => Promise<CinemaPackageView>;
  cinemaRunBenchmark?: () => Promise<BenchmarkView>;
  cinemaRenderRealMp4?: (input: {
    projectId: string;
    injectRealBlackFrameDefect?: boolean;
    useNvenc?: boolean;
    voiceStudioVoiceId?: string;
    deliveryPresetId?: string;
    exportPresetIds?: string[];
    renderTarget?: 'preview' | 'master';
    previewProfile?: DeliveryQualityProfile;
  }) => Promise<RealRenderView>;
  cinemaListVoices?: () => Promise<{
    available: boolean;
    compatible: boolean;
    voices: Array<{ id: string; label: string; source?: string }>;
    error?: string | null;
  }>;
  cinemaStartStagedProduction?: (input: Record<string, unknown>) => Promise<StagedJobView>;
  cinemaReviseStagedProduction?: (input: { projectId: string; instruction: string }) => Promise<StagedJobView>;
  cinemaCancelProduction?: (projectId: string) => Promise<StagedJobView | null>;
  cinemaResumeProduction?: (projectId: string) => Promise<StagedJobView>;
  cinemaResolvePendingMedia?: (input: Record<string, unknown>) => Promise<StagedJobView>;
  cinemaReviewGroundingEvidence?: (input: {
    projectId: string;
    candidateId: string;
    decision: 'approved' | 'rejected';
    note?: string;
  }) => Promise<StagedJobView | null>;
  cinemaListStagedJobs?: () => Promise<StagedJobView[]>;
  cinemaInspectDeleteProject?: (projectId: string) => Promise<{
    projectId: string;
    workspaceDir: string;
    itemsToRemove: string[];
    preservedGlobalLibrary: boolean;
    sharedCacheEntriesPreserved: number;
  }>;
  cinemaDeleteProject?: (projectId: string) => Promise<{ deleted: boolean; projectId: string }>;
  cinemaEvolutionSnapshot?: (input?: { refresh?: boolean }) => Promise<{
    directors?: Array<{ directorId: string; displayName: string }>;
  }>;
  onCinemaProductionProgress?: (listener: (job: StagedJobView) => void) => () => void;
}

interface PendingMediaSlotView {
  slotIndex: number;
  clipId: string;
  query: string;
  reason: string;
  uncoveredIntervals?: Array<{ startSec: number; endSec: number }>;
  missingDurationSec?: number;
  attempts?: number;
  editorialAlternatives?: Array<{ kind: string; detail: string; countsAsFootage: false }>;
  resolvedUri?: string;
  allowProcedural?: boolean;
}

interface StagedJobView {
  projectId: string;
  /** Unique id of this production execution (the console key). Older jobs fall back to their project id. */
  jobId?: string;
  attempt?: number;
  prompt: string;
  creativeSelection?: AetheraCreativeSelection;
  deliveryPresetId?: string;
  previewProfile?: DeliveryQualityProfile;
  renderExports?: Array<{ presetId: string; mp4Path: string; width: number; height: number; fps: number; durationSec: number; validationValid: boolean; validationErrors: string[] }>;
  state: string;
  progressPct: number;
  message: string;
  completedStages: string[];
  pendingMedia: PendingMediaSlotView[];
  isTechnicalSample?: boolean;
  researchDossier?: EditorialDossierView | null;
  editorialAudit?: EditorialAuditTrailView | null;
  contract?: ProductionContract;
  contractCompliance?: ContractComplianceReport;
  error?: string;
  startedAt?: string;
  updatedAt?: string;
}

/** Identity of a production execution: never the project alone, since a project can run several productions. */
function jobKeyOf(job: Pick<StagedJobView, 'jobId' | 'projectId'>): string {
  return job.jobId ?? job.projectId;
}

function newProductionJobId(): string {
  return `job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const TERMINAL_JOB_STATES = new Set(['editor', 'cancelled', 'error']);

function isJobRunning(job: Pick<StagedJobView, 'state'> | null | undefined): boolean {
  return Boolean(job && !TERMINAL_JOB_STATES.has(job.state) && !job.state.startsWith('paused_pending_'));
}

function formatDurationClock(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${s}s`;
}

function computeJobTiming(
  job: Pick<StagedJobView, 'projectId' | 'state' | 'progressPct' | 'startedAt' | 'updatedAt'> | null | undefined,
  nowMs: number,
  fallbackStartMs?: number,
): { elapsedLabel: string; etaLabel: string; isActive: boolean } {
  if (!job) return { elapsedLabel: '0s', etaLabel: 'Calculando...', isActive: false };
  const terminal = ['editor', 'cancelled', 'error', 'paused_pending_media', 'paused_pending_script'].includes(job.state);
  const isActive = !terminal;
  let startMs = job.startedAt ? Date.parse(job.startedAt) : Number.NaN;
  if (!Number.isFinite(startMs)) {
    const idTsMatch = job.projectId.match(/(\d{13})$/);
    if (idTsMatch?.[1]) {
      startMs = Number(idTsMatch[1]);
    }
  }
  if (!Number.isFinite(startMs) && fallbackStartMs) {
    startMs = fallbackStartMs;
  }
  const updatedMs = job.updatedAt ? Date.parse(job.updatedAt) : Number.NaN;
  const endMs = isActive ? nowMs : Number.isFinite(updatedMs) ? updatedMs : nowMs;
  const elapsedMs = Number.isFinite(startMs) ? Math.max(0, endMs - startMs) : 0;
  const elapsedLabel = formatDurationClock(elapsedMs);
  if (job.state === 'editor' || job.progressPct >= 100) {
    return { elapsedLabel, etaLabel: 'Concluído', isActive: false };
  }
  if (job.state === 'paused_pending_media' || job.state === 'paused_pending_script') {
    return {
      elapsedLabel,
      etaLabel: job.state === 'paused_pending_script' ? 'Aguardando roteiro' : 'Aguardando mídia',
      isActive: false,
    };
  }
  if (job.state === 'cancelled' || job.state === 'error') {
    return { elapsedLabel, etaLabel: job.state === 'cancelled' ? 'Cancelado' : 'Interrompido', isActive: false };
  }
  if (job.progressPct < 5 || elapsedMs < 2000) {
    return { elapsedLabel, etaLabel: 'Calculando...', isActive };
  }
  const etaMs = Math.max(0, Math.round((elapsedMs / job.progressPct) * (100 - job.progressPct)));
  return { elapsedLabel, etaLabel: `~${formatDurationClock(etaMs)}`, isActive };
}

const RESUMABLE_JOB_STATES = new Set([
  'cancelled',
  'error',
  'paused_pending_research',
  'paused_pending_script',
]);

function isResumableJobState(state?: string): boolean {
  return Boolean(state && RESUMABLE_JOB_STATES.has(state));
}

function isJobReadyForEditor(job: StagedJobView): boolean {
  const requiredStages = ['prompt', 'interpretacao', 'pesquisa', 'roteiro', 'decupagem', 'aquisicao', 'validacao_visual', 'planejamento', 'montagem', 'audio_sfx_vfx', 'previa'];
  return (
    job.state === 'editor' &&
    job.progressPct >= 100 &&
    !job.isTechnicalSample &&
    requiredStages.every((s) => job.completedStages?.includes(s))
  );
}

interface RealRenderView {
  mp4Path: string;
  narrationMode: string;
  encoderUsed: string;
  appliedEffects: string[];
  probe: {
    durationSec: number;
    width: number;
    height: number;
    videoCodec: string;
    audioCodec: string;
    integratedLufs: number | null;
    truePeakDbtp: number | null;
    blackFrames: Array<{ startSec: number; endSec: number; durationSec: number }>;
    freezeEvents: Array<{ startSec: number; endSec: number; durationSec: number }>;
  };
  realQcFindings: Array<{
    issueId: string;
    category: string;
    severity: 'info' | 'warning' | 'critical';
    evidence: string;
    fixSuggestion: string;
  }>;
  deliveryValidation?: {
    valid: boolean;
    target: 'preview' | 'master';
    expected: { width: number; height: number; fps: number; durationSec: number; audioCodec: string; videoCodec: string };
    actual: { width: number; height: number; fps: number; durationSec: number; audioCodec: string | null; videoCodec: string; audioSampleRate: number | null };
    errors: string[];
  };
}

interface CinemaPackageView {
  direction: {
    treatment: string;
    brief: {
      genre: string;
      format: string;
      creativeSelection?: AetheraCreativeSelection;
      deliveryProfile?: { preset: { id: string; label: string; aspectRatio: string; width: number; height: number; fps: number }; preview: { width: number; height: number; fps: number; quality: DeliveryQualityProfile } };
      targetDurationSec: number;
      humorProfile: { label: string; humorIntensity: number };
    };
    narrativeBeats: Array<{
      beatId: string;
      stage: string;
      summary: string;
      sensitiveContext: boolean;
    }>;
    shots: Array<{
      shotId: string;
      framing: string;
      cameraMotion: string;
      transitionIn: string;
      mediaGap: boolean;
      alternativePlanB: { framing: string; transitionIn: string };
    }>;
    mediaGaps: Array<{ shotId: string; reason: string }>;
  };
  timeline: {
    projectId: string;
    version: number;
    renderFingerprint: string;
    resolution?: { width: number; height: number };
    comedyBeats: Array<{
      beatId: string;
      humorMechanism: string;
      setupEvidence: string;
      punchline: string;
      pauseFrames: number;
      fallbackWithoutHumor: string;
      contextRisk: string;
    }>;
  };
  renderProfile: {
    profile: string;
    width: number;
    height: number;
    estimatedVramMb: number;
    fits8GbVram: boolean;
  };
  findings: Array<{
    issueId: string;
    category: string;
    severity: 'info' | 'warning' | 'critical';
    evidence: string;
    fixSuggestion: string;
    status: string;
  }>;
  scorecard: {
    independentFromProducer: boolean;
    technicalScore: number;
    visualScore: number;
    audioScore: number;
    narrativeScore: number;
    comedyScore: number;
    compositeScore: number;
  };
  releaseGates: {
    passed: boolean;
    blockingReasons: string[];
    criticalCount: number;
    warningCount: number;
    ensembleScore: number;
    requiresHumanReview: boolean;
  };
}

interface BenchmarkView {
  totalScenarios: number;
  devCount: number;
  holdoutCount: number;
  criticalDefectRecall: number;
  falsePositiveRate: number;
  sensitiveBlockAccuracy: number;
  meanDirectedScore: number;
  meanBaselineScore: number;
  abHumor35ActiveRate: number;
  abHumor0ActiveRate: number;
}

function bridge(): CinemaBridgeApi | undefined {
  return (window as unknown as { aetheraBridge?: CinemaBridgeApi }).aetheraBridge;
}

export function CinemaDirectorPanel() {
  const navigate = useNavigate();
  const { agents } = useAgents();
  const readyAgents = (agents ?? []).filter((a) => healthOf(a) === 'ready');
  const [readyExtraCount, setReadyExtraCount] = useState(0);
  const [workspaceTab, setWorkspaceTab] = useState<WorkspaceTab>('criar');
  const [reviewTab, setReviewTab] = useState<ReviewTab>('storyboard');
  const [consoleOpenNonce, setConsoleOpenNonce] = useState(0);
  const [ideaUndo, setIdeaUndo] = useState<{ prompt: string; title: string } | null>(null);
  const [confirmMotionAll, setConfirmMotionAll] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    let active = true;
    const api = (window as unknown as {
      aetheraBridge?: {
        cinemaEvolutionSnapshot?: () => Promise<{
          extraEngines?: Array<{ installed: boolean; authenticated?: boolean }>;
        }>;
      };
    }).aetheraBridge;
    if (!api?.cinemaEvolutionSnapshot) return;
    api
      .cinemaEvolutionSnapshot()
      .then((res) => {
        if (!active) return;
        const count = (res?.extraEngines ?? []).filter((e) => e.installed && e.authenticated !== false).length;
        setReadyExtraCount(count);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);
  const totalReadyProviders = readyAgents.length + readyExtraCount;

  const [prompt, setPrompt] = useState(
    'Crie um vídeo cinematográfico sobre os 10 chefes mais difíceis de Elden Ring, com narrativa épica, humor pontual e duração de 12 minutos.',
  );
  const [genre, setGenre] = useState<'documentary' | 'gameplay_essay' | 'top_list' | 'trailer'>('gameplay_essay');
  const [format, setFormat] = useState<'youtube_16_9' | 'shorts_9_16'>('youtube_16_9');
  const [creativeSelection, setCreativeSelection] = useState<AetheraCreativeSelection>(DEFAULT_CREATIVE_SELECTION);
  const [deliveryPresetId, setDeliveryPresetId] = useState('automatic');
  const [previewProfile, setPreviewProfile] = useState<DeliveryQualityProfile>('review_720p');
  const [additionalExportPresetIds, setAdditionalExportPresetIds] = useState<string[]>([]);
  const [manualCreativeFields, setManualCreativeFields] = useState<Array<'narrativeFormatId' | 'contentCategoryId' | 'aestheticDirectionId'>>([]);
  const [manualDeliveryPreset, setManualDeliveryPreset] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');
  const [targetDurationSec, setTargetDurationSec] = useState(720);
  const [durationSyncedFromPrompt, setDurationSyncedFromPrompt] = useState(true);
  const [humorIntensity, setHumorIntensity] = useState(35);
  const [renderProfile, setRenderProfile] = useState<DeliveryQualityProfile>('review_720p');
  const [videoLanguage, setVideoLanguage] = useState('pt-BR');
  const [voiceOptions, setVoiceOptions] = useState<Array<{ id: string; label: string; source?: string }>>([]);
  const [voiceStudioAvailable, setVoiceStudioAvailable] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState('9190edfa');
  const [manualControlFields, setManualControlFields] = useState<ContractControlField[]>([]);
  const [promptConflicts, setPromptConflicts] = useState<ContractConflict[]>([]);
  const [revisionNote, setRevisionNote] = useState('');
  const [planApproved, setPlanApproved] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StagedJobView | null>(null);
  const [deleteInspection, setDeleteInspection] = useState<{
    itemsToRemove: string[];
    sharedCacheEntriesPreserved: number;
  } | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);

  const deleteTargetIdRef = useRef<string | null>(null);

  function closeDeleteModal() {
    deleteTargetIdRef.current = null;
    setDeleteTarget(null);
  }

  const detectedCreativeSelection = detectCreativeSelection(prompt);
  const detectedDeliveryPresetId = detectDeliveryPreset(prompt);
  const creativeConflicts = [
    ...manualCreativeFields.flatMap((field) => {
      const manualValue = creativeSelection[field];
      const automaticValue = detectedCreativeSelection[field];
      return manualValue !== automaticValue ? [{ field, manualValue, automaticValue }] : [];
    }),
    ...(manualDeliveryPreset && deliveryPresetId !== detectedDeliveryPresetId
      ? [{ field: 'deliveryPresetId' as const, manualValue: deliveryPresetId, automaticValue: detectedDeliveryPresetId }]
      : []),
  ];
  const catalogResults = searchAudiovisualFormats(catalogSearch);
  const groupedCatalog = groupFormatsByCategory(catalogResults);

  function handleCreativeDimensionChange(
    field: 'narrativeFormatId' | 'contentCategoryId' | 'aestheticDirectionId',
    value: string,
  ) {
    const nextSelection = { ...creativeSelection, [field]: value } as AetheraCreativeSelection;
    setCreativeSelection(nextSelection);
    if (value === 'automatic') {
      setManualCreativeFields((previous) => previous.filter((item) => item !== field));
    } else {
      setManualCreativeFields((previous) => (previous.includes(field) ? previous : [...previous, field]));
    }
    if (field === 'narrativeFormatId' && value !== 'automatic') {
      const mappedGenre = value === 'trailer' ? 'trailer' : value === 'top-list' ? 'top_list' : value === 'gameplay-essay' ? 'gameplay_essay' : 'documentary';
      setGenre(mappedGenre);
    }
  }

  function handleDeliveryPresetChange(value: string) {
    setDeliveryPresetId(value);
    const manual = value !== 'automatic';
    setManualDeliveryPreset(manual);
    const preset = DELIVERY_PRESETS.find((candidate) => candidate.id === value);
    if (preset) setFormat(preset.aspectRatio === '9:16' ? 'shorts_9_16' : 'youtube_16_9');
  }

  async function openDeleteModal(job: StagedJobView) {
    deleteTargetIdRef.current = job.projectId;
    setDeleteTarget(job);
    setDeleteInspection({
      itemsToRemove: [
        'Mídias adquiridas exclusivas do projeto',
        'Narrações, renders MP4, thumbnails e arquivos temporários',
        'Roteiro, timeline, metadados e histórico de produção',
      ],
      sharedCacheEntriesPreserved: 0,
    });
    const api = bridge();
    if (api?.cinemaInspectDeleteProject) {
      try {
        const info = await api.cinemaInspectDeleteProject(job.projectId);
        if (info?.itemsToRemove && deleteTargetIdRef.current === job.projectId) {
          setDeleteInspection({
            itemsToRemove: info.itemsToRemove,
            sharedCacheEntriesPreserved: info.sharedCacheEntriesPreserved ?? 0,
          });
        }
      } catch {
        // keep fallback list
      }
    }
  }

  async function handleConfirmDeleteJob() {
    if (!deleteTarget || deletingProject) return;
    const api = bridge();
    if (!api?.cinemaDeleteProject) return;
    // Snapshot the selected target so only this prompt's project is ever removed.
    const targetId = deleteTarget.projectId;
    const label = promptDeleteLabel({ prompt: deleteTarget.prompt, fallback: targetId });
    setDeletingProject(true);
    try {
      await api.cinemaDeleteProject(targetId);
      setStagedJobs((prev) => prev.filter((j) => j.projectId !== targetId));
      setStagedJob((prev) => (prev?.projectId === targetId ? null : prev));
      notify({
        title: 'Prompt excluído',
        message: `"${label}" foi removido.`,
        type: 'success',
      });
      closeDeleteModal();
    } catch (err) {
      notify({
        title: 'Erro ao excluir projeto',
        message: err instanceof Error ? err.message : String(err),
        type: 'error',
      });
    } finally {
      setDeletingProject(false);
    }
  }

  function currentControlDraft(): ProductionControlDraft {
    return {
      genre,
      format,
      targetDurationSec,
      humorIntensity,
      renderProfile,
      language: videoLanguage,
      voiceId: selectedVoiceId,
    };
  }

  function applyPromptSync(sync: PromptControlSyncState) {
    setGenre(sync.controls.genre);
    setFormat(sync.controls.format);
    setTargetDurationSec(sync.controls.targetDurationSec);
    setHumorIntensity(sync.controls.humorIntensity);
    setRenderProfile(sync.controls.renderProfile);
    setVideoLanguage(sync.controls.language);
    if (sync.controls.voiceId !== undefined) setSelectedVoiceId(sync.controls.voiceId);
    setPromptConflicts(sync.conflicts);
    setDurationSyncedFromPrompt(
      !sync.manualFields.includes('targetDurationSec') && sync.inferredControls.targetDurationSec !== undefined,
    );
  }

  function handlePromptChange(next: string) {
    setPrompt(next);
    applyPromptSync(syncPromptToControls(next, currentControlDraft(), manualControlFields));
  }

  function handleManualControlChange(
    field: ContractControlField,
    value: ProductionControlDraft[ContractControlField],
  ) {
    const nextManualFields = manualControlFields.includes(field)
      ? manualControlFields
      : [...manualControlFields, field];
    const sync = syncPromptToControls(
      prompt,
      { ...currentControlDraft(), [field]: value } as ProductionControlDraft,
      nextManualFields,
    );
    setManualControlFields(nextManualFields);
    applyPromptSync(sync);
  }

  function handleConflictResolution(field: ContractControlField, resolution: 'use_prompt' | 'keep_manual') {
    const next = resolveContractControlConflict(
      syncPromptToControls(prompt, currentControlDraft(), manualControlFields),
      field,
      resolution,
    );
    setManualControlFields(next.manualFields);
    applyPromptSync(next);
  }

  const [capabilities, setCapabilities] = useState<Awaited<ReturnType<NonNullable<CinemaBridgeApi['cinemaCapabilities']>>> | null>(null);
  const [pkg, setPkg] = useState<CinemaPackageView | null>(null);
  const [benchmark, setBenchmark] = useState<BenchmarkView | null>(null);
  const [realRender, setRealRender] = useState<RealRenderView | null>(null);
  const [otioPreview, setOtioPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [benchmarking, setBenchmarking] = useState(false);
  const [renderingReal, setRenderingReal] = useState(false);
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const [progressStage, setProgressStage] = useState('');
  const [stagedJob, setStagedJob] = useState<StagedJobView | null>(null);
  /**
   * Production shown in the focus area (progress bar, cancel/resume). Events of other productions update only their
   * own card: percentages and states of simultaneous productions never overwrite each other.
   */
  const focusedJobKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (stagedJob) focusedJobKeyRef.current = jobKeyOf(stagedJob);
  }, [stagedJob]);
  const [stagedJobs, setStagedJobs] = useState<StagedJobView[]>([]);
  const [activeStartMs, setActiveStartMs] = useState<number | undefined>(undefined);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [directorCount, setDirectorCount] = useState<number>(7);
  const [error, setError] = useState<string | null>(null);

  const loadVoices = async () => {
    const api = bridge();
    if (!api?.cinemaListVoices) return;
    try {
      const res = await api.cinemaListVoices();
      setVoiceStudioAvailable(Boolean(res?.available));
      const list = Array.isArray(res?.voices) ? res.voices : [];
      setVoiceOptions(list);
      if (list.length > 0 && list[0] && !list.some((v) => v.id === selectedVoiceId)) {
        setSelectedVoiceId(list[0].id);
      }
    } catch {
      setVoiceStudioAvailable(false);
    }
  };

  useEffect(() => {
    const hasActive =
      busy ||
      (stagedJob && !['editor', 'cancelled', 'error', 'paused_pending_media'].includes(stagedJob.state)) ||
      stagedJobs.some((j) => !['editor', 'cancelled', 'error', 'paused_pending_media'].includes(j.state));
    if (!hasActive) return;
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy, stagedJob, stagedJobs]);

  useEffect(() => {
    const api = bridge();
    void api?.cinemaCapabilities?.().then(setCapabilities).catch(() => {});
    void loadVoices();
    void api?.cinemaListStagedJobs?.().then((jobs) => {
      if (Array.isArray(jobs)) setStagedJobs(jobs);
    }).catch(() => {});
    void api?.cinemaEvolutionSnapshot?.()
      .then((snap) => {
        if (snap?.directors?.length) setDirectorCount(snap.directors.length);
      })
      .catch(() => {});
    const off = api?.onCinemaProductionProgress?.((job) => {
      // Every production keeps its own card; the pipeline runs one job per project workspace.
      setStagedJobs((prev) => [job, ...prev.filter((j) => j.projectId !== job.projectId && jobKeyOf(j) !== jobKeyOf(job))]);
      const focused = focusedJobKeyRef.current;
      if (focused !== null && focused !== jobKeyOf(job)) return;
      focusedJobKeyRef.current = jobKeyOf(job);
      setStagedJob(job);
      setProgressPct(job.progressPct);
      setProgressStage(job.message);
    });
    return () => {
      off?.();
    };
  }, []);

  async function runProduction(effectivePrompt: string, options?: { autoOpenEditor?: boolean }) {
    const api = bridge();
    if (!api?.cinemaProduce && !api?.cinemaStartStagedProduction) {
      setError('Cinema IPC bridge indisponível neste contexto.');
      return;
    }
    setBusy(true);
    setActiveStartMs(Date.now());
    setNowMs(Date.now());
    setError(null);
    setOtioPreview(null);
    const newProjectId = `cinema_${Date.now()}`;

    if (api.cinemaStartStagedProduction) {
      // The renderer names the execution up front, so its console exists before the first pipeline event.
      const newJobId = newProductionJobId();
      focusedJobKeyRef.current = newJobId;
      setStagedJob(null);
      setProgressPct(5);
      setProgressStage('Iniciando fluxo em etapas (Prompt → Pesquisa → Aquisição → Montagem → Prévia)...');
      try {
        const pending = api.cinemaStartStagedProduction({
          projectId: newProjectId,
          jobId: newJobId,
          prompt: effectivePrompt,
          genre,
          format,
          creativeSelection,
          deliveryPresetId,
          deliveryPresetIds: additionalExportPresetIds,
          previewProfile,
          targetDurationSec,
          humorIntensity,
          renderProfile,
          useNvenc: capabilities?.gpuNvenc ?? true,
          voiceStudioVoiceId: selectedVoiceId,
          language: videoLanguage,
          manuallyChangedFields: [
            ...manualControlFields,
            ...(manualCreativeFields.length > 0 ? ['creativeSelection' as const] : []),
            ...(manualDeliveryPreset ? ['deliveryPresetId' as const] : []),
          ],
        });
        // Several productions can run at once: the form is free again as soon as this one is dispatched.
        setBusy(false);
        const finalJob = await pending;
        const stillFocused = focusedJobKeyRef.current === jobKeyOf(finalJob);
        setStagedJobs((prev) => [finalJob, ...prev.filter((j) => jobKeyOf(j) !== jobKeyOf(finalJob))]);
        if (stillFocused) {
          setStagedJob(finalJob);
          setProgressPct(finalJob.progressPct);
          setProgressStage(finalJob.message);
        }

        if (finalJob.state === 'error') {
          setError(finalJob.error ?? finalJob.message);
          notify({ title: 'Erro na produção IA', message: finalJob.error ?? finalJob.message, type: 'error' });
          return;
        }
        if (finalJob.state === 'paused_pending_media') {
          notify({ title: 'Produção pausada', message: 'Aguardando seleção/autorização de mídia para continuar.', type: 'warning' });
        }
        if (finalJob.state === 'editor') {
          notify({ title: 'Vídeo finalizado', message: 'Todas as etapas foram concluídas. Pronto para revisão no Editor!', type: 'success', native: true });
          if (options?.autoOpenEditor !== false && stillFocused) {
            navigate(`/video?projectId=${encodeURIComponent(finalJob.projectId)}`);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
      return;
    }

    setProgressPct(15);
    setProgressStage('Planejando direção, roteiro e storyboard...');
    let progressTimer: ReturnType<typeof setInterval> | null = null;
    try {
      if (!api.cinemaProduce) return;
      let result = await api.cinemaProduce({
        projectId: newProjectId,
        prompt: effectivePrompt,
        genre,
        format,
        creativeSelection,
        deliveryPresetId,
        deliveryPresetIds: additionalExportPresetIds,
        previewProfile,
        targetDurationSec,
        humorIntensity,
        renderProfile,
      });
      if (result.findings.length > 0 && api.cinemaRepair) {
        setProgressPct(40);
        setProgressStage('Aplicando reparo automático de qualidade...');
        result = await api.cinemaRepair(result.timeline.projectId);
      }
      setPkg(result);

      if (options?.autoOpenEditor !== false) {
        if (api.cinemaRenderRealMp4) {
          setRenderingReal(true);
          setProgressPct(55);
          setProgressStage('Sintetizando narração (VoiceStudio) e renderizando MP4 (FFmpeg)...');
          progressTimer = setInterval(() => {
            setProgressPct((prev) => (prev !== null && prev < 92 ? prev + 3 : prev));
          }, 700);
          try {
            const rendered = await api.cinemaRenderRealMp4({
              projectId: result.timeline.projectId,
              useNvenc: capabilities?.gpuNvenc ?? true,
              ...(result.direction.brief.deliveryProfile?.preset.id ? { deliveryPresetId: result.direction.brief.deliveryProfile.preset.id } : {}),
              ...(additionalExportPresetIds.length > 0 ? { exportPresetIds: [result.direction.brief.deliveryProfile?.preset.id, ...additionalExportPresetIds].filter((id): id is string => Boolean(id)) } : {}),
              renderTarget: 'master',
              previewProfile,
            });
            setRealRender(rendered);
          } finally {
            if (progressTimer) clearInterval(progressTimer);
            setRenderingReal(false);
          }
        }
        setProgressPct(100);
        setProgressStage('Concluído! Abrindo Editor...');
        navigate(`/video?projectId=${encodeURIComponent(result.timeline.projectId)}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (progressTimer) clearInterval(progressTimer);
      setBusy(false);
      setProgressPct(null);
      setProgressStage('');
    }
  }

  async function handleCancelStaged() {
    const api = bridge();
    if (!api?.cinemaCancelProduction || !stagedJob) return;
    const updated = await api.cinemaCancelProduction(stagedJob.projectId);
    if (updated) {
      setStagedJob(updated);
      setProgressStage(updated.message);
    }
    setBusy(false);
  }

  async function handleResumeStaged(targetProjectId?: string) {
    const api = bridge();
    const projectId = targetProjectId ?? stagedJob?.projectId;
    if (!api?.cinemaResumeProduction || !projectId) return;
    setBusy(true);
    setActiveStartMs(Date.now());
    setNowMs(Date.now());
    setError(null);
    try {
      const updated = await api.cinemaResumeProduction(projectId);
      setStagedJob(updated);
      setStagedJobs((prev) => {
        const next = prev.filter((item) => item.projectId !== updated.projectId);
        return [updated, ...next];
      });
      if (updated.state === 'editor') {
        navigate(`/video?projectId=${encodeURIComponent(updated.projectId)}`);
      } else if (updated.state === 'error') {
        setError(updated.error ?? updated.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleResolvePendingSlot(
    slotIndex: number,
    action: { pickFile?: boolean; allowProcedural?: boolean },
  ) {
    const api = bridge();
    if (!api?.cinemaResolvePendingMedia || !stagedJob) return;
    setBusy(true);
    setActiveStartMs(Date.now());
    setNowMs(Date.now());
    setError(null);
    try {
      const updated = await api.cinemaResolvePendingMedia({
        projectId: stagedJob.projectId,
        resolutions: [{ slotIndex, ...action }],
      });
      setStagedJob(updated);
      if (updated.state === 'editor') {
        navigate(`/video?projectId=${encodeURIComponent(updated.projectId)}`);
      } else if (updated.state === 'error') {
        setError(updated.error ?? updated.message);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('cancelled_pick')) setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleProduce(e: React.FormEvent) {
    e.preventDefault();
    await runProduction(prompt, { autoOpenEditor: true });
  }

  async function handleRevision(e: React.FormEvent) {
    e.preventDefault();
    if (!revisionNote.trim()) return;
    const instruction = revisionNote.trim();
    setRevisionNote('');
    const api = bridge();
    if (stagedJob?.projectId && api?.cinemaReviseStagedProduction) {
      setBusy(true);
      setError(null);
      try {
        const revised = await api.cinemaReviseStagedProduction({ projectId: stagedJob.projectId, instruction });
        setStagedJob(revised);
        setStagedJobs((prev) => [revised, ...prev.filter((job) => job.projectId !== revised.projectId)]);
        setPrompt(revised.prompt);
        if (revised.contract) {
          setGenre(revised.contract.controls.genre);
          setFormat(revised.contract.controls.format);
          setTargetDurationSec(revised.contract.controls.targetDurationSec);
          setHumorIntensity(revised.contract.controls.humorIntensity);
          setRenderProfile(revised.contract.controls.renderProfile);
          setVideoLanguage(revised.contract.controls.language);
          if (revised.contract.creativeSelection) setCreativeSelection(revised.contract.creativeSelection);
          if (revised.contract.deliveryPresetId) {
            setDeliveryPresetId(revised.contract.deliveryPresetId);
            setManualDeliveryPreset(true);
          }
          if (revised.contract.controls.previewProfile) setPreviewProfile(revised.contract.controls.previewProfile);
          if (revised.contract.controls.voiceId) setSelectedVoiceId(revised.contract.controls.voiceId);
          setPromptConflicts(revised.contract.conflicts);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(false);
      }
      return;
    }
    await runProduction(`${prompt} | Revisão: ${instruction}`);
  }

  async function handleRepair() {
    const api = bridge();
    if (!api?.cinemaRepair || !pkg) return;
    setBusy(true);
    setActiveStartMs(Date.now());
    setNowMs(Date.now());
    setError(null);
    try {
      setPkg(await api.cinemaRepair(pkg.timeline.projectId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleExportOtio() {
    const api = bridge();
    if (!api?.cinemaExportOtio || !pkg) return;
    setBusy(true);
    try {
      const res = await api.cinemaExportOtio(pkg.timeline.projectId);
      setOtioPreview(res.otioJson.slice(0, 1400));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleBenchmark() {
    const api = bridge();
    if (!api?.cinemaRunBenchmark) return;
    setBenchmarking(true);
    setBusy(true);
    setActiveStartMs(Date.now());
    setNowMs(Date.now());
    setError(null);
    try {
      setBenchmark(await api.cinemaRunBenchmark());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBenchmarking(false);
      setBusy(false);
    }
  }

  async function handleRenderRealMp4() {
    const api = bridge();
    if (!api?.cinemaRenderRealMp4 || !pkg) return;
    setRenderingReal(true);
    setError(null);
    try {
      const rendered = await api.cinemaRenderRealMp4({
        projectId: pkg.timeline.projectId,
        useNvenc: capabilities?.gpuNvenc ?? true,
        ...(pkg.direction.brief.deliveryProfile?.preset.id ? { deliveryPresetId: pkg.direction.brief.deliveryProfile.preset.id } : {}),
        ...(additionalExportPresetIds.length > 0 ? { exportPresetIds: [pkg.direction.brief.deliveryProfile?.preset.id, ...additionalExportPresetIds].filter((id): id is string => Boolean(id)) } : {}),
        renderTarget: 'master',
        previewProfile,
      });
      setRealRender(rendered);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenderingReal(false);
    }
  }

  const activeTiming = computeJobTiming(stagedJob, nowMs, activeStartMs);
  const activePct = stagedJob?.progressPct ?? progressPct ?? 0;
  const hasActiveProduction = progressPct !== null || Boolean(stagedJob);
  const selectedKey = stagedJob ? jobKeyOf(stagedJob) : focusedJobKeyRef.current;
  const railJobs = stagedJob && !stagedJobs.some((job) => jobKeyOf(job) === jobKeyOf(stagedJob)) ? [stagedJob, ...stagedJobs] : stagedJobs;
  const runningCount = railJobs.filter((job) => jobStatusOf(job).kind === 'running').length;
  const waitingCount = railJobs.filter((job) => jobStatusOf(job).kind === 'waiting').length;
  const activeStatus = stagedJob ? jobStatusOf(stagedJob) : { kind: 'running' as const, label: 'Iniciando' };
  const activeStage = stageProgressOf(stagedJob ?? { state: 'prompt', completedStages: [] });
  const summaryOf = (items: ReadonlyArray<{ id: string; label: string }>, id: string) =>
    id === 'automatic' ? 'Automático' : (items.find((item) => item.id === id)?.label ?? id);
  const detectedNarrative = summaryOf(NARRATIVE_FORMATS, creativeSelection.narrativeFormatId === 'automatic' ? detectedCreativeSelection.narrativeFormatId : creativeSelection.narrativeFormatId);
  const effectiveDeliveryId = deliveryPresetId === 'automatic' ? detectedDeliveryPresetId : deliveryPresetId;
  const effectiveDelivery = DELIVERY_PRESETS.find((item) => item.id === effectiveDeliveryId);
  const languageLabel = LANGUAGE_OPTIONS.find((item) => item.id === videoLanguage)?.label ?? videoLanguage;
  const voiceLabel = voiceOptions.find((item) => item.id === selectedVoiceId)?.label ?? (voiceStudioAvailable ? 'Voz padrão' : 'Voz padrão (VoiceStudio offline)');
  const renderOption = RENDER_PROFILE_OPTIONS.find((item) => item.id === renderProfile);
  const advancedSummary = [
    summaryOf(NARRATIVE_FORMATS, creativeSelection.narrativeFormatId),
    summaryOf(CONTENT_CATEGORIES, creativeSelection.contentCategoryId),
    summaryOf(AESTHETIC_DIRECTIONS, creativeSelection.aestheticDirectionId),
  ].join(' · ');
  const deliveryOptions = favoriteOptionsWith(FAVORITE_DELIVERY_PRESET_IDS, deliveryPresetId);
  const narrativeOptions = favoriteOptionsWith(FAVORITE_NARRATIVE_FORMAT_IDS, creativeSelection.narrativeFormatId);
  const auditErrors = stagedJob?.editorialAudit?.integrityReport;

  function selectJob(job: StagedJobView) {
    setStagedJob(job);
    setProgressPct(job.progressPct);
    setProgressStage(job.message);
    setWorkspaceTab((tab) => (tab === 'criar' ? 'ativa' : tab));
  }

  function startNewProduction() {
    setWorkspaceTab('criar');
    window.requestAnimationFrame(() => document.getElementById('cinema-prompt')?.focus());
  }

  function openProjectConsole() {
    setConsoleOpenNonce((value) => value + 1);
    window.requestAnimationFrame(() =>
      document.getElementById('cinema-project-console')?.scrollIntoView({ block: 'end', behavior: 'smooth' }),
    );
  }

  function applyIdea(payload: AppliedTrendIdeaPayload, ideaTitle: string) {
    setIdeaUndo({ prompt, title: ideaTitle });
    const nextManualFields: ContractControlField[] = [];
    const sync = syncPromptToControls(
      payload.promptText,
      {
        ...currentControlDraft(),
        genre: payload.genre,
        format: payload.format,
        targetDurationSec: Math.max(30, payload.durationMin * 60),
        humorIntensity: payload.humorIntensity,
      },
      nextManualFields,
    );
    setPrompt(payload.promptText);
    setManualControlFields(nextManualFields);
    applyPromptSync(sync);
    notify({ title: 'Ideia aplicada', message: `Briefing preenchido com "${ideaTitle}". Use Desfazer para voltar ao texto anterior.`, type: 'info' });
  }

  function undoIdea() {
    if (!ideaUndo) return;
    handlePromptChange(ideaUndo.prompt);
    setIdeaUndo(null);
  }

  return (
    <div className="flex flex-col gap-6 p-6 xl:p-8">
      {/* Thin header with global status */}
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-border pb-4">
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="text-xs font-medium tracking-[0.18em] text-primary uppercase">Aethera</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Produção com IA</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="h-7 gap-1.5 px-2.5">
            {runningCount > 0 ? <JobStatusIcon kind="running" className="size-3.5" /> : <Activity aria-hidden className="size-3.5 text-muted-foreground" />}
            {runningCount} rodando
          </Badge>
          {waitingCount > 0 && (
            <Badge variant="warning" className="h-7 gap-1.5 px-2.5">
              <PauseCircle aria-hidden className="size-3.5" /> {waitingCount} aguarda você
            </Badge>
          )}
          <Button asChild variant="ghost" size="sm">
            <Link to="/aethera/console">
              <SquareTerminal aria-hidden /> Console Geral
            </Link>
          </Button>
          <Popover>
            <PopoverTrigger asChild>
              <Button type="button" variant="outline" size="icon" aria-label="Diagnóstico do ambiente" title="Diagnóstico do ambiente">
                <Settings2 aria-hidden />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-80 flex-col gap-4">
              <PopoverHeader>
                <PopoverTitle>Diagnóstico do ambiente</PopoverTitle>
                <PopoverDescription>Provedores, ferramentas locais e benchmark do diretor.</PopoverDescription>
              </PopoverHeader>
              <dl className="flex flex-col gap-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <dt className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Bot aria-hidden className="size-3.5" /> Diretores
                  </dt>
                  <dd className="text-right">
                    {totalReadyProviders > 0
                      ? `${directorCount} diretores · ${totalReadyProviders} provedor(es) RF-07`
                      : `${directorCount} diretores · Modo determinístico local`}
                  </dd>
                </div>
                {capabilities && (
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-muted-foreground">FFmpeg</dt>
                    <dd className={capabilities.ffmpeg ? 'text-success' : 'text-warning'}>{capabilities.ffmpeg ? 'OK' : 'Fallback'}</dd>
                  </div>
                )}
              </dl>
              <Button type="button" variant="secondary" onClick={handleBenchmark} disabled={busy || benchmarking}>
                {benchmarking ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden /> : <Activity aria-hidden />}
                {benchmarking ? 'Rodando Benchmark...' : 'Rodar Benchmark'}
              </Button>
              {benchmark && (
                <dl aria-label={`Benchmark Corpus (${benchmark.devCount} dev / ${benchmark.holdoutCount} holdout)`} className="grid grid-cols-2 gap-x-4 gap-y-3">
                  <Metric label="Recall defeitos críticos" value={`${(benchmark.criticalDefectRecall * 100).toFixed(0)}%`} tone="success" />
                  <Metric label="Falso positivo" value={`${(benchmark.falsePositiveRate * 100).toFixed(1)}%`} />
                  <Metric label="Bloqueio sensível" value={`${(benchmark.sensitiveBlockAccuracy * 100).toFixed(0)}%`} tone="success" />
                  <Metric label="Direcionado vs baseline" value={`${benchmark.meanDirectedScore} vs ${benchmark.meanBaselineScore}`} />
                  <Metric
                    label="A/B humor (35% vs 0%)"
                    value={`${(benchmark.abHumor35ActiveRate * 100).toFixed(0)}% vs ${(benchmark.abHumor0ActiveRate * 100).toFixed(0)}%`}
                  />
                </dl>
              )}
            </PopoverContent>
          </Popover>
        </div>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[208px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)] xl:gap-8">
        <aside className="lg:sticky lg:top-6">
          <ProductionRail jobs={railJobs} selectedKey={selectedKey} onSelect={selectJob} onNew={startNewProduction} />
        </aside>

        <div className="flex min-w-0 flex-col gap-6">
          <Tabs
            value={workspaceTab}
            onValueChange={(value) => setWorkspaceTab(value as WorkspaceTab)}
            className="gap-6"
          >
            <TabsList variant="line" aria-label="Áreas da produção" className="w-full justify-start overflow-x-auto overflow-y-hidden border-b border-border">
              <TabsTrigger value="criar" className="flex-none px-3">
                Criar
              </TabsTrigger>
              <TabsTrigger value="ativa" className="flex-none px-3">
                Produção ativa
                {stagedJob?.state === 'paused_pending_media' && stagedJob.pendingMedia.length > 0 && (
                  <Badge variant="warning">{stagedJob.pendingMedia.length}</Badge>
                )}
              </TabsTrigger>
              <TabsTrigger value="revisao" className="flex-none px-3">
                Revisão
              </TabsTrigger>
              <TabsTrigger value="auditoria" className="flex-none px-3">
                Auditoria Editorial
                {auditErrors && <Badge variant={auditErrors.passed ? 'success' : 'destructive'}>{auditErrors.errorCount} erro(s)</Badge>}
              </TabsTrigger>
            </TabsList>

            {/* Criar: what am I going to produce? */}
            <TabsContent value="criar" className="grid items-start gap-10 xl:grid-cols-[minmax(0,1fr)_280px]">
              <form
                onSubmit={(event) => {
                  setWorkspaceTab('ativa');
                  void handleProduce(event);
                }}
                aria-labelledby="cinema-briefing-title"
                className="flex min-w-0 flex-col gap-6"
              >
                <SectionHeading
                  id="cinema-briefing-title"
                  title="Briefing"
                  description="Descreva o vídeo. Antes de gerar, confira o que a IA entendeu e ajuste só o que precisar."
                />

                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-foreground" htmlFor="cinema-prompt">
                    Direção Criativa / Briefing
                  </label>
                  <Textarea
                    id="cinema-prompt"
                    value={prompt}
                    onChange={(e) => handlePromptChange(e.target.value)}
                    rows={5}
                    className="min-h-32 resize-y text-[15px]"
                  />
                  {ideaUndo && (
                    <div role="status" className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                      <span>Briefing preenchido com “{ideaUndo.title}”.</span>
                      <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={undoIdea}>
                        <Undo2 aria-hidden /> Desfazer
                      </Button>
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1.5 text-success">
                      <CheckCircle2 aria-hidden className="size-3.5" /> Entendi:
                    </span>
                    <Badge variant="outline">{detectedNarrative}</Badge>
                    <Badge variant="outline">~{Math.round(targetDurationSec / 60)} min</Badge>
                    {effectiveDelivery && <Badge variant="outline">{effectiveDelivery.aspectRatio}</Badge>}
                    <Badge variant="outline">{videoLanguage}</Badge>
                    <Button type="button" variant="link" size="sm" className="h-auto px-1" onClick={() => setAdvancedOpen(true)}>
                      ajustar
                    </Button>
                  </div>
                  {durationSyncedFromPrompt && (
                    <p className="text-xs text-muted-foreground">
                      Duração sincronizada automaticamente com o briefing: {targetDurationSec}s ({Math.round(targetDurationSec / 60)} min)
                    </p>
                  )}
                </div>

                {promptConflicts.length > 0 && (
                  <Alert variant="warning">
                    <TriangleAlert aria-hidden />
                    <AlertTitle>O briefing entrou em conflito com controles alterados manualmente</AlertTitle>
                    <AlertDescription className="w-full">
                      {promptConflicts.map((conflict) => (
                        <div key={conflict.id} className="flex w-full flex-wrap items-center justify-between gap-2">
                          <span>{conflict.message}</span>
                          <span className="flex shrink-0 gap-1.5">
                            <Button type="button" size="sm" variant="outline" onClick={() => handleConflictResolution(conflict.field, 'use_prompt')}>
                              Usar briefing
                            </Button>
                            <Button type="button" size="sm" variant="ghost" onClick={() => handleConflictResolution(conflict.field, 'keep_manual')}>
                              Manter controle
                            </Button>
                          </span>
                        </div>
                      ))}
                    </AlertDescription>
                  </Alert>
                )}

                {creativeConflicts.length > 0 && (
                  <Alert variant="warning">
                    <Info aria-hidden />
                    <AlertTitle>O prompt sugere uma combinação diferente dos controles manuais</AlertTitle>
                    <AlertDescription>
                      {creativeConflicts.map((conflict) => (
                        <p key={conflict.field}>
                          {conflict.field}: automático = <span className="font-mono">{conflict.automaticValue}</span>; manual ={' '}
                          <span className="font-mono">{conflict.manualValue}</span>. O manual permanece prioritário.
                        </p>
                      ))}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Decisions that change the result the most: visible as buttons */}
                <div className="grid grid-cols-1 items-center gap-x-6 gap-y-4 sm:grid-cols-[96px_minmax(0,1fr)]">
                  <span id="cinema-format-label" className="text-sm font-medium text-muted-foreground">
                    Formato
                  </span>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    spacing={1}
                    aria-labelledby="cinema-format-label"
                    value={deliveryPresetId}
                    onValueChange={(value) => value && handleDeliveryPresetChange(value)}
                    className="flex-wrap"
                  >
                    <ToggleGroupItem value="automatic">Automático</ToggleGroupItem>
                    {deliveryOptions.map((id) => {
                      const preset = DELIVERY_PRESETS.find((item) => item.id === id);
                      return preset ? (
                        <ToggleGroupItem key={id} value={id} title={preset.description}>
                          {preset.label} <span className="text-xs text-muted-foreground">{preset.aspectRatio}</span>
                        </ToggleGroupItem>
                      ) : null;
                    })}
                  </ToggleGroup>

                  <span id="cinema-style-label" className="text-sm font-medium text-muted-foreground">
                    Estilo
                  </span>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    spacing={1}
                    aria-labelledby="cinema-style-label"
                    value={creativeSelection.narrativeFormatId}
                    onValueChange={(value) => value && handleCreativeDimensionChange('narrativeFormatId', value)}
                    className="flex-wrap"
                  >
                    <ToggleGroupItem value="automatic">Automático</ToggleGroupItem>
                    {narrativeOptions.map((id) => {
                      const item = NARRATIVE_FORMATS.find((candidate) => candidate.id === id);
                      return item ? (
                        <ToggleGroupItem key={id} value={id} title={item.description}>
                          {item.label}
                        </ToggleGroupItem>
                      ) : null;
                    })}
                  </ToggleGroup>

                  <label htmlFor="cinema-duration" className="text-sm font-medium text-muted-foreground">
                    Duração (min)
                  </label>
                  <div className="flex items-center gap-3">
                    <Input
                      id="cinema-duration"
                      type="number"
                      min={0.5}
                      max={60}
                      step={0.5}
                      value={Number((targetDurationSec / 60).toFixed(2))}
                      onChange={(e) => handleManualControlChange('targetDurationSec', Math.max(15, Math.round((Number(e.target.value) || 1) * 60)))}
                      className="w-24 font-mono"
                    />
                    <span className="text-xs text-muted-foreground">
                      {durationSyncedFromPrompt ? 'sincronizada com o briefing' : 'definida manualmente'}
                    </span>
                  </div>

                  <label htmlFor="cinema-humor" className="text-sm font-medium text-muted-foreground">
                    Humor
                  </label>
                  <div className="flex items-center gap-4">
                    <input
                      id="cinema-humor"
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={humorIntensity}
                      aria-valuetext={`${humorIntensity}% · ${humorLabelOf(humorIntensity)}`}
                      onChange={(e) => handleManualControlChange('humorIntensity', Number(e.target.value))}
                      className="w-full max-w-80 accent-primary"
                    />
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <Laugh aria-hidden className="size-3.5 text-primary" />
                      <span className="font-mono tabular-nums">{humorIntensity}%</span>
                      <span className="text-muted-foreground">{humorLabelOf(humorIntensity)}</span>
                    </span>
                  </div>
                </div>

                {/* Progressive disclosure: one-line summaries that open on demand */}
                <div className="flex flex-col divide-y divide-border/70 border-y border-border/70">
                  <Disclosure label="Narração e idioma" summary={`${languageLabel} · ${voiceLabel}`}>
                    <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
                      <Field label="Idioma do vídeo" htmlFor="cinema-language">
                        <Select id="cinema-language" value={videoLanguage} onChange={(e) => handleManualControlChange('language', e.target.value)}>
                          {LANGUAGE_OPTIONS.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Voz (VoiceStudio)" htmlFor="cinema-voice">
                        <div className="flex gap-1.5">
                          <Select
                            id="cinema-voice"
                            value={selectedVoiceId}
                            onChange={(e) => handleManualControlChange('voiceId', e.target.value)}
                            className="min-w-0 flex-1"
                          >
                            {voiceOptions.length > 0 ? (
                              voiceOptions.map((v) => (
                                <option key={v.id} value={v.id} title={v.id}>
                                  {v.label}
                                </option>
                              ))
                            ) : (
                              <option value="9190edfa">{voiceStudioAvailable ? 'Voz padrão' : 'Voz padrão (VoiceStudio offline)'}</option>
                            )}
                          </Select>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            onClick={() => void loadVoices()}
                            title="Atualizar lista de vozes do VoiceStudio"
                            aria-label="Atualizar lista de vozes do VoiceStudio"
                          >
                            <RefreshCw aria-hidden />
                          </Button>
                        </div>
                      </Field>
                    </div>
                  </Disclosure>

                  <Disclosure label="Qualidade" summary={renderOption?.label ?? renderProfile}>
                    <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
                      <Field label="Perfil de render" htmlFor="cinema-render-profile">
                        <Select
                          id="cinema-render-profile"
                          value={renderProfile}
                          onChange={(e) => handleManualControlChange('renderProfile', e.target.value as typeof renderProfile)}
                        >
                          {RENDER_PROFILE_OPTIONS.map((item) => (
                            <option key={item.id} value={item.id}>
                              {item.label}
                            </option>
                          ))}
                        </Select>
                      </Field>
                      <Field label="Resolução de preview" htmlFor="cinema-preview-profile">
                        <Select
                          id="cinema-preview-profile"
                          value={previewProfile}
                          onChange={(e) => {
                            const value = e.target.value as DeliveryQualityProfile;
                            setPreviewProfile(value);
                            handleManualControlChange('previewProfile', value);
                          }}
                        >
                          <option value="draft_540p">Preview 540p</option>
                          <option value="review_720p">Preview 720p</option>
                          <option value="master_1080p">Preview Full HD</option>
                          <option value="master_4k">Preview 4K</option>
                        </Select>
                      </Field>
                      <div className="sm:col-span-2">
                        <Field
                          label="Exportações adicionais (opcional)"
                          htmlFor="cinema-additional-exports"
                          hint="A timeline e os materiais são compartilhados; cenas só são re-renderizadas quando dimensões/FPS/codec exigem."
                        >
                          <Select
                            id="cinema-additional-exports"
                            multiple
                            value={additionalExportPresetIds}
                            onChange={(e) => setAdditionalExportPresetIds(Array.from(e.target.selectedOptions, (option) => option.value))}
                            className="h-auto min-h-24 py-1.5"
                          >
                            {DELIVERY_PRESETS.filter((item) => item.id !== deliveryPresetId).map((item) => (
                              <option key={item.id} value={item.id}>
                                {item.label} · {item.aspectRatio} · reaproveita materiais
                              </option>
                            ))}
                          </Select>
                        </Field>
                      </div>
                    </div>
                  </Disclosure>

                  <Disclosure label="Configurações avançadas" summary={advancedSummary} open={advancedOpen} onOpenChange={setAdvancedOpen}>
                    <div className="grid gap-x-4 gap-y-5 md:grid-cols-2">
                      <Field
                        label="Formato narrativo"
                        htmlFor="cinema-narrative-format"
                        hint={NARRATIVE_FORMATS.find((item) => item.id === creativeSelection.narrativeFormatId)?.description ?? 'O briefing escolhe a estrutura narrativa.'}
                      >
                        <Select
                          id="cinema-narrative-format"
                          value={creativeSelection.narrativeFormatId}
                          onChange={(e) => handleCreativeDimensionChange('narrativeFormatId', e.target.value)}
                        >
                          <option value="automatic">Automático (Detectar pelo Prompt)</option>
                          {NARRATIVE_FORMATS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </Select>
                      </Field>
                      <Field
                        label="Categoria do conteúdo"
                        htmlFor="cinema-content-category"
                        hint={CONTENT_CATEGORIES.find((item) => item.id === creativeSelection.contentCategoryId)?.description ?? 'A categoria define pesquisa e critérios de evidência.'}
                      >
                        <Select
                          id="cinema-content-category"
                          value={creativeSelection.contentCategoryId}
                          onChange={(e) => handleCreativeDimensionChange('contentCategoryId', e.target.value)}
                        >
                          <option value="automatic">Automático (Detectar pelo Prompt)</option>
                          {CONTENT_CATEGORIES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </Select>
                      </Field>
                      <Field
                        label="Direção estética"
                        htmlFor="cinema-aesthetic-direction"
                        hint={AESTHETIC_DIRECTIONS.find((item) => item.id === creativeSelection.aestheticDirectionId)?.description ?? 'A direção estética controla motion, VFX e mix.'}
                      >
                        <Select
                          id="cinema-aesthetic-direction"
                          value={creativeSelection.aestheticDirectionId}
                          onChange={(e) => handleCreativeDimensionChange('aestheticDirectionId', e.target.value)}
                        >
                          <option value="automatic">Automático (Detectar pelo Prompt)</option>
                          {AESTHETIC_DIRECTIONS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                        </Select>
                      </Field>
                      <Field
                        label="Entrega audiovisual"
                        htmlFor="cinema-delivery-preset"
                        hint={
                          DELIVERY_PRESETS.find((item) => item.id === deliveryPresetId)?.description ??
                          `Detectado: ${DELIVERY_PRESETS.find((item) => item.id === detectedDeliveryPresetId)?.label ?? detectedDeliveryPresetId}`
                        }
                      >
                        <Select id="cinema-delivery-preset" value={deliveryPresetId} onChange={(e) => handleDeliveryPresetChange(e.target.value)}>
                          <option value="automatic">Automático (Detectar pelo Prompt)</option>
                          {DELIVERY_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.aspectRatio}</option>)}
                        </Select>
                      </Field>
                      <div className="flex flex-col gap-3 md:col-span-2">
                        <Field label="Buscar formatos do catálogo" htmlFor="cinema-format-search">
                          <Input
                            id="cinema-format-search"
                            type="search"
                            value={catalogSearch}
                            onChange={(e) => setCatalogSearch(e.target.value)}
                            placeholder="Ex.: boss fight, apresentação executiva, podcast..."
                          />
                        </Field>
                        {catalogSearch.trim() && (
                          <div className="grid gap-x-6 gap-y-4 md:grid-cols-2 lg:grid-cols-3" aria-live="polite">
                            {CONTENT_CATEGORIES.map((category) => {
                              const matches = groupedCatalog[category.id] ?? [];
                              if (matches.length === 0) return null;
                              return (
                                <div key={category.id} className="flex flex-col gap-1">
                                  <div className="text-xs font-medium text-primary">{category.label}</div>
                                  {matches.slice(0, 4).map((item) => (
                                    <div key={item.id} title={item.description} className="text-xs text-muted-foreground">
                                      {item.label}
                                    </div>
                                  ))}
                                </div>
                              );
                            })}
                            {catalogResults.length === 0 && <span className="text-xs text-muted-foreground">Nenhum formato encontrado.</span>}
                          </div>
                        )}
                      </div>
                    </div>
                  </Disclosure>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-xs text-muted-foreground">
                    Estimativa de render: {renderOption ? `${renderOption.label} · ${renderOption.vram}` : renderProfile}
                  </p>
                  <Button type="submit" size="lg" disabled={busy || renderingReal}>
                    {busy || renderingReal ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
                    {busy || renderingReal ? 'Produzindo e renderizando...' : 'Gerar Direção & Storyboard'}
                  </Button>
                </div>
              </form>

              <aside className="xl:sticky xl:top-6">
                <IdeasColumn api={(bridge() ?? {}) as TrendRadarBridgeApi} onApplyIdea={applyIdea} />
              </aside>
            </TabsContent>

            {/* Produção ativa: is it moving? does it need me? */}
            <TabsContent value="ativa">
              {!hasActiveProduction ? (
                <div className="flex flex-col items-start gap-3 py-10">
                  <p className="text-base font-medium text-foreground">Nenhuma produção selecionada</p>
                  <p className="max-w-prose text-sm text-muted-foreground">
                    Escolha uma produção na lista ao lado ou descreva um novo vídeo para acompanhar etapas, tempo e pendências aqui.
                  </p>
                  <Button type="button" variant="secondary" onClick={startNewProduction}>
                    <Plus aria-hidden /> Nova produção
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-8">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="flex min-w-0 flex-col gap-1">
                      <h2 className="line-clamp-2 text-lg font-semibold tracking-tight text-foreground">
                        {stagedJob?.prompt || 'Nova produção'}
                      </h2>
                      {stagedJob && (
                        <p className="font-mono text-xs text-muted-foreground">
                          {jobKeyOf(stagedJob)}
                          {stagedJob.attempt && stagedJob.attempt > 1 ? ` · tentativa ${stagedJob.attempt}` : ''}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {stagedJob && isJobRunning(stagedJob) && (
                        <Button type="button" variant="outline" onClick={handleCancelStaged}>
                          <X aria-hidden /> Cancelar
                        </Button>
                      )}
                      {stagedJob && !busy && isResumableJobState(stagedJob.state) && (
                        <Button type="button" onClick={() => void handleResumeStaged()}>
                          <RotateCcw aria-hidden /> Retomar Projeto
                        </Button>
                      )}
                      {stagedJob && isJobReadyForEditor(stagedJob) && (
                        <Button type="button" onClick={() => navigate(`/video?projectId=${encodeURIComponent(stagedJob.projectId)}`)}>
                          <Film aria-hidden /> Abrir no Editor
                        </Button>
                      )}
                      {stagedJob && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => void openDeleteModal(stagedJob)}
                          title="Excluir projeto"
                          aria-label={`Excluir prompt ${promptDeleteLabel({ prompt: stagedJob.prompt, fallback: stagedJob.projectId })}`}
                          className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 aria-hidden />
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col gap-3" aria-live="polite">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                      <span className={cn('inline-flex items-center gap-2 font-medium', STATUS_TONE[activeStatus.kind])}>
                        <JobStatusIcon kind={activeStatus.kind} /> {activeStatus.label}
                      </span>
                      <span className="text-foreground">
                        Etapa {activeStage.current} de {activeStage.total}: {activeStage.label}
                      </span>
                      {stagedJob && (
                        <Badge variant={activeStatus.kind === 'failed' ? 'destructive' : activeStatus.kind === 'waiting' ? 'warning' : 'muted'}>
                          {STAGE_DISPLAY_LABELS[stagedJob.state] ?? stagedJob.state}
                        </Badge>
                      )}
                      <span className="ml-auto font-mono text-2xl font-light text-foreground tabular-nums">{activePct}%</span>
                    </div>
                    <Progress value={activePct} aria-label="Progresso da produção ativa" />
                    <p className="text-xs text-muted-foreground">
                      Decorrido <span className="font-mono text-foreground tabular-nums">{activeTiming.elapsedLabel}</span> · Restante aprox.{' '}
                      <span className="font-mono text-foreground tabular-nums">{activeTiming.etaLabel}</span>
                    </p>
                  </div>

                  <ProductionStepper job={stagedJob} />

                  <section aria-labelledby="cinema-now-title" className="flex flex-col gap-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 id="cinema-now-title" className="text-sm font-semibold text-foreground">
                        Agora
                      </h3>
                      <Button type="button" variant="link" size="sm" className="h-auto px-0" onClick={openProjectConsole}>
                        <SquareTerminal aria-hidden /> Abrir no console desta produção
                      </Button>
                    </div>
                    <p className="text-sm text-foreground/90">{stagedJob?.message || progressStage || 'Aguardando o primeiro evento do pipeline.'}</p>
                  </section>

                  {stagedJob?.state === 'error' && (
                    <Alert variant="destructive">
                      <CircleX aria-hidden />
                      <AlertTitle>
                        Falhou em {activeStage.label}
                        {stagedJob.attempt && stagedJob.attempt > 1 ? ` · tentativa ${stagedJob.attempt}` : ''}
                      </AlertTitle>
                      <AlertDescription className="gap-3">
                        <p>{stagedJob.error ?? stagedJob.message}</p>
                        <Button type="button" size="sm" variant="outline" onClick={openProjectConsole}>
                          Ver erro no console
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}

                  {stagedJob?.state === 'paused_pending_media' && stagedJob.pendingMedia.length > 0 && (
                    <Alert variant="warning">
                      <TriangleAlert aria-hidden />
                      <AlertTitle>Precisa de você · Pendências de Mídia Real ({stagedJob.pendingMedia.length} cena(s))</AlertTitle>
                      <AlertDescription className="w-full gap-3">
                        <p>A montagem final aguarda mídias válidas. Nenhuma cena foi substituída silenciosamente por placeholder.</p>
                        <ul className="flex w-full flex-col">
                          {stagedJob.pendingMedia.map((slot, index) => (
                            <li key={slot.clipId} className="flex flex-col gap-1.5">
                              {index > 0 && <Separator className="my-2" />}
                              <span className="font-medium text-foreground">
                                Cena #{slot.slotIndex + 1} · {slot.query}
                              </span>
                              {slot.uncoveredIntervals && slot.uncoveredIntervals.length > 0 && (
                                <span className="text-xs text-warning">
                                  Intervalos sem prova: {slot.uncoveredIntervals.map((interval) => `${interval.startSec}–${interval.endSec}s`).join(', ')}
                                  {slot.missingDurationSec !== undefined ? ` · faltam ${slot.missingDurationSec}s` : ''}
                                  {slot.attempts !== undefined ? ` · ${slot.attempts} tentativa(s)` : ''}
                                </span>
                              )}
                              {slot.editorialAlternatives && slot.editorialAlternatives.length > 0 && (
                                <ul className="flex flex-col gap-1 text-xs text-info">
                                  {slot.editorialAlternatives.map((alternative) => (
                                    <li key={alternative.kind}>Alternativa editorial ({alternative.kind}): {alternative.detail}</li>
                                  ))}
                                </ul>
                              )}
                              <span className="text-xs text-muted-foreground">{slot.reason}</span>
                              <span className="flex flex-wrap gap-2">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() => handleResolvePendingSlot(slot.slotIndex, { pickFile: true })}
                                >
                                  Importar Mídia Local
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  disabled={busy}
                                  onClick={() => handleResolvePendingSlot(slot.slotIndex, { allowProcedural: true })}
                                >
                                  Autorizar Motion Visual
                                </Button>
                              </span>
                            </li>
                          ))}
                        </ul>
                        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirmMotionAll(true)}>
                          Autorizar Motion Visual para todas e Continuar
                        </Button>
                      </AlertDescription>
                    </Alert>
                  )}

                  {error && (
                    <Alert variant="destructive">
                      <CircleAlert aria-hidden />
                      <AlertTitle>Falha na produção</AlertTitle>
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  <ProductionContractCompliancePanel
                    contract={stagedJob?.contract ?? null}
                    compliance={stagedJob?.contractCompliance ?? null}
                    conflicts={stagedJob?.contract?.conflicts ?? promptConflicts}
                  />
                </div>
              )}
            </TabsContent>

            {/* Revisão: is it good? */}
            <TabsContent value="revisao">
              <Tabs value={reviewTab} onValueChange={(value) => setReviewTab(value as ReviewTab)} orientation="vertical" className="gap-8 md:flex-row">
                <TabsList variant="line" aria-label="Itens de revisão" className="h-auto! w-full shrink-0 flex-col items-stretch md:w-56">
                  <TabsTrigger value="storyboard" className={REVIEW_TRIGGER_CLASS}>
                    Roteiro & Storyboard
                    {pkg && <span className="font-mono text-xs text-muted-foreground">{pkg.direction.shots.length}</span>}
                  </TabsTrigger>
                  <TabsTrigger value="qualidade" className={REVIEW_TRIGGER_CLASS}>
                    Qualidade & Render
                    {pkg && <span className="font-mono text-xs text-muted-foreground">{pkg.scorecard.compositeScore}</span>}
                  </TabsTrigger>
                  <TabsTrigger value="midia" className={REVIEW_TRIGGER_CLASS}>
                    Mídia & Grounding
                  </TabsTrigger>
                  <TabsTrigger value="voz" className={REVIEW_TRIGGER_CLASS}>
                    Voz & Pronúncia
                  </TabsTrigger>
                </TabsList>

                <TabsContent value="storyboard" className="min-w-0">
                  {pkg ? (
                    <section aria-labelledby="cinema-storyboard-title" className="flex flex-col gap-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <SectionHeading
                          id="cinema-storyboard-title"
                          title={`Planejamento Narrativo & Storyboard (${pkg.direction.shots.length} cenas)`}
                          description={pkg.direction.treatment}
                        />
                        <Button type="button" variant="outline" size="sm" onClick={handleExportOtio}>
                          <Download aria-hidden /> Exportar OTIO
                        </Button>
                      </div>
                      <ul className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                        {pkg.direction.shots.map((s, idx) => {
                          const sceneDur = Math.max(4, Math.round(pkg.direction.brief.targetDurationSec / Math.max(1, pkg.direction.shots.length)));
                          return (
                            <li key={s.shotId} className="overflow-hidden rounded-lg bg-muted/50 text-xs">
                              <div className="flex h-20 items-end justify-between bg-gradient-to-br from-primary/25 via-muted to-background p-2.5">
                                <Badge variant="secondary" className="font-mono">
                                  Cena {idx + 1} · {sceneDur}s
                                </Badge>
                                <Badge variant="outline" className="bg-background/60">
                                  {s.framing}
                                </Badge>
                              </div>
                              <div className="flex flex-col gap-1 p-3">
                                <div className="flex items-center justify-between font-medium text-foreground">
                                  <span className="font-mono">{s.shotId}</span>
                                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                    <Volume2 className="size-3" aria-hidden /> Narração + SFX
                                  </span>
                                </div>
                                <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                  <Camera className="size-3 text-primary" aria-hidden /> {s.cameraMotion} · Transição: {s.transitionIn}
                                </p>
                                <p className="text-xs text-muted-foreground">
                                  Plano B: {s.alternativePlanB.framing} ({s.alternativePlanB.transitionIn})
                                </p>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                      <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
                        <span className="text-muted-foreground">
                          {planApproved ? 'Plano aprovado para edição e renderização.' : 'Revise as cenas acima antes de avançar para o Editor NLE.'}
                        </span>
                        <div className="flex gap-2">
                          <Button type="button" size="sm" variant={planApproved ? 'secondary' : 'default'} onClick={() => setPlanApproved(true)}>
                            {planApproved && <CheckCircle2 className="text-success" aria-hidden />}
                            {planApproved ? 'Plano Aprovado' : 'Aprovar Plano'}
                          </Button>
                          <Button asChild size="sm" variant="outline">
                            <Link to="/video">Abrir no Editor NLE</Link>
                          </Button>
                        </div>
                      </div>
                    </section>
                  ) : (
                    <ReviewEmpty>O storyboard aparece aqui quando a direção da produção estiver pronta.</ReviewEmpty>
                  )}
                  {(pkg || stagedJob) && (
                    <form onSubmit={handleRevision} className="mt-6 flex gap-2">
                      <label htmlFor="cinema-revision" className="sr-only">
                        Pedir alteração por linguagem natural
                      </label>
                      <Input
                        id="cinema-revision"
                        value={revisionNote}
                        onChange={(e) => setRevisionNote(e.target.value)}
                        placeholder="Pedir alteração por linguagem natural (ex.: acelerar abertura e reduzir humor)..."
                        className="flex-1"
                      />
                      <Button type="submit" disabled={busy}>
                        <Send aria-hidden /> Revisar
                      </Button>
                    </form>
                  )}
                </TabsContent>

                <TabsContent value="qualidade" className="min-w-0">
                  {pkg ? (
                    <section aria-labelledby="cinema-quality-title" className="flex max-w-3xl flex-col gap-5">
                      <div className="flex items-center justify-between gap-3">
                        <h2 id="cinema-quality-title" className="inline-flex items-center gap-2 text-base font-semibold text-foreground">
                          {pkg.releaseGates.passed ? (
                            <CheckCircle2 className="size-4 text-success" aria-hidden />
                          ) : (
                            <ShieldAlert className="size-4 text-warning" aria-hidden />
                          )}
                          Qualidade & Beats de Humor
                        </h2>
                        <Badge variant={pkg.releaseGates.passed ? 'success' : 'warning'} className="font-mono">
                          {pkg.scorecard.compositeScore}/100
                        </Badge>
                      </div>
                      {!pkg.releaseGates.passed && (
                        <Button type="button" variant="secondary" onClick={handleRepair} disabled={busy} className="w-fit">
                          <Wrench aria-hidden /> Executar Reparo Cirúrgico (Budget 3)
                        </Button>
                      )}
                      {pkg.timeline.comedyBeats.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nenhum beat de humor ativo (intensidade 0% ou contexto sensível).</p>
                      ) : (
                        <ul className="flex flex-col">
                          {pkg.timeline.comedyBeats.map((cb, index) => (
                            <li key={cb.beatId} className="flex flex-col gap-1 text-sm">
                              {index > 0 && <Separator className="my-3" />}
                              <div className="flex items-center justify-between font-medium text-foreground">
                                <span>
                                  {cb.humorMechanism} · pausa {cb.pauseFrames}f
                                </span>
                                <span className="text-xs text-muted-foreground">{cb.contextRisk}</span>
                              </div>
                              <p className="text-foreground/90">{cb.punchline}</p>
                              <p className="text-xs text-muted-foreground">Fallback sem humor: {cb.fallbackWithoutHumor}</p>
                            </li>
                          ))}
                        </ul>
                      )}
                      <Separator />
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span className="inline-flex items-center gap-1.5">
                          <Film className="size-3.5" aria-hidden /> {pkg.renderProfile.profile}
                        </span>
                        <span className="font-mono">
                          {pkg.renderProfile.width}x{pkg.renderProfile.height}
                        </span>
                      </div>
                      <Button type="button" onClick={handleRenderRealMp4} disabled={busy || renderingReal} className="w-fit">
                        <Film aria-hidden /> {renderingReal ? 'Renderizando MP4 Real...' : 'Renderizar MP4 Real (FFmpeg)'}
                      </Button>
                      {realRender && (
                        <div className="flex flex-col gap-3 text-xs">
                          <div className="flex items-center justify-between gap-2 font-medium text-success">
                            <span className="inline-flex items-center gap-1.5">
                              <CheckCircle2 className="size-3.5" aria-hidden /> MP4 Real Verificado (FFprobe/ebur128)
                            </span>
                            <span className="font-mono text-muted-foreground">{realRender.encoderUsed}</span>
                          </div>
                          <p className="font-mono break-all text-muted-foreground">{realRender.mp4Path}</p>
                          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                            <RenderFact label="Duração" value={`${realRender.probe.durationSec.toFixed(2)}s`} />
                            <RenderFact label="Resolução" value={`${realRender.probe.width}x${realRender.probe.height}`} />
                            <RenderFact label="LUFS" value={String(realRender.probe.integratedLufs ?? 'N/A')} />
                            <RenderFact label="True Peak" value={`${realRender.probe.truePeakDbtp ?? 'N/A'} dBTP`} />
                            <RenderFact label="Black frames" value={String(realRender.probe.blackFrames.length)} />
                            <RenderFact label="Narração" value={realRender.narrationMode} />
                          </dl>
                          <p className="text-muted-foreground">Efeitos: {realRender.appliedEffects.join(' · ')}</p>
                          {realRender.realQcFindings.length > 0 && (
                            <ul className="flex flex-col gap-1">
                              {realRender.realQcFindings.map((f) => (
                                <li key={f.issueId} className="text-warning">
                                  [{f.severity}] {f.evidence}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                      {otioPreview && <pre className="max-h-40 overflow-auto rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">{otioPreview}</pre>}
                    </section>
                  ) : (
                    <ReviewEmpty>Release Gates, beats de humor e o render MP4 aparecem aqui depois que a direção for gerada.</ReviewEmpty>
                  )}
                </TabsContent>

                <TabsContent value="midia" className="min-w-0">
                  <MediaCoveragePanel
                    coverage={(stagedJob as unknown as { coverageReport?: Parameters<typeof MediaCoveragePanel>[0]['coverage'] })?.coverageReport ?? null}
                    relevanceDecisions={(stagedJob as unknown as { mediaRelevanceDecisions?: Parameters<typeof MediaCoveragePanel>[0]['relevanceDecisions'] })?.mediaRelevanceDecisions ?? []}
                    acquisitionAudit={(stagedJob as unknown as { autonomousAudit?: Parameters<typeof MediaCoveragePanel>[0]['acquisitionAudit'] })?.autonomousAudit ?? null}
                    plannedQueriesCount={(stagedJob as unknown as { sceneDecupagem?: unknown[] })?.sceneDecupagem?.length ?? 0}
                    sceneAssembly={(stagedJob as unknown as { sceneAssembly?: Parameters<typeof MediaCoveragePanel>[0]['sceneAssembly'] })?.sceneAssembly ?? null}
                    onPromptAction={(actionPrompt) => {
                      setPrompt((prev) => (prev ? `${prev}\n\n[Diretriz de Cobertura] ${actionPrompt}` : actionPrompt));
                      notify({ title: 'Cobertura', message: 'Diretriz de cobertura adicionada ao prompt.', type: 'info' });
                    }}
                  />
                </TabsContent>

                <TabsContent value="voz" className="min-w-0">
                  <VoiceDirectorPanel
                    voiceId={selectedVoiceId}
                    audioQuality={(realRender as unknown as { audioQuality?: Parameters<typeof VoiceDirectorPanel>[0]['audioQuality'] })?.audioQuality ?? null}
                    segments={pkg?.direction?.narrativeBeats?.map((b) => ({ segmentId: b.beatId, text: b.summary })) ?? []}
                    onRegenerateSegment={(segmentId) => {
                      setPrompt((prev) => `${prev}\n[Corrigir narração do trecho ${segmentId}]`);
                      notify({ title: 'Voice Director', message: `Regeneração direcionada agendada para o trecho ${segmentId}.`, type: 'info' });
                    }}
                    onTestSample={async (sampleText) => {
                      notify({ title: 'Voice Studio', message: `Amostra enviada para Voice Studio (${sampleText.slice(0, 40)}...).`, type: 'info' });
                    }}
                  />
                </TabsContent>
              </Tabs>
            </TabsContent>

            {/* Auditoria: can I publish? */}
            <TabsContent value="auditoria">
              <EditorialAuditPanel
                projectId={stagedJob?.projectId}
                jobState={stagedJob?.state}
                dossier={stagedJob?.researchDossier ?? null}
                trail={stagedJob?.editorialAudit ?? null}
                onHumanReview={async (candidateId, decision, note) => {
                  const api = bridge();
                  if (!stagedJob?.projectId || !api?.cinemaReviewGroundingEvidence) return;
                  const updated = await api.cinemaReviewGroundingEvidence({
                    projectId: stagedJob.projectId,
                    candidateId,
                    decision,
                    ...(note ? { note } : {}),
                  });
                  if (updated) {
                    setStagedJob(updated);
                    notify({
                      title: 'Auditoria Editorial',
                      message: `Revisão humana (${decision}) registrada para ${candidateId}.`,
                      type: 'info',
                    });
                  }
                }}
              />
            </TabsContent>
          </Tabs>

          {/* Project console dock: only events of the selected production */}
          {selectedKey && (
            <section
              id="cinema-project-console"
              aria-label="Console desta produção"
              className="sticky bottom-0 z-10 -mx-2 max-h-[45vh] overflow-y-auto bg-background/95 px-2 pb-2 backdrop-blur supports-[backdrop-filter]:bg-background/80"
            >
              <ProductionConsoleAccordion
                key={`${selectedKey}:${consoleOpenNonce}`}
                jobId={selectedKey}
                title="Console desta produção"
                defaultOpen={consoleOpenNonce > 0}
              />
            </section>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={confirmMotionAll}
        onOpenChange={setConfirmMotionAll}
        title="Usar motion visual em todas as cenas pendentes?"
        confirmLabel="Autorizar e continuar"
        onConfirm={() => {
          setConfirmMotionAll(false);
          void (async () => {
            const api = bridge();
            if (!api?.cinemaResolvePendingMedia || !stagedJob) return;
            setBusy(true);
            try {
              const updated = await api.cinemaResolvePendingMedia({
                projectId: stagedJob.projectId,
                resolutions: stagedJob.pendingMedia.map((s) => ({
                  slotIndex: s.slotIndex,
                  allowProcedural: true,
                })),
              });
              setStagedJob(updated);
              if (updated.state === 'editor') {
                navigate(`/video?projectId=${encodeURIComponent(updated.projectId)}`);
              }
            } finally {
              setBusy(false);
            }
          })();
        }}
      >
        As {stagedJob?.pendingMedia.length ?? 0} cena(s) sem mídia comprovada recebem motion visual procedural. Isso não conta como prova
        visual: a pendência continua registrada como motion autorizado, não como mídia validada.
      </ConfirmDialog>

      {deleteTarget && (
        <DeletePromptDialog
          label={promptDeleteLabel({ prompt: deleteTarget.prompt, fallback: deleteTarget.projectId })}
          pending={deletingProject}
          details={deleteInspection?.itemsToRemove}
          footnote={
            deleteInspection
              ? `Biblioteca global (SFX/VFX/músicas/templates) e ${deleteInspection.sharedCacheEntriesPreserved} referência(s) compartilhada(s) com outros projetos serão preservadas.`
              : undefined
          }
          onCancel={closeDeleteModal}
          onConfirm={() => void handleConfirmDeleteJob()}
        />
      )}
    </div>
  );
}

const LANGUAGE_OPTIONS: ReadonlyArray<{ id: string; label: string }> = [
  { id: 'pt-BR', label: 'Português (BR)' },
  { id: 'en-US', label: 'English (US)' },
  { id: 'es-ES', label: 'Español' },
  { id: 'fr-FR', label: 'Français' },
  { id: 'de-DE', label: 'Deutsch' },
  { id: 'it-IT', label: 'Italiano' },
  { id: 'ja-JP', label: '日本語 (JP)' },
];

type WorkspaceTab = 'criar' | 'ativa' | 'revisao' | 'auditoria';
type ReviewTab = 'storyboard' | 'qualidade' | 'midia' | 'voz';

// The review sub-navigation sits inside the horizontal intent tabs, so it opts out of the inherited line indicator and
// fixed height and marks the active item with a quiet background instead.
const REVIEW_TRIGGER_CLASS =
  'h-auto! min-h-9 flex-none justify-between px-3 py-2 after:hidden data-[state=active]:bg-muted/70 group-data-[variant=line]/tabs-list:data-[state=active]:bg-muted/70';

function SectionHeading({ id, title, description }: { id: string; title: string; description?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <h2 id={id} className="text-base font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      {description && <p className="max-w-3xl text-sm text-muted-foreground">{description}</p>}
    </div>
  );
}

/** One-line summary that opens its details on demand (progressive disclosure). */
function Disclosure({
  label,
  summary,
  children,
  open,
  onOpenChange,
}: {
  label: string;
  summary: string;
  children: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [innerOpen, setInnerOpen] = useState(false);
  const isOpen = open ?? innerOpen;
  const setOpen = onOpenChange ?? setInnerOpen;
  return (
    <Collapsible open={isOpen} onOpenChange={setOpen} className="flex flex-col">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 w-full items-center gap-3 py-2 text-left text-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDown aria-hidden className={cn('size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none', isOpen && 'rotate-180')} />
          <span className="w-44 shrink-0 font-medium text-foreground">{label}</span>
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{summary}</span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2 pb-5 pl-7">{children}</CollapsibleContent>
    </Collapsible>
  );
}

function ReviewEmpty({ children }: { children: React.ReactNode }) {
  return <p className="max-w-prose py-6 text-sm text-muted-foreground">{children}</p>;
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('text-base tabular-nums', tone === 'success' ? 'text-success' : 'text-foreground')}>{value}</dd>
    </div>
  );
}

function RenderFact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-muted-foreground">{label}:</dt>
      <dd className="font-mono text-foreground">{value}</dd>
    </div>
  );
}
