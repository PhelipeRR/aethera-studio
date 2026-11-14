import { z } from 'zod';
import { isoTimestampSchema, resourceIdSchema } from './common.js';
import { localEndpointSchema, privateEndpointSchema } from './auth.js';
import { externalRefSchema, taskLimitsSchema } from './tasks.js';
import { TASK_STATUSES } from '../domain.js';

/*
 * CORE-02: what future integrations plug into. Nothing here starts Paperclip or the mobile app; it fixes the shape
 * they must use so neither one can duplicate execution or reach data around the Core.
 */

// ── External orchestrators (Paperclip or any control plane) — ADR CORE-01 §6 ────────────────────────────────────
/**
 * An orchestrator talks to the Core only through the public API, as an `orchestrator` principal with its own scoped
 * credential, through one isolated adapter. It may plan, delegate, prioritize, approve (with task:approve) and set
 * budgets; it never starts an agent process, never reads the database and never receives provider or MCP credentials.
 */
export const ORCHESTRATOR_RULES = {
  executionOwner: 'core',
  mayStartAgentProcesses: false,
  sharedDatabase: false,
  credentialsShared: false,
  /** Divergences found by reconciliation become alerts, never automatic corrections. */
  reconciliation: 'alert-only',
  /** Turning the adapter off leaves its tasks in the Core with their external_ref. */
  disableEffect: 'tasks-continue-in-core',
} as const;

/** Registration of an adapter (desktop-local action, devices:manage). Credentials are issued like device tokens. */
export const orchestratorRegistrationSchema = z.strictObject({
  system: externalRefSchema.shape.system,
  displayName: z.string().trim().min(1).max(60),
  /** Where the adapter receives Core events if it cannot hold a WebSocket/SSE (optional, loopback only in v1). */
  callbackUrl: localEndpointSchema.optional(),
  /** Hard ceiling applied to every task this orchestrator creates, on top of per-task limits. */
  defaultLimits: taskLimitsSchema,
});

/** Field ownership between the Core and an orchestrator (who may write what). */
export const FIELD_OWNERSHIP = {
  execution: 'core',
  steps: 'core',
  lease: 'core',
  logs: 'core',
  evidence: 'core',
  hierarchy: 'orchestrator',
  goals: 'orchestrator',
  delegation: 'orchestrator',
  organizationalBudget: 'orchestrator',
  approvalResult: 'core',
  providerCredentials: 'core',
  memory: 'core',
} as const;

/** What the adapter reports when it compares open tasks with external_ref against its own system. */
export const reconciliationReportSchema = z.strictObject({
  system: externalRefSchema.shape.system,
  checkedAt: isoTimestampSchema,
  items: z.array(z.strictObject({
    taskId: resourceIdSchema,
    externalRef: externalRefSchema,
    coreStatus: z.enum(TASK_STATUSES),
    externalStatus: z.string().max(40),
    divergence: z.enum(['none', 'missing-in-external', 'missing-in-core', 'status-mismatch', 'revision-mismatch']),
  })).max(1000),
});

// ── Companion Mobile — private access only (ADR CORE-01 §2.5, D-8) ──────────────────────────────────────────────
/**
 * How a client reaches the Core. The Core binds to loopback; remote access goes through `tailscale serve`
 * (tailnet only). `tailscale funnel`, LAN binding and public hosts are not transports.
 */
export const REMOTE_TRANSPORTS = ['loopback', 'tailscale-serve'] as const;
export const transportDescriptorSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('loopback'), endpoint: localEndpointSchema }),
  z.strictObject({ kind: z.literal('tailscale-serve'), endpoint: privateEndpointSchema, funnel: z.literal(false) }),
]);

/** GET /api/v1/health — public on loopback, authenticated over the tailnet. Lets the app say "host indisponível" honestly. */
export const healthSchema = z.strictObject({
  status: z.enum(['ok', 'degraded', 'starting', 'stopping']),
  coreVersion: z.string().max(40),
  apiVersions: z.array(z.string().max(10)).min(1).max(5),
  mode: z.enum(['embedded', 'standalone']),
  desktopConnected: z.boolean(),
  /** Capabilities that need the desktop (notifications, voice, secrets in S0). */
  capabilities: z.record(z.enum(['notifications', 'voice', 'screen', 'hud', 'secrets']), z.boolean()),
  startedAt: isoTimestampSchema,
});

/**
 * Push carries metadata only: the app fetches the content with its own authenticated session. This schema is strict
 * on purpose, so adding a free-text field (prompt, summary, error, memory content) fails the contract test.
 */
export const pushNotificationSchema = z.strictObject({
  v: z.literal(1),
  /** The device picks a fixed, localized title from the kind; the push never carries user content. */
  kind: z.enum(['task.completed', 'task.failed', 'task.approval_required', 'task.cost_limit', 'device.revoked']),
  taskId: resourceIdSchema.nullable(),
  at: isoTimestampSchema,
  coreId: resourceIdSchema,
});
