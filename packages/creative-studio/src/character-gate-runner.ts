import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { AssetIngestionService } from './asset-ingestion.js';
import {
  characterGateRank,
  evaluateCharacterComposition,
  type CharacterGateEvidence,
  type CharacterGateOptions,
  type CharacterGateResult,
} from './character-gate.js';
import type { CompositionStrategyParams, ExternalImageAdapter, ImageGenerationRequest, VisualQualityInspectionResult } from './image-generation-adapter.js';
import { generateLayeredComposition } from './layered-composition.js';
import { evaluateSemanticSceneGate, type SemanticSceneGateOptions, type SemanticSceneGateResult } from './semantic-scene-gate.js';
import type { VisualRecipe } from './visual-recipe.js';

const execFileAsync = promisify(execFile);

export interface CharacterGateDetection {
  device: string;
  loadMs: number;
  peakTorchMiB: number;
  results: Array<CharacterGateEvidence & { image: string; durationMs?: number; error?: string }>;
}

export interface CharacterGateDetector {
  readonly id: string;
  detect(imagePaths: string[]): Promise<CharacterGateDetection>;
}

function defaultWorkerPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, '..', 'scripts', 'character_gate_worker.py');
  return existsSync(candidate) ? candidate : resolve(process.cwd(), 'packages', 'creative-studio', 'scripts', 'character_gate_worker.py');
}

/**
 * Runs scripts/character_gate_worker.py with the ComfyUI venv interpreter, so the detectors and their weights are the
 * ones already installed for ComfyUI (Impact Pack ultralytics models, controlnet_aux OpenPose). Peak ~540 MiB VRAM.
 */
export class LocalCharacterGateDetector implements CharacterGateDetector {
  readonly id = 'local-character-gate';
  private readonly pythonPath: string;
  private readonly comfyUiRoot: string;
  private readonly workerPath: string;
  private readonly timeoutMs: number;

  constructor(options: { pythonPath: string; comfyUiRoot: string; workerPath?: string; timeoutMs?: number }) {
    this.pythonPath = options.pythonPath;
    this.comfyUiRoot = options.comfyUiRoot;
    this.workerPath = options.workerPath ?? defaultWorkerPath();
    this.timeoutMs = options.timeoutMs ?? 180_000;
  }

  async detect(imagePaths: string[]): Promise<CharacterGateDetection> {
    const workDir = mkdtempSync(join(tmpdir(), 'aethera-gate-'));
    const out = join(workDir, 'evidence.json');
    try {
      await execFileAsync(this.pythonPath, ['-I', '-W', 'ignore', this.workerPath, '--comfyui-root', this.comfyUiRoot, '--out', out, ...imagePaths], {
        timeout: this.timeoutMs,
        maxBuffer: 16 * 1024 * 1024,
      });
      return JSON.parse(readFileSync(out, 'utf8')) as CharacterGateDetection;
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

export interface CompositionAttemptStrategy {
  id: string;
  kind: 'regional' | 'layered';
  params: CompositionStrategyParams;
  rationale: string;
}

const BASE: CompositionAttemptStrategy = { id: 'regional-base', kind: 'regional', params: {}, rationale: 'CS9 regional graph: one OpenPose skeleton per region' };
const EMPTY_SCENE: CompositionAttemptStrategy = {
  id: 'regional-empty-scene',
  kind: 'regional',
  params: { sceneStrength: 0.35, sceneSuffix: 'empty, deserted, no bystanders' },
  rationale: 'extra figures: weaker, emptier masked scene prompt (global prompt untouched)',
};
const EMPTY_SCENE_STRONG_POSE: CompositionAttemptStrategy = {
  id: 'regional-empty-scene-strong-pose',
  kind: 'regional',
  params: { sceneStrength: 0.35, sceneSuffix: 'empty, deserted, no bystanders', poseStrengthDelta: 0.1, poseEndPercent: 1 },
  rationale: 'extra figures again: empty scene plus pose control until the last step',
};
const STRONG_POSE: CompositionAttemptStrategy = {
  id: 'regional-strong-pose',
  kind: 'regional',
  params: { poseStrengthDelta: 0.15, poseEndPercent: 1, regionStrength: 1.1 },
  rationale: 'missing/fused/uncertain characters: stronger skeletons and region prompts',
};
const STRONG_CALM: CompositionAttemptStrategy = {
  id: 'regional-strong-calm',
  kind: 'regional',
  params: { calmStrength: 1.1, poseStrengthDelta: 0.1, poseEndPercent: 1 },
  rationale: 'placement: stronger calm-zone prompt and pose control',
};
const LAYERED: CompositionAttemptStrategy = {
  id: 'layered-individual',
  kind: 'layered',
  params: {},
  rationale: 'one generation per character composited into the regions, then a low-denoise harmonization pass',
};

const LADDERS: Record<Exclude<CharacterGateResult['failureClass'], 'none'>, CompositionAttemptStrategy[]> = {
  extras: [EMPTY_SCENE, EMPTY_SCENE_STRONG_POSE, LAYERED],
  missing: [STRONG_POSE, LAYERED],
  anatomy: [STRONG_POSE, LAYERED],
  placement: [STRONG_POSE, STRONG_CALM, LAYERED],
  uncertain: [STRONG_POSE, LAYERED],
};

/**
 * Next strategy for a failure class. A strategy already tried is never repeated (a seed change alone is not a new
 * attempt), so the run stops when the ladder is exhausted instead of burning attempts on equivalent graphs.
 */
export function nextCompositionStrategy(input: {
  failureClass: CharacterGateResult['failureClass'] | null;
  tried: string[];
  characterCount: number;
  layeredAvailable: boolean;
  largeGroupThreshold: number;
}): CompositionAttemptStrategy | null {
  const usable = (strategy: CompositionAttemptStrategy) => !input.tried.includes(strategy.id) && (strategy.kind !== 'layered' || input.layeredAvailable);
  if (input.failureClass === null) {
    return input.characterCount >= input.largeGroupThreshold && input.layeredAvailable ? LAYERED : BASE;
  }
  if (input.failureClass === 'none') return null;
  const ladder = LADDERS[input.failureClass];
  return ladder.find(usable) ?? [BASE, ...Object.values(LADDERS).flat()].find(usable) ?? null;
}

export interface CharacterGateConfig {
  detector: CharacterGateDetector;
  /** Total generations (first included); default 4, capped at 6. */
  maxAttempts?: number;
  options?: CharacterGateOptions;
  /**
   * Retry on needs_review too: 'actionable' (default) retries when characters may be missing/illegible or badly placed
   * or scaled — failures a new strategy can address; detector disagreement on a correct count is left to the human.
   */
  retryOnNeedsReview?: 'never' | 'actionable' | 'always';
  /** Groups at or above this size start with the layered strategy when it is available (default 6). */
  largeGroupThreshold?: number;
  /** OpenPose ControlNet installed in ComfyUI; null disables the layered strategy. */
  poseControlNetModel?: string | null;
  /** Generations served by any other provider are invalid attempts (no silent fallback). */
  requiredProviderId?: string;
  /** Keeps engine models loaded during the layered strategy's portrait batch. */
  holdModels?: <T>(work: () => Promise<T>) => Promise<T>;
  /** Batch cutout for the layered strategy (one process for all portraits). */
  cutoutBatch?: (imagePaths: string[]) => Promise<Buffer[]>;
  /** Seed step between attempts (default 7919). */
  seedStride?: number;
  /** CS10 prompt-oriented semantic and local visual-quality evidence. Undefined preserves CS9 count-only behavior. */
  semanticGate?: {
    enabled?: boolean;
    options?: SemanticSceneGateOptions;
    localizedRepair?: boolean;
    repairStrength?: number;
  };
}

export interface CharacterGateVisualQualityReport {
  verdict: CharacterGateResult['verdict'];
  evaluatorId: string | null;
  anatomicalConsistency: number | null;
  physicalCoherence: number | null;
  compositionQuality: number | null;
  subjectIdentityConsistency: number | null;
  visualArtifactSeverity: number | null;
  localizedDefects: VisualQualityInspectionResult['localizedDefects'];
  reasons: string[];
}

export interface CharacterGateRepairReport {
  status: 'not_requested' | 'skipped' | 'applied' | 'failed';
  bbox: { x: number; y: number; width: number; height: number } | null;
  seed: number | null;
  originalImageAsset: { relativePath: string; originalName: string } | null;
  repairedImageAsset: { relativePath: string; originalName: string } | null;
  reason?: string;
}

export interface CharacterGateAttempt {
  attempt: number;
  seed: number;
  strategy: CompositionAttemptStrategy;
  status: 'evaluated' | 'wrong_provider' | 'error';
  servedBy: { providerId: string; fallbackErrors: string[] } | null;
  engineParameters: unknown;
  gate: CharacterGateResult | null;
  semantic: SemanticSceneGateResult | null;
  visualQuality: CharacterGateVisualQualityReport | null;
  overallVerdict: CharacterGateResult['verdict'] | null;
  repair: CharacterGateRepairReport;
  detector: { device: string; loadMs: number; peakTorchMiB: number; durationMs: number } | null;
  /** Managed-storage path of the image when it was not the chosen one (rejected / superseded evidence). */
  imageAsset: { relativePath: string; originalName: string } | null;
  layered: { plateSeed: number; layers: Array<{ regionIndex: number; seed: number }>; harmonizeStrength: number } | null;
  error?: string;
  durationMs: number;
}

export interface CharacterGateReport {
  enabled: true;
  verdict: CharacterGateResult['verdict'] | 'no_valid_attempt';
  chosenAttempt: number | null;
  stopReason: 'passed' | 'needs_review_not_retried' | 'max_attempts' | 'strategies_exhausted' | 'no_valid_attempt';
  frozenPrompt: { positive: string; negative: string; regions: string[]; scene: string | null };
  failureCategories: { count: string[]; semantic: string[]; visualQuality: string[] };
  attempts: CharacterGateAttempt[];
  note: string;
}

export interface CharacterGateOutcome {
  image: Buffer;
  seed: number;
  servedBy: { providerId: string; fallbackErrors: string[] } | null;
  engineParameters: unknown;
  report: CharacterGateReport;
}

type ServedReporter = ExternalImageAdapter & {
  getLastServedProvider?: () => { providerId: string; fallbackErrors: string[] } | null;
  getLastGenerationMetadata?: () => unknown;
};

function shouldRetry(result: CharacterGateResult, policy: NonNullable<CharacterGateConfig['retryOnNeedsReview']>): boolean {
  if (result.verdict === 'rejected') return true;
  if (result.verdict !== 'needs_review') return false;
  return policy === 'always' || (policy === 'actionable' && (result.failureClass === 'missing' || result.failureClass === 'placement'));
}

function inspectVisualQuality(result: VisualQualityInspectionResult | null, enabled: boolean): CharacterGateVisualQualityReport | null {
  if (!enabled) return null;
  if (!result) {
    return {
      verdict: 'needs_review',
      evaluatorId: null,
      anatomicalConsistency: null,
      physicalCoherence: null,
      compositionQuality: null,
      subjectIdentityConsistency: null,
      visualArtifactSeverity: null,
      localizedDefects: [],
      reasons: ['visual_quality_evaluator_unavailable'],
    };
  }
  const severeArtifact = result.visualArtifactSeverity >= 85;
  const severeDefect = result.localizedDefects.some((defect) => defect.severity === 'severe' && !defect.repaired);
  const hasDefect = result.localizedDefects.some((defect) => !defect.repaired && defect.severity !== 'none');
  const weakMetric = [result.anatomicalConsistency, result.physicalCoherence, result.compositionQuality, result.subjectIdentityConsistency].some((value) => value < 70);
  const reasons = [
    ...(severeArtifact ? ['severe_visual_artifact'] : []),
    ...(severeDefect ? ['severe_localized_visual_defect'] : []),
    ...(!severeArtifact && !severeDefect && hasDefect ? ['localized_visual_defect'] : []),
    ...(!severeArtifact && !severeDefect && weakMetric ? ['weak_visual_quality_metric'] : []),
  ];
  return {
    verdict: severeArtifact || severeDefect ? 'rejected' : reasons.length > 0 ? 'needs_review' : 'passed_pending_human_review',
    evaluatorId: result.evaluatorId,
    anatomicalConsistency: result.anatomicalConsistency,
    physicalCoherence: result.physicalCoherence,
    compositionQuality: result.compositionQuality,
    subjectIdentityConsistency: result.subjectIdentityConsistency,
    visualArtifactSeverity: result.visualArtifactSeverity,
    localizedDefects: result.localizedDefects,
    reasons,
  };
}

function combinedVerdict(
  count: CharacterGateResult,
  semantic: SemanticSceneGateResult | null,
  quality: CharacterGateVisualQualityReport | null,
): CharacterGateResult['verdict'] {
  if (count.verdict === 'rejected' || semantic?.verdict === 'rejected' || quality?.verdict === 'rejected') return 'rejected';
  if (count.verdict === 'needs_review' || semantic?.verdict === 'needs_review' || quality?.verdict === 'needs_review') return 'needs_review';
  return 'passed_pending_human_review';
}

function failureCategories(
  count: CharacterGateResult,
  semantic: SemanticSceneGateResult | null,
  quality: CharacterGateVisualQualityReport | null,
): CharacterGateReport['failureCategories'] {
  return {
    count: count.reasons.filter((reason) => reason.severity !== 'info').map((reason) => reason.code),
    semantic: semantic?.failureCategories.semantic ?? [],
    visualQuality: quality?.reasons ?? [],
  };
}

function combinedRank(attempt: CharacterGateAttempt): number {
  const verdict = attempt.overallVerdict ?? attempt.gate?.verdict ?? 'rejected';
  const base = verdict === 'passed_pending_human_review' ? 3000 : verdict === 'needs_review' ? 1500 : 0;
  const countRank = attempt.gate ? characterGateRank(attempt.gate) : 0;
  const semanticScore = attempt.semantic?.semanticScore ?? 0;
  const qualityScore = attempt.visualQuality
    ? (attempt.visualQuality.anatomicalConsistency ?? 0) + (attempt.visualQuality.physicalCoherence ?? 0) + (attempt.visualQuality.compositionQuality ?? 0) + (attempt.visualQuality.subjectIdentityConsistency ?? 0)
    : 0;
  return base + countRank + Math.round(semanticScore * 100) + qualityScore - (attempt.semantic?.criteria.filter((criterion) => criterion.status !== 'confirmed').length ?? 0) * 10;
}

function shouldRetryCombined(
  attempt: CharacterGateAttempt,
  policy: NonNullable<CharacterGateConfig['retryOnNeedsReview']>,
): boolean {
  if (attempt.overallVerdict === 'rejected') return true;
  if (attempt.overallVerdict !== 'needs_review') return false;
  if (policy === 'always') return true;
  if (policy === 'actionable' && attempt.gate && shouldRetry(attempt.gate, policy)) return true;
  return Boolean(attempt.visualQuality?.reasons.includes('localized_visual_defect'));
}

/**
 * Generates with the frozen recipe (same prompt, regions and sampler on every attempt), evaluates each image with the
 * Character Composition Gate and retries with a new seed AND a new strategy while the gate rejects. The best attempt
 * is returned with every attempt logged; the verdict is never upgraded to "approved".
 */
export async function runCharacterCompositionGate(input: {
  adapter: ExternalImageAdapter;
  ingestion: AssetIngestionService;
  recipe: VisualRecipe;
  baseRequest: ImageGenerationRequest;
  config: CharacterGateConfig;
}): Promise<CharacterGateOutcome> {
  const { adapter, recipe, baseRequest, config } = input;
  if (!adapter.generateImage) throw new Error('The image engine cannot generate images.');
  const maxAttempts = Math.min(6, Math.max(1, Math.floor(config.maxAttempts ?? 4)));
  const retryPolicy = config.retryOnNeedsReview ?? 'actionable';
  const stride = config.seedStride ?? 7919;
  const reporter = adapter as ServedReporter;
  const workDir = mkdtempSync(join(tmpdir(), 'aethera-gate-run-'));
  const attempts: CharacterGateAttempt[] = [];
  const images = new Map<number, Buffer>();
  const originalImages = new Map<number, Buffer>();
  const tried: string[] = [];
  let stopReason: CharacterGateReport['stopReason'] = 'max_attempts';
  let lastFailure: CharacterGateResult['failureClass'] | null = null;
  const regionRects = recipe.characterRegions.map(({ x, y, width, height }) => ({ x, y, width, height }));

  const assertProvider = (step: string) => {
    const served = reporter.getLastServedProvider?.() ?? null;
    if (config.requiredProviderId && served && served.providerId !== config.requiredProviderId) {
      throw new Error(`${step} was served by ${served.providerId}, not ${config.requiredProviderId} (fallback: ${served.fallbackErrors.join(' | ') || 'none'}).`);
    }
  };

  try {
    for (let index = 0; index < maxAttempts; index += 1) {
      const strategy = nextCompositionStrategy({
        failureClass: lastFailure,
        tried,
        characterCount: recipe.characterRegions.length,
        layeredAvailable: Boolean(config.poseControlNetModel) && Boolean(adapter.removeBackground),
        largeGroupThreshold: config.largeGroupThreshold ?? 6,
      });
      if (!strategy) {
        stopReason = 'strategies_exhausted';
        break;
      }
      tried.push(strategy.id);
      const seed = (recipe.seed + index * stride) % 0x80000000;
      const started = Date.now();
      const attempt: CharacterGateAttempt = {
        attempt: index + 1,
        seed,
        strategy,
        status: 'evaluated',
        servedBy: null,
        engineParameters: null,
        gate: null,
        semantic: null,
        visualQuality: null,
        overallVerdict: null,
        repair: { status: 'not_requested', bbox: null, seed: null, originalImageAsset: null, repairedImageAsset: null },
        detector: null,
        imageAsset: null,
        layered: null,
        durationMs: 0,
      };
      attempts.push(attempt);
      let image: Buffer;
      try {
        if (strategy.kind === 'layered') {
          const layered = await generateLayeredComposition({
            adapter,
            recipe,
            baseRequest,
            seed,
            poseControlNetModel: config.poseControlNetModel as string,
            workDir,
            assertProvider,
            ...(config.holdModels ? { holdModels: config.holdModels } : {}),
            ...(config.cutoutBatch ? { cutoutBatch: config.cutoutBatch } : {}),
          });
          image = layered.image;
          attempt.layered = { plateSeed: layered.plateSeed, layers: layered.layers.map(({ regionIndex, seed: layerSeed }) => ({ regionIndex, seed: layerSeed })), harmonizeStrength: layered.harmonizeStrength };
        } else {
          image = await adapter.generateImage({ ...baseRequest, seed, compositionStrategy: strategy.params });
          assertProvider('generation');
        }
        attempt.servedBy = reporter.getLastServedProvider?.() ?? null;
        attempt.engineParameters = reporter.getLastGenerationMetadata?.() ?? null;
      } catch (error) {
        attempt.status = /served by/.test(String(error)) ? 'wrong_provider' : 'error';
        attempt.error = error instanceof Error ? error.message : String(error);
        attempt.servedBy = reporter.getLastServedProvider?.() ?? null;
        attempt.durationMs = Date.now() - started;
        lastFailure = 'uncertain';
        continue;
      }
      originalImages.set(attempt.attempt, image);
      images.set(attempt.attempt, image);
      const semanticEnabled = config.semanticGate?.enabled === true;
      const evaluateCandidate = async (candidate: Buffer, candidatePath: string): Promise<void> => {
        writeFileSync(candidatePath, candidate);
        const detectStarted = Date.now();
        let evidence: CharacterGateEvidence | undefined;
        try {
          const detection = await config.detector.detect([candidatePath]);
          const detected = detection.results[0];
          if (!detected || detected.error) throw new Error(detected?.error ?? 'detector returned no result');
          evidence = detected;
          attempt.detector = { device: detection.device, loadMs: detection.loadMs, peakTorchMiB: detection.peakTorchMiB, durationMs: Date.now() - detectStarted };
          attempt.gate = evaluateCharacterComposition({
            evidence,
            expectedCount: recipe.characterRegions.length,
            regions: regionRects,
            ...(recipe.calmZones?.length ? { calmZones: recipe.calmZones } : {}),
            ...(config.options ? { options: config.options } : {}),
          });
        } catch (error) {
          // A detector failure is never a pass: the attempt stays in review with the error recorded.
          attempt.gate = evaluateCharacterComposition({
            evidence: { width: recipe.width, height: recipe.height, detectors: { yolo_person: { error: error instanceof Error ? error.message : String(error) } } },
            expectedCount: recipe.characterRegions.length,
          });
        }
        if (semanticEnabled) {
          attempt.semantic = await evaluateSemanticSceneGate({
            imageBuffer: candidate,
            recipe,
            adapter: adapter.evaluateImageSemantics
              ? { evaluateImageSemantics: adapter.evaluateImageSemantics.bind(adapter) }
              : null,
            ...(evidence ? { evidence } : {}),
            ...(config.semanticGate?.options ? { options: config.semanticGate.options } : {}),
          });
          let inspected: VisualQualityInspectionResult | null = null;
          if (adapter.inspectVisualQuality) {
            try {
              inspected = await adapter.inspectVisualQuality({ imageBuffer: candidate, genre: recipe.preset.includes('anime') ? 'anime' : 'general' });
            } catch {
              inspected = null;
            }
          }
          attempt.visualQuality = inspectVisualQuality(inspected, true);
        } else {
          attempt.semantic = null;
          attempt.visualQuality = null;
        }
        attempt.overallVerdict = combinedVerdict(attempt.gate, attempt.semantic, attempt.visualQuality);
      };
      await evaluateCandidate(image, join(workDir, `attempt-${attempt.attempt}.png`));

      if (semanticEnabled && config.semanticGate?.localizedRepair && attempt.overallVerdict === 'rejected' && adapter.inpaintRegion) {
        const semanticCandidate = attempt.semantic?.repairCandidates[0];
        const qualityCandidate = attempt.visualQuality?.localizedDefects.find((defect) => defect.severity === 'severe' && !defect.repaired)
          ?? attempt.visualQuality?.localizedDefects.find((defect) => defect.severity === 'moderate' && !defect.repaired);
        const repairCandidate = semanticCandidate
          ? { bbox: semanticCandidate.bbox, prompt: semanticCandidate.prompt, reason: semanticCandidate.reason }
          : qualityCandidate
            ? { bbox: qualityCandidate.bbox, prompt: `Repair only this localized visual defect while preserving identity and lighting: ${qualityCandidate.description}`, reason: qualityCandidate.description }
            : null;
        if (repairCandidate) {
          const repairSeed = (seed ^ Math.round(repairCandidate.bbox.x * 31 + repairCandidate.bbox.y * 17 + repairCandidate.bbox.width * 13 + repairCandidate.bbox.height * 7)) >>> 0;
          attempt.repair = { status: 'applied', bbox: repairCandidate.bbox, seed: repairSeed, originalImageAsset: null, repairedImageAsset: null };
          try {
            image = await adapter.inpaintRegion({
              imageBuffer: image,
              prompt: repairCandidate.prompt,
              negativePrompt: recipe.negativePrompt,
              bbox: repairCandidate.bbox,
              strength: config.semanticGate.repairStrength ?? 0.48,
              seed: repairSeed,
            });
            images.set(attempt.attempt, image);
            await evaluateCandidate(image, join(workDir, `attempt-${attempt.attempt}-repaired.png`));
          } catch (error) {
            attempt.repair = { status: 'failed', bbox: repairCandidate.bbox, seed: repairSeed, originalImageAsset: null, repairedImageAsset: null, reason: error instanceof Error ? error.message : String(error) };
            attempt.overallVerdict = 'needs_review';
          }
        } else {
          attempt.repair = { status: 'skipped', bbox: null, seed: null, originalImageAsset: null, repairedImageAsset: null, reason: 'No localized bbox was supported by the evidence.' };
        }
      }
      attempt.durationMs = Date.now() - started;
      if (attempt.overallVerdict === 'passed_pending_human_review') {
        stopReason = 'passed';
        break;
      }
      if (!shouldRetryCombined(attempt, retryPolicy)) {
        stopReason = 'needs_review_not_retried';
        break;
      }
      lastFailure = attempt.gate?.failureClass ?? 'uncertain';
    }

    const evaluated = attempts.filter((attempt) => attempt.gate && images.has(attempt.attempt));
    if (evaluated.length === 0) {
      throw new Error(`Character Composition Gate: no valid attempt (${attempts.map((attempt) => `#${attempt.attempt} ${attempt.status}: ${attempt.error ?? ''}`).join('; ')}).`);
    }
    const chosen = evaluated.reduce((best, attempt) => (combinedRank(attempt) > combinedRank(best) ? attempt : best));
    for (const attempt of evaluated) {
      if (attempt.repair.status === 'applied') {
        const originalName = `ai-gate-original-${attempt.gate!.verdict}-attempt${attempt.attempt}-${attempt.seed}.png`;
        const originalAsset = await input.ingestion.ingestBuffer({ buffer: originalImages.get(attempt.attempt)!, kind: 'image', extension: 'png', originalName });
        attempt.repair.originalImageAsset = { relativePath: originalAsset.relativePath, originalName };
        const repairedName = `ai-gate-repaired-${attempt.overallVerdict ?? attempt.gate!.verdict}-attempt${attempt.attempt}-${attempt.seed}.png`;
        const repairedAsset = await input.ingestion.ingestBuffer({ buffer: images.get(attempt.attempt)!, kind: 'image', extension: 'png', originalName: repairedName });
        attempt.repair.repairedImageAsset = { relativePath: repairedAsset.relativePath, originalName: repairedName };
      }
      if (attempt === chosen) continue;
      const originalName = `ai-gate-${attempt.overallVerdict ?? attempt.gate!.verdict}-attempt${attempt.attempt}-${attempt.seed}.png`;
      const asset = await input.ingestion.ingestBuffer({ buffer: images.get(attempt.attempt)!, kind: 'image', extension: 'png', originalName });
      attempt.imageAsset = { relativePath: asset.relativePath, originalName };
    }
    return {
      image: images.get(chosen.attempt)!,
      seed: chosen.seed,
      servedBy: chosen.servedBy,
      engineParameters: chosen.engineParameters,
      report: {
        enabled: true,
        verdict: chosen.overallVerdict ?? chosen.gate!.verdict,
        chosenAttempt: chosen.attempt,
        stopReason,
        frozenPrompt: {
          positive: baseRequest.prompt,
          negative: baseRequest.negativePrompt ?? '',
          regions: recipe.characterRegions.map((region) => region.prompt ?? ''),
          scene: recipe.scenePrompt ?? null,
        },
        failureCategories: failureCategories(chosen.gate!, chosen.semantic, chosen.visualQuality),
        attempts,
        note: 'Gate verdicts are detector evidence, not approval. passed_pending_human_review still requires human visual review.',
      },
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}
