import type { PanelAnalysis, RecapNarrativeMemory } from './recap-types.js';

const MAX_CHARACTERS = 12;
const MAX_EVENTS = 3;
const MAX_EVENT_LENGTH = 180;
const MAX_QUESTIONS = 4;

function clean(value: string): string {
	return value.replace(/\s+/g, ' ').trim();
}

function bounded(value: string | undefined, max: number): string | undefined {
	const result = clean(value ?? '');
	return result.length > 0 ? result.slice(0, max) : undefined;
}

export function createNarrativeMemory(initialCharacters: readonly string[] = []): RecapNarrativeMemory {
	return {
		version: 'recap-memory-v1',
		characters: [...new Set(initialCharacters.map(clean).filter(Boolean))].slice(0, MAX_CHARACTERS),
		recentEvents: [],
		openQuestions: [],
	};
}

/** Builds the next bounded memory snapshot without retaining chapter history. */
export function updateNarrativeMemory(memory: RecapNarrativeMemory, analysis: PanelAnalysis): RecapNarrativeMemory {
	const characters = [...memory.characters];
	for (const character of analysis.characters) {
		const value = clean(character);
		if (value && !characters.some((existing) => existing.toLocaleLowerCase() === value.toLocaleLowerCase())) characters.push(value);
	}
	const action = analysis.actions.find((candidate) => candidate.type !== 'none')?.description;
	const dialogue = analysis.dialogues.find((entry) => !entry.isNarration)?.translatedText ?? analysis.dialogues[0]?.text;
	const event = bounded([analysis.setting, action, dialogue].filter(Boolean).join(' — '), MAX_EVENT_LENGTH);
	const recentEvents = event ? [...memory.recentEvents, event].slice(-MAX_EVENTS) : [...memory.recentEvents];
	const questions = [...memory.openQuestions];
	for (const uncertainty of analysis.uncertainties ?? []) {
		const value = bounded(uncertainty, MAX_EVENT_LENGTH);
		if (value && !questions.includes(value)) questions.push(value);
	}
	const currentSetting = bounded(analysis.setting, 120) ?? memory.currentSetting;
	return {
		version: 'recap-memory-v1',
		characters: characters.slice(-MAX_CHARACTERS),
		recentEvents,
		...(currentSetting ? { currentSetting } : {}),
		openQuestions: questions.slice(-MAX_QUESTIONS),
		lastPanelId: analysis.panelId,
	};
}

export function estimateContextTokens(value: unknown): number {
	return Math.ceil(JSON.stringify(value).length / 4);
}
