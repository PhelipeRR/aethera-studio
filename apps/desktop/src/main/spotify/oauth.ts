import { SPOTIFY_REDIRECT_URI, type SpotifyErrorCode } from '@neuralbridge/shared/spotify';
import { createPkceSession as createGenericPkceSession, waitForLoopbackCallback } from '../oauth/loopback.js';

export class SpotifyAuthError extends Error {
  constructor(readonly code: SpotifyErrorCode) { super(code); this.name = 'SpotifyAuthError'; }
}

export interface PkceSession { verifier: string; challenge: string; state: string; }

export function createPkceSession(): PkceSession {
  return createGenericPkceSession();
}

export function authorizeUrl(accountsUrl: string, clientId: string, scopes: readonly string[], session: PkceSession): string {
  const url = new URL('/authorize', accountsUrl);
  url.search = new URLSearchParams({ response_type: 'code', client_id: clientId, scope: scopes.join(' '), redirect_uri: SPOTIFY_REDIRECT_URI, state: session.state, code_challenge_method: 'S256', code_challenge: session.challenge }).toString();
  return url.toString();
}

export interface CallbackWait { code: Promise<string>; cancel(): void; }

/**
 * One-shot listener for the OAuth redirect, on the loopback address only. It stops at the first request carrying the
 * right state, at the timeout, or on cancel. Host is checked so a page on another name cannot reach it by DNS rebinding.
 */
export function waitForCallback(state: string, options: { port: number; timeoutMs: number }): Promise<CallbackWait> {
  return waitForLoopbackCallback(state, { ...options, onDenied: () => new SpotifyAuthError('auth_denied'), onTimeout: () => new SpotifyAuthError('auth_timeout') }).catch(() => { throw new SpotifyAuthError('port_in_use'); });
}
