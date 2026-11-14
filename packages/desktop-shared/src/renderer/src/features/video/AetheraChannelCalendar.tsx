import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Sparkles, AlertTriangle, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';

type CalendarView = 'mensal' | 'semanal' | 'lista';
type StatusFilter = 'todos' | 'planned' | 'producing' | 'in_review' | 'scheduled' | 'published';

interface CalendarEntry {
  id: string;
  runId?: string;
  channelName: string;
  title: string;
  topic: string;
  scheduledAtIso: string;
  status: Exclude<StatusFilter, 'todos'>;
  hasConflict?: boolean;
}

const STATUS_META: Record<Exclude<StatusFilter, 'todos'>, { label: string; dotClass: string }> = {
  published: { label: 'Publicado', dotClass: 'bg-emerald-400' },
  scheduled: { label: 'Agendado', dotClass: 'bg-sky-400' },
  in_review: { label: 'Revisão', dotClass: 'bg-amber-400' },
  producing: { label: 'Produção', dotClass: 'bg-slate-400' },
  planned: { label: 'Planejado', dotClass: 'bg-slate-500' },
};

function withConflicts(items: CalendarEntry[]): CalendarEntry[] {
  const conflictIds = new Set<string>();
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const a = items[i];
      const b = items[j];
      if (!a || !b || a.channelName !== b.channelName) continue;
      if (Math.abs(Date.parse(a.scheduledAtIso) - Date.parse(b.scheduledAtIso)) < 60 * 60 * 1_000) {
        conflictIds.add(a.id);
        conflictIds.add(b.id);
      }
    }
  }
  return items.map((item) => ({ ...item, hasConflict: conflictIds.has(item.id) }));
}

function parseBatchPrompt(prompt: string, channelName: string): CalendarEntry[] {
  const clean = prompt.trim();
  const weekdays: { re: RegExp; day: number }[] = [
    { re: /\bdom/iu, day: 0 },
    { re: /\bseg/iu, day: 1 },
    { re: /\bter/iu, day: 2 },
    { re: /\bqua/iu, day: 3 },
    { re: /\bqui/iu, day: 4 },
    { re: /\bsex/iu, day: 5 },
    { re: /\bs[aá]b/iu, day: 6 },
  ];
  const days = weekdays.filter((w) => w.re.test(clean)).map((w) => w.day);
  const targetDays = days.length ? days : [1, 3, 5];
  const timeMatch = /[àa]s?\s*(\d{1,2})(?:h|:(\d{2}))/iu.exec(clean);
  const hour = timeMatch ? Math.min(23, Number(timeMatch[1])) : 18;
  const minute = timeMatch?.[2] ? Math.min(59, Number(timeMatch[2])) : 0;
  const countMatch = /(\d+)\s*v[ií]deos?/iu.exec(clean);
  const total = countMatch ? Math.min(12, Math.max(1, Number(countMatch[1]))) : targetDays.length;

  const base = new Date();
  base.setHours(hour, minute, 0, 0);
  const entries: CalendarEntry[] = [];
  const cursor = new Date(base.getTime());
  for (let guard = 0; guard < 60 && entries.length < total; guard += 1) {
    if (targetDays.includes(cursor.getDay()) && cursor.getTime() >= base.getTime()) {
      const idx = entries.length + 1;
      entries.push({
        id: `planned-${Date.now()}-${idx}`,
        channelName,
        title: `${clean.slice(0, 42)} #${idx}`,
        topic: `${clean} — Episódio ${idx}`,
        scheduledAtIso: cursor.toISOString(),
        status: 'planned',
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return withConflicts(entries);
}

export function AetheraChannelCalendar({ projectId }: { projectId: string | null }) {
  const nav = useNavigate();
  const api = window.neuralbridge.video;
  const [view, setView] = useState<CalendarView>('mensal');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todos');
  const [monthCursor, setMonthCursor] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [planPrompt, setPlanPrompt] = useState('');
  const [autopilotEnabled, setAutopilotEnabled] = useState(false);
  const [approvalPolicy, setApprovalPolicy] = useState<'manual' | 'auto_after_qa' | 'autopilot'>('manual');
  const [plannedItems, setPlannedItems] = useState<CalendarEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  const agenda = useQuery({
    queryKey: ['velix-channel-agenda', projectId],
    queryFn: () => api.channelAgenda(projectId ?? ''),
    enabled: Boolean(projectId),
  });
  const profile = useQuery({
    queryKey: ['velix-channel-profile'],
    queryFn: () => api.channelProfile(),
    retry: false,
  });

  const channelName = profile.data?.title ?? 'Canal Principal';

  const produceItem = useMutation({
    mutationFn: (item: CalendarEntry) => api.aetheraAutoProduce({ projectId: projectId ?? 'default', prompt: item.topic }),
    onSuccess: (next) => { void nav(`/aethera/productions/${next.run.id}`); },
  });

  const allItems = useMemo(() => {
    const remote: CalendarEntry[] = (agenda.data ?? [])
      .filter((item) => item.state !== 'cancelled')
      .map((item) => ({
        id: item.id,
        ...(item.productionId ? { runId: item.productionId } : {}),
        channelName,
        title: item.title,
        topic: item.title,
        scheduledAtIso: item.at,
        status: item.state === 'published' ? 'published' : item.state === 'scheduled' ? 'scheduled' : 'planned',
      }));
    return withConflicts([...remote, ...plannedItems]);
  }, [agenda.data, channelName, plannedItems]);

  const filteredItems = useMemo(
    () => (statusFilter === 'todos' ? allItems : allItems.filter((item) => item.status === statusFilter)),
    [allItems, statusFilter],
  );

  const selectedItem = filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? null;

  const year = monthCursor.getFullYear();
  const month = monthCursor.getMonth();
  const firstDayOffset = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthLabel = monthCursor.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const handleDropOnDay = (day: number) => {
    if (!draggedId) return;
    setPlannedItems((prev) => prev.map((item) => {
      if (item.id !== draggedId) return item;
      const d = new Date(item.scheduledAtIso);
      d.setFullYear(year, month, day);
      return { ...item, scheduledAtIso: d.toISOString() };
    }));
    setDraggedId(null);
  };

  return (
    <section className="sg-panel space-y-4 p-5" aria-label="Calendário editorial e Piloto Automático">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="aethera-workspace__eyebrow">AETHERA-CHANNEL-01</p>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <CalendarIcon className="size-5 text-[var(--aethera-signal)]" aria-hidden="true" />
            Calendário do canal — {channelName}
          </h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(['mensal', 'semanal', 'lista'] as const).map((mode) => (
            <Button key={mode} size="sm" variant={view === mode ? 'default' : 'outline'} onClick={() => setView(mode)}>
              {mode === 'mensal' ? 'Mensal' : mode === 'semanal' ? 'Semanal' : 'Lista'}
            </Button>
          ))}
        </div>
      </div>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          if (!planPrompt.trim()) return;
          setPlannedItems((prev) => [...prev, ...parseBatchPrompt(planPrompt, channelName)]);
          setPlanPrompt('');
        }}
      >
        <input
          className="min-w-[260px] flex-1 rounded-md border border-[var(--sg-border)] bg-transparent px-3 py-1.5 text-sm"
          aria-label="Planejamento editorial por prompt"
          value={planPrompt}
          onChange={(event) => setPlanPrompt(event.target.value)}
          placeholder="Ex.: Planeje 3 vídeos por semana sobre games para segunda, quarta e sexta às 18h"
        />
        <Button size="sm" type="submit" disabled={!planPrompt.trim()}>
          <Sparkles className="size-4" aria-hidden="true" /> Planejar com IA
        </Button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--sg-border)] px-3 py-2 text-xs">
        <label className="flex items-center gap-2 font-medium">
          <input
            type="checkbox"
            checked={autopilotEnabled}
            onChange={(event) => setAutopilotEnabled(event.target.checked)}
          />
          Modo Piloto Automático do Canal
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span>Aprovação:</span>
          <select
            aria-label="Política de aprovação"
            className="rounded border border-[var(--sg-border)] bg-transparent px-2 py-1"
            value={approvalPolicy}
            onChange={(event) => setApprovalPolicy(event.target.value as 'manual' | 'auto_after_qa' | 'autopilot')}
          >
            <option value="manual">Revisão humana antes de publicar</option>
            <option value="auto_after_qa">Automática após Quality Gate</option>
            <option value="autopilot">Piloto automático completo</option>
          </select>
          <select
            aria-label="Filtrar por status"
            className="rounded border border-[var(--sg-border)] bg-transparent px-2 py-1"
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          >
            <option value="todos">Todos os status</option>
            <option value="planned">Planejado</option>
            <option value="producing">Produção</option>
            <option value="in_review">Revisão</option>
            <option value="scheduled">Agendado</option>
            <option value="published">Publicado</option>
          </select>
        </div>
      </div>

      {view === 'mensal' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <strong className="capitalize">{monthLabel}</strong>
            <div className="flex gap-1">
              <Button size="sm" variant="outline" aria-label="Mês anterior" onClick={() => setMonthCursor(new Date(year, month - 1, 1))}><ChevronLeft className="size-4" /></Button>
              <Button size="sm" variant="outline" aria-label="Próximo mês" onClick={() => setMonthCursor(new Date(year, month + 1, 1))}><ChevronRight className="size-4" /></Button>
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs opacity-70">
            {['D', 'S', 'T', 'Q', 'Q', 'S', 'S'].map((d, idx) => <div key={`${d}-${idx}`}>{d}</div>)}
          </div>
          <div className="grid grid-cols-7 gap-1.5">
            {Array.from({ length: firstDayOffset }).map((_, idx) => <div key={`empty-${idx}`} className="min-h-[64px]" />)}
            {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
              const dayItems = filteredItems.filter((item) => {
                const d = new Date(item.scheduledAtIso);
                return d.getFullYear() === year && d.getMonth() === month && d.getDate() === day;
              });
              return (
                <div
                  key={day}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => handleDropOnDay(day)}
                  className="min-h-[68px] rounded-md border border-[var(--sg-border)] p-1.5 text-xs"
                >
                  <div className="font-medium opacity-80">{day}</div>
                  <div className="mt-1 space-y-1">
                    {dayItems.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        draggable
                        onDragStart={() => setDraggedId(item.id)}
                        onClick={() => setSelectedId(item.id)}
                        className="flex w-full items-center gap-1 truncate rounded px-1 py-0.5 text-left hover:bg-white/5"
                        title={`${item.title} (${new Date(item.scheduledAtIso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`}
                      >
                        <span className={`size-2 shrink-0 rounded-full ${STATUS_META[item.status].dotClass}`} />
                        <span className="truncate">{item.title}</span>
                        {item.hasConflict && <AlertTriangle className="size-3 shrink-0 text-amber-400" />}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {view !== 'mensal' && (
        <ul className="space-y-2 text-sm">
          {filteredItems.length === 0 ? (
            <li className="opacity-70">Nenhuma publicação planejada ou agendada neste filtro.</li>
          ) : (
            filteredItems.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--sg-border)] px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className={`size-2.5 rounded-full ${STATUS_META[item.status].dotClass}`} />
                  <div>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-xs opacity-75">{new Date(item.scheduledAtIso).toLocaleString('pt-BR')} · {STATUS_META[item.status].label}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {item.hasConflict && <span className="text-xs text-amber-400">Conflito de horário</span>}
                  <Button size="sm" variant="outline" onClick={() => { if (item.runId) { void nav(`/aethera/productions/${item.runId}`); } else { produceItem.mutate(item); } }}>
                    <Play className="size-3.5" aria-hidden="true" /> {item.runId ? 'Abrir revisão' : 'Produzir agora'}
                  </Button>
                </div>
              </li>
            ))
          )}
        </ul>
      )}

      {selectedItem && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--sg-border)] p-3 text-sm">
          <div>
            <p className="font-semibold">{selectedItem.title}</p>
            <p className="text-xs opacity-75">
              {new Date(selectedItem.scheduledAtIso).toLocaleString('pt-BR')} · {STATUS_META[selectedItem.status].label}
              {selectedItem.hasConflict ? ' · Conflito de horário detectado (arraste para outro dia)' : ''}
            </p>
          </div>
          <Button size="sm" onClick={() => { if (selectedItem.runId) { void nav(`/aethera/productions/${selectedItem.runId}`); } else { produceItem.mutate(selectedItem); } }} disabled={produceItem.isPending}>
            {selectedItem.runId ? 'Abrir na revisão' : produceItem.isPending ? 'Iniciando produção…' : 'Produzir no Automático'}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-4 text-xs opacity-80">
        {(['published', 'scheduled', 'in_review', 'producing'] as const).map((st) => (
          <span key={st} className="flex items-center gap-1.5">
            <span className={`size-2 rounded-full ${STATUS_META[st].dotClass}`} />
            {STATUS_META[st].label}
          </span>
        ))}
      </div>
    </section>
  );
}
