import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { extractSegmentFrames, segmentFrameTimes, selectVisualAnalysisFfmpeg } from '../src/aethera-visual-frames.js';
import { createReferenceClips, FFMPEG } from './fixtures/aethera-reference.js';

it('samples 1–3 interior frames with stable hashes from real FFmpeg synthetic clips', async () => {
  expect(segmentFrameTimes(0, 200)).toEqual([100]);
  expect(segmentFrameTimes(1_000, 3_000)).toEqual([1_500, 2_500]);
  expect(segmentFrameTimes(0, 6_000)).toEqual([1_000, 3_000, 5_000]);
  expect(() => segmentFrameTimes(10, 5)).toThrow(/interval/i);
  const root = mkdtempSync(join(tmpdir(), 'as05-frames-'));
  const clips = await createReferenceClips(root);
  const clip = clips['fixture-game-a'];
  if (!clip) throw new Error('synthetic fixture clip is missing.');
  const input = { root, relativePath: clip, startMs: 1_000, endMs: 3_000, ffmpeg: FFMPEG };
  const first = await extractSegmentFrames(input);
  const again = await extractSegmentFrames(input);
  expect(first).toEqual(again);
  expect(first).toHaveLength(2);
  for (const frame of first) expect(frame.hash).toBe(createHash('sha256').update(readFileSync(frame.path)).digest('hex'));
  await expect(extractSegmentFrames({ ...input, relativePath: '../escape.mp4' })).rejects.toThrow();
}, 60_000);

it('selects the first FFmpeg candidate that supports visual analysis', async () => {
  const checked: string[] = [];
  await expect(selectVisualAnalysisFfmpeg(['bundled', 'system'], async (candidate) => { checked.push(candidate); return candidate === 'system'; })).resolves.toBe('system');
  expect(checked).toEqual(['bundled', 'system']);
});
