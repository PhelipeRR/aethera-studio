import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { app, BrowserWindow, ipcMain, Menu, protocol, safeStorage } from 'electron';
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
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null);
  }

  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    title: 'Aethera Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.platform !== 'darwin') {
    win.setMenu(null);
    win.setMenuBarVisibility(false);
  }

  // Preserve essential keyboard shortcuts without native menu bar
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const isAccel = input.control || input.meta;
    if (input.key === 'F12' || (isAccel && input.shift && input.key.toLowerCase() === 'i')) {
      event.preventDefault();
      win.webContents.toggleDevTools();
      return;
    }
    if (!app.isPackaged && (input.key === 'F5' || (isAccel && input.key.toLowerCase() === 'r'))) {
      event.preventDefault();
      win.webContents.reload();
    }
  });

  // Preserve right-click context menu for editable inputs and text selection
  win.webContents.on('context-menu', (_event, params) => {
    const template: Electron.MenuItemConstructorOptions[] = [];
    if (params.isEditable) {
      template.push(
        { role: 'undo', label: 'Desfazer', enabled: params.editFlags.canUndo },
        { role: 'redo', label: 'Refazer', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', label: 'Recortar', enabled: params.editFlags.canCut },
        { role: 'copy', label: 'Copiar', enabled: params.editFlags.canCopy },
        { role: 'paste', label: 'Colar', enabled: params.editFlags.canPaste },
        { type: 'separator' },
        { role: 'selectAll', label: 'Selecionar tudo', enabled: params.editFlags.canSelectAll },
      );
    } else if (params.selectionText.trim().length > 0) {
      template.push({ role: 'copy', label: 'Copiar' });
    }
    if (template.length > 0) {
      Menu.buildFromTemplate(template).popup({ window: win });
    }
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

const MEDIA_MIME_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function serveMediaWithRanges(filePath: string, request: Request): Response {
  const stat = statSync(filePath);
  const fileSize = stat.size;
  const contentType = MEDIA_MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const rangeHeader = request.headers.get('range');

  if (!rangeHeader) {
    const stream = Readable.toWeb(createReadStream(filePath)) as ReadableStream;
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(fileSize),
        'Accept-Ranges': 'bytes',
      },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(rangeHeader.trim());
  if (!match) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${fileSize}` },
    });
  }

  const startStr = match[1] ?? '';
  const endStr = match[2] ?? '';
  let start = startStr ? Number.parseInt(startStr, 10) : 0;
  let end = endStr ? Number.parseInt(endStr, 10) : fileSize - 1;
  if (!startStr && endStr) {
    const suffixLen = Number.parseInt(endStr, 10);
    start = Math.max(0, fileSize - suffixLen);
    end = fileSize - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= fileSize || end < start) {
    return new Response(null, {
      status: 416,
      headers: { 'Content-Range': `bytes */${fileSize}` },
    });
  }
  end = Math.min(end, fileSize - 1);

  const chunkSize = end - start + 1;
  const stream = Readable.toWeb(createReadStream(filePath, { start, end })) as ReadableStream;
  return new Response(stream, {
    status: 206,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(chunkSize),
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
    },
  });
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
    return serveMediaWithRanges(resolved, request);
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
