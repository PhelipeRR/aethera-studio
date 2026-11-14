import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { coreErrorSchema, healthSchema } from '@neuralbridge/shared/core-api';
import { acquireLock, allowedHost, createFileLogger, formatLogLine, readCoreConfig, readLock, sanitizeField, startCore, type CoreMessage, type CoreConfig, type Logger, type RunningCore } from '../src/index.js';

const UUID = '0b5f9c1e-6a3e-4a5c-9d2a-1f6c8e2b7a10';
const OTHER = '7d1e2f3a-4b5c-4d6e-8f90-a1b2c3d4e5f6';
const running: RunningCore[] = [];
afterEach(async () => { await Promise.all(running.splice(0).map((core) => core.shutdown('test'))); });

function setup(overrides: Partial<CoreConfig> = {}) {
  const dataDir = mkdtempSync(join(tmpdir(), 'nb-core-'));
  const config: CoreConfig = { dataDir, mode: 'embedded', preferredPort: null, version: '0.1.58', testCrash: null, ...overrides };
  const sent: CoreMessage[] = [];
  const lines: string[] = [];
  const log: Logger = { log: (level, event, fields = {}) => lines.push(formatLogLine(level, event, fields, new Date())) };
  return { dataDir, config, sent, lines, deps: { instanceId: UUID, pid: process.pid + 100_000, log, send: (message: CoreMessage) => sent.push(message), desktopConnected: () => true } };
}

function get(port: number, path: string, host = `127.0.0.1:${port}`, method = 'GET'): Promise<{ status: number; headers: Record<string, unknown>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { Host: host } }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode ?? 0, headers: response.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

async function start(env: ReturnType<typeof setup>): Promise<RunningCore> {
  const result = await startCore(env.config, env.deps);
  if (result.kind !== 'running') throw new Error('expected a running Core');
  running.push(result.core);
  return result.core;
}

describe('Singularity Core runtime', () => {
  it('starts on loopback, records its port in core.lock and reports ready', async () => {
    const env = setup();
    const core = await start(env);
    expect(core.port).toBeGreaterThan(0);
    expect(readLock(env.dataDir)).toMatchObject({ pid: env.deps.pid, port: core.port, instanceId: UUID, mode: 'embedded' });
    expect(env.sent).toEqual([{ type: 'ready', port: core.port, instanceId: UUID, version: '0.1.58', pid: env.deps.pid }]);
  });

  it('answers /health exactly as the CORE-02 contract says, with nothing sensitive in it', async () => {
    const env = setup();
    const core = await start(env);
    const response = await get(core.port, '/api/v1/health');
    expect(response.status).toBe(200);
    const body = JSON.parse(response.body) as unknown;
    expect(healthSchema.parse(body)).toEqual(body);
    expect(response.headers['singularity-core-instance']).toBe(UUID);
    expect(response.headers['access-control-allow-origin']).toBeUndefined();
    expect(response.headers['cache-control']).toBe('no-store');
    for (const leak of [env.dataDir, String(env.deps.pid), process.env['USERNAME'] ?? 'no-user', 'APPDATA', 'token']) if (leak.length > 2) expect(response.body).not.toContain(leak);
    expect(Object.keys(body as object).sort()).toEqual(['apiVersions', 'capabilities', 'coreVersion', 'desktopConnected', 'mode', 'startedAt', 'status']);
  });

  it('rejects foreign Host headers (DNS rebinding), other methods and unknown routes with the error envelope', async () => {
    const core = await start(setup());
    for (const [host, path, method, status] of [['evil.example:80', '/api/v1/health', 'GET', 403], [`127.0.0.1:${core.port}`, '/api/v1/health', 'POST', 400], [`127.0.0.1:${core.port}`, '/api/v1/tasks', 'GET', 404]] as const) {
      const response = await get(core.port, path, host, method);
      expect(response.status).toBe(status);
      expect(coreErrorSchema.safeParse(JSON.parse(response.body)).success).toBe(true);
    }
    expect(allowedHost(`localhost:${core.port}`, core.port)).toBe(true);
    expect(allowedHost(`192.168.0.10:${core.port}`, core.port)).toBe(false);
    expect(allowedHost(undefined, core.port)).toBe(false);
  });

  it('falls back to a dynamic port when the preferred one is taken', async () => {
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const taken = (blocker.address() as { port: number }).port;
    const env = setup({ preferredPort: taken });
    const core = await start(env);
    expect(core.port).not.toBe(taken);
    expect(env.lines.some((line) => line.includes('core.port_in_use'))).toBe(true);
    await new Promise((resolve) => blocker.close(resolve));
  });

  it('refuses to run a second Core on the same data folder', async () => {
    const env = setup();
    const first = await start(env);
    const second = await startCore(env.config, { ...env.deps, instanceId: OTHER, pid: process.pid, isAlive: () => true });
    expect(second.kind).toBe('already-running');
    expect(env.sent.at(-1)).toMatchObject({ type: 'already-running', port: first.port, instanceId: UUID });
    expect(readLock(env.dataDir)?.instanceId).toBe(UUID);
  });

  it('takes over a lock left by a dead process or by a reused PID that is not a Core', async () => {
    const env = setup();
    writeFileSync(join(env.dataDir, 'core.lock'), JSON.stringify({ pid: 999_999, port: 1234, instanceId: OTHER, startedAt: new Date().toISOString(), version: '0.1.0', mode: 'embedded' }));
    const dead = await acquireLock(env.dataDir, { pid: 1, port: null, instanceId: UUID, startedAt: new Date().toISOString(), version: 'x', mode: 'embedded' }, { isAlive: () => false, ownerAnswers: async () => true });
    expect(dead.acquired).toBe(true);
    if (dead.acquired) dead.lock.release();
    writeFileSync(join(env.dataDir, 'core.lock'), JSON.stringify({ pid: 2, port: 1234, instanceId: OTHER, startedAt: new Date().toISOString(), version: '0.1.0', mode: 'embedded' }));
    const reused = await acquireLock(env.dataDir, { pid: 1, port: null, instanceId: UUID, startedAt: new Date().toISOString(), version: 'x', mode: 'embedded' }, { isAlive: () => true, ownerAnswers: async () => false });
    expect(reused.acquired).toBe(true);
    if (reused.acquired) reused.lock.release();
  });

  it('shuts down gracefully: stops listening, releases only its own lock and is idempotent', async () => {
    const env = setup();
    const core = await start(env);
    running.pop();
    await Promise.all([core.shutdown('desktop-quit'), core.shutdown('again')]);
    expect(core.state()).toBe('stopped');
    expect(existsSync(join(env.dataDir, 'core.lock'))).toBe(false);
    await expect(get(core.port, '/api/v1/health')).rejects.toThrow();
    expect(env.sent.filter((message) => message.type === 'stopping')).toHaveLength(1);
  });

  it('fails startup cleanly (lock released) when asked to crash during startup', async () => {
    const env = setup({ testCrash: 'startup' });
    await expect(startCore(env.config, env.deps)).rejects.toThrow();
    expect(existsSync(join(env.dataDir, 'core.lock'))).toBe(false);
  });
});

describe('Core configuration and logs', () => {
  it('reads only the environment, defaults to embedded and keeps standalone and test hooks behind explicit flags', () => {
    const base = { NB_DATA_DIR: 'C:\\data' };
    expect(readCoreConfig(base)).toMatchObject({ mode: 'embedded', preferredPort: null, testCrash: null });
    expect(() => readCoreConfig({ ...base, NB_CORE_MODE: 'standalone' })).toThrow();
    expect(readCoreConfig({ ...base, NB_CORE_MODE: 'standalone', NB_CORE_ALLOW_STANDALONE: '1' }).mode).toBe('standalone');
    expect(() => readCoreConfig({ ...base, NB_CORE_PORT: '80' })).toThrow();
    expect(readCoreConfig({ ...base, NB_CORE_TEST_CRASH: 'startup' }).testCrash).toBeNull();
    expect(readCoreConfig({ ...base, NB_CORE_TEST_CRASH: 'startup', NB_CORE_ALLOW_TEST_HOOKS: '1' }).testCrash).toBe('startup');
    expect(readCoreConfig({ ...base, NB_CORE_VERSION: '1.0; rm' }).version).toBe('0.0.0');
  });

  it('writes structured lines without secrets, credential fields or user paths', () => {
    const line = JSON.parse(formatLogLine('error', 'core.startup failed!', { message: 'failed with token=abcdef123456 at C:\\Users\\Fulano\\AppData\\Roaming\\NeuralBridge\\core.lock', apiKey: 'sk-ant-abcdefghijklmnop', count: 3, nested: undefined }, new Date('2026-11-09T00:00:00Z'))) as Record<string, unknown>;
    expect(line).toMatchObject({ ts: '2026-11-09T00:00:00.000Z', level: 'error', event: 'core.startup_failed_', count: 3, apiKey: '[removido]' });
    expect(String(line['message'])).not.toContain('abcdef123456');
    expect(String(line['message'])).not.toContain('Fulano');
    expect(String(line['message'])).toContain('…/core.lock');
    expect(sanitizeField('note', 'x'.repeat(2000))).toHaveLength(501);
    expect(sanitizeField('value', Number.NaN)).toBeNull();
  });

  it('appends JSON lines under <data>/logs and rotates once past the size limit', () => {
    const env = setup();
    const file = join(env.dataDir, 'logs', 'core.log');
    const mirrored: string[] = [];
    const logger = createFileLogger(file, { maxBytes: 200, mirror: (line) => mirrored.push(line) });
    logger.log('info', 'core.ready', { port: 1 });
    logger.log('warn', 'core.port_in_use', { preferredPort: 43123 });
    for (let index = 0; index < 5; index += 1) logger.log('info', 'core.filler', { index });
    expect(existsSync(`${file}.1`)).toBe(true);
    for (const line of readFileSync(file, 'utf8').trim().split(/\r?\n/)) expect(() => JSON.parse(line) as unknown).not.toThrow();
    expect(mirrored).toHaveLength(1);
  });
});
