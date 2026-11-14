import {
  createTaskResponseSchema,
  pairingClaimResponseSchema,
  pairingStatusSchema,
  taskDetailSchema,
  taskPageSchema,
  taskSchema,
  tokenResponseSchema,
  healthSchema,
  memorySearchResponseSchema,
  eventEnvelopeSchema,
  pushNotificationSchema,
  privateEndpointSchema,
  type CoreTask,
  type CreateTaskRequest,
  type TokenResponse,
  type CoreEvent,
} from '@neuralbridge/shared/core-api';
import { parseSseBuffer } from './sse';

export type DpopProof = (input: { method: string; url: string; accessToken?: string }) => Promise<string>;
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export type PairingClaimRequest = {
  code: string;
  deviceName: string;
  platform: 'ios' | 'android';
  appVersion: string;
  publicKey: { kty: 'EC'; crv: 'P-256'; x: string; y: string };
};

export class CoreClientError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'CoreClientError';
  }
}

export interface CoreClientOptions {
  endpoint: string;
  fetch?: FetchLike;
  accessToken?: string;
  dpop?: DpopProof;
}

const idempotencyKey = (): string => crypto.randomUUID();

export class CoreClient {
  private readonly endpoint: string;
  private readonly fetcher: FetchLike;
  private readonly accessToken?: string;
  private readonly dpop?: DpopProof;

  constructor(options: CoreClientOptions) {
    this.endpoint = options.endpoint.replace(/\/$/, '');
    privateEndpointSchema.parse(this.endpoint);
    this.fetcher = options.fetch ?? fetch;
    this.accessToken = options.accessToken;
    this.dpop = options.dpop;
  }

  async listTasks(): Promise<CoreTask[]> {
    const response = await this.request('/api/v1/tasks?limit=20', 'GET');
    return taskPageSchema.parse(await response.json()).items;
  }

  async getTask(id: string): Promise<CoreTask> {
    const response = await this.request(`/api/v1/tasks/${encodeURIComponent(id)}`, 'GET');
    return taskDetailSchema.parse(await response.json());
  }

  async createTask(input: CreateTaskRequest): Promise<{ task: CoreTask; replayed: boolean }> {
    const response = await this.request('/api/v1/tasks', 'POST', input, true);
    return createTaskResponseSchema.parse(await response.json());
  }

  async cancelTask(id: string, reason?: string): Promise<CoreTask> {
    const response = await this.request(`/api/v1/tasks/${encodeURIComponent(id)}/cancel`, 'POST', { reason }, true);
    return taskSchema.parse(await response.json());
  }

  async approveTask(id: string, decision: 'approve' | 'reject', comment?: string): Promise<CoreTask> {
    const response = await this.request(`/api/v1/tasks/${encodeURIComponent(id)}/approval`, 'POST', { decision, comment }, true);
    return taskSchema.parse(await response.json());
  }

  async continueTask(id: string, prompt: string): Promise<{ task: CoreTask; replayed: boolean }> {
    const response = await this.request(`/api/v1/tasks/${encodeURIComponent(id)}/messages`, 'POST', { prompt }, true);
    return createTaskResponseSchema.parse(await response.json());
  }

  async searchMemories(query: string): Promise<ReturnType<typeof memorySearchResponseSchema.parse>> {
    const response = await this.request('/api/v1/memories/search', 'POST', { query, limit: 8, mode: 'hybrid' });
    return memorySearchResponseSchema.parse(await response.json());
  }

  async subscribeTasks(onEvent: (event: CoreEvent) => void, signal?: AbortSignal, lastEventId = 0): Promise<void> {
    const response = await this.request('/api/v1/streams/tasks', 'GET', undefined, false, true, false, 'text/event-stream', signal, lastEventId > 0 ? { 'Last-Event-ID': String(lastEventId) } : undefined);
    if (!response.body) throw new CoreClientError(response.status, 'Core não disponibilizou o stream de tarefas.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffer += decoder.decode(chunk.value, { stream: true });
      const parsed = parseSseBuffer(buffer);
      buffer = parsed.rest;
      for (const frame of parsed.events) {
        const result = eventEnvelopeSchema.safeParse(JSON.parse(frame.data));
        if (result.success) onEvent(result.data);
      }
    }
  }

  async health(): Promise<ReturnType<typeof healthSchema.parse>> {
    const response = await this.request('/api/v1/health', 'GET', undefined, false, false);
    return healthSchema.parse(await response.json());
  }

  parsePushNotification(payload: unknown): ReturnType<typeof pushNotificationSchema.parse> {
    return pushNotificationSchema.parse(payload);
  }

  async claimPairing(input: PairingClaimRequest): Promise<{ pairingId: string; status: 'awaiting_confirmation'; pollAfterMs: number }> {
    const response = await this.request('/api/v1/pairing/claim', 'POST', input, true, false);
    return pairingClaimResponseSchema.parse(await response.json());
  }

  async pairingStatus(id: string): Promise<{ pairingId: string; state: string; deviceId: string | null }> {
    const response = await this.request(`/api/v1/pairing/${encodeURIComponent(id)}`, 'GET', undefined, false, false);
    return pairingStatusSchema.parse(await response.json());
  }

  async exchangeToken(input: { grantType: 'pairing'; pairingId: string } | { grantType: 'refresh_token'; refreshToken: string }): Promise<TokenResponse> {
    const response = await this.request('/api/v1/auth/token', 'POST', input, false, false, true);
    return tokenResponseSchema.parse(await response.json());
  }

  private async request(path: string, method: string, body?: unknown, idempotent = false, authenticated = true, proofOnly = false, accept = 'application/json', signal?: AbortSignal, extraHeaders?: Record<string, string>): Promise<Response> {
    const url = `${this.endpoint}${path}`;
    const headers: Record<string, string> = { Accept: accept };
    Object.assign(headers, extraHeaders);
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (idempotent) headers['Idempotency-Key'] = idempotencyKey();
    if (authenticated && this.accessToken) {
      headers.Authorization = `DPoP ${this.accessToken}`;
      if (this.dpop) headers.DPoP = await this.dpop({ method, url, accessToken: this.accessToken });
    } else if (proofOnly && this.dpop) {
      headers.DPoP = await this.dpop({ method, url });
    }
    const response = await this.fetcher(url, { method, headers, signal, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new CoreClientError(response.status, `Core request failed (${response.status})`);
    return response;
  }
}
