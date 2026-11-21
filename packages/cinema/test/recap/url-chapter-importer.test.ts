/**
 * Aethera Recap — URL Chapter Importer Tests (Etapa 7)
 *
 * Uses deterministic local HTML/image fixtures and real AdmZip + existing importChapter()
 * integration to verify all 10 required scenarios without external network dependency.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import {
	asuraScansAdapter,
	validateExternalChapterUrl,
	validateRedirectTarget,
	validateImageMagicBytes,
	resolveSafeStoragePath,
	analyzeChapterUrl,
	downloadChapterPages,
	buildAndRegisterChapterCbz,
	listRecapLibrary,
	RecapImportJobManager,
	verifyChapterArchiveIntegrity,
	importChapter,
	type PageDiscoveryPort,
	type ImageDownloadPort,
} from '../../src/recap/index.js';

/** Minimal valid PNG binary (signature + padded bytes >= 128 bytes). */
function makeValidPngBuffer(seed = 1): Buffer {
	const buf = Buffer.alloc(256, seed);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
	return buf;
}

describe('Aethera Recap — URL Chapter Importer (Etapas 2–7)', () => {
	const ASURA_URL = 'https://asurascans.com/comics/nano-machine-7ba78ec7/chapter/1';

	it('1, 2 & 3. extracts [data-page] numerically (1, 2, 10), resolves lazy-loaded data-src/src, deduplicates and skips missing URLs', () => {
		const html = `
			<div data-page="10"><img data-lazy-src="https://cdn.example.com/p10.webp" alt="Page 10" /></div>
			<div data-page="2"><img data-src="https://cdn.example.com/p2.webp" alt="Page 2" /></div>
			<div data-page="1"><img src="https://cdn.example.com/p1.webp" alt="Page 1" /></div>
			<div data-page="3"><img src="https://cdn.example.com/p2.webp" alt="Duplicate of Page 2" /></div>
			<div data-page="4"><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" alt="Placeholder" /></div>
			<div data-page="5"><span>No image here</span></div>
		`;
		const base = new URL(ASURA_URL);
		const pages = asuraScansAdapter.extractPagesFromHtml(html, base);

		expect(pages).toHaveLength(3);
		expect(pages.map((p) => p.imageUrl)).toEqual([
			'https://cdn.example.com/p1.webp',
			'https://cdn.example.com/p2.webp',
			'https://cdn.example.com/p10.webp',
		]);
		expect(pages.map((p) => p.pageNumber)).toEqual([1, 2, 3]);

		const meta = asuraScansAdapter.parseChapterMetadata(base);
		expect(meta.workTitle).toBe('Nano Machine');
		expect(meta.chapterNumber).toBe('1');
	});

	it('4 & 5. retries transient download failures with backoff and rejects invalid/corrupted HTML or non-image payloads', async () => {
		let attempts = 0;
		const flakyDownloader: ImageDownloadPort = {
			async fetchImage(url) {
				if (url.includes('p1')) {
					attempts++;
					if (attempts === 1) throw new Error('ECONNRESET transient');
					return makeValidPngBuffer(1);
				}
				return makeValidPngBuffer(2);
			},
		};

		const okPages = await downloadChapterPages({
			pages: [
				{ pageNumber: 1, imageUrl: 'https://cdn.example.com/p1.png' },
				{ pageNumber: 2, imageUrl: 'https://cdn.example.com/p2.png' },
			],
			refererUrl: ASURA_URL,
			downloader: flakyDownloader,
			concurrency: 2,
			maxRetries: 2,
			baseBackoffMs: 5,
		});
		expect(attempts).toBe(2);
		expect(okPages).toHaveLength(2);

		// Invalid file (HTML error page instead of image)
		expect(validateImageMagicBytes(Buffer.from('<html><body>403 Forbidden</body></html>')).valid).toBe(false);
		const htmlDownloader: ImageDownloadPort = {
			async fetchImage() {
				return Buffer.from('<html><body>Cloudflare error page padding to exceed 128 bytes 012345678901234567890123456789012345678901234567890123456789</body></html>');
			},
		};
		await expect(
			downloadChapterPages({
				pages: [{ pageNumber: 1, imageUrl: 'https://cdn.example.com/bad.png' }],
				refererUrl: ASURA_URL,
				downloader: htmlDownloader,
				maxRetries: 0,
			}),
		).rejects.toThrow('Assinatura binária inválida');
	});

	it('6 & 10. generates a valid CBZ with source metadata, registers in library, and integrates directly with existing importChapter()', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-url-cbz-'));
		const libraryDir = join(dir, 'library');
		const recapImportDir = join(dir, 'recap-import');
		try {
			const discoveryPort: PageDiscoveryPort = {
				async discover() {
					return {
						pages: [
							{ pageNumber: 1, imageUrl: 'https://cdn.example.com/001.png' },
							{ pageNumber: 2, imageUrl: 'https://cdn.example.com/002.png' },
							{ pageNumber: 3, imageUrl: 'https://cdn.example.com/003.png' },
						],
						availableChapters: [],
					};
				},
			};
			const downloader: ImageDownloadPort = {
				async fetchImage(url) {
					return makeValidPngBuffer(url.endsWith('1.png') ? 1 : url.endsWith('2.png') ? 2 : 3);
				},
			};

			const analyzed = await analyzeChapterUrl({ url: ASURA_URL, libraryDir, discoveryPort });
			const downloaded = await downloadChapterPages({
				pages: analyzed.pages,
				refererUrl: analyzed.sourceUrl,
				downloader,
				baseBackoffMs: 1,
			});
			const entry = buildAndRegisterChapterCbz({ analyzed, downloadedPages: downloaded, libraryDir });

			expect(existsSync(entry.cbzPath)).toBe(true);
			expect(entry.pageCount).toBe(3);
			expect(entry.sourceUrl).toBe(ASURA_URL);

			// Verify ZIP contents & embedded traceability metadata
			const zip = new AdmZip(entry.cbzPath);
			const names = zip.getEntries().map((e) => e.entryName);
			expect(names).toContain('001.png');
			expect(names).toContain('002.png');
			expect(names).toContain('003.png');
			expect(names).toContain('recap-source-metadata.json');

			// Verify library registration
			const lib = listRecapLibrary(libraryDir);
			expect(lib).toHaveLength(1);
			expect(lib[0]!.cbzPath).toBe(entry.cbzPath);

			// Real integration with existing Phase 1 importChapter()
			const imported = await importChapter({
				chapterId: entry.id,
				archivePath: entry.cbzPath,
				outputDir: recapImportDir,
			});
			expect(imported.format).toBe('cbz');
			expect(imported.pageCount).toBe(3);
			expect(imported.readingOrder).toBe('vertical');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('7 & 8. batch queue imports multiple chapters, skips already imported, and supports cancel & retry', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-url-batch-'));
		const libraryDir = join(dir, 'library');
		try {
			const discoveryPort: PageDiscoveryPort = {
				async discover({ url }) {
					return {
						pages: [
							{ pageNumber: 1, imageUrl: `https://cdn.example.com/${url.pathname}-1.png` },
							{ pageNumber: 2, imageUrl: `https://cdn.example.com/${url.pathname}-2.png` },
						],
						availableChapters: [],
					};
				},
			};
			const downloader: ImageDownloadPort = {
				async fetchImage() {
					await new Promise((r) => setTimeout(r, 5));
					return makeValidPngBuffer(7);
				},
			};

			const manager = new RecapImportJobManager({
				libraryDir,
				discoveryPort,
				downloader,
				baseBackoffMs: 1,
			});

			const ch1 = 'https://asurascans.com/comics/nano-machine-7ba78ec7/chapter/1';
			const ch2 = 'https://asurascans.com/comics/nano-machine-7ba78ec7/chapter/2';
			const job1 = manager.createJob({ urls: [ch1, ch2] });
			const done1 = await manager.waitForJob(job1.id);

			expect(done1.status).toBe('completed');
			expect(done1.completedChapters).toBe(2);
			expect(done1.items[0]!.libraryEntry?.cbzPath).toBeDefined();
			expect(done1.items[1]!.libraryEntry?.cbzPath).toBeDefined();

			// Second run skips already imported chapters automatically
			const job2 = manager.createJob({ urls: [ch1] });
			const done2 = await manager.waitForJob(job2.id);
			expect(done2.status).toBe('completed');
			expect(done2.items[0]!.status).toBe('skipped_existing');

			// Cancel & Retry lifecycle
			const ch3 = 'https://asurascans.com/comics/nano-machine-7ba78ec7/chapter/3';
			const job3 = manager.createJob({ urls: [ch3] });
			manager.cancelJob(job3.id);
			expect(manager.getJob(job3.id)?.status).toBe('cancelled');

			manager.retryJob(job3.id);
			const done3 = await manager.waitForJob(job3.id);
			expect(done3.status).toBe('completed');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('9. enforces SSRF protection, redirect validation, safe storage paths, and no CAPTCHA bypass', () => {
		expect(() => validateExternalChapterUrl('http://asurascans.com/comics/x/chapter/1')).toThrow('Apenas HTTPS');
		expect(() => validateExternalChapterUrl('file:///etc/passwd')).toThrow('Apenas HTTPS');
		expect(() => validateExternalChapterUrl('https://localhost/admin')).toThrow('SSRF bloqueado');
		expect(() => validateExternalChapterUrl('https://127.0.0.1/secret')).toThrow('SSRF bloqueado');
		expect(() => validateExternalChapterUrl('https://192.168.1.10/panel.png')).toThrow('SSRF bloqueado');
		expect(() => validateExternalChapterUrl('https://169.254.169.254/latest/meta-data')).toThrow('SSRF bloqueado');
		expect(() => validateExternalChapterUrl('https://user:pass@asurascans.com/comics/x/chapter/1')).toThrow('credenciais');

		expect(() =>
			validateRedirectTarget('https://10.0.0.1/internal', new URL(ASURA_URL)),
		).toThrow('SSRF bloqueado');

		expect(() => resolveSafeStoragePath('/tmp/safe-root', '../../etc/passwd')).toThrow('Caminho inseguro');

		// CAPTCHA / paywall detection without bypass
		const restricted = asuraScansAdapter.detectAccessRestriction?.('<div class="cf-challenge">Just a moment...</div>');
		expect(restricted).toContain('não realiza bypass');
	});

	it('11. verifies physical CBZ existence and binary image integrity before advancing, and recovers cleanly from failed import followed by retry success', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-verify-cbz-'));
		const libraryDir = join(dir, 'library');
		try {
			// 1. Non-existent archive fails integrity check
			const missing = verifyChapterArchiveIntegrity(join(dir, 'missing-cap-1.cbz'));
			expect(missing.valid).toBe(false);
			expect(missing.exists).toBe(false);

			// 2. Corrupted CBZ (contains HTML error bytes instead of valid image magic bytes) fails integrity check
			const corruptedPath = join(dir, 'corrupted.cbz');
			const badZip = new AdmZip();
			badZip.addFile('001.webp', Buffer.from('<html><body>403 Forbidden</body></html>'));
			badZip.writeZip(corruptedPath);
			const corruptedCheck = verifyChapterArchiveIntegrity(corruptedPath);
			expect(corruptedCheck.valid).toBe(false);
			expect(corruptedCheck.error).toContain('Imagem corrompida');

			// 3. Import attempt 1 fails -> Retry attempt 2 succeeds -> CBZ passes physical & binary integrity check
			let shouldFailDiscovery = true;
			const discoveryPort: PageDiscoveryPort = {
				async discover() {
					if (shouldFailDiscovery) {
						throw new Error('Bloqueio Cloudflare / HTTP 403');
					}
					return {
						pages: Array.from({ length: 24 }, (_, idx) => ({
							pageNumber: idx + 1,
							imageUrl: `https://cdn.example.com/ch1/${String(idx + 1).padStart(4, '0')}.png`,
						})),
						availableChapters: [],
					};
				},
			};
			const downloader: ImageDownloadPort = {
				async fetchImage(url) {
					const num = Number(/(\d+)\.png$/.exec(url)?.[1] ?? '1');
					return makeValidPngBuffer(num + 10);
				},
			};

			const manager = new RecapImportJobManager({
				libraryDir,
				discoveryPort,
				downloader,
				baseBackoffMs: 1,
			});

			const job = manager.createJob({ urls: [ASURA_URL] });
			const failedSnap = await manager.waitForJob(job.id);
			expect(failedSnap.status).toBe('failed');
			expect(failedSnap.items[0]!.status).toBe('failed');
			expect(failedSnap.items[0]!.error).toContain('403');

			// Now allow discovery and retry the job
			shouldFailDiscovery = false;
			manager.retryJob(job.id);
			const succeededSnap = await manager.waitForJob(job.id);
			expect(succeededSnap.status).toBe('completed');
			expect(succeededSnap.items[0]!.status).toBe('completed');
			expect(succeededSnap.items[0]!.error).toBeUndefined();
			expect(succeededSnap.items[0]!.pagesDone).toBe(24);
			expect(succeededSnap.items[0]!.pagesTotal).toBe(24);

			const cbzPath = succeededSnap.items[0]!.libraryEntry!.cbzPath;
			const integrity = verifyChapterArchiveIntegrity(cbzPath);
			expect(integrity.valid).toBe(true);
			expect(integrity.exists).toBe(true);
			expect(integrity.format).toBe('cbz');
			expect(integrity.pageCount).toBe(24);
			expect(integrity.workTitle).toBe('Nano Machine');
			expect(integrity.chapterNumber).toBe('1');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
