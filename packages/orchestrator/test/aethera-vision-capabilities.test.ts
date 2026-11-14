import { describe, expect, it } from 'vitest';
import type { VisionPolicy } from '@neuralbridge/shared';
import { VisionRouter, type VisionCachePort, type VisualAnalysisProvider } from '../src/aethera/vision-router.js';
import { createVisionProviders, createTaskEngineVisionProvider } from '../src/aethera/vision-providers.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { StructuredReadOnlyInput } from '../src/engine.js';

const frames = [{ hash: 'a', path: 'a.jpg' }, { hash: 'b', path: 'b.jpg' }, { hash: 'c', path: 'c.jpg' }];
const policy: VisionPolicy = { schemaVersion: 1, task: 'classify', chain: ['synthetic'], scope: 'project', thresholds: null, version: 'v1', maxLatencyMs: 1_000, budgetUsd: 1 };
const cache = (): VisionCachePort => { const values = new Map<string, unknown>(); return { get: (key) => values.get(JSON.stringify(key)), put: (key, value) => { values.set(JSON.stringify(key), value); } }; };

describe('vision capabilities, batches and cache inputs (synthetic provider)', () => {
  it('routes Codex/Claude images only through the structured read-only TaskEngine seam', async () => {
    const root = mkdtempSync(join(tmpdir(), 'as05-agent-'));
    const path = join(root, 'synthetic.jpg'); writeFileSync(path, 'synthetic fixture; never sent externally');
    const requests: StructuredReadOnlyInput[] = [];
    const provider = createTaskEngineVisionProvider({ id: 'codex', model: 'fixture-model', root, projectId: 'fixture-project', enabled: true,
      taskEngine: { runStructuredReadOnly: async (input) => { requests.push(input); return { taskId: 'fixture-task', agent: 'codex', text: '', structured: { kind: 'combat', confidence: 0.7 }, sessionId: null, model: 'fixture-model' }; } },
    });
    expect(await provider.detect()).toEqual({ available: true });
    expect(await provider.classify?.({ frames: [{ hash: 'synthetic', path }], labels: ['combat'] })).toEqual({ kind: 'combat', confidence: 0.7 });
    expect(requests[0]).toMatchObject({ projectId: 'fixture-project', agent: 'codex', model: 'fixture-model', origin: 'neura', images: [{ path, mime: 'image/jpeg' }], outputSchema: { type: 'object', additionalProperties: false } });
    await expect(provider.classify?.({ frames: [{ hash: 'escape', path: join(root, '..', 'outside.jpg') }], labels: ['combat'] })).rejects.toThrow(/project|projeto|ENOENT/);
  });
  it('batches every frame, caches every capability, and invalidates on labels and text', async () => {
    const calls: string[] = [];
    const provider: VisualAnalysisProvider = { id: 'synthetic', model: 'v1', capabilities: ['classify', 'describe', 'embed_image', 'embed_text'], limits: { maxImagesPerCall: 2 }, detect: async () => ({ available: true }),
      classify: async ({ frames }) => { calls.push(`classify:${frames.length}`); return { kind: 'combat', confidence: 0.8 }; },
      describe: async ({ frames }) => { calls.push(`describe:${frames.length}`); return { description: 'Synthetic combat', tags: ['synthetic'] }; },
      embedImage: async ({ frames }) => { calls.push(`image:${frames.length}`); return frames.map(() => [1, 0]); },
      embedText: async ({ texts }) => { calls.push(`text:${texts.length}`); return texts.map(() => [0, 1]); },
    };
    const router = new VisionRouter([provider], cache());
    for (let repeat = 0; repeat < 2; repeat++) {
      expect(await router.classify({ frames, labels: ['combat'], policy })).toMatchObject({ kind: 'combat', band: 'review' });
      expect((await router.describe({ frames, policy })).value?.description).toContain('Synthetic');
      expect((await router.embedImage({ frames, policy })).value).toHaveLength(3);
      expect((await router.embedText({ texts: ['Synthetic combat'], policy })).value).toEqual([[0, 1]]);
    }
    expect(calls).toEqual(['classify:2', 'classify:1', 'describe:2', 'describe:1', 'image:2', 'image:1', 'text:1']);
    await router.classify({ frames, labels: ['combat', 'exploration'], policy });
    await router.embedText({ texts: ['changed'], policy });
    expect(calls.slice(-3)).toEqual(['classify:2', 'classify:1', 'text:1']);
  });

  it('rejects invalid provider output, enforces latency and propagates cancellation', async () => {
    const invalid: VisualAnalysisProvider = { id: 'synthetic', model: 'v1', capabilities: ['classify'], limits: { maxImagesPerCall: 2 }, detect: async () => ({ available: true }), classify: async () => ({ kind: 'combat', confidence: NaN }) };
    expect((await new VisionRouter([invalid], cache()).classify({ frames, labels: ['combat'], policy })).provider).toBeNull();
    const slow: VisualAnalysisProvider = { ...invalid, classify: ({ signal }) => new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(new Error('cancelled')), { once: true })) };
    expect((await new VisionRouter([slow], cache()).classify({ frames, labels: ['combat'], policy: { ...policy, maxLatencyMs: 10 } })).attempts[0]?.outcome).toBe('error');
    await expect(new VisionRouter([invalid], cache()).classify({ frames, labels: ['combat'], policy, signal: AbortSignal.abort() })).rejects.toThrow(/cancel/i);
  });

  it('exposes all planned identities truthfully and never claims heuristics embed or classify semantics', async () => {
    const providers = createVisionProviders();
    expect(providers.map((provider) => provider.id)).toEqual(['ffmpeg-heuristics', 'codex', 'claude', 'local-siglip', 'local-vlm', 'openai', 'gemini']);
    expect(providers[0]?.capabilities).toEqual(['describe']);
    for (const provider of providers.slice(1)) expect(await provider.detect()).toMatchObject({ available: false, reason: expect.any(String) });
  });
});
