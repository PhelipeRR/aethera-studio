import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { z } from 'zod';
import { CORE_CONTRACT_VERSION, CORE_ROUTES, coreError, healthSchema, httpStatusOf, VERSION_HEADERS, type CoreError } from '@neuralbridge/shared/core-api';
import { sendError } from './http.js';
import { INSTANCE_HEADER } from './protocol.js';

/*
 * CORE-03: the Core's HTTP server. It binds to 127.0.0.1 only (never 0.0.0.0, never a LAN address), answers only
 * loopback peers and only requests whose Host is the loopback address it serves (DNS-rebinding protection), sends no
 * CORS headers (browsers on other origins cannot read it) and serves only GET /api/v1/health in this lot. Everything
 * else is a CORE-02 error envelope.
 */

export const LOOPBACK_HOST = '127.0.0.1';
const LOOPBACK_PEERS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export type Health = z.infer<typeof healthSchema>;

export interface CoreServer {
  port: number;
  server: Server;
  close(): Promise<void>;
}

function send(response: ServerResponse, status: number, body: unknown, instanceId: string): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    [VERSION_HEADERS.server]: CORE_CONTRACT_VERSION,
    [INSTANCE_HEADER]: instanceId,
  });
  response.end(payload);
}

function fail(response: ServerResponse, instanceId: string, error: CoreError): void {
  send(response, httpStatusOf(error.error.code), error, instanceId);
}

export function allowedHost(host: string | undefined, port: number): boolean {
  return host === `${LOOPBACK_HOST}:${port}` || host === `localhost:${port}`;
}

/** CORE-05: domain routes plug in here; return true when the request was handled. Errors become the contract envelope. */
export type DomainHandler = (request: IncomingMessage, response: ServerResponse, path: string, context: RequestContext) => Promise<boolean>;

/** remote: the request came through `tailscale serve` (tailnet host); it never gets the desktop's local trust. */
export interface RequestContext { remote: boolean; host: string; port: number }

export function createHandler(options: { instanceId: string; port: () => number; health: () => Health; domain?: DomainHandler; remoteHosts?: () => readonly string[] }) {
  return (request: IncomingMessage, response: ServerResponse): void => {
    const { instanceId } = options;
    if (!LOOPBACK_PEERS.has(request.socket.remoteAddress ?? '')) { request.socket.destroy(); return; }
    const host = request.headers.host ?? '';
    // CORE-07: the tailnet name is accepted only while remote access is on (tailscale serve proxies from loopback).
    const remote = !allowedHost(host, options.port()) && (options.remoteHosts?.() ?? []).includes(host.toLowerCase());
    if (!remote && !allowedHost(host, options.port())) { fail(response, instanceId, coreError('forbidden', 'Host não permitido.')); return; }
    const path = (request.url ?? '/').split('?')[0];
    // Over the tailnet even /health needs a device credential, so it goes to the domain (CORE-02 health contract).
    if (path === CORE_ROUTES.health.path && !remote) {
      if (request.method !== 'GET') { fail(response, instanceId, coreError('invalid_request', 'Use GET.')); return; }
      request.resume();
      send(response, 200, healthSchema.parse(options.health()), instanceId);
      return;
    }
    const notFound = () => { request.resume(); fail(response, instanceId, coreError('not_found', 'Rota não disponível nesta versão do Core.')); };
    if (!options.domain) { notFound(); return; }
    options.domain(request, response, path ?? '/', { remote, host, port: options.port() }).then((handled) => { if (!handled) notFound(); }, (error: unknown) => {
      if (!response.headersSent) sendError(response, error);
      else response.end();
    });
  };
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => { server.off('listening', onListening); reject(error); };
    const onListening = () => { server.off('error', onError); resolve((server.address() as AddressInfo).port); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen({ host: LOOPBACK_HOST, port, exclusive: true });
  });
}

/**
 * Listens on the preferred port, or a dynamic one when it is taken (or none was asked). The real port is reported by
 * the ready message and written to core.lock, so clients never guess it.
 */
export async function startServer(options: { preferredPort: number | null; instanceId: string; health: () => Health; onPortFallback?: (port: number) => void; domain?: DomainHandler; remoteHosts?: () => readonly string[] }): Promise<CoreServer> {
  let port = 0;
  const server = createServer({ requestTimeout: 10_000, headersTimeout: 5_000, maxHeaderSize: 8 * 1024 }, createHandler({ instanceId: options.instanceId, port: () => port, health: options.health, ...(options.domain ? { domain: options.domain } : {}), ...(options.remoteHosts ? { remoteHosts: options.remoteHosts } : {}) }));
  server.keepAliveTimeout = 5_000;
  if (options.preferredPort !== null) {
    try { port = await listen(server, options.preferredPort); } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EADDRINUSE' && (error as NodeJS.ErrnoException).code !== 'EACCES') throw error;
      options.onPortFallback?.(options.preferredPort);
    }
  }
  if (port === 0) port = await listen(server, 0);
  return {
    port,
    server,
    close: () => new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections(); }),
  };
}
