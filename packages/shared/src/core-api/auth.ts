import { z } from 'zod';
import { isoTimestampSchema, principalSchema, resourceIdSchema } from './common.js';

/*
 * CORE-02: authentication, authorization, device pairing and revocation (ADR CORE-01 §2.5, decision D-8).
 * Contracts only. The current desktop authentication (trusted IPC sender) does not change; these contracts are what
 * CORE-07 implements for remote clients. Transport (Tailscale `serve`) never authorizes anything by itself.
 */

/**
 * Scopes are per action. `elevated` scopes are never granted by default, must be ticked one by one when pairing and
 * may also require a local confirmation on the desktop. `local` scopes are never grantable to a remote principal.
 */
export const SCOPES = {
  read: { elevated: false, local: false, description: 'Ler tarefas, memórias, métricas e status' },
  chat: { elevated: false, local: false, description: 'Conversar com o Void' },
  'memory:write': { elevated: false, local: false, description: 'Criar e editar memórias (sempre como não verificadas)' },
  'task:create': { elevated: false, local: false, description: 'Criar tarefas somente leitura ou de edição em projetos com nível padrão' },
  'task:cancel': { elevated: false, local: false, description: 'Cancelar e pausar tarefas' },
  'task:approve': { elevated: true, local: false, description: 'Aprovar etapas que pedem aprovação humana' },
  'task:full-access': { elevated: true, local: false, description: 'Criar tarefas de edição em projetos com Acesso total ou comandos' },
  'index:manage': { elevated: false, local: false, description: 'Pedir reindexação de memórias e projetos' },
  'devices:manage': { elevated: true, local: true, description: 'Parear e revogar dispositivos (só no desktop)' },
} as const;
export type Scope = keyof typeof SCOPES;
export const SCOPE_IDS = Object.keys(SCOPES) as [Scope, ...Scope[]];
export const scopeSchema = z.enum(SCOPE_IDS);
export const DEFAULT_DEVICE_SCOPES: readonly Scope[] = ['read', 'chat'];

/** Which projects a grant reaches. Mirrors the MCP scope: private projects need an explicit opt-in. */
export const projectGrantSchema = z.strictObject({
  projects: z.union([z.literal('all'), z.array(resourceIdSchema).min(1).max(200)]),
  includePrivate: z.boolean(),
});
export type ProjectGrant = z.infer<typeof projectGrantSchema>;

export const grantSchema = z
  .strictObject({ scopes: z.array(scopeSchema).min(1).max(SCOPE_IDS.length), projects: projectGrantSchema })
  .refine((grant) => new Set(grant.scopes).size === grant.scopes.length, 'Duplicate scope')
  .refine((grant) => grant.scopes.includes('read'), 'Every grant includes read');
export type Grant = z.infer<typeof grantSchema>;

/** Scopes a remote principal (paired device, external orchestrator) can ever hold. */
export function remoteGrantable(scope: Scope): boolean {
  return !SCOPES[scope].local;
}

/** Authorization for one action on one project. Resource visibility errors must surface as not_found, not forbidden. */
export function authorize(grant: Grant, scope: Scope, project: { id: string | null; isPrivate: boolean } | null): 'allowed' | 'scope_required' | 'not_visible' {
  if (!grant.scopes.includes(scope)) return 'scope_required';
  if (!project || project.id === null) return 'allowed';
  if (project.isPrivate && !grant.projects.includePrivate) return 'not_visible';
  if (grant.projects.projects !== 'all' && !grant.projects.projects.includes(project.id)) return 'not_visible';
  return 'allowed';
}

// ── Device keys and proof of possession ─────────────────────────────────────────────────────────────────────────
/**
 * Device key: P-256 (ES256), generated in the phone's secure storage (Secure Enclave / StrongBox). Only the public
 * JWK leaves the device. Every request carries a DPoP-style proof (RFC 9449) signed by that key.
 */
export const devicePublicKeySchema = z.strictObject({
  kty: z.literal('EC'),
  crv: z.literal('P-256'),
  x: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  y: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type DevicePublicKey = z.infer<typeof devicePublicKeySchema>;

export const AUTH = {
  accessTokenTtlMs: 15 * 60 * 1000,
  refreshTokenTtlMs: 30 * 24 * 60 * 60 * 1000,
  /** A reused (already rotated) refresh token revokes the whole family: the device must pair again. */
  refreshRotation: 'rotate-on-use-with-reuse-detection',
  proofHeader: 'DPoP',
  proofMaxSkewMs: 60 * 1000,
  /** Proof ids remembered to reject replays, at least as long as the allowed skew. */
  proofReplayWindowMs: 5 * 60 * 1000,
  pairing: {
    codeTtlMs: 5 * 60 * 1000,
    codeAlphabet: '0123456789ABCDEFGHJKMNPQRSTVWXYZ',
    codeLength: 8,
    maxAttemptsPerCode: 5,
    /** Progressive lockout per source after failed claims: 1 min, 5 min, 15 min, then 1 h. */
    lockoutStepsMs: [60_000, 300_000, 900_000, 3_600_000],
  },
} as const;

/** Claims of the signed proof JWT (header typ "dpop+jwt", alg ES256, jwk = device public key). */
export const proofClaimsSchema = z.strictObject({
  /** Unique per request; replay inside proofReplayWindowMs is rejected. */
  jti: z.string().min(16).max(128),
  htm: z.enum(['GET', 'POST', 'PATCH', 'PUT', 'DELETE']),
  /** Request URL without query and fragment. */
  htu: z.url(),
  iat: z.number().int().positive(),
  /** base64url SHA-256 of the access token; absent only on the token endpoint. */
  ath: z.string().regex(/^[A-Za-z0-9_-]{43}$/).optional(),
});

// ── Pairing (desktop shows a QR, the phone claims it, the desktop confirms) ─────────────────────────────────────
export const pairingCodeSchema = z.string().length(AUTH.pairing.codeLength).regex(/^[0-9A-HJKMNP-TV-Z]+$/);

/**
 * Remote endpoints are private by construction: loopback (the desktop itself) or a Tailscale MagicDNS name served
 * with `tailscale serve`. Public hosts, LAN IPs and `tailscale funnel` are rejected by contract.
 */
export const privateEndpointSchema = z.url({ protocol: /^https$/ }).refine((value) => /\.ts\.net$/i.test(new URL(value).hostname), 'Only a Tailscale (tailnet) HTTPS name is allowed for remote access');
export const localEndpointSchema = z.url({ protocol: /^http$/ }).refine((value) => ['127.0.0.1', '[::1]', 'localhost'].includes(new URL(value).hostname), 'The Core only listens on loopback');

/** What the QR code holds. No secret beyond the one-time code, which is useless after confirmation or expiry. */
export const pairingOfferSchema = z.strictObject({
  v: z.literal(1),
  coreId: resourceIdSchema,
  endpoint: privateEndpointSchema,
  code: pairingCodeSchema,
  expiresAt: isoTimestampSchema,
  /** SHA-256 of the Core's identity key, shown on both screens so the user can compare. */
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
export type PairingOffer = z.infer<typeof pairingOfferSchema>;

/** Started on the desktop only (local principal with devices:manage). */
export const pairingStartRequestSchema = z.strictObject({ grant: grantSchema, deviceLabelHint: z.string().trim().max(60).optional() });

/** Sent by the phone with the code read from the QR. */
export const pairingClaimRequestSchema = z.strictObject({
  code: pairingCodeSchema,
  deviceName: z.string().trim().min(1).max(60),
  platform: z.enum(['ios', 'android']),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  publicKey: devicePublicKeySchema,
});
export const pairingClaimResponseSchema = z.strictObject({ pairingId: resourceIdSchema, status: z.literal('awaiting_confirmation'), pollAfterMs: z.number().int().min(500).max(10_000) });

/** The desktop asks "Parear o iPhone de Fulano?"; only then the device exists. */
export const pairingDecisionRequestSchema = z.strictObject({ pairingId: resourceIdSchema, decision: z.enum(['approve', 'reject']), grant: grantSchema.optional() });

export const PAIRING_STATES = ['offered', 'awaiting_confirmation', 'approved', 'rejected', 'expired', 'burned'] as const;
export const pairingStatusSchema = z.strictObject({ pairingId: resourceIdSchema, state: z.enum(PAIRING_STATES), deviceId: resourceIdSchema.nullable() });

// ── Tokens ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const tokenRequestSchema = z.discriminatedUnion('grantType', [
  z.strictObject({ grantType: z.literal('pairing'), pairingId: resourceIdSchema }),
  z.strictObject({ grantType: z.literal('refresh_token'), refreshToken: z.string().min(32).max(512) }),
]);
export const tokenResponseSchema = z.strictObject({
  tokenType: z.literal('DPoP'),
  accessToken: z.string().min(32).max(2048),
  expiresInMs: z.number().int().positive().max(AUTH.accessTokenTtlMs),
  refreshToken: z.string().min(32).max(512),
  refreshExpiresAt: isoTimestampSchema,
  deviceId: resourceIdSchema,
  grant: grantSchema,
});
export type TokenResponse = z.infer<typeof tokenResponseSchema>;

// ── Devices and revocation ───────────────────────────────────────────────────────────────────────────────────────
export const deviceSchema = z.strictObject({
  id: resourceIdSchema,
  name: z.string().max(60),
  platform: z.enum(['ios', 'android']),
  appVersion: z.string().max(20),
  grant: grantSchema,
  pairedAt: isoTimestampSchema,
  lastSeenAt: isoTimestampSchema.nullable(),
  revokedAt: isoTimestampSchema.nullable(),
});
export type Device = z.infer<typeof deviceSchema>;

/** Revoking invalidates every token of the device at once and closes its open WebSocket/SSE connections. */
export const revokeRequestSchema = z.discriminatedUnion('target', [
  z.strictObject({ target: z.literal('device'), deviceId: resourceIdSchema, reason: z.string().trim().max(200).optional() }),
  z.strictObject({ target: z.literal('all'), reason: z.string().trim().max(200).optional() }),
]);
export const revokeResponseSchema = z.strictObject({ revoked: z.array(resourceIdSchema), closedConnections: z.number().int().nonnegative() });

// ── Audit ───────────────────────────────────────────────────────────────────────────────────────────────────────
export const AUDIT_ACTIONS = ['pairing.started', 'pairing.claimed', 'pairing.approved', 'pairing.rejected', 'pairing.failed', 'token.issued', 'token.refreshed', 'token.reuse_detected', 'device.revoked', 'auth.denied', 'task.created', 'task.approved', 'task.rejected', 'task.cancelled', 'memory.written', 'index.requested'] as const;
export const auditEntrySchema = z.strictObject({
  id: resourceIdSchema,
  at: isoTimestampSchema,
  action: z.enum(AUDIT_ACTIONS),
  principal: principalSchema,
  /** Resource the action touched, e.g. "task:<id>"; null for auth events. */
  target: z.string().max(140).nullable(),
  outcome: z.enum(['ok', 'denied', 'error']),
  /** Never a token, code, key or body: only what explains the outcome. */
  detail: z.string().max(300).nullable(),
});
