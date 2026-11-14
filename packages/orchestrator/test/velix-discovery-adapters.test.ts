import { describe, expect, it } from 'vitest';
import { fetchNewsFeed, searchYouTubeVideos, type DiscoveryFetch } from '../src/velix-discovery-adapters.js';

const response = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/xml' } });

describe('Velix discovery adapters', () => {
  it('reports missing YouTube credentials without inventing results', async () => {
    await expect(searchYouTubeVideos({ query: 'games', apiKey: null, fetcher: async () => response('{}') })).resolves.toMatchObject({ status: 'unavailable', results: [], reason: expect.stringContaining('credencial') });
  });
  it('maps an authorized RSS/Atom feed to dated references', async () => {
    const fetcher: DiscoveryFetch = async () => response('<rss><channel><item><title>Notícia &amp; teste</title><link>https://news.example/a</link><pubDate>Fri, 31 Oct 2026 10:00:00 GMT</pubDate><description>Resumo</description></item></channel></rss>');
    await expect(fetchNewsFeed({ feedUrl: 'https://news.example/feed.xml', query: 'tecnologia', publisher: 'News', fetcher })).resolves.toMatchObject({ status: 'ok', results: [{ title: 'Notícia & teste', url: 'https://news.example/a', publishedAt: expect.any(String) }] });
  });
  it('reads CDATA titles and encoded links as public feeds publish them', async () => {
    const fetcher: DiscoveryFetch = async () => response('<rss><channel><item><title><![CDATA[Título & <i>real</i>]]></title><link>https://news.example/a?x=1&amp;y=2</link></item><item><title>Número &#8211; &#x2013;</title><link><![CDATA[https://news.example/b]]></link></item></channel></rss>');
    const result = await fetchNewsFeed({ feedUrl: 'https://news.example/feed.xml', query: 'x', publisher: 'News', fetcher });
    expect(result.results.map(({ title, url }) => ({ title, url }))).toEqual([{ title: 'Título & <i>real</i>', url: 'https://news.example/a?x=1&y=2' }, { title: 'Número – –', url: 'https://news.example/b' }]);
  });
  it('prefers the Atom alternate link and keeps an unreadable date unknown', async () => {
    const fetcher: DiscoveryFetch = async () => response('<feed><entry><title>Atom</title><link rel="self" href="https://news.example/self.xml"/><link rel="alternate" href="https://news.example/post"/><updated>ontem</updated></entry></feed>');
    await expect(fetchNewsFeed({ feedUrl: 'https://news.example/feed.xml', query: 'x', publisher: 'News', fetcher })).resolves.toMatchObject({ status: 'ok', results: [{ url: 'https://news.example/post', publishedAt: null }] });
  });
  it('drops entries whose link is not a web address', async () => {
    const fetcher: DiscoveryFetch = async () => response('<rss><channel><item><title>Ruim</title><link>javascript:alert(1)</link></item><item><title>Bom</title><link>https://news.example/ok</link></item></channel></rss>');
    await expect(fetchNewsFeed({ feedUrl: 'https://news.example/feed.xml', query: 'x', publisher: 'News', fetcher })).resolves.toMatchObject({ results: [{ title: 'Bom' }] });
    expect((await fetchNewsFeed({ feedUrl: 'https://news.example/feed.xml', query: 'x', publisher: 'News', fetcher })).results).toHaveLength(1);
  });
  it('uses the language the feed declares and leaves it unknown otherwise', async () => {
    const declared: DiscoveryFetch = async () => response('<rss><channel><language>en-GB</language><item><title>A</title><link>https://news.example/a</link></item></channel></rss>');
    const atom: DiscoveryFetch = async () => response('<feed xml:lang="pt-BR"><entry><title>A</title><link href="https://news.example/a"/></entry></feed>');
    const silent: DiscoveryFetch = async () => response('<rss><channel><item><title>A</title><link>https://news.example/a</link></item></channel></rss>');
    const input = { feedUrl: 'https://news.example/feed.xml', query: 'x', publisher: 'News' };
    await expect(fetchNewsFeed({ ...input, fetcher: declared })).resolves.toMatchObject({ results: [{ language: 'en-GB' }] });
    await expect(fetchNewsFeed({ ...input, fetcher: atom })).resolves.toMatchObject({ results: [{ language: 'pt-BR' }] });
    await expect(fetchNewsFeed({ ...input, fetcher: silent })).resolves.toMatchObject({ results: [{ language: null }] });
  });
  it('exposes HTTP failures as degraded states', async () => {
    await expect(fetchNewsFeed({ feedUrl: 'https://news.example/feed.xml', query: 'x', publisher: 'News', fetcher: async () => response('', 503) })).resolves.toMatchObject({ status: 'error', results: [], reason: expect.stringContaining('503') });
  });
});
