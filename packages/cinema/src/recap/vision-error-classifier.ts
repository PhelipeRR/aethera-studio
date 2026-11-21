/**
 * Structured Vision Error Classification & Secret/Prompt Sanitization — Phase 2.2.4
 *
 * Detects quota (including RESOURCE_EXHAUSTED / insufficient credits), rate-limit,
 * authentication, network, timeout, availability, and unknown provider errors BEFORE
 * attempting JSON parsing, while stripping credentials, full prompts, and JSON schemas.
 */

export const VISION_ERROR_CODES = [
	'QUOTA_EXCEEDED',
	'RATE_LIMITED',
	'AUTHENTICATION_FAILED',
	'MODEL_INCOMPATIBLE',
	'PROVIDER_UNAVAILABLE',
	'TIMEOUT',
	'INVALID_MODEL_RESPONSE',
	'NETWORK_ERROR',
	'UNKNOWN_PROVIDER_ERROR',
] as const;

export type VisionErrorCode = (typeof VISION_ERROR_CODES)[number];

export interface VisionProviderDiagnostic {
	providerId: string;
	code: VisionErrorCode;
	message: string;
	exitCode?: number | null;
	resetAtText?: string;
}

/**
 * Strips bearer tokens, API keys, credential assignments, CLI --print prompts,
 * and embedded JSON schemas so diagnostics stay concise and safe to log.
 */
export function sanitizeErrorMessage(raw: string, maxLength = 360): string {
	let cleaned = raw
		// Redact credentials and tokens
		.replace(/\bBearer\s+[A-Za-z0-9._\-+/=]{8,}/gi, 'Bearer [REDACTED]')
		.replace(/\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{12,}/g, '[REDACTED_KEY]')
		.replace(/\b(api[_-]?key|auth[_-]?token|access[_-]?token|token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9._\-+/=]{6,}["']?/gi, '$1=[REDACTED]')
		// Strip embedded JSON schemas from CLI error echo
		.replace(/Respond ONLY with valid JSON matching this JSON Schema[\s\S]*$/i, '[SCHEMA_OMITTED]')
		.replace(/\{"type"\s*:\s*"object"\s*,\s*"(?:additionalProperties|properties)"[\s\S]*$/i, '[JSON_SCHEMA_OMITTED]')
		// Strip full command-line prompt dumps from child_process execFile errors
		.replace(/(Command failed:\s*[^\r\n]*?)\s+--print\s+[\s\S]*?(?=\r?\n|$)/i, '$1 --print [PROMPT_OMITTED]')
		.replace(/\s+/g, ' ')
		.trim();

	if (cleaned.length > maxLength) {
		cleaned = `${cleaned.slice(0, maxLength - 1)}…`;
	}
	return cleaned;
}

/**
 * Extracts a human-readable quota/rate-limit reset window from provider messages.
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
		if (m?.[1]?.trim()) return sanitizeErrorMessage(m[1].trim(), 120);
	}
	return undefined;
}

export function extractExitCode(raw: string): number | undefined {
	const m = /\bexit(?:\s+code)?\s*[:=]?\s*(-?\d+)\b/i.exec(raw);
	if (!m?.[1]) return undefined;
	const n = Number.parseInt(m[1], 10);
	return Number.isFinite(n) ? n : undefined;
}

export class RecapVisionError extends Error {
	readonly code: VisionErrorCode;
	readonly providerId: string;
	readonly retryable: boolean;
	readonly resetAtText?: string;
	readonly exitCode?: number;

	constructor(input: {
		code: VisionErrorCode;
		providerId: string;
		message: string;
		retryable?: boolean;
		resetAtText?: string;
		exitCode?: number;
		cause?: unknown;
	}) {
		const stripped = input.message.replace(/^(?:\[[A-Z_]+\]\s*\([^)]+\)\s*)+/, '');
		const sanitized = sanitizeErrorMessage(stripped);
		super(`[${input.code}] (${input.providerId}) ${sanitized}`, input.cause !== undefined ? { cause: input.cause } : undefined);
		this.name = 'RecapVisionError';
		this.code = input.code;
		this.providerId = input.providerId;
		this.retryable = input.retryable ?? (input.code === 'RATE_LIMITED' || input.code === 'TIMEOUT' || input.code === 'NETWORK_ERROR');
		if (input.resetAtText) this.resetAtText = input.resetAtText;
		if (input.exitCode !== undefined) this.exitCode = input.exitCode;
	}
}

export class AllVisionProvidersUnavailableError extends RecapVisionError {
	readonly diagnostics: readonly VisionProviderDiagnostic[];

	constructor(diagnostics: readonly VisionProviderDiagnostic[], summary?: string) {
		const detail = summary ?? (
			diagnostics.length > 0
				? `Nenhum agente multimodal disponível: ${diagnostics.map((d) => `${d.providerId}=${d.code}${d.exitCode !== undefined && d.exitCode !== null ? `(exit ${d.exitCode})` : ''}${d.resetAtText ? ` [reset: ${d.resetAtText}]` : ''}`).join('; ')}`
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
	/quota_cooldown/i,
	/RESOURCE_EXHAUSTED/i,
	/insufficient[_ ]?credits?/i,
	/cr[ée]ditos?\s+insuficientes?/i,
	/saldo\s+insuficiente/i,
	/balance is too low/i,
	/ai credits balance/i,
	/out of (?:usage )?credits?/i,
	/no remaining credits?/i,
	/credits?\s+exhausted/i,
	/hit your (?:weekly|daily|monthly|usage) limit/i,
	/usage_limit_reached/i,
	/weekly limit/i,
	/usage limit/i,
	/quota[_ ]?exceeded/i,
	/insufficient[_ ]?quota/i,
	/credit balance/i,
	/billing hard limit/i,
	/exceeded your current quota/i,
	/quota\s+exhausted/i,
];

const MODEL_INCOMPATIBLE_PATTERNS = [
	/does not support (?:image|vision|multimodal)/i,
	/(?:image|vision|multimodal) (?:input |content )?(?:is )?not supported/i,
	/cannot process image/i,
	/model .* does not support/i,
	/model .* not (?:found|supported|available)/i,
	/invalid[_ ]?model/i,
	/unknown model/i,
	/not_found_error.*model/i,
	/image does not match the provided media type/i,
	/unsupported[_ ]?media[_ ]?type/i,
	/text[- ]only model/i,
	/sem suporte a (?:imagem|imagens|vis[ãa]o|multimodal)/i,
	/modelo incompat[íi]vel/i,
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
	/codex login/i,
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
	/n[ãa]o encontrado no path/i,
	/\bENOENT\b/i,
	/provider unavailable/i,
	/service unavailable/i,
	/\b503\b/,
	/not configured/i,
	/disabled by/i,
	/capability .* unavailable/i,
];

const PARSE_PATTERNS = [
	/failed to parse json/i,
	/unexpected token .* json/i,
	/invalid_model_response/i,
	/n[ãa]o retornou json estruturado/i,
	/invalid json/i,
	/zoderror/i,
	/unrecognized_keys/i,
	/invalid_enum_value/i,
];

/**
 * Classifies a raw error or provider output string into a structured RecapVisionError.
 * Checks QUOTA_EXCEEDED (including RESOURCE_EXHAUSTED + 429 credit exhaustion) BEFORE
 * RATE_LIMITED and BEFORE JSON parsing errors. Unknown failures keep UNKNOWN_PROVIDER_ERROR
 * with original exitCode and sanitized stderr instead of masking as generic PROVIDER_UNAVAILABLE.
 */
export function classifyVisionError(
	rawInput: unknown,
	providerId: string,
	fallbackCode: VisionErrorCode = 'UNKNOWN_PROVIDER_ERROR',
): RecapVisionError {
	if (rawInput instanceof RecapVisionError) return rawInput;
	const isZodError = rawInput instanceof Error && rawInput.name === 'ZodError';
	const rawMessage = rawInput instanceof Error ? rawInput.message : String(rawInput ?? '');
	const sanitized = sanitizeErrorMessage(rawMessage);
	const resetAtText = extractResetInfo(rawMessage);
	const exitCode = extractExitCode(rawMessage);

	if (QUOTA_PATTERNS.some((re) => re.test(rawMessage))) {
		return new RecapVisionError({
			code: 'QUOTA_EXCEEDED',
			providerId,
			message: sanitized,
			retryable: false,
			...(resetAtText ? { resetAtText } : {}),
			...(exitCode !== undefined ? { exitCode } : {}),
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
			...(exitCode !== undefined ? { exitCode } : {}),
			cause: rawInput,
		});
	}
	if (AUTH_PATTERNS.some((re) => re.test(rawMessage))) {
		return new RecapVisionError({
			code: 'AUTHENTICATION_FAILED',
			providerId,
			message: sanitized,
			retryable: false,
			...(exitCode !== undefined ? { exitCode } : {}),
			cause: rawInput,
		});
	}
	if (MODEL_INCOMPATIBLE_PATTERNS.some((re) => re.test(rawMessage))) {
		return new RecapVisionError({
			code: 'MODEL_INCOMPATIBLE',
			providerId,
			message: sanitized,
			retryable: false,
			...(exitCode !== undefined ? { exitCode } : {}),
			cause: rawInput,
		});
	}
	if (TIMEOUT_PATTERNS.some((re) => re.test(rawMessage))) {
		return new RecapVisionError({
			code: 'TIMEOUT',
			providerId,
			message: sanitized,
			retryable: true,
			...(exitCode !== undefined ? { exitCode } : {}),
			cause: rawInput,
		});
	}
	if (NETWORK_PATTERNS.some((re) => re.test(rawMessage))) {
		return new RecapVisionError({
			code: 'NETWORK_ERROR',
			providerId,
			message: sanitized,
			retryable: true,
			...(exitCode !== undefined ? { exitCode } : {}),
			cause: rawInput,
		});
	}
	if (UNAVAILABLE_PATTERNS.some((re) => re.test(rawMessage))) {
		return new RecapVisionError({
			code: 'PROVIDER_UNAVAILABLE',
			providerId,
			message: sanitized,
			retryable: false,
			...(exitCode !== undefined ? { exitCode } : {}),
			cause: rawInput,
		});
	}
	if (isZodError || PARSE_PATTERNS.some((re) => re.test(rawMessage))) {
		return new RecapVisionError({
			code: 'INVALID_MODEL_RESPONSE',
			providerId,
			message: sanitized,
			retryable: false,
			...(exitCode !== undefined ? { exitCode } : {}),
			cause: rawInput,
		});
	}

	return new RecapVisionError({
		code: fallbackCode,
		providerId,
		message: sanitized || 'Falha não classificada do provedor.',
		retryable: false,
		...(exitCode !== undefined ? { exitCode } : {}),
		cause: rawInput,
	});
}

/**
 * Inspects raw model text BEFORE JSON parsing to detect provider errors
 * (quota, RESOURCE_EXHAUSTED, rate-limit, auth, model incompatibility, network) returned inline as text output.
 */
export function detectProviderErrorInText(rawText: string, providerId: string): RecapVisionError | null {
	const trimmed = rawText.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith('{') && /"(?:description|nature|characters|actions)"/.test(trimmed)) {
		return null;
	}
	if (
		QUOTA_PATTERNS.some((re) => re.test(trimmed)) ||
		RATE_LIMIT_PATTERNS.some((re) => re.test(trimmed)) ||
		AUTH_PATTERNS.some((re) => re.test(trimmed)) ||
		MODEL_INCOMPATIBLE_PATTERNS.some((re) => re.test(trimmed))
	) {
		return classifyVisionError(trimmed, providerId);
	}
	return null;
}
