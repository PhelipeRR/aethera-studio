import { describe, expect, it } from 'vitest';
import { GameSourceError, IgdbClient, igdbObservation, pickExactGame, RateLimiter, RawgClient, type HttpPort, type IgdbGame } from '../src/aethera/game-sources.js';
import { SYNTHETIC_IGDB_GAMES, SYNTHETIC_RAWG_SEARCH, SYNTHETIC_TOKEN } from './fixtures/igdb-synthetic.js';

type Call = { url: string; method: string; headers: Record<string, string>; body?: string };
type Reply = { status: number; body?: unknown; headers?: Record<string, string> } | Error;

/** Replays scripted replies in order and records every request. */
function scriptedHttp(replies: Reply[]): HttpPort & { calls: Call[] } {
  const calls: Call[] = [];
  const port = async (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => {
    calls.push({ url, method: init.method, headers: init.headers, ...(init.body !== undefined ? { body: init.body } : {}) });
    const reply = replies.shift();
    if (!reply) throw new Error('no scripted reply');
    if (reply instanceof Error) throw reply;
    return { status: reply.status, headers: { get: (name: string) => reply.headers?.[name.toLowerCase()] ?? null }, text: async () => JSON.stringify(reply.body ?? null) };
  };
  return Object.assign(port, { calls });
}
const credentials = () => ({ clientId: 'synthetic-client', clientSecret: 'synthetic-secret' });
const instant = { now: () => 0, sleep: async () => undefined };

describe('IGDB client', () => {
  it('gets a Twitch app token once and sends the documented headers', async () => {
    const http = scriptedHttp([{ status: 200, body: SYNTHETIC_TOKEN }, { status: 200, body: SYNTHETIC_IGDB_GAMES }, { status: 200, body: [] }]);
    const client = new IgdbClient({ credentials, http, ...instant });
    const games = await client.searchGames('Fixture Quest');
    await client.searchGames('Outro');
    expect(games.map((game) => game.id)).toEqual([900001, 900002, 900003]);
    expect(http.calls[0]).toMatchObject({ method: 'POST', url: 'https://id.twitch.tv/oauth2/token?client_id=synthetic-client&client_secret=synthetic-secret&grant_type=client_credentials' });
    expect(http.calls[1]).toMatchObject({ method: 'POST', url: 'https://api.igdb.com/v4/games', headers: { 'Client-ID': 'synthetic-client', Authorization: 'Bearer synthetic-access-token' } });
    expect(http.calls[1]?.body).toContain('search "Fixture Quest";');
    expect(http.calls.filter((call) => call.url.startsWith('https://id.twitch.tv'))).toHaveLength(1);
  });

  it('escapes quotes so a title cannot change the query', async () => {
    const http = scriptedHttp([{ status: 200, body: SYNTHETIC_TOKEN }, { status: 200, body: [] }]);
    await new IgdbClient({ credentials, http, ...instant }).searchGames('Evil"; fields *; where id > 0; "');
    expect(http.calls[1]?.body).toContain('search "Evil\\"; fields *; where id > 0; \\"";');
  });

  it('fails with guidance when no credentials are configured, without calling the network', async () => {
    const http = scriptedHttp([]);
    await expect(new IgdbClient({ credentials: () => null, http, ...instant }).searchGames('x')).rejects.toMatchObject({ code: 'auth_required', retryable: false });
    expect(http.calls).toHaveLength(0);
  });

  it('reports refused credentials as auth_failed', async () => {
    const http = scriptedHttp([{ status: 400, body: { status: 400, message: 'invalid client secret' } }]);
    await expect(new IgdbClient({ credentials, http, ...instant }).searchGames('x')).rejects.toMatchObject({ code: 'auth_failed', retryable: false });
  });

  it('renews an expired token once on 401', async () => {
    const http = scriptedHttp([{ status: 200, body: SYNTHETIC_TOKEN }, { status: 401 }, { status: 200, body: SYNTHETIC_TOKEN }, { status: 200, body: [] }]);
    await expect(new IgdbClient({ credentials, http, ...instant }).searchGames('x')).resolves.toEqual([]);
    expect(http.calls.filter((call) => call.url.startsWith('https://id.twitch.tv'))).toHaveLength(2);
  });

  it('backs off on 429 using Retry-After and gives up as rate_limited', async () => {
    const waits: number[] = [];
    const http = scriptedHttp([{ status: 200, body: SYNTHETIC_TOKEN }, { status: 429, headers: { 'retry-after': '2' } }, { status: 200, body: [] }]);
    await new IgdbClient({ credentials, http, now: () => 0, sleep: async (ms) => { waits.push(ms); } }).searchGames('x');
    expect(waits).toContain(2_000);
    const always429 = scriptedHttp([{ status: 200, body: SYNTHETIC_TOKEN }, { status: 429 }, { status: 429 }, { status: 429 }, { status: 429 }]);
    await expect(new IgdbClient({ credentials, http: always429, ...instant }).searchGames('x')).rejects.toMatchObject({ code: 'rate_limited', retryable: true });
  });

  it('turns network errors and 5xx into a retryable unavailable error', async () => {
    const http = scriptedHttp([{ status: 200, body: SYNTHETIC_TOKEN }, new Error('ECONNRESET'), { status: 503 }, { status: 502 }]);
    const error = await new IgdbClient({ credentials, http, ...instant }).searchGames('x').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(GameSourceError);
    expect(error).toMatchObject({ code: 'unavailable', retryable: true });
  });

  it('rejects a response that is not a list of games', async () => {
    const http = scriptedHttp([{ status: 200, body: SYNTHETIC_TOKEN }, { status: 200, body: { unexpected: true } }]);
    await expect(new IgdbClient({ credentials, http, ...instant }).searchGames('x')).rejects.toMatchObject({ code: 'invalid_response' });
  });

  it('lists main games released in a period, excluding expansions and editions', async () => {
    const http = scriptedHttp([{ status: 200, body: SYNTHETIC_TOKEN }, { status: 200, body: [SYNTHETIC_IGDB_GAMES[0]] }]);
    await new IgdbClient({ credentials, http, ...instant }).gamesReleasedBetween('2027-01-01', '2027-02-01', 10);
    expect(http.calls[1]?.body).toContain(`where first_release_date >= ${Date.UTC(2027, 0, 1) / 1_000} & first_release_date < ${Date.UTC(2027, 1, 1) / 1_000} & parent_game = null & version_parent = null;`);
    expect(http.calls[1]?.body).toContain('limit 10;');
  });
});

describe('IGDB game videos', () => {
  it('lists the YouTube ids IGDB links to a game and rejects malformed ids', async () => {
    const http = scriptedHttp([{ status: 200, body: SYNTHETIC_TOKEN }, { status: 200, body: [{ id: 1, name: 'Trailer', video_id: 'synthVideo1' }] }, { status: 200, body: [{ id: 2, video_id: 'bad id; drop' }] }]);
    const client = new IgdbClient({ credentials, http, ...instant });
    expect(await client.gameVideos(900001)).toEqual([{ name: 'Trailer', videoId: 'synthVideo1' }]);
    expect(http.calls[1]).toMatchObject({ url: 'https://api.igdb.com/v4/game_videos', body: 'fields name,video_id; where game = 900001; limit 50;' });
    await expect(client.gameVideos(900002)).rejects.toMatchObject({ code: 'invalid_response' });
    expect(await client.gameVideos(-1)).toEqual([]);
  });
});

describe('IGDB data mapping', () => {
  it('picks only an exact title or alias match, never the expansion', () => {
    expect(pickExactGame('Fixture Quest', [...SYNTHETIC_IGDB_GAMES])?.id).toBe(900001);
    expect(pickExactGame('fq', [...SYNTHETIC_IGDB_GAMES])?.id).toBe(900001);
    expect(pickExactGame('Fixture Quest Remastered', [...SYNTHETIC_IGDB_GAMES])).toBeNull();
  });

  it('maps the release date with its real precision, platforms and companies', () => {
    const exact = igdbObservation(SYNTHETIC_IGDB_GAMES[0] as IgdbGame, '2026-11-10T12:00:00.000Z');
    expect(exact.observation).toMatchObject({ source: 'igdb', ref: '900001', releaseDate: '2027-01-15', platforms: ['PC (Microsoft Windows)', 'PlayStation 5'], status: 'ok' });
    expect(exact.companies).toEqual(['Fixture Studio', 'Fixture Publishing']);
    expect(exact.officialWebsites).toEqual(['https://fixture-quest.example/']);
    expect(exact.referenceImages).toEqual(['synthshot1', 'syntharte1']);
    expect(igdbObservation(SYNTHETIC_IGDB_GAMES[2] as IgdbGame, '2026-11-10T12:00:00.000Z').observation.releaseDate).toBe('2027');
    expect(igdbObservation({ id: 1, name: 'Sem data' }, '2026-11-10T12:00:00.000Z').observation.releaseDate).toBeNull();
  });
});

describe('RAWG client', () => {
  it('is optional and maps a precise search result', async () => {
    const http = scriptedHttp([{ status: 200, body: SYNTHETIC_RAWG_SEARCH }]);
    const client = new RawgClient({ apiKey: () => 'synthetic-key', http, ...instant });
    const observation = await client.findExact('Fixture Quest', '2026-11-10T12:00:00.000Z');
    expect(observation).toMatchObject({ source: 'rawg', ref: '700001', releaseDate: '2027-01-15', platforms: ['PC'] });
    expect(http.calls[0]?.url).toContain('https://api.rawg.io/api/games?');
    expect(http.calls[0]?.url).toContain('search_precise=true');
    expect(await new RawgClient({ apiKey: () => null, http: scriptedHttp([]), ...instant }).findExact('x', 'now')).toBeNull();
  });
});

describe('RateLimiter', () => {
  it('never starts more than the allowed requests per second', async () => {
    let clock = 0;
    const starts: number[] = [];
    const limiter = new RateLimiter({ perSecond: 4, maxOpen: 8, now: () => clock, sleep: async (ms) => { clock += ms; } });
    await Promise.all(Array.from({ length: 9 }, () => limiter.run(async () => { starts.push(clock); })));
    for (let index = 4; index < starts.length; index += 1) expect((starts[index] ?? 0) - (starts[index - 4] ?? 0)).toBeGreaterThanOrEqual(1_000);
  });
});
