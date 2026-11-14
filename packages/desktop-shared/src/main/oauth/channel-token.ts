import { parseDesktopOAuthClient, refreshOAuthToken, type OAuthTokens } from './loopback.js';

export const YOUTUBE_READ_SCOPE = 'https://www.googleapis.com/auth/youtube.readonly';
export const YOUTUBE_WRITE_SCOPE = 'https://www.googleapis.com/auth/youtube';

/** What is kept (encrypted) for the channel: the expiry is absolute and the scope is what Google granted. */
export interface StoredChannelTokens { access_token: string; refresh_token?: string; expires_at: number; scope: string; }

interface ChannelTokenStore { load(): { client: unknown; tokens: unknown | null } | null; save(value: { client: unknown; tokens: unknown | null }): void; }
type Fetcher = (url: string, init?: RequestInit) => Promise<Response>;

// Renew a minute early so a request never leaves with a token that expires on the way.
const EXPIRY_MARGIN_MS = 60_000;

export function toStoredChannelTokens(tokens: OAuthTokens, requestedScopes: readonly string[], now = Date.now()): StoredChannelTokens {
  return { access_token: tokens.access_token, ...(tokens.refresh_token ? { refresh_token: tokens.refresh_token } : {}), expires_at: now + tokens.expires_in * 1000, scope: tokens.scope ?? requestedScopes.join(' ') };
}

export function channelScopes(tokens: unknown): string[] {
  const value = tokens as { scope?: unknown } | null | undefined;
  // Connections made before the scope was recorded only ever asked for read access.
  return typeof value?.scope === 'string' ? value.scope.split(/\s+/u).filter(Boolean) : [YOUTUBE_READ_SCOPE];
}

export function canWriteChannel(tokens: unknown): boolean { return channelScopes(tokens).includes(YOUTUBE_WRITE_SCOPE); }

/**
 * Returns a usable access token for the connected channel, renewing it with the refresh token when it is about to
 * expire. A write needs the `youtube` scope: without it the person is asked to widen the permission instead of the
 * call failing at Google with 403. The token never leaves the main process.
 */
export async function channelAccessToken(store: ChannelTokenStore, mode: 'read' | 'write', options: { now?: number; fetcher?: Fetcher } = {}): Promise<string> {
  const stored = store.load();
  const tokens = stored?.tokens as Partial<StoredChannelTokens> | null | undefined;
  if (!stored || typeof tokens?.access_token !== 'string') throw new Error('auth_required: conecte o canal YouTube.');
  if (mode === 'write' && !canWriteChannel(tokens)) throw new Error('scope_required: autorize a escrita no canal em "Permitir envio e edição".');
  const now = options.now ?? Date.now();
  const expiresAt = typeof tokens.expires_at === 'number' ? tokens.expires_at : 0;
  if (expiresAt - EXPIRY_MARGIN_MS > now) return tokens.access_token;
  if (typeof tokens.refresh_token !== 'string') throw new Error('auth_expired: a autorização do YouTube expirou. Conecte o canal de novo.');
  const client = parseDesktopOAuthClient(stored.client);
  const renewed = await refreshOAuthToken(client, tokens.refresh_token, options.fetcher);
  // A refresh answer may omit the scope; the grant does not change on renewal.
  const next = toStoredChannelTokens({ ...renewed, scope: renewed.scope ?? channelScopes(tokens).join(' ') }, [], now);
  store.save({ client: stored.client, tokens: next });
  return next.access_token;
}
