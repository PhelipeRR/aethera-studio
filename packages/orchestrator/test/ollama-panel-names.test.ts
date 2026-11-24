import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOllamaLocalVlmProvider } from '../src/aethera/vision-providers.js';

// Fase 4B.8 (Adendos 15–17): a per-panel VLM gives the visible character the name it reads
// in a balloon ("GUARD JANG, I'M NEVER…" → the crying boy becomes "Guard Jang"; "PRINCE?!"
// → the speaker becomes the Prince) and lists names that are only mentioned. Names are a
// narrative decision across panels: per panel, text-derived names are never attributed.
// Fixtures keep the exact shapes observed live in run17/run19.

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function frame() {
  const dir = mkdtempSync(join(tmpdir(), 'ollama-names-'));
  tempDirs.push(dir);
  const path = join(dir, 'panel-001.png');
  writeFileSync(path, Buffer.from('local fixture image bytes'));
  return [{ id: 'chapter-01-p071-0', hash: 'hash-071', path, atMs: 0 }];
}

type Character = { name: string; basis: string; evidence: string; confidence: number };
function analysis(dialogue: string[], characters: Character[]) {
  return {
    nature: 'dialogue', natureConfidence: 0.95, description: 'Painel com personagem e balões.',
    frames: [{ observed: 'Personagem e balões de fala.', dialogue: dialogue.map((text) => ({ text, region: 'top' })) }],
    characters, actions: [], environment: null,
    overlays: { burnedText: false, watermark: false, webcam: false }, confidence: 0.9,
  };
}

function run(content: unknown, options: Record<string, unknown> = {}) {
  let body: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input, init) => {
    body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return new Response(JSON.stringify({ model: 'qwen3.5:4b-q4_K_M', done: true, prompt_eval_count: 2416, eval_count: 300, message: { content: JSON.stringify(content) } }));
  }) as typeof fetch;
  const provider = createOllamaLocalVlmProvider({ baseUrl: 'http://ollama.fixture', model: 'qwen3.5:4b-q4_K_M', contextTokens: 4096, maxOutputTokens: 512, estimatedVisualTokensPerImage: 256, ...options });
  return { result: provider.analyze!({ frames: frame() }), body: () => body };
}

const note = (limitations: string[]) => limitations.find((item) => item.startsWith('Saída local normalizada')) ?? '';

test('p71_0: nome lido no vocativo não vira personagem; o personagem visual perde o nome', async () => {
  const { result } = run(analysis(["GUARD JANG, I'M NEVER GOING TO CRY AGAIN.", 'NEVER.'], [
    { name: 'Jovem masculino (identificado como Guard Jang)', basis: 'observed', evidence: 'O personagem é visível em ambos os painéis, com traços de choro e expressão triste.', confidence: 0.9 },
  ]));
  const { entities, limitations } = await result;
  assert.deepEqual(entities.map((entity) => entity.name), ['personagem não identificado']);
  assert.equal(entities[0]?.basis, 'observed', 'visual observation is kept');
  assert.match(entities[0]?.evidence ?? '', /choro/);
  assert.match(note(limitations), /nome\(s\) do texto não atribuído\(s\).*Guard Jang/);
});

test('p58_12: personagens só mencionados no texto são removidos; os nomes ficam declarados', async () => {
  const { result } = run(analysis(['GUARD JANG...', 'PLEASE TAKE CARE OF MY YEO WOON.', 'LADY HWA, PLEASE PROTECT HIM FROM HEAVEN SO THAT HE CAN SURVIVE AND HAVE ANOTHER MEAL...'], [
    { name: 'Guard Jang', basis: 'observed', evidence: 'The character is addressed by name in the dialogue bubble.', confidence: 0.9 },
    { name: 'Lady Hwa', basis: 'observed', evidence: 'Woman lying in bed with long dark hair and a weary expression.', confidence: 0.85 },
    { name: 'Yeo Woon', basis: 'observed', evidence: 'He is mentioned by name in the dialogue bubble.', confidence: 0.8 },
  ]));
  const { entities, limitations } = await result;
  assert.deepEqual(entities.map((entity) => entity.name), ['personagem não identificado'], 'only the visually evidenced woman remains, unnamed');
  assert.match(entities[0]?.evidence ?? '', /lying in bed/);
  const disclosed = note(limitations);
  for (const name of ['Guard Jang', 'Lady Hwa', 'Yeo Woon']) assert.match(disclosed, new RegExp(name));
  assert.match(disclosed, /2 personagem\(ns\) só do texto removido\(s\)/);
});

test('p58_12 (run20): papel em minúscula vindo só do texto também é removido; com evidência visual fica', async () => {
  const { result } = run(analysis(['GUARD JANG... PLEASE TAKE CARE OF MY YEO WOON.', 'IT HAS ALREADY BEEN FIVE YEARS SINCE LADY HWA DIED FROM EATING FOOD CONTAINING POISON.'], [
    { name: 'woman lying in bed', basis: 'observed', evidence: 'visible face, hair tied back, hands clasped', confidence: 0.9 },
    { name: 'guard', basis: 'inferred', evidence: 'mentioned in dialogue as recipient of request', confidence: 0.8 },
    { name: 'guard (back view)', basis: 'observed', evidence: 'Figure seen from behind, wearing dark robe, hair tied in topknot, standing.', confidence: 0.85 },
  ]));
  const { entities, limitations } = await result;
  assert.deepEqual(entities.map((entity) => entity.name), ['woman lying in bed', 'guard (back view)']);
  assert.match(note(limitations), /1 personagem\(ns\) só do texto removido\(s\)/);
});

test('p59_0: "possibly Prince" vindo do balão perde o nome; vários renomeados são numerados', async () => {
  const { result } = run(analysis(['AAHH...!', 'PRINCE?!'], [
    { name: "Generic man (possibly 'Prince' based on dialogue)", basis: 'observed', evidence: 'Visual features include short dark hair, stubble, intense facial expression.', confidence: 0.85 },
    { name: 'Prince', basis: 'inferred', evidence: 'Someone off-panel is lying down, partially visible at the edge.', confidence: 0.5 },
  ]));
  const { entities } = await result;
  assert.deepEqual(entities.map((entity) => entity.name), ['personagem não identificado 1', 'personagem não identificado 2']);
});

test('rótulos visuais genéricos ficam intactos, mesmo com nomes no diálogo', async () => {
  const { result } = run(analysis(['PRINCE! ARE YOU AWAKE?!', 'IT SEEMS YOUR BODY IS...'], [
    { name: 'Homem de pé', basis: 'observed', evidence: 'Cabelo preso em coque, túnica escura, boca aberta.', confidence: 0.9 },
    { name: 'Generic Character', basis: 'observed', evidence: 'Short dark hair, lying down, looking up.', confidence: 0.85 },
    { name: 'Mão desconhecida', basis: 'observed', evidence: 'Mão estendida em primeiro plano.', confidence: 0.85 },
  ]));
  const { entities, limitations } = await result;
  assert.deepEqual(entities.map((entity) => entity.name), ['Homem de pé', 'Generic Character', 'Mão desconhecida']);
  assert.doesNotMatch(note(limitations), /nome/);
});

test('panelNames "model" preserva o comportamento anterior', async () => {
  const { result } = run(analysis(["GUARD JANG, I'M NEVER GOING TO CRY AGAIN."], [
    { name: 'Guard Jang', basis: 'observed', evidence: 'The character is addressed as Guard Jang in the dialogue bubble.', confidence: 0.9 },
  ]), { panelNames: 'model' });
  assert.deepEqual((await result).entities.map((entity) => entity.name), ['Guard Jang']);
});

test('prompt pede rótulo visual e não incentiva nomes', async () => {
  const { result, body } = run(analysis([], []));
  await result;
  const prompt = String((body()?.messages as Array<{ content: string }>)[0]?.content);
  assert.match(prompt, /rótulo visual/);
  assert.doesNotMatch(prompt, /Identifique nomes/);
  assert.ok(prompt.length < 2_000, `prompt length ${prompt.length}`);
});
