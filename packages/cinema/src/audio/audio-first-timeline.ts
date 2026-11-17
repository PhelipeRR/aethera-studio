export interface MeasuredNarrationSegment {
  segmentId: string;
  speechDurationMs: number;
  pauseAfterMs: number;
}

export interface NarrationSegmentTiming {
  segmentId: string;
  startMs: number;
  speechEndMs: number;
  endMs: number;
  pauseAfterMs: number;
}

export interface MeasuredNarrationTimeline {
  totalDurationMs: number;
  segments: NarrationSegmentTiming[];
}

export type AudioFirstDurationAdjustmentKind =
  | 'extend_timeline_for_narration'
  | 'preserve_planned_tail'
  | 'no_duration_adjustment';

export interface AudioFirstDurationAdjustment {
  kind: AudioFirstDurationAdjustmentKind;
  deltaMs: number;
  fromDurationMs: number;
  toDurationMs: number;
  reason: string;
}

export interface AudioFirstDurationAudit {
  plannedDurationMs: number;
  measuredNarrationDurationMs: number;
  finalTimelineDurationMs: number;
  narrationEndMs: number;
  durationToleranceMs: number;
  completeNarrationPreserved: true;
  adjustments: AudioFirstDurationAdjustment[];
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} deve ser um número finito não negativo.`);
  }
  return Math.round(value);
}

/**
 * Builds the measured narration clock without replacing pauses with an estimate.
 * The caller passes ffprobe measurements for each generated segment and the pause
 * that was intentionally inserted after it.
 */
export function measureNarrationSegmentsWithPauses(
  segments: MeasuredNarrationSegment[],
): MeasuredNarrationTimeline {
  let cursorMs = 0;
  const measured = segments.map((segment) => {
    const speechDurationMs = positiveInteger(segment.speechDurationMs, `${segment.segmentId}.speechDurationMs`);
    const pauseAfterMs = positiveInteger(segment.pauseAfterMs, `${segment.segmentId}.pauseAfterMs`);
    const startMs = cursorMs;
    const speechEndMs = startMs + speechDurationMs;
    const endMs = speechEndMs + pauseAfterMs;
    cursorMs = endMs;
    return { segmentId: segment.segmentId, startMs, speechEndMs, endMs, pauseAfterMs };
  });
  return { totalDurationMs: cursorMs, segments: measured };
}

/**
 * Selects the final timeline clock after narration is actually generated and
 * measured. Speech is never shortened: a longer narration extends the video,
 * while a shorter narration leaves the planned tail intact.
 */
export function buildAudioFirstDurationAudit(input: {
  plannedTimelineDurationMs: number;
  measuredNarrationDurationMs: number;
  durationToleranceMs?: number;
}): AudioFirstDurationAudit {
  const plannedDurationMs = positiveInteger(input.plannedTimelineDurationMs, 'plannedTimelineDurationMs');
  const measuredNarrationDurationMs = positiveInteger(input.measuredNarrationDurationMs, 'measuredNarrationDurationMs');
  const finalTimelineDurationMs = Math.max(plannedDurationMs, measuredNarrationDurationMs);
  const deltaMs = Math.abs(measuredNarrationDurationMs - plannedDurationMs);
  const durationToleranceMs = input.durationToleranceMs === undefined
    ? Math.max(1_500, Math.round(finalTimelineDurationMs * 0.08))
    : positiveInteger(input.durationToleranceMs, 'durationToleranceMs');

  const adjustment: AudioFirstDurationAdjustment = measuredNarrationDurationMs > plannedDurationMs
    ? {
        kind: 'extend_timeline_for_narration',
        deltaMs,
        fromDurationMs: plannedDurationMs,
        toDurationMs: finalTimelineDurationMs,
        reason: 'A duração medida da narração excede o planejamento; a timeline foi estendida para preservar a fala completa.',
      }
    : measuredNarrationDurationMs < plannedDurationMs
      ? {
          kind: 'preserve_planned_tail',
          deltaMs,
          fromDurationMs: measuredNarrationDurationMs,
          toDurationMs: finalTimelineDurationMs,
          reason: 'A narração medida é menor que o planejamento; a cauda visual planejada foi preservada sem inserir fala artificial.',
        }
      : {
          kind: 'no_duration_adjustment',
          deltaMs: 0,
          fromDurationMs: plannedDurationMs,
          toDurationMs: finalTimelineDurationMs,
          reason: 'A duração medida coincide com o planejamento.',
        };

  return {
    plannedDurationMs,
    measuredNarrationDurationMs,
    finalTimelineDurationMs,
    narrationEndMs: measuredNarrationDurationMs,
    durationToleranceMs,
    completeNarrationPreserved: true,
    adjustments: [adjustment],
  };
}
