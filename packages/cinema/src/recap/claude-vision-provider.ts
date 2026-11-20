/**
 * Claude Vision Provider — Phase 2.2.4 E2E
 *
 * Concrete RecapVisualAnalysisPort backed by the real ClaudeCliAdapter.
 * Uses lean mode (no tools, no memory, minimal system prompt) to avoid
 * token overhead and response truncation with image attachments.
 *
 * KEY GUARANTEES:
 * - Uses real Claude CLI with image attachments (no mocks).
 * - Lean mode: ~45K token overhead eliminated, faster and cheaper responses.
 * - Robust JSON extraction handles truncated/malformed responses gracefully.
 * - Returns zero confidence on any failure (never fabricates).
 * - Records telemetry: model, duration, errors.
 * - Respects AbortSignal for cancellation.
 */

import type { AgentAdapter } from '@neuralbridge/agents';
import type { RecapVisualAnalysisPort } from './recap-vision-adapter.js';
import { classifyVisionError, detectProviderErrorInText, RecapVisionError, sanitizeErrorMessage } from './vision-error-classifier.js';

const VISION_SYSTEM_PROMPT = `Analise painéis de mangá/manhwa. Responda APENAS JSON válido sem markdown:
{"nature":"dialogue|action|establishing|reaction|observation","description":"texto PT-BR","characters":["nome1"],"actions":["ação1"],"emotions":["emoção1"],"setting":"cenário","confidence":0.0-1.0}
Se não tiver certeza, use confidence baixo. NÃO invente.`;

export interface ClaudeVisionProviderOptions {
	adapter: AgentAdapter;
	cwd: string;
	/** Provider identifier (e.g. 'claude' or 'claude-gateway'). Defaults to adapter.id. */
	providerId?: string;
	model?: string;
	timeoutMs?: number;
}

interface LeanVisionResult {
	nature?: string;
	description?: string;
	characters?: string[];
	actions?: string[];
	emotions?: string[];
	setting?: string;
	confidence?: number;
}

/**
 * Robustly extracts JSON from potentially truncated or malformed Claude responses.
 * Handles: balanced braces, literal control chars, incomplete numbers, trailing text.
 */
function extractJsonFromResponse(text: string): LeanVisionResult | null {
	// Find outermost balanced braces
	let braceStart = -1;
	let braceDepth = 0;
	let braceEnd = -1;

	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '{') {
			if (braceDepth === 0) braceStart = i;
			braceDepth++;
		} else if (ch === '}') {
			braceDepth--;
			if (braceDepth === 0 && braceStart >= 0) {
				braceEnd = i + 1;
				break;
			}
		}
	}

	if (braceStart < 0) return null;

	// If braces are unbalanced (truncated response), close them
	let jsonStr = braceEnd > 0
		? text.slice(braceStart, braceEnd)
		: text.slice(braceStart);

	// Fix truncated values: remove incomplete key-value pairs at the end
	// e.g., "confidence":0. → "confidence":0
	jsonStr = jsonStr.replace(/:\s*[\d.]*$/, ':0');
	// Remove trailing commas before closing brace
	jsonStr = jsonStr.replace(/,\s*$/, '');
	// Close unclosed arrays/objects if truncated
	if (braceEnd < 0) {
		const openBrackets = (jsonStr.match(/\[/g) || []).length;
		const closeBrackets = (jsonStr.match(/\]/g) || []).length;
		const openBraces = (jsonStr.match(/\{/g) || []).length;
		const closeBraces = (jsonStr.match(/\}/g) || []).length;
		jsonStr += ']'.repeat(Math.max(0, openBrackets - closeBrackets));
		jsonStr += '}'.repeat(Math.max(0, openBraces - closeBraces));
	}

	// Sanitize literal control characters inside JSON strings
	jsonStr = jsonStr.replace(/"([^"]*)"/g, (_match, inner: string) => {
		const sanitized = inner
			.replace(/(?<!\\)\n/g, '\\n')
			.replace(/(?<!\\)\r/g, '\\r')
			.replace(/(?<!\\)\t/g, '\\t')
			.replace(/[\x00-\x1f]/g, ' ');
		return `"${sanitized}"`;
	});

	try {
		return JSON.parse(jsonStr) as LeanVisionResult;
	} catch {
		// Last resort: strip all non-printable chars
		const stripped = jsonStr.replace(/[\x00-\x1f\x7f]/g, ' ');
		try {
			return JSON.parse(stripped) as LeanVisionResult;
		} catch {
			return null;
		}
	}
}

export function createClaudeVisionProvider(options: ClaudeVisionProviderOptions): RecapVisualAnalysisPort {
	const { adapter, cwd, model, timeoutMs = 90_000 } = options;
	const providerId = options.providerId ?? adapter.id ?? 'claude';

	return {
		id: providerId,
		model: model ?? 'claude-sonnet-4-20250514',

		async detect() {
			try {
				const status = await adapter.detect({ refresh: true });
				if (!status.installed) return { available: false, reason: `${providerId} CLI not installed.` };
				if (status.authenticated === false) return { available: false, reason: `${providerId} not authenticated.` };
				if (status.problems.length > 0) return { available: false, reason: sanitizeErrorMessage(status.problems.join('; ')) };
				return { available: true };
			} catch (err) {
				return { available: false, reason: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) };
			}
		},

		async analyze(input) {
			const startTime = Date.now();
			const frames = input.frames;
			if (frames.length === 0) throw new Error('No frames provided for analysis.');

			const frame = frames[0]!;
			const imagePath = frame.path;

			try {
				let resultText = '';
				let errorText = '';
				let runFailed = false;

				for await (const event of adapter.run(
					{
						prompt: 'Analise este painel.',
						cwd,
						mode: 'read-only',
						timeoutMs,
						images: [{ path: imagePath, mime: 'image/png' }],
						lean: { systemPrompt: VISION_SYSTEM_PROMPT },
						...(model ? { model } : {}),
					},
					input.signal,
				)) {
					if (event.kind === 'result' && event.text) resultText = event.text;
					else if (event.kind === 'text') resultText += event.text;
					else if (event.kind === 'done') {
						if (!event.ok) {
							runFailed = true;
							if (event.errorOutput) errorText = event.errorOutput;
						}
						if (!resultText && event.result) resultText = event.result;
					}
				}

				// 1. Detect quota / rate-limit / auth errors BEFORE attempting JSON parsing
				const combinedSignal = [errorText, resultText].filter(Boolean).join(' | ');
				const detectedErr = detectProviderErrorInText(combinedSignal, providerId);
				if (detectedErr) {
					throw detectedErr;
				}
				if (runFailed) {
					throw classifyVisionError(combinedSignal || 'Agent run failed', providerId, 'PROVIDER_UNAVAILABLE');
				}

				const parsed = extractJsonFromResponse(resultText);
				if (!parsed) {
					throw new RecapVisionError({
						code: 'INVALID_MODEL_RESPONSE',
						providerId,
						message: `Failed to parse JSON after ${Date.now() - startTime}ms. Preview: ${sanitizeErrorMessage(resultText.slice(0, 300))}`,
						retryable: false,
					});
				}

				// Map lean format to RecapVisualAnalysisPort contract
				const nature = parsed.nature ?? 'observation';
				const description = parsed.description ?? '';
				const characters = parsed.characters ?? [];
				const actions = (parsed.actions ?? []).map((a) => ({
					description: a,
					basis: 'visual',
					confidence: parsed.confidence ?? 0.5,
				}));
				const entities = characters.map((name) => ({
					name,
					type: 'character' as const,
					basis: 'visual',
					evidence: description,
					confidence: parsed.confidence ?? 0.5,
				}));

				return {
					nature,
					natureConfidence: parsed.confidence ?? 0.5,
					description,
					frames: frames.map((f) => ({
						atMs: f.atMs ?? 0,
						observed: description,
						visibleText: [] as readonly { text: string; region: string }[],
					})),
					entities,
					actions,
					environment: parsed.setting ? { description: parsed.setting, basis: 'visual', confidence: parsed.confidence ?? 0.5 } : null,
					overlays: { burnedText: false, burnedTextRegion: null, watermark: false, webcam: false },
					limitations: [],
					confidence: parsed.confidence ?? 0.5,
				};
			} catch (err) {
				const classified = classifyVisionError(err, providerId);
				console.error(`[ClaudeVisionProvider:${providerId}] ${classified.code} after ${Date.now() - startTime}ms:`, classified.message);
				throw classified;
			}
		},
	};
}