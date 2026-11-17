import { describe, expect, it } from 'vitest';
import {
  buildComfyUiTxt2ImgWorkflow,
  buildComfyUiImg2ImgWorkflow,
  buildComfyUiInpaintWorkflow,
  buildComfyUiUpscaleWorkflow,
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

  it('applies a selected LoRA to the native model and CLIP paths and validates its inventory name', () => {
    const workflow = buildComfyUiTxt2ImgWorkflow({
      checkpoint: 'sdxl.safetensors',
      positivePrompt: 'anime key visual',
      negativePrompt: 'text',
      width: 768,
      height: 768,
      seed: 9,
      steps: 8,
      cfg: 5,
      samplerName: 'euler',
      scheduler: 'normal',
      filenamePrefix: 'Aethera/lora',
      lora: { model: 'anime-style.safetensors', strengthModel: 0.75, strengthClip: 0.6 },
    });

    expect(workflow['10']).toMatchObject({
      class_type: 'LoraLoader',
      inputs: {
        lora_name: 'anime-style.safetensors',
        strength_model: 0.75,
        strength_clip: 0.6,
      },
    });
    expect(workflow['2']?.inputs['clip']).toEqual(['10', 1]);
    expect(workflow['5']?.inputs['model']).toEqual(['10', 0]);
    expect(
      validateComfyUiWorkflow(workflow, {
        CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sdxl.safetensors']] } } },
        CLIPTextEncode: {}, EmptyLatentImage: {}, KSampler: {}, VAEDecode: {}, SaveImage: {},
        LoraLoader: { input: { required: { lora_name: [['anime-style.safetensors']] } } },
      }),
    ).toEqual({ ok: true, errors: [] });
  });

  it('builds a native img2img graph with an uploaded reference and denoise strength', () => {
    const workflow = buildComfyUiImg2ImgWorkflow({
      checkpoint: 'sdxl.safetensors',
      positivePrompt: 'hero portrait',
      negativePrompt: 'text',
      width: 768,
      height: 768,
      seed: 7,
      steps: 10,
      cfg: 5,
      samplerName: 'euler',
      scheduler: 'normal',
      denoise: 0.42,
      inputImage: { filename: 'reference.png', subfolder: 'aethera', type: 'input' },
      filenamePrefix: 'Aethera/reference',
    });

    expect(workflow['4']).toMatchObject({ class_type: 'LoadImage', inputs: { image: 'aethera/reference.png' } });
    expect(workflow['5']).toMatchObject({ class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['1', 2] } });
    expect(workflow['6']).toMatchObject({ class_type: 'KSampler', inputs: { denoise: 0.42, latent_image: ['5', 0] } });
    expect(workflow['8']).toMatchObject({ class_type: 'SaveImage', inputs: { images: ['7', 0] } });
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

  it('builds a native inpaint graph with separate image and mask inputs', () => {
    const workflow = buildComfyUiInpaintWorkflow({
      checkpoint: 'sdxl.safetensors',
      positivePrompt: 'repair the face and hands',
      negativePrompt: 'deformed anatomy, extra fingers',
      width: 1024,
      height: 576,
      seed: 4,
      steps: 10,
      cfg: 5,
      samplerName: 'euler',
      scheduler: 'normal',
      denoise: 0.5,
      image: { filename: 'base.png', subfolder: 'aethera', type: 'input' },
      mask: { filename: 'mask.png', subfolder: 'aethera', type: 'input' },
      growMaskBy: 8,
      filenamePrefix: 'Aethera/inpaint',
    });
    expect(workflow['4']).toMatchObject({ class_type: 'LoadImage', inputs: { image: 'aethera/base.png' } });
    expect(workflow['5']).toMatchObject({ class_type: 'LoadImage', inputs: { image: 'aethera/mask.png' } });
    expect(workflow['6']).toMatchObject({ class_type: 'VAEEncodeForInpaint', inputs: { pixels: ['4', 0], mask: ['5', 0], vae: ['1', 2], grow_mask_by: 8 } });
    expect(workflow['9']).toMatchObject({ class_type: 'SaveImage', inputs: { images: ['8', 0] } });
  });

  it('builds a checkpoint-independent model upscale graph', () => {
    const workflow = buildComfyUiUpscaleWorkflow({
      model: '4x-UltraSharp.pth',
      inputImage: { filename: 'generated.png', subfolder: 'aethera', type: 'input' },
      filenamePrefix: 'Aethera/upscale',
    });
    expect(workflow['1']).toMatchObject({ class_type: 'UpscaleModelLoader', inputs: { model_name: '4x-UltraSharp.pth' } });
    expect(workflow['3']).toMatchObject({ class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['1', 0], image: ['2', 0] } });
    expect(validateComfyUiWorkflow(workflow, { UpscaleModelLoader: {}, LoadImage: {}, ImageUpscaleWithModel: {}, SaveImage: {} })).toEqual({ ok: true, errors: [] });
  });
});
