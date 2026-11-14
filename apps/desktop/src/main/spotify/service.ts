import { EventEmitter } from 'node:events';
import { z } from 'zod';
import { SPOTIFY_CONTROL_SCOPE, SPOTIFY_HISTORY_SCOPE, SPOTIFY_READ_SCOPES, SPOTIFY_REDIRECT_PORT, SPOTIFY_REDIRECT_URI, spotifyStatusSchema, type SpotifyConfigure, type SpotifyControl, type SpotifyControlBlock, type SpotifyErrorCode, type SpotifyPlayback, type SpotifyStatus } from '@neuralbridge/shared/spotify';
import type { SpotifyDevice } from '@neuralbridge/shared/spotify';
import { authorizeUrl, createPkceSession, SpotifyAuthError, waitForCallback, type CallbackWait } from './oauth.js';
import type { SpotifyTokens, SpotifyTokenStore } from './token-store.js';

const PLAYING_POLL_MS = 5_000;
const IDLE_POLL_MS = 15_000;
const REFRESH_MARGIN_MS = 30_000;
const REQUEST_TIMEOUT_MS = 10_000;
const AUTH_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_RETRY_MS = 30_000;
const MAX_COVER_BYTES = 512 * 1024;
/** How long the desktop app gets to come online after being opened. */
const DEVICE_WAIT_TRIES = 12;
const DEVICE_WAIT_MS = 1_000;

export interface SpotifyEndpoints { accounts: string; api: string; imageHosts: readonly string[]; }
export const SPOTIFY_ENDPOINTS: SpotifyEndpoints = { accounts: 'https://accounts.spotify.com', api: 'https://api.spotify.com', imageHosts: ['i.scdn.co'] };

/** What is kept of the last track, so it can still be shown and resumed after a restart. No listening history is stored. */
export interface SpotifyLast { trackId: string | null; title: string; artists: string; durationMs: number; device: string | null; deviceId: string | null; coverUrl: string | null; trackUrl: string | null; }
export interface SpotifyConfig { enabled: boolean; clientId: string | null; controlsEnabled: boolean; last?: SpotifyLast | null; }
export interface SpotifyDeps {
  store: SpotifyTokenStore;
  readConfig(): SpotifyConfig;
  writeConfig(config: SpotifyConfig): void;
  openExternal(url: string): Promise<void>;
  fetch: typeof fetch;
  endpoints: SpotifyEndpoints;
  redirectPort?: number;
  now?: () => number;
}

class SpotifyRequestError extends Error {
  constructor(readonly code: SpotifyErrorCode, readonly retryAfterMs: number | null = null) { super(code); this.name = 'SpotifyRequestError'; }
}

const tokenResponseSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional(), expires_in: z.number().positive(), scope: z.string().optional() });
// Every field past the essentials is optional: this is another company's API, and Development Mode responses have lost fields before.
const playerSchema = z.object({
  is_playing: z.boolean().optional(),
  progress_ms: z.number().nullish(),
  device: z.object({ id: z.string().nullish(), name: z.string().nullish(), volume_percent: z.number().nullish(), supports_volume: z.boolean().optional(), is_restricted: z.boolean().optional() }).nullish(),
  actions: z.object({ disallows: z.object({ pausing: z.boolean().optional(), resuming: z.boolean().optional(), skipping_next: z.boolean().optional(), skipping_prev: z.boolean().optional() }).optional() }).nullish(),
  item: z.object({
    id: z.string().nullish(), name: z.string().min(1), duration_ms: z.number().nullish(),
    artists: z.array(z.object({ name: z.string() })).optional(),
    album: z.object({ images: z.array(z.object({ url: z.string(), width: z.number().nullish() })).optional() }).optional(),
    external_urls: z.object({ spotify: z.string().optional() }).optional(),
  }).nullish(),
});

const historySchema = z.object({ items: z.array(z.object({ track: z.object({
  id: z.string().nullish(), name: z.string().min(1), duration_ms: z.number().nullish(),
  artists: z.array(z.object({ name: z.string() })).optional(),
  album: z.object({ images: z.array(z.object({ url: z.string(), width: z.number().nullish() })).optional() }).optional(),
  external_urls: z.object({ spotify: z.string().optional() }).optional(),
}) })) });
const devicesSchema = z.object({ devices: z.array(z.object({ id: z.string().nullish(), name: z.string(), type: z.string(), is_active: z.boolean().optional() })) });

const clip = (text: string, limit: number): string => text.slice(0, limit);

/**
 * The whole Spotify integration, kept on its own: it knows nothing about agents, and nothing about agents depends on it.
 * Tokens never leave this class. It only polls while connected and while something is on screen to show the result.
 */
export class SpotifyService extends EventEmitter<{ changed: [SpotifyStatus] }> {
  private tokens: SpotifyTokens | null = null;
  private connecting: CallbackWait | null = null;
  private connectingFlag = false;
  private playback: SpotifyPlayback | null = null;
  private trackUrl: string | null = null;
  private restricted = false;
  private readonly tempos = new Map<string, number | null>();
  /** Spotify closed audio features to newer apps; once refused, it is not asked again this run. */
  private tempoRefused = false;
  private error: SpotifyErrorCode | null = null;
  private retryAt: number | null = null;
  private active = false;
  private timer: NodeJS.Timeout | null = null;
  private refreshing: Promise<string> | null = null;
  private coverUrl: string | null = null;
  private cover: string | null = null;
  private disposed = false;
  private extensionEnabled = true;
  private readonly now: () => number;

  constructor(private readonly deps: SpotifyDeps) {
    super();
    this.now = deps.now ?? Date.now;
  }

  /** Separate from the constructor because secure storage is only usable once the app is ready. */
  init(): void { this.tokens = this.deps.store.load(); }

  status(): SpotifyStatus {
    const config = this.deps.readConfig();
    const connection = !this.extensionEnabled || !config.enabled ? 'disabled' : !config.clientId ? 'unconfigured' : this.connectingFlag ? 'connecting' : this.tokens ? 'connected' : 'disconnected';
    return spotifyStatusSchema.parse({ connection, clientId: config.clientId, controlsEnabled: config.controlsEnabled, controlBlock: this.controlBlock(config), persistent: this.deps.store.persistent, playback: connection === 'connected' ? this.playback : null, error: this.error, retryAt: this.retryAt });
  }

  private controlBlock(config: SpotifyConfig): SpotifyControlBlock | null {
    if (!config.controlsEnabled) return 'disabled';
    if (!this.tokens?.scopes.includes(SPOTIFY_CONTROL_SCOPE)) return 'reauthorize';
    if (!this.playback) return 'no_device';
    return this.restricted ? 'restricted' : null;
  }

  private emitChange(): void { this.emit('changed', this.status()); }

  /** Called with whether the HUD is on screen: with nothing to show, no request is worth its quota. */
  setActive(active: boolean): void {
    if (this.active === active) return;
    this.active = active;
    if (active) this.schedule(0); else this.stopPolling();
  }

  /** Independent extension gate; disabling it preserves config and tokens for a later re-enable. */
  setExtensionEnabled(enabled: boolean): void {
    if (this.extensionEnabled === enabled) return;
    this.extensionEnabled = enabled;
    if (!enabled) {
      this.cancelConnect();
      this.stopPolling();
    } else if (this.active) {
      this.schedule(0);
    }
    this.emitChange();
  }

  private stopPolling(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(delayMs: number): void {
    this.stopPolling();
    const config = this.deps.readConfig();
    if (this.disposed || !this.extensionEnabled || !this.active || !this.tokens || !config.enabled || !config.clientId) return;
    const wait = Math.max(delayMs, (this.retryAt ?? 0) - this.now());
    this.timer = setTimeout(() => { void this.tick(); }, wait);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    await this.poll();
    if (!this.playback) { this.schedule(IDLE_POLL_MS); return; }
    if (!this.playback.isPlaying) { this.schedule(IDLE_POLL_MS); return; }
    // Asks again right when the track ends, so the next one shows up on time without polling faster.
    const remaining = this.playback.durationMs - this.playback.progressMs + 500;
    this.schedule(Math.max(1_000, Math.min(PLAYING_POLL_MS, remaining)));
  }

  private async poll(): Promise<void> {
    try {
      const response = await this.requestInternal('GET', '/v1/me/player');
      const next = response.status === 204 ? null : await this.toPlayback(await response.json());
      this.playback = next ?? await this.remembered();
      this.error = null;
      this.retryAt = null;
    } catch (error) {
      this.fail(error);
    }
    this.emitChange();
  }

  private fail(error: unknown): void {
    const request = error instanceof SpotifyRequestError ? error : null;
    this.error = error instanceof SpotifyAuthError ? error.code : request?.code ?? 'unknown';
    if (request?.retryAfterMs !== null && request?.retryAfterMs !== undefined) this.retryAt = this.now() + request.retryAfterMs;
    if (this.error === 'revoked') this.forget();
  }

  private forget(): void {
    this.tokens = null;
    this.playback = null;
    this.trackUrl = null;
    this.restricted = false;
    this.deps.store.clear();
    this.stopPolling();
  }

  private async toPlayback(body: unknown): Promise<SpotifyPlayback | null> {
    const parsed = playerSchema.safeParse(body);
    if (!parsed.success || !parsed.data.item) { this.trackUrl = null; this.restricted = false; return null; }
    const { item, device, actions } = parsed.data;
    const disallows = actions?.disallows;
    const link = item.external_urls?.spotify;
    this.trackUrl = link?.startsWith('https://open.spotify.com/') ? link : null;
    this.restricted = device?.is_restricted === true;
    const images = item.album?.images ?? [];
    // Spotify lists covers largest first and the HUD draws them small.
    const image = images.find((candidate) => (candidate.width ?? 0) <= 320) ?? images.at(-1);
    const config = this.deps.readConfig();
    const last: SpotifyLast = { trackId: item.id ?? null, title: clip(item.name, 500), artists: clip((item.artists ?? []).map((artist) => artist.name).join(', '), 500), durationMs: Math.max(0, Math.round(item.duration_ms ?? 0)), device: device?.name ? clip(device.name, 200) : null, deviceId: device?.id ?? null, coverUrl: image?.url ?? null, trackUrl: this.trackUrl };
    if (JSON.stringify(config.last ?? null) !== JSON.stringify(last)) this.deps.writeConfig({ ...config, last });
    return {
      trackId: item.id ? clip(item.id, 200) : null,
      title: clip(item.name, 500),
      artists: clip((item.artists ?? []).map((artist) => artist.name).join(', '), 500),
      cover: image ? await this.loadCover(image.url) : null,
      isPlaying: parsed.data.is_playing === true,
      progressMs: Math.max(0, Math.round(parsed.data.progress_ms ?? 0)),
      durationMs: Math.max(0, Math.round(item.duration_ms ?? 0)),
      sampledAt: this.now(),
      tempoBpm: await this.tempo(item.id ?? null),
      device: device?.name ? clip(device.name, 200) : null,
      volume: device?.supports_volume === false || typeof device?.volume_percent !== 'number' ? null : Math.round(device.volume_percent),
      canPause: disallows?.pausing !== true,
      canResume: disallows?.resuming !== true,
      canNext: disallows?.skipping_next !== true,
      canPrevious: disallows?.skipping_prev !== true,
      remembered: false,
      hasLink: this.trackUrl !== null,
    };
  }

  /** Remote images are blocked by the renderer's CSP, so the main process fetches them, from known hosts, as bounded data URLs. */
  private async tempo(trackId: string | null): Promise<number | null> {
    if (!trackId || this.tempoRefused) return null;
    if (this.tempos.has(trackId)) return this.tempos.get(trackId) ?? null;
    let tempo: number | null = null;
    try {
      const response = await this.requestInternal('GET', `/v1/audio-features/${encodeURIComponent(trackId)}`);
      const value = ((await response.json()) as { tempo?: unknown }).tempo;
      tempo = typeof value === 'number' && value > 0 && value <= 400 ? Math.round(value * 10) / 10 : null;
    } catch (error) {
      if (error instanceof SpotifyRequestError && error.code === 'forbidden') this.tempoRefused = true;
    }
    if (this.tempos.size >= 200) this.tempos.clear();
    this.tempos.set(trackId, tempo);
    return tempo;
  }

  private async loadCover(url: string): Promise<string | null> {
    if (url === this.coverUrl) return this.cover;
    this.coverUrl = url;
    this.cover = null;
    try {
      const parsed = new URL(url);
      if (!this.deps.endpoints.imageHosts.includes(parsed.host)) return null;
      const response = await this.deps.fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS), redirect: 'error' });
      const type = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
      if (!response.ok || !/^image\/(jpeg|png|webp)$/.test(type)) return null;
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_COVER_BYTES) return null;
      this.cover = `data:${type};base64,${bytes.toString('base64')}`;
    } catch {
      this.cover = null;
    }
    return this.cover;
  }

  private async accessToken(force = false): Promise<string> {
    if (!this.tokens) throw new SpotifyRequestError('revoked');
    if (!force && this.tokens.expiresAt - REFRESH_MARGIN_MS > this.now()) return this.tokens.accessToken;
    // A refresh token may rotate, so two concurrent refreshes could leave the loser with a dead one.
    this.refreshing ??= this.refreshToken().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async refreshToken(): Promise<string> {
    const current = this.tokens;
    const clientId = this.deps.readConfig().clientId;
    if (!current || !clientId) throw new SpotifyRequestError('revoked');
    const tokens = await this.exchange(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current.refreshToken, client_id: clientId }), current);
    return tokens.accessToken;
  }

  private async exchange(body: URLSearchParams, previous: SpotifyTokens | null): Promise<SpotifyTokens> {
    let response: Response;
    try {
      response = await this.deps.fetch(new URL('/api/token', this.deps.endpoints.accounts), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new SpotifyRequestError('network');
    }
    if (response.status === 429) throw new SpotifyRequestError('rate_limited', this.retryAfter(response));
    if (response.status >= 500) throw new SpotifyRequestError('network');
    if (!response.ok) throw new SpotifyRequestError(previous ? 'revoked' : 'auth_invalid');
    const parsed = tokenResponseSchema.safeParse(await response.json().catch(() => null));
    const refreshToken = parsed.data?.refresh_token ?? previous?.refreshToken;
    if (!parsed.success || !refreshToken) throw new SpotifyRequestError('auth_invalid');
    const tokens: SpotifyTokens = { accessToken: parsed.data.access_token, refreshToken, expiresAt: this.now() + parsed.data.expires_in * 1000, scopes: parsed.data.scope?.split(' ').filter(Boolean) ?? previous?.scopes ?? [] };
    this.tokens = tokens;
    this.deps.store.save(tokens);
    return tokens;
  }

  private retryAfter(response: Response): number {
    const seconds = Number(response.headers.get('retry-after'));
    return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_RETRY_MS;
  }

  private async requestInternal(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown, retried = false): Promise<Response> {
    // The public status contract has no extension-lifecycle error; disabled Spotify is exposed as connection=disabled.
    // Keep request failures inside the existing status error enum while still failing before any network call.
    if (!this.extensionEnabled) throw new SpotifyRequestError('forbidden');
    if (this.retryAt !== null && this.retryAt > this.now()) throw new SpotifyRequestError(this.error === 'quota_exceeded' ? 'quota_exceeded' : 'rate_limited');
    const token = await this.accessToken(retried);
    let response: Response;
    try {
      response = await this.deps.fetch(new URL(path, this.deps.endpoints.api), { method, headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch {
      throw new SpotifyRequestError('network');
    }
    if (response.ok) return response;
    if (response.status === 401 && !retried) return this.requestInternal(method, path, body, true);
    if (response.status === 401) throw new SpotifyRequestError('revoked');
    const reason = await response.json().then((body) => (body as { error?: { reason?: string } }).error?.reason ?? '', () => '');
    if (response.status === 429) throw new SpotifyRequestError(reason === 'QUOTA_EXCEEDED' ? 'quota_exceeded' : 'rate_limited', this.retryAfter(response));
    if (response.status === 403) throw new SpotifyRequestError(reason === 'PREMIUM_REQUIRED' ? 'premium_required' : 'forbidden');
    if (response.status === 404) throw new SpotifyRequestError('no_device');
    throw new SpotifyRequestError(response.status >= 500 ? 'network' : 'unknown');
  }

  async request(input: { method: 'GET' | 'PUT' | 'POST'; path: string; query?: Readonly<Record<string, string>>; body?: unknown }): Promise<Response> {
    const url = new URL(input.path, this.deps.endpoints.api);
    for (const [key, value] of Object.entries(input.query ?? {})) url.searchParams.set(key, value);
    try {
      return await this.requestInternal(input.method, `${url.pathname}${url.search}`, input.body);
    } catch (error) {
      this.fail(error);
      this.emitChange();
      throw error;
    }
  }

  /** What to show when Spotify reports no player: the last track seen here, or the account's history when nothing was. */
  private async remembered(): Promise<SpotifyPlayback | null> {
    if (this.playback?.remembered) return this.playback;
    this.restricted = false;
    const last = this.deps.readConfig().last ?? await this.lastFromHistory();
    if (!last) { this.trackUrl = null; return null; }
    this.trackUrl = last.trackUrl;
    return { trackId: last.trackId, title: last.title, artists: last.artists, cover: last.coverUrl ? await this.loadCover(last.coverUrl) : null, isPlaying: false, progressMs: 0, durationMs: last.durationMs, sampledAt: this.now(), device: last.device, volume: null, canPause: false, canResume: true, canNext: false, canPrevious: false, hasLink: last.trackUrl !== null, remembered: true };
  }

  private async lastFromHistory(): Promise<SpotifyLast | null> {
    if (!this.tokens?.scopes.includes(SPOTIFY_HISTORY_SCOPE)) return null;
    const response = await this.requestInternal('GET', '/v1/me/player/recently-played?limit=1');
    const track = historySchema.safeParse(await response.json()).data?.items[0]?.track;
    if (!track) return null;
    const images = track.album?.images ?? [];
    const link = track.external_urls?.spotify;
    return { trackId: track.id ?? null, title: clip(track.name, 500), artists: clip((track.artists ?? []).map((artist) => artist.name).join(', '), 500), durationMs: Math.max(0, Math.round(track.duration_ms ?? 0)), device: null, deviceId: null, coverUrl: (images.find((image) => (image.width ?? 0) <= 320) ?? images.at(-1))?.url ?? null, trackUrl: link?.startsWith('https://open.spotify.com/') ? link : null };
  }

  /** Only what is online right now: a Spotify app that is closed does not exist for the Web API. */
  async devices(): Promise<SpotifyDevice[]> {
    if (!this.tokens) return [];
    const response = await this.requestInternal('GET', '/v1/me/player/devices');
    const parsed = devicesSchema.safeParse(await response.json());
    return (parsed.data?.devices ?? []).flatMap((device) => (device.id ? [{ id: clip(device.id, 200), name: clip(device.name, 200), type: clip(device.type, 50), isActive: device.is_active === true }] : []));
  }

  private async transfer(deviceId: string): Promise<void> {
    await this.requestInternal('PUT', '/v1/me/player', { device_ids: [deviceId], play: true });
  }

  /** Play with no live player: back to the last device, or the desktop app, which only exists for Spotify once it is open. */
  private async selectAndResume(): Promise<void> {
    let devices = await this.devices();
    if (!devices.length) {
      await this.deps.openExternal('spotify:');
      for (let attempt = 0; attempt < DEVICE_WAIT_TRIES && !devices.length; attempt += 1) {
        await new Promise((done) => { setTimeout(done, DEVICE_WAIT_MS); });
        devices = await this.devices();
      }
    }
    const lastId = this.deps.readConfig().last?.deviceId;
    const device = devices.find((item) => item.id === lastId) ?? devices.find((item) => item.isActive) ?? devices.find((item) => item.type === 'Computer') ?? devices[0];
    if (!device) throw new SpotifyRequestError('no_device');
    await this.transfer(device.id);
  }

  async refresh(): Promise<SpotifyPlayback | null> {
    try {
      const response = await this.requestInternal('GET', '/v1/me/player');
      const next = response.status === 204 ? null : await this.toPlayback(await response.json());
      this.playback = next ?? await this.remembered();
      this.error = null;
      this.retryAt = null;
    } catch (error) {
      this.fail(error);
    }
    this.emitChange();
    return this.playback;
  }

  /** Select a visible Spotify device and start/resume playback on it. */
  async resume(): Promise<SpotifyPlayback | null> {
    await this.selectAndResume();
    return this.refresh();
  }

  async configure(changes: SpotifyConfigure): Promise<SpotifyStatus> {
    const current = this.deps.readConfig();
    const next: SpotifyConfig = { enabled: changes.enabled ?? current.enabled, clientId: changes.clientId === undefined ? current.clientId : changes.clientId, controlsEnabled: changes.controlsEnabled ?? current.controlsEnabled };
    this.deps.writeConfig(next);
    // Tokens belong to the Client ID that issued them.
    if (next.clientId !== current.clientId) this.forget();
    this.error = null;
    if (!next.enabled) this.stopPolling(); else if (this.active) this.schedule(0);
    this.emitChange();
    return this.status();
  }

  async connect(): Promise<SpotifyStatus> {
    const config = this.deps.readConfig();
    if (!this.extensionEnabled || !config.enabled || !config.clientId || this.connectingFlag) return this.status();
    const session = createPkceSession();
    const scopes = config.controlsEnabled ? [...SPOTIFY_READ_SCOPES, SPOTIFY_CONTROL_SCOPE] : [...SPOTIFY_READ_SCOPES];
    this.connectingFlag = true;
    this.error = null;
    this.emitChange();
    try {
      this.connecting = await waitForCallback(session.state, { port: this.deps.redirectPort ?? SPOTIFY_REDIRECT_PORT, timeoutMs: AUTH_TIMEOUT_MS });
      await this.deps.openExternal(authorizeUrl(this.deps.endpoints.accounts, config.clientId, scopes, session));
      const code = await this.connecting.code;
      const tokens = await this.exchange(new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: SPOTIFY_REDIRECT_URI, client_id: config.clientId, code_verifier: session.verifier }), null);
      if (!tokens.scopes.length) tokens.scopes = scopes;
      this.deps.store.save(tokens);
    } catch (error) {
      this.connecting?.cancel();
      this.fail(error);
    } finally {
      this.connecting = null;
      this.connectingFlag = false;
    }
    this.emitChange();
    if (this.active) this.schedule(0);
    return this.status();
  }

  cancelConnect(): void { this.connecting?.cancel(); }

  disconnect(): SpotifyStatus {
    this.cancelConnect();
    this.forget();
    this.error = null;
    this.retryAt = null;
    this.emitChange();
    return this.status();
  }

  async control(control: SpotifyControl): Promise<SpotifyStatus> {
    const block = this.controlBlock(this.deps.readConfig());
    // Play is also the recovery action when Spotify has no active player. In
    // that state `controlBlock` is `no_device`, but selectAndResume() can
    // choose an available device or open the desktop app first.
    if (block && !(control.action === 'play' && block === 'no_device')) return this.status();
    try {
      if (control.action === 'transfer') await this.transfer(control.deviceId);
      else if (control.action === 'play' && (!this.playback || this.playback.remembered)) await this.selectAndResume();
      else if (control.action === 'volume') await this.requestInternal('PUT', `/v1/me/player/volume?volume_percent=${control.volume}`);
      else if (control.action === 'play' || control.action === 'pause') await this.requestInternal('PUT', `/v1/me/player/${control.action}`);
      else await this.requestInternal('POST', `/v1/me/player/${control.action}`);
      this.error = null;
      // The player applies a command a moment after accepting it.
      if (this.active) this.schedule(350);
    } catch (error) {
      this.fail(error);
    }
    this.emitChange();
    return this.status();
  }

  async openTrack(): Promise<void> { if (this.trackUrl) await this.deps.openExternal(this.trackUrl); }

  dispose(): void {
    this.disposed = true;
    this.cancelConnect();
    this.stopPolling();
    this.removeAllListeners();
  }
}
