import { useState } from 'react';
import { Activity, ArrowLeft, Clock3, MessageSquare, TriangleAlert } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { AGENT_IDS, TASK_STATUSES, type AgentId, type TaskStatus } from '@neuralbridge/shared/domain';
import type { TaskListFilter } from '@neuralbridge/shared/tasks';
import { PageHeader } from '@/app/PageHeader';
import { Field, Input, Select } from '@/components/ui/field';
import { errorMessage, formatWhen } from '@/features/brain/format';
import { cn } from '@/lib/utils';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/FeedbackState';
import { VirtualList } from '@/components/performance/VirtualList';
import { useProjectList } from '@/features/projects/api';
import { useTask, useTaskList, useTaskUpdates } from './api';
import { AGENT_LABEL, formatCost, formatDuration, formatTokens, MODE_LABEL, STATUS_LABEL } from './labels';
import { AgentDot, StatusBadge, TaskCard } from './TaskCard';

export function RunsPage({ description }: { description: string }) {
  useTaskUpdates();
  const projects = useProjectList();
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [projectId, setProjectId] = useState('');
  const [agent, setAgent] = useState<AgentId | ''>('');
  const [query, setQuery] = useState('');
  const filter: TaskListFilter = {
    ...(status ? { status } : {}),
    ...(projectId ? { projectId } : {}),
    ...(agent ? { agent } : {}),
    ...(query.trim() ? { query: query.trim() } : {}),
  };
  const runs = useTaskList(filter);
  const filtered = Object.keys(filter).length > 0;
  const summary = runs.data?.reduce((counts, run) => { counts[run.status] = (counts[run.status] ?? 0) + 1; return counts; }, {} as Partial<Record<TaskStatus, number>>) ?? {};

  return (
    <>
      <PageHeader title="Execuções" description={description} />
      <div data-tour="runs-list" className="space-y-5 px-6 py-6 xl:px-8">
        <section className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/20 bg-card/70 px-4 py-3" aria-label="Resumo das execuções">
          <Activity className="size-4 text-primary" aria-hidden="true" />
          <span className="text-sm font-medium">Estado das execuções</span>
          <span className="text-xs text-muted-foreground">{runs.data ? `${runs.data.length} carregadas` : 'Consultando o TaskEngine…'}</span>
          <div className="ml-auto flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-primary/10 px-2 py-1 text-primary">{summary.completed ?? 0} concluídas</span>
            <span className="rounded-full bg-warning/10 px-2 py-1 text-warning">{(summary.running ?? 0) + (summary.pending ?? 0) + (summary.awaiting_approval ?? 0)} ativas</span>
            <span className="rounded-full bg-destructive/10 px-2 py-1 text-destructive">{summary.failed ?? 0} falhas</span>
          </div>
        </section>
        <div data-tour="runs-filters" role="search" aria-label="Filtrar execuções" className="grid max-w-4xl gap-3 sm:grid-cols-4">
          <Field label="Buscar no pedido" htmlFor="runs-query">
            <Input id="runs-query" type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200} />
          </Field>
          <Field label="Situação" htmlFor="runs-status">
            <Select id="runs-status" value={status} onChange={(event) => setStatus(event.target.value as TaskStatus | '')}>
              <option value="">Todas</option>
              {TASK_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {STATUS_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Projeto" htmlFor="runs-project">
            <Select id="runs-project" value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">Todos</option>
              {projects.data?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Agente" htmlFor="runs-agent">
            <Select id="runs-agent" value={agent} onChange={(event) => setAgent(event.target.value as AgentId | '')}>
              <option value="">Todos</option>
              {AGENT_IDS.map((value) => (
                <option key={value} value={value}>
                  {AGENT_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        {runs.isPending && <LoadingState title="Carregando execuções" description="Consultando o TaskEngine e os filtros selecionados." />}
        {runs.error && <ErrorState title="Não foi possível carregar as execuções" description={errorMessage(runs.error)} action={{ label: 'Tentar novamente', onClick: () => void runs.refetch() }} />}
        {runs.data?.length === 0 &&
          (filtered ? (
            <EmptyState title="Nenhuma execução encontrada" description="Ajuste os filtros ou remova a busca para ver outras execuções." />
          ) : (
            <EmptyState title="Nenhuma execução ainda" description={<>Descreva uma tarefa no <Link to="/chat" className="text-primary underline underline-offset-4">Chat</Link> para começar.</>} />
          ))}
        {runs.data && runs.data.length > 0 && <section aria-label="Lista de execuções" className="max-w-5xl overflow-hidden sg-panel rounded-xl"><div className="hidden grid-cols-[minmax(0,1fr)_11rem_9rem] gap-4 border-b px-4 py-2 text-xs text-muted-foreground md:grid"><span>Execução</span><span>Agente / projeto</span><span>Estado</span></div><VirtualList items={runs.data} itemHeight={72} ariaLabel="Execuções carregadas" renderItem={(run) => { const duration = formatDuration(run.startedAt, run.finishedAt); const attention = run.status === 'failed' || run.status === 'awaiting_approval'; return <div className={cn('grid h-[4.5rem] gap-3 px-4 py-3 transition-colors hover:bg-accent/40 md:grid-cols-[minmax(0,1fr)_11rem_9rem] md:items-center', attention && 'bg-warning/[0.035]')}><div className="min-w-0"><Link to={`/runs/${run.id}`} className="block truncate text-sm font-medium outline-none hover:text-primary focus-visible:ring-2 focus-visible:ring-ring">{run.prompt}</Link><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Clock3 className="size-3" aria-hidden="true" />{duration ?? 'duração indisponível'}</span><span>{formatWhen(run.createdAt)}</span>{run.parentTaskId && <span>continuação</span>}</div></div><div className="flex min-w-0 flex-wrap gap-2 text-xs">{run.agents.length ? run.agents.map((id) => <span key={id} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2 py-1"><AgentDot agent={id} />{AGENT_LABEL[id]}</span>) : <span className="text-muted-foreground">sem agente</span>}<span className="w-full truncate text-muted-foreground">{run.projectName ?? 'sem projeto'}</span></div><div className="flex items-center gap-2"><StatusBadge status={run.status} />{attention && <TriangleAlert className="size-4 text-warning" aria-label="Requer atenção" />}</div></div>; }} /></section>}
      </div>
    </>
  );
}

export function RunPage() {
  useTaskUpdates();
  const { id = '' } = useParams();
  const run = useTask(id);
  const task = run.data;
  const facts = task
    ? [
        ['Modo', MODE_LABEL[task.mode]],
        ['Projeto', task.projectName ?? 'sem projeto'],
        ['Início', task.startedAt ? formatWhen(task.startedAt) : '—'],
        ['Duração', formatDuration(task.startedAt, task.finishedAt) ?? '—'],
        ['Tokens', formatTokens(task.tokens) ?? 'não informados pelo provedor'],
        ['Custo', formatCost(task.tokens.costUsd) ?? 'não informado'],
      ]
    : [];

  return (
    <div className="max-w-4xl space-y-6 px-8 py-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link to="/runs" className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Todas as execuções
        </Link>
        {task && (
          <Link
            to={`/chat?thread=${task.threadId}`}
            className="inline-flex h-8 items-center gap-2 rounded-md border px-3 text-[13px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
          >
            <MessageSquare className="size-4" aria-hidden="true" />
            Continuar no chat
          </Link>
        )}
      </div>
      {run.isPending && <p className="text-muted-foreground">Carregando…</p>}
      {run.error && <p role="alert" className="text-destructive">{errorMessage(run.error)}</p>}
      {task && (
        <>
          <h2 className="text-base font-medium whitespace-pre-wrap">{task.prompt}</h2>
          <dl className="grid gap-x-6 gap-y-2 text-[13.5px] sm:grid-cols-[max-content_1fr]">
            {facts.map(([term, value]) => (
              <div key={term} className="contents">
                <dt className="text-muted-foreground">{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <TaskCard task={task} showPrompt={false} />
        </>
      )}
    </div>
  );
}
