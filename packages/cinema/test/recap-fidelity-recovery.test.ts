import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
	applyRecapRecoveryToReview,
	RecapFidelityRecoveryStore,
	runRecapFidelityRecovery,
	type RecapFidelityIssue,
	type RecapFidelityPanelReport,
} from '../src/index.js';

function issue(code: RecapFidelityIssue['code']): RecapFidelityIssue {
	return {
		code,
		severity: 'major',
		detail: `fixture ${code}`,
		evidence: [{ source: 'human_review', detail: 'fixture evidence', ref: 'fixture' }],
		blocksNarrativeFact: true,
	};
}

function panel(id: string, code: RecapFidelityIssue['code'], context: Record<string, unknown> = {}, status: 'needs_review' | 'verified' = 'needs_review') {
	const gateReport: RecapFidelityPanelReport = {
		panelId: id,
		status,
		eligibility: status === 'verified' ? 'narrative_eligible' : 'blocked',
		issues: status === 'verified' ? [] : [issue(code)],
		checks: {
			structural: { status: 'pass', evidence: [] },
			integrity: { status: 'pass', evidence: [] },
			visual: { status: status === 'verified' ? 'pass' : 'unverified', evidence: [] },
			textual: { status: status === 'verified' ? 'pass' : 'unverified', evidence: [] },
			continuity: { status: status === 'verified' ? 'pass' : 'unverified', evidence: [] },
			evidence: { status: status === 'verified' ? 'pass' : 'unverified', evidence: [] },
		},
	};
	return {
		panelId: id,
		sha256: `sha-${id}`,
		pageNumber: 1,
		panelIndex: 0,
		gateReport,
		context,
	};
}

function makeStore(): { directory: string; store: RecapFidelityRecoveryStore } {
	const directory = mkdtempSync(join(tmpdir(), 'aethera-recovery-'));
	return { directory, store: new RecapFidelityRecoveryStore({ directory }) };
}

describe('Phase 4B.8 — selective fidelity auto-recovery', () => {
	it('classifies a visual fragment deterministically without turning it into a fact', async () => {
		const { directory, store } = makeStore();
		try {
			const result = await runRecapFidelityRecovery({
				panels: [panel('p1_3', 'UNKNOWN_PANEL', { fragment: { kind: 'sfx_fragment', pageContext: 'black glyph and partial bubble on original page', preserveInSequence: true } })],
				store,
			});
			assert.equal(result.status, 'completed');
			assert.equal(result.records[0]?.status, 'resolved');
			assert.equal(result.records[0]?.factsAllowed, false);
			assert.equal(result.records[0]?.corrections[0]?.after, 'sfx_fragment');
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});

	it('separates SFX from dialogue using visual evidence, not language heuristics', async () => {
		const { directory, store } = makeStore();
		try {
			const result = await runRecapFidelityRecovery({
				panels: [panel('p10_2', 'SFX_AS_DIALOGUE', { sfx: { text: 'KEUACK-KKK!!!', region: 'top', bubblePresent: false, stylizedTypography: true, overlayPosition: true, readingAsSpeech: false } })],
				store,
			});
			assert.equal(result.records[0]?.status, 'resolved');
			assert.equal((result.records[0]?.corrections[0]?.after as { kind?: string } | undefined)?.kind, 'sfx');
			assert.equal(result.usage.modelCalls, 0);
			assert.equal(result.usage.ocrCalls, 0);
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});

	it('distinguishes intentional repetition from a proven duplicate', async () => {
		const { directory, store } = makeStore();
		try {
			const intentional = await runRecapFidelityRecovery({
				panels: [panel('p19_1', 'DUPLICATE_CONTENT', { duplicate: { otherPanelId: 'p19_4', otherSha256: 'other', exactShaMatch: false, perceptualSimilarity: 0.9854, boundingBoxOverlap: 0, samePage: true, coordinatesDistinct: true, readingOrderDistance: 3 } })],
				store,
			});
			assert.equal(intentional.records[0]?.status, 'resolved');
			assert.equal((intentional.records[0]?.corrections[0]?.after as { decision?: string } | undefined)?.decision, 'preserve_both');

			const proven = await runRecapFidelityRecovery({
				panels: [panel('p20_1', 'DUPLICATE_CONTENT', { duplicate: { otherPanelId: 'p20_1-copy', otherSha256: 'sha-p20_1', exactShaMatch: true, perceptualSimilarity: 1, boundingBoxOverlap: 1, samePage: true, coordinatesDistinct: false, readingOrderDistance: 0 } })],
				store: new RecapFidelityRecoveryStore({ directory: mkdtempSync(join(tmpdir(), 'aethera-recovery-duplicate-')) }),
			});
			assert.equal(proven.records[0]?.status, 'needs_review');
			assert.equal(proven.records[0]?.corrections.length, 0);
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});

	it('accepts a localized OCR correction only when the adapter validates it', async () => {
		const { directory, store } = makeStore();
		let calls = 0;
		try {
			const result = await runRecapFidelityRecovery({
				panels: [panel('p6_3', 'OCR_INCOMPLETE', { cropPath: 'fixture-p6_3.png', ocr: { currentText: 'REUR...!', visualCandidateText: 'KEUK...?' } })],
				store,
				ocrAdapter: {
					name: 'fixture-local-ocr',
					async recognize() { calls++; return { text: 'KEUK...?', confidence: 0.96, language: 'eng', region: 'top', inputTokens: null, outputTokens: null, validatedAgainstImage: true, evidence: 'Mock local OCR agrees with the isolated speech-bubble crop.' }; },
				},
			});
			assert.equal(calls, 1);
			assert.equal(result.records[0]?.status, 'resolved');
			assert.equal(result.records[0]?.corrections[0]?.accepted, true);
			assert.equal(result.records[0]?.corrections[0]?.before, 'REUR...!');
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});

	it('preserves a candidate when OCR is unavailable and does not invent a replacement', async () => {
		const { directory, store } = makeStore();
		try {
			const result = await runRecapFidelityRecovery({
				panels: [panel('p6_3', 'OCR_INCOMPLETE', { cropPath: 'fixture-p6_3.png', ocr: { currentText: 'REUR...!', visualCandidateText: 'KEUK...?', visualCandidateEvidence: 'Independent crop inspection only.' } })],
				store,
			});
			assert.equal(result.records[0]?.status, 'needs_review');
			assert.equal(result.records[0]?.factsAllowed, false);
			assert.equal(result.records[0]?.corrections.length, 0);
			assert.match(result.records[0]?.evidence[0]?.detail ?? '', /KEUK/);
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});

	it('offers bounded local-visual and contextual adapter stages after deterministic evidence is unavailable', async () => {
		const { directory, store } = makeStore();
		try {
			const result = await runRecapFidelityRecovery({
				panels: [panel('ambiguous-1', 'UNKNOWN_PANEL', { cropPath: 'fixture-ambiguous.png', previousPanelId: 'prev', nextPanelId: 'next' })],
				store,
				localVisualAdapter: {
					name: 'fixture-local-visual',
					async analyze() {
						return {
							correction: { kind: 'classification', field: 'narrativeRole', before: 'unknown', after: 'transition', accepted: true, factsAllowed: true, evidence: [{ source: 'image', detail: 'fixture visual evidence', ref: 'ambiguous-1' }] },
							confidence: 0.9,
							validatedAgainstImage: true,
							inputTokens: 12,
							outputTokens: 8,
							evidence: 'Fixture local visual adapter evidence.',
						};
					},
				},
			});
			assert.equal(result.records[0]?.strategy, 'local_visual');
			assert.equal(result.records[0]?.status, 'resolved');
			assert.equal(result.usage.modelCalls, 1);
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});

	it('uses persistent cache and ledger without re-running a recovery', async () => {
		const { directory, store } = makeStore();
		let calls = 0;
		try {
			const ocrAdapter = { name: 'unused', async recognize() { calls++; throw new Error('must not run'); } };
			const input = {
				panels: [panel('p10_2', 'SFX_AS_DIALOGUE', { sfx: { text: 'KEUACK-KKK!!!', bubblePresent: false, stylizedTypography: true, overlayPosition: true, readingAsSpeech: false } })],
				store,
				ocrAdapter,
			};
			await runRecapFidelityRecovery(input);
			const second = await runRecapFidelityRecovery({ ...input, store: new RecapFidelityRecoveryStore({ directory }) });
			assert.equal(calls, 0);
			assert.equal(second.usage.cacheHits, 1);
			assert.equal(second.usage.modelCalls, 0);
			assert.equal(second.usage.ocrCalls, 0);
			assert.equal(second.usage.inputTokens, 0);
			assert.equal(second.usage.outputTokens, 0);
			assert.ok(readdirSync(directory).some((name) => name.endsWith('.before.json')));
			assert.ok(readdirSync(directory).some((name) => name.endsWith('.after.json')));
			assert.ok(readFileSync(join(directory, 'recovery-ledger.jsonl'), 'utf8').trim().split(/\r?\n/).length >= 2);
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});

	it('preserves verified panels and pauses before exceeding the panel budget', async () => {
		const { directory, store } = makeStore();
		try {
			const result = await runRecapFidelityRecovery({
				panels: [panel('verified-1', 'UNKNOWN_PANEL', {}, 'verified'), panel('pending-1', 'UNKNOWN_PANEL', {})],
				store,
				budget: { maxPanels: 0 },
			});
			assert.equal(result.status, 'paused_budget');
			assert.deepEqual(result.preservedVerifiedPanelIds, ['verified-1']);
			assert.equal(result.records.length, 0);
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});

	it('honors cancellation without retrying or falling back', async () => {
		const { directory, store } = makeStore();
		try {
			const controller = new AbortController();
			controller.abort();
			const result = await runRecapFidelityRecovery({ panels: [panel('p1_3', 'UNKNOWN_PANEL', { fragment: { kind: 'sfx_fragment', pageContext: 'fixture', preserveInSequence: true } })], store, signal: controller.signal });
			assert.equal(result.status, 'cancelled');
			assert.equal(result.records.length, 0);
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});

	it('pauses before a new recovery when the measured VRAM exceeds the operational limit', async () => {
		const { directory, store } = makeStore();
		try {
			const result = await runRecapFidelityRecovery({
				panels: [panel('p10_2', 'SFX_AS_DIALOGUE', { sfx: { text: 'KEUACK-KKK!!!', bubblePresent: false, stylizedTypography: true, overlayPosition: true, readingAsSpeech: false } })],
				store,
				getVramMiB: () => 6501,
			});
			assert.equal(result.status, 'paused_budget');
			assert.equal(result.usage.stopReason, 'vramLimit');
			assert.equal(result.usage.peakVramMiB, 6501);
			assert.equal(result.records.length, 0);
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});

	it('keeps unknown OCR token counts null instead of treating them as zero', async () => {
		const { directory, store } = makeStore();
		try {
			const result = await runRecapFidelityRecovery({
				panels: [panel('p6_3', 'OCR_INCOMPLETE', { cropPath: 'fixture-p6_3.png', ocr: { currentText: 'REUR...!', visualCandidateText: 'KEUK...?' } })],
				store,
				ocrAdapter: {
					name: 'fixture-local-ocr',
					async recognize() { return { text: 'KEUK...?', confidence: 0.96, language: 'eng', region: 'top', inputTokens: null, outputTokens: null, validatedAgainstImage: true, evidence: 'Fixture evidence.' }; },
				},
			});
			assert.equal(result.records[0]?.inputTokens, null);
			assert.equal(result.records[0]?.outputTokens, null);
			assert.equal(result.usage.inputTokens, null);
			assert.equal(result.usage.outputTokens, null);
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});

	it('revalidates recovered evidence through the same gate boundary', async () => {
		const { directory, store } = makeStore();
		try {
			const result = await runRecapFidelityRecovery({
				panels: [panel('p10_2', 'SFX_AS_DIALOGUE', { sfx: { text: 'KEUACK-KKK!!!', bubblePresent: false, stylizedTypography: true, overlayPosition: true, readingAsSpeech: false } })],
				store,
			});
			const baseReview = { status: 'needs_review' as const, evidence: [], issues: [issue('SFX_AS_DIALOGUE')] };
			const recovered = applyRecapRecoveryToReview(baseReview, result.records[0]!);
			assert.equal(recovered.status, 'verified');
			assert.deepEqual(recovered.issues, []);
		} finally { rmSync(directory, { recursive: true, force: true }); }
	});
});
