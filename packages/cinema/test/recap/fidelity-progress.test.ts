import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecapFidelityProgress } from '../../src/recap/fidelity-progress.js';
import type { ExtractedPanel } from '../../src/recap/recap-types.js';

function panel(panelId: string): ExtractedPanel {
	return {
		panelId,
		pageNumber: 0,
		panelIndex: Number(panelId.split('_')[1] ?? 0),
		imagePath: `/tmp/${panelId}.png`,
		imageHash: `hash-${panelId}`,
		x: 0,
		y: 0,
		width: 100,
		height: 100,
		readingOrder: 'ltr',
		sourceKind: 'panel_crop',
	};
}

test('progress distinguishes pending panels from analyzed but unverified panels', () => {
	const report = buildRecapFidelityProgress({
		panels: [panel('p0_0'), panel('p0_1')],
		analyses: [{
			panelId: 'p0_0',
			nature: 'action',
			description: 'observed',
			characters: [],
			actions: [],
			setting: null,
			mood: null,
			visualElements: [],
			dialogues: [],
			sequenceIndex: 0,
			analysisConfidence: 0.9,
			limitations: [],
		}],
	});
	assert.deepEqual(report.counts, { verified: 0, needs_review: 0, rejected: 0, unverified: 1, pending_analysis: 1 });
	assert.equal(report.panels[0]?.eligibility, 'blocked');
	assert.equal(report.storyEngineBlocked, true);
});

test('independent gate evidence is the only path to narrative eligibility', () => {
	const report = buildRecapFidelityProgress({
		panels: [panel('p0_0')],
		gateReport: {
			gate: 'recap_narrative_fidelity',
			status: 'verified',
			checkedAtIso: '2026-11-24T00:00:00.000Z',
			panels: [{
				panelId: 'p0_0',
				status: 'verified',
				eligibility: 'narrative_eligible',
				issues: [],
				checks: {
					structural: { status: 'pass', evidence: [] }, integrity: { status: 'pass', evidence: [] },
					visual: { status: 'pass', evidence: [] }, textual: { status: 'pass', evidence: [] },
					continuity: { status: 'pass', evidence: [] }, evidence: { status: 'pass', evidence: [{ source: 'human_review', detail: 'reviewed' }] },
				},
			}],
			chapterIssues: [],
			metrics: { panelCount: 1, verifiedPanels: 1, needsReviewPanels: 0, rejectedPanels: 0, unverifiedPanels: 0, majorOrCriticalIssues: 0, minorIssues: 0, narrativeEligiblePanels: 1, visualOnlyPanels: 0, blockedPanels: 0, issueCounts: {}, checksAudited: 6, checksWithEvidence: 1 },
			storyEngineEligiblePanelIds: ['p0_0'], visualOnlyPanelIds: [], blockedPanelIds: [], humanReviewQueue: [],
		},
	});
	assert.equal(report.panels[0]?.status, 'verified');
	assert.equal(report.panels[0]?.eligibility, 'narrative_eligible');
	assert.equal(report.storyEngineBlocked, false);
});
