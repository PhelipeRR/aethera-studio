import { existsSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { app, BrowserWindow, ipcMain, net, protocol, safeStorage } from 'electron';
import {
  IntegrationAuthRegistry,
  PeerPairingManager,
  registerPairingIpcHandlers,
} from '@neuralbridge/integration-contracts';
import { hardenApp } from '../../../../packages/desktop-shared/src/main/security/harden.js';
import type { AppLocation } from '../../../../packages/desktop-shared/src/main/security/navigation.js';
import { registerAetheraDomainIpc } from './aethera-ipc.js';
import { startAetheraRuntime, type AetheraRuntimeHandle } from './runtime.js';

app.setName('Aethera Studio');
app.setPath('userData', join(app.getPath('appData'), 'AetheraStudio'));

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'aethera-media',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

let runtime: AetheraRuntimeHandle | null = null;

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
    title: 'Aethera Studio',
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
  protocol.handle('aethera-media', (request) => {
    const url = new URL(request.url);
    const rawPath = url.searchParams.get('path');
    if (!rawPath) {
      return new Response('Missing path', { status: 400 });
    }
    const resolved = resolve(normalize(rawPath));
    const userDataRoot = resolve(app.getPath('userData'));
    const allowedExt = /\.(mp4|mov|webm|mkv|wav|mp3|ogg|png|jpe?g|webp)$/i.test(resolved);
    if (!allowedExt || !existsSync(resolved)) {
      return new Response('Not found', { status: 404 });
    }
    // Restrict to userData or explicitly existing media files
    const inUserData = resolved.toLowerCase().startsWith(userDataRoot.toLowerCase());
    if (!inUserData && !/\.(mp4|mov|webm|wav|mp3|png|jpe?g|webp)$/i.test(resolved)) {
      return new Response('Forbidden', { status: 403 });
    }
    return net.fetch(pathToFileURL(resolved).toString());
  });

  const location: AppLocation = {
    devServerUrl: app.isPackaged ? undefined : process.env['ELECTRON_RENDERER_URL'],
    indexFile: join(__dirname, '../renderer/index.html'),
  };
  hardenApp(location);

  runtime = await startAetheraRuntime({
    dataDir: app.getPath('userData'),
    migrationsFolder: resolveMigrationsFolder(),
    discoveryDir: resolveDiscoveryDir(),
    version: app.getVersion(),
  });

  registerAetheraDomainIpc({
    location,
    migrationsFolder: resolveMigrationsFolder(),
  });

  const pairingManager = new PeerPairingManager({
    selfAppId: 'aethera',
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

  ipcMain.handle('aethera:status', async () => {
    if (!runtime) throw new Error('Runtime não inicializado.');
    return {
      appId: 'aethera' as const,
      dbPath: runtime.dbPath,
      baseUrl: runtime.server.baseUrl,
      agents: await runtime.availableAgents(),
      runs: runtime.listRuns(),
      channels: runtime.listChannels(),
      tools: await runtime.checkMediaTools(),
      peers: runtime.discoverEcosystemPeers(),
    };
  });

  ipcMain.handle('aethera:produce', async (_ev, prompt: string) => {
    if (!runtime) throw new Error('Runtime não inicializado.');
    return runtime.produceFromPrompt(prompt);
  });

  ipcMain.handle('aethera:plan-calendar', async (_ev, prompt: string) => {
    if (!runtime) throw new Error('Runtime não inicializado.');
    return runtime.planCalendar(prompt);
  });

  ipcMain.handle('aethera:revise-command', async (_ev, instruction: string) => {
    if (!runtime) throw new Error('Runtime não inicializado.');
    return runtime.planRevisionCommand(instruction);
  });

  ipcMain.handle('aethera:pair-peer', async (_ev, targetApp: 'orchestrator' | 'void') => {
    if (!runtime) throw new Error('Runtime não inicializado.');
    return runtime.issuePairingToken(targetApp, ['health:read', 'capabilities:read', 'tasks:delegate', 'events:subscribe']);
  });

  createWindow();
});

app.on('will-quit', async () => {
  await runtime?.close();
});
