import { request, type IncomingMessage } from 'node:http';

/*
 * CORE-06: the desktop's client for the Core's task routes. Loopback HTTP with the desktop bearer (from the IPC ready
 * message), plus the engine-event SSE stream with Last-Event-ID resume. A new Core instance restarts the ids, so the
 * cursor is reset whenever the instance changes.
 */

export interface CoreConnection { port: number; token: string; executorId: string | null; instanceId: string }

export class CoreRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); }
}

export function callCore<T>(connection: CoreConnection, method: 'GET' | 'POST', path: string, body?: unknown, timeoutMs = 30_000): Promise<T> {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: connection.port, method, path, timeout: timeoutMs, headers: { Host: `127.0.0.1:${connection.port}`, Authorization: `Bearer ${connection.token}`, ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}) } }, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed: unknown = null;
        try { parsed = text ? JSON.parse(text) : null; } catch { /* reported below */ }
        if ((response.statusCode ?? 500) >= 400) {
          const error = (parsed as { error?: { code?: string; message?: string } } | null)?.error;
          // Keep the existing "code: message" convention so the renderer shows the same errors as before.
          const local: Record<string, string> = { not_found: 'not_found', invalid_request: 'invalid', forbidden: 'forbidden', conflict: 'conflict', invalid_transition: 'invalid' };
          reject(new CoreRequestError(response.statusCode ?? 500, error?.code ?? 'internal', `${local[error?.code ?? ''] ?? 'failed'}: ${error?.message ?? 'O Core recusou a operação.'}`));
          return;
        }
        resolve(parsed as T);
      });
    });
    req.on('timeout', () => req.destroy(new Error('failed: O Core não respondeu a tempo.')));
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Follows /internal/v1/engine-events and hands each update over; reconnects with the last id until stopped. */
export class EngineEventStream {
  private lastId = 0;
  private instanceId: string | null = null;
  private current: { destroy: () => void } | null = null;
  private stopped = false;
  private retry: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly onEvent: (data: unknown) => void, private readonly log: (event: string, fields?: Record<string, string | number | null>) => void) {}

  connect(connection: CoreConnection | null): void {
    this.current?.destroy();
    this.current = null;
    if (this.retry) clearTimeout(this.retry);
    if (!connection || this.stopped) return;
    if (connection.instanceId !== this.instanceId) { this.instanceId = connection.instanceId; this.lastId = 0; }
    const req = request({ host: '127.0.0.1', port: connection.port, method: 'GET', path: '/internal/v1/engine-events', headers: { Host: `127.0.0.1:${connection.port}`, Authorization: `Bearer ${connection.token}`, Accept: 'text/event-stream', 'Last-Event-ID': String(this.lastId) } }, (response: IncomingMessage) => {
      if (response.statusCode !== 200) { response.resume(); this.scheduleRetry(connection); return; }
      response.setEncoding('utf8');
      let buffer = '';
      response.on('data', (chunk: string) => {
        buffer += chunk;
        let end: number;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          this.frame(frame);
        }
      });
      response.on('end', () => this.scheduleRetry(connection));
    });
    req.on('error', () => this.scheduleRetry(connection));
    req.end();
    this.current = { destroy: () => req.destroy() };
  }

  stop(): void {
    this.stopped = true;
    this.current?.destroy();
    if (this.retry) clearTimeout(this.retry);
  }

  private frame(frame: string): void {
    let id: number | null = null;
    let data = '';
    let event = 'message';
    for (const line of frame.split('\n')) {
      if (line.startsWith('id: ')) id = Number(line.slice(4));
      else if (line.startsWith('event: ')) event = line.slice(7);
      else if (line.startsWith('data: ')) data += line.slice(6);
    }
    if (event === 'gap') { this.log('core.events_gap', {}); this.lastId = 0; return; }
    if (id === null || !data) return;
    if (id <= this.lastId) return;
    this.lastId = id;
    try { this.onEvent(JSON.parse(data)); } catch { this.log('core.events_invalid', {}); }
  }

  private scheduleRetry(connection: CoreConnection): void {
    if (this.stopped) return;
    this.retry = setTimeout(() => this.connect(connection), 1_000);
    this.retry.unref();
  }
}
