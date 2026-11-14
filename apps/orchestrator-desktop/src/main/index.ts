import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app, BrowserWindow, ipcMain, safeStorage } from 'electron';
import {
  IntegrationAuthRegistry,
  PeerPairingManager,
  registerPairingIpcHandlers,
} from '@neuralbridge/integration-contracts';
import { hardenApp } from '../../../../packages/desktop-shared/src/main/security/harden.js';
import type { AppLocation } from '../../../../packages/desktop-shared/src/main/security/navigation.js';
import { registerOrchestratorDomainIpc } from './orchestrator-ipc.js';
import { startOrchestratorRuntime, type OrchestratorRuntimeHandle } from './runtime.js';

app.setName('Singularity Orchestrator');
app.setPath('userData', join(app.getPath('appData'), 'SingularityOrchestrator'));

let runtime: OrchestratorRuntimeHandle | null = null;

function resolveMigrationsFolder(): string {
  const resourcesMigrations = join(process.resourcesPath, 'migrations');
  if (existsSync(resourcesMigrations)) return resourcesMigrations;
  const packaged = join(dirname(__dirname), 'main', 'migrations');
  if (existsSync(packaged)) return packaged;
  return join(process.cwd(), 'packages', 'database', 'migrations');
}

function resolveDiscoveryDir(): string {
  return join(app.getPath('appData'), 'SingularityEcosystem', 'discovery');
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'Singularity Orchestrator',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

void app.whenReady().then(async () => {
  const location: AppLocation = {
    devServerUrl: app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'],
    indexFile: join(__dirname, '../renderer/index.html'),
  };
  hardenApp(location);

  runtime = await startOrchestratorRuntime({
    dataDir: app.getPath('userData'),
    migrationsFolder: resolveMigrationsFolder(),
    discoveryDir: resolveDiscoveryDir(),
    version: app.getVersion(),
  });

  registerOrchestratorDomainIpc({
    location,
    migrationsFolder: resolveMigrationsFolder(),
  });

  const pairingManager = new PeerPairingManager({
    selfAppId: 'orchestrator',
    discoveryDir: resolveDiscoveryDir(),
    storageFile: join(app.getPath('userData'), 'ecosystem-pairings.json'),
    authRegistry: new IntegrationAuthRegistry(),
    ...(safeStorage.isEncryptionAvailable()
      ? {
          secretCipher: {
            encrypt: (plain: string) => safeStorage.encryptString(plain).toString('base64'),
            decrypt: (cipher: string) => safeStorage.decryptString(Buffer.from(cipher, 'base64')),
          },
        }
      : {}),
  });
  registerPairingIpcHandlers(ipcMain, pairingManager);

  ipcMain.handle('orchestrator:status', async () => {
    if (!runtime) throw new Error('Runtime não inicializado.');
    return {
      appId: 'orchestrator' as const,
      dbPath: runtime.dbPath,
      baseUrl: runtime.server.baseUrl,
      agents: await runtime.availableAgents(),
      tasks: runtime.listTasks(),
      memories: runtime.listMemories(),
      skills: await runtime.listSkills(),
      projects: runtime.listProjects(),
      workflows: runtime.listWorkflows(),
      telemetry: runtime.getTelemetry(),
      peers: runtime.discoverEcosystemPeers(),
    };
  });

  ipcMain.handle('orchestrator:create-task', async (_ev, input: { prompt: string; cwd?: string }) => {
    if (!runtime) throw new Error('Runtime não inicializado.');
    return runtime.createTask(input);
  });

  ipcMain.handle('orchestrator:remember', async (_ev, input: { title: string; content: string; tags?: string[] }) => {
    if (!runtime) throw new Error('Runtime não inicializado.');
    return runtime.rememberMemory(input);
  });

  ipcMain.handle('orchestrator:search-memory', async (_ev, query: string) => {
    if (!runtime) throw new Error('Runtime não inicializado.');
    return runtime.searchMemories(query);
  });

  ipcMain.handle('orchestrator:create-workflow', async (_ev, goal: string) => {
    if (!runtime) throw new Error('Runtime não inicializado.');
    return runtime.createWorkflow(goal);
  });

  ipcMain.handle('orchestrator:pair-peer', async (_ev, targetApp: 'aethera' | 'void') => {
    if (!runtime) throw new Error('Runtime não inicializado.');
    return runtime.issuePairingToken(targetApp, ['health:read', 'capabilities:read', 'tasks:delegate', 'events:subscribe']);
  });

  createWindow();
});

app.on('will-quit', async () => {
  await runtime?.close();
});
