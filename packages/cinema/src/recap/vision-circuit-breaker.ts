/**
 * Per-Agent Circuit Breaker — Phase 2.2.4
 *
 * Tracks operational availability of each agent during a pipeline execution.
 * When an agent returns QUOTA_EXCEEDED or AUTHENTICATION_FAILED, its circuit
 * opens immediately for the remainder of the run so no further panels are
 * dispatched to it, even if `detect()` still reports authenticated.
 */

import { parseResetAtMs, type RecapVisionError, type VisionErrorCode } from './vision-error-classifier.js';

export interface AgentCircuitState {
	providerId: string;
	state: 'closed' | 'open';
	code?: VisionErrorCode;
	reason?: string;
	resetAtText?: string;
	resetAtMs?: number;
	openedAtIso?: string;
	failureCount: number;
}

const DEFINITIVE_OPEN_CODES = new Set<VisionErrorCode>([
	'QUOTA_EXCEEDED',
	'AUTHENTICATION_FAILED',
	'MODEL_INCOMPATIBLE',
	'PROVIDER_UNAVAILABLE',
]);

export class AgentCircuitBreaker {
	private readonly circuits = new Map<string, AgentCircuitState>();
	private readonly transientFailureThreshold: number;

	constructor(options?: { transientFailureThreshold?: number }) {
		this.transientFailureThreshold = options?.transientFailureThreshold ?? 3;
	}

	isAvailable(providerId: string, nowMs = Date.now()): boolean {
		const entry = this.circuits.get(providerId);
		if (!entry || entry.state === 'closed') return true;
		if (
			entry.code === 'QUOTA_EXCEEDED' &&
			entry.resetAtMs !== undefined &&
			nowMs >= entry.resetAtMs
		) {
			this.circuits.delete(providerId);
			return true;
		}
		return false;
	}

	getState(providerId: string): AgentCircuitState | null {
		return this.circuits.get(providerId) ?? null;
	}

	getSnapshot(): AgentCircuitState[] {
		return [...this.circuits.values()];
	}

	recordSuccess(providerId: string): void {
		const existing = this.circuits.get(providerId);
		if (existing && existing.state === 'open') {
			// Never auto-close a definitive quota/auth circuit during the same execution
			return;
		}
		this.circuits.set(providerId, {
			providerId,
			state: 'closed',
			failureCount: 0,
		});
	}

	recordError(providerId: string, error: RecapVisionError): AgentCircuitState {
		const existing = this.circuits.get(providerId);
		const failureCount = (existing?.failureCount ?? 0) + 1;
		const shouldOpen =
			DEFINITIVE_OPEN_CODES.has(error.code) ||
			failureCount >= this.transientFailureThreshold;

		const resetAtMs = error.resetAtMs ?? parseResetAtMs(error.resetAtText);
		const next: AgentCircuitState = {
			providerId,
			state: shouldOpen ? 'open' : 'closed',
			code: error.code,
			reason: error.message,
			...(error.resetAtText ? { resetAtText: error.resetAtText } : {}),
			...(resetAtMs !== undefined ? { resetAtMs } : {}),
			...(shouldOpen ? { openedAtIso: existing?.openedAtIso ?? new Date().toISOString() } : {}),
			failureCount,
		};
		this.circuits.set(providerId, next);
		return next;
	}

	open(providerId: string, code: VisionErrorCode, reason: string, resetAtText?: string, resetAtMs?: number): AgentCircuitState {
		const resolvedResetAtMs = resetAtMs ?? parseResetAtMs(resetAtText);
		const next: AgentCircuitState = {
			providerId,
			state: 'open',
			code,
			reason,
			...(resetAtText ? { resetAtText } : {}),
			...(resolvedResetAtMs !== undefined ? { resetAtMs: resolvedResetAtMs } : {}),
			openedAtIso: new Date().toISOString(),
			failureCount: (this.circuits.get(providerId)?.failureCount ?? 0) + 1,
		};
		this.circuits.set(providerId, next);
		return next;
	}

	clearProvider(providerId: string): void {
		this.circuits.delete(providerId);
	}

	reset(options?: { preserveQuotaExhausted?: boolean }): void {
		if (!options?.preserveQuotaExhausted) {
			this.circuits.clear();
			return;
		}
		for (const [providerId, state] of this.circuits.entries()) {
			if (state.code !== 'QUOTA_EXCEEDED') {
				this.circuits.delete(providerId);
			}
		}
	}
}
