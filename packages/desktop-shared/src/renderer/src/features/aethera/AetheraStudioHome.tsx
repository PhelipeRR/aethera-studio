import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, FolderPlus, LayoutTemplate, Sparkles, Upload } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import type { ContentQueueItem } from '@neuralbridge/shared';
import { healthOf, useAgents } from '@/app/useAgents';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'] as const;
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'] as const;

const STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  active: 'Em produção',
  paused: 'Pausado',
  completed: 'Concluído',
  archived: 'Arquivado',
};
const AUTONOMY_LABEL: Record<string, string> = { manual: 'Manual', assisted: 'Assistido', autonomous: 'Autônomo' };
const KIND_LABEL: Record<ContentQueueItem['nextAction']['kind'], string> = {
  briefing: 'Briefing',
  script: 'Roteiro',
  production: 'Produção',
  package: 'Pacote',
  thumbnail: 'Thumb',
  publication: 'Publicação',
  analytics: 'Analytics',
};
const KIND_ORDER = Object.keys(KIND_LABEL) as ContentQueueItem['nextAction']['kind'][];

const HIGHLIGHTS = ['bg-[var(--brand-lavender)]', 'bg-[var(--brand-lime)]'] as const;

function isAwaitingApproval(item: ContentQueueItem): boolean {
  return (
    item.latestPackageStatus === 'awaiting_approval' ||
    item.latestExecutionStatus === 'awaiting_approval' ||
    item.nextAction.kind === 'package'
  );
}

function isOpen(item: ContentQueueItem): boolean {
  return item.project.status !== 'completed' && item.project.status !== 'archived';
}

function initials(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  const [first = '', second = ''] = words;
  return (second ? `${first.charAt(0)}${second.charAt(0)}` : title.slice(0, 2)).toUpperCase();
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function formatSlot(iso: string): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${WEEKDAYS[date.getDay()]} ${date.getDate()} · ${time}`;
}

function Block({ className, children, ...rest }: React.ComponentProps<'section'>) {
  return (
    <section className={cn('rounded-[28px] bg-card p-6', className)} {...rest}>
      {children}
    </section>
  );
}

function BlockHeader({ id, title, count, action }: { id: string; title: string; count?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      <h2 id={id} className="text-xl font-semibold tracking-tight text-foreground">
        {title}
      </h2>
      <div className="flex items-center gap-2">
        {action}
        {count != null && (
          <span className="rounded-full bg-secondary px-3.5 py-1.5 text-sm font-medium text-foreground">{count}</span>
        )}
      </div>
    </div>
  );
}

function Avatar({ title, className }: { title: string; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-12 shrink-0 items-center justify-center rounded-full bg-[var(--brand-ink)] text-xs font-bold tracking-wide text-white',
        className,
      )}
    >
      {initials(title)}
    </span>
  );
}

function MetaDots({ items }: { items: string[] }) {
  return (
    <ul className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm font-medium">
      {items.map((label) => (
        <li key={label} className="inline-flex items-center gap-2">
          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
          {label}
        </li>
      ))}
    </ul>
  );
}

export function AetheraStudioHome() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { agents } = useAgents();

  const queue = useQuery({
    queryKey: ['aethera-content-queue', 'default'],
    queryFn: () => window.neuralbridge.content.queue('default'),
  });
  const channels = useQuery({
    queryKey: ['aethera-content-channels'],
    queryFn: () => window.neuralbridge.content.channels(),
  });
  const videoSettings = useQuery({
    queryKey: ['video-settings'],
    queryFn: () => window.neuralbridge.video.settings(),
  });

  const createProject = useMutation({
    mutationFn: () =>
      window.neuralbridge.content.createProject({
        id: crypto.randomUUID(),
        workspaceId: 'default',
        channelId: channels.data?.[0]?.id ?? null,
        videoProjectId: videoSettings.data?.projectId ?? null,
        title: 'Nova Produção Cinematográfica',
        autonomy: 'assisted',
      }),
    onSuccess: (project) => {
      void client.invalidateQueries({ queryKey: ['aethera-content-projects', 'default'] });
      void client.invalidateQueries({ queryKey: ['aethera-content-queue', 'default'] });
      navigate(`/aethera/projects/${project.id}`);
    },
  });

  const items = React.useMemo(() => queue.data ?? [], [queue.data]);
  const openItems = items.filter(isOpen);
  const approvals = openItems.filter(isAwaitingApproval);
  const scheduled = React.useMemo(
    () =>
      items
        .filter((i) => i.latestPublicationScheduledAt && i.latestPublicationStatus === 'scheduled')
        .sort((a, b) => (a.latestPublicationScheduledAt ?? '').localeCompare(b.latestPublicationScheduledAt ?? '')),
    [items],
  );
  const recent = React.useMemo(
    () => [...items].sort((a, b) => b.project.updatedAt.localeCompare(a.project.updatedAt)).slice(0, 8),
    [items],
  );
  const autonomousChannels = (channels.data ?? []).filter((c) => c.autonomy === 'autonomous').length;
  const readyAgents = (agents ?? []).filter((a) => healthOf(a) === 'ready').length;

  // Calendar state: current month, the selected day defaults to today.
  const today = React.useMemo(() => new Date(), []);
  const [selectedKey, setSelectedKey] = React.useState(() => dayKey(today));
  const scheduledByDay = React.useMemo(() => {
    const map = new Map<string, ContentQueueItem[]>();
    for (const item of scheduled) {
      const key = dayKey(new Date(item.latestPublicationScheduledAt as string));
      map.set(key, [...(map.get(key) ?? []), item]);
    }
    return map;
  }, [scheduled]);
  const year = today.getFullYear();
  const month = today.getMonth();
  const firstWeekday = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const selectedItems = scheduledByDay.get(selectedKey) ?? [];
  const upcoming = selectedItems.length > 0 ? selectedItems : scheduled.filter((i) => new Date(i.latestPublicationScheduledAt as string) >= today).slice(0, 3);
  const selectedDay = Number(selectedKey.split('-')[2]);

  const mix = KIND_ORDER.map((kind) => ({ kind, count: openItems.filter((i) => i.nextAction.kind === kind).length }));
  const mixMax = Math.max(1, ...mix.map((m) => m.count));
  const mixTopKind = mix.reduce<{ kind: ContentQueueItem['nextAction']['kind'] | null; count: number }>((top, m) => (m.count > top.count ? m : top), { kind: null, count: 0 }).kind;

  const summary = queue.isLoading ? (
    <span className="text-muted-foreground">Carregando a fila do estúdio...</span>
  ) : (
    <>
      <strong className="font-semibold">{approvals.length} pra aprovar</strong>
      <span className="text-muted-foreground">
        , {openItems.length} na fila
        {scheduled.length > 0 ? `, ${scheduled.length} agendado(s).` : '.'}
        {autonomousChannels > 0 ? ` Produção automática em ${autonomousChannels} canal(is).` : ' Produção assistida por IA.'}
      </span>
    </>
  );

  return (
    <div className="space-y-5 p-5 xl:p-6">
      {/* Status + primary action */}
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <p
          role="status"
          className="flex min-h-[72px] items-center gap-4 rounded-full bg-card px-7 text-base md:text-lg"
        >
          <span className="size-5 shrink-0 rounded-full bg-[var(--brand-lavender)]" aria-hidden="true" />
          <span className="min-w-0">{summary}</span>
        </p>
        <Link
          to="/aethera/cinema"
          className="flex min-h-[72px] cursor-pointer items-center justify-center gap-3 rounded-full bg-primary px-8 text-base font-semibold text-primary-foreground transition-opacity duration-200 hover:opacity-90 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-ring md:text-lg"
        >
          <Sparkles className="size-5 text-[var(--brand-lime)]" aria-hidden="true" /> Gerar vídeo com IA
        </Link>
      </div>

      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,1fr)]">
        {/* Pra aprovar */}
        <Block aria-labelledby="home-approvals" className="xl:row-span-2">
          <BlockHeader
            id="home-approvals"
            title="Pra aprovar"
            count={`${approvals.length} ${approvals.length === 1 ? 'vídeo' : 'vídeos'}`}
          />
          {approvals.length === 0 ? (
            <div className="rounded-3xl bg-secondary p-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nada esperando aprovação.</p>
              <p className="mt-1">Pacotes prontos para revisão aparecem aqui.</p>
              <Link to="/aethera/review" className="mt-4 inline-flex items-center gap-1.5 font-medium text-foreground underline-offset-4 hover:underline">
                Abrir Sala de Revisão <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
            </div>
          ) : (
            <ul className="space-y-3">
              {approvals.slice(0, 6).map((item, index) => (
                <li key={item.project.id}>
                  <Link
                    to={`/aethera/projects/${item.project.id}/package`}
                    className={cn(
                      'block cursor-pointer rounded-3xl p-5 text-[var(--brand-ink)] transition-shadow duration-200 hover:shadow-[var(--elevation-2)] focus-visible:outline-3 focus-visible:outline-ring',
                      HIGHLIGHTS[index] ?? 'bg-card shadow-[var(--elevation-1)]',
                    )}
                  >
                    <div className="flex items-center gap-4">
                      <Avatar title={item.project.title} />
                      <div className="min-w-0">
                        <p className="truncate text-base font-semibold">{item.project.title}</p>
                        <p className="truncate text-sm opacity-75">{item.nextAction.label}</p>
                      </div>
                    </div>
                    <MetaDots
                      items={[
                        KIND_LABEL[item.nextAction.kind],
                        STATUS_LABEL[item.project.status] ?? item.project.status,
                        AUTONOMY_LABEL[item.project.autonomy] ?? item.project.autonomy,
                      ]}
                    />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Block>

        {/* Agenda */}
        <Block aria-labelledby="home-agenda" className="@container md:col-span-2 xl:col-span-1">
          <BlockHeader
            id="home-agenda"
            title="Agenda"
            count={`${MONTHS[month]} ${year}`}
            action={
              <Link to="/aethera/calendar" className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                Calendário
              </Link>
            }
          />
          <div className="grid gap-5 @md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)]">
            <div aria-label={`Agenda de ${MONTHS[month]} ${year}`} role="group">
              <div aria-hidden="true" className="mb-2 grid grid-cols-7 text-center text-sm text-muted-foreground">
                {WEEKDAYS.map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1.5">
                {Array.from({ length: firstWeekday }, (_, i) => (
                  <span key={`pad-${i}`} aria-hidden="true" />
                ))}
                {Array.from({ length: daysInMonth }, (_, i) => {
                  const day = i + 1;
                  const date = new Date(year, month, day);
                  const key = dayKey(date);
                  const count = scheduledByDay.get(key)?.length ?? 0;
                  const isToday = day === today.getDate();
                  const isPast = date < new Date(year, month, today.getDate());
                  const isSelected = key === selectedKey;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={isSelected}
                      aria-label={`${day} de ${MONTHS[month]}${isToday ? ', hoje' : ''}${count ? `, ${count} agendado(s)` : ''}`}
                      onClick={() => setSelectedKey(key)}
                      className={cn(
                        'mx-auto flex aspect-square w-full max-w-12 cursor-pointer items-center justify-center rounded-full text-sm font-medium transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                        isToday
                          ? 'bg-[var(--brand-lime)] text-[var(--brand-ink)]'
                          : count > 0
                            ? 'bg-[var(--brand-lavender)] text-[var(--brand-ink)]'
                            : isPast
                              ? 'bg-secondary/60 text-muted-foreground'
                              : 'bg-secondary text-foreground hover:bg-[var(--brand-lavender-soft)]',
                        isSelected && 'ring-2 ring-[var(--brand-ink)] ring-offset-2 ring-offset-card',
                      )}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-3xl bg-secondary p-3">
              <div className="flex items-center justify-between px-2 pb-3 pt-1 text-sm">
                <span className="font-semibold">{selectedDay} {MONTHS[month]}</span>
                <span className="text-muted-foreground">{openItems.length} na fila</span>
              </div>
              {upcoming.length === 0 ? (
                <p className="rounded-2xl bg-card p-4 text-sm text-muted-foreground">
                  Nenhuma publicação agendada. Aprove um pacote e agende na Publicação.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {upcoming.map((item) => (
                    <li key={item.project.id}>
                      <Link
                        to={`/aethera/projects/${item.project.id}`}
                        className="block cursor-pointer rounded-2xl bg-card p-3 transition-shadow duration-200 hover:shadow-[var(--elevation-1)] focus-visible:outline-2 focus-visible:outline-ring"
                      >
                        <div className="flex aspect-[16/7] items-center justify-center rounded-xl bg-[#f3efe6] px-3 text-center text-sm font-extrabold uppercase leading-tight text-[var(--brand-ink)]">
                          <span className="line-clamp-2">{item.project.title}</span>
                        </div>
                        <p className="mt-2.5 text-xs text-muted-foreground">{formatSlot(item.latestPublicationScheduledAt as string)}</p>
                        <span className="mt-2 inline-block rounded-lg bg-[var(--chip-blue-bg)] px-2.5 py-1 text-xs font-medium text-[var(--chip-blue-fg)]">
                          Agendado
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Block>

        {/* Projetos recentes */}
        <Block aria-labelledby="home-recent" className="md:col-span-2 xl:col-span-1 xl:row-span-2">
          <BlockHeader
            id="home-recent"
            title="Recentes"
            count={items.length}
          />
          {recent.length === 0 ? (
            <div className="rounded-3xl bg-secondary p-6 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Nenhum projeto ainda.</p>
              <p className="mt-1">Gere um vídeo com IA ou crie um projeto manual.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {recent.map((item, index) => (
                <li key={item.project.id}>
                  <Link
                    to={`/aethera/projects/${item.project.id}`}
                    className="flex cursor-pointer items-center gap-4 rounded-3xl bg-secondary p-4 transition-colors duration-200 hover:bg-[var(--brand-lavender-soft)] focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <Avatar title={item.project.title} className="bg-card text-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-base font-semibold text-foreground">{item.project.title}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2.5 text-sm">
                        <span
                          className={cn(
                            'rounded-lg px-2.5 py-0.5 font-medium',
                            index % 2 === 0
                              ? 'bg-[var(--chip-violet-bg)] text-[var(--chip-violet-fg)]'
                              : 'bg-[var(--chip-blue-bg)] text-[var(--chip-blue-fg)]',
                          )}
                        >
                          {KIND_LABEL[item.nextAction.kind]}
                        </span>
                        <span className="text-muted-foreground">{STATUS_LABEL[item.project.status] ?? item.project.status}</span>
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
              <li>
                <Link to="/aethera/projects" className="inline-flex items-center gap-1.5 px-2 pt-1 text-sm font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline">
                  Ver todos os projetos <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </li>
            </ul>
          )}
        </Block>

        {/* Mix + Produção automática */}
        <div className="grid gap-5 md:col-span-2 lg:grid-cols-2 xl:col-span-1 xl:col-start-2">
          <Block aria-labelledby="home-mix">
            <BlockHeader id="home-mix" title="Mix de etapas" count={openItems.length} />
            <p className="-mt-4 mb-5 text-sm text-muted-foreground">projetos em andamento</p>
            <ul className="flex h-40 items-end justify-between gap-1.5" aria-label="Projetos por próxima etapa">
              {mix.map(({ kind, count }) => (
                <li key={kind} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
                  <span
                    title={`${KIND_LABEL[kind]}: ${count}`}
                    className={cn(
                      'w-full max-w-9 rounded-full transition-[height] duration-300',
                      kind === mixTopKind ? 'bg-[var(--brand-lavender)]' : 'bg-[var(--brand-lime)]',
                    )}
                    style={{ height: `${Math.max(12, (count / mixMax) * 100)}%` }}
                  />
                  <span className="sr-only">{KIND_LABEL[kind]}: {count}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-sm text-muted-foreground">
              {mixTopKind ? (
                <>
                  Mais projetos em <strong className="font-semibold text-foreground">{KIND_LABEL[mixTopKind]}</strong>
                </>
              ) : (
                'Nenhum projeto em andamento.'
              )}
            </p>
          </Block>

          <section
            aria-labelledby="home-auto"
            className="flex flex-col justify-between gap-6 rounded-[28px] bg-[var(--brand-pink)] p-6 text-[var(--brand-ink)]"
          >
            <div>
              <p className="inline-flex items-center gap-2 text-sm font-medium">
                <span className="size-2.5 rounded-full bg-[var(--brand-lime)]" aria-hidden="true" /> Produção automática
              </p>
              <h2 id="home-auto" className="mt-4 text-3xl font-semibold leading-tight tracking-tight">
                <em className="font-extrabold">Roteiro, voz</em> e render sem você pedir.
              </h2>
              <p className="mt-2 text-sm opacity-80">
                {readyAgents > 0 ? `${readyAgents} motor(es) de IA prontos.` : 'Conecte um motor de IA em Agentes para começar.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => createProject.mutate()}
                disabled={createProject.isPending}
                className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-[var(--brand-ink)] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brand-ink)] disabled:cursor-wait disabled:opacity-60"
              >
                <FolderPlus className="size-4" aria-hidden="true" />
                {createProject.isPending ? 'Criando...' : 'Novo projeto'}
              </button>
              <Link
                to="/aethera/library"
                className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-white/70 px-4 text-sm font-medium transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-[var(--brand-ink)]"
              >
                <Upload className="size-4" aria-hidden="true" /> Importar mídia
              </Link>
              <Link
                to="/video"
                className="inline-flex h-11 cursor-pointer items-center gap-2 rounded-full bg-white/70 px-4 text-sm font-medium transition-colors hover:bg-white focus-visible:outline-2 focus-visible:outline-[var(--brand-ink)]"
              >
                <LayoutTemplate className="size-4" aria-hidden="true" /> Editor
              </Link>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
