import type { ComfyUiHistoryEntry, ComfyUiImageRef } from './comfyui-client.js';

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
  const loraNodeType = input.lora?.nodeType ?? 'LoraLoader';
  const modelRef: [string, number] = input.lora ? ['10', 0] : ['1', 0];
  const clipRef: [string, number] = input.lora && loraNodeType === 'LoraLoader' ? ['10', 1] : ['1', 1];
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
        positive: ['2', 0],
        negative: ['3', 0],
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
  if (input.lora) {
    workflow['10'] = {
      class_type: loraNodeType,
      inputs: loraNodeType === 'LoraLoader'
        ? {
            model: ['1', 0],
            clip: ['1', 1],
            lora_name: input.lora.model,
            strength_model: Math.max(-5, Math.min(5, input.lora.strengthModel ?? 1)),
            strength_clip: Math.max(-5, Math.min(5, input.lora.strengthClip ?? input.lora.strengthModel ?? 1)),
          }
        : {
            model: ['1', 0],
            lora_name: input.lora.model,
            strength_model: Math.max(-5, Math.min(5, input.lora.strengthModel ?? 1)),
          },
      _meta: { title: 'Aethera LoRA' },
    };
  }
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
  return {
    '1': node('1'),
    '2': node('2'),
    '3': node('3'),
    ...(base['10'] ? { '10': base['10'] } : {}),
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
  return {
    '1': node('1'),
    '2': node('2'),
    '3': node('3'),
    ...(base['10'] ? { '10': base['10'] } : {}),
    '4': { class_type: 'LoadImage', inputs: { image: imageName }, _meta: { title: 'Aethera inpaint base image' } },
    '5': { class_type: 'LoadImage', inputs: { image: maskName }, _meta: { title: 'Aethera localized repair mask' } },
    '6': {
      class_type: 'VAEEncodeForInpaint',
      inputs: {
        pixels: ['4', 0],
        vae: ['1', 2],
        mask: ['5', 0],
        grow_mask_by: Math.max(0, Math.round(input.growMaskBy)),
      },
      _meta: { title: 'Aethera localized repair encode' },
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
  for (const [nodeId, node] of Object.entries(workflow)) {
    if (!node.class_type || !node.inputs) errors.push(`Workflow node ${nodeId} is missing class_type or inputs.`);
  }
  return { ok: errors.length === 0, errors };
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
