import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import type { ImageGenerationRequest } from '../src/image-generation-adapter.js';
import { generateLayeredComposition } from '../src/layered-composition.js';
import { buildVisualRecipe } from '../src/visual-recipe.js';

describe('layered composition', () => {
  it('generates a plate and one portrait per character with models held, cuts out in one batch and harmonizes', async () => {
    const recipe = buildVisualRecipe({ artType: 'thumbnail', prompt: 'team lineup', characterCount: 4, seed: 900, direction: { setting: 'neon rooftop' } });
    const requests: ImageGenerationRequest[] = [];
    const events: string[] = [];
    const adapter = {
      id: 'fake',
      isAvailable: async () => true,
      generateImage: async (request: ImageGenerationRequest) => {
        requests.push(request);
        events.push(request.referenceImagePaths ? 'harmonize' : request.width === 832 ? 'portrait' : 'plate');
        return sharp({ create: { width: request.width ?? 64, height: request.height ?? 64, channels: 3, background: '#888' } }).png().toBuffer();
      },
      removeBackground: async () => {
        throw new Error('per-image cutout must not be used when a batch cutout is provided');
      },
    };
    // A cutout with an opaque 100x300 figure in the middle of a transparent portrait.
    const figure = await sharp({ create: { width: 832, height: 1216, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: await sharp({ create: { width: 100, height: 300, channels: 4, background: { r: 200, g: 50, b: 50, alpha: 1 } } }).png().toBuffer(), left: 366, top: 800 }])
      .png()
      .toBuffer();
    let batches = 0;
    const result = await generateLayeredComposition({
      adapter,
      recipe,
      baseRequest: { prompt: recipe.positivePrompt, negativePrompt: recipe.negativePrompt, width: recipe.width, height: recipe.height, characterRegions: recipe.characterRegions, compositionStrategy: { sceneStrength: 0.2 } },
      seed: 900,
      poseControlNetModel: 'openpose.safetensors',
      workDir: mkdtempSync(join(tmpdir(), 'layered-test-')),
      assertProvider: () => undefined,
      holdModels: async (work) => {
        events.push('hold');
        const value = await work();
        events.push('release');
        return value;
      },
      cutoutBatch: async (paths) => {
        batches += 1;
        events.push('cutout');
        return paths.map(() => figure);
      },
    });

    expect(events).toEqual(['plate', 'hold', 'portrait', 'portrait', 'portrait', 'portrait', 'release', 'cutout', 'harmonize']);
    expect(batches).toBe(1);
    expect(requests[0]).toMatchObject({ seed: 900, negativePrompt: expect.stringContaining('person, people') });
    expect(requests[0]?.characterRegions).toBeUndefined();
    expect(requests.slice(1, 5).every((request) => request.width === 832 && request.height === 1216 && request.controlNet?.model === 'openpose.safetensors' && !request.compositionStrategy)).toBe(true);
    expect(requests[1]?.prompt).toMatch(/^solo, single character, full body.*white background/);
    expect(requests[5]).toMatchObject({ strength: 0.4, controlNet: { model: 'openpose.safetensors', strength: 0.6 } });
    expect(result.layers.map((layer) => layer.seed)).toEqual([1001, 1102, 1203, 1304]);
    expect(result.layers.every((layer) => layer.cutoutPixels === 30_000)).toBe(true);
  });
});
