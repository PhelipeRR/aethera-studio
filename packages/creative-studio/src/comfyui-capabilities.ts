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
  const hasNativeCore = ['CheckpointLoaderSimple', 'CLIPTextEncode', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage']
    .every((name) => nodes.has(name.toLowerCase())) && models.checkpoints.length > 0;
  const hasFaceDetailerExecutor = hasNode(nodes, 'FaceDetailer', 'DetailerForEach');
  const hasFaceDetectorProvider = hasNode(nodes, 'UltralyticsDetectorProvider', 'BboxDetectorProvider', 'SEGSDetectorProvider');
  return {
    nativeTxt2Img: hasNativeCore,
    nativeImg2Img: hasNativeCore && hasNode(nodes, 'LoadImage') && hasNode(nodes, 'VAEEncode'),
    inpaint: hasNativeCore && hasNode(nodes, 'LoadImage') && hasNode(nodes, 'VAEEncodeForInpaint'),
    controlNet: models.controlnet.length > 0 && hasNode(nodes, 'ControlNetLoader') && hasNode(nodes, 'ControlNetApplyAdvanced', 'ControlNetApply'),
    ipAdapter:
      models.ipadapter.length > 0 &&
      models.clip_vision.length > 0 &&
      hasNode(nodes, 'IPAdapterModelLoader') &&
      hasNode(nodes, 'CLIPVisionLoader') &&
      hasNode(nodes, 'IPAdapterApply', 'IPAdapterAdvanced'),
    // A detector provider alone cannot execute a face repair; keep the UI from advertising an un-runnable path.
    faceDetailer: hasFaceDetailerExecutor && hasFaceDetectorProvider,
    // The native adapter uses the model loader graph; UltimateSDUpscale alone is a different custom workflow.
    upscale: models.upscale_models.length > 0 && hasNode(nodes, 'UpscaleModelLoader') && hasNode(nodes, 'ImageUpscaleWithModel'),
    lora: models.loras.length > 0 && hasNode(nodes, 'LoraLoader', 'LoraLoaderModelOnly'),
  };
}
