import { describe, expect, it } from 'vitest';
import { inspectComfyUiCapabilities } from '../src/comfyui-capabilities.js';

describe('ComfyUI capability inspection', () => {
  it('reports only capabilities backed by nodes and model inventory', () => {
    const capabilities = inspectComfyUiCapabilities(
      { CheckpointLoaderSimple: {}, CLIPTextEncode: {}, EmptyLatentImage: {}, KSampler: {}, VAEDecode: {}, SaveImage: {}, LoadImage: {}, VAEEncode: {}, VAEEncodeForInpaint: {}, ControlNetLoader: {}, ControlNetApplyAdvanced: {}, IPAdapterModelLoader: {}, CLIPVisionLoader: {}, IPAdapterAdvanced: {}, FaceDetailer: {}, ImageUpscaleWithModel: {}, LoraLoader: {} },
      { checkpoints: ['sdxl.safetensors'], controlnet: ['canny.safetensors'], ipadapter: ['ipadapter.safetensors'], clip_vision: ['clip.safetensors'], diffusion_models: [], loras: ['style.safetensors'], vae: [], upscale_models: ['4x.pth'], embeddings: [] },
    );
    expect(capabilities).toEqual({
      nativeTxt2Img: true,
      nativeImg2Img: true,
      inpaint: true,
      controlNet: true,
      ipAdapter: true,
      faceDetailer: true,
      upscale: true,
      lora: true,
    });
  });

  it('does not infer optional features from a checkpoint alone', () => {
    expect(inspectComfyUiCapabilities({ CheckpointLoaderSimple: {} }, { checkpoints: ['base.safetensors'], controlnet: ['canny.safetensors'], ipadapter: ['ipadapter.safetensors'], clip_vision: ['clip.safetensors'], diffusion_models: [], loras: [], vae: [], upscale_models: [], embeddings: [] })).toEqual({
      nativeTxt2Img: false,
      nativeImg2Img: false,
      inpaint: false,
      controlNet: false,
      ipAdapter: false,
      faceDetailer: false,
      upscale: false,
      lora: false,
    });
  });
});
