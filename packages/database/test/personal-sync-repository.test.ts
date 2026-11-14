import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { openDatabase, PersonalSyncRepository } from '../src/index.js';
import { personalAccounts } from '../src/schema.js';

describe('PersonalSyncRepository', () => {
  it('stores cursors and deduplicates external events per account', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'personal-sync-')), 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../migrations') });
    const repository = new PersonalSyncRepository(handle.db);
    handle.db.insert(personalAccounts).values({ id: 'a1', provider: 'gmail', identifier: 'me', scopesJson: '[]', state: 'connected', tokenFile: 'tokens.bin', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }).run();
    repository.saveCursor('a1', 'gmail-history', 'h2');
    expect(repository.cursor('a1', 'gmail-history')).toBe('h2');
    expect(repository.markProcessed('a1', 'evt-1')).toBe(true);
    expect(repository.markProcessed('a1', 'evt-1')).toBe(false);
    handle.close();
  });
});
