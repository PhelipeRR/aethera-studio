/*
 * CORE-02: request limits. Rate limits are per principal (device, orchestrator, desktop) and, for pairing and token
 * requests, also per source address, with progressive lockout (AUTH.pairing.lockoutStepsMs). Over the limit the Core
 * answers 429 rate_limited with retryAfterMs. The desktop principal is exempt from rate limits (it is local and
 * trusted), never from validation or body limits.
 */

export const RATE_LIMIT_CLASSES = {
  pairing: { requests: 5, perMs: 60_000, scope: 'source' },
  token: { requests: 10, perMs: 60_000, scope: 'source' },
  read: { requests: 240, perMs: 60_000, scope: 'principal' },
  search: { requests: 60, perMs: 60_000, scope: 'principal' },
  write: { requests: 60, perMs: 60_000, scope: 'principal' },
  taskCreate: { requests: 20, perMs: 60_000, scope: 'principal' },
  command: { requests: 60, perMs: 60_000, scope: 'principal' },
  stream: { requests: 10, perMs: 60_000, scope: 'principal' },
} as const satisfies Record<string, { requests: number; perMs: number; scope: 'source' | 'principal' }>;
export type RateLimitClass = keyof typeof RATE_LIMIT_CLASSES;

export const BODY_LIMITS = {
  /** Default JSON body. */
  defaultBytes: 64 * 1024,
  /** Memory writes: content up to 100,000 characters (UTF-8 can take up to 4 bytes each) plus metadata. */
  memoryWriteBytes: 512 * 1024,
  /** Same as WS.maxMessageBytes. */
  wsMessageBytes: 64 * 1024,
} as const;

export const CONNECTION_LIMITS = {
  /** Open WebSocket + SSE connections per principal. */
  streamsPerPrincipal: 4,
  /** Concurrent HTTP requests per principal before 429. */
  inFlightPerPrincipal: 16,
} as const;
