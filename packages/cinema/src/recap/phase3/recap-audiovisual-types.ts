/**
 * Aethera Recap — Phase 3 Audiovisual Production Contracts
 *
 * Connects Story Engine outputs (RecapScript + ExtractedPanel[]) to the existing
 * @neuralbridge/cinema audiovisual infrastructure (Audio-First Timeline,
 * Smart Captions, Sound Engine loudness/ducking, and FFmpeg rendering).
 */

import type { AudioFirstDurationAudit } from '../../audio/audio-first-timeline.js';
import type { SmartCaptionArtifact, SmartCaptionStyle } from '../../captions/smart-captions.js';
import type { LoudnessPlatform, LoudnessTargetProfile } from '../../audio/sound-engine.js';
import type { Emotion, NarrativeIntent } from '../recap-types.js';

export type RecapMotionStyle =
	| 'ken_burns_in'
	| 'ken_burns_out'
	| 'pan_vertical'
	| 'pan_horizontal'
	| 'static_focus'
	| 'impact_push'
	| 'parallax';

export type RecapTransitionKind = 'cut' | 'crossfade' | 'flash_white' | 'dip_black';

export type RecapSfxKind =
	| 'whoosh'
	| 'impact_hit'
	| 'tension_riser'
	| 'page_turn'
	| 'emotional_swell';

export interface RecapMotionKeyframe {
	/** Normalized focal center X (0..1). */
	x: number;
	/** Normalized focal center Y (0..1). */
	y: number;
	/** Zoom factor (>= 1.0). */
	zoom: number;
}

export interface RecapPanelShot {
	shotId: string;
	sceneId: string;
	sceneIndex: number;
	panelId: string;
	pageNumber: number;
	imagePath: string;
	startMs: number;
	endMs: number;
	durationMs: number;
	motionStyle: RecapMotionStyle;
	focalStart: RecapMotionKeyframe;
	focalEnd: RecapMotionKeyframe;
	transitionIn: RecapTransitionKind;
	/** True when motion/VFX parameters are constrained to preserve speech balloon legibility. */
	balloonSafeZoneProtected: boolean;
	/** Framing crop audit (Phase 3.1): flags if zoom/aspect could clip characters, text, or key action. */
	framingCropRisk: { atRisk: boolean; reason?: string };
	emotion: Emotion;
	narrativeIntent: NarrativeIntent;
}

export interface RecapSfxCue {
	cueId: string;
	sceneId: string;
	timeMs: number;
	sfxKind: RecapSfxKind;
	gainDb: number;
	reason: string;
}

export interface RecapVfxSpec {
	sceneId: string;
	vignetteStrength: number;
	contrastBoost: number;
	shakeIntensity: number;
	balloonSafe: boolean;
}

export interface RecapAudioDuckingConfig {
	platform: LoudnessPlatform;
	loudnessProfile: LoudnessTargetProfile;
	voiceGainDb: number;
	musicBaseGainDb: number;
	musicDuckingDb: number;
	sidechainFilter: string;
	loudnormFilter: string;
}

export type RecapScriptApprovalStatus = 'approved_editorial' | 'technical_fixture_unapproved';

export interface RecapAudiovisualPlan {
	schemaVersion: 1;
	chapterId: string;
	scriptTitle: string;
	/** Explicitly marks synthetic/test fixtures so they are never mistaken for real Phase 2.2.4 E2E results. */
	isSyntheticFixture: boolean;
	approvalStatus: RecapScriptApprovalStatus;
	renderTarget: 'preview' | 'master';
	aspectRatio: '16:9' | '9:16';
	width: number;
	height: number;
	fps: number;
	totalDurationMs: number;
	shots: RecapPanelShot[];
	sfxCues: RecapSfxCue[];
	vfxSpecs: RecapVfxSpec[];
	ducking: RecapAudioDuckingConfig;
	captions: SmartCaptionArtifact;
	durationAudit: AudioFirstDurationAudit;
	createdAtIso: string;
}

export interface SynthesizedSceneAudio {
	sceneId: string;
	audioPath: string;
	speechDurationMs: number;
	pauseAfterMs: number;
	provider: string;
	isFallback: boolean;
}

/**
 * Pluggable TTS port for Phase 3. Production hosts can inject ElevenLabs,
 * VoiceStudio, or Windows SAPI; deterministic fallback generates timed WAVs
 * for offline technical verification without depending on external LLM CLIs.
 */
export interface RecapTtsSynthesisPort {
	readonly name: string;
	synthesizeScene(input: {
		sceneId: string;
		text: string;
		emotion: Emotion;
		estimatedDurationSec: number;
		outputPath: string;
	}): Promise<SynthesizedSceneAudio>;
}

export type RecapPhase3Stage =
	| 'audio_sync'
	| 'visual_plan'
	| 'captions'
	| 'preview_render'
	| 'gate_h'
	| 'master_render';

export interface RecapPhase3Checkpoint {
	schemaVersion: 1;
	chapterId: string;
	renderTarget: 'preview' | 'master';
	completedStages: RecapPhase3Stage[];
	lastUpdatedAtIso: string;
	synthesizedSegments?: SynthesizedSceneAudio[];
	planPath?: string;
	captionsPath?: string;
	previewMp4Path?: string;
	masterMp4Path?: string;
	gateHVerdict?: GateHVerdict;
	warnings: string[];
}

export type GateHVerdict = 'pass' | 'needs_review' | 'fail';

export type GateHIssueCode =
	| 'audio_clipped'
	| 'duplicate_consecutive_panel'
	| 'visual_coverage_gap'
	| 'scene_order_violation'
	| 'balloon_readability_risk'
	| 'missing_panel_file'
	| 'synthetic_fixture_unapproved'
	| 'mp4_probe_mismatch'
	| 'framing_crop_risk';

export interface GateHFinding {
	code: GateHIssueCode;
	severity: 'critical' | 'warning';
	sceneId?: string;
	shotId?: string;
	detail: string;
}

export interface GateHReport {
	gate: 'H_audiovisual_quality';
	verdict: GateHVerdict;
	checkedAtIso: string;
	reasons: string[];
	metrics: Record<string, number | string | boolean>;
	findings: GateHFinding[];
}

export interface RecapVisualPlannerOptions {
	renderTarget?: 'preview' | 'master';
	aspectRatio?: '16:9' | '9:16';
	width?: number;
	height?: number;
	fps?: number;
	platform?: LoudnessPlatform;
	captionStyle?: SmartCaptionStyle;
	isSyntheticFixture?: boolean;
	approvalStatus?: RecapScriptApprovalStatus;
}
