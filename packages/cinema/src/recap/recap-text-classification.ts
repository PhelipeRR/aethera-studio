import type {
	BoundingBox,
	DialogueEntry,
	DialogueKind,
	RecapTextContentKind,
	RecapTextEvidence,
	RecapTextProvenance,
} from './recap-types.js';

export interface RecapTextClassificationInput {
	text: string;
	explicitKind?: DialogueKind;
	isNarration?: boolean;
	balloon?: 'speech' | 'thought' | 'narration' | 'jagged' | 'reaction' | 'none' | 'unknown';
	balloonPresent?: boolean | null;
	typography?: {
		stylized?: boolean;
		oversized?: boolean;
		allCaps?: boolean;
		detachedFromBalloon?: boolean;
	};
	region?: BoundingBox;
	panelWidth?: number;
	panelHeight?: number;
	visualContext?: {
		actionTerms?: readonly string[];
		impactOrMotion?: boolean;
		reactionGlyph?: boolean;
		decorativeOverlay?: boolean;
	};
	ocrConfidence?: number | null;
	readingOrder?: number;
	source?: 'ocr' | 'vision' | 'checkpoint' | 'deterministic';
	panelId?: string;
	lineIndex?: number;
}

export interface RecapTextClassification {
	kind: RecapTextContentKind;
	originalText: string;
	normalizedText: string;
	narrativeEligible: boolean;
	confidence: number | null;
	evidence: RecapTextEvidence[];
	provenance: RecapTextProvenance;
}

const SFX_WORDS = /^(boom|bam|bang|crack|crash|slash|whoosh|swoosh|thud|thump|wham|pow|clang|clank|snap|smack|smash|roar|hiss|drip|zap|swish|fwoosh|rumble|shing|tsk|ugh|grr|ahh|gah|hmm)[!?.~…]*$/iu;
const REACTION_GLYPHS = /^[!?！？…~〜♡♥☆★※]+$/u;
const NARRATIVE_PREFIX = /^(narra[çc][ãa]o|caption|texto|ep[ií]logo|mais tarde|enquanto isso)\s*:/iu;
const SENTENCE_TEXT = /[\p{L}\p{N}]{2,}(?:\s+[\p{L}\p{N}]{2,})+/u;
const ACTION_WORDS = /\b(impact|hit|strike|punch|kick|run|jump|fall|explode|crash|golpe|impacto|corre|salta|cai|explode|ataque)\b/iu;

function clamp(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function normalizeText(text: string): string {
	return text.trim().replace(/\s+/gu, ' ');
}

function pushEvidence(target: RecapTextEvidence[], source: RecapTextEvidence['source'], detail: string, weight?: number): void {
	if (!target.some((item) => item.source === source && item.detail === detail)) {
		target.push({ source, detail, ...(weight === undefined ? {} : { weight }) });
	}
}

function provenance(input: RecapTextClassificationInput): RecapTextProvenance {
	return {
		source: input.source ?? 'deterministic',
		...(input.panelId ? { panelId: input.panelId } : {}),
		...(input.lineIndex === undefined ? {} : { lineIndex: input.lineIndex }),
		...(input.region ? { region: input.region } : {}),
		...(input.panelId ? { ref: `${input.panelId}:${input.lineIndex ?? 0}` } : {}),
	};
}

/**
 * Classifies visible text using multiple independent signals. This function is deliberately
 * conservative: a SFX classification removes speech eligibility, but never removes the text
 * or its provenance from the panel result.
 */
export function classifyRecapTextContent(input: RecapTextClassificationInput): RecapTextClassification {
	const originalText = input.text;
	const text = normalizeText(input.text);
	const lower = text.toLocaleLowerCase();
	const evidence: RecapTextEvidence[] = [];
	if (input.source) pushEvidence(evidence, input.source === 'deterministic' ? 'deterministic' : input.source, `Origem declarada: ${input.source}.`, 0.35);
	if (input.region && input.panelWidth && input.panelHeight) {
		const centerY = (input.region.y + input.region.h / 2) / input.panelHeight;
		const centerX = (input.region.x + input.region.w / 2) / input.panelWidth;
		if (centerY < 0.28) pushEvidence(evidence, 'position', 'Texto na faixa superior do painel.', 0.35);
		if (centerY > 0.72) pushEvidence(evidence, 'position', 'Texto na faixa inferior do painel.', 0.25);
		if (centerX > 0.12 && centerX < 0.88) pushEvidence(evidence, 'position', 'Texto dentro da área central do painel.', 0.15);
	}

	const explicitSfx = input.explicitKind === 'sfx';
	const explicitNarration = input.explicitKind === 'narration' || input.isNarration === true || input.balloon === 'narration';
	const reactionGlyph = input.visualContext?.reactionGlyph === true || REACTION_GLYPHS.test(text);
	const stylized = input.typography?.stylized === true || input.typography?.oversized === true;
	const detached = input.typography?.detachedFromBalloon === true || input.balloon === 'none';
	const jagged = input.balloon === 'jagged' || input.balloon === 'reaction';
	const actionContext = input.visualContext?.impactOrMotion === true || (input.visualContext?.actionTerms ?? []).some((term) => ACTION_WORDS.test(term));
	const lexicalSfx = SFX_WORDS.test(text) || /^[A-ZÀ-Ú]{2,14}[!！]$/u.test(text);

	if (explicitSfx) pushEvidence(evidence, 'vision', 'A análise de origem marcou o texto como efeito sonoro.', 0.9);
	if (reactionGlyph) pushEvidence(evidence, 'typography', 'Glifo de reação composto apenas por pontuação/símbolos.', 0.85);
	if (stylized) pushEvidence(evidence, 'typography', 'Tipografia estilizada ou ampliada.', 0.55);
	if (detached) pushEvidence(evidence, 'position', 'Texto sem evidência de estar em balão de fala.', 0.55);
	if (jagged) pushEvidence(evidence, 'balloon', 'Balão serrilhado/de reação.', 0.75);
	if (actionContext) pushEvidence(evidence, 'context', 'Ações de impacto/movimento no contexto visual.', 0.5);
	if (input.balloonPresent === true) pushEvidence(evidence, 'balloon', 'Balão presente.', 0.7);
	if (input.balloonPresent === false) pushEvidence(evidence, 'balloon', 'Nenhum balão informado.', 0.5);
	if (input.ocrConfidence !== undefined && input.ocrConfidence !== null) pushEvidence(evidence, 'ocr', `Confiança OCR registrada: ${input.ocrConfidence.toFixed(2)}.`, clamp(input.ocrConfidence));

	let kind: RecapTextContentKind = 'unknown';
	let confidence: number | null = null;
	if (explicitNarration || NARRATIVE_PREFIX.test(text)) {
		kind = 'narrative_caption';
		confidence = explicitNarration ? 0.9 : 0.72;
		pushEvidence(evidence, 'context', 'Texto associado a caixa/indicador de narração.', confidence);
	} else if (explicitSfx || reactionGlyph || jagged || (stylized && (detached || actionContext)) || (lexicalSfx && (detached || actionContext || input.balloon === 'reaction'))) {
		kind = 'sound_effect';
		confidence = Math.min(0.98, 0.55 + (explicitSfx ? 0.3 : 0) + (reactionGlyph ? 0.2 : 0) + (jagged ? 0.12 : 0) + (actionContext ? 0.08 : 0));
		pushEvidence(evidence, 'context', 'Sinais combinados apontam para onomatopeia/reação, não fala.', confidence);
	} else if (input.visualContext?.decorativeOverlay === true) {
		kind = 'decorative_text';
		confidence = 0.82;
		pushEvidence(evidence, 'position', 'Texto marcado como sobreposição decorativa.', confidence);
	} else if (input.balloon === 'speech' || input.balloon === 'thought' || input.balloonPresent === true || (SENTENCE_TEXT.test(text) && !stylized && !detached)) {
		kind = 'dialogue';
		confidence = input.balloonPresent === true || input.balloon === 'speech' || input.balloon === 'thought' ? 0.82 : 0.55;
		pushEvidence(evidence, 'balloon', 'Texto compatível com fala/pensamento e sem sinais suficientes de SFX.', confidence);
	} else if (text && stylized) {
		kind = 'visual_effect';
		confidence = 0.55;
		pushEvidence(evidence, 'typography', 'Texto estilizado sem evidência suficiente para fala ou SFX.', confidence);
	} else if (!text || !SENTENCE_TEXT.test(text)) {
		kind = 'unknown';
		confidence = text ? 0.25 : null;
		pushEvidence(evidence, 'deterministic', 'Evidência estrutural insuficiente para classificar o texto.', confidence ?? 0.1);
	}

	return {
		kind,
		originalText,
		normalizedText: text,
		narrativeEligible: kind === 'dialogue' || kind === 'narrative_caption',
		confidence,
		evidence: evidence.slice(0, 12),
		provenance: provenance(input),
	};
}

export function dialogueKindForContent(kind: RecapTextContentKind, fallback: DialogueKind = 'dialogue'): DialogueKind {
	if (kind === 'sound_effect') return 'sfx';
	if (kind === 'narrative_caption') return 'narration';
	return fallback;
}

export function annotateRecapDialogue(input: {
	entry: DialogueEntry;
	panelId?: string;
	lineIndex?: number;
	source?: 'ocr' | 'vision' | 'checkpoint' | 'deterministic';
	balloonPresent?: boolean | null;
	balloon?: NonNullable<RecapTextClassificationInput['balloon']>;
	visualContext?: NonNullable<RecapTextClassificationInput['visualContext']>;
}): DialogueEntry {
	const entry = input.entry;
	const lineIndex = input.lineIndex ?? entry.readingOrder;
	const classified = classifyRecapTextContent({
		text: entry.originalText ?? entry.text,
		...(entry.kind ? { explicitKind: entry.kind } : {}),
		...(entry.isNarration === undefined ? {} : { isNarration: entry.isNarration }),
		...(input.balloon ? { balloon: input.balloon } : {}),
		...(input.balloonPresent === undefined ? {} : { balloonPresent: input.balloonPresent }),
		...(input.visualContext ? { visualContext: input.visualContext } : {}),
		...(input.source ? { source: input.source } : {}),
		...(input.panelId ? { panelId: input.panelId } : {}),
		...(lineIndex === undefined ? {} : { lineIndex }),
	});
	const kind = dialogueKindForContent(classified.kind, entry.kind ?? 'dialogue');
	return {
		...entry,
		kind,
		isNarration: kind === 'narration',
		contentKind: classified.kind,
		contentEvidence: classified.evidence,
		contentProvenance: classified.provenance,
	};
}

export function buildRecapMotionMetadata(input: {
	actions: readonly { type: string; description: string }[];
	expressions?: readonly string[];
	dialogues?: readonly DialogueEntry[];
	visualDescription?: string;
}): {
	actions: string[];
	impacts: string[];
	movements: string[];
	soundEffects: string[];
	expressions: string[];
	transitions: string[];
	intensity: number | null;
} {
	const actions = input.actions.map((action) => action.description.trim()).filter(Boolean);
	const impacts = actions.filter((value) => /impact|golpe|ataque|explod|colid|hit|strike|punch|kick/iu.test(value));
	const movements = actions.filter((value) => /mov|corre|salta|cai|anda|foge|run|jump|fall|move/iu.test(value));
	const soundEffects = (input.dialogues ?? []).filter((entry) => entry.contentKind === 'sound_effect' || entry.kind === 'sfx').map((entry) => entry.originalText ?? entry.text).filter(Boolean);
	const transitions = actions.filter((value) => /transi|muda|revela|corta|fade|scene|cen[áa]rio/iu.test(value));
	const intensity = actions.length === 0 ? null : clamp((impacts.length * 0.45 + movements.length * 0.25 + Math.min(1, actions.length / 4) * 0.3));
	return {
		actions: [...new Set(actions)].slice(0, 12),
		impacts: [...new Set(impacts)].slice(0, 8),
		movements: [...new Set(movements)].slice(0, 8),
		soundEffects: [...new Set(soundEffects)].slice(0, 8),
		expressions: [...new Set((input.expressions ?? []).map((value) => value.trim()).filter(Boolean))].slice(0, 8),
		transitions: [...new Set(transitions)].slice(0, 8),
		intensity,
	};
}
