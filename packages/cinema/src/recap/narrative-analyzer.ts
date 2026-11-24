import { readFileSync } from 'node:fs';
import type {
	ExtractedPanel,
	PanelAnalysis,
	NarrativeEvidence,
	VisionAdapter,
	VisionAnalysisContext,
	VisionAnalysisResult,
	StoryMemoryPromptContext,
	OcrAdapter,
	Emotion,
	ActionType,
	DialogueEntry,
	CharacterDetail,
} from './recap-types.js';
import { panelAnalysisSchema } from './recap-types.js';
import { computePanelCacheKey, computeVisionContextFingerprint, RECAP_ANALYZER_VERSION } from './checkpoint-persistence.js';
import { AllVisionProvidersUnavailableError } from './vision-error-classifier.js';
import { isRecapJobInterruptedError } from './phase5/recap-production-job-manager.js';
import { RecapBudgetExceededError } from './phase5/recap-usage-telemetry.js';
import { extractStructuredOcrDialogues, mergeVisionAndOcrDialogues } from './dialogue-extractor.js';
import { createNarrativeMemory, updateNarrativeMemory } from './compact-narrative-context.js';
import { triageRecapPanels, type RecapPanelTriageDecision } from './panel-triage.js';
import { buildRecapMotionMetadata } from './recap-text-classification.js';

export interface NarrativeAnalyzerOptions {
	panels: ExtractedPanel[];
	visionAdapter?: VisionAdapter | undefined;
	visionRoutes?: Partial<Record<import('./recap-types.js').RecapPanelRouteTier, VisionAdapter>> | undefined;
	triage?: import('./recap-types.js').RecapPanelTriageOptions | undefined;
	compactNarrativeContext?: boolean | undefined;
	ocrAdapter?: OcrAdapter | undefined;
	/** Agent/model identifier recorded in each analysis. */
	analyzedBy: string;
	/** Optional work title for contextual grounding in visual analysis. */
	workTitle?: string | undefined;
	/** Optional known character names/descriptors loaded from Story Memory (prior chapters only). */
	initialKnownCharacters?: readonly string[] | undefined;
	/** Optional structured Story Memory context (strictly chapters < currentChapterNumber). */
	storyMemoryContext?: StoryMemoryPromptContext | undefined;
	/** Minimum confidence to consider an analysis reliable. Default: 0.5. */
	minConfidence?: number | undefined;
	/** Bounded concurrency for fresh vision calls (clamped 1..4). Default: 1. */
	concurrency?: number | undefined;
	/** Previously completed panel analyses from checkpoint (keyed by panelId). */
	cachedAnalyses?: readonly PanelAnalysis[] | undefined;
	/** Previously completed panel analyses keyed by imageHash. */
	analysisCacheByHash?: Readonly<Record<string, PanelAnalysis>> | undefined;
	/** Image hashes belonging to cached panel ids; protects legacy id-based reuse. */
	cachedAnalysisImageHashes?: Readonly<Record<string, string>> | undefined;
	/** Explicitly allow scene/script regeneration to reuse a prior panel-id analysis when context is intentionally narrowed. */
	allowLegacyPanelIdCache?: boolean | undefined;
	/** Model identifier bound into the cache key. Defaults to analyzedBy. */
	cacheModel?: string | undefined;
	/** Analyzer version bound into the cache key. Defaults to RECAP_ANALYZER_VERSION. */
	analyzerVersion?: string | undefined;
	promptVersion?: string | undefined;
	preprocessingVersion?: string | undefined;
	cacheSchemaVersion?: string | undefined;
	locale?: string | undefined;
	/** Optional callback invoked after each valid fresh panel analysis for incremental checkpointing. */
	onPanelAnalyzed?: ((analysis: PanelAnalysis, panel: ExtractedPanel, cacheKey: string) => void) | undefined;
	onAnalysisEvent?: ((event: { panel: ExtractedPanel; cacheKey: string; cacheStatus: 'hit' | 'miss' | 'invalidated' | 'deduped' }) => void) | undefined;
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
 * Coalesces concurrent panel requests only when the provider explicitly exposes
 * a batch contract and image limit. A malformed/failed batch falls back to the
 * provider's single-image method so no result is fabricated or discarded.
 */
function withExplicitBatchSupport(adapter: VisionAdapter | undefined): VisionAdapter | undefined {
	if (!adapter?.analyzeBatch || !adapter.maxImagesPerCall || adapter.maxImagesPerCall < 2) return adapter;
	const maxImages = Math.max(2, Math.floor(adapter.maxImagesPerCall));
	type Pending = {
		imagePathOrBuffer: string | Buffer;
		context?: VisionAnalysisContext;
		resolve: (result: VisionAnalysisResult) => void;
		reject: (error: unknown) => void;
	};
	const queue: Pending[] = [];
	let scheduled = false;
	const analyzeBatch = adapter.analyzeBatch;

	const flush = async (): Promise<void> => {
		scheduled = false;
		while (queue.length > 0) {
			const batch = queue.splice(0, maxImages);
			if (batch.length === 1) {
				try {
					batch[0]!.resolve(await adapter.analyze(batch[0]!.imagePathOrBuffer, batch[0]!.context));
				} catch (error) {
					batch[0]!.reject(error);
				}
				continue;
			}
			try {
				const results = await analyzeBatch!(
					batch.map((item) => ({ imagePathOrBuffer: item.imagePathOrBuffer, ...(item.context ? { context: item.context } : {}) })),
				);
				if (results.length !== batch.length) throw new Error(`Batch provider returned ${results.length} results for ${batch.length} inputs.`);
				batch.forEach((item, index) => item.resolve(results[index]!));
			} catch (batchError) {
				// A provider batch failure is recoverable without inventing a result.
				await Promise.all(batch.map(async (item) => {
					try {
						item.resolve(await adapter.analyze(item.imagePathOrBuffer, item.context));
					} catch (error) {
						item.reject(error instanceof Error ? error : batchError);
					}
				}));
			}
		}
	};

	return {
		name: adapter.name,
		maxImagesPerCall: maxImages,
		analyze(imagePathOrBuffer, context) {
			return new Promise<VisionAnalysisResult>((resolve, reject) => {
				queue.push({ imagePathOrBuffer, ...(context ? { context } : {}), resolve, reject });
				if (!scheduled) {
					scheduled = true;
					queueMicrotask(() => { void flush(); });
				}
			});
		},
	};
}

/**
 * Analyzes a single panel using available adapters (vision + OCR).
 * Never fabricates information — returns low confidence when data is insufficient.
 */
async function analyzePanel(
	panel: ExtractedPanel,
	options: NarrativeAnalyzerOptions,
	visionContext?: VisionAnalysisContext,
	visionAdapterOverride?: VisionAdapter,
): Promise<PanelAnalysis> {
	const { analyzedBy } = options;
	const visionAdapter = visionAdapterOverride ?? options.visionAdapter;

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
			if (
				err instanceof AllVisionProvidersUnavailableError ||
				isRecapJobInterruptedError(err) ||
				err instanceof RecapBudgetExceededError
			) {
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
		motionMetadata: buildRecapMotionMetadata({
			actions,
			...(expressions ? { expressions } : {}),
			dialogues,
			...(visualDescription ? { visualDescription } : {}),
		}),
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
		cachedAnalysisImageHashes,
		cacheModel = options.analyzedBy,
		analyzerVersion = RECAP_ANALYZER_VERSION,
		promptVersion = 'recap-v1',
		preprocessingVersion = 'recap-preprocess-v1',
		cacheSchemaVersion = 'recap-vision-v1',
		locale = 'pt-BR',
		onPanelAnalyzed,
		onAnalysisEvent,
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
	const triage = triageRecapPanels({ panels: orderedPanels, ...(cachedAnalyses ? { cachedAnalyses } : {}), ...(options.triage ? { options: options.triage } : {}) });
	const triageByPanelId = new Map<string, RecapPanelTriageDecision>(triage.decisions.map((decision) => [decision.panelId, decision]));
	const compactContext = options.compactNarrativeContext !== false;
	const initialMemoryCharacters = [
		...(options.initialKnownCharacters ?? []),
		...(options.storyMemoryContext?.characters ?? []).map((character) => character.displayName),
	];
	let narrativeMemory = createNarrativeMemory(initialMemoryCharacters);
	const baseAdapter = withExplicitBatchSupport(options.visionAdapter);
	const preparedRoutes: Partial<Record<import('./recap-types.js').RecapPanelRouteTier, VisionAdapter>> = {};
	for (const tier of ['local', 'economic', 'premium'] as const) {
		const route = options.visionRoutes?.[tier];
		if (route) preparedRoutes[tier] = withExplicitBatchSupport(route)!;
	}
	const routeForDecision = (decision: RecapPanelTriageDecision): VisionAdapter | undefined => {
		if (options.triage?.enabled === false) return baseAdapter;
		const preferred = decision.routeTier;
		const fallbackOrder = options.triage?.fallbackOrder ?? [preferred, 'economic', 'premium', 'local'];
		for (const tier of [preferred, ...fallbackOrder]) {
			const route = preparedRoutes[tier];
			if (route) return route;
		}
		return baseAdapter;
	};
	const results: Array<PanelAnalysis | undefined> = new Array(orderedPanels.length);
	const sameRunByImageHash = new Map<string, PanelAnalysis>();
	const panelWarnings: string[][] = orderedPanels.map(() => []);
	let cacheHits = 0;
	let analyzedFresh = 0;
	let fatalProviderError: AllVisionProvidersUnavailableError | null = null;
	// A pause/cancel requested at a panel boundary stops every worker and propagates unchanged.
	let interruption: Error | null = null;

	// Compact memory is ordered by construction. Keep it sequential unless the
	// caller explicitly opts out; explicit batch providers may still coalesce
	// requests when concurrency > 1 and compact context is disabled.
	const maxWorkers = compactContext ? 1 : Math.max(1, Math.min(4, Math.floor(concurrency)));
	let nextIndex = 0;

	const worker = async () => {
		while (true) {
			if (fatalProviderError || interruption) break;
			const idx = nextIndex++;
			if (idx >= orderedPanels.length) break;
			const panel = orderedPanels[idx]!;
			const prevAnalysis = idx > 0 ? results[idx - 1] : undefined;
			const decision = triageByPanelId.get(panel.panelId) ?? {
				panelId: panel.panelId,
				ordinal: idx,
				categories: ['ambiguous'] as const,
				routeTier: 'premium' as const,
				preserve: true as const,
				reasons: ['triagem indisponível'],
			};
			const selectedAdapter = routeForDecision(decision);
			const knownCharsSet = compactContext
				? new Set(narrativeMemory.characters)
				: new Set<string>(options.initialKnownCharacters ?? []);
			if (!compactContext) {
				for (let k = 0; k < idx; k++) {
					for (const c of results[k]?.characters ?? []) knownCharsSet.add(c);
				}
			}
			const visionContext: VisionAnalysisContext = {
				panelIndex: idx,
				totalPanels: orderedPanels.length,
				readingOrder: panel.metadata.readingOrder,
				...(options.workTitle ? { workTitle: options.workTitle } : {}),
				...(options.storyMemoryContext ? { storyMemoryContext: options.storyMemoryContext } : {}),
				...(compactContext ? { narrativeMemory } : {}),
				...(prevAnalysis?.visualDescription
					? { previousPanelSummary: prevAnalysis.visualDescription }
					: prevAnalysis?.actions[0]?.description && prevAnalysis.actions[0].description !== 'No detectable action'
						? { previousPanelSummary: prevAnalysis.actions[0].description }
						: {}),
				...(knownCharsSet.size > 0 ? { knownCharacters: [...knownCharsSet] } : {}),
			};
			const contextWithOcr: VisionAnalysisContext = {
				...visionContext,
				...(panel.metadata.textContent ? { ocrHint: panel.metadata.textContent } : {}),
			};
			const makeCompositeKey = (model: string) => computePanelCacheKey({
				imageHash: panel.imageHash,
				cropCoordinates: JSON.stringify(panel.metadata.boundingBox),
				model,
				analyzerVersion,
				promptVersion,
				preprocessingVersion,
				schemaVersion: cacheSchemaVersion,
				locale,
				contextFingerprint: computeVisionContextFingerprint(contextWithOcr),
			});
			let compositeKey = makeCompositeKey(selectedAdapter?.name ?? cacheModel);
			const analysisContext: VisionAnalysisContext = { ...contextWithOcr };
			// Keep correlation metadata out of JSON/spread-based provider prompts.
			Object.defineProperty(analysisContext, 'cacheKey', { value: compositeKey, enumerable: false });
			// Route metadata is consumed by the adapter/router but deliberately excluded
			// from prompt text and cache fingerprints so valid Phase 1/2 analyses remain reusable.
			Object.defineProperty(analysisContext, 'routeTier', { value: decision.routeTier, enumerable: false });
			Object.defineProperty(analysisContext, 'routeReason', { value: decision.reasons.join('; '), enumerable: false });

			const legacyPanelCache = cacheByPanelId.get(panel.panelId);
			const legacyPanelHashMatches = cachedAnalysisImageHashes?.[panel.panelId] === panel.imageHash;
			const hasHashIndex = Boolean(cachedAnalysisImageHashes && Object.keys(cachedAnalysisImageHashes).length > 0);
			const explicitCacheVersionChange = cacheModel !== options.analyzedBy || analyzerVersion !== RECAP_ANALYZER_VERSION || promptVersion !== 'recap-v1' || preprocessingVersion !== 'recap-preprocess-v1' || cacheSchemaVersion !== 'recap-vision-v1' || locale !== 'pt-BR';
			const legacyReuseAllowed = options.allowLegacyPanelIdCache || (!hasHashIndex && !explicitCacheVersionChange);
			const cached = cacheByKey.get(compositeKey) ?? (legacyPanelCache && legacyReuseAllowed && (legacyPanelHashMatches || !hasHashIndex) ? legacyPanelCache : undefined);
			Object.defineProperty(analysisContext, 'cacheStatus', { value: legacyPanelCache && !cacheByKey.has(compositeKey) ? 'invalidated' : 'miss', enumerable: false });
			if (cached) {
				const reused: PanelAnalysis = cached.panelId === panel.panelId
					? cached
					: {
						...cached,
						panelId: panel.panelId,
						evidence: cached.evidence.map((e) => ({ ...e, sourcePanelId: panel.panelId })),
					};
				results[idx] = reused;
				if (panel.imageHash) sameRunByImageHash.set(panel.imageHash, reused);
				if (compactContext) narrativeMemory = updateNarrativeMemory(narrativeMemory, reused);
				cacheHits++;
				// Materialize the contextual key even when the source was a legacy panel-id cache.
				onPanelAnalyzed?.(reused, panel, compositeKey);
				onAnalysisEvent?.({ panel, cacheKey: compositeKey, cacheStatus: 'hit' });
				if (reused.analysisConfidence < minConfidence) {
					panelWarnings[idx]!.push(
						`Panel ${panel.panelId}: analysis confidence ${reused.analysisConfidence.toFixed(2)} below threshold ${minConfidence}. Marked for review.`,
					);
				}
				continue;
			}

			// Exact content duplicates are safe to reuse within the same ordered run.
			// This preserves every panel reference while avoiding a second vision call;
			// perceptual similarity is intentionally not used here.
			const sameRunCandidate = options.triage?.enabled !== false && panel.imageHash && decision.categories.includes('redundant')
				? sameRunByImageHash.get(panel.imageHash)
				: undefined;
			const sameRunDuplicate = sameRunCandidate && !sameRunCandidate.relationToPrevious && !sameRunCandidate.relationToNext
				? sameRunCandidate
				: undefined;
			if (sameRunDuplicate) {
				const reused: PanelAnalysis = {
					...sameRunDuplicate,
					panelId: panel.panelId,
					evidence: sameRunDuplicate.evidence.map((evidence) => ({ ...evidence, sourcePanelId: panel.panelId })),
				};
				results[idx] = reused;
				if (compactContext) narrativeMemory = updateNarrativeMemory(narrativeMemory, reused);
				cacheHits++;
				onPanelAnalyzed?.(reused, panel, compositeKey);
				onAnalysisEvent?.({ panel, cacheKey: compositeKey, cacheStatus: 'deduped' });
				continue;
			}

			try {
				let analysis = await analyzePanel(panel, options, analysisContext, selectedAdapter);
				const premiumAdapter = preparedRoutes.premium;
				const shouldEscalate =
					Boolean(options.triage?.fallbackOnLowConfidence ?? true) &&
					Boolean(premiumAdapter && selectedAdapter && premiumAdapter !== selectedAdapter) &&
					analysis.analysisConfidence < (options.triage?.minConfidence ?? minConfidence);
				if (shouldEscalate) {
					const escalated = await analyzePanel(panel, options, analysisContext, premiumAdapter);
					if (escalated.analysisConfidence >= analysis.analysisConfidence) {
						analysis = escalated;
						compositeKey = makeCompositeKey(premiumAdapter!.name);
					}
				}
				results[idx] = analysis;
				if (panel.imageHash && analysis.analysisConfidence > 0) sameRunByImageHash.set(panel.imageHash, analysis);
				if (compactContext) narrativeMemory = updateNarrativeMemory(narrativeMemory, analysis);
				analyzedFresh++;
				if (analysis.analysisConfidence > 0) {
					cacheByKey.set(compositeKey, analysis);
					onPanelAnalyzed?.(analysis, panel, compositeKey);
					onAnalysisEvent?.({ panel, cacheKey: compositeKey, cacheStatus: 'miss' });
				}
				if (analysis.analysisConfidence < minConfidence) {
					panelWarnings[idx]!.push(
						`Panel ${panel.panelId}: analysis confidence ${analysis.analysisConfidence.toFixed(2)} below threshold ${minConfidence}. Marked for review.`,
					);
				}
			} catch (err) {
			if (isRecapJobInterruptedError(err) || err instanceof RecapBudgetExceededError) {
					if (!interruption) interruption = err;
					break;
				}
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

	if (interruption) {
		throw interruption;
	}
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
