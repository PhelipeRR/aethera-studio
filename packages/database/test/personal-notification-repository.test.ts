import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { openDatabase, PersonalNotificationRepository } from '../src/index.js';

describe('PersonalNotificationRepository', () => {
  it('persists notifications, deduplicates them and marks them read', () => {
    const handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'personal-notifications-')), 'db.sqlite'), { migrationsFolder: resolve(import.meta.dirname, '../migrations') });
    const repository = new PersonalNotificationRepository(handle.db);
    const notification = { id: 'n1', priority: 'high' as const, channel: 'desktop', title: 'Nova mensagem', metadata: { accountId: 'a1' }, dedupeKey: 'gmail:a1:m1', createdAt: new Date().toISOString() };
    expect(repository.push(notification)).toBe(true);
    expect(repository.push({ ...notification, id: 'n2' })).toBe(false);
    expect(repository.list(true)).toHaveLength(1);
    expect(repository.markRead('n1')).toBe(true);
    expect(repository.markRead('n1')).toBe(false);
    expect(repository.list(true)).toHaveLength(0);
    expect(repository.list()[0]?.metadata).toEqual({ accountId: 'a1' });
    handle.close();
  });
});
