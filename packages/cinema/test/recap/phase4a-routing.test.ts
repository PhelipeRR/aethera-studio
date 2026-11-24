import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createRoutedRecapVisionAdapter,
  type RecapVisionRouterPort,
  type StructuredVisionPayload,
} from '../../src/recap/recap-vision-adapter.js';
import { RecapUsageTelemetry } from '../../src/recap/phase5/recap-usage-telemetry.js';

const roots: string[] = [];

function payload(): StructuredVisionPayload {
  return {
    nature: 'dialogue',
    natureConfidence: 0.95,
    description: 'Fixture panel with a dialogue exchange.',
    frames: [{ atMs: 0, observed: 'Two characters are visible.', visibleText: [{ text: 'Olá', region: 'center' }] }],
    entities: [{ name: 'A', type: 'person', basis: 'observed', evidence: 'Visible in the panel.', confidence: 0.9 }],
    actions: [{ description: 'conversa', basis: 'observed', confidence: 0.9 }],
    environment: { description: 'sala', basis: 'observed', confidence: 0.9 },
    overlays: { burnedText: false, burnedTextRegion: null, watermark: false, webcam: false },
    limitations: [],
    confidence: 0.95,
  };
}

function fixtureRouter(calls: Array<{ chain: readonly string[]; version: string }>): RecapVisionRouterPort {
  return {
    async describe() {
      return { value: { description: 'fixture', tags: [] }, provider: 'local-vlm', model: 'qwen2.5vl:3b', costUsd: 0, attempts: [] };
    },
    async analyze(input) {
      calls.push({ chain: input.policy.chain, version: input.policy.version });
      return {
        value: payload(),
        provider: input.policy.chain[0] ?? null,
        model: `${input.policy.chain[0] ?? 'unknown'}-fixture`,
        costUsd: 0,
        attempts: [{ provider: input.policy.chain[0] ?? 'unknown', outcome: 'ok', durationMs: 1 }],
        usage: { inputTokens: 10, outputTokens: 8, cachedTokens: null, effectiveApiCostUsd: null, estimatedCostUsd: null, quotaUnits: null, quotaKind: null },
      };
    },
  };
}

test('Recap adapter selects the configured local → economic → premium chain per triage tier', async () => {
  const root = mkdtempSync(join(tmpdir(), 'aethera-recap-phase4a-routing-'));
  roots.push(root);
  const imagePath = join(root, 'panel.png');
  writeFileSync(imagePath, 'fixture image bytes');
  const calls: Array<{ chain: readonly string[]; version: string }> = [];
  const adapter = createRoutedRecapVisionAdapter({
    root,
    router: fixtureRouter(calls),
    policyChain: ['local-vlm', 'codex', 'claude'],
    routeChains: {
      local: ['local-vlm', 'codex', 'claude'],
      economic: ['codex', 'claude'],
      premium: ['claude'],
    },
    policyVersion: 'recap-routing-4a-test',
    hostExecutor: 'remote_host',
  });

  for (const routeTier of ['local', 'economic', 'premium'] as const) {
    const result = await adapter.analyze(imagePath, {
      panelIndex: 0,
      totalPanels: 1,
      routeTier,
      routeReason: `fixture-${routeTier}`,
    });
    assert.equal(result.confidence, 0.95);
    assert.equal(result.usage?.inputTokens, 10);
    assert.equal(adapter.getLastTrace()?.policyVersion, 'recap-routing-4a-test');
    assert.equal(adapter.getLastTrace()?.hostExecutor, 'remote_host');
    assert.equal(adapter.getLastTrace()?.routeTier, routeTier);
  }

  assert.deepEqual(calls.map((call) => call.chain), [
    ['local-vlm', 'codex', 'claude'],
    ['codex', 'claude'],
    ['claude'],
  ]);
  // `version` remains the prompt/cache schema version for checkpoint compatibility;
  // the routing policy version is persisted separately in the adapter trace.
  // It is also the VisionRouter cache key's promptVersion, so a prompt change must not replay old answers.
  assert.deepEqual(calls.map((call) => call.version), ['recap-v2-identity-sfx', 'recap-v2-identity-sfx', 'recap-v2-identity-sfx']);
});

test('ledger persists fallback reason and each provider attempt without prompt or image data', () => {
  const root = mkdtempSync(join(tmpdir(), 'aethera-recap-phase4a-ledger-'));
  roots.push(root);
  const telemetry = new RecapUsageTelemetry({ workspaceDir: root, runId: 'run-4a', jobId: 'job-4a', chapterId: 'chapter-4a' });
  telemetry.record({
    stage: 'vision',
    operation: 'panel_analysis',
    unitId: 'panel-1',
    cacheStatus: 'miss',
    status: 'completed',
    attempt: 1,
    provider: 'codex',
    model: 'fixture-model',
    policyVersion: 'recap-routing-4a-v1',
    routeTier: 'economic',
    routeReason: 'fixture-economical',
    fallbackReason: 'local-vlm unavailable: fixture offline',
    hostExecutor: 'remote_host',
    providerAttempts: 2,
    providerAttemptDetails: [
      { provider: 'local-vlm', outcome: 'unavailable', detail: 'fixture offline', durationMs: 2 },
      { provider: 'codex', outcome: 'ok', durationMs: 4 },
    ],
    inputTokens: 10,
    outputTokens: 5,
    effectiveApiCostUsd: null,
    estimatedCostUsd: null,
  });
  const event = telemetry.getEvents()[0];
  assert.equal(event?.jobId, 'job-4a');
  assert.equal(event?.fallbackReason, 'local-vlm unavailable: fixture offline');
  assert.equal(event?.providerAttemptDetails?.length, 2);
  assert.equal(telemetry.summary().modelCalls, 2);
  assert.equal(telemetry.summary().effectiveApiCostUsd, null);
  assert.equal(telemetry.summary().estimatedCostUsd, null);
});

test.after(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
