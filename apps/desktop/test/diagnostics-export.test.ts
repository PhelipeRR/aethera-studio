import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDiagnosticsExport } from '../src/main/diagnostics-export.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../../packages/database/migrations');

describe('diagnostics export', () => {
  it('writes a redacted report with database, migration and agent checks', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'nb-diag-export-'));
    const exportDiagnostics = createDiagnosticsExport({
      dataDir,
      migrationsFolder: MIGRATIONS,
      app: { version: '0.1.58', platform: 'win32', architecture: 'x64' },
      database: () => ({ ok: false, file: join(dataDir, 'db', 'brain.db'), reason: 'migration', recovery: 'restore-backup' }),
      appliedMigrations: () => null,
      configuration: () => ({ ok: true, file: join(dataDir, 'preferences.json') }),
      agents: [
        { detect: async () => ({ id: 'claude', label: 'Claude Code', installed: false, path: null, version: null, testedVersion: '1', authenticated: null, authMethod: 'token=sk-abcdefghijklmnopqrstu' }) as never },
        { detect: async () => { throw new Error('detection crashed'); } },
      ],
      clock: { now: () => new Date('2026-11-08T12:00:00.000Z') },
    });
    const file = await exportDiagnostics();
    expect(file).toBe(join(dataDir, 'diagnostics', 'neuralbridge-diagnostics-2026-11-08T12-00-00-000Z.json'));
    const text = readFileSync(file, 'utf8');
    expect(text).not.toContain('sk-abcdefghijklmnopqrstu');
    const report = JSON.parse(text) as { metadata: { migrationState: { failed: string | null } }; details: { checks: Array<{ id: string; health: string }> } };
    expect(report.metadata.migrationState.failed).toBe('migration_failed');
    expect(report.details.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'database', health: 'error' }),
      expect.objectContaining({ id: 'migrations', health: 'error' }),
      expect.objectContaining({ id: 'agent:claude', health: 'error' }),
    ]));
  });
});
