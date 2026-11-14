import { createHash, generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AuthService, bearerMatches, EventLog, startServer, TailscaleRemote, type CoreServer, type TailscaleExec } from '@neuralbridge/core';
import { openDatabase, projects, tasks, type DatabaseHandle } from '@neuralbridge/database';
import { TaskEngine } from '@neuralbridge/orchestrator';
import { coreErrorSchema, RATE_LIMIT_CLASSES, type Grant } from '@neuralbridge/shared/core-api';
import { createAuthRoutes, createPrincipalResolver, toHttpError } from '../src/core-host/auth-routes.js';
import { createTaskRoutes } from '../src/core-host/domain.js';
import { createTaskService } from '../src/main/tasks.js';
import { FakeAdapter } from '../../../packages/orchestrator/test/fake-adapter.js';

const MIGRATIONS = resolve(import.meta.dirname, '../../../packages/database/migrations');
const TOKEN = 'd'.repeat(64);
const TAILNET = 'desk.tail1234.ts.net';
let handle: DatabaseHandle;
let engine: TaskEngine;
let server: CoreServer;
let auth: AuthService;
let now = new Date();
let taskRoutes: ReturnType<typeof createTaskRoutes>;

const health = () => ({ status: 'ok' as const, coreVersion: '1', apiVersions: ['v1'], mode: 'embedded' as const, desktopConnected: true, capabilities: { notifications: false, voice: false, screen: false, hud: false, secrets: false }, startedAt: new Date().toISOString() });

beforeEach(async () => {
  now = new Date();
  handle = openDatabase(join(mkdtempSync(join(tmpdir(), 'nb-core-auth-')), 'brain.db'), { migrationsFolder: MIGRATIONS });
  for (const [id, isPrivate, permissionLevel] of [['p1', false, 'standard'], ['p2', false, 'standard'], ['secret', true, 'standard'], ['full', false, 'full']] as const) handle.db.insert(projects).values({ id, name: id, rootPath: mkdtempSync(join(tmpdir(), `nb-${id}-`)), isPrivate, permissionLevel }).run();
  engine = new TaskEngine({ handle, adapters: { claude: new FakeAdapter('claude', []), codex: new FakeAdapter('codex', () => ({ text: 'ok' })) }, availability: async () => ({ claude: true, codex: true }) });
  const service = createTaskService({ handle, engine, notify: () => undefined, attachmentsDir: mkdtempSync(join(tmpdir(), 'nb-att-')) });
  auth = new AuthService({ handle, coreId: 'core-test', fingerprint: 'f'.repeat(64), now: () => now, onRevoked: (ids) => taskRoutes.closeFor(ids) });
  const principal = createPrincipalResolver(auth, (incoming) => bearerMatches(incoming, TOKEN));
  taskRoutes = createTaskRoutes({ handle, engine, service, events: new EventLog(), rateLimit: (id, cls) => { try { auth.limiter.check(`${cls}:${id}`, RATE_LIMIT_CLASSES[cls]); } catch (error) { throw toHttpError(error); } } }, principal);
  const remoteHost = { value: TAILNET as string | null };
  const authRoutes = createAuthRoutes({ auth, remote: new TailscaleRemote(null), dataDir: mkdtempSync(join(tmpdir(), 'nb-data-')), principal, health, port: () => server.port, remoteHost });
  server = await startServer({ preferredPort: null, instanceId: randomUUID(), health, remoteHosts: () => [TAILNET], domain: async (req, res, path, context) => (await authRoutes.route(req, res, path, context)) || taskRoutes.handle(req, res, path, context) });
});
afterEach(async () => { engine.cancelAll(); await engine.idle(); await server.close(); handle.close(); });

interface Response { status: number; body: Record<string, unknown>; headers: Record<string, unknown> }
function call(method: string, path: string, options: { body?: unknown; headers?: Record<string, string>; remote?: boolean } = {}): Promise<Response> {
  const payload = options.body === undefined ? null : Buffer.from(JSON.stringify(options.body));
  return new Promise((done, fail) => {
    const req = request({ host: '127.0.0.1', port: server.port, method, path, headers: { Host: options.remote === false ? `127.0.0.1:${server.port}` : TAILNET, ...(payload ? { 'Content-Type': 'application/json' } : {}), ...options.headers } }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => { text += chunk; });
      response.on('end', () => done({ status: response.statusCode ?? 0, body: text ? JSON.parse(text) as Record<string, unknown> : {}, headers: response.headers }));
    });
    req.on('error', fail);
    if (payload) req.write(payload);
    req.end();
  });
}
const desktop = (method: string, path: string, body?: unknown) => call(method, path, { remote: false, body, headers: { Authorization: `Bearer ${TOKEN}`, ...(body !== undefined && method !== 'GET' ? { 'Idempotency-Key': randomUUID() } : {}) } });

/** A phone: P-256 key in "secure storage", DPoP proofs for every request. */
class Phone {
  readonly key: KeyObject;
  readonly jwk: { kty: string; crv: string; x: string; y: string };
  access = '';
  refresh = '';
  constructor() {
    const pair = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.key = pair.privateKey;
    const { kty, crv, x, y } = pair.publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string; y: string };
    this.jwk = { kty, crv, x, y };
  }
  proof(method: string, path: string, options: { token?: string; jti?: string; iat?: number; host?: string; key?: KeyObject } = {}): string {
    const header = Buffer.from(JSON.stringify({ typ: 'dpop+jwt', alg: 'ES256', jwk: this.jwk })).toString('base64url');
    const claims = { jti: options.jti ?? randomUUID(), htm: method, htu: `https://${options.host ?? TAILNET}${path}`, iat: options.iat ?? Math.floor(now.getTime() / 1000), ...(options.token ? { ath: createHash('sha256').update(options.token).digest('base64url') } : {}) };
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), { key: options.key ?? this.key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
    return `${header}.${payload}.${signature}`;
  }
  get(path: string, extra: { proof?: string; token?: string } = {}) {
    const token = extra.token ?? this.access;
    return call('GET', path, { headers: { Authorization: `DPoP ${token}`, DPoP: extra.proof ?? this.proof('GET', path, { token }) } });
  }
  post(path: string, body: unknown) {
    return call('POST', path, { body, headers: { Authorization: `DPoP ${this.access}`, DPoP: this.proof('POST', path, { token: this.access }), 'Idempotency-Key': randomUUID() } });
  }
}

const GRANT: Grant = { scopes: ['read', 'chat', 'task:create', 'task:cancel'], projects: { projects: ['p1', 'full'], includePrivate: false } };

async function pair(phone: Phone, grant: Grant = GRANT): Promise<string> {
  const offer = await desktop('POST', '/api/v1/pairing', { grant });
  expect(offer.status).toBe(200);
  expect(offer.body).toMatchObject({ v: 1, endpoint: `https://${TAILNET}`, fingerprint: 'f'.repeat(64) });
  const claimed = await call('POST', '/api/v1/pairing/claim', { body: { code: offer.body['code'], deviceName: 'iPhone de Fulano', platform: 'ios', appVersion: '0.1.0', publicKey: phone.jwk } });
  expect(claimed.status).toBe(200);
  const pairingId = String(claimed.body['pairingId']);
  expect((await call('GET', `/api/v1/pairing/${pairingId}`)).body['state']).toBe('awaiting_confirmation');
  expect((await desktop('POST', `/api/v1/pairing/${pairingId}/decision`, { decision: 'approve' })).body['state']).toBe('approved');
  const tokens = await call('POST', '/api/v1/auth/token', { body: { grantType: 'pairing', pairingId }, headers: { DPoP: phone.proof('POST', '/api/v1/auth/token') } });
  expect(tokens.status).toBe(200);
  phone.access = String(tokens.body['accessToken']);
  phone.refresh = String(tokens.body['refreshToken']);
  return String(tokens.body['deviceId']);
}

describe('Core authentication and devices (CORE-07)', () => {
  it('pairs a phone end to end and lets it call the API with proof of possession', async () => {
    const phone = new Phone();
    await pair(phone);
    const list = await phone.get('/api/v1/tasks');
    expect(list.status).toBe(200);
    expect((await phone.get('/api/v1/health')).status).toBe(200);
    // Over the tailnet nothing is anonymous: not even /health, and never the desktop bearer.
    expect((await call('GET', '/api/v1/health')).status).toBe(401);
    expect((await call('GET', '/api/v1/tasks', { headers: { Authorization: `Bearer ${TOKEN}` } })).status).toBe(401);
    expect((await call('GET', '/api/v1/health', { remote: false })).status).toBe(200);
  });

  it('a pairing needs the desktop confirmation and its code works once', async () => {
    const phone = new Phone();
    const offer = await desktop('POST', '/api/v1/pairing', { grant: GRANT });
    const claimed = await call('POST', '/api/v1/pairing/claim', { body: { code: offer.body['code'], deviceName: 'Android', platform: 'android', appVersion: '0.1.0', publicKey: phone.jwk } });
    const pairingId = String(claimed.body['pairingId']);
    expect((await call('POST', '/api/v1/auth/token', { body: { grantType: 'pairing', pairingId }, headers: { DPoP: phone.proof('POST', '/api/v1/auth/token') } })).status).toBe(401);
    expect((await call('POST', '/api/v1/pairing/claim', { body: { code: offer.body['code'], deviceName: 'Outro', platform: 'android', appVersion: '0.1.0', publicKey: new Phone().jwk } })).status).toBe(404);
    expect((await desktop('POST', `/api/v1/pairing/${pairingId}/decision`, { decision: 'reject' })).body['state']).toBe('rejected');
    expect((await call('POST', '/api/v1/auth/token', { body: { grantType: 'pairing', pairingId }, headers: { DPoP: phone.proof('POST', '/api/v1/auth/token') } })).status).toBe(401);
    // A device can never get devices:manage.
    expect((await desktop('POST', '/api/v1/pairing', { grant: { ...GRANT, scopes: ['read', 'devices:manage'] } })).status).toBe(400);
  });

  it('rejects replayed, misdirected and foreign proofs, and stolen tokens', async () => {
    const phone = new Phone();
    await pair(phone);
    const proof = phone.proof('GET', '/api/v1/tasks', { token: phone.access });
    expect((await phone.get('/api/v1/tasks', { proof })).status).toBe(200);
    const replay = await phone.get('/api/v1/tasks', { proof });
    expect(replay.status).toBe(401);
    expect(coreErrorSchema.parse(replay.body).error.code).toBe('proof_invalid');
    expect((await phone.get('/api/v1/tasks', { proof: phone.proof('POST', '/api/v1/tasks', { token: phone.access }) })).status).toBe(401);
    expect((await phone.get('/api/v1/tasks', { proof: phone.proof('GET', '/api/v1/devices', { token: phone.access }) })).status).toBe(401);
    expect((await phone.get('/api/v1/tasks', { proof: phone.proof('GET', '/api/v1/tasks', { token: phone.access, iat: Math.floor(now.getTime() / 1000) - 600 }) })).status).toBe(401);
    // The token without the phone's key is useless.
    const thief = new Phone();
    expect((await call('GET', '/api/v1/tasks', { headers: { Authorization: `DPoP ${phone.access}`, DPoP: thief.proof('GET', '/api/v1/tasks', { token: phone.access }) } })).status).toBe(401);
    expect((await phone.get('/api/v1/tasks', { proof: phone.proof('GET', '/api/v1/tasks', { token: phone.access, key: thief.key }) })).status).toBe(401);
  });

  it('rotates refresh tokens and revokes the whole family when an old one comes back', async () => {
    const phone = new Phone();
    await pair(phone);
    const first = phone.refresh;
    const rotated = await call('POST', '/api/v1/auth/token', { body: { grantType: 'refresh_token', refreshToken: first }, headers: { DPoP: phone.proof('POST', '/api/v1/auth/token') } });
    expect(rotated.status).toBe(200);
    phone.access = String(rotated.body['accessToken']);
    expect((await phone.get('/api/v1/tasks')).status).toBe(200);
    const reuse = await call('POST', '/api/v1/auth/token', { body: { grantType: 'refresh_token', refreshToken: first }, headers: { DPoP: phone.proof('POST', '/api/v1/auth/token') } });
    expect(reuse.status).toBe(401);
    expect((await phone.get('/api/v1/tasks')).status).toBe(401);
  });

  it('expires access tokens after 15 minutes and pairing codes after 5', async () => {
    const phone = new Phone();
    await pair(phone);
    now = new Date(now.getTime() + 16 * 60_000);
    const expired = await phone.get('/api/v1/tasks');
    expect(coreErrorSchema.parse(expired.body).error.code).toBe('token_expired');
    const offer = await desktop('POST', '/api/v1/pairing', { grant: GRANT });
    now = new Date(now.getTime() + 6 * 60_000);
    const late = await call('POST', '/api/v1/pairing/claim', { body: { code: offer.body['code'], deviceName: 'iPhone', platform: 'ios', appVersion: '0.1.0', publicKey: new Phone().jwk } });
    expect(late.status).toBe(410);
  });

  it('revokes at once: tokens stop working and open streams close', async () => {
    const phone = new Phone();
    const deviceId = await pair(phone);
    const created = await phone.post('/api/v1/tasks', { prompt: 'Explique', projectId: 'p1', mode: 'codex' });
    expect(created.status).toBe(201);
    const taskId = String((created.body['task'] as { id: string }).id);
    const closed = new Promise<boolean>((done) => {
      const path = `/api/v1/streams/task:${taskId}`;
      const req = request({ host: '127.0.0.1', port: server.port, path, headers: { Host: TAILNET, Authorization: `DPoP ${phone.access}`, DPoP: phone.proof('GET', path, { token: phone.access }) } }, (response) => { response.resume(); response.on('end', () => done(true)); });
      req.on('error', () => done(true));
      req.end();
    });
    await new Promise((wait) => setTimeout(wait, 200));
    const revoked = await desktop('POST', '/api/v1/devices/revoke', { target: 'device', deviceId });
    expect(revoked.body).toMatchObject({ revoked: [deviceId] });
    expect(Number(revoked.body['closedConnections'])).toBeGreaterThanOrEqual(1);
    expect(await closed).toBe(true);
    const after = await phone.get('/api/v1/tasks');
    expect(after.status).toBe(401);
    expect(coreErrorSchema.parse(after.body).error.code).toBe('device_revoked');
    const devices = await desktop('GET', '/api/v1/devices');
    expect((devices.body['items'] as Array<{ revokedAt: string | null }>)[0]?.revokedAt).not.toBeNull();
  });

  it('keeps devices inside their grant: projects, private ones, scopes and full access', async () => {
    const phone = new Phone();
    await pair(phone);
    handle.db.insert(tasks).values([{ id: 'in-p2', prompt: 'x', projectId: 'p2', mode: 'auto', status: 'completed' }, { id: 'in-secret', prompt: 'x', projectId: 'secret', mode: 'auto', status: 'completed' }, { id: 'in-p1', prompt: 'x', projectId: 'p1', mode: 'auto', status: 'completed' }]).run();
    expect((await phone.get('/api/v1/tasks/in-p2')).status).toBe(404);
    expect((await phone.get('/api/v1/tasks/in-secret')).status).toBe(404);
    expect((await phone.get('/api/v1/tasks/in-p1')).status).toBe(200);
    const ids = ((await phone.get('/api/v1/tasks')).body['items'] as Array<{ id: string }>).map((task) => task.id);
    expect(ids).toEqual(['in-p1']);
    expect((await phone.post('/api/v1/tasks', { prompt: 'x', projectId: 'p2', mode: 'codex' })).status).toBe(404);
    const approve = await phone.post('/api/v1/tasks/in-p1/approval', { decision: 'approve' });
    expect(coreErrorSchema.parse(approve.body).error).toMatchObject({ code: 'scope_required', details: { requiredScope: 'task:approve' } });
    // Editing in a Full Access project needs the elevated scope; read-only (the remote default) does not.
    const edit = await phone.post('/api/v1/tasks', { prompt: 'Corrija', projectId: 'full', mode: 'codex', access: 'edit' });
    expect(coreErrorSchema.parse(edit.body).error.code).toBe('scope_required');
    const readOnly = await phone.post('/api/v1/tasks', { prompt: 'Explique', projectId: 'full', mode: 'codex' });
    expect(readOnly.status).toBe(201);
    expect((readOnly.body['task'] as { access: string }).access).toBe('read-only');
    // Desktop-only routes and the all-tasks stream are refused.
    expect((await phone.get('/api/v1/devices')).status).toBe(403);
    expect((await phone.get('/api/v1/streams/tasks')).status).toBe(403);
    expect((await phone.get('/internal/v1/executor')).status).toBe(403);
  });

  it('limits how fast one device may create tasks; the desktop is never limited', async () => {
    const phone = new Phone();
    await pair(phone);
    const statuses: number[] = [];
    for (let index = 0; index <= RATE_LIMIT_CLASSES.taskCreate.requests; index += 1) statuses.push((await phone.post('/api/v1/tasks', { prompt: `Explique ${index}`, projectId: 'p1', mode: 'codex' })).status);
    expect(statuses.slice(0, -1).every((status) => status === 201)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect((await desktop('POST', '/api/v1/tasks', { prompt: 'Explique', projectId: 'p1', mode: 'codex' })).status).toBe(201);
  });

  it('locks out a source that keeps guessing codes, and audits without secrets', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) statuses.push((await call('POST', '/api/v1/pairing/claim', { body: { code: '23456789', deviceName: 'x', platform: 'ios', appVersion: '0.1.0', publicKey: new Phone().jwk }, headers: { 'X-Forwarded-For': '100.64.0.9' } })).status);
    expect(statuses.slice(0, 3)).toEqual([404, 404, 404]);
    expect(statuses.slice(3)).toEqual([429, 429]);
    const locked = await call('POST', '/api/v1/pairing/claim', { body: { code: '23456789', deviceName: 'x', platform: 'ios', appVersion: '0.1.0', publicKey: new Phone().jwk }, headers: { 'X-Forwarded-For': '100.64.0.9' } });
    expect(coreErrorSchema.parse(locked.body).error).toMatchObject({ code: 'locked_out' });
    expect(Number(coreErrorSchema.parse(locked.body).error.retryAfterMs)).toBeGreaterThan(0);
    // Another source is unaffected.
    expect((await call('POST', '/api/v1/pairing/claim', { body: { code: '23456789', deviceName: 'x', platform: 'ios', appVersion: '0.1.0', publicKey: new Phone().jwk }, headers: { 'X-Forwarded-For': '100.64.0.10' } })).status).toBe(404);
    const phone = new Phone();
    await pair(phone);
    const audit = JSON.stringify((await desktop('GET', '/api/v1/audit')).body);
    expect(audit).toContain('pairing.approved');
    expect(audit).toContain('pairing.failed');
    expect(audit).not.toContain(phone.access);
    expect(audit).not.toContain(phone.refresh);
    expect(audit).not.toContain('23456789');
  });
});

describe('Tailscale remote access (CORE-07)', () => {
  const fake = (responses: Record<string, { code: number; stdout: string }>): { exec: TailscaleExec; calls: string[][] } => {
    const calls: string[][] = [];
    return { calls, exec: async (args) => { calls.push([...args]); return responses[args.join(' ')] ?? { code: 0, stdout: '' }; } };
  };
  const running = { code: 0, stdout: JSON.stringify({ BackendState: 'Running', Self: { DNSName: `${TAILNET}.` } }) };

  it('is off when Tailscale is missing, publishes only with serve and refuses funnel', async () => {
    expect(await new TailscaleRemote(null).status(1234)).toEqual({ state: 'not-installed' });
    const serving = fake({ 'status --json': running, 'serve status --json': { code: 0, stdout: JSON.stringify({ Web: { [`${TAILNET}:443`]: { Handlers: { '/': { Proxy: 'http://127.0.0.1:1234' } } } } }) } });
    expect(await new TailscaleRemote(serving.exec).enable(1234)).toEqual({ state: 'ready', hostname: TAILNET, serving: true });
    expect(serving.calls).toContainEqual(['serve', '--bg', '--https=443', 'http://127.0.0.1:1234']);
    expect(serving.calls.flat().some((arg) => /funnel/i.test(arg))).toBe(false);
    const funnel = fake({ 'status --json': running, 'serve status --json': { code: 0, stdout: JSON.stringify({ AllowFunnel: { [`${TAILNET}:443`]: true } }) } });
    const blocked = await new TailscaleRemote(funnel.exec).enable(1234);
    expect(blocked.state).toBe('blocked');
    expect(funnel.calls).not.toContainEqual(['serve', '--bg', '--https=443', 'http://127.0.0.1:1234']);
    expect((await new TailscaleRemote(fake({ 'status --json': { code: 0, stdout: JSON.stringify({ BackendState: 'NeedsLogin' }) } }).exec).status(1)).state).toBe('logged-out');
  });

  it('refuses to pair while remote access is off', async () => {
    const off = createAuthRoutes({ auth, remote: new TailscaleRemote(null), dataDir: mkdtempSync(join(tmpdir(), 'nb-off-')), principal: createPrincipalResolver(auth, (incoming) => bearerMatches(incoming, TOKEN)), health, port: () => 1, remoteHost: { value: null } });
    const local = await startServer({ preferredPort: null, instanceId: randomUUID(), health, domain: (req, res, path, context) => off.route(req, res, path, context) });
    try {
      const response = await new Promise<number>((done) => {
        const body = Buffer.from(JSON.stringify({ grant: GRANT }));
        const req = request({ host: '127.0.0.1', port: local.port, method: 'POST', path: '/api/v1/pairing', headers: { Host: `127.0.0.1:${local.port}`, Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' } }, (res) => { res.resume(); done(res.statusCode ?? 0); });
        req.write(body);
        req.end();
      });
      expect(response).toBe(503);
    } finally { await local.close(); }
  });
});
