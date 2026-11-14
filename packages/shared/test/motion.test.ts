import { describe, expect, it } from 'vitest';
import { motionProjectSchema } from '../src/index.js';

describe('motion image backgrounds', () => {
  it('accepts a bounded JPEG data URL as the background of a text scene', () => {
    const project = motionProjectSchema.parse({
      schemaVersion: 2, templateId: 'velix-base', templateVersion: 1, width: 1920, height: 1080, fps: 30,
      scenes: [{ id: 'scene-1', durationInFrames: 30, transition: 'cut', kind: 'title', text: 'Texto', background: { kind: 'image', assetRef: 'data:image/jpeg;base64,fixture', dim: 0.5 } }],
      captions: [], style: { background: { kind: 'gradient', from: '#183b42', to: '#102126', angle: 135 }, font: 'inter', accent: '#ff6a00', preset: 'base' }, narration: null, licenses: [],
    });
    expect(project.schemaVersion).toBe(2);
  });
});
