import { afterEach, describe, expect, it, vi } from 'vitest';
import { GitAuthorizationService } from '../src/main/git-authorization';

const request = { repository: 'C:/repo', operation: 'branch-delete' as const, risk: 'destructive' as const, parameters: { name: 'feature' }, stateFingerprint: 'head:abc' };

describe('GitAuthorizationService', () => {
  afterEach(() => vi.useRealTimers());
  it('binds a single-use grant to repository, operation, parameters and state', () => {
    const service = new GitAuthorizationService();
    const grant = service.issue(request);
    service.consume(grant.token, request);
    expect(() => service.consume(grant.token, request)).toThrow(/authorization/);
    expect(service.audit().map((entry) => entry.outcome)).toEqual(['authorized', 'consumed', 'rejected']);
    expect(service.audit()[0]?.repository).toMatch(/^repo:/);
  });

  it('rejects a changed parameter or repository without exposing paths in the audit', () => {
    const service = new GitAuthorizationService();
    const grant = service.issue(request);
    expect(() => service.consume(grant.token, { ...request, parameters: { name: 'other' } })).toThrow(/authorization/);
    expect(service.audit().at(-1)?.repository).not.toContain('C:/repo');
  });

  it('expires grants and rejects concurrent reuse atomically', () => {
    vi.useFakeTimers();
    const service = new GitAuthorizationService(); const grant = service.issue(request, 1_000);
    service.consume(grant.token, request);
    expect(() => service.consume(grant.token, request)).toThrow(/authorization/);
    const next = service.issue(request, 1_000); vi.advanceTimersByTime(1_001);
    expect(() => service.consume(next.token, request)).toThrow(/expirada/);
    expect(service.audit().some((entry) => entry.outcome === 'expired')).toBe(true);
  });
});
