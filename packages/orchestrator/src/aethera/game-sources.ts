import { gameSourceObservationSchema, normalizeGameTitle, type GameSourceObservation } from '@neuralbridge/shared';
import { z } from 'zod';

/**
 * Game data sources of AS-03 (D-AS-1): IGDB as the structured primary source, RAWG as an optional second one. Both go
 * through an injectable HTTP port, so tests replay scripted replies and nothing here invents data.
 */

export type HttpPort = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; headers: { get(name: string): string | null }; text(): Promise<string> }>;

export const fetchHttp: HttpPort = async (url, init) => {
  const response = await fetch(url, { method: init.method, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}), ...(init.signal ? { signal: init.signal } : {}) });
  return { status: response.status, headers: response.headers, text: () => response.text() };
};

export type GameSourceErrorCode = 'auth_required' | 'auth_failed' | 'rate_limited' | 'unavailable' | 'invalid_response' | 'cancelled';
export class GameSourceError extends Error {
  constructor(readonly code: GameSourceErrorCode, message: string, readonly retryable: boolean, options?: { cause?: unknown }) {
    super(`${code}: ${message}`, options);
    this.name = 'GameSourceError';
  }
}

type Clock = { now?: () => number; sleep?: (ms: number) => Promise<void> };
const realSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const MAX_ATTEMPTS = 3;

/** IGDB allows 4 requests per second and 8 open requests; every call waits for its turn here. */
export class RateLimiter {
  private readonly starts: number[] = [];
  private open = 0;
  private chain: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly limits: { perSecond: number; maxOpen: number } & Clock) {
    this.now = limits.now ?? Date.now;
    this.sleep = limits.sleep ?? realSleep;
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    const turn = this.chain.then(async () => {
      for (;;) {
        const time = this.now();
        while (this.starts.length && time - (this.starts[0] as number) >= 1_000) this.starts.shift();
        if (this.starts.length < this.limits.perSecond && this.open < this.limits.maxOpen) { this.starts.push(time); this.open += 1; return; }
        await this.sleep(this.starts.length >= this.limits.perSecond ? Math.max(1, 1_000 - (time - (this.starts[0] as number))) : 25);
      }
    });
    this.chain = turn.catch(() => undefined);
    await turn;
    try { return await work(); } finally { this.open -= 1; }
  }
}

// IGDB --------------------------------------------------------------------------------------------------------------

const igdbGameSchema = z.object({
  id: z.number().int(), name: z.string(), slug: z.string().optional(), url: z.string().optional(),
  alternative_names: z.array(z.object({ name: z.string() })).optional(),
  first_release_date: z.number().optional(),
  release_dates: z.array(z.object({ date: z.number().optional(), y: z.number().optional(), m: z.number().optional(), d: z.number().optional(), date_format: z.union([z.number(), z.object({ format: z.string().optional() })]).optional() })).optional(),
  platforms: z.array(z.object({ name: z.string() })).optional(),
  involved_companies: z.array(z.object({ company: z.object({ name: z.string() }).optional(), developer: z.boolean().optional(), publisher: z.boolean().optional() })).optional(),
  websites: z.array(z.object({ url: z.string() })).optional(),
  screenshots: z.array(z.object({ image_id: z.string() })).optional(),
  artworks: z.array(z.object({ image_id: z.string() })).optional(),
  parent_game: z.number().optional(),
  version_parent: z.number().optional(),
});
export type IgdbGame = z.infer<typeof igdbGameSchema>;

const GAME_FIELDS = 'fields name,slug,url,alternative_names.name,first_release_date,release_dates.date,release_dates.y,release_dates.m,release_dates.d,release_dates.date_format.format,platforms.name,involved_companies.company.name,involved_companies.developer,involved_companies.publisher,websites.url,screenshots.image_id,artworks.image_id,parent_game,version_parent;';
const quote = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
const unix = (isoDate: string) => Math.floor(Date.parse(`${isoDate}T00:00:00.000Z`) / 1_000);

export interface IgdbCredentials { clientId: string; clientSecret: string }

export class IgdbClient {
  private token: { value: string; expiresAt: number } | null = null;
  private readonly limiter: RateLimiter;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: { credentials: () => IgdbCredentials | null; http?: HttpPort } & Clock) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
    this.limiter = new RateLimiter({ perSecond: 4, maxOpen: 8, now: this.now, sleep: this.sleep });
  }

  async searchGames(title: string, signal?: AbortSignal): Promise<IgdbGame[]> {
    return this.games(`${GAME_FIELDS} search ${quote(title.trim())}; limit 20;`, signal);
  }

  /** Main games (no expansions, editions or ports) first released in [from, to), most anticipated first. */
  async gamesReleasedBetween(fromIsoDate: string, toIsoDate: string, limit: number, signal?: AbortSignal): Promise<IgdbGame[]> {
    const count = Math.max(1, Math.min(500, Math.floor(limit)));
    return this.games(`${GAME_FIELDS} where first_release_date >= ${unix(fromIsoDate)} & first_release_date < ${unix(toIsoDate)} & parent_game = null & version_parent = null; sort hypes desc; limit ${count};`, signal);
  }

  /** Videos IGDB links to a game: YouTube ids with a name such as "Trailer" or "Gameplay". */
  async gameVideos(gameId: number, signal?: AbortSignal): Promise<Array<{ name: string; videoId: string }>> {
    if (!Number.isInteger(gameId) || gameId <= 0) return [];
    const parsed = z.array(z.object({ name: z.string().optional(), video_id: z.string().regex(/^[A-Za-z0-9_-]{6,20}$/) })).safeParse(await this.query('game_videos', `fields name,video_id; where game = ${gameId}; limit 50;`, signal));
    if (!parsed.success) throw new GameSourceError('invalid_response', 'o IGDB devolveu vídeos em formato inesperado.', false);
    return parsed.data.map((video) => ({ name: video.name ?? '', videoId: video.video_id }));
  }

  private async games(body: string, signal?: AbortSignal): Promise<IgdbGame[]> {
    const parsed = z.array(igdbGameSchema).safeParse(await this.query('games', body, signal));
    if (!parsed.success) throw new GameSourceError('invalid_response', 'o IGDB devolveu um formato inesperado.', false);
    return parsed.data;
  }

  private async query(endpoint: string, body: string, signal?: AbortSignal): Promise<unknown> {
    const credentials = this.options.credentials();
    if (!credentials) throw new GameSourceError('auth_required', 'configure o Client ID e o Client Secret do IGDB (app do Twitch Developers) no Aethera Studio.', false);
    let renewed = false;
    for (let attempt = 1; ; attempt += 1) {
      if (signal?.aborted) throw new GameSourceError('cancelled', 'consulta interrompida.', false);
      const token = await this.accessToken(credentials, signal);
      let response: Awaited<ReturnType<HttpPort>>;
      try {
        response = await this.limiter.run(() => this.http()(`https://api.igdb.com/v4/${endpoint}`, { method: 'POST', headers: { 'Client-ID': credentials.clientId, Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'text/plain' }, body, ...(signal ? { signal } : {}) }));
      } catch (error) {
        if (signal?.aborted) throw new GameSourceError('cancelled', 'consulta interrompida.', false, { cause: error });
        if (attempt >= MAX_ATTEMPTS) throw new GameSourceError('unavailable', `IGDB inacessível: ${error instanceof Error ? error.message : String(error)}`, true, { cause: error });
        await this.sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      if (response.status === 401 && !renewed) { renewed = true; this.token = null; continue; }
      if (response.status === 401 || response.status === 403) throw new GameSourceError('auth_failed', 'o IGDB recusou as credenciais.', false);
      if (response.status === 429) {
        if (attempt >= MAX_ATTEMPTS) throw new GameSourceError('rate_limited', 'limite de requisições do IGDB atingido; tente de novo em instantes.', true);
        const retryAfter = Number(response.headers.get('retry-after'));
        await this.sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1_000 : 1_000 * attempt);
        continue;
      }
      if (response.status >= 500) {
        if (attempt >= MAX_ATTEMPTS) throw new GameSourceError('unavailable', `IGDB indisponível (HTTP ${response.status}).`, true);
        await this.sleep(500 * 2 ** (attempt - 1));
        continue;
      }
      if (response.status !== 200) throw new GameSourceError('invalid_response', `IGDB respondeu HTTP ${response.status}.`, false);
      try { return JSON.parse(await response.text()) as unknown; } catch (error) { throw new GameSourceError('invalid_response', 'resposta do IGDB não é JSON.', false, { cause: error }); }
    }
  }

  private async accessToken(credentials: IgdbCredentials, signal?: AbortSignal): Promise<string> {
    if (this.token && this.token.expiresAt - 60_000 > this.now()) return this.token.value;
    const url = `https://id.twitch.tv/oauth2/token?client_id=${encodeURIComponent(credentials.clientId)}&client_secret=${encodeURIComponent(credentials.clientSecret)}&grant_type=client_credentials`;
    let response: Awaited<ReturnType<HttpPort>>;
    try {
      response = await this.http()(url, { method: 'POST', headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) });
    } catch (error) {
      throw new GameSourceError('unavailable', `Twitch inacessível para autenticar no IGDB: ${error instanceof Error ? error.message : String(error)}`, true, { cause: error });
    }
    if (response.status === 400 || response.status === 401 || response.status === 403) throw new GameSourceError('auth_failed', 'o Twitch recusou o Client ID ou o Client Secret do IGDB.', false);
    if (response.status !== 200) throw new GameSourceError('unavailable', `autenticação do Twitch respondeu HTTP ${response.status}.`, true);
    const parsed = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() }).safeParse(JSON.parse(await response.text()));
    if (!parsed.success) throw new GameSourceError('invalid_response', 'token do Twitch em formato inesperado.', false);
    this.token = { value: parsed.data.access_token, expiresAt: this.now() + parsed.data.expires_in * 1_000 };
    return this.token.value;
  }

  private http(): HttpPort { return this.options.http ?? fetchHttp; }
}

/** The game whose name or alternative name is exactly the requested title; DLCs, editions and near misses never match. */
export function pickExactGame(title: string, games: readonly IgdbGame[]): IgdbGame | null {
  const wanted = normalizeGameTitle(title);
  const exact = games.filter((game) => game.parent_game === undefined && game.version_parent === undefined && [game.name, ...(game.alternative_names ?? []).map((alias) => alias.name)].some((name) => normalizeGameTitle(name) === wanted));
  return exact.find((game) => normalizeGameTitle(game.name) === wanted) ?? exact[0] ?? null;
}

const pad = (value: number) => String(value).padStart(2, '0');
function igdbReleaseDate(game: IgdbGame): string | null {
  if (game.first_release_date === undefined) return null;
  const first = new Date(game.first_release_date * 1_000);
  const entry = (game.release_dates ?? []).find((item) => item.date === game.first_release_date);
  const format = entry && typeof entry.date_format === 'object' ? entry.date_format.format : undefined;
  const year = first.getUTCFullYear();
  if (format === 'TBD') return null;
  if (format === 'YYYY' || (format?.startsWith('YYYYQ') ?? false) || (entry && entry.y !== undefined && entry.m === undefined)) return String(year);
  if (format === 'YYYYMMMM' || (entry && entry.m !== undefined && entry.d === undefined)) return `${year}-${pad(first.getUTCMonth() + 1)}`;
  return `${year}-${pad(first.getUTCMonth() + 1)}-${pad(first.getUTCDate())}`;
}

export function igdbObservation(game: IgdbGame, retrievedAt: string): { observation: GameSourceObservation; aliases: string[]; companies: string[]; officialWebsites: string[]; referenceImages: string[] } {
  return {
    observation: gameSourceObservationSchema.parse({ schemaVersion: 1, source: 'igdb', ref: String(game.id), title: game.name, releaseDate: igdbReleaseDate(game), platforms: (game.platforms ?? []).map((platform) => platform.name), retrievedAt, status: 'ok', ...(game.url ? { note: game.url } : {}) }),
    aliases: (game.alternative_names ?? []).map((alias) => alias.name),
    companies: [...new Set((game.involved_companies ?? []).flatMap((item) => (item.company ? [item.company.name] : [])))],
    officialWebsites: (game.websites ?? []).map((site) => site.url).filter((url) => /^https:\/\//i.test(url)),
    referenceImages: [...(game.screenshots ?? []), ...(game.artworks ?? [])].map((image) => image.image_id),
  };
}

// RAWG --------------------------------------------------------------------------------------------------------------

const rawgSearchSchema = z.object({ results: z.array(z.object({ id: z.number().int(), name: z.string(), released: z.string().nullable().optional(), tba: z.boolean().optional(), platforms: z.array(z.object({ platform: z.object({ name: z.string() }) })).nullable().optional() })) });

/** Optional second source: without a key it stays silent instead of failing the research. */
export class RawgClient {
  private readonly limiter: RateLimiter;
  constructor(private readonly options: { apiKey: () => string | null; http?: HttpPort } & Clock) {
    this.limiter = new RateLimiter({ perSecond: 4, maxOpen: 4, ...(options.now ? { now: options.now } : {}), ...(options.sleep ? { sleep: options.sleep } : {}) });
  }

  configured(): boolean { return Boolean(this.options.apiKey()); }

  async findExact(title: string, retrievedAt: string, signal?: AbortSignal): Promise<GameSourceObservation | null> {
    const key = this.options.apiKey();
    if (!key) return null;
    const url = `https://api.rawg.io/api/games?${new URLSearchParams({ key, search: title.trim(), search_precise: 'true', page_size: '10' }).toString()}`;
    let response: Awaited<ReturnType<HttpPort>>;
    try {
      response = await this.limiter.run(() => (this.options.http ?? fetchHttp)(url, { method: 'GET', headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) }));
    } catch (error) {
      throw new GameSourceError('unavailable', `RAWG inacessível: ${error instanceof Error ? error.message : String(error)}`, true, { cause: error });
    }
    if (response.status === 401 || response.status === 403) throw new GameSourceError('auth_failed', 'o RAWG recusou a chave.', false);
    if (response.status === 429) throw new GameSourceError('rate_limited', 'limite do RAWG atingido.', true);
    if (response.status !== 200) throw new GameSourceError('unavailable', `RAWG respondeu HTTP ${response.status}.`, response.status >= 500);
    const parsed = rawgSearchSchema.safeParse(JSON.parse(await response.text()));
    if (!parsed.success) throw new GameSourceError('invalid_response', 'resposta do RAWG em formato inesperado.', false);
    const game = parsed.data.results.find((item) => normalizeGameTitle(item.name) === normalizeGameTitle(title));
    if (!game) return null;
    return gameSourceObservationSchema.parse({ schemaVersion: 1, source: 'rawg', ref: String(game.id), title: game.name, releaseDate: game.tba ? null : (game.released ?? null), platforms: (game.platforms ?? []).map((item) => item.platform.name), retrievedAt, status: 'ok' });
  }
}
