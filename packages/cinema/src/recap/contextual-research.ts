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
 * - Multi-agent: delegates to AgentAdapter via runVideoResearch(); no hardcoded provider.
 * - Telemetry: records agent, model, attempt count, sources and rejection reasons.
 */

import type { AgentAdapter } from '@neuralbridge/agents';
import type { VelixReference } from '@neuralbridge/workspace';
import { runVideoResearch, type VideoResearchRun } from '@neuralbridge/orchestrator/video-research';

// ─── Types ───────────────────────────────────────────────────────────────────

export const RESEARCH_CONFIDENCE_TAGS = ['confirmed_fact', 'official_source', 'interpretation', 'theory', 'unverified'] as const;
export type ResearchConfidenceTag = (typeof RESEARCH_CONFIDENCE_TAGS)[number];

export interface ContextualReference extends VelixReference {
	/** Classification of the information reliability. */
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
	/** Working directory for the agent execution. */
	cwd: string;
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

function classifyConfidence(reference: VelixReference, allowTheories: boolean): ResearchConfidenceTag {
	const noteLower = reference.note.toLowerCase();
	const titleLower = reference.title.toLowerCase();
	const combined = `${titleLower} ${noteLower}`;

	// Official sources
	if (reference.url.includes('wikipedia.org') || reference.url.includes('myanimelist.net') ||
		reference.url.includes('anilist.co') || reference.url.includes('mangaupdates.com') ||
		noteLower.includes('oficial') || noteLower.includes('official')) {
 return 'official_source';
	}

	// Confirmed facts
	if (noteLower.includes('confirmado') || noteLower.includes('confirmed') ||
		noteLower.includes('fato') || noteLower.includes('fact')) {
 return 'confirmed_fact';
	}

	// Theories and interpretations
	if (noteLower.includes('teoria') || noteLower.includes('theory') ||
		noteLower.includes('especulação') || noteLower.includes('speculation') ||
		titleLower.includes('teoria') || titleLower.includes('theory')) {
 return allowTheories ? 'theory' : 'unverified';
	}

	if (noteLower.includes('interpretação') || noteLower.includes('interpretation') ||
		noteLower.includes('análise') || noteLower.includes('analysis')) {
 return 'interpretation';
	}

	// Default: treat as confirmed fact if from a known source, otherwise unverified
	if (reference.kind === 'texto' || reference.kind === 'dado') {
 return 'confirmed_fact';
	}

	return 'unverified';
}

function filterReference(
	ref: VelixReference,
	options: ContextualResearchOptions,
): ContextualReference {
	const maxChapter = options.maxAllowedChapter ?? options.currentChapter;
	const noteChapter = extractChapterFromNote(ref.note);
	const titleChapter = extractChapterFromNote(ref.title);
	const refChapter = noteChapter ?? titleChapter;

	// Spoiler keyword check
	if (containsSpoilerIndicators(`${ref.title} ${ref.note}`)) {
 return {
 ...ref,
 confidenceTag: 'unverified',
 applicableUpToChapter: refChapter,
 rejected: true,
 rejectionReason: 'Contains spoiler indicators in title or note.',
 };
	}

	// Temporal boundary check
	if (refChapter !== null && refChapter > maxChapter) {
 return {
 ...ref,
 confidenceTag: classifyConfidence(ref, options.allowTheories ?? false),
 applicableUpToChapter: refChapter,
 rejected: true,
 rejectionReason: `Reference applies to chapter ${refChapter}, beyond allowed limit (${maxChapter}).`,
 };
	}

	// Theory/interpretation filter
	const confidenceTag = classifyConfidence(ref, options.allowTheories ?? false);
	if (!options.allowTheories && (confidenceTag === 'theory' || confidenceTag === 'unverified')) {
 return {
 ...ref,
 confidenceTag,
 applicableUpToChapter: refChapter,
 rejected: true,
 rejectionReason: `Confidence tag "${confidenceTag}" not allowed (allowTheories=false).`,
 };
	}

	return {
 ...ref,
 confidenceTag,
 applicableUpToChapter: refChapter,
 rejected: false,
	};
}

// ─── Main Research Function ─────────────────────────────────────────────────

export interface RunContextualResearchInput {
	adapter: AgentAdapter;
	options: ContextualResearchOptions;
}

/**
 * Runs contextual research for a Recap chapter using the existing
 * runVideoResearch() infrastructure from the Orchestrator.
 *
 * Pipeline:
 * 1. Build specialized prompt for manga/manhwa context.
 * 2. Call runVideoResearch() with the adapter (multi-agent via AgentAdapter).
 * 3. Classify each reference by confidence tag.
 * 4. Apply spoiler and temporal filters.
 * 5. Return accepted/rejected references with telemetry.
 *
 * Fallback: when disabled, adapter unavailable, or research fails,
 * returns empty result with skipped=true and a descriptive warning.
 */
export async function runContextualResearch(input: RunContextualResearchInput): Promise<ContextualResearchResult> {
	const { adapter, options } = input;
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
 // Check adapter availability
 const detection = await adapter.detect();
 if (!detection.installed || !detection.authenticated) {
 const reason = detection.problems[0] ?? 'Agent not installed or not authenticated.';
 warnings.push(`Contextual research skipped: ${reason}`);
 return {
 accepted: [],
 rejected: [],
 totalRaw: 0,
 agentId: adapter.id,
 model: null,
 warnings,
 skipped: true,
 };
 }

 // Execute research via existing infrastructure
 const run: VideoResearchRun = await runVideoResearch(adapter, topic, options.cwd, options.signal);

 // Classify and filter references
 const classified = run.references.map((ref) => filterReference(ref, options));
 const accepted = classified.filter((r) => !r.rejected);
 const rejected = classified.filter((r) => r.rejected);

 // Record rejection reasons as warnings
 for (const r of rejected) {
 warnings.push(`Rejected: "${r.title}" — ${r.rejectionReason}`);
 }

 return {
 accepted,
 rejected,
 totalRaw: run.references.length + run.rejected,
 agentId: adapter.id,
 model: run.generation.model ?? null,
 warnings,
 skipped: false,
 executionId: run.generation.executionId,
 };
	} catch (err) {
 const msg = err instanceof Error ? err.message : String(err);
 warnings.push(`Contextual research failed: ${msg}. Continuing with panel-only evidence.`);
 return {
 accepted: [],
 rejected: [],
 totalRaw: 0,
 agentId: adapter.id,
 model: null,
 warnings,
 skipped: true,
 };
	}
}