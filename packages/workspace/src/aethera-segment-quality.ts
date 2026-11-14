import { execFile, spawn } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { mediaSegmentSchema, type MediaSegment } from '@neuralbridge/shared';

const exec = promisify(execFile);

/** Limited-range black is Y≈16; a frame this dark on average reads as black. */
export const BLACK_LUMA_MAX = 20;
/** Average luma change between frames below this is a still image (frozen or a card). */
export const FROZEN_DIFF_MAX = 0.1;
/** Average luma change that already reads as full motion; higher values saturate at 1. */
const FULL_MOTION_DIFF = 10;

/** The quality probe samples the segment (black, frozen, motion are judged on a small, regular sample of frames). */
export const QUALITY_FPS = 10;
export const QUALITY_HEIGHT = 180;

export interface SegmentQualityProbe { frames: number; meanLuma: number; meanDiff: number; black: boolean; frozen: boolean; motion: number }

/** Same FFmpeg scene filter as Clip Hunter, restricted to acquired local files; no rights or publication decision. */
export async function detectSegmentCuts(input: { ffmpeg: string; root: string; relativePath: string; durationMs: number; signal?: AbortSignal }): Promise<number[]> {
  if (!Number.isFinite(input.durationMs) || input.durationMs <= 0) throw new Error('invalid: duration.');
  const file = confinedFile(input.root, input.relativePath);
  const { stderr } = await exec(input.ffmpeg, ['-hide_banner', '-i', file, '-vf', "select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'], { windowsHide: true, timeout: 120_000, maxBuffer: 64 * 1024 * 1024, ...(input.signal ? { signal: input.signal } : {}) });
  return [0, ...[...stderr.matchAll(/pts_time:([0-9.]+)/g)].map((match) => Number(match[1])).filter((seconds) => seconds > 0 && seconds * 1_000 < input.durationMs), input.durationMs / 1_000];
}

/** Parses `signalstats` + `metadata=print`: one YAVG and one YDIF per frame (the first frame has no difference). */
export function parseSignalStats(stdout: string): { luma: number[]; diff: number[] } {
  const luma: number[] = [];
  const diff: number[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const avg = /lavfi\.signalstats\.YAVG=([0-9.]+)/.exec(line);
    if (avg) luma.push(Number(avg[1]));
    const dif = /lavfi\.signalstats\.YDIF=([0-9.]+)/.exec(line);
    if (dif) diff.push(Number(dif[1]));
  }
  return { luma, diff };
}

export function summarizeSignalStats(stats: { luma: number[]; diff: number[] }): SegmentQualityProbe {
  const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);
  const meanLuma = mean(stats.luma);
  const meanDiff = mean(stats.diff.slice(1));
  return { frames: stats.luma.length, meanLuma, meanDiff, black: stats.luma.length > 0 && meanLuma <= BLACK_LUMA_MAX, frozen: stats.diff.length > 1 && meanDiff < FROZEN_DIFF_MAX, motion: Math.min(1, meanDiff / FULL_MOTION_DIFF) };
}

function confinedFile(root: string, relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error('forbidden: arquivo fora do projeto.');
  const base = realpathSync(root);
  const candidate = resolve(base, relativePath);
  if (!existsSync(candidate)) throw new Error('not_found: arquivo de mídia inexistente.');
  const path = realpathSync(candidate);
  const inside = relative(base, path);
  if (!inside || inside.startsWith('..') || isAbsolute(inside) || !statSync(path).isFile()) throw new Error('forbidden: arquivo fora do projeto.');
  return path;
}

/**
 * Category A of the B-1 benchmark: FFmpeg measures a time range (black, frozen, motion). It does not say what the
 * scene is about; semantic classification belongs to the vision providers.
 */
export async function probeSegmentQuality(input: { ffmpeg: string; root: string; relativePath: string; startMs: number; endMs: number; signal?: AbortSignal }): Promise<SegmentQualityProbe> {
  if (!(input.endMs > input.startMs) || input.startMs < 0) throw new Error('invalid: intervalo de segmento inválido.');
  const file = confinedFile(input.root, input.relativePath);
  const args = ['-hide_banner', '-v', 'error', '-ss', (input.startMs / 1_000).toFixed(3), '-t', ((input.endMs - input.startMs) / 1_000).toFixed(3), '-i', file, '-vf', `scale=-2:${QUALITY_HEIGHT},fps=${QUALITY_FPS},signalstats,metadata=print:file=-`, '-an', '-f', 'null', '-'];
  try {
    return summarizeStreamedStats(await streamSignalStats(input.ffmpeg, args, input.signal));
  } catch (error) {
    if (input.signal?.aborted) throw new Error('cancelled: análise interrompida.', { cause: error });
    throw new Error(`FFmpeg falhou ao medir o segmento: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

interface StreamedStats { frames: number; lumaSum: number; diffs: number; diffSum: number }

/**
 * Reads `signalstats` line by line and keeps only running sums: the output is ~830 bytes per frame, so an uncut
 * segment of tens of minutes would not fit in any fixed buffer (64 MB failed at ~22 min of 60 fps).
 */
function streamSignalStats(ffmpeg: string, args: string[], signal?: AbortSignal): Promise<StreamedStats> {
  return new Promise((done, fail) => {
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], ...(signal ? { signal } : {}) });
    const stats: StreamedStats = { frames: 0, lumaSum: 0, diffs: 0, diffSum: 0 };
    let pending = '';
    let errors = '';
    const take = (line: string) => {
      const avg = /lavfi\.signalstats\.YAVG=([0-9.]+)/.exec(line);
      if (avg) { stats.frames += 1; stats.lumaSum += Number(avg[1]); return; }
      const dif = /lavfi\.signalstats\.YDIF=([0-9.]+)/.exec(line);
      // The first frame has no previous one to differ from, as in summarizeSignalStats.
      if (dif && stats.frames > 1) { stats.diffs += 1; stats.diffSum += Number(dif[1]); }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) take(line);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => { errors = (errors + chunk).slice(-2_000); });
    child.on('error', fail);
    child.on('close', (code) => {
      if (pending) take(pending);
      if (code === 0) done(stats);
      else fail(new Error(`saiu com código ${code}${errors.trim() ? `: ${errors.trim()}` : ''}`));
    });
  });
}

function summarizeStreamedStats(stats: StreamedStats): SegmentQualityProbe {
  const meanLuma = stats.frames ? stats.lumaSum / stats.frames : 0;
  const meanDiff = stats.diffs ? stats.diffSum / stats.diffs : 0;
  return { frames: stats.frames, meanLuma, meanDiff, black: stats.frames > 0 && meanLuma <= BLACK_LUMA_MAX, frozen: stats.frames > 1 && meanDiff < FROZEN_DIFF_MAX, motion: Math.min(1, meanDiff / FULL_MOTION_DIFF) };
}

/** Segments between consecutive cuts (seconds, as the clip hunter returns them), with FFmpeg quality and no semantics yet. */
export function segmentsFromCuts(assetId: string, cutsSeconds: readonly number[], quality: (startMs: number, endMs: number) => SegmentQualityProbe): MediaSegment[] {
  const bounds = [...new Set(cutsSeconds.map((seconds) => Math.round(seconds * 1_000)))].filter((ms) => ms >= 0).sort((a, b) => a - b);
  const segments: MediaSegment[] = [];
  for (let index = 1; index < bounds.length; index += 1) {
    const startMs = bounds[index - 1] as number;
    const endMs = bounds[index] as number;
    if (endMs - startMs < 100) continue;
    const probe = quality(startMs, endMs);
    segments.push(mediaSegmentSchema.parse({
      schemaVersion: 1, id: `${assetId}:${startMs}-${endMs}`, assetId, startMs, endMs, frameHashes: [], kind: 'unknown', description: '', tags: [], embeddingRefs: [],
      quality: { blur: 0, motion: probe.motion, overlayText: false, watermark: false, black: probe.black, frozen: probe.frozen },
      analyzedBy: { provider: 'ffmpeg-heuristics', model: 'ffmpeg-signalstats', confidence: 0 },
    }));
  }
  return segments;
}

/** Longest stretch one segment may cover: a cut of a scene is seconds long, so a matchable segment must be too. */
export const MAX_SEGMENT_SECONDS = 20;

/**
 * Scene detection only cuts where the picture changes, and a continuous gameplay can run for minutes without a cut,
 * which would make one useless segment of most of the video. Splits every span longer than `maxSeconds` into equal
 * windows (none longer than the limit), keeping the real cuts.
 */
export function windowCuts(cutsSeconds: readonly number[], maxSeconds = MAX_SEGMENT_SECONDS): number[] {
  const sorted = [...new Set(cutsSeconds)].filter((value) => Number.isFinite(value) && value >= 0).sort((a, b) => a - b);
  const out: number[] = [];
  sorted.forEach((value, index) => {
    const previous = sorted[index - 1];
    if (previous !== undefined && value - previous > maxSeconds) {
      const parts = Math.ceil((value - previous) / maxSeconds);
      for (let part = 1; part < parts; part += 1) out.push(Math.round((previous + ((value - previous) * part) / parts) * 1_000) / 1_000);
    }
    out.push(value);
  });
  return out;
}
