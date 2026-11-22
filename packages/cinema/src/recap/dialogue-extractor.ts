import type { DialogueEntry, DialogueKind, ExtractedPanel, NarrativeEvidence } from './recap-types.js';

const SFX_PATTERNS: readonly RegExp[] = [
	/^(boom|bam|bang|crack|crash|slash|whoosh|swoosh|thud|thump|wham|pow|clang|clank|snap|smack|smash|roar|hiss|drip|zap|swish|fwoosh|rumble|shing|tsk|ugh|grr|ahh|gah|hmm)[!?.~…]*$/i,
	/^[A-ZÀ-Ú]{2,12}[!]{1,}$/,
	/^[ぁ-んァ-ンー]+[!！]*$/,
	/^[가-힣]{1,4}[!！~]*$/,
];

const THOUGHT_PATTERNS: readonly RegExp[] = [
	/^\(.*\)$/,
	/^\.{2,3}\s*.+/,
	/^pensando:\s*/i,
	/^pensamento:\s*/i,
];

const NARRATION_PREFIX_PATTERNS: readonly RegExp[] = [
	/^narra[çc][ãa]o:\s*/i,
	/^\[.*\]$/,
];

const SPEAKER_PREFIX_PATTERN = /^([A-ZÀ-Ú][A-Za-zÀ-ú0-9\s'-]{1,28}):\s+(.+)$/;

function normalizeTextForDedup(text: string): string {
	return text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
}

export function classifyBubbleKind(rawText: string, explicitKind?: DialogueKind, isNarrationFlag?: boolean): DialogueKind {
	if (explicitKind) return explicitKind;
	const trimmed = rawText.trim();
	if (isNarrationFlag) return 'narration';
	if (NARRATION_PREFIX_PATTERNS.some((re) => re.test(trimmed))) return 'narration';
	if (SFX_PATTERNS.some((re) => re.test(trimmed))) return 'sfx';
	if (THOUGHT_PATTERNS.some((re) => re.test(trimmed))) return 'thought';
	const isQuoted = /^["""「『【]/.test(trimmed) || /["""」』】]$/.test(trimmed);
	const isAllCaps = trimmed === trimmed.toUpperCase() && trimmed.length > 2 && /[A-ZÀ-Ú]/.test(trimmed);
	if (!isQuoted && !isAllCaps && trimmed.length > 55) return 'narration';
	return 'dialogue';
}

function cleanBubbleText(text: string): string {
	return text
		.replace(/^(narra[çc][ãa]o|pensamento|pensando|sfx|efeito):\s*/i, '')
		.replace(/^["""「『【\[]|["""」』】\]]$/g, '')
		.replace(/\s+/g, ' ')
		.trim();
}

function detectTextUncertainty(text: string, confidence?: number): string | undefined {
	if (confidence !== undefined && confidence < 0.45) {
		return `Baixa confiança na leitura do texto (${Math.round(confidence * 100)}%).`;
	}
	const garbledChars = (text.match(/[□■?]{2,}|[^\w\sÀ-ú.,!?;:'"()\-…~—–]/g) ?? []).length;
	if (garbledChars >= 3) {
		return 'Texto parcialmente ilegível ou com ruído visual/OCR.';
	}
	return undefined;
}

const VOWEL_PATTERN = /[aeiouáéíóúâêîôûãõàüy]/i;

/**
 * Detects garbled OCR noise (e.g. "a k ie pe", "o. pia ; + : ae pe nia", "1 - y g")
 * that results from Tesseract/fallback OCR misreading artwork, foliage, or stylized SFX.
 */
export function isLikelyOcrGarbage(text: string, uncertainty?: string): boolean {
	const trimmed = text.trim();
	if (!trimmed) return true;

	const tokens = trimmed.split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return true;

	const cleanWordTokens = tokens
		.map((t) => t.replace(/^[^A-Za-zÀ-ú0-9]+|[^A-Za-zÀ-ú0-9]+$/g, ''))
		.filter(Boolean);

	if (cleanWordTokens.length === 0) return true;

	// Count real alphabetic words (>= 3 letters with at least one vowel)
	const realWords = cleanWordTokens.filter(
		(t) => /^[A-Za-zÀ-ú]{3,}$/.test(t) && VOWEL_PATTERN.test(t),
	);
	const tinyFragments = tokens.filter((t) => t.replace(/[^A-Za-zÀ-ú0-9]/g, '').length <= 2);
	const symbolOnlyTokens = tokens.filter((t) => /^[^A-Za-zÀ-ú0-9]+$/.test(t));

	// Multiple stray symbol-only tokens (e.g. "o. pia ; + : ae pe nia", "1 - y g")
	if (symbolOnlyTokens.length >= 2) return true;
	if (/[+|=^_\\<>]/.test(trimmed) && realWords.length < 2) return true;
	// Leading/unmatched OCR punctuation noise like "; NX STAN)"
	if (/^[;:,)\]}|]/.test(trimmed)) return true;

	// Mostly 1-2 character fragments (e.g. "a k ie pe", "1 - y g", "Vea j")
	if (tokens.length >= 3 && tinyFragments.length / tokens.length >= 0.6 && realWords.length <= 1) {
		return true;
	}
	if (tokens.length === 2 && realWords.length <= 1) {
		const hasSingleLetterTail = tokens.some((t) => /^[A-Za-z0-9]$/.test(t));
		if (hasSingleLetterTail) return true;
	}
	// Fragmented ALL-CAPS OCR mixing lone letters/digits (e.g. "WERE ALL OF 3", "E THOSE RANDOM")
	const hasLoneNonWordToken = tokens.some((t) => /^[BCDFGHJKLMNPQRSTVWXYZ0-9]$/.test(t));
	if (hasLoneNonWordToken && trimmed === trimmed.toUpperCase() && tokens.length <= 5) {
		return true;
	}
	if (tokens.length >= 2 && realWords.length === 0) {
		// Allow short valid PT/EN interjections like "Oi!", "Não!", "Sim!", "Quem?", "Ei!"
		const alphaOnly = trimmed.replace(/[^A-Za-zÀ-ú\s]/g, '').trim().toLowerCase();
		if (!/^(oi|ei|n[ãa]o|sim|ok|t[áa]|h[ãa]|eu|tu|ele|ela|j[áa]|v[áa]|vem|vai)(\s+(n[ãa]o|sim|eu|ele|ela|j[áa]|v[áa]))?$/i.test(alphaOnly)) {
			return true;
		}
	}

	// Low-confidence OCR flag from Tesseract + few real words => almost certainly background noise
	const isLowConfidence = Boolean(
		uncertainty && /(baixa confian[çc]a|ru[íi]do visual\/ocr|parcialmente ileg[íi]vel)/i.test(uncertainty),
	);
	if (isLowConfidence) {
		if (realWords.length < 2) return true;
		if (tinyFragments.length / tokens.length >= 0.45) return true;
	}

	return false;
}

/**
 * Extracts structured DialogueEntry items from OCR metadata on an ExtractedPanel.
 * Preserves reading order, distinguishes dialogue/thought/narration/SFX, and
 * records uncertainties rather than guessing missing text.
 */
export function extractStructuredOcrDialogues(panel: ExtractedPanel): {
	dialogues: DialogueEntry[];
	evidence: NarrativeEvidence[];
	uncertainties: string[];
} {
	const dialogues: DialogueEntry[] = [];
	const evidence: NarrativeEvidence[] = [];
	const uncertainties: string[] = [];

	if (panel.metadata.ocrStatus !== 'success' || !panel.metadata.textContent) {
		return { dialogues, evidence, uncertainties };
	}

	const raw = panel.metadata.textContent.trim();
	if (!raw) return { dialogues, evidence, uncertainties };

	const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		let speaker: string | undefined;
		let body = line;

		const speakerMatch = SPEAKER_PREFIX_PATTERN.exec(line);
		if (speakerMatch && speakerMatch[1] && speakerMatch[2]) {
			const candidateSpeaker = speakerMatch[1].trim();
			if (!/^(narra[çc][ãa]o|pensamento|pensando|sfx|efeito)$/i.test(candidateSpeaker)) {
				speaker = candidateSpeaker;
				body = speakerMatch[2].trim();
			}
		}

		const kind = classifyBubbleKind(body);
		const cleaned = cleanBubbleText(body);
		if (!cleaned) continue;

		const uncertainty = detectTextUncertainty(cleaned, panel.metadata.ocrConfidence);
		if (isLikelyOcrGarbage(cleaned, uncertainty)) {
			// Skip pure OCR noise (e.g. background foliage/mountains misread by Tesseract)
			continue;
		}
		if (uncertainty) {
			uncertainties.push(`Balão #${i + 1} (${panel.panelId}): ${uncertainty}`);
		}

		dialogues.push({
			...(speaker ? { speaker } : {}),
			text: cleaned,
			originalText: cleaned,
			kind,
			isNarration: kind === 'narration',
			readingOrder: i,
			...(uncertainty ? { uncertainty } : {}),
		});

		evidence.push({
			kind: 'ocr_text',
			content: line,
			confidence: panel.metadata.ocrConfidence,
			sourcePanelId: panel.panelId,
		});
	}

	return { dialogues, evidence, uncertainties };
}

/**
 * Merges speech bubbles extracted by multimodal Vision with OCR dialogues.
 * - Vision bubbles take priority when both describe the same bubble (since VLM sees speaker + bubble shape + PT-BR translation).
 * - Preserves reading order.
 * - Deduplicates overlapping texts without dropping unique bubbles.
 * - Never fabricates dialogue.
 */
export function mergeVisionAndOcrDialogues(input: {
	visionBubbles?: readonly DialogueEntry[];
	ocrDialogues: readonly DialogueEntry[];
	panelId: string;
}): {
	dialogues: DialogueEntry[];
	uncertainties: string[];
} {
	const merged: DialogueEntry[] = [];
	const seen = new Set<string>();
	const uncertainties: string[] = [];

	const addEntry = (entry: DialogueEntry) => {
		const primaryText = (entry.translatedText?.trim() || entry.text.trim());
		const originalText = (entry.originalText?.trim() || entry.text.trim());
		if (!primaryText && !originalText) return;

		const keyPrimary = normalizeTextForDedup(primaryText);
		const keyOriginal = normalizeTextForDedup(originalText);
		if ((keyPrimary && seen.has(keyPrimary)) || (keyOriginal && seen.has(keyOriginal))) {
			return;
		}
		if (keyPrimary) seen.add(keyPrimary);
		if (keyOriginal) seen.add(keyOriginal);

		const kind = classifyBubbleKind(originalText, entry.kind, entry.isNarration);
		const normalized: DialogueEntry = {
			...(entry.speaker?.trim() ? { speaker: entry.speaker.trim() } : {}),
			text: primaryText || originalText,
			originalText: originalText || primaryText,
			...(entry.translatedText?.trim() ? { translatedText: entry.translatedText.trim() } : {}),
			kind,
			isNarration: kind === 'narration',
			readingOrder: merged.length,
			...(entry.uncertainty ? { uncertainty: entry.uncertainty } : {}),
		};
		if (normalized.uncertainty) {
			uncertainties.push(`Painel ${input.panelId}: ${normalized.uncertainty}`);
		}
		merged.push(normalized);
	};

	const sortedVision = [...(input.visionBubbles ?? [])].sort(
		(a, b) => (a.readingOrder ?? Number.MAX_SAFE_INTEGER) - (b.readingOrder ?? Number.MAX_SAFE_INTEGER),
	);
	for (const bubble of sortedVision) {
		addEntry(bubble);
	}

	const sortedOcr = [...input.ocrDialogues].sort(
		(a, b) => (a.readingOrder ?? Number.MAX_SAFE_INTEGER) - (b.readingOrder ?? Number.MAX_SAFE_INTEGER),
	);
	for (const ocrEntry of sortedOcr) {
		addEntry(ocrEntry);
	}

	return { dialogues: merged, uncertainties };
}
