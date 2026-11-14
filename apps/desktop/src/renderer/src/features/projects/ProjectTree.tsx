import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, FolderTree, GitBranch, GitFork, TriangleAlert } from 'lucide-react';
import { Link } from 'react-router';
import { PROJECT_TYPE_LABEL, STACK_LABEL, type ProjectSummary } from '@neuralbridge/shared/projects';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';

type GitState = Record<string, { branch: string | null; own: boolean }>;

const technologies = (project: ProjectSummary) => (project.stack?.stacks ?? []).map((stack) => STACK_LABEL[stack]);

function Row({ project, children, depth, open, onToggle, selected, onSelect, git, onInit, childCount }: { project: ProjectSummary; children: ProjectSummary[]; depth: number; open: boolean; onToggle: () => void; selected: boolean; onSelect: (value: boolean) => void; git: GitState[string] | undefined; onInit: () => void; childCount: number }) {
  return (
    <div className="flex items-start gap-2 px-3 py-2.5 hover:bg-accent/60" style={{ paddingLeft: `${0.75 + depth * 1.5}rem` }}>
      {children.length > 0 ? (
        <button type="button" className="mt-0.5 rounded p-0.5 outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-expanded={open} aria-label={`${open ? 'Recolher' : 'Expandir'} ${project.name}`} onClick={onToggle}>
          {open ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
        </button>
      ) : <span className="size-5 shrink-0" />}
      <input type="checkbox" className="mt-1" aria-label={`Selecionar ${project.name}`} checked={selected} onChange={(event) => onSelect(event.target.checked)} />
      <div className="min-w-0 flex-1">
        <Link to={`/projects/${project.id}`} className="block rounded outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 className="min-w-0 font-medium break-words">
              {project.name}
              {project.isPrivate && <span className="ml-2 rounded border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">privado</span>}
              {project.projectType !== 'standalone' && <span className="ml-2 rounded border px-1.5 py-0.5 text-xs font-normal text-muted-foreground">{PROJECT_TYPE_LABEL[project.projectType]}</span>}
              {childCount > 0 && <span className="ml-2 text-xs font-normal text-muted-foreground">{childCount === 1 ? '1 projeto' : `${childCount} projetos`}</span>}
            </h2>
            <span className="text-[12.5px] text-muted-foreground">{project.memoryCount === 1 ? '1 memória' : `${project.memoryCount} memórias`}</span>
          </div>
          <p className="mt-0.5 font-mono text-[12.5px] break-all text-muted-foreground">{project.rootPath}</p>
          {!project.exists && <p className="mt-1 flex items-center gap-1.5 text-[13px] text-warning"><TriangleAlert className="size-3.5" aria-hidden="true" /> Pasta não encontrada: foi movida ou apagada.</p>}
          {technologies(project).length > 0 && <p className="mt-2 flex flex-wrap gap-1.5 text-xs">{technologies(project).map((label) => <span key={label} className="rounded bg-muted px-1.5 py-0.5">{label}</span>)}</p>}
        </Link>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
          {git ? (
            <span className="flex items-center gap-1 rounded bg-muted px-1.5 py-0.5" title={git.own ? 'Repositório próprio' : `Repositório compartilhado: ${project.gitRoot ?? ''}`}>
              {git.own ? <GitBranch className="size-3" aria-hidden="true" /> : <GitFork className="size-3" aria-hidden="true" />}
              {git.branch ?? 'sem branch'}{git.own ? '' : ' · compartilhado'}
            </span>
          ) : project.kind === 'project' && project.exists ? (
            <button type="button" className="rounded border border-dashed px-1.5 py-0.5 text-muted-foreground hover:text-foreground" onClick={onInit}>Sem Git · Iniciar repositório</button>
          ) : null}
        </p>
      </div>
    </div>
  );
}

export function ProjectTree({ projects }: { projects: ProjectSummary[] }) {
  const client = useQueryClient();
  const [query, setQuery] = useState('');
  const [technology, setTechnology] = useState('');
  const [type, setType] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [target, setTarget] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const git = useQuery({ queryKey: ['projects', 'git-state'], queryFn: () => window.neuralbridge.projects.gitState() });
  const refresh = () => void client.invalidateQueries({ queryKey: ['projects'] });
  const report = (error: unknown) => setProblem(errorMessage(error));

  const byParent = useMemo(() => {
    const ids = new Set(projects.map((project) => project.id));
    const map = new Map<string | null, ProjectSummary[]>();
    for (const project of projects) {
      const key = project.parentProjectId && ids.has(project.parentProjectId) ? project.parentProjectId : null;
      map.set(key, [...(map.get(key) ?? []), project]);
    }
    return map;
  }, [projects]);
  const countUnder = (id: string): number => (byParent.get(id) ?? []).reduce((sum, child) => sum + 1 + countUnder(child.id), 0);
  const allTech = [...new Set(projects.flatMap(technologies))].sort();
  const needle = query.trim().toLocaleLowerCase();
  const filtering = needle !== '' || technology !== '' || type !== '';
  const matches = (project: ProjectSummary) => (!needle || `${project.name} ${project.rootPath}`.toLocaleLowerCase().includes(needle)) && (!technology || technologies(project).includes(technology)) && (!type || project.projectType === type);

  const initGit = async (project: ProjectSummary) => {
    setProblem(null);
    if (!window.confirm(`Criar um repositório Git em ${project.rootPath}?`)) return;
    try {
      await window.neuralbridge.projects.initGit(project.id, false);
    } catch (error) {
      const message = errorMessage(error);
      if (!/repositório aninhado/.test(message)) { report(error); return; }
      if (!window.confirm(`${message} Criar mesmo assim?`)) return;
      await window.neuralbridge.projects.initGit(project.id, true).catch(report);
    }
    refresh();
  };
  const moveSelected = async () => {
    setProblem(null);
    for (const id of picked) await window.neuralbridge.projects.move(id, target || null).catch(report);
    setPicked(new Set());
    refresh();
  };
  const togglePicked = (id: string, value: boolean) => setPicked((current) => { const next = new Set(current); if (value) next.add(id); else next.delete(id); return next; });

  const render = (project: ProjectSummary, depth: number) => {
    const children = byParent.get(project.id) ?? [];
    const expanded = open[project.id] ?? true;
    return (
      <li key={project.id}>
        <Row project={project} children={children} depth={depth} open={expanded} onToggle={() => setOpen({ ...open, [project.id]: !expanded })} selected={picked.has(project.id)} onSelect={(value) => togglePicked(project.id, value)} git={git.data?.[project.id]} onInit={() => void initGit(project)} childCount={countUnder(project.id)} />
        {expanded && children.length > 0 && <ul className="divide-y border-t">{children.map((child) => render(child, depth + 1))}</ul>}
      </li>
    );
  };

  const field = 'h-8 rounded border bg-background px-2 text-xs';
  return (
    <section aria-label="Árvore de projetos" className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <input type="search" aria-label="Pesquisar projetos" placeholder="Pesquisar projetos" className={`${field} min-w-48 flex-1`} value={query} onChange={(event) => setQuery(event.target.value)} />
        <select aria-label="Filtrar por tecnologia" className={field} value={technology} onChange={(event) => setTechnology(event.target.value)}><option value="">Todas as tecnologias</option>{allTech.map((item) => <option key={item}>{item}</option>)}</select>
        <select aria-label="Filtrar por tipo" className={field} value={type} onChange={(event) => setType(event.target.value)}><option value="">Todos os tipos</option>{Object.entries(PROJECT_TYPE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
      </div>
      {picked.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded border p-2 text-xs">
          <span>{picked.size} selecionado(s)</span>
          <select aria-label="Mover para" className={field} value={target} onChange={(event) => setTarget(event.target.value)}><option value="">Sem workspace</option>{projects.filter((project) => !picked.has(project.id)).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
          <Button size="sm" variant="outline" onClick={() => void moveSelected()}>{target ? 'Mover' : 'Remover vínculo'}</Button>
          <span className="text-muted-foreground">Só o vínculo muda: nenhum arquivo é movido.</span>
        </div>
      )}
      {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
      <ul className="divide-y rounded-lg border">{filtering ? projects.filter(matches).map((project) => render(project, 0)) : (byParent.get(null) ?? []).map((project) => render(project, 0))}</ul>
      {filtering && !projects.some(matches) && <p className="flex items-center gap-2 text-sm text-muted-foreground"><FolderTree className="size-4" aria-hidden="true" /> Nenhum projeto corresponde.</p>}
    </section>
  );
}
