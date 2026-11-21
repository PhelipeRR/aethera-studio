/**
 * URL Chapter Importer — Universal & Specialized Adapter Discovery,
 * Playwright Lazy-Load Discovery, Bounded Retry Downloader,
 * Binary Dimension & Ad/Completeness Validator, CBZ Builder (AdmZip) & Aethera Library Registry
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
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
import {
	classifyCandidateImageForChapter,
	detectExtractionPolicy,
	inspectImageDimensionsFromBuffer,
	UNIVERSAL_ACQUISITION_METHOD_LABELS,
	UNIVERSAL_IMPORT_STATE_LABELS,
	type UniversalAcquisitionMethod,
	type UniversalImportState,
} from './universal-chapter-adapter.js';

export interface AnalyzedChapterUrl {
	sourceUrl: string;
	adapterId: string;
	adapterName: string;
	isSpecializedAdapter?: boolean;
	acquisitionMethod?: UniversalAcquisitionMethod;
	acquisitionMethodLabel?: string;
	importState?: UniversalImportState;
	importStateLabel?: string;
	formatHint?: 'webtoon_vertical' | 'manga_paged' | 'unknown';
	verticalStripCount?: number;
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
	width?: number;
	height?: number;
	aspectRatio?: number;
	isVerticalStrip?: boolean;
}

export interface RecapLibraryEntry {
	id: string;
	workSlug: string;
	workTitle: string;
	chapterNumber: string;
	sourceUrl: string;
	adapterId: string;
	acquisitionMethod?: UniversalAcquisitionMethod;
	cbzPath: string;
	pageCount: number;
	verticalStripCount?: number;
	cbzSha256: string;
	importedAtIso: string;
}

export interface PageDiscoveryPort {
	discover(input: {
		url: URL;
		adapter: ChapterSiteAdapter;
		signal?: AbortSignal;
	}): Promise<{
		pages: DiscoveredPage[];
		availableChapters: DiscoveredChapterLink[];
		providerId?: string;
	}>;
}

export interface ImageDownloadPort {
	fetchImage(url: string, referer: string, signal?: AbortSignal): Promise<Buffer>;
}

/**
 * Default Playwright-backed discovery with progressive scroll for lazy-loaded images.
 * Falls back to safe HTTPS fetch + HTML parsing if Playwright is not installed.
 * Never bypasses CAPTCHA, paywalls, extraction prohibitions, or authentication.
 */
export function createPlaywrightPageDiscoveryPort(options?: { allowHttpForTests?: boolean }): PageDiscoveryPort {
	return {
		async discover({ url, adapter, signal }) {
			// Try Playwright first for dynamic JS / lazy-loaded images
			try {
				const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;
				const pw = (await dynamicImport(['play', 'wright'].join(''))) as {
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
					const policy = detectExtractionPolicy(initialHtml, url);
					if (!policy.permitted) {
						throw new Error(policy.reason ?? '[import_not_permitted] Importação não permitida pela fonte.');
					}
					const restricted = adapter.detectAccessRestriction?.(initialHtml, url);
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

					// Extract [data-page] or live reader images with geometry & dimension inspection
					const livePages = await page.evaluate(() => {
						const d = (globalThis as unknown as {
							document: {
								querySelectorAll: (sel: string) => Array<{
									dataset?: { page?: string; index?: string; number?: string };
									tagName?: string;
									currentSrc?: string;
									src?: string;
									alt?: string;
									className?: string;
									id?: string;
									naturalWidth?: number;
									naturalHeight?: number;
									width?: number;
									height?: number;
									getBoundingClientRect?: () => { width: number; height: number; top: number };
									getAttribute: (name: string) => string | null;
									closest?: (sel: string) => unknown;
									querySelector: (sel: string) => {
										currentSrc?: string;
										src?: string;
										alt?: string;
										naturalWidth?: number;
										naturalHeight?: number;
										width?: number;
										height?: number;
										getBoundingClientRect?: () => { width: number; height: number; top: number };
										getAttribute: (name: string) => string | null;
									} | null;
								}>;
							};
						}).document;

						const indexedNodes = [...d.querySelectorAll('[data-page], [data-index], [data-number]')];
						const out: Array<{ imageUrl: string; alt?: string; width?: number; height?: number }> = [];
						const seen = new Set<string>();

						if (indexedNodes.length > 0) {
							indexedNodes.sort((a, b) => {
								const na = Number(a.dataset?.page ?? a.dataset?.index ?? a.dataset?.number ?? 0);
								const nb = Number(b.dataset?.page ?? b.dataset?.index ?? b.dataset?.number ?? 0);
								return na - nb;
							});
							for (const el of indexedNodes) {
								const img = el.tagName?.toLowerCase() === 'img' ? el : el.querySelector('img');
								if (!img) continue;
								const src =
									img.currentSrc ||
									img.src ||
									img.getAttribute('data-current-src') ||
									img.getAttribute('data-src') ||
									img.getAttribute('data-lazy-src') ||
									img.getAttribute('data-original') ||
									img.getAttribute('data-url') ||
									'';
								if (!src || src.startsWith('data:') || src.startsWith('blob:') || seen.has(src)) continue;
								seen.add(src);
								const w = img.naturalWidth || img.width || 0;
								const h = img.naturalHeight || img.height || 0;
								out.push({
									imageUrl: src,
									...(img.alt ? { alt: img.alt } : {}),
									...(w > 0 ? { width: w } : {}),
									...(h > 0 ? { height: h } : {}),
								});
							}
							if (out.length > 0) return out;
						}

						// Universal live DOM reader scan
						const readerImgs = [
							...d.querySelectorAll(
								'#_imageList img, #readerarea img, .reading-content img, .chapter-content img, .viewer-imgs img, .page-break img, main img, article img, [class*="reader"] img, [class*="viewer"] img, [class*="chapter"] img, img',
							),
						];
						for (const img of readerImgs) {
							if (
								img.closest?.(
									'header, nav, footer, aside, .navbar, .sidebar, .comments, .ad-slot, .ad-banner, .related, .recommendations',
								)
							) {
								continue;
							}
							const src =
								img.currentSrc ||
								img.src ||
								img.getAttribute('data-current-src') ||
								img.getAttribute('data-src') ||
								img.getAttribute('data-lazy-src') ||
								img.getAttribute('data-original') ||
								img.getAttribute('data-url') ||
								'';
							if (!src || src.startsWith('data:') || src.startsWith('blob:') || seen.has(src)) continue;
							const rect = img.getBoundingClientRect ? img.getBoundingClientRect() : { width: 0, height: 0, top: 0 };
							const w = img.naturalWidth || img.width || Math.round(rect.width) || 0;
							const h = img.naturalHeight || img.height || Math.round(rect.height) || 0;
							if ((w > 0 && w < 160) || (h > 0 && h < 160)) continue;
							if (w > 0 && h > 0 && w / h > 3.5 && h <= 240) continue;
							seen.add(src);
							out.push({
								imageUrl: src,
								...(img.alt ? { alt: img.alt } : {}),
								...(w > 0 ? { width: w } : {}),
								...(h > 0 ? { height: h } : {}),
							});
						}
						return out;
					});

					const finalHtml = await page.content();
					const finalPolicy = detectExtractionPolicy(finalHtml, url);
					if (!finalPolicy.permitted) {
						throw new Error(finalPolicy.reason ?? '[import_not_permitted] Importação não permitida pela fonte.');
					}
					const availableChapters = adapter.extractAvailableChaptersFromHtml?.(finalHtml, url) ?? [];

					// Filter livePages through structural ad/icon/avatar classifier
					const filteredLivePages: DiscoveredPage[] = [];
					for (const lp of livePages) {
						const verdict = classifyCandidateImageForChapter({
							url: lp.imageUrl,
							...(lp.alt ? { alt: lp.alt } : {}),
							...(lp.width ? { widthAttr: lp.width } : {}),
							...(lp.height ? { heightAttr: lp.height } : {}),
						});
						if (!verdict.accepted) continue;
						const aspectRatio = lp.width && lp.height ? Number((lp.height / lp.width).toFixed(3)) : undefined;
						const isVerticalStrip =
							verdict.isVerticalStripHint ||
							(aspectRatio !== undefined && (aspectRatio >= 1.8 || (lp.height! >= 1500 && aspectRatio >= 1.35)));
						filteredLivePages.push({
							pageNumber: filteredLivePages.length + 1,
							imageUrl: lp.imageUrl,
							...(lp.alt ? { alt: lp.alt } : {}),
							...(lp.width ? { width: lp.width } : {}),
							...(lp.height ? { height: lp.height } : {}),
							...(aspectRatio !== undefined ? { aspectRatio } : {}),
							...(isVerticalStrip ? { isVerticalStrip: true } : {}),
						});
					}

					const htmlPages = adapter.extractPagesFromHtml(finalHtml, url);
					const pages: DiscoveredPage[] = filteredLivePages.length >= htmlPages.length && filteredLivePages.length > 0
						? filteredLivePages
						: htmlPages;

					await ctx.close();
					return { pages, availableChapters };
				} finally {
					await browser.close();
				}
			} catch (pwErr) {
				// If it was an explicit security, extraction-policy, or access error, do not swallow it
				if (
					pwErr instanceof Error &&
					/SSRF|Acesso restrito|Acesso negado|import_not_permitted|Importa[çc][ãa]o.*n[ãa]o permitida/i.test(pwErr.message)
				) {
					throw pwErr;
				}
				// Fallback to direct HTTPS fetch + deterministic HTML parser when Playwright binary is unavailable
				const res = await fetchWithSafeRedirects(url.toString(), {
					...(signal ? { signal } : {}),
					...(options?.allowHttpForTests !== undefined ? { allowHttpForTests: options.allowHttpForTests } : {}),
				});
				if (!res.ok) throw new Error(`Falha ao carregar capítulo (HTTP ${res.status}).`);
				const html = await res.text();
				const policy = detectExtractionPolicy(html, url);
				if (!policy.permitted) {
					throw new Error(policy.reason ?? '[import_not_permitted] Importação não permitida pela fonte.');
				}
				const restricted = adapter.detectAccessRestriction?.(html, url);
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
	let current = validateExternalChapterUrl(
		rawUrl,
		options?.allowHttpForTests !== undefined ? { allowHttpForTests: options.allowHttpForTests } : undefined,
	);

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
			current = validateRedirectTarget(
				loc,
				current,
				options?.allowHttpForTests !== undefined ? { allowHttpForTests: options.allowHttpForTests } : undefined,
			);
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
				...(options?.allowHttpForTests !== undefined ? { allowHttpForTests: options.allowHttpForTests } : {}),
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

/**
 * Analyzes any chapter URL using the 5-tier acquisition strategy:
 * 1. Specialized adapter when available (e.g. Asura Scans, WEBTOON policy checker)
 * 2. Universal Structural Importer for any domain whose HTML/DOM contains a manga/manhwa/webtoon chapter
 * 3. Firecrawl Local (when discoveryPort routes via firecrawl-self-hosted)
 * 4. Persistent Browser (interactive-browser-session.ts when authentication/verification is needed)
 * 5. Assisted File Import fallback
 *
 * Unknown domains are never rejected upfront.
 */
export async function analyzeChapterUrl(input: {
	url: string;
	libraryDir: string;
	registry?: SiteAdapterRegistry;
	discoveryPort?: PageDiscoveryPort;
	allowHttpForTests?: boolean;
	signal?: AbortSignal;
}): Promise<AnalyzedChapterUrl> {
	const parsed = validateExternalChapterUrl(
		input.url,
		input.allowHttpForTests !== undefined ? { allowHttpForTests: input.allowHttpForTests } : undefined,
	);
	const registry = input.registry ?? defaultSiteAdapterRegistry;
	const { adapter, isSpecialized, acquisitionMethod: baseMethod } = registry.resolveAdapterOrUniversal(parsed);

	const meta = adapter.parseChapterMetadata(parsed);
	const discoveryPort =
		input.discoveryPort ??
		createPlaywrightPageDiscoveryPort(
			input.allowHttpForTests !== undefined ? { allowHttpForTests: input.allowHttpForTests } : undefined,
		);
	const discovered = await discoveryPort.discover({
		url: parsed,
		adapter,
		...(input.signal ? { signal: input.signal } : {}),
	});

	const { pages, availableChapters } = discovered;
	if (pages.length === 0) {
		throw new Error(
			`[content_not_recognized] Conteúdo não reconhecido: nenhuma sequência válida de imagens de capítulo detectada em ${parsed.toString()}.`,
		);
	}

	const effectiveMethod: UniversalAcquisitionMethod =
		discovered.providerId === 'firecrawl-self-hosted'
			? 'firecrawl_local'
			: baseMethod;

	const verticalStripCount = pages.filter((p) => p.isVerticalStrip).length;
	const formatHint: AnalyzedChapterUrl['formatHint'] =
		verticalStripCount > 0 ? 'webtoon_vertical' : 'manga_paged';

	return {
		sourceUrl: parsed.toString(),
		adapterId: adapter.id,
		adapterName: adapter.displayName,
		isSpecializedAdapter: isSpecialized,
		acquisitionMethod: effectiveMethod,
		acquisitionMethodLabel: UNIVERSAL_ACQUISITION_METHOD_LABELS[effectiveMethod],
		importState: 'chapter_identified',
		importStateLabel: UNIVERSAL_IMPORT_STATE_LABELS.chapter_identified,
		formatHint,
		verticalStripCount,
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
	/** Filter out images whose binary dimensions prove they are horizontal ad banners or tiny icons (< 120x120). Default: true. */
	filterAdDimensions?: boolean;
	signal?: AbortSignal;
	onProgress?: (done: number, total: number, pageNumber: number) => void;
}): Promise<DownloadedPageAsset[]> {
	if (input.pages.length === 0) {
		throw new Error('[content_not_recognized] Nenhuma página de capítulo para baixar.');
	}

	const downloader = input.downloader ?? createDefaultImageDownloadPort();
	const concurrency = Math.max(1, Math.min(6, Math.floor(input.concurrency ?? 3)));
	const maxRetries = Math.max(0, Math.min(5, Math.floor(input.maxRetries ?? 2)));
	const baseBackoffMs = input.baseBackoffMs ?? 250;
	const filterAdDimensions = input.filterAdDimensions ?? true;

	const results: Array<DownloadedPageAsset | 'filtered_ad' | undefined> = new Array(input.pages.length);
	let nextIdx = 0;
	let completed = 0;
	let firstError: Error | null = null;

	const worker = async () => {
		while (true) {
			if (firstError || input.signal?.aborted) break;
			const idx = nextIdx++;
			if (idx >= input.pages.length) break;
			const page = input.pages[idx]!;

			// Pre-check candidate URL for ad/icon patterns
			const urlVerdict = classifyCandidateImageForChapter({
				url: page.imageUrl,
				...(page.alt ? { alt: page.alt } : {}),
				...(page.width ? { widthAttr: page.width } : {}),
				...(page.height ? { heightAttr: page.height } : {}),
			});
			if (filterAdDimensions && !urlVerdict.accepted) {
				results[idx] = 'filtered_ad';
				completed++;
				input.onProgress?.(completed, input.pages.length, page.pageNumber);
				continue;
			}

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

					const dims = inspectImageDimensionsFromBuffer(buf);
					if (filterAdDimensions && dims) {
						// Reject tiny icons/avatars/trackers (< 120x120) or horizontal leaderboard ad banners (width/height > 3.5 and height <= 220)
						const isTinyIcon = dims.width < 120 || dims.height < 120;
						const isHorizontalAdBanner = dims.width / dims.height > 3.5 && dims.height <= 220;
						if (isTinyIcon || isHorizontalAdBanner) {
							results[idx] = 'filtered_ad';
							completed++;
							input.onProgress?.(completed, input.pages.length, page.pageNumber);
							lastErr = undefined;
							break;
						}
					}

					const isVerticalStrip =
						dims?.isVerticalStrip ??
						page.isVerticalStrip ??
						(page.width && page.height ? page.height / page.width >= 1.8 : undefined);

					results[idx] = {
						pageNumber: page.pageNumber,
						sourceUrl: page.imageUrl,
						ext: sig.ext,
						sha256: createHash('sha256').update(buf).digest('hex'),
						bytes: buf.length,
						buffer: buf,
						...(dims?.width ?? page.width ? { width: dims?.width ?? page.width } : {}),
						...(dims?.height ?? page.height ? { height: dims?.height ?? page.height } : {}),
						...(dims?.aspectRatio ?? page.aspectRatio ? { aspectRatio: dims?.aspectRatio ?? page.aspectRatio } : {}),
						...(isVerticalStrip !== undefined ? { isVerticalStrip } : {}),
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
	if (firstError) {
		throw new Error(
			`Capítulo incompleto: ${firstError.message} (${completed}/${input.pages.length} páginas verificadas). O Aethera não gera CBZ incompleto.`,
		);
	}

	const validAssets: DownloadedPageAsset[] = [];
	const seenHashes = new Set<string>();
	for (let i = 0; i < results.length; i++) {
		const r = results[i];
		if (!r) {
			throw new Error(`Capítulo incompleto: página ${i + 1} não foi baixada.`);
		}
		if (r === 'filtered_ad') continue;
		// Deduplicate identical binary payloads while keeping sequential reading order
		if (seenHashes.has(r.sha256)) continue;
		seenHashes.add(r.sha256);
		validAssets.push({
			...r,
			pageNumber: validAssets.length + 1,
		});
	}

	if (validAssets.length === 0) {
		throw new Error(
			'[content_not_recognized] Nenhuma imagem de capítulo válida restou após filtrar anúncios, ícones e duplicatas.',
		);
	}

	return validAssets;
}

/**
 * Packs validated downloaded pages into a standard CBZ archive (atomic write)
 * with embedded `recap-source-metadata.json` for traceability and registers it in the Aethera library.
 */
export function buildAndRegisterChapterCbz(input: {
	analyzed: AnalyzedChapterUrl;
	downloadedPages: readonly DownloadedPageAsset[];
	libraryDir: string;
}): RecapLibraryEntry {
	if (input.downloadedPages.length === 0) {
		throw new Error('Não é possível gerar CBZ vazio ou incompleto.');
	}

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

	const verticalStripCount = input.downloadedPages.filter((p) => p.isVerticalStrip).length;
	const metadata = {
		workTitle: input.analyzed.meta.workTitle,
		workSlug: input.analyzed.meta.workSlug,
		chapterNumber: input.analyzed.meta.chapterNumber,
		sourceUrl: input.analyzed.sourceUrl,
		adapterId: input.analyzed.adapterId,
		acquisitionMethod: input.analyzed.acquisitionMethod ?? 'universal_importer',
		formatHint: verticalStripCount > 0 ? 'webtoon_vertical' : (input.analyzed.formatHint ?? 'manga_paged'),
		pageCount: input.downloadedPages.length,
		verticalStripCount,
		completenessVerified: true,
		pages: input.downloadedPages.map((p) => ({
			pageNumber: p.pageNumber,
			sha256: p.sha256,
			bytes: p.bytes,
			...(p.width ? { width: p.width } : {}),
			...(p.height ? { height: p.height } : {}),
			...(p.aspectRatio ? { aspectRatio: p.aspectRatio } : {}),
			...(p.isVerticalStrip !== undefined ? { isVerticalStrip: p.isVerticalStrip } : {}),
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
		...(input.analyzed.acquisitionMethod ? { acquisitionMethod: input.analyzed.acquisitionMethod } : {}),
		cbzPath,
		pageCount: input.downloadedPages.length,
		verticalStripCount,
		cbzSha256,
		importedAtIso: metadata.importedAtIso,
	};
	registerLibraryEntry(input.libraryDir, entry);
	return entry;
}

export interface ArchiveIntegrityResult {
	valid: boolean;
	exists: boolean;
	archivePath: string;
	format: 'cbz' | 'pdf' | 'unknown';
	pageCount: number;
	sizeBytes: number;
	workTitle?: string;
	chapterNumber?: string;
	error?: string;
}

/**
 * Verifies physical existence and internal binary integrity of a CBZ or PDF archive
 * before allowing the UI to mark "02 · Capítulos" as Ready or advance to production.
 */
export function verifyChapterArchiveIntegrity(archivePath: string): ArchiveIntegrityResult {
	const cleaned = (archivePath ?? '').trim();
	if (!cleaned) {
		return {
			valid: false,
			exists: false,
			archivePath: '',
			format: 'unknown',
			pageCount: 0,
			sizeBytes: 0,
			error: 'Caminho do arquivo de capítulo vazio.',
		};
	}

	if (!existsSync(cleaned)) {
		return {
			valid: false,
			exists: false,
			archivePath: cleaned,
			format: 'unknown',
			pageCount: 0,
			sizeBytes: 0,
			error: `Arquivo CBZ/PDF não encontrado no disco: ${cleaned}`,
		};
	}

	let sizeBytes = 0;
	try {
		const st = statSync(cleaned);
		if (!st.isFile() || st.size <= 0) {
			return {
				valid: false,
				exists: true,
				archivePath: cleaned,
				format: 'unknown',
				pageCount: 0,
				sizeBytes: st.size,
				error: 'Arquivo de capítulo está vazio (0 bytes).',
			};
		}
		sizeBytes = st.size;
	} catch (err) {
		return {
			valid: false,
			exists: false,
			archivePath: cleaned,
			format: 'unknown',
			pageCount: 0,
			sizeBytes: 0,
			error: `Não foi possível acessar o arquivo: ${err instanceof Error ? err.message : String(err)}`,
		};
	}

	const lower = cleaned.toLowerCase();
	if (lower.endsWith('.pdf')) {
		try {
			const header = readFileSync(cleaned).subarray(0, 16);
			if (!header.toString('ascii', 0, 5).startsWith('%PDF-') || sizeBytes < 128) {
				return {
					valid: false,
					exists: true,
					archivePath: cleaned,
					format: 'pdf',
					pageCount: 0,
					sizeBytes,
					error: 'Arquivo PDF inválido ou corrompido (assinatura %PDF- ausente).',
				};
			}
			return {
				valid: true,
				exists: true,
				archivePath: cleaned,
				format: 'pdf',
				pageCount: 1,
				sizeBytes,
			};
		} catch (err) {
			return {
				valid: false,
				exists: true,
				archivePath: cleaned,
				format: 'pdf',
				pageCount: 0,
				sizeBytes,
				error: `Falha ao validar PDF: ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	}

	// Default: validate as CBZ / ZIP archive
	try {
		const zip = new AdmZip(cleaned);
		const entries = zip.getEntries();
		const imageEntries = entries.filter(
			(e) =>
				!e.isDirectory &&
				!e.entryName.startsWith('__MACOSX') &&
				/\.(?:webp|png|jpe?g|gif)$/i.test(e.entryName),
		);

		if (imageEntries.length === 0) {
			return {
				valid: false,
				exists: true,
				archivePath: cleaned,
				format: 'cbz',
				pageCount: 0,
				sizeBytes,
				error: 'O arquivo CBZ não contém nenhuma página de imagem válida (.webp, .png, .jpg).',
			};
		}

		// Validate binary magic bytes of every image entry in the CBZ
		for (const imgEntry of imageEntries) {
			const data = imgEntry.getData();
			const magic = validateImageMagicBytes(data);
			if (!magic.valid) {
				return {
					valid: false,
					exists: true,
					archivePath: cleaned,
					format: 'cbz',
					pageCount: 0,
					sizeBytes,
					error: `Imagem corrompida dentro do CBZ (${imgEntry.entryName}): ${magic.reason ?? 'assinatura inválida'}`,
				};
			}
		}

		let workTitle: string | undefined;
		let chapterNumber: string | undefined;
		const metaEntry = entries.find(
			(e) => e.entryName === 'aethera-source.json' || e.entryName === 'recap-source-metadata.json',
		);
		if (metaEntry) {
			try {
				const parsed = JSON.parse(metaEntry.getData().toString('utf-8')) as {
					workTitle?: string;
					chapterNumber?: string;
				};
				if (parsed.workTitle) workTitle = parsed.workTitle;
				if (parsed.chapterNumber) chapterNumber = String(parsed.chapterNumber);
			} catch {
				// metadata is optional
			}
		}

		return {
			valid: true,
			exists: true,
			archivePath: cleaned,
			format: 'cbz',
			pageCount: imageEntries.length,
			sizeBytes,
			...(workTitle ? { workTitle } : {}),
			...(chapterNumber ? { chapterNumber } : {}),
		};
	} catch (err) {
		return {
			valid: false,
			exists: true,
			archivePath: cleaned,
			format: 'cbz',
			pageCount: 0,
			sizeBytes,
			error: `Arquivo CBZ corrompido ou ilegível: ${err instanceof Error ? err.message : String(err)}`,
		};
	}
}
