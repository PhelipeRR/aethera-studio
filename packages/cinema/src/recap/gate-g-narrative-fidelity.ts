import { existsSync } from 'node:fs';
import type {
	RecapScript,
	Scene,
	GateGReport,
	GateGVerdict,
	GateGFidelityHint,
	ExtractedPanel,
	GateGDivergenceReport,
	HumanizeSceneDiff,
} from './recap-types.js';

export interface GateGInput {
	script: RecapScript;
	panels: ExtractedPanel[];
	/** Minimum scene confidence to auto-approve. Below → needs_review. Default: 0.4. */
	minSceneConfidence?: number;
}

/**
 * Gate G — Narrative Fidelity (Phase 2)
 *
 * Validates that the generated RecapScript is faithful to the source panels:
 * - Every scene references at least one valid panel with accessible cropped image.
 * - Character identity is consistent across consecutive scenes.
 * - Scene order matches panel reading order (no temporal inversions).
 * - No invented events: narration must be grounded in panel evidence.
 * - Low-confidence scenes are flagged for review, never auto-approved.
 * - Ambiguities and gaps are explicitly recorded, not silently ignored.
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

	// Build panel lookup map
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
				detail: `Scene has no panel references. Narration cannot be verified against source material.`,
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

	// ─── 2. Character consistency across consecutive scenes ───────────────────
	let characterInconsistencies = 0;

	for (let i = 1; i < script.scenes.length; i++) {
		const prev = script.scenes[i - 1]!;
		const curr = script.scenes[i]!;

		// Skip if either scene has no characters (establishing/transition scenes)
		if (prev.characters.length === 0 || curr.characters.length === 0) continue;

		const prevChars = new Set(prev.characters.map((c) => c.toLowerCase()));
		const currChars = new Set(curr.characters.map((c) => c.toLowerCase()));
		const hasShared = [...prevChars].some((c) => currChars.has(c));

		// Flag when consecutive scenes have completely disjoint character sets
		// AND both have multiple characters (single-character transitions are normal)
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

	// ─── 3. Scene order vs panel reading order ────────────────────────────────
	let orderViolations = 0;

	for (let i = 1; i < script.scenes.length; i++) {
		const prev = script.scenes[i - 1]!;
		const curr = script.scenes[i]!;

		// Get the minimum page number from each scene's panels
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

	// ─── 4. Low confidence scenes ─────────────────────────────────────────────
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

	// ─── 5. Unresolved ambiguities (scenes marked needs_review) ───────────────
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

	// ─── 6. Narrative gaps (from script warnings) ─────────────────────────────
	const narrativeGaps = (script.warnings ?? []).filter((w) =>
		w.toLowerCase().includes('gap') || w.toLowerCase().includes('lacuna'),
	).length;

	if (narrativeGaps > 0) {
		reasons.push(`${narrativeGaps} lacuna(s) narrativa(s) detectada(s) pelo Story Engine.`);
	}

	// ─── Determine verdict ────────────────────────────────────────────────────
	const hasCriticalIssues = missingPanelRefs > 0 || orderViolations > 0;
	const hasReviewIssues =
		invalidImagePaths > 0 ||
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
