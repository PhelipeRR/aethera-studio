import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	AcquisitionError,
	AcquisitionRouter,
	asuraScansAdapter,
	createFirecrawlSelfHostedProvider,
	RecapImportJobManager,
	SiteAdapterRegistry,
	type ChapterSiteAdapter,
	type ImageDownloadPort,
} from '../../src/recap/url-importer/index.js';

// Valid PNG buffer >= 128 bytes (passes validateImageMagicBytes)
function makeValidPng(seed = 1): Buffer {
	const buf = Buffer.alloc(256, seed);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
	return buf;
}

const tempDir = mkdtempSync(join(tmpdir(), 'aethera-firecrawl-test-'));
let mockFirecrawlServer: Server;
let firecrawlPort = 0;

beforeAll(async () => {
	mockFirecrawlServer = createServer((req, res) => {
		if (req.method === 'GET' && req.url === '/') {
			res.writeHead(200, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify({ status: 'ok', service: 'firecrawl-local-mock' }));
			return;
		}
		if (req.method === 'POST' && req.url === '/v1/scrape') {
			let raw = '';
			req.on('data', (chunk) => (raw += chunk));
			req.on('end', () => {
				const payload = JSON.parse(raw) as { url?: string };
				const target = payload.url ?? '';

				// 1. Permitted chapter page with [data-page] out of DOM order (3, 1, 2)
				if (target.includes('/permitted-chapter-1')) {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							success: true,
							data: {
								html: `<html><body>
									<div data-page="3"><img data-src="https://cdn.permitted.example/ch1/03.png" /></div>
									<div data-page="1"><img data-src="https://cdn.permitted.example/ch1/01.png" /></div>
									<div data-page="2"><img src="https://cdn.permitted.example/ch1/02.png" /></div>
								</body></html>`,
								metadata: { statusCode: 200, title: 'Permitted Chapter 1' },
							},
						}),
					);
					return;
				}

				// 2. Cloudflare challenge page (HTTP 200 or 403) — MUST NOT be treated as valid chapter!
				if (target.includes('/cloudflare-challenge')) {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							success: true,
							data: {
								html: `<html><head><title>Just a moment...</title></head><body><div id="cf-challenge">Checking your browser before accessing...</div><img src="https://cdn.example/logo.png" /></body></html>`,
								metadata: { statusCode: 403, title: 'Just a moment...' },
							},
						}),
					);
					return;
				}

				// 3. HTTP 403 access denied (without Cloudflare challenge markers)
				if (target.includes('/forbidden-403')) {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							success: true,
							data: {
								html: '<html><body><h1>403 Forbidden</h1></body></html>',
								metadata: { statusCode: 403, title: '403 Forbidden' },
							},
						}),
					);
					return;
				}

				// 4. HTTP 401 authentication required
				if (target.includes('/auth-401')) {
					res.writeHead(401, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
					return;
				}

				// 5. Empty HTML with zero chapter images (extraction error)
				if (target.includes('/empty-chapter')) {
					res.writeHead(200, { 'Content-Type': 'application/json' });
					res.end(
						JSON.stringify({
							success: true,
							data: {
								html: '<html><body><p>Capítulo sem imagens carregadas.</p></body></html>',
								metadata: { statusCode: 200, title: 'Empty' },
							},
						}),
					);
					return;
				}

				res.writeHead(404, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify({ success: false, error: 'Not found' }));
			});
			return;
		}
		res.writeHead(404);
		res.end();
	});

	await new Promise<void>((resolve) => {
		mockFirecrawlServer.listen(0, '127.0.0.1', () => {
			const addr = mockFirecrawlServer.address();
			firecrawlPort = typeof addr === 'object' && addr ? addr.port : 0;
			resolve();
		});
	});
});

afterAll(async () => {
	await new Promise<void>((resolve) => mockFirecrawlServer.close(() => resolve()));
	try {
		rmSync(tempDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

describe('Firecrawl Local Provider & Queue Integration (Reqs 1–10)', () => {
	test('1 & 2. auto-detects Firecrawl Local health and supports live endpoint configuration', async () => {
		// Offline port -> unavailable
		const offlineProvider = createFirecrawlSelfHostedProvider({ apiUrl: 'http://127.0.0.1:19999' });
		const offlineHealth = await offlineProvider.checkHealth();
		expect(offlineHealth.available).toBe(false);

		// Reconfigure live to running mock endpoint -> online
		offlineProvider.updateConfig({ apiUrl: `http://127.0.0.1:${firecrawlPort}`, enabled: true });
		expect(offlineProvider.getConfig().apiUrl).toBe(`http://127.0.0.1:${firecrawlPort}`);
		const onlineHealth = await offlineProvider.checkHealth();
		expect(onlineHealth.available).toBe(true);
	});

	test('3, 4 & 5. extracts ordered images via Firecrawl Local and packs complete CBZ through RecapImportJobManager', async () => {
		const provider = createFirecrawlSelfHostedProvider({
			apiUrl: `http://127.0.0.1:${firecrawlPort}`,
			enabled: true,
		});
		const router = new AcquisitionRouter({ providerPriority: ['firecrawl-self-hosted'] });
		router.registerProvider(provider);

		const downloadOrder: string[] = [];
		let seq = 0;
		const mockDownloader: ImageDownloadPort = {
			async fetchImage(imageUrl: string) {
				downloadOrder.push(imageUrl);
				return makeValidPng(++seq);
			},
		};

		const permittedAdapter: ChapterSiteAdapter = {
			...asuraScansAdapter,
			id: 'permitted-test-source',
			displayName: 'Permitted Test Source',
			supportedHosts: ['permitted.example'],
			matchesUrl: (u) => u.hostname === 'permitted.example',
			parseChapterMetadata: () => ({ workSlug: 'test-work', workTitle: 'Test Work', chapterNumber: '1' }),
		};
		const registry = new SiteAdapterRegistry([permittedAdapter]);

		const manager = new RecapImportJobManager({
			libraryDir: join(tempDir, 'library'),
			registry,
			discoveryPort: router,
			downloader: mockDownloader,
		});

		const job = manager.createJob({ urls: ['https://permitted.example/comics/test-work/permitted-chapter-1'] });
		for (let i = 0; i < 40; i++) {
			const cur = manager.getJob(job.id)!;
			if (cur.status === 'completed' || cur.status === 'failed') break;
			await new Promise((r) => setTimeout(r, 40));
		}

		const finalJob = manager.getJob(job.id)!;
		expect(finalJob.status).toBe('completed');
		expect(finalJob.items[0]!.pagesDone).toBe(3);
		expect(finalJob.items[0]!.pagesTotal).toBe(3);
		expect(finalJob.items[0]!.libraryEntry?.cbzPath).toBeTruthy();
		expect(existsSync(finalJob.items[0]!.libraryEntry!.cbzPath)).toBe(true);
		// Verify [data-page] numeric ordering was preserved (01, 02, 03 — NOT DOM order 03, 01, 02!)
		expect(downloadOrder).toEqual([
			'https://cdn.permitted.example/ch1/01.png',
			'https://cdn.permitted.example/ch1/02.png',
			'https://cdn.permitted.example/ch1/03.png',
		]);
	});

	test('6, 7, 8 & 10. rejects Cloudflare challenge, differentiates 401/403/extraction errors, and never retries blocked requests', async () => {
		const provider = createFirecrawlSelfHostedProvider({
			apiUrl: `http://127.0.0.1:${firecrawlPort}`,
			enabled: true,
		});
		const adapter = asuraScansAdapter;

		// Cloudflare challenge -> captcha_detected (retryable: false) — NOT treated as valid chapter!
		try {
			await provider.discover({ url: new URL('https://permitted.example/cloudflare-challenge'), adapter });
			expect.unreachable('Should reject Cloudflare challenge');
		} catch (err) {
			expect(err).toBeInstanceOf(AcquisitionError);
			expect((err as AcquisitionError).code).toBe('captcha_detected');
			expect((err as AcquisitionError).retryable).toBe(false);
		}

		// HTTP 403 -> access_denied_403 (retryable: false)
		try {
			await provider.discover({ url: new URL('https://permitted.example/forbidden-403'), adapter });
			expect.unreachable('Should reject 403');
		} catch (err) {
			expect(err).toBeInstanceOf(AcquisitionError);
			expect((err as AcquisitionError).code).toBe('access_denied_403');
			expect((err as AcquisitionError).retryable).toBe(false);
		}

		// HTTP 401 -> paywall_detected (retryable: false)
		try {
			await provider.discover({ url: new URL('https://permitted.example/auth-401'), adapter });
			expect.unreachable('Should reject 401');
		} catch (err) {
			expect(err).toBeInstanceOf(AcquisitionError);
			expect((err as AcquisitionError).code).toBe('paywall_detected');
			expect((err as AcquisitionError).retryable).toBe(false);
		}

		// Empty HTML -> no_pages_found (extraction error, retryable: false)
		try {
			await provider.discover({ url: new URL('https://permitted.example/empty-chapter'), adapter });
			expect.unreachable('Should reject empty extraction');
		} catch (err) {
			expect(err).toBeInstanceOf(AcquisitionError);
			expect((err as AcquisitionError).code).toBe('no_pages_found');
			expect((err as AcquisitionError).retryable).toBe(false);
		}
	});
});
