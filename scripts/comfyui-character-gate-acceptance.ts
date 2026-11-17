/**
 * Character Composition Gate acceptance (CS9 continuation). For 2, 3 and 8 characters it runs, with a FROZEN creative
 * direction (no LLM call, so the prompt is identical across runs and seeds):
 *   before — the CS9 single generation, gate off;
 *   after  — the same recipe and first seed with the gate on (detectors, retries with new seeds and strategies).
 * Every gate attempt (accepted, rejected, needs_review) is saved with its seed, strategy, reasons and detector counts.
 * Nothing here approves an image: the final visual approval is the user's.
 *
 * Env: GATE_CASES=duo,trio,eight  GATE_SEED_OFFSET=0  GATE_MAX_ATTEMPTS=4
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import sharp, { type OverlayOptions } from 'sharp';
import { openDatabase } from '@neuralbridge/database';
import { AetheraCreativeStudioService } from '../apps/aethera-desktop/src/main/creative-studio-service.js';
import {
  evaluateCharacterGateCandidate,
  generateAiBackground,
  type CharacterGateCandidateEvaluation,
  type CharacterGateReport,
  type CreativeDirectionNotes,
  type ProfessionalPresetId,
} from '../packages/creative-studio/src/index.js';

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, '..');
const baseDir = join(root, 'artifacts', 'comfyui-character-gate-acceptance');
const runId = `run-${new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)}`;
const runDir = join(baseDir, runId);
const userDataDir = join(baseDir, 'userData');
const migrationsFolder = resolve(import.meta.dirname, '../packages/database/migrations');
const onlyCases = process.env.GATE_CASES?.split(',').filter(Boolean);
const seedOffset = Number(process.env.GATE_SEED_OFFSET ?? 0);
const maxAttempts = Number(process.env.GATE_MAX_ATTEMPTS ?? 4);

function gateAxisLabel(gate: CharacterGateReport | null): string {
  if (!gate) return 'count=? sem=? quality=?';
  const count = gate.attempts.find((attempt) => attempt.attempt === gate.chosenAttempt)?.gate?.verdict ?? '?';
  const semantic = gate.attempts.find((attempt) => attempt.attempt === gate.chosenAttempt)?.semantic?.verdict ?? 'not-run';
  const quality = gate.attempts.find((attempt) => attempt.attempt === gate.chosenAttempt)?.visualQuality?.verdict ?? 'not-run';
  return `count=${count} sem=${semantic} quality=${quality}`;
}

function evaluationAxisLabel(evaluation: CharacterGateCandidateEvaluation | null): string {
  if (!evaluation) return 'count=? sem=? quality=?';
  return `count=${evaluation.gate.verdict} sem=${evaluation.semantic?.verdict ?? 'not-run'} quality=${evaluation.visualQuality?.verdict ?? 'not-run'}`;
}

async function vramMiB(): Promise<number | null> {
  try {
    const { stdout } = await execFileAsync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits']);
    const value = Number.parseInt(stdout.trim().split(/\r?\n/)[0] ?? '', 10);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

interface GateCase {
  id: string;
  preset: ProfessionalPresetId;
  prompt: string;
  characterCount: number;
  seed: number;
  direction: CreativeDirectionNotes;
}

const cases: GateCase[] = [
  {
    id: 'duo',
    preset: 'anime_premium_cinematic',
    prompt: 'two distinct original anime warriors facing each other before a duel',
    characterCount: 2,
    seed: 31001,
    direction: {
      subject: 'two original anime warriors facing each other before a duel',
      setting: 'ruined mountain fortress at sunset',
      lighting: 'warm sunset rim light',
      style: 'polished anime key visual, clean line art',
      characters: [
        'young swordswoman with long silver hair and red scarf, white and crimson armor, katana raised',
        'tall spear warrior with short black hair, dark blue plated armor, spear held in guard',
      ],
    },
  },
  {
    id: 'trio',
    preset: 'cyberpunk_neon',
    prompt: 'three distinct cyberpunk heroes standing in a rain-slick futuristic street',
    characterCount: 3,
    seed: 31002,
    direction: {
      subject: 'three distinct cyberpunk heroes',
      setting: 'rain-slick futuristic street at night',
      lighting: 'cyan and magenta rim light',
      style: 'cinematic cyberpunk anime key art',
      characters: [
        'hooded hacker with glowing cyan visor and black techwear jacket',
        'muscular brawler with chrome cybernetic arms and red jacket',
        'female sniper with pink bob hair, long white coat and rifle on shoulder',
      ],
    },
  },
  {
    id: 'eight',
    preset: 'cyberpunk_neon',
    prompt: 'eight distinct cyberpunk heroes as a team lineup',
    characterCount: 8,
    seed: 31003,
    direction: {
      subject: 'eight distinct cyberpunk heroes as a team lineup',
      setting: 'neon city rooftop at night',
      lighting: 'cyan and magenta rim light',
      style: 'cinematic cyberpunk anime key art',
      characters: [
        'hooded hacker with cyan visor, black techwear',
        'woman with pink bob hair and white coat',
        'big brawler with chrome arms, red jacket',
        'young man with green mohawk and leather vest',
        'woman with long blue hair and purple bodysuit',
        'old mercenary with grey beard and armored vest',
        'girl with twin buns and yellow raincoat',
        'tall android with white plating and orange visor',
      ],
    },
  },
];

mkdirSync(join(userDataDir, 'db'), { recursive: true });
mkdirSync(runDir, { recursive: true });
const handle = openDatabase(join(userDataDir, 'db', 'creative.db'), { migrationsFolder });

try {
  const service = new AetheraCreativeStudioService({ db: handle.db, userDataDir });
  await service.saveImageEngineSettings({ endpoint: 'http://127.0.0.1:8000', checkpoint: 'animagine-xl-3.1.safetensors', releaseMemoryAfterGeneration: true });
  const poseControlNetModel = await service.comfyUiAdapter.findPoseControlNet();
  const results: Array<Record<string, unknown> & {
    id: string;
    mode: 'before' | 'after';
    file: string | null;
    gate?: CharacterGateReport | null;
    originalEvaluation?: CharacterGateCandidateEvaluation | null;
    repairDiffFiles?: string[];
  }> = [];

  for (const testCase of cases.filter((item) => !onlyCases || onlyCases.includes(item.id))) {
    for (const mode of ['before', 'after'] as const) {
      const label = `${testCase.id}-${mode}`;
      const started = Date.now();
      const vramBeforeMiB = await vramMiB();
      let vramPeakMiB = vramBeforeMiB;
      const sampler = setInterval(() => {
        void vramMiB().then((current) => {
          if (current !== null && (vramPeakMiB === null || current > vramPeakMiB)) vramPeakMiB = current;
        });
      }, 500);
      try {
        const generated = await generateAiBackground({
          artType: 'thumbnail',
          prompt: testCase.prompt,
          direction: testCase.direction,
          imageAdapter: service.imageAdapter,
          ingestion: service.ingestion,
          professionalPreset: testCase.preset,
          characterCount: testCase.characterCount,
          seed: testCase.seed + seedOffset,
          maxAttempts: 1,
          spatialControl: 'auto',
          ...(mode === 'after'
            ? {
                characterGate: {
                  detector: service.characterGateDetector,
                  maxAttempts,
                  requiredProviderId: service.comfyUiAdapter.id,
                  poseControlNetModel,
                  holdModels: (work) => service.comfyUiAdapter.withModelsHeld(work),
                  cutoutBatch: (paths) => service.batchCutout.cutout(paths),
                  semanticGate: { enabled: true, localizedRepair: true, repairUncertainAttributes: true, maxLocalizedRepairs: 3 },
                },
              }
            : {}),
        });
        const report = generated.report;
        let file: string | null = null;
        let generatedBuffer: Buffer | null = null;
        if (generated.asset) {
          file = join(runDir, `${label}.png`);
          generatedBuffer = await sharp(service.ingestion.resolvePortablePath(generated.asset.relativePath)).png().toBuffer();
          writeFileSync(file, generatedBuffer);
        }
        const gate = report.characterGate ?? null;
        const originalEvaluation = mode === 'before' && generatedBuffer && report.recipe
          ? await evaluateCharacterGateCandidate({
              adapter: service.imageAdapter,
              recipe: report.recipe,
              imageBuffer: generatedBuffer,
              config: { detector: service.characterGateDetector, semanticGate: { enabled: true } },
            })
          : null;
        const attemptFiles: string[] = [];
        const repairDiffFiles: string[] = [];
        for (const attempt of gate?.attempts ?? []) {
          const evidenceAssets: Array<{ ref: { relativePath: string; originalName: string }; kind: string }> = [];
          if (attempt.imageAsset) evidenceAssets.push({ ref: attempt.imageAsset, kind: 'final' });
          for (const [repairIndex, repair] of (attempt.repairs ?? []).entries()) {
            if (repair.maskAsset) evidenceAssets.push({ ref: repair.maskAsset, kind: `repair${repairIndex + 1}-${repair.status}-mask` });
            if (repair.originalImageAsset) evidenceAssets.push({ ref: repair.originalImageAsset, kind: `repair${repairIndex + 1}-${repair.status}-original` });
            if (repair.repairedImageAsset) evidenceAssets.push({ ref: repair.repairedImageAsset, kind: `repair${repairIndex + 1}-${repair.status}-repaired` });
            if (repair.differenceImageAsset) evidenceAssets.push({ ref: repair.differenceImageAsset, kind: `repair${repairIndex + 1}-${repair.status}-difference` });
          }
          for (const entry of evidenceAssets) {
            const path = join(runDir, `${label}-attempt${attempt.attempt}-${entry.kind}-${attempt.overallVerdict ?? attempt.gate?.verdict ?? attempt.status}-seed${attempt.seed}.png`);
            writeFileSync(path, await sharp(service.ingestion.resolvePortablePath(entry.ref.relativePath)).png().toBuffer());
            attemptFiles.push(path);
            if (entry.kind.includes('difference')) repairDiffFiles.push(path);
          }
        }
        results.push({
          id: testCase.id,
          mode,
          status: report.status,
          servedBy: report.servedBy ?? null,
          fallbackUsed: report.servedBy ? report.servedBy.providerId !== service.comfyUiAdapter.id || report.servedBy.fallbackErrors.length > 0 : null,
          checkpoint: (report.engineParameters as { checkpoint?: string } | undefined)?.checkpoint ?? null,
          seed: report.recipe?.seed ?? null,
          firstSeed: testCase.seed + seedOffset,
          characterCount: testCase.characterCount,
          frozenPositivePrompt: report.recipe?.positivePrompt ?? null,
          resolution: report.recipe ? `${report.recipe.width}x${report.recipe.height}` : null,
          ms: Date.now() - started,
          vramBeforeMiB,
          vramPeakMiB,
          file,
          attemptFiles,
          repairDiffFiles,
          originalEvaluation,
          gate,
          message: report.message,
        });
      } catch (error) {
        results.push({ id: testCase.id, mode, status: 'failed', file: null, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) });
      } finally {
        clearInterval(sampler);
      }
      const last = results.at(-1)!;
      console.log(`[gate] ${label}: ${String(last.status)} ${last.gate ? `${last.gate.verdict} ${gateAxisLabel(last.gate)} after ${last.gate.attempts.length} attempt(s), stop=${last.gate.stopReason}` : ''} in ${String(last.ms)} ms${last.error ? ` — ${String(last.error)}` : ''}`);
    }
  }

  // Contact sheet: per case — before (CS9 single pass) | after (gate choice) | every non-chosen gate attempt.
  const cellW = 448;
  const cellH = 256;
  const label = 34;
  const ids = [...new Set(results.map((result) => result.id))];
  const rows = ids.map((id) => {
    const before = results.find((result) => result.id === id && result.mode === 'before');
    const after = results.find((result) => result.id === id && result.mode === 'after');
    const tiles: Array<{ title: string; path: string | null }> = [
      { title: `before seed ${String(before?.seed ?? '?')} ${evaluationAxisLabel(before?.originalEvaluation ?? null)}`, path: before?.file ?? null },
      { title: `after: ${after?.gate?.verdict ?? String(after?.status)} (#${String(after?.gate?.chosenAttempt ?? '?')}) ${gateAxisLabel(after?.gate ?? null)}`, path: after?.file ?? null },
      ...((after?.repairDiffFiles as string[] | undefined) ?? []).map((path) => ({ title: path.split(/[\\/]/).pop()!.replace(`${id}-after-`, '').replace('.png', ''), path })),
    ];
    return { id, tiles };
  });
  const columns = Math.max(...rows.map((row) => row.tiles.length));
  const composites: OverlayOptions[] = [];
  const text = (value: string, width: number) =>
    Buffer.from(`<svg width="${width}" height="${label}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#111"/><text x="8" y="23" font-family="Segoe UI, Arial" font-size="16" fill="#eee">${value.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</text></svg>`);
  for (const [row, entry] of rows.entries()) {
    const top = row * (cellH + label * 2);
    composites.push({ input: text(`${entry.id}`, cellW * columns), left: 0, top });
    for (const [column, tile] of entry.tiles.entries()) {
      composites.push({ input: text(tile.title, cellW), left: column * cellW, top: top + label });
      const image = tile.path
        ? await sharp(tile.path).resize(cellW, cellH, { fit: 'contain', background: '#000' }).png().toBuffer()
        : await sharp({ create: { width: cellW, height: cellH, channels: 3, background: '#300' } }).png().toBuffer();
      composites.push({ input: image, left: column * cellW, top: top + label * 2 });
    }
  }
  const sheetPath = join(runDir, 'contact-sheet-before-after-gate.png');
  await sharp({ create: { width: cellW * columns, height: rows.length * (cellH + label * 2), channels: 3, background: '#000' } }).composite(composites).png().toFile(sheetPath);

  const report = {
    schemaVersion: 'cs10-attribute-evidence-repair-v2',
    runId,
    generatedAt: new Date().toISOString(),
    endpoint: 'http://127.0.0.1:8000',
    checkpoint: 'animagine-xl-3.1.safetensors',
    detectors: ['yolo_person (person_yolov8m-seg)', 'yolo_face (face_yolov8m, anime+real)', 'yolo_hand (hand_yolov8s)', 'openpose (lllyasviel body CNN, non-YOLO)'],
    semanticEvaluators: ['local-clip-vit-base-patch32 (existing local adapter)', 'local-visual-quality-critic (existing local adapter)'],
    evidencePolicy: {
      promptOriented: true,
      attributeLocalized: true,
      originalGateRecorded: true,
      regionalRepairRegression: true,
      missingDetectionIsNotAbsence: true,
      uncertainEvidence: 'needs_review',
      humanApprovalRequired: true,
    },
    poseControlNetModel,
    crowdSuppressionLora: 'off (not used)',
    contactSheet: sheetPath,
    results,
    humanReview: { status: 'pending', note: 'Gate verdicts are detector evidence. passed_pending_human_review is not an approval.' },
  };
  writeFileSync(join(runDir, 'report.json'), JSON.stringify(report, null, 2), 'utf8');
  console.log(JSON.stringify({ runId, sheetPath }, null, 2));
} finally {
  handle.close();
}
