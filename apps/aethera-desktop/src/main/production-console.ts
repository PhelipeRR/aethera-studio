import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

export type ProductionLogSeverity = 'info' | 'warn' | 'error' | 'debug';
export type ProductionLogStage =
  | 'prompt'
  | 'interpretacao'
  | 'pesquisa'
  | 'roteiro'
  | 'decupagem'
  | 'aquisicao'
  | 'validacao_visual'
  | 'planejamento'
  | 'montagem'
  | 'audio_sfx_vfx'
  | 'qc'
  | 'previa'
  | 'renderizacao'
  | 'editor'
  | 'agent'
  | 'tool'
  | 'download'
  | 'narration'
  | 'fallback'
  | 'system';

/**
 * Where a line came from: the pipeline's own progress, or the raw stream of a command the app really ran.
 * `progress` covers lifecycle and percentage events, `stdout`/`stderr` are captured verbatim, `command` marks
 * the start of an execution and `result` its outcome.
 */
export type ProductionLogChannel = 'progress' | 'stdout' | 'stderr' | 'command' | 'result';

/** Lifecycle of a production stage or of a command execution. */
export type ProductionLogEvent =
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

/** What kind of production a console job belongs to. */
export type ProductionJobKind = 'video' | 'thumbnail' | 'media' | 'other';

/** Lifecycle of a whole production job, derived from its `job_*` events (and stage events for older logs). */
export type ProductionJobStatus = 'running' | 'completed' | 'failed' | 'paused' | 'cancelled' | 'idle';

/**
 * The execution a project is running right now. A project can run many productions over time (and each production
 * many attempts), so `projectId` never identifies a console: entries are routed to `jobId` and tagged with `attempt`.
 */
export interface ProductionJobBinding {
  jobId: string;
  projectId: string;
  attempt: number;
  kind: ProductionJobKind;
  title?: string;
}

export interface ProductionJobSummary {
  jobId: string;
  projectId: string;
  kind: ProductionJobKind;
  title?: string;
  attempt: number;
  status: ProductionJobStatus;
  /** True while the job is bound to a live execution in this process. */
  live: boolean;
  pct?: number;
  stage?: ProductionLogStage;
  createdAt?: string;
  updatedAt?: string;
  entries: number;
  errors: number;
  retries: number;
  agents: string[];
}

const JOB_STATUS_BY_EVENT: Partial<Record<ProductionLogEvent, ProductionJobStatus>> = {
  job_started: 'running',
  job_completed: 'completed',
  job_failed: 'failed',
  job_paused: 'paused',
  job_cancelled: 'cancelled',
};

/** Unique id for one production execution; never derived from the project id. */
export function createProductionJobId(prefix = 'job'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Which part of the studio produced the entry, independent of the concrete source name. */
export type ProductionLogOrigin =
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

export interface ProductionLogEntry {
  id: string;
  timestamp: string;
  projectId: string;
  /** Production job the entry belongs to; entries of different jobs are never mixed in one file. */
  jobId?: string;
  /** Attempt of the job (1 = first run, +1 per resume/retry of the whole job). */
  attempt?: number;
  /** Monotonic order of emission in this log store; breaks ties between entries written in the same millisecond. */
  seq?: number;
  /** One execution (a single CLI run, a single acquisition) inside the job. */
  runId?: string;
  stage: ProductionLogStage;
  origin: ProductionLogOrigin;
  channel: ProductionLogChannel;
  event: ProductionLogEvent;
  severity: ProductionLogSeverity;
  source: string;
  message: string;
  /** Progress percentage of the job when the entry was written, 0-100. */
  pct?: number;
  durationMs?: number;
  exitCode?: number | null;
  /** Technical detail rendered on demand (command, arguments, stderr tail, error stack). */
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface ProductionConsoleDeps {
  logsDir: string;
  maxEntriesInMemory: number;
  maxFileSizeBytes: number;
  /** Longest string kept per field/message; longer values are clipped with a marker. */
  maxFieldChars: number;
  redactPatterns: RegExp[];
}

export interface ProductionConsoleFilters {
  limit?: number;
  offset?: number;
  severity?: ProductionLogSeverity;
  stage?: ProductionLogStage;
  origin?: ProductionLogOrigin;
  channel?: ProductionLogChannel;
  event?: ProductionLogEvent;
  /** Exact source name (e.g. `claude-cli`, `pipeline`, `yt-dlp`). */
  source?: string;
  search?: string;
  /** ISO timestamp; entries older than it are dropped. */
  since?: string;
  /** ISO timestamp; entries newer than it are dropped. */
  until?: string;
  /** Return the newest `limit` entries (a terminal shows the tail) instead of the oldest. */
  tail?: boolean;
  attempt?: number;
}

/** Filters of the general console, which reads every job. */
export interface ProductionConsoleAllFilters extends ProductionConsoleFilters {
  jobIds?: string[];
  kind?: ProductionJobKind;
  status?: ProductionJobStatus;
}

export interface ProductionConsoleFacets {
  sources: Array<{ value: string; count: number }>;
  origins: Array<{ value: ProductionLogOrigin; count: number }>;
  stages: Array<{ value: ProductionLogStage; count: number }>;
  channels: Array<{ value: ProductionLogChannel; count: number }>;
  events: Array<{ value: ProductionLogEvent; count: number }>;
  severities: Array<{ value: ProductionLogSeverity; count: number }>;
}

const DEFAULT_REDACT_PATTERNS: RegExp[] = [
  /api[_-]?key\s*[:=]\s*["']?[\w-]{8,}["']?/gi,
  /authorization\s*[:=]\s*["']?Bearer\s+[\w.\-+/=]+["']?/gi,
  /bearer\s+[\w.\-+/=]{8,}/gi,
  /token\s*[:=]\s*["']?[\w.\-+/=]{8,}["']?/gi,
  /password\s*[:=]?\s*["']?[^\s"']{4,}["']?/gi,
  /secret\s*[:=]\s*["']?[\w.\-+/=]{8,}["']?/gi,
  /sk[-_][A-Za-z0-9\-_]{12,}/g,
  /sk[-_]live[A-Za-z0-9\-_]{8,}/g,
  /ghp_[A-Za-z0-9]{36,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9\-_]+\.eyJ[A-Za-z0-9\-_.]+/g,
];

const DEFAULT_CHANNEL: ProductionLogChannel = 'progress';
const DEFAULT_EVENT: ProductionLogEvent = 'log';

/** Entries written before the console gained these fields are still readable: origin comes from the stage. */
export function inferOrigin(stage: ProductionLogStage, source: string): ProductionLogOrigin {
  if (source === 'pipeline') return 'pipeline';
  switch (stage) {
    case 'pesquisa':
      return 'pesquisa';
    case 'aquisicao':
    case 'download':
      return 'aquisicao';
    case 'narration':
    case 'audio_sfx_vfx':
      return 'narracao';
    case 'montagem':
    case 'renderizacao':
    case 'previa':
    case 'editor':
      return 'renderizacao';
    case 'validacao_visual':
    case 'qc':
      return 'vision';
    case 'agent':
    case 'roteiro':
    case 'interpretacao':
      return 'agent';
    case 'tool':
      return 'tool';
    case 'fallback':
      return 'system';
    default:
      return 'pipeline';
  }
}

export interface EmitProductionLogInput {
  projectId: string;
  /** Omit to route to the job currently bound to `projectId` (see `bindJob`). */
  jobId?: string;
  attempt?: number;
  runId?: string;
  stage: ProductionLogStage;
  severity: ProductionLogSeverity;
  source: string;
  message: string;
  origin?: ProductionLogOrigin;
  channel?: ProductionLogChannel;
  event?: ProductionLogEvent;
  pct?: number;
  durationMs?: number;
  exitCode?: number | null;
  details?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

export class ProductionConsoleService {
  private readonly logsDir: string;
  private readonly maxEntriesInMemory: number;
  private readonly maxFileSizeBytes: number;
  private readonly maxFieldChars: number;
  private readonly redactPatterns: RegExp[];
  /** Log buffers keyed by job id. Legacy logs (written before jobs existed) use the project id as job id. */
  private readonly buffers = new Map<string, ProductionLogEntry[]>();
  private readonly listeners = new Set<(entry: ProductionLogEntry) => void>();
  /** Live execution of each project: entries emitted with only a `projectId` are routed to this job. */
  private readonly activeByProject = new Map<string, ProductionJobBinding>();
  /**
   * Last finished execution of each project. A cancelled job can still flush a few lines (an aborted CLI reporting
   * its exit) after it was released; they belong to that job, not to a console named after the project.
   */
  private readonly recentByProject = new Map<string, ProductionJobBinding>();
  /** Known jobs (persisted in `jobs-index.json`), so the general console can name them after a restart. */
  private readonly jobIndex = new Map<string, Omit<ProductionJobBinding, 'jobId'> & { createdAt: string }>();
  /** Jobs running in this process, with their current attempt. */
  private readonly liveAttempts = new Map<string, number>();
  private seq = 0;

  constructor(deps: Partial<ProductionConsoleDeps> & { logsDir: string }) {
    this.logsDir = deps.logsDir;
    this.maxEntriesInMemory = deps.maxEntriesInMemory ?? 4000;
    this.maxFileSizeBytes = deps.maxFileSizeBytes ?? 8 * 1024 * 1024;
    this.maxFieldChars = deps.maxFieldChars ?? 4000;
    this.redactPatterns = deps.redactPatterns ?? DEFAULT_REDACT_PATTERNS;
    mkdirSync(this.logsDir, { recursive: true });
    this.loadJobIndex();
  }

  subscribe(listener: (entry: ProductionLogEntry) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Declares the execution a project is running. Entries emitted afterwards with that `projectId` and no explicit
   * `jobId` (agents, research, media acquisition, narration, render) land in this job's console.
   */
  bindJob(binding: ProductionJobBinding): void {
    const normalized = this.registerJob(binding);
    this.activeByProject.set(binding.projectId, normalized);
    this.recentByProject.delete(binding.projectId);
  }

  /**
   * Records a live job without routing its project's entries to it. Used when several jobs of one project run at the
   * same time (thumbnails): each of them emits with an explicit `jobId`.
   */
  registerJob(binding: ProductionJobBinding): ProductionJobBinding {
    const normalized: ProductionJobBinding = { ...binding, attempt: Math.max(1, Math.round(binding.attempt || 1)) };
    this.liveAttempts.set(binding.jobId, normalized.attempt);
    const known = this.jobIndex.get(binding.jobId);
    this.jobIndex.set(binding.jobId, {
      projectId: binding.projectId,
      attempt: normalized.attempt,
      kind: binding.kind,
      ...((title) => (title ? { title } : {}))(binding.title ?? known?.title),
      createdAt: known?.createdAt ?? new Date().toISOString(),
    });
    this.saveJobIndex();
    return normalized;
  }

  /** Ends the live binding of a job; later project-only entries no longer route to it. History is untouched. */
  releaseJob(jobId: string): void {
    this.liveAttempts.delete(jobId);
    for (const [projectId, binding] of this.activeByProject) {
      if (binding.jobId !== jobId) continue;
      this.activeByProject.delete(projectId);
      this.recentByProject.set(projectId, binding);
    }
  }

  /** Live jobs right now (one per project at most). */
  liveJobs(): ProductionJobBinding[] {
    return [...this.activeByProject.values()];
  }

  activeJob(projectId: string): ProductionJobBinding | undefined {
    return this.activeByProject.get(projectId);
  }

  emit(input: EmitProductionLogInput): ProductionLogEntry {
    const safeSource = this.redact(input.source);
    const bound = input.jobId
      ? undefined
      : (this.activeByProject.get(input.projectId) ?? this.recentByProject.get(input.projectId));
    const jobId = input.jobId ?? bound?.jobId ?? input.projectId;
    const attempt = input.attempt ?? bound?.attempt ?? this.liveAttempt(jobId);
    this.seq += 1;
    const entry: ProductionLogEntry = {
      id: `${Date.now().toString(36)}-${this.seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toISOString(),
      projectId: input.projectId,
      jobId,
      ...(attempt !== undefined ? { attempt } : {}),
      seq: this.seq,
      ...(input.runId ? { runId: input.runId } : {}),
      stage: input.stage,
      origin: input.origin ?? inferOrigin(input.stage, safeSource),
      channel: input.channel ?? DEFAULT_CHANNEL,
      event: input.event ?? DEFAULT_EVENT,
      severity: input.severity,
      source: safeSource,
      message: this.clean(input.message),
      ...(input.pct !== undefined ? { pct: clampPct(input.pct) } : {}),
      ...(input.durationMs !== undefined ? { durationMs: Math.max(0, Math.round(input.durationMs)) } : {}),
      ...(input.exitCode !== undefined ? { exitCode: input.exitCode } : {}),
      ...(input.details ? { details: this.redactRecord(input.details) } : {}),
      ...(input.metadata ? { metadata: this.redactRecord(input.metadata) } : {}),
    };

    if (!this.jobIndex.has(jobId)) {
      this.jobIndex.set(jobId, {
        projectId: input.projectId,
        attempt: attempt ?? 1,
        kind: 'other',
        createdAt: entry.timestamp,
      });
      this.saveJobIndex();
    }

    const buffer = this.getBuffer(jobId);
    buffer.push(entry);
    if (buffer.length > this.maxEntriesInMemory) {
      buffer.splice(0, buffer.length - this.maxEntriesInMemory);
    }

    this.persistEntry(jobId, entry);
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // listener errors must not break the pipeline
      }
    }
    return entry;
  }

  /** Entries of ONE job. Never reads another job's buffer. */
  list(jobId: string, options: ProductionConsoleFilters = {}): { entries: ProductionLogEntry[]; total: number } {
    return paginate(this.getBuffer(jobId).filter(entryFilter(options)), options);
  }

  /** General console: every job merged in emission order, filterable by job, kind and status. */
  listAll(options: ProductionConsoleAllFilters = {}): { entries: ProductionLogEntry[]; total: number } {
    const jobs = this.jobs().filter(
      (job) =>
        (!options.jobIds?.length || options.jobIds.includes(job.jobId)) &&
        (!options.kind || job.kind === options.kind) &&
        (!options.status || job.status === options.status),
    );
    const accept = entryFilter(options);
    const merged: ProductionLogEntry[] = [];
    for (const job of jobs) {
      for (const entry of this.getBuffer(job.jobId)) if (accept(entry)) merged.push(entry);
    }
    merged.sort(compareEntries);
    return paginate(merged, options);
  }

  /** Every job with a log on disk or in memory, newest activity first. */
  jobs(): ProductionJobSummary[] {
    const ids = new Set<string>([...this.jobIndex.keys(), ...this.buffers.keys()]);
    try {
      for (const file of readdirSync(this.logsDir)) {
        if (file.endsWith('.log.jsonl')) ids.add(file.slice(0, -'.log.jsonl'.length));
      }
    } catch {
      // unreadable dir: in-memory jobs are still listed
    }
    const out: ProductionJobSummary[] = [];
    for (const id of ids) {
      const summary = this.summarizeJob(id);
      if (summary) out.push(summary);
    }
    return out.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
  }

  summarizeJob(jobId: string): ProductionJobSummary | null {
    const buffer = this.getBuffer(jobId);
    const meta = this.jobIndex.get(jobId);
    if (!buffer.length && !meta) return null;
    let status: ProductionJobStatus = 'idle';
    let fromJobEvents = false;
    let pct: number | undefined;
    let stage: ProductionLogStage | undefined;
    let errors = 0;
    let retries = 0;
    let attempt = meta?.attempt ?? 1;
    const agents = new Set<string>();
    for (const entry of buffer) {
      if (entry.attempt !== undefined && entry.attempt > attempt) attempt = entry.attempt;
      if (entry.severity === 'error') errors += 1;
      if (entry.event === 'stage_retry') retries += 1;
      if (entry.origin === 'agent' && entry.channel === 'command') agents.add(entry.source);
      if (entry.pct !== undefined) pct = entry.pct;
      if (entry.channel === 'progress' && entry.stage !== 'system') stage = entry.stage;
      const jobStatus = JOB_STATUS_BY_EVENT[entry.event];
      if (jobStatus) {
        status = jobStatus;
        fromJobEvents = true;
      } else if (!fromJobEvents) {
        // logs written before job_* events existed: derive from stage lifecycle
        if (entry.event === 'stage_failed') status = 'failed';
        else if (entry.event === 'stage_paused') status = 'paused';
        else if (entry.event === 'stage_started' || entry.event === 'stage_retry') status = entry.stage === 'editor' ? 'completed' : 'running';
      }
    }
    const live = this.liveAttempts.has(jobId);
    const first = buffer[0];
    const last = buffer[buffer.length - 1];
    return {
      jobId,
      projectId: meta?.projectId ?? first?.projectId ?? jobId,
      kind: meta?.kind ?? 'other',
      ...(meta?.title ? { title: meta.title } : {}),
      attempt,
      status,
      live,
      ...(pct !== undefined ? { pct } : {}),
      ...(stage ? { stage } : {}),
      ...((createdAt) => (createdAt ? { createdAt } : {}))(meta?.createdAt ?? first?.timestamp),
      ...(last ? { updatedAt: last.timestamp } : meta?.createdAt ? { updatedAt: meta.createdAt } : {}),
      entries: buffer.length,
      errors,
      retries,
      agents: [...agents].sort(),
    };
  }

  facets(jobId: string): ProductionConsoleFacets {
    const buffer = this.getBuffer(jobId);
    const sources = new Map<string, number>();
    const origins = new Map<ProductionLogOrigin, number>();
    const stages = new Map<ProductionLogStage, number>();
    const channels = new Map<ProductionLogChannel, number>();
    const events = new Map<ProductionLogEvent, number>();
    const severities = new Map<ProductionLogSeverity, number>();
    for (const entry of buffer) {
      bump(sources, entry.source);
      bump(origins, entry.origin);
      bump(stages, entry.stage);
      bump(channels, entry.channel);
      bump(events, entry.event);
      bump(severities, entry.severity);
    }
    return {
      sources: toFacetList(sources),
      origins: toFacetList(origins),
      stages: toFacetList(stages),
      channels: toFacetList(channels),
      events: toFacetList(events),
      severities: toFacetList(severities),
    };
  }

  loadFromDisk(jobId: string): ProductionLogEntry[] {
    const file = this.logFile(jobId);
    if (!existsSync(file)) return [];
    try {
      const content = readFileSync(file, 'utf8');
      const lines = content.trim().split('\n').filter(Boolean);
      const parsed: ProductionLogEntry[] = [];
      for (const line of lines) {
        try {
          const entry = this.normalize(JSON.parse(line) as Partial<ProductionLogEntry> & { projectId: string }, jobId);
          if (entry.seq !== undefined && entry.seq > this.seq) this.seq = entry.seq;
          parsed.push(entry);
        } catch {
          // skip malformed line
        }
      }
      const buffer = this.getBuffer(jobId);
      const existingIds = new Set(buffer.map((e) => e.id));
      for (const entry of parsed) {
        if (!existingIds.has(entry.id)) {
          buffer.push(entry);
        }
      }
      buffer.sort(compareEntries);
      if (buffer.length > this.maxEntriesInMemory) {
        buffer.splice(0, buffer.length - this.maxEntriesInMemory);
      }
      return buffer;
    } catch {
      return [];
    }
  }

  export(jobId: string, format: 'json' | 'txt'): string {
    const buffer = this.getBuffer(jobId);
    if (format === 'json') return JSON.stringify(buffer, null, 2);
    return buffer.map(formatEntryAsLine).join('\n');
  }

  /** Export of the general console (all jobs, or the given ones), in emission order. */
  exportAll(format: 'json' | 'txt', jobIds?: string[]): string {
    const { entries } = this.listAll({ ...(jobIds?.length ? { jobIds } : {}), limit: Number.MAX_SAFE_INTEGER });
    if (format === 'json') return JSON.stringify(entries, null, 2);
    return entries.map(formatEntryAsLine).join('\n');
  }

  /** Clears ONE job's log (memory and file). Other jobs, and this job's live binding, are untouched. */
  clear(jobId: string): void {
    this.buffers.set(jobId, []);
    const file = this.logFile(jobId);
    if (existsSync(file)) {
      writeFileSync(file, '', 'utf8');
    }
  }

  /** Attempt of a job that is live right now, used when an entry names the job but not the attempt. */
  private liveAttempt(jobId: string): number | undefined {
    return this.liveAttempts.get(jobId);
  }

  private getBuffer(jobId: string): ProductionLogEntry[] {
    let buffer = this.buffers.get(jobId);
    if (!buffer) {
      buffer = [];
      this.buffers.set(jobId, buffer);
      this.loadFromDisk(jobId);
    }
    return buffer;
  }

  private logFile(jobId: string): string {
    return join(this.logsDir, `${safeFileId(jobId)}.log.jsonl`);
  }

  private jobIndexFile(): string {
    return join(this.logsDir, 'jobs-index.json');
  }

  private loadJobIndex(): void {
    try {
      const file = this.jobIndexFile();
      if (!existsSync(file)) return;
      const raw = JSON.parse(readFileSync(file, 'utf8')) as Record<
        string,
        Omit<ProductionJobBinding, 'jobId'> & { createdAt: string }
      >;
      for (const [jobId, meta] of Object.entries(raw)) {
        if (meta && typeof meta.projectId === 'string') this.jobIndex.set(jobId, meta);
      }
    } catch {
      // a corrupt index only loses titles/kinds; logs are still read from their files
    }
  }

  private saveJobIndex(): void {
    try {
      writeFileSync(this.jobIndexFile(), JSON.stringify(Object.fromEntries(this.jobIndex), null, 2), 'utf8');
    } catch {
      // persistence failure must not block production
    }
  }

  private persistEntry(jobId: string, entry: ProductionLogEntry): void {
    const file = this.logFile(jobId);
    try {
      if (existsSync(file)) {
        const stats = statSync(file);
        if (stats.size > this.maxFileSizeBytes) {
          // rotate: keep last half
          const content = readFileSync(file, 'utf8');
          const lines = content.trim().split('\n');
          const keep = lines.slice(Math.floor(lines.length / 2));
          writeFileSync(file, keep.join('\n') + '\n', 'utf8');
        }
      }
      appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8');
    } catch {
      // persistence failure must not block production
    }
  }

  /** Fills the fields an older entry may not carry, so a log from a previous version still renders. */
  private normalize(raw: Partial<ProductionLogEntry> & { projectId: string }, fileJobId: string): ProductionLogEntry {
    const stage = (raw.stage ?? 'system') as ProductionLogStage;
    const source = raw.source ?? 'pipeline';
    return {
      id: raw.id ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: raw.timestamp ?? new Date().toISOString(),
      projectId: raw.projectId,
      jobId: raw.jobId ?? fileJobId,
      ...(raw.attempt !== undefined ? { attempt: raw.attempt } : {}),
      ...(raw.seq !== undefined ? { seq: raw.seq } : {}),
      ...(raw.runId ? { runId: raw.runId } : {}),
      stage,
      origin: raw.origin ?? inferOrigin(stage, source),
      channel: raw.channel ?? DEFAULT_CHANNEL,
      event: raw.event ?? DEFAULT_EVENT,
      severity: raw.severity ?? 'info',
      source,
      message: raw.message ?? '',
      ...(raw.pct !== undefined ? { pct: clampPct(raw.pct) } : {}),
      ...(raw.durationMs !== undefined ? { durationMs: raw.durationMs } : {}),
      ...(raw.exitCode !== undefined ? { exitCode: raw.exitCode } : {}),
      ...(raw.details ? { details: raw.details } : {}),
      ...(raw.metadata ? { metadata: raw.metadata } : {}),
    };
  }

  private clean(text: string): string {
    return clip(this.redact(text), this.maxFieldChars);
  }

  private redact(text: string): string {
    let result = text;
    for (const pattern of this.redactPatterns) {
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
  }

  private redactRecord(record: Record<string, unknown>): Record<string, unknown> {
    const sensitiveKeyPattern = /^(api[_-]?key|authorization|bearer|token|password|passwd|secret|credential|private[_-]?key|access[_-]?key)$/i;
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(record)) {
      if (typeof value === 'string') {
        const redactedByPattern = this.redact(value);
        if (redactedByPattern !== value) {
          out[key] = clip(redactedByPattern, this.maxFieldChars);
        } else if (sensitiveKeyPattern.test(key) && value.length >= 4) {
          out[key] = '[REDACTED]';
        } else {
          out[key] = clip(value, this.maxFieldChars);
        }
      } else if (Array.isArray(value)) {
        out[key] = value.map((item) =>
          typeof item === 'string'
            ? clip(this.redact(item), this.maxFieldChars)
            : item && typeof item === 'object'
              ? this.redactRecord(item as Record<string, unknown>)
              : item,
        );
      } else if (value && typeof value === 'object') {
        out[key] = this.redactRecord(value as Record<string, unknown>);
      } else {
        out[key] = value;
      }
    }
    return out;
  }
}

/** One console line, used by both the TXT export and the “copiar” button. */
export function formatEntryAsLine(entry: ProductionLogEntry): string {
  const time = entry.timestamp.slice(11, 23);
  const pct = entry.pct !== undefined ? ` ${entry.pct}%` : '';
  const duration = entry.durationMs !== undefined ? ` (${entry.durationMs}ms)` : '';
  const exit = entry.exitCode !== undefined && entry.exitCode !== null ? ` exit=${entry.exitCode}` : '';
  const channel = entry.channel === 'stdout' || entry.channel === 'stderr' ? ` <${entry.channel}>` : '';
  return `[${time}] [${entry.severity.toUpperCase()}] [${entry.stage}${pct}] [${entry.origin}/${entry.source}]${channel} ${entry.message}${duration}${exit}`;
}

function matchesSearch(entry: ProductionLogEntry, term: string): boolean {
  if (entry.message.toLowerCase().includes(term)) return true;
  if (entry.source.toLowerCase().includes(term)) return true;
  if (entry.stage.toLowerCase().includes(term)) return true;
  if (entry.origin.toLowerCase().includes(term)) return true;
  if (entry.jobId?.toLowerCase().includes(term)) return true;
  if (entry.details && JSON.stringify(entry.details).toLowerCase().includes(term)) return true;
  return false;
}

function safeFileId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/** Emission order: timestamp first, then the store's monotonic sequence for entries in the same millisecond. */
export function compareEntries(a: ProductionLogEntry, b: ProductionLogEntry): number {
  const byTime = a.timestamp.localeCompare(b.timestamp);
  if (byTime !== 0) return byTime;
  return (a.seq ?? 0) - (b.seq ?? 0);
}

function entryFilter(options: ProductionConsoleFilters): (entry: ProductionLogEntry) => boolean {
  const term = options.search?.trim().toLowerCase() ?? '';
  const sinceMs = options.since ? Date.parse(options.since) : Number.NaN;
  const untilMs = options.until ? Date.parse(options.until) : Number.NaN;
  return (entry) => {
    if (options.severity && entry.severity !== options.severity) return false;
    if (options.stage && entry.stage !== options.stage) return false;
    if (options.origin && entry.origin !== options.origin) return false;
    if (options.channel && entry.channel !== options.channel) return false;
    if (options.event && entry.event !== options.event) return false;
    if (options.source && entry.source !== options.source) return false;
    if (options.attempt !== undefined && entry.attempt !== options.attempt) return false;
    if (!Number.isNaN(sinceMs) && Date.parse(entry.timestamp) < sinceMs) return false;
    if (!Number.isNaN(untilMs) && Date.parse(entry.timestamp) > untilMs) return false;
    if (term && !matchesSearch(entry, term)) return false;
    return true;
  };
}

function paginate(
  filtered: ProductionLogEntry[],
  options: ProductionConsoleFilters,
): { entries: ProductionLogEntry[]; total: number } {
  const total = filtered.length;
  const offset = options.offset ?? 0;
  const limit = options.limit ?? 300;
  if (options.tail) {
    const end = Math.max(0, total - offset);
    return { entries: filtered.slice(Math.max(0, end - limit), end), total };
  }
  return { entries: filtered.slice(offset, offset + limit), total };
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}…[truncado ${text.length - max} chars]`;
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function bump<K>(map: Map<K, number>, key: K): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function toFacetList<K extends string>(map: Map<K, number>): Array<{ value: K; count: number }> {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function createProductionConsoleService(logsDir: string): ProductionConsoleService {
  return new ProductionConsoleService({ logsDir });
}
