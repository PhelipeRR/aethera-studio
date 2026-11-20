import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  DownloadCloud,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Search,
  Server,
  Terminal,
  Trash2,
  WrapText,
} from 'lucide-react';
import type { ConsoleLogEntry, MediaAsset, ProductionProject } from '../domain/types';
import { MyAccountSection, MyComputersSection } from '../components/AccountComputersSettings';
import { useRemoteHost } from '../store/remote-host-store';
import { useStudio, type SettingsTabId } from '../store/studio-store';

export function LibraryPage() {
  const { mediaAssets, projects, capabilities, addMediaAsset, acquireViaYtDlp } = useStudio();
  const [filter, setFilter] = useState<'all' | MediaAsset['kind']>('all');
  const [query, setQuery] = useState('');
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<MediaAsset['kind']>('video');
  const [newLicense, setNewLicense] = useState<MediaAsset['license']>('Original');

  // yt-dlp acquisition state
  const [ytQuery, setYtQuery] = useState('');
  const [ytResult, setYtResult] = useState<{ ok: boolean; status: string; message: string } | null>(null);
  const [ytLoading, setYtLoading] = useState(false);

  const ytDlpCap = capabilities.items.find((i) => i.id === 'yt-dlp');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return mediaAssets.filter((item) => {
      if (filter !== 'all' && item.kind !== filter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.tags.some((t) => t.toLowerCase().includes(q)) ||
        item.license.toLowerCase().includes(q)
      );
    });
  }, [mediaAssets, filter, query]);

  const handleAdd = async () => {
    if (!newName.trim()) return;
    await addMediaAsset({
      name: newName.trim(),
      kind: newKind,
      durationLabel: newKind === 'image' ? '1920×1080' : newKind === 'script' ? '1.200 palavras' : '00:45',
      license: newLicense,
      tags: ['estúdio', newKind],
      projectId: projects[0]?.id ?? null,
    });
    setNewName('');
  };

  const handleYtDlpAcquire = async () => {
    if (!ytQuery.trim()) return;
    setYtLoading(true);
    try {
      const res = await acquireViaYtDlp(ytQuery.trim());
      setYtResult(res);
      if (res.ok) setYtQuery('');
    } finally {
      setYtLoading(false);
    }
  };

  const iconFor = (kind: MediaAsset['kind']) => {
    if (kind === 'video') return <Film className="w-4 h-4 text-[#6a46d8]" />;
    if (kind === 'audio') return <Music className="w-4 h-4 text-[#2f7d32]" />;
    if (kind === 'image') return <ImageIcon className="w-4 h-4 text-[#2f5fd0]" />;
    return <FileText className="w-4 h-4 text-[#9a6200]" />;
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] bg-white px-6 py-5 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">Biblioteca de Mídia</h1>
          <p className="text-xs text-[#62626c]">
            Mídias, áudios, roteiros, licenças editoriais e sonda real de aquisição via yt-dlp.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#62626c] absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar arquivo ou tag..."
              aria-label="Buscar na biblioteca"
              className="h-9 rounded-full bg-[#f4f4f6] pl-8 pr-3 text-xs text-[#111111] outline-none"
            />
          </div>
          {(['all', 'video', 'audio', 'image', 'script'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`h-9 px-3.5 rounded-full text-xs font-semibold ${
                filter === k ? 'bg-[#111111] text-white' : 'bg-[#f4f4f6] text-[#111111]'
              }`}
            >
              {k === 'all' ? 'Todos' : k === 'video' ? 'Vídeos' : k === 'audio' ? 'Áudios' : k === 'image' ? 'Imagens' : 'Roteiros'}
            </button>
          ))}
        </div>
      </div>

      {/* Add Local Asset Bar */}
      <div className="rounded-[28px] bg-white p-4 shadow-2xs flex flex-wrap items-center gap-2.5">
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Registrar novo asset no SQLite (ex.: broll_laboratorio_4k.mp4)"
          aria-label="Nome do novo asset"
          className="flex-1 min-w-[200px] h-10 rounded-full bg-[#f4f4f6] px-4 text-xs text-[#111111] outline-none"
        />
        <select
          aria-label="Tipo de mídia"
          value={newKind}
          onChange={(e) => setNewKind(e.target.value as MediaAsset['kind'])}
          className="h-10 rounded-full bg-[#f4f4f6] px-3 text-xs font-medium text-[#111111]"
        >
          <option value="video">Vídeo</option>
          <option value="audio">Áudio</option>
          <option value="image">Imagem</option>
          <option value="script">Roteiro</option>
        </select>
        <select
          aria-label="Licença"
          value={newLicense}
          onChange={(e) => setNewLicense(e.target.value as MediaAsset['license'])}
          className="h-10 rounded-full bg-[#f4f4f6] px-3 text-xs font-medium text-[#111111]"
        >
          <option value="Original">Original</option>
          <option value="Creative Commons">Creative Commons</option>
          <option value="Licenciado">Licenciado</option>
          <option value="Uso Editorial">Uso Editorial</option>
        </select>
        <button
          type="button"
          onClick={() => void handleAdd()}
          className="h-10 px-5 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-1.5"
        >
          <Plus className="w-3.5 h-3.5 text-[#d8fb4f]" />
          <span>Catalogar Mídia</span>
        </button>
      </div>

      {/* Real yt-dlp Acquisition Section (explicitly honest when binary is absent) */}
      <section className="rounded-[28px] bg-white p-4 shadow-2xs space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-bold text-[#111111]">
            <DownloadCloud className="w-4 h-4 text-[#6a46d8]" />
            <span>Aquisição Externa de Mídia (yt-dlp)</span>
          </div>
          <span
            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
              ytDlpCap?.available ? 'bg-[#d8fb4f] text-[#111111]' : 'bg-[#fde7f3] text-[#b42840]'
            }`}
          >
            {ytDlpCap?.available ? 'yt-dlp Ativo' : 'Bloqueado: yt-dlp ausente no container'}
          </span>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={ytQuery}
            onChange={(e) => setYtQuery(e.target.value)}
            placeholder="URL ou busca editorial (ex.: https://www.youtube.com/watch?v=... ou termo)"
            aria-label="URL ou termo para aquisição yt-dlp"
            className="flex-1 min-w-[220px] h-9 rounded-full bg-[#f4f4f6] px-4 text-xs text-[#111111] outline-none"
          />
          <button
            type="button"
            disabled={ytLoading || !ytQuery.trim()}
            onClick={() => void handleYtDlpAcquire()}
            className="h-9 px-4 rounded-full bg-[#b8a4f4] text-[#111111] text-xs font-bold disabled:opacity-50"
          >
            {ytLoading ? 'Consultando...' : 'Consultar via yt-dlp'}
          </button>
        </div>

        {ytResult && (
          <div
            className={`rounded-2xl px-3.5 py-2.5 text-xs flex items-start gap-2 ${
              ytResult.ok ? 'bg-[#f3fdd0] text-[#111111]' : 'bg-[#fff4dc] text-[#704700]'
            }`}
          >
            {ytResult.ok ? (
              <CheckCircle2 className="w-4 h-4 text-[#2f7d32] shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            )}
            <span>{ytResult.message}</span>
          </div>
        )}
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
        {filtered.map((item) => (
          <article key={item.id} className="rounded-[24px] bg-white p-4 shadow-2xs space-y-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="w-9 h-9 rounded-2xl bg-[#f4f4f6] flex items-center justify-center shrink-0">
                  {iconFor(item.kind)}
                </div>
                <div className="min-w-0">
                  <h2 className="text-xs font-bold text-[#111111] truncate">{item.name}</h2>
                  <div className="text-[11px] font-mono text-[#62626c]">
                    {item.durationLabel} • {item.addedAt}
                  </div>
                </div>
              </div>
              <span className="px-2.5 py-0.5 rounded-full bg-[#efe9fd] text-[#2a1d5c] text-[10px] font-semibold shrink-0">
                {item.license}
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <span key={tag} className="px-2 py-0.5 rounded-full bg-[#f4f4f6] text-[10px] text-[#62626c]">
                  #{tag}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

type LogFilter = 'all' | ConsoleLogEntry['scope'] | 'remote' | 'sync';
type SourceFilter = 'all' | 'web' | 'remote' | 'sync';
type LevelFilter = 'all' | 'info' | 'success' | 'warn' | 'error';

interface TerminalLine {
  id: string;
  timestamp: string;
  source: 'web' | 'remote' | 'sync';
  scope: string;
  level: 'info' | 'success' | 'warn' | 'error';
  message: string;
}

export function ConsolePage() {
  const { consoleLogs, sseConnected, clearLogs } = useStudio();
  const {
    connectionState: remoteState,
    hostStatus,
    sseConnected: remoteSseConnected,
    syncSseConnected,
    selectedJobEvents,
    syncEvents,
  } = useRemoteHost();

  const [scope, setScope] = useState<LogFilter>('all');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [grepQuery, setGrepQuery] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [wrapLines, setWrapLines] = useState(true);
  const [copied, setCopied] = useState(false);

  const viewportRef = useRef<HTMLDivElement | null>(null);

  const unifiedLines = useMemo<TerminalLine[]>(() => {
    const webLines: TerminalLine[] = consoleLogs.map((log) => ({
      id: `web-${log.id}`,
      timestamp: log.timestamp,
      source: 'web',
      scope: log.scope,
      level: log.level,
      message: log.message,
    }));

    const remoteLines: TerminalLine[] = selectedJobEvents.map((ev) => ({
      id: `pc-${ev.jobId}-${ev.seq}`,
      timestamp: new Date(ev.timestamp).toLocaleTimeString('pt-BR', { hour12: false }),
      source: 'remote',
      scope: ev.stage || 'remote',
      level:
        ev.level === 'error'
          ? 'error'
          : ev.level === 'warn'
            ? 'warn'
            : ev.type === 'artifact_ready' || ev.type === 'approval_resolved'
              ? 'success'
              : 'info',
      message: `[job:${ev.jobId.slice(0, 12)}] ${ev.message}`,
    }));

    const syncLines: TerminalLine[] = syncEvents.map((ev) => ({
      id: `sync-${ev.seq}`,
      timestamp: new Date(ev.timestamp).toLocaleTimeString('pt-BR', { hour12: false }),
      source: 'sync',
      scope: 'sync',
      level: ev.eventType === 'media_ready' || ev.eventType === 'conflict_resolved' ? 'success' : 'info',
      message: `[seq:#${ev.seq} v${ev.version} by:${ev.actor}] ${ev.summary} (${ev.projectId})`,
    }));

    // Display in chronological terminal order (oldest -> newest right above tail cursor)
    return [...webLines, ...remoteLines, ...syncLines].sort((a, b) =>
      a.timestamp.localeCompare(b.timestamp),
    );
  }, [consoleLogs, selectedJobEvents, syncEvents]);

  const visibleLines = useMemo(() => {
    const q = grepQuery.trim().toLowerCase();
    return unifiedLines.filter((line) => {
      if (sourceFilter !== 'all' && line.source !== sourceFilter) return false;
      if (levelFilter !== 'all' && line.level !== levelFilter) return false;
      if (scope !== 'all') {
        if (scope === 'remote') {
          if (line.source !== 'remote') return false;
        } else if (scope === 'sync') {
          if (line.source !== 'sync') return false;
        } else if (line.scope !== scope) {
          return false;
        }
      }
      if (!q) return true;
      return (
        line.message.toLowerCase().includes(q) ||
        line.scope.toLowerCase().includes(q) ||
        line.source.toLowerCase().includes(q) ||
        line.timestamp.toLowerCase().includes(q)
      );
    });
  }, [unifiedLines, sourceFilter, levelFilter, scope, grepQuery]);

  useEffect(() => {
    if (!autoScroll || !viewportRef.current) return;
    viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
  }, [visibleLines.length, autoScroll]);

  const handleCopyAll = async () => {
    const text = visibleLines
      .map(
        (l, idx) =>
          `${String(idx + 1).padStart(4, '0')} ${l.timestamp} [${l.source.toUpperCase()}] [${l.level.toUpperCase()}] ${l.scope}: ${l.message}`,
      )
      .join('\n');
    try {
      await navigator.clipboard.writeText(text || '# console vazio');
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // ignore clipboard denial in headless contexts
    }
  };

  const remoteConnected = remoteState === 'connected';
  const totalWeb = consoleLogs.length;
  const totalRemote = selectedJobEvents.length;
  const totalSync = syncEvents.length;

  return (
    <div className="space-y-4">
      {/* Compact Light Bento Header */}
      <div className="rounded-[28px] bg-white px-6 py-4 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-[#111111] text-[#d8fb4f] flex items-center justify-center shrink-0">
            <Terminal className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#111111]">Console Geral</h1>
            <p className="text-xs text-[#62626c]">
              Terminal unificado em tempo real (SSE) — Pipeline Web, FFmpeg, Agentes, Remote Host e Sync Bidirecional.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all', label: `Todos (${unifiedLines.length})` },
              { id: 'web', label: `Web (${totalWeb})` },
              { id: 'remote', label: `PC Remoto (${totalRemote})` },
              { id: 'sync', label: `Sync (${totalSync})` },
            ] as const
          ).map((src) => (
            <button
              key={src.id}
              type="button"
              onClick={() => setSourceFilter(src.id)}
              className={`h-8 px-3 rounded-full text-xs font-semibold transition-colors ${
                sourceFilter === src.id
                  ? 'bg-[#111111] text-white'
                  : 'bg-[#f4f4f6] text-[#111111] hover:bg-[#e5e5eb]'
              }`}
            >
              {src.label}
            </button>
          ))}
        </div>
      </div>

      {/* Authentic Engineering Terminal Window */}
      <section
        aria-label="Terminal do Console Geral"
        className="rounded-[24px] bg-[#0c0d11] border border-[#232634] shadow-lg overflow-hidden text-[#e5e7eb]"
      >
        {/* Terminal Title Bar & Controls */}
        <div className="bg-[#14161f] border-b border-[#232634] px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
              <span className="w-2.5 h-2.5 rounded-full bg-[#ff5f56]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#ffbd2e]" />
              <span className="w-2.5 h-2.5 rounded-full bg-[#27c93f]" />
            </div>
            <div className="font-mono text-xs text-[#cbd5e1] truncate flex items-center gap-2">
              <span className="text-[#d8fb4f] font-bold">aethera@studio</span>
              <span className="text-[#64748b]">:</span>
              <span className="text-[#a78bfa]">~/pipeline</span>
              <span className="text-[#64748b]">$</span>
            </div>
            <span
              className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-[#0c0d11] border font-mono text-[10px] font-bold uppercase ${
                sseConnected
                  ? 'border-[#3f6212] text-[#d8fb4f]'
                  : 'border-[#78350f] text-[#fbbf24]'
              }`}
            >
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  sseConnected ? 'bg-[#d8fb4f] animate-pulse' : 'bg-[#fbbf24]'
                }`}
              />
              {sseConnected ? 'LIVE SSE' : 'RECONNECT'}
            </span>
            {remoteConnected && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-[#0c0d11] border border-[#1e3a8a] text-[#38bdf8] font-mono text-[10px] font-bold">
                PC:{hostStatus?.hostname ?? 'ONLINE'}
                {remoteSseConnected || syncSseConnected ? ' • STREAM' : ''}
              </span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-[#64748b] absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={grepQuery}
                onChange={(e) => setGrepQuery(e.target.value)}
                placeholder="grep log, job, escopo..."
                aria-label="Filtrar saída do console (grep)"
                className="h-7 w-48 sm:w-56 rounded-lg bg-[#0c0d11] border border-[#2a2e3f] focus:border-[#8b6cf0] pl-7 pr-2.5 font-mono text-[11px] text-[#e5e7eb] placeholder:text-[#64748b] outline-none"
              />
            </div>

            <select
              aria-label="Filtrar nível de log"
              value={levelFilter}
              onChange={(e) => setLevelFilter(e.target.value as LevelFilter)}
              className="h-7 rounded-lg bg-[#0c0d11] border border-[#2a2e3f] px-2 font-mono text-[11px] text-[#cbd5e1] outline-none"
            >
              <option value="all">LVL:ALL</option>
              <option value="info">INFO</option>
              <option value="success">OK</option>
              <option value="warn">WARN</option>
              <option value="error">ERR</option>
            </select>

            <button
              type="button"
              onClick={() => setAutoScroll((v) => !v)}
              title={autoScroll ? 'Pausar auto-scroll' : 'Retomar auto-scroll'}
              className={`h-7 px-2.5 rounded-lg border font-mono text-[11px] inline-flex items-center gap-1 transition-colors ${
                autoScroll
                  ? 'bg-[#1c2414] border-[#3f6212] text-[#d8fb4f]'
                  : 'bg-[#0c0d11] border-[#2a2e3f] text-[#94a3b8] hover:text-white'
              }`}
            >
              {autoScroll ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
              <span>{autoScroll ? 'Tail' : 'Pausado'}</span>
            </button>

            <button
              type="button"
              onClick={() => setWrapLines((v) => !v)}
              title="Alternar quebra de linha"
              className={`h-7 px-2 rounded-lg border font-mono text-[11px] inline-flex items-center gap-1 transition-colors ${
                wrapLines
                  ? 'bg-[#1b1930] border-[#4c3a91] text-[#c4b5fd]'
                  : 'bg-[#0c0d11] border-[#2a2e3f] text-[#94a3b8] hover:text-white'
              }`}
            >
              <WrapText className="w-3 h-3" />
              <span>Wrap</span>
            </button>

            <button
              type="button"
              onClick={() => void handleCopyAll()}
              className="h-7 px-2.5 rounded-lg bg-[#0c0d11] border border-[#2a2e3f] hover:border-[#64748b] font-mono text-[11px] text-[#cbd5e1] inline-flex items-center gap-1"
            >
              {copied ? <Check className="w-3 h-3 text-[#d8fb4f]" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? 'Copiado' : 'Copiar'}</span>
            </button>

            <button
              type="button"
              onClick={() => void clearLogs()}
              className="h-7 px-2.5 rounded-lg bg-[#24131b] border border-[#5b213a] hover:bg-[#331724] font-mono text-[11px] text-[#fda4af] inline-flex items-center gap-1"
            >
              <Trash2 className="w-3 h-3" />
              <span>clear</span>
            </button>
          </div>
        </div>

        {/* Scope Flags Sub-Bar */}
        <div className="bg-[#10121a] border-b border-[#1d202d] px-4 py-1.5 flex items-center gap-1 overflow-x-auto font-mono text-[11px]">
          {(
            [
              'all',
              'pipeline',
              'render',
              'agents',
              'sync',
              'remote',
              'publishing',
              'creative',
              'review',
              'editor',
              'media',
              'calendar',
            ] as const
          ).map((sc) => (
            <button
              key={sc}
              type="button"
              onClick={() => setScope(sc)}
              className={`px-2 py-0.5 rounded transition-colors shrink-0 ${
                scope === sc
                  ? 'bg-[#d8fb4f] text-[#0c0d11] font-bold'
                  : 'text-[#94a3b8] hover:bg-white/5 hover:text-[#e5e7eb]'
              }`}
            >
              {sc === 'all' ? '--all' : `--${sc}`}
            </button>
          ))}
        </div>

        {/* Terminal Viewport */}
        <div
          ref={viewportRef}
          className="min-h-[420px] max-h-[580px] overflow-auto px-3 py-3 font-mono text-[12px] leading-[1.65] selection:bg-[#6a46d8] selection:text-white"
        >
          <div className="text-[#64748b] px-2 pb-2 mb-2 border-b border-[#1b1e2b] text-[11px]">
            # Aethera Studio Console Stream — UTF-8 • SSE Web ({sseConnected ? 'online' : 'offline'}) • Remote PC (
            {remoteConnected ? hostStatus?.hostname ?? 'online' : 'desconectado'}) • Sync (
            {syncSseConnected ? 'tempo real' : 'inativo'})
          </div>

          {visibleLines.length === 0 ? (
            <div className="px-2 py-8 text-[#64748b]">
              (nenhuma linha corresponde ao filtro atual — pressione <code className="text-[#a78bfa]">--all</code> ou limpe o grep)
            </div>
          ) : (
            <div className="space-y-0.5">
              {visibleLines.map((line, index) => {
                const lineNum = String(index + 1).padStart(4, '0');
                const sourceColor =
                  line.source === 'sync'
                    ? 'text-[#d8fb4f]'
                    : line.source === 'remote'
                      ? 'text-[#38bdf8]'
                      : 'text-[#a78bfa]';
                const levelTag =
                  line.level === 'success'
                    ? { text: 'OK  ', cls: 'text-[#4ade80]' }
                    : line.level === 'warn'
                      ? { text: 'WARN', cls: 'text-[#fbbf24]' }
                      : line.level === 'error'
                        ? { text: 'ERR ', cls: 'text-[#f87171]' }
                        : { text: 'INFO', cls: 'text-[#94a3b8]' };
                const msgColor =
                  line.level === 'error'
                    ? 'text-[#fca5a5]'
                    : line.level === 'warn'
                      ? 'text-[#fde68a]'
                      : line.level === 'success'
                        ? 'text-[#ecfccb]'
                        : 'text-[#e5e7eb]';

                return (
                  <div
                    key={line.id}
                    className={`flex items-start gap-2.5 px-2 py-0.5 rounded hover:bg-white/[0.035] ${
                      wrapLines ? 'whitespace-pre-wrap break-words' : 'whitespace-pre min-w-max'
                    }`}
                  >
                    <span className="text-[#475569] select-none shrink-0 w-9 text-right">{lineNum}</span>
                    <span className="text-[#64748b] shrink-0">{line.timestamp}</span>
                    <span className={`${sourceColor} font-bold shrink-0`}>
                      [{line.source === 'remote' ? 'PC' : line.source.toUpperCase()}]
                    </span>
                    <span className={`${levelTag.cls} font-bold shrink-0`}>[{levelTag.text}]</span>
                    <span className="text-[#c4b5fd] shrink-0">{line.scope}:</span>
                    <span className={`${msgColor} flex-1 min-w-0`}>{line.message}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Active Prompt Line */}
          <div className="mt-3 pt-2 border-t border-[#1b1e2b] px-2 flex items-center gap-2 text-[11px] text-[#94a3b8]">
            <span className="text-[#d8fb4f] font-bold">aethera@studio:~$</span>
            <span>tail -f /var/log/aethera/runtime.stream</span>
            <span className="inline-block w-2 h-3.5 bg-[#d8fb4f] animate-pulse align-middle" aria-hidden="true" />
          </div>
        </div>

        {/* Terminal Status Footer */}
        <div className="bg-[#14161f] border-t border-[#232634] px-4 py-1.5 flex flex-wrap items-center justify-between gap-2 font-mono text-[11px] text-[#94a3b8]">
          <span>
            linhas: <strong className="text-[#e5e7eb]">{visibleLines.length}</strong> / {unifiedLines.length}
            {grepQuery.trim() ? ` • grep="${grepQuery.trim()}"` : ''}
          </span>
          <span>
            Web:{totalWeb} • PC:{totalRemote} • Sync:{totalSync} • {wrapLines ? 'WRAP' : 'NOWRAP'} •{' '}
            {autoScroll ? 'TAIL:ON' : 'TAIL:PAUSED'}
          </span>
        </div>
      </section>
    </div>
  );
}

export function SettingsPage() {
  const {
    preferences,
    capabilities,
    settingsTab,
    openSettingsTab,
    updatePreferences,
    resetWorkspace,
  } = useStudio();
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const tabs: ReadonlyArray<{ id: SettingsTabId; label: string }> = [
    { id: 'computers', label: 'Meus Computadores' },
    { id: 'account', label: 'Minha Conta' },
    { id: 'studio', label: 'Estúdio & Diagnóstico' },
  ];

  return (
    <div className="space-y-4 max-w-5xl">
      <div className="rounded-[28px] bg-white px-6 py-5 shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">Configurações</h1>
          <p className="text-xs text-[#62626c] mt-0.5">
            Conta Aethera, sessões persistentes, computadores Windows vinculados e preferências do estúdio.
          </p>
        </div>

        <div role="tablist" aria-label="Abas de configurações" className="flex flex-wrap items-center gap-1.5 bg-[#f4f4f6] p-1 rounded-full">
          {tabs.map((tab) => {
            const active = settingsTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => openSettingsTab(tab.id)}
                className={`h-9 px-4 rounded-full text-xs font-semibold transition-colors whitespace-nowrap ${
                  active
                    ? 'bg-[#111111] text-white'
                    : 'text-[#62626c] hover:text-[#111111]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>
      </div>

      {settingsTab === 'computers' && <MyComputersSection />}

      {settingsTab === 'account' && <MyAccountSection />}

      {settingsTab === 'studio' && (
        <>
          {savedNotice && (
            <div className="rounded-2xl bg-[#f3fdd0] px-4 py-2.5 text-xs font-semibold text-[#111111]">
              {savedNotice}
            </div>
          )}

          <section className="rounded-[28px] bg-white p-6 shadow-2xs space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="pref-tts" className="block text-xs font-semibold text-[#111111] mb-1.5">
                  Provedor TTS padrão
                </label>
                <select
                  id="pref-tts"
                  value={preferences.defaultTtsProvider}
                  onChange={(e) => {
                    void updatePreferences({
                      defaultTtsProvider: e.target.value as ProductionProject['ttsProvider'],
                    });
                    setSavedNotice('Preferência de narração salva no SQLite.');
                  }}
                  className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs font-medium text-[#111111]"
                >
                  <option value="voicestudio">VoiceStudio Local</option>
                  <option value="elevenlabs">ElevenLabs Neural</option>
                  <option value="webspeech">Web Speech API</option>
                </select>
              </div>

              <div>
                <label htmlFor="pref-quality" className="block text-xs font-semibold text-[#111111] mb-1.5">
                  Qualidade padrão de prévia
                </label>
                <select
                  id="pref-quality"
                  value={preferences.defaultQuality}
                  onChange={(e) => {
                    void updatePreferences({
                      defaultQuality: e.target.value as ProductionProject['qualityPreset'],
                    });
                    setSavedNotice('Qualidade padrão salva no SQLite.');
                  }}
                  className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs font-medium text-[#111111]"
                >
                  <option value="review_720p">Review 720p</option>
                  <option value="master_1080p">Master 1080p</option>
                  <option value="cinema_4k">Cinema 4K</option>
                </select>
              </div>
            </div>

            <div className="pt-4 border-t border-[#e3e3e8] flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-[#111111]">Restaurar dados iniciais do banco SQLite</div>
                <p className="text-xs text-[#62626c]">
                  Recarrega os projetos iniciais, canais, Brand Kits e agenda padrão em{' '}
                  <code className="font-mono">{capabilities.dbPath}</code> (preserva sua conta e seus computadores vinculados).
                </p>
              </div>
              <button
                type="button"
                onClick={async () => {
                  await resetWorkspace();
                  setSavedNotice('Banco SQLite restaurado para o estado inicial.');
                }}
                className="h-10 px-4 rounded-full bg-[#f4f4f6] hover:bg-[#fde7f3] text-[#111111] text-xs font-semibold inline-flex items-center gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Restaurar Workspace</span>
              </button>
            </div>
          </section>

          {/* Honest Runtime & Monorepo Capabilities Audit */}
          <section className="rounded-[28px] bg-white p-6 shadow-2xs space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold text-[#111111] inline-flex items-center gap-2">
                <Server className="w-4 h-4 text-[#6a46d8]" />
                <span>Diagnóstico Real do Backend &amp; Coexistência Monorepo</span>
              </h2>
              <span className="text-xs font-mono text-[#62626c]">Node {capabilities.nodeVersion}</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {capabilities.items.map((item) => (
                <div key={item.id} className="rounded-2xl bg-[#f4f4f6] p-3.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#111111]">{item.label}</span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                        item.status === 'funcional'
                          ? 'bg-[#d8fb4f] text-[#111111]'
                          : item.status === 'parcial'
                            ? 'bg-[#fff4dc] text-[#9a6200]'
                            : 'bg-[#fde7f3] text-[#b42840]'
                      }`}
                    >
                      {item.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-[#62626c]">{item.detail}</p>
                </div>
              ))}
            </div>

            {capabilities.missingWorkspacePackages.length > 0 && (
              <div className="rounded-2xl bg-[#efe9fd] p-4 text-xs text-[#2a1d5c] space-y-1">
                <div className="font-bold">Integridade do Monorepo Desktop (apps/* intactos):</div>
                <p>
                  Presentes em <code className="font-mono">/packages</code>:{' '}
                  <code className="font-mono">{capabilities.presentWorkspacePackages.join(', ') || 'nenhum'}</code>.
                </p>
                <p>
                  Ausentes neste repositório importado (impedem build Electron local sem restaurá-los):{' '}
                  <code className="font-mono">{capabilities.missingWorkspacePackages.join(', ')}</code>.
                </p>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
