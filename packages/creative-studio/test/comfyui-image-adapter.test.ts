import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { ComfyUiImageAdapter, type ComfyUiGateway } from '../src/comfyui-image-adapter.js';
import type { ComfyUiHistoryEntry } from '../src/comfyui-client.js';

function readyObjectInfo(): Record<string, unknown> {
  return {
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sdxl.safetensors']] } } },
    CLIPTextEncode: {}, EmptyLatentImage: {}, KSampler: {}, VAEDecode: {}, SaveImage: {}, LoadImage: {}, VAEEncode: {}, VAEEncodeForInpaint: {}, UpscaleModelLoader: {}, ImageUpscaleWithModel: {},
    ImageToMask: {}, GrowMask: {}, SetLatentNoiseMask: {}, ConditioningSetArea: {}, ConditioningCombine: {}, ConditioningSetMask: {},
  };
}

function fakeGateway(): ComfyUiGateway & { queued?: Record<string, unknown> } {
  const gateway: ComfyUiGateway & { queued?: Record<string, unknown> } = {
    async getSystemStats() { return { devices: [{ name: 'RTX 4060 Ti', vram_total: 8_188_000_000 }] }; },
    async getObjectInfo() { return readyObjectInfo(); },
    async queuePrompt(prompt) { gateway.queued = prompt; return { prompt_id: 'prompt-1' }; },
    async waitForCompletion(promptId): Promise<ComfyUiHistoryEntry> {
      void promptId;
      return { outputs: { '7': { images: [{ filename: 'aethera.png', subfolder: '', type: 'output' }] } }, status: { completed: true } };
    },
    async getImage() { return Buffer.from('PNG bytes'); },
  };
  return gateway;
}

describe('ComfyUiImageAdapter', () => {
  it('uses the ComfyUI Desktop port by default and can retarget a native client', () => {
    const adapter = new ComfyUiImageAdapter();

    expect(adapter.getEndpoint()).toBe('http://127.0.0.1:8000');
    adapter.setEndpoint('http://127.0.0.1:8188');
    expect(adapter.getEndpoint()).toBe('http://127.0.0.1:8188');
  });

  it('validates the graph, queues the prompt, waits for completion, and downloads the output', async () => {
    const gateway = fakeGateway();
    const adapter = new ComfyUiImageAdapter({ gateway, checkpoint: 'sdxl.safetensors', steps: 6, cfg: 4.5 });

    await expect(adapter.isAvailable()).resolves.toBe(true);
    await expect(adapter.generateImage({
      prompt: 'cinematic hero',
      negativePrompt: 'text',
      width: 1280,
      height: 720,
      seed: 17,
    })).resolves.toEqual(Buffer.from('PNG bytes'));

    expect(gateway.queued?.['1']).toMatchObject({ class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'sdxl.safetensors' } });
    expect(gateway.queued?.['5']).toMatchObject({ class_type: 'KSampler', inputs: { seed: 17, steps: 6, cfg: 4.5 } });
  });

  it('runs FaceDetailer only when the requested detector is exposed by ComfyUI', async () => {
    const gateway = fakeGateway();
    gateway.getObjectInfo = async () => ({
      ...readyObjectInfo(),
      UltralyticsDetectorProvider: { input: { required: { model_name: [['bbox/face_yolov8m.pt']] } } },
      FaceDetailer: {},
    });
    const adapter = new ComfyUiImageAdapter({ gateway, checkpoint: 'sdxl.safetensors' });

    await adapter.generateImage({
      prompt: 'anime portrait',
      negativePrompt: 'text',
      width: 768,
      height: 768,
      seed: 12,
      faceDetailer: { detectorModel: 'bbox/face_yolov8m.pt', denoise: 0.3 },
    });

    expect(gateway.queued?.['20']).toMatchObject({ class_type: 'UltralyticsDetectorProvider', inputs: { model_name: 'bbox/face_yolov8m.pt' } });
    expect(gateway.queued?.['21']).toMatchObject({ class_type: 'FaceDetailer', inputs: { bbox_detector: ['20', 0], denoise: 0.3 } });
    expect(gateway.queued?.['22']).toMatchObject({ class_type: 'SaveImage', inputs: { images: ['21', 0] } });
  });

  it('returns the FaceDetailer output, not the unrefined base image saved by the same graph', async () => {
    const gateway = fakeGateway();
    gateway.getObjectInfo = async () => ({
      ...readyObjectInfo(),
      UltralyticsDetectorProvider: { input: { required: { model_name: [['bbox/face_yolov8m.pt']] } } },
      FaceDetailer: {},
    });
    gateway.waitForCompletion = async () => ({
      outputs: {
        '7': { images: [{ filename: 'base.png', subfolder: '', type: 'output' }] },
        '22': { images: [{ filename: 'refined.png', subfolder: '', type: 'output' }] },
      },
      status: { completed: true },
    });
    gateway.getImage = async (image) => Buffer.from(image.filename);
    const adapter = new ComfyUiImageAdapter({ gateway, checkpoint: 'sdxl.safetensors' });

    const result = await adapter.generateImage({
      prompt: 'anime portrait', width: 768, height: 768, seed: 12, faceDetailer: { detectorModel: 'bbox/face_yolov8m.pt' },
    });
    expect(result.toString()).toBe('refined.png');
  });

  it('queues a native LoRA loader only when the selected model is reported by ComfyUI', async () => {
    const gateway = fakeGateway();
    gateway.getObjectInfo = async () => ({
      ...readyObjectInfo(),
      LoraLoader: { input: { required: { lora_name: [['anime-style.safetensors']] } } },
    });
    const adapter = new ComfyUiImageAdapter({ gateway, checkpoint: 'sdxl.safetensors' });

    await adapter.generateImage({
      prompt: 'anime key visual',
      width: 768,
      height: 768,
      lora: { model: 'anime-style.safetensors', strengthModel: 0.7, strengthClip: 0.6 },
    });

    expect(gateway.queued?.['10']).toMatchObject({ class_type: 'LoraLoader', inputs: { lora_name: 'anime-style.safetensors', strength_model: 0.7, strength_clip: 0.6 } });
    expect(gateway.queued?.['2']).toMatchObject({ inputs: { clip: ['10', 1] } });
    expect(gateway.queued?.['5']).toMatchObject({ inputs: { model: ['10', 0] } });
  });

  it('passes a bounded LoRA stack through the native adapter and preserves loader chaining', async () => {
    const gateway = fakeGateway();
    gateway.getObjectInfo = async () => ({
      ...readyObjectInfo(),
      LoraLoader: { input: { required: { lora_name: [['character.safetensors', 'style.safetensors']] } } },
      LoraLoaderModelOnly: { input: { required: { lora_name: [['character.safetensors', 'style.safetensors']] } } },
    });
    const adapter = new ComfyUiImageAdapter({ gateway, checkpoint: 'sdxl.safetensors' });

    await adapter.generateImage({
      prompt: 'character manga style',
      width: 768,
      height: 768,
      loras: [
        { model: 'character.safetensors', strengthModel: 0.7, strengthClip: 0.6 },
        { model: 'style.safetensors', strengthModel: 0.35, strengthClip: 0.25, nodeType: 'LoraLoaderModelOnly' },
      ],
    });

    expect(gateway.queued?.['10']).toMatchObject({ class_type: 'LoraLoader', inputs: { lora_name: 'character.safetensors', model: ['1', 0] } });
    expect(gateway.queued?.['11']).toMatchObject({ class_type: 'LoraLoaderModelOnly', inputs: { lora_name: 'style.safetensors', model: ['10', 0] } });
    expect(gateway.queued?.['2']).toMatchObject({ inputs: { clip: ['10', 1] } });
    expect(gateway.queued?.['5']).toMatchObject({ inputs: { model: ['11', 0] } });
  });

  it('uploads a conditioning image and queues the discovered ControlNet graph', async () => {
    const gateway = fakeGateway();
    const uploads: string[] = [];
    gateway.getObjectInfo = async () => ({
      ...readyObjectInfo(),
      ControlNetLoader: { input: { required: { control_net_name: [['control-lora-canny.safetensors']] } } },
      ControlNetApplyAdvanced: {},
    });
    gateway.uploadImage = async (_buffer, filename) => {
      uploads.push(filename);
      return { name: filename, subfolder: 'aethera', type: 'input' };
    };
    const root = mkdtempSync(join(tmpdir(), 'comfy-control-'));
    const controlPath = join(root, 'canny.png');
    writeFileSync(controlPath, Buffer.from('control bytes'));
    try {
      const adapter = new ComfyUiImageAdapter({ gateway, checkpoint: 'sdxl.safetensors' });
      await adapter.generateImage({
        prompt: 'controlled pose',
        width: 768,
        height: 768,
        controlNet: { model: 'control-lora-canny.safetensors', imagePath: controlPath, strength: 0.8 },
      });
      expect(uploads).toEqual(['canny.png']);
      expect(gateway.queued?.['11']).toMatchObject({ class_type: 'ControlNetLoader' });
      expect(gateway.queued?.['13']).toMatchObject({ class_type: 'ControlNetApplyAdvanced', inputs: { image: ['12', 0], strength: 0.8 } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uploads the reference and queues the official IP-Adapter stack when both model inventories are exposed', async () => {
    const gateway = fakeGateway();
    const uploads: string[] = [];
    gateway.getObjectInfo = async () => ({
      ...readyObjectInfo(),
      IPAdapterModelLoader: { input: { required: { ipadapter_file: [['ip-adapter-plus_sdxl.safetensors']] } } },
      CLIPVisionLoader: { input: { required: { clip_name: [['CLIP-ViT-H.safetensors']] } } },
      IPAdapterAdvanced: {},
    });
    gateway.uploadImage = async (_buffer, filename) => {
      uploads.push(filename);
      return { name: filename, subfolder: 'aethera', type: 'input' };
    };
    const root = mkdtempSync(join(tmpdir(), 'comfy-ipadapter-'));
    const referencePath = join(root, 'identity.png');
    writeFileSync(referencePath, Buffer.from('identity bytes'));
    try {
      const adapter = new ComfyUiImageAdapter({ gateway, checkpoint: 'sdxl.safetensors' });
      await adapter.generateImage({
        prompt: 'same character, anime key visual',
        width: 768,
        height: 768,
        ipAdapter: { model: 'ip-adapter-plus_sdxl.safetensors', clipVisionModel: 'CLIP-ViT-H.safetensors', weight: 0.9, referenceImagePath: referencePath },
      });
      expect(uploads).toEqual(['identity.png']);
      expect(gateway.queued?.['14']).toMatchObject({ class_type: 'IPAdapterModelLoader' });
      expect(gateway.queued?.['17']).toMatchObject({ class_type: 'IPAdapterAdvanced', inputs: { image: ['16', 0], weight: 0.9 } });
      expect(gateway.queued?.['5']).toMatchObject({ inputs: { model: ['17', 0] } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('is unavailable and gives an actionable error when the selected checkpoint is absent', async () => {
    const gateway = fakeGateway();
    gateway.getObjectInfo = async () => ({
      CheckpointLoaderSimple: { input: { required: { ckpt_name: [['other.safetensors']] } } },
      CLIPTextEncode: {}, EmptyLatentImage: {}, KSampler: {}, VAEDecode: {}, SaveImage: {},
    });
    const adapter = new ComfyUiImageAdapter({ gateway, checkpoint: 'missing.safetensors' });

    await expect(adapter.isAvailable()).resolves.toBe(false);
    await expect(adapter.generateImage({ prompt: 'hero', width: 512, height: 512 })).rejects.toThrow(/missing\.safetensors/);
  });

  it('uploads the first reference path and switches to the native img2img graph', async () => {
    const gateway = fakeGateway();
    gateway.uploadImage = async (_buffer, filename) => ({ name: filename, subfolder: 'aethera', type: 'input' });
    const root = mkdtempSync(join(tmpdir(), 'comfy-ref-'));
    const referencePath = join(root, 'reference.png');
    writeFileSync(referencePath, Buffer.from('reference bytes'));
    try {
      const adapter = new ComfyUiImageAdapter({ gateway, checkpoint: 'sdxl.safetensors' });
      await adapter.generateImage({ prompt: 'same hero, cinematic', width: 768, height: 768, referenceImagePaths: [referencePath], strength: 0.38 });
      expect(gateway.queued?.['4']).toMatchObject({ class_type: 'LoadImage', inputs: { image: 'aethera/reference.png' } });
      expect(gateway.queued?.['6']).toMatchObject({ class_type: 'KSampler', inputs: { denoise: 0.38, latent_image: ['5', 0] } });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('uploads a bounded mask and switches to the native localized inpaint graph', async () => {
    const gateway = fakeGateway();
    const uploads: Array<{ filename: string; bytes: Buffer }> = [];
    gateway.uploadImage = async (bytes, filename) => {
      uploads.push({ filename, bytes });
      return { name: filename, subfolder: 'aethera', type: 'input' };
    };
    const image = await sharp({ create: { width: 96, height: 64, channels: 3, background: '#334455' } }).png().toBuffer();
    const adapter = new ComfyUiImageAdapter({ gateway, checkpoint: 'sdxl.safetensors' });

    await expect(adapter.inpaintRegion({
      imageBuffer: image,
      prompt: 'repair the hand with coherent anatomy',
      negativePrompt: 'extra fingers, duplicate hands',
      bbox: { x: 12, y: 10, width: 24, height: 20 },
      strength: 0.48,
    })).resolves.toEqual(Buffer.from('PNG bytes'));

    expect(uploads.map((upload) => upload.filename)).toEqual(['aethera-inpaint-base.png', 'aethera-inpaint-mask.png']);
    expect(gateway.queued?.['4']).toMatchObject({ class_type: 'LoadImage', inputs: { image: 'aethera/aethera-inpaint-base.png' } });
    expect(gateway.queued?.['5']).toMatchObject({ class_type: 'LoadImage', inputs: { image: 'aethera/aethera-inpaint-mask.png' } });
    expect(gateway.queued?.['3']).toMatchObject({ class_type: 'CLIPTextEncode', inputs: { text: 'extra fingers, duplicate hands' } });
    expect(gateway.queued?.['inpaint_mask']).toMatchObject({ class_type: 'ImageToMask', inputs: { image: ['5', 0], channel: 'red' } });
    expect(gateway.queued?.['inpaint_grow']).toMatchObject({ class_type: 'GrowMask', inputs: { mask: ['inpaint_mask', 0], expand: 8 } });
    expect(gateway.queued?.['6']).toMatchObject({ class_type: 'SetLatentNoiseMask', inputs: { samples: ['inpaint_encode', 0], mask: ['inpaint_grow', 0] } });
    expect(gateway.queued?.['7']).toMatchObject({ class_type: 'KSampler', inputs: { denoise: 0.48, latent_image: ['6', 0] } });
    expect((gateway.queued?.['7'] as { inputs: { seed: number } }).inputs.seed).not.toBe(0);
    const maskUpload = uploads.at(1);
    expect(maskUpload).toBeDefined();
    await expect(sharp(maskUpload?.bytes ?? Buffer.alloc(0)).metadata()).resolves.toMatchObject({ width: 96, height: 64, format: 'png' });
  });

  it('uploads an input and runs native model-based upscale', async () => {
    const gateway = fakeGateway();
    gateway.uploadImage = async (_buffer, filename) => ({ name: filename, subfolder: 'aethera', type: 'input' });
    const adapter = new ComfyUiImageAdapter({ gateway, checkpoint: 'sdxl.safetensors' });

    await expect(adapter.upscaleImage({ imageBuffer: Buffer.from('PNG bytes'), model: '4x-UltraSharp.pth' })).resolves.toEqual(Buffer.from('PNG bytes'));
    expect(gateway.queued?.['1']).toMatchObject({ class_type: 'UpscaleModelLoader', inputs: { model_name: '4x-UltraSharp.pth' } });
    expect(gateway.queued?.['3']).toMatchObject({ class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['1', 0], image: ['2', 0] } });
  });

  it('renders multiple character regions in one pass with native area conditioning', async () => {
    const gateway = fakeGateway();
    let queueCount = 0;
    gateway.queuePrompt = async (prompt) => {
      queueCount += 1;
      gateway.queued = prompt;
      return { prompt_id: `prompt-${queueCount}` };
    };
    const uploads: string[] = [];
    gateway.uploadImage = async (_buffer, filename) => { uploads.push(filename); return { name: filename, subfolder: 'aethera', type: 'input' }; };
    const adapter = new ComfyUiImageAdapter({ gateway, checkpoint: 'sdxl.safetensors' });

    await adapter.generateImage({
      prompt: 'two distinct anime warriors in an action exchange',
      negativePrompt: 'fused bodies',
      width: 128,
      height: 72,
      characterCount: 2,
      characterRegions: [
        { id: 'left', anchor: 'left', x: 0, y: 0, width: 64, height: 72, prompt: 'solo, swordsman in crimson coat' },
        { id: 'right', anchor: 'right', x: 64, y: 0, width: 64, height: 72 },
      ],
    });
    expect(queueCount).toBe(1);
    expect(gateway.queued?.['2']).toMatchObject({ inputs: { text: 'two distinct anime warriors in an action exchange' } });
    expect(gateway.queued?.['region_1_text']).toMatchObject({ class_type: 'CLIPTextEncode', inputs: { text: 'solo, swordsman in crimson coat' } });
    expect(gateway.queued?.['region_2_text']).toMatchObject({ inputs: { text: expect.stringContaining('solo, single character 2 of 2') } });
    expect(gateway.queued?.['region_1_area']).toMatchObject({ class_type: 'ConditioningSetArea', inputs: { conditioning: ['region_1_text', 0], x: 0, y: 0, width: 64, height: 72, strength: 0.8 } });
    expect(gateway.queued?.['region_2_combine']).toMatchObject({ class_type: 'ConditioningCombine', inputs: { conditioning_1: ['region_1_combine', 0], conditioning_2: ['region_2_area', 0] } });
    expect(gateway.queued?.['5']).toMatchObject({ class_type: 'KSampler', inputs: { positive: ['region_2_combine', 0] } });
    expect(gateway.queued?.['masked_1_set']).toMatchObject({ class_type: 'ConditioningSetMask', inputs: { strength: 0.6 } });
    expect(uploads).toEqual(['aethera-scene-mask.png']);
    expect(adapter.getLastGenerationMetadata()).toMatchObject({
      regionalComposition: true,
      regionCount: 2,
      spatialControl: { mode: 'area_only', reason: expect.stringContaining('no OpenPose ControlNet') },
    });
  });

  it('enforces the character count with one OpenPose skeleton per region when the ControlNet is installed', async () => {
    const gateway = fakeGateway();
    gateway.getObjectInfo = async () => ({
      ...readyObjectInfo(),
      ControlNetLoader: { input: { required: { control_net_name: [['xinsir-depth.safetensors', 'thibaud-controlnet-openpose-sdxl-1.0.safetensors']] } } },
      ControlNetApplyAdvanced: {},
    });
    const uploaded = new Map<string, Buffer>();
    gateway.uploadImage = async (buffer, filename) => { uploaded.set(filename, buffer); return { name: filename, subfolder: 'aethera', type: 'input' }; };
    const adapter = new ComfyUiImageAdapter({ gateway, checkpoint: 'sdxl.safetensors' });
    const regions = Array.from({ length: 8 }, (_, index) => ({ id: `r${index}`, anchor: 'center', x: 64 + index * 150, y: index % 2 ? 90 : 200, width: 140, height: index % 2 ? 460 : 550 }));

    await adapter.generateImage({ prompt: 'scene', width: 1344, height: 768, characterRegions: regions, calmZones: [{ x: 400, y: 280, width: 540, height: 220 }] });
    expect(gateway.queued?.['13']).toMatchObject({ class_type: 'ControlNetApplyAdvanced', inputs: { strength: 0.9, end_percent: 0.85 } });
    expect(gateway.queued?.['11']).toMatchObject({ class_type: 'ControlNetLoader', inputs: { control_net_name: 'thibaud-controlnet-openpose-sdxl-1.0.safetensors' } });
    expect(gateway.queued?.['region_8_area']).toMatchObject({ inputs: { strength: 1 } });
    expect([...uploaded.keys()].sort()).toEqual(['aethera-calm-mask.png', 'aethera-pose-guide.png', 'aethera-scene-mask.png']);
    await expect(sharp(uploaded.get('aethera-pose-guide.png')!).metadata()).resolves.toMatchObject({ width: 1344, height: 768 });
    expect(adapter.getLastGenerationMetadata()).toMatchObject({
      spatialControl: { mode: 'openpose', model: 'thibaud-controlnet-openpose-sdxl-1.0.safetensors', strength: 0.9 },
      maskedPrompts: [{ purpose: 'scene_background', strength: 0.6 }, { purpose: 'calm_zone', strength: 0.8 }],
    });
  });

  it('moves Animagine generations into the model-card sampling envelope and records the adjustment', async () => {
    const gateway = fakeGateway();
    gateway.getObjectInfo = async () => ({ ...readyObjectInfo(), CheckpointLoaderSimple: { input: { required: { ckpt_name: [['animagine-xl-3.1.safetensors']] } } } });
    const adapter = new ComfyUiImageAdapter({ gateway, checkpoint: 'animagine-xl-3.1.safetensors' });

    await adapter.generateImage({ prompt: 'anime warrior', width: 1344, height: 768, steps: 12, cfg: 5.5, samplerName: 'dpmpp_2m', scheduler: 'karras' });
    expect(gateway.queued?.['5']).toMatchObject({ inputs: { steps: 24, cfg: 5.5, sampler_name: 'euler_ancestral', scheduler: 'normal' } });
    expect(gateway.queued?.['2']).toMatchObject({ inputs: { text: 'masterpiece, best quality, very aesthetic, absurdres, anime warrior' } });
    expect(adapter.getLastGenerationMetadata()?.checkpointProfile).toEqual({
      family: 'animagine-xl-3',
      evidence: 'model_card',
      adjustments: ['steps 12→24', 'sampler dpmpp_2m→euler_ancestral', 'scheduler karras→normal'],
    });
  });
});
