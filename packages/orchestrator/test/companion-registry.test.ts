import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDatabase, tasks, type DatabaseHandle } from '@neuralbridge/database';
import type { CompanionEvent } from '@neuralbridge/shared';
import { CompanionEventBus, CompanionSessionRegistry, connectTaskEngineToCompanion } from '../src/companion-registry.js';
import type { TaskUpdate } from '../src/engine.js';

const migrationsFolder = join(process.cwd(), 'packages', 'database', 'migrations');
const sessionId = '00000000-0000-4000-8000-000000000001';
const taskId = '00000000-0000-4000-8000-000000000002';
const at = '2026-11-01T12:00:00.000Z';

function event(sequence: number, eventId = `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`): CompanionEvent {
  return { eventId, sessionId, taskId, agent: 'claude', sequence, occurredAt: at, receivedAt: at, kind: 'notification', control: 'observed', summary: `event ${sequence}` };
}

function db(file = join(mkdtempSync(join(tmpdir(), 'nb-companion-')), 'brain.db')): DatabaseHandle {
  const handle = openDatabase(file, { migrationsFolder });
  if (!handle.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, taskId)).get()) {
    handle.db.insert(tasks).values({ id: taskId, prompt: 'real task', projectId: null, mode: 'claude', status: 'running' }).run();
  }
  return handle;
}

describe('CompanionEventBus', () => {
  it('deduplicates events, rejects late sequences and isolates subscriber failures', async () => {
    const failures: unknown[] = [];
    const bus = new CompanionEventBus({ maxEvents: 2, onSubscriberError: (error) => failures.push(error) });
    const received: number[] = [];
    bus.subscribe({ subscriptionId: '00000000-0000-4000-8000-000000000010', filter: {}, createdAt: at }, () => { throw new Error('subscriber failed'); });
    bus.subscribe({ subscriptionId: '00000000-0000-4000-8000-000000000011', filter: {}, createdAt: at }, (value) => received.push(value.sequence));
    expect(bus.publish(event(1))).toBe(true);
    expect(bus.publish(event(1))).toBe(false);
    expect(bus.publish(event(0))).toBe(false);
    expect(bus.publish(event(2))).toBe(true);
    await Promise.resolve();
    expect(received).toEqual([1, 2]);
    expect(failures).toHaveLength(2);
    expect(bus.size()).toBe(2);
  });

  it('filters subscriptions and cancels delivery without blocking publish', async () => {
    const bus = new CompanionEventBus();
    const received: number[] = [];
    const unsubscribe = bus.subscribe({ subscriptionId: '00000000-0000-4000-8000-000000000012', filter: { kinds: ['notification'] }, createdAt: at }, (value) => received.push(value.sequence));
    expect(bus.publish(event(1))).toBe(true);
    unsubscribe();
    expect(bus.publish(event(2))).toBe(true);
    await Promise.resolve();
    expect(received).toEqual([1]);
  });
});

describe('CompanionSessionRegistry', () => {
  let handle: DatabaseHandle | undefined;
  afterEach(() => handle?.close());

  it('registers a real task session idempotently and recovers it after reopening the same database', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'nb-companion-')), 'brain.db');
    handle = db(file);
    const registry = new CompanionSessionRegistry({ handle });
    const input = { sessionId, taskId, agent: 'claude' as const, projectId: null, providerSessionId: 'provider-1', status: 'running' as const, connection: 'connected' as const, startedAt: at, updatedAt: at };
    expect(registry.register(input)).toMatchObject(input);
    expect(registry.register(input)).toMatchObject(input);
    expect(registry.list()).toHaveLength(1);
    handle.close();
    handle = db(file);
    const recovered = new CompanionSessionRegistry({ handle }).get(sessionId);
    expect(recovered).toMatchObject({ sessionId, taskId, providerSessionId: 'provider-1' });
  });

  it('persists accepted events, ignores duplicates and late events, and retains bounded history', () => {
    handle = db();
    const registry = new CompanionSessionRegistry({ handle, eventRetention: 2 });
    registry.register({ sessionId, taskId, agent: 'claude', projectId: null, providerSessionId: null, status: 'running', connection: 'connected', startedAt: at, updatedAt: at });
    expect(registry.ingest(event(1))).toBe(true);
    expect(registry.ingest(event(1))).toBe(false);
    expect(registry.ingest(event(0))).toBe(false);
    expect(registry.ingest(event(2))).toBe(true);
    expect(registry.ingest(event(3))).toBe(true);
    expect(registry.events(sessionId)).toHaveLength(2);
    expect(registry.events(sessionId).map((value) => value.sequence)).toEqual([2, 3]);
  });

  it('marks a session disconnected without turning observation into authorization', () => {
    handle = db();
    const registry = new CompanionSessionRegistry({ handle });
    registry.register({ sessionId, taskId, agent: 'claude', projectId: null, providerSessionId: null, status: 'running', connection: 'connected', startedAt: at, updatedAt: at });
    registry.updateConnection(sessionId, 'disconnected', '2026-11-01T12:01:00.000Z');
    expect(registry.get(sessionId)).toMatchObject({ connection: 'disconnected', status: 'disconnected' });
  });

  it('projects the TaskEngine task event stream without sending commands back', async () => {
    handle = db();
    const registry = new CompanionSessionRegistry({ handle });
    const listeners: Array<(update: TaskUpdate) => void> = [];
    const source = { on: (_name: 'task', listener: (update: TaskUpdate) => void) => { listeners.push(listener); }, off: () => { listeners.splice(0); } };
    const observed: string[] = [];
    registry.subscribe({ subscriptionId: '00000000-0000-4000-8000-000000000013', filter: {}, createdAt: at }, (value) => observed.push(value.kind));
    const disconnect = connectTaskEngineToCompanion(source, registry, { projectIdForTask: () => null });
    listeners[0]?.({ kind: 'step', taskId, stepId: '00000000-0000-4000-8000-000000000014', agent: 'claude', step: 'plan', status: 'running' });
    listeners[0]?.({ kind: 'event', taskId, stepId: '00000000-0000-4000-8000-000000000014', event: { kind: 'session', sessionId, model: 'model' } });
    await Promise.resolve();
    expect(registry.get(sessionId)).toMatchObject({ taskId, agent: 'claude' });
    expect(observed).toEqual(['session_started']);
    disconnect();
  });

  it('keeps Neura replies out of the sessions, which are for agents at work', async () => {
    handle = db();
    const registry = new CompanionSessionRegistry({ handle });
    const listeners: Array<(update: TaskUpdate) => void> = [];
    const source = { on: (_name: 'task', listener: (update: TaskUpdate) => void) => { listeners.push(listener); }, off: () => { listeners.splice(0); } };
    const disconnect = connectTaskEngineToCompanion(source, registry, { projectIdForTask: () => null });
    listeners[0]?.({ kind: 'step', taskId, stepId: '00000000-0000-4000-8000-000000000014', agent: 'claude', step: 'plan', status: 'running', background: true });
    listeners[0]?.({ kind: 'event', taskId, stepId: '00000000-0000-4000-8000-000000000014', event: { kind: 'session', sessionId, model: 'haiku' } });
    await Promise.resolve();
    expect(registry.get(sessionId)).toBeNull();
    disconnect();
  });
});

