import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startAetheraRuntime } from '../src/main/runtime.js';

describe('SEP-04 Aethera Studio standalone app', () => {
  it('runs autonomous prompt-to-production, metadata, and calendar without Orchestrator or Void', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'sep04-aethera-'));
    const migrationsFolder = resolve('packages/database/migrations');

    const soloClaude = [
      {
        id: 'claude' as const,
        getCapabilities: () => ['creative_direction', 'script'],
        isAvailable: async () => true,
        execute: async ({ taskId }: { taskId: string }) => ({ ok: true, output: `claude:${taskId}:ok` }),
      },
      {
        id: 'codex' as const,
        getCapabilities: () => ['automation'],
        isAvailable: async () => false,
        execute: async () => ({ ok: false, output: '' }),
      },
    ];

    try {
      const rt1 = await startAetheraRuntime({ dataDir, migrationsFolder, agents: soloClaude });
      expect(rt1.dbPath.endsWith('aethera-studio.db')).toBe(true);

      const produced = await rt1.produceFromPrompt('Crie um vídeo de 10 minutos sobre Elden Ring');
      expect(produced.agent).toBe('claude');
      expect(produced.dagStages).toBe(12);
      expect(produced.metadata.title).toContain('Elden Ring');

      const cal = rt1.planCalendar('3 vídeos por semana segunda, quarta e sexta às 18h');
      expect(cal.items).toHaveLength(3);
      expect(typeof cal.conflicts).toBe('number');

      const healthRes = await rt1.server.dispatch({ method: 'GET', url: '/v1/health' });
      expect((healthRes.body as { appId: string }).appId).toBe('aethera');

      await rt1.close();

      // Reopen and verify persistence
      const rt2 = await startAetheraRuntime({ dataDir, migrationsFolder, agents: soloClaude });
      const runs = rt2.listRuns();
      expect(runs.some((r) => r.id === produced.runId)).toBe(true);
      await rt2.close();
    } finally {
      try { rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* Windows WAL cleanup */ }
    }
  });

  it('defines isolated appId and executableName in electron-builder.yml', () => {
    const yml = readFileSync(resolve('apps/aethera-desktop/electron-builder.yml'), 'utf8');
    expect(yml).toContain('appId: com.singularity.aethera');
    expect(yml).toContain('executableName: AetheraStudio');
  });

  it('wires SEP-09 parity UI routes and real Aethera/Remotion/YouTube IPC handlers without Orchestrator or Void', () => {
    const rendererMain = readFileSync(resolve('apps/aethera-desktop/src/renderer/src/main.tsx'), 'utf8');
    for (const marker of ['AetheraStudioHome', 'AetheraProjectsPage', 'AetheraStudioEditor', 'AetheraReviewRoomPage', 'CinemaDirectorPanel', 'VelixPage', 'AetheraProductionWorkspace', 'ContentCalendarPage', 'ContentChannelSetupPage', 'ContentPackagePage', 'ContentVariantsPage']) {
      expect(rendererMain).toContain(marker);
    }

    const domainIpc = readFileSync(resolve('apps/aethera-desktop/src/main/aethera-ipc.ts'), 'utf8');
    for (const handler of ['registerContentOperatingSystemIpcHandlers', 'videoChannelOAuthConnect', 'renderMotionProject', 'aceStepInstrumentalRequest', 'runAetheraReviewCycles', 'DerivativeService']) {
      expect(domainIpc).toContain(handler);
    }

    const preload = readFileSync(resolve('apps/aethera-desktop/src/preload/index.ts'), 'utf8');
    expect(preload).toContain('desktop-shared/src/preload/index');
    expect(preload).not.toContain('../desktop/');
    expect(domainIpc).not.toContain('../desktop/');
  });
});
