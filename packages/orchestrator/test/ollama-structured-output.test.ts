import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { buildLocalPanelJsonSchema, createOllamaLocalVlmProvider } from '../src/aethera/vision-providers.js';

// Fase 4B.6 (Adendo 15): every qwen3.5 schema failure was shape-only (missing confidence,
// region outside the enum, 11 frames for 1 image, frames[1] as string). Ollama structured
// outputs (`format` = JSON schema) constrain generation to the contract. Opt-in only:
// the default request keeps `format: 'json'`.

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function frame() {
  const dir = mkdtempSync(join(tmpdir(), 'ollama-structured-'));
  tempDirs.push(dir);
  const path = join(dir, 'panel-001.png');
  writeFileSync(path, Buffer.from('local fixture image bytes'));
  return [{ id: 'chapter-01-p001-0', hash: 'hash-001', path, atMs: 0 }];
}

const conforming = {
  nature: 'dialogue', natureConfidence: 0.7, description: 'Um homem de pé chama outro, deitado.',
  frames: [{ observed: 'Homem de pé sobre outro deitado.', dialogue: [{ text: 'PRINCE! ARE YOU AWAKE?!', region: 'top' }] }],
  characters: [{ name: 'Homem de pé', basis: 'observed', evidence: 'Coque e túnica escura.', confidence: 0.8 }],
  actions: [{ description: 'Chama o outro com urgência.', basis: 'inferred', confidence: 0.6 }],
  environment: { description: 'Interior com cama.', basis: 'observed', confidence: 0.7 },
  overlays: { burnedText: false, watermark: false, webcam: false }, confidence: 0.7,
};

function capture() {
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ model: 'qwen3.5:4b-q4_K_M', done: true, prompt_eval_count: 841, eval_count: 300, message: { content: JSON.stringify(conforming) } }));
  }) as typeof fetch;
  return bodies;
}

const base = { baseUrl: 'http://ollama.fixture', model: 'qwen3.5:4b-q4_K_M', contextTokens: 4096, maxOutputTokens: 512, estimatedVisualTokensPerImage: 256 };
type Schema = { type?: string; enum?: string[]; required?: string[]; properties?: Record<string, Schema>; items?: Schema; minItems?: number; maxItems?: number; additionalProperties?: boolean; anyOf?: Schema[] };

test('sem opção, o pedido continua com format "json"', async () => {
  const bodies = capture();
  await createOllamaLocalVlmProvider(base).analyze!({ frames: frame() });
  assert.equal(bodies[0]!['format'], 'json');
});

test('structuredOutput envia o JSON schema do contrato e mantém o prompt', async () => {
  const plain = capture();
  await createOllamaLocalVlmProvider(base).analyze!({ frames: frame() });
  const bodies = capture();
  const result = await createOllamaLocalVlmProvider({ ...base, structuredOutput: true }).analyze!({ frames: frame() });
  assert.deepEqual(bodies[0]!['format'], buildLocalPanelJsonSchema(1));
  assert.deepEqual(bodies[0]!['messages'], plain[0]!['messages'], 'same prompt and image');
  assert.equal(result.frames[0]?.visibleText[0]?.text, 'PRINCE! ARE YOU AWAKE?!');
});

test('o schema fecha exatamente as falhas de forma observadas no piloto de confirmação', () => {
  const schema = buildLocalPanelJsonSchema(1) as Schema;
  const p = schema.properties!;
  assert.equal(schema.additionalProperties, false);
  for (const key of ['nature', 'natureConfidence', 'description', 'frames', 'characters', 'actions', 'environment', 'overlays', 'confidence']) assert.ok(schema.required!.includes(key), key);
  assert.deepEqual(p['nature']!.enum, ['action', 'exploration', 'landscape', 'dialogue', 'speech', 'crowd', 'portrait', 'cinematic', 'interface', 'text_card', 'document', 'other', 'unknown']);
  assert.equal(p['frames']!.minItems, 1, 'one observation per attached image');
  assert.equal(p['frames']!.maxItems, 1, 'p26_3 produced 11 frames for one image');
  const frameItem = p['frames']!.items!;
  assert.deepEqual(frameItem.required, ['observed', 'dialogue']);
  assert.equal(frameItem.properties!['observed']!.type, 'string', 'frames[1] came as string/null');
  assert.deepEqual(frameItem.properties!['dialogue']!.items!.properties!['region']!.enum, ['top', 'center', 'bottom', 'full', 'overlay'], 'bottom-right/left-center were emitted');
  assert.deepEqual(p['characters']!.items!.required, ['name', 'basis', 'evidence', 'confidence']);
  assert.deepEqual(p['actions']!.items!.required, ['description', 'basis', 'confidence']);
  assert.deepEqual(p['overlays']!.required, ['burnedText', 'watermark', 'webcam']);
  assert.ok(p['environment']!.anyOf!.some((option) => option.type === 'null'), 'environment may be null');
  assert.equal(buildLocalPanelJsonSchema(3).properties!['frames']!.maxItems, 3);
});
