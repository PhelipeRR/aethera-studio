import { describe, expect, it } from 'vitest';
import { PersonalAccountManager } from '../src/main/personal/account-manager.js';

describe('PersonalAccountManager', () => {
  it('keeps account metadata separate from encrypted tokens', () => {
    const saved: Array<{ accountId: string; token: unknown }> = [];
    const manager = new PersonalAccountManager({
      saveToken: (accountId, token) => { saved.push({ accountId, token }); },
      clearToken: () => undefined,
    });
    manager.connect({ accountId: 'acct-1', provider: 'gmail', identifier: 'me@example.com', scopes: ['gmail.readonly'] }, { accessToken: 'secret', refreshToken: 'refresh', expiresAt: 1, scopes: ['gmail.readonly'] });
    expect(manager.list()).toEqual([{ accountId: 'acct-1', provider: 'gmail', identifier: 'me@example.com', scopes: ['gmail.readonly'], state: 'connected' }]);
    expect(saved[0]?.token).toMatchObject({ accessToken: 'secret' });
    expect(JSON.stringify(manager.list())).not.toContain('secret');
  });

  it('disconnects an account and removes its token', () => {
    let cleared = '';
    const manager = new PersonalAccountManager({ saveToken: () => undefined, clearToken: (id) => { cleared = id; } });
    manager.connect({ accountId: 'acct-1', provider: 'calendar', identifier: 'me', scopes: [], }, { accessToken: 'a', refreshToken: 'r', expiresAt: 1, scopes: [] });
    expect(manager.disconnect('acct-1')).toBe(true);
    expect(cleared).toBe('acct-1');
    expect(manager.list()).toEqual([]);
  });
});
