import type { MogrtProgress, MogrtValue } from '../renderer/src/mogrt-studio-contract.js';

interface JobBase {
	mogrtPath: string;
	workDir: string;
}

interface DrawJob extends JobBase {
	outputPath: string;
	width: number;
	height: number;
	overrides: { controls: Record<string, MogrtValue>; logoPath?: string; bgImagePath?: string };
}

export type MogrtJob =
	| (JobBase & { type: 'inspect' })
	| (DrawJob & { type: 'preview'; tSec: number })
	| (DrawJob & { type: 'render' });

export type MogrtWorkerMessage = { type: 'result'; value: unknown } | ({ type: 'progress' } & MogrtProgress);
