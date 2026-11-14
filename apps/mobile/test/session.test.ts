import { describe, expect, it } from 'vitest';
import { CoreSession } from '../src/session';

describe('CoreSession', () => {
  it('rotates refresh tokens only after the Core returns a new pair', async () => {
    const session = new CoreSession({ endpoint: 'https://core.ts.net', accessToken: 'old-access', refreshToken: 'old-refresh', refresh: async () => ({ tokenType: 'DPoP', accessToken: 'new-access', refreshToken: 'new-refresh', expiresInMs: 60_000, refreshExpiresAt: '2026-12-10T10:00:00.000Z', deviceId: 'device-1', grant: { scopes: ['read'], projects: { projects: 'all', includePrivate: false } } }) });
    await session.reconnect();
    expect(session.tokens()).toEqual({ accessToken: 'new-access', refreshToken: 'new-refresh' });
  });
});
