import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOllamaLocalVlmProvider, OLLAMA_RUNTIME_DEGENERATE_OUTPUT } from '../src/aethera/vision-providers.js';

// Fase 4B.4: Ollama 0.40.16 answers a CUDA sampler exception (first token `@`) with
// HTTP 200 and this exact 96-byte envelope. It must be classified as a runtime failure,
// never retried on the same device, and only recovered by one bounded CPU attempt.
const DEGENERATE_ENVELOPE = '{"model":"","created_at":"0001-01-01T00:00:00Z","message":{"role":"","content":""},"done":false}';

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function frame() {
  const dir = mkdtempSync(join(tmpdir(), 'ollama-degenerate-'));
  tempDirs.push(dir);
  const path = join(dir, 'panel-001.png');
  writeFileSync(path, Buffer.from('local fixture image bytes'));
  return [{ id: 'chapter-01-p001-0', hash: 'hash-001', path, atMs: 0 }];
}

function compactAnalysis() {
  return {
    schemaVersion: 1,
    nature: 'landscape',
    natureConfidence: 0.8,
    description: 'Montanhas com névoa sob a lua.',
    frames: [{ atMs: 0, observed: 'Montanhas com névoa.', dialogue: [] }],
    characters: [],
    actions: [],
    environment: { description: 'Montanhas à noite.', basis: 'observed', confidence: 0.8 },
    overlays: { burnedText: false, burnedTextRegion: null, watermark: false, webcam: false },
    limitations: [],
    confidence: 0.8,
  };
}

const okEnvelope = (inputTokens = 1949, outputTokens = 411) => JSON.stringify({
  model: 'qwen2.5vl:3b', done: true, done_reason: 'stop', prompt_eval_count: inputTokens, eval_count: outputTokens,
  message: { role: 'assistant', content: JSON.stringify(compactAnalysis()) },
});

type Captured = { url: string; body: Record<string, unknown> };
function scriptedFetch(responses: Array<string | (() => Response)>, captured: Captured[]): typeof fetch {
  return (async (input, init) => {
    captured.push({ url: String(input), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    const next = responses.shift();
    if (next === undefined) throw new Error('unexpected extra Ollama request');
    return typeof next === 'string' ? new Response(next, { status: 200 }) : next();
  }) as typeof fetch;
}

function provider(options: Parameters<typeof createOllamaLocalVlmProvider>[0] = {}) {
  return createOllamaLocalVlmProvider({
    baseUrl: 'http://ollama.fixture', model: 'qwen2.5vl:3b', contextTokens: 4096, maxOutputTokens: 512, estimatedVisualTokensPerImage: 256,
    ...options,
  });
}

const options = (c: Captured) => c.body['options'] as Record<string, unknown>;

test('envelope degenerado (HTTP 200, done=false, vazio) cai uma única vez para CPU e descarrega o runner CPU', async () => {
  const captured: Captured[] = [];
  globalThis.fetch = scriptedFetch([DEGENERATE_ENVELOPE, okEnvelope()], captured);
  const p = provider({ cpuFallbackOnDegenerateOutput: true });

  const result = await p.analyze!({ frames: frame() });

  assert.equal(result.nature, 'landscape');
  assert.equal(captured.length, 2);
  assert.equal(options(captured[0]!)['num_gpu'], undefined, 'GPU route keeps Ollama default placement');
  assert.equal(captured[0]!.body['keep_alive'], undefined);
  assert.equal(options(captured[1]!)['num_gpu'], 0, 'fallback forces CPU-only (vision encoder included)');
  assert.equal(captured[1]!.body['keep_alive'], 0, 'CPU runner must not stay resident and capture later GPU calls');
  assert.equal(captured[1]!.body['format'], 'json');
  assert.deepEqual(captured[1]!.body['messages'], captured[0]!.body['messages'], 'same prompt and image on both routes');
  assert.equal((p as { lastRoute?: () => string | null }).lastRoute?.(), 'cpu-fallback');
  assert.equal(p.lastUsage?.()?.inputTokens, 1949);
});

test('sem fallback habilitado, a falha é classificada e não há segunda chamada', async () => {
  const captured: Captured[] = [];
  globalThis.fetch = scriptedFetch([DEGENERATE_ENVELOPE], captured);
  await assert.rejects(provider({ cpuFallbackOnDegenerateOutput: false }).analyze!({ frames: frame() }), (error: Error & { code?: string }) => {
    assert.equal(error.code, OLLAMA_RUNTIME_DEGENERATE_OUTPUT);
    assert.match(error.message, /OLLAMA_RUNTIME_DEGENERATE_OUTPUT/);
    assert.match(error.message, /done=false.*contentChars=0.*rawBytes=96/);
    return true;
  });
  assert.equal(captured.length, 1);
});

test('se a CPU também degenerar, rejeita após exatamente duas chamadas (sem loop)', async () => {
  const captured: Captured[] = [];
  globalThis.fetch = scriptedFetch([DEGENERATE_ENVELOPE, DEGENERATE_ENVELOPE], captured);
  await assert.rejects(provider({ cpuFallbackOnDegenerateOutput: true }).analyze!({ frames: frame() }), (error: Error & { code?: string }) => {
    assert.equal(error.code, OLLAMA_RUNTIME_DEGENERATE_OUTPUT);
    assert.match(error.message, /CPU/);
    return true;
  });
  assert.equal(captured.length, 2);
});

test('orçamento de fallbacks CPU é por instância e esgota sem nova chamada', async () => {
  const captured: Captured[] = [];
  globalThis.fetch = scriptedFetch([DEGENERATE_ENVELOPE, okEnvelope(), DEGENERATE_ENVELOPE], captured);
  const p = provider({ cpuFallbackOnDegenerateOutput: true, maxCpuFallbacks: 1 });
  await p.analyze!({ frames: frame() });
  await assert.rejects(p.analyze!({ frames: frame() }), (error: Error & { code?: string }) => {
    assert.equal(error.code, OLLAMA_RUNTIME_DEGENERATE_OUTPUT);
    assert.match(error.message, /orçamento|budget/i);
    return true;
  });
  assert.equal(captured.length, 3);
});

test('outras falhas (HTTP 500, JSON inválido, done=false com conteúdo) não acionam fallback', async () => {
  const cases: Array<string | (() => Response)> = [
    () => new Response('{"error":"boom"}', { status: 500 }),
    JSON.stringify({ model: 'qwen2.5vl:3b', done: true, message: { content: '{invalid' } }),
    JSON.stringify({ model: 'qwen2.5vl:3b', done: false, message: { content: '{"partial":' } }),
  ];
  for (const scripted of cases) {
    const captured: Captured[] = [];
    globalThis.fetch = scriptedFetch([scripted], captured);
    await assert.rejects(provider({ cpuFallbackOnDegenerateOutput: true }).analyze!({ frames: frame() }), (error: Error & { code?: string }) => {
      assert.notEqual(error.code, OLLAMA_RUNTIME_DEGENERATE_OUTPUT);
      return true;
    });
    assert.equal(captured.length, 1);
  }
});

test('cancelamento durante a falha GPU não dispara fallback CPU', async () => {
  const captured: Captured[] = [];
  const controller = new AbortController();
  globalThis.fetch = scriptedFetch([() => { controller.abort(); return new Response(DEGENERATE_ENVELOPE, { status: 200 }); }], captured);
  await assert.rejects(provider({ cpuFallbackOnDegenerateOutput: true }).analyze!({ frames: frame(), signal: controller.signal }), /cancelled|interrupted/i);
  assert.equal(captured.length, 1);
});

test('fallback CPU fica desligado por padrão (CPU não vira rota implícita)', async () => {
  const captured: Captured[] = [];
  globalThis.fetch = scriptedFetch([DEGENERATE_ENVELOPE], captured);
  const previous = process.env['NB_LOCAL_VLM_CPU_FALLBACK'];
  delete process.env['NB_LOCAL_VLM_CPU_FALLBACK'];
  try {
    await assert.rejects(provider().analyze!({ frames: frame() }), (error: Error & { code?: string }) => error.code === OLLAMA_RUNTIME_DEGENERATE_OUTPUT);
  } finally {
    if (previous !== undefined) process.env['NB_LOCAL_VLM_CPU_FALLBACK'] = previous;
  }
  assert.equal(captured.length, 1);
});
