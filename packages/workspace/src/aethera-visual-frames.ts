import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { promisify } from 'node:util';
import { extractVelixThumbnail } from './velix-clip-hunter.js';

const exec = promisify(execFile);

export type VisualAnalysisFfmpegProbe = (candidate: string) => Promise<boolean>;

/** Checks the filters and null-output path required by the AS-05 analyzers. */
export async function probeVisualAnalysisFfmpeg(candidate: string): Promise<boolean> {
  try {
    const result = await exec(candidate, ['-hide_banner', '-filters'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    const filters = new Set(result.stdout.split(/\r?\n/u).map((line) => /^\s*[.A-Z|]{2,3}\s+(\S+)\s/u.exec(line)?.[1]).filter((name): name is string => !!name));
    if (!['select', 'showinfo', 'signalstats', 'metadata'].every((name) => filters.has(name))) return false;
    await exec(candidate, ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=2x2:d=0.1', '-vf', "select='gt(scene,0)',showinfo,signalstats,metadata=print:file=-", '-an', '-c:v', 'wrapped_avframe', '-f', 'null', '-'], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
    return true;
  } catch { return false; }
}

/** Selects a compatible analysis binary without changing the render binary used by Remotion. */
export async function selectVisualAnalysisFfmpeg(candidates: readonly string[], probe: VisualAnalysisFfmpegProbe = probeVisualAnalysisFfmpeg): Promise<string> {
  for (const candidate of [...new Set(candidates.filter((value) => value.trim()))]) if (await probe(candidate)) return candidate;
  throw new Error('unavailable: nenhum FFmpeg disponível suporta select/showinfo/signalstats/metadata para a análise visual.');
}

/** Evenly spaced interior samples, no cut-boundary frame from the neighboring scene. */
export function segmentFrameTimes(startMs: number, endMs: number): number[] {
  if (!Number.isInteger(startMs) || !Number.isInteger(endMs) || startMs < 0 || endMs <= startMs) throw new Error('invalid: segment interval.');
  const count = Math.min(3, Math.max(1, Math.ceil((endMs - startMs) / 1_000)));
  return Array.from({ length: count }, (_, i) => Math.floor(startMs + (endMs - startMs) * (i + 0.5) / count));
}

/** Reuses the confined thumbnail extractor; JPEG bytes are content addressed and paths never come from a provider. */
export async function extractSegmentFrames(input: { root: string; relativePath: string; startMs: number; endMs: number; ffmpeg?: string; signal?: AbortSignal }): Promise<Array<{ hash: string; path: string }>> {
  const root = realpathSync(input.root);
  const directory = join(root, '.aethera-frames');
  mkdirSync(directory, { recursive: true });
  const inside = relative(root, realpathSync(directory));
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('forbidden: frames outside project.');
  const frames: Array<{ hash: string; path: string }> = [];
  for (const time of segmentFrameTimes(input.startMs, input.endMs)) {
    const buffer = await extractVelixThumbnail({ ...input, time: time / 1_000 });
    const hash = createHash('sha256').update(buffer).digest('hex');
    const path = join(directory, `${hash}.jpg`);
    if (!existsSync(path)) writeFileSync(path, buffer, { flag: 'wx' });
    frames.push({ hash, path });
  }
  return frames;
}
