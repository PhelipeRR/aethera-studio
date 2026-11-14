import { join } from 'node:path';
import { app, BrowserWindow, dialog, nativeTheme } from 'electron';
import { guardMainWindow } from './startup-guard.js';
import type { AppLocation } from './security/navigation.js';

// Mirrors the Singularity header (lote 50.03): the native caption controls sit on the same glass tone as the
// renderer's header, so no black or white strip shows on the right. Values follow --glass-bg-strong over the page.
const CHROME = {
  dark: { background: '#0a1f22', symbol: '#e4e1d6' },
  light: { background: '#fbf9f2', symbol: '#0e2427' },
} as const;

// Keep native caption controls inside the 48px renderer header, above its divider.
const TITLE_BAR_HEIGHT = 40;

function chrome(): (typeof CHROME)[keyof typeof CHROME] {
  return nativeTheme.shouldUseDarkColors ? CHROME.dark : CHROME.light;
}

const mainWindows = new WeakSet<BrowserWindow>();

export interface MainWindowOptions {
  startHidden?: boolean;
  keepInTray?: boolean;
  isQuitting?: () => boolean;
}

export function createMainWindow(location: AppLocation, options: MainWindowOptions = {}): BrowserWindow {
  const colors = chrome();
  const window = new BrowserWindow({
    title: 'Singularity',
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: colors.background,
    icon: join(app.getAppPath(), 'build', 'icon.ico'),
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: colors.background, symbolColor: colors.symbol, height: TITLE_BAR_HEIGHT },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });

  mainWindows.add(window);
  window.once('ready-to-show', () => { if (!options.startHidden) window.show(); });
  if (options.keepInTray) {
    const hideOnMinimize = (): void => { window.hide(); };
    const hideOnClose = (event: Electron.Event): void => {
      if (options.isQuitting?.()) return;
      event.preventDefault();
      window.hide();
    };
    window.on('minimize', hideOnMinimize);
    window.on('close', hideOnClose);
  }

  const load = (): void => {
    if (location.devServerUrl) void window.loadURL(location.devServerUrl);
    else void window.loadFile(location.indexFile);
  };
  // Never a blank or invisible window: a failed or crashed renderer becomes a recovery page with a retry.
  guardMainWindow(window, {
    startHidden: options.startHidden ?? false,
    dataDir: app.getPath('userData'),
    askRetry: async (reason) => (await dialog.showMessageBox(window, { type: 'error', buttons: ['Tentar novamente', 'Fechar'], defaultId: 0, cancelId: 1, noLink: true, title: 'Singularity', message: 'A interface não carregou.', detail: `${reason}. Seus dados não foram alterados.` })).response === 0,
    reload: load,
  });
  load();
  return window;
}

/** Keeps the native title bar buttons in step with the active theme. */
export function syncWindowChrome(): void {
  const colors = chrome();
  for (const window of BrowserWindow.getAllWindows()) {
    // The companion HUD is frameless and transparent, with no title bar to sync. Asked of the window itself, not its URL:
    // a theme event at startup can arrive while the HUD is still empty, and the overlay call would throw.
    if (window.isDestroyed() || !mainWindows.has(window)) continue;
    window.setBackgroundColor(colors.background);
    window.setTitleBarOverlay({ color: colors.background, symbolColor: colors.symbol, height: TITLE_BAR_HEIGHT });
  }
}
