import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import {
  evaluateMediaRelevance,
  extractTopicEntities,
  type DistributedFrameAnalysis,
  type MediaCorrespondenceLevel,
  type MediaRelevanceDecision,
  type ScriptSegmentExpectation,
  type VisualVerificationStatus,
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
    const isRasterImage = mime === 'image/png' || mime === 'image/jpeg' || mime === 'image/webp';
    if (!mime.startsWith('video/') && !isRasterImage) continue;
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
        const metaJson = (await metaRes.json()) as { result?: Array<{ name?: string; size?: string; length?: string }> };
        const files = metaJson.result ?? [];
        const videoFile = files.find((f) => /\.(mp4|webm|mkv|mov)$/i.test(f.name ?? ''));
        const imageFile = files.find(
          (f) =>
            /\.(jpe?g|png|webp)$/i.test(f.name ?? '') &&
            !/(__ia_thumb|_thumb|thumb\.)/i.test(f.name ?? ''),
        );
        const mediaFile = videoFile ?? imageFile;
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

export interface ApprovedMediaAuditDetail {
  mediaId: string;
  title: string;
  origin: MediaProviderId;
  sourceUrl: string;
  localPath: string;
  fileSizeBytes: number;
  sha256: string;
  durationSec: number;
  relevanceTier: 'exact_segment_match' | 'same_universe_context' | 'rejected';
  correspondenceLevel?: MediaCorrespondenceLevel;
  visualVerificationStatus?: VisualVerificationStatus;
  visualConfidence?: number;
  visualEvidence?: MediaRelevanceDecision['visualEvidence'];
  matchedEntities: string[];
  sampledTimestampsSec: number[];
  coveredSegmentIds: string[];
  usefulIntervals: Array<{ segmentId: string; startSec: number; endSec: number }>;
  editorialJustification: string;
}

export interface SegmentAcquisitionMetrics {
  segmentId: string;
  subject: string;
  queriesExecuted: number;
  candidatesFound: number;
  downloadsAttempted: number;
  downloadsSucceeded: number;
  rejectedCount: number;
  approvedCount: number;
  timeConsumedMs: number;
  covered: boolean;
  usableDurationSec: number;
  expectedDurationSec: number;
}

export type CandidateLifecycleState =
  | 'discovered'
  | 'downloading'
  | 'downloaded'
  | 'pending_visual_verification'
  | 'verified'
  | 'rejected'
  | 'failed';

export type DownloadFailureReasonCode =
  | 'timeout'
  | 'anti_bot'
  | 'http_error'
  | 'format_unavailable'
  | 'invalid_file'
  | 'cancelled'
  | 'other';

export type AcquisitionStageMode =
  | 'full'
  | 'discover_only'
  | 'acquire_and_verify'
  | 'verify_pending_only';

export function classifyDownloadFailure(err: unknown): {
  reasonCode: DownloadFailureReasonCode;
  detail: string;
} {
  const msg = err instanceof Error ? err.message : String(err ?? 'unknown error');
  if (/timed out|timeout|ETIMEDOUT|Read timed out|deadline/i.test(msg)) {
    return { reasonCode: 'timeout', detail: msg.slice(0, 240) };
  }
  if (/not a bot|sign in|cookies|captcha|HTTP Error 429|too many requests|forbidden:.*sign in/i.test(msg)) {
    return { reasonCode: 'anti_bot', detail: msg.slice(0, 240) };
  }
  if (/HTTP Error \d{3}|http_error|\bstatus\s*(4\d\d|5\d\d)\b/i.test(msg)) {
    return { reasonCode: 'http_error', detail: msg.slice(0, 240) };
  }
  if (/Requested format is not available|format:|unsupported format/i.test(msg)) {
    return { reasonCode: 'format_unavailable', detail: msg.slice(0, 240) };
  }
  if (/invalid|too small|empty|corrupt|sem gerar o arquivo|unavailable:/i.test(msg)) {
    return { reasonCode: 'invalid_file', detail: msg.slice(0, 240) };
  }
  if (/cancelled|AbortError|aborted/i.test(msg)) {
    return { reasonCode: 'cancelled', detail: msg.slice(0, 240) };
  }
  return { reasonCode: 'other', detail: msg.slice(0, 240) };
}

export interface AcquisitionFunnelMetrics {
  counts: Record<CandidateLifecycleState, number>;
  conversionRates: {
    discoveryToDownloadAttemptRate: number;
    downloadAttemptToDownloadedRate: number;
    downloadedToVerifiedRate: number;
    discoveredToVerifiedRate: number;
  };
  failureReasons: Record<DownloadFailureReasonCode, number>;
  rejectionReasons: Record<string, number>;
  failedDownloads: Array<{
    segmentId: string;
    url: string;
    title: string;
    origin: string;
    reasonCode: DownloadFailureReasonCode;
    detail: string;
  }>;
  pendingVerificationCount: number;
  visionDiagnostics: {
    callsAttempted: number;
    callsSucceeded: number;
    callsFailed: number;
    providerErrors: string[];
  };
}

export interface AutonomousAcquisitionAuditReport {
  roundsExecuted: number;
  elapsedMs: number;
  totalDeadlineMs: number;
  perOperationTimeoutMs: number;
  budgetBreakdown?: {
    totalBudgetMs: number;
    budgetMultiplier: number;
    discoveryBudgetMs: number;
    acquisitionBudgetMs: number;
    verificationBudgetMs: number;
    resumedFromCheckpoint: boolean;
  };
  stoppedReason: 'coverage_satisfied' | 'deadline_exceeded' | 'max_rounds' | 'max_queries' | 'aborted';
  queriesExecuted: Array<{ round: number; segmentId: string; subject: string; query: string }>;
  candidatesFoundCount: number;
  candidatesByProvider: Record<string, number>;
  acquiredFilesCount: number;
  duplicateFilesSkipped: number;
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
  segmentMetrics: SegmentAcquisitionMetrics[];
  funnelMetrics: AcquisitionFunnelMetrics;
  coverageReport: MediaCoverageReport;
  approvedAssets: AcquiredMediaAsset[];
  approvedMediaDetails: ApprovedMediaAuditDetail[];
  relevanceDecisions: MediaRelevanceDecision[];
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  const limit = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;
  const runners = Array.from({ length: limit }, async () => {
    while (cursor < items.length) {
      const idx = cursor;
      cursor += 1;
      const item = items[idx];
      if (item !== undefined) {
        await worker(item, idx);
      }
    }
  });
  await Promise.all(runners);
}

export function scoreCandidateRelevancePriority(
  cand: MediaSourceCandidate,
  segment: ScriptCoverageSegment,
  prompt: string,
): number {
  const text = `${cand.title ?? ''} ${cand.description ?? ''}`
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const segEntities =
    segment.entities && segment.entities.length > 0
      ? segment.entities.map((e) => e.toLowerCase())
      : extractTopicEntities(`${segment.subject} ${segment.narrationText}`);
  const promptEntities = extractTopicEntities(prompt);

  let score = 0;
  for (const e of segEntities) {
    if (text.includes(e)) score += 3;
  }
  for (const e of promptEntities) {
    if (text.includes(e)) score += 1;
  }
  if (cand.origin === 'local_library') score += 3;
  if (/\b(anime|cena|scene|clip|episodio|episode|dublado|legendado|luta|fight|transforma)\b/i.test(text)) {
    score += 2;
  }
  if (/\b(live[- ]action|fan film|podcast|react|reaction|gameplay|roblox|fortnite|minecraft|unboxing)\b/i.test(text)) {
    score -= 5;
  }
  if (cand.durationSec && cand.durationSec > 180) score -= 2;
  if (cand.durationSec && cand.durationSec >= 8 && cand.durationSec <= 120) score += 1;
  return score;
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
  analyzeFrames?: (
    uri: string,
    timestampsSec: number[],
    segment: ScriptSegmentExpectation,
  ) => Promise<DistributedFrameAnalysis[]>;
  requireVisualVerification?: boolean;
  stageMode?: AcquisitionStageMode;
  limits?: {
    maxRounds?: number;
    maxDurationMs?: number;
    budgetMultiplier?: number;
    perOperationTimeoutMs?: number;
    maxQueriesTotal?: number;
    maxCandidateDurationSec?: number;
    discoveryConcurrency?: number;
    acquisitionConcurrency?: number;
    verificationConcurrency?: number;
    discoveryBudgetRatio?: number;
    acquisitionBudgetRatio?: number;
    roundReserveRatio?: number;
  };
  checkpointPath?: string | false;
  signal?: AbortSignal;
}): Promise<AutonomousAcquisitionAuditReport> {
  const startedAt = Date.now();
  const stageMode: AcquisitionStageMode = input.stageMode ?? 'full';
  const maxRounds = Math.max(1, input.limits?.maxRounds ?? 3);
  const baseMaxDurationMs = Math.max(1_000, input.limits?.maxDurationMs ?? 120_000);
  const budgetMultiplier = Math.max(0.25, input.limits?.budgetMultiplier ?? 1);
  const maxDurationMs = Math.round(baseMaxDurationMs * budgetMultiplier);
  const perOperationTimeoutMs = Math.max(1_000, input.limits?.perOperationTimeoutMs ?? 25_000);
  const maxQueriesTotal = Math.max(input.segments.length, input.limits?.maxQueriesTotal ?? Math.max(28, input.segments.length * 3));
  const maxCandidateDurationSec = input.limits?.maxCandidateDurationSec ?? 600;
  const discoveryConcurrency = Math.max(1, input.limits?.discoveryConcurrency ?? 3);
  const acquisitionConcurrency = Math.max(1, input.limits?.acquisitionConcurrency ?? 1);
  const verificationConcurrency = Math.max(1, input.limits?.verificationConcurrency ?? 1);
  const discoveryBudgetRatio = Math.min(0.6, Math.max(0.15, input.limits?.discoveryBudgetRatio ?? 0.3));
  const acquisitionBudgetRatio = Math.min(0.6, Math.max(0.2, input.limits?.acquisitionBudgetRatio ?? 0.4));
  const roundReserveRatio = Math.min(0.5, Math.max(0, input.limits?.roundReserveRatio ?? 0.25));
  const fetchFn = input.deps.fetchImpl ?? fetch;

  const deadlineController = new AbortController();
  const deadlineTimer = setTimeout(() => {
    deadlineController.abort('deadline_exceeded');
  }, maxDurationMs);

  const remainingMs = () => Math.max(0, maxDurationMs - (Date.now() - startedAt));
  const createScopedSignal = (timeoutMs: number): AbortSignal => {
    const rem = Math.max(250, Math.min(perOperationTimeoutMs, timeoutMs, remainingMs()));
    const signals: AbortSignal[] = [deadlineController.signal, AbortSignal.timeout(rem)];
    if (input.signal) signals.push(input.signal);
    return AbortSignal.any(signals);
  };

  const queriesExecuted: AutonomousAcquisitionAuditReport['queriesExecuted'] = [];
  const candidatesByProvider: Record<string, number> = {};
  const seenCandidateKeys = new Set<string>();
  const seenFileHashes = new Set<string>();
  const rejectedCandidates: AutonomousAcquisitionAuditReport['rejectedCandidates'] = [];
  const relevanceDecisions: MediaRelevanceDecision[] = [];
  const approvedAssets: AcquiredMediaAsset[] = [];
  const approvedMetaById = new Map<
    string,
    {
      title: string;
      origin: MediaProviderId;
      sourceUrl: string;
      localPath: string;
      fileSizeBytes: number;
      sha256: string;
      durationSec: number;
      decision: MediaRelevanceDecision;
    }
  >();
  const allStatuses: ProviderAttemptStatus[] = [];
  const autoResolvedGaps: AutonomousAcquisitionAuditReport['autoResolvedGaps'] = [];

  let candidatesFoundCount = 0;
  let acquiredFilesCount = 0;
  let duplicateFilesSkipped = 0;
  let ytDlpBlocked = false;
  let uncoveredAfterRound1 = new Set<string>();
  let stoppedReason: AutonomousAcquisitionAuditReport['stoppedReason'] = 'max_rounds';
  let resumedFromCheckpoint = false;
  const completedQueryKeys = new Set<string>();
  const candidateStates = new Map<string, CandidateLifecycleState>();
  const discoveredPool = new Map<
    string,
    { segmentId: string; cand: MediaSourceCandidate; priorityScore: number }
  >();
  interface PendingVerificationAsset {
    segmentId: string;
    cand: MediaSourceCandidate;
    filePath: string;
    fileSizeBytes: number;
    sha256: string;
    durationSec: number;
    mediaId: string;
    round: number;
  }
  const pendingVerificationAssets = new Map<string, PendingVerificationAsset>();
  const failedDownloads: AcquisitionFunnelMetrics['failedDownloads'] = [];
  const visionDiagnostics: AcquisitionFunnelMetrics['visionDiagnostics'] = {
    callsAttempted: 0,
    callsSucceeded: 0,
    callsFailed: 0,
    providerErrors: [],
  };

  const segMetricsMap = new Map<string, SegmentAcquisitionMetrics>();
  for (const s of input.segments) {
    segMetricsMap.set(s.segmentId, {
      segmentId: s.segmentId,
      subject: s.subject,
      queriesExecuted: 0,
      candidatesFound: 0,
      downloadsAttempted: 0,
      downloadsSucceeded: 0,
      rejectedCount: 0,
      approvedCount: 0,
      timeConsumedMs: 0,
      covered: false,
      usableDurationSec: 0,
      expectedDurationSec: s.expectedDurationSec,
    });
  }

  const checkpointFile =
    input.checkpointPath === false ? null : (input.checkpointPath ?? join(input.mediaDir, '.acquisition-checkpoint.json'));
  if (checkpointFile && existsSync(checkpointFile)) {
    try {
      const saved = JSON.parse(readFileSync(checkpointFile, 'utf8')) as {
        projectId?: string;
        completedQueryKeys?: string[];
        seenCandidateKeys?: string[];
        seenFileHashes?: string[];
        candidateStateEntries?: Array<[string, CandidateLifecycleState]>;
        discoveredPoolEntries?: Array<[string, { segmentId: string; cand: MediaSourceCandidate; priorityScore: number }]>;
        pendingVerificationEntries?: Array<[string, PendingVerificationAsset]>;
        failedDownloads?: AcquisitionFunnelMetrics['failedDownloads'];
        queriesExecuted?: AutonomousAcquisitionAuditReport['queriesExecuted'];
        candidatesFoundCount?: number;
        candidatesByProvider?: Record<string, number>;
        acquiredFilesCount?: number;
        duplicateFilesSkipped?: number;
        approvedAssets?: AcquiredMediaAsset[];
        approvedMetaEntries?: Array<[string, {
          title: string;
          origin: MediaProviderId;
          sourceUrl: string;
          localPath: string;
          fileSizeBytes: number;
          sha256: string;
          durationSec: number;
          decision: MediaRelevanceDecision;
        }]>;
        rejectedCandidates?: AutonomousAcquisitionAuditReport['rejectedCandidates'];
        relevanceDecisions?: MediaRelevanceDecision[];
        segmentMetrics?: SegmentAcquisitionMetrics[];
      };
      if (saved.projectId === input.projectId) {
        resumedFromCheckpoint = true;
        for (const k of saved.completedQueryKeys ?? []) completedQueryKeys.add(k);
        for (const k of saved.seenCandidateKeys ?? []) seenCandidateKeys.add(k);
        for (const h of saved.seenFileHashes ?? []) seenFileHashes.add(h);
        for (const [k, st] of saved.candidateStateEntries ?? []) candidateStates.set(k, st);
        for (const [k, d] of saved.discoveredPoolEntries ?? []) discoveredPool.set(k, d);
        for (const [k, p] of saved.pendingVerificationEntries ?? []) {
          if (existsSync(p.filePath)) pendingVerificationAssets.set(k, p);
        }
        if (saved.failedDownloads) failedDownloads.push(...saved.failedDownloads);
        if (saved.queriesExecuted) queriesExecuted.push(...saved.queriesExecuted);
        candidatesFoundCount = saved.candidatesFoundCount ?? 0;
        if (saved.candidatesByProvider) Object.assign(candidatesByProvider, saved.candidatesByProvider);
        acquiredFilesCount = saved.acquiredFilesCount ?? 0;
        duplicateFilesSkipped = saved.duplicateFilesSkipped ?? 0;
        if (saved.approvedAssets) {
          for (const a of saved.approvedAssets) {
            if (existsSync(a.uri)) approvedAssets.push(a);
          }
        }
        if (saved.approvedMetaEntries) {
          for (const [id, meta] of saved.approvedMetaEntries) {
            if (existsSync(meta.localPath)) approvedMetaById.set(id, meta);
          }
        }
        if (saved.rejectedCandidates) rejectedCandidates.push(...saved.rejectedCandidates);
        if (saved.relevanceDecisions) relevanceDecisions.push(...saved.relevanceDecisions);
        for (const sm of saved.segmentMetrics ?? []) {
          segMetricsMap.set(sm.segmentId, sm);
        }
      }
    } catch {
      // ignore corrupted checkpoint
    }
  }

  const saveCheckpoint = () => {
    if (!checkpointFile) return;
    try {
      mkdirSync(input.mediaDir, { recursive: true });
      writeFileSync(
        checkpointFile,
        JSON.stringify(
          {
            projectId: input.projectId,
            savedAt: new Date().toISOString(),
            completedQueryKeys: [...completedQueryKeys],
            seenCandidateKeys: [...seenCandidateKeys],
            seenFileHashes: [...seenFileHashes],
            candidateStateEntries: [...candidateStates.entries()],
            discoveredPoolEntries: [...discoveredPool.entries()],
            pendingVerificationEntries: [...pendingVerificationAssets.entries()],
            failedDownloads,
            queriesExecuted,
            candidatesFoundCount,
            candidatesByProvider,
            acquiredFilesCount,
            duplicateFilesSkipped,
            approvedAssets,
            approvedMetaEntries: [...approvedMetaById.entries()],
            rejectedCandidates,
            relevanceDecisions,
            segmentMetrics: [...segMetricsMap.values()],
          },
          null,
          2,
        ),
        'utf8',
      );
    } catch {
      // non-fatal
    }
  };

  const effectiveDeps = (): ResilientAcquisitionDeps => {
    if (!ytDlpBlocked) return input.deps;
    const { ytDlpSearchFn: _s, ytDlpAcquireFn: _a, ...rest } = input.deps;
    return rest;
  };

  let latestCoverage: MediaCoverageReport = planMediaCoverage({
    segments: input.segments,
    assets: approvedAssets,
    ...(input.format ? { format: input.format } : {}),
    relevanceDecisions,
    requireRelevanceApproval: true,
  });

  let roundsExecuted = 0;

  try {
    for (let round = 1; round <= maxRounds; round += 1) {
      if (input.signal?.aborted) {
        stoppedReason = 'aborted';
        break;
      }
      if (deadlineController.signal.aborted || remainingMs() <= 250) {
        stoppedReason = 'deadline_exceeded';
        break;
      }
      if (queriesExecuted.length >= maxQueriesTotal) {
        stoppedReason = 'max_queries';
        break;
      }
      if (latestCoverage.gatePassed) {
        stoppedReason = 'coverage_satisfied';
        break;
      }

      roundsExecuted = round;
      const targetSegments =
        round === 1
          ? input.segments
          : input.segments.filter((s) => latestCoverage.uncoveredSubjects.includes(s.subject));

      if (targetSegments.length === 0) {
        stoppedReason = 'coverage_satisfied';
        break;
      }

      const rawRoundQueries =
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

      const segmentById = new Map(input.segments.map((s) => [s.segmentId, s]));
      const roundQueries =
        stageMode === 'verify_pending_only'
          ? []
          : rawRoundQueries
              .filter((item) => !completedQueryKeys.has(`${item.segment.segmentId}:${item.query.toLowerCase()}`))
              .slice(0, Math.max(0, maxQueriesTotal - queriesExecuted.length));

      // Distribute time budget across segments with reserve for additional rounds
      const remTotal = remainingMs();
      const roundBudgetMs =
        round === 1 && maxRounds > 1 ? Math.round(remTotal * (1 - roundReserveRatio)) : remTotal;
      const discoveryBudgetMs =
        stageMode === 'discover_only'
          ? roundBudgetMs
          : stageMode === 'verify_pending_only'
            ? 0
            : Math.max(2_000, Math.round(roundBudgetMs * discoveryBudgetRatio));
      const acquisitionBudgetMs =
        stageMode === 'discover_only' || stageMode === 'verify_pending_only'
          ? 0
          : Math.max(2_000, Math.round(roundBudgetMs * acquisitionBudgetRatio));
      const discoveryStartedAt = Date.now();
      const perQueryTimeoutMs = Math.max(
        1_200,
        Math.min(
          perOperationTimeoutMs,
          Math.floor((discoveryBudgetMs * discoveryConcurrency) / Math.max(1, roundQueries.length)),
        ),
      );

      // STAGE 1: Breadth-first Discovery across ALL target segments BEFORE heavy downloads
      const discoveredBySegment = new Map<
        string,
        Array<{ segment: ScriptCoverageSegment; cand: MediaSourceCandidate; priorityScore: number }>
      >();

      // Re-populate discoveredBySegment from checkpoint pool for uncovered segments that still have 'discovered' candidates
      for (const [candKey, entry] of discoveredPool.entries()) {
        if (candidateStates.get(candKey) !== 'discovered') continue;
        const seg = segmentById.get(entry.segmentId);
        if (!seg || !targetSegments.some((t) => t.segmentId === seg.segmentId)) continue;
        const list = discoveredBySegment.get(seg.segmentId) ?? [];
        list.push({ segment: seg, cand: entry.cand, priorityScore: entry.priorityScore });
        discoveredBySegment.set(seg.segmentId, list);
      }

      if (stageMode !== 'verify_pending_only' && roundQueries.length > 0) {
        await runWithConcurrency(roundQueries, discoveryConcurrency, async (item) => {
          if (
            input.signal?.aborted ||
            deadlineController.signal.aborted ||
            remainingMs() <= 250 ||
            Date.now() - discoveryStartedAt >= discoveryBudgetMs
          ) {
            return;
          }
          const qStart = Date.now();
          const sm = segMetricsMap.get(item.segment.segmentId)!;
          sm.queriesExecuted += 1;
          queriesExecuted.push({
            round,
            segmentId: item.segment.segmentId,
            subject: item.segment.subject,
            query: item.query,
          });
          completedQueryKeys.add(`${item.segment.segmentId}:${item.query.toLowerCase()}`);

          try {
            const searchRes = await searchResilientMediaSources(
              item.query,
              effectiveDeps(),
              createScopedSignal(perQueryTimeoutMs),
            );
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
              sm.candidatesFound += 1;

              if (cand.durationSec && cand.durationSec > maxCandidateDurationSec) {
                candidateStates.set(candKey, 'rejected');
                sm.rejectedCount += 1;
                rejectedCandidates.push({
                  mediaId: `cand_${candidatesFoundCount}`,
                  title: cand.title ?? cand.url,
                  origin: cand.origin,
                  rejectionCode: 'duration_limit_exceeded',
                  reason: `Candidato excede limite de duração (${Math.round(cand.durationSec)}s > ${maxCandidateDurationSec}s), evitando download longo bloqueante.`,
                });
                continue;
              }

              const priorityScore = scoreCandidateRelevancePriority(cand, item.segment, input.prompt);
              candidateStates.set(candKey, 'discovered');
              discoveredPool.set(candKey, { segmentId: item.segment.segmentId, cand, priorityScore });
              const list = discoveredBySegment.get(item.segment.segmentId) ?? [];
              list.push({
                segment: item.segment,
                cand,
                priorityScore,
              });
              discoveredBySegment.set(item.segment.segmentId, list);
            }
          } catch {
            // non-fatal discovery timeout for this segment; others continue
          } finally {
            sm.timeConsumedMs += Date.now() - qStart;
          }
        });
      }

      if (stageMode === 'discover_only') {
        saveCheckpoint();
        continue;
      }

      // STAGE 2: Prioritized Breadth-First Acquisition Queue (round-robin top candidates across segments)
      if (stageMode !== 'verify_pending_only') {
        for (const list of discoveredBySegment.values()) {
          list.sort((a, b) => b.priorityScore - a.priorityScore);
        }
        const acquisitionQueue: Array<{ segment: ScriptCoverageSegment; cand: MediaSourceCandidate }> = [];
        const maxPerSegThisRound = 2;
        for (let rank = 0; rank < maxPerSegThisRound; rank += 1) {
          for (const s of targetSegments) {
            const entry = discoveredBySegment.get(s.segmentId)?.[rank];
            if (entry) acquisitionQueue.push({ segment: entry.segment, cand: entry.cand });
          }
        }

        const acqStartedAt = Date.now();
        let downloadAttemptSeq = acquiredFilesCount;
        const perDownloadTimeoutMs = Math.min(
          perOperationTimeoutMs,
          Math.max(
            Math.min(perOperationTimeoutMs, 25_000),
            Math.floor((acquisitionBudgetMs * acquisitionConcurrency) / Math.max(1, acquisitionQueue.length)),
          ),
        );

        await runWithConcurrency(acquisitionQueue, acquisitionConcurrency, async (task) => {
          if (
            input.signal?.aborted ||
            deadlineController.signal.aborted ||
            remainingMs() <= 250 ||
            Date.now() - acqStartedAt >= acquisitionBudgetMs
          ) {
            return;
          }
          const aStart = Date.now();
          const sm = segMetricsMap.get(task.segment.segmentId)!;
          sm.downloadsAttempted += 1;
          const cand = task.cand;
          const candKey = `${cand.origin}:${cand.url}`;
          const acqSeq = downloadAttemptSeq;
          downloadAttemptSeq += 1;
          candidateStates.set(candKey, 'downloading');
          const opSig = createScopedSignal(perDownloadTimeoutMs);
          let filePath: string | null = null;
          let downloadFailure: { reasonCode: DownloadFailureReasonCode; detail: string } | null = null;
          try {
            if (cand.localPath && existsSync(cand.localPath)) {
              filePath = cand.localPath;
            } else if (cand.directDownloadable && /^https?:\/\//i.test(cand.url)) {
              let candidateOutFile: string | null = null;
              try {
                const res = await fetchFn(cand.url, { signal: opSig });
                if (!res.ok) {
                  downloadFailure = {
                    reasonCode: res.status === 429 ? 'anti_bot' : 'http_error',
                    detail: `HTTP ${res.status} ${res.statusText || ''}`.trim(),
                  };
                } else {
                  const buf = Buffer.from(await res.arrayBuffer());
                  if (buf.length < 1024) {
                    downloadFailure = {
                      reasonCode: 'invalid_file',
                      detail: `Arquivo muito pequeno (${buf.length} bytes)`,
                    };
                  } else if (deadlineController.signal.aborted) {
                    downloadFailure = {
                      reasonCode: 'cancelled',
                      detail: 'Prazo total excedido durante escrita do arquivo',
                    };
                  } else {
                    const ext = extname(new URL(cand.url).pathname) || '.mp4';
                    const slotNum = acqSeq + 1;
                    const outDir = join(input.mediaDir, `auto_r${round}_${slotNum}`);
                    mkdirSync(outDir, { recursive: true });
                    candidateOutFile = join(outDir, `asset_${slotNum}${ext}`);
                    writeFileSync(candidateOutFile, buf);
                    filePath = candidateOutFile;
                  }
                }
              } catch (err) {
                if (candidateOutFile && existsSync(candidateOutFile)) {
                  try { unlinkSync(candidateOutFile); } catch { /* ignore */ }
                }
                downloadFailure = classifyDownloadFailure(err);
                filePath = null;
              }
            } else if (cand.origin === 'yt_dlp' && !ytDlpBlocked && input.deps.ytDlpAcquireFn) {
              try {
                filePath = await input.deps.ytDlpAcquireFn(cand.url, acqSeq, input.mediaDir, opSig);
                if (!filePath || !existsSync(filePath)) {
                  downloadFailure = {
                    reasonCode: 'invalid_file',
                    detail: 'yt-dlp concluiu sem produzir arquivo válido',
                  };
                }
              } catch (err) {
                downloadFailure = classifyDownloadFailure(err);
                if (downloadFailure.reasonCode === 'anti_bot') {
                  ytDlpBlocked = true;
                }
                filePath = null;
              }
            } else {
              downloadFailure = {
                reasonCode: 'other',
                detail: ytDlpBlocked ? 'yt-dlp bloqueado por anti-bot nesta execução' : 'Fonte sem método de download disponível',
              };
            }

            if (!filePath || !existsSync(filePath)) {
              const failure = downloadFailure ?? { reasonCode: 'other' as const, detail: 'Falha desconhecida no download' };
              candidateStates.set(candKey, 'failed');
              failedDownloads.push({
                segmentId: task.segment.segmentId,
                url: cand.url,
                title: cand.title ?? cand.url,
                origin: cand.origin,
                reasonCode: failure.reasonCode,
                detail: failure.detail,
              });
              return;
            }

            const fileSizeBytes = statSync(filePath).size;
            if (fileSizeBytes < 1024) {
              candidateStates.set(candKey, 'failed');
              failedDownloads.push({
                segmentId: task.segment.segmentId,
                url: cand.url,
                title: cand.title ?? filePath,
                origin: cand.origin,
                reasonCode: 'invalid_file',
                detail: `Arquivo inválido (${fileSizeBytes} bytes)`,
              });
              return;
            }

            const sha256 = createHash('sha256').update(readFileSync(filePath)).digest('hex');
            if (seenFileHashes.has(sha256)) {
              duplicateFilesSkipped += 1;
              candidateStates.set(candKey, 'rejected');
              sm.rejectedCount += 1;
              rejectedCandidates.push({
                mediaId: `dup_${duplicateFilesSkipped}`,
                title: cand.title ?? filePath,
                origin: cand.origin,
                rejectionCode: 'duplicate_file_hash',
                reason: `Arquivo duplicado idêntico (SHA-256 ${sha256.slice(0, 12)}) descartado para não inflar cobertura.`,
              });
              return;
            }
            seenFileHashes.add(sha256);
            acquiredFilesCount += 1;
            sm.downloadsSucceeded += 1;
            candidateStates.set(candKey, 'pending_visual_verification');

            const mediaId = `auto_${cand.origin}_${acquiredFilesCount}`;
            let durationSec = cand.durationSec ?? 12;
            if (input.probeDurationFn) {
              try {
                durationSec = await input.probeDurationFn(filePath);
              } catch {
                durationSec = cand.durationSec ?? 12;
              }
            }
            pendingVerificationAssets.set(candKey, {
              segmentId: task.segment.segmentId,
              cand,
              filePath,
              fileSizeBytes,
              sha256,
              durationSec,
              mediaId,
              round,
            });
          } finally {
            sm.timeConsumedMs += Date.now() - aStart;
          }
        });
      }

      // STAGE 3: Visual Verification Queue (resumes pending_visual_verification assets FIRST)
      const verificationQueue = [...pendingVerificationAssets.entries()].map(([candKey, item]) => ({
        candKey,
        item,
      }));
      await runWithConcurrency(verificationQueue, verificationConcurrency, async ({ candKey, item }) => {
        if (input.signal?.aborted || deadlineController.signal.aborted || remainingMs() <= 200) {
          // Preserve file & keep state as pending_visual_verification (NEVER classify as editorial rejection!)
          return;
        }
        const seg = segmentById.get(item.segmentId);
        if (!seg) return;
        const vStart = Date.now();
        const sm = segMetricsMap.get(item.segmentId)!;
        if (input.analyzeFrames) visionDiagnostics.callsAttempted += 1;
        try {
          const decision = await evaluateMediaRelevance(
            {
              mediaId: item.mediaId,
              uri: item.filePath,
              ...(item.cand.title ? { title: item.cand.title } : {}),
              ...(item.cand.description ? { description: item.cand.description } : {}),
              origin: item.cand.origin,
              durationSec: item.durationSec,
              projectId: input.projectId,
              sha256: item.sha256,
            },
            {
              segmentId: seg.segmentId,
              prompt: input.prompt,
              narrationText: seg.narrationText,
              ...(input.genre ? { genre: input.genre } : {}),
              ...(seg.entities ? { expectedEntities: seg.entities } : {}),
            },
            {
              ...(input.analyzeFrames ? { analyzeFrames: input.analyzeFrames } : {}),
              ...(input.requireVisualVerification !== undefined
                ? { requireVisualVerification: input.requireVisualVerification }
                : {}),
            },
          );

          if (decision.visualVerificationError) {
            if (input.analyzeFrames) visionDiagnostics.callsFailed += 1;
            visionDiagnostics.providerErrors.push(decision.visualVerificationError.slice(0, 200));
            // Infra/provider failure during verification: keep file in pending_visual_verification to resume later!
            candidateStates.set(candKey, 'pending_visual_verification');
            return;
          }

          if (input.analyzeFrames) visionDiagnostics.callsSucceeded += 1;
          pendingVerificationAssets.delete(candKey);
          relevanceDecisions.push(decision);

          if (!decision.accepted) {
            candidateStates.set(candKey, 'rejected');
            sm.rejectedCount += 1;
            rejectedCandidates.push({
              mediaId: item.mediaId,
              title: item.cand.title ?? item.filePath,
              origin: item.cand.origin,
              ...(decision.rejectionCode ? { rejectionCode: decision.rejectionCode } : {}),
              reason: decision.reason,
            });
            return;
          }

          candidateStates.set(candKey, 'verified');
          sm.approvedCount += 1;
          approvedAssets.push({
            mediaId: item.mediaId,
            uri: item.filePath,
            ...(item.cand.title ? { title: item.cand.title } : {}),
            origin: item.cand.origin,
            durationSec: item.durationSec,
            compatible: true,
            relevantToEntities: decision.matchedEntities,
          });
          approvedMetaById.set(item.mediaId, {
            title: item.cand.title ?? item.filePath,
            origin: item.cand.origin,
            sourceUrl: item.cand.url,
            localPath: item.filePath,
            fileSizeBytes: item.fileSizeBytes,
            sha256: item.sha256,
            durationSec: item.durationSec,
            decision,
          });

          if (round > 1 && uncoveredAfterRound1.has(seg.segmentId)) {
            autoResolvedGaps.push({
              segmentId: seg.segmentId,
              subject: seg.subject,
              resolvedInRound: round,
              mediaId: item.mediaId,
            });
            uncoveredAfterRound1.delete(seg.segmentId);
          }
        } finally {
          sm.timeConsumedMs += Date.now() - vStart;
        }
      });

      // STAGE 4: Coverage update & Checkpoint persistence
      latestCoverage = planMediaCoverage({
        segments: input.segments,
        assets: approvedAssets,
        ...(input.format ? { format: input.format } : {}),
        relevanceDecisions,
        requireRelevanceApproval: true,
      });

      for (const segCov of latestCoverage.segments) {
        const sm = segMetricsMap.get(segCov.segmentId);
        if (sm) {
          sm.covered = segCov.covered;
          sm.usableDurationSec = segCov.usableDurationSec;
        }
      }

      if (round === 1) {
        uncoveredAfterRound1 = new Set(
          latestCoverage.segments.filter((s) => !s.covered).map((s) => s.segmentId),
        );
      }

      saveCheckpoint();

      if (latestCoverage.gatePassed) {
        stoppedReason = 'coverage_satisfied';
        break;
      }
      if (stageMode === 'verify_pending_only' && pendingVerificationAssets.size === 0) {
        break;
      }
    }
    if (stoppedReason === 'max_rounds' && deadlineController.signal.aborted) {
      stoppedReason = 'deadline_exceeded';
    }
  } finally {
    clearTimeout(deadlineTimer);
    saveCheckpoint();
  }

  const approvedMediaDetails: ApprovedMediaAuditDetail[] = [];
  for (const [mediaId, meta] of approvedMetaById.entries()) {
    const usefulIntervals: ApprovedMediaAuditDetail['usefulIntervals'] = [];
    const coveredSegmentIds: string[] = [];
    for (const seg of latestCoverage.segments) {
      for (const iv of seg.relevantIntervals) {
        if (iv.mediaId === mediaId) {
          usefulIntervals.push({ segmentId: seg.segmentId, startSec: iv.startSec, endSec: iv.endSec });
          if (!coveredSegmentIds.includes(seg.segmentId)) coveredSegmentIds.push(seg.segmentId);
        }
      }
    }
    approvedMediaDetails.push({
      mediaId,
      title: meta.title,
      origin: meta.origin,
      sourceUrl: meta.sourceUrl,
      localPath: meta.localPath,
      fileSizeBytes: meta.fileSizeBytes,
      sha256: meta.sha256,
      durationSec: Number(meta.durationSec.toFixed(2)),
      relevanceTier: meta.decision.relevanceTier ?? 'exact_segment_match',
      ...(meta.decision.correspondenceLevel ? { correspondenceLevel: meta.decision.correspondenceLevel } : {}),
      ...(meta.decision.visualVerificationStatus
        ? { visualVerificationStatus: meta.decision.visualVerificationStatus }
        : {}),
      ...(meta.decision.visualConfidence !== undefined ? { visualConfidence: meta.decision.visualConfidence } : {}),
      ...(meta.decision.visualEvidence ? { visualEvidence: meta.decision.visualEvidence } : {}),
      matchedEntities: meta.decision.matchedEntities,
      sampledTimestampsSec: meta.decision.sampledTimestampsSec,
      coveredSegmentIds,
      usefulIntervals,
      editorialJustification: meta.decision.reason,
    });
  }

  const unresolvedGapsForReview = latestCoverage.segments
    .filter((s) => !s.covered)
    .map((s) => ({
      segmentId: s.segmentId,
      subject: s.subject,
      suggestedQuery: `${input.prompt.split(/[—:|]/)[0]?.trim() || input.prompt} ${s.subject}`.trim(),
      reason: `Cobertura insuficiente após ${roundsExecuted} rodada(s) automática(s): ${s.usableDurationSec}s / ${s.expectedDurationSec}s.`,
    }));

  const stateCounts: Record<CandidateLifecycleState, number> = {
    discovered: 0,
    downloading: 0,
    downloaded: 0,
    pending_visual_verification: 0,
    verified: 0,
    rejected: 0,
    failed: 0,
  };
  for (const st of candidateStates.values()) {
    stateCounts[st] = (stateCounts[st] ?? 0) + 1;
  }
  const failureReasons: Record<DownloadFailureReasonCode, number> = {
    timeout: 0,
    anti_bot: 0,
    http_error: 0,
    format_unavailable: 0,
    invalid_file: 0,
    cancelled: 0,
    other: 0,
  };
  for (const f of failedDownloads) {
    failureReasons[f.reasonCode] = (failureReasons[f.reasonCode] ?? 0) + 1;
  }
  const rejectionReasons: Record<string, number> = {};
  for (const r of rejectedCandidates) {
    const code = r.rejectionCode ?? 'other';
    rejectionReasons[code] = (rejectionReasons[code] ?? 0) + 1;
  }
  const totalDownloadsAttempted = [...segMetricsMap.values()].reduce(
    (acc, s) => acc + s.downloadsAttempted,
    0,
  );
  const roundRate = (num: number, den: number): number =>
    den > 0 ? Number((num / den).toFixed(3)) : 0;

  return {
    roundsExecuted,
    elapsedMs: Date.now() - startedAt,
    totalDeadlineMs: maxDurationMs,
    perOperationTimeoutMs,
    budgetBreakdown: {
      totalBudgetMs: maxDurationMs,
      budgetMultiplier,
      discoveryBudgetMs: Math.round(maxDurationMs * discoveryBudgetRatio),
      acquisitionBudgetMs: Math.round(maxDurationMs * acquisitionBudgetRatio),
      verificationBudgetMs: Math.max(0, maxDurationMs - Math.round(maxDurationMs * (discoveryBudgetRatio + acquisitionBudgetRatio))),
      resumedFromCheckpoint,
    },
    stoppedReason,
    queriesExecuted,
    candidatesFoundCount,
    candidatesByProvider,
    acquiredFilesCount,
    duplicateFilesSkipped,
    approvedForAssemblyCount: approvedAssets.length,
    rejectedCandidates,
    autoResolvedGaps,
    unresolvedGapsForReview,
    providerStatuses: allStatuses,
    segmentMetrics: [...segMetricsMap.values()],
    funnelMetrics: {
      counts: stateCounts,
      conversionRates: {
        discoveryToDownloadAttemptRate: roundRate(totalDownloadsAttempted, candidatesFoundCount),
        downloadAttemptToDownloadedRate: roundRate(acquiredFilesCount, totalDownloadsAttempted),
        downloadedToVerifiedRate: roundRate(approvedAssets.length, acquiredFilesCount),
        discoveredToVerifiedRate: roundRate(approvedAssets.length, candidatesFoundCount),
      },
      failureReasons,
      rejectionReasons,
      failedDownloads: failedDownloads.slice(0, 60),
      pendingVerificationCount: pendingVerificationAssets.size,
      visionDiagnostics: {
        ...visionDiagnostics,
        providerErrors: [...new Set(visionDiagnostics.providerErrors)].slice(0, 15),
      },
    },
    coverageReport: latestCoverage,
    approvedAssets,
    approvedMediaDetails,
    relevanceDecisions,
  };
}
