import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { AssetIngestionService } from '../src/asset-ingestion.js';
import { evaluateCharacterGateCandidate, nextCompositionStrategy, pasteSeamStrength, runCharacterCompositionGate, type CharacterGateDetector } from '../src/character-gate-runner.js';
import type { ImageGenerationRequest, LocalizedInpaintRequest, SemanticEvaluationRequest, SemanticEvaluationResult, VisualQualityInspectionResult } from '../src/image-generation-adapter.js';
import { buildVisualRecipe } from '../src/visual-recipe.js';
import evidence from './fixtures/character-gate-cs9-evidence.json' with { type: 'json' };

const CLEAN_TRIO = (evidence as Record<string, unknown>)['run-cs9-lora-2026-11-17T1109/cyberpunk-trio-preview.png'];
const CLEAN_DUO = {
  width: 1344,
  height: 768,
  detectors: {
    yolo_person: { boxes: [{ x: 100, y: 80, width: 160, height: 580, confidence: 0.9 }, { x: 1050, y: 80, width: 160, height: 580, confidence: 0.9 }] },
    yolo_face: { boxes: [] },
    yolo_hand: { boxes: [] },
    openpose: { people: [] },
  },
};
const UNDERSIZED_DUO = {
  ...CLEAN_DUO,
  detectors: {
    ...CLEAN_DUO.detectors,
    yolo_person: { boxes: [{ x: 100, y: 380, width: 120, height: 240, confidence: 0.9 }, { x: 1050, y: 80, width: 160, height: 580, confidence: 0.9 }] },
  },
};
const EXTRA_TRIO = (evidence as Record<string, unknown>)['run-cs9-2026-11-17T1117/cyberpunk-trio-preview.png'];
const ILLEGIBLE = (evidence as Record<string, unknown>)['run-cs9-2026-11-17T1050/cyberpunk-group-eight-preview.png'];

function scriptedDetector(sequence: unknown[]): CharacterGateDetector & { calls: number } {
  return {
    id: 'scripted',
    calls: 0,
    async detect(paths) {
      const result = sequence[Math.min(this.calls, sequence.length - 1)];
      this.calls += 1;
      return { device: 'cpu', loadMs: 1, peakTorchMiB: 0, results: [{ ...(result as object), image: paths[0]! } as never] };
    },
  };
}

async function fixture(characterCount = 3, options: { semanticScore?: number; semanticMargin?: number; semanticOffTopic?: boolean; repairScore?: number; repairMargin?: number; repairOffTopic?: boolean; quality?: Partial<VisualQualityInspectionResult> } = {}) {
  const recipe = buildVisualRecipe({
    artType: 'thumbnail',
    prompt: 'cyberpunk trio in a rainy city',
    characterCount,
    characterDescriptions: Array.from({ length: characterCount }, (_, index) => index === 0 ? 'warrior with katana and armor' : 'warrior with spear and armor'),
    seed: 500,
  });
  const requests: ImageGenerationRequest[] = [];
  let provider = 'comfyui-native';
  const png = await sharp({ create: { width: recipe.width, height: recipe.height, channels: 3, background: '#335' } }).png().toBuffer();
  let repairCalls = 0;
  const repairRequests: LocalizedInpaintRequest[] = [];
  const adapter = {
    id: 'fake',
    isAvailable: async () => true,
    generateImage: async (request: ImageGenerationRequest) => {
      requests.push(request);
      return png;
    },
    getLastServedProvider: () => ({ providerId: provider, fallbackErrors: provider === 'comfyui-native' ? [] : ['comfyui-native: timeout'] }),
    getLastGenerationMetadata: () => ({ checkpoint: 'animagine-xl-3.1.safetensors' }),
    evaluateImageSemantics: async (request: SemanticEvaluationRequest): Promise<SemanticEvaluationResult> => ({
      evaluatorId: 'test-local-clip',
      positiveScore: repairCalls > 0 ? options.repairScore ?? 0.84 : options.semanticScore ?? 0.84,
      negativeScore: (repairCalls > 0 ? options.repairScore ?? 0.84 : options.semanticScore ?? 0.84) - (repairCalls > 0 ? options.repairMargin ?? 0.42 : options.semanticMargin ?? 0.42),
      margin: repairCalls > 0 ? options.repairMargin ?? 0.42 : options.semanticMargin ?? 0.42,
      isOffTopic: repairCalls > 0 ? options.repairOffTopic ?? false : options.semanticOffTopic ?? false,
      matchedLabel: request.positiveConcepts[0] ?? 'test criterion',
      rationale: 'controlled local evidence',
      evidenceScope: request.evidenceBbox ? 'localized' : 'generic',
    }),
    inspectVisualQuality: async (): Promise<VisualQualityInspectionResult> => ({
      evaluatorId: 'test-local-quality',
      anatomicalConsistency: options.quality?.anatomicalConsistency ?? 92,
      physicalCoherence: options.quality?.physicalCoherence ?? 92,
      compositionQuality: options.quality?.compositionQuality ?? 90,
      subjectIdentityConsistency: options.quality?.subjectIdentityConsistency ?? 94,
      visualArtifactSeverity: options.quality?.visualArtifactSeverity ?? 8,
      localizedDefects: options.quality?.localizedDefects ?? [],
    }),
    removeBackground: async ({ inputImagePath }: { inputImagePath: string }): Promise<Buffer> => {
      const meta = await sharp(inputImagePath).metadata();
      const w = meta.width ?? 1;
      const h = meta.height ?? 1;
      const silhouette = Buffer.from(`<svg width="${w}" height="${h}"><ellipse cx="${w / 2}" cy="${h / 2}" rx="${w * 0.35}" ry="${h * 0.45}" fill="#fff"/></svg>`);
      return sharp(inputImagePath).ensureAlpha().composite([{ input: silhouette, blend: 'dest-in' }]).png().toBuffer();
    },
    inpaintRegion: async (request: LocalizedInpaintRequest): Promise<Buffer> => {
      const { bbox } = request;
      repairRequests.push(request);
      repairCalls += 1;
      return sharp(png).composite([{ input: Buffer.from(`<svg width="${recipe.width}" height="${recipe.height}"><rect x="${Math.round(bbox.x)}" y="${Math.round(bbox.y)}" width="${Math.max(1, Math.round(bbox.width))}" height="${Math.max(1, Math.round(bbox.height))}" fill="#e56b6f"/></svg>`), blend: 'over' }]).png().toBuffer();
    },
  };
  const ingestion = new AssetIngestionService({ storageRoot: mkdtempSync(join(tmpdir(), 'gate-test-')) });
  const baseRequest: ImageGenerationRequest = { prompt: recipe.positivePrompt, negativePrompt: recipe.negativePrompt, width: recipe.width, height: recipe.height, characterRegions: recipe.characterRegions };
  return { recipe, requests, adapter, ingestion, baseRequest, getRepairCalls: () => repairCalls, getRepairRequests: () => repairRequests, setProvider: (id: string) => { provider = id; } };
}

describe('Character Composition Gate runner', () => {
  it('retries a rejected image with a new seed and a new strategy on the frozen prompt, then stops on a pass', async () => {
    const { recipe, requests, adapter, ingestion, baseRequest } = await fixture();
    const detector = scriptedDetector([EXTRA_TRIO, CLEAN_TRIO]);
    const outcome = await runCharacterCompositionGate({ adapter, ingestion, recipe, baseRequest, config: { detector, maxAttempts: 4, requiredProviderId: 'comfyui-native' } });

    expect(requests).toHaveLength(2);
    expect(new Set(requests.map((request) => request.prompt)).size).toBe(1);
    expect(requests.map((request) => request.seed)).toEqual([500, 500 + 7919]);
    expect(requests[1]?.compositionStrategy).toMatchObject({ sceneStrength: 0.35 });
    expect(outcome.report).toMatchObject({ verdict: 'passed_pending_human_review', chosenAttempt: 2, stopReason: 'passed' });
    expect(outcome.report.attempts[0]).toMatchObject({ seed: 500, strategy: { id: 'regional-base' }, gate: { verdict: 'rejected', failureClass: 'extras' } });
    expect(outcome.report.attempts[0]?.imageAsset).toMatchObject({ originalName: 'ai-gate-rejected-attempt1-500.png', relativePath: expect.stringMatching(/\.png$/) });
    expect(outcome.report.attempts[0]?.gate?.reasons[0]).toMatchObject({ code: 'extra_main_characters', detectors: ['yolo_person', 'openpose'] });
    expect(outcome.seed).toBe(500 + 7919);
  });

  it('stops when the strategy ladder is exhausted instead of repeating equivalent attempts', async () => {
    const { recipe, requests, adapter, ingestion, baseRequest } = await fixture();
    const outcome = await runCharacterCompositionGate({ adapter, ingestion, recipe, baseRequest, config: { detector: scriptedDetector([EXTRA_TRIO]), maxAttempts: 6, poseControlNetModel: null } });
    const ids = outcome.report.attempts.map((attempt) => attempt.strategy.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['regional-base', 'regional-empty-scene', 'regional-empty-scene-strong-pose', 'regional-strong-pose', 'regional-strong-calm']);
    expect(outcome.report).toMatchObject({ verdict: 'rejected', stopReason: 'strategies_exhausted' });
    expect(requests).toHaveLength(5);
  });

  it('keeps needs_review as needs_review and never promotes it', async () => {
    const { recipe, adapter, ingestion, baseRequest } = await fixture(8);
    const outcome = await runCharacterCompositionGate({ adapter, ingestion, recipe, baseRequest, config: { detector: scriptedDetector([ILLEGIBLE]), maxAttempts: 2, retryOnNeedsReview: 'never' } });
    expect(outcome.report).toMatchObject({ verdict: 'needs_review', stopReason: 'needs_review_not_retried' });
    expect(outcome.report.attempts).toHaveLength(1);
  });

  it('treats a fallback provider as an invalid attempt instead of evaluating it', async () => {
    const { recipe, adapter, ingestion, baseRequest, setProvider } = await fixture();
    setProvider('local-sdxl-rembg');
    await expect(runCharacterCompositionGate({ adapter, ingestion, recipe, baseRequest, config: { detector: scriptedDetector([CLEAN_TRIO]), maxAttempts: 2, requiredProviderId: 'comfyui-native' } }))
      .rejects.toThrow(/no valid attempt.*wrong_provider.*local-sdxl-rembg/);
  });

  it('starts large groups with the layered strategy only when it is available', () => {
    expect(nextCompositionStrategy({ failureClass: null, tried: [], characterCount: 8, layeredAvailable: true, largeGroupThreshold: 6 })?.id).toBe('layered-individual');
    expect(nextCompositionStrategy({ failureClass: null, tried: [], characterCount: 8, layeredAvailable: false, largeGroupThreshold: 6 })?.id).toBe('regional-base');
    expect(nextCompositionStrategy({ failureClass: 'missing', tried: ['regional-base'], characterCount: 2, layeredAvailable: true, largeGroupThreshold: 6 })?.id).toBe('regional-strong-pose');
  });

  it('records count, semantic and visual-quality failures separately', async () => {
    const { recipe, adapter, ingestion, baseRequest } = await fixture(3, {
      quality: {
        visualArtifactSeverity: 92,
        localizedDefects: [{ id: 'defect-1', category: 'visual_artifact', severity: 'severe', bbox: { x: 20, y: 20, width: 40, height: 40 }, description: 'severe artifact', repaired: false }],
      },
    });
    const outcome = await runCharacterCompositionGate({
      adapter,
      ingestion,
      recipe,
      baseRequest,
      config: { detector: scriptedDetector([EXTRA_TRIO]), maxAttempts: 1, retryOnNeedsReview: 'never', semanticGate: { enabled: true } },
    });

    expect(outcome.report.verdict).toBe('rejected');
    expect(outcome.report.failureCategories.count).toContain('extra_main_characters');
    expect(outcome.report.failureCategories.semantic).toEqual([]);
    expect(outcome.report.failureCategories.visualQuality).toContain('severe_visual_artifact');
    expect(outcome.report.attempts[0]).toMatchObject({ semantic: { verdict: 'passed_pending_human_review' }, visualQuality: { verdict: 'rejected' } });
  });

  it('keeps ambiguous semantic evidence as needs_review', async () => {
    const { recipe, adapter, ingestion, baseRequest } = await fixture(3, { semanticScore: 0.53, semanticMargin: 0.01 });
    const outcome = await runCharacterCompositionGate({
      adapter,
      ingestion,
      recipe,
      baseRequest,
      config: { detector: scriptedDetector([CLEAN_TRIO]), maxAttempts: 1, retryOnNeedsReview: 'never', semanticGate: { enabled: true } },
    });

    expect(outcome.report.verdict).toBe('needs_review');
    expect(outcome.report.failureCategories.count).toEqual([]);
    expect(outcome.report.failureCategories.semantic).toContain('insufficient_semantic_evidence');
  });

  it('does not reject when the semantic evaluator is unavailable', async () => {
    const { recipe, adapter, ingestion, baseRequest } = await fixture(3);
    const { evaluateImageSemantics: _evaluateImageSemantics, ...unavailableAdapter } = adapter;
    const outcome = await runCharacterCompositionGate({
      adapter: unavailableAdapter,
      ingestion,
      recipe,
      baseRequest,
      config: { detector: scriptedDetector([CLEAN_TRIO]), maxAttempts: 1, retryOnNeedsReview: 'never', semanticGate: { enabled: true } },
    });

    expect(outcome.report.verdict).toBe('needs_review');
    expect(outcome.report.attempts[0]?.semantic?.criteria.every((criterion) => criterion.status === 'uncertain')).toBe(true);
    expect(outcome.report.attempts[0]?.semantic?.verdict).not.toBe('rejected');
  });

  it('repairs one proven localized semantic defect without regenerating the whole image and keeps the original', async () => {
    const { recipe, requests, adapter, ingestion, baseRequest, getRepairCalls } = await fixture(3, { semanticScore: 0.08, semanticMargin: -0.2, semanticOffTopic: true });
    const outcome = await runCharacterCompositionGate({
      adapter,
      ingestion,
      recipe,
      baseRequest,
      config: { detector: scriptedDetector([CLEAN_TRIO, CLEAN_TRIO]), maxAttempts: 1, retryOnNeedsReview: 'never', semanticGate: { enabled: true, localizedRepair: true } },
    });

    expect(getRepairCalls()).toBe(1);
    expect(requests).toHaveLength(1);
    expect(outcome.report.verdict).toBe('passed_pending_human_review');
    expect(outcome.report.attempts[0]?.repair).toMatchObject({ status: 'applied', originalImageAsset: expect.objectContaining({ originalName: expect.stringContaining('original') }) });
  });

  it('evaluates an original candidate without invoking image generation', async () => {
    const { recipe, adapter, ingestion, baseRequest, requests } = await fixture(3);
    const evaluation = await evaluateCharacterGateCandidate({
      adapter,
      recipe,
      imageBuffer: await adapter.generateImage!(baseRequest),
      config: { detector: scriptedDetector([CLEAN_TRIO]), semanticGate: { enabled: true } },
    });

    expect(requests).toHaveLength(1);
    expect(evaluation.overallVerdict).toBe('passed_pending_human_review');
    expect(evaluation.semantic?.criteria.length).toBeGreaterThan(0);
    expect(evaluation.visualQuality?.evaluatorId).toBe('test-local-quality');
  });

  it('applies one uncertain-attribute repair with mask, diff and regression evidence', async () => {
    const { recipe, adapter, ingestion, baseRequest, getRepairCalls } = await fixture(3, { semanticScore: 0.58, semanticMargin: 0.3 });
    const outcome = await runCharacterCompositionGate({
      adapter,
      ingestion,
      recipe,
      baseRequest,
      config: {
        detector: scriptedDetector([CLEAN_TRIO, CLEAN_TRIO]),
        maxAttempts: 1,
        retryOnNeedsReview: 'never',
        semanticGate: { enabled: true, localizedRepair: true, repairUncertainAttributes: true, maxLocalizedRepairs: 1 },
      },
    });

    expect(getRepairCalls()).toBe(1);
    expect(outcome.report.verdict).toBe('passed_pending_human_review');
    expect(outcome.report.attempts[0]?.repairs).toHaveLength(1);
    expect(outcome.report.attempts[0]?.repairs[0]).toMatchObject({
      status: 'applied',
      criterionId: expect.stringContaining('object'),
      maskAsset: expect.objectContaining({ originalName: expect.stringContaining('mask') }),
      originalImageAsset: expect.objectContaining({ originalName: expect.stringContaining('original') }),
      repairedImageAsset: expect.objectContaining({ originalName: expect.stringContaining('repaired') }),
      differenceImageAsset: expect.objectContaining({ originalName: expect.stringContaining('diff') }),
      regression: { status: 'passed' },
    });
  });

  it('prioritizes an objective undersized-character repair before uncertain attributes', async () => {
    const { recipe, adapter, ingestion, baseRequest } = await fixture(2, { semanticScore: 0.58, semanticMargin: 0.3 });
    const outcome = await runCharacterCompositionGate({
      adapter,
      ingestion,
      recipe,
      baseRequest,
      config: {
        detector: scriptedDetector([UNDERSIZED_DUO, CLEAN_DUO]),
        maxAttempts: 1,
        retryOnNeedsReview: 'never',
        semanticGate: { enabled: true, localizedRepair: true, repairUncertainAttributes: true, maxLocalizedRepairs: 1 },
      },
    });

    expect(outcome.report.attempts[0]?.repairs[0]).toMatchObject({
      criterionKind: 'count',
      criterionId: expect.stringContaining('undersized_character'),
      status: 'applied',
    });
  });

  it('retries a failed count repair locally with a new auditable variant before moving on', async () => {
    const { recipe, adapter, ingestion, baseRequest } = await fixture(2);
    const outcome = await runCharacterCompositionGate({
      adapter,
      ingestion,
      recipe,
      baseRequest,
      config: {
        detector: scriptedDetector([UNDERSIZED_DUO, UNDERSIZED_DUO, CLEAN_DUO]),
        maxAttempts: 1,
        retryOnNeedsReview: 'never',
        semanticGate: { enabled: true, localizedRepair: true, repairUncertainAttributes: true, maxLocalizedRepairs: 2 },
      },
    });

    expect(outcome.report.attempts[0]?.repairs).toHaveLength(2);
    expect(outcome.report.attempts[0]?.repairs.map((repair) => repair.criterionId)).toEqual([
      'count:undersized_character:0',
      'count:undersized_character:0:retry1',
    ]);
    expect(outcome.report.attempts[0]?.repairs[0]?.status).toBe('failed');
    expect(outcome.report.attempts[0]?.repairs[1]?.status).toBe('applied');
  });

  it('rescales the undersized figure inside its planned region before a blending inpaint', async () => {
    const { recipe, adapter, ingestion, baseRequest, getRepairRequests } = await fixture(2);
    const outcome = await runCharacterCompositionGate({
      adapter,
      ingestion,
      recipe,
      baseRequest,
      config: {
        detector: scriptedDetector([UNDERSIZED_DUO, CLEAN_DUO]),
        maxAttempts: 1,
        retryOnNeedsReview: 'never',
        semanticGate: { enabled: true, localizedRepair: true, repairUncertainAttributes: true, maxLocalizedRepairs: 1 },
      },
    });

    const repair = outcome.report.attempts[0]?.repairs[0];
    expect(repair).toMatchObject({ criterionKind: 'count', strategy: 'rescale_then_inpaint', status: 'applied' });
    expect(repair?.rescaleSkippedReason).toBeUndefined();
    expect(repair?.scaleFactor).toBeGreaterThan(1.5);
    expect(repair?.strength).toBeLessThan(0.6);
    expect(getRepairRequests()[0]?.strength).toBe(repair?.strength);
  });

  it('measures a hard seam along a pasted rectangle but not on a smooth image', async () => {
    const flat = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#556' } }).png().toBuffer();
    const block = await sharp({ create: { width: 80, height: 120, channels: 3, background: '#112' } }).png().toBuffer();
    const panel = await sharp(flat).composite([{ input: block, left: 60, top: 40 }]).png().toBuffer();
    const rect = { x: 60, y: 40, width: 80, height: 120 };
    expect(await pasteSeamStrength(flat, rect)).toBe(0);
    expect(await pasteSeamStrength(panel, rect)).toBeGreaterThan(30);
  });

  it('caps count repairs so an uncertain attribute still receives a localized repair', async () => {
    const { recipe, adapter, ingestion, baseRequest } = await fixture(2, { semanticScore: 0.58, semanticMargin: 0.3 });
    const outcome = await runCharacterCompositionGate({
      adapter,
      ingestion,
      recipe,
      baseRequest,
      config: {
        detector: scriptedDetector([UNDERSIZED_DUO]),
        maxAttempts: 1,
        retryOnNeedsReview: 'never',
        semanticGate: { enabled: true, localizedRepair: true, repairUncertainAttributes: true, maxLocalizedRepairs: 3 },
      },
    });

    const ids = outcome.report.attempts[0]?.repairs.map((repair) => repair.criterionId) ?? [];
    expect(ids.slice(0, 2)).toEqual(['count:undersized_character:0', 'count:undersized_character:0:retry1']);
    expect(ids).toHaveLength(3);
    expect(ids[2]).not.toMatch(/^count:/);
  });

  it('repairs a missing object with the character prompt on a head-protected body mask', async () => {
    const { recipe, adapter, ingestion, baseRequest, getRepairRequests } = await fixture(2, { semanticScore: 0.58, semanticMargin: 0.3 });
    const outcome = await runCharacterCompositionGate({
      adapter,
      ingestion,
      recipe,
      baseRequest,
      config: {
        detector: scriptedDetector([CLEAN_DUO]),
        maxAttempts: 1,
        retryOnNeedsReview: 'never',
        semanticGate: { enabled: true, localizedRepair: true, repairUncertainAttributes: true, maxLocalizedRepairs: 1 },
      },
    });

    const repair = outcome.report.attempts[0]?.repairs[0];
    const request = getRepairRequests()[0];
    const figure = CLEAN_DUO.detectors.yolo_person.boxes[0]!;
    expect(repair).toMatchObject({ criterionKind: 'object', strategy: 'object_inpaint', strength: 0.6 });
    expect(request?.prompt).toContain('holding katana');
    expect(request?.prompt).toContain(recipe.characterRegions[0]!.prompt!);
    expect(request?.negativePrompt).toContain('back view');
    expect(request?.bbox.y).toBeGreaterThanOrEqual(figure.y + figure.height * 0.15);
    expect(request?.bbox.y! + request!.bbox.height).toBeLessThanOrEqual(figure.y + figure.height);
  });

  it('repairs objects of every character after a scale repair, before wardrobe or pose', async () => {
    const { recipe, adapter, ingestion, baseRequest } = await fixture(2, { semanticScore: 0.58, semanticMargin: 0.3, repairScore: 0.58, repairMargin: 0.3 });
    const outcome = await runCharacterCompositionGate({
      adapter,
      ingestion,
      recipe,
      baseRequest,
      config: {
        detector: scriptedDetector([UNDERSIZED_DUO, CLEAN_DUO]),
        maxAttempts: 1,
        retryOnNeedsReview: 'never',
        semanticGate: { enabled: true, localizedRepair: true, repairUncertainAttributes: true, maxLocalizedRepairs: 3 },
      },
    });

    const repairs = outcome.report.attempts[0]?.repairs ?? [];
    expect(repairs.map((repair) => [repair.criterionKind, repair.regionIndex])).toEqual([['count', 0], ['object', 0], ['object', 1]]);
  });

  it('keeps an unverifiable object repair as a proposed alternative without adopting it', async () => {
    const { recipe, adapter, ingestion, baseRequest } = await fixture(2, { semanticScore: 0.58, semanticMargin: 0.3, repairScore: 0.58, repairMargin: 0.3 });
    const outcome = await runCharacterCompositionGate({
      adapter,
      ingestion,
      recipe,
      baseRequest,
      config: {
        detector: scriptedDetector([CLEAN_DUO]),
        maxAttempts: 1,
        retryOnNeedsReview: 'never',
        semanticGate: { enabled: true, localizedRepair: true, repairUncertainAttributes: true, maxLocalizedRepairs: 1 },
      },
    });

    const attempt = outcome.report.attempts[0]!;
    expect(attempt.repairs[0]).toMatchObject({
      status: 'proposed',
      regression: { reasons: ['target_attribute_not_confirmed'] },
      repairedImageAsset: expect.objectContaining({ relativePath: expect.stringMatching(/\.png$/) }),
    });
    expect(attempt.imageAsset?.relativePath).not.toBe(attempt.repairs[0]?.repairedImageAsset?.relativePath);
    expect(outcome.report.verdict).toBe('needs_review');
  });

  it('keeps the pre-repair image when a regional repair loses a confirmed attribute', async () => {
    const { recipe, adapter, ingestion, baseRequest, getRepairCalls } = await fixture(3, { semanticScore: 0.58, semanticMargin: 0.3, repairScore: 0.05, repairMargin: -0.2, repairOffTopic: true });
    const outcome = await runCharacterCompositionGate({
      adapter,
      ingestion,
      recipe,
      baseRequest,
      config: {
        detector: scriptedDetector([CLEAN_TRIO, CLEAN_TRIO]),
        maxAttempts: 1,
        retryOnNeedsReview: 'never',
        semanticGate: { enabled: true, localizedRepair: true, repairUncertainAttributes: true, maxLocalizedRepairs: 1 },
      },
    });

    expect(getRepairCalls()).toBe(1);
    expect(outcome.report.verdict).toBe('needs_review');
    expect(outcome.report.attempts[0]?.repairs[0]).toMatchObject({ status: 'failed', regression: { status: 'failed' }, reason: expect.stringContaining('regression') });
  });

  it('preserves a chosen rejected image as audit evidence when the attempt limit is reached', async () => {
    const { recipe, adapter, ingestion, baseRequest } = await fixture(3, { semanticScore: 0.08, semanticMargin: -0.2, semanticOffTopic: true });
    const outcome = await runCharacterCompositionGate({
      adapter,
      ingestion,
      recipe,
      baseRequest,
      config: { detector: scriptedDetector([CLEAN_TRIO]), maxAttempts: 1, retryOnNeedsReview: 'never', semanticGate: { enabled: true, localizedRepair: false } },
    });

    expect(outcome.report.verdict).toBe('rejected');
    expect(outcome.report.attempts[0]?.imageAsset).toMatchObject({ originalName: 'ai-gate-rejected-attempt1-500.png', relativePath: expect.stringMatching(/\.png$/) });
  });
});
