import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { buildVisualRecipe } from '../src/visual-recipe.js';
import {
  buildSemanticCriteria,
  evaluateSemanticSceneGate,
  type SemanticEvaluationAdapter,
} from '../src/semantic-scene-gate.js';

function recipeFor(characters: string[], prompt = 'two original anime warriors in a ruined mountain fortress'): ReturnType<typeof buildVisualRecipe> {
  return buildVisualRecipe({
    artType: 'thumbnail',
    prompt,
    characterCount: characters.length,
    characterDescriptions: characters,
    direction: {
      subject: prompt,
      setting: 'ruined mountain fortress at sunset',
      lighting: 'warm sunset rim light',
      style: 'polished anime key visual',
    },
    seed: 41001,
  });
}

async function imageBuffer(): Promise<Buffer> {
  return sharp({ create: { width: 1344, height: 768, channels: 3, background: '#243044' } }).png().toBuffer();
}

function evaluator(score: number, margin = score - 0.25, offTopic = false): SemanticEvaluationAdapter {
  return {
    async evaluateImageSemantics(request) {
      return {
        evaluatorId: 'test-local-clip',
        positiveScore: score,
        negativeScore: score - margin,
        margin,
        isOffTopic: offTopic,
        matchedLabel: request.positiveConcepts[0] ?? 'local criterion',
        rationale: 'controlled local evaluator evidence',
        evidenceScope: request.evidenceBbox ? 'localized' : 'generic',
      };
    },
  };
}

describe('Semantic Scene Gate prompt criteria', () => {
  it('extracts only prompt-required weapon and clothing criteria', () => {
    const recipe = recipeFor([
      'young swordswoman with long silver hair and red scarf, white and crimson armor, katana raised',
      'tall spear warrior with short black hair, dark blue plated armor, spear held in guard',
    ]);

    const criteria = buildSemanticCriteria(recipe);

    expect(criteria.some((criterion) => criterion.kind === 'object' && /katana/i.test(criterion.requirement))).toBe(true);
    expect(criteria.some((criterion) => criterion.kind === 'wardrobe' && /armor/i.test(criterion.requirement))).toBe(true);
    expect(criteria.filter((criterion) => criterion.regionIndex === 0).every((criterion) => criterion.sourcePrompt === recipe.characterRegions[0]?.prompt)).toBe(true);
  });

  it('does not create an absent-object failure when the prompt does not require a weapon', () => {
    const recipe = recipeFor([
      'young warrior with long silver hair and red scarf, white and crimson armor',
      'tall warrior with short black hair and dark blue plated armor',
    ], 'two original anime warriors standing together in a ruined mountain fortress');

    const criteria = buildSemanticCriteria(recipe);

    expect(criteria.some((criterion) => criterion.kind === 'object')).toBe(false);
    expect(criteria.some((criterion) => /weapon|sword|katana|spear|rifle/i.test(criterion.requirement))).toBe(false);
  });

  it('keeps region and scene source prompts in the evidence', () => {
    const recipe = recipeFor(['red-cloaked guardian', 'blue-cloaked guardian']);
    const criteria = buildSemanticCriteria(recipe);

    expect(criteria.find((criterion) => criterion.scope === 'scene')?.sourcePrompt).toBe(recipe.scenePrompt);
    expect(criteria.filter((criterion) => criterion.kind === 'character')).toHaveLength(2);
  });

  it('binds each required attribute to the correct character crop and uses attribute-only probes', () => {
    const recipe = recipeFor([
      'young swordswoman with long silver hair and red scarf, white and crimson armor, katana raised',
      'tall spear warrior with short black hair, dark blue plated armor, spear held in guard',
    ]);
    const criteria = buildSemanticCriteria(recipe);
    const katana = criteria.find((criterion) => criterion.id === 'character-1-object-katana');
    const armor = criteria.find((criterion) => criterion.id === 'character-1-wardrobe-armor');

    expect(katana).toMatchObject({
      regionIndex: 0,
      positiveConcepts: ['katana'],
      evidenceBbox: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number) }),
    });
    expect(katana?.negativeConcepts).toContain('empty hands');
    expect(armor?.positiveConcepts).toEqual(['armor']);
    expect(armor?.evidenceBbox?.y).toBeGreaterThan(katana?.evidenceBbox?.y ?? -1);
    expect(katana?.sourcePrompt).toContain('katana');
    expect(katana?.positiveConcepts.join(' ')).not.toContain('swordswoman');
  });
});

describe('Semantic Scene Gate evidence policy', () => {
  it('confirms strong local evidence while keeping human review pending', async () => {
    const result = await evaluateSemanticSceneGate({
      imageBuffer: await imageBuffer(),
      recipe: recipeFor(['swordswoman with katana raised', 'spear warrior with spear held']),
      adapter: evaluator(0.86, 0.42),
    });

    expect(result.verdict).toBe('passed_pending_human_review');
    expect(result.criteria.every((criterion) => criterion.status === 'confirmed')).toBe(true);
    expect(result.criteria.every((criterion) => criterion.evaluatorId === 'test-local-clip')).toBe(true);
  });

  it('keeps ambiguous local evidence in review instead of rejecting it', async () => {
    const result = await evaluateSemanticSceneGate({
      imageBuffer: await imageBuffer(),
      recipe: recipeFor(['swordswoman with katana raised', 'spear warrior with spear held']),
      adapter: evaluator(0.53, 0.01),
    });

    expect(result.verdict).toBe('needs_review');
    expect(result.criteria.some((criterion) => criterion.status === 'uncertain')).toBe(true);
    expect(result.failureCategories.semantic).toContain('insufficient_semantic_evidence');
  });

  it('does not confirm an attribute from a generic or mismatched evaluator label', async () => {
    const requests: Array<{ criterionKind: string | undefined; regionIndex: number | null | undefined; evidenceBbox: unknown | undefined }> = [];
    const result = await evaluateSemanticSceneGate({
      imageBuffer: await imageBuffer(),
      recipe: recipeFor(['swordswoman with katana raised', 'spear warrior with spear held']),
      adapter: {
        async evaluateImageSemantics(request) {
          requests.push({ criterionKind: request.criterionKind, regionIndex: request.regionIndex, evidenceBbox: request.evidenceBbox });
          return {
            evaluatorId: 'test-generic-clip',
            positiveScore: 0.88,
            negativeScore: 0.2,
            margin: 0.68,
            isOffTopic: false,
            matchedLabel: 'generic character portrait',
            rationale: 'generic prompt-only evidence',
            evidenceScope: 'generic',
          };
        },
      },
    });

    const katana = result.criteria.find((criterion) => criterion.id === 'character-1-object-katana');
    expect(katana).toMatchObject({ status: 'uncertain', reason: expect.stringContaining('Localized') });
    expect(requests.some((request) => request.criterionKind === 'object' && request.regionIndex === 0 && request.evidenceBbox)).toBe(true);
    expect(result.verdict).toBe('needs_review');
  });

  it('offers a bounded repair candidate for an uncertain required attribute without rejecting it', async () => {
    const result = await evaluateSemanticSceneGate({
      imageBuffer: await imageBuffer(),
      recipe: recipeFor(['swordswoman with katana raised', 'spear warrior with spear held']),
      adapter: evaluator(0.58, 0.3),
    });

    expect(result.verdict).toBe('needs_review');
    expect(result.criteria.some((criterion) => criterion.status === 'uncertain' && criterion.kind === 'object')).toBe(true);
    expect(result.repairCandidates.some((candidate) => candidate.criterionId.includes('object') && candidate.bbox.width > 0)).toBe(true);
  });

  it('records evaluator failure as uncertainty and never as proof of absence', async () => {
    const result = await evaluateSemanticSceneGate({
      imageBuffer: await imageBuffer(),
      recipe: recipeFor(['unarmed guardian', 'unarmed scout']),
      adapter: {
        async evaluateImageSemantics() {
          throw new Error('local CLIP unavailable');
        },
      },
    });

    expect(result.verdict).toBe('needs_review');
    expect(result.criteria.every((criterion) => criterion.status === 'uncertain')).toBe(true);
    expect(result.criteria.some((criterion) => criterion.reason.includes('local CLIP unavailable'))).toBe(true);
    expect(result.failureCategories.semantic).not.toContain('missing_required_object');
  });

  it('rejects only a strong explicit contradiction and preserves its evidence', async () => {
    const result = await evaluateSemanticSceneGate({
      imageBuffer: await imageBuffer(),
      recipe: recipeFor(['swordswoman with katana raised', 'spear warrior with spear held']),
      adapter: evaluator(0.08, -0.2, true),
    });

    expect(result.verdict).toBe('rejected');
    expect(result.criteria.some((criterion) => criterion.status === 'failed')).toBe(true);
    expect(result.failureCategories.semantic).toContain('contradictory_prompt_evidence');
    expect(result.criteria[0]).toMatchObject({ sourcePrompt: expect.any(String), score: 0.08, margin: -0.2, rationale: expect.any(String) });
  });

  it('rejects a character proven translucent by its alpha mask and keeps boundary clipping in review', async () => {
    const raw = Buffer.alloc(120 * 80 * 4);
    for (let y = 10; y < 70; y += 1) {
      for (let x = 40; x < 80; x += 1) {
        const offset = (y * 120 + x) * 4;
        raw[offset] = 220;
        raw[offset + 1] = 80;
        raw[offset + 2] = 80;
        raw[offset + 3] = 90;
      }
    }
    const semiCharacter = await sharp(raw, { raw: { width: 120, height: 80, channels: 4 } }).png().toBuffer();
    const result = await evaluateSemanticSceneGate({
      imageBuffer: semiCharacter,
      recipe: recipeFor(['unarmed guardian']),
      evidence: {
        width: 120,
        height: 80,
        detectors: { yolo_person: { boxes: [{ x: 40, y: 10, width: 40, height: 60, confidence: 0.95 }] } },
      },
      adapter: evaluator(0.86, 0.42),
    });

    expect(result.verdict).toBe('rejected');
    expect(result.observations).toContainEqual(expect.objectContaining({ code: 'translucent_character', status: 'confirmed' }));

    const clipped = await evaluateSemanticSceneGate({
      imageBuffer: await imageBuffer(),
      recipe: recipeFor(['unarmed guardian']),
      evidence: {
        width: 1344,
        height: 768,
        detectors: { yolo_person: { boxes: [{ x: 0, y: 20, width: 280, height: 600, confidence: 0.95 }] } },
      },
      adapter: evaluator(0.86, 0.42),
    });
    expect(clipped.verdict).toBe('needs_review');
    expect(clipped.observations).toContainEqual(expect.objectContaining({ code: 'incomplete_character', status: 'uncertain' }));
  });
});
