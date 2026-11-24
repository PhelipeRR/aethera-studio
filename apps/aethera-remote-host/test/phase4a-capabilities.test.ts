import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { RemoteAgentManager } from '../src/agents';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function managerWithTags(models: string[]) {
  globalThis.fetch = (async (input: string | URL) => {
    if (String(input).endsWith('/api/show')) return new Response(JSON.stringify({ capabilities: ['completion', 'vision'] }), { status: 200 });
    assert.equal(String(input), 'http://ollama.fixture/api/tags');
    return new Response(JSON.stringify({ models: models.map((name) => ({ name })) }), { status: 200 });
  }) as typeof fetch;
  return new RemoteAgentManager({
    ollamaBaseUrl: 'http://ollama.fixture',
    env: { PATH: '' },
    gpuProbe: async () => ({ available: true, name: 'NVIDIA GeForce RTX 4060 Ti', vramMb: 8192 }),
  });
}

test('Remote Host handshake reports visual Ollama capability and measured GPU facts', async () => {
  const response = await managerWithTags(['qwen2.5vl:3b']).discoverAgents();
  const ollama = response.agents.find((agent) => agent.id === 'ollama');
  assert.ok(ollama);
  assert.deepEqual(ollama.vision, {
    available: true,
    multimodal: true,
    selectedModel: 'qwen2.5vl:3b',
    models: ['qwen2.5vl:3b'],
    maxImagesPerCall: 1,
    gpu: { available: true, name: 'NVIDIA GeForce RTX 4060 Ti', vramMb: 8192 },
    telemetry: { tokens: true, cache: false, effectiveApiCost: false, estimatedCost: false, cliQuota: false },
    ocr: { available: null, engine: null, version: null, cpuPreferred: true },
    worker: { maxConcurrent: 1, active: null },
    vramLimitMb: 6500,
    host: 'remote_host',
  });
});

test('Remote Host distinguishes Ollama reachability from a validated visual model', async () => {
  const response = await managerWithTags(['llama3.2:3b']).discoverAgents();
  const ollama = response.agents.find((agent) => agent.id === 'ollama');
  assert.ok(ollama);
  assert.equal(ollama.installed, true);
  assert.equal(ollama.vision?.available, false);
  assert.equal(ollama.vision?.multimodal, false);
  assert.match(ollama.problem ?? '', /nenhum modelo visual conhecido|multimodal desabilitada/i);
});

test('Remote Host does not mark a different visual model as the configured Recap model', async () => {
  const response = await managerWithTags(['llava:7b']).discoverAgents();
  const ollama = response.agents.find((agent) => agent.id === 'ollama');
  assert.ok(ollama);
  assert.equal(ollama.vision?.multimodal, false, 'a different installed visual model is not the configured Recap capability');
  assert.equal(ollama.vision?.available, false);
  assert.equal(ollama.vision?.selectedModel, 'qwen2.5vl:3b');
  assert.deepEqual(ollama.vision?.models, ['llava:7b']);
  assert.match(ollama.problem ?? '', /modelo visual configurado.*qwen2\.5vl:3b.*não está instalado/i);
});
