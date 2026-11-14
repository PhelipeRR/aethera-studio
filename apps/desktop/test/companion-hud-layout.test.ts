import { describe, expect, it } from 'vitest';
import { anchorForDrop, boundsForMode, clampToArea, defaultAnchor, HUD_SIZES, hudStage, shouldCollapseOnBlur, snapToArea, workAreaFor, type Rect } from '../src/main/companion-hud-layout.js';

const primary: Rect = { x: 0, y: 0, width: 1920, height: 1040 };
// A second monitor to the left, with negative coordinates, and one above it: both are common Windows layouts.
const left: Rect = { x: -1280, y: 100, width: 1280, height: 680 };
const above: Rect = { x: 0, y: -1080, width: 1920, height: 1040 };
const areas = [primary, left, above];

describe('Companion HUD layout', () => {
  it('collapses only the expanded HUD when it loses focus', () => {
    expect(shouldCollapseOnBlur('expanded')).toBe(true);
    expect(shouldCollapseOnBlur('compact')).toBe(false);
    expect(shouldCollapseOnBlur('mascot')).toBe(false);
  });

  it('fits every mode inside a small work area', () => {
    for (const size of Object.values(HUD_SIZES)) { expect(size.width).toBeLessThanOrEqual(1024); expect(size.height).toBeLessThanOrEqual(600); }
  });

  it('starts in the bottom right corner of the primary monitor', () => {
    const bounds = boundsForMode(null, 'mascot', areas, primary);
    expect(bounds).toEqual({ ...defaultAnchor(primary), ...HUD_SIZES.mascot });
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1920);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(1040);
  });

  it('keeps the mascot in place on a roomy monitor, so modes grow from it', () => {
    expect(boundsForMode({ x: 200, y: 200 }, 'expanded', areas, primary)).toMatchObject({ x: 200, y: 200 });
  });

  it('pushes a mode back onto the monitor without changing the anchor', () => {
    const anchor = { x: 1780, y: 900 };
    const expanded = boundsForMode(anchor, 'expanded', areas, primary);
    expect(expanded.x + expanded.width).toBe(1920);
    expect(expanded.y + expanded.height).toBe(1040);
    expect(boundsForMode(anchor, 'mascot', areas, primary)).toMatchObject(anchor);
  });

  it('keeps the HUD on the monitor it was left on, with negative coordinates', () => {
    expect(workAreaFor({ x: -600, y: 300, ...HUD_SIZES.mascot }, areas)).toBe(left);
    expect(boundsForMode({ x: -600, y: 300 }, 'expanded', areas, primary)).toMatchObject({ x: -820, y: 300 });
    expect(boundsForMode({ x: 40, y: -700 }, 'compact', areas, primary)).toMatchObject({ x: 40, y: -700 });
  });

  it('recovers when the monitor it was on is gone', () => {
    const bounds = boundsForMode({ x: -600, y: 300 }, 'mascot', [primary], primary);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBe(300);
  });

  it('uses the nearest monitor for a position off every monitor', () => {
    expect(workAreaFor({ x: 4000, y: 300, width: 10, height: 10 }, areas)).toBe(primary);
    expect(workAreaFor({ x: -3000, y: 300, width: 10, height: 10 }, areas)).toBe(left);
  });

  it('snaps to a nearby edge and leaves other drops alone', () => {
    const size = HUD_SIZES.mascot;
    expect(snapToArea({ x: 9, y: 500 }, size, primary)).toEqual({ x: 0, y: 500 });
    expect(snapToArea({ x: 1920 - size.width - 9, y: 1040 - size.height - 9 }, size, primary)).toEqual({ x: 1920 - size.width, y: 1040 - size.height });
    expect(snapToArea({ x: 400, y: 500 }, size, primary)).toEqual({ x: 400, y: 500 });
  });

  it('rounds to whole DIPs, since fractional scaling can produce fractions', () => {
    expect(clampToArea({ x: 100.6, y: 200.2 }, HUD_SIZES.mascot, primary)).toEqual({ x: 101, y: 200 });
  });

  it('pins to the origin when the window is larger than the area', () => {
    expect(clampToArea({ x: 50, y: 50 }, HUD_SIZES.expanded, { x: 10, y: 20, width: 500, height: 300 })).toEqual({ x: 10, y: 20 });
  });

  it('keeps the stage fixed and places the mascot inside it at the default anchor', () => {
    const { bounds, layout } = hudStage({ x: 1764, y: 892 }, areas, primary);
    expect(bounds).toEqual({ x: 1100, y: 600, width: 820, height: 440 });
    expect(layout).toEqual({ mascot: { x: 664, y: 292 }, compact: { x: 366, y: 292 }, side: 'right' });
  });

  it('grows to the right on a roomy monitor', () => {
    expect(hudStage({ x: 200, y: 200 }, areas, primary).layout).toEqual({ mascot: { x: 0, y: 0 }, compact: { x: 0, y: 0 }, side: 'left' });
  });

  it('keeps the mascot on screen when its monitor is gone', () => {
    const { bounds, layout } = hudStage({ x: -600, y: 300 }, [primary], primary);
    expect(bounds.x + layout.mascot.x).toBeGreaterThanOrEqual(0);
  });

  it('works on a monitor with negative coordinates', () => {
    const { bounds, layout } = hudStage({ x: -200, y: 300 }, areas, primary);
    expect(bounds.x).toBe(-820);
    expect(layout).toEqual({ mascot: { x: 620, y: 0 }, compact: { x: 322, y: 0 }, side: 'right' });
  });

  it('keeps the capsule inside the stage wherever the mascot is', () => {
    for (const anchor of [{ x: 0, y: 0 }, { x: 1788, y: 916 }, { x: 900, y: 500 }, { x: 1400, y: 700 }]) {
      const { layout } = hudStage(anchor, areas, primary);
      expect(layout.compact.x).toBeGreaterThanOrEqual(0);
      expect(layout.compact.x + HUD_SIZES.compact.width).toBeLessThanOrEqual(HUD_SIZES.expanded.width);
      expect(layout.compact.x <= layout.mascot.x && layout.mascot.x + HUD_SIZES.mascot.width <= layout.compact.x + HUD_SIZES.compact.width).toBe(true);
    }
  });

  it('pins the stage to a work area smaller than itself', () => {
    const small: Rect = { x: 10, y: 20, width: 500, height: 300 };
    const { bounds, layout } = hudStage({ x: 300, y: 200 }, [small], small);
    expect(bounds).toMatchObject({ x: 10, y: 20 });
    expect(bounds.x + layout.mascot.x + HUD_SIZES.mascot.width).toBeLessThanOrEqual(510);
  });

  it('keeps a right-aligned capsule under the mascot all the way across the monitor', () => {
    const wide: Rect = { x: 0, y: 0, width: 2560, height: 1040 };
    for (const x of [2000, 1600, 1000, 500]) {
      const { bounds, layout } = hudStage({ x, y: 400 }, [wide], wide, 'right');
      expect(layout.side).toBe('right');
      expect(bounds.x + layout.mascot.x).toBe(x);
      expect(bounds.x + layout.compact.x + HUD_SIZES.compact.width).toBe(x + HUD_SIZES.mascot.width);
    }
  });

  it('flips only when the capsule has no room on the aligned side', () => {
    expect(hudStage({ x: 100, y: 400 }, areas, primary, 'right').layout.side).toBe('left');
    expect(hudStage({ x: 1600, y: 400 }, areas, primary, 'left').layout.side).toBe('right');
  });

  it('keeps a capsule side that still fits once the stage is pinned to the edge', () => {
    const wide: Rect = { x: 0, y: 0, width: 2560, height: 1040 };
    const { bounds, layout } = hudStage({ x: 2100, y: 400 }, [wide], wide, 'left');
    expect(layout.side).toBe('left');
    expect(bounds.x + layout.compact.x).toBe(2100);
  });

  it('never moves a dropped panel, and keeps its mascot on the side it was on', () => {
    for (const align of ['left', 'right'] as const) {
      for (const dropped of [{ x: 300, y: 200 }, { x: 1000, y: 300 }, { x: 1100, y: 600 }]) {
        const { bounds, layout } = hudStage(anchorForDrop(dropped, align), areas, primary, align);
        expect({ x: bounds.x, y: bounds.y }).toEqual(dropped);
        expect(layout.side).toBe(align);
      }
    }
  });
});
