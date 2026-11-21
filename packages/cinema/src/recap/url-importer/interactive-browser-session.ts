/**
 * Aethera Recap — Interactive Persistent Browser Session Importer
 *
 * Allows the user to open a visible Playwright browser with a dedicated per-origin
 * persistent profile (`launchPersistentContext`), manually complete any login or
 * site verification, and automatically continue importing authorized chapters once
 * the page is legitimately accessible.
 *
 * Security & Compliance:
 * - Uses standard Playwright `launchPersistentContext` (ZERO stealth, ZERO fingerprint spoofing)
 * - NEVER automates CAPTCHA or Cloudflare challenge resolution
 * - NEVER exports or logs cookies/tokens, and NEVER copies cookies to external HTTP clients
 * - Stops immediately on explicit access denial (HTTP 403 / persistent block) and recommends file import
 * - Pauses cleanly on session expiration (HTTP 401 / login redirect)
 * - Strict sequential chapter pacing & isolated per-origin profiles with explicit session close & wipe
 */

import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import AdmZip from 'adm-zip';
import {
	defaultSiteAdapterRegistry,
	type ChapterSiteAdapter,
	type DiscoveredPage,
	type SiteAdapterRegistry,
} from './site-adapters.js';
import {
	resolveSafeStoragePath,
	sanitizeStorageSlug,
	validateExternalChapterUrl,
	validateImageMagicBytes,
} from './url-security.js';
import { registerLibraryEntry, type RecapLibraryEntry } from './url-chapter-importer.js';
import { detectCloudflareOrChallengeContent } from './firecrawl-provider.js';

export type InteractiveBrowserErrorCode =
	| 'PLAYWRIGHT_MODULE_MISSING'
	| 'PLAYWRIGHT_MODULE_LOAD_FAILED'
	| 'BROWSER_EXECUTABLE_NOT_FOUND'
	| 'BROWSER_LAUNCH_FAILED'
	| 'BROWSER_PROFILE_LOCKED'
	| 'BROWSER_PERMISSION_DENIED';

export class InteractiveBrowserError extends Error {
	constructor(
		public readonly code: InteractiveBrowserErrorCode,
		message: string,
		public readonly diagnosticDetail?: string,
	) {
		super(message);
		this.name = 'InteractiveBrowserError';
	}
}

export type InteractiveImportState =
	| 'idle'
	| 'opening_browser'
	| 'awaiting_user_verification'
	| 'verifying_access'
	| 'access_authorized'
	| 'importing_chapters'
	| 'preparing_cbz'
	| 'completed'
	| 'session_expired'
	| 'access_denied'
	| 'cancelled';

export interface InteractiveSessionSnapshot {
	sessionId: string;
	originKey: string;
	state: InteractiveImportState;
	statusMessage: string;
	currentUrl: string | null;
	completedChapters: number;
	totalChapters: number;
	currentChapterPagesDone: number;
	currentChapterPagesTotal: number;
	importedEntries: RecapLibraryEntry[];
	warnings: string[];
	error?: string;
	errorCode?: InteractiveBrowserErrorCode;
	diagnosticDetail?: string;
	profileIsolated: boolean;
	updatedAtIso: string;
}

export interface InteractiveSessionOptions {
	profilesRootDir: string;
	libraryDir: string;
	registry?: SiteAdapterRegistry;
	/** Visible by default (`false`) so the user can manually authenticate/verify. Set `true` only in automated tests. */
	headless?: boolean;
	/** Allow localhost/HTTP URLs only in controlled local tests. Default: false. */
	allowLocalhostForTests?: boolean;
	/** Max time waiting for manual user verification in ms. Default: 300_000 (5 min). */
	verificationTimeoutMs?: number;
	/** Poll interval while waiting for user verification in ms. Default: 1200. */
	pollIntervalMs?: number;
	/** Polite delay between chapters in ms. Default: 400. */
	interChapterDelayMs?: number;
	/** Optional test hook invoked when the browser enters `awaiting_user_verification`. */
	onAwaitingVerificationForTest?: (page: PlaywrightPageLike) => Promise<void>;
}

export interface PlaywrightPageLike {
	goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<{ status: () => number; url: () => string } | null>;
	content: () => Promise<string>;
	title: () => Promise<string>;
	url: () => string;
	waitForTimeout: (ms: number) => Promise<void>;
	evaluate: <T>(fn: () => T | Promise<T>) => Promise<T>;
	fill?: (selector: string, value: string) => Promise<void>;
	click?: (selector: string) => Promise<void>;
	waitForNavigation?: (opts?: { timeout?: number }) => Promise<unknown>;
	request: {
		get: (url: string, opts?: { headers?: Record<string, string>; timeout?: number }) => Promise<{
			ok: () => boolean;
			status: () => number;
			body: () => Promise<Buffer>;
		}>;
	};
}

interface PlaywrightContextLike {
	pages: () => PlaywrightPageLike[];
	newPage: () => Promise<PlaywrightPageLike>;
	close: () => Promise<void>;
}

interface PlaywrightModuleLike {
	chromium: {
		launchPersistentContext: (
			userDataDir: string,
			options: {
				executablePath?: string;
				headless: boolean;
				viewport?: { width: number; height: number } | null;
				args?: string[];
			},
		) => Promise<PlaywrightContextLike>;
	};
}

const LOGIN_URL_PATTERNS = [/\/login\b/i, /\/signin\b/i, /\/sign-in\b/i, /\/auth\b/i, /\/account\/login/i];
const LOGIN_DOM_PATTERNS = [/<input[^>]+type\s*=\s*["']password["']/i, /data-aethera-auth-required/i];

const INTERSTITIAL_TITLE_PATTERNS = [
	/just a moment\.\.\./i,
	/attention required!\s*\|\s*cloudflare/i,
	/checking your browser/i,
	/verify you are human/i,
	/security check/i,
];

const INTERSTITIAL_DOM_PATTERNS = [
	/id\s*=\s*["'](?:cf-challenge-running|challenge-running|challenge-stage|cf-wrapper|cf-error-details)["']/i,
	/class\s*=\s*["'][^"']*cf-browser-verification[^"']*["']/i,
	/<form[^>]+id\s*=\s*["']challenge-form["']/i,
	/data-aethera-challenge-interstitial/i,
];

const NON_CHAPTER_IMAGE_URL_PATTERNS = [
	/(?:^|[/_.-])(?:logo|avatar|favicon|banner|icon|badge|emoji|spinner|loader|placeholder|ads?|analytics|pixel)(?:[/_.-]|\.[a-z0-9]+$)/i,
	/\.svg(?:[?#]|$)/i,
	/google-analytics|doubleclick|facebook\.com\/tr/i,
];

function isLikelyNonChapterAsset(imageUrl: string, altText?: string): boolean {
	if (NON_CHAPTER_IMAGE_URL_PATTERNS.some((re) => re.test(imageUrl))) return true;
	if (altText && /^(?:logo|avatar|icon|discord|patreon|ko-fi|banner)$/i.test(altText.trim())) return true;
	return false;
}

function sanitizeDiagnosticPath(raw: string): string {
	return raw
		.replace(/[A-Za-z]:\\Users\\[^\\/\s]+/gi, '<USER_HOME>')
		.replace(/\/Users\/[^/\s]+/g, '<USER_HOME>')
		.replace(/Cookie:\s*[^\r\n]+/gi, 'Cookie: [REDACTED]')
		.replace(/Authorization:\s*[^\r\n]+/gi, 'Authorization: [REDACTED]')
		.slice(0, 400);
}

function findChromiumExecutable(): string | undefined {
	if (process.env['CHROMIUM_EXECUTABLE_PATH'] && existsSync(process.env['CHROMIUM_EXECUTABLE_PATH'])) {
		return process.env['CHROMIUM_EXECUTABLE_PATH'];
	}
	const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
	if (resourcesPath) {
		for (const bundled of [
			join(resourcesPath, 'chromium', 'chrome.exe'),
			join(resourcesPath, 'chromium', 'chrome-win64', 'chrome.exe'),
		]) {
			if (existsSync(bundled)) return bundled;
		}
	}
	const localAppData = process.env['LOCALAPPDATA'];
	if (localAppData) {
		const msPw = join(localAppData, 'ms-playwright');
		if (existsSync(msPw)) {
			const dirs = readdirSync(msPw)
				.filter((d) => d.startsWith('chromium-'))
				.sort()
				.reverse();
			for (const d of dirs) {
				for (const sub of ['chrome-win64/chrome.exe', 'chrome-win/chrome.exe']) {
					const candidate = join(msPw, d, sub);
					if (existsSync(candidate)) return candidate;
				}
			}
		}
		const userChrome = join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe');
		if (existsSync(userChrome)) return userChrome;
	}
	for (const candidate of [
		'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
		'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
		'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
		'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe',
	]) {
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

async function loadPlaywrightCore(): Promise<PlaywrightModuleLike> {
	const require = createRequire(import.meta.url);
	const resourcesPath = (process as { resourcesPath?: string }).resourcesPath;
	const candidates = [
		...(resourcesPath
			? [
					join(resourcesPath, 'playwright-core'),
					join(resourcesPath, 'app.asar.unpacked', 'node_modules', 'playwright-core'),
				]
			: []),
		'playwright-core',
		'playwright',
		resolve(process.cwd(), 'services', 'firecrawl-local', 'node_modules', 'playwright-core'),
	];

	let foundExistingModulePath: string | null = null;
	const loadFailures: string[] = [];

	for (const modPath of candidates) {
		const isPathLike = modPath.includes('/') || modPath.includes('\\');
		const existsOnDisk = isPathLike ? existsSync(join(modPath, 'package.json')) : false;
		if (existsOnDisk) foundExistingModulePath = modPath;
		try {
			const loaded = require(modPath) as PlaywrightModuleLike;
			if (loaded?.chromium?.launchPersistentContext) return loaded;
			loadFailures.push(`${sanitizeDiagnosticPath(modPath)}: export chromium.launchPersistentContext ausente`);
		} catch (err) {
			const errCode = (err as { code?: string })?.code ?? '';
			const errMsg = err instanceof Error ? err.message : String(err);
			if (existsOnDisk || errCode !== 'MODULE_NOT_FOUND') {
				loadFailures.push(`${sanitizeDiagnosticPath(modPath)}: [${errCode || 'ERR'}] ${sanitizeDiagnosticPath(errMsg)}`);
			}
		}
	}

	if (foundExistingModulePath || loadFailures.length > 0) {
		throw new InteractiveBrowserError(
			'PLAYWRIGHT_MODULE_LOAD_FAILED',
			'Módulo playwright-core encontrado, mas falhou ao carregar em tempo de execução. Use a Importação Assistida por arquivos ou reinstale o aplicativo.',
			loadFailures.join(' | '),
		);
	}

	throw new InteractiveBrowserError(
		'PLAYWRIGHT_MODULE_MISSING',
		'Módulo playwright-core não encontrado no pacote instalado. Reinstale o Aethera Studio ou use a Importação Assistida por arquivos.',
		`resourcesPath=${resourcesPath ? 'present' : 'unset'}; candidatesChecked=${candidates.length}`,
	);
}

function classifyBrowserLaunchError(err: unknown): InteractiveBrowserError {
	if (err instanceof InteractiveBrowserError) return err;
	const rawCode = (err as { code?: string })?.code ?? '';
	const rawMsg = err instanceof Error ? err.message : String(err);
	const sanitized = sanitizeDiagnosticPath(rawMsg);

	if (/EBUSY|SingletonLock|ProcessSingleton|profile.*in use|already running/i.test(`${rawCode} ${rawMsg}`)) {
		return new InteractiveBrowserError(
			'BROWSER_PROFILE_LOCKED',
			'O perfil do navegador para este site já está em uso ou bloqueado. Feche a janela anterior ou clique em "Limpar dados do navegador".',
			sanitized,
		);
	}
	if (/EACCES|EPERM|access is denied|permission denied/i.test(`${rawCode} ${rawMsg}`)) {
		return new InteractiveBrowserError(
			'BROWSER_PERMISSION_DENIED',
			'Permissão negada pelo sistema operacional ao iniciar o navegador ou gravar o perfil persistente.',
			sanitized,
		);
	}
	if (/ENOENT|Executable doesn't exist|Failed to launch.*not found/i.test(`${rawCode} ${rawMsg}`)) {
		return new InteractiveBrowserError(
			'BROWSER_EXECUTABLE_NOT_FOUND',
			'Nenhum navegador Chromium/Chrome/Edge compatível foi encontrado neste Windows.',
			sanitized,
		);
	}
	return new InteractiveBrowserError(
		'BROWSER_LAUNCH_FAILED',
		`Falha ao iniciar o navegador persistente: ${sanitized}`,
		sanitized,
	);
}

export function classifyPageState(input: {
	statusCode: number;
	currentUrl: string;
	html: string;
	title: string;
	adapter: ChapterSiteAdapter;
	discoveredChapterImagesCount?: number;
}): 'accessible' | 'needs_login' | 'needs_challenge' | 'access_denied' | 'hydrating' {
	const hasChapterImages = (input.discoveredChapterImagesCount ?? 0) > 0;

	// 1. Dedicated login route or HTTP 401 always requires authentication
	if (input.statusCode === 401) return 'needs_login';
	if (LOGIN_URL_PATTERNS.some((p) => p.test(input.currentUrl))) return 'needs_login';

	// 2. Full-page Cloudflare / anti-bot interstitial title (never a valid chapter)
	if (INTERSTITIAL_TITLE_PATTERNS.some((p) => p.test(input.title))) {
		return 'needs_challenge';
	}

	// 3. If real chapter images are already present and rendered on the page,
	// DO NOT let a hidden navbar login input or comment recaptcha script false-positive as blocked!
	if (hasChapterImages) {
		return 'accessible';
	}

	// 4. When zero chapter images are present, check for active interstitial challenge or login form
	if (INTERSTITIAL_DOM_PATTERNS.some((p) => p.test(input.html))) {
		return 'needs_challenge';
	}
	const cfReason = detectCloudflareOrChallengeContent({ html: input.html, title: input.title });
	if (cfReason) return 'needs_challenge';

	if (LOGIN_DOM_PATTERNS.some((p) => p.test(input.html))) return 'needs_login';

	if (input.statusCode === 403) return 'access_denied';

	const adapterRestriction = input.adapter.detectAccessRestriction?.(input.html);
	if (adapterRestriction) {
		return /login|assinatura|paywall|auth/i.test(adapterRestriction) ? 'needs_login' : 'access_denied';
	}

	// HTTP 200 without challenge/login/403, but images haven't hydrated in DOM yet
	return 'hydrating';
}

function extractPagesFromAuthorizedHtml(
	html: string,
	pageUrl: URL,
	adapter?: ChapterSiteAdapter,
): DiscoveredPage[] {
	if (adapter) {
		const adapterPages = adapter.extractPagesFromHtml(html, pageUrl);
		if (adapterPages.length > 0) return adapterPages;
	}

	// Fallback generic <img> extraction for permitted sources without [data-page]
	const pages: DiscoveredPage[] = [];
	const seen = new Set<string>();
	const imgRe = /<img\b[^>]*>/gi;
	let m: RegExpExecArray | null;
	while ((m = imgRe.exec(html)) !== null) {
		const tag = m[0];
		const getAttr = (name: string) => {
			const am = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i').exec(tag);
			return am?.[1] ?? am?.[2] ?? '';
		};
		const src = (getAttr('data-current-src') || getAttr('data-src') || getAttr('data-lazy-src') || getAttr('src')).trim();
		const alt = getAttr('alt').trim();
		if (!src || src.startsWith('data:') || src.startsWith('blob:')) continue;
		try {
			const resolved = new URL(src, pageUrl);
			if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
			const abs = resolved.toString();
			if (seen.has(abs) || isLikelyNonChapterAsset(abs, alt)) continue;
			seen.add(abs);
			pages.push({ pageNumber: pages.length + 1, imageUrl: abs, ...(alt ? { alt } : {}) });
		} catch {
			// skip invalid
		}
	}
	return pages;
}

/**
 * Extracts chapter images from BOTH the site adapter's HTML parser and the live rendered DOM
 * inside Playwright, ensuring dynamic Next.js/React/lazy-loaded images are detected.
 */
async function extractChapterPagesFromLivePage(
	page: PlaywrightPageLike,
	html: string,
	pageUrl: URL,
	adapter: ChapterSiteAdapter,
): Promise<DiscoveredPage[]> {
	// 1. Prefer explicit [data-page] adapter extraction when available
	const fromAdapter = adapter.extractPagesFromHtml(html, pageUrl);
	if (fromAdapter.length > 0) return fromAdapter;

	// 2. Inspect live rendered DOM for [data-page] or reader images
	try {
		const liveImgs = await page.evaluate(() => {
			const doc = (globalThis as unknown as {
				document?: {
					querySelectorAll: (sel: string) => Iterable<{
						dataset?: { page?: string };
						tagName?: string;
						currentSrc?: string;
						src?: string;
						alt?: string;
						naturalWidth?: number;
						naturalHeight?: number;
						width?: number;
						height?: number;
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
			if (!doc) return [] as Array<{ src: string; alt: string; dataPage: number | null }>;

			const dataPageNodes = [...doc.querySelectorAll('[data-page]')];
			if (dataPageNodes.length > 0) {
				dataPageNodes.sort((a, b) => Number(a.dataset?.page ?? 0) - Number(b.dataset?.page ?? 0));
				const list: Array<{ src: string; alt: string; dataPage: number | null }> = [];
				for (const node of dataPageNodes) {
					const img = node.tagName?.toLowerCase() === 'img' ? node : node.querySelector('img');
					if (!img) continue;
					const raw =
						img.currentSrc ||
						img.src ||
						img.getAttribute('data-current-src') ||
						img.getAttribute('data-src') ||
						img.getAttribute('data-lazy-src') ||
						'';
					if (raw && !raw.startsWith('data:') && !raw.startsWith('blob:')) {
						list.push({ src: raw, alt: img.alt || '', dataPage: Number(node.dataset?.page ?? 0) });
					}
				}
				if (list.length > 0) return list;
			}

			// Fallback: all <img> in reading containers or main document body, excluding tiny UI icons
			const allImgs = [...doc.querySelectorAll('main img, article img, .reading-content img, img')];
			const out: Array<{ src: string; alt: string; dataPage: number | null }> = [];
			for (const img of allImgs) {
				const nw = img.naturalWidth ?? 0;
				const nh = img.naturalHeight ?? 0;
				const w = img.width ?? 0;
				const h = img.height ?? 0;
				// Skip known tiny loaded icons/avatars (< 140x140)
				if (nw > 0 && nh > 0 && nw < 140 && nh < 140) continue;
				if (w > 0 && h > 0 && w < 100 && h < 100) continue;
				const raw =
					img.currentSrc ||
					img.src ||
					img.getAttribute('data-current-src') ||
					img.getAttribute('data-src') ||
					img.getAttribute('data-lazy-src') ||
					'';
				if (raw && !raw.startsWith('data:') && !raw.startsWith('blob:')) {
					out.push({ src: raw, alt: img.alt || '', dataPage: null });
				}
			}
			return out;
		});

		if (liveImgs.length > 0) {
			const pages: DiscoveredPage[] = [];
			const seen = new Set<string>();
			for (const item of liveImgs) {
				try {
					const resolved = new URL(item.src.trim(), pageUrl);
					if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
					const abs = resolved.toString();
					if (seen.has(abs) || isLikelyNonChapterAsset(abs, item.alt)) continue;
					seen.add(abs);
					pages.push({
						pageNumber: pages.length + 1,
						imageUrl: abs,
						...(item.alt ? { alt: item.alt } : {}),
					});
				} catch {
					// skip invalid
				}
			}
			if (pages.length > 0) return pages;
		}
	} catch {
		// fall back to static HTML extraction
	}

	return extractPagesFromAuthorizedHtml(html, pageUrl);
}

/**
 * Performs a bounded progressive scroll to hydrate lazy-loaded chapter images
 * without blocking indefinitely (max ~3.5s).
 */
async function scrollPageForLazyImagesBounded(page: PlaywrightPageLike, maxMs = 3500): Promise<void> {
	try {
		await page.evaluate(async () => {
			const win = globalThis as unknown as {
				innerHeight?: number;
				scrollBy?: (x: number, y: number) => void;
				scrollTo?: (x: number, y: number) => void;
				document?: { body?: { scrollHeight?: number } };
			};
			if (!win.scrollBy || !win.document?.body) return;
			const step = Math.max(450, Math.floor((win.innerHeight || 800) * 0.85));
			const maxSteps = 22;
			for (let i = 0; i < maxSteps; i++) {
				const totalH = win.document.body.scrollHeight || 0;
				win.scrollBy(0, step);
				await new Promise((r) => setTimeout(r, 90));
				if ((i + 1) * step >= totalH + step) break;
			}
			win.scrollTo?.(0, 0);
		});
		await page.waitForTimeout(Math.min(400, maxMs));
	} catch {
		// ignore if page navigated
	}
}

function getOriginKey(rawUrl: string): string {
	const u = new URL(rawUrl.trim());
	return sanitizeStorageSlug(`${u.hostname}_${u.port || (u.protocol === 'https:' ? '443' : '80')}`);
}

export class InteractiveRecapBrowserSessionManager {
	private readonly sessions = new Map<string, InteractiveSessionSnapshot>();
	private readonly activeContexts = new Map<string, PlaywrightContextLike>();
	private readonly cancelFlags = new Set<string>();
	private readonly listeners = new Map<string, Set<(snap: InteractiveSessionSnapshot) => void>>();

	constructor(private readonly options: InteractiveSessionOptions) {
		mkdirSync(this.options.profilesRootDir, { recursive: true });
		mkdirSync(this.options.libraryDir, { recursive: true });
	}

	getSession(sessionId: string): InteractiveSessionSnapshot | null {
		const snap = this.sessions.get(sessionId);
		return snap ? structuredClone(snap) : null;
	}

	subscribe(sessionId: string, fn: (snap: InteractiveSessionSnapshot) => void): () => void {
		const set = this.listeners.get(sessionId) ?? new Set();
		set.add(fn);
		this.listeners.set(sessionId, set);
		return () => {
			set.delete(fn);
		};
	}

	private update(sessionId: string, patch: Partial<InteractiveSessionSnapshot>): void {
		const cur = this.sessions.get(sessionId);
		if (!cur) return;
		const next: InteractiveSessionSnapshot = {
			...cur,
			...patch,
			updatedAtIso: new Date().toISOString(),
		};
		this.sessions.set(sessionId, next);
		const set = this.listeners.get(sessionId);
		if (set) {
			const copy = structuredClone(next);
			for (const fn of set) fn(copy);
		}
	}

	async closeOriginSession(rawUrl: string): Promise<{ ok: boolean; originKey: string }> {
		const originKey = getOriginKey(rawUrl);
		const ctx = this.activeContexts.get(originKey);
		if (ctx) {
			this.activeContexts.delete(originKey);
			await ctx.close().catch(() => {});
		}
		return { ok: true, originKey };
	}

	async clearOriginProfile(rawUrl: string): Promise<{ ok: boolean; originKey: string; cleared: boolean }> {
		const originKey = getOriginKey(rawUrl);
		await this.closeOriginSession(rawUrl);
		const profileDir = resolveSafeStoragePath(this.options.profilesRootDir, originKey);
		if (existsSync(profileDir)) {
			// Wait briefly for Chromium on Windows to release profile lock files after context.close()
			let lastErr: unknown;
			for (let attempt = 0; attempt < 6; attempt++) {
				try {
					rmSync(profileDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
					return { ok: true, originKey, cleared: true };
				} catch (err) {
					lastErr = err;
					await new Promise((r) => setTimeout(r, 200));
				}
			}
			throw lastErr;
		}
		return { ok: true, originKey, cleared: false };
	}

	async cancelSession(sessionId: string): Promise<InteractiveSessionSnapshot | null> {
		const snap = this.sessions.get(sessionId);
		if (!snap) return null;
		this.cancelFlags.add(sessionId);
		this.update(sessionId, {
			state: 'cancelled',
			statusMessage: 'Importação interativa cancelada pelo usuário.',
		});
		const ctx = this.activeContexts.get(snap.originKey);
		if (ctx) {
			this.activeContexts.delete(snap.originKey);
			await ctx.close().catch(() => {});
		}
		return this.getSession(sessionId);
	}

	/**
	 * Starts an interactive persistent-browser import session for one or more chapter URLs.
	 * Returns the initial snapshot immediately while the session runs asynchronously.
	 */
	startInteractiveImport(input: {
		urls: readonly string[];
		workTitle?: string;
		seriesProjectId?: string;
	}): InteractiveSessionSnapshot {
		const cleanedUrls = input.urls.map((u) => u.trim()).filter(Boolean);
		if (cleanedUrls.length === 0) {
			throw new Error('Informe pelo menos uma URL de capítulo para iniciar a verificação no navegador.');
		}

		const firstUrl = validateExternalChapterUrl(cleanedUrls[0]!, {
			allowLocalhost: this.options.allowLocalhostForTests ?? false,
			allowHttpForTests: this.options.allowLocalhostForTests ?? false,
		});
		const originKey = getOriginKey(firstUrl.toString());
		const sessionId = `interactive_${Date.now()}_${randomUUID().slice(0, 8)}`;

		const initial: InteractiveSessionSnapshot = {
			sessionId,
			originKey,
			state: 'opening_browser',
			statusMessage: 'Abrindo navegador dedicado do Aethera Recap…',
			currentUrl: firstUrl.toString(),
			completedChapters: 0,
			totalChapters: cleanedUrls.length,
			currentChapterPagesDone: 0,
			currentChapterPagesTotal: 0,
			importedEntries: [],
			warnings: [],
			profileIsolated: true,
			updatedAtIso: new Date().toISOString(),
		};
		this.sessions.set(sessionId, initial);
		void this.runSession(sessionId, originKey, cleanedUrls, input.workTitle, input.seriesProjectId);
		return structuredClone(initial);
	}

	async waitForSessionEnd(sessionId: string): Promise<InteractiveSessionSnapshot> {
		const terminalStates = new Set<InteractiveImportState>([
			'completed',
			'access_denied',
			'session_expired',
			'cancelled',
		]);
		const cur = this.sessions.get(sessionId);
		if (!cur) throw new Error(`Sessão interativa não encontrada: ${sessionId}`);
		if (terminalStates.has(cur.state)) return structuredClone(cur);

		return new Promise((resolvePromise) => {
			const unsub = this.subscribe(sessionId, (snap) => {
				if (terminalStates.has(snap.state)) {
					unsub();
					resolvePromise(snap);
				}
			});
		});
	}

	private async runSession(
		sessionId: string,
		originKey: string,
		urls: readonly string[],
		workTitleOverride?: string,
		seriesProjectId?: string,
	): Promise<void> {
		const registry = this.options.registry ?? defaultSiteAdapterRegistry;
		const profileDir = resolveSafeStoragePath(this.options.profilesRootDir, originKey);
		mkdirSync(profileDir, { recursive: true });

		let context: PlaywrightContextLike | null = null;

		try {
			const pw = await loadPlaywrightCore();
			const executablePath = findChromiumExecutable();
			if (!executablePath) {
				throw new InteractiveBrowserError(
					'BROWSER_EXECUTABLE_NOT_FOUND',
					'Nenhum navegador Chromium, Google Chrome ou Microsoft Edge foi encontrado neste Windows. Instale o Edge/Chrome ou use a Importação Assistida por arquivos.',
				);
			}

			// Reuse or launch isolated persistent context for this origin
			const existingCtx = this.activeContexts.get(originKey);
			if (existingCtx) {
				await existingCtx.close().catch(() => {});
				this.activeContexts.delete(originKey);
			}

			try {
				context = await pw.chromium.launchPersistentContext(profileDir, {
					executablePath,
					headless: this.options.headless ?? false,
					viewport: { width: 1280, height: 860 },
				});
			} catch (launchErr) {
				throw classifyBrowserLaunchError(launchErr);
			}
			this.activeContexts.set(originKey, context);

			const page = context.pages()[0] ?? (await context.newPage());
			const firstUrlObj = new URL(urls[0]!);
			const firstAdapter =
				registry.resolveForUrl(firstUrlObj) ??
				({
					id: 'generic_interactive',
					displayName: firstUrlObj.hostname,
					supportedHosts: [firstUrlObj.hostname],
					matchesUrl: () => true,
					parseChapterMetadata: (u: URL) => ({
						workSlug: sanitizeStorageSlug(workTitleOverride || u.hostname),
						workTitle: workTitleOverride || u.hostname,
						chapterNumber: /chapter\/([0-9.]+)/i.exec(u.pathname)?.[1] ?? '1',
					}),
					extractPagesFromHtml: (html: string, u: URL) => extractPagesFromAuthorizedHtml(html, u, undefined as never),
				} as ChapterSiteAdapter);

			const resp = await page.goto(firstUrlObj.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
			let statusCode = resp ? resp.status() : 200;
			this.update(sessionId, {
				state: 'verifying_access',
				statusMessage: 'Verificando conteúdo e imagens do capítulo…',
			});

			let html = await page.content();
			let title = await page.title().catch(() => '');
			let initialPages = await extractChapterPagesFromLivePage(page, html, firstUrlObj, firstAdapter);
			let pageState = classifyPageState({
				statusCode,
				currentUrl: page.url(),
				html,
				title,
				adapter: firstAdapter,
				discoveredChapterImagesCount: initialPages.length,
			});

			// If page returned HTTP 200 without challenge/login/403 but dynamic JS images haven't hydrated yet,
			// wait briefly (bounded to ~3.2s) and scroll gently before deciding.
			if (pageState === 'hydrating') {
				for (let hAttempt = 0; hAttempt < 4; hAttempt++) {
					if (this.cancelFlags.has(sessionId)) return;
					await scrollPageForLazyImagesBounded(page, 600);
					html = await page.content().catch(() => html);
					title = await page.title().catch(() => title);
					initialPages = await extractChapterPagesFromLivePage(page, html, firstUrlObj, firstAdapter);
					pageState = classifyPageState({
						statusCode,
						currentUrl: page.url(),
						html,
						title,
						adapter: firstAdapter,
						discoveredChapterImagesCount: initialPages.length,
					});
					if (pageState !== 'hydrating') break;
				}
			}

			// If user login or manual verification is required, wait passively — NEVER automate CAPTCHA/Cloudflare
			if (pageState === 'needs_login' || pageState === 'needs_challenge') {
				this.update(sessionId, {
					state: 'awaiting_user_verification',
					statusMessage:
						pageState === 'needs_login'
							? 'Aguardando você concluir o login no navegador aberto. A importação continuará automaticamente.'
							: 'Aguardando você concluir a verificação do site no navegador aberto. Nenhuma verificação é resolvida automaticamente.',
				});

				if (this.options.onAwaitingVerificationForTest) {
					await this.options.onAwaitingVerificationForTest(page);
				}

				const deadline = Date.now() + (this.options.verificationTimeoutMs ?? 300_000);
				const pollMs = this.options.pollIntervalMs ?? 1000;

				while (Date.now() < deadline) {
					if (this.cancelFlags.has(sessionId)) return;
					await page.waitForTimeout(pollMs);
					if (this.cancelFlags.has(sessionId)) return;

					html = await page.content().catch(() => '');
					title = await page.title().catch(() => '');
					const curUrl = page.url();
					let pollUrlObj = firstUrlObj;
					try {
						pollUrlObj = new URL(curUrl);
					} catch {
						pollUrlObj = firstUrlObj;
					}
					const livePages = await extractChapterPagesFromLivePage(page, html, pollUrlObj, firstAdapter);
					const currentCheck = classifyPageState({
						statusCode: 200,
						currentUrl: curUrl,
						html,
						title,
						adapter: firstAdapter,
						discoveredChapterImagesCount: livePages.length,
					});

					if (currentCheck === 'accessible' || currentCheck === 'hydrating') {
						this.update(sessionId, {
							state: 'verifying_access',
							statusMessage: 'Verificando acesso ao capítulo solicitado…',
						});
						// Re-verify the exact requested chapter URL if user was on a different login/challenge URL
						if (curUrl !== firstUrlObj.toString()) {
							const verifyResp = await page.goto(firstUrlObj.toString(), {
								waitUntil: 'domcontentloaded',
								timeout: 25_000,
							});
							statusCode = verifyResp ? verifyResp.status() : 200;
						} else {
							statusCode = 200;
						}
						await scrollPageForLazyImagesBounded(page, 1200);
						html = await page.content();
						title = await page.title().catch(() => '');
						initialPages = await extractChapterPagesFromLivePage(page, html, firstUrlObj, firstAdapter);
						pageState = classifyPageState({
							statusCode,
							currentUrl: page.url(),
							html,
							title,
							adapter: firstAdapter,
							discoveredChapterImagesCount: initialPages.length,
						});
						if (pageState === 'accessible') break;
					}
				}
			}

			if (this.cancelFlags.has(sessionId)) return;

			// Explicit denial or unresolved block -> stop immediately, NEVER attempt bypass
			if (pageState !== 'accessible') {
				const reason =
					pageState === 'access_denied'
						? 'O site retornou acesso negado (HTTP 403) mesmo na sessão interativa. Nenhum contorno é realizado — utilize a Importação Assistida por arquivos (WEBP/PNG/JPG/ZIP/CBZ/PDF).'
						: pageState === 'needs_challenge'
							? 'A verificação do site não foi concluída ou o acesso automatizado continua bloqueado. Utilize a Importação Assistida por arquivos.'
							: pageState === 'hydrating'
								? 'A página abriu, mas nenhuma imagem de capítulo foi encontrada no DOM. Utilize a Importação Assistida por arquivos.'
								: 'A autenticação não foi concluída dentro do tempo limite.';
				this.update(sessionId, {
					state: pageState === 'needs_login' ? 'session_expired' : 'access_denied',
					statusMessage: reason,
					error: reason,
				});
				return;
			}

			this.update(sessionId, {
				state: 'access_authorized',
				statusMessage: 'Acesso autorizado! Iniciando importação sequencial dos capítulos…',
			});

			const importedEntries: RecapLibraryEntry[] = [];
			const warnings: string[] = [];

			for (let chIdx = 0; chIdx < urls.length; chIdx++) {
				if (this.cancelFlags.has(sessionId)) return;

				const targetUrl = validateExternalChapterUrl(urls[chIdx]!, {
					allowLocalhost: this.options.allowLocalhostForTests ?? false,
					allowHttpForTests: this.options.allowLocalhostForTests ?? false,
				});
				const adapter = registry.resolveForUrl(targetUrl) ?? firstAdapter;

				this.update(sessionId, {
					state: 'importing_chapters',
					currentUrl: targetUrl.toString(),
					currentChapterPagesDone: 0,
					currentChapterPagesTotal: 0,
					statusMessage: `Importando capítulo ${chIdx + 1} de ${urls.length}…`,
				});

				if (chIdx > 0) {
					const delay = this.options.interChapterDelayMs ?? 400;
					if (delay > 0) await page.waitForTimeout(delay);
					const chResp = await page.goto(targetUrl.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
					statusCode = chResp ? chResp.status() : 200;
					await scrollPageForLazyImagesBounded(page, 1800);
					html = await page.content();
					title = await page.title().catch(() => '');
					const chPagesCheck = await extractChapterPagesFromLivePage(page, html, targetUrl, adapter);
					pageState = classifyPageState({
						statusCode,
						currentUrl: page.url(),
						html,
						title,
						adapter,
						discoveredChapterImagesCount: chPagesCheck.length,
					});

					if (pageState === 'needs_login') {
						this.update(sessionId, {
							state: 'session_expired',
							statusMessage: `Sessão expirada no capítulo ${chIdx + 1}. Faça login novamente no navegador para retomar.`,
							error: 'Sessão expirada durante a fila de capítulos.',
							importedEntries,
							warnings,
						});
						return;
					}
					if (pageState !== 'accessible') {
						this.update(sessionId, {
							state: 'access_denied',
							statusMessage: `O site bloqueou o acesso ao capítulo ${chIdx + 1} (HTTP ${statusCode}). Fila interrompida sem bypass; use a importação por arquivos.`,
							error: `Acesso negado no capítulo ${chIdx + 1} (HTTP ${statusCode}).`,
							importedEntries,
							warnings,
						});
						return;
					}
				} else {
					// Hydrate lazy-loaded images on the first chapter before final extraction
					await scrollPageForLazyImagesBounded(page, 1800);
					html = await page.content().catch(() => html);
				}

				const discoveredPages = await extractChapterPagesFromLivePage(page, html, targetUrl, adapter);
				if (discoveredPages.length === 0) {
					warnings.push(`Nenhuma imagem válida encontrada em ${targetUrl.pathname}.`);
					continue;
				}

				this.update(sessionId, {
					currentChapterPagesTotal: discoveredPages.length,
					currentChapterPagesDone: 0,
				});

				const seenHashes = new Set<string>();
				const validImages: Array<{ ext: string; buffer: Buffer }> = [];

				for (let pIdx = 0; pIdx < discoveredPages.length; pIdx++) {
					if (this.cancelFlags.has(sessionId)) return;
					const pg = discoveredPages[pIdx]!;
					// Fetch image strictly inside the authorized browser context (NEVER exporting cookies externally)
					const imgResp = await page.request.get(pg.imageUrl, {
						headers: { Referer: targetUrl.toString() },
						timeout: 20_000,
					});
					if (imgResp.status() === 401) {
						this.update(sessionId, {
							state: 'session_expired',
							statusMessage: 'Sessão expirada ao baixar páginas do capítulo. Autentique-se novamente.',
							error: 'Sessão expirada (HTTP 401).',
							importedEntries,
							warnings,
						});
						return;
					}
					if (imgResp.status() === 403) {
						this.update(sessionId, {
							state: 'access_denied',
							statusMessage: 'Download de imagens negado pelo site (HTTP 403). Use a importação por arquivos.',
							error: 'Acesso negado às imagens (HTTP 403).',
							importedEntries,
							warnings,
						});
						return;
					}
					if (!imgResp.ok()) {
						warnings.push(`Falha HTTP ${imgResp.status()} na página ${pIdx + 1}.`);
						continue;
					}
					const buf = await imgResp.body();
					const magic = validateImageMagicBytes(buf);
					if (!magic.valid || !magic.ext) {
						warnings.push(`Página ${pIdx + 1} descartada (imagem inválida).`);
						continue;
					}
					const hash = createHash('sha256').update(buf).digest('hex');
					if (seenHashes.has(hash)) continue;
					seenHashes.add(hash);
					validImages.push({ ext: magic.ext, buffer: buf });

					this.update(sessionId, {
						currentChapterPagesDone: pIdx + 1,
					});
				}

				if (validImages.length === 0) {
					warnings.push(`Capítulo ${chIdx + 1} não produziu imagens válidas.`);
					continue;
				}

				this.update(sessionId, {
					state: 'preparing_cbz',
					statusMessage: `Preparando CBZ do capítulo ${chIdx + 1} (${validImages.length} páginas)…`,
				});

				const meta = adapter.parseChapterMetadata(targetUrl);
				const workTitle = workTitleOverride?.trim() || meta.workTitle;
				const workSlug = sanitizeStorageSlug(workTitle);
				const chapterNumber = meta.chapterNumber || String(chIdx + 1);
				const chapterSlug = sanitizeStorageSlug(chapterNumber);

				const zip = new AdmZip();
				for (let i = 0; i < validImages.length; i++) {
					zip.addFile(`${String(i + 1).padStart(4, '0')}${validImages[i]!.ext}`, validImages[i]!.buffer);
				}
				zip.addFile(
					'aethera-source.json',
					Buffer.from(
						JSON.stringify(
							{
								schemaVersion: 1,
								importMode: 'interactive_persistent_browser',
								workTitle,
								workSlug,
								chapterNumber,
								sourceUrl: targetUrl.toString(),
								seriesProjectId: seriesProjectId ?? null,
								pageCount: validImages.length,
								createdAtIso: new Date().toISOString(),
							},
							null,
							2,
						),
						'utf-8',
					),
				);

				const targetCbzPath = resolveSafeStoragePath(this.options.libraryDir, workSlug, `cap-${chapterSlug}.cbz`);
				mkdirSync(join(this.options.libraryDir, workSlug), { recursive: true });
				const cbzBuffer = zip.toBuffer();
				writeFileSync(targetCbzPath, cbzBuffer);

				const entry: RecapLibraryEntry = {
					id: `${workSlug}__cap-${chapterSlug}`,
					workSlug,
					workTitle,
					chapterNumber,
					sourceUrl: targetUrl.toString(),
					adapterId: 'interactive_persistent_browser',
					cbzPath: targetCbzPath,
					pageCount: validImages.length,
					cbzSha256: createHash('sha256').update(cbzBuffer).digest('hex'),
					importedAtIso: new Date().toISOString(),
				};
				registerLibraryEntry(this.options.libraryDir, entry);
				importedEntries.push(entry);

				this.update(sessionId, {
					completedChapters: importedEntries.length,
					importedEntries: [...importedEntries],
					warnings: [...warnings],
				});
			}

			if (importedEntries.length === 0) {
				this.update(sessionId, {
					state: 'access_denied',
					statusMessage: 'Nenhum capítulo pôde ser extraído desta fonte. Utilize a Importação Assistida por arquivos.',
					error: 'Nenhuma página de capítulo extraída.',
					warnings,
				});
				return;
			}

			this.update(sessionId, {
				state: 'completed',
				statusMessage: `Concluído! ${importedEntries.length} capítulo(s) importado(s) e prontos em CBZ.`,
				completedChapters: importedEntries.length,
				importedEntries,
				warnings,
			});
		} catch (err) {
			if (this.cancelFlags.has(sessionId)) return;
			const classified = classifyBrowserLaunchError(err);
			this.update(sessionId, {
				state: 'access_denied',
				statusMessage: `[${classified.code}] ${classified.message}`,
				error: classified.message,
				errorCode: classified.code,
				...(classified.diagnosticDetail ? { diagnosticDetail: classified.diagnosticDetail } : {}),
			});
		} finally {
			// Close the window cleanly after completion/error while preserving the persistent profile on disk
			if (context && this.activeContexts.get(originKey) === context) {
				this.activeContexts.delete(originKey);
				await context.close().catch(() => {});
			}
			this.cancelFlags.delete(sessionId);
		}
	}
}
