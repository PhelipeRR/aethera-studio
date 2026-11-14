import { z } from 'zod';
import { correlationIdSchema } from './common.js';

/*
 * CORE-02: one error envelope for HTTP, WebSocket and SSE. Codes are the contract; messages are for people and may
 * change. Messages and details never carry secrets, tokens, file contents or stack traces.
 */

export const CORE_ERROR_CODES = {
  invalid_request: { status: 400, retryable: false },
  unsupported_version: { status: 400, retryable: false },
  unauthenticated: { status: 401, retryable: false },
  token_expired: { status: 401, retryable: true },
  proof_invalid: { status: 401, retryable: false },
  device_revoked: { status: 401, retryable: false },
  forbidden: { status: 403, retryable: false },
  scope_required: { status: 403, retryable: false },
  local_confirmation_required: { status: 403, retryable: true },
  /** Also returned for resources the caller may not see, so ids cannot be probed (IDOR). */
  not_found: { status: 404, retryable: false },
  conflict: { status: 409, retryable: false },
  idempotency_conflict: { status: 409, retryable: false },
  invalid_transition: { status: 409, retryable: false },
  external_ref_conflict: { status: 409, retryable: false },
  pairing_expired: { status: 410, retryable: false },
  payload_too_large: { status: 413, retryable: false },
  idempotency_key_required: { status: 428, retryable: false },
  rate_limited: { status: 429, retryable: true },
  locked_out: { status: 429, retryable: true },
  internal: { status: 500, retryable: true },
  /** A capability the desktop provides (notifications, voice, secrets in S0) while no desktop is connected. */
  capability_unavailable: { status: 503, retryable: true },
  host_unavailable: { status: 503, retryable: true },
  semantic_unavailable: { status: 503, retryable: true },
} as const satisfies Record<string, { status: number; retryable: boolean }>;

export type CoreErrorCode = keyof typeof CORE_ERROR_CODES;
export const coreErrorCodeSchema = z.enum(Object.keys(CORE_ERROR_CODES) as [CoreErrorCode, ...CoreErrorCode[]]);

export const coreErrorSchema = z.strictObject({
  error: z.strictObject({
    code: coreErrorCodeSchema,
    message: z.string().min(1).max(500),
    retryable: z.boolean(),
    /** Present on 429/503: when trying again makes sense. */
    retryAfterMs: z.number().int().nonnegative().optional(),
    correlationId: correlationIdSchema.nullable(),
    /** Field errors for invalid_request; supported versions for unsupported_version; required scope for scope_required. */
    details: z
      .strictObject({
        fields: z.array(z.strictObject({ path: z.string().max(200), message: z.string().max(200) })).max(50).optional(),
        supportedVersions: z.array(z.string().max(20)).max(10).optional(),
        requiredScope: z.string().max(40).optional(),
        allowedTransitions: z.array(z.string().max(40)).max(20).optional(),
      })
      .optional(),
  }),
});
export type CoreError = z.infer<typeof coreErrorSchema>;

/** Builds a valid envelope with the code's own status semantics. */
export function coreError(code: CoreErrorCode, message: string, extra: Omit<CoreError['error'], 'code' | 'message' | 'retryable'> = { correlationId: null }): CoreError {
  return { error: { code, message, retryable: CORE_ERROR_CODES[code].retryable, ...extra } };
}

export function httpStatusOf(code: CoreErrorCode): number {
  return CORE_ERROR_CODES[code].status;
}
