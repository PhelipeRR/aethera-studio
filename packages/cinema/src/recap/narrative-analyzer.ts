import { readFileSync } from 'node:fs';
import type {
	ExtractedPanel,
	PanelAnalysis,
	NarrativeEvidence,
	VisionAdapter,
	VisionAnalysisContext,
	OcrAdapter,
	Emotion,
	ActionType,
	DialogueEntry,
	CharacterDetail,
} from './recap-types.js';
import { panelAnalysisSchema } from './recap-types.js';
import { computePanelCacheKey, RECAP_ANALYZER_VERSION } from './checkpoint-persistence.js';
import { AllVisionProvidersUnavailableError } from './vision-error-classifier.js';
import { extractStructuredOcrDialogues, mergeVisionAndOcrDialogues } from './dialogue-extractor.js';

export interface NarrativeAnalyzerOptions {
	panels: ExtractedPanel[];
	visionAdapter?: VisionAdapter | undefined;
	ocrAdapter?: OcrAdapter | undefined;
	/** Agent/model identifier recorded in each analysis. */
	analyzedBy: string;
	/** Optional work title for contextual grounding in visual analysis. */
	workTitle?: string | undefined;
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
 * Analyzes a single panel using available adapters (vision + OCR).
 * Never fabricates information — returns low confidence when data is insufficient.
 */
async function analyzePanel(
	panel: ExtractedPanel,
	options: NarrativeAnalyzerOptions,
	visionContext?: VisionAnalysisContext,
): Promise<PanelAnalysis> {
	const { visionAdapter, analyzedBy } = options;

	// 1. Extract structured OCR-based evidence
	const { dialogues: ocrDialogues, evidence: ocrEvidence, uncertainties: ocrUncertainties } = extractStructuredOcrDialogues(panel);

	// 2. Attempt multimodal visual analysis if adapter is available
	let visualDescription: string | undefined;
	let characters: string[] = [];
	let characterDetails: CharacterDetail[] | undefined;
	let actions: Array<{ type: ActionType; description: string }> = [];
	let emotions: Emotion[] = [];
	let expressions: string[] | undefined;
	let relevantObjects: string[] | undefined;
	let setting: string | undefined;
	let readingOrderHint: string | undefined;
	let relationToPrevious: string | undefined;
	let relationToNext: string | undefined;
	let visionBubbles: DialogueEntry[] | undefined;
	let visionUncertainties: string[] = [];
	let visualConfidence = 0;
	const visualEvidence: NarrativeEvidence[] = [];

	if (visionAdapter) {
		try {
			const imagePath = panel.croppedImagePath ?? panel.pagePath;
			const imageInput = panel.croppedImagePath
				? readFileSync(panel.croppedImagePath)
				: imagePath;

			const contextWithOcr: VisionAnalysisContext = {
				...visionContext,
				...(panel.metadata.textContent ? { ocrHint: panel.metadata.textContent } : {}),
			};
			const result = await visionAdapter.analyze(imageInput, contextWithOcr);
			visualDescription = result.visualDescription;
			characters = result.characters;
			characterDetails = result.characterDetails;
			actions = result.actions;
			emotions = result.emotions;
			expressions = result.expressions;
			relevantObjects = result.relevantObjects;
			setting = result.setting;
			readingOrderHint = result.readingOrderHint;
			relationToPrevious = result.relationToPrevious;
			relationToNext = result.relationToNext;
			visionBubbles = result.speechBubbles;
			visionUncertainties = result.uncertainties ?? [];
			visualConfidence = result.confidence;

			if (visualDescription && result.confidence > 0) {
				visualEvidence.push({
					kind: 'visual_observation',
					content: `Visual: ${visualDescription}`,
					confidence: result.confidence,
					sourcePanelId: panel.panelId,
				});
			}
			for (const char of characters) {
				visualEvidence.push({
					kind: 'visual_observation',
					content: `Character detected: ${char}`,
					confidence: result.confidence,
					sourcePanelId: panel.panelId,
				});
			}
			for (const action of actions) {
				if (action.description && action.description !== 'No detectable action') {
					visualEvidence.push({
						kind: 'visual_observation',
						content: `Action: ${action.description}`,
						confidence: result.confidence,
						sourcePanelId: panel.panelId,
					});
				}
			}
			for (const bubble of visionBubbles ?? []) {
				visualEvidence.push({
					kind: 'visual_observation',
					content: `Bubble (${bubble.kind ?? 'dialogue'}${bubble.speaker ? ` · ${bubble.speaker}` : ''}): "${bubble.text}"`,
					confidence: result.confidence,
					sourcePanelId: panel.panelId,
				});
			}
		} catch (err) {
			if (err instanceof AllVisionProvidersUnavailableError) {
				throw err;
			}
			const msg = err instanceof Error ? err.message : String(err);
			visionUncertainties.push(`Falha na análise visual: ${msg}`);
		}
	} else {
		visionUncertainties.push('Análise visual multimodal não executada (nenhum provedor de visão configurado).');
		if (ocrDialogues.length > 0) {
			for (const d of ocrDialogues) {
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

	// Merge VLM speech bubbles with OCR dialogues preserving reading order and uncertainties
	const mergedDialogues = mergeVisionAndOcrDialogues({
		...(visionBubbles ? { visionBubbles } : {}),
		ocrDialogues,
		panelId: panel.panelId,
	});
	const dialogues = mergedDialogues.dialogues;
	const allUncertainties = [...new Set([...ocrUncertainties, ...visionUncertainties, ...mergedDialogues.uncertainties])];

	// 3. Compute overall analysis confidence
	const allEvidence = [...ocrEvidence, ...visualEvidence];
	const hasOcr = ocrEvidence.length > 0;
	const hasVision = visualEvidence.some((e) => e.kind === 'visual_observation') && visualConfidence > 0;

	let analysisConfidence: number;
	if (hasOcr && hasVision) {
		const avgOcr = ocrEvidence.reduce((s, e) => s + e.confidence, 0) / ocrEvidence.length;
		analysisConfidence = (avgOcr + visualConfidence) / 2;
	} else if (hasVision) {
		analysisConfidence = visualConfidence;
	} else if (hasOcr) {
		const avgOcr = ocrEvidence.reduce((s, e) => s + e.confidence, 0) / ocrEvidence.length;
		analysisConfidence = avgOcr * 0.7;
	} else {
		analysisConfidence = 0;
	}

	// 4. Classify action type from available data
	let primaryAction: ActionType = 'none';
	if (actions.length > 0) {
		primaryAction = actions[0]!.type;
	} else if (dialogues.some((d) => d.kind === 'dialogue' || (!d.isNarration && d.kind !== 'sfx'))) {
		primaryAction = 'dialogue';
	} else if (panel.metadata.classification === 'action') {
		primaryAction = 'combat';
	} else if (panel.metadata.classification === 'splash') {
		primaryAction = 'transformation';
	}

	// 5. Build and validate the analysis
	const analysis: PanelAnalysis = panelAnalysisSchema.parse({
		panelId: panel.panelId,
		...(visualDescription ? { visualDescription } : {}),
		characters,
		...(characterDetails && characterDetails.length > 0 ? { characterDetails } : {}),
		dialogues,
		actions: actions.length > 0
			? actions
			: [{ type: primaryAction, description: primaryAction === 'none' ? 'No detectable action' : `Inferred ${primaryAction} from panel classification` }],
		emotions: emotions.length > 0 ? emotions : ['unknown'],
		...(expressions && expressions.length > 0 ? { expressions } : {}),
		...(relevantObjects && relevantObjects.length > 0 ? { relevantObjects } : {}),
		setting,
		...(readingOrderHint ? { readingOrderHint } : {}),
		...(relationToPrevious ? { relationToPrevious } : {}),
		...(relationToNext ? { relationToNext } : {}),
		...(allUncertainties.length > 0 ? { uncertainties: allUncertainties } : {}),
		evidence: allEvidence,
		analysisConfidence,
		analyzedBy,
		analyzedAtIso: new Date().toISOString(),
	});

	return analysis;
}

/**
 * Narrative Analyzer — Phase 2 core component.
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
				const prevAnalysis = idx > 0 ? results[idx - 1] : undefined;
				const knownCharsSet = new Set<string>();
				for (let k = 0; k < idx; k++) {
					for (const c of results[k]?.characters ?? []) knownCharsSet.add(c);
				}
				const visionContext: VisionAnalysisContext = {
					panelIndex: idx,
					totalPanels: orderedPanels.length,
					readingOrder: panel.metadata.readingOrder,
					...(options.workTitle ? { workTitle: options.workTitle } : {}),
					...(prevAnalysis?.visualDescription
						? { previousPanelSummary: prevAnalysis.visualDescription }
						: prevAnalysis?.actions[0]?.description && prevAnalysis.actions[0].description !== 'No detectable action'
							? { previousPanelSummary: prevAnalysis.actions[0].description }
							: {}),
					...(knownCharsSet.size > 0 ? { knownCharacters: [...knownCharsSet] } : {}),
				};
				const analysis = await analyzePanel(panel, options, visionContext);
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
