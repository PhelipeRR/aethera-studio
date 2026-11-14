import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureVelixPrints, listVelixPrints, localCaptureUrl, parseCaptureCommand, removeVelixPrint, validateCapturePlan, type VelixCapturePlan } from '../src/velix-capture.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const size = { width: 1080, height: 1920 };
const dir = (name: string) => mkdtempSync(join(tmpdir(), `velix-${name}-`));
const plan = (changes: Partial<VelixCapturePlan> = {}): VelixCapturePlan => ({ kind: 'web', command: 'node server.mjs', url: 'http://127.0.0.1:1234', env: {}, screens: [{ name: 'Início', path: '/' }], ...changes });

const freePort = () => new Promise<number>((resolve) => {
  const server = createServer().listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
  });
});

function project(port: number): string {
  const root = dir('alvo');
  writeFileSync(join(root, 'server.mjs'), `import http from 'node:http';\nimport fs from 'node:fs';\nfs.writeFileSync(process.argv[2] ?? 'ligado.txt', process.env.NB_DEMO ?? 'sem');\nhttp.createServer((q, r) => r.end('ok')).listen(${port}, '127.0.0.1');\n`);
  return root;
}

describe('parseCaptureCommand', () => {
  it('accepts plain program calls', () => {
    expect(parseCaptureCommand(' npm run dev -- --port=3000 ')).toEqual(['npm', 'run', 'dev', '--', '--port=3000']);
    expect(parseCaptureCommand('npx electron . --remote-debugging-port=9333')).toHaveLength(4);
  });

  it('refuses shell operators, other programs and variables', () => {
    for (const command of ['npm run dev && curl x', 'npm run dev | sh', 'npm run dev; rm x', 'node a.js > b', 'curl https://x', 'powershell -c x', 'npm run $(x)', 'npm run %PATH%', 'npm run "a b"', '']) {
      expect(() => parseCaptureCommand(command), command).toThrow(/invalid/);
    }
  });
});

describe('localCaptureUrl', () => {
  it('allows only this machine', () => {
    expect(localCaptureUrl('http://localhost:3000').port).toBe('3000');
    for (const url of ['https://example.com', 'http://192.168.0.2:3000', 'file:///c:/a.html', 'http://localhost.example.com']) expect(() => localCaptureUrl(url), url).toThrow(/invalid/);
  });
});

describe('validateCapturePlan', () => {
  it('needs the debug port on Electron and at least one screen', () => {
    expect(() => validateCapturePlan(plan({ kind: 'electron', command: 'npx electron .', url: 'http://127.0.0.1:9333' }))).toThrow(/remote-debugging-port=9333/);
    expect(validateCapturePlan(plan({ kind: 'electron', command: 'npx electron . --remote-debugging-port=9333', url: 'http://127.0.0.1:9333' }))).toHaveLength(4);
    expect(() => validateCapturePlan(plan({ screens: [] }))).toThrow(/telas/);
    expect(() => validateCapturePlan(plan({ env: { 'A;B': '1' } }))).toThrow(/ambiente/);
  });
});

describe('captureVelixPrints', () => {
  it('refuses to run anything without confirmation', async () => {
    const root = dir('video');
    const target = project(await freePort());
    await expect(captureVelixPrints({ root, video: 'v', targetRoot: target, plan: plan(), size, capture: async () => PNG, confirmed: false })).rejects.toThrow(/forbidden/);
    expect(existsSync(join(target, 'ligado.txt'))).toBe(false);
  });

  it('starts the project with the env, saves the prints and stops it', async () => {
    const port = await freePort();
    const root = dir('video');
    const target = project(port);
    const seen: string[] = [];
    const result = await captureVelixPrints({ root, video: 'Meu App', targetRoot: target, plan: plan({ url: `http://127.0.0.1:${port}`, env: { NB_DEMO: 'sim' }, screens: [{ name: 'Início', path: '/' }, { name: 'Chat', path: '/chat' }] }), size, capture: async (url) => { seen.push(url); return PNG; }, confirmed: true });
    expect(result).toEqual({ saved: ['01-inicio.png', '02-chat.png'], failed: [] });
    expect(seen).toEqual([`http://127.0.0.1:${port}/`, `http://127.0.0.1:${port}/chat`]);
    expect(readdirSync(join(root, 'meu-app', 'prints'))).toHaveLength(2);
    await expect(fetch(`http://127.0.0.1:${port}/`)).rejects.toThrow();
  }, 30_000);

  it('reports a command that dies, and keeps only real PNGs', async () => {
    const port = await freePort();
    const root = dir('video');
    const target = project(port);
    await expect(captureVelixPrints({ root, video: 'v', targetRoot: target, plan: plan({ command: 'node nao-existe.mjs', url: `http://127.0.0.1:${port}` }), size, capture: async () => PNG, confirmed: true, startTimeoutMs: 8_000 })).rejects.toThrow(/terminou antes/);
    const result = await captureVelixPrints({ root, video: 'v', targetRoot: target, plan: plan({ url: `http://127.0.0.1:${port}` }), size, capture: async () => Buffer.from('<html>'), confirmed: true });
    expect(result).toEqual({ saved: [], failed: ['Início'] });
  }, 30_000);
});

describe('prints', () => {
  it('lists and removes prints of one video only', () => {
    const root = dir('video');
    mkdirSync(join(root, 'v', 'prints'), { recursive: true });
    writeFileSync(join(root, 'v', 'prints', '01-chat.png'), PNG);
    writeFileSync(join(root, 'segredo.png'), PNG);
    expect(listVelixPrints(root, 'v').map((item) => item.file)).toEqual(['01-chat.png']);
    expect(listVelixPrints(root, 'outro')).toEqual([]);
    expect(() => removeVelixPrint(root, 'v', '../../segredo.png')).toThrow(/invalid/);
    removeVelixPrint(root, 'v', '01-chat.png');
    expect(listVelixPrints(root, 'v')).toEqual([]);
    expect(existsSync(join(root, 'segredo.png'))).toBe(true);
  });
});
