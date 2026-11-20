import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Film,
  FolderPlus,
  ImagePlus,
  Sparkles,
} from 'lucide-react';
import { getPipelineProgressPct } from '../domain/pipeline-engine';
import type { ProductionProject, ProductionStatus } from '../domain/types';
import { useStudio } from '../store/studio-store';

const STATUS_LABELS: Record<ProductionStatus, string> = {
  briefing: 'Briefing',
  producing: 'Em produção',
  awaiting_review: 'Pra aprovar',
  approved: 'Aprovado',
  scheduled: 'Agendado',
};

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];

function getInitials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'AE';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return `${words[0][0]}${words[1][0]}`.toUpperCase();
}

export function HomePage() {
  const { projects, navigate } = useStudio();
  const [selectedDay, setSelectedDay] = useState<number>(20);

  const awaitingReview = useMemo(
    () => projects.filter((p) => p.status === 'awaiting_review'),
    [projects],
  );
  const inQueueCount = useMemo(
    () => projects.filter((p) => p.status === 'briefing' || p.status === 'producing').length,
    [projects],
  );

  const year = 2026;
  const monthIndex = 10; // November
  const daysInMonth = 30;

  const scheduledByDay = useMemo(() => {
    const map = new Map<number, ProductionProject[]>();
    for (const p of projects) {
      if (!p.scheduledDate) continue;
      const [y, m, d] = p.scheduledDate.split('-').map(Number);
      if (y === year && m === monthIndex + 1) {
        const list = map.get(d) ?? [];
        list.push(p);
        map.set(d, list);
      }
    }
    return map;
  }, [projects]);

  const selectedDayProjects = scheduledByDay.get(selectedDay) ?? [];

  const stageMix = useMemo(() => {
    const counts: Array<{ key: ProductionStatus; label: string; count: number; color: string }> = [
      { key: 'briefing', label: 'Briefing', count: 0, color: '#b8a4f4' },
      { key: 'producing', label: 'Produção', count: 0, color: '#d8fb4f' },
      { key: 'awaiting_review', label: 'Revisão', count: 0, color: '#f9a8d4' },
      { key: 'approved', label: 'Aprovado', count: 0, color: '#8fb8d6' },
      { key: 'scheduled', label: 'Agendado', count: 0, color: '#111111' },
    ];
    for (const p of projects) {
      const bucket = counts.find((c) => c.key === p.status);
      if (bucket) bucket.count += 1;
    }
    const max = Math.max(1, ...counts.map((c) => c.count));
    return { counts, max };
  }, [projects]);

  const dominantBucket = useMemo(
    () => [...stageMix.counts].sort((a, b) => b.count - a.count)[0],
    [stageMix.counts],
  );

  return (
    <div className="space-y-4">
      {/* Top Status Strip + Primary CTA */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center gap-3">
        <div className="flex-1 rounded-full bg-white px-5 py-3.5 flex items-center gap-3 shadow-2xs">
          <span className="w-3.5 h-3.5 rounded-full bg-[#b8a4f4] shrink-0" />
          <p className="text-sm sm:text-[15px] text-[#62626c]">
            <strong className="font-semibold text-[#111111]">
              {awaitingReview.length} pra aprovar
            </strong>
            , {inQueueCount} na fila. Produção assistida por IA.
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('production')}
          className="h-13 px-7 rounded-full bg-[#111111] text-white text-sm font-semibold inline-flex items-center justify-center gap-2.5 hover:bg-[#23232b] transition-colors shrink-0 shadow-sm"
        >
          <Sparkles className="w-4 h-4 text-[#d8fb4f]" />
          <span>Gerar vídeo com IA</span>
        </button>
      </div>

      {/* Main 3-Column Bento Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
        {/* Column 1: Pra aprovar */}
        <section
          aria-labelledby="home-approve-heading"
          className="xl:col-span-3 rounded-[28px] bg-white p-5 flex flex-col gap-4 shadow-2xs"
        >
          <div className="flex items-center justify-between gap-2">
            <h2 id="home-approve-heading" className="text-[19px] font-semibold tracking-tight text-[#111111]">
              Pra aprovar
            </h2>
            <span className="px-2.5 py-1 rounded-full bg-[#f4f4f6] text-xs font-semibold text-[#111111]">
              {awaitingReview.length} vídeo{awaitingReview.length === 1 ? '' : 's'}
            </span>
          </div>

          {awaitingReview.length === 0 ? (
            <div className="rounded-3xl bg-[#f4f4f6] p-4 space-y-2.5">
              <p className="text-sm font-semibold text-[#111111]">Nada esperando aprovação.</p>
              <p className="text-xs leading-relaxed text-[#62626c]">
                Pacotes prontos após o pipeline aparecem aqui para revisão final.
              </p>
              <button
                type="button"
                onClick={() => navigate('review')}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#111111] hover:text-[#6a46d8] pt-1"
              >
                <span>Abrir Sala de Revisão</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="space-y-2.5">
              {awaitingReview.map((proj) => (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() => navigate('review', proj.id)}
                  className="w-full text-left rounded-3xl bg-[#efe9fd] hover:bg-[#e4d9fb] p-4 transition-colors space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="px-2.5 py-0.5 rounded-full bg-[#b8a4f4] text-[#111111] text-[11px] font-semibold">
                      {proj.style}
                    </span>
                    <span className="text-[11px] font-mono text-[#2a1d5c]">
                      ~{proj.durationMin} min
                    </span>
                  </div>
                  <div className="text-sm font-semibold text-[#111111] leading-snug">
                    {proj.title}
                  </div>
                  <div className="inline-flex items-center gap-1 text-xs font-semibold text-[#111111]">
                    <span>Revisar &amp; aprovar</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {/* Column 2: Agenda + Bottom Row */}
        <div className="xl:col-span-6 space-y-4">
          <section
            aria-labelledby="home-agenda-heading"
            className="rounded-[28px] bg-white p-5 shadow-2xs"
          >
            <div className="flex items-center justify-between gap-2 mb-4">
              <h2 id="home-agenda-heading" className="text-[19px] font-semibold tracking-tight text-[#111111]">
                Agenda
              </h2>
              <button
                type="button"
                onClick={() => navigate('calendar')}
                className="inline-flex items-center gap-2 text-xs text-[#62626c] hover:text-[#111111]"
              >
                <span>Calendário</span>
                <span className="px-3 py-1 rounded-full bg-[#f4f4f6] font-semibold text-[#111111]">
                  nov 2026
                </span>
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-start">
              <div className="md:col-span-7">
                <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-[#62626c] mb-2">
                  {WEEKDAYS.map((day) => (
                    <span key={day}>{day}</span>
                  ))}
                </div>
                <div className="grid grid-cols-7 gap-1.5">
                  {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                    const isToday = day === 20;
                    const isSelected = day === selectedDay;
                    const hasScheduled = scheduledByDay.has(day);
                    return (
                      <button
                        key={day}
                        type="button"
                        onClick={() => setSelectedDay(day)}
                        aria-label={`Dia ${day} de novembro`}
                        aria-pressed={isSelected}
                        className={`h-8 rounded-full text-xs font-semibold transition-all flex items-center justify-center ${
                          isToday
                            ? 'bg-[#d8fb4f] text-[#111111] ring-2 ring-[#111111]'
                            : isSelected
                              ? 'bg-[#111111] text-white'
                              : hasScheduled
                                ? 'bg-[#b8a4f4] text-[#111111]'
                                : 'bg-[#f4f4f6] text-[#1c1c22] hover:bg-[#e3e3e8]'
                        }`}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="md:col-span-5 rounded-3xl bg-[#f4f4f6] p-4 min-h-[168px] flex flex-col justify-between">
                <div className="flex items-center justify-between text-xs mb-2">
                  <span className="font-semibold text-[#111111]">{selectedDay} nov</span>
                  <span className="text-[#62626c]">{projects.length} projetos</span>
                </div>

                {selectedDayProjects.length === 0 ? (
                  <div className="rounded-2xl bg-white p-3.5 text-xs leading-relaxed text-[#62626c]">
                    Nenhuma publicação agendada para este dia. Aprove um pacote ou agende no Calendário.
                  </div>
                ) : (
                  <div className="space-y-2">
                    {selectedDayProjects.map((proj) => (
                      <button
                        key={proj.id}
                        type="button"
                        onClick={() => navigate('calendar', proj.id)}
                        className="w-full text-left rounded-2xl bg-white p-3 hover:ring-2 hover:ring-[#b8a4f4] transition-all"
                      >
                        <div className="text-xs font-semibold text-[#111111] line-clamp-2">
                          {proj.title}
                        </div>
                        <div className="mt-1 text-[11px] text-[#62626c]">
                          {STATUS_LABELS[proj.status]} • {proj.aspectRatio}
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => navigate('calendar')}
                  className="mt-3 text-xs font-semibold text-[#111111] hover:text-[#6a46d8] inline-flex items-center gap-1"
                >
                  <span>Gerenciar agenda</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </section>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <section
              aria-labelledby="home-mix-heading"
              className="rounded-[28px] bg-white p-5 shadow-2xs flex flex-col justify-between min-h-[248px]"
            >
              <div>
                <div className="flex items-center justify-between">
                  <h2 id="home-mix-heading" className="text-[19px] font-semibold tracking-tight text-[#111111]">
                    Mix de etapas
                  </h2>
                  <span className="w-8 h-8 rounded-full bg-[#f4f4f6] text-xs font-bold flex items-center justify-center">
                    {projects.length}
                  </span>
                </div>
                <p className="text-xs text-[#62626c] mt-0.5">projetos no estúdio</p>
              </div>

              <div className="grid grid-cols-5 gap-1.5 mt-5">
                {stageMix.counts.map((item) => {
                  const barHeightPx =
                    item.count === 0 ? 12 : Math.max(24, Math.round((item.count / stageMix.max) * 76));
                  return (
                    <div key={item.key} className="flex flex-col items-center gap-1.5 min-w-0">
                      <span className="text-[11px] font-semibold text-[#111111] leading-none">
                        {item.count}
                      </span>
                      <div className="w-full h-20 flex items-end justify-center">
                        <div
                          className="w-full max-w-[32px] rounded-full transition-all"
                          style={{
                            height: `${barHeightPx}px`,
                            backgroundColor: item.count > 0 ? item.color : '#e3e3e8',
                          }}
                        />
                      </div>
                      <span className="text-[9.5px] tracking-tight text-[#62626c] text-center leading-tight truncate w-full">
                        {item.label}
                      </span>
                    </div>
                  );
                })}
              </div>

              <p className="text-xs text-[#62626c] mt-3">
                Maior volume em <strong className="text-[#111111]">{dominantBucket?.label ?? 'Briefing'}</strong>
              </p>
            </section>

            <section
              aria-labelledby="home-auto-heading"
              className="rounded-[28px] bg-[#f9a8d4] text-[#111111] p-5 shadow-2xs flex flex-col justify-between min-h-[248px]"
            >
              <div>
                <div className="inline-flex items-center gap-2 text-xs font-semibold">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#d8fb4f]" />
                  <span>Produção automática</span>
                </div>
                <h2 id="home-auto-heading" className="mt-3 text-[24px] leading-[1.15] font-bold tracking-tight">
                  <em className="italic">Roteiro, voz</em> e render sem você pedir.
                </h2>
                <p className="mt-2 text-xs text-[#111111]/80 leading-relaxed">
                  Pipeline em 9 etapas com storyboard, FFmpeg real, Creative Studio e revisão cirúrgica.
                </p>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => navigate('manual_projects')}
                  className="h-10 px-4 rounded-full bg-[#111111] text-white text-xs font-semibold inline-flex items-center gap-2 hover:bg-[#24242c]"
                >
                  <FolderPlus className="w-3.5 h-3.5" />
                  <span>Novo projeto</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigate('creative')}
                  className="h-10 px-4 rounded-full bg-white text-[#111111] text-xs font-semibold inline-flex items-center gap-2 hover:bg-[#f4f4f6]"
                >
                  <ImagePlus className="w-3.5 h-3.5" />
                  <span>Thumbs &amp; Artes</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigate('editor')}
                  className="h-10 px-4 rounded-full bg-white text-[#111111] text-xs font-semibold inline-flex items-center gap-2 hover:bg-[#f4f4f6]"
                >
                  <Film className="w-3.5 h-3.5" />
                  <span>Editor</span>
                </button>
              </div>
            </section>
          </div>
        </div>

        {/* Column 3: Recentes */}
        <section
          aria-labelledby="home-recent-heading"
          className="xl:col-span-3 rounded-[28px] bg-white p-5 shadow-2xs flex flex-col gap-3"
        >
          <div className="flex items-center justify-between">
            <h2 id="home-recent-heading" className="text-[19px] font-semibold tracking-tight text-[#111111]">
              Recentes
            </h2>
            <span className="w-8 h-8 rounded-full bg-[#f4f4f6] text-xs font-bold flex items-center justify-center">
              {projects.length}
            </span>
          </div>

          <div className="space-y-2.5">
            {projects.slice(0, 5).map((proj) => {
              const pct = getPipelineProgressPct(proj.stages);
              return (
                <button
                  key={proj.id}
                  type="button"
                  onClick={() =>
                    navigate(proj.status === 'awaiting_review' ? 'review' : 'manual_projects', proj.id)
                  }
                  className="w-full text-left rounded-3xl bg-[#f4f4f6] hover:bg-[#ececf2] p-3.5 flex items-start gap-3 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-white text-xs font-bold text-[#111111] flex items-center justify-center shrink-0">
                    {getInitials(proj.title)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-[#111111] truncate">{proj.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <span className="px-2 py-0.5 rounded-full bg-[#efe8ff] text-[#6a46d8] text-[11px] font-semibold">
                        {STATUS_LABELS[proj.status]}
                      </span>
                      <span className="text-[11px] text-[#62626c] font-mono">{pct}%</span>
                    </div>
                    <div className="mt-1 text-[11px] text-[#62626c]">
                      {proj.style} • ~{proj.durationMin} min
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => navigate('pipeline')}
            className="pt-1 text-xs font-semibold text-[#111111] hover:text-[#6a46d8] inline-flex items-center gap-1.5"
          >
            <span>Ver fila do pipeline</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </section>
      </div>
    </div>
  );
}
