import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOllamaLocalVlmProvider, OLLAMA_RUNTIME_REPETITION_ABORTED } from '../src/aethera/vision-providers.js';

// Fase 4B.5 (Adendo 14): qwen3.5:4b-q4_K_M on Ollama 0.40.16 thinks by default (eats
// num_predict, empty content), is rejected by a name regex in detect(), and can abort
// with HTTP 500 "token repeat limit reached". Shapes below are the ones observed live.

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function frame() {
  const dir = mkdtempSync(join(tmpdir(), 'ollama-qwen35-'));
  tempDirs.push(dir);
  const path = join(dir, 'panel-001.png');
  writeFileSync(path, Buffer.from('local fixture image bytes'));
  return [{ id: 'chapter-01-p001-0', hash: 'hash-001', path, atMs: 0 }];
}

const analysis = {
  nature: 'landscape', natureConfidence: 0.9, description: 'Montanhas com névoa sob a lua.',
  frames: [{ observed: 'Montanhas com névoa.', dialogue: [] }], characters: [], actions: [], environment: null,
  overlays: { burnedText: false, watermark: false, webcam: false }, confidence: 0.9,
};
const ok = () => new Response(JSON.stringify({ model: 'qwen3.5:4b-q4_K_M', done: true, done_reason: 'stop', prompt_eval_count: 1615, eval_count: 133, message: { role: 'assistant', content: JSON.stringify(analysis) } }));

function capture(responses: Array<() => Response>) {
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra Ollama request');
    return next();
  }) as typeof fetch;
  return bodies;
}

const base = { baseUrl: 'http://ollama.fixture', contextTokens: 4096, maxOutputTokens: 512, estimatedVisualTokensPerImage: 256 };

test('envia think:false por padrão (qwen3.5 pensa por padrão; qwen2.5vl aceita think:false)', async () => {
  for (const model of ['qwen3.5:4b-q4_K_M', 'qwen2.5vl:3b']) {
    const bodies = capture([ok]);
    await createOllamaLocalVlmProvider({ ...base, model }).analyze!({ frames: frame() });
    assert.equal(bodies[0]!['think'], false, model);
  }
});

test('think só é ligado por opção explícita', async () => {
  const bodies = capture([ok]);
  await createOllamaLocalVlmProvider({ ...base, model: 'qwen3.5:4b-q4_K_M', think: true }).analyze!({ frames: frame() });
  assert.equal(bodies[0]!['think'], true);
});

test('temperature fica com o padrão do Modelfile, salvo opção explícita (também no fallback CPU)', async () => {
  let bodies = capture([ok]);
  await createOllamaLocalVlmProvider({ ...base, model: 'qwen3.5:4b-q4_K_M' }).analyze!({ frames: frame() });
  assert.equal((bodies[0]!['options'] as Record<string, unknown>)['temperature'], undefined);

  const degenerate = () => new Response('{"model":"","created_at":"0001-01-01T00:00:00Z","message":{"role":"","content":""},"done":false}');
  bodies = capture([degenerate, ok]);
  await createOllamaLocalVlmProvider({ ...base, model: 'qwen3.5:4b-q4_K_M', temperature: 0.2, cpuFallbackOnDegenerateOutput: true }).analyze!({ frames: frame() });
  assert.equal((bodies[0]!['options'] as Record<string, unknown>)['temperature'], 0.2);
  assert.equal((bodies[1]!['options'] as Record<string, unknown>)['temperature'], 0.2);
});

test('resposta só com thinking (done_reason=length) é explicada, não vira "sem conteúdo" genérico', async () => {
  capture([() => new Response(JSON.stringify({ model: 'qwen3.5:4b-q4_K_M', done: true, done_reason: 'length', eval_count: 512, message: { role: 'assistant', content: '', thinking: 'x'.repeat(4967) } }))]);
  await assert.rejects(createOllamaLocalVlmProvider({ ...base, model: 'qwen3.5:4b-q4_K_M', think: true }).analyze!({ frames: frame() }), /thinking.*4967|4967.*thinking/i);
});

test('HTTP 500 "token repeat limit reached" é classificado, sem fallback CPU nem retry', async () => {
  const bodies = capture([() => new Response('{"error":"prediction aborted, token repeat limit reached"}', { status: 500 })]);
  await assert.rejects(
    createOllamaLocalVlmProvider({ ...base, model: 'qwen3.5:4b-q4_K_M', cpuFallbackOnDegenerateOutput: true }).analyze!({ frames: frame() }),
    (error: Error & { code?: string }) => {
      assert.equal(error.code, OLLAMA_RUNTIME_REPETITION_ABORTED);
      assert.match(error.message, /token repeat limit/);
      return true;
    },
  );
  assert.equal(bodies.length, 1);
});

test('detect aceita qwen3.5 quando /api/show comprova vision (sem depender do nome)', async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input: string | URL) => {
    urls.push(String(input));
    if (String(input).endsWith('/api/show')) return new Response(JSON.stringify({ capabilities: ['completion', 'vision', 'tools', 'thinking'] }));
    return new Response(JSON.stringify({ models: [{ name: 'qwen3.5:4b-q4_K_M' }, { name: 'qwen2.5vl:3b' }] }));
  }) as typeof fetch;
  assert.deepEqual(await createOllamaLocalVlmProvider({ ...base, model: 'qwen3.5:4b-q4_K_M' }).detect(), { available: true, multimodal: true });
  assert.deepEqual(urls, ['http://ollama.fixture/api/tags', 'http://ollama.fixture/api/show']);
});

test('detect continua recusando modelo sem vision em /api/show', async () => {
  globalThis.fetch = (async (input: string | URL) => {
    if (String(input).endsWith('/api/show')) return new Response(JSON.stringify({ capabilities: ['completion', 'thinking'] }));
    return new Response(JSON.stringify({ models: [{ name: 'qwen3:4b' }] }));
  }) as typeof fetch;
  const result = await createOllamaLocalVlmProvider({ ...base, model: 'qwen3:4b' }).detect();
  assert.equal(result.available, false);
  assert.match((result as { reason: string }).reason, /vision/);
});
