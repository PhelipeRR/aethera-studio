/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { PersonalSyncService } from '../src/main/personal/sync-service.js';

describe('PersonalSyncService', () => {
  it('uses persisted cursors and emits metadata-only deduplicated notifications', async () => {
    let cursor: string | null = 'h1'; const processed = new Set<string>(); const notices: unknown[] = [];
    const service = new PersonalSyncService({ accounts: () => [{ accountId: 'a1', provider: 'gmail', identifier: 'me@example.com', scopes: [], state: 'connected' }], token: () => ({ accessToken: 'token', refreshToken: 'refresh', expiresAt: 1, scopes: [] }), gmail: () => ({ history: async () => ({ historyId: 'h2', messages: [{ id: 'm1' }, { id: 'm1' }] }) } as any), calendar: () => { throw new Error('not expected'); }, sync: { cursor: () => cursor, saveCursor: (_a: string, _r: string, value: string) => { cursor = value; }, markProcessed: (_a: string, key: string) => { if (processed.has(key)) return false; processed.add(key); return true; } } as any, notifications: { push: (value: unknown) => { notices.push(value); return true; } } as any, onError: () => { throw new Error('unexpected sync error'); } });
    expect(await service.run()).toEqual({ accounts: 1, events: 1 });
    expect(cursor).toBe('h2'); expect(notices).toHaveLength(1); expect(JSON.stringify(notices[0])).not.toContain('body');
  });
});
