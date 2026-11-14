import { useMemo, useState } from 'react';
import { FolderPlus, FolderSearch, LoaderCircle, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useNavigate } from 'react-router';
import { PageHeader } from '@/app/PageHeader';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/FeedbackState';
import { errorMessage } from '@/features/brain/format';
import { useAddProject, useProjectList } from './api';
import { DiscoveryPreview } from './DiscoveryPreview';
import { NewProjectPanel } from './NewProjectPanel';
import { ProjectTree } from './ProjectTree';

/** Picks a folder with the system dialog and registers it. */
function useAddFromDialog() {
  const navigate = useNavigate();
  const add = useAddProject();
  const [picking, setPicking] = useState(false);
  const start = () => {
    setPicking(true);
    add.reset();
    window.neuralbridge.projects
      .pick()
      .then((path) => {
        if (path) add.mutate(path, { onSuccess: (project) => navigate(`/projects/${project.id}`) });
      })
      .finally(() => setPicking(false));
  };
  return { start, busy: picking || add.isPending, error: add.error ? errorMessage(add.error) : null };
}

export function ProjectsPage({ description }: { description: string }) {
  const list = useProjectList();
  const adder = useAddFromDialog();
  const [discovering, setDiscovering] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [availability, setAvailability] = useState<'all' | 'available' | 'missing'>('all');
  const visibleProjects = useMemo(() => (list.data ?? []).filter((project) => {
    const text = `${project.name} ${project.rootPath} ${project.projectType} ${project.stack?.stacks.join(' ') ?? ''}`.toLocaleLowerCase();
    return text.includes(query.toLocaleLowerCase()) && (availability === 'all' || (availability === 'available' ? project.exists : !project.exists));
  }), [availability, list.data, query]);
  const availableCount = (list.data ?? []).filter((project) => project.exists).length;
  const missingCount = (list.data ?? []).length - availableCount;
  const detect = () => void window.neuralbridge.projects.pick().then((path) => { if (path) setDiscovering(path); });
  const addButton = (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => setCreating(true)}><Plus aria-hidden="true" /> Novo projeto</Button>
      <Button variant="outline" onClick={detect}><FolderSearch aria-hidden="true" /> Detectar projetos</Button>
      <Button data-tour="projects-add" onClick={adder.start} disabled={adder.busy}>
        {adder.busy ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <FolderPlus aria-hidden="true" />}
        Adicionar projeto
      </Button>
    </div>
  );

  return (
    <>
      <PageHeader title="Projetos" description={description} actions={addButton} />
      <main data-tour="projects-list" className="min-w-0 max-w-6xl space-y-5 px-8 py-7">
        {adder.error && (
          <p role="alert" className="text-destructive">
            {adder.error}
          </p>
        )}
        {list.isError && <ErrorState title="Não foi possível carregar os projetos" description={errorMessage(list.error)} action={{ label: 'Tentar novamente', onClick: () => void list.refetch() }} />}
        {list.data && list.data.length === 0 && (
          <EmptyState title="Nenhum projeto ainda" description="Um projeto é uma pasta onde os agentes trabalham. Adicione ou detecte uma pasta para começar; nada é alterado sem uma tarefa sua." />
        )}
        {discovering && <DiscoveryPreview key={discovering} path={discovering} onClose={() => setDiscovering(null)} />}
        {creating && <NewProjectPanel projects={list.data ?? []} onClose={() => setCreating(false)} />}
        {list.data && list.data.length > 0 && <>
          <section aria-label="Resumo dos projetos" className="grid gap-3 sm:grid-cols-3">
            <div className="sg-panel rounded-xl p-4"><p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Cadastrados</p><p className="mt-2 text-2xl font-semibold tabular-nums">{list.data.length}</p><p className="mt-1 text-xs text-muted-foreground">Projetos e workspaces conhecidos</p></div>
            <div className="sg-panel rounded-xl p-4"><p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Disponíveis</p><p className="mt-2 text-2xl font-semibold text-primary tabular-nums">{availableCount}</p><p className="mt-1 text-xs text-muted-foreground">Pastas prontas para novas tarefas</p></div>
            <div className="sg-panel rounded-xl p-4"><p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">Revisar</p><p className="mt-2 text-2xl font-semibold text-warning tabular-nums">{missingCount}</p><p className="mt-1 text-xs text-muted-foreground">Caminhos que não estão disponíveis</p></div>
          </section>
          <section aria-label="Buscar projetos" className="flex flex-col gap-3 sg-panel rounded-xl p-3 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-muted-foreground" aria-hidden="true" /><input aria-label="Buscar projetos" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por nome, pasta, stack ou tipo" className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" /></div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><SlidersHorizontal className="size-3.5" aria-hidden="true" /><label htmlFor="project-availability" className="sr-only">Disponibilidade</label><select id="project-availability" aria-label="Disponibilidade" value={availability} onChange={(event) => setAvailability(event.target.value as typeof availability)} className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"><option value="all">Todos</option><option value="available">Disponíveis</option><option value="missing">Indisponíveis</option></select></div>
          </section>
          {visibleProjects.length ? <ProjectTree projects={visibleProjects} /> : <section aria-label="Nenhum resultado" className="rounded-xl border border-dashed p-10 text-center"><Search className="mx-auto size-5 text-muted-foreground" aria-hidden="true" /><h2 className="mt-3 text-sm font-medium">Nenhum projeto corresponde à busca</h2><p className="mt-1 text-sm text-muted-foreground">Ajuste os filtros para ver os projetos cadastrados.</p></section>}
        </>}
        {list.isLoading && <LoadingState title="Carregando projetos" description="Consultando os workspaces conhecidos." />}
      </main>
    </>
  );
}
