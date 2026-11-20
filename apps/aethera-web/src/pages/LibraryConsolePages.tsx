import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  DownloadCloud,
  FileText,
  Film,
  Image as ImageIcon,
  Music,
  Plus,
  RotateCcw,
  Search,
  Server,
  Trash2,
} from 'lucide-react';
import type { ConsoleLogEntry, MediaAsset, ProductionProject } from '../domain/types';
import { useStudio } from '../store/studio-store';

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

type LogFilter = 'all' | ConsoleLogEntry['scope'];

export function ConsolePage() {
  const { consoleLogs, sseConnected, clearLogs } = useStudio();
  const [scope, setScope] = useState<LogFilter>('all');

  const visibleLogs = useMemo(
    () => (scope === 'all' ? consoleLogs : consoleLogs.filter((l) => l.scope === scope)),
    [consoleLogs, scope],
  );

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] bg-white px-6 py-5 flex flex-wrap items-center justify-between gap-3 shadow-2xs">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">Console Geral</h1>
          <p className="text-xs text-[#62626c]">
            Stream em tempo real ({sseConnected ? 'SSE conectado' : 'reconectando'}) de pipeline, FFmpeg, agentes, mídia e publicação.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(['all', 'pipeline', 'render', 'agents', 'publishing', 'creative', 'review', 'editor', 'media', 'calendar'] as const).map(
            (sc) => (
              <button
                key={sc}
                type="button"
                onClick={() => setScope(sc)}
                className={`h-8 px-3 rounded-full text-xs font-semibold ${
                  scope === sc ? 'bg-[#111111] text-white' : 'bg-[#f4f4f6] text-[#111111]'
                }`}
              >
                {sc === 'all' ? 'Todos' : sc}
              </button>
            ),
          )}
          <button
            type="button"
            onClick={() => void clearLogs()}
            className="h-8 px-3 rounded-full bg-[#fde7f3] text-[#111111] text-xs font-semibold inline-flex items-center gap-1"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Limpar</span>
          </button>
        </div>
      </div>

      <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-2">
        {visibleLogs.length === 0 ? (
          <p className="text-xs text-[#62626c] py-6 text-center">Nenhum evento registrado neste filtro.</p>
        ) : (
          visibleLogs.map((log) => (
            <div
              key={log.id}
              className="rounded-2xl bg-[#f4f4f6] px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-xs"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="font-mono text-[11px] text-[#62626c] shrink-0">{log.timestamp}</span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase shrink-0 ${
                    log.level === 'success'
                      ? 'bg-[#d8fb4f] text-[#111111]'
                      : log.level === 'warn'
                        ? 'bg-[#f9a8d4] text-[#111111]'
                        : 'bg-[#efe9fd] text-[#6a46d8]'
                  }`}
                >
                  {log.scope}
                </span>
                <span className="text-[#111111]">{log.message}</span>
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}

export function SettingsPage() {
  const { preferences, capabilities, updatePreferences, resetWorkspace } = useStudio();
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="rounded-[28px] bg-white px-6 py-5 shadow-2xs">
        <h1 className="text-2xl font-bold tracking-tight text-[#111111]">Configurações do Estúdio</h1>
        <p className="text-xs text-[#62626c] mt-0.5">
          Preferências padrão, persistência SQLite e diagnóstico real do ambiente Web × Desktop no monorepo.
        </p>
      </div>

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
              <code className="font-mono">{capabilities.dbPath}</code>.
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
    </div>
  );
}
