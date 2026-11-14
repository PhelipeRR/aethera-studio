import { describe, expect, it } from 'vitest';
import {
  AUTH,
  DEFAULT_DEVICE_SCOPES,
  SCOPES,
  SCOPE_IDS,
  authorize,
  canonicalJson,
  contractCompatible,
  coreError,
  coreErrorSchema,
  CORE_ERROR_CODES,
  devicePublicKeySchema,
  grantSchema,
  httpStatusOf,
  idempotencyKeySchema,
  localEndpointSchema,
  pairingClaimRequestSchema,
  pairingCodeSchema,
  pairingOfferSchema,
  privateEndpointSchema,
  proofClaimsSchema,
  remoteGrantable,
  resourceIdSchema,
  revokeRequestSchema,
  tokenResponseSchema,
  type Grant,
} from '../src/core-api/index.js';

const key = { kty: 'EC', crv: 'P-256', x: 'f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU', y: 'x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0' };
const grant: Grant = { scopes: ['read', 'chat'], projects: { projects: 'all', includePrivate: false } };

describe('core-api common', () => {
  it('canonical JSON ignores key order and undefined, so the idempotency fingerprint is stable', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, undefined, 'x'], c: undefined } })).toBe('{"a":{"d":[1,null,"x"]},"b":1}');
    expect(canonicalJson({ a: 1, b: 2 })).toBe(canonicalJson({ b: 2, a: 1 }));
    expect(() => canonicalJson({ n: Number.NaN })).toThrow();
  });

  it('keeps every existing id format valid and rejects path-like ids', () => {
    for (const value of ['0b5f9c1e-6a3e-4a5c-9d2a-1f6c8e2b7a10', 'velix', 'task_01HX', 'a']) expect(resourceIdSchema.safeParse(value).success).toBe(true);
    for (const value of ['../x', 'a/b', '', 'x'.repeat(65), ' a']) expect(resourceIdSchema.safeParse(value).success).toBe(false);
  });

  it('requires opaque idempotency keys long enough not to collide by accident', () => {
    expect(idempotencyKeySchema.safeParse('0b5f9c1e-6a3e-4a5c-9d2a-1f6c8e2b7a10').success).toBe(true);
    expect(idempotencyKeySchema.safeParse('short').success).toBe(false);
    expect(idempotencyKeySchema.safeParse('has spaces in the key!!').success).toBe(false);
  });
});

describe('core-api errors and versions', () => {
  it('maps every code to an HTTP error status and builds valid envelopes', () => {
    for (const [code, meta] of Object.entries(CORE_ERROR_CODES)) {
      expect(meta.status).toBeGreaterThanOrEqual(400);
      expect(meta.status).toBeLessThan(600);
      expect(coreErrorSchema.safeParse(coreError(code as keyof typeof CORE_ERROR_CODES, 'mensagem')).success).toBe(true);
    }
    expect(httpStatusOf('not_found')).toBe(404);
    expect(coreError('rate_limited', 'Calma', { correlationId: null, retryAfterMs: 1000 }).error.retryable).toBe(true);
    expect(coreErrorSchema.safeParse({ error: { code: 'teapot', message: 'x', retryable: false, correlationId: null } }).success).toBe(false);
  });

  it('treats contract minors as compatible and majors as incompatible', () => {
    expect(contractCompatible('1.0.0', '1.3.0')).toBe('compatible');
    expect(contractCompatible('1.4.0', '1.3.0')).toBe('client-newer');
    expect(contractCompatible('2.0.0', '1.3.0')).toBe('incompatible');
    expect(contractCompatible('v1', '1.0.0')).toBe('incompatible');
  });
});

describe('core-api scopes and authorization', () => {
  it('keeps device management local and approval/full access elevated', () => {
    expect(remoteGrantable('devices:manage')).toBe(false);
    expect(SCOPE_IDS.filter((scope) => !remoteGrantable(scope))).toEqual(['devices:manage']);
    expect(SCOPES['task:approve'].elevated).toBe(true);
    expect(SCOPES['task:full-access'].elevated).toBe(true);
    expect(DEFAULT_DEVICE_SCOPES.every((scope) => !SCOPES[scope].elevated)).toBe(true);
  });

  it('requires read in every grant and rejects duplicates', () => {
    expect(grantSchema.safeParse(grant).success).toBe(true);
    expect(grantSchema.safeParse({ ...grant, scopes: ['chat'] }).success).toBe(false);
    expect(grantSchema.safeParse({ ...grant, scopes: ['read', 'read'] }).success).toBe(false);
    expect(grantSchema.safeParse({ ...grant, scopes: ['read', 'root'] }).success).toBe(false);
  });

  it('hides private and ungranted projects (not_found, never forbidden) and asks for missing scopes', () => {
    const limited: Grant = { scopes: ['read', 'task:create'], projects: { projects: ['p1'], includePrivate: false } };
    expect(authorize(limited, 'task:create', { id: 'p1', isPrivate: false })).toBe('allowed');
    expect(authorize(limited, 'task:create', { id: 'p2', isPrivate: false })).toBe('not_visible');
    expect(authorize(limited, 'task:create', { id: 'p1', isPrivate: true })).toBe('not_visible');
    expect(authorize(limited, 'task:approve', { id: 'p1', isPrivate: false })).toBe('scope_required');
    expect(authorize(limited, 'read', null)).toBe('allowed');
    expect(authorize({ ...limited, projects: { projects: 'all', includePrivate: true } }, 'read', { id: 'p9', isPrivate: true })).toBe('allowed');
  });
});

describe('core-api pairing, tokens and revocation', () => {
  it('accepts a tailnet HTTPS endpoint only, and the Core itself only on loopback', () => {
    expect(privateEndpointSchema.safeParse('https://desktop.tail1234.ts.net').success).toBe(true);
    for (const bad of ['http://desktop.tail1234.ts.net', 'https://example.com', 'https://192.168.0.10', 'https://ts.net.evil.com']) expect(privateEndpointSchema.safeParse(bad).success).toBe(false);
    expect(localEndpointSchema.safeParse('http://127.0.0.1:43123').success).toBe(true);
    expect(localEndpointSchema.safeParse('http://0.0.0.0:43123').success).toBe(false);
    expect(localEndpointSchema.safeParse('http://192.168.0.10:43123').success).toBe(false);
  });

  it('uses short one-time codes without ambiguous letters', () => {
    expect(AUTH.pairing.codeTtlMs).toBeLessThanOrEqual(5 * 60 * 1000);
    expect(AUTH.pairing.codeAlphabet).not.toMatch(/[ILOU]/);
    expect(pairingCodeSchema.safeParse('7K3M9QXZ').success).toBe(true);
    expect(pairingCodeSchema.safeParse('7K3M9QXO').success).toBe(false);
    expect(pairingCodeSchema.safeParse('7K3M9QX').success).toBe(false);
  });

  it('validates the QR offer and the claim with a P-256 public key only', () => {
    const offer = { v: 1, coreId: 'core-1', endpoint: 'https://desktop.tail1234.ts.net', code: '7K3M9QXZ', expiresAt: '2026-11-09T12:05:00.000Z', fingerprint: 'a'.repeat(64) };
    expect(pairingOfferSchema.safeParse(offer).success).toBe(true);
    expect(pairingOfferSchema.safeParse({ ...offer, token: 'secret' }).success).toBe(false);
    expect(devicePublicKeySchema.safeParse(key).success).toBe(true);
    expect(devicePublicKeySchema.safeParse({ ...key, d: 'private-part' }).success).toBe(false);
    expect(devicePublicKeySchema.safeParse({ ...key, crv: 'P-384' }).success).toBe(false);
    expect(pairingClaimRequestSchema.safeParse({ code: '7K3M9QXZ', deviceName: 'iPhone', platform: 'ios', appVersion: '0.1.0', publicKey: key }).success).toBe(true);
  });

  it('binds proofs to method, URL and token, and keeps access tokens short-lived', () => {
    expect(proofClaimsSchema.safeParse({ jti: 'b'.repeat(22), htm: 'POST', htu: 'https://desktop.tail1234.ts.net/api/v1/tasks', iat: 1_789_000_000, ath: 'c'.repeat(43) }).success).toBe(true);
    expect(proofClaimsSchema.safeParse({ jti: 'short', htm: 'POST', htu: 'https://x.ts.net/a', iat: 1 }).success).toBe(false);
    const response = { tokenType: 'DPoP', accessToken: 'a'.repeat(40), expiresInMs: AUTH.accessTokenTtlMs, refreshToken: 'r'.repeat(40), refreshExpiresAt: '2026-12-09T00:00:00.000Z', deviceId: 'dev-1', grant };
    expect(tokenResponseSchema.safeParse(response).success).toBe(true);
    expect(tokenResponseSchema.safeParse({ ...response, expiresInMs: AUTH.accessTokenTtlMs + 1 }).success).toBe(false);
    expect(tokenResponseSchema.safeParse({ ...response, tokenType: 'Bearer' }).success).toBe(false);
  });

  it('revokes one device or all of them', () => {
    expect(revokeRequestSchema.safeParse({ target: 'device', deviceId: 'dev-1' }).success).toBe(true);
    expect(revokeRequestSchema.safeParse({ target: 'all' }).success).toBe(true);
    expect(revokeRequestSchema.safeParse({ target: 'device' }).success).toBe(false);
  });
});
