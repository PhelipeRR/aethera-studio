/**
 * Aethera Recap — Phase 3 Deterministic Visual, Motion, Caption & Audio-Mix Planner
 *
 * Reuses existing @neuralbridge/cinema infrastructure:
 * - audio-first-timeline.ts (measureNarrationSegmentsWithPauses, buildAudioFirstDurationAudit)
 * - captions/smart-captions.ts (compileSmartCaptions)
 * - audio/sound-engine.ts (LOUDNESS_PROFILES)
 *
 * Requires ZERO external AI agents (Claude/Codex/Antigravity) for deterministic planning.
 */

import {
	buildAudioFirstDurationAudit,
	measureNarrationSegmentsWithPauses,
	type MeasuredNarrationSegment,
} from '../../audio/audio-first-timeline.js';
import { compileSmartCaptions, type CaptionWord } from '../../captions/smart-captions.js';
import { LOUDNESS_PROFILES } from '../../audio/sound-engine.js';
import type { ExtractedPanel, RecapScript, Scene } from '../recap-types.js';
import type {
	RecapAudiovisualPlan,
	RecapMotionKeyframe,
	RecapMotionStyle,
	RecapPanelShot,
	RecapSfxCue,
	RecapSfxKind,
	RecapTransitionKind,
	RecapVfxSpec,
	RecapVisualPlannerOptions,
} from './recap-audiovisual-types.js';

function selectMotionForScene(
	scene: Scene,
	panel: ExtractedPanel | undefined,
): {
	motionStyle: RecapMotionStyle;
	focalStart: RecapMotionKeyframe;
	focalEnd: RecapMotionKeyframe;
	balloonSafeZoneProtected: boolean;
} {
	const isDialogue = panel?.metadata.classification === 'dialogue';
	const isVerticalStrip = panel ? panel.height > panel.width * 1.35 : false;

	if (isDialogue) {
		// Protect speech balloons: subtle gentle zoom, centered safe focal area
		return {
			motionStyle: 'static_focus',
			focalStart: { x: 0.5, y: 0.48, zoom: 1.0 },
			focalEnd: { x: 0.5, y: 0.48, zoom: 1.04 },
			balloonSafeZoneProtected: true,
		};
	}

	if (isVerticalStrip) {
		return {
			motionStyle: 'pan_vertical',
			focalStart: { x: 0.5, y: 0.35, zoom: 1.08 },
			focalEnd: { x: 0.5, y: 0.65, zoom: 1.08 },
			balloonSafeZoneProtected: false,
		};
	}

	if (scene.narrativeIntent === 'climax' || scene.emotion === 'anger' || scene.emotion === 'surprise') {
		return {
			motionStyle: 'impact_push',
			focalStart: { x: 0.5, y: 0.5, zoom: 1.0 },
			focalEnd: { x: 0.5, y: 0.46, zoom: 1.14 },
			balloonSafeZoneProtected: false,
		};
	}

	if (scene.narrativeIntent === 'exposition' || scene.narrativeIntent === 'world_building') {
		return {
			motionStyle: 'ken_burns_out',
			focalStart: { x: 0.5, y: 0.48, zoom: 1.1 },
			focalEnd: { x: 0.5, y: 0.5, zoom: 1.0 },
			balloonSafeZoneProtected: false,
		};
	}

	return {
		motionStyle: 'ken_burns_in',
		focalStart: { x: 0.5, y: 0.5, zoom: 1.0 },
		focalEnd: { x: 0.5, y: 0.48, zoom: 1.09 },
		balloonSafeZoneProtected: false,
	};
}

function selectTransitionForScene(scene: Scene, index: number): RecapTransitionKind {
	if (index === 0) return 'dip_black';
	if (scene.narrativeIntent === 'climax') return 'flash_white';
	if (scene.narrativeIntent === 'transition' || scene.narrativeIntent === 'world_building') return 'crossfade';
	return 'cut';
}

function selectSfxForScene(scene: Scene, startMs: number, index: number): RecapSfxCue | null {
	let sfxKind: RecapSfxKind | null = null;
	let reason = '';
	let gainDb = -10;

	if (scene.narrativeIntent === 'climax' || scene.emotion === 'anger') {
		sfxKind = 'impact_hit';
		gainDb = -8;
		reason = `Clímax/ação intensa na cena ${scene.sceneId}`;
	} else if (scene.emotion === 'tension' || scene.emotion === 'fear') {
		sfxKind = 'tension_riser';
		gainDb = -12;
		reason = `Construção de tensão na cena ${scene.sceneId}`;
	} else if (scene.emotion === 'sadness' || scene.emotion === 'relief') {
		sfxKind = 'emotional_swell';
		gainDb = -13;
		reason = `Ênfase emocional na cena ${scene.sceneId}`;
	} else if (index > 0) {
		sfxKind = 'whoosh';
		gainDb = -12;
		reason = `Transição visual para cena ${scene.sceneId}`;
	}

	if (!sfxKind) return null;
	return {
		cueId: `sfx-${scene.sceneId}-${index}`,
		sceneId: scene.sceneId,
		timeMs: startMs,
		sfxKind,
		gainDb,
		reason,
	};
}

function buildVfxForScene(scene: Scene, hasDialoguePanel: boolean): RecapVfxSpec {
	if (hasDialoguePanel) {
		// Never obscure speech bubbles: zero shake, minimal vignette
		return {
			sceneId: scene.sceneId,
			vignetteStrength: 0.08,
			contrastBoost: 1.02,
			shakeIntensity: 0,
			balloonSafe: true,
		};
	}

	const isHighEnergy = scene.narrativeIntent === 'climax' || scene.emotion === 'anger';
	return {
		sceneId: scene.sceneId,
		vignetteStrength: isHighEnergy ? 0.22 : 0.14,
		contrastBoost: isHighEnergy ? 1.08 : 1.03,
		shakeIntensity: isHighEnergy ? 0.15 : 0,
		balloonSafe: true,
	};
}

function distributeWordsOverWindow(text: string, startMs: number, speechEndMs: number): CaptionWord[] {
	const tokens = text.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return [];
	const spanMs = Math.max(tokens.length * 40, speechEndMs - startMs);
	const stepMs = spanMs / tokens.length;
	const words: CaptionWord[] = [];
	let cursor = startMs;
	for (let i = 0; i < tokens.length; i++) {
		const wStart = Math.round(cursor);
		const wEnd = i === tokens.length - 1 ? Math.max(wStart + 20, speechEndMs) : Math.max(wStart + 20, Math.round(startMs + (i + 1) * stepMs));
		words.push({ text: tokens[i]!, startMs: wStart, endMs: wEnd });
		cursor = wEnd;
	}
	return words;
}

/**
 * Builds a complete, deterministic Phase 3 audiovisual plan from a RecapScript
 * and extracted panels, strictly synchronized to measured narration durations.
 */
export function buildRecapAudiovisualPlan(input: {
	script: RecapScript;
	panels: readonly ExtractedPanel[];
	measuredSegments?: readonly MeasuredNarrationSegment[];
	options?: RecapVisualPlannerOptions;
}): RecapAudiovisualPlan {
	const { script, panels, options = {} } = input;
	if (script.scenes.length === 0) {
		throw new Error('RecapScript não possui cenas para planejamento audiovisual.');
	}

	const renderTarget = options.renderTarget ?? 'preview';
	const width = options.width ?? (renderTarget === 'master' ? 1920 : 1280);
	const height = options.height ?? (renderTarget === 'master' ? 1080 : 720);
	const fps = options.fps ?? (renderTarget === 'master' ? 30 : 24);
	const platform = options.platform ?? 'youtube';
	const loudnessProfile = LOUDNESS_PROFILES[platform];
	const isSyntheticFixture = options.isSyntheticFixture ?? false;
	const approvalStatus = options.approvalStatus ?? (isSyntheticFixture ? 'technical_fixture_unapproved' : 'approved_editorial');

	const panelMap = new Map<string, ExtractedPanel>();
	for (const p of panels) panelMap.set(p.panelId, p);

	// 1. Audio-First clock (reusing audio-first-timeline.ts)
	const plannedDurationMs = Math.round(
		script.scenes.reduce((sum, s) => sum + Math.max(1, s.estimatedDurationSec) * 1000, 0),
	);

	const segmentInputs: MeasuredNarrationSegment[] = script.scenes.map((scene) => {
		const measured = input.measuredSegments?.find((m) => m.segmentId === scene.sceneId);
		if (measured) return measured;
		return {
			segmentId: scene.sceneId,
			speechDurationMs: Math.max(800, Math.round(scene.estimatedDurationSec * 1000)),
			pauseAfterMs: 300,
		};
	});

	const measuredTimeline = measureNarrationSegmentsWithPauses(segmentInputs);
	const durationAudit = buildAudioFirstDurationAudit({
		plannedTimelineDurationMs: plannedDurationMs,
		measuredNarrationDurationMs: measuredTimeline.totalDurationMs,
	});
	const totalDurationMs = durationAudit.finalTimelineDurationMs;

	// 2. Visual shot planning, SFX & VFX per scene (zero gaps, no consecutive duplicates)
	const shots: RecapPanelShot[] = [];
	const sfxCues: RecapSfxCue[] = [];
	const vfxSpecs: RecapVfxSpec[] = [];
	const captionWords: CaptionWord[] = [];
	const keywords = new Set<string>();
	let lastPanelId: string | null = null;

	for (let sIdx = 0; sIdx < script.scenes.length; sIdx++) {
		const scene = script.scenes[sIdx]!;
		const timing = measuredTimeline.segments[sIdx]!;
		const isLastScene = sIdx === script.scenes.length - 1;
		// Extend final scene tail if planned timeline exceeded measured narration
		const sceneStartMs = timing.startMs;
		const sceneEndMs = isLastScene ? totalDurationMs : timing.endMs;
		const sceneDurationMs = Math.max(100, sceneEndMs - sceneStartMs);

		for (const char of scene.characters) {
			if (char.trim().length >= 3) keywords.add(char.trim());
		}

		// Deduplicate consecutive panel references within and across scene boundaries
		const candidatePanelIds = scene.panelIds.filter((pid, idx) => idx === 0 || pid !== scene.panelIds[idx - 1]);
		let effectivePanelIds = candidatePanelIds;
		if (effectivePanelIds.length > 1 && effectivePanelIds[0] === lastPanelId) {
			effectivePanelIds = effectivePanelIds.slice(1);
		}
		if (effectivePanelIds.length === 0) {
			effectivePanelIds = [scene.panelIds[0]!];
		}

		const hasDialoguePanel = effectivePanelIds.some((pid) => panelMap.get(pid)?.metadata.classification === 'dialogue');
		vfxSpecs.push(buildVfxForScene(scene, hasDialoguePanel));

		const sfx = selectSfxForScene(scene, sceneStartMs, sIdx);
		if (sfx) sfxCues.push(sfx);

		const shotCount = effectivePanelIds.length;
		const baseShotMs = Math.floor(sceneDurationMs / shotCount);
		let shotCursor = sceneStartMs;

		for (let pIdx = 0; pIdx < shotCount; pIdx++) {
			const panelId = effectivePanelIds[pIdx]!;
			const panel = panelMap.get(panelId);
			const imagePath = panel?.croppedImagePath ?? scene.croppedImagePaths[pIdx] ?? panel?.pagePath ?? '';
			const shotStartMs = shotCursor;
			const shotEndMs = pIdx === shotCount - 1 ? sceneEndMs : shotCursor + baseShotMs;
			const motion = selectMotionForScene(scene, panel);

			shots.push({
				shotId: `shot-${sIdx + 1}-${pIdx + 1}`,
				sceneId: scene.sceneId,
				sceneIndex: sIdx,
				panelId,
				pageNumber: panel?.metadata.pageNumber ?? sIdx,
				imagePath,
				startMs: shotStartMs,
				endMs: shotEndMs,
				durationMs: Math.max(1, shotEndMs - shotStartMs),
				motionStyle: motion.motionStyle,
				focalStart: motion.focalStart,
				focalEnd: motion.focalEnd,
				transitionIn: pIdx === 0 ? selectTransitionForScene(scene, sIdx) : 'cut',
				balloonSafeZoneProtected: motion.balloonSafeZoneProtected,
				emotion: scene.emotion,
				narrativeIntent: scene.narrativeIntent,
			});

			shotCursor = shotEndMs;
			lastPanelId = panelId;
		}

		// Words synchronized strictly to [timing.startMs, timing.speechEndMs]
		const sceneWords = distributeWordsOverWindow(scene.narrationText, timing.startMs, Math.min(timing.speechEndMs, totalDurationMs));
		captionWords.push(...sceneWords);
	}

	// 3. Synchronized Smart Captions (reusing captions/smart-captions.ts)
	const captions = compileSmartCaptions({
		words: captionWords,
		durationMs: totalDurationMs,
		width,
		height,
		safeArea: {
			top: Math.round(height * 0.06),
			right: Math.round(width * 0.08),
			bottom: Math.round(height * 0.08),
			left: Math.round(width * 0.08),
		},
		style: options.captionStyle ?? 'anime',
		keywords: [...keywords],
		maxWordsPerCue: 4,
		pauseThresholdMs: 500,
		placement: 'bottom',
	});

	// 4. Soundtrack ducking & EBU R128 loudness (reusing LOUDNESS_PROFILES from sound-engine.ts)
	const ducking = {
		platform,
		loudnessProfile,
		voiceGainDb: 0,
		musicBaseGainDb: -16,
		musicDuckingDb: -9,
		sidechainFilter: 'sidechaincompress=threshold=0.04:ratio=6:attack=25:release=320:makeup=1',
		loudnormFilter: `loudnorm=I=${loudnessProfile.integratedLufs}:TP=${loudnessProfile.truePeakDbtp}:LRA=${loudnessProfile.loudnessRangeLu}`,
	};

	return {
		schemaVersion: 1,
		chapterId: script.chapterId,
		scriptTitle: script.title,
		isSyntheticFixture,
		approvalStatus,
		renderTarget,
		width,
		height,
		fps,
		totalDurationMs,
		shots,
		sfxCues,
		vfxSpecs,
		ducking,
		captions,
		durationAudit,
		createdAtIso: new Date().toISOString(),
	};
}
