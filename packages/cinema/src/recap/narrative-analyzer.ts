import { readFileSync } from 'node:fs';
import type {
	ExtractedPanel,
	PanelAnalysis,
	NarrativeEvidence,
	VisionAdapter,
	OcrAdapter,
	Emotion,
	ActionType,
	EvidenceKind,
} from './recap-types.js';
import { panelAnalysisSchema } from './recap-types.js';
import { computePanelCacheKey, RECAP_ANALYZER_VERSION } from './checkpoint-persistence.js';
import { AllVisionProvidersUnavailableError } from './vision-error-classifier.js';

export interface NarrativeAnalyzerOptions {
	panels: ExtractedPanel[];
	visionAdapter?: VisionAdapter | undefined;
	ocrAdapter?: OcrAdapter | undefined;
	/** Agent/model identifier recorded in each analysis. */
	analyzedBy: string;
	/** Minimum confidence to consider an analysis reliable. Default: 0.5. */
	minConfidence?: number | undefined;
	/** Bounded concurrency for fresh vision calls (clamped 1..4). Default: 1. */
	concurrency?: number | undefined;
	/** Previously completed panel analyses from checkpoint (keyed by panelId). */
	cachedAnalyses?: readonly PanelAnalysis[] | undefined;
	/** Previously completed panel analyses keyed by imageHash. */
	analysisCacheByHash?: Readonly<Record<string, PanelAnalysis>> | undefined;
	/** Model identifier bound into the cache key. Defaults to analyzedBy. */
	cacheModel?: string | undefined;
	/** Analyzer version bound into the cache key. Defaults to RECAP_ANALYZER_VERSION. */
	analyzerVersion?: string | undefined;
	/** Optional callback invoked after each valid fresh panel analysis for incremental checkpointing. */
	onPanelAnalyzed?: ((analysis: PanelAnalysis, panel: ExtractedPanel) => void) | undefined;
}

export interface NarrativeAnalysisResult {
	analyses: PanelAnalysis[];
	warnings: string[];
	cacheHits?: number;
	analyzedFresh?: number;
}

/**
 * Sorts panels according to the chapter's reading order.
 * RTL: right-to-left columns, top-to-bottom within column.
 * LTR: left-to-right columns, top-to-bottom within column.
 * Vertical: top-to-bottom (manhwa/webtoon strip).
 */
function sortPanelsByReadingOrder(panels: ExtractedPanel[]): ExtractedPanel[] {
	if (panels.length === 0) return [];

	const readingOrder = panels[0]!.metadata.readingOrder;

	if (readingOrder === 'vertical') {
 return [...panels].sort((a, b) => {
 if (a.metadata.pageNumber !== b.metadata.pageNumber) {
 return a.metadata.pageNumber - b.metadata.pageNumber;
 }
 return a.metadata.boundingBox.y - b.metadata.boundingBox.y;
 });
	}

	// RTL or LTR: group by page, then sort columns, then rows within columns
	const grouped = new Map<number, ExtractedPanel[]>();
	for (const panel of panels) {
 const list = grouped.get(panel.metadata.pageNumber) ?? [];
 list.push(panel);
 grouped.set(panel.metadata.pageNumber, list);
	}

	const sorted: ExtractedPanel[] = [];
	const pageNumbers = [...grouped.keys()].sort((a, b) => a - b);

	for (const pageNum of pageNumbers) {
 const pagePanels = grouped.get(pageNum)!;
 // Sort by x position first (columns), then y within columns
 const colSorted = [...pagePanels].sort((a, b) => {
 const xDiff = a.metadata.boundingBox.x - b.metadata.boundingBox.x;
 if (Math.abs(xDiff) > Math.min(a.width, b.width) * 0.3) {
 return readingOrder === 'rtl' ? -xDiff : xDiff;
 }
 return a.metadata.boundingBox.y - b.metadata.boundingBox.y;
 });
 sorted.push(...colSorted);
	}

	return sorted;
}

/**
 * Extracts narrative evidence from OCR text content.
 * Returns dialogue entries and text-based evidence with confidence tied to OCR quality.
 */
function extractOcrEvidence(panel: ExtractedPanel): {
	dialogues: Array<{ speaker?: string; text: string; isNarration: boolean }>;
	evidence: NarrativeEvidence[];
} {
	const dialogues: Array<{ speaker?: string; text: string; isNarration: boolean }> = [];
	const evidence: NarrativeEvidence[] = [];

	if (panel.metadata.ocrStatus !== 'success' || !panel.metadata.textContent) {
 return { dialogues, evidence };
	}

	const text = panel.metadata.textContent.trim();
	if (text.length === 0) return { dialogues, evidence };

	// Simple heuristic: lines in quotes or ALL CAPS are likely dialogue
	const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
	for (const line of lines) {
 const isQuoted = /^["""「『【]/.test(line) || /["""」』】]$/.test(line);
 const isAllCaps = line === line.toUpperCase() && line.length > 2 && /[A-ZÀ-Ú]/.test(line);
 const isNarration = !isQuoted && !isAllCaps && line.length > 40;

 dialogues.push({
 text: line.replace(/^["""「『【]|["""」』】]$/g, '').trim(),
 isNarration,
 });

 evidence.push({
 kind: 'ocr_text',
 content: line,
 confidence: panel.metadata.ocrConfidence,
 sourcePanelId: panel.panelId,
 });
	}

	return { dialogues, evidence };
}

/**
 * Analyzes a single panel using available adapters (vision + OCR).
 * Never fabricates information — returns low confidence when data is insufficient.
 */
async function analyzePanel(
	panel: ExtractedPanel,
	options: NarrativeAnalyzerOptions,
): Promise<PanelAnalysis> {
	const { visionAdapter, analyzedBy } = options;
	const warnings: string[] = [];

	// 1. Extract OCR-based evidence
	const { dialogues, evidence: ocrEvidence } = extractOcrEvidence(panel);

	// 2. Attempt visual analysis if adapter is available
	let characters: string[] = [];
	let actions: Array<{ type: ActionType; description: string }> = [];
	let emotions: Emotion[] = [];
	let setting: string | undefined;
	let visualConfidence = 0;
	const visualEvidence: NarrativeEvidence[] = [];

	if (visionAdapter) {
 try {
 const imagePath = panel.croppedImagePath ?? panel.pagePath;
 const imageInput = panel.croppedImagePath
 ? readFileSync(panel.croppedImagePath)
 : imagePath;

 const result = await visionAdapter.analyze(imageInput);
 characters = result.characters;
 actions = result.actions;
 emotions = result.emotions;
 setting = result.setting;
 visualConfidence = result.confidence;

 for (const char of characters) {
 visualEvidence.push({
 kind: 'visual_observation',
 content: `Character detected: ${char}`,
 confidence: result.confidence,
 sourcePanelId: panel.panelId,
 });
 }
 for (const action of actions) {
 visualEvidence.push({
 kind: 'visual_observation',
 content: `Action: ${action.description}`,
 confidence: result.confidence,
 sourcePanelId: panel.panelId,
 });
 }
 } catch (err) {
 if (err instanceof AllVisionProvidersUnavailableError) {
 throw err;
 }
 const msg = err instanceof Error ? err.message : String(err);
 warnings.push(`Panel ${panel.panelId}: vision analysis failed — ${msg}`);
 }
	} else {
 // No vision adapter: mark as inference-only with zero visual confidence
 if (dialogues.length > 0) {
 // We have text but no visual confirmation of who is speaking
 for (const d of dialogues) {
 if (!d.isNarration) {
 visualEvidence.push({
 kind: 'inference',
 content: `Dialogue present but speaker unverified (no vision adapter): "${d.text.slice(0, 60)}..."`,
 confidence: 0.2,
 sourcePanelId: panel.panelId,
 });
 }
 }
 }
	}

	// 3. Compute overall analysis confidence
	const allEvidence = [...ocrEvidence, ...visualEvidence];
	const hasOcr = ocrEvidence.length > 0;
	const hasVision = visualEvidence.some((e) => e.kind === 'visual_observation');

	let analysisConfidence: number;
	if (hasOcr && hasVision) {
 // Both sources agree: average their confidences
 const avgOcr = ocrEvidence.reduce((s, e) => s + e.confidence, 0) / ocrEvidence.length;
 analysisConfidence = (avgOcr + visualConfidence) / 2;
	} else if (hasVision) {
 analysisConfidence = visualConfidence;
	} else if (hasOcr) {
 // Text only, no visual verification
 const avgOcr = ocrEvidence.reduce((s, e) => s + e.confidence, 0) / ocrEvidence.length;
 analysisConfidence = avgOcr * 0.7; // Penalize lack of visual confirmation
	} else {
 // No evidence at all
 analysisConfidence = 0;
	}

	// 4. Classify action type from available data
	let primaryAction: ActionType = 'none';
	if (actions.length > 0) {
 primaryAction = actions[0]!.type;
	} else if (dialogues.some((d) => !d.isNarration)) {
 primaryAction = 'dialogue';
	} else if (panel.metadata.classification === 'action') {
 primaryAction = 'combat';
 } else if (panel.metadata.classification === 'splash') {
 primaryAction = 'transformation';
	}

	// 5. Build and validate the analysis
	const analysis: PanelAnalysis = panelAnalysisSchema.parse({
 panelId: panel.panelId,
 characters,
 dialogues,
 actions: actions.length > 0 ? actions : [{ type: primaryAction, description: primaryAction === 'none' ? 'No detectable action' : `Inferred ${primaryAction} from panel classification` }],
 emotions: emotions.length > 0 ? emotions : ['unknown'],
 setting,
 evidence: allEvidence,
 analysisConfidence,
 analyzedBy,
 analyzedAtIso: new Date().toISOString(),
	});

	return analysis;
}

/**
 * Narrative Analyzer — Phase 2 core component.
 *
 * Consumes extracted panels from Phase 1 and produces structured PanelAnalysis
 * objects with explicit evidence, confidence scores, and agent attribution.
 *
 * KEY GUARANTEES:
 * - Respects reading order (RTL, LTR, vertical).
 * - Distinguishes verified observations (OCR, vision) from inferences.
 * - Never fabricates characters, events, or dialogue not supported by evidence.
 * - Records which agent/model produced each analysis.
 * - Returns low confidence when data is insufficient instead of guessing.
 */
export async function runNarrativeAnalyzer(
	options: NarrativeAnalyzerOptions,
): Promise<NarrativeAnalysisResult> {
	const {
		panels,
		minConfidence = 0.5,
		concurrency = 1,
		cachedAnalyses,
		analysisCacheByHash,
		cacheModel = options.analyzedBy,
		analyzerVersion = RECAP_ANALYZER_VERSION,
		onPanelAnalyzed,
	} = options;
	const warnings: string[] = [];

	// Build lookup caches for valid reusable analyses (never reuse zero-confidence failures)
	const cacheByPanelId = new Map<string, PanelAnalysis>();
	if (cachedAnalyses) {
		for (const entry of cachedAnalyses) {
			const parsed = panelAnalysisSchema.safeParse(entry);
			if (parsed.success && parsed.data.analysisConfidence > 0) {
				cacheByPanelId.set(parsed.data.panelId, parsed.data);
			}
		}
	}
	const cacheByKey = new Map<string, PanelAnalysis>();
	if (analysisCacheByHash) {
		for (const [key, entry] of Object.entries(analysisCacheByHash)) {
			const parsed = panelAnalysisSchema.safeParse(entry);
			if (parsed.success && parsed.data.analysisConfidence > 0) {
				cacheByKey.set(key, parsed.data);
			}
		}
	}

	// Sort panels by reading order before analysis
	const orderedPanels = sortPanelsByReadingOrder(panels);
	const results: Array<PanelAnalysis | undefined> = new Array(orderedPanels.length);
	const panelWarnings: string[][] = orderedPanels.map(() => []);
	let cacheHits = 0;
	let analyzedFresh = 0;
	let fatalProviderError: AllVisionProvidersUnavailableError | null = null;

	const maxWorkers = Math.max(1, Math.min(4, Math.floor(concurrency)));
	let nextIndex = 0;

	const worker = async () => {
		while (true) {
			if (fatalProviderError) break;
			const idx = nextIndex++;
			if (idx >= orderedPanels.length) break;
			const panel = orderedPanels[idx]!;
			const compositeKey = computePanelCacheKey({
				imageHash: panel.imageHash,
				model: cacheModel,
				analyzerVersion,
			});

			// Check cache by composite key (imageHash + model + version), then panelId, then legacy raw hash
			const cached = cacheByKey.get(compositeKey) ?? cacheByPanelId.get(panel.panelId) ?? cacheByKey.get(panel.imageHash);
			if (cached) {
				const reused: PanelAnalysis = cached.panelId === panel.panelId
					? cached
					: {
						...cached,
						panelId: panel.panelId,
						evidence: cached.evidence.map((e) => ({ ...e, sourcePanelId: panel.panelId })),
					};
				results[idx] = reused;
				cacheHits++;
				if (reused.analysisConfidence < minConfidence) {
					panelWarnings[idx]!.push(
						`Panel ${panel.panelId}: analysis confidence ${reused.analysisConfidence.toFixed(2)} below threshold ${minConfidence}. Marked for review.`,
					);
				}
				continue;
			}

			try {
				const analysis = await analyzePanel(panel, options);
				results[idx] = analysis;
				analyzedFresh++;
				if (analysis.analysisConfidence > 0) {
					cacheByKey.set(compositeKey, analysis);
					cacheByKey.set(panel.imageHash, analysis);
					onPanelAnalyzed?.(analysis, panel);
				}
				if (analysis.analysisConfidence < minConfidence) {
					panelWarnings[idx]!.push(
						`Panel ${panel.panelId}: analysis confidence ${analysis.analysisConfidence.toFixed(2)} below threshold ${minConfidence}. Marked for review.`,
					);
				}
			} catch (err) {
				if (err instanceof AllVisionProvidersUnavailableError) {
					if (!fatalProviderError) fatalProviderError = err;
					break;
				}
				const msg = err instanceof Error ? err.message : String(err);
				panelWarnings[idx]!.push(`Panel ${panel.panelId}: analysis failed — ${msg}`);
			}
		}
	};

	await Promise.all(Array.from({ length: Math.min(maxWorkers, Math.max(1, orderedPanels.length)) }, () => worker()));

	if (fatalProviderError) {
		throw fatalProviderError;
	}

	const analyses: PanelAnalysis[] = [];
	for (let i = 0; i < orderedPanels.length; i++) {
		warnings.push(...panelWarnings[i]!);
		if (results[i]) analyses.push(results[i]!);
	}

	return { analyses, warnings, cacheHits, analyzedFresh };
}