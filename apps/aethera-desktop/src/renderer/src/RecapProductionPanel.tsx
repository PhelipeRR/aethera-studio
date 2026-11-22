import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  AlertTriangle,
  BookOpen,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronRight,
  Download,
  ExternalLink,
  Film,
  FolderOpen,
  Layers,
  Link as LinkIcon,
  PauseCircle,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  Wand2,
  X,
  XCircle,
} from 'lucide-react';
import {
  deriveAudiovisualTracks,
  derivePipelineTimeline,
  deriveQualityScorecard,
  deriveQueueItemDisplayStatus,
  deriveSeparatedImportAndProductionStatus,
  deriveWorkflowSteps,
  formatTimecodeMs,
  getStateMetadata,
  mergeActiveProjectIntoRecentList,
  reconcileQueueWithSuccessfulImport,
  toAetheraMediaUrl,
  type MotionVelixKitStatusView,
  type MotionVelixRenderTelemetry,
  type RecapAudiovisualPlanView,
  type RecapDialogueEntryView,
  type RecapGateReportView,
  type RecapProjectRecordView,
  type RecapScriptView,
  type RecapStageId,
  type RecapWorkflowStepId,
  type StageVisualStatus,
} from './recap-timeline-model.js';
import { RecapWorkflowStepper } from './recap/RecapWorkflowStepper.js';
import { RecapScriptStudio } from './recap/RecapScriptStudio.js';
import { RecapVisualStoryboard } from './recap/RecapVisualStoryboard.js';
import { MotionVelixOutroPanel, type VideoOutroConfigView } from '@/features/aethera/MotionVelixOutroPanel';

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
  panelIds: string[];
  croppedImagePaths: string[];
  narrationText: string;
  characters: string[];
  eventDescription?: string;
  visualSummary?: string;
  actions?: Array<{ type: string; description: string }>;
  setting?: string;
  extractedDialogues: RecapDialogueEntryView[];
  uncertainties: string[];
  motionStyle: string;
  estimatedDurationSec: number;
  measuredDurationSec?: number;
  durationSource: 'estimated' | 'tts_measured';
  emotion?: string;
  confidence?: number;
  reviewStatus?: string;
  reviewNotes?: string;
  dirty?: boolean;
}

interface SelectedArchiveFile {
  path: string;
  name: string;
  sizeBytes: number;
}

interface RecapProgressEventPayload {
  runId: string;
  chapterId: string;
  workTitle: string;
  state: string;
  currentStage: RecapStageId | null;
  completedSteps: string[];
  message: string;
  record: RecapProjectRecordView;
  updatedAtIso: string;
}

interface RecapProjectDetailResponse {
  record: RecapProjectRecordView;
  script: RecapScriptView | null;
  plan: RecapAudiovisualPlanView | null;
  gateGReport: RecapGateReportView | null;
  gateHReport: RecapGateReportView | null;
}

interface RecapProductionResponse {
  ok: boolean;
  runId?: string;
  chapterId?: string;
  state?: string;
  message: string;
  record?: RecapProjectRecordView;
  script?: RecapScriptView | null;
  plan?: RecapAudiovisualPlanView | null;
  gateGReport?: RecapGateReportView | null;
  gateHReport?: RecapGateReportView | null;
  motionVelix?: MotionVelixRenderTelemetry | null;
  previewMp4Path?: string;
  masterMp4Path?: string;
  exportBundleDir?: string;
}

interface StoryMemoryCharacterView {
  characterId: string;
  primaryName?: string;
  aliases: string[];
  nameStatus: 'unknown' | 'probable' | 'confirmed';
  visualTraits: string[];
  firstAppearance: { chapterNumber: number; panelId: string };
  appearedInChapters: number[];
  confidence: number;
  lockedByHuman: boolean;
}

interface StoryMemoryChapterView {
  chapterNumber: number;
  chapterId: string;
  summary: string;
  events: Array<{ eventId: string; summary: string; location?: string }>;
  locations: string[];
  ongoingConflicts: string[];
  openQuestions: string[];
  processedAtIso: string;
}

interface StoryMemoryUpdateView {
  updateId: string;
  chapterNumber: number;
  kind: string;
  status: string;
  summary: string;
  confidence: number;
}

interface StoryMemoryProjectView {
  projectId: string;
  workTitle: string;
  originalLanguage: string;
  narrationLanguage: string;
  defaultScriptStyle: string;
  importedChapters: number[];
  producedChapters: number[];
  characters: StoryMemoryCharacterView[];
  chapters: StoryMemoryChapterView[];
  narrativeState: {
    currentLocation?: string;
    ongoingConflicts: string[];
    openQuestions: string[];
    revealedFacts: string[];
  };
  pendingUpdates: StoryMemoryUpdateView[];
  updatedAtIso: string;
}

interface RecapBridge {
  recapGetReadiness?: (input?: { chapterId?: string }) => Promise<RecapReadinessView>;
  cinemaTestVisionProviders?: (input?: { providerId?: string; force?: boolean }) => Promise<{
    ok: boolean;
    multimodalHealth?: Array<{
      providerId: string;
      label: string;
      multimodalStatus: string;
      multimodalLabel: string;
      detail: string;
      resetAtText?: string;
      model?: string | null;
      testedWithRealImage?: boolean;
    }>;
  }>;
  recapGetMotionVelixStatus?: () => Promise<MotionVelixKitStatusView>;
  recapPlanRevision?: (input: { prompt: string; script: unknown; availablePanelIds?: string[] }) => Promise<RecapRevisionPlanView>;
  recapSelectArchives?: () => Promise<{ canceled: boolean; files: SelectedArchiveFile[] }>;
  recapImportAnalyze?: (input: { url: string }) => Promise<{
    sourceUrl: string;
    adapterId?: string;
    adapterName: string;
    isSpecializedAdapter?: boolean;
    acquisitionMethod?: string;
    acquisitionMethodLabel?: string;
    importState?: string;
    importStateLabel?: string;
    formatHint?: 'webtoon_vertical' | 'manga_paged' | 'unknown';
    verticalStripCount?: number;
    meta: { workTitle: string; chapterNumber: string };
    pages: Array<{
      pageNumber: number;
      imageUrl: string;
      alt?: string;
      width?: number;
      height?: number;
      isVerticalStrip?: boolean;
      aspectRatio?: number;
    }>;
    availableChapters: Array<{ chapterNumber: string; title: string; url: string }>;
    alreadyImported: { cbzPath: string } | null;
  }>;
  recapImportCreateJob?: (input: { urls: string[]; forceReimport?: boolean }) => Promise<{
    id: string;
    status: string;
    blockedByProtection?: boolean;
    blockedUrl?: string;
    items: Array<{
      url: string;
      status: string;
      pagesDone: number;
      pagesTotal: number;
      libraryEntry?: { cbzPath: string };
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
    }>;
  }>;
  recapImportGetJob?: (id: string) => Promise<{
    id: string;
    status: string;
    blockedByProtection?: boolean;
    blockedUrl?: string;
    items: Array<{
      url: string;
      status: string;
      pagesDone: number;
      pagesTotal: number;
      libraryEntry?: { cbzPath: string };
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
    }>;
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
  recapFirecrawlStatus?: () => Promise<{
    enabled: boolean;
    apiUrl: string;
    hasApiKey: boolean;
    timeoutMs: number;
    available: boolean;
    lastCheckAtIso: string;
    lastError: string | null;
    responseTimeMs: number | null;
  }>;
  recapFirecrawlConfig?: (input: { apiUrl?: string; enabled?: boolean }) => Promise<{
    enabled: boolean;
    apiUrl: string;
    hasApiKey: boolean;
    timeoutMs: number;
    available: boolean;
    lastCheckAtIso: string;
    lastError: string | null;
    responseTimeMs: number | null;
  }>;
  recapOpenInBrowser?: (input: { url: string }) => Promise<{ ok: boolean; openedUrl: string }>;
  recapPickAssistedSources?: (input?: { mode?: 'files' | 'folder' }) => Promise<{ canceled: boolean; paths: string[] }>;
  recapImportAssisted?: (input: {
    paths: string[];
    workTitle: string;
    chapterNumber?: string;
    sourceUrl?: string;
    seriesProjectId?: string;
  }) => Promise<{
    archivePath: string;
    format: 'cbz' | 'pdf';
    pageCount: number;
    duplicatesRemoved: number;
    invalidSkipped: number;
    orderedFileNames: string[];
    warnings: string[];
  }>;
  recapInteractiveStart?: (input: { urls: string[]; workTitle?: string; seriesProjectId?: string }) => Promise<{
    sessionId: string;
    originKey: string;
    state: string;
    statusMessage: string;
    currentUrl: string | null;
    completedChapters: number;
    totalChapters: number;
    currentChapterPagesDone: number;
    currentChapterPagesTotal: number;
    importedEntries: Array<{ cbzPath: string; workTitle: string; chapterNumber: string; pageCount: number }>;
    warnings: string[];
    error?: string;
  }>;
  recapInteractiveStatus?: (sessionId: string) => Promise<{
    sessionId: string;
    originKey: string;
    state: string;
    statusMessage: string;
    currentUrl: string | null;
    completedChapters: number;
    totalChapters: number;
    currentChapterPagesDone: number;
    currentChapterPagesTotal: number;
    importedEntries: Array<{ cbzPath: string; workTitle: string; chapterNumber: string; pageCount: number }>;
    warnings: string[];
    error?: string;
  } | null>;
  recapInteractiveCancel?: (sessionId: string) => Promise<unknown>;
  recapInteractiveCloseSession?: (input: { url: string }) => Promise<{ ok: boolean; originKey: string }>;
  recapInteractiveClearProfile?: (input: { url: string }) => Promise<{ ok: boolean; originKey: string; cleared: boolean }>;
  recapStartProduction?: (input: {
    runId?: string;
    archivePath: string;
    archivePaths?: string[];
    workTitle: string;
    language: string;
    scriptStyle: string;
    aspectRatio: '16:9' | '9:16';
    ttsProvider: string;
    humorVolume: number;
    enableOcr: boolean;
    resumeCheckpoint: boolean;
    seriesProjectId?: string;
    chapterNumber?: number;
  }) => Promise<RecapProductionResponse>;
  recapMergeChapterArchives?: (input: { archivePaths: string[]; workTitle?: string }) => Promise<{
    valid: boolean;
    archivePath: string;
    chapterCount: number;
    pageCount: number;
    sizeBytes: number;
    chapterNumbers: string[];
    workTitle: string;
    label: string;
    error?: string;
  }>;
  recapApprovePreview?: (input: { runId: string }) => Promise<RecapProductionResponse>;
  recapSaveSceneEdit?: (input: { runId: string; sceneId: string; narrationText: string }) => Promise<{
    ok: boolean;
    message?: string;
    script?: RecapScriptView;
    gateGReport?: RecapGateReportView | null;
    record?: RecapProjectRecordView;
  }>;
  recapRegenerateScene?: (input: { runId: string; sceneId: string }) => Promise<{
    ok: boolean;
    message?: string;
    script?: RecapScriptView;
    gateGReport?: RecapGateReportView | null;
    record?: RecapProjectRecordView;
  }>;
  recapRegenerateScript?: (input: { runId: string; invalidateCache?: boolean }) => Promise<{
    ok: boolean;
    message?: string;
    script?: RecapScriptView;
    gateGReport?: RecapGateReportView | null;
    record?: RecapProjectRecordView;
  }>;
  recapMemoryListProjects?: () => Promise<StoryMemoryProjectView[]>;
  recapMemoryCreateProject?: (input: { workTitle: string; projectId?: string; originalLanguage?: string; narrationLanguage?: string; defaultScriptStyle?: string }) => Promise<StoryMemoryProjectView>;
  recapMemoryLoadProject?: (projectId: string) => Promise<StoryMemoryProjectView | null>;
  recapMemoryCorrectCharacter?: (input: { projectId: string; characterId: string; primaryName: string; nameStatus?: string; addAliases?: string[]; reason?: string }) => Promise<StoryMemoryProjectView>;
  recapMemoryMergeCharacters?: (input: { projectId: string; primaryCharacterId: string; secondaryCharacterId: string }) => Promise<StoryMemoryProjectView>;
  recapMemoryResolveUpdate?: (input: { projectId: string; updateId: string; decision: 'approved' | 'rejected' }) => Promise<StoryMemoryProjectView>;
  recapListProjects?: () => Promise<RecapProjectRecordView[]>;
  recapLoadProject?: (runId: string) => Promise<RecapProjectDetailResponse | null>;
  recapDeleteProject?: (runId: string) => Promise<{ ok: boolean; deleted?: string; removedPaths?: string[]; error?: string }>;
  recapVerifyArchive?: (input: { archivePath: string }) => Promise<{
    valid: boolean;
    exists: boolean;
    archivePath: string;
    format: 'cbz' | 'pdf' | 'unknown';
    pageCount: number;
    sizeBytes: number;
    workTitle?: string;
    chapterNumber?: string;
    error?: string;
  }>;
  onRecapProductionProgress?: (listener: (event: unknown) => void) => () => void;
  cinemaCalendarUpsertEvent?: (input: Record<string, unknown>) => Promise<unknown>;
  cinemaPublishingSchedule?: (input: Record<string, unknown>) => Promise<{ event: { id: string; scheduledPublishAtIso?: string } }>;
  cinemaPublishingBatchRecap?: (input: Record<string, unknown>) => Promise<{ batchSeriesId: string; events: Array<{ id: string }> }>;
}

function getRecapBridge(): RecapBridge | undefined {
  return (window as unknown as { aetheraBridge?: RecapBridge }).aetheraBridge;
}

// ─── Light Bento Tokens (aligned with aethera-theme.css) ────────────────────

const T = {
  surface: 'var(--card, #ffffff)',
  surfaceSubtle: 'var(--secondary, #f4f4f6)',
  border: 'var(--border, #e3e3e8)',
  borderStrong: '#cfcfd6',
  ink: 'var(--foreground, #111111)',
  inkMuted: 'var(--muted-foreground, #52525b)',
  inkSubtle: '#62626c',
  accent: '#6a46d8',
  accentSoft: 'var(--brand-lavender-soft, #efe9fd)',
  accentInk: '#2a1d5c',
  lime: 'var(--brand-lime, #d8fb4f)',
  limeSoft: 'var(--brand-lime-soft, #f3fdd0)',
  success: '#166534',
  successBg: '#eaf7df',
  successBorder: '#bbf7d0',
  warning: '#9a6200',
  warningBg: '#fef3c7',
  warningBorder: '#fde68a',
  error: '#b42840',
  errorBg: '#fde7f3',
  errorBorder: '#fbcfe8',
  mono: 'var(--font-mono, "IBM Plex Mono", ui-monospace, monospace)',
  radiusCard: 24,
  radiusInner: 16,
  radiusSm: 10,
  radiusFull: 9999,
  shadow: 'var(--elevation-1, 0 1px 2px rgba(17, 17, 17, 0.04))',
} as const;

const STAGE_ICONS: Record<RecapStageId, typeof Download> = {
  import: Download,
  'gate-f': ShieldCheck,
  vision: Film,
  continuity: RefreshCw,
  script: BookOpen,
  humanize: Sparkles,
  motion: Wand2,
  'gate-h': CheckCircle2,
};

const MOTION_LABELS: Record<string, string> = {
  ken_burns_in: 'Ken Burns In',
  ken_burns_out: 'Ken Burns Out',
  pan_vertical: 'Pan Vertical',
  pan_horizontal: 'Pan Horizontal',
  static_focus: 'Foco Seguro (Balões)',
  impact_push: 'Impact Push',
  parallax: 'Parallax',
};

const TRANSITION_LABELS: Record<string, string> = {
  cut: 'Corte seco',
  crossfade: 'Crossfade',
  flash_white: 'Flash Clímax',
  dip_black: 'Dip Black',
};

const SFX_LABELS: Record<string, string> = {
  whoosh: 'Whoosh',
  impact_hit: 'Impacto',
  tension_riser: 'Riser Tensão',
  page_turn: 'Virada Página',
  emotional_swell: 'Brilho Emocional',
};

const inputStyle: CSSProperties = {
  width: '100%',
  padding: '10px 12px',
  borderRadius: T.radiusSm,
  border: `1px solid ${T.border}`,
  background: T.surfaceSubtle,
  color: T.ink,
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};

const btnPrimary: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  padding: '10px 18px',
  borderRadius: T.radiusFull,
  border: 'none',
  background: T.ink,
  color: '#ffffff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  fontFamily: 'inherit',
};

const btnLime: CSSProperties = {
  ...btnPrimary,
  background: T.lime,
  color: T.ink,
  fontWeight: 700,
};

const btnSecondary: CSSProperties = {
  ...btnPrimary,
  background: T.surface,
  color: T.ink,
  border: `1px solid ${T.borderStrong}`,
};

const btnDanger: CSSProperties = {
  ...btnPrimary,
  background: T.error,
  color: '#ffffff',
};

const btnGhost: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  padding: '6px 10px',
  borderRadius: T.radiusSm,
  border: 'none',
  background: 'transparent',
  color: T.inkMuted,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  fontFamily: 'inherit',
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'block',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: T.accent,
        marginBottom: 8,
      }}
    >
      {children}
    </span>
  );
}

function BentoBlock({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: CSSProperties;
}) {
  return (
    <section
      style={{
        background: T.surface,
        borderRadius: T.radiusCard,
        border: `1px solid ${T.border}`,
        padding: 20,
        boxShadow: T.shadow,
        ...style,
      }}
    >
      {children}
    </section>
  );
}

function toneColors(tone: 'neutral' | 'active' | 'warning' | 'success' | 'error') {
  switch (tone) {
    case 'success':
      return { fg: T.success, bg: T.successBg, border: T.successBorder };
    case 'warning':
      return { fg: T.warning, bg: T.warningBg, border: T.warningBorder };
    case 'error':
      return { fg: T.error, bg: T.errorBg, border: T.errorBorder };
    case 'active':
      return { fg: T.accent, bg: T.accentSoft, border: '#d8ccf9' };
    default:
      return { fg: T.inkMuted, bg: T.surfaceSubtle, border: T.border };
  }
}

function stageColors(status: StageVisualStatus) {
  switch (status) {
    case 'completed':
      return { bg: T.ink, fg: '#ffffff', border: T.ink, line: T.ink, label: T.ink };
    case 'active':
      return { bg: T.accentSoft, fg: T.accent, border: T.accent, line: T.accent, label: T.accent };
    case 'paused':
      return { bg: T.warningBg, fg: T.warning, border: T.warning, line: T.warning, label: T.warning };
    case 'failed':
      return { bg: T.errorBg, fg: T.error, border: T.error, line: T.error, label: T.error };
    default:
      return { bg: T.surfaceSubtle, fg: T.inkSubtle, border: T.borderStrong, line: T.border, label: T.inkSubtle };
  }
}

function formatDateTimePt(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '—';
  return new Date(ts).toLocaleString('pt-BR', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, idx)).toFixed(idx > 0 ? 1 : 0)} ${units[idx]}`;
}

function estimateTextDurationSec(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 1;
  const words = cleaned.split(/\s+/).filter(Boolean).length;
  const pauses = (cleaned.match(/[.!?…]+/g) ?? []).length * 0.35 + (cleaned.match(/[,;:]+/g) ?? []).length * 0.15;
  return Math.max(1, Math.round((words / 2.4 + pauses) * 10) / 10);
}

function scenesFromScript(script: RecapScriptView | null, plan: RecapAudiovisualPlanView | null): EditableSceneRow[] {
  if (!script || !Array.isArray(script.scenes)) return [];
  const motionByScene = new Map<string, string>();
  const imagesByScene = new Map<string, string[]>();
  const measuredMsByScene = new Map<string, number>();

  for (const shot of plan?.shots ?? []) {
    if (!motionByScene.has(shot.sceneId)) {
      motionByScene.set(shot.sceneId, shot.motionStyle);
    }
    if (shot.imagePath) {
      const list = imagesByScene.get(shot.sceneId) ?? [];
      if (!list.includes(shot.imagePath)) list.push(shot.imagePath);
      imagesByScene.set(shot.sceneId, list);
    }
    measuredMsByScene.set(shot.sceneId, (measuredMsByScene.get(shot.sceneId) ?? 0) + (shot.durationMs ?? 0));
  }

  return script.scenes.map((scene) => {
    const fallbackImages = imagesByScene.get(scene.sceneId) ?? [];
    const croppedImagePaths =
      scene.croppedImagePaths && scene.croppedImagePaths.length > 0
        ? scene.croppedImagePaths
        : fallbackImages;
    const planDurationMs = measuredMsByScene.get(scene.sceneId);
    const measuredDurationSec =
      scene.measuredDurationSec ??
      (planDurationMs && planDurationMs > 0 ? Math.round((planDurationMs / 1000) * 10) / 10 : undefined);
    const durationSource: 'estimated' | 'tts_measured' =
      scene.durationSource === 'tts_measured' || measuredDurationSec !== undefined
        ? 'tts_measured'
        : 'estimated';

    return {
      sceneId: scene.sceneId,
      panelId: scene.panelIds?.[0] ?? '—',
      panelIds: scene.panelIds ?? [],
      croppedImagePaths,
      narrationText: scene.narrationText,
      characters: scene.characters ?? [],
      ...(scene.eventDescription ? { eventDescription: scene.eventDescription } : {}),
      ...(scene.visualSummary ? { visualSummary: scene.visualSummary } : {}),
      ...(scene.actions ? { actions: scene.actions } : {}),
      ...(scene.setting ? { setting: scene.setting } : {}),
      extractedDialogues: scene.extractedDialogues ?? [],
      uncertainties: scene.uncertainties ?? [],
      motionStyle: motionByScene.get(scene.sceneId) ?? 'ken_burns_in',
      estimatedDurationSec: Number(scene.estimatedDurationSec ?? estimateTextDurationSec(scene.narrationText)),
      ...(measuredDurationSec !== undefined ? { measuredDurationSec } : {}),
      durationSource,
      ...(scene.emotion ? { emotion: scene.emotion } : {}),
      ...(scene.confidence !== undefined ? { confidence: scene.confidence } : {}),
      ...(scene.reviewStatus ? { reviewStatus: scene.reviewStatus } : {}),
      ...(scene.reviewNotes ? { reviewNotes: scene.reviewNotes } : {}),
      dirty: false,
    };
  });
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function RealPipelineTimeline({
  record,
  liveMessage,
  isActivelyRunning = false,
  onResumeFromCheckpoint,
}: {
  record: RecapProjectRecordView | null;
  liveMessage: string | null;
  isActivelyRunning?: boolean;
  onResumeFromCheckpoint?: () => void;
}) {
  const timeline = useMemo(() => derivePipelineTimeline(record, liveMessage), [record, liveMessage]);
  const isOrphanedRun = Boolean(
    record &&
      !isActivelyRunning &&
      (record.state === 'importing' ||
        record.state === 'preflight' ||
        record.state === 'story_engine' ||
        record.state === 'audiovisual_preview' ||
        record.state === 'master_export'),
  );
  const canResume = Boolean(
    onResumeFromCheckpoint &&
      record &&
      !isActivelyRunning &&
      (isOrphanedRun || record.state === 'failed' || record.state === 'paused_for_review'),
  );
  const headerTone = isOrphanedRun ? toneColors('warning') : toneColors(timeline.tone);

  return (
    <BentoBlock>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <div>
          <SectionLabel>Timeline Real do Processo</SectionLabel>
          <p style={{ margin: 0, fontSize: 13, color: T.ink, fontWeight: 500 }}>
            {isOrphanedRun
              ? 'Produção interrompida ao reiniciar o app. O checkpoint salvo está preservado — clique em Continuar para retomar de onde parou.'
              : timeline.detailMessage}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {canResume && (
            <button
              type="button"
              onClick={onResumeFromCheckpoint}
              className="recap-pressable"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 14px',
                borderRadius: T.radiusFull,
                border: 'none',
                background: '#111111',
                color: '#ffffff',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <Play style={{ width: 13, height: 13, color: '#b6f500' }} />
              Continuar do checkpoint
            </button>
          )}
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: headerTone.fg,
              background: headerTone.bg,
              border: `1px solid ${headerTone.border}`,
              padding: '4px 10px',
              borderRadius: T.radiusSm,
            }}
          >
            {isOrphanedRun ? 'Interrompido · Checkpoint salvo' : timeline.stateLabel}
          </span>
          <span
            style={{
              fontFamily: T.mono,
              fontVariantNumeric: 'tabular-nums',
              fontSize: 14,
              fontWeight: 700,
              color: T.ink,
            }}
          >
            {timeline.completedCount}/{timeline.totalCount} · {timeline.overallProgressPct}%
          </span>
        </div>
      </div>

      {/* Linear bar */}
      <div style={{ height: 6, borderRadius: T.radiusFull, background: T.surfaceSubtle, overflow: 'hidden', marginBottom: 18 }}>
        <div
          style={{
            height: '100%',
            width: `${timeline.overallProgressPct}%`,
            background:
              timeline.tone === 'error'
                ? T.error
                : timeline.tone === 'warning'
                  ? T.warning
                  : timeline.tone === 'success'
                    ? T.success
                    : T.ink,
            borderRadius: T.radiusFull,
            transition: 'width 240ms ease',
          }}
        />
      </div>

      {/* 8 Real Stages */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(8, minmax(0, 1fr))',
          gap: 6,
        }}
      >
        {timeline.stages.map((stage) => {
          const Icon = STAGE_ICONS[stage.id];
          const c = stageColors(stage.status);
          return (
            <div
              key={stage.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                padding: '10px 6px',
                borderRadius: T.radiusInner,
                border: `1px solid ${stage.status === 'pending' ? T.border : c.border}`,
                background: stage.status === 'pending' ? T.surface : stage.status === 'completed' ? T.surfaceSubtle : c.bg,
              }}
            >
              <div
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: T.radiusFull,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: c.bg,
                  color: c.fg,
                  border: `1.5px solid ${c.border}`,
                }}
              >
                {stage.status === 'active' ? (
                  <RefreshCw className="animate-spin" style={{ width: 14, height: 14 }} />
                ) : stage.status === 'failed' ? (
                  <XCircle style={{ width: 14, height: 14 }} />
                ) : stage.status === 'paused' ? (
                  <PauseCircle style={{ width: 14, height: 14 }} />
                ) : (
                  <Icon style={{ width: 14, height: 14 }} />
                )}
              </div>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: stage.status === 'active' || stage.status === 'completed' ? 600 : 500,
                  color: c.label,
                  textAlign: 'center',
                  lineHeight: 1.25,
                }}
              >
                {stage.shortLabel}
              </span>
              <span
                style={{
                  fontSize: 10,
                  fontFamily: T.mono,
                  color: stage.status === 'completed' ? T.success : stage.status === 'failed' ? T.error : stage.status === 'paused' ? T.warning : T.inkSubtle,
                }}
              >
                {stage.status === 'completed'
                  ? 'OK'
                  : stage.status === 'active'
                    ? 'EXEC'
                    : stage.status === 'failed'
                      ? 'ERRO'
                      : stage.status === 'paused'
                        ? 'PAUSA'
                        : '—'}
              </span>
            </div>
          );
        })}
      </div>

      {record?.visionTelemetry && (
        <div
          style={{
            marginTop: 14,
            padding: '12px 14px',
            borderRadius: T.radiusInner,
            border: `1px solid ${T.border}`,
            background: T.surfaceSubtle,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: T.inkMuted }}>
                Visão Multimodal
              </span>
              {record.visionTelemetry.activeProvider ? (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: T.mono,
                    padding: '2px 8px',
                    borderRadius: T.radiusFull,
                    background: T.successBg,
                    color: T.success,
                    border: `1px solid ${T.successBorder}`,
                  }}
                >
                  Analisando: {record.visionTelemetry.activeProvider}
                  {record.visionTelemetry.activeModel ? ` (${record.visionTelemetry.activeModel})` : ''}
                </span>
              ) : (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: T.mono,
                    padding: '2px 8px',
                    borderRadius: T.radiusFull,
                    background: T.warningBg,
                    color: T.warning,
                    border: `1px solid ${T.warningBorder}`,
                  }}
                >
                  Nenhum provedor ativo
                </span>
              )}
              {record.visionTelemetry.fallbackActive && record.visionTelemetry.fallbackFrom && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    fontFamily: T.mono,
                    padding: '2px 8px',
                    borderRadius: T.radiusFull,
                    background: '#f5f3ff',
                    color: T.accent,
                    border: `1px solid #ddd6fe`,
                  }}
                >
                  Fallback: {record.visionTelemetry.fallbackFrom} → {record.visionTelemetry.activeProvider}
                </span>
              )}
            </div>
            <span style={{ fontSize: 12, fontWeight: 700, fontFamily: T.mono, color: T.ink }}>
              Painéis: {record.visionTelemetry.completedPanels}/{record.visionTelemetry.totalPanels}
              {record.visionTelemetry.totalPanels > 0
                ? ` (${Math.round((record.visionTelemetry.completedPanels / record.visionTelemetry.totalPanels) * 100)}%)`
                : ''}
            </span>
          </div>

          {record.visionTelemetry.totalPanels > 0 && (
            <div style={{ height: 5, borderRadius: T.radiusFull, background: T.border, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.min(100, Math.round((record.visionTelemetry.completedPanels / record.visionTelemetry.totalPanels) * 100))}%`,
                  background: T.accent,
                  transition: 'width 200ms ease',
                }}
              />
            </div>
          )}

          {record.visionTelemetry.priorityOrder && record.visionTelemetry.priorityOrder.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, fontSize: 11 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                <span style={{ fontWeight: 600, color: T.inkMuted }}>Ordem de prioridade:</span>
                {record.visionTelemetry.priorityOrder.map((pid, idx) => {
                  const isActive = record.visionTelemetry?.activeProvider === pid;
                  const isFailed = record.visionTelemetry?.failedProviders.some((fp) => fp.providerId === pid);
                  return (
                    <span
                      key={pid}
                      style={{
                        fontFamily: T.mono,
                        padding: '1px 7px',
                        borderRadius: T.radiusFull,
                        background: isActive ? T.successBg : isFailed ? T.errorBg : T.surface,
                        color: isActive ? T.success : isFailed ? T.error : T.ink,
                        border: `1px solid ${isActive ? T.successBorder : isFailed ? T.errorBorder : T.border}`,
                        fontWeight: isActive ? 700 : 500,
                      }}
                    >
                      {idx + 1}. {pid}
                    </span>
                  );
                })}
              </div>
              <span style={{ fontFamily: T.mono, color: T.inkMuted }}>
                Próximo fallback:{' '}
                <strong style={{ color: record.visionTelemetry.nextFallback ? T.ink : T.warning }}>
                  {record.visionTelemetry.nextFallback ?? 'nenhum disponível'}
                </strong>
              </span>
            </div>
          )}

          {record.visionTelemetry.failedProviders.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: T.inkMuted }}>
                Agentes indisponíveis e motivos:
              </span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {record.visionTelemetry.failedProviders.map((fp) => (
                  <div
                    key={fp.providerId}
                    style={{
                      fontSize: 11,
                      fontFamily: T.mono,
                      padding: '4px 8px',
                      borderRadius: T.radiusSm,
                      background: T.errorBg,
                      color: T.error,
                      border: `1px solid ${T.errorBorder}`,
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <strong>{fp.providerId}</strong>
                    <span>({fp.code})</span>
                    {fp.reason && <span style={{ color: T.ink }}>— {fp.reason}</span>}
                    {fp.resetAtText && <span>[Reset quota: {fp.resetAtText}]</span>}
                    {fp.fallbackTo && <span>→ {fp.fallbackTo}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {record.visionTelemetry.canResumeFromCheckpoint && (
            <div style={{ fontSize: 11, fontWeight: 600, color: T.success }}>
              Checkpoint preservado ({record.visionTelemetry.completedPanels}/{record.visionTelemetry.totalPanels} painéis concluídos). A produção pode ser retomada do painel {record.visionTelemetry.completedPanels + 1} sem reprocessar painéis anteriores.
            </div>
          )}
        </div>
      )}
    </BentoBlock>
  );
}

function AudiovisualTrackTimeline({
  plan,
  motionVelix,
  selectedShotId,
  onSelectShot,
  outroConfig,
  onSelectOutro,
}: {
  plan: RecapAudiovisualPlanView | null;
  motionVelix?: MotionVelixRenderTelemetry | null;
  selectedShotId: string | null;
  onSelectShot: (shotId: string, sceneId: string) => void;
  outroConfig?: VideoOutroConfigView | null;
  onSelectOutro?: () => void;
}) {
  const tracks = useMemo(() => deriveAudiovisualTracks(plan, motionVelix), [plan, motionVelix]);
  const outroDurationMs = outroConfig?.enabled ? Math.round((outroConfig.durationSec || 15) * 1000) : 0;

  if (!tracks.hasRealPlan) {
    return (
      <BentoBlock>
        <SectionLabel>Timeline Audiovisual (Multifaixa Real)</SectionLabel>
        <div
          style={{
            padding: '20px 16px',
            borderRadius: T.radiusInner,
            background: T.surfaceSubtle,
            border: `1px dashed ${T.borderStrong}`,
            textAlign: 'center',
          }}
        >
          <Layers style={{ width: 22, height: 22, color: T.inkSubtle, margin: '0 auto 8px' }} />
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: T.ink }}>
            Nenhum plano audiovisual renderizado neste projeto ainda
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: T.inkMuted }}>
            Assim que a etapa MotionVelix &amp; Áudio concluir, os shots (V1), narração medida (A1), SFX MotionVelix (A2) e legendas (T1) aparecerão aqui com durações reais.
          </p>
        </div>
      </BentoBlock>
    );
  }

  const selectedShot = tracks.shots.find((s) => s.shotId === selectedShotId) ?? tracks.shots[0] ?? null;

  return (
    <BentoBlock>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div>
          <SectionLabel>Timeline Audiovisual Real (V1 / A1 / A2 / T1)</SectionLabel>
          <p style={{ margin: 0, fontSize: 12, color: T.inkMuted }}>
            Reflete o plano real gravado em disco ({tracks.renderTarget === 'master' ? 'Master' : 'Prévia'} · {tracks.resolutionLabel} · {tracks.fps} fps)
          </p>
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 14,
            fontSize: 12,
            fontFamily: T.mono,
            fontVariantNumeric: 'tabular-nums',
            color: T.ink,
          }}
        >
          <span>Total: <strong>{formatTimecodeMs(tracks.totalDurationMs + outroDurationMs)}</strong></span>
          {outroDurationMs > 0 && (
            <span>Outro: <strong>{formatTimecodeMs(outroDurationMs)}</strong></span>
          )}
          <span>Narração: <strong>{formatTimecodeMs(tracks.measuredNarrationDurationMs)}</strong></span>
          <span>Shots: <strong>{tracks.shots.length}</strong></span>
          <span>SFX: <strong>{motionVelix?.sfxApplied ?? 0}/{tracks.sfxMarkers.length}</strong></span>
          <span>Legendas: <strong>{tracks.captionCueCount}</strong></span>
        </div>
      </div>

      {/* Multi-track grid */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* V1 Video & Motion Track */}
        <div style={{ display: 'grid', gridTemplateColumns: '112px 1fr', gap: 10, alignItems: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink, fontFamily: T.mono }}>
            V1 · Vídeo
          </div>
          <div
            style={{
              display: 'flex',
              gap: 3,
              padding: 4,
              borderRadius: T.radiusSm,
              background: T.surfaceSubtle,
              border: `1px solid ${T.border}`,
              minHeight: 44,
              overflowX: 'auto',
            }}
          >
            {tracks.shots.map((shot) => {
              const isSelected = selectedShot?.shotId === shot.shotId;
              return (
                <button
                  key={shot.shotId}
                  type="button"
                  onClick={() => onSelectShot(shot.shotId, shot.sceneId)}
                  title={`${shot.shotId} · ${MOTION_LABELS[shot.motionStyle] ?? shot.motionStyle} · ${formatTimecodeMs(shot.durationMs)}`}
                  style={{
                    flex: `${Math.max(1, shot.durationMs)} 1 0%`,
                    minWidth: 56,
                    padding: '6px 8px',
                    borderRadius: 8,
                    border: isSelected ? `2px solid ${T.ink}` : `1px solid ${shot.framingAtRisk ? T.warning : '#d8ccf9'}`,
                    background: isSelected ? T.ink : shot.balloonSafeZoneProtected ? T.limeSoft : T.accentSoft,
                    color: isSelected ? '#ffffff' : T.ink,
                    textAlign: 'left',
                    cursor: 'pointer',
                    overflow: 'hidden',
                  }}
                >
                  <div style={{ fontSize: 10, fontWeight: 700, fontFamily: T.mono, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {shot.shotId}
                  </div>
                  <div style={{ fontSize: 10, opacity: isSelected ? 0.85 : 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {MOTION_LABELS[shot.motionStyle] ?? shot.motionStyle}
                  </div>
                </button>
              );
            })}
            {outroConfig?.enabled && (
              <button
                type="button"
                onClick={onSelectOutro}
                title={`Outro MotionVelix (${outroConfig.style}) · ${outroConfig.durationSec}s · Clique para editar o encerramento`}
                style={{
                  flex: `${Math.max(1, outroDurationMs)} 1 0%`,
                  minWidth: 74,
                  padding: '6px 8px',
                  borderRadius: 8,
                  border: '1.5px solid #111111',
                  background: '#111111',
                  color: '#ffffff',
                  textAlign: 'left',
                  cursor: 'pointer',
                  overflow: 'hidden',
                }}
              >
                <div style={{ fontSize: 10, fontWeight: 700, fontFamily: T.mono, color: '#b6f500', whiteSpace: 'nowrap' }}>
                  Outro · {outroConfig.durationSec}s
                </div>
                <div style={{ fontSize: 10, opacity: 0.85, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {outroConfig.style}
                </div>
              </button>
            )}
          </div>
        </div>

        {/* A1 Narration Audio Track */}
        <div style={{ display: 'grid', gridTemplateColumns: '112px 1fr', gap: 10, alignItems: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink, fontFamily: T.mono }}>
            A1 · Narração
          </div>
          <div
            style={{
              position: 'relative',
              height: 28,
              borderRadius: T.radiusSm,
              background: T.surfaceSubtle,
              border: `1px solid ${tracks.audioClipped ? T.error : T.border}`,
              overflow: 'hidden',
              display: 'flex',
              alignItems: 'center',
              padding: '0 10px',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${Math.min(100, (tracks.measuredNarrationDurationMs / tracks.totalDurationMs) * 100)}%`,
                background: tracks.audioClipped ? T.errorBg : T.successBg,
                borderRight: `2px solid ${tracks.audioClipped ? T.error : T.success}`,
              }}
            />
            <span style={{ position: 'relative', zIndex: 1, fontSize: 11, fontFamily: T.mono, color: T.ink, fontWeight: 600 }}>
              Audio-First Sync · {formatTimecodeMs(tracks.measuredNarrationDurationMs)}
              {tracks.audioClipped ? ' (ATENÇÃO: corte detectado)' : ' (sem cortes)'}
            </span>
          </div>
        </div>

        {/* A2 MotionVelix SFX Track */}
        <div style={{ display: 'grid', gridTemplateColumns: '112px 1fr', gap: 10, alignItems: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink, fontFamily: T.mono }}>
            A2 · Velix SFX
          </div>
          <div
            style={{
              position: 'relative',
              height: 30,
              borderRadius: T.radiusSm,
              background: T.surfaceSubtle,
              border: `1px solid ${T.border}`,
              overflow: 'hidden',
            }}
          >
            {tracks.sfxMarkers.length === 0 ? (
              <span style={{ fontSize: 11, color: T.inkSubtle, padding: '6px 10px', display: 'inline-block' }}>
                Nenhum SFX planejado
              </span>
            ) : (
              tracks.sfxMarkers.map((cue) => (
                <div
                  key={cue.cueId}
                  title={`${SFX_LABELS[cue.sfxKind] ?? cue.sfxKind} @ ${formatTimecodeMs(cue.timeMs)} (${cue.gainDb} dB) · ${cue.applied ? 'Mixado do kit MotionVelix' : 'WAV ausente'}`}
                  style={{
                    position: 'absolute',
                    left: `${cue.offsetPct}%`,
                    top: 4,
                    bottom: 4,
                    padding: '0 6px',
                    borderRadius: 6,
                    background: cue.applied ? T.lime : T.warningBg,
                    border: `1px solid ${cue.applied ? '#9cc21c' : T.warningBorder}`,
                    color: T.ink,
                    fontSize: 10,
                    fontWeight: 700,
                    fontFamily: T.mono,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    whiteSpace: 'nowrap',
                  }}
                >
                  <Volume2 style={{ width: 10, height: 10 }} />
                  {SFX_LABELS[cue.sfxKind] ?? cue.sfxKind}
                </div>
              ))
            )}
          </div>
        </div>

        {/* T1 Captions Track */}
        <div style={{ display: 'grid', gridTemplateColumns: '112px 1fr', gap: 10, alignItems: 'center' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.ink, fontFamily: T.mono }}>
            T1 · Legendas
          </div>
          <div
            style={{
              height: 26,
              borderRadius: T.radiusSm,
              background: T.surfaceSubtle,
              border: `1px solid ${T.border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '0 10px',
              fontSize: 11,
              color: T.inkMuted,
              fontFamily: T.mono,
            }}
          >
            <span>ASS Smart Captions sincronizadas</span>
            <strong>{tracks.captionCueCount} blocos · {tracks.vfxActiveCount} cenas com VFX</strong>
          </div>
        </div>
      </div>

      {/* Selected shot inspector */}
      {selectedShot && (
        <div
          style={{
            marginTop: 14,
            padding: '10px 14px',
            borderRadius: T.radiusInner,
            background: T.surfaceSubtle,
            border: `1px solid ${T.border}`,
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            fontSize: 12,
          }}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'center' }}>
            <strong style={{ fontFamily: T.mono, color: T.ink }}>{selectedShot.shotId}</strong>
            <span style={{ color: T.inkMuted }}>Cena: <strong style={{ color: T.ink }}>{selectedShot.sceneId}</strong></span>
            <span style={{ color: T.inkMuted }}>Painel: <strong style={{ fontFamily: T.mono, color: T.ink }}>{selectedShot.panelId}</strong></span>
            <span style={{ color: T.inkMuted }}>Motion: <strong style={{ color: T.ink }}>{MOTION_LABELS[selectedShot.motionStyle] ?? selectedShot.motionStyle}</strong></span>
            <span style={{ color: T.inkMuted }}>Transição: <strong style={{ color: T.ink }}>{TRANSITION_LABELS[selectedShot.transitionIn] ?? selectedShot.transitionIn}</strong></span>
          </div>
          <div style={{ display: 'flex', gap: 10, fontFamily: T.mono, fontVariantNumeric: 'tabular-nums', color: T.ink }}>
            <span>{formatTimecodeMs(selectedShot.startMs)} → {formatTimecodeMs(selectedShot.endMs)}</span>
            {selectedShot.balloonSafeZoneProtected && (
              <span style={{ color: T.success, fontWeight: 700 }}>Balões protegidos</span>
            )}
            {selectedShot.framingAtRisk && (
              <span style={{ color: T.warning, fontWeight: 700 }}>Risco de corte</span>
            )}
          </div>
        </div>
      )}
    </BentoBlock>
  );
}

function PreviewPlayer({
  mp4Path,
  isProducing,
  onError,
}: {
  mp4Path: string | null;
  isProducing: boolean;
  onError?: () => void;
}) {
  return (
    <div
      style={{
        aspectRatio: '16/9',
        borderRadius: T.radiusInner,
        background: '#0f1014',
        overflow: 'hidden',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {mp4Path ? (
        <video
          key={mp4Path}
          src={toAetheraMediaUrl(mp4Path)}
          controls
          onError={onError}
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
        />
      ) : isProducing ? (
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.85)', padding: 24 }}>
          <RefreshCw className="animate-spin" style={{ width: 28, height: 28, margin: '0 auto 10px' }} />
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Renderizando vídeo com MotionVelix + FFmpeg…</p>
        </div>
      ) : (
        <div style={{ textAlign: 'center', color: 'rgba(255,255,255,0.65)', padding: 24 }}>
          <Film style={{ width: 34, height: 34, margin: '0 auto 10px', opacity: 0.7 }} />
          <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Nenhum MP4 gerado neste projeto ainda</p>
          <p style={{ margin: '4px 0 0', fontSize: 12, opacity: 0.75 }}>
            Inicie a produção na aba Produzir ou abra um projeto recente concluído.
          </p>
        </div>
      )}
    </div>
  );
}

function MetricScore({ score, label }: { score: number | null; label: string }) {
  const color =
    score === null ? T.inkSubtle : score >= 80 ? T.success : score >= 60 ? T.warning : T.error;
  return (
    <div
      style={{
        padding: '12px 10px',
        borderRadius: T.radiusInner,
        background: T.surfaceSubtle,
        border: `1px solid ${T.border}`,
        textAlign: 'center',
      }}
    >
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          fontFamily: T.mono,
          fontVariantNumeric: 'tabular-nums',
          color,
        }}
      >
        {score === null ? '—' : score}
      </div>
      <div style={{ fontSize: 11, fontWeight: 600, color: T.inkMuted, marginTop: 2 }}>{label}</div>
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

type SubTab = RecapWorkflowStepId;

export function RecapProductionPanel() {
  const [subTab, setSubTab] = useState<SubTab>('projeto');
  const [productionElapsedSec, setProductionElapsedSec] = useState(0);
  const [showTechDiagnostics, setShowTechDiagnostics] = useState(false);

  // Recent & Active Project state
  const [persistedProjects, setPersistedProjects] = useState<RecapProjectRecordView[]>([]);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [activeProject, setActiveProject] = useState<RecapProjectRecordView | null>(null);
  const [activeScript, setActiveScript] = useState<RecapScriptView | null>(null);
  const [activePlan, setActivePlan] = useState<RecapAudiovisualPlanView | null>(null);
  const [activeGateG, setActiveGateG] = useState<RecapGateReportView | null>(null);
  const [activeGateH, setActiveGateH] = useState<RecapGateReportView | null>(null);
  const [selectedShotId, setSelectedShotId] = useState<string | null>(null);
  const [pendingDeleteProject, setPendingDeleteProject] = useState<RecapProjectRecordView | null>(null);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);

  // MotionVelix status
  const [motionVelixStatus, setMotionVelixStatus] = useState<MotionVelixKitStatusView | null>(null);

  // Import state
  const [origin, setOrigin] = useState<'cbz' | 'link' | 'assisted' | 'cdn'>('cbz');
  const [selectedFiles, setSelectedFiles] = useState<SelectedArchiveFile[]>([]);
  const [linkInputs, setLinkInputs] = useState<string[]>(['']);
  const [linkImporting, setLinkImporting] = useState(false);
  const [linkImportJob, setLinkImportJob] = useState<{
    id: string;
    status: string;
    blockedByProtection?: boolean;
    blockedUrl?: string;
    items: Array<{
      url: string;
      status: string;
      pagesDone: number;
      pagesTotal: number;
      libraryEntry?: { cbzPath: string };
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
    }>;
  } | null>(null);
  const [linkImportedCbz, setLinkImportedCbz] = useState<{ cbzPath: string; label: string } | null>(null);
  const [selectedChapterCbzPaths, setSelectedChapterCbzPaths] = useState<string[]>([]);
  const [mergingChapters, setMergingChapters] = useState(false);
  const [universalAnalyzeState, setUniversalAnalyzeState] = useState<
    | 'idle'
    | 'source_recognized'
    | 'analyzing_page'
    | 'chapter_identified'
    | 'verifying_images'
    | 'importing'
    | 'import_not_permitted'
    | 'content_not_recognized'
  >('idle');
  const [analyzedChapterPreview, setAnalyzedChapterPreview] = useState<{
    sourceUrl: string;
    adapterId?: string;
    adapterName: string;
    acquisitionMethodLabel: string;
    formatHint: 'webtoon_vertical' | 'manga_paged' | 'unknown';
    verticalStripCount: number;
    workTitle: string;
    chapterNumber: string;
    pages: Array<{
      pageNumber: number;
      imageUrl: string;
      alt?: string;
      width?: number;
      height?: number;
      isVerticalStrip?: boolean;
      aspectRatio?: number;
      included: boolean;
    }>;
  } | null>(null);
  const [assistedUrl, setAssistedUrl] = useState('');
  const [assistedImporting, setAssistedImporting] = useState(false);
  const [assistedResult, setAssistedResult] = useState<{
    archivePath: string;
    format: 'cbz' | 'pdf';
    pageCount: number;
    duplicatesRemoved: number;
    invalidSkipped: number;
    warnings: string[];
  } | null>(null);
  const [interactiveModalOpen, setInteractiveModalOpen] = useState(false);
  const [interactiveSession, setInteractiveSession] = useState<{
    sessionId: string;
    originKey: string;
    state: string;
    statusMessage: string;
    currentUrl: string | null;
    completedChapters: number;
    totalChapters: number;
    currentChapterPagesDone: number;
    currentChapterPagesTotal: number;
    importedEntries: Array<{ cbzPath: string; workTitle: string; chapterNumber: string; pageCount: number }>;
    warnings: string[];
    error?: string;
  } | null>(null);
  const [firecrawlStatus, setFirecrawlStatus] = useState<{
    enabled: boolean;
    apiUrl: string;
    available: boolean;
    lastError: string | null;
    responseTimeMs: number | null;
  } | null>(null);
  const [firecrawlEndpointInput, setFirecrawlEndpointInput] = useState('http://127.0.0.1:3002');
  const [firecrawlChecking, setFirecrawlChecking] = useState(false);
  const [cdnImageUrls, setCdnImageUrls] = useState('');
  const [cdnChapterUrl, setCdnChapterUrl] = useState('');
  const [cdnWorkTitle, setCdnWorkTitle] = useState('');
  const [cdnChapterNumber, setCdnChapterNumber] = useState('');
  const [cdnImporting, setCdnImporting] = useState(false);
  const [cdnResult, setCdnResult] = useState<{ cbzPath: string; pageCount: number; workTitle: string; chapterNumber: string } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [archiveIntegrity, setArchiveIntegrity] = useState<{
    archivePath: string;
    checking: boolean;
    valid: boolean;
    pageCount: number;
    sizeBytes: number;
    error?: string;
  } | null>(null);

  // Production configuration
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [workTitle, setWorkTitle] = useState('');
  const [language, setLanguage] = useState<'pt-BR' | 'en-US' | 'es-ES'>('pt-BR');
  const [humorVolume, setHumorVolume] = useState(35);
  const [scriptStyle, setScriptStyle] = useState('natural_recap');
  const [seriesProjects, setSeriesProjects] = useState<StoryMemoryProjectView[]>([]);
  const [activeSeries, setActiveSeries] = useState<StoryMemoryProjectView | null>(null);
  const [newSeriesTitle, setNewSeriesTitle] = useState('');
  const [chapterNumber, setChapterNumber] = useState<number>(1);
  const [editingCharId, setEditingCharId] = useState<string | null>(null);
  const [editingCharName, setEditingCharName] = useState('');
  const [editingCharAliases, setEditingCharAliases] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [ttsProvider, setTtsProvider] = useState('voicestudio_tts');
  const [enableOcr, setEnableOcr] = useState(false);
  const [readiness, setReadiness] = useState<RecapReadinessView>({
    ready: false,
    operationalProviders: [],
    providers: [],
    checkpoint: {
      exists: false,
      chapterId: null,
      completedPanels: 0,
      totalPanels: 0,
      pendingPanels: 0,
      canResume: false,
      lastUpdatedAtIso: null,
    },
    autoResumeRecommended: false,
    summaryMessage: '',
    checkedAtIso: new Date().toISOString(),
  });
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [testingVision, setTestingVision] = useState(false);
  const [visionHealthItems, setVisionHealthItems] = useState<
    Array<{
      providerId: string;
      label: string;
      multimodalStatus: string;
      multimodalLabel: string;
      detail: string;
      resetAtText?: string;
      model?: string | null;
      testedWithRealImage?: boolean;
    }>
  >([]);
  const [statusNote, setStatusNote] = useState<string | null>(null);

  // Preview & Review state
  const [scenes, setScenes] = useState<EditableSceneRow[]>([]);
  const [savingSceneId, setSavingSceneId] = useState<string | null>(null);
  const [regeneratingSceneId, setRegeneratingSceneId] = useState<string | null>(null);
  const [regeneratingScript, setRegeneratingScript] = useState(false);
  const [regenerateFeedback, setRegenerateFeedback] = useState<{ ok: boolean; message: string } | null>(null);
  const [outroConfig, setOutroConfig] = useState<VideoOutroConfigView | null>(null);
  const [expandedVisualScenes, setExpandedVisualScenes] = useState<Record<string, boolean>>({});
  const [selectedPanelIdxByScene, setSelectedPanelIdxByScene] = useState<Record<string, number>>({});
  const [revisionPrompt, setRevisionPrompt] = useState('');
  const [impactPlan, setImpactPlan] = useState<RecapRevisionPlanView | null>(null);
  const [scheduleDate, setScheduleDate] = useState('');
  const [publishNote, setPublishNote] = useState<string | null>(null);
  const [publishPlatforms, setPublishPlatforms] = useState<Array<'youtube' | 'instagram' | 'tiktok'>>(['youtube', 'instagram', 'tiktok']);
  const [publishRightsConfirmed, setPublishRightsConfirmed] = useState(false);

  const recentProjects = useMemo(
    () => mergeActiveProjectIntoRecentList(persistedProjects, activeProject),
    [persistedProjects, activeProject],
  );

  const activeMediaPath = activeProject?.masterMp4Path ?? activeProject?.previewMp4Path ?? null;
  const scorecard = useMemo(
    () => deriveQualityScorecard(activeProject, activeGateG, activeGateH),
    [activeProject, activeGateG, activeGateH],
  );

  const isRunning = isSubmitting || isApproving;

  useEffect(() => {
    if (!isRunning) {
      setProductionElapsedSec(0);
      return;
    }
    const started = Date.now();
    const timer = window.setInterval(() => {
      setProductionElapsedSec(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  // Resolve active archive path across all origins or active project
  const resolvedArchivePath = useMemo(() => {
    if (origin === 'cbz' && selectedFiles[0]?.path) return selectedFiles[0].path;
    if (origin === 'assisted' && assistedResult?.archivePath) return assistedResult.archivePath;
    if (origin === 'cdn' && cdnResult?.cbzPath) return cdnResult.cbzPath;
    if (origin === 'link' && assistedResult?.archivePath) return assistedResult.archivePath;
    if (origin === 'link' && linkImportedCbz?.cbzPath) return linkImportedCbz.cbzPath;
    return activeProject?.archivePath ?? null;
  }, [origin, selectedFiles, assistedResult, cdnResult, linkImportedCbz, activeProject]);

  // Requirement 7: Confirm physical existence and binary integrity of CBZ/PDF before marking Capítulos Ready or allowing advance
  useEffect(() => {
    if (!resolvedArchivePath) {
      setArchiveIntegrity(null);
      return;
    }
    let cancelled = false;
    setArchiveIntegrity((prev) =>
      prev?.archivePath === resolvedArchivePath
        ? prev
        : { archivePath: resolvedArchivePath, checking: true, valid: true, pageCount: 0, sizeBytes: 0 },
    );
    const bridge = getRecapBridge();
    if (!bridge?.recapVerifyArchive) {
      setArchiveIntegrity({
        archivePath: resolvedArchivePath,
        checking: false,
        valid: true,
        pageCount: 0,
        sizeBytes: 0,
      });
      return;
    }
    void bridge
      .recapVerifyArchive({ archivePath: resolvedArchivePath })
      .then((res) => {
        if (cancelled) return;
        setArchiveIntegrity({
          archivePath: resolvedArchivePath,
          checking: false,
          valid: res.valid,
          pageCount: res.pageCount,
          sizeBytes: res.sizeBytes,
          ...(res.error ? { error: res.error } : {}),
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setArchiveIntegrity({
          archivePath: resolvedArchivePath,
          checking: false,
          valid: false,
          pageCount: 0,
          sizeBytes: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedArchivePath]);

  const isImportingChapterNow =
    linkImporting ||
    assistedImporting ||
    cdnImporting ||
    (interactiveModalOpen &&
      !['completed', 'access_denied', 'session_expired', 'cancelled'].includes(interactiveSession?.state ?? ''));

  const isChapterArchiveValidated = Boolean(
    resolvedArchivePath && (!archiveIntegrity || archiveIntegrity.valid),
  );

  const hasValidNarrationArtifacts = useMemo(
    () =>
      Boolean(
        scenes.length > 0 &&
          ((activePlan && activePlan.shots.length > 0) ||
            Boolean(activeProject?.previewMp4Path || activeProject?.masterMp4Path)),
      ),
    [scenes.length, activePlan, activeProject?.previewMp4Path, activeProject?.masterMp4Path],
  );

  const separatedStatus = useMemo(
    () =>
      deriveSeparatedImportAndProductionStatus({
        hasChapterSource: Boolean(resolvedArchivePath),
        chapterArchiveValidated: isChapterArchiveValidated,
        ...(archiveIntegrity?.pageCount ? { archivePageCount: archiveIntegrity.pageCount } : {}),
        archiveLabel: linkImportedCbz?.label ?? null,
        archiveError: archiveIntegrity?.valid === false ? (archiveIntegrity.error ?? 'Arquivo CBZ inválido') : null,
        isImportingChapter: isImportingChapterNow,
        importError,
        isProducing: isRunning,
        activeProject,
        sceneCount: scenes.length,
      }),
    [
      resolvedArchivePath,
      isChapterArchiveValidated,
      archiveIntegrity,
      linkImportedCbz?.label,
      isImportingChapterNow,
      importError,
      isRunning,
      activeProject,
      scenes.length,
    ],
  );

  const pipelineTimeline = useMemo(
    () => derivePipelineTimeline(activeProject, statusNote),
    [activeProject, statusNote],
  );

  const workflowSteps = useMemo(
    () =>
      deriveWorkflowSteps({
        hasSeriesOrProject: Boolean(activeSeries || activeProject),
        hasChapterSource: Boolean(resolvedArchivePath),
        chapterArchiveValidated: isChapterArchiveValidated,
        isImportingChapter: isImportingChapterNow,
        hasActiveImportError: Boolean(importError || archiveIntegrity?.valid === false),
        isProducing: isRunning,
        record: activeProject,
        sceneCount: scenes.length,
        hasLowConfidenceScenes: scenes.some(
          (s) => s.reviewStatus === 'needs_review' || (s.confidence !== undefined && s.confidence < 0.5),
        ),
        hasValidNarrationArtifacts,
        gateGVerdict: activeGateG?.verdict ?? activeProject?.gateGVerdict ?? null,
        gateHVerdict: activeGateH?.verdict ?? activeProject?.gateHVerdict ?? null,
        hasAudiovisualPlan: Boolean(activePlan && activePlan.shots.length > 0),
        hasRenderedVideo: Boolean(activeProject?.masterMp4Path || activeProject?.previewMp4Path),
      }),
    [
      activeSeries,
      activeProject,
      resolvedArchivePath,
      isChapterArchiveValidated,
      isImportingChapterNow,
      importError,
      archiveIntegrity?.valid,
      isRunning,
      scenes,
      hasValidNarrationArtifacts,
      activeGateG,
      activeGateH,
      activePlan,
    ],
  );

  // ─── Data Loading & Live IPC Subscription ────────────────────────────────

  const refreshProjects = useCallback(async (): Promise<RecapProjectRecordView[]> => {
    const bridge = getRecapBridge();
    if (!bridge?.recapListProjects) return [];
    setProjectsLoading(true);
    try {
      const list = await bridge.recapListProjects();
      const normalized = Array.isArray(list) ? list : [];
      setPersistedProjects(normalized);
      return normalized;
    } catch {
      return [];
    } finally {
      setProjectsLoading(false);
    }
  }, []);

  const refreshReadiness = useCallback(async (chapterId?: string) => {
    setReadinessLoading(true);
    try {
      const bridge = getRecapBridge();
      if (bridge?.recapGetReadiness) {
        setReadiness(await bridge.recapGetReadiness(chapterId ? { chapterId } : undefined));
      }
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    } finally {
      setReadinessLoading(false);
    }
  }, []);

  const handleTestVisionReal = useCallback(async () => {
    const bridge = getRecapBridge();
    if (!bridge?.cinemaTestVisionProviders) return;
    setTestingVision(true);
    setStatusNote('Testando visão multimodal com imagem real nos motores técnicos…');
    try {
      const res = await bridge.cinemaTestVisionProviders({ force: true });
      if (res?.multimodalHealth) {
        setVisionHealthItems(res.multimodalHealth);
        const okLabels = res.multimodalHealth
          .filter((h) => h.multimodalStatus === 'multimodal_available')
          .map((h) => `${h.label}${h.model ? ` (${h.model})` : ''}`);
        setStatusNote(
          okLabels.length > 0
            ? `Visão multimodal confirmada: ${okLabels.join(', ')}.`
            : 'Teste de visão concluído: nenhum provedor respondeu com visão multimodal ativa.',
        );
      }
      await refreshReadiness(activeProject?.chapterId);
    } catch (err) {
      setStatusNote(`Falha no teste de visão: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setTestingVision(false);
    }
  }, [activeProject?.chapterId, refreshReadiness]);

  const refreshMotionVelixStatus = useCallback(async () => {
    const bridge = getRecapBridge();
    if (!bridge?.recapGetMotionVelixStatus) return;
    try {
      setMotionVelixStatus(await bridge.recapGetMotionVelixStatus());
    } catch {
      // keep previous status
    }
  }, []);

  const openProjectDetail = useCallback(
    async (project: RecapProjectRecordView, autoNavigate = true) => {
      setActiveProject(project);
      setWorkTitle(project.workTitle);
      if (project.aspectRatio) setAspectRatio(project.aspectRatio);
      if (project.language === 'pt-BR' || project.language === 'en-US' || project.language === 'es-ES') {
        setLanguage(project.language);
      }
      if (project.scriptStyle) setScriptStyle(project.scriptStyle);
      if (project.ttsProvider) setTtsProvider(project.ttsProvider);
      if (typeof project.humorVolume === 'number') setHumorVolume(project.humorVolume);
      if (typeof project.enableOcr === 'boolean') setEnableOcr(project.enableOcr);
      setStatusNote(project.lastError ?? null);
      setPublishNote(null);

      const bridge = getRecapBridge();
      if (bridge?.recapLoadProject) {
        try {
          const detail = await bridge.recapLoadProject(project.runId);
          if (detail) {
            setActiveProject(detail.record);
            setActiveScript(detail.script);
            setActivePlan(detail.plan);
            setActiveGateG(detail.gateGReport);
            setActiveGateH(detail.gateHReport);
            setScenes(scenesFromScript(detail.script, detail.plan));
            setSelectedShotId(detail.plan?.shots?.[0]?.shotId ?? null);
          }
        } catch {
          // fallback to summary record
        }
      }

      void refreshReadiness(project.chapterId);

      if (autoNavigate) {
        if (project.masterMp4Path || project.previewMp4Path) {
          setSubTab('revisao');
        } else {
          setSubTab('producao');
        }
      }
    },
    [refreshReadiness],
  );

  const refreshStoryMemory = useCallback(async () => {
    const bridge = getRecapBridge();
    if (!bridge?.recapMemoryListProjects) return;
    try {
      const list = await bridge.recapMemoryListProjects();
      setSeriesProjects(Array.isArray(list) ? list : []);
      if (activeSeries) {
        const updated = list.find((p) => p.projectId === activeSeries.projectId);
        if (updated) setActiveSeries(updated);
      } else if (list.length > 0) {
        setActiveSeries(list[0]!);
        const nextCh = (list[0]!.producedChapters[list[0]!.producedChapters.length - 1] ?? 0) + 1;
        setChapterNumber(nextCh);
      }
    } catch {
      // ignore
    }
  }, [activeSeries]);

  const handleCreateSeriesProject = async () => {
    const title = newSeriesTitle.trim();
    if (!title) return;
    const bridge = getRecapBridge();
    if (!bridge?.recapMemoryCreateProject) return;
    try {
      const created = await bridge.recapMemoryCreateProject({
        workTitle: title,
        defaultScriptStyle: 'natural_recap',
      });
      setNewSeriesTitle('');
      setActiveSeries(created);
      setWorkTitle(created.workTitle);
      setChapterNumber((created.producedChapters[created.producedChapters.length - 1] ?? 0) + 1);
      await refreshStoryMemory();
      setStatusNote(`Projeto de memória "${created.workTitle}" criado/carregado.`);
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    }
  };

  const handleSaveCharacterCorrection = async (characterId: string) => {
    const bridge = getRecapBridge();
    if (!bridge?.recapMemoryCorrectCharacter || !activeSeries || !editingCharName.trim()) return;
    try {
      const aliases = editingCharAliases
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      const updated = await bridge.recapMemoryCorrectCharacter({
        projectId: activeSeries.projectId,
        characterId,
        primaryName: editingCharName.trim(),
        nameStatus: 'confirmed',
        addAliases: aliases,
        reason: 'Correção manual na aba Universo da História',
      });
      setActiveSeries(updated);
      setSeriesProjects((prev) => prev.map((p) => (p.projectId === updated.projectId ? updated : p)));
      setEditingCharId(null);
      setStatusNote(`Identidade de ${characterId} atualizada para "${editingCharName.trim()}" e protegida para futuros capítulos.`);
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    }
  };

  const handleResolveMemoryUpdate = async (updateId: string, decision: 'approved' | 'rejected') => {
    const bridge = getRecapBridge();
    if (!bridge?.recapMemoryResolveUpdate || !activeSeries) return;
    try {
      const updated = await bridge.recapMemoryResolveUpdate({
        projectId: activeSeries.projectId,
        updateId,
        decision,
      });
      setActiveSeries(updated);
      setSeriesProjects((prev) => prev.map((p) => (p.projectId === updated.projectId ? updated : p)));
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    }
  };

  // Initial load: projects, MotionVelix kit, readiness, Story Memory
  useEffect(() => {
    void (async () => {
      const [list] = await Promise.all([
        refreshProjects(),
        refreshMotionVelixStatus(),
        refreshReadiness(),
        refreshStoryMemory(),
      ]);
      // Only auto-bind the latest project if it is not a failed run; failed runs remain preserved in "Projetos Recentes" history without contaminating a new chapter import session.
      const latestNonFailed = list.find((p) => p.state !== 'failed');
      if (latestNonFailed && !activeProject) {
        await openProjectDetail(latestNonFailed, false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe to real-time production progress events from Electron main process
  useEffect(() => {
    const bridge = getRecapBridge();
    if (!bridge?.onRecapProductionProgress) return;
    return bridge.onRecapProductionProgress((raw) => {
      const ev = raw as RecapProgressEventPayload;
      if (!ev?.runId || !ev.record) return;
      setActiveProject(ev.record);
      setStatusNote(ev.message);
      setPersistedProjects((prev) => mergeActiveProjectIntoRecentList(prev, ev.record));
    });
  }, []);

  // Escape key closes delete confirmation modal
  useEffect(() => {
    if (!pendingDeleteProject) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !deletingProjectId) setPendingDeleteProject(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pendingDeleteProject, deletingProjectId]);

  // ─── Actions ─────────────────────────────────────────────────────────────

  const handleNewProject = () => {
    setActiveProject(null);
    setActiveScript(null);
    setActivePlan(null);
    setActiveGateG(null);
    setActiveGateH(null);
    setScenes([]);
    setSelectedShotId(null);
    setImpactPlan(null);
    setStatusNote(null);
    setPublishNote(null);
    setImportError(null);
    setWorkTitle('');
    setSelectedFiles([]);
    setCdnResult(null);
    setLinkImportedCbz(null);
    setSubTab('capitulos');
  };

  const confirmDeleteProject = async () => {
    const target = pendingDeleteProject;
    if (!target) return;
    const bridge = getRecapBridge();
    if (!bridge?.recapDeleteProject) {
      setStatusNote('IPC recap:delete-project indisponível neste build.');
      setPendingDeleteProject(null);
      return;
    }
    setDeletingProjectId(target.runId);
    try {
      const result = await bridge.recapDeleteProject(target.runId);
      if (result.ok) {
        setPersistedProjects((prev) => prev.filter((p) => p.runId !== target.runId));
        if (activeProject?.runId === target.runId) {
          setActiveProject(null);
          setActiveScript(null);
          setActivePlan(null);
          setActiveGateG(null);
          setActiveGateH(null);
          setScenes([]);
          setSelectedShotId(null);
          setImpactPlan(null);
        }
        setStatusNote(`Projeto "${target.workTitle}" removido permanentemente.`);
        void refreshProjects();
      } else {
        setStatusNote(result.error ?? 'Não foi possível excluir o projeto.');
      }
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingProjectId(null);
      setPendingDeleteProject(null);
    }
  };

  /**
   * Clears stale import errors and detaches any historical failed production record
   * when a new chapter archive is successfully imported, keeping the failed run in
   * `persistedProjects` ("Projetos Recentes") without contaminating the current session.
   */
  const clearStaleFailureOnSuccessfulImport = useCallback(() => {
    setImportError(null);
    setActiveProject((prev) => {
      if (prev && prev.state === 'failed') {
        setActiveScript(null);
        setActivePlan(null);
        setActiveGateG(null);
        setActiveGateH(null);
        setScenes([]);
        setSelectedShotId(null);
        return null;
      }
      return prev;
    });
  }, []);

  const handleSelectFiles = async () => {
    const bridge = getRecapBridge();
    if (!bridge?.recapSelectArchives) {
      setImportError('Seletor de arquivos disponível apenas no Aethera Desktop.');
      return;
    }
    const result = await bridge.recapSelectArchives();
    if (!result.canceled && result.files.length > 0) {
      setSelectedFiles(result.files);
      clearStaleFailureOnSuccessfulImport();
      if (!workTitle.trim() && result.files[0]) {
        setWorkTitle(result.files[0].name.replace(/\.(cbz|pdf)$/i, ''));
      }
    }
  };

  const refreshFirecrawlStatus = useCallback(async () => {
    const bridge = getRecapBridge();
    if (!bridge?.recapFirecrawlStatus) return;
    setFirecrawlChecking(true);
    try {
      const status = await bridge.recapFirecrawlStatus();
      setFirecrawlStatus(status);
      setFirecrawlEndpointInput(status.apiUrl);
    } catch {
      // non-fatal
    } finally {
      setFirecrawlChecking(false);
    }
  }, []);

  const handleSaveFirecrawlConfig = async (nextEnabled?: boolean) => {
    const bridge = getRecapBridge();
    if (!bridge?.recapFirecrawlConfig) return;
    setFirecrawlChecking(true);
    setImportError(null);
    try {
      const updated = await bridge.recapFirecrawlConfig({
        apiUrl: firecrawlEndpointInput.trim() || 'http://127.0.0.1:3002',
        ...(typeof nextEnabled === 'boolean' ? { enabled: nextEnabled } : {}),
      });
      setFirecrawlStatus(updated);
      setFirecrawlEndpointInput(updated.apiUrl);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setFirecrawlChecking(false);
    }
  };

  useEffect(() => {
    if (origin === 'link' && !firecrawlStatus) {
      void refreshFirecrawlStatus();
    }
  }, [origin, firecrawlStatus, refreshFirecrawlStatus]);

  const applySelectedChaptersForProduction = useCallback(
    async (cbzPaths: string[], fallbackLabel?: string) => {
      const cleaned = [...new Set(cbzPaths.map((p) => (p ?? '').trim()).filter(Boolean))];
      setSelectedChapterCbzPaths(cleaned);
      if (cleaned.length === 0) {
        setLinkImportedCbz(null);
        return;
      }
      if (cleaned.length === 1) {
        setLinkImportedCbz({
          cbzPath: cleaned[0]!,
          label: fallbackLabel || '1 capítulo selecionado',
        });
        return;
      }
      const bridge = getRecapBridge();
      if (!bridge?.recapMergeChapterArchives) {
        setLinkImportedCbz({
          cbzPath: cleaned[0]!,
          label: `${cleaned.length} capítulos selecionados`,
        });
        return;
      }
      setMergingChapters(true);
      setImportError(null);
      try {
        const effectiveTitle = workTitle.trim() || activeSeries?.workTitle || activeProject?.workTitle || undefined;
        const merged = await bridge.recapMergeChapterArchives({
          archivePaths: cleaned,
          ...(effectiveTitle ? { workTitle: effectiveTitle } : {}),
        });
        setLinkImportedCbz({
          cbzPath: merged.archivePath,
          label: merged.label,
        });
        if (!workTitle.trim() && merged.workTitle) {
          const firstCh = merged.chapterNumbers[0] ?? '1';
          const lastCh = merged.chapterNumbers[merged.chapterNumbers.length - 1] ?? String(merged.chapterCount);
          setWorkTitle(`${merged.workTitle} Cap. ${firstCh}-${lastCh}`);
        }
      } catch (err) {
        setImportError(err instanceof Error ? err.message : String(err));
      } finally {
        setMergingChapters(false);
      }
    },
    [workTitle, activeSeries?.workTitle, activeProject?.workTitle],
  );

  const pollLinkImportJob = async (
    bridge: NonNullable<ReturnType<typeof getRecapBridge>>,
    initialJob: {
      id: string;
      status: string;
      items: Array<{ url: string; status: string; pagesDone: number; pagesTotal: number; libraryEntry?: { cbzPath: string }; error?: string }>;
    },
  ) => {
    let current = initialJob;
    setLinkImportJob(current);
    const maxPolls = Math.max(120, current.items.length * 90);
    for (let attempt = 0; attempt < maxPolls; attempt++) {
      if (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled') {
        break;
      }
      await new Promise((r) => setTimeout(r, 700));
      const polled = await bridge.recapImportGetJob?.(current.id);
      if (!polled) break;
      current = polled;
      setLinkImportJob(current);
    }

    const readyItems = current.items.filter((it) => it.libraryEntry?.cbzPath);
    if (readyItems.length > 0) {
      const firstReady = readyItems[0]!;
      const totalPages = firstReady.pagesTotal || firstReady.pagesDone || 0;
      const donePages = firstReady.pagesDone || totalPages;
      clearStaleFailureOnSuccessfulImport();
      const allReadyPaths = readyItems.map((it) => it.libraryEntry!.cbzPath);
      if (allReadyPaths.length > 1) {
        await applySelectedChaptersForProduction(allReadyPaths);
      } else {
        setSelectedChapterCbzPaths(allReadyPaths);
        setLinkImportedCbz({
          cbzPath: firstReady.libraryEntry!.cbzPath,
          label:
            totalPages > 0
              ? `${donePages}/${totalPages} páginas importadas`
              : 'Capítulo importado e validado',
        });
      }
      if (!workTitle.trim()) {
        const slug = firstReady.libraryEntry!.cbzPath.split(/[/\\]/).pop()?.replace(/\.cbz$/i, '') ?? '';
        if (slug) setWorkTitle(slug);
      }
    }
    const failedItems = current.items.filter((it) => it.error);
    if (failedItems.length > 0 && readyItems.length === 0) {
      setImportError(failedItems[0]!.error ?? 'Não foi possível importar o capítulo a partir do link informado.');
    }
  };

  const handleStartInteractiveImport = async (urlsToImport: string[]) => {
    const bridge = getRecapBridge();
    if (!bridge?.recapInteractiveStart || !bridge?.recapInteractiveStatus) {
      setImportError('Sessão interativa com navegador persistente indisponível neste build.');
      return;
    }
    const cleaned = urlsToImport.map((u) => u.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      setImportError('Informe pelo menos uma URL de capítulo para verificar no navegador.');
      return;
    }
    setImportError(null);
    setInteractiveModalOpen(true);
    try {
      const effectiveTitle = workTitle.trim() || activeSeries?.workTitle || activeProject?.workTitle || undefined;
      const initial = await bridge.recapInteractiveStart({
        urls: cleaned,
        ...(effectiveTitle ? { workTitle: effectiveTitle } : {}),
        ...(activeSeries?.projectId ? { seriesProjectId: activeSeries.projectId } : {}),
      });
      setInteractiveSession(initial);

      const terminal = new Set(['completed', 'access_denied', 'session_expired', 'cancelled']);
      let cur = initial;
      for (let i = 0; i < 600; i++) {
        if (terminal.has(cur.state)) break;
        await new Promise((r) => setTimeout(r, 800));
        const next = await bridge.recapInteractiveStatus(cur.sessionId);
        if (!next) break;
        cur = next;
        setInteractiveSession(cur);
      }

      if (cur.state === 'completed' && cur.importedEntries.length > 0) {
        const first = cur.importedEntries[0]!;
        clearStaleFailureOnSuccessfulImport();
        const allInteractivePaths = cur.importedEntries.map((e) => e.cbzPath);
        if (allInteractivePaths.length > 1) {
          await applySelectedChaptersForProduction(allInteractivePaths);
        } else {
          setSelectedChapterCbzPaths(allInteractivePaths);
          setLinkImportedCbz({
            cbzPath: first.cbzPath,
            label: `${first.pageCount}/${first.pageCount} páginas importadas`,
          });
        }
        setLinkImportJob((prev) =>
          reconcileQueueWithSuccessfulImport(
            prev,
            cur.importedEntries.map((entry, idx) => ({
              ...entry,
              ...(cleaned[idx] ? { sourceUrl: cleaned[idx] } : {}),
            })),
          ),
        );
        if (!workTitle.trim() && first.workTitle) {
          setWorkTitle(
            cur.importedEntries.length > 1
              ? `${first.workTitle} Cap. ${first.chapterNumber}-${cur.importedEntries[cur.importedEntries.length - 1]!.chapterNumber}`
              : first.workTitle,
          );
        }
        setStatusNote(`Sessão interativa concluída: ${cur.importedEntries.length} capítulo(s) pronto(s) em CBZ.`);
      }
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
      setInteractiveModalOpen(false);
    }
  };

  const handleCancelInteractiveImport = async () => {
    const bridge = getRecapBridge();
    if (bridge?.recapInteractiveCancel && interactiveSession?.sessionId) {
      await bridge.recapInteractiveCancel(interactiveSession.sessionId).catch(() => {});
      const snap = await bridge.recapInteractiveStatus?.(interactiveSession.sessionId).catch(() => null);
      if (snap) setInteractiveSession(snap);
    }
  };

  const handleClearInteractiveProfile = async (rawUrl: string) => {
    const bridge = getRecapBridge();
    const cleaned = rawUrl.trim();
    if (!bridge?.recapInteractiveClearProfile || !cleaned) return;
    try {
      const res = await bridge.recapInteractiveClearProfile({ url: cleaned });
      setStatusNote(
        res.cleared
          ? `Sessão encerrada e dados do navegador limpos para o perfil "${res.originKey}".`
          : `Nenhuma sessão persistida encontrada para "${res.originKey}".`,
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleOpenInBrowser = async (urlToOpen: string) => {
    const bridge = getRecapBridge();
    const cleaned = urlToOpen.trim();
    if (!cleaned) {
      setImportError('Informe a URL do capítulo para abrir no navegador.');
      return;
    }
    setImportError(null);
    if (bridge?.recapOpenInBrowser) {
      try {
        await bridge.recapOpenInBrowser({ url: cleaned });
      } catch (err) {
        setImportError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    window.open(cleaned, '_blank', 'noopener,noreferrer');
  };

  const handleAssistedPickAndImport = async (mode: 'files' | 'folder', sourceUrlOverride?: string) => {
    const bridge = getRecapBridge();
    if (!bridge?.recapPickAssistedSources || !bridge?.recapImportAssisted) {
      setImportError('Importação assistida indisponível neste build.');
      return;
    }
    setImportError(null);
    try {
      const picked = await bridge.recapPickAssistedSources({ mode });
      if (picked.canceled || picked.paths.length === 0) return;

      setAssistedImporting(true);
      const effectiveTitle =
        workTitle.trim() ||
        activeSeries?.workTitle ||
        activeProject?.workTitle ||
        'Aethera Recap';
      const sourceUrl = (sourceUrlOverride ?? assistedUrl).trim() || linkImportJob?.blockedUrl || linkInputs[0]?.trim() || undefined;

      const res = await bridge.recapImportAssisted({
        paths: picked.paths,
        workTitle: effectiveTitle,
        chapterNumber: String(chapterNumber),
        ...(sourceUrl ? { sourceUrl } : {}),
        ...(activeSeries?.projectId ? { seriesProjectId: activeSeries.projectId } : {}),
      });
      setAssistedResult(res);
      clearStaleFailureOnSuccessfulImport();
      setLinkImportedCbz({
        cbzPath: res.archivePath,
        label: `Assistida · ${res.pageCount} páginas validadas`,
      });
      setLinkImportJob((prev) =>
        reconcileQueueWithSuccessfulImport(prev, [
          {
            cbzPath: res.archivePath,
            pageCount: res.pageCount,
            ...(sourceUrl ? { sourceUrl } : {}),
          },
        ]),
      );
      if (!workTitle.trim()) {
        setWorkTitle(effectiveTitle);
      }
      setStatusNote(
        `Capítulo importado via fluxo assistido: ${res.pageCount} páginas válidas` +
          (res.duplicatesRemoved > 0 ? ` · ${res.duplicatesRemoved} duplicadas removidas` : '') +
          (res.invalidSkipped > 0 ? ` · ${res.invalidSkipped} inválidas ignoradas` : '') +
          '.',
      );
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setAssistedImporting(false);
    }
  };

  const handleAnalyzeAndReviewUrl = async () => {
    const bridge = getRecapBridge();
    if (!bridge?.recapImportAnalyze) {
      setImportError('Análise estrutural de capítulo indisponível neste build.');
      return;
    }
    const targetUrl = linkInputs.map((u) => u.trim()).find(Boolean) ?? '';
    if (!targetUrl) {
      setImportError('Informe uma URL de capítulo para analisar e revisar as imagens.');
      return;
    }
    setImportError(null);
    setAnalyzedChapterPreview(null);
    setUniversalAnalyzeState('source_recognized');
    await new Promise((r) => setTimeout(r, 80));
    setUniversalAnalyzeState('analyzing_page');

    try {
      const res = await bridge.recapImportAnalyze({ url: targetUrl });
      setUniversalAnalyzeState('chapter_identified');
      setAnalyzedChapterPreview({
        sourceUrl: res.sourceUrl,
        ...(res.adapterId ? { adapterId: res.adapterId } : {}),
        adapterName: res.adapterName || 'Importador Universal Estrutural',
        acquisitionMethodLabel: res.acquisitionMethodLabel || (res.isSpecializedAdapter ? 'Adaptador especializado' : 'Importador universal'),
        formatHint: res.formatHint ?? 'manga_paged',
        verticalStripCount: res.verticalStripCount ?? res.pages.filter((p) => p.isVerticalStrip).length,
        workTitle: res.meta.workTitle,
        chapterNumber: res.meta.chapterNumber,
        pages: res.pages.map((p) => ({
          ...p,
          included: true,
        })),
      });
      if (!workTitle.trim() && res.meta.workTitle) {
        setWorkTitle(res.meta.workTitle);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/import_not_permitted|importa[çc][ãa]o.*n[ãa]o permitida/i.test(msg)) {
        setUniversalAnalyzeState('import_not_permitted');
      } else if (/content_not_recognized|conte[úu]do n[ãa]o reconhecido|no_pages_found|nenhuma p[áa]gina/i.test(msg)) {
        setUniversalAnalyzeState('content_not_recognized');
      } else {
        setUniversalAnalyzeState('idle');
      }
      setImportError(msg);
    }
  };

  const handleConfirmReviewedPagesToCbz = async () => {
    const bridge = getRecapBridge();
    if (!bridge?.recapImportCdnDirect || !analyzedChapterPreview) return;
    const selectedUrls = analyzedChapterPreview.pages.filter((p) => p.included).map((p) => p.imageUrl);
    if (selectedUrls.length === 0) {
      setImportError('Selecione pelo menos uma imagem válida para gerar o CBZ.');
      return;
    }
    setImportError(null);
    setLinkImporting(true);
    setUniversalAnalyzeState('verifying_images');
    try {
      await new Promise((r) => setTimeout(r, 80));
      setUniversalAnalyzeState('importing');
      const res = await bridge.recapImportCdnDirect({
        imageUrls: selectedUrls,
        chapterPageUrl: analyzedChapterPreview.sourceUrl,
        workTitle: workTitle.trim() || analyzedChapterPreview.workTitle,
        chapterNumber: analyzedChapterPreview.chapterNumber,
      });
      clearStaleFailureOnSuccessfulImport();
      setLinkImportedCbz({
        cbzPath: res.cbzPath,
        label: `${res.pageCount} páginas revisadas (${analyzedChapterPreview.acquisitionMethodLabel})`,
      });
      setLinkImportJob((prev) =>
        reconcileQueueWithSuccessfulImport(prev, [
          {
            cbzPath: res.cbzPath,
            pageCount: res.pageCount,
            sourceUrl: analyzedChapterPreview.sourceUrl,
          },
        ]),
      );
      setStatusNote(
        `CBZ criado após revisão de imagens: ${res.workTitle} Cap. ${res.chapterNumber} (${res.pageCount} páginas).`,
      );
      setUniversalAnalyzeState('chapter_identified');
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setLinkImporting(false);
    }
  };

  const handleImportLinkChapters = async () => {
    const bridge = getRecapBridge();
    if (!bridge?.recapImportCreateJob || !bridge?.recapImportGetJob) {
      setImportError('Importação por link indisponível neste build.');
      return;
    }
    const urls = linkInputs.map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) {
      setImportError('Informe pelo menos uma URL de capítulo.');
      return;
    }
    setImportError(null);
    setLinkImporting(true);
    setLinkImportedCbz(null);
    setLinkImportJob(null);
    try {
      const job = await bridge.recapImportCreateJob({ urls });
      await pollLinkImportJob(bridge, job);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setLinkImporting(false);
    }
  };

  const handleCancelLinkImport = async () => {
    const bridge = getRecapBridge();
    if (!bridge?.recapImportCancelJob || !linkImportJob?.id) return;
    try {
      await bridge.recapImportCancelJob(linkImportJob.id);
      const polled = await bridge.recapImportGetJob?.(linkImportJob.id);
      if (polled) setLinkImportJob(polled);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleRetryLinkImport = async () => {
    const bridge = getRecapBridge();
    if (!bridge?.recapImportRetryJob || !bridge?.recapImportGetJob || !linkImportJob?.id) return;
    setImportError(null);
    setLinkImporting(true);
    try {
      await bridge.recapImportRetryJob(linkImportJob.id);
      const polled = await bridge.recapImportGetJob(linkImportJob.id);
      if (polled) await pollLinkImportJob(bridge, polled);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setLinkImporting(false);
    }
  };

  const handleImportCdn = async () => {
    setImportError(null);
    setCdnResult(null);
    const bridge = getRecapBridge();
    if (!bridge?.recapImportCdnDirect) {
      setImportError('IPC recap:import-cdn-direct indisponível.');
      return;
    }
    const urls = cdnImageUrls.split('\n').map((u) => u.trim()).filter(Boolean);
    if (urls.length === 0) {
      setImportError('Cole pelo menos uma URL de imagem.');
      return;
    }
    if (!cdnChapterUrl.trim()) {
      setImportError('Informe a URL do capítulo (referer).');
      return;
    }
    setCdnImporting(true);
    try {
      const cdnInput: { imageUrls: string[]; chapterPageUrl: string; workTitle?: string; chapterNumber?: string } = {
        imageUrls: urls,
        chapterPageUrl: cdnChapterUrl.trim(),
      };
      if (cdnWorkTitle.trim()) cdnInput.workTitle = cdnWorkTitle.trim();
      if (cdnChapterNumber.trim()) cdnInput.chapterNumber = cdnChapterNumber.trim();
      const res = await bridge.recapImportCdnDirect(cdnInput);
      clearStaleFailureOnSuccessfulImport();
      setCdnResult(res);
      if (!workTitle.trim() && res.workTitle) setWorkTitle(res.workTitle);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setCdnImporting(false);
    }
  };

  const handleStart = async (resumeCheckpoint: boolean) => {
    const bridge = getRecapBridge();
    if (!bridge?.recapStartProduction) {
      setStatusNote('IPC recap:start-production não conectado.');
      return;
    }
    setImportError(null);
    const archivePath = resolvedArchivePath;
    if (!archivePath) {
      setImportError('Selecione um arquivo CBZ/PDF ou conclua a importação por Link/CDN antes de iniciar.');
      setSubTab('capitulos');
      return;
    }

    const effectiveTitle =
      workTitle.trim() ||
      selectedFiles[0]?.name.replace(/\.(cbz|pdf)$/i, '') ||
      activeProject?.workTitle ||
      'Aethera Recap';

    setIsSubmitting(true);
    setStatusNote(`Iniciando produção real de "${effectiveTitle}"…`);

    try {
      const multiArchivePaths =
        origin === 'cbz' && selectedFiles.length > 1
          ? selectedFiles.map((f) => f.path)
          : origin === 'link' && selectedChapterCbzPaths.length > 1
            ? selectedChapterCbzPaths
            : undefined;

      const res = await bridge.recapStartProduction({
        ...(resumeCheckpoint && activeProject?.runId ? { runId: activeProject.runId } : {}),
        archivePath,
        ...(multiArchivePaths ? { archivePaths: multiArchivePaths } : {}),
        workTitle: effectiveTitle,
        language,
        scriptStyle,
        aspectRatio,
        ttsProvider,
        humorVolume,
        enableOcr,
        resumeCheckpoint,
        ...(activeSeries ? { seriesProjectId: activeSeries.projectId, chapterNumber } : {}),
      });

      setStatusNote(res.message);
      if (res.record) setActiveProject(res.record);
      if (res.script) {
        setActiveScript(res.script);
        setScenes(scenesFromScript(res.script, res.plan ?? null));
      }
      if (res.plan) {
        setActivePlan(res.plan);
        setSelectedShotId(res.plan.shots?.[0]?.shotId ?? null);
      }
      if (res.gateGReport) setActiveGateG(res.gateGReport);
      if (res.gateHReport) setActiveGateH(res.gateHReport);

      await Promise.all([refreshProjects(), refreshReadiness(res.chapterId)]);

      if (res.previewMp4Path || res.masterMp4Path) {
        setSubTab('revisao');
      }
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
      await refreshProjects();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprovePreview = async () => {
    const bridge = getRecapBridge();
    if (!bridge?.recapApprovePreview || !activeProject?.runId) {
      setStatusNote('Nenhum projeto ativo com prévia pronta para aprovar.');
      return;
    }
    setIsApproving(true);
    setStatusNote('Exportando Master 1080p com MotionVelix + FFmpeg e gerando pacote de entrega…');
    try {
      const res = await bridge.recapApprovePreview({ runId: activeProject.runId });
      setStatusNote(res.message);
      if (res.record) setActiveProject(res.record);
      if (res.plan) setActivePlan(res.plan);
      if (res.gateHReport) setActiveGateH(res.gateHReport);
      await refreshProjects();
      if (res.ok) setSubTab('revisao');
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    } finally {
      setIsApproving(false);
    }
  };

  const handleSaveSceneEdit = async (sceneId: string, narrationText: string) => {
    const bridge = getRecapBridge();
    if (!bridge?.recapSaveSceneEdit || !activeProject?.runId) {
      setStatusNote('Edição mantida em memória (IPC recap:save-scene-edit indisponível).');
      return;
    }
    setSavingSceneId(sceneId);
    try {
      const res = await bridge.recapSaveSceneEdit({
        runId: activeProject.runId,
        sceneId,
        narrationText,
      });
      if (!res.ok) {
        setStatusNote(res.message ?? 'Não foi possível salvar a edição da cena.');
        return;
      }
      if (res.record) setActiveProject(res.record);
      if (res.script) {
        setActiveScript(res.script);
        setScenes(scenesFromScript(res.script, activePlan));
      }
      if (res.gateGReport) setActiveGateG(res.gateGReport);
      setStatusNote(`Narração da cena ${sceneId} salva e auditada pelo Gate G.`);
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingSceneId(null);
    }
  };

  const handleRegenerateScene = async (sceneId: string) => {
    const bridge = getRecapBridge();
    if (!bridge?.recapRegenerateScene || !activeProject?.runId) {
      setStatusNote('IPC recap:regenerate-scene indisponível neste build.');
      return;
    }
    setRegeneratingSceneId(sceneId);
    setStatusNote(`Reanalisando painéis e regenerando a cena ${sceneId}…`);
    try {
      const res = await bridge.recapRegenerateScene({
        runId: activeProject.runId,
        sceneId,
      });
      setStatusNote(res.message ?? (res.ok ? `Cena ${sceneId} regenerada.` : 'Falha ao regenerar cena.'));
      if (res.record) setActiveProject(res.record);
      if (res.script) {
        setActiveScript(res.script);
        setScenes(scenesFromScript(res.script, activePlan));
      }
      if (res.gateGReport) setActiveGateG(res.gateGReport);
    } catch (err) {
      setStatusNote(err instanceof Error ? err.message : String(err));
    } finally {
      setRegeneratingSceneId(null);
    }
  };

  const handleRegenerateScript = async (invalidateCache = false) => {
    const bridge = getRecapBridge();
    if (!bridge?.recapRegenerateScript || !activeProject?.runId) {
      const msg = 'IPC recap:regenerate-script indisponível ou nenhum projeto salvo selecionado.';
      setStatusNote(msg);
      setRegenerateFeedback({ ok: false, message: msg });
      return;
    }
    setRegeneratingScript(true);
    setRegenerateFeedback(null);
    setStatusNote(
      invalidateCache
        ? 'Reanalisando painéis e regenerando o roteiro completo…'
        : 'Regenerando o roteiro com as análises visuais salvas e continuidade narrativa…',
    );
    try {
      const res = await bridge.recapRegenerateScript({
        runId: activeProject.runId,
        invalidateCache,
      });
      const msg = res.message ?? (res.ok ? 'Roteiro completo regenerado.' : 'Falha ao regenerar roteiro.');
      setStatusNote(msg);
      setRegenerateFeedback({ ok: Boolean(res.ok), message: msg });
      if (res.record) setActiveProject(res.record);
      if (res.script) {
        setActiveScript(res.script);
        setScenes(scenesFromScript(res.script, activePlan));
      }
      if (res.gateGReport) setActiveGateG(res.gateGReport);
      await refreshProjects();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatusNote(msg);
      setRegenerateFeedback({ ok: false, message: msg });
    } finally {
      setRegeneratingScript(false);
    }
  };

  const handlePlanRevision = async (promptText?: string) => {
    const text = (promptText ?? revisionPrompt).trim();
    if (!text) return;
    setRevisionPrompt(text);
    const bridge = getRecapBridge();
    if (!bridge?.recapPlanRevision) {
      setStatusNote('IPC recap:plan-revision indisponível.');
      return;
    }
    const scriptPayload = activeScript ?? {
      chapterId: activeProject?.chapterId ?? (workTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'recap'),
      title: workTitle || activeProject?.workTitle || 'Recap',
      scenes: scenes.map((s) => ({ sceneId: s.sceneId, narrationText: s.narrationText, panelIds: [s.panelId] })),
    };
    const panelIds = [...new Set(activePlan?.shots.map((s) => s.panelId) ?? scenes.map((s) => s.panelId).filter((id) => id !== '—'))];
    const planRes = await bridge.recapPlanRevision({
      prompt: text,
      script: scriptPayload,
      ...(panelIds.length > 0 ? { availablePanelIds: panelIds } : {}),
    });
    setImpactPlan(planRes);
  };

  const handleSchedulePublication = async () => {
    if (!activeProject || !activeMediaPath) {
      setPublishNote('Renderize e aprove o vídeo antes de agendar.');
      return;
    }
    if (!scorecard.approvedForRelease) {
      setPublishNote('Os Gates de qualidade obrigatórios (Gate F/G/H) ainda não foram aprovados para publicação.');
      return;
    }
    if (!publishRightsConfirmed) {
      setPublishNote('Confirme a verificação de direitos de uso do material antes de autorizar o agendamento.');
      return;
    }
    if (!scheduleDate) {
      setPublishNote('Escolha uma data e hora de publicação.');
      return;
    }
    const bridge = getRecapBridge();
    if (!bridge?.cinemaPublishingSchedule) {
      setPublishNote('Integração de publicação unificada indisponível neste build.');
      return;
    }
    try {
      const targetIso = new Date(scheduleDate).toISOString();
      const res = await bridge.cinemaPublishingSchedule({
        publicationId: `recap_${activeProject.runId}`,
        title: activeProject.workTitle,
        description: activeProject.exportBundleDir
          ? `Mangá Recap — ${activeProject.workTitle} (Pacote: ${activeProject.exportBundleDir})`
          : `Mangá Recap — ${activeProject.workTitle}`,
        channelId: 'main_yt',
        channelName: 'Canal Principal',
        productionMode: 'manga_recap',
        format: activeProject.aspectRatio === '9:16' ? 'short' : 'long',
        projectId: activeProject.runId,
        videoPath: activeMediaPath,
        videoDurationMs: activeProject.totalDurationMs,
        platforms: publishPlatforms.length > 0 ? publishPlatforms : ['youtube'],
        scheduledPublishAtIso: targetIso,
        timezone: 'America/Sao_Paulo',
        status: 'scheduled',
        reviewApproved: true,
        qualityGates: {
          gateF: scorecard.gateFVerdict ?? 'pass',
          gateG: scorecard.gateGVerdict ?? 'pass',
          gateH: scorecard.gateHVerdict ?? 'pass',
          allMandatoryPassed: scorecard.approvedForRelease,
        },
        rightsVerification: {
          verified: publishRightsConfirmed,
          verifiedAtIso: new Date().toISOString(),
          sourceAuthorized: true,
          musicAndSfxLicensed: true,
          noProhibitedWatermarks: true,
          transformativeEditorialUse: true,
        },
        recapBinding: {
          runId: activeProject.runId,
          ...(selectedSeriesId ? { seriesProjectId: selectedSeriesId } : {}),
          workTitle: activeProject.workTitle,
          chapterNumbers: [chapterNumberInput],
          singleVideoMode: selectedQueueArchives.length > 1,
        },
      });
      setPublishNote(
        `Agendado no Calendário Unificado (${publishPlatforms.join(', ')}) para ${formatDateTimePt(targetIso)} · ID ${res.event.id}.`,
      );
    } catch (err) {
      setPublishNote(err instanceof Error ? err.message : 'Erro ao agendar no calendário.');
    }
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', color: T.ink, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top Studio Header */}
      <BentoBlock style={{ padding: '20px 24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <SectionLabel>Aethera Studio · Mangá Recap</SectionLabel>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.025em', margin: 0, color: T.ink }}>
              {activeProject ? activeProject.workTitle : 'Mangá Recap'}
            </h1>
            <p style={{ fontSize: 13, color: T.inkMuted, margin: '6px 0 0', lineHeight: 1.5 }}>
              {activeProject
                ? `Projeto atual · ID ${activeProject.runId} · Atualizado em ${formatDateTimePt(activeProject.updatedAtIso)}`
                : 'Importe capítulos CBZ/PDF, Links ou CDN, produza com MotionVelix + TTS real e valide nos Release Gates.'}
            </p>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <button type="button" onClick={handleNewProject} style={btnSecondary}>
              <Plus style={{ width: 14, height: 14 }} /> Novo Projeto
            </button>
            {activeProject && (
              <button
                type="button"
                onClick={() => setPendingDeleteProject(activeProject)}
                style={{ ...btnSecondary, color: T.error, borderColor: T.errorBorder }}
              >
                <Trash2 style={{ width: 14, height: 14 }} /> Excluir Projeto
              </button>
            )}
          </div>
        </div>

        {/* MotionVelix Engine Verification Strip */}
        <div
          style={{
            marginTop: 16,
            paddingTop: 14,
            borderTop: `1px solid ${T.border}`,
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: T.radiusSm,
                background: motionVelixStatus?.installed ? T.limeSoft : T.warningBg,
                border: `1px solid ${motionVelixStatus?.installed ? '#c3e85a' : T.warningBorder}`,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              <Wand2 style={{ width: 16, height: 16, color: motionVelixStatus?.installed ? T.success : T.warning }} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 700, color: T.ink }}>
                <span>Motor de Edição: MotionVelix + FFmpeg Híbrido</span>
                <span
                  style={{
                    fontFamily: T.mono,
                    fontSize: 11,
                    fontWeight: 600,
                    color: motionVelixStatus?.installed ? T.success : T.warning,
                  }}
                >
                  {motionVelixStatus
                    ? motionVelixStatus.installed
                      ? `Kit ativo (${motionVelixStatus.availableSfx.length}/5 SFX)`
                      : 'Kit SFX ausente'
                    : 'Verificando kit…'}
                </span>
                {activeProject?.motionVelix && (
                  <span style={{ fontFamily: T.mono, fontSize: 11, color: T.inkMuted }}>
                    · Último render: {activeProject.motionVelix.sfxApplied}/{activeProject.motionVelix.sfxPlanned} SFX · {activeProject.motionVelix.vfxAppliedShots} VFX · {activeProject.motionVelix.transitionsApplied} transições
                  </span>
                )}
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 11, color: T.inkMuted }}>
                {motionVelixStatus?.sfxDir
                  ? `SFX MotionVelix: ${motionVelixStatus.sfxDir}`
                  : motionVelixStatus?.summary ?? 'Detectando diretório do kit MotionVelix…'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => void refreshMotionVelixStatus()}
              style={{ ...btnGhost, border: `1px solid ${T.border}` }}
              title="Reverificar kit MotionVelix"
            >
              <RefreshCw style={{ width: 12, height: 12 }} /> Verificar Kit
            </button>
            <a
              href="#/video/remotion"
              style={{
                ...btnGhost,
                border: `1px solid ${T.border}`,
                textDecoration: 'none',
                color: T.ink,
              }}
            >
              MotionVelix Studio <ExternalLink style={{ width: 12, height: 12 }} />
            </a>
            <a
              href="#/video"
              style={{
                ...btnGhost,
                border: `1px solid ${T.border}`,
                textDecoration: 'none',
                color: T.ink,
              }}
            >
              Editor Multifaixa <ExternalLink style={{ width: 12, height: 12 }} />
            </a>
          </div>
        </div>
      </BentoBlock>

      {/* Recent Projects (Always includes Current Project + Latest Persisted Projects) */}
      <BentoBlock>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <div>
            <SectionLabel>Projetos Recentes ({recentProjects.length})</SectionLabel>
            <p style={{ margin: 0, fontSize: 12, color: T.inkMuted }}>
              Exibe o projeto atual e todas as produções salvas em ordem da mais recente para a mais antiga.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refreshProjects()}
            disabled={projectsLoading}
            style={{ ...btnGhost, border: `1px solid ${T.border}` }}
          >
            <RefreshCw className={projectsLoading ? 'animate-spin' : undefined} style={{ width: 13, height: 13 }} />
            {projectsLoading ? 'Atualizando…' : 'Atualizar'}
          </button>
        </div>

        {recentProjects.length === 0 ? (
          <div
            style={{
              padding: '22px 16px',
              borderRadius: T.radiusInner,
              background: T.surfaceSubtle,
              border: `1px dashed ${T.borderStrong}`,
              textAlign: 'center',
            }}
          >
            <FolderOpen style={{ width: 22, height: 22, color: T.inkSubtle, margin: '0 auto 8px' }} />
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: T.ink }}>
              Nenhum projeto Mangá Recap salvo ainda
            </p>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: T.inkMuted }}>
              Importe um arquivo CBZ/PDF ou link abaixo e clique em Iniciar Produção — ele aparecerá aqui imediatamente.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(290px, 1fr))', gap: 12 }}>
            {recentProjects.map((project) => {
              const isCurrent = activeProject?.runId === project.runId;
              const isDeleting = deletingProjectId === project.runId;
              const derived = derivePipelineTimeline(project);
              const meta = getStateMetadata(project.state);
              const c = toneColors(meta.tone);

              return (
                <div
                  key={project.runId}
                  onClick={() => !isDeleting && void openProjectDetail(project)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if ((e.key === 'Enter' || e.key === ' ') && !isDeleting) {
                      e.preventDefault();
                      void openProjectDetail(project);
                    }
                  }}
                  style={{
                    padding: 14,
                    borderRadius: T.radiusInner,
                    border: isCurrent ? `2px solid ${T.ink}` : `1px solid ${T.border}`,
                    background: isCurrent ? '#fbfbfe' : T.surface,
                    cursor: isDeleting ? 'default' : 'pointer',
                    opacity: isDeleting ? 0.5 : 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                    transition: 'border-color 150ms ease, background-color 150ms ease',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        {isCurrent && !separatedStatus.isHistoricalFailedRecord ? (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              letterSpacing: '0.06em',
                              textTransform: 'uppercase',
                              color: T.ink,
                              background: T.lime,
                              padding: '2px 7px',
                              borderRadius: 6,
                            }}
                          >
                            Atual
                          </span>
                        ) : project.state === 'failed' ? (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 600,
                              letterSpacing: '0.05em',
                              textTransform: 'uppercase',
                              color: T.inkMuted,
                              background: T.surfaceSubtle,
                              border: `1px solid ${T.border}`,
                              padding: '2px 7px',
                              borderRadius: 6,
                            }}
                          >
                            Tentativa anterior
                          </span>
                        ) : null}
                        <span style={{ fontSize: 11, fontWeight: 600, color: c.fg }}>
                          {meta.label}
                        </span>
                      </div>
                      <p
                        style={{
                          margin: 0,
                          fontSize: 14,
                          fontWeight: 700,
                          color: T.ink,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {project.workTitle}
                      </p>
                      <div
                        style={{
                          marginTop: 4,
                          fontSize: 11,
                          color: T.inkSubtle,
                          fontFamily: T.mono,
                          fontVariantNumeric: 'tabular-nums',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: 8,
                        }}
                      >
                        <span>{formatDateTimePt(project.updatedAtIso)}</span>
                        {project.totalDurationMs ? <span>· {formatTimecodeMs(project.totalDurationMs)}</span> : null}
                        {project.motionVelix ? (
                          <span>· SFX {project.motionVelix.sfxApplied}/{project.motionVelix.sfxPlanned}</span>
                        ) : null}
                      </div>
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDeleteProject(project);
                      }}
                      disabled={isDeleting}
                      title={`Excluir ${project.workTitle}`}
                      aria-label={`Excluir projeto ${project.workTitle}`}
                      style={{
                        ...btnGhost,
                        padding: 6,
                        color: T.error,
                        border: `1px solid transparent`,
                      }}
                    >
                      <Trash2 style={{ width: 15, height: 15 }} />
                    </button>
                  </div>

                  {/* Real progress bar */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ flex: 1, height: 5, borderRadius: T.radiusFull, background: T.surfaceSubtle, overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${derived.overallProgressPct}%`,
                          background: meta.tone === 'error' ? T.error : meta.tone === 'success' ? T.success : T.ink,
                          borderRadius: T.radiusFull,
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        fontFamily: T.mono,
                        fontVariantNumeric: 'tabular-nums',
                        color: T.inkMuted,
                      }}
                    >
                      {derived.completedCount}/{derived.totalCount}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </BentoBlock>

      {/* Separated Import Status vs General Production Status Strip (Requirement 4 & 9) */}
      <div
        role="region"
        aria-label="Status separado de importação e produção"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 12,
        }}
      >
        {(() => {
          const impTone = toneColors(separatedStatus.importStatus.tone);
          const prodTone = toneColors(separatedStatus.productionStatus.tone);
          return (
            <>
              <div
                style={{
                  padding: '14px 18px',
                  borderRadius: T.radiusInner,
                  background: T.surface,
                  border: `1px solid ${impTone.border}`,
                  boxShadow: T.shadow,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.inkMuted }}>
                    Status da Importação (CBZ / Capítulo)
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginTop: 3 }}>
                    {separatedStatus.importStatus.label}
                  </div>
                  <div style={{ fontSize: 12, color: T.inkMuted, marginTop: 2 }}>
                    {separatedStatus.importStatus.detail}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '4px 10px',
                    borderRadius: T.radiusFull,
                    background: impTone.bg,
                    border: `1px solid ${impTone.border}`,
                    color: impTone.fg,
                    flexShrink: 0,
                  }}
                >
                  {separatedStatus.importStatus.state === 'validated'
                    ? 'CBZ Pronto'
                    : separatedStatus.importStatus.state === 'importing'
                      ? 'Em andamento'
                      : separatedStatus.importStatus.state === 'error'
                        ? 'Requer atenção'
                        : 'Pendente'}
                </span>
              </div>

              <div
                style={{
                  padding: '14px 18px',
                  borderRadius: T.radiusInner,
                  background: T.surface,
                  border: `1px solid ${prodTone.border}`,
                  boxShadow: T.shadow,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: T.inkMuted }}>
                    Status Geral da Produção (Pipeline)
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: T.ink, marginTop: 3 }}>
                    {separatedStatus.productionStatus.label}
                  </div>
                  <div style={{ fontSize: 12, color: T.inkMuted, marginTop: 2 }}>
                    {separatedStatus.productionStatus.detail}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '4px 10px',
                    borderRadius: T.radiusFull,
                    background: prodTone.bg,
                    border: `1px solid ${prodTone.border}`,
                    color: prodTone.fg,
                    flexShrink: 0,
                  }}
                >
                  {separatedStatus.productionStatus.state === 'ready_to_start'
                    ? 'Liberado'
                    : separatedStatus.productionStatus.state === 'running'
                      ? 'Executando'
                      : separatedStatus.productionStatus.state === 'completed'
                        ? 'Finalizado'
                        : separatedStatus.productionStatus.state === 'failed'
                          ? 'Falhou'
                          : 'Aguardando'}
                </span>
              </div>
            </>
          );
        })()}
      </div>

      {/* 8-Stage Workflow Stepper (UX/UI Pro Max + Apple Design Translucent Chrome) */}
      <RecapWorkflowStepper steps={workflowSteps} activeStep={subTab} onSelectStep={setSubTab} />

      {/* ─── STEP 2: CAPÍTULOS (IMPORT CBZ / PDF / URL) ─────────────────── */}
      {subTab === 'capitulos' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <BentoBlock>
            <SectionLabel>Origem dos Capítulos</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
              {(
                [
                  ['cbz', 'Arquivo Local (CBZ / PDF)', 'Selecione capítulos já baixados no computador', Upload],
                  ['assisted', 'Importação Assistida', 'Abra no navegador e traga WEBP, PNG, JPG, pasta, ZIP, CBZ ou PDF', ExternalLink],
                  ['link', 'Link de Capítulo', 'Baixa de sites acessíveis (com Firecrawl Local ou direto)', LinkIcon],
                  ['cdn', 'CDN Direto (URLs)', 'Importa lista direta de URLs de páginas', Download],
                ] as const
              ).map(([id, label, desc, Icon]) => {
                const selected = origin === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setOrigin(id)}
                    style={{
                      textAlign: 'left',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                      padding: 16,
                      borderRadius: T.radiusInner,
                      border: selected ? `2px solid ${T.ink}` : `1px solid ${T.border}`,
                      background: selected ? T.accentSoft : T.surfaceSubtle,
                      color: T.ink,
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    <Icon style={{ width: 18, height: 18, color: selected ? T.accent : T.inkMuted }} />
                    <span style={{ fontSize: 13, fontWeight: 700 }}>{label}</span>
                    <span style={{ fontSize: 12, color: T.inkMuted, lineHeight: 1.4 }}>{desc}</span>
                  </button>
                );
              })}
            </div>
          </BentoBlock>

          {origin === 'cbz' && (
            <BentoBlock>
              <SectionLabel>Arquivos Selecionados</SectionLabel>
              <button
                type="button"
                onClick={() => void handleSelectFiles()}
                style={{
                  ...btnSecondary,
                  width: '100%',
                  borderStyle: 'dashed',
                  padding: '22px 16px',
                  borderRadius: T.radiusInner,
                }}
              >
                <Upload style={{ width: 16, height: 16 }} />
                Selecionar arquivos (.cbz, .pdf)
              </button>
              {selectedFiles.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {selectedFiles.map((file, idx) => (
                    <div
                      key={file.path}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 12px',
                        borderRadius: T.radiusSm,
                        background: T.surfaceSubtle,
                        border: `1px solid ${T.border}`,
                        fontSize: 13,
                      }}
                    >
                      <span style={{ flex: 1, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {idx + 1}. {file.name}
                      </span>
                      <span style={{ fontFamily: T.mono, fontSize: 12, color: T.inkMuted }}>
                        {formatBytes(file.sizeBytes)}
                      </span>
                      <button
                        type="button"
                        onClick={() => setSelectedFiles(selectedFiles.filter((_, i) => i !== idx))}
                        style={{ ...btnGhost, color: T.error, padding: 4 }}
                        aria-label={`Remover ${file.name}`}
                      >
                        <X style={{ width: 14, height: 14 }} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </BentoBlock>
          )}

          {origin === 'assisted' && (
            <BentoBlock>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <SectionLabel>Importação Assistida pelo Navegador</SectionLabel>
                <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: T.radiusFull, background: T.accentSoft, color: T.accentInk }}>
                  Sem bypass · 100% compatível com Story Memory
                </span>
              </div>
              <p style={{ margin: '0 0 14px', fontSize: 12, color: T.inkMuted, lineHeight: 1.55 }}>
                Para sites com proteção Cloudflare/login, abra o capítulo normalmente no seu navegador conforme as permissões do site e traga as imagens (WEBP, PNG, JPG), pasta de imagens, ZIP, CBZ ou PDF. O Aethera valida a ordem numérica, integridade e duplicidades e gera o CBZ vinculado ao projeto.
              </p>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <input
                    value={assistedUrl}
                    onChange={(e) => setAssistedUrl(e.target.value)}
                    placeholder="URL opcional do capítulo para abrir no navegador (ex: https://...)"
                    aria-label="URL do capítulo para abrir no navegador"
                    style={{ ...inputStyle, flex: 1, minWidth: 220 }}
                  />
                  <button
                    type="button"
                    onClick={() => void handleOpenInBrowser(assistedUrl || linkInputs[0] || '')}
                    style={{ ...btnSecondary, minHeight: 40 }}
                  >
                    <ExternalLink style={{ width: 15, height: 15 }} /> Abrir no navegador
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
                  <button
                    type="button"
                    disabled={assistedImporting}
                    onClick={() => void handleAssistedPickAndImport('files')}
                    style={{
                      ...btnSecondary,
                      minHeight: 54,
                      borderStyle: 'dashed',
                      borderRadius: T.radiusInner,
                      justifyContent: 'center',
                      opacity: assistedImporting ? 0.6 : 1,
                    }}
                  >
                    <Upload style={{ width: 16, height: 16 }} />
                    {assistedImporting ? 'Validando e gerando CBZ…' : 'Selecionar imagens / ZIP / CBZ / PDF'}
                  </button>
                  <button
                    type="button"
                    disabled={assistedImporting}
                    onClick={() => void handleAssistedPickAndImport('folder')}
                    style={{
                      ...btnSecondary,
                      minHeight: 54,
                      borderStyle: 'dashed',
                      borderRadius: T.radiusInner,
                      justifyContent: 'center',
                      opacity: assistedImporting ? 0.6 : 1,
                    }}
                  >
                    <FolderOpen style={{ width: 16, height: 16 }} />
                    {assistedImporting ? 'Validando pasta…' : 'Selecionar pasta de imagens'}
                  </button>
                </div>

                {assistedResult && (
                  <div
                    style={{
                      padding: '12px 14px',
                      borderRadius: T.radiusInner,
                      background: T.successBg,
                      border: `1px solid ${T.successBorder}`,
                      color: T.success,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 6,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700 }}>
                      <CheckCircle2 style={{ width: 16, height: 16 }} />
                      CBZ pronto e vinculado ao projeto ({assistedResult.pageCount} páginas validadas)
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 11, fontWeight: 600 }}>
                      <span>Formato: {assistedResult.format.toUpperCase()}</span>
                      <span>· Ordem numérica verificada</span>
                      <span>· Duplicadas removidas: {assistedResult.duplicatesRemoved}</span>
                      <span>· Inválidas ignoradas: {assistedResult.invalidSkipped}</span>
                    </div>
                    <div style={{ fontSize: 11, fontFamily: T.mono, opacity: 0.9, wordBreak: 'break-all' }}>
                      {assistedResult.archivePath}
                    </div>
                  </div>
                )}
              </div>
            </BentoBlock>
          )}

          {origin === 'link' && (
            <BentoBlock>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
                <SectionLabel>Links dos Capítulos</SectionLabel>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      padding: '3px 9px',
                      borderRadius: T.radiusFull,
                      background: firecrawlStatus?.available ? T.successBg : T.surfaceSubtle,
                      border: `1px solid ${firecrawlStatus?.available ? T.successBorder : T.border}`,
                      color: firecrawlStatus?.available ? T.success : T.inkMuted,
                    }}
                  >
                    {firecrawlChecking
                      ? 'Verificando Firecrawl Local…'
                      : !firecrawlStatus
                        ? 'Firecrawl Local'
                        : !firecrawlStatus.enabled
                          ? 'Firecrawl Local: Desabilitado'
                          : firecrawlStatus.available
                            ? `Firecrawl Local: Online (${firecrawlStatus.responseTimeMs ?? 0}ms)`
                            : 'Firecrawl Local: Indisponível (fallback direto)'}
                  </span>
                </div>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  flexWrap: 'wrap',
                  padding: '8px 10px',
                  marginBottom: 12,
                  borderRadius: T.radiusSm,
                  background: T.surfaceSubtle,
                  border: `1px solid ${T.border}`,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 600, color: T.inkMuted }}>Endpoint Firecrawl Local:</span>
                <input
                  value={firecrawlEndpointInput}
                  onChange={(e) => setFirecrawlEndpointInput(e.target.value)}
                  placeholder="http://127.0.0.1:3002"
                  style={{ ...inputStyle, flex: 1, minWidth: 180, padding: '6px 10px', fontSize: 12, fontFamily: T.mono }}
                />
                <button
                  type="button"
                  disabled={firecrawlChecking}
                  onClick={() => void handleSaveFirecrawlConfig(firecrawlStatus ? !firecrawlStatus.enabled : true)}
                  style={{ ...btnGhost, padding: '6px 10px', fontSize: 11 }}
                >
                  {firecrawlStatus?.enabled === false ? 'Ativar' : 'Desativar'}
                </button>
                <button
                  type="button"
                  disabled={firecrawlChecking}
                  onClick={() => void handleSaveFirecrawlConfig()}
                  style={{ ...btnGhost, padding: '6px 10px', fontSize: 11 }}
                >
                  <RefreshCw style={{ width: 12, height: 12 }} /> Testar / Salvar
                </button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {linkInputs.map((url, idx) => (
                  <div key={idx} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <input
                      value={url}
                      onChange={(e) => {
                        const next = [...linkInputs];
                        next[idx] = e.target.value;
                        setLinkInputs(next);
                      }}
                      placeholder="https://exemplo.com/manga/capitulo/1"
                      style={{ ...inputStyle, flex: 1 }}
                    />
                    {linkInputs.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setLinkInputs(linkInputs.filter((_, i) => i !== idx))}
                        style={{ ...btnGhost, color: T.error }}
                      >
                        <X style={{ width: 14, height: 14 }} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                <button type="button" onClick={() => setLinkInputs([...linkInputs, ''])} style={btnGhost}>
                  <Plus style={{ width: 14, height: 14 }} /> Adicionar outro link
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {linkImporting && linkImportJob && (
                    <button
                      type="button"
                      onClick={() => void handleCancelLinkImport()}
                      style={{ ...btnGhost, color: T.error, borderColor: T.errorBorder }}
                    >
                      <X style={{ width: 14, height: 14 }} /> Cancelar
                    </button>
                  )}
                  {!linkImporting && linkImportJob && linkImportJob.items.some((it) => it.status === 'failed' || it.status === 'cancelled') && (
                    <button
                      type="button"
                      onClick={() => void handleRetryLinkImport()}
                      style={btnGhost}
                    >
                      <RefreshCw style={{ width: 14, height: 14 }} /> Tentar falhos novamente
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={linkImporting}
                    onClick={() => void handleAnalyzeAndReviewUrl()}
                    style={{ ...btnSecondary, opacity: linkImporting ? 0.6 : 1 }}
                  >
                    Analisar e Revisar Imagens
                  </button>
                  <button
                    type="button"
                    disabled={linkImporting}
                    onClick={() => void handleImportLinkChapters()}
                    style={{ ...btnPrimary, opacity: linkImporting ? 0.6 : 1 }}
                  >
                    {linkImporting ? 'Importando…' : 'Baixar e Preparar CBZ'}
                  </button>
                </div>
              </div>

              {/* Universal Importer 7-State Status Strip */}
              <div
                aria-label="Estados do Importador Universal"
                style={{
                  marginTop: 12,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 6,
                }}
              >
                {(
                  [
                    ['source_recognized', 'Fonte reconhecida'],
                    ['analyzing_page', 'Analisando página'],
                    ['chapter_identified', 'Capítulo identificado'],
                    ['verifying_images', 'Verificando imagens'],
                    ['importing', 'Importando'],
                    ['import_not_permitted', 'Importação não permitida'],
                    ['content_not_recognized', 'Conteúdo não reconhecido'],
                  ] as const
                ).map(([stKey, stLabel]) => {
                  const firstJobItemState = linkImportJob?.items?.[0]?.universalState;
                  const activeState =
                    universalAnalyzeState !== 'idle' ? universalAnalyzeState : (firstJobItemState ?? 'idle');
                  const isActive = activeState === stKey;
                  const isNegative = stKey === 'import_not_permitted' || stKey === 'content_not_recognized';
                  return (
                    <span
                      key={stKey}
                      style={{
                        fontSize: 11,
                        fontWeight: isActive ? 700 : 500,
                        padding: '4px 10px',
                        borderRadius: T.radiusFull,
                        border: `1px solid ${
                          isActive
                            ? isNegative
                              ? T.errorBorder
                              : T.accent
                            : T.border
                        }`,
                        background: isActive
                          ? isNegative
                            ? T.errorBg
                            : T.accentSoft
                          : T.surfaceSubtle,
                        color: isActive
                          ? isNegative
                            ? T.error
                            : T.accentInk
                          : T.inkMuted,
                      }}
                    >
                      {stLabel}
                    </span>
                  );
                })}
              </div>

              {/* Pre-CBZ Image Review Panel (Requirement 5: Exibir o método utilizado e permitir revisar as imagens identificadas antes de criar o CBZ) */}
              {analyzedChapterPreview && (
                <div
                  role="region"
                  aria-label="Revisão de imagens identificadas"
                  style={{
                    marginTop: 12,
                    padding: '14px 16px',
                    borderRadius: T.radiusInner,
                    background: T.surfaceSubtle,
                    border: `1px solid ${T.borderStrong}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, flexWrap: 'wrap' }}>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>
                        Capítulo identificado: {analyzedChapterPreview.workTitle} · Cap. {analyzedChapterPreview.chapterNumber}
                      </div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4, fontSize: 11, color: T.inkMuted }}>
                        <span style={{ fontWeight: 600, color: T.accentInk }}>
                          Método utilizado: {analyzedChapterPreview.acquisitionMethodLabel} ({analyzedChapterPreview.adapterName})
                        </span>
                        <span>
                          · Formato:{' '}
                          {analyzedChapterPreview.formatHint === 'webtoon_vertical'
                            ? `Webtoon / Tira Vertical (${analyzedChapterPreview.verticalStripCount} longas)`
                            : 'Mangá / Manhwa Paginado'}
                        </span>
                        <span>
                          · {analyzedChapterPreview.pages.filter((p) => p.included).length}/{analyzedChapterPreview.pages.length} imagens selecionadas
                        </span>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        type="button"
                        onClick={() => setAnalyzedChapterPreview(null)}
                        style={btnGhost}
                      >
                        Fechar revisão
                      </button>
                      <button
                        type="button"
                        disabled={linkImporting || analyzedChapterPreview.pages.every((p) => !p.included)}
                        onClick={() => void handleConfirmReviewedPagesToCbz()}
                        style={btnPrimary}
                      >
                        <CheckCircle2 style={{ width: 14, height: 14 }} /> Confirmar e Gerar CBZ (
                        {analyzedChapterPreview.pages.filter((p) => p.included).length} págs)
                      </button>
                    </div>
                  </div>

                  <div
                    style={{
                      maxHeight: 220,
                      overflowY: 'auto',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                      paddingRight: 4,
                    }}
                  >
                    {analyzedChapterPreview.pages.map((pg, idx) => (
                      <label
                        key={`${pg.imageUrl}-${idx}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          padding: '6px 10px',
                          borderRadius: 8,
                          background: pg.included ? T.surface : T.surfaceSubtle,
                          border: `1px solid ${pg.included ? T.border : 'transparent'}`,
                          cursor: 'pointer',
                          fontSize: 12,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={pg.included}
                          onChange={(e) => {
                            const checked = e.target.checked;
                            setAnalyzedChapterPreview((prev) =>
                              prev
                                ? {
                                    ...prev,
                                    pages: prev.pages.map((p, i) => (i === idx ? { ...p, included: checked } : p)),
                                  }
                                : null,
                            );
                          }}
                        />
                        <span style={{ fontFamily: T.mono, fontWeight: 700, minWidth: 52 }}>
                          Pág. {String(pg.pageNumber).padStart(2, '0')}
                        </span>
                        <span
                          style={{
                            flex: 1,
                            fontFamily: T.mono,
                            fontSize: 11,
                            color: T.inkMuted,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {pg.imageUrl}
                        </span>
                        {pg.isVerticalStrip && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: T.radiusFull,
                              background: T.accentSoft,
                              color: T.accentInk,
                            }}
                          >
                            Vertical Longa
                          </span>
                        )}
                        {pg.width && pg.height ? (
                          <span style={{ fontFamily: T.mono, fontSize: 11, color: T.inkSubtle }}>
                            {pg.width}×{pg.height}
                          </span>
                        ) : null}
                      </label>
                    ))}
                  </div>
                </div>
              )}
              {linkImportJob && linkImportJob.items.length > 0 && (() => {
                const readyQueueItems = linkImportJob.items.filter((it) => Boolean(it.libraryEntry?.cbzPath));
                const allReadyCbzPaths = readyQueueItems.map((it) => it.libraryEntry!.cbzPath);
                const totalReadyPages = readyQueueItems.reduce(
                  (sum, it) => sum + (it.pagesTotal || it.pagesDone || 0),
                  0,
                );
                const allSelectedInMulti =
                  allReadyCbzPaths.length > 1 &&
                  allReadyCbzPaths.every((p) => selectedChapterCbzPaths.includes(p));

                return (
                <div
                  style={{
                    marginTop: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    padding: '10px 12px',
                    borderRadius: T.radiusSm,
                    background: T.surfaceSubtle,
                    border: `1px solid ${T.border}`,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 11, fontWeight: 600, color: T.inkMuted }}>
                    <span>Fila de importação ({linkImportJob.items.length} {linkImportJob.items.length === 1 ? 'link' : 'links'})</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      {allReadyCbzPaths.length > 1 && (
                        <button
                          type="button"
                          disabled={mergingChapters}
                          onClick={() => void applySelectedChaptersForProduction(allReadyCbzPaths)}
                          style={{
                            ...btnGhost,
                            padding: '4px 10px',
                            fontSize: 11,
                            fontWeight: 700,
                            borderRadius: T.radiusFull,
                            background: allSelectedInMulti ? T.successBg : T.accentSoft,
                            border: `1px solid ${allSelectedInMulti ? T.successBorder : T.accent}`,
                            color: allSelectedInMulti ? T.success : T.accentInk,
                          }}
                        >
                          <Layers style={{ width: 13, height: 13 }} />
                          {mergingChapters
                            ? 'Combinando capítulos…'
                            : allSelectedInMulti
                              ? `Todos os ${allReadyCbzPaths.length} capítulos combinados (${totalReadyPages} págs)`
                              : `Usar todos os ${allReadyCbzPaths.length} capítulos no mesmo vídeo (${totalReadyPages} págs)`}
                        </button>
                      )}
                      <span style={{ textTransform: 'uppercase', letterSpacing: '0.04em' }}>{linkImportJob.status}</span>
                    </div>
                  </div>
                  {linkImportJob.items.map((item, idx) => {
                    const cbzPath = item.libraryEntry?.cbzPath;
                    const isIncludedInMulti = Boolean(cbzPath && selectedChapterCbzPaths.includes(cbzPath));
                    const isSelectedSingle = Boolean(cbzPath && linkImportedCbz?.cbzPath === cbzPath);
                    const isSelected = isIncludedInMulti || isSelectedSingle;
                    const { isDone, pct, statusLabel } = deriveQueueItemDisplayStatus(item, linkImportJob.status);
                    return (
                      <div
                        key={`${item.url}-${idx}`}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 8,
                          background: isSelected ? T.successBg : isDone ? '#f6fbf2' : T.surface,
                          border: `1px solid ${isSelected ? T.successBorder : item.error ? T.errorBorder : T.border}`,
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 5,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                          {cbzPath && allReadyCbzPaths.length > 1 && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={mergingChapters}
                              aria-label={`Incluir capítulo ${idx + 1} no vídeo`}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                const currentList =
                                  selectedChapterCbzPaths.length > 0
                                    ? selectedChapterCbzPaths
                                    : linkImportedCbz?.cbzPath
                                      ? [linkImportedCbz.cbzPath]
                                      : [];
                                const nextList = checked
                                  ? allReadyCbzPaths.filter((p) => currentList.includes(p) || p === cbzPath)
                                  : currentList.filter((p) => p !== cbzPath);
                                if (nextList.length > 0) {
                                  void applySelectedChaptersForProduction(
                                    nextList,
                                    `${item.pagesDone}/${item.pagesTotal} páginas`,
                                  );
                                }
                              }}
                              style={{ cursor: 'pointer' }}
                            />
                          )}
                          <span style={{ fontSize: 12, color: T.ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                            {idx + 1}. {item.url}
                          </span>
                          {item.acquisitionMethodLabel && (
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 600,
                                padding: '2px 8px',
                                borderRadius: T.radiusFull,
                                background: T.surfaceSubtle,
                                border: `1px solid ${T.border}`,
                                color: T.inkMuted,
                                flexShrink: 0,
                              }}
                            >
                              {item.acquisitionMethodLabel}
                            </span>
                          )}
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: item.error && !isDone ? T.error : isDone || cbzPath ? T.success : T.inkMuted,
                              flexShrink: 0,
                            }}
                          >
                            {statusLabel}
                          </span>
                          {cbzPath && (
                            <button
                              type="button"
                              disabled={mergingChapters}
                              onClick={() => {
                                if (allReadyCbzPaths.length > 1) {
                                  const currentList =
                                    selectedChapterCbzPaths.length > 0
                                      ? selectedChapterCbzPaths
                                      : linkImportedCbz?.cbzPath
                                        ? [linkImportedCbz.cbzPath]
                                        : [];
                                  const exists = currentList.includes(cbzPath);
                                  const nextList = exists
                                    ? currentList.length > 1
                                      ? currentList.filter((p) => p !== cbzPath)
                                      : currentList
                                    : allReadyCbzPaths.filter((p) => currentList.includes(p) || p === cbzPath);
                                  void applySelectedChaptersForProduction(
                                    nextList,
                                    `${item.pagesDone}/${item.pagesTotal} páginas`,
                                  );
                                } else {
                                  setSelectedChapterCbzPaths([cbzPath]);
                                  setLinkImportedCbz({
                                    cbzPath,
                                    label: `${item.pagesDone}/${item.pagesTotal} páginas`,
                                  });
                                  const slug = cbzPath.split(/[/\\]/).pop()?.replace(/\.cbz$/i, '') ?? '';
                                  if (slug) setWorkTitle(slug);
                                }
                              }}
                              style={{
                                ...btnGhost,
                                padding: '3px 9px',
                                fontSize: 11,
                                color: isSelected ? T.success : T.ink,
                                borderColor: isSelected ? T.successBorder : T.border,
                              }}
                            >
                              {isSelected
                                ? selectedChapterCbzPaths.length > 1
                                  ? `Incluído (${selectedChapterCbzPaths.indexOf(cbzPath) + 1}/${selectedChapterCbzPaths.length})`
                                  : 'Selecionado'
                                : allReadyCbzPaths.length > 1
                                  ? 'Incluir no vídeo'
                                  : 'Usar capítulo'}
                            </button>
                          )}
                        </div>
                        {pct > 0 && pct < 100 && (
                          <div style={{ height: 3, borderRadius: 99, background: T.border, overflow: 'hidden' }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: T.accent, transition: 'width 180ms ease-out' }} />
                          </div>
                        )}
                        {item.error && (
                          <div style={{ fontSize: 11, color: T.error }}>{item.error}</div>
                        )}
                      </div>
                    );
                  })}
                </div>
                );
              })()}
              {linkImportJob && (linkImportJob.blockedByProtection || linkImportJob.items.some((it) => it.blockedByProtection || /cloudflare|403|captcha/i.test(it.error ?? ''))) && (
                <div
                  role="region"
                  aria-label="Recuperação por importação assistida"
                  style={{
                    marginTop: 12,
                    padding: '14px 16px',
                    borderRadius: T.radiusInner,
                    background: T.warningBg,
                    border: `1px solid ${T.warningBorder}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                    <ShieldCheck style={{ width: 18, height: 18, color: T.warning, flexShrink: 0, marginTop: 1 }} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: T.ink }}>
                        Proteção Cloudflare / HTTP 403 detectada — tentativas automáticas interrompidas
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: T.inkMuted, lineHeight: 1.5 }}>
                        Para não repetir requisições bloqueadas nem contornar proteções do site, abra o capítulo normalmente no navegador e traga os arquivos autorizados (WEBP, PNG, JPG, pasta, ZIP, CBZ ou PDF).
                      </p>
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => void handleStartInteractiveImport(linkInputs.map((u) => u.trim()).filter(Boolean))}
                      style={{ ...btnPrimary, minHeight: 38 }}
                    >
                      <ExternalLink style={{ width: 14, height: 14 }} /> Abrir navegador e verificar acesso
                    </button>
                    <button
                      type="button"
                      disabled={assistedImporting}
                      onClick={() => void handleAssistedPickAndImport('files', linkImportJob.blockedUrl || linkInputs[0])}
                      style={{ ...btnSecondary, minHeight: 38 }}
                    >
                      <Upload style={{ width: 14, height: 14 }} /> {assistedImporting ? 'Gerando CBZ…' : 'Importar arquivos (WEBP/PNG/JPG/ZIP/CBZ/PDF)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleClearInteractiveProfile(linkImportJob.blockedUrl || linkInputs[0] || '')}
                      style={{ ...btnGhost, minHeight: 38 }}
                    >
                      <Trash2 style={{ width: 14, height: 14 }} /> Limpar dados do navegador
                    </button>
                  </div>
                </div>
              )}
              {linkImportedCbz && (
                <div
                  style={{
                    marginTop: 10,
                    padding: '10px 12px',
                    borderRadius: T.radiusSm,
                    background: T.successBg,
                    border: `1px solid ${T.successBorder}`,
                    color: T.success,
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                >
                  Capítulo ativo: {linkImportedCbz.label} ({linkImportedCbz.cbzPath})
                </div>
              )}
            </BentoBlock>
          )}

          {origin === 'cdn' && (
            <BentoBlock>
              <SectionLabel>Importação Direta CDN</SectionLabel>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <textarea
                  value={cdnImageUrls}
                  onChange={(e) => setCdnImageUrls(e.target.value)}
                  placeholder="Cole as URLs das imagens, uma por linha"
                  rows={4}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: T.mono, fontSize: 12 }}
                />
                <input
                  value={cdnChapterUrl}
                  onChange={(e) => setCdnChapterUrl(e.target.value)}
                  placeholder="URL do capítulo (referer)"
                  style={inputStyle}
                />
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <input
                    value={cdnWorkTitle}
                    onChange={(e) => setCdnWorkTitle(e.target.value)}
                    placeholder="Título da obra (opcional)"
                    style={inputStyle}
                  />
                  <input
                    value={cdnChapterNumber}
                    onChange={(e) => setCdnChapterNumber(e.target.value)}
                    placeholder="Número do capítulo (opcional)"
                    style={inputStyle}
                  />
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="button"
                    disabled={cdnImporting}
                    onClick={() => void handleImportCdn()}
                    style={{ ...btnPrimary, opacity: cdnImporting ? 0.6 : 1 }}
                  >
                    {cdnImporting ? 'Importando…' : 'Importar via CDN'}
                  </button>
                </div>
                {cdnResult && (
                  <div
                    style={{
                      padding: '10px 12px',
                      borderRadius: T.radiusSm,
                      background: T.successBg,
                      border: `1px solid ${T.successBorder}`,
                      color: T.success,
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {cdnResult.pageCount} páginas importadas · {cdnResult.workTitle} Cap. {cdnResult.chapterNumber}
                  </div>
                )}
              </div>
            </BentoBlock>
          )}

          {importError && (
            <div
              role="alert"
              style={{
                padding: '12px 14px',
                borderRadius: T.radiusInner,
                background: T.errorBg,
                border: `1px solid ${T.errorBorder}`,
                color: T.error,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {importError}
            </div>
          )}

          {archiveIntegrity && archiveIntegrity.valid === false && (
            <div
              role="alert"
              style={{
                padding: '12px 14px',
                borderRadius: T.radiusInner,
                background: T.errorBg,
                border: `1px solid ${T.errorBorder}`,
                color: T.error,
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              Validação de integridade do CBZ falhou: {archiveIntegrity.error ?? 'O arquivo CBZ não existe ou está corrompido.'}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {archiveIntegrity?.valid && resolvedArchivePath ? (
              <span style={{ fontSize: 12, fontWeight: 600, color: T.success, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle2 style={{ width: 15, height: 15 }} />
                CBZ validado no disco
                {archiveIntegrity.pageCount > 0 ? ` (${archiveIntegrity.pageCount} páginas íntegras)` : ''}
                {archiveIntegrity.sizeBytes > 0 ? ` · ${formatBytes(archiveIntegrity.sizeBytes)}` : ''}
              </span>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={() => setSubTab('analise')}
              disabled={!isChapterArchiveValidated || Boolean(archiveIntegrity?.checking)}
              style={{
                ...btnPrimary,
                opacity: !isChapterArchiveValidated || Boolean(archiveIntegrity?.checking) ? 0.45 : 1,
              }}
            >
              {archiveIntegrity?.checking ? 'Verificando integridade do CBZ…' : 'Continuar para Produção'}{' '}
              <ChevronRight style={{ width: 15, height: 15 }} />
            </button>
          </div>
        </div>
      )}

      {/* ─── STEP 3: ANÁLISE · STEP 5: NARRAÇÃO · STEP 7: PRODUÇÃO ──────── */}
      {(subTab === 'analise' || subTab === 'narracao' || subTab === 'producao') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {subTab === 'producao' && (
            <BentoBlock>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                <div>
                  <SectionLabel>Acompanhamento Real da Produção</SectionLabel>
                  <p style={{ margin: '4px 0 0', fontSize: 12, color: T.inkMuted }}>
                    {pipelineTimeline.detailMessage}
                  </p>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontFamily: T.mono, fontSize: 12 }}>
                  {isRunning && (
                    <span style={{ padding: '4px 10px', borderRadius: T.radiusFull, background: T.accentSoft, color: T.accentInk, fontWeight: 700 }}>
                      Tempo decorrido: {Math.floor(productionElapsedSec / 60)}m {String(productionElapsedSec % 60).padStart(2, '0')}s
                    </span>
                  )}
                  <span style={{ padding: '4px 10px', borderRadius: T.radiusFull, background: T.surfaceSubtle, color: T.ink, fontWeight: 700 }}>
                    {pipelineTimeline.overallProgressPct}% real ({pipelineTimeline.completedCount}/{pipelineTimeline.totalCount})
                  </span>
                </div>
              </div>

              <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: 14 }}>
                <div style={{ padding: 12, borderRadius: T.radiusInner, background: T.surfaceSubtle, border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 11, color: T.inkSubtle, fontWeight: 600 }}>Narração (TTS)</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginTop: 4 }}>
                    {ttsProvider === 'voicestudio_tts' ? 'VoiceStudio' : ttsProvider === 'elevenlabs_tts' ? 'ElevenLabs' : 'Windows SAPI'}
                  </div>
                </div>
                <div style={{ padding: 12, borderRadius: T.radiusInner, background: T.surfaceSubtle, border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 11, color: T.inkSubtle, fontWeight: 600 }}>Motion Velix</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginTop: 4 }}>
                    {activeProject?.motionVelix
                      ? `${activeProject.motionVelix.sfxApplied}/${activeProject.motionVelix.sfxPlanned} SFX · ${activeProject.motionVelix.vfxAppliedShots} VFX`
                      : motionVelixStatus?.installed
                        ? 'Kit pronto'
                        : 'Aguardando'}
                  </div>
                </div>
                <div style={{ padding: 12, borderRadius: T.radiusInner, background: T.surfaceSubtle, border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 11, color: T.inkSubtle, fontWeight: 600 }}>Renderização</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginTop: 4 }}>
                    {activeProject?.masterMp4Path ? 'Master concluído' : activeProject?.previewMp4Path ? 'Prévia pronta' : isRunning ? 'Renderizando…' : 'Pendente'}
                  </div>
                </div>
                <div style={{ padding: 12, borderRadius: T.radiusInner, background: T.surfaceSubtle, border: `1px solid ${T.border}` }}>
                  <div style={{ fontSize: 11, color: T.inkSubtle, fontWeight: 600 }}>Release Gates</div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: T.ink, marginTop: 4, fontFamily: T.mono }}>
                    F:{activeProject?.gateFVerdict ?? '—'} · G:{activeGateG?.verdict ?? activeProject?.gateGVerdict ?? '—'} · H:{activeGateH?.verdict ?? activeProject?.gateHVerdict ?? '—'}
                  </div>
                </div>
              </div>

              <details
                open={showTechDiagnostics}
                onToggle={(e) => setShowTechDiagnostics((e.target as HTMLDetailsElement).open)}
                style={{
                  borderRadius: T.radiusSm,
                  border: `1px solid ${T.border}`,
                  background: T.surfaceSubtle,
                  padding: '8px 12px',
                  fontSize: 12,
                }}
              >
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: T.ink }}>
                  Diagnóstico técnico (provedores, checkpoints e logs detalhados)
                </summary>
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6, fontFamily: T.mono, fontSize: 11, color: T.inkMuted }}>
                  <div>Run ID: {activeProject?.runId ?? 'nenhum'}</div>
                  <div>Capítulo: {activeProject?.chapterId ?? '—'} · Painéis: {activeProject?.panelCount ?? 0} · Cenas: {scenes.length}</div>
                  <div>Provedores operacionais: {readiness?.operationalProviders?.join(', ') || 'verificando…'}</div>
                  {activeProject?.lastError && <div style={{ color: T.error }}>Último erro: {activeProject.lastError}</div>}
                </div>
              </details>
            </BentoBlock>
          )}

          {/* Existing RealPipelineTimeline + Production Settings */}
          <RealPipelineTimeline
            record={activeProject}
            liveMessage={statusNote}
            isActivelyRunning={isRunning}
            onResumeFromCheckpoint={() => void handleStart(true)}
          />

          <AudiovisualTrackTimeline
            plan={activePlan}
            motionVelix={activeProject?.motionVelix ?? null}
            selectedShotId={selectedShotId}
            onSelectShot={(shotId) => setSelectedShotId(shotId)}
            outroConfig={outroConfig}
            onSelectOutro={() => {
              setSubTab('producao');
              setTimeout(() => {
                document.getElementById('recap-motionvelix-outro-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 80);
            }}
          />

          <div id="recap-motionvelix-outro-panel">
            <MotionVelixOutroPanel
              projectId={activeProject?.runId || chapterId || 'recap-default'}
              channelName={workTitle}
              onConfigChange={setOutroConfig}
            />
          </div>

          <BentoBlock>
            <SectionLabel>Configuração da Produção</SectionLabel>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 14 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.inkMuted, display: 'flex', flexDirection: 'column', gap: 6 }}>
                Título da obra
                <input
                  value={workTitle}
                  onChange={(e) => setWorkTitle(e.target.value)}
                  style={inputStyle}
                  placeholder="Ex: Solo Leveling Cap. 01"
                />
              </label>

              <label style={{ fontSize: 12, fontWeight: 600, color: T.inkMuted, display: 'flex', flexDirection: 'column', gap: 6 }}>
                Formato
                <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value as '16:9' | '9:16')} style={inputStyle}>
                  <option value="16:9">16:9 Horizontal (YouTube)</option>
                  <option value="9:16">9:16 Vertical (Shorts / Reels)</option>
                </select>
              </label>

              <label style={{ fontSize: 12, fontWeight: 600, color: T.inkMuted, display: 'flex', flexDirection: 'column', gap: 6 }}>
                Voz (TTS)
                <select value={ttsProvider} onChange={(e) => setTtsProvider(e.target.value)} style={inputStyle}>
                  <option value="voicestudio_tts">VoiceStudio Local</option>
                  <option value="elevenlabs_tts">ElevenLabs</option>
                  <option value="windows_sapi_tts">Windows SAPI</option>
                </select>
              </label>

              <label style={{ fontSize: 12, fontWeight: 600, color: T.inkMuted, display: 'flex', flexDirection: 'column', gap: 6 }}>
                Idioma da narração
                <select value={language} onChange={(e) => setLanguage(e.target.value as 'pt-BR' | 'en-US' | 'es-ES')} style={inputStyle}>
                  <option value="pt-BR">Português (BR)</option>
                  <option value="en-US">English (US)</option>
                  <option value="es-ES">Español (ES)</option>
                </select>
              </label>

              <label style={{ fontSize: 12, fontWeight: 600, color: T.inkMuted, display: 'flex', flexDirection: 'column', gap: 6 }}>
                Estilo de roteiro
                <select value={scriptStyle} onChange={(e) => setScriptStyle(e.target.value)} style={inputStyle}>
                  <option value="natural_recap">Narração Natural (Padrão)</option>
                  <option value="narrative_recap">Recap Narrativo Detalhado</option>
                  <option value="cinematic_recap">Recap Cinematográfico</option>
                  <option value="mystery">Mistério</option>
                  <option value="suspense">Suspense</option>
                  <option value="documentary">Documentário</option>
                </select>
              </label>

              <div style={{ fontSize: 12, fontWeight: 600, color: T.inkMuted, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span>Volume de humor</span>
                  <span style={{ fontFamily: T.mono, color: T.accent }}>{humorVolume}%</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={humorVolume}
                  onChange={(e) => setHumorVolume(Number(e.target.value))}
                  style={{ width: '100%', accentColor: T.accent, cursor: 'pointer', marginTop: 4 }}
                />
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: T.inkSubtle }}>
                  <span>Sério</span>
                  <span>Equilibrado</span>
                  <span>Máximo</span>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: 16, paddingTop: 14, borderTop: `1px solid ${T.border}` }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: T.ink, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={enableOcr}
                  onChange={(e) => setEnableOcr(e.target.checked)}
                  style={{ accentColor: T.accent }}
                />
                Executar OCR (Tesseract) na extração dos painéis
              </label>

              <span style={{ fontSize: 12, fontFamily: T.mono, color: T.inkSubtle }}>
                {resolvedArchivePath ? `Fonte: ${resolvedArchivePath.split(/[/\\]/).pop()}` : 'Nenhuma fonte selecionada'}
              </span>
            </div>

            {/* Primary Actions */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginTop: 16 }}>
              <button
                type="button"
                disabled={isRunning}
                onClick={() => void handleStart(false)}
                style={{ ...btnLime, opacity: isRunning ? 0.55 : 1 }}
              >
                {isRunning ? (
                  <>
                    <RefreshCw className="animate-spin" style={{ width: 14, height: 14 }} /> Produzindo…
                  </>
                ) : (
                  <>
                    <Play style={{ width: 14, height: 14 }} /> Iniciar Produção
                  </>
                )}
              </button>

              {readiness.checkpoint.canResume && (
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => void handleStart(true)}
                  style={{ ...btnSecondary, opacity: isRunning ? 0.55 : 1 }}
                >
                  Retomar Checkpoint ({readiness.checkpoint.completedPanels}/{readiness.checkpoint.totalPanels})
                </button>
              )}

              <button
                type="button"
                disabled={readinessLoading}
                onClick={() => void refreshReadiness(activeProject?.chapterId)}
                style={btnGhost}
              >
                <RefreshCw className={readinessLoading ? 'animate-spin' : undefined} style={{ width: 13, height: 13 }} />
                Verificar Provedores
              </button>

              <button
                type="button"
                disabled={testingVision || isRunning}
                onClick={() => void handleTestVisionReal()}
                style={btnGhost}
              >
                <Sparkles className={testingVision ? 'animate-spin' : undefined} style={{ width: 13, height: 13 }} />
                {testingVision ? 'Testando visão…' : 'Testar visão'}
              </button>
            </div>
          </BentoBlock>

          {/* Preview Approval Gate (Real IPC wired to recap:approve-preview) */}
          {activeProject?.state === 'awaiting_preview_approval' && (
            <BentoBlock style={{ border: `2px solid ${T.ink}`, background: '#fbfbfe' }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14 }}>
                <div>
                  <SectionLabel>Gate de Aprovação Humana</SectionLabel>
                  <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: T.ink }}>
                    Prévia auditada pronta para aprovação
                  </h3>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: T.inkMuted }}>
                    Assista ao vídeo abaixo e aprove para renderizar o Master final (1080p) e gerar o pacote de release.
                  </p>
                </div>
              </div>

              <div style={{ marginBottom: 14 }}>
                <PreviewPlayer
                  mp4Path={activeProject.previewMp4Path ?? null}
                  isProducing={isApproving}
                  onError={() => setStatusNote('Erro ao carregar vídeo de prévia. Verifique se o arquivo MP4 existe em disco.')}
                />
              </div>

              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                <button
                  type="button"
                  disabled={isApproving}
                  onClick={() => void handleApprovePreview()}
                  style={{ ...btnLime, flex: 1, opacity: isApproving ? 0.6 : 1 }}
                >
                  <CheckCircle2 style={{ width: 15, height: 15 }} />
                  {isApproving ? 'Exportando Master…' : 'Aprovar e Exportar Master'}
                </button>
                <button
                  type="button"
                  disabled={isApproving}
                  onClick={() => {
                    setStatusNote('Prévia enviada para revisão. Edite o roteiro ou solicite ajustes na aba Preview & Revisão.');
                    setSubTab('roteiro');
                  }}
                  style={{ ...btnSecondary, flex: 1 }}
                >
                  <X style={{ width: 15, height: 15 }} /> Revisar Cenas
                </button>
              </div>
            </BentoBlock>
          )}
        </div>
      )}

      {/* ─── STEP 4: ROTEIRO REAL (REDESIGN STUDIO) ─────────────────────── */}
      {subTab === 'roteiro' && (
        <RecapScriptStudio
          scenes={scenes}
          language={language}
          humorVolume={humorVolume}
          scriptStyleLabel={
            scriptStyle === 'natural_recap'
              ? 'natural_recap (Narração Natural)'
              : scriptStyle === 'cinematic_recap'
                ? 'cinematic_recap (Cinematográfico)'
                : scriptStyle
          }
          gateG={activeGateG}
          canRegenerate={Boolean(activeProject?.runId)}
          savingSceneId={savingSceneId}
          regeneratingSceneId={regeneratingSceneId}
          regeneratingScript={regeneratingScript}
          regenerateFeedback={regenerateFeedback}
          onChangeNarration={(idx, nextText) => {
            const next = [...scenes];
            const row = next[idx];
            if (!row) return;
            next[idx] = {
              ...row,
              narrationText: nextText,
              estimatedDurationSec: estimateTextDurationSec(nextText),
              dirty: true,
            };
            setScenes(next);
          }}
          onSaveScene={(sceneId, narrationText) => void handleSaveSceneEdit(sceneId, narrationText)}
          onRegenerateScene={(sceneId) => void handleRegenerateScene(sceneId)}
          onRegenerateScript={() => void handleRegenerateScript(false)}
        />
      )}

      {/* ─── STEP 6: STORYBOARD & TIMELINE MULTIPISTA ───────────────────── */}
      {subTab === 'storyboard' && (
        <RecapVisualStoryboard
          scenes={scenes}
          plan={activePlan}
          motionVelix={activeProject?.motionVelix ?? null}
          selectedShotId={selectedShotId}
          onSelectShot={(shotId) => setSelectedShotId(shotId)}
        />
      )}

      {/* ─── STEP 8: REVISÃO & APROVAÇÃO FINAL ──────────────────────────── */}
      {subTab === 'revisao' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <AudiovisualTrackTimeline
            plan={activePlan}
            motionVelix={activeProject?.motionVelix ?? null}
            selectedShotId={selectedShotId}
            onSelectShot={(shotId) => setSelectedShotId(shotId)}
            outroConfig={outroConfig}
            onSelectOutro={() => {
              setSubTab('producao');
              setTimeout(() => {
                document.getElementById('recap-motionvelix-outro-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 80);
            }}
          />

          <div id="recap-motionvelix-outro-panel">
            <MotionVelixOutroPanel
              projectId={activeProject?.runId || chapterId || 'recap-default'}
              channelName={workTitle}
              onConfigChange={setOutroConfig}
            />
          </div>

          <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) 360px', alignItems: 'start' }}>
            {/* Left: Video + Humanized Script + Prompt Revision */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <BentoBlock style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, padding: '0 4px' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: T.ink }}>
                    {activeProject?.masterMp4Path ? 'MP4 Master Final' : activeProject?.previewMp4Path ? 'MP4 de Prévia' : 'Player de Vídeo'}
                  </span>
                  {activeProject?.exportBundleDir && (
                    <span style={{ fontSize: 11, fontFamily: T.mono, color: T.success }}>
                      Pacote exportado
                    </span>
                  )}
                </div>
                <PreviewPlayer
                  mp4Path={activeMediaPath}
                  isProducing={isRunning}
                  onError={() => setStatusNote('Erro ao reproduzir o MP4 salvo. Verifique se o arquivo existe no disco.')}
                />
              </BentoBlock>

              {/* Humanized Script Review — Side-by-Side Panel & Narrative Revision (Phase 9) */}
              <BentoBlock>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <SectionLabel>Roteiro Real ({scenes.length} cenas)</SectionLabel>
                    <span style={{ fontSize: 11, fontFamily: T.mono, color: T.inkMuted }}>
                      {language} · Humor {humorVolume}%
                    </span>
                  </div>
                  {activeProject?.runId && scenes.length > 0 && (
                    <button
                      type="button"
                      disabled={regeneratingScript || regeneratingSceneId !== null}
                      onClick={() => void handleRegenerateScript(false)}
                      style={{
                        ...btnSecondary,
                        padding: '6px 12px',
                        fontSize: 12,
                        opacity: regeneratingScript ? 0.6 : 1,
                      }}
                    >
                      <RefreshCw style={{ width: 13, height: 13 }} />
                      {regeneratingScript ? 'Regenerando roteiro…' : 'Regenerar roteiro completo'}
                    </button>
                  )}
                </div>
                {scenes.length === 0 ? (
                  <div
                    style={{
                      padding: '24px 16px',
                      borderRadius: T.radiusInner,
                      background: T.surfaceSubtle,
                      textAlign: 'center',
                    }}
                  >
                    <BookOpen style={{ width: 24, height: 24, color: T.inkSubtle, margin: '0 auto 8px' }} />
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: T.ink }}>
                      Nenhuma cena carregada neste projeto ainda
                    </p>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: T.inkMuted }}>
                      As cenas reais geradas pelo Story Engine aparecerão aqui com os painéis originais ao lado assim que o roteiro for concluído.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {scenes.map((row, idx) => {
                      const highlighted = activePlan?.shots.some(
                        (s) => s.shotId === selectedShotId && s.sceneId === row.sceneId,
                      );
                      const sceneHints = (activeGateG?.hints ?? []).filter((h) => h.sceneId === row.sceneId);
                      const isLowConfidence =
                        (row.confidence !== undefined && row.confidence < 0.5) ||
                        row.reviewStatus === 'needs_review' ||
                        row.uncertainties.length > 0 ||
                        sceneHints.length > 0;
                      const panelIdx = Math.min(
                        selectedPanelIdxByScene[row.sceneId] ?? 0,
                        Math.max(0, row.croppedImagePaths.length - 1),
                      );
                      const activePanelPath = row.croppedImagePaths[panelIdx] ?? null;
                      const showVisualComparison = Boolean(expandedVisualScenes[row.sceneId]);
                      const isRegeneratingThis = regeneratingSceneId === row.sceneId;
                      const isSavingThis = savingSceneId === row.sceneId;
                      const sceneNumberLabel = String(idx + 1).padStart(2, '0');

                      return (
                        <div
                          key={row.sceneId}
                          style={{
                            padding: 14,
                            borderRadius: T.radiusInner,
                            border: highlighted
                              ? `2px solid ${T.ink}`
                              : isLowConfidence
                                ? `1px solid ${T.warningBorder}`
                                : `1px solid ${T.border}`,
                            background: highlighted ? '#fbfbfe' : T.surface,
                            display: 'grid',
                            gap: 14,
                            gridTemplateColumns: 'minmax(160px, 210px) minmax(0, 1fr)',
                            alignItems: 'start',
                          }}
                        >
                          {/* Left column: Original manga/manhwa panel preview */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div
                              style={{
                                borderRadius: T.radiusSm,
                                overflow: 'hidden',
                                border: `1px solid ${T.border}`,
                                background: T.surfaceSubtle,
                                aspectRatio: '3 / 4',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                              }}
                            >
                              {activePanelPath ? (
                                <img
                                  src={toAetheraMediaUrl(activePanelPath)}
                                  alt={`Painel original da cena ${sceneNumberLabel}`}
                                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                                />
                              ) : (
                                <div style={{ padding: 12, textAlign: 'center', fontSize: 11, color: T.inkSubtle }}>
                                  Painel não encontrado no disco
                                </div>
                              )}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6, fontSize: 11, color: T.inkMuted }}>
                              <span style={{ fontFamily: T.mono, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {row.panelIds[panelIdx] ?? row.panelId}
                              </span>
                              {row.croppedImagePaths.length > 1 && (
                                <span style={{ fontFamily: T.mono, flexShrink: 0 }}>
                                  {panelIdx + 1}/{row.croppedImagePaths.length}
                                </span>
                              )}
                            </div>
                            {row.croppedImagePaths.length > 1 && (
                              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                {row.croppedImagePaths.map((_, pIdx) => (
                                  <button
                                    key={pIdx}
                                    type="button"
                                    onClick={() =>
                                      setSelectedPanelIdxByScene((prev) => ({ ...prev, [row.sceneId]: pIdx }))
                                    }
                                    style={{
                                      padding: '2px 7px',
                                      borderRadius: T.radiusFull,
                                      fontSize: 10,
                                      fontFamily: T.mono,
                                      border: `1px solid ${pIdx === panelIdx ? T.ink : T.border}`,
                                      background: pIdx === panelIdx ? T.ink : T.surface,
                                      color: pIdx === panelIdx ? '#ffffff' : T.inkMuted,
                                      cursor: 'pointer',
                                    }}
                                  >
                                    P{pIdx + 1}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>

                          {/* Right column: Narrative review, extracted bubbles, visual comparison & actions */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                            {/* Scene Header */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <strong style={{ fontSize: 13, color: T.ink }}>
                                  Cena {sceneNumberLabel} — Revisão narrativa
                                </strong>
                                <span style={{ fontSize: 11, fontFamily: T.mono, color: T.accent }}>
                                  {MOTION_LABELS[row.motionStyle] ?? row.motionStyle}
                                </span>
                                {row.confidence !== undefined && (
                                  <span
                                    style={{
                                      fontSize: 10,
                                      fontFamily: T.mono,
                                      padding: '2px 7px',
                                      borderRadius: T.radiusFull,
                                      background: row.confidence >= 0.6 ? T.successBg : T.warningBg,
                                      color: row.confidence >= 0.6 ? T.success : T.warning,
                                      border: `1px solid ${row.confidence >= 0.6 ? T.successBorder : T.warningBorder}`,
                                    }}
                                  >
                                    Confiança {Math.round(row.confidence * 100)}%
                                  </span>
                                )}
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontFamily: T.mono }}>
                                {row.measuredDurationSec !== undefined ? (
                                  <span
                                    title="Duração real medida a partir do áudio TTS sintetizado"
                                    style={{
                                      padding: '2px 8px',
                                      borderRadius: T.radiusFull,
                                      background: T.successBg,
                                      color: T.success,
                                      border: `1px solid ${T.successBorder}`,
                                    }}
                                  >
                                    Real (TTS): {row.measuredDurationSec}s · est. {row.estimatedDurationSec}s
                                  </span>
                                ) : (
                                  <span
                                    title="Estimativa baseada no texto antes da síntese real de TTS"
                                    style={{
                                      padding: '2px 8px',
                                      borderRadius: T.radiusFull,
                                      background: T.surfaceSubtle,
                                      color: T.inkMuted,
                                      border: `1px solid ${T.border}`,
                                    }}
                                  >
                                    Estimada: ~{row.estimatedDurationSec}s
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Characters & Setting pills */}
                            {(row.characters.length > 0 || row.setting) && (
                              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontSize: 11, color: T.inkMuted }}>
                                {row.characters.map((ch) => (
                                  <span
                                    key={ch}
                                    style={{
                                      padding: '2px 8px',
                                      borderRadius: T.radiusFull,
                                      background: T.accentSoft,
                                      color: T.accentInk,
                                      fontWeight: 500,
                                    }}
                                  >
                                    {ch}
                                  </span>
                                ))}
                                {row.setting && (
                                  <span
                                    style={{
                                      padding: '2px 8px',
                                      borderRadius: T.radiusFull,
                                      background: T.surfaceSubtle,
                                      color: T.inkMuted,
                                      border: `1px solid ${T.border}`,
                                    }}
                                  >
                                    Cenário: {row.setting}
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Extracted Speech Bubbles / Text */}
                            {row.extractedDialogues.length > 0 && (
                              <div
                                style={{
                                  padding: '8px 10px',
                                  borderRadius: T.radiusSm,
                                  background: T.surfaceSubtle,
                                  border: `1px solid ${T.border}`,
                                  fontSize: 12,
                                }}
                              >
                                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: T.inkSubtle, marginBottom: 4 }}>
                                  Texto extraído dos balões ({row.extractedDialogues.length})
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {row.extractedDialogues.map((d, dIdx) => (
                                    <div key={dIdx} style={{ color: T.ink, lineHeight: 1.45 }}>
                                      <span style={{ fontFamily: T.mono, fontSize: 10, color: T.accent, marginRight: 6 }}>
                                        [{(d.kind ?? (d.isNarration ? 'narration' : 'dialogue')).toUpperCase()}]
                                      </span>
                                      {d.speaker && <strong style={{ marginRight: 4 }}>{d.speaker}:</strong>}
                                      <span>"{d.translatedText ?? d.text}"</span>
                                      {d.originalText && d.translatedText && d.originalText !== d.translatedText && (
                                        <span style={{ marginLeft: 6, fontSize: 11, color: T.inkSubtle }}>
                                          (orig.: "{d.originalText}")
                                        </span>
                                      )}
                                      {d.uncertainty && (
                                        <span style={{ marginLeft: 6, fontSize: 11, color: T.warning }}>
                                          · {d.uncertainty}
                                        </span>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Low confidence / Gate G / Uncertainty alerts */}
                            {isLowConfidence && (
                              <div
                                style={{
                                  padding: '8px 10px',
                                  borderRadius: T.radiusSm,
                                  background: T.warningBg,
                                  border: `1px solid ${T.warningBorder}`,
                                  color: T.warning,
                                  fontSize: 11,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 3,
                                }}
                              >
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700 }}>
                                  <AlertTriangle style={{ width: 13, height: 13, flexShrink: 0 }} />
                                  <span>Alerta de revisão / confiança</span>
                                </div>
                                {row.reviewNotes && <span>{row.reviewNotes}</span>}
                                {row.uncertainties.map((u, uIdx) => (
                                  <span key={`u-${uIdx}`}>• {u}</span>
                                ))}
                                {sceneHints.map((h, hIdx) => (
                                  <span key={`h-${hIdx}`}>• [{h.issueCode}] {h.detail}</span>
                                ))}
                              </div>
                            )}

                            {/* Editable Narration */}
                            <div>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <label
                                    htmlFor={`narration-${row.sceneId}`}
                                    style={{ fontSize: 11, fontWeight: 600, color: T.inkMuted }}
                                  >
                                    Narração da cena
                                  </label>
                                  <span style={{ fontSize: 10, fontWeight: 700, color: T.accentInk, background: '#f4f4f6', padding: '1px 7px', borderRadius: 9999 }}>
                                    {scriptStyle}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedVisualScenes((prev) => ({
                                      ...prev,
                                      [row.sceneId]: !prev[row.sceneId],
                                    }))
                                  }
                                  style={{
                                    background: 'transparent',
                                    border: 'none',
                                    padding: 0,
                                    fontSize: 11,
                                    fontWeight: 600,
                                    color: T.accent,
                                    cursor: 'pointer',
                                  }}
                                >
                                  {showVisualComparison ? 'Ocultar análise visual detalhada' : 'Ver análise visual detalhada'}
                                </button>
                              </div>
                              <textarea
                                id={`narration-${row.sceneId}`}
                                value={row.narrationText}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  const next = [...scenes];
                                  next[idx] = {
                                    ...row,
                                    narrationText: val,
                                    estimatedDurationSec: estimateTextDurationSec(val),
                                    dirty: true,
                                  };
                                  setScenes(next);
                                }}
                                rows={3}
                                style={{ ...inputStyle, resize: 'vertical', lineHeight: 1.55 }}
                              />
                            </div>

                            {/* Collapsible visual analysis comparison (strictly separated from narration) */}
                            {showVisualComparison && (
                              <div
                                style={{
                                  padding: '10px 12px',
                                  borderRadius: T.radiusSm,
                                  background: '#f8f7fc',
                                  border: `1px solid ${T.border}`,
                                  fontSize: 12,
                                  color: T.inkMuted,
                                  lineHeight: 1.5,
                                  display: 'flex',
                                  flexDirection: 'column',
                                  gap: 6,
                                }}
                              >
                                <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: T.accentInk }}>
                                  Análise visual detalhada (separada do roteiro)
                                </div>
                                <div>
                                  <strong style={{ color: T.ink }}>Descrição técnica: </strong>
                                  <span style={{ color: T.ink }}>
                                    {row.visualSummary || row.eventDescription || 'Sem descrição visual detalhada registrada.'}
                                  </span>
                                </div>
                                <div>
                                  <strong style={{ color: T.ink }}>Ações identificadas: </strong>
                                  {row.actions && row.actions.length > 0 ? (
                                    <span>{row.actions.map((a) => `[${a.type}] ${a.description}`).join(' · ')}</span>
                                  ) : (
                                    <span>Nenhuma ação específica registrada.</span>
                                  )}
                                </div>
                                <div>
                                  <strong style={{ color: T.ink }}>Diálogos extraídos: </strong>
                                  {row.extractedDialogues.length > 0 ? (
                                    <span>
                                      {row.extractedDialogues
                                        .map((d) => `${d.speaker ? `${d.speaker}: ` : ''}"${d.translatedText?.trim() || d.text}"`)
                                        .join(' | ')}
                                    </span>
                                  ) : (
                                    <span>Nenhum diálogo extraído.</span>
                                  )}
                                </div>
                                <div>
                                  <strong style={{ color: T.ink }}>Personagens reconhecidos: </strong>
                                  <span>{row.characters.length > 0 ? row.characters.join(', ') : 'Nenhum personagem identificado.'}</span>
                                </div>
                              </div>
                            )}

                            {/* Per-scene action bar */}
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                              {row.dirty && (
                                <button
                                  type="button"
                                  disabled={isSavingThis}
                                  onClick={() => void handleSaveSceneEdit(row.sceneId, row.narrationText)}
                                  style={{
                                    ...btnPrimary,
                                    padding: '5px 11px',
                                    fontSize: 11,
                                    opacity: isSavingThis ? 0.6 : 1,
                                  }}
                                >
                                  {isSavingThis ? 'Salvando…' : 'Salvar narração'}
                                </button>
                              )}
                              {activeProject?.runId && (
                                <button
                                  type="button"
                                  disabled={isRegeneratingThis || regeneratingScript}
                                  onClick={() => void handleRegenerateScene(row.sceneId)}
                                  style={{
                                    ...btnSecondary,
                                    padding: '5px 11px',
                                    fontSize: 11,
                                    opacity: isRegeneratingThis ? 0.6 : 1,
                                  }}
                                >
                                  <RefreshCw style={{ width: 12, height: 12 }} />
                                  {isRegeneratingThis ? 'Regenerando…' : 'Regenerar narração'}
                                </button>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </BentoBlock>

              {/* Prompt Revision */}
              <BentoBlock>
                <SectionLabel>Revisão Incremental por Prompt</SectionLabel>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={revisionPrompt}
                    onChange={(e) => setRevisionPrompt(e.target.value)}
                    placeholder="Ex: Deixe a cena 2 mais dramática ou reduza a música…"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button type="button" onClick={() => void handlePlanRevision()} style={btnPrimary}>
                    Simular Impacto
                  </button>
                </div>
                {impactPlan && (
                  <div
                    style={{
                      marginTop: 12,
                      padding: 12,
                      borderRadius: T.radiusInner,
                      background: T.surfaceSubtle,
                      border: `1px solid ${T.border}`,
                      fontSize: 12,
                    }}
                  >
                    <strong style={{ color: T.ink }}>{impactPlan.summary}</strong>
                    <p style={{ margin: '6px 0 0', color: T.inkMuted, fontFamily: T.mono }}>
                      Reprocessar: {impactPlan.reprocessStages.join(', ') || 'nenhuma'} · Reaproveitar: {impactPlan.reusedStages.join(', ')}
                    </p>
                  </div>
                )}
              </BentoBlock>
            </div>

            {/* Right: Real Quality Scorecard + Publication + Providers */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <BentoBlock>
                <SectionLabel>Release Gates (Real)</SectionLabel>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: 12 }}>
                  <MetricScore score={scorecard.technicalScore} label="Técnica" />
                  <MetricScore score={scorecard.narrativeScore} label="Narrativa" />
                  <MetricScore score={scorecard.audioScore} label="Áudio" />
                </div>

                <div
                  style={{
                    padding: '10px 12px',
                    borderRadius: T.radiusSm,
                    background: !scorecard.evaluated
                      ? T.surfaceSubtle
                      : scorecard.approvedForRelease
                        ? T.successBg
                        : T.warningBg,
                    border: `1px solid ${
                      !scorecard.evaluated ? T.border : scorecard.approvedForRelease ? T.successBorder : T.warningBorder
                    }`,
                    color: !scorecard.evaluated ? T.inkMuted : scorecard.approvedForRelease ? T.success : T.warning,
                    fontSize: 12,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  {scorecard.approvedForRelease ? (
                    <ShieldCheck style={{ width: 15, height: 15, flexShrink: 0 }} />
                  ) : (
                    <AlertTriangle style={{ width: 15, height: 15, flexShrink: 0 }} />
                  )}
                  <span>{scorecard.summary}</span>
                </div>

                {scorecard.evaluated && (
                  <div
                    style={{
                      marginTop: 10,
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: 11,
                      fontFamily: T.mono,
                      color: T.inkMuted,
                    }}
                  >
                    <span>Gate F: <strong style={{ color: T.ink }}>{scorecard.gateFVerdict ?? '—'}</strong></span>
                    <span>Gate G: <strong style={{ color: T.ink }}>{scorecard.gateGVerdict ?? '—'}</strong></span>
                    <span>Gate H: <strong style={{ color: T.ink }}>{scorecard.gateHVerdict ?? '—'}</strong></span>
                  </div>
                )}

                {scorecard.reasons.length > 0 && (
                  <ul style={{ margin: '10px 0 0', paddingLeft: 18, fontSize: 12, color: T.inkMuted, display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {scorecard.reasons.slice(0, 5).map((reason, idx) => (
                      <li key={idx}>{reason}</li>
                    ))}
                  </ul>
                )}
              </BentoBlock>

              {/* Publication */}
              <BentoBlock>
                <SectionLabel>Publicar / Agendar (Calendário Unificado)</SectionLabel>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {(['youtube', 'instagram', 'tiktok'] as const).map((plat) => {
                    const active = publishPlatforms.includes(plat);
                    return (
                      <button
                        key={plat}
                        type="button"
                        onClick={() =>
                          setPublishPlatforms((prev) =>
                            prev.includes(plat)
                              ? prev.length > 1
                                ? prev.filter((x) => x !== plat)
                                : prev
                              : [...prev, plat],
                          )
                        }
                        style={{
                          padding: '4px 10px',
                          borderRadius: T.radiusFull,
                          border: `1px solid ${active ? T.ink : T.border}`,
                          background: active ? T.ink : T.surfaceSubtle,
                          color: active ? '#ffffff' : T.inkMuted,
                          fontSize: 11,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {plat === 'youtube' ? 'YouTube' : plat === 'instagram' ? 'Instagram' : 'TikTok'}
                      </button>
                    );
                  })}
                </div>
                <label style={{ fontSize: 12, fontWeight: 600, color: T.inkMuted, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  Data de agendamento
                  <input
                    type="datetime-local"
                    value={scheduleDate}
                    onChange={(e) => setScheduleDate(e.target.value)}
                    style={inputStyle}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 11, color: T.ink }}>
                  <input
                    type="checkbox"
                    checked={publishRightsConfirmed}
                    onChange={(e) => setPublishRightsConfirmed(e.target.checked)}
                  />
                  Verifiquei os direitos de uso editorial, áudio e ausência de marcas d&apos;água proibidas
                </label>
                <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                  <button
                    type="button"
                    disabled={!activeMediaPath || !scorecard.approvedForRelease || !publishRightsConfirmed}
                    onClick={() => void handleSchedulePublication()}
                    style={{
                      ...btnLime,
                      flex: 1,
                      opacity: activeMediaPath && scorecard.approvedForRelease && publishRightsConfirmed ? 1 : 0.45,
                    }}
                  >
                    <CalendarIcon style={{ width: 14, height: 14 }} /> Publicar / Agendar
                  </button>
                  <a
                    href="#/aethera/calendar"
                    style={{ ...btnSecondary, flex: 1, textDecoration: 'none' }}
                  >
                    Calendário
                  </a>
                </div>
                {publishNote && (
                  <p style={{ margin: '10px 0 0', fontSize: 12, color: T.inkMuted }}>{publishNote}</p>
                )}
              </BentoBlock>

              {/* Provider Readiness */}
              <BentoBlock>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                  <SectionLabel>Provedores Multimodais</SectionLabel>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      disabled={testingVision}
                      onClick={() => void handleTestVisionReal()}
                      style={{ ...btnGhost, padding: '4px 8px', fontSize: 11 }}
                    >
                      <Sparkles className={testingVision ? 'animate-spin' : undefined} style={{ width: 12, height: 12 }} />
                      {testingVision ? 'Testando…' : 'Testar visão'}
                    </button>
                    <button
                      type="button"
                      disabled={readinessLoading}
                      onClick={() => void refreshReadiness(activeProject?.chapterId)}
                      style={{ ...btnGhost, padding: '4px 8px' }}
                    >
                      <RefreshCw className={readinessLoading ? 'animate-spin' : undefined} style={{ width: 12, height: 12 }} />
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {readiness.providers.length === 0 ? (
                    <p style={{ margin: 0, fontSize: 12, color: T.inkSubtle }}>
                      Clique em atualizar para verificar provedores locais.
                    </p>
                  ) : (
                    readiness.providers.map((p) => {
                      const vh = visionHealthItems.find((h) => h.providerId === p.providerId);
                      const statusLabel = vh
                        ? vh.multimodalLabel
                        : p.status === 'available'
                          ? 'CLI operacional'
                          : p.code === 'QUOTA_EXCEEDED'
                            ? 'Quota esgotada'
                            : p.code === 'AUTHENTICATION_FAILED'
                              ? 'Autenticação expirada'
                              : p.code === 'MODEL_INCOMPATIBLE'
                                ? 'Modelo incompatível'
                                : p.code ?? 'Indisponível';
                      const isMultimodalOk = vh?.multimodalStatus === 'multimodal_available';
                      const isCliReady = !vh && p.status === 'available';
                      return (
                        <div
                          key={p.providerId}
                          style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 2,
                            fontSize: 12,
                            padding: '6px 0',
                            borderBottom: `1px solid ${T.border}`,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontWeight: 600, color: T.ink }}>{p.label}</span>
                            <span
                              style={{
                                fontFamily: T.mono,
                                fontSize: 11,
                                fontWeight: 700,
                                color: isMultimodalOk
                                  ? T.success
                                  : isCliReady
                                    ? T.accent
                                    : p.status === 'circuit_open' || vh
                                      ? T.error
                                      : T.inkSubtle,
                              }}
                            >
                              {statusLabel}
                            </span>
                          </div>
                          {(vh?.detail || p.reason || p.resetAtText || vh?.resetAtText) && (
                            <span style={{ fontSize: 10, color: T.inkMuted }}>
                              {vh?.resetAtText || p.resetAtText
                                ? `Reset: ${vh?.resetAtText ?? p.resetAtText} · `
                                : ''}
                              {vh?.detail ?? p.reason ?? ''}
                            </span>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </BentoBlock>
            </div>
          </div>
        </div>
      )}

      {/* ─── STEP 1: PROJETO & STORY MEMORY — UNIVERSO DA HISTÓRIA ──────── */}
      {subTab === 'projeto' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <BentoBlock>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
              <div>
                <SectionLabel>Universo da História · Story Memory</SectionLabel>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: T.inkMuted }}>
                  Memória narrativa persistente entre capítulos. Personagens, nomes confirmados e acontecimentos são preservados sem vazar spoilers de capítulos futuros.
                </p>
              </div>
              {activeSeries && (
                <span
                  style={{
                    padding: '4px 10px',
                    borderRadius: T.radiusFull,
                    background: T.successBg,
                    color: T.success,
                    border: `1px solid ${T.successBorder}`,
                    fontSize: 11,
                    fontWeight: 700,
                    fontFamily: T.mono,
                  }}
                >
                  Memória carregada · {activeSeries.workTitle}
                </span>
              )}
            </div>

            <div style={{ display: 'grid', gap: 12, gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)' }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: T.inkMuted, display: 'flex', flexDirection: 'column', gap: 6 }}>
                Selecionar projeto existente
                <select
                  value={activeSeries?.projectId ?? ''}
                  onChange={(e) => {
                    const found = seriesProjects.find((p) => p.projectId === e.target.value) ?? null;
                    setActiveSeries(found);
                    if (found) {
                      setWorkTitle(found.workTitle);
                      setChapterNumber((found.producedChapters[found.producedChapters.length - 1] ?? 0) + 1);
                    }
                  }}
                  style={inputStyle}
                >
                  <option value="">— Nenhum projeto de memória selecionado —</option>
                  {seriesProjects.map((p) => (
                    <option key={p.projectId} value={p.projectId}>
                      {p.workTitle} ({p.producedChapters.length} caps · {p.characters.length} personagens)
                    </option>
                  ))}
                </select>
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: T.inkMuted }}>Criar novo projeto de obra</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    value={newSeriesTitle}
                    onChange={(e) => setNewSeriesTitle(e.target.value)}
                    placeholder="Ex: Nano Machine"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button type="button" onClick={() => void handleCreateSeriesProject()} style={btnPrimary}>
                    <Plus style={{ width: 14, height: 14 }} /> Criar
                  </button>
                </div>
              </div>
            </div>
          </BentoBlock>

          {activeSeries ? (
            <>
              <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'minmax(0, 1fr) 340px', alignItems: 'start' }}>
                <BentoBlock>
                  <SectionLabel>{activeSeries.workTitle} — Resumo da Memória</SectionLabel>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 12 }}>
                    <div style={{ padding: 14, borderRadius: T.radiusInner, background: T.surfaceSubtle, border: `1px solid ${T.border}` }}>
                      <div style={{ fontSize: 26, fontWeight: 800, fontFamily: T.mono, color: T.ink }}>
                        {String(activeSeries.producedChapters.length).padStart(2, '0')}
                      </div>
                      <div style={{ fontSize: 12, color: T.inkMuted }}>Capítulos</div>
                    </div>
                    <div style={{ padding: 14, borderRadius: T.radiusInner, background: T.surfaceSubtle, border: `1px solid ${T.border}` }}>
                      <div style={{ fontSize: 26, fontWeight: 800, fontFamily: T.mono, color: T.ink }}>
                        {String(activeSeries.characters.length).padStart(2, '0')}
                      </div>
                      <div style={{ fontSize: 12, color: T.inkMuted }}>Personagens</div>
                    </div>
                    <div style={{ padding: 14, borderRadius: T.radiusInner, background: T.surfaceSubtle, border: `1px solid ${T.border}` }}>
                      <div style={{ fontSize: 26, fontWeight: 800, fontFamily: T.mono, color: T.ink }}>
                        {String(activeSeries.chapters.reduce((s, c) => s + c.events.length, 0)).padStart(2, '0')}
                      </div>
                      <div style={{ fontSize: 12, color: T.inkMuted }}>Eventos</div>
                    </div>
                  </div>
                </BentoBlock>

                <BentoBlock>
                  <SectionLabel>Produzir novo capítulo</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                    <label style={{ fontSize: 12, fontWeight: 600, color: T.inkMuted, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      Número do capítulo
                      <input
                        type="number"
                        min={1}
                        value={chapterNumber}
                        onChange={(e) => setChapterNumber(Math.max(1, Number(e.target.value) || 1))}
                        style={inputStyle}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setWorkTitle(`${activeSeries.workTitle} Cap. ${chapterNumber}`);
                        setScriptStyle('natural_recap');
                        setSubTab('capitulos');
                        setStatusNote(`Continuando "${activeSeries.workTitle}" no Capítulo ${chapterNumber} com memória narrativa carregada.`);
                      }}
                      style={btnLime}
                    >
                      <Play style={{ width: 14, height: 14 }} />
                      Continuar {activeSeries.workTitle} (Cap. {chapterNumber})
                    </button>
                  </div>
                </BentoBlock>
              </div>

              {activeSeries.pendingUpdates.length > 0 && (
                <BentoBlock>
                  <SectionLabel>Revisão de Atualizações da Memória ({activeSeries.pendingUpdates.length})</SectionLabel>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                    {activeSeries.pendingUpdates.map((upd) => (
                      <div
                        key={upd.updateId}
                        style={{
                          padding: 10,
                          borderRadius: T.radiusSm,
                          background: T.warningBg,
                          border: `1px solid ${T.warningBorder}`,
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 10,
                        }}
                      >
                        <div style={{ fontSize: 12, color: T.ink }}>
                          <strong style={{ fontFamily: T.mono, marginRight: 6 }}>Cap. {upd.chapterNumber}</strong>
                          <span>{upd.summary}</span>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <button
                            type="button"
                            onClick={() => void handleResolveMemoryUpdate(upd.updateId, 'approved')}
                            style={{ ...btnPrimary, padding: '4px 10px', fontSize: 11 }}
                          >
                            Aprovar
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleResolveMemoryUpdate(upd.updateId, 'rejected')}
                            style={{ ...btnSecondary, padding: '4px 10px', fontSize: 11 }}
                          >
                            Rejeitar
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </BentoBlock>
              )}

              <BentoBlock>
                <SectionLabel>Biblioteca de Personagens ({activeSeries.characters.length})</SectionLabel>
                {activeSeries.characters.length === 0 ? (
                  <p style={{ margin: '10px 0 0', fontSize: 12, color: T.inkMuted }}>
                    Nenhum personagem registrado ainda. Produza o primeiro capítulo deste projeto para popular automaticamente o registro.
                  </p>
                ) : (
                  <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', marginTop: 12 }}>
                    {activeSeries.characters.map((ch) => {
                      const isEditing = editingCharId === ch.characterId;
                      return (
                        <div
                          key={ch.characterId}
                          style={{
                            padding: 12,
                            borderRadius: T.radiusInner,
                            border: `1px solid ${T.border}`,
                            background: T.surface,
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8,
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                            <strong style={{ fontSize: 13, color: T.ink }}>
                              {ch.primaryName || `Personagem #${ch.characterId.replace('char_', '')}`}
                            </strong>
                            <span
                              style={{
                                fontSize: 10,
                                fontFamily: T.mono,
                                padding: '2px 7px',
                                borderRadius: T.radiusFull,
                                background: ch.nameStatus === 'confirmed' ? T.successBg : T.warningBg,
                                color: ch.nameStatus === 'confirmed' ? T.success : T.warning,
                                border: `1px solid ${ch.nameStatus === 'confirmed' ? T.successBorder : T.warningBorder}`,
                              }}
                            >
                              {ch.nameStatus === 'confirmed' ? 'Confirmado' : ch.nameStatus === 'probable' ? 'Provável' : 'Desconhecido'}
                            </span>
                          </div>
                          <div style={{ fontSize: 11, fontFamily: T.mono, color: T.inkSubtle }}>
                            ID: {ch.characterId} · Caps: {ch.appearedInChapters.join(', ')} · Conf.: {Math.round(ch.confidence * 100)}%
                            {ch.lockedByHuman ? ' · Protegido (manual)' : ''}
                          </div>
                          {ch.visualTraits.length > 0 && (
                            <div style={{ fontSize: 12, color: T.inkMuted, lineHeight: 1.4 }}>
                              {ch.visualTraits.slice(0, 2).join(' · ')}
                            </div>
                          )}
                          {isEditing ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                              <input
                                value={editingCharName}
                                onChange={(e) => setEditingCharName(e.target.value)}
                                placeholder="Nome confirmado"
                                style={inputStyle}
                              />
                              <input
                                value={editingCharAliases}
                                onChange={(e) => setEditingCharAliases(e.target.value)}
                                placeholder="Apelidos (separados por vírgula)"
                                style={inputStyle}
                              />
                              <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                <button type="button" onClick={() => setEditingCharId(null)} style={{ ...btnSecondary, padding: '4px 9px', fontSize: 11 }}>
                                  Cancelar
                                </button>
                                <button type="button" onClick={() => void handleSaveCharacterCorrection(ch.characterId)} style={{ ...btnPrimary, padding: '4px 9px', fontSize: 11 }}>
                                  Salvar
                                </button>
                              </div>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingCharId(ch.characterId);
                                setEditingCharName(ch.primaryName ?? '');
                                setEditingCharAliases(ch.aliases.join(', '));
                              }}
                              style={{ ...btnSecondary, padding: '4px 10px', fontSize: 11, alignSelf: 'flex-start' }}
                            >
                              Corrigir identidade / nome
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </BentoBlock>

              <BentoBlock>
                <SectionLabel>Histórico da História ({activeSeries.chapters.length} capítulos)</SectionLabel>
                {activeSeries.chapters.length === 0 ? (
                  <p style={{ margin: '10px 0 0', fontSize: 12, color: T.inkMuted }}>
                    Nenhum capítulo consolidado na memória ainda.
                  </p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
                    {activeSeries.chapters.map((ch) => (
                      <div
                        key={ch.chapterNumber}
                        style={{
                          padding: 12,
                          borderRadius: T.radiusInner,
                          border: `1px solid ${T.border}`,
                          background: T.surfaceSubtle,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                          <strong style={{ fontSize: 13, color: T.ink }}>Capítulo {ch.chapterNumber}</strong>
                          <span style={{ fontSize: 11, fontFamily: T.mono, color: T.inkMuted }}>
                            {ch.events.length} evento(s) · {ch.locations.slice(0, 2).join(', ') || 'local não informado'}
                          </span>
                        </div>
                        <p style={{ margin: 0, fontSize: 12, color: T.inkMuted, lineHeight: 1.5 }}>{ch.summary}</p>
                      </div>
                    ))}
                  </div>
                )}
              </BentoBlock>
            </>
          ) : (
            <BentoBlock>
              <div style={{ textAlign: 'center', padding: '28px 16px' }}>
                <BookOpen style={{ width: 28, height: 28, color: T.inkSubtle, margin: '0 auto 8px' }} />
                <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: T.ink }}>
                  Crie ou selecione um projeto de obra para ativar o Story Memory
                </p>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: T.inkMuted }}>
                  Assim o Aethera manterá personagens, nomes confirmados, relações e eventos entre capítulos automaticamente.
                </p>
              </div>
            </BentoBlock>
          )}
        </div>
      )}

      {/* Interactive Persistent Browser Progress Modal (8 Required States) */}
      {interactiveModalOpen && interactiveSession && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="recap-interactive-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 65,
            background: 'rgba(17, 17, 17, 0.48)',
            backdropFilter: 'blur(6px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 540,
              borderRadius: T.radiusCard,
              background: T.surface,
              border: `1px solid ${T.border}`,
              boxShadow: '0 24px 64px rgba(17, 17, 17, 0.22)',
              padding: 24,
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
              <div>
                <h3 id="recap-interactive-modal-title" style={{ margin: 0, fontSize: 16, fontWeight: 700, color: T.ink }}>
                  Importação Interativa com Navegador Persistente
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: 12, color: T.inkMuted }}>
                  Perfil isolado: <span style={{ fontFamily: T.mono }}>{interactiveSession.originKey}</span>
                </p>
              </div>
              {['completed', 'access_denied', 'session_expired', 'cancelled'].includes(interactiveSession.state) && (
                <button
                  type="button"
                  aria-label="Fechar modal"
                  onClick={() => setInteractiveModalOpen(false)}
                  style={{ ...btnGhost, padding: 6 }}
                >
                  <X style={{ width: 16, height: 16 }} />
                </button>
              )}
            </div>

            {/* 8-State Progress Stepper */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 6 }}>
              {(
                [
                  ['opening_browser', '1. Abrindo navegador'],
                  ['awaiting_user_verification', '2. Aguardando verificação do usuário'],
                  ['verifying_access', '3. Verificando acesso'],
                  ['access_authorized', '4. Acesso autorizado'],
                  ['importing_chapters', '5. Importando capítulos'],
                  ['preparing_cbz', '6. Preparando CBZ'],
                  ['completed', '7. Concluído'],
                  ['access_denied', '8. Acesso negado'],
                ] as const
              ).map(([stKey, stLabel]) => {
                const order = [
                  'opening_browser',
                  'awaiting_user_verification',
                  'verifying_access',
                  'access_authorized',
                  'importing_chapters',
                  'preparing_cbz',
                  'completed',
                ];
                const curIdx = order.indexOf(interactiveSession.state);
                const itemIdx = order.indexOf(stKey);
                const isActive = interactiveSession.state === stKey;
                const isDone = stKey !== 'access_denied' && curIdx > itemIdx && itemIdx >= 0;
                const isDenied = stKey === 'access_denied' && interactiveSession.state === 'access_denied';
                return (
                  <div
                    key={stKey}
                    style={{
                      padding: '7px 10px',
                      borderRadius: T.radiusSm,
                      fontSize: 11,
                      fontWeight: isActive || isDenied ? 700 : 500,
                      border: `1px solid ${
                        isDenied
                          ? T.errorBorder
                          : isActive
                            ? T.accent
                            : isDone
                              ? T.successBorder
                              : T.border
                      }`,
                      background: isDenied
                        ? T.errorBg
                        : isActive
                          ? T.accentSoft
                          : isDone
                            ? T.successBg
                            : T.surfaceSubtle,
                      color: isDenied
                        ? T.error
                        : isActive
                          ? T.accentInk
                          : isDone
                            ? T.success
                            : T.inkMuted,
                    }}
                  >
                    {stLabel}
                  </div>
                );
              })}
            </div>

            {/* Live Status Box */}
            <div
              style={{
                padding: '12px 14px',
                borderRadius: T.radiusInner,
                background:
                  interactiveSession.state === 'access_denied'
                    ? T.errorBg
                    : interactiveSession.state === 'session_expired'
                      ? T.warningBg
                      : interactiveSession.state === 'completed'
                        ? T.successBg
                        : T.surfaceSubtle,
                border: `1px solid ${
                  interactiveSession.state === 'access_denied'
                    ? T.errorBorder
                    : interactiveSession.state === 'session_expired'
                      ? T.warningBorder
                      : interactiveSession.state === 'completed'
                        ? T.successBorder
                        : T.border
                }`,
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>
                {interactiveSession.statusMessage}
              </div>
              {interactiveSession.totalChapters > 0 && (
                <div style={{ fontSize: 11, color: T.inkMuted, fontFamily: T.mono }}>
                  Capítulos: {interactiveSession.completedChapters}/{interactiveSession.totalChapters}
                  {interactiveSession.currentChapterPagesTotal > 0
                    ? ` · Páginas do capítulo atual: ${interactiveSession.currentChapterPagesDone}/${interactiveSession.currentChapterPagesTotal}`
                    : ''}
                </div>
              )}
              {interactiveSession.currentChapterPagesTotal > 0 && (
                <div style={{ height: 4, borderRadius: 99, background: T.border, overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${Math.min(100, Math.round((interactiveSession.currentChapterPagesDone / interactiveSession.currentChapterPagesTotal) * 100))}%`,
                      background: T.accent,
                      transition: 'width 180ms ease-out',
                    }}
                  />
                </div>
              )}
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => void handleClearInteractiveProfile(interactiveSession.currentUrl || linkInputs[0] || '')}
                style={{ ...btnGhost, fontSize: 12 }}
              >
                <Trash2 style={{ width: 13, height: 13 }} /> Limpar dados do navegador
              </button>

              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {!['completed', 'access_denied', 'session_expired', 'cancelled'].includes(interactiveSession.state) && (
                  <button
                    type="button"
                    onClick={() => void handleCancelInteractiveImport()}
                    style={{ ...btnGhost, color: T.error, borderColor: T.errorBorder }}
                  >
                    <X style={{ width: 14, height: 14 }} /> Encerrar sessão
                  </button>
                )}
                {interactiveSession.state === 'access_denied' && (
                  <button
                    type="button"
                    onClick={() => {
                      setInteractiveModalOpen(false);
                      setOrigin('assisted');
                    }}
                    style={btnPrimary}
                  >
                    <Upload style={{ width: 14, height: 14 }} /> Usar importação por arquivos
                  </button>
                )}
                {interactiveSession.state === 'session_expired' && (
                  <button
                    type="button"
                    onClick={() => void handleStartInteractiveImport(linkInputs.map((u) => u.trim()).filter(Boolean))}
                    style={btnPrimary}
                  >
                    <RefreshCw style={{ width: 14, height: 14 }} /> Reautenticar no navegador
                  </button>
                )}
                {interactiveSession.state === 'completed' && (
                  <button
                    type="button"
                    onClick={() => setInteractiveModalOpen(false)}
                    style={btnPrimary}
                  >
                    <CheckCircle2 style={{ width: 14, height: 14 }} /> Continuar com capítulos importados
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Project Confirmation Modal (In-App, Accessible, Never window.confirm) */}
      {pendingDeleteProject && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="recap-delete-modal-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            background: 'rgba(17, 17, 17, 0.45)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          onClick={() => !deletingProjectId && setPendingDeleteProject(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 440,
              background: T.surface,
              borderRadius: T.radiusCard,
              border: `1px solid ${T.border}`,
              padding: 24,
              boxShadow: '0 24px 60px rgba(17, 17, 17, 0.22)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: T.radiusSm,
                  background: T.errorBg,
                  color: T.error,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Trash2 style={{ width: 18, height: 18 }} />
              </div>
              <h2 id="recap-delete-modal-title" style={{ margin: 0, fontSize: 17, fontWeight: 700, color: T.ink }}>
                Excluir projeto Mangá Recap?
              </h2>
            </div>

            <p style={{ margin: '0 0 8px', fontSize: 13, color: T.ink, lineHeight: 1.5 }}>
              Você está prestes a excluir <strong>{pendingDeleteProject.workTitle}</strong>.
            </p>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: T.inkMuted, lineHeight: 1.5 }}>
              O registro do projeto (<code style={{ fontFamily: T.mono }}>{pendingDeleteProject.runId}</code>), checkpoints e prévia renderizada vinculados somente a este capítulo serão removidos do disco. Os arquivos CBZ/PDF originais fora do workspace não serão apagados.
            </p>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                disabled={Boolean(deletingProjectId)}
                onClick={() => setPendingDeleteProject(null)}
                style={btnSecondary}
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={Boolean(deletingProjectId)}
                onClick={() => void confirmDeleteProject()}
                style={{ ...btnDanger, opacity: deletingProjectId ? 0.6 : 1 }}
              >
                {deletingProjectId ? 'Excluindo…' : 'Excluir Projeto'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}