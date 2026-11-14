import { z } from 'zod';
import type { VelixMediaReference } from '@neuralbridge/workspace';

export type DiscoveryFetch = (url: string, init?: RequestInit) => Promise<Response>;
type Result = { status: 'ok' | 'unavailable' | 'offline' | 'error' | 'rate_limited' | 'cancelled'; results: VelixMediaReference[]; reason: string | null; nextPageToken?: string | null };
export type VelixDiscoveryFilters = { subtopic?: string | undefined; keywords?: string | undefined; platform?: 'youtube' | 'shorts' | undefined; duration?: 'any' | 'short' | 'medium' | 'long' | undefined; style?: string | undefined; audience?: string | undefined; periodDays?: number | undefined; rightsPolicy?: 'reference' | 'creative_commons' | undefined };

const terms = (filters: VelixDiscoveryFilters | undefined) => [filters?.subtopic, filters?.keywords].flatMap((value) => value?.trim() ? [value.trim()] : []).join(' ');
const since = (days: number | undefined, now: Date) => (days ? new Date(now.getTime() - days * 24 * 60 * 60 * 1000) : null);
function failedFetch(error: unknown, offline: string): Result {
  if (error instanceof Error && error.name === 'AbortError') return { status: 'cancelled', results: [], reason: 'Pesquisa cancelada.' };
  return { status: 'offline', results: [], reason: offline };
}
function limited(response: Response, who: string): Result {
  const after = response.headers.get('retry-after');
  return { status: 'rate_limited', results: [], reason: `${who} limitou as consultas${after ? `; tente de novo em ${after} s` : ''}. Nada foi inventado.` };
}
const httpsUrl = (value: string) => { const url = new URL(value); if (url.protocol !== 'https:') throw new Error('somente HTTPS'); return url; };

export async function searchYouTubeVideos(input: { query: string; apiKey: string | null; pageToken?: string; filters?: VelixDiscoveryFilters; now?: Date; fetcher: DiscoveryFetch }): Promise<Result> {
  if (!input.apiKey) return { status: 'unavailable', results: [], reason: 'API oficial do YouTube requer credencial configurada.' };
  const url = new URL('https://www.googleapis.com/youtube/v3/search'); url.searchParams.set('part', 'snippet'); url.searchParams.set('type', 'video'); url.searchParams.set('maxResults', '25'); url.searchParams.set('q', [input.query, terms(input.filters)].filter(Boolean).join(' ')); url.searchParams.set('key', input.apiKey); const after = since(input.filters?.periodDays, input.now ?? new Date()); if (after) url.searchParams.set('publishedAfter', after.toISOString()); const length = input.filters?.platform === 'shorts' ? 'short' : input.filters?.duration; if (length && length !== 'any') url.searchParams.set('videoDuration', length); if (input.filters?.rightsPolicy === 'creative_commons') url.searchParams.set('videoLicense', 'creativeCommon'); if (input.pageToken) url.searchParams.set('pageToken', input.pageToken);
  let response: Response; try { response = await input.fetcher(url.toString()); } catch (error) { return failedFetch(error, 'Não foi possível conectar ao YouTube.'); }
  if (response.status === 429) return limited(response, 'O YouTube');
  if (response.status === 403 && /quotaExceeded|rateLimitExceeded|dailyLimitExceeded/.test(await response.clone().text())) return limited(response, 'A cota da API do YouTube');
  if (!response.ok) return { status: 'error', results: [], reason: `YouTube respondeu HTTP ${response.status}.` };
  const parsed = z.object({ items: z.array(z.object({ id: z.object({ videoId: z.string() }), snippet: z.object({ title: z.string(), channelTitle: z.string(), publishedAt: z.string() }) })).default([]), nextPageToken: z.string().nullable().optional() }).safeParse(await response.json());
  if (!parsed.success) return { status: 'error', results: [], reason: 'Resposta do YouTube não reconhecida.' };
  return { status: 'ok', nextPageToken: parsed.data.nextPageToken ?? null, reason: null, results: parsed.data.items.map((item) => ({ kind: 'video', url: `https://www.youtube.com/watch?v=${item.id.videoId}`, title: item.snippet.title, publisher: item.snippet.channelTitle, publishedAt: item.snippet.publishedAt, language: null, query: input.query, retrievedAt: new Date().toISOString() })) };
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decode(value: string): string { return value.replace(/&(?:#(\d+)|#x([\da-f]+)|(amp|lt|gt|quot|apos));/gi, (match, decimal?: string, hex?: string, name?: string) => (name ? ENTITIES[name.toLowerCase()] ?? match : String.fromCodePoint(decimal ? Number(decimal) : Number.parseInt(hex ?? '', 16)))); }
/** Public feeds wrap most titles in CDATA, whose content is already literal text. */
function feedText(value: string): string { const cdata = value.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/); return (cdata ? cdata[1] ?? '' : decode(value)).trim(); }
function webUrl(value: string): boolean { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } }
function feedDate(value: string | undefined): string | null { const time = value ? Date.parse(feedText(value)) : Number.NaN; return Number.isNaN(time) ? null : new Date(time).toISOString(); }
function atomLink(body: string): string | undefined { const links = [...body.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]); const page = links.find((tag) => !/\brel=/i.test(tag) || /\brel=["']alternate["']/i.test(tag)); return page?.match(/\bhref=["']([^"']+)/i)?.[1]; }
function feedLanguage(xml: string): string | null { return xml.match(/<language>\s*([^<\s]+)\s*<\/language>/i)?.[1] ?? xml.match(/<feed\b[^>]*\bxml:lang=["']([^"']+)/i)?.[1] ?? null; }
export async function fetchNewsFeed(input: { feedUrl: string; query: string; publisher: string; filters?: VelixDiscoveryFilters; now?: Date; fetcher: DiscoveryFetch }): Promise<Result> {
  try { httpsUrl(input.feedUrl); } catch (error) { return { status: 'error', results: [], reason: error instanceof Error ? error.message : 'Feed inválido.' }; }
  let response: Response; try { response = await input.fetcher(input.feedUrl); } catch (error) { return failedFetch(error, 'Não foi possível conectar à fonte de notícias.'); }
  if (response.status === 429) return limited(response, 'A fonte de notícias');
  if (!response.ok) return { status: 'error', results: [], reason: `Fonte de notícias respondeu HTTP ${response.status}.` };
  const xml = await response.text(); const entries = [...xml.matchAll(/<(?:item|entry)\b[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi)]; const language = feedLanguage(xml);
  const results = entries.flatMap((match) => { const body = match[1] ?? ''; const get = (name: string) => body.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'))?.[1]?.trim(); const title = get('title'); const rawLink = get('link'); const link = rawLink ? feedText(rawLink) : atomLink(body); if (!title || !link || !webUrl(decode(link))) return []; return [{ kind: 'article' as const, url: decode(link), title: feedText(title), publisher: input.publisher, publishedAt: feedDate(get('pubDate') ?? get('published') ?? get('updated') ?? get('dc:date')), language, query: input.query, retrievedAt: new Date().toISOString() }]; });
  const words = terms(input.filters).toLocaleLowerCase('pt-BR').split(/\s+/).filter(Boolean);
  const after = since(input.filters?.periodDays, input.now ?? new Date());
  return { status: 'ok', reason: null, results: results.filter((item) => words.every((word) => item.title.toLocaleLowerCase('pt-BR').includes(word)) && (!after || (item.publishedAt !== null && new Date(item.publishedAt) >= after))) };
}
