/**
 * Modular Site Adapter Registry & Asura Scans Adapter
 *
 * No hardcoded CDN URLs, no fixed page counts, no fixed version query params,
 * and NO CAPTCHA / paywall / authentication bypass.
 */

import { sanitizeStorageSlug } from './url-security.js';

export interface DiscoveredPage {
	pageNumber: number;
	imageUrl: string;
	alt?: string;
}

export interface DiscoveredChapterLink {
	chapterNumber: string;
	title: string;
	url: string;
}

export interface ParsedChapterUrlMeta {
	workSlug: string;
	workTitle: string;
	chapterNumber: string;
	chapterSlug: string;
}

export interface ChapterSiteAdapter {
	readonly id: string;
	readonly displayName: string;
	readonly supportedHosts: readonly string[];
	matchesUrl(url: URL): boolean;
	parseChapterMetadata(url: URL): ParsedChapterUrlMeta;
	/** Extracts ordered, deduplicated page image URLs from HTML markup (deterministic parser). */
	extractPagesFromHtml(html: string, baseUrl: URL): DiscoveredPage[];
	/** Extracts available chapter links from HTML when exposed by the page. */
	extractAvailableChaptersFromHtml?(html: string, baseUrl: URL): DiscoveredChapterLink[];
	/** Detects CAPTCHA / paywall / access block without attempting any bypass. */
	detectAccessRestriction?(html: string): string | null;
}

function titleFromSlug(slug: string): string {
	// Strip trailing short hex/id suffix (e.g. "nano-machine-7ba78ec7" -> "Nano Machine")
	const cleaned = slug.replace(/-[a-f0-9]{6,10}$/i, '');
	return cleaned
		.split(/[-_]+/)
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(' ');
}

function resolveAttrUrl(raw: string | undefined, baseUrl: URL): string | null {
	if (!raw) return null;
	const trimmed = raw.trim();
	if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) return null;
	try {
		const resolved = new URL(trimmed, baseUrl);
		if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return null;
		return resolved.toString();
	} catch {
		return null;
	}
}

function extractAttr(tag: string, attrName: string): string | undefined {
	const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
	const m = re.exec(tag);
	return m?.[1] ?? m?.[2];
}

/**
 * Extracts `[data-page]` elements sorted numerically by `data-page`,
 * resolves `currentSrc` / `data-src` / `data-lazy-src` / `src`,
 * removes duplicate image URLs, and preserves original page order.
 */
export function extractOrderedDataPageImagesFromHtml(html: string, baseUrl: URL): DiscoveredPage[] {
	const items: Array<{ pageOrder: number; domIndex: number; url: string; alt?: string }> = [];

	// Match containers or img tags bearing data-page="..."
	const containerPattern = /<([a-z0-9]+)\b[^>]*\bdata-page\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))[^>]*>([\s\S]*?)<\/\1>|<img\b[^>]*\bdata-page\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))[^>]*\/?>/gi;
	let match: RegExpExecArray | null;
	let domIndex = 0;

	while ((match = containerPattern.exec(html)) !== null) {
		domIndex++;
		const isSelfImg = match[0].toLowerCase().startsWith('<img');
		const pageNumStr = isSelfImg ? (match[6] ?? match[7] ?? match[8]) : (match[2] ?? match[3] ?? match[4]);
		const pageOrder = Number.parseInt(pageNumStr ?? String(domIndex), 10);

		const imgTag = isSelfImg ? match[0] : (/<img\b[^>]*>/i.exec(match[5] ?? '')?.[0] ?? '');
		if (!imgTag) continue;

		const rawSrc =
			extractAttr(imgTag, 'data-current-src') ??
			extractAttr(imgTag, 'data-src') ??
			extractAttr(imgTag, 'data-lazy-src') ??
			extractAttr(imgTag, 'src');
		const resolvedUrl = resolveAttrUrl(rawSrc, baseUrl);
		if (!resolvedUrl) continue;

		const alt = extractAttr(imgTag, 'alt');
		items.push({ pageOrder, domIndex, url: resolvedUrl, ...(alt ? { alt } : {}) });
	}

	// Numeric sort matching: [...document.querySelectorAll('[data-page]')].sort((a,b) => Number(a.dataset.page) - Number(b.dataset.page))
	items.sort((a, b) => (a.pageOrder !== b.pageOrder ? a.pageOrder - b.pageOrder : a.domIndex - b.domIndex));

	// Deduplicate URLs preserving first occurrence in reading order
	const seen = new Set<string>();
	const deduped: DiscoveredPage[] = [];
	for (const item of items) {
		if (seen.has(item.url)) continue;
		seen.add(item.url);
		deduped.push({
			pageNumber: deduped.length + 1,
			imageUrl: item.url,
			...(item.alt ? { alt: item.alt } : {}),
		});
	}
	return deduped;
}

const ACCESS_RESTRICTION_PATTERNS = [
	/cf-challenge|challenge-platform|just a moment\.\.\./i,
	/captcha|hcaptcha|recaptcha/i,
	/subscribe to read|paywall|login required to view/i,
];

export const asuraScansAdapter: ChapterSiteAdapter = {
	id: 'asurascans',
	displayName: 'Asura Scans',
	supportedHosts: ['asurascans.com', 'www.asurascans.com', 'asuracomic.net', 'www.asuracomic.net', 'asuracomics.com', 'www.asuracomics.com'],

	matchesUrl(url: URL): boolean {
		const host = url.hostname.toLowerCase();
		return this.supportedHosts.some((h) => host === h || host.endsWith(`.${h}`));
	},

	parseChapterMetadata(url: URL): ParsedChapterUrlMeta {
		// e.g. /comics/nano-machine-7ba78ec7/chapter/1 or /series/nano-machine-7ba78ec7/chapter/1
		const m = /\/(?:comics|series|manga)\/([^/]+)\/chapter\/([^/?#]+)/i.exec(url.pathname);
		const rawWorkSlug = m?.[1] ?? sanitizeStorageSlug(url.pathname.split('/').filter(Boolean)[0] ?? 'obra');
		const chapterNumber = m?.[2] ?? '1';
		return {
			workSlug: sanitizeStorageSlug(rawWorkSlug, 'obra'),
			workTitle: titleFromSlug(rawWorkSlug),
			chapterNumber: chapterNumber.trim(),
			chapterSlug: sanitizeStorageSlug(`${rawWorkSlug}-ch-${chapterNumber}`, 'chapter'),
		};
	},

	detectAccessRestriction(html: string): string | null {
		for (const re of ACCESS_RESTRICTION_PATTERNS) {
			if (re.test(html)) {
				return 'Acesso restrito pelo site (CAPTCHA, Cloudflare ou paywall). O Aethera não realiza bypass de proteções.';
			}
		}
		return null;
	},

	extractPagesFromHtml(html: string, baseUrl: URL): DiscoveredPage[] {
		return extractOrderedDataPageImagesFromHtml(html, baseUrl);
	},

	extractAvailableChaptersFromHtml(html: string, baseUrl: URL): DiscoveredChapterLink[] {
		const chapters: DiscoveredChapterLink[] = [];
		const seen = new Set<string>();
		const linkRe = /<a\b[^>]*href\s*=\s*(?:"([^"]*\/chapter\/[^"]*)"|'([^']*\/chapter\/[^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
		let m: RegExpExecArray | null;
		while ((m = linkRe.exec(html)) !== null) {
			const href = m[1] ?? m[2];
			const resolved = resolveAttrUrl(href, baseUrl);
			if (!resolved || seen.has(resolved)) continue;
			seen.add(resolved);
			const numMatch = /\/chapter\/([^/?#]+)/i.exec(resolved);
			const chapterNumber = numMatch?.[1] ?? String(chapters.length + 1);
			const label = (m[3] ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() || `Capítulo ${chapterNumber}`;
			chapters.push({ chapterNumber, title: label, url: resolved });
		}
		return chapters.sort((a, b) => Number.parseFloat(a.chapterNumber) - Number.parseFloat(b.chapterNumber));
	},
};

export class SiteAdapterRegistry {
	private readonly adapters: ChapterSiteAdapter[] = [];

	constructor(initial: readonly ChapterSiteAdapter[] = [asuraScansAdapter]) {
		this.adapters.push(...initial);
	}

	register(adapter: ChapterSiteAdapter): void {
		if (!this.adapters.some((a) => a.id === adapter.id)) {
			this.adapters.push(adapter);
		}
	}

	resolveForUrl(url: URL): ChapterSiteAdapter | null {
		return this.adapters.find((a) => a.matchesUrl(url)) ?? null;
	}

	listSupportedDomains(): Array<{ id: string; displayName: string; hosts: readonly string[] }> {
		return this.adapters.map((a) => ({ id: a.id, displayName: a.displayName, hosts: a.supportedHosts }));
	}
}

export const defaultSiteAdapterRegistry = new SiteAdapterRegistry();
