import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOllamaLocalVlmProvider, RECAP_LOCAL_SCHEMA_INVALID } from '../src/aethera/vision-providers.js';

// Fase 4B.4 (Adendo 10): qwen2.5vl:3b via Ollama answers the compact contract with the
// right keys but wrong types. These fixtures keep the exact shapes observed live; free
// text was shortened. Normalization must be deterministic, bounded and never invent facts.

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function frame() {
  const dir = mkdtempSync(join(tmpdir(), 'ollama-contract-'));
  tempDirs.push(dir);
  const path = join(dir, 'panel-001.png');
  writeFileSync(path, Buffer.from('local fixture image bytes'));
  return [{ id: 'chapter-01-p001-0', hash: 'hash-001', path, atMs: 1200 }];
}

function analyzeWith(content: unknown) {
  let requestBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ model: 'qwen2.5vl:3b', done: true, prompt_eval_count: 1949, eval_count: 411, message: { content: JSON.stringify(content) } }));
  }) as typeof fetch;
  const provider = createOllamaLocalVlmProvider({ baseUrl: 'http://ollama.fixture', model: 'qwen2.5vl:3b', contextTokens: 4096, maxOutputTokens: 512, estimatedVisualTokensPerImage: 256 });
  return { run: () => provider.analyze!({ frames: frame() }), body: () => requestBody };
}

// Shape observed on the real panel p0_0 (CPU route, 20:06:31).
const realPanelShape = {
  schemaVersion: '1', nature: 'landscape', natureConfidence: 'high',
  description: 'Cena noturna com lua cheia, montanhas escarpadas e névoa.',
  frames: [{ atMs: 0, observed: true, dialogue: [] }],
  characters: [{ name: 'Unknown', basis: 'inferred', evidence: 'No characters are present in the image.', confidence: 'low' }],
  actions: [{ description: 'No actions are taking place in the image.', basis: 'inferred', confidence: 'medium' }],
  environment: { type: 'night', weather: 'clear', sky: { moon: { phase: 'full' } } },
  overlays: [],
  limitations: { resolution: 'low', color: 'monochrome', detail: 'limited' },
  confidence: 'medium',
};

// Shape observed on the synthetic 2x3 grid with the adapter prompt (GPU route, 20:01:26).
const syntheticGridShape = {
  schemaVersion: '1', nature: 'static', natureConfidence: 'high',
  description: 'A image shows a grid with four squares, each containing a different colored shape.',
  frames: ['red circle', 'blue rectangle', 'green circle', 'yellow rectangle', 'purple circle', 'orange rectangle'].map((observed) => ({ atMs: 0, observed, dialogue: [] })),
  characters: [{ name: 'red circle', basis: 'observed', evidence: 'red circle in the top left square', confidence: 'high' }],
  actions: [{ description: 'No actions observed.', basis: 'observed', confidence: 'high' }],
  environment: 'null', overlays: 'null', limitations: 'No limitations provided.', confidence: 'high',
};

test('normaliza o formato real do painel p0_0 sem inventar conteúdo', async () => {
  const result = await analyzeWith(realPanelShape).run();
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.nature, 'landscape');
  assert.equal(result.natureConfidence, 0.85);
  assert.equal(result.confidence, 0.6);
  assert.equal(result.frames.length, 1);
  assert.equal(result.frames[0]?.atMs, 1200, 'adapter keeps the input frame time');
  assert.equal(result.frames[0]?.observed, realPanelShape.description, 'boolean observed on a single frame reuses the model description');
  assert.equal(result.entities[0]?.confidence, 0.35);
  assert.equal(result.actions[0]?.confidence, 0.6);
  assert.equal(result.environment, null, 'free-form environment without description is dropped, not rewritten');
  assert.deepEqual(result.overlays, { burnedText: false, burnedTextRegion: null, watermark: false, webcam: false });
  assert.ok(result.limitations.includes('resolution: low'));
  const note = result.limitations.find((item) => item.startsWith('Saída local normalizada'));
  assert.ok(note, 'lossy normalization is disclosed in limitations');
  assert.match(note!, /confidence/);
  assert.match(note!, /environment/);
  assert.match(note!, /overlays/);
});

test('normaliza o formato real da grade sintética (enum, frames extras, "null" em texto)', async () => {
  const result = await analyzeWith(syntheticGridShape).run();
  assert.equal(result.nature, 'other');
  assert.equal(result.frames.length, 1, 'one observation per attached image');
  for (const shape of ['red circle', 'blue rectangle', 'orange rectangle']) assert.match(result.frames[0]!.observed, new RegExp(shape));
  assert.equal(result.environment, null);
  assert.ok(result.limitations.includes('No limitations provided.'));
  const note = result.limitations.find((item) => item.startsWith('Saída local normalizada'))!;
  assert.match(note, /nature=static/);
  assert.match(note, /frames 6→1/);
});

test('saída já conforme passa sem nota de normalização', async () => {
  const conforming = {
    schemaVersion: 1, nature: 'dialogue', natureConfidence: 0.9, description: 'Uma personagem fala diante de uma porta.',
    frames: [{ atMs: 0, observed: 'Personagem diante de uma porta.', dialogue: [{ text: 'Eu vou entrar.', region: 'center' }] }],
    characters: [], actions: [], environment: null,
    overlays: { burnedText: false, burnedTextRegion: null, watermark: false, webcam: false },
    limitations: [], confidence: 0.8,
  };
  const result = await analyzeWith(conforming).run();
  assert.equal(result.frames[0]?.visibleText[0]?.text, 'Eu vou entrar.');
  assert.equal(result.limitations.some((item) => item.startsWith('Saída local normalizada')), false);
});

test('não converte o que não tem mapeamento determinístico e classifica a falha sem despejar o zod', async () => {
  const { run } = analyzeWith({ ...realPanelShape, description: '', confidence: 'maybe' });
  await assert.rejects(run(), (error: Error & { code?: string }) => {
    assert.equal(error.code, RECAP_LOCAL_SCHEMA_INVALID);
    assert.match(error.message, /RECAP_LOCAL_SCHEMA_INVALID/);
    assert.match(error.message, /description/);
    assert.match(error.message, /confidence/);
    assert.doesNotMatch(error.message, /"code":|\[\s*\{/u, 'no raw zod issue array');
    assert.ok(error.message.length < 800);
    return true;
  });
});

test('observed booleano com mais de uma observação não é preenchido', async () => {
  const { run } = analyzeWith({ ...realPanelShape, frames: [{ atMs: 0, observed: true, dialogue: [] }, { atMs: 0, observed: false, dialogue: [] }] });
  await assert.rejects(run(), (error: Error & { code?: string }) => error.code === RECAP_LOCAL_SCHEMA_INVALID && /frames/.test(error.message));
});

test('prompt v3: esqueleto com todos os campos de item, enum fora do valor e sem valores copiáveis', async () => {
  const { run, body } = analyzeWith(realPanelShape);
  await run();
  const prompt = String((body()?.messages as Array<{ content: string }>)[0]?.content);
  assert.match(prompt, /números entre 0 e 1/);
  assert.match(prompt, /nature: action\|exploration\|landscape\|/, 'enum listed outside the skeleton value');
  assert.match(prompt, /"nature":"…"/, 'no copyable nature value (pilot v2 echoed the whole enum)');
  assert.match(prompt, /"characters":\[\{"name":"…","basis":"observed","evidence":"…","confidence":0\.0\}\]/, 'pilot v2 omitted evidence when the item was not shown');
  assert.match(prompt, /"dialogue":\[\{"text":"…","region":"top"\}\]/);
  assert.doesNotMatch(prompt, /0\.8/, 'pilot v2 copied 0.8 into every confidence');
  assert.match(prompt, /exatamente 1 item em frames/);
  assert.doesNotMatch(prompt, /properties|additionalProperties|anyOf/);
  assert.ok(prompt.length < 2_000, `prompt length ${prompt.length}`);
});

test('itens de exemplo ecoados ("…") são removidos e declarados; schemaVersion/atMs ausentes não reprovam', async () => {
  const echoed = {
    nature: 'dialogue', natureConfidence: 0.7, description: 'Dois homens conversam num pátio.',
    frames: [{ observed: 'Dois homens conversam num pátio.', dialogue: [{ text: '…', region: 'top' }, { text: 'Vamos embora.', region: 'top' }] }],
    characters: [{ name: '…', basis: 'observed', evidence: '…', confidence: 0 }, { name: 'Homem de túnica', basis: 'observed', evidence: 'Figura em primeiro plano.', confidence: 0.6 }],
    actions: [{ description: '…', basis: 'inferred', confidence: 0 }],
    environment: { description: '…', basis: 'observed', confidence: 0 },
    overlays: { burnedText: false, watermark: false, webcam: false },
    confidence: 0.7,
  };
  const result = await analyzeWith(echoed).run();
  assert.equal(result.schemaVersion, 1);
  assert.deepEqual(result.frames[0]?.visibleText.map((line) => line.text), ['Vamos embora.']);
  assert.deepEqual(result.entities.map((entity) => entity.name), ['Homem de túnica']);
  assert.equal(result.actions.length, 0);
  assert.equal(result.environment, null);
  assert.equal(result.overlays.burnedTextRegion, null);
  const note = result.limitations.find((item) => item.startsWith('Saída local normalizada'))!;
  assert.match(note, /item\(ns\) vazio\(s\) ou de exemplo removido\(s\)/);
});

test('esqueleto devolvido literalmente não vira análise: campos obrigatórios "…" reprovam', async () => {
  const { run } = analyzeWith({
    nature: '…', natureConfidence: 0.0, description: '…', frames: [{ observed: '…', dialogue: [{ text: '…', region: 'top' }] }],
    characters: [{ name: '…', basis: 'observed', evidence: '…', confidence: 0.0 }], actions: [], environment: null,
    overlays: { burnedText: false, watermark: false, webcam: false }, confidence: 0.0,
  });
  await assert.rejects(run(), (error: Error & { code?: string }) => error.code === RECAP_LOCAL_SCHEMA_INVALID && /description/.test(error.message));
});
