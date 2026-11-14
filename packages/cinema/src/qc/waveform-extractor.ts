import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface WaveformBucket {
  /** Minimum normalized sample value in [-1, 0]. */
  min: number;
  /** Maximum normalized sample value in [0, 1]. */
  max: number;
  /** Root-mean-square energy in [0, 1] for inner core rendering. */
  rms: number;
}

export interface WaveformData {
  filePath: string;
  sampleRate: number;
  durationSec: number;
  hasAudio: boolean;
  buckets: WaveformBucket[];
  cached: boolean;
}

export interface ExtractWaveformOptions {
  filePath: string;
  /** Desired number of buckets across the entire file. Defaults to adaptive up to 2048. */
  buckets?: number;
  /** Sample rate used by FFmpeg during decoding. Defaults to 8000 Hz. */
  sampleRate?: number;
  /** Optional cache instance to avoid redundant FFmpeg decodes. */
  cache?: WaveformCache;
}

export interface SliceWaveformOptions {
  /** Source offset in seconds (e.g. trim start). Defaults to 0. */
  startSec?: number;
  /** Source duration in seconds to display (before speed scaling, or clip duration * speed). */
  sourceDurationSec?: number;
  /** Playback speed multiplier (e.g. 1, 1.5, 0.5). Used when timelineDurationSec is given. */
  speed?: number;
  /** Timeline duration in seconds; if provided without sourceDurationSec, sourceDurationSec = timelineDurationSec * speed. */
  timelineDurationSec?: number;
  /** Target number of buckets for the rendered width (e.g. canvas pixels / 2). */
  targetBuckets: number;
}

/**
 * Computes bipolar min/max/rms buckets directly from signed 16-bit little-endian PCM buffer.
 * Preserves true silence (0, 0, 0) without artificial floor clamping.
 */
export function computeWaveformBucketsFromPcm(
  pcmBuffer: Buffer,
  targetBuckets: number,
): WaveformBucket[] {
  const safeBuckets = Math.max(1, Math.min(16384, Math.floor(targetBuckets)));
  const sampleCount = Math.floor(pcmBuffer.length / 2);
  if (sampleCount === 0) {
    return Array.from({ length: safeBuckets }, () => ({ min: 0, max: 0, rms: 0 }));
  }

  const buckets: WaveformBucket[] = new Array(safeBuckets);
  for (let b = 0; b < safeBuckets; b += 1) {
    const start = Math.floor((b * sampleCount) / safeBuckets);
    const end = Math.max(start + 1, Math.floor(((b + 1) * sampleCount) / safeBuckets));
    let minVal = 0;
    let maxVal = 0;
    let sumSq = 0;
    let count = 0;

    for (let i = start; i < end && i < sampleCount; i += 1) {
      const sample = pcmBuffer.readInt16LE(i * 2) / 32768;
      if (sample < minVal) minVal = sample;
      if (sample > maxVal) maxVal = sample;
      sumSq += sample * sample;
      count += 1;
    }

    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    buckets[b] = {
      min: Number(Math.max(-1, Math.min(0, minVal)).toFixed(4)),
      max: Number(Math.max(0, Math.min(1, maxVal)).toFixed(4)),
      rms: Number(Math.max(0, Math.min(1, rms)).toFixed(4)),
    };
  }

  return buckets;
}

/**
 * Slices and resamples cached full-file waveform buckets to match a clip's
 * trim offset, duration, speed, and current horizontal zoom bucket count.
 */
export function sliceAndResampleWaveform(
  data: WaveformData,
  options: SliceWaveformOptions,
): WaveformBucket[] {
  const targetBuckets = Math.max(1, Math.min(8192, Math.floor(options.targetBuckets)));
  if (!data.hasAudio || data.buckets.length === 0 || data.durationSec <= 0) {
    return Array.from({ length: targetBuckets }, () => ({ min: 0, max: 0, rms: 0 }));
  }

  const speed = Math.max(0.1, options.speed ?? 1);
  const startSec = Math.max(0, options.startSec ?? 0);
  const sourceSpanSec =
    options.sourceDurationSec ??
    (options.timelineDurationSec ? options.timelineDurationSec * speed : data.durationSec - startSec);
  const endSec = Math.min(data.durationSec, startSec + Math.max(0.01, sourceSpanSec));

  if (endSec <= startSec) {
    return Array.from({ length: targetBuckets }, () => ({ min: 0, max: 0, rms: 0 }));
  }

  const totalSrcBuckets = data.buckets.length;
  const startIdx = Math.max(0, Math.min(totalSrcBuckets - 1, (startSec / data.durationSec) * totalSrcBuckets));
  const endIdx = Math.max(startIdx + 0.001, Math.min(totalSrcBuckets, (endSec / data.durationSec) * totalSrcBuckets));

  const out: WaveformBucket[] = new Array(targetBuckets);
  const span = endIdx - startIdx;

  for (let b = 0; b < targetBuckets; b += 1) {
    const s0 = Math.floor(startIdx + (b * span) / targetBuckets);
    const s1 = Math.max(s0 + 1, Math.ceil(startIdx + ((b + 1) * span) / targetBuckets));
    let minVal = 0;
    let maxVal = 0;
    let sumRmsSq = 0;
    let count = 0;

    for (let i = s0; i < s1 && i < totalSrcBuckets; i += 1) {
      const bucket = data.buckets[i];
      if (!bucket) continue;
      if (bucket.min < minVal) minVal = bucket.min;
      if (bucket.max > maxVal) maxVal = bucket.max;
      sumRmsSq += bucket.rms * bucket.rms;
      count += 1;
    }

    out[b] = {
      min: Number(minVal.toFixed(4)),
      max: Number(maxVal.toFixed(4)),
      rms: Number((count > 0 ? Math.sqrt(sumRmsSq / count) : 0).toFixed(4)),
    };
  }

  return out;
}

export class WaveformCache {
  private readonly memory = new Map<string, WaveformData>();

  constructor(private readonly cacheDir?: string) {
    if (this.cacheDir) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  private buildKey(filePath: string, buckets: number, sampleRate: number): string {
    let statSig = 'no-stat';
    try {
      const st = statSync(filePath);
      statSig = `${st.size}:${Math.floor(st.mtimeMs)}`;
    } catch {
      statSig = 'missing';
    }
    return createHash('sha1')
      .update(`${filePath}|${statSig}|${buckets}|${sampleRate}`)
      .digest('hex');
  }

  get(filePath: string, buckets: number, sampleRate: number): WaveformData | null {
    const key = this.buildKey(filePath, buckets, sampleRate);
    const inMem = this.memory.get(key);
    if (inMem) {
      return { ...inMem, cached: true };
    }
    if (this.cacheDir) {
      const diskPath = join(this.cacheDir, `${key}.json`);
      if (existsSync(diskPath)) {
        try {
          const parsed = JSON.parse(readFileSync(diskPath, 'utf8')) as WaveformData;
          if (parsed && Array.isArray(parsed.buckets)) {
            this.memory.set(key, parsed);
            return { ...parsed, cached: true };
          }
        } catch {
          // ignore corrupt cache entry
        }
      }
    }
    return null;
  }

  set(filePath: string, buckets: number, sampleRate: number, data: WaveformData): void {
    const key = this.buildKey(filePath, buckets, sampleRate);
    this.memory.set(key, data);
    if (this.cacheDir) {
      try {
        mkdirSync(this.cacheDir, { recursive: true });
        writeFileSync(join(this.cacheDir, `${key}.json`), JSON.stringify(data), 'utf8');
      } catch {
        // ignore cache write failure
      }
    }
  }
}

/**
 * Decodes real audio from a media file using FFmpeg and extracts bipolar waveform buckets.
 * Throws if the file does not exist or FFmpeg fails to decode it.
 */
export async function extractWaveformData(
  options: ExtractWaveformOptions,
): Promise<WaveformData> {
  const { filePath } = options;
  if (!existsSync(filePath)) {
    throw new Error(`Arquivo de áudio não encontrado: ${filePath}`);
  }

  const sampleRate = options.sampleRate ?? 8000;
  const targetBuckets = Math.max(64, Math.min(8192, options.buckets ?? 1024));

  const cached = options.cache?.get(filePath, targetBuckets, sampleRate);
  if (cached) {
    return cached;
  }

  let pcmBuffer: Buffer;
  try {
    const { stdout } = await execFileAsync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-i',
        filePath,
        '-vn',
        '-ac',
        '1',
        '-ar',
        String(sampleRate),
        '-f',
        's16le',
        'pipe:1',
      ],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 } as unknown as { encoding: 'buffer' },
    );
    pcmBuffer = stdout as unknown as Buffer;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('does not contain any stream') || msg.includes('Stream map')) {
      const noAudio: WaveformData = {
        filePath,
        sampleRate,
        durationSec: 0,
        hasAudio: false,
        buckets: [],
        cached: false,
      };
      options.cache?.set(filePath, targetBuckets, sampleRate, noAudio);
      return noAudio;
    }
    throw err;
  }
  const sampleCount = Math.floor(pcmBuffer.length / 2);
  if (sampleCount === 0) {
    const empty: WaveformData = {
      filePath,
      sampleRate,
      durationSec: 0,
      hasAudio: false,
      buckets: [],
      cached: false,
    };
    options.cache?.set(filePath, targetBuckets, sampleRate, empty);
    return empty;
  }

  const durationSec = Number((sampleCount / sampleRate).toFixed(4));
  const buckets = computeWaveformBucketsFromPcm(pcmBuffer, targetBuckets);
  const result: WaveformData = {
    filePath,
    sampleRate,
    durationSec,
    hasAudio: true,
    buckets,
    cached: false,
  };

  options.cache?.set(filePath, targetBuckets, sampleRate, result);
  return result;
}
