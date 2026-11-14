import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { collectDiagnostics, systemClock, type Clock } from '@neuralbridge/orchestrator';
import { serializeDiagnosticReport, type AgentStatus, type ConfigurationStatus, type DatabaseStatus } from '@neuralbridge/shared';

export interface DiagnosticsExportOptions {
  dataDir: string;
  migrationsFolder: string;
  app: { version: string; platform: string; architecture: string };
  database: () => DatabaseStatus;
  /** Number of applied migrations, or null when the database is unavailable. */
  appliedMigrations: () => number | null;
  configuration: () => ConfigurationStatus;
  agents: ReadonlyArray<{ detect(options: { refresh?: boolean }): Promise<AgentStatus> }>;
  clock?: Clock;
}

/**
 * Builds the support bundle offered in degraded mode: database, migrations, disk and agent CLI checks,
 * written under `<data>/diagnostics/`. Every value passes through the diagnostic redaction first.
 */
export function createDiagnosticsExport(options: DiagnosticsExportOptions) {
  const clock = options.clock ?? systemClock;
  return async (): Promise<string> => {
    const expected = (JSON.parse(readFileSync(join(options.migrationsFolder, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> }).entries;
    const database = options.database();
    const applied = options.appliedMigrations() ?? 0;
    const latest = expected.at(-1)?.tag ?? null;
    const failed = !database.ok && database.reason === 'migration' ? 'migration_failed' : null;
    const detected = await Promise.all(options.agents.map((agent) => agent.detect({ refresh: false }).catch(() => null)));
    const snapshot = await collectDiagnostics({
      database: database.ok ? { ok: true } : { ok: false, detail: database.reason, remediation: database.recovery },
      migrations: { applied, latest, expected: expected.length, failed },
      dataPath: options.dataDir,
      agents: detected.flatMap((status) => (status ? [{ id: status.id, label: status.label, installed: status.installed, authenticated: status.authenticated }] : [])),
    });
    const dir = join(options.dataDir, 'diagnostics');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `neuralbridge-diagnostics-${clock.now().toISOString().replace(/[:.]/g, '-')}.json`);
    writeFileSync(file, serializeDiagnosticReport(
      { appVersion: options.app.version, commit: null, platform: options.app.platform, architecture: options.app.architecture, migrationState: { applied, latest, failed }, extensions: [] },
      { database, configuration: options.configuration(), checks: snapshot.checks, telemetry: snapshot.telemetry },
    ));
    return file;
  };
}
