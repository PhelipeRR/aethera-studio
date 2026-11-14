import { describe, expect, it } from 'vitest';
import { decideRecovery, backoffDelay, type RecoveryPolicyInput } from '../src/recovery-policy.js';

describe('recovery policy', () => {
  const base: RecoveryPolicyInput = { failure: 'rate_limit', attempt: 1, treeChanged: false, access: 'read-only', policy: { retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1000, maxTotalMs: 5000, jitter: 'full', on: ['rate_limit'] } } };
  it('retries transient failures with exponential jitter bounds', () => { expect(decideRecovery(base).action).toBe('retry'); expect(backoffDelay(2, 100, 1000, () => 0.5)).toBe(100); });
  it('asks for a decision before repeating an edited tree', () => { expect(decideRecovery({ ...base, access: 'edit', treeChanged: true }).action).toBe('decision'); });
  it('stops when failure is not allowed', () => { expect(decideRecovery({ ...base, failure: 'permission' }).action).toBe('stop'); });
});
