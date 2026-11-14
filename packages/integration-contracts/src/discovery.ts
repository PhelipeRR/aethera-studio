import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request as httpRequest, type ClientRequest } from 'node:http';
import { join } from 'node:path';
import {
  INTEGRATION_ENDPOINTS,
  type AppId,
  type CapabilitiesResponse,
  type DelegatedTaskRequest,
  type DelegatedTaskStatus,
  type HealthResponse,
  type IntegrationEvent,
  type IntegrationTransport,
} from './index.js';

export interface PeerDiscoveryRecord {
  appId: AppId;
  pid: number;
  version: string;
  schemaVersion: string;
  capabilities: readonly string[];
  baseUrl: string;
  ipcPath?: string;
  startedAtIso: string;
}

export function defaultPipePath(appId: AppId, instanceSuffix = String(process.pid)): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\singularity-${appId}-${instanceSuffix}`;
  }
  return `/tmp/singularity-${appId}-${instanceSuffix}.sock`;
}

export function writeDiscoveryRecord(discoveryDir: string, record: PeerDiscoveryRecord): string {
  mkdirSync(discoveryDir, { recursive: true });
  const file = join(discoveryDir, `${record.appId}.json`);
  writeFileSync(file, JSON.stringify(record, null, 2), 'utf8');
  return file;
}

export function removeDiscoveryRecord(discoveryDir: string, appId: AppId): void {
  const file = join(discoveryDir, `${appId}.json`);
  try {
    if (existsSync(file)) rmSync(file, { force: true });
  } catch {
    // Ignore cleanup errors on exit
  }
}

function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function discoverPeers(discoveryDir: string): PeerDiscoveryRecord[] {
  if (!existsSync(discoveryDir)) return [];
  const files = readdirSync(discoveryDir).filter((f) => f.endsWith('.json'));
  const peers: PeerDiscoveryRecord[] = [];
  for (const file of files) {
    try {
      const parsed = JSON.parse(readFileSync(join(discoveryDir, file), 'utf8')) as PeerDiscoveryRecord;
      if (parsed && parsed.appId && isPidAlive(parsed.pid)) {
        peers.push(parsed);
      }
    } catch {
      // Ignore malformed/stale discovery files
    }
  }
  return peers;
}

export interface SocketHttpTransportOptions {
  socketPath?: string;
  baseUrl?: string;
  token?: string;
  timeoutMs?: number;
}

export interface ExtendedIntegrationTransport extends IntegrationTransport {
  getTaskStatus(taskId: string): Promise<DelegatedTaskStatus>;
  subscribeEvents(onEvent: (event: IntegrationEvent) => void): { close(): void };
}

function performHttpJson<T>(
  opts: SocketHttpTransportOptions,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const payload = body !== undefined ? JSON.stringify(body) : undefined;
    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (opts.token) {
      headers.Authorization = `Bearer ${opts.token}`;
    }
    if (payload !== undefined) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = String(Buffer.byteLength(payload));
    }

    let req: ClientRequest;
    if (opts.socketPath) {
      req = httpRequest({ socketPath: opts.socketPath, path, method, headers });
    } else if (opts.baseUrl) {
      const parsed = new URL(path, opts.baseUrl);
      req = httpRequest(parsed, { method, headers });
    } else {
      reject(new Error('missing_socket_or_base_url'));
      return;
    }

    const timer = setTimeout(() => {
      req.destroy(new Error('request_timeout'));
    }, opts.timeoutMs ?? 5000);

    req.on('response', (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      res.on('end', () => {
        clearTimeout(timer);
        const raw = Buffer.concat(chunks).toString('utf8');
        let parsed: unknown;
        try {
          parsed = raw ? JSON.parse(raw) : {};
        } catch {
          parsed = { raw };
        }
        const status = res.statusCode ?? 500;
        if (status >= 200 && status < 300) {
          resolve(parsed as T);
        } else {
          const errMsg =
            typeof (parsed as { error?: string }).error === 'string'
              ? (parsed as { error: string }).error
              : `http_${status}`;
          reject(new Error(`http_${status}:${errMsg}`));
        }
      });
    });

    req.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

export function createSocketIntegrationTransport(
  opts: SocketHttpTransportOptions,
): ExtendedIntegrationTransport {
  return {
    health: () => performHttpJson<HealthResponse>(opts, 'GET', INTEGRATION_ENDPOINTS.health),
    capabilities: () =>
      performHttpJson<CapabilitiesResponse>(opts, 'GET', INTEGRATION_ENDPOINTS.capabilities),
    submitTask: (req: DelegatedTaskRequest) =>
      performHttpJson<DelegatedTaskStatus>(opts, 'POST', INTEGRATION_ENDPOINTS.tasks, req),
    getTaskStatus: (taskId: string) =>
      performHttpJson<DelegatedTaskStatus>(opts, 'GET', `${INTEGRATION_ENDPOINTS.tasks}/${taskId}`),
    subscribeEvents: (onEvent) => {
      const headers: Record<string, string> = { Accept: 'text/event-stream' };
      if (opts.token) headers.Authorization = `Bearer ${opts.token}`;

      const req = opts.socketPath
        ? httpRequest({
            socketPath: opts.socketPath,
            path: INTEGRATION_ENDPOINTS.events,
            method: 'GET',
            headers,
          })
        : httpRequest(new URL(INTEGRATION_ENDPOINTS.events, opts.baseUrl), {
            method: 'GET',
            headers,
          });

      let buffer = '';
      req.on('response', (res) => {
        res.on('data', (chunk) => {
          buffer += Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk);
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const frame of frames) {
            const dataLine = frame
              .split('\n')
              .find((l) => l.startsWith('data: '));
            if (!dataLine) continue;
            try {
              onEvent(JSON.parse(dataLine.slice(6)) as IntegrationEvent);
            } catch {
              // Ignore malformed SSE event
            }
          }
        });
      });
      req.on('error', () => {
        // Caller handles reconnect/offline state
      });
      req.end();

      return {
        close: () => {
          req.destroy();
        },
      };
    },
  };
}
