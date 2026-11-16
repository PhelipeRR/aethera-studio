import { randomUUID } from 'node:crypto';

export interface ComfyUiSystemStats {
  system?: {
    os?: string;
    python_version?: string;
    embedded_python?: boolean;
    argv?: string[];
  };
  devices?: Array<{
    name?: string;
    type?: string;
    index?: number;
    vram_total?: number;
    vram_free?: number;
    torch_vram_total?: number;
    torch_vram_free?: number;
  }>;
  [key: string]: unknown;
}

export interface ComfyUiHistoryStatus {
  status_str?: string;
  completed?: boolean;
  messages?: unknown[];
  [key: string]: unknown;
}

export interface ComfyUiHistoryEntry {
  prompt?: unknown[];
  outputs?: Record<string, unknown>;
  status?: ComfyUiHistoryStatus;
  [key: string]: unknown;
}

export interface ComfyUiImageRef {
  filename: string;
  subfolder?: string;
  type?: 'input' | 'output' | 'temp';
}

export interface ComfyUiUploadResult {
  name: string;
  subfolder: string;
  type: 'input' | 'output' | 'temp';
}

export interface ComfyUiClientOptions {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  clientId?: string;
  requestTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

export interface WaitForCompletionOptions {
  pollMs?: number;
  timeoutMs?: number;
}

export function normalizeComfyUiBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('ComfyUI endpoint must be a valid HTTP loopback URL.');
  }
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const loopback = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  if (url.protocol !== 'http:' || !loopback) {
    throw new Error('ComfyUI endpoint must be an HTTP loopback URL.');
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    throw new Error('ComfyUI endpoint must use the root path without query parameters.');
  }
  return url.origin;
}

export class ComfyUiRequestError extends Error {
  readonly status: number;
  readonly url: string;

  constructor(message: string, status: number, url: string) {
    super(message);
    this.name = 'ComfyUiRequestError';
    this.status = status;
    this.url = url;
  }
}

function responseMessage(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as Record<string, unknown>;
  for (const key of ['error', 'message', 'detail']) {
    if (typeof record[key] === 'string' && record[key]) return record[key] as string;
  }
  return undefined;
}

function executionErrorMessage(entry: ComfyUiHistoryEntry): string | undefined {
  const status = entry.status;
  if (!status) return undefined;
  const statusText = status.status_str?.toLowerCase();
  const failed = statusText === 'error' || statusText === 'failed';
  if (!failed) return undefined;
  const messages = Array.isArray(status.messages) ? status.messages : [];
  for (const message of messages) {
    if (Array.isArray(message)) {
      const details = message[1];
      if (details && typeof details === 'object') {
        const exception = (details as Record<string, unknown>).exception_message;
        if (typeof exception === 'string' && exception) return exception;
      }
    }
  }
  return `ComfyUI execution failed${statusText ? ` (${statusText})` : ''}.`;
}

function isCompleted(entry: ComfyUiHistoryEntry): boolean {
  return entry.status?.completed === true || entry.status?.status_str?.toLowerCase() === 'success';
}

export class ComfyUiClient {
  readonly baseUrl: string;
  readonly clientId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: ComfyUiClientOptions) {
    this.baseUrl = normalizeComfyUiBaseUrl(options.baseUrl);
    this.clientId = options.clientId ?? randomUUID();
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async getSystemStats(): Promise<ComfyUiSystemStats> {
    return this.getJson<ComfyUiSystemStats>('/system_stats');
  }

  async getObjectInfo(): Promise<Record<string, unknown>> {
    return this.getJson<Record<string, unknown>>('/object_info');
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.getSystemStats();
      return true;
    } catch {
      return false;
    }
  }

  async queuePrompt(prompt: Record<string, unknown>): Promise<{ prompt_id: string; number?: number; node_errors?: unknown }> {
    const response = await this.request('/prompt', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, client_id: this.clientId }),
    });
    const payload = (await response.json()) as { prompt_id?: unknown; number?: number; node_errors?: unknown };
    if (typeof payload.prompt_id !== 'string' || payload.prompt_id.length === 0) {
      throw new Error('ComfyUI returned no prompt_id.');
    }
    if (payload.node_errors && typeof payload.node_errors === 'object' && Object.keys(payload.node_errors).length > 0) {
      throw new Error(`ComfyUI rejected the workflow: ${JSON.stringify(payload.node_errors)}`);
    }
    return { prompt_id: payload.prompt_id, ...(typeof payload.number === 'number' ? { number: payload.number } : {}), ...(payload.node_errors ? { node_errors: payload.node_errors } : {}) };
  }

  async getHistory(promptId: string): Promise<ComfyUiHistoryEntry | undefined> {
    const history = await this.getJson<Record<string, ComfyUiHistoryEntry>>(`/history/${encodeURIComponent(promptId)}`);
    return history[promptId];
  }

  async waitForCompletion(promptId: string, options?: WaitForCompletionOptions): Promise<ComfyUiHistoryEntry> {
    const pollMs = options?.pollMs ?? 250;
    const timeoutMs = options?.timeoutMs ?? 10 * 60_000;
    const startedAt = Date.now();
    while (Date.now() - startedAt <= timeoutMs) {
      const entry = await this.getHistory(promptId);
      if (entry) {
        const error = executionErrorMessage(entry);
        if (error) throw new Error(error);
        if (isCompleted(entry)) return entry;
      }
      await this.sleep(pollMs);
    }
    throw new Error(`Timed out waiting for ComfyUI prompt ${promptId}.`);
  }

  async getImage(image: ComfyUiImageRef): Promise<Buffer> {
    const query = new URLSearchParams({
      filename: image.filename,
      subfolder: image.subfolder ?? '',
      type: image.type ?? 'output',
    });
    const response = await this.request(`/view?${query.toString()}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async uploadImage(buffer: Buffer, filename: string, subfolder = 'aethera', overwrite = true): Promise<ComfyUiUploadResult> {
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(buffer)]), filename);
    form.append('subfolder', subfolder);
    form.append('overwrite', String(overwrite));
    const response = await this.request('/upload/image', { method: 'POST', body: form });
    const payload = (await response.json()) as Partial<ComfyUiUploadResult>;
    if (typeof payload.name !== 'string' || typeof payload.subfolder !== 'string' || !payload.type) {
      throw new Error('ComfyUI returned an invalid upload reference.');
    }
    return { name: payload.name, subfolder: payload.subfolder, type: payload.type };
  }

  async interrupt(): Promise<void> {
    await this.request('/interrupt', { method: 'POST' });
  }

  async clearQueue(): Promise<void> {
    await this.request('/queue', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ clear: true }),
    });
  }

  async freeMemory(unloadModels = true): Promise<void> {
    await this.request('/free', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ unload_models: unloadModels, free_memory: true }),
    });
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.request(path);
    return (await response.json()) as T;
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, { ...init, signal: controller.signal });
      if (!response.ok) {
        let message: string | undefined;
        try {
          message = responseMessage(await response.clone().json());
        } catch {
          // Keep the HTTP status as the diagnostic when the body is not JSON.
        }
        throw new ComfyUiRequestError(message ?? `ComfyUI request failed with HTTP ${response.status}.`, response.status, `${this.baseUrl}${path}`);
      }
      return response;
    } catch (error) {
      if (error instanceof ComfyUiRequestError) throw error;
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error(`ComfyUI request timed out: ${path}`, { cause: error });
      }
      throw new Error(error instanceof Error ? error.message : String(error), { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
}
