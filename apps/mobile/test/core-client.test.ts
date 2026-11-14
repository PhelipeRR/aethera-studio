import { describe, expect, it } from 'vitest';
import { CoreClient } from '../src/core-client';

const task = { id: 'task-1', prompt: 'real', projectId: null, mode: 'auto', access: 'read-only', status: 'completed', parentTaskId: null, threadId: 'thread-1', model: null, summary: 'real task', error: null, agents: [], tokens: { input: null, output: null, cached: null, costUsd: null }, filesChanged: 0, approval: 'not-required', cancellation: 'none', executor: null, externalRef: null, createdBy: { kind: 'device', id: 'device-1', label: 'Mobile' }, correlationId: null, createdAt: '2026-11-10T10:00:00.000Z', startedAt: null, finishedAt: null, lastEventId: 0 };

describe('CoreClient', () => {
  it('lists only data returned by the Core and sends DPoP auth', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new CoreClient({ endpoint: 'https://core.ts.net', accessToken: 'access-token', dpop: async () => 'proof', fetch: async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ items: [task], nextCursor: null }), { status: 200, headers: { 'content-type': 'application/json' } }); } });
    await expect(client.listTasks()).resolves.toHaveLength(1);
    expect(calls[0].init?.headers).toMatchObject({ Authorization: 'DPoP access-token', DPoP: 'proof' });
  });

  it('uses idempotency for task creation and never exposes an executor API', async () => {
    let request: RequestInit | undefined;
    const client = new CoreClient({ endpoint: 'https://core.ts.net', fetch: async (_url, init) => { request = init; return new Response(JSON.stringify({ task, replayed: false }), { status: 201 }); } });
    await client.createTask({ prompt: 'read', projectId: null, mode: 'auto', access: 'read-only' });
    expect(request?.headers).toMatchObject({ 'Idempotency-Key': expect.any(String) });
    expect(Object.keys(client)).not.toContain('execute');
  });

  it('rejects non-Tailscale endpoints before making a request', () => {
    expect(() => new CoreClient({ endpoint: 'https://example.com' })).toThrow();
  });

  it('parses metadata-only push payloads and rejects content-bearing payloads', () => {
    const client = new CoreClient({ endpoint: 'https://core.ts.net' });
    expect(client.parsePushNotification({ v: 1, kind: 'task.completed', taskId: 'task-1', at: '2026-11-10T10:00:00.000Z', coreId: 'core-1' }).kind).toBe('task.completed');
    expect(() => client.parsePushNotification({ v: 1, kind: 'task.completed', taskId: 'task-1', at: '2026-11-10T10:00:00.000Z', coreId: 'core-1', summary: 'secret' })).toThrow();
  });

  it('reads real Core task events from the SSE stream', async () => {
    const event = { v: 1, stream: 'tasks', id: 1, at: '2026-11-10T10:00:00.000Z', correlationId: null, payload: { type: 'task.status', taskId: 'task-1', from: 'running', to: 'completed', error: null } };
    let request: RequestInit | undefined;
    const client = new CoreClient({ endpoint: 'https://core.ts.net', accessToken: 'access-token', dpop: async () => 'proof', fetch: async (_url, init) => { request = init; return new Response(`id: 1\nevent: task.status\ndata: ${JSON.stringify(event)}\n\n`, { status: 200 }); } });
    const events: unknown[] = [];
    await client.subscribeTasks((value) => events.push(value), undefined, 7);
    expect(events).toHaveLength(1);
    expect((events[0] as typeof event).payload.type).toBe('task.status');
    expect(request?.headers).toMatchObject({ 'Last-Event-ID': '7' });
  });
});
