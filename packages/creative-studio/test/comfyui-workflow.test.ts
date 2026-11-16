import { describe, expect, it } from 'vitest';
import {
  buildComfyUiTxt2ImgWorkflow,
  extractComfyUiImages,
  validateComfyUiWorkflow,
} from '../src/comfyui-workflow.js';
import type { ComfyUiHistoryEntry } from '../src/comfyui-client.js';

describe('ComfyUI workflow registry', () => {
  it('builds a native-node txt2img graph with the requested generation controls', () => {
    const workflow = buildComfyUiTxt2ImgWorkflow({
      checkpoint: 'sd_xl_base_1.0.safetensors',
      positivePrompt: 'cinematic cyberpunk hero, clean composition',
      negativePrompt: 'text, watermark, extra limbs',
      width: 1280,
      height: 720,
      seed: 42,
      steps: 8,
      cfg: 5.5,
      samplerName: 'euler',
      scheduler: 'normal',
      filenamePrefix: 'Aethera/nextworth',
    });

    expect(workflow['1']).toMatchObject({ class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sd_xl_base_1.0.safetensors' } });
    expect(workflow['2']).toMatchObject({ class_type: 'CLIPTextEncode', inputs: { text: 'cinematic cyberpunk hero, clean composition', clip: ['1', 1] } });
    expect(workflow['3']).toMatchObject({ class_type: 'CLIPTextEncode', inputs: { text: 'text, watermark, extra limbs', clip: ['1', 1] } });
    expect(workflow['4']).toMatchObject({ class_type: 'EmptyLatentImage', inputs: { width: 1280, height: 720, batch_size: 1 } });
    expect(workflow['5']).toMatchObject({
      class_type: 'KSampler',
      inputs: { seed: 42, steps: 8, cfg: 5.5, sampler_name: 'euler', scheduler: 'normal', denoise: 1, model: ['1', 0], positive: ['2', 0], negative: ['3', 0], latent_image: ['4', 0] },
    });
    expect(workflow['7']).toMatchObject({ class_type: 'SaveImage', inputs: { filename_prefix: 'Aethera/nextworth', images: ['6', 0] } });
  });

  it('validates required native nodes and reports missing checkpoint names', () => {
    const workflow = buildComfyUiTxt2ImgWorkflow({
      checkpoint: 'missing.safetensors',
      positivePrompt: 'hero',
      negativePrompt: 'text',
      width: 512,
      height: 512,
      seed: 1,
      steps: 4,
      cfg: 4,
      samplerName: 'euler',
      scheduler: 'normal',
      filenamePrefix: 'Aethera/test',
    });
    const result = validateComfyUiWorkflow(workflow, {
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [['installed.safetensors']] } } },
      CLIPTextEncode: {},
      EmptyLatentImage: {},
      KSampler: {},
      VAEDecode: {},
      SaveImage: {},
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Checkpoint "missing.safetensors" is not reported by ComfyUI as installed.');
  });

  it('extracts generated image references from history outputs', () => {
    const history: ComfyUiHistoryEntry = {
      outputs: {
        '7': { images: [{ filename: 'Aethera_00001.png', subfolder: 'Aethera', type: 'output' }] },
        '6': { images: [{ filename: 'ignored.png', type: 'temp' }] },
      },
    };
    expect(extractComfyUiImages(history)).toEqual([{ filename: 'Aethera_00001.png', subfolder: 'Aethera', type: 'output' }]);
  });
});
