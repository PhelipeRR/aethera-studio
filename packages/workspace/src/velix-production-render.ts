import { execFile } from 'node:child_process';
import { dirname } from 'node:path';
import { mkdirSync, unlinkSync } from 'node:fs';
import { promisify } from 'node:util';
import { type AetheraAudioPlan, type QualityDirectorSignals, type VideoFormat, type VideoProbe, validateAetheraAudioPlan } from '@neuralbridge/shared';
import { renderAetheraAudioUnlocked } from './aethera-audio-render.js';
import { runExclusiveRender } from './aethera-visual-scheduler.js';

const run = promisify(execFile);
/** FFmpeg errors carry the end of stderr, so the stage reports why it failed instead of only the command line. */
async function exec(file: string, args: string[], options: Parameters<typeof run>[2]): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await run(file, args, options);
    return { stdout: String(result.stdout), stderr: String(result.stderr) };
  } catch (error) {
    const lines = String((error as { stderr?: unknown }).stderr ?? '').trim().split(/\r?\n/u).filter(Boolean);
    // The first lines that name the problem matter more than the generic "terminating" tail.
    const cause = lines.filter((line) => /error|invalid|mismatch|unable|no such|not found/iu.test(line) && !/Terminating thread|Task finished/iu.test(line)).slice(0, 3);
    const stderr = [...cause, ...lines.slice(-2)].filter((line, index, all) => all.indexOf(line) === index).join(' | ');
    throw new Error(`ffmpeg_failed: ${stderr || (error instanceof Error ? (error.message.split('\n')[0] ?? '') : String(error))}`, { cause: error });
  }
}
const BUFFER = 8 * 1_024 * 1_024;
const QUALITY_SILENCE_MS = 3_000;
const filterCache = new Map<string, Set<string>>();
export const QUALITY_FILTERS = ['subtitles', 'ebur128', 'astats', 'silencedetect', 'blackdetect', 'freezedetect'] as const;

/** Filters this FFmpeg build has (cached per binary): the bundled one has no libass, a full build does. */
export async function ffmpegFilters(ffmpeg: string): Promise<Set<string>> {
  const cached = filterCache.get(ffmpeg);
  if (cached) return cached;
  const { stdout } = await exec(ffmpeg, ['-hide_banner', '-filters'], { windowsHide: true, maxBuffer: BUFFER });
  const names = new Set(stdout.split(/\r?\n/u).map((line) => /^\s*[.A-Z|]{2,3}\s+(\S+)\s/u.exec(line)?.[1]).filter((name): name is string => !!name));
  filterCache.set(ffmpeg, names);
  return names;
}

export async function missingQualityFilters(ffmpeg: string): Promise<string[]> {
  const filters = await ffmpegFilters(ffmpeg);
  return QUALITY_FILTERS.filter((filter) => !filters.has(filter));
}

export async function probeVideo(path: string, ffprobe = process.env['NB_FFPROBE'] ?? 'ffprobe'): Promise<VideoProbe> {
  const { stdout } = await exec(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,avg_frame_rate:format=duration', '-of', 'json', path], { windowsHide: true, maxBuffer: BUFFER });
  const data = JSON.parse(stdout) as { streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; avg_frame_rate?: string }>; format?: { duration?: string } };
  const video = data.streams?.find((stream) => stream.codec_type === 'video');
  const audio = data.streams?.find((stream) => stream.codec_type === 'audio');
  const [num, den] = (video?.avg_frame_rate ?? '0/1').split('/').map(Number);
  return { width: video?.width ?? 0, height: video?.height ?? 0, fps: den ? (num ?? 0) / den : 0, durationMs: Math.round(Number(data.format?.duration ?? 0) * 1_000), hasVideo: !!video, hasAudio: !!audio, videoCodec: video?.codec_name ?? null, audioCodec: audio?.codec_name ?? null };
}

/** Extracts a small local JPEG frame for a Motion text background; the source is never downloaded or rewritten. */
export async function extractStillDataUrl(input: { ffmpeg: string; source: string; kind: 'image' | 'video'; atMs: number; signal?: AbortSignal }): Promise<string> {
  const source = input.kind === 'image'
    ? ['-loop', '1', '-i', input.source]
    : ['-ss', (Math.max(0, input.atMs) / 1_000).toFixed(3), '-i', input.source];
  const result = await run(input.ffmpeg, ['-y', '-v', 'error', ...source, '-frames:v', '1', '-vf', 'scale=960:-2:force_original_aspect_ratio=decrease', '-f', 'image2', '-c:v', 'mjpeg', '-q:v', '6', 'pipe:1'], { windowsHide: true, encoding: 'buffer', maxBuffer: 4 * 1_024 * 1_024, ...(input.signal ? { signal: input.signal } : {}) } as Parameters<typeof run>[2]);
  const bytes = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(String(result.stdout));
  if (!bytes.length) throw new Error('ffmpeg_failed: o frame de fundo veio vazio.');
  return `data:image/jpeg;base64,${bytes.toString('base64')}`;
}

/** Only scale, crop and format: the FFmpeg bundled with Remotion has a minimal filter set (no fps, setsar or tpad). */
const cover = (format: VideoFormat) => `scale=${format.width}:${format.height}:force_original_aspect_ratio=increase,crop=${format.width}:${format.height},format=yuv420p`;

/**
 * `-aspect` writes a 1:1 sample aspect: scaling to cover rounds the SAR (e.g. 10240:10239), and concat refuses segments
 * whose SAR differs, while the bundled FFmpeg has no setsar.
 */
/** A silent segment from an authorized local image or video, covering the frame of the format for exactly `frames`. */
/**
 * One media segment of the composition. With `startMs`/`endMs` (AP-02) it starts exactly at that cut of the source (an
 * accurate input seek, no loop); a cut shorter than the scene keeps playing the source past its end, and the extra time
 * is reported (`extendedMs`). Only filters of the minimal FFmpeg bundled with the app are used (scale, crop, format): the
 * frame rate is converted by the output `-r`. Without a range it keeps the legacy behaviour (the source looped from 0).
 */
export async function renderAssetSegment(input: { ffmpeg: string; source: string; kind: 'image' | 'video'; frames: number; format: VideoFormat; output: string; startMs?: number; endMs?: number; signal?: AbortSignal }): Promise<{ extendedMs: number }> {
  return runExclusiveRender(() => renderAssetSegmentUnlocked(input), input.signal);
}

async function renderAssetSegmentUnlocked(input: Parameters<typeof renderAssetSegment>[0]): Promise<{ extendedMs: number }> {
  const fps = Math.round(input.format.fps);
  const neededMs = Math.round((input.frames / fps) * 1_000);
  const seconds = (neededMs / 1_000).toFixed(3);
  mkdirSync(dirname(input.output), { recursive: true });
  const ranged = input.kind === 'video' && input.startMs !== undefined && input.endMs !== undefined && input.endMs > input.startMs;
  const rangeMs = ranged ? (input.endMs as number) - (input.startMs as number) : 0;
  const extendedMs = ranged ? Math.max(0, neededMs - rangeMs) : 0;
  const source = input.kind === 'image'
    ? ['-loop', '1', '-t', seconds, '-i', input.source]
    : ranged
      ? ['-ss', ((input.startMs as number) / 1_000).toFixed(3), '-t', seconds, '-i', input.source]
      : ['-stream_loop', '-1', '-t', seconds, '-i', input.source];
  const filters = cover(input.format);
  await exec(input.ffmpeg, ['-y', '-v', 'error', ...source, '-vf', filters, '-r', String(fps), '-frames:v', String(input.frames), '-aspect', `${input.format.width}:${input.format.height}`, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', input.output], { windowsHide: true, maxBuffer: BUFFER, ...(input.signal ? { signal: input.signal } : {}) });
  return { extendedMs };
}

/**
 * Joins the segments (re-encoded to one size, frame rate and pixel format), lays the measured narration under them, cuts
 * to the narration's length and, when this FFmpeg has libass, burns the captions inside the safe area.
 */
export async function assembleProduction(input: { ffmpeg: string; segments: readonly string[]; narration: string; narrationDurationMs: number; format: VideoFormat; output: string; subtitles?: { path: string; style: string } | null; audioPlan?: AetheraAudioPlan; music?: string; signal?: AbortSignal }): Promise<{ captionsBurned: boolean }> {
  return runExclusiveRender(() => assembleProductionUnlocked(input), input.signal);
}

async function assembleProductionUnlocked(input: Parameters<typeof assembleProduction>[0]): Promise<{ captionsBurned: boolean }> {
  if (!input.segments.length) throw new Error('invalid: não há segmentos para montar.');
  const fps = Math.round(input.format.fps);
  const normalize = input.segments.map((_segment, index) => `[${index}:v]${cover(input.format)}[v${index}]`);
  const joined = `${input.segments.map((_segment, index) => `[v${index}]`).join('')}concat=n=${input.segments.length}:v=1:a=0[joined]`;
  // Segment frames come from the measured narration's boundaries, so the picture already lasts as long as the voice.
  const burn = !!input.subtitles && (await ffmpegFilters(input.ffmpeg)).has('subtitles');
  const escaped = input.subtitles ? input.subtitles.path.replace(/\\/gu, '/').replace(/:/gu, '\\:').replace(/'/gu, "\\'") : '';
  const last = burn && input.subtitles ? `[joined]subtitles='${escaped}':force_style='${input.subtitles.style}'[out]` : '[joined]null[out]';
  const narrationIndex = input.segments.length;
  const audioPlan = input.audioPlan ? validateAetheraAudioPlan(input.audioPlan) : null;
  const videoOutput = audioPlan ? `${input.output}.video-only.mp4` : input.output;
  mkdirSync(dirname(input.output), { recursive: true });
  await exec(input.ffmpeg, [
    '-y', '-v', 'error', ...input.segments.flatMap((segment) => ['-i', segment]), '-i', input.narration,
    '-filter_complex', [...normalize, joined, last].join(';'),
    '-map', '[out]', ...(audioPlan ? ['-an'] : ['-map', `${narrationIndex}:a:0`]), '-t', (input.narrationDurationMs / 1_000).toFixed(3),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-r', String(fps), '-aspect', `${input.format.width}:${input.format.height}`, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', videoOutput,
  ], { windowsHide: true, maxBuffer: BUFFER, ...(input.signal ? { signal: input.signal } : {}) });
  if (audioPlan) {
    const audioOutput = `${input.output}.audio.m4a`;
    await renderAetheraAudioUnlocked({ ffmpeg: input.ffmpeg, narration: input.narration, ...(input.music ? { music: input.music } : {}), plan: audioPlan, output: audioOutput, durationMs: input.narrationDurationMs, ...(input.signal ? { signal: input.signal } : {}) });
    await exec(input.ffmpeg, ['-y', '-v', 'error', '-i', videoOutput, '-i', audioOutput, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', input.output], { windowsHide: true, maxBuffer: BUFFER, ...(input.signal ? { signal: input.signal } : {}) });
    unlinkSync(videoOutput);
    unlinkSync(audioOutput);
  }
  return { captionsBurned: burn };
}

/** Silences in the audio of a file (null when this FFmpeg has no silencedetect). */
export async function detectSilences(ffmpeg: string, path: string, minMs = 3_000): Promise<Array<{ startMs: number; durationMs: number }> | null> {
  if (!(await ffmpegFilters(ffmpeg)).has('silencedetect')) return null;
  const { stderr } = await exec(ffmpeg, ['-hide_banner', '-nostats', '-i', path, '-af', `silencedetect=noise=-50dB:d=${(minMs / 1_000).toFixed(2)}`, '-f', 'null', '-'], { windowsHide: true, maxBuffer: BUFFER });
  const silences: Array<{ startMs: number; durationMs: number }> = [];
  let start: number | null = null;
  for (const line of stderr.split(/\r?\n/u)) {
    const began = /silence_start:\s*([\d.]+)/u.exec(line);
    if (began) start = Number(began[1]) * 1_000;
    const ended = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/u.exec(line);
    if (ended) { silences.push({ startMs: Math.round(start ?? Number(ended[1]) * 1_000 - Number(ended[2]) * 1_000), durationMs: Math.round(Number(ended[2]) * 1_000) }); start = null; }
  }
  return silences;
}

const intervalSignals = (text: string, startName: string, endName: string, durationName: string): Array<{ startMs: number; durationMs: number }> => {
  const intervals: Array<{ startMs: number; durationMs: number }> = [];
  let start: number | null = null;
  for (const line of text.split(/\r?\n/u)) {
    const began = new RegExp(`${startName}:\\s*([\\d.]+)`, 'u').exec(line);
    if (began) start = Number(began[1]) * 1_000;
    const ended = new RegExp(`${endName}:\\s*([\\d.]+).*${durationName}:\\s*([\\d.]+)`, 'u').exec(line);
    if (ended) { intervals.push({ startMs: Math.round(start ?? Number(ended[1]) * 1_000 - Number(ended[2]) * 1_000), durationMs: Math.round(Number(ended[2]) * 1_000) }); start = null; }
  }
  return intervals;
};

/** Runs the FFmpeg-only Quality Director measurements; semantic identity remains a separate persisted signal. */
export async function inspectRenderQuality(ffmpeg: string, path: string): Promise<QualityDirectorSignals> {
  const missing = await missingQualityFilters(ffmpeg);
  if (missing.length) throw new Error(`unavailable: filtros obrigatórios ausentes no FFmpeg de QA: ${missing.join(', ')}.`);
  // pix_th is the normalized luminance threshold for a pixel, not the percentage of black pixels. A value of 0.98
  // classifies almost every dark game frame as black; 0.1 keeps the detector focused on genuinely black screens.
  const video = await exec(ffmpeg, ['-hide_banner', '-nostats', '-i', path, '-vf', 'blackdetect=d=0.25:pix_th=0.1,freezedetect=n=-60dB:d=0.25', '-an', '-f', 'null', '-'], { windowsHide: true, maxBuffer: BUFFER });
  const audio = await exec(ffmpeg, ['-hide_banner', '-nostats', '-i', path, '-af', `silencedetect=noise=-50dB:d=${(QUALITY_SILENCE_MS / 1_000).toFixed(2)},ebur128=peak=true,astats=metadata=1:reset=1`, '-vn', '-f', 'null', '-'], { windowsHide: true, maxBuffer: BUFFER });
  const videoText = `${video.stdout}\n${video.stderr}`;
  const audioText = `${audio.stdout}\n${audio.stderr}`;
  const integrated = [...audioText.matchAll(/I:\s*(-?[\d.]+)\s*LUFS/gu)].at(-1)?.[1];
  const peak = [...audioText.matchAll(/Peak:\s*(-?[\d.]+)\s*dBFS/gu)].at(-1)?.[1];
  const clipped = [...audioText.matchAll(/Number of clipped samples:\s*(\d+)/giu)].at(-1)?.[1];
  return {
    silenceIntervals: await detectSilences(ffmpeg, path) ?? [],
    blackIntervals: intervalSignals(videoText, 'black_start', 'black_end', 'black_duration'),
    frozenIntervals: intervalSignals(videoText, 'freeze_start', 'freeze_end', 'freeze_duration'),
    loudness: integrated && peak ? { integratedLufs: Number(integrated), truePeakDb: Number(peak), clippedSamples: Number(clipped ?? 0) } : null,
    captionSyncOffsetsMs: [], subjectMismatches: [], repeatedSegmentIds: [], watermarkSceneIds: [], identityUnverifiedSceneIds: [], unconfirmedSubjectIds: [], flatBackgroundSceneIds: [],
  };
}
