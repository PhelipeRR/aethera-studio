/**
 * Aethera Recap — Phases 4.4 & 5.4: Prompt-Based Incremental Revision & Dependency Graph
 *
 * Interprets natural-language editorial revision requests in PT-BR, computes an
 * explicit Impact Plan using a deterministic stage dependency graph, and applies
 * localized mutations so only affected stages/scenes are reprocessed.
 */

import type { Emotion, RecapScript } from '../recap-types.js';
import type { RecapAudiovisualPlan, RecapMotionStyle } from '../phase3/recap-audiovisual-types.js';

export type RecapPipelineDependencyNode =
	| 'script'
	| 'pronunciation'
	| 'audio_sync'
	| 'captions'
	| 'visual_plan'
	| 'shot_render'
	| 'audio_mix'
	| 'mux_mp4'
	| 'gate_h';

export const RECAP_DEPENDENCY_GRAPH: Readonly<Record<RecapPipelineDependencyNode, readonly RecapPipelineDependencyNode[]>> = {
	script: ['audio_sync', 'captions', 'visual_plan', 'shot_render', 'audio_mix', 'mux_mp4', 'gate_h'],
	pronunciation: ['audio_sync', 'captions', 'audio_mix', 'mux_mp4', 'gate_h'],
	audio_sync: ['captions', 'visual_plan', 'shot_render', 'audio_mix', 'mux_mp4', 'gate_h'],
	captions: ['mux_mp4', 'gate_h'],
	visual_plan: ['shot_render', 'mux_mp4', 'gate_h'],
	shot_render: ['mux_mp4', 'gate_h'],
	audio_mix: ['mux_mp4', 'gate_h'],
	mux_mp4: ['gate_h'],
	gate_h: [],
};

export type RevisionIntentKind =
	| 'increase_drama'
	| 'swap_panel'
	| 'adjust_music_ducking'
	| 'fix_pronunciation'
	| 'adjust_duration'
	| 'unknown';

export interface RecapRevisionAction {
	kind: RevisionIntentKind;
	targetSceneId?: string;
	newPanelId?: string;
	musicDeltaDb?: number;
	duckingDeltaDb?: number;
	pronunciationFrom?: string;
	pronunciationTo?: string;
	durationDeltaSec?: number;
	description: string;
}

export interface RecapRevisionImpactPlan {
	prompt: string;
	understood: boolean;
	actions: RecapRevisionAction[];
	affectedSceneIds: string[];
	reprocessStages: RecapPipelineDependencyNode[];
	reusedStages: RecapPipelineDependencyNode[];
	/** Ratio of shots that need re-encoding (0.0 = zero video re-encode, 1.0 = full re-encode). */
	estimatedVideoReworkRatio: number;
	summary: string;
}

const ALL_STAGES: readonly RecapPipelineDependencyNode[] = [
	'script',
	'pronunciation',
	'audio_sync',
	'captions',
	'visual_plan',
	'shot_render',
	'audio_mix',
	'mux_mp4',
	'gate_h',
];

function expandDownstream(roots: readonly RecapPipelineDependencyNode[]): RecapPipelineDependencyNode[] {
	const visited = new Set<RecapPipelineDependencyNode>();
	const queue = [...roots];
	while (queue.length > 0) {
		const node = queue.shift()!;
		if (visited.has(node)) continue;
		visited.add(node);
		for (const dep of RECAP_DEPENDENCY_GRAPH[node]) {
			if (!visited.has(dep)) queue.push(dep);
		}
	}
	return ALL_STAGES.filter((s) => visited.has(s));
}

function resolveTargetSceneId(prompt: string, script: RecapScript): string | undefined {
	const numMatch = /\bcena\s*#?(\d+)\b/i.exec(prompt);
	if (numMatch?.[1]) {
		const idx = Number.parseInt(numMatch[1], 10) - 1;
		if (idx >= 0 && idx < script.scenes.length) return script.scenes[idx]!.sceneId;
	}
	for (const scene of script.scenes) {
		if (prompt.toLowerCase().includes(scene.sceneId.toLowerCase())) return scene.sceneId;
	}
	return script.scenes[0]?.sceneId;
}

/**
 * Parses a natural-language PT-BR revision prompt and computes the exact
 * incremental Impact Plan before reprocessing any component.
 */
export function planRecapRevisionImpact(input: {
	prompt: string;
	script: RecapScript;
	plan?: RecapAudiovisualPlan;
	availablePanelIds?: readonly string[];
}): RecapRevisionImpactPlan {
	const { prompt, script, plan, availablePanelIds = [] } = input;
	const lower = prompt.toLowerCase();
	const actions: RecapRevisionAction[] = [];
	const rootStages: RecapPipelineDependencyNode[] = [];
	const affectedScenes = new Set<string>();
	const targetSceneId = resolveTargetSceneId(prompt, script);

	// 1. Drama / pacing / emotion
	if (/dram[áa]tic|intenso|impacto|tenso|cl[íi]max/i.test(lower)) {
		if (targetSceneId) affectedScenes.add(targetSceneId);
		rootStages.push('visual_plan', 'audio_mix');
		actions.push({
			kind: 'increase_drama',
			...(targetSceneId ? { targetSceneId } : {}),
			description: `Aumentar intensidade dramática na cena ${targetSceneId ?? 'selecionada'} (movimento impact_push + SFX de impacto).`,
		});
	}

	// 2. Panel swap
	if (/tro(?:que|car)|substitu(?:a|ir).*painel|outro painel/i.test(lower)) {
		if (targetSceneId) affectedScenes.add(targetSceneId);
		const panelMention = /painel\s*#?([a-z0-9_-]+)/i.exec(prompt)?.[1];
		const currentScene = script.scenes.find((s) => s.sceneId === targetSceneId);
		const fallbackPanel = availablePanelIds.find((pid) => !currentScene?.panelIds.includes(pid));
		const newPanelId = panelMention && availablePanelIds.includes(panelMention) ? panelMention : fallbackPanel;
		rootStages.push('visual_plan');
		actions.push({
			kind: 'swap_panel',
			...(targetSceneId ? { targetSceneId } : {}),
			...(newPanelId ? { newPanelId } : {}),
			description: `Substituir painel da cena ${targetSceneId ?? 'selecionada'}${newPanelId ? ` para "${newPanelId}"` : ''}.`,
		});
	}

	// 3. Music / narration balance (zero video re-encode!)
	if (/m[úu]sica|trilha|narra[çc][ãa]o|volume|ducking/i.test(lower)) {
		rootStages.push('audio_mix');
		actions.push({
			kind: 'adjust_music_ducking',
			musicDeltaDb: /reduz|diminu|abaix|menos m[úu]sica/i.test(lower) ? -4 : 2,
			duckingDeltaDb: /desta(?:que|car).*narra/i.test(lower) ? -3 : 0,
			description: 'Ajustar ganho da trilha e ducking sob a narração (sem re-encodar vídeo).',
		});
	}

	// 4. Pronunciation correction (preserves editorial text!)
	if (/pron[úu]ncia|pronunciar|falar o nome/i.test(lower)) {
		const match = /["'“]([^"'”]+)["'”]\s*(?:como|para|->)\s*["'“]([^"'”]+)["'”]/i.exec(prompt);
		const from = match?.[1];
		const to = match?.[2];
		for (const scene of script.scenes) {
			if (!from || scene.narrationText.toLowerCase().includes(from.toLowerCase())) {
				affectedScenes.add(scene.sceneId);
			}
		}
		rootStages.push('pronunciation');
		actions.push({
			kind: 'fix_pronunciation',
			...(from ? { pronunciationFrom: from } : {}),
			...(to ? { pronunciationTo: to } : {}),
			description: from && to
				? `Corrigir pronúncia de "${from}" para "${to}" no dicionário TTS (preservando texto editorial).`
				: 'Atualizar dicionário de pronúncia TTS apenas nas cenas com o nome mencionado.',
		});
	}

	// 5. Duration tweak
	if (/dura[çc][ãa]o|mais r[áa]pido|mais lento|mais curto|mais longo/i.test(lower)) {
		if (targetSceneId) affectedScenes.add(targetSceneId);
		const delta = /r[áa]pido|curto|reduz/i.test(lower) ? -1.0 : 1.0;
		rootStages.push('visual_plan');
		actions.push({
			kind: 'adjust_duration',
			...(targetSceneId ? { targetSceneId } : {}),
			durationDeltaSec: delta,
			description: `Ajustar duração visual da cena ${targetSceneId ?? 'selecionada'} em ${delta > 0 ? '+' : ''}${delta}s.`,
		});
	}

	if (actions.length === 0) {
		return {
			prompt,
			understood: false,
			actions: [{ kind: 'unknown', description: 'Solicitação não reconhecida deterministicamente; requer revisão manual ou agente editorial.' }],
			affectedSceneIds: [],
			reprocessStages: [],
			reusedStages: [...ALL_STAGES],
			estimatedVideoReworkRatio: 0,
			summary: 'Nenhuma alteração determinística mapeada para este prompt.',
		};
	}

	const reprocessStages = expandDownstream(rootStages);
	const reusedStages = ALL_STAGES.filter((s) => !reprocessStages.includes(s));
	const totalScenes = Math.max(1, script.scenes.length);
	const needsShotRender = reprocessStages.includes('shot_render');
	const estimatedVideoReworkRatio = needsShotRender
		? Number((Math.max(1, affectedScenes.size) / totalScenes).toFixed(2))
		: 0;

	const shotCountNote = plan ? ` (${plan.shots.length} shots totais)` : '';
	return {
		prompt,
		understood: true,
		actions,
		affectedSceneIds: [...affectedScenes],
		reprocessStages,
		reusedStages,
		estimatedVideoReworkRatio,
		summary: `Plano de impacto: reprocessar [${reprocessStages.join(', ')}] preservando [${reusedStages.join(', ')}]${shotCountNote}. Retrabalho de vídeo estimado: ${Math.round(estimatedVideoReworkRatio * 100)}%.`,
	};
}

/**
 * Applies a validated RecapRevisionImpactPlan immutably to script and audiovisual plan,
 * returning updated artifacts and pronunciation overrides.
 */
export function applyRecapRevisionPlan(input: {
	script: RecapScript;
	plan: RecapAudiovisualPlan;
	impactPlan: RecapRevisionImpactPlan;
}): {
	script: RecapScript;
	plan: RecapAudiovisualPlan;
	pronunciationOverrides: Array<{ from: string; to: string }>;
} {
	const nextScript: RecapScript = structuredClone(input.script);
	const nextPlan: RecapAudiovisualPlan = structuredClone(input.plan);
	const pronunciationOverrides: Array<{ from: string; to: string }> = [];

	for (const action of input.impactPlan.actions) {
		if (action.kind === 'increase_drama' && action.targetSceneId) {
			const scene = nextScript.scenes.find((s) => s.sceneId === action.targetSceneId);
			if (scene) {
				scene.emotion = 'anger' as Emotion;
				scene.narrativeIntent = 'climax';
			}
			for (const shot of nextPlan.shots) {
				if (shot.sceneId === action.targetSceneId && !shot.balloonSafeZoneProtected) {
					shot.motionStyle = 'impact_push' as RecapMotionStyle;
					shot.focalEnd = { ...shot.focalEnd, zoom: Math.min(1.16, shot.focalEnd.zoom + 0.05) };
				}
			}
		} else if (action.kind === 'swap_panel' && action.targetSceneId && action.newPanelId) {
			const scene = nextScript.scenes.find((s) => s.sceneId === action.targetSceneId);
			if (scene) {
				scene.panelIds = [action.newPanelId, ...scene.panelIds.slice(1)];
			}
			const firstShot = nextPlan.shots.find((s) => s.sceneId === action.targetSceneId);
			if (firstShot) firstShot.panelId = action.newPanelId;
		} else if (action.kind === 'adjust_music_ducking') {
			nextPlan.ducking.musicBaseGainDb = Math.max(-30, Math.min(-6, nextPlan.ducking.musicBaseGainDb + (action.musicDeltaDb ?? -4)));
			nextPlan.ducking.musicDuckingDb = Math.max(-24, Math.min(-3, nextPlan.ducking.musicDuckingDb + (action.duckingDeltaDb ?? -3)));
		} else if (action.kind === 'fix_pronunciation' && action.pronunciationFrom && action.pronunciationTo) {
			pronunciationOverrides.push({ from: action.pronunciationFrom, to: action.pronunciationTo });
		} else if (action.kind === 'adjust_duration' && action.targetSceneId && action.durationDeltaSec) {
			const scene = nextScript.scenes.find((s) => s.sceneId === action.targetSceneId);
			if (scene) {
				scene.estimatedDurationSec = Math.max(1.5, Number((scene.estimatedDurationSec + action.durationDeltaSec).toFixed(2)));
			}
		}
	}

	return { script: nextScript, plan: nextPlan, pronunciationOverrides };
}
