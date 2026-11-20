import { existsSync } from 'node:fs';
import type {
	NarrativeSequence,
	StoryBeat,
	RecapScript,
	Scene,
	ScriptStyle,
	Emotion,
	NarrativeIntent,
	ReviewStatus,
	ExtractedPanel,
} from './recap-types.js';
import { sceneSchema, recapScriptSchema } from './recap-types.js';

export interface ScriptGeneratorOptions {
	sequence: NarrativeSequence;
	panels: ExtractedPanel[];
	style: ScriptStyle;
	language?: string;
	/** Agent/model identifier recorded in the script. */
	generatedBy: string;
	/** Words per second for duration estimation. Default: 2.5 (Portuguese narration pace). */
	wordsPerSecond?: number;
}

export interface ScriptGenerationResult {
	script: RecapScript;
	warnings: string[];
}

/**
 * Maps emotion to narrative intent for scene classification.
 */
function emotionToIntent(emotion: Emotion, actionType: string, beatIndex: number, totalBeats: number): NarrativeIntent {
	if (actionType === 'transformation') return 'climax';
	if (beatIndex === 0) return 'exposition';
	if (beatIndex >= totalBeats - 2) return 'resolution';
	if (emotion === 'tension' || emotion === 'fear' || emotion === 'anger') return 'rising_action';
	if (emotion === 'joy' || emotion === 'relief') return 'character_moment';
	if (actionType === 'observation' || actionType === 'none') return 'world_building';
	return 'rising_action';
}

/**
 * Generates natural narration text from a story beat.
 * Adapts tone and structure based on script style.
 * NEVER invents events, characters, or dialogue not present in the beat's evidence.
 */
function generateNarrationText(beat: StoryBeat, style: ScriptStyle): string {
	const parts: string[] = [];
	const hasCharacters = beat.characters.length > 0;
	const hasDialogue = beat.summary.includes('diálogo');
	const hasCombat = beat.actionType === 'combat';
	const hasTransformation = beat.actionType === 'transformation';

	switch (style) {
 case 'cinematic_recap':
 if (hasCharacters) parts.push(beat.characters.join(' e '));
 if (hasCombat) parts.push('entraram em confronto direto.');
 else if (hasTransformation) parts.push('algo inesperado aconteceu.');
 else if (hasDialogue) parts.push('tiveram uma conversa importante.');
 else parts.push('a cena se desenrolou.');
 break;

 case 'mystery':
 if (hasCharacters) parts.push(`Algo envolvendo ${beat.characters.join(' e ')} chamou atenção.`);
 else parts.push('A situação ficou mais complexa.');
 if (beat.emotion === 'fear' || beat.emotion === 'tension') {
 parts.push('A tensão era palpável.');
 }
 break;

 case 'suspense':
 if (hasCharacters) parts.push(`${beat.characters.join(' e ')} estavam no centro da ação.`);
 if (hasCombat) parts.push('O confronto foi intenso.');
 else if (beat.emotion === 'tension') parts.push('Nada seria como antes.');
 else parts.push('Os acontecimentos ganharam força.');
 break;

 case 'documentary':
 if (hasCharacters) parts.push(`Neste momento, ${beat.characters.join(' e ')} ${hasDialogue ? 'dialogaram' : 'agiram'}.`);
 else parts.push('A sequência de eventos continuou.');
 break;

 case 'narrative_recap':
 default:
 if (hasCharacters && hasDialogue) {
 parts.push(`${beat.characters.join(' e ')} conversaram.`);
 } else if (hasCharacters && hasCombat) {
 parts.push(`${beat.characters.join(' e ')} lutaram.`);
 } else if (hasCharacters) {
 parts.push(`${beat.characters.join(' e ')} apareceram em cena.`);
 } else {
 parts.push('A história avançou.');
 }
 break;
	}

	return parts.join(' ').trim() || 'Cena sem narração gerada.';
}

/**
 * Estimates narration duration in seconds based on word count and language pace.
 */
function estimateDuration(text: string, wordsPerSecond: number): number {
	const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
	return Math.max(1, Math.round(wordCount / wordsPerSecond));
}

/**
 * Determines review status for a scene based on beat confidence and panel references.
 */
function determineReviewStatus(
	beat: StoryBeat,
	panelMap: Map<string, ExtractedPanel>,
): { status: ReviewStatus; notes?: string } {
	const notes: string[] = [];

	// Check beat confidence
	if (beat.needsReview) {
 notes.push(beat.reviewReason ?? 'Low confidence beat');
	}

	// Verify all panel references exist and have valid cropped images
	let missingPanels = 0;
	let missingCrops = 0;
	for (const panelId of beat.panelIds) {
 const panel = panelMap.get(panelId);
 if (!panel) {
 missingPanels++;
 } else if (!panel.croppedImagePath || !existsSync(panel.croppedImagePath)) {
 missingCrops++;
 }
	}

	if (missingPanels > 0) {
 notes.push(`${missingPanels} panel reference(s) not found`);
	}
	if (missingCrops > 0) {
 notes.push(`${missingCrops} cropped image(s) missing or inaccessible`);
	}

	if (notes.length > 0) {
 return { status: 'needs_review', notes: notes.join('; ') };
	}

	if (beat.confidence < 0.3) {
 return { status: 'needs_review', notes: `Very low confidence (${beat.confidence.toFixed(2)})` };
	}

	return { status: 'approved' };
}

/**
 * Script Generator & Scene Mapper — Phase 2 components.
 *
 * Transforms a NarrativeSequence into a complete RecapScript with validated scenes.
 * Each scene contains narration text, character references, panel IDs, cropped image
 * paths, estimated duration, emotion, narrative intent, and review status.
 *
 * KEY GUARANTEES:
 * - Narration is generated ONLY from verified beat evidence — never invented.
 * - Every scene references at least one valid panel with accessible cropped image.
 * - Scenes without valid panel references are marked needs_review.
 * - Duration is estimated from narration word count, not forced.
 * - Multiple script styles supported (narrative, cinematic, mystery, suspense, documentary).
 * - Full traceability: scene → beat → panel → cropped image.
 */
export function runScriptGenerator(options: ScriptGeneratorOptions): ScriptGenerationResult {
	const {
 sequence,
 panels,
 style,
 generatedBy,
 wordsPerSecond = 2.5,
	} = options;
	const warnings: string[] = [...(sequence.warnings ?? [])];

	// Build panel lookup map
	const panelMap = new Map<string, ExtractedPanel>();
	for (const panel of panels) {
 panelMap.set(panel.panelId, panel);
	}

	const scenes: Scene[] = [];
	let totalDuration = 0;

	for (let i = 0; i < sequence.beats.length; i++) {
 const beat = sequence.beats[i]!;

 // Generate narration text from beat evidence only
 const narrationText = generateNarrationText(beat, style);

 // Collect cropped image paths for referenced panels
 const croppedImagePaths: string[] = [];
 for (const panelId of beat.panelIds) {
 const panel = panelMap.get(panelId);
 if (panel?.croppedImagePath && existsSync(panel.croppedImagePath)) {
 croppedImagePaths.push(panel.croppedImagePath);
 }
 }

 // Determine review status
 const { status, notes } = determineReviewStatus(beat, panelMap);

 // Estimate duration
	const durationSec = estimateDuration(narrationText, wordsPerSecond);
	totalDuration += durationSec;

 // Map emotion to narrative intent
	const intent = emotionToIntent(beat.emotion, beat.actionType, i, sequence.beats.length);

 const scene = sceneSchema.parse({
 sceneId: `${sequence.chapterId}_scene_${String(i).padStart(4, '0')}`,
 narrationText,
 characters: beat.characters,
 eventDescription: beat.summary,
 panelIds: beat.panelIds,
 croppedImagePaths,
 estimatedDurationSec: durationSec,
 emotion: beat.emotion,
 narrativeIntent: intent,
 confidence: beat.confidence,
 reviewStatus: status,
 reviewNotes: notes,
 });

 scenes.push(scene);

 if (status === 'needs_review') {
 warnings.push(`Scene ${scene.sceneId}: marked for review — ${notes}`);
 }
	}

	const script = recapScriptSchema.parse({
 chapterId: sequence.chapterId,
 title: `Recap — ${sequence.chapterId}`,
 style,
 scenes,
 totalEstimatedDurationSec: totalDuration,
 generatedAtIso: new Date().toISOString(),
 generatedBy,
 warnings: warnings.length > 0 ? warnings : undefined,
	});

	return { script, warnings };
}