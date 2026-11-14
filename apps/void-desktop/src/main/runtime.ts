import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ClaudeCliAdapter, CodexCliAdapter } from '@neuralbridge/agents';
import {
  openDatabase,
  PersonalAutomationRepository,
  PersonalNotificationRepository,
  personalAccounts,
  type DatabaseHandle,
  type PersistedAutomationRule,
  type PersistedPersonalNotification,
} from '@neuralbridge/database';
import {
  CONTRACT_SCHEMA_VERSION,
  DATA_OWNERSHIP_BOUNDARIES,
  IntegrationAuthRegistry,
  IntegrationClient,
  createSocketIntegrationTransport,
  defaultPipePath,
  discoverPeers,
  removeDiscoveryRecord,
  startLoopbackIntegrationServer,
  writeDiscoveryRecord,
  type AgentProviderId,
  type AppId,
  type DelegatedTaskStatus,
  type IAgentProviderContract,
  type IntegrationScope,
  type IntegrationTransport,
  type LoopbackIntegrationServerHandle,
  type PeerDiscoveryRecord,
} from '@neuralbridge/integration-contracts';

export interface VoidRuntimeOptions {
  dataDir: string;
  migrationsFolder: string;
  version?: string;
  agents?: readonly IAgentProviderContract[];
  orchestratorTransport?: IntegrationTransport | null;
  aetheraTransport?: IntegrationTransport | null;
  discoveryDir?: string;
  ipcPath?: string;
  requireAuth?: boolean;
}

export interface VoidRuntimeHandle {
  dbPath: string;
  db: DatabaseHandle;
  auth: IntegrationAuthRegistry;
  server: LoopbackIntegrationServerHandle;
  notifications: PersonalNotificationRepository;
  automations: PersonalAutomationRepository;
  orchestratorClient: IntegrationClient;
  aetheraClient: IntegrationClient;
  listNotifications(unreadOnly?: boolean): PersistedPersonalNotification[];
  pushNotification(input: {
    title: string;
    channel?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    metadata?: Record<string, unknown>;
  }): PersistedPersonalNotification;
  markNotificationRead(id: string): boolean;
  listAutomations(): PersistedAutomationRule[];
  createAutomation(input: { title: string; intervalMs?: number }): PersistedAutomationRule;
  listConnectedAccounts(): Array<{ id: string; provider: string; email: string; status: string }>;
  availableAgents(): Promise<AgentProviderId[]>;
  checkEcosystemPeers(): Promise<{ orchestrator: boolean; aethera: boolean }>;
  discoverEcosystemPeers(): PeerDiscoveryRecord[];
  issuePairingToken(targetApp: AppId, scopes: readonly IntegrationScope[]): { tokenId: string; secret: string };
  revokePairingToken(tokenId: string): boolean;
  delegateToPeer(input: {
    targetApp: AppId;
    capability: string;
    prompt: string;
    token?: string;
  }): Promise<DelegatedTaskStatus | { fallbackLocal: true; reason: string }>;
  askAssistant(input: { prompt: string }): Promise<{ agent: AgentProviderId; reply: string }>;
  close(): Promise<void>;
}

function defaultAgentContracts(): IAgentProviderContract[] {
  const claude = new ClaudeCliAdapter();
  const codex = new CodexCliAdapter();

  const wrap = (
    id: 'claude' | 'codex',
    adapter: ClaudeCliAdapter | CodexCliAdapter,
    capabilities: string[],
  ): IAgentProviderContract => ({
    id,
    getCapabilities: () => capabilities,
    isAvailable: async () => (await adapter.detect()).installed,
    execute: async ({ prompt }) => {
      let text = '';
      for await (const ev of adapter.run({ prompt, cwd: process.cwd(), mode: 'read-only' })) {
        if (ev.kind === 'text') text += ev.text;
        if (ev.kind === 'result' && ev.text) text = ev.text;
      }
      return { ok: true, output: text };
    },
  });

  return [
    wrap('claude', claude, ['assistant', 'memory', 'voice', 'planning']),
    wrap('codex', codex, ['assistant', 'automation', 'execution']),
    {
      id: 'antigravity',
      getCapabilities: () => ['assistant', 'validation'],
      isAvailable: async () => false,
      execute: async () => ({
        ok: false,
        output: '',
        error: 'Antigravity CLI não disponível neste ambiente.',
      }),
    },
  ];
}

export async function startVoidRuntime(options: VoidRuntimeOptions): Promise<VoidRuntimeHandle> {
  const dbPath = join(options.dataDir, DATA_OWNERSHIP_BOUNDARIES.void.sqliteDbName);
  const db = openDatabase(dbPath, { migrationsFolder: options.migrationsFolder });
  const notifications = new PersonalNotificationRepository(db.db);
  const automations = new PersonalAutomationRepository(db.db);
  const auth = new IntegrationAuthRegistry();
  const agents = options.agents ?? defaultAgentContracts();
  const capabilities = ['assistant.chat', 'memory.query', 'voice.commands', 'notifications.push', 'automations.run'];
  const version = options.version ?? '0.1.65';
  const ipcPath = options.ipcPath ?? defaultPipePath('void', `${process.pid}-${randomUUID().slice(0, 6)}`);

  const orchestratorClient = new IntegrationClient(options.orchestratorTransport ?? null);
  const aetheraClient = new IntegrationClient(options.aetheraTransport ?? null);

  const availableAgents = async (): Promise<AgentProviderId[]> => {
    const out: AgentProviderId[] = [];
    for (const a of agents) {
      if (await a.isAvailable()) out.push(a.id);
    }
    return out;
  };

  const server = await startLoopbackIntegrationServer({
    appId: 'void',
    version,
    capabilities,
    agents,
    auth,
    requireAuth: options.requireAuth ?? false,
    ...(options.ipcPath ? { ipcPath: options.ipcPath } : {}),
  });

  if (options.discoveryDir) {
    writeDiscoveryRecord(options.discoveryDir, {
      appId: 'void',
      pid: process.pid,
      version,
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      capabilities,
      baseUrl: server.baseUrl,
      ...(server.ipcPath ? { ipcPath: server.ipcPath } : { ipcPath }),
      startedAtIso: new Date().toISOString(),
    });
  }

  return {
    dbPath,
    db,
    auth,
    server,
    notifications,
    automations,
    orchestratorClient,
    aetheraClient,
    availableAgents,
    listNotifications: (unreadOnly = false) => notifications.list(unreadOnly),
    pushNotification: (input) => {
      const record: Omit<PersistedPersonalNotification, 'readAt'> = {
        id: randomUUID(),
        priority: input.priority ?? 'normal',
        channel: input.channel ?? 'assistant',
        title: input.title,
        ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
        dedupeKey: `${input.channel ?? 'assistant'}:${input.title}:${randomUUID()}`,
        createdAt: new Date().toISOString(),
      };
      notifications.push(record);
      return record;
    },
    markNotificationRead: (id) => notifications.markRead(id),
    listAutomations: () => automations.listRules(),
    createAutomation: ({ title, intervalMs = 300_000 }) => {
      const rule: PersistedAutomationRule = {
        id: randomUUID(),
        intervalMs,
        nextRunAt: Date.now() + intervalMs,
        state: 'active',
        action: { kind: 'notify', title },
      };
      automations.saveRule(rule);
      return rule;
    },
    listConnectedAccounts: () =>
      db.db
        .select()
        .from(personalAccounts)
        .limit(20)
        .all()
        .map((a) => ({ id: a.id, provider: a.provider, email: a.identifier, status: a.state })),
    checkEcosystemPeers: async () => {
      const [orchHealth, aetheraHealth] = await Promise.all([
        orchestratorClient.checkPeer(),
        aetheraClient.checkPeer(),
      ]);
      return {
        orchestrator: orchHealth.connected,
        aethera: aetheraHealth.connected,
      };
    },
    discoverEcosystemPeers: () => (options.discoveryDir ? discoverPeers(options.discoveryDir) : []),
    issuePairingToken: (targetApp, scopes) => {
      const tokenId = randomUUID();
      const secret = randomUUID();
      auth.issue({ tokenId, secret, originApp: 'void', targetApp, scopes });
      return { tokenId, secret };
    },
    revokePairingToken: (tokenId) => auth.revoke(tokenId),
    delegateToPeer: async ({ targetApp, capability, prompt, token }) => {
      if (!options.discoveryDir) return { fallbackLocal: true, reason: 'discovery_not_configured' };
      const peer = discoverPeers(options.discoveryDir).find((p) => p.appId === targetApp);
      if (!peer) return { fallbackLocal: true, reason: 'peer_offline_or_not_installed' };
      const transport = createSocketIntegrationTransport({
        ...(peer.ipcPath ? { socketPath: peer.ipcPath } : { baseUrl: peer.baseUrl }),
        ...(token ? { token } : {}),
      });
      try {
        return await transport.submitTask({
          envelope: {
            requestId: randomUUID(),
            idempotencyKey: randomUUID(),
            correlationId: randomUUID(),
            originApp: 'void',
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            scopes: ['tasks:delegate'],
            timeoutMs: 30_000,
          },
          kind: 'delegate',
          capability,
          input: { prompt },
        });
      } catch (err) {
        return { fallbackLocal: true, reason: err instanceof Error ? err.message : 'peer_unreachable' };
      }
    },
    askAssistant: async ({ prompt }) => {
      const active = await availableAgents();
      if (!active.length) {
        throw new Error('unavailable: Nenhum agente operacional (Claude, Codex ou Antigravity) disponível.');
      }
      for (const candidateId of active) {
        const provider = agents.find((a) => a.id === candidateId);
        if (!provider) continue;
        const result = await provider.execute({
          taskId: randomUUID(),
          capability: 'assistant',
          prompt,
        });
        if (result.ok) {
          return { agent: candidateId, reply: result.output };
        }
      }
      throw new Error('unavailable: Todos os agentes disponíveis falharam ao responder.');
    },
    close: async () => {
      if (options.discoveryDir) removeDiscoveryRecord(options.discoveryDir, 'void');
      await server.close();
      db.close();
    },
  };
}
