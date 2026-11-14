import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Film,
  Filter,
  Globe,
  History,
  Layers,
  Plus,
  Repeat,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '@/app/PageHeader';

type CalendarViewMode = 'month' | 'week' | 'agenda';
type CalendarEventStatus =
  | 'draft'
  | 'scripting'
  | 'producing'
  | 'in_review'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'failed';
type CalendarPlatform = 'youtube' | 'youtube_shorts' | 'instagram' | 'tiktok';
type CalendarFormat =
  | 'long'
  | 'short'
  | 'top10'
  | 'news'
  | 'analysis'
  | 'nostalgia'
  | 'curiosities'
  | 'documentary';

interface RescheduleHistoryEntry {
  fromIso: string;
  toIso: string;
  targetKind: 'planned' | 'scheduled';
  changedAt: string;
  reason?: string;
}

interface EditorialCalendarEventView {
  id: string;
  title: string;
  description: string;
  channelId: string;
  channelName: string;
  platform: CalendarPlatform;
  format: CalendarFormat;
  projectId?: string;
  thumbnailUrl?: string;
  plannedDateIso: string;
  scheduledPublishAtIso?: string;
  timezone: string;
  status: CalendarEventStatus;
  reviewApproved: boolean;
  reviewApprovedAt?: string;
  integrationError?: string;
  seriesId?: string;
  productionLeadDays?: number;
  metrics?: { views?: number; ctr?: number; avgViewDurationSec?: number };
  rescheduleHistory: RescheduleHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

interface RecurringSeriesView {
  id: string;
  name: string;
  channelId: string;
  channelName: string;
  platform: CalendarPlatform;
  format: CalendarFormat;
  weekday: number;
  timeHHmm: string;
  timezone: string;
  leadDaysForProduction: number;
  promptTemplate: string;
  active: boolean;
}

interface SmartSuggestionView {
  id: string;
  suggestedDateIso: string;
  timezone: string;
  channelId: string;
  channelName: string;
  platform: CalendarPlatform;
  format: CalendarFormat;
  suggestedTitle: string;
  rationale: string;
  confidence: number;
  productionStartIso: string;
}

interface CalendarHealthView {
  conflictEventIds: string[];
  delayedEventIds: string[];
  unapprovedNearPublishIds: string[];
  integrationFailureIds: string[];
  contentGaps: Array<{ startDayKey: string; endDayKey: string; daysCount: number }>;
}

interface CalendarPayloadView {
  schemaVersion: 1;
  defaultTimezone: string;
  events: EditorialCalendarEventView[];
  series: RecurringSeriesView[];
  health: CalendarHealthView;
  suggestions: SmartSuggestionView[];
  projects: Array<{ projectId: string; title: string; durationSec: number; updatedAt: string }>;
}

interface CalendarBridge {
  cinemaCalendarSnapshot?: (input?: { timezone?: string }) => Promise<CalendarPayloadView>;
  cinemaCalendarUpsertEvent?: (input: Record<string, unknown>) => Promise<{ event: EditorialCalendarEventView; calendar: CalendarPayloadView }>;
  cinemaCalendarMoveEvent?: (input: {
    id: string;
    targetDateIso: string;
    targetKind?: 'planned' | 'scheduled';
    reason?: string;
  }) => Promise<{ event: EditorialCalendarEventView; calendar: CalendarPayloadView }>;
  cinemaCalendarDeleteEvent?: (input: { id: string }) => Promise<{ deleted: boolean; calendar: CalendarPayloadView }>;
  cinemaCalendarSchedulePlatform?: (input: { id: string; publishAtIso: string }) => Promise<{ event: EditorialCalendarEventView; calendar: CalendarPayloadView }>;
  cinemaCalendarUpsertSeries?: (input: Record<string, unknown>) => Promise<{ series: RecurringSeriesView; calendar: CalendarPayloadView }>;
  cinemaCalendarGenerateSeries?: (input: { seriesId: string; weeksAhead?: number }) => Promise<{ created: EditorialCalendarEventView[]; calendar: CalendarPayloadView }>;
}

const STATUS_META: Record<CalendarEventStatus, { label: string; dot: string; badge: string }> = {
  draft: { label: 'Rascunho', dot: 'bg-slate-400', badge: 'border-slate-500/40 bg-slate-500/15 text-slate-200' },
  scripting: { label: 'Roteiro', dot: 'bg-indigo-400', badge: 'border-indigo-500/40 bg-indigo-500/15 text-indigo-200' },
  producing: { label: 'Produção', dot: 'bg-amber-400', badge: 'border-amber-500/40 bg-amber-500/15 text-amber-200' },
  in_review: { label: 'Revisão', dot: 'bg-orange-400', badge: 'border-orange-500/40 bg-orange-500/15 text-orange-200' },
  approved: { label: 'Aprovado', dot: 'bg-emerald-400', badge: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200' },
  scheduled: { label: 'Agendado', dot: 'bg-violet-400', badge: 'border-violet-500/40 bg-violet-500/15 text-violet-200' },
  published: { label: 'Publicado', dot: 'bg-teal-400', badge: 'border-teal-500/40 bg-teal-500/15 text-teal-200' },
  failed: { label: 'Falha', dot: 'bg-rose-500', badge: 'border-rose-500/40 bg-rose-500/15 text-rose-200' },
};

const PLATFORM_LABELS: Record<CalendarPlatform, string> = {
  youtube: 'YouTube',
  youtube_shorts: 'YouTube Shorts',
  instagram: 'Instagram',
  tiktok: 'TikTok',
};

const FORMAT_LABELS: Record<CalendarFormat, string> = {
  long: 'Longo',
  short: 'Short',
  top10: 'TOP 10',
  news: 'Notícias',
  analysis: 'Análise',
  nostalgia: 'Nostalgia',
  curiosities: 'Curiosidades',
  documentary: 'Documentário',
};

const TIMEZONE_OPTIONS = [
  'America/Sao_Paulo',
  'America/New_York',
  'Europe/Lisbon',
  'UTC',
];

const WEEKDAYS_SHORT = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
const WEEKDAYS_FULL = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function getBridge(): CalendarBridge {
  return ((window as unknown as { aethera?: CalendarBridge; neuralbridge?: CalendarBridge }).aethera ??
    (window as unknown as { neuralbridge?: CalendarBridge }).neuralbridge ??
    {}) as CalendarBridge;
}

function formatDayAndTime(iso: string, tz: string): { dayKey: string; timeHHmm: string } {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return { dayKey: '1970-01-01', timeHHmm: '18:00' };
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  const hh = get('hour') === '24' ? '00' : get('hour');
  return { dayKey: `${get('year')}-${get('month')}-${get('day')}`, timeHHmm: `${hh}:${get('minute')}` };
}

function buildIsoFromLocal(dayKey: string, timeHHmm: string, tz: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const [hh, mm] = timeHHmm.split(':').map(Number);
  const approx = new Date(Date.UTC(y || 2026, (m || 1) - 1, d || 1, hh || 18, mm || 0, 0));
  const utcDate = new Date(approx.toLocaleString('en-US', { timeZone: 'UTC' }));
  const tzDate = new Date(approx.toLocaleString('en-US', { timeZone: tz }));
  const offsetMin = Math.round((tzDate.getTime() - utcDate.getTime()) / 60_000);
  return new Date(approx.getTime() - offsetMin * 60_000).toISOString();
}

function getMondayOfWeek(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

function toDayKeyLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function ContentCalendarPage() {
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');
  const [cursorDate, setCursorDate] = useState(() => new Date());
  const [timezone, setTimezone] = useState('America/Sao_Paulo');
  const [payload, setPayload] = useState<CalendarPayloadView | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusBanner, setStatusBanner] = useState<{ kind: 'info' | 'error'; text: string } | null>(null);

  // Filters
  const [searchText, setSearchText] = useState('');
  const [channelFilter, setChannelFilter] = useState('all');
  const [platformFilter, setPlatformFilter] = useState<'all' | CalendarPlatform>('all');
  const [formatFilter, setFormatFilter] = useState<'all' | CalendarFormat>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | CalendarEventStatus>('all');
  const [projectFilter, setProjectFilter] = useState('all');

  // Selection, Drag-and-Drop & Modals
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [draggedEventId, setDraggedEventId] = useState<string | null>(null);
  const [pendingMove, setPendingMove] = useState<{
    event: EditorialCalendarEventView;
    targetDayKey: string;
    targetTimeHHmm: string;
    targetIso: string;
    hasConflictWarning: boolean;
    reason: string;
  } | null>(null);

  const [createDraft, setCreateDraft] = useState<{
    dayKey: string;
    timeHHmm: string;
    title: string;
    description: string;
    channelId: string;
    channelName: string;
    platform: CalendarPlatform;
    format: CalendarFormat;
    projectId: string;
    status: CalendarEventStatus;
  } | null>(null);

  const [showSeriesModal, setShowSeriesModal] = useState(false);
  const [seriesForm, setSeriesForm] = useState({
    name: 'Notícias de Games',
    channelId: 'main_yt',
    channelName: 'Canal Principal',
    platform: 'youtube' as CalendarPlatform,
    format: 'news' as CalendarFormat,
    weekday: 5,
    timeHHmm: '18:00',
    leadDaysForProduction: 3,
    promptTemplate: 'Resumo semanal com as notícias mais impactantes do universo gamer.',
  });

  const [showAiPlannerModal, setShowAiPlannerModal] = useState(false);

  const loadSnapshot = useCallback(async (tzOverride?: string) => {
    const bridge = getBridge();
    if (!bridge.cinemaCalendarSnapshot) {
      setLoading(false);
      return;
    }
    try {
      const snap = await bridge.cinemaCalendarSnapshot({ timezone: tzOverride ?? timezone });
      setPayload(snap);
    } catch (err) {
      setStatusBanner({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [timezone]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  const events = useMemo(() => payload?.events ?? [], [payload]);
  const projects = useMemo(() => payload?.projects ?? [], [payload]);
  const health = payload?.health ?? {
    conflictEventIds: [],
    delayedEventIds: [],
    unapprovedNearPublishIds: [],
    integrationFailureIds: [],
    contentGaps: [],
  };

  const channels = useMemo(() => {
    const map = new Map<string, string>();
    map.set('main_yt', 'Canal Principal');
    map.set('shorts_yt', 'Canal Shorts / Cortes');
    for (const ev of events) map.set(ev.channelId, ev.channelName);
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [events]);

  const filteredEvents = useMemo(() => {
    return events.filter((ev) => {
      if (channelFilter !== 'all' && ev.channelId !== channelFilter) return false;
      if (platformFilter !== 'all' && ev.platform !== platformFilter) return false;
      if (formatFilter !== 'all' && ev.format !== formatFilter) return false;
      if (statusFilter !== 'all' && ev.status !== statusFilter) return false;
      if (projectFilter !== 'all' && (ev.projectId ?? '') !== projectFilter) return false;
      if (searchText.trim()) {
        const q = searchText.trim().toLowerCase();
        if (!ev.title.toLowerCase().includes(q) && !ev.description.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [events, channelFilter, platformFilter, formatFilter, statusFilter, projectFilter, searchText]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, EditorialCalendarEventView[]>();
    for (const ev of filteredEvents) {
      const effectiveIso = ev.scheduledPublishAtIso ?? ev.plannedDateIso;
      const { dayKey } = formatDayAndTime(effectiveIso, timezone);
      const list = map.get(dayKey) ?? [];
      list.push(ev);
      map.set(dayKey, list);
    }
    for (const [, list] of map) {
      list.sort((a, b) => (a.scheduledPublishAtIso ?? a.plannedDateIso).localeCompare(b.scheduledPublishAtIso ?? b.plannedDateIso));
    }
    return map;
  }, [filteredEvents, timezone]);

  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  // Navigation helpers
  const navigatePeriod = (dir: -1 | 1) => {
    setCursorDate((prev) => {
      const next = new Date(prev);
      if (viewMode === 'month') next.setMonth(next.getMonth() + dir);
      else next.setDate(next.getDate() + dir * 7);
      return next;
    });
  };

  const monthCells = useMemo(() => {
    const y = cursorDate.getFullYear();
    const m = cursorDate.getMonth();
    const firstOfMonth = new Date(y, m, 1);
    const startMonday = getMondayOfWeek(firstOfMonth);
    const cells: Array<{ date: Date; dayKey: string; inCurrentMonth: boolean }> = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(startMonday);
      d.setDate(startMonday.getDate() + i);
      cells.push({ date: d, dayKey: toDayKeyLocal(d), inCurrentMonth: d.getMonth() === m });
    }
    return cells;
  }, [cursorDate]);

  const weekCells = useMemo(() => {
    const startMonday = getMondayOfWeek(cursorDate);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(startMonday);
      d.setDate(startMonday.getDate() + i);
      return { date: d, dayKey: toDayKeyLocal(d) };
    });
  }, [cursorDate]);

  const todayKey = toDayKeyLocal(new Date());

  const handleDropOnDay = (targetDayKey: string) => {
    if (!draggedEventId) return;
    const ev = events.find((e) => e.id === draggedEventId);
    setDraggedEventId(null);
    if (!ev) return;

    const currentIso = ev.scheduledPublishAtIso ?? ev.plannedDateIso;
    const { dayKey: oldDayKey, timeHHmm } = formatDayAndTime(currentIso, timezone);
    if (oldDayKey === targetDayKey) return;

    const targetIso = buildIsoFromLocal(targetDayKey, timeHHmm, timezone);
    const targetMs = Date.parse(targetIso);
    const hasConflictWarning = events.some((other) => {
      if (other.id === ev.id || other.channelId !== ev.channelId || other.platform !== ev.platform) return false;
      const otherMs = Date.parse(other.scheduledPublishAtIso ?? other.plannedDateIso);
      return Math.abs(otherMs - targetMs) < 90 * 60 * 1_000;
    });

    setPendingMove({
      event: ev,
      targetDayKey,
      targetTimeHHmm: timeHHmm,
      targetIso,
      hasConflictWarning,
      reason: 'Reagendamento via arrastar e soltar',
    });
  };

  const confirmPendingMove = async () => {
    if (!pendingMove || !payload) return;
    const bridge = getBridge();
    if (!bridge.cinemaCalendarMoveEvent) return;

    // Optimistic update with rollback snapshot
    const previousPayload = payload;
    const targetKind = pendingMove.event.scheduledPublishAtIso ? 'scheduled' : 'planned';
    const optimisticEvents = payload.events.map((e) =>
      e.id === pendingMove.event.id
        ? {
            ...e,
            ...(targetKind === 'scheduled'
              ? { scheduledPublishAtIso: pendingMove.targetIso }
              : { plannedDateIso: pendingMove.targetIso }),
          }
        : e,
    );
    setPayload({ ...payload, events: optimisticEvents });

    const moveReq = pendingMove;
    setPendingMove(null);

    try {
      const res = await bridge.cinemaCalendarMoveEvent({
        id: moveReq.event.id,
        targetDateIso: moveReq.targetIso,
        targetKind,
        reason: moveReq.reason,
      });
      setPayload(res.calendar);
      setStatusBanner({
        kind: 'info',
        text: `"${moveReq.event.title}" movido para ${moveReq.targetDayKey} às ${moveReq.targetTimeHHmm}.`,
      });
    } catch (err) {
      // Visual rollback on backend failure
      setPayload(previousPayload);
      setStatusBanner({
        kind: 'error',
        text: `Falha ao reagendar (alteração revertida): ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  };

  const openCreateForDay = (dayKey: string) => {
    setCreateDraft({
      dayKey,
      timeHHmm: '18:00',
      title: '',
      description: '',
      channelId: channels[0]?.id ?? 'main_yt',
      channelName: channels[0]?.name ?? 'Canal Principal',
      platform: 'youtube',
      format: 'top10',
      projectId: '',
      status: 'draft',
    });
  };

  const handleSaveCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!createDraft || !createDraft.title.trim()) return;
    const bridge = getBridge();
    if (!bridge.cinemaCalendarUpsertEvent) return;
    const plannedDateIso = buildIsoFromLocal(createDraft.dayKey, createDraft.timeHHmm, timezone);
    try {
      const res = await bridge.cinemaCalendarUpsertEvent({
        title: createDraft.title.trim(),
        description: createDraft.description.trim(),
        channelId: createDraft.channelId,
        channelName: createDraft.channelName,
        platform: createDraft.platform,
        format: createDraft.format,
        ...(createDraft.projectId ? { projectId: createDraft.projectId } : {}),
        plannedDateIso,
        timezone,
        status: createDraft.status,
        reviewApproved: createDraft.status === 'approved' || createDraft.status === 'scheduled',
      });
      setPayload(res.calendar);
      setCreateDraft(null);
      setStatusBanner({ kind: 'info', text: `Planejamento "${res.event.title}" salvo no calendário.` });
    } catch (err) {
      setStatusBanner({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleUpdateSelected = async (
    patch: { [K in keyof EditorialCalendarEventView]?: EditorialCalendarEventView[K] | undefined },
  ) => {
    if (!selectedEvent) return;
    const bridge = getBridge();
    if (!bridge.cinemaCalendarUpsertEvent) return;
    const merged: Record<string, unknown> = { ...selectedEvent };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete merged[k];
      else merged[k] = v;
    }
    try {
      const res = await bridge.cinemaCalendarUpsertEvent(merged);
      setPayload(res.calendar);
    } catch (err) {
      setStatusBanner({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleSchedulePlatform = async (ev: EditorialCalendarEventView) => {
    const bridge = getBridge();
    if (!bridge.cinemaCalendarSchedulePlatform) return;
    try {
      const res = await bridge.cinemaCalendarSchedulePlatform({
        id: ev.id,
        publishAtIso: ev.scheduledPublishAtIso ?? ev.plannedDateIso,
      });
      setPayload(res.calendar);
      setStatusBanner({ kind: 'info', text: `"${ev.title}" agendado na plataforma (${PLATFORM_LABELS[ev.platform]}).` });
    } catch (err) {
      setStatusBanner({ kind: 'error', text: err instanceof Error ? err.message : String(err) });
    }
  };

  const handleDeleteSelected = async () => {
    if (!selectedEvent) return;
    const bridge = getBridge();
    if (!bridge.cinemaCalendarDeleteEvent) return;
    const res = await bridge.cinemaCalendarDeleteEvent({ id: selectedEvent.id });
    setPayload(res.calendar);
    setSelectedEventId(null);
  };

  const handleCreateAndGenerateSeries = async (e: React.FormEvent) => {
    e.preventDefault();
    const bridge = getBridge();
    if (!bridge.cinemaCalendarUpsertSeries || !bridge.cinemaCalendarGenerateSeries) return;
    const sRes = await bridge.cinemaCalendarUpsertSeries({
      ...seriesForm,
      timezone,
      active: true,
    });
    const gRes = await bridge.cinemaCalendarGenerateSeries({ seriesId: sRes.series.id, weeksAhead: 4 });
    setPayload(gRes.calendar);
    setShowSeriesModal(false);
    setStatusBanner({
      kind: 'info',
      text: `Série "${seriesForm.name}" salva com ${gRes.created.length} episódio(s) planejado(s) para as próximas 4 semanas.`,
    });
  };

  const handleApplySuggestion = async (sug: SmartSuggestionView) => {
    const bridge = getBridge();
    if (!bridge.cinemaCalendarUpsertEvent) return;
    const res = await bridge.cinemaCalendarUpsertEvent({
      title: sug.suggestedTitle,
      description: sug.rationale,
      channelId: sug.channelId,
      channelName: sug.channelName,
      platform: sug.platform,
      format: sug.format,
      plannedDateIso: sug.suggestedDateIso,
      timezone: sug.timezone,
      status: 'draft',
      reviewApproved: false,
      productionLeadDays: sug.format === 'short' ? 1 : 4,
    });
    setPayload(res.calendar);
    setStatusBanner({ kind: 'info', text: `Sugestão aplicada: "${res.event.title}".` });
  };

  const periodLabel =
    viewMode === 'month'
      ? cursorDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
      : `Semana de ${weekCells[0]?.date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} — ${weekCells[6]?.date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })}`;

  return (
    <>
      <PageHeader
        title="Calendário Editorial Inteligente"
        description="Planejamento visual integrado ao pipeline de produção, Sala de Revisão, séries recorrentes e agendamento YouTube."
      />
      <main className="space-y-4 px-6 py-5 xl:px-8">
        {/* Status Banner */}
        {statusBanner && (
          <div
            className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-xs ${
              statusBanner.kind === 'error'
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
            }`}
          >
            <span>{statusBanner.text}</span>
            <button type="button" onClick={() => setStatusBanner(null)} aria-label="Fechar aviso">
              <X className="size-3.5" />
            </button>
          </div>
        )}

        {/* Top Toolbar */}
        <section className="sg-panel rounded-2xl border border-border bg-card p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => navigatePeriod(-1)}
                onDragOver={(e) => {
                  if (draggedEventId) e.preventDefault();
                }}
                onDrop={() => {
                  if (draggedEventId) navigatePeriod(-1);
                }}
                className="rounded-lg border border-border bg-[#0d0d17] p-2 text-xs hover:border-primary/50"
                title={draggedEventId ? 'Soltar ou passar para período anterior' : 'Período anterior'}
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                type="button"
                onClick={() => setCursorDate(new Date())}
                className="rounded-lg border border-border bg-[#0d0d17] px-3 py-1.5 text-xs font-medium hover:border-primary/50"
              >
                Hoje
              </button>
              <button
                type="button"
                onClick={() => navigatePeriod(1)}
                onDragOver={(e) => {
                  if (draggedEventId) e.preventDefault();
                }}
                onDrop={() => {
                  if (draggedEventId) navigatePeriod(1);
                }}
                className="rounded-lg border border-border bg-[#0d0d17] p-2 text-xs hover:border-primary/50"
                title={draggedEventId ? 'Soltar ou passar para próximo período' : 'Próximo período'}
              >
                <ChevronRight className="size-4" />
              </button>
              <h2 className="ml-2 text-base font-semibold capitalize text-foreground">{periodLabel}</h2>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-xl border border-border bg-[#0d0d17] p-0.5 text-xs">
                {(['month', 'week', 'agenda'] as CalendarViewMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setViewMode(mode)}
                    className={`rounded-lg px-3 py-1.5 font-medium transition ${
                      viewMode === mode ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {mode === 'month' ? 'Mês' : mode === 'week' ? 'Semana' : 'Agenda'}
                  </button>
                ))}
              </div>

              <label className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-[#0d0d17] px-2.5 py-1.5 text-xs text-muted-foreground">
                <Globe className="size-3.5 text-purple-300" />
                <select
                  value={timezone}
                  onChange={(e) => setTimezone(e.target.value)}
                  aria-label="Fuso horário IANA"
                  className="bg-transparent text-xs text-foreground focus:outline-none"
                >
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <option key={tz} value={tz} className="bg-[#0d0d17]">
                      {tz}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => setShowSeriesModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-[#0d0d17] px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary/50"
              >
                <Repeat className="size-3.5 text-sky-300" />
                Séries ({payload?.series.length ?? 0})
              </button>

              <button
                type="button"
                onClick={() => setShowAiPlannerModal(true)}
                className="inline-flex items-center gap-1.5 rounded-xl border border-purple-500/40 bg-purple-500/15 px-3 py-1.5 text-xs font-medium text-purple-200 hover:bg-purple-500/25"
              >
                <Sparkles className="size-3.5" />
                Planejamento IA
              </button>

              <button
                type="button"
                onClick={() => openCreateForDay(todayKey)}
                className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-purple-600 to-amber-500 px-3.5 py-1.5 text-xs font-semibold text-white"
              >
                <Plus className="size-3.5" />
                Nova
              </button>
            </div>
          </div>

          {/* Health & Alerts Bar */}
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-3 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-[#0d0d17] px-2.5 py-1 text-muted-foreground">
              <CalendarIcon className="size-3 text-purple-300" />
              {events.length} evento(s)
            </span>
            {health.conflictEventIds.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-rose-200">
                <AlertTriangle className="size-3" />
                {health.conflictEventIds.length} conflito(s) de horário
              </span>
            )}
            {health.delayedEventIds.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-amber-200">
                <Clock className="size-3" />
                {health.delayedEventIds.length} atrasado(s)
              </span>
            )}
            {health.unapprovedNearPublishIds.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-orange-500/40 bg-orange-500/15 px-2.5 py-1 text-orange-200">
                <ShieldAlert className="size-3" />
                {health.unapprovedNearPublishIds.length} próximo(s) sem aprovação na Revisão
              </span>
            )}
            {health.integrationFailureIds.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/15 px-2.5 py-1 text-rose-200">
                {health.integrationFailureIds.length} falha(s) de integração
              </span>
            )}
            {health.contentGaps.length > 0 && (
              <button
                type="button"
                onClick={() => setShowAiPlannerModal(true)}
                className="inline-flex items-center gap-1 rounded-full border border-sky-500/40 bg-sky-500/15 px-2.5 py-1 text-sky-200 hover:bg-sky-500/25"
              >
                <Sparkles className="size-3" />
                {health.contentGaps.length} período(s) sem conteúdo
              </button>
            )}
          </div>

          {/* Filter Strip */}
          <div className="grid gap-2 border-t border-border/60 pt-3 sm:grid-cols-2 lg:grid-cols-6">
            <div className="relative flex items-center">
              <Filter className="pointer-events-none absolute left-2.5 size-3.5 text-muted-foreground" />
              <input
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                placeholder="Buscar título..."
                aria-label="Buscar no calendário"
                className="w-full rounded-lg border border-border bg-[#0d0d17] pl-8 pr-2.5 py-1.5 text-xs text-foreground"
              />
            </div>
            <select
              value={channelFilter}
              onChange={(e) => setChannelFilter(e.target.value)}
              aria-label="Filtrar por canal"
              className="rounded-lg border border-border bg-[#0d0d17] px-2.5 py-1.5 text-xs text-foreground"
            >
              <option value="all">Todos os canais</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <select
              value={platformFilter}
              onChange={(e) => setPlatformFilter(e.target.value as 'all' | CalendarPlatform)}
              aria-label="Filtrar por plataforma"
              className="rounded-lg border border-border bg-[#0d0d17] px-2.5 py-1.5 text-xs text-foreground"
            >
              <option value="all">Todas as plataformas</option>
              {(Object.keys(PLATFORM_LABELS) as CalendarPlatform[]).map((p) => (
                <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
              ))}
            </select>
            <select
              value={formatFilter}
              onChange={(e) => setFormatFilter(e.target.value as 'all' | CalendarFormat)}
              aria-label="Filtrar por formato"
              className="rounded-lg border border-border bg-[#0d0d17] px-2.5 py-1.5 text-xs text-foreground"
            >
              <option value="all">Todos os formatos</option>
              {(Object.keys(FORMAT_LABELS) as CalendarFormat[]).map((f) => (
                <option key={f} value={f}>{FORMAT_LABELS[f]}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | CalendarEventStatus)}
              aria-label="Filtrar por status"
              className="rounded-lg border border-border bg-[#0d0d17] px-2.5 py-1.5 text-xs text-foreground"
            >
              <option value="all">Todos os status</option>
              {(Object.keys(STATUS_META) as CalendarEventStatus[]).map((s) => (
                <option key={s} value={s}>{STATUS_META[s].label}</option>
              ))}
            </select>
            <select
              value={projectFilter}
              onChange={(e) => setProjectFilter(e.target.value)}
              aria-label="Filtrar por projeto"
              className="rounded-lg border border-border bg-[#0d0d17] px-2.5 py-1.5 text-xs text-foreground"
            >
              <option value="all">Todos os projetos</option>
              {projects.map((p) => (
                <option key={p.projectId} value={p.projectId}>{p.title}</option>
              ))}
            </select>
          </div>
        </section>

        {/* Main Calendar Body + Slide-over Inspector */}
        <div className={`grid gap-4 ${selectedEvent ? 'lg:grid-cols-[1fr_360px]' : ''}`}>
          <section className="rounded-2xl border border-border bg-card p-4">
            {loading ? (
              <p className="py-12 text-center text-sm text-muted-foreground">Carregando calendário editorial…</p>
            ) : viewMode === 'month' ? (
              <div>
                <div className="grid grid-cols-7 gap-2 pb-2 text-center text-[11px] font-medium text-muted-foreground">
                  {WEEKDAYS_SHORT.map((w) => (
                    <div key={w}>{w}</div>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-2">
                  {monthCells.map((cell) => {
                    const dayItems = eventsByDay.get(cell.dayKey) ?? [];
                    const isToday = cell.dayKey === todayKey;
                    return (
                      <div
                        key={cell.dayKey}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleDropOnDay(cell.dayKey)}
                        onClick={() => {
                          if (dayItems.length === 0) openCreateForDay(cell.dayKey);
                        }}
                        className={`min-h-[116px] rounded-xl border p-2 transition ${
                          isToday
                            ? 'border-emerald-500/60 bg-emerald-500/5'
                            : cell.inCurrentMonth
                              ? 'border-border/70 bg-[#0b0b14] hover:border-purple-500/40'
                              : 'border-border/30 bg-[#080810] opacity-55'
                        }`}
                      >
                        <div className="mb-1.5 flex items-center justify-between">
                          <span className={`text-xs font-medium ${isToday ? 'text-emerald-300' : 'text-muted-foreground'}`}>
                            {cell.date.getDate()}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              openCreateForDay(cell.dayKey);
                            }}
                            className="rounded p-0.5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                            title={`Planejar em ${cell.dayKey}`}
                          >
                            <Plus className="size-3" />
                          </button>
                        </div>

                        <div className="space-y-1.5">
                          {dayItems.map((ev) => {
                            const meta = STATUS_META[ev.status];
                            const effectiveIso = ev.scheduledPublishAtIso ?? ev.plannedDateIso;
                            const { timeHHmm } = formatDayAndTime(effectiveIso, timezone);
                            const isConflict = health.conflictEventIds.includes(ev.id);
                            const isUnapprovedSoon = health.unapprovedNearPublishIds.includes(ev.id);
                            return (
                              <div
                                key={ev.id}
                                draggable
                                onDragStart={() => setDraggedEventId(ev.id)}
                                onDragEnd={() => setDraggedEventId(null)}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedEventId(ev.id);
                                }}
                                className={`cursor-grab rounded-lg border px-2 py-1.5 text-[11px] transition active:cursor-grabbing ${
                                  selectedEventId === ev.id
                                    ? 'border-purple-400 bg-purple-500/20'
                                    : 'border-border/80 bg-[#131324] hover:border-purple-400/60'
                                }`}
                              >
                                <div className="flex items-center justify-between gap-1">
                                  <span className="inline-flex items-center gap-1 truncate font-medium text-foreground">
                                    <span className={`size-1.5 shrink-0 rounded-full ${meta.dot}`} />
                                    {ev.title}
                                  </span>
                                  {(isConflict || isUnapprovedSoon) && (
                                    <AlertTriangle className="size-3 shrink-0 text-amber-400" />
                                  )}
                                </div>
                                <div className="mt-0.5 flex items-center justify-between text-[10px] text-muted-foreground">
                                  <span>{timeHHmm} · {PLATFORM_LABELS[ev.platform]}</span>
                                  <span>{ev.scheduledPublishAtIso ? 'Agend.' : 'Plan.'}</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : viewMode === 'week' ? (
              <div className="grid gap-3 md:grid-cols-7">
                {weekCells.map((cell) => {
                  const dayItems = eventsByDay.get(cell.dayKey) ?? [];
                  const isToday = cell.dayKey === todayKey;
                  return (
                    <div
                      key={cell.dayKey}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => handleDropOnDay(cell.dayKey)}
                      className={`min-h-[340px] rounded-xl border p-2.5 ${
                        isToday ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-border bg-[#0b0b14]'
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between border-b border-border/60 pb-1.5">
                        <div>
                          <p className="text-[11px] text-muted-foreground">{WEEKDAYS_FULL[cell.date.getDay()]}</p>
                          <p className="text-sm font-semibold text-foreground">
                            {cell.date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => openCreateForDay(cell.dayKey)}
                          className="rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                        >
                          <Plus className="size-3.5" />
                        </button>
                      </div>
                      <div className="space-y-2">
                        {dayItems.map((ev) => {
                          const meta = STATUS_META[ev.status];
                          const { timeHHmm } = formatDayAndTime(ev.scheduledPublishAtIso ?? ev.plannedDateIso, timezone);
                          return (
                            <div
                              key={ev.id}
                              draggable
                              onDragStart={() => setDraggedEventId(ev.id)}
                              onDragEnd={() => setDraggedEventId(null)}
                              onClick={() => setSelectedEventId(ev.id)}
                              className="cursor-grab rounded-xl border border-border bg-[#131324] p-2.5 text-xs hover:border-purple-400/60"
                            >
                              {ev.thumbnailUrl ? (
                                <img src={ev.thumbnailUrl} alt="" className="mb-2 h-16 w-full rounded-lg object-cover" />
                              ) : (
                                <div className="mb-2 flex h-10 items-center justify-center rounded-lg bg-[#0d0d17] text-[10px] text-muted-foreground">
                                  <Film className="mr-1 size-3" /> {FORMAT_LABELS[ev.format]}
                                </div>
                              )}
                              <p className="font-semibold text-foreground line-clamp-2">{ev.title}</p>
                              <p className="mt-1 text-[11px] text-muted-foreground">
                                {timeHHmm} · {ev.channelName}
                              </p>
                              <div className="mt-1.5 flex items-center justify-between">
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] ${meta.badge}`}>
                                  {meta.label}
                                </span>
                                <span className="text-[10px] text-muted-foreground">
                                  {ev.reviewApproved ? 'Revisão OK' : 'Sem aprovação'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              /* Agenda View */
              <div className="space-y-2.5">
                {filteredEvents.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    Nenhuma publicação encontrada com os filtros atuais. Clique em <strong>+ Nova</strong> ou em um dia no modo Mês.
                  </div>
                ) : (
                  [...filteredEvents]
                    .sort((a, b) => (a.scheduledPublishAtIso ?? a.plannedDateIso).localeCompare(b.scheduledPublishAtIso ?? b.plannedDateIso))
                    .map((ev) => {
                      const meta = STATUS_META[ev.status];
                      const planned = formatDayAndTime(ev.plannedDateIso, timezone);
                      const scheduled = ev.scheduledPublishAtIso ? formatDayAndTime(ev.scheduledPublishAtIso, timezone) : null;
                      return (
                        <div
                          key={ev.id}
                          onClick={() => setSelectedEventId(ev.id)}
                          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border bg-[#0b0b14] p-3.5 text-xs hover:border-purple-400/60 cursor-pointer"
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded-lg border border-border bg-[#131324] text-[10px] text-muted-foreground">
                              {ev.thumbnailUrl ? (
                                <img src={ev.thumbnailUrl} alt="" className="h-full w-full rounded-lg object-cover" />
                              ) : (
                                FORMAT_LABELS[ev.format]
                              )}
                            </div>
                            <div>
                              <p className="text-sm font-semibold text-foreground">{ev.title}</p>
                              <p className="mt-0.5 text-muted-foreground">
                                {ev.channelName} · {PLATFORM_LABELS[ev.platform]} · Planejado: {planned.dayKey} {planned.timeHHmm}
                                {scheduled ? ` · Agendado na plataforma: ${scheduled.dayKey} ${scheduled.timeHHmm}` : ''}
                              </p>
                              {ev.metrics?.views !== undefined && (
                                <p className="mt-0.5 text-[11px] text-emerald-300">
                                  Desempenho: {ev.metrics.views.toLocaleString('pt-BR')} views
                                  {ev.metrics.ctr !== undefined ? ` · CTR ${ev.metrics.ctr}%` : ''}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full border px-2.5 py-0.5 text-[11px] ${meta.badge}`}>
                              {meta.label}
                            </span>
                            {!ev.reviewApproved && (
                              <span className="rounded-full border border-orange-500/40 bg-orange-500/15 px-2.5 py-0.5 text-[11px] text-orange-200">
                                Revisão pendente
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })
                )}
              </div>
            )}

            {/* Status Legend */}
            <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-border/60 pt-3 text-[11px] text-muted-foreground">
              {(Object.keys(STATUS_META) as CalendarEventStatus[]).map((s) => (
                <span key={s} className="inline-flex items-center gap-1.5">
                  <span className={`size-2 rounded-full ${STATUS_META[s].dot}`} />
                  {STATUS_META[s].label}
                </span>
              ))}
            </div>
          </section>

          {/* Right Slide-Over Inspector */}
          {selectedEvent && (
            <aside className="rounded-2xl border border-border bg-card p-4 space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <span className={`inline-block rounded-full border px-2 py-0.5 text-[10px] ${STATUS_META[selectedEvent.status].badge}`}>
                    {STATUS_META[selectedEvent.status].label}
                  </span>
                  <h3 className="mt-1.5 text-sm font-semibold text-foreground">{selectedEvent.title}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedEventId(null)}
                  className="rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-4" />
                </button>
              </div>

              <div className="space-y-2.5 text-xs">
                <label className="block space-y-1">
                  <span className="text-muted-foreground">Título</span>
                  <input
                    value={selectedEvent.title}
                    onChange={(e) => void handleUpdateSelected({ title: e.target.value })}
                    className="w-full rounded-lg border border-border bg-[#0d0d17] px-2.5 py-1.5 text-xs text-foreground"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="text-muted-foreground">Descrição / Pauta</span>
                  <textarea
                    rows={3}
                    value={selectedEvent.description}
                    onChange={(e) => void handleUpdateSelected({ description: e.target.value })}
                    className="w-full rounded-lg border border-border bg-[#0d0d17] px-2.5 py-1.5 text-xs text-foreground"
                  />
                </label>

                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-muted-foreground">Data Planejada</span>
                    <input
                      type="date"
                      value={formatDayAndTime(selectedEvent.plannedDateIso, timezone).dayKey}
                      onChange={(e) => {
                        const { timeHHmm } = formatDayAndTime(selectedEvent.plannedDateIso, timezone);
                        void handleUpdateSelected({ plannedDateIso: buildIsoFromLocal(e.target.value, timeHHmm, timezone) });
                      }}
                      className="w-full rounded-lg border border-border bg-[#0d0d17] px-2 py-1.5 text-xs text-foreground"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted-foreground">Horário ({timezone})</span>
                    <input
                      type="time"
                      value={formatDayAndTime(selectedEvent.plannedDateIso, timezone).timeHHmm}
                      onChange={(e) => {
                        const { dayKey } = formatDayAndTime(selectedEvent.plannedDateIso, timezone);
                        void handleUpdateSelected({ plannedDateIso: buildIsoFromLocal(dayKey, e.target.value, timezone) });
                      }}
                      className="w-full rounded-lg border border-border bg-[#0d0d17] px-2 py-1.5 text-xs text-foreground"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <label className="space-y-1">
                    <span className="text-muted-foreground">Plataforma</span>
                    <select
                      value={selectedEvent.platform}
                      onChange={(e) => void handleUpdateSelected({ platform: e.target.value as CalendarPlatform })}
                      className="w-full rounded-lg border border-border bg-[#0d0d17] px-2 py-1.5 text-xs text-foreground"
                    >
                      {(Object.keys(PLATFORM_LABELS) as CalendarPlatform[]).map((p) => (
                        <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-1">
                    <span className="text-muted-foreground">Status</span>
                    <select
                      value={selectedEvent.status}
                      onChange={(e) => void handleUpdateSelected({ status: e.target.value as CalendarEventStatus })}
                      className="w-full rounded-lg border border-border bg-[#0d0d17] px-2 py-1.5 text-xs text-foreground"
                    >
                      {(Object.keys(STATUS_META) as CalendarEventStatus[]).map((s) => (
                        <option key={s} value={s}>{STATUS_META[s].label}</option>
                      ))}
                    </select>
                  </label>
                </div>

                <label className="block space-y-1">
                  <span className="text-muted-foreground">Projeto Vinculado</span>
                  <select
                    value={selectedEvent.projectId ?? ''}
                    onChange={(e) => void handleUpdateSelected({ projectId: e.target.value || undefined })}
                    className="w-full rounded-lg border border-border bg-[#0d0d17] px-2 py-1.5 text-xs text-foreground"
                  >
                    <option value="">Sem projeto vinculado</option>
                    {projects.map((p) => (
                      <option key={p.projectId} value={p.projectId}>{p.title}</option>
                    ))}
                  </select>
                </label>

                {selectedEvent.projectId && (
                  <div className="flex gap-2">
                    <Link
                      to={`/aethera/editor?projectId=${encodeURIComponent(selectedEvent.projectId)}`}
                      className="flex-1 rounded-lg border border-border bg-[#0d0d17] py-1.5 text-center font-medium text-purple-200 hover:border-primary/50"
                    >
                      Abrir no Editor
                    </Link>
                    <Link
                      to={`/aethera/review?projectId=${encodeURIComponent(selectedEvent.projectId)}`}
                      className="flex-1 rounded-lg border border-border bg-[#0d0d17] py-1.5 text-center font-medium text-amber-200 hover:border-primary/50"
                    >
                      Sala de Revisão
                    </Link>
                  </div>
                )}

                {/* Review Room Gate & Platform Scheduling */}
                <div className="rounded-xl border border-border bg-[#0d0d17] p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-foreground">Portão da Sala de Revisão</span>
                    <button
                      type="button"
                      onClick={() =>
                        void handleUpdateSelected({
                          reviewApproved: !selectedEvent.reviewApproved,
                          reviewApprovedAt: !selectedEvent.reviewApproved ? new Date().toISOString() : undefined,
                          status: !selectedEvent.reviewApproved ? 'approved' : 'in_review',
                        })
                      }
                      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
                        selectedEvent.reviewApproved
                          ? 'bg-emerald-500/20 text-emerald-200'
                          : 'bg-orange-500/20 text-orange-200'
                      }`}
                    >
                      <CheckCircle2 className="size-3" />
                      {selectedEvent.reviewApproved ? 'Aprovado' : 'Aprovar na Revisão'}
                    </button>
                  </div>

                  {selectedEvent.scheduledPublishAtIso && (
                    <p className="text-[11px] text-violet-300">
                      Agendado na plataforma: {formatDayAndTime(selectedEvent.scheduledPublishAtIso, timezone).dayKey}{' '}
                      {formatDayAndTime(selectedEvent.scheduledPublishAtIso, timezone).timeHHmm}
                    </p>
                  )}

                  <button
                    type="button"
                    onClick={() => void handleSchedulePlatform(selectedEvent)}
                    disabled={!selectedEvent.reviewApproved}
                    className="w-full rounded-lg bg-violet-600/80 py-1.5 text-xs font-medium text-white hover:bg-violet-600 disabled:cursor-not-allowed disabled:opacity-45"
                  >
                    {selectedEvent.reviewApproved
                      ? `Agendar Publicação (${PLATFORM_LABELS[selectedEvent.platform]})`
                      : 'Bloqueado: Aprove na Sala de Revisão primeiro'}
                  </button>
                </div>

                {/* Reschedule History */}
                {selectedEvent.rescheduleHistory.length > 0 && (
                  <div className="rounded-xl border border-border bg-[#0d0d17] p-3 space-y-1.5">
                    <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                      <History className="size-3.5" />
                      Histórico de Reagendamentos ({selectedEvent.rescheduleHistory.length})
                    </div>
                    <div className="max-h-28 space-y-1 overflow-y-auto text-[10px] text-muted-foreground">
                      {selectedEvent.rescheduleHistory.map((h, idx) => (
                        <div key={idx}>
                          {formatDayAndTime(h.fromIso, timezone).dayKey} → {formatDayAndTime(h.toIso, timezone).dayKey}
                          {h.reason ? ` (${h.reason})` : ''}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => void handleDeleteSelected()}
                  className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/40 bg-rose-500/10 py-1.5 text-xs font-medium text-rose-200 hover:bg-rose-500/20"
                >
                  <Trash2 className="size-3.5" />
                  Remover do Calendário
                </button>
              </div>
            </aside>
          )}
        </div>
      </main>

      {/* Confirm Reschedule Modal */}
      {pendingMove && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-card p-5 space-y-4 text-xs">
            <h3 className="text-sm font-semibold text-foreground">Confirmar Reagendamento</h3>
            <p className="text-muted-foreground">
              Mover <strong className="text-foreground">{pendingMove.event.title}</strong> para{' '}
              <strong className="text-purple-200">{pendingMove.targetDayKey}</strong> às{' '}
              <strong className="text-purple-200">{pendingMove.targetTimeHHmm}</strong> ({timezone})?
            </p>
            {pendingMove.hasConflictWarning && (
              <div className="rounded-xl border border-amber-500/40 bg-amber-500/15 p-3 text-amber-200">
                Conflito detectado: já existe outra publicação no mesmo canal/plataforma próxima a esse horário.
              </div>
            )}
            <label className="block space-y-1">
              <span className="text-muted-foreground">Motivo (registrado no histórico)</span>
              <input
                value={pendingMove.reason}
                onChange={(e) => setPendingMove({ ...pendingMove, reason: e.target.value })}
                className="w-full rounded-lg border border-border bg-[#0d0d17] px-3 py-1.5 text-xs text-foreground"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingMove(null)}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void confirmPendingMove()}
                className="rounded-lg bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground"
              >
                Confirmar Reagendamento
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Event Modal */}
      {createDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form onSubmit={(e) => void handleSaveCreate(e)} className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Novo Planejamento Editorial</h3>
              <button type="button" onClick={() => setCreateDraft(null)}><X className="size-4" /></button>
            </div>
            <input
              required
              value={createDraft.title}
              onChange={(e) => setCreateDraft({ ...createDraft, title: e.target.value })}
              placeholder="Título do vídeo (ex.: TOP 10 Jogos de 2027)"
              className="w-full rounded-lg border border-border bg-[#0d0d17] px-3 py-2 text-xs text-foreground"
            />
            <textarea
              rows={2}
              value={createDraft.description}
              onChange={(e) => setCreateDraft({ ...createDraft, description: e.target.value })}
              placeholder="Pauta / briefing rápido..."
              className="w-full rounded-lg border border-border bg-[#0d0d17] px-3 py-2 text-xs text-foreground"
            />
            <div className="grid grid-cols-2 gap-2">
              <input
                type="date"
                value={createDraft.dayKey}
                onChange={(e) => setCreateDraft({ ...createDraft, dayKey: e.target.value })}
                className="rounded-lg border border-border bg-[#0d0d17] px-2.5 py-1.5 text-xs text-foreground"
              />
              <input
                type="time"
                value={createDraft.timeHHmm}
                onChange={(e) => setCreateDraft({ ...createDraft, timeHHmm: e.target.value })}
                className="rounded-lg border border-border bg-[#0d0d17] px-2.5 py-1.5 text-xs text-foreground"
              />
              <select
                value={createDraft.platform}
                onChange={(e) => setCreateDraft({ ...createDraft, platform: e.target.value as CalendarPlatform })}
                className="rounded-lg border border-border bg-[#0d0d17] px-2.5 py-1.5 text-xs text-foreground"
              >
                {(Object.keys(PLATFORM_LABELS) as CalendarPlatform[]).map((p) => (
                  <option key={p} value={p}>{PLATFORM_LABELS[p]}</option>
                ))}
              </select>
              <select
                value={createDraft.format}
                onChange={(e) => setCreateDraft({ ...createDraft, format: e.target.value as CalendarFormat })}
                className="rounded-lg border border-border bg-[#0d0d17] px-2.5 py-1.5 text-xs text-foreground"
              >
                {(Object.keys(FORMAT_LABELS) as CalendarFormat[]).map((f) => (
                  <option key={f} value={f}>{FORMAT_LABELS[f]}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setCreateDraft(null)} className="rounded-lg border border-border px-3 py-1.5">
                Cancelar
              </button>
              <button type="submit" className="rounded-lg bg-primary px-4 py-1.5 font-semibold text-primary-foreground">
                Salvar no Calendário
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Recurring Series Modal */}
      {showSeriesModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form onSubmit={(e) => void handleCreateAndGenerateSeries(e)} className="w-full max-w-lg rounded-2xl border border-border bg-card p-5 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Séries Recorrentes</h3>
              <button type="button" onClick={() => setShowSeriesModal(false)}><X className="size-4" /></button>
            </div>
            <input
              required
              value={seriesForm.name}
              onChange={(e) => setSeriesForm({ ...seriesForm, name: e.target.value })}
              placeholder="Nome da série (ex.: Notícias de Games)"
              className="w-full rounded-lg border border-border bg-[#0d0d17] px-3 py-2 text-xs text-foreground"
            />
            <div className="grid grid-cols-3 gap-2">
              <select
                value={seriesForm.weekday}
                onChange={(e) => setSeriesForm({ ...seriesForm, weekday: Number(e.target.value) })}
                className="rounded-lg border border-border bg-[#0d0d17] px-2 py-1.5 text-xs text-foreground"
              >
                {WEEKDAYS_FULL.map((w, idx) => (
                  <option key={w} value={idx}>{w}</option>
                ))}
              </select>
              <input
                type="time"
                value={seriesForm.timeHHmm}
                onChange={(e) => setSeriesForm({ ...seriesForm, timeHHmm: e.target.value })}
                className="rounded-lg border border-border bg-[#0d0d17] px-2 py-1.5 text-xs text-foreground"
              />
              <input
                type="number"
                min={1}
                max={14}
                value={seriesForm.leadDaysForProduction}
                onChange={(e) => setSeriesForm({ ...seriesForm, leadDaysForProduction: Number(e.target.value) })}
                title="Antecedência de produção (dias)"
                className="rounded-lg border border-border bg-[#0d0d17] px-2 py-1.5 text-xs text-foreground"
              />
            </div>
            <textarea
              rows={2}
              value={seriesForm.promptTemplate}
              onChange={(e) => setSeriesForm({ ...seriesForm, promptTemplate: e.target.value })}
              className="w-full rounded-lg border border-border bg-[#0d0d17] px-3 py-2 text-xs text-foreground"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setShowSeriesModal(false)} className="rounded-lg border border-border px-3 py-1.5">
                Fechar
              </button>
              <button type="submit" className="rounded-lg bg-primary px-4 py-1.5 font-semibold text-primary-foreground">
                Criar Série & Gerar 4 Semanas
              </button>
            </div>
          </form>
        </div>
      )}

      {/* AI Smart Planner Modal */}
      {showAiPlannerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-xl rounded-2xl border border-border bg-card p-5 space-y-4 text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-purple-300" />
                <h3 className="text-sm font-semibold text-foreground">Planejamento Inteligente com IA</h3>
              </div>
              <button type="button" onClick={() => setShowAiPlannerModal(false)}><X className="size-4" /></button>
            </div>

            {health.contentGaps.length > 0 && (
              <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-3 text-sky-200">
                <p className="font-semibold">Períodos sem conteúdo detectados:</p>
                <p className="mt-1">
                  {health.contentGaps.map((g) => `${g.startDayKey} até ${g.endDayKey} (${g.daysCount} dias)`).join(' · ')}
                </p>
              </div>
            )}

            <div className="space-y-2 max-h-80 overflow-y-auto">
              {(payload?.suggestions ?? []).map((sug) => {
                const when = formatDayAndTime(sug.suggestedDateIso, timezone);
                const prodStart = formatDayAndTime(sug.productionStartIso, timezone);
                return (
                  <div key={sug.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-[#0d0d17] p-3">
                    <div className="space-y-1">
                      <p className="font-semibold text-foreground">{sug.suggestedTitle}</p>
                      <p className="text-muted-foreground">
                        {when.dayKey} às {when.timeHHmm} · {PLATFORM_LABELS[sug.platform]} · Iniciar produção em {prodStart.dayKey}
                      </p>
                      <p className="text-[11px] text-purple-200">{sug.rationale}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleApplySuggestion(sug)}
                      className="shrink-0 rounded-lg bg-purple-600 px-3 py-1.5 font-medium text-white hover:bg-purple-500"
                    >
                      Aplicar
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
