import { z } from 'zod';
import { AGENT_IDS, RUN_MODES, TASK_STATUSES, type TaskStatus } from '../domain.js';
import { STEP_KINDS } from '../tasks.js';
import { correlationIdSchema, isoTimestampSchema, pageQuerySchema, pageSchema, principalSchema, resourceIdSchema } from './common.js';

/*
 * CORE-02: task contracts. Every client (desktop, phone, MCP tool, external orchestrator) only asks and observes; the
 * Core's TaskEngine is the single executor (ADR CORE-01 §2.2). Statuses, run modes and agents are the existing
 * domain vocabularies, so v1 maps one to one onto today's tasks table.
 */

export const taskPromptSchema = z.string().trim().min(1).max(20_000);
/** Same rule as the IPC: model names reach the CLI as one argument, so only characters model ids use. */
export const modelNameSchema = z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:/[\]-]{0,99}$/);
export const taskAccessSchema = z.enum(['read-only', 'edit']);

/** Correlation with a task in another system (Paperclip or any orchestrator). system + id is unique in the Core. */
export const externalRefSchema = z.strictObject({
  system: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/),
  id: z.string().min(1).max(128),
  /** Increases when the external side changes its request; the Core keeps the latest it accepted. */
  revision: z.number().int().nonnegative(),
});
export type ExternalRef = z.infer<typeof externalRefSchema>;

/** Budget limits an orchestrator or a client may impose; the Core enforces them on top of its own token budget. */
export const taskLimitsSchema = z.strictObject({
  maxTokens: z.number().int().min(10_000).max(50_000_000).optional(),
  maxCostUsd: z.number().positive().max(10_000).optional(),
  maxDurationMs: z.number().int().min(60_000).max(24 * 60 * 60 * 1000).optional(),
});

/** POST /api/v1/tasks — requires the Idempotency-Key header. */
export const createTaskRequestSchema = z.strictObject({
  prompt: taskPromptSchema,
  projectId: resourceIdSchema.nullable(),
  mode: z.enum(RUN_MODES),
  /** Explicit boundary. Read-only tasks never edit, even in a Full Access project. Default: edit for the desktop, read-only for remote clients. */
  access: taskAccessSchema.optional(),
  model: modelNameSchema.nullable().optional(),
  skillIds: z.array(z.string().min(1).max(300)).max(8).optional(),
  participants: z.array(resourceIdSchema).max(32).optional(),
  externalRef: externalRefSchema.optional(),
  limits: taskLimitsSchema.optional(),
  /** Images are added in a later minor version (upload resource); v1 tasks are text only for remote clients. */
});
export type CreateTaskRequest = z.infer<typeof createTaskRequestSchema>;

/** POST /api/v1/tasks/{id}/messages — continue the conversation (today's tasks.resume). Creates a child task. */
export const continueTaskRequestSchema = z.strictObject({ prompt: taskPromptSchema });

/** POST /api/v1/tasks/{id}/approval */
export const approvalDecisionRequestSchema = z.strictObject({ decision: z.enum(['approve', 'reject']), comment: z.string().trim().max(500).optional() });

/** POST /api/v1/tasks/{id}/cancel — anyone allowed may ask; only the Core cancels and emits task.cancelled. */
export const cancelTaskRequestSchema = z.strictObject({ reason: z.string().trim().max(200).optional() });

/** POST /api/v1/tasks/{id}/recover — explicit recovery of a failed or interrupted task. */
export const RECOVERY_ACTIONS = ['resume', 'retry', 'heal'] as const;
export const recoverTaskRequestSchema = z.strictObject({ action: z.enum(RECOVERY_ACTIONS) });

export const taskListQuerySchema = pageQuerySchema.extend({
  status: z.enum(TASK_STATUSES).optional(),
  projectId: resourceIdSchema.optional(),
  agent: z.enum(AGENT_IDS).optional(),
  externalSystem: z.string().regex(/^[a-z][a-z0-9-]{1,31}$/).optional(),
  query: z.string().trim().max(200).optional(),
});

// ── Single executor ─────────────────────────────────────────────────────────────────────────────────────────────
/**
 * Who executes the task now. Filled by the Core when a step acquires its lease (CORE-04 adds owner_instance_id and
 * lease_expires_at to tasks). Clients never set it; a second Core or a stale desktop cannot start a leased step.
 */
export const executorSchema = z.strictObject({
  instanceId: resourceIdSchema,
  leaseExpiresAt: isoTimestampSchema,
  /** Entries into agent execution; never moves backwards (ExecutionSnapshot.attempt). */
  attempt: z.number().int().nonnegative(),
});

export const tokenUsageSchema = z.strictObject({
  input: z.number().int().nonnegative().nullable(),
  output: z.number().int().nonnegative().nullable(),
  cached: z.number().int().nonnegative().nullable(),
  /** API-equivalent price; an estimate on subscription plans. */
  costUsd: z.number().nonnegative().nullable(),
});

export const taskStepSchema = z.strictObject({
  id: resourceIdSchema,
  position: z.number().int().nonnegative(),
  agent: z.enum(AGENT_IDS),
  kind: z.enum(STEP_KINDS),
  status: z.enum(TASK_STATUSES),
  tokens: tokenUsageSchema,
  filesChanged: z.array(z.string().max(1000)).max(5000),
  error: z.string().max(4000).nullable(),
  startedAt: isoTimestampSchema.nullable(),
  finishedAt: isoTimestampSchema.nullable(),
});

export const approvalStateSchema = z.enum(['not-required', 'pending', 'approved', 'rejected', 'cancelled']);

export const taskSchema = z.strictObject({
  id: resourceIdSchema,
  prompt: z.string().max(20_000),
  projectId: resourceIdSchema.nullable(),
  mode: z.enum(RUN_MODES),
  access: taskAccessSchema,
  status: z.enum(TASK_STATUSES),
  parentTaskId: resourceIdSchema.nullable(),
  threadId: resourceIdSchema,
  model: z.string().max(100).nullable(),
  summary: z.string().max(20_000).nullable(),
  error: z.string().max(4000).nullable(),
  agents: z.array(z.enum(AGENT_IDS)).max(2),
  tokens: tokenUsageSchema,
  filesChanged: z.number().int().nonnegative(),
  approval: approvalStateSchema,
  cancellation: z.enum(['none', 'requested', 'acknowledged']),
  executor: executorSchema.nullable(),
  externalRef: externalRefSchema.nullable(),
  createdBy: principalSchema,
  correlationId: correlationIdSchema.nullable(),
  createdAt: isoTimestampSchema,
  startedAt: isoTimestampSchema.nullable(),
  finishedAt: isoTimestampSchema.nullable(),
  /** Last event id of this task's stream: subscribe with since=<this> to follow it without gaps. */
  lastEventId: z.number().int().nonnegative(),
});
export type CoreTask = z.infer<typeof taskSchema>;

export const taskDetailSchema = taskSchema.extend({ steps: z.array(taskStepSchema).max(200) });
export const taskPageSchema = pageSchema(taskSchema);

/** 201 on creation; 200 with replayed=true when the Idempotency-Key or the externalRef already created it. */
export const createTaskResponseSchema = z.strictObject({ task: taskSchema, replayed: z.boolean() });

// ── State machine ───────────────────────────────────────────────────────────────────────────────────────────────
export const FINAL_STATUSES: readonly TaskStatus[] = ['completed', 'failed', 'cancelled'];

const ACTIVE_STATUSES = TASK_STATUSES.filter((status) => !FINAL_STATUSES.includes(status));

/**
 * Transitions the Core may publish, matching TaskEngine as it behaves today: an active task moves freely between
 * active phases (the collaborative flow goes running → planning, a capacity wait pauses any phase, a fix loop goes
 * validating → running) but only a paused task returns to pending, and final statuses never change. Resume and retry
 * create a child task instead of reopening one. Clients and adapters use it to reject impossible event sequences.
 */
const nextStatuses = (from: TaskStatus): readonly TaskStatus[] =>
  FINAL_STATUSES.includes(from) ? [] : [...ACTIVE_STATUSES.filter((to) => to !== from && (to !== 'pending' || from === 'paused')), ...FINAL_STATUSES];
export const TASK_TRANSITIONS: Readonly<Record<TaskStatus, readonly TaskStatus[]>> = {
  pending: nextStatuses('pending'),
  planning: nextStatuses('planning'),
  running: nextStatuses('running'),
  awaiting_approval: nextStatuses('awaiting_approval'),
  validating: nextStatuses('validating'),
  paused: nextStatuses('paused'),
  completed: nextStatuses('completed'),
  failed: nextStatuses('failed'),
  cancelled: nextStatuses('cancelled'),
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

/** Which client commands each status accepts; anything else is invalid_transition (409). */
export const TASK_COMMANDS = {
  cancel: ['pending', 'planning', 'running', 'awaiting_approval', 'validating', 'paused'],
  pause: ['pending', 'planning', 'running', 'validating'],
  resumePaused: ['paused'],
  approve: ['awaiting_approval'],
  continue: ['completed', 'failed', 'cancelled'],
  recover: ['failed', 'cancelled'],
} as const satisfies Record<string, readonly TaskStatus[]>;
export type TaskCommand = keyof typeof TASK_COMMANDS;

export function commandAllowed(command: TaskCommand, status: TaskStatus): boolean {
  return (TASK_COMMANDS[command] as readonly TaskStatus[]).includes(status);
}
