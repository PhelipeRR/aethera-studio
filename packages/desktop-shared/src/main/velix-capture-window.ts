import { randomUUID } from 'node:crypto';
import { BrowserWindow } from 'electron';

const SETTLE_MS = 1_500;
const SHOT_TIMEOUT_MS = 20_000;

function limited<T>(work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('A página não respondeu a tempo.')), SHOT_TIMEOUT_MS); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

/** Pictures run in a throwaway window: sandboxed, with no preload and a session of its own. */
export async function capturePageInWindow(url: string, size: { width: number; height: number }): Promise<Buffer> {
  const window = new BrowserWindow({
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, partition: `velix-capture-${randomUUID()}` },
  });
  try {
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    // Windows clamps a window to the screen, so the exact size comes from device emulation instead.
    await limited(window.loadURL(url));
    const devtools = window.webContents.debugger;
    devtools.attach('1.3');
    await devtools.sendCommand('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: false });
    await new Promise((done) => setTimeout(done, SETTLE_MS));
    const { data } = await limited(devtools.sendCommand('Page.captureScreenshot', { format: 'png' })) as { data: string };
    return Buffer.from(data, 'base64');
  } finally {
    window.destroy();
  }
}
