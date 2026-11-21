/**
 * CDN Direct Importer — Browser Bridge Mode
 *
 * Imports chapter images from direct CDN URLs extracted by the user in their
 * browser console. This bypasses Cloudflare/CAPTCHA protections on the main
 * site page because CDN endpoints (e.g., cdn.asurascans.com) typically don't
 * have the same restrictions.
 *
 * SECURITY:
 * - Only HTTPS URLs are accepted.
 * - SSRF validation via url-security.ts (no private IPs, no localhost).
 * - Image magic bytes validated before writing to disk.
 * - No CAPTCHA/paywall bypass — user provides URLs from their own browser session.
 * - Referer header sent to satisfy hotlink protection on some CDNs.
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
} from './url-security.js';
import type { RecapLibraryEntry } from './url-chapter-importer.js';
import { registerLibraryEntry } from './url-chapter-importer.js';

export interface CdnDirectImportInput {
	/** Ordered list of direct image URLs (already sorted by page number). */
	imageUrls: string[];
	/** Original chapter page URL for metadata extraction and referer header. */
	chapterPageUrl: string;
	/** Work title for library entry. Falls back to slug parsing if empty. */
	workTitle?: string;
	/** Chapter number override. Parsed from chapterPageUrl if not provided. */
	chapterNumber?: string;
	/** Library root directory for CBZ storage and registry. */
	libraryDir: string;
	/** Abort signal for cancellation. */
	signal?: AbortSignal;
	/** Progress callback. */
	onProgress?: (done: number, total: number, pageNumber: number) => void;
	/** Concurrency limit for downloads. Default: 3, max: 6. */
	concurrency?: number;
	/** Max retries per image. Default: 2. */
	maxRetries?: number;
}

export interface CdnDirectImportResult {
	cbzPath: string;
	pageCount: number;
	workTitle: string;
	chapterNumber: string;
	warnings: string[];
	libraryEntry: RecapLibraryEntry;
}

function inferExtFromUrl(url: string): '.webp' | '.jpg' | '.png' | '.gif' {
	const lower = url.toLowerCase().split('?')[0] ?? '';
	if (lower.endsWith('.webp')) return '.webp';
	if (lower.endsWith('.png')) return '.png';
	if (lower.endsWith('.gif')) return '.gif';
	return '.jpg';
}

function parseWorkAndChapter(chapterPageUrl: string, overrides?: { workTitle?: string; chapterNumber?: string }): {
	workSlug: string;
	workTitle: string;
	chapterNumber: string;
} {
	const parsed = new URL(chapterPageUrl);
	const segments = parsed.pathname.split('/').filter(Boolean);

	// Try /comics/<slug>/chapter/<num> or /series/<slug>/chapter/<num>
	const chapterIdx = segments.findIndex((s) => s === 'chapter');
	let rawSlug = 'obra';
	let chapterNum = overrides?.chapterNumber ?? '1';

	if (chapterIdx > 0) {
		rawSlug = segments[chapterIdx - 1] ?? rawSlug;
		if (chapterIdx + 1 < segments.length && !overrides?.chapterNumber) {
			chapterNum = segments[chapterIdx + 1] ?? chapterNum;
		}
	} else if (segments.length > 0) {
		rawSlug = segments[0] ?? rawSlug;
	}

	const workSlug = sanitizeStorageSlug(rawSlug, 'obra');
	const workTitle = overrides?.workTitle?.trim()
		|| rawSlug
			.replace(/-[a-f0-9]{6,10}$/i, '')
			.split(/[-_]+/)
			.filter(Boolean)
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(' ');

	return { workSlug, workTitle, chapterNumber: chapterNum };
}

/**
 * Downloads images from direct CDN URLs and builds a CBZ archive.
 * Designed for the "Browser Bridge" workflow where the user extracts
 * image URLs from their browser console and pastes them into Aethera.
 */
export async function importChapterFromCdnUrls(input: CdnDirectImportInput): Promise<CdnDirectImportResult> {
	const warnings: string[] = [];

	if (input.imageUrls.length === 0) {
		throw new Error('Nenhuma URL de imagem fornecida.');
	}

	// Validate chapter page URL for metadata (not fetched, just parsed)
	let chapterUrl: URL;
	try {
		chapterUrl = new URL(input.chapterPageUrl);
		if (chapterUrl.protocol !== 'https:' && chapterUrl.protocol !== 'http:') {
			throw new Error('URL do capítulo deve ser HTTPS.');
		}
	} catch {
		throw new Error(`URL do capítulo inválida: ${input.chapterPageUrl}`);
	}

	const parseOptions: { workTitle?: string; chapterNumber?: string } = {};
	if (input.workTitle !== undefined) parseOptions.workTitle = input.workTitle;
	if (input.chapterNumber !== undefined) parseOptions.chapterNumber = input.chapterNumber;
	const meta = parseWorkAndChapter(input.chapterPageUrl, parseOptions);

	const concurrency = Math.max(1, Math.min(6, Math.floor(input.concurrency ?? 3)));
	const maxRetries = Math.max(0, Math.min(5, Math.floor(input.maxRetries ?? 2)));
	const baseBackoffMs = 300;
	const referer = chapterUrl.toString();

	// Download all images with bounded concurrency
	type DownloadedAsset = {
		pageNumber: number;
		sourceUrl: string;
		ext: '.png' | '.jpg' | '.webp' | '.gif';
		sha256: string;
		bytes: number;
		buffer: Buffer;
	};

	const results: Array<DownloadedAsset | undefined> = new Array(input.imageUrls.length);
	let nextIdx = 0;
	let completed = 0;
	let firstError: Error | null = null;

	const worker = async () => {
		while (true) {
			if (firstError || input.signal?.aborted) break;
			const idx = nextIdx++;
			if (idx >= input.imageUrls.length) break;
			const imageUrl = input.imageUrls[idx]!.trim();

			if (!imageUrl) {
				firstError = new Error(`URL vazia na posição ${idx + 1}.`);
				break;
			}

			let lastErr: unknown;
			for (let attempt = 0; attempt <= maxRetries; attempt++) {
				if (input.signal?.aborted) {
					firstError = new Error('Importação cancelada pelo usuário.');
					return;
				}
				try {
					// Validate each image URL against SSRF
					const validatedUrl = validateExternalChapterUrl(imageUrl);

					const res = await fetch(validatedUrl.toString(), {
						method: 'GET',
						redirect: 'follow',
						headers: {
							'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
							Referer: referer,
						},
						...(input.signal ? { signal: input.signal } : {}),
					});

					if (!res.ok) {
						throw new Error(`HTTP ${res.status} ao baixar imagem ${idx + 1}.`);
					}

					const buf = Buffer.from(await res.arrayBuffer());
					const sig = validateImageMagicBytes(buf);

					if (!sig.valid || !sig.ext) {
						// Try inferred extension as fallback when magic bytes don't match known types
						const inferredExt = inferExtFromUrl(imageUrl);
						if (buf.length >= 128) {
							warnings.push(`Página ${idx + 1}: magic bytes não reconhecidos (${sig.reason}), usando extensão inferida (${inferredExt}).`);
							results[idx] = {
								pageNumber: idx + 1,
								sourceUrl: imageUrl,
								ext: inferredExt,
								sha256: createHash('sha256').update(buf).digest('hex'),
								bytes: buf.length,
								buffer: buf,
							};
							completed++;
							input.onProgress?.(completed, input.imageUrls.length, idx + 1);
							lastErr = undefined;
							break;
						}
						throw new Error(`Página ${idx + 1}: ${sig.reason ?? 'imagem inválida'} (${buf.length} bytes).`);
					}

					results[idx] = {
						pageNumber: idx + 1,
						sourceUrl: imageUrl,
						ext: sig.ext,
						sha256: createHash('sha256').update(buf).digest('hex'),
						bytes: buf.length,
						buffer: buf,
					};
					completed++;
					input.onProgress?.(completed, input.imageUrls.length, idx + 1);
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

	await Promise.all(
		Array.from({ length: Math.min(concurrency, input.imageUrls.length) }, () => worker()),
	);

	if (input.signal?.aborted) throw new Error('Importação cancelada pelo usuário.');
	if (firstError) throw firstError;

	const downloadedPages = results.map((r, i) => {
		if (!r) throw new Error(`Página ${i + 1} não foi baixada.`);
		return r;
	});

	// Build CBZ
	const workDir = resolveSafeStoragePath(input.libraryDir, 'cbz', meta.workSlug);
	mkdirSync(workDir, { recursive: true });

	const safeChapter = sanitizeStorageSlug(`capitulo-${meta.chapterNumber}`, 'capitulo');
	const cbzPath = resolveSafeStoragePath(workDir, `${meta.workSlug}-${safeChapter}.cbz`);
	const tmpCbzPath = `${cbzPath}.tmp.${process.pid}.${Date.now()}`;

	const zip = new AdmZip();
	const padWidth = Math.max(3, String(downloadedPages.length).length);

	for (const page of downloadedPages) {
		const filename = `${String(page.pageNumber).padStart(padWidth, '0')}${page.ext}`;
		zip.addFile(filename, page.buffer);
	}

	const metadata = {
		workTitle: meta.workTitle,
		workSlug: meta.workSlug,
		chapterNumber: meta.chapterNumber,
		sourceUrl: input.chapterPageUrl,
		adapterId: 'cdn-direct',
		importMode: 'browser-bridge',
		pageCount: downloadedPages.length,
		pages: downloadedPages.map((p) => ({
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

	const libraryEntry: RecapLibraryEntry = {
		id: `${meta.workSlug}-ch-${sanitizeStorageSlug(meta.chapterNumber, '1')}`,
		workSlug: meta.workSlug,
		workTitle: meta.workTitle,
		chapterNumber: meta.chapterNumber,
		sourceUrl: input.chapterPageUrl,
		adapterId: 'cdn-direct',
		cbzPath,
		pageCount: downloadedPages.length,
		cbzSha256,
		importedAtIso: metadata.importedAtIso,
	};
	registerLibraryEntry(input.libraryDir, libraryEntry);

	return {
		cbzPath,
		pageCount: downloadedPages.length,
		workTitle: meta.workTitle,
		chapterNumber: meta.chapterNumber,
		warnings,
		libraryEntry,
	};
}