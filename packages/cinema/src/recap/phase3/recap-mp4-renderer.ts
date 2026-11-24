/**
 * Aethera Recap — Phase 3 MP4 Renderer, Stage Checkpoints & Deterministic Audio Fallback
 *
 * Renders a real H.264/AAC MP4 from a RecapScript + ExtractedPanel[] using FFmpeg:
 * - Ken Burns / pan motion per panel shot (respecting balloon-safe zones)
 * - Audio-First narration synchronization (never clips speech)
 * - Background music bed with FFmpeg sidechain ducking + EBU R128 loudnorm
 * - Synchronized ASS subtitles (burn-in when libass is available, always exported as .ass)
 * - Atomic durable checkpoints per stage so interrupted runs resume cleanly
 * - Preview-before-master review gate
 */

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { ExtractedPanel, PanelAnalysis, RecapScript } from '../recap-types.js';
import type {
	GateHReport,
	RecapAudiovisualPlan,
	RecapPanelShot,
	RecapSfxKind,
	RecapPhase3Checkpoint,
	RecapPhase3Stage,
	RecapTtsSynthesisPort,
	RecapVisualPlannerOptions,
	SynthesizedSceneAudio,
} from './recap-audiovisual-types.js';
import { buildRecapAudiovisualPlan } from './recap-visual-planner.js';
import { runGateHAudiovisualQuality } from './recap-gate-h-quality.js';
import { auditNarrationAudioClip } from './recap-tts-adapters.js';
import { buildMultiPanelFilterComplex, buildShotZoompanFilter, buildVerticalPanelFilterComplex, MOTIONVELIX_SFX_MAP, type MotionVelixRenderReport } from './recap-motionvelix.js';
import type { RecapVfxSpec } from './recap-audiovisual-types.js';
import {
	alignBeatsToRealWavAudio,
	buildNarrativeBeatAlignments,
	runGateISemanticSync,
	runGateJVoiceConsistency,
	transcribeWavWordTimestamps,
	type AlignedBeatInterval,
	type GateIReport,
	type GateJReport,
} from './recap-semantic-alignment.js';

const execFileAsync = promisify(execFile);
const PHASE3_CKPT_FILE = 'recap-phase3-checkpoint.json';

export function savePhase3Checkpoint(checkpointDir: string, ckpt: RecapPhase3Checkpoint): void {
	if (!existsSync(checkpointDir)) mkdirSync(checkpointDir, { recursive: true });
	const target = join(checkpointDir, PHASE3_CKPT_FILE);
	const tmp = join(checkpointDir, `${PHASE3_CKPT_FILE}.tmp.${process.pid}.${Date.now()}`);
	writeFileSync(tmp, JSON.stringify(ckpt, null, 2), 'utf-8');
	renameSync(tmp, target);
}

export function loadPhase3Checkpoint(checkpointDir: string): RecapPhase3Checkpoint | null {
	const target = join(checkpointDir, PHASE3_CKPT_FILE);
	if (!existsSync(target)) return null;
	try {
		return JSON.parse(readFileSync(target, 'utf-8')) as RecapPhase3Checkpoint;
	} catch {
		return null;
	}
}

/**
 * Writes a valid 16-bit PCM mono WAV (44.1kHz) with a gentle, low-level speech-cadence
 * tone bed for deterministic offline technical testing when no TTS provider is active.
 */
function writeDeterministicCadenceWav(filePath: string, durationMs: number, frequencyHz = 220): void {
	const sampleRate = 44100;
	const numSamples = Math.max(1, Math.round((durationMs / 1000) * sampleRate));
	const dataSize = numSamples * 2;
	const buf = Buffer.alloc(44 + dataSize);

	buf.write('RIFF', 0);
	buf.writeUInt32LE(36 + dataSize, 4);
	buf.write('WAVE', 8);
	buf.write('fmt ', 12);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20); // PCM
	buf.writeUInt16LE(1, 22); // mono
	buf.writeUInt32LE(sampleRate, 24);
	buf.writeUInt32LE(sampleRate * 2, 28);
	buf.writeUInt16LE(2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write('data', 36);
	buf.writeUInt32LE(dataSize, 40);

	// Gentle modulated cadence envelope so sidechain ducking is exercised realistically
	for (let i = 0; i < numSamples; i++) {
		const t = i / sampleRate;
		const envelope = 0.5 + 0.5 * Math.sin(2 * Math.PI * 3.0 * t);
		const sample = Math.round(Math.sin(2 * Math.PI * frequencyHz * t) * 3200 * envelope);
		buf.writeInt16LE(sample, 44 + i * 2);
	}
	writeFileSync(filePath, buf);
}

/**
 * Deterministic fallback TTS port for offline technical previews and tests.
 * Never depends on external AI APIs; explicitly marks outputs as `isFallback: true`.
 */
export function createDeterministicFallbackTtsPort(): RecapTtsSynthesisPort {
	return {
		name: 'deterministic-technical-fallback-tts',
		async synthesizeScene(input) {
			const words = input.text.trim().split(/\s+/).filter(Boolean).length;
			const speechDurationMs = Math.max(1200, Math.round(Math.max(input.estimatedDurationSec, words / 2.6) * 1000));
			writeDeterministicCadenceWav(input.outputPath, speechDurationMs, 210);
			return {
				sceneId: input.sceneId,
				audioPath: input.outputPath,
				speechDurationMs,
				pauseAfterMs: 300,
				provider: 'deterministic-technical-fallback-tts',
				isFallback: true,
			};
		},
	};
}


/**
 * Resolves a real MotionVelix SFX WAV file on disk if available.
 */
export function resolveMotionVelixSfxFile(sfxKind: RecapSfxKind, sfxDir: string): string | null {
	const candidate = join(sfxDir, MOTIONVELIX_SFX_MAP[sfxKind]);
	return existsSync(candidate) ? candidate : null;
}

/**
 * Deterministic hash for partial per-shot rendering (Phase 3.4):
 * unchanged shots reuse their already-encoded MP4 clip.
 */
export function computeShotRenderHash(
	shot: RecapPanelShot,
	width: number,
	height: number,
	fps: number,
	vfx?: RecapVfxSpec,
): string {
	return createHash('sha256')
		.update(JSON.stringify({
			imagePath: shot.imagePath,
			durationMs: shot.durationMs,
			motionStyle: shot.motionStyle,
			transitionIn: shot.transitionIn,
			focalStart: shot.focalStart,
			focalEnd: shot.focalEnd,
			layout: shot.layout ?? null,
			vfx: vfx ?? null,
			width,
			height,
			fps,
		}))
		.digest('hex')
		.slice(0, 16);
}

export interface RecapMp4Probe {
	hasVideo: boolean;
	hasAudio: boolean;
	durationMs: number;
	width: number;
	height: number;
	videoDurationMs: number;
	audioDurationMs: number;
	formatDurationMs: number;
	timestampsValid: boolean;
	audioSampleRateHz?: number;
	decodeOk?: boolean;
	decodeError?: string;
}

async function probeMp4(mp4Path: string): Promise<RecapMp4Probe> {
	const { stdout } = await execFileAsync(
		'ffprobe',
		['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,duration,start_time,sample_rate,width,height', '-of', 'json', mp4Path],
		{ timeout: 15_000, windowsHide: true },
	);
	const parsed = JSON.parse(stdout) as {
		streams?: Array<{ codec_type?: string; duration?: string; start_time?: string; sample_rate?: string; width?: number; height?: number }>;
		format?: { duration?: string };
	};
	const streams = parsed.streams ?? [];
	const hasVideo = streams.some((s) => s.codec_type === 'video');
	const audioStream = streams.find((s) => s.codec_type === 'audio');
	const videoStream = streams.find((s) => s.codec_type === 'video');
	const hasAudio = Boolean(audioStream);
	const sampleRateNum = audioStream?.sample_rate ? Number.parseInt(audioStream.sample_rate, 10) : undefined;
	const durationSec = Number.parseFloat(parsed.format?.duration ?? '0');
	const videoDurationSec = Number.parseFloat(videoStream?.duration ?? '0');
	const audioDurationSec = Number.parseFloat(audioStream?.duration ?? '0');
	const formatDurationMs = Number.isFinite(durationSec) ? Math.round(durationSec * 1000) : 0;
	const avStreams = streams.filter((stream) => stream.codec_type === 'video' || stream.codec_type === 'audio');
	const timestampsValid = avStreams.length > 0 && avStreams.every((stream) => {
		const startSec = Number.parseFloat(stream.start_time ?? '0');
		const streamDurationSec = Number.parseFloat(stream.duration ?? String(durationSec));
		return Number.isFinite(startSec) && startSec >= -0.25 && Number.isFinite(streamDurationSec) && streamDurationSec > 0;
	});
	return {
		hasVideo,
		hasAudio,
		durationMs: formatDurationMs,
		videoDurationMs: Number.isFinite(videoDurationSec) && videoDurationSec > 0 ? Math.round(videoDurationSec * 1000) : formatDurationMs,
		audioDurationMs: Number.isFinite(audioDurationSec) && audioDurationSec > 0 ? Math.round(audioDurationSec * 1000) : formatDurationMs,
		formatDurationMs,
		timestampsValid,
		width: Number.isFinite(videoStream?.width) ? videoStream!.width! : 0,
		height: Number.isFinite(videoStream?.height) ? videoStream!.height! : 0,
		...(sampleRateNum && Number.isFinite(sampleRateNum) ? { audioSampleRateHz: sampleRateNum } : {}),
	};
}

async function validateRenderedMp4(mp4Path: string): Promise<RecapMp4Probe> {
	const probe = await probeMp4(mp4Path);
	try {
		await execFileAsync('ffmpeg', ['-v', 'error', '-i', mp4Path, '-f', 'null', '-'], { timeout: 60_000, windowsHide: true });
		return { ...probe, decodeOk: true };
	} catch (err) {
		return {
			...probe,
			decodeOk: false,
			decodeError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
		};
	}
}

export function computeAudioCheckpointKey(input: {
	script: RecapScript;
	ttsProviderIdentity: string;
	preferContinuous: boolean;
}): string {
	return createHash('sha256')
		.update(JSON.stringify({
			version: 2,
			chapterId: input.script.chapterId,
			style: input.script.style,
			scenes: input.script.scenes.map((scene) => ({ sceneId: scene.sceneId, narrationText: scene.narrationText })),
			ttsProviderIdentity: input.ttsProviderIdentity,
			preferContinuous: input.preferContinuous,
		}))
		.digest('hex');
}

export interface RenderRecapVideoInput {
	script: RecapScript;
	panels: readonly ExtractedPanel[];
	/** Optional multimodal panel analyses for semantic event-to-panel alignment (Phase 2). */
	analyses?: readonly PanelAnalysis[];
	outputDir: string;
	checkpointDir?: string;
	ttsPort?: RecapTtsSynthesisPort;
	/** Prefer single continuous TTS synthesis session for consistent voice tone/timbre (Phase 5). Default: true. */
	preferContinuousNarration?: boolean;
	/** Stable provider/voice/model identity used to invalidate incompatible audio checkpoints. */
	ttsCheckpointIdentity?: string;
	musicBedPath?: string;
	/** Directory containing MotionVelix SFX WAVs (e.g. .agents/skills/motionvelix/assets/sfx). */
	sfxAssetsDir?: string;
	/** Burn ASS captions into video stream when libass is available. Default: false (exports external .ass). */
	burnSubtitles?: boolean;
	plannerOptions?: RecapVisualPlannerOptions;
	/** Set to true only after preview review to authorize master export. */
	masterApproved?: boolean;
	/** Skip actual FFmpeg invocation (for fast unit tests validating plan/checkpoints). */
	dryRunRender?: boolean;
}

export interface RenderRecapVideoResult {
	plan: RecapAudiovisualPlan;
	gateHReport: GateHReport;
	gateIReport: GateIReport;
	gateJReport: GateJReport;
	alignedBeats: AlignedBeatInterval[];
	checkpoint: RecapPhase3Checkpoint;
	planPath: string;
	captionsPath: string;
	mp4Path: string | null;
	mp4Probe?: RecapMp4Probe;
	reusedShotsCount: number;
	renderedShotsCount: number;
	sfxAppliedCount: number;
	subtitlesBurnedIn: boolean;
	motionVelix: MotionVelixRenderReport;
	warnings: string[];
}

export async function renderRecapVideo(input: RenderRecapVideoInput): Promise<RenderRecapVideoResult> {
	const { script, panels, outputDir, plannerOptions = {}, dryRunRender = false } = input;
	const renderTarget = plannerOptions.renderTarget ?? 'preview';

	if (renderTarget === 'master' && !input.masterApproved) {
		throw new Error('preview_review_required: gere e revise a prévia antes da exportação final (masterApproved: true).');
	}

	const checkpointDir = input.checkpointDir ?? join(outputDir, 'checkpoints');
	const audioDir = join(outputDir, 'audio');
	const shotsDir = join(outputDir, 'shots');
	mkdirSync(outputDir, { recursive: true });
	mkdirSync(checkpointDir, { recursive: true });
	mkdirSync(audioDir, { recursive: true });
	mkdirSync(shotsDir, { recursive: true });

	const existing = loadPhase3Checkpoint(checkpointDir);
	const completedStages = new Set<RecapPhase3Stage>(existing?.completedStages ?? []);
	const warnings: string[] = [...(existing?.warnings ?? [])];

	// ─── Stage 1: Audio Synthesis & Measurement ──────────────────────────────
	let synthesizedSegments: SynthesizedSceneAudio[] = existing?.synthesizedSegments ?? [];

	// Fase 2 (reforço): NUNCA criar fallback determinístico silenciosamente.
	// Se nenhum ttsPort real foi fornecido, o pipeline DEVE falhar explicitamente.
	if (!input.ttsPort) {
		throw new Error(
			'Narração obrigatória: nenhum provedor TTS foi configurado ou repassado ao renderer. ' +
			'Configure ElevenLabs (NB_ELEVENLABS_API_KEY), VoiceStudio (NB_VOICESTUDIO_URL) ou Windows SAPI antes de produzir.',
		);
	}
	const ttsPort = input.ttsPort;

	const preferContinuous = input.preferContinuousNarration ?? true;
	const audioCheckpointKey = computeAudioCheckpointKey({
		script,
		ttsProviderIdentity: input.ttsCheckpointIdentity ?? ttsPort.name,
		preferContinuous,
	});
	const fullNarrationText = script.scenes
		.map((s) => s.narrationText.trim())
		.filter(Boolean)
		.join(' ');
	const canSynthesizeContinuous =
		preferContinuous &&
		typeof ttsPort.synthesizeContinuous === 'function' &&
		fullNarrationText.length > 0 &&
		fullNarrationText.length <= 2500;

	const hasValidAudioCheckpoint =
		completedStages.has('audio_sync') &&
		existing?.audioCheckpointKey === audioCheckpointKey &&
		synthesizedSegments.length > 0 &&
		synthesizedSegments.every((seg) => existsSync(seg.audioPath)) &&
		(synthesizedSegments.length === script.scenes.length ||
			(synthesizedSegments.length === 1 && synthesizedSegments[0]!.sessionMode === 'single_session'));

	if (!hasValidAudioCheckpoint) {
		synthesizedSegments = [];
		const ttsErrors: string[] = [];

		if (canSynthesizeContinuous) {
			const continuousWavPath = join(audioDir, 'narration-continuous.wav');
			const totalEstimatedSec = script.scenes.reduce((s, sc) => s + Math.max(1, sc.estimatedDurationSec), 0);
			try {
				const continuousSeg = await ttsPort.synthesizeContinuous!({
					chapterId: script.chapterId,
					fullText: fullNarrationText,
					estimatedDurationSec: totalEstimatedSec,
					outputPath: continuousWavPath,
				});
				const audit = await auditNarrationAudioClip(continuousWavPath, { minDurationMs: 400, maxSilenceRatio: 0.65 });
				if (!audit.ok && !continuousSeg.isFallback) {
					throw new Error(`Áudio contínuo inválido: ${audit.issues.join('; ')}`);
				}
				synthesizedSegments.push(continuousSeg);
			} catch (err) {
				if (err instanceof Error && err.name === 'RecapBudgetExceededError') throw err;
				const msg = err instanceof Error ? err.message : String(err);
				ttsErrors.push(`continuous-narration: ${msg}`);
			}
		} else {
			for (const scene of script.scenes) {
				const wavPath = join(audioDir, `${scene.sceneId}.wav`);
				try {
					const seg = await ttsPort.synthesizeScene({
						sceneId: scene.sceneId,
						text: scene.narrationText,
						emotion: scene.emotion,
						estimatedDurationSec: scene.estimatedDurationSec,
						outputPath: wavPath,
					});
					// Fase 2: validar integridade do áudio gerado antes de aceitar
					const audit = await auditNarrationAudioClip(wavPath, { minDurationMs: 400, maxSilenceRatio: 0.65 });
					if (!audit.ok && !seg.isFallback) {
						throw new Error(`Áudio de narração inválido na cena ${scene.sceneId}: ${audit.issues.join('; ')}`);
					}
					synthesizedSegments.push(seg);
				} catch (err) {
					if (err instanceof Error && err.name === 'RecapBudgetExceededError') throw err;
					const msg = err instanceof Error ? err.message : String(err);
					ttsErrors.push(`${scene.sceneId}: ${msg}`);
					// Provedor real falhou — interrompe imediatamente, sem fallback silencioso
					break;
				}
			}
		}

		if (ttsErrors.length > 0 && synthesizedSegments.length === 0) {
			throw new Error(
				`Narração obrigatória falhou. O pipeline não prossegue sem TTS real. Erros: ${ttsErrors.join(' | ')}`,
			);
		}
		if (!canSynthesizeContinuous && ttsErrors.length > 0 && synthesizedSegments.length < script.scenes.length) {
			throw new Error(
				`Narração obrigatória falhou em ${ttsErrors.length} cena(s). O pipeline não prossegue sem TTS real. Erros: ${ttsErrors.join(' | ')}`,
			);
		}

		completedStages.add('audio_sync');
		savePhase3Checkpoint(checkpointDir, {
			schemaVersion: 1,
			chapterId: script.chapterId,
			renderTarget,
			completedStages: [...completedStages],
			lastUpdatedAtIso: new Date().toISOString(),
			synthesizedSegments,
			audioCheckpointKey,
			warnings,
		});
	}

	const narrationAudits = await Promise.all(
		synthesizedSegments.map(async (segment) => ({
			sceneId: segment.sceneId,
			...(await auditNarrationAudioClip(segment.audioPath, { minDurationMs: 400, maxSilenceRatio: 0.65 })),
		})),
	);

	// ─── Stage 2 & 3: Semantic Event-to-Panel Alignment + Visual Plan + Captions ──
	const rawBeatAlignments = buildNarrativeBeatAlignments({
		script,
		analyses: input.analyses ?? [],
	});

	let alignedBeats: AlignedBeatInterval[] = [];
	const isSingleContinuousSession =
		synthesizedSegments.length === 1 &&
		synthesizedSegments[0]!.sessionMode === 'single_session' &&
		existsSync(synthesizedSegments[0]!.audioPath);

	if (isSingleContinuousSession) {
		const wordTimestamps = dryRunRender
			? null
			: await transcribeWavWordTimestamps(synthesizedSegments[0]!.audioPath, {
					language: synthesizedSegments[0]!.language?.slice(0, 2) ?? 'pt',
				});
		const alignmentResult = alignBeatsToRealWavAudio({
			alignments: rawBeatAlignments,
			wavPath: synthesizedSegments[0]!.audioPath,
			tailPaddingMs: 300,
			wordTimestamps,
		});
		alignedBeats = alignmentResult.alignedBeats;
	} else {
		// Align each scene's beats against its own synthesized WAV and shift by cumulative offset
		let offsetMs = 0;
		for (let i = 0; i < script.scenes.length; i++) {
			const scene = script.scenes[i]!;
			const seg = synthesizedSegments[i];
			const sceneBeats = rawBeatAlignments.filter((b) => b.sceneId === scene.sceneId);
			if (seg && existsSync(seg.audioPath) && sceneBeats.length > 0) {
				const localResult = alignBeatsToRealWavAudio({
					alignments: sceneBeats,
					wavPath: seg.audioPath,
					tailPaddingMs: seg.pauseAfterMs,
				});
				for (const b of localResult.alignedBeats) {
					alignedBeats.push({
						...b,
						speechStartMs: b.speechStartMs + offsetMs,
						speechEndMs: b.speechEndMs + offsetMs,
						displayStartMs: b.displayStartMs + offsetMs,
						displayEndMs: b.displayEndMs + offsetMs,
					});
				}
				offsetMs += seg.speechDurationMs + seg.pauseAfterMs;
			}
		}
	}

	const plan = buildRecapAudiovisualPlan({
		script,
		panels,
		measuredSegments: synthesizedSegments.map((s) => ({
			segmentId: s.sceneId,
			speechDurationMs: s.speechDurationMs,
			pauseAfterMs: s.pauseAfterMs,
		})),
		...(alignedBeats.length > 0 ? { alignedBeats } : {}),
		options: plannerOptions,
	});

	const planPath = join(outputDir, 'recap-audiovisual-plan.json');
	const captionsPath = join(outputDir, 'recap-captions.ass');
	writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf-8');
	writeFileSync(captionsPath, plan.captions.ass, 'utf-8');
	completedStages.add('visual_plan');
	completedStages.add('captions');

	savePhase3Checkpoint(checkpointDir, {
		schemaVersion: 1,
		chapterId: script.chapterId,
		renderTarget,
		completedStages: [...completedStages],
		lastUpdatedAtIso: new Date().toISOString(),
		synthesizedSegments,
		audioCheckpointKey,
		planPath,
		captionsPath,
		warnings,
	});

	// ─── Stage 4: Render MP4 via FFmpeg (Motion + Ducking + Loudnorm) ────────
	let mp4Path: string | null = null;
	let mp4ProbeResult: RecapMp4Probe | undefined;
	let reusedShotsCount = 0;
	let renderedShotsCount = 0;
	let sfxAppliedCount = 0;
	const sfxKindsApplied = new Set<RecapSfxKind>();
	let vfxAppliedShots = 0;
	let transitionsApplied = 0;
	let subtitlesBurnedIn = false;
	const vfxByScene = new Map(plan.vfxSpecs.map((v) => [v.sceneId, v]));

	for (const shot of plan.shots) {
		const vfx = vfxByScene.get(shot.sceneId);
		if (vfx && (vfx.contrastBoost > 1.01 || vfx.vignetteStrength > 0.05 || (vfx.shakeIntensity > 0 && !shot.balloonSafeZoneProtected))) {
			vfxAppliedShots++;
		}
		if (shot.transitionIn !== 'cut') {
			transitionsApplied++;
		}
	}

	if (!dryRunRender) {
		const targetFile = join(outputDir, renderTarget === 'master' ? 'recap-master.mp4' : 'recap-preview.mp4');
		const shotClips: string[] = [];

		for (const shot of plan.shots) {
			const clipPath = join(shotsDir, `${shot.shotId}.mp4`);
			const hashPath = join(shotsDir, `${shot.shotId}.hash`);
			const vfx = vfxByScene.get(shot.sceneId);
			const expectedHash = computeShotRenderHash(shot, plan.width, plan.height, plan.fps, vfx);

			// Partial render cache (Phase 3.4): skip re-encoding unchanged shots
			if (existsSync(clipPath) && existsSync(hashPath) && readFileSync(hashPath, 'utf-8').trim() === expectedHash) {
				reusedShotsCount++;
				shotClips.push(clipPath);
				continue;
			}

			const multiFx = buildMultiPanelFilterComplex(shot, plan.width, plan.height, plan.fps, vfx);
			const verticalFx = multiFx ? null : buildVerticalPanelFilterComplex(shot, plan.width, plan.height, plan.fps, vfx);
			const ffmpegShotArgs = multiFx
				? [
						'-y',
						...multiFx.inputs.flatMap((img) => ['-loop', '1', '-i', img]),
						'-filter_complex', multiFx.filterComplex,
						'-map', multiFx.mapLabel,
						'-t', (shot.durationMs / 1000).toFixed(3),
						'-r', String(plan.fps),
						'-c:v', 'libx264',
						'-preset', renderTarget === 'master' ? 'medium' : 'ultrafast',
						'-pix_fmt', 'yuv420p',
						'-an',
						clipPath,
					]
				: verticalFx
				? [
						'-y',
						'-loop', '1',
						'-i', shot.imagePath,
						'-filter_complex', verticalFx.filterComplex,
						'-map', verticalFx.mapLabel,
						'-t', (shot.durationMs / 1000).toFixed(3),
						'-r', String(plan.fps),
						'-c:v', 'libx264',
						'-preset', renderTarget === 'master' ? 'medium' : 'ultrafast',
						'-pix_fmt', 'yuv420p',
						'-an',
						clipPath,
					]
				: [
						'-y',
						'-loop', '1',
						'-i', shot.imagePath,
						'-vf', buildShotZoompanFilter(shot, plan.width, plan.height, plan.fps, vfx),
						'-t', (shot.durationMs / 1000).toFixed(3),
						'-r', String(plan.fps),
						'-c:v', 'libx264',
						'-preset', renderTarget === 'master' ? 'medium' : 'ultrafast',
						'-pix_fmt', 'yuv420p',
						'-an',
						clipPath,
					];
			await execFileAsync('ffmpeg', ffmpegShotArgs, { timeout: 60_000, windowsHide: true });
			writeFileSync(hashPath, expectedHash, 'utf-8');
			renderedShotsCount++;
			shotClips.push(clipPath);
		}

		// Concatenate shot video clips
		const videoListPath = join(shotsDir, 'video-concat.txt');
		writeFileSync(
			videoListPath,
			shotClips.map((p) => `file '${p.replaceAll('\\', '/').replaceAll("'", "'\\''")}'`).join('\n'),
			'utf-8',
		);
		const concatVideoPath = join(shotsDir, 'concat-video.mp4');
		await execFileAsync(
			'ffmpeg',
			['-y', '-f', 'concat', '-safe', '0', '-i', videoListPath, '-c', 'copy', concatVideoPath],
			{ timeout: 60_000, windowsHide: true },
		);

		// Build continuous narration track (with inter-scene pauses)
		const audioFilterParts: string[] = [];
		const ffmpegAudioInputs: string[] = [];
		let streamCount = 0;
		// Fase 4: padronizar mixagem em 48 kHz para compatibilidade profissional
		const mixSampleRate = 48000;
		for (let i = 0; i < synthesizedSegments.length; i++) {
			const seg = synthesizedSegments[i]!;
			ffmpegAudioInputs.push('-i', seg.audioPath);
			const padSec = (seg.pauseAfterMs / 1000).toFixed(3);
			audioFilterParts.push(`[${i}:a]aformat=sample_fmts=fltp:sample_rates=${mixSampleRate}:channel_layouts=stereo,apad=pad_dur=${padSec}[v${i}]`);
			streamCount++;
		}
		const concatVoiceInputs = Array.from({ length: streamCount }, (_, i) => `[v${i}]`).join('');
		const totalSec = (plan.totalDurationMs / 1000).toFixed(3);

		// Soundtrack bed: apenas usa música real quando fornecida; sem fallback sintético
		// para evitar o "som de fundo estranho" (tom de 110 Hz) relatado na auditoria.
		let musicInputIdx = streamCount;
		const hasRealMusicBed = input.musicBedPath && existsSync(input.musicBedPath);
		if (hasRealMusicBed) {
			ffmpegAudioInputs.push('-stream_loop', '-1', '-i', input.musicBedPath!);
		} else {
			// Gera silêncio puro como placeholder — a narração é o áudio primário;
			// sem música real, o ducking não tem sinal lateral e a voz fica limpa.
			ffmpegAudioInputs.push('-f', 'lavfi', '-t', totalSec, '-i', `anullsrc=channel_layout=stereo:sample_rate=${mixSampleRate}`);
		}

		// Optional real MotionVelix SFX cues (Phase 3.3)
		const sfxFilterParts: string[] = [];
		const sfxLabels: string[] = [];
		if (input.sfxAssetsDir && existsSync(input.sfxAssetsDir)) {
			let nextIdx = musicInputIdx + 1;
			for (const cue of plan.sfxCues) {
				const sfxFile = resolveMotionVelixSfxFile(cue.sfxKind, input.sfxAssetsDir);
				if (!sfxFile) continue;
				ffmpegAudioInputs.push('-i', sfxFile);
				const delayMs = Math.max(0, Math.round(cue.timeMs));
				const label = `sfx${sfxAppliedCount}`;
				sfxFilterParts.push(
					`[${nextIdx}:a]aformat=sample_fmts=fltp:sample_rates=${mixSampleRate}:channel_layouts=stereo,volume=${cue.gainDb}dB,adelay=${delayMs}|${delayMs}[${label}]`,
				);
				sfxLabels.push(`[${label}]`);
				sfxKindsApplied.add(cue.sfxKind);
				sfxAppliedCount++;
				nextIdx++;
			}
		}

		const mixInputs = `[voice_mix][music_ducked]${sfxLabels.join('')}`;
		const totalMixCount = 2 + sfxLabels.length;
		const fullAudioFilter = [
			...audioFilterParts,
			`${concatVoiceInputs}concat=n=${streamCount}:v=0:a=1,apad=whole_dur=${totalSec},asplit=2[voice_mix][voice_sc]`,
			`[${musicInputIdx}:a]aformat=sample_fmts=fltp:sample_rates=${mixSampleRate}:channel_layouts=stereo,volume=${plan.ducking.musicBaseGainDb}dB,atrim=0:${totalSec}[music_raw]`,
			`[music_raw][voice_sc]${plan.ducking.sidechainFilter}[music_ducked]`,
			...sfxFilterParts,
			`${mixInputs}amix=inputs=${totalMixCount}:duration=first:dropout_transition=2,${plan.ducking.loudnormFilter}[aout]`,
		].join(';');

		const mixedAudioPath = join(audioDir, 'mixed-master.m4a');
		await execFileAsync(
			'ffmpeg',
			[
				'-y',
				...ffmpegAudioInputs,
				'-filter_complex', fullAudioFilter,
				'-map', '[aout]',
				'-t', totalSec,
				'-c:a', 'aac',
				'-ar', String(mixSampleRate),
				'-ac', '2',
				'-b:a', '192k',
				mixedAudioPath,
			],
			{ timeout: 60_000, windowsHide: true },
		);

		// Mux final MP4 (with optional ASS subtitle burn-in and graceful fallback)
		let burned = false;
		if (input.burnSubtitles) {
			try {
				const escapedAss = captionsPath.replaceAll('\\', '/').replaceAll(':', '\\:');
				await execFileAsync(
					'ffmpeg',
					[
						'-y',
						'-i', concatVideoPath,
						'-i', mixedAudioPath,
						'-vf', `ass='${escapedAss}'`,
						'-c:v', 'libx264',
						'-preset', renderTarget === 'master' ? 'medium' : 'ultrafast',
						'-pix_fmt', 'yuv420p',
						'-c:a', 'copy',
						'-t', totalSec,
						'-movflags', '+faststart',
						targetFile,
					],
					{ timeout: 90_000, windowsHide: true },
				);
				burned = true;
				subtitlesBurnedIn = true;
			} catch {
				warnings.push('Burn-in de legendas ASS indisponível neste build do FFmpeg; mantendo arquivo .ass externo sincronizado.');
			}
		}
		if (!burned) {
			await execFileAsync(
				'ffmpeg',
				[
					'-y',
					'-i', concatVideoPath,
					'-i', mixedAudioPath,
					'-c:v', 'copy',
					'-c:a', 'copy',
					'-t', totalSec,
					'-movflags', '+faststart',
					targetFile,
				],
				{ timeout: 60_000, windowsHide: true },
			);
		}

		mp4Path = targetFile;
		mp4ProbeResult = await validateRenderedMp4(targetFile);
		completedStages.add(renderTarget === 'master' ? 'master_render' : 'preview_render');
	}

	// ─── Stage 5: Gate H Audiovisual Quality Audit ───────────────────────────
	const gateHReport = runGateHAudiovisualQuality({
		plan,
		script,
		panels,
		...(mp4ProbeResult ? { mp4Probe: mp4ProbeResult } : {}),
		verifyImageFilesOnDisk: !dryRunRender,
		// Fase 7 Gates B & E: passar segmentos TTS e contagem de SFX aplicados
		synthesizedSegments: synthesizedSegments.map((seg) => ({
			sceneId: seg.sceneId,
			speechDurationMs: seg.speechDurationMs,
			provider: seg.provider,
			isFallback: seg.isFallback,
		})),
		narrationAudits,
		sfxAppliedCount,
	});
	completedStages.add('gate_h');

	const gateIReport = runGateISemanticSync({
		plan,
		panels,
		alignedBeats,
	});
	const gateJReport = runGateJVoiceConsistency({
		segments: synthesizedSegments,
		...(mp4ProbeResult?.audioSampleRateHz ? { outputSampleRateHz: mp4ProbeResult.audioSampleRateHz } : {}),
	});
	completedStages.add('gate_i');
	completedStages.add('gate_j');

	const finalCheckpoint: RecapPhase3Checkpoint = {
		schemaVersion: 1,
		chapterId: script.chapterId,
		renderTarget,
		completedStages: [...completedStages],
		lastUpdatedAtIso: new Date().toISOString(),
		synthesizedSegments,
		audioCheckpointKey,
		planPath,
		captionsPath,
		...(renderTarget === 'preview' && mp4Path ? { previewMp4Path: mp4Path } : {}),
		...(renderTarget === 'master' && mp4Path ? { masterMp4Path: mp4Path } : {}),
		gateHVerdict: gateHReport.verdict,
		gateIVerdict: gateIReport.verdict,
		gateJVerdict: gateJReport.verdict,
		warnings,
	};
	savePhase3Checkpoint(checkpointDir, finalCheckpoint);

	const gateHPath = join(outputDir, 'gate-h-report.json');
	const gateIPath = join(outputDir, 'gate-i-report.json');
	const gateJPath = join(outputDir, 'gate-j-report.json');
	writeFileSync(gateHPath, JSON.stringify(gateHReport, null, 2), 'utf-8');
	writeFileSync(gateIPath, JSON.stringify(gateIReport, null, 2), 'utf-8');
	writeFileSync(gateJPath, JSON.stringify(gateJReport, null, 2), 'utf-8');

	const motionVelix: MotionVelixRenderReport = {
		engine: 'ffmpeg_motionvelix_hybrid',
		sfxDirUsed: input.sfxAssetsDir && existsSync(input.sfxAssetsDir) ? input.sfxAssetsDir : null,
		sfxPlanned: plan.sfxCues.length,
		sfxApplied: sfxAppliedCount,
		sfxKindsApplied: [...sfxKindsApplied],
		vfxAppliedShots,
		transitionsApplied,
		motionStylesUsed: [...new Set(plan.shots.map((s) => s.motionStyle))],
		fallbackUsed: plan.sfxCues.length > 0 && sfxAppliedCount === 0,
	};

	return {
		plan,
		gateHReport,
		gateIReport,
		gateJReport,
		alignedBeats,
		checkpoint: finalCheckpoint,
		planPath,
		captionsPath,
		mp4Path,
		...(mp4ProbeResult ? { mp4Probe: mp4ProbeResult } : {}),
		reusedShotsCount,
		renderedShotsCount,
		sfxAppliedCount,
		subtitlesBurnedIn,
		motionVelix,
		warnings,
	};
}
