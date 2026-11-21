/**
 * Aethera Recap — Acquisition Router, Error Classification & Provider Tests (Fase 2)
 *
 * Validates:
 * - Error classification for all known error types
 * - Circuit breaker state transitions (closed → open → half-open → closed)
 * - Router fallback across multiple providers
 * - Router behavior with single provider available
 * - Telemetry event emission
 * - Firecrawl self-hosted provider config resolution
 * - Non-retryable errors (SSRF, CAPTCHA) stop fallback immediately
 */

import { describe, it, expect } from 'vitest';
import {
	AcquisitionRouter,
	AcquisitionError,
	AcquisitionTelemetry,
	ProviderCircuitBreaker,
	classifyAcquisitionError,
	ERROR_RETRYABILITY,
	type AcquisitionProvider,
	type AcquisitionProviderHealth,
	type AcquisitionErrorCode,
} from '../../src/recap/url-importer/acquisition-router.js';
import type { ChapterSiteAdapter, DiscoveredPage, DiscoveredChapterLink } from '../../src/recap/url-importer/site-adapters.js';
import { asuraScansAdapter } from '../../src/recap/url-importer/site-adapters.js';

// ─── Test Helpers ──────────────────────────────────────────────────────────────

function makeMockProvider(
	id: 'electron-playwright' | 'firecrawl-self-hosted' | 'direct-fetch',
	options?: {
		failWith?: Error;
		pages?: DiscoveredPage[];
		healthAvailable?: boolean;
		delayMs?: number;
	},
): AcquisitionProvider {
	return {
		id,
		displayName: `Mock ${id}`,
		capabilities: {
			supportsDynamicContent: true,
			requiresExternalService: id === 'firecrawl-self-hosted',
			worksInPackagedElectron: true,
			maxConcurrency: 2,
		},
		async checkHealth(): Promise<AcquisitionProviderHealth> {
			return {
				providerId: id,
				available: options?.healthAvailable !== false,
				lastCheckAtIso: new Date().toISOString(),
				consecutiveFailures: 0,
				circuitState: 'closed',
			};
		},
		async discover(_input: { url: URL; adapter: ChapterSiteAdapter; signal?: AbortSignal }) {
			if (options?.delayMs) {
				await new Promise((r) => setTimeout(r, options.delayMs));
			}
			if (options?.failWith) throw options.failWith;
			return {
				pages: options?.pages ?? [{ pageNumber: 1, imageUrl: 'https://cdn.example.com/p1.png' }],
				availableChapters: [],
			};
		},
	};
}

const TEST_URL = new URL('https://asurascans.com/comics/nano-machine-7ba78ec7/chapter/1');

// ─── Error Classification Tests ────────────────────────────────────────────────

describe('Acquisition Router — Error Classification (Fase 2)', () => {
	const cases: Array<[string, AcquisitionErrorCode, boolean]> = [
		['SSRF blocked: private IP 192.168.1.1', 'ssrf_blocked', false],
		['localhost is not allowed', 'ssrf_blocked', false],
		['Just a moment... challenge-platform', 'captcha_detected', false],
		['hCaptcha verification required', 'captcha_detected', false],
		['Subscribe to read this chapter', 'paywall_detected', false],
		['Login required to view content', 'paywall_detected', false],
		['Acesso restrito pelo site', 'access_denied_403', false],
		['HTTP 403 Forbidden', 'access_denied_403', false],
		['HTTP 429 Too Many Requests', 'rate_limited_429', true],
		['Rate limit exceeded', 'rate_limited_429', true],
		['Connection timed out ETIMEDOUT', 'timeout', true],
		['ECONNREFUSED connection refused', 'network_error', true],
		['DNS lookup failed ENOTFOUND', 'network_error', true],
		['Nenhuma página de imagem detectada', 'no_pages_found', false],
		['Download cancelado pelo usuário', 'cancelled', false],
		['Cannot find module playwright', 'provider_unavailable', true],
		['Some random unknown error', 'unknown', false],
	];

	for (const [msg, expectedCode, expectedRetryable] of cases) {
		it(`classifies "${msg}" as ${expectedCode} (retryable=${expectedRetryable})`, () => {
			const err = classifyAcquisitionError(new Error(msg), 'electron-playwright');
			expect(err.code).toBe(expectedCode);
			expect(err.retryable).toBe(expectedRetryable);
			expect(err.providerId).toBe('electron-playwright');
		});
	}

	it('preserves existing AcquisitionError without re-wrapping', () => {
		const original = new AcquisitionError('timeout', 'Original timeout', 'direct-fetch', true);
		const classified = classifyAcquisitionError(original);
		expect(classified).toBe(original);
		expect(classified.code).toBe('timeout');
	});

	it('handles non-Error objects gracefully', () => {
		const err = classifyAcquisitionError('string error message about timeout');
		expect(err.code).toBe('timeout');
		expect(err.message).toContain('timeout');
	});

	it('all error codes have defined retryability', () => {
		const codes = Object.keys(ERROR_RETRYABILITY) as AcquisitionErrorCode[];
		expect(codes.length).toBeGreaterThan(10);
		for (const code of codes) {
			expect(typeof ERROR_RETRYABILITY[code]).toBe('boolean');
		}
	});
});

// ─── Circuit Breaker Tests ──────────────────────────────────────────────────────

describe('Acquisition Router — Circuit Breaker (Fase 2)', () => {
	it('starts in closed state and allows attempts', () => {
		const cb = new ProviderCircuitBreaker('electron-playwright', {
			failureThreshold: 3,
			resetTimeoutMs: 100,
			requestTimeoutMs: 5000,
		});
		expect(cb.currentState).toBe('closed');
		expect(cb.canAttempt()).toBe(true);
	});

	it('opens after consecutive failures reach threshold', () => {
		const cb = new ProviderCircuitBreaker('firecrawl-self-hosted', {
			failureThreshold: 2,
			resetTimeoutMs: 100,
			requestTimeoutMs: 5000,
		});
		cb.recordFailure();
		expect(cb.currentState).toBe('closed');
		cb.recordFailure();
		expect(cb.currentState).toBe('open');
		expect(cb.canAttempt()).toBe(false);
	});

	it('transitions to half-open after reset timeout', async () => {
		const cb = new ProviderCircuitBreaker('direct-fetch', {
			failureThreshold: 1,
			resetTimeoutMs: 50,
			requestTimeoutMs: 5000,
		});
		cb.recordFailure();
		expect(cb.currentState).toBe('open');
		await new Promise((r) => setTimeout(r, 60));
		expect(cb.currentState).toBe('half-open');
		expect(cb.canAttempt()).toBe(true);
	});

	it('resets to closed on success after half-open', async () => {
		const cb = new ProviderCircuitBreaker('electron-playwright', {
			failureThreshold: 1,
			resetTimeoutMs: 30,
			requestTimeoutMs: 5000,
		});
		cb.recordFailure();
		await new Promise((r) => setTimeout(r, 40));
		expect(cb.currentState).toBe('half-open');
		cb.recordSuccess(100);
		expect(cb.currentState).toBe('closed');
		expect(cb.canAttempt()).toBe(true);
	});

	it('returns health snapshot with circuit reset time when open', () => {
		const cb = new ProviderCircuitBreaker('firecrawl-self-hosted', {
			failureThreshold: 1,
			resetTimeoutMs: 60000,
			requestTimeoutMs: 5000,
		});
		cb.recordFailure();
		const snap = cb.getHealthSnapshot();
		expect(snap.circuitState).toBe('open');
		expect(snap.consecutiveFailures).toBe(1);
		expect(snap.circuitResetAtIso).toBeDefined();
	});
});

// ─── Router Fallback Tests ──────────────────────────────────────────────────────

describe('Acquisition Router — Provider Selection & Fallback (Fase 2)', () => {
	it('uses first available provider successfully', async () => {
		const router = new AcquisitionRouter({
			config: { providerPriority: ['electron-playwright', 'direct-fetch'], totalTimeoutMs: 5000 },
		});
		router.registerProvider(makeMockProvider('electron-playwright'));
		router.registerProvider(makeMockProvider('direct-fetch'));

		const result = await router.discover({ url: TEST_URL, adapter: asuraScansAdapter });
		expect(result.pages).toHaveLength(1);
		expect(result.pages[0]!.imageUrl).toBe('https://cdn.example.com/p1.png');
	});

	it('falls back to next provider when first fails with retryable error', async () => {
		const router = new AcquisitionRouter({
			config: { providerPriority: ['electron-playwright', 'direct-fetch'], totalTimeoutMs: 5000 },
		});
		router.registerProvider(
			makeMockProvider('electron-playwright', { failWith: new Error('ECONNREFUSED') }),
		);
		router.registerProvider(makeMockProvider('direct-fetch'));

		const result = await router.discover({ url: TEST_URL, adapter: asuraScansAdapter });
		expect(result.pages).toHaveLength(1);
	});

	it('stops fallback immediately on SSRF error (non-retryable security)', async () => {
		const router = new AcquisitionRouter({
			config: { providerPriority: ['electron-playwright', 'direct-fetch'], totalTimeoutMs: 5000 },
		});
		router.registerProvider(
			makeMockProvider('electron-playwright', { failWith: new Error('SSRF blocked: private IP') }),
		);
		router.registerProvider(makeMockProvider('direct-fetch'));

		await expect(router.discover({ url: TEST_URL, adapter: asuraScansAdapter })).rejects.toThrow('SSRF');
	});

	it('stops fallback immediately on CAPTCHA detection', async () => {
		const router = new AcquisitionRouter({
			config: { providerPriority: ['electron-playwright', 'direct-fetch'], totalTimeoutMs: 5000 },
		});
		router.registerProvider(
			makeMockProvider('electron-playwright', { failWith: new Error('Just a moment... challenge-platform') }),
		);
		router.registerProvider(makeMockProvider('direct-fetch'));

		await expect(router.discover({ url: TEST_URL, adapter: asuraScansAdapter })).rejects.toThrow(/captcha|challenge/i);
	});

	it('throws all_providers_failed when all providers fail', async () => {
		const router = new AcquisitionRouter({
			config: { providerPriority: ['electron-playwright', 'direct-fetch'], totalTimeoutMs: 5000 },
		});
		router.registerProvider(
			makeMockProvider('electron-playwright', { failWith: new Error('ECONNREFUSED') }),
		);
		router.registerProvider(
			makeMockProvider('direct-fetch', { failWith: new Error('DNS lookup failed') }),
		);

		try {
			await router.discover({ url: TEST_URL, adapter: asuraScansAdapter });
			expect.unreachable('Should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(AcquisitionError);
			expect((err as AcquisitionError).code).toBe('all_providers_failed');
		}
	});

	it('works with only one provider registered', async () => {
		const router = new AcquisitionRouter({
			config: { providerPriority: ['direct-fetch'], totalTimeoutMs: 5000 },
		});
		router.registerProvider(makeMockProvider('direct-fetch'));

		const result = await router.discover({ url: TEST_URL, adapter: asuraScansAdapter });
		expect(result.pages).toHaveLength(1);
	});

	it('throws when no providers are registered', async () => {
		const router = new AcquisitionRouter();
		try {
			await router.discover({ url: TEST_URL, adapter: asuraScansAdapter });
			expect.unreachable('Should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(AcquisitionError);
			expect((err as AcquisitionError).code).toBe('all_providers_failed');
		}
	});

	it('skips providers with open circuit breakers', async () => {
		const telemetry = new AcquisitionTelemetry();
		const router = new AcquisitionRouter({
			config: {
				providerPriority: ['electron-playwright', 'direct-fetch'],
				totalTimeoutMs: 5000,
				circuitBreakerConfigs: {
					'electron-playwright': { failureThreshold: 1, resetTimeoutMs: 60000, requestTimeoutMs: 5000 },
				},
			},
			telemetry,
		});
		router.registerProvider(
			makeMockProvider('electron-playwright', { failWith: new Error('ECONNREFUSED') }),
		);
		router.registerProvider(makeMockProvider('direct-fetch'));

		// First call: electron-playwright fails, circuit opens, falls back to direct-fetch
		const r1 = await router.discover({ url: TEST_URL, adapter: asuraScansAdapter });
		expect(r1.pages).toHaveLength(1);

		// Second call: electron-playwright circuit is open, goes directly to direct-fetch
		const r2 = await router.discover({ url: TEST_URL, adapter: asuraScansAdapter });
		expect(r2.pages).toHaveLength(1);

		// Verify circuit breaker telemetry was emitted
		const events = telemetry.getHistory();
		expect(events.some((e) => e.type === 'circuit_breaker_opened')).toBe(true);
	});

	it('respects abort signal during discovery', async () => {
		const router = new AcquisitionRouter({
			config: { providerPriority: ['electron-playwright'], totalTimeoutMs: 10000 },
		});
		router.registerProvider(makeMockProvider('electron-playwright', { delayMs: 5000 }));

		const ac = new AbortController();
		setTimeout(() => ac.abort(), 50);

		try {
			await router.discover({ url: TEST_URL, adapter: asuraScansAdapter, signal: ac.signal });
			expect.unreachable('Should have thrown');
		} catch (err) {
			expect(err).toBeInstanceOf(AcquisitionError);
			expect((err as AcquisitionError).code).toBe('cancelled');
		}
	});
});

// ─── Telemetry Tests ────────────────────────────────────────────────────────────

describe('Acquisition Router — Telemetry (Fase 2)', () => {
	it('emits discovery_started and discovery_completed events', async () => {
		const telemetry = new AcquisitionTelemetry();
		const router = new AcquisitionRouter({
			config: { providerPriority: ['direct-fetch'], totalTimeoutMs: 5000 },
			telemetry,
		});
		router.registerProvider(makeMockProvider('direct-fetch'));

		await router.discover({ url: TEST_URL, adapter: asuraScansAdapter });

		const events = telemetry.getHistory();
		expect(events.some((e) => e.type === 'discovery_started')).toBe(true);
		expect(events.some((e) => e.type === 'discovery_completed')).toBe(true);
	});

	it('emits discovery_failed with error code on provider failure', async () => {
		const telemetry = new AcquisitionTelemetry();
		const router = new AcquisitionRouter({
			config: { providerPriority: ['electron-playwright', 'direct-fetch'], totalTimeoutMs: 5000 },
			telemetry,
		});
		router.registerProvider(
			makeMockProvider('electron-playwright', { failWith: new Error('Connection timed out') }),
		);
		router.registerProvider(makeMockProvider('direct-fetch'));

		await router.discover({ url: TEST_URL, adapter: asuraScansAdapter });

		const events = telemetry.getHistory();
		const failed = events.find((e) => e.type === 'discovery_failed');
		expect(failed).toBeDefined();
		expect(failed!.errorCode).toBe('timeout');
		expect(failed!.providerId).toBe('electron-playwright');
	});

	it('subscriber receives events in real-time and can unsubscribe', async () => {
		const telemetry = new AcquisitionTelemetry();
		const received: string[] = [];
		const unsub = telemetry.subscribe((e) => received.push(e.type));

		telemetry.emit({ type: 'provider_health_check', providerId: 'direct-fetch' });
		expect(received).toEqual(['provider_health_check']);

		unsub();
		telemetry.emit({ type: 'discovery_started', providerId: 'direct-fetch' });
		expect(received).toHaveLength(1); // no new events after unsubscribe
	});

	it('limits history to maxHistory entries', () => {
		const telemetry = new AcquisitionTelemetry();
		for (let i = 0; i < 250; i++) {
			telemetry.emit({ type: 'provider_health_check', providerId: 'direct-fetch' });
		}
		expect(telemetry.getHistory(300)).toHaveLength(200);
	});
});

// ─── Provider Health Tests ──────────────────────────────────────────────────────

describe('Acquisition Router — Provider Health (Fase 2)', () => {
	it('lists registered providers', () => {
		const router = new AcquisitionRouter();
		router.registerProvider(makeMockProvider('electron-playwright'));
		router.registerProvider(makeMockProvider('direct-fetch'));
		expect(router.listRegisteredProviders()).toEqual(['electron-playwright', 'direct-fetch']);
	});

	it('unregisters providers correctly', () => {
		const router = new AcquisitionRouter();
		router.registerProvider(makeMockProvider('electron-playwright'));
		router.unregisterProvider('electron-playwright');
		expect(router.listRegisteredProviders()).toEqual([]);
	});

	it('getProviderHealth returns health for all registered providers', async () => {
		const router = new AcquisitionRouter();
		router.registerProvider(makeMockProvider('electron-playwright'));
		router.registerProvider(makeMockProvider('firecrawl-self-hosted', { healthAvailable: false }));

		const health = await router.getProviderHealth();
		expect(health).toHaveLength(2);
		expect(health.find((h) => h.providerId === 'electron-playwright')?.available).toBe(true);
		expect(health.find((h) => h.providerId === 'firecrawl-self-hosted')?.available).toBe(false);
	});
});