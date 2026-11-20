// ─── Types & Schemas ─────────────────────────────────────────────────────────
export {
 // Enums / unions
 READING_ORDER_VALUES,
 PANEL_CLASSIFICATION_VALUES,
 MANGA_SOURCE_KIND_VALUES,
 MANGA_ORIGIN_VALUES,
 RECAP_STAGE_VALUES,
 OCR_STATUS_VALUES,
 // Zod schemas
 boundingBoxSchema,
 mangaPanelMetadataSchema,
 extractedPanelSchema,
 importedPageSchema,
 importedChapterSchema,
 recapCheckpointSchema,
 // TypeScript types
 type ReadingOrder,
 type PanelClassification,
 type MangaSourceKind,
 type MangaOrigin,
 type OcrStatus,
 type BoundingBox,
 type MangaPanelMetadata,
 type ExtractedPanel,
 type ImportedPage,
 type ImportedChapter,
 type RecapStage,
 type RecapCheckpoint,
 type OcrResult,
 type OcrAdapter,
 type PanelExtractionResult,
 type ImportChapterOptions,
 type GateFPanelIntegrityInput,
} from './recap-types.js';

// ─── Chapter Importer ────────────────────────────────────────────────────────
export { importChapter } from './chapter-importer.js';

// ─── Panel Extractor ─────────────────────────────────────────────────────────
export { extractPanels, type ExtractPanelsOptions } from './panel-extractor.js';

// ─── Tesseract OCR Adapter ───────────────────────────────────────────────────
export { createTesseractOcrAdapter, type TesseractOcrOptions } from './tesseract-ocr-adapter.js';

// ─── Gate F — Panel Integrity ────────────────────────────────────────────────
export {
 runGateFPanelIntegrity,
 type GateFVerdict,
 type GateFRepairHint,
 type GateFReport,
} from './gate-f-panel-integrity.js';

// ─── Checkpoint Persistence ──────────────────────────────────────────────────
export { saveCheckpoint, loadCheckpoint, computePanelCacheKey, invalidateCheckpointCache, clearCheckpoint, RECAP_ANALYZER_VERSION } from './checkpoint-persistence.js';

// ─── PDF Import Adapter ──────────────────────────────────────────────────────
export { renderPdfToImages } from './pdf-import-adapter.js';

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 2 — STORY ENGINE EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Phase 2 Types & Schemas ─────────────────────────────────────────────────
export {
	// Enums / unions
	EVIDENCE_KIND_VALUES,
	EMOTION_VALUES,
	ACTION_TYPE_VALUES,
	NARRATIVE_INTENT_VALUES,
	REVIEW_STATUS_VALUES,
	SCRIPT_STYLE_VALUES,
	// Zod schemas
	narrativeEvidenceSchema,
	panelAnalysisSchema,
	storyBeatSchema,
	narrativeSequenceSchema,
	sceneSchema,
	recapScriptSchema,
	// TypeScript types
	type EvidenceKind,
	type Emotion,
	type ActionType,
	type NarrativeIntent,
	type ReviewStatus,
	type ScriptStyle,
	type NarrativeEvidence,
	type PanelAnalysis,
	type StoryBeat,
	type NarrativeSequence,
	type Scene,
	type RecapScript,
	type GateGVerdict,
	type GateGFidelityHint,
	type GateGReport,
	type GateGDivergenceReport,
	type VisionAnalysisResult,
	type VisionAdapter,
	type StoryEngineOptions,
} from './recap-types.js';

// ─── Narrative Analyzer ──────────────────────────────────────────────────────
export {
	runNarrativeAnalyzer,
	type NarrativeAnalyzerOptions,
	type NarrativeAnalysisResult,
} from './narrative-analyzer.js';

// ─── Story Continuity Engine ─────────────────────────────────────────────────
export {
	runStoryContinuityEngine,
	type ContinityEngineOptions,
	type ContinuityResult,
} from './story-continuity-engine.js';

// ─── Script Generator & Scene Mapper ─────────────────────────────────────────
export {
	runScriptGenerator,
	type ScriptGeneratorOptions,
	type ScriptGenerationResult,
} from './script-generator.js';

// ─── Gate G — Narrative Fidelity ─────────────────────────────────────────────
export { runGateGNarrativeFidelity, buildGateGDivergenceReport, type GateGInput } from './gate-g-narrative-fidelity.js';

// ─── Story Engine Orchestrator ───────────────────────────────────────────────
export { runStoryEngine, type StoryEngineResult } from './story-engine.js';

// ─── Recap Vision Adapter (Bridge to Orchestrator VisionRouter) ──────────────
export {
	createRecapVisionAdapter,
	createTaskEngineRecapVisionAdapter,
	createRoutedRecapVisionAdapter,
	type RecapVisualAnalysisPort,
	type RecapVisionRouterPort,
	type RecapVisionAdapterOptions,
} from './recap-vision-adapter.js';

// ─── Claude Vision Provider (E2E Phase 2.2.4) ────────────────────────────────
export { createClaudeVisionProvider, type ClaudeVisionProviderOptions } from './claude-vision-provider.js';

// ═══════════════════════════════════════════════════════════════════════════════
// FASE 2.2 — NARRATIVE ENHANCEMENT EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Phase 2.2 Types & Schemas ───────────────────────────────────────────────
export {
	HUMANIZE_STYLE_VALUES,
	type HumanizeStyle,
	type TextEnhancementPort,
	type TextEnhancementRequest,
	type TextEnhancementResult,
	type HumanizeOptions,
	type HumanizeSceneDiff,
	type HumanizeResult,
} from './recap-types.js';

// ─── Narrative Humanizer ─────────────────────────────────────────────────────
export { runNarrativeHumanizer, type RunNarrativeHumanizerInput } from './narrative-humanizer.js';

// ─── Contextual Research / YouTube Agent ─────────────────────────────────────
export {
	runContextualResearch,
	type RunContextualResearchInput,
	type ResearchPort,
	type ResearchPortRequest,
	type ResearchPortResult,
	type RawResearchReference,
	SOURCE_TYPE_VALUES,
	CONFIDENCE_LEVEL_VALUES,
	type SourceType,
	type ConfidenceLevel,
	createTaskEngineTextEnhancementAdapter,
	createVideoResearchPortAdapter,
	createMultiAgentVideoResearchPortAdapter,
	type TextTaskEnginePort,
	type ResearchAgentAdapterPort,
} from './contextual-research.js';

export {
	RESEARCH_CONFIDENCE_TAGS,
	type ResearchConfidenceTag,
	type ContextualReference,
	type ContextualResearchOptions,
	type ContextualResearchResult,
	type StoryEngineResearchOptions,
} from './recap-types.js';

// ─── Vision Error Classification & Circuit Breaker (Phase 2.2.4) ─────────────
export {
	VISION_ERROR_CODES,
	type VisionErrorCode,
	type VisionProviderDiagnostic,
	RecapVisionError,
	AllVisionProvidersUnavailableError,
	classifyVisionError,
	detectProviderErrorInText,
	sanitizeErrorMessage,
	extractResetInfo,
} from './vision-error-classifier.js';

export {
	AgentCircuitBreaker,
	type AgentCircuitState,
} from './vision-circuit-breaker.js';
