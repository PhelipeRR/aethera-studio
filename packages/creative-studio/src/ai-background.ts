import type { AssetIngestionService } from './asset-ingestion.js';
import type { ExternalImageAdapter } from './image-generation-adapter.js';
import type { BrandKit, CreativeArtType, ManagedAssetRef } from './schemas.js';
import { buildVisualRecipe, type CreativeDirectionNotes, type VisualRecipe } from './visual-recipe.js';
import type { ProfessionalPresetId } from './creative-presets.js';
import { auditGeneratedImage, type GeneratedImageQualityAudit } from './generated-image-quality.js';

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
  controlNet?: { model: string; strength: number; imagePath: string };
  qualityAudit?: GeneratedImageQualityAudit;
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
  controlNet?: { model: string; imagePath: string; strength?: number; startPercent?: number; endPercent?: number };
  characterCount?: number;
}

export async function generateAiBackground(
  input: GenerateAiBackgroundInput,
): Promise<{ asset: ManagedAssetRef | null; report: AiGenerationReport }> {
  const engineId = input.imageAdapter.id;
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
  });
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
        ...(input.lora
          ? {
              lora: {
                model: input.lora.model,
                strengthModel: input.lora.strengthModel ?? 1,
                strengthClip: input.lora.strengthClip ?? input.lora.strengthModel ?? 1,
              },
            }
          : {}),
        ...(controlNetPayload ? { controlNet: controlNetPayload } : {}),
        ...(input.characterCount !== undefined ? { characterCount: input.characterCount } : {}),
        ...(attemptRecipe.characterRegions.length > 1 ? { characterRegions: attemptRecipe.characterRegions } : {}),
      });
      const qualityAudit = await auditGeneratedImage(buffer, { expectedWidth: attemptRecipe.width, expectedHeight: attemptRecipe.height });
      lastAudit = qualityAudit;
      if (!qualityAudit.passed) continue;

      const asset = await input.ingestion.ingestBuffer({
        buffer,
        kind: 'image',
        extension: 'png',
        originalName: `ai-gen-${attemptRecipe.preset}-${attemptRecipe.seed}.png`,
      });
      return {
        asset,
        report: {
          status: 'generated',
          engineId,
          message: `Fundo gerado por ${engineId} (preset ${attemptRecipe.preset}, seed ${attemptRecipe.seed}${attempt > 1 ? `, após ${attempt} tentativas` : ''}).`,
          durationMs: Date.now() - started,
          recipe: attemptRecipe,
          ...(input.referenceStrength !== undefined ? { referenceStrength: input.referenceStrength } : {}),
          attempts: attempt,
          ...(input.lora ? { lora: { model: input.lora.model, strengthModel: input.lora.strengthModel ?? 1, strengthClip: input.lora.strengthClip ?? input.lora.strengthModel ?? 1 } } : {}),
          ...(input.controlNet ? { controlNet: { model: input.controlNet.model, strength: input.controlNet.strength ?? 0.65, imagePath: input.controlNet.imagePath } } : {}),
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
      ...(input.lora ? { lora: { model: input.lora.model, strengthModel: input.lora.strengthModel ?? 1, strengthClip: input.lora.strengthClip ?? input.lora.strengthModel ?? 1 } } : {}),
      ...(input.controlNet ? { controlNet: { model: input.controlNet.model, strength: input.controlNet.strength ?? 0.65, imagePath: input.controlNet.imagePath } } : {}),
      ...(lastAudit ? { qualityAudit: lastAudit } : {}),
    },
  };
}
