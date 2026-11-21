/**
 * Import Checkpoint Store — Persistent Job State for Crash Recovery (Fases 5 & 6)
 *
 * Persists RecapImportJob state to disk so that in-progress imports can be
 * resumed after app restart, crash, or unexpected shutdown.
 *
 * Storage format: JSON files in <libraryDir>/checkpoints/<jobId>.json
 * Atomic writes via tmp + rename to prevent corruption on crash.
 *
 * SECURITY: All paths resolved via resolveSafeStoragePath to prevent traversal.
 * No sensitive data (credentials, tokens) is persisted — only job metadata and progress.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { RecapImportJob, RecapImportJobStatus } from './batch-import-queue.js';
import { resolveSafeStoragePath } from './url-security.js';

const CHECKPOINT_DIR = 'checkpoints';
const CHECKPOINT_EXT = '.json';
const CHECKPOINT_SCHEMA_VERSION = 1;

export interface ImportCheckpointRecord {
	schemaVersion: number;
	jobId: string;
	status: RecapImportJobStatus;
	items: Array<{
		url: string;
		chapterNumber?: string;
		status: RecapImportJob['items'][number]['status'];
		pagesDone: number;
		pagesTotal: number;
		error?: string;
	}>;
	completedChapters: number;
	totalChapters: number;
	createdAtIso: string;
	updatedAtIso: string;
	error?: string;
}

/**
 * Saves a job checkpoint atomically to disk.
 * Uses tmp file + rename to prevent partial writes on crash.
 */
export function saveImportCheckpoint(libraryDir: string, job: RecapImportJob): void {
	const checkpointDir = resolveSafeStoragePath(libraryDir, CHECKPOINT_DIR);
	if (!existsSync(checkpointDir)) {
		mkdirSync(checkpointDir, { recursive: true });
	}

	const record: ImportCheckpointRecord = {
		schemaVersion: CHECKPOINT_SCHEMA_VERSION,
		jobId: job.id,
		status: job.status,
		items: job.items.map((item) => {
			const mapped: ImportCheckpointRecord['items'][number] = {
				url: item.url,
				status: item.status,
				pagesDone: item.pagesDone,
				pagesTotal: item.pagesTotal,
			};
			if (item.chapterNumber !== undefined) mapped.chapterNumber = item.chapterNumber;
			if (item.error !== undefined) mapped.error = item.error;
			return mapped;
		}),
		completedChapters: job.completedChapters,
		totalChapters: job.totalChapters,
		createdAtIso: job.createdAtIso,
		updatedAtIso: new Date().toISOString(),
	};
	if (job.error !== undefined) record.error = job.error;

	const targetPath = resolveSafeStoragePath(checkpointDir, `${job.id}${CHECKPOINT_EXT}`);
	const tmpPath = `${targetPath}.tmp.${process.pid}.${Date.now()}`;

	writeFileSync(tmpPath, JSON.stringify(record, null, 2), 'utf-8');
	renameSync(tmpPath, targetPath);
}

/**
 * Loads a job checkpoint from disk. Returns null if not found or corrupted.
 */
export function loadImportCheckpoint(libraryDir: string, jobId: string): ImportCheckpointRecord | null {
	try {
		const checkpointDir = resolveSafeStoragePath(libraryDir, CHECKPOINT_DIR);
		const filePath = resolveSafeStoragePath(checkpointDir, `${jobId}${CHECKPOINT_EXT}`);

		if (!existsSync(filePath)) return null;

		const raw = readFileSync(filePath, 'utf-8');
		const record = JSON.parse(raw) as ImportCheckpointRecord;

		if (record.schemaVersion !== CHECKPOINT_SCHEMA_VERSION) return null;
		if (record.jobId !== jobId) return null;

		return record;
	} catch {
		return null;
	}
}

/**
 * Lists all persisted checkpoint job IDs.
 */
export function listCheckpointJobIds(libraryDir: string): string[] {
	try {
		const checkpointDir = resolveSafeStoragePath(libraryDir, CHECKPOINT_DIR);
		if (!existsSync(checkpointDir)) return [];

		return readdirSync(checkpointDir)
			.filter((f) => f.endsWith(CHECKPOINT_EXT))
			.map((f) => f.slice(0, -CHECKPOINT_EXT.length));
	} catch {
		return [];
	}
}

/**
 * Removes a checkpoint file after successful completion or explicit cancellation.
 */
export function removeImportCheckpoint(libraryDir: string, jobId: string): void {
	try {
		const checkpointDir = resolveSafeStoragePath(libraryDir, CHECKPOINT_DIR);
		const filePath = resolveSafeStoragePath(checkpointDir, `${jobId}${CHECKPOINT_EXT}`);
		if (existsSync(filePath)) {
			unlinkSync(filePath);
		}
	} catch {
		// Best-effort cleanup — don't throw on failure
	}
}

/**
 * Restores incomplete jobs from checkpoints on app startup.
 * Only restores jobs that were in 'running', 'queued', or 'paused' state.
 * Completed, failed, and cancelled jobs are cleaned up.
 */
export function restoreIncompleteJobs(libraryDir: string): ImportCheckpointRecord[] {
	const restorableStatuses = new Set<RecapImportJobStatus>(['running', 'queued', 'paused']);
	const restored: ImportCheckpointRecord[] = [];

	for (const jobId of listCheckpointJobIds(libraryDir)) {
		const record = loadImportCheckpoint(libraryDir, jobId);
		if (!record) {
			removeImportCheckpoint(libraryDir, jobId);
			continue;
		}

		if (restorableStatuses.has(record.status)) {
			// Reset 'running' jobs to 'queued' since the process restarted
			if (record.status === 'running') {
				record.status = 'queued';
				// Reset any items that were mid-download back to pending
				for (const item of record.items) {
					if (item.status === 'analyzing' || item.status === 'downloading' || item.status === 'packing_cbz') {
						item.status = 'pending';
					}
				}
			}
			restored.push(record);
		} else {
			// Terminal states — clean up the checkpoint
			removeImportCheckpoint(libraryDir, jobId);
		}
	}

	return restored;
}