import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import {
  evaluateMediaRelevance,
  type MediaRelevanceDecision,
} from '../qc/media-relevance-gate.js';
import {
  expandScriptOrientedQueries,
  planMediaCoverage,
  type AcquiredMediaAsset,
  type CoverageFormat,
  type MediaCoverageReport,
  type ScriptCoverageSegment,
} from './media-coverage-planner.js';

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
  const out: MediaSourceCandidate[] = [];
  for (const d of (data.response?.docs ?? []).filter((doc) => doc.identifier)) {
    const id = d.identifier!;
    let directUrl = `https://archive.org/details/${id}`;
    let directDownloadable = false;
    try {
      const metaRes = await fetchFn(`https://archive.org/metadata/${encodeURIComponent(id)}/files`, {
        signal: signal ?? AbortSignal.timeout(6000),
      });
      if (metaRes.ok) {
        const metaJson = (await metaRes.json()) as { result?: Array<{ name?: string }> };
        const mediaFile = (metaJson.result ?? []).find((f) =>
          /\.(mp4|webm|jpg|jpeg|png)$/i.test(f.name ?? ''),
        );
        if (mediaFile?.name) {
          directUrl = `https://archive.org/download/${encodeURIComponent(id)}/${encodeURIComponent(mediaFile.name)}`;
          directDownloadable = true;
        }
      }
    } catch {
      // keep details URL if metadata lookup fails
    }
    out.push({
      url: directUrl,
      title: d.title ?? id,
      ...(d.description ? { description: String(d.description).slice(0, 240) } : {}),
      origin: 'internet_archive',
      license: 'internet_archive_open',
      directDownloadable,
    });
  }
  return out;
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

export interface AutonomousAcquisitionAuditReport {
  roundsExecuted: number;
  elapsedMs: number;
  queriesExecuted: Array<{ round: number; segmentId: string; subject: string; query: string }>;
  candidatesFoundCount: number;
  candidatesByProvider: Record<string, number>;
  acquiredFilesCount: number;
  approvedForAssemblyCount: number;
  rejectedCandidates: Array<{
    mediaId: string;
    title: string;
    origin: string;
    rejectionCode?: string;
    reason: string;
  }>;
  autoResolvedGaps: Array<{ segmentId: string; subject: string; resolvedInRound: number; mediaId: string }>;
  unresolvedGapsForReview: Array<{ segmentId: string; subject: string; suggestedQuery: string; reason: string }>;
  providerStatuses: ProviderAttemptStatus[];
  coverageReport: MediaCoverageReport;
  approvedAssets: AcquiredMediaAsset[];
  relevanceDecisions: MediaRelevanceDecision[];
}

/**
 * Autonomous multi-round coverage-driven acquisition:
 * expands queries across all available sources for uncovered segments within configurable limits,
 * never reuses incompatible media, and sends only truly unresolved gaps to the Review Room.
 */
export async function runAutonomousMediaAcquisition(input: {
  projectId: string;
  prompt: string;
  genre?: string;
  format?: CoverageFormat;
  segments: ScriptCoverageSegment[];
  mediaDir: string;
  deps: ResilientAcquisitionDeps;
  probeDurationFn?: (filePath: string) => Promise<number>;
  limits?: {
    maxRounds?: number;
    maxDurationMs?: number;
    maxQueriesTotal?: number;
  };
  signal?: AbortSignal;
}): Promise<AutonomousAcquisitionAuditReport> {
  const startedAt = Date.now();
  const maxRounds = Math.max(1, input.limits?.maxRounds ?? 3);
  const maxDurationMs = Math.max(5_000, input.limits?.maxDurationMs ?? 120_000);
  const maxQueriesTotal = Math.max(input.segments.length, input.limits?.maxQueriesTotal ?? 28);
  const fetchFn = input.deps.fetchImpl ?? fetch;

  const queriesExecuted: AutonomousAcquisitionAuditReport['queriesExecuted'] = [];
  const candidatesByProvider: Record<string, number> = {};
  const seenCandidateKeys = new Set<string>();
  const rejectedCandidates: AutonomousAcquisitionAuditReport['rejectedCandidates'] = [];
  const relevanceDecisions: MediaRelevanceDecision[] = [];
  const approvedAssets: AcquiredMediaAsset[] = [];
  const allStatuses: ProviderAttemptStatus[] = [];
  const autoResolvedGaps: AutonomousAcquisitionAuditReport['autoResolvedGaps'] = [];

  let candidatesFoundCount = 0;
  let acquiredFilesCount = 0;
  let ytDlpBlocked = false;
  let uncoveredAfterRound1 = new Set<string>();

  const effectiveDeps = (): ResilientAcquisitionDeps => {
    if (!ytDlpBlocked) return input.deps;
    const { ytDlpSearchFn: _s, ytDlpAcquireFn: _a, ...rest } = input.deps;
    return rest;
  };

  let latestCoverage: MediaCoverageReport = planMediaCoverage({
    segments: input.segments,
    assets: [],
    ...(input.format ? { format: input.format } : {}),
    relevanceDecisions: [],
    requireRelevanceApproval: true,
  });

  let roundsExecuted = 0;

  for (let round = 1; round <= maxRounds; round += 1) {
    if (Date.now() - startedAt >= maxDurationMs) break;
    if (queriesExecuted.length >= maxQueriesTotal) break;

    roundsExecuted = round;
    const targetSegments =
      round === 1
        ? input.segments
        : input.segments.filter((s) => latestCoverage.uncoveredSubjects.includes(s.subject));

    if (targetSegments.length === 0) break;

    const roundQueries =
      round === 1
        ? targetSegments.map((s) => ({
            segment: s,
            query: `${s.subject} ${s.entities?.slice(0, 2).join(' ') ?? ''}`.trim() || input.prompt,
          }))
        : expandScriptOrientedQueries({
            prompt: input.prompt,
            segments: targetSegments,
            ...(input.genre ? { genre: input.genre } : {}),
            uncoveredSegmentIds: targetSegments.map((s) => s.segmentId),
          }).map((q, idx) => ({
            segment: targetSegments[idx % targetSegments.length]!,
            query: round === 3 ? `${q} anime scene` : q,
          }));

    for (const item of roundQueries) {
      if (Date.now() - startedAt >= maxDurationMs) break;
      if (queriesExecuted.length >= maxQueriesTotal) break;

      queriesExecuted.push({
        round,
        segmentId: item.segment.segmentId,
        subject: item.segment.subject,
        query: item.query,
      });

      const searchRes = await searchResilientMediaSources(item.query, effectiveDeps(), input.signal);
      allStatuses.push(...searchRes.providerStatuses);
      if (searchRes.providerStatuses.some((s) => s.provider === 'yt_dlp' && s.status === 'blocked_auth_or_antibot')) {
        ytDlpBlocked = true;
      }

      for (const cand of searchRes.candidates) {
        candidatesByProvider[cand.origin] = (candidatesByProvider[cand.origin] ?? 0) + 1;
        const candKey = `${cand.origin}:${cand.url}`;
        if (seenCandidateKeys.has(candKey)) continue;
        seenCandidateKeys.add(candKey);
        candidatesFoundCount += 1;

        // Try to acquire file locally if downloadable or local
        let filePath: string | null = null;
        if (cand.localPath && existsSync(cand.localPath)) {
          filePath = cand.localPath;
        } else if (cand.directDownloadable && /^https?:\/\//i.test(cand.url)) {
          try {
            const res = await fetchFn(cand.url, { signal: input.signal ?? AbortSignal.timeout(12_000) });
            if (res.ok) {
              const buf = Buffer.from(await res.arrayBuffer());
              if (buf.length >= 1024) {
                const ext = extname(new URL(cand.url).pathname) || '.mp4';
                const outDir = join(input.mediaDir, `auto_r${round}_${acquiredFilesCount + 1}`);
                mkdirSync(outDir, { recursive: true });
                filePath = join(outDir, `asset_${acquiredFilesCount + 1}${ext}`);
                writeFileSync(filePath, buf);
              }
            }
          } catch {
            filePath = null;
          }
        } else if (cand.origin === 'yt_dlp' && !ytDlpBlocked && input.deps.ytDlpAcquireFn) {
          try {
            filePath = await input.deps.ytDlpAcquireFn(cand.url, acquiredFilesCount, input.mediaDir, input.signal);
          } catch {
            filePath = null;
          }
        }

        if (!filePath) continue;
        acquiredFilesCount += 1;

        const mediaId = `auto_${cand.origin}_${acquiredFilesCount}`;
        let durationSec = cand.durationSec ?? 12;
        if (input.probeDurationFn) {
          try {
            durationSec = await input.probeDurationFn(filePath);
          } catch {
            durationSec = cand.durationSec ?? 12;
          }
        }

        const decision = await evaluateMediaRelevance(
          {
            mediaId,
            uri: filePath,
            ...(cand.title ? { title: cand.title } : {}),
            ...(cand.description ? { description: cand.description } : {}),
            origin: cand.origin,
            durationSec,
            projectId: input.projectId,
          },
          {
            segmentId: item.segment.segmentId,
            prompt: input.prompt,
            narrationText: item.segment.narrationText,
            ...(input.genre ? { genre: input.genre } : {}),
            ...(item.segment.entities ? { expectedEntities: item.segment.entities } : {}),
          },
        );
        relevanceDecisions.push(decision);

        if (!decision.accepted) {
          rejectedCandidates.push({
            mediaId,
            title: cand.title ?? filePath,
            origin: cand.origin,
            ...(decision.rejectionCode ? { rejectionCode: decision.rejectionCode } : {}),
            reason: decision.reason,
          });
          continue;
        }

        approvedAssets.push({
          mediaId,
          uri: filePath,
          ...(cand.title ? { title: cand.title } : {}),
          origin: cand.origin,
          durationSec,
          compatible: true,
          relevantToEntities: decision.matchedEntities,
        });

        if (round > 1 && uncoveredAfterRound1.has(item.segment.segmentId)) {
          autoResolvedGaps.push({
            segmentId: item.segment.segmentId,
            subject: item.segment.subject,
            resolvedInRound: round,
            mediaId,
          });
          uncoveredAfterRound1.delete(item.segment.segmentId);
        }
      }
    }

    latestCoverage = planMediaCoverage({
      segments: input.segments,
      assets: approvedAssets,
      ...(input.format ? { format: input.format } : {}),
      relevanceDecisions,
      requireRelevanceApproval: true,
    });

    if (round === 1) {
      uncoveredAfterRound1 = new Set(
        latestCoverage.segments.filter((s) => !s.covered).map((s) => s.segmentId),
      );
    }

    if (latestCoverage.gatePassed) break;
  }

  const unresolvedGapsForReview = latestCoverage.segments
    .filter((s) => !s.covered)
    .map((s) => ({
      segmentId: s.segmentId,
      subject: s.subject,
      suggestedQuery: `${input.prompt.split(/[—:|]/)[0]?.trim() || input.prompt} ${s.subject}`.trim(),
      reason: `Cobertura insuficiente após ${roundsExecuted} rodada(s) automática(s): ${s.usableDurationSec}s / ${s.expectedDurationSec}s.`,
    }));

  return {
    roundsExecuted,
    elapsedMs: Date.now() - startedAt,
    queriesExecuted,
    candidatesFoundCount,
    candidatesByProvider,
    acquiredFilesCount,
    approvedForAssemblyCount: approvedAssets.length,
    rejectedCandidates,
    autoResolvedGaps,
    unresolvedGapsForReview,
    providerStatuses: allStatuses,
    coverageReport: latestCoverage,
    approvedAssets,
    relevanceDecisions,
  };
}
