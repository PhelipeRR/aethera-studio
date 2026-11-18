import { describe, expect, it } from 'vitest';
import type { ExternalImageAdapter, LocalizedInpaintRequest } from '../src/image-generation-adapter.js';
import { ProviderChainImageAdapter } from '../src/local-ai-adapter.js';

const request = (controlNet: boolean): LocalizedInpaintRequest => ({
  imageBuffer: Buffer.from('img'),
  prompt: 'holding katana',
  bbox: { x: 0, y: 0, width: 10, height: 10 },
  ...(controlNet ? { maskBuffer: Buffer.from('mask'), controlNet: { model: 'depth.safetensors', imageBuffer: Buffer.from('ctl') } } : {}),
});

function providers(comfyFails: boolean) {
  const calls: string[] = [];
  const comfy: ExternalImageAdapter = {
    id: 'comfyui-native',
    isAvailable: async () => true,
    estimateDepth: async () => { calls.push('comfy:depth'); return Buffer.from('depth'); },
    inpaintRegion: async () => {
      calls.push('comfy:inpaint');
      if (comfyFails) throw new Error('comfy down');
      return Buffer.from('comfy');
    },
  };
  // A provider that inpaints but has no spatial guidance: it would silently ignore the mask and the ControlNet.
  const textOnly: ExternalImageAdapter = {
    id: 'local-python',
    isAvailable: async () => true,
    inpaintRegion: async () => { calls.push('text:inpaint'); return Buffer.from('text'); },
  };
  return { chain: new ProviderChainImageAdapter([textOnly, comfy]), calls };
}

describe('provider chain with ControlNet-guided repairs', () => {
  it('forwards depth estimation to a provider that supports it', async () => {
    const { chain, calls } = providers(false);
    expect((await chain.estimateDepth({ imageBuffer: Buffer.from('img') })).toString()).toBe('depth');
    expect(calls).toEqual(['comfy:depth']);
  });

  it('routes a ControlNet inpaint only to a provider with spatial guidance and never falls back to one that would ignore it', async () => {
    const ok = providers(false);
    expect((await ok.chain.inpaintRegion(request(true))).toString()).toBe('comfy');
    expect(ok.calls).toEqual(['comfy:inpaint']);

    const failing = providers(true);
    await expect(failing.chain.inpaintRegion(request(true))).rejects.toThrow(/comfy down/);
    expect(failing.calls).toEqual(['comfy:inpaint']);
  });

  it('keeps the provider fallback for plain inpaint requests', async () => {
    const { chain, calls } = providers(true);
    expect((await chain.inpaintRegion(request(false))).toString()).toBe('text');
    expect(calls).toEqual(['text:inpaint']);
  });
});
