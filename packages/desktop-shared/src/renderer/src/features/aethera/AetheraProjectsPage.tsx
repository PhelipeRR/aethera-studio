import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Clock,
  Film,
  Grid2X2,
  List,
  Play,
  Plus,
  Search,
  SlidersHorizontal,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

type StageFilter = 'all' | 'draft' | 'active' | 'paused' | 'completed' | 'archived';

const STAGE_LABELS: Record<StageFilter, string> = {
  all: 'Todos',
  draft: 'Rascunho',
  active: 'Em Produção',
  paused: 'Pausados',
  completed: 'Concluídos',
  archived: 'Arquivados',
};

export function AetheraProjectsPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const [filter, setFilter] = useState<StageFilter>('all');
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  const projects = useQuery({
    queryKey: ['aethera-content-projects', 'default'],
    queryFn: () => window.neuralbridge.content.projects('default'),
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
        title: `Projeto Aethera #${(projects.data?.length ?? 0) + 1}`,
        autonomy: 'assisted',
      }),
    onSuccess: (created) => {
      void client.invalidateQueries({ queryKey: ['aethera-content-projects', 'default'] });
      navigate(`/aethera/projects/${created.id}`);
    },
  });

  const filtered = useMemo(() => {
    const items = projects.data ?? [];
    return items.filter((p) => {
      const matchesSearch =
        !search.trim() || p.title.toLowerCase().includes(search.toLowerCase());
      if (!matchesSearch) return false;
      if (filter === 'all') return true;
      return p.status === filter;
    });
  }, [projects.data, filter, search]);

  return (
    <div className="space-y-6 p-6 xl:p-8">
      {/* Header Banner */}
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-2xl border border-border bg-gradient-to-r from-[#171128] via-[#10101b] to-[#0d0d16] p-6">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.22em] text-purple-400 uppercase">
            Estúdio / Projetos
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-foreground">Projetos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gerencie suas produções, acompanhe o progresso e avance suas ideias do roteiro ao vídeo final.
          </p>
        </div>

        <button
          type="button"
          onClick={() => createProject.mutate()}
          disabled={createProject.isPending}
          className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-violet-600 px-4 text-sm font-semibold text-white shadow-[0_0_20px_rgba(139,92,246,0.3)] hover:brightness-110 disabled:opacity-50"
        >
          <Plus className="size-4" /> {createProject.isPending ? 'Criando...' : 'Novo Projeto'}
        </button>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(STAGE_LABELS) as StageFilter[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`rounded-full border px-3.5 py-1.5 text-xs font-medium transition ${
                filter === key
                  ? 'border-primary/60 bg-primary/20 text-foreground'
                  : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              {STAGE_LABELS[key]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 size-3.5 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar projetos..."
              className="h-8 rounded-lg border border-border bg-card pl-8 pr-3 text-xs text-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setViewMode('grid')}
            aria-label="Visualização em grade"
            className={`flex size-8 items-center justify-center rounded-lg border ${viewMode === 'grid' ? 'border-primary bg-primary/20 text-foreground' : 'border-border bg-card text-muted-foreground'}`}
          >
            <Grid2X2 className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            aria-label="Visualização em lista"
            className={`flex size-8 items-center justify-center rounded-lg border ${viewMode === 'list' ? 'border-primary bg-primary/20 text-foreground' : 'border-border bg-card text-muted-foreground'}`}
          >
            <List className="size-3.5" />
          </button>
        </div>
      </div>

      {/* Project Grid / Empty State */}
      {projects.isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando projetos...</p>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-card/50 p-10 text-center space-y-3">
          <SlidersHorizontal className="mx-auto size-8 text-purple-400/60" />
          <h2 className="text-base font-medium text-foreground">Nenhum projeto encontrado</h2>
          <p className="mx-auto max-w-md text-xs text-muted-foreground">
            Crie um novo projeto ou use a Produção com IA para gerar roteiro, storyboard e timeline automaticamente.
          </p>
        </div>
      ) : (
        <div className={viewMode === 'grid' ? 'grid gap-4 md:grid-cols-2 xl:grid-cols-3' : 'space-y-3'}>
          {filtered.map((project) => {
            const pct =
              project.status === 'completed'
                ? 100
                : project.status === 'active'
                  ? 65
                  : project.status === 'paused'
                    ? 40
                    : 20;
            return (
              <article
                key={project.id}
                className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition hover:border-primary/50"
              >
                <div className="relative flex aspect-video items-center justify-center bg-gradient-to-br from-[#231442] via-[#131324] to-[#1a130b]">
                  <Play className="size-8 text-white/60 transition group-hover:scale-110 group-hover:text-amber-300" />
                  <span className="absolute left-3 top-3 rounded-full border border-purple-400/40 bg-black/70 px-2.5 py-0.5 text-[11px] font-medium text-purple-200">
                    {project.status}
                  </span>
                  <span className="absolute right-3 top-3 rounded-full bg-black/65 px-2 py-0.5 text-[10px] text-muted-foreground">
                    {project.autonomy}
                  </span>
                </div>

                <div className="flex flex-1 flex-col justify-between p-4 space-y-3">
                  <div>
                    <Link to={`/aethera/projects/${project.id}`} className="text-sm font-semibold text-foreground hover:text-purple-300">
                      {project.title}
                    </Link>
                    <p className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1"><Film className="size-3" /> 16:9</span>
                      <span className="inline-flex items-center gap-1"><Clock className="size-3" /> {new Date(project.updatedAt).toLocaleDateString('pt-BR')}</span>
                    </p>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-amber-400" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="font-mono text-[11px] text-muted-foreground">{pct}%</span>
                    </div>

                    <div className="flex gap-2 pt-1">
                      <Link
                        to="/video"
                        className="flex-1 rounded-lg border border-border bg-background py-1.5 text-center text-xs font-medium hover:border-primary/50"
                      >
                        Abrir Editor
                      </Link>
                      <Link
                        to={`/aethera/projects/${project.id}`}
                        className="flex-1 rounded-lg bg-primary/20 py-1.5 text-center text-xs font-medium text-purple-200 hover:bg-primary/30"
                      >
                        Gerenciar
                      </Link>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
