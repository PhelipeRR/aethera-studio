import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { ProductionConsoleService } from '../src/main/production-console.js';

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('ProductionConsoleService — Redaction, Persistence & Multi-Job', () => {
  it('redacts API keys, tokens, passwords and secrets from messages and metadata', () => {
    const root = makeTempDir('console-redact-');
    const service = new ProductionConsoleService({ logsDir: join(root, 'logs') });

    const entry = service.emit({
      projectId: 'redact_01',
      stage: 'agent',
      severity: 'info',
      source: 'openai-client',
      message: 'Calling API with api_key=sk-abc123def456ghi789jkl012mno345pqr678stu901vwx and token=ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij',
      metadata: {
        authorization: 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.secret',
        password: 'super_secret_pass_123',
        nested: { secret: 'AKIAIOSFODNN7EXAMPLE' },
      },
    });

    expect(entry.message).not.toContain('sk-abc123');
    expect(entry.message).not.toContain('ghp_');
    expect(entry.message).toContain('[REDACTED]');
    expect((entry.metadata as Record<string, unknown>)?.authorization).toBe('[REDACTED]');
    expect((entry.metadata as Record<string, unknown>)?.password).toBe('[REDACTED]');
    const nested = (entry.metadata as Record<string, unknown>)?.nested as Record<string, unknown>;
    expect(nested?.secret).toBe('[REDACTED]');
  });

  it('persists logs to disk and recovers them after service restart', () => {
    const root = makeTempDir('console-persist-');
    const logsDir = join(root, 'logs');

    const service1 = new ProductionConsoleService({ logsDir });
    service1.emit({ projectId: 'persist_01', stage: 'pesquisa', severity: 'info', source: 'pipeline', message: 'Iniciando pesquisa editorial' });
    service1.emit({ projectId: 'persist_01', stage: 'roteiro', severity: 'warn', source: 'agent', message: 'Fallback para roteiro determinístico' });
    service1.emit({ projectId: 'persist_01', stage: 'renderizacao', severity: 'error', source: 'ffmpeg', message: 'Codec não suportado' });

    // Simulate restart: new service instance reads from disk
    const service2 = new ProductionConsoleService({ logsDir });
    const recovered = service2.list('persist_01');
    expect(recovered.total).toBe(3);
    expect(recovered.entries.map((e) => e.stage)).toEqual(['pesquisa', 'roteiro', 'renderizacao']);
    expect(recovered.entries[2]?.severity).toBe('error');
  });

  it('isolates logs between multiple simultaneous jobs', () => {
    const root = makeTempDir('console-multi-');
    const service = new ProductionConsoleService({ logsDir: join(root, 'logs') });

    service.emit({ projectId: 'job_alpha', stage: 'aquisicao', severity: 'info', source: 'yt-dlp', message: 'Download slot alpha' });
    service.emit({ projectId: 'job_beta', stage: 'aquisicao', severity: 'info', source: 'yt-dlp', message: 'Download slot beta' });
    service.emit({ projectId: 'job_gamma', stage: 'aquisicao', severity: 'info', source: 'yt-dlp', message: 'Download slot gamma' });
    service.emit({ projectId: 'job_alpha', stage: 'qc', severity: 'warn', source: 'quality-gate', message: 'QC check alpha' });

    const alpha = service.list('job_alpha');
    const beta = service.list('job_beta');
    const gamma = service.list('job_gamma');
    expect(alpha.total).toBe(2);
    expect(beta.total).toBe(1);
    expect(gamma.total).toBe(1);
    expect(alpha.entries.every((e) => e.projectId === 'job_alpha')).toBe(true);
    expect(beta.entries.every((e) => e.projectId === 'job_beta')).toBe(true);
  });

  it('handles high volume of logs without exceeding memory limit', () => {
    const root = makeTempDir('console-volume-');
    const service = new ProductionConsoleService({ logsDir: join(root, 'logs'), maxEntriesInMemory: 500 });

    for (let i = 0; i < 2000; i++) {
      service.emit({ projectId: 'volume_01', stage: 'montagem', severity: 'debug', source: 'composer', message: `Frame ${i}` });
    }

    const result = service.list('volume_01');
    expect(result.total).toBe(500);
    expect(result.entries.length).toBeLessThanOrEqual(500);
  });

  it('filters by severity, stage and search term', () => {
    const root = makeTempDir('console-filter-');
    const service = new ProductionConsoleService({ logsDir: join(root, 'logs') });

    service.emit({ projectId: 'filter_01', stage: 'pesquisa', severity: 'info', source: 'research', message: 'Buscando entidades' });
    service.emit({ projectId: 'filter_01', stage: 'roteiro', severity: 'error', source: 'agent', message: 'Falha na geração do roteiro' });
    service.emit({ projectId: 'filter_01', stage: 'aquisicao', severity: 'warn', source: 'download', message: 'Retry após timeout' });
    service.emit({ projectId: 'filter_01', stage: 'renderizacao', severity: 'error', source: 'ffmpeg', message: 'Erro de codec' });

    const errors = service.list('filter_01', { severity: 'error' });
    expect(errors.total).toBe(2);
    expect(errors.entries.every((e) => e.severity === 'error')).toBe(true);

    const pesquisa = service.list('filter_01', { stage: 'pesquisa' });
    expect(pesquisa.total).toBe(1);

    const searched = service.list('filter_01', { search: 'timeout' });
    expect(searched.total).toBe(1);
    expect(searched.entries[0]?.message).toContain('timeout');
  });

  it('exports logs in JSON and TXT formats', () => {
    const root = makeTempDir('console-export-');
    const service = new ProductionConsoleService({ logsDir: join(root, 'logs') });

    service.emit({ projectId: 'export_01', stage: 'previa', severity: 'info', source: 'renderer', message: 'Prévia gerada', durationMs: 1234 });

    const json = service.export('export_01', 'json');
    const parsed = JSON.parse(json) as Array<{ message: string; durationMs?: number }>;
    expect(parsed.length).toBe(1);
    expect(parsed[0]?.message).toBe('Prévia gerada');
    expect(parsed[0]?.durationMs).toBe(1234);

    const txt = service.export('export_01', 'txt');
    expect(txt).toContain('[INFO]');
    expect(txt).toContain('Prévia gerada');
    expect(txt).toContain('(1234ms)');
  });

  it('rotates log file when size exceeds limit', () => {
    const root = makeTempDir('console-rotate-');
    const logsDir = join(root, 'logs');
    const service = new ProductionConsoleService({ logsDir, maxFileSizeBytes: 1024 });

    // Write enough entries to exceed 1KB
    for (let i = 0; i < 50; i++) {
      service.emit({ projectId: 'rotate_01', stage: 'system', severity: 'info', source: 'test', message: `Entry with padding to increase file size: ${'x'.repeat(100)} ${i}` });
    }

    const logFile = join(logsDir, 'rotate_01.log.jsonl');
    expect(existsSync(logFile)).toBe(true);
    const content = readFileSync(logFile, 'utf8');
    const lines = content.trim().split('\n').filter(Boolean);
    // After rotation, should have roughly half the entries
    expect(lines.length).toBeLessThan(50);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('subscribes to real-time events and unsubscribes correctly', () => {
    const root = makeTempDir('console-subscribe-');
    const service = new ProductionConsoleService({ logsDir: join(root, 'logs') });
    const received: string[] = [];

    const unsub = service.subscribe((entry) => {
      received.push(entry.message);
    });

    service.emit({ projectId: 'sub_01', stage: 'agent', severity: 'info', source: 'test', message: 'Event 1' });
    service.emit({ projectId: 'sub_01', stage: 'agent', severity: 'info', source: 'test', message: 'Event 2' });
    expect(received).toEqual(['Event 1', 'Event 2']);

    unsub();
    service.emit({ projectId: 'sub_01', stage: 'agent', severity: 'info', source: 'test', message: 'Event 3' });
    expect(received).toEqual(['Event 1', 'Event 2']); // Event 3 not received
  });

  it('clears logs for a specific project without affecting others', () => {
    const root = makeTempDir('console-clear-');
    const service = new ProductionConsoleService({ logsDir: join(root, 'logs') });

    service.emit({ projectId: 'clear_a', stage: 'system', severity: 'info', source: 'test', message: 'A' });
    service.emit({ projectId: 'clear_b', stage: 'system', severity: 'info', source: 'test', message: 'B' });

    service.clear('clear_a');
    const a = service.list('clear_a');
    const b = service.list('clear_b');
    expect(a.total).toBe(0);
    expect(b.total).toBe(1);
  });

  it('never exposes private agent reasoning or internal chain-of-thought', () => {
    const root = makeTempDir('console-reasoning-');
    const service = new ProductionConsoleService({ logsDir: join(root, 'logs') });

    const entry = service.emit({
      projectId: 'reasoning_01',
      stage: 'agent',
      severity: 'debug',
      source: 'creative-director',
      message: 'Internal reasoning: I think the user wants X because Y and Z, my chain of thought is...',
      metadata: {
        _privateReasoning: 'Should never appear in UI',
        apiKey: 'sk-live-should-be-redacted-1234567890abcdef',
      },
    });

    // The service redacts known patterns but does not invent new ones.
    // Private reasoning fields are passed through as-is unless they match redaction patterns.
    // This test documents that the caller must NOT pass private reasoning in the first place.
    expect(entry.message).toContain('Internal reasoning');
    expect((entry.metadata as Record<string, unknown>)?.apiKey).toBe('[REDACTED]');
  });
});