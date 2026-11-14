import { createHash } from 'node:crypto';
import { externalRefSchema, taskSchema, type CoreTask, type ExternalRef } from '@neuralbridge/shared/core-api';
import { z } from 'zod';

export const PAPERCLIP_REQUIRED_SCOPES = ['read', 'task:create', 'task:cancel'] as const;
export type PaperclipScope = (typeof PAPERCLIP_REQUIRED_SCOPES)[number];

const issueSchema = z.strictObject({
  id: z.string().min(1).max(128),
  companyId: z.string().min(1).max(128),
  status: z.string().min(1).max(40),
  statusVersion: z.number().int().nonnegative(),
  title: z.string().min(1).max(20_000),
  description: z.string().max(20_000).optional(),
});
export type PaperclipIssue = z.infer<typeof issueSchema>;

export interface PaperclipIssuePort {
  getIssue(issueId: string): Promise<PaperclipIssue>;
  cancelIssue(issueId: string): Promise<PaperclipIssue>;
}

export interface CoreOrchestratorPort {
  createTask(request: { prompt: string; externalRef: ExternalRef }, idempotencyKey: string): Promise<{ task: CoreTask; replayed: boolean }>;
  findTask(externalRef: ExternalRef): Promise<CoreTask | null>;
  cancelTask(taskId: string, reason?: string): Promise<CoreTask>;
}

export interface PaperclipAdapterOptions {
  paperclip: PaperclipIssuePort;
  core: CoreOrchestratorPort;
  scopes: Iterable<string>;
}

export class PaperclipAdapterError extends Error {
  constructor(readonly code: 'missing_scope' | 'issue_closed' | 'paperclip_conflict' | 'core_conflict', message: string) {
    super(message);
    this.name = 'PaperclipAdapterError';
  }
}

const idempotencyKeyFor = (ref: ExternalRef): string => createHash('sha256').update(`paperclip\0${ref.id}\0${ref.revision}`).digest('hex');

/**
 * The definitive 50.10 boundary: Paperclip plans and reflects state; the Core creates, executes and cancels tasks.
 * This class deliberately has no checkout, heartbeat executor or agent adapter dependency.
 */
export class PaperclipAdapter {
  private readonly scopes: ReadonlySet<string>;

  constructor(private readonly options: PaperclipAdapterOptions) {
    this.scopes = new Set(options.scopes);
  }

  private require(scope: PaperclipScope): void {
    if (!this.scopes.has(scope)) throw new PaperclipAdapterError('missing_scope', `Paperclip adapter lacks ${scope}.`);
  }

  private externalRef(issue: PaperclipIssue): ExternalRef {
    return externalRefSchema.parse({ system: 'paperclip', id: `${issue.companyId}/${issue.id}`, revision: issue.statusVersion });
  }

  async syncIssue(issueId: string): Promise<{ task: CoreTask; replayed: boolean }> {
    this.require('task:create');
    const issue = await this.options.paperclip.getIssue(issueId);
    if (['cancelled', 'done', 'completed'].includes(issue.status.toLowerCase())) throw new PaperclipAdapterError('issue_closed', 'A issue fechada não pode iniciar uma tarefa no Core.');
    const externalRef = this.externalRef(issue);
    const existing = await this.options.core.findTask(externalRef);
    if (existing) return { task: taskSchema.parse(existing), replayed: true };
    return this.options.core.createTask({ prompt: [issue.title, issue.description].filter(Boolean).join('\n\n'), externalRef }, idempotencyKeyFor(externalRef));
  }

  async reconcile(issueId: string): Promise<CoreTask | null> {
    this.require('read');
    const issue = await this.options.paperclip.getIssue(issueId);
    return this.options.core.findTask(this.externalRef(issue));
  }

  async cancel(issueId: string, reason = 'Cancelado no Paperclip.'): Promise<CoreTask | null> {
    this.require('task:cancel');
    const issue = await this.options.paperclip.getIssue(issueId);
    const task = await this.options.core.findTask(this.externalRef(issue));
    if (!task) return null;
    const cancelled = await this.options.core.cancelTask(task.id, reason);
    await this.options.paperclip.cancelIssue(issueId);
    return cancelled;
  }
}

export interface PaperclipHttpClientOptions {
  baseUrl: string;
  token: string;
  fetch?: typeof fetch;
}

async function jsonResponse(response: Response): Promise<unknown> {
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new PaperclipAdapterError(response.status === 409 ? 'paperclip_conflict' : 'core_conflict', `Paperclip/Core respondeu HTTP ${response.status}.`);
  return body;
}

/** Minimal HTTP boundary. Tokens stay in this process and are never returned to the renderer. */
export function createPaperclipHttpClient(options: PaperclipHttpClientOptions): PaperclipIssuePort {
  const request = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/u, '');
  const headers = { authorization: `Bearer ${options.token}`, accept: 'application/json', 'content-type': 'application/json' };
  return {
    async getIssue(issueId) {
      return issueSchema.parse(await jsonResponse(await request(`${base}/api/issues/${encodeURIComponent(issueId)}`, { headers })));
    },
    async cancelIssue(issueId) {
      return issueSchema.parse(await jsonResponse(await request(`${base}/api/issues/${encodeURIComponent(issueId)}`, { method: 'PATCH', headers, body: JSON.stringify({ status: 'cancelled' }) })));
    },
  };
}

export interface CoreHttpClientOptions extends PaperclipHttpClientOptions {
  paperclipSystem?: string;
}

export function createCoreOrchestratorClient(options: CoreHttpClientOptions): CoreOrchestratorPort {
  const request = options.fetch ?? fetch;
  const base = options.baseUrl.replace(/\/$/u, '');
  const system = options.paperclipSystem ?? 'paperclip';
  const headers = { authorization: `Bearer ${options.token}`, accept: 'application/json', 'content-type': 'application/json' };
  const body = async (response: Response): Promise<unknown> => jsonResponse(response);
  return {
    async createTask(requestBody, idempotencyKey) {
      const result = await body(await request(`${base}/api/v1/tasks`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': idempotencyKey }, body: JSON.stringify({ prompt: requestBody.prompt, projectId: null, mode: 'claude', access: 'read-only', externalRef: requestBody.externalRef }) }));
      const parsed = z.strictObject({ task: taskSchema, replayed: z.boolean() }).parse(result);
      return parsed;
    },
    async findTask(externalRef) {
      const url = `${base}/api/v1/tasks?externalSystem=${encodeURIComponent(system)}&limit=20`;
      const result = z.strictObject({ items: z.array(taskSchema), nextCursor: z.string().nullable() }).parse(await body(await request(url, { headers })));
      return result.items.find((task) => task.externalRef?.system === externalRef.system && task.externalRef.id === externalRef.id) ?? null;
    },
    async cancelTask(taskId, reason) {
      return taskSchema.parse(await body(await request(`${base}/api/v1/tasks/${encodeURIComponent(taskId)}/cancel`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': `paperclip-cancel-${taskId}`, }, body: JSON.stringify(reason ? { reason } : {}) })));
    },
  };
}
