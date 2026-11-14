import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { AuthError, DESKTOP_GRANT, HttpError, matchPath, readJson, sendJson, type AuthPrincipal, type AuthService, type Health, type RequestContext, type TailscaleRemote } from '@neuralbridge/core';
import { CORE_ROUTES, grantSchema, pairingClaimRequestSchema, pairingDecisionRequestSchema, RATE_LIMIT_CLASSES, revokeRequestSchema, tokenRequestSchema, type RateLimitClass } from '@neuralbridge/shared/core-api';
import { z } from 'zod';

/*
 * CORE-07: who is calling, and the pairing / token / device / audit / remote-access routes.
 * - On loopback, the desktop bearer (from the IPC pipe) is the desktop principal with every scope.
 * - Paired devices use `Authorization: DPoP <token>` plus a DPoP proof bound to method, URL and token.
 * - Over the tailnet the desktop bearer is never accepted, and even /health needs a device credential.
 * - Local-only routes (pairing start/decision, devices, audit, remote control) refuse anyone but the desktop.
 */

export function toHttpError(error: unknown): unknown {
  if (error instanceof AuthError) return new HttpError(error.code, error.message, error.retryAfterMs !== undefined ? { retryAfterMs: Math.max(0, Math.round(error.retryAfterMs)) } : {});
  return error;
}

export function requestUrl(request: IncomingMessage, path: string, context: RequestContext): string {
  return context.remote ? `https://${context.host}${path}` : `http://127.0.0.1:${context.port}${path}`;
}

/** Source address for rate limits: the tailnet client (X-Forwarded-For from tailscale serve) or the local machine. */
export function sourceOf(request: IncomingMessage, context: RequestContext): string {
  if (!context.remote) return 'local';
  const forwarded = request.headers['x-forwarded-for'];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim().slice(0, 64) || 'tailnet';
}

export function createPrincipalResolver(auth: AuthService, desktopBearer: (request: IncomingMessage) => boolean) {
  return (request: IncomingMessage, path: string, context: RequestContext): AuthPrincipal => {
    const header = request.headers.authorization ?? '';
    if (!context.remote && header.startsWith('Bearer ') && desktopBearer(request)) return { kind: 'desktop', id: 'desktop', label: null, grant: DESKTOP_GRANT, deviceId: null };
    if (header.startsWith('DPoP ')) {
      try { return auth.authenticate(header, typeof request.headers.dpop === 'string' ? request.headers.dpop : undefined, request.method ?? 'GET', requestUrl(request, path, context)); } catch (error) { throw toHttpError(error); }
    }
    throw new HttpError('unauthenticated', 'Credencial ausente ou inválida.');
  };
}

const REMOTE_FILE = 'core-remote.json';

export interface AuthRouteDeps {
  auth: AuthService;
  remote: TailscaleRemote;
  dataDir: string;
  principal: ReturnType<typeof createPrincipalResolver>;
  health: () => Health | null;
  port: () => number | null;
  /** Current tailnet host while remote access is on (null otherwise). */
  remoteHost: { value: string | null };
}

export function remoteEnabled(dataDir: string): boolean {
  try { return existsSync(join(dataDir, REMOTE_FILE)) && (JSON.parse(readFileSync(join(dataDir, REMOTE_FILE), 'utf8')) as { enabled?: unknown }).enabled === true; } catch { return false; }
}

export function createAuthRoutes(deps: AuthRouteDeps) {
  const { auth } = deps;
  const limit = (cls: RateLimitClass, key: string) => { try { auth.limiter.check(`${cls}:${key}`, RATE_LIMIT_CLASSES[cls]); } catch (error) { throw toHttpError(error); } };
  const desktopOnly = (principal: AuthPrincipal) => { if (principal.kind !== 'desktop') throw new HttpError('forbidden', 'Disponível só no desktop.'); };

  async function applyRemote(enabled: boolean): Promise<unknown> {
    writeFileSync(join(deps.dataDir, REMOTE_FILE), JSON.stringify({ enabled }));
    const port = deps.port();
    if (!enabled || port === null) { await deps.remote.disable(); deps.remoteHost.value = null; return { enabled, ...(await deps.remote.status(port)) }; }
    const state = await deps.remote.enable(port);
    deps.remoteHost.value = state.state === 'ready' && state.serving ? state.hostname.toLowerCase() : null;
    return { enabled, ...state };
  }

  async function route(request: IncomingMessage, response: ServerResponse, path: string, context: RequestContext): Promise<boolean> {
    const method = request.method ?? 'GET';
    const source = sourceOf(request, context);
    try {
      // Unauthenticated handshake: claim with the one-time code, poll, exchange for tokens (rate-limited per source).
      if (path === CORE_ROUTES.pairingClaim.path && method === 'POST') {
        limit('pairing', source);
        const body = await readJson(request, pairingClaimRequestSchema);
        sendJson(response, 200, auth.claim(body, source));
        return true;
      }
      const pairing = matchPath(CORE_ROUTES.pairingStatus.path, path);
      if (pairing && method === 'GET') { limit('pairing', source); sendJson(response, 200, auth.pairingStatus(pairing['id'] ?? '')); return true; }
      if (path === CORE_ROUTES.token.path && method === 'POST') {
        limit('token', source);
        const body = await readJson(request, tokenRequestSchema);
        sendJson(response, 200, auth.token(body, typeof request.headers.dpop === 'string' ? request.headers.dpop : undefined, requestUrl(request, path, context), source));
        return true;
      }
      if (path === CORE_ROUTES.health.path && method === 'GET') {
        deps.principal(request, path, context);
        const health = deps.health();
        if (!health) throw new HttpError('host_unavailable', 'O Core está iniciando.');
        sendJson(response, 200, health);
        return true;
      }

      const localRoutes = [CORE_ROUTES.pairingStart.path, CORE_ROUTES.devicesList.path, CORE_ROUTES.devicesRevoke.path, CORE_ROUTES.auditList.path, '/internal/v1/pairings', '/internal/v1/remote'];
      const decide = matchPath(CORE_ROUTES.pairingDecide.path, path);
      if (!localRoutes.includes(path) && !decide) return false;
      const principal = deps.principal(request, path, context);
      desktopOnly(principal);

      if (path === CORE_ROUTES.pairingStart.path && method === 'POST') {
        const body = await readJson(request, z.strictObject({ grant: grantSchema, deviceLabelHint: z.string().max(60).optional() }));
        const host = deps.remoteHost.value;
        if (!host) throw new HttpError('capability_unavailable', 'Ative o acesso remoto pelo Tailscale antes de parear um aparelho.');
        sendJson(response, 200, auth.startPairing(body.grant, `https://${host}`));
        return true;
      }
      if (decide && method === 'POST') {
        const body = await readJson(request, pairingDecisionRequestSchema.omit({ pairingId: true }));
        sendJson(response, 200, auth.decide(decide['id'] ?? '', body.decision, body.grant));
        return true;
      }
      if (path === '/internal/v1/pairings' && method === 'GET') { sendJson(response, 200, { items: auth.pendingPairings() }); return true; }
      if (path === CORE_ROUTES.devicesList.path && method === 'GET') { sendJson(response, 200, { items: auth.devices() }); return true; }
      if (path === CORE_ROUTES.devicesRevoke.path && method === 'POST') { sendJson(response, 200, auth.revoke(await readJson(request, revokeRequestSchema))); return true; }
      if (path === CORE_ROUTES.auditList.path && method === 'GET') {
        const query = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams;
        const size = Math.min(100, Math.max(1, Number(query.get('limit') ?? 50) || 50));
        const items = auth.auditPage(size, query.get('cursor'));
        sendJson(response, 200, { items, nextCursor: items.length === size ? String(items.at(-1)?.['at'] ?? '') || null : null });
        return true;
      }
      if (path === '/internal/v1/remote' && method === 'GET') { sendJson(response, 200, { enabled: remoteEnabled(deps.dataDir), ...(await deps.remote.status(deps.port())) }); return true; }
      if (path === '/internal/v1/remote' && method === 'POST') { sendJson(response, 200, await applyRemote((await readJson(request, z.strictObject({ enabled: z.boolean() }))).enabled)); return true; }
      return false;
    } catch (error) {
      throw toHttpError(error);
    }
  }

  return { route, applyRemote };
}
