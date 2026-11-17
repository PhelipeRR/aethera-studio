import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { AssetIngestionService } from '../src/asset-ingestion.js';
import { nextCompositionStrategy, runCharacterCompositionGate, type CharacterGateDetector } from '../src/character-gate-runner.js';
import type { ImageGenerationRequest } from '../src/image-generation-adapter.js';
import { buildVisualRecipe } from '../src/visual-recipe.js';
import evidence from './fixtures/character-gate-cs9-evidence.json' with { type: 'json' };

const CLEAN_TRIO = (evidence as Record<string, unknown>)['run-cs9-lora-2026-11-17T1109/cyberpunk-trio-preview.png'];
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

async function fixture(characterCount = 3) {
  const recipe = buildVisualRecipe({ artType: 'thumbnail', prompt: 'cyberpunk trio in a rainy city', characterCount, seed: 500 });
  const requests: ImageGenerationRequest[] = [];
  let provider = 'comfyui-native';
  const png = await sharp({ create: { width: recipe.width, height: recipe.height, channels: 3, background: '#335' } }).png().toBuffer();
  const adapter = {
    id: 'fake',
    isAvailable: async () => true,
    generateImage: async (request: ImageGenerationRequest) => {
      requests.push(request);
      return png;
    },
    getLastServedProvider: () => ({ providerId: provider, fallbackErrors: provider === 'comfyui-native' ? [] : ['comfyui-native: timeout'] }),
    getLastGenerationMetadata: () => ({ checkpoint: 'animagine-xl-3.1.safetensors' }),
  };
  const ingestion = new AssetIngestionService({ storageRoot: mkdtempSync(join(tmpdir(), 'gate-test-')) });
  const baseRequest: ImageGenerationRequest = { prompt: recipe.positivePrompt, negativePrompt: recipe.negativePrompt, width: recipe.width, height: recipe.height, characterRegions: recipe.characterRegions };
  return { recipe, requests, adapter, ingestion, baseRequest, setProvider: (id: string) => { provider = id; } };
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
});
