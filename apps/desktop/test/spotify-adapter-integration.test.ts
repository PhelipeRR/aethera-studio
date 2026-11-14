import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SpotifyAdapter } from '@neuralbridge/orchestrator';
import { SpotifyService } from '../src/main/spotify/service.js';
import { SpotifyTokenStore, type SecretCipher } from '../src/main/spotify/token-store.js';

const cipher: SecretCipher = { isEncryptionAvailable: () => true, encryptString: (plain) => Buffer.from(plain), decryptString: (data) => data.toString() };
const json = (body: unknown, status = 200, headers: Record<string, string> = {}): Response => new Response(JSON.stringify(body), { status, headers });
const player = { is_playing: true, progress_ms: 1, device: { name: 'PC', volume_percent: 40 }, item: { id: 't1', name: 'Oceano', duration_ms: 10, artists: [{ name: 'Djavan' }] } };
const uri = 'spotify:track:6rqhFgbbKwnb9MLmUQDhG6';

function harness(respond: (url: URL, init?: RequestInit) => Response) {
  const store = new SpotifyTokenStore(join(mkdtempSync(join(tmpdir(), 'nb-adapter-')), 'tokens.bin'), cipher);
  store.save({ accessToken: 'secret-access', refreshToken: 'secret-refresh', expiresAt: 10_000_000, scopes: ['user-read-playback-state', 'user-modify-playback-state'] });
  const calls: { url: URL; init?: RequestInit }[] = [];
  const service = new SpotifyService({
    store, readConfig: () => ({ enabled: true, clientId: 'a'.repeat(32), controlsEnabled: true }), writeConfig: () => undefined, openExternal: () => Promise.resolve(),
    fetch: ((input: URL | string, init?: RequestInit) => { const url = new URL(input.toString()); calls.push({ url, ...(init ? { init } : {}) }); return Promise.resolve(respond(url, init)); }) as typeof fetch,
    endpoints: { accounts: 'https://accounts.test', api: 'https://api.test', imageHosts: [] }, now: () => 1_000_000,
  });
  service.init();
  return { adapter: new SpotifyAdapter(service, { now: () => 1_000_000 }), calls };
}

describe('SpotifyAdapter over the real SpotifyService', () => {
  it('plays a track through the Web API and reads the state back', async () => {
    const { adapter, calls } = harness((url) => (url.pathname.endsWith('/play') ? new Response(null, { status: 204 }) : json(player)));
    expect(await adapter.play({ uri })).toMatchObject({ refreshed: true, playback: { title: 'Oceano' } });
    expect(calls[0]?.init).toMatchObject({ method: 'PUT', body: JSON.stringify({ uris: [uri] }) });
    expect(calls.every((call) => call.url.host === 'api.test')).toBe(true);
  });

  it('sends the search query', async () => {
    const { adapter, calls } = harness(() => json({ tracks: { items: [{ uri, name: 'Oceano', artists: [{ name: 'Djavan' }] }] } }));
    expect((await adapter.search({ query: 'Djavan & Gal', types: ['track'], limit: 3 })).items).toHaveLength(1);
    expect(Object.fromEntries(calls[0]?.url.searchParams ?? [])).toEqual({ q: 'Djavan & Gal', type: 'track', limit: '3' });
  });

  it('turns a missing device into a typed error', async () => {
    const { adapter, calls } = harness(() => json({ error: { reason: 'NO_ACTIVE_DEVICE' } }, 404));
    await expect(adapter.next()).rejects.toMatchObject({ code: 'no_device' });
    expect(calls).toHaveLength(1);
  });

  it('reports premium and keeps tokens out of errors', async () => {
    const { adapter } = harness(() => json({ error: { reason: 'PREMIUM_REQUIRED' } }, 403));
    const error = await adapter.pause().catch((failure: unknown) => failure) as Error;
    expect(error).toMatchObject({ code: 'premium_required' });
    expect(JSON.stringify({ ...error, message: error.message })).not.toContain('secret-');
  });

  it('holds back after a rate limit the service did not record', async () => {
    const { adapter, calls } = harness(() => json({}, 429, { 'retry-after': '9' }));
    await expect(adapter.pause()).rejects.toMatchObject({ code: 'rate_limited', retryAfterMs: 9_000 });
    await expect(adapter.next()).rejects.toMatchObject({ code: 'rate_limited' });
    expect(calls).toHaveLength(1);
  });

  it('flags a read that failed after the command was accepted', async () => {
    const { adapter } = harness((url) => (url.pathname.endsWith('/next') ? new Response(null, { status: 204 }) : json({}, 500)));
    expect(await adapter.next()).toMatchObject({ refreshed: false });
  });
});
