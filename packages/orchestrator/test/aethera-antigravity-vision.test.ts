import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { VisionPolicy } from '@neuralbridge/shared';
import {
  createAntigravityCliVisionProvider,
  createVisionProviders,
  VisionRouter,
  type VisionCooldownEntry,
} from '../src/index.js';
import { parseModelJson, stripMarkdownJsonFences } from '../src/aethera/vision-providers.js';

const tempDirs: string[] = [];
function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('Antigravity (AGY) VisionRouter Integration', () => {
  it('runs solo with antigravity-only for analyze, classify, describe, and ocr, recording durationMs and model', async () => {
    const dir = makeTempDir('agy-vision-solo-');
    const frame1 = join(dir, 'f1.png');
    const frame2 = join(dir, 'f2.png');
    writeFileSync(frame1, 'fake-png-1');
    writeFileSync(frame2, 'fake-png-2');

    const agy = createAntigravityCliVisionProvider({
      root: dir,
      model: 'gemini-2.5-pro',
      detect: async () => ({ available: true }),
      runPrompt: async ({ prompt }) => {
        if (prompt.includes('"texts"')) {
          return { ok: true, output: JSON.stringify({ texts: ['DBZ', ''] }), model: 'gemini-2.5-pro' };
        }
        if (prompt.includes('"tags"')) {
          return {
            ok: true,
            output: JSON.stringify({ description: 'Animação de luta Dragon Ball Z.', tags: ['anime', 'dbz'] }),
            model: 'gemini-2.5-pro',
          };
        }
        if (prompt.includes('"kind"')) {
          return { ok: true, output: JSON.stringify({ kind: 'action', confidence: 0.91 }), model: 'gemini-2.5-pro' };
        }
        return {
          ok: true,
          model: 'gemini-2.5-pro',
          output: [
            '```json',
            JSON.stringify({
              schemaVersion: 1,
              nature: 'action',
              natureConfidence: 0.92,
              frames: [
                { atMs: 1000, observed: 'Goku em pose de combate em Namek.', visibleText: [] },
                { atMs: 3000, observed: 'Explosão de aura dourada Super Saiyajin.', visibleText: [] },
              ],
              entities: [{ type: 'character', name: 'Goku', basis: 'observed', confidence: 0.9, evidence: 'Cabelo espetado e aura dourada' }],
              actions: [{ description: 'Transformação Super Saiyajin', basis: 'observed', confidence: 0.92 }],
              environment: { description: 'Planeta Namek devastado', basis: 'observed', confidence: 0.85 },
              overlays: { burnedText: false, watermark: false, webcam: false },
              description: 'Cena de anime Dragon Ball Z com Goku se transformando em Super Saiyajin.',
              confidence: 0.92,
              limitations: [],
            }),
            '```',
          ].join('\n'),
        };
      },
    });

    const cache = new Map<string, unknown>();
    const router = new VisionRouter(
      createVisionProviders([agy]),
      { get: (k) => cache.get(JSON.stringify(k)), put: (k, v) => cache.set(JSON.stringify(k), v) },
    );

    const policy: VisionPolicy = {
      schemaVersion: 1,
      task: 'describe',
      chain: ['local-vlm', 'antigravity', 'claude', 'codex', 'ffmpeg-heuristics'],
      scope: 'project',
      thresholds: null,
      version: 'agy-test-v1',
      budgetUsd: 0.25,
      maxLatencyMs: 15_000,
    };

    const analyzed = await router.analyze({
      frames: [
        { path: frame1, hash: 'h1', atMs: 1000 },
        { path: frame2, hash: 'h2', atMs: 3000 },
      ],
      context: 'Goku se transforma em Super Saiyajin',
      policy,
    });
    expect(analyzed.provider).toBe('antigravity');
    expect(analyzed.reportedModel).toBe('gemini-2.5-pro');
    expect(analyzed.durationMs).toBeTypeOf('number');
    expect(analyzed.value?.confidence).toBe(0.92);
    expect(analyzed.value?.frames).toHaveLength(2);
    expect(analyzed.attempts.some((a) => a.provider === 'local-vlm' && a.outcome === 'unavailable')).toBe(true);
    expect(analyzed.attempts.some((a) => a.provider === 'antigravity' && a.outcome === 'ok')).toBe(true);

    const described = await router.describe({
      frames: [{ path: frame1, hash: 'h1', atMs: 1000 }],
      policy,
    });
    expect(described.provider).toBe('antigravity');
    expect(described.value?.tags).toContain('dbz');

    const ocrRes = await router.ocr({
      frames: [
        { path: frame1, hash: 'h1' },
        { path: frame2, hash: 'h2' },
      ],
      policy,
    });
    expect(ocrRes.provider).toBe('antigravity');
    expect(ocrRes.value).toEqual(['DBZ', '']);
  });

  it('activates quota cooldown on antigravity and falls back cleanly without breaking the pipeline', async () => {
    const dir = makeTempDir('agy-vision-fallback-');
    const frame1 = join(dir, 'f1.png');
    writeFileSync(frame1, 'fake-png');

    const agyQuota = createAntigravityCliVisionProvider({
      root: dir,
      detect: async () => ({ available: true }),
      runPrompt: async () => ({ ok: false, output: '', error: '429 usage limit reached' }),
    });

    const claudeBackup = {
      id: 'claude',
      model: 'sonnet',
      capabilities: ['analyze', 'describe', 'classify', 'ocr'] as const,
      limits: { maxImagesPerCall: 3 },
      detect: async () => ({ available: true as const }),
      analyze: async () => ({
        schemaVersion: 1 as const,
        nature: 'action' as const,
        natureConfidence: 0.85,
        frames: [{ atMs: 500, observed: 'Vegeta lutando.', visibleText: [] }],
        entities: [{ type: 'character' as const, name: 'Vegeta', basis: 'observed' as const, confidence: 0.85, evidence: 'Armadura Saiyajin' }],
        actions: [{ description: 'Combate aéreo', basis: 'observed' as const, confidence: 0.85 }],
        environment: { description: 'Campo rochoso', basis: 'observed' as const, confidence: 0.8 },
        overlays: { burnedText: false, watermark: false, webcam: false },
        description: 'Anime Dragon Ball Z com Vegeta em combate.',
        confidence: 0.85,
        limitations: [],
      }),
    };

    const cooldowns = new Map<string, VisionCooldownEntry>();
    const cache = new Map<string, unknown>();
    const router = new VisionRouter(
      createVisionProviders([agyQuota, claudeBackup]),
      { get: (k) => cache.get(JSON.stringify(k)), put: (k, v) => cache.set(JSON.stringify(k), v) },
      [],
      undefined,
      undefined,
      cooldowns,
    );

    const res = await router.analyze({
      frames: [{ path: frame1, hash: 'h1', atMs: 500 }],
      policy: {
        schemaVersion: 1,
        task: 'describe',
        chain: ['local-vlm', 'antigravity', 'claude', 'codex', 'ffmpeg-heuristics'],
        scope: 'project',
        thresholds: null,
        version: 'agy-fallback-v1',
        budgetUsd: 0.25,
        maxLatencyMs: 15_000,
      },
    });

    expect(res.provider).toBe('claude');
    expect(cooldowns.has('antigravity')).toBe(true);
    expect(res.attempts.some((a) => a.provider === 'antigravity' && a.outcome === 'error')).toBe(true);
    expect(res.attempts.some((a) => a.provider === 'claude' && a.outcome === 'ok')).toBe(true);
  });

  it('rejects frames outside the authorized project root', async () => {
    const root = makeTempDir('agy-root-');
    const outside = makeTempDir('agy-outside-');
    const evilFrame = join(outside, 'secret.png');
    writeFileSync(evilFrame, 'nope');

    const agy = createAntigravityCliVisionProvider({
      root,
      detect: async () => ({ available: true }),
      runPrompt: async () => ({ ok: true, output: '{}' }),
    });
    const cache = new Map<string, unknown>();
    const router = new VisionRouter(createVisionProviders([agy]), {
      get: (k) => cache.get(JSON.stringify(k)),
      put: (k, v) => cache.set(JSON.stringify(k), v),
    });

    const res = await router.analyze({
      frames: [{ path: evilFrame, hash: 'h-evil', atMs: 0 }],
      policy: {
        schemaVersion: 1,
        task: 'describe',
        chain: ['antigravity'],
        scope: 'project',
        thresholds: null,
        version: 'agy-sec-v1',
        budgetUsd: 0.25,
        maxLatencyMs: 10_000,
      },
    });
    expect(res.value).toBeNull();
    expect(res.attempts[0]?.outcome).toBe('error');
    expect(res.attempts[0]?.detail).toContain('forbidden');
  });
});

describe('Model JSON fences (antigravity "Unrecognized token \'`\'" regression)', () => {
  it('parses JSON wrapped in a closed ```json fence', () => {
    expect(parseModelJson('```json\n{"nature":"reaction","confidence":0.8}\n```')).toEqual({ nature: 'reaction', confidence: 0.8 });
  });

  it('parses JSON after an unclosed opening fence (truncated answer)', () => {
    expect(stripMarkdownJsonFences('```json\n{"a":1}')).toBe('{"a":1}');
    expect(parseModelJson('```json\n{"a":1}')).toEqual({ a: 1 });
  });

  it('parses a fenced object preceded by prose and plain JSON unchanged', () => {
    expect(parseModelJson('Aqui está:\n```\n{"b":[1,2]}\n```\nfim')).toEqual({ b: [1, 2] });
    expect(parseModelJson('{"c":true}')).toEqual({ c: true });
  });

  it('still fails on output with no JSON object', () => {
    expect(() => parseModelJson('```json\nnot json\n```')).toThrow();
  });
});
