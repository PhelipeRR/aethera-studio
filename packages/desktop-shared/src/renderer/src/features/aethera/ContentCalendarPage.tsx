import { useQuery } from '@tanstack/react-query';
import { CalendarDays } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '@/app/PageHeader';

export function ContentCalendarPage() {
  const queue = useQuery({ queryKey: ['aethera-content-queue', 'default'], queryFn: () => window.neuralbridge.content.queue('default') });
  const scheduled = (queue.data ?? []).filter((item) => item.latestPublicationStatus === 'scheduled' && item.latestPublicationScheduledAt).sort((a, b) => (a.latestPublicationScheduledAt ?? '').localeCompare(b.latestPublicationScheduledAt ?? ''));
  return <><PageHeader title="Calendário de publicações" description="Pacotes aprovados e horários agendados por projeto." /><main className="space-y-6 px-6 py-6 xl:px-8"><section className="sg-panel rounded-2xl p-5"><div className="flex items-center gap-2"><CalendarDays className="size-5 text-primary" /><h2 className="text-lg font-medium">Próximas publicações</h2></div>{queue.isLoading ? <p className="mt-5 text-sm text-muted-foreground">Carregando calendário…</p> : scheduled.length ? <ol className="mt-5 space-y-3">{scheduled.map((item) => <li key={item.project.id} className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4"><div><Link to={`/aethera/projects/${item.project.id}`} className="font-medium hover:text-primary">{item.project.title}</Link><p className="mt-1 text-xs text-muted-foreground">YouTube · {new Date(item.latestPublicationScheduledAt ?? '').toLocaleString('pt-BR')}</p></div><span className="rounded-full bg-primary/10 px-3 py-1 text-xs text-primary">Agendado</span></li>)}</ol> : <p className="mt-5 rounded-lg border border-dashed p-5 text-sm text-muted-foreground">Nenhuma publicação agendada. Agende um pacote aprovado no projeto.</p>}</section></main></>;
}
