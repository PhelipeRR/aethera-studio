// Regression for Fase 4B.11 (run recap-1795538364251, panel 61 / panel-18):
// the production job failed in ~20 ms with "expected object, received undefined" (path []).
// Real chain: RecapPilotBudget restored a stale wall-time pause → local-vlm analyze threw
// RECAP_PILOT_BUDGET_EXCEEDED → the Recap adapter fell back to router.describe → local-vlm
// advertised `describe` without implementing it → `provider.describe?.()` resolved undefined →
// `description.parse(undefined)`. No Ollama /api/chat call is made by these tests.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VisionPolicy } from '@neuralbridge/shared';
import { VisionRouter, type VisionCachePort, type VisualAnalysisProvider } from '../src/aethera/vision-router.js';
import { createOllamaLocalVlmProvider } from '../src/aethera/vision-providers.js';
import { RecapPilotBudget } from '../src/aethera/recap-pilot-budget.js';

const cache = (): VisionCachePort => { const values = new Map<string, unknown>(); return { get: (key) => values.get(JSON.stringify(key)) ?? null, put: (key, value) => { values.set(JSON.stringify(key), value); } }; };
const recapPolicy = (task: 'describe'): VisionPolicy => ({ schemaVersion: 1, task, chain: ['local-vlm'], scope: 'recap' as VisionPolicy['scope'], thresholds: null, version: 'recap-routing-4a-v1', maxLatencyMs: 5_000, budgetUsd: 0 });

function stubOllama(chatCalls: { count: number }) {
  vi.stubGlobal('fetch', async (url: string | URL) => {
    const href = String(url);
    if (href.endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'qwen3.5:4b-q4_K_M' }] }), { status: 200 });
    if (href.endsWith('/api/show')) return new Response(JSON.stringify({ capabilities: ['completion', 'vision'] }), { status: 200 });
    chatCalls.count += 1;
    return new Response('unexpected inference in regression test', { status: 500 });
  });
}

function writeStalePauseLedger(ledgerPath: string, jobId: string, activeMs: number): void {
  const opened = Date.now() - 3 * 60 * 60_000;
  writeFileSync(ledgerPath, [
    { budgetVersion: 'recap-pilot-budget-v2', ts: new Date(opened).toISOString(), jobId, kind: 'budget', status: 'opened', startedAtMs: opened },
    { budgetVersion: 'recap-pilot-budget-v2', ts: new Date(opened + 1).toISOString(), jobId, kind: 'analysis', status: 'reserved', callId: 1, reservedInputTokens: 1_608, reservedOutputTokens: 560 },
    { budgetVersion: 'recap-pilot-budget-v2', ts: new Date(opened + 2).toISOString(), jobId, kind: 'analysis', status: 'settled', callId: 1, inputTokens: 1_608, outputTokens: 460, wallMs: activeMs, outcome: 'ok' },
    { budgetVersion: 'recap-pilot-budget-v2', ts: new Date().toISOString(), jobId, kind: 'budget', status: 'paused', reason: 'prazo de 1800000 ms excedido.' },
  ].map((event) => JSON.stringify(event)).join('\n') + '\n');
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('Fase 4B.11 panel 61 — origem do undefined', () => {
  it('describe em provider que anuncia sem implementar vira VISION_PROVIDER_CONTRACT, nunca erro de schema', async () => {
    const advertisesOnly: VisualAnalysisProvider = {
      id: 'local-vlm', model: 'qwen3.5:4b-q4_K_M', capabilities: ['describe', 'analyze'], limits: { maxImagesPerCall: 1 },
      detect: async () => ({ available: true, multimodal: true }),
    };
    const result = await new VisionRouter([advertisesOnly], cache()).describe({ frames: [{ hash: 'p61', path: 'p61.png', atMs: 0 }], policy: recapPolicy('describe') });
    expect(result.value).toBeNull();
    expect(result.attempts[0]?.detail).toMatch(/VISION_PROVIDER_CONTRACT: provider local-vlm advertises describe/);
    expect(result.attempts[0]?.detail).not.toMatch(/received undefined/);
  });

  it('local-vlm produtivo não anuncia describe: o fallback não chega ao Ollama nem ao Zod', async () => {
    const chatCalls = { count: 0 };
    stubOllama(chatCalls);
    const provider = createOllamaLocalVlmProvider({ baseUrl: 'http://ollama.test', model: 'qwen3.5:4b-q4_K_M', structuredOutput: true, maxImagesPerCall: 1 });
    expect(provider.capabilities).not.toContain('describe');
    const result = await new VisionRouter([provider], cache()).describe({ frames: [{ hash: 'p61', path: 'p61.png', atMs: 0 }], policy: recapPolicy('describe') });
    expect(result.value).toBeNull();
    expect(result.attempts[0]).toMatchObject({ provider: 'local-vlm', outcome: 'unavailable', detail: 'capability describe unavailable' });
    expect(chatCalls.count).toBe(0);
  });

  it('ledger com pausa calendário obsoleta: a retomada reavalia por tempo ativo e chega à inferência', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'panel61-'));
    try {
      const ledgerPath = join(directory, 'recap-1795538364251-tiling.jsonl');
      writeStalePauseLedger(ledgerPath, 'recap-1795538364251', 54_535);
      const budget = new RecapPilotBudget({ jobId: 'recap-1795538364251', ledgerPath, config: { maxPanels: 51, maxBlocks: 80, maxCalls: 100, maxOcrCalls: 15, maxCpuFallbacks: 2, maxInputTokens: 100_000, maxOutputTokens: 40_000, maxWallTimeMs: 30 * 60_000, maxVramMb: 6_500 } });
      expect(budget.state()).toMatchObject({ paused: false, calls: 1, wallTimeMs: 54_535 });
      const chatCalls = { count: 0 };
      stubOllama(chatCalls);
      const panelPath = join(directory, 'p61.png');
      writeFileSync(panelPath, Buffer.from('89504e470d0a1a0a', 'hex'));
      const provider = createOllamaLocalVlmProvider({ baseUrl: 'http://ollama.test', model: 'qwen3.5:4b-q4_K_M', structuredOutput: true, maxImagesPerCall: 1, budget });
      const router = new VisionRouter([provider], cache());
      await router.analyze({ frames: [{ hash: 'p61', path: panelPath, atMs: 0 }], policy: recapPolicy('describe') });
      // The stubbed chat endpoint is reached exactly once: the stale pause no longer blocks the call.
      expect(chatCalls.count).toBe(1);
      const events = readFileSync(ledgerPath, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
      expect(events.filter((event) => event['status'] === 'resumed')).toHaveLength(1);
      expect(events.filter((event) => event['status'] === 'settled')).toHaveLength(2);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
