import React, { useCallback, useEffect, useState } from 'react';
import {
  Check,
  Film,
  Image as ImageIcon,
  Layers,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react';

export type OutroAnimationStyle = 'energetic' | 'cinematic' | 'minimal';
export type OutroAspectRatio = '16:9' | '9:16';

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
}

export interface OutroRenderPreviewResult {
  ok: boolean;
  message?: string;
  config?: VideoOutroConfigView;
  result?: {
    outputMp4Path: string;
    durationSec: number;
    width: number;
    height: number;
    aspectRatio: OutroAspectRatio;
    style: OutroAnimationStyle;
    parallaxApplied: boolean;
    sfxApplied: string[];
    fileSizeBytes: number;
  };
}

interface LibraryImageItem {
  id: string;
  name: string;
  path: string;
  source: string;
}

interface OutroBridge {
  cinemaOutroGetConfig?: (input: {
    projectId: string;
    channelKey?: string | null;
    channelName?: string | null;
  }) => Promise<{ config: VideoOutroConfigView; source: 'project' | 'channel_default' | 'default' }>;
  cinemaOutroSaveConfig?: (input: {
    projectId: string;
    channelKey?: string | null;
    config: Partial<VideoOutroConfigView>;
    saveAsChannelDefault?: boolean;
  }) => Promise<{ ok: boolean; config: VideoOutroConfigView }>;
  cinemaOutroDeleteConfig?: (input: { projectId: string }) => Promise<{ ok: boolean; removed: boolean }>;
  cinemaOutroPickImage?: () => Promise<{ canceled: boolean; path: string | null; name: string | null }>;
  cinemaOutroListLibraryImages?: () => Promise<{ ok: boolean; images: LibraryImageItem[] }>;
  cinemaOutroRenderPreview?: (input: {
    projectId: string;
    config: Partial<VideoOutroConfigView>;
    quality?: 'preview' | 'master';
  }) => Promise<OutroRenderPreviewResult>;
}

function getOutroBridge(): OutroBridge | null {
  const w = window as unknown as {
    aetheraBridge?: OutroBridge;
    aethera?: OutroBridge;
    neuralbridge?: OutroBridge;
  };
  return w.aetheraBridge ?? w.aethera ?? w.neuralbridge ?? null;
}

function toMediaUrl(filePath: string | null | undefined): string {
  if (!filePath) return '';
  if (/^(https?:|data:|blob:|aethera-media:)/i.test(filePath)) return filePath;
  return `aethera-media://file?path=${encodeURIComponent(filePath)}`;
}

const DEFAULT_CONFIG: VideoOutroConfigView = {
  enabled: false,
  backgroundImagePath: null,
  backgroundImageName: null,
  channelName: '',
  style: 'energetic',
  durationSec: 15,
  showSubscribeCta: true,
  parallaxEnabled: true,
  showNextVideoCard: false,
  nextVideoTitle: '',
  aspectRatio: '16:9',
  lastPreviewMp4Path: null,
  lastRenderedAtIso: null,
  saveAsChannelDefault: false,
};

const STYLE_OPTIONS: Array<{ id: OutroAnimationStyle; label: string; hint: string }> = [
  { id: 'energetic', label: 'Energetic', hint: 'Zoom dinâmico, parallax ativo e destaque vibrante' },
  { id: 'cinematic', label: 'Cinematic', hint: 'Movimento suave, vinheta dramática e atmosfera' },
  { id: 'minimal', label: 'Minimal', hint: 'Tipografia limpa e flutuação sutil sem excessos' },
];

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
  const [config, setConfig] = useState<VideoOutroConfigView>(() => ({
    ...DEFAULT_CONFIG,
    channelName: channelName?.trim() || '',
    aspectRatio: aspectRatio ?? '16:9',
  }));
  const [configSource, setConfigSource] = useState<'project' | 'channel_default' | 'default'>('default');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [libraryImages, setLibraryImages] = useState<LibraryImageItem[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [previewInfo, setPreviewInfo] = useState<OutroRenderPreviewResult['result'] | null>(null);
  const [statusMessage, setStatusMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // Load persisted config (per-project or channel default)
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const bridge = getOutroBridge();
      if (!bridge?.cinemaOutroGetConfig) {
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const res = await bridge.cinemaOutroGetConfig({
          projectId: projectId || 'default',
          channelKey: channelName?.trim() || null,
          channelName: channelName?.trim() || null,
        });
        if (!alive) return;
        const merged: VideoOutroConfigView = {
          ...DEFAULT_CONFIG,
          ...res.config,
          aspectRatio: aspectRatio ?? res.config.aspectRatio ?? '16:9',
        };
        setConfig(merged);
        setConfigSource(res.source);
        onConfigChange?.(merged);
      } catch {
        // Keep defaults on error
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [projectId, channelName, aspectRatio]);

  const persistConfig = useCallback(
    async (next: VideoOutroConfigView, opts?: { saveAsChannelDefault?: boolean; silent?: boolean }) => {
      setConfig(next);
      onConfigChange?.(next);
      const bridge = getOutroBridge();
      if (!bridge?.cinemaOutroSaveConfig) return;
      setSaving(true);
      try {
        const res = await bridge.cinemaOutroSaveConfig({
          projectId: projectId || 'default',
          channelKey: next.channelName || channelName || null,
          config: next,
          saveAsChannelDefault: opts?.saveAsChannelDefault ?? next.saveAsChannelDefault,
        });
        if (res.ok && res.config) {
          setConfig(res.config);
          setConfigSource('project');
          onConfigChange?.(res.config);
          if (!opts?.silent) {
            setStatusMessage({
              ok: true,
              text: opts?.saveAsChannelDefault
                ? 'Configuração salva no projeto e definida como padrão do canal.'
                : 'Configuração do encerramento salva.',
            });
          }
        }
      } catch (err) {
        setStatusMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
      } finally {
        setSaving(false);
      }
    },
    [projectId, channelName, onConfigChange],
  );

  const patchConfig = (patch: Partial<VideoOutroConfigView>, silent = true) => {
    const next: VideoOutroConfigView = { ...config, ...patch };
    void persistConfig(next, { silent });
  };

  const handlePickImage = async () => {
    const bridge = getOutroBridge();
    if (!bridge?.cinemaOutroPickImage) {
      setStatusMessage({ ok: false, text: 'Seleção de imagem indisponível neste ambiente.' });
      return;
    }
    try {
      const res = await bridge.cinemaOutroPickImage();
      if (!res.canceled && res.path) {
        patchConfig(
          {
            enabled: true,
            backgroundImagePath: res.path,
            backgroundImageName: res.name || res.path.split(/[\\/]/).pop() || 'imagem',
          },
          false,
        );
      }
    } catch (err) {
      setStatusMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleOpenLibrary = async () => {
    const nextOpen = !showLibraryPicker;
    setShowLibraryPicker(nextOpen);
    if (!nextOpen) return;
    const bridge = getOutroBridge();
    if (!bridge?.cinemaOutroListLibraryImages) return;
    setLoadingLibrary(true);
    try {
      const res = await bridge.cinemaOutroListLibraryImages();
      if (res.ok) setLibraryImages(res.images);
    } finally {
      setLoadingLibrary(false);
    }
  };

  const handleRenderPreview = async () => {
    const bridge = getOutroBridge();
    if (!bridge?.cinemaOutroRenderPreview) {
      setStatusMessage({ ok: false, text: 'Motor de renderização MotionVelix indisponível neste build.' });
      return;
    }
    setRendering(true);
    setStatusMessage(null);
    try {
      const res = await bridge.cinemaOutroRenderPreview({
        projectId: projectId || 'default',
        config: { ...config, enabled: true },
        quality: 'preview',
      });
      if (res.ok && res.result) {
        setPreviewInfo(res.result);
        if (res.config) {
          setConfig(res.config);
          onConfigChange?.(res.config);
        }
        setStatusMessage({
          ok: true,
          text:
            res.message ||
            `Pré-visualização pronta (${res.result.durationSec}s · ${res.result.width}x${res.result.height}).`,
        });
      } else {
        setStatusMessage({ ok: false, text: res.message || 'Falha ao gerar pré-visualização do encerramento.' });
      }
    } catch (err) {
      setStatusMessage({ ok: false, text: err instanceof Error ? err.message : String(err) });
    } finally {
      setRendering(false);
    }
  };

  const handleRemoveOutro = async () => {
    const bridge = getOutroBridge();
    if (bridge?.cinemaOutroDeleteConfig) {
      await bridge.cinemaOutroDeleteConfig({ projectId: projectId || 'default' });
    }
    const reset: VideoOutroConfigView = {
      ...DEFAULT_CONFIG,
      channelName: channelName?.trim() || '',
      aspectRatio: config.aspectRatio,
    };
    setConfig(reset);
    setPreviewInfo(null);
    onConfigChange?.(reset);
    setStatusMessage({ ok: true, text: 'Encerramento removido deste projeto.' });
  };

  const activePreviewPath = previewInfo?.outputMp4Path || config.lastPreviewMp4Path || null;

  return (
    <section
      aria-label="Encerramento do vídeo — MotionVelix"
      style={{
        background: '#ffffff',
        border: '1px solid #e4e4e7',
        borderRadius: 20,
        padding: compact ? 16 : 20,
        display: 'flex',
        flexDirection: 'column',
        gap: 16,
        boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
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
              flexShrink: 0,
            }}
          >
            <Film style={{ width: 18, height: 18 }} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111111', letterSpacing: '-0.01em' }}>
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
                MotionVelix
              </span>
              {configSource === 'channel_default' && (
                <span style={{ fontSize: 11, color: '#71717a' }}>· Padrão do canal</span>
              )}
            </div>
            <p style={{ margin: '2px 0 0', fontSize: 12, color: '#52525b' }}>
              Adiciona um Outro animado ao final do vídeo sem cortar narração ou cenas.
            </p>
          </div>
        </div>

        {/* 1. Ativar encerramento */}
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
            userSelect: 'none',
          }}
        >
          <input
            type="checkbox"
            checked={config.enabled}
            disabled={loading}
            onChange={(e) => patchConfig({ enabled: e.target.checked }, false)}
            style={{ accentColor: '#b6f500', width: 15, height: 15, cursor: 'pointer' }}
          />
          Ativar encerramento
        </label>
      </div>

      {/* Body Controls */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          opacity: config.enabled ? 1 : 0.55,
          pointerEvents: config.enabled ? 'auto' : 'none',
          transition: 'opacity 160ms ease',
        }}
      >
        {/* 2. Imagem de fundo */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#27272a' }}>Imagem de fundo (PNG, JPG ou WEBP)</span>
            <button
              type="button"
              onClick={() => void handleOpenLibrary()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '4px 10px',
                borderRadius: 999,
                border: '1px solid #d4d4d8',
                background: '#ffffff',
                color: '#111111',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Layers style={{ width: 12, height: 12 }} />
              {showLibraryPicker ? 'Fechar Biblioteca' : 'Escolher da Biblioteca'}
            </button>
          </div>

          {config.backgroundImagePath ? (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: 10,
                borderRadius: 14,
                border: '1px solid #e4e4e7',
                background: '#fafafa',
              }}
            >
              <img
                src={toMediaUrl(config.backgroundImagePath)}
                alt="Prévia do fundo do encerramento"
                style={{
                  width: 96,
                  height: 54,
                  objectFit: 'cover',
                  borderRadius: 10,
                  border: '1px solid #d4d4d8',
                  background: '#18181b',
                }}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#111111', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {config.backgroundImageName || config.backgroundImagePath.split(/[\\/]/).pop()}
                </div>
                <div style={{ fontSize: 11, color: '#71717a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {config.backgroundImagePath}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => void handlePickImage()}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 10,
                    border: '1px solid #d4d4d8',
                    background: '#ffffff',
                    color: '#111111',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Trocar
                </button>
                <button
                  type="button"
                  aria-label="Remover imagem de fundo"
                  onClick={() => patchConfig({ backgroundImagePath: null, backgroundImageName: null }, false)}
                  style={{
                    padding: '6px 8px',
                    borderRadius: 10,
                    border: '1px solid #fecaca',
                    background: '#fef2f2',
                    color: '#b91c1c',
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 style={{ width: 13, height: 13 }} />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => void handlePickImage()}
              style={{
                width: '100%',
                padding: '18px 14px',
                borderRadius: 14,
                border: '1.5px dashed #d4d4d8',
                background: '#fafafa',
                color: '#3f3f46',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
              }}
            >
              <Upload style={{ width: 18, height: 18, color: '#52525b' }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#111111' }}>
                Clique para enviar imagem de fundo
              </span>
              <span style={{ fontSize: 11, color: '#71717a' }}>
                PNG, JPG ou WEBP · será animada com efeito {config.style} e parallax
              </span>
            </button>
          )}

          {showLibraryPicker && (
            <div
              style={{
                padding: 12,
                borderRadius: 14,
                border: '1px solid #e4e4e7',
                background: '#f8fafc',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 700, color: '#52525b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Imagens da Biblioteca &amp; Thumbs
              </span>
              {loadingLibrary ? (
                <span style={{ fontSize: 12, color: '#71717a' }}>Carregando imagens…</span>
              ) : libraryImages.length === 0 ? (
                <span style={{ fontSize: 12, color: '#71717a' }}>
                  Nenhuma imagem encontrada na Biblioteca. Envie uma imagem PNG, JPG ou WEBP acima.
                </span>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(110px, 1fr))', gap: 8, maxHeight: 190, overflowY: 'auto' }}>
                  {libraryImages.map((img) => {
                    const selected = config.backgroundImagePath === img.path;
                    return (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() => {
                          patchConfig({ enabled: true, backgroundImagePath: img.path, backgroundImageName: img.name }, false);
                          setShowLibraryPicker(false);
                        }}
                        style={{
                          padding: 4,
                          borderRadius: 10,
                          border: `2px solid ${selected ? '#111111' : '#e4e4e7'}`,
                          background: '#ffffff',
                          cursor: 'pointer',
                          textAlign: 'left',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 4,
                        }}
                      >
                        <img
                          src={toMediaUrl(img.path)}
                          alt={img.name}
                          style={{ width: '100%', height: 58, objectFit: 'cover', borderRadius: 6, background: '#18181b' }}
                        />
                        <span style={{ fontSize: 10, fontWeight: 600, color: '#27272a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {img.name}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 3. Nome do canal & Formato */}
        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : '1fr auto', gap: 12, alignItems: 'end' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#27272a' }}>Nome do canal</span>
            <input
              type="text"
              value={config.channelName}
              placeholder="Ex.: Aethera Mangá Recap"
              onChange={(e) => setConfig((prev) => ({ ...prev, channelName: e.target.value }))}
              onBlur={() => void persistConfig(config, { silent: true })}
              style={{
                width: '100%',
                padding: '9px 12px',
                borderRadius: 12,
                border: '1px solid #d4d4d8',
                background: '#ffffff',
                fontSize: 13,
                color: '#111111',
                outline: 'none',
              }}
            />
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#27272a' }}>Área segura</span>
            <div style={{ display: 'inline-flex', padding: 3, borderRadius: 999, background: '#f4f4f5', border: '1px solid #e4e4e7' }}>
              {(['16:9', '9:16'] as const).map((ratio) => (
                <button
                  key={ratio}
                  type="button"
                  onClick={() => patchConfig({ aspectRatio: ratio })}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 999,
                    border: 'none',
                    background: config.aspectRatio === ratio ? '#111111' : 'transparent',
                    color: config.aspectRatio === ratio ? '#ffffff' : '#52525b',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {ratio}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 4. Estilo da animação */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#27272a' }}>Estilo da animação</span>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {STYLE_OPTIONS.map((opt) => {
              const active = config.style === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => patchConfig({ style: opt.id })}
                  style={{
                    padding: '10px 12px',
                    borderRadius: 14,
                    border: `1.5px solid ${active ? '#111111' : '#e4e4e7'}`,
                    background: active ? '#111111' : '#fafafa',
                    color: active ? '#ffffff' : '#111111',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 12, fontWeight: 700 }}>
                    <span>{opt.label}</span>
                    {active && <Check style={{ width: 13, height: 13, color: '#b6f500' }} />}
                  </div>
                  <span style={{ fontSize: 10, color: active ? '#d4d4d8' : '#71717a', lineHeight: 1.35 }}>
                    {opt.hint}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 5. Duração (5s a 30s, padrão 15s) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#27272a' }}>Duração do encerramento</span>
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                padding: '2px 10px',
                borderRadius: 999,
                background: '#f4f4f5',
                color: '#111111',
              }}
            >
              {config.durationSec}s
            </span>
          </div>
          <input
            type="range"
            min={5}
            max={30}
            step={1}
            value={config.durationSec}
            onChange={(e) => setConfig((prev) => ({ ...prev, durationSec: Number(e.target.value) }))}
            onMouseUp={() => void persistConfig(config, { silent: true })}
            onTouchEnd={() => void persistConfig(config, { silent: true })}
            style={{ width: '100%', accentColor: '#111111', cursor: 'pointer' }}
          />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#71717a', fontVariantNumeric: 'tabular-nums' }}>
            <span>5s</span>
            <span>15s (padrão)</span>
            <span>30s</span>
          </div>
        </div>

        {/* 6, 7, 8. Toggles: Chamada para inscrição, Parallax, Próximo vídeo */}
        <div style={{ display: 'grid', gridTemplateColumns: compact ? '1fr' : 'repeat(3, 1fr)', gap: 8 }}>
          {[
            {
              key: 'showSubscribeCta' as const,
              label: 'Chamada para inscrição',
              checked: config.showSubscribeCta,
            },
            {
              key: 'parallaxEnabled' as const,
              label: 'Parallax',
              checked: config.parallaxEnabled,
            },
            {
              key: 'showNextVideoCard' as const,
              label: 'Próximo vídeo',
              checked: config.showNextVideoCard,
            },
          ].map((item) => (
            <label
              key={item.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                padding: '9px 12px',
                borderRadius: 12,
                border: '1px solid #e4e4e7',
                background: item.checked ? '#f8fafc' : '#ffffff',
                fontSize: 12,
                fontWeight: 600,
                color: '#18181b',
                cursor: 'pointer',
              }}
            >
              <span>{item.label}</span>
              <input
                type="checkbox"
                checked={item.checked}
                onChange={(e) => patchConfig({ [item.key]: e.target.checked })}
                style={{ accentColor: '#111111', width: 15, height: 15, cursor: 'pointer' }}
              />
            </label>
          ))}
        </div>

        {config.showNextVideoCard && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#27272a' }}>Título do próximo vídeo (opcional)</span>
            <input
              type="text"
              value={config.nextVideoTitle || ''}
              placeholder="Ex.: Episódio 2 — A Ascensão"
              onChange={(e) => setConfig((prev) => ({ ...prev, nextVideoTitle: e.target.value }))}
              onBlur={() => void persistConfig(config, { silent: true })}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 12,
                border: '1px solid #d4d4d8',
                background: '#ffffff',
                fontSize: 12,
                color: '#111111',
              }}
            />
          </label>
        )}

        {/* Salvar como padrão do canal + Ações */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', paddingTop: 4 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, color: '#52525b', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={Boolean(config.saveAsChannelDefault)}
              onChange={(e) => {
                const checked = e.target.checked;
                void persistConfig({ ...config, saveAsChannelDefault: checked }, { saveAsChannelDefault: checked, silent: false });
              }}
              style={{ accentColor: '#111111', width: 14, height: 14 }}
            />
            Salvar como padrão do canal
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {activePreviewPath && (
              <button
                type="button"
                onClick={() => void handleRemoveOutro()}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 12px',
                  borderRadius: 999,
                  border: '1px solid #fecaca',
                  background: '#fef2f2',
                  color: '#b91c1c',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <Trash2 style={{ width: 13, height: 13 }} />
                Remover
              </button>
            )}

            {/* 9. Pré-visualização */}
            <button
              type="button"
              disabled={rendering || saving}
              onClick={() => void handleRenderPreview()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 7,
                padding: '9px 16px',
                borderRadius: 999,
                border: 'none',
                background: '#111111',
                color: '#ffffff',
                fontSize: 12,
                fontWeight: 700,
                cursor: rendering ? 'wait' : 'pointer',
                opacity: rendering ? 0.7 : 1,
              }}
            >
              {rendering ? (
                <Loader2 style={{ width: 14, height: 14, animation: 'spin 1s linear infinite' }} />
              ) : activePreviewPath ? (
                <RefreshCw style={{ width: 14, height: 14, color: '#b6f500' }} />
              ) : (
                <Play style={{ width: 14, height: 14, color: '#b6f500' }} />
              )}
              {rendering
                ? 'Renderizando encerramento…'
                : activePreviewPath
                  ? 'Regenerar pré-visualização'
                  : 'Pré-visualizar encerramento'}
            </button>
          </div>
        </div>

        {/* Status feedback */}
        {statusMessage && (
          <div
            role="status"
            style={{
              padding: '9px 12px',
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

        {/* Inline Real MP4 Preview Player */}
        {activePreviewPath && (
          <div
            style={{
              borderRadius: 14,
              border: '1px solid #e4e4e7',
              background: '#09090b',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <video
              key={activePreviewPath}
              src={toMediaUrl(activePreviewPath)}
              controls
              playsInline
              style={{
                width: '100%',
                maxHeight: config.aspectRatio === '9:16' ? 360 : 280,
                background: '#09090b',
                display: 'block',
              }}
            />
            <div
              style={{
                padding: '8px 12px',
                background: '#18181b',
                color: '#e4e4e7',
                fontSize: 11,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                flexWrap: 'wrap',
              }}
            >
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Sparkles style={{ width: 12, height: 12, color: '#b6f500' }} />
                MotionVelix · {previewInfo?.durationSec ?? config.durationSec}s · {config.aspectRatio} · {config.style}
              </span>
              <span style={{ color: '#a1a1aa' }}>
                {config.parallaxEnabled ? 'Parallax ON' : 'Parallax OFF'}
                {previewInfo?.sfxApplied?.length ? ` · SFX: ${previewInfo.sfxApplied.join(', ')}` : ''}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
