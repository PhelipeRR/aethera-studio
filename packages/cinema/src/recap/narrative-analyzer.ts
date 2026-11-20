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

export interface NarrativeAnalyzerOptions {
	panels: ExtractedPanel[];
	visionAdapter?: VisionAdapter | undefined;
	ocrAdapter?: OcrAdapter | undefined;
	/** Agent/model identifier recorded in each analysis. */
	analyzedBy: string;
	/** Minimum confidence to consider an analysis reliable. Default: 0.5. */
	minConfidence?: number | undefined;
}

export interface NarrativeAnalysisResult {
	analyses: PanelAnalysis[];
	warnings: string[];
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
	const { panels, minConfidence = 0.5 } = options;
	const warnings: string[] = [];

	// Sort panels by reading order before analysis
	const orderedPanels = sortPanelsByReadingOrder(panels);

	const analyses: PanelAnalysis[] = [];
	for (const panel of orderedPanels) {
 try {
 const analysis = await analyzePanel(panel, options);
 if (analysis.analysisConfidence < minConfidence) {
 warnings.push(
 `Panel ${panel.panelId}: analysis confidence ${analysis.analysisConfidence.toFixed(2)} below threshold ${minConfidence}. Marked for review.`,
 );
 }
 analyses.push(analysis);
 } catch (err) {
 const msg = err instanceof Error ? err.message : String(err);
 warnings.push(`Panel ${panel.panelId}: analysis failed — ${msg}`);
 }
	}

	return { analyses, warnings };
}