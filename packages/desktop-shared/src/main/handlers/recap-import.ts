/**
 * Recap Import IPC Handlers (Fase 3)
 *
 * Bridges the Acquisition Engine (cinema/url-importer) to the Electron renderer
 * via IPC channels defined in @neuralbridge/shared/channels.
 *
 * Follows the project's registerIpcHandler convention with IpcMainLike,
 * parseIpcInput/parseIpcOutput validation, and isTrustedSender(url) guard.
 *
 * SECURITY: All URL inputs validated against SSRF via url-security.ts.
 * No Cloudflare/CAPTCHA bypass. Errors reported honestly to the UI.
 */

import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import { IpcChannel, IpcEvent } from '@neuralbridge/shared/channels';
import {
	RecapImportJobManager,
	type RecapImportJob,
} from '@neuralbridge/cinema/recap/batch-import-queue';
import {
	AcquisitionRouter,
	AcquisitionTelemetry,
	createElectronPlaywrightProvider,
	createFirecrawlSelfHostedProvider,
} from '@neuralbridge/cinema/recap/url-importer';
import type { AcquisitionProviderHealth } from '@neuralbridge/cinema/recap/url-importer/acquisition-router';
import { registerIpcHandler, type IpcMainLike } from '../ipc/handle.js';

export interface RecapImportHandlerDeps {
	/** Root directory for the Aethera Recap library (CBZ storage). */
	libraryDir: string;
	/** Function to show native file open dialog. Injected to avoid direct Electron import in tests. */
	showOpenDialog: () => Promise<{ filePaths: string[]; canceled: boolean }>;
	/** Function to send IPC events to the renderer. Injected for testability. */
	sendToRenderer: (channel: string, ...args: unknown[]) => void;
}

let jobManager: RecapImportJobManager | null = null;
let router: AcquisitionRouter | null = null;
let telemetry: AcquisitionTelemetry | null = null;

/**
 * Initializes the Acquisition Router with available providers.
 * Called once during app startup or lazily on first IPC call.
 */
function ensureRouter(): AcquisitionRouter {
	if (router) return router;

	telemetry = new AcquisitionTelemetry();
	router = new AcquisitionRouter({ telemetry });

	// Register Electron/Playwright provider (always available in Electron context)
	const electronProvider = createElectronPlaywrightProvider();
	router.registerProvider(electronProvider);

	// Register Firecrawl self-hosted provider (optional, disabled by default)
	const firecrawlProvider = createFirecrawlSelfHostedProvider();
	router.registerProvider(firecrawlProvider);

	return router;
}

/**
 * Ensures the RecapImportJobManager is initialized with the correct library dir
 * and wired to the AcquisitionRouter for discovery.
 */
function ensureJobManager(libraryDir: string): RecapImportJobManager {
	if (jobManager) return jobManager;

	const r = ensureRouter();

	jobManager = new RecapImportJobManager({
		libraryDir,
		discoveryPort: r,
		concurrency: 3,
		maxRetries: 2,
		baseBackoffMs: 500,
	});

	return jobManager;
}

/**
 * Registers all Recap Import IPC handlers following the project's convention.
 * Call this during Electron main process initialization alongside other handler registrations.
 */
export function registerRecapImportIpcHandlers(
	ipc: IpcMainLike,
	deps: RecapImportHandlerDeps,
	isTrustedSender: (url: string) => boolean,
): void {
	const { libraryDir, showOpenDialog, sendToRenderer } = deps;

	// Ensure library directory exists
	if (!existsSync(libraryDir)) {
		mkdirSync(libraryDir, { recursive: true });
	}

	// Helper to subscribe to job updates and forward to renderer
	const subscribeToJob = (jobId: string): void => {
		const mgr = ensureJobManager(libraryDir);
		mgr.subscribe(jobId, (updated) => {
			sendToRenderer(IpcEvent.recapImportJobChanged, updated);
		});
	};

	// ─── Create Import Job ──────────────────────────────────────────────────────
	registerIpcHandler(ipc, IpcChannel.recapImportCreateJob, async (input) => {
		const mgr = ensureJobManager(libraryDir);
		const job = mgr.createJob({ urls: input.urls, forceReimport: input.forceReimport });
		subscribeToJob(job.id);
		return job;
	}, isTrustedSender);

	// ─── Get Job Status ─────────────────────────────────────────────────────────
	registerIpcHandler(ipc, IpcChannel.recapImportGetJob, async (input) => {
		const mgr = ensureJobManager(libraryDir);
		return mgr.getJob(input.jobId);
	}, isTrustedSender);

	// ─── List All Jobs ──────────────────────────────────────────────────────────
	registerIpcHandler(ipc, IpcChannel.recapImportListJobs, async () => {
		const mgr = ensureJobManager(libraryDir);
		return mgr.listJobs();
	}, isTrustedSender);

	// ─── Pause Job ──────────────────────────────────────────────────────────────
	registerIpcHandler(ipc, IpcChannel.recapImportPauseJob, async (input) => {
		const mgr = ensureJobManager(libraryDir);
		const job = mgr.pauseJob(input.jobId);
		if (job) sendToRenderer(IpcEvent.recapImportJobChanged, job);
		return job;
	}, isTrustedSender);

	// ─── Resume Job ─────────────────────────────────────────────────────────────
	registerIpcHandler(ipc, IpcChannel.recapImportResumeJob, async (input) => {
		const mgr = ensureJobManager(libraryDir);
		const job = mgr.resumeJob(input.jobId);
		if (job) {
			subscribeToJob(job.id);
			sendToRenderer(IpcEvent.recapImportJobChanged, job);
		}
		return job;
	}, isTrustedSender);

	// ─── Cancel Job ─────────────────────────────────────────────────────────────
	registerIpcHandler(ipc, IpcChannel.recapImportCancelJob, async (input) => {
		const mgr = ensureJobManager(libraryDir);
		const job = mgr.cancelJob(input.jobId);
		if (job) sendToRenderer(IpcEvent.recapImportJobChanged, job);
		return job;
	}, isTrustedSender);

	// ─── Retry Job ──────────────────────────────────────────────────────────────
	registerIpcHandler(ipc, IpcChannel.recapImportRetryJob, async (input) => {
		const mgr = ensureJobManager(libraryDir);
		const job = mgr.retryJob(input.jobId);
		if (job) {
			subscribeToJob(job.id);
			sendToRenderer(IpcEvent.recapImportJobChanged, job);
		}
		return job;
	}, isTrustedSender);

	// ─── Provider Health ────────────────────────────────────────────────────────
	registerIpcHandler(ipc, IpcChannel.recapImportProviderHealth, async () => {
		const r = ensureRouter();
		return r.getProviderHealth();
	}, isTrustedSender);

	// ─── Select Local Files (CBZ/PDF) ───────────────────────────────────────────
	registerIpcHandler(ipc, IpcChannel.recapImportSelectLocalFiles, async () => {
		return showOpenDialog();
	}, isTrustedSender);
}

/**
 * Resets the singleton instances. Useful for testing or hot-reload scenarios.
 */
export function resetRecapImportHandlers(): void {
	jobManager = null;
	router = null;
	telemetry = null;
}