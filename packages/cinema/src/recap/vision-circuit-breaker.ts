/**
 * Per-Agent Circuit Breaker — Phase 2.2.4
 *
 * Tracks operational availability of each agent during a pipeline execution.
 * When an agent returns QUOTA_EXCEEDED or AUTHENTICATION_FAILED, its circuit
 * opens immediately so no further panels are dispatched to it, even if
 * `detect()` still reports authenticated. Auth, model-incompatible and
 * unavailable circuits stay open; quota closes at its reset (or after a bounded
 * fallback when the reset is unreadable) and transient failures after a cooldown.
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

/** Codes whose open circuit never expires on its own (needs a user action or a new run). */
const NON_EXPIRING_CODES = new Set<VisionErrorCode>(['AUTHENTICATION_FAILED', 'MODEL_INCOMPATIBLE', 'PROVIDER_UNAVAILABLE']);

export const DEFAULT_TRANSIENT_COOLDOWN_MS = 10 * 60_000;
export const DEFAULT_QUOTA_WITHOUT_RESET_COOLDOWN_MS = 60 * 60_000;

export interface AgentCircuitBreakerOptions {
	transientFailureThreshold?: number;
	/** How long a circuit opened by transient failures stays open before a probe. */
	transientCooldownMs?: number;
	/** Upper bound for a quota circuit whose reset time could not be read. */
	quotaWithoutResetCooldownMs?: number;
	now?: () => number;
}

export class AgentCircuitBreaker {
	private readonly circuits = new Map<string, AgentCircuitState>();
	private readonly transientFailureThreshold: number;
	private readonly transientCooldownMs: number;
	private readonly quotaWithoutResetCooldownMs: number;
	private readonly now: () => number;

	constructor(options?: AgentCircuitBreakerOptions) {
		this.transientFailureThreshold = options?.transientFailureThreshold ?? 3;
		this.transientCooldownMs = options?.transientCooldownMs ?? DEFAULT_TRANSIENT_COOLDOWN_MS;
		this.quotaWithoutResetCooldownMs = options?.quotaWithoutResetCooldownMs ?? DEFAULT_QUOTA_WITHOUT_RESET_COOLDOWN_MS;
		this.now = options?.now ?? Date.now;
	}

	/**
	 * When an open circuit may be probed again, or undefined if it only closes by user action.
	 * Quota uses its parsed reset (or a bounded fallback); transient failures use a cooldown.
	 */
	private expiresAtMs(entry: AgentCircuitState): number | undefined {
		if (entry.code && NON_EXPIRING_CODES.has(entry.code)) return undefined;
		const openedAtMs = entry.openedAtIso ? Date.parse(entry.openedAtIso) : Number.NaN;
		if (entry.code === 'QUOTA_EXCEEDED') {
			if (entry.resetAtMs !== undefined) return entry.resetAtMs;
			return Number.isFinite(openedAtMs) ? openedAtMs + this.quotaWithoutResetCooldownMs : undefined;
		}
		if (entry.resetAtMs !== undefined) return entry.resetAtMs;
		return Number.isFinite(openedAtMs) ? openedAtMs + this.transientCooldownMs : undefined;
	}

	isAvailable(providerId: string, nowMs = this.now()): boolean {
		const entry = this.circuits.get(providerId);
		if (!entry || entry.state === 'closed') return true;
		const expiresAt = this.expiresAtMs(entry);
		if (expiresAt === undefined || nowMs < expiresAt) return false;
		if (entry.code === 'QUOTA_EXCEEDED') {
			this.circuits.delete(providerId);
		} else {
			// Half-open: one more transient failure reopens it straight away.
			this.circuits.set(providerId, {
				providerId,
				state: 'closed',
				failureCount: Math.max(0, this.transientFailureThreshold - 1),
			});
		}
		return true;
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
			...(shouldOpen
				? { openedAtIso: existing?.state === 'open' && existing.openedAtIso ? existing.openedAtIso : new Date(this.now()).toISOString() }
				: {}),
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
			openedAtIso: new Date(this.now()).toISOString(),
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
