/**
 * URL Chapter Importer — Playwright Lazy-Load Discovery, Bounded Retry Downloader,
 * CBZ Builder (AdmZip) & Aethera Library Registry
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import AdmZip from 'adm-zip';
import {
	resolveSafeStoragePath,
	sanitizeStorageSlug,
	validateExternalChapterUrl,
	validateImageMagicBytes,
	validateRedirectTarget,
} from './url-security.js';
import {
	defaultSiteAdapterRegistry,
	type ChapterSiteAdapter,
	type DiscoveredChapterLink,
	type DiscoveredPage,
	type ParsedChapterUrlMeta,
	type SiteAdapterRegistry,
} from './site-adapters.js';

export interface AnalyzedChapterUrl {
	sourceUrl: string;
	adapterId: string;
	adapterName: string;
	meta: ParsedChapterUrlMeta;
	pages: DiscoveredPage[];
	availableChapters: DiscoveredChapterLink[];
	alreadyImported: RecapLibraryEntry | null;
}

export interface DownloadedPageAsset {
	pageNumber: number;
	sourceUrl: string;
	ext: '.png' | '.jpg' | '.webp' | '.gif';
	sha256: string;
	bytes: number;
	buffer: Buffer;
}

export interface RecapLibraryEntry {
	id: string;
	workSlug: string;
	workTitle: string;
	chapterNumber: string;
	sourceUrl: string;
	adapterId: string;
	cbzPath: string;
	pageCount: number;
	cbzSha256: string;
	importedAtIso: string;
}

export interface PageDiscoveryPort {
	discover(input: {
		url: URL;
		adapter: ChapterSiteAdapter;
		signal?: AbortSignal;
	}): Promise<{ pages: DiscoveredPage[]; availableChapters: DiscoveredChapterLink[] }>;
}

export interface ImageDownloadPort {
	fetchImage(url: string, referer: string, signal?: AbortSignal): Promise<Buffer>;
}

/**
 * Default Playwright-backed discovery with progressive scroll for lazy-loaded images.
 * Falls back to safe HTTPS fetch + HTML parsing if Playwright is not installed.
 * Never bypasses CAPTCHA, paywalls, or authentication.
 */
export function createPlaywrightPageDiscoveryPort(options?: { allowHttpForTests?: boolean }): PageDiscoveryPort {
	return {
		async discover({ url, adapter, signal }) {
			// Try Playwright first for dynamic JS / lazy-loaded images
			try {
				const pwName = 'playwright';
				const pw = (await import(pwName)) as {
					chromium: { launch: (opts: { headless: boolean }) => Promise<unknown> };
				};
				const browser = (await pw.chromium.launch({ headless: true })) as {
					newContext: (opts: { userAgent: string }) => Promise<{
						newPage: () => Promise<{
							goto: (u: string, opts: { waitUntil: string; timeout: number }) => Promise<{ url: () => string; status: () => number } | null>;
							content: () => Promise<string>;
							evaluate: <T>(fn: () => T | Promise<T>) => Promise<T>;
							waitForTimeout: (ms: number) => Promise<void>;
						}>;
						close: () => Promise<void>;
					}>;
					close: () => Promise<void>;
				};
				try {
					const ctx = await browser.newContext({
						userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
					});
					const page = await ctx.newPage();
					const resp = await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 45_000 });
					if (resp) {
						validateExternalChapterUrl(resp.url(), options);
						if (resp.status() === 403 || resp.status() === 429) {
							throw new Error(`Acesso negado ou limite de requisições atingido no site (HTTP ${resp.status()}).`);
						}
					}

					const initialHtml = await page.content();
					const restricted = adapter.detectAccessRestriction?.(initialHtml);
					if (restricted) throw new Error(restricted);

					// Progressive scroll to trigger lazy-loaded chapter images
					await page.evaluate(async () => {
						const doc = (globalThis as unknown as { document: { body: { scrollHeight: number } }; window: { innerHeight: number; scrollBy: (x: number, y: number) => void } });
						const step = Math.max(400, Math.floor(doc.window.innerHeight * 0.8));
						for (let y = 0; y < doc.document.body.scrollHeight + step; y += step) {
							doc.window.scrollBy(0, step);
							await new Promise((r) => setTimeout(r, 150));
						}
					});
					await page.waitForTimeout(800);

					// Extract [data-page] sorted numerically via live DOM (currentSrc -> src -> data-src)
					const livePages = await page.evaluate(() => {
						const d = (globalThis as unknown as {
							document: {
								querySelectorAll: (sel: string) => Array<{
									dataset?: { page?: string };
									tagName?: string;
									currentSrc?: string;
									src?: string;
									alt?: string;
									getAttribute: (name: string) => string | null;
									querySelector: (sel: string) => {
										currentSrc?: string;
										src?: string;
										alt?: string;
										getAttribute: (name: string) => string | null;
									} | null;
								}>;
							};
						}).document;
						const nodes = [...d.querySelectorAll('[data-page]')].sort(
							(a, b) => Number(a.dataset?.page ?? 0) - Number(b.dataset?.page ?? 0),
						);
						const out: Array<{ imageUrl: string; alt?: string }> = [];
						const seen = new Set<string>();
						for (const el of nodes) {
							const img = el.tagName?.toLowerCase() === 'img' ? el : el.querySelector('img');
							if (!img) continue;
							const src = img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '';
							if (!src || src.startsWith('data:') || seen.has(src)) continue;
							seen.add(src);
							out.push({ imageUrl: src, ...(img.alt ? { alt: img.alt } : {}) });
						}
						return out;
					});

					const finalHtml = await page.content();
					const availableChapters = adapter.extractAvailableChaptersFromHtml?.(finalHtml, url) ?? [];
					const pages: DiscoveredPage[] = livePages.length > 0
						? livePages.map((p, i) => ({ pageNumber: i + 1, imageUrl: p.imageUrl, ...(p.alt ? { alt: p.alt } : {}) }))
						: adapter.extractPagesFromHtml(finalHtml, url);

					await ctx.close();
					return { pages, availableChapters };
				} finally {
					await browser.close();
				}
			} catch (pwErr) {
				// If it was an explicit security/access error, do not swallow it
				if (pwErr instanceof Error && /SSRF|Acesso restrito|Acesso negado/i.test(pwErr.message)) {
					throw pwErr;
				}
				// Fallback to direct HTTPS fetch + deterministic HTML parser when Playwright binary is unavailable
				const res = await fetchWithSafeRedirects(url.toString(), { signal, allowHttpForTests: options?.allowHttpForTests });
				if (!res.ok) throw new Error(`Falha ao carregar capítulo (HTTP ${res.status}).`);
				const html = await res.text();
				const restricted = adapter.detectAccessRestriction?.(html);
				if (restricted) throw new Error(restricted);
				return {
					pages: adapter.extractPagesFromHtml(html, url),
					availableChapters: adapter.extractAvailableChaptersFromHtml?.(html, url) ?? [],
				};
			}
		},
	};
}

/**
 * Performs HTTP GET with manual redirect validation against SSRF on every hop.
 */
export async function fetchWithSafeRedirects(
	rawUrl: string,
	options?: { referer?: string; signal?: AbortSignal; maxRedirects?: number; allowHttpForTests?: boolean },
): Promise<Response> {
	const maxRedirects = options?.maxRedirects ?? 5;
	let current = validateExternalChapterUrl(rawUrl, { allowHttpForTests: options?.allowHttpForTests });

	for (let hop = 0; hop <= maxRedirects; hop++) {
		const res = await fetch(current.toString(), {
			method: 'GET',
			redirect: 'manual',
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
				...(options?.referer ? { Referer: options.referer } : {}),
			},
			...(options?.signal ? { signal: options.signal } : {}),
		});

		if (res.status >= 300 && res.status < 400) {
			const loc = res.headers.get('location');
			if (!loc) throw new Error(`Redirecionamento sem cabeçalho Location (HTTP ${res.status}).`);
			current = validateRedirectTarget(loc, current, { allowHttpForTests: options?.allowHttpForTests });
			continue;
		}
		return res;
	}
	throw new Error('Limite de redirecionamentos excedido.');
}

export function createDefaultImageDownloadPort(options?: { allowHttpForTests?: boolean }): ImageDownloadPort {
	return {
		async fetchImage(imageUrl: string, referer: string, signal?: AbortSignal): Promise<Buffer> {
			const res = await fetchWithSafeRedirects(imageUrl, {
				referer,
				...(signal ? { signal } : {}),
				allowHttpForTests: options?.allowHttpForTests,
			});
			if (!res.ok) throw new Error(`HTTP ${res.status} ao baixar imagem.`);
			return Buffer.from(await res.arrayBuffer());
		},
	};
}

// ─── Library Registry ────────────────────────────────────────────────────────

const LIBRARY_FILE = 'recap-library.json';

export function listRecapLibrary(libraryDir: string): RecapLibraryEntry[] {
	const file = join(libraryDir, LIBRARY_FILE);
	if (!existsSync(file)) return [];
	try {
		const parsed = JSON.parse(readFileSync(file, 'utf-8'));
		return Array.isArray(parsed) ? (parsed as RecapLibraryEntry[]) : [];
	} catch {
		return [];
	}
}

export function findExistingLibraryEntry(libraryDir: string, sourceUrl: string): RecapLibraryEntry | null {
	const entries = listRecapLibrary(libraryDir);
	const found = entries.find((e) => e.sourceUrl === sourceUrl && existsSync(e.cbzPath));
	return found ?? null;
}

export function registerLibraryEntry(libraryDir: string, entry: RecapLibraryEntry): void {
	if (!existsSync(libraryDir)) mkdirSync(libraryDir, { recursive: true });
	const existing = listRecapLibrary(libraryDir).filter((e) => e.sourceUrl !== entry.sourceUrl);
	existing.unshift(entry);
	const target = join(libraryDir, LIBRARY_FILE);
	const tmp = join(libraryDir, `${LIBRARY_FILE}.tmp.${process.pid}.${Date.now()}`);
	writeFileSync(tmp, JSON.stringify(existing, null, 2), 'utf-8');
	renameSync(tmp, target);
}

// ─── Analyze, Download with Backoff & Build CBZ ──────────────────────────────

export async function analyzeChapterUrl(input: {
	url: string;
	libraryDir: string;
	registry?: SiteAdapterRegistry;
	discoveryPort?: PageDiscoveryPort;
	allowHttpForTests?: boolean;
	signal?: AbortSignal;
}): Promise<AnalyzedChapterUrl> {
	const parsed = validateExternalChapterUrl(input.url, { allowHttpForTests: input.allowHttpForTests });
	const registry = input.registry ?? defaultSiteAdapterRegistry;
	const adapter = registry.resolveForUrl(parsed);
	if (!adapter) {
		const supported = registry.listSupportedDomains().map((d) => d.displayName).join(', ');
		throw new Error(`Domínio "${parsed.hostname}" não possui adaptador suportado. Suportados: ${supported}.`);
	}

	const meta = adapter.parseChapterMetadata(parsed);
	const discoveryPort = input.discoveryPort ?? createPlaywrightPageDiscoveryPort({ allowHttpForTests: input.allowHttpForTests });
	const { pages, availableChapters } = await discoveryPort.discover({
		url: parsed,
		adapter,
		...(input.signal ? { signal: input.signal } : {}),
	});

	if (pages.length === 0) {
		throw new Error(`Nenhuma página de imagem detectada em ${parsed.toString()}.`);
	}

	return {
		sourceUrl: parsed.toString(),
		adapterId: adapter.id,
		adapterName: adapter.displayName,
		meta,
		pages,
		availableChapters,
		alreadyImported: findExistingLibraryEntry(input.libraryDir, parsed.toString()),
	};
}

export async function downloadChapterPages(input: {
	pages: readonly DiscoveredPage[];
	refererUrl: string;
	downloader?: ImageDownloadPort;
	concurrency?: number;
	maxRetries?: number;
	baseBackoffMs?: number;
	signal?: AbortSignal;
	onProgress?: (done: number, total: number, pageNumber: number) => void;
}): Promise<DownloadedPageAsset[]> {
	const downloader = input.downloader ?? createDefaultImageDownloadPort();
	const concurrency = Math.max(1, Math.min(6, Math.floor(input.concurrency ?? 3)));
	const maxRetries = Math.max(0, Math.min(5, Math.floor(input.maxRetries ?? 2)));
	const baseBackoffMs = input.baseBackoffMs ?? 250;

	const results: Array<DownloadedPageAsset | undefined> = new Array(input.pages.length);
	let nextIdx = 0;
	let completed = 0;
	let firstError: Error | null = null;

	const worker = async () => {
		while (true) {
			if (firstError || input.signal?.aborted) break;
			const idx = nextIdx++;
			if (idx >= input.pages.length) break;
			const page = input.pages[idx]!;

			let lastErr: unknown;
			for (let attempt = 0; attempt <= maxRetries; attempt++) {
				if (input.signal?.aborted) {
					firstError = new Error('Download cancelado pelo usuário.');
					return;
				}
				try {
					const buf = await downloader.fetchImage(page.imageUrl, input.refererUrl, input.signal);
					const sig = validateImageMagicBytes(buf);
					if (!sig.valid || !sig.ext) {
						throw new Error(`Página ${page.pageNumber}: ${sig.reason ?? 'imagem inválida'}`);
					}
					results[idx] = {
						pageNumber: page.pageNumber,
						sourceUrl: page.imageUrl,
						ext: sig.ext,
						sha256: createHash('sha256').update(buf).digest('hex'),
						bytes: buf.length,
						buffer: buf,
					};
					completed++;
					input.onProgress?.(completed, input.pages.length, page.pageNumber);
					lastErr = undefined;
					break;
				} catch (err) {
					lastErr = err;
					if (attempt < maxRetries && !input.signal?.aborted) {
						await new Promise((r) => setTimeout(r, baseBackoffMs * 2 ** attempt));
					}
				}
			}

			if (lastErr) {
				firstError = lastErr instanceof Error ? lastErr : new Error(String(lastErr));
				break;
			}
		}
	};

	await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, input.pages.length)) }, () => worker()));

	if (input.signal?.aborted) throw new Error('Download cancelado pelo usuário.');
	if (firstError) throw firstError;

	return results.map((r, i) => {
		if (!r) throw new Error(`Página ${i + 1} não foi baixada.`);
		return r;
	});
}

/**
 * Packs validated downloaded pages into a standard CBZ archive (atomic write)
 * with embedded `metadata.json` for traceability and registers it in the Aethera library.
 */
export function buildAndRegisterChapterCbz(input: {
	analyzed: AnalyzedChapterUrl;
	downloadedPages: readonly DownloadedPageAsset[];
	libraryDir: string;
}): RecapLibraryEntry {
	const workDir = resolveSafeStoragePath(input.libraryDir, 'cbz', sanitizeStorageSlug(input.analyzed.meta.workSlug, 'obra'));
	mkdirSync(workDir, { recursive: true });

	const safeChapter = sanitizeStorageSlug(`capitulo-${input.analyzed.meta.chapterNumber}`, 'capitulo');
	const cbzPath = resolveSafeStoragePath(workDir, `${input.analyzed.meta.workSlug}-${safeChapter}.cbz`);
	const tmpCbzPath = `${cbzPath}.tmp.${process.pid}.${Date.now()}`;

	const zip = new AdmZip();
	const padWidth = Math.max(3, String(input.downloadedPages.length).length);
	for (const page of input.downloadedPages) {
		const filename = `${String(page.pageNumber).padStart(padWidth, '0')}${page.ext}`;
		zip.addFile(filename, page.buffer);
	}

	const metadata = {
		workTitle: input.analyzed.meta.workTitle,
		workSlug: input.analyzed.meta.workSlug,
		chapterNumber: input.analyzed.meta.chapterNumber,
		sourceUrl: input.analyzed.sourceUrl,
		adapterId: input.analyzed.adapterId,
		pageCount: input.downloadedPages.length,
		pages: input.downloadedPages.map((p) => ({
			pageNumber: p.pageNumber,
			sha256: p.sha256,
			bytes: p.bytes,
		})),
		importedAtIso: new Date().toISOString(),
	};
	zip.addFile('recap-source-metadata.json', Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8'));
	zip.writeZip(tmpCbzPath);
	renameSync(tmpCbzPath, cbzPath);

	const cbzSha256 = createHash('sha256').update(readFileSync(cbzPath)).digest('hex');
	const entry: RecapLibraryEntry = {
		id: `${input.analyzed.meta.workSlug}-ch-${sanitizeStorageSlug(input.analyzed.meta.chapterNumber, '1')}`,
		workSlug: input.analyzed.meta.workSlug,
		workTitle: input.analyzed.meta.workTitle,
		chapterNumber: input.analyzed.meta.chapterNumber,
		sourceUrl: input.analyzed.sourceUrl,
		adapterId: input.analyzed.adapterId,
		cbzPath,
		pageCount: input.downloadedPages.length,
		cbzSha256,
		importedAtIso: metadata.importedAtIso,
	};
	registerLibraryEntry(input.libraryDir, entry);
	return entry;
}
