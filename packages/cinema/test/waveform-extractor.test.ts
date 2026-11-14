import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  WaveformCache,
  computeWaveformBucketsFromPcm,
  extractWaveformData,
  sliceAndResampleWaveform,
} from '../src/qc/waveform-extractor.js';
import { resampleWaveformForClip } from '../../desktop-shared/src/renderer/src/features/aethera/WaveformCanvas.js';

const execFileAsync = promisify(execFile);
const tempDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aethera-waveform-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe('Professional Audio Waveform Extraction & Caching', () => {
  it('computes bipolar positive/negative peaks and preserves true silence from PCM', () => {
    // 100 samples: first 50 silent (0), next 50 oscillating +/-16384 (~0.5)
    const buf = Buffer.alloc(100 * 2);
    for (let i = 50; i < 100; i += 1) {
      const sample = i % 2 === 0 ? 16384 : -16384;
      buf.writeInt16LE(sample, i * 2);
    }

    const buckets = computeWaveformBucketsFromPcm(buf, 2);
    expect(buckets).toHaveLength(2);
    // First half is true silence
    expect(buckets[0]).toEqual({ min: 0, max: 0, rms: 0 });
    // Second half has bipolar peaks ~ -0.5 and +0.5
    expect(buckets[1].max).toBeCloseTo(0.5, 2);
    expect(buckets[1].min).toBeCloseTo(-0.5, 2);
    expect(buckets[1].rms).toBeCloseTo(0.5, 2);
  });

  it('extracts distinct real waveforms for narration, music with fades, and SFX impulse via FFmpeg', async () => {
    const dir = createTempDir();
    const narrationPath = join(dir, 'narration.wav');
    const musicPath = join(dir, 'music.wav');
    const sfxPath = join(dir, 'sfx.wav');

    // 1) Narration: 2s speech-band sine + 1s silence at end
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=240:sample_rate=16000:duration=2,apad=whole_dur=3',
      narrationPath,
    ]);

    // 2) Music: 3s chord with 1s fade-in and 1s fade-out
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=110:sample_rate=16000:duration=3,afade=t=in:st=0:d=1,afade=t=out:st=2:d=1',
      musicPath,
    ]);

    // 3) SFX: 1s silence + 0.3s loud impact + 1.7s silence
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=600:sample_rate=16000:duration=0.3,adelay=1000|1000,apad=whole_dur=3',
      sfxPath,
    ]);

    const cache = new WaveformCache(join(dir, 'cache'));
    const [narWave, musWave, sfxWave] = await Promise.all([
      extractWaveformData({ filePath: narrationPath, buckets: 300, cache }),
      extractWaveformData({ filePath: musicPath, buckets: 300, cache }),
      extractWaveformData({ filePath: sfxPath, buckets: 300, cache }),
    ]);

    expect(narWave.hasAudio).toBe(true);
    expect(musWave.hasAudio).toBe(true);
    expect(sfxWave.hasAudio).toBe(true);

    // Narration: active at 0.5s (bucket ~50), silent at 2.5s (bucket ~250)
    expect(narWave.buckets[50].max).toBeGreaterThan(0.08);
    expect(narWave.buckets[50].min).toBeLessThan(-0.08);
    expect(narWave.buckets[250].max).toBe(0);
    expect(narWave.buckets[250].min).toBe(0);

    // Music fade-in: bucket ~5 (early fade) quieter than bucket ~150 (full sustain), and bucket ~295 quieter
    expect(musWave.buckets[5].rms).toBeLessThan(musWave.buckets[150].rms);
    expect(musWave.buckets[295].rms).toBeLessThan(musWave.buckets[150].rms);

    // SFX impulse: silent at 0.2s (bucket ~20), loud around 1.15s (bucket ~115), silent at 2.2s (bucket ~220)
    expect(sfxWave.buckets[20].max).toBe(0);
    expect(sfxWave.buckets[115].max).toBeGreaterThan(0.08);
    expect(sfxWave.buckets[220].max).toBe(0);

    // Verify cache hit on second call
    const cachedNar = await extractWaveformData({ filePath: narrationPath, buckets: 300, cache });
    expect(cachedNar.cached).toBe(true);
    expect(cachedNar.buckets).toEqual(narWave.buckets);

    // Verify disk persistence on a fresh WaveformCache instance
    const cache2 = new WaveformCache(join(dir, 'cache'));
    const diskCached = await extractWaveformData({ filePath: narrationPath, buckets: 300, cache: cache2 });
    expect(diskCached.cached).toBe(true);
  });

  it('synchronizes trimmed/cut clips, playback speed, and horizontal zoom buckets accurately', async () => {
    const dir = createTempDir();
    const audioPath = join(dir, 'cut-test.wav');
    // 2s silence + 2s loud tone
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=16000:duration=2,adelay=2000|2000,apad=whole_dur=4',
      audioPath,
    ]);

    const wave = await extractWaveformData({ filePath: audioPath, buckets: 400 });

    // Clip trimmed to start at 2.0s (loud region) for 1.0s at 2x speed (consumes 2.0s..4.0s)
    const zoomedOut = sliceAndResampleWaveform(wave, {
      startSec: 2.0,
      timelineDurationSec: 1.0,
      speed: 2.0,
      targetBuckets: 20,
    });
    expect(zoomedOut).toHaveLength(20);
    expect(zoomedOut[10].max).toBeGreaterThan(0.08);

    // Zoomed in (more buckets) via renderer helper
    const zoomedIn = resampleWaveformForClip(wave, {
      sourceStartSec: 0,
      timelineDurationSec: 1.5,
      speed: 1.0,
      targetBuckets: 120,
    });
    expect(zoomedIn).toHaveLength(120);
    // 0..1.5s is completely silent
    expect(zoomedIn.every((b) => b.max === 0 && b.min === 0)).toBe(true);
  });

  it('reports explicit error for missing files and hasAudio=false for silent/video-only files', async () => {
    const dir = createTempDir();
    await expect(
      extractWaveformData({ filePath: join(dir, 'does-not-exist.wav') }),
    ).rejects.toThrow();

    const videoOnly = join(dir, 'video-only.mp4');
    await execFileAsync('ffmpeg', [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=320x180:d=1',
      videoOnly,
    ]);
    const res = await extractWaveformData({ filePath: videoOnly });
    expect(res.hasAudio).toBe(false);
    expect(res.buckets).toHaveLength(0);
  });
});
