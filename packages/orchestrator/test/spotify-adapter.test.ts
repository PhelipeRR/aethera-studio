import { beforeEach, describe, expect, it } from 'vitest';
import { SpotifyAdapter, SpotifyAdapterError } from '../src/integrations/spotify-adapter.js';
import { connected, FakeSpotifyGateway, playback, response } from './fake-spotify.js';

const trackUri = 'spotify:track:6rqhFgbbKwnb9MLmUQDhG6';
const albumUri = 'spotify:album:6rqhFgbbKwnb9MLmUQDhG6';
let gateway: FakeSpotifyGateway;
let adapter: SpotifyAdapter;

beforeEach(() => {
  gateway = new FakeSpotifyGateway();
  adapter = new SpotifyAdapter(gateway, { now: () => 1_000 });
});

const failure = (promise: Promise<unknown>): Promise<SpotifyAdapterError> => promise.then(() => { throw new Error('expected a failure'); }, (error: unknown) => { expect(error).toBeInstanceOf(SpotifyAdapterError); return error as SpotifyAdapterError; });

describe('SpotifyAdapter auth', () => {
  it('passes status through', async () => {
    expect(await adapter.status()).toEqual(connected);
  });

  it.each(['disabled', 'unconfigured', 'disconnected', 'connecting'] as const)('refuses every command while %s, with no request sent', async (connection) => {
    gateway.statusValue = { ...connected, connection, playback: null };
    expect((await failure(adapter.pause())).code).toBe('not_connected');
    expect((await failure(adapter.search({ query: 'x', types: ['track'], limit: 1 }))).code).toBe('not_connected');
    expect(gateway.requests).toEqual([]);
  });

  it.each([['disabled', 'controls_disabled'], ['reauthorize', 'reauthorize'], ['restricted', 'restricted']] as const)('maps control block %s', async (controlBlock, code) => {
    gateway.statusValue = { ...connected, controlBlock };
    expect((await failure(adapter.next())).code).toBe(code);
    expect(gateway.requests).toEqual([]);
  });

  it('uses the resume seam when a stale poll reports no device', async () => {
    gateway.statusValue = { ...connected, controlBlock: 'no_device', playback: null };
    await expect(adapter.play({})).resolves.toMatchObject({ playback, refreshed: true });
    expect(gateway.requests).toHaveLength(0);
  });

  it('honours a rate-limit window before sending', async () => {
    gateway.statusValue = { ...connected, retryAt: 4_000 };
    const error = await failure(adapter.pause());
    expect(error).toMatchObject({ code: 'rate_limited', retryAfterMs: 3_000 });
    expect(gateway.requests).toEqual([]);
  });
});

describe('SpotifyAdapter commands', () => {
  it('maps play with no target to resume', async () => {
    expect(await adapter.play({})).toEqual({ playback, refreshed: true });
    expect(gateway.requests).toEqual([{ method: 'PUT', path: '/v1/me/player/play' }]);
  });

  it('selects a visible device when play has no active playback', async () => {
    gateway.statusValue = { ...connected, playback: { ...playback, remembered: true, isPlaying: false } };
    gateway.resumed = { ...playback, isPlaying: true, remembered: false };

    await expect(adapter.play({})).resolves.toMatchObject({ playback: { isPlaying: true }, refreshed: true });
    expect(gateway.requests).toEqual([]);
  });

  it('plays a track by uris and a collection by context', async () => {
    await adapter.play({ uri: trackUri });
    await adapter.play({ uri: albumUri });
    expect(gateway.requests.map((item) => item.body)).toEqual([{ uris: [trackUri] }, { context_uri: albumUri }]);
  });

  it('refuses identifiers that are not Spotify URIs', async () => {
    await expect(adapter.play({ uri: 'https://evil.example' })).rejects.toThrow();
    expect(gateway.requests).toEqual([]);
  });

  it('maps pause, next, previous and volume', async () => {
    await adapter.pause();
    await adapter.next();
    await adapter.previous();
    await adapter.setVolume({ volume: 35 });
    expect(gateway.requests).toEqual([
      { method: 'PUT', path: '/v1/me/player/pause' },
      { method: 'POST', path: '/v1/me/player/next' },
      { method: 'POST', path: '/v1/me/player/previous' },
      { method: 'PUT', path: '/v1/me/player/volume', query: { volume_percent: '35' } },
    ]);
  });

  it('transfers playback to a typed Spotify device', async () => {
    await adapter.transfer({ deviceId: 'device-1' });
    expect(gateway.requests).toEqual([{ method: 'PUT', path: '/v1/me/player', body: { device_ids: ['device-1'], play: true } }]);
  });

  it('bounds the volume', async () => {
    await expect(adapter.setVolume({ volume: 101 })).rejects.toThrow();
    expect(gateway.requests).toEqual([]);
  });

  it('does not report a failure when only the read after an accepted command failed', async () => {
    gateway.refreshed = new Error('offline');
    expect(await adapter.next()).toEqual({ playback: null, refreshed: false });
    expect(gateway.requests).toHaveLength(1);
  });

  it('marks the state stale when the gateway swallowed a failed read', async () => {
    gateway.statusAfterRefresh = { ...connected, error: 'network' };
    expect(await adapter.next()).toEqual({ playback, refreshed: false });
  });

  it('runs a typed command', async () => {
    await adapter.execute({ action: 'volume', volume: 10 });
    expect(gateway.requests[0]?.path).toBe('/v1/me/player/volume');
    gateway.next = response(200, { tracks: { items: [] } });
    expect(await adapter.execute({ action: 'search', query: 'x', types: ['track'], limit: 1 })).toEqual({ items: [] });
  });

  it('reads saved tracks, followed artists and available devices through typed endpoints', async () => {
    gateway.next = response(200, { items: [{ track: { uri: trackUri, name: 'Oceano', artists: [{ name: 'Djavan' }] } }] });
    await expect(adapter.savedTracks()).resolves.toEqual({ items: [{ uri: trackUri, name: 'Oceano', artist: 'Djavan' }] });
    gateway.next = response(200, { artists: { items: [{ uri: 'spotify:artist:6rqhFgbbKwnb9MLmUQDhG6', name: 'Djavan' }] } });
    await expect(adapter.followedArtists()).resolves.toEqual({ items: [{ uri: 'spotify:artist:6rqhFgbbKwnb9MLmUQDhG6', name: 'Djavan' }] });
    gateway.next = response(200, { devices: [{ id: 'device-1', name: 'Desktop', type: 'Computer', is_active: true }] });
    await expect(adapter.devices()).resolves.toEqual({ items: [{ id: 'device-1', name: 'Desktop', type: 'Computer', isActive: true }] });
    expect(gateway.requests.map((request) => request.path)).toEqual(['/v1/me/tracks', '/v1/me/following', '/v1/me/player/devices']);
  });

  it('reads the current track without routing through the agent', async () => {
    await expect(adapter.current()).resolves.toEqual({ playback, refreshed: true });
    expect(gateway.requests).toEqual([]);
  });
});

describe('SpotifyAdapter search', () => {
  it('sends a bounded query and flattens the results', async () => {
    gateway.next = response(200, {
      tracks: { items: [{ uri: trackUri, name: 'Oceano', artists: [{ name: 'Djavan' }, { name: 'Gal' }] }, { uri: 'spotify:local:bad', name: 'Local' }] },
      playlists: { items: [null, { uri: 'spotify:playlist:6rqhFgbbKwnb9MLmUQDhG6', name: 'MPB', owner: { display_name: 'Ana' } }] },
    });
    const result = await adapter.search({ query: ' Djavan ', types: ['track', 'playlist'], limit: 5 });
    expect(gateway.requests).toEqual([{ method: 'GET', path: '/v1/search', query: { q: 'Djavan', type: 'track,playlist', limit: '5' } }]);
    expect(result.items).toEqual([
      { uri: trackUri, type: 'track', name: 'Oceano', subtitle: 'Djavan, Gal' },
      { uri: 'spotify:playlist:6rqhFgbbKwnb9MLmUQDhG6', type: 'playlist', name: 'MPB', subtitle: 'Ana' },
    ]);
  });

  it('enforces the API limit', async () => {
    await expect(adapter.search({ query: 'x', types: ['track'], limit: 11 })).rejects.toThrow();
    await expect(adapter.search({ query: ' ', types: ['track'], limit: 1 })).rejects.toThrow();
    expect(gateway.requests).toEqual([]);
  });

  it('flags an unreadable body', async () => {
    gateway.next = response(200, 'not an object');
    expect((await failure(adapter.search({ query: 'x', types: ['track'], limit: 1 }))).code).toBe('invalid_response');
  });
});

describe('SpotifyAdapter errors', () => {
  it.each([
    [404, { error: { reason: 'NO_ACTIVE_DEVICE' } }, 'no_device'],
    [404, {}, 'no_device'],
    [403, { error: { reason: 'NO_ACTIVE_DEVICE' } }, 'no_device'],
    [403, { error: { reason: 'PREMIUM_REQUIRED' } }, 'premium_required'],
    [403, { error: { reason: 'VOLUME_CONTROL_DISALLOW' } }, 'restricted'],
    [403, {}, 'forbidden'],
    [401, {}, 'revoked'],
    [500, {}, 'network'],
    [400, {}, 'unknown'],
  ])('normalizes HTTP %i %j to %s', async (status, body, code) => {
    gateway.next = response(status, body);
    expect((await failure(adapter.pause())).code).toBe(code);
  });

  it('keeps the retry window of a rate limit and tells quota apart', async () => {
    gateway.next = response(429, {}, { 'retry-after': '7' });
    expect(await failure(adapter.pause())).toMatchObject({ code: 'rate_limited', retryAfterMs: 7_000 });
    const fresh = new SpotifyAdapter(gateway, { now: () => 1_000 });
    gateway.next = response(429, { error: { reason: 'QUOTA_EXCEEDED' } });
    expect((await failure(fresh.pause())).code).toBe('quota_exceeded');
  });

  it('stays quiet for the whole rate-limit window, even when the gateway does not record it', async () => {
    let now = 1_000;
    const limited = new SpotifyAdapter(gateway, { now: () => now });
    gateway.next = Object.assign(new Error('x'), { code: 'rate_limited', retryAfterMs: 5_000 });
    await failure(limited.pause());
    expect(await failure(limited.next())).toMatchObject({ code: 'rate_limited', retryAfterMs: 5_000 });
    expect(gateway.requests).toHaveLength(1);
    now = 6_001;
    gateway.next = response(204);
    await limited.next();
    expect(gateway.requests).toHaveLength(2);
  });

  it('keeps a typed code thrown by the gateway and hides anything else', async () => {
    gateway.next = Object.assign(new Error('x'), { code: 'revoked' });
    expect((await failure(adapter.pause())).code).toBe('revoked');
    gateway.next = new Error('Bearer secret-token');
    const error = await failure(adapter.pause());
    expect(error.code).toBe('network');
    expect(error.message).not.toContain('secret-token');
  });

  it('does not fall back to anything else when no device is active', async () => {
    gateway.next = response(404);
    await failure(adapter.next());
    expect(gateway.requests).toHaveLength(1);
  });
});
