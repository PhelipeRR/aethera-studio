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
export { importChapter, sortPageFiles } from './chapter-importer.js';

// ─── Panel Extractor ─────────────────────────────────────────────────────────
export { extractPanels, segmentVerticalStrip, type ExtractPanelsOptions } from './panel-extractor.js';

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
export {
	saveCheckpoint,
	loadCheckpoint,
	computePanelCacheKey,
	computeScriptCacheKey,
	invalidateCheckpointCache,
	clearCheckpoint,
	RECAP_ANALYZER_VERSION,
	RECAP_SCRIPT_GENERATOR_VERSION,
} from './checkpoint-persistence.js';

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
	DIALOGUE_KIND_VALUES,
	RECAP_TEXT_CONTENT_KIND_VALUES,
	RECAP_TEXT_EVIDENCE_SOURCE_VALUES,
	DURATION_SOURCE_VALUES,
	NARRATIVE_INTENT_VALUES,
	REVIEW_STATUS_VALUES,
	SCRIPT_STYLE_VALUES,
	// Zod schemas
	narrativeEvidenceSchema,
	dialogueEntrySchema,
	characterDetailSchema,
	panelAnalysisSchema,
	continuityCharacterSchema,
	continuityRelationshipSchema,
	storyContinuityStateSchema,
	storyBeatSchema,
	narrativeSequenceSchema,
	sceneSchema,
	recapScriptSchema,
	// TypeScript types
	type EvidenceKind,
	type Emotion,
	type ActionType,
	type DialogueKind,
	type RecapTextContentKind,
	type RecapTextEvidenceSource,
	type RecapTextEvidence,
	type RecapTextProvenance,
	type DurationSource,
	type DialogueEntry,
	type CharacterDetail,
	type NarrativeIntent,
	type ReviewStatus,
	type ScriptStyle,
	type NarrativeEvidence,
	type PanelAnalysis,
	type ContinuityCharacter,
	type ContinuityRelationship,
	type StoryContinuityState,
	type StoryBeat,
	type NarrativeSequence,
	type Scene,
	type RecapScript,
	type GateGVerdict,
	type GateGFidelityHint,
	type GateGReport,
	type GateGDivergenceReport,
	type VisionAnalysisContext,
	type VisionAnalysisResult,
	type VisionAdapter,
	type RecapPanelRouteTier,
	type RecapPanelTriageCategory,
	type RecapPanelTriageOptions,
	type RecapAnalysisSettings,
	type RecapNarrativeMemory,
	type StoryEngineOptions,
} from './recap-types.js';

export {
	classifyRecapTextContent,
	dialogueKindForContent,
	annotateRecapDialogue,
	buildRecapMotionMetadata,
	type RecapTextClassification,
	type RecapTextClassificationInput,
} from './recap-text-classification.js';

// ─── Dialogue Extractor ──────────────────────────────────────────────────────
export {
	classifyBubbleKind,
	extractStructuredOcrDialogues,
	mergeVisionAndOcrDialogues,
} from './dialogue-extractor.js';

// ─── Narrative Analyzer ──────────────────────────────────────────────────────
export {
	runNarrativeAnalyzer,
	type NarrativeAnalyzerOptions,
	type NarrativeAnalysisResult,
} from './narrative-analyzer.js';

export {
	triageRecapPanels,
	type RecapPanelTriageDecision,
	type RecapPanelTriageResult,
} from './panel-triage.js';

export {
	createNarrativeMemory,
	updateNarrativeMemory,
	estimateContextTokens,
} from './compact-narrative-context.js';

// ─── Story Continuity Engine ─────────────────────────────────────────────────
export {
	runStoryContinuityEngine,
	type ContinityEngineOptions,
	type ContinuityResult,
} from './story-continuity-engine.js';

// ─── Script Generator & Scene Mapper ─────────────────────────────────────────
export {
	runScriptGenerator,
	refineScriptWithPort,
	extractNarrativeEventsFromBeat,
	detectTechnicalVisualDescription,
	detectUngroundedInventions,
	detectAnticipatedNextSceneEvents,
	isGenericNarration,
	isReviewRequiredPlaceholder,
	estimateNarrationDurationSec,
	REVIEW_REQUIRED_PREFIX,
	type ScriptGeneratorOptions,
	type ScriptGenerationResult,
	type StructuredNarrativeEvent,
	type TechnicalVisualDetection,
} from './script-generator.js';

// ─── Gate G — Narrative Fidelity ─────────────────────────────────────────────
export { runGateGNarrativeFidelity, buildGateGDivergenceReport, type GateGInput } from './gate-g-narrative-fidelity.js';

// ─── Independent Recap Narrative Fidelity Gate (Phase 4B.7) ────────────────
export {
	runRecapFidelityGate,
	canForwardToStoryEngine,
	getStoryEngineEligiblePanelIds,
	RECAP_FIDELITY_STATUS_VALUES,
	RECAP_FIDELITY_ELIGIBILITY_VALUES,
	RECAP_FIDELITY_CHECK_STATUS_VALUES,
	RECAP_FIDELITY_SEVERITY_VALUES,
	RECAP_FIDELITY_ISSUE_CODES,
	type RecapFidelityStatus,
	type RecapFidelityEligibility,
	type RecapFidelityCheckStatus,
	type RecapFidelitySeverity,
	type RecapFidelityIssueCode,
	type RecapFidelityEvidence,
	type RecapFidelityIssue,
	type RecapFidelityCheck,
	type RecapFidelityCheckpoint,
	type RecapFidelityHumanReview,
	type RecapFidelityPanelInput,
	type RecapFidelityPanelReport,
	type RecapFidelityGateInput,
	type RecapFidelityGateMetrics,
	type RecapFidelityGateReport,
} from './recap-fidelity-gate.js';

// ─── Selective Fidelity Auto-Recovery (Phase 4B.8) ──────────────────────────
export {
	runRecapFidelityRecovery,
	applyRecapRecoveryToReview,
	recoveryIssueCodes,
	RecapFidelityRecoveryStore,
	DEFAULT_RECAP_RECOVERY_BUDGET,
	RECAP_FIDELITY_RECOVERY_VERSION,
	type RecapRecoveryStatus,
	type RecapRecoveryStrategy,
	type RecapRecoveryBoundingBox,
	type RecapRecoveryContext,
	type RecapRecoveryPanel,
	type RecapLocalizedOcrRequest,
	type RecapLocalizedOcrResult,
	type RecapLocalizedOcrAdapter,
	type RecapRecoveryBudget,
	type RecapRecoveryCorrection,
	type RecapRecoveryLedgerEntry,
	type RecapRecoveryRecord,
	type RecapRecoveryRunResult,
	type RecapRecoveryStoreOptions,
} from './recap-fidelity-recovery.js';

// ─── PaddleOCR local adapter ─────────────────────────────────────────────────
export {
	createPaddleOcrAdapter,
	createPaddleOcrTextAdapter,
	PADDLE_OCR_ADAPTER_VERSION,
	type PaddleOcrAdapter,
	type PaddleOcrAdapterOptions,
	type PaddleOcrBudgetPort,
	type PaddleOcrLine,
	type PaddleOcrResult,
} from './paddleocr-adapter.js';

// ─── Story Engine Orchestrator ───────────────────────────────────────────────
export { runStoryEngine, type StoryEngineResult } from './story-engine.js';

// Historical pilot checkpoints: read-only validation and deterministic migration into the
// productive PanelAnalysis contract. Original artifacts are never overwritten.
export {
	resolveHistoricalRecapCheckpoints,
	mergeHistoricalRecapCheckpointReports,
	historicalAnalysesForProductiveCache,
	type HistoricalCheckpointStatus,
	type HistoricalCheckpointIdentity,
	type HistoricalCheckpointResolution,
	type HistoricalCheckpointResolutionReport,
} from './historical-checkpoint-cache.js';

// Incremental fidelity progress: pending analysis is explicit and never treated
// as evidence-backed approval for Story Engine.
export {
	buildRecapFidelityProgress,
	saveRecapFidelityProgress,
	type RecapFidelityProgressStatus,
	type RecapFidelityProgressPanel,
	type RecapFidelityProgressReport,
} from './fidelity-progress.js';

// ─── Recap Vision Adapter (Bridge to Orchestrator VisionRouter) ──────────────
export {
	createRecapVisionAdapter,
	createTaskEngineRecapVisionAdapter,
	createRoutedRecapVisionAdapter,
	formatVisionRoutingSummary,
	buildRecapVisionContextString,
	RECAP_VISION_PROMPT_VERSION,
	type VisionRoutingStepSummary,
	type RecapVisualAnalysisPort,
	type RecapVisionRouterPort,
	type RecapVisionAdapterOptions,
	type StructuredVisionPayload,
} from './recap-vision-adapter.js';

// ─── Claude Vision Provider (E2E Phase 2.2.4) ────────────────────────────────
export { createClaudeVisionProvider, detectImageMimeType, type ClaudeVisionProviderOptions } from './claude-vision-provider.js';

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
	parseResetAtMs,
} from './vision-error-classifier.js';

export {
	AgentCircuitBreaker,
	type AgentCircuitState,
} from './vision-circuit-breaker.js';

export {
	MULTIMODAL_HEALTH_STATES,
	MULTIMODAL_HEALTH_LABELS,
	type MultimodalHealthState,
	type MultimodalProviderHealthRecord,
	type VisionHealthProbeCandidate,
	createTinyProbePngBuffer,
	ensureVisionHealthProbeImage,
	mapErrorCodeToMultimodalState,
	inspectPassiveMultimodalHealth,
	loadVisionHealthCheckCache,
	runMultimodalVisionHealthCheck,
} from './vision-health-check.js';

// ─── Story Memory (Persistent Cross-Chapter Narrative Memory) ────────────────
export * from './story-memory.js';

// ─── Manga Vision Analyst Skill ──────────────────────────────────────────────
export * from './manga-vision-analyst.js';

// ─── Phase 3 — Audiovisual Production Exports ────────────────────────────────
export * from './phase3/index.js';
export * from './production-readiness.js';
export * from './phase4/recap-prompt-revision.js';
export * from './phase5/recap-production-orchestrator.js';
export * from './phase5/recap-project-store.js';
export * from './phase5/recap-production-job-manager.js';
export * from './phase5/recap-usage-telemetry.js';
export * from './recap-chapter-markers.js';
export * from './url-importer/index.js';


// ─── Independent fidelity review ledger (Phase 4B.11) ───────────────────────
export {
	buildRecapFidelityGateFromReviews,
	loadRecapFidelityReviewLedger,
	recapAnalysisFingerprint,
	recapFidelityReviewLedgerSchema,
	recapFidelityReviewRecordSchema,
	type RecapFidelityReviewLedger,
	type RecapFidelityReviewRecord,
	type RecapFidelityReviewGateResult,
} from './recap-fidelity-review-ledger.js';

// ─── Explicit per-panel re-analysis request (Phase 4B.11) ───────────────────
export {
	RECAP_REANALYSIS_REQUEST_FILENAME,
	applyRecapReanalysisRequest,
	excludeReanalysisPanels,
	loadRecapReanalysisRequest,
	recapReanalysisRequestSchema,
	type RecapReanalysisRequest,
	type RecapReanalysisApplyResult,
} from './recap-reanalysis-request.js';
