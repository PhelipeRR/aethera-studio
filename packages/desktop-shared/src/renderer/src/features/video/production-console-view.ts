export type ConsoleSeverity = 'info' | 'warn' | 'error' | 'debug';
export type ConsoleChannel = 'progress' | 'stdout' | 'stderr' | 'command' | 'result';
export type ConsoleEvent =
  | 'stage_started'
  | 'stage_completed'
  | 'stage_failed'
  | 'stage_retry'
  | 'stage_paused'
  | 'command_started'
  | 'command_completed'
  | 'command_failed'
  | 'agent_heartbeat'
  | 'job_started'
  | 'job_completed'
  | 'job_failed'
  | 'job_paused'
  | 'job_cancelled'
  | 'log';
export type ConsoleOrigin =
  | 'pipeline'
  | 'agent'
  | 'pesquisa'
  | 'aquisicao'
  | 'narracao'
  | 'renderizacao'
  | 'sfx_vfx'
  | 'vision'
  | 'tool'
  | 'system';

export interface ConsoleEntry {
  id: string;
  timestamp: string;
  projectId: string;
  /** The production execution the line belongs to. A console shows one job; the general console shows many. */
  jobId?: string;
  /** Attempt of the job (resume/retry of the whole production). */
  attempt?: number;
  /** Emission order inside the main-process log store; breaks timestamp ties. */
  seq?: number;
  runId?: string;
  stage: string;
  origin: ConsoleOrigin;
  channel: ConsoleChannel;
  event: ConsoleEvent;
  severity: ConsoleSeverity;
  source: string;
  message: string;
  pct?: number;
  durationMs?: number;
  exitCode?: number | null;
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export type ConsoleTab = 'terminal' | 'events' | 'errors';

export type ConsoleChannelFilter = 'all' | 'progress' | 'stream' | 'result' | 'command';
export type ConsolePeriod = 'all' | '5m' | '15m' | '1h';

export interface ConsoleFilters {
  tab: ConsoleTab;
  severity: 'all' | ConsoleSeverity;
  stage: 'all' | string;
  origin: 'all' | ConsoleOrigin;
  source: 'all' | string;
  channel: ConsoleChannelFilter;
  period: ConsolePeriod;
  search: string;
  /** General console only: one job, or every job. */
  jobId: 'all' | string;
  /** General console only: status of the job the line belongs to. */
  status: 'all' | ConsoleJobStatus;
}

export const INITIAL_FILTERS: ConsoleFilters = {
  tab: 'terminal',
  severity: 'all',
  stage: 'all',
  origin: 'all',
  source: 'all',
  channel: 'all',
  period: 'all',
  search: '',
  jobId: 'all',
  status: 'all',
};

export const STAGE_LABELS: Record<string, string> = {
  prompt: 'Prompt',
  interpretacao: 'Interpretação',
  pesquisa: 'Pesquisa',
  roteiro: 'Roteiro',
  decupagem: 'Decupagem',
  aquisicao: 'Aquisição',
  validacao_visual: 'Validação Visual',
  planejamento: 'Planejamento',
  montagem: 'Montagem',
  audio_sfx_vfx: 'Áudio/SFX/VFX',
  qc: 'Quality Gate',
  previa: 'Prévia',
  renderizacao: 'Renderização',
  editor: 'Editor',
  agent: 'Agente',
  tool: 'Ferramenta',
  download: 'Download',
  narration: 'Narração',
  fallback: 'Fallback',
  system: 'Sistema',
};

export const ORIGIN_LABELS: Record<ConsoleOrigin, string> = {
  pipeline: 'Pipeline',
  agent: 'Agente',
  pesquisa: 'Pesquisa',
  aquisicao: 'Aquisição',
  narracao: 'Narração',
  renderizacao: 'Renderização',
  sfx_vfx: 'SFX/VFX',
  vision: 'Visão',
  tool: 'Ferramenta',
  system: 'Sistema',
};

export const ORIGIN_COLORS: Record<ConsoleOrigin, string> = {
  pipeline: '#5eead4',
  agent: '#c4b5fd',
  pesquisa: '#93c5fd',
  aquisicao: '#fcd34d',
  narracao: '#f9a8d4',
  renderizacao: '#7dd3fc',
  sfx_vfx: '#fda4af',
  vision: '#a7f3d0',
  tool: '#94a3b8',
  system: '#64748b',
};

export const SEVERITY_COLORS: Record<ConsoleSeverity, string> = {
  info: '#5eead4',
  warn: '#fbbf24',
  error: '#f87171',
  debug: '#94a3b8',
};

export const EVENT_LABELS: Record<ConsoleEvent, string> = {
  stage_started: 'início',
  stage_completed: 'concluída',
  stage_failed: 'falha',
  stage_retry: 'retry',
  stage_paused: 'pausada',
  command_started: 'comando',
  command_completed: 'concluído',
  command_failed: 'falhou',
  agent_heartbeat: 'agente',
  job_started: 'job iniciado',
  job_completed: 'job concluído',
  job_failed: 'job falhou',
  job_paused: 'job pausado',
  job_cancelled: 'job cancelado',
  log: 'log',
};

/** Stages shown in the timeline, in execution order. */
export const STAGE_ORDER = [
  'prompt',
  'interpretacao',
  'pesquisa',
  'roteiro',
  'decupagem',
  'aquisicao',
  'validacao_visual',
  'planejamento',
  'montagem',
  'audio_sfx_vfx',
  'qc',
  'previa',
  'editor',
] as const;

const STREAM_CHANNELS = new Set<ConsoleChannel>(['stdout', 'stderr']);
const EVENT_STAGES = new Set(['agent', 'tool', 'download', 'narration', 'fallback']);

export function isStreamEntry(entry: ConsoleEntry): boolean {
  return STREAM_CHANNELS.has(entry.channel);
}

export function isLifecycleEntry(entry: ConsoleEntry): boolean {
  return entry.event !== 'log';
}

export function isErrorEntry(entry: ConsoleEntry): boolean {
  return (
    entry.severity === 'error' ||
    entry.event === 'stage_failed' ||
    entry.event === 'command_failed' ||
    entry.event === 'job_failed'
  );
}

const PERIOD_MS: Record<Exclude<ConsolePeriod, 'all'>, number> = {
  '5m': 5 * 60_000,
  '15m': 15 * 60_000,
  '1h': 60 * 60_000,
};

export function filterEntries(
  entries: ConsoleEntry[],
  filters: ConsoleFilters,
  now = Date.now(),
  jobStatus?: (jobId: string) => ConsoleJobStatus | undefined,
): ConsoleEntry[] {
  const term = filters.search.trim().toLowerCase();
  const sinceMs = filters.period === 'all' ? null : now - PERIOD_MS[filters.period];
  return entries.filter((entry) => {
    if (filters.jobId !== 'all' && entryJobId(entry) !== filters.jobId) return false;
    if (filters.status !== 'all' && jobStatus?.(entryJobId(entry)) !== filters.status) return false;
    if (filters.tab === 'events' && !isLifecycleEntry(entry) && !EVENT_STAGES.has(entry.stage)) return false;
    if (filters.tab === 'errors' && !isErrorEntry(entry)) return false;
    if (filters.severity !== 'all' && entry.severity !== filters.severity) return false;
    if (filters.stage !== 'all' && entry.stage !== filters.stage) return false;
    if (filters.origin !== 'all' && entry.origin !== filters.origin) return false;
    if (filters.source !== 'all' && entry.source !== filters.source) return false;
    if (filters.channel === 'stream' && !isStreamEntry(entry)) return false;
    if (filters.channel === 'progress' && entry.channel !== 'progress') return false;
    if (filters.channel === 'result' && entry.channel !== 'result') return false;
    if (filters.channel === 'command' && entry.channel !== 'command') return false;
    if (sinceMs !== null && Date.parse(entry.timestamp) < sinceMs) return false;
    if (term && !matches(entry, term)) return false;
    return true;
  });
}

function matches(entry: ConsoleEntry, term: string): boolean {
  if (entry.message.toLowerCase().includes(term)) return true;
  if (entry.source.toLowerCase().includes(term)) return true;
  if (entry.stage.toLowerCase().includes(term)) return true;
  if (entry.origin.toLowerCase().includes(term)) return true;
  if (entryJobId(entry).toLowerCase().includes(term)) return true;
  if (entry.details && JSON.stringify(entry.details).toLowerCase().includes(term)) return true;
  return false;
}

export type StageTimelineStatus = 'pending' | 'active' | 'done' | 'failed' | 'retry' | 'paused';

export interface StageTimelineItem {
  stage: string;
  label: string;
  status: StageTimelineStatus;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  pct?: number;
}

/** Lifecycle of each production stage, derived only from the entries that were really written. */
export function buildStageTimeline(entries: ConsoleEntry[]): StageTimelineItem[] {
  const items = new Map<string, StageTimelineItem>();
  for (const stage of STAGE_ORDER) {
    items.set(stage, { stage, label: STAGE_LABELS[stage] ?? stage, status: 'pending' });
  }
  for (const entry of entries) {
    const item = items.get(entry.stage);
    if (!item) continue;
    switch (entry.event) {
      case 'stage_started':
        item.status = 'active';
        item.startedAt ??= entry.timestamp;
        delete item.finishedAt;
        break;
      case 'stage_retry':
        item.status = 'retry';
        item.startedAt = entry.timestamp;
        delete item.finishedAt;
        break;
      case 'stage_completed':
        item.status = 'done';
        item.finishedAt = entry.timestamp;
        if (entry.durationMs !== undefined) item.durationMs = entry.durationMs;
        break;
      case 'stage_failed':
        item.status = 'failed';
        item.finishedAt = entry.timestamp;
        break;
      case 'stage_paused':
        item.status = 'paused';
        item.finishedAt = entry.timestamp;
        break;
      default:
        break;
    }
    if (entry.pct !== undefined) item.pct = entry.pct;
  }
  return [...items.values()];
}

export interface ConsoleProgress {
  pct: number;
  stage: string;
  label: string;
  timestamp: string;
}

/** Latest percentage the pipeline really reported, used by the header bar. */
export function currentProgress(entries: ConsoleEntry[]): ConsoleProgress | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (!entry || entry.pct === undefined) continue;
    return {
      pct: entry.pct,
      stage: entry.stage,
      label: STAGE_LABELS[entry.stage] ?? entry.stage,
      timestamp: entry.timestamp,
    };
  }
  return null;
}

// ─── Live agent runs (long editorial executions) ────────────────────────────

export type AgentRunState =
  | 'starting'
  | 'active'
  | 'silent'
  | 'stalled'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out';

export const AGENT_STATE_LABELS: Record<AgentRunState, string> = {
  starting: 'Iniciando',
  active: 'Ativo',
  silent: 'Raciocinando (sem eventos)',
  stalled: 'Travamento confirmado',
  completed: 'Concluído',
  failed: 'Falhou',
  cancelled: 'Cancelado',
  timed_out: 'Tempo máximo excedido',
};

export const AGENT_STATE_COLORS: Record<AgentRunState, string> = {
  starting: '#94a3b8',
  active: '#2dd4bf',
  silent: '#a78bfa',
  stalled: '#f87171',
  completed: '#34d399',
  failed: '#f87171',
  cancelled: '#94a3b8',
  timed_out: '#fbbf24',
};

export interface LiveAgentRun {
  runId: string;
  source: string;
  stage: string;
  /** Label of the command line ("Pesquisa editorial (Claude Code (claude))"). */
  label: string;
  startedAt: string;
  state: AgentRunState;
  lastEventAt: string | null;
  lastEventSummary: string | null;
  /** Time without real progress at the last heartbeat. */
  idleMs: number | null;
  inactivityTimeoutMs: number | null;
  maxDurationMs: number | null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/**
 * Agent commands that started and have not reported their outcome yet, with their latest heartbeat. Derived only
 * from real console entries: nothing is shown for a run that never wrote a `command_started`.
 */
export function liveAgentRuns(entries: ConsoleEntry[]): LiveAgentRun[] {
  const runs = new Map<string, LiveAgentRun>();
  for (const entry of entries) {
    if (entry.origin !== 'agent' || !entry.runId) continue;
    const key = `${entry.runId}::${entry.source}`;
    if (entry.event === 'command_started') {
      runs.set(key, {
        runId: entry.runId,
        source: entry.source,
        stage: entry.stage,
        label: entry.message.replace(/:\s*\S+ iniciado$/, ''),
        startedAt: entry.timestamp,
        state: 'starting',
        lastEventAt: null,
        lastEventSummary: null,
        idleMs: null,
        inactivityTimeoutMs: null,
        maxDurationMs: null,
      });
      continue;
    }
    const run = runs.get(key);
    if (!run) continue;
    if (entry.event === 'command_completed' || entry.event === 'command_failed') {
      runs.delete(key);
      continue;
    }
    if (entry.event === 'agent_heartbeat') {
      const details = entry.details ?? {};
      const state = asString(details['state']) as AgentRunState | null;
      if (state && state in AGENT_STATE_LABELS) run.state = state;
      run.lastEventAt = asString(details['lastEventAt']) ?? run.lastEventAt;
      run.lastEventSummary = asString(details['lastEventSummary']) ?? run.lastEventSummary;
      run.idleMs = asNumber(details['idleMs']);
      run.inactivityTimeoutMs = asNumber(details['inactivityTimeoutMs']);
      run.maxDurationMs = asNumber(details['maxDurationMs']);
      continue;
    }
    if (isStreamEntry(entry)) {
      // Real output between heartbeats is the most recent event the user can see.
      run.lastEventAt = entry.timestamp;
      run.lastEventSummary = entry.message.slice(0, 240);
      // State stays with the supervisor: a repeated banner is an event, not progress.
    }
  }
  return [...runs.values()];
}

/** "4m05s" / "38s". */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`;
  return m > 0 ? `${m}m${String(s).padStart(2, '0')}s` : `${s}s`;
}

export interface ConsoleCounters {
  total: number;
  errors: number;
  warnings: number;
  retries: number;
  commands: number;
  streams: number;
}

export function summarize(entries: ConsoleEntry[]): ConsoleCounters {
  let errors = 0;
  let warnings = 0;
  let retries = 0;
  let commands = 0;
  let streams = 0;
  for (const entry of entries) {
    if (entry.severity === 'error') errors += 1;
    if (entry.severity === 'warn') warnings += 1;
    if (entry.event === 'stage_retry' || entry.event === 'command_failed') retries += 1;
    if (entry.event === 'job_started' && (entry.attempt ?? 1) > 1) retries += 1;
    if (entry.channel === 'command') commands += 1;
    if (isStreamEntry(entry)) streams += 1;
  }
  return { total: entries.length, errors, warnings, retries, commands, streams };
}

export function formatTime(timestamp: string): string {
  return timestamp.slice(11, 23);
}

export function formatEntryLine(entry: ConsoleEntry, withJob = false): string {
  const job = withJob ? ` [${entryJobId(entry)}${entry.attempt && entry.attempt > 1 ? `#${entry.attempt}` : ''}]` : '';
  const pct = entry.pct !== undefined ? ` ${entry.pct}%` : '';
  const duration = entry.durationMs !== undefined ? ` (${entry.durationMs}ms)` : '';
  const exit = entry.exitCode !== undefined && entry.exitCode !== null ? ` exit=${entry.exitCode}` : '';
  const stream = isStreamEntry(entry) ? ` <${entry.channel}>` : '';
  return `[${formatTime(entry.timestamp)}]${job} [${entry.severity.toUpperCase()}] [${entry.stage}${pct}] [${entry.origin}/${entry.source}]${stream} ${entry.message}${duration}${exit}`;
}

export interface DetailRow {
  label: string;
  value: string;
}

/** Rows of the expandable “detalhes técnicos”, only for what the entry really carries. */
export function entryDetailRows(entry: ConsoleEntry): DetailRow[] {
  const rows: DetailRow[] = [
    { label: 'Evento', value: `${entry.event} · canal ${entry.channel}` },
    { label: 'Origem', value: `${entry.origin} · ${entry.source}` },
    { label: 'Job', value: entryJobId(entry) },
    { label: 'Projeto', value: entry.projectId },
  ];
  if (entry.attempt !== undefined) rows.push({ label: 'Tentativa', value: String(entry.attempt) });
  if (entry.runId) rows.push({ label: 'Execução', value: entry.runId });
  if (entry.exitCode !== undefined && entry.exitCode !== null) rows.push({ label: 'Exit code', value: String(entry.exitCode) });
  if (entry.durationMs !== undefined) rows.push({ label: 'Duração', value: `${entry.durationMs} ms` });
  if (entry.details) {
    for (const [key, value] of Object.entries(entry.details)) {
      rows.push({ label: key, value: typeof value === 'string' ? value : JSON.stringify(value, null, 2) });
    }
  }
  return rows;
}

export function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

// ─── Jobs: one console per production execution ─────────────────────────────

export type ConsoleJobKind = 'video' | 'thumbnail' | 'media' | 'other';
export type ConsoleJobStatus = 'running' | 'completed' | 'failed' | 'paused' | 'cancelled' | 'idle';

export interface ConsoleJobSummary {
  jobId: string;
  projectId: string;
  kind: ConsoleJobKind;
  title?: string;
  attempt: number;
  status: ConsoleJobStatus;
  live: boolean;
  pct?: number;
  stage?: string;
  createdAt?: string;
  updatedAt?: string;
  entries: number;
  errors: number;
  retries: number;
  agents: string[];
}

export const JOB_STATUS_LABELS: Record<ConsoleJobStatus, string> = {
  running: 'Em execução',
  completed: 'Concluído',
  failed: 'Falhou',
  paused: 'Pausado',
  cancelled: 'Cancelado',
  idle: 'Sem eventos',
};

export const JOB_STATUS_COLORS: Record<ConsoleJobStatus, string> = {
  running: '#2dd4bf',
  completed: '#34d399',
  failed: '#f87171',
  paused: '#a78bfa',
  cancelled: '#94a3b8',
  idle: '#64748b',
};

export const JOB_KIND_LABELS: Record<ConsoleJobKind, string> = {
  video: 'Vídeo',
  thumbnail: 'Thumbnail',
  media: 'Mídia',
  other: 'Outro',
};

const JOB_STATUS_BY_EVENT: Partial<Record<ConsoleEvent, ConsoleJobStatus>> = {
  job_started: 'running',
  job_completed: 'completed',
  job_failed: 'failed',
  job_paused: 'paused',
  job_cancelled: 'cancelled',
};

/** The console a line belongs to. Lines written before jobs existed fall back to their project id. */
export function entryJobId(entry: Pick<ConsoleEntry, 'jobId' | 'projectId'>): string {
  return entry.jobId ?? entry.projectId;
}

/** Isolation rule of an individual console: only lines of its own job are ever accepted. */
export function entryBelongsTo(entry: Pick<ConsoleEntry, 'jobId' | 'projectId'>, jobId: string): boolean {
  return entryJobId(entry) === jobId;
}

/** Emission order across jobs: timestamp, then the store sequence. */
export function compareConsoleEntries(a: ConsoleEntry, b: ConsoleEntry): number {
  const byTime = a.timestamp.localeCompare(b.timestamp);
  if (byTime !== 0) return byTime;
  return (a.seq ?? 0) - (b.seq ?? 0);
}

/**
 * Merges a history snapshot (or a live batch) into what the console already shows, without duplicates and in
 * emission order. Lines that arrive while the history is loading (UI reconnection) are neither lost nor repeated.
 */
export function mergeConsoleEntries(current: ConsoleEntry[], incoming: ConsoleEntry[], max: number): ConsoleEntry[] {
  if (!incoming.length) return current;
  const seen = new Set(current.map((entry) => entry.id));
  const merged = [...current];
  let outOfOrder = false;
  for (const entry of incoming) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    const last = merged[merged.length - 1];
    if (last && compareConsoleEntries(last, entry) > 0) outOfOrder = true;
    merged.push(entry);
  }
  if (outOfOrder) merged.sort(compareConsoleEntries);
  return merged.length > max ? merged.slice(merged.length - max) : merged;
}

/** Applies one live line to the job list of the general console (status, %, stage, counters). */
export function applyEntryToJobs(jobs: ConsoleJobSummary[], entry: ConsoleEntry): ConsoleJobSummary[] {
  const jobId = entryJobId(entry);
  const index = jobs.findIndex((job) => job.jobId === jobId);
  const existing = index >= 0 ? jobs[index] : undefined;
  const base: ConsoleJobSummary = existing
    ? { ...existing, agents: [...existing.agents] }
    : {
          jobId,
          projectId: entry.projectId,
          kind: 'other',
          attempt: entry.attempt ?? 1,
          status: 'running',
          live: true,
          createdAt: entry.timestamp,
          entries: 0,
          errors: 0,
          retries: 0,
          agents: [],
        };
  base.entries += 1;
  base.updatedAt = entry.timestamp;
  if (entry.attempt !== undefined && entry.attempt > base.attempt) base.attempt = entry.attempt;
  if (entry.severity === 'error') base.errors += 1;
  if (entry.event === 'stage_retry') base.retries += 1;
  if (entry.pct !== undefined) base.pct = entry.pct;
  if (entry.channel === 'progress' && entry.stage !== 'system') base.stage = entry.stage;
  if (entry.origin === 'agent' && entry.channel === 'command' && !base.agents.includes(entry.source)) {
    base.agents = [...base.agents, entry.source].sort();
  }
  const status = JOB_STATUS_BY_EVENT[entry.event];
  if (status) {
    base.status = status;
    base.live = status === 'running';
  }
  const next = index >= 0 ? jobs.map((job, i) => (i === index ? base : job)) : [base, ...jobs];
  return next;
}

/** Short, readable label of a job for selectors and row badges. */
export function jobLabel(job: Pick<ConsoleJobSummary, 'jobId' | 'title'>): string {
  const shortId = job.jobId.length > 14 ? `…${job.jobId.slice(-8)}` : job.jobId;
  return job.title ? `${job.title.slice(0, 48)} (${shortId})` : shortId;
}
