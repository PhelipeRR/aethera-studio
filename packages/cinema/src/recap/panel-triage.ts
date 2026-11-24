import type {
	ExtractedPanel,
	PanelAnalysis,
	RecapPanelRouteTier,
	RecapPanelTriageCategory,
	RecapPanelTriageOptions,
} from './recap-types.js';

export interface RecapPanelTriageDecision {
	panelId: string;
	ordinal: number;
	categories: RecapPanelTriageCategory[];
	routeTier: RecapPanelRouteTier;
	preserve: true;
	duplicateOf?: string;
	reasons: string[];
}

export interface RecapPanelTriageResult {
	decisions: RecapPanelTriageDecision[];
	stats: {
		total: number;
		local: number;
		economic: number;
		premium: number;
		preserved: number;
	};
}

const DEFAULT_PREMIUM_CATEGORIES: readonly RecapPanelTriageCategory[] = [
	'ambiguous',
	'low_confidence',
	'first_character',
	'scene_change',
];

function normalized(value: string): string {
	return value.trim().toLocaleLowerCase();
}

function addCategory(categories: RecapPanelTriageCategory[], category: RecapPanelTriageCategory): void {
	if (!categories.includes(category)) categories.push(category);
}

/**
 * Deterministic, metadata-only triage. It deliberately never drops a panel and
 * never claims visual facts that are not already present in OCR/analysis data.
 */
export function triageRecapPanels(input: {
	panels: readonly ExtractedPanel[];
	cachedAnalyses?: readonly PanelAnalysis[];
	options?: RecapPanelTriageOptions;
}): RecapPanelTriageResult {
	const options = input.options ?? {};
	const minConfidence = Math.max(0, Math.min(1, options.minConfidence ?? 0.5));
	const cachedById = new Map((input.cachedAnalyses ?? []).map((analysis) => [analysis.panelId, analysis]));
	const seenHashes = new Map<string, string>();
	const seenCharacters = new Set<string>();
	const seenSetting = { value: '' };
	const decisions: RecapPanelTriageDecision[] = [];

	for (let ordinal = 0; ordinal < input.panels.length; ordinal++) {
		const panel = input.panels[ordinal]!;
		const analysis = cachedById.get(panel.panelId);
		const categories: RecapPanelTriageCategory[] = [];
		const reasons: string[] = [];
		let duplicateOf: string | undefined;

		if (panel.imageHash) {
			duplicateOf = seenHashes.get(panel.imageHash);
			if (duplicateOf) {
				addCategory(categories, 'redundant');
				reasons.push(`hash duplicado de ${duplicateOf}`);
			} else {
				seenHashes.set(panel.imageHash, panel.panelId);
			}
		}

		const textContent = panel.metadata.textContent?.trim() ?? '';
		if (panel.metadata.classification === 'dialogue' || textContent.length > 0 || (analysis?.dialogues.length ?? 0) > 0) {
			addCategory(categories, 'dialogue_important');
			reasons.push('texto/OCR ou diálogo presente');
		}
		if (panel.metadata.classification === 'action' || panel.metadata.classification === 'splash' || (analysis?.actions ?? []).some((a) => a.type !== 'none')) {
			addCategory(categories, 'action_relevant');
			reasons.push('classificação ou ação relevante');
		}
		if (panel.metadata.classification === 'transition') {
			addCategory(categories, 'transition');
			reasons.push('transição explícita na extração');
		}
		if (panel.metadata.classification === 'establishing') {
			addCategory(categories, 'scene_change');
			reasons.push('estabelecimento de cenário');
		}
		if (panel.cropFailed) {
			addCategory(categories, 'ambiguous');
			reasons.push('crop indisponível');
		}
		if (analysis) {
			if (analysis.analysisConfidence < minConfidence) {
				addCategory(categories, 'low_confidence');
				reasons.push(`confiança ${analysis.analysisConfidence.toFixed(2)} abaixo de ${minConfidence.toFixed(2)}`);
			}
			if ((analysis.uncertainties?.length ?? 0) > 0) {
				addCategory(categories, 'ambiguous');
				reasons.push('incerteza registrada na análise');
			}
			for (const character of analysis.characters) {
				const key = normalized(character);
				if (key && !seenCharacters.has(key)) {
					addCategory(categories, 'first_character');
					reasons.push(`primeira aparição observada: ${character}`);
				}
				if (key) seenCharacters.add(key);
			}
			const setting = normalized(analysis.setting ?? '');
			if (setting && seenSetting.value && setting !== seenSetting.value) {
				addCategory(categories, 'scene_change');
				reasons.push('mudança de cenário observada');
			}
			if (setting) seenSetting.value = setting;
		}

		if (categories.length === 0) {
			addCategory(categories, 'simple');
			reasons.push('sem sinal local de complexidade');
		}

		const premiumCategories = options.premiumCategories ?? DEFAULT_PREMIUM_CATEGORIES;
		const routeTier: RecapPanelRouteTier =
			(options.enabled === false ? 'premium' : categories.some((category) => premiumCategories.includes(category)) ? 'premium' : duplicateOf ? 'local' : 'economic');
		decisions.push({
			panelId: panel.panelId,
			ordinal,
			categories,
			routeTier,
			preserve: true,
			...(duplicateOf ? { duplicateOf } : {}),
			reasons,
		});
	}

	return {
		decisions,
		stats: {
			total: decisions.length,
			local: decisions.filter((decision) => decision.routeTier === 'local').length,
			economic: decisions.filter((decision) => decision.routeTier === 'economic').length,
			premium: decisions.filter((decision) => decision.routeTier === 'premium').length,
			preserved: decisions.filter((decision) => decision.preserve).length,
		},
	};
}
