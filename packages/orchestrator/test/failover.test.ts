import { describe, expect, it } from 'vitest';
import { canReadOnlyFailover, classifyAgentFailure } from '../src/failover.js';

describe('agent failover policy', () => {
  it.each([
    ['usage limit reached', 'usage_limit'],
    ['context window exceeded', 'context_limit'],
    ['not logged in', 'authentication'],
    ['spawn ENOENT', 'temporary'],
    ['Access denied', 'permission'],
    ['Claude Code falhou: API Error: 529 Overloaded. This is a server-side issue, usually temporary', 'temporary'],
    ['API Error: 500 Internal server error', 'temporary'],
  ])('classifies %s', (message, expected) => expect(classifyAgentFailure(message)).toBe(expected));
  it('allows only bounded read-only failover for agent-local availability failures', () => {
    expect(canReadOnlyFailover('usage_limit', 'claude', 'codex')).toBe(true);
    expect(canReadOnlyFailover('permission', 'claude', 'codex')).toBe(false);
    expect(canReadOnlyFailover('temporary', 'claude', 'claude')).toBe(false);
  });
});
