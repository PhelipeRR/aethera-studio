import React, { useEffect, useState } from 'react';
import {
  Activity,
  Bot,
  Camera,
  CheckCircle2,
  Clapperboard,
  Download,
  Film,
  Laugh,
  LoaderCircle,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  Volume2,
  Wrench,
  X,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { healthOf, useAgents } from '@/app/useAgents';
import { notify } from '@/components/NotificationsOverlay';
import { TrendRadarPanel, type TrendRadarBridgeApi } from './TrendRadarPanel';
import { MediaCoveragePanel } from './MediaCoveragePanel';
import { VoiceDirectorPanel } from './VoiceDirectorPanel';
import {
  EditorialAuditPanel,
  type EditorialAuditTrailView,
  type EditorialDossierView,
} from './EditorialAuditPanel';

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
  }) => Promise<RealRenderView>;
  cinemaListVoices?: () => Promise<{
    available: boolean;
    compatible: boolean;
    voices: Array<{ id: string; label: string; source?: string }>;
    error?: string | null;
  }>;
  cinemaStartStagedProduction?: (input: Record<string, unknown>) => Promise<StagedJobView>;
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
  resolvedUri?: string;
  allowProcedural?: boolean;
}

interface StagedJobView {
  projectId: string;
  prompt: string;
  state: string;
  progressPct: number;
  message: string;
  completedStages: string[];
  pendingMedia: PendingMediaSlotView[];
  isTechnicalSample?: boolean;
  researchDossier?: EditorialDossierView | null;
  editorialAudit?: EditorialAuditTrailView | null;
  error?: string;
  startedAt?: string;
  updatedAt?: string;
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
}

interface CinemaPackageView {
  direction: {
    treatment: string;
    brief: {
      genre: string;
      format: string;
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
  const [targetDurationSec, setTargetDurationSec] = useState(720);
  const [durationSyncedFromPrompt, setDurationSyncedFromPrompt] = useState(true);
  const [humorIntensity, setHumorIntensity] = useState(35);
  const [renderProfile, setRenderProfile] = useState<'draft_540p' | 'review_720p' | 'master_1080p'>('review_720p');
  const [videoLanguage, setVideoLanguage] = useState('pt-BR');
  const [voiceOptions, setVoiceOptions] = useState<Array<{ id: string; label: string; source?: string }>>([]);
  const [voiceStudioAvailable, setVoiceStudioAvailable] = useState(false);
  const [selectedVoiceId, setSelectedVoiceId] = useState('9190edfa');
  const [revisionNote, setRevisionNote] = useState('');
  const [planApproved, setPlanApproved] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StagedJobView | null>(null);
  const [deleteInspection, setDeleteInspection] = useState<{
    itemsToRemove: string[];
    sharedCacheEntriesPreserved: number;
  } | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);

  async function openDeleteModal(job: StagedJobView) {
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
        if (info?.itemsToRemove) {
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
    if (!deleteTarget) return;
    const api = bridge();
    if (!api?.cinemaDeleteProject) return;
    setDeletingProject(true);
    try {
      await api.cinemaDeleteProject(deleteTarget.projectId);
      setStagedJobs((prev) => prev.filter((j) => j.projectId !== deleteTarget.projectId));
      setStagedJob((prev) => (prev?.projectId === deleteTarget.projectId ? null : prev));
      notify({
        title: 'Projeto excluído',
        message: `O projeto "${deleteTarget.prompt || deleteTarget.projectId}" foi removido.`,
        type: 'success',
      });
      setDeleteTarget(null);
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

  function parsePromptDurationSec(text: string): number | null {
    const minMatch = text.match(/(\d+(?:[.,]\d+)?)\s*(?:minuto|minutos|min)\b/i);
    if (minMatch?.[1]) {
      const mins = Number(minMatch[1].replace(',', '.'));
      if (Number.isFinite(mins) && mins > 0) return Math.round(mins * 60);
    }
    const secMatch = text.match(/(\d+)\s*(?:segundo|segundos|seg|s)\b/i);
    if (secMatch?.[1]) {
      const secs = Number(secMatch[1]);
      if (Number.isFinite(secs) && secs >= 5) return secs;
    }
    return null;
  }

  function handlePromptChange(next: string) {
    setPrompt(next);
    const parsed = parsePromptDurationSec(next);
    if (parsed !== null) {
      setTargetDurationSec(parsed);
      setDurationSyncedFromPrompt(true);
    } else {
      setDurationSyncedFromPrompt(false);
    }
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
      setStagedJob(job);
      setStagedJobs((prev) => [job, ...prev.filter((j) => j.projectId !== job.projectId)]);
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
      setProgressPct(5);
      setProgressStage('Iniciando fluxo em etapas (Prompt → Pesquisa → Aquisição → Montagem → Prévia)...');
      try {
        const finalJob = await api.cinemaStartStagedProduction({
          projectId: newProjectId,
          prompt: effectivePrompt,
          genre,
          format,
          targetDurationSec,
          humorIntensity,
          renderProfile,
          useNvenc: capabilities?.gpuNvenc ?? true,
          voiceStudioVoiceId: selectedVoiceId,
          language: videoLanguage,
        });
        setStagedJob(finalJob);
        setProgressPct(finalJob.progressPct);
        setProgressStage(finalJob.message);

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
          if (options?.autoOpenEditor !== false) {
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

  async function handleResumeStaged() {
    const api = bridge();
    if (!api?.cinemaResumeProduction || !stagedJob) return;
    setBusy(true);
    setActiveStartMs(Date.now());
    setNowMs(Date.now());
    setError(null);
    try {
      const updated = await api.cinemaResumeProduction(stagedJob.projectId);
      setStagedJob(updated);
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
    const nextPrompt = `${prompt} | Revisão: ${revisionNote.trim()}`;
    setRevisionNote('');
    await runProduction(nextPrompt);
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
      });
      setRealRender(rendered);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRenderingReal(false);
    }
  }

  return (
    <div className="space-y-6 p-6 xl:p-8">
      {/* Creative Direction Hero */}
      <section className="rounded-2xl border border-primary/30 bg-gradient-to-r from-[#1a102d] via-[#100e1b] to-[#17120c] p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold tracking-[0.22em] text-amber-400 uppercase">
              Direção Criativa IA
            </p>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">Produção com IA</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Descreva o vídeo desejado em linguagem natural. O Aethera planeja narrativa, storyboard, ritmo e humor pontual ({humorIntensity}%{humorIntensity === 35 ? ' padrão' : humorIntensity === 0 ? ' desativado' : ' ativo'}).
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-[#121220] px-3 py-1 text-purple-200">
              <Bot className="size-3.5 text-purple-400" />
              {totalReadyProviders > 0
                ? `${directorCount} diretores · ${totalReadyProviders} provedor(es) RF-07`
                : `${directorCount} diretores · Modo determinístico local`}
            </span>
            {capabilities && (
              <span className="rounded-full border border-border bg-[#121220] px-3 py-1 text-muted-foreground">
                FFmpeg {capabilities.ffmpeg ? 'OK' : 'Fallback'}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* Workspace Tab Bar: Produção vs Auditoria Editorial */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <button
          type="button"
          onClick={() => setWorkspaceTab('producao')}
          className={`rounded-xl border px-3.5 py-1.5 text-xs font-medium transition ${
            workspaceTab === 'producao'
              ? 'border-primary bg-primary/15 text-primary'
              : 'border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          Produção & Direção
        </button>
        <button
          type="button"
          onClick={() => setWorkspaceTab('auditoria')}
          className={`inline-flex items-center gap-2 rounded-xl border px-3.5 py-1.5 text-xs font-medium transition ${
            workspaceTab === 'auditoria'
              ? 'border-primary bg-primary/15 text-primary'
              : 'border-border bg-card text-muted-foreground hover:text-foreground'
          }`}
        >
          Auditoria Editorial
          {stagedJob?.editorialAudit?.integrityReport && (
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                stagedJob.editorialAudit.integrityReport.passed
                  ? 'bg-emerald-500/15 text-emerald-300'
                  : 'bg-rose-500/15 text-rose-300'
              }`}
            >
              {stagedJob.editorialAudit.integrityReport.errorCount} erro(s)
            </span>
          )}
        </button>
      </div>

      {workspaceTab === 'auditoria' ? (
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
      ) : (
        <>

      <TrendRadarPanel
        api={(bridge() ?? {}) as TrendRadarBridgeApi}
        onApplyIdea={(payload) => {
          setPrompt(payload.promptText);
          setGenre(payload.genre);
          setFormat(payload.format);
          setTargetDurationSec(Math.max(30, payload.durationMin * 60));
          setDurationSyncedFromPrompt(true);
          setHumorIntensity(payload.humorIntensity);
        }}
      />

      {/* Main Prompt & Creative Controls */}
      <form onSubmit={handleProduce} className="grid gap-4 rounded-2xl border border-border bg-card p-5 lg:grid-cols-12">
        <div className="space-y-2 lg:col-span-12">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="cinema-prompt">
            Direção Criativa / Briefing
          </label>
          <textarea
            id="cinema-prompt"
            value={prompt}
            onChange={(e) => handlePromptChange(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none"
          />
          {durationSyncedFromPrompt && (
            <p className="text-[11px] text-emerald-400">
              Duração sincronizada automaticamente com o briefing: {targetDurationSec}s ({Math.round(targetDurationSec / 60)} min)
            </p>
          )}
        </div>

        <div className="space-y-1 lg:col-span-3">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="cinema-genre">Estilo / Gênero</label>
          <select
            id="cinema-genre"
            value={genre}
            onChange={(e) => setGenre(e.target.value as typeof genre)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="gameplay_essay">Gameplay Essay</option>
            <option value="documentary">Documentário</option>
            <option value="top_list">Top List / Ranking</option>
            <option value="trailer">Trailer</option>
          </select>
        </div>

        <div className="space-y-1 lg:col-span-3">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="cinema-format">Formato</label>
          <select
            id="cinema-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as typeof format)}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="youtube_16_9">YouTube 16:9 (-14 LUFS)</option>
            <option value="shorts_9_16">Shorts 9:16 (-12.5 LUFS)</option>
          </select>
        </div>

        <div className="space-y-1 lg:col-span-2">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="cinema-duration">Duração (min)</label>
          <input
            id="cinema-duration"
            type="number"
            min={0.5}
            max={60}
            step={0.5}
            value={Number((targetDurationSec / 60).toFixed(2))}
            onChange={(e) => setTargetDurationSec(Math.max(15, Math.round((Number(e.target.value) || 1) * 60)))}
            className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm"
          />
        </div>

        <div className="space-y-1 lg:col-span-4">
          <label className="flex items-center justify-between text-xs font-medium text-muted-foreground" htmlFor="cinema-humor">
            <span className="inline-flex items-center gap-1"><Laugh className="size-3.5 text-amber-400" /> Intensidade de Humor</span>
            <span className="font-mono text-foreground">{humorIntensity}% {humorIntensity === 35 ? '(Padrão)' : humorIntensity === 0 ? '(Desativado)' : ''}</span>
          </label>
          <input
            id="cinema-humor"
            type="range"
            min={0}
            max={100}
            step={5}
            value={humorIntensity}
            onChange={(e) => setHumorIntensity(Number(e.target.value))}
            className="w-full accent-purple-500"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 lg:col-span-12">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Perfil de render"
              value={renderProfile}
              onChange={(e) => setRenderProfile(e.target.value as typeof renderProfile)}
              className="rounded-xl border border-border bg-background px-3 py-1.5 text-xs"
            >
              <option value="draft_540p">Draft 540p (1.4 GB VRAM)</option>
              <option value="review_720p">Review 720p (2.4 GB VRAM)</option>
              <option value="master_1080p">Master 1080p (4.8 GB VRAM)</option>
            </select>

            <select
              id="cinema-language"
              aria-label="Idioma do vídeo"
              value={videoLanguage}
              onChange={(e) => setVideoLanguage(e.target.value)}
              className="rounded-xl border border-border bg-background px-3 py-1.5 text-xs"
            >
              <option value="pt-BR">Idioma: Português (BR)</option>
              <option value="en-US">Idioma: English (US)</option>
              <option value="es-ES">Idioma: Español</option>
              <option value="fr-FR">Idioma: Français</option>
              <option value="de-DE">Idioma: Deutsch</option>
              <option value="it-IT">Idioma: Italiano</option>
              <option value="ja-JP">Idioma: 日本語 (JP)</option>
            </select>

            <div className="flex items-center gap-1.5">
              <select
                aria-label="Voz (VoiceStudio)"
                value={selectedVoiceId}
                onChange={(e) => setSelectedVoiceId(e.target.value)}
                className="rounded-xl border border-border bg-background px-3 py-1.5 text-xs"
              >
                {voiceOptions.length > 0 ? (
                  voiceOptions.map((v) => (
                    <option key={v.id} value={v.id}>
                      Voz: {v.label} ({v.id})
                    </option>
                  ))
                ) : (
                  <option value="9190edfa">
                    {voiceStudioAvailable ? 'Voz padrão (9190edfa)' : 'Voz: 9190edfa (VoiceStudio offline)'}
                  </option>
                )}
              </select>
              <button
                type="button"
                onClick={() => void loadVoices()}
                title="Atualizar lista de vozes do VoiceStudio"
                className="rounded-xl border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:border-primary hover:text-foreground"
              >
                ↻
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleBenchmark}
              disabled={busy || benchmarking}
              className="inline-flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs font-medium hover:border-primary disabled:opacity-50"
            >
              {benchmarking ? <LoaderCircle className="size-3.5 animate-spin" /> : <Activity className="size-3.5" />}
              {benchmarking ? 'Rodando Benchmark...' : 'Rodar Benchmark'}
            </button>
            <button
              type="submit"
              disabled={busy || renderingReal}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-amber-500 px-5 py-2 text-xs font-semibold text-white shadow-lg hover:brightness-110 disabled:opacity-50"
            >
              {busy || renderingReal ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
              {busy || renderingReal ? 'Produzindo e renderizando...' : 'Gerar Direção & Storyboard'}
            </button>
          </div>
        </div>

        {(progressPct !== null || stagedJob) && (() => {
          const activeTiming = computeJobTiming(stagedJob, nowMs, activeStartMs);
          return (
          <div className="lg:col-span-12 space-y-2.5 rounded-xl border border-purple-500/30 bg-[#0d0d17] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="text-purple-200">{stagedJob?.message || progressStage}</span>
              <div className="flex items-center gap-2">
                <span className="font-mono text-[10px] text-muted-foreground">
                  Decorrido: <span className="text-foreground">{activeTiming.elapsedLabel}</span> · Restante aprox.: <span className="text-foreground">{activeTiming.etaLabel}</span>
                </span>
                {busy && stagedJob && (
                  <button
                    type="button"
                    onClick={handleCancelStaged}
                    className="rounded-lg border border-destructive/40 bg-destructive/15 px-2.5 py-0.5 text-[10px] font-medium text-destructive hover:bg-destructive/25"
                  >
                    Cancelar
                  </button>
                )}
                {!busy && stagedJob && (stagedJob.state === 'cancelled' || stagedJob.state === 'error' || stagedJob.state === 'paused_pending_script') && (
                  <button
                    type="button"
                    onClick={handleResumeStaged}
                    className="rounded-lg border border-emerald-500/40 bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-medium text-emerald-300 hover:bg-emerald-500/25"
                  >
                    Retomar Projeto
                  </button>
                )}
                <span className="font-mono font-semibold text-amber-300">{stagedJob?.progressPct ?? progressPct ?? 0}%</span>
              </div>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-purple-500 to-amber-400 transition-all duration-300"
                style={{ width: `${stagedJob?.progressPct ?? progressPct ?? 0}%` }}
              />
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {PIPELINE_STAGES.map((st) => {
                const done = stagedJob?.completedStages?.includes(st.id);
                const active = stagedJob?.state === st.id;
                return (
                  <span
                    key={st.id}
                    className={`rounded-md border px-2 py-0.5 text-[10px] font-medium ${
                      done
                        ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                        : active
                          ? 'border-amber-400/60 bg-amber-500/20 text-amber-200'
                          : 'border-border/60 bg-background/40 text-muted-foreground'
                    }`}
                  >
                    {st.label}
                  </span>
                );
              })}
            </div>
          </div>
          );
        })()}

        {stagedJob?.state === 'paused_pending_media' && stagedJob.pendingMedia.length > 0 && (
          <div className="lg:col-span-12 space-y-2.5 rounded-xl border border-amber-500/45 bg-amber-500/10 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-semibold text-amber-200">
                  Pendências de Mídia Real ({stagedJob.pendingMedia.length} cena(s))
                </h3>
                <p className="text-[11px] text-amber-100/80">
                  A montagem final aguarda mídias válidas. Nenhuma cena foi substituída silenciosamente por placeholder.
                </p>
              </div>
              <button
                type="button"
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
                className="rounded-lg border border-amber-400/50 bg-amber-500/20 px-3 py-1.5 text-[11px] font-semibold text-amber-100 hover:bg-amber-500/30 disabled:opacity-50"
              >
                Autorizar Motion Visual para todas e Continuar
              </button>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {stagedJob.pendingMedia.map((slot) => (
                <div key={slot.clipId} className="rounded-lg border border-border bg-[#0d0d17] p-3 text-xs space-y-2">
                  <div className="font-semibold text-foreground">
                    Cena #{slot.slotIndex + 1} · {slot.query}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{slot.reason}</p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleResolvePendingSlot(slot.slotIndex, { pickFile: true })}
                      className="rounded-md border border-primary/50 bg-primary/20 px-2.5 py-1 text-[11px] font-medium text-purple-200 hover:bg-primary/30 disabled:opacity-50"
                    >
                      Importar Mídia Local
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleResolvePendingSlot(slot.slotIndex, { allowProcedural: true })}
                      className="rounded-md border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      Autorizar Motion Visual
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </form>

      {stagedJobs.length > 0 && (
        <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Projetos em Produção com IA ({stagedJobs.length})
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Acompanhe a etapa atual e a porcentagem de cada produção. O botão Editor é liberado somente após concluir todas as etapas.
              </p>
            </div>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {stagedJobs.map((job) => {
              const ready = isJobReadyForEditor(job);
              const stageLabel = STAGE_DISPLAY_LABELS[job.state] ?? job.state;
              const completedCount = Math.min(8, job.completedStages?.length ?? 0);
              return (
                <article
                  key={job.projectId}
                  className="flex flex-col justify-between gap-3 rounded-xl border border-border/80 bg-[#0d0d17] p-4"
                >
                  <div className="space-y-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-xs font-semibold text-foreground">
                        {job.prompt || job.projectId}
                      </p>
                      <span className="shrink-0 rounded-full border border-purple-500/35 bg-purple-500/15 px-2 py-0.5 font-mono text-[10px] text-purple-200">
                        {job.progressPct}%
                      </span>
                    </div>
                    <p className="text-[11px] text-amber-300">
                      Etapa ({completedCount}/8): {stageLabel}
                    </p>
                    {job.message && (
                      <p className="truncate text-[10px] text-muted-foreground">{job.message}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-purple-500 to-amber-400 transition-all duration-300"
                        style={{ width: `${job.progressPct}%` }}
                      />
                    </div>
                    {(() => {
                      const timing = computeJobTiming(job, nowMs);
                      return (
                        <div className="flex items-center justify-between font-mono text-[10px] text-muted-foreground">
                          <span>Decorrido: {timing.elapsedLabel}</span>
                          <span>Restante aprox.: {timing.etaLabel}</span>
                        </div>
                      );
                    })()}
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">{job.projectId}</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => void openDeleteModal(job)}
                          title="Excluir projeto"
                          aria-label={`Excluir projeto ${job.prompt || job.projectId}`}
                          className="inline-flex items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-300 hover:border-rose-400 hover:bg-rose-500/20"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                        {job.state === 'paused_pending_media' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setStagedJob(job);
                              setProgressPct(job.progressPct);
                              setProgressStage(job.message);
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-400/50 bg-amber-500/20 px-3 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-amber-500/30"
                          >
                            Resolver Mídias ({job.pendingMedia.length})
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={!ready}
                            title={ready ? 'Abrir produção concluída no Editor' : 'Aguarde todas as etapas serem concluídas para abrir no Editor'}
                            onClick={() => navigate(`/video?projectId=${encodeURIComponent(job.projectId)}`)}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-primary/25 px-3 py-1.5 text-[11px] font-semibold text-purple-100 hover:bg-primary/40 disabled:cursor-not-allowed disabled:opacity-40"
                          >
                            <Film className="size-3.5" />
                            {ready ? 'Editor' : 'Aguardando etapas'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {error && (
        <div className="rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs text-destructive">
          {error}
        </div>
      )}

      {benchmark && (
        <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
          <h2 className="text-sm font-semibold">Benchmark Corpus ({benchmark.devCount} dev / {benchmark.holdoutCount} holdout)</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5 text-xs">
            <div className="rounded-xl border border-border bg-[#0d0d17] p-3">
              <div className="text-muted-foreground">Recall Defeitos Críticos</div>
              <div className="mt-1 text-lg font-bold text-emerald-400">{(benchmark.criticalDefectRecall * 100).toFixed(0)}%</div>
            </div>
            <div className="rounded-xl border border-border bg-[#0d0d17] p-3">
              <div className="text-muted-foreground">Falso Positivo</div>
              <div className="mt-1 text-lg font-bold">{(benchmark.falsePositiveRate * 100).toFixed(1)}%</div>
            </div>
            <div className="rounded-xl border border-border bg-[#0d0d17] p-3">
              <div className="text-muted-foreground">Bloqueio Sensível</div>
              <div className="mt-1 text-lg font-bold text-emerald-400">{(benchmark.sensitiveBlockAccuracy * 100).toFixed(0)}%</div>
            </div>
            <div className="rounded-xl border border-border bg-[#0d0d17] p-3">
              <div className="text-muted-foreground">Direcionado vs Baseline</div>
              <div className="mt-1 text-lg font-bold">{benchmark.meanDirectedScore} vs {benchmark.meanBaselineScore}</div>
            </div>
            <div className="rounded-xl border border-border bg-[#0d0d17] p-3">
              <div className="text-muted-foreground">A/B Humor (35% vs 0%)</div>
              <div className="mt-1 text-lg font-bold">{(benchmark.abHumor35ActiveRate * 100).toFixed(0)}% vs {(benchmark.abHumor0ActiveRate * 100).toFixed(0)}%</div>
            </div>
          </div>
        </section>
      )}

      {pkg && (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Narrative & Storyboard */}
          <section className="space-y-4 rounded-2xl border border-border bg-card p-5 lg:col-span-7">
            <div className="flex items-center justify-between">
              <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
                <Clapperboard className="size-4 text-purple-400" /> Planejamento Narrativo & Storyboard ({pkg.direction.shots.length} cenas)
              </h2>
              <button
                type="button"
                onClick={handleExportOtio}
                className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs hover:border-primary"
              >
                <Download className="size-3.5" /> Exportar OTIO
              </button>
            </div>
            <p className="text-xs text-muted-foreground">{pkg.direction.treatment}</p>

            <div className="grid gap-2.5 sm:grid-cols-2">
              {pkg.direction.shots.map((s, idx) => {
                const sceneDur = Math.max(4, Math.round(pkg.direction.brief.targetDurationSec / Math.max(1, pkg.direction.shots.length)));
                return (
                  <div key={s.shotId} className="overflow-hidden rounded-xl border border-border bg-[#0d0d17] text-xs">
                    <div className="relative flex h-20 items-end justify-between bg-gradient-to-br from-[#23133d] via-[#131326] to-[#1f160c] p-2.5">
                      <span className="rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
                        Cena {idx + 1} · {sceneDur}s
                      </span>
                      <span className="rounded bg-primary/30 px-1.5 py-0.5 text-[10px] text-purple-100">{s.framing}</span>
                    </div>
                    <div className="p-3 space-y-1">
                      <div className="flex items-center justify-between font-semibold text-foreground">
                        <span className="font-mono">{s.shotId}</span>
                        <span className="inline-flex items-center gap-1 text-[10px] text-emerald-300">
                          <Volume2 className="size-3" /> Narração + SFX
                        </span>
                      </div>
                      <p className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Camera className="size-3 text-purple-400" /> {s.cameraMotion} · Transição: {s.transitionIn}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        Plano B: {s.alternativePlanB.framing} ({s.alternativePlanB.transitionIn})
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-[#0d0d17] p-3 text-xs">
              <span>
                {planApproved
                  ? 'Plano aprovado para edição e renderização.'
                  : 'Revise as cenas acima antes de avançar para o Editor NLE.'}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setPlanApproved(true)}
                  className={`rounded-lg px-3 py-1.5 font-semibold ${
                    planApproved
                      ? 'border border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                      : 'bg-emerald-600 text-white hover:brightness-110'
                  }`}
                >
                  {planApproved ? 'Plano Aprovado' : 'Aprovar Plano'}
                </button>
                <Link
                  to="/video"
                  className="rounded-lg border border-primary/50 bg-primary/20 px-3 py-1.5 font-medium text-purple-200 hover:bg-primary/30"
                >
                  Abrir no Editor NLE
                </Link>
              </div>
            </div>

            {/* Natural-language revision input */}
            <form onSubmit={handleRevision} className="flex gap-2 pt-2">
              <input
                value={revisionNote}
                onChange={(e) => setRevisionNote(e.target.value)}
                placeholder="Pedir alteração por linguagem natural (ex.: acelerar abertura e reduzir humor)..."
                className="flex-1 rounded-xl border border-border bg-background px-3 py-2 text-xs"
              />
              <button
                type="submit"
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-white"
              >
                <Send className="size-3.5" /> Revisar
              </button>
            </form>
          </section>

          {/* Comedy Beats & Release Gates */}
          <section className="space-y-4 rounded-2xl border border-border bg-card p-5 lg:col-span-5">
            <div className="flex items-center justify-between">
              <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
                {pkg.releaseGates.passed ? (
                  <CheckCircle2 className="size-4 text-emerald-400" />
                ) : (
                  <ShieldAlert className="size-4 text-amber-400" />
                )}
                Qualidade & Beats de Humor
              </h2>
              <span className="font-mono text-xs">{pkg.scorecard.compositeScore}/100</span>
            </div>

            {!pkg.releaseGates.passed && (
              <button
                type="button"
                onClick={handleRepair}
                disabled={busy}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-500 px-3 py-2 text-xs font-semibold text-black"
              >
                <Wrench className="size-3.5" /> Executar Reparo Cirúrgico (Budget 3)
              </button>
            )}

            <div className="space-y-2">
              {pkg.timeline.comedyBeats.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nenhum beat de humor ativo (intensidade 0% ou contexto sensível).</p>
              ) : (
                pkg.timeline.comedyBeats.map((cb) => (
                  <div key={cb.beatId} className="rounded-xl border border-border bg-[#0d0d17] p-3 text-xs space-y-1">
                    <div className="flex items-center justify-between font-medium">
                      <span>{cb.humorMechanism} · pausa {cb.pauseFrames}f</span>
                      <span className="text-muted-foreground">{cb.contextRisk}</span>
                    </div>
                    <p>{cb.punchline}</p>
                    <p className="text-[11px] text-muted-foreground">Fallback sem humor: {cb.fallbackWithoutHumor}</p>
                  </div>
                ))
              )}
            </div>

            <div className="rounded-xl border border-border bg-[#0d0d17] p-3 text-xs text-muted-foreground flex items-center justify-between">
              <span className="inline-flex items-center gap-1.5"><Film className="size-3.5" /> {pkg.renderProfile.profile}</span>
              <span>{pkg.renderProfile.width}x{pkg.renderProfile.height}</span>
            </div>

            <button
              type="button"
              onClick={handleRenderRealMp4}
              disabled={busy || renderingReal}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-600 px-3 py-2 text-xs font-semibold text-white hover:brightness-110 disabled:opacity-50"
            >
              <Film className="size-3.5" /> {renderingReal ? 'Renderizando MP4 Real...' : 'Renderizar MP4 Real (FFmpeg)'}
            </button>

            {realRender && (
              <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs space-y-2">
                <div className="flex items-center justify-between font-semibold text-emerald-300">
                  <span>MP4 Real Verificado (FFprobe/ebur128)</span>
                  <span className="font-mono text-[11px]">{realRender.encoderUsed}</span>
                </div>
                <p className="font-mono text-[10px] text-muted-foreground break-all">{realRender.mp4Path}</p>
                <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                  <div>Duração: <span className="font-mono text-foreground">{realRender.probe.durationSec.toFixed(2)}s</span></div>
                  <div>Resolução: <span className="font-mono text-foreground">{realRender.probe.width}x{realRender.probe.height}</span></div>
                  <div>LUFS: <span className="font-mono text-foreground">{realRender.probe.integratedLufs ?? 'N/A'}</span></div>
                  <div>True Peak: <span className="font-mono text-foreground">{realRender.probe.truePeakDbtp ?? 'N/A'} dBTP</span></div>
                  <div>Black frames: <span className="font-mono text-foreground">{realRender.probe.blackFrames.length}</span></div>
                  <div>Narração: <span className="font-mono text-foreground">{realRender.narrationMode}</span></div>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  Efeitos: {realRender.appliedEffects.join(' · ')}
                </div>
                {realRender.realQcFindings.length > 0 && (
                  <div className="space-y-1 pt-1">
                    {realRender.realQcFindings.map((f) => (
                      <div key={f.issueId} className="text-[11px] text-amber-300">
                        [{f.severity}] {f.evidence}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {otioPreview && (
              <pre className="max-h-40 overflow-auto rounded-xl border border-border bg-background p-3 text-[11px] text-muted-foreground">
                {otioPreview}
              </pre>
            )}
          </section>
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <MediaCoveragePanel
          coverage={(stagedJob as unknown as { coverageReport?: Parameters<typeof MediaCoveragePanel>[0]['coverage'] })?.coverageReport ?? null}
          relevanceDecisions={(stagedJob as unknown as { mediaRelevanceDecisions?: Parameters<typeof MediaCoveragePanel>[0]['relevanceDecisions'] })?.mediaRelevanceDecisions ?? []}
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

      {deleteTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar exclusão de projeto"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-[#0d0d17] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Excluir Projeto com IA</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tem certeza que deseja excluir <span className="font-semibold text-foreground">"{deleteTarget.prompt || deleteTarget.projectId}"</span>?
                </p>
                {deleteInspection && (
                  <div className="mt-3 space-y-1.5 rounded-xl border border-border/70 bg-background/60 p-3 text-[11px]">
                    <p className="font-medium text-rose-300">Dados exclusivos que serão removidos:</p>
                    <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                      {deleteInspection.itemsToRemove.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                    <p className="pt-1 text-[10px] text-emerald-300/90">
                      Biblioteca global (SFX/VFX/músicas/templates) e {deleteInspection.sharedCacheEntriesPreserved} referência(s) compartilhada(s) com outros projetos serão preservadas.
                    </p>
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="rounded-lg border border-border p-1 text-muted-foreground hover:text-foreground"
                aria-label="Fechar"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-5 flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={deletingProject}
                className="rounded-lg border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDeleteJob()}
                disabled={deletingProject}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-3.5 py-1.5 font-semibold text-white hover:bg-rose-500 disabled:opacity-50"
              >
                <Trash2 className="size-3.5" />
                {deletingProject ? 'Excluindo...' : 'Confirmar Exclusão'}
              </button>
            </div>
          </div>
        </div>
      )}
        </>
      )}
    </div>
  );
}
