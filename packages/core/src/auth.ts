import { createHash, createPublicKey, randomBytes, randomInt, randomUUID, verify, type JsonWebKey } from 'node:crypto';
import type { DatabaseHandle } from '@neuralbridge/database';
import type { pairingClaimRequestSchema} from '@neuralbridge/shared/core-api';
import {
  AUTH, devicePublicKeySchema, grantSchema, proofClaimsSchema, SCOPE_IDS, remoteGrantable,
  type DevicePublicKey, type Grant, type PairingOffer, type Principal,
} from '@neuralbridge/shared/core-api';
import type { z } from 'zod';

/*
 * CORE-07: device pairing, tokens, proof of possession, revocation and audit (ADR CORE-01 §2.5, D-8; contracts in
 * CORE-02 auth.ts). Secrets are never stored: codes and tokens are kept as SHA-256 hashes. Every outcome is audited
 * without the code, token, key or body.
 */

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const b64url = (value: Buffer): string => value.toString('base64url');
const iso = (date: Date): string => date.toISOString();

export type AuthPrincipal = Principal & { grant: Grant; deviceId: string | null };

export const DESKTOP_GRANT: Grant = { scopes: [...SCOPE_IDS], projects: { projects: 'all', includePrivate: true } };

export class AuthError extends Error {
  constructor(readonly code: 'unauthenticated' | 'token_expired' | 'proof_invalid' | 'device_revoked' | 'pairing_expired' | 'locked_out' | 'not_found' | 'conflict' | 'invalid_request' | 'rate_limited', message: string, readonly retryAfterMs?: number) { super(message); }
}

/** RFC 7638 thumbprint of a P-256 key: identifies the device key without storing anything secret. */
export function keyThumbprint(key: DevicePublicKey): string {
  return b64url(createHash('sha256').update(JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y })).digest());
}

/** Fixed-window limiter with progressive lockout after failures (pairing and token requests). */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private readonly failures = new Map<string, { count: number; until: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  /** Throws rate_limited / locked_out when the caller must wait. */
  check(key: string, limit: { requests: number; perMs: number }): void {
    const at = this.now();
    const locked = this.failures.get(key);
    if (locked && locked.until > at) throw new AuthError('locked_out', 'Muitas tentativas. Aguarde antes de tentar de novo.', locked.until - at);
    const window = this.windows.get(key);
    if (!window || at - window.start >= limit.perMs) { this.windows.set(key, { start: at, count: 1 }); return; }
    window.count += 1;
    if (window.count > limit.requests) throw new AuthError('rate_limited', 'Limite de requisições atingido.', limit.perMs - (at - window.start));
  }

  fail(key: string): void {
    const entry = this.failures.get(key) ?? { count: 0, until: 0 };
    entry.count += 1;
    // Three free misses, then the lockout steps (1 min, 5 min, 15 min, 1 h).
    if (entry.count > 2) entry.until = this.now() + (AUTH.pairing.lockoutStepsMs[Math.min(entry.count - 3, AUTH.pairing.lockoutStepsMs.length - 1)] ?? 3_600_000);
    this.failures.set(key, entry);
  }

  succeed(key: string): void { this.failures.delete(key); }
}

export interface AuthServiceOptions {
  handle: DatabaseHandle;
  coreId: string;
  /** SHA-256 hex of the Core identity, shown on both screens during pairing. */
  fingerprint: string;
  now?: () => Date;
  /** Called after a device is revoked, so open streams of that device are closed at once. */
  onRevoked?: (deviceIds: string[]) => number;
}

export class AuthService {
  private readonly now: () => Date;
  readonly limiter: RateLimiter;
  constructor(private readonly options: AuthServiceOptions) {
    this.now = options.now ?? (() => new Date());
    this.limiter = new RateLimiter(() => this.now().getTime());
  }

  private get db() { return this.options.handle.sqlite; }

  audit(action: string, principal: Principal, target: string | null, outcome: 'ok' | 'denied' | 'error', detail: string | null = null): void {
    this.db.prepare('INSERT INTO core_audit (id, at, action, principal_kind, principal_id, principal_label, target, outcome, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(randomUUID(), iso(this.now()), action, principal.kind, principal.id.slice(0, 128), principal.label?.slice(0, 120) ?? null, target?.slice(0, 140) ?? null, outcome, detail?.slice(0, 300) ?? null);
  }

  auditPage(limit: number, before: string | null): Array<Record<string, unknown>> {
    const rows = this.db.prepare(`SELECT id, at, action, principal_kind AS kind, principal_id AS principalId, principal_label AS label, target, outcome, detail FROM core_audit ${before ? 'WHERE at < ?' : ''} ORDER BY at DESC LIMIT ?`).all(...(before ? [before, limit] : [limit])) as Array<{ id: string; at: string; action: string; kind: string; principalId: string; label: string | null; target: string | null; outcome: string; detail: string | null }>;
    return rows.map((row) => ({ id: row.id, at: row.at, action: row.action, principal: { kind: row.kind, id: row.principalId, label: row.label }, target: row.target, outcome: row.outcome, detail: row.detail }));
  }

  // ── Pairing ────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Desktop only: a one-time code bound to this Core, valid for 5 minutes. */
  startPairing(grant: Grant, endpoint: string): PairingOffer {
    for (const scope of grant.scopes) if (!remoteGrantable(scope)) throw new AuthError('invalid_request', `O escopo ${scope} não pode ser dado a um aparelho.`);
    const alphabet = AUTH.pairing.codeAlphabet;
    const code = Array.from({ length: AUTH.pairing.codeLength }, () => alphabet[randomInt(alphabet.length)]).join('');
    const created = this.now();
    const expires = new Date(created.getTime() + AUTH.pairing.codeTtlMs);
    const id = randomUUID();
    this.db.prepare('INSERT INTO core_pairings (id, code_hash, grant_json, state, created_at, expires_at) VALUES (?, ?, ?, \'offered\', ?, ?)').run(id, sha256(code), JSON.stringify(grantSchema.parse(grant)), iso(created), iso(expires));
    this.audit('pairing.started', { kind: 'desktop', id: 'desktop', label: null }, `pairing:${id}`, 'ok');
    return { v: 1, coreId: this.options.coreId, endpoint, code, expiresAt: iso(expires), fingerprint: this.options.fingerprint };
  }

  /** The phone presents the code and its public key; the desktop must still confirm. */
  claim(input: z.infer<typeof pairingClaimRequestSchema>, source: string): { pairingId: string; status: 'awaiting_confirmation'; pollAfterMs: number } {
    const row = this.db.prepare('SELECT id, state, expires_at AS expiresAt FROM core_pairings WHERE code_hash = ?').get(sha256(input.code)) as { id: string; state: string; expiresAt: string } | undefined;
    const anonymous: Principal = { kind: 'device', id: `pending:${source}`.slice(0, 128), label: input.deviceName };
    if (!row || row.state !== 'offered') {
      this.limiter.fail(`pairing:${source}`);
      this.audit('pairing.failed', anonymous, null, 'denied', 'código inválido ou já usado');
      throw new AuthError('not_found', 'Código inválido.');
    }
    if (row.expiresAt < iso(this.now())) {
      this.db.prepare('UPDATE core_pairings SET state = \'expired\' WHERE id = ?').run(row.id);
      throw new AuthError('pairing_expired', 'O código expirou. Gere outro no desktop.');
    }
    const key = devicePublicKeySchema.parse(input.publicKey);
    this.db.prepare('UPDATE core_pairings SET state = \'awaiting_confirmation\', device_name = ?, platform = ?, app_version = ?, public_key = ? WHERE id = ? AND state = \'offered\'').run(input.deviceName, input.platform, input.appVersion, JSON.stringify(key), row.id);
    this.limiter.succeed(`pairing:${source}`);
    this.audit('pairing.claimed', anonymous, `pairing:${row.id}`, 'ok');
    return { pairingId: row.id, status: 'awaiting_confirmation', pollAfterMs: 2_000 };
  }

  pairingStatus(id: string): { pairingId: string; state: string; deviceId: string | null } {
    const row = this.db.prepare('SELECT id, state, device_id AS deviceId, expires_at AS expiresAt FROM core_pairings WHERE id = ?').get(id) as { id: string; state: string; deviceId: string | null; expiresAt: string } | undefined;
    if (!row) throw new AuthError('not_found', 'Pareamento não encontrado.');
    const state = (row.state === 'offered' || row.state === 'awaiting_confirmation') && row.expiresAt < iso(this.now()) ? 'expired' : row.state;
    return { pairingId: row.id, state, deviceId: row.deviceId };
  }

  pendingPairings(): Array<{ pairingId: string; deviceName: string; platform: string; appVersion: string; expiresAt: string }> {
    return (this.db.prepare('SELECT id AS pairingId, device_name AS deviceName, platform, app_version AS appVersion, expires_at AS expiresAt FROM core_pairings WHERE state = \'awaiting_confirmation\' AND expires_at >= ?').all(iso(this.now())) as Array<{ pairingId: string; deviceName: string; platform: string; appVersion: string; expiresAt: string }>);
  }

  /** Desktop only: "Parear o iPhone de Fulano?" — only an approval creates the device. */
  decide(id: string, decision: 'approve' | 'reject', grant?: Grant): { pairingId: string; state: string; deviceId: string | null } {
    const row = this.db.prepare('SELECT * FROM core_pairings WHERE id = ?').get(id) as { id: string; state: string; grant_json: string; device_name: string; platform: string; app_version: string; public_key: string; expires_at: string } | undefined;
    if (!row) throw new AuthError('not_found', 'Pareamento não encontrado.');
    if (row.state !== 'awaiting_confirmation') throw new AuthError('conflict', 'Este pareamento não está aguardando confirmação.');
    if (row.expires_at < iso(this.now())) throw new AuthError('pairing_expired', 'O código expirou.');
    const desktop: Principal = { kind: 'desktop', id: 'desktop', label: null };
    if (decision === 'reject') {
      this.db.prepare('UPDATE core_pairings SET state = \'rejected\' WHERE id = ?').run(id);
      this.audit('pairing.rejected', desktop, `pairing:${id}`, 'ok');
      return { pairingId: id, state: 'rejected', deviceId: null };
    }
    const finalGrant = grantSchema.parse(grant ?? JSON.parse(row.grant_json));
    for (const scope of finalGrant.scopes) if (!remoteGrantable(scope)) throw new AuthError('invalid_request', `O escopo ${scope} não pode ser dado a um aparelho.`);
    const key = devicePublicKeySchema.parse(JSON.parse(row.public_key));
    const deviceId = randomUUID();
    const tx = this.options.handle.sqlite.transaction(() => {
      this.db.prepare('INSERT INTO core_devices (id, name, platform, app_version, public_key, key_thumbprint, grant_json, paired_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(deviceId, row.device_name, row.platform, row.app_version, JSON.stringify(key), keyThumbprint(key), JSON.stringify(finalGrant), iso(this.now()));
      this.db.prepare('UPDATE core_pairings SET state = \'approved\', device_id = ?, grant_json = ? WHERE id = ?').run(deviceId, JSON.stringify(finalGrant), id);
    });
    tx();
    this.audit('pairing.approved', desktop, `device:${deviceId}`, 'ok', row.device_name);
    return { pairingId: id, state: 'approved', deviceId };
  }

  // ── Proof of possession ────────────────────────────────────────────────────────────────────────────────────────
  /** Verifies a DPoP proof (RFC 9449) for this request; returns the proof key's thumbprint. */
  verifyProof(proof: string | undefined, method: string, url: string, accessToken: string | null, expectedKey: DevicePublicKey | null): DevicePublicKey {
    if (!proof) throw new AuthError('proof_invalid', 'Prova de posse ausente.');
    const parts = proof.split('.');
    if (parts.length !== 3) throw new AuthError('proof_invalid', 'Prova de posse malformada.');
    const [headerPart = '', payloadPart = '', signaturePart = ''] = parts;
    let header: { typ?: unknown; alg?: unknown; jwk?: unknown };
    let payload: unknown;
    try {
      header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as typeof header;
      payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8')) as unknown;
    } catch { throw new AuthError('proof_invalid', 'Prova de posse malformada.'); }
    if (header.typ !== 'dpop+jwt' || header.alg !== 'ES256') throw new AuthError('proof_invalid', 'Prova de posse com tipo ou algoritmo errado.');
    const key = devicePublicKeySchema.safeParse(header.jwk);
    if (!key.success) throw new AuthError('proof_invalid', 'Chave da prova inválida.');
    if (expectedKey && keyThumbprint(expectedKey) !== keyThumbprint(key.data)) throw new AuthError('proof_invalid', 'A prova não foi assinada pela chave deste aparelho.');
    const valid = verify('sha256', Buffer.from(`${headerPart}.${payloadPart}`), { key: createPublicKey({ key: key.data as JsonWebKey, format: 'jwk' }), dsaEncoding: 'ieee-p1363' }, Buffer.from(signaturePart, 'base64url'));
    if (!valid) throw new AuthError('proof_invalid', 'Assinatura da prova inválida.');
    const claims = proofClaimsSchema.safeParse(payload);
    if (!claims.success) throw new AuthError('proof_invalid', 'Prova de posse incompleta.');
    if (claims.data.htm !== method.toUpperCase()) throw new AuthError('proof_invalid', 'A prova é de outro método.');
    if (claims.data.htu !== url) throw new AuthError('proof_invalid', 'A prova é de outro endereço.');
    if (Math.abs(this.now().getTime() - claims.data.iat * 1000) > AUTH.proofMaxSkewMs) throw new AuthError('proof_invalid', 'A prova está fora do horário aceito.');
    if (accessToken !== null && claims.data.ath !== b64url(createHash('sha256').update(accessToken).digest())) throw new AuthError('proof_invalid', 'A prova não corresponde ao token.');
    this.db.prepare('DELETE FROM core_proof_ids WHERE expires_at < ?').run(iso(this.now()));
    const fresh = this.db.prepare('INSERT INTO core_proof_ids (jti, expires_at) VALUES (?, ?) ON CONFLICT(jti) DO NOTHING').run(sha256(claims.data.jti), iso(new Date(this.now().getTime() + AUTH.proofReplayWindowMs)));
    if (fresh.changes !== 1) throw new AuthError('proof_invalid', 'Prova de posse repetida.');
    return key.data;
  }

  // ── Tokens ─────────────────────────────────────────────────────────────────────────────────────────────────────
  private issue(deviceId: string, familyId: string): { accessToken: string; refreshToken: string; expiresInMs: number; refreshExpiresAt: string } {
    const accessToken = b64url(randomBytes(32));
    const refreshToken = b64url(randomBytes(32));
    const now = this.now();
    const refreshExpires = new Date(now.getTime() + AUTH.refreshTokenTtlMs);
    const insert = this.db.prepare('INSERT INTO core_tokens (token_hash, device_id, family_id, kind, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run(sha256(accessToken), deviceId, familyId, 'access', iso(new Date(now.getTime() + AUTH.accessTokenTtlMs)), iso(now));
    insert.run(sha256(refreshToken), deviceId, familyId, 'refresh', iso(refreshExpires), iso(now));
    return { accessToken, refreshToken, expiresInMs: AUTH.accessTokenTtlMs, refreshExpiresAt: iso(refreshExpires) };
  }

  private device(id: string): { id: string; name: string; grant: Grant; key: DevicePublicKey; revokedAt: string | null } | null {
    const row = this.db.prepare('SELECT id, name, grant_json AS grantJson, public_key AS publicKey, revoked_at AS revokedAt FROM core_devices WHERE id = ?').get(id) as { id: string; name: string; grantJson: string; publicKey: string; revokedAt: string | null } | undefined;
    return row ? { id: row.id, name: row.name, grant: grantSchema.parse(JSON.parse(row.grantJson)), key: devicePublicKeySchema.parse(JSON.parse(row.publicKey)), revokedAt: row.revokedAt } : null;
  }

  /** Exchange an approved pairing (once) or a refresh token (rotated) for new tokens, proving key possession. */
  token(input: { grantType: 'pairing'; pairingId: string } | { grantType: 'refresh_token'; refreshToken: string }, proof: string | undefined, url: string, source: string) {
    try {
      let deviceId: string;
      let familyId: string;
      if (input.grantType === 'pairing') {
        const pairing = this.db.prepare('SELECT state, device_id AS deviceId FROM core_pairings WHERE id = ?').get(input.pairingId) as { state: string; deviceId: string | null } | undefined;
        if (!pairing || pairing.state !== 'approved' || !pairing.deviceId) throw new AuthError('unauthenticated', 'Pareamento não aprovado ou já usado.');
        const device = this.device(pairing.deviceId);
        if (!device || device.revokedAt) throw new AuthError('device_revoked', 'Aparelho revogado.');
        this.verifyProof(proof, 'POST', url, null, device.key);
        // Single use: the pairing cannot mint tokens twice.
        this.db.prepare('UPDATE core_pairings SET state = \'burned\' WHERE id = ?').run(input.pairingId);
        deviceId = device.id;
        familyId = randomUUID();
      } else {
        const row = this.db.prepare('SELECT device_id AS deviceId, family_id AS familyId, kind, expires_at AS expiresAt, used_at AS usedAt, revoked_at AS revokedAt FROM core_tokens WHERE token_hash = ?').get(sha256(input.refreshToken)) as { deviceId: string; familyId: string; kind: string; expiresAt: string; usedAt: string | null; revokedAt: string | null } | undefined;
        if (!row || row.kind !== 'refresh') throw new AuthError('unauthenticated', 'Refresh token inválido.');
        const device = this.device(row.deviceId);
        if (!device || device.revokedAt) throw new AuthError('device_revoked', 'Aparelho revogado.');
        this.verifyProof(proof, 'POST', url, null, device.key);
        if (row.usedAt || row.revokedAt) {
          // A rotated token came back: someone else has it. Revoke the whole family; the device must pair again.
          this.db.prepare('UPDATE core_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL').run(iso(this.now()), row.familyId);
          this.audit('token.reuse_detected', { kind: 'device', id: device.id, label: device.name }, `device:${device.id}`, 'denied');
          throw new AuthError('unauthenticated', 'Refresh token reutilizado. Pareie o aparelho novamente.');
        }
        if (row.expiresAt < iso(this.now())) throw new AuthError('token_expired', 'Refresh token expirado.');
        this.db.prepare('UPDATE core_tokens SET used_at = ? WHERE token_hash = ?').run(iso(this.now()), sha256(input.refreshToken));
        deviceId = device.id;
        familyId = row.familyId;
      }
      const device = this.device(deviceId);
      if (!device) throw new AuthError('unauthenticated', 'Aparelho desconhecido.');
      const tokens = this.issue(deviceId, familyId);
      this.limiter.succeed(`token:${source}`);
      this.audit(input.grantType === 'pairing' ? 'token.issued' : 'token.refreshed', { kind: 'device', id: deviceId, label: device.name }, `device:${deviceId}`, 'ok');
      return { tokenType: 'DPoP' as const, ...tokens, deviceId, grant: device.grant };
    } catch (error) {
      if (error instanceof AuthError && error.code !== 'rate_limited' && error.code !== 'locked_out') {
        this.limiter.fail(`token:${source}`);
        this.audit('auth.denied', { kind: 'device', id: `unknown:${source}`.slice(0, 128), label: null }, null, 'denied', error.code);
      }
      throw error;
    }
  }

  /** Resolves `Authorization: DPoP <token>` + `DPoP: <proof>` to the device principal, checking expiry and revocation. */
  authenticate(authorization: string | undefined, proof: string | undefined, method: string, url: string): AuthPrincipal {
    const match = /^DPoP\s+([A-Za-z0-9_-]{43})$/.exec(authorization ?? '');
    if (!match?.[1]) throw new AuthError('unauthenticated', 'Credencial ausente.');
    const token = match[1];
    const row = this.db.prepare('SELECT device_id AS deviceId, kind, expires_at AS expiresAt, revoked_at AS revokedAt FROM core_tokens WHERE token_hash = ?').get(sha256(token)) as { deviceId: string; kind: string; expiresAt: string; revokedAt: string | null } | undefined;
    if (!row || row.kind !== 'access') throw new AuthError('unauthenticated', 'Token inválido.');
    const device = this.device(row.deviceId);
    if (!device || device.revokedAt) throw new AuthError('device_revoked', 'Aparelho revogado.');
    if (row.revokedAt) throw new AuthError('unauthenticated', 'Token revogado.');
    if (row.expiresAt < iso(this.now())) throw new AuthError('token_expired', 'Token expirado.');
    this.verifyProof(proof, method, url, token, device.key);
    this.db.prepare('UPDATE core_devices SET last_seen_at = ? WHERE id = ?').run(iso(this.now()), device.id);
    return { kind: 'device', id: device.id, label: device.name, grant: device.grant, deviceId: device.id };
  }

  devices(): Array<{ id: string; name: string; platform: string; appVersion: string; grant: Grant; pairedAt: string; lastSeenAt: string | null; revokedAt: string | null }> {
    return (this.db.prepare('SELECT id, name, platform, app_version AS appVersion, grant_json AS grantJson, paired_at AS pairedAt, last_seen_at AS lastSeenAt, revoked_at AS revokedAt FROM core_devices ORDER BY paired_at DESC').all() as Array<{ id: string; name: string; platform: string; appVersion: string; grantJson: string; pairedAt: string; lastSeenAt: string | null; revokedAt: string | null }>)
      .map(({ grantJson, ...row }) => ({ ...row, grant: grantSchema.parse(JSON.parse(grantJson)) }));
  }

  /** Revokes at once: every token of the device stops working and its open streams are closed. */
  revoke(target: { target: 'device'; deviceId: string } | { target: 'all' }): { revoked: string[]; closedConnections: number } {
    const ids = target.target === 'all'
      ? (this.db.prepare('SELECT id FROM core_devices WHERE revoked_at IS NULL').all() as Array<{ id: string }>).map((row) => row.id)
      : [target.deviceId];
    if (target.target === 'device' && !this.db.prepare('SELECT 1 FROM core_devices WHERE id = ?').get(target.deviceId)) throw new AuthError('not_found', 'Aparelho não encontrado.');
    const at = iso(this.now());
    for (const id of ids) {
      this.db.prepare('UPDATE core_devices SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?').run(at, id);
      this.db.prepare('UPDATE core_tokens SET revoked_at = COALESCE(revoked_at, ?) WHERE device_id = ?').run(at, id);
      this.audit('device.revoked', { kind: 'desktop', id: 'desktop', label: null }, `device:${id}`, 'ok');
    }
    return { revoked: ids, closedConnections: this.options.onRevoked?.(ids) ?? 0 };
  }
}
