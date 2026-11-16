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
        <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'monospace' }}>▍</span>
          <span>{heading}</span>
          {!general && (
            <span style={headerJobStyle} title={jobId}>
              {jobId}
              {attempt > 1 ? ` · tentativa ${attempt}` : ''}
            </span>
          )}
          {general && jobs.length > 0 && (
            <span style={headerProgressStyle}>
              {jobs.length} job(s) · {jobs.filter((job) => job.status === 'running').length} em execução
            </span>
          )}
          {progress && (
            <span style={headerProgressStyle} data-console-header-progress>
              {progress.label} · {progress.pct}%
            </span>
          )}
          {counters.errors > 0 && <span style={headerErrorStyle}>{counters.errors} erro(s)</span>}
          {counters.retries > 0 && <span style={headerRetryStyle}>{counters.retries} retry</span>}
        </span>
        <span style={{ fontSize: 10, opacity: 0.8 }}>{open ? '▲ Recolher' : '▼ Abrir'}</span>
      </button>

      {open && (
        <div style={{ padding: 10 }}>
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
                    style={{
                      ...jobChipStyle,
                      borderColor: selected ? JOB_STATUS_COLORS[job.status] : 'var(--input)',
                      background: selected ? 'var(--input)' : 'transparent',
                    }}
                  >
                    <span style={{ color: JOB_STATUS_COLORS[job.status] }}>●</span>
                    <span style={{ color: 'var(--foreground)' }}>{jobLabel(job)}</span>
                    <span style={{ color: '#c4b5fd' }}>{job.pct !== undefined ? `${job.pct}%` : '—'}</span>
                    <span style={{ color: '#94a3b8' }}>{JOB_STATUS_LABELS[job.status]}</span>
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
                <span
                  data-console-progress-label
                  style={{ fontFamily: 'monospace', fontSize: 11, color: '#ddd6fe', minWidth: 132 }}
                >
                  {progress ? `${progress.pct}% · ${progress.label}` : 'aguardando progresso'}
                </span>
              </div>

              <div style={timelineStyle}>
                {timeline.map((item) => {
                  const style = STATUS_STYLE[item.status] ?? { dot: '#334155', label: '#64748b' };
                  return (
                    <button
                      key={item.stage}
                      type="button"
                      data-stage-status={item.status}
                      title={`${item.label} — ${item.status}${item.pct !== undefined ? ` (${item.pct}%)` : ''}${
                        item.durationMs !== undefined ? ` · ${item.durationMs}ms` : ''
                      }`}
                      onClick={() => patchFilters({ stage: filters.stage === item.stage ? 'all' : item.stage })}
                      style={{
                        ...stageChipStyle,
                        borderColor: filters.stage === item.stage ? style.dot : 'var(--input)',
                        background: filters.stage === item.stage ? 'var(--input)' : 'transparent',
                      }}
                    >
                      <span style={{ color: style.dot }}>{STATUS_ICON[item.status] ?? '○'}</span>
                      <span style={{ color: style.label }}>{item.label}</span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div style={toolbarStyle}>
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => patchFilters({ tab: tab.id })}
                style={{
                  ...tabStyle,
                  fontWeight: filters.tab === tab.id ? 700 : 400,
                  background: filters.tab === tab.id ? 'var(--primary)' : 'color-mix(in srgb, var(--primary) 14%, var(--card))',
                  color: filters.tab === tab.id ? 'var(--primary-foreground)' : '#ddd6fe',
                }}
              >
                {tab.label}
              </button>
            ))}
            <input
              value={filters.search}
              onChange={(event) => patchFilters({ search: event.target.value })}
              placeholder="Filtrar logs..."
              aria-label="Filtrar logs"
              style={searchStyle}
            />
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
            <label style={checkboxStyle}>
              <input type="checkbox" checked={autoScroll} onChange={(event) => setAutoScroll(event.target.checked)} />
              Auto-scroll
            </label>
            <button type="button" onClick={() => setFilters(INITIAL_FILTERS)} style={toolbarBtnStyle}>
              Limpar filtros
            </button>
            <button type="button" onClick={() => void handleCopy()} style={toolbarBtnStyle}>
              Copiar
            </button>
            <button type="button" onClick={() => void handleExport('txt')} style={toolbarBtnStyle}>
              TXT
            </button>
            <button type="button" onClick={() => void handleExport('json')} style={toolbarBtnStyle}>
              JSON
            </button>
            <button
              type="button"
              onClick={() => void handleClear()}
              disabled={!clearTarget}
              title={clearTarget ? `Limpa apenas o log do job ${clearTarget}` : 'Selecione um job para limpar o log dele'}
              style={{ ...toolbarBtnStyle, color: '#f87171', opacity: clearTarget ? 1 : 0.4 }}
            >
              Limpar
            </button>
          </div>

          <div ref={scrollRef} style={logAreaStyle} role="log" aria-live="off">
            {loading && entries.length === 0 && <div style={emptyStyle}>Carregando histórico...</div>}
            {!loading && visible.length === 0 && <div style={emptyStyle}>Nenhum log registrado para este filtro.</div>}
            {visible.map((entry) => (
              <ConsoleRow
                key={entry.id}
                entry={entry}
                showJob={general}
                expanded={isExpanded(entry)}
                onToggle={toggleExpand}
              />
            ))}
          </div>

          <div style={footerStyle}>
            <span>
              {visible.length} de {entries.length} na janela · {total} no histórico
            </span>
            <span>
              {counters.commands} comando(s) · {counters.streams} linha(s) de stream · {counters.warnings} aviso(s)
            </span>
            <span data-console-footer-job>
              {general
                ? focusedJobId
                  ? `Job: ${focusedJobId}`
                  : `${uniqueSorted(visible.map(entryJobId)).length} job(s) na janela`
                : `Job: ${jobId}${attempt > 1 ? ` · tentativa ${attempt}` : ''}`}
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

const ConsoleRow = memo(function ConsoleRow({ entry, showJob, expanded, onToggle }: ConsoleRowProps) {
  const error = isErrorEntry(entry);
  const stream = isStreamEntry(entry);
  const details = entryDetailRows(entry);
  const hasDetails = details.length > 3;
  const originColor = ORIGIN_COLORS[entry.origin] ?? '#94a3b8';
  return (
    <div
      data-console-row
      data-console-job={entryJobId(entry)}
      data-console-attempt={entry.attempt}
      data-console-channel={entry.channel}
      data-console-origin={entry.origin}
      data-console-severity={entry.severity}
      data-console-event={entry.event}
      style={{ ...rowStyle, ...(error ? rowErrorStyle : {}), ...(stream ? rowStreamStyle : {}) }}
    >
      <div style={rowHeaderStyle}>
        <span style={timeStyle}>{formatTime(entry.timestamp)}</span>
        {showJob && (
          <span style={rowJobStyle} title={entryJobId(entry)}>
            {entryJobId(entry).slice(-8)}
            {entry.attempt && entry.attempt > 1 ? `#${entry.attempt}` : ''}
          </span>
        )}
        <span style={{ ...severityStyle, color: SEVERITY_COLORS[entry.severity] ?? '#c4b5fd' }}>
          {entry.severity.toUpperCase()}
        </span>
        <span style={{ ...originBadgeStyle, borderColor: originColor, color: originColor }}>
          {ORIGIN_LABELS[entry.origin] ?? entry.origin}
        </span>
        <span style={stageStyle}>{STAGE_LABELS[entry.stage] ?? entry.stage}</span>
        {entry.pct !== undefined && <span style={pctStyle}>{entry.pct}%</span>}
        {entry.event !== 'log' && (
          <span style={{ ...eventStyle, color: error ? '#fca5a5' : '#7dd3fc' }}>{EVENT_LABELS[entry.event]}</span>
        )}
        {stream && <span style={streamStyle}>{entry.channel}</span>}
        <span style={sourceStyle}>{entry.source}</span>
        {entry.durationMs !== undefined && <span style={metaStyle}>{entry.durationMs}ms</span>}
        {entry.exitCode !== undefined && entry.exitCode !== null && (
          <span style={{ ...metaStyle, color: entry.exitCode === 0 ? '#6ee7b7' : '#fca5a5' }}>
            exit {entry.exitCode}
          </span>
        )}
        {hasDetails && (
          <button type="button" onClick={() => onToggle(entry.id)} style={detailsBtnStyle}>
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

const panelStyle: React.CSSProperties = {
  marginTop: 8,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--card)',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  width: '100%',
  textAlign: 'left',
  padding: '8px 12px',
  background: 'color-mix(in srgb, var(--primary) 14%, var(--card))',
  color: 'var(--foreground)',
  border: 0,
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 8,
};

const headerOpenStyle: React.CSSProperties = { ...headerStyle, background: 'color-mix(in srgb, var(--primary) 30%, var(--card))' };
const headerProgressStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 10,
  fontWeight: 400,
  padding: '1px 6px',
  borderRadius: 999,
  background: 'rgb(0 0 0 / 28%)',
};
const headerJobStyle: React.CSSProperties = {
  fontFamily: 'monospace',
  fontSize: 10,
  fontWeight: 400,
  color: '#ddd6fe',
  opacity: 0.9,
};
const jobStripStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 };
const jobChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '3px 8px',
  borderRadius: 6,
  border: '1px solid var(--input)',
  fontSize: 10,
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  cursor: 'pointer',
  maxWidth: 420,
};
const rowJobStyle: React.CSSProperties = {
  color: '#fcd34d',
  fontSize: 9,
  padding: '0 4px',
  borderRadius: 3,
  border: '1px solid rgba(252, 211, 77, 0.4)',
};
const headerErrorStyle: React.CSSProperties = { ...headerProgressStyle, background: 'rgba(248, 113, 113, 0.25)' };
const headerRetryStyle: React.CSSProperties = { ...headerProgressStyle, background: 'rgba(251, 191, 36, 0.25)' };

const progressRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 };
const progressTrackStyle: React.CSSProperties = {
  flex: 1,
  height: 6,
  borderRadius: 999,
  background: 'var(--background)',
  border: '1px solid var(--input)',
  overflow: 'hidden',
};
const progressFillStyle: React.CSSProperties = {
  height: '100%',
  background: 'var(--primary)',
  transition: 'width 220ms ease-out',
};

const timelineStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 };
const stageChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 7px',
  borderRadius: 999,
  border: '1px solid var(--input)',
  background: 'transparent',
  fontSize: 10,
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  cursor: 'pointer',
};

const toolbarStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
  marginBottom: 8,
  flexWrap: 'wrap',
  alignItems: 'center',
};
const tabStyle: React.CSSProperties = {
  padding: '4px 10px',
  borderRadius: 4,
  border: 0,
  cursor: 'pointer',
  fontSize: 11,
};
const searchStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 140,
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid var(--input)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  fontSize: 11,
};
const selectLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 10,
  color: '#c4b5fd',
  fontFamily: 'monospace',
};
const selectStyle: React.CSSProperties = {
  padding: '3px 6px',
  borderRadius: 4,
  border: '1px solid var(--input)',
  background: 'var(--background)',
  color: 'var(--foreground)',
  fontSize: 11,
  maxWidth: 150,
};
const checkboxStyle: React.CSSProperties = {
  fontSize: 11,
  color: '#ddd6fe',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const logAreaStyle: React.CSSProperties = {
  maxHeight: 320,
  overflowY: 'auto',
  overflowX: 'hidden',
  background: 'var(--background)',
  borderRadius: 6,
  padding: 8,
  fontFamily: '"JetBrains Mono", "Fira Code", monospace',
  fontSize: 11,
  lineHeight: 1.55,
};
const emptyStyle: React.CSSProperties = { color: '#94a3b8', padding: 4 };

const rowStyle: React.CSSProperties = {
  padding: '2px 4px',
  borderLeft: '2px solid transparent',
  borderRadius: 3,
};
const rowErrorStyle: React.CSSProperties = { borderLeftColor: '#f87171', background: 'rgba(248, 113, 113, 0.07)' };
const rowStreamStyle: React.CSSProperties = { background: 'rgba(148, 163, 184, 0.05)' };
const rowHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 6,
  flexWrap: 'wrap',
};
const timeStyle: React.CSSProperties = { color: '#64748b' };
const severityStyle: React.CSSProperties = { fontWeight: 700, minWidth: 44, display: 'inline-block' };
const originBadgeStyle: React.CSSProperties = {
  padding: '0 5px',
  borderRadius: 3,
  border: '1px solid',
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};
const stageStyle: React.CSSProperties = { color: '#a78bfa' };
const pctStyle: React.CSSProperties = {
  color: 'var(--card)',
  background: '#c4b5fd',
  borderRadius: 999,
  padding: '0 6px',
  fontSize: 9,
  fontWeight: 700,
};
const eventStyle: React.CSSProperties = { fontSize: 9, textTransform: 'uppercase', letterSpacing: 0.4 };
const streamStyle: React.CSSProperties = { fontSize: 9, color: '#94a3b8', textTransform: 'lowercase' };
const sourceStyle: React.CSSProperties = { color: '#94a3b8' };
const metaStyle: React.CSSProperties = { color: '#64748b' };
const messageStyle: React.CSSProperties = { color: 'var(--foreground)', wordBreak: 'break-word', whiteSpace: 'pre-wrap' };
const streamMessageStyle: React.CSSProperties = { color: '#cbd5e1' };
const detailsBtnStyle: React.CSSProperties = {
  marginLeft: 'auto',
  padding: 0,
  border: 0,
  background: 'transparent',
  color: '#67e8f9',
  cursor: 'pointer',
  fontSize: 10,
};
const detailsPanelStyle: React.CSSProperties = {
  marginTop: 4,
  padding: 6,
  borderRadius: 4,
  background: 'var(--card)',
  border: '1px solid var(--input)',
};
const detailRowStyle: React.CSSProperties = { display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 2 };
const detailLabelStyle: React.CSSProperties = {
  minWidth: 96,
  color: '#c4b5fd',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: 0.4,
};
const detailValueStyle: React.CSSProperties = {
  margin: 0,
  flex: 1,
  color: '#cbd5e1',
  fontSize: 10,
  whiteSpace: 'pre-wrap',
  wordBreak: 'break-word',
  fontFamily: 'inherit',
};

const footerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 8,
  flexWrap: 'wrap',
  fontSize: 10,
  color: '#64748b',
  marginTop: 6,
};

const toolbarBtnStyle: React.CSSProperties = {
  padding: '4px 8px',
  borderRadius: 4,
  border: '1px solid var(--input)',
  background: 'color-mix(in srgb, var(--primary) 14%, var(--card))',
  color: '#ddd6fe',
  cursor: 'pointer',
  fontSize: 11,
};
