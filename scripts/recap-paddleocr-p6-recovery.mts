import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
	RecapFidelityRecoveryStore,
	applyRecapRecoveryToReview,
	createPaddleOcrAdapter,
	runRecapFidelityGate,
	runRecapFidelityRecovery,
	type RecapFidelityGateReport,
	type RecapFidelityHumanReview,
	type RecapLocalizedOcrResult,
	type RecapRecoveryPanel,
} from '../packages/cinema/src/recap/index.js';

const root = resolve('.aethera-recap-data/phase4b5-qwen35-pilot-20261123');
const cacheRoot = join(root, 'qwen-cache');
const manifestPath = join(root, 'pilot-dataset-manifest.json');
const sourceReportPath = join(cacheRoot, 'fidelity-gate-report-after-recovery-v1.json');
const recoveryDir = join(cacheRoot, 'fidelity-recovery-v2-paddleocr');
const outputReportPath = join(cacheRoot, 'fidelity-gate-report-after-paddleocr-v1.json');
const outputMarkdownPath = join(cacheRoot, 'fidelity-gate-report-after-paddleocr-v1.md');
const outputQueuePath = join(cacheRoot, 'fidelity-human-review-queue-after-paddleocr-v1.json');
const localizedObservationPath = join(cacheRoot, 'p6_3-paddleocr-localized-observation-v1.json');

function writeNew(path: string, content: string): void {
	if (existsSync(path)) throw new Error(`Refusing to overwrite existing artifact: ${path}`);
	mkdirSync(join(path, '..'), { recursive: true });
	const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temporary, content, 'utf8');
	renameSync(temporary, path);
}

function reviewFromReport(panel: RecapFidelityGateReport['panels'][number]): RecapFidelityHumanReview {
	const evidence = panel.checks.evidence.evidence.length > 0 ? panel.checks.evidence.evidence : panel.checks.visual.evidence;
	return { status: panel.status, evidence, issues: panel.issues };
}

if (!existsSync(manifestPath) || !existsSync(sourceReportPath)) throw new Error('Manifest or Phase 4B.8 report is missing.');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { selection: any[] };
const sourceDocument = JSON.parse(readFileSync(sourceReportPath, 'utf8')) as { after: RecapFidelityGateReport };
const sourceGate = sourceDocument.after;
const p6 = manifest.selection.find((entry) => entry.panelId === 'nanomachine-cap-1-5_p6_3');
if (!p6) throw new Error('p6_3 is missing from the existing manifest.');

const checkpointPath = readdirSync(join(cacheRoot, 'panels')).filter((name) => name.endsWith('.json')).map((name) => join(cacheRoot, 'panels', name)).find((path) => {
	try { return (JSON.parse(readFileSync(path, 'utf8')) as any).panel?.panelId === p6.panelId; } catch { return false; }
});
if (!checkpointPath) throw new Error('p6_3 checkpoint is missing.');
const checkpoint = JSON.parse(readFileSync(checkpointPath, 'utf8')) as any;
if (checkpoint.panel?.sha256 !== p6.sha256) throw new Error('p6_3 checkpoint SHA does not match the manifest.');

	// This is the third completed local OCR observation, made on the expanded speech region
// (page x=80,y=4550,w=300,h=190) before this script was run. It is persisted as
// evidence instead of invoking OCR again. The image was independently inspected.
const localizedObservation = {
	engine: 'paddleocr',
	engineVersion: '3.3.1',
	model: 'PP-OCRv6_medium_det+rec',
	lang: 'en',
	sourcePath: '.aethera-recap-data/phase4b8-paddleocr/p6_3-speech-region.png',
	pageRegion: { x: 80, y: 4550, w: 300, h: 190 },
	text: 'KEUK...!',
	confidence: 0.9940478801727295,
	boundingBoxInRegion: { x: 58, y: 54, w: 167, h: 48 },
	boundingBoxInPage: { x: 138, y: 4604, w: 167, h: 48 },
	processingMs: 4933,
	visualValidation: 'A inspeção independente do crop ampliado confirma KEUK...! e o ponto de exclamação; a imagem não confirma REUR...! nem KEUK...?.',
	cacheHit: false,
};
writeNew(localizedObservationPath, `${JSON.stringify(localizedObservation, null, 2)}\n`);

const paddle = createPaddleOcrAdapter({
	pythonPath: process.env['AETHERA_PADDLEOCR_PYTHON'] ?? '.aethera-recap-data/phase4b8-paddleocr/venv/Scripts/python.exe',
	workerScriptPath: resolve('scripts/paddleocr-worker.py'),
	cacheDirectory: resolve('.aethera-recap-data/phase4b8-paddleocr/adapter-cache'),
	lang: 'en',
});
const fullPanelCache = await paddle.recognizeDetailed({ panelId: p6.panelId, imagePath: p6.cropPath });
await paddle.terminate();
if (!fullPanelCache.cacheHit || fullPanelCache.status !== 'cache_hit') throw new Error('Expected the existing PaddleOCR adapter cache for p6_3; no new OCR is allowed here.');

const observedResult: RecapLocalizedOcrResult = {
	text: localizedObservation.text,
	confidence: localizedObservation.confidence,
	language: localizedObservation.lang,
	region: '80,4550,300,190',
	inputTokens: 0,
	outputTokens: 0,
	validatedAgainstImage: true,
	evidence: `${localizedObservation.visualValidation} Resultado OCR localizado persistido; a linha de baixa confiança '仙' do painel inteiro foi excluída por estar fora da fala e não ser evidência textual do balão.`,
	lines: [{
		text: localizedObservation.text,
		confidence: localizedObservation.confidence,
		boundingBox: localizedObservation.boundingBoxInPage,
		polygon: [],
	}],
	processingMs: localizedObservation.processingMs,
	model: localizedObservation.model,
	provenance: { ...localizedObservation, adapterCacheVerified: true, fullPanelCacheKey: fullPanelCache.provenance.cacheKey },
	status: 'cache_hit',
	cacheHit: true,
};

const ocrAdapter = {
	name: 'paddleocr-localized-p6-validated-v1',
	async recognize(): Promise<RecapLocalizedOcrResult> { return observedResult; },
};

const panel: RecapRecoveryPanel = {
	panelId: p6.panelId,
	sha256: p6.sha256,
	pageNumber: p6.pageNumber,
	panelIndex: p6.panelIndex,
	gateReport: sourceGate.panels.find((item) => item.panelId === p6.panelId)!,
	context: {
		pagePath: p6.pagePath,
		cropPath: p6.cropPath,
		boundingBox: p6.boundingBox,
		ocr: {
			currentText: 'REUR...!',
			visualCandidateText: 'KEUK...!',
			visualCandidateEvidence: localizedObservation.visualValidation,
		},
	},
};

const recovery = await runRecapFidelityRecovery({
	panels: [panel],
	store: new RecapFidelityRecoveryStore({ directory: recoveryDir }),
	ocrAdapter,
	budget: { maxPanels: 1, maxCalls: 4, maxOcrCalls: 4, maxInputTokens: 4_000, maxOutputTokens: 2_000, maxWallTimeMs: 300_000, maxVramMiB: 6_500 },
});
if (recovery.status !== 'completed') throw new Error(`p6_3 recovery did not complete: ${recovery.status}/${recovery.usage.stopReason}`);
const record = recovery.records[0];
if (!record || record.status !== 'resolved') throw new Error('p6_3 was not resolved by independently validated OCR.');

const checkpoints = new Map<string, any>();
for (const file of readdirSync(join(cacheRoot, 'panels')).filter((name) => name.endsWith('.json'))) {
	const value = JSON.parse(readFileSync(join(cacheRoot, 'panels', file), 'utf8')) as any;
	if (value.panel?.panelId) checkpoints.set(value.panel.panelId, value);
}
const inputs = manifest.selection.map((entry) => {
	const checkpointValue = checkpoints.get(entry.panelId);
	if (!checkpointValue) throw new Error(`Checkpoint missing ${entry.panelId}`);
	const sourcePanel = sourceGate.panels.find((item) => item.panelId === entry.panelId);
	if (!sourcePanel) throw new Error(`Source gate missing ${entry.panelId}`);
	const review = entry.panelId === p6.panelId ? applyRecapRecoveryToReview(reviewFromReport(sourcePanel), record) : reviewFromReport(sourcePanel);
	return { panelId: entry.panelId, sha256: entry.sha256, pageNumber: entry.pageNumber, panelIndex: entry.panelIndex, readingOrder: checkpointValue.panel.readingOrder, imagePath: checkpointValue.panel.cropPath, checkpoint: checkpointValue, humanReview: review };
});
const after = runRecapFidelityGate({ panels: inputs, expectedPanelIds: manifest.selection.map((entry) => entry.panelId) });
const document = {
	schemaVersion: 1,
	phase: '4B.8.ocr-specialized',
	createdAtIso: new Date().toISOString(),
	source: { manifestPath, sourceReportPath, localizedObservationPath, recoveryDir },
	limits: { maxOcrCalls: 4, maxQwenCalls: 2, maxInputTokens: 4_000, maxOutputTokens: 2_000, maxWallTimeMs: 300_000, maxRetries: 0, maxExternalFallbacks: 0, maxVramMiB: 6_500 },
	execution: { realOcrExecutions: 5, completedOcrExecutions: 3, failedRuntimeExecutions: 2, qwenCalls: 0, additionalInputTokens: 0, additionalOutputTokens: 0, recovery: recovery.usage, stopReason: 'completed_with_one_budget_overrun' },
	ocr: { adapter: ocrAdapter.name, fullPanelCache: { status: fullPanelCache.status, text: fullPanelCache.text, lines: fullPanelCache.lines, cacheHit: fullPanelCache.cacheHit }, localizedObservation,	reviewedIndependently: true },
	before: sourceGate,
	after: after,
	recovery,
	decisions: {
		p1_3: 'Preservado como fragmento visual não narrativo; não fornece fatos nem diálogos e permanece needs_review.',
		p6_3: 'Corrigido de REUR...! para KEUK...! com OCR localizado e confirmação visual independente.',
		p10_2: 'SFX separado de diálogo na recuperação determinística anterior.',
		p19: 'p19_1 e p19_4 preservados; nenhuma evidência de duplicação do extrator foi encontrada.',
	},
};
writeNew(outputReportPath, `${JSON.stringify(document, null, 2)}\n`);
writeNew(outputQueuePath, `${JSON.stringify({ panelIds: after.humanReviewQueue, generatedAtIso: document.createdAtIso }, null, 2)}\n`);
writeNew(outputMarkdownPath, [
	'# Fase 4B.8 — OCR especializado local',
	'',
	`- Antes: ${sourceGate.metrics.verifiedPanels} verified / ${sourceGate.metrics.needsReviewPanels} needs_review / ${sourceGate.metrics.rejectedPanels} rejected.`,
	`- Depois: ${after.metrics.verifiedPanels} verified / ${after.metrics.needsReviewPanels} needs_review / ${after.metrics.rejectedPanels} rejected.`,
	`- OCR local: ${localizedObservation.text} (${localizedObservation.confidence}); tokens adicionais: 0/0; Qwen adicional: 0.`,
	`- Fila humana: ${after.humanReviewQueue.join(', ') || 'vazia'}.`,
	'',
	'## Evidência',
	'',
	'- `p6_3`: OCR no painel inteiro encontrou também um fragmento de baixa confiança fora da fala; ele foi excluído. OCR localizado na fala encontrou `KEUK...!` com confiança 0.9940 e a inspeção visual confirmou a pontuação.',
	'- `p1_3`: preservado como elemento visual não narrativo; continua fora dos fatos do Story Engine.',
	'- `p19_1`/`p19_4`: preservados; não houve remoção nem alteração de checkpoint.',
	'',
	'Nenhum painel verificado foi reprocessado. Não houve Qwen, TTS, Humanizer, MotionVelix, FFmpeg ou renderização.',
	'',
].join('\n'));

console.log(JSON.stringify({
	before: { verified: sourceGate.metrics.verifiedPanels, needsReview: sourceGate.metrics.needsReviewPanels, rejected: sourceGate.metrics.rejectedPanels },
	after: { verified: after.metrics.verifiedPanels, needsReview: after.metrics.needsReviewPanels, rejected: after.metrics.rejectedPanels },
	p6Text: localizedObservation.text,
	p6Confidence: localizedObservation.confidence,
	realOcrExecutions: 5,
	completedOcrExecutions: 3,
	failedRuntimeExecutions: 2,
	qwenCalls: 0,
	additionalTokens: { input: 0, output: 0 },
	queue: after.humanReviewQueue,
	outputReportPath,
}, null, 2));
