import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ProductionConsoleService } from '../src/main/production-console.js';
import { runInstrumentedCommand } from '../src/main/production-agent-runner.js';

const tempDirs: string[] = [];
function makeRoot(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

const node = (script: string) => ({ command: process.execPath, args: ['-e', script] });

describe('Console de Produção — isolamento por job', () => {
  it('keeps two simultaneous jobs in separate files and listings', async () => {
    const logsDir = join(makeRoot('console-iso-'), 'logs');
    const service = new ProductionConsoleService({ logsDir });

    // Two real processes writing interleaved lines with different delays, under different jobs.
    const jobA = node("let i = 0; const t = setInterval(() => { process.stdout.write('A' + (++i) + '\\n'); if (i === 4) { clearInterval(t); } }, 15);");
    const jobB = node("let i = 0; const t = setInterval(() => { process.stdout.write('B' + (++i) + '\\n'); if (i === 4) { clearInterval(t); } }, 10);");

    await Promise.all([
      runInstrumentedCommand({
        console: service,
        projectId: 'job_A',
        jobId: 'job_A',
        runId: 'run_A',
        stage: 'roteiro',
        origin: 'agent',
        source: 'claude-cli',
        label: 'Job A',
        ...jobA,
      }),
      runInstrumentedCommand({
        console: service,
        projectId: 'job_B',
        jobId: 'job_B',
        runId: 'run_B',
        stage: 'pesquisa',
        origin: 'agent',
        source: 'codex-cli',
        label: 'Job B',
        ...jobB,
      }),
    ]);

    const listA = service.list('job_A', { limit: 1000 }).entries;
    const listB = service.list('job_B', { limit: 1000 }).entries;

    // No entry of one job leaks into the other, including stream lines.
    expect(listA.every((entry) => entry.projectId === 'job_A' && entry.jobId === 'job_A')).toBe(true);
    expect(listB.every((entry) => entry.projectId === 'job_B' && entry.jobId === 'job_B')).toBe(true);
    expect(listA.filter((entry) => entry.channel === 'stdout').every((entry) => entry.message.startsWith('A'))).toBe(true);
    expect(listB.filter((entry) => entry.channel === 'stdout').every((entry) => entry.message.startsWith('B'))).toBe(true);
    expect(listA.some((entry) => entry.message.startsWith('B'))).toBe(false);
    expect(listB.some((entry) => entry.message.startsWith('A'))).toBe(false);

    // One JSONL file per job, and each file holds only its own job.
    const files = readdirSync(logsDir).filter((name) => name.endsWith('.log.jsonl')).sort();
    expect(files).toEqual(['job_A.log.jsonl', 'job_B.log.jsonl']);
    for (const [file, projectId] of [['job_A.log.jsonl', 'job_A'], ['job_B.log.jsonl', 'job_B']] as const) {
      const lines = readFileSync(join(logsDir, file), 'utf8').trim().split('\n').filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.every((line) => (JSON.parse(line) as { projectId: string }).projectId === projectId)).toBe(true);
    }
  });

  it('keeps consecutive runs of the same job apart by runId while sharing the job history', async () => {
    const logsDir = join(makeRoot('console-consecutive-'), 'logs');
    const service = new ProductionConsoleService({ logsDir });

    await runInstrumentedCommand({
      console: service,
      projectId: 'job_seq',
      jobId: 'job_seq',
      runId: 'run_1',
      stage: 'roteiro',
      origin: 'agent',
      source: 'claude-cli',
      label: 'Primeira execução',
      ...node("process.stdout.write('primeira\\n');"),
    });
    await runInstrumentedCommand({
      console: service,
      projectId: 'job_seq',
      jobId: 'job_seq',
      runId: 'run_2',
      stage: 'roteiro',
      origin: 'agent',
      source: 'claude-cli',
      label: 'Segunda execução',
      ...node("process.stdout.write('segunda\\n');"),
    });

    const entries = service.list('job_seq', { limit: 1000 }).entries;
    const first = entries.filter((entry) => entry.runId === 'run_1');
    const second = entries.filter((entry) => entry.runId === 'run_2');
    expect(first.length).toBeGreaterThan(1);
    expect(second.length).toBeGreaterThan(1);
    expect(first.some((entry) => entry.message === 'segunda')).toBe(false);
    expect(second.some((entry) => entry.message === 'primeira')).toBe(false);
    expect(entries.every((entry) => entry.jobId === 'job_seq')).toBe(true);

    // History survives a restart of the service (same file, same job).
    const reopened = new ProductionConsoleService({ logsDir });
    expect(reopened.list('job_seq', { limit: 1000 }).total).toBe(entries.length);
  });

  it('does not let a cleared job touch the other job file', () => {
    const logsDir = join(makeRoot('console-clear-'), 'logs');
    const service = new ProductionConsoleService({ logsDir });
    service.emit({ projectId: 'job_one', stage: 'system', severity: 'info', source: 'pipeline', message: 'one' });
    service.emit({ projectId: 'job_two', stage: 'system', severity: 'info', source: 'pipeline', message: 'two' });

    service.clear('job_one');
    expect(service.list('job_one').total).toBe(0);
    expect(service.list('job_two').total).toBe(1);
    expect(existsSync(join(logsDir, 'job_two.log.jsonl'))).toBe(true);
  });
});
