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
	RecapShotLayout,
	RecapSfxCue,
	RecapSfxKind,
	RecapTransitionKind,
	RecapVfxSpec,
	RecapVisualPlannerOptions,
} from './recap-audiovisual-types.js';
import type { AlignedBeatInterval } from './recap-semantic-alignment.js';
import { readImageDimensionsFast } from './recap-motionvelix.js';

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

	if (isVerticalStrip) {
		return {
			motionStyle: 'pan_vertical',
			focalStart: { x: 0.5, y: 0.35, zoom: 1.04 },
			focalEnd: { x: 0.5, y: 0.65, zoom: 1.04 },
			balloonSafeZoneProtected: isDialogue,
		};
	}

	if (isDialogue) {
		// Protect speech balloons: subtle gentle zoom, centered safe focal area
		return {
			motionStyle: 'static_focus',
			focalStart: { x: 0.5, y: 0.48, zoom: 1.0 },
			focalEnd: { x: 0.5, y: 0.48, zoom: 1.04 },
			balloonSafeZoneProtected: true,
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

	if (scene.narrativeIntent === 'world_building') {
		return {
			motionStyle: 'parallax',
			focalStart: { x: 0.46, y: 0.48, zoom: 1.12 },
			focalEnd: { x: 0.54, y: 0.52, zoom: 1.04 },
			balloonSafeZoneProtected: false,
		};
	}

	if (scene.narrativeIntent === 'exposition') {
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


/**
 * Detects whether a shot's zoom/pan or aspect mismatch risks cropping characters,
 * speech balloons, or key action regions (Phase 3.1).
 */
export function detectFramingCropRisk(input: {
	panel: ExtractedPanel | undefined;
	viewportWidth: number;
	viewportHeight: number;
	focalStart: RecapMotionKeyframe;
	focalEnd: RecapMotionKeyframe;
}): { atRisk: boolean; reason?: string } {
	const maxZoom = Math.max(input.focalStart.zoom, input.focalEnd.zoom);
	const isDialogue = input.panel?.metadata.classification === 'dialogue';
	if (isDialogue && maxZoom > 1.08) {
		return { atRisk: true, reason: `Zoom ${maxZoom.toFixed(2)}x em painel de diálogo pode cortar balões de texto.` };
	}
	if (maxZoom > 1.35) {
		return { atRisk: true, reason: `Zoom excessivo (${maxZoom.toFixed(2)}x) pode cortar personagens ou ação principal.` };
	}
	if (input.panel && input.panel.width > 0 && input.panel.height > 0) {
		const panelRatio = input.panel.width / input.panel.height;
		const viewportRatio = input.viewportWidth / input.viewportHeight;
		if (Math.abs(Math.log(panelRatio / viewportRatio)) > 1.35 && maxZoom > 1.18) {
			return { atRisk: true, reason: 'Divergência acentuada de proporção com zoom alto pode cortar bordas relevantes.' };
		}
	}
	return { atRisk: false };
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
	/** Real audio-aligned narrative beats (Phases 2, 3 & 7). When provided, drives panel cuts directly instead of equal-split. */
	alignedBeats?: readonly AlignedBeatInterval[];
	options?: RecapVisualPlannerOptions;
}): RecapAudiovisualPlan {
	const { script, panels, alignedBeats, options = {} } = input;
	if (script.scenes.length === 0) {
		throw new Error('RecapScript não possui cenas para planejamento audiovisual.');
	}

	const renderTarget = options.renderTarget ?? 'preview';
	const aspectRatio = options.aspectRatio ?? '16:9';
	const defaultDims = aspectRatio === '9:16'
		? (renderTarget === 'master' ? { w: 1080, h: 1920 } : { w: 720, h: 1280 })
		: (renderTarget === 'master' ? { w: 1920, h: 1080 } : { w: 1280, h: 720 });
	const width = options.width ?? defaultDims.w;
	const height = options.height ?? defaultDims.h;
	const fps = options.fps ?? (renderTarget === 'master' ? 30 : 24);
	const platform = options.platform ?? 'youtube';
	const loudnessProfile = LOUDNESS_PROFILES[platform];
	const isSyntheticFixture = options.isSyntheticFixture ?? false;
	const approvalStatus = options.approvalStatus ?? (isSyntheticFixture ? 'technical_fixture_unapproved' : 'approved_editorial');

	const panelMap = new Map<string, ExtractedPanel>();
	for (const p of panels) panelMap.set(p.panelId, p);

	// 1. Audio-First clock (reusing audio-first-timeline.ts)
	// When real audio is measured (via alignedBeats or measuredSegments), the timeline duration
	// MUST follow the real speech duration (no artificial silent tail inflation from word-count estimates).
	const hasAlignedBeats = Boolean(alignedBeats && alignedBeats.length > 0);
	const hasMeasuredSegments = Boolean(input.measuredSegments && input.measuredSegments.length > 0);
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
	const measuredNarrationTotalMs = hasAlignedBeats
		? Math.max(1000, alignedBeats![alignedBeats!.length - 1]!.displayEndMs)
		: hasMeasuredSegments
			? Math.max(
				1000,
				input.measuredSegments!.reduce((sum, seg) => sum + seg.speechDurationMs + seg.pauseAfterMs, 0),
			)
			: measuredTimeline.totalDurationMs;

	const durationAudit = buildAudioFirstDurationAudit({
		plannedTimelineDurationMs: hasAlignedBeats || hasMeasuredSegments ? measuredNarrationTotalMs : plannedDurationMs,
		measuredNarrationDurationMs: measuredNarrationTotalMs,
	});
	const totalDurationMs = durationAudit.finalTimelineDurationMs;

	// 2. Visual shot planning, SFX & VFX (zero gaps, no consecutive duplicates)
	const shots: RecapPanelShot[] = [];
	const sfxCues: RecapSfxCue[] = [];
	const vfxSpecs: RecapVfxSpec[] = [];
	const captionWords: CaptionWord[] = [];
	const keywords = new Set<string>();
	let lastPanelId: string | null = null;

	if (hasAlignedBeats) {
		const sceneById = new Map(script.scenes.map((s, idx) => [s.sceneId, { scene: s, index: idx }]));
		for (const scene of script.scenes) {
			for (const char of scene.characters) {
				if (char.trim().length >= 3) keywords.add(char.trim());
			}
			const hasDialoguePanel = scene.panelIds.some((pid) => panelMap.get(pid)?.metadata.classification === 'dialogue');
			vfxSpecs.push(buildVfxForScene(scene, hasDialoguePanel));
		}

		// Group consecutive beats mapped to the same panelId so each shot has zero consecutive duplicates
		// and holds strictly for the real spoken interval of its events.
		interface BeatShotGroup {
			panelId: string;
			sceneId: string;
			sceneIndex: number;
			startMs: number;
			endMs: number;
		}
		const groups: BeatShotGroup[] = [];
		let maxSceneIdx = 0;

		for (const beat of alignedBeats!) {
			const sceneEntry = sceneById.get(beat.sceneId) ?? { scene: script.scenes[0]!, index: 0 };
			const monotonicSceneIndex = Math.max(maxSceneIdx, sceneEntry.index);
			maxSceneIdx = monotonicSceneIndex;
			const monotonicSceneId = script.scenes[monotonicSceneIndex]!.sceneId;

			const prev = groups[groups.length - 1];
			if (prev && prev.panelId === beat.panelId) {
				prev.endMs = Math.max(prev.endMs, beat.displayEndMs);
			} else {
				groups.push({
					panelId: beat.panelId,
					sceneId: monotonicSceneId,
					sceneIndex: monotonicSceneIndex,
					startMs: groups.length === 0 ? 0 : prev!.endMs,
					endMs: Math.max((groups.length === 0 ? 0 : prev!.endMs) + 200, beat.displayEndMs),
				});
			}
		}

		// Distribute caption words without duplicating when a single clause spans consecutive panels
		for (let bIdx = 0; bIdx < alignedBeats!.length; ) {
			const startBeat = alignedBeats![bIdx]!;
			let endIdx = bIdx;
			while (
				endIdx + 1 < alignedBeats!.length &&
				alignedBeats![endIdx + 1]!.clauseText === startBeat.clauseText
			) {
				endIdx++;
			}
			const endBeat = alignedBeats![endIdx]!;
			const beatWords = distributeWordsOverWindow(
				startBeat.clauseText,
				startBeat.speechStartMs,
				Math.min(Math.max(startBeat.speechStartMs + 120, endBeat.speechEndMs), totalDurationMs),
			);
			captionWords.push(...beatWords);
			bIdx = endIdx + 1;
		}

		// Ensure exact contiguous coverage [0, totalDurationMs]
		if (groups.length > 0) {
			groups[0]!.startMs = 0;
			groups[groups.length - 1]!.endMs = totalDurationMs;
		}

		const seenScenesForSfx = new Set<number>();
		for (let gIdx = 0; gIdx < groups.length; gIdx++) {
			const group = groups[gIdx]!;
			const scene = script.scenes[group.sceneIndex]!;
			const panel = panelMap.get(group.panelId);
			const imagePath = panel?.croppedImagePath ?? panel?.pagePath ?? scene.croppedImagePaths[0] ?? '';
			const motion = selectMotionForScene(scene, panel);
			const isFirstShotOfScene = !seenScenesForSfx.has(group.sceneIndex);

			if (isFirstShotOfScene) {
				seenScenesForSfx.add(group.sceneIndex);
				const sfx = selectSfxForScene(scene, group.startMs, group.sceneIndex);
				if (sfx) sfxCues.push(sfx);
			}

			shots.push({
				shotId: `shot-${group.sceneIndex + 1}-${gIdx + 1}`,
				sceneId: group.sceneId,
				sceneIndex: group.sceneIndex,
				panelId: group.panelId,
				pageNumber: panel?.metadata.pageNumber ?? group.sceneIndex,
				imagePath,
				startMs: group.startMs,
				endMs: group.endMs,
				durationMs: Math.max(1, group.endMs - group.startMs),
				motionStyle: motion.motionStyle,
				focalStart: motion.focalStart,
				focalEnd: motion.focalEnd,
				transitionIn: isFirstShotOfScene ? selectTransitionForScene(scene, group.sceneIndex) : 'cut',
				balloonSafeZoneProtected: motion.balloonSafeZoneProtected,
				framingCropRisk: detectFramingCropRisk({ panel, viewportWidth: width, viewportHeight: height, focalStart: motion.focalStart, focalEnd: motion.focalEnd }),
				emotion: scene.emotion,
				narrativeIntent: scene.narrativeIntent,
			});
		}
	} else {
		for (let sIdx = 0; sIdx < script.scenes.length; sIdx++) {
			const scene = script.scenes[sIdx]!;
			const timing = measuredTimeline.segments[sIdx]!;
			const isLastScene = sIdx === script.scenes.length - 1;
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
					framingCropRisk: detectFramingCropRisk({ panel, viewportWidth: width, viewportHeight: height, focalStart: motion.focalStart, focalEnd: motion.focalEnd }),
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
	}

	// 2b. Compact panels share the screen, each revealed when the narration reaches it.
	const finalShots = options.multiPanelLayout === false ? shots : stackCompactPanelShots(shots, panelMap, width, height);

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
		aspectRatio,
		width,
		height,
		fps,
		totalDurationMs,
		shots: finalShots,
		sfxCues,
		vfxSpecs,
		ducking,
		captions,
		durationAudit,
		...(hasAlignedBeats ? { beatAlignments: [...alignedBeats!] } : {}),
		createdAtIso: new Date().toISOString(),
	};
}

// ─── Multi-panel layout ─────────────────────────────────────────────────────

/** Panels taller than this (height/width) keep the dedicated vertical-scroll compositor. */
const STACK_MAX_TALL_RATIO = 2.0;
/** Gap and outer margin as a fraction of the frame's long side. */
const STACK_GAP_RATIO = 0.02;

function panelAspect(panel: ExtractedPanel | undefined, imagePath: string): number | null {
	const box = panel?.metadata.boundingBox;
	if (box && box.w > 0 && box.h > 0) return box.w / box.h;
	const dims = imagePath ? readImageDimensionsFast(imagePath) : null;
	return dims && dims.width > 0 && dims.height > 0 ? dims.width / dims.height : null;
}

/**
 * How many copies of a panel fit along the frame's long side without shrinking it below its
 * full-frame size. 1 means the panel already fills the frame and should stay alone.
 */
export function compactPanelSlots(aspect: number, width: number, height: number): number {
	if (!Number.isFinite(aspect) || aspect <= 0) return 1;
	const gap = Math.round(Math.max(width, height) * STACK_GAP_RATIO);
	if (width > height) {
		// Landscape: panels side by side. Very tall strips scroll instead.
		if (1 / aspect > STACK_MAX_TALL_RATIO) return 1;
		const usableH = height - 2 * gap;
		const panelW = usableH * aspect;
		return Math.max(1, Math.min(3, Math.floor((width - gap) / (panelW + gap))));
	}
	// Portrait: panels stacked vertically.
	const usableW = width - 2 * gap;
	const panelH = usableW / aspect;
	return Math.max(1, Math.min(3, Math.floor((height - gap) / (panelH + gap))));
}

/**
 * Merges runs of consecutive shots from the same scene whose panels are compact enough to share
 * the frame. The merged shot spans the run; each panel keeps its own narration start as reveal time.
 */
export function stackCompactPanelShots(
	shots: readonly RecapPanelShot[],
	panelMap: ReadonlyMap<string, ExtractedPanel>,
	width: number,
	height: number,
): RecapPanelShot[] {
	const kind: RecapShotLayout['kind'] = width > height ? 'row' : 'column';
	const slotsFor = (shot: RecapPanelShot) => {
		const aspect = panelAspect(panelMap.get(shot.panelId), shot.imagePath);
		return aspect === null ? 1 : compactPanelSlots(aspect, width, height);
	};
	const out: RecapPanelShot[] = [];
	let i = 0;
	while (i < shots.length) {
		const first = shots[i]!;
		const capacity = slotsFor(first);
		const run: RecapPanelShot[] = [first];
		while (capacity > 1 && run.length < capacity && i + run.length < shots.length) {
			const next = shots[i + run.length]!;
			if (next.sceneIndex !== first.sceneIndex || !next.imagePath) break;
			if (run.some((r) => r.panelId === next.panelId)) break;
			// Every panel in the run must fit the same number of slots, or the smallest one wins.
			if (slotsFor(next) < run.length + 1) break;
			run.push(next);
		}
		if (run.length < 2) {
			out.push(first);
			i += 1;
			continue;
		}
		const last = run[run.length - 1]!;
		out.push({
			...first,
			endMs: last.endMs,
			durationMs: Math.max(1, last.endMs - first.startMs),
			// The composite holds still: panel reveals carry the motion; balloons stay readable.
			motionStyle: 'static_focus',
			focalStart: { x: 0.5, y: 0.5, zoom: 1 },
			focalEnd: { x: 0.5, y: 0.5, zoom: 1 },
			balloonSafeZoneProtected: true,
			framingCropRisk: { atRisk: false },
			layout: {
				kind,
				panels: run.map((r) => ({ panelId: r.panelId, imagePath: r.imagePath, revealAtMs: r.startMs - first.startMs })),
			},
		});
		i += run.length;
	}
	return out;
}
