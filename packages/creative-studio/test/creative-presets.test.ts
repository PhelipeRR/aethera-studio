import { describe, expect, it } from 'vitest';
import { getProfessionalPreset, listProfessionalPresets, resolveProfessionalPreset } from '../src/creative-presets.js';
import { buildVisualRecipe } from '../src/visual-recipe.js';

describe('professional creative presets', () => {
  it('ships the requested production profiles with explicit engine controls', () => {
    const presets = listProfessionalPresets();
    expect(presets.map((preset) => preset.id)).toEqual([
      'anime_premium_cinematic',
      'anime_cinematic',
      'gaming_cinematic',
      'cyberpunk_neon',
      'youtube_thumbnail_1280x720',
      'banner_2560x1440',
    ]);
    expect(getProfessionalPreset('cyberpunk_neon')).toMatchObject({
      artType: 'thumbnail',
      width: 1280,
      height: 720,
      samplerName: 'dpmpp_2m',
      scheduler: 'karras',
    });
  });

  it('resolves a stable default from art type and brief without guessing a model', () => {
    expect(resolveProfessionalPreset('banner', 'NextWorth gaming channel')).toBe('banner_2560x1440');
    expect(resolveProfessionalPreset('thumbnail', 'anime cinematic battle')).toBe('anime_cinematic');
    expect(resolveProfessionalPreset('thumbnail', 'cyberpunk neon city')).toBe('cyberpunk_neon');
    expect(resolveProfessionalPreset('avatar', 'mascot')).toBe('youtube_thumbnail_1280x720');
  });

  it('carries an explicit professional preset into the recipe and engine controls', () => {
    const recipe = buildVisualRecipe({ artType: 'thumbnail', prompt: 'neon hero', professionalPreset: 'cyberpunk_neon' });
    expect(recipe).toMatchObject({
      professionalPreset: 'cyberpunk_neon',
      steps: 12,
      cfg: 5.2,
      samplerName: 'dpmpp_2m',
      scheduler: 'karras',
    });
    expect(recipe.positivePrompt).toContain('cinematic cyberpunk neon key art');
    expect(recipe.negativePrompt).toContain('neon signage');
  });
});
