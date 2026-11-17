import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type {
  BackgroundRemovalRequest,
  ExternalImageAdapter,
  ImageGenerationRequest,
  ImageUpscaleRequest,
  LocalizedInpaintRequest,
  SemanticEvaluationRequest,
  SemanticEvaluationResult,
  VisualQualityInspectionRequest,
  VisualQualityInspectionResult,
} from './image-generation-adapter.js';
import type { LocalizedDefect } from './schemas.js';

const execFileAsync = promisify(execFile);

function resolveDefaultWorkerScript(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate = resolve(here, '..', 'scripts', 'vision_worker.py');
  if (existsSync(candidate)) return candidate;
  return resolve(process.cwd(), 'packages', 'creative-studio', 'scripts', 'vision_worker.py');
}

export interface LocalPythonAiAdapterOptions {
  pythonPath?: string;
  workerScriptPath?: string;
  model?: string;
  rembgModel?: string;
  steps?: number;
  timeoutMs?: number;
  forceCpu?: boolean;
}

/**
 * Local-first AI Image Generation (SDXL-Turbo on CUDA RTX 4060 Ti / CPU fallback)
 * and Semantic Background Segmentation (rembg U2Net/ISNet) adapter.
 */
export class LocalPythonAiAdapter implements ExternalImageAdapter {
  readonly id = 'local-sdxl-rembg';
  private readonly pythonPath: string;
  private readonly workerScriptPath: string;
  private readonly model: string;
  private readonly rembgModel: string;
  private readonly steps: number;
  private readonly timeoutMs: number;
  private readonly forceCpu: boolean;
  private availabilityCache: { checkedAt: number; available: boolean } | null = null;

  constructor(options?: LocalPythonAiAdapterOptions) {
    this.pythonPath = options?.pythonPath ?? process.env['NB_PYTHON'] ?? 'python';
    this.workerScriptPath = options?.workerScriptPath ?? resolveDefaultWorkerScript();
    this.model = options?.model ?? 'stabilityai/sdxl-turbo';
    this.rembgModel = options?.rembgModel ?? 'adaptive';
    this.steps = options?.steps ?? 3;
    this.timeoutMs = options?.timeoutMs ?? 180_000;
    this.forceCpu = options?.forceCpu ?? false;
  }

  async isAvailable(): Promise<boolean> {
    if (this.availabilityCache && Date.now() - this.availabilityCache.checkedAt < 60_000) {
      return this.availabilityCache.available;
    }
    if (!existsSync(this.workerScriptPath)) {
      this.availabilityCache = { checkedAt: Date.now(), available: false };
      return false;
    }
    try {
      const { stdout } = await execFileAsync(
        this.pythonPath,
        [
          '-c',
          "import importlib.util; print('OK' if all(importlib.util.find_spec(p) is not None for p in ['torch','diffusers','rembg','PIL']) else 'NO')",
        ],
        { timeout: 10_000 },
      );
      const ok = stdout.trim() === 'OK';
      this.availabilityCache = { checkedAt: Date.now(), available: ok };
      return ok;
    } catch {
      this.availabilityCache = { checkedAt: Date.now(), available: false };
      return false;
    }
  }

  async generateImage(request: ImageGenerationRequest): Promise<Buffer> {
    const workDir = mkdtempSync(join(tmpdir(), 'aethera-ai-gen-'));
    const outPath = join(workDir, 'generated.png');
    // Snap dimensions to multiples of 8 (required by SDXL) and cap max side for 8 GB VRAM safety
    const maxSide = 1024;
    const scale = Math.min(1, maxSide / Math.max(request.width, request.height));
    const genW = Math.max(256, Math.round((request.width * scale) / 8) * 8);
    const genH = Math.max(256, Math.round((request.height * scale) / 8) * 8);

    try {
      const args = [
        this.workerScriptPath,
        'generate',
        '--prompt',
        request.prompt,
        '--output',
        outPath,
        '--width',
        String(genW),
        '--height',
        String(genH),
        '--steps',
        String(this.steps),
        '--model',
        this.model,
      ];
      if (request.referenceImagePaths?.[0] && existsSync(request.referenceImagePaths[0])) {
        args.push('--init-image', resolve(request.referenceImagePaths[0]));
        if (typeof request.strength === 'number') {
          args.push('--strength', String(request.strength));
        }
      }
      if (typeof request.seed === 'number' && Number.isInteger(request.seed) && request.seed >= 0) {
        args.push('--seed', String(request.seed));
      }
      // request.negativePrompt is intentionally not forwarded: SDXL-Turbo runs with guidance_scale=0, where a
      // negative prompt has no effect. Engines with CFG (ComfyUI, CF-4) use it.
      if (this.forceCpu) args.push('--cpu');

      await execFileAsync(this.pythonPath, args, { timeout: this.timeoutMs });
      if (!existsSync(outPath)) {
        throw new Error('Local AI worker completed without writing output image.');
      }
      return readFileSync(outPath);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  async removeBackground(request: BackgroundRemovalRequest): Promise<Buffer> {
    const workDir = mkdtempSync(join(tmpdir(), 'aethera-ai-seg-'));
    const outPath = join(workDir, 'cutout.png');
    try {
      const workerArgs =
        this.rembgModel === 'adaptive'
          ? [
              this.workerScriptPath,
              'segment-adaptive',
              '--input',
              resolve(request.inputImagePath),
              '--output',
              outPath,
              '--models',
              'birefnet-portrait,isnet-general-use',
            ]
          : [
              this.workerScriptPath,
              'segment',
              '--input',
              resolve(request.inputImagePath),
              '--output',
              outPath,
              '--rembg-model',
              this.rembgModel,
            ];
      await execFileAsync(this.pythonPath, workerArgs, { timeout: this.timeoutMs });
      if (!existsSync(outPath)) {
        throw new Error('Local segmentation worker completed without writing cutout PNG.');
      }
      return readFileSync(outPath);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  async evaluateImageSemantics(request: SemanticEvaluationRequest): Promise<SemanticEvaluationResult> {
    const workDir = mkdtempSync(join(tmpdir(), 'aethera-ai-eval-'));
    const imgPath = join(workDir, 'candidate.png');
    try {
      writeFileSync(imgPath, request.imageBuffer);
      const args = [
        this.workerScriptPath,
        'evaluate-semantic',
        '--image',
        imgPath,
        '--positives',
        request.positiveConcepts.join('|'),
        '--negatives',
        request.negativeConcepts.join('|'),
      ];
      if (this.forceCpu) args.push('--cpu');
      const { stdout } = await execFileAsync(this.pythonPath, args, { timeout: this.timeoutMs });
      const parsed = JSON.parse(stdout.trim().split(/\r?\n/).pop() || '{}') as {
        positive_prob?: number;
        negative_prob?: number;
        margin?: number;
        is_off_topic?: boolean;
        best_positive?: string;
        best_negative?: string;
      };
      const pos = parsed.positive_prob ?? 0.5;
      const neg = parsed.negative_prob ?? 0.5;
      const isOffTopic = Boolean(parsed.is_off_topic);
      return {
        evaluatorId: 'local-clip-vit-base-patch32',
        positiveScore: pos,
        negativeScore: neg,
        margin: parsed.margin ?? pos - neg,
        isOffTopic,
        matchedLabel: parsed.best_positive ?? request.positiveConcepts[0] ?? '',
        rationale: isOffTopic
          ? `CLIP multimodal detectou desalinhamento semântico (${(pos * 100).toFixed(1)}% positivo vs ${(neg * 100).toFixed(1)}% distrator "${parsed.best_negative ?? ''}").`
          : `CLIP multimodal confirmou aderência ao tema "${parsed.best_positive ?? ''}" (similaridade calibrada ${(pos * 100).toFixed(1)}% vs ${(neg * 100).toFixed(1)}% distrator).`,
      };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  async inspectVisualQuality(request: VisualQualityInspectionRequest): Promise<VisualQualityInspectionResult> {
    const workDir = mkdtempSync(join(tmpdir(), 'aethera-ai-qual-'));
    const imgPath = join(workDir, 'candidate.png');
    const compPath = join(workDir, 'compare.png');
    try {
      writeFileSync(imgPath, request.imageBuffer);
      const args = [
        this.workerScriptPath,
        'inspect-visual-quality',
        '--image',
        imgPath,
        '--genre',
        request.genre ?? 'general',
      ];
      if (request.compareBeforeBuffer) {
        writeFileSync(compPath, request.compareBeforeBuffer);
        args.push('--compare-image', compPath);
      }
      if (this.forceCpu) args.push('--cpu');
      const { stdout } = await execFileAsync(this.pythonPath, args, { timeout: this.timeoutMs });
      const parsed = JSON.parse(stdout.trim().split(/\r?\n/).pop() || '{}') as {
        anatomical_consistency?: number;
        physical_coherence?: number;
        composition_quality?: number;
        subject_identity_consistency?: number;
        visual_artifact_severity?: number;
        localized_defects?: LocalizedDefect[];
      };
      return {
        evaluatorId: 'local-visual-quality-critic',
        anatomicalConsistency: parsed.anatomical_consistency ?? 84,
        physicalCoherence: parsed.physical_coherence ?? 84,
        compositionQuality: parsed.composition_quality ?? 82,
        subjectIdentityConsistency: parsed.subject_identity_consistency ?? 90,
        visualArtifactSeverity: parsed.visual_artifact_severity ?? 14,
        localizedDefects: Array.isArray(parsed.localized_defects) ? parsed.localized_defects : [],
      };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  async inpaintRegion(request: LocalizedInpaintRequest): Promise<Buffer> {
    const workDir = mkdtempSync(join(tmpdir(), 'aethera-ai-inpaint-'));
    const inPath = join(workDir, 'base.png');
    const outPath = join(workDir, 'repaired.png');
    try {
      writeFileSync(inPath, request.imageBuffer);
      const { x, y, width, height } = request.bbox;
      const args = [
        this.workerScriptPath,
        'inpaint-region',
        '--image',
        inPath,
        '--output',
        outPath,
        '--prompt',
        request.prompt,
        '--bbox',
        `${Math.round(x)},${Math.round(y)},${Math.round(width)},${Math.round(height)}`,
        '--strength',
        String(request.strength ?? 0.52),
        '--model',
        this.model,
      ];
      if (this.forceCpu) args.push('--cpu');
      await execFileAsync(this.pythonPath, args, { timeout: this.timeoutMs });
      if (!existsSync(outPath)) {
        throw new Error('Local inpaint worker completed without writing repaired PNG.');
      }
      return readFileSync(outPath);
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

/**
 * Fallback chain across multiple ExternalImageAdapter providers (e.g. Local RTX 4060 Ti -> External Cloud API).
 */
export class ProviderChainImageAdapter implements ExternalImageAdapter {
  readonly id = 'provider-chain';

  constructor(private readonly providers: ExternalImageAdapter[]) {}

  async isAvailable(): Promise<boolean> {
    for (const p of this.providers) {
      if (await p.isAvailable()) return true;
    }
    return false;
  }

  async generateImage(request: ImageGenerationRequest): Promise<Buffer> {
    const errors: string[] = [];
    for (const p of this.providers) {
      if (!p.generateImage) continue;
      if (!(await p.isAvailable())) continue;
      try {
        return await p.generateImage(request);
      } catch (err) {
        errors.push(`${p.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(
      errors.length > 0
        ? `Todos os provedores de geração de imagem falharam: ${errors.join(' | ')}`
        : 'Nenhum provedor de geração de imagem por IA disponível.',
    );
  }

  async removeBackground(request: BackgroundRemovalRequest): Promise<Buffer> {
    const errors: string[] = [];
    for (const p of this.providers) {
      if (!p.removeBackground) continue;
      if (!(await p.isAvailable())) continue;
      try {
        return await p.removeBackground(request);
      } catch (err) {
        errors.push(`${p.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(
      errors.length > 0
        ? `Todos os provedores de segmentação falharam: ${errors.join(' | ')}`
        : 'Nenhum provedor de segmentação semântica disponível.',
    );
  }

  async evaluateImageSemantics(request: SemanticEvaluationRequest): Promise<SemanticEvaluationResult> {
    for (const p of this.providers) {
      if (!p.evaluateImageSemantics) continue;
      if (!(await p.isAvailable())) continue;
      try {
        return await p.evaluateImageSemantics(request);
      } catch {
        // try next provider
      }
    }
    throw new Error('Nenhum provedor multimodal de avaliação semântica disponível.');
  }

  async inspectVisualQuality(request: VisualQualityInspectionRequest): Promise<VisualQualityInspectionResult> {
    for (const p of this.providers) {
      if (!p.inspectVisualQuality) continue;
      if (!(await p.isAvailable())) continue;
      try {
        return await p.inspectVisualQuality(request);
      } catch {
        // try next provider
      }
    }
    throw new Error('Nenhum provedor de crítica visual anatômica disponível.');
  }

  async inpaintRegion(request: LocalizedInpaintRequest): Promise<Buffer> {
    for (const p of this.providers) {
      if (!p.inpaintRegion) continue;
      if (!(await p.isAvailable())) continue;
      try {
        return await p.inpaintRegion(request);
      } catch {
        // try next provider
      }
    }
    throw new Error('Nenhum provedor de reparo localizado (inpainting) disponível.');
  }

  async upscaleImage(request: ImageUpscaleRequest): Promise<Buffer> {
    const errors: string[] = [];
    for (const p of this.providers) {
      if (!p.upscaleImage) continue;
      if (!(await p.isAvailable())) continue;
      try {
        return await p.upscaleImage(request);
      } catch (err) {
        errors.push(`${p.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    throw new Error(
      errors.length > 0
        ? `Todos os provedores de upscale falharam: ${errors.join(' | ')}`
        : 'Nenhum provedor de upscale disponível.',
    );
  }
}
