import type { ComfyUiHistoryEntry, ComfyUiImageRef } from './comfyui-client.js';
import { normalizeLoraStack, type LoraStackItem } from './lora-catalog.js';

export interface ComfyUiWorkflowNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

export type ComfyUiWorkflow = Record<string, ComfyUiWorkflowNode>;

export interface ComfyUiTxt2ImgInput {
  checkpoint: string;
  positivePrompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed: number;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  filenamePrefix: string;
  lora?: { model: string; strengthModel?: number; strengthClip?: number; nodeType?: 'LoraLoader' | 'LoraLoaderModelOnly' };
  loras?: Array<{ model: string; strengthModel?: number; strengthClip?: number; nodeType?: 'LoraLoader' | 'LoraLoaderModelOnly' }>;
  controlNet?: ComfyUiControlNetInput;
  ipAdapter?: ComfyUiIpAdapterInput;
  faceDetailer?: ComfyUiFaceDetailerInput;
  /**
   * Native regional prompting: each region is encoded separately and bound to its pixel area with core
   * `ConditioningSetArea`, then combined with the global prompt. One sampling pass keeps lighting and scene coherent.
   */
  regions?: ComfyUiRegionalPrompt[];
  /**
   * Prompts bound to an uploaded soft mask with core `ConditioningSetMask` (white = conditioned). Used for the scene
   * prompt around the characters and for calm title safe areas.
   */
  maskedPrompts?: ComfyUiMaskedPrompt[];
}

export interface ComfyUiMaskedPrompt {
  prompt: string;
  mask: ComfyUiImageRef;
  strength: number;
}

export interface ComfyUiRegionalPrompt {
  prompt: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Area conditioning strength; 0.8 was the best observed balance on Animagine XL 3.1 (see docs/comfyui-audit.md). */
  strength?: number;
}

export interface ComfyUiFaceDetailerInput {
  detectorModel: string;
  guideSize?: number;
  maxSize?: number;
  seed?: number;
  steps?: number;
  cfg?: number;
  denoise?: number;
  bboxThreshold?: number;
  bboxDilation?: number;
  bboxCropFactor?: number;
}

export interface ComfyUiControlNetInput {
  model: string;
  image: ComfyUiImageRef;
  strength?: number;
  startPercent?: number;
  endPercent?: number;
  nodeType?: 'ControlNetApplyAdvanced' | 'ControlNetApply';
}

export interface ComfyUiIpAdapterInput {
  model: string;
  clipVisionModel: string;
  image: ComfyUiImageRef;
  weight?: number;
  nodeType?: 'IPAdapterAdvanced' | 'IPAdapterApply';
}

export interface ComfyUiWorkflowValidation {
  ok: boolean;
  errors: string[];
}

export interface ComfyUiImg2ImgInput extends ComfyUiTxt2ImgInput {
  inputImage: ComfyUiImageRef;
  denoise: number;
}

export interface ComfyUiInpaintInput extends ComfyUiTxt2ImgInput {
  image: ComfyUiImageRef;
  mask: ComfyUiImageRef;
  denoise: number;
  growMaskBy: number;
}

export interface ComfyUiUpscaleInput {
  model: string;
  inputImage: ComfyUiImageRef;
  filenamePrefix: string;
}

/**
 * Native ComfyUI graph used by the first production adapter. It deliberately avoids custom nodes so the graph can
 * be audited against /object_info and remains portable across a clean ComfyUI installation.
 */
export function buildComfyUiTxt2ImgWorkflow(input: ComfyUiTxt2ImgInput): ComfyUiWorkflow {
  const width = Math.max(64, Math.round(input.width / 8) * 8);
  const height = Math.max(64, Math.round(input.height / 8) * 8);
  const steps = Math.max(1, Math.round(input.steps));
  const cfg = Math.max(0, input.cfg);
  const seed = Math.max(0, Math.floor(input.seed));
  const loraStack: LoraStackItem[] = normalizeLoraStack(input.loras?.length ? input.loras : input.lora ? [input.lora] : []);
  const loraStart = 10;
  const controlStart = loraStack.length > 0 ? loraStart + loraStack.length : 11;
  const ipAdapterStart = input.controlNet ? controlStart + 3 : loraStack.length > 1 ? 14 + loraStack.length - 1 : 14;
  let modelRef: [string, number] = ['1', 0];
  let clipRef: [string, number] = ['1', 1];
  const controlNetNodeType = input.controlNet?.nodeType ?? 'ControlNetApply';
  const conditioningRef: [string, number] = input.controlNet ? [String(controlStart + 2), 0] : ['2', 0];
  const negativeConditioningRef: [string, number] = input.controlNet ? [String(controlStart + 2), 1] : ['3', 0];
  const workflow: ComfyUiWorkflow = {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: input.checkpoint },
      _meta: { title: 'Aethera checkpoint' },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: input.positivePrompt, clip: clipRef },
      _meta: { title: 'Aethera positive prompt' },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: input.negativePrompt, clip: clipRef },
      _meta: { title: 'Aethera negative prompt' },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width, height, batch_size: 1 },
      _meta: { title: 'Aethera latent size' },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed,
        steps,
        cfg,
        sampler_name: input.samplerName,
        scheduler: input.scheduler,
        denoise: 1,
        model: modelRef,
        positive: conditioningRef,
        negative: negativeConditioningRef,
        latent_image: ['4', 0],
      },
      _meta: { title: 'Aethera sampler' },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
      _meta: { title: 'Aethera VAE decode' },
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: input.filenamePrefix, images: ['6', 0] },
      _meta: { title: 'Aethera output' },
    },
  };
  const positiveNode = workflow['2'];
  const negativeNode = workflow['3'];
  const samplerNode = workflow['5'];
  if (!positiveNode || !negativeNode || !samplerNode) throw new Error('Base ComfyUI workflow is incomplete.');
  for (const [index, lora] of loraStack.entries()) {
    const nodeId = String(loraStart + index);
    const nodeType = lora.nodeType ?? 'LoraLoader';
    workflow[nodeId] = {
      class_type: nodeType,
      inputs: nodeType === 'LoraLoader'
        ? {
            model: modelRef,
            clip: clipRef,
            lora_name: lora.model,
            strength_model: Math.max(-5, Math.min(5, lora.strengthModel ?? 1)),
            strength_clip: Math.max(-5, Math.min(5, lora.strengthClip ?? lora.strengthModel ?? 1)),
          }
        : {
            model: modelRef,
            lora_name: lora.model,
            strength_model: Math.max(-5, Math.min(5, lora.strengthModel ?? 1)),
          },
      _meta: { title: `Aethera LoRA ${index + 1}` },
    };
    modelRef = [nodeId, 0];
    if (nodeType === 'LoraLoader') clipRef = [nodeId, 1];
  }
  positiveNode.inputs['clip'] = clipRef;
  negativeNode.inputs['clip'] = clipRef;
  samplerNode.inputs['model'] = modelRef;
  if (input.controlNet) {
    const controlLoaderId = String(controlStart);
    const controlImageId = String(controlStart + 1);
    const controlApplyId = String(controlStart + 2);
    const imageName = input.controlNet.image.subfolder
      ? `${input.controlNet.image.subfolder}/${input.controlNet.image.filename}`
      : input.controlNet.image.filename;
    workflow[controlLoaderId] = {
      class_type: 'ControlNetLoader',
      inputs: { control_net_name: input.controlNet.model },
      _meta: { title: 'Aethera ControlNet model' },
    };
    workflow[controlImageId] = {
      class_type: 'LoadImage',
      inputs: { image: imageName },
      _meta: { title: 'Aethera ControlNet conditioning image' },
    };
    workflow[controlApplyId] = {
      class_type: controlNetNodeType,
      inputs: controlNetNodeType === 'ControlNetApplyAdvanced'
        ? {
            positive: ['2', 0],
            negative: ['3', 0],
            control_net: [controlLoaderId, 0],
            image: [controlImageId, 0],
            strength: Math.max(0, Math.min(5, input.controlNet.strength ?? 0.65)),
            start_percent: Math.max(0, Math.min(1, input.controlNet.startPercent ?? 0)),
            end_percent: Math.max(0, Math.min(1, input.controlNet.endPercent ?? 1)),
          }
        : {
            positive: ['2', 0],
            negative: ['3', 0],
            control_net: [controlLoaderId, 0],
            image: [controlImageId, 0],
            strength: Math.max(0, Math.min(5, input.controlNet.strength ?? 0.65)),
          },
      _meta: { title: 'Aethera ControlNet conditioning' },
    };
  }
  if (input.ipAdapter) {
    const ipModelId = String(ipAdapterStart);
    const ipVisionId = String(ipAdapterStart + 1);
    const ipImageId = String(ipAdapterStart + 2);
    const ipApplyId = String(ipAdapterStart + 3);
    const imageName = input.ipAdapter.image.subfolder
      ? `${input.ipAdapter.image.subfolder}/${input.ipAdapter.image.filename}`
      : input.ipAdapter.image.filename;
    const ipAdapterNodeType = input.ipAdapter.nodeType ?? 'IPAdapterAdvanced';
    workflow[ipModelId] = {
      class_type: 'IPAdapterModelLoader',
      inputs: { ipadapter_file: input.ipAdapter.model },
      _meta: { title: 'Aethera IP-Adapter model' },
    };
    workflow[ipVisionId] = {
      class_type: 'CLIPVisionLoader',
      inputs: { clip_name: input.ipAdapter.clipVisionModel },
      _meta: { title: 'Aethera IP-Adapter vision encoder' },
    };
    workflow[ipImageId] = {
      class_type: 'LoadImage',
      inputs: { image: imageName },
      _meta: { title: 'Aethera IP-Adapter reference image' },
    };
    workflow[ipApplyId] = {
      class_type: ipAdapterNodeType,
      inputs: ipAdapterNodeType === 'IPAdapterAdvanced'
        ? {
            model: modelRef,
            ipadapter: [ipModelId, 0],
            clip_vision: [ipVisionId, 0],
            image: [ipImageId, 0],
            weight: Math.max(-1, Math.min(5, input.ipAdapter.weight ?? 0.8)),
            weight_type: 'linear',
            combine_embeds: 'concat',
            start_at: 0,
            end_at: 1,
            embeds_scaling: 'V only',
          }
        : {
            model: modelRef,
            ipadapter: [ipModelId, 0],
            clip_vision: [ipVisionId, 0],
            image: [ipImageId, 0],
            weight: Math.max(-1, Math.min(5, input.ipAdapter.weight ?? 0.8)),
          },
      _meta: { title: 'Aethera IP-Adapter identity conditioning' },
    };
    samplerNode.inputs['model'] = [ipApplyId, 0];
  }
  if (input.regions?.length || input.maskedPrompts?.length) {
    applyRegionalConditioning(workflow, input.regions ?? [], input.maskedPrompts ?? [], clipRef, width, height);
  }
  return workflow;
}

export function buildComfyUiFaceDetailerWorkflow(input: ComfyUiTxt2ImgInput): ComfyUiWorkflow {
  if (!input.faceDetailer) throw new Error('FaceDetailer settings are required.');
  const { faceDetailer: _faceDetailer, ...baseInput } = input;
  void _faceDetailer;
  const workflow = buildComfyUiTxt2ImgWorkflow(baseInput);
  const sampler = workflow['5'];
  // With regional/masked conditioning the sampler's positive carries pixel areas and a pose guide that are meaningless
  // inside a face crop, so FaceDetailer refines with the scene prompt instead.
  const regional = Boolean(baseInput.regions?.length || baseInput.maskedPrompts?.length);
  const positive = regional ? ['2', 0] : sampler?.inputs['positive'];
  const negative = regional ? ['3', 0] : sampler?.inputs['negative'];
  const model = sampler?.inputs['model'];
  const clip = workflow['2']?.inputs['clip'];
  if (!sampler || !positive || !negative || !model || !clip) throw new Error('Base ComfyUI graph is incomplete for FaceDetailer.');
  workflow['20'] = {
    class_type: 'UltralyticsDetectorProvider',
    inputs: { model_name: input.faceDetailer.detectorModel },
    _meta: { title: 'Aethera face detector' },
  };
  workflow['21'] = {
    class_type: 'FaceDetailer',
    inputs: {
      image: ['6', 0],
      model,
      clip,
      vae: ['1', 2],
      guide_size: Math.max(64, input.faceDetailer.guideSize ?? 512),
      guide_size_for: true,
      max_size: Math.max(64, input.faceDetailer.maxSize ?? 1024),
      seed: Math.max(0, Math.floor(input.faceDetailer.seed ?? input.seed + 1)),
      steps: Math.max(1, Math.round(input.faceDetailer.steps ?? input.steps)),
      cfg: Math.max(0, input.faceDetailer.cfg ?? input.cfg),
      sampler_name: input.samplerName,
      scheduler: input.scheduler,
      positive,
      negative,
      denoise: Math.max(0.0001, Math.min(1, input.faceDetailer.denoise ?? 0.35)),
      feather: 5,
      noise_mask: true,
      force_inpaint: true,
      bbox_threshold: Math.max(0, Math.min(1, input.faceDetailer.bboxThreshold ?? 0.4)),
      bbox_dilation: Math.round(input.faceDetailer.bboxDilation ?? 10),
      bbox_crop_factor: Math.max(1, input.faceDetailer.bboxCropFactor ?? 3),
      sam_detection_hint: 'none',
      sam_dilation: 0,
      sam_threshold: 0.93,
      sam_bbox_expansion: 0,
      sam_mask_hint_threshold: 0.7,
      sam_mask_hint_use_negative: 'False',
      drop_size: 10,
      bbox_detector: ['20', 0],
      wildcard: '',
      cycle: 1,
    },
    _meta: { title: 'Aethera FaceDetailer' },
  };
  workflow['22'] = {
    class_type: 'SaveImage',
    inputs: { filename_prefix: input.filenamePrefix, images: ['21', 0] },
    _meta: { title: 'Aethera FaceDetailer output' },
  };
  return workflow;
}

export function buildComfyUiImg2ImgWorkflow(input: ComfyUiImg2ImgInput): ComfyUiWorkflow {
  const width = Math.max(64, Math.round(input.width / 8) * 8);
  const height = Math.max(64, Math.round(input.height / 8) * 8);
  const imageName = input.inputImage.subfolder ? `${input.inputImage.subfolder}/${input.inputImage.filename}` : input.inputImage.filename;
  const base = buildComfyUiTxt2ImgWorkflow({ ...input, width, height });
  const node = (id: string): ComfyUiWorkflowNode => {
    const value = base[id];
    if (!value) throw new Error(`Base ComfyUI workflow is missing node ${id}.`);
    return value;
  };
  const passthrough = Object.fromEntries(
    Object.entries(base).filter(([id]) => !new Set(['1', '2', '3', '4', '5', '6', '7']).has(id)),
  );
  return {
    '1': node('1'),
    '2': node('2'),
    '3': node('3'),
    ...passthrough,
    '4': { class_type: 'LoadImage', inputs: { image: imageName }, _meta: { title: 'Aethera reference image' } },
    '5': { class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['1', 2] }, _meta: { title: 'Aethera reference encode' } },
    '6': {
      ...node('5'),
      inputs: { ...node('5').inputs, denoise: Math.min(1, Math.max(0.01, input.denoise)), latent_image: ['5', 0] },
    },
    '7': { ...node('6'), inputs: { samples: ['6', 0], vae: ['1', 2] } },
    '8': { ...node('7'), inputs: { filename_prefix: input.filenamePrefix, images: ['7', 0] } },
  };
}

function applyRegionalConditioning(
  workflow: ComfyUiWorkflow,
  regions: ComfyUiRegionalPrompt[],
  maskedPrompts: ComfyUiMaskedPrompt[],
  clipRef: [string, number],
  width: number,
  height: number,
): void {
  let positiveRef: [string, number] = ['2', 0];
  const regionNodeIds = new Set<string>();
  for (const [index, masked] of maskedPrompts.slice(0, 4).entries()) {
    const prefix = `masked_${index + 1}`;
    const maskName = masked.mask.subfolder ? `${masked.mask.subfolder}/${masked.mask.filename}` : masked.mask.filename;
    workflow[`${prefix}_image`] = { class_type: 'LoadImage', inputs: { image: maskName }, _meta: { title: `Aethera masked prompt ${index + 1} mask` } };
    workflow[`${prefix}_mask`] = { class_type: 'ImageToMask', inputs: { image: [`${prefix}_image`, 0], channel: 'red' }, _meta: { title: `Aethera masked prompt ${index + 1} channel` } };
    workflow[`${prefix}_text`] = { class_type: 'CLIPTextEncode', inputs: { text: masked.prompt, clip: clipRef }, _meta: { title: `Aethera masked prompt ${index + 1}` } };
    workflow[`${prefix}_set`] = {
      class_type: 'ConditioningSetMask',
      inputs: { conditioning: [`${prefix}_text`, 0], mask: [`${prefix}_mask`, 0], strength: Math.max(0, Math.min(10, masked.strength)), set_cond_area: 'default' },
      _meta: { title: `Aethera masked prompt ${index + 1} area` },
    };
    workflow[`${prefix}_combine`] = { class_type: 'ConditioningCombine', inputs: { conditioning_1: positiveRef, conditioning_2: [`${prefix}_set`, 0] }, _meta: { title: `Aethera masked prompt ${index + 1} combine` } };
    for (const suffix of ['image', 'mask', 'text', 'set', 'combine']) regionNodeIds.add(`${prefix}_${suffix}`);
    positiveRef = [`${prefix}_combine`, 0];
  }
  for (const [index, region] of regions.slice(0, 8).entries()) {
    const x = Math.max(0, Math.min(width - 64, Math.floor(region.x / 8) * 8));
    const y = Math.max(0, Math.min(height - 64, Math.floor(region.y / 8) * 8));
    const regionWidth = Math.max(64, Math.min(width - x, Math.round(region.width / 8) * 8));
    const regionHeight = Math.max(64, Math.min(height - y, Math.round(region.height / 8) * 8));
    const textId = `region_${index + 1}_text`;
    const areaId = `region_${index + 1}_area`;
    const combineId = `region_${index + 1}_combine`;
    workflow[textId] = { class_type: 'CLIPTextEncode', inputs: { text: region.prompt, clip: clipRef }, _meta: { title: `Aethera region ${index + 1} prompt` } };
    workflow[areaId] = {
      class_type: 'ConditioningSetArea',
      inputs: { conditioning: [textId, 0], x, y, width: regionWidth, height: regionHeight, strength: Math.max(0, Math.min(10, region.strength ?? 0.8)) },
      _meta: { title: `Aethera region ${index + 1} area` },
    };
    workflow[combineId] = { class_type: 'ConditioningCombine', inputs: { conditioning_1: positiveRef, conditioning_2: [areaId, 0] }, _meta: { title: `Aethera region ${index + 1} combine` } };
    for (const id of [textId, areaId, combineId]) regionNodeIds.add(id);
    positiveRef = [combineId, 0];
  }
  // Only the main sampling chain receives the area conditioning. Crop-based refiners such as FaceDetailer keep the
  // global prompt, because pixel areas are meaningless inside a face crop.
  const consumers = new Set(['KSampler', 'ControlNetApply', 'ControlNetApplyAdvanced']);
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (regionNodeIds.has(nodeId) || !consumers.has(node.class_type)) continue;
    for (const [name, value] of Object.entries(node.inputs)) {
      if (Array.isArray(value) && value[0] === '2' && value[1] === 0) node.inputs[name] = positiveRef;
    }
  }
}

/**
 * Native ComfyUI localized repair graph. The mask is deliberately supplied as a separate LoadImage node so the
 * caller can audit exactly which pixels are allowed to change. This keeps localized repairs portable without
 * requiring Impact Pack or another custom-node bundle.
 */
export function buildComfyUiInpaintWorkflow(input: ComfyUiInpaintInput): ComfyUiWorkflow {
  const width = Math.max(64, Math.round(input.width / 8) * 8);
  const height = Math.max(64, Math.round(input.height / 8) * 8);
  const base = buildComfyUiTxt2ImgWorkflow({ ...input, width, height });
  const imageName = input.image.subfolder ? `${input.image.subfolder}/${input.image.filename}` : input.image.filename;
  const maskName = input.mask.subfolder ? `${input.mask.subfolder}/${input.mask.filename}` : input.mask.filename;
  const node = (id: string): ComfyUiWorkflowNode => {
    const value = base[id];
    if (!value) throw new Error(`Base ComfyUI workflow is missing node ${id}.`);
    return value;
  };
  const passthrough = Object.fromEntries(
    Object.entries(base).filter(([id]) => !new Set(['1', '2', '3', '4', '5', '6', '7']).has(id)),
  );
  return {
    '1': node('1'),
    '2': node('2'),
    '3': node('3'),
    ...passthrough,
    '4': { class_type: 'LoadImage', inputs: { image: imageName }, _meta: { title: 'Aethera inpaint base image' } },
    '5': { class_type: 'LoadImage', inputs: { image: maskName }, _meta: { title: 'Aethera localized repair mask' } },
    // LoadImage output 0 is IMAGE; VAEEncodeForInpaint requires MASK. The mask PNG is opaque black/white, so the red
    // channel carries the editable area (its alpha output would be empty).
    inpaint_mask: { class_type: 'ImageToMask', inputs: { image: ['5', 0], channel: 'red' }, _meta: { title: 'Aethera localized repair mask channel' } },
    // VAEEncodeForInpaint blanks the masked pixels and is meant for inpaint checkpoints at denoise 1.0; with regular
    // SDXL checkpoints it produced grey hard-edged boxes. VAEEncode + SetLatentNoiseMask keeps the original pixels as
    // context so a partial denoise blends the repair into the scene.
    inpaint_encode: { class_type: 'VAEEncode', inputs: { pixels: ['4', 0], vae: ['1', 2] }, _meta: { title: 'Aethera localized repair encode' } },
    ...(input.growMaskBy > 0
      ? { inpaint_grow: { class_type: 'GrowMask', inputs: { mask: ['inpaint_mask', 0], expand: Math.round(input.growMaskBy), tapered_corners: true }, _meta: { title: 'Aethera localized repair mask grow' } } }
      : {}),
    '6': {
      class_type: 'SetLatentNoiseMask',
      inputs: { samples: ['inpaint_encode', 0], mask: [input.growMaskBy > 0 ? 'inpaint_grow' : 'inpaint_mask', 0] },
      _meta: { title: 'Aethera localized repair noise mask' },
    },
    '7': {
      ...node('5'),
      inputs: {
        ...node('5').inputs,
        denoise: Math.min(1, Math.max(0.01, input.denoise)),
        latent_image: ['6', 0],
      },
      _meta: { title: 'Aethera localized repair sampler' },
    },
    '8': { ...node('6'), inputs: { samples: ['7', 0], vae: ['1', 2] }, _meta: { title: 'Aethera localized repair decode' } },
    '9': { ...node('7'), inputs: { filename_prefix: input.filenamePrefix, images: ['8', 0] }, _meta: { title: 'Aethera localized repair output' } },
  };
}

export interface ComfyUiDepthInput {
  inputImage: ComfyUiImageRef;
  /** Preprocessor node reported by /object_info (comfyui_controlnet_aux). */
  preprocessor: 'DepthAnythingV2Preprocessor' | 'DepthAnythingPreprocessor' | 'MiDaS-DepthMapPreprocessor';
  resolution: number;
  filenamePrefix: string;
}

/** Depth estimation graph used to build depth ControlNet maps for localized object repairs. */
export function buildComfyUiDepthWorkflow(input: ComfyUiDepthInput): ComfyUiWorkflow {
  const imageName = input.inputImage.subfolder ? `${input.inputImage.subfolder}/${input.inputImage.filename}` : input.inputImage.filename;
  return {
    '1': { class_type: 'LoadImage', inputs: { image: imageName }, _meta: { title: 'Aethera depth input' } },
    '2': { class_type: input.preprocessor, inputs: { image: ['1', 0], resolution: Math.max(64, Math.round(input.resolution / 64) * 64) }, _meta: { title: 'Aethera depth estimate' } },
    '3': { class_type: 'SaveImage', inputs: { filename_prefix: input.filenamePrefix, images: ['2', 0] }, _meta: { title: 'Aethera depth output' } },
  };
}

/** Native model-based upscale graph. It intentionally does not require a checkpoint or custom nodes. */
export function buildComfyUiUpscaleWorkflow(input: ComfyUiUpscaleInput): ComfyUiWorkflow {
  const imageName = input.inputImage.subfolder ? `${input.inputImage.subfolder}/${input.inputImage.filename}` : input.inputImage.filename;
  return {
    '1': { class_type: 'UpscaleModelLoader', inputs: { model_name: input.model }, _meta: { title: 'Aethera upscale model' } },
    '2': { class_type: 'LoadImage', inputs: { image: imageName }, _meta: { title: 'Aethera upscale input' } },
    '3': { class_type: 'ImageUpscaleWithModel', inputs: { upscale_model: ['1', 0], image: ['2', 0] }, _meta: { title: 'Aethera model upscale' } },
    '4': { class_type: 'SaveImage', inputs: { filename_prefix: input.filenamePrefix, images: ['3', 0] }, _meta: { title: 'Aethera upscale output' } },
  };
}

function checkpointNames(objectInfo: Record<string, unknown>): string[] {
  const loader = objectInfo['CheckpointLoaderSimple'];
  if (!loader || typeof loader !== 'object') return [];
  const input = (loader as Record<string, unknown>)['input'];
  if (!input || typeof input !== 'object') return [];
  const required = (input as Record<string, unknown>)['required'];
  if (!required || typeof required !== 'object') return [];
  const values = (required as Record<string, unknown>)['ckpt_name'];
  if (!Array.isArray(values) || !Array.isArray(values[0])) return [];
  return values[0].filter((value): value is string => typeof value === 'string');
}

export function controlNetNames(objectInfo: Record<string, unknown>): string[] {
  const loader = objectInfo['ControlNetLoader'];
  if (!loader || typeof loader !== 'object') return [];
  const input = (loader as Record<string, unknown>)['input'];
  const required = input && typeof input === 'object' ? (input as Record<string, unknown>)['required'] : undefined;
  const values = required && typeof required === 'object' ? (required as Record<string, unknown>)['control_net_name'] : undefined;
  if (!Array.isArray(values) || !Array.isArray(values[0])) return [];
  return values[0].filter((value): value is string => typeof value === 'string');
}

function detectorNames(objectInfo: Record<string, unknown>): string[] {
  return modelNamesFromNode(objectInfo, 'UltralyticsDetectorProvider', 'model_name');
}

function modelNamesFromNode(objectInfo: Record<string, unknown>, nodeType: string, field: string): string[] {
  const loader = objectInfo[nodeType];
  if (!loader || typeof loader !== 'object') return [];
  const input = (loader as Record<string, unknown>)['input'];
  const required = input && typeof input === 'object' ? (input as Record<string, unknown>)['required'] : undefined;
  const values = required && typeof required === 'object' ? (required as Record<string, unknown>)[field] : undefined;
  if (!Array.isArray(values) || !Array.isArray(values[0])) return [];
  return values[0].filter((value): value is string => typeof value === 'string');
}

function loraNames(objectInfo: Record<string, unknown>): string[] {
  for (const nodeType of ['LoraLoader', 'LoraLoaderModelOnly']) {
    const loader = objectInfo[nodeType];
    if (!loader || typeof loader !== 'object') continue;
    const input = (loader as Record<string, unknown>)['input'];
    const required = input && typeof input === 'object' ? (input as Record<string, unknown>)['required'] : undefined;
    const values = required && typeof required === 'object' ? (required as Record<string, unknown>)['lora_name'] : undefined;
    if (Array.isArray(values) && Array.isArray(values[0])) return values[0].filter((value): value is string => typeof value === 'string');
  }
  return [];
}

function referencedNodeIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    if (value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'number') return [value[0]];
    return value.flatMap((item) => referencedNodeIds(item));
  }
  if (value && typeof value === 'object') return Object.values(value).flatMap((item) => referencedNodeIds(item));
  return [];
}

export function validateComfyUiWorkflow(workflow: ComfyUiWorkflow, objectInfo: Record<string, unknown>): ComfyUiWorkflowValidation {
  const errors: string[] = [];
  const requiredNodeTypes = new Set<string>();
  if (workflow['1']?.class_type === 'CheckpointLoaderSimple') {
    for (const nodeType of ['CheckpointLoaderSimple', 'CLIPTextEncode', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage']) requiredNodeTypes.add(nodeType);
  }
  for (const node of Object.values(workflow)) requiredNodeTypes.add(node.class_type);
  const availableTypes = new Set(Object.keys(objectInfo));
  for (const nodeType of requiredNodeTypes) {
    if (!availableTypes.has(nodeType)) errors.push(`ComfyUI does not expose required node "${nodeType}".`);
  }
  const checkpoint = workflow['1']?.class_type === 'CheckpointLoaderSimple' ? workflow['1'].inputs['ckpt_name'] : undefined;
  if (typeof checkpoint === 'string' && availableTypes.has('CheckpointLoaderSimple')) {
    const installed = checkpointNames(objectInfo);
    if (installed.length > 0 && !installed.includes(checkpoint)) {
      errors.push(`Checkpoint "${checkpoint}" is not reported by ComfyUI as installed.`);
    }
    if (installed.length === 0) {
      errors.push('ComfyUI reports no checkpoint models for CheckpointLoaderSimple.');
    }
  }
  for (const node of Object.values(workflow)) {
    if (!node.class_type.startsWith('LoraLoader') || typeof node.inputs['lora_name'] !== 'string') continue;
    if (!availableTypes.has(node.class_type)) continue;
    const installed = loraNames(objectInfo);
    if (installed.length > 0 && !installed.includes(node.inputs['lora_name'])) {
      errors.push(`LoRA "${node.inputs['lora_name']}" is not reported by ComfyUI as installed.`);
    }
    if (installed.length === 0) errors.push('ComfyUI reports no LoRA models for the selected loader.');
  }
  for (const node of Object.values(workflow)) {
    if (node.class_type !== 'UltralyticsDetectorProvider' || typeof node.inputs['model_name'] !== 'string') continue;
    if (!availableTypes.has(node.class_type)) continue;
    const installed = detectorNames(objectInfo);
    if (installed.length > 0 && !installed.includes(node.inputs['model_name'])) {
      errors.push(`Face detector "${node.inputs['model_name']}" is not reported by ComfyUI as installed.`);
    }
    if (installed.length === 0) errors.push('ComfyUI reports no face detector models for UltralyticsDetectorProvider.');
  }
  for (const node of Object.values(workflow)) {
    if (node.class_type === 'IPAdapterModelLoader' && typeof node.inputs['ipadapter_file'] === 'string') {
      if (!availableTypes.has(node.class_type)) continue;
      const installed = modelNamesFromNode(objectInfo, node.class_type, 'ipadapter_file');
      if (installed.length > 0 && !installed.includes(node.inputs['ipadapter_file'])) {
        errors.push(`IP-Adapter "${node.inputs['ipadapter_file']}" is not reported by ComfyUI as installed.`);
      }
      if (installed.length === 0) errors.push('ComfyUI reports no IP-Adapter models for IPAdapterModelLoader.');
    }
    if (node.class_type === 'CLIPVisionLoader' && typeof node.inputs['clip_name'] === 'string') {
      if (!availableTypes.has(node.class_type)) continue;
      const installed = modelNamesFromNode(objectInfo, node.class_type, 'clip_name');
      if (installed.length > 0 && !installed.includes(node.inputs['clip_name'])) {
        errors.push(`CLIP Vision "${node.inputs['clip_name']}" is not reported by ComfyUI as installed.`);
      }
      if (installed.length === 0) errors.push('ComfyUI reports no CLIP Vision models for CLIPVisionLoader.');
    }
  }
  for (const node of Object.values(workflow)) {
    if (node.class_type !== 'ControlNetLoader' || typeof node.inputs['control_net_name'] !== 'string') continue;
    if (!availableTypes.has('ControlNetLoader')) continue;
    const installed = controlNetNames(objectInfo);
    if (installed.length > 0 && !installed.includes(node.inputs['control_net_name'])) {
      errors.push(`ControlNet "${node.inputs['control_net_name']}" is not reported by ComfyUI as installed.`);
    }
    if (installed.length === 0) errors.push('ComfyUI reports no ControlNet models for ControlNetLoader.');
  }
  errors.push(...linkTypeErrors(workflow, objectInfo));
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!node.class_type || !node.inputs) errors.push(`Workflow node ${nodeId} is missing class_type or inputs.`);
    for (const value of Object.values(node.inputs ?? {})) {
      for (const referencedId of referencedNodeIds(value)) {
        if (!workflow[referencedId]) errors.push(`Workflow node ${nodeId} references missing node ${referencedId}.`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

interface ObjectInfoNode {
  input?: { required?: Record<string, unknown>; optional?: Record<string, unknown> };
  output?: unknown[];
}

function declaredInputType(info: ObjectInfoNode | undefined, name: string): string | undefined {
  const spec = info?.input?.required?.[name] ?? info?.input?.optional?.[name];
  const type = Array.isArray(spec) ? spec[0] : undefined;
  return typeof type === 'string' ? type : undefined;
}

/**
 * Checks each link against the live `/object_info` signatures, so a graph that ComfyUI would reject with
 * "Return type mismatch between linked nodes" fails locally with a clear message instead of an opaque HTTP 400.
 * Wildcards, combo lists and node types without a reported signature are skipped.
 */
function linkTypeErrors(workflow: ComfyUiWorkflow, objectInfo: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const [nodeId, node] of Object.entries(workflow)) {
    const info = objectInfo[node.class_type] as ObjectInfoNode | undefined;
    for (const [name, value] of Object.entries(node.inputs ?? {})) {
      if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || typeof value[1] !== 'number') continue;
      const source = workflow[value[0]];
      if (!source) continue;
      const expected = declaredInputType(info, name);
      const sourceInfo = objectInfo[source.class_type] as ObjectInfoNode | undefined;
      const produced = Array.isArray(sourceInfo?.output) ? sourceInfo.output[value[1]] : undefined;
      if (typeof expected !== 'string' || typeof produced !== 'string') continue;
      if (expected === '*' || produced === '*' || expected === 'COMBO') continue;
      const accepted = expected.split(',').map((type) => type.trim());
      if (!accepted.includes(produced)) {
        errors.push(`Workflow node ${nodeId} (${node.class_type}) input "${name}" expects ${expected} but node ${value[0]} (${source.class_type}) output ${value[1]} is ${produced}.`);
      }
    }
  }
  return errors;
}

export function extractComfyUiImages(history: ComfyUiHistoryEntry): ComfyUiImageRef[] {
  const images: ComfyUiImageRef[] = [];
  for (const output of Object.values(history.outputs ?? {})) {
    if (!output || typeof output !== 'object') continue;
    const candidates = (output as Record<string, unknown>)['images'];
    if (!Array.isArray(candidates)) continue;
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object') continue;
      const record = candidate as Record<string, unknown>;
      if (typeof record['filename'] !== 'string' || record['type'] !== 'output') continue;
      images.push({
        filename: record['filename'],
        ...(typeof record['subfolder'] === 'string' ? { subfolder: record['subfolder'] } : {}),
        type: 'output',
      });
    }
  }
  return images;
}
