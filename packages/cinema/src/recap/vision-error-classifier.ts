/**
 * Structured Vision Error Classification & Secret Sanitization — Phase 2.2.4
 *
 * Detects quota, rate-limit, authentication, network, timeout, and availability
 * errors BEFORE attempting JSON parsing so provider failures are never
 * misclassified as malformed JSON responses.
 */

export const VISION_ERROR_CODES = [
	'QUOTA_EXCEEDED',
	'RATE_LIMITED',
	'AUTHENTICATION_FAILED',
	'PROVIDER_UNAVAILABLE',
	'TIMEOUT',
	'INVALID_MODEL_RESPONSE',
	'NETWORK_ERROR',
] as const;

export type VisionErrorCode = (typeof VISION_ERROR_CODES)[number];

export interface VisionProviderDiagnostic {
	providerId: string;
	code: VisionErrorCode;
	message: string;
	resetAtText?: string;
}

/**
 * Strips bearer tokens, API keys, and credential assignments from error strings
 * before logging or storing diagnostics.
 */
export function sanitizeErrorMessage(raw: string): string {
	return raw
		.replace(/\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, 'Bearer [REDACTED]')
		.replace(/\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{12,}/g, '[REDACTED_KEY]')
		.replace(/\b(api[_-]?key|auth[_-]?token|access[_-]?token|token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9._\-+/=]{6,}["']?/gi, '$1=[REDACTED]')
		.trim();
}

/**
 * Extracts a human-readable quota/rate-limit reset window from provider messages
 * (e.g. "resets Nov 22, 3pm (America/Sao_Paulo)" or "try again at 2026-11-23").
 */
export function extractResetInfo(raw: string): string | undefined {
	const patterns = [
		/resets?\s+([^·\n]+?)(?:\s*·|\s*$)/i,
		/try again\s+(?:at|after|in)\s+([^·\n.]+)/i,
		/available again\s+(?:at|on)\s+([^·\n.]+)/i,
		/until\s+([0-9]{4}-[0-9]{2}-[0-9]{2}[^\s·\n]*|[0-9]{2}\/[0-9]{2}\/[0-9]{4})/i,
	];
	for (const re of patterns) {
		const m = re.exec(raw);
		if (m?.[1]?.trim()) return sanitizeErrorMessage(m[1].trim());
	}
	return undefined;
}

export class RecapVisionError extends Error {
	readonly code: VisionErrorCode;
	readonly providerId: string;
	readonly retryable: boolean;
	readonly resetAtText?: string;

	constructor(input: {
		code: VisionErrorCode;
		providerId: string;
		message: string;
		retryable?: boolean;
		resetAtText?: string;
		cause?: unknown;
	}) {
		const sanitized = sanitizeErrorMessage(input.message);
		super(`[${input.code}] (${input.providerId}) ${sanitized}`, input.cause !== undefined ? { cause: input.cause } : undefined);
		this.name = 'RecapVisionError';
		this.code = input.code;
		this.providerId = input.providerId;
		this.retryable = input.retryable ?? (input.code === 'RATE_LIMITED' || input.code === 'TIMEOUT' || input.code === 'NETWORK_ERROR');
		if (input.resetAtText) this.resetAtText = input.resetAtText;
	}
}

export class AllVisionProvidersUnavailableError extends RecapVisionError {
	readonly diagnostics: readonly VisionProviderDiagnostic[];

	constructor(diagnostics: readonly VisionProviderDiagnostic[], summary?: string) {
		const detail = summary ?? (
			diagnostics.length > 0
				? `Nenhum agente multimodal disponível: ${diagnostics.map((d) => `${d.providerId}=${d.code}${d.resetAtText ? ` (reset: ${d.resetAtText})` : ''}`).join('; ')}`
				: 'Nenhum agente multimodal configurado ou disponível.'
		);
		super({
			code: 'PROVIDER_UNAVAILABLE',
			providerId: 'vision-router',
			message: detail,
			retryable: false,
		});
		this.name = 'AllVisionProvidersUnavailableError';
		this.diagnostics = diagnostics;
	}
}

const QUOTA_PATTERNS = [
	/hit your (?:weekly|daily|monthly|usage) limit/i,
	/weekly limit/i,
	/out of usage credits?/i,
	/usage limit/i,
	/quota[_ ]?exceeded/i,
	/insufficient[_ ]?quota/i,
	/credit balance/i,
	/billing hard limit/i,
	/exceeded your current quota/i,
	/no remaining credits?/i,
];

const RATE_LIMIT_PATTERNS = [
	/rate[- ]?limit/i,
	/too many requests/i,
	/\b429\b/,
	/overloaded[_ ]?error/i,
];

const AUTH_PATTERNS = [
	/authentication[_ ]?failed/i,
	/not authenticated/i,
	/invalid[_ ]?(?:api[_ ]?key|token|credentials)/i,
	/\bunauthorized\b/i,
	/\b401\b/,
	/\b403\b/,
	/oauth.*expired/i,
	/login required/i,
	/run [`']?claude auth login/i,
];

const TIMEOUT_PATTERNS = [
	/timed?\s*out/i,
	/\btimeout\b/i,
	/\bETIMEDOUT\b/i,
	/deadline exceeded/i,
	/abort(?:ed)? due to timeout/i,
];

const NETWORK_PATTERNS = [
	/\bECONNREFUSED\b/i,
	/\bENOTFOUND\b/i,
	/\bECONNRESET\b/i,
	/\bEAI_AGAIN\b/i,
	/fetch failed/i,
	/network error/i,
	/socket hang up/i,
	/connection refused/i,
];

const UNAVAILABLE_PATTERNS = [
	/not installed/i,
	/\bENOENT\b/i,
	/provider unavailable/i,
	/service unavailable/i,
	/\b503\b/,
	/not configured/i,
	/disabled by/i,
	/capability .* unavailable/i,
];

/**
 * Classifies a raw error or provider output string into a structured RecapVisionError.
 * Checks quota/rate-limit/auth/timeout/network/availability BEFORE INVALID_MODEL_RESPONSE.
 */
export function classifyVisionError(
	rawInput: unknown,
	providerId: string,
	fallbackCode: VisionErrorCode = 'INVALID_MODEL_RESPONSE',
): RecapVisionError {
	if (rawInput instanceof RecapVisionError) return rawInput;
	const rawMessage = rawInput instanceof Error ? rawInput.message : String(rawInput ?? '');
	const sanitized = sanitizeErrorMessage(rawMessage);
	const resetAtText = extractResetInfo(rawMessage);

	if (QUOTA_PATTERNS.some((re) => re.test(rawMessage))) {
		return new RecapVisionError({
			code: 'QUOTA_EXCEEDED',
			providerId,
			message: sanitized,
			retryable: false,
			...(resetAtText ? { resetAtText } : {}),
			cause: rawInput,
		});
	}
	if (RATE_LIMIT_PATTERNS.some((re) => re.test(rawMessage))) {
		return new RecapVisionError({
			code: 'RATE_LIMITED',
			providerId,
			message: sanitized,
			retryable: true,
			...(resetAtText ? { resetAtText } : {}),
			cause: rawInput,
		});
	}
	if (AUTH_PATTERNS.some((re) => re.test(rawMessage))) {
		return new RecapVisionError({
			code: 'AUTHENTICATION_FAILED',
			providerId,
			message: sanitized,
			retryable: false,
			cause: rawInput,
		});
	}
	if (TIMEOUT_PATTERNS.some((re) => re.test(rawMessage))) {
		return new RecapVisionError({
			code: 'TIMEOUT',
			providerId,
			message: sanitized,
			retryable: true,
			cause: rawInput,
		});
	}
	if (NETWORK_PATTERNS.some((re) => re.test(rawMessage))) {
		return new RecapVisionError({
			code: 'NETWORK_ERROR',
			providerId,
			message: sanitized,
			retryable: true,
			cause: rawInput,
		});
	}
	if (UNAVAILABLE_PATTERNS.some((re) => re.test(rawMessage))) {
		return new RecapVisionError({
			code: 'PROVIDER_UNAVAILABLE',
			providerId,
			message: sanitized,
			retryable: false,
			cause: rawInput,
		});
	}

	return new RecapVisionError({
		code: fallbackCode,
		providerId,
		message: sanitized || 'Resposta inválida do modelo.',
		retryable: false,
		cause: rawInput,
	});
}

/**
 * Inspects raw model text BEFORE JSON parsing to detect provider errors
 * (quota, rate-limit, auth, network) returned inline as text output.
 */
export function detectProviderErrorInText(rawText: string, providerId: string): RecapVisionError | null {
	const trimmed = rawText.trim();
	if (!trimmed) return null;
	// If the text clearly contains a JSON object with expected vision keys, skip text-level quota heuristics
	if (trimmed.startsWith('{') && /"(?:description|nature|characters|actions)"/.test(trimmed)) {
		return null;
	}
	if (
		QUOTA_PATTERNS.some((re) => re.test(trimmed)) ||
		RATE_LIMIT_PATTERNS.some((re) => re.test(trimmed)) ||
		AUTH_PATTERNS.some((re) => re.test(trimmed))
	) {
		return classifyVisionError(trimmed, providerId);
	}
	return null;
}
