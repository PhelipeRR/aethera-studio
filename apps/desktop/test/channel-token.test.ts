import { describe, expect, it } from 'vitest';
import { canWriteChannel, channelAccessToken, toStoredChannelTokens, YOUTUBE_READ_SCOPE, YOUTUBE_WRITE_SCOPE } from '../src/main/oauth/channel-token.js';

const client = { client_id: 'id', client_secret: 'secret', auth_uri: 'https://accounts.example.test/auth', token_uri: 'https://accounts.example.test/token', redirect_uris: ['http://127.0.0.1:53682/callback'] };
const memoryStore = (tokens: unknown) => { let value: { client: unknown; tokens: unknown | null } | null = { client, tokens }; return { load: () => value, save: (next: { client: unknown; tokens: unknown | null }) => { value = next; }, get current() { return value; } }; };

describe('channel access token', () => {
  it('returns a fresh token without calling the token endpoint', async () => {
    const store = memoryStore(toStoredChannelTokens({ access_token: 'fresh', refresh_token: 'r', expires_in: 3600 }, [YOUTUBE_READ_SCOPE], 1_000));
    const fetcher = async () => { throw new Error('should not refresh'); };
    await expect(channelAccessToken(store, 'read', { now: 2_000, fetcher })).resolves.toBe('fresh');
  });

  it('renews an expiring token, keeps the refresh token and the granted scope', async () => {
    const store = memoryStore(toStoredChannelTokens({ access_token: 'old', refresh_token: 'r1', expires_in: 3600, scope: `${YOUTUBE_READ_SCOPE} ${YOUTUBE_WRITE_SCOPE}` }, [], 0));
    const bodies: string[] = [];
    const fetcher = async (_url: string, init?: RequestInit) => { bodies.push(String(init?.body)); return new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 }), { status: 200 }); };
    await expect(channelAccessToken(store, 'write', { now: 3_590_000, fetcher })).resolves.toBe('new');
    expect(bodies[0]).toContain('grant_type=refresh_token');
    expect(store.current?.tokens).toMatchObject({ access_token: 'new', refresh_token: 'r1', expires_at: 3_590_000 + 3_600_000 });
    expect(canWriteChannel(store.current?.tokens)).toBe(true);
  });

  it('asks to widen the permission before a write with a read-only grant', async () => {
    const store = memoryStore(toStoredChannelTokens({ access_token: 'read', expires_in: 3600 }, [YOUTUBE_READ_SCOPE], 0));
    await expect(channelAccessToken(store, 'write', { now: 1 })).rejects.toThrow(/scope_required/);
    // Connections saved before the scope was recorded only had read access.
    expect(canWriteChannel({ access_token: 'legacy' })).toBe(false);
  });

  it('reports an expired authorization when there is no refresh token', async () => {
    const store = memoryStore({ access_token: 'legacy', scope: YOUTUBE_READ_SCOPE });
    await expect(channelAccessToken(store, 'read', { now: 1 })).rejects.toThrow(/auth_expired/);
  });

  it('requires a connection', async () => {
    await expect(channelAccessToken(memoryStore(null), 'read')).rejects.toThrow(/auth_required/);
  });
});
