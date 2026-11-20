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
	runGateHAudiovisualQuality,
	renderRecapVideo,
	loadPhase3Checkpoint,
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
});
