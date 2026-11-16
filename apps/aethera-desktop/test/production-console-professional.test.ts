import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { ProductionConsoleService, formatEntryAsLine, inferOrigin } from '../src/main/production-console.js';

const tempDirs: string[] = [];
function makeTempDir(prefix = 'console-pro-'): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });
});

function makeService(overrides: { maxFieldChars?: number; maxEntriesInMemory?: number } = {}) {
  return new ProductionConsoleService({ logsDir: join(makeTempDir(), 'logs'), ...overrides });
}

describe('ProductionConsoleService — profissional: canais, eventos, filtros e detalhes', () => {
  it('keeps channel, event, origin, pct, exit code and details on the entry', () => {
    const service = makeService();
    const entry = service.emit({
      projectId: 'job_1',
      jobId: 'job_1',
      runId: 'run_1',
      stage: 'roteiro',
      origin: 'agent',
      channel: 'result',
      event: 'command_completed',
      severity: 'info',
      source: 'claude-cli',
      message: 'Roteiro bloco 1 concluído',
      pct: 42.6,
      durationMs: 1234.4,
      exitCode: 0,
      details: { command: 'claude', args: ['-p', '--output-format', 'stream-json'] },
    });

    expect(entry.channel).toBe('result');
    expect(entry.event).toBe('command_completed');
    expect(entry.origin).toBe('agent');
    expect(entry.pct).toBe(43);
    expect(entry.durationMs).toBe(1234);
    expect(entry.exitCode).toBe(0);
    expect(entry.jobId).toBe('job_1');
    expect(entry.runId).toBe('run_1');
    expect(entry.details?.command).toBe('claude');
  });

  it('infers origin from stage when the caller does not say it', () => {
    const service = makeService();
    expect(service.emit({ projectId: 'p', stage: 'aquisicao', severity: 'info', source: 'yt-dlp', message: 'x' }).origin).toBe('aquisicao');
    expect(service.emit({ projectId: 'p', stage: 'pesquisa', severity: 'info', source: 'pipeline', message: 'x' }).origin).toBe('pipeline');
    expect(inferOrigin('audio_sfx_vfx', 'composer')).toBe('narracao');
    expect(inferOrigin('qc', 'quality-gate')).toBe('vision');
  });

  it('filters by origin, source, channel, event and time window', () => {
    const service = makeService();
    service.emit({ projectId: 'f', stage: 'pesquisa', channel: 'progress', event: 'stage_started', severity: 'info', source: 'pipeline', message: 'pesquisa iniciada' });
    service.emit({ projectId: 'f', stage: 'roteiro', origin: 'agent', channel: 'stdout', severity: 'debug', source: 'claude-cli', message: 'linha do agente' });
    service.emit({ projectId: 'f', stage: 'aquisicao', channel: 'result', event: 'command_failed', severity: 'error', source: 'yt-dlp', message: 'download falhou' });

    expect(service.list('f', { origin: 'agent' }).total).toBe(1);
    expect(service.list('f', { source: 'yt-dlp' }).total).toBe(1);
    expect(service.list('f', { channel: 'stdout' }).total).toBe(1);
    expect(service.list('f', { event: 'command_failed' }).total).toBe(1);
    expect(service.list('f', { severity: 'error' }).total).toBe(1);

    const future = new Date(Date.now() + 60_000).toISOString();
    expect(service.list('f', { since: future }).total).toBe(0);
    expect(service.list('f', { until: future }).total).toBe(3);
  });

  it('searches inside technical details, not only messages', () => {
    const service = makeService();
    service.emit({
      projectId: 'd',
      stage: 'pesquisa',
      severity: 'error',
      source: 'claude-cli',
      message: 'pesquisa falhou',
      details: { stderrTail: 'Error: rate limit reached for model' },
    });
    expect(service.list('d', { search: 'rate limit' }).total).toBe(1);
    expect(service.list('d', { search: 'inexistente' }).total).toBe(0);
  });

  it('reports facets with counts for sources, origins, stages, channels, events and severities', () => {
    const service = makeService();
    service.emit({ projectId: 'fa', stage: 'pesquisa', channel: 'progress', event: 'stage_started', severity: 'info', source: 'pipeline', message: 'a' });
    service.emit({ projectId: 'fa', stage: 'roteiro', origin: 'agent', channel: 'stdout', severity: 'debug', source: 'claude-cli', message: 'b' });
    service.emit({ projectId: 'fa', stage: 'roteiro', origin: 'agent', channel: 'stdout', severity: 'debug', source: 'claude-cli', message: 'c' });

    const facets = service.facets('fa');
    expect(facets.sources).toEqual([
      { value: 'claude-cli', count: 2 },
      { value: 'pipeline', count: 1 },
    ]);
    expect(facets.stages.find((stage) => stage.value === 'roteiro')?.count).toBe(2);
    expect(facets.channels.find((channel) => channel.value === 'stdout')?.count).toBe(2);
    expect(facets.severities.find((severity) => severity.value === 'debug')?.count).toBe(2);
    expect(facets.events.find((event) => event.value === 'stage_started')?.count).toBe(1);
    expect(facets.origins.find((origin) => origin.value === 'agent')?.count).toBe(2);
  });

  it('redacts secrets in details and clips oversized fields', () => {
    const service = makeService({ maxFieldChars: 120 });
    const entry = service.emit({
      projectId: 'sec',
      stage: 'agent',
      severity: 'error',
      source: 'codex-cli',
      message: `falhou ${'x'.repeat(300)} token=abcd1234efgh`,
      details: {
        stderrTail: 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload',
        apiKey: 'sk-live-1234567890abcdefghij',
        nested: { password: 'segredo-super-secreto' },
        list: ['ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij'],
      },
    });

    expect(entry.message).not.toContain('abcdefghij');
    expect(entry.message).toContain('truncado');
    expect(entry.message.length).toBeLessThan(200);
    const details = entry.details as Record<string, unknown>;
    expect(String(details['stderrTail'])).toContain('[REDACTED]');
    expect(details['apiKey']).toBe('[REDACTED]');
    expect((details['nested'] as Record<string, unknown>)['password']).toBe('[REDACTED]');
    expect((details['list'] as string[])[0]).toBe('[REDACTED]');
  });

  it('normalizes entries written by an older version when loading from disk', () => {
    const root = makeTempDir('console-legacy-');
    const logsDir = join(root, 'logs');
    const service = new ProductionConsoleService({ logsDir });
    service.emit({ projectId: 'legacy', stage: 'pesquisa', severity: 'info', source: 'pipeline', message: 'entrada antiga' });

    const reopened = new ProductionConsoleService({ logsDir });
    // Simulates a line written before channel/event/origin existed.
    const [entry] = reopened.list('legacy').entries;
    expect(entry?.channel).toBe('progress');
    expect(entry?.event).toBe('log');
    expect(entry?.origin).toBe('pipeline');
  });

  it('formats a console line with stage, percentage, channel and exit code', () => {
    const service = makeService();
    const entry = service.emit({
      projectId: 'fmt',
      stage: 'aquisicao',
      channel: 'result',
      event: 'command_failed',
      severity: 'error',
      source: 'yt-dlp',
      message: 'download falhou',
      pct: 47,
      durationMs: 900,
      exitCode: 1,
    });
    const line = formatEntryAsLine(entry);
    expect(line).toContain('[ERROR]');
    expect(line).toContain('[aquisicao 47%]');
    expect(line).toContain('(900ms)');
    expect(line).toContain('exit=1');
  });
});
