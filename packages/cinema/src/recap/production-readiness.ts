/**
 * Aethera Recap — Production Readiness Preflight & Auto-Resume Inspector (Phase 4.2)
 *
 * Checks per-agent circuit breaker state, provider detection, and durable
 * checkpoint progress BEFORE starting a production run so the UI and CLI
 * display exact unavailability reasons and offer one-click checkpoint resume.
 */

import type { AgentCircuitBreaker } from './vision-circuit-breaker.js';
import type { VisionErrorCode } from './vision-error-classifier.js';
import { loadCheckpoint } from './checkpoint-persistence.js';

export interface ReadinessProviderProbe {
	id: string;
	label: string;
	supportsMultimodal?: boolean;
	detect: () => Promise<{ available: boolean; reason?: string; code?: VisionErrorCode; resetAtText?: string; multimodal?: boolean }>;
}

export interface ProviderReadinessItem {
	providerId: string;
	label: string;
	status: 'available' | 'circuit_open' | 'unavailable';
	code?: VisionErrorCode;
	reason?: string;
	resetAtText?: string;
}

export interface CheckpointProgressSummary {
	exists: boolean;
	chapterId: string | null;
	completedPanels: number;
	totalPanels: number;
	pendingPanels: number;
	canResume: boolean;
	lastUpdatedAtIso: string | null;
}

export interface RecapProductionReadinessReport {
	ready: boolean;
	operationalProviders: string[];
	providers: ProviderReadinessItem[];
	checkpoint: CheckpointProgressSummary;
	autoResumeRecommended: boolean;
	summaryMessage: string;
	checkedAtIso: string;
}

export function inspectCheckpointProgress(
	checkpointDir: string,
	expectedTotalPanels?: number,
): CheckpointProgressSummary {
	const ckpt = loadCheckpoint(checkpointDir);
	if (!ckpt) {
		const total = expectedTotalPanels ?? 0;
		return {
			exists: false,
			chapterId: null,
			completedPanels: 0,
			totalPanels: total,
			pendingPanels: total,
			canResume: false,
			lastUpdatedAtIso: null,
		};
	}

	const completedPanels = Array.isArray(ckpt.panelAnalyses) ? ckpt.panelAnalyses.length : 0;
	const totalPanels = expectedTotalPanels ?? ckpt.extractedPanels?.length ?? completedPanels;
	const pendingPanels = Math.max(0, totalPanels - completedPanels);

	return {
		exists: true,
		chapterId: ckpt.chapterId,
		completedPanels,
		totalPanels,
		pendingPanels,
		canResume: completedPanels > 0 && pendingPanels > 0,
		lastUpdatedAtIso: ckpt.lastUpdatedAtIso,
	};
}

export async function checkRecapProductionReadiness(input: {
	providers: readonly ReadinessProviderProbe[];
	circuitBreaker: AgentCircuitBreaker;
	checkpointDir?: string;
	expectedTotalPanels?: number;
}): Promise<RecapProductionReadinessReport> {
	const items: ProviderReadinessItem[] = [];
	const operationalProviders: string[] = [];

	for (const p of input.providers) {
		if (!input.circuitBreaker.isAvailable(p.id)) {
			const st = input.circuitBreaker.getState(p.id);
			items.push({
				providerId: p.id,
				label: p.label,
				status: 'circuit_open',
				code: st?.code ?? 'PROVIDER_UNAVAILABLE',
				...(st?.reason ? { reason: st.reason } : {}),
				...(st?.resetAtText ? { resetAtText: st.resetAtText } : {}),
			});
			continue;
		}
		if (p.supportsMultimodal === false) {
			items.push({
				providerId: p.id,
				label: p.label,
				status: 'unavailable',
				code: 'MODEL_INCOMPATIBLE',
				reason: 'Agente sem suporte multimodal real (apenas texto).',
			});
			continue;
		}
		try {
			const det = await p.detect();
			if (det.available && det.multimodal === false) {
				items.push({
					providerId: p.id,
					label: p.label,
					status: 'unavailable',
					code: 'MODEL_INCOMPATIBLE',
					reason: 'Agente sem suporte multimodal real (apenas texto).',
				});
			} else if (det.available) {
				operationalProviders.push(p.id);
				items.push({ providerId: p.id, label: p.label, status: 'available' });
			} else {
				items.push({
					providerId: p.id,
					label: p.label,
					status: 'unavailable',
					code: det.code ?? 'PROVIDER_UNAVAILABLE',
					...(det.reason ? { reason: det.reason } : {}),
					...(det.resetAtText ? { resetAtText: det.resetAtText } : {}),
				});
			}
		} catch (err) {
			items.push({
				providerId: p.id,
				label: p.label,
				status: 'unavailable',
				code: 'PROVIDER_UNAVAILABLE',
				reason: err instanceof Error ? err.message : String(err),
			});
		}
	}

	const checkpoint = input.checkpointDir
		? inspectCheckpointProgress(input.checkpointDir, input.expectedTotalPanels)
		: {
			exists: false,
			chapterId: null,
			completedPanels: 0,
			totalPanels: input.expectedTotalPanels ?? 0,
			pendingPanels: input.expectedTotalPanels ?? 0,
			canResume: false,
			lastUpdatedAtIso: null,
		};

	const ready = operationalProviders.length > 0;
	const autoResumeRecommended = ready && checkpoint.canResume;

	let summaryMessage: string;
	if (!ready) {
		const blockedText = items
			.map((i) => `${i.label}: ${i.code ?? 'UNAVAILABLE'}${i.resetAtText ? ` (reset: ${i.resetAtText})` : ''}`)
			.join(' · ');
		summaryMessage = checkpoint.canResume
			? `Produção pausada — nenhum agente multimodal disponível (${blockedText}). Checkpoint preservado (${checkpoint.completedPanels}/${checkpoint.totalPanels} painéis) pronto para retomada automática.`
			: `Produção indisponível — nenhum agente multimodal operacional (${blockedText}).`;
	} else if (autoResumeRecommended) {
		summaryMessage = `Pronto para retomar checkpoint (${checkpoint.completedPanels}/${checkpoint.totalPanels} painéis concluídos) usando: ${operationalProviders.join(', ')}.`;
	} else {
		summaryMessage = `Pronto para produção usando: ${operationalProviders.join(', ')}.`;
	}

	return {
		ready,
		operationalProviders,
		providers: items,
		checkpoint,
		autoResumeRecommended,
		summaryMessage,
		checkedAtIso: new Date().toISOString(),
	};
}
