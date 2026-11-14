import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  db: Db;
  /** Raw connection, for FTS queries and pragmas Drizzle does not model. */
  sqlite: Database.Database;
  file: string;
  close(): void;
}

/** Why the database could not be opened; each reason maps to one recovery action in the app. */
export type DatabaseFailure = 'corrupt' | 'locked' | 'disk-full' | 'migration' | 'io' | 'unknown';

/** The database cannot be used. The app keeps running in a degraded mode and reports `reason`. */
export class DatabaseUnavailableError extends Error {
  override name = 'DatabaseUnavailableError';

  constructor(
    readonly reason: DatabaseFailure,
    readonly file: string,
    options: { cause: unknown },
  ) {
    super(`Database unavailable (${reason}): ${file}`, options);
  }
}

export function classifyDatabaseFailure(error: unknown): DatabaseFailure {
  const code = String((error as { code?: unknown }).code ?? '');
  const message = String((error as { message?: unknown }).message ?? '');
  if (code === 'SQLITE_NOTADB' || code.startsWith('SQLITE_CORRUPT') || /not a database|malformed/i.test(message)) return 'corrupt';
  if (code.startsWith('SQLITE_BUSY') || code.startsWith('SQLITE_LOCKED')) return 'locked';
  if (code === 'SQLITE_FULL' || code === 'ENOSPC' || /database or disk is full|no space left/i.test(message)) return 'disk-full';
  if (/^(SQLITE_CANTOPEN|SQLITE_IOERR|SQLITE_READONLY|SQLITE_PERM|EEXIST|ENOTDIR|EACCES|EPERM|ENOSPC)/.test(code)) return 'io';
  return 'unknown';
}

/**
 * Opens (creating if needed) the NeuralBridge database and applies pending migrations.
 * Safe to call from several processes at once (app, MCP servers): WAL plus a busy timeout.
 */
export function openDatabase(file: string, options: { migrationsFolder: string }): DatabaseHandle {
  let sqlite: Database.Database | undefined;
  try {
    mkdirSync(dirname(file), { recursive: true });
    sqlite = new Database(file);
    sqlite.pragma('busy_timeout = 5000');
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('synchronous = NORMAL');
    sqlite.pragma('foreign_keys = ON');
    const db = drizzle(sqlite, { schema });
    try {
      migrate(db, { migrationsFolder: options.migrationsFolder });
    } catch (error) {
      // A migration that fails for its own reasons (bad SQL, missing journal entry) is reported as such;
      // lock, disk and corruption errors raised while migrating keep their own, more actionable reason.
      const reason = classifyDatabaseFailure(error);
      throw new DatabaseUnavailableError(reason === 'unknown' ? 'migration' : reason, file, { cause: error });
    }
    const connection = sqlite;
    return { db, sqlite: connection, file, close: () => connection.close() };
  } catch (error) {
    sqlite?.close();
    if (error instanceof DatabaseUnavailableError) throw error;
    throw new DatabaseUnavailableError(classifyDatabaseFailure(error), file, { cause: error });
  }
}
