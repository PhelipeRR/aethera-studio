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
import { registerVoidDomainIpc } from './void-ipc.js';
import { startVoidRuntime, type VoidRuntimeHandle } from './runtime.js';

app.setName('Void');
app.setPath('userData', join(app.getPath('appData'), 'Void'));

let runtime: VoidRuntimeHandle | null = null;

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
    width: 1180,
    height: 780,
    title: 'Void — Personal AI Assistant',
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

  runtime = await startVoidRuntime({
    dataDir: app.getPath('userData'),
    migrationsFolder: resolveMigrationsFolder(),
    discoveryDir: resolveDiscoveryDir(),
    version: app.getVersion(),
  });

  registerVoidDomainIpc({
    location,
    migrationsFolder: resolveMigrationsFolder(),
  });

  const pairingManager = new PeerPairingManager({
    selfAppId: 'void',
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

  ipcMain.handle('void:status', async () => {
    if (!runtime) throw new Error('Runtime não inicializado.');
    return {
      appId: 'void' as const,
      dbPath: runtime.dbPath,
      baseUrl: runtime.server.baseUrl,
      agents: await runtime.availableAgents(),
      peers: runtime.discoverEcosystemPeers(),
      notifications: runtime.listNotifications(),
      automations: runtime.listAutomations(),
      accounts: runtime.listConnectedAccounts(),
    };
  });

  ipcMain.handle(
    'void:push-notification',
    async (
      _ev,
      input: { title: string; channel?: string; priority?: 'low' | 'normal' | 'high' | 'urgent' },
    ) => {
      if (!runtime) throw new Error('Runtime não inicializado.');
      return runtime.pushNotification(input);
    },
  );

  ipcMain.handle('void:mark-read', async (_ev, id: string) => {
    if (!runtime) throw new Error('Runtime não inicializado.');
    return runtime.markNotificationRead(id);
  });

  ipcMain.handle('void:create-automation', async (_ev, input: { title: string; intervalMs?: number }) => {
    if (!runtime) throw new Error('Runtime não inicializado.');
    return runtime.createAutomation(input);
  });

  ipcMain.handle('void:ask', async (_ev, input: { prompt: string }) => {
    if (!runtime) throw new Error('Runtime não inicializado.');
    return runtime.askAssistant(input);
  });

  createWindow();
});

app.on('will-quit', async () => {
  await runtime?.close();
});
