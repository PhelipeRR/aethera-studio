/**
 * Independent narrative-fidelity gate for Recap panel evidence.
 *
 * This gate is deliberately conservative: a valid schema, a high model
 * confidence, or a successful checkpoint never proves visual fidelity. A
 * panel is only eligible for Story Engine facts after an explicit review has
 * supplied evidence and every required check passes.
 */

export const RECAP_FIDELITY_STATUS_VALUES = [
	'verified',
	'needs_review',
	'rejected',
	'unverified',
] as const;
export type RecapFidelityStatus = (typeof RECAP_FIDELITY_STATUS_VALUES)[number];

/** Whether a panel may provide narrative facts, remain visual-only, or be blocked. */
export const RECAP_FIDELITY_ELIGIBILITY_VALUES = [
	'narrative_eligible',
	'visual_only',
	'blocked',
] as const;
export type RecapFidelityEligibility = (typeof RECAP_FIDELITY_ELIGIBILITY_VALUES)[number];

export const RECAP_FIDELITY_CHECK_STATUS_VALUES = ['pass', 'fail', 'unverified'] as const;
export type RecapFidelityCheckStatus = (typeof RECAP_FIDELITY_CHECK_STATUS_VALUES)[number];

export const RECAP_FIDELITY_SEVERITY_VALUES = ['info', 'minor', 'major', 'critical'] as const;
export type RecapFidelitySeverity = (typeof RECAP_FIDELITY_SEVERITY_VALUES)[number];

export const RECAP_FIDELITY_ISSUE_CODES = [
	'CHARACTER_HALLUCINATION',
	'CHARACTER_IDENTITY_UNCERTAIN',
	'ACTION_MISMATCH',
	'OBJECT_MISMATCH',
	'DIALOGUE_OMISSION',
	'DIALOGUE_HALLUCINATION',
	'SFX_AS_DIALOGUE',
	'OCR_INCOMPLETE',
	'READING_ORDER_ERROR',
	'DUPLICATE_CONTENT',
	'INSUFFICIENT_EVIDENCE',
	'UNKNOWN_PANEL',
] as const;
export type RecapFidelityIssueCode = (typeof RECAP_FIDELITY_ISSUE_CODES)[number];

export interface RecapFidelityEvidence {
	source: 'image' | 'checkpoint' | 'human_review' | 'structural' | 'comparison';
	detail: string;
	ref?: string;
}

export interface RecapFidelityIssue {
	code: RecapFidelityIssueCode;
	severity: RecapFidelitySeverity;
	detail: string;
	evidence: RecapFidelityEvidence[];
	blocksNarrativeFact: boolean;
}

export interface RecapFidelityCheck {
	status: RecapFidelityCheckStatus;
	evidence: RecapFidelityEvidence[];
}

export interface RecapFidelityCheckpointAnalysis {
	nature?: string | null;
	confidence?: number | null;
	description?: string | null;
	frames?: Array<{
		observed?: string | null;
		visibleText?: Array<{ text?: string | null; region?: string | null }>;
	}>;
	limitations?: string[];
}

export interface RecapFidelityCheckpoint {
	panel?: {
		panelId?: string;
		sha256?: string;
		pageNumber?: number;
		panelIndex?: number;
		readingOrder?: string;
	};
	analysis?: RecapFidelityCheckpointAnalysis;
	validation?: { schema?: string | null };
}

export interface RecapFidelityHumanReview {
	status: RecapFidelityStatus;
	evidence: RecapFidelityEvidence[];
	issues?: RecapFidelityIssue[];
	/** Explicit recovery evidence may preserve a non-narrative fragment without making facts. */
	eligibility?: RecapFidelityEligibility;
}

export interface RecapFidelityPanelInput {
	panelId: string;
	sha256?: string | null;
	pageNumber?: number | null;
	panelIndex?: number | null;
	readingOrder?: string | null;
	imagePath?: string | null;
	checkpoint: RecapFidelityCheckpoint;
	humanReview?: RecapFidelityHumanReview;
}

export interface RecapFidelityPanelReport {
	panelId: string;
	status: RecapFidelityStatus;
	eligibility?: RecapFidelityEligibility;
	issues: RecapFidelityIssue[];
	checks: {
		structural: RecapFidelityCheck;
		integrity: RecapFidelityCheck;
		visual: RecapFidelityCheck;
		textual: RecapFidelityCheck;
		continuity: RecapFidelityCheck;
		evidence: RecapFidelityCheck;
	};
}

export interface RecapFidelityGateInput {
	panels: readonly RecapFidelityPanelInput[];
	expectedPanelIds?: readonly string[];
	checkedAtIso?: string;
}

export interface RecapFidelityGateMetrics {
	panelCount: number;
	verifiedPanels: number;
	needsReviewPanels: number;
	rejectedPanels: number;
	unverifiedPanels: number;
	majorOrCriticalIssues: number;
	minorIssues: number;
	narrativeEligiblePanels: number;
	visualOnlyPanels: number;
	blockedPanels: number;
	issueCounts: Partial<Record<RecapFidelityIssueCode, number>>;
	checksAudited: number;
	checksWithEvidence: number;
}

export interface RecapFidelityGateReport {
	gate: 'recap_narrative_fidelity';
	status: RecapFidelityStatus;
	checkedAtIso: string;
	panels: RecapFidelityPanelReport[];
	chapterIssues: RecapFidelityIssue[];
	metrics: RecapFidelityGateMetrics;
	storyEngineEligiblePanelIds: string[];
	visualOnlyPanelIds: string[];
	blockedPanelIds: string[];
	humanReviewQueue: string[];
}

const BLOCKING_SEVERITIES = new Set<RecapFidelitySeverity>(['major', 'critical']);

function evidence(source: RecapFidelityEvidence['source'], detail: string, ref?: string): RecapFidelityEvidence {
	return ref ? { source, detail, ref } : { source, detail };
}

function issue(
	code: RecapFidelityIssueCode,
	severity: RecapFidelitySeverity,
	detail: string,
	evidenceItems: RecapFidelityEvidence[],
): RecapFidelityIssue {
	return {
		code,
		severity,
		detail,
		evidence: evidenceItems,
		blocksNarrativeFact: BLOCKING_SEVERITIES.has(severity),
	};
}

function check(status: RecapFidelityCheckStatus, items: RecapFidelityEvidence[] = []): RecapFidelityCheck {
	return { status, evidence: items };
}

function maxStatus(
	issues: readonly RecapFidelityIssue[],
	humanStatus: RecapFidelityStatus | undefined,
): RecapFidelityStatus {
	if (humanStatus === 'rejected') return 'rejected';
	if (issues.some((item) => item.severity === 'critical')) return 'rejected';
	// Major issues block facts from Story Engine but remain reviewable panels
	// (e.g. a transition/glyph panel or a possible repeated visual). Only a
	// critical issue or an explicit rejection discards the panel's claims.
	if (issues.some((item) => item.severity === 'major')) return 'needs_review';
	if (humanStatus === 'needs_review') return 'needs_review';
	if (humanStatus === 'unverified' || !humanStatus) return 'unverified';
	if (issues.some((item) => item.severity === 'minor')) return 'needs_review';
	return 'verified';
}

const VISUAL_ONLY_SAFE_ISSUES = new Set<RecapFidelityIssueCode>(['UNKNOWN_PANEL', 'INSUFFICIENT_EVIDENCE']);

function panelEligibility(status: RecapFidelityStatus, issues: readonly RecapFidelityIssue[], humanReview?: RecapFidelityHumanReview): RecapFidelityEligibility {
	const hint = humanReview?.eligibility;
	const hasUnsafeNarrativeIssue = issues.some((item) => item.blocksNarrativeFact && !VISUAL_ONLY_SAFE_ISSUES.has(item.code));
	if (hint === 'visual_only' && !hasUnsafeNarrativeIssue) return 'visual_only';
	if (status === 'verified' && !hasUnsafeNarrativeIssue) return 'narrative_eligible';
	return 'blocked';
}

/** Backwards-compatible interpretation for reports written before eligibility was persisted. */
function effectivePanelEligibility(panel: Pick<RecapFidelityPanelReport, 'status' | 'issues' | 'eligibility'>): RecapFidelityEligibility {
	if (panel.eligibility) return panel.eligibility;
	const hasUnsafeNarrativeIssue = panel.issues.some((item) => item.blocksNarrativeFact && !VISUAL_ONLY_SAFE_ISSUES.has(item.code));
	if (panel.status === 'verified' && !hasUnsafeNarrativeIssue) return 'narrative_eligible';
	if (!hasUnsafeNarrativeIssue && panel.issues.some((item) => item.code === 'UNKNOWN_PANEL')) return 'visual_only';
	return 'blocked';
}

function hasFinite(value: number | null | undefined): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function validatePanel(
	input: RecapFidelityPanelInput,
	index: number,
	allPanels: readonly RecapFidelityPanelInput[],
	expectedPanelIds?: readonly string[],
): RecapFidelityPanelReport {
	const issues: RecapFidelityIssue[] = [...(input.humanReview?.issues ?? [])];
	const structuralEvidence: RecapFidelityEvidence[] = [];
	const integrityEvidence: RecapFidelityEvidence[] = [];

	const panel = input.checkpoint.panel;
	const hasCoordinates = hasFinite(input.pageNumber) && hasFinite(input.panelIndex);
	if (!input.panelId || !hasCoordinates || !input.readingOrder) {
		issues.push(issue(
			'INSUFFICIENT_EVIDENCE',
			'critical',
			'Identidade, posição ou ordem de leitura do painel não está completa.',
			[evidence('structural', 'panelId, pageNumber, panelIndex e readingOrder são obrigatórios')],
		));
	} else {
		structuralEvidence.push(evidence('structural', 'Identidade e posição original presentes.', input.panelId));
	}

	if (panel?.panelId && panel.panelId !== input.panelId) {
		issues.push(issue(
			'INSUFFICIENT_EVIDENCE',
			'critical',
			'O checkpoint referencia outro painel.',
			[evidence('checkpoint', `${panel.panelId} != ${input.panelId}`, input.panelId)],
		));
	} else if (panel?.panelId) {
		integrityEvidence.push(evidence('checkpoint', 'panelId do checkpoint corresponde ao manifesto.', input.panelId));
	}

	if (input.sha256 && panel?.sha256 && input.sha256 !== panel.sha256) {
		issues.push(issue(
			'INSUFFICIENT_EVIDENCE',
			'critical',
			'SHA-256 do painel não corresponde ao checkpoint.',
			[evidence('comparison', `${input.sha256} != ${panel.sha256}`, input.panelId)],
		));
	} else if (input.sha256 && panel?.sha256) {
		integrityEvidence.push(evidence('comparison', 'SHA-256 do manifesto corresponde ao checkpoint.', input.panelId));
	}

	if (input.checkpoint.validation?.schema !== 'pass') {
		issues.push(issue(
			'INSUFFICIENT_EVIDENCE',
			'critical',
			'Checkpoint não possui validação estrutural aprovada.',
			[evidence('checkpoint', 'validation.schema não é pass', input.panelId)],
		));
	} else {
		structuralEvidence.push(evidence('checkpoint', 'Schema do checkpoint aprovado; isso não prova fidelidade visual.', input.panelId));
	}

	if (expectedPanelIds && expectedPanelIds[index] !== input.panelId) {
		issues.push(issue(
			'READING_ORDER_ERROR',
			'critical',
			'O painel não ocupa a posição esperada no manifesto.',
			[evidence('comparison', `esperado ${expectedPanelIds[index] ?? 'ausente'}, recebido ${input.panelId}`, input.panelId)],
		));
	}

	if (index > 0) {
		const previous = allPanels[index - 1];
		if (
			previous &&
			hasFinite(previous.pageNumber) &&
			hasFinite(previous.panelIndex) &&
			hasFinite(input.pageNumber) &&
			hasFinite(input.panelIndex) &&
			(input.pageNumber < previous.pageNumber ||
				(input.pageNumber === previous.pageNumber && input.panelIndex < previous.panelIndex))
		) {
			issues.push(issue(
				'READING_ORDER_ERROR',
				'critical',
				'A posição do painel retrocede em relação à ordem de leitura anterior.',
				[evidence('comparison', `${previous.panelId} precede ${input.panelId}`, input.panelId)],
			));
		}
	}

	const duplicateIds = allPanels.filter((panelItem, itemIndex) => itemIndex !== index && panelItem.panelId === input.panelId);
	if (duplicateIds.length > 0) {
		issues.push(issue(
			'DUPLICATE_CONTENT',
			'critical',
			'O mesmo panelId aparece mais de uma vez na sequência.',
			[evidence('comparison', `duplicado com ${duplicateIds.map((item) => item.panelId).join(', ')}`, input.panelId)],
		));
	}

	const duplicateHashes = input.sha256
		? allPanels.filter((panelItem, itemIndex) => itemIndex !== index && panelItem.sha256 === input.sha256)
		: [];
	if (duplicateHashes.length > 0) {
		issues.push(issue(
			'DUPLICATE_CONTENT',
			'major',
			'O mesmo hash de imagem aparece em painéis distintos; a sequência deve ser revisada sem descartar nenhum painel.',
			[evidence('comparison', `mesmo SHA de ${duplicateHashes.map((item) => item.panelId).join(', ')}`, input.panelId)],
		));
	}

	const analysis = input.checkpoint.analysis;
	const isUnknown = analysis?.nature === 'unknown' || analysis?.confidence === 0;
	if (isUnknown && input.humanReview?.status !== 'verified' && !issues.some((item) => item.code === 'UNKNOWN_PANEL')) {
		issues.push(issue(
			'UNKNOWN_PANEL',
			'major',
			'O checkpoint não determinou a função narrativa do painel; o painel deve permanecer na sequência e ir para revisão.',
			[evidence('checkpoint', `nature=${analysis?.nature ?? 'null'}, confidence=${analysis?.confidence ?? 'null'}`, input.panelId)],
		));
	}

	const hasHumanEvidence = Boolean(input.humanReview?.evidence?.length);
	if (!hasHumanEvidence) {
		issues.push(issue(
			'INSUFFICIENT_EVIDENCE',
			'minor',
			'Não há evidência independente de revisão visual; schema e confiança do modelo não são suficientes.',
			[evidence('structural', 'Nenhuma revisão humana/visual independente foi anexada.', input.panelId)],
		));
	}

	const structuralFailed = issues.some((item) => item.severity === 'critical' && item.code !== 'UNKNOWN_PANEL');
	const integrityFailed = issues.some((item) => item.severity === 'critical' && ['INSUFFICIENT_EVIDENCE', 'DUPLICATE_CONTENT'].includes(item.code));
	const humanStatus = input.humanReview?.status;
	const visual = humanStatus ? (humanStatus === 'verified' ? check('pass', input.humanReview?.evidence) : check('unverified', input.humanReview?.evidence)) : check('unverified');
	const textual = humanStatus ? (humanStatus === 'verified' ? check('pass', input.humanReview?.evidence) : check('unverified', input.humanReview?.evidence)) : check('unverified');
	const continuity = humanStatus ? (humanStatus === 'verified' ? check('pass', input.humanReview?.evidence) : check('unverified', input.humanReview?.evidence)) : check('unverified');
	const panelStatus = maxStatus(issues, humanStatus);
	const eligibility = panelEligibility(panelStatus, issues, input.humanReview);

	return {
		panelId: input.panelId,
		status: panelStatus,
		eligibility,
		issues,
		checks: {
			structural: structuralFailed ? check('fail', structuralEvidence) : check('pass', structuralEvidence),
			integrity: integrityFailed ? check('fail', integrityEvidence) : check('pass', integrityEvidence),
			visual,
			textual,
			continuity,
			evidence: hasHumanEvidence ? check('pass', input.humanReview?.evidence) : check('unverified'),
		},
	};
}

/** Runs the conservative panel/chapter fidelity gate without model calls. */
export function runRecapFidelityGate(input: RecapFidelityGateInput): RecapFidelityGateReport {
	const panelReports = input.panels.map((panel, index) => validatePanel(panel, index, input.panels, input.expectedPanelIds));
	const chapterIssues: RecapFidelityIssue[] = [];

	const repeatedPanelIds = new Set(
		input.panels
			.map((panel) => panel.panelId)
			.filter((panelId, index, panelIds) => panelIds.indexOf(panelId) !== index),
	);
	if (repeatedPanelIds.size > 0) {
		chapterIssues.push(issue(
			'DUPLICATE_CONTENT',
			'critical',
			'Há panelIds repetidos no conjunto auditado.',
			[evidence('comparison', [...repeatedPanelIds].join(', '))],
		));
	}

	const storyEngineEligiblePanelIds = panelReports
		.filter((panel) => panel.eligibility === 'narrative_eligible')
		.map((panel) => panel.panelId);
	const visualOnlyPanelIds = panelReports
		.filter((panel) => panel.eligibility === 'visual_only')
		.map((panel) => panel.panelId);
	const blockedPanelIds = panelReports
		.filter((panel) => panel.eligibility === 'blocked')
		.map((panel) => panel.panelId);
	const humanReviewQueue = panelReports
		.filter((panel) => panel.status !== 'verified')
		.map((panel) => panel.panelId);

	const issueCounts: Partial<Record<RecapFidelityIssueCode, number>> = {};
	let majorOrCriticalIssues = 0;
	let minorIssues = 0;
	for (const panel of panelReports) {
		for (const panelIssue of panel.issues) {
			issueCounts[panelIssue.code] = (issueCounts[panelIssue.code] ?? 0) + 1;
			if (BLOCKING_SEVERITIES.has(panelIssue.severity)) majorOrCriticalIssues++;
			if (panelIssue.severity === 'minor') minorIssues++;
		}
	}
	for (const chapterIssue of chapterIssues) {
		issueCounts[chapterIssue.code] = (issueCounts[chapterIssue.code] ?? 0) + 1;
		if (BLOCKING_SEVERITIES.has(chapterIssue.severity)) majorOrCriticalIssues++;
		if (chapterIssue.severity === 'minor') minorIssues++;
	}

	const verifiedPanels = panelReports.filter((panel) => panel.status === 'verified').length;
	const needsReviewPanels = panelReports.filter((panel) => panel.status === 'needs_review').length;
	const rejectedPanels = panelReports.filter((panel) => panel.status === 'rejected').length;
	const unverifiedPanels = panelReports.filter((panel) => panel.status === 'unverified').length;
	const checks = panelReports.flatMap((panel) => Object.values(panel.checks));

	let status: RecapFidelityStatus = 'verified';
	if (rejectedPanels > 0 || chapterIssues.some((item) => BLOCKING_SEVERITIES.has(item.severity))) status = 'rejected';
	else if (needsReviewPanels > 0 || unverifiedPanels > 0 || chapterIssues.length > 0) status = 'needs_review';

	return {
		gate: 'recap_narrative_fidelity',
		status,
		checkedAtIso: input.checkedAtIso ?? new Date().toISOString(),
		panels: panelReports,
		chapterIssues,
		metrics: {
			panelCount: panelReports.length,
			verifiedPanels,
			needsReviewPanels,
			rejectedPanels,
			unverifiedPanels,
			majorOrCriticalIssues,
			minorIssues,
			narrativeEligiblePanels: storyEngineEligiblePanelIds.length,
			visualOnlyPanels: visualOnlyPanelIds.length,
			blockedPanels: blockedPanelIds.length,
			issueCounts,
			checksAudited: checks.length,
			checksWithEvidence: checks.filter((item) => item.evidence.length > 0).length,
		},
		storyEngineEligiblePanelIds,
		visualOnlyPanelIds,
		blockedPanelIds,
		humanReviewQueue,
	};
}

/** Rejected, uncertain, and unverified panels cannot become Story Engine facts. */
export function canForwardToStoryEngine(report: RecapFidelityGateReport): boolean {
	const blockedIds = report.blockedPanelIds ?? report.panels.filter((panel) => effectivePanelEligibility(panel) === 'blocked').map((panel) => panel.panelId);
	const relevantReview = report.panels.some((panel) => panel.status !== 'verified' && effectivePanelEligibility(panel) !== 'visual_only');
	return report.status !== 'rejected' && blockedIds.length === 0 && !relevantReview;
}

export function getStoryEngineEligiblePanelIds(report: RecapFidelityGateReport): string[] {
	return canForwardToStoryEngine(report) ? [...report.storyEngineEligiblePanelIds] : [];
}
