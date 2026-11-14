import { describe, expect, it } from 'vitest';
import { buildPkceAuthorizeUrl, createPkceSession, parseDesktopOAuthClient } from '../src/main/oauth/loopback.js';

describe('generic OAuth loopback', () => {
  it('parses desktop clients and builds incremental PKCE authorization URLs', () => {
    const client = parseDesktopOAuthClient({ installed: { client_id: 'id', client_secret: 'secret', auth_uri: 'https://accounts.google.com/o/oauth2/v2/auth', token_uri: 'https://oauth2.googleapis.com/token', redirect_uris: ['http://127.0.0.1/callback'] } });
    const url = new URL(buildPkceAuthorizeUrl(client, createPkceSession(), ['https://www.googleapis.com/auth/youtube.readonly'], 'http://127.0.0.1/callback'));
    expect(url.searchParams.get('scope')).toContain('youtube.readonly');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
  });
  it('accepts Google desktop metadata while retaining only OAuth fields', () => {
    expect(parseDesktopOAuthClient({ project_id: 'project', installed: { client_id: 'id', client_secret: 'secret', auth_uri: 'https://accounts.google.com/o/oauth2/v2/auth', token_uri: 'https://oauth2.googleapis.com/token', redirect_uris: ['http://127.0.0.1/callback'], auth_provider_x509_cert_url: 'https://www.googleapis.com/oauth2/v1/certs' } })).toEqual({ client_id: 'id', client_secret: 'secret', auth_uri: 'https://accounts.google.com/o/oauth2/v2/auth', token_uri: 'https://oauth2.googleapis.com/token', redirect_uris: ['http://127.0.0.1/callback'] });
  });
  it('also parses the normalized client persisted by the OAuth store', () => {
    expect(parseDesktopOAuthClient({ client_id: 'id', client_secret: 'secret', auth_uri: 'https://accounts.google.com/o/oauth2/v2/auth', token_uri: 'https://oauth2.googleapis.com/token', redirect_uris: ['http://127.0.0.1/callback'] })).toMatchObject({ client_id: 'id' });
  });
  it('refreshes a token while retaining the original refresh token when omitted', async () => {
    const client = parseDesktopOAuthClient({ installed: { client_id: 'id', client_secret: 'secret', auth_uri: 'https://accounts.google.com/o/oauth2/v2/auth', token_uri: 'https://oauth2.googleapis.com/token', redirect_uris: ['http://127.0.0.1/callback'] } });
    const { refreshOAuthToken } = await import('../src/main/oauth/loopback.js');
    await expect(refreshOAuthToken(client, 'refresh', async () => new Response(JSON.stringify({ access_token: 'new', expires_in: 3600 })))).resolves.toMatchObject({ access_token: 'new', refresh_token: 'refresh' });
  });
  it('revokes a token and accepts an already-invalid token', async () => {
    const { revokeOAuthToken } = await import('../src/main/oauth/loopback.js'); let called = false;
    await revokeOAuthToken('token', async (_url, init) => { called = String(init?.body).includes('token=token'); return new Response('', { status: 200 }); });
    expect(called).toBe(true);
    await expect(revokeOAuthToken('token', async () => new Response('', { status: 400 }))).resolves.toBeUndefined();
    let target = '';
    await revokeOAuthToken('token', async (url) => { target = url; return new Response('', { status: 200 }); }, 'http://127.0.0.1:9/revoke');
    expect(target).toBe('http://127.0.0.1:9/revoke');
  });
  it('rejects clients without loopback redirects', () => {
    expect(() => parseDesktopOAuthClient({ installed: { client_id: 'id', client_secret: 'secret', auth_uri: 'https://accounts.google.com/o/oauth2/v2/auth', token_uri: 'https://oauth2.googleapis.com/token', redirect_uris: ['https://example.com/callback'] } })).toThrow(/loopback/);
  });
  it('exchanges a code without logging or returning the client secret', async () => {
    const client = parseDesktopOAuthClient({ installed: { client_id: 'id', client_secret: 'secret', auth_uri: 'https://accounts.google.com/o/oauth2/v2/auth', token_uri: 'https://oauth2.googleapis.com/token', redirect_uris: ['http://127.0.0.1/callback'] } });
    let body = ''; const tokens = await (await import('../src/main/oauth/loopback.js')).exchangePkceCode(client, 'code', 'verifier', 'http://127.0.0.1/callback', async (_url, init) => { body = String(init?.body); return new Response(JSON.stringify({ access_token: 'a', refresh_token: 'r', expires_in: 3600 })); });
    expect(tokens).toMatchObject({ access_token: 'a', refresh_token: 'r' }); expect(body).toContain('client_id=id'); expect(tokens).not.toHaveProperty('client_secret');
  });
});
