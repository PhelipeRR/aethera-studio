import { describe, expect, it } from 'vitest';
import { bubblePlacement, dragTilt, followsPlayback, HUD_MS, HUD_SPRING, hudTargets, hudTransition, nextBlinkDelay, speechLevel, gazeOffset } from '../src/renderer/src/features/companion/companion-motion';

const left = { origin: { x: 0, y: 0 }, mascot: { x: 0, y: 0 }, compact: { x: 0, y: 0 }, side: 'left' } as const;
const right = { origin: { x: 1100, y: 600 }, mascot: { x: 664, y: 292 }, compact: { x: 366, y: 292 }, side: 'right' } as const;

describe('HUD motion targets', () => {
  it('keeps the shipped geometry with the mascot on the left', () => {
    expect(hudTargets(left, 'mascot')).toEqual({ shell: { x: 10, y: 10, width: 112, height: 104, radius: 52, surface: 0 }, mascot: { x: 14, y: 12, scale: 1 } });
    expect(hudTargets(left, 'compact').shell).toEqual({ x: 12, y: 24, width: 406, height: 80, radius: 40, surface: 1 });
    expect(hudTargets(left, 'compact').mascot).toEqual({ x: 18, y: 16, scale: 1 });
    expect(hudTargets(left, 'expanded').shell).toEqual({ x: 12, y: 12, width: 796, height: 416, radius: 26, surface: 1 });
    expect(hudTargets(left, 'expanded').mascot).toMatchObject({ x: 28, y: 22 });
  });

  it('leaves the mascot exactly at its anchor in mascot mode', () => {
    expect(hudTargets(right, 'mascot').mascot).toEqual({ x: 678, y: 304, scale: 1 });
    expect(hudTargets(right, 'mascot').shell).toMatchObject({ x: 674, y: 302 });
  });

  it('mirrors the mascot inside the capsule and the panel', () => {
    expect(hudTargets(right, 'compact').mascot).toEqual({ x: 674, y: 308, scale: 1 });
    expect(hudTargets(right, 'compact').shell).toMatchObject({ x: 378, y: 316 });
    expect(hudTargets(right, 'expanded').mascot).toEqual({ x: 708, y: 22, scale: 84 / 104 });
  });
});

describe('HUD transitions', () => {
  it('uses the expansion spring to grow and the contraction spring to shrink', () => {
    expect(hudTransition('mascot', 'expanded', false)).toMatchObject({ type: 'spring', ...HUD_SPRING.expand });
    expect(hudTransition('expanded', 'compact', false)).toMatchObject({ type: 'spring', ...HUD_SPRING.collapse });
  });

  it('does not move at all under reduced motion', () => {
    expect(hudTransition('mascot', 'expanded', true)).toEqual({ duration: 0 });
  });

  it('holds the agreed timing tokens', () => {
    expect(HUD_MS).toEqual({ hover: 180, micro: 150, content: 220, session: 280, face: 140 });
  });
});

describe('Playback progress', () => {
  it('glides only while time simply passes', () => {
    expect(followsPlayback(30_000, 31_000, true)).toBe(true);
    expect(followsPlayback(30_000, 31_000, false)).toBe(false);
    expect(followsPlayback(30_000, 90_000, true)).toBe(false);
    expect(followsPlayback(90_000, 30_000, true)).toBe(false);
  });
});

describe('Suggestion bubble placement', () => {
  it('rises from a mascot low on the stage, with the tail on its side', () => {
    expect(bubblePlacement(right)).toEqual({ opens: 'up', side: 'right', vertical: 148, horizontal: 24 });
  });

  it('hangs below a mascot at the top of the stage', () => {
    expect(bubblePlacement(left)).toEqual({ opens: 'down', side: 'left', vertical: 124, horizontal: 8 });
  });

  it('stays inside the stage on a side that has little room', () => {
    expect(bubblePlacement({ ...right, mascot: { x: 700, y: 292 } }).horizontal).toBe(8);
  });
});

describe('Drag tilt', () => {
  it('leans with the speed and stops at three degrees', () => {
    expect(dragTilt(0)).toBe(0);
    expect(dragTilt(5000)).toBe(3);
    expect(dragTilt(-5000)).toBe(-3);
  });
});

describe('Blink schedule', () => {
  it('stays between 2.4 and 7 seconds', () => {
    expect(nextBlinkDelay(0)).toBe(2400);
    expect(nextBlinkDelay(1)).toBe(7000);
  });
});

describe('Speech level', () => {
  it('reads silence as zero and a full wave as nearly one', () => {
    expect(speechLevel(new Uint8Array(32).fill(128))).toBe(0);
    expect(speechLevel(Uint8Array.from({ length: 32 }, (_, index) => (index % 2 ? 0 : 255)))).toBeGreaterThan(.95);
  });
});

describe('gazeOffset', () => {
  it('looks toward the pointer, only a little when it is close, and centred when on it', () => {
    expect(gazeOffset({ x: 0, y: 0 }, { x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
    expect(gazeOffset({ x: 0, y: 0 }, { x: 1_000, y: 0 })).toEqual({ x: 8, y: 0 });
    expect(gazeOffset({ x: 0, y: 0 }, { x: 0, y: -1_000 })).toEqual({ x: 0, y: -5 });
    expect(gazeOffset({ x: 0, y: 0 }, { x: 60, y: 0 }).x).toBeLessThan(8);
  });
});

