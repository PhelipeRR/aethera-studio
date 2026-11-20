/**
 * Phase 3 — Audiovisual Production Automated Tests
 *
 * NOTE: All scripts and panel metadata below are EXPLICITLY SYNTHETIC FIXTURES
 * (`isSyntheticFixture: true`, `approvalStatus: 'technical_fixture_unapproved'`).
 * Passing these tests validates Phase 3 audiovisual engineering only and NEVER
 * constitutes a real Phase 2.2.4 narrative E2E pass.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
	buildRecapAudiovisualPlan,
	detectFramingCropRisk,
	runGateHAudiovisualQuality,
	renderRecapVideo,
	loadPhase3Checkpoint,
	auditNarrationAudioClip,
	createChainedRecapTtsPort,
	resolveMotionVelixSfxFile,
	computeShotRenderHash,
	checkRecapProductionReadiness,
	AgentCircuitBreaker,
	classifyVisionError,
	saveCheckpoint,
	type ExtractedPanel,
	type RecapScript,
	type RecapTtsSynthesisPort,
} from '../../src/recap/index.js';

function makeSyntheticPanel(
	id: string,
	pageNumber: number,
	imagePath: string,
	classification: 'establishing' | 'dialogue' | 'action' = 'action',
	width = 800,
	height = 1200,
): ExtractedPanel {
	return {
		panelId: id,
		pagePath: imagePath,
		croppedImagePath: imagePath,
		metadata: {
			sourceKind: 'panel_crop',
			origin: 'webtoon_extract',
			chapterId: 'synthetic-fixture-cap-01',
			pageNumber,
			panelIndex: pageNumber,
			readingOrder: 'vertical',
			boundingBox: { x: 0, y: pageNumber * 100, w: width, h: height },
			classification,
			ocrStatus: 'not_run',
			ocrConfidence: 0,
		},
		imageHash: `synthetic-hash-${id}`,
		width,
		height,
	};
}

function makeSyntheticScript(panels: readonly ExtractedPanel[]): RecapScript {
	return {
		chapterId: 'synthetic-fixture-cap-01',
		title: '[FIXTURE SINTÉTICA] Teste Técnico Fase 3',
		style: 'cinematic_recap',
		totalEstimatedDurationSec: 11,
		generatedAtIso: new Date().toISOString(),
		generatedBy: 'synthetic-fixture-generator',
		scenes: [
			{
				sceneId: 'scene-1',
				narrationText: 'A cena abre no pátio sombrio enquanto o protagonista observa os guardas.',
				characters: ['Cheon Yeo-Woon'],
				eventDescription: 'Abertura no pátio.',
				panelIds: [panels[0]!.panelId],
				croppedImagePaths: [panels[0]!.croppedImagePath!],
				estimatedDurationSec: 3.5,
				emotion: 'tension',
				narrativeIntent: 'exposition',
				confidence: 0.9,
				reviewStatus: 'approved',
			},
			{
				sceneId: 'scene-2',
				narrationText: 'Em silêncio, ele lê a ameaça nos olhos do rival antes do diálogo começar.',
				characters: ['Cheon Yeo-Woon', 'Rival'],
				eventDescription: 'Confronto verbal.',
				panelIds: [panels[1]!.panelId],
				croppedImagePaths: [panels[1]!.croppedImagePath!],
				estimatedDurationSec: 4.0,
				emotion: 'determination',
				narrativeIntent: 'rising_action',
				confidence: 0.9,
				reviewStatus: 'approved',
			},
			{
				sceneId: 'scene-3',
				narrationText: 'O golpe explode no centro da arena e redefine o ritmo do combate.',
				characters: ['Cheon Yeo-Woon'],
				eventDescription: 'Clímax do golpe.',
				panelIds: [panels[2]!.panelId],
				croppedImagePaths: [panels[2]!.croppedImagePath!],
				estimatedDurationSec: 3.5,
				emotion: 'anger',
				narrativeIntent: 'climax',
				confidence: 0.9,
				reviewStatus: 'approved',
			},
		],
	};
}

describe('Phase 3 — Audiovisual Production (Synthetic Fixtures)', () => {
	it('plans shots with zero coverage gaps, zero consecutive duplicates, balloon protection on dialogue, synchronized captions, and EBU R128 ducking', () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-p3-plan-'));
		try {
			const p0 = join(dir, 'p0.png');
			const p1 = join(dir, 'p1.png');
			const p2 = join(dir, 'p2.png');
			writeFileSync(p0, 'img0');
			writeFileSync(p1, 'img1');
			writeFileSync(p2, 'img2');

			const panels = [
				makeSyntheticPanel('p-0', 0, p0, 'establishing', 800, 1200),
				makeSyntheticPanel('p-1', 1, p1, 'dialogue', 800, 900),
				makeSyntheticPanel('p-2', 2, p2, 'action', 800, 800),
			];
			const script = makeSyntheticScript(panels);

			// Audio-First: scene-2 measured narration is longer than planned (5.2s vs 4.0s)
			const plan = buildRecapAudiovisualPlan({
				script,
				panels,
				measuredSegments: [
					{ segmentId: 'scene-1', speechDurationMs: 3500, pauseAfterMs: 300 },
					{ segmentId: 'scene-2', speechDurationMs: 5200, pauseAfterMs: 300 },
					{ segmentId: 'scene-3', speechDurationMs: 3600, pauseAfterMs: 300 },
				],
				options: {
					renderTarget: 'preview',
					isSyntheticFixture: true,
					approvalStatus: 'technical_fixture_unapproved',
				},
			});

			// Timeline extends to preserve complete narration (never clips audio)
			expect(plan.totalDurationMs).toBeGreaterThanOrEqual(plan.durationAudit.measuredNarrationDurationMs);
			expect(plan.durationAudit.completeNarrationPreserved).toBe(true);
			expect(plan.shots).toHaveLength(3);

			// Zero gaps
			expect(plan.shots[0]!.startMs).toBe(0);
			expect(plan.shots[1]!.startMs).toBe(plan.shots[0]!.endMs);
			expect(plan.shots[2]!.startMs).toBe(plan.shots[1]!.endMs);
			expect(plan.shots[2]!.endMs).toBe(plan.totalDurationMs);

			// Balloon protection on dialogue panel (p-1)
			expect(plan.shots[1]!.balloonSafeZoneProtected).toBe(true);
			expect(plan.vfxSpecs[1]!.shakeIntensity).toBe(0);
			expect(plan.vfxSpecs[1]!.vignetteStrength).toBeLessThanOrEqual(0.15);

			// Captions & ducking configured
			expect(plan.captions.cues.length).toBeGreaterThan(0);
			expect(plan.captions.ass).toContain('[Events]');
			expect(plan.ducking.sidechainFilter).toContain('sidechaincompress');
			expect(plan.ducking.loudnormFilter).toContain('loudnorm');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('Gate H flags synthetic fixture as needs_review (never auto-approves) and detects clipped audio, gaps, duplicates, and out-of-order scenes', () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-p3-gateh-'));
		try {
			const p0 = join(dir, 'p0.png');
			const p1 = join(dir, 'p1.png');
			const p2 = join(dir, 'p2.png');
			writeFileSync(p0, 'img0');
			writeFileSync(p1, 'img1');
			writeFileSync(p2, 'img2');

			const panels = [
				makeSyntheticPanel('p-0', 0, p0, 'establishing'),
				makeSyntheticPanel('p-1', 1, p1, 'dialogue'),
				makeSyntheticPanel('p-2', 2, p2, 'action'),
			];
			const script = makeSyntheticScript(panels);

			// 1. Clean synthetic fixture -> needs_review (honesty guard)
			const synPlan = buildRecapAudiovisualPlan({
				script,
				panels,
				options: { isSyntheticFixture: true, approvalStatus: 'technical_fixture_unapproved' },
			});
			const synReport = runGateHAudiovisualQuality({ plan: synPlan, script, panels });
			expect(synReport.verdict).toBe('needs_review');
			expect(synReport.findings.some((f) => f.code === 'synthetic_fixture_unapproved')).toBe(true);

			// 2. Clean approved editorial plan -> pass
			const approvedPlan = buildRecapAudiovisualPlan({
				script,
				panels,
				options: { isSyntheticFixture: false, approvalStatus: 'approved_editorial' },
			});
			const approvedReport = runGateHAudiovisualQuality({ plan: approvedPlan, script, panels });
			expect(approvedReport.verdict).toBe('pass');

			// 3. Corrupted plan (clipped audio + visual gap + duplicate panel + scene out of order) -> fail
			const brokenPlan = structuredClone(approvedPlan);
			brokenPlan.totalDurationMs = brokenPlan.durationAudit.measuredNarrationDurationMs - 1000;
			brokenPlan.shots[1]!.startMs += 500; // gap
			brokenPlan.shots[1]!.panelId = brokenPlan.shots[0]!.panelId; // duplicate consecutive
			brokenPlan.shots[2]!.sceneId = 'scene-1'; // out of order
			const brokenReport = runGateHAudiovisualQuality({ plan: brokenPlan, script, panels });
			expect(brokenReport.verdict).toBe('fail');
			const codes = brokenReport.findings.map((f) => f.code);
			expect(codes).toContain('audio_clipped');
			expect(codes).toContain('visual_coverage_gap');
			expect(codes).toContain('duplicate_consecutive_panel');
			expect(codes).toContain('scene_order_violation');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('enforces preview-before-master guard, falls back deterministically when TTS fails, and persists/resumes stage checkpoints', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-p3-ckpt-'));
		try {
			const p0 = join(dir, 'p0.png');
			const p1 = join(dir, 'p1.png');
			const p2 = join(dir, 'p2.png');
			writeFileSync(p0, 'img0');
			writeFileSync(p1, 'img1');
			writeFileSync(p2, 'img2');

			const panels = [
				makeSyntheticPanel('p-0', 0, p0, 'establishing'),
				makeSyntheticPanel('p-1', 1, p1, 'dialogue'),
				makeSyntheticPanel('p-2', 2, p2, 'action'),
			];
			const script = makeSyntheticScript(panels);

			// Master without preview approval must fail fast
			await expect(
				renderRecapVideo({
					script,
					panels,
					outputDir: join(dir, 'out-master'),
					plannerOptions: { renderTarget: 'master', isSyntheticFixture: true },
					dryRunRender: true,
				}),
			).rejects.toThrow('preview_review_required');

			// Failing TTS triggers deterministic fallback automatically
			let ttsAttempts = 0;
			const brokenTts: RecapTtsSynthesisPort = {
				name: 'broken-tts',
				async synthesizeScene() {
					ttsAttempts++;
					throw new Error('TTS offline');
				},
			};

			const outDir = join(dir, 'out-preview');
			const ckptDir = join(dir, 'checkpoints');
			const first = await renderRecapVideo({
				script,
				panels,
				outputDir: outDir,
				checkpointDir: ckptDir,
				ttsPort: brokenTts,
				plannerOptions: { renderTarget: 'preview', isSyntheticFixture: true },
				dryRunRender: true,
			});

			expect(ttsAttempts).toBe(3);
			expect(first.warnings.length).toBe(3);
			expect(first.gateHReport.verdict).toBe('needs_review'); // synthetic fixture
			const saved = loadPhase3Checkpoint(ckptDir);
			expect(saved?.completedStages).toContain('audio_sync');
			expect(saved?.completedStages).toContain('visual_plan');
			expect(saved?.completedStages).toContain('captions');
			expect(saved?.completedStages).toContain('gate_h');

			// Resume skips audio_sync (0 additional TTS calls)
			await renderRecapVideo({
				script,
				panels,
				outputDir: outDir,
				checkpointDir: ckptDir,
				ttsPort: brokenTts,
				plannerOptions: { renderTarget: 'preview', isSyntheticFixture: true },
				dryRunRender: true,
			});
			expect(ttsAttempts).toBe(3);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('Phase 3.1: supports 16:9 and 9:16 aspect ratios, parallax motion on world_building, and framing crop risk detection', () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-p31-aspect-'));
		try {
			const p0 = join(dir, 'p0.png');
			const p1 = join(dir, 'p1.png');
			const p2 = join(dir, 'p2.png');
			writeFileSync(p0, 'img0');
			writeFileSync(p1, 'img1');
			writeFileSync(p2, 'img2');

			const panels = [
				makeSyntheticPanel('p-0', 0, p0, 'establishing', 800, 800),
				makeSyntheticPanel('p-1', 1, p1, 'dialogue', 800, 900),
				makeSyntheticPanel('p-2', 2, p2, 'action', 800, 800),
			];
			const script = makeSyntheticScript(panels);
			script.scenes[0]!.narrativeIntent = 'world_building';

			const plan916 = buildRecapAudiovisualPlan({
				script,
				panels,
				options: { renderTarget: 'preview', aspectRatio: '9:16', isSyntheticFixture: true },
			});
			expect(plan916.aspectRatio).toBe('9:16');
			expect(plan916.width).toBe(720);
			expect(plan916.height).toBe(1280);
			expect(plan916.shots[0]!.motionStyle).toBe('parallax');
			expect(plan916.shots[0]!.framingCropRisk.atRisk).toBe(false);

			const risky = detectFramingCropRisk({
				panel: panels[1],
				viewportWidth: 1280,
				viewportHeight: 720,
				focalStart: { x: 0.5, y: 0.5, zoom: 1.0 },
				focalEnd: { x: 0.5, y: 0.5, zoom: 1.25 },
			});
			expect(risky.atRisk).toBe(true);
			expect(risky.reason).toContain('diálogo');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('Phase 3.2: audits WAV narration clips (valid, silent, clipped) and chains TTS providers with fallback', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-p32-tts-'));
		try {
			// Helper to write a 16-bit PCM WAV
			const writeWav = (path: string, sampleVal: number, durationSec = 1.0) => {
				const sr = 44100;
				const n = Math.round(sr * durationSec);
				const buf = Buffer.alloc(44 + n * 2);
				buf.write('RIFF', 0);
				buf.writeUInt32LE(36 + n * 2, 4);
				buf.write('WAVE', 8);
				buf.write('fmt ', 12);
				buf.writeUInt32LE(16, 16);
				buf.writeUInt16LE(1, 20);
				buf.writeUInt16LE(1, 22);
				buf.writeUInt32LE(sr, 24);
				buf.writeUInt32LE(sr * 2, 28);
				buf.writeUInt16LE(2, 32);
				buf.writeUInt16LE(16, 34);
				buf.write('data', 36);
				buf.writeUInt32LE(n * 2, 40);
				for (let i = 0; i < n; i++) buf.writeInt16LE(sampleVal, 44 + i * 2);
				writeFileSync(path, buf);
			};

			const validWav = join(dir, 'valid.wav');
			const silentWav = join(dir, 'silent.wav');
			const clippedWav = join(dir, 'clipped.wav');
			writeWav(validWav, 5000, 1.2);
			writeWav(silentWav, 0, 1.2);
			writeWav(clippedWav, 32767, 1.2);

			const validAudit = await auditNarrationAudioClip(validWav);
			expect(validAudit.ok).toBe(true);
			expect(validAudit.durationMs).toBeGreaterThanOrEqual(1100);

			const silentAudit = await auditNarrationAudioClip(silentWav);
			expect(silentAudit.ok).toBe(false);
			expect(silentAudit.issues.some((i) => i.includes('Silêncio'))).toBe(true);

			const clippedAudit = await auditNarrationAudioClip(clippedWav);
			expect(clippedAudit.ok).toBe(false);
			expect(clippedAudit.issues.some((i) => i.includes('Clipping'))).toBe(true);

			// Chained TTS: failing primary falls back to deterministic when allowed
			const failingPort: RecapTtsSynthesisPort = {
				name: 'primary-offline',
				async synthesizeScene() { throw new Error('Connection refused'); },
			};
			const chained = createChainedRecapTtsPort({ ports: [failingPort], allowDeterministicFallback: true });
			const outWav = join(dir, 'fallback.wav');
			const seg = await chained.synthesizeScene({
				sceneId: 's1',
				text: 'Teste de narração com fallback determinístico.',
				emotion: 'neutral',
				estimatedDurationSec: 2,
				outputPath: outWav,
			});
			expect(seg.isFallback).toBe(true);
			expect(seg.speechDurationMs).toBeGreaterThanOrEqual(1200);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('Phase 3.3 & 3.4: resolves real MotionVelix SFX files and computes deterministic per-shot render hashes', () => {
		const sfxDir = join(process.cwd(), '.agents', 'skills', 'motionvelix', 'assets', 'sfx');
		const whoosh = resolveMotionVelixSfxFile('whoosh', sfxDir);
		const impact = resolveMotionVelixSfxFile('impact_hit', sfxDir);
		expect(whoosh).toContain('whoosh.wav');
		expect(impact).toContain('impacto.wav');

		const dir = mkdtempSync(join(tmpdir(), 'recap-p34-hash-'));
		try {
			const p0 = join(dir, 'p0.png');
			writeFileSync(p0, 'img0');
			const panels = [makeSyntheticPanel('p-0', 0, p0, 'action'), makeSyntheticPanel('p-1', 1, p0, 'dialogue'), makeSyntheticPanel('p-2', 2, p0, 'action')];
			const plan = buildRecapAudiovisualPlan({ script: makeSyntheticScript(panels), panels, options: { isSyntheticFixture: true } });
			const shot = plan.shots[0]!;
			const h1 = computeShotRenderHash(shot, 1280, 720, 24);
			const h2 = computeShotRenderHash(shot, 1280, 720, 24);
			const hChanged = computeShotRenderHash({ ...shot, durationMs: shot.durationMs + 500 }, 1280, 720, 24);
			expect(h1).toBe(h2);
			expect(h1).not.toBe(hChanged);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it('Phase 4.2: production readiness preflight reports circuit breakers and recommends auto-resume when a provider recovers', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'recap-p42-ready-'));
		const ckptDir = join(dir, 'checkpoints');
		try {
			const p0 = join(dir, 'p0.png');
			writeFileSync(p0, 'img0');
			const panels = [makeSyntheticPanel('p-0', 0, p0), makeSyntheticPanel('p-1', 1, p0)];
			saveCheckpoint(ckptDir, {
				chapterId: 'nano-machine-cap-01',
				completedStages: ['import', 'extraction'],
				lastUpdatedAtIso: new Date().toISOString(),
				sourceHash: 'hash-0',
				extractedPanels: panels,
				panelAnalyses: [
					{
						panelId: 'p-0',
						characters: ['Protagonista'],
						dialogues: [],
						actions: [{ type: 'observation', description: 'Observa' }],
						emotions: ['tension'],
						evidence: [],
						analysisConfidence: 0.9,
						analyzedBy: 'claude',
						analyzedAtIso: new Date().toISOString(),
					},
				],
			});

			const cb = new AgentCircuitBreaker();
			cb.recordError('claude', classifyVisionError("You've hit your weekly limit · resets Nov 22, 3pm (America/Sao_Paulo)", 'claude'));
			cb.recordError('codex', classifyVisionError('usage limit until 2026-11-23', 'codex'));

			// All circuits open -> ready: false, checkpoint preserved
			const blocked = await checkRecapProductionReadiness({
				providers: [
					{ id: 'claude', label: 'Claude CLI', detect: async () => ({ available: true }) },
					{ id: 'codex', label: 'Codex CLI', detect: async () => ({ available: true }) },
				],
				circuitBreaker: cb,
				checkpointDir: ckptDir,
				expectedTotalPanels: 2,
			});
			expect(blocked.ready).toBe(false);
			expect(blocked.checkpoint.completedPanels).toBe(1);
			expect(blocked.checkpoint.pendingPanels).toBe(1);
			expect(blocked.checkpoint.canResume).toBe(true);
			expect(blocked.summaryMessage).toContain('QUOTA_EXCEEDED');

			// One provider available -> ready: true and autoResumeRecommended: true
			const readyReport = await checkRecapProductionReadiness({
				providers: [
					{ id: 'claude', label: 'Claude CLI', detect: async () => ({ available: true }) },
					{ id: 'claude-gateway', label: 'Claude Gateway', detect: async () => ({ available: true }) },
				],
				circuitBreaker: cb,
				checkpointDir: ckptDir,
				expectedTotalPanels: 2,
			});
			expect(readyReport.ready).toBe(true);
			expect(readyReport.operationalProviders).toEqual(['claude-gateway']);
			expect(readyReport.autoResumeRecommended).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
