import { z } from 'zod';
import { calibrateAutoThreshold, confidenceBand, segmentKinds } from './aethera-studio.js';

const probability = z.number().min(0).max(1);
export const confidenceCalibrationSchema = z.strictObject({
  schemaVersion: z.literal(1), provider: z.string().min(1), model: z.string().min(1), promptVersion: z.string().min(1), label: z.enum(segmentKinds),
  datasetVersion: z.string().min(1), synthetic: z.boolean(), sampleIds: z.array(z.string().min(1)).min(1),
  points: z.array(z.strictObject({ raw: probability, probability })).min(1),
  thresholds: z.strictObject({ autoAt: probability, reviewAt: probability }).nullable(),
});
export type ConfidenceCalibration = z.infer<typeof confidenceCalibrationSchema>;
export const visionBenchmarkSchema = z.strictObject({
  schemaVersion: z.literal(1), id: z.string().min(1), benchmark: z.literal('B-1'), category: z.enum(['A', 'B', 'C', 'combination']),
  datasetVersion: z.string().min(1), synthetic: z.boolean(), provider: z.string().min(1), model: z.string().min(1), promptVersion: z.string().min(1),
  status: z.enum(['measured', 'unavailable']), limitations: z.array(z.string().min(1)), sampleIds: z.array(z.string().min(1)),
  metrics: z.record(z.string(), z.number().finite().nullable()), perLabel: z.record(z.string(), z.strictObject({ precision: probability, recall: probability, f1: probability })),
  reliability: z.array(z.strictObject({ count: z.number().int().nonnegative(), confidence: probability, accuracy: probability })),
  calibration: confidenceCalibrationSchema.nullable(), createdAt: z.string().min(1),
});
export type VisionBenchmark = z.infer<typeof visionBenchmarkSchema>;

/** Pool-adjacent-violators isotonic regression, fitted exclusively on an identified calibration split. */
export function fitCalibration(key: Omit<ConfidenceCalibration, 'schemaVersion' | 'sampleIds' | 'points' | 'thresholds'>, samples: readonly { id: string; split: 'calibration' | 'test'; raw: number; correct: boolean }[], identity = false): ConfidenceCalibration {
  if (!samples.length || samples.some((sample) => sample.split !== 'calibration')) throw new Error('invalid: calibration split required.');
  if (new Set(samples.map((sample) => sample.id)).size !== samples.length) throw new Error('invalid: duplicate calibration IDs.');
  const sorted = [...samples].sort((a, b) => a.raw - b.raw);
  const blocks: Array<{ values: number[]; correct: number; count: number }> = [];
  for (const sample of sorted) {
    probability.parse(sample.raw);
    const last = blocks.at(-1);
    if (last?.values.at(-1) === sample.raw) { last.values.push(sample.raw); last.count++; last.correct += Number(sample.correct); }
    else blocks.push({ values: [sample.raw], correct: Number(sample.correct), count: 1 });
    while (blocks.length > 1) {
      const b = blocks.at(-1); const a = blocks.at(-2);
      if (!a || !b) throw new Error('invalid: calibration blocks are incomplete.');
      if (a.correct / a.count <= b.correct / b.count) break;
      blocks.splice(-2, 2, { values: [...a.values, ...b.values], correct: a.correct + b.correct, count: a.count + b.count });
    }
  }
  const points = blocks.flatMap((block) => block.values.map((raw) => ({ raw, probability: block.correct / block.count })));
  const calibrated = sorted.map((sample, index) => {
    const point = points[index];
    if (!point) throw new Error('invalid: calibration point is missing.');
    return { probability: point.probability, correct: sample.correct };
  });
  const autoAt = calibrateAutoThreshold(calibrated, identity ? 0.99 : 0.95);
  const reviewAt = points.find((point) => point.probability >= 0.5)?.probability ?? null;
  return confidenceCalibrationSchema.parse({ schemaVersion: 1, ...key, sampleIds: samples.map((sample) => sample.id), points, thresholds: autoAt === null ? null : { autoAt, reviewAt: Math.min(autoAt, reviewAt ?? autoAt) } });
}

export function calibratedProbability(profile: ConfidenceCalibration, raw: number): number {
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return 0;
  // Conservative step interpolation; no extrapolation beyond the highest measured score.
  const first = profile.points[0];
  return [...profile.points].reverse().find((point) => point.raw <= raw)?.probability ?? first?.probability ?? 0;
}

/** Held-out results are never fed back into fitting or threshold choice. No hardware/cost numbers are fabricated. */
export function evaluateBenchmark(input: { id: string; category: VisionBenchmark['category']; profile: ConfidenceCalibration; samples: readonly { id: string; split: 'test'; raw: number; expected: string; predicted: string }[] }): VisionBenchmark {
  const { profile, samples } = input;
  if (!samples.length || samples.some((sample) => sample.split !== 'test' || profile.sampleIds.includes(sample.id)) || new Set(samples.map((sample) => sample.id)).size !== samples.length) throw new Error('invalid: test/calibration overlap or missing test split.');
  const rows = samples.map((sample) => ({ confidence: calibratedProbability(profile, sample.raw), correct: sample.expected === sample.predicted, sample }));
  const automatic = rows.filter((row) => confidenceBand(row.confidence, profile.thresholds) === 'automatic');
  const labels = [...new Set(samples.flatMap((sample) => [sample.expected, sample.predicted]))];
  const ratio = (n: number, d: number) => d ? n / d : 0;
  const perLabel = Object.fromEntries(labels.map((label) => {
    const tp = samples.filter((sample) => sample.expected === label && sample.predicted === label).length;
    const precision = ratio(tp, samples.filter((sample) => sample.predicted === label).length);
    const recall = ratio(tp, samples.filter((sample) => sample.expected === label).length);
    return [label, { precision, recall, f1: ratio(2 * precision * recall, precision + recall) }];
  }));
  const reliability = Array.from({ length: 10 }, (_, bin) => {
    const group = rows.filter((row) => Math.min(9, Math.floor(row.confidence * 10)) === bin);
    return { count: group.length, confidence: ratio(group.reduce((sum, row) => sum + row.confidence, 0), group.length), accuracy: ratio(group.filter((row) => row.correct).length, group.length) };
  }).filter((bin) => bin.count);
  return visionBenchmarkSchema.parse({ schemaVersion: 1, id: input.id, benchmark: 'B-1', category: input.category, datasetVersion: profile.datasetVersion, synthetic: profile.synthetic,
    provider: profile.provider, model: profile.model, promptVersion: profile.promptVersion, status: 'measured', limitations: profile.synthetic ? ['Synthetic fixture; does not satisfy real B-1 acceptance.'] : [],
    sampleIds: samples.map((sample) => sample.id), perLabel, reliability, calibration: profile, createdAt: new Date().toISOString(),
    metrics: { accuracy: rows.filter((row) => row.correct).length / rows.length, automaticPrecision: automatic.length ? automatic.filter((row) => row.correct).length / automatic.length : null,
      reviewRate: rows.filter((row) => confidenceBand(row.confidence, profile.thresholds) === 'review').length / rows.length,
      ece: reliability.reduce((sum, bin) => sum + bin.count / rows.length * Math.abs(bin.accuracy - bin.confidence), 0) },
  });
}
