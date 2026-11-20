import type { ExtractedPanel, GateFPanelIntegrityInput } from './recap-types.js';

export type GateFVerdict = 'pass' | 'needs_review' | 'fail';

export interface GateFRepairHint {
 panelId: string;
 issueCode:
 | 'illegible_text'
 | 'truncated_panel'
 | 'duplicate_panel'
 | 'panel_order_violation'
 | 'missing_text_evidence'
 | 'ocr_failed'
 | 'ocr_not_run_on_dialogue'
 | 'crop_failed';
 detail: string;
}

export interface GateFReport {
 gate: 'F_panel_integrity';
 verdict: GateFVerdict;
 checkedAtIso: string;
 reasons: string[];
 metrics: Record<string, number | string | boolean>;
 repairHints: GateFRepairHint[];
}

/**
 * Gate F — Panel Integrity (Revised Phase 1)
 *
 * Validates semantic evidence using explicit ocrStatus:
 * - ocrStatus === 'failed' → needs_review (OCR attempted but errored)
 * - ocrStatus === 'success' && confidence < threshold → needs_review (illegible)
 * - ocrStatus === 'not_run' on dialogue panels → needs_review (no evidence)
 * - Duplicate consecutive panels (same image hash) → needs_review
 * - Panel order violations within a page → fail
 * - Zero-area bounding boxes → fail
 *
 * Insufficient evidence NEVER produces automatic pass.
 */
export function runGateFPanelIntegrity(input: GateFPanelIntegrityInput): GateFReport {
 const { panels, minOcrConfidence } = input;
 const reasons: string[] = [];
 const repairHints: GateFRepairHint[] = [];

 if (panels.length === 0) {
 return {
 gate: 'F_panel_integrity',
 verdict: 'fail',
 checkedAtIso: new Date().toISOString(),
 reasons: ['Nenhum painel extraído para validação.'],
 metrics: { panelCount: 0 },
 repairHints: [],
 };
 }

 // 1. OCR failures
 let ocrFailedCount = 0;
 for (const panel of panels) {
 if (panel.metadata.ocrStatus === 'failed') {
 ocrFailedCount++;
 repairHints.push({
 panelId: panel.panelId,
 issueCode: 'ocr_failed',
 detail: `OCR execution failed: ${panel.metadata.ocrError ?? 'unknown error'}`,
 });
 }
 }
 if (ocrFailedCount > 0) {
 reasons.push(`${ocrFailedCount} painel(is) com falha na execução do OCR.`);
 }

 // 2. Illegible text (OCR succeeded but below threshold)
 let illegibleCount = 0;
 for (const panel of panels) {
 if (
 panel.metadata.ocrStatus === 'success' &&
 panel.metadata.ocrConfidence < minOcrConfidence
 ) {
 illegibleCount++;
 repairHints.push({
 panelId: panel.panelId,
 issueCode: 'illegible_text',
 detail: `OCR confidence ${panel.metadata.ocrConfidence.toFixed(2)} below threshold ${minOcrConfidence}.`,
 });
 }
 }
 if (illegibleCount > 0) {
 reasons.push(`${illegibleCount} painel(is) com texto ilegível (OCR abaixo de ${minOcrConfidence}).`);
 }

 // 3. Dialogue panels without OCR evidence
 let missingTextEvidence = 0;
 for (const panel of panels) {
 if (panel.metadata.classification === 'dialogue') {
 if (panel.metadata.ocrStatus === 'not_run') {
 missingTextEvidence++;
 repairHints.push({
 panelId: panel.panelId,
 issueCode: 'ocr_not_run_on_dialogue',
 detail: `Panel classified as 'dialogue' but OCR was not executed. Cannot verify textual evidence.`,
 });
 } else if (
 panel.metadata.ocrStatus === 'success' &&
 (!panel.metadata.textContent || panel.metadata.textContent.trim().length === 0)
 ) {
 missingTextEvidence++;
 repairHints.push({
 panelId: panel.panelId,
 issueCode: 'missing_text_evidence',
 detail: `Panel classified as 'dialogue' with successful OCR but no text extracted.`,
 });
 }
 }
 }
 if (missingTextEvidence > 0) {
 reasons.push(`${missingTextEvidence} painel(is) de diálogo sem evidência textual verificada.`);
 }

 // 4. Duplicate consecutive panels
 let duplicateCount = 0;
 for (let i = 1; i < panels.length; i++) {
 const current = panels[i]!;
 const previous = panels[i - 1]!;
 if (current.imageHash === previous.imageHash) {
 duplicateCount++;
 repairHints.push({
 panelId: current.panelId,
 issueCode: 'duplicate_panel',
 detail: `Duplicate image hash as previous panel ${previous.panelId}.`,
 });
 }
 }
 if (duplicateCount > 0) {
 reasons.push(`${duplicateCount} painel(is) duplicado(s) consecutivamente.`);
 }

 // 5. Panel order violations within pages
 let orderViolations = 0;
 const panelsByPage = new Map<number, ExtractedPanel[]>();
 for (const panel of panels) {
 const pagePanels = panelsByPage.get(panel.metadata.pageNumber) ?? [];
 pagePanels.push(panel);
 panelsByPage.set(panel.metadata.pageNumber, pagePanels);
 }
 for (const [, pagePanels] of panelsByPage) {
 for (let i = 1; i < pagePanels.length; i++) {
 const curr = pagePanels[i]!;
 const prev = pagePanels[i - 1]!;
 if (curr.metadata.panelIndex <= prev.metadata.panelIndex) {
 orderViolations++;
 repairHints.push({
 panelId: curr.panelId,
 issueCode: 'panel_order_violation',
 detail: `Panel index ${curr.metadata.panelIndex} not greater than previous ${prev.metadata.panelIndex} on page ${curr.metadata.pageNumber}.`,
 });
 }
 }
 }
 if (orderViolations > 0) {
 reasons.push(`${orderViolations} violação(ões) na ordem de leitura dos painéis.`);
 }

 // 6. Truncated panels (zero-area bounding box)
 let truncatedCount = 0;
 for (const panel of panels) {
 const bb = panel.metadata.boundingBox;
 if (bb.w <= 0 || bb.h <= 0) {
 truncatedCount++;
 repairHints.push({
 panelId: panel.panelId,
 issueCode: 'truncated_panel',
 detail: `Bounding box has zero area (${bb.w}x${bb.h}).`,
 });
 }
 }
 if (truncatedCount > 0) {
 reasons.push(`${truncatedCount} painel(is) com bounding box inválida.`);
 }

 // 7. Crop failures — panels whose extraction fell back to full page
 let cropFailedCount = 0;
 for (const panel of panels) {
 if (panel.cropFailed === true) {
 cropFailedCount++;
 repairHints.push({
 panelId: panel.panelId,
 issueCode: 'crop_failed',
 detail: `Panel cropping failed. Image hash and dimensions reflect the full page, not the intended panel region. Requires manual review.`,
 });
 }
 }
 if (cropFailedCount > 0) {
 reasons.push(`${cropFailedCount} painel(is) com falha no recorte (crop). Imagem não corresponde ao bounding box declarado.`);
 }

 // Determine verdict
 const hasCriticalIssues = truncatedCount > 0 || orderViolations > 0;
 const hasReviewIssues =
 ocrFailedCount > 0 || illegibleCount > 0 || duplicateCount > 0 || missingTextEvidence > 0 || cropFailedCount > 0;

 let verdict: GateFVerdict;
 if (hasCriticalIssues) {
 verdict = 'fail';
 } else if (hasReviewIssues) {
 verdict = 'needs_review';
 } else {
 verdict = 'pass';
 }

 return {
 gate: 'F_panel_integrity',
 verdict,
 checkedAtIso: new Date().toISOString(),
 reasons,
 metrics: {
 panelCount: panels.length,
 ocrFailedCount,
 illegibleCount,
 duplicateCount,
 orderViolations,
 truncatedCount,
 missingTextEvidence,
 cropFailedCount,
 minOcrConfidence,
 expectedReadingOrder: input.expectedReadingOrder,
 },
 repairHints,
 };
}