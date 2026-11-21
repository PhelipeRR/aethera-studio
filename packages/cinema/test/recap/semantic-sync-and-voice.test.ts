import { afterAll, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ExtractedPanel, PanelAnalysis, RecapScript } from '../../src/recap/recap-types.js';
import {
	alignBeatsToRealWavAudio,
	analyzeWavAcoustics,
	buildNarrativeBeatAlignments,
	buildRecapAudiovisualPlan,
	createChainedRecapTtsPort,
	runGateISemanticSync,
	runGateJVoiceConsistency,
	splitNarrationIntoNarrativeClauses,
	type RecapTtsSynthesisPort,
	type SynthesizedSceneAudio,
} from '../../src/recap/phase3/index.js';

const tempDir = mkdtempSync(join(tmpdir(), 'aethera-recap-sync-test-'));

afterAll(() => {
	try {
		rmSync(tempDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
});

/**
 * Writes a 16-bit PCM mono WAV with explicit alternating speech (tone) and silence segments.
 */
function writeSegmentedTestWav(
	filePath: string,
	segments: Array<{ durationMs: number; amplitude: number; freqHz?: number }>,
	sampleRate = 24000,
): void {
	const totalMs = segments.reduce((s, seg) => s + seg.durationMs, 0);
	const totalSamples = Math.max(1, Math.round((totalMs / 1000) * sampleRate));
	const dataSize = totalSamples * 2;
	const buf = Buffer.alloc(44 + dataSize);

	buf.write('RIFF', 0);
	buf.writeUInt32LE(36 + dataSize, 4);
	buf.write('WAVE', 8);
	buf.write('fmt ', 12);
	buf.writeUInt32LE(16, 16);
	buf.writeUInt16LE(1, 20);
	buf.writeUInt16LE(1, 22);
	buf.writeUInt32LE(sampleRate, 24);
	buf.writeUInt32LE(sampleRate * 2, 28);
	buf.writeUInt16LE(2, 32);
	buf.writeUInt16LE(16, 34);
	buf.write('data', 36);
	buf.writeUInt32LE(dataSize, 40);

	let sampleCursor = 0;
	for (const seg of segments) {
		const segSamples = Math.round((seg.durationMs / 1000) * sampleRate);
		const freq = seg.freqHz ?? 220;
		for (let i = 0; i < segSamples && sampleCursor < totalSamples; i++) {
			const t = sampleCursor / sampleRate;
			const val = seg.amplitude > 0 ? Math.round(Math.sin(2 * Math.PI * freq * t) * seg.amplitude) : 0;
			buf.writeInt16LE(val, 44 + sampleCursor * 2);
			sampleCursor++;
		}
	}
	writeFileSync(filePath, buf);
}

function makeFixture(): {
	panels: ExtractedPanel[];
	analyses: PanelAnalysis[];
	script: RecapScript;
} {
	const panelIds = ['p1-forest', 'p2-run', 'p3-root', 'p4-cliff'];
	const panels: ExtractedPanel[] = panelIds.map((panelId, idx) => ({
		panelId,
		pagePath: join(tempDir, `${panelId}.png`),
		croppedImagePath: join(tempDir, `${panelId}.png`),
		boundingBox: { x: 0, y: 0, width: 800, height: 1200 },
		readingOrder: idx,
		metadata: {
			pageNumber: idx,
			classification: idx === 3 ? 'dialogue' : 'action',
			aspectRatio: 0.67,
			hasDialogueHint: idx === 3,
		},
	}));

	const analyses: PanelAnalysis[] = [
		{
			panelId: 'p1-forest',
			visualDescription: 'Uma floresta densa e escura ao amanhecer.',
			setting: 'floresta fechada',
			characters: ['jovem'],
			actions: [{ actor: 'jovem', description: 'aparece na floresta' }],
			dialogues: [],
			emotion: 'suspense',
			narrativeIntent: 'establish_setting',
			importanceScore: 0.7,
		},
		{
			panelId: 'p2-run',
			visualDescription: 'O jovem corre desesperadamente entre as árvores fugindo.',
			setting: 'trilha na floresta',
			characters: ['jovem'],
			actions: [{ actor: 'jovem', description: 'corre sem parar fugindo' }],
			dialogues: [],
			emotion: 'tension',
			narrativeIntent: 'escalate_action',
			importanceScore: 0.85,
		},
		{
			panelId: 'p3-root',
			visualDescription: 'O pé do jovem tropeça em uma raiz grande no chão e ele cai.',
			setting: 'chão com raízes',
			characters: ['jovem'],
			actions: [{ actor: 'jovem', description: 'tropeça na raiz e cai no chão' }],
			dialogues: [],
			emotion: 'shock',
			narrativeIntent: 'turning_point',
			importanceScore: 0.9,
		},
		{
			panelId: 'p4-cliff',
			visualDescription: 'O jovem olha para frente à beira de um penhasco alto.',
			setting: 'beira do penhasco',
			characters: ['jovem'],
			actions: [{ actor: 'jovem', description: 'percebe o penhasco à frente' }],
			dialogues: [{ speaker: 'jovem', text: 'Não há saída!', order: 0 }],
			emotion: 'tension',
			narrativeIntent: 'cliffhanger',
			importanceScore: 0.95,
		},
	];

	const script: RecapScript = {
		schemaVersion: 1,
		chapterId: 'ch-test-sync',
		title: 'Fuga na Floresta',
		language: 'pt-BR',
		scriptStyle: 'natural_recap',
		generatedAtIso: new Date().toISOString(),
		totalEstimatedDurationSec: 18,
		scenes: [
			{
				sceneId: 'scene-1',
				panelIds,
				croppedImagePaths: panels.map((p) => p.croppedImagePath),
				narrationText:
					'A história começa em uma floresta escura. O jovem corre sem parar fugindo pelas árvores. Ele tropeça em uma raiz e cai no chão. Quando olha para frente, percebe o penhasco e grita: "Não há saída!"',
				emotion: 'tension',
				narrativeIntent: 'escalate_action',
				estimatedDurationSec: 18,
				characters: ['jovem'],
				dialoguesIncluded: ['Não há saída!'],
			},
		],
	};

	return { panels, analyses, script };
}

describe('Phase 2–8: Semantic Beat Alignment, Real WAV Sync & Voice Consistency', () => {
	test('maps each narrated clause to its matching panel in monotonic order (not equal-split)', () => {
		const { analyses, script } = makeFixture();
		const clauses = splitNarrationIntoNarrativeClauses(script.scenes[0]!.narrationText);
		expect(clauses.length).toBeGreaterThanOrEqual(4);

		const alignments = buildNarrativeBeatAlignments({ script, analyses });
		expect(alignments.length).toBe(clauses.length);
		expect(alignments[0]!.panelId).toBe('p1-forest');
		expect(alignments[alignments.length - 1]!.panelId).toBe('p4-cliff');

		// Panel order must be monotonically non-decreasing
		const panelOrder = new Map(['p1-forest', 'p2-run', 'p3-root', 'p4-cliff'].map((id, i) => [id, i]));
		for (let i = 1; i < alignments.length; i++) {
			expect(panelOrder.get(alignments[i]!.panelId)!).toBeGreaterThanOrEqual(
				panelOrder.get(alignments[i - 1]!.panelId)!,
			);
		}
	});

	test('aligns narrative beats to real WAV pauses and builds event-driven timeline without silent tail', () => {
		const { panels, analyses, script } = makeFixture();
		const wavPath = join(tempDir, 'continuous-4-clauses.wav');

		// 4 speech bursts of unequal durations separated by clear 300ms pauses
		writeSegmentedTestWav(wavPath, [
			{ durationMs: 1400, amplitude: 9000 },
			{ durationMs: 300, amplitude: 0 },
			{ durationMs: 2600, amplitude: 9000 },
			{ durationMs: 300, amplitude: 0 },
			{ durationMs: 1800, amplitude: 9000 },
			{ durationMs: 300, amplitude: 0 },
			{ durationMs: 2900, amplitude: 9000 },
			{ durationMs: 200, amplitude: 0 },
		]);

		const acoustics = analyzeWavAcoustics(wavPath);
		expect(acoustics.sampleRate).toBe(24000);
		expect(acoustics.pauseMidpointsMs.length).toBeGreaterThanOrEqual(3);
		expect(acoustics.clippedSamples).toBe(0);

		const rawBeats = buildNarrativeBeatAlignments({ script, analyses });
		const { alignedBeats: aligned } = alignBeatsToRealWavAudio({
			alignments: rawBeats,
			wavPath,
			tailPaddingMs: 300,
		});

		expect(aligned.length).toBe(rawBeats.length);
		expect(aligned.some((b) => b.alignmentMethod === 'wav_pause_aligned')).toBe(true);

		const plan = buildRecapAudiovisualPlan({
			script,
			panels,
			alignedBeats: aligned,
		});

		// Total duration MUST match real audio (~10.1s), NOT inflated to script's 18s estimate!
		expect(plan.totalDurationMs).toBeLessThan(11_500);
		expect(plan.totalDurationMs).toBeGreaterThan(9_000);
		expect(plan.beatAlignments?.length).toBe(aligned.length);

		// Shot durations must vary according to speech windows (not equal split)
		const durations = plan.shots.map((s) => s.durationMs);
		expect(new Set(durations).size).toBeGreaterThan(1);

		// Gate I must pass with zero silent tail and zero freezes
		const gateI = runGateISemanticSync({ plan, panels, alignedBeats: aligned });
		expect(gateI.verdict).toBe('pass');
		expect(gateI.metrics.silentTailExcess).toBe(false);
		expect(gateI.metrics.orderViolations).toBe(0);
	});

	test('Gate I catches artificial silent tail extension and unjustified panel freezes', () => {
		const { panels, script } = makeFixture();
		const plan = buildRecapAudiovisualPlan({ script, panels });
		// Simulate the regression bug: +10s silent tail and 13s frozen panel
		const brokenPlan = {
			...plan,
			totalDurationMs: plan.durationAudit.measuredNarrationDurationMs + 10_000,
			shots: plan.shots.map((s, idx) =>
				idx === plan.shots.length - 1 ? { ...s, durationMs: 13_000, endMs: s.startMs + 13_000 } : s,
			),
		};

		const gateI = runGateISemanticSync({ plan: brokenPlan, panels, alignedBeats: [] });
		expect(gateI.verdict).toBe('fail');
		expect(gateI.findings.some((f) => f.code === 'silent_tail_extension')).toBe(true);
		expect(gateI.findings.some((f) => f.code === 'unjustified_freeze')).toBe(true);
	});

	test('createChainedRecapTtsPort locks a single provider per video and refuses mid-video voice switch', async () => {
		let primaryCalls = 0;
		const primaryWav = join(tempDir, 'locked-primary.wav');
		writeSegmentedTestWav(primaryWav, [{ durationMs: 1500, amplitude: 8000 }]);

		const primaryPort: RecapTtsSynthesisPort = {
			name: 'voicestudio_tts',
			async synthesizeScene(input) {
				primaryCalls++;
				if (primaryCalls === 2) {
					throw new Error('VoiceStudio temporariamente ocupado na cena 2');
				}
				writeSegmentedTestWav(input.outputPath, [{ durationMs: 1500, amplitude: 8000 }]);
				return {
					sceneId: input.sceneId,
					audioPath: input.outputPath,
					speechDurationMs: 1500,
					pauseAfterMs: 300,
					provider: 'voicestudio_tts',
					voiceId: 'voice-fixed-ptbr',
					isFallback: false,
				};
			},
		};

		let fallbackCalled = false;
		const fallbackPort: RecapTtsSynthesisPort = {
			name: 'windows_sapi_tts',
			async synthesizeScene(input) {
				fallbackCalled = true;
				writeSegmentedTestWav(input.outputPath, [{ durationMs: 1500, amplitude: 8000 }]);
				return {
					sceneId: input.sceneId,
					audioPath: input.outputPath,
					speechDurationMs: 1500,
					pauseAfterMs: 300,
					provider: 'windows_sapi_tts',
					voiceId: 'sapi-maria',
					isFallback: false,
				};
			},
		};

		const chained = createChainedRecapTtsPort({ ports: [primaryPort, fallbackPort] });
		const seg1 = await chained.synthesizeScene({
			sceneId: 'scene-1',
			text: 'Primeira cena.',
			emotion: 'neutral',
			estimatedDurationSec: 2,
			outputPath: join(tempDir, 'chained-1.wav'),
		});
		expect(seg1.provider).toBe('voicestudio_tts');

		// Scene 2 fails on locked primary -> MUST throw and MUST NOT silently switch to SAPI!
		await expect(
			chained.synthesizeScene({
				sceneId: 'scene-2',
				text: 'Segunda cena.',
				emotion: 'neutral',
				estimatedDurationSec: 2,
				outputPath: join(tempDir, 'chained-2.wav'),
			}),
		).rejects.toThrow(/VoiceStudio temporariamente ocupado/);
		expect(fallbackCalled).toBe(false);
	});

	test('Gate J detects provider switch, voice mismatch, nonstandard sample rate, and passes single 48kHz session', () => {
		const wav1 = join(tempDir, 'gatej-1.wav');
		const wav2 = join(tempDir, 'gatej-2.wav');
		writeSegmentedTestWav(wav1, [{ durationMs: 2000, amplitude: 9000 }]);
		writeSegmentedTestWav(wav2, [{ durationMs: 2000, amplitude: 9000 }]);

		// 1. Clean single-session 48 kHz -> PASS
		const cleanSeg: SynthesizedSceneAudio = {
			sceneId: 'continuous-narration',
			audioPath: wav1,
			speechDurationMs: 2000,
			pauseAfterMs: 300,
			provider: 'voicestudio_tts',
			voiceId: '9190edfa',
			sessionMode: 'single_session',
			isFallback: false,
		};
		const passReport = runGateJVoiceConsistency({ segments: [cleanSeg], outputSampleRateHz: 48000 });
		expect(passReport.verdict).toBe('pass');
		expect(passReport.metrics.singleContinuousSession).toBe(true);

		// 2. Non-standard 96 kHz -> needs_review
		const rateReport = runGateJVoiceConsistency({ segments: [cleanSeg], outputSampleRateHz: 96000 });
		expect(rateReport.verdict).toBe('needs_review');
		expect(rateReport.findings.some((f) => f.code === 'sample_rate_nonstandard')).toBe(true);

		// 3. Mid-video provider/voice switch -> FAIL
		const mixedReport = runGateJVoiceConsistency({
			segments: [
				cleanSeg,
				{
					sceneId: 'scene-2',
					audioPath: wav2,
					speechDurationMs: 2000,
					pauseAfterMs: 300,
					provider: 'windows_sapi_tts',
					voiceId: 'sapi-maria',
					sessionMode: 'chunked',
					isFallback: false,
				},
			],
			outputSampleRateHz: 48000,
		});
		expect(mixedReport.verdict).toBe('fail');
		expect(mixedReport.findings.some((f) => f.code === 'provider_switch')).toBe(true);
		expect(mixedReport.findings.some((f) => f.code === 'voice_identity_mismatch')).toBe(true);
	});
});
