import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';

/** Git-triggered workflows of a project, and running one by hand on what is selected in the graph. */
export function AutomationsPanel({ projectId, commit, branches }: { projectId: string; commit: string | null; branches: string[] }) {
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [workflowId, setWorkflowId] = useState('');
  const [branch, setBranch] = useState('');
  const [paths, setPaths] = useState('');
  const [base, setBase] = useState('');
  const key = ['git-automations', projectId];
  const workflows = useQuery({ queryKey: ['workflows', projectId], queryFn: () => window.neuralbridge.workflows.list(projectId) });
  const automations = useQuery({ queryKey: key, queryFn: () => window.neuralbridge.workflows.automations(projectId) });
  const refresh = () => void client.invalidateQueries({ queryKey: key });
  const save = useMutation({
    mutationFn: () => window.neuralbridge.workflows.saveAutomation({ projectId, workflowId, name: name.trim(), trigger: { ...(branch ? { refs: [`refs/heads/${branch}`] } : {}), ...(paths.trim() ? { pathGlobs: paths.split(',').map((item) => item.trim()).filter(Boolean) } : {}) } }),
    onSuccess: () => { setName(''); setPaths(''); refresh(); },
  });
  const toggle = useMutation({ mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => window.neuralbridge.workflows.toggleAutomation(id, enabled), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: string) => window.neuralbridge.workflows.deleteAutomation(id), onSuccess: refresh });
  const manual = useMutation({ mutationFn: (input: { hash?: string; base?: string; head?: string }) => window.neuralbridge.workflows.runFromGit({ workflowId, ...input }) });
  const field = 'h-8 w-full rounded border bg-background px-2 text-xs';

  return (
    <section aria-label="Automações Git" className="mx-auto mt-4 max-w-[1600px] space-y-3 sg-panel rounded-xl p-4">
      <div>
        <h2 className="font-medium">Automações</h2>
        <p className="text-xs text-muted-foreground">Verificadas a cada 30 s, com o app aberto. Começam desligadas, e etapas de edição sempre esperam sua aprovação.</p>
      </div>
      <div className="grid gap-2 md:grid-cols-5">
        <input aria-label="Nome da automação" className={field} placeholder="Nome" value={name} onChange={(event) => setName(event.target.value)} />
        <select aria-label="Workflow da automação" className={field} value={workflowId} onChange={(event) => setWorkflowId(event.target.value)}><option value="">Workflow</option>{workflows.data?.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
        <select aria-label="Branch observada" className={field} value={branch} onChange={(event) => setBranch(event.target.value)}><option value="">Todas as branches</option>{branches.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <input aria-label="Arquivos observados" className={field} placeholder="src/**, docs/**" value={paths} onChange={(event) => setPaths(event.target.value)} />
        <Button size="sm" disabled={!name.trim() || !workflowId || save.isPending} onClick={() => save.mutate()}>Criar automação</Button>
      </div>
      {workflows.data?.length === 0 && <p className="text-xs text-muted-foreground">Este projeto ainda não tem workflows. Crie um em Workflows; os modelos da categoria git servem aqui.</p>}
      {save.isError && <p role="alert" className="text-xs text-destructive">{save.error.message}</p>}
      <ul className="space-y-1">
        {automations.data?.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-sm">
            <span className="min-w-0 truncate">{item.name}<span className="ml-2 text-xs text-muted-foreground">{item.trigger.refs?.join(', ') ?? 'todas as branches'}{item.trigger.pathGlobs?.length ? ` · ${item.trigger.pathGlobs.join(', ')}` : ''}</span></span>
            <span className="flex shrink-0 gap-1">
              <Button size="sm" variant="outline" onClick={() => toggle.mutate({ id: item.id, enabled: !item.enabled })}>{item.enabled ? 'Desligar' : 'Ligar'}</Button>
              <Button size="sm" variant="ghost" onClick={() => remove.mutate(item.id)}>Excluir</Button>
            </span>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <span className="text-xs text-muted-foreground">Executar o workflow escolhido:</span>
        <Button size="sm" variant="outline" disabled={!workflowId || !commit || manual.isPending} onClick={() => { if (commit && window.confirm(`Executar o workflow sobre o commit ${commit.slice(0, 8)}?`)) manual.mutate({ hash: commit }); }}>No commit selecionado</Button>
        <select aria-label="Branch base" className="h-8 rounded border bg-background px-2 text-xs" value={base} onChange={(event) => setBase(event.target.value)}><option value="">Base</option>{branches.map((item) => <option key={item} value={item}>{item}</option>)}</select>
        <Button size="sm" variant="outline" disabled={!workflowId || !branch || !base || manual.isPending} onClick={() => { if (window.confirm(`Comparar ${branch} com ${base}?`)) manual.mutate({ base, head: branch }); }}>Na branch contra a base</Button>
        {manual.isSuccess && <span className="text-xs text-primary">Execução iniciada. Acompanhe em Workflows.</span>}
        {manual.isError && <span role="alert" className="text-xs text-destructive">{manual.error.message}</span>}
      </div>
    </section>
  );
}
