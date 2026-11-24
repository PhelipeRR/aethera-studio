import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOllamaLocalVlmProvider } from '../src/aethera/vision-providers.js';

// Fase 4B.7 (Adendo 16): qwen3.5 still turns drawn Korean SFX into dialogue ("폭음" for 푸욱,
// "음칫", "劍!") and omits balloons on tall multi-balloon panels (p58_12: 2 of 5). A probe
// showed a dedicated OCR-only call recovers them (5/5). Shapes below are the observed ones.

const tempDirs: string[] = [];
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Minimal PNG header: signature + IHDR with the given size (only the size is read). */
function png(width: number, height: number): Buffer {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'ascii');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return header;
}

function frame(width = 800, height = 300) {
  const dir = mkdtempSync(join(tmpdir(), 'ollama-sfx-ocr-'));
  tempDirs.push(dir);
  const path = join(dir, 'panel-001.png');
  writeFileSync(path, png(width, height));
  return [{ id: 'chapter-01-p058-12', hash: 'hash-058', path, atMs: 0 }];
}

function analysis(dialogue: Array<{ text: string; region: string }>) {
  return {
    nature: 'dialogue', natureConfidence: 0.9, description: 'Mulher acamada fala; depois um homem de costas.',
    frames: [{ observed: 'Mulher deitada; homem de pé de costas.', dialogue }],
    characters: [], actions: [], environment: null,
    overlays: { burnedText: false, watermark: false, webcam: false }, confidence: 0.9,
  };
}

const envelope = (content: unknown, input = 3142, output = 300) => new Response(JSON.stringify({ model: 'qwen3.5:4b-q4_K_M', done: true, prompt_eval_count: input, eval_count: output, message: { content: JSON.stringify(content) } }));

function script(responses: Array<() => Response>) {
  const bodies: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const next = responses.shift();
    if (!next) throw new Error('unexpected extra Ollama request');
    return next();
  }) as typeof fetch;
  return bodies;
}

const base = { baseUrl: 'http://ollama.fixture', model: 'qwen3.5:4b-q4_K_M', contextTokens: 4096, maxOutputTokens: 512, estimatedVisualTokensPerImage: 256 };
const note = (limitations: string[]) => limitations.find((item) => item.startsWith('Saída local normalizada')) ?? '';

test('adapter expõe OCR por bloco com schema compacto e telemetria própria', async () => {
  const bodies = script([() => envelope({ texts: [{ text: 'FALA LITERAL', region: 'top' }, { text: '폭음', region: 'bottom' }] }, 210, 31)]);
  const provider = createOllamaLocalVlmProvider({ ...base, sfxFilter: true });
  const result = await provider.analyzeOcr!({ frames: frame() });
  assert.deepEqual(result.lines, [{ text: 'FALA LITERAL', region: 'top' }]);
  assert.equal(result.sfxFiltered, 1);
  assert.deepEqual((bodies[0]!['format'] as { required: string[] }).required, ['texts']);
  assert.equal(provider.lastUsage?.()?.inputTokens, 210);
  assert.equal(provider.lastUsage?.()?.outputTokens, 31);
});

test('SFX curto só em Hangul/CJK sai do diálogo e fica declarado; texto latino fica', async () => {
  script([() => envelope(analysis([{ text: 'AAHH...!', region: 'top' }, { text: '음칫', region: 'center' }, { text: '폭음', region: 'bottom' }, { text: '劍!', region: 'bottom' }, { text: 'PRINCE?!', region: 'bottom' }]))]);
  const result = await createOllamaLocalVlmProvider(base).analyze!({ frames: frame() });
  assert.deepEqual(result.frames[0]?.visibleText.map((line) => line.text), ['AAHH...!', 'PRINCE?!']);
  assert.match(note(result.limitations), /3 SFX.*não transcrito/);
  assert.match(note(result.limitations), /음칫/);
});

test('frase longa em Hangul não é tratada como SFX; o filtro pode ser desligado para obras não traduzidas', async () => {
  script([() => envelope(analysis([{ text: '왕자님, 정신이 드셨습니까?', region: 'top' }, { text: '폭음', region: 'bottom' }]))]);
  const kept = await createOllamaLocalVlmProvider(base).analyze!({ frames: frame() });
  assert.deepEqual(kept.frames[0]?.visibleText.map((line) => line.text), ['왕자님, 정신이 드셨습니까?']);

  script([() => envelope(analysis([{ text: '폭음', region: 'bottom' }]))]);
  const raw = await createOllamaLocalVlmProvider({ ...base, sfxFilter: false }).analyze!({ frames: frame() });
  assert.deepEqual(raw.frames[0]?.visibleText.map((line) => line.text), ['폭음']);
});

test('ocrPass padrão é off: painel alto continua com uma única chamada', async () => {
  const bodies = script([() => envelope(analysis([{ text: 'GUARD JANG...', region: 'top' }]))]);
  await createOllamaLocalVlmProvider(base).analyze!({ frames: frame(800, 3587) });
  assert.equal(bodies.length, 1);
});

test('ocrPass "tall": painel alto ganha uma chamada só de OCR que substitui um diálogo incompleto', async () => {
  const combined = analysis([{ text: 'GUARD JANG...', region: 'top' }, { text: 'PLEASE TAKE CARE OF MY YEO WOON.', region: 'bottom' }]);
  const ocr = { texts: [
    { text: 'GUARD\nJANG...PLEASE TAKE CARE OF MY YEO WOON.', region: 'top' },
    { text: 'IT HAS ALREADY BEEN FIVE YEARS SINCE LADY HWA DIED FROM EATING FOOD CONTAINING POISON.', region: 'center' },
    { text: 'THE YOUNG PRINCE CHEON IS NOW ENTERING THE ACADEMY TODAY.', region: 'bottom' },
    { text: '흑', region: 'bottom' },
    { text: 'WHY', region: 'bottom' },
  ] };
  const bodies = script([() => envelope(combined, 3142, 300), () => envelope(ocr, 2926, 136)]);
  const provider = createOllamaLocalVlmProvider({ ...base, ocrPass: 'tall' });
  const result = await provider.analyze!({ frames: frame(800, 3587) });

  assert.equal(bodies.length, 2);
  const ocrBody = bodies[1]!;
  assert.match(String((ocrBody['messages'] as Array<{ content: string }>)[0]?.content), /Transcreva/);
  assert.deepEqual((ocrBody['messages'] as Array<{ images: string[] }>)[0]?.images, (bodies[0]!['messages'] as Array<{ images: string[] }>)[0]?.images);
  assert.deepEqual(((ocrBody['format'] as { required: string[] }).required), ['texts']);
  assert.equal(ocrBody['think'], false);
  assert.deepEqual(result.frames[0]?.visibleText.map((line) => line.text), [
    'GUARD JANG...PLEASE TAKE CARE OF MY YEO WOON.',
    'IT HAS ALREADY BEEN FIVE YEARS SINCE LADY HWA DIED FROM EATING FOOD CONTAINING POISON.',
    'THE YOUNG PRINCE CHEON IS NOW ENTERING THE ACADEMY TODAY.',
    'WHY',
  ], 'three-letter lines survive; only "…"/"..." placeholders and SFX are dropped');
  assert.match(note(result.limitations), /OCR dedicado: 4 texto\(s\) substituem 2; 1 SFX fora/);
  assert.equal(provider.lastUsage?.()?.inputTokens, 3142 + 2926, 'usage covers both calls');
  assert.equal(provider.lastUsage?.()?.outputTokens, 300 + 136);
});

test('ocrPass "tall" não chama OCR em painel largo', async () => {
  const bodies = script([() => envelope(analysis([{ text: 'PRINCE! ARE YOU AWAKE?!', region: 'top' }]), 841, 300)]);
  await createOllamaLocalVlmProvider({ ...base, ocrPass: 'tall' }).analyze!({ frames: frame(800, 650) });
  assert.equal(bodies.length, 1);
});

test('OCR com menos texto que a análise mantém o diálogo da análise', async () => {
  const combined = analysis([{ text: 'GUARD JANG, I\'M NEVER GOING TO CRY AGAIN.', region: 'top' }, { text: 'NEVER.', region: 'bottom' }]);
  script([() => envelope(combined), () => envelope({ texts: [{ text: 'NEVER.', region: 'bottom' }] })]);
  const result = await createOllamaLocalVlmProvider({ ...base, ocrPass: 'always' }).analyze!({ frames: frame() });
  assert.deepEqual(result.frames[0]?.visibleText.map((line) => line.text), ['GUARD JANG, I\'M NEVER GOING TO CRY AGAIN.', 'NEVER.']);
  assert.match(note(result.limitations), /OCR dedicado.*mantido/);
});

test('falha do OCR dedicado não derruba a análise e fica declarada', async () => {
  script([
    () => envelope(analysis([{ text: 'GUARD JANG...', region: 'top' }])),
    () => new Response('{"error":"prediction aborted, token repeat limit reached"}', { status: 500 }),
  ]);
  const result = await createOllamaLocalVlmProvider({ ...base, ocrPass: 'tall' }).analyze!({ frames: frame(800, 3587) });
  assert.deepEqual(result.frames[0]?.visibleText.map((line) => line.text), ['GUARD JANG...']);
  assert.match(note(result.limitations), /OCR dedicado falhou.*OLLAMA_RUNTIME_REPETITION_ABORTED/);
});
