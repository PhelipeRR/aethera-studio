/**
 * Narrative Humanizer — Phase 2.2.1-B
 *
 * Improves narration naturalness in PT-BR while preserving facts, characters,
 * panel references, duration and narrative order. Designed as a shared module
 * reusable by both Aethera Recap and Aethera Studio.
 *
 * KEY GUARANTEES:
 * - Never invents events, dialogues or characters not present in the original script.
 * - Preserves panelReferences (panelIds, croppedImagePaths) exactly.
 * - Respects duration budget (±maxDurationDeviation).
 * - Runs Gate G after humanization; reverts scenes that diverge.
 * - Works with any agent via TextEnhancementPort (no hardcoded provider).
 * - Returns original script unchanged when disabled or when no agent is available.
 */

import type {
	RecapScript,
	Scene,
	GateGReport,
	HumanizeOptions,
	HumanizeResult,
	HumanizeSceneDiff,
	TextEnhancementPort,
	TextEnhancementRequest,
	ExtractedPanel,
} from './recap-types.js';
import { runGateGNarrativeFidelity } from './gate-g-narrative-fidelity.js';
import { isGenericNarration, isReviewRequiredPlaceholder, estimateNarrationDurationSec } from './script-generator.js';

// ─── System Prompt Template ──────────────────────────────────────────────────

const HUMANIZE_SYSTEM_PROMPT = `Você é um criador de conteúdo brasileiro contando a história de um mangá/manhwa de forma simples, conversacional, fluida e cronológica.

REGRAS OBRIGATÓRIAS:
1. Priorize ações, acontecimentos, diálogos reais e continuidade. Não invente nada novo.
2. Preserve TODOS os acontecimentos principais, nomes confirmados e diálogos relevantes entre aspas na ordem cronológica.
3. Mantenha o estilo "{style}" ({styleDescription}).
4. Remova detalhes supérfluos (névoa, roupas, cabelo, poeira, folhas, iluminação, expressões) quando não forem importantes para entender a história, e elimine qualquer linguagem de análise visual ("o painel apresenta", "plano geral", "a imagem sugere").
5. Não estabeleça um limite artificial de palavras nem infle o texto: conte toda a história da cena sem enrolação, deixando o tamanho ser consequência natural dos acontecimentos e diálogos.
6. Use conectivos conversacionais naturais ("então", "mas", "nesse momento", "logo depois") sem repetir o mesmo fato com palavras diferentes.
7. NÃO altere IDs, referências a painéis ou metadados estruturais.
8. Se não conseguir melhorar sem alterar fatos, retorne o texto original.

Responda APENAS com JSON no formato: {"humanizedText": "..."}
`;

function getStyleDescription(style: string): string {
	switch (style) {
		case 'natural_recap': return 'narração natural, simples, fluida e concisa como um criador de conteúdo contando a história';
		case 'narrative_recap': return 'narração descritiva e clara';
		case 'cinematic_recap': return 'narração cinematográfica com ritmo visual';
		case 'mystery': return 'narração com suspense e revelações graduais';
		case 'suspense': return 'narração tensa com clímax progressivo';
		case 'documentary': return 'narração factual e informativa';
		default: return 'narração natural em português brasileiro';
	}
}

// ─── Duration Validation ─────────────────────────────────────────────────────

function estimateDurationSec(text: string): number {
	// ~2.5 words/sec for PT-BR narration
	const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
	return wordCount / 2.5;
}

function isDurationWithinBudget(
	originalDuration: number,
	humanizedText: string,
	maxDeviation: number,
	allowConciseShortening = false,
): boolean {
	const humanizedDuration = estimateDurationSec(humanizedText);
	if (originalDuration <= 0) return true;
	if (allowConciseShortening) {
		// In natural_recap, shortening verbose descriptions is desired; only block artificial inflation or empty output
		const wordCount = humanizedText.trim().split(/\s+/).filter(Boolean).length;
		if (wordCount < 4) return false;
		return humanizedDuration <= originalDuration * (1 + maxDeviation);
	}
	const deviation = Math.abs(humanizedDuration - originalDuration) / originalDuration;
	return deviation <= maxDeviation;
}

// ─── Structural Integrity Check ─────────────────────────────────────────────

interface StructuralCheck {
	ok: boolean;
	reason?: string;
}

function extractFactualTokens(text: string): string[] {
	return text
		.toLowerCase()
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-z0-9\s]/g, ' ')
		.split(/\s+/)
		.filter((t) => t.length >= 4);
}

function isVisualDescriptorPlaceholder(name: string): boolean {
	return name.trim().length > 26 || /\b(de cabelos|em t[úu]nica|com faixa|de manto|vestindo)\b/i.test(name);
}

function checkStructuralIntegrity(original: Scene, humanizedText: string, isNaturalStyle = false): StructuralCheck {
	// Reject generic filler replacement
	if (isGenericNarration(humanizedText)) {
		return { ok: false, reason: 'Humanized text replaced scene narration with a generic filler phrase.' };
	}

	// Verify that confirmed named characters explicitly mentioned in the original narration are preserved
	const originalLower = original.narrationText.toLowerCase();
	const humanizedLower = humanizedText.toLowerCase();
	for (const charName of original.characters) {
		if (isNaturalStyle && isVisualDescriptorPlaceholder(charName)) continue;
		const normalized = charName.trim().toLowerCase();
		if (normalized.length >= 2 && originalLower.includes(normalized) && !humanizedLower.includes(normalized)) {
			return { ok: false, reason: `Humanized text omitted character "${charName}" present in original narration.` };
		}
	}

	// Check for hallucinated dialogue markers
	if (humanizedText.includes('"') && !original.narrationText.includes('"')) {
		return { ok: false, reason: 'Humanized text introduced dialogue quotes not present in original.' };
	}

	// Verify essential extracted dialogues were not dropped (ignore SFX & non-verbal screams)
	const essentialDialogues = (original.extractedDialogues ?? []).filter((d) => {
		const kind = d.kind ?? (d.isNarration ? 'narration' : 'dialogue');
		if (kind === 'sfx') return false;
		const clean = (d.translatedText ?? d.text).trim();
		const alpha = clean.replace(/[^A-Za-zÀ-ú0-9]/g, '');
		if (alpha.length < 4 || clean.length < 8) return false;
		const words = clean.split(/\s+/).filter(Boolean);
		if (words.length === 1 && /^[aeioughrkc!?.…~\-\s]+$/i.test(clean)) return false;
		return true;
	});
	if (essentialDialogues.length > 0) {
		const humTokens = new Set(extractFactualTokens(humanizedText));
		const origTokens = new Set(extractFactualTokens(original.narrationText));
		for (const d of essentialDialogues) {
			const dTokens = extractFactualTokens(d.translatedText ?? d.text);
			const wasInOriginal = dTokens.some((t) => origTokens.has(t));
			const stillInHumanized = dTokens.some((t) => humTokens.has(t));
			if (wasInOriginal && !stillInHumanized) {
				return { ok: false, reason: `Humanized text omitted essential dialogue "${d.text.slice(0, 50)}".` };
			}
		}
	}

	// Detect severe factual information loss on non-natural verbose scenes
	if (!isNaturalStyle) {
		const originalWords = original.narrationText.trim().split(/\s+/).filter(Boolean).length;
		if (originalWords >= 12) {
			const origFactual = [...new Set(extractFactualTokens(original.narrationText))];
			if (origFactual.length >= 5) {
				const humFactual = new Set(extractFactualTokens(humanizedText));
				const preservedCount = origFactual.filter((t) => humFactual.has(t)).length;
				const preservationRatio = preservedCount / origFactual.length;
				if (preservationRatio < 0.3) {
					return {
						ok: false,
						reason: `Humanized text lost too much factual information (preservation ratio ${Math.round(preservationRatio * 100)}%).`,
					};
				}
			}
		}
	}

	return { ok: true };
}

// ─── Main Humanizer Function ─────────────────────────────────────────────────

export interface RunNarrativeHumanizerInput {
	script: RecapScript;
	panels: ExtractedPanel[];
	options: HumanizeOptions & { port: TextEnhancementPort };
}

/**
 * Humanizes a RecapScript's narration while preserving structural integrity.
 *
 * Pipeline per scene:
 * 1. Call TextEnhancementPort with original narration + context.
 * 2. Validate duration budget.
 * 3. Check structural integrity (no invented content).
 * 4. If valid, apply humanized text; otherwise revert to original.
 * 5. After all scenes, run Gate G on the result.
 * 6. If Gate G fails, revert ALL humanized scenes and return original.
 */
export async function runNarrativeHumanizer(input: RunNarrativeHumanizerInput): Promise<HumanizeResult> {
	const { script, panels, options } = input;
	const warnings: string[] = [];
	const diffs: HumanizeSceneDiff[] = [];

	// Skip when disabled
	if (!options.enabled) {
		const gateG = runGateGNarrativeFidelity({ script, panels });
		return {
			script,
			diffs: [],
			postHumanizeGateG: gateG,
			agentId: 'none',
			model: null,
			warnings: ['Humanize disabled; returning original script.'],
			skipped: true,
		};
	}

	const maxDeviation = options.maxDurationDeviation ?? 0.10;
	let agentId = 'none';
	let model: string | null = null;
	let anySucceeded = false;

	// Clone scenes to avoid mutating the original
	const humanizedScenes: Scene[] = script.scenes.map((scene) => ({ ...scene }));

	for (let i = 0; i < humanizedScenes.length; i++) {
		const scene = humanizedScenes[i]!;
		const originalText = scene.narrationText;

		// Only humanize scenes that already have a valid factual narration
		if (isReviewRequiredPlaceholder(originalText) || isGenericNarration(originalText)) {
			warnings.push(`Scene ${scene.sceneId}: skipped humanization because scene lacks valid factual narration.`);
			diffs.push({
				sceneId: scene.sceneId,
				originalText,
				humanizedText: originalText,
				reverted: true,
				revertReason: 'no_valid_factual_narration',
			});
			continue;
		}

		if (options.signal?.aborted) {
			warnings.push(`Humanize aborted at scene ${i + 1}/${humanizedScenes.length}.`);
			break;
		}

		try {
			const isNaturalStyle = options.style === 'natural_recap';
			const systemPrompt = HUMANIZE_SYSTEM_PROMPT
				.replace('{style}', options.style)
				.replace('{styleDescription}', getStyleDescription(options.style));

			const enhanceInput: TextEnhancementRequest = {
				text: originalText,
				context: {
					sceneId: scene.sceneId,
					characters: scene.characters,
					eventDescription: scene.eventDescription,
					panelIds: scene.panelIds,
					estimatedDurationSec: scene.estimatedDurationSec,
					emotion: scene.emotion,
					narrativeIntent: scene.narrativeIntent,
				},
				systemPrompt,
				outputSchema: {
					type: 'object',
					properties: { humanizedText: { type: 'string' } },
					required: ['humanizedText'],
					additionalProperties: false,
				},
			};
			if (options.signal) enhanceInput.signal = options.signal;
			const result = await options.port.enhance(enhanceInput);

			if (!result.ok) {
				warnings.push(`Scene ${scene.sceneId}: enhancement failed — ${result.error ?? 'unknown error'}. Keeping original.`);
				const failDiff: HumanizeSceneDiff = { sceneId: scene.sceneId, originalText, humanizedText: originalText, reverted: true };
				if (result.error) failDiff.revertReason = result.error;
				diffs.push(failDiff);
				continue;
			}

			agentId = result.agentId;
			model = result.model;

			// Parse the structured response
			let humanizedText: string;
			try {
				const parsed = JSON.parse(result.text);
				humanizedText = typeof parsed.humanizedText === 'string' ? parsed.humanizedText : originalText;
			} catch {
				// Agent returned raw text instead of JSON — use it directly if non-empty
				humanizedText = result.text.trim().length > 0 ? result.text.trim() : originalText;
			}

			// Check structural integrity BEFORE duration to catch invented content first
			const structuralCheck = checkStructuralIntegrity(scene, humanizedText, isNaturalStyle);
			if (!structuralCheck.ok) {
				warnings.push(`Scene ${scene.sceneId}: structural integrity violation — ${structuralCheck.reason}. Reverting.`);
				const structDiff: HumanizeSceneDiff = { sceneId: scene.sceneId, originalText, humanizedText: originalText, reverted: true };
				if (structuralCheck.reason) structDiff.revertReason = structuralCheck.reason;
				diffs.push(structDiff);
				continue;
			}

			// Validate duration (natural_recap allows concise shortening without artificial inflation)
			if (!isDurationWithinBudget(scene.estimatedDurationSec, humanizedText, maxDeviation, isNaturalStyle)) {
				warnings.push(`Scene ${scene.sceneId}: humanized text exceeds duration budget (±${Math.round(maxDeviation * 100)}%). Reverting.`);
				const durationDiff: HumanizeSceneDiff = { sceneId: scene.sceneId, originalText, humanizedText: originalText, reverted: true, revertReason: 'duration_budget_exceeded' };
				diffs.push(durationDiff);
				continue;
			}

			// Apply humanized text and update estimated duration
			const updatedDuration = estimateNarrationDurationSec(humanizedText);
			humanizedScenes[i] = {
				...scene,
				narrationText: humanizedText,
				estimatedDurationSec: updatedDuration,
				durationSource: 'estimated',
			};
			anySucceeded = true;
			diffs.push({ sceneId: scene.sceneId, originalText, humanizedText, reverted: false });
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			warnings.push(`Scene ${scene.sceneId}: unexpected error during humanization — ${msg}. Keeping original.`);
			diffs.push({ sceneId: scene.sceneId, originalText, humanizedText: originalText, reverted: true, revertReason: msg });
		}
	}

	// Build the humanized script
	const humanizedScript: RecapScript = {
		...script,
		scenes: humanizedScenes,
		generatedBy: `${script.generatedBy}+humanize-${agentId}`,
		warnings: [...(script.warnings ?? []), ...warnings],
	};

	// Run Gate G on the humanized script
	const postGateG = runGateGNarrativeFidelity({ script: humanizedScript, panels });

	// If Gate G fails after humanization, revert ALL changes
	if (postGateG.verdict === 'fail') {
		warnings.push('Gate G FAILED after humanization. Reverting all humanized scenes to original.');
		for (const diff of diffs) {
			if (!diff.reverted) {
				diff.reverted = true;
				diff.revertReason = 'gate_g_fail_post_humanize';
				diff.humanizedText = diff.originalText;
			}
		}
		return {
			script, // Return original
			diffs,
			postHumanizeGateG: runGateGNarrativeFidelity({ script, panels }),
			agentId,
			model,
			warnings,
			skipped: false,
		};
	}

	// If Gate G says needs_review, mark affected scenes
	if (postGateG.verdict === 'needs_review') {
		for (const hint of postGateG.hints) {
			if (hint.sceneId) {
				const diff = diffs.find((d) => d.sceneId === hint.sceneId);
				if (diff && !diff.reverted) {
					const sceneIdx = humanizedScenes.findIndex((s) => s.sceneId === hint.sceneId);
					if (sceneIdx >= 0) {
						humanizedScenes[sceneIdx] = { ...humanizedScenes[sceneIdx]!, reviewStatus: 'needs_review', reviewNotes: hint.detail };
					}
				}
			}
		}
	}

	return {
		script: { ...humanizedScript, scenes: humanizedScenes },
		diffs,
		postHumanizeGateG: postGateG,
		agentId,
		model,
		warnings,
		skipped: !anySucceeded,
	};
}