/**
 * Generation quality profiles. `preview` is the single fast pass used to judge composition; `professional` adds the
 * model upscale when the document is larger than the generation, and an opt-in Impact Pack FaceDetailer pass. Both are
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
    // FaceDetailer is opt-in. CS9 run run-cs9-2026-11-17T1050 (same graph execution, base vs refined): 0% pixels
    // changed on the 2/3/8-character scenes (faces too small for the detector), marginal change on the anime close-up
    // and worse eyes on the gamer close-up. Pass `faceDetailer: {}` to enable it (denoise 0.35 / guide 512).
    faceDetailer: overrides.faceDetailer ? { detectorModel: DEFAULT_FACE_DETECTOR, guideSize: 512, denoise: 0.35, ...overrides.faceDetailer } : null,
    upscale: overrides.upscale === false ? null : overrides.upscale ?? { model: DEFAULT_UPSCALE_MODEL },
  };
}
