import { describe, expect, it } from 'vitest';
import { fitCalibration, calibratedProbability, evaluateBenchmark } from '../src/aethera-visual.js';

const key = { provider: 'synthetic-vlm', model: 'fixture-v1', promptVersion: 'v1', label: 'combat' as const, datasetVersion: 'synthetic-b1-v1', synthetic: true };
const calibration = [
  { id: 'c1', split: 'calibration' as const, raw: 0.1, correct: false },
  { id: 'c2', split: 'calibration' as const, raw: 0.4, correct: true },
  { id: 'c3', split: 'calibration' as const, raw: 0.6, correct: false },
  { id: 'c4', split: 'calibration' as const, raw: 0.9, correct: true },
];

describe('B-1 calibration and held-out evaluation (synthetic only)', () => {
  it('fits isotonic probabilities on calibration only, pools reversals, and derives thresholds', () => {
    const profile = fitCalibration(key, calibration);
    expect(profile.points.map((point) => point.probability)).toEqual([0, 0.5, 0.5, 1]);
    expect(calibratedProbability(profile, 0.6)).toBe(0.5);
    expect(profile.thresholds).toEqual({ autoAt: 1, reviewAt: 0.5 });
    expect(() => fitCalibration(key, [{ id: 'held-out', split: 'test', raw: 1, correct: true }])).toThrow(/calibration/);
  });

  it('records category, held-out accuracy/F1, ECE, automatic precision and review rate', () => {
    const profile = fitCalibration(key, calibration);
    const record = evaluateBenchmark({ id: 'synthetic-B1-C', category: 'C', profile, samples: [
      { id: 't1', split: 'test', raw: 0.9, expected: 'combat', predicted: 'combat' },
      { id: 't2', split: 'test', raw: 0.6, expected: 'exploration', predicted: 'combat' },
    ] });
    expect(record).toMatchObject({ synthetic: true, category: 'C', metrics: { accuracy: 0.5, automaticPrecision: 1, reviewRate: 0.5, ece: 0.25 }, perLabel: { combat: { precision: 0.5, recall: 1, f1: 2 / 3 } } });
    expect(() => evaluateBenchmark({ id: 'leak', category: 'C', profile, samples: [{ id: 'c1', split: 'test', raw: 0.9, expected: 'combat', predicted: 'combat' }] })).toThrow(/overlap/);
  });
});
