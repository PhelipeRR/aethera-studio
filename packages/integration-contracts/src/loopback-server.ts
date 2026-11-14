import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  CONTRACT_SCHEMA_VERSION,
  INTEGRATION_ENDPOINTS,
  delegatedTaskRequestSchema,
  type IntegrationAuthRegistry,
  type AppId,
  type DelegatedTaskStatus,
  type IAgentProviderContract,
  type IntegrationEvent,
  type IntegrationScope,
} from './index.js';

export interface LoopbackIntegrationServerOptions {
  appId: AppId;
  version: string;
  capabilities: readonly string[];
  agents: readonly IAgentProviderContract[];
  auth?: IntegrationAuthRegistry;
  requireAuth?: boolean;
  ipcPath?: string;
  onTask?: (input: {
    taskId: string;
    kind: string;
    capability: string;
    input: Record<string, unknown>;
    agent: IAgentProviderContract;
  }) => Promise<{ ok: boolean; output?: Record<string, unknown>; error?: string }>;
}

export interface LoopbackIntegrationServerHandle {
  baseUrl: string;
  port: number;
  ipcPath?: string;
  close(): Promise<void>;
  emitEvent(event: IntegrationEvent): void;
  getTask(taskId: string): DelegatedTaskStatus | null;
  dispatch(input: { method: string; url: string; body?: unknown; authorization?: string }): Promise<{ status: number; body: unknown }>;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/**
 * Real loopback HTTP/SSE integration server (127.0.0.1, ephemeral port) implementing SEP-02 contracts.
 */
export async function startLoopbackIntegrationServer(
  options: LoopbackIntegrationServerOptions,
): Promise<LoopbackIntegrationServerHandle> {
  const tasks = new Map<string, DelegatedTaskStatus>();
  const idempotency = new Map<string, DelegatedTaskStatus>();
  const sseClients = new Set<ServerResponse>();

  const emitEvent = (event: IntegrationEvent) => {
    const line = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      if (!client.writableEnded) client.write(line);
    }
  };

  const checkScope = (req: IncomingMessage, res: ServerResponse, scope: IntegrationScope): boolean => {
    if (!options.requireAuth || !options.auth) return true;
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const verdict = options.auth.authorize(token, scope);
    if (!verdict.ok) {
      sendJson(res, verdict.reason === 'forbidden_scope' ? 403 : 401, { error: verdict.reason });
      return false;
    }
    return true;
  };

  const server: Server = createServer(async (req, res) => {
    const url = (req.url ?? '/').split('?')[0] ?? '/';
    const method = req.method ?? 'GET';

    if (method === 'GET' && url === INTEGRATION_ENDPOINTS.health) {
      if (!checkScope(req, res, 'health:read')) return;
      sendJson(res, 200, {
        appId: options.appId,
        version: options.version,
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        status: 'ok',
        standalone: true,
        timestampIso: new Date().toISOString(),
      });
      return;
    }

    if (method === 'GET' && url === INTEGRATION_ENDPOINTS.capabilities) {
      if (!checkScope(req, res, 'capabilities:read')) return;
      const availableAgents = [];
      for (const agent of options.agents) {
        if (await agent.isAvailable()) availableAgents.push(agent.id);
      }
      sendJson(res, 200, {
        appId: options.appId,
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        capabilities: [...options.capabilities],
        availableAgents,
      });
      return;
    }

    if (method === 'GET' && url === INTEGRATION_ENDPOINTS.events) {
      if (!checkScope(req, res, 'events:subscribe')) return;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.write(': connected\n\n');
      sseClients.add(res);
      req.on('close', () => sseClients.delete(res));
      return;
    }

    if (method === 'GET' && url.startsWith(`${INTEGRATION_ENDPOINTS.tasks}/`)) {
      if (!checkScope(req, res, 'tasks:read')) return;
      const taskId = decodeURIComponent(url.slice(`${INTEGRATION_ENDPOINTS.tasks}/`.length));
      const found = tasks.get(taskId);
      if (!found) {
        sendJson(res, 404, { error: 'task_not_found' });
        return;
      }
      sendJson(res, 200, found);
      return;
    }

    if (method === 'POST' && url === INTEGRATION_ENDPOINTS.tasks) {
      if (!checkScope(req, res, 'tasks:delegate')) return;
      try {
        const parsed = delegatedTaskRequestSchema.parse(await readJsonBody(req));
        const cached = idempotency.get(parsed.envelope.idempotencyKey);
        if (cached) {
          sendJson(res, 200, cached);
          return;
        }

        let chosen: IAgentProviderContract | null = null;
        for (const agent of options.agents) {
          if ((await agent.isAvailable()) && agent.getCapabilities().includes(parsed.capability)) {
            chosen = agent;
            break;
          }
        }
        if (!chosen) {
          for (const agent of options.agents) {
            if (await agent.isAvailable()) {
              chosen = agent;
              break;
            }
          }
        }

        if (!chosen) {
          const failed: DelegatedTaskStatus = {
            taskId: parsed.envelope.requestId,
            status: 'failed',
            error: 'no_capable_agent_available',
          };
          tasks.set(failed.taskId, failed);
          idempotency.set(parsed.envelope.idempotencyKey, failed);
          sendJson(res, 503, failed);
          return;
        }

        const exec = options.onTask
          ? await options.onTask({
              taskId: parsed.envelope.requestId,
              kind: parsed.kind,
              capability: parsed.capability,
              input: parsed.input,
              agent: chosen,
            })
          : await chosen
              .execute({
                taskId: parsed.envelope.requestId,
                capability: parsed.capability,
                prompt: JSON.stringify(parsed.input),
              })
              .then((r) => ({ ok: r.ok, output: { text: r.output }, ...(r.error ? { error: r.error } : {}) }));

        const status: DelegatedTaskStatus = {
          taskId: parsed.envelope.requestId,
          status: exec.ok ? 'completed' : 'failed',
          executedByAgent: chosen.id,
          ...(exec.output ? { output: exec.output } : {}),
          ...(exec.error ? { error: exec.error } : {}),
        };
        tasks.set(status.taskId, status);
        idempotency.set(parsed.envelope.idempotencyKey, status);
        emitEvent({
          eventId: `evt-${Date.now()}`,
          type: exec.ok ? 'task.completed' : 'task.failed',
          originApp: options.appId,
          correlationId: parsed.envelope.correlationId,
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          occurredAtIso: new Date().toISOString(),
          payload: { taskId: status.taskId, status: status.status },
        });
        sendJson(res, 200, status);
      } catch (err) {
        sendJson(res, 400, { error: err instanceof Error ? err.message : 'invalid_request' });
      }
      return;
    }

    sendJson(res, 404, { error: 'not_found' });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    if (options.ipcPath) {
      server.listen(options.ipcPath, () => resolve());
    } else {
      server.listen(0, '127.0.0.1', () => resolve());
    }
  });

  const addr = options.ipcPath ? null : (server.address() as AddressInfo);
  const dispatch = async (input: { method: string; url: string; body?: unknown; authorization?: string }): Promise<{ status: number; body: unknown }> => {
    const url = input.url.split('?')[0] ?? '/';
    const method = input.method.toUpperCase();
    const authOk = (scope: IntegrationScope): { status: number; body: unknown } | null => {
      if (!options.requireAuth || !options.auth) return null;
      const header = input.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      const verdict = options.auth.authorize(token, scope);
      if (!verdict.ok) {
        return { status: verdict.reason === 'forbidden_scope' ? 403 : 401, body: { error: verdict.reason } };
      }
      return null;
    };
    if (method === 'GET' && url === INTEGRATION_ENDPOINTS.health) {
      const denied = authOk('health:read');
      if (denied) return denied;
      return {
        status: 200,
        body: { appId: options.appId, version: options.version, schemaVersion: CONTRACT_SCHEMA_VERSION, status: 'ok', standalone: true, timestampIso: new Date().toISOString() },
      };
    }
    if (method === 'GET' && url === INTEGRATION_ENDPOINTS.capabilities) {
      const denied = authOk('capabilities:read');
      if (denied) return denied;
      const availableAgents = [];
      for (const agent of options.agents) {
        if (await agent.isAvailable()) availableAgents.push(agent.id);
      }
      return { status: 200, body: { appId: options.appId, schemaVersion: CONTRACT_SCHEMA_VERSION, capabilities: [...options.capabilities], availableAgents } };
    }
    if (method === 'POST' && url === INTEGRATION_ENDPOINTS.tasks) {
      const denied = authOk('tasks:delegate');
      if (denied) return denied;
      const parsed = delegatedTaskRequestSchema.parse(input.body);
      const cached = idempotency.get(parsed.envelope.idempotencyKey);
      if (cached) return { status: 200, body: cached };
      let chosen: IAgentProviderContract | null = null;
      for (const agent of options.agents) {
        if ((await agent.isAvailable()) && agent.getCapabilities().includes(parsed.capability)) {
          chosen = agent;
          break;
        }
      }
      if (!chosen) {
        for (const agent of options.agents) {
          if (await agent.isAvailable()) {
            chosen = agent;
            break;
          }
        }
      }
      if (!chosen) {
        const failed: DelegatedTaskStatus = { taskId: parsed.envelope.requestId, status: 'failed', error: 'no_capable_agent_available' };
        tasks.set(failed.taskId, failed);
        idempotency.set(parsed.envelope.idempotencyKey, failed);
        return { status: 503, body: failed };
      }
      const exec = await chosen.execute({ taskId: parsed.envelope.requestId, capability: parsed.capability, prompt: JSON.stringify(parsed.input) });
      const status: DelegatedTaskStatus = {
        taskId: parsed.envelope.requestId,
        status: exec.ok ? 'completed' : 'failed',
        executedByAgent: chosen.id,
        ...(exec.ok ? { output: { text: exec.output } } : { error: exec.error ?? 'execution_failed' }),
      };
      tasks.set(status.taskId, status);
      idempotency.set(parsed.envelope.idempotencyKey, status);
      return { status: 200, body: status };
    }
    return { status: 404, body: { error: 'not_found' } };
  };
  return {
    baseUrl: options.ipcPath ? `ipc://${options.ipcPath}` : `http://127.0.0.1:${addr?.port ?? 0}`,
    port: addr?.port ?? 0,
    ...(options.ipcPath ? { ipcPath: options.ipcPath } : {}),
    emitEvent,
    getTask: (taskId) => tasks.get(taskId) ?? null,
    dispatch,
    close: async () => {
      for (const client of sseClients) {
        client.end();
      }
      sseClients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
