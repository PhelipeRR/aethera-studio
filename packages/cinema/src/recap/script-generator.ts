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
import { isLikelyOcrGarbage } from './dialogue-extractor.js';

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
	/\b(?:em\s+um\s+|um\s+|o\s+)?painel(\s+vertical|\s+horizontal|\s+longo|\s+estreito|\s+de\s+p[áa]gina\s+inteira|\s+de\s+sequ[êe]ncia\s+de\s+movimento)*(\s+de\s+[a-zÀ-ú\s]+)?(\s+em\s+estilo\s+[a-zÀ-ú\s]+)?[,:]?\s*(retratando|mostrando|exibindo|apresentando|capturando|destacando|estabelecendo|revelando|acompanhando|ilustrando|registrando)\s+/gi,
	/\b(?:em\s+um\s+|um\s+|o\s+)?painel(\s+vertical|\s+horizontal|\s+longo|\s+estreito|\s+de\s+p[áa]gina\s+inteira|\s+de\s+sequ[êe]ncia\s+de\s+movimento)+(\s+de\s+[a-zÀ-ú\s]+)?[,:]?\s*/gi,
	/\b(?:um\s+|o\s+)?quadro(?:\s+de\s+(?:manhwa|mang[áa]|webtoon|a[çc][ãa]o|luta))?(?:\s+de\s+[a-zÀ-ú]+)?(?:\s+em\s+estilo\s+[a-zÀ-ú\s]+)?\s+(?:mostrando|retratando|exibindo|apresentando|estabelecendo|revelando)\s+/gi,
	/\bem\s+um\s+painel(\s+vertical|\s+horizontal)?(\s+longo)?(\s+de\s+sequ[êe]ncia\s+de\s+movimento)?[,:]?\s*/gi,
	/\b(o\s+painel\s+apresenta|a\s+imagem\s+(mostra|sugere|exibe|retrata|apresenta)|a\s+cena\s+(mostra|retrata|exibe|apresenta)|[ée]\s+poss[íi]vel\s+observar|nota-se\s+que)\b[,:]?\s*/gi,
	/\b(?:em\s+)?estilo\s+(?:de\s+)?(?:pintura\s+digital|digital\s+pintado|ilustra[çc][ãa]o\s+digital|arte\s+digital)\b[,:]?\s*/gi,
	/\b(?:com\s+)?elementos\s+de\s+interface(?:\s+vis[íi]veis)?\b[,:]?\s*/gi,
	/\b(?:composi[çc][ãa]o\s+visual|enquadramento(?:\s+[a-zÀ-ú]+)?)\b[,:]?\s*/gi,
	/n[ãa]o\s+h[áa]\s+personagens(?:[,\s]+(?:nem|vis[íi]veis)|\s*,\s*)?(?:\s*bal[õo]es\s+de\s+texto)?[^.]*\.?/gi,
	/\b(?:sem\s+personagens\s+vis[íi]veis|nenhum\s+personagem\s+vis[íi]vel)\b[^.]*\.?/gi,
	/nenhum\s+personagem,\s*objeto\s+ou\s+cen[áa]rio\s+aparece\s+vis[íi]vel\.?/gi,
	/(?:galhos\s+e\s+)?folhagens\s+escuras(?:\s+e\s+densas)?(?:\s+em\s+silhueta)?\s+emolduram\s+(?:toda\s+a\s+cena|os\s+cantos\s+da\s+imagem)[^.]*\.?/gi,
	/\bno\s+primeiro\s+plano(?:\s+inferior|\s+superior)?[^.]*\.?/gi,
	/\bno\s+segundo\s+plano[^.]*\.?/gi,
	/a\s+express[ãa]o\s+de\s+[^.]+\s+refor[çc]a\s+o\s+clima\s+da\s+cena\.?/gi,
	/\b(?:no|do|ao)\s+(?:canto|quadrante)\s+(superior|inferior)\s+(esquerdo|direito)[^.,;]*[.,;]?/gi,
	/\b(?:na|pela)\s+lateral\s+(esquerda|direita)[^.,;]*[.,;]?/gi,
	/\b(?:e\s+)?um\s+efeito\s+sonoro\s+(?:coreano|japon[êe]s|chin[êe]s)?[^.,;]*[.,;]?/gi,
	/\bo\s+fundo\s+(?:apresenta|mostra|exibe|est[áa])[^.]*\.?/gi,
	/\benquanto\s+fragmentos\s+escuros\s+se\s+espalham\s+pelo\s+fundo[^.,;]*/gi,
	/\b(?:pelo|no|com)\s+fundo\s+(?:texturizado|cinza[-\s]azul(?:ado)?|escuro|borrado)[^.,;]*/gi,
	/\b(?:em\s+)?tons\s+de\s+cinza[-\s]azul(?:ado)?\b/gi,
	/\blinhas(\s+verticais)?\s+de\s+velocidade(\s+radiais)?[^,.]*/gi,
	/\bcortad[oa]s?\s+pela\s+borda\s+da\s+imagem\b/gi,
];

export const TECHNICAL_VISUAL_JARGON_PATTERNS: readonly RegExp[] = [
	/\bpainel\s+(?:vertical|horizontal|longo|estreito|de\s+p[áa]gina|de\s+paisagem)\b/i,
	/\b(?:em\s+um|no|do|o)\s+painel\b/i,
	/\bestilo\s+(?:digital\s+pintado|de\s+pintura\s+digital|ilustra[çc][ãa]o\s+digital)\b/i,
	/\b(?:no\s+)?(?:primeiro|segundo)\s+plano\b/i,
	/\bplano\s+(?:geral|m[ée]dio|fechado|superfechado|detalhe)\b/i,
	/\belementos\s+de\s+interface\b/i,
	/\b(?:n[ãa]o\s+h[áa]|sem|nenhum)\s+personagens?\s+vis[íi]ve(?:l|is)\b/i,
	/\ba\s+imagem\s+(?:mostra|exibe|retrata|apresenta|sugere)\b/i,
	/\bcomposi[çc][ãa]o\s+visual\b/i,
	/\benquadramento\b/i,
	/\bquadrante\s+(?:superior|inferior)\b/i,
	/\blateral\s+(?:esquerda|direita)\b/i,
	/\bborda\s+da\s+imagem\b/i,
	/\befei?to\s+sonoro\s+(?:coreano|japon[êe]s|chin[êe]s)\b/i,
	/\bbal[õo]es\s+de\s+texto\b/i,
	/\bclose-up\b/i,
	/\bplong[ée]e\b/i,
];

export interface TechnicalVisualDetection {
	isTechnical: boolean;
	isRawCopy: boolean;
	matchedPatterns: string[];
}

function tokenizeSignificantForOverlap(text: string): string[] {
	return text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((w) => w.length >= 4);
}

/**
 * Detects whether a narration string contains raw visual-analysis jargon
 * or is a near-verbatim copy of an internal technical visualSummary.
 */
export function detectTechnicalVisualDescription(
	narrationText: string,
	rawVisualSummary?: string,
): TechnicalVisualDetection {
	const trimmed = narrationText.trim();
	const matchedPatterns: string[] = [];
	for (const re of TECHNICAL_VISUAL_JARGON_PATTERNS) {
		const m = trimmed.match(re);
		if (m) matchedPatterns.push(m[0]);
	}

	let isRawCopy = false;
	if (rawVisualSummary && rawVisualSummary.trim().length >= 30) {
		const rawTrimmed = rawVisualSummary.trim();
		const rawHasTech = TECHNICAL_VISUAL_JARGON_PATTERNS.some((re) => re.test(rawTrimmed));
		if (rawHasTech) {
			const nTokens = new Set(tokenizeSignificantForOverlap(trimmed));
			const rTokens = new Set(tokenizeSignificantForOverlap(rawTrimmed));
			if (nTokens.size >= 5 && rTokens.size >= 5) {
				let shared = 0;
				for (const t of nTokens) {
					if (rTokens.has(t)) shared++;
				}
				const jaccard = shared / (nTokens.size + rTokens.size - shared);
				if (jaccard >= 0.72) {
					isRawCopy = true;
				}
			}
		}
	}

	return {
		isTechnical: matchedPatterns.length > 0,
		isRawCopy,
		matchedPatterns,
	};
}

export interface StructuredNarrativeEvent {
	beatId: string;
	setting?: string;
	actors: string[];
	actions: string[];
	dialogues: DialogueEntry[];
	emotion: Emotion;
	actionType: string;
	previousContext?: string;
	nextContext?: string;
}

const UNGROUNDED_INVENTION_PATTERNS: readonly { label: string; pattern: RegExp }[] = [
	{ label: 'temperatura não comprovada', pattern: /\b(noite\s+fria|clima\s+frio|vento\s+gelado|ar\s+gelado|frio\s+cortante|calor\s+intenso|calor\s+escaldante|g[ée]lid[oa]s?)\b/i },
	{ label: 'motivação inventada', pattern: /\b(para\s+se\s+vingar|em\s+busca\s+de\s+vingan[çc]a|por\s+causa\s+de\s+seu\s+passado|decidiu\s+que|prometeu\s+a\s+si\s+mesmo|sabia\s+que\s+precisava|com\s+o\s+objetivo\s+de)\b/i },
	{ label: 'consequência/antecipação não comprovada', pattern: /\b(sem\s+saber\s+que|mal\s+sabia\s+ele|isso\s+mudaria\s+sua\s+vida|a\s+partir\s+daquele\s+momento\s+tudo\s+mudou|o\s+destino\s+estava\s+selado)\b/i },
];

export interface UngroundedInventionDetection {
	hasInvention: boolean;
	findings: Array<{ label: string; matchedText: string }>;
}

/**
 * Detects whether narration introduces ungrounded temperature, motivations,
 * or future consequences not supported by the scene's panel evidence.
 */
export function detectUngroundedInventions(
	narrationText: string,
	groundingSources: readonly (string | undefined)[],
): UngroundedInventionDetection {
	const groundingLower = groundingSources.filter(Boolean).join(' ').toLowerCase();
	const findings: Array<{ label: string; matchedText: string }> = [];

	for (const { label, pattern } of UNGROUNDED_INVENTION_PATTERNS) {
		const m = narrationText.match(pattern);
		if (!m) continue;
		const matched = m[0].toLowerCase();
		// Allow only if the core words were already present in the scene's visual/dialogue evidence
		const coreTokens = tokenizeSignificantForOverlap(matched);
		const isGrounded = coreTokens.length > 0 && coreTokens.every((t) => groundingLower.includes(t));
		if (!isGrounded) {
			findings.push({ label, matchedText: m[0] });
		}
	}

	return {
		hasInvention: findings.length > 0,
		findings,
	};
}

/**
 * Detects whether scene i's narration anticipates distinctive action/setting tokens
 * that only exist in scene i+1's panels (not in scene i's own evidence).
 */
export function detectAnticipatedNextSceneEvents(
	narrationText: string,
	currGroundingSources: readonly (string | undefined)[],
	nextSceneGroundingSources: readonly (string | undefined)[],
): { hasAnticipation: boolean; anticipatedTokens: string[] } {
	const currTokens = new Set(tokenizeSignificantForOverlap(currGroundingSources.filter(Boolean).join(' ')));
	const nextTokens = new Set(tokenizeSignificantForOverlap(nextSceneGroundingSources.filter(Boolean).join(' ')));
	const narrationTokens = new Set(tokenizeSignificantForOverlap(narrationText));

	const anticipatedTokens: string[] = [];
	for (const tok of narrationTokens) {
		if (tok.length >= 6 && nextTokens.has(tok) && !currTokens.has(tok)) {
			anticipatedTokens.push(tok);
		}
	}

	return {
		hasAnticipation: anticipatedTokens.length >= 2,
		anticipatedTokens,
	};
}

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

function cleanTechnicalVisualText(rawVisual: string): string {
	let text = rawVisual.trim();
	text = text.replace(/\batravessa\s+diagonalmente\s+o\s+painel\b/gi, 'atravessa o caminho');
	text = text.replace(/\bdo\s+topo\s+(?:do\s+painel|da\s+imagem)\b/gi, 'de cima');
	text = text.replace(/\bdescendo\s+do\s+topo\b/gi, 'descendo de cima');
	for (const re of VISUAL_ANALYSIS_NOISE_PATTERNS) {
		text = text.replace(re, ' ');
	}
	text = text
		.replace(/\s*;\s*(?=[.,!?]|$)/g, '')
		.replace(/\s*,\s*(?=[.,!?]|$)/g, '')
		.replace(/\s+/g, ' ')
		.replace(/\s+([.,!?;])/g, '$1')
		.trim();
	return text.replace(/^[,;:\-\s]+/, '').replace(/[;,\s]+$/, '').trim();
}

function simplifyVisualForNaturalRecap(rawVisual: string): string {
	const text = cleanTechnicalVisualText(rawVisual);
	if (!text) return '';
	// Keep at most the 2 most informative sentences to stay concise and natural
	const sentences = text
		.split(/(?<=[.!?])\s+/)
		.map((s) => s.replace(/^[,;:\-\s]+/, '').trim())
		.filter((s) => s.length >= 12);
	// Keep first sentence + last major action sentence if beat spans multiple panels
	const picked =
		sentences.length <= 2
			? sentences.join(' ')
			: `${sentences[0]} ${sentences[sentences.length - 1]}`;
	const finalStr = (picked || text).replace(/^[,;:\-\s]+/, '').replace(/[;,\s]+$/, '').trim();
	if (!finalStr) return '';
	return finalStr.charAt(0).toUpperCase() + finalStr.slice(1);
}

/**
 * Explicit transformation step: Visual Analysis (StoryBeat) -> StructuredNarrativeEvent.
 * Separates internal visual analysis from narrative facts (actors, setting, actions, dialogues)
 * so raw technical visual descriptions are never copied directly into narration.
 */
export function extractNarrativeEventsFromBeat(
	beat: StoryBeat,
	style: ScriptStyle = 'natural_recap',
): StructuredNarrativeEvent {
	const isNatural = style === 'natural_recap';
	const actors = [...new Set(
		beat.characters
			.map((c) => (isNatural ? toNaturalCharacterLabel(c) : c.trim()))
			.filter(Boolean),
	)];

	const cleanedSetting = beat.setting ? cleanTechnicalVisualText(beat.setting) : undefined;

	const seenActions = new Set<string>();
	const actions: string[] = [];
	for (const act of beat.actions ?? []) {
		const cleaned = cleanTechnicalVisualText(act.description);
		if (!cleaned || cleaned.length < 6) continue;
		if (detectTechnicalVisualDescription(cleaned).isTechnical) continue;
		const key = cleaned.toLowerCase();
		if (seenActions.has(key)) continue;
		seenActions.add(key);
		actions.push(cleaned);
	}

	// If structured actions are absent, extract only non-technical narrative clauses from visualSummary
	if (actions.length === 0 && beat.visualSummary) {
		const cleaned = simplifyVisualForNaturalRecap(beat.visualSummary);
		if (cleaned && !detectTechnicalVisualDescription(cleaned).isTechnical) {
			actions.push(cleaned);
		}
	}

	const dialogues = (beat.dialogues ?? []).filter((d) => isSubstantiveSpokenLine(d));

	return {
		beatId: beat.beatId,
		...(cleanedSetting ? { setting: cleanedSetting } : {}),
		actors,
		actions,
		dialogues,
		emotion: beat.emotion,
		actionType: beat.actionType,
		...(beat.previousContext ? { previousContext: cleanTechnicalVisualText(beat.previousContext) } : {}),
		...(beat.nextContext ? { nextContext: cleanTechnicalVisualText(beat.nextContext) } : {}),
	};
}

const NON_VERBAL_SCREAM_PATTERN = /^[aeioughrkc!?.…~\-\s]+$/i;

function isSubstantiveSpokenLine(entry: DialogueEntry): boolean {
	const kind = entry.kind ?? (entry.isNarration ? 'narration' : 'dialogue');
	if (kind === 'sfx') return false;
	const clean = (entry.translatedText?.trim() || entry.text.trim()).replace(/^["“”]+|["“”]+$/g, '');
	if (isLikelyOcrGarbage(clean, entry.uncertainty)) return false;
	const alphaChars = clean.replace(/[^A-Za-zÀ-ú0-9]/g, '');
	if (alphaChars.length < 3) return false;
	// Filter non-verbal pain/effort screams like "AAARGH...!!", "ARGH!!!", "EUAACK!!"
	const words = clean.split(/\s+/).filter(Boolean);
	if (words.length === 1 && NON_VERBAL_SCREAM_PATTERN.test(clean)) return false;
	return true;
}

function formatDialogueSentence(
	entry: DialogueEntry,
	fallbackCharacters: readonly string[],
	naturalMode = false,
	dialogueIndexInScene = 0,
): string {
	const quote = (entry.translatedText?.trim() || entry.text.trim()).replace(/^["“”]+|["“”]+$/g, '');
	if (!quote) return '';
	const kind = entry.kind ?? (entry.isNarration ? 'narration' : 'dialogue');
	if (kind === 'sfx') return '';
	if (!isSubstantiveSpokenLine(entry)) return '';

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
	const followupVerb = isQuestion ? 'questiona' : isExclamation ? 'exclama' : 'completa';
	const resolvedSpeaker = speaker ?? (fallbackCharacters.length === 1
		? (naturalMode ? toNaturalCharacterLabel(fallbackCharacters[0]!) : fallbackCharacters[0]!)
		: undefined);

	if (resolvedSpeaker) {
		if (naturalMode && dialogueIndexInScene === 0) {
			return `Nesse momento, ${resolvedSpeaker} ${verb}: "${quote}".`;
		}
		if (naturalMode && dialogueIndexInScene > 0) {
			const capSpeaker = resolvedSpeaker.charAt(0).toUpperCase() + resolvedSpeaker.slice(1);
			return `${capSpeaker} ${followupVerb}: "${quote}".`;
		}
		return `${resolvedSpeaker} ${verb}: "${quote}".`;
	}
	if (dialogueIndexInScene === 0) {
		return `Nesse momento, alguém ${verb}: "${quote}".`;
	}
	return `Em seguida, uma voz ${followupVerb}: "${quote}".`;
}

function combineConnectorAndVisual(connector: string, visualText: string, beatIndex: number, style: ScriptStyle): string {
	const cleaned = visualText.trim();
	if (!cleaned) return '';
	if (style === 'natural_recap' && beatIndex === 0) {
		// Avoid broken grammar like "A história começa quando paisagem montanhosa..."
		const startsWithSettingNoun = /^(?:uma?\s+)?paisagem|^(?:uma?\s+)?floresta|^montanhas|^picos|^noite|^c[ée]u|^vila|^templo|^castelo|^academia|^neblina/i.test(cleaned);
		if (startsWithSettingNoun) {
			const lowerFirst = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
			if (/^c[ée]u\b/i.test(lowerFirst)) {
				return ensureSentenceEnding(`A história começa sob um ${lowerFirst}`);
			}
			const needsArticle = /^(paisagem|floresta|noite|vila|academia|neblina)\b/i.test(lowerFirst);
			return ensureSentenceEnding(`A história começa em ${needsArticle ? `uma ${lowerFirst}` : lowerFirst}`);
		}
		const startsWithArticleOnly = /^(uma?\s+perna|um\s+galho|folhas|silhuetas?)/i.test(cleaned);
		if (startsWithArticleOnly) {
			return ensureSentenceEnding(cleaned);
		}
	}
	if (!connector) return ensureSentenceEnding(cleaned);
	return ensureSentenceEnding(`${connector} ${cleaned.charAt(0).toLowerCase()}${cleaned.slice(1)}`);
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
	previousSceneActions?: ReadonlySet<string>,
): { text: string; needsManualReview: boolean; reviewNote?: string; usedActions: string[] } {
	if (!hasSubstantiveBeatEvidence(beat)) {
		const uncertaintyDetail = beat.uncertainties?.slice(0, 2).join(' | ') || 'análise visual e OCR sem conteúdo suficiente';
		return {
			text: `${REVIEW_REQUIRED_PREFIX} Painéis ${beat.panelIds.join(', ')} não puderam ser interpretados com evidência suficiente (${uncertaintyDetail}). Revise os painéis originais antes da produção.`,
			needsManualReview: true,
			reviewNote: `Evidência visual/textual insuficiente para narrar sem inventar: ${uncertaintyDetail}`,
			usedActions: [],
		};
	}

	const isNatural = style === 'natural_recap';
	const event = extractNarrativeEventsFromBeat(beat, style);
	const deduplicatedActions = previousSceneActions
		? event.actions.filter((act) => !previousSceneActions.has(act.toLowerCase().trim()))
		: event.actions;
	const activeActions = deduplicatedActions.length > 0 ? deduplicatedActions : event.actions;
	const parts: string[] = [];
	const connector = selectTransitionConnector(beat, beatIndex, style);

	// 1. Build narration from structured narrative events (never raw visualDescription)
	if (activeActions.length > 0) {
		const primaryAction = activeActions[0]!;
		parts.push(combineConnectorAndVisual(connector, primaryAction, beatIndex, style));
		const remainingActions = activeActions.slice(1, isNatural ? 4 : 3);
		for (const nextAct of remainingActions) {
			const joined = parts.join(' ').toLowerCase();
			if (!joined.includes(nextAct.toLowerCase())) {
				parts.push(ensureSentenceEnding(nextAct.charAt(0).toUpperCase() + nextAct.slice(1)));
			}
		}
	} else {
		const introParts: string[] = [];
		if (event.actors.length > 0) {
			if (connector) introParts.push(connector);
			introParts.push(`${event.actors.join(' e ')} protagonizam este momento`);
		} else if (event.setting) {
			if (beatIndex === 0 && isNatural) {
				const lowerSetting = event.setting.charAt(0).toLowerCase() + event.setting.slice(1);
				const hasArticle = /^(uma?|o|a|os|as)\s+/i.test(lowerSetting);
				introParts.push(`A história começa em ${hasArticle ? lowerSetting : `uma ${lowerSetting}`}`);
			} else {
				if (connector) introParts.push(connector);
				introParts.push(`a cena se passa em ${event.setting}`);
			}
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
	// Always filter out SFX and garbled OCR noise (e.g. "a k ie pe", "1 - y g")
	const incorporated = event.dialogues.slice(0, isNatural ? 3 : 4);
	let dialogueIdx = 0;
	for (const entry of incorporated) {
		const sentence = formatDialogueSentence(entry, beat.characters, isNatural, dialogueIdx);
		if (sentence && !parts.join(' ').includes(entry.text.trim())) {
			parts.push(sentence);
			dialogueIdx += 1;
		}
	}

	// 3. Style-appropriate factual nuance (never inventing events)
	if (style === 'mystery' && beat.emotion === 'tension' && parts.length === 1) {
		parts.push('O momento mantém o mistério em aberto.');
	} else if (style === 'suspense' && (beat.emotion === 'fear' || beat.emotion === 'tension') && beatIndex < totalBeats - 1 && parts.length === 1) {
		parts.push('A tensão cresce antes do próximo desdobramento.');
	}

	const combined = parts.join(' ').replace(/\s+/g, ' ').trim();
	const techCheck = detectTechnicalVisualDescription(combined, beat.visualSummary);
	if (!combined || isGenericNarration(combined)) {
		return {
			text: `${REVIEW_REQUIRED_PREFIX} Não foi possível compor narração específica para os painéis ${beat.panelIds.join(', ')}.`,
			needsManualReview: true,
			reviewNote: 'Narração resultante foi classificada como genérica ou vazia.',
			usedActions: [],
		};
	}
	if (techCheck.isTechnical || techCheck.isRawCopy) {
		return {
			text: combined,
			needsManualReview: true,
			reviewNote: `Narração ainda contém linguagem técnica de análise visual (${techCheck.matchedPatterns.join(', ') || 'cópia de descrição visual'}).`,
			usedActions: activeActions,
		};
	}

	return { text: combined, needsManualReview: false, usedActions: activeActions };
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
	let previousSceneActions = new Set<string>();

	for (let i = 0; i < sequence.beats.length; i++) {
		const beat = sequence.beats[i]!;
		const generated = generateGroundedNarrationText(beat, i, sequence.beats.length, style, previousSceneActions);
		previousSceneActions = new Set(generated.usedActions.map((a) => a.toLowerCase().trim()));

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
			...(beat.actions && beat.actions.length > 0 ? { actions: beat.actions } : {}),
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

const LLM_SCRIPT_SYSTEM_PROMPT = `Você é um criador de conteúdo brasileiro contando a história de um mangá/manhwa de forma simples, conversacional, fluida e cronológica.
Transforme a análise visual e os diálogos da cena em uma narração direta e natural.

REGRAS OBRIGATÓRIAS:
- Priorize ações, acontecimentos, diálogos reais e continuidade narrativa.
- NÃO descreva detalhes supérfluos como névoa, roupas, cabelo, poeira, folhas, iluminação ou expressões quando não forem importantes para entender a história.
- NÃO use linguagem de análise visual ("o painel apresenta", "plano geral", "plano médio", "a imagem sugere", "é possível observar").
- NÃO repita o mesmo acontecimento com palavras diferentes.
- NÃO imponha um limite rígido de palavras: conte tudo o que realmente importa na cena sem enrolação, seja em uma frase curta ou em vários períodos quando houver muitos eventos e diálogos.
- Use nomes confirmados dos personagens quando disponíveis; se o nome ainda for desconhecido, use referências simples como "o jovem", "ele", "o homem".
- Use conectivos naturais e conversacionais: "então", "mas", "nesse momento", "logo depois".
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
			const narrativeEvent = extractNarrativeEventsFromBeat(beat, script.style);
			const res = await port.enhance({
				text: scene.narrationText,
				context: {
					sceneId: scene.sceneId,
					style: script.style,
					humorVolume,
					narrativeEvent,
					characters: narrativeEvent.actors,
					setting: narrativeEvent.setting,
					actions: narrativeEvent.actions,
					dialogues: narrativeEvent.dialogues,
					previousContext: narrativeEvent.previousContext,
					nextContext: narrativeEvent.nextContext,
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

			const techCandidate = detectTechnicalVisualDescription(candidate, beat.visualSummary);
			if (isGenericNarration(candidate) || isReviewRequiredPlaceholder(candidate) || techCandidate.isTechnical || techCandidate.isRawCopy) {
				warnings.push(`Scene ${scene.sceneId}: LLM script candidate rejected (${techCandidate.isTechnical || techCandidate.isRawCopy ? 'technical visual description' : 'generic'}); keeping grounded narration.`);
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
