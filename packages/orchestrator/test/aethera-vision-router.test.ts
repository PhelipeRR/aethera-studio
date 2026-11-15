import { type VisionPolicy, type ConfidenceCalibration } from '@neuralbridge/shared';
import { describe, expect, it } from 'vitest';
import { VisionRouter as Router, type VisionCachePort, type VisualAnalysisProvider, type VisionSpendPort } from '../src/aethera/vision-router.js';
import { VisualWorkScheduler } from '../src/aethera/visual-work-scheduler.js';

// Explicit synthetic calibration fixture; production routers without a matching profile always use review.
class VisionRouter extends Router {
  constructor(providers: readonly VisualAnalysisProvider[], cache: VisionCachePort, spend?: VisionSpendPort, scheduler?: VisualWorkScheduler) {
    const profiles: ConfidenceCalibration[] = providers.map((provider) => ({ schemaVersion: 1, provider: provider.id, model: provider.model, promptVersion: 'v1', label: 'combat', datasetVersion: 'synthetic-router-v1', synthetic: true, sampleIds: ['synthetic-calibration'], points: [0, 0.5, 0.55, 0.6, 0.7, 0.9, 0.93, 0.95, 0.99, 1].map((raw) => ({ raw, probability: raw })), thresholds: { autoAt: 0.9, reviewAt: 0.5 } }));
    super(providers, cache, profiles, spend, scheduler);
  }
}

const frames = [{ hash: 'f1', path: 'frames/1.jpg' }, { hash: 'f2', path: 'frames/2.jpg' }];
const policy = (overrides: Partial<VisionPolicy> = {}): VisionPolicy => ({ schemaVersion: 1, task: 'classify', chain: ['local', 'remote'], budgetUsd: 1, maxLatencyMs: 60_000, scope: 'project', thresholds: { autoAt: 0.9, reviewAt: 0.5 }, version: 'v1', ...overrides });

function memoryCache(): VisionCachePort & { size(): number } {
  const map = new Map<string, unknown>();
  return { get: (key) => map.get(JSON.stringify(key)) ?? null, put: (key, value) => { map.set(JSON.stringify(key), value); }, size: () => map.size };
}
function provider(id: string, confidence: number, options: { available?: boolean; costPerImageUsd?: number; calls?: string[]; fail?: boolean } = {}): VisualAnalysisProvider {
  return {
    id, model: `${id}-model`, capabilities: ['classify'], limits: { maxImagesPerCall: 4, ...(options.costPerImageUsd ? { costPerImageUsd: options.costPerImageUsd } : {}) },
    detect: async () => (options.available === false ? { available: false, reason: 'não instalado' } : { available: true }),
    classify: async () => { options.calls?.push(id); if (options.fail) throw new Error('provider caiu'); return { kind: 'combat', confidence }; },
  };
}

describe('VisionRouter', () => {
  it('stops at the first provider whose confidence reaches the automatic band', async () => {
    const calls: string[] = [];
    const router = new VisionRouter([provider('local', 0.95, { calls }), provider('remote', 0.99, { calls })], memoryCache());
    const result = await router.classify({ frames, labels: ['combat', 'exploration'], policy: policy() });
    expect(result).toMatchObject({ provider: 'local', kind: 'combat', band: 'automatic' });
    expect(calls).toEqual(['local']);
  });

  it('falls back to the next provider before sending a low-confidence result to review', async () => {
    const router = new VisionRouter([provider('local', 0.6), provider('remote', 0.93)], memoryCache());
    const result = await router.classify({ frames, labels: ['combat'], policy: policy() });
    expect(result).toMatchObject({ provider: 'remote', band: 'automatic' });
    expect(result.attempts.map((attempt) => [attempt.provider, attempt.outcome])).toEqual([['local', 'low_confidence'], ['remote', 'ok']]);
  });

  it('keeps the best result in review when no provider reaches the automatic band', async () => {
    const router = new VisionRouter([provider('local', 0.7), provider('remote', 0.55)], memoryCache());
    expect(await router.classify({ frames, labels: ['combat'], policy: policy() })).toMatchObject({ provider: 'local', confidence: 0.7, band: 'review' });
  });

  it('skips unavailable, failing and over-budget providers and says why', async () => {
    const router = new VisionRouter([provider('local', 0.95, { available: false }), provider('remote', 0.95, { costPerImageUsd: 1 }), provider('flaky', 0.95, { fail: true })], memoryCache());
    const result = await router.classify({ frames, labels: ['combat'], policy: policy({ chain: ['local', 'remote', 'flaky', 'missing'], budgetUsd: 1 }) });
    expect(result).toMatchObject({ provider: null, kind: 'unknown', confidence: 0, band: 'review' });
    expect(result.attempts.map((attempt) => attempt.outcome)).toEqual(['unavailable', 'over_budget', 'error', 'unavailable']);
  });

  it('charges paid providers against the policy budget and reuses the cache without paying twice', async () => {
    const calls: string[] = [];
    const cache = memoryCache();
    const router = new VisionRouter([provider('remote', 0.95, { costPerImageUsd: 0.1, calls })], cache);
    const first = await router.classify({ frames, labels: ['combat'], policy: policy({ chain: ['remote'] }) });
    const second = await router.classify({ frames, labels: ['combat'], policy: policy({ chain: ['remote'] }) });
    expect(first.costUsd).toBeCloseTo(0.2);
    expect(second).toMatchObject({ costUsd: 0, band: 'automatic' });
    expect(second.attempts[0]?.outcome).toBe('cached');
    expect(calls).toEqual(['remote']);
    await router.classify({ frames, labels: ['combat'], policy: policy({ chain: ['remote'], version: 'v2' }) });
    expect(calls).toEqual(['remote', 'remote']);
  });

  it('sends everything to review while the policy is not calibrated', async () => {
    const router = new VisionRouter([provider('local', 0.99)], memoryCache());
    expect(await router.classify({ frames, labels: ['combat'], policy: policy({ chain: ['local'], thresholds: null }) })).toMatchObject({ band: 'review', provider: 'local' });
  });

  it('never lets a calibration profile weaken the policy thresholds', async () => {
    const router = new VisionRouter([provider('local', 0.9)], memoryCache());
    expect(await router.classify({ frames, labels: ['combat'], policy: policy({ chain: ['local'], thresholds: { autoAt: 0.99, reviewAt: 0.8 } }) })).toMatchObject({ band: 'review' });
  });

  it('does not charge a queued provider that never acquires the GPU lease', async () => {
    const scheduler = new VisualWorkScheduler();
    let release!: () => void;
    let started!: () => void;
    const running = new Promise<void>((resolve) => { started = resolve; });
    const lock = scheduler.run(async () => { started(); await new Promise<void>((resolve) => { release = resolve; }); });
    await running;
    const calls: string[] = [];
    const router = new VisionRouter([provider('remote', 0.95, { costPerImageUsd: 0.3, calls })], memoryCache(), undefined, scheduler);
    try {
      const result = await router.classify({ frames, labels: ['combat'], policy: policy({ chain: ['remote'], maxLatencyMs: 5 }) });
      expect(result.costUsd).toBe(0);
      expect(calls).toEqual([]);
    } finally { release(); await lock; }
  });

  it('persists spend across router recreation before allowing another paid call', async () => {
    const amounts = new Map<string, number>();
    const spend: VisionSpendPort = { get: (key) => amounts.get(key) ?? 0, add: (key, amount) => { const total = (amounts.get(key) ?? 0) + amount; amounts.set(key, total); return total; } };
    const first = new VisionRouter([provider('remote', 0.95, { costPerImageUsd: 0.6 })], memoryCache(), spend);
    const firstFrame = frames[0]; if (!firstFrame) throw new Error('test frame missing');
    await first.classify({ frames: [firstFrame], labels: ['combat'], policy: policy({ chain: ['remote'], budgetUsd: 1 }) });
    const calls: string[] = [];
    const second = new VisionRouter([provider('remote', 0.95, { costPerImageUsd: 0.6, calls })], memoryCache(), spend);
    const secondFrame = frames[1]; if (!secondFrame) throw new Error('test frame missing');
    const result = await second.classify({ frames: [secondFrame], labels: ['combat'], policy: policy({ chain: ['remote'], budgetUsd: 1 }) });
    expect(result.provider).toBeNull();
    expect(result.attempts.at(-1)?.outcome).toBe('over_budget');
    expect(calls).toEqual([]);
  });

  it('places quota-blocked providers on cooldown and reports health status without repeating calls', async () => {
    let codexCalls = 0;
    const codexQuotaProvider: VisualAnalysisProvider = {
      id: 'codex',
      model: 'gpt-5-codex',
      capabilities: ['describe'],
      limits: { maxImagesPerCall: 3 },
      detect: async () => ({ available: true }),
      describe: async () => {
        codexCalls += 1;
        throw new Error('ERROR: You’ve hit your usage limit. Try again later.');
      },
    };
    const claudeOk: VisualAnalysisProvider = {
      id: 'claude',
      model: 'sonnet',
      capabilities: ['describe'],
      limits: { maxImagesPerCall: 3 },
      detect: async () => ({ available: true }),
      describe: async () => ({ description: 'Anime scene verified', tags: ['anime'] }),
    };
    const cooldowns = new Map<string, { untilMs: number; reason: string }>();
    const router1 = new Router([codexQuotaProvider, claudeOk], memoryCache(), [], undefined, undefined, cooldowns);
    const res1 = await router1.describe({ frames: [frames[0]!], policy: policy({ chain: ['codex', 'claude'] }) });
    expect(res1.provider).toBe('claude');
    expect(codexCalls).toBe(1);

    const router2 = new Router([codexQuotaProvider, claudeOk], memoryCache(), [], undefined, undefined, cooldowns);
    const health = await router2.checkProvidersHealth(['codex', 'claude']);
    expect(health[0]?.available).toBe(false);
    expect(health[0]?.reason).toMatch(/quota_cooldown/);
    expect(health[1]?.available).toBe(true);

    const res2 = await router2.describe({ frames: [frames[1]!], policy: policy({ chain: ['codex', 'claude'] }) });
    expect(res2.provider).toBe('claude');
    expect(codexCalls).toBe(1);
  });

  it('places providers on short cooldown after two consecutive timeouts to keep fallback fast', async () => {
    let slowCalls = 0;
    const slowProvider: VisualAnalysisProvider = {
      id: 'claude-gateway',
      model: 'claude-opus-5-5',
      capabilities: ['describe'],
      limits: { maxImagesPerCall: 3 },
      detect: async () => ({ available: true }),
      describe: async ({ signal }) => {
        slowCalls += 1;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        });
      },
    };
    const fastFallback: VisualAnalysisProvider = {
      id: 'antigravity',
      model: 'antigravity-default',
      capabilities: ['describe'],
      limits: { maxImagesPerCall: 3 },
      detect: async () => ({ available: true }),
      describe: async () => ({ description: 'Cyberware gameplay', tags: ['cyberpunk'] }),
    };
    const cooldowns = new Map<string, { untilMs: number; reason: string }>();
    const router = new Router([slowProvider, fastFallback], memoryCache(), [], undefined, undefined, cooldowns);
    const p = policy({ chain: ['claude-gateway', 'antigravity'], maxLatencyMs: 15 });

    const r1 = await router.describe({ frames: [frames[0]!], policy: p });
    const r2 = await router.describe({ frames: [frames[1]!], policy: p });
    const r3 = await router.describe({ frames: [frames[0]!, frames[1]!], policy: p });

    expect(r1.provider).toBe('antigravity');
    expect(r2.provider).toBe('antigravity');
    expect(r3.provider).toBe('antigravity');
    expect(slowCalls).toBe(1);

    const telemetry = router.getProviderTelemetry();
    const gwStats = telemetry.find((t) => t.provider === 'claude-gateway');
    const agyStats = telemetry.find((t) => t.provider === 'antigravity');
    expect(gwStats?.timeouts).toBe(1);
    expect(agyStats?.successes).toBe(3);

    // Telemetry keeps antigravity ahead of timed-out claude-gateway
    const r4 = await router.describe({ frames: [frames[0]!], policy: policy({ chain: ['claude-gateway', 'antigravity'], maxLatencyMs: 15 }) });
    expect(r4.provider).toBe('antigravity');
    expect(slowCalls).toBe(1);
  });
});
