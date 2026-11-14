import { describe, expect, it } from 'vitest';
import { IpcChannel, parseIpcInput, RUN_MODES, STEP_KINDS, TASK_STATUSES, MEMORY_TYPES, type TaskStatus } from '../src/index.js';
import {
  canTransition,
  checkSequence,
  clientMessageSchema,
  commandAllowed,
  createTaskRequestSchema,
  eventEnvelopeSchema,
  FIELD_OWNERSHIP,
  FINAL_STATUSES,
  memorySearchRequestSchema,
  ORCHESTRATOR_RULES,
  projectSearchResponseSchema,
  pushNotificationSchema,
  readEvent,
  serverMessageSchema,
  sseFrame,
  TASK_TRANSITIONS,
  taskSchema,
  transportDescriptorSchema,
  updateMemoryRequestSchema,
  writeMemoryRequestSchema,
  WS,
  type CoreEvent,
  type CoreTask,
} from '../src/core-api/index.js';

const task: CoreTask = {
  id: '0b5f9c1e-6a3e-4a5c-9d2a-1f6c8e2b7a10', prompt: 'Revise o README', projectId: 'p1', mode: 'auto', access: 'read-only', status: 'running',
  parentTaskId: null, threadId: '0b5f9c1e-6a3e-4a5c-9d2a-1f6c8e2b7a10', model: null, summary: null, error: null, agents: ['claude'],
  tokens: { input: 10, output: 5, cached: null, costUsd: null }, filesChanged: 0, approval: 'not-required', cancellation: 'none',
  executor: { instanceId: 'core-1', leaseExpiresAt: '2026-11-09T12:01:00.000Z', attempt: 1 }, externalRef: null,
  createdBy: { kind: 'device', id: 'dev-1', label: 'iPhone' }, correlationId: 'corr-12345678', createdAt: '2026-11-09T12:00:00.000Z',
  startedAt: '2026-11-09T12:00:01.000Z', finishedAt: null, lastEventId: 7,
};
const event = (id: number, payload: CoreEvent['payload']): CoreEvent => ({ v: 1, stream: `task:${task.id}`, id, at: '2026-11-09T12:00:02.000Z', correlationId: null, payload });

describe('core-api tasks', () => {
  it('speaks the same vocabularies as the database and the IPC', () => {
    expect(taskSchema.shape.status.options).toEqual([...TASK_STATUSES]);
    expect(taskSchema.shape.mode.options).toEqual([...RUN_MODES]);
    expect(writeMemoryRequestSchema.shape.type.options).toEqual([...MEMORY_TYPES]);
    expect(STEP_KINDS.length).toBeGreaterThan(0);
  });

  it('accepts what the desktop sends today and rejects what the IPC rejects', () => {
    const input = { prompt: 'Corrija o teste', projectId: 'p1', mode: 'codex', access: 'edit', model: 'gpt-5.1-codex', skillIds: ['remotion'], participants: ['p2'] } as const;
    expect(parseIpcInput(IpcChannel.tasksStart, input)).toBeTruthy();
    expect(createTaskRequestSchema.parse(input)).toEqual(input);
    for (const bad of [{ ...input, prompt: ' ' }, { ...input, prompt: 'x'.repeat(20_001) }, { ...input, model: 'gpt; rm -rf /' }]) {
      expect(() => parseIpcInput(IpcChannel.tasksStart, bad)).toThrow();
      expect(createTaskRequestSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('is strict about unknown fields and validates external references', () => {
    const base = { prompt: 'x', projectId: null, mode: 'auto' };
    expect(createTaskRequestSchema.safeParse({ ...base, executor: 'paperclip' }).success).toBe(false);
    expect(createTaskRequestSchema.safeParse({ ...base, externalRef: { system: 'paperclip', id: 'ISSUE-42', revision: 3 } }).success).toBe(true);
    expect(createTaskRequestSchema.safeParse({ ...base, externalRef: { system: 'Paper Clip', id: 'x', revision: 0 } }).success).toBe(false);
    expect(createTaskRequestSchema.safeParse({ ...base, limits: { maxCostUsd: 0 } }).success).toBe(false);
    expect(taskSchema.safeParse(task).success).toBe(true);
  });

  it('never reopens a final task and only returns a paused task to pending', () => {
    for (const status of FINAL_STATUSES) expect(TASK_TRANSITIONS[status]).toEqual([]);
    for (const from of TASK_STATUSES) expect(canTransition(from, 'pending')).toBe(from === 'paused');
    // Sequences TaskEngine produces today (engine.ts setStatus/finish call sites).
    const observed: Array<[TaskStatus, TaskStatus]> = [['pending', 'running'], ['pending', 'planning'], ['pending', 'awaiting_approval'], ['awaiting_approval', 'running'], ['planning', 'awaiting_approval'], ['running', 'planning'], ['running', 'validating'], ['validating', 'running'], ['running', 'paused'], ['paused', 'running'], ['planning', 'paused'], ['running', 'completed'], ['validating', 'failed'], ['awaiting_approval', 'cancelled']];
    for (const [from, to] of observed) expect(canTransition(from, to), `${from} → ${to}`).toBe(true);
    expect(canTransition('completed', 'running')).toBe(false);
    expect(canTransition('running', 'running')).toBe(false);
  });

  it('accepts commands only in the statuses where TaskEngine honours them', () => {
    expect(commandAllowed('approve', 'awaiting_approval')).toBe(true);
    expect(commandAllowed('approve', 'running')).toBe(false);
    expect(commandAllowed('cancel', 'completed')).toBe(false);
    expect(commandAllowed('recover', 'failed')).toBe(true);
    expect(commandAllowed('resumePaused', 'paused')).toBe(true);
  });
});

describe('core-api events and streams', () => {
  it('validates every envelope and keeps per-stream ids strictly increasing', () => {
    const samples: CoreEvent['payload'][] = [
      { type: 'task.created', task },
      { type: 'task.status', taskId: task.id, from: 'pending', to: 'running', error: null },
      { type: 'task.log', taskId: task.id, stepId: null, kind: 'rag_context', text: 'contexto', data: { hits: 3 } },
      { type: 'task.approval_required', taskId: task.id, reasons: ['git push'] },
      { type: 'task.lease', taskId: task.id, executor: null },
      { type: 'task.cancelled', taskId: task.id, reason: null },
      { type: 'task.failed', taskId: task.id, error: 'timeout', recoverable: true },
      { type: 'memory.recalled', memoryId: 'm1', client: 'Claude Code', taskId: null },
      { type: 'index.progress', jobId: 'j1', target: 'project', projectId: 'p1', done: 3, total: 10, state: 'running' },
      { type: 'metrics.sample', sample: { seq: 1, at: 1_789_000_000_000, cpu: { utilization: 12, frequencyMhz: 3800, temperatureC: null }, memory: { usedBytes: 1, availableBytes: 1, totalBytes: 2 }, gpu: { utilization: null, temperatureC: null, vramUsedBytes: null, vramTotalBytes: null }, disk: { busy: 1, readBytesPerSec: 0, writeBytesPerSec: 0 }, network: { downBytesPerSec: 0, upBytesPerSec: 0, linkBitsPerSec: null }, app: { cpuPercent: 0.2, memoryBytes: 1 }, overhead: { cpuPercent: 0.1, memoryBytes: 1 } } },
      { type: 'system.capability', capability: 'notifications', available: false },
    ];
    samples.forEach((payload, index) => expect(eventEnvelopeSchema.safeParse(event(index + 1, payload)).success, payload.type).toBe(true));
    expect(eventEnvelopeSchema.safeParse({ ...event(1, { type: 'task.cancelled', taskId: task.id, reason: null }), stream: 'task:../x' }).success).toBe(false);
    expect(checkSequence(7, { id: 8 })).toBe('next');
    expect(checkSequence(7, { id: 7 })).toBe('duplicate');
    expect(checkSequence(7, { id: 10 })).toBe('gap');
  });

  it('lets older clients skip event types added later without breaking the stream', () => {
    expect(readEvent(event(1, { type: 'task.completed', taskId: task.id, summary: 'ok' })).kind).toBe('event');
    expect(readEvent({ v: 1, stream: 'tasks', id: 2, at: '2026-11-09T12:00:02.000Z', correlationId: null, payload: { type: 'task.budget_warning', taskId: task.id } })).toEqual({ kind: 'unknown', stream: 'tasks', id: 2 });
    expect(readEvent({ v: 1, stream: 'tasks', id: 3, at: 'ontem', correlationId: null, payload: { type: 'task.completed' } }).kind).toBe('invalid');
    expect(readEvent({ v: 1, stream: 'tasks', id: 4, at: '2026-11-09T12:00:02.000Z', correlationId: null, payload: { type: 'task.completed', taskId: task.id } }).kind).toBe('invalid');
  });

  it('writes SSE frames that resume with Last-Event-ID', () => {
    const frame = sseFrame(event(42, { type: 'task.completed', taskId: task.id, summary: null }));
    expect(frame.startsWith('id: 42\nevent: task.completed\ndata: {')).toBe(true);
    expect(frame.endsWith('\n\n')).toBe(true);
    expect(frame.split('\n').filter((line) => line.startsWith('data:'))).toHaveLength(1);
  });

  it('defines a bounded WebSocket protocol where commands carry idempotency keys', () => {
    expect(clientMessageSchema.parse({ op: 'hello', protocol: 1, client: { name: 'mobile', version: '0.1.0' } })).toMatchObject({ subscribe: [] });
    expect(clientMessageSchema.safeParse({ op: 'subscribe', subscriptions: Array.from({ length: WS.maxSubscriptions + 1 }, () => ({ stream: 'tasks' })) }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ op: 'command', ref: 'r1', command: { name: 'task.cancel', taskId: task.id } }).success).toBe(false);
    expect(clientMessageSchema.safeParse({ op: 'command', ref: 'r1', idempotencyKey: 'k'.repeat(20), command: { name: 'task.cancel', taskId: task.id } }).success).toBe(true);
    expect(clientMessageSchema.safeParse({ op: 'command', ref: 'r1', idempotencyKey: 'k'.repeat(20), command: { name: 'task.run', taskId: task.id } }).success).toBe(false);
    expect(serverMessageSchema.safeParse({ op: 'gap', stream: 'tasks', requestedSince: 10, resumeFrom: 500 }).success).toBe(true);
    expect(Object.values(WS.close).every((code) => code >= 4000 && code <= 4999)).toBe(true);
  });
});

describe('core-api memory and integrations', () => {
  it('mirrors the brain limits and never lets a remote write set trust', () => {
    const write = { title: 'Decisão de cache', content: 'Usar WAL.', type: 'decision', projectId: null };
    expect(writeMemoryRequestSchema.parse(write)).toMatchObject({ tags: [], links: [] });
    expect(writeMemoryRequestSchema.safeParse({ ...write, trust: 'reviewed' }).success).toBe(false);
    expect(writeMemoryRequestSchema.safeParse({ ...write, title: 'a [[b]]' }).success).toBe(false);
    expect(updateMemoryRequestSchema.safeParse(write).success).toBe(false);
    expect(memorySearchRequestSchema.parse({ query: 'cache' })).toMatchObject({ limit: 8, mode: 'hybrid' });
    expect(memorySearchRequestSchema.safeParse({ query: 'cache', limit: 21 }).success).toBe(false);
    expect(projectSearchResponseSchema.safeParse({ hits: [], untrusted: false, degraded: null }).success).toBe(false);
  });

  it('keeps execution in the Core and pushes carry no content', () => {
    expect(ORCHESTRATOR_RULES.mayStartAgentProcesses).toBe(false);
    expect(ORCHESTRATOR_RULES.sharedDatabase).toBe(false);
    expect(FIELD_OWNERSHIP.execution).toBe('core');
    expect(FIELD_OWNERSHIP.providerCredentials).toBe('core');
    const push = { v: 1, kind: 'task.completed', taskId: task.id, at: '2026-11-09T12:00:00.000Z', coreId: 'core-1' };
    expect(pushNotificationSchema.safeParse(push).success).toBe(true);
    for (const leak of [{ summary: 'resultado' }, { prompt: 'segredo' }, { error: 'stack' }, { title: 'Tarefa X' }]) expect(pushNotificationSchema.safeParse({ ...push, ...leak }).success).toBe(false);
  });

  it('reaches the Core over loopback or tailscale serve only, never funnel', () => {
    expect(transportDescriptorSchema.safeParse({ kind: 'tailscale-serve', endpoint: 'https://desktop.tail1234.ts.net', funnel: false }).success).toBe(true);
    expect(transportDescriptorSchema.safeParse({ kind: 'tailscale-serve', endpoint: 'https://desktop.tail1234.ts.net', funnel: true }).success).toBe(false);
    expect(transportDescriptorSchema.safeParse({ kind: 'lan', endpoint: 'http://192.168.0.10:4000' }).success).toBe(false);
    expect(transportDescriptorSchema.safeParse({ kind: 'loopback', endpoint: 'http://127.0.0.1:43123' }).success).toBe(true);
  });
});
