import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DATA_OWNERSHIP_BOUNDARIES } from '@neuralbridge/integration-contracts';
import { startVoidRuntime } from '../src/main/runtime.js';

const MIGRATIONS_FOLDER = join(process.cwd(), 'packages', 'database', 'migrations');

describe('Void Standalone App (SEP-05)', () => {
  it('initializes private void-assistant.db, persists notifications across restarts, and operates without Orchestrator/Aethera', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'void-sep05-'));

    try {
      const runtime1 = await startVoidRuntime({
        dataDir,
        migrationsFolder: MIGRATIONS_FOLDER,
        orchestratorTransport: null,
        aetheraTransport: null,
        agents: [
          {
            id: 'claude',
            getCapabilities: () => ['assistant', 'memory'],
            isAvailable: async () => false,
            execute: async () => ({ ok: false, output: '' }),
          },
          {
            id: 'codex',
            getCapabilities: () => ['assistant', 'execution'],
            isAvailable: async () => true,
            execute: async ({ prompt }) => ({ ok: true, output: `codex-void:${prompt}` }),
          },
        ],
      });

      expect(runtime1.dbPath.endsWith(DATA_OWNERSHIP_BOUNDARIES.void.sqliteDbName)).toBe(true);
      expect(await runtime1.checkEcosystemPeers()).toEqual({ orchestrator: false, aethera: false });
      expect(await runtime1.availableAgents()).toEqual(['codex']);

      const created = runtime1.pushNotification({
        title: 'Revisar roteiro do canal às 18h',
        channel: 'reminder',
        priority: 'high',
      });
      const reply = await runtime1.askAssistant({ prompt: 'Qual meu foco de hoje?' });
      expect(reply).toEqual({ agent: 'codex', reply: 'codex-void:Qual meu foco de hoje?' });

      const healthRes = await runtime1.server.dispatch({ method: 'GET', url: '/v1/health' });
      expect(healthRes.status).toBe(200);
      expect((healthRes.body as { appId: string }).appId).toBe('void');

      const capsRes = await runtime1.server.dispatch({ method: 'GET', url: '/v1/capabilities' });
      expect(capsRes.status).toBe(200);
      expect((capsRes.body as { capabilities: string[] }).capabilities).toContain('notifications.push');

      await runtime1.close();

      // Reopen to verify SQLite persistence across restart
      const runtime2 = await startVoidRuntime({
        dataDir,
        migrationsFolder: MIGRATIONS_FOLDER,
      });
      const persisted = runtime2.listNotifications();
      expect(persisted.some((n) => n.id === created.id && n.title === 'Revisar roteiro do canal às 18h')).toBe(true);
      expect(runtime2.markNotificationRead(created.id)).toBe(true);
      expect(runtime2.listNotifications(true).some((n) => n.id === created.id)).toBe(false);
      await runtime2.close();
    } finally {
      try {
        rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      } catch {
        // Windows SQLite WAL handle cleanup fallback
      }
    }
  });

  it('declares isolated Void installer identity in electron-builder.yml', () => {
    const yml = readFileSync(join(process.cwd(), 'apps', 'void-desktop', 'electron-builder.yml'), 'utf-8');
    expect(yml).toContain('appId: com.singularity.void');
    expect(yml).toContain('executableName: Void');
    expect(yml).toContain('output: ../../dist/void');
  });

  it('wires SEP-09 parity UI routes and real voice/meetings/OAuth/Spotify/HUD IPC handlers without Orchestrator or Aethera', () => {
    const rendererMain = readFileSync(join(process.cwd(), 'apps', 'void-desktop', 'src', 'renderer', 'src', 'main.tsx'), 'utf-8');
    for (const marker of ['PersonalAgentPage', 'CompanionHud', 'ExtensionsPage', 'AgentsPage', 'SettingsPage']) {
      expect(rendererMain).toContain(marker);
    }

    const domainIpc = readFileSync(join(process.cwd(), 'apps', 'void-desktop', 'src', 'main', 'void-ipc.ts'), 'utf-8');
    for (const handler of ['registerPersonalIpcHandlers', 'registerNeuraIpc', 'SpotifyService', 'CompanionHudController', 'SystemAudioSource', 'VoiceStudioWhisperProvider']) {
      expect(domainIpc).toContain(handler);
    }

    const preload = readFileSync(join(process.cwd(), 'apps', 'void-desktop', 'src', 'preload', 'index.ts'), 'utf-8');
    expect(preload).toContain('desktop-shared/src/preload/index');
    expect(preload).not.toContain('../desktop/');
    expect(domainIpc).not.toContain('../desktop/');
  });
});
