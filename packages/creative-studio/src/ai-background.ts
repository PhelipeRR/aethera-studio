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
  const started = Date.now();
  try {
    const buffer = await input.imageAdapter.generateImage({
      prompt: recipe.positivePrompt,
      negativePrompt: recipe.negativePrompt,
      seed: recipe.seed,
      width: recipe.width,
      height: recipe.height,
      steps: recipe.steps,
      cfg: recipe.cfg,
      samplerName: recipe.samplerName,
      scheduler: recipe.scheduler,
      preset: recipe.professionalPreset,
      ...(input.referenceImagePaths?.length ? { referenceImagePaths: input.referenceImagePaths } : {}),
      ...(input.characterCount !== undefined ? { characterCount: input.characterCount } : {}),
      ...(recipe.characterRegions.length > 1 ? { characterRegions: recipe.characterRegions } : {}),
    });
    const qualityAudit = await auditGeneratedImage(buffer, { expectedWidth: recipe.width, expectedHeight: recipe.height });
    if (!qualityAudit.passed) {
      return {
        asset: null,
        report: {
          status: 'failed',
          engineId,
          message: `A auditoria estrutural rejeitou a imagem gerada: ${qualityAudit.findings.map((finding) => finding.message).join(' ')}`,
          durationMs: Date.now() - started,
          recipe,
          qualityAudit,
        },
      };
    }
    const asset = await input.ingestion.ingestBuffer({
      buffer,
      kind: 'image',
      extension: 'png',
      originalName: `ai-gen-${recipe.preset}-${recipe.seed}.png`,
    });
    return {
      asset,
      report: {
        status: 'generated',
        engineId,
        message: `Fundo gerado por ${engineId} (preset ${recipe.preset}, seed ${recipe.seed}).`,
        durationMs: Date.now() - started,
        recipe,
        qualityAudit,
      },
    };
  } catch (error) {
    return {
      asset: null,
      report: {
        status: 'failed',
        engineId,
        message: `Falha na geração por IA (${error instanceof Error ? error.message : String(error)}); a arte usou o fundo da paleta.`,
        durationMs: Date.now() - started,
        recipe,
      },
    };
  }
}
