import { describe, expect, it } from 'vitest';
import { resolveGenerationQualityProfile } from '../src/generation-profiles.js';

describe('generation quality profiles', () => {
  it('keeps preview a single pass and makes professional upscale with FaceDetailer opt-in', () => {
    expect(resolveGenerationQualityProfile('preview')).toEqual({ id: 'preview', faceDetailer: null, upscale: null });
    expect(resolveGenerationQualityProfile('professional')).toEqual({ id: 'professional', faceDetailer: null, upscale: { model: '4x-UltraSharp.pth' } });
    expect(resolveGenerationQualityProfile('professional', { faceDetailer: { denoise: 0.3 }, upscale: false })).toEqual({
      id: 'professional',
      faceDetailer: { detectorModel: 'bbox/face_yolov8m.pt', guideSize: 512, denoise: 0.3 },
      upscale: null,
    });
  });
});
