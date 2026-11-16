/**
 * CF-0 / CF-1 — banner NextWorth: baseline do fluxo atual e comparação após as correções da CF-1.
 *
 * Uso:
 *   npx tsx scripts/cf-banner-acceptance.ts baseline   # CF-0: reproduz o fluxo atual + sondas H1/C2
 *   npx tsx scripts/cf-banner-acceptance.ts cf1        # CF-1: fluxo novo (receita visual + tratamento de fundo)
 *
 * Saída: artifacts/cf-banner/<modo>/ (PNGs completos ignorados pelo git, prévias JPG + report.json + report.md).
 * Não é teste de CI: precisa de GPU/Python com o worker do Creative Studio.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import sharp from 'sharp';
import {
  AssetIngestionService,
  BrandKitManager,
  CompositionPlanner,
  CreativeOrchestrator,
  QualityGateService,
  SharpSvgCompositionEngine,
  type CreativeProjectDocument,
  type ManagedAssetRef,
} from '../packages/creative-studio/src/index.js';
import * as creativeStudio from '../packages/creative-studio/src/index.js';
import { LocalPythonAiAdapter, ProviderChainImageAdapter } from '../packages/creative-studio/src/local-ai-adapter.js';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MODE = (process.argv[2] ?? 'baseline') as 'baseline' | 'cf1';
const OUT = join(ROOT, 'artifacts', 'cf-banner', MODE);
mkdirSync(OUT, { recursive: true });

const SCENARIO_PROMPT =
  'Crie um banner geek cinematográfico para o canal NextWorth, com universo de animes e games, personagens originais, ' +
  'efeitos de energia, cenários futuristas, iluminação dramática e identidade visual profissional.';
const HEADLINE = 'NEXTWORTH';
const CLIP_POSITIVES = [
  'anime and video game characters with glowing energy effects in a futuristic city',
  'cinematic sci-fi fantasy artwork with dramatic lighting and characters',
];
const CLIP_NEGATIVES = [
  'plain dark gradient background',
  'empty background with a single word of text',
  'blurry dark texture',
];

const WORKER = join(ROOT, 'packages', 'creative-studio', 'scripts', 'vision_worker.py');
const PYTHON = process.env['NB_PYTHON'] ?? 'python';

/** Samples nvidia-smi while `run` executes and returns the peak used VRAM (MiB). */
async function withVramPeak<T>(run: () => Promise<T>): Promise<{ result: T; peakMiB: number | null; baseMiB: number | null; ms: number }> {
  const read = async (): Promise<number | null> => {
    try {
      const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits']);
      return Number.parseInt(stdout.trim().split(/\r?\n/)[0] ?? '', 10) || null;
    } catch {
      return null;
    }
  };
  const baseMiB = await read();
  let peak = baseMiB;
  let stop = false;
  const poller = (async () => {
    while (!stop) {
      const v = await read();
      if (v !== null && (peak === null || v > peak)) peak = v;
      await new Promise((r) => setTimeout(r, 400));
    }
  })();
  const started = Date.now();
  try {
    const result = await run();
    return { result, peakMiB: peak, baseMiB, ms: Date.now() - started };
  } finally {
    stop = true;
    await poller;
  }
}

/** Edge energy (mean |laplacian|) and luminance spread: low values = flat/empty art. */
async function artDetail(buf: Buffer): Promise<{ edgeEnergy: number; lumaStdev: number }> {
  const base = sharp(buf).resize(640, 360, { fit: 'fill' }).greyscale();
  const lap = await base
    .clone()
    .convolve({ width: 3, height: 3, kernel: [-1, -1, -1, -1, 8, -1, -1, -1, -1], scale: 1, offset: 128 })
    .raw()
    .toBuffer();
  let sum = 0;
  for (const v of lap) sum += Math.abs(v - 128);
  const stats = await base.clone().stats();
  return {
    edgeEnergy: Number((sum / lap.length).toFixed(2)),
    lumaStdev: Number((stats.channels[0]?.stdev ?? 0).toFixed(2)),
  };
}

function withoutText(doc: CreativeProjectDocument): CreativeProjectDocument {
  return { ...doc, layers: doc.layers.map((l) => (l.type === 'text' ? { ...l, visible: false } : l)) };
}

async function savePreview(name: string, buf: Buffer): Promise<string> {
  writeFileSync(join(OUT, `${name}.png`), buf);
  const preview = `${name}.jpg`;
  await sharp(buf).resize({ width: 1280, withoutEnlargement: true }).jpeg({ quality: 82 }).toFile(join(OUT, preview));
  return preview;
}

interface Row {
  id: string;
  description: string;
  preview: string;
  ms?: number;
  vramBaseMiB?: number | null;
  vramPeakMiB?: number | null;
  edgeEnergy: number;
  lumaStdev: number;
  clipPositive?: number;
  clipNegative?: number;
  clipOffTopic?: boolean;
  gateOverall?: number;
  gatePassed?: boolean;
  notes?: string;
}

async function main(): Promise<void> {
  const storageRoot = mkdtempSync(join(tmpdir(), 'cf-banner-'));
  const local = new LocalPythonAiAdapter();
  const adapter = new ProviderChainImageAdapter([local]);
  const ingestion = new AssetIngestionService({ storageRoot });
  const engine = new SharpSvgCompositionEngine(ingestion, adapter);
  const gate = new QualityGateService(engine);
  const orchestrator = new CreativeOrchestrator([], new CompositionPlanner(), gate);
  const brandKits = new BrandKitManager();
  const kit = brandKits.create({ channelName: 'NextWorth', niche: 'Animes & Games' });
  const rows: Row[] = [];
  const aiAvailable = await adapter.isAvailable();

  const clip = async (buf: Buffer) => {
    if (!aiAvailable) return {};
    const r = await adapter.evaluateImageSemantics({
      imageBuffer: buf,
      positiveConcepts: CLIP_POSITIVES,
      negativeConcepts: CLIP_NEGATIVES,
    });
    return {
      clipPositive: Number(r.positiveScore.toFixed(3)),
      clipNegative: Number(r.negativeScore.toFixed(3)),
      clipOffTopic: r.isOffTopic,
    };
  };

  const finalRow = async (id: string, description: string, doc: CreativeProjectDocument, extra: Partial<Row> = {}) => {
    const full = await engine.renderDocumentToBuffer(doc, 'png');
    const artOnly = await engine.renderDocumentToBuffer(withoutText(doc), 'png');
    const audit = await gate.auditProject(doc, { brandKit: kit, renderedBuffer: full });
    rows.push({
      id,
      description,
      preview: await savePreview(id, full),
      ...(await artDetail(artOnly)),
      ...(await clip(full)),
      gateOverall: audit.scorecard.overall,
      gatePassed: audit.passed,
      ...extra,
    });
    writeFileSync(join(OUT, `${id}.document.json`), JSON.stringify(doc, null, 2));
  };

  // C1 — what the user gets when the AI is unavailable/disabled: palette gradient + particles + title.
  {
    const res = await orchestrator.orchestrateCreation({ artType: 'banner', prompt: SCENARIO_PROMPT, headline: HEADLINE, brandKit: kit });
    await finalRow('no-ai-fallback', 'Sem IA (indisponível ou desmarcada): fallback atual', res.document);
  }

  if (!aiAvailable) {
    writeReport(rows, { aiAvailable });
    return;
  }

  if (MODE === 'baseline') {
    // Exact reproduction of createFromPromptImpl: raw pt-BR prompt, 1024×576, no seed, then planner.
    const gen = await withVramPeak(() => adapter.generateImage({ prompt: SCENARIO_PROMPT, width: 1024, height: 576 }));
    const raw = gen.result;
    const rawDetail = await artDetail(raw);
    rows.push({
      id: 'current-raw-ai',
      description: 'Fluxo atual: imagem crua do SDXL-Turbo (prompt pt-BR, 1024×576, 3 passos, sem seed)',
      preview: await savePreview('current-raw-ai', raw),
      ms: gen.ms,
      vramBaseMiB: gen.baseMiB,
      vramPeakMiB: gen.peakMiB,
      ...rawDetail,
      ...(await clip(raw)),
    });
    const asset = await ingestion.ingestBuffer({ buffer: raw, kind: 'image', extension: 'png', originalName: 'current.png' });
    const res = await orchestrator.orchestrateCreation({
      artType: 'banner',
      prompt: SCENARIO_PROMPT,
      headline: HEADLINE,
      brandKit: kit,
      backgroundAsset: asset,
    });
    await finalRow('current-final', 'Fluxo atual: banner final (fundo esticado 2,5× + blur 5 + brilho 0,74 + vinheta 0,58)', res.document);

    // Probes for C2 (pt-BR vs English) and H1 (resolution), fixed seeds, straight to the worker.
    const EN =
      'epic wide cinematic key art, original anime and video game heroes in dynamic poses on the left and right sides, ' +
      'glowing blue and magenta energy blasts, futuristic neon megacity at night in the distance, volumetric god rays, ' +
      'dramatic rim lighting, deep perspective, dark calm empty center area, highly detailed digital painting';
    const probes: Array<{ id: string; prompt: string; w: number; h: number; seed: number; desc: string }> = [];
    for (const seed of [11, 22]) {
      probes.push({ id: `probe-pt-1024-s${seed}`, prompt: SCENARIO_PROMPT, w: 1024, h: 576, seed, desc: `Sonda C2: prompt pt-BR, 1024×576, seed ${seed}` });
      probes.push({ id: `probe-en-1024-s${seed}`, prompt: EN, w: 1024, h: 576, seed, desc: `Sonda C2: prompt EN estruturado, 1024×576, seed ${seed}` });
      probes.push({ id: `probe-en-768-s${seed}`, prompt: EN, w: 768, h: 432, seed, desc: `Sonda H1: prompt EN, 768×432, seed ${seed}` });
    }
    for (const p of probes) {
      const dir = mkdtempSync(join(tmpdir(), 'cf-probe-'));
      const out = join(dir, 'out.png');
      try {
        const run = await withVramPeak(() =>
          execFileAsync(
            PYTHON,
            [WORKER, 'generate', '--prompt', p.prompt, '--output', out, '--width', String(p.w), '--height', String(p.h), '--steps', '3', '--seed', String(p.seed)],
            { timeout: 240_000 },
          ),
        );
        const buf = readFileSync(out);
        rows.push({
          id: p.id,
          description: p.desc,
          preview: await savePreview(p.id, buf),
          ms: run.ms,
          vramBaseMiB: run.baseMiB,
          vramPeakMiB: run.peakMiB,
          ...(await artDetail(buf)),
          ...(await clip(buf)),
        });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  } else {
    // CF-1 flow: same entry point the desktop service uses.
    for (const seed of [11, 22]) {
      const gen = await withVramPeak(() =>
        creativeStudio.generateAiBackground({
          artType: 'banner',
          prompt: SCENARIO_PROMPT,
          headline: HEADLINE,
          brandKit: kit,
          imageAdapter: adapter,
          ingestion,
          seed,
        }),
      );
      const report = gen.result.report;
      const asset = gen.result.asset as ManagedAssetRef;
      const rawBuf = readFileSync(ingestion.resolvePortablePath(asset.relativePath));
      rows.push({
        id: `cf1-raw-s${seed}`,
        description: `CF-1: imagem crua (receita ${report.recipe?.preset}, ${report.recipe?.width}×${report.recipe?.height}, seed ${seed})`,
        preview: await savePreview(`cf1-raw-s${seed}`, rawBuf),
        ms: gen.ms,
        vramBaseMiB: gen.baseMiB,
        vramPeakMiB: gen.peakMiB,
        ...(await artDetail(rawBuf)),
        ...(await clip(rawBuf)),
        notes: report.recipe?.positivePrompt,
      });
      const res = await orchestrator.orchestrateCreation({
        artType: 'banner',
        prompt: SCENARIO_PROMPT,
        headline: HEADLINE,
        brandKit: kit,
        backgroundAsset: asset,
        backgroundOrigin: 'ai_composed',
      });
      await finalRow(`cf1-final-s${seed}`, `CF-1: banner final (fundo composto sem degradação + scrim local), seed ${seed}`, res.document);
    }
  }

  writeReport(rows, { aiAvailable });
  rmSync(storageRoot, { recursive: true, force: true });
}

function writeReport(rows: Row[], meta: { aiAvailable: boolean }): void {
  const report = { mode: MODE, generatedAt: new Date().toISOString(), scenario: SCENARIO_PROMPT, headline: HEADLINE, ...meta, rows };
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  const lines = [
    `# Banner NextWorth — ${MODE === 'baseline' ? 'CF-0 baseline' : 'CF-1'}`,
    '',
    `Gerado em ${report.generatedAt}. IA local disponível: ${meta.aiAvailable ? 'sim' : 'não'}.`,
    '',
    '`edge` = energia de bordas da arte sem texto (no banner final inclui as partículas da camada VFX, que inflam o valor;',
    'compare `edge` só entre imagens cruas). `luma σ` = dispersão de luminância (baixo = fundo liso/vazio).',
    'CLIP: probabilidade do melhor conceito positivo × melhor distrator (fundo vazio/gradiente).',
    '',
    '| id | descrição | tempo (s) | VRAM base→pico (MiB) | edge | luma σ | CLIP +/− | gate | prévia |',
    '|---|---|---|---|---|---|---|---|---|',
    ...rows.map(
      (r) =>
        `| ${r.id} | ${r.description} | ${r.ms !== undefined ? (r.ms / 1000).toFixed(1) : '—'} | ${r.vramBaseMiB ?? '—'}→${r.vramPeakMiB ?? '—'} | ${r.edgeEnergy} | ${r.lumaStdev} | ${r.clipPositive ?? '—'}/${r.clipNegative ?? '—'}${r.clipOffTopic ? ' (off)' : ''} | ${r.gateOverall !== undefined ? `${r.gateOverall}${r.gatePassed ? ' ✓' : ' ✗'}` : '—'} | ![](${r.preview}) |`,
    ),
    '',
  ];
  writeFileSync(join(OUT, 'report.md'), lines.join('\n'));
  console.log(lines.join('\n'));
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
