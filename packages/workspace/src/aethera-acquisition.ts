import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { runVelixCommand, velixImportError } from './velix.js';

/**
 * yt-dlp for the Aethera Studio media hunter (AS-04). It reuses the Velix runner (process-tree cancel) and its error
 * diagnosis; this module only adds what acquisition needs: metadata without download, search without an API key,
 * 1080p-first format choice, resumable downloads and progress. yt-dlp is the user's own install and may be missing.
 */

export interface YtDlpCommand { command: string; prefix: readonly string[] }
export const defaultYtDlp = (): YtDlpCommand => ({ command: process.env['NB_PYTHON'] ?? 'python', prefix: ['-m', 'yt_dlp'] });

export interface YtDlpChapter {
  startSec: number;
  endSec: number;
  title: string;
}

export interface YtDlpVideoInfo {
  id: string; url: string; title: string; channel: string; channelVerified: boolean; durationSeconds: number | null;
  maxHeight: number | null; uploadDate: string | null; license: string | null; thumbnail: string | null; isLive: boolean;
  description?: string;
  chapters?: YtDlpChapter[];
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
  const rawChapters = Array.isArray(raw['chapters']) ? (raw['chapters'] as Array<Record<string, unknown>>) : [];
  const chapters: YtDlpChapter[] = rawChapters
    .map((ch) => ({
      startSec: typeof ch['start_time'] === 'number' ? ch['start_time'] : Number.NaN,
      endSec: typeof ch['end_time'] === 'number' ? ch['end_time'] : Number.NaN,
      title: typeof ch['title'] === 'string' ? ch['title'].trim() : '',
    }))
    .filter((ch) => Number.isFinite(ch.startSec) && Number.isFinite(ch.endSec) && ch.endSec > ch.startSec && ch.title.length > 0);
  const description = typeof raw['description'] === 'string' && raw['description'].trim() ? raw['description'].slice(0, 4000) : undefined;
  return {
    id, url, title, channel, channelVerified: raw['channel_is_verified'] === true,
    durationSeconds: typeof raw['duration'] === 'number' ? raw['duration'] : null, maxHeight: height && height > 0 ? Math.round(height) : null,
    uploadDate: upload, license: typeof raw['license'] === 'string' ? raw['license'] : null, thumbnail: typeof raw['thumbnail'] === 'string' ? raw['thumbnail'] : null, isLive: raw['is_live'] === true,
    ...(description ? { description } : {}),
    ...(chapters.length > 0 ? { chapters } : {}),
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

export function buildAcquisitionFormat(maxHeight?: number): string {
  if (!maxHeight || !Number.isFinite(maxHeight) || maxHeight <= 0) {
    return ACQUISITION_FORMAT;
  }
  const h = Math.round(maxHeight);
  // Prefer single-stream progressive MP4 <=720p first so --download-sections seeks cleanly in one HTTP Range pass,
  // then fall back to separated H.264+M4A streams.
  return `b[height<=${h}][ext=mp4]/bv*[height<=${h}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<=${h}]+ba/b[height<=${h}]/bv*[vcodec^=avc1]+ba[ext=m4a]/b`;
}

export function buildAcquisitionArgs(input: {
  url: string;
  directory: string;
  fileStem: string;
  ffmpeg?: string;
  maxHeight?: number;
  downloadSection?: string;
  maxFilesize?: string;
}): string[] {
  const url = new URL(input.url);
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('invalid: a origem precisa ser http(s).');
  if (!/^[a-z0-9._-]{1,80}$/i.test(input.fileStem)) throw new Error('invalid: nome de arquivo inválido.');
  return [
    '--no-playlist', '--continue', '--no-overwrites', '--restrict-filenames', '--no-warnings', '--newline',
    '--progress-template', `download:${PROGRESS_TAG} %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s`,
    '--print', 'after_move:filepath', '-f', buildAcquisitionFormat(input.maxHeight), '--merge-output-format', 'mp4',
    ...(input.downloadSection ? ['--download-sections', input.downloadSection] : []),
    // Only enforce --max-filesize on full-file downloads; with --download-sections it rejects long source videos before cutting the clip.
    ...(input.maxFilesize && !input.downloadSection ? ['--max-filesize', input.maxFilesize] : []),
    ...(input.ffmpeg && (isAbsolute(input.ffmpeg) || existsSync(input.ffmpeg)) ? ['--ffmpeg-location', input.ffmpeg] : []), '-P', input.directory, '-o', `${input.fileStem}.%(ext)s`, '--', url.href,
  ];
}

export function parseSectionDurationSec(sectionOrLine: string): number | null {
  const rangeMatch = /Downloading\s+\d+\s+time\s+ranges?:\s*(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)/i.exec(sectionOrLine);
  if (rangeMatch?.[1] && rangeMatch[2]) {
    const dur = Number(rangeMatch[2]) - Number(rangeMatch[1]);
    return dur > 0 ? dur : null;
  }
  const secMatch = /^\*?(\d+):(\d{2})(?::(\d{2}))?-(\d+):(\d{2})(?::(\d{2}))?$/.exec(sectionOrLine.trim());
  if (secMatch) {
    const toSec = (a: string, b: string, c?: string) =>
      c !== undefined ? Number(a) * 3600 + Number(b) * 60 + Number(c) : Number(a) * 60 + Number(b);
    const start = toSec(secMatch[1]!, secMatch[2]!, secMatch[3]);
    const end = toSec(secMatch[4]!, secMatch[5]!, secMatch[6]);
    return end > start ? end - start : null;
  }
  return null;
}

export function parseAcquisitionProgress(
  line: string,
  sectionDurationSec?: number | null,
): { bytesDone: number; bytesTotal: number | null } | null {
  const match = new RegExp(`${PROGRESS_TAG} (\\d+|NA) (\\d+|NA) ([\\d.]+|NA)`).exec(line);
  if (match && match[1] !== 'NA') {
    const total = match[2] !== 'NA' ? Number(match[2]) : match[3] !== 'NA' ? Math.round(Number(match[3])) : null;
    return { bytesDone: Number(match[1]), bytesTotal: total };
  }
  const ffMatch = /(?:L?size=\s*(\d+)(KiB|kB|MiB|MB|B)?\s+)?time=(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(line);
  if (ffMatch) {
    const rawSize = ffMatch[1] ? Number(ffMatch[1]) : 0;
    const unit = ffMatch[2] ?? 'KiB';
    const mult = unit === 'MiB' || unit === 'MB' ? 1024 * 1024 : unit === 'B' ? 1 : 1024;
    const bytesDone = rawSize * mult;
    const timeSec = Number(ffMatch[3]) * 3600 + Number(ffMatch[4]) * 60 + Number(ffMatch[5]);
    if (timeSec <= 0 && bytesDone <= 0) return null;
    const ratio = sectionDurationSec && sectionDurationSec > 0 ? Math.min(0.99, timeSec / sectionDurationSec) : null;
    const bytesTotal = ratio && ratio > 0.01 && bytesDone > 0 ? Math.round(bytesDone / ratio) : null;
    return { bytesDone, bytesTotal };
  }
  return null;
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
export async function acquireWithYtDlp(input: {
  ytDlp: YtDlpCommand;
  url: string;
  root: string;
  relativeDir: string;
  fileStem: string;
  ffmpeg?: string;
  maxHeight?: number;
  downloadSection?: string;
  maxFilesize?: string;
  signal?: AbortSignal;
  onProgress?: (progress: { bytesDone: number; bytesTotal: number | null }) => void;
}): Promise<{ relativePath: string; bytesTransferred: number; downloadMs: number; durationSec?: number }> {
  const startedAt = Date.now();
  if (isAbsolute(input.relativeDir) || input.relativeDir.split(/[/\\]/).includes('..')) throw new Error('forbidden: a pasta de mídia precisa ficar dentro do projeto.');
  const base = realpathSync(input.root);
  const directory = resolve(base, input.relativeDir);
  mkdirSync(directory, { recursive: true });
  let buffer = '';
  let printed: string | null = null;
  let sectionDurationSec = input.downloadSection ? parseSectionDurationSec(input.downloadSection) : null;
  const onOutput = (text: string) => {
    buffer += text;
    const lines = buffer.split(/\r\n|\r|\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const parsedDur = parseSectionDurationSec(line);
      if (parsedDur) sectionDurationSec = parsedDur;
      const progress = parseAcquisitionProgress(line, sectionDurationSec);
      if (progress) input.onProgress?.(progress);
      else if (line.trim() && !line.includes(PROGRESS_TAG) && /\.(mp4|mkv|webm)$/i.test(line.trim())) printed = line.trim();
    }
  };
  try {
    await runVelixCommand(
      input.ytDlp.command,
      [
        ...input.ytDlp.prefix,
        ...buildAcquisitionArgs({
          url: input.url,
          directory,
          fileStem: input.fileStem,
          ...(input.ffmpeg ? { ffmpeg: input.ffmpeg } : {}),
          ...(input.maxHeight !== undefined ? { maxHeight: input.maxHeight } : {}),
          ...(input.downloadSection ? { downloadSection: input.downloadSection } : {}),
          ...(input.maxFilesize ? { maxFilesize: input.maxFilesize } : {}),
        }),
      ],
      { cwd: directory, ...(input.signal ? { signal: input.signal } : {}), onOutput },
    );
  } catch (error) {
    throw new Error(classifyAcquisitionError(input.signal?.aborted ? 'cancelled:' : error instanceof Error ? error.message : String(error)).message, { cause: error });
  }
  if (buffer.trim() && /\.(mp4|mkv|webm)$/i.test(buffer.trim())) printed = buffer.trim();
  const final = printed ?? join(directory, `${input.fileStem}.mp4`);
  if (!existsSync(final)) throw new Error('unavailable: o yt-dlp terminou sem gerar o arquivo.');
  const realFinal = realpathSync(final);
  const inside = relative(base, realFinal);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) throw new Error('forbidden: o arquivo baixado ficou fora do projeto.');
  const bytesTransferred = statSync(realFinal).size;
  return {
    relativePath: inside.split('\\').join('/'),
    bytesTransferred,
    downloadMs: Date.now() - startedAt,
    ...(sectionDurationSec ? { durationSec: sectionDurationSec } : {}),
  };
}
