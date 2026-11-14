import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { join } from 'node:path';
import { ClaudeCliAdapter, CodexCliAdapter } from '@neuralbridge/agents';
import { BrainService, DEFAULT_MARKERS, USER_SCOPE, parseSearchFilter } from '@neuralbridge/brain';
import {
  autonomousMissions,
  openDatabase,
  projects,
  tasks,
  type DatabaseHandle,
} from '@neuralbridge/database';
import {
  CONTRACT_SCHEMA_VERSION,
  DATA_OWNERSHIP_BOUNDARIES,
  IntegrationAuthRegistry,
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
  type LoopbackIntegrationServerHandle,
  type PeerDiscoveryRecord,
} from '@neuralbridge/integration-contracts';
import { defaultGlobalSkillRoots, scanSkills } from '@neuralbridge/workspace';
import { desc } from 'drizzle-orm';

export interface OrchestratorRuntimeOptions {
  dataDir: string;
  migrationsFolder: string;
  version?: string;
  agents?: readonly IAgentProviderContract[];
  discoveryDir?: string;
  ipcPath?: string;
  requireAuth?: boolean;
}

export interface OrchestratorRuntimeHandle {
  dbPath: string;
  db: DatabaseHandle;
  brain: BrainService;
  auth: IntegrationAuthRegistry;
  server: LoopbackIntegrationServerHandle;
  listTasks(): { id: string; prompt: string; agent: string; status: string; createdAt: string }[];
  createTask(input: { prompt: string; cwd?: string }): Promise<{ id: string; agent: AgentProviderId; status: string }>;
  availableAgents(): Promise<AgentProviderId[]>;
  rememberMemory(input: { title: string; content: string; tags?: string[] }): { id: string; title: string };
  searchMemories(query: string): Array<{ id: string; title: string; snippet: string }>;
  listMemories(): Array<{ id: string; title: string; type: string; updatedAt: string }>;
  listSkills(): Promise<Array<{ id: string; name: string; source: string; description: string }>>;
  listProjects(): Array<{ id: string; name: string; rootPath: string }>;
  listWorkflows(): Array<{ id: string; goal: string; status: string; createdAt: string }>;
  createWorkflow(goal: string): { id: string; goal: string; status: string };
  getTelemetry(): { platform: string; cpus: number; freeMemMb: number; totalMemMb: number; uptimeSec: number; rssMb: number };
  discoverEcosystemPeers(): PeerDiscoveryRecord[];
  issuePairingToken(targetApp: AppId, scopes: readonly IntegrationScope[]): { tokenId: string; secret: string };
  revokePairingToken(tokenId: string): boolean;
  delegateToPeer(input: {
    targetApp: AppId;
    capability: string;
    prompt: string;
    token?: string;
  }): Promise<DelegatedTaskStatus | { fallbackLocal: true; reason: string }>;
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
    wrap('claude', claude, ['orchestration', 'planning', 'code_review', 'script']),
    wrap('codex', codex, ['orchestration', 'automation', 'code_edit', 'execution']),
    {
      id: 'antigravity',
      getCapabilities: () => ['execution', 'validation'],
      isAvailable: async () => false,
      execute: async () => ({
        ok: false,
        output: '',
        error: 'Antigravity CLI não disponível neste ambiente.',
      }),
    },
  ];
}

export async function startOrchestratorRuntime(
  options: OrchestratorRuntimeOptions,
): Promise<OrchestratorRuntimeHandle> {
  const dbPath = join(options.dataDir, DATA_OWNERSHIP_BOUNDARIES.orchestrator.sqliteDbName);
  const db = openDatabase(dbPath, { migrationsFolder: options.migrationsFolder });
  const brain = new BrainService(db);
  const auth = new IntegrationAuthRegistry();
  const agents = options.agents ?? defaultAgentContracts();
  const capabilities = ['tasks.delegate', 'workflows.run', 'agents.route', 'mcp.tools', 'brain.rag'];
  const version = options.version ?? '0.1.65';
  const ipcPath = options.ipcPath ?? defaultPipePath('orchestrator', `${process.pid}-${randomUUID().slice(0, 6)}`);

  const availableAgents = async (): Promise<AgentProviderId[]> => {
    const out: AgentProviderId[] = [];
    for (const a of agents) {
      if (await a.isAvailable()) out.push(a.id);
    }
    return out;
  };

  const server = await startLoopbackIntegrationServer({
    appId: 'orchestrator',
    version,
    capabilities,
    agents,
    auth,
    requireAuth: options.requireAuth ?? false,
    ...(options.ipcPath ? { ipcPath: options.ipcPath } : {}),
  });

  if (options.discoveryDir) {
    writeDiscoveryRecord(options.discoveryDir, {
      appId: 'orchestrator',
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
    brain,
    auth,
    server,
    availableAgents,
    listTasks: () =>
      db.db
        .select()
        .from(tasks)
        .orderBy(desc(tasks.createdAt))
        .limit(30)
        .all()
        .map((t) => ({ id: t.id, prompt: t.prompt, agent: t.mode, status: t.status, createdAt: t.createdAt })),
    createTask: async ({ prompt }) => {
      const active = await availableAgents();
      if (!active.length) {
        throw new Error('unavailable: Nenhum agente operacional (Claude, Codex ou Antigravity) disponível.');
      }
      const chosen = active[0] ?? 'claude';
      const id = randomUUID();
      const now = new Date().toISOString();
      db.db
        .insert(tasks)
        .values({
          id,
          prompt: prompt.trim(),
          mode: chosen === 'codex' ? 'codex' : 'claude',
          status: 'pending',
          createdAt: now,
        })
        .run();
      return { id, agent: chosen, status: 'pending' };
    },
    rememberMemory: ({ title, content, tags }) => {
      const res = brain.store(
        { title, content, type: 'learning', tags: tags ?? ['orchestrator'] },
        USER_SCOPE,
        { kind: 'user', client: 'orchestrator-desktop' },
      );
      return { id: res.memory.id, title: res.memory.title };
    },
    searchMemories: (query) =>
      brain.textCandidates(query, parseSearchFilter({ limit: 20 }), USER_SCOPE, 20, DEFAULT_MARKERS).map((hit) => ({
        id: hit.id,
        title: hit.title,
        snippet: hit.snippet,
      })),
    listMemories: () =>
      brain.list({ limit: 30 }, USER_SCOPE).items.map((m) => ({
        id: m.id,
        title: m.title,
        type: m.type,
        updatedAt: m.updatedAt,
      })),
    listSkills: async () => {
      try {
        const roots = defaultGlobalSkillRoots(os.homedir()).map((r) => r.path);
        const skills = await scanSkills(roots);
        return skills.slice(0, 40).map((s) => ({
          id: s.id,
          name: s.name,
          source: s.source,
          description: s.description ?? '',
        }));
      } catch {
        return [];
      }
    },
    listProjects: () =>
      db.db
        .select()
        .from(projects)
        .limit(30)
        .all()
        .map((p) => ({ id: p.id, name: p.name, rootPath: p.rootPath })),
    listWorkflows: () =>
      db.db
        .select()
        .from(autonomousMissions)
        .orderBy(desc(autonomousMissions.createdAt))
        .limit(20)
        .all()
        .map((w) => ({ id: w.id, goal: w.acceptance, status: w.status, createdAt: w.createdAt })),
    createWorkflow: (goal) => {
      const id = randomUUID();
      const now = new Date().toISOString();
      db.db
        .insert(autonomousMissions)
        .values({
          id,
          acceptance: goal.trim(),
          status: 'paused',
          maxDurationMs: 600_000,
          startedAt: now,
          createdAt: now,
          updatedAt: now,
        })
        .run();
      return { id, goal: goal.trim(), status: 'paused' };
    },
    getTelemetry: () => ({
      platform: `${os.platform()} ${os.release()}`,
      cpus: os.cpus().length,
      freeMemMb: Math.round(os.freemem() / 1024 / 1024),
      totalMemMb: Math.round(os.totalmem() / 1024 / 1024),
      uptimeSec: Math.round(os.uptime()),
      rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    }),
    discoverEcosystemPeers: () => (options.discoveryDir ? discoverPeers(options.discoveryDir) : []),
    issuePairingToken: (targetApp, scopes) => {
      const tokenId = randomUUID();
      const secret = randomUUID();
      auth.issue({
        tokenId,
        secret,
        originApp: 'orchestrator',
        targetApp,
        scopes,
      });
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
            originApp: 'orchestrator',
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            scopes: ['tasks:delegate'],
            timeoutMs: 30_000,
          },
          kind: 'delegate',
          capability,
          input: { prompt },
        });
      } catch (err) {
        return {
          fallbackLocal: true,
          reason: err instanceof Error ? err.message : 'peer_unreachable',
        };
      }
    },
    close: async () => {
      if (options.discoveryDir) removeDiscoveryRecord(options.discoveryDir, 'orchestrator');
      await server.close();
      db.close();
    },
  };
}
