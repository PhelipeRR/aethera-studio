import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { ExtractedPanel, PanelAnalysis } from './recap-types.js';
import type { RecapFidelityGateReport, RecapFidelityEligibility, RecapFidelityStatus } from './recap-fidelity-gate.js';

export type RecapFidelityProgressStatus = RecapFidelityStatus | 'pending_analysis';

export interface RecapFidelityProgressPanel {
	panelId: string;
	status: RecapFidelityProgressStatus;
	eligibility: RecapFidelityEligibility;
	evidenceBacked: boolean;
	reason: string;
}

export interface RecapFidelityProgressReport {
	version: 'recap-fidelity-progress-v1';
	updatedAtIso: string;
	panels: RecapFidelityProgressPanel[];
	counts: Record<RecapFidelityProgressStatus, number>;
	storyEngineBlocked: boolean;
}

function atomicWrite(path: string, value: unknown): void {
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
	writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
	renameSync(temp, path);
}

export function buildRecapFidelityProgress(input: {
	panels: readonly ExtractedPanel[];
	analyses?: readonly PanelAnalysis[];
	gateReport?: RecapFidelityGateReport;
	updatedAtIso?: string;
}): RecapFidelityProgressReport {
	const gateById = new Map((input.gateReport?.panels ?? []).map((panel) => [panel.panelId, panel]));
	const analysisIds = new Set((input.analyses ?? []).filter((analysis) => analysis.analysisConfidence > 0).map((analysis) => analysis.panelId));
	const panels = input.panels.map((panel) => {
		const gated = gateById.get(panel.panelId);
		if (gated) return { panelId: panel.panelId, status: gated.status, eligibility: gated.eligibility ?? 'blocked', evidenceBacked: gated.checks.evidence.status === 'pass', reason: gated.status === 'verified' ? 'Gate de fidelidade independente aprovado.' : 'Gate independente exige revisão ou rejeição.' };
		if (analysisIds.has(panel.panelId)) return { panelId: panel.panelId, status: 'unverified' as const, eligibility: 'blocked' as const, evidenceBacked: false, reason: 'Análise disponível, mas ainda sem evidência independente de fidelidade.' };
		return { panelId: panel.panelId, status: 'pending_analysis' as const, eligibility: 'blocked' as const, evidenceBacked: false, reason: 'Painel ainda não analisado.' };
	});
	const counts: Record<RecapFidelityProgressStatus, number> = { verified: 0, needs_review: 0, rejected: 0, unverified: 0, pending_analysis: 0 };
	for (const panel of panels) counts[panel.status] += 1;
	return { version: 'recap-fidelity-progress-v1', updatedAtIso: input.updatedAtIso ?? new Date().toISOString(), panels, counts, storyEngineBlocked: panels.some((panel) => panel.eligibility === 'blocked' || !panel.evidenceBacked) };
}

export function saveRecapFidelityProgress(directory: string, report: RecapFidelityProgressReport): string {
	const path = join(directory, 'fidelity', 'fidelity-progress.json');
	atomicWrite(path, report);
	return path;
}
