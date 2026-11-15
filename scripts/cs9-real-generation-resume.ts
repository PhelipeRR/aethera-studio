/**
 * CS-9 Real Thumbnail Generation — Resume Script v2
 *
 * Generates remaining concepts with robust adapter lifecycle management:
 * - Single adapter instance reused across all concepts
 * - Retry with backoff on transient availability failures
 * - Explicit GPU memory cleanup between concepts
 * - Skips already-generated PNGs to avoid redundant work
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp from 'sharp';
import {
  AssetIngestionService,
  ConceptDrivenEngine,
  SharpSvgCompositionEngine,
  QualityGateService,
  evaluateVisualContent,
} from '../packages/creative-studio/src/index.js';
import { LocalPythonAiAdapter } from '../packages/creative-studio/src/local-ai-adapter.js';
import type { ReasoningEngineProvider } from '../packages/creative-studio/src/creative-orchestrator.js';
import type { ExternalImageAdapter, ImageGenerationRequest, SemanticEvaluationRequest, SemanticEvaluationResult } from '../packages/creative-studio/src/image-generation-adapter.js';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'artifacts', 'cs9-real-generation');

if (!existsSync(OUTPUT_DIR)) mkdirSync(OUTPUT_DIR, { recursive: true });

function mockProvider(): ReasoningEngineProvider {
  return { id: 'claude-code', isAvailable: async () => true, runPrompt: async () => ({ text: 'ok' }) };
}

/**
 * Resilient wrapper around LocalPythonAiAdapter that retries on transient failures
 * and explicitly clears GPU cache between generations to prevent OOM/timeout.
 */
class ResilientAiAdapter implements ExternalImageAdapter {
  readonly id = 'resilient-sdxl-clip';
  private readonly inner: LocalPythonAiAdapter;
  private readonly pythonPath: string;

  constructor(inner: LocalPythonAiAdapter, pythonPath: string) {
    this.inner = inner;
    this.pythonPath = pythonPath;
  }

  async isAvailable(): Promise<boolean> {
    return this.inner.isAvailable();
  }

  async generateImage(request: ImageGenerationRequest): Promise<Buffer> {
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`    [SDXL] Generating "${request.prompt.slice(0, 60)}..." (attempt ${attempt}/${maxRetries})`);
        const buf = await this.inner.generateImage!(request);
        console.log(`    [SDXL] ✅ Generated ${(buf.length / 1024).toFixed(0)} KB`);
        return buf;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`    [SDXL] ❌ Attempt ${attempt} failed: ${msg}`);
        if (attempt < maxRetries) {
          const delay = attempt * 10_000;
          console.log(`    [SDXL] Retrying in ${delay / 1000}s...`);
          await new Promise((r) => setTimeout(r, delay));
          // Clear GPU cache before retry
          await this.clearGpuCache();
        } else {
          throw err;
        }
      }
    }
    throw new Error('Unreachable');
  }

  async evaluateImageSemantics?(request: SemanticEvaluationRequest): Promise<SemanticEvaluationResult> {
    if (!this.inner.evaluateImageSemantics) {
      throw new Error('CLIP evaluation not available');
    }
    const maxRetries = 2;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`    [CLIP] Evaluating semantics (attempt ${attempt}/${maxRetries})`);
        const result = await this.inner.evaluateImageSemantics(request);
        console.log(`    [CLIP] ✅ Score=${(result.positiveScore * 100).toFixed(1)}% margin=${result.margin.toFixed(3)}`);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`    [CLIP] ❌ Attempt ${attempt} failed: ${msg}`);
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, 5000));
        } else {
          throw err;
        }
      }
    }
    throw new Error('Unreachable');
  }

  /** Explicitly clear PyTorch CUDA cache to free VRAM between concepts */
  private async clearGpuCache(): Promise<void> {
    try {
      await execFileAsync(this.pythonPath, ['-c', 'import torch; torch.cuda.empty_cache(); print("GPU cache cleared")'], { timeout: 15_000 });
      console.log('    [GPU] Cache cleared');
    } catch {
      console.log('    [GPU] Cache clear skipped (CPU mode or torch unavailable)');
    }
  }

  /** Public method to clear GPU cache between concepts */
  async cleanupBetweenConcepts(): Promise<void> {
    await this.clearGpuCache();
  }
}

interface ConceptConfig {
  theme: string;
  slug: string;
  label: string;
  title: string;
  headline: string;
  prompt: string;
  scriptText: string;
  genre: 'games' | 'anime' | 'documentary' | 'general';
}

const ALL_CONCEPTS: ConceptConfig[] = [
  {
    theme: 'Cyberpunk 2077', slug: 'cyberpunk-2077', label: 'A',
    title: 'Cyberpunk 2077: Sandevistan Neural Spine',
    headline: 'SPEED HACK IMPLANT',
    prompt: 'Hyper-detailed macro product photography of a Sandevistan neural spine cyberware implant on a dark surgical tray, titanium chrome plates with cyan neon optical conduits glowing, Night City holographic UI overlay in background, volumetric lighting, photorealistic, 8K detail',
    scriptText: 'Análise completa do implante Sandevistan.',
    genre: 'games',
  },
  {
    theme: 'Cyberpunk 2077', slug: 'cyberpunk-2077', label: 'B',
    title: 'Cyberpunk 2077: Johnny Silverhand Returns',
    headline: 'WAKE UP SAMURAI',
    prompt: 'Cinematic portrait of Johnny Silverhand from Cyberpunk 2077, silver chrome arm with mechanical fingers, aviator sunglasses reflecting neon city lights, cigarette smoke, dark moody lighting with pink and blue neon rim light, photorealistic game art style',
    scriptText: 'A história completa de Johnny Silverhand.',
    genre: 'games',
  },
  {
    theme: 'Cyberpunk 2077', slug: 'cyberpunk-2077', label: 'C',
    title: 'Cyberpunk 2077: Mantis Blades Build Guide',
    headline: 'BLADE RUNNER BUILD',
    prompt: 'Dynamic action shot of cybernetic mantis blades extending from forearms in combat stance, sparks flying, dark urban alleyway with neon signs in Japanese and English, rain-slicked surfaces reflecting colored lights, motion blur, cinematic game screenshot style',
    scriptText: 'Guia definitivo da build Mantis Blades.',
    genre: 'games',
  },
  {
    theme: 'Elden Ring', slug: 'elden-ring', label: 'A',
    title: 'Elden Ring: Malenia Blade of Miquella',
    headline: 'I AM MALENIA',
    prompt: 'Epic fantasy boss portrait of Malenia Blade of Miquella from Elden Ring, golden prosthetic arm wielding katana, flowing red hair, scarlet rot petals floating in air, Erdtree golden light in background, dark souls art style, dramatic chiaroscuro lighting',
    scriptText: 'Guia completo da luta contra Malenia.',
    genre: 'games',
  },
  {
    theme: 'Elden Ring', slug: 'elden-ring', label: 'B',
    title: 'Elden Ring: Shadow of the Erdtree DLC',
    headline: 'REALM OF SHADOW',
    prompt: 'Breathtaking landscape of the Realm of Shadow from Elden Ring DLC, massive twisted Erdtree roots piercing through dark mountains, ghostly spirits wandering misty valleys, golden runes floating in air, FromSoftware environmental art style, wide cinematic composition',
    scriptText: 'Exploração completa do DLC Shadow of the Erdtree.',
    genre: 'games',
  },
  {
    theme: 'Elden Ring', slug: 'elden-ring', label: 'C',
    title: 'Elden Ring: Best Strength Build 2024',
    headline: 'GIANT CRUSHER META',
    prompt: 'Dark fantasy warrior in heavy armor wielding massive Giant Crusher great hammer, glowing weapon enchantment, Limgrave ruins background with crumbling stone arches, dramatic low-angle shot, Elden Ring promotional art style, volumetric god rays',
    scriptText: 'A build de força mais forte de Elden Ring.',
    genre: 'games',
  },
  {
    theme: 'Hollow Knight: Silksong', slug: 'hollow-knight-silksong', label: 'A',
    title: 'Hollow Knight: Silksong — Hornet Awakens',
    headline: 'SILK AND STEEL',
    prompt: 'Hand-painted indie game art of Hornet from Hollow Knight Silksong, white masked protagonist with needle sword and silk thread abilities, leaping through lush mossy forest with bioluminescent plants, Team Cherry art style, soft watercolor textures, vibrant greens and teals',
    scriptText: 'Tudo sobre Hollow Knight: Silksong.',
    genre: 'games',
  },
  {
    theme: 'Hollow Knight: Silksong', slug: 'hollow-knight-silksong', label: 'B',
    title: 'Hollow Knight: Silksong — New Abilities Revealed',
    headline: 'WEAVE AND STRIKE',
    prompt: 'Detailed game art showing Hornet performing silk-based combat moves, multiple silk threads forming web patterns around enemies, underground cavern with glowing crystals and hanging vines, hand-drawn animation style matching Hollow Knight aesthetic, dynamic diagonal composition',
    scriptText: 'Análise das novas habilidades de seda em Silksong.',
    genre: 'games',
  },
  {
    theme: 'Hollow Knight: Silksong', slug: 'hollow-knight-silksong', label: 'C',
    title: 'Hollow Knight: Silksong — Pharloom World Tour',
    headline: 'EXPLORE PHARLOOM',
    prompt: 'Wide panoramic landscape of Pharloom kingdom from Hollow Knight Silksong, towering ancient trees with silk bridges connecting platforms, distant castle spires shrouded in mist, fireflies and floating particles, Team Cherry environmental design, painterly watercolor style',
    scriptText: 'Tour completo pelo reino de Pharloom.',
    genre: 'games',
  },
];

interface ReportEntry {
  theme: string; concept: string; label: string; pngPath: string;
  visualGatePassed: boolean; visualGateDiagnostics: string[];
  qualityScore: number; qualityPassed: boolean; qualityFindings: string[];
  semanticScore: number; semanticPassed: boolean; semanticRationale: string;
  provenance: string; generationTimeSec: number; status: 'generated' | 'skipped' | 'failed';
}

async function main() {
  console.log('=== CS-9 Real Thumbnail Generation — Resume v2 ===');
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log('');

  const pythonPath = process.env['NB_PYTHON'] ?? 'python';
  const innerAdapter = new LocalPythonAiAdapter({
    model: 'stabilityai/sdxl-turbo',
    steps: 4,
    timeoutMs: 300_000,
    pythonPath,
  });

  const isAvailable = await innerAdapter.isAvailable();
  if (!isAvailable) {
    console.error('❌ BLOCKED: LocalPythonAiAdapter not available.');
    process.exit(1);
  }
  console.log('✅ LocalPythonAiAdapter available (SDXL-Turbo + CLIP ViT-B/32)');

  const adapter = new ResilientAiAdapter(innerAdapter, pythonPath);
  const reportEntries: ReportEntry[] = [];

  for (const cfg of ALL_CONCEPTS) {
    // Check if already generated
    const existingPngs = existsSync(OUTPUT_DIR)
      ? (await import('node:fs')).readdirSync(OUTPUT_DIR).filter((f: string) =>
          f.startsWith(`${cfg.slug}-concept-${cfg.label}-`) && f.endsWith('.png')
        )
      : [];

    if (existingPngs.length > 0) {
      const existingPath = join(OUTPUT_DIR, existingPngs[0]);
      const stat = (await import('node:fs')).statSync(existingPath);
      console.log(`\n⏭️  SKIP ${cfg.theme} ${cfg.label}: already exists (${(stat.size / 1024).toFixed(0)} KB)`);
      reportEntries.push({
        theme: cfg.theme, concept: cfg.title, label: cfg.label, pngPath: existingPath,
        visualGatePassed: true, visualGateDiagnostics: ['Skipped — pre-existing'],
        qualityScore: 0, qualityPassed: true, qualityFindings: ['Not re-evaluated'],
        semanticScore: 0, semanticPassed: true, semanticRationale: 'Not re-evaluated',
        provenance: 'pre-existing', generationTimeSec: 0, status: 'skipped',
      });
      continue;
    }

    console.log(`\n--- ${cfg.theme} Concept ${cfg.label}: ${cfg.title} ---`);
    const t0 = performance.now();

    const storageRoot = join(OUTPUT_DIR, `${cfg.slug}-concept-${cfg.label}`, 'storage');
    mkdirSync(storageRoot, { recursive: true });

    const ingestion = new AssetIngestionService({ storageRoot });
    const engine = new SharpSvgCompositionEngine(ingestion, adapter);
    const gate = new QualityGateService(engine);
    const conceptEngine = new ConceptDrivenEngine(ingestion, engine, gate, {
      providers: [mockProvider()],
      imageAdapter: adapter,
    });

    try {
      const { proposals, enginesUsed } = await conceptEngine.generateConceptLab({
        title: cfg.title, headline: cfg.headline, prompt: cfg.prompt,
        scriptText: cfg.scriptText, width: 1280, height: 720, genre: cfg.genre,
      });

      const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
      const proposal = proposals[0];
      if (!proposal) {
        console.error(`  ❌ No proposals for ${cfg.label}`);
        reportEntries.push({
          theme: cfg.theme, concept: cfg.title, label: cfg.label, pngPath: '',
          visualGatePassed: false, visualGateDiagnostics: ['No proposals generated'],
          qualityScore: 0, qualityPassed: false, qualityFindings: ['No proposals'],
          semanticScore: 0, semanticPassed: false, semanticRationale: 'N/A',
          provenance: 'none', generationTimeSec: parseFloat(elapsed), status: 'failed',
        });
        continue;
      }

      const rendered = await engine.renderDocumentToBuffer(proposal.document, 'png');
      const outPath = join(OUTPUT_DIR, `${cfg.slug}-concept-${cfg.label}-${proposal.concept.archetype}.png`);
      writeFileSync(outPath, rendered);

      // Visual Content Gate on final render
      const tempAsset = await ingestion.ingestBuffer({ buffer: rendered, kind: 'image', extension: 'png', originalName: `final-${cfg.label}.png` });
      const absPath = ingestion.resolvePortablePath(tempAsset.relativePath);
      const visualVerdict = await evaluateVisualContent({ asset: tempAsset, assetPath: absPath, queryOrPrompt: cfg.prompt, conceptTitle: cfg.title, genre: cfg.genre });

      // Semantic evaluation via CLIP
      let semanticScore = 0, semanticPassed = false, semanticRationale = 'CLIP not evaluated';
      try {
        const semResult = await adapter.evaluateImageSemantics!({
          imageBuffer: rendered,
          positiveConcepts: cfg.prompt.split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 5),
          negativeConcepts: ['placeholder', 'geometric shapes', 'gradient only', 'text only', 'blank'],
        });
        semanticScore = Math.round(semResult.positiveScore * 100);
        semanticPassed = !semResult.isOffTopic && semResult.margin > 0.1;
        semanticRationale = semResult.rationale;
      } catch (err) {
        semanticRationale = `CLIP eval error: ${err instanceof Error ? err.message : String(err)}`;
      }

      reportEntries.push({
        theme: cfg.theme, concept: cfg.title, label: cfg.label, pngPath: outPath,
        visualGatePassed: visualVerdict.passed, visualGateDiagnostics: visualVerdict.diagnostics,
        qualityScore: proposal.audit.scorecard.overall, qualityPassed: proposal.audit.passed,
        qualityFindings: proposal.audit.findings.map((f: any) => `[${f.severity}] ${f.message}`),
        semanticScore, semanticPassed, semanticRationale,
        provenance: proposal.acquiredMedia.map((m: any) => `${m.role}=${m.provenance}`).join(', '),
        generationTimeSec: parseFloat(elapsed), status: 'generated',
      });

      console.log(`  ✅ Exported: ${outPath} (${(rendered.length / 1024).toFixed(0)} KB)`);
      console.log(`  Visual Gate: ${visualVerdict.passed ? 'PASSED' : 'BLOCKED'} — ${visualVerdict.diagnostics.join('; ')}`);
      console.log(`  Quality Gate: score=${proposal.audit.scorecard.overall} passed=${proposal.audit.passed}`);
      console.log(`  Semantic (CLIP): score=${semanticScore}% passed=${semanticPassed} — ${semanticRationale}`);
      console.log(`  Engines: ${enginesUsed.join(', ')} | Time: ${elapsed}s`);
    } catch (err) {
      const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ❌ FAILED after ${elapsed}s: ${message}`);
      reportEntries.push({
        theme: cfg.theme, concept: cfg.title, label: cfg.label, pngPath: '',
        visualGatePassed: false, visualGateDiagnostics: ['Generation failed'],
        qualityScore: 0, qualityPassed: false, qualityFindings: [message],
        semanticScore: 0, semanticPassed: false, semanticRationale: 'Not evaluated',
        provenance: 'none', generationTimeSec: parseFloat(elapsed), status: 'failed',
      });
    }

    // Clear GPU cache between concepts to prevent OOM
    await adapter.cleanupBetweenConcepts();
  }

  // Generate HTML report
  const htmlReport = generateHtmlReport(reportEntries);
  const reportPath = join(OUTPUT_DIR, 'cs9-real-generation-report.html');
  writeFileSync(reportPath, htmlReport, 'utf-8');

  // Also write plain text summary
  const summaryLines = reportEntries.map((e) =>
    `${e.status.toUpperCase()} | ${e.theme} ${e.label} | Visual=${e.visualGatePassed ? '✅' : '❌'} | Quality=${e.qualityScore} | CLIP=${e.semanticScore}% | ${e.pngPath || 'NO IMAGE'}`
  ).join('\n');
  writeFileSync(join(OUTPUT_DIR, 'resume-summary.txt'), summaryLines, 'utf-8');

  const generated = reportEntries.filter((e) => e.status === 'generated').length;
  const skipped = reportEntries.filter((e) => e.status === 'skipped').length;
  const failed = reportEntries.filter((e) => e.status === 'failed').length;

  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 FINAL SUMMARY: ${generated} generated + ${skipped} skipped + ${failed} failed = ${reportEntries.length}/9`);
  console.log(`📄 HTML Report: ${reportPath}`);
  console.log(`📝 Text Summary: ${join(OUTPUT_DIR, 'resume-summary.txt')}`);
  console.log(`📁 Artifacts: ${OUTPUT_DIR}`);
  console.log(`${'='.repeat(60)}`);
}

function generateHtmlReport(entries: ReportEntry[]): string {
  const rows = entries.map((e) => {
    const relPath = e.pngPath ? e.pngPath.replace(/\\/g, '/') : '';
    const allPassed = e.visualGatePassed && e.qualityPassed && e.semanticPassed;
    const failures: string[] = [];
    if (!e.visualGatePassed) failures.push('VISUAL GATE');
    if (!e.qualityPassed && e.status !== 'skipped') failures.push('QUALITY');
    if (!e.semanticPassed && e.status !== 'skipped') failures.push('SEMANTIC');
    let statusBadge: string;
    if (e.status === 'skipped') {
      statusBadge = '<span class="badge skip">SKIPPED</span>';
    } else if (e.status === 'failed') {
      statusBadge = '<span class="badge fail">FAILED</span>';
    } else if (allPassed) {
      statusBadge = '<span class="badge pass">ALL PASSED</span>';
    } else {
      statusBadge = `<span class="badge fail">${failures.join(' + ')} FAIL</span>`;
    }

    return `
    <tr>
      <td><strong>${e.theme}</strong><br/><small>Concept ${e.label}</small></td>
      <td>${e.concept}</td>
      <td>${relPath ? `<img src="${relPath}" alt="${e.concept}" style="max-width:320px;max-height:180px;border-radius:4px;border:1px solid #333;"/>` : '<em>No image</em>'}</td>
      <td>${statusBadge}</td>
      <td>
        <div><strong>Visual Gate:</strong> ${e.visualGatePassed ? '✅ PASSED' : '❌ BLOCKED'}</div>
        <small>${e.visualGateDiagnostics.join('<br/>')}</small>
      </td>
      <td>
        <div><strong>Score:</strong> ${e.qualityScore}/100 ${e.qualityPassed ? '✅' : '❌'}</div>
        <small>${e.qualityFindings.slice(0, 3).join('<br/>')}${e.qualityFindings.length > 3 ? `<br/>+${e.qualityFindings.length - 3} more` : ''}</small>
      </td>
      <td>
        <div><strong>CLIP Score:</strong> ${e.semanticScore}% ${e.semanticPassed ? '✅' : '❌'}</div>
        <small>${e.semanticRationale}</small>
      </td>
      <td><small>${e.provenance}</small></td>
      <td>${e.generationTimeSec > 0 ? `${e.generationTimeSec}s` : '—'}</td>
    </tr>`;
  }).join('\n');

  const totalGenerated = entries.filter((e) => e.status === 'generated').length;
  const totalSkipped = entries.filter((e) => e.status === 'skipped').length;
  const totalFailed = entries.filter((e) => e.status === 'failed').length;
  const allPassedCount = entries.filter((e) => e.status === 'generated' && e.visualGatePassed && e.qualityPassed && e.semanticPassed).length;
  const avgQuality = entries.filter((e) => e.qualityScore > 0).reduce((sum, e) => sum + e.qualityScore, 0) / Math.max(1, entries.filter((e) => e.qualityScore > 0).length);
  const avgSemantic = entries.filter((e) => e.semanticScore > 0).reduce((sum, e) => sum + e.semanticScore, 0) / Math.max(1, entries.filter((e) => e.semanticScore > 0).length);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>CS-9 Real Thumbnail Generation Report</title>
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
  <h1>🎨 CS-9 Real Thumbnail Generation Report</h1>
  <p>Gerado em ${new Date().toLocaleString('pt-BR')} | Pipeline: SDXL-Turbo + CLIP ViT-B/32 + VisualContentGate</p>

  <div class="summary">
    <div class="stat"><div class="value">${totalGenerated}</div><div class="label">Geradas</div></div>
    <div class="stat"><div class="value">${totalSkipped}</div><div class="label">Pré-existentes</div></div>
    <div class="stat"><div class="value">${totalFailed}</div><div class="label">Falhas</div></div>
    <div class="stat"><div class="value">${allPassedCount}</div><div class="label">Todos Gates OK</div></div>
    <div class="stat"><div class="value">${avgQuality.toFixed(0)}</div><div class="label">Quality Médio</div></div>
    <div class="stat"><div class="value">${avgSemantic.toFixed(0)}%</div><div class="label">CLIP Médio</div></div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Tema</th>
        <th>Conceito</th>
        <th>Preview</th>
        <th>Status</th>
        <th>Visual Gate</th>
        <th>Quality Gate</th>
        <th>Semântica (CLIP)</th>
        <th>Proveniência</th>
        <th>Tempo</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <div class="disclaimer">
    <strong>⚠️ Aviso:</strong> Este relatório foi gerado automaticamente pelo pipeline CS-9 com SDXL-Turbo + CLIP ViT-B/32.
    As imagens são geradas por IA real (não são placeholders procedurais). A aprovação estética final requer revisão humana.
    Os scores de Quality Gate e CLIP são métricas técnicas/semânticas — não substituem julgamento editorial.
  </div>
</body>
</html>`;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});