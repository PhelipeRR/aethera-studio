import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Boxes, List, Minus, Orbit, Plus, RotateCcw, Search, Sparkles, Waypoints } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import { LIMITS } from '@neuralbridge/shared/brain';
import { MEMORY_TYPES, type MemoryType } from '@neuralbridge/shared/domain';
import { ShellAside, ShellTimeline } from '@/app/shell-slots';
import { EmptyState, ErrorState, LoadingState } from '@/components/feedback/FeedbackState';
import { VirtualList } from '@/components/performance/VirtualList';
import { Timeline } from '@/components/shell/Timeline';
import { taskEvents } from '@/components/shell/timeline-model';
import { Button } from '@/components/ui/button';
import { ActivityList, Chip, DonutChart, GlassPanel, MeterBar, SectionLabel, StatCard } from '@/components/ui/glass';
import { formatCount } from '@/components/ui/glass-model';
import { Select } from '@/components/ui/field';
import { useReducedMotion } from '@/lib/use-persistent-choice';
import { usePersistentFlag } from '@/lib/use-persistent-flag';
import { cn } from '@/lib/utils';
import { formatWhen } from '@/features/brain/format';
import { TYPE_LABEL } from '@/features/brain/labels';
import { webglSupport } from '@/features/brain3d/webgl';
import type { GroupMode } from './galaxy-layout';
import { groupColour, linkPairs, visibleLinks, memoryEvents, NO_FILTERS, starColours, starSizes, starStates, visibleCount, type GalaxyFilters, type Period } from './galaxy-model';
import { GalaxyDetails } from './GalaxyDetails';
import { GalaxyView, type GalaxyViewHandle } from './GalaxyView';
import { useGalaxyLayout } from './use-galaxy-layout';
import { useRealActivity } from '@/features/brain3d/use-real-activity';
import type { Activation } from '@/features/brain3d/activity';

/*
 * Memory Galaxy (lote 50.06). One star per live memory, a small black hole at the centre, arms by type, project or
 * meaning. Layout runs in a Web Worker; this component only wires data, filters, search and the shell panels.
 */

const MODES: { id: GroupMode; label: string }[] = [
  { id: 'type', label: 'Tipo' },
  { id: 'project', label: 'Projeto' },
  { id: 'semantic', label: 'Significado' },
];
const PERIODS: { id: Period; label: string }[] = [
  { id: 'all', label: 'Todo o período' },
  { id: '7d', label: 'Últimos 7 dias' },
  { id: '30d', label: 'Últimos 30 dias' },
  { id: '90d', label: 'Últimos 90 dias' },
];

/** Fills the scroll area below the memory tabs, so the galaxy uses the whole window without page scroll. */
function useFillHeight(ref: React.RefObject<HTMLElement | null>): number {
  const [height, setHeight] = React.useState(560);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let parent = element.parentElement;
    while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) parent = parent.parentElement;
    const measure = () => {
      const top = element.getBoundingClientRect().top - (parent?.getBoundingClientRect().top ?? 0) + (parent?.scrollTop ?? 0);
      setHeight(Math.max(480, (parent?.clientHeight ?? window.innerHeight) - top));
    };
    measure();
    const observer = new ResizeObserver(measure);
    if (parent) observer.observe(parent);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}

export function GalaxyPage() {
  const [mountedAt] = React.useState(() => performance.now());
  const [support] = React.useState(webglSupport);
  const reducedMotion = useReducedMotion();
  const [mode, setMode] = React.useState<GroupMode>('type');
  const [filters, setFilters] = React.useState<GalaxyFilters>(NO_FILTERS);
  const [query, setQuery] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [hovered, setHovered] = React.useState<number | null>(null);
  const [cursor, setCursor] = React.useState<number | null>(null);
  const [listView, setListView] = React.useState(!support.ok);
  const [showLinks, setShowLinks] = usePersistentFlag('nb.galaxy.all-links', false);
  const [rotate, setRotate] = usePersistentFlag('nb.galaxy.rotate', true);
  const [readyMs, setReadyMs] = React.useState<number | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('m');
  const viewRef = React.useRef<GalaxyViewHandle | null>(null);
  const frameRef = React.useRef<HTMLDivElement | null>(null);
  const height = useFillHeight(frameRef);
  const now = React.useMemo(() => new Date(), []);

  const snapshot = useQuery({ queryKey: ['galaxy', 'snapshot'], queryFn: () => window.neuralbridge.brain.galaxy(), retry: false, staleTime: 30_000 });
  // Lote 50.07: a cheap overview poll; the galaxy reloads only when the database really changed, so stars do not jump
  // for nothing. It also feeds the RAG indexing card.
  const overview = useQuery({ queryKey: ['galaxy', 'overview'], queryFn: () => window.neuralbridge.brain.overview(), retry: false, refetchInterval: () => (document.hidden ? false : 15_000) });
  const fingerprint = overview.data ? `${overview.data.total}|${overview.data.recent[0]?.id ?? ''}|${overview.data.recent[0]?.updatedAt ?? ''}|${overview.data.embeddings.indexed}` : null;
  const lastFingerprint = React.useRef<string | null>(null);
  const refetchSnapshot = snapshot.refetch;
  React.useEffect(() => {
    if (!fingerprint) return;
    if (lastFingerprint.current !== null && lastFingerprint.current !== fingerprint) void refetchSnapshot();
    lastFingerprint.current = fingerprint;
  }, [fingerprint, refetchSnapshot]);
  const projects = useQuery({ queryKey: ['brain', 'projects'], queryFn: () => window.neuralbridge.brain.projects(), retry: false });
  const tasks = useQuery({ queryKey: ['galaxy', 'tasks-today'], queryFn: () => window.neuralbridge.tasks.list({ limit: 200 }), retry: false });
  const layout = useGalaxyLayout(snapshot.data, mode);

  React.useEffect(() => { const timer = setTimeout(() => setDebounced(query.trim()), 250); return () => clearTimeout(timer); }, [query]);
  // Frame rate as data attributes for the performance test; written to the DOM directly, no re-render.
  React.useEffect(() => {
    const timer = setInterval(() => {
      const stats = viewRef.current?.stats();
      const frame = frameRef.current;
      if (!stats || !frame) return;
      frame.dataset['fps'] = stats.fps.toFixed(1);
      frame.dataset['frames'] = String(stats.frames);
    }, 500);
    return () => clearInterval(timer);
  }, []);
  const search = useQuery({
    queryKey: ['galaxy', 'search', debounced, filters.type, filters.project],
    queryFn: () => window.neuralbridge.brain.search({ query: debounced, limit: LIMITS.searchResults, ...(filters.type !== 'all' ? { type: filters.type } : {}), ...(filters.project === 'global' ? { projectId: null } : filters.project !== 'all' ? { projectId: filters.project } : {}) }),
    enabled: debounced.length >= 2,
    retry: false,
  });

  const memories = React.useMemo(() => snapshot.data?.memories ?? [], [snapshot.data]);
  const byId = React.useMemo(() => new Map(memories.map((memory) => [memory.id, memory])), [memories]);
  const indexOf = React.useMemo(() => new Map(memories.map((memory, i) => [memory.id, i])), [memories]);
  const hits = React.useMemo(() => (debounced.length >= 2 && search.data ? new Set(search.data.hits.map((hit) => hit.id)) : null), [debounced, search.data]);
  const selectedIndex = selectedId ? indexOf.get(selectedId) ?? null : null;
  const selected = selectedId ? byId.get(selectedId) ?? null : null;

  const colours = React.useMemo(() => (layout.group ? starColours(layout.group, layout.groups, layout.mode) : null), [layout.group, layout.groups, layout.mode]);
  const groupColours = React.useMemo(() => layout.groups.map((group, i) => groupColour(layout.mode, group, i)), [layout.groups, layout.mode]);
  const sizes = React.useMemo(() => starSizes(memories, now), [memories, now]);
  const states = React.useMemo(() => starStates(memories, { filters, hits, selected: selectedId, hovered: hovered === null ? null : memories[hovered]?.id ?? null, now }), [memories, filters, hits, selectedId, hovered, now]);
  const shown = React.useMemo(() => visibleCount(states), [states]);
  const links = React.useMemo(() => linkPairs(memories, snapshot.data?.links ?? []), [memories, snapshot.data]);
  const drawnLinks = React.useMemo(() => visibleLinks(links, showLinks, [selectedIndex, hovered]), [links, showLinks, selectedIndex, hovered]);
  const keyboardOrder = React.useMemo(() => {
    const order: number[] = [];
    states.forEach((state, i) => { if (state > -0.5) order.push(i); });
    const group = layout.group;
    return group ? order.sort((a, b) => (group[a] ?? 0) - (group[b] ?? 0) || (memories[a]?.title ?? '').localeCompare(memories[b]?.title ?? '')) : order;
  }, [states, layout.group, memories]);
  // Real retrievals (agents' MCP calls and the RAG context of tasks) light their stars and show in the panel and timeline.
  const indexRef = React.useRef(indexOf);
  React.useEffect(() => { indexRef.current = indexOf; }, [indexOf]);
  const activity = useRealActivity((fresh: Activation[]) => {
    const indices = fresh.flatMap((activation) => { const index = indexRef.current.get(activation.memoryId); return index === undefined ? [] : [index]; });
    if (indices.length) viewRef.current?.pulse(indices);
  });
  const recallEvents = React.useMemo(() => activity.recent.flatMap((activation) => {
    const memory = byId.get(activation.memoryId);
    return memory ? [{ id: `recall-${activation.key}`, at: activation.at, label: memory.title, detail: `Recuperada por ${activation.client}`, tone: 'ok' as const, href: `/memory/galaxy?m=${encodeURIComponent(memory.id)}` }] : [];
  }), [activity.recent, byId]);
  const events = React.useMemo(() => [...memoryEvents(memories, now), ...taskEvents(tasks.data ?? []), ...recallEvents], [memories, tasks.data, now, recallEvents]);
  const embeddingsState = overview.data?.embeddings;
  const indexTotal = embeddingsState ? embeddingsState.indexed + embeddingsState.pending + embeddingsState.failed : 0;

  const select = React.useCallback((id: string | null) => {
    setSearchParams((params) => { const next = new URLSearchParams(params); if (id) next.set('m', id); else next.delete('m'); return next; }, { replace: true });
  }, [setSearchParams]);
  const selectIndex = React.useCallback((index: number | null) => select(index === null ? null : memories[index]?.id ?? null), [memories, select]);

  // A deep link or a timeline click selects a star: fly to it once the layout exists.
  React.useEffect(() => { if (selectedIndex !== null && layout.positions) viewRef.current?.focusStar(selectedIndex); }, [selectedIndex, layout.positions]);
  // The first search hit is brought into view.
  React.useEffect(() => {
    const first = search.data?.hits.find((hit) => indexOf.has(hit.id));
    const index = first ? indexOf.get(first.id) : undefined;
    if (index !== undefined && debounced.length >= 2) viewRef.current?.focusStar(index);
  }, [search.data, indexOf, debounced]);

  const groupOf = (index: number | null) => (index !== null && layout.group ? layout.group[index] : undefined);
  const groupLabel = (index: number | null) => { const g = groupOf(index); return g === undefined ? '' : layout.groups[g]?.label ?? ''; };
  const colourOf = (index: number | null) => { const g = groupOf(index); return g === undefined ? '#d9b875' : groupColours[g] ?? '#d9b875'; };
  const truncated = snapshot.data?.truncated ?? false;
  const total = snapshot.data?.total ?? null;
  const hoveredMemory = hovered !== null ? memories[hovered] : undefined;
  const announce = selected ? `Selecionada: ${selected.title}` : cursor !== null ? `${memories[cursor]?.title ?? ''}, ${groupLabel(cursor)}` : '';

  const toolbar = (
    <GlassPanel tone="strong" className="pointer-events-auto flex max-w-full flex-wrap items-center gap-2 p-2">
      <label className="relative flex min-w-56 flex-1 items-center">
        <span className="sr-only">Buscar na galáxia</span>
        <Search className="pointer-events-none absolute left-2.5 size-4 text-muted-foreground" aria-hidden="true" />
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por texto ou significado" className="h-8 w-full rounded-md border border-input bg-background/70 pr-2 pl-8 text-sm text-foreground outline-none placeholder:text-muted-foreground/80 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" />
      </label>
      <div role="radiogroup" aria-label="Agrupar estrelas por" className="flex rounded-md border border-[var(--glass-border)] p-0.5">
        {MODES.map((option) => {
          const disabled = option.id === 'semantic' && (layout.degraded || !snapshot.data?.embeddings);
          return (
            <button key={option.id} type="button" role="radio" aria-checked={mode === option.id} disabled={disabled} onClick={() => setMode(option.id)} title={disabled ? 'Sem embeddings armazenados para agrupar por significado' : undefined} className={cn('rounded px-2.5 py-1 text-xs transition-colors duration-[var(--motion-base)] disabled:cursor-not-allowed disabled:opacity-40', mode === option.id ? 'bg-accent text-accent-foreground shadow-[var(--glow-soft)]' : 'text-muted-foreground hover:text-foreground')}>
              {option.label}
            </button>
          );
        })}
      </div>
      <Select aria-label="Filtrar por projeto" className="h-8 w-auto max-w-48 text-xs" value={filters.project} onChange={(event) => setFilters({ ...filters, project: event.target.value })}>
        <option value="all">Todos os projetos</option>
        <option value="global">Somente globais</option>
        {(projects.data ?? []).map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </Select>
      <Select aria-label="Filtrar por tipo" className="h-8 w-auto max-w-40 text-xs" value={filters.type} onChange={(event) => setFilters({ ...filters, type: event.target.value as MemoryType | 'all' })}>
        <option value="all">Todos os tipos</option>
        {MEMORY_TYPES.map((type) => <option key={type} value={type}>{TYPE_LABEL[type]}</option>)}
      </Select>
      <Select aria-label="Filtrar por período" className="h-8 w-auto text-xs" value={filters.period} onChange={(event) => setFilters({ ...filters, period: event.target.value as Period })}>
        {PERIODS.map((period) => <option key={period.id} value={period.id}>{period.label}</option>)}
      </Select>
    </GlassPanel>
  );

  const controls = (
    <GlassPanel tone="strong" className="pointer-events-auto flex items-center gap-0.5 p-1">
      <Button variant="ghost" size="icon" className="size-8" aria-label="Aproximar" onClick={() => viewRef.current?.zoom(0.8)} disabled={listView}><Plus /></Button>
      <Button variant="ghost" size="icon" className="size-8" aria-label="Afastar" onClick={() => viewRef.current?.zoom(1.25)} disabled={listView}><Minus /></Button>
      <Button variant="ghost" size="icon" className="size-8" aria-label="Voltar à vista inicial" onClick={() => viewRef.current?.resetView()} disabled={listView}><RotateCcw /></Button>
      <Button variant="ghost" size="icon" className="size-8" aria-label="Rotação automática" aria-pressed={rotate && !reducedMotion} disabled={reducedMotion || listView} title={reducedMotion ? 'Desligada pela preferência de movimento reduzido' : undefined} onClick={() => setRotate(!rotate)}><Orbit /></Button>
      <Button variant="ghost" size="icon" className="size-8" aria-label="Mostrar todas as ligações registradas" aria-pressed={showLinks} disabled={listView} onClick={() => setShowLinks(!showLinks)}><Waypoints /></Button>
      <Button variant="ghost" size="icon" className="size-8" aria-label="Ver como lista" aria-pressed={listView} onClick={() => setListView(!listView)} disabled={!support.ok}><List /></Button>
    </GlassPanel>
  );

  const body = (() => {
    if (snapshot.isLoading) return <div className="p-6"><LoadingState title="Carregando a galáxia" description="Lendo as memórias do banco local." /></div>;
    if (snapshot.isError) return <div className="p-6"><ErrorState title="Galáxia indisponível" description="O banco de memórias não respondeu." action={{ label: 'Tentar de novo', onClick: () => void snapshot.refetch(), variant: 'outline' }} /></div>;
    if (memories.length === 0) return <div className="p-6"><EmptyState title="A galáxia ainda está vazia" description="Cada memória vira uma estrela. Elas chegam quando Claude ou Codex usam brain_store pelo MCP, ou quando você cria uma." action={{ label: 'Criar a primeira memória', onClick: () => { window.location.hash = '#/memory/new'; } }} /></div>;
    if (listView || !support.ok) {
      const rows = keyboardOrder.length ? keyboardOrder : [];
      return (
        <div className="flex h-full flex-col gap-3 p-4 pt-20">
          {!support.ok && <p className="text-sm text-muted-foreground">Este computador não oferece WebGL: a galáxia aparece como lista. <Link className="text-primary underline-offset-4 hover:underline" to="/memory/graph">Abrir o grafo 2D</Link></p>}
          <VirtualList
            ariaLabel="Memórias da galáxia"
            className="min-h-0 flex-1 rounded-lg border border-[var(--glass-border)] bg-[var(--glass-bg)]"
            items={rows}
            itemHeight={44}
            renderItem={(index) => {
              const memory = memories[index];
              if (!memory) return null;
              return (
                <button type="button" onClick={() => select(memory.id)} aria-current={memory.id === selectedId ? 'true' : undefined} className={cn('flex h-11 w-full items-center gap-3 border-b border-[var(--glass-border)] px-4 text-left text-sm transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset', memory.id === selectedId && 'bg-accent text-accent-foreground')}>
                  <span className="size-2 shrink-0 rounded-full" style={{ background: colourOf(index) }} aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate text-foreground">{memory.title}</span>
                  <span className="hidden shrink-0 text-xs text-muted-foreground md:inline">{groupLabel(index)}</span>
                  <span className="w-28 shrink-0 text-right text-xs text-muted-foreground">{formatWhen(memory.updatedAt)}</span>
                </button>
              );
            }}
          />
        </div>
      );
    }
    if (!layout.positions || !colours) return <div className="p-6"><LoadingState title="Organizando as estrelas" description="Projetando os embeddings fora da tela principal." /></div>;
    return (
      <GalaxyView
        ref={viewRef}
        positions={layout.positions}
        colours={colours}
        sizes={sizes}
        states={states}
        links={drawnLinks}
        showLinks
        autoRotate={rotate && selectedIndex === null}
        reducedMotion={reducedMotion}
        groups={layout.groups}
        groupColours={groupColours}
        keyboardOrder={keyboardOrder}
        activeIndex={cursor ?? selectedIndex}
        label={`Galáxia de memórias: ${formatCount(shown)} de ${formatCount(memories.length)} estrelas visíveis, agrupadas por ${MODES.find((option) => option.id === layout.mode)?.label.toLowerCase()}`}
        onSelect={selectIndex}
        onHover={setHovered}
        onKeyboardStep={setCursor}
        onFirstStars={(at) => setReadyMs((current) => current ?? at - mountedAt)}
      />
    );
  })();

  return (
    <>
      <div
        ref={frameRef}
        data-testid="galaxy"
        data-stars={layout.positions ? memories.length : 0}
        data-visible={shown}
        data-mode={layout.mode}
        data-worker={layout.degraded ? 'unavailable' : layout.workerMs.load === null ? 'pending' : 'ok'}
        data-worker-ms={layout.workerMs.load === null ? undefined : Math.round(layout.workerMs.load)}
        data-ready-ms={readyMs === null ? undefined : Math.round(readyMs)}
        style={{ height }}
        className="relative overflow-hidden bg-[radial-gradient(120%_90%_at_50%_45%,#0b2a2c_0%,#061719_45%,#020a0b_100%)]"
      >
        {body}
        <div className="pointer-events-none absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
          {toolbar}
          {controls}
        </div>
        <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[60%] flex-col gap-1 text-[11px] text-[#c9d2cf]">
          {hoveredMemory && !listView && <p className="sg-enter rounded-md border border-[var(--glass-border)] bg-[#03100f]/80 px-2.5 py-1.5 text-xs text-[#f1ece0]">{hoveredMemory.title} <span className="text-[#a9b4b0]">· {groupLabel(hovered)}</span></p>}
          <p>
            {formatCount(shown)} de {formatCount(memories.length)} estrelas visíveis
            {truncated && total !== null && <> · amostra das {formatCount(memories.length)} mais recentes de {formatCount(total)}</>}
            {layout.degraded && ' · posição por identificador (worker indisponível)'}
            {debounced.length >= 2 && search.data && ` · ${search.data.hits.length} resultado(s) da busca ${search.data.mode === 'hybrid' ? 'por texto e significado' : 'por texto'}`}
            {debounced.length >= 2 && search.isError && ' · busca indisponível agora'}
          </p>
        </div>
        <p id="galaxy-keyboard-help" className="sr-only">Use as setas para percorrer as estrelas visíveis, Enter para abrir os detalhes, mais e menos para zoom, Q e E para girar, R para voltar à vista inicial e Esc para limpar a seleção.</p>
        <p className="sr-only" aria-live="polite">{announce}</p>
      </div>

      <ShellAside title={selected ? 'Detalhes da memória' : 'Galáxia de memórias'}>
        {selected && selectedIndex !== null ? (
          <GalaxyDetails memory={selected} colour={colourOf(selectedIndex)} groupLabel={groupLabel(selectedIndex)} nearest={layout.nearest} byId={byId} onSelect={select} onFocus={() => viewRef.current?.focusStar(selectedIndex)} onClose={() => select(null)} />
        ) : (
          <>
            <StatCard label="Galáxia de memórias" value={total} caption={truncated ? `${formatCount(memories.length)} estrelas desenhadas (as mais recentes)` : 'memórias, uma estrela cada'} unavailableReason={snapshot.isError ? 'banco indisponível' : 'carregando'} icon={<Boxes />} />
            <GlassPanel className="p-4">
              <SectionLabel as="h3">Distribuição por {MODES.find((option) => option.id === layout.mode)?.label.toLowerCase()}</SectionLabel>
              <div className="mt-3">
                <DonutChart stacked title="Estrelas por grupo" centerLabel={formatCount(memories.length, 'compact')} centerCaption="estrelas" size={112} segments={layout.groups.map((group, i) => ({ id: group.id, label: group.label, value: group.count, color: groupColours[i] ?? '#d9b875' }))} />
              </div>
            </GlassPanel>
            {debounced.length >= 2 && (
              <GlassPanel className="space-y-2 p-4" data-testid="galaxy-search-results">
                <SectionLabel as="h3">Resultados da busca</SectionLabel>
                {search.isLoading ? <p className="text-sm text-muted-foreground">Buscando…</p> : search.isError ? <p className="text-sm text-muted-foreground">Busca indisponível agora.</p> : (search.data?.hits ?? []).length === 0 ? <p className="text-sm text-muted-foreground">Nada encontrado.</p> : (
                  <ul className="space-y-1">
                    {(search.data?.hits ?? []).map((hit) => (
                      <li key={hit.id}>
                        <button type="button" disabled={!indexOf.has(hit.id)} onClick={() => select(hit.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50">
                          <span className="min-w-0 flex-1 truncate">{hit.title}</span>
                          {hit.matchedBy.map((by) => <Chip key={by}>{by === 'semantic' ? 'significado' : 'texto'}</Chip>)}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </GlassPanel>
            )}
            <GlassPanel className="space-y-3 p-4" data-testid="galaxy-rag-index">
              <SectionLabel as="h3">Indexação RAG</SectionLabel>
              {embeddingsState ? (
                <>
                  <MeterBar label={`${formatCount(embeddingsState.indexed)} de ${formatCount(indexTotal)} com embedding`} value={indexTotal ? (embeddingsState.indexed / indexTotal) * 100 : null} missingLabel="sem memórias" />
                  <p className="text-xs text-muted-foreground">
                    {embeddingsState.pending > 0 ? `${formatCount(embeddingsState.pending)} aguardando indexação. ` : ''}
                    {embeddingsState.failed > 0 ? `${formatCount(embeddingsState.failed)} com falha. ` : ''}
                    Estrelas sem embedding ficam no braço do grupo, mas fora da posição por significado.
                  </p>
                </>
              ) : <p className="text-sm text-muted-foreground">{overview.isError ? 'Índice indisponível.' : 'Lendo o índice…'}</p>}
            </GlassPanel>
            <GlassPanel className="space-y-2 p-4" data-testid="galaxy-recalls">
              <SectionLabel as="h3">Recuperações recentes</SectionLabel>
              <ActivityList empty="Nenhuma memória recuperada por agentes na última meia hora." items={activity.recent.slice(0, 5).map((activation) => ({ id: activation.key, label: <button type="button" className="text-left hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" onClick={() => select(activation.memoryId)}>{byId.get(activation.memoryId)?.title ?? 'Memória fora da amostra'}</button>, when: `${activation.client} · ${new Date(activation.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`, icon: <Sparkles /> }))} />
            </GlassPanel>
            <GlassPanel className="space-y-2 p-4">
              <SectionLabel as="h3">Como a galáxia é organizada</SectionLabel>
              <p className="text-sm text-muted-foreground">
                Cada estrela é uma memória. Cada braço é um grupo ({MODES.find((option) => option.id === layout.mode)?.label.toLowerCase()}). Ao longo do braço, a posição vem dos embeddings: memórias de significado parecido ficam próximas.
                {' '}{layout.withVector > 0 ? `${formatCount(layout.withVector)} estrelas têm embedding; os três eixos explicam ${Math.round(layout.explained * 100)}% da variação.` : 'Nenhuma estrela tem embedding ainda: a posição no braço vem do identificador.'}
                {' '}Linhas douradas são ligações registradas: as da estrela em foco, ou todas pelo botão de ligações. Estrelas maiores foram atualizadas nos últimos 7 dias ou validadas.
              </p>
            </GlassPanel>
            <GlassPanel className="p-4">
              <p className="text-sm text-foreground">Atividade recente</p>
              <ActivityList className="mt-3" empty="Nenhuma memória ainda." items={[...memories].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 5).map((memory) => ({ id: memory.id, label: <button type="button" className="text-left hover:text-primary focus-visible:ring-2 focus-visible:ring-ring" onClick={() => select(memory.id)}>{memory.title}</button>, when: formatWhen(memory.updatedAt), icon: <Sparkles /> }))} />
            </GlassPanel>
            <GlassPanel asChild interactive>
              <Link to="/memory/new" className="flex w-full items-center justify-center gap-2 px-4 py-3 text-sm text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                <Sparkles className="size-4 text-primary" aria-hidden="true" />Adicionar memória
              </Link>
            </GlassPanel>
          </>
        )}
      </ShellAside>
      <ShellTimeline>
        <Timeline events={events} title="Linha do tempo de hoje" />
      </ShellTimeline>
    </>
  );
}
