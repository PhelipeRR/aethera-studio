import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  Clapperboard,
  Film,
  FolderPlus,
  Laugh,
  LayoutTemplate,
  Play,
  Sparkles,
  Upload,
} from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { healthOf, useAgents } from '@/app/useAgents';

const PIPELINE_STEPS = [
  { key: 'planning', label: 'Planejamento', detail: 'Roteiro, direção e estilo' },
  { key: 'production', label: 'Produção', detail: 'Edição, VFX e montagem' },
  { key: 'review', label: 'Revisão', detail: 'Qualidade e ajustes' },
  { key: 'publication', label: 'Publicação', detail: 'Render e distribuição' },
] as const;

const STUDIO_ROLES = [
  { role: 'Diretor Narrativo', desc: 'Roteiro, estrutura e ritmo', badge: null },
  { role: 'Diretor de Humor', desc: 'Timing, piadas e entretenimento', badge: '35%' },
  { role: 'Diretor de Edição', desc: 'Montagem e ritmo', badge: null },
  { role: 'Diretor de VFX', desc: 'Efeitos visuais e composição', badge: null },
  { role: 'Diretor de Som', desc: 'Narração, música e SFX', badge: null },
  { role: 'Supervisor de Qualidade', desc: 'Análise técnica e criativa', badge: null },
] as const;

export function AetheraStudioHome() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const { agents } = useAgents();

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
  const dashboards = useQueries({
    queries: (projects.data ?? []).map((p) => ({
      queryKey: ['aethera-content-project-dashboard', p.id],
      queryFn: () => window.neuralbridge.content.dashboard(p.id),
    })),
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
      navigate(`/aethera/projects/${project.id}`);
    },
  });

  const projectList = projects.data ?? [];
  const activeCount = projectList.filter((p) => p.status !== 'completed' && p.status !== 'archived').length;
  const reviewCount = dashboards.filter((d) => d.data?.nextAction.kind === 'package' || d.data?.nextAction.kind === 'script').length;
  const readyAgentsCount = (agents ?? []).filter((a) => healthOf(a) === 'ready').length;
  const activeStage = reviewCount > 0 ? 2 : activeCount > 0 ? 1 : 0;

  return (
    <div className="space-y-6 p-6 xl:p-8">
      {/* Hero + Production Pipeline */}
      <div className="grid gap-5 xl:grid-cols-12">
        <section className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-[#1b1130] via-[#110f1d] to-[#0a0a12] p-6 xl:col-span-8">
          <div className="pointer-events-none absolute -right-10 -top-10 size-56 rounded-full bg-purple-600/15 blur-3xl" />
          <div className="pointer-events-none absolute bottom-0 right-16 size-40 rounded-full bg-amber-500/10 blur-3xl" />

          <div className="relative space-y-4">
            <div className="inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-500/10 px-3 py-1 text-[11px] font-medium text-amber-300">
              <Sparkles className="size-3.5" /> Centro de Produção Audiovisual
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground">
                Aethera Studio
              </h1>
              <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted-foreground">
                Seu estúdio de produção audiovisual com IA. Do conceito à publicação, com direção cinematográfica,
                edição multifaixa e avaliação de qualidade verificável.
              </p>
            </div>

            <div className="flex flex-wrap gap-2.5 pt-2">
              <Link
                to="/aethera/cinema"
                className="inline-flex h-10 items-center gap-2 rounded-xl bg-gradient-to-r from-purple-600 to-violet-600 px-5 text-sm font-semibold text-white shadow-[0_0_24px_rgba(139,92,246,0.35)] transition hover:brightness-110"
              >
                <Clapperboard className="size-4" /> Criar Vídeo com IA
              </Link>
              <button
                type="button"
                onClick={() => createProject.mutate()}
                disabled={createProject.isPending}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-[#141423] px-4 text-sm font-medium text-foreground transition hover:border-primary/50"
              >
                <FolderPlus className="size-4 text-purple-400" />
                {createProject.isPending ? 'Criando...' : 'Novo Projeto'}
              </button>
              <Link
                to="/aethera/library"
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-[#141423] px-4 text-sm font-medium text-foreground transition hover:border-primary/50"
              >
                <Upload className="size-4 text-amber-400" /> Importar Mídia
              </Link>
              <Link
                to="/video"
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-border bg-[#141423] px-4 text-sm font-medium text-foreground transition hover:border-primary/50"
              >
                <LayoutTemplate className="size-4 text-muted-foreground" /> Abrir Editor
              </Link>
            </div>
          </div>
        </section>

        <aside className="rounded-2xl border border-border bg-card/90 p-5 xl:col-span-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Pipeline de Produção</h2>
            <Link to="/aethera/queue" className="text-xs text-purple-400 hover:underline">
              Ver fila
            </Link>
          </div>
          <ol className="mt-4 space-y-3">
            {PIPELINE_STEPS.map((step, index) => {
              const completed = index < activeStage;
              const current = index === activeStage;
              return (
                <li key={step.key} className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                      completed
                        ? 'border-emerald-500/60 bg-emerald-500/20 text-emerald-400'
                        : current
                          ? 'border-purple-400 bg-purple-500/25 text-purple-300 shadow-[0_0_12px_rgba(168,85,247,0.4)]'
                          : 'border-border bg-background text-muted-foreground'
                    }`}
                  >
                    {completed ? '✓' : index + 1}
                  </div>
                  <div className="min-w-0">
                    <p className={`text-xs font-medium ${current ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {step.label}
                    </p>
                    <p className="text-[11px] text-muted-foreground/80">{step.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        </aside>
      </div>

      {/* Middle 3-column Studio Overview */}
      <div className="grid gap-5 xl:grid-cols-12">
        {/* Active Projects */}
        <section className="space-y-4 rounded-2xl border border-border bg-card/90 p-5 xl:col-span-5">
          <div className="flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
              <Film className="size-4 text-purple-400" /> Projetos Ativos ({projectList.length})
            </h2>
            <Link to="/aethera/projects" className="inline-flex items-center gap-1 text-xs text-purple-400 hover:underline">
              Ver todos <ArrowRight className="size-3" />
            </Link>
          </div>

          {projects.isLoading ? (
            <p className="text-xs text-muted-foreground">Carregando projetos do workspace...</p>
          ) : projectList.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center space-y-2">
              <p className="text-sm font-medium text-foreground">Nenhum projeto ativo ainda</p>
              <p className="text-xs text-muted-foreground">
                Inicie uma direção cinematográfica por prompt ou crie um projeto para começar.
              </p>
              <Link
                to="/aethera/cinema"
                className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white"
              >
                <Sparkles className="size-3.5" /> Criar Vídeo com IA
              </Link>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {projectList.slice(0, 4).map((project) => {
                const pct =
                  project.status === 'completed'
                    ? 100
                    : project.status === 'active'
                      ? 65
                      : project.status === 'paused'
                        ? 40
                        : 25;
                return (
                  <Link
                    key={project.id}
                    to={`/aethera/projects/${project.id}`}
                    className="group rounded-xl border border-border bg-[#0c0c16] p-3 transition hover:border-primary/50"
                  >
                    <div className="relative mb-2.5 flex aspect-video items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-purple-950/60 via-[#121222] to-amber-950/30">
                      <Play className="size-6 text-white/70 transition group-hover:scale-110 group-hover:text-amber-300" />
                      <span className="absolute left-2 top-2 rounded bg-black/65 px-1.5 py-0.5 text-[10px] uppercase text-purple-300">
                        {project.status}
                      </span>
                    </div>
                    <p className="truncate text-xs font-semibold text-foreground">{project.title}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                        <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-amber-400" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="font-mono text-[10px] text-muted-foreground">{pct}%</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        {/* Cinematographic AI Team */}
        <section className="space-y-3 rounded-2xl border border-border bg-card/90 p-5 xl:col-span-4">
          <div className="flex items-center justify-between">
            <h2 className="inline-flex items-center gap-2 text-sm font-semibold">
              <Bot className="size-4 text-amber-400" /> Agentes Cinematográficos
            </h2>
            <Link to="/agents" className="text-xs text-purple-400 hover:underline">
              Equipe completa
            </Link>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Motores ativos: {readyAgentsCount} provedor(es) CLI · fallback RF-07 automático
          </p>
          <ul className="space-y-2">
            {STUDIO_ROLES.map((item) => (
              <li
                key={item.role}
                className="flex items-center justify-between rounded-xl border border-border/70 bg-[#0d0d17] px-3 py-2 text-xs"
              >
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{item.role}</p>
                  <p className="truncate text-[11px] text-muted-foreground">{item.desc}</p>
                </div>
                <div className="flex items-center gap-2">
                  {item.badge && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-purple-500/15 px-2 py-0.5 font-mono text-[10px] text-purple-300">
                      <Laugh className="size-3" /> {item.badge}
                    </span>
                  )}
                  <span
                    className={`size-2 rounded-full ${readyAgentsCount > 0 ? 'bg-emerald-400' : 'bg-amber-400'}`}
                    title={readyAgentsCount > 0 ? 'Operacional' : 'Aguardando CLI'}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Studio Quality & Pending Approvals */}
        <section className="space-y-4 rounded-2xl border border-border bg-card/90 p-5 xl:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Qualidade & Aprovações</h2>
            <Link to="/aethera/review" className="text-xs text-purple-400 hover:underline">
              Sala de Revisão
            </Link>
          </div>

          <div className="flex items-center gap-4 rounded-xl border border-border/70 bg-[#0d0d17] p-3.5">
            <div className="flex size-16 shrink-0 items-center justify-center rounded-full border-4 border-purple-500/70 bg-purple-500/10 text-center">
              <span className="font-mono text-sm font-bold text-foreground">
                {projectList.length > 0 ? 'QC' : '—'}
              </span>
            </div>
            <div className="min-w-0 text-xs space-y-1">
              <p className="font-semibold text-foreground">
                {reviewCount > 0
                  ? `${reviewCount} pendência(s) para aprovação`
                  : 'Nenhuma pendência crítica'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                Humor padrão 35% · Rec.709 · -14 LUFS
              </p>
            </div>
          </div>

          <div className="space-y-2 text-xs">
            <p className="font-medium text-muted-foreground">Próxima ação recomendada</p>
            {reviewCount > 0 ? (
              <Link
                to="/aethera/review"
                className="flex items-center justify-between rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2.5 text-amber-200 hover:bg-amber-500/15"
              >
                <span>Revisar e aprovar pacote</span>
                <ArrowRight className="size-3.5" />
              </Link>
            ) : (
              <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-[#0d0d17] px-3 py-2.5 text-muted-foreground">
                <CheckCircle2 className="size-4 text-emerald-400" />
                <span>Estúdio pronto para nova produção.</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
