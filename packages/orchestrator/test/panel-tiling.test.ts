import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SegmentAnalysis } from '@neuralbridge/shared';
import type { VisualAnalysisProvider, VisionFrame } from '../src/aethera/vision-router.js';
import {
  createTiledPanelProvider,
  estimateTextEvidence,
  estimateImageTokens,
  maxTileHeightForContext,
  mergePanelOcrLines,
  mergeTileAnalyses,
  planPanelTiles,
  type PanelImageBackend,
  type PanelTile,
} from '../src/aethera/panel-tiling.js';

// Fase 4B.9: qwen3.5 counts ~ceil(w/32)·ceil(h/32) image tokens; p28_1 (800×8781) needs 4369
// input tokens and Ollama rejects it at num_ctx 4096 (HTTP 400). Tall panels are analysed as
// vertical tiles sized by the token budget, cut at blank gutters when one exists.

const tempDirs: string[] = [];
afterEach(() => { for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'panel-tiling-'));
  tempDirs.push(dir);
  return dir;
}

/** Synthetic grayscale panel: textured art everywhere except the given blank bands [y0,y1). */
function rows(width: number, height: number, blank: Array<[number, number]> = []): Uint8Array {
  const data = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const isBlank = blank.some(([a, b]) => y >= a && y < b);
    for (let x = 0; x < width; x += 1) data[y * width + x] = isBlank ? 250 : (x * 37 + y * 11) % 200;
  }
  return data;
}

const budget = { contextTokens: 4096, promptTokens: 420, outputReserveTokens: 1200, safetyTokens: 128, patchPx: 32 };

test('orçamento: tokens da imagem vêm de patches 32px, não só de pixels; p28_1 inteiro não cabe em 4096', () => {
  assert.equal(estimateImageTokens(800, 1645), 25 * 52, 'p0_0 measured 1615 input = 1300 image + ~316 prompt');
  assert.equal(estimateImageTokens(800, 2660), 25 * 84, 'p71_0 measured 2416 input');
  const fullP28 = estimateImageTokens(800, 8781);
  assert.ok(fullP28 + budget.promptTokens + budget.outputReserveTokens > budget.contextTokens);
  // (4096 − 420 − 1200 − 128) = 2348 image tokens → 2348/25 = 93 patch rows → 2976 px.
  assert.equal(maxTileHeightForContext({ width: 800, ...budget }), 2976);
  // A larger prompt or output reserve shrinks the tile: the budget is in tokens, not pixels.
  assert.equal(maxTileHeightForContext({ width: 800, ...budget, outputReserveTokens: 1600 }), 2464);
  assert.throws(() => maxTileHeightForContext({ width: 800, ...budget, contextTokens: 1700 }), /RECAP_TILE_CONTEXT_TOO_SMALL/);
});

function assertCoverage(tiles: readonly PanelTile[], height: number, maxTile: number) {
  assert.equal(tiles[0]?.y0, 0);
  assert.equal(tiles.at(-1)?.y1, height);
  tiles.forEach((tile, index) => {
    assert.ok(tile.y1 - tile.y0 <= maxTile, `tile ${index} ${tile.y1 - tile.y0} <= ${maxTile}`);
    assert.equal(tile.index, index);
    const next = tiles[index + 1];
    if (next) assert.ok(next.y0 <= tile.y1, `no gap between tile ${index} and ${index + 1}`);
  });
}

test('cortes em calhas brancas: sem sobreposição, sem lacunas, ordem de leitura preservada', () => {
  const height = 4000;
  const plan = planPanelTiles({ width: 100, height, gray: rows(100, height, [[1180, 1220], [2390, 2420], [3300, 3330]]), maxTileHeight: 1600, overlapPx: 160 });
  assertCoverage(plan.tiles, height, 1600);
  // Latest gutter inside each window (fewest tiles); the 3300 gutter is not needed.
  assert.deepEqual(plan.tiles.map((tile) => [tile.y0, tile.y1]), [[0, 1200], [1200, 2405], [2405, 4000]]);
  // Every cut sits inside a blank band; a gutter cut needs no overlap.
  for (const tile of plan.tiles.slice(0, -1)) {
    assert.equal(tile.cutBelow, 'gutter');
    const next = plan.tiles[tile.index + 1]!;
    assert.equal(next.y0, tile.y1, 'gutter cut: next tile starts where this one ends');
    assert.ok([[1180, 1220], [2390, 2420], [3300, 3330]].some(([a, b]) => tile.y1 >= a! && tile.y1 < b!), `cut ${tile.y1} inside a gutter`);
  }
  assert.equal(plan.uncertainCuts, 0);
});

test('sem calha: corte incerto mantém a sobreposição configurada e é sinalizado', () => {
  const height = 5000;
  const plan = planPanelTiles({ width: 100, height, gray: rows(100, height), maxTileHeight: 1600, overlapPx: 160 });
  assertCoverage(plan.tiles, height, 1600);
  assert.ok(plan.tiles.length >= 4);
  for (const tile of plan.tiles.slice(0, -1)) {
    assert.equal(tile.cutBelow, 'uncertain');
    assert.equal(tile.y1 - plan.tiles[tile.index + 1]!.y0, 160, 'overlap preserved across an uncertain cut');
  }
  assert.equal(plan.uncertainCuts, plan.tiles.length - 1);
});

test('corte é determinístico e reconstrói o painel inteiro', () => {
  const height = 8781;
  const gray = rows(80, height, [[1200, 1212], [5100, 5140]]);
  const a = planPanelTiles({ width: 80, height, gray, maxTileHeight: 1600, overlapPx: 120 });
  const b = planPanelTiles({ width: 80, height, gray, maxTileHeight: 1600, overlapPx: 120 });
  assert.deepEqual(a, b);
  assertCoverage(a.tiles, height, 1600);
  const covered = new Uint8Array(height);
  for (const tile of a.tiles) covered.fill(1, tile.y0, tile.y1);
  assert.equal(covered.indexOf(0), -1, 'every row belongs to at least one tile');
  assert.ok(a.tiles.some((tile) => tile.cutBelow === 'gutter') && a.tiles.some((tile) => tile.cutBelow === 'uncertain'));
});

test('p58_12: faixa preta que continua em degradê além da janela ainda é calha (corte dentro dela)', () => {
  // Observed live: black rows 1405–1620 then a smooth vertical gradient (row sd ≤ 0.5) to ~1900;
  // the run's centre lies past the 1600-px window, which once made this cut "uncertain".
  const height = 3587;
  const gray = rows(100, height, [[1405, 1900]]);
  const plan = planPanelTiles({ width: 100, height, gray, maxTileHeight: 1600, overlapPx: 160 });
  assert.equal(plan.tiles[0]?.cutBelow, 'gutter');
  assert.ok(plan.tiles[0]!.y1 >= 1405 && plan.tiles[0]!.y1 <= 1600, `cut ${plan.tiles[0]!.y1} inside the band and the window`);
});

test('painel que cabe num bloco não é cortado', () => {
  const plan = planPanelTiles({ width: 100, height: 1500, gray: rows(100, 1500), maxTileHeight: 1600, overlapPx: 160 });
  assert.deepEqual(plan.tiles.map((tile) => [tile.y0, tile.y1, tile.cutBelow]), [[0, 1500, 'end']]);
});

type Lines = string[];
function tileAnalysis(lines: Lines, extra: Partial<SegmentAnalysis> = {}): SegmentAnalysis {
  return {
    schemaVersion: 1, nature: 'dialogue', natureConfidence: 0.9, description: 'Bloco com personagem e balões.',
    frames: [{ atMs: 0, observed: 'Personagem e balões.', visibleText: lines.map((text) => ({ text, region: 'top' as const })) }],
    entities: [], actions: [], environment: null,
    overlays: { burnedText: false, watermark: false, webcam: false }, limitations: [], confidence: 0.9, ...extra,
  };
}
const tile = (index: number, y0: number, y1: number, cutBelow: PanelTile['cutBelow']): PanelTile => ({ index, y0, y1, cutBelow });

test('mesclagem: falas repetidas na sobreposição saem; a mais longa fica; nada é inventado', () => {
  const tiles = [tile(0, 0, 1600, 'uncertain'), tile(1, 1440, 3000, 'gutter'), tile(2, 3000, 4000, 'end')];
  const inputs = [
    tileAnalysis(['GUARD JANG...', 'PLEASE TAKE CARE']),
    tileAnalysis(['PLEASE TAKE CARE OF MY YEO WOON.', 'IT HAS ALREADY BEEN FIVE YEARS.', 'NEVER.']),
    tileAnalysis(['NEVER.', 'THE YOUNG PRINCE CHEON IS NOW ENTERING THE ACADEMY TODAY.']),
  ];
  const merged = mergeTileAnalyses({ tiles, analyses: inputs, panelHeight: 4000, atMs: 0 });
  const texts = merged.analysis.frames.flatMap((frame) => frame.visibleText.map((line) => line.text));
  assert.deepEqual(texts, [
    'GUARD JANG...',
    'PLEASE TAKE CARE OF MY YEO WOON.',
    'IT HAS ALREADY BEEN FIVE YEARS.',
    'NEVER.',
    'NEVER.',
    'THE YOUNG PRINCE CHEON IS NOW ENTERING THE ACADEMY TODAY.',
  ], 'overlap duplicate collapses into the longer reading; a repeat across a clean gutter is a real second balloon');
  const all = new Set(inputs.flatMap((input) => input.frames[0]!.visibleText.map((line) => line.text)));
  for (const text of texts) assert.ok(all.has(text), `"${text}" was read by some tile`);
  assert.equal(merged.dedupedLines, 1);
  assert.equal(merged.analysis.frames.length, 3, 'one frame per tile, in reading order');
  assert.match(merged.analysis.frames[1]!.observed, /^\[bloco 2\/3 y=1440–3000\]/);
  assert.match(merged.analysis.limitations[0]!, /3 blocos.*1 corte incerto.*1 fala\(s\) duplicada\(s\)/);
});

test('mesclagem: observações repetidas saem, personagens sem nome não colapsam, natureza e confiança conservadoras', () => {
  const tiles = [tile(0, 0, 1600, 'uncertain'), tile(1, 1440, 3000, 'end')];
  const unnamed = (evidence: string) => ({ name: 'personagem não identificado', type: 'character' as const, basis: 'observed' as const, evidence, confidence: 0.9 });
  const merged = mergeTileAnalyses({
    tiles, panelHeight: 3000, atMs: 0,
    analyses: [
      tileAnalysis([], { nature: 'dialogue', confidence: 0.9, entities: [unnamed('menino chorando'), { name: 'homem de coque', type: 'character', basis: 'observed', evidence: 'coque', confidence: 0.8 }], actions: [{ description: 'Menino chora.', basis: 'observed', confidence: 0.9 }], limitations: ['Saída local normalizada: 1 SFX (Hangul/CJK curto) não transcrito(s), fora do diálogo: 흑'] }),
      tileAnalysis([], { nature: 'portrait', confidence: 0.6, entities: [unnamed('mulher acamada'), { name: 'Homem de coque', type: 'character', basis: 'observed', evidence: 'coque visto de costas', confidence: 0.85 }], actions: [{ description: 'menino chora', basis: 'observed', confidence: 0.8 }], environment: { description: 'Quarto', basis: 'observed', confidence: 0.7 } }),
    ],
  });
  const { analysis } = merged;
  assert.deepEqual(analysis.entities.map((entity) => entity.name), ['personagem não identificado (bloco 1)', 'homem de coque', 'personagem não identificado (bloco 2)']);
  assert.equal(analysis.actions.length, 1);
  assert.equal(analysis.environment?.description, 'Quarto');
  assert.equal(analysis.confidence, 0.6);
  assert.ok(analysis.limitations.some((item) => /SFX/.test(item)), 'per-tile SFX disclosure is kept');
});

test('OCR por evidência não depende apenas da proporção e não substitui fala não correspondente', () => {
  const evidence = estimateTextEvidence(new Uint8Array([255, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255, 0]), 6, 2);
  assert.ok(evidence.score > 0, 'densidade/linhas horizontais fornecem um sinal determinístico');
  const merged = mergePanelOcrLines(
    [{ text: 'FALA CORRETA', region: 'top' }],
    { lines: [{ text: 'OUTRA LINHA LONGA QUE NÃO CORRESPONDE', region: 'bottom' }], sfxFiltered: 0 },
  );
  assert.deepEqual(merged.lines.map((line) => line.text), ['FALA CORRETA', 'OUTRA LINHA LONGA QUE NÃO CORRESPONDE']);
  assert.equal(merged.added, 1);
});

// ---------------------------------------------------------------- provider wrapper

/** Fake image backend: the tile file records its own coordinates. */
function backend(width: number, height: number, gray: Uint8Array, calls: string[] = []): PanelImageBackend {
  return {
    size: async () => ({ width, height }),
    grayRows: async () => ({ width, height, data: gray }),
    crop: async (_source, y0, y1, out) => { calls.push(`crop ${y0}-${y1}`); writeFileSync(out, `tile ${y0}-${y1}`); },
  };
}

function panel(dir: string, content = 'original panel bytes') {
  const path = join(dir, 'p28_1.png');
  writeFileSync(path, content);
  return { id: 'nanomachine_p28_1', hash: 'hash-p28', path, atMs: 0 } satisfies VisionFrame;
}

/** Fake base provider (the Ollama provider in production): answers per tile from a script. */
function base(script: (coords: string, call: number) => SegmentAnalysis | Error, seen: string[] = []) {
  let calls = 0;
  let usage = { inputTokens: 0, outputTokens: 0 };
  const provider: VisualAnalysisProvider = {
    id: 'local-vlm', model: 'qwen3.5:4b-q4_K_M', capabilities: ['analyze'], supportsMultimodal: true, limits: { maxImagesPerCall: 1 },
    detect: async () => ({ available: true }),
    analyze: async ({ frames, signal }) => {
      if (signal?.aborted) throw new Error('cancelled: Ollama local VLM request interrupted.');
      const coords = readFileSync(frames[0]!.path, 'utf8').replace('tile ', '');
      seen.push(coords);
      calls += 1;
      usage = { inputTokens: 1000 + calls, outputTokens: 200 };
      const answer = script(coords, calls);
      if (answer instanceof Error) throw answer;
      return answer;
    },
    lastUsage: () => usage,
    lastReportedModel: () => 'qwen3.5:4b-q4_K_M',
  };
  return provider;
}

const ledgerLines = (path: string) => readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);

function setup(height = 5000) {
  const dir = tempDir();
  const crops: string[] = [];
  return {
    dir, crops, frame: panel(dir),
    cacheDir: join(dir, 'cache'), ledgerPath: join(dir, 'ledger.jsonl'),
    imageBackend: backend(800, height, rows(800, height, [[1500, 1530]]), crops),
  };
}

const options = (env: ReturnType<typeof setup>, provider: VisualAnalysisProvider) => ({
  base: provider, cacheDir: env.cacheDir, ledgerPath: env.ledgerPath, imageBackend: env.imageBackend,
  maxTileAspect: 2, overlapPx: 160, cacheVersion: 'prompt-v3+structured', ...budget,
});

test('provider: analisa cada bloco, preserva proveniência, registra cada chamada no ledger', async () => {
  const env = setup();
  const seen: string[] = [];
  const provider = createTiledPanelProvider(options(env, base((coords) => tileAnalysis([`LINE ${coords}`]), seen)));
  const result = await provider.analyze!({ frames: [env.frame] });

  const report = provider.lastTiling()!;
  assert.ok(report.tiles.length >= 3, 'tiles at most 1600 px tall (aspect 2 at width 800)');
  assert.deepEqual(seen, report.tiles.map((item) => `${item.y0}-${item.y1}`), 'tiles analysed in reading order');
  assert.equal(report.tiles[0]!.cutBelow, 'gutter');
  assert.equal(result.frames.length, report.tiles.length);
  assert.deepEqual(result.frames.map((frame) => frame.visibleText[0]?.text), seen.map((coords) => `LINE ${coords}`));
  assert.equal(readFileSync(env.frame.path, 'utf8'), 'original panel bytes', 'original untouched');

  const ledger = ledgerLines(env.ledgerPath);
  assert.equal(ledger.length, report.tiles.length);
  for (const [index, entry] of ledger.entries()) {
    assert.equal(entry['panelId'], 'nanomachine_p28_1');
    assert.equal(entry['tileIndex'], index);
    assert.equal(entry['cacheHit'], false);
    assert.equal(entry['status'], 'ok');
    assert.equal(entry['outputTokens'], 200);
    assert.equal(typeof entry['wallMs'], 'number');
    assert.equal(typeof entry['rssMb'], 'number');
    assert.equal(entry['model'], 'qwen3.5:4b-q4_K_M');
  }
  assert.equal(provider.lastUsage!()?.outputTokens, 200 * report.tiles.length, 'usage sums fresh calls');
  const manifest = JSON.parse(readFileSync(report.manifestPath, 'utf8')) as { tiles: Array<{ y0: number; lines: number }> };
  assert.equal(manifest.tiles.length, report.tiles.length);
});

test('provider: OCR seleciona blocos por evidência, registra a chamada e o checkpoint impede nova OCR', async () => {
  const env = setup();
  const seenOcr: string[] = [];
  const withEvidence = backend(800, 5000, rows(800, 5000, [[1500, 1530]]), env.crops);
  withEvidence.textEvidence = async (path) => ({ score: path.includes('0-') ? 0.9 : 0.05, inkDensity: 0.2, rowSignal: 0.2 });
  const firstBase = base((coords) => tileAnalysis(['FALA CORRETA']), []);
  firstBase.analyzeOcr = async ({ frames }) => { seenOcr.push(frames[0]!.id ?? ''); return { lines: [{ text: 'OCR NÃO CORRESPONDENTE MAIS LONGO', region: 'bottom' }], sfxFiltered: 1 }; };
  const first = createTiledPanelProvider({ ...options(env, firstBase), imageBackend: withEvidence, ocr: { enabled: true, maxCalls: 1, minScore: 0.22 } });
  const result = await first.analyze!({ frames: [env.frame] });
  assert.equal(seenOcr.length, 1, 'one evidence-selected block gets OCR');
  assert.ok(result.limitations.some((item) => /OCR por evidência/.test(item)));
  assert.ok(ledgerLines(env.ledgerPath).some((entry) => entry['kind'] === 'ocr' && entry['sfxFiltered'] === 1));

  const resumedBase = base(() => new Error('analysis cache miss'));
  resumedBase.analyzeOcr = async () => { throw new Error('OCR cache miss'); };
  const resumed = createTiledPanelProvider({ ...options(env, resumedBase), imageBackend: withEvidence, ocr: { enabled: true, maxCalls: 1, minScore: 0.22 } });
  const resumedResult = await resumed.analyze!({ frames: [env.frame] });
  assert.deepEqual(resumedResult, result, 'analysis and OCR merge are resumed from the tile checkpoint');
});

test('provider: painel baixo vai direto ao modelo base, sem recorte', async () => {
  const env = setup();
  env.imageBackend = backend(800, 1200, rows(800, 1200), env.crops);
  const seen: string[] = [];
  const direct = base(() => tileAnalysis(['ONE']), seen);
  direct.analyze = async () => tileAnalysis(['ONE']);
  const provider = createTiledPanelProvider(options(env, direct));
  const result = await provider.analyze!({ frames: [env.frame] });
  assert.deepEqual(result.frames[0]?.visibleText.map((line) => line.text), ['ONE']);
  assert.equal(env.crops.length, 0);
  assert.equal(provider.lastTiling(), null);
});

test('cache por bloco: segunda execução não repete inferência nem recorte', async () => {
  const env = setup();
  const seen: string[] = [];
  const first = await createTiledPanelProvider(options(env, base((coords) => tileAnalysis([`LINE ${coords}`]), seen))).analyze!({ frames: [env.frame] });
  const calls = seen.length;
  const crops = env.crops.length;
  const second = createTiledPanelProvider(options(env, base(() => new Error('must not be called'))));
  assert.deepEqual(await second.analyze!({ frames: [env.frame] }), first);
  assert.equal(env.crops.length, crops);
  const ledger = ledgerLines(env.ledgerPath).slice(calls);
  assert.ok(ledger.every((entry) => entry['cacheHit'] === true && entry['status'] === 'ok' && entry['inputTokens'] === 0));
  // A different prompt/config version invalidates the cache.
  const seen3: string[] = [];
  await createTiledPanelProvider({ ...options(env, base((coords) => tileAnalysis([`LINE ${coords}`]), seen3)), cacheVersion: 'prompt-v4' }).analyze!({ frames: [env.frame] });
  assert.equal(seen3.length, calls);
});

test('cancelamento: para entre blocos; o bloco concluído fica como checkpoint e não é refeito', async () => {
  const env = setup();
  const controller = new AbortController();
  const seen: string[] = [];
  const provider = createTiledPanelProvider(options(env, base((coords, call) => {
    if (call === 1) controller.abort();
    return tileAnalysis([`LINE ${coords}`]);
  }, seen)));
  await assert.rejects(provider.analyze!({ frames: [env.frame], signal: controller.signal }), /cancelled/);
  assert.equal(seen.length, 1, 'no tile starts after the abort');
  const ledger = ledgerLines(env.ledgerPath);
  assert.equal(ledger.at(-1)?.['status'], 'cancelled');

  const seenResume: string[] = [];
  const resumed = await createTiledPanelProvider(options(env, base((coords) => tileAnalysis([`LINE ${coords}`]), seenResume))).analyze!({ frames: [env.frame] });
  assert.ok(!seenResume.includes(seen[0]!), 'checkpointed tile reused');
  assert.equal(resumed.frames.length, seenResume.length + 1);
});

test('falha de um bloco: erro explícito com o bloco; os outros ficam em cache; nada é preenchido', async () => {
  const env = setup();
  const failing = Object.assign(new Error('OLLAMA_RUNTIME_REPETITION_ABORTED: loop'), { code: 'OLLAMA_RUNTIME_REPETITION_ABORTED' });
  const seen: string[] = [];
  const provider = createTiledPanelProvider(options(env, base((coords, call) => (call === 2 ? failing : tileAnalysis([`LINE ${coords}`])), seen)));
  await assert.rejects(provider.analyze!({ frames: [env.frame] }), (error: Error & { code?: string }) => {
    assert.equal(error.code, 'RECAP_TILE_ANALYSIS_FAILED');
    assert.match(error.message, /bloco 2\/\d+ y=\d+–\d+.*OLLAMA_RUNTIME_REPETITION_ABORTED/);
    return true;
  });
  const failed = ledgerLines(env.ledgerPath).find((entry) => entry['status'] === 'failed');
  assert.equal(failed?.['errorCode'], 'OLLAMA_RUNTIME_REPETITION_ABORTED');
  assert.ok(existsSync(env.cacheDir));
});

test('backend sharp real: lê linhas em cinza, recorta PNG nas coordenadas e não toca o original', async () => {
  const { createSharpPanelImageBackend } = await import('../src/aethera/panel-tiling.js');
  const sharp = (await import('sharp')).default;
  const dir = tempDir();
  const source = join(dir, 'tall.png');
  const width = 64;
  const height = 400;
  const raw = Buffer.from(rows(width, height, [[190, 210]]));
  await sharp(raw, { raw: { width, height, channels: 1 } }).png().toFile(source);
  const before = readFileSync(source);
  const images = createSharpPanelImageBackend();
  assert.deepEqual(await images.size(source), { width, height });
  const gray = await images.grayRows(source);
  assert.equal(gray.data.length, width * height);
  const plan = planPanelTiles({ width, height, gray: gray.data, maxTileHeight: 256, overlapPx: 32 });
  assert.deepEqual(plan.tiles.map((item) => [item.y0, item.y1, item.cutBelow]), [[0, 200, 'gutter'], [200, 400, 'end']]);
  const out = join(dir, 'tile.png');
  await images.crop(source, 200, 400, out);
  const meta = await sharp(out).metadata();
  assert.deepEqual([meta.width, meta.height], [width, 200]);
  assert.ok(readFileSync(source).equals(before));
});
