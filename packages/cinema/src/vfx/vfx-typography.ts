import type { TimelineEffect } from '../ir/timeline-ir.js';
import type { SafeZoneBox } from '../analysis/media-intelligence.js';
import type { DeliveryFormat } from '../director/cinematography-director.js';

export type VfxEffectKind =
  | 'soft_glow'
  | 'bloom_subtle'
  | 'particles_ambient'
  | 'volumetric_ray'
  | 'chromatic_aberration_light'
  | 'feathered_mask'
  | 'kinetic_caption';

export interface VfxCatalogEntry {
  kind: VfxEffectKind;
  defaultParams: Record<string, number | string | boolean>;
  estimatedCostMs: number;
  fallbackMode: 'skip' | 'cpu_basic' | 'static_frame';
  maxIntensity: number;
}

export const VFX_CATALOG: Record<VfxEffectKind, VfxCatalogEntry> = {
  soft_glow: {
    kind: 'soft_glow',
    defaultParams: { intensity: 0.25, radiusPx: 14 },
    estimatedCostMs: 12,
    fallbackMode: 'skip',
    maxIntensity: 0.6,
  },
  bloom_subtle: {
    kind: 'bloom_subtle',
    defaultParams: { threshold: 0.82, intensity: 0.2 },
    estimatedCostMs: 16,
    fallbackMode: 'skip',
    maxIntensity: 0.5,
  },
  particles_ambient: {
    kind: 'particles_ambient',
    defaultParams: { count: 24, opacity: 0.35 },
    estimatedCostMs: 28,
    fallbackMode: 'static_frame',
    maxIntensity: 0.7,
  },
  volumetric_ray: {
    kind: 'volumetric_ray',
    defaultParams: { angleDeg: 35, opacity: 0.22 },
    estimatedCostMs: 32,
    fallbackMode: 'cpu_basic',
    maxIntensity: 0.55,
  },
  chromatic_aberration_light: {
    kind: 'chromatic_aberration_light',
    defaultParams: { shiftPx: 1.5 },
    estimatedCostMs: 8,
    fallbackMode: 'skip',
    maxIntensity: 0.35,
  },
  feathered_mask: {
    kind: 'feathered_mask',
    defaultParams: { featherPx: 18, invert: false },
    estimatedCostMs: 10,
    fallbackMode: 'cpu_basic',
    maxIntensity: 1.0,
  },
  kinetic_caption: {
    kind: 'kinetic_caption',
    defaultParams: { fontSizePx: 44, maxWordsPerLine: 5 },
    estimatedCostMs: 6,
    fallbackMode: 'cpu_basic',
    maxIntensity: 1.0,
  },
};

export function createTypedVfxEffect(
  effectId: string,
  kind: VfxEffectKind,
  overrides?: Record<string, number | string | boolean>,
): TimelineEffect {
  const spec = VFX_CATALOG[kind];
  const params = { ...spec.defaultParams, ...overrides };
  if (typeof params.intensity === 'number') {
    params.intensity = Math.max(0, Math.min(spec.maxIntensity, params.intensity));
  }
  return {
    effectId,
    kind,
    params,
    enabled: true,
    estimatedCostMs: spec.estimatedCostMs,
    fallbackMode: spec.fallbackMode,
  };
}

export interface TypographyPlacementInput {
  text: string;
  format: DeliveryFormat;
  protectedRegions: SafeZoneBox[];
  durationSec: number;
  contrastRatio?: number;
}

export interface TypographyPlacementResult {
  box: { x: number; y: number; width: number; height: number };
  safeZoneViolation: boolean;
  collidesWithHud: boolean;
  minReadingTimeSec: number;
  readingTimeSufficient: boolean;
  contrastOk: boolean;
}

function boxesOverlap(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/**
 * Computes safe placement and readability gates for kinetic titles, lower-thirds, and subtitles.
 */
export function evaluateTypographyPlacement(input: TypographyPlacementInput): TypographyPlacementResult {
  const words = input.text.trim().split(/\s+/).filter(Boolean).length;
  // ~2.8 words/sec comfortable reading speed + 0.6s visual anchor
  const minReadingTimeSec = Number((words / 2.8 + 0.6).toFixed(2));
  const readingTimeSufficient = input.durationSec >= minReadingTimeSec;
  const contrastOk = (input.contrastRatio ?? 7.5) >= 4.5;

  const safeBounds =
    input.format === 'shorts_9_16'
      ? { x: 0.08, y: 0.14, width: 0.8, height: 0.62 }
      : { x: 0.06, y: 0.08, width: 0.88, height: 0.78 };

  const candidates = [
    { x: 0.1, y: 0.68, width: 0.8, height: 0.12 }, // bottom third
    { x: 0.1, y: 0.16, width: 0.8, height: 0.12 }, // upper third
    { x: 0.1, y: 0.42, width: 0.8, height: 0.12 }, // center fallback
  ];

  const hudBoxes = input.protectedRegions.filter((r) => r.label === 'hud' || r.label === 'face');
  let chosen = candidates[0] ?? { x: 0.1, y: 0.68, width: 0.8, height: 0.12 };
  let collidesWithHud = true;

  for (const cand of candidates) {
    const overlaps = hudBoxes.some((hud) => boxesOverlap(cand, hud));
    if (!overlaps) {
      chosen = cand;
      collidesWithHud = false;
      break;
    }
  }

  const safeZoneViolation =
    chosen.x < safeBounds.x ||
    chosen.y < safeBounds.y ||
    chosen.x + chosen.width > safeBounds.x + safeBounds.width ||
    chosen.y + chosen.height > safeBounds.y + safeBounds.height;

  return {
    box: chosen,
    safeZoneViolation,
    collidesWithHud,
    minReadingTimeSec,
    readingTimeSufficient,
    contrastOk,
  };
}
