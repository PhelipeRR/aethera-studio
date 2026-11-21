import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  Film,
  Image as ImageIcon,
  ListOrdered,
  Plus,
  Radio,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Tag,
  Trash2,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router';

type CalendarPlatform = 'youtube' | 'youtube_shorts' | 'instagram' | 'tiktok';

interface ChapterItemView {
  id: string;
  index: number;
  title: string;
  category: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  timestampText: string;
  sourceChapterNumber?: number;
  thumbnailUrl?: string;
}

interface CalendarEventSummary {
  id: string;
  publicationId?: string;
  title: string;
  description: string;
  platform: CalendarPlatform;
  platforms?: CalendarPlatform[];
  platformTargets?: Partial<
    Record<
      CalendarPlatform,
      {
        platform: CalendarPlatform;
        status: string;
        title?: string;
        remoteId?: string;
        lastError?: string;
      }
    >
  >;
  scheduledPublishAtIso?: string;
  plannedDateIso: string;
  timezone: string;
  status: string;
  reviewApproved: boolean;
  productionMode?: string;
  thumbnailUrl?: string;
}

interface PublishingStudioBridge {
  cinemaCalendarSnapshot?: (input?: { timezone?: string }) => Promise<{ events: CalendarEventSummary[] }>;
  cinemaPublishingSchedule?: (input: Record<string, unknown>) => Promise<{ event: CalendarEventSummary; calendar: { events: CalendarEventSummary[] } }>;
  cinemaPublishingReschedule?: (input: { publicationId: string; targetDateIso: string; reason?: string }) => Promise<{ event: CalendarEventSummary; calendar: { events: CalendarEventSummary[] } }>;
  cinemaPublishingCancel?: (input: { publicationId?: string; platform?: CalendarPlatform; reason?: string; confirmIrreversible?: boolean }) => Promise<{ event?: CalendarEventSummary; calendar: { events: CalendarEventSummary[] } }>;
  cinemaPublishingGenerateChapters?: (input: Record<string, unknown>) => Promise<{
    chapters: ChapterItemView[];
    validation: { valid: boolean; errors: string[] };
    updatedDescription?: string;
  }>;
  cinemaPublishingReferenceScenario?: () => Promise<{ event: CalendarEventSummary; calendar: { events: CalendarEventSummary[] } }>;
}

function getPublishingBridge(): PublishingStudioBridge {
  const w = window as unknown as {
    aetheraBridge?: PublishingStudioBridge;
    aethera?: PublishingStudioBridge;
    neuralbridge?: PublishingStudioBridge;
  };
  return (w.aetheraBridge ?? w.aethera ?? w.neuralbridge ?? {}) as PublishingStudioBridge;
}

const PLATFORM_META: Record<CalendarPlatform, { label: string; aspect: '16:9' | '9:16' }> = {
  youtube: { label: 'YouTube (Long-Form)', aspect: '16:9' },
  youtube_shorts: { label: 'YouTube Shorts', aspect: '9:16' },
  instagram: { label: 'Instagram Reels', aspect: '9:16' },
  tiktok: { label: 'TikTok', aspect: '9:16' },
};

const TAG_PRESETS: Record<string, string[]> = {
  'Mangá Recap': ['manga recap', 'manhwa recap', 'resumo de manhwa', 'recap em português', 'webtoon'],
  'Análise de Games': ['análise de jogos', 'gameplay comentado', 'games', 'review', 'história dos games'],
  'Documentário': ['documentário', 'curiosidades', 'explicação completa', 'cinema'],
};

export function YouTubeLongFormPublishingStudio({
  youtubeConnected,
  channelId,
  channelName,
}: {
  youtubeConnected: boolean;
  channelId: string;
  channelName: string;
}) {
  const [events, setEvents] = useState<CalendarEventSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  // Unified multi-platform publication form
  const [productionMode, setProductionMode] = useState<'manga_recap' | 'ai_cinema' | 'manual_project' | 'media_library'>('manga_recap');
  const [selectedPlatforms, setSelectedPlatforms] = useState<CalendarPlatform[]>(['youtube', 'instagram', 'tiktok']);
  const [title, setTitle] = useState('Nano Machine — O Início de uma Lenda | Capítulos 1–5');
  const [savedTitleVersions, setSavedTitleVersions] = useState<string[]>([
    'Nano Machine — O Início de uma Lenda | Capítulos 1–5',
  ]);
  const [description, setDescription] = useState(
    'Resumo narrativo contínuo dos Capítulos 1 a 5 de Nano Machine, preservando personagens confirmados no Story Memory sem spoilers de capítulos futuros.\n\n⚖️ CRÉDITOS E FONTES:\n- Obra analisada: Nano Machine (Capítulos 1–5)\n- Produzido com Aethera Studio\n\n#NanoMachine #MangaRecap #ManhwaRecap',
  );
  const [tags, setTags] = useState<string[]>(['Nano Machine', 'manga recap', 'manhwa recap', 'Cheon Yeo-Woon', 'resumo manhwa']);
  const [tagDraft, setTagDraft] = useState('');
  const [privacyStatus, setPrivacyStatus] = useState<'private' | 'unlisted' | 'public'>('private');
  const [localDayKey, setLocalDayKey] = useState('2026-11-25');
  const [localTimeHHmm, setLocalTimeHHmm] = useState('18:00');
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [videoDurationSec, setVideoDurationSec] = useState(2100); // 35 min default long-form
  const [thumbnailApproved, setThumbnailApproved] = useState(false);
  const [thumbnailUrl, setThumbnailUrl] = useState('');

  // Mandatory Quality Gates + Rights Verification
  const [reviewApproved, setReviewApproved] = useState(true);
  const [rightsSourceAuthorized, setRightsSourceAuthorized] = useState(true);
  const [rightsMusicLicensed, setRightsMusicLicensed] = useState(true);
  const [rightsNoWatermarks, setRightsNoWatermarks] = useState(true);
  const [rightsTransformative, setRightsTransformative] = useState(true);

  // YouTube Chapters visual editor
  const [chapters, setChapters] = useState<ChapterItemView[]>([
    { id: 'ch-0', index: 1, title: 'Introdução', category: 'intro', startMs: 0, endMs: 35_000, durationMs: 35_000, timestampText: '00:00' },
    { id: 'ch-1', index: 2, title: 'Capítulo 1 — O começo', category: 'manga_chapter', startMs: 35_000, endMs: 500_000, durationMs: 465_000, timestampText: '00:35', sourceChapterNumber: 1 },
    { id: 'ch-2', index: 3, title: 'Capítulo 2 — A academia demoníaca', category: 'manga_chapter', startMs: 500_000, endMs: 1_005_000, durationMs: 505_000, timestampText: '08:20', sourceChapterNumber: 2 },
    { id: 'ch-3', index: 4, title: 'Capítulo 3 — O despertar da Nano Machine', category: 'manga_chapter', startMs: 1_005_000, endMs: 1_510_000, durationMs: 505_000, timestampText: '16:45', sourceChapterNumber: 3 },
    { id: 'ch-4', index: 5, title: 'Capítulo 4 — Primeiro teste', category: 'manga_chapter', startMs: 1_510_000, endMs: 2_010_000, durationMs: 500_000, timestampText: '25:10', sourceChapterNumber: 4 },
    { id: 'ch-5', index: 6, title: 'Capítulo 5 — A virada', category: 'manga_chapter', startMs: 2_010_000, endMs: 2_100_000, durationMs: 90_000, timestampText: '33:30', sourceChapterNumber: 5 },
  ]);
  const [chapterErrors, setChapterErrors] = useState<string[]>([]);
  const [newChapterTitle, setNewChapterTitle] = useState('');
  const [newChapterSec, setNewChapterSec] = useState(60);

  const loadCalendarEvents = useCallback(async () => {
    const bridge = getPublishingBridge();
    if (!bridge.cinemaCalendarSnapshot) return;
    setLoading(true);
    try {
      const snap = await bridge.cinemaCalendarSnapshot({ timezone });
      setEvents(snap?.events ?? []);
    } finally {
      setLoading(false);
    }
  }, [timezone]);

  useEffect(() => {
    void loadCalendarEvents();
  }, [loadCalendarEvents]);

  const totalTagsChars = useMemo(
    () => tags.reduce((acc, t, idx) => acc + t.length + (idx > 0 ? 1 : 0), 0),
    [tags],
  );
  const rightsVerified =
    rightsSourceAuthorized && rightsMusicLicensed && rightsNoWatermarks && rightsTransformative;
  const readyToSchedule =
    reviewApproved &&
    rightsVerified &&
    title.trim().length > 0 &&
    title.length <= 100 &&
    totalTagsChars <= 500 &&
    selectedPlatforms.length > 0 &&
    chapterErrors.length === 0;

  const togglePlatform = (p: CalendarPlatform) => {
    setSelectedPlatforms((prev) =>
      prev.includes(p) ? (prev.length > 1 ? prev.filter((x) => x !== p) : prev) : [...prev, p],
    );
  };

  const handleAddTag = () => {
    const cleaned = tagDraft.trim().replace(/^#+/, '');
    if (!cleaned) return;
    if (tags.some((t) => t.toLowerCase() === cleaned.toLowerCase())) {
      setTagDraft('');
      return;
    }
    setTags((prev) => [...prev, cleaned]);
    setTagDraft('');
  };

  const handleChapterAction = async (
    action:
      | { type: 'edit'; id: string; title?: string; startMs?: number }
      | { type: 'delete'; id: string }
      | { type: 'add'; title: string; startMs: number },
  ) => {
    const bridge = getPublishingBridge();
    if (!bridge.cinemaPublishingGenerateChapters) return;
    const res = await bridge.cinemaPublishingGenerateChapters({
      mode: 'edit',
      chapters,
      action,
      totalVideoDurationMs: videoDurationSec * 1000,
      baseDescription: description,
    });
    setChapters(res.chapters);
    setChapterErrors(res.validation.errors);
    if (res.updatedDescription !== undefined) {
      setDescription(res.updatedDescription);
    }
  };

  const handleScheduleUnified = async (asDraft = false) => {
    const bridge = getPublishingBridge();
    if (!bridge.cinemaPublishingSchedule) {
      setNotice({ kind: 'error', text: 'Bridge IPC de publicação indisponível neste ambiente.' });
      return;
    }
    setNotice(null);
    try {
      const res = await bridge.cinemaPublishingSchedule({
        title: title.trim(),
        description,
        channelId: channelId || 'main_yt',
        channelName: channelName || 'Canal Principal',
        productionMode,
        format: selectedPlatforms.includes('youtube') ? 'long' : 'short',
        platforms: selectedPlatforms,
        localDayKey,
        localTimeHHmm,
        timezone,
        status: asDraft ? 'draft' : 'scheduled',
        reviewApproved,
        videoDurationMs: videoDurationSec * 1000,
        ...(thumbnailUrl.trim() ? { thumbnailUrl: thumbnailUrl.trim() } : {}),
        qualityGates: { gateF: 'pass', gateG: 'pass', gateH: 'pass', allMandatoryPassed: true },
        rightsVerification: {
          verified: rightsVerified,
          verifiedAtIso: new Date().toISOString(),
          sourceAuthorized: rightsSourceAuthorized,
          musicAndSfxLicensed: rightsMusicLicensed,
          noProhibitedWatermarks: rightsNoWatermarks,
          transformativeEditorialUse: rightsTransformative,
        },
        youtubeStudio: {
          tags,
          savedTitleVersions,
          chapters,
          thumbnailApproved,
          privacyStatus,
        },
      });
      setEvents(res.calendar.events);
      setNotice({
        kind: 'ok',
        text: asDraft
          ? `Rascunho "${res.event.title}" salvo e sincronizado com o Calendário (ID: ${res.event.id}).`
          : `Publicação "${res.event.title}" agendada para ${localDayKey} às ${localTimeHHmm} (${timezone}) em ${selectedPlatforms.join(', ')} e sincronizada com o Calendário!`,
      });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleLoadReferenceScenario = async () => {
    const bridge = getPublishingBridge();
    if (!bridge.cinemaPublishingReferenceScenario) return;
    const res = await bridge.cinemaPublishingReferenceScenario();
    setEvents(res.calendar.events);
    setNotice({
      kind: 'ok',
      text: `Cenário de referência criado: 25/11/2026 18:00 America/Sao_Paulo (UTC: ${res.event.scheduledPublishAtIso}) — YouTube, Instagram e TikTok sincronizados no Calendário.`,
    });
  };

  const handleCancelEvent = async (ev: CalendarEventSummary, platform?: CalendarPlatform) => {
    const bridge = getPublishingBridge();
    if (!bridge.cinemaPublishingCancel) return;
    const needsConfirm = ev.status === 'published';
    if (needsConfirm && !window.confirm('Esta publicação já foi enviada. Confirma a alteração irreversível?')) {
      return;
    }
    try {
      const res = await bridge.cinemaPublishingCancel({
        publicationId: ev.publicationId ?? ev.id,
        ...(platform ? { platform } : {}),
        confirmIrreversible: needsConfirm,
      });
      setEvents(res.calendar.events);
      setNotice({
        kind: 'ok',
        text: platform
          ? `Destino ${platform} cancelado em "${ev.title}" (Calendário e Publicação sincronizados).`
          : `Agendamento "${ev.title}" cancelado em ambas as telas.`,
      });
    } catch (err) {
      setNotice({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className="space-y-4">
      {/* Header strip */}
      <div className="rounded-[28px] bg-white p-5 border border-[#e3e3e8] shadow-2xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#6a46d8]">
            Aethera Social Publishing Hub · YouTube Long-Form Studio
          </span>
          <h2 className="text-lg font-bold text-[#111111] mt-0.5">
            Agendamento Multiplataforma &amp; Sincronização Bidirecional com o Calendário
          </h2>
          <p className="text-xs text-[#62626c] mt-0.5">
            Compartilhado entre Projeto Manual, Produção com IA, Mangá Recap e Biblioteca — mesmo backend e identificadores únicos do Calendário.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold inline-flex items-center gap-1.5 ${
              youtubeConnected ? 'bg-[#f3fdd0] text-[#111111]' : 'bg-[#fff4dc] text-[#704700]'
            }`}
          >
            <Radio className="w-3.5 h-3.5" />
            {youtubeConnected ? 'YouTube OAuth Conectado' : 'YouTube OAuth Pendente'}
          </span>
          <button
            type="button"
            onClick={() => void handleLoadReferenceScenario()}
            className="h-9 px-3.5 rounded-full bg-[#efe9fd] text-[#2a1d5c] text-xs font-semibold hover:bg-[#e1d5fb]"
          >
            Cenário 25/11/2026 18:00
          </button>
          <Link
            to="/aethera/calendar"
            className="h-9 px-3.5 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-[#24242c]"
          >
            <CalendarIcon className="w-3.5 h-3.5 text-[#d8fb4f]" />
            Abrir no Calendário
          </Link>
        </div>
      </div>

      {notice && (
        <div
          className={`rounded-2xl px-4 py-3 text-xs font-semibold flex items-center gap-2 ${
            notice.kind === 'ok' ? 'bg-[#f3fdd0] text-[#111111]' : 'bg-[#fde7f3] text-[#b42840]'
          }`}
        >
          {notice.kind === 'ok' ? <CheckCircle2 className="w-4 h-4 text-[#2f7d32]" /> : <AlertTriangle className="w-4 h-4" />}
          <span>{notice.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* Left: YouTube Long-Form & Multi-Platform Editor */}
        <section className="xl:col-span-7 rounded-[28px] bg-white p-5 border border-[#e3e3e8] shadow-2xs space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-bold text-[#111111] flex items-center gap-2">
              <Film className="w-4 h-4 text-[#6a46d8]" />
              Editor de Publicação Multiplataforma
            </h3>
            <select
              value={productionMode}
              onChange={(e) => setProductionMode(e.target.value as typeof productionMode)}
              className="h-8 rounded-full bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs font-semibold text-[#111111]"
            >
              <option value="manga_recap">Origem: Mangá Recap</option>
              <option value="ai_cinema">Origem: Produção com IA</option>
              <option value="manual_project">Origem: Projeto Manual</option>
              <option value="media_library">Origem: Biblioteca</option>
            </select>
          </div>

          {/* Multi-Platform Selector */}
          <div>
            <span className="block text-xs font-semibold text-[#111111] mb-1.5">
              Destinos neste agendamento (falha isolada por plataforma)
            </span>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PLATFORM_META) as CalendarPlatform[]).map((p) => {
                const active = selectedPlatforms.includes(p);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => togglePlatform(p)}
                    className={`h-8 px-3 rounded-full text-xs font-semibold border transition ${
                      active
                        ? 'bg-[#111111] text-white border-[#111111]'
                        : 'bg-[#f4f4f6] text-[#62626c] border-[#e3e3e8] hover:text-[#111111]'
                    }`}
                  >
                    {PLATFORM_META[p].label} · {PLATFORM_META[p].aspect}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Title + Version history */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="pub-title" className="text-xs font-semibold text-[#111111]">
                Título (YouTube API máx. 100 caracteres)
              </label>
              <span className={`text-[11px] font-mono ${title.length > 100 ? 'text-[#b42840] font-bold' : 'text-[#62626c]'}`}>
                {title.length}/100
              </span>
            </div>
            <div className="flex gap-2">
              <input
                id="pub-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="flex-1 h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3.5 text-xs text-[#111111]"
              />
              <button
                type="button"
                onClick={() => {
                  if (title.trim() && !savedTitleVersions.includes(title.trim())) {
                    setSavedTitleVersions((prev) => [...prev, title.trim()]);
                  }
                }}
                className="h-10 px-3 rounded-2xl bg-[#efe9fd] text-[#2a1d5c] text-xs font-semibold"
              >
                Salvar versão
              </button>
            </div>
          </div>

          {/* Description */}
          <div>
            <label htmlFor="pub-desc" className="block text-xs font-semibold text-[#111111] mb-1">
              Descrição estruturada (com capítulos, créditos, links e hashtags)
            </label>
            <textarea
              id="pub-desc"
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] p-3 text-xs text-[#111111] font-mono"
            />
          </div>

          {/* Tags (separated from hashtags) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-[#111111] flex items-center gap-1.5">
                <Tag className="w-3.5 h-3.5 text-[#6a46d8]" />
                Tags do YouTube (separadas de #hashtags)
              </span>
              <span className={`text-[11px] font-mono ${totalTagsChars > 500 ? 'text-[#b42840] font-bold' : 'text-[#62626c]'}`}>
                {totalTagsChars}/500 chars
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <span key={t} className="inline-flex items-center gap-1 rounded-full bg-[#f4f4f6] px-2.5 py-1 text-[11px] font-medium text-[#111111]">
                  {t}
                  <button
                    type="button"
                    onClick={() => setTags((prev) => prev.filter((x) => x !== t))}
                    className="text-[#62626c] hover:text-[#b42840]"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                value={tagDraft}
                onChange={(e) => setTagDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddTag();
                  }
                }}
                placeholder="Adicionar tag..."
                className="flex-1 min-w-[160px] h-9 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs text-[#111111]"
              />
              <button
                type="button"
                onClick={handleAddTag}
                className="h-9 px-3 rounded-2xl bg-[#111111] text-white text-xs font-semibold"
              >
                Adicionar
              </button>
              {Object.entries(TAG_PRESETS).map(([presetName, presetTags]) => (
                <button
                  key={presetName}
                  type="button"
                  onClick={() => setTags((prev) => [...new Set([...prev, ...presetTags])])}
                  className="h-9 px-2.5 rounded-2xl bg-[#efe9fd] text-[#2a1d5c] text-[11px] font-semibold"
                >
                  + {presetName}
                </button>
              ))}
            </div>
          </div>

          {/* Thumbnail & Thumbs & Artes integration */}
          <div className="rounded-2xl bg-[#f4f4f6] p-3.5 space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-[#111111] flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-[#6a46d8]" />
                Thumbnail (YouTube thumbnails.set · 16:9 · máx 2 MB)
              </span>
              <Link to="/aethera/creative" className="text-[11px] font-semibold text-[#6a46d8] underline">
                Abrir Thumbs &amp; Artes
              </Link>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={thumbnailUrl}
                onChange={(e) => {
                  if (thumbnailApproved && !window.confirm('Substituir uma thumbnail já aprovada?')) return;
                  setThumbnailUrl(e.target.value);
                  setThumbnailApproved(false);
                }}
                placeholder="Caminho local ou URL da thumbnail (PNG/JPG)..."
                className="flex-1 h-9 rounded-xl bg-white border border-[#e3e3e8] px-3 text-xs text-[#111111]"
              />
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#111111]">
                <input
                  type="checkbox"
                  checked={thumbnailApproved}
                  onChange={(e) => setThumbnailApproved(e.target.checked)}
                />
                Aprovada
              </label>
            </div>
          </div>

          {/* Capítulos do YouTube (Visual Editor) */}
          <div className="rounded-2xl border border-[#e3e3e8] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-[#111111] flex items-center gap-1.5">
                <ListOrdered className="w-3.5 h-3.5 text-[#6a46d8]" />
                Capítulos do YouTube (Timeline Real · {Math.floor(videoDurationSec / 60)}m{String(videoDurationSec % 60).padStart(2, '0')}s)
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${chapterErrors.length === 0 ? 'bg-[#f3fdd0] text-[#2f7d32]' : 'bg-[#fde7f3] text-[#b42840]'}`}>
                {chapterErrors.length === 0 ? `${chapters.length} capítulos válidos` : 'Ajuste necessário'}
              </span>
            </div>

            {chapterErrors.length > 0 && (
              <div className="rounded-xl bg-[#fde7f3] p-2.5 text-[11px] text-[#b42840] space-y-0.5">
                {chapterErrors.map((err, idx) => (
                  <div key={idx}>• {err}</div>
                ))}
              </div>
            )}

            <div className="space-y-1.5 max-h-52 overflow-y-auto">
              {chapters.map((ch) => (
                <div key={ch.id} className="flex items-center gap-2 rounded-xl bg-[#f4f4f6] px-3 py-2 text-xs">
                  <span className="font-mono font-bold text-[#6a46d8] w-12 shrink-0">{ch.timestampText}</span>
                  <input
                    value={ch.title}
                    onChange={(e) => void handleChapterAction({ type: 'edit', id: ch.id, title: e.target.value })}
                    className="flex-1 bg-white rounded-lg border border-[#e3e3e8] px-2 py-1 text-xs text-[#111111]"
                  />
                  <span className="font-mono text-[10px] text-[#62626c] shrink-0">
                    {Math.round(ch.durationMs / 1000)}s
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleChapterAction({ type: 'delete', id: ch.id })}
                    className="text-[#62626c] hover:text-[#b42840]"
                    title="Remover capítulo"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-2 pt-1">
              <input
                value={newChapterTitle}
                onChange={(e) => setNewChapterTitle(e.target.value)}
                placeholder="Novo capítulo..."
                className="flex-1 h-8 rounded-xl bg-[#f4f4f6] border border-[#e3e3e8] px-2.5 text-xs text-[#111111]"
              />
              <input
                type="number"
                min={0}
                max={videoDurationSec}
                value={newChapterSec}
                onChange={(e) => setNewChapterSec(Number(e.target.value) || 0)}
                className="w-20 h-8 rounded-xl bg-[#f4f4f6] border border-[#e3e3e8] px-2 text-xs font-mono text-[#111111]"
                title="Início em segundos"
              />
              <button
                type="button"
                onClick={() => {
                  if (!newChapterTitle.trim()) return;
                  void handleChapterAction({
                    type: 'add',
                    title: newChapterTitle.trim(),
                    startMs: newChapterSec * 1000,
                  });
                  setNewChapterTitle('');
                }}
                className="h-8 px-3 rounded-xl bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Capítulo
              </button>
            </div>
          </div>
        </section>

        {/* Right: Schedule, Rights Verification & Synchronized Calendar History */}
        <aside className="xl:col-span-5 space-y-4">
          {/* Date, Time, Privacy & Rights Guard */}
          <section className="rounded-[28px] bg-white p-5 border border-[#e3e3e8] shadow-2xs space-y-3.5">
            <h3 className="text-sm font-bold text-[#111111] flex items-center gap-2">
              <Clock className="w-4 h-4 text-[#6a46d8]" />
              Agendamento na Nuvem &amp; Verificação de Direitos
            </h3>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-[#62626c] mb-1">Data</label>
                <input
                  type="date"
                  value={localDayKey}
                  onChange={(e) => setLocalDayKey(e.target.value)}
                  className="w-full h-9 rounded-xl bg-[#f4f4f6] border border-[#e3e3e8] px-2.5 text-xs font-mono text-[#111111]"
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#62626c] mb-1">Horário</label>
                <input
                  type="time"
                  value={localTimeHHmm}
                  onChange={(e) => setLocalTimeHHmm(e.target.value)}
                  className="w-full h-9 rounded-xl bg-[#f4f4f6] border border-[#e3e3e8] px-2.5 text-xs font-mono text-[#111111]"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-[#62626c] mb-1">Fuso Horário</label>
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  className="w-full h-9 rounded-xl bg-[#f4f4f6] border border-[#e3e3e8] px-2.5 text-xs text-[#111111]"
                >
                  <option value="America/Sao_Paulo">America/Sao_Paulo</option>
                  <option value="America/New_York">America/New_York</option>
                  <option value="Europe/Lisbon">Europe/Lisbon</option>
                  <option value="UTC">UTC</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-[#62626c] mb-1">Privacidade YouTube</label>
                <select
                  value={privacyStatus}
                  onChange={(e) => setPrivacyStatus(e.target.value as typeof privacyStatus)}
                  className="w-full h-9 rounded-xl bg-[#f4f4f6] border border-[#e3e3e8] px-2.5 text-xs text-[#111111]"
                >
                  <option value="private">Privado (Agendado publishAt)</option>
                  <option value="unlisted">Não listado</option>
                  <option value="public">Público</option>
                </select>
              </div>
            </div>

            {/* Rights & Quality Gates Verification */}
            <div className="rounded-2xl bg-[#f4f4f6] p-3 space-y-1.5 text-xs">
              <div className="font-bold text-[#111111] flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5 text-[#2f7d32]" />
                Direitos de Uso &amp; Aprovação Obrigatória
              </div>
              <label className="flex items-center gap-2 text-[#111111]">
                <input type="checkbox" checked={reviewApproved} onChange={(e) => setReviewApproved(e.target.checked)} />
                Vídeo aprovado na Revisão &amp; Gates obrigatórios (F/G/H)
              </label>
              <label className="flex items-center gap-2 text-[#111111]">
                <input type="checkbox" checked={rightsSourceAuthorized} onChange={(e) => setRightsSourceAuthorized(e.target.checked)} />
                Origem do material autorizada para uso editorial
              </label>
              <label className="flex items-center gap-2 text-[#111111]">
                <input type="checkbox" checked={rightsMusicLicensed} onChange={(e) => setRightsMusicLicensed(e.target.checked)} />
                Trilha sonora e SFX livres de copyright / licenciados
              </label>
              <label className="flex items-center gap-2 text-[#111111]">
                <input type="checkbox" checked={rightsNoWatermarks} onChange={(e) => setRightsNoWatermarks(e.target.checked)} />
                Sem marcas d&apos;água proibidas de terceiros
              </label>
              <label className="flex items-center gap-2 text-[#111111]">
                <input type="checkbox" checked={rightsTransformative} onChange={(e) => setRightsTransformative(e.target.checked)} />
                Conteúdo transformativo / resumo editorial verificado
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={!readyToSchedule}
                onClick={() => void handleScheduleUnified(false)}
                className="flex-1 h-10 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center justify-center gap-1.5 disabled:opacity-45"
              >
                <Sparkles className="w-3.5 h-3.5 text-[#d8fb4f]" />
                Agendar no Calendário
              </button>
              <button
                type="button"
                onClick={() => void handleScheduleUnified(true)}
                className="h-10 px-4 rounded-full bg-[#f4f4f6] text-[#111111] text-xs font-semibold hover:bg-[#e8e8ee]"
              >
                Salvar Rascunho
              </button>
            </div>
          </section>

          {/* Synchronized Calendar & Publication History */}
          <section className="rounded-[28px] bg-white p-5 border border-[#e3e3e8] shadow-2xs space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#111111]">
                Publicações Sincronizadas ({events.length})
              </h3>
              <button
                type="button"
                onClick={() => void loadCalendarEvents()}
                className="p-1.5 rounded-lg bg-[#f4f4f6] text-[#62626c] hover:text-[#111111]"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
            {events.length === 0 ? (
              <p className="text-xs text-[#62626c]">
                Nenhum agendamento ainda. Use o formulário acima ou carregue o cenário de referência 25/11/2026 18:00.
              </p>
            ) : (
              <div className="space-y-2 max-h-80 overflow-y-auto">
                {events.map((ev) => {
                  const evPlatforms = ev.platforms && ev.platforms.length > 0 ? ev.platforms : [ev.platform];
                  return (
                    <div key={ev.id} className="rounded-2xl bg-[#f4f4f6] p-3 space-y-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-bold text-[#111111] truncate">{ev.title}</div>
                          <div className="text-[11px] font-mono text-[#6a46d8]">
                            {ev.scheduledPublishAtIso ?? ev.plannedDateIso} ({ev.timezone})
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => void handleCancelEvent(ev)}
                          title="Cancelar agendamento"
                          className="p-1 rounded-lg bg-white text-[#62626c] hover:text-[#b42840]"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {evPlatforms.map((p) => {
                          const targetStatus = ev.platformTargets?.[p]?.status ?? ev.status;
                          return (
                            <span
                              key={p}
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                                targetStatus === 'published'
                                  ? 'bg-[#f3fdd0] text-[#2f7d32]'
                                  : targetStatus === 'failed'
                                    ? 'bg-[#fde7f3] text-[#b42840]'
                                    : targetStatus === 'cancelled'
                                      ? 'bg-zinc-200 text-zinc-600'
                                      : 'bg-white text-[#111111]'
                              }`}
                            >
                              {p}: {targetStatus}
                            </span>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </aside>
      </div>
    </div>
  );
}
