import { strict as assert } from 'node:assert';
import { mkdtemp, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, it } from 'node:test';
import {
	loadCheckpoint,
	recapAnalysisFingerprint,
	recapFidelityReviewLedgerSchema,
	runRecapProductionOrchestrator,
	type ExtractedPanel,
} from '../../src/recap/index.js';

const SHA = 'c'.repeat(64);
const tempDirs: string[] = [];
afterEach(async () => {
	while (tempDirs.length > 0) await rm(tempDirs.pop()!, { recursive: true, force: true });
});

function panel(): ExtractedPanel {
	return {
		panelId: 'panel-1',
		pagePath: 'fixture.png',
		metadata: {
			sourceKind: 'panel_crop', origin: 'manga_scan', chapterId: 'chapter-1', pageNumber: 0, panelIndex: 0,
			readingOrder: 'ltr', boundingBox: { x: 0, y: 0, w: 100, h: 100 }, classification: 'dialogue', ocrStatus: 'not_run', ocrConfidence: 0,
		},
		imageHash: SHA,
		width: 100,
		height: 100,
	};
}

async function run(workspaceDir: string, ledger?: unknown) {
	let calls = 0;
	const result = await runRecapProductionOrchestrator({
		runId: 'ledger-run',
		chapterId: 'chapter-1',
		workTitle: 'Fixture',
		panels: [panel()],
		workspaceDir,
		providers: [{ id: 'mock', label: 'Mock', detect: async () => ({ available: true }) }],
		visionAdapter: {
			name: 'mock-vision',
			analyze: async () => { calls += 1; return { visualDescription: 'Figura fala em uma sala.', characters: ['figura'], actions: [{ type: 'dialogue' as const, description: 'fala' }], emotions: ['neutral' as const], setting: 'sala', confidence: 0.9 }; },
		},
		analysisSettings: { strictFidelity: true },
		...(ledger ? { fidelityReviewLedger: recapFidelityReviewLedgerSchema.parse(ledger) } : {}),
		dryRunRender: true,
	});
	return { result, calls };
}

function progress(workspaceDir: string) {
	return JSON.parse(readFileSync(join(workspaceDir, 'projects', 'ledger-run', 'fidelity', 'fidelity-progress.json'), 'utf8')) as { counts: Record<string, number>; storyEngineBlocked: boolean };
}

it('strict fidelity uses the review ledger after analysis and stops blocking only for matching evidence', async () => {
	const workspaceDir = await mkdtemp(join(tmpdir(), 'aethera-recap-ledger-'));
	tempDirs.push(workspaceDir);

	const first = await run(workspaceDir);
	assert.match(first.result.record.lastError ?? '', /strict fidelity blocked Story Engine/);
	assert.equal(progress(workspaceDir).counts['unverified'], 1);

	const analysis = loadCheckpoint(join(workspaceDir, 'checkpoints', 'chapter-1'))?.panelAnalyses?.[0];
	assert.ok(analysis);
	const detail = 'Crop confere com a descrição e a fala.';
	const ledger = {
		schemaVersion: 1,
		chapterId: 'chapter-1',
		reviews: [{
			panelId: 'panel-1', panelSha256: SHA, analysisSha256: recapAnalysisFingerprint(analysis),
			status: 'verified', evidence: [{ source: 'image', detail, ref: 'panel-1' }], issues: [],
			reviewer: 'test', reviewedAtIso: '2026-11-24T00:00:00.000Z', origin: 'fixture',
		}],
	};
	const second = await run(workspaceDir, ledger);
	assert.equal(second.calls, 0, 'resume must reuse the persisted analysis');
	assert.doesNotMatch(second.result.record.lastError ?? '', /strict fidelity blocked Story Engine/);
	assert.equal(progress(workspaceDir).counts['verified'], 1);
	assert.equal(progress(workspaceDir).storyEngineBlocked, false);
	assert.equal(second.result.record.fidelityGate?.status, 'verified');
});
