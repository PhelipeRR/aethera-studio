import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useCancelTask, usePauseTask, useResumePausedTask, useTaskList, useTaskUpdates } from '@/features/tasks/api';
import type { TaskStatus } from '@neuralbridge/shared/domain';

const statuses: Array<{ value: TaskStatus | ''; label: string }> = [{ value: '', label: 'Todos os status' }, { value: 'running', label: 'Em execução' }, { value: 'paused', label: 'Pausadas' }, { value: 'awaiting_approval', label: 'Aguardando aprovação' }, { value: 'completed', label: 'Concluídas' }, { value: 'failed', label: 'Falhas' }, { value: 'cancelled', label: 'Canceladas' }];

export function MissionControlPage() {
  const [status, setStatus] = useState<TaskStatus | ''>('');
  const [query, setQuery] = useState('');
  const [agent, setAgent] = useState<'claude' | 'codex' | ''>('');
  const [projectId, setProjectId] = useState('');
  const tasks = useTaskList({ ...(status ? { status } : {}), ...(agent ? { agent } : {}), ...(projectId.trim() ? { projectId: projectId.trim() } : {}), ...(query.trim() ? { query: query.trim() } : {}), limit: 100 });
  const cancel = useCancelTask();
  const pause = usePauseTask();
  const resume = useResumePausedTask();
  const client = useQueryClient();
  const refresh = useMutation({ mutationFn: async () => client.invalidateQueries({ queryKey: ['tasks'] }) });
  useTaskUpdates();
  return (
    <main className="mx-auto max-w-6xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-[26px] leading-tight font-light tracking-[0.005em] text-foreground">Mission Control</h1><p className="text-muted-foreground">Acompanhamento das tarefas reais do TaskEngine.</p></div><Button variant="outline" onClick={() => refresh.mutate()} disabled={refresh.isPending}>Atualizar</Button></header>
      <section data-tour="mission-list" className="flex flex-wrap gap-3 rounded-lg border p-4" aria-label="Filtros de tarefas">
        <label className="text-sm">Status<select className="ml-2 rounded border bg-background px-2 py-1" value={status} onChange={(event) => setStatus(event.target.value as TaskStatus | '')}>{statuses.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="text-sm">Agente<select className="ml-2 rounded border bg-background px-2 py-1" value={agent} onChange={(event) => setAgent(event.target.value as typeof agent)}><option value="">Todos</option><option value="claude">Claude Code</option><option value="codex">Codex CLI</option></select></label>
        <label className="text-sm">Projeto<input className="ml-2 rounded border bg-background px-2 py-1" value={projectId} onChange={(event) => setProjectId(event.target.value)} placeholder="ID do projeto" /></label>
        <label className="text-sm">Buscar<input className="ml-2 rounded border bg-background px-2 py-1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="tarefa ou projeto" /></label>
      </section>
      {tasks.isLoading && <p className="text-muted-foreground">Carregando tarefas…</p>}
      {tasks.isError && <p className="text-destructive">Não foi possível carregar as tarefas.</p>}
      {!tasks.isLoading && !tasks.isError && (tasks.data?.length ?? 0) === 0 && <p className="rounded-lg border p-8 text-center text-muted-foreground">Nenhuma tarefa corresponde aos filtros.</p>}
      <section className="space-y-2" aria-label="Tarefas monitoradas">{(tasks.data ?? []).map((task) => <article key={task.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"><div className="min-w-0"><p className="truncate font-medium">{task.prompt}</p><p className="text-xs text-muted-foreground">{task.projectName ?? 'Sem projeto'} · {task.mode} · {task.status}</p></div><div className="flex gap-2">{task.status === 'paused' ? <Button size="sm" variant="outline" onClick={() => resume.mutate(task.id)} disabled={resume.isPending}>Retomar</Button> : !['completed', 'failed', 'cancelled'].includes(task.status) && <Button size="sm" variant="outline" onClick={() => pause.mutate(task.id)} disabled={pause.isPending}>Pausar</Button>}{!['completed', 'failed', 'cancelled'].includes(task.status) && <Button size="sm" variant="ghost" onClick={() => cancel.mutate(task.id)} disabled={cancel.isPending}>Cancelar</Button>}<Button size="sm" variant="ghost" onClick={() => { window.location.hash = `#/runs/${task.id}`; }}>Detalhes</Button></div></article>)}</section>
    </main>
  );
}
