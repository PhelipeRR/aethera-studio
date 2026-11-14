import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { z } from 'zod';

export interface PkceSession { verifier: string; challenge: string; state: string; }
export function createPkceSession(): PkceSession {
  const verifier = randomBytes(64).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url'), state: randomBytes(32).toString('base64url') };
}
const desktopClientFields = z.object({ client_id: z.string().min(1), client_secret: z.string().min(1), auth_uri: z.string().url(), token_uri: z.string().url(), redirect_uris: z.array(z.string().url()).min(1) }).passthrough();
const normalizedDesktopClientSchema = z.object({ client_id: z.string().min(1), client_secret: z.string().min(1), auth_uri: z.string().url(), token_uri: z.string().url(), redirect_uris: z.array(z.string().url()).min(1) }).strict();
const desktopClientSchema = z.union([z.object({ installed: desktopClientFields.passthrough() }).passthrough(), desktopClientFields.passthrough()]);
export type DesktopOAuthClient = z.infer<typeof desktopClientFields>;
export function parseDesktopOAuthClient(value: unknown): DesktopOAuthClient { const parsed = desktopClientSchema.parse(value); const raw = 'installed' in parsed ? desktopClientFields.parse(parsed.installed) : desktopClientFields.parse(parsed); const client = normalizedDesktopClientSchema.parse({ client_id: raw.client_id, client_secret: raw.client_secret, auth_uri: raw.auth_uri, token_uri: raw.token_uri, redirect_uris: raw.redirect_uris }); if (!client.redirect_uris.some((uri) => new URL(uri).hostname === '127.0.0.1' || new URL(uri).hostname === 'localhost')) throw new Error('invalid: cliente OAuth precisa permitir redirect loopback.'); return client; }
export function buildPkceAuthorizeUrl(client: DesktopOAuthClient, session: PkceSession, scopes: readonly string[], redirectUri: string): string { const url = new URL(client.auth_uri); url.search = new URLSearchParams({ client_id: client.client_id, response_type: 'code', redirect_uri: redirectUri, scope: scopes.join(' '), state: session.state, code_challenge: session.challenge, code_challenge_method: 'S256', access_type: 'offline', prompt: 'consent' }).toString(); return url.toString(); }
const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional(), expires_in: z.number().positive(), scope: z.string().optional(), token_type: z.string().optional() }).passthrough();
export type OAuthTokens = z.infer<typeof tokenSchema>;
export async function exchangePkceCode(client: DesktopOAuthClient, code: string, verifier: string, redirectUri: string, fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch): Promise<OAuthTokens> {
  const response = await fetcher(client.token_uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: client.client_id, client_secret: client.client_secret, redirect_uri: redirectUri, grant_type: 'authorization_code', code_verifier: verifier }).toString(), redirect: 'error' });
  if (!response.ok) throw new Error(`OAuth respondeu HTTP ${response.status}.`);
  const parsed = tokenSchema.safeParse(await response.json()); if (!parsed.success) throw new Error('invalid: resposta OAuth sem tokens válidos.'); return parsed.data;
}
export async function refreshOAuthToken(client: DesktopOAuthClient, refreshToken: string, fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch): Promise<OAuthTokens> {
  if (!refreshToken.trim()) throw new Error('auth_required: refresh token ausente.');
  const response = await fetcher(client.token_uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, refresh_token: refreshToken, grant_type: 'refresh_token' }).toString(), redirect: 'error' });
  if (!response.ok) throw new Error(`OAuth respondeu HTTP ${response.status} ao renovar o token.`);
  const parsed = tokenSchema.safeParse(await response.json()); if (!parsed.success) throw new Error('invalid: resposta OAuth de renovação sem token válido.'); return { ...parsed.data, refresh_token: parsed.data.refresh_token ?? refreshToken };
}
export const GOOGLE_REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
export async function revokeOAuthToken(token: string, fetcher: (url: string, init?: RequestInit) => Promise<Response> = fetch, revokeUrl = GOOGLE_REVOKE_URL): Promise<void> { if (!token.trim()) return; const response = await fetcher(revokeUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token }).toString(), redirect: 'error' }); if (!response.ok && response.status !== 400) throw new Error(`OAuth respondeu HTTP ${response.status} ao desconectar.`); }
export interface LoopbackCallback { code: Promise<string>; cancel(): void; }
export function waitForLoopbackCallback(state: string, options: { port: number; timeoutMs: number; path?: string; onDenied?: () => Error; onTimeout?: () => Error }): Promise<LoopbackCallback> {
  return new Promise((resolveWait, rejectWait) => {
    let finish: (error: Error | null, code?: string) => void = () => undefined;
    const code = new Promise<string>((resolve, reject) => { finish = (error, value) => { clearTimeout(timer); server.close(); server.closeAllConnections(); if (error) reject(error); else resolve(value ?? ''); }; });
    code.catch(() => undefined);
    const server = createServer((request, response) => {
      const address = server.address(); const port = typeof address === 'object' && address ? address.port : options.port;
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);
      const expectedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `127.0.0.1`, 'localhost']);
      if (request.method !== 'GET' || url.pathname !== (options.path ?? '/callback') || !expectedHosts.has(request.headers.host ?? '')) { response.writeHead(404).end(); return; }
      const received = Buffer.from(url.searchParams.get('state') ?? ''); const expected = Buffer.from(state);
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) { response.writeHead(400).end('Pedido inválido.'); return; }
      const value = url.searchParams.get('code'); response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': "default-src 'none'" }).end('Singularity conectado.');
      finish(value ? null : (options.onDenied?.() ?? new Error('auth_denied')), value ?? undefined);
    });
    const timer = setTimeout(() => finish(options.onTimeout?.() ?? new Error('auth_timeout')), options.timeoutMs); timer.unref();
    server.once('error', () => { clearTimeout(timer); rejectWait(new Error('port_in_use')); });
    server.listen(options.port, '127.0.0.1', () => resolveWait({ code, cancel: () => finish(options.onTimeout?.() ?? new Error('auth_timeout')) }));
  });
}
