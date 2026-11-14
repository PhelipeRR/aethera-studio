import { failureKindOf } from './recovery-policy.js';

export const AGENT_AVAILABILITY = ['AVAILABLE', 'RATE_LIMITED', 'QUOTA_EXHAUSTED', 'AUTH_REQUIRED', 'UNAVAILABLE', 'UNKNOWN'] as const;
export type AgentAvailability = (typeof AGENT_AVAILABILITY)[number];

/** What a failure says about the agent itself; null when it says nothing, as with a task's own error. */
export function availabilityFromFailure(message: string): AgentAvailability | null {
  switch (failureKindOf(message)) {
    case 'rate_limit': return 'RATE_LIMITED';
    case 'usage_limit': return 'QUOTA_EXHAUSTED';
    case 'authentication': return 'AUTH_REQUIRED';
    case 'provider_overloaded': return 'UNAVAILABLE';
    default: return null;
  }
}

const UNIT_MS: Record<string, number> = { second: 1_000, sec: 1_000, s: 1_000, minute: 60_000, min: 60_000, m: 60_000, hour: 3_600_000, h: 3_600_000 };

/** When the provider said it recovers. Null unless it did: a guessed time is worse than none. */
export function retryAtFrom(message: string, now = Date.now()): string | null {
  const header = /retry-after:\s*(\d+)/i.exec(message);
  if (header) return new Date(now + Number(header[1]) * 1_000).toISOString();
  const relative = /(?:try again|retry) in (\d+)\s*(seconds?|secs?|s|minutes?|mins?|m|hours?|h)\b/i.exec(message);
  if (relative) {
    const unit = (relative[2] ?? '').toLowerCase().replace(/s$/, '') || 's';
    return new Date(now + Number(relative[1]) * (UNIT_MS[unit] ?? 1_000)).toISOString();
  }
  const absolute = /resets? (?:at|on) (\d{4}-\d{2}-\d{2}T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))/i.exec(message);
  if (absolute) {
    const time = Date.parse(absolute[1] ?? '');
    if (!Number.isNaN(time)) return new Date(time).toISOString();
  }
  return null;
}
