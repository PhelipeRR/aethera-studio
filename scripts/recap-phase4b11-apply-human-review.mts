/**
 * Phase 4B.11 — applies human review decisions exported by the review page
 * (`scripts/recap-phase4b11-human-review-page.mts`) to the chapter's fidelity review ledger.
 *
 * No inference. Usage:
 *   npx tsx scripts/recap-phase4b11-apply-human-review.mts <decisions.json> [--dry-run]
 *
 * Decisions:
 *  - accept       → review `verified`, human_review evidence; the reviewer overrules the v2 issues.
 *  - visual_only  → panel kept only as visual weight: one non-blocking INSUFFICIENT_EVIDENCE issue
 *                   records the decision; the Story Engine gets no narrative facts from it.
 *  - correct      → the analysis is replaced by the human correction in the checkpoint
 *                   (panelAnalyses and every analysisCacheByHash entry of the panel, so a resumed
 *                   run reuses it), and a `verified` review is bound to the new fingerprint.
 *  - keep         → nothing changes.
 * Every decision must name the analysis fingerprint it was made against and the ledger it came
 * from; anything stale is refused before writing. Checkpoint and ledger are backed up with a
 * timestamped name first; writes are atomic. Do not run while a recap job is running.
 */
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import {
	buildRecapFidelityGateFromReviews,
	canForwardToStoryEngine,
	loadRecapFidelityReviewLedger,
	panelAnalysisSchema,
	recapAnalysisFingerprint,
	recapFidelityReviewLedgerSchema,
	type ExtractedPanel,
	type PanelAnalysis,
	type RecapFidelityReviewRecord,
} from '../packages/cinema/src/recap/index.js';

const RUN_ID = 'recap-1795538364251';
const CHAPTER_ID = 'nano-machine-capitulo-01';
const REVIEWER = 'revisão humana (página de revisão Fase 4B.11)';
const ORIGIN = 'scripts/recap-phase4b11-apply-human-review.mts';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const decisionsPath = args.find((arg) => !arg.startsWith('--'));
if (!decisionsPath) throw new Error('Uso: npx tsx scripts/recap-phase4b11-apply-human-review.mts <decisions.json> [--dry-run]');

const workspace = process.env['RECAP_WORKSPACE_DIR'] ?? resolve(process.env['APPDATA'] ?? '', 'AetheraStudio', 'recap-workspace');
const checkpointDir = join(workspace, 'checkpoints', CHAPTER_ID);
const checkpointPath = join(checkpointDir, 'recap-checkpoint.json');
const ledgerPath = join(checkpointDir, 'fidelity-review-ledger.json');
const logPath = join(checkpointDir, 'human-review-log.jsonl');
const fidelityDir = join(workspace, 'projects', RUN_ID, 'fidelity');

const correctionSchema = z.object({
	visualDescription: z.string().trim().min(1),
	characters: z.array(z.string().trim().min(1)),
	dialogues: z.array(z.object({ kind: z.enum(['dialogue', 'thought', 'narration', 'sfx']), speaker: z.string(), text: z.string().trim().min(1) })),
	actions: z.array(z.object({ type: z.enum(['dialogue', 'combat', 'movement', 'reaction', 'observation', 'transformation', 'interaction', 'none']), description: z.string().trim().min(1) })),
});
const decisionsSchema = z.object({
	schemaVersion: z.literal(1),
	chapterId: z.literal(CHAPTER_ID),
	ledgerSha256: z.string().regex(/^[a-f0-9]{64}$/),
	exportedAtIso: z.string().datetime(),
	decisions: z.array(z.discriminatedUnion('decision', [
		z.object({ panelId: z.string(), analysisSha256: z.string(), decision: z.literal('accept'), note: z.string().trim().min(8) }),
		z.object({ panelId: z.string(), analysisSha256: z.string(), decision: z.literal('visual_only'), note: z.string().trim().min(8) }),
		z.object({ panelId: z.string(), analysisSha256: z.string(), decision: z.literal('correct'), note: z.string().trim().min(8), correction: correctionSchema }),
		z.object({ panelId: z.string(), analysisSha256: z.string(), decision: z.literal('keep'), note: z.string().default('') }),
	])).refine((items) => new Set(items.map((item) => item.panelId)).size === items.length, 'panelId repetido.'),
});

function atomicWrite(path: string, content: string): void {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, content, 'utf8');
	renameSync(temporary, path);
}

const CONTENT_KIND = { dialogue: 'dialogue', thought: 'dialogue', narration: 'narrative_caption', sfx: 'sound_effect' } as const;

const input = decisionsSchema.parse(JSON.parse(readFileSync(resolve(decisionsPath), 'utf8')));
const ledgerSha256 = createHash('sha256').update(readFileSync(ledgerPath)).digest('hex');
if (input.ledgerSha256 !== ledgerSha256) {
	throw new Error('RECAP_HUMAN_REVIEW_STALE_LEDGER: as decisões foram feitas sobre outro ledger. Gere a página de novo e refaça as decisões pendentes.');
}
const ledger = loadRecapFidelityReviewLedger(ledgerPath);
if (!ledger) throw new Error(`Ledger ausente: ${ledgerPath}`);
const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as { extractedPanels: ExtractedPanel[]; panelAnalyses: PanelAnalysis[]; analysisCacheByHash?: Record<string, PanelAnalysis> };
const analysisById = new Map(checkpoint.panelAnalyses.map((analysis) => [analysis.panelId, analysis]));
const reviewById = new Map(ledger.reviews.map((review) => [review.panelId, review]));
const nowIso = new Date().toISOString();

const summary = { accept: [] as string[], visual_only: [] as string[], correct: [] as string[], keep: [] as string[] };
for (const decision of input.decisions) {
	const analysis = analysisById.get(decision.panelId);
	const review = reviewById.get(decision.panelId);
	if (!analysis || !review) throw new Error(`Painel desconhecido: ${decision.panelId}`);
	if (recapAnalysisFingerprint(analysis) !== decision.analysisSha256) throw new Error(`RECAP_HUMAN_REVIEW_STALE_ANALYSIS: a análise de ${decision.panelId} mudou depois da decisão.`);
	if (review.status === 'verified' || review.eligibility === 'visual_only') throw new Error(`Painel ${decision.panelId} já não está bloqueado.`);
	if (decision.decision === 'keep') { summary.keep.push(decision.panelId); continue; }

	const evidence = [{ source: 'human_review' as const, detail: decision.note, ref: decision.panelId }];
	const base = { panelId: decision.panelId, panelSha256: review.panelSha256, reviewer: REVIEWER, reviewedAtIso: nowIso, origin: ORIGIN };
	let next: RecapFidelityReviewRecord;
	if (decision.decision === 'accept') {
		next = { ...base, analysisSha256: decision.analysisSha256, status: 'verified', evidence, issues: [] };
	} else if (decision.decision === 'visual_only') {
		const modelIssues = review.issues.map((item) => `${item.code}/${item.severity}`).join(', ');
		const detail = `Decisão humana: painel só visual, sem fatos narrativos. ${decision.note} Problemas da análise mantidos fora da narrativa: ${modelIssues}.`;
		next = {
			...base,
			analysisSha256: decision.analysisSha256,
			status: 'needs_review',
			eligibility: 'visual_only',
			evidence,
			issues: [{ code: 'INSUFFICIENT_EVIDENCE', severity: 'minor', detail, evidence: [{ source: 'human_review', detail: decision.note, ref: decision.panelId }], blocksNarrativeFact: false }],
		};
	} else {
		const { characterDetails: _dropped, ...rest } = analysis;
		const corrected = panelAnalysisSchema.parse({
			...rest,
			visualDescription: decision.correction.visualDescription,
			characters: decision.correction.characters,
			dialogues: decision.correction.dialogues.map((entry, index) => ({
				text: entry.text,
				kind: entry.kind,
				isNarration: entry.kind === 'narration',
				readingOrder: index,
				contentKind: CONTENT_KIND[entry.kind],
				...(entry.speaker.trim() ? { speaker: entry.speaker.trim() } : {}),
			})),
			actions: decision.correction.actions,
			analyzedAtIso: nowIso,
		});
		const index = checkpoint.panelAnalyses.findIndex((item) => item.panelId === decision.panelId);
		checkpoint.panelAnalyses[index] = corrected;
		for (const [key, entry] of Object.entries(checkpoint.analysisCacheByHash ?? {})) {
			if (entry?.panelId === decision.panelId) checkpoint.analysisCacheByHash![key] = corrected;
		}
		next = { ...base, analysisSha256: recapAnalysisFingerprint(corrected), status: 'verified', evidence, issues: [] };
	}
	reviewById.set(decision.panelId, next);
	summary[decision.decision].push(decision.panelId);
}

const reviews = ledger.reviews.map((review) => reviewById.get(review.panelId)!);
const nextLedger = recapFidelityReviewLedgerSchema.parse({ schemaVersion: 1, chapterId: CHAPTER_ID, reviews });
const result = buildRecapFidelityGateFromReviews({ panels: checkpoint.extractedPanels, analyses: checkpoint.panelAnalyses, ledger: nextLedger });
if (result.staleReviewPanelIds.length || result.unreviewedPanelIds.length || result.missingAnalysisPanelIds.length) {
	throw new Error(`Ledger incompleto: ${JSON.stringify({ stale: result.staleReviewPanelIds, unreviewed: result.unreviewedPanelIds, missing: result.missingAnalysisPanelIds })}`);
}

const stamp = nowIso.replace(/[:.]/g, '-');
const reportPath = join(fidelityDir, `fidelity-gate-report-human-review-${stamp}.json`);
if (!dryRun) {
	const changed = summary.accept.length + summary.visual_only.length + summary.correct.length;
	if (changed > 0) {
		const checkpointBackup = join(checkpointDir, `recap-checkpoint.before-human-review-${stamp}.json`);
		const ledgerBackup = join(checkpointDir, `fidelity-review-ledger.before-human-review-${stamp}.json`);
		for (const path of [checkpointBackup, ledgerBackup, reportPath]) if (existsSync(path)) throw new Error(`Recusando sobrescrever artefato: ${path}`);
		copyFileSync(checkpointPath, checkpointBackup);
		copyFileSync(ledgerPath, ledgerBackup);
		if (summary.correct.length > 0) atomicWrite(checkpointPath, `${JSON.stringify(checkpoint, null, 2)}\n`);
		atomicWrite(ledgerPath, `${JSON.stringify(nextLedger, null, 2)}\n`);
		atomicWrite(reportPath, `${JSON.stringify({ schemaVersion: 1, phase: '4B.11.human-review', runId: RUN_ID, chapterId: CHAPTER_ID, createdAtIso: nowIso, decisionsFile: resolve(decisionsPath), summary, report: result.report }, null, 2)}\n`);
		appendFileSync(logPath, `${JSON.stringify({ atIso: nowIso, decisionsFile: resolve(decisionsPath), summary, checkpointBackup, ledgerBackup })}\n`, 'utf8');
	}
}

console.log(JSON.stringify({
	dryRun,
	summary,
	canForwardToStoryEngine: canForwardToStoryEngine(result.report),
	narrativeEligible: result.report.storyEngineEligiblePanelIds.length,
	visualOnly: result.report.visualOnlyPanelIds.map((id) => id.replace(`${CHAPTER_ID}_`, '')),
	blocked: result.report.blockedPanelIds.map((id) => id.replace(`${CHAPTER_ID}_`, '')),
	...(dryRun ? {} : { reportPath }),
}, null, 2));
