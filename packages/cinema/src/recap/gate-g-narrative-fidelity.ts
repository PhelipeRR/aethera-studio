import { existsSync } from 'node:fs';
import type {
	RecapScript,
	GateGReport,
	GateGVerdict,
	GateGFidelityHint,
	ExtractedPanel,
	GateGDivergenceReport,
	HumanizeSceneDiff,
} from './recap-types.js';
import { isGenericNarration, isReviewRequiredPlaceholder, estimateNarrationDurationSec } from './script-generator.js';

export interface GateGInput {
	script: RecapScript;
	panels: ExtractedPanel[];
	/** Minimum scene confidence to auto-approve. Below → needs_review. Default: 0.4. */
	minSceneConfidence?: number;
}

const FUTURE_SPOILER_PATTERNS: readonly RegExp[] = [
	/\bno pr[óo]ximo cap[íi]tulo\b/i,
	/\bcap[íi]tulos? futuros?\b/i,
	/\bmais tarde na obra\b/i,
	/\bno final do mang[áa]\b/i,
	/\bno final do manhwa\b/i,
];

function extractSignificantTokens(text: string): string[] {
	return text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((t) => t.length >= 4);
}

/**
 * Gate G — Narrative Fidelity (Phases 2 & 8)
 *
 * Validates that the generated RecapScript is genuinely faithful to the source panels:
 * - Blocks generic / repeated filler phrases ("A história avançou.", etc.).
 * - Blocks scenes without verifiable narrative content or panel grounding.
 * - Flags ignored important dialogues from extracted speech bubbles.
 * - Detects character inconsistencies, order violations, future-chapter spoilers,
 *   and narration-vs-duration mismatches.
 * - Sends low-confidence / uncertain scenes to human review with panel IDs & uncertainties.
 *
 * Verdicts: pass | needs_review | fail
 */
export function runGateGNarrativeFidelity(input: GateGInput): GateGReport {
	const { script, panels, minSceneConfidence = 0.4 } = input;
	const reasons: string[] = [];
	const hints: GateGFidelityHint[] = [];

	if (script.scenes.length === 0) {
		return {
			gate: 'G_narrative_fidelity',
			verdict: 'fail',
			checkedAtIso: new Date().toISOString(),
			reasons: ['Roteiro sem cenas geradas.'],
			metrics: { sceneCount: 0 },
			hints: [],
		};
	}

	const panelMap = new Map<string, ExtractedPanel>();
	for (const panel of panels) {
		panelMap.set(panel.panelId, panel);
	}

	// ─── 1. Missing or invalid panel references ───────────────────────────────
	let missingPanelRefs = 0;
	let invalidImagePaths = 0;

	for (const scene of script.scenes) {
		if (scene.panelIds.length === 0) {
			missingPanelRefs++;
			hints.push({
				sceneId: scene.sceneId,
				issueCode: 'missing_panel_reference',
				detail: 'Scene has no panel references. Narration cannot be verified against source material.',
			});
			continue;
		}

		for (const panelId of scene.panelIds) {
			const panel = panelMap.get(panelId);
			if (!panel) {
				missingPanelRefs++;
				hints.push({
					sceneId: scene.sceneId,
					issueCode: 'missing_panel_reference',
					detail: `Panel "${panelId}" referenced by scene but not found in extracted panels.`,
				});
			} else if (panel.croppedImagePath && !existsSync(panel.croppedImagePath)) {
				invalidImagePaths++;
				hints.push({
					sceneId: scene.sceneId,
					issueCode: 'invalid_image_path',
					detail: `Cropped image path "${panel.croppedImagePath}" for panel "${panelId}" does not exist on disk.`,
				});
			}
		}
	}

	if (missingPanelRefs > 0) {
		reasons.push(`${missingPanelRefs} referência(s) a painel(is) não encontrada(s) nas cenas.`);
	}
	if (invalidImagePaths > 0) {
		reasons.push(`${invalidImagePaths} caminho(s) de imagem recortada inválido(s) ou inacessível(is).`);
	}

	// ─── 2. Generic / repeated narration & absence of narrative content ───────
	let genericNarrationScenes = 0;
	let insufficientContentScenes = 0;
	let ungroundedScenes = 0;
	let ignoredDialogueScenes = 0;
	let hallucinationHints = 0;
	let durationMismatchScenes = 0;

	const normalizedNarrationMap = new Map<string, Array<{ sceneId: string; panelSignature: string }>>();

	for (const scene of script.scenes) {
		const narration = scene.narrationText.trim();
		const normKey = narration.toLowerCase().replace(/\s+/g, ' ');
		const panelSignature = [...scene.panelIds].sort().join(',');
		const list = normalizedNarrationMap.get(normKey) ?? [];
		list.push({ sceneId: scene.sceneId, panelSignature });
		normalizedNarrationMap.set(normKey, list);

		if (isGenericNarration(narration)) {
			genericNarrationScenes++;
			hints.push({
				sceneId: scene.sceneId,
				issueCode: 'generic_narration',
				detail: `Narração genérica bloqueada ("${narration.slice(0, 80)}"). O roteiro deve descrever os acontecimentos reais dos painéis.`,
			});
		} else if (isReviewRequiredPlaceholder(narration)) {
			insufficientContentScenes++;
			hints.push({
				sceneId: scene.sceneId,
				issueCode: 'insufficient_narrative_content',
				detail: `Cena sem evidência visual/OCR suficiente nos painéis [${scene.panelIds.join(', ')}]. Enviada para revisão humana.`,
			});
		}

		// Ungrounded description: zero confidence with no extracted visual/dialogue evidence yet affirmative text
		const hasAnyVisualOrDialogue =
			Boolean(scene.visualSummary && scene.visualSummary.trim().length > 0) ||
			Boolean(scene.extractedDialogues && scene.extractedDialogues.length > 0) ||
			scene.characters.length > 0;
		if (
			scene.confidence === 0 &&
			!hasAnyVisualOrDialogue &&
			!isReviewRequiredPlaceholder(narration) &&
			!isGenericNarration(narration)
		) {
			ungroundedScenes++;
			hints.push({
				sceneId: scene.sceneId,
				issueCode: 'ungrounded_description',
				detail: `Cena com confiança 0 e sem evidência visual/textual nos painéis [${scene.panelIds.join(', ')}], mas com narração afirmativa.`,
			});
		}

		// Future-chapter spoiler / detectable hallucination check
		if (FUTURE_SPOILER_PATTERNS.some((re) => re.test(narration))) {
			hallucinationHints++;
			hints.push({
				sceneId: scene.sceneId,
				issueCode: 'invented_event',
				detail: 'Narração antecipa acontecimentos fora do capítulo atual.',
			});
		}

		// Important extracted dialogues ignored in narration (ignore SFX, punctuation-only & non-verbal screams)
		const essentialDialogues = (scene.extractedDialogues ?? []).filter((d) => {
			const kind = d.kind ?? (d.isNarration ? 'narration' : 'dialogue');
			if (kind === 'sfx') return false;
			const clean = (d.translatedText ?? d.text).trim();
			const alpha = clean.replace(/[^A-Za-zÀ-ú0-9]/g, '');
			if (alpha.length < 6 || clean.length < 8) return false;
			const words = clean.split(/\s+/).filter(Boolean);
			if (words.length === 1 && /^[aeioughrkc!?.…~\-\s]+$/i.test(clean)) return false;
			return true;
		});
		if (essentialDialogues.length > 0 && !isReviewRequiredPlaceholder(narration)) {
			const narrationTokens = new Set(extractSignificantTokens(narration));
			const anyDialogueReflected = essentialDialogues.some((d) => {
				const dTokens = extractSignificantTokens(d.translatedText ?? d.text);
				if (dTokens.length === 0) return true;
				return dTokens.some((t) => narrationTokens.has(t));
			});
			if (!anyDialogueReflected) {
				ignoredDialogueScenes++;
				hints.push({
					sceneId: scene.sceneId,
					issueCode: 'ignored_dialogue',
					detail: `Diálogo(s) extraído(s) dos balões (${essentialDialogues.map((d) => `"${d.text.slice(0, 40)}"`).join(', ')}) não refletido(s) na narração.`,
				});
			}
		}

		// Duration incompatible with speech length (e.g. fixed 1s for multi-sentence narration)
		if (!isReviewRequiredPlaceholder(narration)) {
			const expectedSec = estimateNarrationDurationSec(narration);
			const effectiveDuration = scene.measuredDurationSec ?? scene.estimatedDurationSec;
			const wordCount = narration.split(/\s+/).filter(Boolean).length;
			if (wordCount >= 10 && (effectiveDuration < expectedSec * 0.35 || effectiveDuration > expectedSec * 3.5)) {
				durationMismatchScenes++;
				hints.push({
					sceneId: scene.sceneId,
					issueCode: 'duration_speech_mismatch',
					detail: `Duração (${effectiveDuration}s) incompatível com o texto narrado (${wordCount} palavras, esperado ~${expectedSec}s).`,
				});
			}
		}
	}

	// Detect exact duplicate narrations across scenes referencing distinct panels
	let duplicatedNarrationScenes = 0;
	for (const [textKey, entries] of normalizedNarrationMap) {
		const distinctPanels = new Set(entries.map((e) => e.panelSignature));
		if (entries.length > 1 && distinctPanels.size > 1 && !textKey.startsWith('[revisão necessária]')) {
			duplicatedNarrationScenes += entries.length;
			for (const entry of entries) {
				hints.push({
					sceneId: entry.sceneId,
					issueCode: 'generic_narration',
					detail: `Narração repetida de forma idêntica em ${entries.length} cenas com painéis distintos ("${textKey.slice(0, 60)}").`,
				});
			}
		}
	}

	if (genericNarrationScenes > 0) {
		reasons.push(`${genericNarrationScenes} cena(s) com narração genérica bloqueada.`);
	}
	if (duplicatedNarrationScenes > 0) {
		reasons.push(`${duplicatedNarrationScenes} cena(s) com narração idêntica repetida.`);
	}
	if (insufficientContentScenes > 0) {
		reasons.push(`${insufficientContentScenes} cena(s) sem conteúdo narrativo verificável (revisão humana necessária).`);
	}
	if (ungroundedScenes > 0) {
		reasons.push(`${ungroundedScenes} cena(s) com descrição sem relação comprovada com os painéis.`);
	}
	if (hallucinationHints > 0) {
		reasons.push(`${hallucinationHints} indício(s) de antecipação ou evento inventado fora do capítulo.`);
	}
	if (ignoredDialogueScenes > 0) {
		reasons.push(`${ignoredDialogueScenes} cena(s) com diálogos importantes dos balões não incorporados na narração.`);
	}
	if (durationMismatchScenes > 0) {
		reasons.push(`${durationMismatchScenes} cena(s) com duração incompatível com a fala.`);
	}

	// ─── 3. Character consistency across consecutive scenes ───────────────────
	let characterInconsistencies = 0;

	for (let i = 1; i < script.scenes.length; i++) {
		const prev = script.scenes[i - 1]!;
		const curr = script.scenes[i]!;

		if (prev.characters.length === 0 || curr.characters.length === 0) continue;

		const prevChars = new Set(prev.characters.map((c) => c.toLowerCase()));
		const currChars = new Set(curr.characters.map((c) => c.toLowerCase()));
		const hasShared = [...prevChars].some((c) => currChars.has(c));

		if (!hasShared && prevChars.size > 1 && currChars.size > 1) {
			characterInconsistencies++;
			hints.push({
				sceneId: curr.sceneId,
				issueCode: 'character_inconsistency',
				detail: `No shared characters between scene ${i - 1} (${prev.sceneId}: [${prev.characters.join(', ')}]) and scene ${i} (${curr.sceneId}: [${curr.characters.join(', ')}]). Possible continuity break or unmarked scene transition.`,
			});
		}
	}

	if (characterInconsistencies > 0) {
		reasons.push(`${characterInconsistencies} inconsistência(s) de personagem entre cenas consecutivas.`);
	}

	// ─── 4. Scene order vs panel reading order ────────────────────────────────
	let orderViolations = 0;

	for (let i = 1; i < script.scenes.length; i++) {
		const prev = script.scenes[i - 1]!;
		const curr = script.scenes[i]!;

		const prevMinPage = Math.min(
			...prev.panelIds.map((pid) => {
				const p = panelMap.get(pid);
				return p?.metadata.pageNumber ?? Infinity;
			}),
		);
		const currMinPage = Math.min(
			...curr.panelIds.map((pid) => {
				const p = panelMap.get(pid);
				return p?.metadata.pageNumber ?? Infinity;
			}),
		);

		if (currMinPage < prevMinPage && prevMinPage !== Infinity && currMinPage !== Infinity) {
			orderViolations++;
			hints.push({
				sceneId: curr.sceneId,
				issueCode: 'order_violation',
				detail: `Scene ${i} references page ${currMinPage} which precedes scene ${i - 1}'s page ${prevMinPage}. Narrative order may not match reading order.`,
			});
		}
	}

	if (orderViolations > 0) {
		reasons.push(`${orderViolations} violação(ões) na ordem das cenas em relação à ordem de leitura.`);
	}

	// ─── 5. Low confidence scenes ─────────────────────────────────────────────
	let lowConfidenceScenes = 0;

	for (const scene of script.scenes) {
		if (scene.confidence < minSceneConfidence) {
			lowConfidenceScenes++;
			hints.push({
				sceneId: scene.sceneId,
				issueCode: 'low_confidence',
				detail: `Scene confidence ${scene.confidence.toFixed(2)} below threshold ${minSceneConfidence}. Narration reliability is uncertain.`,
			});
		}
	}

	if (lowConfidenceScenes > 0) {
		reasons.push(`${lowConfidenceScenes} cena(s) com confiança abaixo do limiar (${minSceneConfidence}).`);
	}

	// ─── 6. Unresolved ambiguities (scenes marked needs_review) ───────────────
	let unresolvedAmbiguities = 0;

	for (const scene of script.scenes) {
		if (scene.reviewStatus === 'needs_review') {
			unresolvedAmbiguities++;
			hints.push({
				sceneId: scene.sceneId,
				issueCode: 'unresolved_ambiguity',
				detail: `Scene marked for review: ${scene.reviewNotes ?? 'No details provided'}`,
			});
		}
	}

	if (unresolvedAmbiguities > 0) {
		reasons.push(`${unresolvedAmbiguities} cena(s) marcada(s) para revisão humana.`);
	}

	// ─── 7. Narrative gaps (from script warnings) ─────────────────────────────
	const narrativeGaps = (script.warnings ?? []).filter((w) =>
		w.toLowerCase().includes('gap') || w.toLowerCase().includes('lacuna'),
	).length;

	if (narrativeGaps > 0) {
		reasons.push(`${narrativeGaps} lacuna(s) narrativa(s) detectada(s) pelo Story Engine.`);
	}

	// ─── Determine verdict ────────────────────────────────────────────────────
	const allScenesInsufficient = insufficientContentScenes === script.scenes.length;
	const hasCriticalIssues =
		missingPanelRefs > 0 ||
		orderViolations > 0 ||
		genericNarrationScenes > 0 ||
		duplicatedNarrationScenes > 0 ||
		allScenesInsufficient ||
		ungroundedScenes > 0 ||
		hallucinationHints > 0 ||
		durationMismatchScenes > 0;

	const hasReviewIssues =
		invalidImagePaths > 0 ||
		insufficientContentScenes > 0 ||
		ignoredDialogueScenes > 0 ||
		characterInconsistencies > 0 ||
		lowConfidenceScenes > 0 ||
		unresolvedAmbiguities > 0 ||
		narrativeGaps > 0;

	let verdict: GateGVerdict;
	if (hasCriticalIssues) {
		verdict = 'fail';
	} else if (hasReviewIssues) {
		verdict = 'needs_review';
	} else {
		verdict = 'pass';
	}

	return {
		gate: 'G_narrative_fidelity',
		verdict,
		checkedAtIso: new Date().toISOString(),
		reasons,
		metrics: {
			sceneCount: script.scenes.length,
			missingPanelRefs,
			invalidImagePaths,
			genericNarrationScenes,
			duplicatedNarrationScenes,
			insufficientContentScenes,
			ungroundedScenes,
			ignoredDialogueScenes,
			hallucinationHints,
			durationMismatchScenes,
			characterInconsistencies,
			orderViolations,
			lowConfidenceScenes,
			unresolvedAmbiguities,
			narrativeGaps,
			minSceneConfidence,
		},
		hints,
	};
}

/**
 * Builds a structured divergence and evidence report comparing Gate G before
 * and after humanization.
 */
export function buildGateGDivergenceReport(
	pre: GateGReport,
	post: GateGReport,
	diffs: readonly HumanizeSceneDiff[],
): GateGDivergenceReport {
	const preHintKeys = new Set(pre.hints.map((h) => `${h.sceneId ?? ''}:${h.issueCode}:${h.detail}`));
	const newHintsAfterHumanize = post.hints.filter(
		(h) => !preHintKeys.has(`${h.sceneId ?? ''}:${h.issueCode}:${h.detail}`),
	);
	const revertReasons = diffs
		.filter((d) => d.reverted)
		.map((d) => ({ sceneId: d.sceneId, reason: d.revertReason ?? 'reverted' }));
	const modifiedScenes = diffs.filter((d) => !d.reverted && d.humanizedText !== d.originalText).length;

	return {
		preVerdict: pre.verdict,
		postVerdict: post.verdict,
		totalScenes: Number(post.metrics['sceneCount'] ?? diffs.length),
		modifiedScenes,
		revertedScenes: revertReasons.length,
		revertReasons,
		newHintsAfterHumanize,
		evidencePreserved: post.verdict !== 'fail' && newHintsAfterHumanize.length === 0,
	};
}
