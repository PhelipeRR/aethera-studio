import { useMemo, useState } from 'react';
import { AlertTriangle, Calendar as CalendarIcon, CheckCircle2, Trash2 } from 'lucide-react';
import { detectCalendarConflicts } from '../domain/pipeline-engine';
import { useStudio } from '../store/studio-store';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

export function CalendarPage() {
  const { projects, activeProject, scheduleProject, navigate } = useStudio();
  const [selectedProjectId, setSelectedProjectId] = useState(activeProject?.id ?? projects[0]?.id ?? '');
  const [dateInput, setDateInput] = useState('2026-11-25');
  const [notice, setNotice] = useState<string | null>(null);

  const conflicts = useMemo(
    () => detectCalendarConflicts(projects, dateInput, selectedProjectId),
    [projects, dateInput, selectedProjectId],
  );

  const scheduledProjects = useMemo(
    () =>
      projects
        .filter((p) => Boolean(p.scheduledDate))
        .sort((a, b) => (a.scheduledDate ?? '').localeCompare(b.scheduledDate ?? '')),
    [projects],
  );

  const handleSchedule = async () => {
    const pid = selectedProjectId || projects[0]?.id;
    if (!pid || !dateInput) return;
    await scheduleProject(pid, dateInput);
    const proj = projects.find((p) => p.id === pid);
    setNotice(`"${proj?.title ?? 'Projeto'}" agendado para ${dateInput} no SQLite.`);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-[28px] bg-white px-6 py-5 flex flex-wrap items-center justify-between gap-4 shadow-2xs">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[#111111]">Calendário Editorial</h1>
          <p className="text-xs text-[#62626c]">
            Agende publicações aprovadas com detecção automática de conflitos de data.
          </p>
        </div>
        <span className="h-9 px-4 rounded-full bg-[#efe9fd] text-[#111111] text-xs font-semibold inline-flex items-center gap-2">
          <CalendarIcon className="w-3.5 h-3.5 text-[#6a46d8]" />
          <span>Novembro 2026</span>
        </span>
      </div>

      {notice && (
        <div className="rounded-2xl bg-[#f3fdd0] px-4 py-2.5 text-xs font-semibold text-[#111111] flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-[#2f7d32]" />
          <span>{notice}</span>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        <section className="xl:col-span-8 rounded-[28px] bg-white p-5 shadow-2xs">
          <div className="grid grid-cols-7 gap-2 text-center text-xs font-semibold text-[#62626c] mb-3">
            {WEEKDAYS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 30 }, (_, i) => i + 1).map((day) => {
              const iso = `2026-11-${String(day).padStart(2, '0')}`;
              const items = projects.filter((p) => p.scheduledDate === iso);
              const isToday = day === 20;
              const isSelected = dateInput === iso;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setDateInput(iso)}
                  className={`min-h-[82px] rounded-2xl p-2 text-left flex flex-col justify-between transition-all ${
                    isSelected
                      ? 'bg-[#111111] text-white'
                      : isToday
                        ? 'bg-[#f3fdd0] ring-2 ring-[#111111] text-[#111111]'
                        : items.length > 0
                          ? 'bg-[#efe9fd] text-[#111111]'
                          : 'bg-[#f4f4f6] text-[#111111] hover:bg-[#e8e8ee]'
                  }`}
                >
                  <span className="text-xs font-bold">{day}</span>
                  <div className="space-y-1">
                    {items.slice(0, 2).map((item) => (
                      <div
                        key={item.id}
                        className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md truncate ${
                          isSelected ? 'bg-[#d8fb4f] text-[#111111]' : 'bg-white text-[#111111]'
                        }`}
                      >
                        {item.title}
                      </div>
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <aside className="xl:col-span-4 space-y-4">
          <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-3.5">
            <h2 className="text-base font-bold text-[#111111]">Agendar Publicação</h2>

            <div>
              <label htmlFor="cal-project" className="block text-xs font-semibold text-[#111111] mb-1">
                Produção
              </label>
              <select
                id="cal-project"
                value={selectedProjectId}
                onChange={(e) => setSelectedProjectId(e.target.value)}
                className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs font-medium text-[#111111]"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="cal-date" className="block text-xs font-semibold text-[#111111] mb-1">
                Data de publicação
              </label>
              <input
                id="cal-date"
                type="date"
                value={dateInput}
                onChange={(e) => setDateInput(e.target.value)}
                className="w-full h-10 rounded-2xl bg-[#f4f4f6] border border-[#e3e3e8] px-3 text-xs font-mono text-[#111111]"
              />
            </div>

            {conflicts.length > 0 && (
              <div className="rounded-2xl bg-[#fde7f3] p-3 text-xs text-[#111111] flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-[#b42840] shrink-0 mt-0.5" />
                <div>
                  <strong>Conflito de agenda:</strong> já existe {conflicts.length} publicação neste dia (
                  {conflicts[0].title}).
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => void handleSchedule()}
              className="w-full h-10 rounded-full bg-[#111111] text-white text-xs font-semibold hover:bg-[#24242c]"
            >
              Confirmar Agendamento
            </button>
          </section>

          <section className="rounded-[28px] bg-white p-5 shadow-2xs space-y-2.5">
            <h2 className="text-sm font-bold text-[#111111]">
              Próximas Publicações ({scheduledProjects.length})
            </h2>
            {scheduledProjects.map((proj) => (
              <div
                key={proj.id}
                className="rounded-2xl bg-[#f4f4f6] p-3 flex items-center justify-between gap-2"
              >
                <button
                  type="button"
                  onClick={() => navigate('review', proj.id)}
                  className="text-left min-w-0 flex-1"
                >
                  <div className="text-xs font-bold text-[#111111] truncate">{proj.title}</div>
                  <div className="text-[11px] font-mono text-[#6a46d8]">{proj.scheduledDate}</div>
                </button>
                <button
                  type="button"
                  onClick={() => void scheduleProject(proj.id, null)}
                  aria-label={`Remover agendamento de ${proj.title}`}
                  className="p-1.5 rounded-lg bg-white text-[#62626c] hover:text-[#d23c4f]"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </div>
  );
}
