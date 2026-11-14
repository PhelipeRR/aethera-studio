import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CONTRACT_SCHEMA_VERSION,
  type IntegrationAuthRegistry,
  isCompatibleSchemaVersion,
  type AppId,
  type DelegatedTaskRequest,
  type DelegatedTaskStatus,
  type IntegrationScope,
} from './index.js';
import { createSocketIntegrationTransport, discoverPeers, type PeerDiscoveryRecord } from './discovery.js';

export interface PairingSecretCipher {
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
}

export interface StoredPairingRecord {
  peerAppId: AppId;
  tokenId: string;
  tokenSecret: string;
  encryptedTokenSecret?: string;
  tokenSecretRedacted?: boolean;
  scopes: IntegrationScope[];
  pairedAtIso: string;
  expiresAtMs: number;
  revoked: boolean;
  lastKnownBaseUrl?: string;
  lastKnownIpcPath?: string;
  status: 'connected' | 'disconnected' | 'revoked';
}

export interface PairingManagerOptions {
  selfAppId: AppId;
  discoveryDir: string;
  storageFile: string;
  authRegistry: IntegrationAuthRegistry;
  secretCipher?: PairingSecretCipher;
  maxRetries?: number;
  baseRetryDelayMs?: number;
}

export class PeerPairingManager {
  private readonly pairings = new Map<AppId, StoredPairingRecord>();
  private readonly circuitFailures = new Map<AppId, { count: number; openUntilMs: number }>();
  private readonly maxRetries: number;
  private readonly baseRetryDelayMs: number;

  constructor(private readonly options: PairingManagerOptions) {
    this.maxRetries = options.maxRetries ?? 2;
    this.baseRetryDelayMs = options.baseRetryDelayMs ?? 40;
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.options.storageFile)) return;
      const raw = JSON.parse(readFileSync(this.options.storageFile, 'utf8')) as Array<
        Partial<StoredPairingRecord>
      >;
      if (Array.isArray(raw)) {
        for (const item of raw) {
          if (!item?.peerAppId || !item.tokenId || !item.pairedAtIso || typeof item.expiresAtMs !== 'number') {
            continue;
          }
          let tokenSecret = '';
          if (item.encryptedTokenSecret && this.options.secretCipher) {
            try {
              tokenSecret = this.options.secretCipher.decrypt(item.encryptedTokenSecret);
            } catch {
              tokenSecret = '';
            }
          }
          this.pairings.set(item.peerAppId, {
            peerAppId: item.peerAppId,
            tokenId: item.tokenId,
            tokenSecret,
            scopes: Array.isArray(item.scopes) ? item.scopes : [],
            pairedAtIso: item.pairedAtIso,
            expiresAtMs: item.expiresAtMs,
            revoked: Boolean(item.revoked),
            ...(item.lastKnownBaseUrl ? { lastKnownBaseUrl: item.lastKnownBaseUrl } : {}),
            ...(item.lastKnownIpcPath ? { lastKnownIpcPath: item.lastKnownIpcPath } : {}),
            status: tokenSecret && !item.revoked ? (item.status ?? 'disconnected') : 'disconnected',
          });
        }
      }
    } catch {
      // Ignore corrupt pairing file and start clean
    }
  }

  private saveToDisk(): void {
    mkdirSync(join(this.options.storageFile, '..'), { recursive: true });
    const serialized = [...this.pairings.values()].map((record) => {
      const base = {
        peerAppId: record.peerAppId,
        tokenId: record.tokenId,
        scopes: record.scopes,
        pairedAtIso: record.pairedAtIso,
        expiresAtMs: record.expiresAtMs,
        revoked: record.revoked,
        ...(record.lastKnownBaseUrl ? { lastKnownBaseUrl: record.lastKnownBaseUrl } : {}),
        ...(record.lastKnownIpcPath ? { lastKnownIpcPath: record.lastKnownIpcPath } : {}),
        status: record.status,
      };
      if (this.options.secretCipher && record.tokenSecret) {
        return {
          ...base,
          encryptedTokenSecret: this.options.secretCipher.encrypt(record.tokenSecret),
        };
      }
      return {
        ...base,
        tokenSecretRedacted: true,
      };
    });
    writeFileSync(this.options.storageFile, JSON.stringify(serialized, null, 2), 'utf8');
  }

  discoverAvailablePeers(): PeerDiscoveryRecord[] {
    return discoverPeers(this.options.discoveryDir).filter((p) => p.appId !== this.options.selfAppId);
  }

  listPairings(): Array<Omit<StoredPairingRecord, 'tokenSecret'>> {
    return [...this.pairings.values()].map((record) => ({
      peerAppId: record.peerAppId,
      tokenId: record.tokenId,
      scopes: record.scopes,
      pairedAtIso: record.pairedAtIso,
      expiresAtMs: record.expiresAtMs,
      revoked: record.revoked,
      ...(record.lastKnownBaseUrl ? { lastKnownBaseUrl: record.lastKnownBaseUrl } : {}),
      ...(record.lastKnownIpcPath ? { lastKnownIpcPath: record.lastKnownIpcPath } : {}),
      status: record.status,
    }));
  }

  /**
   * Issues a scoped pairing token on behalf of a peer requesting access to THIS app.
   */
  issueIncomingPairing(input: {
    targetApp: AppId;
    scopes: IntegrationScope[];
    ttlMs?: number;
  }) {
    const tokenId = `tok_${randomUUID()}`;
    const secret = randomBytes(24).toString('hex');
    const record = this.options.authRegistry.issue({
      tokenId,
      secret,
      originApp: this.options.selfAppId,
      targetApp: input.targetApp,
      scopes: input.scopes,
      ttlMs: input.ttlMs ?? 24 * 60 * 60 * 1000,
    });
    return { record, secret };
  }

  /**
   * Registers an outbound pairing credential to communicate with a peer app.
   */
  async registerOutboundPairing(input: {
    peerAppId: AppId;
    tokenId: string;
    tokenSecret: string;
    scopes: IntegrationScope[];
    expiresAtMs: number;
  }): Promise<{ ok: true; record: Omit<StoredPairingRecord, 'tokenSecret'> } | { ok: false; reason: string }> {
    const peer = this.discoverAvailablePeers().find((p) => p.appId === input.peerAppId);
    if (peer && !isCompatibleSchemaVersion(peer.schemaVersion)) {
      return { ok: false, reason: `incompatible_schema:${peer.schemaVersion}` };
    }

    const record: StoredPairingRecord = {
      peerAppId: input.peerAppId,
      tokenId: input.tokenId,
      tokenSecret: input.tokenSecret,
      scopes: [...input.scopes],
      pairedAtIso: new Date().toISOString(),
      expiresAtMs: input.expiresAtMs,
      revoked: false,
      ...(peer?.baseUrl ? { lastKnownBaseUrl: peer.baseUrl } : {}),
      ...(peer?.ipcPath ? { lastKnownIpcPath: peer.ipcPath } : {}),
      status: peer ? 'connected' : 'disconnected',
    };
    this.pairings.set(input.peerAppId, record);
    this.circuitFailures.delete(input.peerAppId);
    this.saveToDisk();

    const safeRecord: Omit<StoredPairingRecord, 'tokenSecret'> = {
      peerAppId: record.peerAppId,
      tokenId: record.tokenId,
      scopes: record.scopes,
      pairedAtIso: record.pairedAtIso,
      expiresAtMs: record.expiresAtMs,
      revoked: record.revoked,
      ...(record.lastKnownBaseUrl ? { lastKnownBaseUrl: record.lastKnownBaseUrl } : {}),
      ...(record.lastKnownIpcPath ? { lastKnownIpcPath: record.lastKnownIpcPath } : {}),
      status: record.status,
    };
    return { ok: true, record: safeRecord };
  }

  revokePairing(peerAppId: AppId): boolean {
    const existing = this.pairings.get(peerAppId);
    if (!existing) return false;
    existing.revoked = true;
    existing.status = 'revoked';
    this.options.authRegistry.revoke(existing.tokenId);
    this.saveToDisk();
    return true;
  }

  async reconnectPeer(peerAppId: AppId): Promise<{ connected: boolean; reason?: string; peer?: PeerDiscoveryRecord }> {
    const pairing = this.pairings.get(peerAppId);
    if (!pairing) return { connected: false, reason: 'not_paired' };
    if (pairing.revoked) return { connected: false, reason: 'pairing_revoked' };
    if (Date.now() > pairing.expiresAtMs) return { connected: false, reason: 'pairing_expired' };
    if (!pairing.tokenSecret) return { connected: false, reason: 'reauth_required' };

    const peer = this.discoverAvailablePeers().find((p) => p.appId === peerAppId);
    if (!peer) {
      pairing.status = 'disconnected';
      this.saveToDisk();
      return { connected: false, reason: 'peer_offline' };
    }

    const transport = createSocketIntegrationTransport({
      ...(peer.ipcPath ? { socketPath: peer.ipcPath } : {}),
      baseUrl: peer.baseUrl,
      token: pairing.tokenSecret,
      timeoutMs: 2500,
    });

    try {
      const health = await transport.health();
      if (!isCompatibleSchemaVersion(health.schemaVersion)) {
        return { connected: false, reason: `incompatible_schema:${health.schemaVersion}` };
      }
      pairing.lastKnownBaseUrl = peer.baseUrl;
      if (peer.ipcPath) pairing.lastKnownIpcPath = peer.ipcPath;
      else delete pairing.lastKnownIpcPath;
      pairing.status = 'connected';
      this.circuitFailures.delete(peerAppId);
      this.saveToDisk();
      return { connected: true, peer };
    } catch (err) {
      pairing.status = 'disconnected';
      this.saveToDisk();
      return { connected: false, reason: err instanceof Error ? err.message : 'health_failed' };
    }
  }

  async delegateTask(input: {
    peerAppId: AppId;
    kind: string;
    capability: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    timeoutMs?: number;
  }): Promise<
    | { ok: true; delegated: true; task: DelegatedTaskStatus }
    | { ok: false; fallbackLocal: true; reason: string }
  > {
    const pairing = this.pairings.get(input.peerAppId);
    if (!pairing) return { ok: false, fallbackLocal: true, reason: 'not_paired' };
    if (pairing.revoked) return { ok: false, fallbackLocal: true, reason: 'pairing_revoked' };
    if (Date.now() > pairing.expiresAtMs) return { ok: false, fallbackLocal: true, reason: 'pairing_expired' };
    if (!pairing.tokenSecret) return { ok: false, fallbackLocal: true, reason: 'reauth_required' };

    const circuit = this.circuitFailures.get(input.peerAppId);
    if (circuit && Date.now() < circuit.openUntilMs) {
      return { ok: false, fallbackLocal: true, reason: 'circuit_open' };
    }

    let lastError = 'peer_offline';
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const peer = this.discoverAvailablePeers().find((p) => p.appId === input.peerAppId);
      if (peer) {
        const transport = createSocketIntegrationTransport({
          ...(peer.ipcPath ? { socketPath: peer.ipcPath } : {}),
          baseUrl: peer.baseUrl,
          token: pairing.tokenSecret,
          timeoutMs: input.timeoutMs ?? 5000,
        });
        const req: DelegatedTaskRequest = {
          envelope: {
            requestId: `${this.options.selfAppId}-${Date.now()}-${attempt}`,
            correlationId: `${this.options.selfAppId}-${input.idempotencyKey}`,
            idempotencyKey: input.idempotencyKey,
            schemaVersion: CONTRACT_SCHEMA_VERSION,
            originApp: this.options.selfAppId,
            scopes: ['tasks:delegate'],
            timeoutMs: input.timeoutMs ?? 5000,
          },
          kind: input.kind,
          capability: input.capability,
          input: input.payload,
        };
        try {
          const task = await transport.submitTask(req);
          pairing.lastKnownBaseUrl = peer.baseUrl;
          if (peer.ipcPath) pairing.lastKnownIpcPath = peer.ipcPath;
          else delete pairing.lastKnownIpcPath;
          pairing.status = 'connected';
          this.circuitFailures.delete(input.peerAppId);
          this.saveToDisk();
          return { ok: true, delegated: true, task };
        } catch (err) {
          lastError = err instanceof Error ? err.message : 'submit_failed';
        }
      }
      if (attempt < this.maxRetries) {
        await new Promise((r) => setTimeout(r, this.baseRetryDelayMs * Math.pow(2, attempt)));
      }
    }

    const prevCount = (circuit?.count ?? 0) + 1;
    this.circuitFailures.set(input.peerAppId, {
      count: prevCount,
      openUntilMs: Date.now() + Math.min(30_000, 1000 * prevCount),
    });
    pairing.status = 'disconnected';
    this.saveToDisk();
    return { ok: false, fallbackLocal: true, reason: lastError };
  }
}

export interface IpcRegistrarLike {
  handle(channel: string, listener: (_event: unknown, ...args: unknown[]) => unknown): void;
}

/**
 * Registers SEP-06 optional ecosystem pairing, discovery, reconnection, revocation,
 * and task delegation IPC handlers without coupling integration-contracts to Electron.
 */
export function registerPairingIpcHandlers(
  ipc: IpcRegistrarLike,
  manager: PeerPairingManager,
): void {
  ipc.handle('integration:discoverPeers', () => manager.discoverAvailablePeers());
  ipc.handle('integration:listPairings', () => manager.listPairings());
  ipc.handle('integration:issuePairing', (_e, raw) => {
    const input = (raw ?? {}) as { targetApp: AppId; scopes: IntegrationScope[]; ttlMs?: number };
    return manager.issueIncomingPairing(input);
  });
  ipc.handle('integration:registerPairing', (_e, raw) => {
    const input = (raw ?? {}) as {
      peerAppId: AppId;
      tokenId: string;
      tokenSecret: string;
      scopes: IntegrationScope[];
      expiresAtMs: number;
    };
    return manager.registerOutboundPairing(input);
  });
  ipc.handle('integration:revokePairing', (_e, peerAppId) => manager.revokePairing(peerAppId as AppId));
  ipc.handle('integration:reconnectPeer', (_e, peerAppId) => manager.reconnectPeer(peerAppId as AppId));
  ipc.handle('integration:delegateTask', (_e, raw) => {
    const input = (raw ?? {}) as {
      peerAppId: AppId;
      kind: string;
      capability: string;
      payload: Record<string, unknown>;
      idempotencyKey: string;
      timeoutMs?: number;
    };
    return manager.delegateTask(input);
  });
}
