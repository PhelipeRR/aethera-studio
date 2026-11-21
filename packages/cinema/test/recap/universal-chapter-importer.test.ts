/**
 * Aethera Recap — Universal Chapter Importer Tests
 *
 * Covers all 7 required scenarios + anti-ad & completeness guarantees:
 * 1. Asura Scans, when access is permitted (specialized adapter)
 * 2. A public test source on an unknown domain (universal structural importer)
 * 3. A page with long vertical images (Webtoon/Manhwa strips + binary dimension inspector)
 * 4. A page with dynamic loading (lazy-loaded data-src, ts_reader / __NEXT_DATA__ hydration)
 * 5. A source requiring authentication (Interactive Persistent Browser on unknown domain)
 * 6. A source that prohibits extraction (Official WEBTOON viewer & data-extraction-policy="prohibited")
 * 7. An unknown URL without chapter content (content_not_recognized, never "Domínio não possui adaptador suportado")
 * 8. Anti-ad & completeness guard (never generates incomplete CBZ or CBZ with ad banners/avatars/icons)
 */

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import {
	analyzeChapterUrl,
	analyzeUniversalReaderHtml,
	buildAndRegisterChapterCbz,
	defaultSiteAdapterRegistry,
	detectExtractionPolicy,
	downloadChapterPages,
	importChapter,
	inspectImageDimensionsFromBuffer,
	InteractiveRecapBrowserSessionManager,
	type ImageDownloadPort,
	type PageDiscoveryPort,
} from '../../src/recap/index.js';

/**
 * Builds a valid binary PNG buffer with exact `width` and `height` in its IHDR chunk.
 */
function makePngWithDimensions(width: number, height: number, seed = 1): Buffer {
	const buf = Buffer.alloc(300, seed);
	// PNG signature
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
	// IHDR chunk length (13) + 'IHDR'
	buf.writeUInt32BE(13, 8);
	buf.write('IHDR', 12, 'ascii');
	buf.writeUInt32BE(width, 16);
	buf.writeUInt32BE(height, 20);
	buf[24] = 8; // bit depth
	buf[25] = 2; // color type RGB
	return buf;
}

const tempDir = mkdtempSync(join(tmpdir(), 'aethera-universal-imp-'));
let authServer: Server;
let authPort = 0;

beforeAll(async () => {
	authServer = createServer((req, res) => {
		const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
		const cookie = req.headers.cookie ?? '';
		const isLogged = cookie.includes('universal_auth=1');

		if (url.pathname === '/do-login') {
			res.writeHead(302, {
				'Set-Cookie': 'universal_auth=1; Path=/; HttpOnly',
				Location: '/secret-manhwa/chapter-12',
			});
			res.end();
			return;
		}

		if (url.pathname === '/secret-manhwa/chapter-12') {
			if (!isLogged) {
				res.writeHead(401, { 'Content-Type': 'text/html; charset=utf-8' });
				res.end(`<!doctype html>
					<html>
						<head><title>Login Required - Vault Scans</title></head>
						<body>
							<form action="/do-login" method="GET">
								<input type="password" name="pw" />
								<button id="login-submit" type="submit">Sign In</button>
							</form>
						</body>
					</html>`);
				return;
			}
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(`<!doctype html>
				<html>
					<head><title>Secret Manhwa - Chapter 12</title></head>
					<body>
						<header><img src="${url.origin}/assets/site-logo.png" width="120" height="40" alt="logo" /></header>
						<div class="ad-banner"><img src="${url.origin}/ads/top-banner.png" width="728" height="90" alt="sponsor" /></div>
						<main class="chapter-content">
							<img src="${url.origin}/cdn/ch12/001.png" width="800" height="2400" alt="Page 1" />
							<img src="${url.origin}/cdn/ch12/002.png" width="800" height="2600" alt="Page 2" />
						</main>
					</body>
				</html>`);
			return;
		}

		if (url.pathname === '/prohibited-webtoon/viewer') {
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(`<!doctype html>
				<html data-extraction-policy="prohibited">
					<head><title>Protected Official Episode 5</title></head>
					<body>
						<div id="_imageList">
							<img class="_images" data-url="${url.origin}/cdn/ch12/001.png" width="800" height="2400" />
						</div>
					</body>
				</html>`);
			return;
		}

		if (url.pathname.startsWith('/cdn/ch12/')) {
			const p = url.pathname.endsWith('001.png') ? 1 : 2;
			res.writeHead(200, { 'Content-Type': 'image/png' });
			res.end(makePngWithDimensions(800, 2400 + p * 100, p + 10));
			return;
		}

		if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/ads/')) {
			res.writeHead(200, { 'Content-Type': 'image/png' });
			res.end(makePngWithDimensions(728, 90, 99));
			return;
		}

		res.writeHead(404);
		res.end('Not found');
	});

	await new Promise<void>((resolve) => {
		authServer.listen(0, '127.0.0.1', () => {
			const addr = authServer.address();
			authPort = typeof addr === 'object' && addr ? addr.port : 0;
			resolve();
		});
	});
});

afterAll(async () => {
	await new Promise<void>((resolve) => authServer.close(() => resolve()));
	try {
		rmSync(tempDir, { recursive: true, force: true });
	} catch {
		// ignore cleanup lag
	}
});

describe('Universal Chapter Importer (Scenarios 1–7 & Anti-Ad / Completeness Guards)', () => {
	test('1. Asura Scans specialized adapter works when access is permitted', async () => {
		const url = 'https://asurascans.com/comics/nano-machine-7ba78ec7/chapter/15';
		const html = `<!doctype html>
			<html>
				<head><title>Nano Machine Chapter 15</title></head>
				<body>
					<div data-page="1"><img src="https://gg.asuracomic.net/storage/media/1/01.webp" width="800" height="1200" /></div>
					<div data-page="2"><img src="https://gg.asuracomic.net/storage/media/1/02.webp" width="800" height="1200" /></div>
				</body>
			</html>`;

		const discoveryPort: PageDiscoveryPort = {
			async discover({ url: u, adapter }) {
				return {
					pages: adapter.extractPagesFromHtml(html, u),
					availableChapters: [],
				};
			},
		};

		const analyzed = await analyzeChapterUrl({
			url,
			libraryDir: join(tempDir, 'lib-asura'),
			discoveryPort,
		});

		expect(analyzed.adapterId).toBe('asurascans');
		expect(analyzed.isSpecializedAdapter).toBe(true);
		expect(analyzed.acquisitionMethod).toBe('specialized_adapter');
		expect(analyzed.meta.workTitle).toBe('Nano Machine');
		expect(analyzed.meta.chapterNumber).toBe('15');
		expect(analyzed.pages).toHaveLength(2);
	});

	test('2. Public test source on an unknown domain is analyzed via Universal Importer and filters out ads, avatars, icons & thumbnails', async () => {
		const unknownDomainUrl = 'https://unknown-public-scans.example/manga/omni-reader/chapter-42';
		const html = `<!doctype html>
			<html>
				<head><title>Omni Reader - Chapter 42</title></head>
				<body>
					<header class="site-header">
						<img src="https://unknown-public-scans.example/static/logo.png" width="140" height="45" alt="Site Logo" />
						<img class="user-avatar" src="https://unknown-public-scans.example/users/avatar-88.jpg" width="48" height="48" alt="Avatar" />
					</header>
					<div class="ad-banner">
						<img src="https://ads.doubleclick.net/banner-728x90.jpg" width="728" height="90" alt="Advertisement" />
					</div>
					<main id="readerarea" class="reading-content">
						<img src="https://cdn.unknown-public-scans.example/chapters/42/001.jpg" width="900" height="1350" alt="Page 1" />
						<img src="https://cdn.unknown-public-scans.example/chapters/42/002.jpg" width="900" height="1350" alt="Page 2" />
						<img src="https://cdn.unknown-public-scans.example/chapters/42/003.jpg" width="900" height="1350" alt="Page 3" />
					</main>
					<aside class="sidebar">
						<img class="manga-thumb" src="https://unknown-public-scans.example/thumbs/related-1.jpg" width="120" height="160" alt="Related" />
					</aside>
					<footer>
						<img src="https://unknown-public-scans.example/static/discord-banner.png" alt="Join Discord" />
					</footer>
				</body>
			</html>`;

		const discoveryPort: PageDiscoveryPort = {
			async discover({ url: u, adapter }) {
				return {
					pages: adapter.extractPagesFromHtml(html, u),
					availableChapters: [],
				};
			},
		};

		const analyzed = await analyzeChapterUrl({
			url: unknownDomainUrl,
			libraryDir: join(tempDir, 'lib-public'),
			discoveryPort,
		});

		expect(analyzed.adapterId).toBe('universal');
		expect(analyzed.isSpecializedAdapter).toBe(false);
		expect(analyzed.acquisitionMethod).toBe('universal_importer');
		expect(analyzed.meta.workTitle).toBe('Omni Reader');
		expect(analyzed.meta.chapterNumber).toBe('42');
		expect(analyzed.pages).toHaveLength(3);
		expect(analyzed.pages.map((p) => p.imageUrl)).toEqual([
			'https://cdn.unknown-public-scans.example/chapters/42/001.jpg',
			'https://cdn.unknown-public-scans.example/chapters/42/002.jpg',
			'https://cdn.unknown-public-scans.example/chapters/42/003.jpg',
		]);
	});

	test('3. Recognizes long vertical Webtoon/Manhwa strips from HTML and binary PNG headers', async () => {
		const verticalBuf = makePngWithDimensions(800, 3200, 5);
		const dims = inspectImageDimensionsFromBuffer(verticalBuf);
		expect(dims).not.toBeNull();
		expect(dims!.width).toBe(800);
		expect(dims!.height).toBe(3200);
		expect(dims!.aspectRatio).toBe(4);
		expect(dims!.isVerticalStrip).toBe(true);

		const webtoonHtml = `<!doctype html>
			<html>
				<head><title>Vertical Legend - Episode 8</title></head>
				<body>
					<div class="webtoon-reader">
						<img src="https://cdn.vertical-test.example/ep8/strip_01.png" width="800" height="3200" />
						<img src="https://cdn.vertical-test.example/ep8/strip_02.png" width="800" height="2900" />
					</div>
				</body>
			</html>`;
		const analysis = analyzeUniversalReaderHtml(
			webtoonHtml,
			new URL('https://vertical-test.example/webtoon/vertical-legend/episode-8'),
		);

		expect(analysis.isRecognizedChapter).toBe(true);
		expect(analysis.formatHint).toBe('webtoon_vertical');
		expect(analysis.verticalStripCount).toBe(2);
		expect(analysis.pages.every((p) => p.isVerticalStrip)).toBe(true);
	});

	test('4. Extracts dynamically loaded content (lazy-loaded data-src, data-url, ts_reader.run & __NEXT_DATA__ JSON)', () => {
		const dynamicHtml = `<!doctype html>
			<html>
				<head><title>Dynamic Manhwa - Chapter 99</title></head>
				<body>
					<div id="readerarea"></div>
					<script>
						ts_reader.run({
							"sources": [{
								"source": "Default",
								"images": [
									"https:\\/\\/cdn.dynamic.example\\/ch99\\/page_01.webp",
									"https:\\/\\/cdn.dynamic.example\\/ch99\\/page_02.webp",
									"https:\\/\\/cdn.dynamic.example\\/ch99\\/page_03.webp"
								]
							}]
						});
					</script>
				</body>
			</html>`;

		const analysis = analyzeUniversalReaderHtml(
			dynamicHtml,
			new URL('https://dynamic.example/series/dynamic-manhwa/chapter-99'),
		);

		expect(analysis.isRecognizedChapter).toBe(true);
		expect(analysis.pages).toHaveLength(3);
		expect(analysis.pages[0]!.imageUrl).toBe('https://cdn.dynamic.example/ch99/page_01.webp');
		expect(analysis.pages[2]!.imageUrl).toBe('https://cdn.dynamic.example/ch99/page_03.webp');
	});

	test('5. Authenticated source on an unknown domain works end-to-end with Interactive Persistent Browser + Universal Importer', async () => {
		const mgr = new InteractiveRecapBrowserSessionManager({
			profilesRootDir: join(tempDir, 'profiles-auth-universal'),
			libraryDir: join(tempDir, 'lib-auth-universal'),
			registry: defaultSiteAdapterRegistry,
			headless: true,
			allowLocalhostForTests: true,
			pollIntervalMs: 120,
			onAwaitingVerificationForTest: async (page) => {
				await page.click?.('#login-submit');
			},
		});

		const session = mgr.startInteractiveImport({
			urls: [`http://127.0.0.1:${authPort}/secret-manhwa/chapter-12`],
			workTitle: 'Secret Manhwa',
			seriesProjectId: 'secret-manhwa',
		});

		const end = await mgr.waitForSessionEnd(session.sessionId);
		expect(end.state).toBe('completed');
		expect(end.completedChapters).toBe(1);
		// Should have extracted ONLY the 2 chapter strips (800x2500 & 800x2600) and filtered out site-logo.png & top-banner.png (728x90)!
		expect(end.importedEntries[0]!.pageCount).toBe(2);
		expect(existsSync(end.importedEntries[0]!.cbzPath)).toBe(true);

		const imported = await importChapter({
			chapterId: 'secret-manhwa-12',
			archivePath: end.importedEntries[0]!.cbzPath,
			outputDir: join(tempDir, 'extracted-secret-12'),
		});
		expect(imported.pageCount).toBe(2);
	}, 20_000);

	test('6. Sources that prohibit extraction (Official WEBTOON viewer & data-extraction-policy="prohibited") return import_not_permitted without downloading', async () => {
		const officialWebtoonUrl = new URL(
			'https://www.webtoons.com/en/fantasy/tower-of-god/season-3-ep-1/viewer?title_no=95&episode_no=550',
		);
		const webtoonHtml = `<!doctype html>
			<html>
				<head><title>Tower of God - Ep. 550</title></head>
				<body>
					<div class="viewer_lst">
						<div id="_imageList">
							<img class="_images" data-url="https://webtoon-phinf.pstatic.net/2026/01_1.jpg" width="800" height="1280" />
						</div>
					</div>
				</body>
			</html>`;

		const policy = detectExtractionPolicy(webtoonHtml, officialWebtoonUrl);
		expect(policy.permitted).toBe(false);
		expect(policy.code).toBe('import_not_permitted');
		expect(policy.reason).toContain('import_not_permitted');

		const analysis = analyzeUniversalReaderHtml(webtoonHtml, officialWebtoonUrl);
		expect(analysis.state).toBe('import_not_permitted');
		expect(analysis.isPermitted).toBe(false);
		expect(analysis.pages).toHaveLength(0);

		// Also verify Interactive Persistent Browser respects extraction prohibition immediately
		const mgr = new InteractiveRecapBrowserSessionManager({
			profilesRootDir: join(tempDir, 'profiles-prohibited'),
			libraryDir: join(tempDir, 'lib-prohibited'),
			registry: defaultSiteAdapterRegistry,
			headless: true,
			allowLocalhostForTests: true,
			pollIntervalMs: 120,
		});
		const s = mgr.startInteractiveImport({
			urls: [`http://127.0.0.1:${authPort}/prohibited-webtoon/viewer`],
		});
		const end = await mgr.waitForSessionEnd(s.sessionId);
		expect(end.state).toBe('access_denied');
		expect(end.error).toContain('import_not_permitted');
		expect(end.completedChapters).toBe(0);
	}, 15_000);

	test('7. Unknown non-chapter URL returns content_not_recognized (never "Domínio não possui adaptador suportado")', async () => {
		const nonChapterUrl = 'https://random-blog-domain.example/news/top-10-anime-2026';
		const blogHtml = `<!doctype html>
			<html>
				<head><title>Top 10 Anime of 2026</title></head>
				<body>
					<header><img src="https://random-blog-domain.example/logo.png" width="120" height="40" /></header>
					<article>
						<h1>Welcome to our blog</h1>
						<p>No manga chapter sequence here.</p>
					</article>
				</body>
			</html>`;

		const discoveryPort: PageDiscoveryPort = {
			async discover({ url: u, adapter }) {
				return {
					pages: adapter.extractPagesFromHtml(blogHtml, u),
					availableChapters: [],
				};
			},
		};

		let caughtError = '';
		try {
			await analyzeChapterUrl({
				url: nonChapterUrl,
				libraryDir: join(tempDir, 'lib-blog'),
				discoveryPort,
			});
		} catch (err) {
			caughtError = err instanceof Error ? err.message : String(err);
		}

		expect(caughtError).toContain('content_not_recognized');
		expect(caughtError).not.toContain('não possui adaptador suportado');
	});

	test('8. Anti-ad binary dimension filter & Incomplete chapter guard prevent ad-polluted or partial CBZs', async () => {
		// A. Binary dimension filter strips out a 728x90 horizontal ad banner and a 64x64 icon even if their URLs looked like chapter pages
		const downloaderWithHiddenAd: ImageDownloadPort = {
			async fetchImage(url) {
				if (url.endsWith('001.png')) return makePngWithDimensions(800, 1200, 1);
				if (url.endsWith('002-hidden-ad.png')) return makePngWithDimensions(728, 90, 2); // Horizontal ad banner!
				if (url.endsWith('003-tiny-icon.png')) return makePngWithDimensions(64, 64, 3); // Tiny icon!
				return makePngWithDimensions(800, 1200, 4);
			},
		};

		const downloaded = await downloadChapterPages({
			pages: [
				{ pageNumber: 1, imageUrl: 'https://cdn.example.com/ch1/001.png' },
				{ pageNumber: 2, imageUrl: 'https://cdn.example.com/ch1/002-hidden-ad.png' },
				{ pageNumber: 3, imageUrl: 'https://cdn.example.com/ch1/003-tiny-icon.png' },
				{ pageNumber: 4, imageUrl: 'https://cdn.example.com/ch1/004.png' },
			],
			refererUrl: 'https://example.com/manga/test/chapter-1',
			downloader: downloaderWithHiddenAd,
			baseBackoffMs: 1,
		});

		expect(downloaded).toHaveLength(2);
		expect(downloaded.map((d) => d.sourceUrl)).toEqual([
			'https://cdn.example.com/ch1/001.png',
			'https://cdn.example.com/ch1/004.png',
		]);
		expect(downloaded.map((d) => d.pageNumber)).toEqual([1, 2]);

		const cbzEntry = buildAndRegisterChapterCbz({
			analyzed: {
				sourceUrl: 'https://example.com/manga/test/chapter-1',
				adapterId: 'universal',
				adapterName: 'Importador Universal Estrutural',
				acquisitionMethod: 'universal_importer',
				meta: {
					workSlug: 'test-work',
					workTitle: 'Test Work',
					chapterNumber: '1',
					chapterSlug: 'test-work-ch-1',
				},
				pages: [],
				availableChapters: [],
				alreadyImported: null,
			},
			downloadedPages: downloaded,
			libraryDir: join(tempDir, 'lib-clean-cbz'),
		});

		const zip = new AdmZip(cbzEntry.cbzPath);
		const entryNames = zip.getEntries().map((e) => e.entryName);
		expect(entryNames).toContain('001.png');
		expect(entryNames).toContain('002.png');
		expect(entryNames).not.toContain('003.png');
		expect(entryNames).not.toContain('004.png');

		// B. Incomplete chapter guard: if Page 2 fails with HTTP 500, downloadChapterPages MUST fail and refuse to create a partial CBZ
		const brokenMidChapterDownloader: ImageDownloadPort = {
			async fetchImage(url) {
				if (url.endsWith('002.png')) throw new Error('HTTP 500 Internal Server Error');
				return makePngWithDimensions(800, 1200, 11);
			},
		};

		await expect(
			downloadChapterPages({
				pages: [
					{ pageNumber: 1, imageUrl: 'https://cdn.example.com/ch2/001.png' },
					{ pageNumber: 2, imageUrl: 'https://cdn.example.com/ch2/002.png' },
					{ pageNumber: 3, imageUrl: 'https://cdn.example.com/ch2/003.png' },
				],
				refererUrl: 'https://example.com/manga/test/chapter-2',
				downloader: brokenMidChapterDownloader,
				maxRetries: 0,
			}),
		).rejects.toThrow('Capítulo incompleto');
	});
});
