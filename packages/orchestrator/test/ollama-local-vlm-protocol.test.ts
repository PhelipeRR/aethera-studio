import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOllamaLocalVlmProvider } from '../src/aethera/vision-providers.js';

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function fixtureImage(): string {
  const dir = mkdtempSync(join(tmpdir(), 'ollama-local-vlm-protocol-'));
  tempDirs.push(dir);
  const path = join(dir, 'panel-001.png');
  writeFileSync(path, Buffer.from('local fixture image bytes'));
  return path;
}

function compactAnalysis() {
  return {
    schemaVersion: 1,
    nature: 'dialogue',
    natureConfidence: 0.91,
    description: 'Uma personagem aparece diante de uma porta e fala.',
    frames: [{ atMs: 0, observed: 'Personagem diante de uma porta.', dialogue: [{ text: 'Eu vou entrar.', region: 'center' }] }],
    characters: [{ name: 'Personagem não identificada', basis: 'observed', evidence: 'Uma figura humana está visível no painel.', confidence: 0.78 }],
    actions: [{ description: 'A personagem permanece diante da porta.', basis: 'observed', confidence: 0.84 }],
    environment: { description: 'Interior com uma porta visível.', basis: 'observed', confidence: 0.8 },
    overlays: { burnedText: false, burnedTextRegion: null, watermark: false, webcam: false },
    limitations: ['A identidade da personagem não está legível.'],
    confidence: 0.86,
  };
}

function provider(options: Parameters<typeof createOllamaLocalVlmProvider>[0] = {}) {
  return createOllamaLocalVlmProvider({
    baseUrl: 'http://ollama.fixture',
    model: 'qwen2.5vl:3b',
    contextTokens: 4096,
    maxOutputTokens: 512,
    estimatedVisualTokensPerImage: 256,
    ...options,
  });
}

function frame(path = fixtureImage()) {
  return [{ id: 'chapter-01-p001-0', hash: 'hash-001', path, atMs: 0 }];
}

function response(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), headers ? { status, headers } : { status });
}

test('preserva diagnóstico sanitizado de HTTP 400 sem enviar schema extenso', async () => {
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return response({ error: 'invalid api_key=super-secret-value' }, 400);
  }) as typeof fetch;

  await assert.rejects(
    provider().analyze!({ frames: frame(), context: 'personagem e relação anterior '.repeat(80) }),
    (error: Error) => {
      assert.match(error.message, /HTTP 400/);
      assert.match(error.message, /\[redacted\]/);
      assert.doesNotMatch(error.message, /super-secret-value/);
      return true;
    },
  );
  const prompt = String((requestBody?.messages as Array<{ content: string }>)[0]?.content);
  assert.equal(requestBody?.stream, false);
  assert.equal(requestBody?.format, 'json');
  assert.ok(prompt.length < 2_000);
  assert.doesNotMatch(prompt, /properties|additionalProperties|anyOf/);
});

test('aceita HTTP 200 somente quando done=true e adapta o contrato compacto', async () => {
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return response({ model: 'qwen2.5vl:3b', done: true, prompt_eval_count: 311, eval_count: 94, message: { content: JSON.stringify(compactAnalysis()) } });
  }) as typeof fetch;

  const localProvider = provider();
  const result = await localProvider.analyze!({ frames: frame(), context: 'Contexto mínimo.' });
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.frames[0]?.visibleText[0]?.text, 'Eu vou entrar.');
  assert.equal(result.entities[0]?.type, 'character');
  assert.deepEqual(localProvider.lastUsage?.(), {
    inputTokens: 311,
    outputTokens: 94,
    cachedTokens: null,
    cacheWriteTokens: null,
    effectiveApiCostUsd: null,
    estimatedCostUsd: null,
    quotaUnits: null,
    quotaKind: null,
  });
  assert.equal((requestBody?.messages as Array<{ images: string[] }>)[0]?.images.length, 1);
});

test('agrega streaming parcial até done=true e captura uso final', async () => {
  const path = fixtureImage();
  // Use a complete compact object split across NDJSON events; the final event carries usage.
  const compact = JSON.stringify(compactAnalysis());
  const body = [
    JSON.stringify({ model: 'qwen2.5vl:3b', done: false, message: { content: compact.slice(0, 80) } }),
    JSON.stringify({ done: false, message: { content: compact.slice(80) } }),
    JSON.stringify({ model: 'qwen2.5vl:3b', done: true, prompt_eval_count: 402, eval_count: 118, message: { content: '' } }),
  ].join('\n');
  globalThis.fetch = (async () => response(body)) as typeof fetch;
  const streamingProvider = provider({ stream: true });
  const result = await streamingProvider.analyze!({ frames: frame(path), context: 'Contexto mínimo.' });
  assert.equal(result.confidence, 0.86);
  assert.deepEqual(streamingProvider.lastUsage?.(), {
    inputTokens: 402,
    outputTokens: 118,
    cachedTokens: null,
    cacheWriteTokens: null,
    effectiveApiCostUsd: null,
    estimatedCostUsd: null,
    quotaUnits: null,
    quotaKind: null,
  });
});

test('rejeita streaming sem done=true, JSON inválido e resposta vazia', async () => {
  globalThis.fetch = (async () => response({ model: '', done: false, message: { content: '' } })) as typeof fetch;
  await assert.rejects(provider().analyze!({ frames: frame() }), /done=false.*contentChars=0/i);

  globalThis.fetch = (async () => response(JSON.stringify({ done: false, message: { content: '{}' } }))) as typeof fetch;
  await assert.rejects(provider({ stream: true }).analyze!({ frames: frame() }), /done=true|incompleta/i);

  globalThis.fetch = (async () => response({ done: true, message: { content: '{invalid' } })) as typeof fetch;
  await assert.rejects(provider().analyze!({ frames: frame() }), /JSON de análise inválido/i);

  globalThis.fetch = (async () => response({ done: true, message: { content: '' } })) as typeof fetch;
  await assert.rejects(provider().analyze!({ frames: frame() }), /sem conteúdo/i);
});

test('rejeita contexto excessivo antes do fetch e respeita limite de imagens', async () => {
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return response({}); }) as typeof fetch;
  await assert.rejects(provider({ estimatedVisualTokensPerImage: 4_096 }).analyze!({ frames: frame() }), /RECAP_LOCAL_CONTEXT_EXCEEDED/);
  await assert.rejects(provider().analyze!({ frames: [...frame(), ...frame('different')] }), /no máximo 1 imagem/);
  assert.equal(calls, 0);
});

test('rejeita imagem inválida, timeout e cancelamento sem fallback', async () => {
  await assert.rejects(provider().analyze!({ frames: [{ id: 'bad', hash: 'bad', path: 'C:/does-not-exist/panel.png' }] }), /ENOENT|no such file|cannot find/i);

  globalThis.fetch = (async (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  })) as typeof fetch;
  await assert.rejects(provider({ timeoutMs: 1_000 }).analyze!({ frames: frame() }), /timeout|aborted/i);

  const controller = new AbortController();
  controller.abort();
  await assert.rejects(provider().analyze!({ frames: frame(), signal: controller.signal }), /cancelled|interrupted/i);
});
