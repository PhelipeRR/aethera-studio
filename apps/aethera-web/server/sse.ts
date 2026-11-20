import type { Response } from 'express';

export interface SseClient {
  id: string;
  res: Response;
}

export class SseHub {
  private clients = new Map<string, SseClient>();

  public attach(res: Response): string {
    const id = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    this.clients.set(id, { id, res });
    this.sendTo(res, 'connected', { clientId: id, timestamp: new Date().toISOString() });

    const keepAlive = setInterval(() => {
      if (res.writableEnded) {
        clearInterval(keepAlive);
        this.clients.delete(id);
        return;
      }
      res.write(': keepalive\n\n');
    }, 20_000);

    res.on('close', () => {
      clearInterval(keepAlive);
      this.clients.delete(id);
    });

    return id;
  }

  public broadcast(event: string, data: unknown): void {
    for (const [id, client] of this.clients.entries()) {
      if (client.res.writableEnded) {
        this.clients.delete(id);
        continue;
      }
      this.sendTo(client.res, event, data);
    }
  }

  public clientCount(): number {
    return this.clients.size;
  }

  private sendTo(res: Response, event: string, data: unknown): void {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      // Client disconnected mid-write.
    }
  }
}
