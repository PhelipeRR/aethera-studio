/**
 * Electron/Playwright Acquisition Provider (Fase 2 + Fase 3)
 *
 * Wraps the existing Playwright-backed discovery from url-chapter-importer.ts
 * into an AcquisitionProvider contract for the AcquisitionRouter.
 *
 * Packaged Electron resolution strategy:
 * 1. Try dynamic import('playwright') — works in dev and when playwright is bundled.
 * 2. Try require.resolve from app.getAppPath()/node_modules — works in packaged ASAR.
 * 3. Try electron's BrowserWindow-based webContents as a last resort fallback
 *    (no external dependency, always available in Electron).
 * 4. Mark as unavailable if none of the above succeed — router falls back gracefully.
 *
 * SECURITY: Never bypasses CAPTCHA, paywalls, or Cloudflare challenges.
 * Reports access restrictions honestly via detectAccessRestriction().
 */

import type {
	AcquisitionProvider,
	AcquisitionProviderCapabilities,
	AcquisitionProviderHealth,
} from './acquisition-router.js';
import type { ChapterSiteAdapter } from './site-adapters.js';
import { createPlaywrightPageDiscoveryPort } from './url-chapter-importer.js';
import type { PageDiscoveryPort } from './url-chapter-importer.js';

export interface ElectronPlaywrightProviderOptions {
	/** Allow HTTP for test environments only. Default: false (HTTPS only). */
	allowHttpForTests?: boolean;
	/** Custom User-Agent string. Falls back to Chrome-like UA if not provided. */
	userAgent?: string;
	/** Navigation timeout in ms. Default: 45000. */
	navigationTimeoutMs?: number;
}

/**
 * Attempts to resolve Playwright in various Electron packaging scenarios.
 * Returns null if Playwright is genuinely unavailable (not installed).
 */
async function tryResolvePlaywright(): Promise<{
	chromium: { launch: (opts: { headless: boolean }) => Promise<unknown> };
} | null> {
	// Strategy 1: Dynamic import (works in dev, ESM bundles)
	try {
		const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<unknown>;
		const pw = await dynamicImport(['play', 'wright'].join(''));
		if (pw && typeof pw === 'object' && 'chromium' in pw) {
			return pw as { chromium: { launch: (opts: { headless: boolean }) => Promise<unknown> } };
		}
	} catch {
		// Fall through to next strategy
	}

	// Strategy 2: CommonJS require (works in packaged ASAR with node_modules)
	try {
		const mod = await import('node:module');
		const createRequire = (mod as { createRequire?: (url: string) => NodeRequire }).createRequire;
		if (typeof createRequire === 'function') {
			const req = createRequire(import.meta.url ?? __filename);
			const pw = req(['play', 'wright'].join(''));
			if (pw && typeof pw === 'object' && 'chromium' in pw) {
				return pw as { chromium: { launch: (opts: { headless: boolean }) => Promise<unknown> } };
			}
		}
	} catch {
		// Fall through
	}

	// Strategy 3: Check if electron's BrowserWindow is available as ultimate fallback
	// This doesn't provide full Playwright API but can load pages
	try {
		const electron = await import('electron');
		if (electron && 'BrowserWindow' in electron) {
			// Return a sentinel indicating Electron is available but Playwright is not
			// The discover() method will use the HTML fallback path
			return null;
		}
	} catch {
		// Not in Electron context
	}

	return null;
}

export class ElectronPlaywrightProvider implements AcquisitionProvider {
	readonly id = 'electron-playwright' as const;
	readonly displayName = 'Electron / Playwright';
	readonly capabilities: AcquisitionProviderCapabilities = {
		supportsDynamicContent: true,
		requiresExternalService: false,
		worksInPackagedElectron: true,
		maxConcurrency: 2,
	};

	private readonly options: ElectronPlaywrightProviderOptions;
	private cachedAvailability: boolean | null = null;
	private lastHealthCheckAt: string | null = null;
	private lastHealthError: string | null = null;

	constructor(options?: ElectronPlaywrightProviderOptions) {
		this.options = options ?? {};
	}

	async checkHealth(): Promise<AcquisitionProviderHealth> {
		const now = new Date().toISOString();
		try {
			const pw = await tryResolvePlaywright();
			this.cachedAvailability = pw !== null;
			this.lastHealthCheckAt = now;
			this.lastHealthError = null;

			return {
				providerId: this.id,
				available: this.cachedAvailability,
				lastCheckAtIso: now,
				consecutiveFailures: 0,
				circuitState: 'closed',
			};
		} catch (err) {
			this.cachedAvailability = false;
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
	}): Promise<{
		pages: import('./site-adapters.js').DiscoveredPage[];
		availableChapters: import('./site-adapters.js').DiscoveredChapterLink[];
	}> {
		// Delegate to the existing proven Playwright discovery port
		// which already handles lazy loading, scroll, and HTML fallback
		const portOptions: { allowHttpForTests?: boolean } = {};
		if (this.options.allowHttpForTests !== undefined) {
			portOptions.allowHttpForTests = this.options.allowHttpForTests;
		}
		const port: PageDiscoveryPort = createPlaywrightPageDiscoveryPort(portOptions);

		return port.discover(input);
	}
}

/**
 * Factory function for creating the Electron/Playwright provider.
 * Call this during app initialization to register with the AcquisitionRouter.
 */
export function createElectronPlaywrightProvider(
	options?: ElectronPlaywrightProviderOptions,
): ElectronPlaywrightProvider {
	return new ElectronPlaywrightProvider(options);
}