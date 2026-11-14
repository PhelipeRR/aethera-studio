import { execFile } from 'node:child_process';
import { mkdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import { platform } from 'node:os';
import { promisify } from 'node:util';
import { VELIX_LIMITS } from './velix-discovery.js';
import { runExclusiveRender } from './aethera-visual-scheduler.js';

const exec = promisify(execFile);
export type VelixTimelineClip = { start: number; end: number };
export type VelixClipRenderRequest = { root: string; sourceRelativePath: string; outputRelativePath: string; clips: VelixTimelineClip[]; rightsStatus: 'verified_allowed' | 'conditional' | 'unverified' | 'blocked'; narrationRelativePath?: string; narrationOffset?: number; narrationVolume?: number; originalVolume?: number; ffmpeg?: string; ffprobe?: string; signal?: AbortSignal };
/** What the montage adds around the cuts: all optional, and a plain concat stays exactly as it was. */
export type VelixMontageOptions = { transition?: 'cut' | 'fade'; positionCards?: string[]; musicRelativePath?: string; musicVolume?: number };
export type VelixClipRenderResult = { outputPath: string; duration: number; hasVideo: boolean; hasAudio: boolean };

function inside(root: string, value: string): string { if (isAbsolute(value)) throw new Error('caminho fora da raiz'); const base = realpathSync(root); const path = resolve(base, value); const rel = relative(base, path); if (isAbsolute(rel) || rel.startsWith('..')) throw new Error('caminho fora da raiz autorizada'); return path; }
async function run(binary: string, args: string[], signal?: AbortSignal): Promise<{ stdout: string; stderr: string }> { try { return await exec(binary, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024, timeout: VELIX_LIMITS.renderTimeoutMs, ...(signal ? { signal } : {}) }); } catch (error) { if (signal?.aborted) { const cancelled = new Error('renderização cancelada'); cancelled.name = 'AbortError'; throw cancelled; } throw new Error(`FFmpeg/FFprobe falhou: ${error instanceof Error ? error.message : String(error)}`, { cause: error }); } }
async function probe(file: string, binary: string, signal?: AbortSignal): Promise<{ duration: number; hasVideo: boolean; hasAudio: boolean }> { const result = await run(binary, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], signal); const parsed = JSON.parse(result.stdout) as { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> }; const streams = parsed.streams ?? []; return { duration: Number(parsed.format?.duration ?? 0), hasVideo: streams.some((stream) => stream.codec_type === 'video'), hasAudio: streams.some((stream) => stream.codec_type === 'audio') }; }

const FADE_SECONDS = 0.25;
const defaultFont = () => (platform() === 'win32' ? 'C\\:/Windows/Fonts/arial.ttf' : '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf');
export const escapeDrawtext = (text: string) => text.replace(/\\/g, '\\\\\\\\').replace(/'/g, '\u2019').replace(/:/g, '\\:').replace(/%/g, '\\%');

export function renderVelixClipTimeline(request: VelixClipRenderRequest & VelixMontageOptions): Promise<VelixClipRenderResult> {
  return runExclusiveRender(() => renderVelixClipTimelineUnlocked(request), request.signal);
}

async function renderVelixClipTimelineUnlocked(request: VelixClipRenderRequest & VelixMontageOptions): Promise<VelixClipRenderResult> {
  if (request.rightsStatus !== 'verified_allowed') throw new Error('mídia sem direitos verificados não pode ser renderizada');
  if (request.clips.length === 0) throw new Error('nenhum intervalo aprovado');
  const source = inside(request.root, request.sourceRelativePath); if (!statSync(source).isFile()) throw new Error('arquivo fonte inválido');
  const output = inside(request.root, request.outputRelativePath); const sourceInfo = await probe(source, request.ffprobe ?? 'ffprobe', request.signal);
  const narration = request.narrationRelativePath ? inside(request.root, request.narrationRelativePath) : null;
  const music = request.musicRelativePath ? inside(request.root, request.musicRelativePath) : null;
  const musicInfo = music ? await probe(music, request.ffprobe ?? 'ffprobe', request.signal) : null;
  if (music && (!statSync(music).isFile() || !musicInfo?.hasAudio)) throw new Error('música inválida ou sem stream de áudio');
  const musicVolume = request.musicVolume ?? 0.2; if (!Number.isFinite(musicVolume) || musicVolume < 0) throw new Error('volume da música inválido');
  if (request.positionCards && request.positionCards.length !== request.clips.length) throw new Error('cada corte precisa do seu cartão de posição');
  const narrationInfo = narration ? await probe(narration, request.ffprobe ?? 'ffprobe', request.signal) : null;
  if (narration && (!statSync(narration).isFile() || !narrationInfo?.hasAudio)) throw new Error('narração inválida ou sem stream de áudio');
  const originalVolume = request.originalVolume ?? 1; const narrationVolume = request.narrationVolume ?? 1; const narrationOffset = request.narrationOffset ?? 0;
  if (![originalVolume, narrationVolume, narrationOffset].every(Number.isFinite) || originalVolume < 0 || narrationVolume < 0 || narrationOffset < 0) throw new Error('configuração de áudio inválida');
  if (!sourceInfo.hasVideo || !(sourceInfo.duration > 0)) throw new Error('arquivo fonte sem vídeo válido');
  for (const clip of request.clips) if (!Number.isFinite(clip.start) || !Number.isFinite(clip.end) || clip.start < 0 || clip.end <= clip.start || clip.end > sourceInfo.duration + 0.01) throw new Error('intervalo de corte inválido');
  mkdirSync(resolve(output, '..'), { recursive: true });
  const filters: string[] = []; const concatLabels: string[] = [];
  const fade = request.transition === 'fade';
  request.clips.forEach((clip, index) => {
    const length = clip.end - clip.start;
    const edge = fade ? Math.min(FADE_SECONDS, length / 2) : 0;
    const fades = fade ? `,fade=t=in:st=0:d=${edge},fade=t=out:st=${length - edge}:d=${edge}` : '';
    const card = request.positionCards?.[index];
    const text = card ? `,drawtext=fontfile='${defaultFont()}':text='${escapeDrawtext(card)}':fontcolor=white:fontsize=h/8:box=1:boxcolor=black@0.55:boxborderw=12:x=(w-text_w)/2:y=h/12:enable='lt(t,${Math.min(2.5, length)})'` : '';
    filters.push(`[0:v]trim=start=${clip.start}:end=${clip.end},setpts=PTS-STARTPTS${fades}${text}[v${index}]`);
    concatLabels.push(`[v${index}]`);
    if (sourceInfo.hasAudio) { filters.push(`[0:a]atrim=start=${clip.start}:end=${clip.end},asetpts=PTS-STARTPTS${fade ? `,afade=t=in:st=0:d=${edge},afade=t=out:st=${length - edge}:d=${edge}` : ''}[a${index}]`); concatLabels.push(`[a${index}]`); }
  });
  if (sourceInfo.hasAudio) filters.push(`${concatLabels.join('')}concat=n=${request.clips.length}:v=1:a=1[outv][outa]`); else filters.push(`${concatLabels.join('')}concat=n=${request.clips.length}:v=1:a=0[outv]`);
  const totalDuration = request.clips.reduce((sum, clip) => sum + clip.end - clip.start, 0);
  let audioMap: string[] = sourceInfo.hasAudio ? ['-map', '[outa]', '-c:a', 'aac'] : ['-an'];
  const inputs = ['-y', '-i', source];
  const layers: string[] = [];
  if (sourceInfo.hasAudio && (narration || music)) { filters.push(`[outa]volume=${originalVolume}[orig]`); layers.push('[orig]'); }
  if (narration) {
    inputs.push('-i', narration);
    const delay = Math.round(narrationOffset * 1000);
    filters.push(`[1:a]adelay=${delay}|${delay},volume=${narrationVolume},apad,atrim=duration=${totalDuration}[narr]`);
    layers.push('[narr]');
  }
  if (music) {
    inputs.push('-i', music);
    filters.push(`[${narration ? 2 : 1}:a]volume=${musicVolume},apad,atrim=duration=${totalDuration}[music]`);
    layers.push('[music]');
  }
  if (layers.length > 1) { filters.push(`${layers.join('')}amix=inputs=${layers.length}:duration=first:dropout_transition=0[audio]`); audioMap = ['-map', '[audio]', '-c:a', 'aac']; }
  else if (layers[0]) { filters.push(`${layers[0]}atrim=duration=${totalDuration}[audio]`); audioMap = ['-map', '[audio]', '-c:a', 'aac']; }
  const args = [...inputs, '-threads', String(VELIX_LIMITS.ffmpegThreads), '-filter_complex', filters.join(';'), '-map', '[outv]', ...audioMap, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-t', String(totalDuration), output];
  await run(request.ffmpeg ?? 'ffmpeg', args, request.signal); const rendered = await probe(output, request.ffprobe ?? 'ffprobe', request.signal); if (!rendered.hasVideo || !exists(output)) throw new Error('FFmpeg não gerou um MP4 válido');
  return { outputPath: request.outputRelativePath, ...rendered };
}

function exists(path: string): boolean { try { return statSync(path).isFile(); } catch { return false; } }
