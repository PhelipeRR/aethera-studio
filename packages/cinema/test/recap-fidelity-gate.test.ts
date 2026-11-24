import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	canForwardToStoryEngine,
	getStoryEngineEligiblePanelIds,
	runStoryEngine,
	runRecapFidelityGate,
	type RecapFidelityIssue,
	type RecapFidelityPanelInput,
} from '../src/index.js';

function makeIssue(code: RecapFidelityIssue['code'], severity: RecapFidelityIssue['severity'] = 'major'): RecapFidelityIssue {
	return {
		code,
		severity,
		detail: `fixture: ${code}`,
		evidence: [{ source: 'human_review', detail: 'fixture evidence', ref: 'fixture-image' }],
		blocksNarrativeFact: severity === 'major' || severity === 'critical',
	};
}

function makePanel(id: string, pageNumber: number, panelIndex: number, overrides: Partial<RecapFidelityPanelInput> = {}): RecapFidelityPanelInput {
	return {
		panelId: id,
		sha256: `sha-${id}`,
		pageNumber,
		panelIndex,
		readingOrder: 'vertical',
		checkpoint: {
			panel: { panelId: id, sha256: `sha-${id}`, pageNumber, panelIndex, readingOrder: 'vertical' },
			analysis: { nature: 'portrait', confidence: 0.98, description: 'observed fixture' },
			validation: { schema: 'pass' },
		},
		...overrides,
	};
}

function reviewed(panel: RecapFidelityPanelInput, status: 'verified' | 'needs_review' | 'rejected' = 'verified', issues: RecapFidelityIssue[] = []): RecapFidelityPanelInput {
	return {
		...panel,
		humanReview: {
			status,
			evidence: [{ source: 'image', detail: 'Inspeção visual independente do crop fixture.', ref: panel.panelId }],
			issues,
		},
	};
}

describe('Phase 4B.7 — independent Recap narrative fidelity gate', () => {
	it('does not promote valid schema or high confidence to verified without independent evidence', () => {
		const report = runRecapFidelityGate({ panels: [makePanel('p0_0', 0, 0)] });

		assert.equal(report.status, 'needs_review');
		assert.equal(report.panels[0]?.status, 'unverified');
		assert.equal(report.panels[0]?.checks.evidence.status, 'unverified');
		assert.equal(canForwardToStoryEngine(report), false);
	});

	it('allows a dialogue-free panel only after an explicit visual review', () => {
		const report = runRecapFidelityGate({
			panels: [reviewed(makePanel('p0_0', 0, 0))],
			expectedPanelIds: ['p0_0'],
		});

		assert.equal(report.status, 'verified');
		assert.equal(report.panels[0]?.checks.visual.status, 'pass');
		assert.deepEqual(getStoryEngineEligiblePanelIds(report), ['p0_0']);
	});

	it('keeps an unknown transition panel in order and sends it to review', () => {
		const p1 = makePanel('p1_3', 1, 3, {
			checkpoint: {
				panel: { panelId: 'p1_3', sha256: 'sha-p1_3', pageNumber: 1, panelIndex: 3, readingOrder: 'vertical' },
				analysis: { nature: 'unknown', confidence: 0, description: 'glyph fragment' },
				validation: { schema: 'pass' },
			},
		});
		const report = runRecapFidelityGate({ panels: [reviewed(makePanel('p1_0', 1, 0)), reviewed(p1, 'needs_review', [makeIssue('UNKNOWN_PANEL')])] });

		assert.equal(report.status, 'needs_review');
		assert.equal(report.panels[1]?.status, 'needs_review');
		assert.ok(report.humanReviewQueue.includes('p1_3'));
		assert.deepEqual(report.storyEngineEligiblePanelIds, ['p1_0']);
	});

	it('keeps a reviewed visual-only fragment in sequence without making it a narrative fact', () => {
		const panel = makePanel('p1_3', 1, 3, {
			checkpoint: {
				panel: { panelId: 'p1_3', sha256: 'sha-p1_3', pageNumber: 1, panelIndex: 3, readingOrder: 'vertical' },
				analysis: { nature: 'unknown', confidence: 0, description: 'fragment' },
				validation: { schema: 'pass' },
			},
			humanReview: {
				status: 'needs_review',
				eligibility: 'visual_only',
				evidence: [{ source: 'image', detail: 'Fragmento visual sem unidade narrativa independente.', ref: 'p1_3' }],
				issues: [makeIssue('UNKNOWN_PANEL')],
			},
		});
		const report = runRecapFidelityGate({ panels: [reviewed(makePanel('p1_2', 1, 2)), panel] });
		assert.equal(report.panels[1]?.status, 'needs_review');
		assert.equal(report.panels[1]?.eligibility, 'visual_only');
		assert.deepEqual(report.visualOnlyPanelIds, ['p1_3']);
		assert.deepEqual(report.blockedPanelIds, []);
		assert.equal(canForwardToStoryEngine(report), true);
		assert.deepEqual(getStoryEngineEligiblePanelIds(report), ['p1_2']);
	});

	it('does not let a visual-only hint bypass a narrative hallucination', () => {
		const panel = reviewed(makePanel('p2_1', 2, 1), 'needs_review', [makeIssue('DIALOGUE_HALLUCINATION', 'critical')]);
		panel.humanReview!.eligibility = 'visual_only';
		const report = runRecapFidelityGate({ panels: [panel] });
		assert.equal(report.panels[0]?.eligibility, 'blocked');
		assert.equal(canForwardToStoryEngine(report), false);
	});

	it('blocks explicit hallucinated dialogue even when the schema is valid', () => {
		const report = runRecapFidelityGate({
			panels: [reviewed(makePanel('p2_0', 2, 0), 'rejected', [makeIssue('DIALOGUE_HALLUCINATION', 'critical')])],
		});

		assert.equal(report.status, 'rejected');
		assert.equal(report.panels[0]?.status, 'rejected');
		assert.equal(canForwardToStoryEngine(report), false);
	});

	it('preserves uncertain OCR as reviewable evidence instead of replacing it', () => {
		const report = runRecapFidelityGate({
			panels: [reviewed(makePanel('p6_3', 6, 3), 'needs_review', [makeIssue('OCR_INCOMPLETE')])],
		});

		assert.equal(report.panels[0]?.status, 'needs_review');
		assert.equal(report.metrics.issueCounts.OCR_INCOMPLETE, 1);
	});

	it('flags SFX classified as dialogue and keeps the image in the sequence', () => {
		const report = runRecapFidelityGate({
			panels: [reviewed(makePanel('p10_2', 10, 2), 'needs_review', [makeIssue('SFX_AS_DIALOGUE')])],
		});

		assert.equal(report.panels[0]?.status, 'needs_review');
		assert.deepEqual(report.humanReviewQueue, ['p10_2']);
	});

	it('detects a reading-order error before Story Engine', () => {
		const report = runRecapFidelityGate({
			panels: [reviewed(makePanel('p2_0', 2, 0)), reviewed(makePanel('p1_0', 1, 0))],
			expectedPanelIds: ['p1_0', 'p2_0'],
		});

		assert.equal(report.status, 'rejected');
		assert.ok((report.metrics.issueCounts.READING_ORDER_ERROR ?? 0) > 0);
	});

	it('does not mutate or invalidate an existing checkpoint while auditing it', () => {
		const panel = makePanel('p0_0', 0, 0);
		const before = JSON.stringify(panel.checkpoint);
		runRecapFidelityGate({ panels: [reviewed(panel)] });

		assert.equal(JSON.stringify(panel.checkpoint), before);
	});

	it('blocks narrative forwarding after analysis when the gate is enforced', async () => {
		const report = runRecapFidelityGate({ panels: [makePanel('p0_0', 0, 0)] });

		await assert.rejects(
			() => runStoryEngine({
				chapterId: 'fixture',
				panels: [],
				outputDir: process.cwd(),
				strictFidelity: true,
				panelFidelityGate: { report, enforce: true },
			}),
			/fidelity gate status=/,
		);
	});

	it('does not treat model confidence as strict-fidelity evidence', async () => {
		await assert.rejects(
			() => runStoryEngine({
				chapterId: 'fixture-strict',
				panels: [],
				outputDir: process.cwd(),
				strictFidelity: true,
			}),
			/no evidence-backed RecapFidelityGateReport was supplied/,
		);
	});
});
