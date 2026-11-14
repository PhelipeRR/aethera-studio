import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { databaseFile, initDatabase } from '../src/main/database.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../../packages/database/migrations');

describe('initDatabase', () => {
  it('opens the database under <data dir>/db/brain.db', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'nb-app-'));
    const state = initDatabase(dataDir, MIGRATIONS);
    expect(state.status).toEqual({ ok: true, file: join(dataDir, 'db', 'brain.db') });
    state.handle?.close();
  });

  it('degrades instead of throwing when the file is corrupted, and logs why', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'nb-app-'));
    mkdirSync(join(dataDir, 'db'));
    writeFileSync(databaseFile(dataDir), 'garbage that is definitely not an sqlite header at all, padded');
    const logged: string[] = [];
    const state = initDatabase(dataDir, MIGRATIONS, (message) => logged.push(message));
    expect(state).toEqual({ handle: null, status: { ok: false, file: databaseFile(dataDir), reason: 'corrupt', recovery: 'restore-backup' } });
    expect(logged).toEqual([expect.stringMatching(/unavailable \(corrupt\)/)]);
  });
});
