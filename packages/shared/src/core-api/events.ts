import { z } from 'zod';
import { TASK_STATUSES } from '../domain.js';
import { monitorSampleSchema } from '../monitoring.js';
import { correlationIdSchema, isoTimestampSchema, resourceIdSchema } from './common.js';
import { coreErrorSchema } from './errors.js';
import { executorSchema, externalRefSchema, taskSchema, taskStepSchema } from './tasks.js';

/*
 * CORE-02: events and live streams (ADR CORE-01 §2.3). One envelope for WebSocket and SSE.
 * - Ids are monotonic per stream; clients resume with `since` (WebSocket) or `Last-Event-ID` (SSE).
 * - Retention is bounded; if the asked id is older than what the Core keeps, it sends `stream.gap` and the client
 *   re-reads the resource over HTTP before following again.
 * - Payloads never carry secrets: task logs are the same redacted, size-capped events the engine stores today.
 * - WebSocket is the primary transport (bidirectional: subscribe, ack, cancel, chat). SSE is the read-only
 *   alternative for clients that only observe (an orchestrator adapter, a script, a browser dashboard).
 */

export const STREAM_RETENTION = { eventsPerStream: 10_000, maxAgeMs: 24 * 60 * 60 * 1000 } as const;

/** Streams a client can follow. `task:<id>` carries everything about one task; `tasks` carries status changes of all visible tasks. */
export const streamNameSchema = z.union([
  z.literal('tasks'),
  z.string().regex(/^task:[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/) as z.ZodType<`task:${string}`>,
  z.literal('memory'),
  z.literal('index'),
  z.literal('metrics'),
  z.literal('system'),
]);
export type StreamName = z.infer<typeof streamNameSchema>;

const LOG_TEXT_LIMIT = 4000;

/** Discriminated by `type`. New event types are additive; clients ignore types they do not know. */
export const eventPayloadSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('task.created'), task: taskSchema }),
  z.strictObject({ type: z.literal('task.status'), taskId: resourceIdSchema, from: z.enum(TASK_STATUSES).nullable(), to: z.enum(TASK_STATUSES), error: z.string().max(4000).nullable() }),
  z.strictObject({ type: z.literal('task.step'), taskId: resourceIdSchema, step: taskStepSchema }),
  /** Redacted engine events (routed, plan, diff, rag_context…). `kind` is open: the engine adds kinds over time. */
  z.strictObject({ type: z.literal('task.log'), taskId: resourceIdSchema, stepId: resourceIdSchema.nullable(), kind: z.string().regex(/^[a-z][a-z0-9_]{0,40}$/), text: z.string().max(LOG_TEXT_LIMIT).nullable(), data: z.record(z.string(), z.unknown()) }),
  z.strictObject({ type: z.literal('task.approval_required'), taskId: resourceIdSchema, reasons: z.array(z.string().max(300)).max(20) }),
  z.strictObject({ type: z.literal('task.lease'), taskId: resourceIdSchema, executor: executorSchema.nullable() }),
  z.strictObject({ type: z.literal('task.cancelled'), taskId: resourceIdSchema, reason: z.string().max(200).nullable() }),
  z.strictObject({ type: z.literal('task.completed'), taskId: resourceIdSchema, summary: z.string().max(20_000).nullable() }),
  z.strictObject({ type: z.literal('task.failed'), taskId: resourceIdSchema, error: z.string().max(4000), recoverable: z.boolean() }),
  z.strictObject({ type: z.literal('task.external_ref'), taskId: resourceIdSchema, externalRef: externalRefSchema }),
  z.strictObject({ type: z.literal('memory.changed'), memoryId: resourceIdSchema, change: z.enum(['created', 'updated', 'deleted']), version: z.number().int().positive().nullable() }),
  z.strictObject({ type: z.literal('memory.recalled'), memoryId: resourceIdSchema, client: z.string().max(60), taskId: resourceIdSchema.nullable() }),
  z.strictObject({ type: z.literal('index.progress'), jobId: resourceIdSchema, target: z.enum(['memories', 'project']), projectId: resourceIdSchema.nullable(), done: z.number().int().nonnegative(), total: z.number().int().nonnegative(), state: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']) }),
  z.strictObject({ type: z.literal('metrics.sample'), sample: monitorSampleSchema }),
  z.strictObject({ type: z.literal('system.capability'), capability: z.enum(['notifications', 'voice', 'screen', 'hud', 'secrets']), available: z.boolean() }),
  z.strictObject({ type: z.literal('system.shutdown'), reason: z.enum(['update', 'user', 'error']), reconnectAfterMs: z.number().int().nonnegative() }),
]);
export type CoreEventPayload = z.infer<typeof eventPayloadSchema>;
export type CoreEventType = CoreEventPayload['type'];

export const eventEnvelopeSchema = z.strictObject({
  /** Envelope version; bumped only with a new API generation. */
  v: z.literal(1),
  stream: streamNameSchema,
  /** Monotonic within the stream, starting at 1. */
  id: z.number().int().positive(),
  at: isoTimestampSchema,
  correlationId: correlationIdSchema.nullable(),
  payload: eventPayloadSchema,
});
export type CoreEvent = z.infer<typeof eventEnvelopeSchema>;

/**
 * How clients read events: a valid envelope with an event type this client does not know yet (added in a later minor
 * version) is `unknown` and is skipped without breaking the stream; anything else that fails is `invalid`.
 */
export function readEvent(raw: unknown): { kind: 'event'; event: CoreEvent } | { kind: 'unknown'; stream: StreamName; id: number } | { kind: 'invalid' } {
  const parsed = eventEnvelopeSchema.safeParse(raw);
  if (parsed.success) return { kind: 'event', event: parsed.data };
  const shell = eventEnvelopeSchema.omit({ payload: true }).extend({ payload: z.looseObject({ type: z.string().regex(/^[a-z]+\.[a-z_]+$/) }) }).safeParse(raw);
  if (shell.success && !eventPayloadSchema.options.some((option) => option.shape.type.value === shell.data.payload.type)) return { kind: 'unknown', stream: shell.data.stream, id: shell.data.id };
  return { kind: 'invalid' };
}

/** Events of one stream must arrive with strictly increasing ids; a jump means events were missed (ask again with since). */
export function checkSequence(lastId: number, next: Pick<CoreEvent, 'id'>): 'next' | 'duplicate' | 'gap' {
  if (next.id <= lastId) return 'duplicate';
  return next.id === lastId + 1 ? 'next' : 'gap';
}

// ── WebSocket protocol (GET /api/v1/ws, subprotocol "singularity.v1") ───────────────────────────────────────────
export const WS = {
  subprotocol: 'singularity.v1',
  maxMessageBytes: 64 * 1024,
  maxSubscriptions: 50,
  heartbeatMs: 25_000,
  /** The server closes a socket that missed two heartbeats. */
  idleTimeoutMs: 60_000,
  /** Close codes in the private 4000–4999 range. */
  close: { revoked: 4401, forbidden: 4403, unsupportedVersion: 4426, tooManySubscriptions: 4429, shutdown: 4503 },
} as const;

export const subscriptionSchema = z.strictObject({ stream: streamNameSchema, since: z.number().int().nonnegative().optional() });

export const clientMessageSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('hello'), protocol: z.literal(1), client: z.strictObject({ name: z.string().min(1).max(60), version: z.string().max(20) }), subscribe: z.array(subscriptionSchema).max(WS.maxSubscriptions).default([]) }),
  z.strictObject({ op: z.literal('subscribe'), subscriptions: z.array(subscriptionSchema).min(1).max(WS.maxSubscriptions) }),
  z.strictObject({ op: z.literal('unsubscribe'), streams: z.array(streamNameSchema).min(1).max(WS.maxSubscriptions) }),
  /** Delivery confirmation (used for notification badges); never required to keep receiving. */
  z.strictObject({ op: z.literal('ack'), stream: streamNameSchema, id: z.number().int().positive() }),
  /** Same effect, scopes and idempotency as the HTTP command; ref echoes back in the result. */
  z.strictObject({ op: z.literal('command'), ref: z.string().min(1).max(64), idempotencyKey: z.string().min(16).max(128), command: z.discriminatedUnion('name', [
    z.strictObject({ name: z.literal('task.cancel'), taskId: resourceIdSchema, reason: z.string().max(200).optional() }),
    z.strictObject({ name: z.literal('chat.send'), sessionId: resourceIdSchema.nullable(), text: z.string().trim().min(1).max(4000) }),
  ]) }),
  z.strictObject({ op: z.literal('ping'), at: z.number().int().nonnegative() }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export const serverMessageSchema = z.discriminatedUnion('op', [
  z.strictObject({ op: z.literal('welcome'), protocol: z.literal(1), coreVersion: z.string().max(40), heartbeatMs: z.number().int().positive(), subscribed: z.array(streamNameSchema) }),
  z.strictObject({ op: z.literal('event'), event: eventEnvelopeSchema }),
  /** Retention exceeded: re-read over HTTP, then subscribe again from `resumeFrom`. */
  z.strictObject({ op: z.literal('gap'), stream: streamNameSchema, requestedSince: z.number().int().nonnegative(), resumeFrom: z.number().int().nonnegative() }),
  z.strictObject({ op: z.literal('result'), ref: z.string().min(1).max(64), ok: z.boolean(), error: coreErrorSchema.shape.error.optional() }),
  z.strictObject({ op: z.literal('error'), error: coreErrorSchema.shape.error }),
  z.strictObject({ op: z.literal('pong'), at: z.number().int().nonnegative() }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;

// ── SSE (GET /api/v1/streams/{stream}) ──────────────────────────────────────────────────────────────────────────
/** One SSE frame per event: `id:` is the event id (so Last-Event-ID resumes), `event:` the type, `data:` the envelope. */
export function sseFrame(event: CoreEvent): string {
  return `id: ${event.id}\nevent: ${event.payload.type}\ndata: ${JSON.stringify(event)}\n\n`;
}
