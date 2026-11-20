/**
 * Contextual Research / YouTube Agent — Phase 2.2.2-A
 *
 * Optional research layer that enriches Recap scripts with verified external
 * context (work metadata, character backgrounds, chapter references) WITHOUT
 * replacing panel evidence or introducing spoilers.
 *
 * KEY GUARANTEES:
 * - Panels remain the primary narrative source; research is complementary only.
 * - Spoiler control: respects work/chapter/temporal boundaries.
 * - Fact/theory separation: every reference carries an explicit confidence tag.
 * - Never invents scenes, characters, or events not present in panels.
 * - Graceful fallback: when disabled/unavailable/failed, pipeline continues
 *   with panel-only evidence and a warning is recorded.
 * - Multi-agent: delegates to ResearchPort (wraps runVideoResearch or any agent).
 * - Telemetry: records agent, model, attempt count, sources and rejection reasons.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Source type classification — describes WHERE the information comes from,
 * NOT whether it is true. A Wikipedia article is a secondary source even if
 * accurate; an official publisher announcement is a primary source.
 */
export const SOURCE_TYPE_VALUES = ['primary_official', 'secondary_community', 'secondary_editorial', 'user_generated', 'unknown'] as const;
export type SourceType = (typeof SOURCE_TYPE_VALUES)[number];

/**
 * Confidence level — describes HOW RELIABLE the information is, independent
 * of where it came from. A primary source can be unverified if the claim is
 * ambiguous; a secondary source can be confirmed if corroborated by evidence.
 */
export const CONFIDENCE_LEVEL_VALUES = ['confirmed', 'corroborated', 'interpretation', 'theory', 'unverified'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVEL_VALUES)[number];

/** @deprecated Use SourceType + ConfidenceLevel instead. Kept for backward compatibility with recap-types.ts exports. */
export const RESEARCH_CONFIDENCE_TAGS = ['confirmed_fact', 'official_source', 'interpretation', 'theory', 'unverified'] as const;
export type ResearchConfidenceTag = (typeof RESEARCH_CONFIDENCE_TAGS)[number];

export interface RawResearchReference {
	kind: string;
	title: string;
	url: string;
	license: string;
	note: string;
}

export interface ContextualReference extends RawResearchReference {
	/** Where the information comes from (source provenance). */
	sourceType: SourceType;
	/** How reliable the information is (evidence strength). */
	confidenceLevel: ConfidenceLevel;
	/** @deprecated Use sourceType + confidenceLevel instead. */
	confidenceTag: ResearchConfidenceTag;
	/** Chapter/episode/timeline boundary this reference applies to. Null = general work info. */
	applicableUpToChapter?: number | null;
	/** True when the reference was rejected by spoiler or temporal filters. */
	rejected: boolean;
	/** Reason for rejection, if applicable. */
	rejectionReason?: string;
}

export interface ContextualResearchOptions {
	/** Enable or disable research. When false, returns empty result immediately. */
	enabled: boolean;
	/** Work title for scoping the search. */
	workTitle: string;
	/** Current chapter number being processed. Used for spoiler filtering. */
	currentChapter: number;
	/** Maximum chapter number allowed in results. References beyond this are rejected. */
	maxAllowedChapter?: number;
	/** Whether theories and interpretations are accepted. Default: false. */
	allowTheories?: boolean;
	/** Additional search terms to refine the query (character names, arc names, etc.). */
	extraTerms?: string[];
	/** Abort signal for cancellation. */
	signal?: AbortSignal;
}

export interface ContextualResearchResult {
	/** Accepted references that passed all filters. */
	accepted: ContextualReference[];
	/** Rejected references with reasons. */
	rejected: ContextualReference[];
	/** Total references returned by the agent before filtering. */
	totalRaw: number;
	/** Agent/model that performed the research. 'none' when skipped. */
	agentId: string;
	model: string | null;
	/** Warnings generated during research. */
	warnings: string[];
	/** True when research was skipped (disabled or no agent available). */
	skipped: boolean;
	/** Execution ID from the agent generation, if available. */
	executionId?: string;
}

/**
 * Minimal port for contextual research execution. Decouples this module from
 * the Orchestrator so it can be tested in isolation and reused by Aethera Studio.
 * The production implementation wraps runVideoResearch() from @neuralbridge/orchestrator.
 */
export interface ResearchPort {
	readonly name: string;
	research(input: ResearchPortRequest): Promise<ResearchPortResult>;
}

export interface ResearchPortRequest {
	topic: string;
	signal?: AbortSignal;
}

export interface ResearchPortResult {
	references: RawResearchReference[];
	rejectedCount: number;
	agentId: string;
	model: string | null;
	executionId?: string;
	ok: boolean;
	error?: string;
}

// ─── Spoiler & Temporal Filter ──────────────────────────────────────────────

const CHAPTER_PATTERN = /\b(?:cap(?:ítulo|\.)?|chapter|ch\.?|ep(?:isódio|\.)?|episode|vol(?:ume|\.)?)\s*(\d+)/i;
const SPOILER_KEYWORDS = [
	'spoiler', 'reveals', 'revela', 'desfecho', 'ending', 'final', 'morte', 'death',
	'twist', 'reviravolta', 'surpresa', 'surprise', 'futuro', 'future', 'próximo arco',
	'next arc', 'temporada seguinte', 'next season',
];

function extractChapterFromNote(note: string): number | null {
	const match = CHAPTER_PATTERN.exec(note);
	return match ? parseInt(match[1]!, 10) : null;
}

function containsSpoilerIndicators(text: string): boolean {
	const lower = text.toLowerCase();
	return SPOILER_KEYWORDS.some((kw) => lower.includes(kw));
}

/** Domains that are PRIMARY OFFICIAL sources (publisher, author, studio). */
const PRIMARY_OFFICIAL_DOMAINS = [
	'shueisha.co.jp', 'kodansha.com', 'shogakukan.co.jp', 'akita-shoten.co.jp',
	'webtoons.com', 'tapas.io', 'tappytoon.com',
	'viz.com', 'crunchyroll.com/manga', 'mangaplus.shueisha.co.jp',
];

/** Domains that are SECONDARY COMMUNITY sources (user-edited wikis, databases). */
const SECONDARY_COMMUNITY_DOMAINS = [
	'wikipedia.org', 'myanimelist.net', 'anilist.co', 'mangaupdates.com',
	'fandom.com', 'wikia.com', 'reddit.com', 'discord.com',
];

interface ClassificationResult {
	sourceType: SourceType;
	confidenceLevel: ConfidenceLevel;
	/** @deprecated backward compat */
	confidenceTag: ResearchConfidenceTag;
}

function classifySource(reference: RawResearchReference): ClassificationResult {
	const noteLower = reference.note.toLowerCase();
	const titleLower = reference.title.toLowerCase();
	const urlLower = reference.url.toLowerCase();

	// ─── Source Type ────────────────────────────────────────────────────────
	let sourceType: SourceType = 'unknown';

	if (PRIMARY_OFFICIAL_DOMAINS.some((d) => urlLower.includes(d))) {
		sourceType = 'primary_official';
	} else if (SECONDARY_COMMUNITY_DOMAINS.some((d) => urlLower.includes(d))) {
		sourceType = 'secondary_community';
	} else if (noteLower.includes('editorial') || noteLower.includes('review') || noteLower.includes('resenha')) {
		sourceType = 'secondary_editorial';
	} else if (noteLower.includes('fan ') || noteLower.includes('usuário') || noteLower.includes('user') || noteLower.includes('comunidade')) {
		sourceType = 'user_generated';
	} else if (noteLower.includes('oficial') || noteLower.includes('official') || noteLower.includes('publisher') || noteLower.includes('editora')) {
		sourceType = 'primary_official';
	}

	// ─── Confidence Level ───────────────────────────────────────────────────
	let confidenceLevel: ConfidenceLevel = 'unverified';

	if (noteLower.includes('confirmado') || noteLower.includes('confirmed') ||
		noteLower.includes('fato verificado') || noteLower.includes('verified fact')) {
		confidenceLevel = 'confirmed';
	} else if (noteLower.includes('corroborado') || noteLower.includes('corroborated') ||
		noteLower.includes('múltiplas fontes') || noteLower.includes('multiple sources')) {
		confidenceLevel = 'corroborated';
	} else if (noteLower.includes('interpretação') || noteLower.includes('interpretation') ||
		noteLower.includes('análise') || noteLower.includes('analysis') ||
		noteLower.includes('resenha') || noteLower.includes('review')) {
		confidenceLevel = 'interpretation';
	} else if (noteLower.includes('teoria') || noteLower.includes('theory') ||
		noteLower.includes('especulação') || noteLower.includes('speculation') ||
		noteLower.includes('hipótese') || noteLower.includes('hypothesis') ||
		titleLower.includes('teoria') || titleLower.includes('theory')) {
		confidenceLevel = 'theory';
	} else if (sourceType === 'primary_official') {
		// Primary official sources default to corroborated unless explicitly marked otherwise
		confidenceLevel = 'corroborated';
	}

	// ─── Deprecated tag mapping ─────────────────────────────────────────────
	let confidenceTag: ResearchConfidenceTag = 'unverified';
	if (confidenceLevel === 'confirmed') confidenceTag = 'confirmed_fact';
	else if (confidenceLevel === 'corroborated' && sourceType === 'primary_official') confidenceTag = 'official_source';
	else if (confidenceLevel === 'corroborated') confidenceTag = 'confirmed_fact';
	else if (confidenceLevel === 'interpretation') confidenceTag = 'interpretation';
	else if (confidenceLevel === 'theory') confidenceTag = 'theory';

	return { sourceType, confidenceLevel, confidenceTag };
}

function filterReference(
	ref: RawResearchReference,
	options: ContextualResearchOptions,
): ContextualReference {
	const maxChapter = options.maxAllowedChapter ?? options.currentChapter;
	const noteChapter = extractChapterFromNote(ref.note);
	const titleChapter = extractChapterFromNote(ref.title);
	const refChapter = noteChapter ?? titleChapter;
	const classification = classifySource(ref);

	// ─── Layer 1: Spoiler keyword check ─────────────────────────────────────
	if (containsSpoilerIndicators(`${ref.title} ${ref.note}`)) {
		return {
			...ref,
			...classification,
			applicableUpToChapter: refChapter,
			rejected: true,
			rejectionReason: 'Contains spoiler indicators in title or note.',
		};
	}

	// ─── Layer 2: Temporal boundary check ───────────────────────────────────
	if (refChapter !== null && refChapter > maxChapter) {
		return {
			...ref,
			...classification,
			applicableUpToChapter: refChapter,
			rejected: true,
			rejectionReason: `Reference applies to chapter ${refChapter}, beyond allowed limit (${maxChapter}).`,
		};
	}

	// ─── Layer 3: Conservative policy for unverifiable temporal context ─────
	// When we cannot determine which chapter a reference applies to AND it is
	// not from a primary official source, reject it to prevent accidental spoilers.
	// Primary official sources about the work in general (no chapter mention) are
	// accepted because they typically describe established facts.
	if (refChapter === null && classification.sourceType !== 'primary_official') {
		const isGeneralWorkInfo = noteChapter === null && titleChapter === null &&
			!containsSpoilerIndicators(`${ref.title} ${ref.note}`);
		if (!isGeneralWorkInfo || classification.confidenceLevel === 'theory' || classification.confidenceLevel === 'unverified') {
			return {
				...ref,
				...classification,
				applicableUpToChapter: null,
				rejected: true,
				rejectionReason: `No verifiable temporal context and source type "${classification.sourceType}" is not primary_official. Conservative rejection to prevent potential spoilers.`,
			};
		}
	}

	// ─── Layer 4: Theory/unverified filter ──────────────────────────────────
	if (!options.allowTheories && (classification.confidenceLevel === 'theory' || classification.confidenceLevel === 'unverified')) {
		return {
			...ref,
			...classification,
			applicableUpToChapter: refChapter,
			rejected: true,
			rejectionReason: `Confidence level "${classification.confidenceLevel}" not allowed (allowTheories=false).`,
		};
	}

	return {
		...ref,
		...classification,
		applicableUpToChapter: refChapter,
		rejected: false,
	};
}

// ─── Main Research Function ─────────────────────────────────────────────────

export interface RunContextualResearchInput {
	port: ResearchPort;
	options: ContextualResearchOptions;
}

/**
 * Runs contextual research for a Recap chapter using a ResearchPort.
 *
 * Pipeline:
 * 1. Build specialized prompt for manga/manhwa context.
 * 2. Call port.research() with the topic.
 * 3. Classify each reference by confidence tag.
 * 4. Apply spoiler and temporal filters.
 * 5. Return accepted/rejected references with telemetry.
 *
 * Fallback: when disabled, port unavailable, or research fails,
 * returns empty result with skipped=true and a descriptive warning.
 */
export async function runContextualResearch(input: RunContextualResearchInput): Promise<ContextualResearchResult> {
	const { port, options } = input;
	const warnings: string[] = [];

	// Skip when disabled
	if (!options.enabled) {
		return {
			accepted: [],
			rejected: [],
			totalRaw: 0,
			agentId: 'none',
			model: null,
			warnings: ['Contextual research disabled; skipping.'],
			skipped: true,
		};
	}

	// Build the search topic
	const terms = [options.workTitle, `capítulo ${options.currentChapter}`];
	if (options.extraTerms?.length) terms.push(...options.extraTerms);
	const topic = terms.join(' ');

	try {
		const request: ResearchPortRequest = { topic };
		if (options.signal) request.signal = options.signal;

		const result = await port.research(request);

		if (!result.ok) {
			warnings.push(`Contextual research failed: ${result.error ?? 'unknown error'}. Continuing with panel-only evidence.`);
			return {
				accepted: [],
				rejected: [],
				totalRaw: 0,
				agentId: result.agentId,
				model: result.model,
				warnings,
				skipped: true,
			};
		}

		// Classify and filter references
		const classified = result.references.map((ref: RawResearchReference) => filterReference(ref, options));
		const accepted = classified.filter((r: ContextualReference) => !r.rejected);
		const rejected = classified.filter((r: ContextualReference) => r.rejected);

		// Record rejection reasons as warnings
		for (const r of rejected) {
			if (r.rejectionReason) {
				warnings.push(`Rejected: "${r.title}" — ${r.rejectionReason}`);
			}
		}

		const successResult: ContextualResearchResult = {
			accepted,
			rejected,
			totalRaw: result.references.length + result.rejectedCount,
			agentId: result.agentId,
			model: result.model,
			warnings,
			skipped: false,
		};
		if (result.executionId) successResult.executionId = result.executionId;
		return successResult;
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		warnings.push(`Contextual research failed: ${msg}. Continuing with panel-only evidence.`);
		return {
			accepted: [],
			rejected: [],
			totalRaw: 0,
			agentId: port.name,
			model: null,
			warnings,
			skipped: true,
		};
	}
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONCRETE PORT ADAPTERS — Phase 2.2.3
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Minimal TaskEngine port for text-only structured execution.
 * Decouples the adapter from the full TaskEngine type so this module
 * can be tested and reused without importing @neuralbridge/orchestrator.
 */
export interface TextTaskEnginePort {
	runStructuredReadOnly(input: {
		projectId: string | null;
		agent: string;
		prompt: string;
		outputSchema: object;
		origin?: string;
		model?: string | null;
		lean?: { systemPrompt: string };
		signal?: AbortSignal;
	}): Promise<{ agent: string; text: string; structured: unknown; model: string | null }>;
}

/**
 * Creates a TextEnhancementPort backed by TaskEngine.runStructuredReadOnly().
 * Supports dynamic agent selection: tries each agent in priority order until
 * one succeeds, implementing real multi-agent fallback for text tasks.
 */
export function createTaskEngineTextEnhancementAdapter(input: {
	taskEngine: TextTaskEnginePort;
	projectId: string | null;
	agentPriority?: readonly string[];
	model?: string | null;
}): import('./recap-types.js').TextEnhancementPort {
	const agents = input.agentPriority ?? ['claude', 'codex'];
	return {
		name: `taskengine-text-enhancement[${agents.join(',')}]`,
		async enhance(request: import('./recap-types.js').TextEnhancementRequest): Promise<import('./recap-types.js').TextEnhancementResult> {
			let lastError: string | undefined;
			for (const agent of agents) {
				try {
					const runInput: Parameters<TextTaskEnginePort['runStructuredReadOnly']>[0] = {
						projectId: input.projectId,
						agent,
						prompt: request.text,
						outputSchema: request.outputSchema,
						origin: 'neura',
						lean: { systemPrompt: request.systemPrompt },
					};
					if (input.model !== undefined) runInput.model = input.model;
					if (request.signal !== undefined) runInput.signal = request.signal;
					const result = await input.taskEngine.runStructuredReadOnly(runInput);
					return {
						text: typeof result.structured === 'string' ? result.structured : JSON.stringify(result.structured),
						agentId: result.agent,
						model: result.model,
						ok: true,
					};
				} catch (err) {
					lastError = err instanceof Error ? err.message : String(err);
				}
			}
			return { text: '', agentId: 'none', model: null, ok: false, error: lastError ?? 'All agents failed.' };
		},
	};
}

/**
 * Minimal AgentAdapter port for video research execution.
 * Decouples the adapter from @neuralbridge/agents so this module
 * can be tested and reused independently.
 */
export interface ResearchAgentAdapterPort {
	id: string;
	detect(): Promise<{ installed: boolean; authenticated: boolean; problems: string[] }>;
	run(request: { prompt: string; cwd: string; mode: string; timeoutMs?: number; allowedTools?: string[]; outputSchema?: object; webSearch?: boolean }, signal?: AbortSignal): AsyncIterable<{ kind: string; data?: unknown }>;
}

/**
 * Creates a ResearchPort backed by runVideoResearch() from @neuralbridge/orchestrator.
 * The actual import is injected at runtime to avoid circular dependencies.
 */
export function createVideoResearchPortAdapter(input: {
	adapter: ResearchAgentAdapterPort;
	cwd: string;
	runVideoResearchFn: (adapter: ResearchAgentAdapterPort, topic: string, cwd: string, signal?: AbortSignal) => Promise<{ references: RawResearchReference[]; rejected: number; generation: { executionId: string; model: string | null } }>;
}): ResearchPort {
	return {
		name: `video-research-port[${input.adapter.id}]`,
		async research(request: ResearchPortRequest): Promise<ResearchPortResult> {
			try {
				const detection = await input.adapter.detect();
				if (!detection.installed || !detection.authenticated) {
					return {
						references: [],
						rejectedCount: 0,
						agentId: input.adapter.id,
						model: null,
						ok: false,
						error: detection.problems[0] ?? 'Agent not available.',
					};
				}
				const run = await input.runVideoResearchFn(input.adapter, request.topic, input.cwd, request.signal);
				return {
					references: run.references,
					rejectedCount: run.rejected,
					agentId: input.adapter.id,
					model: run.generation.model,
					executionId: run.generation.executionId,
					ok: true,
				};
			} catch (err) {
				return {
					references: [],
					rejectedCount: 0,
					agentId: input.adapter.id,
					model: null,
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				};
			}
		},
	};
}