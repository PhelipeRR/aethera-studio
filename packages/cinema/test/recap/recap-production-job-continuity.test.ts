/**
 * Recap production continuity: jobs run detached from any UI, survive subscriber loss,
 * deduplicate on reconnect, pause/resume/cancel at safe checkpoints and recover after the
 * executor process restarts. Uses synthetic fixtures only (no paid providers).
 */

import { describe, it, expect } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	RecapProductionJobManager,
	RecapJobInterruptedError,
	requestRecapJobControl,
	listRecapJobs,
	readRecapJob,
	runRecapProductionOrchestrator,
	loadOrchestratorState,
	type ExtractedPanel,
	type RecapJobContext,
	type RecapJobExecutor,
	type RecapJobRecord,
	type VisionAdapter,
} from '../../src/recap/index.js';

const tick = () => new Promise((r) => setTimeout(r, 5));

/** Executor that walks N "panels", reporting progress and honouring checkpoints. */
function steppedExecutor(opts: { panels: number; gate?: { released: boolean } ; seen?: string[] }): RecapJobExecutor {
	return async (job: RecapJobRecord, ctx: RecapJobContext) => {
		const start = job.progress.completedPanels ?? 0;
		ctx.report({ stage: 'gate-f', completedSteps: ['import'], totalPanels: opts.panels });
		ctx.checkpoint('gate-f');
		ctx.report({ stage: 'vision', completedSteps: ['import', 'gate-f'] });
		for (let i = start; i < opts.panels; i += 1) {
			ctx.checkpoint('vision');
			while (opts.gate && !opts.gate.released) await tick();
			await tick();
			opts.seen?.push(`${job.jobId}:${i}`);
			ctx.report({ completedPanels: i + 1, canResume: true });
		}
		return { status: 'awaiting_approval', message: 'Prévia pronta.', completedSteps: ['import', 'gate-f', 'vision'] };
	};
}

function withWorkspace(fn: (dir: string) => Promise<void>) {
	return async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-jobs-'));
		try {
			await fn(dir);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	};
}

const startInput = { kind: 'production' as const, projectId: 'run-1', chapterId: 'cap-1', workTitle: 'Cap 1', input: { archivePath: '/x.cbz' } };

describe('Recap production job manager — continuity', () => {
	it('keeps advancing with no subscriber connected and finishes on its own', withWorkspace(async (dir) => {
		const manager = new RecapProductionJobManager({ workspaceDir: dir, executor: steppedExecutor({ panels: 5 }), pollIntervalMs: 0 });
		const { job, created } = manager.start(startInput);
		expect(created).toBe(true);
		expect(job.status).toBe('running');
		// No onEvent listener, nobody awaiting: the job must still complete.
		const done = await manager.waitForIdle(job.jobId);
		expect(done?.status).toBe('awaiting_approval');
		expect(done?.progress.completedPanels).toBe(5);
		expect(readRecapJob(dir, job.jobId)?.status).toBe('awaiting_approval');
	}));

	it('returns the same job on reconnect/refresh instead of starting a duplicate', withWorkspace(async (dir) => {
		const gate = { released: false };
		const seen: string[] = [];
		const manager = new RecapProductionJobManager({ workspaceDir: dir, executor: steppedExecutor({ panels: 3, gate, seen }), pollIntervalMs: 0 });
		const first = manager.start(startInput);
		// A second window / page refresh asks again for the same project and for the same chapter.
		const again = manager.start(startInput);
		const sameChapter = manager.start({ ...startInput, projectId: 'run-other' });
		expect(again.created).toBe(false);
		expect(sameChapter.created).toBe(false);
		expect(again.job.jobId).toBe(first.job.jobId);
		expect(sameChapter.job.jobId).toBe(first.job.jobId);
		expect(listRecapJobs(dir)).toHaveLength(1);
		gate.released = true;
		await manager.waitForIdle(first.job.jobId);
		expect(new Set(seen.map((s) => s.split(':')[0])).size).toBe(1);
	}));

	it('pauses at a safe checkpoint, persists it and resumes from the next panel', withWorkspace(async (dir) => {
		const gate = { released: false };
		const seen: string[] = [];
		const manager = new RecapProductionJobManager({ workspaceDir: dir, executor: steppedExecutor({ panels: 4, gate, seen }), pollIntervalMs: 0 });
		const { job } = manager.start(startInput);
		await tick();
		expect(manager.pause(job.jobId)?.status).toBe('pause_requested');
		gate.released = true;
		const paused = await manager.waitForIdle(job.jobId);
		expect(paused?.status).toBe('paused');
		expect(paused?.checkpoint.canResume).toBe(true);
		const panelsBefore = paused?.progress.completedPanels ?? 0;
		expect(panelsBefore).toBeLessThan(4);

		manager.resume(job.jobId);
		const done = await manager.waitForIdle(job.jobId);
		expect(done?.status).toBe('awaiting_approval');
		// Resume continued from the checkpoint: no panel was processed twice.
		const indexes = seen.map((s) => Number(s.split(':')[1]));
		expect(indexes).toEqual([...new Set(indexes)]);
		expect(indexes).toHaveLength(4);
	}));

	it('cancels explicitly at a safe point and allows a fresh production afterwards', withWorkspace(async (dir) => {
		const gate = { released: false };
		const manager = new RecapProductionJobManager({ workspaceDir: dir, executor: steppedExecutor({ panels: 3, gate }), pollIntervalMs: 0 });
		const { job } = manager.start(startInput);
		await tick();
		expect(manager.cancel(job.jobId)?.status).toBe('cancel_requested');
		gate.released = true;
		expect((await manager.waitForIdle(job.jobId))?.status).toBe('cancelled');
		const next = manager.start(startInput);
		expect(next.created).toBe(true);
		expect(next.job.jobId).not.toBe(job.jobId);
		await manager.waitForIdle(next.job.jobId);
	}));

	it('honours a pause requested by another process (Remote Host) through the control file', withWorkspace(async (dir) => {
		const gate = { released: false };
		const manager = new RecapProductionJobManager({ workspaceDir: dir, executor: steppedExecutor({ panels: 3, gate }), pollIntervalMs: 0 });
		const { job } = manager.start(startInput);
		await tick();
		expect(requestRecapJobControl(dir, job.jobId, 'pause', 'remote-host')?.action).toBe('pause');
		manager.tick();
		gate.released = true;
		expect((await manager.waitForIdle(job.jobId))?.status).toBe('paused');
		requestRecapJobControl(dir, job.jobId, 'resume', 'remote-host');
		manager.tick();
		expect(manager.isExecuting(job.jobId)).toBe(true);
		expect((await manager.waitForIdle(job.jobId))?.status).toBe('awaiting_approval');
	}));

	it('recovers after the executor restarts mid-stage and resumes the same job from its checkpoint', withWorkspace(async (dir) => {
		const gate = { released: false };
		const seen: string[] = [];
		const dead = new RecapProductionJobManager({ workspaceDir: dir, executor: steppedExecutor({ panels: 4, gate, seen }), pollIntervalMs: 0, instanceId: 'executor-a' });
		const { job } = dead.start(startInput);
		gate.released = true;
		while ((readRecapJob(dir, job.jobId)?.progress.completedPanels ?? 0) < 2) await tick();
		gate.released = false; // freeze "executor-a" mid-vision, as if the process died
		const snapshot = readRecapJob(dir, job.jobId)!;
		expect(snapshot.status).toBe('running');
		dead.dispose();

		const seen2: string[] = [];
		const restarted = new RecapProductionJobManager({ workspaceDir: dir, executor: steppedExecutor({ panels: 4, seen: seen2 }), pollIntervalMs: 0, instanceId: 'executor-b' });
		const recovered = restarted.recoverOnStartup({ autoResume: true });
		expect(recovered).toHaveLength(1);
		expect(recovered[0]?.jobId).toBe(job.jobId);
		expect(recovered[0]?.errors.some((e) => e.message === 'executor_restarted')).toBe(true);
		const done = await restarted.waitForIdle(job.jobId);
		expect(done?.status).toBe('awaiting_approval');
		expect(done?.attempts).toBe(2);
		// Same job, no duplicate, and the restarted executor began after the checkpointed panels.
		expect(listRecapJobs(dir)).toHaveLength(1);
		expect(seen2.map((s) => Number(s.split(':')[1]))[0]).toBeGreaterThanOrEqual(snapshot.progress.completedPanels ?? 0);
	}));

	it('reports clearly when recovery after restart is impossible', withWorkspace(async (dir) => {
		const gate = { released: false };
		const dead = new RecapProductionJobManager({ workspaceDir: dir, executor: steppedExecutor({ panels: 2, gate }), pollIntervalMs: 0, instanceId: 'a' });
		const { job } = dead.start(startInput);
		await tick();
		const restarted = new RecapProductionJobManager({ workspaceDir: dir, executor: steppedExecutor({ panels: 2 }), pollIntervalMs: 0, instanceId: 'b' });
		const [rec] = restarted.recoverOnStartup({ autoResume: true, canRecover: () => 'arquivo de origem não existe mais' });
		expect(rec?.status).toBe('failed');
		expect(rec?.message).toContain('Recuperação impossível');
		expect(rec?.errors.at(-1)?.message).toContain('recovery_impossible');
		expect(restarted.isExecuting(job.jobId)).toBe(false);
	}));

	it('a start request after an executor crash adopts the orphaned job instead of duplicating it', withWorkspace(async (dir) => {
		const gate = { released: false };
		const dead = new RecapProductionJobManager({ workspaceDir: dir, executor: steppedExecutor({ panels: 2, gate }), pollIntervalMs: 0, instanceId: 'a' });
		const { job } = dead.start(startInput);
		await tick();
		const restarted = new RecapProductionJobManager({ workspaceDir: dir, executor: steppedExecutor({ panels: 2 }), pollIntervalMs: 0, instanceId: 'b' });
		const again = restarted.start(startInput);
		expect(again.created).toBe(false);
		expect(again.job.jobId).toBe(job.jobId);
		expect((await restarted.waitForIdle(job.jobId))?.status).toBe('awaiting_approval');
		expect(listRecapJobs(dir)).toHaveLength(1);
	}));

	it('a crash between "pause requested" and the checkpoint ends paused, never silently running', withWorkspace(async (dir) => {
		const gate = { released: false };
		const dead = new RecapProductionJobManager({ workspaceDir: dir, executor: steppedExecutor({ panels: 2, gate }), pollIntervalMs: 0, instanceId: 'a' });
		const { job } = dead.start(startInput);
		await tick();
		dead.pause(job.jobId);
		const restarted = new RecapProductionJobManager({ workspaceDir: dir, executor: steppedExecutor({ panels: 2 }), pollIntervalMs: 0, instanceId: 'b' });
		const [rec] = restarted.recoverOnStartup({ autoResume: true });
		expect(rec?.status).toBe('paused');
		expect(restarted.isExecuting(job.jobId)).toBe(false);
	}));
});

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

function makePanel(id: string, n: number, imagePath: string): ExtractedPanel {
	return {
		panelId: id,
		pagePath: imagePath,
		croppedImagePath: imagePath,
		imageHash: `hash-${id}`,
		metadata: {
			sourceKind: 'panel_crop',
			origin: 'webtoon_extract',
			chapterId: 'fixture-cap-ctl',
			pageNumber: n,
			panelIndex: n,
			readingOrder: 'vertical',
			boundingBox: { x: 0, y: n * 100, w: 800, h: 1000 },
			classification: 'action',
			ocrStatus: 'not_run',
			ocrConfidence: 0,
		},
	} as unknown as ExtractedPanel;
}

describe('Recap orchestrator — cooperative control', () => {
	it('stops at a panel boundary on pause without marking the run failed', withWorkspace(async (dir) => {
		const img = join(dir, 'panel.png');
		writeFileSync(img, Buffer.from(PNG_1PX, 'base64'));
		const panels = [makePanel('p1', 1, img), makePanel('p2', 2, img), makePanel('p3', 3, img)];
		let analyzed = 0;
		const visionAdapter: VisionAdapter = {
			name: 'fixture-vision',
			analyze: async () => {
				analyzed += 1;
				return { description: 'Personagem observa a cidade.', characters: [], actions: [], dialogues: [], confidence: 0.9 } as never;
			},
		};
		let calls = 0;
		const control = {
			checkpoint: () => {
				calls += 1;
				// Let the first panel through, then request a pause.
				if (analyzed >= 1) throw new RecapJobInterruptedError('pause', 'vision');
			},
		};
		await expect(
			runRecapProductionOrchestrator({
				runId: 'run-ctl',
				chapterId: 'fixture-cap-ctl',
				workTitle: 'Fixture',
				panels,
				workspaceDir: dir,
				visionAdapter,
				providers: [{ id: 'fixture', label: 'Fixture', detect: async () => ({ available: true }) }],
				dryRunRender: true,
				control,
			}),
		).rejects.toMatchObject({ name: 'RecapJobInterruptedError', action: 'pause' });
		expect(calls).toBeGreaterThan(0);
		expect(analyzed).toBe(1);
		const state = loadOrchestratorState(join(dir, 'state'));
		expect(state === null || state.state !== 'failed').toBe(true);
		expect(existsSync(join(dir, 'checkpoints', 'fixture-cap-ctl'))).toBe(true);
	}));
});
