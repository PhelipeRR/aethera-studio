/**
 * E2E Live Test — RecapVisionAdapter com Claude CLI real
 *
 * Este script executa uma análise multimodal VERDADEIRA usando:
 * 1. TaskEngine instanciado fora do Electron (SQLite temporário)
 * 2. ClaudeCliAdapter autenticado via OAuth
 * 3. Imagens reais do repositório como "painéis"
 * 4. RecapVisionAdapter conectado ao provider TaskEngine-backed
 * 5. Pipeline completo: import → extraction → narrative → script → Gate G
 *
 * Pré-requisitos:
 * - Claude CLI instalado e autenticado (`claude auth status`)
 * - Node.js 20+ com suporte a ESM
 *
 * Execução: npx tsx scripts/e2e-recap-vision-live.mts
 */

import { existsSync, mkdirSync, rmSync, writeFileSync, readFileSync, statSync, realpathSync } from 'node:fs';
import { join, dirname, basename, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import sharp from 'sharp';

// Database
import { openDatabase } from '@neuralbridge/database';

// Agents
import { ClaudeCliAdapter, CodexCliAdapter } from '@neuralbridge/agents';

// Orchestrator
import { TaskEngine, createTaskEngineVisionProvider } from '@neuralbridge/orchestrator';

// Cinema / Recap
import {
  createRecapVisionAdapter,
  runNarrativeAnalyzer,
  runStoryContinuityEngine,
  runScriptGenerator,
  runGateGNarrativeFidelity,
  saveCheckpoint,
  type ExtractedPanel,
  type VisionAdapter,
} from '@neuralbridge/cinema';

// ─── Configuração ──────────────────────────────────────────────────────────────

const REPO_ROOT = realpathSync(join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..'));
const TEST_DIR = join(tmpdir(), 'recap-e2e-live-' + Date.now());
const IMAGES_DIR = join(TEST_DIR, 'panels');
const OUTPUT_DIR = join(TEST_DIR, 'output');
const DB_FILE = join(TEST_DIR, 'test.db');
const MIGRATIONS_DIR = join(REPO_ROOT, 'packages', 'database', 'migrations');

// Imagens reais do repositório para usar como "painéis"
const SOURCE_IMAGES = [
  join(REPO_ROOT, '.agents', 'skills', 'motionvelix', 'templates', 'exemplos', 'img', 'abacaxi.webp'),
  join(REPO_ROOT, '.agents', 'skills', 'motionvelix', 'templates', 'exemplos', 'img', 'bala.webp'),
  join(REPO_ROOT, '.agents', 'skills', 'motionvelix', 'templates', 'exemplos', 'img', 'capim.webp'),
  join(REPO_ROOT, '.agents', 'skills', 'motionvelix', 'templates', 'exemplos', 'img', 'formiga.webp'),
];

// ─── Helpers ───────────────────────────────────────────────────────────────────

function log(step: string, message: string, data?: unknown) {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[${ts}] ${step}: ${message}`);
  if (data !== undefined) console.log(JSON.stringify(data, null, 2));
}

function elapsed(startMs: number): string {
  return `${((Date.now() - startMs) / 1000).toFixed(1)}s`;
}

async function convertToPng(sourcePath: string, destPath: string): Promise<{ width: number; height: number }> {
  const buffer = readFileSync(sourcePath);
  const metadata = await sharp(buffer).metadata();
  await sharp(buffer).png().toFile(destPath);
  return { width: metadata.width ?? 800, height: metadata.height ?? 600 };
}

function makePanel(
  id: string,
  pagePath: string,
  croppedImagePath: string,
  width: number,
  height: number,
  pageNumber: number,
  panelIndex: number,
): ExtractedPanel {
  const imageBuffer = readFileSync(croppedImagePath);
  const imageHash = createHash('sha256').update(imageBuffer).digest('hex').slice(0, 16);
  return {
    panelId: id,
    pagePath,
    croppedImagePath,
    metadata: {
      sourceKind: 'panel_crop',
      origin: 'webtoon_extract',
      chapterId: 'e2e-live-chapter',
      pageNumber,
      panelIndex,
      readingOrder: 'vertical',
      boundingBox: { x: 0, y: panelIndex * 400, w: width, h: height },
      classification: 'action',
      ocrStatus: 'not_run',
      ocrConfidence: 0,
    },
    imageHash,
    width,
    height,
  };
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const totalStart = Date.now();
  log('INIT', `Test directory: ${TEST_DIR}`);
  log('INIT', `Repository root: ${REPO_ROOT}`);

  // 1. Setup directories
  mkdirSync(IMAGES_DIR, { recursive: true });
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // 2. Validate source images exist
  const validSources = SOURCE_IMAGES.filter((p) => existsSync(p));
  if (validSources.length === 0) {
    log('ERROR', 'No source images found. Cannot proceed.');
    process.exit(1);
  }
  log('INIT', `Found ${validSources.length} source images`);

  // 3. Convert images to PNG and create panels
  const panels: ExtractedPanel[] = [];
  for (let i = 0; i < validSources.length; i++) {
    const src = validSources[i]!;
    const destName = `panel_${String(i).padStart(3, '0')}.png`;
    const destPath = join(IMAGES_DIR, destName);
    const { width, height } = await convertToPng(src, destPath);
    panels.push(makePanel(`panel-${i}`, destPath, destPath, width, height, 0, i));
    log('IMPORT', `Panel ${i}: ${basename(src)} → ${destName} (${width}x${height})`);
  }

  // 4. Open database
  log('DB', 'Opening temporary SQLite database...');
  const handle = openDatabase(DB_FILE, { migrationsFolder: MIGRATIONS_DIR });
  log('DB', `Database ready: ${DB_FILE}`);

  // 5. Create agent adapters
  const claudeAdapter = new ClaudeCliAdapter();
  const codexAdapter = new CodexCliAdapter();

  const claudeStatus = await claudeAdapter.detect();
  const codexStatus = await codexAdapter.detect();

  log('AGENTS', 'Claude CLI', {
    installed: claudeStatus.installed,
    version: claudeStatus.version,
    authenticated: claudeStatus.authenticated,
    problems: claudeStatus.problems,
  });
  log('AGENTS', 'Codex CLI', {
    installed: codexStatus.installed,
    version: codexStatus.version,
    authenticated: codexStatus.authenticated,
    problems: codexStatus.problems,
  });

  if (!claudeStatus.installed || !claudeStatus.authenticated) {
    log('BLOCKED', 'Claude CLI not available or not authenticated.');
    log('BLOCKED', 'Run `claude auth login` and retry.');
    handle.close();
    process.exit(1);
  }

  // 6. Create TaskEngine
  log('ENGINE', 'Creating TaskEngine...');
  const taskEngine = new TaskEngine({
    handle,
    adapters: { claude: claudeAdapter, codex: codexAdapter },
    availability: async () => ({
      claude: claudeStatus.installed && claudeStatus.problems.length === 0,
      codex: codexStatus.installed && codexStatus.problems.length === 0,
    }),
    limits: { maxIterations: 1, stepTimeoutMs: 120_000, tokenBudget: 500_000 },
  });
  log('ENGINE', 'TaskEngine ready');

  // 7. Create TaskEngine-backed VisualAnalysisProvider
  log('PROVIDER', 'Creating TaskEngine vision provider (Claude)...');
  const taskEngineProvider = createTaskEngineVisionProvider({
    id: 'claude',
    model: '',
    root: TEST_DIR,
    projectId: null, // lean run — no project FK needed
    enabled: true,
    taskEngine,
    checkAvailable: async () => ({ available: true }),
  });

  const detectResult = await taskEngineProvider.detect();
  log('PROVIDER', 'Provider detection', detectResult);

  if (!('available' in detectResult) || !detectResult.available) {
    log('BLOCKED', 'Vision provider not available', detectResult);
    handle.close();
    process.exit(1);
  }

  // 8. Direct provider test — call analyze directly to diagnose errors
  log('DIRECT-TEST', 'Testing provider.analyze() directly on first panel...');
  const testPanel = panels[0]!;
  const testImagePath = testPanel.croppedImagePath ?? testPanel.pagePath;
  try {
    if (!taskEngineProvider.analyze) {
      log('DIRECT-TEST', 'ERROR: provider has no analyze method');
    } else {
      const directStart = Date.now();
      const directResult = await taskEngineProvider.analyze({
        frames: [{ hash: 'test', path: testImagePath }],
        context: 'Manga panel visual analysis test.',
      });
      log('DIRECT-TEST', `Success in ${elapsed(directStart)}`, {
        nature: directResult.nature,
        confidence: directResult.confidence,
        description: directResult.description.slice(0, 120),
        entities: directResult.entities.length,
        actions: directResult.actions.length,
        model: taskEngineProvider.lastReportedModel?.(),
      });
    }
  } catch (err) {
    log('DIRECT-TEST', `FAILED: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.cause) {
      log('DIRECT-TEST', `Cause: ${err.cause instanceof Error ? err.cause.message : String(err.cause)}`);
    }
  }

  // 9. Create RecapVisionAdapter bridging to the TaskEngine provider
  log('ADAPTER', 'Creating RecapVisionAdapter...');
  const recapAdapter = createRecapVisionAdapter({
    root: TEST_DIR,
    provider: taskEngineProvider as Parameters<typeof createRecapVisionAdapter>[0]['provider'],
  });
  log('ADAPTER', `Adapter name: ${recapAdapter.name}`);

  // 10. Run Narrative Analysis with REAL vision
  log('ANALYSIS', `Starting narrative analysis of ${panels.length} panels with live Claude vision...`);
  const analysisStart = Date.now();

  const analysisResult = await runNarrativeAnalyzer({
    panels,
    visionAdapter: recapAdapter,
    analyzedBy: recapAdapter.name,
    minConfidence: 0.3,
  });

  log('ANALYSIS', `Completed in ${elapsed(analysisStart)}`, {
    panelsAnalyzed: analysisResult.analyses.length,
    warnings: analysisResult.warnings.length,
  });

  // Print detailed evidence per panel
  for (const analysis of analysisResult.analyses) {
    const trace = recapAdapter.getLastTrace();
    log('PANEL', `${analysis.panelId}`, {
      characters: analysis.characters,
      actions: analysis.actions.map((a) => `${a.type}: ${a.description}`),
      emotions: analysis.emotions,
      setting: analysis.setting,
      confidence: analysis.analysisConfidence,
      evidenceCount: analysis.evidence.length,
      evidenceKinds: [...new Set(analysis.evidence.map((e) => e.kind))],
      provider: trace?.provider,
      model: trace?.model,
    });
  }

  // 10. Story Continuity
  log('CONTINUITY', 'Building narrative sequence...');
  const continuityResult = runStoryContinuityEngine({
    chapterId: 'e2e-live-chapter',
    analyses: analysisResult.analyses,
    readingOrder: 'vertical',
    minBeatConfidence: 0.3,
  });
  log('CONTINUITY', `Sequence: ${continuityResult.sequence.beats.length} beats`, {
    warnings: continuityResult.warnings.length,
  });

  // 11. Script Generation
  log('SCRIPT', 'Generating PT-BR script...');
  const scriptResult = runScriptGenerator({
    sequence: continuityResult.sequence,
    panels,
    style: 'narrative_recap',
    generatedBy: 'e2e-live-claude-vision',
  });
  log('SCRIPT', `Script: ${scriptResult.script.scenes.length} scenes, ${scriptResult.script.totalEstimatedDurationSec}s estimated`, {
    title: scriptResult.script.title,
    warnings: scriptResult.warnings.length,
  });

  // Print script summary
  for (const scene of scriptResult.script.scenes) {
    log('SCENE', `${scene.sceneId}: ${scene.title}`, {
      beatIds: scene.beatIds,
      panelRefs: scene.panelReferences,
      narrationSnippet: scene.narrationText?.slice(0, 100),
    });
  }

  // 12. Gate G — Narrative Fidelity
  log('GATE-G', 'Running narrative fidelity validation...');
  const gateGReport = runGateGNarrativeFidelity({
    script: scriptResult.script,
    panels,
    minSceneConfidence: 0.24,
  });
  log('GATE-G', `Verdict: ${gateGReport.verdict}`, {
    reasons: gateGReport.reasons,
    metrics: gateGReport.metrics,
    hints: gateGReport.hints.length,
  });

  // 13. Save checkpoint
  log('CHECKPOINT', 'Saving final checkpoint...');
  const checkpointDir = join(OUTPUT_DIR, 'e2e-live-chapter', 'checkpoints');
  mkdirSync(checkpointDir, { recursive: true });
  saveCheckpoint(checkpointDir, {
    chapterId: 'e2e-live-chapter',
    completedStages: ['import', 'extraction', 'narrative', 'fidelity'],
    lastUpdatedAtIso: new Date().toISOString(),
    sourceHash: panels[0]?.imageHash ?? 'unknown',
    extractedPanels: panels,
    warnings: [...analysisResult.warnings, ...continuityResult.warnings, ...scriptResult.warnings],
  });
  log('CHECKPOINT', 'Checkpoint saved');

  // 14. Final summary
  log('COMPLETE', `E2E Live test finished in ${elapsed(totalStart)}`, {
    provider: recapAdapter.name,
    panelsAnalyzed: analysisResult.analyses.length,
    beatsGenerated: continuityResult.sequence.beats.length,
    scenesGenerated: scriptResult.script.scenes.length,
    gateGVerdict: gateGReport.verdict,
    totalWarnings: analysisResult.warnings.length + continuityResult.warnings.length + scriptResult.warnings.length,
    outputDir: OUTPUT_DIR,
  });

  // Cleanup
  handle.close();
  log('CLEANUP', `Database closed. Test artifacts at: ${TEST_DIR}`);
  log('CLEANUP', 'To inspect results, keep the directory. To auto-clean, delete it manually.');
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});