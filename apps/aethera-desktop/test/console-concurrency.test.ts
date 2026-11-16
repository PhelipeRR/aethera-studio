import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ProductionConsoleService,
  compareEntries,
  type ProductionLogEntry,
  type ProductionLogOrigin,
  type ProductionLogStage,
} from '../src/main/production-console.js';
import { runInstrumentedCommand } from '../src/main/production-agent-runner.js';
import {
  ProductionStageTracker,
  recordPipelineSnapshot,
  type PipelineJobSnapshot,
} from '../src/main/production-stage-tracker.js';
import {
  entryBelongsTo,
  mergeConsoleEntries,
  type ConsoleEntry,
} from '../../../packages/desktop-shared/src/renderer/src/features/video/production-console-view.js';

/**
 * Concurrency of the production console: several productions run at the same time in ONE console service (as in the
 * app's main process). Every agent/stream line is emitted with only its `projectId`, exactly like the research,
 * script, media and render call sites do; the job binding is what routes it. Processes are real Node children.
 */

const tempDirs: string[] = [];
function makeRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** A real child process writing `lines` stdout lines tagged with `marker`, then an optional stderr line and exit code. */
function agentProcess(marker: string, lines: number, intervalMs: number, exitCode = 0) {
  const script = [
    `let i = 0;`,
    `const t = setInterval(() => {`,
    `  i += 1; process.stdout.write('${marker}:out:' + i + '\\n');`,
    `  if (i === ${lines}) {`,
    `    clearInterval(t);`,
    exitCode !== 0 ? `    process.stderr.write('${marker}:err:quota exhausted\\n');` : '',
    `    process.exitCode = ${exitCode};`,
    `  }`,
    `}, ${intervalMs});`,
  ].join('\n');
  return { command: process.execPath, args: ['-e', script] };
}

/** Same origins the real call sites use: agents, media acquisition, narration and render each keep their own. */
const ORIGIN_BY_STAGE: Partial<Record<ProductionLogStage, ProductionLogOrigin>> = {
  pesquisa: 'agent',
  roteiro: 'agent',
  aquisicao: 'aquisicao',
  narration: 'narracao',
  renderizacao: 'renderizacao',
};

interface Step {
  state: string;
  pct: number;
  /** Agent run inside this stage (real process); emitted with projectId only. */
  agent?: { source: string; lines: number; intervalMs: number; exitCode?: number; stage: ProductionLogStage };
}

/** Drives one production like the staged pipeline does: snapshot per stage, real agent processes in between. */
async function runProduction(
  service: ProductionConsoleService,
  tracker: ProductionStageTracker,
  base: Omit<PipelineJobSnapshot, 'state' | 'progressPct' | 'message'>,
  marker: string,
  steps: Step[],
  opts: { cancelSignal?: { cancelled: boolean } } = {},
): Promise<void> {
  for (const step of steps) {
    if (opts.cancelSignal?.cancelled) return;
    recordPipelineSnapshot(service, tracker, { ...base, state: step.state, progressPct: step.pct, message: `${marker} ${step.state}` });
    if (step.agent) {
      await runInstrumentedCommand({
        console: service,
        projectId: base.projectId, // no jobId: routed by the job binding, as in aethera-ipc.ts
        runId: `${marker}_${step.state}_${base.attempt ?? 1}`,
        stage: step.agent.stage,
        origin: ORIGIN_BY_STAGE[step.agent.stage] ?? 'agent',
        source: step.agent.source,
        label: `${marker} ${step.state}`,
        ...agentProcess(marker, step.agent.lines, step.agent.intervalMs, step.agent.exitCode ?? 0),
      });
    } else {
      await sleep(3);
    }
  }
}

const markerOf = (entry: ProductionLogEntry): string | null => {
  const match = /^([A-Z]2?):(out|err):/.exec(entry.message);
  return match?.[1] ?? null;
};

describe('Console de Produção — produções simultâneas com consoles independentes', () => {
  it('keeps 4 simultaneous productions (sucesso, falha, retry, cancelada) isolated, ordered, persisted and reconnectable', async () => {
    const logsDir = join(makeRoot('console-conc-'), 'logs');
    const service = new ProductionConsoleService({ logsDir });
    const tracker = new ProductionStageTracker();

    // Three individual consoles (A, B, C) + general console subscribed BEFORE the run, as the renderer does:
    // each individual console keeps only lines of its own job (entryBelongsTo), the general one keeps all.
    const individual: Record<string, ConsoleEntry[]> = { job_A: [], job_B: [], job_C: [] };
    const general: ConsoleEntry[] = [];
    let reconnectQueue: ConsoleEntry[] = [];
    let reconnecting = false;
    service.subscribe((raw) => {
      const entry = raw as ConsoleEntry;
      general.push(entry);
      for (const jobId of Object.keys(individual)) if (entryBelongsTo(entry, jobId)) individual[jobId]?.push(entry);
      if (reconnecting && entryBelongsTo(entry, 'job_C')) reconnectQueue.push(entry);
    });

    const cancelD = { cancelled: false };
    const research = (source: string, exitCode = 0, lines = 4) =>
      ({ source, lines, intervalMs: 7, exitCode, stage: 'pesquisa' as const });

    const A = runProduction(service, tracker, { projectId: 'proj_A', jobId: 'job_A', attempt: 1, prompt: 'Produção A' }, 'A', [
      { state: 'prompt', pct: 5 },
      { state: 'pesquisa', pct: 18, agent: research('claude-cli') },
      { state: 'roteiro', pct: 32, agent: { source: 'codex-cli', lines: 3, intervalMs: 9, stage: 'roteiro' } },
      { state: 'aquisicao', pct: 56, agent: { source: 'yt-dlp', lines: 3, intervalMs: 5, stage: 'aquisicao' } },
      { state: 'audio_sfx_vfx', pct: 84, agent: { source: 'voice-studio', lines: 2, intervalMs: 6, stage: 'narration' } },
      { state: 'montagem', pct: 90, agent: { source: 'ffmpeg', lines: 3, intervalMs: 4, stage: 'renderizacao' } },
      { state: 'previa', pct: 96 },
      { state: 'editor', pct: 100 },
    ]);
    const B = runProduction(service, tracker, { projectId: 'proj_B', jobId: 'job_B', attempt: 1, prompt: 'Produção B' }, 'B', [
      { state: 'prompt', pct: 5 },
      { state: 'pesquisa', pct: 21, agent: research('antigravity-cli', 3, 3) },
      { state: 'error', pct: 21 },
    ]);
    const C1 = runProduction(service, tracker, { projectId: 'proj_C', jobId: 'job_C', attempt: 1, prompt: 'Produção C' }, 'C', [
      { state: 'prompt', pct: 5 },
      { state: 'pesquisa', pct: 18, agent: research('claude-cli', 0, 5) },
      { state: 'aquisicao', pct: 56, agent: { source: 'yt-dlp', lines: 2, intervalMs: 8, exitCode: 1, stage: 'aquisicao' } },
      { state: 'paused_pending_media', pct: 56 },
    ]);
    const D = runProduction(
      service,
      tracker,
      { projectId: 'proj_D', jobId: 'job_D', attempt: 1, prompt: 'Produção D' },
      'D',
      [
        { state: 'prompt', pct: 5 },
        { state: 'pesquisa', pct: 18, agent: research('claude-cli', 0, 6) },
        { state: 'roteiro', pct: 30, agent: { source: 'claude-cli', lines: 50, intervalMs: 5, stage: 'roteiro' } },
      ],
      { cancelSignal: cancelD },
    );

    // Cancel D while A, B and C are still running.
    await sleep(60);
    cancelD.cancelled = true;
    recordPipelineSnapshot(service, tracker, { projectId: 'proj_D', jobId: 'job_D', attempt: 1, state: 'cancelled', progressPct: 18, message: 'cancelada' });
    await Promise.all([A, B, C1, D]);
    // A late line of the aborted D run (an aborted CLI reporting its exit) still belongs to D.
    service.emit({ projectId: 'proj_D', stage: 'roteiro', severity: 'warn', source: 'claude-cli', channel: 'stderr', message: 'D:err:aborted by user' });

    // UI reconnection for C: the console unmounts while C is paused, reopens and loads history while C's retry runs.
    individual.job_C = [];
    reconnecting = true;
    reconnectQueue = [];
    const C2 = runProduction(service, tracker, { projectId: 'proj_C', jobId: 'job_C', attempt: 2, prompt: 'Produção C' }, 'C', [
      { state: 'aquisicao', pct: 58, agent: { source: 'yt-dlp', lines: 3, intervalMs: 6, stage: 'aquisicao' } },
      { state: 'montagem', pct: 84, agent: { source: 'ffmpeg', lines: 2, intervalMs: 5, stage: 'renderizacao' } },
      { state: 'editor', pct: 100 },
    ]);
    await sleep(15);
    const historySnapshot = service.list('job_C', { limit: 600, tail: true }).entries as ConsoleEntry[];
    await C2;
    reconnecting = false;
    const reconnected = mergeConsoleEntries(mergeConsoleEntries([], reconnectQueue, 600), historySnapshot, 600);

    // A second production of project A (same projectId, new jobId) after A finished.
    await runProduction(service, tracker, { projectId: 'proj_A', jobId: 'job_A2', attempt: 1, prompt: 'Produção A (versão 2)' }, 'A2', [
      { state: 'prompt', pct: 5 },
      { state: 'pesquisa', pct: 18, agent: research('claude-cli', 0, 2) },
    ]);

    const lists: Record<string, ProductionLogEntry[]> = Object.fromEntries(
      ['job_A', 'job_B', 'job_C', 'job_D', 'job_A2'].map((id) => [id, service.list(id, { limit: 5000 }).entries]),
    );
    const listOf = (jobId: string): ProductionLogEntry[] => lists[jobId] ?? [];

    // 1. Isolation: every entry of a job carries that job; stream lines carry only that job's marker.
    const expectedMarker: Record<string, string> = { job_A: 'A', job_B: 'B', job_C: 'C', job_D: 'D', job_A2: 'A2' };
    for (const [jobId, entries] of Object.entries(lists)) {
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.every((entry) => entry.jobId === jobId)).toBe(true);
      const markers = new Set(entries.map(markerOf).filter(Boolean));
      expect([...markers]).toEqual([expectedMarker[jobId]]);
    }
    // same project, different productions: A and A2 share proj_A but never a line
    expect(listOf('job_A').every((entry) => entry.projectId === 'proj_A')).toBe(true);
    expect(listOf('job_A2').every((entry) => entry.projectId === 'proj_A')).toBe(true);
    expect(listOf('job_A').some((entry) => markerOf(entry) === 'A2')).toBe(false);
    expect(listOf('job_D').some((entry) => entry.message === 'D:err:aborted by user')).toBe(true);

    // The live individual consoles saw exactly their own job: no leak, nothing missing.
    expect((individual.job_A ?? []).map((e) => e.id)).toEqual(listOf('job_A').map((e) => e.id));
    expect((individual.job_B ?? []).map((e) => e.id)).toEqual(listOf('job_B').map((e) => e.id));
    expect((individual.job_A ?? []).every((e) => e.jobId === 'job_A')).toBe(true);

    // 2. Independent percentages and states.
    const pcts = (jobId: string, attempt?: number) =>
      listOf(jobId).filter((e) => e.channel === 'progress' && e.pct !== undefined && (attempt === undefined || e.attempt === attempt)).map((e) => e.pct ?? 0);
    expect(pcts('job_A').at(-1)).toBe(100);
    expect(pcts('job_B').at(-1)).toBe(21);
    expect(pcts('job_C', 1).at(-1)).toBe(56);
    expect(pcts('job_C', 2).at(-1)).toBe(100);
    expect(pcts('job_D').every((pct) => pct <= 30)).toBe(true);
    for (const jobId of ['job_A', 'job_B', 'job_D']) {
      const values = pcts(jobId);
      expect([...values].sort((a, b) => a - b)).toEqual(values); // monotonic within one attempt
    }

    const jobs = Object.fromEntries(service.jobs().map((job) => [job.jobId, job]));
    expect(jobs.job_A).toMatchObject({ status: 'completed', pct: 100, live: false, kind: 'video', title: 'Produção A' });
    expect(jobs.job_B).toMatchObject({ status: 'failed', live: false });
    expect(jobs.job_B?.errors).toBeGreaterThan(0);
    expect(jobs.job_C).toMatchObject({ status: 'completed', attempt: 2, pct: 100 });
    expect(jobs.job_C?.retries).toBeGreaterThanOrEqual(1);
    expect(jobs.job_D).toMatchObject({ status: 'cancelled', live: false });
    expect(jobs.job_A2).toMatchObject({ projectId: 'proj_A', status: 'running' });
    expect(jobs.job_A?.agents).toEqual(['claude-cli', 'codex-cli']);
    expect(jobs.job_B?.agents).toEqual(['antigravity-cli']);
    // origin of each subsystem is kept per line: media acquisition, narration and render inside job A
    expect(new Set(listOf('job_A').filter((e) => e.channel === 'command').map((e) => `${e.origin}/${e.source}`))).toEqual(
      new Set(['agent/claude-cli', 'agent/codex-cli', 'aquisicao/yt-dlp', 'narracao/voice-studio', 'renderizacao/ffmpeg']),
    );
    // stage lifecycle: failure, retry and pause are where they happened
    expect(listOf('job_B').some((e) => e.event === 'command_failed' && e.exitCode === 3)).toBe(true);
    expect(listOf('job_B').some((e) => e.event === 'stage_failed' && e.stage === 'pesquisa')).toBe(true);
    expect(listOf('job_C').some((e) => e.event === 'job_paused' && e.attempt === 1)).toBe(true);
    expect(listOf('job_C').some((e) => e.event === 'job_started' && e.attempt === 2)).toBe(true);
    expect(listOf('job_C').some((e) => e.event === 'stage_retry' && e.stage === 'aquisicao' && e.attempt === 2)).toBe(true);
    for (const id of ['job_A', 'job_B', 'job_C', 'job_D']) {
      expect(listOf(id).some((e) => e.event === 'stage_retry')).toBe(id === 'job_C');
    }

    // 3. Ordering: within a job, seq strictly increases and every command brackets its own stream lines.
    for (const entries of Object.values(lists)) {
      for (let i = 1; i < entries.length; i += 1) expect(entries[i]?.seq ?? 0).toBeGreaterThan(entries[i - 1]?.seq ?? 0);
      const byRun = new Map<string, ProductionLogEntry[]>();
      for (const entry of entries) if (entry.runId) byRun.set(entry.runId, [...(byRun.get(entry.runId) ?? []), entry]);
      for (const run of byRun.values()) {
        expect(run[0]?.event).toBe('command_started');
        expect(run.at(-1)?.event).toMatch(/^command_(completed|failed)$/);
        const outs = run.filter((e) => e.channel === 'stdout').map((e) => Number(e.message.split(':').at(-1)));
        expect(outs).toEqual([...outs].sort((a, b) => a - b));
      }
    }
    // General console: one emission-ordered stream with the productions really interleaved.
    const all = service.listAll({ limit: 100_000 }).entries;
    expect(all.length).toBe(Object.values(lists).reduce((sum, entries) => sum + entries.length, 0));
    for (let i = 1; i < all.length; i += 1) {
      const [prev, cur] = [all[i - 1], all[i]];
      if (prev && cur) expect(compareEntries(prev, cur)).toBeLessThan(0);
    }
    const switches = all.filter((entry, i) => i > 0 && entry.jobId !== all[i - 1]?.jobId).length;
    expect(switches).toBeGreaterThan(8);
    expect(general.length).toBe(all.length);
    // General console filters by job and status.
    expect(service.listAll({ jobIds: ['job_B'], limit: 5000 }).entries.every((e) => e.jobId === 'job_B')).toBe(true);
    expect(new Set(service.listAll({ status: 'completed', limit: 5000 }).entries.map((e) => e.jobId))).toEqual(new Set(['job_A', 'job_C']));

    // 4. UI reconnection: history + lines that arrived while loading = full log, no duplicates, no foreign lines.
    expect(reconnected.map((e) => e.id)).toEqual(listOf('job_C').map((e) => e.id));
    expect(new Set(reconnected.map((e) => e.id)).size).toBe(reconnected.length);
    expect(reconnected.every((e) => e.jobId === 'job_C')).toBe(true);
    expect((individual.job_C ?? []).every((e) => e.jobId === 'job_C')).toBe(true);

    // 5. Persistence: a new service (app restart) reads the same consoles, statuses and titles.
    const reopened = new ProductionConsoleService({ logsDir });
    for (const [jobId, entries] of Object.entries(lists)) {
      expect(reopened.list(jobId, { limit: 5000 }).entries.map((e) => e.id)).toEqual(entries.map((e) => e.id));
    }
    const reopenedJobs = Object.fromEntries(reopened.jobs().map((job) => [job.jobId, job]));
    expect(reopenedJobs.job_A).toMatchObject({ status: 'completed', title: 'Produção A', live: false });
    expect(reopenedJobs.job_C).toMatchObject({ status: 'completed', attempt: 2 });
    expect(reopenedJobs.job_D).toMatchObject({ status: 'cancelled' });
    // new entries after a restart continue the sequence instead of colliding with persisted ones
    const next = reopened.emit({ projectId: 'proj_A', jobId: 'job_A', stage: 'editor', severity: 'info', source: 'pipeline', message: 'revisão aberta' });
    expect(next.seq ?? 0).toBeGreaterThan(Math.max(...all.map((e) => e.seq ?? 0)));

    // 6. Clearing one job never touches another (not even one of the same project).
    reopened.clear('job_B');
    reopened.clear('job_A2');
    expect(reopened.list('job_B').total).toBe(0);
    expect(reopened.list('job_A2').total).toBe(0);
    expect(reopened.list('job_A', { limit: 5000 }).total).toBe(listOf('job_A').length + 1);
    expect(reopened.list('job_C', { limit: 5000 }).total).toBe(listOf('job_C').length);
    expect(readFileSync(join(logsDir, 'job_B.log.jsonl'), 'utf8')).toBe('');
    expect(existsSync(join(logsDir, 'job_C.log.jsonl'))).toBe(true);
  }, 30_000);

  it('serves the tail of a long job console and filters by attempt', () => {
    const service = new ProductionConsoleService({ logsDir: join(makeRoot('console-tail-'), 'logs') });
    service.bindJob({ jobId: 'job_T', projectId: 'proj_T', attempt: 1, kind: 'video' });
    for (let i = 0; i < 50; i += 1) service.emit({ projectId: 'proj_T', stage: 'pesquisa', severity: 'info', source: 'claude-cli', message: `l${i}` });
    service.bindJob({ jobId: 'job_T', projectId: 'proj_T', attempt: 2, kind: 'video' });
    for (let i = 50; i < 60; i += 1) service.emit({ projectId: 'proj_T', stage: 'pesquisa', severity: 'info', source: 'claude-cli', message: `l${i}` });
    const tail = service.list('job_T', { limit: 5, tail: true });
    expect(tail.total).toBe(60);
    expect(tail.entries.map((e) => e.message)).toEqual(['l55', 'l56', 'l57', 'l58', 'l59']);
    expect(service.list('job_T', { attempt: 2, limit: 100 }).entries).toHaveLength(10);
    expect(service.list('job_T', { attempt: 2, limit: 100 }).entries.every((e) => e.attempt === 2)).toBe(true);
  });

  it('reads logs written before jobs existed (keyed by project) as their own job', () => {
    const logsDir = join(makeRoot('console-legacy-'), 'logs');
    const legacy = new ProductionConsoleService({ logsDir });
    // older entries had no jobId and were stored per project
    legacy.emit({ projectId: 'cinema_123', stage: 'pesquisa', severity: 'info', source: 'pipeline', message: 'antigo' });
    const reopened = new ProductionConsoleService({ logsDir });
    const list = reopened.list('cinema_123').entries;
    expect(list).toHaveLength(1);
    expect(list[0]?.jobId).toBe('cinema_123');
    expect(reopened.jobs().map((job) => job.jobId)).toContain('cinema_123');
  });
});
