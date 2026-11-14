import { z } from 'zod';
import { SPOTIFY_COMMAND_ERROR_CODES, spotifyCommandSchema, spotifyDevicesResultSchema, spotifyFollowedArtistsResultSchema, spotifyPlaybackStateSchema, spotifyPlaylistsResultSchema, spotifySavedTracksResultSchema, spotifySearchInputSchema, spotifySearchResultSchema, spotifyUriSchema, type SpotifyCommand, type SpotifyCommandErrorCode, type SpotifyCommandResult, type SpotifyDevicesResult, type SpotifyFollowedArtistsResult, type SpotifyPlayback, type SpotifyPlaybackState, type SpotifyPlaylistsResult, type SpotifySavedTracksResult, type SpotifySearchInput, type SpotifySearchResult, type SpotifySearchType, type SpotifyStatus } from '@neuralbridge/shared';

const DEFAULT_RETRY_MS = 30_000;
const MAX_LABEL = 500;

export interface SpotifyApiRequest { method: 'GET' | 'PUT' | 'POST'; path: string; query?: Readonly<Record<string, string>>; body?: unknown; }
/** The part of a fetch Response this adapter reads. */
export interface SpotifyApiResponse { status: number; json(): Promise<unknown>; headers: { get(name: string): string | null }; }

/**
 * What the adapter needs from whoever holds the tokens. In the app that is the desktop SpotifyService, so OAuth,
 * refresh and secure storage stay there and no token ever crosses this seam. `request` may throw an error carrying a
 * Spotify error `code`, and `refresh` re-reads the player so the HUD and the adapter see the same state.
 */
export interface SpotifyGateway {
  status(): SpotifyStatus | Promise<SpotifyStatus>;
  request(request: SpotifyApiRequest): Promise<SpotifyApiResponse>;
  refresh(): Promise<SpotifyPlayback | null>;
  resume(): Promise<SpotifyPlayback | null>;
}

export class SpotifyAdapterError extends Error {
  constructor(readonly code: SpotifyCommandErrorCode, readonly retryAfterMs: number | null = null) { super(`spotify_${code}`); this.name = 'SpotifyAdapterError'; }
}

const searchItemSchema = z.object({ uri: z.string(), name: z.string().min(1), artists: z.array(z.object({ name: z.string() })).optional(), owner: z.object({ display_name: z.string().nullish() }).nullish() });
const searchBodySchema = z.object({ tracks: z.object({ items: z.array(z.unknown()) }).optional(), albums: z.object({ items: z.array(z.unknown()) }).optional(), artists: z.object({ items: z.array(z.unknown()) }).optional(), playlists: z.object({ items: z.array(z.unknown()) }).optional() });
const SEARCH_SECTIONS = [['tracks', 'track'], ['albums', 'album'], ['artists', 'artist'], ['playlists', 'playlist']] as const satisfies readonly (readonly [string, SpotifySearchType])[];
const KNOWN_CODES: ReadonlySet<string> = new Set(SPOTIFY_COMMAND_ERROR_CODES);

const reasonOf = (response: SpotifyApiResponse): Promise<string> => response.json().then((body) => (body as { error?: { reason?: string } } | null)?.error?.reason ?? '', () => '');

/** Typed commands over the official Web API. There is deliberately no other path: a refusal stays a refusal, never a click. */
export class SpotifyAdapter {
  private readonly now: () => number;
  /** `request` does not record rate limits in the gateway's status, so the window is also kept here. */
  private blockedUntil = 0;
  private blockedCode: 'rate_limited' | 'quota_exceeded' = 'rate_limited';

  constructor(private readonly gateway: SpotifyGateway, options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  async status(): Promise<SpotifyStatus> { return this.gateway.status(); }

  async search(input: SpotifySearchInput): Promise<SpotifySearchResult> {
    const { query, types, limit } = spotifySearchInputSchema.parse(input);
    await this.requireConnection();
    const response = await this.send({ method: 'GET', path: '/v1/search', query: { q: query, type: types.join(','), limit: String(limit) } });
    const body = searchBodySchema.safeParse(await response.json().catch(() => null));
    if (!body.success) throw new SpotifyAdapterError('invalid_response');
    const items = SEARCH_SECTIONS.flatMap(([section, type]) => (body.data[section]?.items ?? []).flatMap((raw) => {
      const item = searchItemSchema.safeParse(raw);
      // Local files and removed items come back as null or with URIs that cannot be played.
      if (!item.success || !spotifyUriSchema.safeParse(item.data.uri).success) return [];
      const subtitle = item.data.artists?.map((artist) => artist.name).join(', ') ?? item.data.owner?.display_name ?? '';
      return [{ uri: item.data.uri, type, name: item.data.name.slice(0, MAX_LABEL), subtitle: subtitle.slice(0, MAX_LABEL) }];
    }));
    return spotifySearchResultSchema.parse({ items });
  }

  async playlists(): Promise<SpotifyPlaylistsResult> {
    await this.requireConnection();
    const response = await this.send({ method: 'GET', path: '/v1/me/playlists', query: { limit: '50' } });
    const body = z.object({ items: z.array(z.object({ uri: z.string(), name: z.string(), owner: z.object({ display_name: z.string().nullish() }).nullish(), tracks: z.object({ total: z.number().int().nonnegative().optional() }).nullish() })) }).safeParse(await response.json().catch(() => null));
    if (!body.success) throw new SpotifyAdapterError('invalid_response');
    return spotifyPlaylistsResultSchema.parse({ items: body.data.items.flatMap((item) => { const uri = spotifyUriSchema.safeParse(item.uri); return uri.success && item.uri.startsWith('spotify:playlist:') ? [{ uri: item.uri, name: item.name.slice(0, MAX_LABEL), owner: (item.owner?.display_name ?? '').slice(0, MAX_LABEL), tracks: item.tracks?.total ?? 0 }] : []; }) });
  }

  async savedTracks(): Promise<SpotifySavedTracksResult> {
    await this.requireConnection();
    const response = await this.send({ method: 'GET', path: '/v1/me/tracks', query: { limit: '50' } });
    const body = z.object({ items: z.array(z.object({ track: z.object({ uri: z.string(), name: z.string().min(1), artists: z.array(z.object({ name: z.string() })).optional() }).nullish() })) }).safeParse(await response.json().catch(() => null));
    if (!body.success) throw new SpotifyAdapterError('invalid_response');
    return spotifySavedTracksResultSchema.parse({ items: body.data.items.flatMap(({ track }) => { const uri = spotifyUriSchema.safeParse(track?.uri); return track && uri.success && track.uri.startsWith('spotify:track:') ? [{ name: track.name.slice(0, MAX_LABEL), artist: (track.artists ?? []).map((item) => item.name).join(', ').slice(0, MAX_LABEL), uri: track.uri }] : []; }) });
  }

  async followedArtists(): Promise<SpotifyFollowedArtistsResult> {
    await this.requireConnection();
    const response = await this.send({ method: 'GET', path: '/v1/me/following', query: { type: 'artist', limit: '50' } });
    const body = z.object({ artists: z.object({ items: z.array(z.object({ uri: z.string(), name: z.string().min(1) })) }) }).safeParse(await response.json().catch(() => null));
    if (!body.success) throw new SpotifyAdapterError('invalid_response');
    return spotifyFollowedArtistsResultSchema.parse({ items: body.data.artists.items.flatMap((artist) => { const uri = spotifyUriSchema.safeParse(artist.uri); return uri.success && artist.uri.startsWith('spotify:artist:') ? [{ name: artist.name.slice(0, MAX_LABEL), uri: artist.uri }] : []; }) });
  }

  async devices(): Promise<SpotifyDevicesResult> {
    await this.requireConnection();
    const response = await this.send({ method: 'GET', path: '/v1/me/player/devices' });
    const body = z.object({ devices: z.array(z.object({ id: z.string().nullish(), name: z.string(), type: z.string(), is_active: z.boolean().optional() })) }).safeParse(await response.json().catch(() => null));
    if (!body.success) throw new SpotifyAdapterError('invalid_response');
    return spotifyDevicesResultSchema.parse({ items: body.data.devices.flatMap((device) => device.id ? [{ id: device.id.slice(0, 200), name: device.name.slice(0, 200), type: device.type.slice(0, 50), isActive: device.is_active === true }] : []) });
  }

  async transfer(input: { deviceId: string }): Promise<SpotifyPlaybackState> {
    const deviceId = z.string().trim().min(1).max(200).parse(input.deviceId);
    return this.command({ method: 'PUT', path: '/v1/me/player', body: { device_ids: [deviceId], play: true } });
  }

  async current(): Promise<SpotifyPlaybackState> {
    await this.requireConnection();
    try { return spotifyPlaybackStateSchema.parse({ playback: await this.gateway.refresh(), refreshed: true }); } catch { return { playback: null, refreshed: false }; }
  }

  async play(input: { uri?: string }): Promise<SpotifyPlaybackState> {
    const uri = input.uri === undefined ? undefined : spotifyUriSchema.parse(input.uri);
    if (!uri) {
      const status = await this.requireConnection();
      if (status.controlBlock === 'disabled') throw new SpotifyAdapterError('controls_disabled');
      if (status.controlBlock === 'reauthorize') throw new SpotifyAdapterError('reauthorize');
      if (status.controlBlock === 'restricted') throw new SpotifyAdapterError('restricted');
      if (!status.playback || status.playback.remembered) {
        try {
          const playback = await this.gateway.resume();
          return spotifyPlaybackStateSchema.parse({ playback, refreshed: true });
        } catch (error) {
          if (error instanceof SpotifyAdapterError) throw error;
          throw new SpotifyAdapterError('no_device');
        }
      }
      return this.command({ method: 'PUT', path: '/v1/me/player/play' });
    }
    const body = uri.startsWith('spotify:track:') ? { uris: [uri] } : { context_uri: uri };
    return this.command({ method: 'PUT', path: '/v1/me/player/play', body });
  }

  pause(): Promise<SpotifyPlaybackState> { return this.command({ method: 'PUT', path: '/v1/me/player/pause' }); }
  next(): Promise<SpotifyPlaybackState> { return this.command({ method: 'POST', path: '/v1/me/player/next' }); }
  previous(): Promise<SpotifyPlaybackState> { return this.command({ method: 'POST', path: '/v1/me/player/previous' }); }

  async setVolume(input: { volume: number }): Promise<SpotifyPlaybackState> {
    const volume = z.number().int().min(0).max(100).parse(input.volume);
    return this.command({ method: 'PUT', path: '/v1/me/player/volume', query: { volume_percent: String(volume) } });
  }

  async execute(input: SpotifyCommand): Promise<SpotifyCommandResult> {
    const command = spotifyCommandSchema.parse(input);
    switch (command.action) {
      case 'play': return this.play(command.uri ? { uri: command.uri } : {});
      case 'pause': return this.pause();
      case 'next': return this.next();
      case 'previous': return this.previous();
      case 'volume': return this.setVolume({ volume: command.volume });
      case 'search': return this.search({ query: command.query, types: command.types, limit: command.limit });
      case 'playlists': return this.playlists();
      case 'saved_tracks': return this.savedTracks();
      case 'followed_artists': return this.followedArtists();
      case 'devices': return this.devices();
      case 'transfer': return this.transfer({ deviceId: command.deviceId });
      case 'current': return this.current();
    }
  }

  private async requireConnection(): Promise<SpotifyStatus> {
    const status = await this.gateway.status();
    if (status.connection !== 'connected') throw new SpotifyAdapterError('not_connected');
    const wait = Math.max(status.retryAt ?? 0, this.blockedUntil) - this.now();
    if (wait > 0) throw new SpotifyAdapterError(status.error === 'quota_exceeded' ? 'quota_exceeded' : this.blockedCode, wait);
    return status;
  }

  private async command(request: SpotifyApiRequest): Promise<SpotifyPlaybackState> {
    const { controlBlock } = await this.requireConnection();
    if (controlBlock === 'disabled') throw new SpotifyAdapterError('controls_disabled');
    if (controlBlock === 'reauthorize') throw new SpotifyAdapterError('reauthorize');
    if (controlBlock === 'restricted') throw new SpotifyAdapterError('restricted');
    // `no_device` is not checked: it comes from a poll that may be old or paused. Spotify answers that one itself.
    await this.send(request);
    try {
      const playback = await this.gateway.refresh();
      // The gateway answers a failed read with the last playback it knew and reports the failure in its status.
      const { error } = await this.gateway.status();
      return spotifyPlaybackStateSchema.parse({ playback, refreshed: error === null });
    } catch {
      return { playback: null, refreshed: false };
    }
  }

  private async send(request: SpotifyApiRequest): Promise<SpotifyApiResponse> {
    let response: SpotifyApiResponse;
    try {
      response = await this.gateway.request(request);
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      const retryAfterMs = (error as { retryAfterMs?: unknown } | null)?.retryAfterMs;
      if (typeof code === 'string' && KNOWN_CODES.has(code)) throw this.remember(new SpotifyAdapterError(code as SpotifyCommandErrorCode, typeof retryAfterMs === 'number' ? retryAfterMs : null));
      throw new SpotifyAdapterError('network');
    }
    if (response.status >= 200 && response.status < 300) return response;
    throw this.remember(await this.normalize(response));
  }

  private remember(error: SpotifyAdapterError): SpotifyAdapterError {
    if ((error.code === 'rate_limited' || error.code === 'quota_exceeded') && error.retryAfterMs !== null) {
      this.blockedUntil = this.now() + error.retryAfterMs;
      this.blockedCode = error.code;
    }
    return error;
  }

  private async normalize(response: SpotifyApiResponse): Promise<SpotifyAdapterError> {
    const reason = await reasonOf(response);
    if (response.status === 429) {
      const seconds = Number(response.headers.get('retry-after'));
      return new SpotifyAdapterError(reason === 'QUOTA_EXCEEDED' ? 'quota_exceeded' : 'rate_limited', Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_MS);
    }
    if (response.status === 401) return new SpotifyAdapterError('revoked');
    if (response.status === 404 || reason === 'NO_ACTIVE_DEVICE') return new SpotifyAdapterError('no_device');
    if (response.status === 403) {
      if (reason === 'PREMIUM_REQUIRED') return new SpotifyAdapterError('premium_required');
      if (reason === 'VOLUME_CONTROL_DISALLOW' || reason === 'RESTRICTION_VIOLATED') return new SpotifyAdapterError('restricted');
      return new SpotifyAdapterError('forbidden');
    }
    return new SpotifyAdapterError(response.status >= 500 ? 'network' : 'unknown');
  }
}
