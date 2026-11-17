import { execFile } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseSignalStats, probeSegmentQuality, probeSegmentTemporalSamples, segmentsFromCuts, summarizeSignalStats, windowCuts } from '../src/aethera-segment-quality.js';
import { createReferenceClips, FFMPEG, REFERENCE_GAMES, REFERENCE_SECTIONS } from './fixtures/aethera-reference.js';

let root: string;
let clips: Record<string, string>;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'aethera-reference-'));
  clips = await createReferenceClips(root);
}, 60_000);

describe('FFmpeg segment quality on the reference scenario', () => {
  it('generates one clip per reference game', () => {
    expect(Object.keys(clips)).toEqual(REFERENCE_GAMES.map((game) => game.id));
  });

  it.each(REFERENCE_GAMES.map((game) => game.id))('tells black, motion and still apart in %s', async (gameId) => {
    const relativePath = clips[gameId] as string;
    const [black, motion, still] = await Promise.all([REFERENCE_SECTIONS.black, REFERENCE_SECTIONS.motion, REFERENCE_SECTIONS.still].map(([startMs, endMs]) => probeSegmentQuality({ ffmpeg: FFMPEG, root, relativePath, startMs: startMs + 100, endMs: endMs - 100 })));
    expect(black).toMatchObject({ black: true });
    expect(motion).toMatchObject({ black: false, frozen: false });
    expect(motion?.motion).toBeGreaterThan(0.05);
    expect(still).toMatchObject({ black: false, frozen: true });
  }, 30_000);

  it('measures a segment longer than the old 64 MB output buffer (25 min at 60 fps, no cut)', async () => {
    // ~830 bytes of signalstats per frame: 90,000 frames printed ~75 MB and failed with "maxBuffer length exceeded".
    const relativePath = 'long-uncut.mp4';
    await promisify(execFile)(FFMPEG, ['-hide_banner', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=size=64x36:rate=60:duration=1500', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', join(root, relativePath)], { windowsHide: true });
    const quality = await probeSegmentQuality({ ffmpeg: FFMPEG, root, relativePath, startMs: 0, endMs: 1_500_000 });
    // Sampled at QUALITY_FPS: 1,500 s → 15,000 measured frames, well past the old 64 MB limit had it been every frame.
    expect(quality.frames).toBe(15_000);
    expect(quality.black).toBe(false);
    expect(quality.meanLuma).toBeGreaterThan(20);
  }, 180_000);

  it('refuses files outside the project and impossible ranges', async () => {
    await expect(probeSegmentQuality({ ffmpeg: FFMPEG, root, relativePath: '../outside.mp4', startMs: 0, endMs: 1_000 })).rejects.toThrow(/projeto|inexistente/);
    await expect(probeSegmentQuality({ ffmpeg: FFMPEG, root, relativePath: clips['fixture-game-a'] as string, startMs: 2_000, endMs: 1_000 })).rejects.toThrow(/intervalo/);
  });

  it('builds segments between cuts with quality and no invented semantics', () => {
    const segments = segmentsFromCuts('asset-a', [0, 1, 3, 3.05, 5], (startMs) => summarizeSignalStats(startMs === 0 ? { luma: [16, 16], diff: [0, 0] } : { luma: [120, 121, 119], diff: [0, 4, 5] }));
    expect(segments.map((segment) => [segment.startMs, segment.endMs])).toEqual([[0, 1_000], [1_000, 3_000], [3_050, 5_000]]);
    expect(segments[0]?.quality.black).toBe(true);
    expect(segments.every((segment) => segment.kind === 'unknown' && segment.analyzedBy.confidence === 0)).toBe(true);
  });

  it('splits a span without cuts into equal windows of at most the limit, keeping the real cuts', () => {
    // A continuous gameplay: one cut at 4:05, then 53 minutes without a cut.
    const windows = windowCuts([0, 245.05, 3_419], 20);
    expect(windows[0]).toBe(0);
    expect(windows).toContain(245.05);
    expect(windows.at(-1)).toBe(3_419);
    const lengths = windows.slice(1).map((value, index) => value - (windows[index] ?? 0));
    expect(Math.max(...lengths)).toBeLessThanOrEqual(20);
    expect(Math.min(...lengths)).toBeGreaterThan(15);
    expect(windowCuts([0, 12, 30], 20)).toEqual([0, 12, 30]);
  });

  it('parses one luma and one difference value per frame', () => {
    expect(parseSignalStats('frame:0\nlavfi.signalstats.YAVG=16\nlavfi.signalstats.YDIF=0\nframe:1\nlavfi.signalstats.YAVG=120.5\nlavfi.signalstats.YDIF=3.2\n')).toEqual({ luma: [16, 120.5], diff: [0, 3.2] });
  });

  it('returns timestamped temporal samples for flash and continuity analysis', async () => {
    const samples = await probeSegmentTemporalSamples({ ffmpeg: FFMPEG, root, relativePath: clips['fixture-game-a'] as string, startMs: 1_000, endMs: 3_000 });
    expect(samples.length).toBeGreaterThan(5);
    expect(samples[0]?.atMs).toBe(1_000);
    expect(samples.every((sample) => Number.isFinite(sample.meanLuma) && Number.isFinite(sample.meanDiff))).toBe(true);
  }, 30_000);
});
