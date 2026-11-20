/**
 * Gate H — Audiovisual Quality Audit (Phase 3)
 *
 * Guarantees:
 * - No clipped audio (timeline >= measured narration duration).
 * - No undue consecutive panel repetition.
 * - No uncovered visual gaps along [0, totalDurationMs].
 * - No out-of-order scenes relative to the narrative script.
 * - No VFX/motion obscuring speech balloons on dialogue panels.
 * - Synthetic/non-approved fixtures are NEVER silently marked as approved editorial pass.
 */

import { existsSync } from 'node:fs';
import type { ExtractedPanel, RecapScript } from '../recap-types.js';
import type {
	GateHFinding,
	GateHReport,
	GateHVerdict,
	RecapAudiovisualPlan,
} from './recap-audiovisual-types.js';

export interface GateHInput {
	plan: RecapAudiovisualPlan;
	script: RecapScript;
	panels: readonly ExtractedPanel[];
	/** Optional ffprobe verification of rendered MP4. */
	mp4Probe?: {
		hasVideo: boolean;
		hasAudio: boolean;
		durationMs: number;
	};
	/** When true, checks that every shot's imagePath exists on disk. Default: true. */
	verifyImageFilesOnDisk?: boolean;
}

export function runGateHAudiovisualQuality(input: GateHInput): GateHReport {
	const { plan, script, panels, mp4Probe, verifyImageFilesOnDisk = true } = input;
	const findings: GateHFinding[] = [];
	const reasons: string[] = [];

	const panelMap = new Map<string, ExtractedPanel>();
	for (const p of panels) panelMap.set(p.panelId, p);

	// 1. Audio clipping check
	const audioClipped = plan.totalDurationMs < plan.durationAudit.measuredNarrationDurationMs;
	if (audioClipped) {
		findings.push({
			code: 'audio_clipped',
			severity: 'critical',
			detail: `Timeline (${plan.totalDurationMs}ms) é menor que a narração medida (${plan.durationAudit.measuredNarrationDurationMs}ms).`,
		});
		reasons.push('Áudio de narração cortado: duração visual inferior à duração real da fala.');
	}

	// 2. Visual coverage gaps check
	let visualCoverageGaps = 0;
	if (plan.shots.length === 0) {
		visualCoverageGaps++;
		findings.push({
			code: 'visual_coverage_gap',
			severity: 'critical',
			detail: 'Plano audiovisual não possui nenhum shot visual.',
		});
	} else {
		if (plan.shots[0]!.startMs > 0) {
			visualCoverageGaps++;
			findings.push({
				code: 'visual_coverage_gap',
				severity: 'critical',
				shotId: plan.shots[0]!.shotId,
				detail: `Trecho inicial [0, ${plan.shots[0]!.startMs}ms] sem cobertura visual.`,
			});
		}
		for (let i = 1; i < plan.shots.length; i++) {
			const prev = plan.shots[i - 1]!;
			const curr = plan.shots[i]!;
			if (curr.startMs > prev.endMs) {
				visualCoverageGaps++;
				findings.push({
					code: 'visual_coverage_gap',
					severity: 'critical',
					shotId: curr.shotId,
					detail: `Lacuna visual entre ${prev.shotId} (${prev.endMs}ms) e ${curr.shotId} (${curr.startMs}ms).`,
				});
			}
		}
		const lastShot = plan.shots[plan.shots.length - 1]!;
		if (lastShot.endMs < plan.totalDurationMs) {
			visualCoverageGaps++;
			findings.push({
				code: 'visual_coverage_gap',
				severity: 'critical',
				shotId: lastShot.shotId,
				detail: `Trecho final [${lastShot.endMs}ms, ${plan.totalDurationMs}ms] sem cobertura visual.`,
			});
		}
	}
	if (visualCoverageGaps > 0) {
		reasons.push(`${visualCoverageGaps} lacuna(s) de cobertura visual na timeline.`);
	}

	// 3. Consecutive panel repetition check
	let duplicateConsecutivePanels = 0;
	for (let i = 1; i < plan.shots.length; i++) {
		if (plan.shots[i]!.panelId === plan.shots[i - 1]!.panelId) {
			duplicateConsecutivePanels++;
			findings.push({
				code: 'duplicate_consecutive_panel',
				severity: 'warning',
				shotId: plan.shots[i]!.shotId,
				sceneId: plan.shots[i]!.sceneId,
				detail: `Painel "${plan.shots[i]!.panelId}" repetido consecutivamente em ${plan.shots[i - 1]!.shotId} e ${plan.shots[i]!.shotId}.`,
			});
		}
	}
	if (duplicateConsecutivePanels > 0) {
		reasons.push(`${duplicateConsecutivePanels} repetição(ões) consecutiva(s) indevida(s) de painel.`);
	}

	// 4. Narrative scene order check
	let sceneOrderViolations = 0;
	const expectedSceneIndex = new Map(script.scenes.map((s, idx) => [s.sceneId, idx]));
	let maxSceneIdxSeen = -1;
	for (const shot of plan.shots) {
		const idx = expectedSceneIndex.get(shot.sceneId);
		if (idx === undefined || idx < maxSceneIdxSeen) {
			sceneOrderViolations++;
			findings.push({
				code: 'scene_order_violation',
				severity: 'critical',
				shotId: shot.shotId,
				sceneId: shot.sceneId,
				detail: `Cena "${shot.sceneId}" aparece fora da ordem narrativa esperada no roteiro.`,
			});
		} else {
			maxSceneIdxSeen = idx;
		}
	}
	if (sceneOrderViolations > 0) {
		reasons.push(`${sceneOrderViolations} violação(ões) na ordem narrativa das cenas.`);
	}

	// 5. Balloon readability check (VFX / motion on dialogue panels)
	let balloonReadabilityRisks = 0;
	const vfxByScene = new Map(plan.vfxSpecs.map((v) => [v.sceneId, v]));
	for (const shot of plan.shots) {
		const panel = panelMap.get(shot.panelId);
		if (panel?.metadata.classification === 'dialogue') {
			const vfx = vfxByScene.get(shot.sceneId);
			if (!shot.balloonSafeZoneProtected || (vfx && (!vfx.balloonSafe || vfx.shakeIntensity > 0 || vfx.vignetteStrength > 0.15))) {
				balloonReadabilityRisks++;
				findings.push({
					code: 'balloon_readability_risk',
					severity: 'warning',
					shotId: shot.shotId,
					sceneId: shot.sceneId,
					detail: `Efeito/movimento pode prejudicar leitura de balões no painel de diálogo "${shot.panelId}".`,
				});
			}
		}
	}
	if (balloonReadabilityRisks > 0) {
		reasons.push(`${balloonReadabilityRisks} risco(s) de legibilidade dos balões de diálogo.`);
	}

	// 6. Missing panel image files check
	let missingPanelFiles = 0;
	if (verifyImageFilesOnDisk) {
		for (const shot of plan.shots) {
			if (!shot.imagePath || !existsSync(shot.imagePath)) {
				missingPanelFiles++;
				findings.push({
					code: 'missing_panel_file',
					severity: 'critical',
					shotId: shot.shotId,
					detail: `Imagem do painel "${shot.panelId}" não encontrada em "${shot.imagePath}".`,
				});
			}
		}
	}
	if (missingPanelFiles > 0) {
		reasons.push(`${missingPanelFiles} imagem(ns) de painel ausente(s) em disco.`);
	}

	// 7. Rendered MP4 probe check (when provided)
	let mp4ProbeMismatches = 0;
	if (mp4Probe) {
		if (!mp4Probe.hasVideo || !mp4Probe.hasAudio) {
			mp4ProbeMismatches++;
			findings.push({
				code: 'mp4_probe_mismatch',
				severity: 'critical',
				detail: `MP4 renderizado incompleto (hasVideo=${mp4Probe.hasVideo}, hasAudio=${mp4Probe.hasAudio}).`,
			});
		}
		if (mp4Probe.durationMs + 500 < plan.durationAudit.measuredNarrationDurationMs) {
			mp4ProbeMismatches++;
			findings.push({
				code: 'mp4_probe_mismatch',
				severity: 'critical',
				detail: `Duração real do MP4 (${mp4Probe.durationMs}ms) trunca a narração (${plan.durationAudit.measuredNarrationDurationMs}ms).`,
			});
		}
	}
	if (mp4ProbeMismatches > 0) {
		reasons.push(`${mp4ProbeMismatches} divergência(s) na verificação FFprobe do MP4.`);
	}

	// 8. Synthetic fixture honesty guard
	if (plan.isSyntheticFixture || plan.approvalStatus === 'technical_fixture_unapproved') {
		findings.push({
			code: 'synthetic_fixture_unapproved',
			severity: 'warning',
			detail: 'Vídeo produzido com roteiro sintético/técnico não homologado — não conta como aprovação editorial real da Fase 2.2.4.',
		});
		reasons.push('Roteiro sintético/técnico (não homologado para publicação final).');
	}

	const hasCritical = findings.some((f) => f.severity === 'critical');
	const hasWarning = findings.some((f) => f.severity === 'warning');
	const verdict: GateHVerdict = hasCritical ? 'fail' : hasWarning ? 'needs_review' : 'pass';

	return {
		gate: 'H_audiovisual_quality',
		verdict,
		checkedAtIso: new Date().toISOString(),
		reasons,
		metrics: {
			shotCount: plan.shots.length,
			totalDurationMs: plan.totalDurationMs,
			measuredNarrationDurationMs: plan.durationAudit.measuredNarrationDurationMs,
			audioClipped,
			visualCoverageGaps,
			duplicateConsecutivePanels,
			sceneOrderViolations,
			balloonReadabilityRisks,
			missingPanelFiles,
			mp4ProbeMismatches,
			isSyntheticFixture: plan.isSyntheticFixture,
		},
		findings,
	};
}
