import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { probeQualityFfmpeg, selectQualityFfmpeg } from '../src/aethera-quality-ffmpeg.js';

const FULL = process.env['FFMPEG_PATH'] ?? 'C:\\ffmpeg\\bin\\ffmpeg.exe';
// The minimal FFmpeg Remotion bundles with the app: it composes, but cannot measure loudness or burn captions.
const BUNDLED = resolve(import.meta.dirname, '../../../node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe');

describe('FFmpeg for the Quality Director and burned captions', () => {
  it('picks the first candidate that has every measuring filter, skipping the minimal one', async () => {
    const capable = new Set(['full']);
    expect(await selectQualityFfmpeg(['bundled', 'full', 'other'], async (candidate) => capable.has(candidate))).toBe('full');
    await expect(selectQualityFfmpeg(['bundled'], async () => false)).rejects.toThrow(/ebur128/);
  });

  it.skipIf(!existsSync(FULL))('accepts a full FFmpeg build', async () => {
    expect(await probeQualityFfmpeg(FULL)).toBe(true);
  }, 30_000);

  it.skipIf(!existsSync(BUNDLED))('rejects the minimal FFmpeg bundled with the app', async () => {
    expect(await probeQualityFfmpeg(BUNDLED)).toBe(false);
  }, 30_000);
});
