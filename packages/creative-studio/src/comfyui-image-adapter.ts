import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import sharp from 'sharp';
import { ComfyUiClient, type ComfyUiHistoryEntry, type ComfyUiImageRef, type ComfyUiSystemStats } from './comfyui-client.js';
import {
  buildComfyUiInpaintWorkflow,
  extractComfyUiImages,
  buildComfyUiImg2ImgWorkflow,
  buildComfyUiTxt2ImgWorkflow,
  validateComfyUiWorkflow,
  type ComfyUiWorkflow,
} from './comfyui-workflow.js';
import type {
  ExternalImageAdapter,
  ImageGenerationRequest,
  LocalizedInpaintRequest,
} from './image-generation-adapter.js';
import { GpuGenerationLease } from './gpu-generation-lease.js';

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

function safeFilenamePrefix(value: string): string {
  return value.replace(/[^A-Za-z0-9_./-]+/g, '-').replace(/^[/.-]+|[/.-]+$/g, '') || 'Aethera/creative';
}

export class ComfyUiImageAdapter implements ExternalImageAdapter {
  readonly id = 'comfyui-native';
  readonly gateway: ComfyUiGateway;
  checkpoint: string;
  private readonly steps: number;
  private readonly cfg: number;
  private readonly samplerName: string;
  private readonly scheduler: string;
  private readonly timeoutMs: number;
  private releaseMemoryAfterGeneration: boolean;
  private readonly filenamePrefix: string;
  private readonly gpuLease = new GpuGenerationLease();
  private activePromptId: string | null = null;
  private availabilityError: string | null = null;

  constructor(options?: ComfyUiImageAdapterOptions) {
    if (options?.gateway) {
      this.gateway = options.gateway;
    } else {
      this.gateway = new ComfyUiClient({
        baseUrl: options?.endpoint ?? 'http://127.0.0.1:8188',
        ...(options?.requestTimeoutMs !== undefined ? { requestTimeoutMs: options.requestTimeoutMs } : {}),
      });
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

  getAvailabilityError(): string | null {
    return this.availabilityError;
  }

  setCheckpoint(checkpoint: string): void {
    if (!checkpoint.trim()) throw new Error('ComfyUI checkpoint cannot be empty.');
    this.checkpoint = checkpoint.trim();
    this.availabilityError = null;
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

  private async generateImageInternal(request: ImageGenerationRequest): Promise<Buffer> {
    const objectInfo = await this.gateway.getObjectInfo();
    const referencePath = request.referenceImagePaths?.[0];
    const uploadedReference = referencePath ? await this.uploadReference(referencePath) : null;
    const workflow = uploadedReference ? this.img2imgWorkflowFor(request, uploadedReference) : this.workflowFor(request);
    const validation = validateComfyUiWorkflow(workflow, objectInfo);
    if (!validation.ok) {
      this.availabilityError = validation.errors.join(' ');
      throw new Error(`ComfyUI is not configured for image generation: ${this.availabilityError}`);
    }
    return this.runWorkflow(workflow);
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
    const maskSvg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="black"/><rect x="${x}" y="${y}" width="${right - x}" height="${bottom - y}" fill="white"/></svg>`;
    const maskBuffer = await sharp(Buffer.from(maskSvg)).png().toBuffer();
    const baseUpload = await this.gateway.uploadImage(request.imageBuffer, 'aethera-inpaint-base.png', 'aethera', true);
    const maskUpload = await this.gateway.uploadImage(maskBuffer, 'aethera-inpaint-mask.png', 'aethera', true);
    const workflow = buildComfyUiInpaintWorkflow({
      checkpoint: this.checkpoint,
      positivePrompt: request.prompt,
      negativePrompt: 'text, letters, watermark, low quality, deformed anatomy, extra limbs',
      width,
      height,
      seed: 0,
      steps: this.steps,
      cfg: this.cfg,
      samplerName: this.samplerName,
      scheduler: this.scheduler,
      denoise: request.strength ?? 0.54,
      growMaskBy: 8,
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

  private async runWorkflow(workflow: ComfyUiWorkflow): Promise<Buffer> {
    const queued = await this.gateway.queuePrompt(workflow);
    this.activePromptId = queued.prompt_id;
    try {
      const history = await this.gateway.waitForCompletion(queued.prompt_id, { timeoutMs: this.timeoutMs });
      const images = extractComfyUiImages(history);
      const firstImage = images[0];
      if (!firstImage) throw new Error('ComfyUI completed the prompt without a SaveImage output.');
      const bytes = await this.gateway.getImage(firstImage);
      if (bytes.byteLength === 0) throw new Error('ComfyUI returned an empty image.');
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

  private workflowFor(request: Pick<ImageGenerationRequest, 'prompt' | 'negativePrompt' | 'width' | 'height' | 'seed' | 'model' | 'steps' | 'cfg' | 'samplerName' | 'scheduler'>): ComfyUiWorkflow {
    return buildComfyUiTxt2ImgWorkflow({
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
      filenamePrefix: this.filenamePrefix,
    });
  }

  private img2imgWorkflowFor(
    request: Pick<ImageGenerationRequest, 'prompt' | 'negativePrompt' | 'width' | 'height' | 'seed' | 'model' | 'steps' | 'cfg' | 'samplerName' | 'scheduler' | 'strength'>,
    inputImage: ComfyUiImageRef,
  ): ComfyUiWorkflow {
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
