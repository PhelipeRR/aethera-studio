import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
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
import { cropSemanticEvidence, evaluateSemanticSceneGate, type SemanticCriterion, type SemanticSceneGateOptions, type SemanticSceneGateResult } from './semantic-scene-gate.js';
import type { VisualRecipe } from './visual-recipe.js';
import sharp from 'sharp';

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
    repairUncertainAttributes?: boolean;
    maxLocalizedRepairs?: number;
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
  criterionId: string | null;
  criterionKind: SemanticCriterion['kind'] | 'count' | 'quality' | null;
  regionIndex: number | null;
  bbox: { x: number; y: number; width: number; height: number } | null;
  seed: number | null;
  maskAsset: { relativePath: string; originalName: string } | null;
  originalImageAsset: { relativePath: string; originalName: string } | null;
  repairedImageAsset: { relativePath: string; originalName: string } | null;
  differenceImageAsset: { relativePath: string; originalName: string } | null;
  beforeAttribute: { status: string; score: number | null; margin: number | null } | null;
  afterAttribute: { status: string; score: number | null; margin: number | null } | null;
  regression: CharacterGateVisualRegressionReport;
  reason?: string;
}

export interface CharacterGateVisualRegressionReport {
  status: 'passed' | 'needs_review' | 'failed';
  changedOutsideBboxFraction: number | null;
  meanAbsDiffOutsideBbox: number | null;
  subjectIdentityConsistency: number | null;
  reasons: string[];
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
  repairs: CharacterGateRepairReport[];
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

export interface CharacterGateCandidateEvaluation {
  gate: CharacterGateResult;
  semantic: SemanticSceneGateResult | null;
  visualQuality: CharacterGateVisualQualityReport | null;
  overallVerdict: CharacterGateResult['verdict'];
  detector: { device: string; loadMs: number; peakTorchMiB: number; durationMs: number } | null;
}

interface PendingRepairEvidence {
  report: CharacterGateRepairReport;
  maskBuffer: Buffer;
  originalBuffer: Buffer;
  repairedBuffer: Buffer;
  differenceBuffer: Buffer;
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

function emptyRepairReport(): CharacterGateRepairReport {
  return {
    status: 'not_requested',
    criterionId: null,
    criterionKind: null,
    regionIndex: null,
    bbox: null,
    seed: null,
    maskAsset: null,
    originalImageAsset: null,
    repairedImageAsset: null,
    differenceImageAsset: null,
    beforeAttribute: null,
    afterAttribute: null,
    regression: {
      status: 'needs_review',
      changedOutsideBboxFraction: null,
      meanAbsDiffOutsideBbox: null,
      subjectIdentityConsistency: null,
      reasons: ['not_evaluated'],
    },
  };
}

function attributeSnapshot(result: SemanticSceneGateResult | null, criterionId: string | null): CharacterGateRepairReport['beforeAttribute'] {
  if (!result || !criterionId) return null;
  const criterion = result.criteria.find((item) => item.id === criterionId);
  return criterion
    ? { status: criterion.status, score: criterion.score, margin: criterion.margin }
    : null;
}

function criterionForRepair(result: SemanticSceneGateResult | null, criterionId: string | null): SemanticCriterion | null {
  return result?.criteria.find((criterion) => criterion.id === criterionId) ?? null;
}

async function makeRepairMask(width: number, height: number, bbox: { x: number; y: number; width: number; height: number }): Promise<Buffer> {
  const x = Math.max(0, Math.min(width - 1, Math.round(bbox.x)));
  const y = Math.max(0, Math.min(height - 1, Math.round(bbox.y)));
  const right = Math.max(x + 1, Math.min(width, Math.round(bbox.x + bbox.width)));
  const bottom = Math.max(y + 1, Math.min(height, Math.round(bbox.y + bbox.height)));
  const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="black"/><rect x="${x}" y="${y}" width="${right - x}" height="${bottom - y}" fill="white"/></svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function compareRepairBuffers(before: Buffer, after: Buffer, bbox: { x: number; y: number; width: number; height: number }): Promise<{
  differenceBuffer: Buffer;
  changedOutsideBboxFraction: number | null;
  meanAbsDiffOutsideBbox: number | null;
}> {
  const [beforeRaw, afterRaw] = await Promise.all([
    sharp(before).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(after).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  if (beforeRaw.info.width !== afterRaw.info.width || beforeRaw.info.height !== afterRaw.info.height || beforeRaw.info.channels !== afterRaw.info.channels) {
    return {
      differenceBuffer: await sharp({ create: { width: 1, height: 1, channels: 3, background: '#f00' } }).png().toBuffer(),
      changedOutsideBboxFraction: null,
      meanAbsDiffOutsideBbox: null,
    };
  }
  const width = beforeRaw.info.width;
  const height = beforeRaw.info.height;
  const channels = beforeRaw.info.channels;
  const difference = Buffer.alloc(beforeRaw.data.length);
  const pad = 8;
  const left = Math.max(0, Math.round(bbox.x) - pad);
  const top = Math.max(0, Math.round(bbox.y) - pad);
  const right = Math.min(width, Math.round(bbox.x + bbox.width) + pad);
  const bottom = Math.min(height, Math.round(bbox.y + bbox.height) + pad);
  let outsidePixels = 0;
  let changedOutside = 0;
  let outsideSum = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const inside = x >= left && x < right && y >= top && y < bottom;
      let pixelDiff = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        const offset = (y * width + x) * channels + channel;
        const diff = Math.abs((beforeRaw.data[offset] ?? 0) - (afterRaw.data[offset] ?? 0));
        difference[offset] = diff;
        pixelDiff += diff;
      }
      if (!inside) {
        outsidePixels += 1;
        outsideSum += pixelDiff / channels;
        if (pixelDiff / channels > 8) changedOutside += 1;
      }
    }
  }
  return {
    differenceBuffer: await sharp(difference, { raw: { width, height, channels } }).png().toBuffer(),
    changedOutsideBboxFraction: outsidePixels > 0 ? changedOutside / outsidePixels : 0,
    meanAbsDiffOutsideBbox: outsidePixels > 0 ? outsideSum / outsidePixels : 0,
  };
}

function repairRegression(
  before: CharacterGateCandidateEvaluation,
  after: CharacterGateCandidateEvaluation,
  target: { criterionId: string; kind: SemanticCriterion['kind'] | 'count' | 'quality' },
  diff: { changedOutsideBboxFraction: number | null; meanAbsDiffOutsideBbox: number | null },
): CharacterGateVisualRegressionReport {
  const reasons: string[] = [];
  const beforeConfirmed = before.semantic?.criteria.filter((criterion) => criterion.status === 'confirmed') ?? [];
  const afterById = new Map((after.semantic?.criteria ?? []).map((criterion) => [criterion.id, criterion]));
  if (beforeConfirmed.some((criterion) => afterById.get(criterion.id)?.status === 'failed')) reasons.push('confirmed_attribute_became_failed');
  const targetAfter = after.semantic?.criteria.find((criterion) => criterion.id === target.criterionId);
  if (target.kind !== 'count' && target.kind !== 'quality' && targetAfter?.status !== 'confirmed') reasons.push('target_attribute_not_confirmed');
  if (target.kind === 'count' && after.gate.reasons.some((reason) => reason.code === 'undersized_character')) reasons.push('count_placement_not_corrected');
  if (after.visualQuality?.verdict === 'rejected') reasons.push('post_repair_visual_quality_rejected');
  if ((diff.changedOutsideBboxFraction ?? 1) > 0.12 || (diff.meanAbsDiffOutsideBbox ?? 255) > 18) reasons.push('excessive_change_outside_repair_bbox');
  const status = reasons.length > 0
    ? 'failed'
    : (diff.changedOutsideBboxFraction ?? 0) > 0.04 || (diff.meanAbsDiffOutsideBbox ?? 0) > 8
      ? 'needs_review'
      : 'passed';
  return {
    status,
    changedOutsideBboxFraction: diff.changedOutsideBboxFraction,
    meanAbsDiffOutsideBbox: diff.meanAbsDiffOutsideBbox,
    subjectIdentityConsistency: after.visualQuality?.subjectIdentityConsistency ?? null,
    reasons,
  };
}

export async function evaluateCharacterGateCandidate(input: {
  adapter: ExternalImageAdapter;
  recipe: VisualRecipe;
  imageBuffer: Buffer;
  compareBeforeBuffer?: Buffer;
  config: Pick<CharacterGateConfig, 'detector' | 'options' | 'semanticGate'>;
}): Promise<CharacterGateCandidateEvaluation> {
  const workDir = mkdtempSync(join(tmpdir(), 'aethera-candidate-eval-'));
  try {
    const imagePath = join(workDir, 'candidate.png');
    writeFileSync(imagePath, input.imageBuffer);
    const regionRects = input.recipe.characterRegions.map(({ x, y, width, height }) => ({ x, y, width, height }));
    let evidence: CharacterGateEvidence | undefined;
    let detector: CharacterGateCandidateEvaluation['detector'] = null;
    const detectStarted = Date.now();
    let gate: CharacterGateResult;
    try {
      const detection = await input.config.detector.detect([imagePath]);
      const detected = detection.results[0];
      if (!detected || detected.error) throw new Error(detected?.error ?? 'detector returned no result');
      evidence = detected;
      detector = { device: detection.device, loadMs: detection.loadMs, peakTorchMiB: detection.peakTorchMiB, durationMs: Date.now() - detectStarted };
      gate = evaluateCharacterComposition({
        evidence,
        expectedCount: input.recipe.characterRegions.length,
        regions: regionRects,
        ...(input.recipe.calmZones?.length ? { calmZones: input.recipe.calmZones } : {}),
        ...(input.config.options ? { options: input.config.options } : {}),
      });
    } catch (error) {
      gate = evaluateCharacterComposition({
        evidence: { width: input.recipe.width, height: input.recipe.height, detectors: { yolo_person: { error: error instanceof Error ? error.message : String(error) } } },
        expectedCount: input.recipe.characterRegions.length,
      });
    }
    const semanticEnabled = input.config.semanticGate?.enabled === true;
    let semantic: SemanticSceneGateResult | null = null;
    let visualQuality: CharacterGateVisualQualityReport | null = null;
    if (semanticEnabled) {
      semantic = await evaluateSemanticSceneGate({
        imageBuffer: input.imageBuffer,
        recipe: input.recipe,
        adapter: input.adapter.evaluateImageSemantics
          ? { evaluateImageSemantics: input.adapter.evaluateImageSemantics.bind(input.adapter) }
          : null,
        ...(evidence ? { evidence } : {}),
        ...(input.config.semanticGate?.options ? { options: input.config.semanticGate.options } : {}),
      });
      let inspected: VisualQualityInspectionResult | null = null;
      if (input.adapter.inspectVisualQuality) {
        try {
          inspected = await input.adapter.inspectVisualQuality({
            imageBuffer: input.imageBuffer,
            ...(input.compareBeforeBuffer ? { compareBeforeBuffer: input.compareBeforeBuffer } : {}),
            genre: input.recipe.preset.includes('anime') ? 'anime' : 'general',
          });
        } catch {
          inspected = null;
        }
      }
      visualQuality = inspectVisualQuality(inspected, true);
    }
    return { gate, semantic, visualQuality, overallVerdict: combinedVerdict(gate, semantic, visualQuality), detector };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
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
  const pendingRepairs = new Map<number, PendingRepairEvidence[]>();
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
        repair: emptyRepairReport(),
        repairs: [],
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
      const applyEvaluation = (evaluation: CharacterGateCandidateEvaluation): void => {
        attempt.gate = evaluation.gate;
        attempt.semantic = evaluation.semantic;
        attempt.visualQuality = evaluation.visualQuality;
        attempt.overallVerdict = evaluation.overallVerdict;
        attempt.detector = evaluation.detector;
      };
      let currentEvaluation = await evaluateCharacterGateCandidate({
        adapter,
        recipe,
        imageBuffer: image,
        config: { detector: config.detector, ...(config.options ? { options: config.options } : {}), ...(config.semanticGate ? { semanticGate: config.semanticGate } : {}) },
      });
      applyEvaluation(currentEvaluation);
      const triedRepairs = new Set<string>();
      const maxLocalizedRepairs = Math.min(3, Math.max(1, Math.floor(config.semanticGate?.maxLocalizedRepairs ?? 3)));
      const repairEvidence: PendingRepairEvidence[] = [];
      while (semanticEnabled && config.semanticGate?.localizedRepair && adapter.inpaintRegion && repairEvidence.length < maxLocalizedRepairs) {
        const repairUncertainAttributes = config.semanticGate.repairUncertainAttributes === true;
        const semanticCandidate = (repairUncertainAttributes || currentEvaluation.overallVerdict === 'rejected')
          ? currentEvaluation.semantic?.repairCandidates.find((candidate) => {
              if (triedRepairs.has(candidate.criterionId)) return false;
              const criterion = criterionForRepair(currentEvaluation.semantic, candidate.criterionId);
              return criterion !== null && (criterion.status === 'failed' || (repairUncertainAttributes && criterion.status === 'uncertain'));
            })
          : undefined;
        const undersized = currentEvaluation.gate.reasons.some((reason) => reason.code === 'undersized_character')
          ? currentEvaluation.gate.figures.find((figure) => figure.regionIndex !== null && figure.regionIndex !== undefined && figure.height < 0.55 * regionRects[figure.regionIndex]!.height)
          : undefined;
        const countRepairBaseId = undersized ? `count:undersized_character:${String(undersized.regionIndex)}` : null;
        const failedCountRepairAttempts = countRepairBaseId
          ? attempt.repairs.filter((repair) => repair.criterionKind === 'count' && repair.status === 'failed' && (repair.criterionId === countRepairBaseId || repair.criterionId?.startsWith(`${countRepairBaseId}:retry`))).length
          : 0;
        const countCandidate = undersized && (repairUncertainAttributes || currentEvaluation.gate.failureClass === 'placement')
          ? {
              criterionId: failedCountRepairAttempts === 0 ? countRepairBaseId! : `${countRepairBaseId}:retry${failedCountRepairAttempts}`,
              criterionKind: 'count' as const,
              regionIndex: undersized.regionIndex ?? null,
              bbox: regionRects[undersized.regionIndex!]!,
              prompt: `Repair only the character in this region so it fills the planned cinematic depth without changing neighboring characters: ${recipe.characterRegions[undersized.regionIndex!]?.prompt ?? 'the planned character'}. ${failedCountRepairAttempts > 0 ? 'The previous localized repair did not correct the scale; make the full-body figure visibly occupy the planned region while preserving its identity.' : ''} Preserve lighting, identity and contact shadow.`,
              reason: 'undersized_character',
            }
          : null;
        const qualityCandidate = currentEvaluation.visualQuality?.localizedDefects.find((defect) => defect.severity === 'severe' && !defect.repaired)
          ?? currentEvaluation.visualQuality?.localizedDefects.find((defect) => defect.severity === 'moderate' && !defect.repaired);
        const semanticRepairCandidate = semanticCandidate
          ? { criterionId: semanticCandidate.criterionId, criterionKind: criterionForRepair(currentEvaluation.semantic, semanticCandidate.criterionId)?.kind ?? 'quality' as const, regionIndex: criterionForRepair(currentEvaluation.semantic, semanticCandidate.criterionId)?.regionIndex ?? null, bbox: semanticCandidate.bbox, prompt: semanticCandidate.prompt, reason: semanticCandidate.reason }
          : null;
        const candidate = countCandidate
          ?? semanticRepairCandidate
          ?? (qualityCandidate && (currentEvaluation.overallVerdict === 'rejected' || currentEvaluation.visualQuality?.reasons.includes('localized_visual_defect'))
            ? { criterionId: `quality:${qualityCandidate.id}`, criterionKind: 'quality' as const, regionIndex: null, bbox: qualityCandidate.bbox, prompt: `Repair only this localized visual defect while preserving identity, lighting and all neighboring characters: ${qualityCandidate.description}`, reason: qualityCandidate.description }
            : null);
        if (!candidate) break;
        triedRepairs.add(candidate.criterionId);
        const beforeImage = image;
        const beforeEvaluation = currentEvaluation;
        const repairSeed = createHash('sha256').update(`${seed}:${candidate.criterionId}:${candidate.bbox.x},${candidate.bbox.y},${candidate.bbox.width},${candidate.bbox.height}`).digest().readUInt32BE(0);
        const report = emptyRepairReport();
        report.status = 'applied';
        report.criterionId = candidate.criterionId;
        report.criterionKind = candidate.criterionKind;
        report.regionIndex = candidate.regionIndex;
        report.bbox = candidate.bbox;
        report.seed = repairSeed;
        report.beforeAttribute = attributeSnapshot(beforeEvaluation.semantic, candidate.criterionId);
        try {
          const repairedImage = await adapter.inpaintRegion({
            imageBuffer: beforeImage,
            prompt: candidate.prompt,
            negativePrompt: recipe.negativePrompt,
            bbox: candidate.bbox,
            strength: config.semanticGate.repairStrength ?? 0.48,
            seed: repairSeed,
          });
          const afterEvaluation = await evaluateCharacterGateCandidate({
            adapter,
            recipe,
            imageBuffer: repairedImage,
            compareBeforeBuffer: beforeImage,
            config: { detector: config.detector, ...(config.options ? { options: config.options } : {}), ...(config.semanticGate ? { semanticGate: config.semanticGate } : {}) },
          });
          const diff = await compareRepairBuffers(beforeImage, repairedImage, candidate.bbox);
          const regression = repairRegression(beforeEvaluation, afterEvaluation, { criterionId: candidate.criterionId, kind: candidate.criterionKind }, diff);
          report.afterAttribute = attributeSnapshot(afterEvaluation.semantic, candidate.criterionId);
          report.regression = regression;
          const maskBuffer = await makeRepairMask(recipe.width, recipe.height, candidate.bbox);
          repairEvidence.push({ report, maskBuffer, originalBuffer: beforeImage, repairedBuffer: repairedImage, differenceBuffer: diff.differenceBuffer });
          if (regression.status !== 'passed') {
            report.status = 'failed';
            report.reason = `Regional repair regression: ${regression.reasons.join(', ') || regression.status}.`;
            attempt.repairs.push(report);
            attempt.repair = report;
            continue;
          }
          image = repairedImage;
          images.set(attempt.attempt, image);
          currentEvaluation = afterEvaluation;
          applyEvaluation(currentEvaluation);
          attempt.repairs.push(report);
          attempt.repair = report;
        } catch (error) {
          report.status = 'failed';
          report.regression = { status: 'failed', changedOutsideBboxFraction: null, meanAbsDiffOutsideBbox: null, subjectIdentityConsistency: null, reasons: ['repair_execution_failed'] };
          report.reason = error instanceof Error ? error.message : String(error);
          attempt.repairs.push(report);
          attempt.repair = report;
          break;
        }
      }
      pendingRepairs.set(attempt.attempt, repairEvidence);
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
      for (const [repairIndex, pending] of (pendingRepairs.get(attempt.attempt) ?? []).entries()) {
        const safeCriterion = (pending.report.criterionId ?? 'repair').replace(/[^a-z0-9_-]+/gi, '-');
        const maskName = `ai-gate-mask-attempt${attempt.attempt}-repair${repairIndex + 1}-${safeCriterion}.png`;
        const originalName = `ai-gate-original-attempt${attempt.attempt}-repair${repairIndex + 1}-${safeCriterion}-${attempt.seed}.png`;
        const repairedName = `ai-gate-repaired-attempt${attempt.attempt}-repair${repairIndex + 1}-${safeCriterion}-${attempt.seed}.png`;
        const diffName = `ai-gate-diff-attempt${attempt.attempt}-repair${repairIndex + 1}-${safeCriterion}-${attempt.seed}.png`;
        const [maskAsset, originalAsset, repairedAsset, differenceAsset] = await Promise.all([
          input.ingestion.ingestBuffer({ buffer: pending.maskBuffer, kind: 'image', extension: 'png', originalName: maskName }),
          input.ingestion.ingestBuffer({ buffer: pending.originalBuffer, kind: 'image', extension: 'png', originalName }),
          input.ingestion.ingestBuffer({ buffer: pending.repairedBuffer, kind: 'image', extension: 'png', originalName: repairedName }),
          input.ingestion.ingestBuffer({ buffer: pending.differenceBuffer, kind: 'image', extension: 'png', originalName: diffName }),
        ]);
        pending.report.maskAsset = { relativePath: maskAsset.relativePath, originalName: maskName };
        pending.report.originalImageAsset = { relativePath: originalAsset.relativePath, originalName };
        pending.report.repairedImageAsset = { relativePath: repairedAsset.relativePath, originalName: repairedName };
        pending.report.differenceImageAsset = { relativePath: differenceAsset.relativePath, originalName: diffName };
      }
      if (attempt !== chosen || attempt.overallVerdict === 'rejected') {
        const originalName = `ai-gate-${attempt.overallVerdict ?? attempt.gate!.verdict}-attempt${attempt.attempt}-${attempt.seed}.png`;
        const asset = await input.ingestion.ingestBuffer({ buffer: images.get(attempt.attempt)!, kind: 'image', extension: 'png', originalName });
        attempt.imageAsset = { relativePath: asset.relativePath, originalName };
      }
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
