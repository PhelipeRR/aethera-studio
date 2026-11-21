import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createAetheraApiApp } from '../server.js';

describe('Aethera Web Cloud Social Publishing Hub (SQLite persistence, restart & Remote Host offline)', () => {
	let tmpDir: string;
	let dbPath: string;

	beforeEach(() => {
		tmpDir = join(tmpdir(), `aethera-web-cloud-pub-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
		mkdirSync(tmpDir, { recursive: true });
		dbPath = join(tmpDir, 'aethera-web-test.db');
	});

	afterEach(() => {
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it('persists reference schedule 25/11/2026 18:00 America/Sao_Paulo across restarts and runs cloud worker with Remote Host offline', async () => {
		const setupToken = 'test-setup-token-2026';
		// Boot instance 1
		const inst1 = createAetheraApiApp({
			dbPath,
			rendersDir: join(tmpDir, 'renders'),
			credentialKeyFile: join(tmpDir, 'cred.key'),
			adminSetupToken: setupToken,
			enforceHttps: false,
		});
		const server1 = inst1.app.listen(0, '127.0.0.1');
		const addr1 = server1.address() as { port: number };
		const baseUrl1 = `http://127.0.0.1:${addr1.port}`;

		try {
			// Register admin user & obtain session cookie
			const setupRes = await fetch(`${baseUrl1}/api/auth/setup-admin`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					email: 'studio@aethera.test',
					password: 'StrongPassword123!',
					name: 'Studio Admin',
					setupToken,
				}),
			});
			expect(setupRes.status).toBe(201);
			const setupBody = (await setupRes.json()) as { csrfToken?: string };
			const cookie1 = setupRes.headers.get('set-cookie')?.match(/(aethera_sid=[^;]+)/)?.[1] ?? '';
			const csrf1 = setupBody.csrfToken ?? '';

			// 1. Schedule reference event (25/11/2026 18:00 America/Sao_Paulo -> 2026-11-25T21:00:00.000Z)
			const schedRes = await fetch(`${baseUrl1}/api/social-publishing/schedule`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: cookie1, origin: baseUrl1, 'x-csrf-token': csrf1 },
				body: JSON.stringify({
					publicationId: 'cloud_ref_2026_11_25',
					title: 'Nano Machine — Capítulos 1–5',
					description: 'Recap multicapítulos sem spoilers',
					platforms: ['youtube', 'instagram', 'tiktok'],
					scheduledPublishAtIso: '2026-11-25T21:00:00.000Z',
					timezone: 'America/Sao_Paulo',
					status: 'scheduled',
					reviewApproved: true,
					qualityGates: { allMandatoryPassed: true },
					rightsVerification: { verified: true },
				}),
			});
			expect(schedRes.status).toBe(201);

			// 2. Reschedule from Calendar view
			const reschedRes = await fetch(`${baseUrl1}/api/social-publishing/reschedule`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: cookie1, origin: baseUrl1, 'x-csrf-token': csrf1 },
				body: JSON.stringify({
					publicationId: 'cloud_ref_2026_11_25',
					targetDateIso: '2026-11-25T21:00:00.000Z',
					reason: 'Confirmado para 18:00 BRT',
				}),
			});
			expect(reschedRes.status).toBe(200);
		} finally {
			server1.closeAllConnections?.();
			await new Promise<void>((resolve) => server1.close(() => resolve()));
			inst1.db.close();
		}

		// Boot instance 2 against the SAME SQLite database (no Remote Host connected!)
		const inst2 = createAetheraApiApp({
			dbPath,
			rendersDir: join(tmpDir, 'renders'),
			credentialKeyFile: join(tmpDir, 'cred.key'),
			adminSetupToken: setupToken,
			enforceHttps: false,
		});
		const server2 = inst2.app.listen(0, '127.0.0.1');
		const addr2 = server2.address() as { port: number };
		const baseUrl2 = `http://127.0.0.1:${addr2.port}`;

		try {
			const loginRes = await fetch(`${baseUrl2}/api/auth/login`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ email: 'studio@aethera.test', password: 'StrongPassword123!' }),
			});
			expect(loginRes.status).toBe(200);
			const loginBody = (await loginRes.json()) as { csrfToken?: string };
			const cookie2 = loginRes.headers.get('set-cookie')?.match(/(aethera_sid=[^;]+)/)?.[1] ?? '';
			const csrf2 = loginBody.csrfToken ?? '';

			// Verify persistence after restart
			const listRes = await fetch(`${baseUrl2}/api/social-publishing/events`, {
				headers: { cookie: cookie2 },
			});
			const listJson = (await listRes.json()) as {
				events: Array<{ publicationId: string; scheduledPublishAtIso: string; platforms: string[] }>;
				cloudSchedulerActive: boolean;
				remoteHostRequired: boolean;
			};
			expect(listJson.cloudSchedulerActive).toBe(true);
			expect(listJson.remoteHostRequired).toBe(false);
			expect(listJson.events).toHaveLength(1);
			expect(listJson.events[0]?.publicationId).toBe('cloud_ref_2026_11_25');
			expect(listJson.events[0]?.scheduledPublishAtIso).toBe('2026-11-25T21:00:00.000Z');

			// Execute cloud worker tick: YouTube OK, TikTok FAIL, Instagram independent OK
			const tickRes = await fetch(`${baseUrl2}/api/social-publishing/worker/tick`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: cookie2, origin: baseUrl2, 'x-csrf-token': csrf2 },
				body: JSON.stringify({
					nowIso: '2026-11-25T21:05:00.000Z',
					simulatedOutcomes: {
						youtube: { ok: true, remoteId: 'yt_cloud_1' },
						tiktok: { ok: false, error: 'TikTok rate limit 429' },
						instagram: { ok: true, remoteId: 'ig_cloud_1' },
					},
				}),
			});
			expect(tickRes.status).toBe(200);
			const tickJson = (await tickRes.json()) as {
				events: Array<{ platformTargets: Record<string, { status: string }> }>;
			};
			const targets = tickJson.events[0]!.platformTargets;
			expect(targets.youtube?.status).toBe('published');
			expect(targets.tiktok?.status).toBe('failed');
			expect(targets.instagram?.status).toBe('published');
		} finally {
			server2.closeAllConnections?.();
			await new Promise<void>((resolve) => server2.close(() => resolve()));
			inst2.db.close();
		}
	});
});
