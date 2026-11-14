import { describe, expect, it } from 'vitest';
import { redactEvidence, evidenceSchema } from '../src/evidence.js';

describe('evidence contract', () => {
  it('redacts credential-shaped values before persistence', () => {
    expect(redactEvidence('token=super-secret-value api_key: abc123')).toContain('[REDACTED]');
    expect(redactEvidence('ordinary output')).toBe('ordinary output');
  });

  it('rejects unbounded or malformed evidence', () => {
    expect(evidenceSchema.safeParse({ id: '', taskId: 't' }).success).toBe(false);
  });
});
