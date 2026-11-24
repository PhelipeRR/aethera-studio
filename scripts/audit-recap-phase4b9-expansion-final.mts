/** Final independent gate for all 20 new Phase 4B.9 panels. No inference is performed. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  RecapFidelityRecoveryStore,
  runRecapFidelityGate,
  runRecapFidelityRecovery,
  type RecapFidelityEvidence,
  type RecapFidelityIssue,
  type RecapFidelityPanelInput,
  type RecapRecoveryPanel,
} from '../packages/cinema/src/recap/index.js';

const root = resolve('.aethera-recap-data/phase4b9-qwen35-expansion-20261124');
const manifestPath = join(root, 'incremental-manifest-20.json');
const cacheRoot = join(root, 'qwen-cache-5');
const checkpointDir = join(cacheRoot, 'panels');
const ledgerPath = join(root, 'ledger-5.jsonl');
const reportDir = join(root, 'report-20');
const recoveryDir = join(reportDir, 'fidelity-recovery-v1');
const reportPath = join(reportDir, 'fidelity-gate-report-v1.json');
const markdownPath = join(reportDir, 'fidelity-gate-report-v1.md');
const queuePath = join(reportDir, 'fidelity-human-review-queue-v1.json');
const priorSummaryPath = join(root, 'report-15', 'pilot-run-summary.json');

function sha256(path: string): string { return createHash('sha256').update(readFileSync(path)).digest('hex'); }
function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, content, 'utf8');
  renameSync(temporary, path);
}
function ev(panelId: string, detail: string): RecapFidelityEvidence[] { return [{ source: 'image', detail, ref: panelId }]; }
function problem(panelId: string, code: RecapFidelityIssue['code'], severity: RecapFidelityIssue['severity'], detail: string): RecapFidelityIssue {
  return { code, severity, detail, evidence: ev(panelId, detail), blocksNarrativeFact: severity === 'major' || severity === 'critical' };
}

type Review = { status: 'verified' | 'needs_review'; detail: string; issues?: RecapFidelityIssue[] };
const reviews: Record<string, Review> = {
  'nanomachine-cap-1-5_p0_1': { status: 'verified', detail: 'Um jovem de roupas claras corre descalço em caminho de pedra numa floresta escura; sem texto.' },
  'nanomachine-cap-1-5_p0_2': { status: 'verified', detail: 'Close-up do jovem de cabelo roxo, ferido e gritando; linhas de movimento sustentam a reação, sem fala legível.' },
  'nanomachine-cap-1-5_p1_1': { status: 'needs_review', detail: 'Close-up de olho surpreso com o glifo !!! em balão serrilhado; reação visual não deve ser promovida como fala.', issues: [problem('nanomachine-cap-1-5_p1_1', 'SFX_AS_DIALOGUE', 'major', 'O glifo !!! foi persistido como visibleText/dialogue, mas a imagem só sustenta uma reação gráfica.') ] },
  'nanomachine-cap-1-5_p1_2': { status: 'verified', detail: 'A queda e o impacto correspondem à imagem; a recuperação determinística anterior separou EUAACK/ACK/ACCK como SFX, não diálogo.' },
  'nanomachine-cap-1-5_p1_4': { status: 'verified', detail: 'Personagem caído com roupa rasgada; os balões ...SHIT!! e I CAN’T MOVE... MY LEG ANYMORE...! correspondem ao crop.' },
  'nanomachine-cap-1-5_p2_1': { status: 'verified', detail: 'Punhos/joelhos no chão e balão DAMN IT ALL... visível; ação de exaustão é compatível.' },
  'nanomachine-cap-1-5_p2_2': { status: 'verified', detail: 'Figura central avança entre duas silhuetas e o balão ARE YOU TELLING ME.... está preservado.' },
  'nanomachine-cap-1-5_p2_4': { status: 'verified', detail: 'Close-up de personagem ferido com balão FUCK!; texto e expressão coincidem.' },
  'nanomachine-cap-1-5_p3_0': { status: 'verified', detail: 'Três figuras mascaradas, quatro balões e cenário noturno correspondem; nomes lidos nos balões não foram atribuídos como identidade visual.' },
  'nanomachine-cap-1-5_p3_2': { status: 'verified', detail: 'Jovem ferido, com lágrimas/suor, e três balões legíveis correspondem ao resultado persistido.' },
  'nanomachine-cap-1-5_p4_0': { status: 'verified', detail: 'Figura mascarada de olhos luminosos e balão longo sobre academia/artes marciais; descrição e texto correspondem.' },
  'nanomachine-cap-1-5_p4_3': { status: 'verified', detail: 'Balão isolado PEASANT BLOOD... THEY SAY...?; nenhum personagem ou ação foi inventado.' },
  'nanomachine-cap-1-5_p5_0': { status: 'verified', detail: 'Personagem segura dispositivo luminoso; os dois balões sobre morte e luta correspondem ao crop.' },
  'nanomachine-cap-1-5_p7_0': { status: 'needs_review', detail: 'Golpe e movimento estão corretos, mas o glifo coreano estilizado é SFX e foi persistido como KAAK! em diálogo.', issues: [problem('nanomachine-cap-1-5_p7_0', 'SFX_AS_DIALOGUE', 'major', 'SFX visível sobre o impacto não deve gerar fala.') ] },
  'nanomachine-cap-1-5_p7_3': { status: 'needs_review', detail: 'Mãos seguram objeto luminoso; há SFX coreano desenhado no canto que não foi transcrito, sem evidência de fala.', issues: [problem('nanomachine-cap-1-5_p7_3', 'OCR_INCOMPLETE', 'minor', 'SFX visual foi omitido do resultado textual; preservado como incerteza, não como diálogo.') ] },
  'nanomachine-cap-1-5_p8_1': { status: 'verified', detail: 'Três figuras mascaradas avançam com desfoque de movimento; os sinais vermelhos de reação estão descritos como efeito visual.' },
  'nanomachine-cap-1-5_p10_0': { status: 'verified', detail: 'Close-up de figura mascarada com balão JUST BECAUSE WE WENT EASY ON YOU...; texto e postura confrontativa correspondem.' },
  'nanomachine-cap-1-5_p11_4': { status: 'needs_review', detail: 'Perfil de figura mascarada e SFX coreano visível; a ação principal está correta, mas o SFX não foi preservado como texto.', issues: [problem('nanomachine-cap-1-5_p11_4', 'OCR_INCOMPLETE', 'minor', 'SFX visual omitido; não há fala inventada, mas a cobertura textual é incompleta.') ] },
  'nanomachine-cap-1-5_p13_3': { status: 'needs_review', detail: 'Figura mascarada em movimento com !! em globo de reação; o glifo não deve virar diálogo literal.', issues: [problem('nanomachine-cap-1-5_p13_3', 'SFX_AS_DIALOGUE', 'major', 'Reação gráfica !! foi persistida como visibleText/dialogue.') ] },
  'nanomachine-cap-1-5_p16_2': { status: 'verified', detail: 'Painel alto: desaparecimento, destroços, reação do observador e quatro balões foram recuperados em ordem, sem personagem nomeado por texto.' },
};

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { selection: any[]; selectedPanelCount: number };
const checkpoints = new Map<string, any>();
for (const file of readdirSync(checkpointDir).filter((name) => name.endsWith('.json'))) {
  const checkpoint = JSON.parse(readFileSync(join(checkpointDir, file), 'utf8')) as any;
  if (checkpoint.panel?.panelId) checkpoints.set(checkpoint.panel.panelId, checkpoint);
}
const inputs: RecapFidelityPanelInput[] = manifest.selection.map((entry) => {
  const checkpoint = checkpoints.get(entry.panelId);
  const review = reviews[entry.panelId];
  if (!checkpoint || !review) throw new Error(`Painel/checkpoint sem revisão: ${entry.panelId}`);
  if (sha256(entry.cropPath) !== entry.sha256 || checkpoint.panel?.sha256 !== entry.sha256) throw new Error(`SHA divergente: ${entry.panelId}`);
  return { panelId: entry.panelId, sha256: entry.sha256, pageNumber: entry.pageNumber, panelIndex: entry.panelIndex, readingOrder: entry.readingOrder, imagePath: entry.cropPath, checkpoint, humanReview: { status: review.status, evidence: ev(entry.panelId, review.detail), issues: review.issues ?? [] } };
});
if (inputs.length !== 20) throw new Error(`Esperados 20 painéis, encontrados ${inputs.length}.`);
const before = runRecapFidelityGate({ panels: inputs, expectedPanelIds: inputs.map((panel) => panel.panelId) });

const pending: RecapRecoveryPanel[] = inputs.filter((panel) => panel.humanReview?.status !== 'verified').map((panel) => ({
  panelId: panel.panelId, sha256: panel.sha256 ?? null, pageNumber: panel.pageNumber ?? 0, panelIndex: panel.panelIndex ?? 0,
  gateReport: before.panels.find((item) => item.panelId === panel.panelId)!, context: { cropPath: panel.imagePath },
}));
const recovery = await runRecapFidelityRecovery({
  panels: pending,
  store: new RecapFidelityRecoveryStore({ directory: recoveryDir }),
  budget: { maxPanels: 5, maxCalls: 5, maxOcrCalls: 0, maxInputTokens: 0, maxOutputTokens: 0, maxWallTimeMs: 300_000, maxAttemptsPerPanel: 1, maxCpuFallbacks: 0, maxVramMiB: 6_500 },
});
// No pending item has enough deterministic evidence without an explicit SFX/fragment context;
// unresolved recovery records therefore remain needs_review and are not force-promoted.
if (recovery.records.some((record) => record.status === 'resolved')) throw new Error('A final audit recovery unexpectedly promoted a panel without evidence.');
const after = before;

const budgetEvents = readFileSync(ledgerPath, 'utf8').split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line) as any).filter((event) => event.budgetVersion === 'recap-pilot-budget-v2');
const reservations = budgetEvents.filter((event) => event.status === 'reserved');
const settled = budgetEvents.filter((event) => event.status === 'settled');
const sumKnown = (field: 'inputTokens' | 'outputTokens') => settled.every((event) => typeof event[field] === 'number') ? settled.reduce((sum, event) => sum + event[field], 0) : null;
const peak = settled.map((event) => event.vramMb).filter((value): value is number => typeof value === 'number').reduce((max, value) => Math.max(max, value), 0) || null;
const priorSummary = existsSync(priorSummaryPath) ? JSON.parse(readFileSync(priorSummaryPath, 'utf8')) as any : null;
const metrics = { panels: inputs.length, blocks: priorSummary?.budget?.blocks ?? null, calls: reservations.length, analysisCalls: reservations.filter((event) => event.kind === 'analysis').length, ocrCalls: reservations.filter((event) => event.kind === 'ocr').length, inputTokens: sumKnown('inputTokens'), outputTokens: sumKnown('outputTokens'), cacheHits: 0, cpuFallbacks: priorSummary?.budget?.cpuFallbacks ?? null, peakVramMiB: peak, wallTimeMs: priorSummary?.budget?.wallTimeMs ?? null, blockedCalls: budgetEvents.filter((event) => event.status === 'blocked').length, retries: 0, externalApis: 0 };
const report = { schemaVersion: 1, phase: '4B.9.final-expansion-audit', createdAtIso: new Date().toISOString(), source: { manifestPath, cacheRoot, ledgerPath, recoveryDir }, execution: metrics, before, recovery, after, decision: after.metrics.needsReviewPanels === 0 && after.metrics.rejectedPanels === 0 ? 'expansion_passed' : 'expansion_completed_with_review_queue' };
for (const path of [reportPath, markdownPath, queuePath]) if (existsSync(path)) throw new Error(`Recusando sobrescrever artefato: ${path}`);
atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
atomicWrite(queuePath, `${JSON.stringify({ panelIds: after.humanReviewQueue, generatedAtIso: report.createdAtIso }, null, 2)}\n`);
const lines = ['# Fase 4B.9 — Auditoria final dos 20 painéis', '', `- Gate: **${after.status}**; decisão: **${report.decision}**.`, `- Painéis: ${metrics.panels}; verified: ${after.metrics.verifiedPanels}; needs_review: ${after.metrics.needsReviewPanels}; rejected: ${after.metrics.rejectedPanels}; unverified: ${after.metrics.unverifiedPanels}.`, `- Chamadas reais: ${metrics.calls} (${metrics.analysisCalls} visão + ${metrics.ocrCalls} OCR Qwen); tokens medidos: ${metrics.inputTokens}/${metrics.outputTokens}; cache hits: ${metrics.cacheHits}; fallback CPU: ${metrics.cpuFallbacks}; pico VRAM: ${metrics.peakVramMiB} MiB; wall time cumulativo: ${metrics.wallTimeMs} ms.`, '', '| Painel | Status | Elegibilidade | Achado independente |', '|---|---|---|---|'];
for (const panel of after.panels) lines.push(`| ${panel.panelId} | ${panel.status} | ${panel.eligibility} | ${(reviews[panel.panelId]?.detail ?? '').replace(/\|/gu, '\\|')} |`);
lines.push('', '## Pendências', '', '- SFX gráficos de p1_1, p7_0 e p13_3 permanecem fora dos fatos narrativos até uma regra/adapter determinístico com evidência de proveniência.', '- SFX não transcritos de p7_3 e p11_4 permanecem como `needs_review`; nenhum diálogo foi inventado.', '- A recuperação automática foi executada sem inferência; não houve correção segura adicional para esses casos.', '', '## Escopo excluído', '', '- Não foram reprocessados os 40 painéis anteriores.', '- Não houve API externa, retry, TTS, Humanizer, MotionVelix, FFmpeg, renderização ou Story Engine.', '');
atomicWrite(markdownPath, `${lines.join('\n')}\n`);
console.log(JSON.stringify({ decision: report.decision, status: after.status, metrics, reviewQueue: after.humanReviewQueue, reportPath }, null, 2));
