import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  ChevronRight,
  Download,
  FileText,
  Film,
  Layers,
  LoaderCircle,
  Magnet,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  Save,
  Scissors,
  Search,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Upload,
  Volume2,
  Wand2,
  Waves,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { notify } from '@/components/NotificationsOverlay';
import { WaveformCanvas, type WaveformDataView } from './WaveformCanvas';
import { MediaLibraryPanel, type LibraryMediaAsset } from './MediaLibraryPanel';
import {
  resolveLivePreviewState,
  resolveMediaPlayUrl,
  resolveSelectedElementKind,
} from './editor-composition';

type LeftBinTab = 'media' | 'effects' | 'transitions' | 'titles' | 'sfx' | 'music';
type InspectorTab = 'transform' | 'color' | 'audio' | 'subtitles' | 'speed';

interface EditorClip {
  clipId: string;
  trackId?: string;
  label: string;
  startSec: number;
  durationSec: number;
  speed: number;
  sourceMediaId?: string | undefined;
  mediaId?: string | undefined;
  mediaUrl?: string | null | undefined;
  sourceUri?: string | undefined;
  sourceKind?: 'video' | 'image' | 'audio';
  thumbnailUrl?: string | null;
  transitionIn?: string | undefined;
  effects?: Array<{ effectId: string; kind: string; params: Record<string, number | string | boolean>; enabled: boolean }>;
  keyframes?: Array<{ keyframeId: string; property: string; value: number | string; time: { value: number; rate: number } }>;
}

interface ImportedAsset {
  mediaId: string;
  filePath: string;
  name: string;
  kind: 'video' | 'image' | 'audio';
  durationSec: number;
  width: number;
  height: number;
  mediaUrl: string;
  thumbnailUrl: string | null;
  waveformPeaks: number[];
}

interface AudioStemView {
  stemRole: 'voiceover' | 'music' | 'sfx' | 'ambience';
  targetGainDb: number;
  defaultGainDb?: number;
  muted?: boolean;
  duckingUnderVoiceDb?: number;
}

interface AudioMixValidationView {
  valid: boolean;
  peakRisk: boolean;
  estimatedPeakDbtp: number;
  estimatedIntegratedLufs: number;
  warnings: string[];
}

interface EditorPackageView {
  direction?: {
    treatment?: string;
    brief?: {
      prompt?: string;
      genre?: string;
      targetDurationSec?: number;
      humorIntensity?: number;
      renderProfile?: string;
    };
    narrativeBeats?: Array<{
      beatId: string;
      stage: string;
      summary: string;
      intensity?: number;
      timeRange?: { start: { value: number; rate: number }; duration: { value: number; rate: number } };
    }>;
    shots?: Array<{
      shotId: string;
      beatId: string;
      framing: string;
      cameraMotion: string;
      motionJustification: string;
      mediaGap: boolean;
    }>;
    mediaGaps?: Array<{ shotId: string; reason: string }>;
  };
  scorecard?: {
    technicalScore: number;
    audioScore: number;
    visualScore: number;
    narrativeScore: number;
    comedyScore: number;
    compositeScore: number;
  };
  releaseGates?: { passed: boolean };
  findings?: Array<{ issueId: string; severity: string; evidence: string; status: string }>;
  timeline: {
    projectId: string;
    version: number;
    renderFingerprint: string;
    resolution: { width: number; height: number };
    clips: Array<{
      clipId: string;
      trackId?: string;
      label: string;
      speed: number;
      mediaId?: string;
      sourceMediaId?: string;
      effects?: Array<{ effectId: string; kind: string; params: Record<string, number | string | boolean>; enabled: boolean }>;
      keyframes?: Array<{ keyframeId: string; property: string; value: number | string; time: { value: number; rate: number } }>;
      timelineRange: { start: { value: number; rate: number }; duration: { value: number; rate: number } };
    }>;
    sourceMedia: Record<string, { mediaId: string; kind: string; uri?: string; width?: number; height?: number; license: string }>;
  };
  colorPlan: {
    targetSpace: string;
    ffmpegColorFilterChain: string;
    grades: Array<{
      skinToneProtected: boolean;
      exposureCompensationEv?: number;
      contrastGain?: number;
      saturation?: number;
      temperatureKelvinDelta?: number;
      lut?: { lutId: string; name: string };
    }>;
  };
  soundPlan: {
    platformProfile: { integratedLufs: number };
    stems: AudioStemView[];
    sfxEvents: Array<{ cueId: string; sfxName: string; timeSeconds: number; reason: string }>;
  };
}

interface RealRenderResultView {
  mp4Path: string;
  mediaUrl: string;
  encoderUsed: string;
  narrationMode: string;
  waveformPeaks?: number[];
  stemPaths?: {
    voiceover?: string;
    music?: string;
    sfx?: string;
    ambience?: string;
    master?: string;
  };
  probe: {
    durationSec: number;
    width: number;
    height: number;
    integratedLufs: number | null;
    truePeakDbtp: number | null;
    blackFramesCount: number;
  };
}

interface CinemaProjectSummary {
  projectId: string;
  title: string;
  genre: string;
  durationSec: number;
  hasRender: boolean;
  updatedAt: string;
}

interface CinemaBridge {
  cinemaProduce?: (input: Record<string, unknown>) => Promise<EditorPackageView>;
  cinemaListProjects?: () => Promise<CinemaProjectSummary[]>;
  cinemaDeleteProject?: (projectId: string) => Promise<{ deleted: boolean; projectId: string }>;
  cinemaLoadProject?: (projectId: string) => Promise<{ pkg: EditorPackageView | null; lastRender: RealRenderResultView | null }>;
  cinemaUpdateTimeline?: (input: { projectId: string; clips: EditorClip[] }) => Promise<EditorPackageView>;
  cinemaExportOtio?: (projectId: string) => Promise<{ otioJson: string }>;
  cinemaRenderRealMp4?: (input: { projectId: string; useNvenc?: boolean }) => Promise<RealRenderResultView>;
  cinemaImportMedia?: (input?: { filePath?: string }) => Promise<ImportedAsset | null>;
  cinemaListLibrary?: () => Promise<ImportedAsset[]>;
  cinemaGetProductionState?: (projectId: string) => Promise<{
    projectId: string;
    prompt: string;
    state: string;
    progressPct: number;
    completedStages: string[];
    acquiredMedia?: Array<{ mediaId: string; uri?: string; kind: string; width?: number; height?: number; license?: string }>;
    pendingMedia?: Array<{ slotIndex: number; query: string; reason: string }>;
    scriptValidation?: {
      valid: boolean;
      targetDurationSec: number;
      estimatedNarrationSec: number;
      narrationWordCount: number;
      beatCount: number;
      shotCount: number;
      coveredTimelineSec: number;
      coverageRatio: number;
      warnings: string[];
    };
  } | null>;
  cinemaUpdateScript?: (input: {
    projectId: string;
    treatment?: string;
    beats?: Array<{ beatId: string; summary?: string }>;
  }) => Promise<EditorPackageView>;
  cinemaSubmitFeedback?: (input: {
    text: string;
    projectId?: string;
    genre?: string;
  }) => Promise<unknown>;
  cinemaUpdateAudioMix?: (input: {
    projectId: string;
    stems: Array<{ stemRole: string; targetGainDb?: number; muted?: boolean; duckingUnderVoiceDb?: number }>;
    targetLufs?: number;
  }) => Promise<{ pkg: EditorPackageView; validation: AudioMixValidationView }>;
  cinemaUpdateColorPlan?: (input: {
    projectId: string;
    ffmpegColorFilterChain: string;
    targetSpace?: 'rec709' | 'rec2020_hdr' | 'srgb_web';
  }) => Promise<{ pkg: EditorPackageView }>;
  cinemaUpdateColorGrade?: (input: {
    projectId: string;
    controls: {
      targetSpace?: 'rec709' | 'rec2020_hdr' | 'srgb_web';
      exposureCompensationEv: number;
      contrastGain: number;
      saturation: number;
      temperatureKelvinDelta: number;
      curves?: { shadows: number; midtones: number; highlights: number };
      lutId?: string;
    };
  }) => Promise<{ pkg: EditorPackageView }>;
  cinemaNleOp?: (input: Record<string, unknown>) => Promise<{ pkg: EditorPackageView }>;
  cinemaExtractWaveform?: (input: { filePath: string; buckets?: number }) => Promise<{
    ok: boolean;
    data?: WaveformDataView;
    error?: string;
  }>;
  cinemaExtractThumbnail?: (input: { filePath: string; timeSec?: number }) => Promise<{
    ok: boolean;
    thumbnailUrl?: string;
    cached?: boolean;
    error?: string;
  }>;
  cinemaApplyPromptRevision?: (input: {
    projectId: string;
    instruction: string;
    selectedClipId?: string;
  }) => Promise<{
    pkg: EditorPackageView;
    summary: string;
    affectedClipIds: string[];
    affectedBuses: string[];
    requiresVideoReRender: boolean;
    requiresAudioReRender: boolean;
    requiresMediaAcquisition: boolean;
    audioValidation?: AudioMixValidationView;
  }>;
}

function getBridge(): CinemaBridge | undefined {
  return (window as unknown as { aetheraBridge?: CinemaBridge }).aetheraBridge;
}

function formatTimecode(sec: number): string {
  const s = Math.max(0, sec);
  const mins = Math.floor(s / 60);
  const rem = Math.floor(s % 60);
  const frames = Math.floor((s % 1) * 30);
  return `${String(mins).padStart(2, '0')}:${String(rem).padStart(2, '0')}:${String(frames).padStart(2, '0')}`;
}

export function AetheraStudioEditor() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [projects, setProjects] = useState<CinemaProjectSummary[]>([]);
  const [pkg, setPkg] = useState<EditorPackageView | null>(null);
  const [clips, setClips] = useState<EditorClip[]>([]);
  const [history, setHistory] = useState<EditorClip[][]>([]);
  const [future, setFuture] = useState<EditorClip[][]>([]);
  const [selectedClipId, setSelectedClipId] = useState<string>('');
  const [leftTab, setLeftTab] = useState<LeftBinTab>('media');
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('transform');
  const [assistantOpen, setAssistantOpen] = useState(true);
  const [revisionText, setRevisionText] = useState('');
  const [submittingRevision, setSubmittingRevision] = useState(false);

  const [playing, setPlaying] = useState(false);
  const [playheadSec, setPlayheadSec] = useState(0);
  const [pxPerSec, setPxPerSec] = useState(26);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [previewMode, setPreviewMode] = useState<'timeline' | 'mp4'>('timeline');
  const [renderedMedia, setRenderedMedia] = useState<RealRenderResultView | null>(null);
  const [importedAssets, setImportedAssets] = useState<ImportedAsset[]>([]);
  const [librarySearch, setLibrarySearch] = useState('');
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<number | null>(null);
  const [exportingOtio, setExportingOtio] = useState(false);
  const [saving, setSaving] = useState(false);
  const [, setStatusMsgRaw] = useState<string | null>(null);
  const setStatusMsg = useCallback((msg: string | null) => {
    setStatusMsgRaw(msg);
    if (!msg) return;
    const isVideoDone = /renderizad|finalizad|concluíd/i.test(msg);
    const isError = /erro|falha/i.test(msg);
    notify({
      title: isVideoDone ? 'Vídeo finalizado' : isError ? 'Atenção no Editor' : 'Aethera Studio',
      message: msg,
      type: isError ? 'error' : 'success',
      native: isVideoDone,
    });
  }, []);
  const [playerVolume, setPlayerVolume] = useState(1);
  const [playerMuted, setPlayerMuted] = useState(false);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [previewStale, setPreviewStale] = useState(false);
  const [colorDraft, setColorDraft] = useState('');
  const [colorExpanded, setColorExpanded] = useState(false);
  const [savingColor, setSavingColor] = useState(false);
  const [colorCopied, setColorCopied] = useState(false);
  const [audioValidation, setAudioValidation] = useState<AudioMixValidationView | null>(null);
  const [savingAudio, setSavingAudio] = useState(false);
  const [previewingBus, setPreviewingBus] = useState<string | null>(null);
  const [timelineTool, setTimelineTool] = useState<'select' | 'razor'>('select');
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditTab, setAuditTab] = useState<'script' | 'direction' | 'research' | 'quality'>('script');
  const [previewAuditMedia, setPreviewAuditMedia] = useState<{
    mediaId: string;
    kind: string;
    uri: string;
    mediaUrl: string;
  } | null>(null);
  const [auditJob, setAuditJob] = useState<{
    state: string;
    progressPct: number;
    completedStages: string[];
    acquiredMedia?: Array<{ mediaId: string; uri?: string; kind: string; width?: number; height?: number; license?: string }>;
    pendingMedia?: Array<{ slotIndex: number; query: string; reason: string }>;
    scriptValidation?: {
      valid: boolean;
      targetDurationSec: number;
      estimatedNarrationSec: number;
      narrationWordCount: number;
      beatCount: number;
      shotCount: number;
      coveredTimelineSec: number;
      coverageRatio: number;
      warnings: string[];
    };
  } | null>(null);
  const [treatmentDraft, setTreatmentDraft] = useState('');
  const [beatsDraft, setBeatsDraft] = useState<Array<{ beatId: string; stage: string; summary: string; durationSec: number }>>([]);
  const [savingScript, setSavingScript] = useState(false);
  const [deleteProjectTarget, setDeleteProjectTarget] = useState<{ projectId: string; title: string } | null>(null);
  const [deletingProject, setDeletingProject] = useState(false);
  const [layoutSizes, setLayoutSizes] = useState<{
    leftPct: number;
    rightPct: number;
    timelinePx: number;
    assistantPct: number;
  }>(() => {
    try {
      const raw = localStorage.getItem('aethera_editor_layout_v1');
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<{ leftPct: number; rightPct: number; timelinePx: number; assistantPct: number }>;
        return {
          leftPct: Math.min(40, Math.max(14, Number(parsed.leftPct) || 23)),
          rightPct: Math.min(42, Math.max(16, Number(parsed.rightPct) || 26)),
          timelinePx: Math.min(480, Math.max(130, Number(parsed.timelinePx) || 215)),
          assistantPct: Math.min(45, Math.max(16, Number(parsed.assistantPct) || 25)),
        };
      }
    } catch {
      // ignore storage errors
    }
    return { leftPct: 23, rightPct: 26, timelinePx: 215, assistantPct: 25 };
  });
  const editorRootRef = useRef<HTMLDivElement | null>(null);
  const topRowRef = useRef<HTMLDivElement | null>(null);
  const bottomRowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem('aethera_editor_layout_v1', JSON.stringify(layoutSizes));
    } catch {
      // ignore storage errors
    }
  }, [layoutSizes]);

  const resetLayoutSizes = useCallback(() => {
    setLayoutSizes({ leftPct: 23, rightPct: 26, timelinePx: 215, assistantPct: 25 });
  }, []);

  const startPanelResize = useCallback(
    (kind: 'left' | 'right' | 'timeline' | 'assistant', e: React.PointerEvent) => {
      e.preventDefault();
      const prevSelect = document.body.style.userSelect;
      document.body.style.userSelect = 'none';

      const onMove = (ev: PointerEvent) => {
        if (kind === 'left' && topRowRef.current) {
          const rect = topRowRef.current.getBoundingClientRect();
          if (rect.width <= 0) return;
          const pct = ((ev.clientX - rect.left) / rect.width) * 100;
          setLayoutSizes((prev) => ({
            ...prev,
            leftPct: Math.min(40, Math.max(14, Math.min(72 - prev.rightPct, Number(pct.toFixed(1))))),
          }));
        } else if (kind === 'right' && topRowRef.current) {
          const rect = topRowRef.current.getBoundingClientRect();
          if (rect.width <= 0) return;
          const pct = ((rect.right - ev.clientX) / rect.width) * 100;
          setLayoutSizes((prev) => ({
            ...prev,
            rightPct: Math.min(42, Math.max(16, Math.min(72 - prev.leftPct, Number(pct.toFixed(1))))),
          }));
        } else if (kind === 'timeline' && editorRootRef.current) {
          const rect = editorRootRef.current.getBoundingClientRect();
          const px = rect.bottom - ev.clientY - 10;
          setLayoutSizes((prev) => ({
            ...prev,
            timelinePx: Math.min(480, Math.max(130, Math.round(px))),
          }));
        } else if (kind === 'assistant' && bottomRowRef.current) {
          const rect = bottomRowRef.current.getBoundingClientRect();
          if (rect.width <= 0) return;
          const pct = ((rect.right - ev.clientX) / rect.width) * 100;
          setLayoutSizes((prev) => ({
            ...prev,
            assistantPct: Math.min(45, Math.max(16, Number(pct.toFixed(1)))),
          }));
        }
      };

      const onUp = () => {
        document.body.style.userSelect = prevSelect;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [],
  );
  const [visualTransform, setVisualTransform] = useState({
    blendMode: 'normal',
    opacity: 1,
    scale: 1,
    rotationDeg: 0,
    x: 0,
    y: 0,
  });
  const [transitionDraft, setTransitionDraft] = useState({ kind: 'dissolve', durationSec: 0.5 });
  const [colorControls, setColorControls] = useState({
    exposureCompensationEv: 0,
    contrastGain: 1.04,
    saturation: 1.03,
    temperatureKelvinDelta: 0,
    shadows: 0,
    midtones: 0,
    highlights: 0,
    lutId: 'rec709_clean_cinematic',
  });
  const [subtitleDraft, setSubtitleDraft] = useState({
    text: '',
    durationSec: 3.0,
    animation: 'fade_up' as 'fade_up' | 'pop' | 'slide' | 'none',
  });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const scrubbingRef = useRef(false);
  const dragClipRef = useRef<{ clipId: string; startX: number; initialStartSec: number } | null>(null);

  const mapClipsFromPkg = useCallback((res: EditorPackageView): EditorClip[] => {
    return res.timeline.clips.map((c) => {
      const mId = c.mediaId ?? c.sourceMediaId ?? '';
      return {
        clipId: c.clipId,
        trackId: c.trackId ?? 'v1',
        label: c.label,
        startSec: Number((c.timelineRange.start.value / c.timelineRange.start.rate).toFixed(2)),
        durationSec: Number((c.timelineRange.duration.value / c.timelineRange.duration.rate).toFixed(2)),
        speed: c.speed,
        sourceMediaId: mId,
        sourceUri: res.timeline.sourceMedia[mId]?.uri,
        ...(c.effects ? { effects: c.effects } : {}),
        ...(c.keyframes ? { keyframes: c.keyframes } : {}),
      };
    });
  }, []);

  const refreshProjects = useCallback(async () => {
    const api = getBridge();
    if (!api?.cinemaListProjects) return [];
    const list = await api.cinemaListProjects();
    setProjects(list);
    return list;
  }, []);

  const loadProjectById = useCallback(
    async (projectId: string) => {
      const api = getBridge();
      if (!api?.cinemaLoadProject) return false;
      const loaded = await api.cinemaLoadProject(projectId);
      if (!loaded?.pkg) return false;
      setPkg(loaded.pkg);
      const mapped = mapClipsFromPkg(loaded.pkg);
      setClips(mapped);
      setHistory([]);
      setFuture([]);
      setSelectedClipId(mapped[0]?.clipId ?? '');
      if (loaded.lastRender) {
        setRenderedMedia(loaded.lastRender);
        setPreviewMode('mp4');
      } else {
        setRenderedMedia(null);
        setPreviewMode('timeline');
      }
      setPlayheadSec(0);
      setPlaying(false);
      return true;
    },
    [mapClipsFromPkg],
  );

  useEffect(() => {
    const api = getBridge();
    if (!api?.cinemaListLibrary) return;
    void api.cinemaListLibrary().then((items) => {
      if (Array.isArray(items) && items.length > 0) {
        setImportedAssets((prev) => {
          const seen = new Set(prev.map((a) => a.mediaId));
          return [...prev, ...items.filter((i) => !seen.has(i.mediaId))];
        });
      }
    });
  }, []);

  useEffect(() => {
    const api = getBridge();
    if (!api) return;
    const requestedId = searchParams.get('projectId') ?? '__latest__';
    const init = async () => {
      await refreshProjects();
      const loadedOk = await loadProjectById(requestedId);
      if (!loadedOk) {
        setPkg(null);
        setClips([]);
        setSelectedClipId('');
        setRenderedMedia(null);
      }
    };
    void init();
  }, [loadProjectById, refreshProjects, searchParams]);

  const totalDurationSec = useMemo(() => {
    const maxEnd = clips.reduce((acc, c) => Math.max(acc, c.startSec + c.durationSec / Math.max(0.25, c.speed)), 0);
    return Math.max(12, Number(maxEnd.toFixed(2)));
  }, [clips]);

  const selectedClip = clips.find((c) => c.clipId === selectedClipId) ?? clips[0];
  const activeClipAtPlayhead = useMemo(
    () =>
      clips.find((c) => {
        const effectiveDur = c.durationSec / Math.max(0.25, c.speed);
        return playheadSec >= c.startSec && playheadSec <= c.startSec + effectiveDur;
      }) ?? clips[0],
    [clips, playheadSec],
  );

  const mediaElementsRef = useRef<Map<string, HTMLVideoElement | HTMLImageElement>>(new Map());
  const liveAudioRef = useRef<HTMLAudioElement | null>(null);
  const [mediaLoadTick, setMediaLoadTick] = useState(0);

  const resolveClipMediaUrl = useCallback(
    (clip?: EditorClip | null): string | null => {
      if (!clip) return null;
      if (clip.mediaUrl) return resolveMediaPlayUrl(clip.mediaUrl);
      const sm =
        (clip.sourceMediaId && pkg?.timeline.sourceMedia[clip.sourceMediaId]) ||
        (clip.mediaId && pkg?.timeline.sourceMedia[clip.mediaId]) ||
        undefined;
      if (sm?.uri) return resolveMediaPlayUrl(sm.uri);
      const matchedAsset = importedAssets.find(
        (a) => a.mediaId === clip.mediaId || a.mediaId === clip.sourceMediaId || a.name === clip.label,
      );
      if (matchedAsset) return resolveMediaPlayUrl(matchedAsset.mediaUrl || matchedAsset.filePath);
      return null;
    },
    [importedAssets, pkg?.timeline.sourceMedia],
  );

  const activeClipMediaUrl = useMemo(
    () => resolveClipMediaUrl(activeClipAtPlayhead),
    [activeClipAtPlayhead, resolveClipMediaUrl],
  );

  const livePreviewStatus = useMemo(
    () =>
      resolveLivePreviewState({
        rendering,
        previewMode,
        hasRenderedMp4: Boolean(renderedMedia),
        activeClip: activeClipAtPlayhead ?? null,
        resolvedMediaUrl: activeClipMediaUrl,
      }),
    [rendering, previewMode, renderedMedia, activeClipAtPlayhead, activeClipMediaUrl],
  );

  // Sync audio stem/master during live timeline playback
  useEffect(() => {
    const audioEl = liveAudioRef.current;
    if (!audioEl) return;
    if (previewMode !== 'timeline') {
      audioEl.pause();
      return;
    }
    const audioUrl = resolveMediaPlayUrl(
      renderedMedia?.stemPaths?.master ?? renderedMedia?.stemPaths?.voiceover ?? null,
    );
    if (!audioUrl) {
      audioEl.pause();
      return;
    }
    if (audioEl.src !== audioUrl) {
      audioEl.src = audioUrl;
    }
    audioEl.volume = playerMuted ? 0 : playerVolume;
    audioEl.muted = playerMuted;
    if (Math.abs(audioEl.currentTime - playheadSec) > 0.25) {
      audioEl.currentTime = Math.max(0, playheadSec);
    }
    if (playing) {
      void audioEl.play().catch(() => undefined);
    } else {
      audioEl.pause();
    }
  }, [previewMode, playing, playheadSec, playerMuted, playerVolume, renderedMedia]);

  // Synced live canvas preview when in timeline preview mode (real video/image frames + overlays)
  useEffect(() => {
    if (previewMode !== 'timeline') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const clip = activeClipAtPlayhead;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#05050a';
    ctx.fillRect(0, 0, w, h);

    if (!clip || !activeClipMediaUrl) {
      ctx.fillStyle = 'rgba(24, 20, 36, 0.9)';
      ctx.fillRect(w / 2 - 180, h / 2 - 44, 360, 88);
      ctx.strokeStyle = 'rgba(244, 63, 94, 0.6)';
      ctx.strokeRect(w / 2 - 180, h / 2 - 44, 360, 88);
      ctx.fillStyle = '#fda4af';
      ctx.font = '600 16px Inter, Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Mídia Indisponível', w / 2, h / 2 - 8);
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12px Inter, Segoe UI, sans-serif';
      ctx.fillText(
        clip ? `${clip.label} — arquivo de vídeo/imagem ausente` : 'Nenhum clipe na posição do playhead',
        w / 2,
        h / 2 + 18,
      );
      ctx.textAlign = 'left';
      return;
    }

    const isImg = /\.(png|jpe?g|webp|gif|svg)(\?|$)/i.test(activeClipMediaUrl);
    let mediaEl = mediaElementsRef.current.get(activeClipMediaUrl);
    if (!mediaEl) {
      if (isImg) {
        const img = new Image();
        img.onload = () => setMediaLoadTick((n) => n + 1);
        img.onerror = () => setMediaLoadTick((n) => n + 1);
        img.src = activeClipMediaUrl;
        mediaEl = img;
      } else {
        const vid = document.createElement('video');
        vid.preload = 'auto';
        vid.playsInline = true;
        vid.muted = true;
        vid.onloadeddata = () => setMediaLoadTick((n) => n + 1);
        vid.onseeked = () => setMediaLoadTick((n) => n + 1);
        vid.onerror = () => setMediaLoadTick((n) => n + 1);
        vid.src = activeClipMediaUrl;
        mediaEl = vid;
      }
      mediaElementsRef.current.set(activeClipMediaUrl, mediaEl);
    }

    const isSelected = clip.clipId === selectedClipId;
    const scale = isSelected ? visualTransform.scale : 1;
    const opacity = isSelected ? visualTransform.opacity : 1;
    const rotRad = isSelected ? (visualTransform.rotationDeg * Math.PI) / 180 : 0;

    let drawn = false;
    if (mediaEl instanceof HTMLVideoElement) {
      const localSec = Math.max(0, (playheadSec - clip.startSec) * Math.max(0.25, clip.speed));
      if (Math.abs(mediaEl.currentTime - localSec) > 0.12 && mediaEl.readyState >= 1) {
        mediaEl.currentTime = localSec;
      }
      if (playing && mediaEl.paused && mediaEl.readyState >= 2) {
        void mediaEl.play().catch(() => undefined);
      } else if (!playing && !mediaEl.paused) {
        mediaEl.pause();
      }
      if (mediaEl.readyState >= 2 && mediaEl.videoWidth > 0) {
        const ratio = Math.min(w / mediaEl.videoWidth, h / mediaEl.videoHeight);
        const dw = mediaEl.videoWidth * ratio;
        const dh = mediaEl.videoHeight * ratio;
        ctx.save();
        ctx.globalAlpha = opacity;
        ctx.translate(w / 2, h / 2);
        ctx.rotate(rotRad);
        ctx.scale(scale, scale);
        ctx.drawImage(mediaEl, -dw / 2, -dh / 2, dw, dh);
        ctx.restore();
        drawn = true;
      }
    } else if (mediaEl instanceof HTMLImageElement && mediaEl.complete && mediaEl.naturalWidth > 0) {
      const ratio = Math.min(w / mediaEl.naturalWidth, h / mediaEl.naturalHeight);
      const dw = mediaEl.naturalWidth * ratio;
      const dh = mediaEl.naturalHeight * ratio;
      ctx.save();
      ctx.globalAlpha = opacity;
      ctx.translate(w / 2, h / 2);
      ctx.rotate(rotRad);
      ctx.scale(scale, scale);
      ctx.drawImage(mediaEl, -dw / 2, -dh / 2, dw, dh);
      ctx.restore();
      drawn = true;
    }

    if (!drawn) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '13px Inter, Segoe UI, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Carregando mídia real: ${clip.label}...`, w / 2, h / 2);
      ctx.textAlign = 'left';
    }

    // Active V3 HUD / Title overlay synced to playhead
    const activeOverlay = clips.find(
      (c) =>
        (c.trackId === 'vfx1' || c.trackId === 'sub1') &&
        playheadSec >= c.startSec &&
        playheadSec <= c.startSec + c.durationSec / Math.max(0.25, c.speed),
    );
    if (activeOverlay) {
      ctx.fillStyle = 'rgba(9, 9, 16, 0.72)';
      ctx.fillRect(36, h - 68, w - 72, 42);
      ctx.fillStyle = '#f8fafc';
      ctx.font = '600 15px Inter, Segoe UI, sans-serif';
      ctx.fillText(activeOverlay.label, 52, h - 42);
    }
  }, [
    activeClipAtPlayhead,
    activeClipMediaUrl,
    clips,
    mediaLoadTick,
    playheadSec,
    playing,
    previewMode,
    selectedClipId,
    visualTransform.opacity,
    visualTransform.rotationDeg,
    visualTransform.scale,
  ]);

  // Real-time playback loop in timeline mode
  useEffect(() => {
    if (!playing || previewMode !== 'timeline') return;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPlayheadSec((prev) => {
        const next = prev + dt;
        if (next >= totalDurationSec) {
          setPlaying(false);
          return 0;
        }
        return Number(next.toFixed(3));
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, previewMode, totalDurationSec]);

  useEffect(() => {
    setColorDraft(pkg?.colorPlan?.ffmpegColorFilterChain ?? '');
  }, [pkg?.colorPlan?.ffmpegColorFilterChain]);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.volume = playerMuted ? 0 : playerVolume;
    videoRef.current.muted = playerMuted;
  }, [playerVolume, playerMuted, previewMode, renderedMedia]);

  // Toggle video element when in MP4 mode
  useEffect(() => {
    if (previewMode !== 'mp4' || !videoRef.current) return;
    if (playing) {
      void videoRef.current.play().catch(() => setPlaying(false));
    } else {
      videoRef.current.pause();
    }
  }, [playing, previewMode]);

  const persistTimeline = useCallback(async (nextClips: EditorClip[]) => {
    const api = getBridge();
    if (!api?.cinemaUpdateTimeline || !pkg) return;
    setSaving(true);
    try {
      const updated = await api.cinemaUpdateTimeline({
        projectId: pkg.timeline.projectId,
        clips: nextClips,
      });
      setPkg(updated);
      setStatusMsg(`Projeto salvo (v${updated.timeline.version} · ${updated.timeline.renderFingerprint})`);
    } finally {
      setSaving(false);
    }
  }, [pkg]);

  const commitClips = useCallback((next: EditorClip[], autoSave = true) => {
    setHistory((h) => [...h, clips]);
    setFuture([]);
    setClips(next);
    if (autoSave) {
      void persistTimeline(next);
    }
  }, [clips, persistTimeline]);

  const handleUndo = useCallback(() => {
    const prev = history[history.length - 1];
    if (!prev) return;
    setFuture((f) => [clips, ...f]);
    setHistory((h) => h.slice(0, -1));
    setClips(prev);
    void persistTimeline(prev);
  }, [clips, history, persistTimeline]);

  const handleRedo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    setHistory((h) => [...h, clips]);
    setFuture((f) => f.slice(1));
    setClips(next);
    void persistTimeline(next);
  }, [clips, future, persistTimeline]);

  // Keyboard shortcuts: Ctrl+Z / Ctrl+Y / Space
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.code === 'Space') {
        e.preventDefault();
        setPlaying((p) => !p);
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleRedo, handleUndo]);

  function snapTime(sec: number, excludeClipId?: string): number {
    const clamped = Math.max(0, sec);
    if (!snapEnabled) return Number(clamped.toFixed(2));
    const grid = Math.round(clamped * 4) / 4;
    for (const c of clips) {
      if (c.clipId === excludeClipId) continue;
      const end = c.startSec + c.durationSec / Math.max(0.25, c.speed);
      if (Math.abs(clamped - end) < 0.35) return Number(end.toFixed(2));
      if (Math.abs(clamped - c.startSec) < 0.35) return Number(c.startSec.toFixed(2));
    }
    return Number(grid.toFixed(2));
  }

  function scrubToClientX(clientX: number) {
    const el = rulerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = Math.max(0, clientX - rect.left);
    const nextSec = Math.min(totalDurationSec, Number((x / pxPerSec).toFixed(2)));
    setPlayheadSec(nextSec);
    if (previewMode === 'mp4' && videoRef.current) {
      videoRef.current.currentTime = nextSec;
    }
  }

  useEffect(() => {
    const onPointerMove = (e: PointerEvent) => {
      if (scrubbingRef.current) {
        scrubToClientX(e.clientX);
      } else if (dragClipRef.current) {
        const { clipId, startX, initialStartSec } = dragClipRef.current;
        const dx = e.clientX - startX;
        const rawStart = initialStartSec + dx / pxPerSec;
        const snapped = snapTime(rawStart, clipId);
        setClips((prev) => prev.map((c) => (c.clipId === clipId ? { ...c, startSec: snapped } : c)));
      }
    };
    const onPointerUp = () => {
      scrubbingRef.current = false;
      if (dragClipRef.current) {
        dragClipRef.current = null;
        void persistTimeline(clips);
      }
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  });

  function handleTrimEnd(deltaSec: number) {
    if (!selectedClip) return;
    commitClips(
      clips.map((c) =>
        c.clipId === selectedClip.clipId
          ? { ...c, durationSec: Math.max(1.2, Number((c.durationSec + deltaSec).toFixed(2))) }
          : c,
      ),
    );
  }

  function handleRippleDelete() {
    if (!selectedClip || clips.length <= 1) return;
    const next = clips.filter((c) => c.clipId !== selectedClip.clipId);
    commitClips(next);
    setSelectedClipId(next[0]?.clipId ?? '');
  }

  function handleSpeedChange(speed: number) {
    if (!selectedClip) return;
    commitClips(clips.map((c) => (c.clipId === selectedClip.clipId ? { ...c, speed } : c)));
  }

  async function handleImportMedia(filePath?: string) {
    const api = getBridge();
    if (!api?.cinemaImportMedia) return;
    const asset = await api.cinemaImportMedia(filePath ? { filePath } : undefined);
    if (!asset) return;
    setImportedAssets((prev) => [asset, ...prev.filter((a) => a.mediaId !== asset.mediaId)]);
    setStatusMsg(`Mídia importada: ${asset.name} (${asset.durationSec}s · ${asset.width}x${asset.height})`);
  }

  function handleAddAssetToTimeline(asset: ImportedAsset) {
    const lastEnd = clips.reduce(
      (acc, c) => Math.max(acc, c.startSec + c.durationSec / Math.max(0.25, c.speed)),
      0,
    );
    const newClip: EditorClip = {
      clipId: `clip_${Date.now().toString(36)}`,
      label: asset.name.replace(/\.[^.]+$/, ''),
      startSec: Number(lastEnd.toFixed(2)),
      durationSec: Math.max(1.5, Math.min(12, asset.durationSec)),
      speed: 1,
      sourceMediaId: asset.mediaId,
      sourceUri: asset.filePath,
      sourceKind: asset.kind,
      thumbnailUrl: asset.thumbnailUrl,
    };
    commitClips([...clips, newClip]);
    setSelectedClipId(newClip.clipId);
  }

  async function handleRenderRealMp4() {
    const api = getBridge();
    if (!api?.cinemaRenderRealMp4 || !pkg) return;
    setRendering(true);
    setRenderProgress(12);
    setStatusMsg('Renderizando timeline editada via FFmpeg...');
    const timer = setInterval(() => {
      setRenderProgress((prev) => (prev !== null && prev < 92 ? prev + 4 : prev));
    }, 650);
    try {
      await persistTimeline(clips);
      setRenderProgress(35);
      const res = await api.cinemaRenderRealMp4({ projectId: pkg.timeline.projectId, useNvenc: true });
      setRenderProgress(100);
      setRenderedMedia(res);
      setPreviewMode('mp4');
      setStatusMsg(
        `MP4 real renderizado (${res.encoderUsed} · ${res.probe.durationSec.toFixed(2)}s · ${res.probe.integratedLufs ?? '—'} LUFS)`,
      );
    } catch (err) {
      setStatusMsg(`Erro ao renderizar: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearInterval(timer);
      setRendering(false);
      setRenderProgress(null);
    }
  }

  async function handleExportOtio() {
    const api = getBridge();
    if (!api?.cinemaExportOtio || !pkg) return;
    setExportingOtio(true);
    try {
      const res = await api.cinemaExportOtio(pkg.timeline.projectId);
      setStatusMsg(`OTIO exportado via IPC (${res.otioJson.length} bytes)`);
    } finally {
      setExportingOtio(false);
    }
  }

  async function handleSelectProject(nextProjectId: string) {
    if (!nextProjectId) return;
    setSearchParams({ projectId: nextProjectId });
    await loadProjectById(nextProjectId);
    setStatusMsg(`Projeto carregado: ${nextProjectId}`);
  }

  async function handleAudioBusChange(
    stemRole: AudioStemView['stemRole'],
    patch: { targetGainDb?: number; muted?: boolean },
  ) {
    if (!pkg) return;
    const clampedGain =
      patch.targetGainDb !== undefined
        ? Number(Math.max(-48, Math.min(12, patch.targetGainDb)).toFixed(1))
        : undefined;
    const nextStems = pkg.soundPlan.stems.map((s) =>
      s.stemRole === stemRole
        ? {
            ...s,
            ...(clampedGain !== undefined ? { targetGainDb: clampedGain } : {}),
            ...(patch.muted !== undefined ? { muted: patch.muted } : {}),
          }
        : s,
    );
    setPkg({ ...pkg, soundPlan: { ...pkg.soundPlan, stems: nextStems } });
    setPreviewStale(true);

    const api = getBridge();
    if (!api?.cinemaUpdateAudioMix) return;
    setSavingAudio(true);
    try {
      const res = await api.cinemaUpdateAudioMix({
        projectId: pkg.timeline.projectId,
        stems: nextStems.map((s) => ({
          stemRole: s.stemRole,
          targetGainDb: s.targetGainDb,
          muted: Boolean(s.muted),
        })),
      });
      setPkg(res.pkg);
      setAudioValidation(res.validation);
      setStatusMsg(
        res.validation.warnings.length > 0
          ? `Mixer atualizado com alerta: ${res.validation.warnings[0]}`
          : `Mixer salvo (${stemRole} · v${res.pkg.timeline.version}). Clique em "Renderizar MP4" para atualizar a prévia final.`,
      );
    } catch (err) {
      setStatusMsg(`Erro ao atualizar mixer: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingAudio(false);
    }
  }

  async function handleResetAudioBus(stemRole?: AudioStemView['stemRole']) {
    if (!pkg) return;
    const defaults: Record<string, number> = { voiceover: 0, music: -16, sfx: -8, ambience: -22 };
    const targets = pkg.soundPlan.stems
      .filter((s) => !stemRole || s.stemRole === stemRole)
      .map((s) => ({
        stemRole: s.stemRole,
        targetGainDb: s.defaultGainDb ?? defaults[s.stemRole] ?? 0,
        muted: false,
      }));
    const nextStems = pkg.soundPlan.stems.map((s) => {
      const hit = targets.find((t) => t.stemRole === s.stemRole);
      return hit ? { ...s, targetGainDb: hit.targetGainDb, muted: false } : s;
    });
    setPkg({ ...pkg, soundPlan: { ...pkg.soundPlan, stems: nextStems } });
    setPreviewStale(true);
    const api = getBridge();
    if (api?.cinemaUpdateAudioMix) {
      const res = await api.cinemaUpdateAudioMix({
        projectId: pkg.timeline.projectId,
        stems: targets,
      });
      setPkg(res.pkg);
      setAudioValidation(res.validation);
    }
    setStatusMsg(stemRole ? `Bus ${stemRole} restaurado ao padrão.` : 'Todos os buses restaurados ao padrão.');
  }

  function handlePreListenBus(stem: AudioStemView) {
    if (typeof window === 'undefined') return;
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    setPreviewingBus(stem.stemRole);
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gainNode = ctx.createGain();
    const freqs: Record<string, number> = { voiceover: 330, music: 220, sfx: 587, ambience: 146 };
    osc.type = stem.stemRole === 'ambience' ? 'triangle' : 'sine';
    osc.frequency.value = freqs[stem.stemRole] ?? 261;
    const linearGain = stem.muted ? 0 : Math.min(0.95, Math.max(0, 0.28 * Math.pow(10, stem.targetGainDb / 20)));
    gainNode.gain.setValueAtTime(0.0001, ctx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(Math.max(0.0001, linearGain), ctx.currentTime + 0.04);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.85);
    osc.connect(gainNode);
    gainNode.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.9);
    setTimeout(() => {
      void ctx.close().catch(() => {});
      setPreviewingBus((cur) => (cur === stem.stemRole ? null : cur));
    }, 950);
  }

  async function handleSaveColorChain() {
    if (!pkg || !colorDraft.trim()) return;
    const api = getBridge();
    setPreviewStale(true);
    if (!api?.cinemaUpdateColorPlan) {
      setPkg({ ...pkg, colorPlan: { ...pkg.colorPlan, ffmpegColorFilterChain: colorDraft.trim() } });
      return;
    }
    setSavingColor(true);
    try {
      const res = await api.cinemaUpdateColorPlan({
        projectId: pkg.timeline.projectId,
        ffmpegColorFilterChain: colorDraft.trim(),
      });
      setPkg(res.pkg);
      setStatusMsg(`Filtro de cor salvo (v${res.pkg.timeline.version}).`);
    } catch (err) {
      setStatusMsg(`Erro ao salvar filtro de cor: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingColor(false);
    }
  }

  async function handleCopyColorChain() {
    try {
      await navigator.clipboard.writeText(colorDraft);
      setColorCopied(true);
      setTimeout(() => setColorCopied(false), 1500);
    } catch {
      setStatusMsg('Use Ctrl+C no campo de filtro para copiar.');
    }
  }

  async function openAuditModal() {
    if (!pkg) return;
    setTreatmentDraft(pkg.direction?.treatment ?? '');
    setBeatsDraft(
      (pkg.direction?.narrativeBeats ?? []).map((b) => ({
        beatId: b.beatId,
        stage: b.stage ?? 'beat',
        summary: b.summary ?? '',
        durationSec: b.timeRange?.duration
          ? Math.round(b.timeRange.duration.value / Math.max(1, b.timeRange.duration.rate))
          : 0,
      }))
    );
    setAuditOpen(true);
    const api = getBridge();
    if (api?.cinemaGetProductionState) {
      try {
        const job = await api.cinemaGetProductionState(pkg.timeline.projectId);
        if (job && typeof job === 'object') {
          setAuditJob(job as typeof auditJob);
        } else {
          setAuditJob(null);
        }
      } catch {
        setAuditJob(null);
      }
    }
  }

  async function handleSaveScript() {
    if (!pkg) return;
    const api = getBridge();
    if (!api?.cinemaUpdateScript) {
      setStatusMsg('Ponte de edição de roteiro indisponível neste modo.');
      return;
    }
    setSavingScript(true);
    try {
      const updated = await api.cinemaUpdateScript({
        projectId: pkg.timeline.projectId,
        treatment: treatmentDraft,
        beats: beatsDraft.map((b) => ({
          beatId: b.beatId,
          summary: b.summary,
        })),
      });
      setPkg(updated);
      setPreviewStale(true);
      setStatusMsg('Roteiro e narração salvos no projeto.');
    } catch (err) {
      setStatusMsg(`Erro ao salvar roteiro: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSavingScript(false);
    }
  }

  async function handleConfirmDeleteProject() {
    if (!deleteProjectTarget) return;
    const api = getBridge();
    if (!api?.cinemaDeleteProject) {
      setStatusMsg('Exclusão de projeto indisponível neste modo.');
      return;
    }
    setDeletingProject(true);
    try {
      await api.cinemaDeleteProject(deleteProjectTarget.projectId);
      const remaining = projects.filter((p) => p.projectId !== deleteProjectTarget.projectId);
      setProjects(remaining);
      if (pkg?.timeline.projectId === deleteProjectTarget.projectId) {
        if (remaining[0]) {
          await handleSelectProject(remaining[0].projectId);
        } else {
          setPkg(null);
          setClips([]);
          setSelectedClipId('');
          setRenderedMedia(null);
        }
      }
      setStatusMsg(`Projeto "${deleteProjectTarget.title}" excluído.`);
      setDeleteProjectTarget(null);
    } catch (err) {
      setStatusMsg(`Erro ao excluir projeto: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setDeletingProject(false);
    }
  }

  async function handleSplitAtPlayhead(targetClipId?: string) {
    const api = getBridge();
    const target = clips.find((c) => c.clipId === (targetClipId ?? activeClipAtPlayhead?.clipId ?? selectedClipId));
    if (!pkg || !target) return;
    const splitFrame = Math.round(playheadSec * 30);
    if (api?.cinemaNleOp) {
      const res = await api.cinemaNleOp({
        projectId: pkg.timeline.projectId,
        op: 'split',
        clipId: target.clipId,
        splitFrame,
      });
      setPkg(res.pkg);
      const mapped = mapClipsFromPkg(res.pkg);
      setClips(mapped);
      setPreviewStale(true);
      setStatusMsg(`Clipe "${target.label}" cortado em ${playheadSec.toFixed(2)}s.`);
    }
  }

  async function handleApplyVisualTransform() {
    const api = getBridge();
    if (!api?.cinemaNleOp || !pkg || !selectedClip) return;
    const res = await api.cinemaNleOp({
      projectId: pkg.timeline.projectId,
      op: 'transform',
      clipId: selectedClip.clipId,
      patch: {
        ...visualTransform,
        keyframeAtFrame: Math.max(0, Math.round((playheadSec - selectedClip.startSec) * 30)),
      },
    });
    setPkg(res.pkg);
    setClips(mapClipsFromPkg(res.pkg));
    setPreviewStale(true);
    setStatusMsg(`Transformação/Keyframe salvo em ${selectedClip.label}.`);
  }

  async function handleApplyTransition() {
    const api = getBridge();
    if (!api?.cinemaNleOp || !pkg || !selectedClip) return;
    const v1Clips = clips.filter((c) => (c.trackId ?? 'v1') === 'v1');
    const idx = v1Clips.findIndex((c) => c.clipId === selectedClip.clipId);
    const prevClip = idx > 0 ? v1Clips[idx - 1] : v1Clips[0];
    if (!prevClip) return;
    const res = await api.cinemaNleOp({
      projectId: pkg.timeline.projectId,
      op: 'transition',
      fromClipId: prevClip.clipId,
      toClipId: selectedClip.clipId,
      kind: transitionDraft.kind,
      durationFrames: Math.round(transitionDraft.durationSec * 30),
    });
    setPkg(res.pkg);
    setClips(mapClipsFromPkg(res.pkg));
    setPreviewStale(true);
    setStatusMsg(`Transição "${transitionDraft.kind}" (${transitionDraft.durationSec}s) aplicada.`);
  }

  async function handleApplyVisualColor(nextControls: typeof colorControls) {
    setColorControls(nextControls);
    setPreviewStale(true);
    const api = getBridge();
    if (!api?.cinemaUpdateColorGrade || !pkg) return;
    setSavingColor(true);
    try {
      const res = await api.cinemaUpdateColorGrade({
        projectId: pkg.timeline.projectId,
        controls: {
          targetSpace: (pkg.colorPlan.targetSpace as 'rec709' | 'rec2020_hdr' | 'srgb_web') ?? 'rec709',
          exposureCompensationEv: nextControls.exposureCompensationEv,
          contrastGain: nextControls.contrastGain,
          saturation: nextControls.saturation,
          temperatureKelvinDelta: nextControls.temperatureKelvinDelta,
          curves: {
            shadows: nextControls.shadows,
            midtones: nextControls.midtones,
            highlights: nextControls.highlights,
          },
          lutId: nextControls.lutId,
        },
      });
      setPkg(res.pkg);
      setColorDraft(res.pkg.colorPlan.ffmpegColorFilterChain);
      setStatusMsg(`Color grading aplicado (LUT ${nextControls.lutId} · v${res.pkg.timeline.version}).`);
    } finally {
      setSavingColor(false);
    }
  }

  async function handleAddSubtitle(e: React.FormEvent) {
    e.preventDefault();
    const api = getBridge();
    if (!api?.cinemaNleOp || !pkg || !subtitleDraft.text.trim()) return;
    const res = await api.cinemaNleOp({
      projectId: pkg.timeline.projectId,
      op: 'subtitle',
      clip: {
        trackId: 'sub1',
        text: subtitleDraft.text.trim(),
        startFrames: Math.round(playheadSec * 30),
        durationFrames: Math.round(subtitleDraft.durationSec * 30),
        animation: subtitleDraft.animation,
      },
    });
    setPkg(res.pkg);
    setClips(mapClipsFromPkg(res.pkg));
    setSubtitleDraft((s) => ({ ...s, text: '' }));
    setPreviewStale(true);
    setStatusMsg(`Legenda adicionada em ${playheadSec.toFixed(2)}s.`);
  }

  async function handleApplyRevisionAndLearn(e: React.FormEvent) {
    e.preventDefault();
    const api = getBridge();
    const note = revisionText.trim();
    if (!api || !pkg || !note) return;
    setSubmittingRevision(true);
    setStatusMsg(null);
    try {
      if (api.cinemaApplyPromptRevision) {
        const rev = await api.cinemaApplyPromptRevision({
          projectId: pkg.timeline.projectId,
          instruction: note,
          selectedClipId,
        });
        setPkg(rev.pkg);
        const mapped = mapClipsFromPkg(rev.pkg);
        setClips(mapped);
        if (rev.audioValidation) setAudioValidation(rev.audioValidation);
        if ((rev.requiresVideoReRender || rev.requiresAudioReRender) && api.cinemaRenderRealMp4) {
          setRendering(true);
          setRenderProgress(45);
          try {
            const rendered = await api.cinemaRenderRealMp4({
              projectId: rev.pkg.timeline.projectId,
              useNvenc: true,
            });
            setRenderedMedia(rendered);
            setPreviewMode('mp4');
            setPreviewStale(false);
            setMediaError(null);
          } finally {
            setRendering(false);
            setRenderProgress(null);
          }
        } else {
          setPreviewStale(true);
        }
        await refreshProjects();
        setRevisionText('');
        setStatusMsg(
          `Revisão direcionada aplicada (${rev.summary}) · segmentos: ${rev.affectedClipIds.length || 'áudio'}. Memória salva.`,
        );
        return;
      }

      if (api.cinemaSubmitFeedback) {
        const genre = pkg.direction?.brief?.genre;
        await api.cinemaSubmitFeedback({
          text: note,
          projectId: pkg.timeline.projectId,
          ...(genre ? { genre } : {}),
        });
      }
      if (api.cinemaProduce) {
        const basePrompt = pkg.direction?.brief?.prompt ?? 'Edição cinematográfica Aethera Studio';
        const updatedPkg = await api.cinemaProduce({
          projectId: pkg.timeline.projectId,
          prompt: `${basePrompt} | Revisão: ${note}`,
          genre: pkg.direction?.brief?.genre,
          targetDurationSec: pkg.direction?.brief?.targetDurationSec ?? totalDurationSec,
          humorIntensity: pkg.direction?.brief?.humorIntensity ?? 35,
          renderProfile: pkg.direction?.brief?.renderProfile ?? 'review_720p',
        });
        setPkg(updatedPkg);
        const mapped = mapClipsFromPkg(updatedPkg);
        setClips(mapped);
        setSelectedClipId(mapped[0]?.clipId ?? '');
      }
      if (api.cinemaRenderRealMp4) {
        const rendered = await api.cinemaRenderRealMp4({
          projectId: pkg.timeline.projectId,
          useNvenc: true,
        });
        setRenderedMedia(rendered);
        setPreviewMode('mp4');
        setPreviewStale(false);
      }
      await refreshProjects();
      setRevisionText('');
      setStatusMsg('Instrução registrada na Memória & Feedback dos diretores e aplicada ao projeto.');
    } catch (err) {
      setStatusMsg(`Erro ao aplicar revisão: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmittingRevision(false);
    }
  }

  const [waveformMap, setWaveformMap] = useState<
    Record<string, { loading: boolean; data: WaveformDataView | null; error: string | null }>
  >({});

  const ensureWaveformLoaded = useCallback((filePath?: string | null) => {
    if (!filePath) return;
    const api = getBridge();
    if (!api?.cinemaExtractWaveform) return;
    setWaveformMap((prev) => {
      if (prev[filePath]?.loading || prev[filePath]?.data || prev[filePath]?.error) {
        return prev;
      }
      void api
        .cinemaExtractWaveform!({ filePath, buckets: 1024 })
        .then((res) => {
          setWaveformMap((curr) => ({
            ...curr,
            [filePath]: res.ok && res.data
              ? { loading: false, data: res.data, error: null }
              : { loading: false, data: null, error: res.error ?? 'Falha ao extrair waveform' },
          }));
        })
        .catch((err: unknown) => {
          setWaveformMap((curr) => ({
            ...curr,
            [filePath]: {
              loading: false,
              data: null,
              error: err instanceof Error ? err.message : String(err),
            },
          }));
        });
      return {
        ...prev,
        [filePath]: { loading: true, data: null, error: null },
      };
    });
  }, []);

  const requestedThumbsRef = useRef<Set<string>>(new Set());
  const handleRequestThumbnail = useCallback((asset: LibraryMediaAsset) => {
    if (asset.thumbnailUrl || requestedThumbsRef.current.has(asset.mediaId)) return;
    const api = getBridge();
    if (!api?.cinemaExtractThumbnail) return;
    requestedThumbsRef.current.add(asset.mediaId);
    void api
      .cinemaExtractThumbnail({ filePath: asset.filePath, timeSec: 1 })
      .then((res) => {
        if (!res.ok || !res.thumbnailUrl) return;
        setImportedAssets((prev) =>
          prev.map((item) =>
            item.mediaId === asset.mediaId ? { ...item, thumbnailUrl: res.thumbnailUrl ?? null } : item,
          ),
        );
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const paths = new Set<string>();
    if (renderedMedia?.stemPaths?.voiceover) paths.add(renderedMedia.stemPaths.voiceover);
    if (renderedMedia?.stemPaths?.music) paths.add(renderedMedia.stemPaths.music);
    if (renderedMedia?.stemPaths?.sfx) paths.add(renderedMedia.stemPaths.sfx);
    if (renderedMedia?.stemPaths?.ambience) paths.add(renderedMedia.stemPaths.ambience);
    if (renderedMedia?.stemPaths?.master) paths.add(renderedMedia.stemPaths.master);
    if (renderedMedia?.mp4Path) paths.add(renderedMedia.mp4Path);
    for (const asset of importedAssets) {
      if (asset.kind === 'audio' || asset.kind === 'video') {
        paths.add(asset.filePath);
      }
    }
    if (pkg?.timeline?.sourceMedia) {
      for (const sm of Object.values(pkg.timeline.sourceMedia)) {
        if ((sm.kind === 'audio' || sm.kind === 'video') && sm.uri && !sm.uri.startsWith('http')) {
          paths.add(sm.uri);
        }
      }
    }
    for (const p of paths) {
      ensureWaveformLoaded(p);
    }
  }, [renderedMedia, importedAssets, pkg, ensureWaveformLoaded]);

  const projectAndLibraryAssets = useMemo<ImportedAsset[]>(() => {
    const projectItems: ImportedAsset[] = [];
    const seenPaths = new Set<string>();
    const seenIds = new Set<string>();
    if (pkg?.timeline?.sourceMedia) {
      for (const sm of Object.values(pkg.timeline.sourceMedia)) {
        const uri = sm.uri ?? '';
        if (!uri || uri.startsWith('http://') || uri.startsWith('https://')) continue;
        const cleanPath = uri.startsWith('aethera-media://')
          ? decodeURIComponent(uri.split('path=')[1] ?? '')
          : uri;
        if (!cleanPath) continue;
        const norm = cleanPath.toLowerCase();
        if (seenPaths.has(norm) || seenIds.has(sm.mediaId)) continue;
        seenPaths.add(norm);
        seenIds.add(sm.mediaId);
        const rawName = cleanPath.split(/[/\\]/).pop() || sm.mediaId;
        const kind: 'video' | 'image' | 'audio' =
          sm.kind === 'image' ? 'image' : sm.kind === 'audio' ? 'audio' : 'video';
        const extMatch = cleanPath.match(/\.([a-z0-9]+)$/i);
        const format = (extMatch?.[1] ?? kind).toUpperCase();
        projectItems.push({
          mediaId: sm.mediaId,
          filePath: cleanPath,
          name: rawName,
          kind,
          durationSec: (sm as { durationSec?: number }).durationSec ?? 6,
          width: sm.width ?? (kind === 'audio' ? 0 : 1280),
          height: sm.height ?? (kind === 'audio' ? 0 : 720),
          mediaUrl: `aethera-media://local?path=${encodeURIComponent(cleanPath)}`,
          thumbnailUrl: kind === 'image' ? `aethera-media://local?path=${encodeURIComponent(cleanPath)}` : null,
          waveformPeaks: (waveformMap[cleanPath]?.data as { peaks?: number[] } | null)?.peaks ?? [],
          category: kind === 'image' ? 'image' : kind === 'audio' ? 'music' : 'video',
          format,
          origin: 'Projeto Atual',
        } as ImportedAsset);
      }
    }
    const merged = [...projectItems];
    for (const asset of importedAssets) {
      const norm = (asset.filePath || '').toLowerCase();
      if (seenIds.has(asset.mediaId) || (norm && seenPaths.has(norm))) continue;
      seenIds.add(asset.mediaId);
      if (norm) seenPaths.add(norm);
      merged.push(asset);
    }
    return merged;
  }, [pkg?.timeline?.sourceMedia, importedAssets, waveformMap]);

  const timelineWidthPx = Math.max(680, Math.ceil((totalDurationSec + 2) * pxPerSec));
  const ticks = Array.from({ length: Math.ceil(totalDurationSec) + 2 }, (_, s) => s).filter(
    (s) => s % (pxPerSec < 18 ? 5 : 2) === 0,
  );

  return (
    <div
      ref={editorRootRef}
      className="flex h-[calc(100vh-3.5rem)] flex-col gap-1.5 overflow-hidden p-2.5"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
        if (file?.path) void handleImportMedia(file.path);
      }}
    >
      <header className="flex-none flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-card px-3 py-1.5">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <span className="font-semibold text-foreground">Editor NLE Profissional</span>
          {projects.length > 0 && (
            <label className="inline-flex items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground">Projeto:</span>
              <select
                aria-label="Selecionar projeto existente"
                value={pkg?.timeline.projectId ?? projects[0]?.projectId ?? ''}
                onChange={(e) => void handleSelectProject(e.target.value)}
                className="max-w-[260px] rounded-lg border border-border bg-[#0d0d17] px-2.5 py-1 text-xs text-foreground"
              >
                {projects.map((proj, idx) => (
                  <option key={proj.projectId} value={proj.projectId}>
                    {idx === 0 ? '★ Mais recente: ' : ''}
                    {proj.title} ({proj.durationSec}s)
                  </option>
                ))}
              </select>
            </label>
          )}
          {projects.length > 0 && (
            <button
              type="button"
              onClick={() => {
                const currentId = pkg?.timeline.projectId ?? projects[0]?.projectId;
                const current = projects.find((p) => p.projectId === currentId) ?? projects[0];
                if (current) {
                  setDeleteProjectTarget({ projectId: current.projectId, title: current.title });
                }
              }}
              title="Excluir projeto selecionado"
              aria-label="Excluir projeto selecionado"
              className="inline-flex items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 p-1.5 text-rose-300 hover:border-rose-400 hover:bg-rose-500/20"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
          {pkg && (
            <span className="rounded-full border border-purple-500/40 bg-purple-500/15 px-2.5 py-0.5 font-mono text-[10px] text-purple-200">
              v{pkg.timeline.version} · {pkg.timeline.resolution.width}x{pkg.timeline.resolution.height} · {totalDurationSec.toFixed(1)}s
            </span>
          )}
          {saving && <span className="text-[11px] text-amber-300">Salvando...</span>}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => void handleImportMedia()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 hover:border-primary"
          >
            <Upload className="size-3.5" /> Importar Mídia
          </button>
          <button
            type="button"
            onClick={() => void persistTimeline(clips)}
            disabled={!pkg || saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 hover:border-primary disabled:opacity-50"
          >
            {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            {saving ? 'Salvando...' : 'Salvar Projeto'}
          </button>
          <Link to="/aethera/cinema" className="rounded-lg border border-border px-2.5 py-1.5 hover:border-primary">
            Produção IA
          </Link>
          <Link to="/aethera/review" className="rounded-lg border border-border px-2.5 py-1.5 hover:border-primary">
            Revisão
          </Link>
          <button
            type="button"
            onClick={() => void openAuditModal()}
            disabled={!pkg}
            title="Auditoria do projeto, pesquisa, mídias e edição de roteiro"
            className="inline-flex items-center gap-1.5 rounded-lg border border-purple-500/40 bg-purple-500/10 px-2.5 py-1.5 text-purple-200 hover:border-purple-400 hover:bg-purple-500/20 disabled:opacity-50"
          >
            <FileText className="size-3.5" /> Auditoria &amp; Roteiro
          </button>
          <button
            type="button"
            onClick={resetLayoutSizes}
            title="Restaurar tamanho padrão dos painéis"
            className="rounded-lg border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:border-primary hover:text-foreground"
          >
            Painéis
          </button>
          <button
            type="button"
            onClick={handleExportOtio}
            disabled={!pkg || exportingOtio}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 hover:border-primary disabled:opacity-50"
          >
            {exportingOtio ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            {exportingOtio ? 'Exportando...' : 'OTIO'}
          </button>
          <button
            type="button"
            onClick={handleRenderRealMp4}
            disabled={!pkg || rendering}
            className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-amber-500 px-3 py-1.5 font-semibold text-white disabled:opacity-50"
          >
            {rendering ? <LoaderCircle className="size-3.5 animate-spin" /> : <Film className="size-3.5" />}
            {rendering ? `Renderizando (${renderProgress ?? 0}%)...` : 'Renderizar MP4'}
          </button>
        </div>
      </header>

      {renderProgress !== null && (
        <div className="space-y-1 rounded-xl border border-purple-500/30 bg-card px-4 py-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-purple-200">Renderizando MP4 real (VoiceStudio + FFmpeg)...</span>
            <span className="font-mono font-semibold text-amber-300">{renderProgress}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className="h-full rounded-full bg-gradient-to-r from-purple-500 to-amber-400 transition-all duration-300"
              style={{ width: `${renderProgress}%` }}
            />
          </div>
        </div>
      )}

      <div
        ref={topRowRef}
        style={{
          ['--left-w' as string]: `${layoutSizes.leftPct}%`,
          ['--right-w' as string]: `${layoutSizes.rightPct}%`,
        }}
        className="flex flex-1 min-h-0 flex-col gap-1.5 lg:flex-row lg:gap-0"
      >
        {/* Left: Media & Assets Bin */}
        <aside className="flex min-h-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card p-2.5 lg:w-[var(--left-w)] space-y-2">
          <div className="flex flex-wrap gap-1 text-[11px]">
            {(
              [
                ['media', 'Mídia'],
                ['effects', 'Efeitos'],
                ['transitions', 'Transições'],
                ['titles', 'Títulos'],
                ['sfx', 'SFX'],
                ['music', 'Músicas'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setLeftTab(id)}
                className={`rounded-md px-2 py-1 font-medium ${
                  leftTab === id ? 'bg-primary/25 text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-hidden">
            {leftTab === 'media' && (
              <MediaLibraryPanel
                assets={projectAndLibraryAssets}
                waveformMap={waveformMap}
                onInsertAsset={(asset) => handleAddAssetToTimeline(asset)}
                onRequestWaveform={(fp) => ensureWaveformLoaded(fp)}
                onRequestThumbnail={handleRequestThumbnail}
              />
            )}
            {leftTab === 'sfx' && (
              <div className="h-full space-y-1.5 overflow-y-auto pr-1 text-xs">
                {(pkg?.soundPlan.sfxEvents ?? []).map((ev) => (
                  <div key={ev.cueId} className="rounded-xl border border-border/80 bg-[#0d0d17] p-2">
                    <p className="font-medium text-foreground">{ev.sfxName}</p>
                    <p className="text-[10px] text-muted-foreground">{ev.timeSeconds}s · {ev.reason}</p>
                  </div>
                ))}
              </div>
            )}
            {leftTab !== 'media' && leftTab !== 'sfx' && (
              <div className="h-full space-y-2 overflow-y-auto pr-1 text-xs">
                <p className="rounded-xl border border-dashed border-border p-3 text-[11px] text-muted-foreground">
                  Arraste arquivos de vídeo, imagem, áudio, VFX ou templates para esta janela para importar com thumbnail e waveform reais.
                </p>
              </div>
            )}
          </div>
        </aside>

        <div
          role="separator"
          aria-orientation="vertical"
          title="Arraste para redimensionar Biblioteca / Player (duplo clique para resetar)"
          onPointerDown={(e) => startPanelResize('left', e)}
          onDoubleClick={resetLayoutSizes}
          className="hidden lg:flex w-2 shrink-0 cursor-col-resize items-center justify-center group"
        >
          <div className="h-10 w-0.5 rounded-full bg-border/80 transition group-hover:h-16 group-hover:bg-purple-400" />
        </div>

        {/* Center: Real Preview Stage (Live Canvas OR Rendered MP4 Video) */}
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-[#090910] p-2.5 space-y-1.5">
          <div className="flex items-center justify-between text-[11px]">
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => {
                  setPlaying(false);
                  setPreviewMode('timeline');
                }}
                className={`rounded-md px-2.5 py-1 font-medium ${
                  previewMode === 'timeline' ? 'bg-primary/30 text-foreground' : 'text-muted-foreground'
                }`}
              >
                Preview Timeline (Ao Vivo)
              </button>
              <button
                type="button"
                disabled={!renderedMedia}
                onClick={() => {
                  setPlaying(false);
                  setPreviewMode('mp4');
                }}
                className={`rounded-md px-2.5 py-1 font-medium disabled:opacity-40 ${
                  previewMode === 'mp4' ? 'bg-emerald-500/25 text-emerald-200' : 'text-muted-foreground'
                }`}
              >
                MP4 Renderizado {renderedMedia ? `(${renderedMedia.encoderUsed})` : '(Não gerado)'}
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  livePreviewStatus.state === 'rendering'
                    ? 'border-amber-400/50 bg-amber-500/20 text-amber-200 animate-pulse'
                    : livePreviewStatus.state === 'media_unavailable'
                      ? 'border-rose-400/50 bg-rose-500/20 text-rose-200'
                      : livePreviewStatus.state === 'rendered_mp4'
                        ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-200'
                        : 'border-purple-400/50 bg-purple-500/20 text-purple-200'
                }`}
              >
                {livePreviewStatus.badgeLabel}
              </span>
              <span className="font-mono text-amber-300">{formatTimecode(playheadSec)}</span>
            </div>
          </div>

          <audio ref={liveAudioRef} className="hidden" />
          <div className="relative flex-1 min-h-0 overflow-hidden rounded-lg border border-border/70 bg-black">
            {previewMode === 'mp4' && renderedMedia ? (
              <video
                ref={videoRef}
                src={renderedMedia.mediaUrl}
                controls
                onTimeUpdate={(e) => setPlayheadSec(Number(e.currentTarget.currentTime.toFixed(2)))}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onError={() =>
                  setMediaError(
                    'Erro ao decodificar ou carregar a prévia MP4. Clique em "Renderizar MP4" para gerar novamente.',
                  )
                }
                onLoadedData={() => setMediaError(null)}
                className="h-full w-full object-contain"
              />
            ) : (
              <canvas ref={canvasRef} width={768} height={432} className="h-full w-full object-contain" />
            )}
            {previewStale && (
              <div className="absolute top-2 right-2 rounded-md border border-amber-400/50 bg-amber-500/20 px-2 py-0.5 text-[10px] font-medium text-amber-200">
                Prévia desatualizada — clique em Renderizar MP4
              </div>
            )}
          </div>

          {mediaError && (
            <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive">
              {mediaError}
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2 text-xs">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPlaying(!playing)}
                className="flex size-8 items-center justify-center rounded-full bg-primary text-white"
                aria-label={playing ? 'Pausar' : 'Reproduzir'}
              >
                {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
              </button>
              <button
                type="button"
                onClick={() => setPlayerMuted((m) => !m)}
                className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                aria-label={playerMuted ? 'Ativar som' : 'Mutar player'}
              >
                {playerMuted ? 'Mudo' : 'Som'}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={playerMuted ? 0 : playerVolume}
                onChange={(e) => {
                  setPlayerMuted(false);
                  setPlayerVolume(Number(e.target.value));
                }}
                aria-label="Volume do player"
                className="w-20 accent-purple-500"
              />
              <span className="font-mono text-muted-foreground">30 fps · Rec.709</span>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {renderedMedia?.probe.integratedLufs !== null && renderedMedia?.probe.integratedLufs !== undefined
                ? `Medido: ${renderedMedia.probe.integratedLufs} LUFS`
                : pkg
                  ? `Alvo: ${pkg.soundPlan.platformProfile.integratedLufs} LUFS`
                  : '—'}
            </span>
          </div>
        </section>

        <div
          role="separator"
          aria-orientation="vertical"
          title="Arraste para redimensionar Player / Inspetor (duplo clique para resetar)"
          onPointerDown={(e) => startPanelResize('right', e)}
          onDoubleClick={resetLayoutSizes}
          className="hidden lg:flex w-2 shrink-0 cursor-col-resize items-center justify-center group"
        >
          <div className="h-10 w-0.5 rounded-full bg-border/80 transition group-hover:h-16 group-hover:bg-purple-400" />
        </div>

        {/* Right: Inspector */}
        <aside className="flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-card p-2.5 lg:w-[var(--right-w)] space-y-2">
          <div className="flex-none flex flex-wrap gap-1 text-[11px]">
            {(
              [
                ['transform', 'Propriedades'],
                ['color', 'Cor'],
                ['audio', 'Áudio'],
                ['subtitles', 'Legendas'],
                ['speed', 'Velocidade'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setInspectorTab(id)}
                className={`rounded-md px-2 py-1 font-medium ${
                  inspectorTab === id ? 'bg-primary/25 text-foreground' : 'text-muted-foreground'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-2">
          {inspectorTab === 'transform' && (() => {
            const elementKind = resolveSelectedElementKind(selectedClip ?? null, pkg?.timeline.sourceMedia);
            const kindLabels: Record<typeof elementKind, string> = {
              video: 'Vídeo',
              audio: 'Áudio',
              image: 'Imagem',
              text: 'Texto / Título',
              vfx: 'VFX / Composição',
            };
            return (
            <div className="space-y-2 text-xs">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <p className="truncate font-semibold text-foreground" title={selectedClip?.label ?? '—'}>
                  Clipe: {selectedClip?.label ?? '—'}
                </p>
                <span className="shrink-0 rounded-full border border-purple-400/40 bg-purple-500/15 px-2 py-0.5 text-[10px] font-medium text-purple-200">
                  {kindLabels[elementKind]}
                </span>
              </div>
              {selectedClip && (
                <p className="font-mono text-[11px] text-muted-foreground">
                  Início {selectedClip.startSec}s · Duração {selectedClip.durationSec}s · {selectedClip.speed}x
                </p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handleTrimEnd(-0.5)}
                  className="flex-1 rounded-lg border border-border bg-[#0d0d17] py-1.5 hover:border-primary"
                >
                  Trim -0.5s
                </button>
                <button
                  type="button"
                  onClick={() => handleTrimEnd(0.5)}
                  className="flex-1 rounded-lg border border-border bg-[#0d0d17] py-1.5 hover:border-primary"
                >
                  Trim +0.5s
                </button>
              </div>
              <button
                type="button"
                onClick={handleRippleDelete}
                className="w-full rounded-lg border border-destructive/40 bg-destructive/10 py-1.5 text-destructive hover:bg-destructive/20"
              >
                Ripple Delete Clipe
              </button>

              {selectedClip && (
                <div className="space-y-2 border-t border-border/70 pt-2">
                  <p className="font-semibold text-foreground">Edição Visual &amp; Keyframes</p>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <label className="space-y-0.5">
                      <span className="text-muted-foreground">Blend Mode</span>
                      <select
                        value={visualTransform.blendMode}
                        onChange={(e) => setVisualTransform((v) => ({ ...v, blendMode: e.target.value }))}
                        className="w-full rounded border border-border bg-[#0d0d17] px-1.5 py-1 text-[11px]"
                      >
                        <option value="normal">Normal</option>
                        <option value="screen">Screen</option>
                        <option value="multiply">Multiply</option>
                        <option value="overlay">Overlay</option>
                        <option value="darken">Darken</option>
                        <option value="lighten">Lighten</option>
                      </select>
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-muted-foreground">Opacidade ({Math.round(visualTransform.opacity * 100)}%)</span>
                      <input
                        type="range"
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={visualTransform.opacity}
                        onChange={(e) => setVisualTransform((v) => ({ ...v, opacity: Number(e.target.value) }))}
                        className="w-full accent-purple-500"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-muted-foreground">Escala ({visualTransform.scale.toFixed(2)}x)</span>
                      <input
                        type="range"
                        min={0.5}
                        max={2}
                        step={0.05}
                        value={visualTransform.scale}
                        onChange={(e) => setVisualTransform((v) => ({ ...v, scale: Number(e.target.value) }))}
                        className="w-full accent-purple-500"
                      />
                    </label>
                    <label className="space-y-0.5">
                      <span className="text-muted-foreground">Rotação ({visualTransform.rotationDeg}°)</span>
                      <input
                        type="range"
                        min={-45}
                        max={45}
                        step={1}
                        value={visualTransform.rotationDeg}
                        onChange={(e) => setVisualTransform((v) => ({ ...v, rotationDeg: Number(e.target.value) }))}
                        className="w-full accent-purple-500"
                      />
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={handleApplyVisualTransform}
                    className="w-full rounded-lg border border-primary/40 bg-primary/20 py-1 text-[11px] font-medium text-purple-100 hover:bg-primary/30"
                  >
                    Salvar Keyframe no Playhead
                  </button>

                  <div className="space-y-1.5 border-t border-border/70 pt-2">
                    <p className="font-semibold text-foreground">Transição de Entrada</p>
                    <div className="flex gap-1.5">
                      <select
                        value={transitionDraft.kind}
                        onChange={(e) => setTransitionDraft((t) => ({ ...t, kind: e.target.value }))}
                        className="flex-1 rounded border border-border bg-[#0d0d17] px-2 py-1 text-[11px]"
                      >
                        <option value="dissolve">Dissolve</option>
                        <option value="wipe">Wipe</option>
                        <option value="match_cut">Smooth / Match</option>
                        <option value="cut">Corte Seco</option>
                      </select>
                      <input
                        type="number"
                        min={0.15}
                        max={1.2}
                        step={0.05}
                        value={transitionDraft.durationSec}
                        onChange={(e) => setTransitionDraft((t) => ({ ...t, durationSec: Number(e.target.value) }))}
                        className="w-16 rounded border border-border bg-[#0d0d17] px-1.5 py-1 text-right font-mono text-[11px]"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleApplyTransition}
                      className="w-full rounded-lg border border-border bg-[#0d0d17] py-1 text-[11px] hover:border-primary"
                    >
                      Aplicar Transição
                    </button>
                  </div>
                </div>
              )}
              {(elementKind === 'audio' || elementKind === 'text' || elementKind === 'video') && (
                <div className="flex flex-wrap gap-1.5 border-t border-border/70 pt-2 text-[10px]">
                  {elementKind === 'audio' && (
                    <button
                      type="button"
                      onClick={() => setInspectorTab('audio')}
                      className="rounded-md border border-emerald-400/40 bg-emerald-500/15 px-2 py-1 text-emerald-200"
                    >
                      Abrir Mixer &amp; Fades de Áudio
                    </button>
                  )}
                  {elementKind === 'text' && (
                    <button
                      type="button"
                      onClick={() => setInspectorTab('subtitles')}
                      className="rounded-md border border-purple-400/40 bg-purple-500/15 px-2 py-1 text-purple-200"
                    >
                      Abrir Tipografia &amp; Animação
                    </button>
                  )}
                  {elementKind === 'video' && (
                    <button
                      type="button"
                      onClick={() => setInspectorTab('color')}
                      className="rounded-md border border-sky-400/40 bg-sky-500/15 px-2 py-1 text-sky-200"
                    >
                      Abrir Cor &amp; Grading
                    </button>
                  )}
                </div>
              )}
            </div>
            );
          })()}

          {inspectorTab === 'color' && pkg && (
            <div className="min-w-0 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <p className="font-semibold text-foreground">Color Grading ({pkg.colorPlan.targetSpace})</p>
                <button
                  type="button"
                  onClick={() =>
                    void handleApplyVisualColor({
                      exposureCompensationEv: 0,
                      contrastGain: 1.04,
                      saturation: 1.03,
                      temperatureKelvinDelta: 0,
                      shadows: 0,
                      midtones: 0,
                      highlights: 0,
                      lutId: 'rec709_clean_cinematic',
                    })
                  }
                  className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Resetar
                </button>
              </div>
              <div className="space-y-1.5 rounded-lg border border-border/70 bg-[#0d0d17] p-2 text-[11px]">
                <label className="block space-y-0.5">
                  <span className="flex justify-between text-muted-foreground">
                    <span>Exposição</span>
                    <span className="font-mono text-foreground">{colorControls.exposureCompensationEv} EV</span>
                  </span>
                  <input
                    type="range"
                    min={-1.5}
                    max={1.5}
                    step={0.1}
                    value={colorControls.exposureCompensationEv}
                    onChange={(e) =>
                      void handleApplyVisualColor({ ...colorControls, exposureCompensationEv: Number(e.target.value) })
                    }
                    className="w-full accent-amber-400"
                  />
                </label>
                <label className="block space-y-0.5">
                  <span className="flex justify-between text-muted-foreground">
                    <span>Contraste</span>
                    <span className="font-mono text-foreground">{colorControls.contrastGain}</span>
                  </span>
                  <input
                    type="range"
                    min={0.6}
                    max={1.6}
                    step={0.02}
                    value={colorControls.contrastGain}
                    onChange={(e) =>
                      void handleApplyVisualColor({ ...colorControls, contrastGain: Number(e.target.value) })
                    }
                    className="w-full accent-purple-500"
                  />
                </label>
                <label className="block space-y-0.5">
                  <span className="flex justify-between text-muted-foreground">
                    <span>Saturação</span>
                    <span className="font-mono text-foreground">{colorControls.saturation}</span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1.8}
                    step={0.02}
                    value={colorControls.saturation}
                    onChange={(e) =>
                      void handleApplyVisualColor({ ...colorControls, saturation: Number(e.target.value) })
                    }
                    className="w-full accent-purple-500"
                  />
                </label>
                <label className="block space-y-0.5">
                  <span className="flex justify-between text-muted-foreground">
                    <span>Temperatura</span>
                    <span className="font-mono text-foreground">{colorControls.temperatureKelvinDelta} K</span>
                  </span>
                  <input
                    type="range"
                    min={-1200}
                    max={1200}
                    step={50}
                    value={colorControls.temperatureKelvinDelta}
                    onChange={(e) =>
                      void handleApplyVisualColor({ ...colorControls, temperatureKelvinDelta: Number(e.target.value) })
                    }
                    className="w-full accent-amber-400"
                  />
                </label>
                <label className="block space-y-0.5">
                  <span className="text-muted-foreground">LUT / Perfil</span>
                  <select
                    value={colorControls.lutId}
                    onChange={(e) => void handleApplyVisualColor({ ...colorControls, lutId: e.target.value })}
                    className="w-full rounded border border-border bg-background px-2 py-1 text-[11px]"
                  >
                    <option value="rec709_clean_cinematic">Rec.709 Clean Cinematic</option>
                    <option value="rec709_vibrant_gaming">Rec.709 Vibrant Gaming</option>
                    <option value="rec709_neutral_doc">Rec.709 Neutral Doc</option>
                  </select>
                </label>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <span className="text-[10px] text-muted-foreground">Cadeia FFmpeg (Avançado)</span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setColorExpanded((v) => !v)}
                    className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    {colorExpanded ? 'Recolher' : 'Expandir'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyColorChain}
                    className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    {colorCopied ? 'Copiado!' : 'Copiar'}
                  </button>
                </div>
              </div>
              <textarea
                aria-label="Cadeia de filtro de cor FFmpeg"
                rows={colorExpanded ? 5 : 2}
                value={colorDraft}
                onChange={(e) => setColorDraft(e.target.value)}
                className="w-full min-w-0 max-w-full resize-y break-all whitespace-pre-wrap rounded-lg border border-border bg-[#0d0d17] p-2 font-mono text-[10px] leading-relaxed text-purple-200 focus:border-primary focus:outline-none"
              />
              <button
                type="button"
                disabled={savingColor || !colorDraft.trim()}
                onClick={handleSaveColorChain}
                className="w-full rounded-lg border border-primary/40 bg-primary/20 py-1.5 text-[11px] font-medium text-purple-100 hover:bg-primary/30 disabled:opacity-50"
              >
                {savingColor ? 'Salvando cor...' : 'Aplicar Filtro FFmpeg'}
              </button>
            </div>
          )}

          {inspectorTab === 'audio' && pkg && (
            <div className="min-w-0 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-1">
                <p className="font-semibold text-foreground">
                  Loudness Alvo: {pkg.soundPlan.platformProfile.integratedLufs} LUFS
                </p>
                <button
                  type="button"
                  onClick={() => handleResetAudioBus()}
                  className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Restaurar todos
                </button>
              </div>
              {audioValidation && audioValidation.warnings.length > 0 && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-2 text-[10px] text-amber-200">
                  {audioValidation.warnings.map((w, idx) => (
                    <div key={idx}>{w}</div>
                  ))}
                </div>
              )}
              <div className="space-y-2">
                {pkg.soundPlan.stems.map((stem) => (
                  <div
                    key={stem.stemRole}
                    className="space-y-1.5 rounded-lg border border-border/70 bg-[#0d0d17] p-2 text-[11px]"
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <span className="inline-flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                        <Volume2 className="size-3 shrink-0 text-purple-400" />
                        <span className="truncate">{stem.stemRole}</span>
                      </span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => handlePreListenBus(stem)}
                          className={`rounded border px-1.5 py-0.5 text-[10px] ${
                            previewingBus === stem.stemRole
                              ? 'border-emerald-400 bg-emerald-500/20 text-emerald-200'
                              : 'border-border text-muted-foreground hover:text-foreground'
                          }`}
                        >
                          {previewingBus === stem.stemRole ? 'Ouvindo...' : 'Ouvir'}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleAudioBusChange(stem.stemRole, { muted: !stem.muted })}
                          className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                            stem.muted
                              ? 'border-destructive/60 bg-destructive/20 text-destructive'
                              : 'border-border text-muted-foreground hover:text-foreground'
                          }`}
                          aria-label={`Mutar ${stem.stemRole}`}
                        >
                          M
                        </button>
                        <button
                          type="button"
                          onClick={() => handleResetAudioBus(stem.stemRole)}
                          className="rounded border border-border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                          title="Restaurar ganho padrão"
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        aria-label={`Ganho ${stem.stemRole} em dB`}
                        min={-48}
                        max={12}
                        step={0.5}
                        disabled={Boolean(stem.muted)}
                        value={stem.targetGainDb}
                        onChange={(e) =>
                          handleAudioBusChange(stem.stemRole, { targetGainDb: Number(e.target.value) })
                        }
                        className="min-w-0 flex-1 accent-purple-500 disabled:opacity-40"
                      />
                      <div className="flex shrink-0 items-center gap-1">
                        <input
                          type="number"
                          aria-label={`Valor numérico ${stem.stemRole} dB`}
                          min={-48}
                          max={12}
                          step={0.5}
                          disabled={Boolean(stem.muted)}
                          value={stem.targetGainDb}
                          onChange={(e) =>
                            handleAudioBusChange(stem.stemRole, { targetGainDb: Number(e.target.value) })
                          }
                          className="w-14 rounded border border-border bg-background px-1.5 py-0.5 text-right font-mono text-[10px] text-foreground disabled:opacity-40"
                        />
                        <span className="text-[10px] text-muted-foreground">dB</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              {savingAudio && <p className="text-[10px] text-purple-300">Salvando mixer...</p>}
            </div>
          )}

          {inspectorTab === 'subtitles' && (
            <form onSubmit={handleAddSubtitle} className="space-y-2 text-xs">
              <p className="font-semibold text-foreground">Nova Legenda em {playheadSec.toFixed(2)}s</p>
              <textarea
                rows={2}
                value={subtitleDraft.text}
                onChange={(e) => setSubtitleDraft((s) => ({ ...s, text: e.target.value }))}
                placeholder="Texto da legenda sincronizada..."
                className="w-full rounded-lg border border-border bg-[#0d0d17] p-2 text-xs text-foreground"
              />
              <div className="flex gap-2">
                <input
                  type="number"
                  min={0.5}
                  max={15}
                  step={0.5}
                  value={subtitleDraft.durationSec}
                  onChange={(e) => setSubtitleDraft((s) => ({ ...s, durationSec: Number(e.target.value) }))}
                  className="w-20 rounded border border-border bg-[#0d0d17] px-2 py-1 font-mono text-[11px]"
                />
                <select
                  value={subtitleDraft.animation}
                  onChange={(e) =>
                    setSubtitleDraft((s) => ({ ...s, animation: e.target.value as typeof subtitleDraft.animation }))
                  }
                  className="flex-1 rounded border border-border bg-[#0d0d17] px-2 py-1 text-[11px]"
                >
                  <option value="fade_up">Fade Up</option>
                  <option value="pop">Pop</option>
                  <option value="slide">Slide</option>
                  <option value="none">Sem animação</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={!subtitleDraft.text.trim()}
                className="w-full rounded-lg border border-primary/40 bg-primary/20 py-1.5 text-[11px] font-medium text-purple-100 hover:bg-primary/30 disabled:opacity-50"
              >
                Inserir Legenda na Trilha
              </button>
            </form>
          )}

          {inspectorTab === 'speed' && (
            <div className="space-y-2 text-xs">
              <p className="font-semibold text-foreground">Speed Ramp ({selectedClip?.speed ?? 1}x)</p>
              <div className="flex gap-1.5">
                {[0.5, 1, 1.5, 2].map((sp) => (
                  <button
                    key={sp}
                    type="button"
                    onClick={() => handleSpeedChange(sp)}
                    className={`flex-1 rounded-lg border py-1.5 ${
                      selectedClip?.speed === sp ? 'border-primary bg-primary/20' : 'border-border bg-[#0d0d17]'
                    }`}
                  >
                    {sp}x
                  </button>
                ))}
              </div>
            </div>
          )}
          </div>
        </aside>
      </div>

      <div
        role="separator"
        aria-orientation="horizontal"
        title="Arraste para aumentar ou diminuir a altura da Timeline (duplo clique para resetar)"
        onPointerDown={(e) => startPanelResize('timeline', e)}
        onDoubleClick={resetLayoutSizes}
        className="hidden lg:flex h-2 shrink-0 cursor-row-resize items-center justify-center group"
      >
        <div className="h-0.5 w-16 rounded-full bg-border/80 transition group-hover:w-28 group-hover:bg-purple-400" />
      </div>

      {/* Bottom: Interactive Multi-track NLE Timeline + Collapsible AI Assistant */}
      <div
        ref={bottomRowRef}
        style={{
          height: `${layoutSizes.timelinePx}px`,
          ['--assistant-w' as string]: `${layoutSizes.assistantPct}%`,
        }}
        className="flex flex-none min-h-0 flex-col gap-1.5 overflow-hidden lg:flex-row lg:gap-0"
      >
        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card p-2.5 space-y-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-2 text-xs">
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleUndo} disabled={history.length === 0} className="rounded-md border border-border p-1.5 hover:border-primary disabled:opacity-40" aria-label="Desfazer">
                <Undo2 className="size-3.5" />
              </button>
              <button type="button" onClick={handleRedo} disabled={future.length === 0} className="rounded-md border border-border p-1.5 hover:border-primary disabled:opacity-40" aria-label="Refazer">
                <Redo2 className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setTimelineTool((t) => (t === 'select' ? 'razor' : 'select'))}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
                  timelineTool === 'razor' ? 'border-purple-400 bg-purple-500/20 text-purple-200' : 'border-border text-muted-foreground'
                }`}
              >
                <Scissors className="size-3" /> {timelineTool === 'razor' ? 'Lâmina (C)' : 'Selecionar (V)'}
              </button>
              <button
                type="button"
                onClick={() => void handleSplitAtPlayhead()}
                disabled={!pkg || clips.length === 0}
                className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:border-primary hover:text-foreground disabled:opacity-40"
              >
                Cortar no Playhead
              </button>
              <button
                type="button"
                onClick={() => setSnapEnabled(!snapEnabled)}
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] ${
                  snapEnabled ? 'border-amber-400/60 bg-amber-500/15 text-amber-200' : 'border-border text-muted-foreground'
                }`}
              >
                <Magnet className="size-3" /> Snap {snapEnabled ? 'ON' : 'OFF'}
              </button>
              <div className="flex items-center gap-1">
                <button type="button" onClick={() => setPxPerSec((z) => Math.max(12, z - 6))} aria-label="Diminuir zoom" className="rounded border border-border p-1">
                  <ZoomOut className="size-3" />
                </button>
                <span className="font-mono text-[10px] text-muted-foreground">{pxPerSec}px/s</span>
                <button type="button" onClick={() => setPxPerSec((z) => Math.min(64, z + 6))} aria-label="Aumentar zoom" className="rounded border border-border p-1">
                  <ZoomIn className="size-3" />
                </button>
              </div>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Scissors className="size-3.5" /> Timeline NLE
              </span>
            </div>
            <button
              type="button"
              onClick={() => setAssistantOpen(!assistantOpen)}
              className="inline-flex items-center gap-1 rounded-lg border border-primary/40 bg-primary/15 px-2.5 py-1 text-purple-200"
            >
              <Wand2 className="size-3.5" /> {assistantOpen ? 'Ocultar Assistente IA' : 'Assistente IA'}
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-auto pb-1">
            <div className="flex gap-2" style={{ minWidth: timelineWidthPx + 152 }}>
              {/* Track headers */}
              <div className="w-36 shrink-0 space-y-1.5 pt-7 text-[11px]">
                {[
                  { id: 'vfx1', label: 'V3 Gráficos', icon: Type },
                  { id: 'v1', label: 'V1 Vídeo Principal', icon: Layers },
                  { id: 'a_nar', label: 'A1 Narração', icon: Volume2 },
                  { id: 'a_mus', label: 'A2 Música', icon: Music },
                  { id: 'a_sfx', label: 'A3 SFX', icon: Sliders },
                  { id: 'a_amb', label: 'A4 Ambiente', icon: Waves },
                ].map((track) => {
                  const Icon = track.icon;
                  return (
                    <div key={track.id} className="flex h-10 items-center gap-1.5 rounded-lg bg-[#0d0d17] px-2.5 text-muted-foreground">
                      <Icon className="size-3 text-purple-400" />
                      <span className="truncate">{track.label}</span>
                    </div>
                  );
                })}
              </div>

              {/* Scrollable Timeline Canvas + Ruler + Playhead */}
              <div className="relative flex-1 space-y-1.5">
                {/* Temporal Ruler */}
                <div
                  ref={rulerRef}
                  role="slider"
                  aria-label="Régua temporal e playhead"
                  aria-valuemin={0}
                  aria-valuemax={totalDurationSec}
                  aria-valuenow={playheadSec}
                  tabIndex={0}
                  onPointerDown={(e) => {
                    scrubbingRef.current = true;
                    scrubToClientX(e.clientX);
                  }}
                  className="relative h-6 cursor-ew-resize rounded-md border border-border/60 bg-[#0d0d17]"
                  style={{ width: timelineWidthPx }}
                >
                  {ticks.map((sec) => (
                    <div
                      key={sec}
                      className="absolute top-0 bottom-0 border-l border-border/60 pl-1 font-mono text-[9px] text-muted-foreground"
                      style={{ left: sec * pxPerSec }}
                    >
                      {sec}s
                    </div>
                  ))}
                </div>

                {/* Playhead vertical line */}
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-20 w-0.5 bg-amber-400 shadow-[0_0_8px_rgba(245,158,11,0.8)]"
                  style={{ left: playheadSec * pxPerSec }}
                >
                  <div className=" -ml-1.5 h-2.5 w-3.5 rounded-b bg-amber-400" />
                </div>

                {/* V3 Graphics */}
                <div className="relative h-10 rounded-lg bg-[#090910]" style={{ width: timelineWidthPx }}>
                  {clips.map((c) => (
                    <div
                      key={`gfx_${c.clipId}`}
                      className="absolute top-1.5 bottom-1.5 truncate rounded border border-purple-400/40 bg-purple-500/20 px-1.5 py-1 text-[10px] text-purple-200"
                      style={{
                        left: c.startSec * pxPerSec,
                        width: Math.max(32, (c.durationSec / Math.max(0.25, c.speed)) * pxPerSec - 2),
                      }}
                    >
                      HUD: {c.label}
                    </div>
                  ))}
                </div>

                {/* V1 Main Video Track (Draggable + Drop from Library + Razor + Thumbnails) */}
                <div
                  className="relative h-10 rounded-lg bg-[#090910]"
                  style={{ width: timelineWidthPx }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    const raw = e.dataTransfer.getData('application/aethera-asset');
                    if (!raw) return;
                    try {
                      const asset = JSON.parse(raw) as ImportedAsset;
                      handleAddAssetToTimeline(asset);
                    } catch {
                      // ignore malformed drag payload
                    }
                  }}
                >
                  {clips.filter((c) => (c.trackId ?? 'v1') !== 'sub1').map((clip) => {
                    const widthPx = Math.max(44, (clip.durationSec / Math.max(0.25, clip.speed)) * pxPerSec - 2);
                    const matchedAsset = importedAssets.find(
                      (a) => a.mediaId === clip.mediaId || a.mediaId === clip.sourceMediaId || a.name === clip.label,
                    );
                    const thumbUrl = clip.thumbnailUrl ?? matchedAsset?.thumbnailUrl ?? null;
                    const frameCount = Math.max(1, Math.min(12, Math.floor(widthPx / 56)));
                    return (
                      <div
                        key={clip.clipId}
                        role="button"
                        tabIndex={0}
                        onPointerDown={(e) => {
                          setSelectedClipId(clip.clipId);
                          if (timelineTool === 'razor') {
                            void handleSplitAtPlayhead(clip.clipId);
                            return;
                          }
                          dragClipRef.current = {
                            clipId: clip.clipId,
                            startX: e.clientX,
                            initialStartSec: clip.startSec,
                          };
                        }}
                        className={`absolute top-0.5 bottom-0.5 flex cursor-grab items-end overflow-hidden rounded-md border text-left text-[11px] font-medium active:cursor-grabbing ${
                          clip.clipId === selectedClipId
                            ? 'border-amber-400 ring-1 ring-amber-400/70 bg-amber-500/20 text-foreground'
                            : 'border-violet-400/50 bg-violet-600/25 text-foreground/90'
                        }`}
                        style={{ left: clip.startSec * pxPerSec, width: widthPx }}
                      >
                        {thumbUrl && (
                          <div className="pointer-events-none absolute inset-0 flex overflow-hidden opacity-85">
                            {Array.from({ length: frameCount }).map((_, idx) => (
                              <img
                                key={idx}
                                src={thumbUrl}
                                alt=""
                                className="h-full flex-1 object-cover border-r border-black/30 last:border-r-0"
                              />
                            ))}
                          </div>
                        )}
                        <div className="relative z-10 flex w-full items-center gap-1 bg-gradient-to-t from-black/85 via-black/45 to-transparent px-1.5 py-0.5">
                          <span className="truncate text-[10px] font-medium text-white drop-shadow">{clip.label}</span>
                          {clip.transitionIn && clip.transitionIn !== 'cut' && (
                            <span className="shrink-0 rounded bg-purple-600/80 px-1 text-[8px] uppercase text-white">
                              {clip.transitionIn}
                            </span>
                          )}
                          <span className="ml-auto shrink-0 font-mono text-[9px] text-amber-200">{clip.durationSec}s</span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* A1 Narration, A2 Music, A3 SFX, A4 Ambience Real Waveforms */}
                {(() => {
                  const nar = pkg?.soundPlan.stems.find((s) => s.stemRole === 'voiceover');
                  const mus = pkg?.soundPlan.stems.find((s) => s.stemRole === 'music');
                  const sfxStem = pkg?.soundPlan.stems.find((s) => s.stemRole === 'sfx');
                  const amb = pkg?.soundPlan.stems.find((s) => s.stemRole === 'ambience');

                  const audioAssets = importedAssets.filter((a) => a.kind === 'audio');
                  const narPath =
                    renderedMedia?.stemPaths?.voiceover ??
                    audioAssets.find((a) => /nar|voz|voice/i.test(a.name))?.filePath ??
                    renderedMedia?.mp4Path ??
                    audioAssets[0]?.filePath ??
                    null;
                  const musPath =
                    renderedMedia?.stemPaths?.music ??
                    audioAssets.find((a) => /mus|music|bgm|beat/i.test(a.name))?.filePath ??
                    renderedMedia?.stemPaths?.master ??
                    null;
                  const sfxPath =
                    renderedMedia?.stemPaths?.sfx ??
                    audioAssets.find((a) => /sfx|fx|impact|whoosh/i.test(a.name))?.filePath ??
                    renderedMedia?.stemPaths?.master ??
                    null;
                  const ambPath =
                    renderedMedia?.stemPaths?.ambience ??
                    audioAssets.find((a) => /amb|room|crowd|wind/i.test(a.name))?.filePath ??
                    null;

                  const narState = narPath ? waveformMap[narPath] : undefined;
                  const musState = musPath ? waveformMap[musPath] : undefined;
                  const sfxState = sfxPath ? waveformMap[sfxPath] : undefined;
                  const ambState = ambPath ? waveformMap[ambPath] : undefined;

                  const narClips = clips.filter((c) => (c.trackId ?? 'v1') === 'v1');
                  const sfxEvents = pkg?.soundPlan.sfxEvents ?? [];

                  return (
                    <>
                      {/* A1 Narração (clip-synced bipolar waveform) */}
                      <div
                        className={`relative flex h-10 items-center rounded-lg border border-emerald-500/25 bg-[#090910] ${nar?.muted ? 'opacity-40' : ''}`}
                        style={{ width: timelineWidthPx }}
                      >
                        <span className="pointer-events-none absolute right-2 top-0.5 z-10 font-mono text-[9px] text-emerald-300">
                          {nar?.muted ? 'MUTE' : `${nar?.targetGainDb ?? 0} dB`}
                        </span>
                        {narClips.length > 0 ? (
                          narClips.map((clip) => {
                            const clipWidth = Math.max(24, (clip.durationSec / Math.max(0.25, clip.speed)) * pxPerSec - 2);
                            const clipSourceUri = clip.sourceMediaId
                              ? pkg?.timeline.sourceMedia[clip.sourceMediaId]?.uri
                              : undefined;
                            const clipPath =
                              clipSourceUri && !clipSourceUri.startsWith('http') && waveformMap[clipSourceUri]?.data?.hasAudio
                                ? clipSourceUri
                                : narPath;
                            const clipState = clipPath ? waveformMap[clipPath] : narState;
                            return (
                              <div
                                key={`nar_${clip.clipId}`}
                                className="absolute top-1 bottom-1 overflow-hidden rounded border border-emerald-500/30 bg-emerald-950/20"
                                style={{ left: clip.startSec * pxPerSec, width: clipWidth }}
                                title={`${clip.label} · ${clip.durationSec}s (${clip.speed}x)`}
                              >
                                <WaveformCanvas
                                  data={clipState?.data ?? null}
                                  loading={Boolean(clipState?.loading)}
                                  error={clipState?.error ?? null}
                                  widthPx={clipWidth}
                                  heightPx={32}
                                  role="voiceover"
                                  sourceStartSec={clip.startSec}
                                  timelineDurationSec={clip.durationSec / Math.max(0.25, clip.speed)}
                                  speed={clip.speed}
                                  gainDb={nar?.targetGainDb ?? 0}
                                  muted={Boolean(nar?.muted)}
                                  label={clip.label}
                                />
                              </div>
                            );
                          })
                        ) : (
                          <WaveformCanvas
                            data={narState?.data ?? null}
                            loading={Boolean(narState?.loading)}
                            error={narState?.error ?? null}
                            widthPx={timelineWidthPx}
                            heightPx={34}
                            role="voiceover"
                            timelineDurationSec={totalDurationSec}
                            gainDb={nar?.targetGainDb ?? 0}
                            muted={Boolean(nar?.muted)}
                            label="A1 Narração"
                          />
                        )}
                      </div>

                      {/* A2 Música (bipolar waveform) */}
                      <div
                        className={`relative flex h-10 items-center overflow-hidden rounded-lg border border-sky-500/25 bg-[#090910] ${mus?.muted ? 'opacity-40' : ''}`}
                        style={{ width: timelineWidthPx }}
                      >
                        <span className="pointer-events-none absolute right-2 top-0.5 z-10 font-mono text-[9px] text-sky-300">
                          {mus?.muted ? 'MUTE' : `${mus?.targetGainDb ?? -16} dB`}
                        </span>
                        <WaveformCanvas
                          data={musState?.data ?? null}
                          loading={Boolean(musState?.loading)}
                          error={musState?.error ?? null}
                          widthPx={Math.max(40, totalDurationSec * pxPerSec)}
                          heightPx={34}
                          role="music"
                          timelineDurationSec={totalDurationSec}
                          gainDb={(mus?.targetGainDb ?? -16) + 16}
                          muted={Boolean(mus?.muted)}
                          fadeInSec={1.2}
                          fadeOutSec={1.5}
                          label="A2 Música"
                        />
                      </div>

                      {/* A3 SFX (individual cue clips with real waveforms) */}
                      <div
                        className={`relative h-10 rounded-lg border border-amber-500/20 bg-[#090910] ${sfxStem?.muted ? 'opacity-40' : ''}`}
                        style={{ width: timelineWidthPx }}
                      >
                        <span className="pointer-events-none absolute right-2 top-0.5 z-10 font-mono text-[9px] text-amber-300">
                          {sfxStem?.muted ? 'MUTE' : `${sfxStem?.targetGainDb ?? -8} dB`}
                        </span>
                        {sfxEvents.map((ev) => {
                          const cueDurationSec = 1.2;
                          const cueWidth = Math.max(48, cueDurationSec * pxPerSec);
                          return (
                            <div
                              key={ev.cueId}
                              className="absolute top-1 bottom-1 overflow-hidden rounded border border-amber-400/50 bg-amber-500/15"
                              style={{ left: ev.timeSeconds * pxPerSec, width: cueWidth }}
                              title={`${ev.sfxName} @ ${ev.timeSeconds}s — ${ev.reason}`}
                            >
                              <WaveformCanvas
                                data={sfxState?.data ?? null}
                                loading={Boolean(sfxState?.loading)}
                                error={sfxState?.error ?? null}
                                widthPx={cueWidth}
                                heightPx={32}
                                role="sfx"
                                sourceStartSec={ev.timeSeconds}
                                timelineDurationSec={cueDurationSec}
                                gainDb={(sfxStem?.targetGainDb ?? -8) + 8}
                                muted={Boolean(sfxStem?.muted)}
                                label={ev.sfxName}
                              />
                              <span className="pointer-events-none absolute left-1 top-0.5 truncate text-[9px] font-medium text-amber-200 drop-shadow">
                                {ev.sfxName}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      {/* A4 Ambiente (bipolar waveform) */}
                      <div
                        className={`relative flex h-10 items-center overflow-hidden rounded-lg border border-violet-500/25 bg-[#090910] ${amb?.muted ? 'opacity-40' : ''}`}
                        style={{ width: timelineWidthPx }}
                      >
                        <span className="pointer-events-none absolute right-2 top-0.5 z-10 font-mono text-[9px] text-violet-300">
                          {amb?.muted ? 'MUTE' : `${amb?.targetGainDb ?? -22} dB`}
                        </span>
                        <WaveformCanvas
                          data={ambState?.data ?? null}
                          loading={Boolean(ambState?.loading)}
                          error={ambState?.error ?? null}
                          widthPx={Math.max(40, totalDurationSec * pxPerSec)}
                          heightPx={34}
                          role="ambience"
                          timelineDurationSec={totalDurationSec}
                          gainDb={(amb?.targetGainDb ?? -22) + 22}
                          muted={Boolean(amb?.muted)}
                          label="A4 Ambiente"
                        />
                      </div>
                    </>
                  );
                })()}
              </div>
            </div>
          </div>
        </section>

        {assistantOpen && (
          <>
            <div
              role="separator"
              aria-orientation="vertical"
              title="Arraste para redimensionar Timeline / Assistente IA (duplo clique para resetar)"
              onPointerDown={(e) => startPanelResize('assistant', e)}
              onDoubleClick={resetLayoutSizes}
              className="hidden lg:flex w-2 shrink-0 cursor-col-resize items-center justify-center group"
            >
              <div className="h-10 w-0.5 rounded-full bg-border/80 transition group-hover:h-16 group-hover:bg-purple-400" />
            </div>
            <aside className="flex min-h-0 shrink-0 flex-col overflow-y-auto rounded-xl border border-primary/30 bg-card p-2.5 lg:w-[var(--assistant-w)] space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="inline-flex items-center gap-1.5 text-xs font-semibold">
                <Bot className="size-3.5 text-purple-400" /> Assistente de Edição IA
              </h3>
              <button type="button" onClick={() => setAssistantOpen(false)} aria-label="Fechar assistente">
                <ChevronRight className="size-4 text-muted-foreground" />
              </button>
            </div>
            <div className="rounded-xl border border-border bg-[#0d0d17] p-2.5 text-xs space-y-1.5">
              <p className="font-medium text-foreground">Sugestão de Ritmo</p>
              <p className="text-[11px] text-muted-foreground">
                Ajuste o clipe selecionado (-0.5s) para corte seco antes do clímax e renderize o MP4.
              </p>
              <button
                type="button"
                onClick={() => handleTrimEnd(-0.5)}
                className="inline-flex items-center gap-1 rounded-lg bg-primary/20 px-2.5 py-1 text-[11px] font-medium text-purple-200 hover:bg-primary/30"
              >
                <Sparkles className="size-3" /> Aplicar trim
              </button>
            </div>

            <form
              onSubmit={handleApplyRevisionAndLearn}
              className="rounded-xl border border-amber-500/30 bg-[#0d0d17] p-2.5 text-xs space-y-2"
            >
              <p className="font-medium text-amber-300">Revisão &amp; Aprendizado dos Diretores</p>
              <p className="text-[11px] text-muted-foreground">
                Descreva o que corrigir. A instrução vai para Memória &amp; Feedback e atualiza o vídeo.
              </p>
              <textarea
                rows={3}
                value={revisionText}
                onChange={(e) => setRevisionText(e.target.value)}
                placeholder="Ex.: cortes mais dinâmicos, música mais baixa na narração e sem cards automáticos..."
                className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground"
              />
              <button
                type="submit"
                disabled={!pkg || submittingRevision || !revisionText.trim()}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-amber-500 px-3 py-1.5 text-[11px] font-semibold text-white hover:brightness-110 disabled:opacity-50"
              >
                {submittingRevision && <LoaderCircle className="size-3.5 animate-spin" />}
                {submittingRevision ? 'Aplicando e salvando memória...' : 'Corrigir & Ensinar Diretores'}
              </button>
            </form>
            </aside>
          </>
        )}
      </div>

      {auditOpen && pkg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Auditoria do Projeto e Editor de Roteiro"
        >
          <div className="flex max-h-[88vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-border bg-[#0d0d17] shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">
                  Auditoria do Projeto &amp; Editor de Roteiro
                </h2>
                <p className="text-[11px] text-muted-foreground">
                  {projects.find((p) => p.projectId === pkg.timeline.projectId)?.title ?? pkg.timeline.projectId} · v{pkg.timeline.version}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAuditOpen(false)}
                className="rounded-lg border border-border p-1.5 text-muted-foreground hover:border-primary hover:text-foreground"
                aria-label="Fechar auditoria"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background/40 px-5 py-2 text-xs">
              <button
                type="button"
                onClick={() => setAuditTab('script')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
                  auditTab === 'script'
                    ? 'bg-purple-600/25 text-purple-200 border border-purple-500/40'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <FileText className="size-3.5" /> Roteiro &amp; Narração ({beatsDraft.length})
              </button>
              <button
                type="button"
                onClick={() => setAuditTab('direction')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
                  auditTab === 'direction'
                    ? 'bg-purple-600/25 text-purple-200 border border-purple-500/40'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Film className="size-3.5" /> Direção de Cenas ({pkg.direction?.shots?.length ?? 0})
              </button>
              <button
                type="button"
                onClick={() => setAuditTab('research')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
                  auditTab === 'research'
                    ? 'bg-purple-600/25 text-purple-200 border border-purple-500/40'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <Search className="size-3.5" /> Pesquisa &amp; Mídias ({Object.keys(pkg.timeline.sourceMedia ?? {}).length})
              </button>
              <button
                type="button"
                onClick={() => setAuditTab('quality')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-medium transition-colors ${
                  auditTab === 'quality'
                    ? 'bg-purple-600/25 text-purple-200 border border-purple-500/40'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <ShieldCheck className="size-3.5" /> Qualidade &amp; QC
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-5 text-xs">
              {auditTab === 'script' && (() => {
                const reviewBeatSpeech = (summary: string, durationSec: number) => {
                  const trimmed = summary.trim();
                  const words = trimmed ? trimmed.split(/\s+/).length : 0;
                  const estSec = Math.round(words / 2.4);
                  const isTemplate = /^(Abertura cinematográfica apresentando|Contextualização e promessa do episódio|Capítulo \d+ de \d+ sobre|Clímax principal de|Escalada de tensão em|Desenvolvimento narrativo)/i.test(
                    trimmed,
                  );
                  if (words === 0) {
                    return { words, estSec, status: 'empty' as const, label: 'Sem fala' };
                  }
                  if (isTemplate) {
                    return { words, estSec, status: 'template' as const, label: 'Texto genérico (template)' };
                  }
                  if (durationSec > 0 && estSec < durationSec * 0.4) {
                    return { words, estSec, status: 'short' as const, label: 'Fala curta para a cena' };
                  }
                  if (durationSec > 0 && estSec > durationSec * 1.35) {
                    return { words, estSec, status: 'long' as const, label: 'Fala longa (pode cortar/acelerar)' };
                  }
                  return { words, estSec, status: 'ok' as const, label: 'Ritmo OK' };
                };
                const beatReviews = beatsDraft.map((b) => reviewBeatSpeech(b.summary, b.durationSec));
                const totalWords = beatReviews.reduce((acc, r) => acc + r.words, 0);
                const totalEstSec = beatReviews.reduce((acc, r) => acc + r.estSec, 0);
                const totalBeatDuration = beatsDraft.reduce((acc, b) => acc + b.durationSec, 0);
                const templateCount = beatReviews.filter((r) => r.status === 'template').length;
                const pacingIssuesCount = beatReviews.filter((r) => r.status !== 'ok').length;
                const coveragePct = totalBeatDuration > 0 ? Math.min(100, Math.round((totalEstSec / totalBeatDuration) * 100)) : 0;

                return (
                <div className="space-y-3">
                  <div className="rounded-xl border border-purple-500/30 bg-card/70 p-3 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-purple-200">
                        Revisão das Falas &amp; Ritmo de Narração
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          pacingIssuesCount === 0 && (auditJob?.scriptValidation?.valid ?? true)
                            ? 'bg-emerald-500/20 text-emerald-300'
                            : 'bg-amber-500/20 text-amber-300'
                        }`}
                      >
                        {pacingIssuesCount === 0 && (auditJob?.scriptValidation?.valid ?? true)
                          ? 'Falas aprovadas'
                          : `${pacingIssuesCount} ponto(s) de revisão`}
                      </span>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 text-[11px]">
                      <div className="rounded-lg border border-border/70 bg-background/60 px-2.5 py-1.5">
                        <p className="text-[10px] text-muted-foreground">Palavras</p>
                        <p className="font-mono font-semibold text-foreground">{totalWords}</p>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-background/60 px-2.5 py-1.5">
                        <p className="text-[10px] text-muted-foreground">Tempo falado est.</p>
                        <p className="font-mono font-semibold text-foreground">~{totalEstSec}s / {totalBeatDuration}s</p>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-background/60 px-2.5 py-1.5">
                        <p className="text-[10px] text-muted-foreground">Cobertura vocal</p>
                        <p className="font-mono font-semibold text-foreground">{coveragePct}%</p>
                      </div>
                      <div className="rounded-lg border border-border/70 bg-background/60 px-2.5 py-1.5">
                        <p className="text-[10px] text-muted-foreground">Templates genéricos</p>
                        <p className={`font-mono font-semibold ${templateCount > 0 ? 'text-amber-300' : 'text-emerald-300'}`}>
                          {templateCount}
                        </p>
                      </div>
                    </div>
                    {(auditJob?.scriptValidation?.warnings ?? []).length > 0 && (
                      <div className="space-y-1 rounded-lg border border-amber-500/30 bg-amber-500/10 p-2 text-[10px] text-amber-200">
                        {(auditJob?.scriptValidation?.warnings ?? []).map((w, wi) => (
                          <p key={wi}>• {w}</p>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-purple-200">
                      Roteiro / Falas por Beat Narrativo ({beatsDraft.length})
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      Edite o texto narrado de cada cena e clique em Salvar Roteiro.
                    </span>
                  </div>

                  {beatsDraft.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-4 text-center text-muted-foreground">
                      Este projeto ainda não possui beats de roteiro estruturados.
                    </div>
                  ) : (
                    beatsDraft.map((beat, idx) => {
                      const rev = beatReviews[idx] ?? reviewBeatSpeech(beat.summary, beat.durationSec);
                      const badgeCls =
                        rev.status === 'ok'
                          ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                          : rev.status === 'template'
                            ? 'bg-rose-500/15 text-rose-300 border-rose-500/30'
                            : 'bg-amber-500/15 text-amber-300 border-amber-500/30';
                      return (
                      <div
                        key={beat.beatId}
                        className="space-y-2 rounded-xl border border-border bg-card/60 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded bg-purple-500/20 px-2 py-0.5 font-mono text-[10px] uppercase text-purple-200">
                              #{idx + 1} · {beat.stage}
                            </span>
                            <span className="font-mono text-[10px] text-muted-foreground">
                              ~{rev.estSec}s fala / {beat.durationSec}s cena · {rev.words} palavras
                            </span>
                            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${badgeCls}`}>
                              {rev.label}
                            </span>
                          </div>
                          <span className="font-mono text-[10px] text-muted-foreground">{beat.beatId}</span>
                        </div>
                        <textarea
                          rows={3}
                          value={beat.summary}
                          onChange={(e) => {
                            const val = e.target.value;
                            setBeatsDraft((prev) =>
                              prev.map((item) =>
                                item.beatId === beat.beatId ? { ...item, summary: val } : item
                              )
                            );
                          }}
                          className="w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs text-foreground focus:border-purple-500 focus:outline-none"
                          aria-label={`Roteiro do beat ${idx + 1}`}
                        />
                      </div>
                      );
                    })
                  )}
                </div>
                );
              })()}

              {auditTab === 'direction' && (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-medium text-purple-200">
                      Tratamento Cinematográfico &amp; Abordagem Geral
                    </label>
                    <textarea
                      rows={3}
                      value={treatmentDraft}
                      onChange={(e) => setTreatmentDraft(e.target.value)}
                      placeholder="Direção geral, tom, ritmo e estética..."
                      className="w-full rounded-xl border border-border bg-background px-3 py-2 text-xs text-foreground focus:border-purple-500 focus:outline-none"
                    />
                  </div>

                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-medium text-purple-200">
                        Decupagem &amp; Direção de Cenas ({pkg.direction?.shots?.length ?? 0})
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        Enquadramento, movimento de câmera, justificativa visual e mídia vinculada.
                      </span>
                    </div>
                    {(pkg.direction?.shots ?? []).length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border p-4 text-center text-muted-foreground">
                        Nenhuma direção de cena registrada neste pacote.
                      </div>
                    ) : (
                      (pkg.direction?.shots ?? []).map((shot, idx) => {
                        const linkedBeat = beatsDraft.find((b) => b.beatId === shot.beatId);
                        const linkedClip = (pkg.timeline?.clips ?? []).filter((c) => !c.trackId || c.trackId === 'v1')[idx];
                        return (
                          <div key={shot.shotId} className="space-y-1.5 rounded-xl border border-border bg-card/60 p-3">
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-medium text-amber-200">
                                  Cena #{idx + 1} · {shot.shotId}
                                </span>
                                <span className="rounded border border-border px-2 py-0.5 text-[10px] text-foreground">
                                  Enquadramento: {shot.framing}
                                </span>
                                <span className="rounded border border-border px-2 py-0.5 text-[10px] text-foreground">
                                  Câmera: {shot.cameraMotion}
                                </span>
                                {shot.mediaGap && (
                                  <span className="rounded bg-rose-500/20 px-2 py-0.5 text-[10px] text-rose-300">
                                    Lacuna de mídia
                                  </span>
                                )}
                              </div>
                              <span className="font-mono text-[10px] text-muted-foreground">
                                {linkedBeat ? `${linkedBeat.stage} · ${linkedBeat.durationSec}s` : shot.beatId}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              <span className="font-medium text-foreground">Direção visual:</span> {shot.motionJustification}
                            </p>
                            {linkedClip && (
                              <p className="text-[10px] text-purple-200/80">
                                Clipe V1: <span className="font-mono">{linkedClip.label}</span>
                                {linkedClip.sourceMediaId ? ` (${linkedClip.sourceMediaId})` : ''}
                              </p>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {auditTab === 'research' && (
                <div className="space-y-4">
                  {previewAuditMedia && (
                    <div className="rounded-xl border border-purple-500/40 bg-[#0d0d17] p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[11px] font-medium text-purple-200">
                          Prévia da Mídia: <span className="font-mono text-foreground">{previewAuditMedia.mediaId}</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setPreviewAuditMedia(null)}
                          className="rounded border border-border px-2 py-0.5 text-[10px] text-muted-foreground hover:text-foreground"
                        >
                          Fechar Prévia
                        </button>
                      </div>
                      {previewAuditMedia.kind === 'image' ? (
                        <img
                          src={previewAuditMedia.mediaUrl}
                          alt={previewAuditMedia.mediaId}
                          className="max-h-64 w-full rounded-lg bg-black object-contain"
                        />
                      ) : previewAuditMedia.kind === 'audio' ? (
                        <audio src={previewAuditMedia.mediaUrl} controls autoPlay className="w-full" />
                      ) : (
                        <video
                          src={previewAuditMedia.mediaUrl}
                          controls
                          autoPlay
                          className="max-h-64 w-full rounded-lg bg-black object-contain"
                        />
                      )}
                    </div>
                  )}

                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="rounded-xl border border-border bg-card/60 p-3">
                      <p className="text-[11px] font-medium text-purple-200">Mídias no Projeto ({Object.keys(pkg.timeline.sourceMedia ?? {}).length})</p>
                      <div className="mt-2 max-h-72 space-y-2 overflow-y-auto">
                        {Object.values(pkg.timeline.sourceMedia ?? {}).length === 0 ? (
                          <p className="text-muted-foreground">Nenhuma mídia vinculada ao projeto.</p>
                        ) : (
                          Object.values(pkg.timeline.sourceMedia ?? {}).map((m) => {
                            const uri = m.uri ?? '';
                            const isLocalFile = Boolean(
                              uri &&
                              !uri.startsWith('/workspace/') &&
                              !uri.startsWith('http://') &&
                              !uri.startsWith('https://'),
                            );
                            const mediaUrl = isLocalFile
                              ? uri.startsWith('aethera-media://')
                                ? uri
                                : `aethera-media://local?path=${encodeURIComponent(uri)}`
                              : null;
                            return (
                              <div key={m.mediaId} className="flex items-center gap-2.5 rounded-lg border border-border/70 bg-background/60 p-2">
                                {mediaUrl && m.kind === 'video' && (
                                  <video
                                    src={mediaUrl}
                                    preload="metadata"
                                    muted
                                    className="h-12 w-20 shrink-0 rounded bg-black object-cover"
                                  />
                                )}
                                {mediaUrl && m.kind === 'image' && (
                                  <img
                                    src={mediaUrl}
                                    alt={m.mediaId}
                                    className="h-12 w-20 shrink-0 rounded bg-black object-cover"
                                  />
                                )}
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-medium text-foreground">{m.mediaId}</p>
                                  <p className="truncate text-[10px] text-muted-foreground">
                                    {m.kind}{m.width && m.height ? ` · ${m.width}x${m.height}` : ''} · {m.license}
                                  </p>
                                  {m.uri && (
                                    <p className="truncate font-mono text-[10px] text-muted-foreground">{m.uri}</p>
                                  )}
                                  {!isLocalFile && (
                                    <span className="mt-0.5 inline-block rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-300">
                                      Sem arquivo local (caminho virtual)
                                    </span>
                                  )}
                                </div>
                                {mediaUrl && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setPreviewAuditMedia({
                                        mediaId: m.mediaId,
                                        kind: m.kind,
                                        uri,
                                        mediaUrl,
                                      })
                                    }
                                    className="shrink-0 rounded-lg border border-purple-500/40 bg-purple-500/15 px-2.5 py-1 text-[10px] font-medium text-purple-200 hover:bg-purple-500/25"
                                  >
                                    Prévia
                                  </button>
                                )}
                              </div>
                            );
                          })
                        )}
                      </div>
                    </div>

                    <div className="rounded-xl border border-border bg-card/60 p-3">
                      <p className="text-[11px] font-medium text-purple-200">
                        Aquisição &amp; Lacunas de Pesquisa
                      </p>
                      <div className="mt-2 max-h-72 space-y-1.5 overflow-y-auto">
                        {auditJob ? (
                          <>
                            <p className="text-[11px] text-muted-foreground">
                              Estado: <span className="text-foreground">{auditJob.state}</span> ({auditJob.progressPct}%) · Etapas:{' '}
                              {auditJob.completedStages?.join(', ') || 'nenhuma'}
                            </p>
                            {(auditJob.acquiredMedia ?? []).map((am) => {
                              const uri = am.uri ?? '';
                              const isLocalFile = Boolean(
                                uri &&
                                !uri.startsWith('/workspace/') &&
                                !uri.startsWith('http://') &&
                                !uri.startsWith('https://'),
                              );
                              const mediaUrl = isLocalFile
                                ? uri.startsWith('aethera-media://')
                                  ? uri
                                  : `aethera-media://local?path=${encodeURIComponent(uri)}`
                                : null;
                              return (
                                <div key={am.mediaId} className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2">
                                  <div className="min-w-0 flex-1">
                                    <p className="truncate font-medium text-emerald-200">{am.mediaId}</p>
                                    <p className="truncate text-[10px] text-emerald-300/80">
                                      {am.kind} {am.width && am.height ? `· ${am.width}x${am.height}` : ''} {am.license ? `· ${am.license}` : ''}
                                    </p>
                                  </div>
                                  {mediaUrl && (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setPreviewAuditMedia({
                                          mediaId: am.mediaId,
                                          kind: am.kind,
                                          uri,
                                          mediaUrl,
                                        })
                                      }
                                      className="shrink-0 rounded border border-emerald-400/40 px-2 py-0.5 text-[10px] text-emerald-100 hover:bg-emerald-500/20"
                                    >
                                      Prévia
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                            {(auditJob.pendingMedia ?? []).map((pm) => (
                              <div key={`${pm.slotIndex}-${pm.query}`} className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2">
                                <p className="font-medium text-amber-200">Pendente (Slot {pm.slotIndex}): {pm.query}</p>
                                <p className="text-[10px] text-amber-300/80">{pm.reason}</p>
                              </div>
                            ))}
                          </>
                        ) : (
                          <p className="text-muted-foreground">Nenhum registro de job de produção IA encontrado para este projeto.</p>
                        )}
                        {(pkg.direction?.mediaGaps ?? []).map((gap) => (
                          <div key={gap.shotId} className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-2">
                            <p className="font-medium text-rose-200">Lacuna em {gap.shotId}</p>
                            <p className="text-[10px] text-rose-300/80">{gap.reason}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {auditTab === 'quality' && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-card/60 p-3">
                    <p className="text-[11px] font-medium text-purple-200">Briefing Original</p>
                    <p className="mt-1 whitespace-pre-wrap text-foreground">
                      {pkg.direction?.brief?.prompt || 'Sem briefing registrado.'}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-muted-foreground">
                      {pkg.direction?.brief?.genre && <span>Gênero: {pkg.direction.brief.genre}</span>}
                      {pkg.direction?.brief?.targetDurationSec && (
                        <span>Alvo: {pkg.direction.brief.targetDurationSec}s</span>
                      )}
                      {pkg.direction?.brief?.humorIntensity !== undefined && (
                        <span>Humor: {Math.round(pkg.direction.brief.humorIntensity * 100)}%</span>
                      )}
                      {pkg.direction?.brief?.renderProfile && (
                        <span>Perfil: {pkg.direction.brief.renderProfile}</span>
                      )}
                    </div>
                  </div>

                  {pkg.scorecard && (
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-6">
                      {[
                        ['Geral', pkg.scorecard.compositeScore],
                        ['Técnico', pkg.scorecard.technicalScore],
                        ['Áudio', pkg.scorecard.audioScore],
                        ['Visual', pkg.scorecard.visualScore],
                        ['Narrativa', pkg.scorecard.narrativeScore],
                        ['Humor', pkg.scorecard.comedyScore],
                      ].map(([label, val]) => (
                        <div key={String(label)} className="rounded-xl border border-border bg-card/60 p-2.5 text-center">
                          <p className="text-[10px] text-muted-foreground">{label}</p>
                          <p className="mt-0.5 text-sm font-semibold text-foreground">{String(val)}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="rounded-xl border border-border bg-card/60 p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-[11px] font-medium text-purple-200">Release Gates &amp; Achados</p>
                      {pkg.releaseGates && (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                            pkg.releaseGates.passed
                              ? 'bg-emerald-500/20 text-emerald-300'
                              : 'bg-amber-500/20 text-amber-300'
                          }`}
                        >
                          {pkg.releaseGates.passed ? 'Aprovado' : 'Com pendências'}
                        </span>
                      )}
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {(pkg.findings ?? []).length === 0 ? (
                        <p className="text-muted-foreground">Nenhum achado crítico registrado.</p>
                      ) : (
                        (pkg.findings ?? []).map((f) => (
                          <div key={f.issueId} className="rounded-lg border border-border/70 bg-background/60 p-2">
                            <p className="font-medium text-foreground">
                              [{f.severity}] {f.issueId} ({f.status})
                            </p>
                            <p className="text-[11px] text-muted-foreground">{f.evidence}</p>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border bg-background/60 px-5 py-3 text-xs">
              <span className="text-[11px] text-muted-foreground">
                Alterações no roteiro incrementam a versão do projeto automaticamente.
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setAuditOpen(false)}
                  className="rounded-lg border border-border px-3 py-1.5 text-muted-foreground hover:border-primary hover:text-foreground"
                >
                  Fechar
                </button>
                {(auditTab === 'script' || auditTab === 'direction') && (
                  <button
                    type="button"
                    onClick={() => void handleSaveScript()}
                    disabled={savingScript}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-amber-500 px-3.5 py-1.5 font-semibold text-white hover:brightness-110 disabled:opacity-50"
                  >
                    {savingScript ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
                    {savingScript ? 'Salvando Roteiro...' : 'Salvar Roteiro'}
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteProjectTarget && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label="Confirmar exclusão de projeto"
        >
          <div className="w-full max-w-md rounded-2xl border border-border bg-[#0d0d17] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Excluir Projeto</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Tem certeza que deseja excluir <span className="font-semibold text-foreground">"{deleteProjectTarget.title}"</span>? Essa ação removerá o projeto e não pode ser desfeita.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDeleteProjectTarget(null)}
                className="rounded-lg border border-border p-1 text-muted-foreground hover:text-foreground"
                aria-label="Fechar"
              >
                <X className="size-4" />
              </button>
            </div>
            <div className="mt-5 flex justify-end gap-2 text-xs">
              <button
                type="button"
                onClick={() => setDeleteProjectTarget(null)}
                disabled={deletingProject}
                className="rounded-lg border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleConfirmDeleteProject()}
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
    </div>
  );
}
