export type QualityLevel = 'low' | 'medium' | 'high';
export type QualityChoice = QualityLevel | 'auto';
export type EffectIntensity = 'off' | 'subtle' | 'normal' | 'intense';

export interface QualitySettings {
  /** Decorative brain particles. */
  particles: number;
  /** Particles that are also network nodes (connections and impulses run between them). */
  networkNodes: number;
  /** Ambient impulses alive at once. */
  maxImpulses: number;
  /** Mean new ambient impulses per second at normal intensity. */
  spawnPerSecond: number;
  /** Background bokeh sprites. */
  bokeh: number;
  /** Device pixel ratio cap. */
  pixelRatio: number;
}

/** Starting points; the measured results are recorded in docs/PLAN.md (Fase 19). */
export const QUALITY: Record<QualityLevel, QualitySettings> = {
  low: { particles: 8_000, networkNodes: 1_400, maxImpulses: 40, spawnPerSecond: 7, bokeh: 30, pixelRatio: 1 },
  medium: { particles: 20_000, networkNodes: 3_000, maxImpulses: 120, spawnPerSecond: 16, bokeh: 60, pixelRatio: 1.5 },
  high: { particles: 40_000, networkNodes: 5_000, maxImpulses: 250, spawnPerSecond: 28, bokeh: 90, pixelRatio: 2 },
};

export const QUALITY_LABEL: Record<QualityChoice, string> = { auto: 'Automática', low: 'Baixa', medium: 'Média', high: 'Alta' };
export const INTENSITY_LABEL: Record<EffectIntensity, string> = { off: 'Sem efeitos', subtle: 'Discretos', normal: 'Normais', intense: 'Intensos' };

/** Multiplies ambient impulses and glow; `off` keeps the brain still (real activity still shows). */
export const INTENSITY: Record<EffectIntensity, { ambient: number; glow: number }> = {
  off: { ambient: 0, glow: 0.6 },
  subtle: { ambient: 0.45, glow: 0.8 },
  normal: { ambient: 1, glow: 1 },
  intense: { ambient: 1.7, glow: 1.25 },
};

/** Automatic quality, from the frame rate measured while drawing at medium quality. */
export function chooseAutomaticQuality(fpsAtMedium: number): QualityLevel {
  if (fpsAtMedium >= 55) return 'high';
  if (fpsAtMedium >= 32) return 'medium';
  return 'low';
}
