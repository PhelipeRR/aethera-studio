/**
 * Acquisition Router — Modular Provider Selection, Error Classification,
 * Circuit Breakers & Structured Telemetry (Fase 2)
 *
 * Routes chapter acquisition requests through available providers with:
 * - Automatic provider selection based on availability and health
 * - Structured error classification (SSRF, 403, timeout, network, parse)
 * - Per-provider circuit breakers to avoid hammering failing services
 * - Structured telemetry events for observability
 * - Graceful fallback when only one provider is available
 * - No Cloudflare/CAPTCHA bypass — errors are reported honestly
 */

import type {
	PageDiscoveryPort,
	ImageDownloadPort,
	AnalyzedChapterUrl,
} from './url-chapter-importer.js';
import type { ChapterSiteAdapter, SiteAdapterRegistry } from './site-adapters.js';

// ─── Provider Identity & Contracts ────────────────────────────────────────────

export const ACQUISITION_PROVIDER_IDS = [
	'electron-playwright',
	'firecrawl-self-hosted',
	'direct-fetch',
] as const;
export type AcquisitionProviderId = (typeof ACQUISITION_PROVIDER_IDS)[number];

export interface AcquisitionProviderCapabilities {
	/** True if this provider can render JavaScript and handle lazy-loaded content. */
	supportsDynamicContent: boolean;
	/** True if this provider requires an external service to be running. */
	requiresExternalService: boolean;
	/** True if this provider works inside a packaged Electron ASAR bundle. */
	worksInPackagedElectron: boolean;
	/** Maximum concurrent requests this provider can handle safely. */
	maxConcurrency: number;
}

export interface AcquisitionProviderHealth {
	providerId: AcquisitionProviderId;
	available: boolean;
	lastCheckAtIso: string;
	lastError?: string;
	consecutiveFailures: number;
	circuitState: 'closed' | 'open' | 'half-open';
	circuitResetAtIso?: string;
	responseTimeMs?: number;
}

export interface AcquisitionProvider extends PageDiscoveryPort {
	readonly id: AcquisitionProviderId;
	readonly displayName: string;
	readonly capabilities: AcquisitionProviderCapabilities;
	/** Check if this provider is currently available and healthy. */
	checkHealth(): Promise<AcquisitionProviderHealth>;
}

// ─── Error Classification ─────────────────────────────────────────────────────

export const ACQUISITION_ERROR_CODES = [
	'ssrf_blocked',
	'access_denied_403',
	'rate_limited_429',
	'timeout',
	'network_error',
	'parse_error',
	'no_pages_found',
	'captcha_detected',
	'paywall_detected',
	'provider_unavailable',
	'circuit_breaker_open',
	'all_providers_failed',
	'cancelled',
	'unknown',
] as const;
export type AcquisitionErrorCode = (typeof ACQUISITION_ERROR_CODES)[number];

export const ERROR_RETRYABILITY: Record<AcquisitionErrorCode, boolean> = {
	ssrf_blocked: false,
	access_denied_403: false,
	rate_limited_429: true,
	timeout: true,
	network_error: true,
	parse_error: false,
	no_pages_found: false,
	captcha_detected: false,
	paywall_detected: false,
	provider_unavailable: true,
	circuit_breaker_open: true,
	all_providers_failed: false,
	cancelled: false,
	unknown: false,
};

export class AcquisitionError extends Error {
	constructor(
		public readonly code: AcquisitionErrorCode,
		message: string,
		public readonly providerId?: AcquisitionProviderId,
		public readonly retryable?: boolean,
		public readonly originalError?: unknown,
	) {
		super(message);
		this.name = 'AcquisitionError';
		this.retryable ??= ERROR_RETRYABILITY[code];
	}
}

export function classifyAcquisitionError(err: unknown, providerId?: AcquisitionProviderId): AcquisitionError {
	if (err instanceof AcquisitionError) return err;

	const msg = err instanceof Error ? err.message : String(err);
	const lower = msg.toLowerCase();

	if (/ssrf|private.*ip|localhost|internal/i.test(lower)) {
		return new AcquisitionError('ssrf_blocked', msg, providerId, false, err);
	}
	if (/captcha|challenge-platform|just a moment|hcaptcha|recaptcha/i.test(lower)) {
		return new AcquisitionError('captcha_detected', msg, providerId, false, err);
	}
	if (/paywall|subscribe|login required/i.test(lower)) {
		return new AcquisitionError('paywall_detected', msg, providerId, false, err);
	}
	if (/acesso restrito|acesso negado|bypass/i.test(lower)) {
		return new AcquisitionError('access_denied_403', msg, providerId, false, err);
	}
	if (/http\s*403|forbidden/i.test(lower)) {
		return new AcquisitionError('access_denied_403', msg, providerId, false, err);
	}
	if (/http\s*429|rate.?limit|too many requests/i.test(lower)) {
		return new AcquisitionError('rate_limited_429', msg, providerId, true, err);
	}
	if (/timeout|timed?\s*out|etimedout/i.test(lower)) {
		return new AcquisitionError('timeout', msg, providerId, true, err);
	}
	if (/econnrefused|econnreset|enotfound|network|fetch failed|dns/i.test(lower)) {
		return new AcquisitionError('network_error', msg, providerId, true, err);
	}
	if (/nenhuma página|no pages|parse|extract/i.test(lower)) {
		return new AcquisitionError('no_pages_found', msg, providerId, false, err);
	}
	if (/cancel/i.test(lower)) {
		return new AcquisitionError('cancelled', msg, providerId, false, err);
	}
	if (/provider.*unavailable|not.*installed|cannot find module/i.test(lower)) {
		return new AcquisitionError('provider_unavailable', msg, providerId, true, err);
	}

	return new AcquisitionError('unknown', msg, providerId, false, err);
}

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

export interface CircuitBreakerConfig {
	/** Number of consecutive failures before opening the circuit. Default: 3. */
	failureThreshold: number;
	/** Time in ms before attempting a half-open probe. Default: 30000 (30s). */
	resetTimeoutMs: number;
	/** Maximum time in ms to wait for a single request. Default: 60000 (60s). */
	requestTimeoutMs: number;
}

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
	failureThreshold: 3,
	resetTimeoutMs: 30_000,
	requestTimeoutMs: 60_000,
};

export class ProviderCircuitBreaker {
	private consecutiveFailures = 0;
	private state: 'closed' | 'open' | 'half-open' = 'closed';
	private lastFailureAt = 0;
	private lastSuccessAt = 0;

	constructor(
		private readonly providerId: AcquisitionProviderId,
		private readonly config: CircuitBreakerConfig = DEFAULT_CIRCUIT_CONFIG,
	) {}

	get currentState(): 'closed' | 'open' | 'half-open' {
		if (this.state === 'open') {
			const elapsed = Date.now() - this.lastFailureAt;
			if (elapsed >= this.config.resetTimeoutMs) {
				this.state = 'half-open';
			}
		}
		return this.state;
	}

	canAttempt(): boolean {
		const s = this.currentState;
		return s === 'closed' || s === 'half-open';
	}

	recordSuccess(responseTimeMs: number): void {
		this.consecutiveFailures = 0;
		this.state = 'closed';
		this.lastSuccessAt = Date.now();
		void responseTimeMs; // tracked for telemetry
	}

	recordFailure(): void {
		this.consecutiveFailures++;
		this.lastFailureAt = Date.now();
		if (this.consecutiveFailures >= this.config.failureThreshold) {
			this.state = 'open';
		}
	}

	getHealthSnapshot(): Pick<AcquisitionProviderHealth, 'consecutiveFailures' | 'circuitState' | 'circuitResetAtIso'> {
		const s = this.currentState;
		return {
			consecutiveFailures: this.consecutiveFailures,
			circuitState: s,
			...(s === 'open' ? { circuitResetAtIso: new Date(this.lastFailureAt + this.config.resetTimeoutMs).toISOString() } : {}),
		};
	}
}

// ─── Telemetry ────────────────────────────────────────────────────────────────

export const ACQUISITION_TELEMETRY_EVENTS = [
	'provider_health_check',
	'provider_selected',
	'provider_fallback',
	'discovery_started',
	'discovery_completed',
	'discovery_failed',
	'circuit_breaker_opened',
	'circuit_breaker_half_open',
	'circuit_breaker_closed',
	'all_providers_exhausted',
] as const;
export type AcquisitionTelemetryEventType = (typeof ACQUISITION_TELEMETRY_EVENTS)[number];

export interface AcquisitionTelemetryEvent {
	type: AcquisitionTelemetryEventType;
	timestampIso: string;
	providerId?: AcquisitionProviderId;
	url?: string;
	errorCode?: AcquisitionErrorCode;
	durationMs?: number;
	pageCount?: number;
	detail?: string;
}

export type AcquisitionTelemetryListener = (event: AcquisitionTelemetryEvent) => void;

export class AcquisitionTelemetry {
	private readonly listeners = new Set<AcquisitionTelemetryListener>();
	private readonly history: AcquisitionTelemetryEvent[] = [];
	private readonly maxHistory = 200;

	subscribe(listener: AcquisitionTelemetryListener): () => void {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	emit(event: Omit<AcquisitionTelemetryEvent, 'timestampIso'>): void {
		const full: AcquisitionTelemetryEvent = { ...event, timestampIso: new Date().toISOString() };
		this.history.push(full);
		if (this.history.length > this.maxHistory) this.history.shift();
		for (const fn of this.listeners) {
			try { fn(full); } catch { /* ignore listener errors */ }
		}
	}

	getHistory(limit = 50): AcquisitionTelemetryEvent[] {
		return this.history.slice(-limit);
	}
}

// ─── Router Configuration ────────────────────────────────────────────────────

export interface AcquisitionRouterConfig {
	/** Ordered list of provider IDs to try. First available wins. */
	providerPriority: readonly AcquisitionProviderId[];
	/** Per-provider circuit breaker configs. */
	circuitBreakerConfigs?: Partial<Record<AcquisitionProviderId, CircuitBreakerConfig>>;
	/** Timeout for the entire discovery operation across all fallbacks. Default: 120s. */
	totalTimeoutMs: number;
}

const DEFAULT_ROUTER_CONFIG: AcquisitionRouterConfig = {
	providerPriority: ['electron-playwright', 'firecrawl-self-hosted', 'direct-fetch'],
	totalTimeoutMs: 120_000,
};

// ─── Router Implementation ────────────────────────────────────────────────────

export interface AcquisitionRouterOptions {
	config?: Partial<AcquisitionRouterConfig>;
	telemetry?: AcquisitionTelemetry;
}

export class AcquisitionRouter implements PageDiscoveryPort {
	private readonly providers = new Map<AcquisitionProviderId, AcquisitionProvider>();
	private readonly circuitBreakers = new Map<AcquisitionProviderId, ProviderCircuitBreaker>();
	private readonly config: AcquisitionRouterConfig;
	readonly telemetry: AcquisitionTelemetry;

	constructor(options?: AcquisitionRouterOptions) {
		this.config = { ...DEFAULT_ROUTER_CONFIG, ...(options?.config ?? {}) };
		this.telemetry = options?.telemetry ?? new AcquisitionTelemetry();

		for (const pid of this.config.providerPriority) {
			const cbConfig = this.config.circuitBreakerConfigs?.[pid] ?? DEFAULT_CIRCUIT_CONFIG;
			this.circuitBreakers.set(pid, new ProviderCircuitBreaker(pid, cbConfig));
		}
	}

	registerProvider(provider: AcquisitionProvider): void {
		this.providers.set(provider.id, provider);
	}

	unregisterProvider(providerId: AcquisitionProviderId): void {
		this.providers.delete(providerId);
	}

	listRegisteredProviders(): AcquisitionProviderId[] {
		return [...this.providers.keys()];
	}

	async getProviderHealth(): Promise<AcquisitionProviderHealth[]> {
		const results: AcquisitionProviderHealth[] = [];
		for (const [id, provider] of this.providers) {
			try {
				const health = await provider.checkHealth();
				results.push(health);
			} catch (err) {
				const cb = this.circuitBreakers.get(id);
				results.push({
					providerId: id,
					available: false,
					lastCheckAtIso: new Date().toISOString(),
					lastError: err instanceof Error ? err.message : String(err),
					consecutiveFailures: cb?.getHealthSnapshot().consecutiveFailures ?? 0,
					circuitState: cb?.currentState ?? 'closed',
				});
			}
		}
		return results;
	}

	async discover(input: {
		url: URL;
		adapter: ChapterSiteAdapter;
		signal?: AbortSignal;
	}): Promise<{ pages: import('./site-adapters.js').DiscoveredPage[]; availableChapters: import('./site-adapters.js').DiscoveredChapterLink[] }> {
		const startTime = Date.now();
		const errors: Array<{ providerId: AcquisitionProviderId; error: AcquisitionError }> = [];

		for (const providerId of this.config.providerPriority) {
			if (input.signal?.aborted) {
				throw new AcquisitionError('cancelled', 'Descoberta cancelada pelo usuário.');
			}

			const provider = this.providers.get(providerId);
			if (!provider) continue;

			const cb = this.circuitBreakers.get(providerId)!;
			if (!cb.canAttempt()) {
				this.telemetry.emit({
					type: 'circuit_breaker_opened',
					providerId,
					url: input.url.toString(),
					detail: `Circuit breaker ${cb.currentState}, skipping.`,
				});
				errors.push({
					providerId,
					error: new AcquisitionError('circuit_breaker_open', `Circuit breaker aberto para ${providerId}.`, providerId, true),
				});
				continue;
			}

			this.telemetry.emit({
				type: 'discovery_started',
				providerId,
				url: input.url.toString(),
			});

			const attemptStart = Date.now();
			try {
				const discoverPromise = provider.discover(input);
				const result = await (input.signal
					? new Promise<Awaited<typeof discoverPromise>>((resolve, reject) => {
							const sig = input.signal!;
							if (sig.aborted) {
								reject(new AcquisitionError('cancelled', 'Descoberta cancelada pelo usuário.', providerId, false));
								return;
							}
							const onAbort = () => {
								reject(new AcquisitionError('cancelled', 'Descoberta cancelada pelo usuário.', providerId, false));
							};
							sig.addEventListener('abort', onAbort, { once: true });
							discoverPromise.then(
								(val) => {
									sig.removeEventListener('abort', onAbort);
									resolve(val);
								},
								(err) => {
									sig.removeEventListener('abort', onAbort);
									reject(err);
								},
							);
						})
					: discoverPromise);
				const durationMs = Date.now() - attemptStart;
				cb.recordSuccess(durationMs);

				this.telemetry.emit({
					type: 'discovery_completed',
					providerId,
					url: input.url.toString(),
					durationMs,
					pageCount: result.pages.length,
				});

				if (result.pages.length === 0) {
					const noPagesErr = new AcquisitionError('no_pages_found', `Nenhuma página encontrada via ${providerId}.`, providerId, false);
					errors.push({ providerId, error: noPagesErr });
					continue;
				}

				return result;
			} catch (rawErr) {
				const durationMs = Date.now() - attemptStart;
				const classified = classifyAcquisitionError(rawErr, providerId);
				cb.recordFailure();

				this.telemetry.emit({
					type: 'discovery_failed',
					providerId,
					url: input.url.toString(),
					errorCode: classified.code,
					durationMs,
					detail: classified.message,
				});

				if (cb.currentState === 'open') {
					this.telemetry.emit({
						type: 'circuit_breaker_opened',
						providerId,
						url: input.url.toString(),
						detail: `Circuit breaker opened after ${cb.getHealthSnapshot().consecutiveFailures} failures.`,
					});
				}

				errors.push({ providerId, error: classified });

				// Non-retryable errors should not trigger fallback to weaker providers
				// for security-sensitive issues (SSRF, CAPTCHA detection) or explicit cancellation
				if (
					classified.code === 'cancelled' ||
					classified.code === 'ssrf_blocked' ||
					classified.code === 'captcha_detected' ||
					classified.code === 'paywall_detected'
				) {
					throw classified;
				}
			}
		}

		// All providers exhausted
		const totalDuration = Date.now() - startTime;
		this.telemetry.emit({
			type: 'all_providers_exhausted',
			url: input.url.toString(),
			durationMs: totalDuration,
			detail: `${errors.length} provider(s) failed.`,
		});

		if (errors.length === 0) {
			throw new AcquisitionError('all_providers_failed', 'Nenhum provedor de aquisição registrado ou disponível.', undefined, false);
		}

		// Return the most informative error
		const priorityOrder: AcquisitionErrorCode[] = [
			'access_denied_403', 'captcha_detected', 'paywall_detected',
			'no_pages_found', 'timeout', 'network_error', 'rate_limited_429',
			'circuit_breaker_open', 'provider_unavailable', 'unknown',
		];

		let bestError = errors[0]!.error;
		for (const code of priorityOrder) {
			const match = errors.find((e) => e.error.code === code);
			if (match) {
				bestError = match.error;
				break;
			}
		}

		throw new AcquisitionError(
			'all_providers_failed',
			`Todos os provedores falharam. Último erro: [${bestError.code}] ${bestError.message}`,
			bestError.providerId,
			false,
			bestError,
		);
	}
}