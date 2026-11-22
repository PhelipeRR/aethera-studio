import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Player, type PlayerRef } from '@remotion/player';
import {
  Bookmark,
  Check,
  Copy,
  Eye,
  Film,
  Image as ImageIcon,
  Layers,
  Loader2,
  Music,
  Palette,
  Pause,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Shield,
  Sliders,
  Sparkles,
  Star,
  Trash2,
  Upload,
} from 'lucide-react';
import {
  OutroStudioComposition,
  type OutroCompositionLogoTransform,
  type OutroCompositionPalette,
  type OutroCompositionTexts,
} from './outro-studio/OutroStudioComposition';

export type OutroAnimationStyle = 'energetic' | 'cinematic' | 'minimal';
export type OutroAspectRatio = '16:9' | '9:16';
export type OutroTemplateId = 'fire_reveal' | 'electric_reveal' | 'particle_reveal' | 'glitch_reveal';
export type PaletteSource = 'channel' | 'image' | 'custom';
export type LogoSelectionMode = 'manual' | 'default' | 'rotate_favorites';

/** Backward-compatible view exposed to RecapProductionPanel & AetheraStudioEditor timelines. */
export interface VideoOutroConfigView {
  enabled: boolean;
  backgroundImagePath: string | null;
  backgroundImageName?: string | null;
  channelName: string;
  style: OutroAnimationStyle;
  durationSec: number;
  showSubscribeCta: boolean;
  parallaxEnabled: boolean;
  showNextVideoCard: boolean;
  nextVideoTitle?: string;
  aspectRatio: OutroAspectRatio;
  lastPreviewMp4Path?: string | null;
  lastRenderedAtIso?: string | null;
  saveAsChannelDefault?: boolean;
  // Studio 3.0 extensions
  templateId?: string;
  selectedLogoId?: string | null;
  selectedLogoVersion?: number | null;
}

interface OutroStudioConfigV3View {
  schemaVersion: 3;
  enabled: boolean;
  templateId: string;
  templateVersion: string;
  channelId: string;
  channelName: string;
  aspectRatio: OutroAspectRatio;
  durationMs: number;
  paletteSource: PaletteSource;
  palette: OutroCompositionPalette;
  logoSelectionMode: LogoSelectionMode;
  logoDisabled: boolean;
  selectedLogoId: string | null;
  selectedLogoVersion: number | null;
  selectedLogoHash: string | null;
  logoTransform: OutroCompositionLogoTransform;
  backgroundImagePath: string | null;
  backgroundImageName?: string | null;
  parallaxEnabled: boolean;
  showSubscribeCta: boolean;
  showNextVideoCard: boolean;
  intensity: number;
  texts: OutroCompositionTexts;
  audio: {
    enabled: boolean;
    musicPath: string | null;
    musicVolume: number;
    introSfxVolume: number;
    whooshVolume: number;
    impactVolume: number;
    subscribeSfxVolume: number;
    fadeInSec: number;
    fadeOutSec: number;
  };
  presetId?: string | null;
  lastRenderCacheKey?: string | null;
  lastPreviewMp4Path?: string | null;
  lastRenderedAtIso?: string | null;
}

interface ChannelLogoView {
  logoId: string;
  channelId: string;
  name: string;
  assetId: string;
  assetVersion: number;
  contentHash: string;
  mimeType: string;
  width: number;
  height: number;
  originalPath: string;
  previewPath: string;
  isDefault: boolean;
  isFavorite: boolean;
}

interface OutroPresetView {
  presetId: string;
  channelId: string;
  name: string;
  description?: string;
  config: OutroStudioConfigV3View;
}

interface LibraryImageItem {
  id: string;
  name: string;
  path: string;
  source: string;
}

interface OutroStudioBridge {
  cinemaOutroV3GetConfig?: (input: { projectId: string; channelId?: string | null; channelName?: string | null }) => Promise<{ ok: boolean; config: OutroStudioConfigV3View }>;
  cinemaOutroV3SaveConfig?: (input: { projectId: string; config: Partial<OutroStudioConfigV3View> }) => Promise<{ ok: boolean; config: OutroStudioConfigV3View }>;
  cinemaOutroV3ExtractPalette?: (input: { imagePath: string }) => Promise<{ ok: boolean; palette?: OutroCompositionPalette; message?: string }>;
  cinemaOutroV3PickMusic?: () => Promise<{ canceled: boolean; path: string | null; name: string | null }>;
  cinemaOutroV3Render?: (input: { projectId: string; config: Partial<OutroStudioConfigV3View>; quality?: 'preview' | 'master' }) => Promise<{
    ok: boolean;
    message?: string;
    config?: OutroStudioConfigV3View;
    result?: { outputMp4Path: string; cacheHit: boolean; durationSec: number; width: number; height: number; templateId: string; sfxApplied: string[] };
  }>;
  cinemaOutroPickImage?: () => Promise<{ canceled: boolean; path: string | null; name: string | null }>;
  cinemaOutroListLibraryImages?: () => Promise<{ ok: boolean; images: LibraryImageItem[] }>;
  cinemaOutroLogoList?: (input?: { channelId?: string }) => Promise<{ ok: boolean; logos: ChannelLogoView[] }>;
  cinemaOutroLogoAdd?: (input: { channelId: string; name?: string }) => Promise<{ ok: boolean; canceled?: boolean; logo?: ChannelLogoView; message?: string }>;
  cinemaOutroLogoRename?: (input: { logoId: string; name: string }) => Promise<{ ok: boolean; logo?: ChannelLogoView }>;
  cinemaOutroLogoToggleFavorite?: (input: { logoId: string }) => Promise<{ ok: boolean; logo?: ChannelLogoView }>;
  cinemaOutroLogoSetDefault?: (input: { logoId: string }) => Promise<{ ok: boolean; logo?: ChannelLogoView }>;
  cinemaOutroLogoReplace?: (input: { logoId: string }) => Promise<{ ok: boolean; canceled?: boolean; logo?: ChannelLogoView; message?: string }>;
  cinemaOutroLogoDelete?: (input: { logoId: string }) => Promise<{ ok: boolean; deleted: boolean; softDeleted: boolean }>;
  cinemaOutroLogoResolve?: (input: { channelId: string; productionId: string; mode: LogoSelectionMode; manualLogoId?: string | null; manualLogoVersion?: number | null; logoDisabled?: boolean }) => Promise<{ ok: boolean; logo: ChannelLogoView | null; reason: string }>;
  cinemaOutroPresetList?: (input?: { channelId?: string }) => Promise<{ ok: boolean; presets: OutroPresetView[] }>;
  cinemaOutroPresetSave?: (input: { channelId?: string; name: string; config: OutroStudioConfigV3View }) => Promise<{ ok: boolean; preset?: OutroPresetView; message?: string }>;
  cinemaOutroPresetDuplicate?: (input: { presetId: string }) => Promise<{ ok: boolean; preset?: OutroPresetView }>;
  cinemaOutroPresetRename?: (input: { presetId: string; name: string }) => Promise<{ ok: boolean; preset?: OutroPresetView }>;
  cinemaOutroPresetDelete?: (input: { presetId: string }) => Promise<{ ok: boolean; deleted: boolean }>;
}

function getStudioBridge(): OutroStudioBridge | null {
  const w = window as unknown as {
    aetheraBridge?: OutroStudioBridge;
    aethera?: OutroStudioBridge;
    neuralbridge?: OutroStudioBridge;
  };
  return w.aetheraBridge ?? w.aethera ?? w.neuralbridge ?? null;
}

function toMediaUrl(filePath: string | null | undefined): string {
  if (!filePath) return '';
  if (/^(https?:|data:|blob:|aethera-media:)/i.test(filePath)) return filePath;
  return `aethera-media://file?path=${encodeURIComponent(filePath)}`;
}

const TEMPLATE_CARDS: Array<{
  id: OutroTemplateId;
  name: string;
  shortDesc: string;
  accent: string;
  secondary: string;
}> = [
  { id: 'fire_reveal', name: 'Fire Reveal', shortDesc: 'Chamas orgânicas e brasas revelando o emblema', accent: '#F97316', secondary: '#A855F7' },
  { id: 'electric_reveal', name: 'Electric Reveal', shortDesc: 'Arcos elétricos de alta tensão e pulso luminoso', accent: '#38BDF8', secondary: '#2563EB' },
  { id: 'particle_reveal', name: 'Particle Reveal', shortDesc: 'Partículas orbitais coalescendo no logotipo', accent: '#C084FC', secondary: '#6366F1' },
  { id: 'glitch_reveal', name: 'Glitch Reveal', shortDesc: 'Separação RGB, scanlines e travamento digital', accent: '#22D3EE', secondary: '#F43F5E' },
];

const DEFAULT_V3_CONFIG: OutroStudioConfigV3View = {
  schemaVersion: 3,
  enabled: true,
  templateId: 'fire_reveal',
  templateVersion: '3.0.0',
  channelId: 'default',
  channelName: '',
  aspectRatio: '16:9',
  durationMs: 15000,
  paletteSource: 'channel',
  palette: {
    primary: '#7C3AED',
    secondary: '#2563EB',
    energy: '#F97316',
    glow: '#F59E0B',
    particles: '#FDE047',
    text: '#FFFFFF',
    ctaBg: '#B6F500',
    ctaText: '#111111',
  },
  logoSelectionMode: 'manual',
  logoDisabled: false,
  selectedLogoId: null,
  selectedLogoVersion: null,
  selectedLogoHash: null,
  logoTransform: { scale: 1.0, offsetX: 0, offsetY: 0, glowIntensity: 65, revealIntensity: 70 },
  backgroundImagePath: null,
  backgroundImageName: null,
  parallaxEnabled: true,
  showSubscribeCta: true,
  showNextVideoCard: false,
  intensity: 55,
  texts: {
    preTitle: 'OBRIGADO POR ASSISTIR',
    channelTitle: '',
    subscribeCtaText: 'INSCREVA-SE NO CANAL',
    nextVideoLabel: 'PRÓXIMO VÍDEO',
    nextVideoTitle: '',
  },
  audio: {
    enabled: true,
    musicPath: null,
    musicVolume: 0.45,
    introSfxVolume: 0.7,
    whooshVolume: 0.75,
    impactVolume: 0.85,
    subscribeSfxVolume: 0.75,
    fadeInSec: 0.5,
    fadeOutSec: 0.8,
  },
};

function toLegacyConfigView(v3: OutroStudioConfigV3View): VideoOutroConfigView {
  return {
    enabled: v3.enabled,
    backgroundImagePath: v3.backgroundImagePath,
    backgroundImageName: v3.backgroundImageName ?? null,
    channelName: v3.texts.channelTitle || v3.channelName,
    style: v3.templateId === 'particle_reveal' ? 'cinematic' : v3.templateId === 'glitch_reveal' ? 'minimal' : 'energetic',
    durationSec: Math.round(v3.durationMs / 1000),
    showSubscribeCta: v3.showSubscribeCta,
    parallaxEnabled: v3.parallaxEnabled,
    showNextVideoCard: v3.showNextVideoCard,
    nextVideoTitle: v3.texts.nextVideoTitle,
    aspectRatio: v3.aspectRatio,
    lastPreviewMp4Path: v3.lastPreviewMp4Path ?? null,
    lastRenderedAtIso: v3.lastRenderedAtIso ?? null,
    templateId: v3.templateId,
    selectedLogoId: v3.selectedLogoId,
    selectedLogoVersion: v3.selectedLogoVersion,
  };
}

/** Lightweight animated thumbnail card that pauses off-screen and respects prefers-reduced-motion. */
function AnimatedTemplateCard({
  card,
  selected,
  reducedMotion,
  visible,
  onSelect,
}: {
  card: (typeof TEMPLATE_CARDS)[number];
  selected: boolean;
  reducedMotion: boolean;
  visible: boolean;
  onSelect: () => void;
}) {
  const animate = visible && !reducedMotion;
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{
        padding: 8,
        borderRadius: 14,
        border: `2px solid ${selected ? '#111111' : '#e4e4e7'}`,
        background: selected ? '#111111' : '#fafafa',
        color: selected ? '#ffffff' : '#111111',
        textAlign: 'left',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
      }}
    >
      <div
        style={{
          height: 58,
          borderRadius: 10,
          background: `radial-gradient(circle at 50% 60%, ${card.accent}55 0%, ${card.secondary}33 48%, #09090b 100%)`,
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: 26,
            height: 26,
            borderRadius: card.id === 'glitch_reveal' ? 6 : 999,
            border: `2px solid ${card.accent}`,
            boxShadow: `0 0 14px ${card.accent}`,
            animation: animate ? 'pulse 2.4s ease-in-out infinite' : undefined,
          }}
        />
        {selected && (
          <span
            style={{
              position: 'absolute',
              top: 5,
              right: 5,
              width: 18,
              height: 18,
              borderRadius: 999,
              background: '#b6f500',
              color: '#111111',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Check style={{ width: 11, height: 11 }} />
          </span>
        )}
      </div>
      <div style={{ fontSize: 12, fontWeight: 700 }}>{card.name}</div>
      <div style={{ fontSize: 10, color: selected ? '#d4d4d8' : '#71717a', lineHeight: 1.3 }}>
        {card.shortDesc}
      </div>
    </button>
  );
}

export interface MotionVelixOutroPanelProps {
  projectId: string;
  channelName?: string | null;
  aspectRatio?: OutroAspectRatio;
  compact?: boolean;
  onConfigChange?: (config: VideoOutroConfigView) => void;
}

export function MotionVelixOutroPanel({
  projectId,
  channelName,
  aspectRatio,
  compact = false,
  onConfigChange,
}: MotionVelixOutroPanelProps) {
  const sectionRef = useRef<HTMLElement | null>(null);
  const playerRef = useRef<PlayerRef | null>(null);
  const [inViewport, setInViewport] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  const [config, setConfig] = useState<OutroStudioConfigV3View>(() => ({
    ...DEFAULT_V3_CONFIG,
    channelId: (channelName?.trim() || 'default').toLowerCase().replace(/[^a-z0-9_-]+/g, '-'),
    channelName: channelName?.trim() || '',
    aspectRatio: aspectRatio ?? '16:9',
    texts: { ...DEFAULT_V3_CONFIG.texts, channelTitle: channelName?.trim() || '' },
  }));
  const [logos, setLogos] = useState<ChannelLogoView[]>([]);
  const [presets, setPresets] = useState<OutroPresetView[]>([]);
  const [libraryImages, setLibraryImages] = useState<LibraryImageItem[]>([]);
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);

  const [activeTab, setActiveTab] = useState<'logos' | 'colors' | 'text_audio' | 'presets'>('logos');
  const [showSafeGuides, setShowSafeGuides] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [rendering, setRendering] = useState(false);
  const [presetNameInput, setPresetNameInput] = useState('');
  const [statusMessage, setStatusMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [lastRenderInfo, setLastRenderInfo] = useState<{ outputMp4Path: string; cacheHit: boolean; durationSec: number; width: number; height: number; templateId: string; sfxApplied: string[] } | null>(null);

  const channelKey = useMemo(
    () => (config.channelId || channelName?.trim() || 'default').toLowerCase().replace(/[^a-z0-9_-]+/g, '-'),
    [config.channelId, channelName],
  );

  // Reduced-motion & off-screen observer (Fase 5)
  useEffect(() => {
    setReducedMotion(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entries) => setInViewport(Boolean(entries[0]?.isIntersecting)),
      { threshold: 0.05 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Load V3 config + Logo Library + Presets
  useEffect(() => {
    let alive = true;
    const loadAll = async () => {
      const bridge = getStudioBridge();
      if (!bridge?.cinemaOutroV3GetConfig) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const cfgRes = await bridge.cinemaOutroV3GetConfig({
          projectId: projectId || 'default',
          channelId: channelName?.trim() ? channelName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-') : null,
          channelName: channelName?.trim() || null,
        });
        if (!alive) return;
        const loaded = cfgRes.config;
        const effectiveChannelId = loaded.channelId || 'default';
        const merged: OutroStudioConfigV3View = {
          ...DEFAULT_V3_CONFIG,
          ...loaded,
          aspectRatio: aspectRatio ?? loaded.aspectRatio ?? '16:9',
        };
        setConfig(merged);
        onConfigChange?.(toLegacyConfigView(merged));

        const [logoRes, presetRes] = await Promise.all([
          bridge.cinemaOutroLogoList?.({ channelId: effectiveChannelId }),
          bridge.cinemaOutroPresetList?.({ channelId: effectiveChannelId }),
        ]);
        if (!alive) return;
        if (logoRes?.ok) setLogos(logoRes.logos);
        if (presetRes?.ok) setPresets(presetRes.presets);
      } finally {
        if (alive) setLoading(false);
      }
    };
    void loadAll();
    return () => {
      alive = false;
    };
  }, [projectId, channelName, aspectRatio]);

  const persistV3 = useCallback(
    async (next: OutroStudioConfigV3View, silent = true) => {
      setConfig(next);
      onConfigChange?.(toLegacyConfigView(next));
      const bridge = getStudioBridge();
      if (!bridge?.cinemaOutroV3SaveConfig) return;
      try {
        const res = await bridge.cinemaOutroV3SaveConfig({
          projectId: projectId || 'default',
          config: next as unknown as Record<string, unknown>,
        });
        if (res.ok && res.config) {
          setConfig(res.config);
          onConfigChange?.(toLegacyConfigView(res.config));
          if (!silent) setStatusMessage({ ok: true, text: 'Encerramento aplicado ao projeto.' });
        }
      } catch (err) {
        setStatusMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
      }
    },
    [projectId, onConfigChange],
  );

  const patchV3 = (patch: Partial<OutroStudioConfigV3View>, silent = true) => {
    void persistV3({ ...config, ...patch }, silent);
  };

  const activeLogoRecord = useMemo(() => {
    if (config.logoDisabled) return null;
    if (config.selectedLogoId) {
      const exact = logos.find((l) => l.logoId === config.selectedLogoId);
      if (exact) return exact;
    }
    return logos.find((l) => l.isDefault) ?? logos[0] ?? null;
  }, [config.logoDisabled, config.selectedLogoId, logos]);

  const refreshLogos = async () => {
    const bridge = getStudioBridge();
    const res = await bridge?.cinemaOutroLogoList?.({ channelId: channelKey });
    if (res?.ok) setLogos(res.logos);
  };

  const refreshPresets = async () => {
    const bridge = getStudioBridge();
    const res = await bridge?.cinemaOutroPresetList?.({ channelId: channelKey });
    if (res?.ok) setPresets(res.presets);
  };

  const handleAddLogo = async () => {
    const bridge = getStudioBridge();
    const res = await bridge?.cinemaOutroLogoAdd?.({ channelId: channelKey });
    if (res?.ok && res.logo) {
      await refreshLogos();
      patchV3(
        {
          logoDisabled: false,
          logoSelectionMode: 'manual',
          selectedLogoId: res.logo.logoId,
          selectedLogoVersion: res.logo.assetVersion,
          selectedLogoHash: res.logo.contentHash,
        },
        false,
      );
    } else if (res && !res.canceled && res.message) {
      setStatusMessage({ ok: false, text: res.message });
    }
  };

  const handleLogoModeChange = async (mode: LogoSelectionMode) => {
    const bridge = getStudioBridge();
    if (bridge?.cinemaOutroLogoResolve) {
      const resolved = await bridge.cinemaOutroLogoResolve({
        channelId: channelKey,
        productionId: projectId || 'default',
        mode,
        manualLogoId: config.selectedLogoId,
        manualLogoVersion: config.selectedLogoVersion,
        logoDisabled: config.logoDisabled,
      });
      patchV3(
        {
          logoSelectionMode: mode,
          selectedLogoId: resolved.logo?.logoId ?? config.selectedLogoId,
          selectedLogoVersion: resolved.logo?.assetVersion ?? config.selectedLogoVersion,
          selectedLogoHash: resolved.logo?.contentHash ?? config.selectedLogoHash,
        },
        false,
      );
      return;
    }
    patchV3({ logoSelectionMode: mode });
  };

  const handlePickBackground = async () => {
    const bridge = getStudioBridge();
    const res = await bridge?.cinemaOutroPickImage?.();
    if (res && !res.canceled && res.path) {
      patchV3({ backgroundImagePath: res.path, backgroundImageName: res.name }, false);
    }
  };

  const handleExtractImagePalette = async () => {
    const bridge = getStudioBridge();
    if (!config.backgroundImagePath || !bridge?.cinemaOutroV3ExtractPalette) {
      setStatusMessage({ ok: false, text: 'Selecione uma imagem de fundo antes de extrair a paleta.' });
      return;
    }
    const res = await bridge.cinemaOutroV3ExtractPalette({ imagePath: config.backgroundImagePath });
    if (res.ok && res.palette) {
      patchV3({ paletteSource: 'image', palette: res.palette }, false);
    } else {
      setStatusMessage({ ok: false, text: res.message || 'Falha ao extrair cores da imagem.' });
    }
  };

  const handleRenderMp4 = async () => {
    const bridge = getStudioBridge();
    if (!bridge?.cinemaOutroV3Render) return;
    setRendering(true);
    setStatusMessage(null);
    try {
      const res = await bridge.cinemaOutroV3Render({
        projectId: projectId || 'default',
        config: { ...config, enabled: true } as unknown as Record<string, unknown>,
        quality: 'preview',
      });
      if (res.ok && res.result) {
        setLastRenderInfo(res.result);
        if (res.config) {
          setConfig(res.config);
          onConfigChange?.(toLegacyConfigView(res.config));
        }
        setStatusMessage({ ok: true, text: res.message || 'Encerramento renderizado com sucesso.' });
      } else {
        setStatusMessage({ ok: false, text: res.message || 'Falha ao renderizar o encerramento.' });
      }
    } finally {
      setRendering(false);
    }
  };

  const handleSavePreset = async () => {
    const bridge = getStudioBridge();
    if (!bridge?.cinemaOutroPresetSave) return;
    const name = presetNameInput.trim() || `${config.channelName || 'Meu Canal'} — ${config.templateId}`;
    const res = await bridge.cinemaOutroPresetSave({
      channelId: channelKey,
      name,
      config,
    });
    if (res.ok) {
      setPresetNameInput('');
      await refreshPresets();
      setStatusMessage({ ok: true, text: `Modelo "${name}" salvo nos presets.` });
    }
  };

  const durationInFrames = Math.max(150, Math.round((config.durationMs / 1000) * 30));
  const compWidth = config.aspectRatio === '9:16' ? 720 : 1280;
  const compHeight = config.aspectRatio === '9:16' ? 1280 : 720;

  return (
    <section
      ref={sectionRef}
      aria-label="MotionVelix Outro Studio 3.0"
      style={{
        background: '#ffffff',
        border: '1px solid #e4e4e7',
        borderRadius: 20,
        padding: compact ? 14 : 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 12,
              background: config.enabled ? '#111111' : '#f4f4f5',
              color: config.enabled ? '#b6f500' : '#71717a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Film style={{ width: 18, height: 18 }} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111111' }}>
                Encerramento do vídeo
              </h3>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  padding: '2px 8px',
                  borderRadius: 999,
                  background: '#ecfccb',
                  color: '#3f6212',
                  border: '1px solid #bef264',
                }}
              >
                MotionVelix 3.0
              </span>
            </div>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#52525b' }}>
              Galeria de templates animados com prévia real Remotion, biblioteca de logotipos e cache inteligente.
            </p>
          </div>
        </div>

        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '7px 14px',
            borderRadius: 999,
            border: `1px solid ${config.enabled ? '#111111' : '#d4d4d8'}`,
            background: config.enabled ? '#111111' : '#fafafa',
            color: config.enabled ? '#ffffff' : '#27272a',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={config.enabled}
            disabled={loading}
            onChange={(e) => patchV3({ enabled: e.target.checked }, false)}
            style={{ accentColor: '#b6f500', width: 15, height: 15 }}
          />
          Ativar encerramento
        </label>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, opacity: config.enabled ? 1 : 0.5, pointerEvents: config.enabled ? 'auto' : 'none' }}>
        {/* 1. Galeria de Templates Animados (4 cards) */}
        <div style={{ display: 'grid', gridTemplateColumns: compact ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 8 }}>
          {TEMPLATE_CARDS.map((card) => (
            <AnimatedTemplateCard
              key={card.id}
              card={card}
              selected={config.templateId === card.id}
              reducedMotion={reducedMotion}
              visible={inViewport}
              onSelect={() => patchV3({ templateId: card.id })}
            />
          ))}
        </div>

        {/* 2. Preview Principal em Tempo Quase Real (@remotion/player) */}
        <div style={{ borderRadius: 16, border: '1px solid #e4e4e7', background: '#09090b', overflow: 'hidden' }}>
          <div
            style={{
              maxWidth: config.aspectRatio === '9:16' ? 280 : '100%',
              margin: '0 auto',
            }}
          >
            <Player
              ref={playerRef}
              component={OutroStudioComposition}
              inputProps={{
                templateId: config.templateId,
                aspectRatio: config.aspectRatio,
                palette: config.palette,
                intensity: config.intensity,
                parallaxEnabled: config.parallaxEnabled,
                backgroundImageUrl: config.backgroundImagePath ? toMediaUrl(config.backgroundImagePath) : null,
                logoImageUrl: activeLogoRecord ? toMediaUrl(activeLogoRecord.previewPath || activeLogoRecord.originalPath) : null,
                logoDisabled: config.logoDisabled,
                logoTransform: config.logoTransform,
                texts: {
                  ...config.texts,
                  channelTitle: config.texts.channelTitle || config.channelName || 'Seu Canal',
                },
                showSubscribeCta: config.showSubscribeCta,
                showNextVideoCard: config.showNextVideoCard,
                showSafeAreaGuides: showSafeGuides,
                reducedMotion,
              }}
              durationInFrames={durationInFrames}
              fps={30}
              compositionWidth={compWidth}
              compositionHeight={compHeight}
              controls
              loop
              style={{ width: '100%' }}
            />
          </div>

          {/* Controles rápidos do Preview */}
          <div
            style={{
              padding: '8px 12px',
              background: '#18181b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 8,
              flexWrap: 'wrap',
              fontSize: 11,
              color: '#e4e4e7',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <button
                type="button"
                onClick={() => {
                  if (isPlaying) {
                    playerRef.current?.pause();
                    setIsPlaying(false);
                  } else {
                    playerRef.current?.play();
                    setIsPlaying(true);
                  }
                }}
                style={{ padding: '4px 10px', borderRadius: 999, border: '1px solid #3f3f46', background: '#27272a', color: '#fff', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
              >
                {isPlaying ? <Pause style={{ width: 11, height: 11 }} /> : <Play style={{ width: 11, height: 11 }} />}
                {isPlaying ? 'Pausar' : 'Reproduzir'}
              </button>
              <button
                type="button"
                onClick={() => {
                  playerRef.current?.seekTo(0);
                  playerRef.current?.play();
                  setIsPlaying(true);
                }}
                style={{ padding: '4px 10px', borderRadius: 999, border: '1px solid #3f3f46', background: '#27272a', color: '#fff', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
              >
                <RotateCcw style={{ width: 11, height: 11 }} />
                Reiniciar
              </button>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {(['16:9', '9:16'] as const).map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => patchV3({ aspectRatio: ratio })}
                  style={{
                    padding: '4px 9px',
                    borderRadius: 999,
                    border: 'none',
                    background: config.aspectRatio === ratio ? '#b6f500' : '#27272a',
                    color: config.aspectRatio === ratio ? '#111111' : '#d4d4d8',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {ratio}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowSafeGuides((v) => !v)}
                style={{
                  padding: '4px 9px',
                  borderRadius: 999,
                  border: '1px solid #3f3f46',
                  background: showSafeGuides ? '#365314' : '#27272a',
                  color: showSafeGuides ? '#bef264' : '#d4d4d8',
                  fontSize: 11,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  cursor: 'pointer',
                }}
              >
                <Shield style={{ width: 11, height: 11 }} />
                Área segura
              </button>
            </div>
          </div>
        </div>

        {/* 3. Abas de Personalização (evita sobrecarga visual) */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderBottom: '1px solid #e4e4e7', paddingBottom: 8 }}>
          {(
            [
              ['logos', 'Logotipos', ImageIcon],
              ['colors', 'Cores & Fundo', Palette],
              ['text_audio', 'Textos, Duração & Áudio', Sliders],
              ['presets', 'Meus Modelos', Bookmark],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveTab(id)}
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                border: 'none',
                background: activeTab === id ? '#111111' : '#f4f4f5',
                color: activeTab === id ? '#ffffff' : '#3f3f46',
                fontSize: 12,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
              }}
            >
              <Icon style={{ width: 13, height: 13 }} />
              {label}
            </button>
          ))}
        </div>

        {/* ABA: LOGOTIPOS (Fase 13) */}
        {activeTab === 'logos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {(['manual', 'default', 'rotate_favorites'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => void handleLogoModeChange(m)}
                    style={{
                      padding: '5px 10px',
                      borderRadius: 999,
                      border: `1px solid ${config.logoSelectionMode === m ? '#111111' : '#d4d4d8'}`,
                      background: config.logoSelectionMode === m ? '#111111' : '#ffffff',
                      color: config.logoSelectionMode === m ? '#ffffff' : '#3f3f46',
                      fontSize: 11,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {m === 'manual' ? 'Manual (por vídeo)' : m === 'default' ? 'Padrão do canal' : 'Rotacionar favoritas'}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#52525b', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={config.logoDisabled}
                    onChange={(e) => patchV3({ logoDisabled: e.target.checked })}
                  />
                  Sem logo
                </label>
                <button
                  type="button"
                  onClick={() => void handleAddLogo()}
                  style={{ padding: '6px 12px', borderRadius: 999, border: 'none', background: '#111111', color: '#fff', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}
                >
                  <Plus style={{ width: 12, height: 12, color: '#b6f500' }} />
                  Adicionar logo
                </button>
              </div>
            </div>

            {logos.length === 0 ? (
              <div style={{ padding: 14, borderRadius: 12, border: '1px dashed #d4d4d8', background: '#fafafa', fontSize: 12, color: '#71717a', textAlign: 'center' }}>
                Nenhum logotipo cadastrado para este canal. Adicione arquivos PNG, WebP ou SVG sanitizado.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
                {logos.map((logo) => {
                  const isSel = !config.logoDisabled && activeLogoRecord?.logoId === logo.logoId;
                  return (
                    <div
                      key={logo.logoId}
                      style={{
                        padding: 8,
                        borderRadius: 12,
                        border: `1.5px solid ${isSel ? '#111111' : '#e4e4e7'}`,
                        background: isSel ? '#f4f4f5' : '#ffffff',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                      }}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          patchV3({
                            logoDisabled: false,
                            logoSelectionMode: 'manual',
                            selectedLogoId: logo.logoId,
                            selectedLogoVersion: logo.assetVersion,
                            selectedLogoHash: logo.contentHash,
                          })
                        }
                        style={{ border: 'none', background: '#09090b', borderRadius: 8, height: 64, padding: 6, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                      >
                        <img
                          src={toMediaUrl(logo.previewPath || logo.originalPath)}
                          alt={logo.name}
                          style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                        />
                      </button>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#111111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {logo.name} <span style={{ fontWeight: 400, color: '#71717a' }}>v{logo.assetVersion}</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button
                          type="button"
                          title="Favoritar"
                          onClick={async () => {
                            await getStudioBridge()?.cinemaOutroLogoToggleFavorite?.({ logoId: logo.logoId });
                            await refreshLogos();
                          }}
                          style={{ padding: 4, borderRadius: 6, border: '1px solid #e4e4e7', background: logo.isFavorite ? '#fef9c3' : '#fff', cursor: 'pointer' }}
                        >
                          <Star style={{ width: 11, height: 11, color: logo.isFavorite ? '#ca8a04' : '#71717a' }} />
                        </button>
                        <button
                          type="button"
                          title="Definir padrão do canal"
                          onClick={async () => {
                            await getStudioBridge()?.cinemaOutroLogoSetDefault?.({ logoId: logo.logoId });
                            await refreshLogos();
                          }}
                          style={{ padding: '2px 6px', borderRadius: 6, border: '1px solid #e4e4e7', background: logo.isDefault ? '#111111' : '#fff', color: logo.isDefault ? '#b6f500' : '#52525b', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                        >
                          {logo.isDefault ? 'Padrão' : 'Usar padrão'}
                        </button>
                        <button
                          type="button"
                          title="Substituir arquivo (nova versão)"
                          onClick={async () => {
                            await getStudioBridge()?.cinemaOutroLogoReplace?.({ logoId: logo.logoId });
                            await refreshLogos();
                          }}
                          style={{ padding: 4, borderRadius: 6, border: '1px solid #e4e4e7', background: '#fff', cursor: 'pointer' }}
                        >
                          <RefreshCw style={{ width: 11, height: 11, color: '#52525b' }} />
                        </button>
                        <button
                          type="button"
                          title="Excluir logotipo"
                          onClick={async () => {
                            await getStudioBridge()?.cinemaOutroLogoDelete?.({ logoId: logo.logoId });
                            await refreshLogos();
                          }}
                          style={{ padding: 4, borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', cursor: 'pointer', marginLeft: 'auto' }}
                        >
                          <Trash2 style={{ width: 11, height: 11, color: '#b91c1c' }} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Posicionamento, Tamanho & Glow da Logo (Fase 13.7) */}
            {!config.logoDisabled && (
              <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(3, 1fr)', gap: 10, padding: 10, borderRadius: 12, background: '#fafafa', border: '1px solid #e4e4e7' }}>
                <label style={{ fontSize: 11, color: '#3f3f46', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  Tamanho ({Math.round(config.logoTransform.scale * 100)}%)
                  <input
                    type="range"
                    min={0.5}
                    max={1.8}
                    step={0.05}
                    value={config.logoTransform.scale}
                    onChange={(e) => patchV3({ logoTransform: { ...config.logoTransform, scale: Number(e.target.value) } })}
                  />
                </label>
                <label style={{ fontSize: 11, color: '#3f3f46', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  Brilho / Glow ({config.logoTransform.glowIntensity}%)
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={config.logoTransform.glowIntensity}
                    onChange={(e) => patchV3({ logoTransform: { ...config.logoTransform, glowIntensity: Number(e.target.value) } })}
                  />
                </label>
                <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                  <button
                    type="button"
                    onClick={() => patchV3({ logoTransform: { scale: 1.0, offsetX: 0, offsetY: 0, glowIntensity: 65, revealIntensity: 70 } })}
                    style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #d4d4d8', background: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Restaurar posição padrão
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ABA: CORES & FUNDO (Fase 6) */}
        {activeTab === 'colors' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {(['channel', 'image', 'custom'] as const).map((src) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => {
                    if (src === 'image') {
                      void handleExtractImagePalette();
                    } else {
                      patchV3({ paletteSource: src });
                    }
                  }}
                  style={{
                    padding: '5px 11px',
                    borderRadius: 999,
                    border: `1px solid ${config.paletteSource === src ? '#111111' : '#d4d4d8'}`,
                    background: config.paletteSource === src ? '#111111' : '#fff',
                    color: config.paletteSource === src ? '#fff' : '#3f3f46',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {src === 'channel' ? 'Cores do canal' : src === 'image' ? 'Extrair da imagem' : 'Personalizada'}
                </button>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(125px, 1fr))', gap: 8 }}>
              {(
                [
                  ['primary', 'Primária'],
                  ['secondary', 'Secundária'],
                  ['energy', 'Chamas / Energia'],
                  ['glow', 'Glow'],
                  ['particles', 'Partículas'],
                  ['text', 'Texto'],
                  ['ctaBg', 'Botão CTA'],
                  ['ctaText', 'Texto CTA'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 10, border: '1px solid #e4e4e7', fontSize: 11, color: '#27272a' }}>
                  <input
                    type="color"
                    value={config.palette[key]}
                    onChange={(e) =>
                      patchV3({
                        paletteSource: 'custom',
                        palette: { ...config.palette, [key]: e.target.value },
                      })
                    }
                    style={{ width: 24, height: 24, border: 'none', background: 'transparent', cursor: 'pointer' }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>

            {/* Imagem de fundo + Parallax */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: 10, borderRadius: 12, background: '#fafafa', border: '1px solid #e4e4e7' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => void handlePickBackground()}
                  style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid #d4d4d8', background: '#fff', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}
                >
                  <Upload style={{ width: 12, height: 12 }} />
                  {config.backgroundImagePath ? 'Trocar fundo' : 'Enviar fundo'}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    const next = !showLibraryPicker;
                    setShowLibraryPicker(next);
                    if (next) {
                      const res = await getStudioBridge()?.cinemaOutroListLibraryImages?.();
                      if (res?.ok) setLibraryImages(res.images);
                    }
                  }}
                  style={{ padding: '6px 12px', borderRadius: 999, border: '1px solid #d4d4d8', background: '#fff', fontSize: 11, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}
                >
                  <Layers style={{ width: 12, height: 12 }} />
                  Biblioteca
                </button>
              </div>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#27272a', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={config.parallaxEnabled}
                  onChange={(e) => patchV3({ parallaxEnabled: e.target.checked })}
                />
                Parallax ativo
              </label>
            </div>

            {showLibraryPicker && libraryImages.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))', gap: 6, maxHeight: 150, overflowY: 'auto' }}>
                {libraryImages.map((img) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => {
                      patchV3({ backgroundImagePath: img.path, backgroundImageName: img.name });
                      setShowLibraryPicker(false);
                    }}
                    style={{ padding: 3, borderRadius: 8, border: '1px solid #d4d4d8', background: '#fff', cursor: 'pointer' }}
                  >
                    <img src={toMediaUrl(img.path)} alt={img.name} style={{ width: '100%', height: 50, objectFit: 'cover', borderRadius: 5 }} />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ABA: TEXTOS, DURAÇÃO, INTENSIDADE & ÁUDIO (Fase 7) */}
        {activeTab === 'text_audio' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(2, 1fr)', gap: 10 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#27272a', display: 'flex', flexDirection: 'column', gap: 4 }}>
                Nome do canal
                <input
                  type="text"
                  value={config.texts.channelTitle || config.channelName}
                  onChange={(e) =>
                    patchV3({ channelName: e.target.value, texts: { ...config.texts, channelTitle: e.target.value } })
                  }
                  style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #d4d4d8', fontSize: 12 }}
                />
              </label>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#27272a', display: 'flex', flexDirection: 'column', gap: 4 }}>
                Texto de inscrição (CTA)
                <input
                  type="text"
                  value={config.texts.subscribeCtaText}
                  onChange={(e) => patchV3({ texts: { ...config.texts, subscribeCtaText: e.target.value } })}
                  style={{ padding: '8px 10px', borderRadius: 10, border: '1px solid #d4d4d8', fontSize: 12 }}
                />
              </label>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(2, 1fr)', gap: 12 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#27272a', display: 'flex', flexDirection: 'column', gap: 4 }}>
                Duração ({Math.round(config.durationMs / 1000)}s)
                <input
                  type="range"
                  min={5}
                  max={30}
                  step={1}
                  value={Math.round(config.durationMs / 1000)}
                  onChange={(e) => patchV3({ durationMs: Number(e.target.value) * 1000 })}
                />
              </label>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#27272a', display: 'flex', flexDirection: 'column', gap: 4 }}>
                Intensidade geral ({config.intensity}%)
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={config.intensity}
                  onChange={(e) => patchV3({ intensity: Number(e.target.value) })}
                />
              </label>
            </div>

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                <input type="checkbox" checked={config.showSubscribeCta} onChange={(e) => patchV3({ showSubscribeCta: e.target.checked })} />
                Chamada para inscrição
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                <input type="checkbox" checked={config.showNextVideoCard} onChange={(e) => patchV3({ showNextVideoCard: e.target.checked })} />
                Próximo vídeo
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                <input type="checkbox" checked={config.audio.enabled} onChange={(e) => patchV3({ audio: { ...config.audio, enabled: e.target.checked } })} />
                Música &amp; SFX MotionVelix
              </label>
            </div>

            {config.audio.enabled && (
              <div style={{ padding: 10, borderRadius: 12, background: '#fafafa', border: '1px solid #e4e4e7', display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#3f3f46', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                    <Music style={{ width: 12, height: 12 }} />
                    {config.audio.musicPath ? config.audio.musicPath.split(/[\\/]/).pop() : 'Sem trilha (usando apenas SFX reais do kit MotionVelix)'}
                  </span>
                  <button
                    type="button"
                    onClick={async () => {
                      const res = await getStudioBridge()?.cinemaOutroV3PickMusic?.();
                      if (res && !res.canceled && res.path) {
                        patchV3({ audio: { ...config.audio, musicPath: res.path } });
                      }
                    }}
                    style={{ padding: '4px 10px', borderRadius: 999, border: '1px solid #d4d4d8', background: '#fff', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                  >
                    Escolher música
                  </button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 8 }}>
                  {(
                    [
                      ['musicVolume', 'Música'],
                      ['introSfxVolume', 'Entrada'],
                      ['whooshVolume', 'Whoosh'],
                      ['impactVolume', 'Impacto'],
                      ['subscribeSfxVolume', 'Inscrição'],
                    ] as const
                  ).map(([k, lbl]) => (
                    <label key={k} style={{ fontSize: 10, color: '#52525b', display: 'flex', flexDirection: 'column', gap: 2 }}>
                      {lbl} ({Math.round(config.audio[k] * 100)}%)
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={config.audio[k]}
                        onChange={(e) => patchV3({ audio: { ...config.audio, [k]: Number(e.target.value) } })}
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ABA: PRESETS (Fase 13.6) */}
        {activeTab === 'presets' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                value={presetNameInput}
                onChange={(e) => setPresetNameInput(e.target.value)}
                placeholder="Nome do modelo (ex.: NextWorth Fire)"
                style={{ flex: 1, padding: '7px 10px', borderRadius: 10, border: '1px solid #d4d4d8', fontSize: 12 }}
              />
              <button
                type="button"
                onClick={() => void handleSavePreset()}
                style={{ padding: '7px 14px', borderRadius: 999, border: 'none', background: '#111111', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                Salvar como meu modelo
              </button>
            </div>
            {presets.length === 0 ? (
              <div style={{ fontSize: 12, color: '#71717a' }}>Nenhum modelo salvo ainda.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: 8 }}>
                {presets.map((p) => (
                  <div key={p.presetId} style={{ padding: 10, borderRadius: 12, border: '1px solid #e4e4e7', background: '#fafafa', display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#111111' }}>{p.name}</div>
                    <div style={{ fontSize: 10, color: '#71717a' }}>
                      {p.config.templateId} · {Math.round(p.config.durationMs / 1000)}s · {p.config.intensity}%
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button
                        type="button"
                        onClick={() => void persistV3({ ...p.config, presetId: p.presetId }, false)}
                        style={{ padding: '4px 9px', borderRadius: 999, border: 'none', background: '#111111', color: '#b6f500', fontSize: 10, fontWeight: 700, cursor: 'pointer' }}
                      >
                        Aplicar
                      </button>
                      <button
                        type="button"
                        title="Duplicar"
                        onClick={async () => {
                          await getStudioBridge()?.cinemaOutroPresetDuplicate?.({ presetId: p.presetId });
                          await refreshPresets();
                        }}
                        style={{ padding: 4, borderRadius: 6, border: '1px solid #d4d4d8', background: '#fff', cursor: 'pointer' }}
                      >
                        <Copy style={{ width: 11, height: 11 }} />
                      </button>
                      <button
                        type="button"
                        title="Excluir preset"
                        onClick={async () => {
                          await getStudioBridge()?.cinemaOutroPresetDelete?.({ presetId: p.presetId });
                          await refreshPresets();
                        }}
                        style={{ padding: 4, borderRadius: 6, border: '1px solid #fecaca', background: '#fef2f2', cursor: 'pointer', marginLeft: 'auto' }}
                      >
                        <Trash2 style={{ width: 11, height: 11, color: '#b91c1c' }} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Footer Actions: Salvar modelo / Renderizar MP4 / Aplicar ao vídeo */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', paddingTop: 4 }}>
          <button
            type="button"
            onClick={() => void handleSavePreset()}
            style={{ padding: '8px 14px', borderRadius: 999, border: '1px solid #d4d4d8', background: '#fff', color: '#111111', fontSize: 12, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
          >
            <Bookmark style={{ width: 13, height: 13 }} />
            Salvar como meu modelo
          </button>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              disabled={rendering}
              onClick={() => void handleRenderMp4()}
              style={{ padding: '8px 14px', borderRadius: 999, border: '1px solid #111111', background: '#ffffff', color: '#111111', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: rendering ? 'wait' : 'pointer' }}
            >
              {rendering ? <Loader2 style={{ width: 13, height: 13, animation: 'spin 1s linear infinite' }} /> : <Sparkles style={{ width: 13, height: 13 }} />}
              {rendering ? 'Renderizando MP4…' : 'Renderizar MP4'}
            </button>
            <button
              type="button"
              onClick={() => void persistV3({ ...config, enabled: true }, false)}
              style={{ padding: '8px 16px', borderRadius: 999, border: 'none', background: '#111111', color: '#ffffff', fontSize: 12, fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
            >
              <Check style={{ width: 13, height: 13, color: '#b6f500' }} />
              Aplicar ao vídeo
            </button>
          </div>
        </div>

        {statusMessage && (
          <div
            role="status"
            style={{
              padding: '8px 12px',
              borderRadius: 12,
              fontSize: 12,
              fontWeight: 500,
              border: `1px solid ${statusMessage.ok ? '#bbf7d0' : '#fecaca'}`,
              background: statusMessage.ok ? '#f0fdf4' : '#fef2f2',
              color: statusMessage.ok ? '#166534' : '#991b1b',
            }}
          >
            {statusMessage.text}
          </div>
        )}

        {lastRenderInfo && (
          <div style={{ fontSize: 11, color: '#52525b', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
            <span>
              <Eye style={{ width: 12, height: 12, display: 'inline', marginRight: 4 }} />
              MP4 pronto: {lastRenderInfo.templateId} · {lastRenderInfo.durationSec}s · {lastRenderInfo.width}x{lastRenderInfo.height}
            </span>
            <span style={{ fontWeight: 700, color: lastRenderInfo.cacheHit ? '#15803d' : '#111111' }}>
              {lastRenderInfo.cacheHit ? 'Cache Hit (instantâneo)' : `SFX: ${lastRenderInfo.sfxApplied.join(', ') || 'silêncio limpo'}`}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}
