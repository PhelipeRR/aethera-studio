import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Activity, Crosshair, LoaderCircle, Network as NetworkIcon, RotateCw, Search, X } from 'lucide-react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { MemoryType } from '@neuralbridge/shared/domain';
import { Tooltip } from '@/components/ui/tooltip';
import { errorMessage, formatWhen } from '@/features/brain/format';
import { MEMORY_TYPES, SOURCE_LABEL, TRUST_LABEL, TYPE_LABEL } from '@/features/brain/labels';
import { useTaskUpdates } from '@/features/tasks/api';
import { usePersistentChoice, useReducedMotion } from '@/lib/use-persistent-choice';
import { usePersistentFlag } from '@/lib/use-persistent-flag';
import { cn } from '@/lib/utils';
import { REGION_LABEL, sampleBrain, sampleBrainAsync, type BrainCloud } from './anatomy';
import { SceneController, type SceneStats } from './controller';
import { buildKnowledge } from './knowledge';
import { regionForProject } from './layout';
import { buildNetwork, type Network } from './network';
import { chooseAutomaticQuality, INTENSITY_LABEL, QUALITY, QUALITY_LABEL, type EffectIntensity, type QualityChoice, type QualityLevel } from './quality';
import { useRealActivity } from './use-real-activity';
import { webglSupport } from './webgl';

const BrainCanvas = lazy(() => import('./BrainCanvas'));

const QUALITY_CHOICES = ['auto', 'low', 'medium', 'high'] as const;
const INTENSITIES = ['off', 'subtle', 'normal', 'intense'] as const;
const REAL_ACTIVITY_WINDOW_MS = 8_000;

const fold = (text: string) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLocaleLowerCase('pt-BR');

// Brains are generated once per quality level and kept for the session (deterministic, so identical anyway).
const brains = new Map<QualityLevel, Promise<{ cloud: BrainCloud; network: Network }>>();
function loadBrain(level: QualityLevel): Promise<{ cloud: BrainCloud; network: Network }> {
  let pending = brains.get(level);
  if (!pending) {
    const settings = QUALITY[level];
    pending = sampleBrainAsync({ count: settings.particles, interiorRatio: 0.14, seed: 19 }).then((cloud) => ({
      cloud,
      network: buildNetwork(cloud.positions, cloud.regions, { nodes: settings.networkNodes, neighbours: 3, maxDistance: 0.11, longRange: Math.round(settings.networkNodes / 60), seed: 23 }),
    }));
    pending.catch(() => brains.delete(level));
    brains.set(level, pending);
  }
  return pending;
}

// Memories are placed on a fixed reference surface, so they keep their place whatever the quality level.
let placement: BrainCloud | null = null;
const placementCloud = () => (placement ??= sampleBrain({ count: 6_000, interiorRatio: 0, seed: 101 }));

/** Height from the element's top to the bottom of the window: the scene fills what is left. */
function useFillHeight() {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    const update = () => {
      const top = ref.current?.getBoundingClientRect().top ?? 0;
      setHeight(Math.max(320, window.innerHeight - top));
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return { ref, height };
}

function usePageVisible(): boolean {
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return visible;
}

const pill =
  'inline-flex h-8 items-center gap-1.5 rounded-full border border-white/10 bg-[#0c0a09]/80 px-3 text-[12.5px] text-[#e7e5e4] outline-none backdrop-blur transition-colors hover:bg-[#1c1917] focus-visible:ring-2 focus-visible:ring-[#fbbf24] disabled:opacity-50';
const panel = 'rounded-xl border border-white/10 bg-[#0a0908]/85 text-[#e7e5e4] backdrop-blur';

export function Brain3DPage() {
  useTaskUpdates();
  const [support] = useState(webglSupport);
  const reducedMotion = useReducedMotion();
  const visible = usePageVisible();
  const { ref: fillRef, height } = useFillHeight();
  const detailsRef = useRef<HTMLElement>(null);
  const [detailsSpace, setDetailsSpace] = useState(280);
  useLayoutEffect(() => {
    const element = detailsRef.current;
    if (!element) return;
    const measure = () => setDetailsSpace(Math.ceil(element.getBoundingClientRect().width + 24));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [qualityChoice, setQualityChoice] = usePersistentChoice<QualityChoice>('nb.brain3d.quality', QUALITY_CHOICES, 'auto');
  const [intensity, setIntensity] = usePersistentChoice<EffectIntensity>('nb.brain3d.intensity', INTENSITIES, 'normal');
  const [autoRotate, setAutoRotate] = usePersistentFlag('nb.brain3d.autorotate', true);
  const [showSimilarity, setShowSimilarity] = usePersistentFlag('nb.brain3d.similarity', true);
  const [autoLevel, setAutoLevel] = useState<QualityLevel | null>(null);
  const level: QualityLevel = qualityChoice === 'auto' ? (autoLevel ?? 'medium') : qualityChoice;

  const [brain, setBrain] = useState<{ level: QualityLevel; cloud: BrainCloud; network: Network } | null>(null);
  const [brainError, setBrainError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    loadBrain(level).then(
      (loaded) => !cancelled && setBrain({ level, ...loaded }),
      (error: unknown) => !cancelled && setBrainError(errorMessage(error)),
    );
    return () => {
      cancelled = true;
    };
  }, [level]);

  const graph = useQuery({ queryKey: ['brain', 'graph3d'], queryFn: () => window.neuralbridge.brain.graph3d() });
  const similarity = useQuery({ queryKey: ['brain', 'similarity'], queryFn: () => window.neuralbridge.brain.similarity(), enabled: showSimilarity });
  const [projectFilter, setProjectFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<MemoryType | ''>('');
  const model = useMemo(
    () =>
      graph.data
        ? buildKnowledge(graph.data, showSimilarity ? (similarity.data ?? null) : null, placementCloud(), {
            similarity: showSimilarity,
            project: projectFilter === '' ? 'all' : projectFilter === '__global' ? 'global' : projectFilter,
            type: typeFilter || null,
          })
        : null,
    [graph.data, similarity.data, showSimilarity, projectFilter, typeFilter],
  );

  const projects = useMemo(() => {
    const map = new Map<string, string>();
    for (const memory of graph.data?.memories ?? []) if (memory.projectId) map.set(memory.projectId, memory.projectName ?? memory.projectId);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [graph.data]);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIndex = model && selectedId ? model.memories.findIndex((memory) => memory.id === selectedId) : -1;
  const selected = (selectedIndex >= 0 ? model?.memories[selectedIndex] : null) ?? null;
  const [hover, setHover] = useState<{ index: number; x: number; y: number } | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const controller = useMemo(() => new SceneController(), []);
  const statsRef = useRef<HTMLDivElement>(null);
  const autoSamples = useRef<number[]>([]);

  // Real activity lights the matching memories; unknown ids (filtered out or deleted) are listed but not drawn.
  const indexById = useMemo(() => new Map(model?.memories.map((memory, i) => [memory.id, i]) ?? []), [model]);
  const indexOf = useRef(indexById);
  const [announcement, setAnnouncement] = useState('');
  const titles = useMemo(() => new Map(graph.data?.memories.map((memory) => [memory.id, memory.title]) ?? []), [graph.data]);
  const titleRef = useRef(titles);
  useEffect(() => {
    indexOf.current = indexById;
    titleRef.current = titles;
  }, [indexById, titles]);
  const onFresh = useCallback(
    (fresh: { memoryId: string; client: string }[]) => {
      for (const activation of fresh) {
        const index = indexOf.current.get(activation.memoryId);
        if (index !== undefined) controller.activate(index);
      }
      const first = fresh[0];
      if (first) setAnnouncement(`${first.client} recuperou “${titleRef.current.get(first.memoryId) ?? 'uma memória'}”.`);
    },
    [controller],
  );
  const { recent, lastAt } = useRealActivity(onFresh);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);
  const realActive = lastAt !== null && now - lastAt < REAL_ACTIVITY_WINDOW_MS;

  const onStats = useCallback(
    (stats: SceneStats) => {
      const element = statsRef.current;
      if (element) {
        for (const [key, value] of Object.entries(stats)) element.dataset[key] = String(value);
        element.dataset['quality'] = level;
      }
      // Automatic quality: measure a few seconds at medium, then settle once.
      if (qualityChoice === 'auto' && autoLevel === null && level === 'medium' && stats.frames > 30) {
        autoSamples.current.push(stats.fps);
        if (autoSamples.current.length >= 5) {
          const sorted = [...autoSamples.current].sort((a, b) => a - b);
          setAutoLevel(chooseAutomaticQuality(sorted[Math.floor(sorted.length / 2)] ?? 0));
        }
      }
    },
    [autoLevel, level, qualityChoice],
  );

  const [query, setQuery] = useState('');
  const matches = useMemo(() => {
    const needle = fold(query.trim());
    if (!needle || !model) return [];
    return model.memories.map((memory, index) => ({ memory, index })).filter(({ memory }) => fold(memory.title).includes(needle)).slice(0, 8);
  }, [query, model]);
  const choose = (id: string) => {
    setSelectedId(id);
    setQuery('');
    const index = indexOf.current.get(id);
    if (index !== undefined) controller.focus(index);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = 0.12;
    const keys: Record<string, () => void> = {
      ArrowLeft: () => controller.orbit(-step, 0),
      ArrowRight: () => controller.orbit(step, 0),
      ArrowUp: () => controller.orbit(0, -step),
      ArrowDown: () => controller.orbit(0, step),
      '+': () => controller.zoom(0.85),
      '=': () => controller.zoom(0.85),
      '-': () => controller.zoom(1.18),
      Home: () => controller.reset(),
      '0': () => controller.reset(),
      Escape: () => setSelectedId(null),
    };
    const action = keys[event.key];
    if (action) {
      event.preventDefault();
      action();
    }
  };

  const links = model?.edges.filter((edge) => edge.kind === 'link').length ?? 0;
  const similar = model?.edges.filter((edge) => edge.kind === 'similarity').length ?? 0;
  const neighbours = selected && model ? model.edges.filter((edge) => edge.a === selectedIndex || edge.b === selectedIndex) : [];
  const region = selected ? REGION_LABEL[regionForProject(selected.projectId).region] : null;
  const empty = graph.data && graph.data.memories.length === 0;

  if (!support.ok || contextLost) {
    return (
      <div className="max-w-3xl px-8 py-7">
        <div role="alert" className="rounded-lg border border-warning/50 px-5 py-4">
          <p className="font-medium">{contextLost ? 'A renderização 3D foi interrompida pela placa de vídeo.' : 'Este computador não oferece WebGL, necessário para o cérebro 3D.'}</p>
          <p className="mt-1 text-muted-foreground">As memórias continuam disponíveis no grafo 2D e na lista abaixo.</p>
          <div className="mt-3 flex gap-2">
            <Link to="/memory/graph" className="rounded-md border px-3 py-1.5 text-[13px] hover:bg-accent">
              Abrir o grafo 2D
            </Link>
            {contextLost && (
              <button type="button" className="rounded-md border px-3 py-1.5 text-[13px] hover:bg-accent" onClick={() => setContextLost(false)}>
                Tentar de novo
              </button>
            )}
          </div>
        </div>
        <ul aria-label="Memórias" className="mt-5 divide-y rounded-lg border">
          {graph.data?.memories.map((memory) => (
            <li key={memory.id} className="px-4 py-2">
              <Link to={`/memory/${memory.id}`} className="hover:underline">
                {memory.title}
              </Link>{' '}
              <span className="text-xs text-muted-foreground">
                {TYPE_LABEL[memory.type]} · {memory.projectName ?? 'Global'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div ref={fillRef} style={height ? { height } : undefined} className="relative min-h-[320px] overflow-hidden">
      {/* Always dark, like an instrument window, whatever the app theme. */}
      <div
        ref={statsRef}
        data-testid="brain3d"
        role="region"
        aria-label="Cérebro 3D: gire com as setas, aproxime com + e −, centralize com Home, Esc limpa a seleção"
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={{ right: detailsSpace }}
        className="absolute top-0 bottom-0 left-0 bg-[radial-gradient(ellipse_at_45%_45%,#1f0f05_0%,#0c0603_45%,#000000_100%)] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#fbbf24]"
      >
        {brain && (
          <Suspense fallback={null}>
            <BrainCanvas
              cloud={brain.cloud}
              network={brain.network}
              quality={brain.level}
              intensity={intensity}
              reducedMotion={reducedMotion}
              autoRotate={autoRotate}
              paused={!visible}
              knowledge={model}
              selected={selectedIndex >= 0 ? selectedIndex : null}
              controller={controller}
              onSelect={(index) => setSelectedId(index === null ? null : (model?.memories[index]?.id ?? null))}
              onHover={setHover}
              onStats={onStats}
              onContextLost={() => setContextLost(true)}
            />
          </Suspense>
        )}
      </div>

      {(!brain || graph.isPending) && !brainError && (
        <p role="status" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-[13px] text-[#d6d3d1]">
          <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
          {brain ? 'Carregando memórias…' : 'Formando o cérebro…'}
        </p>
      )}

      {hover && model?.memories[hover.index] && (
        <div className="pointer-events-none absolute z-10 max-w-64 rounded-md border border-white/15 bg-[#0a0908]/95 px-2.5 py-1.5 text-xs text-[#f5f5f4]" style={{ left: hover.x + 14, top: hover.y + 10 }}>
          {model.memories[hover.index]?.title}
        </div>
      )}

      {/* Top bar: search, filters, counters. */}
      <div style={{ right: detailsSpace }} className="pointer-events-none absolute top-3 left-3 flex flex-wrap items-start gap-2">
        <div className="pointer-events-auto relative">
          <label className="relative block">
            <Search className="pointer-events-none absolute top-2.5 left-3 z-10 size-3.5 text-[#a8a29e]" aria-hidden="true" />
            <input
              type="search"
              aria-label="Buscar memória no cérebro"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && matches[0]) choose(matches[0].memory.id);
              }}
              placeholder="Buscar memória"
              className={cn(pill, 'w-56 pl-8')}
            />
          </label>
          {matches.length > 0 && (
            <ul aria-label="Memórias encontradas" className={cn(panel, 'absolute top-10 left-0 z-20 w-72 overflow-hidden py-1')}>
              {matches.map(({ memory }) => (
                <li key={memory.id}>
                  <button type="button" onClick={() => choose(memory.id)} className="block w-full truncate px-3 py-1.5 text-left text-[13px] outline-none hover:bg-white/10 focus-visible:bg-white/10">
                    {memory.title}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <label className="sr-only" htmlFor="brain3d-project">
          Filtrar por projeto
        </label>
        <select id="brain3d-project" value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)} className={cn(pill, 'pointer-events-auto')}>
          <option value="">Todos os projetos</option>
          <option value="__global">Só globais</option>
          {projects.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="brain3d-type">
          Filtrar por tipo
        </label>
        <select id="brain3d-type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as MemoryType | '')} className={cn(pill, 'pointer-events-auto')}>
          <option value="">Todos os tipos</option>
          {MEMORY_TYPES.map((type) => (
            <option key={type} value={type}>
              {TYPE_LABEL[type]}
            </option>
          ))}
        </select>
        <p aria-label="Contadores" className={cn(pill, 'pointer-events-auto cursor-default hover:bg-[#0c0a09]/80')}>
          <span data-testid="memory-count">{model?.memories.length ?? 0}</span> memórias · <span data-testid="link-count">{links}</span> relações salvas
          {showSimilarity && (
            <span className="hidden xl:inline">
              {' '}
              · <span data-testid="similarity-count">{similar}</span> por similaridade
            </span>
          )}
        </p>
        <span
          role="status"
          aria-label={realActive ? 'Atividade real agora' : 'Sem atividade real agora'}
          className={cn(pill, 'pointer-events-auto cursor-default', realActive ? 'border-[#ffe7a8]/60 text-[#fff1c9]' : 'text-[#a8a29e] hover:bg-[#0c0a09]/80')}
        >
          <span className={cn('size-2 rounded-full', realActive ? 'bg-[#fff1c9] motion-safe:animate-pulse' : 'bg-[#57534e]')} aria-hidden="true" />
          {realActive ? 'Atividade real' : 'Sem atividade real'}
        </span>
      </div>

      {/* Camera and effects. */}
      <div role="toolbar" aria-label="Controles do cérebro 3D" style={{ right: detailsSpace }} className="absolute bottom-3 left-3 flex flex-wrap-reverse items-center gap-2">
        <Tooltip label="Centralizar (Home)" side="top">
          <button type="button" aria-label="Centralizar" className={pill} onClick={() => controller.reset()}>
            <Crosshair className="size-3.5" aria-hidden="true" />
          </button>
        </Tooltip>
        <button type="button" aria-label="Rotação automática" aria-pressed={autoRotate && !reducedMotion} disabled={reducedMotion} className={pill} onClick={() => setAutoRotate(!autoRotate)} title={reducedMotion ? 'Desligada pela preferência de movimento reduzido' : undefined}>
          <RotateCw className="size-3.5" aria-hidden="true" />
          <span className="hidden xl:inline">Rotação automática</span>
        </button>
        <button type="button" aria-label="Similaridade" title="Mostrar conexões por similaridade" aria-pressed={showSimilarity} className={pill} onClick={() => setShowSimilarity(!showSimilarity)}>
          <NetworkIcon className="size-3.5" aria-hidden="true" />
          <span className="hidden xl:inline">Similaridade</span>
        </button>
        <label className="sr-only" htmlFor="brain3d-quality">
          Qualidade gráfica
        </label>
        <select id="brain3d-quality" value={qualityChoice} onChange={(event) => setQualityChoice(event.target.value as QualityChoice)} className={pill}>
          {QUALITY_CHOICES.map((choice) => (
            <option key={choice} value={choice}>
              Qualidade: {QUALITY_LABEL[choice]}
              {choice === 'auto' && qualityChoice === 'auto' && autoLevel ? ` (${QUALITY_LABEL[autoLevel]})` : ''}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="brain3d-intensity">
          Intensidade dos efeitos
        </label>
        <select id="brain3d-intensity" value={intensity} onChange={(event) => setIntensity(event.target.value as EffectIntensity)} className={pill}>
          {INTENSITIES.map((choice) => (
            <option key={choice} value={choice}>
              Efeitos: {INTENSITY_LABEL[choice]}
            </option>
          ))}
        </select>
        <Link to="/memory/graph" className={pill} aria-label="Ver em 2D">
          2D
        </Link>
      </div>

      {/* Details and real activity. */}
      <aside ref={detailsRef} aria-label="Detalhes e atividade" className={cn(panel, 'absolute top-3 right-3 bottom-3 flex w-64 flex-col overflow-hidden xl:w-72')}>
        {selected ? (
          <section aria-label="Memória selecionada" className="space-y-1.5 border-b border-white/10 px-4 py-3 text-[13px]">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-medium text-white">{selected.title}</h2>
              <button type="button" aria-label="Fechar detalhes" className="rounded p-0.5 text-[#a8a29e] hover:text-white" onClick={() => setSelectedId(null)}>
                <X className="size-3.5" aria-hidden="true" />
              </button>
            </div>
            <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[12px]">
              <dt className="text-[#a8a29e]">Tipo</dt>
              <dd>{TYPE_LABEL[selected.type]}</dd>
              <dt className="text-[#a8a29e]">Projeto</dt>
              <dd>{selected.projectName ?? 'Global'}</dd>
              <dt className="text-[#a8a29e]">Região</dt>
              <dd>{region}</dd>
              <dt className="text-[#a8a29e]">Origem</dt>
              <dd>{SOURCE_LABEL[selected.sourceKind]}</dd>
              <dt className="text-[#a8a29e]">Confiança</dt>
              <dd>{TRUST_LABEL[selected.trust]}</dd>
              <dt className="text-[#a8a29e]">Atualizada</dt>
              <dd>{formatWhen(selected.updatedAt)}</dd>
              {selected.tags.length > 0 && (
                <>
                  <dt className="text-[#a8a29e]">Tags</dt>
                  <dd>{selected.tags.join(', ')}</dd>
                </>
              )}
            </dl>
            {neighbours.length > 0 && (
              <ul aria-label="Conexões" className="space-y-0.5 pt-1 text-[12px]">
                {neighbours.map((edge, i) => {
                  const other = model?.memories[edge.a === selectedIndex ? edge.b : edge.a];
                  if (!other) return null;
                  return (
                    <li key={i}>
                      <button type="button" onClick={() => choose(other.id)} className="text-left hover:underline">
                        {edge.kind === 'link' ? `${edge.label} → ` : `similaridade ${edge.label} → `}
                        {other.title}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex gap-3 pt-1 text-[12px]">
              <button type="button" className="text-[#fbbf24] hover:underline" onClick={() => controller.focus(selectedIndex)}>
                Localizar
              </button>
              <Link to={`/memory/${selected.id}`} className="text-[#fbbf24] hover:underline">
                Abrir no Inspector
              </Link>
            </div>
          </section>
        ) : (
          <p className="border-b border-white/10 px-4 py-3 text-[12.5px] text-[#a8a29e]">Clique numa memória ou busque pelo título para ver os detalhes.</p>
        )}
        <section aria-label="Atividade real" className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-[12px]">
          <h2 className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-white">
            <Activity className="size-3.5" aria-hidden="true" /> Atividade real
          </h2>
          {recent.length === 0 ? (
            <p className="text-[#a8a29e]">Nenhuma recuperação nos últimos 30 minutos. Quando Claude Code ou Codex buscarem memórias, elas acendem aqui.</p>
          ) : (
            <ul className="space-y-1.5">
              {recent.map((activation) => (
                <li key={activation.key}>
                  <button type="button" className="block w-full text-left hover:underline" onClick={() => choose(activation.memoryId)}>
                    <span className="text-white">{titles.get(activation.memoryId) ?? 'Memória fora do recorte'}</span>
                    <span className="block text-[#a8a29e]">
                      {activation.client} · {activation.action === 'context' ? 'contexto da tarefa' : activation.action === 'recall' ? 'leu' : 'encontrou na busca'} · {formatWhen(activation.at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-label="Legenda" className="space-y-1 border-t border-white/10 px-4 py-2.5 text-[11.5px]">
          <p className="flex items-center gap-2">
            <span className="size-2 shrink-0 rounded-full bg-[#ffedd5]" aria-hidden="true" /> Impulsos ambientes: atividade ilustrativa
            {(reducedMotion || intensity === 'off') && <span className="text-[#a8a29e]">(pausada)</span>}
          </p>
          <p className="flex items-center gap-2">
            <span className="size-2.5 shrink-0 rounded-full bg-[#fff1c9] shadow-[0_0_8px_#fff1c9]" aria-hidden="true" /> Recuperação real por um agente
          </p>
          <p className="flex items-center gap-2">
            <span className="h-px w-4 shrink-0 bg-[#fed7aa]" aria-hidden="true" /> Relação salva
            <span className="h-px w-4 shrink-0 border-t border-dashed border-[#fbbf24]" aria-hidden="true" /> Similaridade calculada
          </p>
          {showSimilarity && similarity.data && !similarity.data.available && (
            <p className="text-[#d6d3d1]">
              {similarity.data.reason === 'disabled' ? 'Similaridade indisponível: ative a busca semântica em Configurações.' : 'Similaridade indisponível: nenhuma memória indexada ainda.'}
            </p>
          )}
          <p className="text-[#a8a29e]">Nós maiores são memórias, na cor do tipo. Cada projeto ocupa um lobo; memórias globais ficam no cerebelo.</p>
        </section>
      </aside>

      {(empty || graph.data?.truncated || graph.error || brainError) && (
        <div style={{ right: detailsSpace }} className="pointer-events-none absolute top-24 left-3 flex justify-center">
          <p role={graph.error || brainError ? 'alert' : 'note'} className={cn(panel, 'pointer-events-auto px-4 py-2 text-center text-[12.5px]')}>
            {graph.error
              ? `Não foi possível carregar as memórias: ${errorMessage(graph.error)}`
              : brainError
                ? `Não foi possível formar o cérebro: ${brainError}`
                : empty
                  ? 'Nenhuma memória ainda. O que se vê é só a atividade ilustrativa; as memórias aparecem aqui quando forem criadas.'
                  : 'Mostrando as memórias mais recentes; há mais memórias do que o cérebro desenha de uma vez.'}
          </p>
        </div>
      )}

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </div>
  );
}
