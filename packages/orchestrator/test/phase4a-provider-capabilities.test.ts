import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  createOllamaLocalVlmProvider,
} from '../src/aethera/vision-providers.js';
import {
  createPersistentVisionCache,
  type VisionCacheKey,
} from '../src/aethera/vision-router.js';

const tempDirs: string[] = [];

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function ollamaTags(models: string[]) {
  return new Response(JSON.stringify({ models: models.map((name) => ({ name })) }), { status: 200 });
}

test('habilita local-vlm somente quando o modelo visual configurado está instalado', async () => {
    const requests: string[] = [];
    globalThis.fetch = (async (input: string | URL) => {
      requests.push(String(input));
      if (String(input).endsWith('/api/show')) return new Response(JSON.stringify({ capabilities: ['completion', 'vision'] }), { status: 200 });
      return ollamaTags(['qwen2.5vl:3b']);
    }) as typeof fetch;

    const provider = createOllamaLocalVlmProvider({ baseUrl: 'http://ollama.fixture', model: 'qwen2.5vl:3b', host: 'desktop', maxVramMb: 4096, maxImagesPerCall: 4 });
    assert.deepEqual(await provider.detect(), { available: true, multimodal: true });
    assert.deepEqual(provider.capabilityProfile && { routeTier: provider.capabilityProfile.routeTier, host: provider.capabilityProfile.host, multimodal: provider.capabilityProfile.multimodal, maxImagesPerCall: provider.capabilityProfile.maxImagesPerCall, vramMb: provider.capabilityProfile.vramMb }, { routeTier: 'local', host: 'desktop', multimodal: true, maxImagesPerCall: 4, vramMb: 4096 });
    assert.deepEqual(requests, ['http://ollama.fixture/api/tags', 'http://ollama.fixture/api/show']);
});

test('mantém a rota local desligada para modelo ausente e não tenta baixar/inferir', async () => {
    const requests: string[] = [];
    globalThis.fetch = (async (input: string | URL) => {
      requests.push(String(input));
      return ollamaTags(['llama3.2:3b']);
    }) as typeof fetch;

    const provider = createOllamaLocalVlmProvider({ baseUrl: 'http://ollama.fixture', model: 'qwen2.5vl:3b' });
    const result = await provider.detect();
    assert.equal(result.available, false);
    assert.match(result.reason, /não instalado/i);
    assert.deepEqual(requests, ['http://ollama.fixture/api/tags']);
});

test('não trata um modelo textual instalado como visão multimodal', async () => {
    globalThis.fetch = (async () => ollamaTags(['llama3.2:3b'])) as typeof fetch;
    const provider = createOllamaLocalVlmProvider({ baseUrl: 'http://ollama.fixture', model: 'llama3.2:3b' });
    const result = await provider.detect();
    assert.equal(result.available, false);
    assert.match(result.reason, /multimodal|visual/i);
});

test('não habilita um modelo com nome visual quando Ollama não comprova a capacidade vision', async () => {
  globalThis.fetch = (async (input: string | URL) => {
    if (String(input).endsWith('/api/show')) return new Response(JSON.stringify({ capabilities: ['completion'] }), { status: 200 });
    return ollamaTags(['qwen2.5vl:3b']);
  }) as typeof fetch;
  const provider = createOllamaLocalVlmProvider({ baseUrl: 'http://ollama.fixture', model: 'qwen2.5vl:3b' });
  const result = await provider.detect();
  assert.equal(result.available, false);
  assert.match(result.reason, /não possui capacidade vision/i);
});

test('persiste cache content-addressed e o recupera após recriar o processo', () => {
    const dir = mkdtempSync(join(tmpdir(), 'aethera-recap-phase4a-'));
    tempDirs.push(dir);
    const path = join(dir, 'vision-router.json');
    const key: VisionCacheKey = { frameHash: 'frame-hash', provider: 'local-vlm', model: 'qwen2.5vl:3b', promptVersion: 'recap-v1', task: 'describe' };
    const value = { confidence: 0.91, description: 'fixture' };

    createPersistentVisionCache(path).put(key, value);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { [JSON.stringify(key)]: value });
    assert.deepEqual(createPersistentVisionCache(path).get(key), value);
    writeFileSync(path, '{invalid cache', 'utf8');
    assert.equal(createPersistentVisionCache(path).get(key), null);
});
