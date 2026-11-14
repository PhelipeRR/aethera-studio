import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { ClaudeCliAdapter, CodexCliAdapter } from '@neuralbridge/agents';
import { detectAntigravityCli, runAntigravityPrompt } from './antigravity-cli.js';
import { openDatabase, VelixChannelRepository, VelixProductionRepository, videoProjects, type DatabaseHandle } from '@neuralbridge/database';
import {
  CONTRACT_SCHEMA_VERSION,
  DATA_OWNERSHIP_BOUNDARIES,
  IntegrationAuthRegistry,
  defaultPipePath,
  discoverPeers,
  removeDiscoveryRecord,
  startLoopbackIntegrationServer,
  writeDiscoveryRecord,
  type AgentProviderId,
  type AppId,
  type IAgentProviderContract,
  type IntegrationScope,
  type LoopbackIntegrationServerHandle,
  type PeerDiscoveryRecord,
} from '@neuralbridge/integration-contracts';
import {
  buildAutonomousPipelineDag,
  detectScheduleConflicts,
  generateVideoMetadata,
  interpretPromptToBrief,
  planEditorialCalendar,
  refineMetadataByPrompt,
  type AetheraCalendarItem,
  type AetheraChannelProfile,
  type AetheraVideoMetadata,
} from '@neuralbridge/orchestrator';
import { planAetheraProductionCommand } from '@neuralbridge/shared';
import { motionMediaTools } from '@neuralbridge/workspace';
import { eq } from 'drizzle-orm';

export interface AetheraRuntimeOptions {
  dataDir: string;
  migrationsFolder: string;
  version?: string;
  agents?: readonly IAgentProviderContract[];
  discoveryDir?: string;
  ipcPath?: string;
  requireAuth?: boolean;
}

export interface AetheraRuntimeHandle {
  dbPath: string;
  db: DatabaseHandle;
  auth: IntegrationAuthRegistry;
  server: LoopbackIntegrationServerHandle;
  availableAgents(): Promise<AgentProviderId[]>;
  listRuns(): { id: string; topic: string; status: string; agent: string | null; createdAt: string }[];
  produceFromPrompt(prompt: string): Promise<{
    runId: string;
    agent: AgentProviderId;
    dagStages: number;
    dagNames: string[];
    metadata: AetheraVideoMetadata;
  }>;
  planCalendar(prompt: string): { items: AetheraCalendarItem[]; conflicts: number };
  refineMetadata(metadata: AetheraVideoMetadata, instruction: string): AetheraVideoMetadata;
  planRevisionCommand(instruction: string): { summary: string; affectedStages: string[] };
  listChannels(): Array<{ id: string; name: string; platform: string; language: string }>;
  checkMediaTools(): Promise<{ ffmpeg: boolean; ffprobe: boolean; ytdlp: boolean }>;
  discoverEcosystemPeers(): PeerDiscoveryRecord[];
  issuePairingToken(targetApp: AppId, scopes: readonly IntegrationScope[]): { tokenId: string; secret: string };
  revokePairingToken(tokenId: string): boolean;
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
    wrap('claude', claude, ['creative_direction', 'script', 'narrative_review', 'validation', 'execution']),
    wrap('codex', codex, ['remotion_composition', 'automation', 'technical_fix', 'execution', 'script']),
    {
      id: 'antigravity',
      getCapabilities: () => ['execution', 'validation', 'creative_direction', 'script'],
      isAvailable: async () => {
        const status = await detectAntigravityCli();
        return status.installed && status.problems.length === 0;
      },
      execute: async ({ prompt }) => runAntigravityPrompt({ prompt, cwd: process.cwd(), mode: 'read-only' }),
    },
  ];
}

const DEFAULT_CHANNEL: AetheraChannelProfile = {
  id: 'default-youtube',
  platform: 'youtube',
  name: 'Canal Principal',
  language: 'pt-BR',
  audience: 'geral',
  visualStyle: 'cinematográfico',
  connected: false,
  autopilot: {
    enabled: false,
    frequencyPerWeek: 3,
    preferredWeekdays: [1, 3, 5],
    preferredTime: '18:00',
    timezone: 'America/Sao_Paulo',
    themes: ['Conteúdo Principal'],
    approvalPolicy: 'manual',
  },
};

export async function startAetheraRuntime(options: AetheraRuntimeOptions): Promise<AetheraRuntimeHandle> {
  const dbPath = join(options.dataDir, DATA_OWNERSHIP_BOUNDARIES.aethera.sqliteDbName);
  const db = openDatabase(dbPath, { migrationsFolder: options.migrationsFolder });
  const repo = new VelixProductionRepository(db);
  const channelRepo = new VelixChannelRepository(db.db);
  const auth = new IntegrationAuthRegistry();
  const agents = options.agents ?? defaultAgentContracts();
  const capabilities = ['video.produce', 'video.edit_by_prompt', 'channel.metadata', 'channel.calendar', 'remotion.render'];
  const version = options.version ?? '0.1.65';
  const ipcPath = options.ipcPath ?? defaultPipePath('aethera', `${process.pid}-${randomUUID().slice(0, 6)}`);

  const projectId = 'aethera-default';
  if (!db.db.select().from(videoProjects).where(eq(videoProjects.id, projectId)).get()) {
    db.db
      .insert(videoProjects)
      .values({ id: projectId, name: 'Aethera Studio', rootPath: options.dataDir })
      .run();
  }

  const availableAgents = async (): Promise<AgentProviderId[]> => {
    const out: AgentProviderId[] = [];
    for (const a of agents) {
      if (await a.isAvailable()) out.push(a.id);
    }
    return out;
  };

  const server = await startLoopbackIntegrationServer({
    appId: 'aethera',
    version,
    capabilities,
    agents,
    auth,
    requireAuth: options.requireAuth ?? false,
    ...(options.ipcPath ? { ipcPath: options.ipcPath } : {}),
  });

  if (options.discoveryDir) {
    writeDiscoveryRecord(options.discoveryDir, {
      appId: 'aethera',
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
    availableAgents,
    listRuns: () =>
      repo.listRuns(projectId).map((r) => {
        const parsed = JSON.parse(r.brief) as { topic?: string };
        return { id: r.id, topic: parsed.topic ?? 'Produção', status: r.status, agent: r.agent, createdAt: r.createdAt };
      }),
    produceFromPrompt: async (prompt: string) => {
      const active = await availableAgents();
      if (!active.length) {
        throw new Error('unavailable: Nenhum agente operacional (Claude, Codex ou Antigravity) disponível.');
      }
      const chosen = active[0] ?? 'claude';
      const brief = interpretPromptToBrief(prompt, projectId);
      const dag = buildAutonomousPipelineDag(brief, options.dataDir);
      const run = repo.createRun({
        projectId,
        brief,
        estimatedCostUsd: brief.budgetUsd,
        agent: chosen === 'codex' ? 'codex' : 'claude',
      });
      const metadata = generateVideoMetadata(brief, { channelName: DEFAULT_CHANNEL.name });
      return {
        runId: run.id,
        agent: chosen,
        dagStages: dag.length,
        dagNames: dag.map((s) => s.id),
        metadata,
      };
    },
    planCalendar: (prompt: string) => {
      const items = planEditorialCalendar({
        prompt,
        channel: DEFAULT_CHANNEL,
        weeks: 1,
      });
      const conflicts = detectScheduleConflicts(items).length;
      return { items, conflicts };
    },
    refineMetadata: (metadata, instruction) => refineMetadataByPrompt(metadata, instruction),
    planRevisionCommand: (instruction) => {
      const planned = planAetheraProductionCommand({ command: instruction });
      return {
        summary: planned.topic ?? instruction,
        affectedStages: planned.steps.map((step) => step.kind),
      };
    },
    listChannels: () => {
      const identity = channelRepo.loadIdentity(projectId);
      if (!identity) {
        return [{ id: DEFAULT_CHANNEL.id, name: DEFAULT_CHANNEL.name, platform: DEFAULT_CHANNEL.platform, language: DEFAULT_CHANNEL.language }];
      }
      return [{ id: projectId, name: identity.name ?? DEFAULT_CHANNEL.name, platform: 'youtube', language: DEFAULT_CHANNEL.language }];
    },
    checkMediaTools: async () => {
      try {
        const tools = await motionMediaTools(options.dataDir);
        return { ffmpeg: Boolean(tools?.ffmpeg), ffprobe: Boolean(tools?.ffprobe), ytdlp: false };
      } catch {
        return { ffmpeg: false, ffprobe: false, ytdlp: false };
      }
    },
    discoverEcosystemPeers: () => (options.discoveryDir ? discoverPeers(options.discoveryDir) : []),
    issuePairingToken: (targetApp, scopes) => {
      const tokenId = randomUUID();
      const secret = randomUUID();
      auth.issue({ tokenId, secret, originApp: 'aethera', targetApp, scopes });
      return { tokenId, secret };
    },
    revokePairingToken: (tokenId) => auth.revoke(tokenId),
    close: async () => {
      if (options.discoveryDir) removeDiscoveryRecord(options.discoveryDir, 'aethera');
      await server.close();
      db.close();
    },
  };
}
