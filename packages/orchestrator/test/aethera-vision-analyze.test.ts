import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SegmentAnalysis, VisionPolicy } from '@neuralbridge/shared';
import { VisionRouter, type VisionCachePort, type VisualAnalysisProvider } from '../src/aethera/vision-router.js';
import { createTaskEngineVisionProvider } from '../src/aethera/vision-providers.js';
import { judgeNarrationRelevance } from '../src/aethera/visual-relevance.js';
import type { StructuredReadOnlyInput } from '../src/engine.js';

const analysis: SegmentAnalysis = {
  schemaVersion: 1, nature: 'exploration', natureConfidence: 0.8, description: 'Personagem caminha por um corredor estreito.',
  frames: [{ atMs: 2_000, observed: 'Personagem num corredor.', visibleText: [] }], entities: [], actions: [{ description: 'caminhar', basis: 'observed', confidence: 0.8 }],
  environment: { description: 'corredor de pedra', basis: 'observed', confidence: 0.8 }, overlays: { burnedText: false, watermark: false, webcam: false }, limitations: [], confidence: 0.8,
};
const policy: VisionPolicy = { schemaVersion: 1, task: 'describe', chain: ['claude', 'codex'], scope: 'project', thresholds: null, version: 'analyze-v1', maxLatencyMs: 5_000, budgetUsd: 1 };
const cache = (): VisionCachePort & { size: () => number } => { const values = new Map<string, unknown>(); return { get: (key) => values.get(JSON.stringify(key)), put: (key, value) => { values.set(JSON.stringify(key), value); }, size: () => values.size }; };
const first = { hash: 'h1', path: 'a.jpg', atMs: 2_000 };
const second = { hash: 'h2', path: 'b.jpg', atMs: 4_000 };
const frames = [first, second];

function analyzer(id: string, calls: string[], options: { fail?: boolean } = {}): VisualAnalysisProvider {
  return { id, model: `${id}-model`, capabilities: ['analyze'], limits: { maxImagesPerCall: 3 }, detect: async () => ({ available: true }),
    analyze: async ({ frames: sent }) => { calls.push(`${id}:${sent.map((frame) => frame.atMs).join(',')}`); if (options.fail) throw new Error('sem suporte a imagem'); return analysis; } };
}

describe('VisionRouter analyze (universal, multi-frame)', () => {
  it('sends every frame of a segment together with its timestamp, falls back from Claude to Codex and caches by frames', async () => {
    const calls: string[] = [];
    const store = cache();
    const router = new VisionRouter([analyzer('claude', calls, { fail: true }), analyzer('codex', calls)], store);
    const initial = await router.analyze({ frames, policy });
    expect(initial).toMatchObject({ provider: 'codex', value: { nature: 'exploration' } });
    expect(initial.attempts.map((attempt) => `${attempt.provider}:${attempt.outcome}`)).toEqual(['claude:error', 'codex:ok']);
    expect(calls).toEqual(['claude:2000,4000', 'codex:2000,4000']);
    const again = await router.analyze({ frames, policy });
    expect(again.attempts.at(-1)?.outcome).toBe('cached');
    expect(calls).toHaveLength(3); // Claude is retried (it failed), Codex answers from the cache
    await router.analyze({ frames: [first, { ...second, hash: 'changed' }], policy });
    expect(store.size()).toBe(2);
  });

  it('refuses to split one segment across calls and rejects malformed analyses', async () => {
    const calls: string[] = [];
    const router = new VisionRouter([analyzer('claude', calls)], cache());
    const many = Array.from({ length: 4 }, (_, index) => ({ hash: `f${index}`, path: `${index}.jpg`, atMs: index * 1_000 }));
    const result = await router.analyze({ frames: many, policy: { ...policy, chain: ['claude'] } });
    expect(result.value).toBeNull();
    expect(result.attempts[0]).toMatchObject({ outcome: 'error', detail: expect.stringMatching(/quadros/iu) });
    const broken: VisualAnalysisProvider = { ...analyzer('claude', calls), analyze: async () => ({ ...analysis, nature: 'combat' }) as never };
    expect((await new VisionRouter([broken], cache()).analyze({ frames, policy: { ...policy, chain: ['claude'] } })).value).toBeNull();
  });

  it('never caches an analysis with zero confidence (provider glitch, unreadable input), so the next run tries again', async () => {
    let calls = 0;
    const blind: VisualAnalysisProvider = { id: 'claude', model: 'm', capabilities: ['analyze'], limits: { maxImagesPerCall: 3 }, detect: async () => ({ available: true }),
      analyze: async () => { calls += 1; return { ...analysis, nature: 'unknown', natureConfidence: 0, confidence: 0, limitations: ['nenhuma imagem recebida'] }; } };
    const store = cache();
    const router = new VisionRouter([blind], store);
    expect((await router.analyze({ frames, policy: { ...policy, chain: ['claude'] } })).value).toMatchObject({ nature: 'unknown' });
    await router.analyze({ frames, policy: { ...policy, chain: ['claude'] } });
    expect(calls).toBe(2);
    expect(store.size()).toBe(0);
  });
});

describe('TaskEngine vision provider analyze', () => {
  it('asks a lean read-only run with every image, the timestamps and the universal schema, and keeps the reported model', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ap04-vision-'));
    const paths = ['f1.jpg', 'f2.jpg'].map((name) => { const path = join(root, name); writeFileSync(path, 'jpeg fixture'); return path; });
    const requests: StructuredReadOnlyInput[] = [];
    const provider = createTaskEngineVisionProvider({ id: 'claude', model: 'sonnet', root, projectId: 'p', enabled: true,
      taskEngine: { runStructuredReadOnly: async (input) => { requests.push(input); return { taskId: 't', agent: 'claude', text: '', structured: analysis, sessionId: null, model: 'claude-sonnet-reported' }; } } });
    const [pathA = '', pathB = ''] = paths;
    const value = await provider.analyze?.({ frames: [{ hash: 'a', path: pathA, atMs: 1_500 }, { hash: 'b', path: pathB, atMs: 6_000 }], context: 'trecho 0–8 s' });
    expect(value).toMatchObject({ nature: 'exploration' });
    expect(provider.lastReportedModel?.()).toBe('claude-sonnet-reported');
    expect(requests[0]).toMatchObject({ agent: 'claude', model: 'sonnet', images: [{ path: paths[0] }, { path: paths[1] }], lean: { systemPrompt: expect.stringMatching(/untrusted|não confiável/iu) } });
    expect(requests[0]?.prompt).toMatch(/1500 ms[\s\S]*6000 ms/u);
    expect(requests[0]?.prompt).toMatch(/observed|observado/iu);
    expect(JSON.stringify(requests[0]?.outputSchema)).toContain('"interface"');
  });
});

describe('narration relevance judge', () => {
  it('judges from the stored observation (text only) and applies the deterministic gate', async () => {
    const prompts: string[] = [];
    const result = await judgeNarrationRelevance({ narration: 'Em Silksong, repare nos corredores.', analysis,
      runStructured: async ({ prompt }) => { prompts.push(prompt); return { structured: { verdict: 'represents', matched: [{ aspect: 'corredores', evidence: 'corredor de pedra observado' }], missing: [], subjectOnly: false, confidence: 0.82 } }; } });
    expect(result.decision).toMatchObject({ decision: 'accept' });
    expect(prompts[0]).toMatch(/nome do assunto|subject name/iu);
    expect(prompts[0]).toContain('corredor de pedra');
    const failed = await judgeNarrationRelevance({ narration: 'x', analysis, runStructured: async () => ({ structured: { verdict: 'maybe' } }) });
    expect(failed.decision).toMatchObject({ decision: 'review' });
  });
});
