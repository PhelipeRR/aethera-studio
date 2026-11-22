/** Runs one MOGRT job off the main thread. The engine is CPU-bound and blocks while it draws. */

import { parentPort, workerData } from 'node:worker_threads';
import { renderMogrtPhase3AToMp4 } from '../../../../packages/cinema/src/motionvelix/mogrt-comp-renderer.js';
import {
	describeMogrtTemplate,
	renderMogrtPreviewPng,
} from '../../../../packages/cinema/src/motionvelix/mogrt-template-studio.js';
import type { MogrtRenderSummary } from '../renderer/src/mogrt-studio-contract.js';
import type { MogrtJob, MogrtWorkerMessage } from './mogrt-worker-protocol.js';

const send = (message: MogrtWorkerMessage): void => parentPort?.postMessage(message);

async function run(job: MogrtJob): Promise<unknown> {
	if (job.type === 'inspect') return describeMogrtTemplate(job.mogrtPath, job.workDir);
	const { mogrtPath, workDir, width, height, overrides } = job;
	const common = { mogrtPath, workDir, width, height, overrides };
	if (job.type === 'preview') {
		renderMogrtPreviewPng({ ...common, outputPngPath: job.outputPath, tSec: job.tSec });
		return null;
	}
	const report = await renderMogrtPhase3AToMp4({
		...common,
		outputMp4Path: job.outputPath,
		onProgress: (done, total) => send({ type: 'progress', done, total }),
	});
	const summary: MogrtRenderSummary = {
		verdict: report.completenessVerdict,
		reason: report.completenessReason,
		effects: report.unsupportedEffectsEncountered.map(({ layerName, displayName, matchName, reason }) => ({
			layerName,
			name: displayName || matchName,
			reason,
		})),
		gaps: [
			...report.renderGaps.map(({ layerName, reason }) => ({ layerName, reason })),
			...report.expressionsAudit.unsupportedUnique.map(({ layerName, reason }) => ({ layerName, reason })),
			...report.warnings.map((reason) => ({ layerName: '', reason })),
		],
		approximations: report.approximations,
	};
	return summary;
}

// A rejection reaches the main process as the worker's `error` event.
void run(workerData as MogrtJob).then(
	(value) => send({ type: 'result', value }),
	(error: unknown) => {
		setImmediate(() => {
			throw error instanceof Error ? error : new Error(String(error));
		});
	},
);
