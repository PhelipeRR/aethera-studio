import { mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { imageExtension } from './velix-research.js';
import { runVelixCommand, velixVideoSlug } from './velix.js';

export type VelixCaptureScreen = { name: string; path: string };
export type VelixCapturePlan = { kind: 'web' | 'electron'; command: string; url: string; env: Record<string, string>; screens: VelixCaptureScreen[] };
export type VelixCaptureSize = { width: number; height: number };
export type VelixCaptureResult = { saved: string[]; failed: string[] };
/** Takes one picture of a web page; the desktop app passes an isolated hidden window. */
export type VelixPageCapture = (url: string, size: VelixCaptureSize) => Promise<Buffer>;
export type VelixCaptureRequest = { root: string; video: string; targetRoot: string; plan: VelixCapturePlan; size: VelixCaptureSize; capture: VelixPageCapture; confirmed: boolean; startTimeoutMs?: number; settleMs?: number };

const START_TIMEOUT_MS = 120_000;
const SETTLE_MS = 1_500;
const COMMAND_TIMEOUT_MS = 20_000;
const MAX_SCREENS = 12;
const EXECUTABLES = new Set(['npm', 'pnpm', 'yarn', 'bun', 'npx', 'node']);
const SAFE_TOKEN = /^[\w@:./\\=+-]+$/;
const PRINT_FILE = /^[\w-]+\.png$/;

/** One plain program call: no shell operators, because the command may have been proposed from repository content. */
export function parseCaptureCommand(command: string): string[] {
  const tokens = command.trim().split(/\s+/);
  if (!EXECUTABLES.has(tokens[0] ?? '') || !tokens.every((token) => SAFE_TOKEN.test(token))) throw new Error('invalid: use um comando simples de npm, pnpm, yarn, bun, npx ou node, sem operadores.');
  return tokens;
}

export function localCaptureUrl(raw: string): URL {
  const url = new URL(raw);
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !['localhost', '127.0.0.1'].includes(url.hostname)) throw new Error('invalid: o endereço deve ser local, como http://localhost:3000.');
  return url;
}

export function validateCapturePlan(plan: VelixCapturePlan): string[] {
  const tokens = parseCaptureCommand(plan.command);
  const url = localCaptureUrl(plan.url);
  if (plan.screens.length === 0 || plan.screens.length > MAX_SCREENS) throw new Error(`invalid: escolha de 1 a ${MAX_SCREENS} telas.`);
  if (Object.keys(plan.env).some((name) => !/^[A-Z][A-Z0-9_]*$/.test(name))) throw new Error('invalid: variável de ambiente inválida.');
  if (plan.kind === 'electron' && !tokens.includes(`--remote-debugging-port=${url.port}`)) throw new Error(`invalid: o comando precisa de --remote-debugging-port=${url.port} para capturar um app Electron.`);
  return tokens;
}

function printsFolder(root: string, video: string): string {
  return join(realpathSync(root), velixVideoSlug(video), 'prints');
}

const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function waitUntil<T>(attempt: () => Promise<T | null>, stopped: () => string | null, timeoutMs: number): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const reason = stopped();
    if (reason !== null) throw new Error(`O comando terminou antes de o app abrir. ${reason}`.trim());
    const value = await attempt().catch(() => null);
    if (value !== null) return value;
    await delay(300);
  }
  throw new Error('O app não abriu a tempo. Confira o comando e o endereço.');
}

type DebugTarget = { type: string; url: string; webSocketDebuggerUrl?: string };

/** Minimal Chrome DevTools client: enough to drive the window of an Electron app with its own preload. */
async function openDebugger(endpoint: string) {
  const socket = new WebSocket(endpoint);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener('open', () => resolve(), { once: true });
    socket.addEventListener('error', () => reject(new Error('Não foi possível conectar ao app.')), { once: true });
  });
  let id = 0;
  const pending = new Map<number, { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void }>();
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string } };
    const call = message.id === undefined ? undefined : pending.get(message.id);
    if (!call || message.id === undefined) return;
    pending.delete(message.id);
    if (message.error) call.reject(new Error(message.error.message));
    else call.resolve(message.result ?? {});
  });
  return {
    send: (method: string, params: object = {}) => new Promise<Record<string, unknown>>((resolve, reject) => {
      id += 1;
      const call = id;
      const timer = setTimeout(() => { pending.delete(call); reject(new Error('O app não respondeu a tempo.')); }, COMMAND_TIMEOUT_MS);
      pending.set(call, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      socket.send(JSON.stringify({ id: call, method, params }));
    }),
    close: () => socket.close(),
  };
}

async function captureElectron(plan: VelixCapturePlan, size: VelixCaptureSize, settleMs: number, stopped: () => string | null, timeoutMs: number): Promise<Map<string, Buffer>> {
  const listing = new URL('/json/list', plan.url).href;
  const target = await waitUntil(async () => {
    const pages = await (await fetch(listing)).json() as DebugTarget[];
    return pages.find((page) => page.type === 'page' && page.webSocketDebuggerUrl && !page.url.startsWith('devtools:')) ?? null;
  }, stopped, timeoutMs);
  const client = await openDebugger(target.webSocketDebuggerUrl ?? '');
  const pictures = new Map<string, Buffer>();
  try {
    await client.send('Emulation.setDeviceMetricsOverride', { width: size.width, height: size.height, deviceScaleFactor: 1, mobile: false });
    await delay(settleMs);
    for (const screen of plan.screens) {
      // Hash routes change in place, so the app keeps its state and its preload.
      if (screen.path.startsWith('#')) await client.send('Runtime.evaluate', { expression: `location.hash = ${JSON.stringify(screen.path)}` });
      else if (screen.path) await client.send('Page.navigate', { url: new URL(screen.path, target.url).href });
      await delay(settleMs);
      const { data } = await client.send('Page.captureScreenshot', { format: 'png' });
      pictures.set(screen.name, Buffer.from(String(data), 'base64'));
    }
  } finally {
    client.close();
  }
  return pictures;
}

async function captureWeb(plan: VelixCapturePlan, size: VelixCaptureSize, capture: VelixPageCapture, stopped: () => string | null, timeoutMs: number): Promise<Map<string, Buffer>> {
  await waitUntil(async () => (await fetch(plan.url)).status > 0 || null, stopped, timeoutMs);
  const pictures = new Map<string, Buffer>();
  for (const screen of plan.screens) pictures.set(screen.name, await capture(new URL(screen.path || '/', plan.url).href, size));
  return pictures;
}

/** Runs the target project with a command the user confirmed, always stopping it afterwards. */
export async function captureVelixPrints(request: VelixCaptureRequest): Promise<VelixCaptureResult> {
  if (request.confirmed !== true) throw new Error('forbidden: confirme que o comando pode rodar.');
  const { plan, size } = request;
  const tokens = validateCapturePlan(plan);
  const folder = printsFolder(request.root, request.video);
  mkdirSync(folder, { recursive: true });
  const controller = new AbortController();
  let exit: string | null = null;
  const [program = '', ...args] = tokens;
  // npm and friends are .cmd files on Windows; every token already passed the check above.
  const launch = process.platform === 'win32' && program !== 'node' ? ['cmd.exe', ['/d', '/s', '/c', program, ...args]] as const : [program, args] as const;
  const running = runVelixCommand(launch[0], [...launch[1]], { cwd: request.targetRoot, signal: controller.signal, env: plan.env }).then(
    () => { exit = ''; },
    (error: unknown) => { exit = error instanceof Error ? error.message.replace(/^\w+: /, '').slice(-300) : ''; },
  );
  const timeoutMs = request.startTimeoutMs ?? START_TIMEOUT_MS;
  const stopped = () => exit;
  try {
    const pictures = plan.kind === 'electron' ? await captureElectron(plan, size, request.settleMs ?? SETTLE_MS, stopped, timeoutMs) : await captureWeb(plan, size, request.capture, stopped, timeoutMs);
    const saved: string[] = [];
    const failed: string[] = [];
    let index = readdirSync(folder).filter((file) => PRINT_FILE.test(file)).length;
    for (const [name, bytes] of pictures) {
      if (imageExtension(bytes) !== 'png') {
        failed.push(name);
        continue;
      }
      index += 1;
      const file = `${String(index).padStart(2, '0')}-${velixVideoSlug(name)}.png`;
      writeFileSync(join(folder, file), bytes);
      saved.push(file);
    }
    return { saved, failed };
  } finally {
    controller.abort();
    await running;
  }
}

export function listVelixPrints(root: string, video: string): Array<{ file: string; image: string }> {
  let files: string[];
  try {
    files = readdirSync(printsFolder(root, video)).filter((file) => PRINT_FILE.test(file)).sort();
  } catch {
    return [];
  }
  return files.map((file) => ({ file, image: `data:image/png;base64,${readFileSync(join(printsFolder(root, video), file)).toString('base64')}` }));
}

export function removeVelixPrint(root: string, video: string, file: string): void {
  if (!PRINT_FILE.test(file)) throw new Error('invalid: arquivo de print inválido.');
  rmSync(join(printsFolder(root, video), file), { force: true });
}
