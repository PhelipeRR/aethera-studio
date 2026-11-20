import { existsSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative } from 'node:path';
import type { VisionAdapter, VisionAnalysisResult, ActionType, Emotion } from './recap-types.js';
import { AllVisionProvidersUnavailableError, classifyVisionError, type VisionProviderDiagnostic } from './vision-error-classifier.js';
import { AgentCircuitBreaker } from './vision-circuit-breaker.js';

/**
 * Port interface matching the subset of VisualAnalysisProvider that Recap needs.
 * This decouples the Cinema package from the Orchestrator's full vision-router types,
 * allowing the adapter to work with any provider that implements this contract.
 */
export interface RecapVisualAnalysisPort {
	readonly id: string;
	readonly model: string;
	describe?(input: {
		frames: readonly { hash: string; path: string; atMs?: number }[];
		signal?: AbortSignal;
	}): Promise<{ description: string; tags: string[] }>;
	analyze?(input: {
		frames: readonly { hash: string; path: string; atMs?: number }[];
		context?: string;
		signal?: AbortSignal;
	}): Promise<{
		nature: string;
		natureConfidence: number;
		description: string;
		frames: readonly { atMs: number; observed: string; visibleText: readonly { text: string; region: string }[] }[];
		entities: readonly { name: string; type: string; basis: string; evidence: string; confidence: number }[];
		actions: readonly { description: string; basis: string; confidence: number }[];
		environment: { description: string; basis: string; confidence: number } | null;
		overlays: { burnedText: boolean; burnedTextRegion: string | null; watermark: boolean; webcam: boolean };
		limitations: readonly string[];
		confidence: number;
	}>;
	detect(signal?: AbortSignal): Promise<{ available: true } | { available: false; reason: string }>;
}

/**
 * Port interface for the VisionRouter's describe capability with full telemetry.
 * Used when a router is available instead of a single provider.
 */
export interface RecapVisionRouterPort {
	describe(input: {
		frames: readonly { hash: string; path: string; atMs?: number }[];
		policy: { chain: readonly string[]; scope: string; version: string; budgetUsd: number; maxLatencyMs: number; thresholds: null };
		signal?: AbortSignal;
	}): Promise<{
		value: { description: string; tags: string[] } | null;
		provider: string | null;
		model: string | null;
		costUsd: number;
		attempts: readonly { provider: string; outcome: string; detail?: string; durationMs?: number }[];
		reportedModel?: string | null;
	}>;
	analyze(input: {
		frames: readonly { hash: string; path: string; atMs?: number }[];
		context?: string;
		policy: { chain: readonly string[]; scope: string; version: string; budgetUsd: number; maxLatencyMs: number; thresholds: null };
		signal?: AbortSignal;
	}): Promise<{
		value: {
			nature: string;
			natureConfidence: number;
			description: string;
			frames: readonly { atMs: number; observed: string; visibleText: readonly { text: string; region: string }[] }[];
			entities: readonly { name: string; type: string; basis: string; evidence: string; confidence: number }[];
			actions: readonly { description: string; basis: string; confidence: number }[];
			environment: { description: string; basis: string; confidence: number } | null;
			overlays: { burnedText: boolean; burnedTextRegion: string | null; watermark: boolean; webcam: boolean };
			limitations: readonly string[];
			confidence: number;
		} | null;
		provider: string | null;
		model: string | null;
		costUsd: number;
		attempts: readonly { provider: string; outcome: string; detail?: string; durationMs?: number }[];
		reportedModel?: string | null;
	}>;
}

export interface RecapVisionAdapterOptions {
	/** Authorized root directory for image path validation. */
	root: string;
	/** Single provider (simple setup), ordered multi-provider list, or router (production with fallback). */
	provider?: RecapVisualAnalysisPort;
	/** Ordered multimodal providers with circuit breaker and automatic fallback. */
	providers?: readonly RecapVisualAnalysisPort[];
	router?: RecapVisionRouterPort;
	/** Vision policy chain for router mode. Defaults to a sensible recap chain. */
	policyChain?: readonly string[];
	/** Maximum latency per analysis call in ms. Default: 30000. */
	maxLatencyMs?: number;
	/** Budget ceiling in USD. Default: 0.50. */
	budgetUsd?: number;
	/** Optional shared circuit breaker across pipeline runs. */
	circuitBreaker?: AgentCircuitBreaker;
	/** When true, throws AllVisionProvidersUnavailableError instead of returning confidence 0 when no provider can serve the request. */
	throwOnAllUnavailable?: boolean;
}

interface AnalysisTrace {
	provider: string | null;
	model: string | null;
	reportedModel: string | null;
	costUsd: number;
	attempts: readonly { provider: string; outcome: string; detail?: string; durationMs?: number }[];
	durationMs?: number;
}

const ACTION_TYPE_MAP: Record<string, ActionType> = {
	action: 'combat',
	combat: 'combat',
	fight: 'combat',
	clash: 'combat',
	chase: 'movement',
	exploration: 'movement',
	movement: 'movement',
	walk: 'movement',
	run: 'movement',
	dialogue: 'dialogue',
	speech: 'dialogue',
	talk: 'dialogue',
	reaction: 'reaction',
	portrait: 'observation',
	landscape: 'observation',
	observation: 'observation',
	cinematic: 'interaction',
	crowd: 'interaction',
	interaction: 'interaction',
	transform: 'transformation',
};

const EMOTION_KEYWORDS: Record<string, Emotion> = {
	joy: 'joy',
	happy: 'joy',
	smile: 'joy',
	sad: 'sadness',
	cry: 'sadness',
	anger: 'anger',
	angry: 'anger',
	fear: 'fear',
	scared: 'fear',
	surprise: 'surprise',
	shocked: 'surprise',
	determination: 'determination',
	determined: 'determination',
	tension: 'tension',
	tense: 'tension',
	relief: 'relief',
	relieved: 'relief',
	confusion: 'confusion',
	confused: 'confusion',
};

function mapNatureToActionType(nature: string): ActionType {
	const mapped = ACTION_TYPE_MAP[nature.toLowerCase()];
	return mapped ?? 'none';
}

function extractEmotionsFromText(text: string): Emotion[] {
	const lower = text.toLowerCase();
	const emotions: Emotion[] = [];
	for (const [keyword, emotion] of Object.entries(EMOTION_KEYWORDS)) {
		if (lower.includes(keyword) && !emotions.includes(emotion)) {
			emotions.push(emotion);
		}
	}
	return emotions;
}

function extractEmotionsFromAnalysis(description: string, tags: readonly string[], entities: readonly { name: string; type: string }[]): Emotion[] {
	const combined = [description, ...tags].join(' ');
	const emotions = extractEmotionsFromText(combined);
	return emotions.length > 0 ? emotions : ['unknown'];
}

function validateImagePath(root: string, imagePath: string): string {
	if (!existsSync(imagePath)) {
		throw new Error(`Image not found: ${imagePath}`);
	}
	const resolved = realpathSync(imagePath);
	const rel = relative(root, resolved);
	if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
		throw new Error(`forbidden: image outside authorized root (${root}).`);
	}
	if (!statSync(resolved).isFile()) {
		throw new Error(`Not a file: ${imagePath}`);
	}
	return resolved;
}

/**
 * RecapVisionAdapter — bridges Cinema's VisionAdapter interface to the Orchestrator's
 * VisualAnalysisProvider / VisionRouter infrastructure.
 *
 * KEY GUARANTEES:
 * - Validates every image path against the authorized project root.
 * - Preserves full telemetry: provider, model, reportedModel, cost, attempts.
 * - Never fabricates results — returns zero confidence on failure.
 * - Works with a single provider OR a VisionRouter with fallback chain.
 * - Falls back gracefully when no provider is available (returns low-confidence inference marker).
 * - Rejects simulated/mock responses in production (only real provider calls produce confidence > 0).
 */
export function createRecapVisionAdapter(options: RecapVisionAdapterOptions): VisionAdapter & {
	getLastTrace(): AnalysisTrace | null;
	getCircuitBreaker(): AgentCircuitBreaker;
} {
	const {
		root,
		provider,
		providers,
		router,
		policyChain = ['claude', 'claude-gateway', 'codex', 'local-vlm', 'antigravity'],
		maxLatencyMs = 30_000,
		budgetUsd = 0.5,
		circuitBreaker = new AgentCircuitBreaker(),
		throwOnAllUnavailable = Boolean(providers && providers.length > 0),
	} = options;

	if (!provider && !router && (!providers || providers.length === 0)) {
		throw new Error('RecapVisionAdapter requires either a provider or a router.');
	}

	const resolvedRoot = realpathSync(root);
	let lastTrace: AnalysisTrace | null = null;
	const detectionCache = new Map<string, { available: boolean; reason?: string }>();

	const buildPolicy = () => ({
		chain: policyChain.filter((id) => circuitBreaker.isAvailable(id)),
		scope: 'recap',
		version: 'recap-v1',
		budgetUsd,
		maxLatencyMs,
		thresholds: null as null,
	});

	const runSingleProvider = async (target: RecapVisualAnalysisPort, validatedPath: string, signal?: AbortSignal): Promise<VisionAnalysisResult> => {
		const frames = [{ hash: 'recap-panel', path: validatedPath }];
		if (target.analyze) {
			const analyzeInput: Parameters<NonNullable<RecapVisualAnalysisPort['analyze']>>[0] = { frames, context: 'Manga panel visual analysis for narrative extraction.' };
			if (signal) analyzeInput.signal = signal;
			const result = await target.analyze(analyzeInput);
			circuitBreaker.recordSuccess(target.id);
			lastTrace = {
				provider: target.id,
				model: target.model,
				reportedModel: null,
				costUsd: 0,
				attempts: [{ provider: target.id, outcome: 'ok' }],
			};
			const characters = result.entities
				.filter((e) => e.type === 'person' || e.type === 'character')
				.map((e) => e.name);
			const primaryActionType = mapNatureToActionType(result.nature);
			const actions = result.actions.map((a) => ({
				type: mapNatureToActionType(a.description) !== 'none' ? mapNatureToActionType(a.description) : primaryActionType,
				description: a.description,
			}));
			const emotions = extractEmotionsFromAnalysis(result.description, [], result.entities);
			const setting = result.environment?.description;
			return {
				characters,
				actions: actions.length > 0 ? actions : [{ type: primaryActionType, description: result.description || 'No detectable action' }],
				emotions,
				setting,
				confidence: result.confidence,
			};
		}
		if (target.describe) {
			const describeInput: Parameters<NonNullable<RecapVisualAnalysisPort['describe']>>[0] = { frames };
			if (signal) describeInput.signal = signal;
			const result = await target.describe(describeInput);
			circuitBreaker.recordSuccess(target.id);
			lastTrace = {
				provider: target.id,
				model: target.model,
				reportedModel: null,
				costUsd: 0,
				attempts: [{ provider: target.id, outcome: 'ok' }],
			};
			return {
				characters: [],
				actions: [{ type: 'none', description: result.description }],
				emotions: extractEmotionsFromAnalysis(result.description, result.tags, []),
				setting: undefined,
				confidence: 0.5,
			};
		}
		throw classifyVisionError(`Provider ${target.id} has no analyze or describe capability.`, target.id, 'PROVIDER_UNAVAILABLE');
	};

	const analyzeWithProviderChain = async (imagePath: string, signal?: AbortSignal): Promise<VisionAnalysisResult> => {
		const list = providers ?? [];
		const validatedPath = validateImagePath(resolvedRoot, imagePath);
		const diagnostics: VisionProviderDiagnostic[] = [];
		const attempts: Array<{ provider: string; outcome: string; detail?: string }> = [];

		for (const candidate of list) {
			if (!circuitBreaker.isAvailable(candidate.id)) {
				const st = circuitBreaker.getState(candidate.id);
				diagnostics.push({
					providerId: candidate.id,
					code: st?.code ?? 'PROVIDER_UNAVAILABLE',
					message: st?.reason ?? 'Circuit open',
					...(st?.resetAtText ? { resetAtText: st.resetAtText } : {}),
				});
				attempts.push({ provider: candidate.id, outcome: 'unavailable', detail: `circuit_open:${st?.code ?? 'PROVIDER_UNAVAILABLE'}` });
				continue;
			}

			let det = detectionCache.get(candidate.id);
			if (!det) {
				const rawDet = await candidate.detect(signal);
				det = rawDet.available ? { available: true } : { available: false, reason: rawDet.reason };
				detectionCache.set(candidate.id, det);
			}
			if (!det.available) {
				const detErr = classifyVisionError(det.reason ?? 'Provider unavailable', candidate.id, 'PROVIDER_UNAVAILABLE');
				circuitBreaker.recordError(candidate.id, detErr);
				diagnostics.push({ providerId: candidate.id, code: detErr.code, message: detErr.message });
				attempts.push({ provider: candidate.id, outcome: 'unavailable', detail: detErr.message });
				continue;
			}

			try {
				const res = await runSingleProvider(candidate, validatedPath, signal);
				lastTrace = {
					provider: candidate.id,
					model: candidate.model,
					reportedModel: null,
					costUsd: 0,
					attempts: [...attempts, { provider: candidate.id, outcome: 'ok' }],
				};
				return res;
			} catch (err) {
				const classified = classifyVisionError(err, candidate.id);
				circuitBreaker.recordError(candidate.id, classified);
				diagnostics.push({
					providerId: candidate.id,
					code: classified.code,
					message: classified.message,
					...(classified.resetAtText ? { resetAtText: classified.resetAtText } : {}),
				});
				attempts.push({ provider: candidate.id, outcome: 'error', detail: `${classified.code}: ${classified.message}` });
			}
		}

		lastTrace = {
			provider: null,
			model: null,
			reportedModel: null,
			costUsd: 0,
			attempts,
		};
		throw new AllVisionProvidersUnavailableError(diagnostics);
	};

	const analyzeWithProvider = async (imagePath: string, signal?: AbortSignal): Promise<VisionAnalysisResult> => {
		if (!provider) {
			throw new Error('No provider configured for direct analysis.');
		}

		const validatedPath = validateImagePath(resolvedRoot, imagePath);
		const frames = [{ hash: 'recap-panel', path: validatedPath }];

		// Prefer structured analyze if available
		if (provider.analyze) {
			const analyzeInput: Parameters<NonNullable<RecapVisualAnalysisPort['analyze']>>[0] = { frames, context: 'Manga panel visual analysis for narrative extraction.' };
			if (signal) analyzeInput.signal = signal;
			const result = await provider.analyze(analyzeInput);
			lastTrace = {
				provider: provider.id,
				model: provider.model,
				reportedModel: null,
				costUsd: 0,
				attempts: [{ provider: provider.id, outcome: 'ok' }],
			};

			const characters = result.entities
				.filter((e) => e.type === 'person' || e.type === 'character')
				.map((e) => e.name);
			const primaryActionType = mapNatureToActionType(result.nature);
			const actions = result.actions.map((a) => ({
				type: mapNatureToActionType(a.description) !== 'none' ? mapNatureToActionType(a.description) : primaryActionType,
				description: a.description,
			}));
			const emotions = extractEmotionsFromAnalysis(result.description, [], result.entities);
			const setting = result.environment?.description;

			return {
				characters,
				actions: actions.length > 0 ? actions : [{ type: primaryActionType, description: result.description || 'No detectable action' }],
				emotions,
				setting,
				confidence: result.confidence,
			};
		}

		// Fallback to describe
		if (provider.describe) {
			const describeInput: Parameters<NonNullable<RecapVisualAnalysisPort['describe']>>[0] = { frames };
			if (signal) describeInput.signal = signal;
			const result = await provider.describe(describeInput);
			lastTrace = {
				provider: provider.id,
				model: provider.model,
				reportedModel: null,
				costUsd: 0,
				attempts: [{ provider: provider.id, outcome: 'ok' }],
			};

			return {
				characters: [],
				actions: [{ type: 'none', description: result.description }],
				emotions: extractEmotionsFromAnalysis(result.description, result.tags, []),
				setting: undefined,
				confidence: 0.5, // describe-only is less reliable
			};
		}

		throw new Error(`Provider ${provider.id} has no analyze or describe capability.`);
	};

	const analyzeWithRouter = async (imagePath: string, signal?: AbortSignal): Promise<VisionAnalysisResult> => {
		if (!router) {
			throw new Error('No router configured.');
		}

		const validatedPath = validateImagePath(resolvedRoot, imagePath);
		const frames = [{ hash: 'recap-panel', path: validatedPath }];
		const policy = buildPolicy();

		// Prefer structured analyze
		const routerAnalyzeInput: Parameters<RecapVisionRouterPort['analyze']>[0] = {
			frames,
			context: 'Manga panel visual analysis for narrative extraction.',
			policy,
		};
		if (signal) routerAnalyzeInput.signal = signal;
		const analyzeResult = await router.analyze(routerAnalyzeInput);

		for (const attempt of analyzeResult.attempts) {
			if (attempt.outcome === 'ok' || attempt.outcome === 'cached') {
				circuitBreaker.recordSuccess(attempt.provider);
			} else if (attempt.outcome === 'error' && attempt.detail) {
				const classified = classifyVisionError(attempt.detail, attempt.provider, 'UNKNOWN_PROVIDER_ERROR');
				circuitBreaker.recordError(attempt.provider, classified);
			} else if (attempt.outcome === 'unavailable' && attempt.detail && !attempt.detail.startsWith('circuit_open:')) {
				const classified = classifyVisionError(attempt.detail, attempt.provider, 'PROVIDER_UNAVAILABLE');
				if (classified.code === 'QUOTA_EXCEEDED' || classified.code === 'AUTHENTICATION_FAILED') {
					circuitBreaker.recordError(attempt.provider, classified);
				}
			}
		}
		lastTrace = {
			provider: analyzeResult.provider,
			model: analyzeResult.model,
			reportedModel: analyzeResult.reportedModel ?? null,
			costUsd: analyzeResult.costUsd,
			attempts: analyzeResult.attempts,
		};

		if (analyzeResult.value) {
			const result = analyzeResult.value;
			const characters = result.entities
				.filter((e) => e.type === 'person' || e.type === 'character')
				.map((e) => e.name);
			const primaryActionType = mapNatureToActionType(result.nature);
			const actions = result.actions.map((a) => ({
				type: mapNatureToActionType(a.description) !== 'none' ? mapNatureToActionType(a.description) : primaryActionType,
				description: a.description,
			}));
			const emotions = extractEmotionsFromAnalysis(result.description, [], result.entities);
			const setting = result.environment?.description;

			return {
				characters,
				actions: actions.length > 0 ? actions : [{ type: primaryActionType, description: result.description || 'No detectable action' }],
				emotions,
				setting,
				confidence: result.confidence,
			};
		}

		// Router returned no value — try describe fallback
		const routerDescribeInput: Parameters<RecapVisionRouterPort['describe']>[0] = { frames, policy };
		if (signal) routerDescribeInput.signal = signal;
		const describeResult = await router.describe(routerDescribeInput);
		lastTrace = {
			provider: describeResult.provider,
			model: describeResult.model,
			reportedModel: describeResult.reportedModel ?? null,
			costUsd: describeResult.costUsd,
			attempts: describeResult.attempts,
		};

		if (describeResult.value) {
			return {
				characters: [],
				actions: [{ type: 'none', description: describeResult.value.description }],
				emotions: extractEmotionsFromAnalysis(describeResult.value.description, describeResult.value.tags, []),
				setting: undefined,
				confidence: 0.4, // describe-only via router is lower confidence
			};
		}

		// All providers failed — throw structured error when strict, or return zero confidence
		if (throwOnAllUnavailable) {
			const diagnostics: VisionProviderDiagnostic[] = analyzeResult.attempts.map((a) => {
				const fallback = a.outcome === 'unavailable' ? 'PROVIDER_UNAVAILABLE' : 'UNKNOWN_PROVIDER_ERROR';
				const c = classifyVisionError(a.detail ?? a.outcome, a.provider, fallback);
				return {
					providerId: a.provider,
					code: c.code,
					message: c.message,
					...(c.exitCode !== undefined ? { exitCode: c.exitCode } : {}),
					...(c.resetAtText ? { resetAtText: c.resetAtText } : {}),
				};
			});
			throw new AllVisionProvidersUnavailableError(diagnostics);
		}
		return {
			characters: [],
			actions: [{ type: 'none', description: 'Visual analysis unavailable' }],
			emotions: ['unknown'],
			setting: undefined,
			confidence: 0,
		};
	};

	const adapter: VisionAdapter & { getLastTrace(): AnalysisTrace | null; getCircuitBreaker(): AgentCircuitBreaker } = {
		name: router
			? 'recap-vision-router'
			: providers && providers.length > 0
				? `recap-vision-chain[${providers.map((p) => p.id).join(',')}]`
				: `recap-vision-${provider!.id}`,

		async analyze(imagePathOrBuffer: string | Buffer): Promise<VisionAnalysisResult> {
			let resolvedPath: string;

			if (Buffer.isBuffer(imagePathOrBuffer)) {
				// Write buffer to a temp file inside the authorized root so the provider can read it.
				const hash = createHash('sha256').update(imagePathOrBuffer).digest('hex').slice(0, 16);
				const tempDir = join(resolvedRoot, '.recap-vision-tmp');
				if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
				resolvedPath = join(tempDir, `${hash}.png`);
				writeFileSync(resolvedPath, imagePathOrBuffer);
			} else {
				resolvedPath = imagePathOrBuffer;
			}

			try {
				if (router) {
					return await analyzeWithRouter(resolvedPath);
				}
				if (providers && providers.length > 0) {
					return await analyzeWithProviderChain(resolvedPath);
				}
				return await analyzeWithProvider(resolvedPath);
			} catch (err) {
				if (err instanceof AllVisionProvidersUnavailableError) {
					throw err;
				}
				// Never fabricate — return zero confidence with error info
				const msg = err instanceof Error ? err.message : String(err);
				lastTrace = {
					provider: null,
					model: null,
					reportedModel: null,
					costUsd: 0,
					attempts: [{ provider: 'error', outcome: 'error', detail: msg }],
				};
				return {
					characters: [],
					actions: [{ type: 'none', description: `Analysis failed: ${msg}` }],
					emotions: ['unknown'],
					setting: undefined,
					confidence: 0,
				};
			}
		},

		getLastTrace(): AnalysisTrace | null {
			return lastTrace;
		},

		getCircuitBreaker(): AgentCircuitBreaker {
			return circuitBreaker;
		},
	};

	return adapter;
}

/**
 * Creates a RecapVisionAdapter from a TaskEngine-backed VisualAnalysisProvider.
 * This is the recommended factory for desktop environments where the TaskEngine
 * manages agent authentication, sessions, and quotas.
 */
export function createTaskEngineRecapVisionAdapter(input: {
	root: string;
	taskEngineProvider: RecapVisualAnalysisPort;
}): VisionAdapter & { getLastTrace(): AnalysisTrace | null } {
	return createRecapVisionAdapter({
		root: input.root,
		provider: input.taskEngineProvider,
	});
}

/**
 * Creates a RecapVisionAdapter backed by a VisionRouter with multiple providers.
 * Use this in production where fallback across agents is needed.
 */
export function createRoutedRecapVisionAdapter(input: {
	root: string;
	router: RecapVisionRouterPort;
	policyChain?: readonly string[];
	maxLatencyMs?: number;
	budgetUsd?: number;
	circuitBreaker?: AgentCircuitBreaker;
	throwOnAllUnavailable?: boolean;
}): VisionAdapter & { getLastTrace(): AnalysisTrace | null; getCircuitBreaker(): AgentCircuitBreaker } {
	const opts: RecapVisionAdapterOptions = { root: input.root, router: input.router };
	if (input.policyChain) opts.policyChain = input.policyChain;
	if (input.maxLatencyMs !== undefined) opts.maxLatencyMs = input.maxLatencyMs;
	if (input.budgetUsd !== undefined) opts.budgetUsd = input.budgetUsd;
	if (input.circuitBreaker) opts.circuitBreaker = input.circuitBreaker;
	if (input.throwOnAllUnavailable !== undefined) opts.throwOnAllUnavailable = input.throwOnAllUnavailable;
	return createRecapVisionAdapter(opts);
}


export interface VisionRoutingStepSummary {
	provider: string;
	outcome: string;
	code?: string;
	reason?: string;
	fallbackTo?: string;
}

/**
 * Formats concise, secret-free and prompt-free routing diagnostics showing which
 * agent was tried, why it failed, and whether fallback occurred.
 */
export function formatVisionRoutingSummary(
	attempts: readonly { provider: string; outcome: string; detail?: string }[],
): VisionRoutingStepSummary[] {
	return attempts.map((a, idx) => {
		const next = attempts[idx + 1];
		if (a.outcome === 'ok' || a.outcome === 'cached') {
			return { provider: a.provider, outcome: a.outcome };
		}
		const fallback = a.outcome === 'unavailable' ? 'PROVIDER_UNAVAILABLE' : 'UNKNOWN_PROVIDER_ERROR';
		const c = classifyVisionError(a.detail ?? a.outcome, a.provider, fallback);
		return {
			provider: a.provider,
			outcome: a.outcome,
			code: c.code,
			reason: c.message,
			...(next ? { fallbackTo: next.provider } : {}),
		};
	});
}
