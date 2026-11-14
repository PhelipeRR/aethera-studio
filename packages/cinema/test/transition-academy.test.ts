import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  AetheraAcademyEngine,
  AetheraEvolutionCore,
  TRANSITION_TECHNIQUE_CATALOG,
  recommendTransitionDecision,
  registerTransitionAcademyCurriculum,
} from '../src/index.js';

describe('Aethera Transition Academy (Catalog, Curriculum & Intelligent Director)', () => {
  it('exposes all 60 techniques across 5 categories with initial state "proposed"', () => {
    expect(TRANSITION_TECHNIQUE_CATALOG).toHaveLength(60);
    const byCategory = TRANSITION_TECHNIQUE_CATALOG.reduce<Record<string, number>>((acc, item) => {
      acc[item.category] = (acc[item.category] ?? 0) + 1;
      return acc;
    }, {});
    expect(byCategory).toEqual({
      narrative_cinematic: 12,
      anime_amv: 12,
      games_tech: 12,
      documentary_storytelling: 12,
      motion_graphics_advanced: 12,
    });
    expect(TRANSITION_TECHNIQUE_CATALOG.every((t) => t.validationState === 'proposed')).toBe(true);
  });

  it('imports the Transition Academy curriculum into AetheraAcademyEngine and answers grounded queries', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'nb-transition-academy-'));
    const core = new AetheraEvolutionCore(join(dir, 'evolution.json'));
    const academy = new AetheraAcademyEngine(core, join(dir, 'academy.json'));
    const reg = await registerTransitionAcademyCurriculum(academy);
    expect(reg.imported).toBe(true);
    expect(reg.materialId).toBeTruthy();

    const answer = academy.askAcademy('corte seco hard_cut anime impacto documentary j_cut');
    expect(answer.sufficientKnowledge).toBe(true);
    expect(answer.citations.length).toBeGreaterThan(0);
  });

  it('justifies stylized transitions vs hard cut, enforces anti-repetition, and protects center captions', () => {
    const continuityCut = recommendTransitionDecision({
      genre: 'anime',
      narrativeDelta: 'continuity',
      emotionalIntensity: 0.4,
    });
    expect(continuityCut.technique.techniqueId).toBe('hard_cut');
    expect(continuityCut.whyBetterThanHardCut).toMatch(/Corte seco/i);

    const animeClimax = recommendTransitionDecision({
      genre: 'anime',
      narrativeDelta: 'climax_impact',
      emotionalIntensity: 0.9,
      hasBeatHit: true,
    });
    expect(animeClimax.technique.techniqueId).toBe('white_flash');
    expect(animeClimax.sfxCue).toBe('impact_bright');

    // Anti-repetition: consecutive white_flash must switch to impact_cut
    const nextClimax = recommendTransitionDecision({
      genre: 'anime',
      narrativeDelta: 'climax_impact',
      emotionalIntensity: 0.9,
      hasBeatHit: true,
      previousTransitionId: 'white_flash',
    });
    expect(nextClimax.technique.techniqueId).toBe('impact_cut');

    // Documentary topic shift prefers J-cut
    const docShift = recommendTransitionDecision({
      genre: 'documentary',
      narrativeDelta: 'topic_shift',
      emotionalIntensity: 0.5,
    });
    expect(docShift.technique.techniqueId).toBe('j_cut');
    expect(docShift.timelineKind).toBe('j_cut');

    // Comparison with active center caption avoids split_screen_reveal
    const compWithCaption = recommendTransitionDecision({
      genre: 'curiosities',
      narrativeDelta: 'comparison',
      emotionalIntensity: 0.6,
      hasActiveCaptionInCenter: true,
    });
    expect(compWithCaption.technique.techniqueId).toBe('hard_cut');
  });
});
