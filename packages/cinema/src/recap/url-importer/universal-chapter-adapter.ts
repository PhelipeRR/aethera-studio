/**
 * Universal Chapter Importer & Structural Reader Analyzer
 *
 * Content-structure-based chapter discovery for Manga, Manhwa, and Webtoon readers:
 * - Multi-layer image discovery (indexed attributes, hydration JSON/__NEXT_DATA__/ts_reader,
 *   semantic reader containers, and general DOM images)
 * - Multi-factor differentiation of chapter pages vs ads, avatars, icons, banners, and thumbnails
 * - Binary dimension inspection (PNG, JPEG, WEBP, GIF headers) & vertical strip detection
 * - Reading order preservation (explicit index -> DOM vertical flow -> filename sequence)
 * - Official WEBTOON structure & extraction policy compliance (never presumes browser-viewed
 *   images may be automatically downloaded or redistributed when prohibited)
 * - Completeness verification (never generates an incomplete or ad-polluted CBZ)
 */

import { sanitizeStorageSlug } from './url-security.js';
import type {
	ChapterSiteAdapter,
	DiscoveredChapterLink,
	DiscoveredPage,
	ParsedChapterUrlMeta,
} from './site-adapters.js';

// ─── Universal States & Acquisition Methods ──────────────────────────────────

export const UNIVERSAL_IMPORT_STATES = [
	'source_recognized',
	'analyzing_page',
	'chapter_identified',
	'verifying_images',
	'importing',
	'import_not_permitted',
	'content_not_recognized',
] as const;
export type UniversalImportState = (typeof UNIVERSAL_IMPORT_STATES)[number];

export const UNIVERSAL_IMPORT_STATE_LABELS: Record<UniversalImportState, string> = {
	source_recognized: 'Fonte reconhecida',
	analyzing_page: 'Analisando página',
	chapter_identified: 'Capítulo identificado',
	verifying_images: 'Verificando imagens',
	importing: 'Importando',
	import_not_permitted: 'Importação não permitida',
	content_not_recognized: 'Conteúdo não reconhecido',
};

export const UNIVERSAL_ACQUISITION_METHODS = [
	'specialized_adapter',
	'universal_importer',
	'firecrawl_local',
	'persistent_browser',
	'assisted_files',
] as const;
export type UniversalAcquisitionMethod = (typeof UNIVERSAL_ACQUISITION_METHODS)[number];

export const UNIVERSAL_ACQUISITION_METHOD_LABELS: Record<UniversalAcquisitionMethod, string> = {
	specialized_adapter: 'Adaptador especializado',
	universal_importer: 'Importador universal',
	firecrawl_local: 'Firecrawl Local',
	persistent_browser: 'Navegador persistente',
	assisted_files: 'Importação assistida por arquivos',
};

export interface ImageDimensionInfo {
	width: number;
	height: number;
	aspectRatio: number;
	/** True when height/width >= 1.8 or height >= 1500px (Webtoon / Manhwa long vertical strip). */
	isVerticalStrip: boolean;
}

export interface UniversalStructuralAnalysis {
	state: UniversalImportState;
	stateLabel: string;
	isRecognizedChapter: boolean;
	isPermitted: boolean;
	prohibitionReason?: string;
	formatHint: 'webtoon_vertical' | 'manga_paged' | 'unknown';
	meta: ParsedChapterUrlMeta;
	pages: DiscoveredPage[];
	availableChapters: DiscoveredChapterLink[];
	filteredOutCount: number;
	filteredOutSamples: Array<{ url: string; reason: string }>;
	verticalStripCount: number;
}

// ─── Binary Image Dimension Inspector (PNG, JPEG, WEBP, GIF) ─────────────────

/**
 * Inspects actual pixel dimensions from raw image buffer headers without decoding full pixels.
 * Enables reliable detection of long vertical strips (Webtoon/Manhwa) and rejection of
 * tiny icons/trackers or horizontal ad banners before packing CBZ.
 */
export function inspectImageDimensionsFromBuffer(buf: Buffer): ImageDimensionInfo | null {
	if (!Buffer.isBuffer(buf) || buf.length < 24) return null;

	let width = 0;
	let height = 0;

	// 1. PNG: 89 50 4E 47 0D 0A 1A 0A + 4-byte length + 'IHDR' + 4-byte width + 4-byte height
	if (
		buf[0] === 0x89 &&
		buf[1] === 0x50 &&
		buf[2] === 0x4e &&
		buf[3] === 0x47 &&
		buf.toString('ascii', 12, 16) === 'IHDR'
	) {
		width = buf.readUInt32BE(16);
		height = buf.readUInt32BE(20);
	}
	// 2. GIF: 'GIF87a' or 'GIF89a' + 2-byte width (LE) + 2-byte height (LE)
	else if (buf.toString('ascii', 0, 3) === 'GIF') {
		width = buf.readUInt16LE(6);
		height = buf.readUInt16LE(8);
	}
	// 3. WEBP: 'RIFF'....'WEBP'
	else if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
		const chunkType = buf.toString('ascii', 12, 16);
		if (chunkType === 'VP8 ' && buf.length >= 30) {
			// Lossy VP8 frame header starts at 20; signature 9D 01 2A at 23..25
			if (buf[23] === 0x9d && buf[24] === 0x01 && buf[25] === 0x2a) {
				width = buf.readUInt16LE(26) & 0x3fff;
				height = buf.readUInt16LE(28) & 0x3fff;
			}
		} else if (chunkType === 'VP8L' && buf.length >= 25) {
			// Lossless VP8L signature 0x2f at byte 20
			if (buf[20] === 0x2f) {
				const b0 = buf[21] ?? 0;
				const b1 = buf[22] ?? 0;
				const b2 = buf[23] ?? 0;
				const b3 = buf[24] ?? 0;
				width = 1 + (((b1 & 0x3f) << 8) | b0);
				height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
			}
		} else if (chunkType === 'VP8X' && buf.length >= 30) {
			// Extended VP8X: 24-bit LE width-1 at 24..26, 24-bit LE height-1 at 27..29
			width = 1 + ((buf[24] ?? 0) | ((buf[25] ?? 0) << 8) | ((buf[26] ?? 0) << 16));
			height = 1 + ((buf[27] ?? 0) | ((buf[28] ?? 0) << 8) | ((buf[29] ?? 0) << 16));
		}
	}
	// 4. JPEG: FF D8 ... scan for SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15
	else if (buf[0] === 0xff && buf[1] === 0xd8) {
		let offset = 2;
		while (offset + 9 < buf.length) {
			if (buf[offset] !== 0xff) {
				offset++;
				continue;
			}
			const marker = buf[offset + 1] ?? 0;
			if (marker === 0xff) {
				offset++;
				continue;
			}
			// Standalone markers without length
			if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
				offset += 2;
				continue;
			}
			if (offset + 4 >= buf.length) break;
			const segLen = buf.readUInt16BE(offset + 2);
			if (segLen < 2) break;
			const isSof =
				(marker >= 0xc0 && marker <= 0xc3) ||
				(marker >= 0xc5 && marker <= 0xc7) ||
				(marker >= 0xc9 && marker <= 0xcb) ||
				(marker >= 0xcd && marker <= 0xcf);
			if (isSof && offset + 9 <= buf.length) {
				height = buf.readUInt16BE(offset + 5);
				width = buf.readUInt16BE(offset + 7);
				break;
			}
			offset += 2 + segLen;
		}
	}

	if (width <= 0 || height <= 0 || width > 65535 || height > 200000) {
		return null;
	}

	const aspectRatio = Number((height / width).toFixed(3));
	const isVerticalStrip = aspectRatio >= 1.8 || (height >= 1500 && aspectRatio >= 1.35);

	return { width, height, aspectRatio, isVerticalStrip };
}

// ─── Ad, Icon, Avatar & Thumbnail Differentiation ────────────────────────────

const AD_OR_CHROME_URL_PATTERNS: readonly RegExp[] = [
	/(?:^|[/_.-])(?:logo|favicon|avatar|profile-pic|user-icon|site-icon|brand-icon|badge|emoji|emoticon|reaction|sticker)(?:[/_.-]|$)/i,
	/(?:^|[/_.-])(?:ads?|advert|advertisement|banner|sponsor|promo|affiliate|popunder|AdServer|doubleclick|googlesyndication|adservice|taboola|outbrain|mgid|exoclick|a-ads)(?:[/_.-]|$)/i,
	/(?:^|[/_.-])(?:pixel|tracker|analytics|beacon|1x1|spacer|blank|placeholder|loading|spinner|preloader)(?:[/_.-]|$)/i,
	/(?:^|[/_.-])(?:thumb|thumbnail|small-cover|cover-small|poster-thumb|related-thumb|recommend-thumb|widget-img)(?:[/_.-]|$)/i,
	/(?:^|[/_.-])(?:disqus|facebook|twitter|discord-banner|patreon|kofi|ko-fi|paypal|donate|social-icon)(?:[/_.-]|$)/i,
	/\.(?:svg|ico)(?:[?#]|$)/i,
];

const AD_OR_CHROME_ATTR_PATTERNS: readonly RegExp[] = [
	/\b(?:logo|avatar|user-avatar|site-logo|nav-icon|menu-icon|social-share|comment-avatar)\b/i,
	/\b(?:ad-slot|ad-banner|ad-container|adsense|adsbygoogle|sponsor-banner|promo-banner|affiliate-banner)\b/i,
	/\b(?:thumbnail|series-thumb|manga-thumb|related-series|recommended-item|sidebar-widget)\b/i,
];

const NEGATIVE_CONTAINER_CONTEXT_PATTERNS: readonly RegExp[] = [
	/<(?:header|nav|footer|aside)\b[^>]*>[\s\S]{0,600}$/i,
	/\b(?:class|id)\s*=\s*["'][^"']*(?:navbar|site-header|site-footer|sidebar|widget-area|comments?-section|disqus|related-posts|recommendations|ad-wrapper|ad-unit|banner-box|sponsor-box|social-links)[^"']*["'][^>]*>[\s\S]{0,600}$/i,
];

const POSITIVE_READER_CONTEXT_PATTERNS: readonly RegExp[] = [
	/\bdata-(?:page|index|number|image-index)\s*=/i,
	/\b(?:class|id)\s*=\s*["'][^"']*(?:reader|reading-content|chapter-content|chapter-images|_imageList|viewer_lst|viewer-imgs|page-break|comic-page|manga-page|webtoon-reader|chapter-viewer)[^"']*["']/i,
];

function isInsideUnclosedNegativeContainer(precedingHtmlContext: string): boolean {
	if (!precedingHtmlContext) return false;
	// Strip already-closed negative elements so a closed <header>...</header> or <div class="ad-banner">...</div>
	// never taints a subsequent <main class="chapter-content">!
	const stripped = precedingHtmlContext
		.replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, '')
		.replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, '')
		.replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, '')
		.replace(/<aside\b[^>]*>[\s\S]*?<\/aside>/gi, '')
		.replace(
			/<([a-z0-9]+)\b[^>]*(?:class|id)\s*=\s*["'][^"']*(?:navbar|site-header|site-footer|sidebar|widget-area|comments?-section|disqus|related-posts|recommendations|ad-banner|ad-slot|ad-wrapper|ad-unit|banner-box|sponsor-box|social-links)[^"']*["'][^>]*>[\s\S]*?<\/\1>/gi,
			'',
		);

	// Check if an unclosed negative tag remains open in the stripped context
	for (const re of NEGATIVE_CONTAINER_CONTEXT_PATTERNS) {
		if (re.test(stripped)) {
			// Verify no positive reader container opened AFTER the unclosed negative tag
			const lastPositiveIdx = Math.max(
				stripped.search(/<(?:main|article)\b/i),
				stripped.search(
					/\b(?:class|id)\s*=\s*["'][^"']*(?:reader|reading-content|chapter-content|chapter-images|_imageList|viewer_lst|viewer-imgs|page-break|comic-page|manga-page|webtoon-reader|chapter-viewer)[^"']*["']/i,
				),
			);
			if (lastPositiveIdx === -1) {
				return true;
			}
		}
	}
	return false;
}

export function classifyCandidateImageForChapter(input: {
	url: string;
	alt?: string;
	className?: string;
	id?: string;
	widthAttr?: number;
	heightAttr?: number;
	precedingHtmlContext?: string;
	hasExplicitPageAttr?: boolean;
}): { accepted: boolean; score: number; reason?: string; isVerticalStripHint?: boolean } {
	const { url, alt = '', className = '', id = '', widthAttr = 0, heightAttr = 0, precedingHtmlContext = '', hasExplicitPageAttr = false } = input;

	if (!url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('javascript:')) {
		return { accepted: false, score: -100, reason: 'data_or_blob_uri' };
	}

	// 1. Check URL against ad/icon/avatar/thumbnail blacklist
	for (const re of AD_OR_CHROME_URL_PATTERNS) {
		if (re.test(url)) {
			return { accepted: false, score: -90, reason: 'ad_or_ui_asset_url' };
		}
	}

	// 2. Check class/id/alt attributes
	const combinedAttrs = `${className} ${id} ${alt}`;
	for (const re of AD_OR_CHROME_ATTR_PATTERNS) {
		if (re.test(combinedAttrs)) {
			return { accepted: false, score: -85, reason: 'ad_or_ui_attribute' };
		}
	}

	// 3. Check explicit dimensions when known
	if (widthAttr > 0 && widthAttr < 160) {
		return { accepted: false, score: -80, reason: `tiny_width_${widthAttr}px` };
	}
	if (heightAttr > 0 && heightAttr < 160) {
		return { accepted: false, score: -80, reason: `tiny_height_${heightAttr}px` };
	}
	// Standard horizontal leaderboard/mobile ad banners (e.g. 728x90, 970x90, 468x60, 320x50)
	if (widthAttr > 0 && heightAttr > 0 && widthAttr / heightAttr > 3.5 && heightAttr <= 240) {
		return { accepted: false, score: -85, reason: `horizontal_ad_banner_${widthAttr}x${heightAttr}` };
	}

	// 4. Context scoring
	let score = 10;
	if (hasExplicitPageAttr) {
		score += 50;
	}
	if (!hasExplicitPageAttr && isInsideUnclosedNegativeContainer(precedingHtmlContext)) {
		return { accepted: false, score: -70, reason: 'inside_navigation_or_ad_container' };
	}
	if (POSITIVE_READER_CONTEXT_PATTERNS.some((re) => re.test(precedingHtmlContext) || re.test(combinedAttrs))) {
		score += 35;
	}

	// 5.Sequential filename or chapter path boost
	if (/(?:\/|_|-)(?:page|p|img|image|ch|chapter|ep|episode)?[-_]?\d{1,4}\.(?:webp|jpe?g|png)(?:[?#]|$)/i.test(url)) {
		score += 25;
	}

	const isVerticalStripHint =
		(widthAttr > 0 && heightAttr > 0 && heightAttr / widthAttr >= 1.8) ||
		heightAttr >= 1500 ||
		/\b(?:webtoon|vertical|strip|_images)\b/i.test(combinedAttrs);

	if (isVerticalStripHint) {
		score += 15;
	}

	return { accepted: score > 0, score, isVerticalStripHint };
}

// ─── Extraction Policy & Official WEBTOON Compliance ─────────────────────────

const OFFICIAL_WEBTOON_HOSTS = ['webtoons.com', 'www.webtoons.com', 'm.webtoons.com'] as const;

export function isOfficialWebtoonHost(hostname: string): boolean {
	const h = hostname.toLowerCase();
	return OFFICIAL_WEBTOON_HOSTS.some((w) => h === w || h.endsWith(`.${w}`));
}

/**
 * Checks whether a page or domain explicitly prohibits automated chapter image extraction.
 * - Official WEBTOON (`webtoons.com`) prohibits automated scraping/redistribution in its Terms of Use
 *   and enforces hotlink/DRM restrictions on `webtoon-phinf.pstatic.net`, unless the page explicitly
 *   declares an open/authorized extraction policy (`data-extraction-policy="allowed"`).
 * - Any page with `data-extraction-policy="prohibited"`, `data-allow-import="false"`,
 *   `<meta name="aethera-import" content="deny">`, or DRM lock markers is respected without bypass.
 */
export function detectExtractionPolicy(
	html: string,
	url: URL,
): { permitted: boolean; code?: 'import_not_permitted' | 'access_restricted'; reason?: string } {
	// Explicit prohibition markers in HTML/meta
	if (
		/\bdata-extraction-policy\s*=\s*["']prohibited["']/i.test(html) ||
		/\bdata-allow-import\s*=\s*["']false["']/i.test(html) ||
		/<meta\b[^>]*name\s*=\s*["'](?:aethera-import|extraction-policy)["'][^>]*content\s*=\s*["'](?:deny|prohibited|disallowed)["']/i.test(html) ||
		/\bclass\s*=\s*["'][^"']*\bdrm-protected-content\b[^"']*["']/i.test(html)
	) {
		return {
			permitted: false,
			code: 'import_not_permitted',
			reason:
				'[import_not_permitted] Importação não permitida: a fonte proíbe explicitamente a extração automatizada deste conteúdo. Utilize a Importação Assistida por arquivos apenas para obras com autorização legítima.',
		};
	}

	// Official WEBTOON viewer compliance check
	if (isOfficialWebtoonHost(url.hostname)) {
		const explicitlyAllowed = /\bdata-extraction-policy\s*=\s*["']allowed["']/i.test(html);
		if (!explicitlyAllowed) {
			return {
				permitted: false,
				code: 'import_not_permitted',
				reason:
					'[import_not_permitted] Importação automática não permitida no leitor oficial WEBTOON (proteção de direitos autorais / anti-hotlink nos termos da plataforma). Imagens exibidas no navegador não podem ser baixadas ou redistribuídas automaticamente. Para conteúdo próprio ou licenciado, utilize a Importação Assistida por arquivos (CBZ/PDF/Imagens).',
			};
		}
	}

	return { permitted: true };
}

// ─── Universal Metadata Parser ───────────────────────────────────────────────

function cleanTitleFromSlug(slug: string): string {
	const cleaned = slug
		.replace(/-[a-f0-9]{6,10}$/i, '')
		.replace(/^(?:manga|manhwa|webtoon|comic|series)-/i, '');
	return (
		cleaned
			.split(/[-_]+/)
			.filter(Boolean)
			.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
			.join(' ') || 'Obra'
	);
}

export function parseUniversalChapterMetadata(url: URL, html?: string): ParsedChapterUrlMeta {
	const path = url.pathname;
	const segments = path.split('/').filter(Boolean);

	let rawWorkSlug = '';
	let chapterNumber = '';

	// Pattern 1: /<collection>/<work-slug>/chapter/<num> or /<work-slug>/episode-<num>
	const p1 =
		/\/(?:comics?|series|mangas?|manhwas?|webtoons?|obras?|titles?|read)\/([^/]+)\/(?:chapters?|capitulos?|caps?|episodes?|eps?|ch)[-_/\s]*([0-9]+(?:\.[0-9]+)?)/i.exec(
			path,
		);
	// Pattern 2: /<work-slug>/(?:chapter|capitulo|ep|episode|ch)[-_/<num>]
	const p2 = /\/([^/]+)\/(?:chapters?|capitulos?|caps?|episodes?|eps?|ch)[-_/\s]*([0-9]+(?:\.[0-9]+)?)/i.exec(path);
	// Pattern 3: /read/<work-slug>-chapter-<num>
	const p3 = /\/([a-z0-9-_]+?)-(?:chapter|capitulo|cap|episode|ep|ch)-([0-9]+(?:\.[0-9]+)?)(?:\/|$)/i.exec(path);
	// Pattern 4: Webtoon query style: /<lang>/<genre>/<work-slug>/<ep-slug>/viewer?title_no=...&episode_no=12
	const epQuery = url.searchParams.get('episode_no') ?? url.searchParams.get('chapter') ?? url.searchParams.get('ep') ?? url.searchParams.get('ch');

	if (p1) {
		rawWorkSlug = p1[1]!;
		chapterNumber = p1[2]!;
	} else if (p2) {
		rawWorkSlug = p2[1]!;
		chapterNumber = p2[2]!;
	} else if (p3) {
		rawWorkSlug = p3[1]!;
		chapterNumber = p3[2]!;
	} else if (epQuery && /^[0-9]+(?:\.[0-9]+)?$/.test(epQuery.trim())) {
		chapterNumber = epQuery.trim();
		// On webtoons.com/<lang>/<genre>/<title>/<ep>/viewer -> segments[2] is title
		if (isOfficialWebtoonHost(url.hostname) && segments.length >= 3) {
			rawWorkSlug = segments[2]!;
		} else {
			rawWorkSlug = segments.find((s) => !/^(?:viewer|read|chapter|episode|en|pt|es|id|fr|de)$/i.test(s)) ?? url.hostname;
		}
	} else {
		// Fallback: look for trailing number in pathname
		const trailingNum = /(?:chapter|capitulo|cap|episode|ep|ch|c)[-_/\s]*([0-9]+(?:\.[0-9]+)?)/i.exec(path) ?? /\/([0-9]+(?:\.[0-9]+)?)\/?$/.exec(path);
		chapterNumber = trailingNum?.[1] ?? '1';
		rawWorkSlug =
			segments.find((s) => !/^(?:comics?|series|mangas?|manhwas?|webtoons?|read|viewer|chapters?|episodes?|\d+)$/i.test(s)) ??
			url.hostname.replace(/^www\./i, '').split('.')[0] ??
			'obra';
	}

	let workTitle = cleanTitleFromSlug(rawWorkSlug);

	// Enrich from HTML <title> or og:title if available and rawWorkSlug looks generic
	if (html) {
		const ogTitle = /<meta\b[^>]*property\s*=\s*["']og:title["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(html)?.[1];
		const docTitle = /<title[^>]*>([^<]+)<\/title>/i.exec(html)?.[1];
		const candidateTitle = (ogTitle ?? docTitle ?? '').trim();
		if (candidateTitle && !/just a moment|cloudflare|access denied|login/i.test(candidateTitle)) {
			const stripped = candidateTitle
				.replace(/\s*[-|–—:]\s*(?:chapter|cap[íi]tulo|ep(?:isode)?)\s*[0-9.]+.*$/i, '')
				.replace(/\s+(?:chapter|cap[íi]tulo|ep(?:isode)?)\s*[0-9.]+.*$/i, '')
				.replace(/\s*[-|–—]\s*[^-|–—]+$/, '')
				.trim();
			if (stripped && stripped.length >= 2 && stripped.length <= 80 && (!rawWorkSlug || rawWorkSlug === 'obra')) {
				workTitle = stripped;
				rawWorkSlug = sanitizeStorageSlug(stripped, 'obra');
			}
		}
	}

	const workSlug = sanitizeStorageSlug(rawWorkSlug, 'obra');
	return {
		workSlug,
		workTitle,
		chapterNumber: chapterNumber.trim() || '1',
		chapterSlug: sanitizeStorageSlug(`${workSlug}-ch-${chapterNumber}`, 'chapter'),
	};
}

// ─── Multi-Layer Universal HTML Analyzer ─────────────────────────────────────

function resolveAttrUrl(raw: string | undefined, baseUrl: URL): string | null {
	if (!raw) return null;
	const trimmed = raw.trim().replace(/&amp;/g, '&');
	if (!trimmed || trimmed.startsWith('data:') || trimmed.startsWith('blob:') || trimmed.startsWith('javascript:')) {
		return null;
	}
	try {
		const resolved = new URL(trimmed, baseUrl);
		if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') return null;
		return resolved.toString();
	} catch {
		return null;
	}
}

function extractAttr(tag: string, attrName: string): string | undefined {
	const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>"']+))`, 'i');
	const m = re.exec(tag);
	return m?.[1] ?? m?.[2] ?? m?.[3];
}

function pickBestUrlFromSrcset(srcset: string | undefined, baseUrl: URL): string | null {
	if (!srcset) return null;
	const entries = srcset
		.split(',')
		.map((part) => part.trim().split(/\s+/))
		.filter((tokens) => tokens.length >= 1 && Boolean(tokens[0]));
	if (entries.length === 0) return null;
	// Sort by width descriptor (e.g. "1200w" or "2x") descending
	entries.sort((a, b) => {
		const parseWeight = (desc?: string) => {
			if (!desc) return 1;
			if (desc.endsWith('w')) return Number.parseFloat(desc) || 1;
			if (desc.endsWith('x')) return (Number.parseFloat(desc) || 1) * 1000;
			return 1;
		};
		return parseWeight(b[1]) - parseWeight(a[1]);
	});
	return resolveAttrUrl(entries[0]?.[0], baseUrl);
}

/**
 * Extracts image URLs embedded inside hydration scripts (`__NEXT_DATA__`, `ts_reader.run`,
 * or inline JSON arrays like `"images": ["https://..."]`).
 */
function extractHydrationScriptImages(html: string, baseUrl: URL): string[] {
	const discovered: string[] = [];
	const seen = new Set<string>();

	const pushIfValid = (raw: string) => {
		const unescaped = raw.replace(/\\\//g, '/').replace(/\\u002F/gi, '/');
		const resolved = resolveAttrUrl(unescaped, baseUrl);
		if (!resolved || seen.has(resolved)) return;
		if (!/\.(?:webp|jpe?g|png)(?:[?#][^"'\s]*)?$/i.test(resolved)) return;
		const check = classifyCandidateImageForChapter({ url: resolved });
		if (!check.accepted) return;
		seen.add(resolved);
		discovered.push(resolved);
	};

	// 1. ts_reader.run({ ... "sources": [{ "images": [...] }] })
	const tsReaderMatch = /ts_reader\.run\s*\(\s*(\{[\s\S]*?\})\s*\)/i.exec(html);
	if (tsReaderMatch?.[1]) {
		const cleanTsBlock = tsReaderMatch[1].replace(/\\\//g, '/').replace(/\\u002F/gi, '/');
		const urlMatches = cleanTsBlock.match(/https?:\/\/[^"'\s,\\]+\.(?:webp|jpe?g|png)(?:[?#][^"'\s,\\]*)?/gi) ?? [];
		for (const u of urlMatches) pushIfValid(u);
	}

	// 2. __NEXT_DATA__ or inline JSON arrays under keys: images, pages, chapterImages, pageList
	const arrayKeyPattern = /"(?:images|pages|chapterImages|pageList|chapter_images|imageList)"\s*:\s*\[([\s\S]*?)\]/gi;
	let arrMatch: RegExpExecArray | null;
	while ((arrMatch = arrayKeyPattern.exec(html)) !== null) {
		const cleanBlock = (arrMatch[1] ?? '').replace(/\\\//g, '/').replace(/\\u002F/gi, '/');
		const urls = cleanBlock.match(/(?:https?:\/\/|\/)[^"'\s,\\]+\.(?:webp|jpe?g|png)(?:[?#][^"'\s,\\]*)?/gi) ?? [];
		for (const u of urls) pushIfValid(u);
	}

	return discovered;
}

/**
 * Computes a directory/CDN prefix key for clustering chapter images vs stray external banners.
 */
function getUrlClusterPrefix(rawUrl: string): string {
	try {
		const u = new URL(rawUrl);
		const parts = u.pathname.split('/').filter(Boolean);
		const dir = parts.slice(0, -1).join('/');
		return `${u.origin}/${dir}`;
	} catch {
		return 'unknown';
	}
}

export function analyzeUniversalReaderHtml(html: string, baseUrl: URL): UniversalStructuralAnalysis {
	const meta = parseUniversalChapterMetadata(baseUrl, html);
	const policy = detectExtractionPolicy(html, baseUrl);
	if (!policy.permitted) {
		return {
			state: 'import_not_permitted',
			stateLabel: UNIVERSAL_IMPORT_STATE_LABELS.import_not_permitted,
			isRecognizedChapter: true,
			isPermitted: false,
			...(policy.reason ? { prohibitionReason: policy.reason } : {}),
			formatHint: isOfficialWebtoonHost(baseUrl.hostname) ? 'webtoon_vertical' : 'unknown',
			meta,
			pages: [],
			availableChapters: [],
			filteredOutCount: 0,
			filteredOutSamples: [],
			verticalStripCount: 0,
		};
	}

	const filteredOutSamples: Array<{ url: string; reason: string }> = [];
	let filteredOutCount = 0;

	interface RawCandidate {
		url: string;
		alt?: string;
		explicitOrder?: number;
		domIndex: number;
		score: number;
		width?: number;
		height?: number;
		isVerticalStrip?: boolean;
		clusterPrefix: string;
	}

	const candidates: RawCandidate[] = [];
	const seenUrls = new Set<string>();

	// Layer A: Scan all <img> tags and containers with data-page / data-index
	const imgTagRe = /<img\b[^>]*>/gi;
	let match: RegExpExecArray | null;
	let domIndex = 0;

	while ((match = imgTagRe.exec(html)) !== null) {
		domIndex++;
		const imgTag = match[0];
		const matchIndex = match.index;
		const precedingStart = Math.max(0, matchIndex - 500);
		const precedingHtmlContext = html.slice(precedingStart, matchIndex);

		const rawSrc =
			extractAttr(imgTag, 'data-current-src') ??
			extractAttr(imgTag, 'data-src') ??
			extractAttr(imgTag, 'data-lazy-src') ??
			extractAttr(imgTag, 'data-original') ??
			extractAttr(imgTag, 'data-url') ??
			extractAttr(imgTag, 'src');

		const resolvedUrl =
			resolveAttrUrl(rawSrc, baseUrl) ??
			pickBestUrlFromSrcset(extractAttr(imgTag, 'data-srcset') ?? extractAttr(imgTag, 'srcset'), baseUrl);

		if (!resolvedUrl || seenUrls.has(resolvedUrl)) continue;

		// Check explicit page order on the <img> itself or its immediate parent container
		const selfPageAttr =
			extractAttr(imgTag, 'data-page') ??
			extractAttr(imgTag, 'data-index') ??
			extractAttr(imgTag, 'data-number') ??
			extractAttr(imgTag, 'data-image-index');
		const parentPageMatch = /\bdata-(?:page|index|number|image-index)\s*=\s*(?:"(\d+)"|'(\d+)'|(\d+))[^>]*>\s*$/i.exec(
			precedingHtmlContext,
		);
		const pageNumStr = selfPageAttr ?? parentPageMatch?.[1] ?? parentPageMatch?.[2] ?? parentPageMatch?.[3];
		const explicitOrder = pageNumStr !== undefined && /^\d+$/.test(pageNumStr) ? Number.parseInt(pageNumStr, 10) : undefined;

		const widthAttr = Number.parseInt(extractAttr(imgTag, 'width') ?? '0', 10) || 0;
		const heightAttr = Number.parseInt(extractAttr(imgTag, 'height') ?? '0', 10) || 0;
		const alt = extractAttr(imgTag, 'alt')?.trim();
		const className = extractAttr(imgTag, 'class') ?? '';
		const id = extractAttr(imgTag, 'id') ?? '';

		const verdict = classifyCandidateImageForChapter({
			url: resolvedUrl,
			...(alt ? { alt } : {}),
			className,
			id,
			widthAttr,
			heightAttr,
			precedingHtmlContext,
			hasExplicitPageAttr: explicitOrder !== undefined,
		});

		if (!verdict.accepted) {
			filteredOutCount++;
			if (filteredOutSamples.length < 10) {
				filteredOutSamples.push({ url: resolvedUrl, reason: verdict.reason ?? 'filtered' });
			}
			continue;
		}

		seenUrls.add(resolvedUrl);
		candidates.push({
			url: resolvedUrl,
			...(alt ? { alt } : {}),
			...(explicitOrder !== undefined ? { explicitOrder } : {}),
			domIndex,
			score: verdict.score,
			...(widthAttr > 0 ? { width: widthAttr } : {}),
			...(heightAttr > 0 ? { height: heightAttr } : {}),
			...(verdict.isVerticalStripHint ? { isVerticalStrip: true } : {}),
			clusterPrefix: getUrlClusterPrefix(resolvedUrl),
		});
	}

	// Layer B: Hydration JSON / Next.js / ts_reader fallback or supplement
	const hydrationUrls = extractHydrationScriptImages(html, baseUrl);
	for (const hUrl of hydrationUrls) {
		if (seenUrls.has(hUrl)) continue;
		seenUrls.add(hUrl);
		domIndex++;
		candidates.push({
			url: hUrl,
			domIndex,
			score: 40,
			clusterPrefix: getUrlClusterPrefix(hUrl),
		});
	}

	// Layer C: Sequence & Cluster Cohesion Filtering
	// If there is a dominant high-confidence cluster (>= 2 images in reader container or same CDN prefix),
	// drop low-score outlier images from unrelated prefixes that have no explicit page attribute.
	let finalCandidates = candidates;
	if (candidates.length >= 3) {
		const prefixCounts = new Map<string, number>();
		for (const c of candidates) {
			prefixCounts.set(c.clusterPrefix, (prefixCounts.get(c.clusterPrefix) ?? 0) + 1);
		}
		const maxClusterSize = Math.max(...prefixCounts.values());
		if (maxClusterSize >= 2) {
			finalCandidates = candidates.filter((c) => {
				const clusterSize = prefixCounts.get(c.clusterPrefix) ?? 1;
				const keep = c.explicitOrder !== undefined || c.score >= 45 || clusterSize >= 2;
				if (!keep) {
					filteredOutCount++;
					if (filteredOutSamples.length < 10) {
						filteredOutSamples.push({ url: c.url, reason: 'unclustered_outlier_image' });
					}
				}
				return keep;
			});
		}
	}

	// Sort reading order: explicit data-page/data-index order when present, otherwise DOM vertical order
	const hasAllExplicitOrder = finalCandidates.length > 0 && finalCandidates.every((c) => c.explicitOrder !== undefined);
	finalCandidates.sort((a, b) => {
		if (hasAllExplicitOrder || (a.explicitOrder !== undefined && b.explicitOrder !== undefined)) {
			if (a.explicitOrder! !== b.explicitOrder!) return a.explicitOrder! - b.explicitOrder!;
		}
		return a.domIndex - b.domIndex;
	});

	// Determine whether this page is actually a recognizable chapter reader page
	const hasReaderLandmark =
		POSITIVE_READER_CONTEXT_PATTERNS.some((re) => re.test(html)) ||
		/(?:chapter|cap[íi]tulo|episode|ep\.|leitor|viewer|reader)/i.test(html);
	const verticalStripCount = finalCandidates.filter((c) => c.isVerticalStrip).length;

	// A page is a valid recognized chapter if:
	// - It has >= 2 chapter images, OR
	// - It has 1 chapter image that is an explicit [data-page], a tall vertical webtoon strip, or inside a dedicated reader container.
	const isRecognizedChapter =
		finalCandidates.length >= 2 ||
		(finalCandidates.length === 1 &&
			(finalCandidates[0]!.explicitOrder !== undefined ||
				Boolean(finalCandidates[0]!.isVerticalStrip) ||
				finalCandidates[0]!.score >= 45 ||
				hasReaderLandmark));

	const pages: DiscoveredPage[] = isRecognizedChapter
		? finalCandidates.map((c, idx) => ({
				pageNumber: idx + 1,
				imageUrl: c.url,
				...(c.alt ? { alt: c.alt } : {}),
				...(c.width ? { width: c.width } : {}),
				...(c.height ? { height: c.height } : {}),
				...(c.isVerticalStrip !== undefined ? { isVerticalStrip: c.isVerticalStrip } : {}),
				...(c.width && c.height ? { aspectRatio: Number((c.height / c.width).toFixed(3)) } : {}),
			}))
		: [];

	const availableChapters = extractUniversalChapterLinksFromHtml(html, baseUrl);
	const formatHint: UniversalStructuralAnalysis['formatHint'] =
		verticalStripCount > 0 || isOfficialWebtoonHost(baseUrl.hostname)
			? 'webtoon_vertical'
			: pages.length > 0
				? 'manga_paged'
				: 'unknown';

	return {
		state: isRecognizedChapter ? 'chapter_identified' : 'content_not_recognized',
		stateLabel: isRecognizedChapter
			? UNIVERSAL_IMPORT_STATE_LABELS.chapter_identified
			: UNIVERSAL_IMPORT_STATE_LABELS.content_not_recognized,
		isRecognizedChapter,
		isPermitted: true,
		formatHint,
		meta,
		pages,
		availableChapters,
		filteredOutCount,
		filteredOutSamples,
		verticalStripCount,
	};
}

export function extractUniversalChapterLinksFromHtml(html: string, baseUrl: URL): DiscoveredChapterLink[] {
	const chapters: DiscoveredChapterLink[] = [];
	const seen = new Set<string>();
	const linkRe =
		/<a\b[^>]*href\s*=\s*(?:"([^"]*(?:\/chapter\/|\/capitulo\/|\/episode\/|episode_no=)[^"]*)"|'([^']*(?:\/chapter\/|\/capitulo\/|\/episode\/|episode_no=)[^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
	let m: RegExpExecArray | null;
	while ((m = linkRe.exec(html)) !== null) {
		const href = m[1] ?? m[2];
		const resolved = resolveAttrUrl(href, baseUrl);
		if (!resolved || seen.has(resolved)) continue;
		seen.add(resolved);
		const numMatch =
			/(?:\/chapter\/|\/capitulo\/|\/episode\/|episode_no=)([0-9]+(?:\.[0-9]+)?)/i.exec(resolved);
		const chapterNumber = numMatch?.[1] ?? String(chapters.length + 1);
		const label =
			(m[3] ?? '')
				.replace(/<[^>]+>/g, ' ')
				.replace(/\s+/g, ' ')
				.trim() || `Capítulo ${chapterNumber}`;
		chapters.push({ chapterNumber, title: label, url: resolved });
	}
	return chapters.sort((a, b) => Number.parseFloat(a.chapterNumber) - Number.parseFloat(b.chapterNumber));
}

// ─── Official WEBTOON Adapter & Universal Adapter ────────────────────────────

export const webtoonOfficialAdapter: ChapterSiteAdapter = {
	id: 'webtoons_official',
	displayName: 'WEBTOON (Leitor Oficial)',
	supportedHosts: OFFICIAL_WEBTOON_HOSTS,

	matchesUrl(url: URL): boolean {
		return isOfficialWebtoonHost(url.hostname);
	},

	parseChapterMetadata(url: URL): ParsedChapterUrlMeta {
		return parseUniversalChapterMetadata(url);
	},

	detectAccessRestriction(html: string, url?: URL): string | null {
		const targetUrl = url ?? new URL('https://www.webtoons.com/');
		const policy = detectExtractionPolicy(html, targetUrl);
		if (!policy.permitted) {
			return policy.reason ?? '[import_not_permitted] Importação não permitida pela fonte.';
		}
		return null;
	},

	extractPagesFromHtml(html: string, baseUrl: URL): DiscoveredPage[] {
		const analysis = analyzeUniversalReaderHtml(html, baseUrl);
		if (!analysis.isPermitted) return [];
		return analysis.pages;
	},

	extractAvailableChaptersFromHtml(html: string, baseUrl: URL): DiscoveredChapterLink[] {
		return extractUniversalChapterLinksFromHtml(html, baseUrl);
	},
};

export const universalChapterAdapter: ChapterSiteAdapter = {
	id: 'universal',
	displayName: 'Importador Universal Estrutural',
	supportedHosts: ['*'],

	matchesUrl(_url: URL): boolean {
		return true;
	},

	parseChapterMetadata(url: URL): ParsedChapterUrlMeta {
		return parseUniversalChapterMetadata(url);
	},

	detectAccessRestriction(html: string, url?: URL): string | null {
		if (url) {
			const policy = detectExtractionPolicy(html, url);
			if (!policy.permitted) {
				return policy.reason ?? '[import_not_permitted] Importação não permitida pela fonte.';
			}
		} else if (
			/\bdata-extraction-policy\s*=\s*["']prohibited["']/i.test(html) ||
			/\bdata-allow-import\s*=\s*["']false["']/i.test(html)
		) {
			return '[import_not_permitted] Importação não permitida: a fonte proíbe explicitamente a extração automatizada deste conteúdo.';
		}

		// Only flag as Cloudflare/CAPTCHA restricted if it is an actual challenge/interstitial WITHOUT chapter images
		const hasChallengeMarker =
			/<title>\s*(?:just a moment\.\.\.|attention required!|security check|ddos-guard|verificando seu navegador)/i.test(
				html,
			) ||
			/id\s*=\s*["'](?:cf-challenge-running|challenge-running|challenge-stage|cf-please-wait)["']/i.test(html);
		if (hasChallengeMarker) {
			return 'Acesso restrito pelo site (CAPTCHA ou desafio Cloudflare). Utilize o Navegador Persistente ou a Importação Assistida por arquivos.';
		}

		return null;
	},

	extractPagesFromHtml(html: string, baseUrl: URL): DiscoveredPage[] {
		const analysis = analyzeUniversalReaderHtml(html, baseUrl);
		if (!analysis.isPermitted || !analysis.isRecognizedChapter) return [];
		return analysis.pages;
	},

	extractAvailableChaptersFromHtml(html: string, baseUrl: URL): DiscoveredChapterLink[] {
		return extractUniversalChapterLinksFromHtml(html, baseUrl);
	},
};
