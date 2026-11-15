import { MediaProviderError, type MediaProviderKey } from './types.js';

export interface Clock {
  now: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms, signal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) {
        reject(abortReason(signal));
        return;
      }
      const timer = setTimeout(() => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      }, Math.max(0, ms));
      const onAbort = () => {
        clearTimeout(timer);
        reject(signal ? abortReason(signal) : new Error('aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    }),
};

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  if (reason instanceof Error) return reason;
  const err = new Error(typeof reason === 'string' ? reason : 'aborted');
  err.name = 'AbortError';
  return err;
}

/**
 * Sliding-window limiter: at most `requests` starts per `perMs` and `maxConcurrent` in flight.
 * Waiting honours the caller's AbortSignal so a cancelled job never stays queued.
 */
export class SlidingWindowRateLimiter {
  private readonly starts: number[] = [];
  private inFlight = 0;
  private chain: Promise<void> = Promise.resolve();
  /** Provider-imposed pause (Retry-After / reset header) that every caller respects. */
  private blockedUntil = 0;

  constructor(
    private readonly limits: { requests: number; perMs: number; maxConcurrent: number },
    private readonly clock: Clock = realClock,
  ) {}

  pauseUntil(epochMs: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, epochMs);
  }

  async run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const turn = this.chain.then(async () => {
      for (;;) {
        if (signal?.aborted) throw abortReason(signal);
        const now = this.clock.now();
        while (this.starts.length > 0 && now - (this.starts[0] ?? now) >= this.limits.perMs) this.starts.shift();
        if (now < this.blockedUntil) {
          await this.clock.sleep(this.blockedUntil - now, signal);
          continue;
        }
        if (this.starts.length < this.limits.requests && this.inFlight < this.limits.maxConcurrent) {
          this.starts.push(now);
          this.inFlight += 1;
          return;
        }
        const wait =
          this.starts.length >= this.limits.requests ? Math.max(1, this.limits.perMs - (now - (this.starts[0] ?? now))) : 20;
        await this.clock.sleep(wait, signal);
      }
    });
    this.chain = turn.catch(() => undefined);
    await turn;
    try {
      return await work();
    } finally {
      this.inFlight -= 1;
    }
  }
}

export type CircuitState = 'closed' | 'open' | 'half_open';

/** Opens after `failureThreshold` consecutive retryable failures; probes again after `cooldownMs`. */
export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private state: CircuitState = 'closed';

  constructor(
    private readonly options: { failureThreshold: number; cooldownMs: number },
    private readonly clock: Clock = realClock,
  ) {}

  current(): CircuitState {
    if (this.state === 'open' && this.clock.now() - this.openedAt >= this.options.cooldownMs) {
      this.state = 'half_open';
    }
    return this.state;
  }

  canPass(): boolean {
    return this.current() !== 'open';
  }

  remainingCooldownMs(): number {
    return this.state === 'open' ? Math.max(0, this.options.cooldownMs - (this.clock.now() - this.openedAt)) : 0;
  }

  recordSuccess(): void {
    this.failures = 0;
    this.state = 'closed';
  }

  recordFailure(): void {
    this.failures += 1;
    if (this.state === 'half_open' || this.failures >= this.options.failureThreshold) {
      this.state = 'open';
      this.openedAt = this.clock.now();
    }
  }
}

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  signal?: AbortSignal;
  onRetry?: (attempt: number, delayMs: number, error: MediaProviderError) => void;
}

/** Retries only errors flagged retryable; honours Retry-After when the provider sent one. */
export async function withRetry<T>(
  provider: MediaProviderKey,
  work: (attempt: number) => Promise<T>,
  options: RetryOptions,
  clock: Clock = realClock,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    if (options.signal?.aborted) {
      throw new MediaProviderError('cancelled', provider, 'consulta cancelada.', false);
    }
    try {
      return await work(attempt);
    } catch (error) {
      const err = toProviderError(provider, error, options.signal);
      if (!err.retryable || attempt >= options.maxAttempts) throw err;
      const backoff = Math.min(options.maxDelayMs, options.baseDelayMs * 2 ** (attempt - 1));
      const delayMs = err.retryAfterMs !== undefined ? Math.min(options.maxDelayMs, err.retryAfterMs) : backoff;
      options.onRetry?.(attempt, delayMs, err);
      try {
        await clock.sleep(delayMs, options.signal);
      } catch {
        throw new MediaProviderError('cancelled', provider, 'consulta cancelada durante espera de retry.', false);
      }
    }
  }
}

export function toProviderError(provider: MediaProviderKey, error: unknown, signal?: AbortSignal): MediaProviderError {
  if (error instanceof MediaProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  if (signal?.aborted) return new MediaProviderError('cancelled', provider, 'consulta cancelada.', false);
  if (name === 'TimeoutError' || /timed? ?out/i.test(message)) {
    return new MediaProviderError('timeout', provider, message, true);
  }
  if (name === 'AbortError') return new MediaProviderError('cancelled', provider, message, false);
  return new MediaProviderError('unavailable', provider, message, true);
}

/** Combines the caller's signal with a per-operation timeout. */
export function scopedSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(Math.max(1, timeoutMs));
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** Bounded TTL cache; providers such as Pixabay require caching identical requests for 24h. */
export class TtlCache<V> {
  private readonly entries = new Map<string, { value: V; expiresAt: number }>();

  constructor(
    private readonly maxEntries: number,
    private readonly clock: Pick<Clock, 'now'> = realClock,
  ) {}

  get(key: string): V | undefined {
    const hit = this.entries.get(key);
    if (!hit) return undefined;
    if (hit.expiresAt <= this.clock.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // refresh recency
    this.entries.delete(key);
    this.entries.set(key, hit);
    return hit.value;
  }

  set(key: string, value: V, ttlMs: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: this.clock.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

/** Parses Retry-After (seconds or HTTP date) into milliseconds. */
export function parseRetryAfterMs(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

/** Maps an HTTP status to a typed provider error (or null for 2xx). */
export function httpStatusError(
  provider: MediaProviderKey,
  status: number,
  headers: { get(name: string): string | null },
  detail = '',
): MediaProviderError | null {
  if (status >= 200 && status < 300) return null;
  const suffix = detail ? ` ${detail.slice(0, 160)}` : '';
  if (status === 401) return new MediaProviderError('auth_failed', provider, `HTTP 401 — credencial recusada.${suffix}`, false);
  if (status === 403) return new MediaProviderError('auth_failed', provider, `HTTP 403 — acesso negado.${suffix}`, false);
  if (status === 404) return new MediaProviderError('not_found', provider, `HTTP 404.${suffix}`, false);
  if (status === 429) {
    // Only Retry-After is unambiguous; reset headers differ per provider (epoch vs seconds) and are read by adapters.
    const retryAfterMs = parseRetryAfterMs(headers.get('retry-after'));
    return new MediaProviderError('rate_limited', provider, `HTTP 429 — limite de requisições atingido.${suffix}`, true, retryAfterMs);
  }
  if (status >= 500) return new MediaProviderError('unavailable', provider, `HTTP ${status} — serviço indisponível.${suffix}`, true);
  return new MediaProviderError('invalid_response', provider, `HTTP ${status}.${suffix}`, false);
}
