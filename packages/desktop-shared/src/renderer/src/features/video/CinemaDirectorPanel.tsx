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
  Circle,
  CircleAlert,
  Download,
  Film,
  Info,
  Laugh,
  LoaderCircle,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  TriangleAlert,
  Volume2,
  Wrench,
  X,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { ProductionConsoleAccordion } from './ProductionConsoleAccordion';
import { healthOf, useAgents } from '@/app/useAgents';
import { notify } from '@/components/NotificationsOverlay';
import { TrendRadarPanel, type TrendRadarBridgeApi } from './TrendRadarPanel';
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

const STAGE_DISPLAY_LABELS: Record<string, string> = {
  prompt: 'Prompt',
  interpretacao: 'Interpretação',
  pesquisa: 'Pesquisa Editorial',
  paused_pending_research: 'Pausado (Pesquisa Pendente)',
  roteiro: 'Roteiro',
  paused_pending_script: 'Pausado (Roteiro Pendente)',
  decupagem: 'Decupagem Semântica',
  aquisicao: 'Aquisição de Mídia',
  validacao_visual: 'Validação Visual',
  paused_pending_media: 'Pausado (Mídia Pendente)',
  planejamento: 'Planejamento',
  montagem: 'Montagem',
  audio_sfx_vfx: 'Áudio / SFX / VFX',
  qc: 'QC Editorial',
  previa: 'Prévia',
  editor: 'Concluído — Pronto para Editor',
  cancelled: 'Cancelado',
  error: 'Erro',
};

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

const PIPELINE_STAGES: Array<{ id: string; label: string }> = [
  { id: 'prompt', label: 'PROMPT' },
  { id: 'interpretacao', label: 'INTERPRETAÇÃO' },
  { id: 'pesquisa', label: 'PESQUISA' },
  { id: 'roteiro', label: 'ROTEIRO' },
  { id: 'decupagem', label: 'DECUPAGEM' },
  { id: 'aquisicao', label: 'AQUISIÇÃO' },
  { id: 'validacao_visual', label: 'VALIDAÇÃO' },
  { id: 'planejamento', label: 'PLANEJAMENTO' },
  { id: 'montagem', label: 'MONTAGEM' },
  { id: 'previa', label: 'PRÉVIA' },
  { id: 'editor', label: 'EDITOR' },
];

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
  const [workspaceTab, setWorkspaceTab] = useState<'producao' | 'auditoria'>('producao');
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
  const summaryOf = (items: ReadonlyArray<{ id: string; label: string }>, id: string) =>
    id === 'automatic' ? 'Automático' : (items.find((item) => item.id === id)?.label ?? id);
  const advancedSummary = [
    summaryOf(NARRATIVE_FORMATS, creativeSelection.narrativeFormatId),
    summaryOf(CONTENT_CATEGORIES, creativeSelection.contentCategoryId),
    summaryOf(AESTHETIC_DIRECTIONS, creativeSelection.aestheticDirectionId),
    deliveryPresetId === 'automatic'
      ? `Entrega: ${DELIVERY_PRESETS.find((item) => item.id === detectedDeliveryPresetId)?.label ?? 'automática'}`
      : summaryOf(DELIVERY_PRESETS, deliveryPresetId),
  ].join(' · ');

  return (
    <Tabs
      value={workspaceTab}
      onValueChange={(value) => setWorkspaceTab(value as 'producao' | 'auditoria')}
      className="gap-8 p-6 xl:p-8"
    >
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-xs font-medium tracking-[0.18em] text-primary uppercase">Direção criativa IA</p>
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Produção com IA</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Descreva o vídeo em linguagem natural. O Aethera planeja narrativa, storyboard, ritmo e humor pontual.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="muted">
            <Bot aria-hidden />
            {totalReadyProviders > 0
              ? `${directorCount} diretores · ${totalReadyProviders} provedor(es) RF-07`
              : `${directorCount} diretores · Modo determinístico local`}
          </Badge>
          {capabilities && (
            <Badge variant={capabilities.ffmpeg ? 'muted' : 'warning'}>FFmpeg {capabilities.ffmpeg ? 'OK' : 'Fallback'}</Badge>
          )}
        </div>
        <TabsList variant="line" aria-label="Áreas da Produção com IA" className="w-full justify-start border-b border-border">
          <TabsTrigger value="producao" className="flex-none px-3">
            Produção & Direção
          </TabsTrigger>
          <TabsTrigger value="auditoria" className="flex-none px-3">
            Auditoria Editorial
            {stagedJob?.editorialAudit?.integrityReport && (
              <Badge variant={stagedJob.editorialAudit.integrityReport.passed ? 'success' : 'destructive'}>
                {stagedJob.editorialAudit.integrityReport.errorCount} erro(s)
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>
      </header>

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

      <TabsContent value="producao" className="flex flex-col gap-12">
        <div className="grid items-start gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]">
          {/* Briefing & settings */}
          <div className="flex min-w-0 flex-col gap-8">
            <TrendRadarPanel
              api={(bridge() ?? {}) as TrendRadarBridgeApi}
              onApplyIdea={(payload) => {
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
              }}
            />

            <form onSubmit={handleProduce} aria-labelledby="cinema-briefing-title" className="flex flex-col gap-6">
              <SectionHeading
                id="cinema-briefing-title"
                title="Briefing"
                description="O texto define tema, duração e tom. Os ajustes abaixo só precisam mudar quando o automático não servir."
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
                {durationSyncedFromPrompt && (
                  <p className="text-xs text-success">
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

              {/* Essential settings */}
              <div className="grid gap-x-4 gap-y-5 sm:grid-cols-2">
                <Field label="Duração (min)" htmlFor="cinema-duration">
                  <Input
                    id="cinema-duration"
                    type="number"
                    min={0.5}
                    max={60}
                    step={0.5}
                    value={Number((targetDurationSec / 60).toFixed(2))}
                    onChange={(e) => handleManualControlChange('targetDurationSec', Math.max(15, Math.round((Number(e.target.value) || 1) * 60)))}
                  />
                </Field>

                <div className="flex flex-col gap-1.5">
                  <label className="flex items-center justify-between gap-2 text-[13px] font-medium" htmlFor="cinema-humor">
                    <span className="inline-flex items-center gap-1.5">
                      <Laugh className="size-3.5 text-primary" aria-hidden /> Humor
                    </span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {humorIntensity}% {humorIntensity === 35 ? '(Padrão)' : humorIntensity === 0 ? '(Desativado)' : ''}
                    </span>
                  </label>
                  <div className="flex h-9 items-center">
                    <input
                      id="cinema-humor"
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={humorIntensity}
                      aria-valuetext={`${humorIntensity}%`}
                      onChange={(e) => handleManualControlChange('humorIntensity', Number(e.target.value))}
                      className="w-full accent-primary"
                    />
                  </div>
                </div>

                <Field label="Idioma do vídeo" htmlFor="cinema-language">
                  <Select
                    id="cinema-language"
                    value={videoLanguage}
                    onChange={(e) => handleManualControlChange('language', e.target.value)}
                  >
                    <option value="pt-BR">Português (BR)</option>
                    <option value="en-US">English (US)</option>
                    <option value="es-ES">Español</option>
                    <option value="fr-FR">Français</option>
                    <option value="de-DE">Deutsch</option>
                    <option value="it-IT">Italiano</option>
                    <option value="ja-JP">日本語 (JP)</option>
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
                          <option key={v.id} value={v.id}>
                            {v.label} ({v.id})
                          </option>
                        ))
                      ) : (
                        <option value="9190edfa">
                          {voiceStudioAvailable ? 'Voz padrão (9190edfa)' : '9190edfa (VoiceStudio offline)'}
                        </option>
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

              {/* Advanced settings */}
              <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen} className="flex flex-col gap-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <CollapsibleTrigger asChild>
                    <Button type="button" variant="ghost" size="sm" className="-ml-3">
                      <ChevronDown
                        data-icon="inline-start"
                        aria-hidden
                        className={cn('transition-transform motion-reduce:transition-none', advancedOpen && 'rotate-180')}
                      />
                      Configurações avançadas
                    </Button>
                  </CollapsibleTrigger>
                  {!advancedOpen && <span className="min-w-0 truncate text-xs text-muted-foreground">{advancedSummary}</span>}
                </div>
                <CollapsibleContent className="grid gap-x-4 gap-y-5 md:grid-cols-2">
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
                    <Select
                      id="cinema-delivery-preset"
                      value={deliveryPresetId}
                      onChange={(e) => handleDeliveryPresetChange(e.target.value)}
                    >
                      <option value="automatic">Automático (Detectar pelo Prompt)</option>
                      {DELIVERY_PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label} · {item.aspectRatio}</option>)}
                    </Select>
                  </Field>

                  <Field label="Perfil de render" htmlFor="cinema-render-profile">
                    <Select
                      id="cinema-render-profile"
                      value={renderProfile}
                      onChange={(e) => handleManualControlChange('renderProfile', e.target.value as typeof renderProfile)}
                    >
                      <option value="draft_540p">Draft 540p (1.4 GB VRAM)</option>
                      <option value="review_720p">Review 720p (2.4 GB VRAM)</option>
                      <option value="master_1080p">Master 1080p (4.8 GB VRAM)</option>
                      <option value="master_4k">Master 4K (alto custo)</option>
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

                  <div className="md:col-span-2">
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
                </CollapsibleContent>
              </Collapsible>

              <Separator />

              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button type="button" variant="ghost" onClick={handleBenchmark} disabled={busy || benchmarking}>
                  {benchmarking ? <LoaderCircle className="animate-spin" aria-hidden /> : <Activity aria-hidden />}
                  {benchmarking ? 'Rodando Benchmark...' : 'Rodar Benchmark'}
                </Button>
                <Button type="submit" size="lg" disabled={busy || renderingReal}>
                  {busy || renderingReal ? <LoaderCircle className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
                  {busy || renderingReal ? 'Produzindo e renderizando...' : 'Gerar Direção & Storyboard'}
                </Button>
              </div>
            </form>

            <ProductionContractCompliancePanel
              contract={stagedJob?.contract ?? null}
              compliance={stagedJob?.contractCompliance ?? null}
              conflicts={stagedJob?.contract?.conflicts ?? promptConflicts}
            />
          </div>

          {/* Live tracking of the active production */}
          <aside aria-labelledby="cinema-tracking-title" className="flex flex-col gap-6 xl:sticky xl:top-6">
            <SectionHeading id="cinema-tracking-title" title="Acompanhamento" />

            {hasActiveProduction ? (
              <div className="flex flex-col gap-4">
                <div className="flex flex-col gap-3" aria-live="polite">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-mono text-3xl font-light tabular-nums text-foreground">{activePct}%</span>
                    {stagedJob && (
                      <Badge variant={stagedJob.state === 'error' ? 'destructive' : stagedJob.state.startsWith('paused') ? 'warning' : 'muted'}>
                        {STAGE_DISPLAY_LABELS[stagedJob.state] ?? stagedJob.state}
                      </Badge>
                    )}
                  </div>
                  <Progress value={activePct} aria-label="Progresso da produção ativa" />
                  <p className="text-sm text-foreground/90">{stagedJob?.message || progressStage}</p>
                  <dl className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-muted-foreground">Decorrido</dt>
                      <dd className="font-mono tabular-nums text-foreground">{activeTiming.elapsedLabel}</dd>
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <dt className="text-muted-foreground">Restante aprox.</dt>
                      <dd className="font-mono tabular-nums text-foreground">{activeTiming.etaLabel}</dd>
                    </div>
                  </dl>
                </div>

                {stagedJob && (isJobRunning(stagedJob) || (!busy && isResumableJobState(stagedJob.state))) && (
                  <div className="flex flex-wrap gap-2">
                    {isJobRunning(stagedJob) && (
                      <Button type="button" size="sm" variant="outline" onClick={handleCancelStaged}>
                        <X aria-hidden /> Cancelar
                      </Button>
                    )}
                    {!busy && isResumableJobState(stagedJob.state) && (
                      <Button type="button" size="sm" onClick={() => void handleResumeStaged()}>
                        <RotateCcw aria-hidden /> Retomar Projeto
                      </Button>
                    )}
                  </div>
                )}

                <ol aria-label="Etapas da produção" className="flex flex-col">
                  {PIPELINE_STAGES.map((st) => {
                    const done = stagedJob?.completedStages?.includes(st.id);
                    const active = stagedJob?.state === st.id;
                    return (
                      <li
                        key={st.id}
                        data-stage-state={done ? 'done' : active ? 'active' : 'pending'}
                        aria-current={active ? 'step' : undefined}
                        className={cn(
                          'flex items-center gap-3 py-1.5 text-xs',
                          done ? 'text-foreground/80' : active ? 'font-medium text-foreground' : 'text-muted-foreground/70',
                        )}
                      >
                        {done ? (
                          <CheckCircle2 className="size-3.5 shrink-0 text-success" aria-hidden />
                        ) : active ? (
                          <LoaderCircle className="size-3.5 shrink-0 animate-spin text-primary motion-reduce:animate-none" aria-hidden />
                        ) : (
                          <Circle className="size-3.5 shrink-0" aria-hidden />
                        )}
                        <span className="capitalize">{st.label.toLowerCase()}</span>
                        <span className="sr-only">{done ? ' (concluída)' : active ? ' (em andamento)' : ' (pendente)'}</span>
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhuma produção ativa. Envie o briefing para acompanhar etapas, tempo e pendências aqui.
              </p>
            )}

            {stagedJob?.state === 'paused_pending_media' && stagedJob.pendingMedia.length > 0 && (
              <Alert variant="warning">
                <TriangleAlert aria-hidden />
                <AlertTitle>Pendências de Mídia Real ({stagedJob.pendingMedia.length} cena(s))</AlertTitle>
                <AlertDescription className="w-full gap-3">
                  <p>A montagem final aguarda mídias válidas. Nenhuma cena foi substituída silenciosamente por placeholder.</p>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={async () => {
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
                    }}
                  >
                    Autorizar Motion Visual para todas e Continuar
                  </Button>
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
          </aside>
        </div>

        {stagedJobs.length > 0 && (
          <section aria-labelledby="cinema-productions-title" className="flex flex-col gap-4">
            <SectionHeading
              id="cinema-productions-title"
              title={`Projetos em Produção com IA (${stagedJobs.length})`}
              description="Etapa atual e porcentagem de cada produção. O Editor é liberado somente após concluir todas as etapas. Cada projeto tem o próprio console."
            />
            <ul className="flex flex-col">
              {stagedJobs.map((job, index) => {
                const ready = isJobReadyForEditor(job);
                const jobKey = jobKeyOf(job);
                const stageLabel = STAGE_DISPLAY_LABELS[job.state] ?? job.state;
                const completedCount = Math.min(8, job.completedStages?.length ?? 0);
                const timing = computeJobTiming(job, nowMs);
                return (
                  <li key={jobKey} className="flex flex-col">
                    {index > 0 && <Separator />}
                    <article
                      data-production-job={jobKey}
                      aria-label={job.prompt || job.projectId}
                      className="flex flex-col gap-3 py-5"
                    >
                      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
                        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                          <p className="line-clamp-2 text-sm font-medium text-foreground">{job.prompt || job.projectId}</p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                            <span className="text-foreground/85">
                              Etapa ({completedCount}/8): {stageLabel}
                            </span>
                            <span className="font-mono" title={`Projeto ${job.projectId}`}>
                              {jobKey}
                              {job.attempt && job.attempt > 1 ? ` · tentativa ${job.attempt}` : ''}
                            </span>
                            {job.renderExports && job.renderExports.length > 0 && (
                              <Badge variant={job.renderExports.every((item) => item.validationValid) ? 'success' : 'warning'}>
                                {job.renderExports.length} exportação(ões) master ·{' '}
                                {job.renderExports.every((item) => item.validationValid) ? 'FFprobe OK' : 'revisão técnica necessária'}
                              </Badge>
                            )}
                          </div>
                          {job.message && <p className="truncate text-xs text-muted-foreground">{job.message}</p>}
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => void openDeleteModal(job)}
                            title="Excluir projeto"
                            aria-label={`Excluir prompt ${promptDeleteLabel({ prompt: job.prompt, fallback: job.projectId })}`}
                            className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 aria-hidden />
                          </Button>
                          {job.state === 'paused_pending_media' ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setStagedJob(job);
                                setProgressPct(job.progressPct);
                                setProgressStage(job.message);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                            >
                              Resolver Mídias ({job.pendingMedia.length})
                            </Button>
                          ) : isResumableJobState(job.state) ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={busy}
                              onClick={() => {
                                setStagedJob(job);
                                setProgressPct(job.progressPct);
                                setProgressStage(job.message);
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                                void handleResumeStaged(job.projectId);
                              }}
                            >
                              Retomar Projeto
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              variant={ready ? 'default' : 'secondary'}
                              disabled={!ready}
                              title={ready ? 'Abrir produção concluída no Editor' : 'Aguarde todas as etapas serem concluídas para abrir no Editor'}
                              onClick={() => navigate(`/video?projectId=${encodeURIComponent(job.projectId)}`)}
                            >
                              <Film aria-hidden />
                              {ready ? 'Editor' : 'Aguardando etapas'}
                            </Button>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Progress value={job.progressPct} className="h-1.5" aria-label={`Progresso de ${job.prompt || job.projectId}`} />
                        <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-foreground">{job.progressPct}%</span>
                      </div>
                      <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                        <span>Decorrido: {timing.elapsedLabel}</span>
                        <span>Restante aprox.: {timing.etaLabel}</span>
                      </div>
                      <ProductionConsoleAccordion jobId={jobKey} title="Console desta produção" />
                    </article>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {stagedJobs.length > 0 && (
          <section aria-labelledby="cinema-general-console-title" className="flex flex-col gap-4">
            <SectionHeading
              id="cinema-general-console-title"
              title="Console Geral"
              description="Todas as produções (vídeos e thumbnails) ao mesmo tempo, com filtros por job, status, agente e etapa. Independente dos consoles de cada projeto."
            />
            <ProductionConsoleAccordion scope="all" />
          </section>
        )}

        {benchmark && (
          <section aria-labelledby="cinema-benchmark-title" className="flex flex-col gap-4">
            <SectionHeading
              id="cinema-benchmark-title"
              title={`Benchmark Corpus (${benchmark.devCount} dev / ${benchmark.holdoutCount} holdout)`}
            />
            <dl className="grid gap-x-8 gap-y-5 sm:grid-cols-2 lg:grid-cols-5">
              <Metric label="Recall Defeitos Críticos" value={`${(benchmark.criticalDefectRecall * 100).toFixed(0)}%`} tone="success" />
              <Metric label="Falso Positivo" value={`${(benchmark.falsePositiveRate * 100).toFixed(1)}%`} />
              <Metric label="Bloqueio Sensível" value={`${(benchmark.sensitiveBlockAccuracy * 100).toFixed(0)}%`} tone="success" />
              <Metric label="Direcionado vs Baseline" value={`${benchmark.meanDirectedScore} vs ${benchmark.meanBaselineScore}`} />
              <Metric
                label="A/B Humor (35% vs 0%)"
                value={`${(benchmark.abHumor35ActiveRate * 100).toFixed(0)}% vs ${(benchmark.abHumor0ActiveRate * 100).toFixed(0)}%`}
              />
            </dl>
          </section>
        )}

        {pkg && (
          <div className="grid items-start gap-10 lg:grid-cols-12">
            {/* Narrative & Storyboard */}
            <section aria-labelledby="cinema-storyboard-title" className="flex flex-col gap-5 lg:col-span-7">
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

              <ul className="grid gap-3 sm:grid-cols-2">
                {pkg.direction.shots.map((s, idx) => {
                  const sceneDur = Math.max(4, Math.round(pkg.direction.brief.targetDurationSec / Math.max(1, pkg.direction.shots.length)));
                  return (
                    <li key={s.shotId} className="overflow-hidden rounded-lg bg-muted/50 text-xs">
                      <div className="flex h-20 items-end justify-between bg-gradient-to-br from-primary/25 via-muted to-background p-2.5">
                        <Badge variant="secondary" className="font-mono">
                          Cena {idx + 1} · {sceneDur}s
                        </Badge>
                        <Badge variant="outline" className="bg-background/60">{s.framing}</Badge>
                      </div>
                      <div className="flex flex-col gap-1 p-3">
                        <div className="flex items-center justify-between font-medium text-foreground">
                          <span className="font-mono">{s.shotId}</span>
                          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                            <Volume2 className="size-3" aria-hidden /> Narração + SFX
                          </span>
                        </div>
                        <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                          <Camera className="size-3 text-primary" aria-hidden /> {s.cameraMotion} · Transição: {s.transitionIn}
                        </p>
                        <p className="text-[11px] text-muted-foreground">
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
                  <Button
                    type="button"
                    size="sm"
                    variant={planApproved ? 'secondary' : 'default'}
                    onClick={() => setPlanApproved(true)}
                  >
                    {planApproved && <CheckCircle2 className="text-success" aria-hidden />}
                    {planApproved ? 'Plano Aprovado' : 'Aprovar Plano'}
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <Link to="/video">Abrir no Editor NLE</Link>
                  </Button>
                </div>
              </div>

              {/* Natural-language revision input */}
              <form onSubmit={handleRevision} className="flex gap-2">
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
            </section>

            {/* Comedy Beats & Release Gates */}
            <section aria-labelledby="cinema-quality-title" className="flex flex-col gap-5 lg:col-span-5">
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
                <Button type="button" variant="secondary" onClick={handleRepair} disabled={busy}>
                  <Wrench aria-hidden /> Executar Reparo Cirúrgico (Budget 3)
                </Button>
              )}

              {pkg.timeline.comedyBeats.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum beat de humor ativo (intensidade 0% ou contexto sensível).</p>
              ) : (
                <ul className="flex flex-col">
                  {pkg.timeline.comedyBeats.map((cb, index) => (
                    <li key={cb.beatId} className="flex flex-col gap-1 text-xs">
                      {index > 0 && <Separator className="my-3" />}
                      <div className="flex items-center justify-between font-medium text-foreground">
                        <span>
                          {cb.humorMechanism} · pausa {cb.pauseFrames}f
                        </span>
                        <span className="text-muted-foreground">{cb.contextRisk}</span>
                      </div>
                      <p className="text-foreground/90">{cb.punchline}</p>
                      <p className="text-muted-foreground">Fallback sem humor: {cb.fallbackWithoutHumor}</p>
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

              <Button type="button" onClick={handleRenderRealMp4} disabled={busy || renderingReal}>
                <Film aria-hidden /> {renderingReal ? 'Renderizando MP4 Real...' : 'Renderizar MP4 Real (FFmpeg)'}
              </Button>

              {realRender && (
                <div className="flex flex-col gap-3 text-xs">
                  <div className="flex items-center justify-between gap-2 font-medium text-success">
                    <span className="inline-flex items-center gap-1.5">
                      <CheckCircle2 className="size-3.5" aria-hidden /> MP4 Real Verificado (FFprobe/ebur128)
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">{realRender.encoderUsed}</span>
                  </div>
                  <p className="font-mono text-[11px] break-all text-muted-foreground">{realRender.mp4Path}</p>
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

              {otioPreview && (
                <pre className="max-h-40 overflow-auto rounded-lg bg-muted/50 p-3 text-[11px] text-muted-foreground">{otioPreview}</pre>
              )}
            </section>
          </div>
        )}

        <section aria-labelledby="cinema-diagnostics-title" className="flex flex-col gap-4">
          <SectionHeading
            id="cinema-diagnostics-title"
            title="Diagnósticos da produção"
            description="Cobertura de mídia e direção de voz da produção selecionada."
          />
          <div className="grid gap-6 lg:grid-cols-2">
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
          </div>
        </section>

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
      </TabsContent>
    </Tabs>
  );
}

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

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'success' }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn('text-xl font-light tabular-nums', tone === 'success' ? 'text-success' : 'text-foreground')}>{value}</dd>
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
