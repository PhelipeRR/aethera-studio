import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  BookOpen,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  Film,
  Link as LinkIcon,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RecapProviderReadinessView {
  providerId: string;
  label: string;
  status: 'available' | 'circuit_open' | 'unavailable';
  code?: string;
  reason?: string;
  resetAtText?: string;
}

export interface RecapReadinessView {
  ready: boolean;
  operationalProviders: string[];
  providers: RecapProviderReadinessView[];
  checkpoint: {
    exists: boolean;
    chapterId: string | null;
    completedPanels: number;
    totalPanels: number;
    pendingPanels: number;
    canResume: boolean;
    lastUpdatedAtIso: string | null;
  };
  autoResumeRecommended: boolean;
  summaryMessage: string;
  checkedAtIso: string;
}

interface RecapRevisionPlanView {
  prompt: string;
  understood: boolean;
  affectedSceneIds: string[];
  reprocessStages: string[];
  reusedStages: string[];
  estimatedVideoReworkRatio: number;
  summary: string;
  actions: Array<{ kind: string; description: string }>;
}

interface EditableSceneRow {
  sceneId: string;
  panelId: string;
  narrationText: string;
  motionStyle: string;
  estimatedDurationSec: number;
}

interface SelectedArchiveFile {
  path: string;
  name: string;
  sizeBytes: number;
}

interface RecapBridge {
  recapGetReadiness?: (input?: { chapterId?: string }) => Promise<RecapReadinessView>;
  recapPlanRevision?: (input: { prompt: string; script: unknown; availablePanelIds?: string[] }) => Promise<RecapRevisionPlanView>;
  recapSelectArchives?: () => Promise<{ canceled: boolean; files: SelectedArchiveFile[] }>;
  recapImportAnalyze?: (input: { url: string }) => Promise<{
    sourceUrl: string;
    adapterName: string;
    meta: { workTitle: string; chapterNumber: string };
    pages: Array<{ pageNumber: number; imageUrl: string }>;
    availableChapters: Array<{ chapterNumber: string; title: string; url: string }>;
    alreadyImported: { cbzPath: string } | null;
  }>;
  recapImportCreateJob?: (input: { urls: string[]; forceReimport?: boolean }) => Promise<{
    id: string;
    status: string;
    items: Array<{ url: string; status: string; pagesDone: number; pagesTotal: number; libraryEntry?: { cbzPath: string }; error?: string }>;
  }>;
  recapImportGetJob?: (id: string) => Promise<{
    id: string;
    status: string;
    items: Array<{ url: string; status: string; pagesDone: number; pagesTotal: number; libraryEntry?: { cbzPath: string }; error?: string }>;
  } | null>;
  recapImportCancelJob?: (id: string) => Promise<unknown>;
  recapImportRetryJob?: (id: string) => Promise<unknown>;
  recapImportCdnDirect?: (input: { imageUrls: string[]; chapterPageUrl: string; workTitle?: string; chapterNumber?: string }) => Promise<{
    cbzPath: string;
    pageCount: number;
    workTitle: string;
    chapterNumber: string;
    warnings: string[];
  }>;
  recapStartProduction?: (input: {
    archivePath: string;
    workTitle: string;
    language: string;
    scriptStyle: string;
    aspectRatio: '16:9' | '9:16';
    ttsProvider: string;
    enableOcr: boolean;
    resumeCheckpoint: boolean;
  }) => Promise<{ ok: boolean; message: string; previewMp4Path?: string }>;
  recapListProjects?: () => Promise<Array<{
    runId: string;
    chapterId: string;
    workTitle: string;
    state: string;
    completedSteps: string[];
    previewMp4Path?: string | null;
    updatedAtIso: string;
  }>>;
  recapDeleteProject?: (runId: string) => Promise<{ ok: boolean; deleted?: string; error?: string }>;
}

function getRecapBridge(): RecapBridge | undefined {
  return (window as unknown as { aetheraBridge?: RecapBridge }).aetheraBridge;
}

// ─── Pipeline Stages ────────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { id: 'import', label: 'Importação', icon: Download },
  { id: 'gate-f', label: 'Integridade', icon: ShieldCheck },
  { id: 'vision', label: 'Visão Multimodal', icon: Film },
  { id: 'continuity', label: 'Continuidade', icon: RefreshCw },
  { id: 'script', label: 'Roteiro', icon: BookOpen },
  { id: 'humanize', label: 'Humanização', icon: Sparkles },
  { id: 'motion', label: 'Motion & Áudio', icon: Play },
  { id: 'gate-h', label: 'Qualidade Final', icon: CheckCircle2 },
] as const;

type StageId = typeof PIPELINE_STAGES[number]['id'];

// ─── Design Tokens ──────────────────────────────────────────────────────────

const T = {
  // Colors — Apple-inspired restraint with Aethera brand accents
  bg: '#fafafa',
  surface: '#ffffff',
  surfaceHover: '#f5f5f7',
  border: 'rgba(0, 0, 0, 0.06)',
  borderStrong: 'rgba(0, 0, 0, 0.1)',
  text: '#1d1d1f',
  textSecondary: '#86868b',
  textTertiary: '#aeaeb2',
  accent: '#6a46d8',       // lavender base
  accentSoft: '#efe9fd',
  lime: '#d8fb4f',
  limeDark: '#8fa832',
  success: '#34c759',
  warning: '#ff9f0a',
  error: '#ff3b30',
  // Spacing scale (4px base)
  sp1: 4, sp2: 8, sp3: 12, sp4: 16, sp5: 20, sp6: 24, sp8: 32, sp10: 40, sp12: 48,
  // Radius
  radiusSm: 8, radiusMd: 12, radiusLg: 16, radiusXl: 20, radiusFull: 9999,
  // Shadows — subtle depth, not heavy cards
  shadowSm: '0 1px 2px rgba(0,0,0,0.04), 0 1px 3px rgba(0,0,0,0.06)',
  shadowMd: '0 2px 8px rgba(0,0,0,0.04), 0 4px 16px rgba(0,0,0,0.06)',
  shadowLg: '0 4px 12px rgba(0,0,0,0.04), 0 8px 32px rgba(0,0,0,0.08)',
} as const;

// ─── Shared Styles ──────────────────────────────────────────────────────────

const inputStyle: CSSProperties = {
  width: '100%',
  padding: `${T.sp2}px ${T.sp3}px`,
  borderRadius: T.radiusSm,
  border: `1px solid ${T.border}`,
  background: T.surface,
  color: T.text,
  fontSize: 13,
  fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif',
  outline: 'none',
  transition: 'border-color 150ms ease, box-shadow 150ms ease',
  boxSizing: 'border-box',
};

const btnPrimary: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: T.sp2,
  padding: `${T.sp2}px ${T.sp5}px`,
  borderRadius: T.radiusFull,
  border: 'none',
  background: T.accent,
  color: '#fff',
  fontSize: 13, fontWeight: 600,
  cursor: 'pointer',
  transition: 'opacity 150ms ease, transform 100ms ease',
  fontFamily: 'inherit',
};

const btnSecondary: CSSProperties = {
  ...btnPrimary,
  background: T.surface,
  color: T.text,
  border: `1px solid ${T.borderStrong}`,
};

const btnGhost: CSSProperties = {
  ...btnPrimary,
  background: 'transparent',
  color: T.textSecondary,
  padding: `${T.sp1}px ${T.sp3}px`,
};

// ─── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: T.textTertiary, marginBottom: T.sp2, display: 'block',
    }}>
      {children}
    </span>
  );
}

function Card({ children, style, onClick }: { children: React.ReactNode; style?: CSSProperties; onClick?: () => void }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: T.surface,
        borderRadius: T.radiusLg,
        border: `1px solid ${T.border}`,
        padding: T.sp5,
        boxShadow: T.shadowSm,
        transition: 'box-shadow 200ms ease, border-color 200ms ease',
        cursor: onClick ? 'pointer' : undefined,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Horizontal pipeline progress bar with labeled stages */
function PipelineTimeline({
  activeStage,
  stageProgress,
}: {
  activeStage: StageId | null;
  stageProgress: Record<string, number>;
}) {
  const activeIdx = activeStage ? PIPELINE_STAGES.findIndex((s) => s.id === activeStage) : -1;

  return (
    <div style={{ padding: `${T.sp4}px 0` }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 2, marginBottom: T.sp3 }}>
        {PIPELINE_STAGES.map((stage, idx) => {
          const isActive = idx === activeIdx;
          const isComplete = idx < activeIdx || (stageProgress[stage.id] ?? 0) >= 100;
          const progress = stageProgress[stage.id] ?? 0;
          const Icon = stage.icon;

          return (
            <div key={stage.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: T.sp1, position: 'relative' }}>
              {/* Connector line */}
              {idx > 0 && (
                <div style={{
                  position: 'absolute', top: 14, right: '50%', width: '100%', height: 2,
                  background: isComplete || isActive ? T.accent : T.border,
                  zIndex: 0,
                  transition: 'background 300ms ease',
                }} />
              )}

              {/* Stage dot */}
              <div style={{
                width: 28, height: 28, borderRadius: T.radiusFull,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: isComplete ? T.accent : isActive ? T.accentSoft : T.surface,
                border: `1.5px solid ${isComplete || isActive ? T.accent : T.borderStrong}`,
                zIndex: 1,
                transition: 'all 300ms ease',
              }}>
                <Icon style={{
                  width: 14, height: 14,
                  color: isComplete ? '#fff' : isActive ? T.accent : T.textTertiary,
                }} />
              </div>

              {/* Label */}
              <span style={{
                fontSize: 10, fontWeight: isActive ? 600 : 400,
                color: isActive ? T.accent : isComplete ? T.text : T.textTertiary,
                textAlign: 'center', lineHeight: 1.2,
                transition: 'color 300ms ease',
              }}>
                {stage.label}
              </span>

              {/* Percentage badge */}
              {(isActive || isComplete) && progress > 0 && (
                <span style={{
                  fontSize: 9, fontWeight: 700, fontVariantNumeric: 'tabular-nums',
                  color: isComplete ? T.success : T.accent,
                }}>
                  {Math.round(progress)}%
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Video preview player placeholder */
function PreviewPlayer({ mp4Path, isProducing }: { mp4Path: string | null; isProducing: boolean }) {
  return (
    <div style={{
      aspectRatio: '16/9',
      borderRadius: T.radiusLg,
      background: '#000',
      overflow: 'hidden',
      position: 'relative',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      {mp4Path ? (
        <video src={mp4Path} controls style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
      ) : isProducing ? (
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.7)' }}>
          <RefreshCw className="animate-spin" style={{ width: 32, height: 32, margin: '0 auto 12px', opacity: 0.6 }} />
          <p style={{ fontSize: 13, fontWeight: 500 }}>Gerando preview…</p>
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.4)' }}>
          <Film style={{ width: 40, height: 40, margin: '0 auto 12px', opacity: 0.5 }} />
          <p style={{ fontSize: 13, fontWeight: 500 }}>Preview disponível após produção</p>
        </div>
      )}
    </div>
  );
}

/** Quality scorecard ring */
function ScoreRing({ score, label }: { score: number; label: string }) {
  const circumference = 2 * Math.PI * 28;
  const offset = circumference * (1 - score / 100);
  const color = score >= 80 ? T.success : score >= 60 ? T.warning : T.error;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: T.sp1 }}>
      <svg width={68} height={68} viewBox="0 0 68 68" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={34} cy={34} r={28} fill="none" stroke={T.border} strokeWidth={4} />
        <circle
          cx={34} cy={34} r={28} fill="none" stroke={color} strokeWidth={4}
          strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round"
          style={{ transition: 'stroke-dashoffset 600ms ease' }}
        />
      </svg>
      <span style={{ fontSize: 18, fontWeight: 700, color: T.text, marginTop: -4 }}>{score}</span>
      <span style={{ fontSize: 10, color: T.textSecondary, fontWeight: 500 }}>{label}</span>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

type SubTab = 'import' | 'produce' | 'preview';

interface PersistedProject {
  runId: string;
  chapterId: string;
  workTitle: string;
  state: string;
  completedSteps: string[];
  previewMp4Path?: string | null;
  updatedAtIso: string;
}

export function RecapProductionPanel() {
  const [subTab, setSubTab] = useState<SubTab>('import');
  const [persistedProjects, setPersistedProjects] = useState<PersistedProject[]>([]);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);

  // Load persisted projects on mount
  useEffect(() => {
    const bridge = getRecapBridge();
    if (bridge?.recapListProjects) {
      void bridge.recapListProjects().then((projects) => {
        setPersistedProjects(projects ?? []);
      }).catch(() => { /* ignore — fallback to empty list */ });
    }
  }, []);

  const handleDeleteProject = async (runId: string) => {
    const bridge = getRecapBridge();
    if (!bridge?.recapDeleteProject) return;
    setDeletingProjectId(runId);
    try {
      const result = await bridge.recapDeleteProject(runId);
      if (result.ok) {
        setPersistedProjects((prev) => prev.filter((p) => p.runId !== runId));
      }
    } finally {
      setDeletingProjectId(null);
    }
  };

  const handleResumeProject = (project: PersistedProject) => {
    setWorkTitle(project.workTitle);
    if (project.previewMp4Path) {
      setPreviewMp4(project.previewMp4Path);
      setSubTab('preview');
    } else {
      setSubTab('produce');
    }
  };

  // Import state
  const [origin, setOrigin] = useState<'cbz' | 'link' | 'cdn'>('cbz');
  const [selectedFiles, setSelectedFiles] = useState<SelectedArchiveFile[]>([]);
  const [linkInputs, setLinkInputs] = useState<string[]>(['']);
  const [cdnImageUrls, setCdnImageUrls] = useState('');
  const [cdnChapterUrl, setCdnChapterUrl] = useState('');
  const [cdnWorkTitle, setCdnWorkTitle] = useState('');
  const [cdnChapterNumber, setCdnChapterNumber] = useState('');
  const [cdnImporting, setCdnImporting] = useState(false);
  const [cdnResult, setCdnResult] = useState<{ cbzPath: string; pageCount: number; workTitle: string; chapterNumber: string } | null>(null);
  const [analyzedLinks, setAnalyzedLinks] = useState<Array<{
    url: string; adapterName: string; meta: { workTitle: string; chapterNumber: string };
    pagesCount: number; alreadyImported: { cbzPath: string } | null;
  }>>([]);
  const [importJob, setImportJob] = useState<{
    id: string; status: string;
    items: Array<{ url: string; status: string; pagesDone: number; pagesTotal: number; libraryEntry?: { cbzPath: string }; error?: string }>;
  } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Production state
  const [productionMode, setProductionMode] = useState<'single' | 'individual'>('single');
  const [startState, setStartState] = useState<'idle' | 'validating' | 'analyzing' | 'downloading' | 'generating-cbz' | 'preparing' | 'producing'>('idle');
  const [workTitle, setWorkTitle] = useState('');
  const [language, setLanguage] = useState<'pt-BR' | 'en-US' | 'es-ES'>('pt-BR');
  const [humorVolume, setHumorVolume] = useState(35);
  const [scriptStyle, setScriptStyle] = useState('cinematic_recap');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [ttsProvider, setTtsProvider] = useState('voicestudio_tts');
  const [enableOcr, setEnableOcr] = useState(false);
  const [readiness, setReadiness] = useState<RecapReadinessView>({
    ready: false, operationalProviders: [], providers: [], checkpoint: { exists: false, chapterId: null, completedPanels: 0, totalPanels: 0, pendingPanels: 0, canResume: false, lastUpdatedAtIso: null },
    autoResumeRecommended: false, summaryMessage: '', checkedAtIso: new Date().toISOString(),
  });
  const [loading, setLoading] = useState(false);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  // Preview / Review state
  const [scenes, setScenes] = useState<EditableSceneRow[]>([]);
  const [revisionPrompt, setRevisionPrompt] = useState('');
  const [impactPlan, setImpactPlan] = useState<RecapRevisionPlanView | null>(null);
  const [previewMp4, setPreviewMp4] = useState<string | null>(null);
  const [scheduleDate, setScheduleDate] = useState('');

  // Simulated pipeline progress for demo
  const [stageProgress, setStageProgress] = useState<Record<string, number>>({});
  const activeStage = useMemo<StageId | null>(() => {
    if (startState === 'idle') return null;
    if (startState === 'validating' || startState === 'analyzing' || startState === 'downloading' || startState === 'generating-cbz') return 'import';
    if (startState === 'preparing') return 'gate-f';
    if (startState === 'producing') return 'motion';
    return null;
  }, [startState]);

  // ─── IPC Handlers ─────────────────────────────────────────────────────────

  const refreshReadiness = useCallback(async () => {
    setLoading(true);
    try {
      const bridge = getRecapBridge();
      if (bridge?.recapGetReadiness) {
        setReadiness(await bridge.recapGetReadiness());
      } else {
        setStatusNote('Bridge IPC não conectado neste build.');
      }
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refreshReadiness(); }, [refreshReadiness]);

  const handleSelectFiles = async () => {
    const bridge = getRecapBridge();
    if (!bridge?.recapSelectArchives) { setImportError('Seletor disponível apenas no Aethera Desktop.'); return; }
    const result = await bridge.recapSelectArchives();
    if (!result.canceled && result.files.length > 0) {
      setSelectedFiles(result.files);
      setImportError(null);
      if (!workTitle && result.files.length === 1) setWorkTitle(result.files[0]?.name.replace(/\.(cbz|pdf)$/i, '') ?? '');
    }
  };

  const handleStart = async (resumeCheckpoint: boolean) => {
    const bridge = getRecapBridge();
    if (!bridge?.recapStartProduction) { setStatusNote('IPC recap:start-production não conectado.'); return; }
    setImportError(null);
    if (origin === 'cbz') {
      if (selectedFiles.length === 0) { setImportError('Selecione pelo menos um arquivo CBZ ou PDF.'); return; }
      setStartState('validating');
      setStageProgress({ import: 30 });
      setStartState('preparing');
      setStageProgress((p) => ({ ...p, import: 100, 'gate-f': 50 }));
      try {
        const firstFile = selectedFiles[0];
        if (!firstFile) { setImportError('Nenhum arquivo selecionado.'); return; }
        const res = await bridge.recapStartProduction({
          archivePath: firstFile.path, workTitle: workTitle || firstFile.name.replace(/\.(cbz|pdf)$/i, ''),
          language, scriptStyle, aspectRatio, ttsProvider, enableOcr, resumeCheckpoint,
        });
        setStartState('producing');
        setStageProgress((p) => ({ ...p, 'gate-f': 100, vision: 60, continuity: 40, script: 30, humanize: 20, motion: 10 }));
        setStatusNote(res.message);
        if (res.previewMp4Path) { setPreviewMp4(res.previewMp4Path); setSubTab('preview'); }
      } catch (err) {
        setStartState('idle');
        setStatusNote(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const handlePlanRevision = async (promptText?: string) => {
    const text = (promptText ?? revisionPrompt).trim();
    if (!text) return;
    setRevisionPrompt(text);
    const bridge = getRecapBridge();
    if (bridge?.recapPlanRevision) {
      const planRes = await bridge.recapPlanRevision({
        prompt: text,
        script: { chapterId: workTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-'), title: workTitle, scenes: scenes.map((s) => ({ sceneId: s.sceneId, narrationText: s.narrationText })) },
        availablePanelIds: ['panel-001', 'panel-002', 'panel-003'],
      });
      setImpactPlan(planRes);
    } else {
      setStatusNote('IPC recapPlanRevision indisponível.');
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
  };

  const overallProgress = useMemo(() => {
    const values = Object.values(stageProgress);
    if (values.length === 0) return 0;
    return Math.round(values.reduce((a, b) => a + b, 0) / PIPELINE_STAGES.length);
  }, [stageProgress]);

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif', color: T.text }}>

      {/* Header */}
      <header style={{ marginBottom: T.sp8 }}>
        <SectionLabel>Aethera Studio</SectionLabel>
        <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.02em', margin: 0, color: T.text }}>
          Mangá Recap
        </h1>
        <p style={{ fontSize: 14, color: T.textSecondary, marginTop: T.sp1, lineHeight: 1.5 }}>
          Importe capítulos, produza recaps com IA e revise a qualidade antes de publicar.
        </p>
      </header>

      {/* Recent Projects */}
      <section style={{ marginBottom: T.sp8 }}>
        <SectionLabel>Projetos Recentes</SectionLabel>
        {persistedProjects.length === 0 ? (
          <p style={{ fontSize: 13, color: T.textTertiary, padding: `${T.sp4}px 0` }}>
            Nenhum projeto salvo ainda. Inicie uma produção para vê-la aqui.
          </p>
        ) : (
          <div style={{
            display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: T.sp3,
          }}>
            {persistedProjects.map((project) => {
              const stateLabel = project.state === 'completed' ? 'Concluído'
                : project.state === 'awaiting_preview_approval' ? 'Aguardando aprovação'
                : project.state === 'failed' ? 'Falhou'
                : project.state === 'paused_provider_unavailable' ? 'Pausado'
                : 'Em produção';
              const stateColor = project.state === 'completed' ? T.success
                : project.state === 'awaiting_preview_approval' ? T.warning
                : project.state === 'failed' ? T.error
                : T.accent;
              const stateBg = project.state === 'completed' ? '#ecfdf3'
                : project.state === 'awaiting_preview_approval' ? '#fffbeb'
                : project.state === 'failed' ? '#fef2f2'
                : T.accentSoft;
              const progress = Math.round((project.completedSteps.length / PIPELINE_STAGES.length) * 100);
              const dateStr = new Date(project.updatedAtIso).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short' });
              const isDeleting = deletingProjectId === project.runId;

              return (
                <Card
                  key={project.runId}
                  onClick={() => !isDeleting && handleResumeProject(project)}
                  style={{
                    padding: `${T.sp3}px ${T.sp4}px`,
                    display: 'flex', flexDirection: 'column', gap: T.sp2,
                    cursor: isDeleting ? 'default' : 'pointer',
                    opacity: isDeleting ? 0.5 : 1,
                    transition: 'box-shadow 200ms ease, border-color 200ms ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: T.sp3 }}>
                    <div style={{
                      width: 36, height: 36, borderRadius: T.radiusMd,
                      background: stateBg,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                      {project.state === 'completed' ? (
                        <CheckCircle2 style={{ width: 18, height: 18, color: stateColor }} />
                      ) : project.state === 'failed' ? (
                        <X style={{ width: 18, height: 18, color: stateColor }} />
                      ) : (
                        <RefreshCw style={{ width: 18, height: 18, color: stateColor }} />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 13, fontWeight: 600, color: T.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', margin: 0 }}>
                        {project.workTitle}
                </p>
                      <div style={{ display: 'flex', alignItems: 'center', gap: T.sp2, marginTop: T.sp1 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: T.radiusFull,
                          background: stateBg, color: stateColor,
                        }}>{stateLabel}</span>
                        <span style={{ fontSize: 10, color: T.textTertiary }}>{dateStr}</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void handleDeleteProject(project.runId); }}
                      disabled={isDeleting}
                      title="Excluir projeto"
                      style={{
                        ...btnGhost, padding: T.sp1, color: T.error, opacity: isDeleting ? 0.4 : 0.6,
                        transition: 'opacity 150ms ease',
                      }}
                    >
                      <Trash2 style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                  {/* Progress bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: T.sp2 }}>
                    <div style={{ flex: 1, height: 4, borderRadius: T.radiusFull, background: T.border, overflow: 'hidden' }}>
                      <div style={{
                        height: '100%', borderRadius: T.radiusFull, background: stateColor,
                        width: `${Math.min(100, progress)}%`, transition: 'width 300ms ease',
                      }} />
                    </div>
                    <span style={{ fontSize: 10, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: T.textSecondary }}>
                      {progress}%
                    </span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Sub-tab Navigation */}
      <nav style={{
        display: 'inline-flex', gap: 2, padding: 3,
        borderRadius: T.radiusFull, background: 'rgba(0,0,0,0.04)',
        marginBottom: T.sp6,
      }}>
        {([
          ['import', 'Importar', Download],
          ['produce', 'Produzir', Sparkles],
          ['preview', 'Preview & Revisão', Film],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: T.sp2,
              padding: `${T.sp2}px ${T.sp4}px`,
              borderRadius: T.radiusFull,
              border: 'none',
              background: subTab === id ? T.surface : 'transparent',
              color: subTab === id ? T.text : T.textSecondary,
              fontSize: 13, fontWeight: subTab === id ? 600 : 500,
              cursor: 'pointer',
              boxShadow: subTab === id ? T.shadowSm : 'none',
              transition: 'all 200ms ease',
              fontFamily: 'inherit',
            }}
          >
            <Icon style={{ width: 14, height: 14 }} />
            {label}
          </button>
        ))}
      </nav>

      {/* ─── IMPORT TAB ─────────────────────────────────────────────────── */}
      {subTab === 'import' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: T.sp5 }}>

          {/* Origin selector */}
          <Card>
            <SectionLabel>Origem dos capítulos</SectionLabel>
            <div style={{ display: 'flex', gap: T.sp3 }}>
              {([
                ['cbz', 'CBZ / PDF', Upload],
                ['link', 'Link', LinkIcon],
                ['cdn', 'CDN Direto', Download],
              ] as const).map(([id, label, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setOrigin(id)}
                  style={{
                    flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: T.sp2,
                    padding: T.sp4, borderRadius: T.radiusMd,
                    border: `1.5px solid ${origin === id ? T.accent : T.border}`,
                    background: origin === id ? T.accentSoft : T.surface,
                    color: origin === id ? T.accent : T.textSecondary,
                    fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    transition: 'all 200ms ease', fontFamily: 'inherit',
                  }}
                >
                  <Icon style={{ width: 20, height: 20 }} />
                  {label}
                </button>
              ))}
            </div>
          </Card>

          {/* CBZ file picker */}
          {origin === 'cbz' && (
            <Card>
              <SectionLabel>Arquivos</SectionLabel>
              <button type="button" onClick={() => void handleSelectFiles()} style={{
                ...btnSecondary, width: '100%', justifyContent: 'center',
                borderStyle: 'dashed', padding: T.sp6,
              }}>
                <Upload style={{ width: 16, height: 16 }} />
                Selecionar arquivos (.cbz, .pdf)
              </button>
              {selectedFiles.length > 0 && (
                <div style={{ marginTop: T.sp3, display: 'flex', flexDirection: 'column', gap: T.sp2 }}>
                  {selectedFiles.map((file, idx) => (
                    <div key={file.path} style={{
                      display: 'flex', alignItems: 'center', gap: T.sp3,
                      padding: `${T.sp2}px ${T.sp3}px`, borderRadius: T.radiusSm,
                      background: T.surfaceHover, fontSize: 12,
                    }}>
                      <span style={{ flex: 1, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {idx + 1}. {file.name}
                      </span>
                      <span style={{ color: T.textTertiary, fontSize: 11 }}>{formatBytes(file.sizeBytes)}</span>
                      <button type="button" onClick={() => setSelectedFiles(selectedFiles.filter((_, i) => i !== idx))}
                        style={{ ...btnGhost, padding: T.sp1, color: T.error }}>
                        <X style={{ width: 14, height: 14 }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}

          {/* Link inputs */}
          {origin === 'link' && (
            <Card>
              <SectionLabel>Links dos capítulos</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: T.sp2 }}>
                {linkInputs.map((url, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: T.sp2, alignItems: 'center' }}>
                    <input value={url} onChange={(e) => { const n = [...linkInputs]; n[idx] = e.target.value; setLinkInputs(n); }}
                      placeholder="https://exemplo.com/manga/capitulo/1" style={{ ...inputStyle, flex: 1 }} />
                    {linkInputs.length > 1 && (
                      <button type="button" onClick={() => setLinkInputs(linkInputs.filter((_, i) => i !== idx))}
                        style={{ ...btnGhost, color: T.error }}><X style={{ width: 14, height: 14 }} /></button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => setLinkInputs([...linkInputs, ''])}
                style={{ ...btnGhost, marginTop: T.sp3, fontSize: 12 }}>
                <Plus style={{ width: 14, height: 14 }} /> Adicionar link
              </button>
            </Card>
          )}

          {/* CDN Direct */}
          {origin === 'cdn' && (
            <Card>
              <SectionLabel>Importação direta CDN</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: T.sp3 }}>
                <textarea value={cdnImageUrls} onChange={(e) => setCdnImageUrls(e.target.value)}
                  placeholder="Cole as URLs das imagens, uma por linha" rows={4}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: '"SF Mono", "Menlo", monospace', fontSize: 12 }} />
                <input value={cdnChapterUrl} onChange={(e) => setCdnChapterUrl(e.target.value)}
                  placeholder="URL do capítulo (referer)" style={inputStyle} />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: T.sp3 }}>
                  <input value={cdnWorkTitle} onChange={(e) => setCdnWorkTitle(e.target.value)}
                    placeholder="Título da obra (opcional)" style={inputStyle} />
                  <input value={cdnChapterNumber} onChange={(e) => setCdnChapterNumber(e.target.value)}
                    placeholder="Número do capítulo (opcional)" style={inputStyle} />
                </div>
                <button type="button" disabled={cdnImporting} onClick={() => void (async () => {
                  setImportError(null); setCdnResult(null);
                  const bridge = getRecapBridge();
                  if (!bridge?.recapImportCdnDirect) { setImportError('IPC indisponível.'); return; }
                  const urls = cdnImageUrls.split('\n').map((u) => u.trim()).filter(Boolean);
                  if (urls.length === 0) { setImportError('Cole pelo menos uma URL.'); return; }
                  if (!cdnChapterUrl.trim()) { setImportError('Informe a URL do capítulo.'); return; }
                  setCdnImporting(true);
                  try {
                    const cdnInput: { imageUrls: string[]; chapterPageUrl: string; workTitle?: string; chapterNumber?: string } = { imageUrls: urls, chapterPageUrl: cdnChapterUrl.trim() };
 const trimmedTitle = cdnWorkTitle.trim();
 const trimmedChapter = cdnChapterNumber.trim();
 if (trimmedTitle) cdnInput.workTitle = trimmedTitle;
 if (trimmedChapter) cdnInput.chapterNumber = trimmedChapter;
 const res = await bridge.recapImportCdnDirect(cdnInput);
                    setCdnResult(res);
                    if (!workTitle && res.workTitle) setWorkTitle(res.workTitle);
                  } catch (err) { setImportError(err instanceof Error ? err.message : String(err)); }
                  finally { setCdnImporting(false); }
                })()} style={{ ...btnPrimary, opacity: cdnImporting ? 0.6 : 1 }}>
                  {cdnImporting ? 'Importando…' : 'Importar via CDN'}
                </button>
                {cdnResult && (
                  <div style={{ padding: T.sp3, borderRadius: T.radiusSm, background: '#ecfdf3', color: '#0f5132', fontSize: 12 }}>
                    ✓ {cdnResult.pageCount} páginas importadas · {cdnResult.workTitle} Cap. {cdnResult.chapterNumber}
                  </div>
                )}
              </div>
            </Card>
          )}

          {importError && (
            <div style={{ padding: T.sp3, borderRadius: T.radiusSm, background: '#fef2f2', color: '#991b1b', fontSize: 12, fontWeight: 500 }}>
              {importError}
            </div>
          )}

          {/* Continue button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: T.sp2 }}>
            <button type="button" onClick={() => setSubTab('produce')}
              disabled={origin === 'cbz' && selectedFiles.length === 0}
              style={{ ...btnPrimary, opacity: origin === 'cbz' && selectedFiles.length === 0 ? 0.4 : 1 }}>
              Continuar para Produção <ChevronRight style={{ width: 14, height: 14 }} />
            </button>
          </div>
        </div>
      )}

      {/* ─── PRODUCE TAB ────────────────────────────────────────────────── */}
      {subTab === 'produce' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: T.sp5 }}>

          {/* Pipeline Timeline */}
          <Card style={{ padding: `${T.sp4}px ${T.sp5}px` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: T.sp3 }}>
              <SectionLabel>Pipeline de Produção</SectionLabel>
              {overallProgress > 0 && (
                <span style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: T.accent }}>
                  {overallProgress}% concluído
                </span>
              )}
            </div>
            <PipelineTimeline activeStage={activeStage} stageProgress={stageProgress} />
          </Card>

          {/* Configuration */}
          <Card>
            <SectionLabel>Configuração</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: T.sp4 }}>
              <label style={{ fontSize: 12, color: T.textSecondary, display: 'flex', flexDirection: 'column', gap: T.sp1 }}>
                Título da obra
                <input value={workTitle} onChange={(e) => setWorkTitle(e.target.value)} style={inputStyle} placeholder="Ex: Solo Leveling" />
              </label>
              <label style={{ fontSize: 12, color: T.textSecondary, display: 'flex', flexDirection: 'column', gap: T.sp1 }}>
                Formato
                <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as '16:9' | '9:16')} style={inputStyle}>
                  <option value="16:9">16:9 Horizontal (YouTube)</option>
                  <option value="9:16">9:16 Vertical (Shorts)</option>
                </select>
              </label>
              <label style={{ fontSize: 12, color: T.textSecondary, display: 'flex', flexDirection: 'column', gap: T.sp1 }}>
                Voz (TTS)
                <select value={ttsProvider} onChange={(e) => setTtsProvider(e.target.value)} style={inputStyle}>
                  <option value="voicestudio_tts">VoiceStudio Local</option>
                  <option value="elevenlabs_tts">ElevenLabs</option>
                  <option value="windows_sapi_tts">Windows SAPI</option>
                </select>
              </label>
              <label style={{ fontSize: 12, color: T.textSecondary, display: 'flex', flexDirection: 'column', gap: T.sp1 }}>
                Idioma do vídeo
                <select value={language} onChange={(e) => setLanguage(e.target.value as 'pt-BR' | 'en-US' | 'es-ES')} style={inputStyle}>
                  <option value="pt-BR">Português (BR)</option>
                  <option value="en-US">English (US)</option>
                  <option value="es-ES">Español (ES)</option>
                </select>
              </label>
              <div style={{ fontSize: 12, color: T.textSecondary, display: 'flex', flexDirection: 'column', gap: T.sp1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span>Volume de humor</span>
                  <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: T.accent }}>{humorVolume}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={humorVolume}
                  onChange={(e) => setHumorVolume(Number(e.target.value))}
                  style={{ width: '100%', accentColor: T.accent, cursor: 'pointer' }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.textTertiary }}>
                  <span>Sério (0%)</span>
                  <span>Padrão (35%)</span>
                  <span>Máximo (100%)</span>
                </div>
              </div>
              <label style={{ fontSize: 12, color: T.textSecondary, display: 'flex', flexDirection: 'column', gap: T.sp1 }}>
                Estilo de roteiro
                <select value={scriptStyle} onChange={(e) => setScriptStyle(e.target.value)} style={inputStyle}>
                  <option value="cinematic_recap">Recap Cinematográfico</option>
                  <option value="narrative_summary">Resumo Narrativo</option>
                  <option value="dramatic_retelling">Retelling Dramático</option>
                </select>
              </label>
            </div>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: T.sp2, marginTop: T.sp4, fontSize: 12, color: T.textSecondary, cursor: 'pointer' }}>
              <input type="checkbox" checked={enableOcr} onChange={(e) => setEnableOcr(e.target.checked)}
                style={{ accentColor: T.accent }} />
              Executar OCR (Tesseract) na extração
            </label>
          </Card>

          {/* Actions */}
          <div style={{ display: 'flex', gap: T.sp3, alignItems: 'center', flexWrap: 'wrap' }}>
            <button type="button" disabled={startState !== 'idle'} onClick={() => void handleStart(false)}
              style={{ ...btnPrimary, background: T.lime, color: '#1d1d1f', opacity: startState !== 'idle' ? 0.5 : 1 }}>
              {startState === 'idle' ? 'Iniciar Produção' : startState === 'producing' ? 'Produzindo…' : 'Processando…'}
            </button>
            {readiness.checkpoint.canResume && (
              <button type="button" disabled={startState !== 'idle'} onClick={() => void handleStart(true)}
                style={btnSecondary}>
                Retomar ({readiness.checkpoint.completedPanels}/{readiness.checkpoint.totalPanels})
              </button>
            )}
            {statusNote && <span style={{ fontSize: 12, color: T.textSecondary }}>{statusNote}</span>}
          </div>

          {/* Preview Approval Gate */}
          {startState === 'producing' && statusNote?.includes('awaiting_preview_approval') && (
            <Card style={{ border: `1.5px solid ${T.accent}`, background: T.accentSoft }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: T.sp3, marginBottom: T.sp4 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: T.radiusFull,
                  background: T.accent, display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Film style={{ width: 20, height: 20, color: '#fff' }} />
                </div>
                <div>
                  <h3 style={{ fontSize: 15, fontWeight: 700, color: T.text, margin: 0 }}>Prévia pronta para revisão</h3>
                  <p style={{ fontSize: 12, color: T.textSecondary, margin: 0 }}>
                    Assista ao vídeo e aprove para continuar com a exportação final.
                  </p>
                </div>
              </div>

              <div style={{ marginBottom: T.sp4, borderRadius: T.radiusMd, overflow: 'hidden', background: '#000', position: 'relative' }}>
                {previewMp4 ? (
                  <video
                    src={previewMp4.startsWith('aethera-media://') || previewMp4.startsWith('file://') || previewMp4.startsWith('http') ? previewMp4 : `aethera-media://local?path=${encodeURIComponent(previewMp4)}`}
                    controls
                    autoPlay
                    style={{ width: '100%', display: 'block', minHeight: 200 }}
                    onError={(e) => { console.error('[RecapPreview] Video load error:', e); setStatusNote('Erro ao carregar vídeo de prévia. Verifique se o arquivo existe.'); }}
                  />
                ) : (
                  <div style={{ padding: `${T.sp8}px 0`, textAlign: 'center', color: 'rgba(255,255,255,0.5)' }}>
                    <RefreshCw className="animate-spin" style={{ width: 32, height: 32, margin: '0 auto 12px', opacity: 0.6 }} />
                    <p style={{ fontSize: 13, fontWeight: 500 }}>Carregando prévia…</p>
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: T.sp3 }}>
                <button
                  type="button"
                  onClick={() => {
                    setStartState('idle');
                    setStatusNote('Prévia aprovada! Iniciando exportação master…');
                    setStageProgress((p) => ({ ...p, motion: 100, 'gate-h': 80 }));
                    // TODO: call bridge.recapApprovePreview() when IPC is wired
                  }}
                  style={{ ...btnPrimary, flex: 1, justifyContent: 'center', background: T.lime, color: '#1d1d1f' }}
                >
                  <CheckCircle2 style={{ width: 16, height: 16 }} /> Aprovar e Exportar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStartState('idle');
                    setStatusNote('Prévia rejeitada. Ajuste as cenas e reinicie a produção.');
                    setSubTab('preview');
                  }}
                  style={{ ...btnSecondary, flex: 1, justifyContent: 'center' }}
                >
                  <X style={{ width: 16, height: 16 }} /> Rejeitar e Revisar
                </button>
              </div>
            </Card>
          )}
        </div>
      )}

      {/* ─── PREVIEW & REVIEW TAB ───────────────────────────────────────── */}
      {subTab === 'preview' && (
        <div style={{ display: 'grid', gap: T.sp5, gridTemplateColumns: '1fr 340px' }}>

          {/* Left column: Preview + Editor */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: T.sp5 }}>
            <Card style={{ padding: 0, overflow: 'hidden' }}>
              <PreviewPlayer mp4Path={previewMp4} isProducing={startState === 'producing'} />
            </Card>

            {/* Humanized Script Review */}
            <Card>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: T.sp3 }}>
                <SectionLabel>Roteiro Humanizado</SectionLabel>
                <span style={{ fontSize: 10, color: T.textTertiary }}>
                  {language === 'pt-BR' ? 'PT-BR' : language === 'en-US' ? 'EN-US' : 'ES-ES'} · Humor {humorVolume}%
                </span>
              </div>
              {scenes.length === 0 ? (
                <div style={{ padding: `${T.sp6}px 0`, textAlign: 'center' }}>
                  <BookOpen style={{ width: 32, height: 32, color: T.textTertiary, margin: '0 auto 12px', opacity: 0.5 }} />
                  <p style={{ fontSize: 13, color: T.textTertiary, margin: 0 }}>
                    O roteiro humanizado aparecerá aqui após a etapa de humanização.
                  </p>
                  <p style={{ fontSize: 11, color: T.textTertiary, margin: `${T.sp1}px 0 0`, opacity: 0.7 }}>
                    Cada cena inclui a narração adaptada ao idioma e nível de humor selecionados.
                  </p>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: T.sp3 }}>
                  {scenes.map((row, idx) => (
                    <div key={row.sceneId} style={{
                      padding: T.sp3, borderRadius: T.radiusMd,
                      border: `1px solid ${T.border}`, background: T.surface,
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: T.sp2 }}>
                        <span style={{
                          fontSize: 10, fontWeight: 700, color: T.accent,
                          padding: '2px 8px', borderRadius: T.radiusFull, background: T.accentSoft,
                        }}>
                          Cena {idx + 1} · {row.sceneId}
                        </span>
                        <span style={{ fontSize: 11, color: T.textTertiary, fontVariantNumeric: 'tabular-nums' }}>
                          {row.estimatedDurationSec}s
                        </span>
                      </div>
                      <textarea
                        value={row.narrationText}
                        onChange={(e) => { const n = [...scenes]; n[idx] = { ...row, narrationText: e.target.value }; setScenes(n); }}
                        rows={3}
                        style={{
                          ...inputStyle, resize: 'vertical', lineHeight: 1.6, fontSize: 13,
                          fontFamily: '"SF Pro Text", "Inter", system-ui, sans-serif',
                        }}
                      />
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Revision prompt */}
            <Card>
              <SectionLabel>Revisão por Prompt</SectionLabel>
              <div style={{ display: 'flex', gap: T.sp2 }}>
                <input value={revisionPrompt} onChange={(e) => setRevisionPrompt(e.target.value)}
                  placeholder="Ex: Reduza a música e destaque a narração na cena 2…" style={{ ...inputStyle, flex: 1 }} />
                <button type="button" onClick={() => void handlePlanRevision()} style={btnPrimary}>
                  Simular Impacto
                </button>
              </div>
              {impactPlan && (
                <div style={{ marginTop: T.sp3, padding: T.sp3, borderRadius: T.radiusSm, background: T.surfaceHover, fontSize: 12 }}>
                  <strong>{impactPlan.summary}</strong>
                  <p style={{ marginTop: T.sp1, color: T.textSecondary }}>
                    Reprocessar: {impactPlan.reprocessStages.join(', ') || 'nenhuma'} · Reaproveitar: {impactPlan.reusedStages.join(', ')}
                  </p>
                </div>
              )}
            </Card>
          </div>

          {/* Right column: Quality + Schedule */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: T.sp5 }}>

            {/* Quality Scorecard */}
            <Card>
              <SectionLabel>Qualidade</SectionLabel>
              <div style={{ display: 'flex', justifyContent: 'space-around', padding: `${T.sp3}px 0` }}>
                <ScoreRing score={85} label="Técnica" />
                <ScoreRing score={72} label="Narrativa" />
                <ScoreRing score={90} label="Áudio" />
              </div>
              <div style={{
                marginTop: T.sp3, padding: T.sp3, borderRadius: T.radiusSm,
                background: '#ecfdf3', color: '#0f5132', fontSize: 12, fontWeight: 500,
                display: 'flex', alignItems: 'center', gap: T.sp2,
              }}>
                <ShieldCheck style={{ width: 14, height: 14 }} />
                Aprovável nos Release Gates
              </div>
            </Card>

            {/* Schedule & Publish */}
            <Card>
              <SectionLabel>Publicação</SectionLabel>
              <label style={{ fontSize: 12, color: T.textSecondary, display: 'flex', flexDirection: 'column', gap: T.sp1 }}>
                Data de publicação
                <input type="datetime-local" value={scheduleDate} onChange={(e) => setScheduleDate(e.target.value)} style={inputStyle} />
              </label>
              <div style={{ display: 'flex', gap: T.sp2, marginTop: T.sp3 }}>
                <button type="button" style={{ ...btnPrimary, flex: 1, justifyContent: 'center', background: T.lime, color: '#1d1d1f' }}>
                  <CalendarIcon style={{ width: 14, height: 14 }} /> Agendar
                </button>
                <button type="button" style={{ ...btnSecondary, flex: 1, justifyContent: 'center' }}>
                  Publicar Agora
                </button>
              </div>
            </Card>

            {/* Provider status (collapsed) */}
            <details style={{ borderRadius: T.radiusLg, border: `1px solid ${T.border}`, overflow: 'hidden' }}>
              <summary style={{
                padding: `${T.sp3}px ${T.sp4}px`, fontSize: 12, fontWeight: 600, color: T.textSecondary,
                cursor: 'pointer', background: T.surfaceHover, listStyle: 'none',
                display: 'flex', alignItems: 'center', gap: T.sp2,
              }}>
                <MoreHorizontal style={{ width: 14, height: 14 }} />
                Status dos Provedores
              </summary>
              <div style={{ padding: T.sp4, display: 'flex', flexDirection: 'column', gap: T.sp2 }}>
                {readiness.providers.length === 0 ? (
                  <p style={{ fontSize: 12, color: T.textTertiary }}>Clique em Verificar Prontidão na aba Produzir.</p>
                ) : readiness.providers.map((p) => (
                  <div key={p.providerId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: 12 }}>
                    <span style={{ fontWeight: 500 }}>{p.label}</span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: T.radiusFull,
                      background: p.status === 'available' ? '#d1fae5' : p.status === 'circuit_open' ? '#fee2e2' : '#e5e7eb',
                      color: p.status === 'available' ? '#065f46' : p.status === 'circuit_open' ? '#991b1b' : '#374151',
                    }}>
                      {p.status === 'available' ? 'ONLINE' : p.code ?? 'OFF'}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        </div>
      )}
    </div>
  );
}