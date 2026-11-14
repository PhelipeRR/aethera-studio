import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Filters the Quality Director measures with and the caption burner needs; the FFmpeg bundled by Remotion has none. */
export const QUALITY_FFMPEG_FILTERS = ['ebur128', 'astats', 'silencedetect', 'blackdetect', 'freezedetect', 'subtitles'] as const;

export type QualityFfmpegProbe = (candidate: string) => Promise<boolean>;

/** True when the binary runs and lists every measuring filter (no file is read or written). */
export async function probeQualityFfmpeg(candidate: string): Promise<boolean> {
  try {
    const result = await exec(candidate, ['-hide_banner', '-filters'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    const filters = new Set(result.stdout.split(/\r?\n/u).map((line) => /^\s*[.A-Z|]{2,3}\s+(\S+)\s/u.exec(line)?.[1]).filter((name): name is string => !!name));
    return QUALITY_FFMPEG_FILTERS.every((name) => filters.has(name));
  } catch {
    return false;
  }
}

/**
 * The first candidate able to measure loudness, peaks, silence, black and frozen frames and to burn captions. The render
 * keeps using the bundled binary; this one only measures and assembles. Never silently falls back to a weaker binary.
 */
export async function selectQualityFfmpeg(candidates: readonly string[], probe: QualityFfmpegProbe = probeQualityFfmpeg): Promise<string> {
  for (const candidate of [...new Set(candidates.filter((value) => value.trim()))]) if (await probe(candidate)) return candidate;
  throw new Error(`unavailable: nenhum FFmpeg disponível tem ${QUALITY_FFMPEG_FILTERS.join(', ')}; instale um FFmpeg completo ou defina NB_QUALITY_FFMPEG.`);
}
