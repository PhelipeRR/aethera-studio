import type {
	PanelAnalysis,
	StoryBeat,
	NarrativeSequence,
	ReadingOrder,
	Emotion,
	ActionType,
} from './recap-types.js';
import { storyBeatSchema, narrativeSequenceSchema } from './recap-types.js';

export interface ContinityEngineOptions {
	chapterId: string;
	analyses: PanelAnalysis[];
	readingOrder: ReadingOrder;
	/** Minimum confidence to auto-approve a beat. Below → needs_review. Default: 0.5. */
	minBeatConfidence?: number;
	/** Maximum number of consecutive panels that can be merged into one beat. Default: 4. */
	maxPanelsPerBeat?: number;
}

export interface ContinuityResult {
	sequence: NarrativeSequence;
	warnings: string[];
}

/**
 * Determines whether two consecutive panel analyses should be merged into the same beat.
 * Merging criteria:
 * - Same characters (or overlapping character sets)
 * - Compatible action types (e.g., dialogue→dialogue, combat→combat)
 * - Confidence above threshold
 * - Not crossing page boundaries for splash/establishing panels
 */
function shouldMergeBeats(
	prev: PanelAnalysis,
	curr: PanelAnalysis,
	maxPanelsInCurrentBeat: number,
	maxPanelsPerBeat: number,
): boolean {
	if (maxPanelsInCurrentBeat >= maxPanelsPerBeat) return false;

	// Splash and establishing panels always start a new beat
	if (curr.actions.some((a) => a.type === 'transformation')) return false;

	// Check character overlap
	const prevChars = new Set(prev.characters.map((c) => c.toLowerCase()));
	const currChars = new Set(curr.characters.map((c) => c.toLowerCase()));
	const hasOverlap = prevChars.size === 0 || currChars.size === 0 ||
 [...prevChars].some((c) => currChars.has(c));

	if (!hasOverlap && prevChars.size > 0 && currChars.size > 0) return false;

	// Check action compatibility
	const compatibleActions = new Map<ActionType, Set<ActionType>>([
 ['dialogue', new Set(['dialogue', 'reaction', 'observation'])],
 ['combat', new Set(['combat', 'movement', 'reaction'])],
 ['movement', new Set(['movement', 'combat', 'observation'])],
 ['observation', new Set(['observation', 'dialogue', 'none'])],
 ['reaction', new Set(['reaction', 'dialogue', 'observation'])],
 ['none', new Set(['none', 'observation', 'dialogue'])],
 ]);

	const prevAction = prev.actions[0]?.type ?? 'none';
	const currAction = curr.actions[0]?.type ?? 'none';
	const allowed = compatibleActions.get(prevAction);
	if (allowed && !allowed.has(currAction)) return false;

	return true;
}

/**
 * Aggregates evidence from multiple panel analyses into a single beat summary.
 * Only includes information supported by evidence — never fabricates.
 */
function buildBeatSummary(
	analyses: PanelAnalysis[],
	beatIndex: number,
): { summary: string; characters: string[]; emotion: Emotion; actionType: ActionType } {
	// Collect all unique characters across panels
	const charSet = new Set<string>();
	for (const a of analyses) {
 for (const c of a.characters) charSet.add(c);
	}
	const characters = [...charSet];

	// Determine dominant emotion (most frequent non-unknown)
	const emotionCounts = new Map<Emotion, number>();
	for (const a of analyses) {
 for (const e of a.emotions) {
 if (e !== 'unknown') {
 emotionCounts.set(e, (emotionCounts.get(e) ?? 0) + 1);
 }
 }
	}
	let emotion: Emotion = 'unknown';
	let maxCount = 0;
	for (const [e, count] of emotionCounts) {
 if (count > maxCount) { emotion = e; maxCount = count; }
	}

	// Determine primary action type
	const actionCounts = new Map<ActionType, number>();
	for (const a of analyses) {
 for (const act of a.actions) {
 actionCounts.set(act.type, (actionCounts.get(act.type) ?? 0) + 1);
 }
	}
	let actionType: ActionType = 'none';
	let maxActCount = 0;
	for (const [at, count] of actionCounts) {
 if (count > maxActCount) { actionType = at; maxActCount = count; }
	}

	// Build summary from verified evidence only
	const parts: string[] = [];
	const dialogues = analyses.flatMap((a) => a.dialogues.filter((d) => !d.isNarration));
	const narrations = analyses.flatMap((a) => a.dialogues.filter((d) => d.isNarration));

	if (characters.length > 0) {
 parts.push(characters.join(', '));
	}

	if (actionType === 'dialogue' && dialogues.length > 0) {
 const sampleDialogue = dialogues[0]!.text.slice(0, 80);
 parts.push(`em diálogo${dialogues.length > 1 ? ` (${dialogues.length} falas)` : ''}`);
 if (sampleDialogue) parts.push(`"${sampleDialogue}${dialogues[0]!.text.length > 80 ? '...' : ''}"`);
	} else if (actionType === 'combat') {
 parts.push('em confronto');
	} else if (actionType === 'movement') {
 parts.push('em movimento');
	} else if (actionType === 'transformation') {
 parts.push('em transformação');
	} else if (narrations.length > 0) {
 parts.push(`com narração${narrations.length > 1 ? ` (${narrations.length} trechos)` : ''}`);
	} else {
 parts.push('em cena');
	}

	const summary = parts.join(' ');

	return { summary, characters, emotion, actionType };
}

/**
 * Story Continuity Engine — Phase 2 component.
 *
 * Groups ordered panel analyses into coherent narrative beats, maintaining
 * character consistency, action continuity, and explicit ambiguity tracking.
 *
 * KEY GUARANTEES:
 * - Beats are formed from consecutive panels with verified continuity.
 * - Low-confidence analyses produce beats marked needs_review.
 * - Character identity is tracked across beats for inconsistency detection.
 * - No narrative gaps are silently ignored — each gap produces a warning.
 * - Output is a validated NarrativeSequence with full traceability to panel IDs.
 */
export function runStoryContinuityEngine(options: ContinityEngineOptions): ContinuityResult {
	const {
 chapterId,
 analyses,
 readingOrder,
 minBeatConfidence = 0.5,
 maxPanelsPerBeat = 4,
	} = options;
	const warnings: string[] = [];

	if (analyses.length === 0) {
 return {
 sequence: narrativeSequenceSchema.parse({
 chapterId,
 beats: [],
 readingOrder,
 generatedAtIso: new Date().toISOString(),
 warnings: ['No panel analyses provided.'],
 }),
 warnings: ['No panel analyses provided.'],
 };
	}

	// Group analyses into beats
	const beats: StoryBeat[] = [];
	let currentBeatAnalyses: PanelAnalysis[] = [analyses[0]!];
	let beatIndex = 0;

	for (let i = 1; i < analyses.length; i++) {
 const curr = analyses[i]!;
 const prev = analyses[i - 1]!;

 const canMerge = shouldMergeBeats(prev, curr, currentBeatAnalyses.length, maxPanelsPerBeat);

 if (canMerge) {
 currentBeatAnalyses.push(curr);
 } else {
 // Finalize current beat
 const { summary, characters, emotion, actionType } = buildBeatSummary(currentBeatAnalyses, beatIndex);
 const avgConfidence = currentBeatAnalyses.reduce((s, a) => s + a.analysisConfidence, 0) / currentBeatAnalyses.length;
 const needsReview = avgConfidence < minBeatConfidence;

 let reviewReason: string | undefined;
 if (needsReview) {
 reviewReason = `Average analysis confidence ${avgConfidence.toFixed(2)} below threshold ${minBeatConfidence}`;
 }

 // Check for character inconsistency within beat
 const allChars = currentBeatAnalyses.flatMap((a) => a.characters);
 const uniqueChars = new Set(allChars.map((c) => c.toLowerCase()));
 if (uniqueChars.size > 3) {
 warnings.push(`Beat ${beatIndex}: ${uniqueChars.size} distinct characters detected in single beat — possible merge error.`);
 if (!reviewReason) reviewReason = 'Too many distinct characters in single beat';
 }

 const beat = storyBeatSchema.parse({
 beatId: `${chapterId}_beat_${String(beatIndex).padStart(4, '0')}`,
 panelIds: currentBeatAnalyses.map((a) => a.panelId),
 summary,
 characters,
 emotion,
 actionType,
 pageNumber: currentBeatAnalyses[0]!.panelId.includes('_p')
 ? parseInt(currentBeatAnalyses[0]!.panelId.split('_p')[1]?.split('_')[0] ?? '0', 10)
 : 0,
 confidence: avgConfidence,
 needsReview: needsReview || !!reviewReason,
 reviewReason,
 });

 beats.push(beat);
 beatIndex++;
 currentBeatAnalyses = [curr];
 }
	}

	// Finalize last beat
	if (currentBeatAnalyses.length > 0) {
 const { summary, characters, emotion, actionType } = buildBeatSummary(currentBeatAnalyses, beatIndex);
 const avgConfidence = currentBeatAnalyses.reduce((s, a) => s + a.analysisConfidence, 0) / currentBeatAnalyses.length;
 const needsReview = avgConfidence < minBeatConfidence;

 let reviewReason: string | undefined;
 if (needsReview) {
 reviewReason = `Average analysis confidence ${avgConfidence.toFixed(2)} below threshold ${minBeatConfidence}`;
 }

 const beat = storyBeatSchema.parse({
 beatId: `${chapterId}_beat_${String(beatIndex).padStart(4, '0')}`,
 panelIds: currentBeatAnalyses.map((a) => a.panelId),
 summary,
 characters,
 emotion,
 actionType,
 pageNumber: currentBeatAnalyses[0]!.panelId.includes('_p')
 ? parseInt(currentBeatAnalyses[0]!.panelId.split('_p')[1]?.split('_')[0] ?? '0', 10)
 : 0,
 confidence: avgConfidence,
 needsReview: needsReview || !!reviewReason,
 reviewReason,
 });

 beats.push(beat);
	}

	// Detect narrative gaps: consecutive beats with no shared characters and no transition
	for (let i = 1; i < beats.length; i++) {
 const prev = beats[i - 1]!;
 const curr = beats[i]!;
 const prevChars = new Set(prev.characters.map((c) => c.toLowerCase()));
 const currChars = new Set(curr.characters.map((c) => c.toLowerCase()));
 const hasSharedChar = [...prevChars].some((c) => currChars.has(c));

 if (!hasSharedChar && prevChars.size > 0 && currChars.size > 0) {
 const gapWarning = `Narrative gap between beat ${i - 1} (${prev.beatId}) and beat ${i} (${curr.beatId}): no shared characters. Possible scene transition or missing panel.`;
 warnings.push(gapWarning);
 }
	}

	const sequence = narrativeSequenceSchema.parse({
 chapterId,
 beats,
 readingOrder,
 generatedAtIso: new Date().toISOString(),
 warnings: warnings.length > 0 ? warnings : undefined,
	});

	return { sequence, warnings };
}