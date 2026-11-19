import type { SceneAudiovisualPlan } from '../director/scene-audiovisual-plan.js';
import type { MediaCoverageReport } from '../analysis/media-coverage-planner.js';
import type { ResolvedRealAudioAssets } from '../audio/real-audio-assets.js';
import type { CanonicalTimeline } from '../ir/timeline-ir.js';

export type QualityGateVerdict = 'pass' | 'needs_review' | 'fail';

export interface QualityGateReport {
  gate: 'A_pre_assembly' | 'B_pre_render' | 'C_post_render' | 'D_editorial_quality';
  verdict: QualityGateVerdict;
  checkedAtIso: string;
  reasons: string[];
  metrics: Record<string, number | string | boolean>;
  repairHints?: Array<{
    sceneId: string;
    issueCode:
      | 'low_narration_coverage'
      | 'semantic_desync'
      | 'hollow_narration'
      | 'low_info_or_logo_frame'
      | 'consecutive_visual_repetition'
      | 'sluggish_pacing'
      | 'missing_sfx_sync';
    detail: string;
  }>;
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
  // Short graphic-recovery clips (<=8s) are autonomous editorial composition: labeled typography/graphics
  // that fill residual gaps without claiming to prove a factual event. Only longer gaps still block for review.
  const AUTONOMOUS_GRAPHIC_RECOVERY_MAX_SEC = 8;
  const longGraphicRecoveryClips = graphicRecoveryClips.filter((c) => {
    const durSec = c.timelineRange.duration.value / Math.max(1, c.timelineRange.duration.rate);
    return durSec > AUTONOMOUS_GRAPHIC_RECOVERY_MAX_SEC;
  });
  const autonomousGraphicCount = graphicRecoveryClips.length - longGraphicRecoveryClips.length;
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
  if (longGraphicRecoveryClips.length > 0) {
    reasons.push(`needs_review: ${longGraphicRecoveryClips.length} clipe(s) em graphic_recovery (>8s) aguardam mídia real.`);
  }
  if (autonomousGraphicCount > 0) {
    reasons.push(`info: ${autonomousGraphicCount} clipe(s) gráfico(s) editorial(is) autônomo(s) (<=8s) preenchendo gaps residuais.`);
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

export interface GateDEditorialSceneInput {
  sceneId: string;
  clipId: string;
  mediaId: string;
  startSec: number;
  durationSec: number;
  sourceStartSec: number;
  sourceEndSec: number;
  isStaticImage?: boolean;
  hasMotionEffect?: boolean;
  spokenText?: string;
  expectedEntities?: string[];
  matchedEntities?: string[];
  perceptualHash?: string;
  lowInfoFrameDetected?: boolean;
}

/**
 * Gate D — Editorial & Audiovisual Quality:
 * Rejects videos that are technically valid (Gates A/B/C pass) yet editorially weak
 * (e.g., long silent narration gaps, hollow script templates, spoken-vs-visual desync,
 * sponsor/logo frames, consecutive visual repetition, or sluggish uncut shots).
 * Completely domain-agnostic: works for any subject matter.
 */
export function runGateDEditorialQuality(input: {
  requestedDurationSec: number;
  actualDurationSec: number;
  measuredNarrationDurationMs: number;
  maxSilentNarrationGapSec?: number;
  scenes: readonly GateDEditorialSceneInput[];
  sfxCount?: number;
  plannedSfxCount?: number;
  lowInfoFramesRatio?: number;
}): QualityGateReport {
  const reasons: string[] = [];
  const repairHints: NonNullable<QualityGateReport['repairHints']> = [];
  const actualDurMs = Math.max(1, Math.round(input.actualDurationSec * 1000));
  const narrationCoverageRatio = Number(
    Math.min(1.5, input.measuredNarrationDurationMs / actualDurMs).toFixed(3),
  );

  if (narrationCoverageRatio < 0.72) {
    reasons.push(
      `Cobertura narrativa insuficiente (${Math.round(narrationCoverageRatio * 100)}% < 72%): vídeo possui longos trechos sem narração.`,
    );
    repairHints.push({
      sceneId: input.scenes.at(-1)?.sceneId ?? 'scene_1',
      issueCode: 'low_narration_coverage',
      detail: `Narração cobriu ${(input.measuredNarrationDurationMs / 1000).toFixed(1)}s de ${input.actualDurationSec.toFixed(1)}s.`,
    });
  }
  if ((input.maxSilentNarrationGapSec ?? 0) > 4.5) {
    reasons.push(
      `Pausa silenciosa longa sem narração (${input.maxSilentNarrationGapSec?.toFixed(1)}s > 4.5s).`,
    );
  }

  let alignedScenes = 0;
  let hollowCount = 0;
  let consecutiveRepetitions = 0;
  let sluggishShots = 0;
  let lowInfoScenes = 0;

  for (let i = 0; i < input.scenes.length; i += 1) {
    const sc = input.scenes[i]!;
    const spoken = (sc.spokenText ?? '').trim();
    const wordCount = spoken.split(/\s+/).filter(Boolean).length;
    const isHollow =
      wordCount > 0 &&
      (wordCount < 5 || /^[^:]{2,50}:\s*(?:gameplay|cenas|imagens|resumo)\s+de\s+[^.]{2,50}\.?$/i.test(spoken));
    if (isHollow) {
      hollowCount += 1;
      repairHints.push({
        sceneId: sc.sceneId,
        issueCode: 'hollow_narration',
        detail: `Texto narrado genérico/vazio (${wordCount} palavras): "${spoken.slice(0, 60)}"`,
      });
    }

    const expected = (sc.expectedEntities ?? []).map((e) => e.toLowerCase()).filter((e) => e.length >= 3);
    const matched = (sc.matchedEntities ?? []).map((e) => e.toLowerCase());
    const entityAligned =
      expected.length === 0 ||
      matched.length === 0 ||
      expected.some((e) => matched.some((m) => m.includes(e) || e.includes(m)));
    if (entityAligned) {
      alignedScenes += 1;
    } else {
      repairHints.push({
        sceneId: sc.sceneId,
        issueCode: 'semantic_desync',
        detail: `Entidade esperada (${expected.slice(0, 2).join(', ')}) diverge da mídia (${matched.slice(0, 2).join(', ')}).`,
      });
    }

    if (sc.lowInfoFrameDetected) {
      lowInfoScenes += 1;
      repairHints.push({
        sceneId: sc.sceneId,
        issueCode: 'low_info_or_logo_frame',
        detail: `Quadro de baixa informação, logo ou patrocinador detectado na cena ${sc.sceneId}.`,
      });
    }

    const maxShotDur = input.requestedDurationSec <= 90 ? 10.5 : 16;
    if (sc.durationSec > maxShotDur || (sc.isStaticImage && !sc.hasMotionEffect && sc.durationSec > 5)) {
      sluggishShots += 1;
      repairHints.push({
        sceneId: sc.sceneId,
        issueCode: 'sluggish_pacing',
        detail: `Tomada longa sem corte (${sc.durationSec.toFixed(1)}s > ${maxShotDur}s).`,
      });
    }

    if (i > 0) {
      const prev = input.scenes[i - 1]!;
      const sameSourceOverlap =
        prev.mediaId === sc.mediaId &&
        Math.min(prev.sourceEndSec, sc.sourceEndSec) - Math.max(prev.sourceStartSec, sc.sourceStartSec) > 0.5;
      const sameHash = Boolean(prev.perceptualHash && sc.perceptualHash && prev.perceptualHash === sc.perceptualHash);
      if (sameSourceOverlap || sameHash) {
        consecutiveRepetitions += 1;
        repairHints.push({
          sceneId: sc.sceneId,
          issueCode: 'consecutive_visual_repetition',
          detail: `Repetição visual consecutiva entre ${prev.clipId} e ${sc.clipId} (${sc.mediaId}).`,
        });
      }
    }
  }

  const semanticAlignmentScore =
    input.scenes.length > 0 ? Number((alignedScenes / input.scenes.length).toFixed(3)) : 1;
  if (semanticAlignmentScore < 0.75) {
    reasons.push(
      `Dessincronia semântica entre narração e vídeo (${Math.round(semanticAlignmentScore * 100)}% < 75%).`,
    );
  }
  if (hollowCount > 0) {
    reasons.push(`${hollowCount} cena(s) com roteiro genérico/vazio sem conteúdo informativo.`);
  }
  if (consecutiveRepetitions > 0) {
    reasons.push(`${consecutiveRepetitions} repetição(ões) visual(is) consecutiva(s) detectada(s).`);
  }
  if (lowInfoScenes > 0 || (input.lowInfoFramesRatio ?? 0) > 0.12) {
    reasons.push(`Detectado(s) quadro(s) pouco informativo(s), logo ou patrocinador na edição.`);
  }
  if (sluggishShots > 0) {
    reasons.push(`${sluggishShots} tomada(s) longa(s) acima do ritmo editorial alvo.`);
  }
  if ((input.plannedSfxCount ?? 0) > 0 && (input.sfxCount ?? 0) === 0) {
    reasons.push('SFX planejados não foram aplicados na mixagem final.');
    repairHints.push({
      sceneId: input.scenes[0]?.sceneId ?? 'scene_1',
      issueCode: 'missing_sfx_sync',
      detail: 'Nenhum SFX sincronizado na renderização apesar do plano audiovisual.',
    });
  }

  const avgShotDurationSec =
    input.scenes.length > 0
      ? Number((input.scenes.reduce((s, sc) => s + sc.durationSec, 0) / input.scenes.length).toFixed(2))
      : 0;

  return {
    gate: 'D_editorial_quality',
    verdict: reasons.length === 0 ? 'pass' : 'fail',
    checkedAtIso: new Date().toISOString(),
    reasons,
    ...(repairHints.length > 0 ? { repairHints } : {}),
    metrics: {
      narrationCoverageRatio,
      semanticAlignmentScore,
      hollowNarrationCount: hollowCount,
      consecutiveRepetitions,
      lowInfoScenes,
      sluggishShots,
      avgShotDurationSec,
      sfxCount: input.sfxCount ?? 0,
    },
  };
}
