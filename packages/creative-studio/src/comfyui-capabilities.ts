import type { ComfyUiModelInventory } from './comfyui-discovery.js';

export interface ComfyUiCapabilities {
  nativeTxt2Img: boolean;
  nativeImg2Img: boolean;
  inpaint: boolean;
  controlNet: boolean;
  ipAdapter: boolean;
  faceDetailer: boolean;
  upscale: boolean;
  lora: boolean;
}

function hasNode(nodes: Set<string>, ...names: string[]): boolean {
  return names.some((name) => nodes.has(name.toLowerCase()));
}

export function inspectComfyUiCapabilities(objectInfo: Record<string, unknown>, models: ComfyUiModelInventory): ComfyUiCapabilities {
  const nodes = new Set(Object.keys(objectInfo).map((name) => name.toLowerCase()));
  return {
    nativeTxt2Img: ['CheckpointLoaderSimple', 'CLIPTextEncode', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage'].every((name) => nodes.has(name.toLowerCase())) && models.checkpoints.length > 0,
    nativeImg2Img: hasNode(nodes, 'LoadImage') && hasNode(nodes, 'VAEEncode') && models.checkpoints.length > 0,
    inpaint: hasNode(nodes, 'LoadImage') && hasNode(nodes, 'VAEEncodeForInpaint') && models.checkpoints.length > 0,
    controlNet: models.controlnet.length > 0 && hasNode(nodes, 'ControlNetLoader') && hasNode(nodes, 'ControlNetApplyAdvanced', 'ControlNetApply'),
    ipAdapter:
      models.ipadapter.length > 0 &&
      models.clip_vision.length > 0 &&
      hasNode(nodes, 'IPAdapterModelLoader') &&
      hasNode(nodes, 'CLIPVisionLoader') &&
      hasNode(nodes, 'IPAdapterApply', 'IPAdapterAdvanced'),
    faceDetailer: hasNode(nodes, 'FaceDetailer', 'DetailerForEach', 'UltralyticsDetectorProvider'),
    upscale: models.upscale_models.length > 0 && hasNode(nodes, 'ImageUpscaleWithModel', 'UltimateSDUpscale'),
    lora: models.loras.length > 0 && hasNode(nodes, 'LoraLoader', 'LoraLoaderModelOnly'),
  };
}
