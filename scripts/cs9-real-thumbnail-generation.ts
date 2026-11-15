/**
 * CS-9 Real Thumbnail Generation Script
 *
 * Generates 9 thumbnails (3 per theme) using SDXL-Turbo for real AI image generation
 * and CLIP ViT-B/32 for semantic validation. No procedural placeholders.
 *
 * Themes: Cyberpunk 2077, Elden Ring, Hollow Knight: Silksong
 * Output: artifacts/cs9-real-generation/
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUTPUT_DIR = join(ROOT, 'artifacts', 'cs9-real-generation');

if (!existsSync(OUTPUT_DIR)) {
  mkdirSync(OUTPUT_DIR, { recursive: true });
}

function mockProvider(): ReasoningEngineProvider {
  return {
    id: 'claude-code',
    isAvailable: async () => true,
    runPrompt: async () => ({ text: 'ok' }),
  };
}

interface ThemeConfig {
  name: string;
  slug: string;
  concepts: Array<{
    label: string;
    title: string;
    headline: string;
    prompt: string;
    scriptText: string;
    genre: 'games' | 'anime' | 'documentary' | 'general';
  }>;
}

const THEMES: ThemeConfig[] = [
  {
    name: 'Cyberpunk 2077',
    slug: 'cyberpunk-2077',
    concepts: [
      {
        label: 'A',
        title: 'Cyberpunk 2077: Sandevistan Neural Spine',
        headline: 'SPEED HACK IMPLANT',
        prompt: 'Hyper-detailed macro product photography of a Sandevistan neural spine cyberware implant on a dark surgical tray, titanium chrome plates with cyan neon optical conduits glowing, Night City holographic UI overlay in background, volumetric lighting, photorealistic, 8K detail',
        scriptText: 'Análise completa do implante Sandevistan.',
        genre: 'games',
      },
      {
        label: 'B',
        title: 'Cyberpunk 2077: Johnny Silverhand Returns',
        headline: 'WAKE UP SAMURAI',
        prompt: 'Cinematic portrait of Johnny Silverhand from Cyberpunk 2077, silver chrome arm with mechanical fingers, aviator sunglasses reflecting neon city lights, cigarette smoke, dark moody lighting with pink and blue neon rim light, photorealistic game art style',
        scriptText: 'A história completa de Johnny Silverhand.',
        genre: 'games',
      },
      {
        label: 'C',
        title: 'Cyberpunk 2077: Mantis Blades Build Guide',
        headline: 'BLADE RUNNER BUILD',
        prompt: 'Dynamic action shot of cybernetic mantis blades extending from forearms in combat stance, sparks flying, dark urban alleyway with neon signs in Japanese and English, rain-slicked surfaces reflecting colored lights, motion blur, cinematic game screenshot style',
        scriptText: 'Guia definitivo da build Mantis Blades.',
        genre: 'games',
      },
    ],
  },
  {
    name: 'Elden Ring',
    slug: 'elden-ring',
    concepts: [
      {
        label: 'A',
        title: 'Elden Ring: Malenia Blade of Miquella',
        headline: 'I AM MALENIA',
        prompt: 'Epic fantasy boss portrait of Malenia Blade of Miquella from Elden Ring, golden prosthetic arm wielding katana, flowing red hair, scarlet rot petals floating in air, Erdtree golden light in background, dark souls art style, dramatic chiaroscuro lighting',
        scriptText: 'Guia completo da luta contra Malenia.',
        genre: 'games',
      },
      {
        label: 'B',
        title: 'Elden Ring: Shadow of the Erdtree DLC',
        headline: 'REALM OF SHADOW',
        prompt: 'Breathtaking landscape of the Realm of Shadow from Elden Ring DLC, massive twisted Erdtree roots piercing through dark mountains, ghostly spirits wandering misty valleys, golden runes floating in air, FromSoftware environmental art style, wide cinematic composition',
        scriptText: 'Exploração completa do DLC Shadow of the Erdtree.',
        genre: 'games',
      },
      {
        label: 'C',
        title: 'Elden Ring: Best Strength Build 2024',
        headline: 'GIANT CRUSHER META',
        prompt: 'Dark fantasy warrior in heavy armor wielding massive Giant Crusher great hammer, glowing weapon enchantment, Limgrave ruins background with crumbling stone arches, dramatic low-angle shot, Elden Ring promotional art style, volumetric god rays',
        scriptText: 'A build de força mais forte de Elden Ring.',
        genre: 'games',
      },
    ],
  },
  {
    name: 'Hollow Knight: Silksong',
    slug: 'hollow-knight-silksong',
    concepts: [
      {
        label: 'A',
        title: 'Hollow Knight: Silksong — Hornet Awakens',
        headline: 'SILK AND STEEL',
        prompt: 'Hand-painted indie game art of Hornet from Hollow Knight Silksong, white masked protagonist with needle sword and silk thread abilities, leaping through lush mossy forest with bioluminescent plants, Team Cherry art style, soft watercolor textures, vibrant greens and teals',
        scriptText: 'Tudo sobre Hollow Knight: Silksong.',
        genre: 'games',
      },
      {
        label: 'B',
        title: 'Hollow Knight: Silksong — New Abilities Revealed',
        headline: 'WEAVE AND STRIKE',
        prompt: 'Detailed game art showing Hornet performing silk-based combat moves, multiple silk threads forming web patterns around enemies, underground cavern with glowing crystals and hanging vines, hand-drawn animation style matching Hollow Knight aesthetic, dynamic diagonal composition',
        scriptText: 'Análise das novas habilidades de seda em Silksong.',
        genre: 'games',
      },
      {
        label: 'C',
        title: 'Hollow Knight: Silksong — Pharloom World Tour',
        headline: 'EXPLORE PHARLOOM',
        prompt: 'Wide panoramic landscape of Pharloom kingdom from Hollow Knight Silksong, towering ancient trees with silk bridges connecting platforms, distant castle spires shrouded in mist, fireflies and floating particles, Team Cherry environmental design, painterly watercolor style',
        scriptText: 'Tour completo pelo reino de Pharloom.',
        genre: 'games',
      },
    ],
  },
];

interface ReportEntry {
  theme: string;
  concept: string;
  label: string;
  pngPath: string;
  visualGatePassed: boolean;
  visualGateDiagnostics: string[];
  qualityScore: number;
  qualityPassed: boolean;
  qualityFindings: string[];
  semanticScore: number;
  semanticPassed: boolean;
  semanticRationale: string;
  provenance: string;
  generationTimeSec: number;
}

async function main() {
  console.log('=== CS-9 Real Thumbnail Generation ===');
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log('');

  const aiAdapter = new LocalPythonAiAdapter({
    model: 'stabilityai/sdxl-turbo',
    steps: 4,
    timeoutMs: 300_000,
  });

  const isAvailable = await aiAdapter.isAvailable();
  if (!isAvailable) {
    console.error('❌ BLOCKED: LocalPythonAiAdapter (SDXL-Turbo + CLIP) is not available.');
    console.error('   Ensure Python, PyTorch, diffusers and transformers are installed.');
    process.exit(1);
  }
  console.log('✅ LocalPythonAiAdapter available (SDXL-Turbo + CLIP ViT-B/32)');
  console.log('');

  const reportEntries: ReportEntry[] = [];

  for (const theme of THEMES) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`THEME: ${theme.name}`);
    console.log('='.repeat(60));

    for (const conceptCfg of theme.concepts) {
      console.log(`\n--- Concept ${conceptCfg.label}: ${conceptCfg.title} ---`);
      const t0 = performance.now();

      const storageRoot = join(OUTPUT_DIR, `${theme.slug}-concept-${conceptCfg.label}`, 'storage');
      mkdirSync(storageRoot, { recursive: true });

      const ingestion = new AssetIngestionService({ storageRoot });
      const engine = new SharpSvgCompositionEngine(ingestion, aiAdapter);
      const gate = new QualityGateService(engine);
      const conceptEngine = new ConceptDrivenEngine(ingestion, engine, gate, {
        providers: [mockProvider()],
        imageAdapter: aiAdapter,
      });

      try {
        const { proposals, enginesUsed } = await conceptEngine.generateConceptLab({
          title: conceptCfg.title,
          headline: conceptCfg.headline,
          prompt: conceptCfg.prompt,
          scriptText: conceptCfg.scriptText,
          width: 1280,
          height: 720,
          genre: conceptCfg.genre,
        });

        const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
        const proposal = proposals[0];
        if (!proposal) {
          console.error(`  ❌ No proposals generated for ${conceptCfg.label}`);
          continue;
        }

        const rendered = await engine.renderDocumentToBuffer(proposal.document, 'png');
        const outPath = join(OUTPUT_DIR, `${theme.slug}-concept-${conceptCfg.label}-${proposal.concept.archetype}.png`);
        writeFileSync(outPath, rendered);

        // Visual Content Gate on final render
        const tempAsset = await ingestion.ingestBuffer({
          buffer: rendered,
          kind: 'image',
          extension: 'png',
          originalName: `final-render-${conceptCfg.label}.png`,
        });
        const absPath = ingestion.resolvePortablePath(tempAsset.relativePath);
        const visualVerdict = await evaluateVisualContent({
          asset: tempAsset,
          assetPath: absPath,
          queryOrPrompt: conceptCfg.prompt,
          conceptTitle: conceptCfg.title,
          genre: conceptCfg.genre,
        });

        // Semantic evaluation via CLIP
        let semanticScore = 0;
        let semanticPassed = false;
        let semanticRationale = 'CLIP not evaluated';
        if (aiAdapter.evaluateImageSemantics) {
          try {
            const semResult = await aiAdapter.evaluateImageSemantics({
              imageBuffer: rendered,
              positiveConcepts: conceptCfg.prompt.split(/[,;]/).map((s) => s.trim()).filter(Boolean).slice(0, 5),
              negativeConcepts: ['placeholder', 'geometric shapes', 'gradient only', 'text only', 'blank'],
            });
            semanticScore = Math.round(semResult.positiveScore * 100);
            semanticPassed = !semResult.isOffTopic && semResult.margin > 0.1;
            semanticRationale = semResult.rationale;
          } catch (err) {
            semanticRationale = `CLIP eval error: ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        const entry: ReportEntry = {
          theme: theme.name,
          concept: conceptCfg.title,
          label: conceptCfg.label,
          pngPath: outPath,
          visualGatePassed: visualVerdict.passed,
          visualGateDiagnostics: visualVerdict.diagnostics,
          qualityScore: proposal.audit.scorecard.overall,
          qualityPassed: proposal.audit.passed,
          qualityFindings: proposal.audit.findings.map((f: any) => `[${f.severity}] ${f.message}`),
          semanticScore,
          semanticPassed,
          semanticRationale,
          provenance: proposal.acquiredMedia.map((m: any) => `${m.role}=${m.provenance}`).join(', '),
          generationTimeSec: parseFloat(elapsed),
        };
        reportEntries.push(entry);

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
          theme: theme.name,
          concept: conceptCfg.title,
          label: conceptCfg.label,
          pngPath: '',
          visualGatePassed: false,
          visualGateDiagnostics: ['Generation failed'],
          qualityScore: 0,
          qualityPassed: false,
          qualityFindings: [message],
          semanticScore: 0,
          semanticPassed: false,
          semanticRationale: 'Not evaluated — generation failed',
          provenance: 'none',
          generationTimeSec: parseFloat(elapsed),
        });
      }
    }
  }

  // Generate HTML report
  const htmlReport = generateHtmlReport(reportEntries);
  const reportPath = join(OUTPUT_DIR, 'cs9-real-generation-report.html');
  writeFileSync(reportPath, htmlReport, 'utf-8');
  console.log(`\n${'='.repeat(60)}`);
  console.log(`📊 HTML Report: ${reportPath}`);
  console.log(`📁 Artifacts: ${OUTPUT_DIR}`);
  console.log(`${'='.repeat(60)}`);
}

function generateHtmlReport(entries: ReportEntry[]): string {
  const rows = entries.map((e) => {
    const relPath = e.pngPath ? e.pngPath.replace(/\\/g, '/') : '';
    const allPassed = e.visualGatePassed && e.qualityPassed && e.semanticPassed;
    const failures: string[] = [];
    if (!e.visualGatePassed) failures.push('VISUAL GATE');
    if (!e.qualityPassed) failures.push('QUALITY');
    if (!e.semanticPassed) failures.push('SEMANTIC');
    const statusBadge = e.pngPath
      ? (allPassed
        ? '<span class="badge pass">ALL PASSED</span>'
        : `<span class="badge fail">${failures.join(' + ')} FAIL</span>`)
      : '<span class="badge fail">GENERATION FAILED</span>';

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
        <td>${e.generationTimeSec}s</td>
      </tr>`;
  }).join('\n');

  const totalGenerated = entries.filter((e) => e.pngPath).length;
  const allPassedCount = entries.filter((e) => e.visualGatePassed && e.qualityPassed && e.semanticPassed).length;
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
    .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 16px; margin: 24px 0; }
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
    .disclaimer { margin-top: 32px; padding: 16px; background: #1e293b; border-left: 4px solid #f59e0b; border-radius: 4px; font-size: 0.85em; color: #cbd5e1; }
  </style>
</head>
<body>
  <h1>🎨 CS-9 Real Thumbnail Generation Report</h1>
  <p>Gerado em ${new Date().toLocaleString('pt-BR')} | Pipeline: SDXL-Turbo + CLIP ViT-B/32 + VisualContentGate</p>

  <div class="summary">
    <div class="stat"><div class="value">${totalGenerated}/9</div><div class="label">Thumbnails Geradas</div></div>
    <div class="stat"><div class="value">${allPassedCount}/9</div><div class="label">Todos Gates OK</div></div>
    <div class="stat"><div class="value">${avgQuality.toFixed(0)}</div><div class="label">Quality Score Médio</div></div>
    <div class="stat"><div class="value">${avgSemantic.toFixed(0)}%</div><div class="label">CLIP Score Médio</div></div>
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