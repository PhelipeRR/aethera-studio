import { ComfyUiClient, type ComfyUiHistoryEntry, type ComfyUiImageRef, type ComfyUiSystemStats } from './comfyui-client.js';
import { extractComfyUiImages, buildComfyUiTxt2ImgWorkflow, validateComfyUiWorkflow, type ComfyUiWorkflow } from './comfyui-workflow.js';
import type {
  ExternalImageAdapter,
  ImageGenerationRequest,
} from './image-generation-adapter.js';

export interface ComfyUiGateway {
  getSystemStats(): Promise<ComfyUiSystemStats>;
  getObjectInfo(): Promise<Record<string, unknown>>;
  queuePrompt(prompt: Record<string, unknown>): Promise<{ prompt_id: string }>;
  waitForCompletion(promptId: string, options?: { pollMs?: number; timeoutMs?: number }): Promise<ComfyUiHistoryEntry>;
  getImage(image: ComfyUiImageRef): Promise<Buffer>;
  interrupt?(): Promise<void>;
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
  filenamePrefix?: string;
}

function safeFilenamePrefix(value: string): string {
  return value.replace(/[^A-Za-z0-9_./-]+/g, '-').replace(/^[/.-]+|[/.-]+$/g, '') || 'Aethera/creative';
}

export class ComfyUiImageAdapter implements ExternalImageAdapter {
  readonly id = 'comfyui-native';
  readonly gateway: ComfyUiGateway;
  readonly checkpoint: string;
  private readonly steps: number;
  private readonly cfg: number;
  private readonly samplerName: string;
  private readonly scheduler: string;
  private readonly timeoutMs: number;
  private readonly filenamePrefix: string;
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

  async generateImage(request: ImageGenerationRequest): Promise<Buffer> {
    const objectInfo = await this.gateway.getObjectInfo();
    const workflow = this.workflowFor(request);
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
    }
  }

  async cancel(): Promise<boolean> {
    if (!this.activePromptId || !this.gateway.interrupt) return false;
    await this.gateway.interrupt();
    return true;
  }

  private workflowFor(request: Pick<ImageGenerationRequest, 'prompt' | 'negativePrompt' | 'width' | 'height' | 'seed'>): ComfyUiWorkflow {
    return buildComfyUiTxt2ImgWorkflow({
      checkpoint: this.checkpoint,
      positivePrompt: request.prompt,
      negativePrompt: request.negativePrompt ?? 'text, letters, watermark, low quality, deformed anatomy',
      width: request.width,
      height: request.height,
      seed: request.seed ?? 0,
      steps: this.steps,
      cfg: this.cfg,
      samplerName: this.samplerName,
      scheduler: this.scheduler,
      filenamePrefix: this.filenamePrefix,
    });
  }
}
