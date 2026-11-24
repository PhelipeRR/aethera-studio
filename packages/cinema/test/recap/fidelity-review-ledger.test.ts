import assert from 'node:assert/strict';
import test from 'node:test';
import { canForwardToStoryEngine } from '../../src/recap/recap-fidelity-gate.js';
import {
	buildRecapFidelityGateFromReviews,
	recapAnalysisFingerprint,
	recapFidelityReviewLedgerSchema,
	type RecapFidelityReviewLedger,
	type RecapFidelityReviewRecord,
} from '../../src/recap/recap-fidelity-review-ledger.js';
import { panelAnalysisSchema, type ExtractedPanel, type PanelAnalysis } from '../../src/recap/recap-types.js';

const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

function panel(panelId: string, panelIndex: number, imageHash: string): ExtractedPanel {
	return {
		panelId,
		pagePath: `/fixture/page_0001.webp`,
		croppedImagePath: `/fixture/${panelId}.png`,
		metadata: {
			sourceKind: 'panel_crop', origin: 'manga_scan', chapterId: 'fixture', pageNumber: 1, panelIndex,
			readingOrder: 'ltr', boundingBox: { x: 0, y: panelIndex * 100, w: 100, h: 100 }, classification: 'action', ocrStatus: 'not_run', ocrConfidence: 0,
		},
		imageHash,
		width: 100,
		height: 100,
	} as ExtractedPanel;
}

function analysis(panelId: string, text: string): PanelAnalysis {
	return panelAnalysisSchema.parse({
		panelId,
		visualDescription: 'Figura encapuzada ergue a espada.',
		characters: ['figura encapuzada'],
		dialogues: [{ text, kind: 'dialogue', isNarration: false }],
		actions: [{ type: 'combat', description: 'ergue a espada' }],
		emotions: [],
		evidence: [],
		analysisConfidence: 0.8,
		analyzedBy: 'local-vlm',
		analyzedAtIso: '2026-11-24T00:00:00.000Z',
	});
}

function review(panelId: string, panelSha256: string, target: PanelAnalysis, status: RecapFidelityReviewRecord['status'] = 'verified'): RecapFidelityReviewRecord {
	const detail = status === 'verified' ? 'Crop confere com descrição e balão.' : 'Fala inventada a partir de SFX.';
	return {
		panelId,
		panelSha256,
		analysisSha256: recapAnalysisFingerprint(target),
		status,
		evidence: [{ source: 'image', detail, ref: panelId }],
		issues: status === 'verified' ? [] : [{ code: 'SFX_AS_DIALOGUE', severity: 'major', detail, evidence: [{ source: 'image', detail, ref: panelId }], blocksNarrativeFact: true }],
		reviewer: 'test',
		reviewedAtIso: '2026-11-24T00:00:00.000Z',
		origin: 'fixture',
	};
}

function ledger(reviews: RecapFidelityReviewRecord[]): RecapFidelityReviewLedger {
	return recapFidelityReviewLedgerSchema.parse({ schemaVersion: 1, chapterId: 'fixture', reviews });
}

test('reviews bound to crop and analysis make every panel eligible', () => {
	const panels = [panel('p1_0', 0, SHA_A), panel('p1_1', 1, SHA_B)];
	const analyses = [analysis('p1_0', 'WHO ARE YOU!'), analysis('p1_1', 'HUH?')];
	const result = buildRecapFidelityGateFromReviews({ panels, analyses, ledger: ledger(analyses.map((item, index) => review(item.panelId, index === 0 ? SHA_A : SHA_B, item))) });
	assert.deepEqual(result.report.storyEngineEligiblePanelIds, ['p1_0', 'p1_1']);
	assert.equal(result.report.status, 'verified');
	assert.equal(canForwardToStoryEngine(result.report), true);
	assert.deepEqual(result.staleReviewPanelIds, []);
});

test('a review of an older analysis never approves re-analysed content', () => {
	const panels = [panel('p1_0', 0, SHA_A)];
	const reviewed = analysis('p1_0', 'WHO ARE YOU!');
	const reanalysed = analysis('p1_0', 'KOOY');
	const result = buildRecapFidelityGateFromReviews({ panels, analyses: [reanalysed], ledger: ledger([review('p1_0', SHA_A, reviewed)]) });
	assert.deepEqual(result.staleReviewPanelIds, ['p1_0']);
	assert.equal(result.report.panels[0]?.status, 'unverified');
	assert.equal(canForwardToStoryEngine(result.report), false);
});

test('a review of another crop is stale even when the analysis matches', () => {
	const panels = [panel('p1_0', 0, SHA_B)];
	const item = analysis('p1_0', 'WHO ARE YOU!');
	const result = buildRecapFidelityGateFromReviews({ panels, analyses: [item], ledger: ledger([review('p1_0', SHA_A, item)]) });
	assert.deepEqual(result.staleReviewPanelIds, ['p1_0']);
	assert.equal(canForwardToStoryEngine(result.report), false);
});

test('needs_review evidence blocks the panel and keeps it in the review queue', () => {
	const panels = [panel('p1_0', 0, SHA_A), panel('p1_1', 1, SHA_B)];
	const analyses = [analysis('p1_0', 'WHO ARE YOU!'), analysis('p1_1', 'ok')];
	const result = buildRecapFidelityGateFromReviews({ panels, analyses, ledger: ledger([review('p1_0', SHA_A, analyses[0]!), review('p1_1', SHA_B, analyses[1]!, 'needs_review')]) });
	assert.deepEqual(result.report.blockedPanelIds, ['p1_1']);
	assert.deepEqual(result.report.humanReviewQueue, ['p1_1']);
	assert.equal(canForwardToStoryEngine(result.report), false);
});

test('without a ledger every analysed panel stays unverified and is listed', () => {
	const panels = [panel('p1_0', 0, SHA_A), panel('p1_1', 1, SHA_B)];
	const result = buildRecapFidelityGateFromReviews({ panels, analyses: [analysis('p1_0', 'HUH?')], ledger: null });
	assert.deepEqual(result.unreviewedPanelIds, ['p1_0']);
	assert.deepEqual(result.missingAnalysisPanelIds, ['p1_1']);
	assert.equal(canForwardToStoryEngine(result.report), false);
});

test('ledger schema rejects reviews without visual evidence or with contradictory status', () => {
	const item = analysis('p1_0', 'HUH?');
	const base = review('p1_0', SHA_A, item);
	assert.throws(() => ledger([{ ...base, evidence: [{ source: 'checkpoint', detail: 'schema ok' }] }]));
	assert.throws(() => ledger([{ ...base, issues: review('p1_0', SHA_A, item, 'needs_review').issues }]));
	assert.throws(() => ledger([{ ...review('p1_0', SHA_A, item, 'needs_review'), issues: [] }]));
	assert.throws(() => buildRecapFidelityGateFromReviews({ panels: [panel('p1_0', 0, SHA_A)], analyses: [item], ledger: { schemaVersion: 1, chapterId: 'fixture', reviews: [base, base] } }));
});

test('an ambiguous panel can be kept visual-only with evidence without blocking the chapter', () => {
	const panels = [panel('p1_0', 0, SHA_A)];
	const item = analysis('p1_0', 'HUH?');
	const detail = 'Membro ambíguo em vegetação; sem fato narrativo.';
	const ambiguous: RecapFidelityReviewRecord = {
		...review('p1_0', SHA_A, item),
		status: 'needs_review',
		eligibility: 'visual_only',
		issues: [{ code: 'INSUFFICIENT_EVIDENCE', severity: 'minor', detail, evidence: [{ source: 'image', detail, ref: 'p1_0' }], blocksNarrativeFact: false }],
	};
	const result = buildRecapFidelityGateFromReviews({ panels, analyses: [item], ledger: ledger([ambiguous]) });
	assert.deepEqual(result.report.visualOnlyPanelIds, ['p1_0']);
	assert.deepEqual(result.report.storyEngineEligiblePanelIds, []);
	assert.equal(canForwardToStoryEngine(result.report), true);
});
