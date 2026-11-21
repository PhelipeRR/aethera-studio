import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { createServer, type Server } from 'node:http';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	asuraScansAdapter,
	importChapter,
	InteractiveRecapBrowserSessionManager,
	SiteAdapterRegistry,
	type ChapterSiteAdapter,
} from '../../src/recap/index.js';

const tempDir = mkdtempSync(join(tmpdir(), 'aethera-interactive-pw-'));
let demoServer: Server;
let demoPort = 0;
let expireSessionOnChapter2 = false;
let deniedHitCount = 0;

function makePng(seed: number): Buffer {
	const buf = Buffer.alloc(512, seed);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
	return buf;
}

beforeAll(async () => {
	demoServer = createServer((req, res) => {
		const urlPath = req.url ?? '/';
		const cookie = req.headers.cookie ?? '';
		const isAuthenticated = cookie.includes('demo_session=authorized');

		// 1. Explicit access-denied route (HTTP 403)
		if (urlPath.startsWith('/denied/')) {
			deniedHitCount++;
			res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end('<html><head><title>403 Forbidden</title></head><body><h1>Acesso automatizado negado (403)</h1></body></html>');
			return;
		}

		// 2. Interactive login form
		if (urlPath.startsWith('/login') && req.method === 'GET') {
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(`<html><head><title>Login Demo</title></head><body>
				<form method="POST" action="/login" data-aethera-auth-required="true">
					<input type="text" name="user" id="user" />
					<input type="password" name="pass" id="pass" />
					<button type="submit" id="submit-login">Entrar</button>
				</form>
			</body></html>`);
			return;
		}

		if (urlPath.startsWith('/login') && req.method === 'POST') {
			res.writeHead(302, {
				'Set-Cookie': 'demo_session=authorized; Path=/; HttpOnly; Max-Age=3600',
				Location: '/comics/demo-manga/chapter/1',
			});
			res.end();
			return;
		}

		// 2b. Scenario A: Immediately accessible chapter (NO challenge, NO login required),
		// even though the page template contains a hidden navbar <input type="password">,
		// a comment-widget recaptcha script reference, and lazy-loaded reader images without [data-page]!
		if (urlPath === '/public/chapter/1') {
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(`<html><head><title>Nano Machine Chapter 1</title>
				<script>/* comment widget recaptcha config */ window.__RECAPTCHA_SITE_KEY = 'demo';</script>
			</head><body>
				<nav style="display:none"><input type="password" name="navbar_pw" /></nav>
				<img src="/assets/logo.png" alt="logo" width="40" height="40" />
				<main class="reading-content">
					<img data-src="/public-img/p1.png" alt="chapter page 1" width="800" height="1200" />
					<img src="/public-img/p2.png" alt="chapter page 2" width="800" height="1200" />
				</main>
			</body></html>`);
			return;
		}

		if (urlPath === '/public-img/p1.png' || urlPath === '/public-img/p2.png') {
			const seed = urlPath.includes('p1') ? 71 : 72;
			res.writeHead(200, { 'Content-Type': 'image/png' });
			res.end(makePng(seed));
			return;
		}

		// 3. Protected chapters (require authenticated session)
		const chMatch = /^\/comics\/demo-manga\/chapter\/(\d+)$/.exec(urlPath);
		if (chMatch) {
			const chNum = Number(chMatch[1]);
			if (!isAuthenticated || (expireSessionOnChapter2 && chNum === 2)) {
				res.writeHead(302, {
					'Set-Cookie': 'demo_session=; Path=/; Max-Age=0',
					Location: '/login',
				});
				res.end();
				return;
			}
			res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
			res.end(`<html><head><title>Demo Manga Cap ${chNum}</title></head><body>
				<div data-page="2"><img src="/img/ch${chNum}-p2.png" /></div>
				<div data-page="1"><img src="/img/ch${chNum}-p1.png" /></div>
			</body></html>`);
			return;
		}

		// 4. Protected chapter images (require session cookie)
		const imgMatch = /^\/img\/ch(\d+)-p(\d+)\.png$/.exec(urlPath);
		if (imgMatch) {
			if (!isAuthenticated) {
				res.writeHead(401);
				res.end('Unauthorized');
				return;
			}
			const seed = Number(imgMatch[1]) * 10 + Number(imgMatch[2]);
			res.writeHead(200, { 'Content-Type': 'image/png' });
			res.end(makePng(seed));
			return;
		}

		res.writeHead(404);
		res.end('Not found');
	});

	await new Promise<void>((resolve) => {
		demoServer.listen(0, '127.0.0.1', () => {
			const addr = demoServer.address();
			demoPort = typeof addr === 'object' && addr ? addr.port : 0;
			resolve();
		});
	});
});

afterAll(async () => {
	await new Promise<void>((resolve) => demoServer.close(() => resolve()));
	try {
		rmSync(tempDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

function makeDemoRegistry(): SiteAdapterRegistry {
	const adapter: ChapterSiteAdapter = {
		...asuraScansAdapter,
		id: 'demo-interactive-site',
		displayName: 'Demo Auth Site',
		supportedHosts: ['127.0.0.1'],
		matchesUrl: (u) => u.hostname === '127.0.0.1',
		parseChapterMetadata: (u) => ({
			workSlug: 'demo-manga',
			workTitle: 'Demo Manga',
			chapterNumber: /chapter\/(\d+)/.exec(u.pathname)?.[1] ?? '1',
		}),
	};
	return new SiteAdapterRegistry([adapter]);
}

describe('Interactive Persistent Browser Session (Tests 1–7 + Scenarios A & B)', () => {
	test('Scenario A: chapter accessible immediately without Cloudflare challenge never gets stuck in awaiting_user_verification', async () => {
		const statesSeen: string[] = [];
		let awaitingCallbackTriggered = false;

		const mgr = new InteractiveRecapBrowserSessionManager({
			profilesRootDir: join(tempDir, 'profiles-scenario-a'),
			libraryDir: join(tempDir, 'library-scenario-a'),
			registry: makeDemoRegistry(),
			headless: true,
			allowLocalhostForTests: true,
			pollIntervalMs: 150,
			onAwaitingVerificationForTest: async () => {
				awaitingCallbackTriggered = true;
			},
		});

		const s = mgr.startInteractiveImport({
			urls: [`http://127.0.0.1:${demoPort}/public/chapter/1`],
			workTitle: 'Nano Machine',
			seriesProjectId: 'nano-machine',
		});
		mgr.subscribe(s.sessionId, (snap) => statesSeen.push(snap.state));
		const end = await mgr.waitForSessionEnd(s.sessionId);

		// MUST NOT get stuck in awaiting_user_verification when chapter images are already accessible!
		expect(awaitingCallbackTriggered).toBe(false);
		expect(statesSeen).not.toContain('awaiting_user_verification');
		expect(statesSeen).toContain('verifying_access');
		expect(statesSeen).toContain('access_authorized');
		expect(statesSeen).toContain('importing_chapters');
		expect(statesSeen).toContain('preparing_cbz');
		expect(end.state).toBe('completed');
		expect(end.completedChapters).toBe(1);
		expect(end.importedEntries[0]!.pageCount).toBe(2);
	}, 20_000);

	test('Scenario B + Tests 1, 2, 3 & 4: initially blocked page waits for manual verification, persists session, and imports multi-chapter CBZs', async () => {
		const profilesRootDir = join(tempDir, 'profiles');
		const libraryDir = join(tempDir, 'library-1');
		const statesSeen: string[] = [];

		// Run 1: requires interactive user login -> automatically continues to import Cap 1 & Cap 2
		const mgr1 = new InteractiveRecapBrowserSessionManager({
			profilesRootDir,
			libraryDir,
			registry: makeDemoRegistry(),
			headless: true,
			allowLocalhostForTests: true,
			pollIntervalMs: 150,
			interChapterDelayMs: 50,
			onAwaitingVerificationForTest: async (page) => {
				// Simulate manual user completing login in the visible browser
				await page.fill?.('#user', 'reader');
				await page.fill?.('#pass', 'secret');
				await page.click?.('#submit-login');
			},
		});

		const s1 = mgr1.startInteractiveImport({
			urls: [
				`http://127.0.0.1:${demoPort}/comics/demo-manga/chapter/1`,
				`http://127.0.0.1:${demoPort}/comics/demo-manga/chapter/2`,
			],
			workTitle: 'Demo Manga',
			seriesProjectId: 'demo-manga',
		});
		mgr1.subscribe(s1.sessionId, (snap) => statesSeen.push(snap.state));
		const end1 = await mgr1.waitForSessionEnd(s1.sessionId);

		expect(end1.state).toBe('completed');
		expect(end1.completedChapters).toBe(2);
		expect(end1.importedEntries).toHaveLength(2);
		expect(statesSeen).toContain('awaiting_user_verification');
		expect(statesSeen).toContain('access_authorized');
		expect(statesSeen).toContain('importing_chapters');
		expect(statesSeen).toContain('preparing_cbz');

		// Verify valid CBZ via importChapter()
		const cbz1 = end1.importedEntries[0]!.cbzPath;
		expect(existsSync(cbz1)).toBe(true);
		const imported1 = await importChapter({
			chapterId: 'demo-manga-cap-1',
			archivePath: cbz1,
			outputDir: join(tempDir, 'extracted-1'),
		});
		expect(imported1.format).toBe('cbz');
		expect(imported1.pageCount).toBe(2);

		// Run 2 (Test 2 — Session Persistence): brand new manager instance reusing SAME profile dir!
		// Must NOT prompt for login again (onAwaitingVerificationForTest should NEVER be called!)
		let loginPromptedAgain = false;
		const mgr2 = new InteractiveRecapBrowserSessionManager({
			profilesRootDir,
			libraryDir: join(tempDir, 'library-2'),
			registry: makeDemoRegistry(),
			headless: true,
			allowLocalhostForTests: true,
			pollIntervalMs: 150,
			interChapterDelayMs: 50,
			onAwaitingVerificationForTest: async () => {
				loginPromptedAgain = true;
			},
		});
		const s2 = mgr2.startInteractiveImport({
			urls: [`http://127.0.0.1:${demoPort}/comics/demo-manga/chapter/3`],
			workTitle: 'Demo Manga',
		});
		const end2 = await mgr2.waitForSessionEnd(s2.sessionId);
		expect(loginPromptedAgain).toBe(false);
		expect(end2.state).toBe('completed');
		expect(end2.completedChapters).toBe(1);

		// Verify profile wipe works cleanly
		const wipe = await mgr2.clearOriginProfile(`http://127.0.0.1:${demoPort}/comics/demo-manga/chapter/3`);
		expect(wipe.cleared).toBe(true);
	}, 30_000);

	test('Test 5: expired session mid-queue pauses cleanly with session_expired', async () => {
		expireSessionOnChapter2 = true;
		try {
			const mgr = new InteractiveRecapBrowserSessionManager({
				profilesRootDir: join(tempDir, 'profiles-expire'),
				libraryDir: join(tempDir, 'library-expire'),
				registry: makeDemoRegistry(),
				headless: true,
				allowLocalhostForTests: true,
				pollIntervalMs: 150,
				interChapterDelayMs: 50,
				onAwaitingVerificationForTest: async (page) => {
					await page.fill?.('#user', 'reader');
					await page.fill?.('#pass', 'secret');
					await page.click?.('#submit-login');
				},
			});

			const s = mgr.startInteractiveImport({
				urls: [
					`http://127.0.0.1:${demoPort}/comics/demo-manga/chapter/1`,
					`http://127.0.0.1:${demoPort}/comics/demo-manga/chapter/2`,
				],
				workTitle: 'Demo Manga',
			});
			const end = await mgr.waitForSessionEnd(s.sessionId);
			expect(end.state).toBe('session_expired');
			expect(end.completedChapters).toBe(1);
			expect(end.statusMessage).toMatch(/expirada/i);
		} finally {
			expireSessionOnChapter2 = false;
		}
	}, 20_000);

	test('Test 6 & 7: explicit access denial (HTTP 403) stops immediately without bypass or retry loop', async () => {
		deniedHitCount = 0;
		const mgr = new InteractiveRecapBrowserSessionManager({
			profilesRootDir: join(tempDir, 'profiles-denied'),
			libraryDir: join(tempDir, 'library-denied'),
			registry: makeDemoRegistry(),
			headless: true,
			allowLocalhostForTests: true,
			pollIntervalMs: 150,
		});

		const s = mgr.startInteractiveImport({
			urls: [
				`http://127.0.0.1:${demoPort}/denied/chapter/1`,
				`http://127.0.0.1:${demoPort}/denied/chapter/2`,
			],
		});
		const end = await mgr.waitForSessionEnd(s.sessionId);
		expect(end.state).toBe('access_denied');
		expect(deniedHitCount).toBe(1); // Stopped immediately on first 403 — zero retries, zero bypass!
		expect(end.statusMessage).toMatch(/arquivos/i);
	}, 20_000);
});
