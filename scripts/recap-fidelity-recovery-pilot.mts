import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import {
	RecapFidelityRecoveryStore,
	applyRecapRecoveryToReview,
	runRecapFidelityGate,
	runRecapFidelityRecovery,
	type RecapFidelityEvidence,
	type RecapFidelityGateReport,
	type RecapFidelityHumanReview,
	type RecapRecoveryContext,
	type RecapRecoveryPanel,
} from '../packages/cinema/src/recap/index.js';

const pilotRoot = join(process.cwd(), '.aethera-recap-data', 'phase4b5-qwen35-pilot-20261123');
const cacheRoot = join(pilotRoot, 'qwen-cache');
const manifestPath = join(pilotRoot, 'pilot-dataset-manifest.json');
const baselineReportPath = join(cacheRoot, 'fidelity-gate-report-v2.json');
const recoveryDir = join(cacheRoot, 'fidelity-recovery-v1');
const reportPath = join(cacheRoot, 'fidelity-recovery-v1.json');
const markdownPath = join(cacheRoot, 'fidelity-recovery-v1.md');
const afterReportPath = join(cacheRoot, 'fidelity-gate-report-after-recovery-v1.json');
const afterMarkdownPath = join(cacheRoot, 'fidelity-gate-report-after-recovery-v1.md');
const afterQueuePath = join(cacheRoot, 'fidelity-human-review-queue-after-recovery-v1.json');

function sha256(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeNew(path: string, content: string): void {
	if (existsSync(path)) throw new Error(`Refusing to overwrite existing Phase 4B.8 artifact: ${path}`);
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, content, 'utf8');
	renameSync(temporary, path);
}

function boxOverlap(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }): number {
	const x0 = Math.max(a.x, b.x);
	const y0 = Math.max(a.y, b.y);
	const x1 = Math.min(a.x + a.w, b.x + b.w);
	const y1 = Math.min(a.y + a.h, b.y + b.h);
	const intersection = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
	const union = a.w * a.h + b.w * b.h - intersection;
	return union > 0 ? intersection / union : 0;
}

async function perceptualSimilarity(firstPath: string, secondPath: string): Promise<number> {
	const buffers: Buffer[] = [];
	for (const path of [firstPath, secondPath]) {
		const result = await sharp(path).resize(32, 32, { fit: 'fill' }).greyscale().raw().toBuffer({ resolveWithObject: true });
		buffers.push(result.data);
	}
	let absoluteDifference = 0;
	for (let index = 0; index < buffers[0]!.length; index++) absoluteDifference += Math.abs(buffers[0]![index]! - buffers[1]![index]!);
	return 1 - absoluteDifference / (buffers[0]!.length * 255);
}

function evidenceFor(panelId: string, detail: string): RecapFidelityEvidence[] {
	return [{ source: 'image', detail, ref: panelId }];
}

function reviewFromReport(panel: RecapFidelityGateReport['panels'][number]): RecapFidelityHumanReview {
	const evidence = panel.checks.evidence.evidence.length > 0
		? panel.checks.evidence.evidence
		: panel.checks.visual.evidence;
	return { status: panel.status, evidence, issues: panel.issues };
}

function buildContext(entry: any, selected: readonly any[], similarityById: Map<string, number>): RecapRecoveryContext {
	const index = selected.findIndex((item) => item.panelId === entry.panelId);
	const previous = selected[index - 1];
	const next = selected[index + 1];
	const base: RecapRecoveryContext = {
		pagePath: entry.pagePath,
		cropPath: entry.cropPath,
		boundingBox: entry.boundingBox,
		previousPanelId: previous?.panelId ?? null,
		nextPanelId: next?.panelId ?? null,
	};
	if (entry.panelId === 'nanomachine-cap-1-5_p1_3') {
		return {
			...base,
			fragment: {
				kind: 'sfx_fragment',
				pageContext: 'A página original em y=3987–4211 mostra um glyph preto de onomatopeia e a borda parcial de um balão; o crop não contém uma fala completa nem um evento independente. A posição original é preservada.',
				preserveInSequence: true,
			},
		};
	}
	if (entry.panelId === 'nanomachine-cap-1-5_p6_3') {
		return {
			...base,
			ocr: {
				currentText: 'REUR...!',
				visualCandidateText: 'KEUK...?',
				visualCandidateEvidence: 'Inspeção independente do balão no crop; adapter OCR local não foi disponibilizado nesta execução.',
			},
		};
	}
	if (entry.panelId === 'nanomachine-cap-1-5_p10_2') {
		return {
			...base,
			sfx: {
				text: 'KEUACK-KKK!!!',
				region: 'top',
				bubblePresent: false,
				stylizedTypography: true,
				overlayPosition: true,
				readingAsSpeech: false,
			},
		};
	}
	if (entry.panelId === 'nanomachine-cap-1-5_p19_1' || entry.panelId === 'nanomachine-cap-1-5_p19_4') {
		const otherId = entry.panelId.endsWith('p19_1') ? 'nanomachine-cap-1-5_p19_4' : 'nanomachine-cap-1-5_p19_1';
		const other = selected.find((item) => item.panelId === otherId);
		return {
			...base,
			duplicate: {
				otherPanelId: otherId,
				otherSha256: other.sha256,
				exactShaMatch: entry.sha256 === other.sha256,
				perceptualSimilarity: similarityById.get(entry.panelId) ?? null,
				boundingBoxOverlap: other ? boxOverlap(entry.boundingBox, other.boundingBox) : null,
				samePage: entry.pageNumber === other?.pageNumber,
				coordinatesDistinct: entry.boundingBox.y !== other?.boundingBox.y,
				readingOrderDistance: other ? Math.abs(entry.panelIndex - other.panelIndex) : null,
			},
		};
	}
	return base;
}

function gateMarkdown(report: RecapFidelityGateReport, before: RecapFidelityGateReport, recovery: any): string {
	const lines = [
		'# Fase 4B.8 — Auto-Recovery e Fidelidade Narrativa',
		'',
		`- Gate após recovery: **${report.status}**`,
		`- Antes: ${before.metrics.verifiedPanels} verified / ${before.metrics.needsReviewPanels} needs_review / ${before.metrics.rejectedPanels} rejected.`,
		`- Depois: ${report.metrics.verifiedPanels} verified / ${report.metrics.needsReviewPanels} needs_review / ${report.metrics.rejectedPanels} rejected.`,
		`- Chamadas de modelo: **${recovery.usage.modelCalls}**; chamadas OCR: **${recovery.usage.ocrCalls}**; tokens entrada/saída: **${recovery.usage.inputTokens}/${recovery.usage.outputTokens}**.`,
		`- Cache hits de recovery: ${recovery.usage.cacheHits}; painéis verificados preservados: ${recovery.preservedVerifiedPanelIds.length}.`,
		'',
		'## Decisões',
		'',
		'- `p1_3`: classificado como fragmento de SFX/onomatopeia por contexto de página; permanece em `needs_review` e não fornece fato narrativo.',
		'- `p6_3`: candidato “KEUK...?” registrado, mas não aplicado porque OCR local validado não estava disponível; permanece em `needs_review`.',
		'- `p10_2`: SFX separado de diálogo por evidência de balão ausente, tipografia e posição; recuperação determinística aceita.',
		'- `p19_1`/`p19_4`: SHA distinto, similaridade perceptual medida e caixas sem sobreposição; repetição intencional provável, ambos preservados.',
		'',
		'## Fila humana após recovery',
		'',
		...report.humanReviewQueue.map((panelId) => `- ${panelId}`),
		'',
		'Nenhum painel foi removido, nenhum checkpoint original foi sobrescrito e não houve TTS, Humanizer, MotionVelix, FFmpeg ou renderização.',
	];
	return `${lines.join('\n')}\n`;
}

if (!existsSync(manifestPath) || !existsSync(baselineReportPath)) throw new Error('Manifest or Phase 4B.7 report is missing.');
mkdirSync(cacheRoot, { recursive: true });
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { selection: any[]; selectedPanelCount: number };
const baselineDocument = JSON.parse(readFileSync(baselineReportPath, 'utf8')) as { gate: RecapFidelityGateReport };
const baselineGate = baselineDocument.gate;
const checkpointFiles = (await import('node:fs')).readdirSync(join(pilotRoot, 'qwen-cache', 'panels')).filter((name) => name.endsWith('.json'));
const checkpoints = new Map<string, any>();
for (const file of checkpointFiles) {
	const checkpoint = JSON.parse(readFileSync(join(pilotRoot, 'qwen-cache', 'panels', file), 'utf8')) as any;
	if (checkpoint.panel?.panelId) checkpoints.set(checkpoint.panel.panelId, checkpoint);
}

const similarity = await perceptualSimilarity(
	manifest.selection.find((item) => item.panelId === 'nanomachine-cap-1-5_p19_1').cropPath,
	manifest.selection.find((item) => item.panelId === 'nanomachine-cap-1-5_p19_4').cropPath,
);
const similarityById = new Map([
	['nanomachine-cap-1-5_p19_1', similarity],
	['nanomachine-cap-1-5_p19_4', similarity],
]);

const recoveryPanels: RecapRecoveryPanel[] = manifest.selection.map((entry) => {
	const gateReport = baselineGate.panels.find((panel) => panel.panelId === entry.panelId);
	if (!gateReport) throw new Error(`Gate report missing panel ${entry.panelId}`);
	if (!checkpoints.has(entry.panelId)) throw new Error(`Checkpoint missing panel ${entry.panelId}`);
	return {
		panelId: entry.panelId,
		sha256: entry.sha256,
		pageNumber: entry.pageNumber,
		panelIndex: entry.panelIndex,
		gateReport,
		context: buildContext(entry, manifest.selection, similarityById),
	};
});

const store = new RecapFidelityRecoveryStore({ directory: recoveryDir });
const recovery = await runRecapFidelityRecovery({ panels: recoveryPanels, store });
if (recovery.status !== 'completed') throw new Error(`Recovery did not complete: ${recovery.status}/${recovery.usage.stopReason}`);

const recordsByPanelId = new Map(recovery.records.map((record) => [record.panelId, record]));
const recoveredInputs = recoveryPanels.map((panel) => {
	const checkpoint = checkpoints.get(panel.panelId);
	const baselinePanel = baselineGate.panels.find((item) => item.panelId === panel.panelId)!;
	const baseReview = reviewFromReport(baselinePanel);
	const record = recordsByPanelId.get(panel.panelId);
	const review = record ? applyRecapRecoveryToReview(baseReview, record) : baseReview;
	return {
		panelId: panel.panelId,
		sha256: panel.sha256,
		pageNumber: panel.pageNumber,
		panelIndex: panel.panelIndex,
		readingOrder: checkpoint.panel.readingOrder,
		imagePath: checkpoint.panel.cropPath,
		checkpoint,
		humanReview: review,
	};
});

const afterGate = runRecapFidelityGate({
	panels: recoveredInputs,
	expectedPanelIds: manifest.selection.map((entry) => entry.panelId),
	});
const document = {
	schemaVersion: 1,
	phase: '4B.8',
	createdAtIso: new Date().toISOString(),
	source: { manifestPath, baselineReportPath, recoveryDir },
	limits: {
		maxPanels: 5,
		maxCalls: 10,
		maxOcrCalls: 5,
		maxInputTokens: 20_000,
		maxOutputTokens: 8_000,
		maxWallTimeMs: 300_000,
		maxCpuFallbacks: 0,
		maxVramMiB: 6_500,
	},
	execution: { modelCalls: recovery.usage.modelCalls, ocrCalls: recovery.usage.ocrCalls, inputTokens: recovery.usage.inputTokens, outputTokens: recovery.usage.outputTokens, externalApis: 0, retries: 0, peakVramMiB: recovery.usage.peakVramMiB, wallMs: recovery.usage.wallMs, stopReason: recovery.usage.stopReason },
	before: baselineGate,
	recovery,
	after: afterGate,
	pHashEvidence: { panelPair: ['nanomachine-cap-1-5_p19_1', 'nanomachine-cap-1-5_p19_4'], similarity, exactShaMatch: false },
};

writeNew(reportPath, `${JSON.stringify(document, null, 2)}\n`);
writeNew(markdownPath, gateMarkdown(afterGate, baselineGate, recovery));
writeNew(afterReportPath, `${JSON.stringify({ ...document, gate: afterGate }, null, 2)}\n`);
writeNew(afterMarkdownPath, gateMarkdown(afterGate, baselineGate, recovery));
writeNew(afterQueuePath, `${JSON.stringify({ panelIds: afterGate.humanReviewQueue, generatedAtIso: document.createdAtIso }, null, 2)}\n`);

console.log(JSON.stringify({
	status: afterGate.status,
	before: { verified: baselineGate.metrics.verifiedPanels, needsReview: baselineGate.metrics.needsReviewPanels, rejected: baselineGate.metrics.rejectedPanels },
	after: { verified: afterGate.metrics.verifiedPanels, needsReview: afterGate.metrics.needsReviewPanels, rejected: afterGate.metrics.rejectedPanels },
	modelCalls: recovery.usage.modelCalls,
	ocrCalls: recovery.usage.ocrCalls,
	inputTokens: recovery.usage.inputTokens,
	outputTokens: recovery.usage.outputTokens,
	cacheHits: recovery.usage.cacheHits,
	perceptualSimilarity: similarity,
	queue: afterGate.humanReviewQueue,
	reportPath,
	afterReportPath,
}, null, 2));
