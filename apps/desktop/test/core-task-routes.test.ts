import { mkdtempSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService, bearerMatches, EventLog, startServer, type CoreServer } from '@neuralbridge/core';
import { createPrincipalResolver } from '../src/core-host/auth-routes.js';
import { openDatabase, type DatabaseHandle } from '@neuralbridge/database';
import { TaskEngine } from '@neuralbridge/orchestrator';
import { coreErrorSchema, createTaskResponseSchema, taskDetailSchema, taskPageSchema, taskSchema } from '@neuralbridge/shared/core-api';
import { createTaskRoutes } from '../src/core-host/domain.js';
import { createTaskService } from '../src/main/tasks.js';
import { FakeAdapter } from '../../../packages/orchestrator/test/fake-adapter.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../../packages/database/migrations');
const TOKEN = 'a'.repeat(64);
let handle: DatabaseHandle;
let engine: TaskEngine;
let server: CoreServer;

beforeEach(async () => {
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-core-routes-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  const codex = new FakeAdapter('codex', (requestInput) => (requestInput.prompt.includes('LENTO') ? { delayMs: 2_000, text: 'ok' } : { text: 'pronto' }));
  engine = new TaskEngine({ handle, adapters: { claude: new FakeAdapter('claude', []), codex }, availability: async () => ({ claude: true, codex: true }) });
  const service = createTaskService({ handle, engine, notify: () => undefined, attachmentsDir: mkdtempSync(join(tmpdir(), 'nb-att-')) });
  const auth = new AuthService({ handle, coreId: 'core-test', fingerprint: 'f'.repeat(64) });
  const routes = createTaskRoutes({ handle, engine, service, events: new EventLog() }, createPrincipalResolver(auth, (incoming) => bearerMatches(incoming, TOKEN)));
  server = await startServer({ preferredPort: null, instanceId: '0b5f9c1e-6a3e-4a5c-9d2a-1f6c8e2b7a10', health: () => ({ status: 'ok', coreVersion: '0', apiVersions: ['v1'], mode: 'embedded', desktopConnected: true, capabilities: { notifications: false, voice: false, screen: false, hud: false, secrets: false }, startedAt: new Date().toISOString() }), domain: routes.handle });
});
afterEach(async () => { engine.cancelAll(); await engine.idle(); await server.close(); handle.close(); });

function call(method: string, path: string, options: { body?: unknown; key?: string; token?: string | null; headers?: Record<string, string> } = {}): Promise<{ status: number; body: unknown; text: string }> {
  const payload = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body));
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: server.port, method, path, headers: { Host: `127.0.0.1:${server.port}`, ...(options.token === null ? {} : { Authorization: `Bearer ${options.token ?? TOKEN}` }), ...(payload ? { 'Content-Type': 'application/json' } : {}), ...(options.key ? { 'Idempotency-Key': options.key } : {}), ...options.headers } }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { text += chunk; });
      response.on('end', () => { let body: unknown = null; try { body = JSON.parse(text); } catch { /* sse */ } done({ status: response.statusCode ?? 0, body, text }); });
    });
    req.on('error', fail);
    if (payload) req.write(payload);
    req.end();
  });
}

const KEY = '0b5f9c1e-6a3e-4a5c-9d2a-1f6c8e2b7a10';
const create = { prompt: 'Explique o projeto', projectId: null, mode: 'codex', access: 'read-only' };

describe('Core task API (CORE-05)', () => {
  it('requires the desktop bearer on every domain route', async () => {
    for (const token of [null, 'b'.repeat(64)]) {
      const response = await call('GET', '/api/v1/tasks', { token });
      expect(response.status).toBe(401);
      expect(coreErrorSchema.parse(response.body).error.code).toBe('unauthenticated');
    }
  });

  it('creates once per Idempotency-Key, replays, and rejects the same key with another body', async () => {
    expect((await call('POST', '/api/v1/tasks', { body: create })).status).toBe(428);
    const first = await call('POST', '/api/v1/tasks', { body: create, key: KEY });
    expect(first.status).toBe(201);
    const created = createTaskResponseSchema.parse(first.body);
    expect(created.replayed).toBe(false);
    const again = createTaskResponseSchema.parse((await call('POST', '/api/v1/tasks', { body: create, key: KEY })).body);
    expect(again).toMatchObject({ replayed: true, task: { id: created.task.id } });
    expect((await call('POST', '/api/v1/tasks', { body: { ...create, prompt: 'outro' }, key: KEY })).status).toBe(409);
    await engine.idle();
    expect(taskPageSchema.parse((await call('GET', '/api/v1/tasks')).body).items).toHaveLength(1);
  });

  it('answers detail, list and commands in the contract shapes, refusing impossible transitions', async () => {
    const { task } = createTaskResponseSchema.parse((await call('POST', '/api/v1/tasks', { body: create, key: KEY })).body);
    await engine.idle();
    const detail = taskDetailSchema.parse((await call('GET', `/api/v1/tasks/${task.id}`)).body);
    expect(detail).toMatchObject({ status: 'completed', access: 'read-only', createdBy: { kind: 'desktop' }, executor: null });
    expect(detail.steps.length).toBeGreaterThan(0);
    const cancel = await call('POST', `/api/v1/tasks/${task.id}/cancel`, { body: {}, key: 'k'.repeat(20) });
    expect(cancel.status).toBe(409);
    expect(coreErrorSchema.parse(cancel.body).error.code).toBe('invalid_transition');
    expect((await call('GET', '/api/v1/tasks/nao-existe')).status).toBe(404);
  });

  it('shows the executor lease while running and cancels through the API', async () => {
    const { task } = createTaskResponseSchema.parse((await call('POST', '/api/v1/tasks', { body: { ...create, prompt: 'Analise LENTO' }, key: KEY })).body);
    expect(task.executor?.instanceId).toBeTruthy();
    const cancelled = taskSchema.parse((await call('POST', `/api/v1/tasks/${task.id}/cancel`, { body: { reason: 'teste' }, key: 'c'.repeat(20) })).body);
    expect(cancelled.cancellation).not.toBe('none');
    await engine.idle();
    expect(taskDetailSchema.parse((await call('GET', `/api/v1/tasks/${task.id}`)).body).status).toBe('cancelled');
  });

  it('streams task events as SSE and resumes after Last-Event-ID', async () => {
    const { task } = createTaskResponseSchema.parse((await call('POST', '/api/v1/tasks', { body: create, key: KEY })).body);
    await engine.idle();
    const full = await new Promise<string>((done) => {
      const req = request({ host: '127.0.0.1', port: server.port, path: `/api/v1/streams/task:${task.id}?since=0`, headers: { Host: `127.0.0.1:${server.port}`, Authorization: `Bearer ${TOKEN}` } }, (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => { text += chunk; if (text.includes('event: task.completed')) { req.destroy(); done(text); } });
      });
      req.end();
    });
    const ids = [...full.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
    expect(ids.length).toBeGreaterThan(1);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
    expect(full).toContain('event: task.status');
    const resumed = await new Promise<string>((done) => {
      const req = request({ host: '127.0.0.1', port: server.port, path: `/api/v1/streams/task:${task.id}`, headers: { Host: `127.0.0.1:${server.port}`, Authorization: `Bearer ${TOKEN}`, 'Last-Event-ID': String(ids.at(-2)) } }, (response) => {
        let text = '';
        response.setEncoding('utf8');
        response.on('data', (chunk: string) => { text += chunk; });
        setTimeout(() => { req.destroy(); done(text); }, 300);
      });
      req.end();
    });
    expect([...resumed.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]))).toEqual([ids.at(-1)]);
  });

  it('accepts the desktop adapter commands with the IPC schemas and rejects unknown ones', async () => {
    const started = await call('POST', '/internal/v1/tasks/start', { body: create });
    expect(started.status).toBe(200);
    expect((started.body as { id: string }).id).toBeTruthy();
    expect((await call('POST', '/internal/v1/tasks/start', { body: { ...create, mode: 'rm -rf' } })).status).toBe(400);
    expect((await call('POST', '/internal/v1/tasks/run-shell', { body: {} })).status).toBe(404);
    await engine.idle();
  });
});
