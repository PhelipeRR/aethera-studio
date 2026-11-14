import { execFile } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { suggestClipIntervals, VELIX_LIMITS, type VelixClipSuggestion } from './velix-discovery.js';

const exec = promisify(execFile);
export type VelixClipMetadata = { duration: number; width: number; height: number; fps: number | null; codecs: string[]; streams: number; hasAudio: boolean; format: string | null };
export type VelixEnergySample = { time: number; rms: number };
export type VelixClipHunterAnalysis = { file: string; metadata: VelixClipMetadata; sceneCuts: number[]; silences: Array<{ start: number; end: number }>; energy: VelixEnergySample[]; suggestions: VelixClipSuggestion[] };
export type VelixClipRequest = { root: string; relativePath: string; rightsStatus: 'verified_allowed' | 'conditional' | 'unverified' | 'blocked'; ffprobe?: string; ffmpeg?: string; signal?: AbortSignal };

function abortError(): Error { const error = new Error('análise cancelada'); error.name = 'AbortError'; return error; }
function checkSignal(signal?: AbortSignal): void { if (signal?.aborted) throw abortError(); }
function confinedFile(root: string, relativePath: string): string {
  if (isAbsolute(relativePath)) throw new Error('arquivo fora da raiz autorizada');
  const base = realpathSync(root); const candidate = resolve(base, relativePath); if (!existsSync(candidate)) throw new Error('arquivo fora da raiz autorizada ou inexistente'); const path = realpathSync(candidate);
  if (relative(base, path).startsWith('..') || isAbsolute(relative(base, path)) || !statSync(path).isFile()) throw new Error('arquivo fora da raiz autorizada');
  return path;
}
async function run(binary: string, args: string[], signal?: AbortSignal, label = 'FFmpeg'): Promise<{ stdout: string; stderr: string }> {
  checkSignal(signal);
  try { return await exec(binary, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: VELIX_LIMITS.analysisTimeoutMs, ...(signal ? { signal } : {}) }); } catch (error) {
    if (signal?.aborted) throw abortError();
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} falhou: ${message}`, { cause: error });
  }
}
function parseFps(value: unknown): number | null { if (typeof value !== 'string' || !value.includes('/')) return null; const parts = value.split('/').map(Number); const a = parts[0]; const b = parts[1]; return a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : null; }

const MAX_ENERGY_SAMPLES = 240;

/** One RMS level per second, then averaged down so a long file still draws a short waveform. */
export function parseVelixEnergy(stdout: string): VelixEnergySample[] {
  const samples: VelixEnergySample[] = [];
  let time: number | null = null;
  for (const line of stdout.split(/\r?\n/)) {
    const pts = /pts_time:([0-9.]+)/.exec(line);
    if (pts) time = Number(pts[1]);
    const level = /lavfi\.astats\.Overall\.RMS_level=(-?[0-9.]+|-inf|nan)/.exec(line);
    if (level && time !== null) { const rms = Number(level[1]); samples.push({ time, rms: Number.isFinite(rms) ? rms : -90 }); }
  }
  if (samples.length <= MAX_ENERGY_SAMPLES) return samples;
  const size = Math.ceil(samples.length / MAX_ENERGY_SAMPLES);
  return Array.from({ length: Math.ceil(samples.length / size) }, (_, index) => { const part = samples.slice(index * size, (index + 1) * size); return { time: part[0]?.time ?? 0, rms: part.reduce((sum, item) => sum + item.rms, 0) / part.length }; });
}

/** A suggestion gains the energy criterion only when its audio really is above the file's own upper quartile. */
export function markEnergyPeaks(suggestions: readonly VelixClipSuggestion[], energy: readonly VelixEnergySample[]): VelixClipSuggestion[] {
  if (energy.length < 4) return [...suggestions];
  const sorted = energy.map((item) => item.rms).sort((a, b) => a - b);
  const threshold = sorted[Math.floor(sorted.length * 0.75)] ?? 0;
  if ((sorted.at(-1) ?? 0) <= (sorted[0] ?? 0)) return [...suggestions];
  return suggestions.map((clip) => {
    const inside = energy.filter((item) => item.time >= clip.start && item.time < clip.end);
    if (inside.length === 0 || inside.reduce((sum, item) => sum + item.rms, 0) / inside.length < threshold) return clip;
    return { ...clip, confidence: Math.min(1, clip.confidence + 0.1), criteria: [...clip.criteria, 'audio-energy-peak'] };
  });
}

export async function extractVelixThumbnail(request: { root: string; relativePath: string; time: number; ffmpeg?: string; signal?: AbortSignal }): Promise<Buffer> {
  const path = confinedFile(request.root, request.relativePath);
  const { stdout } = await exec(request.ffmpeg ?? 'ffmpeg', ['-v', 'error', '-ss', String(request.time), '-i', path, '-frames:v', '1', '-vf', 'scale=320:-2', '-f', 'image2pipe', '-c:v', 'mjpeg', '-'], { windowsHide: true, encoding: 'buffer', maxBuffer: 4 * 1024 * 1024, timeout: 60_000, ...(request.signal ? { signal: request.signal } : {}) });
  if (stdout.length === 0) throw new Error('FFmpeg não gerou a miniatura.');
  return stdout;
}

/** FFprobe metadata of a confined media file: one parser for the clip hunter and the Studio acquisition (AS-04). */
async function probeVelixMediaFile(ffprobe: string, path: string, signal?: AbortSignal): Promise<VelixClipMetadata> {
  const probe = await run(ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path], signal, 'ffprobe');
  let parsed: { format?: { duration?: string; format_name?: string }; streams?: Array<{ codec_type?: string; codec_name?: string; width?: number; height?: number; r_frame_rate?: string }> };
  try { parsed = JSON.parse(probe.stdout) as typeof parsed; } catch (error) { throw new Error('ffprobe retornou metadados inválidos', { cause: error }); }
  const streams = parsed.streams ?? []; const video = streams.find((stream) => stream.codec_type === 'video');
  if (!video?.width || !video.height) throw new Error('arquivo não contém uma trilha de vídeo válida');
  const duration = Number(parsed.format?.duration ?? 0); if (!(duration > 0)) throw new Error('duração de vídeo inválida');
  if (duration > VELIX_LIMITS.maxSourceSeconds) throw new Error('vídeo acima do limite de 4 horas');
  const metadata: VelixClipMetadata = { duration, width: video.width, height: video.height, fps: parseFps(video.r_frame_rate), codecs: streams.flatMap((stream) => stream.codec_name ? [stream.codec_name] : []), streams: streams.length, hasAudio: streams.some((stream) => stream.codec_type === 'audio'), format: parsed.format?.format_name ?? null };
  return metadata;
}

export async function probeVelixMedia(request: { root: string; relativePath: string; ffprobe?: string; signal?: AbortSignal }): Promise<VelixClipMetadata> {
  checkSignal(request.signal);
  return probeVelixMediaFile(request.ffprobe ?? 'ffprobe', confinedFile(request.root, request.relativePath), request.signal);
}

export async function analyzeAuthorizedVideo(request: VelixClipRequest): Promise<VelixClipHunterAnalysis> {
  if (request.rightsStatus !== 'verified_allowed') throw new Error('mídia sem direitos verificados não pode ser analisada automaticamente');
  checkSignal(request.signal);
  const path = confinedFile(request.root, request.relativePath);
  const ffprobe = request.ffprobe ?? 'ffprobe'; const ffmpeg = request.ffmpeg ?? 'ffmpeg';
  const metadata = await probeVelixMediaFile(ffprobe, path, request.signal);
  const duration = metadata.duration;
  const scenes = await run(ffmpeg, ['-hide_banner', '-threads', String(VELIX_LIMITS.ffmpegThreads), '-i', path, '-vf', "select='gt(scene,0.3)',showinfo", '-an', '-f', 'null', '-'], request.signal);
  const silences = metadata.hasAudio ? await run(ffmpeg, ['-hide_banner', '-i', path, '-af', 'silencedetect=n=-35dB:d=0.25', '-f', 'null', '-'], request.signal) : { stderr: '' };
  const energyRun = metadata.hasAudio ? await run(ffmpeg, ['-hide_banner', '-v', 'error', '-i', path, '-vn', '-af', 'aresample=8000,asetnsamples=n=8000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-', '-f', 'null', '-'], request.signal) : { stdout: '' };
  const energy = parseVelixEnergy(energyRun.stdout);
  const sceneCuts = [...scenes.stderr.matchAll(/pts_time:([0-9.]+)/g)].map((match) => Number(match[1])).filter(Number.isFinite);
  const silenceStarts = [...silences.stderr.matchAll(/silence_start: ([0-9.]+)/g)].map((match) => Number(match[1])); const silenceEnds = [...silences.stderr.matchAll(/silence_end: ([0-9.]+)/g)].map((match) => Number(match[1]));
  const silenceRanges = silenceStarts.map((start, index) => ({ start, end: silenceEnds[index] ?? duration })).filter((item) => item.end > item.start);
  const suggestions = markEnergyPeaks(suggestClipIntervals({ duration, sceneCuts: [0, ...sceneCuts, duration], silences: silenceRanges }), energy);
  if (suggestions.length === 0) suggestions.push({ id: 'full-duration', start: 0, end: duration, confidence: 0.5, criteria: ['full-duration-no-scene-cut'], accepted: false });
  return { file: request.relativePath, metadata, sceneCuts: [0, ...sceneCuts, duration], silences: silenceRanges, energy, suggestions };
}
