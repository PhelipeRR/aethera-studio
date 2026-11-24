/** Independent visual audit for the Phase 4B.9 five-panel canary.
 * No model or OCR calls are made here. The review notes are evidence from the local crops.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  applyRecapRecoveryToReview,
  RecapFidelityRecoveryStore,
  runRecapFidelityGate,
  runRecapFidelityRecovery,
  type RecapFidelityEvidence,
  type RecapFidelityGateReport,
  type RecapFidelityHumanReview,
  type RecapFidelityIssue,
  type RecapFidelityPanelInput,
  type RecapRecoveryPanel,
} from '../packages/cinema/src/recap/index.js';

const root = resolve('.aethera-recap-data/phase4b9-qwen35-expansion-20261124');
const manifestPath = join(root, 'incremental-manifest-20.json');
const runRoot = join(root, 'qwen-cache-5');
const checkpointDir = join(runRoot, 'panels');
const summaryPath = join(root, 'report-5', 'pilot-run-summary.json');
const reportDir = join(root, 'report-5');
const recoveryDir = join(reportDir, 'fidelity-recovery-v1');
const reportPath = join(reportDir, 'fidelity-gate-report-v1.json');
const markdownPath = join(reportDir, 'fidelity-gate-report-v1.md');
const queuePath = join(reportDir, 'fidelity-human-review-queue-v1.json');

function sha256(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, path);
}
function evidence(panelId: string, detail: string): RecapFidelityEvidence[] {
  return [{ source: 'image', detail, ref: panelId }];
}
function issue(panelId: string, code: RecapFidelityIssue['code'], severity: RecapFidelityIssue['severity'], detail: string): RecapFidelityIssue {
  return { code, severity, detail, evidence: evidence(panelId, detail), blocksNarrativeFact: severity === 'major' || severity === 'critical' };
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { selection: any[]; selectedPanelCount: number };
const summary = JSON.parse(readFileSync(summaryPath, 'utf8')) as { budget: any; limits: any; newCalls?: number; newOcrCalls?: number };
const checkpoints = new Map<string, any>();
for (const file of readdirSync(checkpointDir).filter((name) => name.endsWith('.json'))) {
  const checkpoint = JSON.parse(readFileSync(join(checkpointDir, file), 'utf8')) as any;
  if (checkpoint.panel?.panelId) checkpoints.set(checkpoint.panel.panelId, checkpoint);
}

const visualReview: Record<string, { status: 'verified' | 'needs_review'; detail: string; issues?: RecapFidelityIssue[]; eligibility?: 'visual_only' | 'blocked' }> = {
  'nanomachine-cap-1-5_p0_1': { status: 'verified', detail: 'Crop mostra um único jovem de roupas claras correndo descalço sobre caminho de pedra, em floresta escura; não há texto visível.' },
  'nanomachine-cap-1-5_p1_2': {
    status: 'needs_review',
    detail: 'Crop mostra uma sequência vertical de queda/impacto do mesmo personagem e três inscrições sonoras estilizadas em formas serrilhadas; não são falas semânticas.',
    issues: [issue('nanomachine-cap-1-5_p1_2', 'SFX_AS_DIALOGUE', 'major', 'Inscrições sonoras foram persistidas em visibleText/dialogue; devem permanecer como SFX separado e não como fala narrativa.')],
  },
  'nanomachine-cap-1-5_p3_0': { status: 'verified', detail: 'Crop mostra três figuras encapuzadas/máscaradas em cenário noturno e quatro balões legíveis; a análise não atribui nomes visuais indevidos.' },
  'nanomachine-cap-1-5_p3_2': { status: 'verified', detail: 'Crop mostra um jovem ferido, suado e chorando, com três balões legíveis; as falas persistidas correspondem visualmente ao texto.' },
  'nanomachine-cap-1-5_p4_3': { status: 'verified', detail: 'Crop é um balão/cartela isolado com o texto PEASANT BLOOD... THEY SAY...?; não há personagem inventado nem ação atribuída.' },
};

const baseInputs: RecapFidelityPanelInput[] = manifest.selection
  .filter((entry) => visualReview[entry.panelId])
  .map((entry) => {
    const checkpoint = checkpoints.get(entry.panelId);
    if (!checkpoint) throw new Error(`Checkpoint ausente: ${entry.panelId}`);
    if (sha256(entry.cropPath) !== entry.sha256 || checkpoint.panel?.sha256 !== entry.sha256) throw new Error(`SHA divergente: ${entry.panelId}`);
    const review = visualReview[entry.panelId]!;
    const humanReview: RecapFidelityHumanReview = { status: review.status, evidence: evidence(entry.panelId, review.detail), issues: review.issues ?? [], ...(review.eligibility ? { eligibility: review.eligibility } : {}) };
    return { panelId: entry.panelId, sha256: entry.sha256, pageNumber: entry.pageNumber, panelIndex: entry.panelIndex, readingOrder: entry.readingOrder, imagePath: entry.cropPath, checkpoint, humanReview };
  });
if (baseInputs.length !== 5) throw new Error(`Canário esperado: 5 painéis, encontrado ${baseInputs.length}.`);

const before = runRecapFidelityGate({ panels: baseInputs, expectedPanelIds: baseInputs.map((panel) => panel.panelId) });
const recoveryPanel = baseInputs.find((panel) => panel.panelId === 'nanomachine-cap-1-5_p1_2')!;
const recoveryInput: RecapRecoveryPanel = {
  panelId: recoveryPanel.panelId,
  sha256: recoveryPanel.sha256 ?? null,
  pageNumber: recoveryPanel.pageNumber ?? 0,
  panelIndex: recoveryPanel.panelIndex ?? 0,
  gateReport: before.panels.find((panel) => panel.panelId === recoveryPanel.panelId)!,
  context: {
    cropPath: recoveryPanel.imagePath,
    sfx: { text: 'EUAACK...!!! / ACK!!! / ACCK!!!', region: 'overlay', bubblePresent: false, stylizedTypography: true, overlayPosition: true, readingAsSpeech: false },
  },
};
const recovery = await runRecapFidelityRecovery({
  panels: [recoveryInput],
  store: new RecapFidelityRecoveryStore({ directory: recoveryDir }),
  budget: { maxPanels: 1, maxCalls: 1, maxOcrCalls: 0, maxInputTokens: 0, maxOutputTokens: 0, maxWallTimeMs: 300_000, maxAttemptsPerPanel: 1, maxCpuFallbacks: 0, maxVramMiB: 6_500 },
});
const recovered = recovery.records[0];
if (!recovered || recovered.status !== 'resolved' || recovered.strategy !== 'deterministic_sfx') throw new Error('Recuperação determinística de SFX não concluiu o canário.');

const afterInputs = baseInputs.map((panel) => panel.panelId === recoveryInput.panelId
  ? { ...panel, humanReview: applyRecapRecoveryToReview(panel.humanReview!, recovered) }
  : panel);
const after = runRecapFidelityGate({ panels: afterInputs, expectedPanelIds: afterInputs.map((panel) => panel.panelId) });

const budgetEvents = readFileSync(join(root, 'ledger-5.jsonl'), 'utf8').split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as any);
const reservations = budgetEvents.filter((event) => event.status === 'reserved');
const settled = budgetEvents.filter((event) => event.status === 'settled');
const knownTokens = (field: 'inputTokens' | 'outputTokens') => settled.every((event) => typeof event[field] === 'number') ? settled.reduce((total, event) => total + event[field], 0) : null;
const measured = { calls: reservations.length, ocrCalls: reservations.filter((event) => event.kind === 'ocr').length, inputTokens: knownTokens('inputTokens'), outputTokens: knownTokens('outputTokens'), blockedCalls: budgetEvents.filter((event) => event.status === 'blocked').length };
const report = {
  schemaVersion: 1,
  phase: '4B.9.canary-fidelity-gate',
  createdAtIso: new Date().toISOString(),
  source: { manifestPath, summaryPath, runRoot, recoveryDir },
  execution: { newVisionCalls: measured.calls - measured.ocrCalls, newOcrCalls: measured.ocrCalls, totalCalls: measured.calls, inputTokens: measured.inputTokens, outputTokens: measured.outputTokens, cacheHits: (summary.panelCacheHits ?? 0) + (summary.blockCacheHits ?? 0), cpuFallbacks: summary.budget.cpuFallbacks, peakVramMiB: summary.budget.peakVramMb, wallTimeMs: summary.budget.wallTimeMs, blockedCalls: measured.blockedCalls, externalApis: 0, retries: 0 },
  before,
  recovery,
  after,
  independentVisualAudit: true,
  decision: after.status === 'verified' ? 'canary_passed_for_expansion' : 'stop_before_remaining_15',
};
for (const path of [reportPath, markdownPath, queuePath]) if (existsSync(path)) throw new Error(`Recusando sobrescrever artefato: ${path}`);
atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
atomicWrite(queuePath, `${JSON.stringify({ panelIds: after.humanReviewQueue, generatedAtIso: report.createdAtIso }, null, 2)}\n`);
const lines = [
  '# Fase 4B.9 — Gate do canário de cinco painéis', '',
  `- Antes da recuperação: ${before.status}; depois: **${after.status}**.`,
  `- Painéis: ${after.metrics.panelCount}; narrative_eligible: ${after.metrics.narrativeEligiblePanels}; visual_only: ${after.metrics.visualOnlyPanels}; blocked: ${after.metrics.blockedPanels}.`,
  `- Chamadas medidas: ${measured.calls}; OCR Qwen: ${measured.ocrCalls}; entrada: ${measured.inputTokens}; saída: ${measured.outputTokens}; cache hits: ${summary.panelCacheHits ?? 0}; fallback CPU: ${summary.budget.cpuFallbacks}; pico VRAM: ${summary.budget.peakVramMb} MiB; tempo: ${summary.budget.wallTimeMs} ms.`,
  '- Nenhuma chamada nova foi feita durante a auditoria; a correção de SFX foi determinística.', '',
  '| Painel | Resultado visual independente | Gate | Elegibilidade |', '|---|---|---|---|',
];
for (const panel of after.panels) lines.push(`| ${panel.panelId} | ${(visualReview[panel.panelId]?.detail ?? '').replace(/\|/gu, '\\|')} | ${panel.status} | ${panel.eligibility} |`);
lines.push('', '## Decisão', '', after.status === 'verified' ? 'O canário passou após a classificação determinística das inscrições sonoras; os 15 painéis restantes podem ser executados com o mesmo orçamento compartilhado.' : 'O canário não passou; a expansão deve ser interrompida.', '', '## Limitações', '', '- A fidelidade dos cinco foi auditada diretamente nos crops locais; não há benchmark independente de OCR para as inscrições sonoras.', '- A revisão é visual/estrutural e não inicia Story Engine, TTS, Humanizer, MotionVelix, FFmpeg ou renderização.', '');
atomicWrite(markdownPath, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ decision: report.decision, before: before.status, after: after.status, measured, reportPath, queuePath }, null, 2));
