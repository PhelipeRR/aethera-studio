import { describe, expect, it } from 'vitest';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectDiagnostics } from '../src/diagnostics-service.js';

describe('operational diagnostics', () => {
  it('returns actionable local checks without credential values or telemetry', async () => {
    const dataPath = await mkdtemp(join(tmpdir(), 'nb-diagnostics-'));
    const report = await collectDiagnostics({ database: { ok: true }, migrations: { applied: 3, latest: '0003', expected: 3 }, dataPath, credentials: { tfs: false }, cliCommands: { missing: 'command-that-does-not-exist' } });
    expect(report.telemetry).toBe('disabled');
    expect(report.checks.find((check) => check.id === 'credential:tfs')).toMatchObject({ health: 'warning', remediation: expect.stringContaining('não é incluído') });
    expect(JSON.stringify(report)).not.toMatch(/password|token|secret-value/i);
  });
  it('reports migration failure and low space as actionable states', async () => {
    const dataPath = await mkdtemp(join(tmpdir(), 'nb-diagnostics-'));
    const report = await collectDiagnostics({ database: { ok: false, detail: 'locked', remediation: 'retry' }, migrations: { applied: 2, latest: '0002', expected: 3, failed: 'migration_failed' }, dataPath, diskMinimumBytes: Number.MAX_SAFE_INTEGER });
    expect(report.checks).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'database', health: 'error' }), expect.objectContaining({ id: 'migrations', health: 'error' }), expect.objectContaining({ id: 'disk', health: 'warning' })]));
  });
  it('reports a missing or signed-out agent CLI as an actionable check', async () => {
    const dataPath = await mkdtemp(join(tmpdir(), 'nb-diag-agents-'));
    const report = await collectDiagnostics({ database: { ok: true }, migrations: { applied: 1, latest: '0001', expected: 1 }, dataPath, agents: [{ id: 'claude', label: 'Claude Code', installed: false, authenticated: null }, { id: 'codex', label: 'Codex', installed: true, authenticated: false }] });
    expect(report.checks.find((check) => check.id === 'agent:claude')).toMatchObject({ health: 'error', remediation: expect.stringContaining('Instale') });
    expect(report.checks.find((check) => check.id === 'agent:codex')).toMatchObject({ health: 'warning', remediation: expect.stringContaining('login') });
  });
});
