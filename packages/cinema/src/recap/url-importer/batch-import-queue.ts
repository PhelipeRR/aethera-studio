/**
 * Batch Chapter Import Queue & Real-Time Progress Manager (Etapas 3 & 5)
 *
 * Supports single and multi-chapter queued imports with pause, resume, cancel,
 * retry, deduplication of already-imported chapters, and real-time event emission
 * for SSE / IPC progress updates.
 */

import {
	analyzeChapterUrl,
	buildAndRegisterChapterCbz,
	downloadChapterPages,
	findExistingLibraryEntry,
	type ImageDownloadPort,
	type PageDiscoveryPort,
	type RecapLibraryEntry,
} from './url-chapter-importer.js';
import type { SiteAdapterRegistry } from './site-adapters.js';

export type RecapImportJobStatus =
	| 'queued'
	| 'running'
	| 'paused'
	| 'cancelled'
	| 'completed'
	| 'failed';

export interface RecapImportChapterItem {
	url: string;
	chapterNumber?: string;
	status: 'pending' | 'analyzing' | 'downloading' | 'packing_cbz' | 'skipped_existing' | 'completed' | 'failed' | 'cancelled';
	pagesDone: number;
	pagesTotal: number;
	libraryEntry?: RecapLibraryEntry;
	error?: string;
}

export interface RecapImportJob {
	id: string;
	status: RecapImportJobStatus;
	items: RecapImportChapterItem[];
	completedChapters: number;
	totalChapters: number;
	createdAtIso: string;
	updatedAtIso: string;
	error?: string;
}

export type RecapImportJobListener = (job: RecapImportJob) => void;

export class RecapImportJobManager {
	private readonly jobs = new Map<string, RecapImportJob>();
	private readonly controllers = new Map<string, AbortController>();
	private readonly pausedFlags = new Map<string, boolean>();
	private readonly listeners = new Map<string, Set<RecapImportJobListener>>();

	constructor(
		private readonly options: {
			libraryDir: string;
			registry?: SiteAdapterRegistry;
			discoveryPort?: PageDiscoveryPort;
			downloader?: ImageDownloadPort;
			allowHttpForTests?: boolean;
			concurrency?: number;
			maxRetries?: number;
			baseBackoffMs?: number;
		},
	) {}

	getJob(id: string): RecapImportJob | null {
		const j = this.jobs.get(id);
		return j ? structuredClone(j) : null;
	}

	listJobs(): RecapImportJob[] {
		return [...this.jobs.values()].map((j) => structuredClone(j));
	}

	subscribe(jobId: string, listener: RecapImportJobListener): () => void {
		const set = this.listeners.get(jobId) ?? new Set();
		set.add(listener);
		this.listeners.set(jobId, set);
		return () => {
			set.delete(listener);
		};
	}

	private emit(job: RecapImportJob): void {
		job.updatedAtIso = new Date().toISOString();
		const snapshot = structuredClone(job);
		const set = this.listeners.get(job.id);
		if (set) {
			for (const fn of set) {
				try {
					fn(snapshot);
				} catch {
					// ignore listener errors
				}
			}
		}
	}

	createJob(input: { urls: readonly string[]; forceReimport?: boolean }): RecapImportJob {
		if (input.urls.length === 0) {
			throw new Error('Informe ao menos uma URL de capítulo para importar.');
		}
		const id = `imp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
		const now = new Date().toISOString();
		const job: RecapImportJob = {
			id,
			status: 'queued',
			items: input.urls.map((url) => ({
				url,
				status: 'pending',
				pagesDone: 0,
				pagesTotal: 0,
			})),
			completedChapters: 0,
			totalChapters: input.urls.length,
			createdAtIso: now,
			updatedAtIso: now,
		};
		this.jobs.set(id, job);
		this.pausedFlags.set(id, false);
		void this.runJobLoop(id, Boolean(input.forceReimport));
		return structuredClone(job);
	}

	pauseJob(id: string): RecapImportJob | null {
		const job = this.jobs.get(id);
		if (!job || (job.status !== 'running' && job.status !== 'queued')) return job ? structuredClone(job) : null;
		this.pausedFlags.set(id, true);
		job.status = 'paused';
		this.emit(job);
		return structuredClone(job);
	}

	resumeJob(id: string): RecapImportJob | null {
		const job = this.jobs.get(id);
		if (!job || job.status !== 'paused') return job ? structuredClone(job) : null;
		this.pausedFlags.set(id, false);
		job.status = 'running';
		this.emit(job);
		void this.runJobLoop(id, false);
		return structuredClone(job);
	}

	cancelJob(id: string): RecapImportJob | null {
		const job = this.jobs.get(id);
		if (!job) return null;
		this.pausedFlags.set(id, false);
		this.controllers.get(id)?.abort();
		job.status = 'cancelled';
		for (const item of job.items) {
			if (item.status === 'pending' || item.status === 'analyzing' || item.status === 'downloading') {
				item.status = 'cancelled';
			}
		}
		this.emit(job);
		return structuredClone(job);
	}

	retryJob(id: string): RecapImportJob | null {
		const job = this.jobs.get(id);
		if (!job) return null;
		this.pausedFlags.set(id, false);
		delete job.error;
		for (const item of job.items) {
			if (item.status === 'failed' || item.status === 'cancelled') {
				item.status = 'pending';
				item.pagesDone = 0;
				delete item.error;
			}
		}
		job.status = 'queued';
		this.emit(job);
		void this.runJobLoop(id, false);
		return structuredClone(job);
	}

	async waitForJob(id: string): Promise<RecapImportJob> {
		const current = this.jobs.get(id);
		if (!current) throw new Error(`Job não encontrado: ${id}`);
		if (current.status === 'completed' || current.status === 'failed' || current.status === 'cancelled' || current.status === 'paused') {
			return structuredClone(current);
		}
		return new Promise((resolve) => {
			const unsub = this.subscribe(id, (snap) => {
				if (snap.status === 'completed' || snap.status === 'failed' || snap.status === 'cancelled' || snap.status === 'paused') {
					unsub();
					resolve(snap);
				}
			});
		});
	}

	private async runJobLoop(id: string, forceReimport: boolean): Promise<void> {
		const job = this.jobs.get(id);
		if (!job) return;
		const controller = new AbortController();
		this.controllers.set(id, controller);
		job.status = 'running';
		this.emit(job);

		try {
			for (const item of job.items) {
				if (controller.signal.aborted || job.status === 'cancelled') {
					return;
				}
				if (this.pausedFlags.get(id)) {
					job.status = 'paused';
					this.emit(job);
					return;
				}
				if (item.status === 'completed' || item.status === 'skipped_existing') {
					continue;
				}

				// Avoid re-downloading already imported chapters
				if (!forceReimport) {
					const existing = findExistingLibraryEntry(this.options.libraryDir, item.url);
					if (existing) {
						item.status = 'skipped_existing';
						item.chapterNumber = existing.chapterNumber;
						item.pagesDone = existing.pageCount;
						item.pagesTotal = existing.pageCount;
						item.libraryEntry = existing;
						job.completedChapters = job.items.filter((x) => x.status === 'completed' || x.status === 'skipped_existing').length;
						this.emit(job);
						continue;
					}
				}

				try {
					item.status = 'analyzing';
					this.emit(job);

					const analyzed = await analyzeChapterUrl({
						url: item.url,
						libraryDir: this.options.libraryDir,
						...(this.options.registry ? { registry: this.options.registry } : {}),
						...(this.options.discoveryPort ? { discoveryPort: this.options.discoveryPort } : {}),
						...(this.options.allowHttpForTests ? { allowHttpForTests: true } : {}),
						signal: controller.signal,
					});

					item.chapterNumber = analyzed.meta.chapterNumber;
					item.pagesTotal = analyzed.pages.length;
					item.status = 'downloading';
					this.emit(job);

					const downloaded = await downloadChapterPages({
						pages: analyzed.pages,
						refererUrl: analyzed.sourceUrl,
						...(this.options.downloader ? { downloader: this.options.downloader } : {}),
						...(this.options.concurrency !== undefined ? { concurrency: this.options.concurrency } : {}),
						...(this.options.maxRetries !== undefined ? { maxRetries: this.options.maxRetries } : {}),
						...(this.options.baseBackoffMs !== undefined ? { baseBackoffMs: this.options.baseBackoffMs } : {}),
						signal: controller.signal,
						onProgress: (done, total) => {
							item.pagesDone = done;
							item.pagesTotal = total;
							this.emit(job);
						},
					});

					item.status = 'packing_cbz';
					this.emit(job);

					const entry = buildAndRegisterChapterCbz({
						analyzed,
						downloadedPages: downloaded,
						libraryDir: this.options.libraryDir,
					});

					item.libraryEntry = entry;
					item.status = 'completed';
					job.completedChapters = job.items.filter((x) => x.status === 'completed' || x.status === 'skipped_existing').length;
					this.emit(job);
				} catch (err) {
					if (controller.signal.aborted || job.status === 'cancelled') {
						item.status = 'cancelled';
						this.emit(job);
						return;
					}
					item.status = 'failed';
					item.error = err instanceof Error ? err.message : String(err);
					this.emit(job);
				}
			}

			if (this.pausedFlags.get(id)) {
				job.status = 'paused';
			} else if (job.items.some((i) => i.status === 'failed')) {
				job.status = 'failed';
				job.error = 'Um ou mais capítulos falharam durante a importação.';
			} else if (job.status !== 'cancelled') {
				job.status = 'completed';
			}
			this.emit(job);
		} finally {
			this.controllers.delete(id);
		}
	}
}
