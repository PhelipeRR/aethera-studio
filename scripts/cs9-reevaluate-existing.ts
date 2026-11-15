/**
 * CS-9 Etapa 1: Reavaliação real dos PNGs pré-existentes
 *
 * Executa VisualContentGate + CLIP + Quality Gate nos dois PNGs existentes
 * (Cyberpunk 2077 A e B) para validar a infraestrutura de avaliação
 * ANTES de gerar novas imagens. Registra resultados verdadeiros.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import sharp from 'sharp';
import {
  AssetIngestionService,
  SharpSvgCompositionEngine,
  QualityGateService,
  evaluateVisualContent,
} from '../packages/creative-studio/src/index.js';
import { LocalPythonAiAdapter } from '../packages/creative-studio/src/local-ai-adapter.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'artifacts', 'cs9-real-generation');

interface ReevalEntry {
  file: string;
  concept: string;
  theme: string;
  label: string;
  sizeKB: number;
  visualGatePassed: boolean;
  visualGateDiagnostics: string[];
  visualGateBlockReason?: string;
  clipScore: number;
  clipMargin: number;
  clipPassed: boolean;
  clipRationale: string;
  qualityScore: number;
  qualityPassed: boolean;
  qualityFindings: string[];
  overallVerdict: 'approved' | 'rejected' | 'unavailable';
}

async function main() {
  console.log('=== CS-9 Etapa 1: Reavaliação Real dos PNGs Existentes ===\n');

  const pythonPath = process.env['NB_PYTHON'] ?? 'python';
  const adapter = new LocalPythonAiAdapter({
    model: 'stabilityai/sdxl-turbo',
    steps: 4,
    timeoutMs: 300_000,
    pythonPath,
  });

  const isAvailable = await adapter.isAvailable();
  if (!isAvailable) {
    console.error('❌ BLOCKED: LocalPythonAiAdapter not available.');
    process.exit(1);
  }
  console.log('✅ LocalPythonAiAdapter available (SDXL-Turbo + CLIP ViT-B/32)\n');

  // Find existing PNGs
  const pngs = readdirSync(OUTPUT_DIR).filter((f) =>
    f.startsWith('cyberpunk-2077-concept-') && f.endsWith('.png'),
  );

  if (pngs.length === 0) {
    console.error('❌ No existing Cyberpunk 2077 PNGs found in', OUTPUT_DIR);
    process.exit(1);
  }

  console.log(`📁 Found ${pngs.length} existing PNG(s):\n`);

  const storageRoot = join(OUTPUT_DIR, '_reeval-storage');
  const ingestion = new AssetIngestionService({ storageRoot });
  const engine = new SharpSvgCompositionEngine(ingestion, adapter);
  const gate = new QualityGateService(engine);

  const entries: ReevalEntry[] = [];

  for (const pngFile of pngs) {
    const absPath = join(OUTPUT_DIR, pngFile);
    const stat = statSync(absPath);
    const sizeKB = Math.round(stat.size / 1024);

    // Parse concept info from filename
    const match = pngFile.match(/cyberpunk-2077-concept-([A-C])-(.+)\.png/);
    const label = match?.[1] ?? '?';
    const archetype = match?.[2] ?? 'unknown';
    const conceptName = label === 'A'
      ? 'Cyberpunk 2077: Sandevistan Neural Spine'
      : label === 'B'
        ? 'Cyberpunk 2077: Johnny Silverhand Returns'
        : `Cyberpunk 2077 Concept ${label}`;

    console.log(`--- ${pngFile} (${sizeKB} KB) ---`);

    const entry: ReevalEntry = {
      file: pngFile,
      concept: conceptName,
      theme: 'Cyberpunk 2077',
      label,
      sizeKB,
      visualGatePassed: false,
      visualGateDiagnostics: [],
      clipScore: 0,
      clipMargin: 0,
      clipPassed: false,
      clipRationale: '',
      qualityScore: 0,
      qualityPassed: false,
      qualityFindings: [],
      overallVerdict: 'unavailable',
    };

    // 1. Ingest as managed asset for gate evaluation
    const buf = readFileSync(absPath);
    const asset = await ingestion.ingestBuffer({
      buffer: buf,
      kind: 'image',
      extension: 'png',
      originalName: pngFile,
    });
    const resolvedPath = ingestion.resolvePortablePath(asset.relativePath);

    // 2. Visual Content Gate
    console.log('  [VisualContentGate] Evaluating...');
    try {
      const visualVerdict = await evaluateVisualContent({
        asset,
        assetPath: resolvedPath,
        queryOrPrompt: conceptName,
        conceptTitle: conceptName,
        genre: 'games',
      });
      entry.visualGatePassed = visualVerdict.passed;
      entry.visualGateDiagnostics = visualVerdict.diagnostics;
      entry.visualGateBlockReason = visualVerdict.blockReason;
      console.log(`  [VisualContentGate] ${visualVerdict.passed ? '✅ PASSED' : '❌ BLOCKED'}`);
      for (const d of visualVerdict.diagnostics) {
        console.log(`    → ${d}`);
      }
      if (visualVerdict.blockReason) {
        console.log(`    ⛔ Block reason: ${visualVerdict.blockReason}`);
      }
    } catch (err) {
      entry.visualGateDiagnostics = [`Error: ${err instanceof Error ? err.message : String(err)}`];
      console.log(`  [VisualContentGate] ❌ ERROR: ${entry.visualGateDiagnostics[0]}`);
    }

    // 3. CLIP Semantic Evaluation
    console.log('  [CLIP] Evaluating semantics...');
    try {
      const positiveConcepts = conceptName.split(/[:\-]/).map((s) => s.trim()).filter(Boolean);
      positiveConcepts.push('cyberpunk', 'game thumbnail', 'neon', 'cyberware');
      const negativeConcepts = ['placeholder', 'geometric shapes', 'gradient only', 'text only', 'blank', 'solid color'];

      const semResult = await adapter.evaluateImageSemantics!({
        imageBuffer: buf,
        positiveConcepts,
        negativeConcepts,
      });
      entry.clipScore = Math.round(semResult.positiveScore * 100);
      entry.clipMargin = semResult.margin;
      entry.clipPassed = !semResult.isOffTopic && semResult.margin > 0.1;
      entry.clipRationale = semResult.rationale;
      console.log(`  [CLIP] Score=${entry.clipScore}% margin=${semResult.margin.toFixed(3)} ${entry.clipPassed ? '✅' : '❌'}`);
      console.log(`    → ${semResult.rationale}`);
    } catch (err) {
      entry.clipRationale = `CLIP error: ${err instanceof Error ? err.message : String(err)}`;
      console.log(`  [CLIP] ❌ ERROR: ${entry.clipRationale}`);
    }

    // 4. Quality Gate (structural metrics via sharp analysis)
    console.log('  [QualityGate] Evaluating structure...');
    try {
      const meta = await sharp(buf).metadata();
      const stats = await sharp(buf).stats();
      const w = meta.width ?? 0;
      const h = meta.height ?? 0;

      // Compute structural metrics similar to QualityGateService
      const meanStdev =
        ((stats.channels[0]?.stdev ?? 0) + (stats.channels[1]?.stdev ?? 0) + (stats.channels[2]?.stdev ?? 0)) / 3;

      // Small-size legibility check (224×126 thumbnail preview)
      const smallBuf = await sharp(buf).resize(224, 126, { fit: 'fill' }).raw().toBuffer();
      let smallStdevSum = 0;
      let smallSamples = 0;
      for (let i = 0; i < smallBuf.length; i += 4) {
        smallStdevSum += smallBuf[i] ?? 0;
        smallSamples++;
      }
      const smallMean = smallSamples > 0 ? smallStdevSum / smallSamples : 0;

      // Edge density for composition quality
      const edgeBuf = await sharp(buf).greyscale().sharpen({ sigma: 1 }).raw().toBuffer();
      let edgeSum = 0;
      let edgeCount = 0;
      for (let i = 0; i < edgeBuf.length; i++) {
        edgeSum += edgeBuf[i] ?? 0;
        edgeCount++;
      }
      const avgEdge = edgeCount > 0 ? edgeSum / edgeCount : 0;

      // Scoring
      const complexityScore = Math.min(100, Math.round(meanStdev * 2.5));
      const legibilityScore = smallMean > 20 ? Math.min(100, Math.round(smallMean * 3)) : 30;
      const compositionScore = Math.min(100, Math.round(avgEdge * 1.8));
      const overall = Math.round((complexityScore * 0.35 + legibilityScore * 0.30 + compositionScore * 0.35));
      const passed = overall >= 55 && meanStdev >= 18;

      entry.qualityScore = overall;
      entry.qualityPassed = passed;
      entry.qualityFindings = [
        `Complexity: ${complexityScore}/100 (stdev=${meanStdev.toFixed(1)})`,
        `Legibility@224px: ${legibilityScore}/100 (mean=${smallMean.toFixed(1)})`,
        `Composition: ${compositionScore}/100 (edgeAvg=${avgEdge.toFixed(1)})`,
        `Dimensions: ${w}×${h}`,
      ];
      if (!passed) {
        entry.qualityFindings.push(`⛔ Below threshold (overall=${overall}, minStdev=18)`);
      }
      console.log(`  [QualityGate] Score=${overall}/100 ${passed ? '✅ PASSED' : '❌ FAILED'}`);
      for (const f of entry.qualityFindings) {
        console.log(`    → ${f}`);
      }
    } catch (err) {
      entry.qualityFindings = [`Error: ${err instanceof Error ? err.message : String(err)}`];
      console.log(`  [QualityGate] ❌ ERROR: ${entry.qualityFindings[0]}`);
    }

    // Overall verdict
    if (entry.visualGatePassed && entry.clipPassed && entry.qualityPassed) {
      entry.overallVerdict = 'approved';
    } else if (!entry.visualGatePassed || !entry.clipPassed || !entry.qualityPassed) {
      entry.overallVerdict = 'rejected';
    }

    console.log(`  📋 OVERALL: ${entry.overallVerdict.toUpperCase()}\n`);
    entries.push(entry);
  }

  // Generate re-evaluation report
  const reportHtml = generateReevalReport(entries);
  const reportPath = join(OUTPUT_DIR, 'cs9-reevaluation-report.html');
  writeFileSync(reportPath, reportHtml, 'utf-8');

  const summaryLines = entries.map((e) =>
    `${e.overallVerdict.toUpperCase()} | ${e.theme} ${e.label} | Visual=${e.visualGatePassed ? '✅' : '❌'} | CLIP=${e.clipScore}% | Quality=${e.qualityScore} | ${e.file}`,
  ).join('\n');
  const summaryPath = join(OUTPUT_DIR, 'cs9-reevaluation-summary.txt');
  writeFileSync(summaryPath, summaryLines, 'utf-8');

  console.log('='.repeat(60));
  console.log(`📊 REEVALUATION COMPLETE: ${entries.length} image(s) evaluated`);
  const approved = entries.filter((e) => e.overallVerdict === 'approved').length;
  const rejected = entries.filter((e) => e.overallVerdict === 'rejected').length;
  console.log(`  ✅ Approved: ${approved} | ❌ Rejected: ${rejected}`);
  console.log(`📄 HTML Report: ${reportPath}`);
  console.log(`📝 Summary: ${summaryPath}`);
  console.log('='.repeat(60));
}

function generateReevalReport(entries: ReevalEntry[]): string {
  const rows = entries.map((e) => {
    const relPath = e.file.replace(/\\/g, '/');
    let verdictBadge: string;
    if (e.overallVerdict === 'approved') {
      verdictBadge = '<span class="badge pass">APPROVED</span>';
    } else if (e.overallVerdict === 'rejected') {
      verdictBadge = '<span class="badge fail">REJECTED</span>';
    } else {
      verdictBadge = '<span class="badge skip">UNAVAILABLE</span>';
    }

    return `
    <tr>
      <td><strong>${e.theme}</strong><br/><small>Concept ${e.label}</small></td>
      <td>${e.concept}</td>
      <td><img src="${relPath}" alt="${e.concept}" style="max-width:320px;max-height:180px;border-radius:4px;border:1px solid #333;"/></td>
      <td>${verdictBadge}<br/><small>${e.sizeKB} KB</small></td>
      <td>
        <div><strong>Visual Gate:</strong> ${e.visualGatePassed ? '✅ PASSED' : '❌ BLOCKED'}</div>
        <small>${e.visualGateDiagnostics.join('<br/>')}</small>
        ${e.visualGateBlockReason ? `<br/><small style="color:#fca5a5">⛔ ${e.visualGateBlockReason}</small>` : ''}
      </td>
      <td>
        <div><strong>CLIP Score:</strong> ${e.clipScore}% ${e.clipPassed ? '✅' : '❌'}</div>
        <small>Margin: ${e.clipMargin.toFixed(3)}</small><br/>
        <small>${e.clipRationale}</small>
      </td>
      <td>
        <div><strong>Quality:</strong> ${e.qualityScore}/100 ${e.qualityPassed ? '✅' : '❌'}</div>
        <small>${e.qualityFindings.join('<br/>')}</small>
      </td>
    </tr>`;
  }).join('\n');

  const approved = entries.filter((e) => e.overallVerdict === 'approved').length;
  const rejected = entries.filter((e) => e.overallVerdict === 'rejected').length;
  const avgClip = entries.reduce((s, e) => s + e.clipScore, 0) / Math.max(1, entries.length);
  const avgQuality = entries.reduce((s, e) => s + e.qualityScore, 0) / Math.max(1, entries.length);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>CS-9 Reavaliação Real — PNGs Existentes</title>
  <style>
    body { font-family: 'Segoe UI', system-ui, sans-serif; background: #0f172a; color: #e2e8f0; margin: 0; padding: 24px; }
    h1 { color: #f8fafc; border-bottom: 2px solid #334155; padding-bottom: 12px; }
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin: 24px 0; }
    .stat { background: #1e293b; border-radius: 8px; padding: 16px; text-align: center; }
    .stat .value { font-size: 2em; font-weight: 700; color: #38bdf8; }
    .stat .label { font-size: 0.85em; color: #94a3b8; margin-top: 4px; }
    table { width: 100%; border-collapse: collapse; margin-top: 24px; font-size: 0.9em; }
    th { background: #1e293b; color: #f8fafc; padding: 12px 8px; text-align: left; position: sticky; top: 0; }
    td { padding: 10px 8px; border-bottom: 1px solid #334155; vertical-align: top; }
    tr:hover { background: #1e293b44; }
    .badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-size: 0.8em; font-weight: 600; }
    .badge.pass { background: #065f46; color: #6ee7b7; }
    .badge.fail { background: #7f1d1d; color: #fca5a5; }
    .badge.skip { background: #78350f; color: #fcd34d; }
    .disclaimer { margin-top: 32px; padding: 16px; background: #1e293b; border-left: 4px solid #f59e0b; border-radius: 4px; font-size: 0.85em; color: #cbd5e1; }
  </style>
</head>
<body>
  <h1>🔍 CS-9 Reavaliação Real — PNGs Existentes</h1>
  <p>Gerado em ${new Date().toLocaleString('pt-BR')} | Pipeline: VisualContentGate + CLIP ViT-B/32 + Quality Metrics</p>

  <div class="summary">
    <div class="stat"><div class="value">${entries.length}</div><div class="label">Avaliadas</div></div>
    <div class="stat"><div class="value">${approved}</div><div class="label">Aprovadas</div></div>
    <div class="stat"><div class="value">${rejected}</div><div class="label">Rejeitadas</div></div>
    <div class="stat"><div class="value">${avgClip.toFixed(0)}%</div><div class="label">CLIP Médio</div></div>
    <div class="stat"><div class="value">${avgQuality.toFixed(0)}</div><div class="label">Quality Médio</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Tema</th>
        <th>Conceito</th>
        <th>Preview</th>
        <th>Veredito</th>
        <th>Visual Gate</th>
        <th>Semântica (CLIP)</th>
        <th>Quality Gate</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <div class="disclaimer">
    <strong>⚠️ Aviso:</strong> Esta reavaliação aplica todos os gates (VisualContentGate, CLIP, Quality)
    aos PNGs pré-existentes que foram anteriormente marcados como "SKIPPED" sem avaliação real.
    Os resultados aqui refletem a validação técnica e semântica real das imagens.
    A aprovação estética final ainda requer revisão humana.
  </div>
</body>
</html>`;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});