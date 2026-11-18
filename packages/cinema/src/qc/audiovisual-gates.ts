import type { SceneAudiovisualPlan } from '../director/scene-audiovisual-plan.js';
import type { MediaCoverageReport } from '../analysis/media-coverage-planner.js';
import type { ResolvedRealAudioAssets } from '../audio/real-audio-assets.js';
import type { CanonicalTimeline } from '../ir/timeline-ir.js';

export type QualityGateVerdict = 'pass' | 'needs_review' | 'fail';

export interface QualityGateReport {
  gate: 'A_pre_assembly' | 'B_pre_render' | 'C_post_render';
  verdict: QualityGateVerdict;
  checkedAtIso: string;
  reasons: string[];
  metrics: Record<string, number | string | boolean>;
}

export function runGateAPreAssembly(input: {
  requestedDurationSec: number;
  coverageReport: MediaCoverageReport;
  plannedDurationSec: number;
  toleranceRatio?: number;
}): QualityGateReport {
  const tol = input.toleranceRatio ?? 0.05;
  const minDur = input.requestedDurationSec * (1 - tol);
  const maxDur = input.requestedDurationSec * (1 + tol);
  const reasons: string[] = [];

  if (input.coverageReport.uncoveredSubjects.length > 0) {
    reasons.push(
      `needs_review: ${input.coverageReport.uncoveredSubjects.length} assunto(s) sem mídia verificada (${input.coverageReport.uncoveredSubjects.slice(0, 4).join(', ')}).`,
    );
  }
  if (input.plannedDurationSec < minDur || input.plannedDurationSec > maxDur) {
    reasons.push(
      `Duração planejada (${input.plannedDurationSec.toFixed(1)}s) fora da tolerância de ±${Math.round(tol * 100)}% do alvo (${input.requestedDurationSec}s).`,
    );
  }

  const verdict: QualityGateVerdict =
    reasons.length === 0
      ? 'pass'
      : input.coverageReport.uncoveredSubjects.length > 0
        ? 'needs_review'
        : 'fail';

  return {
    gate: 'A_pre_assembly',
    verdict,
    checkedAtIso: new Date().toISOString(),
    reasons,
    metrics: {
      requestedDurationSec: input.requestedDurationSec,
      plannedDurationSec: Number(input.plannedDurationSec.toFixed(2)),
      coverageRatio: Number(input.coverageReport.coverageRatio.toFixed(3)),
      uncoveredCount: input.coverageReport.uncoveredSubjects.length,
      identifiedAssets: input.coverageReport.identifiedAssetCount,
    },
  };
}

export function runGateBPreRender(input: {
  timeline: CanonicalTimeline;
  requestedDurationSec: number;
  realAudio?: ResolvedRealAudioAssets;
  audiovisualPlan?: SceneAudiovisualPlan;
}): QualityGateReport {
  const reasons: string[] = [];
  const v1Clips = input.timeline.clips.filter((c) => c.trackId === 'v1');
  const vfxClips = input.timeline.clips.filter((c) => c.trackId === 'vfx1');
  const graphicRecoveryClips = v1Clips.filter((c) =>
    c.effects.some((e) => e.kind === 'graphic_recovery' && e.enabled),
  );
  const missingTransitions = v1Clips.filter((c) => !c.transitionIn).length;

  if (v1Clips.length === 0) reasons.push('Timeline sem clipes na faixa v1.');
  if (vfxClips.length === 0) reasons.push('Faixa vfx1 vazia: sem VFX ou motion graphics planejados.');
  if (missingTransitions > 0) reasons.push(`${missingTransitions} clipe(s) de v1 sem transitionIn configurado.`);
  if (input.audiovisualPlan && input.audiovisualPlan.vfxPlan.length === 0) {
    reasons.push('vfxPlan ausente no plano audiovisual.');
  }
  if (input.realAudio && !input.realAudio.music) {
    reasons.push('Faixa musical ausente antes da renderização.');
  }
  if (input.realAudio && input.realAudio.sfx.length === 0) {
    reasons.push('Nenhum SFX semântico resolvido antes da renderização.');
  }
  if (graphicRecoveryClips.length > 0) {
    reasons.push(`needs_review: ${graphicRecoveryClips.length} clipe(s) em graphic_recovery aguardam mídia real.`);
  }

  const verdict: QualityGateVerdict =
    reasons.length === 0
      ? 'pass'
      : reasons.every((r) => r.startsWith('needs_review:'))
        ? 'needs_review'
        : 'fail';

  return {
    gate: 'B_pre_render',
    verdict,
    checkedAtIso: new Date().toISOString(),
    reasons,
    metrics: {
      v1ClipCount: v1Clips.length,
      vfxClipCount: vfxClips.length,
      graphicRecoveryCount: graphicRecoveryClips.length,
      missingTransitions,
      hasMusic: Boolean(input.realAudio?.music),
      sfxCount: input.realAudio?.sfx.length ?? 0,
    },
  };
}

export function runGateCPostRender(input: {
  requestedDurationSec: number;
  actualDurationSec: number;
  width: number;
  height: number;
  hasAudio: boolean;
  blackFramesCount?: number;
  clippingDetected?: boolean;
  silenceGapSec?: number;
  toleranceRatio?: number;
}): QualityGateReport {
  const tol = input.toleranceRatio ?? 0.05;
  const minDur = input.requestedDurationSec * (1 - tol);
  const maxDur = input.requestedDurationSec * (1 + tol);
  const reasons: string[] = [];

  if (input.actualDurationSec < minDur || input.actualDurationSec > maxDur) {
    reasons.push(
      `Duração final (${input.actualDurationSec.toFixed(2)}s) fora do intervalo [${minDur.toFixed(1)}s, ${maxDur.toFixed(1)}s] para alvo de ${input.requestedDurationSec}s.`,
    );
  }
  if (!input.hasAudio) reasons.push('MP4 renderizado sem stream de áudio.');
  if (input.width < 640 || input.height < 360) reasons.push(`Resolução baixa (${input.width}x${input.height}).`);
  if ((input.blackFramesCount ?? 0) > 0) reasons.push(`Detectados ${input.blackFramesCount} quadro(s) preto(s).`);
  if (input.clippingDetected) reasons.push('Detectado clipping no áudio renderizado.');
  if ((input.silenceGapSec ?? 0) > 3.5) {
    reasons.push(`Silêncio inesperado de ${input.silenceGapSec?.toFixed(1)}s detectado no áudio.`);
  }

  return {
    gate: 'C_post_render',
    verdict: reasons.length === 0 ? 'pass' : 'fail',
    checkedAtIso: new Date().toISOString(),
    reasons,
    metrics: {
      requestedDurationSec: input.requestedDurationSec,
      actualDurationSec: Number(input.actualDurationSec.toFixed(2)),
      width: input.width,
      height: input.height,
      hasAudio: input.hasAudio,
      blackFramesCount: input.blackFramesCount ?? 0,
      clippingDetected: Boolean(input.clippingDetected),
    },
  };
}
