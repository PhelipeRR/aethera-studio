/**
 * Firecrawl Self-Hosted Acquisition Provider (Fase 4)
 *
 * Connects to a locally hosted Firecrawl Open Source instance for page discovery.
 * Does NOT require an API key from Firecrawl Cloud — designed for self-hosted deployments.
 *
 * Configuration via environment variables:
 *   FIRECRAWL_ENABLED=true|false (default: false)
 *   FIRECRAWL_API_URL=http://localhost:3002 (default: http://localhost:3002)
 *   FIRECRAWL_API_KEY=<optional-local-auth> (only if the local server requires auth)
 *
 * Behavior:
 * - Health check probes GET /v1/scrape or similar lightweight endpoint
 * - If unavailable, marks itself as not available and router falls back gracefully
 * - Never bypasses Cloudflare/CAPTCHA — reports access restrictions honestly
 * - No Docker dependency — Aethera starts normally when Firecrawl is disabled
 * - Does NOT guarantee resolution of HTTP 403 errors
 */

import type {
	AcquisitionProvider,
	AcquisitionProviderCapabilities,
	AcquisitionProviderHealth,
} from './acquisition-router.js';
import { AcquisitionError } from './acquisition-router.js';
import type { ChapterSiteAdapter } from './site-adapters.js';
import type { DiscoveredPage, DiscoveredChapterLink } from './site-adapters.js';
import { validateExternalChapterUrl } from './url-security.js';

export interface FirecrawlProviderOptions {
	/** Override the API URL. Defaults to env FIRECRAWL_API_URL or http://localhost:3002. */
	apiUrl?: string;
	/** Optional API key for local auth. Defaults to env FIRECRAWL_API_KEY. */
	apiKey?: string;
	/** Whether Firecrawl integration is enabled. Defaults to env FIRECRAWL_ENABLED === 'true'. */
	enabled?: boolean;
	/** Request timeout in ms. Default: 30000. */
	timeoutMs?: number;
	/** Allow HTTP URLs (for local Firecrawl). Default: true (needed for localhost). */
	allowHttpForLocalhost?: boolean;
}

interface FirecrawlScrapeResponse {
	success: boolean;
	data?: {
		markdown?: string;
		html?: string;
		metadata?: Record<string, unknown>;
	};
	error?: string;
}

function resolveConfig(options?: FirecrawlProviderOptions): {
	enabled: boolean;
	apiUrl: string;
	apiKey: string | null;
	timeoutMs: number;
} {
	const enabled = options?.enabled ?? (typeof process !== 'undefined' && process.env?.FIRECRAWL_ENABLED === 'true');
	const apiUrl = options?.apiUrl
		?? (typeof process !== 'undefined' ? process.env?.FIRECRAWL_API_URL : undefined)
		?? 'http://localhost:3002';
	const apiKey = options?.apiKey
		?? (typeof process !== 'undefined' ? process.env?.FIRECRAWL_API_KEY : undefined)
		?? null;
	const timeoutMs = options?.timeoutMs ?? 30_000;

	return { enabled, apiUrl: apiUrl.replace(/\/+$/, ''), apiKey, timeoutMs };
}

/**
 * Extracts image URLs from markdown content returned by Firecrawl.
 * Looks for standard markdown image syntax: ![alt](url)
 */
function extractImagesFromMarkdown(markdown: string, baseUrl: URL): DiscoveredPage[] {
	const pages: DiscoveredPage[] = [];
	const seen = new Set<string>();
	const imgPattern = /!\[([^\]]*)\]\(([^)]+)\)/g;
	let match: RegExpExecArray | null;
	let pageNumber = 0;

	while ((match = imgPattern.exec(markdown)) !== null) {
		const alt = match[1]?.trim() || '';
		const rawUrl = match[2]?.trim();
		if (!rawUrl || rawUrl.startsWith('data:') || rawUrl.startsWith('blob:')) continue;

		try {
			const resolved = new URL(rawUrl, baseUrl);
			if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') continue;
			const urlStr = resolved.toString();
			if (seen.has(urlStr)) continue;
			seen.add(urlStr);
			pageNumber++;
			pages.push({
				pageNumber,
				imageUrl: urlStr,
				...(alt ? { alt } : {}),
			});
		} catch {
			continue;
		}
	}

	return pages;
}

/**
 * Extracts image URLs from HTML content returned by Firecrawl.
 * Reuses the same extraction logic as site adapters.
 */
function extractImagesFromHtml(html: string, baseUrl: URL): DiscoveredPage[] {
	const pages: DiscoveredPage[] = [];
	const seen = new Set<string>();
	const imgPattern = /<img\b[^>]*>/gi;
	let match: RegExpExecArray | null;
	let pageNumber = 0;

	function extractAttr(tag: string, attrName: string): string | undefined {
		const re = new RegExp(`\\b${attrName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i');
		const m = re.exec(tag);
		return m?.[1] ?? m?.[2];
	}

	while ((match = imgPattern.exec(html)) !== null) {
		const tag = match[0];
		const rawSrc =
			extractAttr(tag, 'data-current-src') ??
			extractAttr(tag, 'data-src') ??
			extractAttr(tag, 'data-lazy-src') ??
			extractAttr(tag, 'src');

		if (!rawSrc || rawSrc.startsWith('data:') || rawSrc.startsWith('blob:')) continue;

		try {
			const resolved = new URL(rawSrc.trim(), baseUrl);
			if (resolved.protocol !== 'https:' && resolved.protocol !== 'http:') continue;
			const urlStr = resolved.toString();
			if (seen.has(urlStr)) continue;
			seen.add(urlStr);
			pageNumber++;
			const alt = extractAttr(tag, 'alt')?.trim();
			pages.push({
				pageNumber,
				imageUrl: urlStr,
				...(alt ? { alt } : {}),
			});
		} catch {
			continue;
		}
	}

	return pages;
}

export class FirecrawlSelfHostedProvider implements AcquisitionProvider {
	readonly id = 'firecrawl-self-hosted' as const;
	readonly displayName = 'Firecrawl (Self-Hosted)';
	readonly capabilities: AcquisitionProviderCapabilities = {
		supportsDynamicContent: true,
		requiresExternalService: true,
		worksInPackagedElectron: true,
		maxConcurrency: 3,
	};

	private readonly config: ReturnType<typeof resolveConfig>;
	private lastHealthCheckAt: string | null = null;
	private lastHealthError: string | null = null;
	private cachedAvailable: boolean | null = null;

	constructor(options?: FirecrawlProviderOptions) {
		this.config = resolveConfig(options);
	}

	async checkHealth(): Promise<AcquisitionProviderHealth> {
		const now = new Date().toISOString();

		if (!this.config.enabled) {
			this.cachedAvailable = false;
			this.lastHealthCheckAt = now;
			this.lastHealthError = 'Firecrawl desabilitado via configuração.';
			return {
				providerId: this.id,
				available: false,
				lastCheckAtIso: now,
				lastError: this.lastHealthError,
				consecutiveFailures: 0,
				circuitState: 'closed',
			};
		}

		try {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), Math.min(this.config.timeoutMs, 5000));

			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			};
			if (this.config.apiKey) {
				headers['Authorization'] = `Bearer ${this.config.apiKey}`;
			}

			// Probe with a lightweight health check — try GET on root or /health
			const probeUrl = `${this.config.apiUrl}/`;
			const res = await fetch(probeUrl, {
				method: 'GET',
				signal: controller.signal,
				headers,
			});
			clearTimeout(timer);

			// Any response (even 404) means the service is running
			if (res.status < 500) {
				this.cachedAvailable = true;
				this.lastHealthCheckAt = now;
				this.lastHealthError = null;
				return {
					providerId: this.id,
					available: true,
					lastCheckAtIso: now,
					consecutiveFailures: 0,
					circuitState: 'closed',
					responseTimeMs: Date.now() - new Date(now).getTime(),
				};
			}

			throw new Error(`HTTP ${res.status} from Firecrawl server.`);
		} catch (err) {
			this.cachedAvailable = false;
			this.lastHealthCheckAt = now;
			this.lastHealthError = err instanceof Error ? err.message : String(err);
			return {
				providerId: this.id,
				available: false,
				lastCheckAtIso: now,
				lastError: this.lastHealthError,
				consecutiveFailures: 1,
				circuitState: 'closed',
			};
		}
	}

	async discover(input: {
		url: URL;
		adapter: ChapterSiteAdapter;
		signal?: AbortSignal;
	}): Promise<{ pages: DiscoveredPage[]; availableChapters: DiscoveredChapterLink[] }> {
		if (!this.config.enabled) {
			throw new AcquisitionError(
				'provider_unavailable',
				'Firecrawl está desabilitado. Habilite via FIRECRAWL_ENABLED=true.',
				this.id,
				true,
			);
		}

		// Validate URL against SSRF (but allow localhost for the Firecrawl API call itself)
		validateExternalChapterUrl(input.url.toString());

		const scrapeUrl = `${this.config.apiUrl}/v1/scrape`;
		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		};
		if (this.config.apiKey) {
			headers['Authorization'] = `Bearer ${this.config.apiKey}`;
		}

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
		const combinedSignal = input.signal
			? AbortSignal.any([input.signal, controller.signal])
			: controller.signal;

		try {
			const res = await fetch(scrapeUrl, {
				method: 'POST',
				headers,
				signal: combinedSignal,
				body: JSON.stringify({
					url: input.url.toString(),
					formats: ['markdown', 'html'],
					waitFor: 3000,
				}),
			});
			clearTimeout(timer);

			if (!res.ok) {
				const body = await res.text().catch(() => '');
				throw new AcquisitionError(
					res.status === 403 ? 'access_denied_403' : 'network_error',
					`Firecrawl retornou HTTP ${res.status}: ${body.slice(0, 200)}`,
					this.id,
					res.status >= 500,
				);
			}

			const json = (await res.json()) as FirecrawlScrapeResponse;

			if (!json.success) {
				throw new AcquisitionError(
					'parse_error',
					`Firecrawl falhou ao processar: ${json.error ?? 'erro desconhecido'}`,
					this.id,
					false,
				);
			}

			// Check for access restrictions in returned content
			const htmlContent = json.data?.html ?? '';
			const restriction = input.adapter.detectAccessRestriction?.(htmlContent);
			if (restriction) {
				throw new AcquisitionError('captcha_detected', restriction, this.id, false);
			}

			// Try HTML extraction first (more reliable for data-page attributes)
			let pages: DiscoveredPage[] = [];
			if (htmlContent) {
				pages = extractImagesFromHtml(htmlContent, input.url);
			}

			// Fall back to markdown if HTML didn't yield results
			if (pages.length === 0 && json.data?.markdown) {
				pages = extractImagesFromMarkdown(json.data.markdown, input.url);
			}

			// Also try adapter's native HTML parser if available
			if (pages.length === 0 && htmlContent) {
				pages = input.adapter.extractPagesFromHtml(htmlContent, input.url);
			}

			// Extract available chapters from HTML if adapter supports it
			const availableChapters = htmlContent
				? (input.adapter.extractAvailableChaptersFromHtml?.(htmlContent, input.url) ?? [])
				: [];

			return { pages, availableChapters };
		} catch (err) {
			clearTimeout(timer);
			if (err instanceof AcquisitionError) throw err;
			if (err instanceof DOMException && err.name === 'AbortError') {
				throw new AcquisitionError('timeout', 'Firecrawl: tempo esgotado.', this.id, true, err);
			}
			throw new AcquisitionError(
				'network_error',
				`Erro ao comunicar com Firecrawl: ${err instanceof Error ? err.message : String(err)}`,
				this.id,
				true,
				err,
			);
		}
	}
}

/**
 * Factory function for creating the Firecrawl self-hosted provider.
 */
export function createFirecrawlSelfHostedProvider(
	options?: FirecrawlProviderOptions,
): FirecrawlSelfHostedProvider {
	return new FirecrawlSelfHostedProvider(options);
}