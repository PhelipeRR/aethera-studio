import { describe, expect, it } from 'vitest';
import { taskSchema, type CoreTask, type ExternalRef } from '@neuralbridge/shared/core-api';
import { PAPERCLIP_REQUIRED_SCOPES, PaperclipAdapter, PaperclipAdapterError, type PaperclipIssue } from '../src/integrations/paperclip-adapter.js';

const issue: PaperclipIssue = { id: 'issue-1', companyId: 'company-1', status: 'backlog', statusVersion: 2, title: 'Implement boundary', description: 'Use the existing Core.' };
const task = (id: string, externalRef = { system: 'paperclip', id: 'company-1/issue-1', revision: 2 }): CoreTask => taskSchema.parse({
  id, prompt: issue.title, projectId: null, mode: 'claude', access: 'read-only', status: 'pending', parentTaskId: null, threadId: id,
  model: null, summary: null, error: null, agents: ['claude'], tokens: { input: null, output: null, cached: null, costUsd: null }, filesChanged: 0,
  approval: 'not-required', cancellation: 'none', executor: null, externalRef, createdBy: { kind: 'orchestrator', id: 'paperclip', label: null }, correlationId: null,
  createdAt: '2026-11-10T00:00:00.000Z', startedAt: null, finishedAt: null, lastEventId: 0,
});

function harness() {
  let current = { ...issue };
  const tasks = new Map<string, CoreTask>();
  const core = {
    createTask: async (request: { prompt: string; externalRef: ExternalRef }) => { const created = task('core-1', request.externalRef); tasks.set(created.id, created); return { task: created, replayed: false }; },
    findTask: async (ref: ExternalRef) => [...tasks.values()].find((item) => item.externalRef?.system === ref.system && item.externalRef.id === ref.id && item.externalRef.revision === ref.revision) ?? null,
    cancelTask: async (id: string) => { const previous = tasks.get(id); if (!previous) throw new Error('missing'); const cancelled = task(id, previous.externalRef ?? undefined); const result = { ...cancelled, status: 'cancelled' as const, cancellation: 'acknowledged' as const }; tasks.set(id, result); return result; },
  };
  const paperclip = { getIssue: async () => ({ ...current }), cancelIssue: async () => { current = { ...current, status: 'cancelled', statusVersion: current.statusVersion + 1 }; return { ...current }; } };
  return { adapter: new PaperclipAdapter({ paperclip, core, scopes: PAPERCLIP_REQUIRED_SCOPES }), core, paperclip, tasks };
}

describe('Paperclip adapter', () => {
  it('maps one Paperclip issue to one Core task and reconnects by external_ref', async () => {
    const h = harness();
    const first = await h.adapter.syncIssue(issue.id);
    const second = await h.adapter.syncIssue(issue.id);
    expect(first.task.id).toBe('core-1');
    expect(second).toMatchObject({ replayed: true, task: { id: 'core-1' } });
    expect(await h.adapter.reconcile(issue.id)).toMatchObject({ id: 'core-1' });
    expect(h.tasks.size).toBe(1);
  });

  it('cancels in the Core first and then mirrors cancellation to Paperclip', async () => {
    const h = harness();
    await h.adapter.syncIssue(issue.id);
    const result = await h.adapter.cancel(issue.id, 'user request');
    expect(result).toMatchObject({ id: 'core-1', status: 'cancelled' });
    await expect(h.adapter.syncIssue(issue.id)).rejects.toMatchObject({ code: 'issue_closed' });
    expect((await h.paperclip.getIssue()).status).toBe('cancelled');
  });

  it('fails closed without the minimum scope and for closed issues', async () => {
    const h = harness();
    const readOnly = new PaperclipAdapter({ paperclip: h.paperclip, core: h.core, scopes: ['read'] });
    await expect(readOnly.syncIssue(issue.id)).rejects.toMatchObject({ code: 'missing_scope' });
    h.paperclip.getIssue = async () => ({ ...issue, status: 'cancelled' });
    await expect(h.adapter.syncIssue(issue.id)).rejects.toMatchObject({ code: 'issue_closed' });
  });

  it('does not expose an executor or a checkout operation', () => {
    const h = harness();
    expect('execute' in h.adapter).toBe(false);
    expect('checkout' in h.adapter).toBe(false);
    expect(PaperclipAdapterError).toBeDefined();
  });
});
