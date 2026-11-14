import { z } from 'zod';

export * from './loopback-server.js';
export const CONTRACT_SCHEMA_VERSION = '1.0' as const;

export const appIdSchema = z.enum(['orchestrator', 'aethera', 'void']);
export type AppId = z.infer<typeof appIdSchema>;

export const agentProviderIdSchema = z.enum(['claude', 'codex', 'antigravity']);
export type AgentProviderId = z.infer<typeof agentProviderIdSchema>;

export const integrationScopeSchema = z.enum([
  'health:read',
  'capabilities:read',
  'tasks:delegate',
  'tasks:read',
  'video:produce',
  'channel:read',
  'memory:read_scoped',
  'events:subscribe',
]);
export type IntegrationScope = z.infer<typeof integrationScopeSchema>;

/**
 * SEP-02 §4: Explicit data ownership matrix per application.
 * Apps never read another app's SQLite database, OAuth tokens, or private runtime directories directly.
 */
export const DATA_OWNERSHIP_BOUNDARIES: Record<
  AppId,
  {
    sqliteDbName: string;
    ownedResources: readonly string[];
    forbiddenDirectAccess: readonly string[];
  }
> = {
  orchestrator: {
    sqliteDbName: 'singularity-orchestrator.db',
    ownedResources: ['agent_catalog', 'tasks', 'workflows', 'work_rag', 'mcp_policies', 'audit_logs'],
    forbiddenDirectAccess: ['aethera_projects', 'youtube_oauth_tokens', 'void_personal_memory'],
  },
  aethera: {
    sqliteDbName: 'aethera-studio.db',
    ownedResources: [
      'production_runs',
      'storyboards',
      'timelines',
      'media_library',
      'renders',
      'channels',
      'youtube_oauth_tokens',
      'editorial_calendar',
      'channel_analytics',
    ],
    forbiddenDirectAccess: ['orchestrator_work_rag', 'void_personal_memory', 'void_voice_settings'],
  },
  void: {
    sqliteDbName: 'void-assistant.db',
    ownedResources: [
      'personal_conversations',
      'personal_memory',
      'voice_profiles',
      'personal_automations',
      'personal_notifications',
    ],
    forbiddenDirectAccess: ['youtube_oauth_tokens', 'aethera_media_files', 'orchestrator_credentials'],
  },
};

export const INTEGRATION_ENDPOINTS = {
  health: '/v1/health',
  capabilities: '/v1/capabilities',
  tasks: '/v1/tasks',
  taskById: (taskId: string) => `/v1/tasks/${encodeURIComponent(taskId)}`,
  events: '/v1/events',
} as const;

export const commandEnvelopeSchema = z.strictObject({
  requestId: z.string().min(1),
  correlationId: z.string().min(1),
  idempotencyKey: z.string().min(1),
  schemaVersion: z.string().regex(/^\d+\.\d+$/u),
  originApp: appIdSchema,
  scopes: z.array(integrationScopeSchema).min(1),
  timeoutMs: z.number().int().positive().max(300_000),
});
export type CommandEnvelope = z.infer<typeof commandEnvelopeSchema>;

export const healthResponseSchema = z.strictObject({
  appId: appIdSchema,
  version: z.string().min(1),
  schemaVersion: z.string().regex(/^\d+\.\d+$/u),
  status: z.enum(['ok', 'degraded']),
  standalone: z.boolean(),
  timestampIso: z.string().min(1),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const capabilitiesResponseSchema = z.strictObject({
  appId: appIdSchema,
  schemaVersion: z.string().regex(/^\d+\.\d+$/u),
  capabilities: z.array(z.string().min(1)),
  availableAgents: z.array(agentProviderIdSchema),
});
export type CapabilitiesResponse = z.infer<typeof capabilitiesResponseSchema>;

export const localDiscoveryRecordSchema = z.strictObject({
  instanceId: z.string().min(1),
  appId: appIdSchema,
  version: z.string().min(1),
  schemaVersion: z.string().regex(/^\d+\.\d+$/u),
  baseUrl: z.string().url(),
  capabilities: z.array(z.string().min(1)),
  registeredAtIso: z.string().min(1),
});
export type LocalDiscoveryRecord = z.infer<typeof localDiscoveryRecordSchema>;

export const integrationEventTypeSchema = z.enum([
  'task.created',
  'task.progress',
  'task.completed',
  'task.failed',
  'integration.disconnected',
  'production.ready',
  'publication.scheduled',
]);
export type IntegrationEventType = z.infer<typeof integrationEventTypeSchema>;

export const integrationEventSchema = z.strictObject({
  eventId: z.string().min(1),
  type: integrationEventTypeSchema,
  originApp: appIdSchema,
  correlationId: z.string().min(1),
  schemaVersion: z.string().regex(/^\d+\.\d+$/u),
  occurredAtIso: z.string().min(1),
  payload: z.record(z.string(), z.unknown()),
});
export type IntegrationEvent = z.infer<typeof integrationEventSchema>;

export const delegatedTaskRequestSchema = z.strictObject({
  envelope: commandEnvelopeSchema,
  kind: z.string().min(1),
  capability: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
});
export type DelegatedTaskRequest = z.infer<typeof delegatedTaskRequestSchema>;

export const delegatedTaskStatusSchema = z.strictObject({
  taskId: z.string().min(1),
  status: z.enum(['accepted', 'running', 'completed', 'failed', 'cancelled']),
  executedByAgent: agentProviderIdSchema.optional(),
  output: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});
export type DelegatedTaskStatus = z.infer<typeof delegatedTaskStatusSchema>;

/**
 * Negotiates N / N-1 compatibility on major.minor schema versions.
 * Same major version is compatible when remote minor is within [localMinor - 1, localMinor + 1].
 */
export function isCompatibleSchemaVersion(remoteVersion: string, localVersion: string = CONTRACT_SCHEMA_VERSION): boolean {
  const parse = (v: string) => {
    const [maj, min] = v.split('.').map(Number);
    return Number.isFinite(maj) && Number.isFinite(min) ? { maj: maj ?? 0, min: min ?? 0 } : null;
  };
  const r = parse(remoteVersion);
  const l = parse(localVersion);
  if (!r || !l) return false;
  if (r.maj !== l.maj) return false;
  return Math.abs(r.min - l.min) <= 1;
}

export interface PairingTokenRecord {
  tokenId: string;
  secret: string;
  originApp: AppId;
  targetApp: AppId;
  scopes: readonly IntegrationScope[];
  expiresAtMs: number;
  revoked: boolean;
}

/**
 * Manages opt-in pairing tokens with short TTL, scope enforcement, and instant revocation.
 */
export class IntegrationAuthRegistry {
  private readonly tokens = new Map<string, PairingTokenRecord>();

  issue(input: {
    tokenId: string;
    secret: string;
    originApp: AppId;
    targetApp: AppId;
    scopes: readonly IntegrationScope[];
    ttlMs?: number;
    nowMs?: number;
  }): PairingTokenRecord {
    const now = input.nowMs ?? Date.now();
    const record: PairingTokenRecord = {
      tokenId: input.tokenId,
      secret: input.secret,
      originApp: input.originApp,
      targetApp: input.targetApp,
      scopes: [...input.scopes],
      expiresAtMs: now + (input.ttlMs ?? 15 * 60_000),
      revoked: false,
    };
    this.tokens.set(record.secret, record);
    return record;
  }

  revoke(tokenId: string): boolean {
    for (const record of this.tokens.values()) {
      if (record.tokenId === tokenId) {
        record.revoked = true;
        return true;
      }
    }
    return false;
  }

  authorize(
    secret: string,
    requiredScope: IntegrationScope,
    nowMs: number = Date.now(),
  ): { ok: true; record: PairingTokenRecord } | { ok: false; reason: 'invalid' | 'revoked' | 'expired' | 'forbidden_scope' } {
    const record = this.tokens.get(secret);
    if (!record) return { ok: false, reason: 'invalid' };
    if (record.revoked) return { ok: false, reason: 'revoked' };
    if (nowMs > record.expiresAtMs) return { ok: false, reason: 'expired' };
    if (!record.scopes.includes(requiredScope)) return { ok: false, reason: 'forbidden_scope' };
    return { ok: true, record };
  }
}

export interface IAgentProviderContract {
  readonly id: AgentProviderId;
  getCapabilities(): readonly string[];
  isAvailable(): Promise<boolean>;
  execute(input: { taskId: string; capability: string; prompt: string }): Promise<{ ok: boolean; output: string; error?: string }>;
}

export interface IntegrationTransport {
  health(): Promise<HealthResponse>;
  capabilities(): Promise<CapabilitiesResponse>;
  submitTask(req: DelegatedTaskRequest): Promise<DelegatedTaskStatus>;
}

/**
 * Resilient client wrapper: handles absent/disconnected peer apps gracefully
 * so standalone execution never crashes when another app is not installed.
 */
export class IntegrationClient {
  constructor(private readonly transport: IntegrationTransport | null) {}

  async checkPeer(): Promise<{ connected: true; health: HealthResponse } | { connected: false; reason: string }> {
    if (!this.transport) return { connected: false, reason: 'peer_not_configured' };
    try {
      const health = healthResponseSchema.parse(await this.transport.health());
      if (!isCompatibleSchemaVersion(health.schemaVersion)) {
        return { connected: false, reason: `incompatible_schema:${health.schemaVersion}` };
      }
      return { connected: true, health };
    } catch (err) {
      return { connected: false, reason: err instanceof Error ? err.message : 'connection_failed' };
    }
  }

  async delegateTask(req: DelegatedTaskRequest): Promise<DelegatedTaskStatus | { fallbackLocal: true; reason: string }> {
    const parsed = delegatedTaskRequestSchema.parse(req);
    if (!this.transport) return { fallbackLocal: true, reason: 'peer_not_installed' };
    try {
      return delegatedTaskStatusSchema.parse(await this.transport.submitTask(parsed));
    } catch (err) {
      return { fallbackLocal: true, reason: err instanceof Error ? err.message : 'peer_unreachable' };
    }
  }
}

/**
 * In-memory mock stub for SEP-02 contract testing (supports idempotency & RF-07 fallback across agents).
 */
export function createIsolatedAppStub(input: {
  appId: AppId;
  capabilities: readonly string[];
  agents: readonly IAgentProviderContract[];
  schemaVersion?: string;
}): IntegrationTransport {
  const seenIdempotency = new Map<string, DelegatedTaskStatus>();
  const schemaVersion = input.schemaVersion ?? CONTRACT_SCHEMA_VERSION;

  return {
    health: async () => ({
      appId: input.appId,
      version: '0.1.65',
      schemaVersion,
      status: 'ok',
      standalone: true,
      timestampIso: new Date().toISOString(),
    }),
    capabilities: async () => {
      const available: AgentProviderId[] = [];
      for (const agent of input.agents) {
        if (await agent.isAvailable()) available.push(agent.id);
      }
      return {
        appId: input.appId,
        schemaVersion,
        capabilities: [...input.capabilities],
        availableAgents: available,
      };
    },
    submitTask: async (req) => {
      const cached = seenIdempotency.get(req.envelope.idempotencyKey);
      if (cached) return cached;

      let chosen: IAgentProviderContract | null = null;
      for (const agent of input.agents) {
        if ((await agent.isAvailable()) && agent.getCapabilities().includes(req.capability)) {
          chosen = agent;
          break;
        }
      }
      if (!chosen) {
        for (const agent of input.agents) {
          if (await agent.isAvailable()) {
            chosen = agent;
            break;
          }
        }
      }

      if (!chosen) {
        const failed: DelegatedTaskStatus = {
          taskId: req.envelope.requestId,
          status: 'failed',
          error: 'no_capable_agent_available',
        };
        seenIdempotency.set(req.envelope.idempotencyKey, failed);
        return failed;
      }

      const result = await chosen.execute({
        taskId: req.envelope.requestId,
        capability: req.capability,
        prompt: JSON.stringify(req.input),
      });
      const status: DelegatedTaskStatus = {
        taskId: req.envelope.requestId,
        status: result.ok ? 'completed' : 'failed',
        executedByAgent: chosen.id,
        ...(result.ok ? { output: { text: result.output } } : { error: result.error ?? 'execution_failed' }),
      };
      seenIdempotency.set(req.envelope.idempotencyKey, status);
      return status;
    },
  };
}

export * from './discovery.js';
export * from './loopback-server.js';
export * from './pairing-manager.js';
export * from './migration.js';
