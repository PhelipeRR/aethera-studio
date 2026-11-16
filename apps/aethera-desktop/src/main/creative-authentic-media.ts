import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { promisify } from 'node:util';
import type { AuthenticMediaRequest, AuthenticMediaResult, AuthenticMediaSource } from '@neuralbridge/creative-studio';
import { searchResilientMediaSources, type ResilientAcquisitionDeps } from '@neuralbridge/cinema';

const execFileAsync = promisify(execFile);

/**
 * CS-9 — AuthenticMediaSource built ONLY from sources Aethera Studio already ships:
 * - IGDB (official screenshots/artworks; credentials from the existing encrypted store),
 * - the resilient cinema chain: local media library, Wikimedia Commons, Internet Archive, Sakugabooru (anime),
 *   yt-dlp search/acquire (never bypasses anti-bot; reports blocked providers),
 * - ffmpeg to reduce a video to a still frame.
 *
 * Nothing here generates media. A candidate is used only when its title/description mentions the query's
 * distinctive tokens, so an unrelated Commons/Archive hit is not passed off as the subject.
 */

export interface IgdbImageLookup {
  (query: string, signal?: AbortSignal): Promise<Array<{ url: string; title: string; kind: 'screenshot' | 'artwork' }>>;
}

export interface CinemaAuthenticMediaDeps extends ResilientAcquisitionDeps {
  /** Folder where acquired files and extracted frames are written. */
  mediaDir: string;
  ffmpegPath?: string;
  igdbImages?: IgdbImageLookup;
  /** Records each attempt (provider statuses, chosen candidate) for audit. */
  onAttempt?: (entry: AuthenticAcquisitionLog) => void;
}

export interface AuthenticAcquisitionLog {
  query: string;
  providerStatuses: Array<{ provider: string; status: string; count: number; detail?: string }>;
  relevantCandidates: number;
  chosen: { origin: string; url: string; title?: string } | null;
  failure?: string;
}

const STOP = new Set(['the', 'and', 'dos', 'das', 'para', 'com', 'returns', 'thumbnail', 'video', 'game', 'official']);

export function distinctiveTokens(query: string): string[] {
  return query
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/**
 * Fan interpretations are not authentic media of a character: cosplay photos, fan art, parodies and fan
 * animations share the look but not the identity, so they are never used as content-faithful media or references.
 */
const NON_AUTHENTIC = /\b(cosplay|cosplayer|fan ?art|fanart|fan[- ]made|parody|meme|ai[- ]generated|animation|mini movie|reaction)\b/i;

function normalise(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * A candidate is relevant when its metadata names the subject (every subject token) and at least half of the
 * remaining query tokens, and it is not a fan interpretation. Without a subject, half of the query tokens suffice.
 */
export function isRelevantCandidate(query: string, text: string, subject?: string): boolean {
  if (NON_AUTHENTIC.test(text)) return false;
  const hay = normalise(text);
  const subjectTokens = subject ? distinctiveTokens(subject) : [];
  if (subjectTokens.some((t) => !hay.includes(t))) return false;
  const rest = distinctiveTokens(query).filter((t) => !subjectTokens.includes(t));
  if (rest.length === 0) return subjectTokens.length > 0;
  const hits = rest.filter((t) => hay.includes(t)).length;
  return hits >= Math.max(1, Math.ceil(rest.length / 2));
}

/** Video frames are real footage; stills from Commons/Archive/local/Sakugabooru are licensed or open references. */
function provenanceFor(isVideo: boolean): AuthenticMediaResult['provenance'] {
  return isVideo ? 'real_video_frame' : 'licensed_reference';
}

async function extractFrame(ffmpeg: string, videoPath: string, outPng: string): Promise<number | null> {
  for (const t of [30, 12, 4, 0]) {
    try {
      await execFileAsync(ffmpeg, ['-y', '-ss', String(t), '-i', videoPath, '-frames:v', '1', outPng], { timeout: 60_000 });
      if (existsSync(outPng)) return t;
    } catch {
      // try an earlier timestamp (short clips)
    }
  }
  return null;
}

export function createCinemaAuthenticMediaSource(deps: CinemaAuthenticMediaDeps): AuthenticMediaSource {
  const fetchFn = deps.fetchImpl ?? fetch;
  let counter = 0;
  return {
    id: 'aethera-existing-sources',
    async acquire(request: AuthenticMediaRequest): Promise<AuthenticMediaResult | null> {
      counter += 1;
      const slotDir = join(deps.mediaDir, `authentic-${Date.now().toString(36)}-${counter}`);
      mkdirSync(slotDir, { recursive: true });
      const log: AuthenticAcquisitionLog = { query: request.query, providerStatuses: [], relevantCandidates: 0, chosen: null };

      // 1) IGDB official media (only when the user configured IGDB credentials).
      if (deps.igdbImages && request.genre === 'games') {
        try {
          const images = await deps.igdbImages(request.query, request.signal);
          log.providerStatuses.push({ provider: 'igdb', status: images.length > 0 ? 'ok' : 'empty', count: images.length });
          const pick = images.find((i) => i.kind === 'screenshot') ?? images[0];
          if (pick) {
            const res = await fetchFn(pick.url, { signal: request.signal ?? AbortSignal.timeout(15_000) });
            if (res.ok) {
              const out = join(slotDir, `igdb${extname(new URL(pick.url).pathname) || '.jpg'}`);
              writeFileSync(out, Buffer.from(await res.arrayBuffer()));
              log.chosen = { origin: 'igdb', url: pick.url, title: pick.title };
              deps.onAttempt?.(log);
              return { imagePath: out, provenance: 'official_media', origin: 'igdb', sourceUrl: pick.url, license: 'igdb_official_media_editorial_use', title: pick.title };
            }
          }
        } catch (err) {
          log.providerStatuses.push({ provider: 'igdb', status: 'error', count: 0, detail: (err as Error).message.slice(0, 160) });
        }
      }

      // 2) Resilient cinema chain (local library, Sakugabooru for anime, Wikimedia, Internet Archive, yt-dlp).
      const search = await searchResilientMediaSources(request.query, deps, request.signal, {
        ...(request.genre ? { genre: request.genre } : {}),
        prompt: request.query,
      });
      log.providerStatuses.push(...search.providerStatuses);
      const relevant = search.candidates.filter((c) =>
        isRelevantCandidate(request.query, `${c.title ?? ''} ${c.description ?? ''} ${c.url}`, request.subject),
      );
      log.relevantCandidates = relevant.length;

      for (const cand of relevant) {
        try {
          let file: string | null = null;
          if (cand.localPath && existsSync(cand.localPath)) {
            file = cand.localPath;
          } else if (cand.directDownloadable && /^https?:\/\//i.test(cand.url)) {
            const res = await fetchFn(cand.url, { signal: request.signal ?? AbortSignal.timeout(20_000) });
            if (!res.ok) continue;
            const buf = Buffer.from(await res.arrayBuffer());
            if (buf.length < 1024) continue;
            file = join(slotDir, `download${extname(new URL(cand.url).pathname) || '.bin'}`);
            writeFileSync(file, buf);
          } else if (cand.origin === 'yt_dlp' && deps.ytDlpAcquireFn) {
            file = await deps.ytDlpAcquireFn(cand.url, counter, slotDir, request.signal, '*0:00-0:45');
          }
          if (!file) continue;

          const isVideo = /\.(mp4|webm|mkv|mov)$/i.test(file);
          let imagePath = file;
          let frameTimestampSec: number | undefined;
          if (isVideo) {
            const out = join(slotDir, 'frame.png');
            const t = await extractFrame(deps.ffmpegPath ?? 'ffmpeg', file, out);
            if (t === null) continue;
            imagePath = out;
            frameTimestampSec = t;
          } else if (!/\.(png|jpe?g|webp)$/i.test(file)) {
            continue;
          }
          log.chosen = { origin: cand.origin, url: cand.url, ...(cand.title ? { title: cand.title } : {}) };
          deps.onAttempt?.(log);
          return {
            imagePath,
            provenance: provenanceFor(isVideo),
            origin: cand.origin,
            sourceUrl: cand.provenanceMetadata?.postUrl ?? cand.url,
            license: cand.license,
            ...(cand.title ? { title: cand.title } : {}),
            ...(frameTimestampSec !== undefined ? { frameTimestampSec } : {}),
          };
        } catch {
          continue;
        }
      }

      log.failure = relevant.length === 0 ? 'nenhum candidato relevante nas fontes existentes' : 'candidatos relevantes não puderam ser adquiridos';
      deps.onAttempt?.(log);
      return null;
    },
  };
}
