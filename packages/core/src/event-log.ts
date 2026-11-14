import type { IncomingMessage, ServerResponse } from 'node:http';
import { STREAM_RETENTION } from '@neuralbridge/shared/core-api';

/*
 * CORE-05: per-stream event log with monotonic ids, bounded retention and live subscribers, served as SSE.
 * A client resumes with Last-Event-ID (or ?since=); anything older than the retention window gets a `gap` event so the
 * client re-reads the resource instead of silently missing events (CORE-02 events.ts).
 */

export interface LoggedEvent { id: number; type: string; data: unknown }
type Listener = (event: LoggedEvent) => void;

export class EventLog {
  private readonly streams = new Map<string, { next: number; events: LoggedEvent[]; listeners: Set<Listener> }>();

  constructor(private readonly retention: number = STREAM_RETENTION.eventsPerStream) {}

  private stream(name: string) {
    let stream = this.streams.get(name);
    if (!stream) { stream = { next: 1, events: [], listeners: new Set() }; this.streams.set(name, stream); }
    return stream;
  }

  append(name: string, type: string, data: unknown): LoggedEvent {
    const stream = this.stream(name);
    const event = { id: stream.next, type, data };
    stream.next += 1;
    stream.events.push(event);
    if (stream.events.length > this.retention) stream.events.splice(0, stream.events.length - this.retention);
    for (const listener of stream.listeners) listener(event);
    return event;
  }

  lastId(name: string): number { return this.stream(name).next - 1; }

  /** Events after `since`; `gap` when some of them were already dropped. */
  after(name: string, since: number): { events: LoggedEvent[]; gap: boolean } {
    const stream = this.stream(name);
    const oldest = stream.events[0]?.id ?? stream.next;
    return { events: stream.events.filter((event) => event.id > since), gap: since + 1 < oldest && since < stream.next - 1 };
  }

  subscribe(name: string, listener: Listener): () => void {
    const stream = this.stream(name);
    stream.listeners.add(listener);
    return () => stream.listeners.delete(listener);
  }

  /** Closes every open SSE connection (shutdown, revocation). */
  closeAll(): void {
    for (const stream of this.streams.values()) stream.listeners.clear();
  }
}

export function sseFrame(event: LoggedEvent): string {
  return `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

/** Serves one stream as SSE from the client's last id, then live. Heartbeat comments keep proxies from closing it. */
export function serveSse(request: IncomingMessage, response: ServerResponse, log: EventLog, stream: string, onClose: (close: () => void) => () => void): void {
  const query = new URL(request.url ?? '/', 'http://127.0.0.1').searchParams.get('since');
  const header = request.headers['last-event-id'];
  const since = Math.max(0, Number(Array.isArray(header) ? header[0] : header ?? query ?? log.lastId(stream)) || 0);
  response.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Content-Type-Options': 'nosniff' });
  response.write(': singularity\n\n');
  const backlog = log.after(stream, since);
  if (backlog.gap) response.write(`event: gap\ndata: ${JSON.stringify({ stream, requestedSince: since, resumeFrom: log.lastId(stream) })}\n\n`);
  else for (const event of backlog.events) response.write(sseFrame(event));
  const unsubscribe = log.subscribe(stream, (event) => response.write(sseFrame(event)));
  const heartbeat = setInterval(() => response.write(': ping\n\n'), 15_000);
  heartbeat.unref();
  const close = () => { clearInterval(heartbeat); unsubscribe(); response.end(); };
  const release = onClose(close);
  request.on('close', () => { clearInterval(heartbeat); unsubscribe(); release(); });
}
