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
      bbox: { x: 12, y: 10, width: 24, height: 20 },
      strength: 0.48,
    })).resolves.toEqual(Buffer.from('PNG bytes'));

    expect(uploads.map((upload) => upload.filename)).toEqual(['aethera-inpaint-base.png', 'aethera-inpaint-mask.png']);
    expect(gateway.queued?.['4']).toMatchObject({ class_type: 'LoadImage', inputs: { image: 'aethera/aethera-inpaint-base.png' } });
    expect(gateway.queued?.['5']).toMatchObject({ class_type: 'LoadImage', inputs: { image: 'aethera/aethera-inpaint-mask.png' } });
    expect(gateway.queued?.['6']).toMatchObject({ class_type: 'VAEEncodeForInpaint', inputs: { pixels: ['4', 0], mask: ['5', 0], grow_mask_by: 8 } });
    expect(gateway.queued?.['7']).toMatchObject({ class_type: 'KSampler', inputs: { denoise: 0.48, latent_image: ['6', 0] } });
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

  it('turns multiple character regions into a base pass plus bounded inpaint passes', async () => {
    const gateway = fakeGateway();
    const generated = await sharp({ create: { width: 128, height: 72, channels: 3, background: '#445566' } }).png().toBuffer();
    let queueCount = 0;
    gateway.queuePrompt = async (prompt) => {
      queueCount += 1;
      gateway.queued = prompt;
      return { prompt_id: `prompt-${queueCount}` };
    };
    gateway.getImage = async () => generated;
    gateway.uploadImage = async (_buffer, filename) => ({ name: filename, subfolder: 'aethera', type: 'input' });
    const adapter = new ComfyUiImageAdapter({ gateway, checkpoint: 'sdxl.safetensors' });

    await expect(adapter.generateImage({
      prompt: 'two distinct anime warriors in an action exchange',
      negativePrompt: 'fused bodies',
      width: 128,
      height: 72,
      characterCount: 2,
      characterRegions: [
        { id: 'left', anchor: 'left', x: 0, y: 0, width: 56, height: 72 },
        { id: 'right', anchor: 'right', x: 72, y: 0, width: 56, height: 72 },
      ],
    })).resolves.toEqual(generated);
    expect(queueCount).toBe(3);
    expect(gateway.queued?.['6']).toMatchObject({ class_type: 'VAEEncodeForInpaint' });
  });
});
