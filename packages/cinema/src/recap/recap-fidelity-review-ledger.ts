import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import {
	RECAP_FIDELITY_ISSUE_CODES,
	RECAP_FIDELITY_SEVERITY_VALUES,
	runRecapFidelityGate,
	type RecapFidelityEvidence,
	type RecapFidelityGateReport,
	type RecapFidelityPanelInput,
} from './recap-fidelity-gate.js';
import { panelAnalysisSchema, type ExtractedPanel, type PanelAnalysis } from './recap-types.js';

/**
 * Independent per-panel review evidence for the strict fidelity gate.
 *
 * A review is bound to the exact crop (SHA-256 of the image) AND to the exact
 * analysis content it judged (`analysisSha256`). If the panel is re-analysed or
 * the crop changes, the review no longer applies and the panel falls back to
 * `unverified`: a stale review can never approve new content.
 */
const evidenceSchema = z.object({
	source: z.enum(['image', 'checkpoint', 'human_review', 'structural', 'comparison']),
	detail: z.string().min(1),
	ref: z.string().optional(),
});

const issueSchema = z.object({
	code: z.enum(RECAP_FIDELITY_ISSUE_CODES),
	severity: z.enum(RECAP_FIDELITY_SEVERITY_VALUES),
	detail: z.string().min(1),
	evidence: z.array(evidenceSchema),
	blocksNarrativeFact: z.boolean(),
});

export const recapFidelityReviewRecordSchema = z.object({
	panelId: z.string().min(1),
	panelSha256: z.string().regex(/^[a-f0-9]{64}$/),
	analysisSha256: z.string().regex(/^[a-f0-9]{64}$/),
	status: z.enum(['verified', 'needs_review', 'rejected']),
	/** At least one item must come from looking at the image itself. */
	evidence: z.array(evidenceSchema).min(1).refine(
		(items) => items.some((item) => item.source === 'image' || item.source === 'human_review'),
		'A revisão precisa de evidência visual (image/human_review).',
	),
	issues: z.array(issueSchema).default([]),
	/** Explicit, evidence-backed exception: the panel keeps only visual weight and yields no narrative facts. */
	eligibility: z.literal('visual_only').optional(),
	reviewer: z.string().min(1),
	reviewedAtIso: z.string().datetime(),
	/** Where the review was produced (e.g. a historical audit report path). */
	origin: z.string().min(1),
}).superRefine((record, ctx) => {
	if (record.status === 'verified' && record.issues.length > 0) {
		ctx.addIssue({ code: 'custom', message: 'Revisão verified não pode carregar issues.' });
	}
	if (record.status !== 'verified' && record.issues.length === 0) {
		ctx.addIssue({ code: 'custom', message: 'Revisão não verificada precisa de ao menos uma issue.' });
	}
});
export type RecapFidelityReviewRecord = z.infer<typeof recapFidelityReviewRecordSchema>;

export const recapFidelityReviewLedgerSchema = z.object({
	schemaVersion: z.literal(1),
	chapterId: z.string().min(1),
	reviews: z.array(recapFidelityReviewRecordSchema),
});
export type RecapFidelityReviewLedger = z.infer<typeof recapFidelityReviewLedgerSchema>;

type ParsedEvidence = z.infer<typeof evidenceSchema>;
function toEvidence(items: readonly ParsedEvidence[]): RecapFidelityEvidence[] {
	return items.map((item) => (item.ref ? { source: item.source, detail: item.detail, ref: item.ref } : { source: item.source, detail: item.detail }));
}

/** Fingerprint of the narrative-relevant analysis fields a reviewer judges. */
export function recapAnalysisFingerprint(analysis: PanelAnalysis): string {
	const canonical = {
		panelId: analysis.panelId,
		visualDescription: analysis.visualDescription ?? null,
		characters: [...analysis.characters],
		dialogues: analysis.dialogues.map((entry) => ({
			text: entry.text,
			kind: entry.kind ?? null,
			contentKind: (entry as { contentKind?: string }).contentKind ?? null,
			speaker: entry.speaker ?? null,
		})),
		actions: analysis.actions.map((action) => ({ type: action.type, description: action.description })),
	};
	return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

export function loadRecapFidelityReviewLedger(path: string): RecapFidelityReviewLedger | null {
	if (!existsSync(path)) return null;
	return recapFidelityReviewLedgerSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

export interface RecapFidelityReviewGateResult {
	report: RecapFidelityGateReport;
	/** Panels whose review exists but no longer matches the crop or the analysis. */
	staleReviewPanelIds: string[];
	/** Panels with an analysis but no review at all. */
	unreviewedPanelIds: string[];
	/** Panels without a persisted analysis. */
	missingAnalysisPanelIds: string[];
}

/**
 * Builds the evidence-backed RecapFidelityGateReport for the productive path.
 * Never calls a model; it only joins persisted analyses with independent reviews.
 */
export function buildRecapFidelityGateFromReviews(input: {
	panels: readonly ExtractedPanel[];
	analyses: readonly PanelAnalysis[];
	ledger: RecapFidelityReviewLedger | null;
}): RecapFidelityReviewGateResult {
	const analysisById = new Map(input.analyses.map((analysis) => [analysis.panelId, analysis]));
	const reviewById = new Map<string, RecapFidelityReviewRecord>();
	for (const review of input.ledger?.reviews ?? []) {
		if (reviewById.has(review.panelId)) throw new Error(`RECAP_FIDELITY_REVIEW_DUPLICATE: ${review.panelId}`);
		reviewById.set(review.panelId, review);
	}
	const staleReviewPanelIds: string[] = [];
	const unreviewedPanelIds: string[] = [];
	const missingAnalysisPanelIds: string[] = [];

	const inputs: RecapFidelityPanelInput[] = input.panels.map((panel) => {
		const analysis = analysisById.get(panel.panelId);
		if (!analysis) missingAnalysisPanelIds.push(panel.panelId);
		const schemaOk = analysis ? panelAnalysisSchema.safeParse(analysis).success : false;
		const review = reviewById.get(panel.panelId);
		let humanReview: RecapFidelityPanelInput['humanReview'];
		if (review && analysis) {
			const matches = review.panelSha256 === panel.imageHash && review.analysisSha256 === recapAnalysisFingerprint(analysis);
			if (matches) {
				humanReview = { status: review.status, evidence: toEvidence(review.evidence), issues: review.issues.map((item) => ({ ...item, evidence: toEvidence(item.evidence) })), ...(review.eligibility ? { eligibility: review.eligibility } : {}) };
			} else {
				staleReviewPanelIds.push(panel.panelId);
			}
		} else if (analysis) {
			unreviewedPanelIds.push(panel.panelId);
		}
		return {
			panelId: panel.panelId,
			sha256: panel.imageHash,
			pageNumber: panel.metadata.pageNumber,
			panelIndex: panel.metadata.panelIndex,
			readingOrder: panel.metadata.readingOrder,
			imagePath: panel.croppedImagePath ?? null,
			checkpoint: {
				panel: {
					panelId: panel.panelId,
					sha256: panel.imageHash,
					pageNumber: panel.metadata.pageNumber,
					panelIndex: panel.metadata.panelIndex,
					readingOrder: panel.metadata.readingOrder,
				},
				...(analysis ? {
					analysis: {
						description: analysis.visualDescription ?? null,
						confidence: analysis.analysisConfidence,
						frames: [{
							observed: analysis.visualDescription ?? null,
							visibleText: analysis.dialogues.map((entry) => ({ text: entry.text })),
						}],
					},
				} : {}),
				validation: { schema: schemaOk ? 'pass' : 'fail' },
			},
			...(humanReview ? { humanReview } : {}),
		};
	});

	const report = runRecapFidelityGate({ panels: inputs, expectedPanelIds: input.panels.map((panel) => panel.panelId) });
	return { report, staleReviewPanelIds, unreviewedPanelIds, missingAnalysisPanelIds };
}
