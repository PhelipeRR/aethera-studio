import { describe, expect, it } from 'vitest';
import { canQueueCommand, retryDelayMs, shouldClearSession } from '../src/reconnect-policy';

describe('mobile reconnect policy', () => {
  it('backs off bounded read retries without creating an offline command queue', () => {
    expect(retryDelayMs(0)).toBe(500);
    expect(retryDelayMs(9)).toBe(16_000);
    expect(canQueueCommand('offline')).toBe(false);
  });

  it('clears local access after explicit Core revocation', () => {
    expect(shouldClearSession('revoked')).toBe(true);
    expect(shouldClearSession('offline')).toBe(false);
  });
});
