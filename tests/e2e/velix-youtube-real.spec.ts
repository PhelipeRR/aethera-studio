import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { freshDataDir, launchApp } from './app';

// Real YouTube Data API: three searches, each spending API quota. The key comes from the environment and is never logged.
test.use({ trace: 'off' });

test.describe(() => {
  test.skip(process.env['NB_REAL_YOUTUBE'] !== '1' || !process.env['NB_YOUTUBE_API_KEY'], 'needs NB_YOUTUBE_API_KEY (NB_REAL_YOUTUBE=1)');
  test.setTimeout(120_000);

  test('busca real no YouTube traz vídeos conferíveis, filtra, pagina e persiste após reiniciar', async () => {
    const dataDir = freshDataDir();
    const { app, page } = await launchApp(dataDir);
    const root = join(dataDir, 'Video'); mkdirSync(root, { recursive: true });
    const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
    await page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
    const query = 'história da ciência';

    const first = await page.evaluate(({ id, q }) => window.neuralbridge.video.discoverySearch({ projectId: id, query: q, provider: 'youtube' }), { id: project.id, q: query });
    expect(first).toMatchObject({ status: 'ok', reason: null });
    expect(first.results.length).toBeGreaterThan(0);
    for (const item of first.results) {
      expect(item.url).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=[\w-]{11}$/);
      expect(item).toMatchObject({ kind: 'video', title: expect.any(String), publisher: expect.any(String) });
      expect(Number.isNaN(Date.parse(item.publishedAt ?? ''))).toBe(false);
    }

    // Independent of the app and of the key: YouTube's public oEmbed must know the same video.
    const sample = first.results[0]; if (!sample) throw new Error('resultado ausente');
    const oembed = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(sample.url)}`);
    expect(oembed.ok).toBe(true);
    expect(((await oembed.json()) as { author_name: string }).author_name).toBe(sample.publisher);

    expect(first.nextPageToken).toEqual(expect.any(String));
    const second = await page.evaluate(({ id, q, pageToken }) => window.neuralbridge.video.discoverySearch({ projectId: id, query: q, provider: 'youtube', pageToken }), { id: project.id, q: query, pageToken: first.nextPageToken ?? '' });
    expect(second.status).toBe('ok');
    expect(second.results.map((item) => item.url)).not.toEqual(first.results.map((item) => item.url));

    const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const filtered = await page.evaluate(({ id, q }) => window.neuralbridge.video.discoverySearch({ projectId: id, query: q, provider: 'youtube', filters: { periodDays: 30, rightsPolicy: 'creative_commons' } }), { id: project.id, q: query });
    expect(filtered.status).toBe('ok');
    expect(filtered.results.every((item) => Date.parse(item.publishedAt ?? '') >= since)).toBe(true);

    const cached = await page.evaluate(({ id, q }) => window.neuralbridge.video.discoverySearch({ projectId: id, query: q, provider: 'youtube' }), { id: project.id, q: query });
    expect(cached).toMatchObject({ status: 'ok', cached: true });

    const saved = (await page.evaluate((id) => window.neuralbridge.video.discoveryList(id), project.id)).references as Array<{ url: string; retrievedAt: string; reviewStatus: string }>;
    const urls = saved.map((item) => item.url);
    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toEqual(expect.arrayContaining(first.results.map((item) => item.url)));
    expect(saved.every((item) => item.retrievedAt && item.reviewStatus === 'approved')).toBe(true);
    console.log(`youtube: first=${first.results.length} second=${second.results.length} filtered=${filtered.results.length} saved=${saved.length} sampleId=${sample.url.slice(-11)}`);
    await app.close();

    const restarted = await launchApp(dataDir);
    const recovered = (await restarted.page.evaluate((id) => window.neuralbridge.video.discoveryList(id), project.id)).references as Array<{ url: string }>;
    expect(recovered.map((item) => item.url)).toEqual(urls);
    const rights = (await restarted.page.evaluate((id) => window.neuralbridge.video.discoveryList(id), project.id)).rights;
    expect(rights).toEqual([]);
    await restarted.app.close();
  });

  test('chave inválida vira erro explícito, sem resultado e sem expor a chave', async () => {
    const dataDir = freshDataDir();
    const { app, page } = await launchApp(dataDir, { env: { NB_YOUTUBE_API_KEY: 'chave-invalida-de-teste' } });
    const root = join(dataDir, 'Video'); mkdirSync(root, { recursive: true });
    const project = await page.evaluate((path) => window.neuralbridge.projects.add(path), root);
    await page.evaluate((id) => window.neuralbridge.video.saveSettings(id), project.id);
    const result = await page.evaluate((id) => window.neuralbridge.video.discoverySearch({ projectId: id, query: 'ciência', provider: 'youtube' }), project.id);
    expect(result).toMatchObject({ status: 'error', results: [] });
    expect(JSON.stringify(result)).not.toContain('chave-invalida-de-teste');
    await app.close();
  });
});
