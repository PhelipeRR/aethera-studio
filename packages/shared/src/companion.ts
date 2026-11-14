import { z } from 'zod';

const id = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const text = (max: number) => z.string().trim().min(1).max(max);

export const COMPANION_AGENTS = ['claude', 'codex', 'opencode'] as const;
export type CompanionAgentId = (typeof COMPANION_AGENTS)[number];

export const COMPANION_SESSION_STATUSES = ['discovering', 'idle', 'running', 'waiting_permission', 'waiting_input', 'paused', 'completed', 'failed', 'cancelled', 'disconnected'] as const;
export type CompanionSessionStatus = (typeof COMPANION_SESSION_STATUSES)[number];

export const COMPANION_CONNECTION_STATES = ['connected', 'degraded', 'disconnected'] as const;
export type CompanionConnectionState = (typeof COMPANION_CONNECTION_STATES)[number];

const sessionIdentitySchema = z.strictObject({
  sessionId: id,
  taskId: id,
  agent: z.enum(COMPANION_AGENTS),
  projectId: text(200).nullable(),
  providerSessionId: text(300).nullable(),
});

export const companionSessionSchema = z.strictObject({
  ...sessionIdentitySchema.shape,
  status: z.enum(COMPANION_SESSION_STATUSES),
  connection: z.enum(COMPANION_CONNECTION_STATES),
  startedAt: timestamp,
  updatedAt: timestamp,
});
export type CompanionSession = z.infer<typeof companionSessionSchema>;

const eventBaseSchema = z.strictObject({
  eventId: id,
  sessionId: id,
  taskId: id,
  agent: z.enum(COMPANION_AGENTS),
  sequence: z.number().int().nonnegative(),
  occurredAt: timestamp,
  receivedAt: timestamp,
});

const observedEventSchemas = [
  eventBaseSchema.extend({ kind: z.literal('session_started'), control: z.literal('observed') }),
  eventBaseSchema.extend({ kind: z.literal('prompt_submitted'), control: z.literal('observed'), summary: text(4_000) }),
  eventBaseSchema.extend({ kind: z.literal('tool_started'), control: z.literal('observed'), tool: text(200), summary: text(4_000) }),
  eventBaseSchema.extend({ kind: z.literal('tool_finished'), control: z.literal('observed'), tool: text(200), ok: z.boolean(), summary: text(4_000) }),
  eventBaseSchema.extend({ kind: z.literal('file_changed'), control: z.literal('observed'), path: text(1_000), additions: z.number().int().nonnegative().nullable(), deletions: z.number().int().nonnegative().nullable() }),
  eventBaseSchema.extend({ kind: z.literal('notification'), control: z.literal('observed'), summary: text(4_000) }),
  eventBaseSchema.extend({ kind: z.literal('status_changed'), control: z.literal('observed'), status: z.enum(COMPANION_SESSION_STATUSES) }),
  eventBaseSchema.extend({ kind: z.literal('session_ended'), control: z.literal('observed'), status: z.enum(['completed', 'failed', 'cancelled', 'disconnected']), summary: text(4_000).nullable() }),
  eventBaseSchema.extend({ kind: z.literal('error'), control: z.literal('observed'), summary: text(4_000) }),
  eventBaseSchema.extend({ kind: z.literal('raw'), control: z.literal('observed'), sourceType: text(100), summary: text(4_000) }),
] as const;

export const companionEventSchema = z.discriminatedUnion('kind', observedEventSchemas);
export type CompanionEvent = z.infer<typeof companionEventSchema>;

export const COMPANION_PERMISSION_CONTROLS = ['controllable', 'uncontrollable'] as const;
export type CompanionPermissionControl = (typeof COMPANION_PERMISSION_CONTROLS)[number];

const permissionScopeSchema = z.strictObject({ paths: z.array(text(1_000)).max(100), commands: z.array(text(500)).max(100) });
export const companionPermissionRequestSchema = z.strictObject({
  requestId: id,
  sessionId: id,
  taskId: id,
  agent: z.enum(COMPANION_AGENTS),
  sequence: z.number().int().nonnegative(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  action: z.enum(['read', 'write', 'execute', 'delete', 'network', 'other']),
  summary: text(4_000),
  scope: permissionScopeSchema,
  control: z.enum(COMPANION_PERMISSION_CONTROLS),
  transport: z.enum(['native', 'hook', 'terminal', 'none']),
  expiresAt: timestamp,
  createdAt: timestamp,
}).superRefine((value, context) => {
  if (Date.parse(value.expiresAt) <= Date.parse(value.createdAt)) context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Permission requests must expire after creation.' });
  if (value.control === 'controllable' && value.transport === 'none') context.addIssue({ code: 'custom', path: ['transport'], message: 'Controllable requests require a decision transport.' });
  if (value.control === 'uncontrollable' && value.transport === 'native') context.addIssue({ code: 'custom', path: ['transport'], message: 'Uncontrollable requests cannot claim native control.' });
});
export type CompanionPermissionRequest = z.infer<typeof companionPermissionRequestSchema>;

export const companionPermissionDecisionSchema = z.strictObject({
  decisionId: id,
  requestId: id,
  sessionId: id,
  decision: z.enum(['allow', 'deny']),
  decidedAt: timestamp,
  idempotencyKey: id,
});
export type CompanionPermissionDecision = z.infer<typeof companionPermissionDecisionSchema>;

export interface CompanionAgentCapabilities {
  agent: CompanionAgentId;
  observation: boolean;
  permissionRequests: boolean;
  externalApproval: boolean;
  externalQuestionAnswer: boolean;
  controlTransport: 'native' | 'hook' | 'terminal' | 'none';
  checkedAt: string;
  warnings: string[];
}

export const companionAgentCapabilitiesSchema = z.strictObject({
  agent: z.enum(COMPANION_AGENTS),
  observation: z.boolean(),
  permissionRequests: z.boolean(),
  externalApproval: z.boolean(),
  externalQuestionAnswer: z.boolean(),
  controlTransport: z.enum(['native', 'hook', 'terminal', 'none']),
  checkedAt: timestamp,
  warnings: z.array(text(500)).max(20),
});

export interface CompanionEventFilter {
  sessionIds?: readonly string[];
  taskIds?: readonly string[];
  agents?: readonly CompanionAgentId[];
  kinds?: readonly CompanionEvent['kind'][];
}

export interface CompanionEventSubscription {
  subscriptionId: string;
  filter: CompanionEventFilter;
  createdAt: string;
}

export const companionEventFilterSchema = z.strictObject({
  sessionIds: z.array(id).max(100).optional(),
  taskIds: z.array(id).max(100).optional(),
  agents: z.array(z.enum(COMPANION_AGENTS)).max(COMPANION_AGENTS.length).optional(),
  kinds: z.array(z.enum(['session_started', 'prompt_submitted', 'tool_started', 'tool_finished', 'file_changed', 'notification', 'status_changed', 'session_ended', 'error', 'raw'])).max(10).optional(),
});

export const companionSubscriptionSchema = z.strictObject({ subscriptionId: id, filter: companionEventFilterSchema, createdAt: timestamp });

export const companionSessionsQuerySchema = z.strictObject({ activeOnly: z.boolean().default(false), newestFirst: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(100_000).default(0) });
export type CompanionSessionsQuery = z.input<typeof companionSessionsQuerySchema>;
export const companionSessionPageSchema = z.strictObject({ items: z.array(companionSessionSchema).max(100), nextOffset: z.number().int().nonnegative().nullable() });
export type CompanionSessionPage = z.infer<typeof companionSessionPageSchema>;
export const companionEventsQuerySchema = z.strictObject({ sessionId: id, newestFirst: z.boolean().default(false), limit: z.number().int().min(1).max(100).default(50), offset: z.number().int().min(0).max(100_000).default(0) });
export type CompanionEventsQuery = z.input<typeof companionEventsQuerySchema>;
export const companionEventPageSchema = z.strictObject({ items: z.array(companionEventSchema).max(100), nextOffset: z.number().int().nonnegative().nullable() });
export type CompanionEventPage = z.infer<typeof companionEventPageSchema>;
export const companionSubscribeInputSchema = z.strictObject({ filter: companionEventFilterSchema });
export type CompanionSubscribeInput = z.infer<typeof companionSubscribeInputSchema>;
export const companionSubscriptionResultSchema = z.strictObject({ subscriptionId: id });
export const companionUnsubscribeInputSchema = z.strictObject({ subscriptionId: id });
export const companionOkSchema = z.strictObject({ ok: z.literal(true) });

export const COMPANION_HUD_MODES = ['mascot', 'compact', 'expanded'] as const;
export type CompanionHudMode = (typeof COMPANION_HUD_MODES)[number];
const hudPointSchema = z.strictObject({ x: z.number(), y: z.number() });
/** The window is a fixed stage: `origin` places it on the screen, and everything else is relative to it. */
export const companionHudLayoutSchema = z.strictObject({ origin: hudPointSchema, mascot: hudPointSchema, compact: hudPointSchema, side: z.enum(['left', 'right']) });
export type CompanionHudLayout = z.infer<typeof companionHudLayoutSchema>;
export const companionHudStateSchema = z.strictObject({ visible: z.boolean(), mode: z.enum(COMPANION_HUD_MODES), alwaysOnTop: z.boolean(), layout: companionHudLayoutSchema });
export type CompanionHudState = z.infer<typeof companionHudStateSchema>;
/** The renderer only names the drag phase; the main process reads the cursor, so a renderer cannot place the window. */
export const companionHudDragSchema = z.strictObject({ phase: z.enum(['start', 'move', 'end']) });
export type CompanionHudDragPhase = z.infer<typeof companionHudDragSchema>['phase'];

export type CompanionEventObserver = (event: CompanionEvent) => void;
export type CompanionUnsubscribe = () => void;

export interface CompanionEventBus {
  subscribe(subscription: CompanionEventSubscription, observer: CompanionEventObserver): CompanionUnsubscribe;
  publish(event: CompanionEvent): void;
}

export function isControllablePermissionRequest(request: CompanionPermissionRequest): boolean {
  return request.control === 'controllable' && request.transport !== 'none';
}
