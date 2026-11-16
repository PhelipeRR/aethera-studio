import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface AnimeWorkTitles {
  native?: string;
  romaji?: string;
  english?: string;
  synonyms?: string[];
}

export interface AnimeProvenanceIdentifiers {
  anilistId?: number;
  malId?: number;
  filename?: string;
}

export interface AnimeProvenanceMatch {
  origin: 'trace_moe' | string;
  workTitle: string;
  titles: AnimeWorkTitles;
  identifiers: AnimeProvenanceIdentifiers;
  episode?: number | string | null;
  fromSec: number;
  toSec: number;
  confidence: number;
  isAdult?: boolean;
  evidence: {
    previewVideoUrl?: string;
    previewImageUrl?: string;
    frameSha256: string;
    queriedAt: string;
    fromCache: boolean;
  };
  /**
   * Provenance identifies the anime work/episode/timestamp, NEVER proof of the narrated action.
   * VisionRouter multimodal verification is still required before editorial approval.
   */
  provenanceOnly: true;
}

export interface AnimeProvenanceResult {
  status: 'ok' | 'no_match' | 'rate_limited' | 'unavailable';
  origin: string;
  frameSha256: string;
  matches: AnimeProvenanceMatch[];
  topMatch?: AnimeProvenanceMatch;
  isAmbiguous?: boolean;
  ambiguityReason?: string;
  fromCache: boolean;
  error?: string;
}

export function evaluateTraceMoeAmbiguity(
  matches: AnimeProvenanceMatch[],
): { isAmbiguous: boolean; ambiguityReason?: string } {
  const top = matches[0];
  if (!top) return { isAmbiguous: false };
  if (top.confidence < 0.85) {
    return {
      isAmbiguous: true,
      ambiguityReason: `Confiança moderada (${top.confidence}) — possível cena editada, AMV ou frame com efeitos; exigir confirmação multimodal.`,
    };
  }
  const topKey = String(top.identifiers.anilistId ?? top.workTitle).toLowerCase();
  const rival = matches.slice(1).find((m) => {
    const k = String(m.identifiers.anilistId ?? m.workTitle).toLowerCase();
    return k !== topKey && top.confidence - m.confidence < 0.06;
  });
  if (rival) {
    return {
      isAmbiguous: true,
      ambiguityReason: `Correspondência ambígua entre "${top.workTitle}" (${top.confidence}) e "${rival.workTitle}" (${rival.confidence}).`,
    };
  }
  return { isAmbiguous: false };
}

export interface AnimeProvenanceAdapter {
  readonly id: string;
  identifyFrame(input: {
    framePath?: string;
    frameBuffer?: Buffer;
    mimeType?: string;
    signal?: AbortSignal;
    minConfidence?: number;
    cutBorders?: boolean;
  }): Promise<AnimeProvenanceResult>;
}

export interface AnimeMediaSourceCandidate {
  id: string | number;
  origin: 'sakugabooru' | string;
  title: string;
  url: string;
  previewUrl?: string;
  tags: string[];
  rating: 's' | 'q' | 'e' | string;
  fileExt: string;
  fileSizeBytes?: number;
  md5?: string;
  width?: number;
  height?: number;
  score?: number;
  source?: string;
  postUrl?: string;
  author?: string;
  artistCredits?: string[];
  usageNotice?: string;
}

export interface AnimeMediaSearchResult {
  status: 'ok' | 'empty' | 'rate_limited' | 'unavailable';
  origin: string;
  candidates: AnimeMediaSourceCandidate[];
  fromCache: boolean;
  error?: string;
}

export interface AnimeMediaSourceAdapter {
  readonly id: string;
  searchClips(input: {
    query: string;
    tags?: string[];
    limit?: number;
    safeOnly?: boolean;
    signal?: AbortSignal;
  }): Promise<AnimeMediaSearchResult>;
}

export function isAnimeSubjectOrGenre(text: string, genre?: string): boolean {
  if (genre === 'anime' || genre === 'anime_essay') return true;
  if (genre === 'gameplay_essay' || genre === 'gaming') return false;
  return /\b(animes?|mang[aá]s?|shonen|seinen|black clover|fairy tail|hunter x hunter|mashle|sakuga|dragon ball|dbz|naruto|one piece|bleach|jujutsu|attack on titan|shingeki|demon slayer|kimetsu|chainsaw man|evangelion|goku|vegeta|gohan|luffy|zoro|itachi|tanjiro|frieren|cowboy bebop|fullmetal)\b/i.test(
    text,
  );
}

function sleepMs(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function readDiskCache<T>(cachePath: string | undefined): Record<string, { savedAtMs: number; value: T }> {
  if (!cachePath || !existsSync(cachePath)) return {};
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<
      string,
      { savedAtMs: number; value: T }
    >;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeDiskCacheAtomic<T>(
  cachePath: string | undefined,
  data: Record<string, { savedAtMs: number; value: T }>,
): void {
  if (!cachePath) return;
  try {
    mkdirSync(dirname(cachePath), { recursive: true });
    const tmp = `${cachePath}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    renameSync(tmp, cachePath);
  } catch {
    // non-fatal disk cache failure
  }
}

export interface TraceMoeAdapterOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  cachePath?: string;
  cacheTtlMs?: number;
  minIntervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  allowAdult?: boolean;
}

interface TraceMoeApiResponse {
  frameCount?: number;
  error?: string;
  result?: Array<{
    anilist?:
      | number
      | {
          id?: number;
          idMal?: number | null;
          title?: {
            native?: string | null;
            romaji?: string | null;
            english?: string | null;
          };
          synonyms?: string[];
          isAdult?: boolean;
        };
    filename?: string;
    episode?: number | string | null;
    from?: number;
    to?: number;
    similarity?: number;
    video?: string;
    image?: string;
  }>;
}

export class TraceMoeProvenanceAdapter implements AnimeProvenanceAdapter {
  readonly id = 'trace_moe';
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly cachePath: string | undefined;
  private readonly cacheTtlMs: number;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly allowAdult: boolean;
  private readonly memoryCache = new Map<string, { savedAtMs: number; value: AnimeProvenanceResult }>();
  private lastRequestAtMs = 0;
  private rateLimitResetAtMs = 0;
  private rateLimitRemaining: number | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(options?: TraceMoeAdapterOptions) {
    this.baseUrl = (options?.baseUrl ?? 'https://api.trace.moe').replace(/\/+$/, '');
    this.apiKey = options?.apiKey;
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.cachePath = options?.cachePath;
    this.cacheTtlMs = options?.cacheTtlMs ?? 7 * 24 * 60 * 60 * 1000;
    this.minIntervalMs = Math.max(0, options?.minIntervalMs ?? 700);
    this.timeoutMs = Math.max(1_000, options?.timeoutMs ?? 12_000);
    this.maxRetries = Math.max(0, options?.maxRetries ?? 2);
    this.allowAdult = options?.allowAdult ?? false;

    const disk = readDiskCache<AnimeProvenanceResult>(this.cachePath);
    for (const [k, entry] of Object.entries(disk)) {
      this.memoryCache.set(k, entry);
    }
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async identifyFrame(input: {
    framePath?: string;
    frameBuffer?: Buffer;
    mimeType?: string;
    signal?: AbortSignal;
    minConfidence?: number;
    cutBorders?: boolean;
  }): Promise<AnimeProvenanceResult> {
    const buffer =
      input.frameBuffer ??
      (input.framePath && existsSync(input.framePath) ? readFileSync(input.framePath) : null);
    if (!buffer || buffer.length === 0) {
      return {
        status: 'unavailable',
        origin: this.id,
        frameSha256: '',
        matches: [],
        fromCache: false,
        error: 'frame_buffer_missing',
      };
    }

    const frameSha256 = createHash('sha256').update(buffer).digest('hex');
    const cutBorders = input.cutBorders ?? true;
    const minConfidence = input.minConfidence ?? 0.8;
    const cacheKey = `${frameSha256}:cut=${cutBorders ? 1 : 0}`;
    const now = Date.now();
    const cached = this.memoryCache.get(cacheKey);
    if (cached && now - cached.savedAtMs <= this.cacheTtlMs) {
      const filteredMatches = cached.value.matches.filter(
        (m) => m.confidence >= minConfidence && (this.allowAdult || !m.isAdult),
      );
      const taggedMatches = filteredMatches.map((m) => ({
        ...m,
        evidence: { ...m.evidence, fromCache: true },
      }));
      const { topMatch: _cachedTop, isAmbiguous: _amb, ambiguityReason: _ambR, ...cachedRest } = cached.value;
      const amb = evaluateTraceMoeAmbiguity(taggedMatches);
      return {
        ...cachedRest,
        status: taggedMatches.length > 0 ? 'ok' : cached.value.status === 'ok' ? 'no_match' : cached.value.status,
        matches: taggedMatches,
        ...(taggedMatches[0] ? { topMatch: taggedMatches[0] } : {}),
        isAmbiguous: amb.isAmbiguous,
        ...(amb.ambiguityReason ? { ambiguityReason: amb.ambiguityReason } : {}),
        fromCache: true,
      };
    }

    return this.enqueue(async () => {
      if (this.rateLimitRemaining !== null && this.rateLimitRemaining <= 0 && Date.now() < this.rateLimitResetAtMs) {
        return {
          status: 'rate_limited',
          origin: this.id,
          frameSha256,
          matches: [],
          fromCache: false,
          error: 'trace_moe_rate_limit_exhausted',
        };
      }

      const elapsedSinceLast = Date.now() - this.lastRequestAtMs;
      if (elapsedSinceLast < this.minIntervalMs) {
        try {
          await sleepMs(this.minIntervalMs - elapsedSinceLast, input.signal);
        } catch {
          return {
            status: 'unavailable',
            origin: this.id,
            frameSha256,
            matches: [],
            fromCache: false,
            error: 'aborted',
          };
        }
      }

      const queryParams = new URLSearchParams();
      queryParams.set('anilistInfo', '');
      if (cutBorders) queryParams.set('cutBorders', '');
      const url = `${this.baseUrl}/search?${queryParams.toString()}`;
      const mimeType = input.mimeType ?? 'image/jpeg';

      let lastErr = 'unknown_error';
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        if (input.signal?.aborted) {
          return {
            status: 'unavailable',
            origin: this.id,
            frameSha256,
            matches: [],
            fromCache: false,
            error: 'aborted',
          };
        }

        const reqCtrl = new AbortController();
        const timeoutTimer = setTimeout(() => reqCtrl.abort('timeout'), this.timeoutMs);
        const onParentAbort = () => reqCtrl.abort('aborted');
        input.signal?.addEventListener('abort', onParentAbort, { once: true });

        try {
          this.lastRequestAtMs = Date.now();
          const headers: Record<string, string> = {
            'Content-Type': mimeType,
            'User-Agent': 'AetheraStudio/0.1 (AnimeProvenanceAdapter)',
          };
          if (this.apiKey) headers['x-trace-key'] = this.apiKey;

          const res = await this.fetchImpl(url, {
            method: 'POST',
            headers,
            body: new Uint8Array(buffer),
            signal: reqCtrl.signal,
          });

          const remHeader = res.headers?.get?.('x-ratelimit-remaining');
          const resetHeader = res.headers?.get?.('x-ratelimit-reset');
          if (remHeader !== null && remHeader !== undefined) {
            const parsedRem = Number(remHeader);
            if (Number.isFinite(parsedRem)) this.rateLimitRemaining = parsedRem;
          }
          if (resetHeader !== null && resetHeader !== undefined) {
            const parsedReset = Number(resetHeader);
            if (Number.isFinite(parsedReset)) {
              this.rateLimitResetAtMs = parsedReset > 1_000_000_000_000 ? parsedReset : parsedReset * 1000;
            }
          }

          if (res.status === 429) {
            lastErr = 'http_429_rate_limited';
            const retryAfterSec = Number(res.headers?.get?.('retry-after') ?? '1');
            if (attempt < this.maxRetries) {
              await sleepMs(Math.min(5_000, Math.max(500, retryAfterSec * 1000)), input.signal);
              continue;
            }
            return {
              status: 'rate_limited',
              origin: this.id,
              frameSha256,
              matches: [],
              fromCache: false,
              error: lastErr,
            };
          }

          if (res.status >= 500) {
            lastErr = `http_${res.status}`;
            if (attempt < this.maxRetries) {
              await sleepMs(500 * (attempt + 1), input.signal);
              continue;
            }
            return {
              status: 'unavailable',
              origin: this.id,
              frameSha256,
              matches: [],
              fromCache: false,
              error: lastErr,
            };
          }

          if (!res.ok) {
            return {
              status: 'unavailable',
              origin: this.id,
              frameSha256,
              matches: [],
              fromCache: false,
              error: `http_${res.status}`,
            };
          }

          const payload = (await res.json()) as TraceMoeApiResponse;
          if (payload.error) {
            return {
              status: 'unavailable',
              origin: this.id,
              frameSha256,
              matches: [],
              fromCache: false,
              error: payload.error,
            };
          }

          const queriedAt = new Date().toISOString();
          const allMatches: AnimeProvenanceMatch[] = (payload.result ?? []).map((item) => {
            const anilistObj = typeof item.anilist === 'object' && item.anilist !== null ? item.anilist : undefined;
            const anilistId =
              typeof item.anilist === 'number' ? item.anilist : anilistObj?.id;
            const titles: AnimeWorkTitles = {
              ...(anilistObj?.title?.native ? { native: anilistObj.title.native } : {}),
              ...(anilistObj?.title?.romaji ? { romaji: anilistObj.title.romaji } : {}),
              ...(anilistObj?.title?.english ? { english: anilistObj.title.english } : {}),
              ...(anilistObj?.synonyms ? { synonyms: anilistObj.synonyms } : {}),
            };
            const workTitle =
              titles.english ??
              titles.romaji ??
              titles.native ??
              item.filename?.replace(/\.[^.]+$/, '') ??
              'Unknown Anime';
            return {
              origin: this.id,
              workTitle,
              titles,
              identifiers: {
                ...(anilistId !== undefined ? { anilistId } : {}),
                ...(anilistObj?.idMal ? { malId: anilistObj.idMal } : {}),
                ...(item.filename ? { filename: item.filename } : {}),
              },
              episode: item.episode ?? null,
              fromSec: Number((item.from ?? 0).toFixed(2)),
              toSec: Number((item.to ?? 0).toFixed(2)),
              confidence: Number((item.similarity ?? 0).toFixed(4)),
              ...(anilistObj?.isAdult !== undefined ? { isAdult: anilistObj.isAdult } : {}),
              evidence: {
                ...(item.video ? { previewVideoUrl: item.video } : {}),
                ...(item.image ? { previewImageUrl: item.image } : {}),
                frameSha256,
                queriedAt,
                fromCache: false,
              },
              provenanceOnly: true,
            };
          });

          const rawResult: AnimeProvenanceResult = {
            status: allMatches.length > 0 ? 'ok' : 'no_match',
            origin: this.id,
            frameSha256,
            matches: allMatches,
            ...(allMatches[0] ? { topMatch: allMatches[0] } : {}),
            fromCache: false,
          };

          this.memoryCache.set(cacheKey, { savedAtMs: Date.now(), value: rawResult });
          writeDiskCacheAtomic(this.cachePath, Object.fromEntries(this.memoryCache.entries()));

          const filtered = allMatches.filter(
            (m) => m.confidence >= minConfidence && (this.allowAdult || !m.isAdult),
          );
          const amb = evaluateTraceMoeAmbiguity(filtered);
          return {
            status: filtered.length > 0 ? 'ok' : 'no_match',
            origin: this.id,
            frameSha256,
            matches: filtered,
            ...(filtered[0] ? { topMatch: filtered[0] } : {}),
            isAmbiguous: amb.isAmbiguous,
            ...(amb.ambiguityReason ? { ambiguityReason: amb.ambiguityReason } : {}),
            fromCache: false,
          };
        } catch (err) {
          lastErr = err instanceof Error ? err.message : String(err);
          if (attempt < this.maxRetries && !input.signal?.aborted) {
            await sleepMs(500 * (attempt + 1), input.signal).catch(() => undefined);
            continue;
          }
        } finally {
          clearTimeout(timeoutTimer);
          input.signal?.removeEventListener('abort', onParentAbort);
        }
      }

      return {
        status: 'unavailable',
        origin: this.id,
        frameSha256,
        matches: [],
        fromCache: false,
        error: lastErr,
      };
    });
  }
}

export interface SakugabooruAdapterOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  cachePath?: string;
  cacheTtlMs?: number;
  minIntervalMs?: number;
  timeoutMs?: number;
  maxRetries?: number;
  userAgent?: string;
}

interface SakugabooruPost {
  id: number;
  tags?: string;
  source?: string;
  author?: string;
  score?: number;
  md5?: string;
  file_size?: number;
  file_ext?: string;
  file_url?: string;
  preview_url?: string;
  sample_url?: string;
  rating?: string;
  width?: number;
  height?: number;
  status?: string;
}

export class SakugabooruSourceAdapter implements AnimeMediaSourceAdapter {
  readonly id = 'sakugabooru';
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly cachePath: string | undefined;
  private readonly cacheTtlMs: number;
  private readonly minIntervalMs: number;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly userAgent: string;
  private readonly memoryCache = new Map<string, { savedAtMs: number; value: AnimeMediaSearchResult }>();
  private lastRequestAtMs = 0;

  constructor(options?: SakugabooruAdapterOptions) {
    this.baseUrl = (options?.baseUrl ?? 'https://www.sakugabooru.com').replace(/\/+$/, '');
    this.fetchImpl = options?.fetchImpl ?? fetch;
    this.cachePath = options?.cachePath;
    this.cacheTtlMs = options?.cacheTtlMs ?? 6 * 60 * 60 * 1000;
    this.minIntervalMs = Math.max(0, options?.minIntervalMs ?? 1_000);
    this.timeoutMs = Math.max(1_000, options?.timeoutMs ?? 12_000);
    this.maxRetries = Math.max(0, options?.maxRetries ?? 1);
    this.userAgent = options?.userAgent ?? 'AetheraStudio/0.1 (SakugabooruSourceAdapter)';

    const disk = readDiskCache<AnimeMediaSearchResult>(this.cachePath);
    for (const [k, entry] of Object.entries(disk)) {
      this.memoryCache.set(k, entry);
    }
  }

  static normalizeTags(query: string, explicitTags?: string[], safeOnly = true): string[] {
    if (explicitTags && explicitTags.length > 0) {
      const normalized = explicitTags
        .map((t) =>
          t
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9:_ ]+/g, ' ')
            .trim()
            .replace(/\s+/g, '_'),
        )
        .filter((t) => t.length >= 2);
      if (safeOnly && !normalized.some((t) => t.startsWith('rating:'))) {
        normalized.push('rating:s');
      }
      return [...new Set(normalized)].slice(0, 6);
    }

    const clean = query
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9:_ ]+/g, ' ')
      .trim();

    const KNOWN_SERIES_TAGS: Array<[RegExp, string]> = [
      [/\bdragon[\s_]+ball[\s_]+z\b/i, 'dragon_ball_z'],
      [/\bdragon[\s_]+ball[\s_]+super\b/i, 'dragon_ball_super'],
      [/\bdragon[\s_]+ball\b/i, 'dragon_ball_series'],
      [/\battack[\s_]+on[\s_]+titan\b|\bshingeki\b/i, 'attack_on_titan'],
      [/\bdemon[\s_]+slayer\b|\bkimetsu\b/i, 'kimetsu_no_yaiba'],
      [/\bjujutsu[\s_]+kaisen\b/i, 'jujutsu_kaisen'],
      [/\bone[\s_]+piece\b/i, 'one_piece'],
      [/\bchainsaw[\s_]+man\b/i, 'chainsaw_man'],
      [/\bmy[\s_]+hero[\s_]+academia\b|\bboku[\s_]+no[\s_]+hero\b/i, 'boku_no_hero_academia'],
      [/\bfullmetal[\s_]+alchemist\b/i, 'fullmetal_alchemist'],
      [/\bcowboy[\s_]+bebop\b/i, 'cowboy_bebop'],
      [/\bnaruto\b/i, 'naruto'],
      [/\bbleach\b/i, 'bleach'],
      [/\bevangelion\b/i, 'evangelion'],
    ];

    const out: string[] = [];
    for (const [re, tag] of KNOWN_SERIES_TAGS) {
      if (re.test(clean)) {
        out.push(tag);
        break;
      }
    }

    const KNOWN_SAKUGA_ACTION_TAGS = [
      'fighting',
      'beams',
      'explosions',
      'lightning',
      'impact_frames',
      'hair',
      'fire',
      'debris',
      'smears',
    ];
    for (const actTag of KNOWN_SAKUGA_ACTION_TAGS) {
      if (new RegExp(`\\b${actTag}\\b`, 'i').test(clean)) {
        out.push(actTag);
        break;
      }
    }

    if (out.length === 0) {
      const tokens = clean.split(/\s+/).filter((t) => t.length >= 3 && !/^(anime|scene|cena|clip|fight|luta|the|and|with|for)$/.test(t));
      if (tokens.length > 0) out.push(tokens.slice(0, 2).join('_'));
    }

    if (safeOnly && !out.some((t) => t.startsWith('rating:'))) {
      out.push('rating:s');
    }
    return [...new Set(out)].slice(0, 6);
  }

  async searchClips(input: {
    query: string;
    tags?: string[];
    limit?: number;
    safeOnly?: boolean;
    signal?: AbortSignal;
  }): Promise<AnimeMediaSearchResult> {
    const safeOnly = input.safeOnly ?? true;
    const limit = Math.max(1, Math.min(20, input.limit ?? 8));
    const tags = SakugabooruSourceAdapter.normalizeTags(input.query, input.tags, safeOnly);
    if (tags.length === 0) {
      return { status: 'empty', origin: this.id, candidates: [], fromCache: false };
    }

    const cacheKey = `${tags.join('+')}:${limit}`;
    const cached = this.memoryCache.get(cacheKey);
    if (cached && Date.now() - cached.savedAtMs <= this.cacheTtlMs) {
      return { ...cached.value, fromCache: true };
    }

    const elapsed = Date.now() - this.lastRequestAtMs;
    if (elapsed < this.minIntervalMs) {
      await sleepMs(this.minIntervalMs - elapsed, input.signal).catch(() => undefined);
    }

    const url = `${this.baseUrl}/post.json?limit=${limit}&tags=${encodeURIComponent(tags.join(' '))}`;
    let lastErr = 'unknown_error';
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (input.signal?.aborted) {
        return { status: 'unavailable', origin: this.id, candidates: [], fromCache: false, error: 'aborted' };
      }

      const reqCtrl = new AbortController();
      const timer = setTimeout(() => reqCtrl.abort('timeout'), this.timeoutMs);
      const onParentAbort = () => reqCtrl.abort('aborted');
      input.signal?.addEventListener('abort', onParentAbort, { once: true });

      try {
        this.lastRequestAtMs = Date.now();
        const res = await this.fetchImpl(url, {
          headers: {
            'User-Agent': this.userAgent,
            Accept: 'application/json',
          },
          signal: reqCtrl.signal,
        });

        if (res.status === 429) {
          lastErr = 'http_429_rate_limited';
          if (attempt < this.maxRetries) {
            await sleepMs(1500, input.signal).catch(() => undefined);
            continue;
          }
          return { status: 'rate_limited', origin: this.id, candidates: [], fromCache: false, error: lastErr };
        }
        if (!res.ok) {
          lastErr = `http_${res.status}`;
          if (res.status >= 500 && attempt < this.maxRetries) {
            await sleepMs(800, input.signal).catch(() => undefined);
            continue;
          }
          return { status: 'unavailable', origin: this.id, candidates: [], fromCache: false, error: lastErr };
        }

        const posts = (await res.json()) as SakugabooruPost[];
        if (!Array.isArray(posts)) {
          return { status: 'unavailable', origin: this.id, candidates: [], fromCache: false, error: 'invalid_json' };
        }

        const candidates: AnimeMediaSourceCandidate[] = posts
          .filter((p) => {
            if (!p.file_url || p.status === 'deleted') return false;
            if (safeOnly && p.rating && p.rating !== 's') return false;
            const ext = (p.file_ext ?? '').toLowerCase();
            return ext === 'mp4' || ext === 'webm' || ext === 'gif' || ext === 'png' || ext === 'jpg';
          })
          .map((p) => {
            const tagList = (p.tags ?? '').split(/\s+/).filter(Boolean);
            const postUrl = `${this.baseUrl}/post/show/${p.id}`;
            return {
              id: p.id,
              origin: this.id,
              title: `Sakugabooru #${p.id}: ${tagList.slice(0, 6).join(', ')}`,
              url: p.file_url!,
              postUrl,
              ...(p.preview_url ? { previewUrl: p.preview_url } : {}),
              tags: tagList,
              rating: p.rating ?? 's',
              fileExt: (p.file_ext ?? 'mp4').toLowerCase(),
              ...(p.file_size !== undefined ? { fileSizeBytes: p.file_size } : {}),
              ...(p.md5 ? { md5: p.md5 } : {}),
              ...(p.width !== undefined ? { width: p.width } : {}),
              ...(p.height !== undefined ? { height: p.height } : {}),
              ...(p.score !== undefined ? { score: p.score } : {}),
              ...(p.source ? { source: p.source } : {}),
              ...(p.author ? { author: p.author } : {}),
              usageNotice: 'sakugabooru_reference_requires_editorial_review',
            };
          });

        const result: AnimeMediaSearchResult = {
          status: candidates.length > 0 ? 'ok' : 'empty',
          origin: this.id,
          candidates,
          fromCache: false,
        };
        this.memoryCache.set(cacheKey, { savedAtMs: Date.now(), value: result });
        writeDiskCacheAtomic(this.cachePath, Object.fromEntries(this.memoryCache.entries()));
        return result;
      } catch (err) {
        lastErr = err instanceof Error ? err.message : String(err);
        if (attempt < this.maxRetries && !input.signal?.aborted) {
          await sleepMs(700, input.signal).catch(() => undefined);
          continue;
        }
      } finally {
        clearTimeout(timer);
        input.signal?.removeEventListener('abort', onParentAbort);
      }
    }

    return { status: 'unavailable', origin: this.id, candidates: [], fromCache: false, error: lastErr };
  }
}
