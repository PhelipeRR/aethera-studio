import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo, Socket } from 'node:net';
import { join } from 'node:path';

export interface CandidateIntervalHint {
  startSec: number;
  endSec: number;
  title?: string;
  weight?: number;
}

export interface AdaptiveSampleInput {
  durationSec?: number;
  chapters?: CandidateIntervalHint[];
  targetInterval?: { startSec: number; endSec: number };
  entities?: string[];
  query?: string;
}

export interface RemoteFrameSampleTelemetry {
  framesRequested: number;
  framesExtracted: number;
  bytesTransferred: number;
  bytesSource: 'http_range_proxy' | 'ffmpeg_avio' | 'output_file_fallback';
  requestsCount: number;
  latencyMs: number;
  seekSupported: boolean;
  successRate: number;
  abortedReason?: string;
}

export interface RemoteFrameSampleResult {
  framePaths: string[];
  timestampsSec: number[];
  telemetry: RemoteFrameSampleTelemetry;
}

export interface RemoteSamplingCacheEntry {
  mediaIdentifier: string;
  intervalKey: string;
  sourceVersion?: string;
  streamUrl?: string | null;
  streamResolvedAtMs?: number;
  streamTtlMs: number;
  preDownloadVerdict?: 'passed_pre_download' | 'rejected_pre_download' | 'fallback_partial_download';
  reasons?: string[];
  telemetry?: RemoteFrameSampleTelemetry;
  updatedAtMs: number;
}

/**
 * Cache of remote stream URLs and pre-download verification results keyed by (mediaIdentifier, intervalKey).
 * Respects stream URL TTL and invalidates automatically if `sourceVersion` changes.
 */
export class RemoteSamplingCache {
  private readonly entries = new Map<string, RemoteSamplingCacheEntry>();
  private readonly defaultTtlMs: number;

  constructor(defaultTtlMs = 15 * 60 * 1000) {
    this.defaultTtlMs = defaultTtlMs;
  }

  private keyOf(mediaIdentifier: string, intervalKey: string): string {
    return createHash('sha1').update(`${mediaIdentifier}|${intervalKey}`).digest('hex');
  }

  get(
    mediaIdentifier: string,
    intervalKey: string,
    sourceVersion?: string,
    nowMs = Date.now(),
  ): RemoteSamplingCacheEntry | undefined {
    const k = this.keyOf(mediaIdentifier, intervalKey);
    const entry = this.entries.get(k);
    if (!entry) return undefined;
    if (sourceVersion && entry.sourceVersion && entry.sourceVersion !== sourceVersion) {
      this.entries.delete(k);
      return undefined;
    }
    const age = nowMs - (entry.streamResolvedAtMs ?? entry.updatedAtMs);
    if (age > (entry.streamTtlMs || this.defaultTtlMs)) {
      this.entries.delete(k);
      return undefined;
    }
    return entry;
  }

  set(entry: Omit<RemoteSamplingCacheEntry, 'streamTtlMs' | 'updatedAtMs'> & { streamTtlMs?: number }): void {
    const k = this.keyOf(entry.mediaIdentifier, entry.intervalKey);
    this.entries.set(k, {
      ...entry,
      streamTtlMs: entry.streamTtlMs ?? this.defaultTtlMs,
      updatedAtMs: Date.now(),
    });
  }

  size(): number {
    return this.entries.size;
  }
}

/**
 * Selects 3 to 7 adaptive timestamps prioritizing relevant candidate intervals/chapters
 * and skipping 0..3.5s studio/rating splashes on trailers/long videos.
 */
export function computeAdaptiveSampleTimestamps(input: AdaptiveSampleInput): number[] {
  const dur = Math.max(1, Number(input.durationSec ?? 30));
  const tokens = [
    ...(input.entities ?? []),
    ...(input.query ? input.query.split(/\s+/) : []),
  ]
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length >= 3);

  let spanStart = dur >= 12 ? 3.5 : 0;
  let spanEnd = dur >= 12 ? Math.max(spanStart + 2, dur - 2) : dur;

  if (input.targetInterval && input.targetInterval.endSec > input.targetInterval.startSec + 1) {
    spanStart = Math.max(0, input.targetInterval.startSec);
    spanEnd = Math.min(dur, input.targetInterval.endSec);
  } else if (input.chapters && input.chapters.length > 0) {
    const scored = input.chapters
      .map((ch) => {
        const text = (ch.title ?? '').toLowerCase();
        const hits = tokens.filter((t) => text.includes(t)).length;
        return { ch, score: hits * 2 + (ch.weight ?? 0) };
      })
      .sort((a, b) => b.score - a.score);
    const best = scored[0];
    if (best && best.score > 0 && best.ch.endSec > best.ch.startSec + 1) {
      spanStart = Math.max(0, best.ch.startSec);
      spanEnd = Math.min(dur, best.ch.endSec);
    }
  }

  const spanLen = Math.max(1, spanEnd - spanStart);
  const frameCount = dur <= 35 ? 3 : dur <= 120 ? 5 : 7;
  const out: number[] = [];
  for (let i = 0; i < frameCount; i += 1) {
    const frac = frameCount === 1 ? 0.5 : i / (frameCount - 1);
    const ts = Number(Math.min(dur - 0.25, Math.max(0, spanStart + spanLen * (0.08 + frac * 0.84))).toFixed(2));
    if (!out.some((prev) => Math.abs(prev - ts) < 0.4)) {
      out.push(ts);
    }
  }
  return out.length > 0 ? out : [0];
}

function parseFfmpegAvioStats(stderr: string): { bytesRead: number; seeks: number; found: boolean } {
  let bytesRead = 0;
  let seeks = 0;
  let found = false;
  const regex = /Statistics:\s+(\d+)\s+bytes\s+read,\s+(\d+)\s+seeks/gi;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(stderr)) !== null) {
    found = true;
    bytesRead += Number(m[1] ?? 0);
    seeks += Number(m[2] ?? 0);
  }
  return { bytesRead, seeks, found };
}

/**
 * Local loopback adapter that turns FFmpeg's open-ended `Range: bytes=N-` reads into bounded upstream range requests
 * (the same chunking yt-dlp uses for YouTube via `http_chunk_size`). Some CDNs (e.g. googlevideo) answer bounded ranges
 * in milliseconds but stall open-ended ones. It also gives exact HTTP-level byte/request telemetry.
 * It only forwards the already-authorized stream URL with the same headers; it never alters access control.
 */
export interface ChunkedRangeProxy {
  url: string;
  stats: { bytesTransferred: number; upstreamRequests: number };
  close: () => Promise<void>;
}

export async function startChunkedRangeProxy(input: {
  upstreamUrl: string;
  headers?: Record<string, string>;
  chunkSizeBytes?: number;
  fetchImpl?: typeof fetch;
}): Promise<ChunkedRangeProxy> {
  const chunk = Math.max(64 * 1024, input.chunkSizeBytes ?? 256 * 1024);
  const doFetch = input.fetchImpl ?? fetch;
  const stats = { bytesTransferred: 0, upstreamRequests: 0 };
  let totalSize: number | null = null;
  const sockets = new Set<Socket>();

  const fetchRange = async (start: number, end: number, signal: AbortSignal) => {
    stats.upstreamRequests += 1;
    const res = await doFetch(input.upstreamUrl, {
      headers: { ...(input.headers ?? {}), Range: `bytes=${start}-${end}` },
      signal,
    });
    const cr = res.headers.get('content-range');
    const m = cr ? /\/(\d+)\s*$/.exec(cr) : null;
    if (m) totalSize = Number(m[1]);
    const buf = Buffer.from(await res.arrayBuffer());
    stats.bytesTransferred += buf.length;
    return { status: res.status, buf };
  };

  const server = createServer((req, res) => {
    const ac = new AbortController();
    res.on('close', () => ac.abort());
    void (async () => {
      try {
        const rm = /bytes=(\d+)-(\d*)/.exec(String(req.headers.range ?? ''));
        let pos = rm ? Number(rm[1]) : 0;
        const requestedEnd = rm && rm[2] ? Number(rm[2]) : null;
        const first = await fetchRange(pos, requestedEnd !== null ? Math.min(requestedEnd, pos + chunk - 1) : pos + chunk - 1, ac.signal);
        if (first.status !== 206 && first.status !== 200) {
          res.writeHead(first.status);
          res.end();
          return;
        }
        const size = totalSize;
        const lastByte = requestedEnd ?? (size !== null ? size - 1 : pos + first.buf.length - 1);
        const headers: Record<string, string | number> = {
          'Content-Type': 'application/octet-stream',
          'Accept-Ranges': 'bytes',
          'Content-Length': lastByte - pos + 1,
        };
        if (size !== null) headers['Content-Range'] = `bytes ${pos}-${lastByte}/${size}`;
        res.writeHead(rm ? 206 : 200, headers);
        if (req.method === 'HEAD') {
          res.end();
          return;
        }
        let buf = first.buf;
        while (!ac.signal.aborted) {
          if (!res.write(buf)) await new Promise<void>((r) => res.once('drain', () => r()));
          pos += buf.length;
          if (pos > lastByte || buf.length === 0) break;
          buf = (await fetchRange(pos, Math.min(lastByte, pos + chunk - 1), ac.signal)).buf;
        }
        res.end();
      } catch {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      }
    })();
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    url: `http://127.0.0.1:${port}/stream`,
    stats,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}

/**
 * Extracts distributed JPEG frames directly from a remote HTTP(S) stream URL via FFmpeg HTTP Range seeks,
 * measuring real bytes transferred, latency, and seek requests. Aborts and signals fallback if seek is unsupported
 * or exceeds bandwidth limits.
 */
export async function sampleRemoteFramesWithFfmpeg(input: {
  streamUrl: string;
  outDir: string;
  timestampsSec: number[];
  perFrameTimeoutMs?: number;
  maxTotalBytes?: number;
  signal?: AbortSignal;
  /** Headers bound to the resolved stream URL (from yt-dlp `http_headers`). */
  httpHeaders?: Record<string, string>;
  /** Route through the bounded-range loopback adapter (default true for http(s) URLs). */
  useChunkedRangeProxy?: boolean;
}): Promise<RemoteFrameSampleResult> {
  mkdirSync(input.outDir, { recursive: true });
  const perFrameTimeoutMs = Math.max(3_000, input.perFrameTimeoutMs ?? 12_000);
  const maxTotalBytes = Math.max(512 * 1024, input.maxTotalBytes ?? 10 * 1024 * 1024);
  const startedAt = Date.now();
  const useProxy = (input.useChunkedRangeProxy ?? true) && /^https?:\/\//i.test(input.streamUrl);
  const proxy = useProxy
    ? await startChunkedRangeProxy({ upstreamUrl: input.streamUrl, ...(input.httpHeaders ? { headers: input.httpHeaders } : {}) })
    : null;
  const ffmpegInputUrl = proxy?.url ?? input.streamUrl;

  const framePaths: string[] = [];
  const extractedTimestamps: number[] = [];
  let totalBytes = 0;
  let totalRequests = 0;
  let usedAvioStats = false;
  let seekSupported = true;
  let abortedReason: string | undefined;

  try {
  for (let i = 0; i < input.timestampsSec.length; i += 1) {
    if (input.signal?.aborted) {
      abortedReason = 'aborted';
      break;
    }
    const ts = Math.max(0, input.timestampsSec[i] ?? 0);
    const outPath = join(input.outDir, `remote_f${String(i + 1).padStart(2, '0')}_${ts}s.jpg`);

    const frameRes = await new Promise<{ ok: boolean; bytes: number; avio: boolean; reqs: number; err?: string }>(
      (resolveFrame) => {
        execFile(
          'ffmpeg',
          [
            '-y',
            '-hide_banner',
            '-loglevel',
            'verbose',
            ...(!proxy && input.httpHeaders
              ? ['-headers', Object.entries(input.httpHeaders).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n']
              : []),
            '-ss',
            String(ts),
            '-i',
            ffmpegInputUrl,
            '-vf',
            "scale='min(640,iw)':-2",
            '-frames:v',
            '1',
            '-q:v',
            '4',
            outPath,
          ],
          {
            windowsHide: true,
            timeout: perFrameTimeoutMs,
            maxBuffer: 4 * 1024 * 1024,
            ...(input.signal ? { signal: input.signal } : {}),
          },
          (error, _stdout, stderr) => {
            const avio = parseFfmpegAvioStats(String(stderr ?? ''));
            const fileExists = existsSync(outPath);
            const fileBytes = fileExists ? statSync(outPath).size : 0;
            if (error || !fileExists || fileBytes < 256) {
              resolveFrame({
                ok: false,
                bytes: avio.found ? avio.bytesRead : fileBytes,
                avio: avio.found,
                reqs: avio.found ? avio.seeks + 1 : 1,
                err: error ? error.message.slice(0, 180) : 'empty_frame',
              });
              return;
            }
            resolveFrame({
              ok: true,
              bytes: avio.found ? avio.bytesRead : fileBytes,
              avio: avio.found,
              reqs: avio.found ? avio.seeks + 1 : 1,
            });
          },
        );
      },
    );

    totalBytes += frameRes.bytes;
    totalRequests += frameRes.reqs;
    if (frameRes.avio) usedAvioStats = true;

    if (!frameRes.ok) {
      if (i === 0) {
        seekSupported = false;
        abortedReason = frameRes.err ?? 'remote_seek_failed';
        break;
      }
      continue;
    }

    framePaths.push(outPath);
    extractedTimestamps.push(ts);

    // Abort early if remote server is streaming sequentially instead of honoring HTTP Range seeks
    const bytesSoFar = proxy ? proxy.stats.bytesTransferred : totalBytes;
    if (bytesSoFar > maxTotalBytes) {
      seekSupported = false;
      abortedReason = `remote_seek_bandwidth_exceeded (${bytesSoFar} > ${maxTotalBytes} bytes)`;
      break;
    }
  }
  } finally {
    await proxy?.close();
  }

  const measuredBytes = proxy ? proxy.stats.bytesTransferred : totalBytes;
  const measuredRequests = proxy ? proxy.stats.upstreamRequests : totalRequests;
  return {
    framePaths,
    timestampsSec: extractedTimestamps,
    telemetry: {
      framesRequested: input.timestampsSec.length,
      framesExtracted: framePaths.length,
      bytesTransferred: measuredBytes,
      bytesSource: proxy ? 'http_range_proxy' : usedAvioStats ? 'ffmpeg_avio' : 'output_file_fallback',
      requestsCount: measuredRequests,
      latencyMs: Date.now() - startedAt,
      seekSupported,
      successRate:
        input.timestampsSec.length > 0
          ? Number((framePaths.length / input.timestampsSec.length).toFixed(2))
          : 0,
      ...(abortedReason ? { abortedReason } : {}),
    },
  };
}
