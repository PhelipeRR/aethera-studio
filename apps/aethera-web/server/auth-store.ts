import crypto from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  type CredentialVault,
  fingerprintSecret,
  generateOpaqueToken,
  hashPasswordArgon2id,
  redactSensitiveText,
  sha256Hex,
  verifyPasswordArgon2id,
} from './crypto-vault';

export interface AuthUserPublic {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member';
  createdAt: string;
  updatedAt: string;
}

export interface AuthSessionPublic {
  id: string;
  deviceLabel: string;
  ipAddress: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  isCurrent?: boolean;
}

export interface AuthSessionInternal extends AuthSessionPublic {
  userId: string;
  csrfToken: string;
}

export interface AuthAuditLogPublic {
  id: number;
  eventType: string;
  ipAddress: string;
  detail: string;
  createdAt: string;
}

export interface UserRemoteHostPublic {
  id: string;
  stableHostId: string;
  name: string;
  baseUrl: string;
  tokenFingerprint: string;
  hasCredential: boolean;
  isActive: boolean;
  autoConnect: boolean;
  lastStatus: 'unknown' | 'online' | 'offline' | 'revoked' | 'error';
  lastConnectedAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  revokedAt: string | null;
}

export interface UserRemoteHostWithSecret {
  computer: UserRemoteHostPublic;
  bearerToken: string;
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days persistent session
const SESSION_RENEWAL_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000; // renew sliding window if > 7 days elapsed
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000; // 30 min

export function parseDeviceLabel(userAgent: string): string {
  const ua = userAgent || '';
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const os = /Windows/i.test(ua)
    ? 'Windows'
    : /iPhone|iPad|iOS/i.test(ua)
      ? 'iOS'
      : /Android/i.test(ua)
        ? 'Android'
        : /Mac OS X/i.test(ua)
          ? 'macOS'
          : /Linux/i.test(ua)
            ? 'Linux'
            : 'Navegador';
  const browser = /Edg\//i.test(ua)
    ? 'Edge'
    : /Chrome\//i.test(ua)
      ? 'Chrome'
      : /Firefox\//i.test(ua)
        ? 'Firefox'
        : /Safari\//i.test(ua)
          ? 'Safari'
          : 'Web';
  return `${isMobile ? 'Celular' : 'Desktop'} • ${browser} (${os})`;
}

export class AuthStore {
  private readonly db: DatabaseSync;
  public readonly vault: CredentialVault;

  constructor(db: DatabaseSync, vault: CredentialVault) {
    this.db = db;
    this.vault = vault;
    this.initSchema();
  }

  private initSchema(): void {
    // Strictly additive, non-destructive tables preserving all existing Studio tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS auth_users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE COLLATE NOCASE,
        name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'admin',
        password_hash TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        disabled_at TEXT
      );

      CREATE TABLE IF NOT EXISTS auth_sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        csrf_token TEXT NOT NULL,
        device_label TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_seen_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_auth_sessions_token ON auth_sessions(token_hash);

      CREATE TABLE IF NOT EXISTS auth_password_resets (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS auth_audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        event_type TEXT NOT NULL,
        ip_address TEXT NOT NULL,
        user_agent TEXT NOT NULL,
        detail TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_auth_audit_user ON auth_audit_logs(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS user_remote_hosts (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        stable_host_id TEXT NOT NULL,
        name TEXT NOT NULL,
        base_url TEXT NOT NULL,
        encrypted_token TEXT NOT NULL,
        token_fingerprint TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        auto_connect INTEGER NOT NULL DEFAULT 1,
        last_status TEXT NOT NULL DEFAULT 'unknown',
        last_connected_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (user_id) REFERENCES auth_users(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_user_remote_hosts_user ON user_remote_hosts(user_id);
    `);
  }

  public countUsers(): number {
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM auth_users').get() as { cnt: number };
    return row.cnt;
  }

  public getUserById(id: string): AuthUserPublic | null {
    const row = this.db
      .prepare('SELECT id, email, name, role, created_at, updated_at, disabled_at FROM auth_users WHERE id = ?')
      .get(id) as
      | {
          id: string;
          email: string;
          name: string;
          role: 'admin' | 'member';
          created_at: string;
          updated_at: string;
          disabled_at: string | null;
        }
      | undefined;
    if (!row || row.disabled_at) return null;
    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public async createUser(input: {
    email: string;
    name: string;
    password: string;
    role: 'admin' | 'member';
  }): Promise<AuthUserPublic> {
    const cleanEmail = input.email.trim().toLowerCase();
    const cleanName = input.name.trim() || cleanEmail.split('@')[0];
    const now = new Date().toISOString();
    const id = `usr_${crypto.randomBytes(8).toString('hex')}`;
    const passwordHash = await hashPasswordArgon2id(input.password);

    this.db
      .prepare(
        `INSERT INTO auth_users (id, email, name, role, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, cleanEmail, cleanName, input.role, passwordHash, now, now);

    return {
      id,
      email: cleanEmail,
      name: cleanName,
      role: input.role,
      createdAt: now,
      updatedAt: now,
    };
  }

  public async verifyCredentials(email: string, password: string): Promise<AuthUserPublic | null> {
    const cleanEmail = email.trim().toLowerCase();
    const row = this.db
      .prepare(
        'SELECT id, email, name, role, password_hash, created_at, updated_at, disabled_at FROM auth_users WHERE email = ?',
      )
      .get(cleanEmail) as
      | {
          id: string;
          email: string;
          name: string;
          role: 'admin' | 'member';
          password_hash: string;
          created_at: string;
          updated_at: string;
          disabled_at: string | null;
        }
      | undefined;

    if (!row || row.disabled_at) {
      // Mitigate timing-based user enumeration with a dummy Argon2id check
      await verifyPasswordArgon2id(
        '$argon2id$v=19$m=16384,t=2,p=1$c29tZXNhbHR2YWx1ZTEyMw$invalidhashplaceholderfortiming',
        password,
      );
      return null;
    }

    const ok = await verifyPasswordArgon2id(row.password_hash, password);
    if (!ok) return null;

    return {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  public async updatePassword(userId: string, newPassword: string): Promise<void> {
    const hash = await hashPasswordArgon2id(newPassword);
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE auth_users SET password_hash = ?, updated_at = ? WHERE id = ?')
      .run(hash, now, userId);
  }

  // --- Sessions ---
  public createSession(input: {
    userId: string;
    ipAddress: string;
    userAgent: string;
  }): { rawToken: string; session: AuthSessionInternal; maxAgeSec: number } {
    const rawToken = generateOpaqueToken(32);
    const tokenHash = sha256Hex(rawToken);
    const csrfToken = generateOpaqueToken(24);
    const id = `ses_${crypto.randomBytes(8).toString('hex')}`;
    const nowMs = Date.now();
    const now = new Date(nowMs).toISOString();
    const expiresAt = new Date(nowMs + SESSION_TTL_MS).toISOString();
    const deviceLabel = parseDeviceLabel(input.userAgent);

    this.db
      .prepare(
        `INSERT INTO auth_sessions
         (id, user_id, token_hash, csrf_token, device_label, ip_address, user_agent, created_at, last_seen_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.userId, tokenHash, csrfToken, deviceLabel, input.ipAddress, input.userAgent.slice(0, 240), now, now, expiresAt);

    return {
      rawToken,
      maxAgeSec: Math.floor(SESSION_TTL_MS / 1000),
      session: {
        id,
        userId: input.userId,
        csrfToken,
        deviceLabel,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent.slice(0, 240),
        createdAt: now,
        lastSeenAt: now,
        expiresAt,
      },
    };
  }

  public validateSessionToken(rawToken: string): {
    user: AuthUserPublic;
    session: AuthSessionInternal;
    renewed: boolean;
  } | null {
    if (!rawToken || rawToken.length < 16) return null;
    const tokenHash = sha256Hex(rawToken);
    const row = this.db
      .prepare(
        `SELECT s.id, s.user_id, s.csrf_token, s.device_label, s.ip_address, s.user_agent,
                s.created_at, s.last_seen_at, s.expires_at, s.revoked_at,
                u.email, u.name, u.role, u.created_at as u_created_at, u.updated_at as u_updated_at, u.disabled_at
         FROM auth_sessions s
         JOIN auth_users u ON u.id = s.user_id
         WHERE s.token_hash = ?`,
      )
      .get(tokenHash) as
      | {
          id: string;
          user_id: string;
          csrf_token: string;
          device_label: string;
          ip_address: string;
          user_agent: string;
          created_at: string;
          last_seen_at: string;
          expires_at: string;
          revoked_at: string | null;
          email: string;
          name: string;
          role: 'admin' | 'member';
          u_created_at: string;
          u_updated_at: string;
          disabled_at: string | null;
        }
      | undefined;

    if (!row || row.revoked_at || row.disabled_at) return null;
    const nowMs = Date.now();
    const expiresMs = Date.parse(row.expires_at);
    if (Number.isNaN(expiresMs) || expiresMs <= nowMs) return null;

    let expiresAt = row.expires_at;
    let renewed = false;
    const lastSeenMs = Date.parse(row.last_seen_at);
    const nowIso = new Date(nowMs).toISOString();

    // Sliding controlled renewal if more than threshold has elapsed since last renewal/activity
    if (nowMs - lastSeenMs > 60_000) {
      if (expiresMs - nowMs < SESSION_TTL_MS - SESSION_RENEWAL_THRESHOLD_MS) {
        expiresAt = new Date(nowMs + SESSION_TTL_MS).toISOString();
        renewed = true;
      }
      this.db
        .prepare('UPDATE auth_sessions SET last_seen_at = ?, expires_at = ? WHERE id = ?')
        .run(nowIso, expiresAt, row.id);
    }

    return {
      renewed,
      user: {
        id: row.user_id,
        email: row.email,
        name: row.name,
        role: row.role,
        createdAt: row.u_created_at,
        updatedAt: row.u_updated_at,
      },
      session: {
        id: row.id,
        userId: row.user_id,
        csrfToken: row.csrf_token,
        deviceLabel: row.device_label,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        createdAt: row.created_at,
        lastSeenAt: nowIso,
        expiresAt,
      },
    };
  }

  public listSessionsForUser(userId: string, currentSessionId?: string): AuthSessionPublic[] {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(
        `SELECT id, device_label, ip_address, user_agent, created_at, last_seen_at, expires_at
         FROM auth_sessions
         WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
         ORDER BY last_seen_at DESC`,
      )
      .all(userId, now) as Array<{
      id: string;
      device_label: string;
      ip_address: string;
      user_agent: string;
      created_at: string;
      last_seen_at: string;
      expires_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      deviceLabel: r.device_label,
      ipAddress: r.ip_address,
      userAgent: r.user_agent,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      expiresAt: r.expires_at,
      isCurrent: r.id === currentSessionId,
    }));
  }

  public revokeSession(sessionId: string, userId: string): boolean {
    const now = new Date().toISOString();
    const res = this.db
      .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL')
      .run(now, sessionId, userId);
    return Number(res.changes) > 0;
  }

  public revokeAllSessionsForUser(userId: string, exceptSessionId?: string): number {
    const now = new Date().toISOString();
    if (exceptSessionId) {
      const res = this.db
        .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND id != ? AND revoked_at IS NULL')
        .run(now, userId, exceptSessionId);
      return Number(res.changes);
    }
    const res = this.db
      .prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL')
      .run(now, userId);
    return Number(res.changes);
  }

  // --- Password Reset (never returns raw reset token via HTTP response) ---
  public createPasswordResetByEmail(email: string): {
    created: boolean;
    userId?: string;
    rawCode?: string;
    expiresAt?: string;
  } {
    const cleanEmail = email.trim().toLowerCase();
    const userRow = this.db
      .prepare('SELECT id, disabled_at FROM auth_users WHERE email = ?')
      .get(cleanEmail) as { id: string; disabled_at: string | null } | undefined;
    if (!userRow || userRow.disabled_at) {
      return { created: false };
    }

    const rawCode = generateOpaqueToken(24);
    const tokenHash = sha256Hex(rawCode);
    const id = `rst_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date();
    const expiresAt = new Date(now.getTime() + PASSWORD_RESET_TTL_MS).toISOString();

    this.db
      .prepare(
        `INSERT INTO auth_password_resets (id, user_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, userRow.id, tokenHash, expiresAt, now.toISOString());

    return {
      created: true,
      userId: userRow.id,
      rawCode,
      expiresAt,
    };
  }

  public async consumePasswordReset(rawCode: string, newPassword: string): Promise<string | null> {
    if (!rawCode.trim()) return null;
    const tokenHash = sha256Hex(rawCode.trim());
    const nowIso = new Date().toISOString();
    const row = this.db
      .prepare(
        `SELECT id, user_id, expires_at, used_at
         FROM auth_password_resets
         WHERE token_hash = ?`,
      )
      .get(tokenHash) as
      | { id: string; user_id: string; expires_at: string; used_at: string | null }
      | undefined;

    if (!row || row.used_at || row.expires_at <= nowIso) {
      return null;
    }

    await this.updatePassword(row.user_id, newPassword);
    this.db.prepare('UPDATE auth_password_resets SET used_at = ? WHERE id = ?').run(nowIso, row.id);
    // Security best practice: revoke ALL active sessions on password reset
    this.revokeAllSessionsForUser(row.user_id);
    return row.user_id;
  }

  // --- Audit Logs ---
  public recordAudit(input: {
    userId?: string | null;
    eventType: string;
    ipAddress: string;
    userAgent?: string;
    detail: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO auth_audit_logs (user_id, event_type, ip_address, user_agent, detail, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.userId ?? null,
        input.eventType,
        input.ipAddress || 'unknown',
        (input.userAgent ?? '').slice(0, 200),
        redactSensitiveText(input.detail).slice(0, 400),
        new Date().toISOString(),
      );
  }

  public listAuditLogsForUser(userId: string, limit = 30): AuthAuditLogPublic[] {
    const rows = this.db
      .prepare(
        `SELECT id, event_type, ip_address, detail, created_at
         FROM auth_audit_logs
         WHERE user_id = ?
         ORDER BY id DESC
         LIMIT ?`,
      )
      .all(userId, limit) as Array<{
      id: number;
      event_type: string;
      ip_address: string;
      detail: string;
      created_at: string;
    }>;

    return rows.map((r) => ({
      id: r.id,
      eventType: r.event_type,
      ipAddress: r.ip_address,
      detail: r.detail,
      createdAt: r.created_at,
    }));
  }

  // --- User Remote Hosts (Encrypted with AES-256-GCM; NEVER returns raw token in public view) ---
  private mapComputerRow(row: {
    id: string;
    stable_host_id: string;
    name: string;
    base_url: string;
    encrypted_token: string;
    token_fingerprint: string;
    is_active: number;
    auto_connect: number;
    last_status: string;
    last_connected_at: string | null;
    last_error: string | null;
    created_at: string;
    updated_at: string;
    revoked_at: string | null;
  }): UserRemoteHostPublic {
    return {
      id: row.id,
      stableHostId: row.stable_host_id,
      name: row.name,
      baseUrl: row.base_url,
      tokenFingerprint: row.token_fingerprint,
      hasCredential: Boolean(row.encrypted_token) && !row.revoked_at,
      isActive: Boolean(row.is_active),
      autoConnect: Boolean(row.auto_connect),
      lastStatus: (row.revoked_at ? 'revoked' : row.last_status) as UserRemoteHostPublic['lastStatus'],
      lastConnectedAt: row.last_connected_at,
      lastError: row.last_error,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revokedAt: row.revoked_at,
    };
  }

  public listComputersForUser(userId: string): UserRemoteHostPublic[] {
    const rows = this.db
      .prepare(
        `SELECT id, stable_host_id, name, base_url, encrypted_token, token_fingerprint,
                is_active, auto_connect, last_status, last_connected_at, last_error,
                created_at, updated_at, revoked_at
         FROM user_remote_hosts
         WHERE user_id = ?
         ORDER BY is_active DESC, updated_at DESC`,
      )
      .all(userId) as Array<{
      id: string;
      stable_host_id: string;
      name: string;
      base_url: string;
      encrypted_token: string;
      token_fingerprint: string;
      is_active: number;
      auto_connect: number;
      last_status: string;
      last_connected_at: string | null;
      last_error: string | null;
      created_at: string;
      updated_at: string;
      revoked_at: string | null;
    }>;
    return rows.map((r) => this.mapComputerRow(r));
  }

  public createComputer(input: {
    userId: string;
    name: string;
    baseUrl: string;
    bearerToken: string;
    stableHostId?: string;
    autoConnect?: boolean;
    setActive?: boolean;
  }): UserRemoteHostPublic {
    const id = `pc_${crypto.randomBytes(6).toString('hex')}`;
    const stableHostId = input.stableHostId?.trim() || `host_${crypto.randomBytes(6).toString('hex')}`;
    const now = new Date().toISOString();
    const aad = `${input.userId}:${id}`;
    const encryptedToken = this.vault.encrypt(input.bearerToken.trim(), aad);
    const tokenFingerprint = fingerprintSecret(input.bearerToken.trim());
    const setActive = input.setActive ?? true;

    if (setActive) {
      this.db.prepare('UPDATE user_remote_hosts SET is_active = 0 WHERE user_id = ?').run(input.userId);
    }

    this.db
      .prepare(
        `INSERT INTO user_remote_hosts
         (id, user_id, stable_host_id, name, base_url, encrypted_token, token_fingerprint,
          is_active, auto_connect, last_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', ?, ?)`,
      )
      .run(
        id,
        input.userId,
        stableHostId,
        input.name.trim(),
        input.baseUrl,
        encryptedToken,
        tokenFingerprint,
        setActive ? 1 : 0,
        input.autoConnect === false ? 0 : 1,
        now,
        now,
      );

    return this.getComputerPublic(input.userId, id)!;
  }

  public getComputerPublic(userId: string, computerId: string): UserRemoteHostPublic | null {
    const row = this.db
      .prepare(
        `SELECT id, stable_host_id, name, base_url, encrypted_token, token_fingerprint,
                is_active, auto_connect, last_status, last_connected_at, last_error,
                created_at, updated_at, revoked_at
         FROM user_remote_hosts
         WHERE id = ? AND user_id = ?`,
      )
      .get(computerId, userId) as Parameters<AuthStore['mapComputerRow']>[0] | undefined;
    return row ? this.mapComputerRow(row) : null;
  }

  public getActiveComputerWithSecret(userId: string, computerId?: string): UserRemoteHostWithSecret | null {
    const row = (computerId
      ? this.db
          .prepare(
            `SELECT id, stable_host_id, name, base_url, encrypted_token, token_fingerprint,
                    is_active, auto_connect, last_status, last_connected_at, last_error,
                    created_at, updated_at, revoked_at
             FROM user_remote_hosts
             WHERE id = ? AND user_id = ?`,
          )
          .get(computerId, userId)
      : this.db
          .prepare(
            `SELECT id, stable_host_id, name, base_url, encrypted_token, token_fingerprint,
                    is_active, auto_connect, last_status, last_connected_at, last_error,
                    created_at, updated_at, revoked_at
             FROM user_remote_hosts
             WHERE user_id = ? AND is_active = 1
             LIMIT 1`,
          )
          .get(userId)) as Parameters<AuthStore['mapComputerRow']>[0] | undefined;

    if (!row || row.revoked_at || !row.encrypted_token) return null;
    const aad = `${userId}:${row.id}`;
    const bearerToken = this.vault.decrypt(row.encrypted_token, aad);
    return {
      computer: this.mapComputerRow(row),
      bearerToken,
    };
  }

  public updateComputer(
    userId: string,
    computerId: string,
    patch: {
      name?: string;
      baseUrl?: string;
      autoConnect?: boolean;
      isActive?: boolean;
      stableHostId?: string;
    },
  ): UserRemoteHostPublic | null {
    const existing = this.getComputerPublic(userId, computerId);
    if (!existing) return null;

    if (patch.isActive) {
      this.db.prepare('UPDATE user_remote_hosts SET is_active = 0 WHERE user_id = ?').run(userId);
    }

    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE user_remote_hosts
         SET name = ?, base_url = ?, auto_connect = ?, is_active = ?, stable_host_id = ?, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(
        patch.name !== undefined ? patch.name.trim() : existing.name,
        patch.baseUrl !== undefined ? patch.baseUrl : existing.baseUrl,
        patch.autoConnect !== undefined ? (patch.autoConnect ? 1 : 0) : existing.autoConnect ? 1 : 0,
        patch.isActive !== undefined ? (patch.isActive ? 1 : 0) : existing.isActive ? 1 : 0,
        patch.stableHostId !== undefined ? patch.stableHostId.trim() : existing.stableHostId,
        now,
        computerId,
        userId,
      );

    return this.getComputerPublic(userId, computerId);
  }

  public rotateComputerCredential(
    userId: string,
    computerId: string,
    newBearerToken: string,
    newBaseUrl?: string,
  ): UserRemoteHostPublic | null {
    const existing = this.getComputerPublic(userId, computerId);
    if (!existing) return null;

    const now = new Date().toISOString();
    const aad = `${userId}:${computerId}`;
    const encryptedToken = this.vault.encrypt(newBearerToken.trim(), aad);
    const tokenFingerprint = fingerprintSecret(newBearerToken.trim());

    this.db
      .prepare(
        `UPDATE user_remote_hosts
         SET encrypted_token = ?, token_fingerprint = ?, base_url = ?, revoked_at = NULL, last_status = 'unknown', last_error = NULL, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(encryptedToken, tokenFingerprint, newBaseUrl ?? existing.baseUrl, now, computerId, userId);

    return this.getComputerPublic(userId, computerId);
  }

  public revokeComputerCredential(userId: string, computerId: string): UserRemoteHostPublic | null {
    const existing = this.getComputerPublic(userId, computerId);
    if (!existing) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE user_remote_hosts
         SET encrypted_token = '', revoked_at = ?, last_status = 'revoked', is_active = 0, updated_at = ?
         WHERE id = ? AND user_id = ?`,
      )
      .run(now, now, computerId, userId);
    return this.getComputerPublic(userId, computerId);
  }

  public deleteComputer(userId: string, computerId: string): boolean {
    const res = this.db
      .prepare('DELETE FROM user_remote_hosts WHERE id = ? AND user_id = ?')
      .run(computerId, userId);
    return Number(res.changes) > 0;
  }

  public updateComputerConnectionTelemetry(
    userId: string,
    computerId: string,
    status: 'online' | 'offline' | 'error',
    opts: { stableHostId?: string; error?: string | null } = {},
  ): void {
    const now = new Date().toISOString();
    if (status === 'online') {
      this.db
        .prepare(
          `UPDATE user_remote_hosts
           SET last_status = 'online', last_connected_at = ?, last_error = NULL,
               stable_host_id = COALESCE(?, stable_host_id), updated_at = ?
           WHERE id = ? AND user_id = ?`,
        )
        .run(now, opts.stableHostId ?? null, now, computerId, userId);
    } else {
      this.db
        .prepare(
          `UPDATE user_remote_hosts
           SET last_status = ?, last_error = ?, updated_at = ?
           WHERE id = ? AND user_id = ?`,
        )
        .run(status, opts.error ? redactSensitiveText(opts.error).slice(0, 240) : null, now, computerId, userId);
    }
  }
}
