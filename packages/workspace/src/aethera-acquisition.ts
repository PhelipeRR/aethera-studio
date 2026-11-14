import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { runVelixCommand, velixImportError } from './velix.js';

/**
 * yt-dlp for the Aethera Studio media hunter (AS-04). It reuses the Velix runner (process-tree cancel) and its error
 * diagnosis; this module only adds what acquisition needs: metadata without download, search without an API key,
 * 1080p-first format choice, resumable downloads and progress. yt-dlp is the user's own install and may be missing.
 */

export interface YtDlpCommand { command: string; prefix: readonly string[] }
export const defaultYtDlp = (): YtDlpCommand => ({ command: process.env['NB_PYTHON'] ?? 'python', prefix: ['-m', 'yt_dlp'] });

export interface YtDlpVideoInfo {
  id: string; url: string; title: string; channel: string; channelVerified: boolean; durationSeconds: number | null;
  maxHeight: number | null; uploadDate: string | null; license: string | null; thumbnail: string | null; isLive: boolean;
}

/** One `-j` line of yt-dlp into the fields the Studio uses; anything that is not a video is ignored. */
export function parseYtDlpInfo(line: string): YtDlpVideoInfo | null {
  let raw: Record<string, unknown>;
  try { raw = JSON.parse(line) as Record<string, unknown>; } catch { return null; }
  const id = typeof raw['id'] === 'string' ? raw['id'] : null;
  const url = typeof raw['webpage_url'] === 'string' ? raw['webpage_url'] : null;
  const title = typeof raw['title'] === 'string' ? raw['title'] : null;
  if (!id || !url || !title || !/^https?:\/\//i.test(url)) return null;
  const formats = Array.isArray(raw['formats']) ? (raw['formats'] as Array<Record<string, unknown>>) : [];
  const heights = formats.map((format) => (typeof format['height'] === 'number' && format['vcodec'] !== 'none' ? format['height'] : 0)).filter((height) => height > 0);
  const height = heights.length ? Math.max(...heights) : typeof raw['height'] === 'number' ? raw['height'] : null;
  const upload = typeof raw['upload_date'] === 'string' && /^\d{8}$/.test(raw['upload_date']) ? `${raw['upload_date'].slice(0, 4)}-${raw['upload_date'].slice(4, 6)}-${raw['upload_date'].slice(6, 8)}` : null;
  const channel = typeof raw['channel'] === 'string' ? raw['channel'] : typeof raw['uploader'] === 'string' ? raw['uploader'] : '';
  return {
    id, url, title, channel, channelVerified: raw['channel_is_verified'] === true,
    durationSeconds: typeof raw['duration'] === 'number' ? raw['duration'] : null, maxHeight: height && height > 0 ? Math.round(height) : null,
    uploadDate: upload, license: typeof raw['license'] === 'string' ? raw['license'] : null, thumbnail: typeof raw['thumbnail'] === 'string' ? raw['thumbnail'] : null, isLive: raw['is_live'] === true,
  };
}

async function ytDlpJson(ytDlp: YtDlpCommand, targets: string[], signal?: AbortSignal): Promise<YtDlpVideoInfo[]> {
  const args = [...ytDlp.prefix, '-j', '--skip-download', '--no-warnings', '--no-playlist', '--ignore-errors', '--', ...targets];
  const stdout = await new Promise<string>((done, fail) => {
    execFile(ytDlp.command, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 180_000, env: { ...process.env, PYTHONUTF8: '1' }, ...(signal ? { signal } : {}) }, (error, out, err) => {
      if (signal?.aborted) return fail(new Error('cancelled: consulta interrompida.'));
      // With --ignore-errors yt-dlp exits non-zero when one target failed; the others are still in stdout.
      if (error && !out) return fail(new Error(classifyAcquisitionError(`${error.message} ${String(err)}`).message));
      done(String(out));
    });
  });
  return stdout.split(/\r?\n/).map(parseYtDlpInfo).filter((info): info is YtDlpVideoInfo => info !== null && !info.isLive);
}

/** Metadata of known video URLs (e.g. the YouTube ids IGDB links to a game), without downloading. */
export function ytDlpVideoInfo(ytDlp: YtDlpCommand, urls: readonly string[], signal?: AbortSignal): Promise<YtDlpVideoInfo[]> {
  const safe = urls.filter((url) => /^https:\/\//i.test(url));
  return safe.length ? ytDlpJson(ytDlp, safe, signal) : Promise.resolve([]);
}

/** YouTube search through yt-dlp (no API key). The query is one argument, never a shell string. */
export function ytDlpSearch(ytDlp: YtDlpCommand, query: string, count: number, signal?: AbortSignal): Promise<YtDlpVideoInfo[]> {
  const clean = query.replace(/[\r\n]/g, ' ').trim().slice(0, 200);
  if (!clean) return Promise.resolve([]);
  return ytDlpJson(ytDlp, [`ytsearch${Math.max(1, Math.min(10, Math.floor(count)))}:${clean}`], signal);
}

/** The installed yt-dlp version, recorded in each asset's provenance; null when yt-dlp is missing. */
export function ytDlpVersion(ytDlp: YtDlpCommand): Promise<string | null> {
  return new Promise((done) => execFile(ytDlp.command, [...ytDlp.prefix, '--version'], { windowsHide: true, timeout: 15_000 }, (error, stdout) => done(error ? null : String(stdout).trim() || null)));
}

/** 1080p or more first (H.264 for playback on Windows), then the best available. */
export const ACQUISITION_FORMAT = 'bv*[height>=1080][vcodec^=avc1]+ba[ext=m4a]/bv*[height>=1080]+ba/bv*[vcodec^=avc1]+ba[ext=m4a]/bv*+ba/b';
export const ACQUISITION_FORMAT_ID = 'video-1080p-plus';
const PROGRESS_TAG = 'NBPROG';

export function buildAcquisitionArgs(input: { url: string; directory: string; fileStem: string; ffmpeg?: string }): string[] {
  const url = new URL(input.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('invalid: a origem precisa ser http(s).');
  if (!/^[a-z0-9._-]{1,80}$/i.test(input.fileStem)) throw new Error('invalid: nome de arquivo inválido.');
  return [
    '--no-playlist', '--continue', '--no-overwrites', '--restrict-filenames', '--no-warnings', '--newline',
    '--progress-template', `download:${PROGRESS_TAG} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s`,
    '--print', 'after_move:filepath', '-f', ACQUISITION_FORMAT, '--merge-output-format', 'mp4',
    ...(input.ffmpeg ? ['--ffmpeg-location', input.ffmpeg] : []), '-P', input.directory, '-o', `${input.fileStem}.%(ext)s`, '--', url.href,
  ];
}

export function parseAcquisitionProgress(line: string): { bytesDone: number; bytesTotal: number | null } | null {
  const match = new RegExp(`${PROGRESS_TAG} (\\d+|NA) (\\d+|NA) ([\\d.]+|NA)`).exec(line);
  if (!match || match[1] === 'NA') return null;
  const total = match[2] !== 'NA' ? Number(match[2]) : match[3] !== 'NA' ? Math.round(Number(match[3])) : null;
  return { bytesDone: Number(match[1]), bytesTotal: total };
}

export type AcquisitionErrorCode = 'unavailable' | 'forbidden' | 'format' | 'network' | 'tool_missing' | 'tool_outdated' | 'cancelled';
/** Maps yt-dlp failures to the Studio's typed errors; only network trouble and a site refusal are worth retrying. */
export function classifyAcquisitionError(message: string): { code: AcquisitionErrorCode; retryable: boolean; message: string } {
  if (/^cancelled:|AbortError|aborted/i.test(message)) return { code: 'cancelled', retryable: false, message: 'cancelled: aquisição interrompida.' };
  if (/ENOENT|No module named yt_dlp|not recognized as an internal/i.test(message)) return { code: 'tool_missing', retryable: false, message: 'tool_missing: yt-dlp não encontrado. Instale com python -m pip install --user -U "yt-dlp[default]" ou importe o arquivo manualmente.' };
  if (/Requested format is not available/i.test(message)) return { code: 'format', retryable: false, message: `format: ${velixImportError(message)}` };
  if (/HTTP Error 403|Sign in to confirm/i.test(message)) return { code: 'forbidden', retryable: true, message: `forbidden: ${velixImportError(message)}` };
  if (/Video unavailable|Private video|has been removed|This video is not available|members-only|age.restricted|copyright claim/i.test(message)) return { code: 'unavailable', retryable: false, message: `unavailable: ${message.slice(-300)}` };
  if (/timed out|ECONNRESET|ENOTFOUND|EAI_AGAIN|Connection (reset|refused)|Temporary failure|HTTP Error 5\d\d|Read timed out|IncompleteRead/i.test(message)) return { code: 'network', retryable: true, message: `network: ${message.slice(-300)}` };
  if (/Unsupported URL|please report this issue|ExtractorError/i.test(message)) return { code: 'tool_outdated', retryable: false, message: `tool_outdated: ${velixImportError(message).slice(-300)}` };
  return { code: 'network', retryable: true, message: `network: ${message.slice(-300)}` };
}

/**
 * Downloads one source into `<root>/<relativeDir>/<fileStem>.mp4`. `--continue` keeps the `.part` file of an
 * interrupted download, so the next attempt resumes instead of starting over. Returns the path relative to root.
 */
export async function acquireWithYtDlp(input: { ytDlp: YtDlpCommand; url: string; root: string; relativeDir: string; fileStem: string; ffmpeg?: string; signal?: AbortSignal; onProgress?: (progress: { bytesDone: number; bytesTotal: number | null }) => void }): Promise<{ relativePath: string }> {
  if (isAbsolute(input.relativeDir) || input.relativeDir.split(/[/\\]/).includes('..')) throw new Error('forbidden: a pasta de mídia precisa ficar dentro do projeto.');
  const base = realpathSync(input.root);
  const directory = resolve(base, input.relativeDir);
  mkdirSync(directory, { recursive: true });
  let buffer = '';
  let printed: string | null = null;
  const onOutput = (text: string) => {
    buffer += text;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const progress = parseAcquisitionProgress(line);
      if (progress) input.onProgress?.(progress);
      else if (line.trim() && !line.includes(PROGRESS_TAG) && /\.(mp4|mkv|webm)$/i.test(line.trim())) printed = line.trim();
    }
  };
  try {
    await runVelixCommand(input.ytDlp.command, [...input.ytDlp.prefix, ...buildAcquisitionArgs({ url: input.url, directory, fileStem: input.fileStem, ...(input.ffmpeg ? { ffmpeg: input.ffmpeg } : {}) })], { cwd: directory, ...(input.signal ? { signal: input.signal } : {}), onOutput });
  } catch (error) {
    throw new Error(classifyAcquisitionError(input.signal?.aborted ? 'cancelled:' : error instanceof Error ? error.message : String(error)).message, { cause: error });
  }
  if (buffer.trim() && /\.(mp4|mkv|webm)$/i.test(buffer.trim())) printed = buffer.trim();
  const final = printed ?? join(directory, `${input.fileStem}.mp4`);
  if (!existsSync(final)) throw new Error('unavailable: o yt-dlp terminou sem gerar o arquivo.');
  const inside = relative(base, realpathSync(final));
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('forbidden: o arquivo baixado ficou fora do projeto.');
  return { relativePath: inside.split('\\').join('/') };
}
