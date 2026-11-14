import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startOrchestratorRuntime } from '../src/main/runtime.js';

describe('SEP-03 Singularity Orchestrator standalone app', () => {
  it('initializes isolated DB, persists tasks across restart, and serves loopback contracts with single-agent fallback', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'sep03-orch-'));
    const migrationsFolder = resolve('packages/database/migrations');

    const soloCodex = [
      {
        id: 'claude' as const,
        getCapabilities: () => ['script'],
        isAvailable: async () => false,
        execute: async () => ({ ok: false, output: '' }),
      },
      {
        id: 'codex' as const,
        getCapabilities: () => ['automation'],
        isAvailable: async () => true,
        execute: async ({ taskId }: { taskId: string }) => ({ ok: true, output: `codex:${taskId}:ok` }),
      },
    ];

    try {
      const rt1 = await startOrchestratorRuntime({ dataDir, migrationsFolder, agents: soloCodex });
      expect(rt1.dbPath.endsWith('singularity-orchestrator.db')).toBe(true);

      const created = await rt1.createTask({ prompt: 'Auditar módulos do workspace' });
      expect(created.agent).toBe('codex');

      const healthRes = await rt1.server.dispatch({ method: 'GET', url: '/v1/health' });
      const health = healthRes.body as { appId: string; standalone: boolean };
      expect(health.appId).toBe('orchestrator');
      expect(health.standalone).toBe(true);

      const capsRes = await rt1.server.dispatch({ method: 'GET', url: '/v1/capabilities' });
      const caps = capsRes.body as { availableAgents: string[] };
      expect(caps.availableAgents).toEqual(['codex']);

      const delegatedRes = await rt1.server.dispatch({
        method: 'POST',
        url: '/v1/tasks',
        body: {
          envelope: {
            requestId: 'req-orch-1',
            correlationId: 'cor-orch-1',
            idempotencyKey: 'idem-orch-1',
            schemaVersion: '1.0',
            originApp: 'void',
            scopes: ['tasks:delegate'],
            timeoutMs: 5_000,
          },
          kind: 'run_workflow',
          capability: 'script',
          input: { target: 'repo' },
        },
      });
      const delegated = delegatedRes.body as { status: string; executedByAgent: string };
      expect(delegated.status).toBe('completed');
      expect(delegated.executedByAgent).toBe('codex');

      await rt1.close();

      // Reopen to verify SQLite persistence across restart
      const rt2 = await startOrchestratorRuntime({ dataDir, migrationsFolder, agents: soloCodex });
      const persisted = rt2.listTasks();
      expect(persisted.some((t) => t.id === created.id && t.prompt === 'Auditar módulos do workspace')).toBe(true);
      await rt2.close();
    } finally {
      try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* Windows WAL cleanup */ }
    }
  });

  it('defines isolated appId and executableName in electron-builder.yml', () => {
    const yml = readFileSync(resolve('apps/orchestrator-desktop/electron-builder.yml'), 'utf8');
    expect(yml).toContain('appId: com.singularity.orchestrator');
    expect(yml).toContain('executableName: SingularityOrchestrator');
  });

  it('wires SEP-09 parity UI routes and real domain IPC handlers without depending on Aethera or Void', () => {
    const rendererMain = readFileSync(resolve('apps/orchestrator-desktop/src/renderer/src/main.tsx'), 'utf8');
    for (const marker of ['Brain3DPage', 'GalaxyPage', 'WorkflowsPage', 'GitIntelligencePage', 'AzureDevOpsPage', 'SkillsPage', 'McpPage', 'MonitoringPage']) {
      expect(rendererMain).toContain(marker);
    }

    const domainIpc = readFileSync(resolve('apps/orchestrator-desktop/src/main/orchestrator-ipc.ts'), 'utf8');
    for (const handler of ['createBrainService', 'createWorkflowService', 'registerGitIpcHandlers', 'AzureDevOpsRepository', 'registerSkillsCatalogIpcHandlers', 'createMcpService', 'registerMonitoringIpcHandlers']) {
      expect(domainIpc).toContain(handler);
    }

    const preload = readFileSync(resolve('apps/orchestrator-desktop/src/preload/index.ts'), 'utf8');
    expect(preload).toContain('desktop-shared/src/preload/index');
    expect(preload).not.toContain('../desktop/');
    expect(domainIpc).not.toContain('../desktop/');
  });
});
