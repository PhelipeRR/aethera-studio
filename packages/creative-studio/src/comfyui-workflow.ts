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
}

export interface ComfyUiWorkflowValidation {
  ok: boolean;
  errors: string[];
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
  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: input.checkpoint },
      _meta: { title: 'Aethera checkpoint' },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: input.positivePrompt, clip: ['1', 1] },
      _meta: { title: 'Aethera positive prompt' },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: input.negativePrompt, clip: ['1', 1] },
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
        model: ['1', 0],
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

export function validateComfyUiWorkflow(workflow: ComfyUiWorkflow, objectInfo: Record<string, unknown>): ComfyUiWorkflowValidation {
  const errors: string[] = [];
  const requiredNodeTypes = ['CheckpointLoaderSimple', 'CLIPTextEncode', 'EmptyLatentImage', 'KSampler', 'VAEDecode', 'SaveImage'];
  const availableTypes = new Set(Object.keys(objectInfo));
  for (const nodeType of requiredNodeTypes) {
    if (!availableTypes.has(nodeType)) errors.push(`ComfyUI does not expose required node "${nodeType}".`);
  }
  const checkpoint = workflow['1']?.inputs['ckpt_name'];
  if (typeof checkpoint === 'string' && availableTypes.has('CheckpointLoaderSimple')) {
    const installed = checkpointNames(objectInfo);
    if (installed.length > 0 && !installed.includes(checkpoint)) {
      errors.push(`Checkpoint "${checkpoint}" is not reported by ComfyUI as installed.`);
    }
    if (installed.length === 0) {
      errors.push('ComfyUI reports no checkpoint models for CheckpointLoaderSimple.');
    }
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
