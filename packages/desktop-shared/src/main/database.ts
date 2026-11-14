import { join } from 'node:path';
import { DatabaseUnavailableError, openDatabase, type DatabaseFailure, type DatabaseHandle } from '@neuralbridge/database';
import type { DatabaseStatus } from '@neuralbridge/shared';

export interface DatabaseState {
  handle: DatabaseHandle | null;
  status: DatabaseStatus;
}

export function databaseFile(dataDir: string): string {
  return join(dataDir, 'db', 'brain.db');
}

/**
 * Opens the database without ever crashing startup: on failure the app runs in a degraded mode
 * and the renderer shows the reason (see AppShell).
 */
export function initDatabase(dataDir: string, migrationsFolder: string, log: (message: string) => void = console.error): DatabaseState {
  const file = databaseFile(dataDir);
  try {
    return { handle: openDatabase(file, { migrationsFolder }), status: { ok: true, file } };
  } catch (error) {
    const reason = error instanceof DatabaseUnavailableError ? error.reason : 'unknown';
    const cause = error instanceof Error && error.cause instanceof Error ? error.cause.message : String(error);
    log(`[database] unavailable (${reason}): ${cause}`);
    return { handle: null, status: { ok: false, file, reason, recovery: RECOVERY[reason] } };
  }
}

/** One recovery action per failure; the renderer offers it as the banner's primary action. */
const RECOVERY: Record<DatabaseFailure, Extract<DatabaseStatus, { ok: false }>['recovery']> = {
  corrupt: 'restore-backup',
  locked: 'retry',
  'disk-full': 'free-disk-space',
  // The previous data is intact (migrations run in a transaction); a backup is the way back if retrying fails.
  migration: 'restore-backup',
  io: 'check-permissions',
  unknown: 'export-diagnostics',
};
