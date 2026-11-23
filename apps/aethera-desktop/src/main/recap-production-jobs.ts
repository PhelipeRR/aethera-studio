/**
 * Desktop side of durable Recap production jobs.
 *
 * The Electron main process is the local executor: jobs run here, detached from the renderer,
 * so closing a tab, navigating away or reloading the window never cancels or pauses them.
 * The renderer only observes (`recap:job-update`) and sends explicit pause/resume/cancel.
 */

import { existsSync } from 'node:fs';
import { BrowserWindow, type IpcMain } from 'electron';
import {
	RECAP_JOB_TERMINAL_STATUSES,
	type RecapJobOutcome,
	type RecapJobRecord,
	type RecapOrchestratorRecord,
	type RecapProductionJobManager,
} from '@neuralbridge/cinema';

/** Maps the orchestrator's final record to the job outcome. Gate verdicts are never touched. */
export function recapRecordToJobOutcome(record: RecapOrchestratorRecord, fallbackMessage?: string): RecapJobOutcome {
	const message = record.lastError ?? fallbackMessage ?? `Estado atual: ${record.state}.`;
	const base = { message, stage: record.currentStage ?? null, completedSteps: record.completedSteps };
	switch (record.state) {
		case 'completed':
			return { ...base, status: 'completed' };
		case 'awaiting_preview_approval':
			return { ...base, status: 'awaiting_approval' };
		case 'paused_provider_unavailable':
			return { ...base, status: 'paused_provider_unavailable', canResume: true };
		case 'failed':
			return { ...base, status: 'failed' };
		default:
			return { ...base, status: 'failed', message: `Execução terminou em estado inesperado: ${record.state}.` };
	}
}

/** Why an interrupted job cannot be resumed after a restart, or null when it can. */
export function recapJobRecoveryBlocker(job: RecapJobRecord, projectExists: (runId: string) => boolean): string | null {
	if (job.kind === 'master_export') {
		return projectExists(job.projectId) ? null : `projeto ${job.projectId} não existe mais no workspace.`;
	}
	const paths = [job.input['archivePath'], ...((job.input['archivePaths'] as unknown[] | undefined) ?? [])].filter(
		(p): p is string => typeof p === 'string' && p.length > 0,
	);
	if (paths.length === 0) return 'o job não guardou o arquivo de origem.';
	const missing = paths.filter((p) => !existsSync(p));
	if (missing.length > 0) return `arquivo de origem não encontrado: ${missing[0]}`;
	return null;
}

export function broadcastRecapJobUpdate(job: RecapJobRecord): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.webContents.send('recap:job-update', job);
	}
}

export function registerRecapJobIpc(options: {
	ipcMain: IpcMain;
	manager: RecapProductionJobManager;
	ensureTrusted: (senderFrame: Electron.WebFrameMain | null) => void;
}): void {
	const { ipcMain, manager, ensureTrusted } = options;

	ipcMain.handle('recap:jobs-list', (event, input?: { includeFinished?: boolean; limit?: number }) => {
		ensureTrusted(event.senderFrame);
		const limit = Math.max(1, Math.min(100, input?.limit ?? 20));
		const jobs = manager.list().filter((j) => input?.includeFinished || !RECAP_JOB_TERMINAL_STATUSES.includes(j.status));
		return jobs.slice(0, limit).map((j) => ({ ...j, executing: manager.isExecuting(j.jobId) }));
	});

	ipcMain.handle('recap:job-get', (event, input: { jobId: string }) => {
		ensureTrusted(event.senderFrame);
		return manager.get(String(input?.jobId ?? ''));
	});

	const control = (action: 'pause' | 'resume' | 'cancel') => (event: Electron.IpcMainInvokeEvent, input: { jobId: string }) => {
		ensureTrusted(event.senderFrame);
		const jobId = String(input?.jobId ?? '');
		const job =
			action === 'pause' ? manager.pause(jobId, 'desktop') : action === 'cancel' ? manager.cancel(jobId, 'desktop') : manager.resume(jobId);
		return job ? { ok: true, job } : { ok: false, message: 'Job de produção não encontrado.' };
	};
	ipcMain.handle('recap:job-pause', control('pause'));
	ipcMain.handle('recap:job-resume', control('resume'));
	ipcMain.handle('recap:job-cancel', control('cancel'));
}
