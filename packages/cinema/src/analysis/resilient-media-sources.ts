import { canonicalQueryKey } from '../editorial/contextual-media-queries.js';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  computeAdaptiveSampleTimestamps,
  RemoteSamplingCache,
  sampleRemoteFramesWithFfmpeg,
} from './remote-frame-sampler.js';
import {
  computeVisionDecisionCacheKey,
  evaluateMediaRelevance,
  extractTopicEntities,
  isAssemblyEligibleDecision,
  SCENE_GROUNDING_POLICY_VERSION,
  type DistributedFrameAnalysis,
  type DistributedFrameAnalysisResult,
  type VisionVerificationDiagnostics,
  type MediaCorrespondenceLevel,
  type MediaRelevanceDecision,
  type ScriptSegmentExpectation,
  type VisualVerificationStatus,
} from '../qc/media-relevance-gate.js';
import type { AetheraEvolutionCore } from '../evolution/evolution-core.js';
import { recordSceneGroundingNegativeExample } from '../evolution/production-learning.js';
import {
  isAnimeSubjectOrGenre,
  type AnimeMediaSourceAdapter,
  type AnimeProvenanceAdapter,
} from './anime-source-adapters.js';
import {
  buildMediaRecoveryPlan,
  expandScriptOrientedQueries,
  planMediaCoverage,
  type AcquiredMediaAsset,
  type CoverageFormat,
  type MediaCoverageGap,
  type MediaCoverageReport,
  type MediaRecoveryQuery,
  type ScriptCoverageSegment,
} from './media-coverage-planner.js';
import type { MediaProviderRegistry } from './media-providers/registry.js';
import { inferContentDomain, type ContentDomain, type MediaCandidateAssessment } from './media-providers/semantic-media.js';
import { buildSceneMediaApproval, type SceneMediaApproval } from './media-approval.js';
import type {
  AcquisitionMethod,
  LicenseDecision,
  MediaClassification,
  MediaProviderKey,
  ProviderMediaItem,
  SceneSourceContext,
} from './media-providers/types.js';

export type MediaProviderId =
  | 'local_library'
  | 'youtube_data_api'
  | 'wikimedia_commons'
  | 'internet_archive'
  | 'sakugabooru'
  | 'yt_dlp'
  | MediaProviderKey;

export interface MediaSourceCandidate {
  url: string;
  localPath?: string;
  title?: string;
  description?: string;
  chapters?: Array<{ startSec: number; endSec: number; title: string }>;
  origin: MediaProviderId;
  license: string;
  durationSec?: number;
  directDownloadable?: boolean;
  provenanceMetadata?: {
    postId?: string | number;
    postUrl?: string;
    author?: string;
    source?: string;
    tags?: string[];
    rating?: string;
    usageNotice?: string;
  };
  /** Present when the candidate came from the media-provider registry (provenance, class, license). */
  providerItem?: ProviderMediaItem;
  licenseDecision?: LicenseDecision;
  classification?: MediaClassification;
  acquisitionMethod?: AcquisitionMethod;
  /** Pre-download assessment: media type, identity, editorial-role ceiling and rights (never approval by itself). */
  assessment?: MediaCandidateAssessment;
}

export interface ProviderAttemptStatus {
  provider: MediaProviderId;
  status:
    | 'ok'
    | 'empty'
    | 'skipped_no_auth'
    | 'skipped_disabled'
    | 'blocked_auth_or_antibot'
    | 'rate_limited'
    | 'circuit_open'
    | 'cancelled'
    | 'error';
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
  animeMediaSource?: AnimeMediaSourceAdapter;
  animeProvenance?: AnimeProvenanceAdapter;
  extractFrameForProvenance?: (uri: string, timestampSec: number) => Promise<Buffer | null>;
  /**
   * Media-provider registry (IGDB, Steam, YouTube, Pexels, Pixabay, anime reactions, datasets). When present, each
   * search is planned per scene, gated on source fidelity and license, and acquisitions stream through the registry.
   */
  mediaProviders?: { registry: MediaProviderRegistry; context?: SceneSourceContext };
  ytDlpSearchFn?: (
    query: string,
    count: number,
    signal?: AbortSignal,
  ) => Promise<
    Array<{
      url: string;
      title?: string;
      durationSec?: number;
      durationSeconds?: number | null;
      description?: string;
      chapters?: Array<{ startSec: number; endSec: number; title: string }>;
    }>
  >;
  ytDlpAcquireFn?: (
    url: string,
    slotIndex: number,
    mediaDir: string,
    signal?: AbortSignal,
    downloadSection?: string,
    onProgress?: (progress: { bytesDone: number; bytesTotal: number | null; pct?: number | null }) => void,
  ) => Promise<string | null>;
  /** Optional `yt-dlp -g` resolver for Level 1 pre-download remote frame sampling. */
  resolveStreamUrlFn?: (
    url: string,
    signal?: AbortSignal,
  ) => Promise<{
    streamUrl: string | null;
    httpHeaders?: Record<string, string>;
    ageGated?: boolean;
    latencyMs?: number;
    error?: string;
  }>;
  onDownloadProgress?: (progress: {
    url: string;
    slotIndex: number;
    segmentId?: string;
    title?: string;
    bytesDone: number;
    bytesTotal: number | null;
    pct: number | null;
  }) => void;
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
  options?: { genre?: string; prompt?: string; scene?: SceneSourceContext },
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

  // 1b. Anime-specific source adapter (e.g. Sakugabooru) — strictly isolated to anime topics
  // Domain, not narrative format: an anime top list or essay still reaches anime sources.
  const searchDomain = inferContentDomain({
    ...(deps.mediaProviders?.context ?? {}),
    ...(options?.scene ?? {}),
    ...(options?.prompt ? { prompt: options.prompt } : {}),
    ...(options?.genre ? { genre: options.genre } : {}),
    query,
  }).domain;
  if (deps.animeMediaSource && searchDomain === 'anime') {
    try {
      const animeRes = await deps.animeMediaSource.searchClips({
        query,
        limit: 6,
        safeOnly: true,
        ...(signal ? { signal } : {}),
      });
      const mappedAnime: MediaSourceCandidate[] = animeRes.candidates.map((c) => ({
        url: c.url,
        title: c.title,
        description: c.tags.join(' '),
        origin: 'sakugabooru',
        license: c.usageNotice ?? 'sakugabooru_reference_requires_editorial_review',
        directDownloadable: true,
        provenanceMetadata: {
          postId: c.id,
          ...(c.postUrl ? { postUrl: c.postUrl } : {}),
          ...(c.author ? { author: c.author } : {}),
          ...(c.source ? { source: c.source } : {}),
          tags: c.tags,
          rating: c.rating,
          ...(c.usageNotice ? { usageNotice: c.usageNotice } : {}),
        },
      }));
      candidates.push(...mappedAnime);
      providerStatuses.push({
        provider: 'sakugabooru',
        status:
          animeRes.status === 'ok'
            ? 'ok'
            : animeRes.status === 'empty'
              ? 'empty'
              : animeRes.status === 'rate_limited'
                ? 'blocked_auth_or_antibot'
                : 'error',
        ...(animeRes.error ? { detail: animeRes.error } : {}),
        count: mappedAnime.length,
      });
    } catch (err) {
      providerStatuses.push({
        provider: 'sakugabooru',
        status: 'error',
        detail: (err as Error).message,
        count: 0,
      });
    }
  }

  // 1c. Media-provider registry (scene-aware source selection, fidelity + license gates, fallback)
  let registryCoversYouTube = false;
  if (deps.mediaProviders) {
    const { registry, context: baseContext } = deps.mediaProviders;
    registryCoversYouTube = registry.unusableReason('youtube') === null;
    const sceneContext: SceneSourceContext = {
      ...(baseContext ?? {}),
      ...(options?.scene ?? {}),
      ...(options?.prompt ? { prompt: options.prompt } : {}),
      ...(options?.genre ? { genre: options.genre } : {}),
    };
    try {
      const res = await registry.searchForScene(query, sceneContext, { ...(signal ? { signal } : {}) });
      candidates.push(...res.accepted.map((s) => providerItemToCandidate(s.item, s.license, s.assessment)));
      for (const a of res.attempts) {
        providerStatuses.push({ provider: a.provider, status: a.status, count: a.count, ...(a.detail ? { detail: a.detail } : {}) });
      }
    } catch (err) {
      providerStatuses.push({ provider: 'steam', status: 'error', detail: `Registro de provedores falhou: ${(err as Error).message}`, count: 0 });
    }
  }

  // 2. Official YouTube Data API v3 (legacy path; skipped when the registry already covers YouTube)
  if (registryCoversYouTube) {
    // queried through the registry with quota-aware rate limiting
  } else if (deps.youtubeApiKey) {
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
  const nonStaticVideoCandidates = candidates.filter(
    (c) => c.origin !== 'wikimedia_commons' && !/\.(jpg|jpeg|png|svg|gif)(\?|$)/i.test(c.url),
  );
  const hasYouTubeCandidates = nonStaticVideoCandidates.some(
    (c) => c.origin === 'youtube' || c.origin === 'youtube_data_api',
  );
  if (deps.ytDlpSearchFn && (nonStaticVideoCandidates.length < 3 || !hasYouTubeCandidates)) {
    try {
      const ytdlpHits = await deps.ytDlpSearchFn(query, 4, signal);
      const mapped = ytdlpHits
        .filter((r) => Boolean(r.url))
        .map((r) => {
          const dur = r.durationSec ?? (typeof r.durationSeconds === 'number' ? r.durationSeconds : undefined);
          return {
            url: r.url,
            ...(r.title ? { title: r.title } : {}),
            ...(r.description ? { description: r.description } : {}),
            ...(r.chapters && r.chapters.length > 0 ? { chapters: r.chapters } : {}),
            ...(dur !== undefined ? { durationSec: dur } : {}),
            origin: 'yt_dlp' as const,
            license: 'external_reference',
            directDownloadable: false,
          };
        });
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
  /**
   * Rights situation, always explicit. `licensed`: known license allows the use. `official_promotional`: published
   * by the rights holder's verified channel (promotional use, still subject to review before publishing).
   * `unresolved_third_party`: identity verified, rights unknown — usable in the draft, blocks publication until a
   * human decides.
   */
  rightsStatus: MediaRightsStatus;
  rightsNote: string;
  /** Origin, author, license, attribution and restrictions — present for media from the provider registry. */
  provenance?: {
    provider: string;
    pageUrl: string;
    author?: string;
    attributionText?: string;
    licenseId: string;
    licenseName: string;
    licenseUrl?: string;
    licenseStatus: LicenseDecision['status'];
    obligations: LicenseDecision['obligations'];
    classification: MediaClassification;
    classificationConfidence: number;
    retrievedAt: string;
  };
}

export interface PendingLicenseReviewEntry {
  mediaId: string;
  segmentId: string;
  title: string;
  origin: string;
  sourceUrl: string;
  localPath: string;
  licenseId: string;
  reasons: string[];
  relevanceAccepted: boolean;
  /** True when the draft assembly uses it (policy `assemble_with_rights_review`); publication stays blocked. */
  usedInDraft?: boolean;
}

export type MediaRightsStatus = 'licensed' | 'official_promotional' | 'unresolved_third_party';

/**
 * What to do with media whose identity/relevance is verified but whose license needs a human decision.
 * `block_pending`: keep it out of the assembly (legacy). `assemble_with_rights_review`: use it in the draft render,
 * record it for rights review and block publication until a human decides.
 */
export type LicenseReviewPolicy = 'block_pending' | 'assemble_with_rights_review';

/** Per-scene diagnostic for the production UI: the full funnel for one scene. */
export interface SceneMediaDiagnostic {
  segmentId: string;
  subject: string;
  queries: string[];
  sourcesConsulted: string[];
  candidatesFound: number;
  sharedQueries: number;
  sharedCandidates: number;
  attempts: number;
  /** Number of semantic-provider attempts attributed to this scene. */
  visualAttempts: number;
  technicalBlocked: number;
  mediaUnavailable: number;
  acquired: number;
  approved: Array<{ mediaId: string; title: string; origin: string; sourceUrl: string; rightsStatus: MediaRightsStatus }>;
  /** Identified/contextual media retained for editorial reference, never counted as scene footage. */
  contextual: Array<{ mediaId: string; title: string; origin: string; sourceUrl: string; status: 'contextual' | 'visually_verified'; reason: string }>;
  rejected: Array<{
    mediaId: string;
    title: string;
    origin: string;
    url?: string;
    thumbnailUrl?: string;
    localPath?: string;
    rejectionCode?: string;
    reason: string;
    evidence?: Array<{ timestampSec: number; description: string }>;
  }>;
  failedDownloads: Array<{ title: string; url: string; reasonCode: string; detail: string }>;
  coveredSec: number;
  expectedSec: number;
  bestAlternative?: { kind: 'unused_verified_media' | 'pending_rights_media' | 'graphic_recovery' | 'manual_import'; detail: string };
  pendingRights: number;
}

const OFFICIAL_CLASSES: ReadonlySet<MediaClassification> = new Set([
  // anime_footage reaches ≥0.8 only when the channel is a known rights holder/distributor.
  'anime_footage',
  'official_game_trailer',
  'official_screenshot',
  'promotional_artwork',
]);

/** Explicit rights situation of an approved asset (never assumed "verified" just because it is relevant). */
export function resolveRightsStatus(meta: {
  origin: MediaProviderId;
  providerItem?: ProviderMediaItem;
  licenseDecision?: LicenseDecision;
}): { rightsStatus: MediaRightsStatus; rightsNote: string } {
  const status = meta.licenseDecision?.status;
  if (status === 'allowed' || status === 'allowed_with_restrictions') {
    const obligations = meta.licenseDecision?.obligations ?? [];
    return {
      rightsStatus: 'licensed',
      rightsNote: `Licença ${meta.providerItem?.license.licenseName ?? meta.providerItem?.license.licenseId ?? 'conhecida'} permite o uso${obligations.length ? ` (obrigações: ${obligations.join(', ')})` : ''}.`,
    };
  }
  if (meta.origin === 'local_library') {
    return { rightsStatus: 'licensed', rightsNote: 'Arquivo da biblioteca local do usuário (direitos sob responsabilidade do usuário).' };
  }
  // Rights come from the provider's license terms, never from relevance, title or a channel-name match alone.
  if (
    meta.providerItem &&
    meta.providerItem.license.licenseId === 'publisher_promotional' &&
    OFFICIAL_CLASSES.has(meta.providerItem.classification) &&
    meta.providerItem.classificationConfidence >= 0.8
  ) {
    return {
      rightsStatus: 'official_promotional',
      rightsNote: 'Material promocional publicado por canal oficial do detentor dos direitos; revisar termos antes de publicar.',
    };
  }
  return {
    rightsStatus: 'unresolved_third_party',
    rightsNote:
      'Identidade verificada por frames, mas direitos de uso não confirmados (upload de terceiros ou licença desconhecida). Uso apenas no rascunho; publicação exige revisão humana.',
  };
}

/** Maps a registry item into the pipeline's candidate shape without losing provenance. */
export function providerItemToCandidate(item: ProviderMediaItem, license: LicenseDecision, assessment?: MediaCandidateAssessment): MediaSourceCandidate {
  return {
    url: item.acquisition.url ?? item.pageUrl,
    title: item.title,
    ...(item.description ? { description: item.description } : {}),
    ...(item.durationSec !== undefined ? { durationSec: item.durationSec } : {}),
    origin: item.provider,
    license: item.license.licenseId,
    directDownloadable: item.acquisition.method === 'direct_http',
    provenanceMetadata: {
      postId: item.providerItemId,
      postUrl: item.pageUrl,
      ...(item.license.author ? { author: item.license.author } : {}),
      source: item.provenance.apiEndpoint,
      tags: item.tags,
      ...(item.license.notes ? { usageNotice: item.license.notes } : {}),
    },
    providerItem: item,
    licenseDecision: license,
    classification: item.classification,
    acquisitionMethod: item.acquisition.method,
    ...(assessment ? { assessment } : {}),
  };
}

export interface SegmentAcquisitionMetrics {
  segmentId: string;
  subject: string;
  queriesExecuted: number;
  candidatesFound: number;
  /** Equivalent queries reused from another scene; not counted as local searches. */
  sharedQueries?: number;
  /** Candidate assignments received through an equivalent query. */
  sharedCandidates?: number;
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
  | 'contextual'
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
  mediaUnavailableCount: number;
  visionDiagnostics: {
    callsAttempted: number;
    callsSucceeded: number;
    callsFailed: number;
    providerErrors: string[];
    records: VisionVerificationRecord[];
  };
}

export interface VisionVerificationRecord {
  mediaId: string;
  segmentId: string;
  status: 'succeeded' | 'partial' | 'technical_blocked' | 'media_unavailable';
  provider?: string | null;
  model?: string | null;
  reportedModel?: string | null;
  durationMs?: number;
  attempts: Array<{ provider: string; outcome: string; detail?: string; durationMs?: number }>;
  error?: string;
  editorialDisposition?: 'approved' | 'contextual' | 'rejected';
}

export interface PipelineAcquisitionComparisonMetrics {
  avgTimePerCandidateMs: number;
  bytesTransferredPerCandidate: number;
  totalBytesTransferred: number;
  remoteSampleBytes: number;
  downloadedVideoBytes: number;
  remoteSampleRequests: number;
  remoteSampleLatencyMs: number;
  preDownloadCheckedCount: number;
  preDownloadRejectionRate: number;
  falsePositiveRate: number;
  fallbackPartialDownloadCount: number;
  totalAcquisitionMs: number;
  semanticCoverageByScene: Array<{
    segmentId: string;
    subject: string;
    coveredSec: number;
    expectedSec: number;
    coverageRatio: number;
    distinctClipsCount: number;
  }>;
  distinctClipsPerScene: Record<string, number>;
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
  /** Every search attempt made for an uncovered interval, including provider results and rejection causes. */
  recoveryAttempts: Array<{
    attemptId: string;
    round: number;
    segmentId: string;
    gapIndex: number;
    query: string;
    strategy: MediaRecoveryQuery['strategy'];
    sourceStatuses: ProviderAttemptStatus[];
    candidatesFound: number;
    acquiredMediaIds: string[];
    approvedMediaIds: string[];
    rejectedMediaIds: string[];
    rejectionReasons: string[];
    outcome: 'no_results' | 'download_failed' | 'rejected' | 'verified_interval' | 'contextual_only' | 'exhausted';
    /** Present when this scene reused another scene's canonical query. */
    sharedFromAttemptId?: string;
  }>;
  /** Segments whose uncovered intervals were actually targeted by this run. */
  affectedSegmentIds: string[];
  /** Media the relevance gate approved but whose license needs a human decision (never auto-approved). */
  pendingLicenseReview?: PendingLicenseReviewEntry[];
  /** Approved media whose rights are not resolved (draft use only; publication needs a human decision). */
  rightsReview?: Array<{ mediaId: string; title: string; origin: string; sourceUrl: string; rightsStatus: MediaRightsStatus; note: string }>;
  /** Equivalent queries (same canonical key) not re-run, per segment. */
  equivalentQueriesSkipped?: number;
  sceneDiagnostics?: SceneMediaDiagnostic[];
  unresolvedGapsForReview: Array<{
    segmentId: string;
    subject: string;
    suggestedQuery: string;
    reason: string;
    uncoveredIntervals: MediaCoverageGap['uncoveredIntervals'];
    missingDurationSec: number;
    attempts: number;
    attemptsExhausted: boolean;
    editorialAlternatives: MediaCoverageGap['editorialAlternatives'];
  }>;
  providerStatuses: ProviderAttemptStatus[];
  segmentMetrics: SegmentAcquisitionMetrics[];
  funnelMetrics: AcquisitionFunnelMetrics;
  coverageReport: MediaCoverageReport;
  approvedAssets: AcquiredMediaAsset[];
  approvedMediaDetails: ApprovedMediaAuditDetail[];
  relevanceDecisions: MediaRelevanceDecision[];
  /**
   * One entry per media × scene that reached visual analysis: identity, literal correspondence, contextual support
   * and usage authorization as separate verdicts, with the proving intervals.
   */
  mediaApprovals: SceneMediaApproval[];
  observability?: {
    stageTimingsMs: {
      discoveryMs: number;
      acquisitionMs: number;
      verificationMs: number;
      coverageMs: number;
    };
    cacheHits: number;
    cacheMisses: number;
    triageEliminatedCount: number;
    skippedQueriesFromCheckpoint: number;
    reusedFilesFromCheckpoint: number;
    estimatedRemainingWork: {
      uncoveredSegments: number;
      partiallyCoveredSegments: number;
      missingDurationSec: number;
      estimatedRemainingMs: number;
    };
  };
  pipelineMetrics?: PipelineAcquisitionComparisonMetrics;
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

function formatYtDlpTimestamp(totalSec: number): string {
  const safe = Math.max(0, Math.floor(totalSec));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  const mm = String(mins).padStart(hrs > 0 ? 2 : 1, '0');
  const ss = String(secs).padStart(2, '0');
  return hrs > 0 ? `${hrs}:${mm}:${ss}` : `${mm}:${ss}`;
}

function parseTimestampTokenToSec(token: string): number | null {
  const parts = token.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return parts[0]! * 60 + parts[1]!;
  if (parts.length === 3) return parts[0]! * 3600 + parts[1]! * 60 + parts[2]!;
  return null;
}

/**
 * Selects the most relevant temporal window anywhere in a video using chapters, description timestamps,
 * or non-intro temporal midpoint for long videos instead of always clipping 0:00-1:30.
 */
export function selectRelevantDownloadWindow(
  cand: MediaSourceCandidate,
  segment: ScriptCoverageSegment,
): {
  startSec: number;
  endSec: number;
  sectionArg: string;
  source: 'chapter_match' | 'description_timestamp' | 'temporal_midpoint' | 'head';
} {
  const desiredSpan = Math.min(105, Math.max(60, Math.round(segment.expectedDurationSec + 15)));
  const totalDur = cand.durationSec && cand.durationSec > 0 ? Math.floor(cand.durationSec) : null;
  const segTokens = tokenize(
    `${segment.subject} ${segment.expectedEvent ?? ''} ${(segment.entities ?? []).join(' ')}`,
  ).filter((t) => t.length >= 3);

  const scoreTextMatch = (label: string): number => {
    const labelTokens = new Set(tokenize(label));
    let hits = 0;
    for (const t of segTokens) {
      if (labelTokens.has(t)) hits += 1;
    }
    return hits;
  };

  if (cand.chapters && cand.chapters.length > 0 && segTokens.length > 0) {
    let bestChapter: { startSec: number; endSec: number; hits: number } | null = null;
    for (const ch of cand.chapters) {
      const hits = scoreTextMatch(ch.title);
      if (hits > 0 && (!bestChapter || hits > bestChapter.hits)) {
        bestChapter = { startSec: ch.startSec, endSec: ch.endSec, hits };
      }
    }
    if (bestChapter) {
      const startSec = Math.max(0, Math.floor(bestChapter.startSec));
      const rawEnd = Math.min(Math.ceil(bestChapter.endSec), startSec + desiredSpan);
      const endSec = totalDur ? Math.min(totalDur, Math.max(startSec + 15, rawEnd)) : Math.max(startSec + 15, rawEnd);
      return {
        startSec,
        endSec,
        sectionArg: `*${formatYtDlpTimestamp(startSec)}-${formatYtDlpTimestamp(endSec)}`,
        source: 'chapter_match',
      };
    }
  }

  if (cand.description && segTokens.length > 0) {
    let bestLine: { startSec: number; hits: number } | null = null;
    for (const line of cand.description.split(/\r?\n/)) {
      const tsMatch = line.match(/\b(\d{1,2}:\d{2}(?::\d{2})?)\b/);
      if (!tsMatch?.[1]) continue;
      const startSec = parseTimestampTokenToSec(tsMatch[1]);
      if (startSec === null) continue;
      const hits = scoreTextMatch(line);
      if (hits > 0 && (!bestLine || hits > bestLine.hits)) {
        bestLine = { startSec, hits };
      }
    }
    if (bestLine) {
      const startSec = Math.max(0, Math.floor(bestLine.startSec));
      const endSec = totalDur ? Math.min(totalDur, startSec + desiredSpan) : startSec + desiredSpan;
      if (endSec > startSec + 10) {
        return {
          startSec,
          endSec,
          sectionArg: `*${formatYtDlpTimestamp(startSec)}-${formatYtDlpTimestamp(endSec)}`,
          source: 'description_timestamp',
        };
      }
    }
  }

  if (totalDur && totalDur > 180) {
    const startSec = Math.min(Math.max(15, Math.floor(totalDur * 0.25)), Math.max(15, totalDur - desiredSpan));
    const endSec = Math.min(totalDur, startSec + desiredSpan);
    return {
      startSec,
      endSec,
      sectionArg: `*${formatYtDlpTimestamp(startSec)}-${formatYtDlpTimestamp(endSec)}`,
      source: 'temporal_midpoint',
    };
  }

  const endSec = totalDur ? Math.min(totalDur, desiredSpan) : desiredSpan;
  return {
    startSec: 0,
    endSec,
    sectionArg: `*0:00-${formatYtDlpTimestamp(endSec)}`,
    source: 'head',
  };
}

export function scoreCandidateRelevancePriority(
  cand: MediaSourceCandidate,
  segment: ScriptCoverageSegment,
  prompt: string,
  projectDomain?: ContentDomain,
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

  // Known project domain wins; the keyword test is the fallback for legacy callers without one.
  const isGamingTopic = projectDomain
    ? projectDomain === 'game'
    : /\b(game|jogo|jogos|boss|chefe|gameplay|elden ring|dark souls|sekiro|bloodborne|rpg|playstation|xbox|nintendo|steam)\b/i.test(
        `${prompt} ${segment.subject} ${segment.narrationText}`,
      );

  let score = 0;
  for (const e of segEntities) {
    if (text.includes(e)) score += 3;
  }
  for (const e of promptEntities) {
    if (text.includes(e)) score += 1;
  }
  if (cand.origin === 'local_library') score += 3;
  if (cand.origin === 'sakugabooru' && !isGamingTopic) score += 5;
  if (isGamingTopic && (cand.origin === 'steam' || cand.origin === 'igdb')) score += 4;
  if (isGamingTopic && cand.origin === 'yt_dlp') score += 2;
  if (isGamingTopic && cand.origin === 'internet_archive') score -= 2;
  if (/\b(fighting|beams|explosions|impact_frames|lightning)\b/i.test(text)) score += 3;
  if (/\b(logo|mural|poster|banner|cover)\b/i.test(text)) score -= 4;
  if (/\b(anime|cena|scene|clip|episodio|episode|dublado|legendado|luta|fight|transforma)\b/i.test(text)) {
    score += 2;
  }
  if (isGamingTopic && /\b(gameplay|boss\s+fight|showcase|cutscene|walkthrough|no\s+commentary)\b/i.test(text)) {
    score += 3;
  }
  if (
    /\b(live[- ]action|fan film|podcast|react|reaction|unboxing)\b/i.test(text) ||
    (!isGamingTopic && /\b(gameplay|roblox|fortnite|minecraft)\b/i.test(text))
  ) {
    score -= 5;
  }
  if (cand.durationSec && cand.durationSec > 180) score -= 2;
  if (cand.durationSec && cand.durationSec > 600) score -= 4;
  if (/\b(full\s*game|full\s*playthrough|longplay|100%\s*walkthrough)\b/i.test(text)) score -= 5;
  if (/\b(official\s*trailer|trailer)\b/i.test(text)) score += 2;
  if (cand.durationSec && cand.durationSec >= 8 && cand.durationSec <= 180) score += 2;
  return score;
}

/**
 * Two-stage cheap metadata triage: eliminates clearly irrelevant or off-topic
 * candidates before download/vision. NEVER approves media on its own.
 */
export function triageCandidateMetadata(
  cand: MediaSourceCandidate,
  segment: ScriptCoverageSegment,
  prompt: string,
  projectDomain?: ContentDomain,
): { pass: boolean; score: number; reason?: string } {
  const score = scoreCandidateRelevancePriority(cand, segment, prompt, projectDomain);
  const text = `${cand.title ?? ''} ${cand.description ?? ''}`.toLowerCase();
  const segEntities =
    segment.entities && segment.entities.length > 0
      ? segment.entities.map((e) => e.toLowerCase())
      : extractTopicEntities(`${segment.subject} ${segment.narrationText}`);

  if (score <= -3) {
    return {
      pass: false,
      score,
      reason: `Triagem barata rejeitou candidato irrelevante (score=${score}).`,
    };
  }
  if (
    cand.origin !== 'local_library' &&
    segEntities.length > 0 &&
    score <= 0 &&
    /\b(reaction|react|podcast|unboxing|tier\s*list|clickbait|music\s*video)\b/i.test(text)
  ) {
    return {
      pass: false,
      score,
      reason: `Triagem barata eliminou candidato off-topic/spam sem entidade do segmento (score=${score}).`,
    };
  }
  return { pass: true, score };
}

/**
 * Prevents cross-work recycling (e.g., assigning Mario/Sonic gameplay to GTA/RDR2/Cyberpunk scenes).
 * Returns true if the candidate text clearly identifies a competing work from other segments without
 * mentioning the target segment's own primary work/entities.
 */
export function hasCrossWorkEntityConflict(
  candText: string,
  targetSegment: ScriptCoverageSegment,
  allSegments: readonly ScriptCoverageSegment[],
): boolean {
  const normalizedCand = candText.toLowerCase();
  const rawTargetParts = [targetSegment.subject, ...(targetSegment.entities ?? [])].filter(
    (s): s is string => typeof s === 'string' && s.trim().length > 0,
  );
  const targetTokens = new Set(
    [
      ...rawTargetParts,
      ...rawTargetParts.flatMap((p) => p.split(/[\s:/,-]+/)),
    ]
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length >= 5 && !/^(game|jogo|gameplay|trailer|intro|hook|cta|abertura|encerramento|climax|official|video)$/.test(s)),
  );
  if (targetTokens.size === 0) return false;

  const targetMatched = [...targetTokens].some((tok) => normalizedCand.includes(tok));
  if (targetMatched) return false;

  for (const other of allSegments) {
    if (other.segmentId === targetSegment.segmentId) continue;
    const otherTokens = [other.subject, ...(other.entities ?? [])]
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length >= 5 && !targetTokens.has(s) && !/^(game|jogo|gameplay|trailer|intro|hook|cta|abertura|encerramento|climax)$/.test(s));
    if (otherTokens.some((tok) => normalizedCand.includes(tok))) {
      return true;
    }
  }
  return false;
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
  /** Content domain resolved from the briefing (see `resolveProjectDomain`); inferred per scene when absent. */
  projectDomain?: ContentDomain;
  format?: CoverageFormat;
  segments: ScriptCoverageSegment[];
  mediaDir: string;
  deps: ResilientAcquisitionDeps;
  probeDurationFn?: (filePath: string) => Promise<number>;
  analyzeFrames?: (
    uri: string,
    timestampsSec: number[],
    segment: ScriptSegmentExpectation,
  ) => Promise<DistributedFrameAnalysis[] | DistributedFrameAnalysisResult>;
  /** Optional Level 1 pre-download batch analyzer for remotely sampled JPEG frames. */
  analyzeRemoteFramesFn?: (
    framePaths: string[],
    timestampsSec: number[],
    segment: ScriptSegmentExpectation,
  ) => Promise<DistributedFrameAnalysis[] | DistributedFrameAnalysisResult>;
  remoteSamplingCache?: RemoteSamplingCache;
  requireVisualVerification?: boolean;
  visionModelVersion?: string;
  evolution?: AetheraEvolutionCore;
  stageMode?: AcquisitionStageMode;
  limits?: {
    maxRounds?: number;
    maxDurationMs?: number;
    budgetMultiplier?: number;
    perOperationTimeoutMs?: number;
    /**
     * Timeout for ONE media download. Section downloads through yt-dlp re-encode with ffmpeg and routinely take
     * 40–120s; capping them at the 35s search timeout aborted 12 of 13 downloads in production.
     */
    perDownloadTimeoutMs?: number;
    maxQueriesTotal?: number;
    maxCandidateDurationSec?: number;
    maxRecoveryAttemptsPerGap?: number;
    discoveryConcurrency?: number;
    acquisitionConcurrency?: number;
    verificationConcurrency?: number;
    discoveryBudgetRatio?: number;
    acquisitionBudgetRatio?: number;
    roundReserveRatio?: number;
  };
  checkpointPath?: string | false;
  signal?: AbortSignal;
  licensePolicy?: LicenseReviewPolicy;
}): Promise<AutonomousAcquisitionAuditReport> {
  const startedAt = Date.now();
  const stageMode: AcquisitionStageMode = input.stageMode ?? 'full';
  const maxRounds = Math.max(1, input.limits?.maxRounds ?? 3);
  const baseMaxDurationMs = Math.max(
    1_000,
    input.limits?.maxDurationMs ?? Math.max(240_000, Math.min(1_500_000, input.segments.length * 90_000)),
  );
  const budgetMultiplier = Math.max(0.25, input.limits?.budgetMultiplier ?? 1);
  const maxDurationMs = Math.round(baseMaxDurationMs * budgetMultiplier);
  const perOperationTimeoutMs = Math.max(1_000, input.limits?.perOperationTimeoutMs ?? 35_000);
  const perDownloadLimitMs = Math.max(perOperationTimeoutMs, input.limits?.perDownloadTimeoutMs ?? 150_000);
  const licensePolicy: LicenseReviewPolicy = input.licensePolicy ?? 'block_pending';
  const maxQueriesTotal = Math.max(input.segments.length, input.limits?.maxQueriesTotal ?? Math.max(36, input.segments.length * 4));
  const maxCandidateDurationSec = input.limits?.maxCandidateDurationSec ?? 600;
  const maxSectionedCandidateDurationSec =
    input.limits?.maxCandidateDurationSec ?? (input.deps.ytDlpAcquireFn ? 900 : maxCandidateDurationSec);
  const discoveryConcurrency = Math.max(1, input.limits?.discoveryConcurrency ?? 3);
  const acquisitionConcurrency = Math.max(1, input.limits?.acquisitionConcurrency ?? 2);
  // VisionRouter serializes all calls on visionGpuScheduler (FIFO lease), and its per-provider timer starts
  // when route() is entered (including queue wait). Defaulting verificationConcurrency to 1 prevents queued items
  // from exhausting their maxLatencyMs while waiting for the active vision call to finish.
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
  const createScopedSignal = (timeoutMs: number, capMs = perOperationTimeoutMs): AbortSignal => {
    const rem = Math.max(250, Math.min(capMs, timeoutMs, remainingMs()));
    const signals: AbortSignal[] = [deadlineController.signal, AbortSignal.timeout(rem)];
    if (input.signal) signals.push(input.signal);
    return AbortSignal.any(signals);
  };

  const queriesExecuted: AutonomousAcquisitionAuditReport['queriesExecuted'] = [];
  const candidatesByProvider: Record<string, number> = {};
  const seenCandidateKeys = new Set<string>();
  const seenFileHashes = new Set<string>();
  const remoteSamplingCache = input.remoteSamplingCache ?? new RemoteSamplingCache();
  let preDownloadCheckedCount = 0;
  let preDownloadRejectedCount = 0;
  let preDownloadPassedCount = 0;
  let preDownloadFallbackCount = 0;
  let postDownloadRejectedAfterPrePass = 0;
  let remoteSampleBytes = 0;
  let downloadedVideoBytes = 0;
  let remoteSampleRequests = 0;
  let remoteSampleLatencyMs = 0;
  const preDownloadPassedKeys = new Set<string>();
  const downloadedTempPaths = new Set<string>();
  const rejectedCandidates: AutonomousAcquisitionAuditReport['rejectedCandidates'] = [];
  const rejectedSegmentByMediaId = new Map<string, string>();
  const rejectedUrlByMediaId = new Map<string, string>();
  const noteRejected = (mediaId: string, segmentId: string, url: string) => {
    rejectedSegmentByMediaId.set(mediaId, segmentId);
    rejectedUrlByMediaId.set(mediaId, url);
  };
  const relevanceDecisions: MediaRelevanceDecision[] = [];
  const mediaApprovals: SceneMediaApproval[] = [];
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
      providerItem?: ProviderMediaItem;
      licenseDecision?: LicenseDecision;
    }
  >();
  const allStatuses: ProviderAttemptStatus[] = [];
  const contextualCandidates: Array<{
    mediaId: string;
    segmentId: string;
    title: string;
    origin: string;
    sourceUrl: string;
    status: 'contextual' | 'visually_verified';
    reason: string;
  }> = [];
  const verifiedContextualFallbacksBySegment = new Map<
    string,
    Array<{
      item: {
        mediaId: string;
        filePath: string;
        fileSizeBytes: number;
        sha256: string;
        durationSec: number;
        segment: ScriptCoverageSegment;
        cand: MediaSourceCandidate;
      };
      candKey: string;
      decision: MediaRelevanceDecision;
      recoveryAttemptForAsset?: AutonomousAcquisitionAuditReport['recoveryAttempts'][number];
    }>
  >();
  const approvedSegmentByMediaId = new Map<string, string>();
  /** Local file of every downloaded candidate (for diagnostics thumbnails/inspection). */
  const localPathByMediaId = new Map<string, string>();
  const autoResolvedGaps: AutonomousAcquisitionAuditReport['autoResolvedGaps'] = [];
  const recoveryAttempts: AutonomousAcquisitionAuditReport['recoveryAttempts'] = [];
  const recoveryAttemptIdByQueryKey = new Map<string, string>();
  const recoveryAttemptIdByCandidateKey = new Map<string, string>();
  const recoveryAttemptIdByCandidateAndSegment = new Map<string, string>();
  const pendingLicenseReview: PendingLicenseReviewEntry[] = [];

  let candidatesFoundCount = 0;
  let acquiredFilesCount = 0;
  let duplicateFilesSkipped = 0;
  let ytDlpBlocked = false;
  let uncoveredAfterRound1 = new Set<string>();
  let stoppedReason: AutonomousAcquisitionAuditReport['stoppedReason'] = 'max_rounds';
  let resumedFromCheckpoint = false;
  const completedQueryKeys = new Set<string>();
  /** Canonical keys of every query already run (any segment): equivalent queries are never re-run. */
  const globalQueryKeys = new Set<string>();
  const candKeysByQueryKey = new Map<string, string[]>();
  const sharedQueryKeysBySegment = new Map<string, Set<string>>();
  let equivalentQueriesSkipped = 0;
  const candidateStates = new Map<string, CandidateLifecycleState>();
  const discoveredPool = new Map<
    string,
    { segmentId: string; cand: MediaSourceCandidate; priorityScore: number }
  >();
  interface PendingVerificationAsset {
    candidateKey: string;
    segmentId: string;
    segment: ScriptCoverageSegment;
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
    records: [],
  };
  const visionCache = new Map<string, MediaRelevanceDecision>();
  const stageTimingsMs = {
    discoveryMs: 0,
    acquisitionMs: 0,
    verificationMs: 0,
    coverageMs: 0,
  };
  let cacheHits = 0;
  let cacheMisses = 0;
  let triageEliminatedCount = 0;
  let skippedQueriesFromCheckpoint = 0;
  let reusedFilesFromCheckpoint = 0;

  const segMetricsMap = new Map<string, SegmentAcquisitionMetrics>();
  for (const s of input.segments) {
    segMetricsMap.set(s.segmentId, {
      segmentId: s.segmentId,
      subject: s.subject,
      queriesExecuted: 0,
      candidatesFound: 0,
      sharedQueries: 0,
      sharedCandidates: 0,
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
  const candidateSegmentKey = (segmentId: string, candidateKey: string) => `${segmentId}::${candidateKey}`;
  const hasPendingForCandidate = (candidateKey: string) => [...pendingVerificationAssets.values()].some((asset) => asset.candidateKey === candidateKey);
  const setCandidateVerificationState = (candidateKey: string, terminalState: CandidateLifecycleState) => {
    candidateStates.set(candidateKey, hasPendingForCandidate(candidateKey) ? 'pending_visual_verification' : terminalState);
  };
  const upsertVisionVerificationRecord = (record: VisionVerificationRecord) => {
    const existing = visionDiagnostics.records.find(
      (item) => item.mediaId === record.mediaId && item.segmentId === record.segmentId,
    );
    if (!existing) {
      visionDiagnostics.records.push({ ...record, attempts: [...record.attempts] });
      return;
    }
    existing.status = record.status;
    if (record.provider !== undefined) existing.provider = record.provider;
    if (record.model !== undefined) existing.model = record.model;
    if (record.reportedModel !== undefined) existing.reportedModel = record.reportedModel;
    if (record.durationMs !== undefined) existing.durationMs = (existing.durationMs ?? 0) + record.durationMs;
    existing.attempts = [...existing.attempts, ...record.attempts];
    if (record.error) existing.error = record.error;
    if (record.editorialDisposition) existing.editorialDisposition = record.editorialDisposition;
  };
  const mergeApprovedDecision = (previous: MediaRelevanceDecision, next: MediaRelevanceDecision): MediaRelevanceDecision => {
    const correspondenceLevel = previous.correspondenceLevel === 'exact_match' || next.correspondenceLevel === 'exact_match'
      ? 'exact_match' as const
      : next.correspondenceLevel ?? previous.correspondenceLevel;
    const relevanceTier = previous.relevanceTier === 'exact_segment_match' || next.relevanceTier === 'exact_segment_match'
      ? 'exact_segment_match' as const
      : next.relevanceTier ?? previous.relevanceTier;
    return {
      ...previous,
      ...next,
      accepted: previous.accepted || next.accepted,
      assemblyEligible: previous.assemblyEligible === true || next.assemblyEligible === true,
      eligibleSegmentIds: [...new Set([...(previous.eligibleSegmentIds ?? []), ...(next.eligibleSegmentIds ?? [])])],
      matchedIntervals: [...(previous.matchedIntervals ?? []), ...(next.matchedIntervals ?? [])],
      visualEvidence: [...(previous.visualEvidence ?? []), ...(next.visualEvidence ?? [])],
      matchedEntities: [...new Set([...previous.matchedEntities, ...next.matchedEntities])],
      matchedActions: [...new Set([...(previous.matchedActions ?? []), ...(next.matchedActions ?? [])])],
      ...(correspondenceLevel ? { correspondenceLevel } : {}),
      ...(relevanceTier ? { relevanceTier } : {}),
    };
  };
  const recordVisualCallback = (mediaId: string, segmentId: string) => (diagnostics: VisionVerificationDiagnostics) => {
    upsertVisionVerificationRecord({ mediaId, segmentId, ...diagnostics, attempts: [...diagnostics.attempts] });
    if (diagnostics.status === 'partial') {
      visionDiagnostics.callsAttempted += 1;
      visionDiagnostics.callsFailed += 1;
      if (diagnostics.error) visionDiagnostics.providerErrors.push(diagnostics.error.slice(0, 900));
    }
  };
  if (checkpointFile && existsSync(checkpointFile)) {
    try {
      const saved = JSON.parse(readFileSync(checkpointFile, 'utf8')) as {
        projectId?: string;
        policyVersion?: string;
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
        mediaApprovals?: SceneMediaApproval[];
        recoveryAttempts?: AutonomousAcquisitionAuditReport['recoveryAttempts'];
        recoveryAttemptAssignments?: Array<[string, string]>;
        segmentMetrics?: SegmentAcquisitionMetrics[];
        visionCacheEntries?: Array<[string, MediaRelevanceDecision]>;
        visionDiagnostics?: AcquisitionFunnelMetrics['visionDiagnostics'];
        stageTimingsMs?: {
          discoveryMs?: number;
          acquisitionMs?: number;
          verificationMs?: number;
          coverageMs?: number;
        };
      };
      if (saved.projectId === input.projectId) {
        const checkpointPolicyMatches = saved.policyVersion === SCENE_GROUNDING_POLICY_VERSION;
        resumedFromCheckpoint = checkpointPolicyMatches;
        if (!checkpointPolicyMatches) {
          // Physical downloads stay untouched; stale editorial decisions are intentionally not restored.
        }
        if (checkpointPolicyMatches) {
        for (const k of saved.completedQueryKeys ?? []) completedQueryKeys.add(k);
        for (const k of saved.seenCandidateKeys ?? []) seenCandidateKeys.add(k);
        for (const h of saved.seenFileHashes ?? []) seenFileHashes.add(h);
        for (const [k, st] of saved.candidateStateEntries ?? []) candidateStates.set(k, st);
        for (const [k, d] of saved.discoveredPoolEntries ?? []) discoveredPool.set(k, d);
        for (const [k, p] of saved.pendingVerificationEntries ?? []) {
          const candidateKey = p.candidateKey ?? (k.includes('::') ? k.slice(k.indexOf('::') + 2) : k);
          const pendingKey = candidateSegmentKey(p.segmentId, candidateKey);
          pendingVerificationAssets.set(pendingKey, { ...p, candidateKey });
        }
        if (saved.failedDownloads) failedDownloads.push(...saved.failedDownloads);
        if (saved.queriesExecuted) {
          queriesExecuted.push(...saved.queriesExecuted);
          for (const q of saved.queriesExecuted) globalQueryKeys.add(canonicalQueryKey(q.query));
        }
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
        if (saved.mediaApprovals) mediaApprovals.push(...saved.mediaApprovals);
        if (saved.recoveryAttempts) {
          recoveryAttempts.push(...saved.recoveryAttempts);
          for (const attempt of saved.recoveryAttempts) {
            if (!attempt.sharedFromAttemptId) recoveryAttemptIdByQueryKey.set(canonicalQueryKey(attempt.query), attempt.attemptId);
          }
        }
        for (const [key, attemptId] of saved.recoveryAttemptAssignments ?? []) {
          recoveryAttemptIdByCandidateAndSegment.set(key, attemptId);
        }
        for (const sm of saved.segmentMetrics ?? []) {
          segMetricsMap.set(sm.segmentId, { sharedQueries: 0, sharedCandidates: 0, ...sm });
        }
        for (const [k, dec] of saved.visionCacheEntries ?? []) {
          visionCache.set(k, dec);
        }
        if (saved.stageTimingsMs) {
          stageTimingsMs.discoveryMs += saved.stageTimingsMs.discoveryMs ?? 0;
          stageTimingsMs.acquisitionMs += saved.stageTimingsMs.acquisitionMs ?? 0;
          stageTimingsMs.verificationMs += saved.stageTimingsMs.verificationMs ?? 0;
          stageTimingsMs.coverageMs += saved.stageTimingsMs.coverageMs ?? 0;
        }
        if (saved.visionDiagnostics) {
          visionDiagnostics.callsAttempted = saved.visionDiagnostics.callsAttempted ?? 0;
          visionDiagnostics.callsSucceeded = saved.visionDiagnostics.callsSucceeded ?? 0;
          visionDiagnostics.callsFailed = saved.visionDiagnostics.callsFailed ?? 0;
          visionDiagnostics.providerErrors.push(...(saved.visionDiagnostics.providerErrors ?? []));
          visionDiagnostics.records.push(...(saved.visionDiagnostics.records ?? []));
        }
        }
        reusedFilesFromCheckpoint = approvedAssets.filter((asset) => existsSync(asset.uri)).length +
          [...pendingVerificationAssets.values()].filter((asset) => existsSync(asset.filePath)).length;
      }
    } catch {
      // ignore corrupted checkpoint
    }
  }

  const checkpointFunnel = () => {
    const counts: Record<CandidateLifecycleState, number> = { discovered: 0, downloading: 0, downloaded: 0, pending_visual_verification: 0, contextual: 0, verified: 0, rejected: 0, failed: 0 };
    for (const state of candidateStates.values()) counts[state] = (counts[state] ?? 0) + 1;
    const failureReasons: Record<DownloadFailureReasonCode, number> = { timeout: 0, anti_bot: 0, http_error: 0, format_unavailable: 0, invalid_file: 0, cancelled: 0, other: 0 };
    for (const failure of failedDownloads) failureReasons[failure.reasonCode] = (failureReasons[failure.reasonCode] ?? 0) + 1;
    const rejectionReasons: Record<string, number> = {};
    for (const rejection of rejectedCandidates) { const code = rejection.rejectionCode ?? 'other'; rejectionReasons[code] = (rejectionReasons[code] ?? 0) + 1; }
    const attempted = [...segMetricsMap.values()].reduce((sum, metric) => sum + metric.downloadsAttempted, 0);
    const rate = (num: number, den: number) => den > 0 ? Number((num / den).toFixed(3)) : 0;
    return {
      counts,
      conversionRates: {
        discoveryToDownloadAttemptRate: rate(attempted, candidatesFoundCount),
        downloadAttemptToDownloadedRate: rate(acquiredFilesCount, attempted),
        downloadedToVerifiedRate: rate(approvedAssets.length, acquiredFilesCount),
        discoveredToVerifiedRate: rate(approvedAssets.length, candidatesFoundCount),
      },
      failureReasons,
      rejectionReasons,
      failedDownloads,
      pendingVerificationCount: pendingVerificationAssets.size,
      mediaUnavailableCount: visionDiagnostics.records.filter((record) => record.status === 'media_unavailable').length,
      visionDiagnostics: { ...visionDiagnostics, records: visionDiagnostics.records.map((record) => ({ ...record, attempts: [...record.attempts] })) },
    };
  };

  const saveCheckpoint = () => {
    if (!checkpointFile) return;
    try {
      mkdirSync(input.mediaDir, { recursive: true });
      const tmpFile = `${checkpointFile}.tmp`;
      writeFileSync(
        tmpFile,
        JSON.stringify(
          {
            projectId: input.projectId,
            policyVersion: SCENE_GROUNDING_POLICY_VERSION,
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
            mediaApprovals,
            recoveryAttempts,
            recoveryAttemptAssignments: [...recoveryAttemptIdByCandidateAndSegment.entries()],
            segmentMetrics: [...segMetricsMap.values()],
            visionCacheEntries: [...visionCache.entries()],
            visionDiagnostics,
            funnelMetrics: checkpointFunnel(),
            stageTimingsMs,
          },
          null,
          2,
        ),
        'utf8',
      );
      renameSync(tmpFile, checkpointFile);
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

  const findRecoveryAttempt = (candidateKey: string, segmentId?: string): AutonomousAcquisitionAuditReport['recoveryAttempts'][number] | undefined => {
    const attemptId = segmentId
      ? recoveryAttemptIdByCandidateAndSegment.get(candidateSegmentKey(segmentId, candidateKey)) ?? recoveryAttemptIdByCandidateKey.get(candidateKey)
      : recoveryAttemptIdByCandidateKey.get(candidateKey);
    return attemptId ? recoveryAttempts.find((attempt) => attempt.attemptId === attemptId) : undefined;
  };

  const noteRecoveryFailure = (
    candidateKey: string,
    reason: string,
    outcome: AutonomousAcquisitionAuditReport['recoveryAttempts'][number]['outcome'] = 'download_failed',
    segmentId?: string,
  ) => {
    const attempt = findRecoveryAttempt(candidateKey, segmentId);
    if (!attempt) return;
    if (!attempt.rejectionReasons.includes(reason)) attempt.rejectionReasons.push(reason);
    if (attempt.outcome !== 'verified_interval' && attempt.outcome !== 'contextual_only') attempt.outcome = outcome;
  };

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
      const covBySegId = new Map(latestCoverage.segments.map((c) => [c.segmentId, c]));
      const coveredSegIds = new Set(latestCoverage.segments.filter((c) => c.covered).map((c) => c.segmentId));
      const recoveryPlan = buildMediaRecoveryPlan({
        prompt: input.prompt,
        segments: input.segments,
        coverageReport: latestCoverage,
        ...(input.genre ? { genre: input.genre } : {}),
        maxAttemptsPerGap: input.limits?.maxRecoveryAttemptsPerGap ?? 4,
      });
      const targetSegments = input.segments
        .filter((s) => !coveredSegIds.has(s.segmentId))
        .sort((a, b) => {
          const covA = covBySegId.get(a.segmentId)?.usableDurationSec ?? 0;
          const covB = covBySegId.get(b.segmentId)?.usableDurationSec ?? 0;
          if ((covA === 0) !== (covB === 0)) return covA === 0 ? -1 : 1;
          const gapA = (covBySegId.get(a.segmentId)?.expectedDurationSec ?? a.expectedDurationSec) - covA;
          const gapB = (covBySegId.get(b.segmentId)?.expectedDurationSec ?? b.expectedDurationSec) - covB;
          return gapB - gapA;
        });

      if (targetSegments.length === 0) {
        stoppedReason = 'coverage_satisfied';
        break;
      }

      // Query strategy per segment: an ordered ladder (specific contextual queries first, broader expansions after).
      // Each round takes the next rungs not yet run — by canonical key, across ALL segments — so a round never
      // repeats an equivalent query that already ran (or failed), and scenes about the same work share results.
      const perSegmentThisRound = round === 1 ? (targetSegments.length > 6 ? 1 : 2) : 2;
      const rawRoundQueries: Array<{ segment: ScriptCoverageSegment; query: string }> = [];
      const sharedFromEquivalent: Array<{ segment: ScriptCoverageSegment; queryKey: string }> = [];
      const plannedThisRound = new Set<string>();
      for (const s of targetSegments) {
        const gapQueries = recoveryPlan.queries
          .filter((query) => query.segmentId === s.segmentId)
          .map((query) => query.query);
        const firstPassQueries = s.preferredQueries?.length
          ? s.preferredQueries
          : [`${s.subject} ${s.entities?.slice(0, 2).join(' ') ?? ''}`.trim() || input.prompt];
        const ladder = [
          ...(round === 1 ? firstPassQueries : gapQueries),
          ...(round > 1 && gapQueries.length === 0
            ? expandScriptOrientedQueries({
              prompt: input.prompt,
              segments: [s],
              ...(input.genre ? { genre: input.genre } : {}),
              uncoveredSegmentIds: [s.segmentId],
              maxQueries: 6,
            })
            : []),
        ];
        if (ladder.length === 0) {
          ladder.push(`${s.subject} ${s.entities?.slice(0, 2).join(' ') ?? ''}`.trim() || input.prompt);
        }
        let taken = 0;
        for (const q of ladder) {
          if (taken >= perSegmentThisRound) break;
          const key = canonicalQueryKey(q);
          if (!key) continue;
          if (completedQueryKeys.has(`${s.segmentId}:${q.toLowerCase()}`)) {
            skippedQueriesFromCheckpoint += 1;
            continue;
          }
          if (globalQueryKeys.has(key) || plannedThisRound.has(key)) {
            // Same search already ran for another scene (or this one): reuse its candidates instead of re-querying.
            if (!sharedQueryKeysBySegment.get(s.segmentId)?.has(key)) {
              equivalentQueriesSkipped += 1;
              sharedFromEquivalent.push({ segment: s, queryKey: key });
              const set = sharedQueryKeysBySegment.get(s.segmentId) ?? new Set<string>();
              set.add(key);
              sharedQueryKeysBySegment.set(s.segmentId, set);
            }
            continue;
          }
          plannedThisRound.add(key);
          rawRoundQueries.push({ segment: s, query: q });
          taken += 1;
        }
      }

      const segmentById = new Map(input.segments.map((s) => [s.segmentId, s]));
      const uncompletedQueries = rawRoundQueries;
      const roundQueries =
        stageMode === 'verify_pending_only'
          ? []
          : uncompletedQueries.slice(0, Math.max(0, maxQueriesTotal - queriesExecuted.length));

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
          const itemQueryKey = canonicalQueryKey(item.query);
          globalQueryKeys.add(itemQueryKey);
          const keysForQuery = candKeysByQueryKey.get(itemQueryKey) ?? [];
          candKeysByQueryKey.set(itemQueryKey, keysForQuery);
          const plannedRecoveryQuery = recoveryPlan.queries.find(
            (query) => query.segmentId === item.segment.segmentId && canonicalQueryKey(query.query) === itemQueryKey,
          );
          let recoveryAttempt = recoveryAttempts.find(
            (attempt) => attempt.attemptId === recoveryAttemptIdByQueryKey.get(itemQueryKey),
          );
          if (!recoveryAttempt) {
            const attemptId = `recovery_${round}_${recoveryAttempts.length + 1}`;
            recoveryAttempt = {
              attemptId,
              round,
              segmentId: item.segment.segmentId,
              gapIndex: plannedRecoveryQuery?.gapIndex ?? 0,
              query: item.query,
              strategy: plannedRecoveryQuery?.strategy ?? (round === 1 ? 'preferred' : 'alternative_source'),
              sourceStatuses: [],
              candidatesFound: 0,
              acquiredMediaIds: [],
              approvedMediaIds: [],
              rejectedMediaIds: [],
              rejectionReasons: [],
              outcome: 'exhausted',
            };
            recoveryAttempts.push(recoveryAttempt);
            recoveryAttemptIdByQueryKey.set(itemQueryKey, attemptId);
          }

          try {
            const searchRes = await searchResilientMediaSources(
              item.query,
              effectiveDeps(),
              createScopedSignal(perQueryTimeoutMs),
              {
                ...(input.genre ? { genre: input.genre } : {}),
                prompt: input.prompt,
                scene: {
                  sceneId: item.segment.segmentId,
                  narrationText: item.segment.narrationText,
                  ...(item.segment.entities ? { entities: item.segment.entities } : {}),
                  ...(item.segment.work ? { work: item.segment.work } : {}),
                  ...(input.projectDomain ? { projectDomain: input.projectDomain } : {}),
                },
              },
            );
            allStatuses.push(...searchRes.providerStatuses);
            recoveryAttempt.sourceStatuses = searchRes.providerStatuses.map((status) => ({ ...status }));
            recoveryAttempt.candidatesFound = searchRes.candidates.length;
            recoveryAttempt.outcome = searchRes.candidates.length > 0 ? 'exhausted' : 'no_results';
            if (searchRes.providerStatuses.some((s) => s.provider === 'yt_dlp' && s.status === 'blocked_auth_or_antibot')) {
              ytDlpBlocked = true;
            }

            for (const cand of searchRes.candidates) {
              candidatesByProvider[cand.origin] = (candidatesByProvider[cand.origin] ?? 0) + 1;
              const candKey = `${cand.origin}:${cand.url}`;
              recoveryAttemptIdByCandidateKey.set(candKey, recoveryAttempt.attemptId);
              recoveryAttemptIdByCandidateAndSegment.set(candidateSegmentKey(item.segment.segmentId, candKey), recoveryAttempt.attemptId);
              if (!keysForQuery.includes(candKey)) keysForQuery.push(candKey);
              if (seenCandidateKeys.has(candKey)) continue;
              seenCandidateKeys.add(candKey);
              candidatesFoundCount += 1;
              sm.candidatesFound += 1;

              const effectiveMaxDurationSec =
                (cand.origin === 'yt_dlp' && input.deps.ytDlpAcquireFn) ||
                (cand.providerItem && (cand.acquisitionMethod === 'yt_dlp' || cand.acquisitionMethod === 'hls'))
                  ? maxSectionedCandidateDurationSec
                  : maxCandidateDurationSec;
              if (cand.durationSec && cand.durationSec > effectiveMaxDurationSec) {
                candidateStates.set(candKey, 'rejected');
                sm.rejectedCount += 1;
                noteRejected(`cand_${candidatesFoundCount}`, item.segment.segmentId, cand.url);
                rejectedCandidates.push({
                  mediaId: `cand_${candidatesFoundCount}`,
                  title: cand.title ?? cand.url,
                  origin: cand.origin,
                  rejectionCode: 'duration_limit_exceeded',
                  reason: `Candidato excede limite de duração (${Math.round(cand.durationSec)}s > ${effectiveMaxDurationSec}s), evitando download longo bloqueante.`,
                });
                noteRecoveryFailure(candKey, 'duration_limit_exceeded', 'rejected', item.segment.segmentId);
                continue;
              }

              const triage = triageCandidateMetadata(cand, item.segment, input.prompt, input.projectDomain);
              if (!triage.pass) {
                triageEliminatedCount += 1;
                candidateStates.set(candKey, 'rejected');
                sm.rejectedCount += 1;
                noteRejected(`cand_${candidatesFoundCount}`, item.segment.segmentId, cand.url);
                rejectedCandidates.push({
                  mediaId: `cand_${candidatesFoundCount}`,
                  title: cand.title ?? cand.url,
                  origin: cand.origin,
                  rejectionCode: 'triage_irrelevant_metadata',
                  reason: triage.reason ?? 'Eliminado na triagem de metadados.',
                });
                noteRecoveryFailure(candKey, triage.reason ?? 'triage_irrelevant_metadata', 'rejected', item.segment.segmentId);
                continue;
              }
              const priorityScore = triage.score;
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
      // Scenes whose query was equivalent to another scene's share that query's still-undownloaded candidates.
      for (const shared of sharedFromEquivalent) {
        const sourceAttemptId = recoveryAttemptIdByQueryKey.get(shared.queryKey);
        const sourceAttempt = sourceAttemptId
          ? recoveryAttempts.find((attempt) => attempt.attemptId === sourceAttemptId)
          : undefined;
        const sharedAttemptId = sourceAttempt ? `${sourceAttempt.attemptId}:shared:${shared.segment.segmentId}` : undefined;
        if (sourceAttempt && sharedAttemptId && !recoveryAttempts.some((attempt) => attempt.attemptId === sharedAttemptId)) {
          recoveryAttempts.push({
            ...sourceAttempt,
            attemptId: sharedAttemptId,
            segmentId: shared.segment.segmentId,
            acquiredMediaIds: [],
            approvedMediaIds: [],
            rejectedMediaIds: [],
            rejectionReasons: [],
            sharedFromAttemptId: sourceAttempt.attemptId,
          });
        }
        const sharedMetrics = segMetricsMap.get(shared.segment.segmentId)!;
        sharedMetrics.sharedQueries = (sharedMetrics.sharedQueries ?? 0) + 1;
        for (const candKey of candKeysByQueryKey.get(shared.queryKey) ?? []) {
          const entry = discoveredPool.get(candKey);
          if (!entry || candidateStates.get(candKey) !== 'discovered') continue;
          const list = discoveredBySegment.get(shared.segment.segmentId) ?? [];
          if (list.some((x) => `${x.cand.origin}:${x.cand.url}` === candKey)) continue;
          list.push({ segment: shared.segment, cand: entry.cand, priorityScore: entry.priorityScore * 0.9 });
          sharedMetrics.candidatesFound += 1;
          sharedMetrics.sharedCandidates = (sharedMetrics.sharedCandidates ?? 0) + 1;
          if (sharedAttemptId) recoveryAttemptIdByCandidateAndSegment.set(candidateSegmentKey(shared.segment.segmentId, candKey), sharedAttemptId);
          discoveredBySegment.set(shared.segment.segmentId, list);
        }
      }
      stageTimingsMs.discoveryMs += Date.now() - discoveryStartedAt;
      saveCheckpoint();

      if (stageMode === 'discover_only') {
        continue;
      }

      // STAGE 2: Prioritized Breadth-First Acquisition Queue (round-robin top candidates across segments)
      const acqStageStartedAt = Date.now();
      if (stageMode !== 'verify_pending_only') {
        for (const list of discoveredBySegment.values()) {
          list.sort((a, b) => b.priorityScore - a.priorityScore);
        }
        const prioritizedSegments = [...targetSegments].sort((a, b) => {
          const ua = segMetricsMap.get(a.segmentId)?.usableDurationSec ?? 0;
          const ub = segMetricsMap.get(b.segmentId)?.usableDurationSec ?? 0;
          if ((ua === 0) !== (ub === 0)) return ua === 0 ? -1 : 1;
          return ua / Math.max(1, a.expectedDurationSec) - ub / Math.max(1, b.expectedDurationSec);
        });
        const acquisitionQueue: Array<{ segment: ScriptCoverageSegment; cand: MediaSourceCandidate; candKey: string }> = [];
        const maxPerSegThisRound = round === 1 ? (prioritizedSegments.length > 6 ? 1 : 2) : 2;
        const queuedCandKeys = new Set<string>();
        for (let rank = 0; rank < maxPerSegThisRound; rank += 1) {
          for (const s of prioritizedSegments) {
            const list = discoveredBySegment.get(s.segmentId) ?? [];
            // Next candidate of this segment not already queued by another segment sharing the same results.
            const entry = list.find((e, i) => i >= rank && !queuedCandKeys.has(`${e.cand.origin}:${e.cand.url}`));
            if (entry) {
              const candKey = `${entry.cand.origin}:${entry.cand.url}`;
              queuedCandKeys.add(candKey);
              acquisitionQueue.push({ segment: entry.segment, cand: entry.cand, candKey });
            }
          }
        }
        // In round >= 2, queue up to 2 distinct static images per uncovered/partial scene so long scenes fill cleanly
        if (round >= 2) {
          for (const s of prioritizedSegments) {
            const list = discoveredBySegment.get(s.segmentId) ?? [];
            const imgEntries = list
              .filter(
                (e) =>
                  /\.(jpe?g|png|webp)(\?|$)/i.test(e.cand.url) &&
                  !queuedCandKeys.has(`${e.cand.origin}:${e.cand.url}`) &&
                  candidateStates.get(`${e.cand.origin}:${e.cand.url}`) === 'discovered',
              )
              .slice(0, 2);
            for (const imgEntry of imgEntries) {
              const candKey = `${imgEntry.cand.origin}:${imgEntry.cand.url}`;
              queuedCandKeys.add(candKey);
              acquisitionQueue.unshift({ segment: imgEntry.segment, cand: imgEntry.cand, candKey });
            }
          }
        }

        const acqStartedAt = Date.now();
        let downloadAttemptSeq = acquiredFilesCount;
        const perDownloadTimeoutMs = Math.min(
          perDownloadLimitMs,
          Math.max(
            Math.min(perDownloadLimitMs, 120_000),
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
          const candTimeoutMs =
            cand.acquisitionMethod === 'hls'
              ? Math.min(perDownloadTimeoutMs, 45_000)
              : perDownloadTimeoutMs;
          const opSig = createScopedSignal(candTimeoutMs, perDownloadLimitMs);
          // A download aborted by its own timeout or the stage deadline is a timeout, not a user cancellation.
          const classifyOpFailure = (err: unknown) => {
            const base = classifyDownloadFailure(err);
            if (base.reasonCode === 'cancelled' && opSig.aborted && !input.signal?.aborted) {
              return {
                reasonCode: 'timeout' as const,
                detail: `${deadlineController.signal.aborted ? 'Prazo total da aquisição esgotado' : `Download excedeu ${Math.round(perDownloadTimeoutMs / 1000)}s`} (${base.detail})`,
              };
            }
            return base;
          };
          let filePath: string | null = null;
          let downloadFailure: { reasonCode: DownloadFailureReasonCode; detail: string } | null = null;
          try {
            // Level 1 (Pre-Download): remote stream resolution (`yt-dlp -g`) + adaptive FFmpeg frame sampling
            const isStaticCand = /\.(jpe?g|png|webp)(\?|$)/i.test(cand.url);
            if (
              !cand.localPath &&
              !isStaticCand &&
              cand.origin === 'yt_dlp' &&
              input.deps.resolveStreamUrlFn &&
              input.analyzeRemoteFramesFn
            ) {
              const win = selectRelevantDownloadWindow(cand, task.segment);
              const intervalKey = win.sectionArg ?? '0-35';
              const cachedPre = remoteSamplingCache.get(cand.url, intervalKey, cand.title);
              if (cachedPre?.preDownloadVerdict === 'rejected_pre_download') {
                preDownloadCheckedCount += 1;
                preDownloadRejectedCount += 1;
                candidateStates.set(candKey, 'rejected');
                rejectedCandidates.push({
                  mediaId: `pre_${acqSeq + 1}`,
                  title: cand.title ?? cand.url,
                  origin: cand.origin,
                  rejectionCode: 'rejected_pre_download_cached',
                  reason: cachedPre.reasons?.[0] ?? 'Rejeitado em pré-verificação remota (cache).',
                });
                return;
              }
              if (!cachedPre || cachedPre.preDownloadVerdict !== 'passed_pre_download') {
                preDownloadCheckedCount += 1;
                const streamRes = cachedPre?.streamUrl
                  ? { streamUrl: cachedPre.streamUrl, ageGated: false, latencyMs: 0 }
                  : await input.deps.resolveStreamUrlFn(cand.url, opSig);
                if (streamRes.ageGated) {
                  preDownloadRejectedCount += 1;
                  candidateStates.set(candKey, 'failed');
                  failedDownloads.push({
                    segmentId: task.segment.segmentId,
                    url: cand.url,
                    title: cand.title ?? cand.url,
                    origin: cand.origin,
                    reasonCode: 'anti_bot',
                    detail: 'Age-gate 18+ detectado em pré-verificação (sem bypass).',
                  });
                  remoteSamplingCache.set({
                    mediaIdentifier: cand.url,
                    intervalKey,
                    ...(cand.title ? { sourceVersion: cand.title } : {}),
                    streamUrl: null,
                    preDownloadVerdict: 'rejected_pre_download',
                    reasons: ['Age-gate 18+'],
                  });
                  return;
                }
                if (streamRes.streamUrl) {
                  const remoteOutDir = join(input.mediaDir, '_remote_probe', `probe_${acqSeq + 1}`);
                  const adaptiveTimestamps = computeAdaptiveSampleTimestamps({
                    ...(cand.durationSec !== undefined ? { durationSec: cand.durationSec } : {}),
                    ...(cand.chapters ? { chapters: cand.chapters } : {}),
                    targetInterval: { startSec: win.startSec, endSec: win.endSec },
                    ...(task.segment.entities ? { entities: task.segment.entities } : {}),
                    query: task.segment.subject,
                  }).slice(0, 4);
                  const probe = await sampleRemoteFramesWithFfmpeg({
                    streamUrl: streamRes.streamUrl,
                    outDir: remoteOutDir,
                    timestampsSec: adaptiveTimestamps,
                    perFrameTimeoutMs: 12_000,
                    maxTotalBytes: 8 * 1024 * 1024,
                    ...(streamRes.httpHeaders ? { httpHeaders: streamRes.httpHeaders } : {}),
                    signal: opSig,
                  });
                  remoteSampleBytes += probe.telemetry.bytesTransferred;
                  remoteSampleRequests += probe.telemetry.requestsCount;
                  remoteSampleLatencyMs += probe.telemetry.latencyMs + (streamRes.latencyMs ?? 0);
                  if (!probe.telemetry.seekSupported || probe.framePaths.length < 2) {
                    preDownloadFallbackCount += 1;
                    remoteSamplingCache.set({
                      mediaIdentifier: cand.url,
                      intervalKey,
                      ...(cand.title ? { sourceVersion: cand.title } : {}),
                      streamUrl: streamRes.streamUrl,
                      streamResolvedAtMs: Date.now(),
                      preDownloadVerdict: 'fallback_partial_download',
                      telemetry: probe.telemetry,
                    });
                  } else {
                    try {
                      const rawAnalyses = await input.analyzeRemoteFramesFn(
                        probe.framePaths,
                        probe.timestampsSec,
                        {
                          segmentId: task.segment.segmentId,
                          prompt: input.prompt,
                          narrationText: task.segment.narrationText,
                          ...(input.genre ? { genre: input.genre } : {}),
                          ...(task.segment.entities ? { expectedEntities: task.segment.entities } : {}),
                        },
                      );
                      const analyses: DistributedFrameAnalysis[] = Array.isArray(rawAnalyses)
                        ? rawAnalyses
                        : (rawAnalyses as { analyses?: DistributedFrameAnalysis[] }).analyses ?? [];
                      const preDecision = await evaluateMediaRelevance(
                        {
                          mediaId: `pre_${acqSeq + 1}`,
                          uri: probe.framePaths[0]!,
                          ...(cand.title ? { title: cand.title } : {}),
                          ...(cand.description ? { description: cand.description } : {}),
                          origin: cand.origin,
                          durationSec: cand.durationSec ?? 30,
                          projectId: input.projectId,
                        },
                        {
                          segmentId: task.segment.segmentId,
                          prompt: input.prompt,
                          narrationText: task.segment.narrationText,
                          ...(input.genre ? { genre: input.genre } : {}),
                          ...(task.segment.entities ? { expectedEntities: task.segment.entities } : {}),
                        },
                        {
                          analyzeFrames: async () => analyses,
                          requireVisualVerification: true,
                        },
                      );
                      const combinedSampleText = analyses
                        .map((a: DistributedFrameAnalysis) => `${a.description} ${(a.detectedEntities ?? []).join(' ')}`)
                        .join(' ');
                      const hasConflict = hasCrossWorkEntityConflict(
                        combinedSampleText,
                        task.segment,
                        input.segments,
                      );
                      const hasExpectedEntities = (task.segment.entities?.length ?? 0) > 0;
                      const lackedPositiveVisualProof =
                        hasExpectedEntities &&
                        preDecision.verificationOutcome === 'needs_review' &&
                        preDecision.matchedEntities.length === 0;
                      if (
                        hasConflict ||
                        lackedPositiveVisualProof ||
                        preDecision.verificationOutcome === 'rejected' ||
                        preDecision.rejectionCode === 'wrong_anime_or_entity' ||
                        preDecision.rejectionCode === 'wrong_game_or_topic' ||
                        preDecision.rejectionCode === 'unrelated_real_person'
                      ) {
                        preDownloadRejectedCount += 1;
                        candidateStates.set(candKey, 'rejected');
                        rejectedCandidates.push({
                          mediaId: `pre_${acqSeq + 1}`,
                          title: cand.title ?? cand.url,
                          origin: cand.origin,
                          rejectionCode: preDecision.rejectionCode ?? 'rejected_pre_download',
                          reason: `Pré-verificação remota descartou antes do download (${lackedPositiveVisualProof ? 'sem evidência visual da obra no trecho' : 'incompatível'}): ${preDecision.reason}`,
                        });
                        remoteSamplingCache.set({
                          mediaIdentifier: cand.url,
                          intervalKey,
                          ...(cand.title ? { sourceVersion: cand.title } : {}),
                          streamUrl: streamRes.streamUrl,
                          streamResolvedAtMs: Date.now(),
                          preDownloadVerdict: 'rejected_pre_download',
                          reasons: [preDecision.reason],
                          telemetry: probe.telemetry,
                        });
                        try { rmSync(remoteOutDir, { recursive: true, force: true }); } catch { /* ignore */ }
                        return;
                      }
                      preDownloadPassedCount += 1;
                      preDownloadPassedKeys.add(candKey);
                      remoteSamplingCache.set({
                        mediaIdentifier: cand.url,
                        intervalKey,
                        ...(cand.title ? { sourceVersion: cand.title } : {}),
                        streamUrl: streamRes.streamUrl,
                        streamResolvedAtMs: Date.now(),
                        preDownloadVerdict: 'passed_pre_download',
                        telemetry: probe.telemetry,
                      });
                    } catch {
                      preDownloadFallbackCount += 1;
                    }
                  }
                  try { rmSync(remoteOutDir, { recursive: true, force: true }); } catch { /* ignore */ }
                } else {
                  preDownloadFallbackCount += 1;
                }
              }
            }
            if (cand.localPath && existsSync(cand.localPath)) {
              filePath = cand.localPath;
            } else if (cand.providerItem && input.deps.mediaProviders) {
              try {
                const slotNum = acqSeq + 1;
                const jobId = input.deps.mediaProviders.context?.jobId;
                const res = await input.deps.mediaProviders.registry.acquire(
                  cand.providerItem,
                  join(input.mediaDir, `auto_r${round}_${slotNum}`),
                  {
                    signal: opSig,
                    fileStem: `asset_${slotNum}`,
                    ...(jobId ? { jobId } : {}),
                    ...(cand.acquisitionMethod === 'yt_dlp' || cand.acquisitionMethod === 'hls'
                      ? { downloadSection: selectRelevantDownloadWindow(cand, task.segment).sectionArg }
                      : {}),
                  },
                );
                filePath = res.filePath;
              } catch (err) {
                downloadFailure = classifyOpFailure(err);
                filePath = null;
              }
            } else if (cand.directDownloadable && /^https?:\/\//i.test(cand.url)) {
              let candidateOutFile: string | null = null;
              try {
                const res = await fetchFn(cand.url, {
                  headers: { 'User-Agent': 'AetheraStudio/0.1 (media-acquisition)' },
                  signal: opSig,
                });
                if (!res.ok) {
                  downloadFailure = {
                    reasonCode: res.status === 429 ? 'anti_bot' : 'http_error',
                    detail: `HTTP ${res.status} ${res.statusText || ''}`.trim(),
                  };
                } else {
                  const contentLengthRaw = res.headers?.get?.('content-length');
                  const contentLengthBytes = contentLengthRaw ? Number(contentLengthRaw) : 0;
                  if (Number.isFinite(contentLengthBytes) && contentLengthBytes > 120 * 1024 * 1024) {
                    try { await res.body?.cancel(); } catch { /* ignore */ }
                    downloadFailure = {
                      reasonCode: 'invalid_file',
                      detail: `Arquivo remoto excede 120MB (${Math.round(contentLengthBytes / (1024 * 1024))}MB)`,
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
                }
              } catch (err) {
                if (candidateOutFile && existsSync(candidateOutFile)) {
                  try { unlinkSync(candidateOutFile); } catch { /* ignore */ }
                }
                downloadFailure = classifyOpFailure(err);
                filePath = null;
              }
            } else if (cand.origin === 'yt_dlp' && !ytDlpBlocked && input.deps.ytDlpAcquireFn) {
              try {
                const win = selectRelevantDownloadWindow(cand, task.segment);
                const onDlProgress = input.deps.onDownloadProgress
                  ? (p: { bytesDone: number; bytesTotal: number | null; pct?: number | null }) => {
                      const pct =
                        p.pct !== undefined && p.pct !== null
                          ? Math.min(100, Math.max(0, Math.round(p.pct)))
                          : p.bytesTotal && p.bytesTotal > 0
                            ? Math.min(100, Math.round((p.bytesDone / p.bytesTotal) * 100))
                            : null;
                      input.deps.onDownloadProgress?.({
                        url: cand.url,
                        slotIndex: acqSeq,
                        segmentId: task.segment.segmentId,
                        ...(cand.title ? { title: cand.title } : {}),
                        bytesDone: p.bytesDone,
                        bytesTotal: p.bytesTotal,
                        pct,
                      });
                    }
                  : undefined;
                filePath = await input.deps.ytDlpAcquireFn(cand.url, acqSeq, input.mediaDir, opSig, win.sectionArg, onDlProgress);
                if (!filePath || !existsSync(filePath)) {
                  downloadFailure = {
                    reasonCode: 'invalid_file',
                    detail: 'yt-dlp concluiu sem produzir arquivo válido',
                  };
                }
              } catch (err) {
                downloadFailure = classifyOpFailure(err);
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
              noteRecoveryFailure(candKey, failure.detail, 'download_failed', task.segment.segmentId);
              return;
            }

            if (cand.origin !== 'local_library') {
              downloadedTempPaths.add(resolve(filePath));
            }
            const fileSizeBytes = statSync(filePath).size;
            downloadedVideoBytes += fileSizeBytes;
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
              noteRecoveryFailure(candKey, `Arquivo inválido (${fileSizeBytes} bytes)`, 'download_failed', task.segment.segmentId);
              return;
            }

            const sha256 = createHash('sha256').update(readFileSync(filePath)).digest('hex');
            if (seenFileHashes.has(sha256)) {
              duplicateFilesSkipped += 1;
              candidateStates.set(candKey, 'rejected');
              sm.rejectedCount += 1;
              noteRejected(`dup_${duplicateFilesSkipped}`, task.segment.segmentId, cand.url);
              rejectedCandidates.push({
                mediaId: `dup_${duplicateFilesSkipped}`,
                title: cand.title ?? filePath,
                origin: cand.origin,
                rejectionCode: 'duplicate_file_hash',
                reason: `Arquivo duplicado idêntico (SHA-256 ${sha256.slice(0, 12)}) descartado para não inflar cobertura.`,
              });
              noteRecoveryFailure(candKey, 'duplicate_file_hash', 'rejected', task.segment.segmentId);
              return;
            }
            seenFileHashes.add(sha256);
            acquiredFilesCount += 1;
            sm.downloadsSucceeded += 1;
            candidateStates.set(candKey, 'pending_visual_verification');

            const mediaId = `auto_${cand.origin}_${acquiredFilesCount}`;
            const isImageFile = IMAGE_EXTS.has(extname(filePath).toLowerCase());
            let durationSec = isImageFile ? Math.max(8, task.segment.expectedDurationSec) : (cand.durationSec ?? 12);
            if (!isImageFile && input.probeDurationFn) {
              try {
                durationSec = await input.probeDurationFn(filePath);
              } catch {
                durationSec = cand.durationSec ?? 12;
              }
            }
            localPathByMediaId.set(mediaId, filePath);
            const candIdentityText = `${cand.title ?? ''} ${cand.description ?? ''} ${cand.url}`;
            const assignedSegments = [...discoveredBySegment.entries()]
              .flatMap(([segmentId, entries]) =>
                entries.some((entry) => `${entry.cand.origin}:${entry.cand.url}` === candKey)
                  ? [segmentId]
                  : [],
              )
              .filter((segmentId, index, all) => all.indexOf(segmentId) === index)
              .filter((segmentId) => {
                const segObj = segmentById.get(segmentId);
                return !segObj || !hasCrossWorkEntityConflict(candIdentityText, segObj, input.segments);
              });
            if (
              !assignedSegments.includes(task.segment.segmentId) &&
              !hasCrossWorkEntityConflict(candIdentityText, task.segment, input.segments)
            ) {
              assignedSegments.unshift(task.segment.segmentId);
            }
            for (const segmentId of assignedSegments) {
              const pendingKey = candidateSegmentKey(segmentId, candKey);
              pendingVerificationAssets.set(pendingKey, {
                candidateKey: candKey,
                segmentId,
                segment: task.segment,
                cand,
                filePath,
                fileSizeBytes,
                sha256,
                durationSec,
                mediaId,
                round,
              });
            }
          } finally {
            sm.timeConsumedMs += Date.now() - aStart;
          }
        });
      }
      stageTimingsMs.acquisitionMs += Date.now() - acqStageStartedAt;
      saveCheckpoint();

      // STAGE 3: Visual Verification Queue (resumes pending_visual_verification assets FIRST)
      const verStageStartedAt = Date.now();
      const verificationQueue = [...pendingVerificationAssets.entries()].map(([pendingKey, item]) => ({
        pendingKey,
        item,
      }));
      await runWithConcurrency(verificationQueue, verificationConcurrency, async ({ pendingKey, item }) => {
        if (input.signal?.aborted) {
          // Preserve file & keep state as pending_visual_verification (NEVER classify as editorial rejection!)
          return;
        }
        const candKey = item.candidateKey;
        const seg = segmentById.get(item.segmentId);
        if (!seg) return;
        const vStart = Date.now();
        const sm = segMetricsMap.get(item.segmentId)!;
        if (!existsSync(item.filePath)) {
          recordVisualCallback(item.mediaId, seg.segmentId)({
            status: 'media_unavailable',
            attempts: [],
            error: `Arquivo reutilizado no checkpoint não está disponível: ${item.filePath}`,
          });
          candidateStates.set(candKey, 'pending_visual_verification');
          return;
        }
        const cacheTimestamps = /\.(jpe?g|png|webp)(\?|$)/i.test(item.filePath)
          ? [0]
          : computeAdaptiveSampleTimestamps({
              durationSec: item.durationSec,
              ...(item.cand.chapters ? { chapters: item.cand.chapters } : {}),
              ...(seg.entities ? { entities: seg.entities } : {}),
              query: seg.subject,
            });
        const visionCacheKey = computeVisionDecisionCacheKey({
          sha256: item.sha256,
          timestampsSec: cacheTimestamps,
          visualIntent: (seg as { visualIntent?: string }).visualIntent ?? input.genre ?? '',
          expectedEntities: seg.entities ?? [],
          modelVersion: input.visionModelVersion ?? 'default-vision-v1',
          policyVersion: SCENE_GROUNDING_POLICY_VERSION,
        });
        const cachedDecision = visionCache.get(visionCacheKey);
        const canUseCachedDecision =
          cachedDecision !== undefined &&
          (!input.requireVisualVerification || cachedDecision.visualVerificationStatus === 'visually_verified');

        if (!canUseCachedDecision && input.analyzeFrames) visionDiagnostics.callsAttempted += 1;
        try {
          let decision: MediaRelevanceDecision;
          if (canUseCachedDecision) {
            cacheHits += 1;
            decision = {
              ...cachedDecision,
              mediaId: item.mediaId,
              ...(cachedDecision.accepted
                ? {
                    eligibleSegmentIds: [
                      ...new Set([...(cachedDecision.eligibleSegmentIds ?? []), seg.segmentId]),
                    ],
                  }
                : {}),
            };
          } else {
            cacheMisses += 1;
            decision = await evaluateMediaRelevance(
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
                onVisualVerification: recordVisualCallback(item.mediaId, seg.segmentId),
                ...(input.requireVisualVerification !== undefined
                  ? { requireVisualVerification: input.requireVisualVerification }
                  : {}),
                ...(input.evolution ? { evolution: input.evolution } : {}),
                ...(input.deps.animeProvenance ? { animeProvenance: input.deps.animeProvenance } : {}),
                ...(input.deps.extractFrameForProvenance
                  ? { extractFrameForProvenance: input.deps.extractFrameForProvenance }
                  : {}),
              },
            );
            if (!decision.visualVerificationError) {
              visionCache.set(visionCacheKey, decision);
            }
          }

          // Identity / literal / contextual / usage verdicts. Confirms or downgrades the gate, never upgrades it.
          const approvalCandidate = {
            mediaId: item.mediaId,
            ...(item.cand.title ? { title: item.cand.title } : {}),
            ...(item.cand.description ? { description: item.cand.description } : {}),
            origin: item.cand.origin,
            url: item.cand.url,
            license: item.cand.license,
            ...(item.cand.providerItem ? { providerItem: item.cand.providerItem } : {}),
            ...(item.cand.licenseDecision ? { licenseDecision: item.cand.licenseDecision } : {}),
            ...(item.cand.assessment ? { assessment: item.cand.assessment } : {}),
          };
          const approvalScene = {
            sceneId: seg.segmentId,
            ...(seg.entities ? { entities: seg.entities } : {}),
            ...(seg.work ? { work: seg.work } : {}),
            ...(input.projectDomain ? { projectDomain: input.projectDomain } : {}),
          };
          const built = buildSceneMediaApproval(approvalCandidate, decision, approvalScene);
          const approvalIndex = mediaApprovals.findIndex((a) => a.mediaId === item.mediaId && a.sceneId === seg.segmentId);
          if (approvalIndex >= 0) mediaApprovals.splice(approvalIndex, 1, built.approval);
          else mediaApprovals.push(built.approval);
          decision = built.effectiveDecision;

          if (decision.visualVerificationError) {
            if (!canUseCachedDecision && input.analyzeFrames) visionDiagnostics.callsFailed += 1;
            visionDiagnostics.providerErrors.push(decision.visualVerificationError.slice(0, 900));
            // Infra/provider failure during verification: keep file in pending_visual_verification to resume later!
            candidateStates.set(candKey, 'pending_visual_verification');
            return;
          }

          if (!canUseCachedDecision && input.analyzeFrames) visionDiagnostics.callsSucceeded += 1;
          pendingVerificationAssets.delete(pendingKey);
          if (decision.verificationOutcome === 'rejected' && preDownloadPassedKeys.has(candKey)) {
            postDownloadRejectedAfterPrePass += 1;
          }
          relevanceDecisions.push(decision);
          const recoveryAttemptForAsset = findRecoveryAttempt(candKey, seg.segmentId);
          if (recoveryAttemptForAsset && !recoveryAttemptForAsset.acquiredMediaIds.includes(item.mediaId)) {
            recoveryAttemptForAsset.acquiredMediaIds.push(item.mediaId);
          }

          if (
            input.evolution &&
            ((!decision.accepted &&
              decision.rejectionCode !== 'academy_negative_example' &&
              decision.visualVerificationStatus === 'visually_verified') ||
              decision.correspondenceLevel === 'universe_only_coincidence')
          ) {
            const observedSummary = (decision.visualEvidence ?? [])
              .map((ev) => `${ev.timestampSec}s: ${ev.description}`)
              .join(' | ');
            recordSceneGroundingNegativeExample(input.evolution, {
              projectId: input.projectId,
              segmentId: seg.segmentId,
              mediaTitle: item.cand.title ?? item.filePath,
              ...(item.sha256 ? { mediaSha256: item.sha256 } : {}),
              workScope: extractTopicEntities(input.prompt).slice(0, 3).join(' '),
              eventScope: `${(seg.entities ?? extractTopicEntities(seg.narrationText)).join(' ')} ${seg.narrationText.slice(0, 80)}`,
              expectedContext: `${(seg.entities ?? extractTopicEntities(seg.narrationText)).join(', ')}${seg.narrationText ? ` (${seg.narrationText.slice(0, 80)})` : ''}`,
              observedVisualSummary: observedSummary || decision.reason,
              mismatchReason: decision.reason,
              ...(decision.visualConfidence !== undefined ? { visualConfidence: decision.visualConfidence } : {}),
              ...(input.genre ? { genre: input.genre } : {}),
            });
          }

          if (!isAssemblyEligibleDecision(decision)) {
            if (decision.editorialStatus === 'contextual' || decision.editorialStatus === 'visually_verified') {
              setCandidateVerificationState(candKey, 'contextual');
              contextualCandidates.push({
                mediaId: item.mediaId,
                segmentId: seg.segmentId,
                title: item.cand.title ?? item.filePath,
                origin: item.cand.origin,
                sourceUrl: item.cand.url,
                status: decision.editorialStatus,
                reason: decision.reason,
              });
              const hasSegmentIntervals = decision.matchedIntervals?.some((iv) => iv.segmentId === seg.segmentId) ?? false;
              const licenseAllowed =
                item.cand.licenseDecision?.status !== 'blocked' &&
                (item.cand.licenseDecision?.status !== 'pending_human_review' ||
                  licensePolicy === 'assemble_with_rights_review');
              if (
                decision.accepted &&
                decision.visualVerificationStatus === 'visually_verified' &&
                decision.correspondenceLevel === 'contextual_support' &&
                (hasSegmentIntervals || decision.score >= 0.45) &&
                licenseAllowed
              ) {
                const list = verifiedContextualFallbacksBySegment.get(seg.segmentId) ?? [];
                list.push({
                  item,
                  candKey,
                  decision,
                  ...(recoveryAttemptForAsset ? { recoveryAttemptForAsset } : {}),
                });
                verifiedContextualFallbacksBySegment.set(seg.segmentId, list);
              }
              const visualRecord = visionDiagnostics.records.find((record) => record.mediaId === item.mediaId && record.segmentId === seg.segmentId);
              if (visualRecord) visualRecord.editorialDisposition = 'contextual';
              if (recoveryAttemptForAsset) recoveryAttemptForAsset.outcome = 'contextual_only';
              return;
            }
            setCandidateVerificationState(candKey, 'rejected');
            sm.rejectedCount += 1;
            noteRejected(item.mediaId, seg.segmentId, item.cand.url);
            rejectedCandidates.push({
              mediaId: item.mediaId,
              title: item.cand.title ?? item.filePath,
              origin: item.cand.origin,
              ...(decision.rejectionCode ? { rejectionCode: decision.rejectionCode } : {}),
              reason: decision.reason,
            });
            const visualRecord = visionDiagnostics.records.find((record) => record.mediaId === item.mediaId && record.segmentId === seg.segmentId);
            if (visualRecord) visualRecord.editorialDisposition = 'rejected';
            if (recoveryAttemptForAsset) {
              recoveryAttemptForAsset.rejectedMediaIds.push(item.mediaId);
              if (!recoveryAttemptForAsset.rejectionReasons.includes(decision.reason)) {
                recoveryAttemptForAsset.rejectionReasons.push(decision.reason);
              }
              recoveryAttemptForAsset.outcome = 'rejected';
            }
            return;
          }

          if (item.cand.licenseDecision?.status === 'pending_human_review' && licensePolicy === 'assemble_with_rights_review') {
            // Identity/relevance verified, rights unresolved: the draft may use it, publication stays blocked until a
            // human decides. The rights situation is recorded, never hidden.
            pendingLicenseReview.push({
              mediaId: item.mediaId,
              segmentId: seg.segmentId,
              title: item.cand.title ?? item.filePath,
              origin: item.cand.origin,
              sourceUrl: item.cand.providerItem?.pageUrl ?? item.cand.url,
              localPath: item.filePath,
              licenseId: item.cand.providerItem?.license.licenseId ?? 'unknown',
              reasons: item.cand.licenseDecision.reasons,
              relevanceAccepted: true,
              usedInDraft: true,
            });
          } else if (item.cand.licenseDecision?.status === 'pending_human_review') {
            // The relevance gate approved it, but the license is not known to allow this use: keep both results and
            // send the media to human review instead of approving it automatically.
            setCandidateVerificationState(candKey, 'rejected');
            sm.rejectedCount += 1;
            pendingLicenseReview.push({
              mediaId: item.mediaId,
              segmentId: seg.segmentId,
              title: item.cand.title ?? item.filePath,
              origin: item.cand.origin,
              sourceUrl: item.cand.providerItem?.pageUrl ?? item.cand.url,
              localPath: item.filePath,
              licenseId: item.cand.providerItem?.license.licenseId ?? 'unknown',
              reasons: item.cand.licenseDecision.reasons,
              relevanceAccepted: true,
            });
            noteRejected(item.mediaId, seg.segmentId, item.cand.url);
            rejectedCandidates.push({
              mediaId: item.mediaId,
              title: item.cand.title ?? item.filePath,
              origin: item.cand.origin,
              rejectionCode: 'license_pending_human_review',
              reason: `Relevância aprovada, mas a licença requer revisão humana: ${item.cand.licenseDecision.reasons.join(' ')}`,
            });
            const visualRecord = visionDiagnostics.records.find((record) => record.mediaId === item.mediaId && record.segmentId === seg.segmentId);
            if (visualRecord) visualRecord.editorialDisposition = 'rejected';
            if (recoveryAttemptForAsset) {
              recoveryAttemptForAsset.rejectedMediaIds.push(item.mediaId);
              recoveryAttemptForAsset.rejectionReasons.push('license_pending_human_review');
              recoveryAttemptForAsset.outcome = 'rejected';
            }
            return;
          }

          setCandidateVerificationState(candKey, 'verified');
          const visualRecord = visionDiagnostics.records.find((record) => record.mediaId === item.mediaId && record.segmentId === seg.segmentId);
          if (visualRecord) visualRecord.editorialDisposition = 'approved';
          sm.approvedCount += 1;
          approvedSegmentByMediaId.set(item.mediaId, seg.segmentId);
          const existingApproved = approvedAssets.find((asset) => asset.mediaId === item.mediaId);
          if (existingApproved) {
            existingApproved.relevantToEntities = [...new Set([...(existingApproved.relevantToEntities ?? []), ...decision.matchedEntities])];
            if (decision.editorialStatus) existingApproved.editorialStatus = decision.editorialStatus;
          } else {
            approvedAssets.push({
              mediaId: item.mediaId,
              uri: item.filePath,
              ...(item.cand.title ? { title: item.cand.title } : {}),
              origin: item.cand.origin,
              durationSec: item.durationSec,
              compatible: true,
              relevantToEntities: decision.matchedEntities,
              ...(decision.editorialStatus ? { editorialStatus: decision.editorialStatus } : {}),
            });
          }
          const previousApprovedMeta = approvedMetaById.get(item.mediaId);
          approvedMetaById.set(item.mediaId, {
            title: item.cand.title ?? item.filePath,
            origin: item.cand.origin,
            sourceUrl: item.cand.url,
            localPath: item.filePath,
            fileSizeBytes: item.fileSizeBytes,
            sha256: item.sha256,
            durationSec: item.durationSec,
            decision: previousApprovedMeta ? mergeApprovedDecision(previousApprovedMeta.decision, decision) : decision,
            ...(item.cand.providerItem ? { providerItem: item.cand.providerItem } : {}),
            ...(item.cand.licenseDecision ? { licenseDecision: item.cand.licenseDecision } : {}),
          });
          if (recoveryAttemptForAsset) {
            recoveryAttemptForAsset.approvedMediaIds.push(item.mediaId);
            recoveryAttemptForAsset.outcome = 'verified_interval';
          }

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
      stageTimingsMs.verificationMs += Date.now() - verStageStartedAt;

      // STAGE 4: Coverage update & Checkpoint persistence
      const covStartedAt = Date.now();
      latestCoverage = planMediaCoverage({
        segments: input.segments,
        assets: approvedAssets,
        ...(input.format ? { format: input.format } : {}),
        relevanceDecisions,
        requireRelevanceApproval: true,
      });
      stageTimingsMs.coverageMs += Date.now() - covStartedAt;

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
    if (stoppedReason === 'max_rounds' && (deadlineController.signal.aborted || remainingMs() <= 0)) {
      stoppedReason = 'deadline_exceeded';
    }

    // Fallback editorial: se alguma cena terminou sem match literal (0s cobertos), mas já possui
    // apoio contextual verificado visualmente (contextual_support + visually_verified), promove o melhor
    // ativo verificado em vez de descartar o arquivo e travar a produção.
    let promotedContextualFallback = false;
    if (stageMode !== 'verify_pending_only') {
      for (const segCov of latestCoverage.segments) {
        if (segCov.covered) continue;
        const pool = verifiedContextualFallbacksBySegment.get(segCov.segmentId);
        if (!pool || pool.length === 0) continue;
        const eligiblePool = pool.filter((entry) => {
          if (approvedAssets.some((a) => a.mediaId === entry.item.mediaId)) return false;
          const isStaticImg = /\.(jpe?g|png|webp)(\?|$)/i.test(entry.item.filePath) || /\.(jpe?g|png|webp)(\?|$)/i.test(entry.item.cand.url);
          const ivCount = entry.decision.matchedIntervals?.filter((iv) => iv.segmentId === segCov.segmentId).length ?? 0;
          // Relaxed: one verified interval is sufficient for contextual B-roll promotion.
          // Previously required >=2 for video, which blocked most promotions in practice.
          if (ivCount < 1) return false;
          const targetSeg = input.segments.find((s) => s.segmentId === segCov.segmentId);
          if (!targetSeg) return true;
          if (targetSeg.entities && targetSeg.entities.length > 0) {
            const targetEnts = targetSeg.entities.map((e) => e.toLowerCase());
            const hasEntityOverlap = entry.decision.matchedEntities.some((m) => {
              const ml = m.toLowerCase();
              return targetEnts.some((te) => te.includes(ml) || ml.includes(te));
            });
            if (!hasEntityOverlap) return false;
          }
          const evidenceText = `${entry.item.cand.title ?? ''} ${entry.item.cand.description ?? ''} ${(entry.decision.visualEvidence ?? []).map((v) => v.description).join(' ')}`;
          return !hasCrossWorkEntityConflict(evidenceText, targetSeg, input.segments);
        });
        if (eligiblePool.length === 0) continue;
        const ranked = [...eligiblePool].sort((a, b) => {
        const scoreDiff = (b.decision.score ?? 0) - (a.decision.score ?? 0);
        if (Math.abs(scoreDiff) > 0.01) return scoreDiff;
        const ivB = b.decision.matchedIntervals?.filter((iv) => iv.segmentId === segCov.segmentId).length ?? 0;
        const ivA = a.decision.matchedIntervals?.filter((iv) => iv.segmentId === segCov.segmentId).length ?? 0;
        if (ivB !== ivA) return ivB - ivA;
        return (b.decision.visualConfidence ?? 0) - (a.decision.visualConfidence ?? 0);
      });
      const best = ranked[0];
      if (!best || !existsSync(best.item.filePath)) continue;

      const promotedDecision: MediaRelevanceDecision = {
        ...best.decision,
        accepted: true,
        assemblyEligible: true,
        editorialStatus: 'approved_for_scene',
        verificationOutcome: 'verified',
        eligibleSegmentIds: [...new Set([...(best.decision.eligibleSegmentIds ?? []), segCov.segmentId])],
        reason: `Apoio contextual verificado visualmente promovido para cena sem match literal: ${best.decision.reason}`,
      };
      const idx = relevanceDecisions.indexOf(best.decision);
      if (idx >= 0) {
        relevanceDecisions[idx] = promotedDecision;
      } else {
        relevanceDecisions.push(promotedDecision);
      }

      setCandidateVerificationState(best.candKey, 'verified');
      const visualRecord = visionDiagnostics.records.find(
        (record) => record.mediaId === best.item.mediaId && record.segmentId === segCov.segmentId,
      );
      if (visualRecord) visualRecord.editorialDisposition = 'approved';
      const sm = segMetricsMap.get(segCov.segmentId);
      if (sm) sm.approvedCount += 1;
      approvedSegmentByMediaId.set(best.item.mediaId, segCov.segmentId);

      const existingApproved = approvedAssets.find((asset) => asset.mediaId === best.item.mediaId);
      if (existingApproved) {
        existingApproved.relevantToEntities = [
          ...new Set([...(existingApproved.relevantToEntities ?? []), ...promotedDecision.matchedEntities]),
        ];
        existingApproved.editorialStatus = 'approved_for_scene';
      } else {
        approvedAssets.push({
          mediaId: best.item.mediaId,
          uri: best.item.filePath,
          ...(best.item.cand.title ? { title: best.item.cand.title } : {}),
          origin: best.item.cand.origin,
          durationSec: best.item.durationSec,
          compatible: true,
          relevantToEntities: promotedDecision.matchedEntities,
          editorialStatus: 'approved_for_scene',
        });
      }
      const previousApprovedMeta = approvedMetaById.get(best.item.mediaId);
      approvedMetaById.set(best.item.mediaId, {
        title: best.item.cand.title ?? best.item.filePath,
        origin: best.item.cand.origin,
        sourceUrl: best.item.cand.url,
        localPath: best.item.filePath,
        fileSizeBytes: best.item.fileSizeBytes,
        sha256: best.item.sha256,
        durationSec: best.item.durationSec,
        decision: previousApprovedMeta ? mergeApprovedDecision(previousApprovedMeta.decision, promotedDecision) : promotedDecision,
        ...(best.item.cand.providerItem ? { providerItem: best.item.cand.providerItem } : {}),
        ...(best.item.cand.licenseDecision ? { licenseDecision: best.item.cand.licenseDecision } : {}),
      });
      if (best.item.cand.licenseDecision?.status === 'pending_human_review' && licensePolicy === 'assemble_with_rights_review') {
        pendingLicenseReview.push({
          mediaId: best.item.mediaId,
          segmentId: segCov.segmentId,
          title: best.item.cand.title ?? best.item.filePath,
          origin: best.item.cand.origin,
          sourceUrl: best.item.cand.providerItem?.pageUrl ?? best.item.cand.url,
          localPath: best.item.filePath,
          licenseId: best.item.cand.providerItem?.license.licenseId ?? 'unknown',
          reasons: best.item.cand.licenseDecision.reasons,
          relevanceAccepted: true,
          usedInDraft: true,
        });
      }
      if (best.recoveryAttemptForAsset) {
        if (!best.recoveryAttemptForAsset.approvedMediaIds.includes(best.item.mediaId)) {
          best.recoveryAttemptForAsset.approvedMediaIds.push(best.item.mediaId);
        }
        best.recoveryAttemptForAsset.outcome = 'verified_interval';
      }
      promotedContextualFallback = true;
      }
    }

    if (promotedContextualFallback) {
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
      if (latestCoverage.gatePassed) {
        stoppedReason = 'coverage_satisfied';
      }
    }
  } finally {
    clearTimeout(deadlineTimer);
    saveCheckpoint();
    const approvedResolvedPaths = new Set(approvedAssets.map((a) => resolve(a.uri)));
    const pendingResolvedPaths = new Set(
      [...pendingVerificationAssets.values()].map((p) => resolve(p.filePath)),
    );
    const mediaRootResolved = resolve(input.mediaDir);
    for (const fp of downloadedTempPaths) {
      if (approvedResolvedPaths.has(fp) || pendingResolvedPaths.has(fp)) continue;
      const rel = relative(mediaRootResolved, fp);
      if (!rel || rel.startsWith('..') || isAbsolute(rel)) continue;
      if (existsSync(fp)) {
        try { unlinkSync(fp); } catch { /* ignore */ }
      }
    }
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
      ...resolveRightsStatus(meta),
      ...(meta.providerItem
        ? {
            provenance: {
              provider: meta.providerItem.provider,
              pageUrl: meta.providerItem.pageUrl,
              ...(meta.providerItem.license.author ? { author: meta.providerItem.license.author } : {}),
              ...(meta.providerItem.license.attributionText ? { attributionText: meta.providerItem.license.attributionText } : {}),
              licenseId: meta.providerItem.license.licenseId,
              licenseName: meta.providerItem.license.licenseName,
              ...(meta.providerItem.license.licenseUrl ? { licenseUrl: meta.providerItem.license.licenseUrl } : {}),
              licenseStatus: meta.licenseDecision?.status ?? 'pending_human_review',
              obligations: meta.licenseDecision?.obligations ?? [],
              classification: meta.providerItem.classification,
              classificationConfidence: meta.providerItem.classificationConfidence,
              retrievedAt: meta.providerItem.provenance.retrievedAt,
            },
          }
        : {}),
    });
  }

  const finalRecoveryPlan = buildMediaRecoveryPlan({
    prompt: input.prompt,
    segments: input.segments,
    coverageReport: latestCoverage,
    ...(input.genre ? { genre: input.genre } : {}),
    maxAttemptsPerGap: input.limits?.maxRecoveryAttemptsPerGap ?? 4,
  });
  const maxRecoveryAttemptsPerGap = Math.max(1, Math.min(8, input.limits?.maxRecoveryAttemptsPerGap ?? 4));
  const affectedSegmentIds = [
    ...new Set([
      ...recoveryAttempts.map((attempt) => attempt.segmentId),
      ...finalRecoveryPlan.gaps.map((gap) => gap.segmentId),
    ]),
  ];
  const unresolvedGapsForReview = finalRecoveryPlan.gaps.map((gap) => {
    const attempts = recoveryAttempts.filter((attempt) => attempt.segmentId === gap.segmentId);
    const suggestedQuery =
      finalRecoveryPlan.queries.find((query) => query.segmentId === gap.segmentId)?.query ??
      input.segments.find((seg) => seg.segmentId === gap.segmentId)?.preferredQueries?.[0] ??
      gap.subject;
    return {
      segmentId: gap.segmentId,
      subject: gap.subject,
      suggestedQuery,
      uncoveredIntervals: gap.uncoveredIntervals,
      missingDurationSec: gap.missingDurationSec,
      attempts: attempts.length,
      attemptsExhausted:
        attempts.length >= maxRecoveryAttemptsPerGap ||
        roundsExecuted >= maxRounds ||
        stoppedReason === 'max_queries' ||
        stoppedReason === 'deadline_exceeded',
      reason: `Trechos ${gap.uncoveredIntervals.map((interval) => `${interval.startSec}-${interval.endSec}s`).join(', ')} sem footage comprovado após ${roundsExecuted} rodada(s): ${gap.coveredDurationSec}s / ${gap.expectedDurationSec}s. Tentativas: ${attempts.length}/${maxRecoveryAttemptsPerGap}.`,
      editorialAlternatives: gap.editorialAlternatives,
    };
  });

  const stateCounts: Record<CandidateLifecycleState, number> = {
    discovered: 0,
    downloading: 0,
    downloaded: 0,
    pending_visual_verification: 0,
    contextual: 0,
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

  const rightsReview = approvedMediaDetails
    .filter((d) => d.rightsStatus !== 'licensed')
    .map((d) => ({ mediaId: d.mediaId, title: d.title, origin: d.origin, sourceUrl: d.sourceUrl, rightsStatus: d.rightsStatus, note: d.rightsNote }));

  const youtubeThumb = (url: string): string | undefined => {
    const id = /(?:v=|youtu\.be\/|shorts\/)([\w-]{11})/.exec(url)?.[1];
    return id ? `https://i.ytimg.com/vi/${id}/hqdefault.jpg` : undefined;
  };
  const decisionById = new Map(relevanceDecisions.map((d) => [d.mediaId, d]));
  const sceneDiagnostics: SceneMediaDiagnostic[] = latestCoverage.segments.map((cov) => {
    const sm = segMetricsMap.get(cov.segmentId);
    const segQueries = queriesExecuted.filter((q) => q.segmentId === cov.segmentId).map((q) => q.query);
    const approved = approvedMediaDetails
      .filter((d) => d.coveredSegmentIds.includes(cov.segmentId) || approvedSegmentByMediaId.get(d.mediaId) === cov.segmentId)
      .map((d) => ({ mediaId: d.mediaId, title: d.title, origin: d.origin, sourceUrl: d.sourceUrl, rightsStatus: d.rightsStatus }));
    const contextual = contextualCandidates
      .filter((candidate) => candidate.segmentId === cov.segmentId)
      .map(({ mediaId, title, origin, sourceUrl, status, reason }) => ({ mediaId, title, origin, sourceUrl, status, reason }));
    const rejected = rejectedCandidates
      .filter((r) => rejectedSegmentByMediaId.get(r.mediaId) === cov.segmentId)
      .map((r) => {
        const dec = decisionById.get(r.mediaId);
        const url = rejectedUrlByMediaId.get(r.mediaId);
        const thumb = url ? youtubeThumb(url) : undefined;
        const local = localPathByMediaId.get(r.mediaId);
        return {
          mediaId: r.mediaId,
          title: r.title,
          origin: r.origin,
          ...(url ? { url } : {}),
          ...(thumb ? { thumbnailUrl: thumb } : {}),
          ...(local ? { localPath: local } : {}),
          ...(r.rejectionCode ? { rejectionCode: r.rejectionCode } : {}),
          reason: r.reason,
          ...(dec?.visualEvidence?.length
            ? { evidence: dec.visualEvidence.slice(0, 6).map((e) => ({ timestampSec: e.timestampSec, description: e.description })) }
            : {}),
        };
      });
    const failed = failedDownloads
      .filter((f) => f.segmentId === cov.segmentId)
      .map((f) => ({ title: f.title, url: f.url, reasonCode: f.reasonCode, detail: f.detail }));
    const pendingRights = approved.filter((a) => a.rightsStatus !== 'licensed').length;
    const visualRecordsForScene = visionDiagnostics.records.filter((record) => record.segmentId === cov.segmentId);
    const sceneAttempts = recoveryAttempts.filter((attempt) => attempt.segmentId === cov.segmentId);
    const pendingForScene = pendingLicenseReview.filter((pl) => pl.segmentId === cov.segmentId && !pl.usedInDraft);
    const unusedVerified = approvedMediaDetails.find(
      (d) => !d.coveredSegmentIds.includes(cov.segmentId) && d.matchedEntities.some((e) => cov.entities.includes(e)),
    );
    const bestAlternative: SceneMediaDiagnostic['bestAlternative'] = cov.covered
      ? undefined
      : pendingForScene[0]
        ? { kind: 'pending_rights_media', detail: `"${pendingForScene[0].title}" foi verificada mas aguarda decisão de licença.` }
        : unusedVerified
          ? { kind: 'unused_verified_media', detail: `"${unusedVerified.title}" (verificada para outra cena da mesma obra) pode completar esta cena.` }
          : cov.usableDurationSec > 0
            ? { kind: 'graphic_recovery', detail: `Completar ${Math.round(cov.coverageGapSec)}s com composição gráfica/tipografia identificada como gráfico (não como evidência da obra).` }
            : { kind: 'manual_import', detail: `Nenhuma mídia verificada: importar trecho de "${cov.subject}" ou aprovar recuperação gráfica explícita.` };
    return {
      segmentId: cov.segmentId,
      subject: cov.subject,
      queries: segQueries,
      sourcesConsulted: [...new Set(allStatuses.filter((st) => st.status !== 'skipped_disabled').map((st) => String(st.provider)))],
      candidatesFound: sm?.candidatesFound ?? 0,
      sharedQueries: sm?.sharedQueries ?? 0,
      sharedCandidates: sm?.sharedCandidates ?? 0,
      attempts: sceneAttempts.length,
      visualAttempts: visualRecordsForScene.reduce((count, record) => count + record.attempts.length, 0),
      technicalBlocked: visualRecordsForScene.filter((record) => record.status === 'technical_blocked' || record.status === 'partial').length,
      mediaUnavailable: visualRecordsForScene.filter((record) => record.status === 'media_unavailable').length,
      acquired: sm?.downloadsSucceeded ?? 0,
      approved,
      contextual,
      rejected,
      failedDownloads: failed,
      coveredSec: cov.usableDurationSec,
      expectedSec: cov.expectedDurationSec,
      ...(bestAlternative ? { bestAlternative } : {}),
      pendingRights,
    };
  });

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
    recoveryAttempts,
    affectedSegmentIds,
    pendingLicenseReview,
    rightsReview,
    equivalentQueriesSkipped,
    sceneDiagnostics,
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
      mediaUnavailableCount: visionDiagnostics.records.filter((record) => record.status === 'media_unavailable').length,
      visionDiagnostics: {
        ...visionDiagnostics,
        providerErrors: [...new Set(visionDiagnostics.providerErrors)].slice(0, 15),
        records: visionDiagnostics.records.map((record) => ({
          ...record,
          attempts: [...record.attempts],
        })),
      },
    },
    coverageReport: latestCoverage,
    approvedAssets,
    approvedMediaDetails,
    relevanceDecisions,
    mediaApprovals,
    observability: {
      stageTimingsMs: { ...stageTimingsMs },
      cacheHits,
      cacheMisses,
      triageEliminatedCount,
      skippedQueriesFromCheckpoint,
      reusedFilesFromCheckpoint,
      estimatedRemainingWork: (() => {
        const uncoveredSegments = latestCoverage.segments.filter((s) => s.usableDurationSec === 0).length;
        const partiallyCoveredSegments = latestCoverage.segments.filter(
          (s) => !s.covered && s.usableDurationSec > 0,
        ).length;
        const missingDurationSec = Number(
          latestCoverage.segments
            .reduce((acc, s) => acc + Math.max(0, s.expectedDurationSec - s.usableDurationSec), 0)
            .toFixed(2),
        );
        const totalCoveredSec = latestCoverage.segments.reduce((acc, s) => acc + s.usableDurationSec, 0);
        const avgMsPerSec =
          totalCoveredSec > 0 ? Math.round((Date.now() - startedAt) / totalCoveredSec) : 2_000;
        const estimatedRemainingMs = Math.round(
          missingDurationSec * Math.min(10_000, Math.max(500, avgMsPerSec)),
        );
        return {
          uncoveredSegments,
          partiallyCoveredSegments,
          missingDurationSec,
          estimatedRemainingMs,
        };
      })(),
    },
    pipelineMetrics: (() => {
      const totalElapsedMs = Date.now() - startedAt;
      const totalBytesTransferred = remoteSampleBytes + downloadedVideoBytes;
      const totalChecked = Math.max(1, preDownloadCheckedCount + acquiredFilesCount);
      const distinctClipsPerScene: Record<string, number> = {};
      const semanticCoverageByScene = latestCoverage.segments.map((s) => {
        const distinctClipsCount = new Set(s.relevantIntervals.map((iv) => iv.mediaId)).size;
        distinctClipsPerScene[s.segmentId] = distinctClipsCount;
        return {
          segmentId: s.segmentId,
          subject: s.subject,
          coveredSec: Number(s.usableDurationSec.toFixed(2)),
          expectedSec: Number(s.expectedDurationSec.toFixed(2)),
          coverageRatio:
            s.expectedDurationSec > 0
              ? Number(Math.min(1, s.usableDurationSec / s.expectedDurationSec).toFixed(2))
              : 0,
          distinctClipsCount,
        };
      });
      return {
        avgTimePerCandidateMs: Math.round(totalElapsedMs / totalChecked),
        bytesTransferredPerCandidate: Math.round(totalBytesTransferred / totalChecked),
        totalBytesTransferred,
        remoteSampleBytes,
        downloadedVideoBytes,
        remoteSampleRequests,
        remoteSampleLatencyMs,
        preDownloadCheckedCount,
        preDownloadRejectionRate:
          preDownloadCheckedCount > 0
            ? Number((preDownloadRejectedCount / preDownloadCheckedCount).toFixed(3))
            : 0,
        falsePositiveRate:
          preDownloadPassedCount > 0
            ? Number((postDownloadRejectedAfterPrePass / preDownloadPassedCount).toFixed(3))
            : 0,
        fallbackPartialDownloadCount: preDownloadFallbackCount,
        totalAcquisitionMs: totalElapsedMs,
        semanticCoverageByScene,
        distinctClipsPerScene,
      };
    })(),
  };
}
