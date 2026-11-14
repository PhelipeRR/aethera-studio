import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { QcFindingRecord } from '../ir/timeline-ir.js';
import type { AetheraEvolutionCore } from '../evolution/evolution-core.js';
import { resolveLearnedSceneConstraints } from '../evolution/production-learning.js';
import {
  extractVerificationFrames,
  type MediaAnomalyReport,
  type RealMp4ProbeResult,
} from './real-media-probe.js';

export type VisualRepairAction =
  | 'hide_lower_third'
  | 'adjust_typography'
  | 'adjust_vfx'
  | 'adjust_sfx'
  | 'adjust_framing'
  | 'swap_duplicate_clip'
  | 'rerender_scene'
  | 'retry_media_research'
  | 'regenerate_narration';

export interface VisualCriticProposal {
  sceneId: string;
  action: VisualRepairAction;
  reason: string;
  severity: 'critical' | 'warning';
}

export interface VisualCriticSceneInput {
  sceneId: string;
  startSec: number;
  durationSec: number;
  sourceMediaId?: string;
  hasTextOverlay?: boolean;
  hasGameplayHud?: boolean;
  narrationText?: string;
  subtitleText?: string;
  framing?: string;
  sfxCues?: string[];
  vfxEffects?: string[];
  visualTopic?: string;
}

export interface VisualCriticReport {
  passed: boolean;
  score: number;
  sampledFrames: string[];
  findings: QcFindingRecord[];
  proposedRepairs: VisualCriticProposal[];
  appliedLearnedRuleIds: string[];
  summary: string;
}

export interface AutonomousSupervisorDecision {
  status: 'approved_for_review' | 'needs_repair' | 'escalate_to_user';
  actions: VisualCriticProposal[];
  rerenderSceneIds: string[];
  retryResearchSceneIds: string[];
  regenerateNarration: boolean;
  rationale: string;
}

/**
 * AI Visual Critic: inspects rendered frames, timeline repetition, HUD/text collisions,
 * and objective FFmpeg anomalies to propose scene-level repairs before user approval.
 */
export async function evaluateRenderedVisualCritic(input: {
  projectId: string;
  mp4Path?: string;
  framesDir?: string;
  scenes: VisualCriticSceneInput[];
  probe?: RealMp4ProbeResult;
  anomalies?: MediaAnomalyReport;
  evolution?: AetheraEvolutionCore;
  genre?: string;
  prompt?: string;
  analyzeFrameWithAI?: (framePath: string, scene: VisualCriticSceneInput) => Promise<{
    issue?: string;
    severity?: 'critical' | 'warning';
    suggestedAction?: VisualRepairAction;
  } | null>;
}): Promise<VisualCriticReport> {
  const findings: QcFindingRecord[] = [];
  const proposedRepairs: VisualCriticProposal[] = [];
  const sampledFrames: string[] = [];

  const learned = input.evolution
    ? resolveLearnedSceneConstraints(input.evolution, {
        prompt: input.prompt ?? input.projectId,
        ...(input.genre ? { genre: input.genre } : {}),
        hasGameplayHud: input.scenes.some((s) => Boolean(s.hasGameplayHud)),
      })
    : { avoidHudOverlap: false, preferDiscreteTypography: false, avoidActCards: false, appliedRuleIds: [] };

  // 1. Sample 1 frame per scene midpoint if MP4 exists
  if (input.mp4Path && existsSync(input.mp4Path) && input.framesDir && input.scenes.length > 0) {
    const timestamps = input.scenes.map((s) =>
      Number((s.startSec + Math.max(0.2, s.durationSec / 2)).toFixed(2)),
    );
    try {
      const frames = await extractVerificationFrames(
        input.mp4Path,
        join(input.framesDir, 'critic-frames'),
        timestamps,
      );
      sampledFrames.push(...frames);

      if (input.analyzeFrameWithAI) {
        for (let i = 0; i < frames.length; i += 1) {
          const framePath = frames[i];
          const scene = input.scenes[i];
          if (!framePath || !scene) continue;
          const aiRes = await input.analyzeFrameWithAI(framePath, scene).catch(() => null);
          if (aiRes?.issue) {
            const sev = aiRes.severity ?? 'warning';
            findings.push({
              issueId: `visual_critic_ai_${scene.sceneId}`,
              timeRange: {
                start: { value: Math.floor(scene.startSec), rate: 1 },
                duration: { value: Math.max(1, Math.ceil(scene.durationSec)), rate: 1 },
              },
              category: 'visual',
              severity: sev,
              confidence: 0.88,
              evidence: aiRes.issue,
              owner: 'director',
              fixSuggestion: 'Aplicar reparo pontual na cena via applyTargetedRepair.',
              affectedDependencies: [scene.sceneId],
              status: 'open',
            });
            proposedRepairs.push({
              sceneId: scene.sceneId,
              action: aiRes.suggestedAction ?? 'rerender_scene',
              reason: aiRes.issue,
              severity: sev,
            });
          }
        }
      }
    } catch {
      // Non-fatal if frame sampling fails
    }
  }

  // 2. Check consecutive visual repetition
  for (let i = 1; i < input.scenes.length; i += 1) {
    const prev = input.scenes[i - 1];
    const curr = input.scenes[i];
    if (prev && curr && prev.sourceMediaId && prev.sourceMediaId === curr.sourceMediaId) {
      const reason = `Repetição visual consecutiva: ${curr.sceneId} reutiliza a mesma mídia (${curr.sourceMediaId}) de ${prev.sceneId}.`;
      findings.push({
        issueId: `visual_critic_repeat_${curr.sceneId}`,
        timeRange: {
          start: { value: Math.floor(curr.startSec), rate: 1 },
          duration: { value: Math.max(1, Math.ceil(curr.durationSec)), rate: 1 },
        },
        category: 'visual',
        severity: 'warning',
        confidence: 0.95,
        evidence: reason,
        owner: 'editor',
        fixSuggestion: 'Trocar o clipe da cena repetida ou buscar B-roll alternativo.',
        affectedDependencies: [curr.sceneId],
        status: 'open',
      });
      proposedRepairs.push({
        sceneId: curr.sceneId,
        action: 'swap_duplicate_clip',
        reason,
        severity: 'warning',
      });
    }
  }

  // 3. Check HUD / overlay collision, typography/subtitles, and SFX/VFX balance
  for (const scene of input.scenes) {
    if (scene.hasGameplayHud && scene.hasTextOverlay && learned.avoidHudOverlap) {
      const reason = `Regra aprendida na Academy: overlay/título em ${scene.sceneId} pode cobrir o HUD de gameplay.`;
      findings.push({
        issueId: `visual_critic_hud_${scene.sceneId}`,
        timeRange: {
          start: { value: Math.floor(scene.startSec), rate: 1 },
          duration: { value: Math.max(1, Math.ceil(scene.durationSec)), rate: 1 },
        },
        category: 'visual',
        severity: 'critical',
        confidence: 0.94,
        evidence: reason,
        owner: 'vfx',
        fixSuggestion: 'Ocultar ou reposicionar lower-third fora da área de HUD.',
        affectedDependencies: [scene.sceneId],
        status: 'open',
      });
      proposedRepairs.push({
        sceneId: scene.sceneId,
        action: 'hide_lower_third',
        reason,
        severity: 'critical',
      });
    }

    if (scene.subtitleText && scene.subtitleText.length > 90) {
      const reason = `Legenda/tipografia extensa em ${scene.sceneId} (${scene.subtitleText.length} chars) compromete legibilidade e enquadramento.`;
      findings.push({
        issueId: `visual_critic_typo_${scene.sceneId}`,
        timeRange: {
          start: { value: Math.floor(scene.startSec), rate: 1 },
          duration: { value: Math.max(1, Math.ceil(scene.durationSec)), rate: 1 },
        },
        category: 'visual',
        severity: 'warning',
        confidence: 0.9,
        evidence: reason,
        owner: 'vfx',
        fixSuggestion: 'Quebrar legenda em 2 linhas e reduzir fonte para zona segura.',
        affectedDependencies: [scene.sceneId],
        status: 'open',
      });
      proposedRepairs.push({
        sceneId: scene.sceneId,
        action: 'adjust_typography',
        reason,
        severity: 'warning',
      });
    }

    const vfxList = scene.vfxEffects ?? [];
    const hasHeavyVfx = vfxList.some((v) => /blur|shake|glitch|heavy_glow/i.test(v));
    if (hasHeavyVfx && (scene.hasTextOverlay || Boolean(scene.subtitleText))) {
      const reason = `VFX intenso (${vfxList.join(', ')}) em ${scene.sceneId} reduz contraste e legibilidade de texto/legenda.`;
      findings.push({
        issueId: `visual_critic_vfx_${scene.sceneId}`,
        timeRange: {
          start: { value: Math.floor(scene.startSec), rate: 1 },
          duration: { value: Math.max(1, Math.ceil(scene.durationSec)), rate: 1 },
        },
        category: 'visual',
        severity: 'warning',
        confidence: 0.86,
        evidence: reason,
        owner: 'vfx',
        fixSuggestion: 'Atenuar intensidade de VFX na cena para preservar nitidez da tipografia.',
        affectedDependencies: [scene.sceneId],
        status: 'open',
      });
      proposedRepairs.push({
        sceneId: scene.sceneId,
        action: 'adjust_vfx',
        reason,
        severity: 'warning',
      });
    }

    if (
      Array.isArray(scene.sfxCues) &&
      scene.sfxCues.length === 0 &&
      scene.narrationText &&
      /cl[ií]max|impacto|explos[aã]o|batalha|chefe|ataque|tensão/i.test(scene.narrationText)
    ) {
      const reason = `Cena de impacto/tensão (${scene.sceneId}) sem SFX de apoio na trilha.`;
      findings.push({
        issueId: `visual_critic_sfx_${scene.sceneId}`,
        timeRange: {
          start: { value: Math.floor(scene.startSec), rate: 1 },
          duration: { value: Math.max(1, Math.ceil(scene.durationSec)), rate: 1 },
        },
        category: 'audio',
        severity: 'warning',
        confidence: 0.82,
        evidence: reason,
        owner: 'sound',
        fixSuggestion: 'Inserir SFX pontual de transição/impacto sincronizado com a cena.',
        affectedDependencies: [scene.sceneId],
        status: 'open',
      });
      proposedRepairs.push({
        sceneId: scene.sceneId,
        action: 'adjust_sfx',
        reason,
        severity: 'warning',
      });
    }
  }

  // 4. Objective anomalies from FFmpeg (ignoring edge fades & short dramatic pauses)
  const totalTimelineSec = input.scenes.reduce((acc, s) => Math.max(acc, s.startSec + s.durationSec), 0);
  if (input.anomalies) {
    for (const blk of input.anomalies.blackIntervals) {
      const isEdgeFade =
        (blk.startSec < 1.0 && blk.durationSec <= 1.2) ||
        (totalTimelineSec > 2 && blk.endSec >= totalTimelineSec - 1.0 && blk.durationSec <= 1.5);
      if (isEdgeFade) continue;
      const hitScene = input.scenes.find(
        (s) => blk.startSec >= s.startSec && blk.startSec <= s.startSec + s.durationSec,
      );
      const sceneId = hitScene?.sceneId ?? input.scenes[0]?.sceneId ?? 'shot_1';
      proposedRepairs.push({
        sceneId,
        action: 'rerender_scene',
        reason: `Frame preto detectado (${blk.startSec}s–${blk.endSec}s).`,
        severity: 'critical',
      });
    }
    for (const sil of input.anomalies.silenceIntervals) {
      if (sil.durationSec <= 2.2) continue;
      const hitScene = input.scenes.find(
        (s) => sil.startSec >= s.startSec && sil.startSec <= s.startSec + s.durationSec,
      );
      const sceneId = hitScene?.sceneId ?? input.scenes[0]?.sceneId ?? 'shot_1';
      proposedRepairs.push({
        sceneId,
        action: 'regenerate_narration',
        reason: `Silêncio prolongado detectado (${sil.startSec}s–${sil.endSec}s).`,
        severity: 'warning',
      });
    }
  }

  const criticalCount = proposedRepairs.filter((r) => r.severity === 'critical').length;
  const warningCount = proposedRepairs.filter((r) => r.severity === 'warning').length;
  const score = Math.max(0, Math.min(100, 100 - criticalCount * 20 - warningCount * 7));
  const passed = criticalCount === 0 && score >= 75;

  return {
    passed,
    score,
    sampledFrames,
    findings,
    proposedRepairs,
    appliedLearnedRuleIds: learned.appliedRuleIds,
    summary: passed
      ? `AI Visual Critic aprovado (${score}/100, ${sampledFrames.length} frame(s) inspecionados).`
      : `AI Visual Critic reprovou com ${criticalCount} erro(s) crítico(s) e ${warningCount} aviso(s).`,
  };
}

/**
 * Autonomous Production Supervisor: decides concrete scene-level recovery actions
 * without requiring multiple simultaneous AI providers.
 */
export function runAutonomousSupervisorPass(
  report: VisualCriticReport,
  options?: {
    attempt?: number;
    maxAttempts?: number;
    previousActionSignatures?: string[];
  },
): AutonomousSupervisorDecision {
  if (report.passed && report.proposedRepairs.length === 0) {
    return {
      status: 'approved_for_review',
      actions: [],
      rerenderSceneIds: [],
      retryResearchSceneIds: [],
      regenerateNarration: false,
      rationale: 'Nenhuma anomalia crítica encontrada; prévia liberada para revisão do usuário.',
    };
  }

  const attempt = options?.attempt ?? 1;
  const maxAttempts = options?.maxAttempts ?? 2;
  const prevSet = new Set(options?.previousActionSignatures ?? []);
  const novelRepairs = report.proposedRepairs.filter(
    (r) => !prevSet.has(`${r.sceneId}:${r.action}`),
  );

  if (attempt > maxAttempts || novelRepairs.length === 0) {
    return {
      status: 'escalate_to_user',
      actions: [],
      rerenderSceneIds: [],
      retryResearchSceneIds: [],
      regenerateNarration: false,
      rationale:
        attempt > maxAttempts
          ? `Limite de tentativas (${maxAttempts}) atingido; escalando para aprovação manual sem loop.`
          : 'Reparos propostos já foram tentados anteriormente; evitando reprocessamento em loop.',
    };
  }

  const rerenderSet = new Set<string>();
  const researchSet = new Set<string>();
  let regenerateNarration = false;

  for (const repair of novelRepairs) {
    if (
      repair.action === 'hide_lower_third' ||
      repair.action === 'adjust_typography' ||
      repair.action === 'adjust_vfx' ||
      repair.action === 'adjust_framing' ||
      repair.action === 'rerender_scene'
    ) {
      rerenderSet.add(repair.sceneId);
    } else if (repair.action === 'swap_duplicate_clip' || repair.action === 'retry_media_research') {
      researchSet.add(repair.sceneId);
      rerenderSet.add(repair.sceneId);
    } else if (repair.action === 'regenerate_narration') {
      regenerateNarration = true;
    }
    // adjust_sfx is audio-only and does not require re-rendering video segments
  }

  return {
    status: 'needs_repair',
    actions: novelRepairs,
    rerenderSceneIds: Array.from(rerenderSet),
    retryResearchSceneIds: Array.from(researchSet),
    regenerateNarration,
    rationale: `Supervisor determinou reparos pontuais (tentativa ${attempt}/${maxAttempts}): ${rerenderSet.size} cena(s) para re-render incremental, ${researchSet.size} para nova mídia, narração=${regenerateNarration ? 'sim' : 'não'}.`,
  };
}
