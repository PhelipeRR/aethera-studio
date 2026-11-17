import { describe, expect, it } from 'vitest';
import {
  buildComfyUiTxt2ImgWorkflow,
  buildComfyUiImg2ImgWorkflow,
  buildComfyUiInpaintWorkflow,
  buildComfyUiUpscaleWorkflow,
  buildComfyUiFaceDetailerWorkflow,
  extractComfyUiImages,
  validateComfyUiWorkflow,
  type ComfyUiWorkflow,
} from '../src/comfyui-workflow.js';
import type { ComfyUiHistoryEntry } from '../src/comfyui-client.js';

describe('ComfyUI workflow registry', () => {
  it('builds a FaceDetailer pass from the native output and validates its detector model', () => {
    const workflow = buildComfyUiFaceDetailerWorkflow({
      checkpoint: 'animagine-xl-3.1.safetensors',
      positivePrompt: 'anime portrait, clean face and hands',
      negativePrompt: 'text, malformed anatomy',
      width: 768,
      height: 768,
      seed: 42,
      steps: 8,
      cfg: 5.5,
      samplerName: 'euler',
      scheduler: 'normal',
      filenamePrefix: 'Aethera/facedetailer',
      faceDetailer: { detectorModel: 'bbox/face_yolov8m.pt', seed: 43, denoise: 0.35 },
    });

    expect(workflow['20']).toMatchObject({ class_type: 'UltralyticsDetectorProvider', inputs: { model_name: 'bbox/face_yolov8m.pt' } });
    expect(workflow['21']).toMatchObject({
      class_type: 'FaceDetailer',
      inputs: { image: ['6', 0], model: ['1', 0], clip: ['1', 1], vae: ['1', 2], bbox_detector: ['20', 0], seed: 43, denoise: 0.35 },
    });
    expect(workflow['22']).toMatchObject({ class_type: 'SaveImage', inputs: { images: ['21', 0] } });
    expect(validateComfyUiWorkflow(workflow, {
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [['animagine-xl-3.1.safetensors']] } } },
      CLIPTextEncode: {}, EmptyLatentImage: {}, KSampler: {}, VAEDecode: {}, SaveImage: {},
      UltralyticsDetectorProvider: { input: { required: { model_name: [['bbox/face_yolov8m.pt']] } } },
      FaceDetailer: {},
    })).toEqual({ ok: true, errors: [] });
  });

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

  it('chains multiple LoRAs without colliding with ControlNet or IP-Adapter nodes', () => {
    const workflow = buildComfyUiTxt2ImgWorkflow({
      checkpoint: 'animagine-xl-3.1.safetensors',
      positivePrompt: 'Goku cinematic manga aura',
      negativePrompt: 'text',
      width: 768,
      height: 768,
      seed: 10,
      steps: 8,
      cfg: 5,
      samplerName: 'euler',
      scheduler: 'normal',
      filenamePrefix: 'Aethera/lora-stack',
      loras: [
        { model: 'character/goku.safetensors', strengthModel: 0.7, strengthClip: 0.6 },
        { model: 'style/manga.safetensors', strengthModel: 0.35, strengthClip: 0.25, nodeType: 'LoraLoaderModelOnly' },
      ],
      controlNet: {
        model: 'pose.safetensors',
        image: { filename: 'pose.png', subfolder: 'aethera', type: 'input' },
      },
      ipAdapter: {
        model: 'ip.safetensors',
        clipVisionModel: 'clip.safetensors',
        image: { filename: 'identity.png', subfolder: 'aethera', type: 'input' },
      },
    });

    expect(workflow['10']).toMatchObject({ class_type: 'LoraLoader', inputs: { model: ['1', 0], clip: ['1', 1], lora_name: 'character/goku.safetensors' } });
    expect(workflow['11']).toMatchObject({ class_type: 'LoraLoaderModelOnly', inputs: { model: ['10', 0], lora_name: 'style/manga.safetensors' } });
    expect(workflow['2']?.inputs['clip']).toEqual(['10', 1]);
    expect(workflow['5']?.inputs['model']).toEqual(['18', 0]);
    expect(workflow['12']).toMatchObject({ class_type: 'ControlNetLoader' });
    expect(workflow['14']).toMatchObject({ class_type: 'ControlNetApply' });
    expect(workflow['18']).toMatchObject({ class_type: 'IPAdapterAdvanced' });
    expect(workflow['18']?.inputs['model']).toEqual(['11', 0]);
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

  it('preserves a multi-LoRA stack when switching to img2img', () => {
    const workflow = buildComfyUiImg2ImgWorkflow({
      checkpoint: 'sdxl.safetensors',
      positivePrompt: 'manga character',
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
      filenamePrefix: 'Aethera/reference-lora-stack',
      loras: [
        { model: 'character.safetensors' },
        { model: 'manga.safetensors', nodeType: 'LoraLoaderModelOnly' },
      ],
    });

    expect(workflow['10']).toMatchObject({ class_type: 'LoraLoader' });
    expect(workflow['11']).toMatchObject({ class_type: 'LoraLoaderModelOnly', inputs: { model: ['10', 0] } });
    expect(workflow['6']?.inputs['model']).toEqual(['11', 0]);
    expect(workflow['6']?.inputs['latent_image']).toEqual(['5', 0]);
  });

  it('preserves ControlNet nodes when an img2img reference is combined with conditioning', () => {
    const workflow = buildComfyUiImg2ImgWorkflow({
      checkpoint: 'sdxl.safetensors',
      positivePrompt: 'hero portrait with controlled pose',
      negativePrompt: 'text, deformed anatomy',
      width: 768,
      height: 768,
      seed: 8,
      steps: 10,
      cfg: 5,
      samplerName: 'euler',
      scheduler: 'normal',
      denoise: 0.42,
      inputImage: { filename: 'reference.png', subfolder: 'aethera', type: 'input' },
      filenamePrefix: 'Aethera/reference-controlnet',
      controlNet: {
        model: 'control-lora-pose.safetensors',
        image: { filename: 'pose.png', subfolder: 'aethera', type: 'input' },
        strength: 0.7,
        nodeType: 'ControlNetApplyAdvanced',
      },
    });

    expect(workflow['11']).toMatchObject({ class_type: 'ControlNetLoader' });
    expect(workflow['12']).toMatchObject({ class_type: 'LoadImage', inputs: { image: 'aethera/pose.png' } });
    expect(workflow['13']).toMatchObject({ class_type: 'ControlNetApplyAdvanced' });
    expect(workflow['6']?.inputs['positive']).toEqual(['13', 0]);
    expect(workflow['6']?.inputs['negative']).toEqual(['13', 1]);
  });

  it('rejects workflows with dangling node references before queueing them', () => {
    const workflow = buildComfyUiTxt2ImgWorkflow({
      checkpoint: 'sdxl.safetensors',
      positivePrompt: 'controlled pose',
      negativePrompt: 'text',
      width: 768,
      height: 768,
      seed: 8,
      steps: 8,
      cfg: 5,
      samplerName: 'euler',
      scheduler: 'normal',
      filenamePrefix: 'Aethera/dangling',
      controlNet: {
        model: 'control-lora-pose.safetensors',
        image: { filename: 'pose.png', subfolder: 'aethera', type: 'input' },
        nodeType: 'ControlNetApplyAdvanced',
      },
    });
    delete workflow['13'];

    const result = validateComfyUiWorkflow(workflow, {
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sdxl.safetensors']] } } },
      CLIPTextEncode: {}, EmptyLatentImage: {}, KSampler: {}, VAEDecode: {}, SaveImage: {}, LoadImage: {},
      ControlNetLoader: { input: { required: { control_net_name: [['control-lora-pose.safetensors']] } } },
      ControlNetApplyAdvanced: {},
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toContain('Workflow node 5 references missing node 13.');
  });

  it('adds a discovered ControlNet apply path and validates the conditioning model', () => {
    const workflow = buildComfyUiTxt2ImgWorkflow({
      checkpoint: 'sdxl.safetensors',
      positivePrompt: 'cinematic pose',
      negativePrompt: 'text',
      width: 768,
      height: 768,
      seed: 3,
      steps: 8,
      cfg: 5,
      samplerName: 'euler',
      scheduler: 'normal',
      filenamePrefix: 'Aethera/controlnet',
      controlNet: {
        model: 'control-lora-canny.safetensors',
        image: { filename: 'canny.png', subfolder: 'aethera', type: 'input' },
        strength: 0.8,
        nodeType: 'ControlNetApplyAdvanced',
      },
    });

    expect(workflow['11']).toMatchObject({ class_type: 'ControlNetLoader', inputs: { control_net_name: 'control-lora-canny.safetensors' } });
    expect(workflow['12']).toMatchObject({ class_type: 'LoadImage', inputs: { image: 'aethera/canny.png' } });
    expect(workflow['13']).toMatchObject({ class_type: 'ControlNetApplyAdvanced', inputs: { strength: 0.8, positive: ['2', 0], negative: ['3', 0] } });
    expect(workflow['5']?.inputs['positive']).toEqual(['13', 0]);
    expect(workflow['5']?.inputs['negative']).toEqual(['13', 1]);
    expect(
      validateComfyUiWorkflow(workflow, {
        CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sdxl.safetensors']] } } },
        CLIPTextEncode: {}, EmptyLatentImage: {}, KSampler: {}, VAEDecode: {}, SaveImage: {}, LoadImage: {},
        ControlNetLoader: { input: { required: { control_net_name: [['control-lora-canny.safetensors']] } } },
        ControlNetApplyAdvanced: {},
      }),
    ).toEqual({ ok: true, errors: [] });
  });

  it('adds the official IP-Adapter model and CLIP Vision loaders before the sampler', () => {
    const workflow = buildComfyUiTxt2ImgWorkflow({
      checkpoint: 'sdxl.safetensors',
      positivePrompt: 'same character, anime key visual',
      negativePrompt: 'text',
      width: 768,
      height: 768,
      seed: 5,
      steps: 8,
      cfg: 5,
      samplerName: 'euler',
      scheduler: 'normal',
      filenamePrefix: 'Aethera/ipadapter',
      ipAdapter: {
        model: 'ip-adapter-plus_sdxl.safetensors',
        clipVisionModel: 'CLIP-ViT-H.safetensors',
        image: { filename: 'identity.png', subfolder: 'aethera', type: 'input' },
        weight: 0.9,
        nodeType: 'IPAdapterAdvanced',
      },
    });

    expect(workflow['14']).toMatchObject({ class_type: 'IPAdapterModelLoader', inputs: { ipadapter_file: 'ip-adapter-plus_sdxl.safetensors' } });
    expect(workflow['15']).toMatchObject({ class_type: 'CLIPVisionLoader', inputs: { clip_name: 'CLIP-ViT-H.safetensors' } });
    expect(workflow['16']).toMatchObject({ class_type: 'LoadImage', inputs: { image: 'aethera/identity.png' } });
    expect(workflow['17']).toMatchObject({ class_type: 'IPAdapterAdvanced', inputs: { model: ['1', 0], ipadapter: ['14', 0], clip_vision: ['15', 0], image: ['16', 0], weight: 0.9 } });
    expect(workflow['5']?.inputs['model']).toEqual(['17', 0]);
    expect(
      validateComfyUiWorkflow(workflow, {
        CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sdxl.safetensors']] } } },
        CLIPTextEncode: {}, EmptyLatentImage: {}, KSampler: {}, VAEDecode: {}, SaveImage: {}, LoadImage: {},
        IPAdapterModelLoader: { input: { required: { ipadapter_file: [['ip-adapter-plus_sdxl.safetensors']] } } },
        CLIPVisionLoader: { input: { required: { clip_name: [['CLIP-ViT-H.safetensors']] } } },
        IPAdapterAdvanced: {},
      }),
    ).toEqual({ ok: true, errors: [] });
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
    expect(workflow['inpaint_mask']).toMatchObject({ class_type: 'ImageToMask', inputs: { image: ['5', 0], channel: 'red' } });
    expect(workflow['inpaint_encode']).toMatchObject({ class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['1', 2] } });
    expect(workflow['6']).toMatchObject({ class_type: 'SetLatentNoiseMask', inputs: { samples: ['inpaint_encode', 0], mask: ['inpaint_grow', 0] } });
    expect(workflow['9']).toMatchObject({ class_type: 'SaveImage', inputs: { images: ['8', 0] } });
  });

  it('rejects links whose types do not match the live object_info signatures', () => {
    const objectInfo = {
      LoadImage: { input: { required: { image: [['a.png']] } }, output: ['IMAGE', 'MASK'] },
      VAEEncodeForInpaint: { input: { required: { pixels: ['IMAGE', {}], vae: ['VAE', {}], mask: ['MASK', {}], grow_mask_by: ['INT', {}] } }, output: ['LATENT'] },
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [['m.safetensors']] } }, output: ['MODEL', 'CLIP', 'VAE'] },
    };
    const workflow: ComfyUiWorkflow = {
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'm.safetensors' } },
      '4': { class_type: 'LoadImage', inputs: { image: 'a.png' } },
      '6': { class_type: 'VAEEncodeForInpaint', inputs: { pixels: ['4', 0], vae: ['1', 2], mask: ['4', 0], grow_mask_by: 8 } },
    };
    expect(validateComfyUiWorkflow(workflow, objectInfo).errors).toContain(
      'Workflow node 6 (VAEEncodeForInpaint) input "mask" expects MASK but node 4 (LoadImage) output 0 is IMAGE.',
    );
    workflow['6']!.inputs['mask'] = ['4', 1];
    expect(validateComfyUiWorkflow(workflow, objectInfo).errors.filter((error) => error.includes('expects'))).toEqual([]);
  });

  it('binds regional prompts to pixel areas and feeds the combined conditioning to the sampler only', () => {
    const workflow = buildComfyUiTxt2ImgWorkflow({
      checkpoint: 'sdxl.safetensors', positivePrompt: 'scene', negativePrompt: 'bad', width: 1344, height: 768, seed: 1, steps: 24, cfg: 6,
      samplerName: 'euler_ancestral', scheduler: 'normal', filenamePrefix: 'Aethera/regional',
      regions: [
        { prompt: 'solo, left hero', x: 67, y: 61, width: 581, height: 645 },
        { prompt: 'solo, right hero', x: 695, y: 61, width: 581, height: 645, strength: 0.6 },
      ],
    });
    expect(workflow['region_1_area']).toMatchObject({ inputs: { x: 64, y: 56, width: 584, height: 648, strength: 0.8 } });
    expect(workflow['region_2_area']).toMatchObject({ inputs: { strength: 0.6 } });
    expect(workflow['5']).toMatchObject({ inputs: { positive: ['region_2_combine', 0], negative: ['3', 0] } });
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
