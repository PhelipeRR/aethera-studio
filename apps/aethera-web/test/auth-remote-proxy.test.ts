import assert from 'node:assert/strict';
import fs from 'node:fs';
import type http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Express } from 'express';
import { createRemoteHostApp, type RemoteHostInstance } from '../../aethera-remote-host/src/server';
import { createAetheraApiApp } from '../server';
import {
  CredentialVault,
  hashPasswordArgon2id,
  verifyPasswordArgon2id,
} from '../server/crypto-vault';
import { validateSafeRemoteHostUrl } from '../server/ssrf-guard';

function extractSessionCookie(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? '';
  const match = raw.match(/(aethera_sid=[^;]+)/);
  assert.ok(match, `Expected aethera_sid cookie in Set-Cookie header, got: ${raw}`);
  assert.ok(/HttpOnly/i.test(raw), `Session cookie must be HttpOnly, got: ${raw}`);
  return match[1];
}

async function startServerOnPort(app: Express, port = 0): Promise<{ server: http.Server; port: number }> {
  const server = await new Promise<http.Server>((resolve, reject) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
    s.once('error', reject);
  });
  const addr = server.address();
  assert.ok(addr && typeof addr === 'object');
  return { server, port: addr.port };
}

async function closeServer(server: http.Server): Promise<void> {
  server.closeAllConnections?.();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

async function readSseChunk(url: string, headers: Record<string, string>, timeoutMs = 6000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    assert.equal(res.status, 200);
    assert.ok(res.headers.get('content-type')?.includes('text/event-stream'));
    assert.ok(res.body);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let collected = '';
    while (collected.length < 256) {
      const { value, done } = await reader.read();
      if (done) break;
      collected += decoder.decode(value, { stream: true });
      if (collected.includes('event:') || collected.includes('data:')) {
        break;
      }
    }
    await reader.cancel().catch(() => undefined);
    controller.abort();
    return collected;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') return '';
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

test('Crypto vault: Argon2id hashing and AES-256-GCM authenticated encryption with AAD', async () => {
  const hash = await hashPasswordArgon2id('MinhaSenhaSuperSegura2026!');
  assert.ok(hash.startsWith('$argon2id$'));
  assert.equal(await verifyPasswordArgon2id(hash, 'MinhaSenhaSuperSegura2026!'), true);
  assert.equal(await verifyPasswordArgon2id(hash, 'SenhaErrada2026!'), false);

  const vault = new CredentialVault({
    rawKey: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    isProduction: true,
  });

  const secret = 'aethera_remote_secret_token_9876543210';
  const encrypted = vault.encrypt(secret, 'usr_1:pc_1');
  assert.notEqual(encrypted, secret);
  assert.ok(!encrypted.includes(secret));
  assert.equal(vault.decrypt(encrypted, 'usr_1:pc_1'), secret);

  // Wrong AAD (another user or computer) MUST fail decryption
  assert.throws(() => vault.decrypt(encrypted, 'usr_2:pc_1'));

  // Tampered ciphertext MUST fail GCM auth tag verification
  const tampered = `${encrypted.slice(0, -2)}AA`;
  assert.throws(() => vault.decrypt(tampered, 'usr_1:pc_1'));
});

test('SSRF guard blocks HTTP, private/loopback/metadata IPs, embedded credentials, and query strings', async () => {
  const blockedUrls = [
    'http://example.com',
    'https://127.0.0.1:47821',
    'https://localhost:47821',
    'https://169.254.169.254/latest/meta-data/',
    'https://10.0.0.5',
    'https://192.168.1.10',
    'https://172.16.0.4',
    'https://user:pass@valid.ngrok-free.app',
    'https://valid.ngrok-free.app?foo=bar',
    'https://metadata.google.internal',
    'ftp://valid.ngrok-free.app',
  ];

  for (const url of blockedUrls) {
    await assert.rejects(
      () => validateSafeRemoteHostUrl(url, { allowLoopback: false }),
      `Expected SSRF guard to reject: ${url}`,
    );
  }
});

test('End-to-end 12 mandatory requirements: persistent auth, encrypted Remote Host binding, auto-reconnect, proxy SSE & Range 206, restart persistence, CSRF/SSRF/brute-force & isolation', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aethera-auth-e2e-'));
  const webDbPath = path.join(tmpDir, 'web.db');
  const rendersDir = path.join(tmpDir, 'renders');
  const remoteDataDir = path.join(tmpDir, 'remote-host-data');
  const credentialKey = 'f0e1d2c3b4a5968778695a4b3c2d1e0ff0e1d2c3b4a5968778695a4b3c2d1e0f';
  const adminSetupToken = 'deploy-bootstrap-secret-2026';
  const remoteBearerToken = 'aethera_pc_windows_real_secret_token_xyz987654321';

  let issuedResetCode: string | null = null;

  // 1) Start real Aethera Remote Host instance (simulating the user's Windows PC)
  const createRemoteInstance = (): RemoteHostInstance =>
    createRemoteHostApp({
      bindHost: '127.0.0.1',
      port: 0,
      allowNonLoopback: false,
      authToken: remoteBearerToken,
      dataDir: remoteDataDir,
      monorepoRoot: path.resolve(process.cwd()),
      allowedOrigins: ['*'],
      allowedRoots: [remoteDataDir],
      rateLimitWindowMs: 60_000,
      rateLimitMaxRequests: 500,
      desktopUserDataDir: null,
      enableDesktopWatcher: false,
    });

  let remoteHost = createRemoteInstance();
  let remoteServerObj = await startServerOnPort(remoteHost.app, 0);
  const remotePort = remoteServerObj.port;
  const remoteBaseUrl = `http://127.0.0.1:${remotePort}`;

  // 2) Start Aethera Web Backend (with allowLoopback only so localhost test Remote Host is reachable, while still rejecting metadata/10.x/etc.)
  let webAppObj = createAetheraApiApp({
    dbPath: webDbPath,
    rendersDir,
    credentialKey,
    adminSetupToken,
    isProduction: false,
    enforceHttps: false,
    ssrfOptions: { allowLoopback: true },
    onPasswordResetIssued: ({ rawCode }) => {
      issuedResetCode = rawCode;
    },
  });
  let webServerObj = await startServerOnPort(webAppObj.app, 0);
  let webBase = `http://127.0.0.1:${webServerObj.port}`;

  try {
    // --- Requirement 9: Unauthorized access blocked across all private APIs ---
    for (const ep of ['/api/bootstrap', '/api/computers', '/api/remote-proxy/status', '/api/remote-proxy/jobs', '/api/auth/sessions']) {
      const r = await fetch(`${webBase}${ep}`);
      assert.equal(r.status, 401, `Endpoint ${ep} must block unauthenticated access`);
    }

    // --- Initial state reports setupRequired: true ---
    const meInitial = await fetch(`${webBase}/api/auth/me`);
    const meInitialJson = (await meInitial.json()) as { authenticated: boolean; setupRequired: boolean; setupTokenRequired: boolean };
    assert.equal(meInitialJson.authenticated, false);
    assert.equal(meInitialJson.setupRequired, true);
    assert.equal(meInitialJson.setupTokenRequired, true);

    // --- Protected initial admin setup (wrong token rejected) ---
    const badSetup = await fetch(`${webBase}/api/auth/setup-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Operador Aethera',
        email: 'operador@aethera.studio',
        password: 'AetheraMasterPassword2026!',
        setupToken: 'wrong-token',
      }),
    });
    assert.equal(badSetup.status, 403);

    // --- Valid initial admin setup ---
    const goodSetup = await fetch(`${webBase}/api/auth/setup-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Operador Aethera',
        email: 'operador@aethera.studio',
        password: 'AetheraMasterPassword2026!',
        setupToken: adminSetupToken,
      }),
    });
    assert.equal(goodSetup.status, 201);
    const setupCookie = extractSessionCookie(goodSetup);
    const setupJson = (await goodSetup.json()) as { user: { email: string; role: string }; csrfToken: string };
    assert.equal(setupJson.user.email, 'operador@aethera.studio');
    assert.equal(setupJson.user.role, 'admin');
    assert.equal('passwordHash' in setupJson.user, false);

    // --- No indiscriminate public signup once admin exists ---
    const secondSetup = await fetch(`${webBase}/api/auth/setup-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Invasor',
        email: 'invasor@example.com',
        password: 'Password123456!',
        setupToken: adminSetupToken,
      }),
    });
    assert.equal(secondSetup.status, 403);

    // --- Requirement 12a: CSRF protection blocks mutating requests without X-CSRF-Token ---
    const noCsrfRes = await fetch(`${webBase}/api/projects`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: setupCookie },
      body: JSON.stringify({ title: 'Blocked without CSRF' }),
    });
    assert.equal(noCsrfRes.status, 403);

    // --- Requirement 12b: SSRF protection rejects private/metadata URLs in POST /api/computers ---
    const ssrfRes = await fetch(`${webBase}/api/computers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: setupCookie,
        'X-CSRF-Token': setupJson.csrfToken,
      },
      body: JSON.stringify({
        name: 'Metadata Attack',
        baseUrl: 'http://169.254.169.254/latest/meta-data',
        bearerToken: remoteBearerToken,
      }),
    });
    assert.equal(ssrfRes.status, 400);

    // --- Requirement 3 & 7: Bind Remote Host PC (encrypted AES-256-GCM; raw token NEVER exposed) ---
    const bindRes = await fetch(`${webBase}/api/computers`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: setupCookie,
        'X-CSRF-Token': setupJson.csrfToken,
      },
      body: JSON.stringify({
        name: 'PC Principal Windows',
        baseUrl: remoteBaseUrl,
        bearerToken: remoteBearerToken,
        autoConnect: true,
        setActive: true,
      }),
    });
    assert.equal(bindRes.status, 201);
    const bindRawText = await bindRes.text();
    assert.ok(!bindRawText.includes(remoteBearerToken), 'Raw Remote Host token MUST NEVER be returned to browser');
    const bindJson = JSON.parse(bindRawText) as { computer: { id: string; lastStatus: string; hasCredential: boolean; tokenFingerprint: string }; probe: { ok: boolean } };
    assert.equal(bindJson.probe.ok, true);
    assert.equal(bindJson.computer.lastStatus, 'online');
    assert.equal(bindJson.computer.hasCredential, true);
    const computerId = bindJson.computer.id;

    // --- Requirement 5: Automatic Remote Host recovery via proxy without sending token from client ---
    const proxyStatusRes = await fetch(`${webBase}/api/remote-proxy/status`, {
      headers: { Cookie: setupCookie },
    });
    assert.equal(proxyStatusRes.status, 200);
    const proxyStatusRaw = await proxyStatusRes.text();
    assert.ok(!proxyStatusRaw.includes(remoteBearerToken), 'Raw token must NEVER appear in /api/remote-proxy/status');
    const proxyStatus = JSON.parse(proxyStatusRaw) as {
      connected: boolean;
      offline: boolean;
      hostStatus: { hostname: string };
      syncSnapshot: { projects: unknown[] };
    };
    assert.equal(proxyStatus.connected, true);
    assert.equal(proxyStatus.offline, false);
    assert.ok(proxyStatus.hostStatus.hostname);
    assert.ok(Array.isArray(proxyStatus.syncSnapshot.projects));

    // --- Requirement 10: Proxy SSE + Real FFmpeg render job + Range 206 MP4 download ---
    const createJobRes = await fetch(`${webBase}/api/remote-proxy/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: setupCookie,
        'X-CSRF-Token': setupJson.csrfToken,
      },
      body: JSON.stringify({
        operation: 'render.ffmpeg',
        title: 'Proxy E2E Render Test',
        payload: {
          title: 'Proxy E2E Render Test',
          durationSec: 2,
          preset: 'review_720p',
          aspectRatio: '16:9',
        },
      }),
    });
    assert.equal(createJobRes.status, 201);
    const createdJobPayload = (await createJobRes.json()) as { job: { id: string } };
    const jobId = createdJobPayload.job.id;

    // Verify closed allowlist rejects arbitrary operations
    const badOpRes = await fetch(`${webBase}/api/remote-proxy/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: setupCookie,
        'X-CSRF-Token': setupJson.csrfToken,
      },
      body: JSON.stringify({
        operation: 'windows.shell.exec',
        title: 'Blocked arbitrary command',
        payload: { cmd: 'whoami' },
      }),
    });
    assert.equal(badOpRes.status, 400);

    // Read real SSE stream through authenticated proxy (both job stream & sync stream triggered by synced project create)
    const syncSsePromise = readSseChunk(`${webBase}/api/remote-proxy/sync/events`, { Cookie: setupCookie });
    const createSyncProjPromise = (async () => {
      await new Promise((r) => setTimeout(r, 150));
      const r = await fetch(`${webBase}/api/remote-proxy/sync/projects`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Cookie: setupCookie,
          'X-CSRF-Token': setupJson.csrfToken,
        },
        body: JSON.stringify({
          data: {
            title: 'Projeto Sync Via Proxy Autenticado',
            briefing: 'Sincronização bidirecional preservada atrás do proxy autenticado.',
            format: 'documentary_wide',
            style: 'Documentário',
            aspectRatio: '16:9',
            durationMin: 8,
          },
        }),
      });
      assert.equal(r.status, 201);
    })();
    const [jobSseText, syncSseText] = await Promise.all([
      readSseChunk(`${webBase}/api/remote-proxy/jobs/${jobId}/events`, { Cookie: setupCookie }),
      syncSsePromise,
      createSyncProjPromise,
    ]);
    assert.ok(jobSseText.length > 0, 'Expected SSE events from /api/remote-proxy/jobs/:id/events');
    assert.ok(syncSseText.length > 0, 'Expected SSE events from /api/remote-proxy/sync/events');

    // Poll until render job finishes and produces MP4 artifact
    let artifactId: string | null = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const detailRes = await fetch(`${webBase}/api/remote-proxy/jobs/${jobId}`, {
        headers: { Cookie: setupCookie },
      });
      assert.equal(detailRes.status, 200);
      const detail = (await detailRes.json()) as {
        job: { status: string; artifacts: Array<{ id: string }> };
      };
      if (detail.job.status === 'completed' && detail.job.artifacts.length > 0) {
        artifactId = detail.job.artifacts[0].id;
        break;
      }
      assert.notEqual(detail.job.status, 'failed', 'Remote FFmpeg job failed unexpectedly');
      await new Promise((r) => setTimeout(r, 250));
    }
    assert.ok(artifactId, 'Expected completed MP4 artifact from Remote Host');

    // Stream via proxy with HTTP Range 206 (no token in URL or headers!)
    const rangeRes = await fetch(`${webBase}/api/remote-proxy/artifacts/${artifactId}/stream`, {
      headers: { Cookie: setupCookie, Range: 'bytes=0-1023' },
    });
    assert.equal(rangeRes.status, 206);
    assert.ok(rangeRes.headers.get('content-range')?.startsWith('bytes 0-1023/'));
    const bytes = new Uint8Array(await rangeRes.arrayBuffer());
    assert.equal(bytes.byteLength, 1024);

    // --- Requirement 6: PC Offline detection & automatic reconnection ---
    await closeServer(remoteServerObj.server);
    remoteHost.close();

    const offlineStatusRes = await fetch(`${webBase}/api/remote-proxy/status`, {
      headers: { Cookie: setupCookie },
    });
    assert.equal(offlineStatusRes.status, 200);
    const offlineStatus = (await offlineStatusRes.json()) as { connected: boolean; offline: boolean; computer: { lastStatus: string } };
    assert.equal(offlineStatus.connected, false);
    assert.equal(offlineStatus.offline, true);
    assert.equal(offlineStatus.computer.lastStatus, 'offline');

    // Bring PC back online on the same port -> proxy reconnects automatically without re-entering URL or token
    remoteHost = createRemoteInstance();
    remoteServerObj = await startServerOnPort(remoteHost.app, remotePort);

    const reconnectedRes = await fetch(`${webBase}/api/remote-proxy/status`, {
      headers: { Cookie: setupCookie },
    });
    const reconnected = (await reconnectedRes.json()) as { connected: boolean; offline: boolean; computer: { lastStatus: string } };
    assert.equal(reconnected.connected, true);
    assert.equal(reconnected.offline, false);
    assert.equal(reconnected.computer.lastStatus, 'online');

    // --- Requirement 1, 2, 3, 4: First Login + Mobile Session + Refresh Hydration ---
    const mobileLoginRes = await fetch(`${webBase}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
      },
      body: JSON.stringify({
        email: 'operador@aethera.studio',
        password: 'AetheraMasterPassword2026!',
      }),
    });
    assert.equal(mobileLoginRes.status, 200);
    const mobileCookie = extractSessionCookie(mobileLoginRes);
    const mobileLoginJson = (await mobileLoginRes.json()) as { sessionId: string; csrfToken: string; computers: Array<{ id: string }> };
    assert.equal(mobileLoginJson.computers.length, 1);

    // Mobile device sees the SAME bound PC and connects automatically
    const mobileProxyRes = await fetch(`${webBase}/api/remote-proxy/status`, {
      headers: { Cookie: mobileCookie },
    });
    const mobileProxy = (await mobileProxyRes.json()) as { connected: boolean; computer: { id: string } };
    assert.equal(mobileProxy.connected, true);
    assert.equal(mobileProxy.computer.id, computerId);

    const sessionsRes = await fetch(`${webBase}/api/auth/sessions`, {
      headers: { Cookie: setupCookie },
    });
    const sessionsJson = (await sessionsRes.json()) as { sessions: Array<{ id: string; deviceLabel: string }>; auditLogs: Array<{ detail: string }> };
    assert.equal(sessionsJson.sessions.length, 2);
    assert.ok(sessionsJson.sessions.some((s) => s.deviceLabel.startsWith('Celular')));
    // Ensure audit logs NEVER contain raw tokens or passwords
    const auditBlob = JSON.stringify(sessionsJson.auditLogs);
    assert.ok(!auditBlob.includes(remoteBearerToken));
    assert.ok(!auditBlob.includes('AetheraMasterPassword2026!'));

    // --- Requirement 11: Persistence after full Backend Restart (re-open SQLite + same external key) ---
    await closeServer(webServerObj.server);
    webAppObj.db.close();

    webAppObj = createAetheraApiApp({
      dbPath: webDbPath,
      rendersDir,
      credentialKey,
      adminSetupToken,
      isProduction: false,
      enforceHttps: false,
      ssrfOptions: { allowLoopback: true },
      onPasswordResetIssued: ({ rawCode }) => {
        issuedResetCode = rawCode;
      },
    });
    webServerObj = await startServerOnPort(webAppObj.app, 0);
    webBase = `http://127.0.0.1:${webServerObj.port}`;

    // Existing cookie STILL valid after backend restart (page refresh / reopen browser)
    const afterRestartMe = await fetch(`${webBase}/api/auth/me`, {
      headers: { Cookie: setupCookie },
    });
    const afterRestartMeJson = (await afterRestartMe.json()) as { authenticated: boolean; csrfToken: string; computers: Array<{ id: string }> };
    assert.equal(afterRestartMeJson.authenticated, true);
    assert.equal(afterRestartMeJson.computers.length, 1);

    // Encrypted Remote Host credential decrypts & connects automatically after backend restart
    const afterRestartProxy = await fetch(`${webBase}/api/remote-proxy/status`, {
      headers: { Cookie: setupCookie },
    });
    const afterRestartProxyJson = (await afterRestartProxy.json()) as { connected: boolean };
    assert.equal(afterRestartProxyJson.connected, true);

    // --- Per-User Isolation: second user cannot access admin's bound PC ---
    const createMemberRes = await fetch(`${webBase}/api/auth/users`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: setupCookie,
        'X-CSRF-Token': afterRestartMeJson.csrfToken,
      },
      body: JSON.stringify({
        name: 'Editor Isolado',
        email: 'editor@aethera.studio',
        password: 'EditorPassword2026!',
        role: 'member',
      }),
    });
    assert.equal(createMemberRes.status, 201);

    const memberLoginRes = await fetch(`${webBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'editor@aethera.studio', password: 'EditorPassword2026!' }),
    });
    assert.equal(memberLoginRes.status, 200);
    const memberCookie = extractSessionCookie(memberLoginRes);

    const memberComputersRes = await fetch(`${webBase}/api/computers`, { headers: { Cookie: memberCookie } });
    const memberComputers = (await memberComputersRes.json()) as { computers: unknown[] };
    assert.equal(memberComputers.computers.length, 0);

    const memberCrossAccess = await fetch(`${webBase}/api/remote-proxy/status?computerId=${computerId}`, {
      headers: { Cookie: memberCookie },
    });
    const memberCrossJson = (await memberCrossAccess.json()) as { connected: boolean; configured: boolean };
    assert.equal(memberCrossJson.connected, false);
    assert.equal(memberCrossJson.configured, false);

    // --- Credential rotation & revocation ---
    const rotateRes = await fetch(`${webBase}/api/computers/${computerId}/rotate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: setupCookie,
        'X-CSRF-Token': afterRestartMeJson.csrfToken,
      },
      body: JSON.stringify({ bearerToken: 'rotated_token_does_not_match_host_123456' }),
    });
    assert.equal(rotateRes.status, 200);

    const badTokenProbe = await fetch(`${webBase}/api/remote-proxy/status`, {
      headers: { Cookie: setupCookie },
    });
    const badTokenJson = (await badTokenProbe.json()) as { connected: boolean; authFailed?: boolean };
    assert.equal(badTokenJson.connected, false);
    assert.equal(badTokenJson.authFailed, true);

    const revokeRes = await fetch(`${webBase}/api/computers/${computerId}/revoke`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: setupCookie,
        'X-CSRF-Token': afterRestartMeJson.csrfToken,
      },
    });
    assert.equal(revokeRes.status, 200);
    const revokeJson = (await revokeRes.json()) as { computer: { hasCredential: boolean; lastStatus: string } };
    assert.equal(revokeJson.computer.hasCredential, false);
    assert.equal(revokeJson.computer.lastStatus, 'revoked');

    // --- Password Recovery without exposing token in HTTP response ---
    issuedResetCode = null;
    const resetReqUnknown = await fetch(`${webBase}/api/auth/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'naoexiste@aethera.studio' }),
    });
    const resetReqKnown = await fetch(`${webBase}/api/auth/password-reset/request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'operador@aethera.studio' }),
    });
    const resetUnknownText = await resetReqUnknown.text();
    const resetKnownText = await resetReqKnown.text();
    assert.equal(resetUnknownText, resetKnownText, 'Password reset response must be identical to prevent user enumeration');
    assert.ok(issuedResetCode, 'Expected server-side out-of-band hook to receive reset code');
    assert.ok(!resetKnownText.includes(issuedResetCode), 'Reset code MUST NEVER be exposed in HTTP response');

    const confirmReset = await fetch(`${webBase}/api/auth/password-reset/confirm`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: issuedResetCode, newPassword: 'NovaSenhaSuperForte2026!' }),
    });
    assert.equal(confirmReset.status, 200);

    // Old sessions MUST be revoked after password reset
    const oldSessionCheck = await fetch(`${webBase}/api/bootstrap`, { headers: { Cookie: setupCookie } });
    assert.equal(oldSessionCheck.status, 401);

    // Login with new password works, then logout revokes session
    const relogin = await fetch(`${webBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'operador@aethera.studio', password: 'NovaSenhaSuperForte2026!' }),
    });
    assert.equal(relogin.status, 200);
    const reloginCookie = extractSessionCookie(relogin);
    const reloginJson = (await relogin.json()) as { csrfToken: string };

    // --- Requirement 8: Logout & Revocation ---
    const logoutRes = await fetch(`${webBase}/api/auth/logout`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: reloginCookie,
        'X-CSRF-Token': reloginJson.csrfToken,
      },
    });
    assert.equal(logoutRes.status, 200);

    const postLogoutBootstrap = await fetch(`${webBase}/api/bootstrap`, { headers: { Cookie: reloginCookie } });
    assert.equal(postLogoutBootstrap.status, 401);

    // --- Requirement 12c: Anti-Enumeration & Brute-Force Protection (429 after 5 failed attempts) ---
    const wrongUnknown = await fetch(`${webBase}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'desconhecido@aethera.studio', password: 'WrongPassword123' }),
    });
    assert.equal(wrongUnknown.status, 401);
    const wrongUnknownBody = (await wrongUnknown.json()) as { error: string };

    let lastStatus = 0;
    let firstKnownError = '';
    for (let i = 0; i < 6; i += 1) {
      const attempt = await fetch(`${webBase}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'operador@aethera.studio', password: 'WrongPassword123' }),
      });
      lastStatus = attempt.status;
      if (i === 0) {
        const body = (await attempt.json()) as { error: string };
        firstKnownError = body.error;
      }
    }
    assert.equal(firstKnownError, wrongUnknownBody.error, 'Login error must not enumerate existing emails');
    assert.equal(lastStatus, 429, 'Brute-force guard must lock out with HTTP 429 after repeated failures');
  } finally {
    await closeServer(webServerObj.server);
    webAppObj.db.close();
    await closeServer(remoteServerObj.server);
    remoteHost.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
