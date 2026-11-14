import { execFile } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const MAX_INPUTS = 200;

/** Duration of an audio file measured by FFprobe, in milliseconds. */
export async function probeAudioDurationMs(path: string, ffprobe = process.env['NB_FFPROBE'] ?? 'ffprobe'): Promise<number> {
  const { stdout } = await exec(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path], { windowsHide: true, maxBuffer: 1_024 * 1_024 });
  const seconds = Number(stdout.trim());
  if (!(seconds > 0)) throw new Error('invalid: o FFprobe não mediu duração no áudio.');
  return Math.round(seconds * 1_000);
}

/**
 * Joins audio blocks in order into one 48 kHz mono PCM WAV. The concat filter re-encodes every input, so blocks with
 * different headers still join without gaps or a lost stream.
 */
export async function concatAudio(inputs: readonly string[], output: string, ffmpeg = process.env['NB_FFMPEG'] ?? 'ffmpeg'): Promise<void> {
  if (!inputs.length) throw new Error('invalid: não há blocos de narração para unir.');
  if (inputs.length > MAX_INPUTS) throw new Error(`invalid: no máximo ${MAX_INPUTS} blocos por narração.`);
  const args = ['-y', '-v', 'error', ...inputs.flatMap((input) => ['-i', input])];
  const filter = `${inputs.map((_input, index) => `[${index}:a]`).join('')}concat=n=${inputs.length}:v=0:a=1[out]`;
  await exec(ffmpeg, [...args, '-filter_complex', filter, '-map', '[out]', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', output], { windowsHide: true, maxBuffer: 4 * 1_024 * 1_024 });
}

/** Cuts [fromMs, toMs) of an audio file into a 48 kHz mono PCM WAV; output seeking keeps the cut sample-accurate. */
export async function cutAudio(input: { source: string; fromMs: number; toMs: number; output: string }, ffmpeg = process.env['NB_FFMPEG'] ?? 'ffmpeg'): Promise<void> {
  if (!(input.toMs > input.fromMs) || input.fromMs < 0) throw new Error('invalid: intervalo de corte de áudio inválido.');
  mkdirSync(dirname(input.output), { recursive: true });
  await exec(ffmpeg, ['-y', '-v', 'error', '-i', input.source, '-ss', (input.fromMs / 1_000).toFixed(3), '-t', ((input.toMs - input.fromMs) / 1_000).toFixed(3), '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', input.output], { windowsHide: true, maxBuffer: 4 * 1_024 * 1_024 });
}

/**
 * AP-04 E2: the quiet stretches of a narration block (silencedetect), including the ones the voice leaves at the start and
 * end. Short thresholds on purpose: a sentence end inside a TTS block is often a gap of 80–300 ms.
 */
export async function audioGaps(path: string, options: { noiseDb?: number; minMs?: number } = {}, ffmpeg = process.env['NB_FFMPEG'] ?? 'ffmpeg'): Promise<Array<{ startMs: number; durationMs: number }>> {
  const noise = options.noiseDb ?? -40;
  const minSeconds = (options.minMs ?? 60) / 1_000;
  const { stderr } = await exec(ffmpeg, ['-hide_banner', '-nostats', '-i', path, '-af', `silencedetect=noise=${noise}dB:d=${minSeconds.toFixed(3)}`, '-f', 'null', '-'], { windowsHide: true, maxBuffer: 16 * 1_024 * 1_024 });
  const gaps: Array<{ startMs: number; durationMs: number }> = [];
  let start: number | null = null;
  for (const line of stderr.split(/\r?\n/u)) {
    const began = /silence_start:\s*(-?[\d.]+)/u.exec(line);
    if (began) start = Math.max(0, Number(began[1]) * 1_000);
    const ended = /silence_end:\s*([\d.]+)\s*\|\s*silence_duration:\s*([\d.]+)/u.exec(line);
    if (ended) { const end = Number(ended[1]) * 1_000; const from = start ?? end - Number(ended[2]) * 1_000; gaps.push({ startMs: Math.round(from), durationMs: Math.round(end - from) }); start = null; }
  }
  // A silence still open at the end of the file has no silence_end line; the planner only needs the inner gaps.
  return gaps;
}

/**
 * AP-04 E2: copies a narration block adding silence at the given instants (ms of the source), without touching the
 * spoken audio: the prosody of the block stays continuous and only the pauses grow. Output is 48 kHz mono PCM, as the
 * other narration helpers.
 */
export async function insertSilences(input: { source: string; output: string; insertions: ReadonlyArray<{ atMs: number; durationMs: number; fill?: { fromMs: number; toMs: number } }> }, ffmpeg = process.env['NB_FFMPEG'] ?? 'ffmpeg'): Promise<void> {
  const insertions = [...input.insertions].filter((item) => item.durationMs > 0).sort((a, b) => a.atMs - b.atMs);
  if (insertions.some((item, index) => item.atMs < 0 || (index > 0 && item.atMs <= (insertions[index - 1]?.atMs ?? 0)))) throw new Error('invalid: pontos de pausa inválidos.');
  if (insertions.length > MAX_INPUTS) throw new Error(`invalid: no máximo ${MAX_INPUTS} pausas por bloco.`);
  mkdirSync(dirname(input.output), { recursive: true });
  const parts: string[] = [];
  const labels: string[] = [];
  let from = 0;
  insertions.forEach((item, index) => {
    parts.push(`[0:a]atrim=start=${(from / 1_000).toFixed(4)}:end=${(item.atMs / 1_000).toFixed(4)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono[p${index}]`);
    const seconds = (item.durationMs / 1_000).toFixed(4);
    // Room tone: the block's own quiet stretch looped to length, so the pause sounds like the voice's pause, not a dropout.
    const fill = item.fill && item.fill.toMs - item.fill.fromMs >= 10 ? item.fill : null;
    parts.push(fill
      ? `[0:a]atrim=start=${(fill.fromMs / 1_000).toFixed(4)}:end=${(fill.toMs / 1_000).toFixed(4)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono,aloop=loop=-1:size=${Math.max(1, Math.round((fill.toMs - fill.fromMs) * 48))},atrim=end=${seconds},asetpts=PTS-STARTPTS[s${index}]`
      : `aevalsrc=0:s=48000:c=mono:d=${seconds},aformat=sample_fmts=s16:channel_layouts=mono[s${index}]`);
    labels.push(`[p${index}]`, `[s${index}]`);
    from = item.atMs;
  });
  parts.push(`[0:a]atrim=start=${(from / 1_000).toFixed(4)},asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=s16:channel_layouts=mono[tail]`);
  labels.push('[tail]');
  const filter = `${parts.join(';')};${labels.join('')}concat=n=${labels.length}:v=0:a=1[out]`;
  await exec(ffmpeg, ['-y', '-v', 'error', '-i', input.source, '-filter_complex', filter, '-map', '[out]', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', input.output], { windowsHide: true, maxBuffer: 4 * 1_024 * 1_024 });
}
