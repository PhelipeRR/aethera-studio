import { describe, expect, it } from 'vitest';
import { buildCharacterGenerationBrief, planMultiCharacterComposition, validateCharacterRegions } from '../src/multi-character-composition.js';
import { buildVisualRecipe } from '../src/visual-recipe.js';

describe('multi-character composition planning', () => {
  it('allocates non-overlapping regions for one to eight characters', () => {
    for (const count of [1, 2, 3, 4, 8]) {
      const plan = planMultiCharacterComposition({ width: 1280, height: 720, characterCount: count });
      expect(plan.regions).toHaveLength(count);
      expect(validateCharacterRegions(plan)).toEqual({ ok: true, errors: [] });
    }
  });

  it('assigns readable anchors and an actionable per-region generation brief', () => {
    const plan = planMultiCharacterComposition({ width: 1280, height: 720, characterCount: 2 });
    expect(plan.regions.map((region) => region.anchor)).toEqual(['left', 'right']);
    expect(buildCharacterGenerationBrief(plan.regions[0]!, 'anime warrior with blue energy')).toMatch(/isolated character region/i);
    expect(buildCharacterGenerationBrief(plan.regions[0]!, 'anime warrior with blue energy')).toMatch(/left/i);
  });

  it('rejects invalid counts and overlapping regions', () => {
    expect(() => planMultiCharacterComposition({ width: 1280, height: 720, characterCount: 0 })).toThrow(/between 1 and 8/i);
    const plan = planMultiCharacterComposition({ width: 1280, height: 720, characterCount: 2 });
    const broken = { ...plan, regions: [plan.regions[0]!, { ...plan.regions[1]!, x: plan.regions[0]!.x }] };
    expect(validateCharacterRegions(broken).ok).toBe(false);
  });

  it('carries the regional plan into the visual recipe', () => {
    const recipe = buildVisualRecipe({ artType: 'thumbnail', prompt: 'anime duel', characterCount: 2 });
    expect(recipe.characterCount).toBe(2);
    expect(recipe.characterRegions).toHaveLength(2);
    expect(recipe.positivePrompt).toMatch(/2 distinct isolated character regions/i);
  });
});
