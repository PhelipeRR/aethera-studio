import { describe, expect, it } from 'vitest';
import {
  CONTRACT_SCHEMA_VERSION,
  DATA_OWNERSHIP_BOUNDARIES,
  INTEGRATION_ENDPOINTS,
  IntegrationAuthRegistry,
  IntegrationClient,
  createIsolatedAppStub,
  integrationEventSchema,
  isCompatibleSchemaVersion,
  localDiscoveryRecordSchema,
  type IAgentProviderContract,
} from '../src/index.js';

function stubAgent(id: 'claude' | 'codex' | 'antigravity', available: boolean, capabilities: string[]): IAgentProviderContract {
  return {
    id,
    getCapabilities: () => capabilities,
    isAvailable: async () => available,
    execute: async ({ taskId }) => ({ ok: true, output: `${id}:${taskId}:done` }),
  };
}

describe('SEP-02 integration contracts & boundaries', () => {
  it('enforces distinct SQLite databases and forbids cross-app direct access', () => {
    const dbs = new Set([
      DATA_OWNERSHIP_BOUNDARIES.orchestrator.sqliteDbName,
      DATA_OWNERSHIP_BOUNDARIES.aethera.sqliteDbName,
      DATA_OWNERSHIP_BOUNDARIES.void.sqliteDbName,
    ]);
    expect(dbs.size).toBe(3);
    expect(DATA_OWNERSHIP_BOUNDARIES.orchestrator.forbiddenDirectAccess).toContain('youtube_oauth_tokens');
    expect(DATA_OWNERSHIP_BOUNDARIES.aethera.forbiddenDirectAccess).toContain('void_personal_memory');
    expect(DATA_OWNERSHIP_BOUNDARIES.void.forbiddenDirectAccess).toContain('orchestrator_credentials');
    expect(INTEGRATION_ENDPOINTS.taskById('t-1')).toBe('/v1/tasks/t-1');
  });

  it('validates N/N-1 schema compatibility and rejects incompatible major versions', () => {
    expect(isCompatibleSchemaVersion('1.0', '1.0')).toBe(true);
    expect(isCompatibleSchemaVersion('1.1', '1.0')).toBe(true);
    expect(isCompatibleSchemaVersion('2.0', '1.0')).toBe(false);
    expect(isCompatibleSchemaVersion('1.3', '1.0')).toBe(false);
  });

  it('enforces scoped pairing tokens, expiration, and instant revocation', () => {
    const auth = new IntegrationAuthRegistry();
    auth.issue({
      tokenId: 'tok-1',
      secret: 'sec-123',
      originApp: 'void',
      targetApp: 'aethera',
      scopes: ['video:produce', 'channel:read'],
      ttlMs: 10_000,
      nowMs: 1_000,
    });

    expect(auth.authorize('sec-123', 'video:produce', 5_000).ok).toBe(true);
    expect(auth.authorize('sec-123', 'tasks:delegate', 5_000)).toEqual({ ok: false, reason: 'forbidden_scope' });
    expect(auth.authorize('sec-123', 'video:produce', 20_000)).toEqual({ ok: false, reason: 'expired' });

    expect(auth.revoke('tok-1')).toBe(true);
    expect(auth.authorize('sec-123', 'video:produce', 5_000)).toEqual({ ok: false, reason: 'revoked' });
  });

  it('degrades gracefully to standalone mode when peer app is missing, disconnected, or incompatible', async () => {
    const missingPeer = new IntegrationClient(null);
    expect(await missingPeer.checkPeer()).toEqual({ connected: false, reason: 'peer_not_configured' });
    expect(
      await missingPeer.delegateTask({
        envelope: {
          requestId: 'req-1',
          correlationId: 'cor-1',
          idempotencyKey: 'idem-1',
          schemaVersion: CONTRACT_SCHEMA_VERSION,
          originApp: 'void',
          scopes: ['video:produce'],
          timeoutMs: 5_000,
        },
        kind: 'produce_video',
        capability: 'video',
        input: { prompt: 'Teste' },
      }),
    ).toEqual({ fallbackLocal: true, reason: 'peer_not_installed' });

    const incompatiblePeer = new IntegrationClient(
      createIsolatedAppStub({ appId: 'orchestrator', capabilities: ['tasks'], agents: [], schemaVersion: '2.0' }),
    );
    expect(await incompatiblePeer.checkPeer()).toEqual({ connected: false, reason: 'incompatible_schema:2.0' });
  });

  it('supports isolated app operation with RF-07 single-agent fallback and idempotent deduplication', async () => {
    const aetheraStub = createIsolatedAppStub({
      appId: 'aethera',
      capabilities: ['video.produce', 'channel.schedule'],
      agents: [
        stubAgent('claude', false, ['script']),
        stubAgent('codex', true, ['remotion']),
        stubAgent('antigravity', false, ['validation']),
      ],
    });

    const client = new IntegrationClient(aetheraStub);
    const peer = await client.checkPeer();
    expect(peer.connected).toBe(true);
    if (peer.connected) expect(peer.health.standalone).toBe(true);

    const req = {
      envelope: {
        requestId: 'req-42',
        correlationId: 'cor-42',
        idempotencyKey: 'idem-42',
        schemaVersion: CONTRACT_SCHEMA_VERSION,
        originApp: 'orchestrator' as const,
        scopes: ['video:produce'] as const,
        timeoutMs: 10_000,
      },
      kind: 'produce_video',
      capability: 'script',
      input: { topic: 'Elden Ring' },
    };

    const first = await client.delegateTask({ ...req, envelope: { ...req.envelope, scopes: [...req.envelope.scopes] } });
    expect('status' in first && first.status).toBe('completed');
    expect('executedByAgent' in first && first.executedByAgent).toBe('codex');

    const duplicate = await client.delegateTask({ ...req, envelope: { ...req.envelope, scopes: [...req.envelope.scopes] } });
    expect(duplicate).toEqual(first);
  });

  it('validates discovery records and integration events schemas', () => {
    const discovery = localDiscoveryRecordSchema.parse({
      instanceId: 'inst-1',
      appId: 'aethera',
      version: '0.1.65',
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      baseUrl: 'http://127.0.0.1:49210',
      capabilities: ['video.produce'],
      registeredAtIso: new Date().toISOString(),
    });
    expect(discovery.appId).toBe('aethera');

    const evt = integrationEventSchema.parse({
      eventId: 'evt-1',
      type: 'publication.scheduled',
      originApp: 'aethera',
      correlationId: 'cor-1',
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      occurredAtIso: new Date().toISOString(),
      payload: { channelId: 'ch-1' },
    });
    expect(evt.type).toBe('publication.scheduled');
  });
});
