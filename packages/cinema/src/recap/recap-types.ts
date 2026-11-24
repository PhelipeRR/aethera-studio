import { z } from 'zod';
import type { RecapFidelityGateReport } from './recap-fidelity-gate.js';

// ─── Reading Order & Classification ──────────────────────────────────────────

export const READING_ORDER_VALUES = ['rtl', 'ltr', 'vertical'] as const;
export type ReadingOrder = (typeof READING_ORDER_VALUES)[number];

export const PANEL_CLASSIFICATION_VALUES = [
	'dialogue',
	'action',
	'splash',
	'transition',
	'establishing',
] as const;
export type PanelClassification = (typeof PANEL_CLASSIFICATION_VALUES)[number];

export const MANGA_SOURCE_KIND_VALUES = ['manga_page', 'panel_crop'] as const;
export type MangaSourceKind = (typeof MANGA_SOURCE_KIND_VALUES)[number];

export const MANGA_ORIGIN_VALUES = ['manga_scan', 'webtoon_extract'] as const;
export type MangaOrigin = (typeof MANGA_ORIGIN_VALUES)[number];

// ─── OCR Execution Status ────────────────────────────────────────────────────

export const OCR_STATUS_VALUES = ['not_run', 'success', 'failed'] as const;
export type OcrStatus = (typeof OCR_STATUS_VALUES)[number];

// ─── Bounding Box ────────────────────────────────────────────────────────────

export const boundingBoxSchema = z.object({
	x: z.number().min(0),
	y: z.number().min(0),
	w: z.number().positive(),
	h: z.number().positive(),
});
export type BoundingBox = z.infer<typeof boundingBoxSchema>;

// ─── MangaPanelMetadata (stored in clip.metadata.manga) ─────────────────────

export const mangaPanelMetadataSchema = z.object({
	sourceKind: z.enum(MANGA_SOURCE_KIND_VALUES),
	origin: z.enum(MANGA_ORIGIN_VALUES),
	chapterId: z.string().min(1),
	pageNumber: z.number().int().min(0),
	panelIndex: z.number().int().min(0),
	readingOrder: z.enum(READING_ORDER_VALUES),
	boundingBox: boundingBoxSchema,
	classification: z.enum(PANEL_CLASSIFICATION_VALUES),
	/** Explicit OCR execution status. 'not_run' means no OCR was attempted. */
	ocrStatus: z.enum(OCR_STATUS_VALUES),
	/** Confidence only meaningful when ocrStatus === 'success'. 0 otherwise. */
	ocrConfidence: z.number().min(0).max(1),
	textContent: z.string().optional(),
	/** Error message when ocrStatus === 'failed'. */
	ocrError: z.string().optional(),
});
export type MangaPanelMetadata = z.infer<typeof mangaPanelMetadataSchema>;

// ─── Extracted Panel ─────────────────────────────────────────────────────────

export const extractedPanelSchema = z.object({
	panelId: z.string().min(1),
	pagePath: z.string().min(1),
	/** Path to the persisted cropped panel image. Undefined when crop failed. */
	croppedImagePath: z.string().optional(),
	/** True when panel cropping failed and fallback to full page was used. Requires review. */
	cropFailed: z.boolean().optional(),
	metadata: mangaPanelMetadataSchema,
	imageHash: z.string().min(1),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
});
export type ExtractedPanel = z.infer<typeof extractedPanelSchema>;

// ─── Imported Chapter ────────────────────────────────────────────────────────

export const importedPageSchema = z.object({
	pageNumber: z.number().int().min(0),
	filePath: z.string().min(1),
	sha256: z.string().min(1),
	width: z.number().int().positive(),
	height: z.number().int().positive(),
});
export type ImportedPage = z.infer<typeof importedPageSchema>;

export const importedChapterSchema = z.object({
	chapterId: z.string().min(1),
	sourceArchivePath: z.string().min(1),
	format: z.enum(['pdf', 'cbz', 'zip', 'images']),
	readingOrder: z.enum(READING_ORDER_VALUES),
	pageCount: z.number().int().min(1),
	pages: z.array(importedPageSchema),
	importedAtIso: z.string().datetime(),
});
export type ImportedChapter = z.infer<typeof importedChapterSchema>;

// ─── Recap Pipeline Stages ───────────────────────────────────────────────────

export const RECAP_STAGE_VALUES = [
	'import',
	'extraction',
	'narrative',
	'fidelity',
	'manifest',
	'cinema_handoff',
] as const;
export type RecapStage = (typeof RECAP_STAGE_VALUES)[number];

// ─── Checkpoint / Persistence ────────────────────────────────────────────────

export const recapCheckpointSchema = z.object({
	chapterId: z.string().min(1),
	completedStages: z.array(z.enum(RECAP_STAGE_VALUES)),
	lastUpdatedAtIso: z.string().datetime(),
	/** Hash of the source archive for invalidation detection. */
	sourceHash: z.string().min(1),
	/** Partial results that can be resumed. */
	importedChapter: importedChapterSchema.optional(),
	extractedPanels: z.array(extractedPanelSchema).optional(),
	/** Cached panel analyses (Phase 2.2.4) to avoid re-running vision calls on resume. */
	panelAnalyses: z.array(z.any()).optional(),
	/** Cache keyed by panel imageHash (Phase 2.2.4) for deduplicated/resumable vision analysis. */
	analysisCacheByHash: z.record(z.string(), z.any()).optional(),
	/** Image hash captured alongside panel analyses so legacy panel-id reuse can be validated. */
	panelAnalysisImageHashes: z.record(z.string(), z.string()).optional(),
	/** Script generator version & style cache metadata to prevent stale script reuse. */
	scriptGeneratorVersion: z.string().optional(),
	scriptStyle: z.string().optional(),
	scriptCacheKey: z.string().optional(),
	warnings: z.array(z.string()).optional(),
});
export type RecapCheckpoint = z.infer<typeof recapCheckpointSchema>;

// ─── OCR Adapter Interface ───────────────────────────────────────────────────

export interface OcrResult {
	text: string;
	confidence: number;
}

/**
 * OCR adapter interface. Accepts either a file path (string) or a raw image
 * buffer (cropped panel pixels). Implementations must handle both.
 */
export interface OcrAdapter {
	readonly name: string;
	recognize(imageOrPath: string | Buffer): Promise<OcrResult>;
}

// ─── Panel Extraction Result ─────────────────────────────────────────────────

export interface PanelExtractionResult {
	panels: ExtractedPanel[];
	warnings: string[];
}

// ─── Import Options ──────────────────────────────────────────────────────────

export interface ImportChapterOptions {
	chapterId: string;
	archivePath: string;
	outputDir: string;
	/** Optional durable checkpoint directory (defaults to <outputDir>/<chapterId>/checkpoints). */
	checkpointDir?: string;
	readingOrder?: ReadingOrder;
}

// ─── Gate F Input/Output ─────────────────────────────────────────────────────

export interface GateFPanelIntegrityInput {
	panels: ExtractedPanel[];
	minOcrConfidence: number;
	expectedReadingOrder: ReadingOrder;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 2 — STORY ENGINE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Narrative Evidence & Confidence ─────────────────────────────────────────

export const EVIDENCE_KIND_VALUES = ['ocr_text', 'visual_observation', 'inference'] as const;
export type EvidenceKind = (typeof EVIDENCE_KIND_VALUES)[number];

export const narrativeEvidenceSchema = z.object({
	kind: z.enum(EVIDENCE_KIND_VALUES),
	content: z.string().min(1),
	confidence: z.number().min(0).max(1),
	sourcePanelId: z.string().min(1),
});
export type NarrativeEvidence = z.infer<typeof narrativeEvidenceSchema>;

// ─── Panel Analysis ──────────────────────────────────────────────────────────

export const EMOTION_VALUES = [
	'neutral', 'joy', 'sadness', 'anger', 'fear', 'surprise',
	'determination', 'tension', 'relief', 'confusion', 'unknown',
] as const;
export type Emotion = (typeof EMOTION_VALUES)[number];

export const ACTION_TYPE_VALUES = [
	'dialogue', 'combat', 'movement', 'reaction', 'observation',
	'transformation', 'interaction', 'none',
] as const;
export type ActionType = (typeof ACTION_TYPE_VALUES)[number];

export const DIALOGUE_KIND_VALUES = ['dialogue', 'thought', 'narration', 'sfx'] as const;
export type DialogueKind = (typeof DIALOGUE_KIND_VALUES)[number];

/** Structured classification of visible text. SFX is deliberately separate from speech. */
export const RECAP_TEXT_CONTENT_KIND_VALUES = [
	'dialogue',
	'narrative_caption',
	'sound_effect',
	'visual_effect',
	'decorative_text',
	'unknown',
] as const;
export type RecapTextContentKind = (typeof RECAP_TEXT_CONTENT_KIND_VALUES)[number];

export const RECAP_TEXT_EVIDENCE_SOURCE_VALUES = [
	'ocr',
	'vision',
	'checkpoint',
	'position',
	'typography',
	'balloon',
	'context',
	'deterministic',
] as const;
export type RecapTextEvidenceSource = (typeof RECAP_TEXT_EVIDENCE_SOURCE_VALUES)[number];

export const recapTextEvidenceSchema = z.object({
	source: z.enum(RECAP_TEXT_EVIDENCE_SOURCE_VALUES),
	detail: z.string().min(1),
	weight: z.number().min(0).max(1).optional(),
});
export type RecapTextEvidence = z.infer<typeof recapTextEvidenceSchema>;

export const recapTextProvenanceSchema = z.object({
	source: z.enum(['ocr', 'vision', 'checkpoint', 'deterministic']),
	panelId: z.string().optional(),
	lineIndex: z.number().int().min(0).optional(),
	region: boundingBoxSchema.optional(),
	ref: z.string().optional(),
});
export type RecapTextProvenance = z.infer<typeof recapTextProvenanceSchema>;

export const dialogueEntrySchema = z.object({
	speaker: z.string().optional(),
	/** Primary display text (PT-BR translation when translated, otherwise original). */
	text: z.string(),
	/** Original text extracted from the speech bubble / caption box before translation. */
	originalText: z.string().optional(),
	/** Portuguese (PT-BR) translation preserving original meaning when source is another language. */
	translatedText: z.string().optional(),
	/** Bubble classification: speech, thought, narration box, or sound effect (onomatopoeia). */
	kind: z.enum(DIALOGUE_KIND_VALUES).optional(),
	isNarration: z.boolean().default(false),
	/** 0-based reading order index within the panel. */
	readingOrder: z.number().int().min(0).optional(),
	/** Recorded uncertainty when text is partially illegible or speaker is ambiguous. */
	uncertainty: z.string().optional(),
	/** Phase 4B.10 content boundary; optional for backwards-compatible checkpoints. */
	contentKind: z.enum(RECAP_TEXT_CONTENT_KIND_VALUES).optional(),
	contentEvidence: z.array(recapTextEvidenceSchema).optional(),
	contentProvenance: recapTextProvenanceSchema.optional(),
});
export type DialogueEntry = z.infer<typeof dialogueEntrySchema>;

export const characterDetailSchema = z.object({
	id: z.string().min(1),
	appearance: z.string().optional(),
	expression: z.string().optional(),
	poseOrAction: z.string().optional(),
});
export type CharacterDetail = z.infer<typeof characterDetailSchema>;

export const panelAnalysisSchema = z.object({
	panelId: z.string().min(1),
	/** Rich observable visual description of the panel in PT-BR. */
	visualDescription: z.string().optional(),
	characters: z.array(z.string()),
	characterDetails: z.array(characterDetailSchema).optional(),
	dialogues: z.array(dialogueEntrySchema),
	actions: z.array(z.object({
		type: z.enum(ACTION_TYPE_VALUES),
		description: z.string(),
	})),
	emotions: z.array(z.enum(EMOTION_VALUES)),
	expressions: z.array(z.string()).optional(),
	relevantObjects: z.array(z.string()).optional(),
	setting: z.string().optional(),
	readingOrderHint: z.string().optional(),
	relationToPrevious: z.string().optional(),
	relationToNext: z.string().optional(),
	uncertainties: z.array(z.string()).optional(),
	evidence: z.array(narrativeEvidenceSchema),
	/** Overall confidence in this analysis. Below threshold → needs_review. */
	analysisConfidence: z.number().min(0).max(1),
	/** Deterministic metadata consumed by Story Engine and later MotionVelix stages. */
	motionMetadata: z.object({
		actions: z.array(z.string()),
		impacts: z.array(z.string()),
		movements: z.array(z.string()),
		soundEffects: z.array(z.string()),
		expressions: z.array(z.string()),
		transitions: z.array(z.string()),
		intensity: z.number().min(0).max(1).nullable(),
	}).optional(),
	/** Agent/model that produced this analysis. */
	analyzedBy: z.string().min(1),
	/** ISO timestamp of when the analysis was produced. */
	analyzedAtIso: z.string().datetime(),
});
export type PanelAnalysis = z.infer<typeof panelAnalysisSchema>;

/** Explicit per-job controls for the local/structured Recap analysis path. */
export interface RecapAnalysisSettings {
	/** Keep the Ollama local-VLM route enabled for this job. Defaults to true for compatibility. */
	localVisualAnalysis?: boolean;
	/** Run the configured local OCR adapter during panel extraction. */
	complementaryOcr?: boolean;
	/** Require the fidelity boundary to be satisfied before Story Engine forwarding. */
	strictFidelity?: boolean;
	/** Use the validated deterministic tall-panel tiling path for the local provider. */
	enablePanelTiling?: boolean;
	/** Optional hard per-job ceiling exposed by the production controls. */
	maxModelCalls?: number;
	maxInputTokens?: number;
	maxOutputTokens?: number;
}

// ─── Story Continuity State (chapter-wide narrative memory) ──────────────────

export const continuityCharacterSchema = z.object({
	name: z.string().min(1),
	aliases: z.array(z.string()).default([]),
	firstSeenPanelId: z.string().min(1),
	lastSeenPanelId: z.string().min(1),
	status: z.string().optional(),
});
export type ContinuityCharacter = z.infer<typeof continuityCharacterSchema>;

export const continuityRelationshipSchema = z.object({
	from: z.string().min(1),
	to: z.string().min(1),
	relation: z.string().min(1),
	evidencePanelId: z.string().min(1),
});
export type ContinuityRelationship = z.infer<typeof continuityRelationshipSchema>;

export const storyContinuityStateSchema = z.object({
	characters: z.array(continuityCharacterSchema),
	relationships: z.array(continuityRelationshipSchema),
	currentLocation: z.string().optional(),
	previousEvents: z.array(z.string()),
	ongoingConflict: z.string().optional(),
	revealedFacts: z.array(z.string()),
	openQuestions: z.array(z.string()),
});
export type StoryContinuityState = z.infer<typeof storyContinuityStateSchema>;

// ─── Story Beat (atomic narrative unit) ──────────────────────────────────────

export const storyBeatSchema = z.object({
	beatId: z.string().min(1),
	panelIds: z.array(z.string().min(1)).min(1),
	summary: z.string().min(1),
	/** Observable visual description aggregated across the beat's panels (internal analysis only). */
	visualSummary: z.string().optional(),
	/** Structured actions extracted from panel analyses (used to build natural narration). */
	actions: z.array(z.object({
		type: z.enum(ACTION_TYPE_VALUES),
		description: z.string(),
	})).optional(),
	/** Setting / location for this beat. */
	setting: z.string().optional(),
	/** Ordered dialogues/thoughts/narrations/SFX extracted from this beat's panels. */
	dialogues: z.array(dialogueEntrySchema).optional(),
	/** Relevant objects observed in this beat's panels. */
	relevantObjects: z.array(z.string()).optional(),
	/** Observable expressions across characters in this beat. */
	expressions: z.array(z.string()).optional(),
	/** Uncertainties / illegible text warnings carried from panel analyses. */
	uncertainties: z.array(z.string()).optional(),
	/** Summary of prior narrative context leading into this beat. */
	previousContext: z.string().optional(),
	/** Consequence / narrative transition into the next beat. */
	nextContext: z.string().optional(),
	characters: z.array(z.string()),
	emotion: z.enum(EMOTION_VALUES),
	actionType: z.enum(ACTION_TYPE_VALUES),
	pageNumber: z.number().int().min(0),
	/** Confidence carried from the underlying panel analyses. */
	confidence: z.number().min(0).max(1),
	/** True when ambiguity or low confidence requires human review. */
	needsReview: z.boolean().default(false),
	reviewReason: z.string().optional(),
});
export type StoryBeat = z.infer<typeof storyBeatSchema>;

// ─── Narrative Sequence (ordered beats forming a coherent story) ─────────────

export const narrativeSequenceSchema = z.object({
	chapterId: z.string().min(1),
	beats: z.array(storyBeatSchema),
	readingOrder: z.enum(READING_ORDER_VALUES),
	/** Chapter-wide continuity state built across all panels in reading order. */
	continuityState: storyContinuityStateSchema.optional(),
	generatedAtIso: z.string().datetime(),
	warnings: z.array(z.string()).optional(),
});
export type NarrativeSequence = z.infer<typeof narrativeSequenceSchema>;

// ─── Scene (script-level unit for MotionVelix handoff) ───────────────────────

export const NARRATIVE_INTENT_VALUES = [
	'exposition', 'rising_action', 'climax', 'resolution',
	'character_moment', 'world_building', 'transition',
] as const;
export type NarrativeIntent = (typeof NARRATIVE_INTENT_VALUES)[number];

export const REVIEW_STATUS_VALUES = ['approved', 'needs_review', 'rejected'] as const;
export type ReviewStatus = (typeof REVIEW_STATUS_VALUES)[number];

export const DURATION_SOURCE_VALUES = ['estimated', 'tts_measured'] as const;
export type DurationSource = (typeof DURATION_SOURCE_VALUES)[number];

export const sceneSchema = z.object({
	sceneId: z.string().min(1),
	narrationText: z.string().min(1),
	characters: z.array(z.string()),
	eventDescription: z.string().min(1),
	/** Rich visual summary observed in the source panels for side-by-side review (never used as narration). */
	visualSummary: z.string().optional(),
	/** Structured actions identified in the source panels for side-by-side review. */
	actions: z.array(z.object({
		type: z.enum(ACTION_TYPE_VALUES),
		description: z.string(),
	})).optional(),
	/** Setting / location observed in the scene's panels. */
	setting: z.string().optional(),
	/** Extracted speech bubbles / narration boxes / thoughts from the scene's panels. */
	extractedDialogues: z.array(dialogueEntrySchema).optional(),
	/** Uncertainties / illegible text warnings surfaced for human review. */
	uncertainties: z.array(z.string()).optional(),
	panelIds: z.array(z.string().min(1)).min(1),
	croppedImagePaths: z.array(z.string()),
	estimatedDurationSec: z.number().positive(),
	/** Measured audio duration in seconds once real TTS has synthesized this scene. */
	measuredDurationSec: z.number().positive().optional(),
	/** Indicates whether scene duration is a text-based estimate or real TTS measurement. */
	durationSource: z.enum(DURATION_SOURCE_VALUES).optional(),
	emotion: z.enum(EMOTION_VALUES),
	narrativeIntent: z.enum(NARRATIVE_INTENT_VALUES),
	confidence: z.number().min(0).max(1),
	reviewStatus: z.enum(REVIEW_STATUS_VALUES),
	reviewNotes: z.string().optional(),
});
export type Scene = z.infer<typeof sceneSchema>;

// ─── Recap Script (complete output of Story Engine) ──────────────────────────

export const SCRIPT_STYLE_VALUES = [
	'natural_recap', 'narrative_recap', 'cinematic_recap', 'mystery', 'suspense', 'documentary',
] as const;
export type ScriptStyle = (typeof SCRIPT_STYLE_VALUES)[number];

export const recapScriptSchema = z.object({
	chapterId: z.string().min(1),
	title: z.string().min(1),
	style: z.enum(SCRIPT_STYLE_VALUES),
	scenes: z.array(sceneSchema),
	totalEstimatedDurationSec: z.number().positive(),
	generatedAtIso: z.string().datetime(),
	generatedBy: z.string().min(1),
	warnings: z.array(z.string()).optional(),
});
export type RecapScript = z.infer<typeof recapScriptSchema>;

// ─── Gate G — Narrative Fidelity ─────────────────────────────────────────────

export type GateGVerdict = 'pass' | 'needs_review' | 'fail';

export interface GateGFidelityHint {
	sceneId?: string;
	beatId?: string;
	issueCode:
		| 'missing_panel_reference'
		| 'invalid_image_path'
		| 'invented_event'
		| 'character_inconsistency'
		| 'narrative_gap'
		| 'order_violation'
		| 'low_confidence'
		| 'unresolved_ambiguity'
		| 'generic_narration'
		| 'insufficient_narrative_content'
		| 'ungrounded_description'
		| 'ignored_dialogue'
		| 'scene_contradiction'
		| 'duration_speech_mismatch'
		| 'technical_visual_description'
		| 'missing_event_from_actions'
		| 'repetitive_narration'
		| 'excessive_visual_detail'
		| 'anticipated_event'
		| 'cross_scene_repetition';
	detail: string;
}

export interface GateGReport {
	gate: 'G_narrative_fidelity';
	verdict: GateGVerdict;
	checkedAtIso: string;
	reasons: string[];
	metrics: Record<string, number | string | boolean>;
	hints: GateGFidelityHint[];
}

export interface GateGDivergenceReport {
	preVerdict: GateGVerdict;
	postVerdict: GateGVerdict;
	totalScenes: number;
	modifiedScenes: number;
	revertedScenes: number;
	revertReasons: Array<{ sceneId: string; reason: string }>;
	newHintsAfterHumanize: GateGFidelityHint[];
	evidencePreserved: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 2.2 — NARRATIVE ENHANCEMENT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Text Enhancement Port (shared between Recap and Studio) ──────────────────

/**
 * Minimal port for text-only agent execution. Decouples the Humanizer from
 * TaskEngine so it can be tested in isolation and reused by Aethera Studio.
 * The production implementation wraps TaskEngine.runStructuredReadOnly().
 */
export interface TextEnhancementPort {
	readonly name: string;
	enhance(input: TextEnhancementRequest): Promise<TextEnhancementResult>;
}

export interface TextEnhancementRequest {
	/** The text to enhance. */
	text: string;
	/** Structured context the agent must preserve (characters, refs, durations). */
	context: Record<string, unknown>;
	/** System-level instructions for the enhancement task. */
	systemPrompt: string;
	/** JSON schema the agent output must conform to. */
	outputSchema: object;
	/** Optional abort signal for cancellation. */
	signal?: AbortSignal;
}

export interface TextEnhancementResult {
	/** The enhanced text. */
	text: string;
	/** Agent/model that produced the enhancement. */
	agentId: string;
	model: string | null;
	/** Whether the enhancement succeeded. False → fallback to original. */
	ok: boolean;
	/** Error detail when ok is false. */
	error?: string;
	/** Optional provider telemetry when the text adapter exposes it. */
	usage?: {
		inputTokens?: number | null;
		outputTokens?: number | null;
		cachedTokens?: number | null;
		cacheWriteTokens?: number | null;
		effectiveApiCostUsd?: number | null;
		estimatedCostUsd?: number | null;
		quotaUnits?: number | null;
		quotaKind?: string | null;
		cliQuotaWindows?: readonly { id: string; utilization: number; resetsAt: string | null; status: string }[];
	};
}

// ─── Narrative Humanizer ─────────────────────────────────────────────────────

export const HUMANIZE_STYLE_VALUES = [
	'natural_recap', 'narrative_recap', 'cinematic_recap', 'mystery', 'suspense', 'documentary',
] as const;
export type HumanizeStyle = (typeof HUMANIZE_STYLE_VALUES)[number];

export interface HumanizeOptions {
	/** Enable or disable humanization. When false, returns the original script unchanged. */
	enabled: boolean;
	/**
	 * Selective humanization policy. `all` preserves the legacy behaviour; `flagged`
	 * only processes scenes identified by the factuality gates or explicit target ids.
	 */
	mode?: 'disabled' | 'flagged' | 'all';
	/** Optional explicit scene allow-list used by the `flagged` mode. */
	targetSceneIds?: readonly string[];
	/** Target narration style. Must match the original script style. */
	style: HumanizeStyle;
	/** Humor level configured in UI (0..100). Shapes tone without inventing facts. */
	humorVolume?: number;
	/** Maximum allowed duration deviation (0.0–1.0). Default: 0.10 (10%). */
	maxDurationDeviation?: number;
	/** Word budget per scene. When set, humanized text must stay within ±tolerance. */
	wordBudgetPerScene?: number;
	/** Abort signal for cancellation. */
	signal?: AbortSignal;
}

export interface HumanizeSceneDiff {
	sceneId: string;
	originalText: string;
	humanizedText: string;
	/** True when the humanized text was reverted due to Gate G divergence. */
	reverted: boolean;
	/** Reason for reversion, if applicable. */
	revertReason?: string;
}

export interface HumanizeResult {
	/** The humanized (or original, if disabled/failed) script. */
	script: RecapScript;
	/** Per-scene diffs showing what changed and whether any were reverted. */
	diffs: HumanizeSceneDiff[];
	/** Gate G report after humanization. */
	postHumanizeGateG: GateGReport;
	/** Agent/model that performed the humanization. 'none' when skipped. */
	agentId: string;
	model: string | null;
	/** Warnings generated during humanization. */
	warnings: string[];
	/** True when humanization was skipped (disabled or no agent available). */
	skipped: boolean;
}

// ─── Contextual Research / YouTube Agent ─────────────────────────────────────

export const SOURCE_TYPE_VALUES = ['primary_official', 'secondary_community', 'secondary_editorial', 'user_generated', 'unknown'] as const;
export type SourceType = (typeof SOURCE_TYPE_VALUES)[number];

export const CONFIDENCE_LEVEL_VALUES = ['confirmed', 'corroborated', 'interpretation', 'theory', 'unverified'] as const;
export type ConfidenceLevel = (typeof CONFIDENCE_LEVEL_VALUES)[number];

/** @deprecated Use SourceType + ConfidenceLevel instead. */
export const RESEARCH_CONFIDENCE_TAGS = ['confirmed_fact', 'official_source', 'interpretation', 'theory', 'unverified'] as const;
export type ResearchConfidenceTag = (typeof RESEARCH_CONFIDENCE_TAGS)[number];

export interface ContextualReference {
	kind: string;
	title: string;
	url: string;
	license: string;
	note: string;
	sourceType: SourceType;
	confidenceLevel: ConfidenceLevel;
	/** @deprecated Use sourceType + confidenceLevel instead. */
	confidenceTag: ResearchConfidenceTag;
	applicableUpToChapter?: number | null;
	rejected: boolean;
	rejectionReason?: string;
}

export interface ContextualResearchOptions {
	enabled: boolean;
	workTitle: string;
	currentChapter: number;
	maxAllowedChapter?: number;
	allowTheories?: boolean;
	extraTerms?: string[];
	signal?: AbortSignal;
	cwd: string;
}

export interface ContextualResearchResult {
	accepted: ContextualReference[];
	rejected: ContextualReference[];
	totalRaw: number;
	agentId: string;
	model: string | null;
	warnings: string[];
	skipped: boolean;
	executionId?: string;
}

// ─── Story Engine Options Extension ──────────────────────────────────────────

/**
 * Minimal port for contextual research execution. Defined here to avoid
 * circular dependency with contextual-research.ts. The canonical interface
 * lives in contextual-research.ts; this is a structural subset for type safety.
 */
export interface StoryEngineResearchPort {
	readonly name: string;
	research(input: { topic: string; signal?: AbortSignal }): Promise<{
		references: Array<{ kind: string; title: string; url: string; license: string; note: string }>;
		rejectedCount: number;
		agentId: string;
		model: string | null;
		executionId?: string;
		ok: boolean;
		error?: string;
	}>;
}

export interface StoryEngineResearchOptions extends ContextualResearchOptions {
	/** ResearchPort instance for executing contextual research. Required when enabled. */
	port: StoryEngineResearchPort;
}

export interface StoryEngineOptions {
	chapterId: string;
	panels: ExtractedPanel[];
	outputDir: string;
	/** Optional durable checkpoint directory (defaults to <outputDir>/<chapterId>/checkpoints). */
	checkpointDir?: string;
	/** Optional prior checkpoint used only as a source of valid panel analyses during regeneration. */
	analysisCacheCheckpointDir?: string;
	/** Read-only analyses migrated from a validated historical pilot checkpoint. */
	historicalPanelAnalyses?: readonly PanelAnalysis[];
	/** Image hashes used to bind migrated historical analyses to current panels. */
	historicalPanelImageHashes?: Readonly<Record<string, string>>;
	/** Explicitly allow deterministic historical migration after identity validation. */
	allowHistoricalPanelCache?: boolean;
	visionAdapter?: VisionAdapter;
	ocrAdapter?: OcrAdapter;
	scriptStyle?: ScriptStyle;
	language?: string;
	/** Humor level configured in UI (0..100). Must never distort story fidelity. */
	humorVolume?: number;
	/** Optional work/manga title for contextual grounding in visual analysis. */
	workTitle?: string;
	/** Minimum confidence to auto-approve a beat. Below → needs_review. */
	minBeatConfidence?: number;
	/** Optional bounded concurrency (1..4) for fresh panel visual analysis. Default: 1. */
	analysisConcurrency?: number;
	/** Phase 2 local triage and provider routing policy. */
	triage?: RecapPanelTriageOptions;
	/** Optional explicit local/economic/premium adapters. Missing tiers fall back safely. */
	visionRoutes?: Partial<Record<RecapPanelRouteTier, VisionAdapter>>;
	/** Enable the bounded incremental narrative memory used in provider context. Default: true. */
	compactNarrativeContext?: boolean;
	/** Optional LLM port for rich narrative script generation from verified beats + continuity. */
	scriptPort?: TextEnhancementPort;
	/** Optional text-agent fallback used only when the generated script fails Gate G. */
	scriptFallbackPort?: TextEnhancementPort;
	/** When true, preserves approved panel analyses & Story Memory and regenerates only continuity + script + Gate G. */
	regenerateScriptOnly?: boolean;
	/** Optional audit hook for cache hits and invalidations; it does not alter narrative output. */
	onAnalysisEvent?: (event: {
		panel: ExtractedPanel;
		cacheKey: string;
		cacheStatus: 'hit' | 'miss' | 'invalidated' | 'deduped';
	}) => void;
	/** Phase 2.2: optional humanization after script generation. */
	humanize?: HumanizeOptions & { port: TextEnhancementPort };
	/** Phase 2.2.3: optional contextual research before script generation. */
	research?: StoryEngineResearchOptions;
	/** Story Memory: optional persistent cross-chapter series memory integration. */
	storyMemory?: {
		workspaceDir: string;
		projectId: string;
		chapterNumber: number;
		autoConsolidate?: boolean;
	};
	/** Manga Vision Analyst skill options for narrative comprehension, sequence consolidation & quality gate. */
	mangaVisionAnalyst?: {
		enabled?: boolean;
		consolidateSequences?: boolean;
		qualityGate?: boolean;
		minConfidence?: number;
		maxPanelsPerSequence?: number;
	};
	/** Optional Phase 4B.7 panel-fidelity boundary. When enforced, uncertain/rejected claims cannot enter Story Engine. */
	panelFidelityGate?: {
		report: RecapFidelityGateReport;
		enforce?: boolean;
	};
	/** Independent evaluation/recovery hook. It runs after visual analysis and before narrative forwarding. */
	fidelityRecovery?: {
		run(input: {
		panels: readonly ExtractedPanel[];
		analyses: readonly PanelAnalysis[];
		gateReport?: RecapFidelityGateReport;
	}): Promise<{
		analyses?: readonly PanelAnalysis[];
		gateReport?: RecapFidelityGateReport;
	}>;
	};
	/** Strict production mode: low-confidence/unknown panel analyses stop before script generation. */
	strictFidelity?: boolean;
}

// ─── Vision Adapter Interface (for panel visual analysis) ────────────────────

export interface StoryMemoryCharacterHint {
	characterId: string;
	displayName: string;
	aliases: readonly string[];
	visualTraits: readonly string[];
	nameStatus: 'unknown' | 'probable' | 'confirmed';
}

export interface StoryMemoryPromptContext {
	currentChapterNumber: number;
	characters: readonly StoryMemoryCharacterHint[];
	recentEvents: readonly string[];
}

export type RecapPanelRouteTier = 'local' | 'economic' | 'premium';

export type RecapPanelTriageCategory =
	| 'simple'
	| 'redundant'
	| 'dialogue_important'
	| 'first_character'
	| 'scene_change'
	| 'action_relevant'
	| 'transition'
	| 'ambiguous'
	| 'low_confidence';

export interface RecapPanelTriageOptions {
	/** Disable routing while keeping the triage result available to diagnostics. */
	enabled?: boolean;
	/** Confidence below this value is escalated when a premium route exists. */
	minConfidence?: number;
	/** Escalate a low-confidence economic/local result to premium when available. */
	fallbackOnLowConfidence?: boolean;
	/** Categories that require the premium route. */
	premiumCategories?: readonly RecapPanelTriageCategory[];
	/** Ordered fallback tiers. Missing tiers are skipped; the base adapter remains final fallback. */
	fallbackOrder?: readonly RecapPanelRouteTier[];
	/** Maximum panels per batch when an adapter explicitly supports batching. */
	batchSize?: number;
}

export interface RecapNarrativeMemory {
	version: 'recap-memory-v1';
	characters: readonly string[];
	recentEvents: readonly string[];
	currentSetting?: string;
	openQuestions: readonly string[];
	lastPanelId?: string;
}

export interface VisionAnalysisContext {
	panelIndex?: number;
	totalPanels?: number;
	readingOrder?: ReadingOrder;
	workTitle?: string;
	previousPanelSummary?: string;
	knownCharacters?: readonly string[];
	storyMemoryContext?: StoryMemoryPromptContext;
	/** Bounded chapter-local memory; adapters should prefer this over full history. */
	narrativeMemory?: RecapNarrativeMemory;
	ocrHint?: string;
	/** Internal correlation key; adapters must not include it in provider prompts. */
	cacheKey?: string;
	/** Internal cache disposition for telemetry; adapters must not include it in prompts. */
	cacheStatus?: 'miss' | 'invalidated';
	/** Internal Phase 4A route selection; adapters must not include it in provider prompts. */
	routeTier?: RecapPanelRouteTier;
	/** Internal Phase 4A triage reason; adapters must not include it in provider prompts. */
	routeReason?: string;
}

export interface VisionAnalysisResult {
	/** Rich observable description of the panel in PT-BR. */
	visualDescription?: string;
	characters: string[];
	characterDetails?: CharacterDetail[];
	actions: Array<{ type: ActionType; description: string }>;
	emotions: Emotion[];
	expressions?: string[];
	relevantObjects?: string[];
	/** Speech bubbles, thoughts, narration boxes and SFX read directly by multimodal vision. */
	speechBubbles?: DialogueEntry[];
	setting: string | undefined;
	readingOrderHint?: string;
	relationToPrevious?: string;
	relationToNext?: string;
	uncertainties?: string[];
	confidence: number;
	/** True when this request joined an in-flight equivalent request. */
	deduped?: boolean;
	/** Provider-reported usage, when the adapter can expose it. */
	usage?: {
		inputTokens?: number | null;
		outputTokens?: number | null;
		cachedTokens?: number | null;
		cacheWriteTokens?: number | null;
		effectiveApiCostUsd?: number | null;
		estimatedCostUsd?: number | null;
		quotaUnits?: number | null;
		quotaKind?: string | null;
		cliQuotaWindows?: readonly { id: string; utilization: number; resetsAt: string | null; status: string }[];
	};
}

/**
 * Vision adapter interface for analyzing panel images.
 * Implementations may use multimodal LLMs, object detection, or other CV models.
 * Must never fabricate results — return low confidence when uncertain.
 */
export interface VisionAdapter {
	readonly name: string;
	analyze(imagePathOrBuffer: string | Buffer, context?: VisionAnalysisContext): Promise<VisionAnalysisResult>;
	/** Explicit opt-in batch capability. Results must correspond to inputs by index. */
	analyzeBatch?(inputs: readonly {
		imagePathOrBuffer: string | Buffer;
		context?: VisionAnalysisContext;
	}[], options?: { signal?: AbortSignal }): Promise<readonly VisionAnalysisResult[]>;
	/** Maximum images accepted by `analyzeBatch`; absent means batching is unsupported. */
	maxImagesPerCall?: number;
}

