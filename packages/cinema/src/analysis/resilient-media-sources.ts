import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';

export type MediaProviderId =
  | 'local_library'
  | 'youtube_data_api'
  | 'wikimedia_commons'
  | 'internet_archive'
  | 'yt_dlp';

export interface MediaSourceCandidate {
  url: string;
  localPath?: string;
  title?: string;
  description?: string;
  origin: MediaProviderId;
  license: string;
  durationSec?: number;
  directDownloadable?: boolean;
}

export interface ProviderAttemptStatus {
  provider: MediaProviderId;
  status: 'ok' | 'empty' | 'skipped_no_auth' | 'blocked_auth_or_antibot' | 'error';
  detail?: string;
  count: number;
}

export interface ResilientSearchResult {
  candidates: MediaSourceCandidate[];
  providerStatuses: ProviderAttemptStatus[];
}

export interface ResilientAcquisitionDeps {
  localMediaDirs?: string[];
  youtubeApiKey?: string;
  fetchImpl?: typeof fetch;
  ytDlpSearchFn?: (query: string, count: number, signal?: AbortSignal) => Promise<Array<{ url: string; title?: string; durationSec?: number }>>;
  ytDlpAcquireFn?: (url: string, slotIndex: number, mediaDir: string, signal?: AbortSignal) => Promise<string | null>;
}

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.mkv']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

export function searchLocalMediaLibrary(query: string, dirs: string[]): MediaSourceCandidate[] {
  const tokens = tokenize(query);
  const found: MediaSourceCandidate[] = [];
  for (const dir of dirs) {
    if (!dir || !existsSync(dir)) continue;
    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          for (const sub of searchLocalMediaLibrary(query, [full])) found.push(sub);
          continue;
        }
        const ext = extname(entry.name).toLowerCase();
        if (!VIDEO_EXTS.has(ext) && !IMAGE_EXTS.has(ext)) continue;
        const nameLower = entry.name.toLowerCase();
        const matches = tokens.length === 0 || tokens.some((t) => nameLower.includes(t));
        if (matches) {
          found.push({
            url: `file://${full.replace(/\\/g, '/')}`,
            localPath: full,
            title: entry.name,
            origin: 'local_library',
            license: 'user_owned',
            directDownloadable: false,
          });
        }
      }
    } catch {
      // ignore unreadable dirs
    }
  }
  return found.slice(0, 8);
}

async function searchYouTubeDataApi(
  query: string,
  apiKey: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<MediaSourceCandidate[]> {
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=5&q=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`;
  const res = await fetchFn(url, { signal: signal ?? AbortSignal.timeout(8000) });
  if (!res.ok) {
    throw new Error(`YouTube Data API HTTP ${res.status}`);
  }
  const data = (await res.json()) as {
    items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; description?: string } }>;
  };
  return (data.items ?? [])
    .filter((i) => i.id?.videoId)
    .map((i) => ({
      url: `https://www.youtube.com/watch?v=${i.id!.videoId}`,
      title: i.snippet?.title ?? 'YouTube Video',
      description: i.snippet?.description ?? '',
      origin: 'youtube_data_api' as const,
      license: 'youtube_official_api',
      directDownloadable: false,
    }));
}

async function searchWikimediaCommons(
  query: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<MediaSourceCandidate[]> {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(query)}&gsrlimit=5&prop=imageinfo&iiprop=url|mime|extmetadata&format=json`;
  const res = await fetchFn(url, {
    headers: { 'User-Agent': 'AetheraStudio/1.0 (media-research)' },
    signal: signal ?? AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Wikimedia Commons HTTP ${res.status}`);
  const data = (await res.json()) as {
    query?: { pages?: Record<string, { title?: string; imageinfo?: Array<{ url?: string; mime?: string }> }> };
  };
  const pages = Object.values(data.query?.pages ?? {});
  const out: MediaSourceCandidate[] = [];
  for (const p of pages) {
    const info = p.imageinfo?.[0];
    if (!info?.url) continue;
    const mime = info.mime ?? '';
    if (!mime.startsWith('video/') && !mime.startsWith('image/')) continue;
    out.push({
      url: info.url,
      title: p.title?.replace(/^File:/, '') ?? 'Wikimedia Asset',
      origin: 'wikimedia_commons',
      license: 'wikimedia_open',
      directDownloadable: true,
    });
  }
  return out;
}

async function searchInternetArchive(
  query: string,
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<MediaSourceCandidate[]> {
  const q = `(${query}) AND mediatype:(movies OR image)`;
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier,title,description&rows=4&output=json`;
  const res = await fetchFn(url, { signal: signal ?? AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Internet Archive HTTP ${res.status}`);
  const data = (await res.json()) as {
    response?: { docs?: Array<{ identifier?: string; title?: string; description?: string }> };
  };
  return (data.response?.docs ?? [])
    .filter((d) => d.identifier)
    .map((d) => ({
      url: `https://archive.org/details/${d.identifier}`,
      title: d.title ?? d.identifier!,
      ...(d.description ? { description: String(d.description).slice(0, 240) } : {}),
      origin: 'internet_archive' as const,
      license: 'internet_archive_open',
      directDownloadable: false,
    }));
}

export async function searchResilientMediaSources(
  query: string,
  deps: ResilientAcquisitionDeps,
  signal?: AbortSignal,
): Promise<ResilientSearchResult> {
  const fetchFn = deps.fetchImpl ?? fetch;
  const candidates: MediaSourceCandidate[] = [];
  const providerStatuses: ProviderAttemptStatus[] = [];

  // 1. Local library / workspace
  const localHits = searchLocalMediaLibrary(query, deps.localMediaDirs ?? []);
  candidates.push(...localHits);
  providerStatuses.push({
    provider: 'local_library',
    status: localHits.length > 0 ? 'ok' : 'empty',
    count: localHits.length,
  });

  // 2. Official YouTube Data API v3 (only when key is configured)
  if (deps.youtubeApiKey) {
    try {
      const ytHits = await searchYouTubeDataApi(query, deps.youtubeApiKey, fetchFn, signal);
      candidates.push(...ytHits);
      providerStatuses.push({
        provider: 'youtube_data_api',
        status: ytHits.length > 0 ? 'ok' : 'empty',
        count: ytHits.length,
      });
    } catch (err) {
      providerStatuses.push({
        provider: 'youtube_data_api',
        status: 'error',
        detail: (err as Error).message,
        count: 0,
      });
    }
  } else {
    providerStatuses.push({
      provider: 'youtube_data_api',
      status: 'skipped_no_auth',
      detail: 'Chave/OAuth YouTube Data API não configurada.',
      count: 0,
    });
  }

  // 3. Wikimedia Commons (official API)
  try {
    const wikiHits = await searchWikimediaCommons(query, fetchFn, signal);
    candidates.push(...wikiHits);
    providerStatuses.push({
      provider: 'wikimedia_commons',
      status: wikiHits.length > 0 ? 'ok' : 'empty',
      count: wikiHits.length,
    });
  } catch (err) {
    providerStatuses.push({
      provider: 'wikimedia_commons',
      status: 'error',
      detail: (err as Error).message,
      count: 0,
    });
  }

  // 4. Internet Archive (official API)
  try {
    const iaHits = await searchInternetArchive(query, fetchFn, signal);
    candidates.push(...iaHits);
    providerStatuses.push({
      provider: 'internet_archive',
      status: iaHits.length > 0 ? 'ok' : 'empty',
      count: iaHits.length,
    });
  } catch (err) {
    providerStatuses.push({
      provider: 'internet_archive',
      status: 'error',
      detail: (err as Error).message,
      count: 0,
    });
  }

  // 5. Optional yt-dlp fallback (never single point of failure, never bypasses anti-bot)
  if (deps.ytDlpSearchFn && candidates.length < 3) {
    try {
      const ytdlpHits = await deps.ytDlpSearchFn(query, 4, signal);
      const mapped = ytdlpHits
        .filter((r) => Boolean(r.url))
        .map((r) => ({
          url: r.url,
          ...(r.title ? { title: r.title } : {}),
          ...(r.durationSec !== undefined ? { durationSec: r.durationSec } : {}),
          origin: 'yt_dlp' as const,
          license: 'external_reference',
          directDownloadable: false,
        }));
      candidates.push(...mapped);
      providerStatuses.push({
        provider: 'yt_dlp',
        status: mapped.length > 0 ? 'ok' : 'empty',
        count: mapped.length,
      });
    } catch (err) {
      const msg = (err as Error).message;
      const isBotBlock = /not a bot|sign in|cookies|forbidden/i.test(msg);
      providerStatuses.push({
        provider: 'yt_dlp',
        status: isBotBlock ? 'blocked_auth_or_antibot' : 'error',
        detail: msg.slice(0, 200),
        count: 0,
      });
    }
  }

  return { candidates, providerStatuses };
}

export async function acquireResilientMediaFile(
  query: string,
  slotIndex: number,
  mediaDir: string,
  deps: ResilientAcquisitionDeps,
  signal?: AbortSignal,
  preferredUrl?: string,
): Promise<{ filePath: string | null; provider: MediaProviderId | null; statuses: ProviderAttemptStatus[] }> {
  const fetchFn = deps.fetchImpl ?? fetch;
  if (preferredUrl) {
    if (preferredUrl.startsWith('file://')) {
      const local = preferredUrl.replace(/^file:\/\//i, '');
      return { filePath: existsSync(local) ? local : null, provider: 'local_library', statuses: [] };
    }
    if (deps.ytDlpAcquireFn) {
      try {
        const p = await deps.ytDlpAcquireFn(preferredUrl, slotIndex, mediaDir, signal);
        if (p) return { filePath: p, provider: 'yt_dlp', statuses: [] };
      } catch {
        // fallback below
      }
    }
  }

  const search = await searchResilientMediaSources(query, deps, signal);
  for (const cand of search.candidates) {
    if (cand.localPath && existsSync(cand.localPath)) {
      return { filePath: cand.localPath, provider: 'local_library', statuses: search.providerStatuses };
    }
    if (cand.directDownloadable && /^https?:\/\//i.test(cand.url)) {
      try {
        const res = await fetchFn(cand.url, { signal: signal ?? AbortSignal.timeout(15_000) });
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 1024) continue;
        const ext = extname(new URL(cand.url).pathname) || '.mp4';
        const outDir = join(mediaDir, `acq_${slotIndex + 1}`);
        mkdirSync(outDir, { recursive: true });
        const outFile = join(outDir, `slot_${slotIndex + 1}${ext}`);
        writeFileSync(outFile, buf);
        return { filePath: outFile, provider: cand.origin, statuses: search.providerStatuses };
      } catch {
        continue;
      }
    }
    if (cand.origin === 'yt_dlp' && deps.ytDlpAcquireFn) {
      try {
        const p = await deps.ytDlpAcquireFn(cand.url, slotIndex, mediaDir, signal);
        if (p) return { filePath: p, provider: 'yt_dlp', statuses: search.providerStatuses };
      } catch {
        continue;
      }
    }
  }

  return { filePath: null, provider: null, statuses: search.providerStatuses };
}
