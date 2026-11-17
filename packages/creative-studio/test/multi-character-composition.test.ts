import { describe, expect, it } from 'vitest';
import { buildCharacterGenerationBrief, planMultiCharacterComposition, validateCharacterRegions } from '../src/multi-character-composition.js';
import { buildVisualRecipe, splitCastDescription, stripGroupWording } from '../src/visual-recipe.js';
import { nearestSdxlBucket } from '../src/checkpoint-profiles.js';

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
    expect(recipe.positivePrompt).toMatch(/2 characters, each clearly separated/i);
    expect(recipe).toMatchObject({ width: 1344, height: 768 });
    const prompts = recipe.characterRegions.map((region) => region.prompt ?? '');
    expect(prompts.every((prompt) => prompt.startsWith('solo, single character, full body'))).toBe(true);
    expect(new Set(prompts).size).toBe(2);
  });

  it('keeps the cast out of the global prompt and gives each region its own character', () => {
    const recipe = buildVisualRecipe({
      artType: 'thumbnail',
      prompt: 'cyberpunk trio',
      characterCount: 3,
      direction: { subject: 'Three distinct cyberpunk heroes: left hooded hacker crouching, center armored brawler standing tall, right cybernetic sniper leaning', setting: 'rain-slick futuristic city' },
    });
    expect(recipe.positivePrompt).not.toMatch(/hacker|brawler|sniper/);
    expect(recipe.characterSource).toBe('derived_from_subject');
    expect(recipe.characterRegions.map((region) => region.prompt)).toEqual([
      expect.stringMatching(/^solo, single character, full body, hooded hacker crouching, /),
      expect.stringMatching(/^solo, single character, full body, armored brawler standing tall, /),
      expect.stringMatching(/^solo, single character, full body, cybernetic sniper leaning, /),
    ]);
    expect(recipe.scenePrompt).toMatch(/rain-slick futuristic city/);
    expect(splitCastDescription('Two warriors: left swordsman lunging; right spear-wielder parrying', 2)).toEqual(['swordsman lunging', 'spear-wielder parrying']);
    expect(splitCastDescription('one lone hero', 2)).toBeNull();
  });

  it('keeps banner characters out of the central title safe area', () => {
    const recipe = buildVisualRecipe({ artType: 'banner', prompt: 'geek banner', characterCount: 2 });
    const zone = recipe.calmZones?.[0];
    expect(zone).toBeDefined();
    for (const region of recipe.characterRegions) {
      const overlaps = region.x < zone!.x + zone!.width && region.x + region.width > zone!.x;
      expect(overlaps).toBe(false);
    }
    expect(buildVisualRecipe({ artType: 'thumbnail', prompt: 'anime close-up' }).calmZones).toBeUndefined();
  });

  it('stages eight characters in alternating rows with one column each', () => {
    const plan = planMultiCharacterComposition({ width: 1344, height: 768, characterCount: 8 });
    expect(plan.layout).toBe('staged');
    expect(new Set(plan.regions.map((region) => region.x)).size).toBe(8);
    expect(plan.regions.every((region) => region.height >= 0.6 * 768 - 1)).toBe(true);
  });

  it('keeps an explicit maxSide and strips group wording from per-character prompts', () => {
    expect(buildVisualRecipe({ artType: 'thumbnail', prompt: 'anime duel', maxSide: 1024 })).toMatchObject({ width: 1024, height: 576 });
    expect(stripGroupWording('two original anime warriors mid-strike')).toBe('original anime warriors mid-strike');
    expect(stripGroupWording('eight distinct heroes arranged in a readable two-row group, varied poses')).toBe('distinct heroes, varied poses');
    expect(nearestSdxlBucket(2560, 1440)).toEqual({ width: 1344, height: 768 });
    expect(nearestSdxlBucket(800, 800)).toEqual({ width: 1024, height: 1024 });
  });
});
