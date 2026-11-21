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
import { createPlaywrightPageDiscoveryPort } from './url-chapter-importer.js';
import {
	analyzeUniversalReaderHtml,
	classifyCandidateImageForChapter,
} from './universal-chapter-adapter.js';

export interface FirecrawlProviderOptions {
	/** Override the API URL. Defaults to env FIRECRAWL_API_URL or http://127.0.0.1:3002. */
	apiUrl?: string;
	/** Optional API key for local auth. Defaults to env FIRECRAWL_API_KEY. */
	apiKey?: string;
	/**
	 * Whether Firecrawl integration is enabled.
	 * Defaults to `true` (auto-detect mode) unless `FIRECRAWL_ENABLED=false` is explicitly set.
	 */
	enabled?: boolean;
	/** Request timeout in ms. Default: 30000. */
	timeoutMs?: number;
	/** Allow HTTP URLs (for local Firecrawl). Default: true (needed for localhost). */
	allowHttpForLocalhost?: boolean;
	/** Allow localhost target URLs (for controlled local tests only). Default: false. */
	allowLocalhostTarget?: boolean;
}

export interface FirecrawlProviderConfigView {
	enabled: boolean;
	apiUrl: string;
	hasApiKey: boolean;
	timeoutMs: number;
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

const CLOUDFLARE_CHALLENGE_PATTERNS: readonly RegExp[] = [
	/cf-challenge/i,
	/challenge-platform/i,
	/just a moment\.\.\./i,
	/attention required!\s*\|\s*cloudflare/i,
	/checking your browser before accessing/i,
	/cf-turnstile/i,
	/verify you are human/i,
	/\bhcaptcha\b|\brecaptcha\b/i,
];

export function detectCloudflareOrChallengeContent(input: {
	html?: string;
	markdown?: string;
	title?: string;
}): string | null {
	const combined = `${input.title ?? ''}\n${input.html ?? ''}\n${input.markdown ?? ''}`;
	for (const pattern of CLOUDFLARE_CHALLENGE_PATTERNS) {
		if (pattern.test(combined)) {
			return 'Bloqueio Cloudflare / desafio anti-bot detectado na resposta — página ignorada (não é um capítulo válido; sem bypass).';
		}
	}
	return null;
}

function resolveConfig(options?: FirecrawlProviderOptions): {
	enabled: boolean;
	apiUrl: string;
	apiKey: string | null;
	timeoutMs: number;
	allowLocalhostTarget: boolean;
} {
	const envEnabled = typeof process !== 'undefined' ? process.env?.FIRECRAWL_ENABLED : undefined;
	const enabled = options?.enabled ?? (envEnabled === 'false' ? false : true);
	const apiUrl = options?.apiUrl
		?? (typeof process !== 'undefined' ? process.env?.FIRECRAWL_API_URL : undefined)
		?? 'http://127.0.0.1:3002';
	const apiKey = options?.apiKey
		?? (typeof process !== 'undefined' ? process.env?.FIRECRAWL_API_KEY : undefined)
		?? null;
	const timeoutMs = options?.timeoutMs ?? 30_000;
	const allowLocalhostTarget = options?.allowLocalhostTarget ?? false;

	return { enabled, apiUrl: apiUrl.replace(/\/+$/, ''), apiKey, timeoutMs, allowLocalhostTarget };
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
			const verdict = classifyCandidateImageForChapter({ url: urlStr, ...(alt ? { alt } : {}) });
			if (!verdict.accepted) continue;
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
			const verdict = classifyCandidateImageForChapter({ url: urlStr, ...(alt ? { alt } : {}) });
			if (!verdict.accepted) continue;
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

	private config: ReturnType<typeof resolveConfig>;
	private lastHealthCheckAt: string | null = null;
	private lastHealthCheckMs = 0;
	private lastHealthError: string | null = null;
	private cachedAvailable: boolean | null = null;

	constructor(options?: FirecrawlProviderOptions) {
		this.config = resolveConfig(options);
	}

	getConfig(): FirecrawlProviderConfigView {
		return {
			enabled: this.config.enabled,
			apiUrl: this.config.apiUrl,
			hasApiKey: Boolean(this.config.apiKey),
			timeoutMs: this.config.timeoutMs,
		};
	}

	updateConfig(patch: { apiUrl?: string; enabled?: boolean; apiKey?: string | null }): FirecrawlProviderConfigView {
		if (typeof patch.apiUrl === 'string' && patch.apiUrl.trim()) {
			const normalized = patch.apiUrl.trim().replace(/\/+$/, '');
			const parsed = new URL(normalized);
			if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
				throw new Error('Endpoint Firecrawl inválido: utilize http:// ou https://.');
			}
			this.config.apiUrl = normalized;
		}
		if (typeof patch.enabled === 'boolean') {
			this.config.enabled = patch.enabled;
		}
		if (patch.apiKey !== undefined) {
			this.config.apiKey = patch.apiKey ? patch.apiKey.trim() : null;
		}
		// Invalidate health cache so next check probes the new endpoint immediately
		this.cachedAvailable = null;
		this.lastHealthCheckMs = 0;
		this.lastHealthError = null;
		return this.getConfig();
	}

	async checkHealth(): Promise<AcquisitionProviderHealth> {
		const startedAt = Date.now();
		const now = new Date(startedAt).toISOString();

		if (!this.config.enabled) {
			this.cachedAvailable = false;
			this.lastHealthCheckAt = now;
			this.lastHealthCheckMs = startedAt;
			this.lastHealthError = 'Firecrawl Local desabilitado nas configurações do Recap.';
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
			const timer = setTimeout(() => controller.abort(), Math.min(this.config.timeoutMs, 2500));

			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			};
			if (this.config.apiKey) {
				headers['Authorization'] = `Bearer ${this.config.apiKey}`;
			}

			// Probe lightweight root endpoint — any HTTP < 500 proves Firecrawl Local is reachable
			const probeUrl = `${this.config.apiUrl}/`;
			const res = await fetch(probeUrl, {
				method: 'GET',
				signal: controller.signal,
				headers,
			});
			clearTimeout(timer);

			if (res.status < 500) {
				this.cachedAvailable = true;
				this.lastHealthCheckAt = now;
				this.lastHealthCheckMs = startedAt;
				this.lastHealthError = null;
				return {
					providerId: this.id,
					available: true,
					lastCheckAtIso: now,
					consecutiveFailures: 0,
					circuitState: 'closed',
					responseTimeMs: Date.now() - startedAt,
				};
			}

			throw new Error(`HTTP ${res.status} no servidor Firecrawl Local.`);
		} catch (err) {
			this.cachedAvailable = false;
			this.lastHealthCheckAt = now;
			this.lastHealthCheckMs = startedAt;
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
				'Firecrawl Local está desabilitado nas configurações.',
				this.id,
				true,
			);
		}

		// Auto-detect availability (15s cache) so offline local Firecrawl falls back cleanly without blocking
		if (this.cachedAvailable === null || Date.now() - this.lastHealthCheckMs > 15_000) {
			const health = await this.checkHealth();
			if (!health.available) {
				throw new AcquisitionError(
					'provider_unavailable',
					`Firecrawl Local indisponível em ${this.config.apiUrl}: ${health.lastError ?? 'sem resposta'}.`,
					this.id,
					true,
				);
			}
		} else if (!this.cachedAvailable) {
			throw new AcquisitionError(
				'provider_unavailable',
				`Firecrawl Local indisponível em ${this.config.apiUrl}.`,
				this.id,
				true,
			);
		}

		// Validate target URL against SSRF (localhost allowed only when explicitly opted-in for local tests)
		validateExternalChapterUrl(input.url.toString(), { allowLocalhost: this.config.allowLocalhostTarget });

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
					formats: ['html', 'markdown'],
					waitFor: 2500,
				}),
			});
			clearTimeout(timer);

			if (!res.ok) {
				const body = await res.text().catch(() => '');
				const cfFromBody = detectCloudflareOrChallengeContent({ html: body });
				if (cfFromBody) {
					throw new AcquisitionError('captcha_detected', cfFromBody, this.id, false);
				}
				if (res.status === 401) {
					throw new AcquisitionError(
						'paywall_detected',
						`Autenticação necessária no Firecrawl ou na fonte (HTTP 401).`,
						this.id,
						false,
					);
				}
				if (res.status === 403) {
					throw new AcquisitionError(
						'access_denied_403',
						`Acesso negado pela fonte via Firecrawl (HTTP 403).`,
						this.id,
						false,
					);
				}
				throw new AcquisitionError(
					res.status === 429 ? 'rate_limited_429' : 'network_error',
					`Firecrawl retornou HTTP ${res.status}: ${body.slice(0, 180)}`,
					this.id,
					res.status >= 500 || res.status === 429,
				);
			}

			const json = (await res.json()) as FirecrawlScrapeResponse;

			if (!json.success) {
				const errText = json.error ?? 'erro desconhecido';
				const cfInErr = detectCloudflareOrChallengeContent({ html: errText });
				if (cfInErr) {
					throw new AcquisitionError('captcha_detected', cfInErr, this.id, false);
				}
				if (/403|forbidden/i.test(errText)) {
					throw new AcquisitionError('access_denied_403', `Acesso negado pela fonte (HTTP 403): ${errText}`, this.id, false);
				}
				if (/401|unauthorized|login/i.test(errText)) {
					throw new AcquisitionError('paywall_detected', `Autenticação necessária (HTTP 401): ${errText}`, this.id, false);
				}
				throw new AcquisitionError(
					'parse_error',
					`Firecrawl falhou ao extrair a página: ${errText}`,
					this.id,
					false,
				);
			}

			const htmlContent = json.data?.html ?? '';
			const markdownContent = json.data?.markdown ?? '';
			const metaStatusCode = typeof json.data?.metadata?.['statusCode'] === 'number'
				? (json.data.metadata['statusCode'] as number)
				: undefined;
			const metaTitle = typeof json.data?.metadata?.['title'] === 'string'
				? (json.data.metadata['title'] as string)
				: undefined;

			// 1. NEVER treat a Cloudflare challenge or CAPTCHA page as a valid chapter
			const cfRestriction = detectCloudflareOrChallengeContent({
				html: htmlContent,
				markdown: markdownContent,
				title: metaTitle,
			});
			if (cfRestriction) {
				throw new AcquisitionError('captcha_detected', cfRestriction, this.id, false);
			}
			const adapterRestriction = input.adapter.detectAccessRestriction?.(htmlContent, input.url);
			if (adapterRestriction) {
				if (/import_not_permitted/i.test(adapterRestriction)) {
					throw new AcquisitionError('import_not_permitted', adapterRestriction, this.id, false);
				}
				throw new AcquisitionError('captcha_detected', adapterRestriction, this.id, false);
			}

			// 2. Differentiate upstream HTTP 401 / 403 reported in Firecrawl metadata
			if (metaStatusCode === 401) {
				throw new AcquisitionError('paywall_detected', 'Fonte exige autenticação (HTTP 401).', this.id, false);
			}
			if (metaStatusCode === 403) {
				throw new AcquisitionError('access_denied_403', 'Fonte retornou acesso negado (HTTP 403) ao Firecrawl.', this.id, false);
			}

			// 3. Extract pages: prefer site adapter HTML parser FIRST, then universal structural analyzer (filtering ads/icons)
			let pages: DiscoveredPage[] = [];
			if (htmlContent) {
				pages = input.adapter.extractPagesFromHtml(htmlContent, input.url);
			}
			if (pages.length === 0 && htmlContent) {
				pages = analyzeUniversalReaderHtml(htmlContent, input.url).pages;
			}
			if (pages.length === 0 && markdownContent) {
				pages = extractImagesFromMarkdown(markdownContent, input.url);
			}

			// Validate deterministic sequential page order (1..N)
			const orderedPages = pages.map((p, idx) => ({
				...p,
				pageNumber: idx + 1,
			}));

			if (orderedPages.length === 0) {
				throw new AcquisitionError(
					'no_pages_found',
					'Erro de extração: Firecrawl retornou a página, mas nenhuma imagem de capítulo válida foi encontrada.',
					this.id,
					false,
				);
			}

			const availableChapters = htmlContent
				? (input.adapter.extractAvailableChaptersFromHtml?.(htmlContent, input.url) ?? [])
				: [];

			return { pages: orderedPages, availableChapters };
		} catch (err) {
			clearTimeout(timer);
			if (err instanceof AcquisitionError) throw err;
			if (err instanceof DOMException && err.name === 'AbortError') {
				throw new AcquisitionError('timeout', 'Firecrawl Local: tempo esgotado.', this.id, true, err);
			}
			throw new AcquisitionError(
				'network_error',
				`Erro ao comunicar com Firecrawl Local: ${err instanceof Error ? err.message : String(err)}`,
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

/**
 * Wraps the standard Playwright/direct-HTTP discovery port as an AcquisitionProvider (`direct-fetch`)
 * so `AcquisitionRouter` seamlessly falls back when Firecrawl Local is unavailable.
 */
export function createDirectFetchAcquisitionProvider(options?: {
	allowHttpForTests?: boolean;
}): AcquisitionProvider {
	const delegate = createPlaywrightPageDiscoveryPort(options);
	return {
		id: 'direct-fetch',
		displayName: 'Direct Fetch / Playwright',
		capabilities: {
			supportsDynamicContent: true,
			requiresExternalService: false,
			worksInPackagedElectron: true,
			maxConcurrency: 3,
		},
		async checkHealth(): Promise<AcquisitionProviderHealth> {
			return {
				providerId: 'direct-fetch',
				available: true,
				lastCheckAtIso: new Date().toISOString(),
				consecutiveFailures: 0,
				circuitState: 'closed',
			};
		},
		async discover(input) {
			return delegate.discover(input);
		},
	};
}