import type {
	PanelAnalysis,
	StoryBeat,
	NarrativeSequence,
	ReadingOrder,
	Emotion,
	ActionType,
	DialogueEntry,
	StoryContinuityState,
	ContinuityCharacter,
	ContinuityRelationship,
} from './recap-types.js';
import { storyBeatSchema, narrativeSequenceSchema, storyContinuityStateSchema } from './recap-types.js';

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

const NON_OBSERVABLE_ACTION_PATTERNS: readonly RegExp[] = [
	/^no detectable action$/i,
	/^inferred .+ from panel classification$/i,
	/^visual analysis unavailable$/i,
	/^analysis failed:/i,
];

function isObservableDescription(text: string | undefined): text is string {
	if (!text) return false;
	const trimmed = text.trim();
	if (trimmed.length < 4) return false;
	return !NON_OBSERVABLE_ACTION_PATTERNS.some((re) => re.test(trimmed));
}

function dedupeStrings(items: readonly string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of items) {
		const trimmed = raw.trim();
		if (!trimmed) continue;
		const key = trimmed.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(trimmed);
	}
	return out;
}

/**
 * Determines whether two consecutive panel analyses should be merged into the same beat.
 */
function shouldMergeBeats(
	prev: PanelAnalysis,
	curr: PanelAnalysis,
	maxPanelsInCurrentBeat: number,
	maxPanelsPerBeat: number,
): boolean {
	if (maxPanelsInCurrentBeat >= maxPanelsPerBeat) return false;

	// Splash / transformation panels start a new narrative beat
	if (curr.actions.some((a) => a.type === 'transformation')) return false;

	// Distinct explicit settings indicate a scene change
	if (
		prev.setting &&
		curr.setting &&
		prev.setting.trim().toLowerCase() !== curr.setting.trim().toLowerCase() &&
		!prev.setting.toLowerCase().includes(curr.setting.toLowerCase()) &&
		!curr.setting.toLowerCase().includes(prev.setting.toLowerCase())
	) {
		return false;
	}

	// Check character overlap
	const prevChars = new Set(prev.characters.map((c) => c.toLowerCase()));
	const currChars = new Set(curr.characters.map((c) => c.toLowerCase()));
	const hasOverlap =
		prevChars.size === 0 ||
		currChars.size === 0 ||
		[...prevChars].some((c) => currChars.has(c));

	if (!hasOverlap && prevChars.size > 0 && currChars.size > 0) return false;

	// Check action compatibility
	const compatibleActions = new Map<ActionType, Set<ActionType>>([
		['dialogue', new Set(['dialogue', 'reaction', 'observation'])],
		['combat', new Set(['combat', 'movement', 'reaction'])],
		['movement', new Set(['movement', 'combat', 'observation'])],
		['observation', new Set(['observation', 'dialogue', 'none'])],
		['reaction', new Set(['reaction', 'dialogue', 'observation'])],
		['interaction', new Set(['interaction', 'dialogue', 'reaction', 'observation'])],
		['none', new Set(['none', 'observation', 'dialogue'])],
	]);

	const prevAction = prev.actions[0]?.type ?? 'none';
	const currAction = curr.actions[0]?.type ?? 'none';
	const allowed = compatibleActions.get(prevAction);
	if (allowed && !allowed.has(currAction)) return false;

	return true;
}

/**
 * Aggregates rich visual and textual evidence from a beat's panels.
 */
function buildBeatEvidence(
	analyses: PanelAnalysis[],
	inheritedLocation?: string,
): {
	summary: string;
	visualSummary?: string;
	setting?: string;
	dialogues: DialogueEntry[];
	relevantObjects: string[];
	expressions: string[];
	uncertainties: string[];
	characters: string[];
	emotion: Emotion;
	actionType: ActionType;
} {
	const characters = dedupeStrings(analyses.flatMap((a) => a.characters));

	// Dominant non-unknown emotion
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
		if (count > maxCount) {
			emotion = e;
			maxCount = count;
		}
	}

	// Primary action type
	const actionCounts = new Map<ActionType, number>();
	for (const a of analyses) {
		for (const act of a.actions) {
			actionCounts.set(act.type, (actionCounts.get(act.type) ?? 0) + 1);
		}
	}
	let actionType: ActionType = 'none';
	let maxActCount = 0;
	for (const [at, count] of actionCounts) {
		if (count > maxActCount) {
			actionType = at;
			maxActCount = count;
		}
	}

	const visualFragments = dedupeStrings([
		...analyses.map((a) => a.visualDescription).filter(isObservableDescription),
		...analyses.flatMap((a) => a.actions.map((act) => act.description)).filter(isObservableDescription),
	]);
	const visualSummary = visualFragments.length > 0 ? visualFragments.join(' ') : undefined;

	const settings = dedupeStrings(analyses.map((a) => a.setting ?? '').filter(Boolean));
	const setting = settings[0] ?? inheritedLocation;

	const dialogues: DialogueEntry[] = [];
	for (const a of analyses) {
		for (const d of a.dialogues) {
			if (d.text.trim().length > 0) {
				dialogues.push(d);
			}
		}
	}

	const relevantObjects = dedupeStrings(analyses.flatMap((a) => a.relevantObjects ?? []));
	const expressions = dedupeStrings([
		...analyses.flatMap((a) => a.expressions ?? []),
		...analyses.flatMap((a) => (a.characterDetails ?? []).map((cd) => cd.expression ?? '')),
	]);
	const uncertainties = dedupeStrings([
		...analyses.flatMap((a) => a.uncertainties ?? []),
		...dialogues.map((d) => d.uncertainty ?? ''),
	]);

	// Build concrete summary grounded in visual description and dialogues
	const summaryParts: string[] = [];
	if (visualSummary) {
		summaryParts.push(visualSummary);
	} else {
		if (characters.length > 0) summaryParts.push(characters.join(', '));
		const speechDialogues = dialogues.filter((d) => d.kind !== 'narration' && d.kind !== 'sfx' && !d.isNarration);
		const narrations = dialogues.filter((d) => d.kind === 'narration' || d.isNarration);
		if (speechDialogues.length > 0) {
			const sample = speechDialogues[0]!.text.slice(0, 90);
			summaryParts.push(`em diálogo${speechDialogues.length > 1 ? ` (${speechDialogues.length} falas)` : ''}: "${sample}${speechDialogues[0]!.text.length > 90 ? '...' : ''}"`);
		} else if (narrations.length > 0) {
			const sample = narrations[0]!.text.slice(0, 90);
			summaryParts.push(`com narração: "${sample}${narrations[0]!.text.length > 90 ? '...' : ''}"`);
		} else if (actionType === 'combat') {
			summaryParts.push('em confronto');
		} else if (actionType === 'movement') {
			summaryParts.push('em movimento');
		} else if (actionType === 'transformation') {
			summaryParts.push('em transformação');
		} else {
			summaryParts.push('sem descrição visual ou textual suficiente');
		}
	}

	const summary = summaryParts.join(' ').trim();

	return {
		summary,
		...(visualSummary ? { visualSummary } : {}),
		...(setting ? { setting } : {}),
		dialogues,
		relevantObjects,
		expressions,
		uncertainties,
		characters,
		emotion,
		actionType,
	};
}

function updateContinuityState(
	state: StoryContinuityState,
	beatPanels: PanelAnalysis[],
	beatInfo: ReturnType<typeof buildBeatEvidence>,
): void {
	const firstPanelId = beatPanels[0]!.panelId;
	const lastPanelId = beatPanels[beatPanels.length - 1]!.panelId;

	// Track characters consistently across panels
	for (const charName of beatInfo.characters) {
		const lower = charName.toLowerCase();
		const existing = state.characters.find(
			(c) => c.name.toLowerCase() === lower || c.aliases.some((a) => a.toLowerCase() === lower),
		);
		const detail = beatPanels
			.flatMap((p) => p.characterDetails ?? [])
			.find((cd) => cd.id.toLowerCase() === lower);
		const latestStatus = detail?.expression ?? detail?.poseOrAction;
		if (existing) {
			existing.lastSeenPanelId = lastPanelId;
			if (latestStatus) existing.status = latestStatus;
		} else {
			const newChar: ContinuityCharacter = {
				name: charName,
				aliases: [],
				firstSeenPanelId: firstPanelId,
				lastSeenPanelId: lastPanelId,
				...(latestStatus ? { status: latestStatus } : {}),
			};
			state.characters.push(newChar);
		}
	}

	// Track observed relationships between co-occurring characters
	if (beatInfo.characters.length >= 2) {
		const primary = beatInfo.characters[0]!;
		const secondary = beatInfo.characters[1]!;
		const relLabel =
			beatInfo.actionType === 'combat'
				? 'confronto'
				: beatInfo.dialogues.length > 0
					? 'interação em diálogo'
					: 'presentes na mesma cena';
		const alreadyRecorded = state.relationships.some(
			(r) =>
				((r.from.toLowerCase() === primary.toLowerCase() && r.to.toLowerCase() === secondary.toLowerCase()) ||
					(r.from.toLowerCase() === secondary.toLowerCase() && r.to.toLowerCase() === primary.toLowerCase())) &&
				r.relation === relLabel,
		);
		if (!alreadyRecorded) {
			const rel: ContinuityRelationship = {
				from: primary,
				to: secondary,
				relation: relLabel,
				evidencePanelId: firstPanelId,
			};
			state.relationships.push(rel);
		}
	}

	// Update current location
	if (beatInfo.setting) {
		state.currentLocation = beatInfo.setting;
	}

	// Track concrete events
	if (beatInfo.visualSummary) {
		state.previousEvents.push(beatInfo.visualSummary.slice(0, 180));
	}

	// Track ongoing conflict
	if (beatInfo.actionType === 'combat' || beatInfo.emotion === 'tension' || beatInfo.emotion === 'anger' || beatInfo.emotion === 'fear') {
		state.ongoingConflict = beatInfo.summary.slice(0, 180);
	}

	// Track revealed facts (narration boxes & declarative statements) and open questions
	for (const d of beatInfo.dialogues) {
		const text = d.text.trim();
		if (!text) continue;
		if (text.includes('?')) {
			if (!state.openQuestions.includes(text)) {
				state.openQuestions.push(text);
			}
		} else if (d.kind === 'narration' || d.isNarration) {
			if (!state.revealedFacts.includes(text)) {
				state.revealedFacts.push(text);
			}
		}
	}
}

/**
 * Story Continuity Engine — Phase 2/4 component.
 *
 * Processes the complete sequence of panels maintaining chapter-wide continuity state
 * (characters, relationships, location, prior events, ongoing conflict, revealed facts,
 * open questions) and links every beat to both its prior context and next-beat transition.
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

	const continuityState: StoryContinuityState = {
		characters: [],
		relationships: [],
		previousEvents: [],
		revealedFacts: [],
		openQuestions: [],
	};

	if (analyses.length === 0) {
		return {
			sequence: narrativeSequenceSchema.parse({
				chapterId,
				beats: [],
				readingOrder,
				continuityState: storyContinuityStateSchema.parse(continuityState),
				generatedAtIso: new Date().toISOString(),
				warnings: ['No panel analyses provided.'],
			}),
			warnings: ['No panel analyses provided.'],
		};
	}

	// Group analyses into coherent beats
	const beatGroups: PanelAnalysis[][] = [];
	let currentGroup: PanelAnalysis[] = [analyses[0]!];

	for (let i = 1; i < analyses.length; i++) {
		const curr = analyses[i]!;
		const prev = analyses[i - 1]!;
		if (shouldMergeBeats(prev, curr, currentGroup.length, maxPanelsPerBeat)) {
			currentGroup.push(curr);
		} else {
			beatGroups.push(currentGroup);
			currentGroup = [curr];
		}
	}
	if (currentGroup.length > 0) {
		beatGroups.push(currentGroup);
	}

	// First pass: build beats & update chapter-wide continuity state
	const rawBeats: Array<{
		beatId: string;
		panelIds: string[];
		info: ReturnType<typeof buildBeatEvidence>;
		pageNumber: number;
		confidence: number;
		needsReview: boolean;
		reviewReason?: string;
		previousContext?: string;
	}> = [];

	for (let beatIndex = 0; beatIndex < beatGroups.length; beatIndex++) {
		const group = beatGroups[beatIndex]!;
		const previousEvent = continuityState.previousEvents[continuityState.previousEvents.length - 1];
		const info = buildBeatEvidence(group, continuityState.currentLocation);

		const avgConfidence = group.reduce((s, a) => s + a.analysisConfidence, 0) / group.length;
		const needsReview = avgConfidence < minBeatConfidence;
		let reviewReason: string | undefined;
		if (needsReview) {
			reviewReason = `Confiança média da análise (${avgConfidence.toFixed(2)}) abaixo do limiar (${minBeatConfidence}).`;
		}

		const uniqueChars = new Set(group.flatMap((a) => a.characters.map((c) => c.toLowerCase())));
		if (uniqueChars.size > 4) {
			warnings.push(`Beat ${beatIndex}: ${uniqueChars.size} distinct characters detected in single beat — possible merge error.`);
			if (!reviewReason) reviewReason = 'Muitos personagens distintos em um único beat.';
		}

		if (info.uncertainties.length > 0 && !reviewReason && avgConfidence < 0.7) {
			reviewReason = info.uncertainties[0];
		}

		const explicitPrevRelation = group.map((a) => a.relationToPrevious).find((r) => r && r.trim().length > 0);
		const previousContext = explicitPrevRelation ?? previousEvent;

		updateContinuityState(continuityState, group, info);

		rawBeats.push({
			beatId: `${chapterId}_beat_${String(beatIndex).padStart(4, '0')}`,
			panelIds: group.map((a) => a.panelId),
			info,
			pageNumber: group[0]!.panelId.includes('_p')
				? parseInt(group[0]!.panelId.split('_p')[1]?.split('_')[0] ?? '0', 10)
				: 0,
			confidence: avgConfidence,
			needsReview: needsReview || !!reviewReason,
			...(reviewReason ? { reviewReason } : {}),
			...(previousContext ? { previousContext } : {}),
		});
	}

	// Second pass: attach nextContext (consequence / transition into the following beat)
	const beats: StoryBeat[] = rawBeats.map((raw, idx) => {
		const nextRaw = rawBeats[idx + 1];
		const explicitNextRelation = beatGroups[idx]!
			.map((a) => a.relationToNext)
			.find((r) => r && r.trim().length > 0);
		const nextContext = explicitNextRelation ?? nextRaw?.info.visualSummary ?? nextRaw?.info.summary;

		return storyBeatSchema.parse({
			beatId: raw.beatId,
			panelIds: raw.panelIds,
			summary: raw.info.summary,
			...(raw.info.visualSummary ? { visualSummary: raw.info.visualSummary } : {}),
			...(raw.info.setting ? { setting: raw.info.setting } : {}),
			...(raw.info.dialogues.length > 0 ? { dialogues: raw.info.dialogues } : {}),
			...(raw.info.relevantObjects.length > 0 ? { relevantObjects: raw.info.relevantObjects } : {}),
			...(raw.info.expressions.length > 0 ? { expressions: raw.info.expressions } : {}),
			...(raw.info.uncertainties.length > 0 ? { uncertainties: raw.info.uncertainties } : {}),
			...(raw.previousContext ? { previousContext: raw.previousContext } : {}),
			...(nextContext ? { nextContext } : {}),
			characters: raw.info.characters,
			emotion: raw.info.emotion,
			actionType: raw.info.actionType,
			pageNumber: raw.pageNumber,
			confidence: raw.confidence,
			needsReview: raw.needsReview,
			...(raw.reviewReason ? { reviewReason: raw.reviewReason } : {}),
		});
	});

	// Detect narrative gaps between consecutive beats
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
		continuityState: storyContinuityStateSchema.parse(continuityState),
		generatedAtIso: new Date().toISOString(),
		warnings: warnings.length > 0 ? warnings : undefined,
	});

	return { sequence, warnings };
}
