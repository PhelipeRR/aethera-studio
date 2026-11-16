import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  EVENT_LABELS,
  INITIAL_FILTERS,
  JOB_KIND_LABELS,
  JOB_STATUS_COLORS,
  JOB_STATUS_LABELS,
  ORIGIN_COLORS,
  ORIGIN_LABELS,
  SEVERITY_COLORS,
  STAGE_LABELS,
  applyEntryToJobs,
  buildStageTimeline,
  currentProgress,
  entryBelongsTo,
  entryDetailRows,
  entryJobId,
  filterEntries,
  formatEntryLine,
  formatTime,
  isErrorEntry,
  isStreamEntry,
  jobLabel,
  liveAgentRuns,
  mergeConsoleEntries,
  summarize,
  uniqueSorted,
  type ConsoleEntry,
  type ConsoleFilters,
  type ConsoleJobKind,
  type ConsoleJobStatus,
  type ConsoleJobSummary,
  type ConsoleOrigin,
  type ConsoleSeverity,
} from './production-console-view.js';
import { AgentRunStatus } from './AgentRunStatus.js';

interface ConsoleBridge {
  cinemaConsoleList?: (input: {
    jobId: string;
    limit?: number;
    offset?: number;
    tail?: boolean;
  }) => Promise<{ entries: ConsoleEntry[]; total: number }>;
  cinemaConsoleListAll?: (input: {
    limit?: number;
    tail?: boolean;
    kind?: ConsoleJobKind;
  }) => Promise<{ entries: ConsoleEntry[]; total: number }>;
  cinemaConsoleJobs?: () => Promise<ConsoleJobSummary[]>;
  cinemaConsoleFacets?: (jobId: string) => Promise<{
    sources: Array<{ value: string; count: number }>;
    origins: Array<{ value: string; count: number }>;
    stages: Array<{ value: string; count: number }>;
  }>;
  cinemaConsoleExport?: (input: { jobId: string; format: 'json' | 'txt' }) => Promise<string>;
  cinemaConsoleExportAll?: (input: { format: 'json' | 'txt'; jobIds?: string[] }) => Promise<string>;
  cinemaConsoleClear?: (jobId: string) => Promise<{ cleared: boolean; jobId: string }>;
  onCinemaConsoleLog?: (listener: (entry: unknown) => void) => () => void;
}

function getBridge(): ConsoleBridge | undefined {
  return (window as unknown as { aetheraBridge?: ConsoleBridge }).aetheraBridge;
}

const MAX_ROWS = 600;
const FLUSH_INTERVAL_MS = 140;
const TABS: Array<{ id: ConsoleFilters['tab']; label: string }> = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'events', label: 'Eventos' },
  { id: 'errors', label: 'Erros' },
];
const PERIODS: Array<{ id: ConsoleFilters['period']; label: string }> = [
  { id: 'all', label: 'Tudo' },
  { id: '5m', label: '5 min' },
  { id: '15m', label: '15 min' },
  { id: '1h', label: '1 h' },
];

/** Filters behind the "Filtros" toggle; view tab and search stay always visible. */
const ADVANCED_FILTER_KEYS = ['jobId', 'status', 'origin', 'source', 'stage', 'severity', 'channel', 'period'] as const;

const STATUS_STYLE: Record<string, { dot: string; label: string }> = {
  pending: { dot: '#334155', label: '#64748b' },
  active: { dot: '#a78bfa', label: '#ddd6fe' },
  done: { dot: '#34d399', label: '#6ee7b7' },
  failed: { dot: '#f87171', label: '#fca5a5' },
  retry: { dot: '#fbbf24', label: '#fcd34d' },
  paused: { dot: '#a78bfa', label: '#c4b5fd' },
};

const STATUS_ICON: Record<string, string> = {
  pending: '○',
  active: '●',
  done: '✓',
  failed: '✕',
  retry: '↻',
  paused: 'Ⅱ',
};

/**
 * Individual console: the terminal of ONE production execution (`jobId`). Lines of any other job are dropped, even
 * from the same project. `projectId` is accepted only for logs written before jobs existed (they are keyed by it).
 */
export interface JobConsoleProps {
  jobId?: string;
  /** @deprecated legacy logs only; use `jobId`. */
  projectId?: string;
  title?: string;
  defaultOpen?: boolean;
}

/** General console: every job, with filters by job, status, agent and stage. Optionally limited to one kind. */
export interface GeneralConsoleProps {
  scope: 'all';
  kind?: ConsoleJobKind;
  title?: string;
  defaultOpen?: boolean;
}

export type ProductionConsoleProps = JobConsoleProps | GeneralConsoleProps;

/** Hidden where the preload does not expose the console IPC (e.g. apps that did not register it yet). */
export function ProductionConsoleAccordion(props: ProductionConsoleProps) {
  const general = 'scope' in props;
  const jobId = general ? '' : (props.jobId ?? props.projectId ?? '');
  const kind = general ? props.kind : undefined;
  const consoleAvailable = Boolean(general ? getBridge()?.cinemaConsoleListAll : getBridge()?.cinemaConsoleList);
  const [open, setOpen] = useState(Boolean(props.defaultOpen));
  const [filters, setFilters] = useState<ConsoleFilters>(INITIAL_FILTERS);
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [jobs, setJobs] = useState<ConsoleJobSummary[]>([]);
  const [knownSources, setKnownSources] = useState<string[]>([]);
  const [knownStages, setKnownStages] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [stagesOpen, setStagesOpen] = useState(false);
  const queueRef = useRef<ConsoleEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const jobKindsRef = useRef(new Map<string, ConsoleJobKind>());

  /** True when a live line belongs to this console: its job (individual) or its kind filter (general). */
  const accepts = useCallback(
    (entry: ConsoleEntry) => {
      if (!general) return entryBelongsTo(entry, jobId);
      if (!kind) return true;
      const entryKind = jobKindsRef.current.get(entryJobId(entry));
      return entryKind === undefined || entryKind === kind;
    },
    [general, jobId, kind],
  );

  const loadEntries = useCallback(async () => {
    const bridge = getBridge();
    if (!bridge) return;
    setLoading(true);
    try {
      if (general) {
        const list = (await bridge.cinemaConsoleJobs?.()) ?? [];
        const scoped = kind ? list.filter((job) => job.kind === kind) : list;
        jobKindsRef.current = new Map(list.map((job) => [job.jobId, job.kind]));
        setJobs(scoped);
        const res = await bridge.cinemaConsoleListAll?.({ limit: MAX_ROWS, tail: true, ...(kind ? { kind } : {}) });
        if (res) {
          // Merge, never replace: lines that arrived while the history loaded stay, without duplicates.
          setEntries((prev) => mergeConsoleEntries(prev, res.entries, MAX_ROWS));
          setTotal(res.total);
          setKnownSources(uniqueSorted(res.entries.map((entry) => entry.source)));
          setKnownStages(uniqueSorted(res.entries.map((entry) => entry.stage)));
        }
        return;
      }
      if (!jobId || !bridge.cinemaConsoleList) return;
      const res = await bridge.cinemaConsoleList({ jobId, limit: MAX_ROWS, offset: 0, tail: true });
      setEntries((prev) => mergeConsoleEntries(prev, res.entries.filter((entry) => entryBelongsTo(entry, jobId)), MAX_ROWS));
      setTotal(res.total);
      const facets = await bridge.cinemaConsoleFacets?.(jobId);
      if (facets) {
        setKnownSources(facets.sources.map((facet) => facet.value));
        setKnownStages(facets.stages.map((facet) => facet.value));
      }
    } catch {
      // silent fail — the console is observational only
    } finally {
      setLoading(false);
    }
  }, [general, jobId, kind]);

  // Switching production resets the view to that job; the execution itself (main process) is not touched.
  useEffect(() => {
    queueRef.current = [];
    setEntries([]);
    setTotal(0);
    setExpanded({});
    setFilters((prev) => ({ ...prev, jobId: 'all', status: 'all' }));
  }, [jobId, kind, general]);

  useEffect(() => {
    if (!open) return;
    void loadEntries();
  }, [open, loadEntries]);

  // General console: the shared window holds the newest lines of ALL jobs, so a job that went quiet earlier may have
  // scrolled out of it. Selecting a job loads that job's own history into the view.
  const selectedJobId = general && filters.jobId !== 'all' ? filters.jobId : null;
  useEffect(() => {
    if (!open || !selectedJobId) return;
    const bridge = getBridge();
    if (!bridge?.cinemaConsoleList) return;
    let cancelled = false;
    void bridge
      .cinemaConsoleList({ jobId: selectedJobId, limit: MAX_ROWS, offset: 0, tail: true })
      .then((res) => {
        if (cancelled) return;
        const own = res.entries.filter((entry) => entryBelongsTo(entry, selectedJobId));
        setEntries((prev) => {
          const others = prev.filter((entry) => !entryBelongsTo(entry, selectedJobId));
          const mine = mergeConsoleEntries(prev.filter((entry) => entryBelongsTo(entry, selectedJobId)), own, MAX_ROWS);
          return mergeConsoleEntries(others.slice(-MAX_ROWS), mine, MAX_ROWS * 2);
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [open, selectedJobId]);

  // Live updates are queued and flushed in batches: the UI re-renders at most once per interval, never per line.
  useEffect(() => {
    if (!open) return;
    const bridge = getBridge();
    if (!bridge?.onCinemaConsoleLog) return;
    const unsub = bridge.onCinemaConsoleLog((raw) => {
      const entry = raw as ConsoleEntry;
      if (!entry || typeof entry !== 'object' || !accepts(entry)) return;
      queueRef.current.push(entry);
      if (queueRef.current.length > MAX_ROWS) {
        queueRef.current.splice(0, queueRef.current.length - MAX_ROWS);
      }
    });
    const timer = setInterval(() => {
      const pending = queueRef.current;
      if (!pending.length) return;
      queueRef.current = [];
      setEntries((prev) => mergeConsoleEntries(prev, pending, MAX_ROWS));
      setTotal((value) => value + pending.length);
      setKnownSources((prev) => uniqueSorted([...prev, ...pending.map((entry) => entry.source)]));
      setKnownStages((prev) => uniqueSorted([...prev, ...pending.map((entry) => entry.stage)]));
      if (general) setJobs((prev) => pending.reduce(applyEntryToJobs, prev));
    }, FLUSH_INTERVAL_MS);
    return () => {
      clearInterval(timer);
      unsub();
    };
  }, [open, accepts, general]);

  const jobStatusById = useMemo(() => new Map(jobs.map((job) => [job.jobId, job.status])), [jobs]);
  const visible = useMemo(
    () => filterEntries(entries, filters, Date.now(), (id) => jobStatusById.get(id)),
    [entries, filters, jobStatusById],
  );
  const counters = useMemo(() => summarize(visible), [visible]);
  const focusedJobId = general ? (filters.jobId === 'all' ? null : filters.jobId) : jobId;
  // Progress and stage timeline always describe ONE job: never a blend of several productions.
  const focusedEntries = useMemo(
    () => (focusedJobId ? entries.filter((entry) => entryBelongsTo(entry, focusedJobId)) : []),
    [entries, focusedJobId],
  );
  const progress = useMemo(() => currentProgress(focusedEntries), [focusedEntries]);
  const timeline = useMemo(() => buildStageTimeline(focusedEntries), [focusedEntries]);
  const agentRuns = useMemo(() => liveAgentRuns(focusedEntries), [focusedEntries]);
  const focusedProjectId = focusedEntries.length ? (focusedEntries[focusedEntries.length - 1]?.projectId ?? null) : null;
  const attempt = useMemo(
    () => focusedEntries.reduce((max, entry) => Math.max(max, entry.attempt ?? 1), 1),
    [focusedEntries],
  );
  const errorTabOpen = filters.tab === 'errors';
  const activeFilterCount = ADVANCED_FILTER_KEYS.filter((key) => filters[key] !== INITIAL_FILTERS[key]).length;

  // Errors open their technical details by default in the Erros tab; elsewhere they stay one click away.
  const isExpanded = useCallback(
    (entry: ConsoleEntry) => expanded[entry.id] ?? (errorTabOpen && isErrorEntry(entry)),
    [expanded, errorTabOpen],
  );

  useEffect(() => {
    if (!autoScroll || !scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [visible, autoScroll, open]);

  const toggleExpand = useCallback((id: string) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const patchFilters = useCallback((patch: Partial<ConsoleFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(visible.map((entry) => formatEntryLine(entry, general)).join('\n'));
    } catch {
      // clipboard may be blocked
    }
  };

  const handleExport = async (format: 'json' | 'txt') => {
    const bridge = getBridge();
    let content: string | undefined;
    let name: string;
    if (general) {
      const jobIds = focusedJobId ? [focusedJobId] : jobs.map((job) => job.jobId);
      content = await bridge?.cinemaConsoleExportAll?.({ format, jobIds });
      name = focusedJobId ? `console-${focusedJobId}` : 'console-geral';
    } else {
      content = await bridge?.cinemaConsoleExport?.({ jobId, format });
      name = `console-${jobId}`;
    }
    if (content === undefined) return;
    const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.${format}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Clearing always targets ONE job. The general console only clears when a job is selected.
  const clearTarget = general ? focusedJobId : jobId;
  const handleClear = async () => {
    const bridge = getBridge();
    if (!bridge?.cinemaConsoleClear || !clearTarget) return;
    await bridge.cinemaConsoleClear(clearTarget);
    queueRef.current = queueRef.current.filter((entry) => !entryBelongsTo(entry, clearTarget));
    setEntries((prev) => prev.filter((entry) => !entryBelongsTo(entry, clearTarget)));
    setTotal((value) => (general ? Math.max(0, value - entries.filter((e) => entryBelongsTo(e, clearTarget)).length) : 0));
    setExpanded({});
  };

  if (!consoleAvailable || (!general && !jobId)) return null;
  const heading = props.title ?? (general ? 'Console Geral de Produções' : 'Console de Produção');

  const runningJobs = jobs.filter((job) => job.status === 'running').length;
  const footerDetail = `${counters.commands} comando(s) · ${counters.streams} linha(s) de stream · ${counters.warnings} aviso(s)`;

  return (
    <div
      style={panelStyle}
      data-console-panel={general ? 'general' : 'job'}
      data-console-job-id={general ? undefined : jobId}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        style={open ? headerOpenStyle : headerStyle}
        aria-expanded={open}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
          <span>{heading}</span>
          {general && jobs.length > 0 && (
            <span style={headerMetaStyle}>
              {jobs.length} produção(ões) · {runningJobs} em execução
            </span>
          )}
          {/* Collapsed: the header summarises progress. Open: the progress bar below says it once. */}
          {progress && !open && (
            <span style={headerMetaStyle} data-console-header-progress>
              {progress.label} · {progress.pct}%
            </span>
          )}
          {counters.errors > 0 && <span style={headerErrorStyle}>{counters.errors} erro(s)</span>}
          {counters.retries > 0 && <span style={headerMetaStyle}>{counters.retries} retry</span>}
        </span>
        <span style={headerToggleStyle} aria-hidden>
          {open ? '▴ Recolher' : '▾ Abrir'}
        </span>
      </button>

      {open && (
        <div style={bodyStyle}>
          {general && jobs.length > 0 && (
            <div style={jobStripStyle} role="list" aria-label="Produções">
              {jobs.slice(0, 24).map((job) => {
                const selected = filters.jobId === job.jobId;
                return (
                  <button
                    key={job.jobId}
                    type="button"
                    role="listitem"
                    data-console-job-chip={job.jobId}
                    data-console-job-status={job.status}
                    aria-pressed={selected}
                    title={`${job.title ?? job.jobId} — ${JOB_STATUS_LABELS[job.status]}${job.agents.length ? ` · agentes: ${job.agents.join(', ')}` : ''}`}
                    onClick={() => patchFilters({ jobId: selected ? 'all' : job.jobId })}
                    style={{ ...jobChipStyle, ...(selected ? jobChipSelectedStyle : {}) }}
                  >
                    <span style={{ color: JOB_STATUS_COLORS[job.status] }} aria-hidden>
                      ●
                    </span>
                    <span style={jobChipTitleStyle}>{jobLabel(job)}</span>
                    <span style={{ ...mutedStyle, whiteSpace: 'nowrap' }}>
                      {job.pct !== undefined ? `${job.pct}% · ` : ''}
                      {JOB_STATUS_LABELS[job.status]}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {focusedJobId && (
            <>
              <AgentRunStatus runs={agentRuns} projectId={focusedProjectId} />
              <div style={progressRowStyle}>
                <div style={progressTrackStyle}>
                  <div data-console-progress-fill style={{ ...progressFillStyle, width: `${progress?.pct ?? 0}%` }} />
                </div>
                <span data-console-progress-label style={progressLabelStyle}>
                  {progress ? `${progress.pct}% · ${progress.label}` : 'aguardando progresso'}
                </span>
                <button
                  type="button"
                  onClick={() => setStagesOpen((value) => !value)}
                  aria-expanded={stagesOpen}
                  style={ghostBtnStyle}
                >
                  {stagesOpen ? 'Ocultar etapas' : 'Etapas'}
                  {filters.stage !== 'all' ? ` · ${STAGE_LABELS[filters.stage] ?? filters.stage}` : ''}
                </button>
              </div>

              {/* Stage chips stay mounted (filter state and test hooks) and are only shown on demand. */}
              <div style={timelineStyle} hidden={!stagesOpen}>
                {timeline.map((item) => {
                  const style = STATUS_STYLE[item.status] ?? { dot: '#334155', label: '#64748b' };
                  const selected = filters.stage === item.stage;
                  return (
                    <button
                      key={item.stage}
                      type="button"
                      data-stage-status={item.status}
                      aria-pressed={selected}
                      title={`${item.label} — ${item.status}${item.pct !== undefined ? ` (${item.pct}%)` : ''}${
                        item.durationMs !== undefined ? ` · ${item.durationMs}ms` : ''
                      }`}
                      onClick={() => patchFilters({ stage: selected ? 'all' : item.stage })}
                      style={{ ...stageChipStyle, ...(selected ? jobChipSelectedStyle : {}) }}
                    >
                      <span style={{ color: style.dot }} aria-hidden>
                        {STATUS_ICON[item.status] ?? '○'}
                      </span>
                      <span style={{ color: style.label }}>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div style={toolbarStyle}>
            <div style={segmentedStyle} role="group" aria-label="Visão do console">
              {TABS.map((tab) => {
                const active = filters.tab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={active}
                    onClick={() => patchFilters({ tab: tab.id })}
                    style={{ ...segmentStyle, ...(active ? segmentActiveStyle : {}) }}
                  >
                    {tab.label}
                    {tab.id === 'errors' && counters.errors > 0 ? ` ${counters.errors}` : ''}
                  </button>
                );
              })}
            </div>
            <input
              type="search"
              value={filters.search}
              onChange={(event) => patchFilters({ search: event.target.value })}
              placeholder="Filtrar logs..."
              aria-label="Filtrar logs"
              style={searchStyle}
            />
            <button
              type="button"
              onClick={() => setFiltersOpen((value) => !value)}
              aria-expanded={filtersOpen}
              style={{ ...ghostBtnStyle, ...(activeFilterCount > 0 ? activeFilterBtnStyle : {}) }}
            >
              Filtros{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
            </button>
          </div>

          {/* Advanced filters stay mounted (their state survives) and only take space when asked for. */}
          <div style={filtersPanelStyle} hidden={!filtersOpen}>
            {general && (
              <>
                <FilterSelect
                  label="Job"
                  value={filters.jobId}
                  onChange={(value) => patchFilters({ jobId: value })}
                  options={[
                    { value: 'all', label: 'Todos' },
                    ...jobs.map((job) => ({ value: job.jobId, label: `${JOB_KIND_LABELS[job.kind]} · ${jobLabel(job)}` })),
                  ]}
                />
                <FilterSelect
                  label="Status"
                  value={filters.status}
                  onChange={(value) => patchFilters({ status: value as 'all' | ConsoleJobStatus })}
                  options={[
                    { value: 'all', label: 'Todos' },
                    ...(Object.keys(JOB_STATUS_LABELS) as ConsoleJobStatus[]).map((status) => ({
                      value: status,
                      label: JOB_STATUS_LABELS[status],
                    })),
                  ]}
                />
              </>
            )}
            <FilterSelect
              label="Origem"
              value={filters.origin}
              onChange={(value) => patchFilters({ origin: value as 'all' | ConsoleOrigin })}
              options={[
                { value: 'all', label: 'Todas' },
                ...(Object.keys(ORIGIN_LABELS) as ConsoleOrigin[]).map((origin) => ({
                  value: origin,
                  label: ORIGIN_LABELS[origin],
                })),
              ]}
            />
            <FilterSelect
              label="Agente/fonte"
              value={filters.source}
              onChange={(value) => patchFilters({ source: value })}
              options={[{ value: 'all', label: 'Todas' }, ...knownSources.map((source) => ({ value: source, label: source }))]}
            />
            <FilterSelect
              label="Etapa"
              value={filters.stage}
              onChange={(value) => patchFilters({ stage: value })}
              options={[
                { value: 'all', label: 'Todas' },
                ...knownStages.map((stage) => ({ value: stage, label: STAGE_LABELS[stage] ?? stage })),
              ]}
            />
            <FilterSelect
              label="Nível"
              value={filters.severity}
              onChange={(value) => patchFilters({ severity: value as 'all' | ConsoleSeverity })}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'info', label: 'Info' },
                { value: 'warn', label: 'Aviso' },
                { value: 'error', label: 'Erro' },
                { value: 'debug', label: 'Debug' },
              ]}
            />
            <FilterSelect
              label="Canal"
              value={filters.channel}
              onChange={(value) => patchFilters({ channel: value as ConsoleFilters['channel'] })}
              options={[
                { value: 'all', label: 'Todos' },
                { value: 'progress', label: 'Progresso' },
                { value: 'stream', label: 'stdout/stderr' },
                { value: 'command', label: 'Comandos' },
                { value: 'result', label: 'Resultados' },
              ]}
            />
            <FilterSelect
              label="Período"
              value={filters.period}
              onChange={(value) => patchFilters({ period: value as ConsoleFilters['period'] })}
              options={PERIODS.map((period) => ({ value: period.id, label: period.label }))}
            />
            <button
              type="button"
              onClick={() => setFilters((prev) => ({ ...INITIAL_FILTERS, tab: prev.tab, search: prev.search }))}
              disabled={activeFilterCount === 0}
              style={{ ...ghostBtnStyle, alignSelf: 'end', opacity: activeFilterCount === 0 ? 0.5 : 1 }}
            >
              Limpar filtros
            </button>
          </div>

          <div ref={scrollRef} style={logAreaStyle} role="log" aria-live="off">
            {loading && entries.length === 0 && <div style={emptyStyle}>Carregando histórico...</div>}
            {!loading && visible.length === 0 && <div style={emptyStyle}>Nenhum log registrado para este filtro.</div>}
            {visible.map((entry) => (
              <ConsoleRow
                key={entry.id}
                entry={entry}
                showJob={general && !focusedJobId}
                expanded={isExpanded(entry)}
                onToggle={toggleExpand}
              />
            ))}
          </div>

          <div style={footerStyle}>
            <span title={`${footerDetail} · ${total} no histórico`}>
              {visible.length} de {entries.length} linha(s)
              <span data-console-footer-job style={{ marginLeft: 8 }}>
                {general
                  ? focusedJobId
                    ? `· ${focusedJobId}`
                    : `· ${uniqueSorted(visible.map(entryJobId)).length} produção(ões)`
                  : attempt > 1
                    ? `· tentativa ${attempt}`
                    : ''}
              </span>
            </span>
            <span style={footerActionsStyle}>
              <label style={checkboxStyle}>
                <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
                Auto-scroll
              </label>
              <button type="button" onClick={() => void handleCopy()} style={linkBtnStyle}>
                Copiar
              </button>
              <button type="button" onClick={() => void handleExport('txt')} style={linkBtnStyle} title="Exportar como texto">
                TXT
              </button>
              <button type="button" onClick={() => void handleExport('json')} style={linkBtnStyle} title="Exportar como JSON">
                JSON
              </button>
              <button
                type="button"
                onClick={() => void handleClear()}
                disabled={!clearTarget}
                title={clearTarget ? `Limpa apenas o log do job ${clearTarget}` : 'Selecione um job para limpar o log dele'}
                style={{ ...linkBtnStyle, color: '#fca5a5', opacity: clearTarget ? 1 : 0.4 }}
              >
                Limpar
              </button>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

interface ConsoleRowProps {
  entry: ConsoleEntry;
  /** General console: show which job the line belongs to. */
  showJob: boolean;
  expanded: boolean;
  onToggle: (id: string) => void;
}

/**
 * One log line. Only what changes the reading stays on the line: time, severity when it is not routine, origin, stage,
 * notable events and the exit code of failures. Source, duration, channel and the rest are one click away in details.
 */
const ConsoleRow = memo(function ConsoleRow({ entry, showJob, expanded, onToggle }: ConsoleRowProps) {
  const error = isErrorEntry(entry);
  const stream = isStreamEntry(entry);
  const details = entryDetailRows(entry);
  const hasDetails = details.length > 3;
  const originColor = ORIGIN_COLORS[entry.origin] ?? '#94a3b8';
  const notable = entry.severity === 'warn' || entry.severity === 'error';
  const failedExit = entry.exitCode !== undefined && entry.exitCode !== null && entry.exitCode !== 0;
  return (
    <div
      data-console-row
      data-console-job={entryJobId(entry)}
      data-console-attempt={entry.attempt}
      data-console-channel={entry.channel}
      data-console-origin={entry.origin}
      data-console-severity={entry.severity}
      data-console-event={entry.event}
      style={{
        ...rowStyle,
        ...(error ? rowErrorStyle : {}),
        ...(entry.severity === 'debug' && !error ? rowDebugStyle : {}),
      }}
    >
      <div style={rowHeaderStyle}>
        <span style={timeStyle}>{formatTime(entry.timestamp)}</span>
        {showJob && (
          <span style={rowJobStyle} title={entryJobId(entry)}>
            {entryJobId(entry).slice(-8)}
            {entry.attempt && entry.attempt > 1 ? `#${entry.attempt}` : ''}
          </span>
        )}
        {notable && (
          <span style={{ ...severityStyle, color: SEVERITY_COLORS[entry.severity] ?? '#c4b5fd' }}>
            {entry.severity === 'error' ? 'ERRO' : 'AVISO'}
          </span>
        )}
        <span style={{ color: originColor }}>{ORIGIN_LABELS[entry.origin] ?? entry.origin}</span>
        <span style={mutedStyle}>· {STAGE_LABELS[entry.stage] ?? entry.stage}</span>
        {entry.event !== 'log' && (
          <span style={{ ...eventStyle, color: error ? '#fca5a5' : '#c4b5fd' }}>{EVENT_LABELS[entry.event]}</span>
        )}
        <span style={mutedStyle}>{entry.source}</span>
        {stream && <span style={mutedStyle}>{entry.channel}</span>}
        {failedExit && <span style={{ color: '#fca5a5' }}>exit {entry.exitCode}</span>}
        {hasDetails && (
          <button type="button" onClick={() => onToggle(entry.id)} style={detailsBtnStyle} aria-expanded={expanded}>
            {expanded ? '▾ detalhes' : '▸ detalhes'}
          </button>
        )}
      </div>
      <div style={{ ...messageStyle, ...(stream ? streamMessageStyle : {}) }}>{entry.message}</div>
      {expanded && hasDetails && (
        <div data-console-details style={detailsPanelStyle}>
          {details.map((row) => (
            <div key={row.label} style={detailRowStyle}>
              <span style={detailLabelStyle}>{row.label}</span>
              <pre style={detailValueStyle}>{row.value}</pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label style={selectLabelStyle}>
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)} style={selectStyle}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// Quiet console: one accent (primary), muted metadata, colour only where it carries meaning (errors, warnings, status).
const MUTED = '#8b8aa3';
const SUBTLE = '#6b6a82';

const panelStyle: React.CSSProperties = {
  marginTop: 8,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 40,
  textAlign: 'left',
  padding: '8px 14px',
  background: 'transparent',
  color: 'var(--foreground)',
  border: 0,
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 600,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
};
const headerOpenStyle: React.CSSProperties = { ...headerStyle, borderBottom: '1px solid var(--border)' };
const headerMetaStyle: React.CSSProperties = { fontSize: 12, fontWeight: 400, color: MUTED };
const headerErrorStyle: React.CSSProperties = {
  fontSize: 12,
  fontWeight: 500,
  color: '#fca5a5',
  padding: '1px 8px',
  borderRadius: 999,
  background: 'rgba(248, 113, 113, 0.14)',
};
const headerToggleStyle: React.CSSProperties = { fontSize: 12, fontWeight: 400, color: MUTED, flexShrink: 0 };

const bodyStyle: React.CSSProperties = { padding: 12, display: 'flex', flexDirection: 'column', gap: 10 };
const mutedStyle: React.CSSProperties = { color: MUTED };

const jobStripStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };
const jobChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  minHeight: 32,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'transparent',
  fontSize: 12,
  cursor: 'pointer',
  maxWidth: 420,
};
const jobChipSelectedStyle: React.CSSProperties = {
  borderColor: 'var(--primary)',
  background: 'color-mix(in srgb, var(--primary) 14%, transparent)',
};
const jobChipTitleStyle: React.CSSProperties = {
  color: 'var(--foreground)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};
const rowJobStyle: React.CSSProperties = { color: '#fcd34d' };

const progressRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 };
const progressTrackStyle: React.CSSProperties = {
  flex: 1,
  height: 4,
  borderRadius: 999,
  background: 'var(--muted)',
  overflow: 'hidden',
};
const progressFillStyle: React.CSSProperties = {
  height: '100%',
  background: 'var(--primary)',
  transition: 'width 220ms ease-out',
};
const progressLabelStyle: React.CSSProperties = { fontSize: 12, color: MUTED, whiteSpace: 'nowrap' };

const timelineStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };
const stageChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  minHeight: 28,
  padding: '2px 10px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'transparent',
  fontSize: 12,
  cursor: 'pointer',
};

const toolbarStyle: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' };
const segmentedStyle: React.CSSProperties = {
  display: 'inline-flex',
  padding: 2,
  borderRadius: 6,
  background: 'var(--muted)',
};
const segmentStyle: React.CSSProperties = {
  minHeight: 28,
  padding: '4px 12px',
  borderRadius: 4,
  border: 0,
  background: 'transparent',
  color: MUTED,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 500,
};
const segmentActiveStyle: React.CSSProperties = { background: 'var(--card)', color: 'var(--foreground)' };
const searchStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 160,
  minHeight: 32,
  padding: '4px 10px',
  borderRadius: 6,
  border: '1px solid var(--input)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  fontSize: 12,
};
const ghostBtnStyle: React.CSSProperties = {
  minHeight: 32,
  padding: '4px 12px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'transparent',
  color: 'var(--foreground)',
  cursor: 'pointer',
  fontSize: 12,
  whiteSpace: 'nowrap',
};
const activeFilterBtnStyle: React.CSSProperties = { borderColor: 'var(--primary)', color: '#ddd6fe' };

const filtersPanelStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
  gap: 10,
  padding: 10,
  borderRadius: 6,
  background: 'color-mix(in srgb, var(--muted) 45%, transparent)',
};
const selectLabelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 12,
  color: MUTED,
};
const selectStyle: React.CSSProperties = {
  minHeight: 32,
  padding: '4px 8px',
  borderRadius: 6,
  border: '1px solid var(--input)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  fontSize: 12,
  width: '100%',
};
const checkboxStyle: React.CSSProperties = {
  fontSize: 12,
  color: MUTED,
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  cursor: 'pointer',
};

const logAreaStyle: React.CSSProperties = {
  maxHeight: 320,
  overflowY: 'auto',
  overflowX: 'hidden',
  background: 'var(--background)',
  borderRadius: 6,
  padding: '6px 8px',
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  fontSize: 12,
  lineHeight: 1.6,
};
const emptyStyle: React.CSSProperties = { color: MUTED, padding: 4 };

const rowStyle: React.CSSProperties = {
  padding: '4px 6px',
  borderLeft: '2px solid transparent',
  borderRadius: 3,
};
const rowErrorStyle: React.CSSProperties = { borderLeftColor: '#f87171', background: 'rgba(248, 113, 113, 0.06)' };
const rowDebugStyle: React.CSSProperties = { opacity: 0.6 };
const rowHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  flexWrap: 'wrap',
};
const timeStyle: React.CSSProperties = { color: SUBTLE };
const severityStyle: React.CSSProperties = { fontWeight: 700 };
const eventStyle: React.CSSProperties = { fontWeight: 600 };
const messageStyle: React.CSSProperties = { color: 'var(--foreground)', wordBreak: 'break-word', whiteSpace: 'pre-wrap' };
const streamMessageStyle: React.CSSProperties = { color: '#cbd5e1' };
const detailsBtnStyle: React.CSSProperties = {
  marginLeft: 'auto',
  padding: 0,
  border: 0,
  background: 'transparent',
  color: SUBTLE,
  cursor: 'pointer',
  fontSize: 12,
};
const detailsPanelStyle: React.CSSProperties = {
  marginTop: 4,
  padding: 8,
  borderRadius: 4,
  background: 'var(--card)',
  border: '1px solid var(--border)',
};
const detailRowStyle: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 2 };
const detailLabelStyle: React.CSSProperties = { minWidth: 96, color: MUTED, fontSize: 12 };
const detailValueStyle: React.CSSProperties = {
  margin: 0,
  flex: 1,
  color: '#cbd5e1',
  fontSize: 12,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'inherit',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
  flexWrap: 'wrap',
  fontSize: 12,
  color: MUTED,
};
const footerActionsStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' };
const linkBtnStyle: React.CSSProperties = {
  minHeight: 28,
  padding: '2px 8px',
  borderRadius: 4,
  border: 0,
  background: 'transparent',
  color: '#ddd6fe',
  cursor: 'pointer',
  fontSize: 12,
};
