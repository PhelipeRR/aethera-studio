import { describe, expect, it } from 'vitest';
import { AETHERA_COMPOSITION_VERSION, scoreShotExplainable, wipeTransitionClipPath } from '../src/aethera-timeline-composition.js';

describe('SD-2.4 VFX and SD-3 transitions / explainable scoring', () => {
  it('bumps composition version to 7', () => {
    expect(AETHERA_COMPOSITION_VERSION).toBe(7);
  });

  it('computes directional wipe clip paths', () => {
    expect(wipeTransitionClipPath('left', 0)).toBe('inset(0 0% 0 0)');
    expect(wipeTransitionClipPath('left', 0.5)).toBe('inset(0 50% 0 0)');
    expect(wipeTransitionClipPath('right', 0.25)).toBe('inset(0 0 0 25%)');
    expect(wipeTransitionClipPath('up', 1)).toBe('inset(0 0 100% 0)');
    expect(wipeTransitionClipPath('down', 0.4)).toBe('inset(40% 0 0 0)');
  });

  it('scores shots with explainable breakdown and human-readable reasons', () => {
    const high = scoreShotExplainable(
      { id: 'shot-a', relevanceScore: 0.9, edgeCalmness: 0.8, durationMs: 5000, width: 1920, height: 1080, depiction: 'record' },
      { neededDurationMs: 4000, preferredDepiction: 'record', hasOnScreenText: true },
    );
    const low = scoreShotExplainable(
      { id: 'shot-b', relevanceScore: 0.3, edgeCalmness: 0.2, durationMs: 1000, width: 854, height: 480, depiction: 'illustrative' },
      { neededDurationMs: 4000, preferredDepiction: 'record', hasOnScreenText: true },
    );

    expect(high.total).toBeGreaterThan(low.total);
    expect(high.reasons.length).toBeGreaterThanOrEqual(4);
    expect(high.breakdown.resolutionFit).toBe(10);
  });
});
