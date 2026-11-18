import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import sharp from 'sharp';
import { ComfyUiClient, type ComfyUiHistoryEntry, type ComfyUiImageRef, type ComfyUiSystemStats } from './comfyui-client.js';
import {
  buildComfyUiDepthWorkflow,
  buildComfyUiInpaintWorkflow,
  buildComfyUiUpscaleWorkflow,
  extractComfyUiImages,
  buildComfyUiImg2ImgWorkflow,
  buildComfyUiTxt2ImgWorkflow,
  buildComfyUiFaceDetailerWorkflow,
  validateComfyUiWorkflow,
  type ComfyUiWorkflow,
  type ComfyUiControlNetInput,
  type ComfyUiIpAdapterInput,
  type ComfyUiRegionalPrompt,
  type ComfyUiMaskedPrompt,
  controlNetNames,
} from './comfyui-workflow.js';
import { figureBox, renderOpenPoseGuide, renderZoneMask } from './spatial-guides.js';
import type {
  DepthEstimationRequest,
  ExternalImageAdapter,
  ImageUpscaleRequest,
  ImageGenerationRequest,
  LocalizedInpaintRequest,
} from './image-generation-adapter.js';
import { GpuGenerationLease } from './gpu-generation-lease.js';

/** Depth preprocessors of comfyui_controlnet_aux, best first. */
const DEPTH_PREPROCESSORS = ['DepthAnythingV2Preprocessor', 'DepthAnythingPreprocessor', 'MiDaS-DepthMapPreprocessor'] as const;
import { applyCheckpointProfile, resolveCheckpointProfile, type AppliedCheckpointProfile } from './checkpoint-profiles.js';

export interface ComfyUiGateway {
  getSystemStats(): Promise<ComfyUiSystemStats>;
  getObjectInfo(): Promise<Record<string, unknown>>;
  queuePrompt(prompt: Record<string, unknown>): Promise<{ prompt_id: string }>;
  waitForCompletion(promptId: string, options?: { pollMs?: number; timeoutMs?: number }): Promise<ComfyUiHistoryEntry>;
  getImage(image: ComfyUiImageRef): Promise<Buffer>;
  interrupt?(): Promise<void>;
  uploadImage?(buffer: Buffer, filename: string, subfolder?: string, overwrite?: boolean): Promise<{ name: string; subfolder: string; type: 'input' | 'output' | 'temp' }>;
  freeMemory?(unloadModels?: boolean): Promise<void>;
}

export interface ComfyUiImageAdapterOptions {
  endpoint?: string;
  gateway?: ComfyUiGateway;
  checkpoint?: string;
  steps?: number;
  cfg?: number;
  samplerName?: string;
  scheduler?: string;
  requestTimeoutMs?: number;
  timeoutMs?: number;
  releaseMemoryAfterGeneration?: boolean;
  filenamePrefix?: string;
}

const DEFAULT_COMFYUI_ENDPOINT = 'http://127.0.0.1:8000';

function safeFilenamePrefix(value: string): string {
  return value.replace(/[^A-Za-z0-9_./-]+/g, '-').replace(/^[/.-]+|[/.-]+$/g, '') || 'Aethera/creative';
}

export interface ComfyUiGenerationMetadata {
  checkpoint: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  samplerName: string;
  scheduler: string;
  checkpointProfile: Pick<AppliedCheckpointProfile, 'family' | 'evidence' | 'adjustments'>;
  regionalComposition: boolean;
  regionCount: number;
  /** How the character count was enforced: OpenPose skeletons (hard) or area prompts only (soft bias). */
  spatialControl: { mode: 'openpose'; model: string; strength: number; endPercent: number } | { mode: 'area_only'; reason: string } | { mode: 'not_applicable' };
  maskedPrompts: Array<{ purpose: 'scene_background' | 'calm_zone'; strength: number }>;
  /** True when the returned image is the FaceDetailer output (node 22). */
  faceDetailer: boolean;
}

export class ComfyUiImageAdapter implements ExternalImageAdapter {
  readonly id = 'comfyui-native';
  gateway: ComfyUiGateway;
  checkpoint: string;
  private readonly steps: number;
  private readonly cfg: number;
  private readonly samplerName: string;
  private readonly scheduler: string;
  private readonly timeoutMs: number;
  private releaseMemoryAfterGeneration: boolean;
  private readonly filenamePrefix: string;
  private readonly nativeGateway: boolean;
  private readonly requestTimeoutMs: number | undefined;
  private endpoint: string | undefined;
  private readonly gpuLease = new GpuGenerationLease();
  private activePromptId: string | null = null;
  private availabilityError: string | null = null;
  private lastGeneration: ComfyUiGenerationMetadata | null = null;
  private lastUnrefinedImage: Buffer | null = null;

  constructor(options?: ComfyUiImageAdapterOptions) {
    this.requestTimeoutMs = options?.requestTimeoutMs;
    if (options?.gateway) {
      this.gateway = options.gateway;
      this.nativeGateway = false;
    } else {
      this.nativeGateway = true;
      this.endpoint = options?.endpoint ?? DEFAULT_COMFYUI_ENDPOINT;
      this.gateway = this.createNativeGateway(this.endpoint);
    }
    this.checkpoint = options?.checkpoint ?? 'sd_xl_base_1.0.safetensors';
    this.steps = options?.steps ?? 8;
    this.cfg = options?.cfg ?? 5.5;
    this.samplerName = options?.samplerName ?? 'euler';
    this.scheduler = options?.scheduler ?? 'normal';
    this.timeoutMs = options?.timeoutMs ?? 10 * 60_000;
    this.releaseMemoryAfterGeneration = options?.releaseMemoryAfterGeneration ?? false;
    this.filenamePrefix = safeFilenamePrefix(options?.filenamePrefix ?? 'Aethera/creative');
  }

  getEndpoint(): string | undefined {
    return this.endpoint;
  }

  setEndpoint(endpoint: string): void {
    if (!this.nativeGateway) throw new Error('Cannot retarget a ComfyUI adapter backed by a custom gateway.');
    const gateway = this.createNativeGateway(endpoint);
    this.gateway = gateway;
    this.endpoint = gateway.baseUrl;
    this.availabilityError = null;
  }

  private createNativeGateway(endpoint: string): ComfyUiClient {
    return new ComfyUiClient({
      baseUrl: endpoint,
      ...(this.requestTimeoutMs !== undefined ? { requestTimeoutMs: this.requestTimeoutMs } : {}),
    });
  }

  async isAvailable(): Promise<boolean> {
    try {
      const objectInfo = await this.gateway.getObjectInfo();
      const validation = validateComfyUiWorkflow(this.workflowFor({ prompt: 'availability probe', width: 512, height: 512 }), objectInfo);
      this.availabilityError = validation.ok ? null : validation.errors.join(' ');
      return validation.ok;
    } catch (error) {
      this.availabilityError = error instanceof Error ? error.message : String(error);
      return false;
    }
  }

  /**
   * Unrefined base image of the last FaceDetailer generation. It comes from the same graph execution as the refined
   * result (same seed, same noise), so it is the exact "basic" counterpart for a basic-versus-refined comparison.
   */
  /** OpenPose ControlNet reported by ComfyUI, or null (used by the layered composition strategy). */
  async findPoseControlNet(): Promise<string | null> {
    return controlNetNames(await this.gateway.getObjectInfo()).find((name) => /openpose/i.test(name)) ?? null;
  }

  /** Depth ControlNet reported by ComfyUI, or null when it or a depth preprocessor is missing (object ControlNet repair). */
  async findDepthControlNet(): Promise<string | null> {
    const objectInfo = await this.gateway.getObjectInfo();
    if (!DEPTH_PREPROCESSORS.some((node) => Object.prototype.hasOwnProperty.call(objectInfo, node))) return null;
    return controlNetNames(objectInfo).find((name) => /depth/i.test(name)) ?? null;
  }

  getLastUnrefinedImage(): Buffer | null {
    return this.lastUnrefinedImage;
  }

  /** Effective parameters of the last successful native generation (after checkpoint profile adjustments). */
  getLastGenerationMetadata(): ComfyUiGenerationMetadata | null {
    return this.lastGeneration;
  }

  getAvailabilityError(): string | null {
    return this.availabilityError;
  }

  setCheckpoint(checkpoint: string): void {
    if (!checkpoint.trim()) throw new Error('ComfyUI checkpoint cannot be empty.');
    this.checkpoint = checkpoint.trim();
    this.availabilityError = null;
  }

  /**
   * Runs a batch of generations without unloading models between them, then restores the setting and releases memory
   * once (the layered composition otherwise paid a ~20 s reload per character on the 8 GB card).
   */
  async withModelsHeld<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.releaseMemoryAfterGeneration;
    this.releaseMemoryAfterGeneration = false;
    try {
      return await work();
    } finally {
      this.releaseMemoryAfterGeneration = previous;
      if (previous) await this.releaseMemory().catch(() => false);
    }
  }

  setReleaseMemoryAfterGeneration(enabled: boolean): void {
    this.releaseMemoryAfterGeneration = enabled;
  }

  async generateImage(request: ImageGenerationRequest): Promise<Buffer> {
    return this.gpuLease.run(() => this.generateImageInternal(request));
  }

  async releaseMemory(): Promise<boolean> {
    if (!this.gateway.freeMemory) return false;
    await this.gateway.freeMemory(true);
    return true;
  }

  async inpaintRegion(request: LocalizedInpaintRequest): Promise<Buffer> {
    return this.gpuLease.run(() => this.inpaintRegionInternal(request));
  }

  async upscaleImage(request: ImageUpscaleRequest): Promise<Buffer> {
    return this.gpuLease.run(() => this.upscaleImageInternal(request));
  }

  async estimateDepth(request: DepthEstimationRequest): Promise<Buffer> {
    return this.gpuLease.run(() => this.estimateDepthInternal(request));
  }

  private async estimateDepthInternal(request: DepthEstimationRequest): Promise<Buffer> {
    if (!this.gateway.uploadImage) throw new Error('ComfyUI gateway does not support depth image upload.');
    const metadata = await sharp(request.imageBuffer).metadata();
    if (!metadata.width || !metadata.height) throw new Error('Depth estimation requires a decodable raster image.');
    const objectInfo = await this.gateway.getObjectInfo();
    const preprocessor = DEPTH_PREPROCESSORS.find((node) => Object.prototype.hasOwnProperty.call(objectInfo, node));
    if (!preprocessor) throw new Error('ComfyUI has no depth preprocessor (comfyui_controlnet_aux).');
    const uploaded = await this.gateway.uploadImage(request.imageBuffer, 'aethera-depth-input.png', 'aethera', true);
    const workflow = buildComfyUiDepthWorkflow({
      inputImage: { filename: uploaded.name, ...(uploaded.subfolder ? { subfolder: uploaded.subfolder } : {}), type: uploaded.type },
      preprocessor,
      resolution: Math.min(1024, Math.max(metadata.width, metadata.height)),
      filenamePrefix: `${this.filenamePrefix}/depth`,
    });
    const depth = await this.runWorkflow(workflow);
    return sharp(depth).resize(metadata.width, metadata.height, { fit: 'fill' }).png().toBuffer();
  }

  private async generateImageInternal(request: ImageGenerationRequest): Promise<Buffer> {
    const objectInfo = await this.gateway.getObjectInfo();
    const referencePath = request.referenceImagePaths?.[0];
    const uploadedReference = referencePath ? await this.uploadReference(referencePath) : null;
    const ipReferencePath = request.ipAdapter?.referenceImagePath ?? referencePath;
    if (request.ipAdapter && !ipReferencePath) throw new Error('IP-Adapter requires a local reference image path.');
    const uploadedIpReference = ipReferencePath
      ? ipReferencePath === referencePath && uploadedReference
        ? uploadedReference
        : await this.uploadReference(ipReferencePath)
      : null;
    const uploadedControlNet = request.controlNet ? await this.uploadReference(request.controlNet.imagePath) : null;
    const controlNet: ComfyUiControlNetInput | undefined = request.controlNet && uploadedControlNet
      ? {
          model: request.controlNet.model,
          image: uploadedControlNet,
          ...(request.controlNet.strength !== undefined ? { strength: request.controlNet.strength } : {}),
          ...(request.controlNet.startPercent !== undefined ? { startPercent: request.controlNet.startPercent } : {}),
          ...(request.controlNet.endPercent !== undefined ? { endPercent: request.controlNet.endPercent } : {}),
          nodeType: Object.prototype.hasOwnProperty.call(objectInfo, 'ControlNetApplyAdvanced')
            ? 'ControlNetApplyAdvanced' as const
            : 'ControlNetApply' as const,
        }
      : undefined;
    const ipAdapter: ComfyUiIpAdapterInput | undefined = request.ipAdapter && uploadedIpReference
      ? {
          model: request.ipAdapter.model,
          clipVisionModel: request.ipAdapter.clipVisionModel,
          image: uploadedIpReference,
          ...(request.ipAdapter.weight !== undefined ? { weight: request.ipAdapter.weight } : {}),
          nodeType: Object.prototype.hasOwnProperty.call(objectInfo, 'IPAdapterAdvanced')
            ? 'IPAdapterAdvanced' as const
            : 'IPAdapterApply' as const,
        }
      : undefined;
    const checkpoint = request.model ?? this.checkpoint;
    const profiled = applyCheckpointProfile(
      {
        steps: request.steps ?? this.steps,
        cfg: request.cfg ?? this.cfg,
        samplerName: request.samplerName ?? this.samplerName,
        scheduler: request.scheduler ?? this.scheduler,
        prompt: request.prompt,
        negativePrompt: request.negativePrompt ?? 'text, letters, watermark, low quality, deformed anatomy',
      },
      resolveCheckpointProfile(checkpoint),
    );
    const qualityPrefix = profiled.prompt.slice(0, Math.max(0, profiled.prompt.length - request.prompt.length));
    request = {
      ...request,
      prompt: profiled.prompt,
      negativePrompt: profiled.negativePrompt,
      steps: profiled.steps,
      cfg: profiled.cfg,
      samplerName: profiled.samplerName,
      scheduler: profiled.scheduler,
    };
    const regions = request.characterRegions?.slice(0, 8) ?? [];
    // Multi-character txt2img: scene-only global prompt, one solo prompt per region (core ConditioningSetArea), the
    // scene prompt masked around the figures, and, when installed, one synthetic OpenPose skeleton per region. Area
    // prompts alone are only a bias: in the CS9 experiments they dropped or added figures; the skeletons fix the count.
    const regionalComposition = regions.length > 1 && !uploadedReference;
    const maskedPrompts: ComfyUiMaskedPrompt[] = [];
    const maskedReport: ComfyUiGenerationMetadata['maskedPrompts'] = [];
    let spatialControl: ComfyUiGenerationMetadata['spatialControl'] = { mode: 'not_applicable' };
    let poseControlNet: ComfyUiControlNetInput | undefined;
    const uploadGuide = async (buffer: Buffer, name: string): Promise<ComfyUiImageRef> => {
      if (!this.gateway.uploadImage) throw new Error('ComfyUI gateway does not support guide image upload.');
      const uploaded = await this.gateway.uploadImage(buffer, name, 'aethera', true);
      return { filename: uploaded.name, ...(uploaded.subfolder ? { subfolder: uploaded.subfolder } : {}), type: uploaded.type };
    };
    if (regionalComposition) {
      const scene = request.scenePrompt ?? request.prompt;
      const strategy = request.compositionStrategy ?? {};
      const backgroundMask = await renderZoneMask(request.width, request.height, regions.map(figureBox), { invert: true, blur: 12, padX: 0.15 });
      const sceneStrength = strategy.sceneStrength ?? 0.6;
      const sceneSuffix = strategy.sceneSuffix ? `, ${strategy.sceneSuffix}` : '';
      maskedPrompts.push({ prompt: `${qualityPrefix}scenery, detailed background, ${scene}${sceneSuffix}`, mask: await uploadGuide(backgroundMask, 'aethera-scene-mask.png'), strength: sceneStrength });
      maskedReport.push({ purpose: 'scene_background', strength: sceneStrength });
      const poseModel = request.spatialControl === 'none' || controlNet ? undefined : controlNetNames(objectInfo).find((name) => /openpose/i.test(name));
      if (poseModel) {
        const dense = regions.length >= 4;
        const strength = Math.min(1.2, (dense ? 0.9 : 0.75) + (strategy.poseStrengthDelta ?? 0));
        const endPercent = strategy.poseEndPercent ?? (dense ? 0.85 : 0.7);
        const guide = await uploadGuide(await renderOpenPoseGuide(request.width, request.height, regions), 'aethera-pose-guide.png');
        poseControlNet = {
          model: poseModel,
          image: guide,
          strength,
          startPercent: 0,
          endPercent,
          nodeType: Object.prototype.hasOwnProperty.call(objectInfo, 'ControlNetApplyAdvanced') ? 'ControlNetApplyAdvanced' as const : 'ControlNetApply' as const,
        };
        spatialControl = { mode: 'openpose', model: poseModel, strength, endPercent };
      } else {
        spatialControl = {
          mode: 'area_only',
          reason: request.spatialControl === 'none'
            ? 'disabled by request'
            : controlNet
              ? 'a caller-supplied ControlNet takes precedence'
              : 'no OpenPose ControlNet reported by ComfyUI; character count is not enforced',
        };
      }
    }
    if (request.calmZones?.length && !uploadedReference) {
      const calmMask = await renderZoneMask(request.width, request.height, request.calmZones, { blur: 16 });
      const calmStrength = request.compositionStrategy?.calmStrength ?? 0.8;
      maskedPrompts.push({ prompt: `${qualityPrefix}open empty sky, soft haze, smooth gradient light, minimal detail`, mask: await uploadGuide(calmMask, 'aethera-calm-mask.png'), strength: calmStrength });
      maskedReport.push({ purpose: 'calm_zone', strength: calmStrength });
    }
    const effectiveControlNet = controlNet ?? poseControlNet;
    const workflowRequest = regionalComposition || maskedPrompts.length
      ? {
          ...request,
          ...(regionalComposition
            ? {
                regions: regions.map((region, index) => ({
                  prompt: `${qualityPrefix}${region.prompt ?? `solo, single character ${index + 1} of ${regions.length}, full body, distinct face and outfit, ${request.prompt}`}`,
                  x: region.x,
                  y: region.y,
                  width: region.width,
                  height: region.height,
                  strength: request.compositionStrategy?.regionStrength ?? (poseControlNet ? 1 : 0.8),
                })),
              }
            : {}),
          maskedPrompts,
        }
      : request;
    const workflow = uploadedReference
      ? request.faceDetailer
        ? (() => { throw new Error('ComfyUI FaceDetailer is currently supported only for native txt2img.'); })()
        : this.img2imgWorkflowFor(request, uploadedReference, controlNet, ipAdapter)
      : this.workflowFor(workflowRequest, effectiveControlNet, ipAdapter);
    const validation = validateComfyUiWorkflow(workflow, objectInfo);
    if (!validation.ok) {
      this.availabilityError = validation.errors.join(' ');
      throw new Error(`ComfyUI is not configured for image generation: ${this.availabilityError}`);
    }
    // FaceDetailer graphs save the base at node 7 and the refined image at node 22.
    const refined = Boolean(request.faceDetailer) && !uploadedReference;
    this.lastUnrefinedImage = null;
    const image = refined ? await this.runWorkflow(workflow, '22', '7') : await this.runWorkflow(workflow);
    this.lastGeneration = {
      checkpoint,
      width: request.width,
      height: request.height,
      steps: profiled.steps,
      cfg: profiled.cfg,
      samplerName: profiled.samplerName,
      scheduler: profiled.scheduler,
      checkpointProfile: { family: profiled.family, evidence: profiled.evidence, adjustments: profiled.adjustments },
      regionalComposition,
      regionCount: regionalComposition ? regions.length : 0,
      spatialControl,
      maskedPrompts: maskedReport,
      faceDetailer: refined,
    };
    return image;
  }

  private async inpaintRegionInternal(request: LocalizedInpaintRequest): Promise<Buffer> {
    if (!this.gateway.uploadImage) throw new Error('ComfyUI gateway does not support inpaint image upload.');

    const metadata = await sharp(request.imageBuffer).metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) throw new Error('ComfyUI inpaint requires a decodable raster image with dimensions.');

    const x = Math.max(0, Math.min(width - 1, Math.round(request.bbox.x)));
    const y = Math.max(0, Math.min(height - 1, Math.round(request.bbox.y)));
    const right = Math.max(x + 1, Math.min(width, Math.round(request.bbox.x + request.bbox.width)));
    const bottom = Math.max(y + 1, Math.min(height, Math.round(request.bbox.y + request.bbox.height)));
    if (right <= x || bottom <= y) throw new Error('ComfyUI inpaint bounding box does not intersect the source image.');

    // White means editable for ComfyUI's VAEEncodeForInpaint mask; all other pixels remain black and protected.
    const protectedRects = (request.protectRects ?? [])
      .map((rect) => `<rect x="${Math.round(rect.x)}" y="${Math.round(rect.y)}" width="${Math.max(1, Math.round(rect.width))}" height="${Math.max(1, Math.round(rect.height))}" fill="black"/>`)
      .join('');
    const maskSvg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="black"/><rect x="${x}" y="${y}" width="${right - x}" height="${bottom - y}" fill="white"/>${protectedRects}</svg>`;
    const maskBuffer = request.maskBuffer
      ? await sharp(request.maskBuffer)
          .resize(width, height, { fit: 'fill' })
          .composite(protectedRects ? [{ input: Buffer.from(`<svg width="${width}" height="${height}">${protectedRects}</svg>`) }] : [])
          .flatten({ background: '#000' })
          .png()
          .toBuffer()
      : await sharp(Buffer.from(maskSvg)).png().toBuffer();
    const baseUpload = await this.gateway.uploadImage(request.imageBuffer, 'aethera-inpaint-base.png', 'aethera', true);
    const maskUpload = await this.gateway.uploadImage(maskBuffer, 'aethera-inpaint-mask.png', 'aethera', true);
    const objectInfoForControl = request.controlNet ? await this.gateway.getObjectInfo() : null;
    const controlUpload = request.controlNet ? await this.gateway.uploadImage(request.controlNet.imageBuffer, 'aethera-inpaint-control.png', 'aethera', true) : null;
    const controlNet: ComfyUiControlNetInput | undefined = request.controlNet && controlUpload
      ? {
          model: request.controlNet.model,
          image: { filename: controlUpload.name, ...(controlUpload.subfolder ? { subfolder: controlUpload.subfolder } : {}), type: controlUpload.type },
          strength: request.controlNet.strength ?? 1,
          startPercent: 0,
          endPercent: request.controlNet.endPercent ?? 1,
          nodeType: objectInfoForControl && Object.prototype.hasOwnProperty.call(objectInfoForControl, 'ControlNetApplyAdvanced') ? 'ControlNetApplyAdvanced' as const : 'ControlNetApply' as const,
        }
      : undefined;
    const workflow = buildComfyUiInpaintWorkflow({
      checkpoint: this.checkpoint,
      positivePrompt: request.prompt,
      negativePrompt: request.negativePrompt ?? 'text, letters, watermark, low quality, deformed anatomy, extra limbs',
      width,
      height,
      seed: request.seed ?? Math.abs((Math.round(request.bbox.x) * 73856093) ^ (Math.round(request.bbox.y) * 19349663) ^ (Math.round(request.bbox.width) * 83492791)) % 2_147_483_647,
      steps: this.steps,
      cfg: this.cfg,
      samplerName: this.samplerName,
      scheduler: this.scheduler,
      denoise: request.strength ?? 0.54,
      growMaskBy: 8,
      ...(controlNet ? { controlNet } : {}),
      image: { filename: baseUpload.name, ...(baseUpload.subfolder ? { subfolder: baseUpload.subfolder } : {}), type: baseUpload.type },
      mask: { filename: maskUpload.name, ...(maskUpload.subfolder ? { subfolder: maskUpload.subfolder } : {}), type: maskUpload.type },
      filenamePrefix: `${this.filenamePrefix}/inpaint`,
    });
    const objectInfo = await this.gateway.getObjectInfo();
    const validation = validateComfyUiWorkflow(workflow, objectInfo);
    if (!validation.ok) {
      this.availabilityError = validation.errors.join(' ');
      throw new Error(`ComfyUI is not configured for localized repair: ${this.availabilityError}`);
    }
    return this.runWorkflow(workflow);
  }

  private async upscaleImageInternal(request: ImageUpscaleRequest): Promise<Buffer> {
    if (!request.model.trim()) throw new Error('ComfyUI upscale requires a model reported by upscale_models.');
    if (!this.gateway.uploadImage) throw new Error('ComfyUI gateway does not support upscale image upload.');
    if (request.imageBuffer.byteLength === 0) throw new Error('ComfyUI upscale cannot process an empty image.');
    const uploaded = await this.gateway.uploadImage(request.imageBuffer, 'aethera-upscale-input.png', 'aethera', true);
    const workflow = buildComfyUiUpscaleWorkflow({
      model: request.model,
      inputImage: { filename: uploaded.name, ...(uploaded.subfolder ? { subfolder: uploaded.subfolder } : {}), type: uploaded.type },
      filenamePrefix: `${this.filenamePrefix}/upscale`,
    });
    const objectInfo = await this.gateway.getObjectInfo();
    const validation = validateComfyUiWorkflow(workflow, objectInfo);
    if (!validation.ok) {
      this.availabilityError = validation.errors.join(' ');
      throw new Error(`ComfyUI is not configured for upscale: ${this.availabilityError}`);
    }
    return this.runWorkflow(workflow);
  }

  /**
   * Runs a graph and returns the image of `preferredOutput` when that node produced one. Graphs with a refiner save the
   * base image too; numeric node ids iterate in ascending order, so "first image" used to return the unrefined base
   * ('7') instead of the FaceDetailer result ('22').
   */
  private async runWorkflow(workflow: ComfyUiWorkflow, preferredOutput?: string, secondaryOutput?: string): Promise<Buffer> {
    const queued = await this.gateway.queuePrompt(workflow);
    this.activePromptId = queued.prompt_id;
    try {
      const history = await this.gateway.waitForCompletion(queued.prompt_id, { timeoutMs: this.timeoutMs });
      const fromNode = (nodeId: string | undefined) => {
        const output = nodeId ? history.outputs?.[nodeId] : undefined;
        return output ? extractComfyUiImages({ ...history, outputs: { [nodeId as string]: output } })[0] : undefined;
      };
      const chosen = fromNode(preferredOutput) ?? extractComfyUiImages(history)[0];
      if (!chosen) throw new Error('ComfyUI completed the prompt without a SaveImage output.');
      const bytes = await this.gateway.getImage(chosen);
      if (bytes.byteLength === 0) throw new Error('ComfyUI returned an empty image.');
      const secondary = fromNode(secondaryOutput);
      if (secondaryOutput !== undefined) this.lastUnrefinedImage = secondary ? await this.gateway.getImage(secondary) : null;
      return bytes;
    } finally {
      this.activePromptId = null;
      if (this.releaseMemoryAfterGeneration && this.gateway.freeMemory) {
        try {
          await this.gateway.freeMemory(true);
        } catch {
          // Releasing memory is best effort and must not mask the generation result.
        }
      }
    }
  }

  async cancel(): Promise<boolean> {
    if (!this.activePromptId || !this.gateway.interrupt) return false;
    await this.gateway.interrupt();
    return true;
  }

  private workflowFor(request: Pick<ImageGenerationRequest, 'prompt' | 'negativePrompt' | 'width' | 'height' | 'seed' | 'model' | 'steps' | 'cfg' | 'samplerName' | 'scheduler' | 'lora' | 'loras' | 'faceDetailer'> & { regions?: ComfyUiRegionalPrompt[]; maskedPrompts?: ComfyUiMaskedPrompt[] }, controlNet?: ComfyUiControlNetInput, ipAdapter?: ComfyUiIpAdapterInput): ComfyUiWorkflow {
    const loras = request.loras?.length ? request.loras : request.lora ? [request.lora] : undefined;
    const input = {
      checkpoint: request.model ?? this.checkpoint,
      positivePrompt: request.prompt,
      negativePrompt: request.negativePrompt ?? 'text, letters, watermark, low quality, deformed anatomy',
      width: request.width,
      height: request.height,
      seed: request.seed ?? 0,
      steps: request.steps ?? this.steps,
      cfg: request.cfg ?? this.cfg,
      samplerName: request.samplerName ?? this.samplerName,
      scheduler: request.scheduler ?? this.scheduler,
      ...(loras ? { loras } : {}),
      ...(controlNet ? { controlNet } : {}),
      ...(ipAdapter ? { ipAdapter } : {}),
      ...(request.faceDetailer ? { faceDetailer: request.faceDetailer } : {}),
      ...(request.regions?.length ? { regions: request.regions } : {}),
      ...(request.maskedPrompts?.length ? { maskedPrompts: request.maskedPrompts } : {}),
      filenamePrefix: this.filenamePrefix,
    };
    return request.faceDetailer ? buildComfyUiFaceDetailerWorkflow(input) : buildComfyUiTxt2ImgWorkflow(input);
  }

  private img2imgWorkflowFor(
    request: Pick<ImageGenerationRequest, 'prompt' | 'negativePrompt' | 'width' | 'height' | 'seed' | 'model' | 'steps' | 'cfg' | 'samplerName' | 'scheduler' | 'strength' | 'lora' | 'loras'>,
    inputImage: ComfyUiImageRef,
    controlNet?: ComfyUiControlNetInput,
    ipAdapter?: ComfyUiIpAdapterInput,
  ): ComfyUiWorkflow {
    const loras = request.loras?.length ? request.loras : request.lora ? [request.lora] : undefined;
    return buildComfyUiImg2ImgWorkflow({
      checkpoint: request.model ?? this.checkpoint,
      positivePrompt: request.prompt,
      negativePrompt: request.negativePrompt ?? 'text, letters, watermark, low quality, deformed anatomy',
      width: request.width,
      height: request.height,
      seed: request.seed ?? 0,
      steps: request.steps ?? this.steps,
      cfg: request.cfg ?? this.cfg,
      samplerName: request.samplerName ?? this.samplerName,
      scheduler: request.scheduler ?? this.scheduler,
      ...(loras ? { loras } : {}),
      ...(controlNet ? { controlNet } : {}),
      ...(ipAdapter ? { ipAdapter } : {}),
      denoise: request.strength ?? 0.55,
      inputImage,
      filenamePrefix: this.filenamePrefix,
    });
  }

  private async uploadReference(path: string): Promise<ComfyUiImageRef> {
    if (!this.gateway.uploadImage) throw new Error('ComfyUI gateway does not support reference image upload.');
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch (error) {
      throw new Error(`Reference image could not be read: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
    const uploaded = await this.gateway.uploadImage(bytes, basename(path), 'aethera', true);
    return {
      filename: uploaded.name,
      ...(uploaded.subfolder ? { subfolder: uploaded.subfolder } : {}),
      type: uploaded.type,
    };
  }
}
