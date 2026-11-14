import { z } from 'zod';

/*
 * CORE-02: building blocks shared by every Singularity Core API v1 contract.
 * Contracts only: no server, transport or storage lives here (CORE-03+ implement them).
 */

/** The public API generation. A breaking change creates /api/v2 and runs beside v1 (see version.ts). */
export const CORE_API_VERSION = 'v1' as const;
export const CORE_API_PREFIX = `/api/${CORE_API_VERSION}` as const;

/** Same bounds as the internal IPC ids, so every existing task, project and memory id stays valid. */
export const resourceIdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'Use letters, digits, "-" or "_".');
export const isoTimestampSchema = z.iso.datetime({ offset: true });
export const correlationIdSchema = z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/);

/**
 * Idempotency key sent in the `Idempotency-Key` header on every state-changing request.
 * The same key with the same body returns the first result; the same key with another body is `idempotency_conflict`.
 */
export const idempotencyKeySchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/, 'Use a UUID or another opaque token without spaces.');
export const IDEMPOTENCY = {
  header: 'Idempotency-Key',
  /** How long the Core remembers a key and its stored result. */
  retentionMs: 24 * 60 * 60 * 1000,
  /** Body fingerprint: SHA-256 of canonicalJson(body), computed by the server. */
  fingerprint: 'sha256-canonical-json',
} as const;

/** Opaque, server-issued pagination cursor. Clients never build or parse it. */
export const cursorSchema = z.string().min(1).max(200);
export const pageQuerySchema = z.strictObject({ cursor: cursorSchema.optional(), limit: z.coerce.number().int().min(1).max(100).default(20) });
export function pageSchema<T extends z.ZodType>(item: T) {
  return z.strictObject({ items: z.array(item), nextCursor: cursorSchema.nullable() });
}

/** Who acted, as recorded in audit trails and events. Never a secret, never a token. */
export const PRINCIPAL_KINDS = ['desktop', 'device', 'orchestrator', 'agent', 'system'] as const;
export const principalSchema = z.strictObject({
  kind: z.enum(PRINCIPAL_KINDS),
  /** Device id, orchestrator system name, agent client name or "core". */
  id: z.string().min(1).max(128),
  label: z.string().max(120).nullable(),
});
export type Principal = z.infer<typeof principalSchema>;

/**
 * Stable JSON for fingerprints: object keys sorted, undefined dropped, no whitespace. The idempotency check hashes this,
 * so two clients serializing the same body differently still match.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('canonicalJson: non-finite number');
    if (typeof value === 'bigint' || typeof value === 'function' || typeof value === 'symbol') throw new TypeError(`canonicalJson: unsupported ${typeof value}`);
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : canonicalJson(item))).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(',')}}`;
}
