import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import cytoscape, { type Core } from 'cytoscape';
import fcose from 'cytoscape-fcose';
import { Maximize, Minus, Plus } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import type { MemoryType } from '@neuralbridge/shared/domain';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/field';
import { useProjects } from './api';
import { errorMessage } from './format';
import { buildGraphModel, neighbours, shortestPath, toElements, type GraphModel } from './graph-model';
import { MEMORY_TYPES, TYPE_LABEL } from './labels';

cytoscape.use(fcose);

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Graphs this large switch Cytoscape to its cheaper rendering while panning and zooming. */
const LARGE = 600;

function readColours(): { type: Record<MemoryType, string>; text: string; muted: string; line: string; primary: string; background: string } {
  const css = getComputedStyle(document.documentElement);
  const value = (name: string) => css.getPropertyValue(name).trim();
  return {
    type: Object.fromEntries(MEMORY_TYPES.map((type) => [type, value(`--type-${type}`)])) as Record<MemoryType, string>,
    text: value('--foreground'),
    muted: value('--muted-foreground'),
    line: value('--input'),
    primary: value('--primary'),
    background: value('--background'),
  };
}

/** Re-reads theme colours when the colour scheme changes (the canvas cannot use CSS variables). */
function useColours() {
  const [colours, setColours] = useState(readColours);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setColours(readColours());
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return colours;
}

/** The graph fills the window below wherever it starts (the page header height varies with its text). */
function useFillHeight() {
  const frame = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const measure = () => {
      if (frame.current) setHeight(Math.max(0, Math.floor(window.innerHeight - frame.current.getBoundingClientRect().top)));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  });
  return { frame, height };
}

function styles(colours: ReturnType<typeof readColours>, large: boolean): cytoscape.StylesheetJson {
  return [
    {
      selector: 'node[kind = "memory"]',
      style: {
        'background-color': (node: cytoscape.NodeSingular) => colours.type[node.data('type') as MemoryType] ?? colours.muted,
        label: 'data(label)',
        color: colours.text,
        'font-size': 11,
        'font-family': 'IBM Plex Sans Variable, Segoe UI, sans-serif',
        'text-valign': 'bottom',
        'text-margin-y': 4,
        'text-max-width': '140px',
        'text-wrap': 'ellipsis',
        'min-zoomed-font-size': large ? 9 : 6,
        width: 14,
        height: 14,
      },
    },
    {
      selector: 'node[kind = "pending"]',
      style: {
        'background-opacity': 0,
        'border-width': 1.5,
        'border-style': 'dashed',
        'border-color': colours.muted,
        label: 'data(label)',
        color: colours.muted,
        'font-size': 10,
        'font-style': 'italic',
        'text-valign': 'bottom',
        'text-margin-y': 4,
        'min-zoomed-font-size': large ? 9 : 6,
        width: 12,
        height: 12,
      },
    },
    {
      selector: 'node[kind = "group"]',
      style: {
        'background-opacity': 0.06,
        'background-color': (node: cytoscape.NodeSingular) => colours.type[node.data('type') as MemoryType] ?? colours.muted,
        'border-width': 1,
        'border-color': (node: cytoscape.NodeSingular) => colours.type[node.data('type') as MemoryType] ?? colours.muted,
        'border-opacity': 0.5,
        label: 'data(label)',
        color: colours.muted,
        'font-size': 12,
        'text-valign': 'top',
        'text-halign': 'center',
        shape: 'round-rectangle',
        padding: '18px',
      },
    },
    {
      selector: 'edge',
      style: {
        width: 1,
        'line-color': colours.line,
        'target-arrow-color': colours.line,
        'target-arrow-shape': 'triangle',
        'arrow-scale': 0.7,
        'curve-style': large ? 'haystack' : 'bezier',
      },
    },
    { selector: 'edge[?pending]', style: { 'line-style': 'dashed' } },
    { selector: '.faded', style: { opacity: 0.15 } },
    { selector: 'node.focus', style: { 'border-width': 3, 'border-color': colours.primary, 'border-style': 'solid', width: 20, height: 20, 'font-weight': 600 } },
    { selector: 'edge.path', style: { width: 3, 'line-color': colours.primary, 'target-arrow-color': colours.primary, opacity: 1 } },
    { selector: 'node.path', style: { 'border-width': 3, 'border-color': colours.primary, opacity: 1 } },
  ];
}

function GraphCanvas({
  model,
  selected,
  path,
  onSelect,
  onReady,
}: {
  model: GraphModel;
  selected: string | null;
  path: string[] | null;
  onSelect: (id: string | null) => void;
  onReady: (layoutMs: number) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const cy = useRef<Core | null>(null);
  const colours = useColours();
  const large = model.nodes.length > LARGE;
  // Latest callbacks for Cytoscape's listeners, which are registered once per graph build.
  const handlers = useRef({ onSelect, onReady });
  useLayoutEffect(() => {
    handlers.current = { onSelect, onReady };
  });

  // Rebuild only when the graph itself (or the theme) changes; selection is applied separately below.
  useEffect(() => {
    if (!container.current) return;
    const started = performance.now();
    const instance = cytoscape({
      container: container.current,
      elements: toElements(model),
      style: styles(colours, large),
      // fcose: spectral placement plus force refinement. Plain cose took 37 s for 2,000 nodes on the main
      // thread (tests/e2e/graph.spec.ts); large graphs use the spectral pass only ("draft").
      layout: { name: 'fcose', quality: large ? 'draft' : 'default', animate: false, randomize: true, nodeRepulsion: () => (large ? 6000 : 12000), idealEdgeLength: () => (large ? 70 : 110), packComponents: true } as cytoscape.LayoutOptions,
      minZoom: 0.05,
      maxZoom: 3,
      wheelSensitivity: 0.25,
      textureOnViewport: large,
      hideEdgesOnViewport: large,
      pixelRatio: large ? 1 : 'auto',
    });
    instance.on('tap', 'node[kind != "group"]', (event) => handlers.current.onSelect(event.target.id()));
    instance.on('tap', (event) => {
      if (event.target === instance) handlers.current.onSelect(null);
    });
    cy.current = instance;
    handlers.current.onReady(Math.round(performance.now() - started));
    // The container may reach its final size after the layout ran: follow it, and fit once it has a size.
    let fitted = false;
    const observer = new ResizeObserver(() => {
      instance.resize();
      if (!fitted && instance.width() > 0 && instance.height() > 0) {
        fitted = true;
        instance.fit(undefined, 40);
      }
    });
    observer.observe(container.current);
    return () => {
      observer.disconnect();
      instance.destroy();
      cy.current = null;
    };
  }, [model, colours, large]);

  useEffect(() => {
    const instance = cy.current;
    if (!instance) return;
    instance.batch(() => {
      instance.elements().removeClass('faded focus path');
      if (path && path.length > 1) {
        const ids = new Set(path);
        instance.elements().addClass('faded');
        instance.nodes().filter((node) => ids.has(node.id()) || node.data('kind') === 'group').removeClass('faded').addClass('path');
        instance.nodes('[kind = "group"]').removeClass('path');
        path.slice(1).forEach((id, i) => {
          const previous = path[i] as string;
          instance.edges().filter((edge) => (edge.source().id() === previous && edge.target().id() === id) || (edge.source().id() === id && edge.target().id() === previous)).removeClass('faded').addClass('path');
        });
      } else if (selected) {
        const node = instance.getElementById(selected);
        if (node.nonempty()) {
          instance.elements().addClass('faded');
          node.closedNeighborhood().removeClass('faded');
          node.ancestors().removeClass('faded');
          node.addClass('focus');
        }
      }
    });
    // Bring a node chosen from the panel into view, but do not move the camera if it is already visible.
    const focus = selected ? instance.getElementById(selected) : null;
    if (focus?.nonempty()) {
      const box = focus.renderedBoundingBox();
      const outside = box.x1 < 0 || box.y1 < 0 || box.x2 > instance.width() || box.y2 > instance.height();
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (outside) instance.animate({ center: { eles: focus } }, { duration: reduceMotion ? 0 : 200 });
    }
  }, [selected, path, model]);

  const zoom = (factor: number) => {
    const instance = cy.current;
    if (instance) instance.zoom({ level: instance.zoom() * factor, renderedPosition: { x: instance.width() / 2, y: instance.height() / 2 } });
  };

  return (
    <div className="relative min-h-0 flex-1">
      {/* Cytoscape forces position: relative on its container, so the sizing lives on this wrapper. */}
      <div className="absolute inset-0">
        <div
          ref={container}
          role="img"
          aria-label={`Grafo com ${model.stats.memories} memórias e ${model.stats.links} links. Use o painel ao lado para navegar pelo teclado.`}
          className="size-full"
        />
      </div>
      <div className="absolute top-3 left-3 flex flex-col gap-1">
        <Button variant="outline" size="icon" aria-label="Aproximar" onClick={() => zoom(1.25)} className="size-8 bg-background">
          <Plus aria-hidden="true" />
        </Button>
        <Button variant="outline" size="icon" aria-label="Afastar" onClick={() => zoom(0.8)} className="size-8 bg-background">
          <Minus aria-hidden="true" />
        </Button>
        <Button variant="outline" size="icon" aria-label="Enquadrar tudo" onClick={() => cy.current?.fit(undefined, 30)} className="size-8 bg-background">
          <Maximize aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}

export function GraphPage() {
  const [params, setParams] = useSearchParams();
  const graph = useQuery({ queryKey: ['brain', 'graph'], queryFn: () => window.neuralbridge.brain.graph() });
  const projects = useProjects();
  const [groupByType, setGroupByType] = useState(false);
  const [find, setFind] = useState('');
  const [pathTarget, setPathTarget] = useState('');
  const [layoutMs, setLayoutMs] = useState<number | null>(null);
  const { frame, height } = useFillHeight();

  const project = params.get('project') ?? '';
  const tag = params.get('tag') ?? '';
  const selected = params.get('node');
  const setParam = (key: string, value: string | null) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const model = useMemo(
    () =>
      graph.data
        ? buildGraphModel(graph.data, { ...(project ? { projectId: project === 'global' ? null : project } : {}), ...(tag ? { tag } : {}), groupByType })
        : null,
    [graph.data, project, tag, groupByType],
  );
  const tags = useMemo(() => [...new Set(graph.data?.memories.flatMap((memory) => memory.tags) ?? [])].sort(), [graph.data]);
  const node = model && selected ? model.nodes.find((entry) => entry.id === selected) : undefined;
  const memoryNodes = useMemo(() => (model ? model.nodes.filter((entry) => entry.kind === 'memory').sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')) : []), [model]);
  const path = model && node && pathTarget ? shortestPath(model, node.id, pathTarget) : null;
  const label = (id: string) => model?.nodes.find((entry) => entry.id === id)?.label ?? id;
  const matches = find.trim() ? memoryNodes.filter((entry) => entry.label.toLowerCase().includes(find.trim().toLowerCase())).slice(0, 8) : [];

  const select = (id: string | null) => {
    setParam('node', id);
    setPathTarget('');
  };

  if (graph.isError) {
    return (
      <p role="alert" className="px-8 py-7 text-destructive">
        Não foi possível carregar o grafo. {errorMessage(graph.error)}
      </p>
    );
  }
  if (!model) return <p className="px-8 py-7 text-muted-foreground">Carregando o grafo…</p>;

  return (
    <div ref={frame} className="flex min-h-[28rem]" style={{ height }}>
      {model.nodes.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-8 text-center text-muted-foreground">
          {graph.data?.memories.length ? 'Nenhuma memória com esses filtros.' : 'Sem memórias ainda. Elas aparecem aqui como nós, ligados pelos [[links]] entre elas.'}
        </div>
      ) : (
        <GraphCanvas model={model} selected={selected} path={path} onSelect={select} onReady={setLayoutMs} />
      )}

      <aside aria-label="Painel do grafo" className="w-80 shrink-0 space-y-6 overflow-y-auto border-l px-5 py-5 text-[13px]">
        <p data-layout-ms={layoutMs ?? undefined} aria-live="polite">
          {count(model.stats.memories, 'memória', 'memórias')}, {count(model.stats.links, 'link', 'links')}, {count(model.stats.pending, 'pendente', 'pendentes')}.
          {graph.data?.truncated && <span className="block text-warning">Mostrando as memórias mais recentes; o grafo tem um limite de exibição.</span>}
        </p>

        <section aria-label="Filtros do grafo" className="space-y-2">
          <Select aria-label="Filtrar grafo por projeto" value={project} onChange={(event) => setParam('project', event.target.value || null)}>
            <option value="">Todos os projetos</option>
            <option value="global">Somente globais</option>
            {projects.data?.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Filtrar grafo por tag" value={tag} onChange={(event) => setParam('tag', event.target.value || null)}>
            <option value="">Todas as tags</option>
            {tags.map((entry) => (
              <option key={entry} value={entry}>
                #{entry}
              </option>
            ))}
          </Select>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={groupByType} onChange={(event) => setGroupByType(event.target.checked)} className="accent-[var(--primary)]" />
            Agrupar por tipo
          </label>
        </section>

        <section aria-label="Encontrar memória no grafo">
          <Input type="search" aria-label="Encontrar memória no grafo" placeholder="Encontrar memória…" value={find} onChange={(event) => setFind(event.target.value)} />
          {matches.length > 0 && (
            <ul className="mt-1.5 space-y-0.5">
              {matches.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => {
                      select(entry.id);
                      setFind('');
                    }}
                    className="w-full truncate rounded px-2 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {entry.label}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {node && (
          <section aria-label="Nó selecionado" className="space-y-3">
            <div>
              <h2 className="text-[15px] font-semibold break-words">{node.label}</h2>
              <p className="text-muted-foreground">{node.kind === 'pending' ? 'Pendente: ainda não existe uma memória com este título.' : TYPE_LABEL[node.type as MemoryType]}</p>
            </div>
            {node.kind === 'memory' ? (
              <Link to={`/memory/${node.id}`} className="inline-block text-primary underline-offset-4 hover:underline">
                Abrir memória
              </Link>
            ) : (
              <Link to={`/memory/new?title=${encodeURIComponent(node.label)}`} className="inline-block text-primary underline-offset-4 hover:underline">
                Criar esta memória
              </Link>
            )}
            {(['outgoing', 'incoming'] as const).map((direction) => {
              const list = neighbours(model, node.id)[direction];
              return (
                <div key={direction}>
                  <h3 className="font-medium">{direction === 'outgoing' ? 'Aponta para' : 'Citada por'}</h3>
                  {list.length === 0 ? (
                    <p className="text-muted-foreground">Nenhuma.</p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {list.map((entry) => (
                        <li key={`${entry.id}-${entry.relation}`}>
                          <button type="button" onClick={() => select(entry.id)} className="w-full rounded px-2 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                            <span className={entry.pending ? 'text-muted-foreground italic' : ''}>{entry.label}</span>
                            {entry.relation !== 'references' && <span className="ml-1.5 text-xs text-muted-foreground">{entry.relation}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
            {node.kind === 'memory' && (
              <div className="space-y-1.5">
                <label htmlFor="path-target" className="block font-medium">
                  Caminho até
                </label>
                <Select id="path-target" value={pathTarget} onChange={(event) => setPathTarget(event.target.value)}>
                  <option value="">Escolha uma memória</option>
                  {memoryNodes
                    .filter((entry) => entry.id !== node.id)
                    .map((entry) => (
                      <option key={entry.id} value={entry.id}>
                        {entry.label}
                      </option>
                    ))}
                </Select>
                {pathTarget && (
                  <p role="status" className={path ? '' : 'text-muted-foreground'}>
                    {path ? path.map(label).join(' → ') : 'Não há caminho entre essas memórias.'}
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        <section aria-label="Legenda">
          <h3 className="mb-1.5 font-medium">Legenda</h3>
          <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
            {MEMORY_TYPES.map((type) => (
              <li key={type} className="flex items-center gap-1.5">
                <span className="size-2.5 shrink-0 rounded-full" style={{ background: `var(--type-${type})` }} aria-hidden="true" />
                {TYPE_LABEL[type]}
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span className="size-2.5 shrink-0 rounded-full border border-dashed border-muted-foreground" aria-hidden="true" />
              Pendente
            </li>
          </ul>
        </section>
      </aside>
    </div>
  );
}
