import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot,
  ChevronRight,
  Download,
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
  Sliders,
  Sparkles,
  Type,
  Undo2,
  Upload,
  Volume2,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Link, useSearchParams } from 'react-router';

type LeftBinTab = 'media' | 'effects' | 'transitions' | 'titles' | 'sfx' | 'music';
type InspectorTab = 'transform' | 'color' | 'audio' | 'speed';

interface EditorClip {
  clipId: string;
  label: string;
  startSec: number;
  durationSec: number;
  speed: number;
  sourceMediaId?: string | undefined;
  sourceUri?: string | undefined;
  sourceKind?: 'video' | 'image' | 'audio';
  thumbnailUrl?: string | null;
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
  };
  timeline: {
    projectId: string;
    version: number;
    renderFingerprint: string;
    resolution: { width: number; height: number };
    clips: Array<{
      clipId: string;
      label: string;
      speed: number;
      mediaId?: string;
      sourceMediaId?: string;
      effects?: string[];
      timelineRange: { start: { value: number; rate: number }; duration: { value: number; rate: number } };
    }>;
    sourceMedia: Record<string, { mediaId: string; kind: string; uri?: string; width?: number; height?: number; license: string }>;
  };
  colorPlan: { targetSpace: string; ffmpegColorFilterChain: string; grades: Array<{ skinToneProtected: boolean }> };
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
  cinemaLoadProject?: (projectId: string) => Promise<{ pkg: EditorPackageView | null; lastRender: RealRenderResultView | null }>;
  cinemaUpdateTimeline?: (input: { projectId: string; clips: EditorClip[] }) => Promise<EditorPackageView>;
  cinemaExportOtio?: (projectId: string) => Promise<{ otioJson: string }>;
  cinemaRenderRealMp4?: (input: { projectId: string; useNvenc?: boolean }) => Promise<RealRenderResultView>;
  cinemaImportMedia?: (input?: { filePath?: string }) => Promise<ImportedAsset | null>;
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
  const [rendering, setRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<number | null>(null);
  const [exportingOtio, setExportingOtio] = useState(false);
  const [saving, setSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
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
        label: c.label,
        startSec: Number((c.timelineRange.start.value / c.timelineRange.start.rate).toFixed(2)),
        durationSec: Number((c.timelineRange.duration.value / c.timelineRange.duration.rate).toFixed(2)),
        speed: c.speed,
        sourceMediaId: mId,
        sourceUri: res.timeline.sourceMedia[mId]?.uri,
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
    if (!api) return;
    const requestedId = searchParams.get('projectId') ?? '__latest__';
    const init = async () => {
      await refreshProjects();
      const loadedOk = await loadProjectById(requestedId);
      if (loadedOk) return;
      if (api.cinemaProduce) {
        const res = await api.cinemaProduce({
          projectId: 'editor_session',
          prompt: 'Edição cinematográfica Aethera Studio',
          targetDurationSec: 36,
          humorIntensity: 35,
        });
        setPkg(res);
        const mapped = mapClipsFromPkg(res);
        setClips(mapped);
        setSelectedClipId(mapped[0]?.clipId ?? '');
        await refreshProjects();
      }
    };
    void init();
  }, [loadProjectById, mapClipsFromPkg, refreshProjects, searchParams]);

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

  // Synced live canvas preview when in timeline preview mode
  useEffect(() => {
    if (previewMode !== 'timeline') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    const clip = activeClipAtPlayhead;
    const t = playheadSec;

    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#1a1033');
    grad.addColorStop(0.5 + 0.15 * Math.sin(t * 1.1), '#2a164c');
    grad.addColorStop(1, '#0d1424');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Animated motion bar
    const barX = ((t * 160) % (w - 180));
    ctx.fillStyle = 'rgba(139, 92, 246, 0.85)';
    ctx.fillRect(barX, 64, 160, 5);

    // Vignette
    const vig = ctx.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.7);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, w, h);

    // Safe-zone lower third
    ctx.fillStyle = 'rgba(9, 9, 16, 0.82)';
    ctx.fillRect(48, h - 108, w - 96, 76);
    ctx.strokeStyle = 'rgba(245, 158, 11, 0.45)';
    ctx.strokeRect(48, h - 108, w - 96, 76);

    ctx.fillStyle = '#ffffff';
    ctx.font = '600 22px Inter, Segoe UI, sans-serif';
    ctx.fillText(clip ? clip.label : 'Aethera Studio Timeline', 66, h - 72);

    ctx.fillStyle = '#f59e0b';
    ctx.font = '13px monospace';
    ctx.fillText(
      clip
        ? `${clip.clipId} · ${clip.speed}x · ${formatTimecode(playheadSec)} / ${formatTimecode(totalDurationSec)}`
        : formatTimecode(playheadSec),
      66,
      h - 48,
    );
  }, [activeClipAtPlayhead, playheadSec, previewMode, totalDurationSec]);

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
      if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
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

  const waveformBars = renderedMedia?.waveformPeaks?.length
    ? renderedMedia.waveformPeaks
    : importedAssets.find((a) => a.waveformPeaks.length > 0)?.waveformPeaks ??
      Array.from({ length: 48 }, (_, i) => Number((0.18 + 0.55 * Math.abs(Math.sin(i * 0.45))).toFixed(2)));

  const timelineWidthPx = Math.max(680, Math.ceil((totalDurationSec + 2) * pxPerSec));
  const ticks = Array.from({ length: Math.ceil(totalDurationSec) + 2 }, (_, s) => s).filter(
    (s) => s % (pxPerSec < 18 ? 5 : 2) === 0,
  );

  return (
    <div
      className="flex h-full flex-col gap-3 p-4 xl:p-5"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files?.[0] as (File & { path?: string }) | undefined;
        if (file?.path) void handleImportMedia(file.path);
      }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card px-4 py-2.5">
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

      {statusMsg && (
        <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-300">
          {statusMsg}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-12">
        {/* Left: Media & Assets Bin */}
        <aside className="flex flex-col rounded-2xl border border-border bg-card p-3 lg:col-span-3 space-y-3">
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

          <div className="flex-1 space-y-2 text-xs max-h-64 overflow-y-auto pr-1">
            {leftTab === 'media' && (
              <>
                {importedAssets.map((asset) => (
                  <div key={asset.mediaId} className="rounded-xl border border-amber-500/40 bg-[#0d0d17] p-2 space-y-1.5">
                    <div className="flex items-center gap-2">
                      {asset.thumbnailUrl && (
                        <img src={asset.thumbnailUrl} alt={asset.name} className="h-9 w-16 rounded object-cover" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium text-foreground">{asset.name}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {asset.kind} · {asset.durationSec}s · {asset.width}x{asset.height}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleAddAssetToTimeline(asset)}
                      className="inline-flex w-full items-center justify-center gap-1 rounded-lg bg-primary/25 py-1 text-[11px] font-medium text-purple-200 hover:bg-primary/40"
                    >
                      <Plus className="size-3" /> Inserir na Timeline
                    </button>
                  </div>
                ))}
                {Object.values(pkg?.timeline.sourceMedia ?? {}).map((m) => (
                  <div key={m.mediaId} className="rounded-xl border border-border/80 bg-[#0d0d17] p-2.5">
                    <p className="truncate font-medium text-foreground">{m.mediaId}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {m.kind} · {m.width}x{m.height} · {m.license}
                    </p>
                  </div>
                ))}
              </>
            )}
            {leftTab === 'sfx' &&
              (pkg?.soundPlan.sfxEvents ?? []).map((ev) => (
                <div key={ev.cueId} className="rounded-xl border border-border/80 bg-[#0d0d17] p-2">
                  <p className="font-medium text-foreground">{ev.sfxName}</p>
                  <p className="text-[10px] text-muted-foreground">{ev.timeSeconds}s · {ev.reason}</p>
                </div>
              ))}
            {leftTab !== 'media' && leftTab !== 'sfx' && (
              <p className="rounded-xl border border-dashed border-border p-3 text-[11px] text-muted-foreground">
                Arraste arquivos de vídeo, imagem ou áudio para esta janela para importar com thumbnail e waveform reais.
              </p>
            )}
          </div>
        </aside>

        {/* Center: Real Preview Stage (Live Canvas OR Rendered MP4 Video) */}
        <section className="flex flex-col rounded-2xl border border-border bg-[#090910] p-3 lg:col-span-6 space-y-2.5">
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
            <span className="font-mono text-amber-300">{formatTimecode(playheadSec)}</span>
          </div>

          <div className="relative aspect-video overflow-hidden rounded-xl border border-border/70 bg-black">
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

        {/* Right: Inspector */}
        <aside className="min-w-0 overflow-hidden rounded-2xl border border-border bg-card p-3 lg:col-span-3 space-y-3">
          <div className="flex gap-1 text-[11px]">
            {(
              [
                ['transform', 'Propriedades'],
                ['color', 'Cor'],
                ['audio', 'Áudio'],
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

          {inspectorTab === 'transform' && (
            <div className="space-y-2 text-xs">
              <p className="font-semibold text-foreground">Clipe: {selectedClip?.label ?? '—'}</p>
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
            </div>
          )}

          {inspectorTab === 'color' && pkg && (
            <div className="min-w-0 space-y-2 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <p className="font-semibold text-foreground">Target: {pkg.colorPlan.targetSpace}</p>
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
                rows={colorExpanded ? 6 : 3}
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
                {savingColor ? 'Salvando cor...' : 'Aplicar Filtro de Cor'}
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
        </aside>
      </div>

      {/* Bottom: Interactive Multi-track NLE Timeline + Collapsible AI Assistant */}
      <div className="grid gap-3 lg:grid-cols-12">
        <section className={`rounded-2xl border border-border bg-card p-3 space-y-2.5 ${assistantOpen ? 'lg:col-span-9' : 'lg:col-span-12'}`}>
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

          <div className="overflow-x-auto pb-1">
            <div className="flex gap-2" style={{ minWidth: timelineWidthPx + 152 }}>
              {/* Track headers */}
              <div className="w-36 shrink-0 space-y-1.5 pt-7 text-[11px]">
                {[
                  { id: 'vfx1', label: 'V3 Gráficos', icon: Type },
                  { id: 'v1', label: 'V1 Vídeo Principal', icon: Layers },
                  { id: 'a_nar', label: 'A1 Narração', icon: Volume2 },
                  { id: 'a_mus', label: 'A2 Música', icon: Music },
                  { id: 'a_sfx', label: 'A3 SFX', icon: Sliders },
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

                {/* V1 Main Video Track (Draggable + Thumbnails) */}
                <div className="relative h-10 rounded-lg bg-[#090910]" style={{ width: timelineWidthPx }}>
                  {clips.map((clip) => {
                    const widthPx = Math.max(44, (clip.durationSec / Math.max(0.25, clip.speed)) * pxPerSec - 2);
                    return (
                      <div
                        key={clip.clipId}
                        role="button"
                        tabIndex={0}
                        onPointerDown={(e) => {
                          setSelectedClipId(clip.clipId);
                          dragClipRef.current = {
                            clipId: clip.clipId,
                            startX: e.clientX,
                            initialStartSec: clip.startSec,
                          };
                        }}
                        className={`absolute top-1 bottom-1 flex cursor-grab items-center gap-1.5 overflow-hidden rounded-md border px-2 text-left text-[11px] font-medium active:cursor-grabbing ${
                          clip.clipId === selectedClipId
                            ? 'border-amber-400 bg-amber-500/20 text-foreground'
                            : 'border-violet-400/50 bg-violet-600/25 text-foreground/90'
                        }`}
                        style={{ left: clip.startSec * pxPerSec, width: widthPx }}
                      >
                        {clip.thumbnailUrl && (
                          <img src={clip.thumbnailUrl} alt="" className="h-6 w-10 shrink-0 rounded object-cover" />
                        )}
                        <span className="truncate">{clip.label}</span>
                        <span className="ml-auto shrink-0 font-mono text-[9px] text-muted-foreground">{clip.durationSec}s</span>
                      </div>
                    );
                  })}
                </div>

                {/* A1 Narration Waveform */}
                {(() => {
                  const nar = pkg?.soundPlan.stems.find((s) => s.stemRole === 'voiceover');
                  const mus = pkg?.soundPlan.stems.find((s) => s.stemRole === 'music');
                  const narScale = nar?.muted ? 0.08 : Math.min(1.4, Math.max(0.2, Math.pow(10, (nar?.targetGainDb ?? 0) / 20)));
                  const musScale = mus?.muted ? 0.08 : Math.min(1.4, Math.max(0.15, Math.pow(10, ((mus?.targetGainDb ?? -16) + 16) / 20)));
                  return (
                    <>
                      <div className={`relative flex h-10 items-center rounded-lg border border-emerald-500/25 bg-[#090910] px-1 ${nar?.muted ? 'opacity-40' : ''}`} style={{ width: timelineWidthPx }}>
                        <span className="pointer-events-none absolute right-2 top-0.5 z-10 font-mono text-[9px] text-emerald-300">
                          {nar?.muted ? 'MUTE' : `${nar?.targetGainDb ?? 0} dB`}
                        </span>
                        <div className="flex h-7 w-full items-center gap-[2px]">
                          {waveformBars.map((amp, idx) => (
                            <div
                              key={idx}
                              className="flex-1 rounded-full bg-emerald-400/70"
                              style={{ height: `${Math.min(100, Math.round(amp * 100 * narScale))}%` }}
                            />
                          ))}
                        </div>
                      </div>

                      {/* A2 Music Waveform */}
                      <div className={`relative flex h-10 items-center rounded-lg border border-sky-500/25 bg-[#090910] px-1 ${mus?.muted ? 'opacity-40' : ''}`} style={{ width: timelineWidthPx }}>
                        <span className="pointer-events-none absolute right-2 top-0.5 z-10 font-mono text-[9px] text-sky-300">
                          {mus?.muted ? 'MUTE' : `${mus?.targetGainDb ?? -16} dB`}
                        </span>
                        <div className="flex h-6 w-full items-center gap-[3px]">
                          {waveformBars.map((amp, idx) => (
                            <div
                              key={idx}
                              className="flex-1 rounded-full bg-sky-400/55"
                              style={{ height: `${Math.min(100, Math.max(12, Math.round(amp * 75 * musScale)))}%` }}
                            />
                          ))}
                        </div>
                      </div>
                    </>
                  );
                })()}

                {/* A3 SFX Cues */}
                <div className="relative h-10 rounded-lg bg-[#090910]" style={{ width: timelineWidthPx }}>
                  {(pkg?.soundPlan.sfxEvents ?? []).map((ev) => (
                    <div
                      key={ev.cueId}
                      className="absolute top-2 bottom-2 rounded border border-amber-400/60 bg-amber-500/25 px-1.5 py-0.5 text-[10px] text-amber-200"
                      style={{ left: ev.timeSeconds * pxPerSec }}
                    >
                      {ev.sfxName}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {assistantOpen && (
          <aside className="rounded-2xl border border-primary/30 bg-card p-3 lg:col-span-3 space-y-3">
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
        )}
      </div>
    </div>
  );
}
