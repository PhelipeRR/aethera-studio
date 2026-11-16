import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { ComfyUiClient, type ComfyUiHistoryEntry, type ComfyUiImageRef, type ComfyUiSystemStats } from './comfyui-client.js';
import {
  extractComfyUiImages,
  buildComfyUiImg2ImgWorkflow,
  buildComfyUiTxt2ImgWorkflow,
  validateComfyUiWorkflow,
  type ComfyUiWorkflow,
} from './comfyui-workflow.js';
import type {
  ExternalImageAdapter,
  ImageGenerationRequest,
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
