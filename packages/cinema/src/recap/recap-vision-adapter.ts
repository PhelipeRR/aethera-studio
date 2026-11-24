import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { isAbsolute, join, relative } from 'node:path';
import type {
	VisionAdapter,
	VisionAnalysisContext,
	VisionAnalysisResult,
	RecapPanelRouteTier,
	ActionType,
	Emotion,
	DialogueEntry,
	CharacterDetail,
} from './recap-types.js';
import { classifyBubbleKind } from './dialogue-extractor.js';
import { annotateRecapDialogue } from './recap-text-classification.js';
import { AllVisionProvidersUnavailableError, classifyVisionError, type VisionProviderDiagnostic } from './vision-error-classifier.js';
import { AgentCircuitBreaker } from './vision-circuit-breaker.js';

/**
 * Port interface matching the subset of VisualAnalysisProvider that Recap needs.
 * This decouples the Cinema package from the Orchestrator's full vision-router types,
 * allowing the adapter to work with any provider that implements this contract.
 */
export interface StructuredVisionPayload {
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
	speechBubbles?: readonly DialogueEntry[];
	expressions?: readonly string[];
	relevantObjects?: readonly string[];
	characterDetails?: readonly CharacterDetail[];
	readingOrderHint?: string;
	relationToPrevious?: string;
	relationToNext?: string;
	usage?: VisionAnalysisResult['usage'];
	deduped?: boolean;
}

export interface RecapVisualAnalysisPort {
	readonly id: string;
	readonly model: string;
	readonly supportsMultimodal?: boolean;
	/** Model the provider reports it actually ran on its last call, when it knows. */
	lastReportedModel?(): string | null;
	/** Token/cost usage for the last provider call, when available. */
	lastUsage?(): VisionAnalysisResult['usage'] | null;
	describe?(input: {
		frames: readonly { hash: string; path: string; atMs?: number }[];
		signal?: AbortSignal;
	}): Promise<{ description: string; tags: string[] }>;
	analyze?(input: {
		frames: readonly { hash: string; path: string; atMs?: number }[];
		context?: string;
		signal?: AbortSignal;
	}): Promise<StructuredVisionPayload>;
	detect(signal?: AbortSignal): Promise<{ available: true; multimodal?: boolean } | { available: false; reason: string }>;
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
		usage?: VisionAnalysisResult['usage'];
		deduped?: boolean;
	}>;
	analyze(input: {
		frames: readonly { hash: string; path: string; atMs?: number }[];
		context?: string;
		policy: { chain: readonly string[]; scope: string; version: string; budgetUsd: number; maxLatencyMs: number; thresholds: null };
		signal?: AbortSignal;
	}): Promise<{
		value: StructuredVisionPayload | null;
		provider: string | null;
		model: string | null;
		costUsd: number;
		attempts: readonly { provider: string; outcome: string; detail?: string; durationMs?: number }[];
		reportedModel?: string | null;
		usage?: VisionAnalysisResult['usage'];
		deduped?: boolean;
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
	/** Optional tier-specific chains selected by Phase 2 triage. */
	routeChains?: Partial<Record<RecapPanelRouteTier, readonly string[]>>;
	/** Version of the persisted routing policy, independent from the prompt/cache schema version. */
	policyVersion?: string;
	/** Host executing the provider call, when known. */
	hostExecutor?: string;
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
	usage?: VisionAnalysisResult['usage'];
	policyVersion?: string;
	routeTier?: RecapPanelRouteTier | null;
	routeReason?: string | null;
	fallbackReason?: string | null;
	hostExecutor?: string | null;
}

function firstFallbackReason(attempts: readonly { outcome: string; detail?: string }[]): string | null {
	return attempts.find((attempt) => attempt.outcome !== 'ok' && attempt.outcome !== 'cached')?.detail ?? null;
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
	alegria: 'joy',
	feliz: 'joy',
	sorriso: 'joy',
	sad: 'sadness',
	cry: 'sadness',
	tristeza: 'sadness',
	triste: 'sadness',
	choro: 'sadness',
	anger: 'anger',
	angry: 'anger',
	raiva: 'anger',
	furia: 'anger',
	fúria: 'anger',
	ira: 'anger',
	fear: 'fear',
	scared: 'fear',
	medo: 'fear',
	pavor: 'fear',
	assustado: 'fear',
	surprise: 'surprise',
	shocked: 'surprise',
	surpresa: 'surprise',
	choque: 'surprise',
	chocado: 'surprise',
	determination: 'determination',
	determined: 'determination',
	determinacao: 'determination',
	determinação: 'determination',
	determinado: 'determination',
	tension: 'tension',
	tense: 'tension',
	tensao: 'tension',
	tensão: 'tension',
	tenso: 'tension',
	relief: 'relief',
	relieved: 'relief',
	alivio: 'relief',
	alívio: 'relief',
	confusion: 'confusion',
	confused: 'confusion',
	confusao: 'confusion',
	confusão: 'confusion',
	confuso: 'confusion',
};

/**
 * Prompt version of the recap analyze route. It is part of the VisionRouter persistent cache key,
 * so it must change whenever the local analyze prompt or the vision context wording changes:
 * otherwise an unchanged panel context replays the answer produced by the previous prompt.
 * recap-v2-identity-sfx: hangul SFX never transcribed; visual labels only reused for the same person.
 */
export const RECAP_VISION_PROMPT_VERSION = 'recap-v2-identity-sfx';

export function buildRecapVisionContextString(context?: VisionAnalysisContext): string {
	const parts: string[] = [
		'Análise multimodal de painel de mangá/manhwa em PT-BR: identifique personagens visíveis, cenário, ações observáveis, expressões, objetos relevantes e TODOS os balões/textos visíveis em ordem de leitura. Não use jargões de câmera (plano geral, plongée, close-up) nem invente falas ou nomes.',
	];
	if (context?.workTitle) parts.push(`Obra: ${context.workTitle}.`);
	if (context?.panelIndex !== undefined && context?.totalPanels !== undefined) {
		parts.push(`Painel ${context.panelIndex + 1} de ${context.totalPanels}.`);
	}
	if (context?.readingOrder) parts.push(`Ordem de leitura: ${context.readingOrder}.`);
	if (context?.storyMemoryContext) {
		const mem = context.storyMemoryContext;
		if (mem.characters.length > 0) {
			const chars = mem.characters
				.slice(0, 8)
				.map((c) => `${c.displayName}${c.aliases.length > 0 ? ` (${c.aliases[0]})` : ''}`)
				.join(', ');
			parts.push(`Memória da história (cap. < ${mem.currentChapterNumber}): ${chars}.`);
		}
		if (mem.recentEvents.length > 0) {
			parts.push(`Eventos anteriores: ${mem.recentEvents.slice(0, 3).join(' | ').slice(0, 200)}.`);
		}
	} else if (!context?.narrativeMemory && context?.knownCharacters && context.knownCharacters.length > 0) {
		parts.push(`Rótulos visuais já usados (reutilize só para a mesma pessoa, com a mesma roupa): ${context.knownCharacters.slice(0, 8).join('; ')}.`);
	}
	if (context?.narrativeMemory) {
		const memory = context.narrativeMemory;
		if (memory.characters.length > 0 && !context?.storyMemoryContext) {
			parts.push(`Rótulos visuais já usados (reutilize só para a mesma pessoa, com a mesma roupa): ${memory.characters.slice(-6).join('; ')}.`);
		}
		if (memory.recentEvents.length > 0) {
			parts.push(`Evento recente compacto: ${memory.recentEvents[memory.recentEvents.length - 1]!.slice(0, 140)}.`);
		}
		// The current setting is already included in the bounded latest event;
		// avoid sending it twice on every panel.
		if (memory.openQuestions.length > 0) parts.push(`Incerteza aberta: ${memory.openQuestions[memory.openQuestions.length - 1]!.slice(0, 100)}.`);
	}
	if (context?.previousPanelSummary && !context?.narrativeMemory) {
		parts.push(`Contexto do painel anterior: ${context.previousPanelSummary.slice(0, 220)}.`);
	}
	if (context?.ocrHint) {
		parts.push(`Texto OCR auxiliar (pode conter ruído): ${context.ocrHint.slice(0, 220)}.`);
	}
	return parts.join(' ');
}

function mapStructuredVisionResult(result: StructuredVisionPayload): VisionAnalysisResult {
	const characters = result.entities
		.filter((e) => e.type === 'person' || e.type === 'character')
		.map((e) => e.name.trim())
		.filter((n) => n.length > 0);
	const objectEntities = result.entities
		.filter((e) => e.type === 'object' || e.type === 'vehicle' || e.type === 'creature')
		.map((e) => e.name.trim())
		.filter((n) => n.length > 0);
	const relevantObjects = [...new Set([...(result.relevantObjects ?? []), ...objectEntities])];

	const primaryActionType = mapNatureToActionType(result.nature);
	const actions = result.actions
		.filter((a) => a.description.trim().length > 0)
		.map((a) => ({
			type: mapNatureToActionType(a.description) !== 'none' ? mapNatureToActionType(a.description) : primaryActionType,
			description: a.description.trim(),
		}));

	const visualDescription = result.description?.trim() || undefined;
	const emotions = extractEmotionsFromAnalysis(
		[result.description, ...(result.expressions ?? [])].join(' '),
		[],
		result.entities,
	);
	const setting = result.environment?.description?.trim() || undefined;

	// Extract speech bubbles from explicit speechBubbles OR fallback to frames[].visibleText
	let speechBubbles: DialogueEntry[] = [];
	if (result.speechBubbles && result.speechBubbles.length > 0) {
		speechBubbles = result.speechBubbles.map((b, idx) => annotateRecapDialogue({
			entry: { ...b, readingOrder: b.readingOrder ?? idx },
			lineIndex: b.readingOrder ?? idx,
			source: 'vision',
			balloonPresent: true,
			balloon: b.kind === 'sfx' ? 'jagged' : b.kind === 'narration' ? 'narration' : b.kind === 'thought' ? 'thought' : 'speech',
		}));
	} else {
		const rawTexts = result.frames.flatMap((f) => f.visibleText ?? []);
		speechBubbles = rawTexts
			.map((vt, idx) => {
				const text = vt.text.trim();
				if (!text) return null;
				const kind = classifyBubbleKind(text, undefined, vt.region === 'overlay');
				return annotateRecapDialogue({
					entry: {
					text,
					originalText: text,
					kind,
					isNarration: kind === 'narration',
					readingOrder: idx,
					},
					lineIndex: idx,
					source: 'vision',
					balloonPresent: vt.region === 'overlay' ? false : true,
					balloon: vt.region === 'overlay' ? 'none' : kind === 'narration' ? 'narration' : kind === 'sfx' ? 'jagged' : 'speech',
				});
			})
			.filter((b): b is DialogueEntry => b !== null);
	}

	const uncertainties = [...(result.limitations ?? [])].map((u) => u.trim()).filter(Boolean);

	return {
		...(visualDescription ? { visualDescription } : {}),
		characters,
		...(result.characterDetails && result.characterDetails.length > 0 ? { characterDetails: [...result.characterDetails] } : {}),
		actions: actions.length > 0
			? actions
			: visualDescription
				? [{ type: primaryActionType, description: visualDescription }]
				: [],
		emotions,
		...(result.expressions && result.expressions.length > 0 ? { expressions: [...result.expressions] } : {}),
		...(relevantObjects.length > 0 ? { relevantObjects } : {}),
		...(speechBubbles.length > 0 ? { speechBubbles } : {}),
		setting,
		...(result.readingOrderHint ? { readingOrderHint: result.readingOrderHint } : {}),
		...(result.relationToPrevious ? { relationToPrevious: result.relationToPrevious } : {}),
		...(result.relationToNext ? { relationToNext: result.relationToNext } : {}),
		...(uncertainties.length > 0 ? { uncertainties } : {}),
		confidence: result.confidence,
		...(result.usage ? { usage: result.usage } : {}),
	};
}

function mapNatureToActionType(nature: string): ActionType {
	const mapped = ACTION_TYPE_MAP[nature.toLowerCase()];
	return mapped ?? 'none';
}

function extractEmotionsFromText(text: string): Emotion[] {
	const lower = text.toLowerCase();
	const emotions: Emotion[] = [];
	for (const [keyword, emotion] of Object.entries(EMOTION_KEYWORDS)) {
		const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const re = new RegExp(`(^|[^a-zà-ú])${escaped}($|[^a-zà-ú])`, 'i');
		if (re.test(lower) && !emotions.includes(emotion)) {
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
		policyChain = ['codex', 'antigravity', 'claude', 'claude-gateway'],
		routeChains,
		policyVersion = 'recap-routing-4a-v1',
		hostExecutor = 'unknown',
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
	const inFlight = new Map<string, Promise<VisionAnalysisResult>>();

	const buildPolicy = (context?: VisionAnalysisContext) => ({
		chain: (context?.routeTier && routeChains?.[context.routeTier] ? routeChains[context.routeTier]! : policyChain).filter((id) => circuitBreaker.isAvailable(id)),
		scope: 'recap',
		version: RECAP_VISION_PROMPT_VERSION,
		budgetUsd,
		maxLatencyMs,
		thresholds: null as null,
	});

	const runSingleProvider = async (
		target: RecapVisualAnalysisPort,
		validatedPath: string,
		context?: VisionAnalysisContext,
		signal?: AbortSignal,
	): Promise<VisionAnalysisResult> => {
		const imageHash = createHash('sha256').update(readFileSync(validatedPath)).digest('hex');
		const frames = [{ hash: imageHash, path: validatedPath }];
		const dedupeKey = `${target.id}::${imageHash}::${buildRecapVisionContextString(context)}`;
		const existing = inFlight.get(dedupeKey);
		if (existing) return existing.then((result) => ({ ...result, deduped: true }));
		const operation = (async (): Promise<VisionAnalysisResult> => {
		if (target.analyze) {
			const analyzeInput: Parameters<NonNullable<RecapVisualAnalysisPort['analyze']>>[0] = {
				frames,
				context: buildRecapVisionContextString(context),
			};
			if (signal) analyzeInput.signal = signal;
			const result = await target.analyze(analyzeInput);
			circuitBreaker.recordSuccess(target.id);
			lastTrace = {
				provider: target.id,
				model: target.model,
				reportedModel: null,
				costUsd: 0,
				attempts: [{ provider: target.id, outcome: 'ok' }],
				...(target.lastUsage?.() ? { usage: target.lastUsage?.() ?? undefined } : {}),
				policyVersion,
				routeTier: context?.routeTier ?? null,
				routeReason: context?.routeReason ?? null,
						fallbackReason: null,
				hostExecutor,
			};
			const usage = result.usage ?? target.lastUsage?.() ?? undefined;
			return { ...mapStructuredVisionResult(result), ...(usage ? { usage } : {}) };
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
				policyVersion,
				routeTier: context?.routeTier ?? null,
				routeReason: context?.routeReason ?? null,
						fallbackReason: null,
				hostExecutor,
			};
			return {
				visualDescription: result.description,
				characters: [],
				actions: [{ type: 'none', description: result.description }],
				emotions: extractEmotionsFromAnalysis(result.description, result.tags, []),
				setting: undefined,
				uncertainties: ['Análise obtida em modo describe-only (sem extração estruturada de balões/entidades).'],
				confidence: 0.5,
			};
		}
		throw classifyVisionError(`Provider ${target.id} has no analyze or describe capability.`, target.id, 'PROVIDER_UNAVAILABLE');
		})();
		inFlight.set(dedupeKey, operation);
		try {
			return await operation;
		} finally {
			if (inFlight.get(dedupeKey) === operation) inFlight.delete(dedupeKey);
		}
	};

	const analyzeWithProviderChain = async (
		imagePath: string,
		context?: VisionAnalysisContext,
		signal?: AbortSignal,
	): Promise<VisionAnalysisResult> => {
		const list = providers ?? [];
		const validatedPath = validateImagePath(resolvedRoot, imagePath);
		const diagnostics: VisionProviderDiagnostic[] = [];
		const attempts: Array<{ provider: string; outcome: string; detail?: string }> = [];

		for (const candidate of list) {
			if (candidate.supportsMultimodal === false) {
				const mmErr = classifyVisionError('Agente sem suporte multimodal real (apenas texto).', candidate.id, 'MODEL_INCOMPATIBLE');
				circuitBreaker.recordError(candidate.id, mmErr);
				diagnostics.push({ providerId: candidate.id, code: mmErr.code, message: mmErr.message });
				attempts.push({ provider: candidate.id, outcome: 'unavailable', detail: mmErr.message });
				continue;
			}
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
				if (rawDet.available && rawDet.multimodal === false) {
					det = { available: false, reason: 'Agente sem suporte multimodal real (apenas texto).' };
				} else {
					det = rawDet.available ? { available: true } : { available: false, reason: rawDet.reason };
				}
				detectionCache.set(candidate.id, det);
			}
			if (!det.available) {
				const fallbackCode = det.reason?.includes('suporte multimodal') ? 'MODEL_INCOMPATIBLE' : 'PROVIDER_UNAVAILABLE';
				const detErr = classifyVisionError(det.reason ?? 'Provider unavailable', candidate.id, fallbackCode);
				circuitBreaker.recordError(candidate.id, detErr);
				diagnostics.push({ providerId: candidate.id, code: detErr.code, message: detErr.message });
				attempts.push({ provider: candidate.id, outcome: 'unavailable', detail: detErr.message });
				continue;
			}

			try {
				const res = await runSingleProvider(candidate, validatedPath, context, signal);
					lastTrace = {
						...(lastTrace ?? {}),
					provider: candidate.id,
					model: candidate.model,
					reportedModel: null,
					costUsd: 0,
					attempts: [...attempts, { provider: candidate.id, outcome: 'ok' }],
						fallbackReason: firstFallbackReason(attempts),
						policyVersion,
						routeTier: context?.routeTier ?? null,
						routeReason: context?.routeReason ?? null,
						hostExecutor,
				};
				return res;
			} catch (err) {
				const classified = classifyVisionError(err, candidate.id);
				circuitBreaker.recordError(candidate.id, classified);
				diagnostics.push({
					providerId: candidate.id,
					code: classified.code,
					message: classified.message,
					...(classified.exitCode !== undefined ? { exitCode: classified.exitCode } : {}),
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
				fallbackReason: firstFallbackReason(attempts),
				policyVersion,
				routeTier: context?.routeTier ?? null,
				routeReason: context?.routeReason ?? null,
				hostExecutor,
		};
		throw new AllVisionProvidersUnavailableError(diagnostics);
	};

	const analyzeWithProvider = async (
		imagePath: string,
		context?: VisionAnalysisContext,
		signal?: AbortSignal,
	): Promise<VisionAnalysisResult> => {
		if (!provider) {
			throw new Error('No provider configured for direct analysis.');
		}

		const validatedPath = validateImagePath(resolvedRoot, imagePath);
		return runSingleProvider(provider, validatedPath, context, signal);
	};

	const analyzeWithRouter = async (
		imagePath: string,
		context?: VisionAnalysisContext,
		signal?: AbortSignal,
	): Promise<VisionAnalysisResult> => {
		if (!router) {
			throw new Error('No router configured.');
		}

		const validatedPath = validateImagePath(resolvedRoot, imagePath);
		const imageHash = createHash('sha256').update(readFileSync(validatedPath)).digest('hex');
		const frames = [{ hash: imageHash, path: validatedPath }];
		const policy = buildPolicy(context);

		if (policy.chain.length === 0) {
			const diagnostics: VisionProviderDiagnostic[] = policyChain.map((id) => {
				const st = circuitBreaker.getState(id);
				return {
					providerId: id,
					code: st?.code ?? 'PROVIDER_UNAVAILABLE',
					message: st?.reason ?? 'Circuit breaker open',
					...(st?.resetAtText ? { resetAtText: st.resetAtText } : {}),
				};
			});
			lastTrace = {
				provider: null,
				model: null,
				reportedModel: null,
				costUsd: 0,
				attempts: diagnostics.map((d) => ({ provider: d.providerId, outcome: 'unavailable', detail: `circuit_open:${d.code}` })),
					fallbackReason: firstFallbackReason(diagnostics.map((d) => ({ outcome: 'unavailable', detail: d.message }))),
					policyVersion,
					routeTier: context?.routeTier ?? null,
					routeReason: context?.routeReason ?? null,
					hostExecutor,
			};
			if (throwOnAllUnavailable) {
				throw new AllVisionProvidersUnavailableError(diagnostics);
			}
			return {
				characters: [],
				actions: [],
				emotions: ['unknown'],
				setting: undefined,
				uncertainties: ['Análise visual indisponível em todos os provedores configurados.'],
				confidence: 0,
			};
		}

		// Prefer structured analyze
		const routerAnalyzeInput: Parameters<RecapVisionRouterPort['analyze']>[0] = {
			frames,
			context: buildRecapVisionContextString(context),
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
				fallbackReason: firstFallbackReason(analyzeResult.attempts),
			...(analyzeResult.usage ? { usage: analyzeResult.usage } : {}),
			...(analyzeResult.deduped ? { deduped: true } : {}),
			policyVersion,
			routeTier: context?.routeTier ?? null,
			routeReason: context?.routeReason ?? null,
			hostExecutor,
		};

		if (analyzeResult.value) {
			return {
				...mapStructuredVisionResult(analyzeResult.value),
				...(analyzeResult.usage ? { usage: analyzeResult.usage } : {}),
				...(analyzeResult.deduped ? { deduped: true } : {}),
			};
		}

		// Router returned no value — try describe fallback only if at least one provider remains available.
		// A local hard-budget pause (RECAP_PILOT_*) is not a provider failure: falling back would
		// spend another route on a job that must stop, so it goes straight to the pause path.
		const budgetPaused = analyzeResult.attempts.some((attempt) => /RECAP_PILOT_(?:BUDGET_EXCEEDED|PAUSED|VRAM_EXCEEDED)/u.test(attempt.detail ?? ''));
		const describePolicy = buildPolicy(context);
		if (!budgetPaused && describePolicy.chain.length > 0) {
			const routerDescribeInput: Parameters<RecapVisionRouterPort['describe']>[0] = { frames, policy: describePolicy };
			if (signal) routerDescribeInput.signal = signal;
			const describeResult = await router.describe(routerDescribeInput);
			// Keep the analyze attempts first: the describe fallback must never replace the
			// evidence of why structured analysis failed (it hid a budget pause behind a
			// schema error in Fase 4B.11).
			const combinedAttempts = [...analyzeResult.attempts, ...describeResult.attempts];
			lastTrace = {
				provider: describeResult.provider,
				model: describeResult.model,
				reportedModel: describeResult.reportedModel ?? null,
				costUsd: analyzeResult.costUsd + describeResult.costUsd,
				attempts: combinedAttempts,
					fallbackReason: firstFallbackReason(combinedAttempts),
				...(describeResult.usage ? { usage: describeResult.usage } : {}),
				policyVersion,
				routeTier: context?.routeTier ?? null,
				routeReason: context?.routeReason ?? null,
				hostExecutor,
			};

			if (describeResult.value) {
				return {
					visualDescription: describeResult.value.description,
					characters: [],
					actions: [{ type: 'none', description: describeResult.value.description }],
					emotions: extractEmotionsFromAnalysis(describeResult.value.description, describeResult.value.tags, []),
					setting: undefined,
					uncertainties: ['Análise obtida via describe fallback (sem extração estruturada de balões/entidades).'],
					confidence: 0.4, // describe-only via router is lower confidence
				};
			}
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
			actions: [],
			emotions: ['unknown'],
			setting: undefined,
			uncertainties: ['Análise visual indisponível em todos os provedores configurados.'],
			confidence: 0,
		};
	};

	const adapter: VisionAdapter & { getLastTrace(): AnalysisTrace | null; getCircuitBreaker(): AgentCircuitBreaker } = {
		name: router
			? 'recap-vision-router'
			: providers && providers.length > 0
				? `recap-vision-chain[${providers.map((p) => p.id).join(',')}]`
				: `recap-vision-${provider!.id}`,

		async analyze(imagePathOrBuffer: string | Buffer, context?: VisionAnalysisContext): Promise<VisionAnalysisResult> {
			let resolvedPath: string;

			if (Buffer.isBuffer(imagePathOrBuffer)) {
				// Write buffer to a temp file inside the authorized root so the provider can read it, preserving true binary extension.
				const hash = createHash('sha256').update(imagePathOrBuffer).digest('hex').slice(0, 16);
				const tempDir = join(resolvedRoot, '.recap-vision-tmp');
				if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
				let ext = '.png';
				if (imagePathOrBuffer.length >= 12) {
					if (imagePathOrBuffer[0] === 0xff && imagePathOrBuffer[1] === 0xd8 && imagePathOrBuffer[2] === 0xff) {
						ext = '.jpg';
					} else if (
						imagePathOrBuffer[0] === 0x52 && imagePathOrBuffer[1] === 0x49 &&
						imagePathOrBuffer[2] === 0x46 && imagePathOrBuffer[3] === 0x46 &&
						imagePathOrBuffer[8] === 0x57 && imagePathOrBuffer[9] === 0x45 &&
						imagePathOrBuffer[10] === 0x42 && imagePathOrBuffer[11] === 0x50
					) {
						ext = '.webp';
					}
				}
				resolvedPath = join(tempDir, `${hash}${ext}`);
				writeFileSync(resolvedPath, imagePathOrBuffer);
			} else {
				resolvedPath = imagePathOrBuffer;
			}

			try {
				if (router) {
					return await analyzeWithRouter(resolvedPath, context);
				}
				if (providers && providers.length > 0) {
					return await analyzeWithProviderChain(resolvedPath, context);
				}
				return await analyzeWithProvider(resolvedPath, context);
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
					uncertainties: [`Falha na análise visual: ${msg}`],
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
	routeChains?: Partial<Record<RecapPanelRouteTier, readonly string[]>>;
	policyVersion?: string;
	hostExecutor?: string;
	maxLatencyMs?: number;
	budgetUsd?: number;
	circuitBreaker?: AgentCircuitBreaker;
	throwOnAllUnavailable?: boolean;
}): VisionAdapter & { getLastTrace(): AnalysisTrace | null; getCircuitBreaker(): AgentCircuitBreaker } {
	const opts: RecapVisionAdapterOptions = { root: input.root, router: input.router };
	if (input.policyChain) opts.policyChain = input.policyChain;
	if (input.routeChains) opts.routeChains = input.routeChains;
	if (input.policyVersion) opts.policyVersion = input.policyVersion;
	if (input.hostExecutor) opts.hostExecutor = input.hostExecutor;
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
	circuitBreaker?: AgentCircuitBreaker,
): VisionRoutingStepSummary[] {
	return attempts.map((a, idx) => {
		const next = attempts[idx + 1];
		if (a.outcome === 'ok' || a.outcome === 'cached') {
			return { provider: a.provider, outcome: a.outcome };
		}
		const cbState = circuitBreaker?.getState(a.provider);
		const fallback = a.outcome === 'unavailable' ? 'PROVIDER_UNAVAILABLE' : 'UNKNOWN_PROVIDER_ERROR';
		const c = classifyVisionError(a.detail ?? a.outcome, a.provider, fallback);
		const unifiedCode = cbState?.state === 'open' && cbState.code ? cbState.code : c.code;
		const unifiedReason = cbState?.state === 'open' && cbState.reason ? cbState.reason : c.message;
		return {
			provider: a.provider,
			outcome: a.outcome,
			code: unifiedCode,
			reason: unifiedReason,
			...(next ? { fallbackTo: next.provider } : {}),
		};
	});
}
