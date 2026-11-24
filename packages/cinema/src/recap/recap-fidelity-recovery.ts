import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
	RecapFidelityEvidence,
	RecapFidelityIssueCode,
	RecapFidelityHumanReview,
	RecapFidelityPanelReport,
} from './recap-fidelity-gate.js';

/** Versioned sidecar contract. Original panel checkpoints remain immutable. */
export const RECAP_FIDELITY_RECOVERY_VERSION = 'recap-fidelity-recovery-v1';

export type RecapRecoveryStatus = 'resolved' | 'needs_review' | 'rejected' | 'skipped';
export type RecapRecoveryStrategy = 'deterministic_fragment' | 'localized_ocr' | 'local_visual' | 'contextual_panels' | 'deterministic_sfx' | 'perceptual_duplicate' | 'human_review';

export interface RecapRecoveryBoundingBox {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface RecapRecoveryContext {
	pagePath?: string | null;
	cropPath?: string | null;
	boundingBox?: RecapRecoveryBoundingBox | null;
	previousPanelId?: string | null;
	nextPanelId?: string | null;
	/** Evidence obtained without model inference from the original page/crop. */
	fragment?: {
		kind: 'sfx_fragment' | 'text_fragment' | 'transition_fragment' | 'segmentation_fragment' | 'unknown_fragment';
		pageContext: string;
		preserveInSequence: true;
	};
	sfx?: {
		text: string;
		region?: string | null;
		bubblePresent: boolean;
		stylizedTypography: boolean;
		overlayPosition: boolean;
		readingAsSpeech: boolean;
	};
	duplicate?: {
		otherPanelId: string;
		otherSha256: string;
		exactShaMatch: boolean;
		perceptualSimilarity: number | null;
		boundingBoxOverlap: number | null;
		samePage: boolean;
		coordinatesDistinct: boolean;
		readingOrderDistance: number | null;
	};
	ocr?: {
		currentText: string | null;
		visualCandidateText?: string | null;
		visualCandidateEvidence?: string | null;
	};
}

export interface RecapRecoveryPanel {
	panelId: string;
	sha256: string | null;
	pageNumber: number;
	panelIndex: number;
	gateReport: RecapFidelityPanelReport;
	context: RecapRecoveryContext;
}

export interface RecapLocalizedOcrRequest {
	panelId: string;
	imagePath: string;
	region?: RecapRecoveryBoundingBox | null;
	signal?: AbortSignal;
}

export interface RecapLocalizedOcrResult {
	text: string;
	confidence: number | null;
	language: string | null;
	region: string | null;
	inputTokens: number | null;
	outputTokens: number | null;
	validatedAgainstImage: boolean;
	evidence: string;
	lines?: readonly {
		text: string;
		confidence: number | null;
		boundingBox: RecapRecoveryBoundingBox;
		polygon?: readonly [number, number][];
	}[];
	processingMs?: number;
	model?: string | null;
	provenance?: Record<string, unknown>;
	error?: string | null;
	status?: 'success' | 'failed' | 'cancelled' | 'timeout' | 'cache_hit';
	cacheHit?: boolean;
}

export interface RecapLocalizedOcrAdapter {
	name: string;
	recognize(input: RecapLocalizedOcrRequest): Promise<RecapLocalizedOcrResult>;
}

/** Structural bridge to the job-wide hard budget; cache hits must not reserve. */
export interface RecapRecoveryBudgetPort {
	reserveCall(input: { kind: 'ocr' | 'analysis' | 'cpu-fallback'; estimatedInputTokens?: number | null; estimatedOutputTokens?: number | null }): unknown;
	settleCall(reservation: unknown, usage: { inputTokens?: number | null; outputTokens?: number | null; wallMs?: number | null; errorCode?: string | null }): Promise<void>;
}

export interface RecapRecoverySupplementalResult {
	correction?: RecapRecoveryCorrection | null;
	confidence: number | null;
	validatedAgainstImage: boolean;
	inputTokens: number | null;
	outputTokens: number | null;
	evidence: string;
}

export interface RecapLocalVisualAdapter {
	name: string;
	analyze(input: { panelId: string; imagePath: string; signal?: AbortSignal }): Promise<RecapRecoverySupplementalResult>;
}

export interface RecapContextualRecoveryAdapter {
	name: string;
	analyze(input: { panelId: string; previousPanelId?: string | null; nextPanelId?: string | null; signal?: AbortSignal }): Promise<RecapRecoverySupplementalResult>;
}

export interface RecapRecoveryBudget {
	maxPanels: number;
	maxCalls: number;
	maxOcrCalls: number;
	maxInputTokens: number;
	maxOutputTokens: number;
	maxWallTimeMs: number;
	maxAttemptsPerPanel: number;
	maxCpuFallbacks: number;
	maxVramMiB: number;
}

export const DEFAULT_RECAP_RECOVERY_BUDGET: RecapRecoveryBudget = {
	maxPanels: 5,
	maxCalls: 10,
	maxOcrCalls: 5,
	maxInputTokens: 20_000,
	maxOutputTokens: 8_000,
	maxWallTimeMs: 5 * 60 * 1000,
	maxAttemptsPerPanel: 1,
	maxCpuFallbacks: 0,
	maxVramMiB: 6_500,
};

export interface RecapRecoveryCorrection {
	kind: 'classification' | 'ocr' | 'sfx' | 'duplicate';
	field: string;
	before: unknown;
	after: unknown;
	accepted: boolean;
	factsAllowed: boolean;
	evidence: RecapFidelityEvidence[];
}

export interface RecapRecoveryLedgerEntry {
	timestampIso: string;
	recoveryVersion: string;
	panelId: string;
	issueCodes: RecapFidelityIssueCode[];
	strategy: RecapRecoveryStrategy;
	status: RecapRecoveryStatus;
	attempts: number;
	cacheHit: boolean;
	modelCalls: number;
	ocrCalls: number;
	inputTokens: number | null;
	outputTokens: number | null;
	wallMs: number;
	vramMiB: number | null;
	stopReason: string | null;
	error: string | null;
}

export interface RecapRecoveryRecord {
	recoveryVersion: string;
	cacheKey: string;
	createdAtIso: string;
	panelId: string;
	panelSha256: string | null;
	issueCodes: RecapFidelityIssueCode[];
	strategy: RecapRecoveryStrategy;
	status: RecapRecoveryStatus;
	attempts: number;
	cacheHit: boolean;
	modelCalls: number;
	ocrCalls: number;
	inputTokens: number | null;
	outputTokens: number | null;
	vramMiB: number | null;
	corrections: RecapRecoveryCorrection[];
	evidence: RecapFidelityEvidence[];
	error: string | null;
	stopReason: string | null;
	/** Facts stay blocked when a candidate is retained for human confirmation. */
	factsAllowed: boolean;
}

export interface RecapRecoveryRunResult {
	recoveryVersion: string;
	status: 'completed' | 'paused_budget' | 'cancelled' | 'blocked';
	records: RecapRecoveryRecord[];
	ledger: RecapRecoveryLedgerEntry[];
	preservedVerifiedPanelIds: string[];
	usage: {
		panelsConsidered: number;
		panelsRecovered: number;
		cacheHits: number;
		modelCalls: number;
		ocrCalls: number;
		inputTokens: number | null;
		outputTokens: number | null;
		wallMs: number;
		peakVramMiB: number | null;
		stopReason: string;
	};
}

export interface RecapRecoveryStoreOptions {
	directory: string;
	ledgerPath?: string;
}

function atomicWrite(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporaryPath, content, 'utf8');
	renameSync(temporaryPath, path);
}

function recoveryCacheKeyWithAdapters(panel: RecapRecoveryPanel, adapters: { ocr?: string; localVisual?: string; contextual?: string } = {}): string {
	return createHash('sha256')
		.update(JSON.stringify({
			version: RECAP_FIDELITY_RECOVERY_VERSION,
			panelId: panel.panelId,
			sha256: panel.sha256,
			issueCodes: panel.gateReport.issues.map((item) => item.code).sort(),
			context: panel.context,
			adapters,
		}))
		.digest('hex');
}

export class RecapFidelityRecoveryStore {
	private readonly directory: string;
	private readonly ledgerPath: string;

	constructor(options: RecapRecoveryStoreOptions) {
		this.directory = options.directory;
		this.ledgerPath = options.ledgerPath ?? join(options.directory, 'recovery-ledger.jsonl');
		mkdirSync(this.directory, { recursive: true });
	}

	pathFor(cacheKey: string, phase: 'before' | 'after'): string {
		return join(this.directory, `${cacheKey}.${phase}.json`);
	}

	read(cacheKey: string): RecapRecoveryRecord | null {
		const path = this.pathFor(cacheKey, 'after');
		if (!existsSync(path)) return null;
		try {
			const value = JSON.parse(readFileSync(path, 'utf8')) as RecapRecoveryRecord;
			return value.recoveryVersion === RECAP_FIDELITY_RECOVERY_VERSION && value.cacheKey === cacheKey && value.attempts >= 1 ? value : null;
		} catch {
			return null;
		}
	}

	writeBefore(cacheKey: string, payload: unknown): void {
		const path = this.pathFor(cacheKey, 'before');
		if (!existsSync(path)) atomicWrite(path, `${JSON.stringify(payload, null, 2)}\n`);
	}

	writeAfter(cacheKey: string, record: RecapRecoveryRecord): void {
		atomicWrite(this.pathFor(cacheKey, 'after'), `${JSON.stringify(record, null, 2)}\n`);
	}

	appendLedger(entry: RecapRecoveryLedgerEntry): void {
		mkdirSync(dirname(this.ledgerPath), { recursive: true });
		appendFileSync(this.ledgerPath, `${JSON.stringify(entry)}\n`, 'utf8');
	}
}

function issueCodes(panel: RecapRecoveryPanel): RecapFidelityIssueCode[] {
	return [...new Set(panel.gateReport.issues.map((item) => item.code))];
}

function imageEvidence(panelId: string, detail: string): RecapFidelityEvidence {
	return { source: 'image', detail, ref: panelId };
}

function comparisonEvidence(panelId: string, detail: string): RecapFidelityEvidence {
	return { source: 'comparison', detail, ref: panelId };
}

function humanEvidence(panelId: string, detail: string): RecapFidelityEvidence {
	return { source: 'human_review', detail, ref: panelId };
}

function makeRecord(input: {
	panel: RecapRecoveryPanel;
	cacheKey: string;
	strategy: RecapRecoveryStrategy;
	status: RecapRecoveryStatus;
	attempts: number;
	cacheHit: boolean;
	modelCalls?: number;
	ocrCalls?: number;
	inputTokens?: number | null;
	outputTokens?: number | null;
	corrections?: RecapRecoveryCorrection[];
	evidence?: RecapFidelityEvidence[];
	error?: string | null;
	stopReason?: string | null;
	factsAllowed?: boolean;
}): RecapRecoveryRecord {
	return {
		recoveryVersion: RECAP_FIDELITY_RECOVERY_VERSION,
		cacheKey: input.cacheKey,
		createdAtIso: new Date().toISOString(),
		panelId: input.panel.panelId,
		panelSha256: input.panel.sha256,
		issueCodes: issueCodes(input.panel),
		strategy: input.strategy,
		status: input.status,
		attempts: input.attempts,
		cacheHit: input.cacheHit,
		modelCalls: input.modelCalls ?? 0,
		ocrCalls: input.ocrCalls ?? 0,
		inputTokens: input.inputTokens === undefined ? 0 : input.inputTokens,
		outputTokens: input.outputTokens === undefined ? 0 : input.outputTokens,
		vramMiB: null,
		corrections: input.corrections ?? [],
		evidence: input.evidence ?? [],
		error: input.error ?? null,
		stopReason: input.stopReason ?? null,
		factsAllowed: input.factsAllowed ?? false,
	};
}

function chooseStrategy(panel: RecapRecoveryPanel): RecapRecoveryStrategy {
	const codes = new Set(issueCodes(panel));
	if (codes.has('UNKNOWN_PANEL') || codes.has('INSUFFICIENT_EVIDENCE')) return 'deterministic_fragment';
	if (codes.has('OCR_INCOMPLETE') || codes.has('DIALOGUE_OMISSION')) return 'localized_ocr';
	if (codes.has('SFX_AS_DIALOGUE')) return 'deterministic_sfx';
	if (codes.has('DUPLICATE_CONTENT')) return 'perceptual_duplicate';
	return 'human_review';
}

function chooseStrategyWithAdapters(panel: RecapRecoveryPanel, input: { ocrAdapter?: RecapLocalizedOcrAdapter; localVisualAdapter?: RecapLocalVisualAdapter; contextualAdapter?: RecapContextualRecoveryAdapter }): RecapRecoveryStrategy {
	const preferred = chooseStrategy(panel);
	if (preferred === 'localized_ocr' && input.ocrAdapter && panel.context.cropPath) return preferred;
	if (preferred === 'localized_ocr' && input.localVisualAdapter && (panel.context.cropPath || panel.context.pagePath)) return 'local_visual';
	if ((preferred === 'localized_ocr' || preferred === 'deterministic_fragment') && input.contextualAdapter) return 'contextual_panels';
	if (preferred === 'deterministic_fragment' && panel.context.fragment) return preferred;
	if (preferred === 'deterministic_fragment' && input.localVisualAdapter && (panel.context.cropPath || panel.context.pagePath)) return 'local_visual';
	return preferred;
}

function recoverDeterministicFragment(panel: RecapRecoveryPanel, cacheKey: string): RecapRecoveryRecord {
	const fragment = panel.context.fragment;
	if (!fragment) {
		return makeRecord({ panel, cacheKey, strategy: 'deterministic_fragment', status: 'needs_review', attempts: 1, cacheHit: false, evidence: [humanEvidence(panel.panelId, 'Não há evidência contextual suficiente para classificar o fragmento sem inferência.')], stopReason: 'insufficient_context' });
	}
	const detail = `Fragmento classificado deterministicamente como ${fragment.kind}; página e posição preservadas. ${fragment.pageContext}`;
	return makeRecord({
		panel,
		cacheKey,
		strategy: 'deterministic_fragment',
		status: 'resolved',
		attempts: 1,
		cacheHit: false,
		corrections: [{
			kind: 'classification',
			field: 'narrativeRole',
			before: 'unknown',
			after: fragment.kind,
			accepted: true,
			factsAllowed: false,
			evidence: [imageEvidence(panel.panelId, detail)],
		}],
		evidence: [imageEvidence(panel.panelId, detail)],
		factsAllowed: false,
	});
}

function recoverDeterministicSfx(panel: RecapRecoveryPanel, cacheKey: string): RecapRecoveryRecord {
	const sfx = panel.context.sfx;
	if (!sfx || sfx.bubblePresent || !sfx.stylizedTypography || !sfx.overlayPosition || sfx.readingAsSpeech) {
		return makeRecord({ panel, cacheKey, strategy: 'deterministic_sfx', status: 'needs_review', attempts: 1, cacheHit: false, evidence: [humanEvidence(panel.panelId, 'Evidência de tipografia/posição não separa SFX de diálogo com segurança.')], stopReason: 'ambiguous_text_role' });
	}
	const detail = `SFX '${sfx.text}' separado de dialogue por ausência de balão, tipografia estilizada e posição overlay; região ${sfx.region ?? 'desconhecida'}.`;
	return makeRecord({
		panel,
		cacheKey,
		strategy: 'deterministic_sfx',
		status: 'resolved',
		attempts: 1,
		cacheHit: false,
		corrections: [{
			kind: 'sfx',
			field: 'analysis.frames[].visibleText[0]',
			before: { kind: 'dialogue', text: sfx.text },
			after: { kind: 'sfx', text: sfx.text, region: sfx.region ?? null },
			accepted: true,
			factsAllowed: true,
			evidence: [imageEvidence(panel.panelId, detail)],
		}],
		evidence: [imageEvidence(panel.panelId, detail)],
		factsAllowed: true,
	});
}

function recoverPerceptualDuplicate(panel: RecapRecoveryPanel, cacheKey: string): RecapRecoveryRecord {
	const duplicate = panel.context.duplicate;
	if (!duplicate) {
		return makeRecord({ panel, cacheKey, strategy: 'perceptual_duplicate', status: 'needs_review', attempts: 1, cacheHit: false, evidence: [humanEvidence(panel.panelId, 'Não há hash perceptual e coordenadas suficientes para decidir.')], stopReason: 'insufficient_similarity_evidence' });
	}
	const similarity = duplicate.perceptualSimilarity;
	const intentional = !duplicate.exactShaMatch &&
		typeof similarity === 'number' && similarity >= 0.98 &&
		duplicate.boundingBoxOverlap === 0 && duplicate.samePage && duplicate.coordinatesDistinct;
	if (intentional) {
		const detail = `Repetição visual intencional provável: SHA distinto, similaridade perceptual ${similarity.toFixed(4)}, caixas sem sobreposição e posições distintas; ambos os painéis permanecem.`;
		return makeRecord({
			panel,
			cacheKey,
			strategy: 'perceptual_duplicate',
			status: 'resolved',
			attempts: 1,
			cacheHit: false,
			corrections: [{
				kind: 'duplicate',
				field: 'sequenceDeduplication',
				before: { candidate: duplicate.otherPanelId },
				after: { decision: 'preserve_both', reason: 'intentional_repetition' },
				accepted: true,
				factsAllowed: true,
				evidence: [comparisonEvidence(panel.panelId, detail)],
			}],
			evidence: [comparisonEvidence(panel.panelId, detail)],
			factsAllowed: true,
		});
	}
	return makeRecord({
		panel,
		cacheKey,
		strategy: 'perceptual_duplicate',
		status: 'needs_review',
		attempts: 1,
		cacheHit: false,
		evidence: [comparisonEvidence(panel.panelId, `Possível duplicação com ${duplicate.otherPanelId}; exactSha=${duplicate.exactShaMatch}, similarity=${similarity ?? 'null'}, overlap=${duplicate.boundingBoxOverlap ?? 'null'}. Nenhum painel foi removido.`)],
		stopReason: 'duplicate_not_proven',
	});
}

async function recoverLocalizedOcr(panel: RecapRecoveryPanel, cacheKey: string, adapter?: RecapLocalizedOcrAdapter, signal?: AbortSignal, budget?: RecapRecoveryBudgetPort): Promise<RecapRecoveryRecord> {
	const ocr = panel.context.ocr;
	if (!adapter || !ocr || !panel.context.cropPath) {
		const evidence = ocr?.visualCandidateText
			? [humanEvidence(panel.panelId, `Candidato visual independente '${ocr.visualCandidateText}' preservado como hipótese; OCR local não foi executado.`)]
			: [humanEvidence(panel.panelId, 'OCR local não disponível; texto anterior foi preservado sem substituição.')];
		return makeRecord({ panel, cacheKey, strategy: 'localized_ocr', status: 'needs_review', attempts: 1, cacheHit: false, evidence, stopReason: 'ocr_adapter_unavailable' });
	}
	let reservation: unknown = null;
	try {
		reservation = budget?.reserveCall({ kind: 'ocr', estimatedInputTokens: null, estimatedOutputTokens: null }) ?? null;
	} catch (error) {
		const message = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
		return makeRecord({ panel, cacheKey, strategy: 'localized_ocr', status: 'needs_review', attempts: 0, cacheHit: false, inputTokens: 0, outputTokens: 0, evidence: [humanEvidence(panel.panelId, 'OCR não iniciado: orçamento compartilhado bloqueou a tentativa antes do provider.')], error: message, stopReason: 'budget_blocked' });
	}
	let result: RecapLocalizedOcrResult;
	try {
		result = await adapter.recognize({ panelId: panel.panelId, imagePath: panel.context.cropPath, ...(panel.context.boundingBox ? { region: panel.context.boundingBox } : {}), ...(signal ? { signal } : {}) });
		if (reservation !== null && budget) await budget.settleCall(reservation, { inputTokens: result.cacheHit ? 0 : result.inputTokens, outputTokens: result.cacheHit ? 0 : result.outputTokens, wallMs: result.processingMs ?? null });
	} catch (error) {
		if (reservation !== null && budget) {
			try { await budget.settleCall(reservation, { inputTokens: null, outputTokens: null, errorCode: 'OCR_ADAPTER_FAILED', wallMs: null }); } catch { /* budget state is already paused/persisted */ }
		}
		const message = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
		return makeRecord({ panel, cacheKey, strategy: 'localized_ocr', status: 'needs_review', attempts: 1, cacheHit: false, inputTokens: 0, outputTokens: 0, evidence: [humanEvidence(panel.panelId, 'OCR falhou; texto anterior foi preservado para revisão humana.')], error: message, stopReason: 'ocr_adapter_failed' });
	}
	const valid = result.text.trim().length > 0 && result.validatedAgainstImage && (result.confidence === null || result.confidence >= 0.8);
	const evidence = [humanEvidence(panel.panelId, result.evidence)];
	if (!valid) {
		return makeRecord({ panel, cacheKey, strategy: 'localized_ocr', status: 'needs_review', attempts: 1, cacheHit: false, ocrCalls: result.cacheHit ? 0 : 1, inputTokens: result.cacheHit ? 0 : result.inputTokens, outputTokens: result.cacheHit ? 0 : result.outputTokens, evidence, stopReason: 'ocr_not_validated' });
	}
	return makeRecord({
		panel,
		cacheKey,
		strategy: 'localized_ocr',
		status: 'resolved',
		attempts: 1,
		cacheHit: false,
		ocrCalls: result.cacheHit ? 0 : 1,
		inputTokens: result.cacheHit ? 0 : result.inputTokens,
		outputTokens: result.cacheHit ? 0 : result.outputTokens,
		corrections: [{
			kind: 'ocr',
			field: 'analysis.frames[].visibleText[0].text',
			before: ocr.currentText,
			after: { text: result.text, language: result.language, region: result.region, lines: result.lines ?? [], processingMs: result.processingMs ?? null, model: result.model ?? null, provenance: result.provenance ?? {} },
			accepted: true,
			factsAllowed: true,
			evidence,
		}],
		evidence,
		factsAllowed: true,
	});
}

async function recoverWithSupplementalAdapter(
	panel: RecapRecoveryPanel,
	cacheKey: string,
	strategy: 'local_visual' | 'contextual_panels',
	adapter: RecapLocalVisualAdapter | RecapContextualRecoveryAdapter,
	signal?: AbortSignal,
): Promise<RecapRecoveryRecord> {
	const result = strategy === 'local_visual'
		? await (adapter as RecapLocalVisualAdapter).analyze({ panelId: panel.panelId, imagePath: panel.context.cropPath ?? panel.context.pagePath ?? '', ...(signal ? { signal } : {}) })
		: await (adapter as RecapContextualRecoveryAdapter).analyze({ panelId: panel.panelId, ...(panel.context.previousPanelId !== undefined ? { previousPanelId: panel.context.previousPanelId } : {}), ...(panel.context.nextPanelId !== undefined ? { nextPanelId: panel.context.nextPanelId } : {}), ...(signal ? { signal } : {}) });
	const valid = result.validatedAgainstImage && result.correction?.accepted === true && result.correction.factsAllowed === true && (result.confidence === null || result.confidence >= 0.8);
	const evidence = [humanEvidence(panel.panelId, result.evidence)];
	return makeRecord({
		panel,
		cacheKey,
		strategy,
		status: valid ? 'resolved' : 'needs_review',
		attempts: 1,
		cacheHit: false,
		modelCalls: 1,
		inputTokens: result.inputTokens,
		outputTokens: result.outputTokens,
		corrections: result.correction ? [{ ...result.correction, evidence: [...result.correction.evidence, ...evidence] }] : [],
		evidence,
		factsAllowed: valid,
		stopReason: valid ? null : 'supplemental_evidence_not_validated',
	});
}

function toLedger(record: RecapRecoveryRecord, wallMs: number): RecapRecoveryLedgerEntry {
	return {
		timestampIso: record.createdAtIso,
		recoveryVersion: record.recoveryVersion,
		panelId: record.panelId,
		issueCodes: record.issueCodes,
		strategy: record.strategy,
		status: record.status,
		attempts: record.attempts,
		cacheHit: record.cacheHit,
		modelCalls: record.modelCalls,
		ocrCalls: record.ocrCalls,
		inputTokens: record.inputTokens,
		outputTokens: record.outputTokens,
		wallMs,
		vramMiB: record.vramMiB,
		stopReason: record.stopReason,
		error: record.error,
	};
}

/**
 * Recovers only non-verified panels. Strategies are bounded and deterministic
 * before any optional OCR adapter is consulted. No model fallback is implicit.
 */
export async function runRecapFidelityRecovery(input: {
	panels: readonly RecapRecoveryPanel[];
	store: RecapFidelityRecoveryStore;
	budget?: Partial<RecapRecoveryBudget>;
	ocrAdapter?: RecapLocalizedOcrAdapter;
	budgetPort?: RecapRecoveryBudgetPort;
	localVisualAdapter?: RecapLocalVisualAdapter;
	contextualAdapter?: RecapContextualRecoveryAdapter;
	signal?: AbortSignal;
	now?: () => number;
	getVramMiB?: () => number | null;
}): Promise<RecapRecoveryRunResult> {
	const budget = { ...DEFAULT_RECAP_RECOVERY_BUDGET, ...(input.budget ?? {}) };
	const now = input.now ?? (() => Date.now());
	const startedAt = now();
	const pending = input.panels.filter((panel) => panel.gateReport.status !== 'verified');
	const preservedVerifiedPanelIds = input.panels.filter((panel) => panel.gateReport.status === 'verified').map((panel) => panel.panelId);
	const records: RecapRecoveryRecord[] = [];
	const ledger: RecapRecoveryLedgerEntry[] = [];
	let modelCalls = 0;
	let ocrCalls = 0;
	let inputTokens: number | null = 0;
	let outputTokens: number | null = 0;
	let peakVramMiB: number | null = null;
	let stopReason = 'completed';

	if (pending.length > budget.maxPanels) {
		return {
			recoveryVersion: RECAP_FIDELITY_RECOVERY_VERSION,
			status: 'paused_budget',
			records: [],
			ledger: [],
			preservedVerifiedPanelIds,
			usage: { panelsConsidered: 0, panelsRecovered: 0, cacheHits: 0, modelCalls: 0, ocrCalls: 0, inputTokens: 0, outputTokens: 0, wallMs: now() - startedAt, peakVramMiB: null, stopReason: 'maxPanels' },
		};
	}

	for (const panel of pending) {
		if (input.signal?.aborted) { stopReason = 'cancelled'; break; }
		if (now() - startedAt >= budget.maxWallTimeMs) { stopReason = 'maxWallTimeMs'; break; }
		if (modelCalls + ocrCalls >= budget.maxCalls) { stopReason = 'maxCalls'; break; }
		const currentVramMiB = input.getVramMiB?.() ?? null;
		if (currentVramMiB !== null) {
			peakVramMiB = peakVramMiB === null ? currentVramMiB : Math.max(peakVramMiB, currentVramMiB);
			if (currentVramMiB > budget.maxVramMiB) { stopReason = 'vramLimit'; break; }
		}
		if (ocrCalls >= budget.maxOcrCalls && issueCodes(panel).some((code) => code === 'OCR_INCOMPLETE' || code === 'DIALOGUE_OMISSION')) { stopReason = 'maxOcrCalls'; break; }
		const cacheKey = recoveryCacheKeyWithAdapters(panel, {
			...(input.ocrAdapter ? { ocr: input.ocrAdapter.name } : {}),
			...(input.localVisualAdapter ? { localVisual: input.localVisualAdapter.name } : {}),
			...(input.contextualAdapter ? { contextual: input.contextualAdapter.name } : {}),
		});
		const cached = input.store.read(cacheKey);
		if (cached) {
			records.push({ ...cached, cacheHit: true });
			const cachedLedger = toLedger({ ...cached, cacheHit: true }, 0);
			ledger.push(cachedLedger);
			input.store.appendLedger(cachedLedger);
			continue;
		}

		const before = { recoveryVersion: RECAP_FIDELITY_RECOVERY_VERSION, phase: 'before', cacheKey, panelId: panel.panelId, panelSha256: panel.sha256, issueCodes: issueCodes(panel), context: panel.context, capturedAtIso: new Date().toISOString() };
		input.store.writeBefore(cacheKey, before);
		const taskStarted = now();
		let record: RecapRecoveryRecord;
		try {
			const strategy = chooseStrategyWithAdapters(panel, input);
			switch (strategy) {
				case 'deterministic_fragment': record = recoverDeterministicFragment(panel, cacheKey); break;
				case 'deterministic_sfx': record = recoverDeterministicSfx(panel, cacheKey); break;
				case 'perceptual_duplicate': record = recoverPerceptualDuplicate(panel, cacheKey); break;
				case 'localized_ocr': record = await recoverLocalizedOcr(panel, cacheKey, input.ocrAdapter, input.signal, input.budgetPort); break;
				case 'local_visual': record = await recoverWithSupplementalAdapter(panel, cacheKey, strategy, input.localVisualAdapter!, input.signal); break;
				case 'contextual_panels': record = await recoverWithSupplementalAdapter(panel, cacheKey, strategy, input.contextualAdapter!, input.signal); break;
				default: record = makeRecord({ panel, cacheKey, strategy: 'human_review', status: 'needs_review', attempts: 1, cacheHit: false, evidence: [humanEvidence(panel.panelId, 'Nenhuma estratégia automática segura está disponível para este código.')], stopReason: 'human_review_required' });
			}
		} catch (error) {
			const message = error instanceof Error ? error.message.slice(0, 240) : String(error).slice(0, 240);
			record = makeRecord({ panel, cacheKey, strategy: chooseStrategyWithAdapters(panel, input), status: 'needs_review', attempts: 1, cacheHit: false, error: message, stopReason: 'recovery_error' });
		}
		input.store.writeAfter(cacheKey, record);
		const taskLedger = toLedger(record, Math.max(0, now() - taskStarted));
		input.store.appendLedger(taskLedger);
		records.push(record);
		ledger.push(taskLedger);
		modelCalls += record.modelCalls;
		ocrCalls += record.ocrCalls;
		if (inputTokens !== null && record.inputTokens !== null) inputTokens += record.inputTokens;
		else if (record.inputTokens === null) inputTokens = null;
		if (outputTokens !== null && record.outputTokens !== null) outputTokens += record.outputTokens;
		else if (record.outputTokens === null) outputTokens = null;
		if ((inputTokens !== null && inputTokens > budget.maxInputTokens) || (outputTokens !== null && outputTokens > budget.maxOutputTokens)) { stopReason = 'tokenBudget'; break; }
	}

	const status = stopReason === 'completed' ? 'completed' : stopReason === 'cancelled' ? 'cancelled' : 'paused_budget';
	return {
		recoveryVersion: RECAP_FIDELITY_RECOVERY_VERSION,
		status,
		records,
		ledger,
		preservedVerifiedPanelIds,
		usage: {
			panelsConsidered: records.length,
			panelsRecovered: records.filter((record) => record.status === 'resolved').length,
			cacheHits: records.filter((record) => record.cacheHit).length,
			modelCalls,
			ocrCalls,
			inputTokens,
			outputTokens,
			wallMs: Math.max(0, now() - startedAt),
			peakVramMiB,
			stopReason,
		},
	};
}

export function recoveryIssueCodes(record: RecapRecoveryRecord): RecapFidelityIssueCode[] {
	return [...record.issueCodes];
}

/** Applies only a persisted recovery decision; the caller must rerun the fidelity gate afterwards. */
export function applyRecapRecoveryToReview(
	baseReview: RecapFidelityHumanReview,
	record: RecapRecoveryRecord,
): RecapFidelityHumanReview {
	if (record.status === 'resolved' && record.factsAllowed) {
		return {
			status: 'verified',
			evidence: [...baseReview.evidence, ...record.evidence],
			issues: [],
			eligibility: 'narrative_eligible',
		};
	}
	return {
		...baseReview,
		evidence: [...baseReview.evidence, ...record.evidence],
		...(record.status === 'resolved' && record.strategy === 'deterministic_fragment' ? { eligibility: 'visual_only' as const } : {}),
	};
}
