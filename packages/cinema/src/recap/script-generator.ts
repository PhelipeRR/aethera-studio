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
	DialogueEntry,
	TextEnhancementPort,
} from './recap-types.js';
import { sceneSchema, recapScriptSchema } from './recap-types.js';

export interface ScriptGeneratorOptions {
	sequence: NarrativeSequence;
	panels: ExtractedPanel[];
	style: ScriptStyle;
	language?: string;
	/** Humor level configured in UI (0..100). Never distorts narrative fidelity. */
	humorVolume?: number;
	/** Agent/model identifier recorded in the script. */
	generatedBy: string;
	/** Words per second for duration estimation. Default: 2.4 (natural PT-BR narration pace). */
	wordsPerSecond?: number;
}

export interface ScriptGenerationResult {
	script: RecapScript;
	warnings: string[];
}

export const GENERIC_NARRATION_PATTERNS: readonly RegExp[] = [
	/^a hist[óo]ria avan[çc]ou\.?$/i,
	/^a cena se desenrolou\.?$/i,
	/^a sequ[êe]ncia de eventos continuou\.?$/i,
	/^a situa[çc][ãa]o ficou mais complexa\.?$/i,
	/^os acontecimentos ganharam for[çc]a\.?$/i,
	/^cena sem narra[çc][ãa]o gerada\.?$/i,
	/^algo inesperado aconteceu\.?$/i,
	/^nada seria como antes\.?$/i,
	/^[\p{L}\s,]+ (apareceram em cena|conversaram|lutaram)\.?$/iu,
];

export const REVIEW_REQUIRED_PREFIX = '[REVISÃO NECESSÁRIA]';

/**
 * Returns true if the narration is an empty/generic placeholder phrase
 * that lacks concrete narrative content grounded in the panels.
 */
export function isGenericNarration(text: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return true;
	if (trimmed.startsWith(REVIEW_REQUIRED_PREFIX)) return false;
	return GENERIC_NARRATION_PATTERNS.some((re) => re.test(trimmed));
}

export function isReviewRequiredPlaceholder(text: string): boolean {
	return text.trim().startsWith(REVIEW_REQUIRED_PREFIX);
}

/**
 * Maps emotion and action to narrative intent for scene classification.
 */
function emotionToIntent(emotion: Emotion, actionType: string, beatIndex: number, totalBeats: number): NarrativeIntent {
	if (actionType === 'transformation') return 'climax';
	if (beatIndex === 0) return 'exposition';
	if (beatIndex >= totalBeats - 1 && totalBeats > 2) return 'resolution';
	if (emotion === 'tension' || emotion === 'fear' || emotion === 'anger') return 'rising_action';
	if (emotion === 'joy' || emotion === 'relief') return 'character_moment';
	if (actionType === 'observation' || actionType === 'none') return 'world_building';
	return 'rising_action';
}

function ensureSentenceEnding(text: string): string {
	const trimmed = text.trim();
	if (!trimmed) return '';
	if (/[.!?…"]$/.test(trimmed)) return trimmed;
	return `${trimmed}.`;
}

const VISUAL_ANALYSIS_NOISE_PATTERNS: readonly RegExp[] = [
	/\b(em\s+)?plano\s+(geral|m[ée]dio|fechado|superfechado|detalhe)(\s+vertical|\s+frontal|\s+visto\s+de\s+cima)?(\s*\([^)]+\))?(\s+de\s+ambienta[çc][ãa]o\s+noturna)?(\s+mostrando)?[,:]?\s*/gi,
	/\bem\s+um\s+painel(\s+vertical)?(\s+longo)?(\s+de\s+sequ[êe]ncia\s+de\s+movimento)?[,:]?\s*/gi,
	/\b(o\s+painel\s+apresenta|a\s+imagem\s+(mostra|sugere|exibe)|[ée]\s+poss[íi]vel\s+observar|nota-se\s+que)\b[,:]?\s*/gi,
	/n[ãa]o\s+h[áa]\s+personagens\s+nem\s+bal[õo]es\s+de\s+texto\s+vis[íi]veis\.?/gi,
	/galhos\s+e\s+folhagens\s+escuras\s+em\s+silhueta\s+emolduram\s+toda\s+a\s+cena[^.]*\.?/gi,
	/no\s+primeiro\s+plano\s+inferior[^.]*\.?/gi,
	/a\s+express[ãa]o\s+de\s+[^.]+\s+refor[çc]a\s+o\s+clima\s+da\s+cena\.?/gi,
	/\bno\s+canto\s+(superior|inferior)\s+(esquerdo|direito)[^.]*\./gi,
	/\blinhas(\s+verticais)?\s+de\s+velocidade(\s+radiais)?[^,.]*/gi,
];

function toNaturalCharacterLabel(rawName: string): string {
	const trimmed = rawName.trim();
	// If it's a long visual placeholder descriptor rather than a real name, shorten naturally
	if (trimmed.length > 26 || /\b(de cabelos|em t[úu]nica|com faixa|de manto|vestindo)\b/i.test(trimmed)) {
		const lower = trimmed.toLowerCase();
		if (lower.startsWith('jovem')) return 'o jovem';
		if (lower.startsWith('homem')) return 'o homem';
		if (lower.startsWith('mulher')) return 'a mulher';
		if (lower.startsWith('garota') || lower.startsWith('menina')) return 'a garota';
		if (lower.startsWith('garoto') || lower.startsWith('menino')) return 'o garoto';
		if (lower.startsWith('guerreiro')) return 'o guerreiro';
		if (lower.startsWith('mestre')) return 'o mestre';
		if (lower.startsWith('advers[áa]rio') || lower.startsWith('inimigo')) return 'o adversário';
		return trimmed.split(/\s+/).slice(0, 2).join(' ');
	}
	return trimmed;
}

function simplifyVisualForNaturalRecap(rawVisual: string): string {
	let text = rawVisual.trim();
	for (const re of VISUAL_ANALYSIS_NOISE_PATTERNS) {
		text = text.replace(re, ' ');
	}
	text = text.replace(/\s+/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();
	// Keep at most the 2 most informative sentences to stay concise and natural
	const sentences = text
		.split(/(?<=[.!?])\s+/)
		.map((s) => s.trim())
		.filter((s) => s.length >= 12);
	// Keep first sentence + last major action sentence if beat spans multiple panels
	const picked =
		sentences.length <= 2
			? sentences.join(' ')
			: `${sentences[0]} ${sentences[sentences.length - 1]}`;
	const finalStr = (picked || text).replace(/^[,;:\-\s]+/, '').trim();
	if (!finalStr) return '';
	return finalStr.charAt(0).toUpperCase() + finalStr.slice(1);
}

const NON_VERBAL_SCREAM_PATTERN = /^[aeioughrkc!?.…~\-\s]+$/i;

function isSubstantiveSpokenLine(entry: DialogueEntry): boolean {
	const kind = entry.kind ?? (entry.isNarration ? 'narration' : 'dialogue');
	if (kind === 'sfx') return false;
	const clean = (entry.translatedText?.trim() || entry.text.trim()).replace(/^["“”]+|["“”]+$/g, '');
	const alphaChars = clean.replace(/[^A-Za-zÀ-ú0-9]/g, '');
	if (alphaChars.length < 3) return false;
	// Filter non-verbal pain/effort screams like "AAARGH...!!", "ARGH!!!", "EUAACK!!"
	const words = clean.split(/\s+/).filter(Boolean);
	if (words.length === 1 && NON_VERBAL_SCREAM_PATTERN.test(clean)) return false;
	return true;
}

function formatDialogueSentence(entry: DialogueEntry, fallbackCharacters: readonly string[], naturalMode = false): string {
	const quote = (entry.translatedText?.trim() || entry.text.trim()).replace(/^["“”]+|["“”]+$/g, '');
	if (!quote) return '';
	const kind = entry.kind ?? (entry.isNarration ? 'narration' : 'dialogue');
	if (kind === 'sfx') return '';
	if (naturalMode && !isSubstantiveSpokenLine(entry)) return '';

	const rawSpeaker = entry.speaker?.trim();
	const speaker = rawSpeaker ? (naturalMode ? toNaturalCharacterLabel(rawSpeaker) : rawSpeaker) : undefined;

	if (kind === 'narration') {
		return ensureSentenceEnding(quote);
	}
	if (kind === 'thought') {
		if (speaker) {
			return naturalMode ? `${speaker.charAt(0).toUpperCase() + speaker.slice(1)} pensa: "${quote}".` : `${speaker} reflete consigo mesmo: "${quote}".`;
		}
		return `Em pensamento: "${quote}".`;
	}
	const isQuestion = quote.endsWith('?');
	const isExclamation = quote.endsWith('!');
	const verb = isQuestion ? 'pergunta' : isExclamation ? 'grita' : 'diz';
	if (speaker) {
		const prefix = naturalMode ? `Nesse momento, ${speaker}` : speaker;
		return `${prefix} ${verb}: "${quote}".`;
	}
	if (fallbackCharacters.length === 1) {
		const fallback = naturalMode ? toNaturalCharacterLabel(fallbackCharacters[0]!) : fallbackCharacters[0]!;
		const prefix = naturalMode ? `Nesse momento, ${fallback}` : fallback;
		return `${prefix} ${verb}: "${quote}".`;
	}
	return `Nesse momento, alguém ${verb}: "${quote}".`;
}

function selectTransitionConnector(beat: StoryBeat, beatIndex: number, style: ScriptStyle): string {
	if (style === 'natural_recap') {
		if (beatIndex === 0) return 'A história começa quando';
		if (beat.actionType === 'combat') return 'Logo depois,';
		if (beat.emotion === 'surprise' || beat.actionType === 'transformation') return 'Nesse momento,';
		const naturalConnectors = ['Então,', 'Logo depois,', 'Em seguida,', 'Nesse momento,'];
		return naturalConnectors[beatIndex % naturalConnectors.length]!;
	}
	if (beatIndex === 0) {
		if (beat.setting) {
			return style === 'documentary'
				? `A sequência começa em ${beat.setting}:`
				: `Em ${beat.setting},`;
		}
		return '';
	}
	if (beat.actionType === 'combat') {
		return style === 'suspense' || style === 'cinematic_recap' ? 'Logo em seguida, o embate se intensifica:' : 'Em seguida,';
	}
	if (beat.emotion === 'surprise' || beat.actionType === 'transformation') {
		return 'De repente,';
	}
	if (beat.setting && beat.previousContext && !beat.previousContext.toLowerCase().includes(beat.setting.toLowerCase())) {
		return `Já em ${beat.setting},`;
	}
	const connectors = ['Na sequência,', 'Logo depois,', 'Enquanto isso,', 'Continuando a cena,'];
	return connectors[beatIndex % connectors.length]!;
}

/**
 * Checks whether a beat has enough concrete visual or textual evidence
 * to produce a faithful narration without inventing events.
 */
function hasSubstantiveBeatEvidence(beat: StoryBeat): boolean {
	const hasVisual = Boolean(beat.visualSummary && beat.visualSummary.trim().length >= 8);
	const substantiveDialogues = (beat.dialogues ?? []).filter(
		(d) => (d.kind ?? (d.isNarration ? 'narration' : 'dialogue')) !== 'sfx' && d.text.trim().length >= 2,
	);
	const hasDialogue = substantiveDialogues.length > 0;
	const trimmedSummary = beat.summary.trim();
	const hasSummary =
		trimmedSummary.length >= 16 &&
		!/^(sem descri[çc][ãa]o visual|em cena|em confronto|em movimento|em transforma[çc][ãa]o)/i.test(trimmedSummary);
	return hasVisual || hasDialogue || hasSummary;
}

/**
 * Generates faithful, detailed PT-BR narration combining all 4 sources:
 * 1. Visual content (characters, expressions, actions, setting, objects)
 * 2. Speech bubbles & text (dialogues, thoughts, narration boxes)
 * 3. Prior narrative context (continuity transition)
 * 4. Following context (narrative flow without spoiling future chapters)
 *
 * NEVER outputs generic filler like "A história avançou." and NEVER invents facts.
 */
function generateGroundedNarrationText(
	beat: StoryBeat,
	beatIndex: number,
	totalBeats: number,
	style: ScriptStyle,
): { text: string; needsManualReview: boolean; reviewNote?: string } {
	if (!hasSubstantiveBeatEvidence(beat)) {
		const uncertaintyDetail = beat.uncertainties?.slice(0, 2).join(' | ') || 'análise visual e OCR sem conteúdo suficiente';
		return {
			text: `${REVIEW_REQUIRED_PREFIX} Painéis ${beat.panelIds.join(', ')} não puderam ser interpretados com evidência suficiente (${uncertaintyDetail}). Revise os painéis originais antes da produção.`,
			needsManualReview: true,
			reviewNote: `Evidência visual/textual insuficiente para narrar sem inventar: ${uncertaintyDetail}`,
		};
	}

	const isNatural = style === 'natural_recap';
	const parts: string[] = [];
	const connector = selectTransitionConnector(beat, beatIndex, style);

	// 1. Visual description condensed into natural storytelling (no camera/frame analysis jargon in natural_recap)
	const rawVisual = beat.visualSummary?.trim();
	if (rawVisual) {
		const cleanedVisual = isNatural ? simplifyVisualForNaturalRecap(rawVisual) : rawVisual;
		if (cleanedVisual) {
			const visualSentence = ensureSentenceEnding(
				connector
					? `${connector} ${cleanedVisual.charAt(0).toLowerCase()}${cleanedVisual.slice(1)}`
					: cleanedVisual,
			);
			parts.push(visualSentence);
		}
	} else {
		const introParts: string[] = [];
		if (connector) introParts.push(connector);
		if (beat.characters.length > 0) {
			const labels = isNatural ? beat.characters.map(toNaturalCharacterLabel) : beat.characters;
			introParts.push(`${labels.join(' e ')} protagonizam este momento`);
		} else if (beat.setting) {
			introParts.push(`o foco recai sobre ${beat.setting}`);
		}
		if (introParts.length > 0) {
			parts.push(ensureSentenceEnding(introParts.join(' ')));
		}
	}

	// Only add explicit expression note in non-natural styles (natural_recap avoids unnecessary visual detail)
	if (!isNatural && beat.expressions && beat.expressions.length > 0) {
		const primaryExpr = beat.expressions[0]!;
		if (!parts.join(' ').toLowerCase().includes(primaryExpr.toLowerCase())) {
			parts.push(`A expressão de ${primaryExpr} reforça o clima da cena.`);
		}
	}

	// 2. Incorporate essential speech bubbles (dialogue, thought, narration) preserving reading order
	const substantiveDialogues = (beat.dialogues ?? []).filter((d) =>
		isNatural
			? isSubstantiveSpokenLine(d)
			: (d.kind ?? (d.isNarration ? 'narration' : 'dialogue')) !== 'sfx' && d.text.trim().length > 0,
	);
	const incorporated = substantiveDialogues.slice(0, isNatural ? 3 : 4);
	for (const entry of incorporated) {
		const sentence = formatDialogueSentence(entry, beat.characters, isNatural);
		if (sentence && !parts.join(' ').includes(entry.text.trim())) {
			parts.push(sentence);
		}
	}

	// 3. Style-appropriate factual nuance (never inventing events)
	if (style === 'mystery' && beat.emotion === 'tension' && parts.length === 1) {
		parts.push('O momento mantém o mistério em aberto.');
	} else if (style === 'suspense' && (beat.emotion === 'fear' || beat.emotion === 'tension') && beatIndex < totalBeats - 1 && parts.length === 1) {
		parts.push('A tensão cresce antes do próximo desdobramento.');
	}

	const combined = parts.join(' ').replace(/\s+/g, ' ').trim();
	if (!combined || isGenericNarration(combined)) {
		return {
			text: `${REVIEW_REQUIRED_PREFIX} Não foi possível compor narração específica para os painéis ${beat.panelIds.join(', ')}.`,
			needsManualReview: true,
			reviewNote: 'Narração resultante foi classificada como genérica ou vazia.',
		};
	}

	return { text: combined, needsManualReview: false };
}

/**
 * Estimates realistic PT-BR narration duration in seconds based on word count
 * and punctuation pauses. Marked as an estimate until real TTS measures the audio.
 */
export function estimateNarrationDurationSec(text: string, wordsPerSecond = 2.4): number {
	const cleaned = text.trim();
	if (!cleaned) return 1;
	const wordCount = cleaned.split(/\s+/).filter((w) => w.length > 0).length;
	const sentencePauses = (cleaned.match(/[.!?…]+/g) ?? []).length * 0.35;
	const commaPauses = (cleaned.match(/[,;:]+/g) ?? []).length * 0.15;
	const rawSeconds = wordCount / wordsPerSecond + sentencePauses + commaPauses;
	return Math.max(1, Math.round(rawSeconds * 10) / 10);
}

/**
 * Determines review status for a scene based on beat confidence, panel references,
 * and narration grounding.
 */
function determineReviewStatus(
	beat: StoryBeat,
	panelMap: Map<string, ExtractedPanel>,
	narrationNeedsReview: boolean,
	narrationReviewNote?: string,
): { status: ReviewStatus; notes?: string } {
	const notes: string[] = [];

	if (narrationNeedsReview && narrationReviewNote) {
		notes.push(narrationReviewNote);
	}

	if (beat.needsReview) {
		notes.push(beat.reviewReason ?? 'Beat com baixa confiança na análise.');
	}

	if (beat.uncertainties && beat.uncertainties.length > 0 && beat.confidence < 0.7) {
		notes.push(`Incertezas: ${beat.uncertainties.slice(0, 2).join('; ')}`);
	}

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
 * Script Generator & Scene Mapper — Phase 2/5/7 component.
 */
export function runScriptGenerator(options: ScriptGeneratorOptions): ScriptGenerationResult {
	const {
		sequence,
		panels,
		style,
		generatedBy,
		wordsPerSecond = 2.4,
	} = options;
	const warnings: string[] = [...(sequence.warnings ?? [])];

	const panelMap = new Map<string, ExtractedPanel>();
	for (const panel of panels) {
		panelMap.set(panel.panelId, panel);
	}

	const scenes: Scene[] = [];
	let totalDuration = 0;

	for (let i = 0; i < sequence.beats.length; i++) {
		const beat = sequence.beats[i]!;
		const generated = generateGroundedNarrationText(beat, i, sequence.beats.length, style);

		const croppedImagePaths: string[] = [];
		for (const panelId of beat.panelIds) {
			const panel = panelMap.get(panelId);
			if (panel?.croppedImagePath && existsSync(panel.croppedImagePath)) {
				croppedImagePaths.push(panel.croppedImagePath);
			}
		}

		const { status, notes } = determineReviewStatus(
			beat,
			panelMap,
			generated.needsManualReview,
			generated.reviewNote,
		);

		const durationSec = estimateNarrationDurationSec(generated.text, wordsPerSecond);
		totalDuration += durationSec;

		const intent = emotionToIntent(beat.emotion, beat.actionType, i, sequence.beats.length);

		const scene = sceneSchema.parse({
			sceneId: `${sequence.chapterId}_scene_${String(i).padStart(4, '0')}`,
			narrationText: generated.text,
			characters: beat.characters,
			eventDescription: beat.summary,
			...(beat.visualSummary ? { visualSummary: beat.visualSummary } : {}),
			...(beat.setting ? { setting: beat.setting } : {}),
			...(beat.dialogues && beat.dialogues.length > 0 ? { extractedDialogues: beat.dialogues } : {}),
			...(beat.uncertainties && beat.uncertainties.length > 0 ? { uncertainties: beat.uncertainties } : {}),
			panelIds: beat.panelIds,
			croppedImagePaths,
			estimatedDurationSec: durationSec,
			durationSource: 'estimated',
			emotion: beat.emotion,
			narrativeIntent: intent,
			confidence: beat.confidence,
			reviewStatus: status,
			...(notes ? { reviewNotes: notes } : {}),
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
		totalEstimatedDurationSec: Math.max(1, Math.round(totalDuration * 10) / 10),
		generatedAtIso: new Date().toISOString(),
		generatedBy,
		warnings: warnings.length > 0 ? warnings : undefined,
	});

	return { script, warnings };
}

const LLM_SCRIPT_SYSTEM_PROMPT = `Você é um criador de conteúdo brasileiro contando a história de um mangá/manhwa de forma simples, fluida, natural e cronológica.
Transforme a análise visual e os diálogos da cena em uma narração enxuta e envolvente (1 a 3 frases curtas).

REGRAS OBRIGATÓRIAS:
- Conte o que ACONTECE, não descreva cada detalhe visual.
- NÃO descreva roupas, cabelo, iluminação ou expressões sem necessidade narrativa.
- NÃO use linguagem de análise visual ("o painel apresenta", "plano geral", "plano médio", "a imagem sugere", "é possível observar", "emoldura a cena").
- NÃO repita o mesmo acontecimento com palavras diferentes.
- Use nomes confirmados dos personagens quando disponíveis; se o nome ainda for desconhecido, use referências simples como "o jovem", "ele", "o homem".
- Use conectivos naturais: "então", "mas", "nesse momento", "logo depois".
- Incorpore diálogos reais relevantes entre aspas (ex.: Nesse momento, o homem pergunta: "...").
- NUNCA invente ações, falas, pensamentos ou eventos de capítulos futuros.
- NUNCA use frases genéricas ("A história avançou.", "A cena se desenrolou.").
- Nível de humor configurado: {humorVolume}%. Seja sutil e nunca distorça os fatos.
- Responda APENAS JSON válido: {"narrationText": "..."}`;

/**
 * Optional LLM-assisted script refinement over grounded beats + continuity state.
 * Falls back cleanly to the deterministic grounded narration if the LLM is unavailable
 * or produces generic/unfaithful text.
 */
export async function refineScriptWithPort(input: {
	script: RecapScript;
	sequence: NarrativeSequence;
	port: TextEnhancementPort;
	humorVolume?: number;
	wordsPerSecond?: number;
	signal?: AbortSignal;
}): Promise<{ script: RecapScript; warnings: string[] }> {
	const { script, sequence, port, humorVolume = 0, wordsPerSecond = 2.4, signal } = input;
	const warnings: string[] = [];
	const beatByIndex = sequence.beats;
	const updatedScenes: Scene[] = [];
	let totalDuration = 0;

	for (let i = 0; i < script.scenes.length; i++) {
		const scene = script.scenes[i]!;
		const beat = beatByIndex[i];

		// Never ask LLM to "fill in" a scene that lacks visual/OCR evidence
		if (isReviewRequiredPlaceholder(scene.narrationText) || !beat) {
			updatedScenes.push(scene);
			totalDuration += scene.estimatedDurationSec;
			continue;
		}

		try {
			const res = await port.enhance({
				text: scene.narrationText,
				context: {
					sceneId: scene.sceneId,
					style: script.style,
					humorVolume,
					characters: beat.characters,
					setting: beat.setting,
					visualSummary: beat.visualSummary,
					dialogues: beat.dialogues ?? [],
					previousContext: beat.previousContext,
					nextContext: beat.nextContext,
					continuityState: sequence.continuityState,
				},
				systemPrompt: LLM_SCRIPT_SYSTEM_PROMPT.replace('{humorVolume}', String(Math.max(0, Math.min(100, humorVolume)))),
				outputSchema: {
					type: 'object',
					properties: { narrationText: { type: 'string' } },
					required: ['narrationText'],
					additionalProperties: false,
				},
				...(signal ? { signal } : {}),
			});

			let candidate = scene.narrationText;
			if (res.ok && res.text.trim().length > 0) {
				try {
					const parsed = JSON.parse(res.text) as { narrationText?: string };
					if (typeof parsed.narrationText === 'string' && parsed.narrationText.trim().length > 0) {
						candidate = parsed.narrationText.trim();
					}
				} catch {
					candidate = res.text.trim();
				}
			}

			if (isGenericNarration(candidate) || isReviewRequiredPlaceholder(candidate)) {
				warnings.push(`Scene ${scene.sceneId}: LLM script candidate rejected as generic; keeping grounded narration.`);
				candidate = scene.narrationText;
			}

			const durationSec = estimateNarrationDurationSec(candidate, wordsPerSecond);
			totalDuration += durationSec;
			updatedScenes.push({
				...scene,
				narrationText: candidate,
				estimatedDurationSec: durationSec,
				durationSource: 'estimated',
			});
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			warnings.push(`Scene ${scene.sceneId}: LLM script refinement failed (${msg}); keeping grounded narration.`);
			updatedScenes.push(scene);
			totalDuration += scene.estimatedDurationSec;
		}
	}

	return {
		script: {
			...script,
			scenes: updatedScenes,
			totalEstimatedDurationSec: Math.max(1, Math.round(totalDuration * 10) / 10),
			generatedBy: `${script.generatedBy}+${port.name}`,
			warnings: [...(script.warnings ?? []), ...warnings],
		},
		warnings,
	};
}
