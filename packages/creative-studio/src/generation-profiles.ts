/**
 * Generation quality profiles. `preview` is the single fast pass used to judge composition; `professional` adds the
 * Impact Pack FaceDetailer pass and, when the document is larger than the generation, a model upscale. Both are
 * configurable: a refinement that hurts a case can be switched off per request instead of being forced on.
 */

export type GenerationQualityProfileId = 'preview' | 'professional';

export interface FaceDetailerSettings {
  detectorModel: string;
  guideSize?: number;
  maxSize?: number;
  denoise?: number;
}

export interface GenerationQualityProfile {
  id: GenerationQualityProfileId;
  faceDetailer: FaceDetailerSettings | null;
  upscale: { model: string } | null;
}

export const DEFAULT_FACE_DETECTOR = 'bbox/face_yolov8m.pt';
export const DEFAULT_UPSCALE_MODEL = '4x-UltraSharp.pth';

export interface GenerationQualityOverrides {
  faceDetailer?: false | Partial<FaceDetailerSettings>;
  upscale?: false | { model: string };
}

export function resolveGenerationQualityProfile(id: GenerationQualityProfileId, overrides: GenerationQualityOverrides = {}): GenerationQualityProfile {
  if (id === 'preview') {
    return {
      id,
      faceDetailer: overrides.faceDetailer ? { detectorModel: DEFAULT_FACE_DETECTOR, ...overrides.faceDetailer } : null,
      upscale: overrides.upscale ? overrides.upscale : null,
    };
  }
  return {
    id,
    // denoise 0.35 / guide 512 is the setting validated on Animagine in the bootstrap FaceDetailer run.
    faceDetailer: overrides.faceDetailer === false ? null : { detectorModel: DEFAULT_FACE_DETECTOR, guideSize: 512, denoise: 0.35, ...(overrides.faceDetailer ?? {}) },
    upscale: overrides.upscale === false ? null : overrides.upscale ?? { model: DEFAULT_UPSCALE_MODEL },
  };
}
