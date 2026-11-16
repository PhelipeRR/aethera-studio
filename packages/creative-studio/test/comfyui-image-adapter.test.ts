import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ComfyUiImageAdapter, type ComfyUiGateway } from '../src/comfyui-image-adapter.js';
import type { ComfyUiHistoryEntry } from '../src/comfyui-client.js';

function readyObjectInfo(): Record<string, unknown> {
  return {
    CheckpointLoaderSimple: { input: { required: { ckpt_name: [['sdxl.safetensors']] } } },
    CLIPTextEncode: {}, EmptyLatentImage: {}, KSampler: {}, VAEDecode: {}, SaveImage: {}, LoadImage: {}, VAEEncode: {},
  };
}

function fakeGateway(): ComfyUiGateway & { queued?: Record<string, unknown> } {
  const gateway: ComfyUiGateway & { queued?: Record<string, unknown> } = {
    async getSystemStats() { return { devices: [{ name: 'RTX 4060 Ti', vram_total: 8_188_000_000 }] }; },
    async getObjectInfo() { return readyObjectInfo(); },
    async queuePrompt(prompt) { gateway.queued = prompt; return { prompt_id: 'prompt-1' }; },
    async waitForCompletion(_promptId): Promise<ComfyUiHistoryEntry> {
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
});
