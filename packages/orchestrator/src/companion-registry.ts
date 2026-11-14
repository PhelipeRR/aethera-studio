import { asc, desc, eq, inArray, notInArray } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { companionEvents, companionSessions, tasks, type DatabaseHandle } from '@neuralbridge/database';
import {
  companionEventSchema,
  companionSessionSchema,
  companionSubscriptionSchema,
  type CompanionEvent,
  type CompanionEventBus as CompanionEventBusContract,
  type CompanionEventObserver,
  type CompanionEventSubscription,
  type CompanionSession,
  type CompanionSessionStatus,
  type CompanionConnectionState,
  type CompanionAgentId,
} from '@neuralbridge/shared';
import type { AgentEvent } from '@neuralbridge/shared';
import type { TaskUpdate } from './engine.js';

type SessionInput = CompanionSession;

export interface CompanionEventBusOptions {
  maxEvents?: number;
  onSubscriberError?: (error: unknown) => void;
}

function matches(event: CompanionEvent, filter: CompanionEventSubscription['filter']): boolean {
  return (!filter.sessionIds?.length || filter.sessionIds.includes(event.sessionId))
    && (!filter.taskIds?.length || filter.taskIds.includes(event.taskId))
    && (!filter.agents?.length || filter.agents.includes(event.agent))
    && (!filter.kinds?.length || filter.kinds.includes(event.kind));
}

/** Non-blocking in-process delivery. Persistence remains the source of truth. */
export class CompanionEventBus implements CompanionEventBusContract {
  private readonly subscribers = new Map<string, { subscription: CompanionEventSubscription; observer: CompanionEventObserver }>();
  private readonly accepted: CompanionEvent[] = [];
  private readonly seen = new Set<string>();
  private readonly seenOrder: string[] = [];
  private readonly lastSequence = new Map<string, number>();
  private readonly maxEvents: number;

  constructor(private readonly options: CompanionEventBusOptions = {}) {
    this.maxEvents = Math.max(1, Math.min(options.maxEvents ?? 10_000, 100_000));
  }

  subscribe(subscription: CompanionEventSubscription, observer: CompanionEventObserver): () => void {
    const valid = companionSubscriptionSchema.parse(subscription) as CompanionEventSubscription;
    this.subscribers.set(valid.subscriptionId, { subscription: valid, observer });
    return () => this.subscribers.delete(valid.subscriptionId);
  }

  publish(event: CompanionEvent): boolean {
    const valid = companionEventSchema.parse(event);
    const last = this.lastSequence.get(valid.sessionId);
    if (this.seen.has(valid.eventId) || (last !== undefined && valid.sequence <= last)) return false;
    this.seen.add(valid.eventId);
    this.seenOrder.push(valid.eventId);
    this.lastSequence.set(valid.sessionId, valid.sequence);
    this.accepted.push(valid);
    while (this.accepted.length > this.maxEvents) this.accepted.shift();
    while (this.seenOrder.length > this.maxEvents) {
      const expired = this.seenOrder.shift();
      if (expired) this.seen.delete(expired);
    }
    for (const { subscription, observer } of this.subscribers.values()) {
      if (!matches(valid, subscription.filter)) continue;
      queueMicrotask(() => {
        try {
          observer(valid);
        } catch (error) {
          this.options.onSubscriberError?.(error);
        }
      });
    }
    return true;
  }

  size(): number {
    return this.accepted.length;
  }
}

export interface CompanionSessionRegistryOptions {
  handle: DatabaseHandle;
  bus?: CompanionEventBus;
  eventRetention?: number;
}

export class CompanionSessionRegistry {
  private readonly bus: CompanionEventBus;
  private readonly eventRetention: number;

  constructor(private readonly options: CompanionSessionRegistryOptions) {
    this.bus = options.bus ?? new CompanionEventBus({ maxEvents: options.eventRetention ?? 10_000 });
    this.eventRetention = Math.max(1, Math.min(options.eventRetention ?? 10_000, 100_000));
  }

  register(input: SessionInput): CompanionSession {
    const session = companionSessionSchema.parse(input);
    const task = this.options.handle.db.select({ id: tasks.id, projectId: tasks.projectId }).from(tasks).where(eq(tasks.id, session.taskId)).get();
    if (!task) throw new Error(`companion_task_not_found: ${session.taskId}`);
    if (task.projectId !== session.projectId) throw new Error(`companion_project_mismatch: ${session.taskId}`);
    const existing = this.options.handle.db.select().from(companionSessions).where(eq(companionSessions.sessionId, session.sessionId)).get();
    if (existing && (existing.taskId !== session.taskId || existing.agent !== session.agent || existing.providerSessionId !== session.providerSessionId)) throw new Error(`companion_session_conflict: ${session.sessionId}`);
    if (existing) {
      this.options.handle.db.update(companionSessions).set({ status: session.status, connection: session.connection, updatedAt: session.updatedAt, endedAt: session.status === 'completed' || session.status === 'failed' || session.status === 'cancelled' ? session.updatedAt : existing.endedAt }).where(eq(companionSessions.sessionId, session.sessionId)).run();
    } else {
      this.options.handle.db.insert(companionSessions).values({ ...session, lastSequence: -1, endedAt: null }).run();
    }
    return this.get(session.sessionId) as CompanionSession;
  }

  get(sessionId: string): CompanionSession | null {
    const row = this.options.handle.db.select().from(companionSessions).where(eq(companionSessions.sessionId, sessionId)).get();
    return row ? this.toSession(row) : null;
  }

  list(query: { activeOnly?: boolean; newestFirst?: boolean; limit?: number; offset?: number } = {}): CompanionSession[] {
    const rows = this.options.handle.db.select().from(companionSessions)
      .where(query.activeOnly ? notInArray(companionSessions.status, ['completed', 'failed', 'cancelled', 'disconnected']) : undefined)
      .orderBy(query.newestFirst ? desc(companionSessions.updatedAt) : asc(companionSessions.updatedAt))
      .limit(query.limit ?? 100).offset(query.offset ?? 0).all();
    return rows.map((row) => this.toSession(row));
  }

  private toSession(row: typeof companionSessions.$inferSelect): CompanionSession {
    return companionSessionSchema.parse({ sessionId: row.sessionId, taskId: row.taskId, agent: row.agent, projectId: row.projectId, providerSessionId: row.providerSessionId, status: row.status, connection: row.connection, startedAt: row.startedAt, updatedAt: row.updatedAt });
  }

  listActive(): CompanionSession[] {
    return this.list({ activeOnly: true, limit: 100_000 });
  }

  updateConnection(sessionId: string, connection: CompanionConnectionState, updatedAt: string): CompanionSession {
    const current = this.get(sessionId);
    if (!current) throw new Error(`companion_session_not_found: ${sessionId}`);
    const status: CompanionSessionStatus = connection === 'disconnected' ? 'disconnected' : current.status === 'disconnected' ? 'idle' : current.status;
    this.options.handle.db.update(companionSessions).set({ connection, status, updatedAt, endedAt: connection === 'disconnected' ? updatedAt : null }).where(eq(companionSessions.sessionId, sessionId)).run();
    return this.get(sessionId) as CompanionSession;
  }

  nextSequence(sessionId: string): number {
    const row = this.options.handle.db.select({ lastSequence: companionSessions.lastSequence }).from(companionSessions).where(eq(companionSessions.sessionId, sessionId)).get();
    if (!row) throw new Error(`companion_session_not_found: ${sessionId}`);
    return row.lastSequence + 1;
  }

  ingest(event: CompanionEvent): boolean {
    const valid = companionEventSchema.parse(event);
    const session = this.options.handle.db.select().from(companionSessions).where(eq(companionSessions.sessionId, valid.sessionId)).get();
    if (!session) throw new Error(`companion_session_not_found: ${valid.sessionId}`);
    if (session.taskId !== valid.taskId || session.agent !== valid.agent || valid.sequence <= session.lastSequence) return false;
    try {
      this.options.handle.db.insert(companionEvents).values({ eventId: valid.eventId, sessionId: valid.sessionId, taskId: valid.taskId, agent: valid.agent, sequence: valid.sequence, occurredAt: valid.occurredAt, receivedAt: valid.receivedAt, kind: valid.kind, data: JSON.stringify(valid) }).run();
    } catch (error) {
      if (String(error).includes('UNIQUE')) return false;
      throw error;
    }
    const current = this.get(valid.sessionId) as CompanionSession;
    const status: CompanionSessionStatus = valid.kind === 'session_ended' ? valid.status : valid.kind === 'status_changed' ? valid.status : current.status;
    this.options.handle.db.update(companionSessions).set({ lastSequence: valid.sequence, updatedAt: valid.receivedAt, status, endedAt: ['completed', 'failed', 'cancelled', 'disconnected'].includes(status) ? valid.receivedAt : null }).where(eq(companionSessions.sessionId, valid.sessionId)).run();
    this.prune(valid.sessionId);
    this.bus.publish(valid);
    return true;
  }

  events(sessionId: string, query: { newestFirst?: boolean; limit?: number; offset?: number } = {}): CompanionEvent[] {
    const rows = this.options.handle.db.select().from(companionEvents).where(eq(companionEvents.sessionId, sessionId))
      .orderBy(query.newestFirst ? desc(companionEvents.sequence) : asc(companionEvents.sequence))
      .limit(query.limit ?? 100).offset(query.offset ?? 0).all();
    return rows.map((row) => companionEventSchema.parse(JSON.parse(row.data) as unknown));
  }

  subscribe(subscription: CompanionEventSubscription, observer: CompanionEventObserver): () => void {
    return this.bus.subscribe(subscription, observer);
  }

  private prune(sessionId: string): void {
    const rows = this.options.handle.db.select({ eventId: companionEvents.eventId }).from(companionEvents).where(eq(companionEvents.sessionId, sessionId)).orderBy(asc(companionEvents.sequence)).all();
    const stale = rows.slice(0, Math.max(0, rows.length - this.eventRetention)).map((row) => row.eventId);
    if (stale.length) this.options.handle.db.delete(companionEvents).where(inArray(companionEvents.eventId, stale)).run();
  }
}

export interface CompanionTaskResolver {
  projectIdForTask(taskId: string): string | null;
}

/** Bridges only already-emitted TaskEngine updates into observation; it never sends commands back. */
export interface CompanionTaskEventSource {
  on(event: 'task', listener: (update: TaskUpdate) => void): unknown;
  off(event: 'task', listener: (update: TaskUpdate) => void): unknown;
}

export function connectTaskEngineToCompanion(engine: CompanionTaskEventSource, registry: CompanionSessionRegistry, resolver: CompanionTaskResolver, options: { onError?: (error: unknown) => void } = {}): () => void {
  const stepAgents = new Map<string, CompanionAgentId>();
  const onTask = (update: TaskUpdate): void => {
    try {
    if (update.kind === 'step') {
      if (!update.background) stepAgents.set(update.stepId, update.agent);
      return;
    }
    if (update.kind !== 'event' || !update.event || !('kind' in update.event)) return;
    const agent = update.stepId ? stepAgents.get(update.stepId) : undefined;
    if (!agent) return;
    const providerEvent = update.event as AgentEvent;
    if (providerEvent.kind === 'session') {
      const now = new Date().toISOString();
      registry.register({ sessionId: providerEvent.sessionId, taskId: update.taskId, agent, projectId: resolver.projectIdForTask(update.taskId), providerSessionId: providerEvent.sessionId, status: 'running', connection: 'connected', startedAt: now, updatedAt: now });
    }
    const sessionId = providerEvent.kind === 'session' ? providerEvent.sessionId : registry.list().find((session) => session.taskId === update.taskId && session.agent === agent)?.sessionId;
    if (!sessionId) return;
    const base = { eventId: randomUUID(), sessionId, taskId: update.taskId, agent, sequence: registry.nextSequence(sessionId), occurredAt: new Date().toISOString(), receivedAt: new Date().toISOString() };
    const event = toCompanionEvent(providerEvent, base);
    if (event) registry.ingest(event);
    } catch (error) {
      options.onError?.(error);
    }
  };
  engine.on('task', onTask);
  return () => engine.off('task', onTask);
}

function toCompanionEvent(providerEvent: AgentEvent, base: Omit<CompanionEvent, 'kind' | 'control'>): CompanionEvent | null {
  switch (providerEvent.kind) {
    case 'session': return { ...base, kind: 'session_started', control: 'observed' };
    case 'tool': return { ...base, kind: 'tool_started', control: 'observed', tool: providerEvent.name, summary: providerEvent.summary };
    case 'file_change': return { ...base, kind: 'file_changed', control: 'observed', path: providerEvent.path, additions: null, deletions: null };
    case 'error': return { ...base, kind: 'error', control: 'observed', summary: providerEvent.message };
    case 'permission_denied': return { ...base, kind: 'notification', control: 'observed', summary: 'Agent permission was denied.' };
    case 'done': return { ...base, kind: 'session_ended', control: 'observed', status: providerEvent.cancelled ? 'cancelled' : providerEvent.ok ? 'completed' : 'failed', summary: providerEvent.errorOutput ? 'Agent finished with an error.' : null };
    case 'text': return { ...base, kind: 'notification', control: 'observed', summary: 'Agent produced text output.' };
    case 'result': return { ...base, kind: 'notification', control: 'observed', summary: providerEvent.ok ? 'Agent produced a result.' : 'Agent result failed.' };
    default: return null;
  }
}
