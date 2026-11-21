/**
 * Aethera Recap — Phase 3.2 Real TTS Adapters & Narration Audio Quality Audit
 *
 * Reuses existing Aethera Studio TTS infrastructure:
 * - ElevenLabs (`../../render/elevenlabs-tts.js`)
 * - VoiceStudio HTTP (`http://localhost:3900/v1/audio/speech`)
 * - Windows SAPI (`System.Speech.Synthesis.SpeechSynthesizer`)
 * - Chained fallback with real duration measurement and PCM quality audit
 *   (detects clipping, excessive silence, and insufficient duration).
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { promisify } from 'node:util';
import { synthesizeElevenLabsWav } from '../../render/elevenlabs-tts.js';
import type { RecapTtsSynthesisPort, SynthesizedSceneAudio } from './recap-audiovisual-types.js';
import { createDeterministicFallbackTtsPort } from './recap-mp4-renderer.js';

const execFileAsync = promisify(execFile);

export interface NarrationAudioAudit {
	ok: boolean;
	durationMs: number;
	peakDbfs: number;
	silenceRatio: number;
	clippedSamples: number;
	issues: string[];
}

/**
 * Measures real WAV/audio duration in milliseconds using ffprobe, with a
 * deterministic RIFF/PCM header fallback when ffprobe is unavailable.
 */
export async function measureAudioFileDurationMs(filePath: string): Promise<number> {
	if (!existsSync(filePath)) return 0;
	try {
		const { stdout } = await execFileAsync(
			'ffprobe',
			['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
			{ timeout: 10_000, windowsHide: true },
		);
		const sec = Number.parseFloat(stdout.trim());
		if (Number.isFinite(sec) && sec > 0) return Math.round(sec * 1000);
	} catch {
		// Fall through to RIFF/WAV header parsing
	}
	try {
		const buf = readFileSync(filePath);
		if (buf.length >= 44 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
			const byteRate = buf.readUInt32LE(28);
			const dataSize = buf.readUInt32LE(40);
			if (byteRate > 0 && dataSize > 0) return Math.round((dataSize / byteRate) * 1000);
		}
	} catch {
		// ignore
	}
	return 0;
}

/**
 * Audits a 16-bit PCM WAV narration clip for clipping, excessive silence,
 * and insufficient duration.
 */
export async function auditNarrationAudioClip(
	wavPath: string,
	options?: { minDurationMs?: number; maxSilenceRatio?: number },
): Promise<NarrationAudioAudit> {
	const minDurationMs = options?.minDurationMs ?? 400;
	const maxSilenceRatio = options?.maxSilenceRatio ?? 0.65;
	const issues: string[] = [];

	if (!existsSync(wavPath) || statSync(wavPath).size < 44) {
		return {
			ok: false,
			durationMs: 0,
			peakDbfs: -96,
			silenceRatio: 1,
			clippedSamples: 0,
			issues: ['Arquivo de áudio ausente ou corrompido (< 44 bytes).'],
		};
	}

	const durationMs = await measureAudioFileDurationMs(wavPath);
	if (durationMs < minDurationMs) {
		issues.push(`Duração insuficiente (${durationMs}ms < mínimo ${minDurationMs}ms).`);
	}

	const buf = readFileSync(wavPath);
	let peakAbs = 0;
	let silentSamples = 0;
	let clippedSamples = 0;
	let totalSamples = 0;

	if (buf.length >= 44 && buf.toString('ascii', 0, 4) === 'RIFF') {
		const bitsPerSample = buf.readUInt16LE(34);
		if (bitsPerSample === 16) {
			for (let offset = 44; offset + 1 < buf.length; offset += 2) {
				const sample = Math.abs(buf.readInt16LE(offset));
				totalSamples++;
				if (sample > peakAbs) peakAbs = sample;
				if (sample < 120) silentSamples++;
				if (sample >= 32700) clippedSamples++;
			}
		}
	}

	const peakDbfs = peakAbs > 0 ? Number((20 * Math.log10(peakAbs / 32768)).toFixed(2)) : -96;
	const silenceRatio = totalSamples > 0 ? Number((silentSamples / totalSamples).toFixed(3)) : 0;

	if (totalSamples > 0 && silenceRatio > maxSilenceRatio) {
		issues.push(`Silêncio excessivo detectado (${Math.round(silenceRatio * 100)}% do clipe).`);
	}
	if (totalSamples > 0 && clippedSamples / totalSamples > 0.01) {
		issues.push(`Clipping de áudio detectado (${clippedSamples} amostras saturadas, pico ${peakDbfs} dBFS).`);
	}

	return {
		ok: issues.length === 0,
		durationMs,
		peakDbfs,
		silenceRatio,
		clippedSamples,
		issues,
	};
}

export function createVoiceStudioRecapTtsPort(options: {
	baseUrl?: string;
	voiceId: string;
	modelId?: string;
	speed?: number;
	language?: string;
	pauseAfterMs?: number;
}): RecapTtsSynthesisPort {
	const baseUrl = (options.baseUrl ?? process.env['NB_VOICESTUDIO_URL'] ?? 'http://127.0.0.1:3900').replace(/\/+$/, '');
	const pauseAfterMs = options.pauseAfterMs ?? 300;
	const modelId = options.modelId ?? 'tts-1';
	const speed = options.speed ?? 1.0;
	const language = options.language ?? 'pt-BR';

	const callVoiceStudio = async (text: string, outputPath: string) => {
		const res = await fetch(`${baseUrl}/v1/audio/speech`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				model: modelId,
				voice: options.voiceId,
				input: text,
				speed,
				response_format: 'wav',
			}),
			signal: AbortSignal.timeout(120_000),
		});
		if (!res.ok) {
			throw new Error(`VoiceStudio HTTP ${res.status}`);
		}
		const arr = Buffer.from(await res.arrayBuffer());
		writeFileSync(outputPath, arr);
		const speechDurationMs = await measureAudioFileDurationMs(outputPath);
		if (speechDurationMs <= 0) throw new Error('VoiceStudio retornou WAV sem duração válida.');
		return speechDurationMs;
	};

	return {
		name: `voicestudio-tts[${options.voiceId}]`,
		async synthesizeScene(input): Promise<SynthesizedSceneAudio> {
			const speechDurationMs = await callVoiceStudio(input.text, input.outputPath);
			return {
				sceneId: input.sceneId,
				audioPath: input.outputPath,
				speechDurationMs,
				pauseAfterMs,
				provider: 'voicestudio_tts',
				voiceId: options.voiceId,
				modelId,
				speed,
				language,
				sessionMode: 'chunked',
				isFallback: false,
			};
		},
		async synthesizeContinuous(input): Promise<SynthesizedSceneAudio> {
			const speechDurationMs = await callVoiceStudio(input.fullText, input.outputPath);
			return {
				sceneId: `${input.chapterId}_continuous`,
				audioPath: input.outputPath,
				speechDurationMs,
				pauseAfterMs,
				provider: 'voicestudio_tts',
				voiceId: options.voiceId,
				modelId,
				speed,
				language,
				sessionMode: 'single_session',
				isFallback: false,
			};
		},
	};
}

export function createElevenLabsRecapTtsPort(options: {
	apiKey: string;
	voiceId: string;
	modelId?: string;
	pauseAfterMs?: number;
}): RecapTtsSynthesisPort {
	const pauseAfterMs = options.pauseAfterMs ?? 300;
	const modelId = options.modelId ?? 'eleven_multilingual_v2';
	return {
		name: `elevenlabs-tts[${options.voiceId}]`,
		async synthesizeScene(input): Promise<SynthesizedSceneAudio> {
			await synthesizeElevenLabsWav({
				apiKey: options.apiKey,
				voiceId: options.voiceId,
				text: input.text,
				outWavPath: input.outputPath,
				modelId,
			});
			const speechDurationMs = await measureAudioFileDurationMs(input.outputPath);
			return {
				sceneId: input.sceneId,
				audioPath: input.outputPath,
				speechDurationMs: speechDurationMs > 0 ? speechDurationMs : Math.round(input.estimatedDurationSec * 1000),
				pauseAfterMs,
				provider: 'elevenlabs_tts',
				voiceId: options.voiceId,
				modelId,
				speed: 1.0,
				language: 'pt-BR',
				sessionMode: 'chunked',
				isFallback: false,
			};
		},
		async synthesizeContinuous(input): Promise<SynthesizedSceneAudio> {
			await synthesizeElevenLabsWav({
				apiKey: options.apiKey,
				voiceId: options.voiceId,
				text: input.fullText,
				outWavPath: input.outputPath,
				modelId,
			});
			const speechDurationMs = await measureAudioFileDurationMs(input.outputPath);
			return {
				sceneId: `${input.chapterId}_continuous`,
				audioPath: input.outputPath,
				speechDurationMs: speechDurationMs > 0 ? speechDurationMs : Math.round(input.estimatedDurationSec * 1000),
				pauseAfterMs,
				provider: 'elevenlabs_tts',
				voiceId: options.voiceId,
				modelId,
				speed: 1.0,
				language: 'pt-BR',
				sessionMode: 'single_session',
				isFallback: false,
			};
		},
	};
}

export function createWindowsSapiRecapTtsPort(options?: {
	voiceName?: string;
	rate?: number;
	pauseAfterMs?: number;
}): RecapTtsSynthesisPort {
	const pauseAfterMs = options?.pauseAfterMs ?? 300;
	const voiceLabel = options?.voiceName ?? 'windows-sapi-default';
	const rate = options?.rate ?? 0;

	const speakToWav = async (text: string, outputPath: string) => {
		if (process.platform !== 'win32') {
			throw new Error('Windows SAPI TTS disponível apenas no Windows (win32).');
		}
		const escapedText = text.replaceAll("'", "''");
		const escapedOut = outputPath.replaceAll("'", "''");
		const voiceCmd = options?.voiceName ? `$s.SelectVoice('${options.voiceName.replaceAll("'", "''")}');` : '';
		const rateCmd = `$s.Rate = ${Math.max(-10, Math.min(10, Math.round(rate)))};`;
		const script = `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ${voiceCmd} ${rateCmd} $s.SetOutputToWaveFile('${escapedOut}'); $s.Speak('${escapedText}'); $s.Dispose();`;
		await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
			timeout: 90_000,
			windowsHide: true,
		});
		const speechDurationMs = await measureAudioFileDurationMs(outputPath);
		if (speechDurationMs <= 0) throw new Error('Windows SAPI não gerou WAV válido.');
		return speechDurationMs;
	};

	return {
		name: 'windows-sapi-tts',
		async synthesizeScene(input): Promise<SynthesizedSceneAudio> {
			const speechDurationMs = await speakToWav(input.text, input.outputPath);
			return {
				sceneId: input.sceneId,
				audioPath: input.outputPath,
				speechDurationMs,
				pauseAfterMs,
				provider: 'windows_sapi_tts',
				voiceId: voiceLabel,
				modelId: 'sapi',
				speed: 1.0,
				language: 'pt-BR',
				sessionMode: 'chunked',
				isFallback: false,
			};
		},
		async synthesizeContinuous(input): Promise<SynthesizedSceneAudio> {
			const speechDurationMs = await speakToWav(input.fullText, input.outputPath);
			return {
				sceneId: `${input.chapterId}_continuous`,
				audioPath: input.outputPath,
				speechDurationMs,
				pauseAfterMs,
				provider: 'windows_sapi_tts',
				voiceId: voiceLabel,
				modelId: 'sapi',
				speed: 1.0,
				language: 'pt-BR',
				sessionMode: 'single_session',
				isFallback: false,
			};
		},
	};
}

/**
 * Chained TTS port with STRICT single-provider locking per video (Phase 4):
 * Once a real provider succeeds for the video, it is locked for all subsequent blocks —
 * NEVER silently mixes two different TTS voices/providers in the same video.
 */
export function createChainedRecapTtsPort(input: {
	ports: readonly RecapTtsSynthesisPort[];
	allowDeterministicFallback?: boolean;
}): RecapTtsSynthesisPort {
	const fallback = createDeterministicFallbackTtsPort();
	let lockedPort: RecapTtsSynthesisPort | null = null;

	return {
		name: `chained-tts[${input.ports.map((p) => p.name).join(',')}]`,
		async synthesizeScene(req): Promise<SynthesizedSceneAudio> {
			if (lockedPort) {
				// Never silently switch to a different voice mid-video
				return lockedPort.synthesizeScene(req);
			}
			const errors: string[] = [];
			for (const port of input.ports) {
				try {
					const result = await port.synthesizeScene(req);
					lockedPort = port;
					return result;
				} catch (err) {
					errors.push(`${port.name}: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
			if (input.allowDeterministicFallback) {
				lockedPort = fallback;
				return fallback.synthesizeScene(req);
			}
			throw new Error(`Nenhum provedor TTS disponível: ${errors.join(' | ')}`);
		},
		async synthesizeContinuous(req): Promise<SynthesizedSceneAudio> {
			const candidates = lockedPort ? [lockedPort] : input.ports;
			const errors: string[] = [];
			for (const port of candidates) {
				if (!port.synthesizeContinuous) continue;
				try {
					const result = await port.synthesizeContinuous(req);
					lockedPort = port;
					return result;
				} catch (err) {
					errors.push(`${port.name}: ${err instanceof Error ? err.message : String(err)}`);
				}
			}
			throw new Error(`Nenhum provedor TTS contínuo disponível: ${errors.join(' | ')}`);
		},
	};
}
