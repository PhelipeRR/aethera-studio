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
