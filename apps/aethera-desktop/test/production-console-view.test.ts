import { describe, expect, it } from 'vitest';
import {
  INITIAL_FILTERS,
  applyEntryToJobs,
  buildStageTimeline,
  entryBelongsTo,
  mergeConsoleEntries,
  currentProgress,
  entryDetailRows,
  filterEntries,
  formatEntryLine,
  isErrorEntry,
  formatDuration,
  liveAgentRuns,
  summarize,
  type ConsoleEntry,
} from '../../../packages/desktop-shared/src/renderer/src/features/video/production-console-view.js';

let counter = 0;
function entry(overrides: Partial<ConsoleEntry> = {}): ConsoleEntry {
  counter += 1;
  return {
    id: `e${counter}`,
    timestamp: new Date().toISOString(),
    projectId: 'job_1',
    jobId: 'job_1',
    stage: 'pesquisa',
    origin: 'pesquisa',
    channel: 'progress',
    event: 'log',
    severity: 'info',
    source: 'pipeline',
    message: `linha ${counter}`,
    ...overrides,
  };
}

describe('production-console-view — filtros da interface', () => {
  it('filters by severity, stage, origin, source and channel', () => {
    const entries = [
      entry({ severity: 'info' }),
      entry({ severity: 'error', source: 'yt-dlp', origin: 'aquisicao', stage: 'aquisicao' }),
      entry({ channel: 'stdout', source: 'claude-cli', origin: 'agent', stage: 'roteiro', severity: 'debug' }),
    ];
    expect(filterEntries(entries, { ...INITIAL_FILTERS, severity: 'error' })).toHaveLength(1);
    expect(filterEntries(entries, { ...INITIAL_FILTERS, origin: 'agent' })).toHaveLength(1);
    expect(filterEntries(entries, { ...INITIAL_FILTERS, source: 'yt-dlp' })).toHaveLength(1);
    expect(filterEntries(entries, { ...INITIAL_FILTERS, stage: 'roteiro' })).toHaveLength(1);
    expect(filterEntries(entries, { ...INITIAL_FILTERS, channel: 'stream' })).toHaveLength(1);
  });

  it('separates progress lines from raw process streams', () => {
    const entries = [
      entry({ channel: 'progress' }),
      entry({ channel: 'stdout' }),
      entry({ channel: 'stderr' }),
      entry({ channel: 'result' }),
    ];
    expect(filterEntries(entries, { ...INITIAL_FILTERS, channel: 'progress' })).toHaveLength(1);
    expect(filterEntries(entries, { ...INITIAL_FILTERS, channel: 'stream' })).toHaveLength(2);
    expect(filterEntries(entries, { ...INITIAL_FILTERS, channel: 'result' })).toHaveLength(1);
  });

  it('keeps only errors in the Erros tab and lifecycle events in Eventos', () => {
    const entries = [
      entry({ severity: 'error', event: 'stage_failed' }),
      entry({ event: 'stage_started' }),
      entry({ channel: 'stdout', severity: 'debug' }),
      entry({ severity: 'warn', message: 'aviso' }),
      entry({ channel: 'command', event: 'command_started' }),
    ];
    expect(filterEntries(entries, { ...INITIAL_FILTERS, tab: 'errors' })).toHaveLength(1);
    const events = filterEntries(entries, { ...INITIAL_FILTERS, tab: 'events' });
    expect(events.map((item) => item.event)).toContain('stage_started');
    expect(events.map((item) => item.event)).toContain('command_started');
    // Raw process output stays in the Terminal tab; Eventos shows what happened, not every line printed.
    expect(events.some((item) => item.channel === 'stdout')).toBe(false);
  });

  it('filters by period using the entry timestamp', () => {
    const old = entry({ timestamp: new Date(Date.now() - 10 * 60_000).toISOString() });
    const fresh = entry();
    expect(filterEntries([old, fresh], { ...INITIAL_FILTERS, period: '5m' })).toHaveLength(1);
    expect(filterEntries([old, fresh], { ...INITIAL_FILTERS, period: '15m' })).toHaveLength(2);
  });

  it('searches the message, the source and the technical details', () => {
    const target = entry({ message: 'download falhou', details: { stderrTail: 'HTTP Error 403' } });
    expect(filterEntries([target], { ...INITIAL_FILTERS, search: 'download' })).toHaveLength(1);
    expect(filterEntries([target], { ...INITIAL_FILTERS, search: '403' })).toHaveLength(1);
    expect(filterEntries([target], { ...INITIAL_FILTERS, search: 'nada' })).toHaveLength(0);
  });
});

describe('production-console-view — etapas e progresso', () => {
  it('builds the stage timeline from lifecycle events only', () => {
    const entries = [
      entry({ stage: 'pesquisa', event: 'stage_started' }),
      entry({ stage: 'pesquisa', event: 'stage_completed', durationMs: 1200 }),
      entry({ stage: 'roteiro', event: 'stage_started' }),
      entry({ stage: 'roteiro', event: 'stage_retry' }),
      entry({ stage: 'aquisicao', event: 'stage_failed' }),
    ];
    const timeline = buildStageTimeline(entries);
    const statusByStage = Object.fromEntries(timeline.map((item) => [item.stage, item.status]));
    expect(statusByStage['pesquisa']).toBe('done');
    expect(statusByStage['roteiro']).toBe('retry');
    expect(statusByStage['aquisicao']).toBe('failed');
    expect(statusByStage['montagem']).toBe('pending');
    expect(timeline[0]?.stage).toBe('prompt');
  });

  it('reports the latest percentage the pipeline reported', () => {
    const entries = [
      entry({ pct: 12, stage: 'pesquisa' }),
      entry({ pct: 46, stage: 'roteiro' }),
      entry({ message: 'sem percentual' }),
    ];
    expect(currentProgress(entries)).toMatchObject({ pct: 46, stage: 'roteiro', label: 'Roteiro' });
    expect(currentProgress([])).toBeNull();
  });

  it('counts errors, warnings, retries, commands and stream lines', () => {
    const entries = [
      entry({ severity: 'error', event: 'stage_failed' }),
      entry({ severity: 'warn', event: 'stage_retry' }),
      entry({ channel: 'command', event: 'command_started' }),
      entry({ channel: 'stdout', severity: 'debug' }),
      entry({ channel: 'stderr', severity: 'debug' }),
    ];
    expect(summarize(entries)).toEqual({
      total: 5,
      errors: 1,
      warnings: 1,
      retries: 1,
      commands: 1,
      streams: 2,
    });
  });

  it('flags errors coming from failures and from the error level', () => {
    expect(isErrorEntry(entry({ event: 'command_failed' }))).toBe(true);
    expect(isErrorEntry(entry({ severity: 'error' }))).toBe(true);
    expect(isErrorEntry(entry({ severity: 'info' }))).toBe(false);
  });

  it('formats a line for copy/export with stage, percentage and stream channel', () => {
    const line = formatEntryLine(
      entry({ stage: 'aquisicao', pct: 47, channel: 'stderr', severity: 'warn', source: 'yt-dlp', message: 'retry', durationMs: 900 }),
    );
    expect(line).toContain('[WARN]');
    expect(line).toContain('[aquisicao 47%]');
    expect(line).toContain('<stderr>');
    expect(line).toContain('(900ms)');
  });

  it('lists technical detail rows only for data the entry really carries', () => {
    const rows = entryDetailRows(
      entry({ runId: 'run_1', exitCode: 2, durationMs: 500, details: { command: 'claude', stderrTail: 'boom' } }),
    );
    const labels = rows.map((row) => row.label);
    expect(labels).toContain('Execução');
    expect(labels).toContain('Exit code');
    expect(labels).toContain('command');
    expect(labels).toContain('stderrTail');
    expect(entryDetailRows(entry()).map((row) => row.label)).not.toContain('Exit code');
  });
});

describe('production-console-view — consoles por job', () => {
  it('accepts only lines of its own job, falling back to projectId for legacy lines', () => {
    expect(entryBelongsTo({ jobId: 'job_A', projectId: 'p' }, 'job_A')).toBe(true);
    expect(entryBelongsTo({ jobId: 'job_B', projectId: 'p' }, 'job_A')).toBe(false);
    expect(entryBelongsTo({ projectId: 'cinema_1' }, 'cinema_1')).toBe(true);
  });

  it('merges history and live batches without duplicates, in emission order', () => {
    const t = '2026-11-15T10:00:00.000Z';
    const a = entry({ id: 'a', timestamp: t, seq: 1 });
    const b = entry({ id: 'b', timestamp: t, seq: 2 });
    const c = entry({ id: 'c', timestamp: '2026-11-15T10:00:01.000Z', seq: 3 });
    const live = mergeConsoleEntries([], [c, b], 10);
    const merged = mergeConsoleEntries(live, [a, b, c], 10);
    expect(merged.map((e) => e.id)).toEqual(['a', 'b', 'c']);
    expect(mergeConsoleEntries(merged, [entry({ id: 'd', seq: 4 })], 2).map((e) => e.id)).toEqual(['c', 'd']);
  });

  it('filters the general console by job and by job status', () => {
    const lines = [entry({ jobId: 'job_A' }), entry({ jobId: 'job_B' }), entry({ jobId: 'job_A' })];
    expect(filterEntries(lines, { ...INITIAL_FILTERS, jobId: 'job_A' })).toHaveLength(2);
    const status = (id: string): 'failed' | 'running' => (id === 'job_B' ? 'failed' : 'running');
    expect(filterEntries(lines, { ...INITIAL_FILTERS, status: 'failed' }, Date.now(), status).map((e) => e.jobId)).toEqual(['job_B']);
  });

  it('keeps each job summary independent while live lines arrive', () => {
    let jobs = applyEntryToJobs([], entry({ jobId: 'job_A', pct: 40, event: 'job_started', channel: 'progress' }));
    jobs = applyEntryToJobs(jobs, entry({ jobId: 'job_B', pct: 10, event: 'job_started', channel: 'progress' }));
    jobs = applyEntryToJobs(jobs, entry({ jobId: 'job_B', severity: 'error', event: 'job_failed', channel: 'progress' }));
    jobs = applyEntryToJobs(jobs, entry({ jobId: 'job_A', origin: 'agent', channel: 'command', source: 'claude-cli', event: 'command_started' }));
    const byId = Object.fromEntries(jobs.map((job) => [job.jobId, job]));
    expect(byId.job_A).toMatchObject({ status: 'running', pct: 40, agents: ['claude-cli'], errors: 0 });
    expect(byId.job_B).toMatchObject({ status: 'failed', pct: 10, errors: 1, live: false });
  });
});

describe('production-console-view — agentes em execução longa', () => {
  const agent = (overrides: Partial<ConsoleEntry>) =>
    entry({ origin: 'agent', source: 'claude-cli', runId: 'research_1', ...overrides });

  it('shows a running agent with its latest heartbeat (state, last event, limits)', () => {
    const runs = liveAgentRuns([
      agent({ channel: 'command', event: 'command_started', message: 'Pesquisa editorial (Claude Code (claude)): claude-cli iniciado' }),
      agent({ channel: 'stdout', severity: 'debug', message: 'ferramenta WebSearch: {"q":"boss"}' }),
      agent({
        event: 'agent_heartbeat',
        details: { state: 'silent', lastEventAt: '2026-11-16T10:00:00.000Z', lastEventSummary: 'ferramenta WebSearch', idleMs: 95_000, inactivityTimeoutMs: 600_000, maxDurationMs: null },
      }),
    ]);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.label).toBe('Pesquisa editorial (Claude Code (claude))');
    expect(runs[0]?.state).toBe('silent');
    expect(runs[0]?.lastEventSummary).toBe('ferramenta WebSearch');
    expect(runs[0]?.inactivityTimeoutMs).toBe(600_000);
    expect(runs[0]?.maxDurationMs).toBeNull();
  });

  it('drops the agent once its outcome is recorded and ignores runs that never started', () => {
    const runs = liveAgentRuns([
      agent({ channel: 'command', event: 'command_started', message: 'x: claude-cli iniciado' }),
      agent({ channel: 'result', event: 'command_completed', message: 'ok' }),
      agent({ runId: 'other', event: 'agent_heartbeat', details: { state: 'active' } }),
    ]);
    expect(runs).toEqual([]);
  });

  it('formats long durations', () => {
    expect(formatDuration(38_000)).toBe('38s');
    expect(formatDuration(20 * 60_000 + 5_000)).toBe('20m05s');
    expect(formatDuration(2 * 3_600_000 + 60_000)).toBe('2h01m');
  });
});
