import type { AssetIngestionService } from './asset-ingestion.js';
import sharp from 'sharp';
import type { ExternalImageAdapter } from './image-generation-adapter.js';
import type { GenerationQualityProfile, GenerationQualityProfileId } from './generation-profiles.js';
import { ART_SPECIFICATIONS, type BrandKit, type CreativeArtType, type ManagedAssetRef } from './schemas.js';
import { buildVisualRecipe, type CreativeDirectionNotes, type VisualRecipe } from './visual-recipe.js';
import type { ProfessionalPresetId } from './creative-presets.js';
import { auditGeneratedImage, type GeneratedImageQualityAudit } from './generated-image-quality.js';
import { normalizeLoraStack, type LoraStackItem } from './lora-catalog.js';

/**
 * Outcome of the AI image step of "Gerar Arte Editável". It is always returned (never thrown) so the caller can
 * tell the user exactly why a composition fell back to the palette gradient instead of doing it silently (CF-1).
 */
export interface AiGenerationReport {
  status: 'generated' | 'disabled' | 'unavailable' | 'failed' | 'skipped_existing_background';
  engineId: string;
  message: string;
  durationMs?: number;
  recipe?: VisualRecipe;
  /** Img2img denoise used for the first reference image; lower values preserve more of the reference. */
  referenceStrength?: number;
  /** Number of bounded generation attempts, including the first attempt. */
  attempts?: number;
  lora?: { model: string; strengthModel: number; strengthClip: number };
  loras?: Array<{ model: string; strengthModel: number; strengthClip: number; nodeType?: 'LoraLoader' | 'LoraLoaderModelOnly' }>;
  loraSelection?: { mode: 'off' | 'manual' | 'automatic'; explanation?: string; warnings: string[] };
  controlNet?: { model: string; strength: number; imagePath: string };
  ipAdapter?: { model: string; clipVisionModel: string; weight: number; referenceImagePath?: string };
  faceDetailer?: { detectorModel: string; denoise?: number; guideSize?: number; maxSize?: number };
  qualityAudit?: GeneratedImageQualityAudit;
  /** Provider that actually produced the image (a chain may fall back) and the errors that caused any fallback. */
  servedBy?: { providerId: string; fallbackErrors: string[] };
  /** Effective engine parameters after checkpoint-profile adjustments, when the serving engine reports them. */
  engineParameters?: unknown;
  /** Technical negative LoRA used against extra background figures in multi-character scenes (set by the caller). */
  crowdSuppression?: { applied: boolean; lora: LoraStackItem | null; reason: string };
  /** Quality profile and the refinement steps that actually ran. */
  refinement?: {
    profile: GenerationQualityProfileId;
    faceDetailer: boolean;
    upscale: { model: string; from: string; to: string; durationMs: number } | { skipped: string } | null;
  };
}

export interface GenerateAiBackgroundInput {
  artType: CreativeArtType;
  prompt: string;
  headline?: string;
  brandKit?: BrandKit | null;
  direction?: CreativeDirectionNotes | null;
  imageAdapter: ExternalImageAdapter;
  ingestion: AssetIngestionService;
  seed?: number;
  seedKey?: string;
  maxSide?: number;
  stylization?: number;
  professionalPreset?: ProfessionalPresetId;
  referenceImagePaths?: string[];
  referenceStrength?: number;
  maxAttempts?: number;
  lora?: { model: string; strengthModel?: number; strengthClip?: number };
  loras?: LoraStackItem[];
  loraSelection?: { mode: 'off' | 'manual' | 'automatic'; explanation?: string; warnings?: string[] };
  controlNet?: { model: string; imagePath: string; strength?: number; startPercent?: number; endPercent?: number };
  ipAdapter?: { model: string; clipVisionModel: string; referenceImagePath?: string; weight?: number };
  faceDetailer?: { detectorModel: string; guideSize?: number; maxSize?: number; denoise?: number };
  characterCount?: number;
  /** One description per character; otherwise the recipe derives them from the creative direction. */
  characterDescriptions?: string[];
  /** `preview` (default) runs a single pass; `professional` adds FaceDetailer and model upscale. */
  qualityProfile?: GenerationQualityProfile;
  /** Final document size (defaults to the art type size); the upscale only runs when it is larger than the generation. */
  upscaleTarget?: { width: number; height: number };
  /** Multi-character spatial control; defaults to `auto` (OpenPose skeletons when installed). */
  spatialControl?: 'auto' | 'none';
}

export async function generateAiBackground(
  input: GenerateAiBackgroundInput,
): Promise<{ asset: ManagedAssetRef | null; report: AiGenerationReport }> {
  const engineId = input.imageAdapter.id;
  const loraStack = normalizeLoraStack(input.loras?.length ? input.loras : input.lora ? [input.lora] : []);
  const loraReport = loraStack.map((lora) => ({
    model: lora.model,
    strengthModel: lora.strengthModel ?? 1,
    strengthClip: lora.strengthClip ?? lora.strengthModel ?? 1,
    ...(lora.nodeType ? { nodeType: lora.nodeType } : {}),
  }));
  if (!input.imageAdapter.generateImage || !(await input.imageAdapter.isAvailable())) {
    return {
      asset: null,
      report: {
        status: 'unavailable',
        engineId,
        message:
          'IA de imagem indisponível: a arte foi montada só com a paleta do Brand Kit (gradiente + efeitos). ' +
          'Verifique o Python/CUDA do motor local.',
      },
    };
  }
  const recipe = buildVisualRecipe({
    artType: input.artType,
    prompt: input.prompt,
    ...(input.headline ? { headline: input.headline } : {}),
    brandKit: input.brandKit ?? null,
    direction: input.direction ?? null,
    ...(input.seed !== undefined ? { seed: input.seed } : {}),
    ...(input.seedKey ? { seedKey: input.seedKey } : {}),
    ...(input.maxSide !== undefined ? { maxSide: input.maxSide } : {}),
    ...(input.stylization !== undefined ? { stylization: input.stylization } : {}),
    ...(input.professionalPreset ? { professionalPreset: input.professionalPreset } : {}),
    ...(input.characterCount !== undefined ? { characterCount: input.characterCount } : {}),
    ...(input.characterDescriptions?.length ? { characterDescriptions: input.characterDescriptions } : {}),
  });
  const faceDetailer = input.faceDetailer ?? input.qualityProfile?.faceDetailer ?? undefined;
  const maxAttempts = Math.min(3, Math.max(1, Math.floor(input.maxAttempts ?? 1)));
  const started = Date.now();
  let lastRecipe = recipe;
  let lastAudit: GeneratedImageQualityAudit | undefined;
  let lastError: string | undefined;

  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex += 1) {
    const attempt = attemptIndex + 1;
    const attemptRecipe = attemptIndex === 0 ? recipe : { ...recipe, seed: (recipe.seed + attemptIndex) % 0x80000000 };
    lastRecipe = attemptRecipe;
    const controlNetPayload = input.controlNet
      ? {
          model: input.controlNet.model,
          imagePath: input.controlNet.imagePath,
          ...(typeof input.controlNet.strength === 'number' ? { strength: input.controlNet.strength } : {}),
          ...(typeof input.controlNet.startPercent === 'number' ? { startPercent: input.controlNet.startPercent } : {}),
          ...(typeof input.controlNet.endPercent === 'number' ? { endPercent: input.controlNet.endPercent } : {}),
        }
      : undefined;
    try {
      const buffer = await input.imageAdapter.generateImage({
        prompt: attemptRecipe.positivePrompt,
        negativePrompt: attemptRecipe.negativePrompt,
        seed: attemptRecipe.seed,
        width: attemptRecipe.width,
        height: attemptRecipe.height,
        steps: attemptRecipe.steps,
        cfg: attemptRecipe.cfg,
        samplerName: attemptRecipe.samplerName,
        scheduler: attemptRecipe.scheduler,
        preset: attemptRecipe.professionalPreset,
        ...(input.referenceImagePaths?.length ? { referenceImagePaths: input.referenceImagePaths } : {}),
        ...(input.referenceImagePaths?.length && input.referenceStrength !== undefined
          ? { strength: Math.min(1, Math.max(0.01, input.referenceStrength)) }
          : {}),
        ...(loraStack.length ? { loras: loraStack } : {}),
        ...(controlNetPayload ? { controlNet: controlNetPayload } : {}),
        ...(input.ipAdapter
          ? {
              ipAdapter: {
                model: input.ipAdapter.model,
                clipVisionModel: input.ipAdapter.clipVisionModel,
                ...(input.ipAdapter.referenceImagePath ? { referenceImagePath: input.ipAdapter.referenceImagePath } : {}),
                ...(input.ipAdapter.weight !== undefined ? { weight: input.ipAdapter.weight } : {}),
              },
            }
          : {}),
        ...(faceDetailer ? { faceDetailer } : {}),
        ...(input.characterCount !== undefined ? { characterCount: input.characterCount } : {}),
        ...(attemptRecipe.characterRegions.length > 1 ? { characterRegions: attemptRecipe.characterRegions, spatialControl: input.spatialControl ?? 'auto' } : {}),
        ...(attemptRecipe.scenePrompt ? { scenePrompt: attemptRecipe.scenePrompt } : {}),
        ...(attemptRecipe.calmZones?.length ? { calmZones: attemptRecipe.calmZones } : {}),
      });
      const qualityAudit = await auditGeneratedImage(buffer, { expectedWidth: attemptRecipe.width, expectedHeight: attemptRecipe.height });
      lastAudit = qualityAudit;
      if (!qualityAudit.passed) continue;
      // Metadata is read before any upscale call, which would overwrite the adapter's last-generation record.
      const servedReporter = input.imageAdapter as ExternalImageAdapter & {
        getLastServedProvider?: () => { providerId: string; fallbackErrors: string[] } | null;
        getLastGenerationMetadata?: () => unknown;
      };
      const servedBy = servedReporter.getLastServedProvider?.() ?? { providerId: engineId, fallbackErrors: [] };
      const engineParameters = servedReporter.getLastGenerationMetadata?.() ?? null;
      let finalBuffer = buffer;
      let upscaleReport: NonNullable<AiGenerationReport['refinement']>['upscale'] = null;
      const upscaleModel = input.qualityProfile?.upscale?.model;
      if (upscaleModel) {
        const spec = ART_SPECIFICATIONS[input.artType];
        const target = input.upscaleTarget ?? { width: spec.width, height: spec.height };
        if (!target || (target.width <= attemptRecipe.width && target.height <= attemptRecipe.height)) {
          upscaleReport = { skipped: 'document is not larger than the generation' };
        } else if (!input.imageAdapter.upscaleImage) {
          upscaleReport = { skipped: 'the image engine does not support model upscale' };
        } else {
          const upscaleStarted = Date.now();
          const upscaled = await input.imageAdapter.upscaleImage({ imageBuffer: buffer, model: upscaleModel });
          finalBuffer = await sharp(upscaled).resize(target.width, target.height, { fit: 'cover', kernel: 'lanczos3' }).png().toBuffer();
          upscaleReport = { model: upscaleModel, from: `${attemptRecipe.width}x${attemptRecipe.height}`, to: `${target.width}x${target.height}`, durationMs: Date.now() - upscaleStarted };
        }
      }

      const asset = await input.ingestion.ingestBuffer({
        buffer: finalBuffer,
        kind: 'image',
        extension: 'png',
        originalName: `ai-gen-${attemptRecipe.preset}-${attemptRecipe.seed}.png`,
      });
      return {
        asset,
        report: {
          status: 'generated',
          engineId,
          servedBy,
          ...(engineParameters ? { engineParameters } : {}),
          message: `Fundo gerado por ${servedBy.providerId}${servedBy.fallbackErrors.length ? ` (fallback após: ${servedBy.fallbackErrors.join(' | ')})` : ''} (preset ${attemptRecipe.preset}, seed ${attemptRecipe.seed}${attempt > 1 ? `, após ${attempt} tentativas` : ''}).`,
          durationMs: Date.now() - started,
          recipe: attemptRecipe,
          ...(input.referenceStrength !== undefined ? { referenceStrength: input.referenceStrength } : {}),
          attempts: attempt,
          ...(loraReport.length ? { lora: loraReport[0], loras: loraReport } : {}),
          ...(input.loraSelection ? { loraSelection: { ...input.loraSelection, warnings: input.loraSelection.warnings ?? [] } } : {}),
          ...(input.controlNet ? { controlNet: { model: input.controlNet.model, strength: input.controlNet.strength ?? 0.65, imagePath: input.controlNet.imagePath } } : {}),
          ...(input.ipAdapter ? { ipAdapter: { model: input.ipAdapter.model, clipVisionModel: input.ipAdapter.clipVisionModel, weight: input.ipAdapter.weight ?? 0.8, ...(input.ipAdapter.referenceImagePath ? { referenceImagePath: input.ipAdapter.referenceImagePath } : {}) } } : {}),
          ...(faceDetailer ? { faceDetailer } : {}),
          refinement: { profile: input.qualityProfile?.id ?? 'preview', faceDetailer: Boolean(faceDetailer), upscale: upscaleReport },
          qualityAudit,
        },
      };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  const failureReason = lastAudit
    ? lastAudit.findings.map((finding) => finding.message).join(' ')
    : lastError ?? 'nenhuma saída utilizável foi retornada pelo motor';
  return {
    asset: null,
    report: {
      status: 'failed',
      engineId,
      message: `Falha na geração por IA após ${maxAttempts} tentativa${maxAttempts === 1 ? '' : 's'} (${failureReason}); a arte usou o fundo da paleta.`,
      durationMs: Date.now() - started,
      recipe: lastRecipe,
      ...(input.referenceStrength !== undefined ? { referenceStrength: input.referenceStrength } : {}),
      attempts: maxAttempts,
      ...(loraReport.length ? { lora: loraReport[0], loras: loraReport } : {}),
      ...(input.loraSelection ? { loraSelection: { ...input.loraSelection, warnings: input.loraSelection.warnings ?? [] } } : {}),
      ...(input.controlNet ? { controlNet: { model: input.controlNet.model, strength: input.controlNet.strength ?? 0.65, imagePath: input.controlNet.imagePath } } : {}),
      ...(input.ipAdapter ? { ipAdapter: { model: input.ipAdapter.model, clipVisionModel: input.ipAdapter.clipVisionModel, weight: input.ipAdapter.weight ?? 0.8, ...(input.ipAdapter.referenceImagePath ? { referenceImagePath: input.ipAdapter.referenceImagePath } : {}) } } : {}),
      ...(input.faceDetailer ? { faceDetailer: input.faceDetailer } : {}),
      ...(lastAudit ? { qualityAudit: lastAudit } : {}),
    },
  };
}
