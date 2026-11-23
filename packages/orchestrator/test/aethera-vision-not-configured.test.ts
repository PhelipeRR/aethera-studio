/**
 * A provider listed in the priority but never registered (e.g. Claude Gateway without URL/token)
 * must be reported as "not configured", not as a missing capability of a working provider.
 */
import { describe, expect, it } from 'vitest';
import type { VisionPolicy } from '@neuralbridge/shared';
import { VisionRouter, type VisionCachePort, type VisualAnalysisProvider } from '../src/aethera/vision-router.js';

const frames = [{ hash: 'a', path: 'a.jpg' }];
const policy: VisionPolicy = { schemaVersion: 1, task: 'describe', chain: ['claude-gateway', 'text-only'], scope: 'project', thresholds: null, version: 'v1', maxLatencyMs: 1_000, budgetUsd: 1 };
const cache = (): VisionCachePort => ({ get: () => undefined, put: () => undefined });
const textOnly: VisualAnalysisProvider = {
  id: 'text-only', model: 'm', capabilities: ['classify'], limits: { maxImagesPerCall: 1 },
  detect: async () => ({ available: true }),
};

describe('unregistered vision providers', () => {
  it('says the provider is not configured, with the reason the host supplied', async () => {
    const router = new VisionRouter({
      providers: [textOnly],
      cache: cache(),
      config: { priority: ['claude-gateway', 'text-only'], unregisteredReasons: { 'claude-gateway': 'Claude Gateway não configurado.' } },
    } as unknown as ConstructorParameters<typeof VisionRouter>[0]);
    const result = await router.describe({ frames, policy });
    expect(result.attempts).toContainEqual({ provider: 'claude-gateway', outcome: 'unavailable', detail: 'not_configured: Claude Gateway não configurado.' });
    // A registered provider that lacks the capability keeps the capability message.
    expect(result.attempts).toContainEqual({ provider: 'text-only', outcome: 'unavailable', detail: 'capability describe unavailable' });
    const health = await router.checkProvidersHealth(['claude-gateway']);
    expect(health[0]).toMatchObject({ provider: 'claude-gateway', available: false, reason: 'not_configured: Claude Gateway não configurado.' });
  });

  it('falls back to a generic not-configured reason', async () => {
    const router = new VisionRouter([textOnly], cache());
    const result = await router.describe({ frames, policy: { ...policy, chain: ['claude-gateway'] } });
    expect(result.attempts[0]?.detail).toMatch(/^not_configured: /);
  });
});
