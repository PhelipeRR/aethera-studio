import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CONTRACT_SCHEMA_VERSION,
  IntegrationAuthRegistry,
  PeerPairingManager,
  defaultPipePath,
  removeDiscoveryRecord,
  startLoopbackIntegrationServer,
  writeDiscoveryRecord,
  type IAgentProviderContract,
} from '../src/index.js';

const tempDirs: string[] = [];

function createTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function makeAgent(id: 'claude' | 'codex'): IAgentProviderContract {
  return {
    id,
    getCapabilities: () => ['produce', 'review', 'orchestrate'],
    isAvailable: async () => true,
    execute: async ({ taskId, capability }) => ({
      ok: true,
      output: `executed:${id}:${capability}:${taskId}`,
    }),
  };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('SEP-06 — Conexões opcionais, pareamento, reconexão e revogação', () => {
  it('descobre peers, pareia com escopo, delega tarefa e reconcilia após queda/reinício em qualquer ordem', async () => {
    const discoveryDir = createTempDir('sep06-discovery-');
    const aetheraData = createTempDir('sep06-aethera-');
    const voidData = createTempDir('sep06-void-');

    const aetheraAuth = new IntegrationAuthRegistry();
    const voidAuth = new IntegrationAuthRegistry();

    const aetheraManager = new PeerPairingManager({
      selfAppId: 'aethera',
      discoveryDir,
      storageFile: join(aetheraData, 'pairings.json'),
      authRegistry: aetheraAuth,
    });
    const voidManager = new PeerPairingManager({
      selfAppId: 'void',
      discoveryDir,
      storageFile: join(voidData, 'pairings.json'),
      authRegistry: voidAuth,
      maxRetries: 1,
      baseRetryDelayMs: 10,
    });

    // 1. Aethera sobe primeiro com servidor real
    const aetheraServer1 = await startLoopbackIntegrationServer({
      appId: 'aethera',
      version: '0.1.65',
      capabilities: ['produce'],
      agents: [makeAgent('claude')],
      auth: aetheraAuth,
      requireAuth: true,
      ipcPath: defaultPipePath('aethera', `sep06-1-${Date.now()}`),
    });
    writeDiscoveryRecord(discoveryDir, {
      appId: 'aethera',
      pid: process.pid,
      version: '0.1.65',
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      capabilities: ['produce'],
      baseUrl: aetheraServer1.baseUrl,
      ...(aetheraServer1.ipcPath ? { ipcPath: aetheraServer1.ipcPath } : {}),
      startedAtIso: new Date().toISOString(),
    });

    // 2. Void descobre Aethera e realiza pareamento explícito
    const discovered = voidManager.discoverAvailablePeers();
    expect(discovered.map((p) => p.appId)).toEqual(['aethera']);

    const issued = aetheraManager.issueIncomingPairing({
      targetApp: 'void',
      scopes: ['health:read', 'capabilities:read', 'tasks:delegate', 'events:subscribe'],
    });
    const registered = await voidManager.registerOutboundPairing({
      peerAppId: 'aethera',
      tokenId: issued.record.tokenId,
      tokenSecret: issued.secret,
      scopes: [...issued.record.scopes],
      expiresAtMs: issued.record.expiresAtMs,
    });
    expect(registered.ok).toBe(true);

    const firstDelegation = await voidManager.delegateTask({
      peerAppId: 'aethera',
      kind: 'video.produce',
      capability: 'produce',
      payload: { topic: 'SEP-06 test' },
      idempotencyKey: 'idem-sep06-1',
    });
    expect(firstDelegation.ok).toBe(true);
    if (firstDelegation.ok) {
      expect(firstDelegation.task.status).toBe('completed');
    }

    // 3. Aethera cai abruptamente; Void degrada graciosamente para fallbackLocal sem travar
    await aetheraServer1.close();
    removeDiscoveryRecord(discoveryDir, 'aethera');

    const offlineDelegation = await voidManager.delegateTask({
      peerAppId: 'aethera',
      kind: 'video.produce',
      capability: 'produce',
      payload: { topic: 'offline' },
      idempotencyKey: 'idem-sep06-offline',
    });
    expect(offlineDelegation).toEqual({
      ok: false,
      fallbackLocal: true,
      reason: 'peer_offline',
    });

    // 4. Aethera reinicia em nova porta/pipe; Void reconecta e volta a delegar
    const aetheraServer2 = await startLoopbackIntegrationServer({
      appId: 'aethera',
      version: '0.1.65',
      capabilities: ['produce'],
      agents: [makeAgent('claude')],
      auth: aetheraAuth,
      requireAuth: true,
      ipcPath: defaultPipePath('aethera', `sep06-2-${Date.now()}`),
    });
    writeDiscoveryRecord(discoveryDir, {
      appId: 'aethera',
      pid: process.pid,
      version: '0.1.65',
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      capabilities: ['produce'],
      baseUrl: aetheraServer2.baseUrl,
      ...(aetheraServer2.ipcPath ? { ipcPath: aetheraServer2.ipcPath } : {}),
      startedAtIso: new Date().toISOString(),
    });

    const reconnected = await voidManager.reconnectPeer('aethera');
    expect(reconnected.connected).toBe(true);

    const resumedDelegation = await voidManager.delegateTask({
      peerAppId: 'aethera',
      kind: 'video.produce',
      capability: 'produce',
      payload: { topic: 'resumed' },
      idempotencyKey: 'idem-sep06-resumed',
    });
    expect(resumedDelegation.ok).toBe(true);

    // 5. Revogação bloqueia delegação e acesso no servidor
    expect(voidManager.revokePairing('aethera')).toBe(true);
    aetheraAuth.revoke(issued.record.tokenId);

    const afterRevoke = await voidManager.delegateTask({
      peerAppId: 'aethera',
      kind: 'video.produce',
      capability: 'produce',
      payload: { topic: 'blocked' },
      idempotencyKey: 'idem-sep06-revoked',
    });
    expect(afterRevoke).toEqual({
      ok: false,
      fallbackLocal: true,
      reason: 'pairing_revoked',
    });

    const unauthorizedRes = await aetheraServer2.dispatch({
      method: 'GET',
      url: '/v1/health',
      authorization: `Bearer ${issued.secret}`,
    });
    expect(unauthorizedRes.status).toBe(401);

    await aetheraServer2.close();
  });

  it('rejeita escopos insuficientes (403) e tokens expirados (401)', async () => {
    const auth = new IntegrationAuthRegistry();
    const readOnly = auth.issue({
      tokenId: 'tok-readonly',
      secret: 'sec-readonly',
      originApp: 'orchestrator',
      targetApp: 'void',
      scopes: ['health:read'],
      ttlMs: 60_000,
    });
    const expired = auth.issue({
      tokenId: 'tok-expired',
      secret: 'sec-expired',
      originApp: 'orchestrator',
      targetApp: 'void',
      scopes: ['health:read', 'tasks:delegate'],
      ttlMs: -1000,
    });

    const server = await startLoopbackIntegrationServer({
      appId: 'orchestrator',
      version: '0.1.65',
      capabilities: ['orchestrate'],
      agents: [makeAgent('codex')],
      auth,
      requireAuth: true,
    });

    const forbidden = await server.dispatch({
      method: 'POST',
      url: '/v1/tasks',
      authorization: `Bearer ${readOnly.secret}`,
      body: {},
    });
    expect(forbidden.status).toBe(403);

    const expiredRes = await server.dispatch({
      method: 'GET',
      url: '/v1/health',
      authorization: `Bearer ${expired.secret}`,
    });
    expect(expiredRes.status).toBe(401);

    await server.close();
  });

  it('nunca persiste tokenSecret em texto claro e suporta cifra/decriptação com secretCipher', async () => {
    const discoveryDir = createTempDir('sep06-sec-disc-');
    const voidDataPlain = createTempDir('sep06-sec-plain-');
    const voidDataCipher = createTempDir('sep06-sec-cipher-');
    const storagePlain = join(voidDataPlain, 'pairings.json');
    const storageCipher = join(voidDataCipher, 'pairings.json');

    const auth = new IntegrationAuthRegistry();
    const issued = auth.issue({
      tokenId: 'tok-sec-1',
      secret: 'super-secret-pairing-value',
      originApp: 'aethera',
      targetApp: 'void',
      scopes: ['health:read', 'tasks:delegate'],
      ttlMs: 60_000,
    });

    // Sem cipher: nunca grava o segredo em disco; ao reiniciar pede reautenticação
    const mgrNoCipher = new PeerPairingManager({
      selfAppId: 'void',
      discoveryDir,
      storageFile: storagePlain,
      authRegistry: new IntegrationAuthRegistry(),
    });
    await mgrNoCipher.registerOutboundPairing({
      peerAppId: 'aethera',
      tokenId: issued.tokenId,
      tokenSecret: issued.secret,
      scopes: [...issued.scopes],
      expiresAtMs: issued.expiresAtMs,
    });
    const rawPlainDisk = readFileSync(storagePlain, 'utf8');
    expect(rawPlainDisk).not.toContain('super-secret-pairing-value');
    expect(rawPlainDisk).toContain('"tokenSecretRedacted": true');

    const reloadedNoCipher = new PeerPairingManager({
      selfAppId: 'void',
      discoveryDir,
      storageFile: storagePlain,
      authRegistry: new IntegrationAuthRegistry(),
    });
    const reconNoCipher = await reloadedNoCipher.reconnectPeer('aethera');
    expect(reconNoCipher).toEqual({ connected: false, reason: 'reauth_required' });

    // Com cipher: grava cifrado e restaura em memória após reinício
    const xorCipher = {
      encrypt: (plain: string) => Buffer.from(plain, 'utf8').toString('base64'),
      decrypt: (cipher: string) => Buffer.from(cipher, 'base64').toString('utf8'),
    };
    const mgrWithCipher = new PeerPairingManager({
      selfAppId: 'void',
      discoveryDir,
      storageFile: storageCipher,
      authRegistry: new IntegrationAuthRegistry(),
      secretCipher: xorCipher,
    });
    await mgrWithCipher.registerOutboundPairing({
      peerAppId: 'aethera',
      tokenId: issued.tokenId,
      tokenSecret: issued.secret,
      scopes: [...issued.scopes],
      expiresAtMs: issued.expiresAtMs,
    });
    const rawCipherDisk = readFileSync(storageCipher, 'utf8');
    expect(rawCipherDisk).not.toContain('super-secret-pairing-value');
    expect(rawCipherDisk).toContain('"encryptedTokenSecret"');

    const reloadedWithCipher = new PeerPairingManager({
      selfAppId: 'void',
      discoveryDir,
      storageFile: storageCipher,
      authRegistry: new IntegrationAuthRegistry(),
      secretCipher: xorCipher,
    });
    const reconWithCipher = await reloadedWithCipher.reconnectPeer('aethera');
    // Sem peer online, deve retornar peer_offline (não reauth_required) porque o token foi decriptado
    expect(reconWithCipher).toEqual({ connected: false, reason: 'peer_offline' });
  });
});
