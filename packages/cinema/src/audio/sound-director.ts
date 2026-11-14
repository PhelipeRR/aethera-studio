import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type AudioBusId =
  | 'A1_narration'
  | 'A2_gameplay_dialogue'
  | 'A3_music'
  | 'A4_sfx'
  | 'A5_ambience';

export type AudioEventRole = 'narration' | 'gameplay_dialogue' | 'music' | 'sfx' | 'ambience';

export interface AudioTimelineEvent {
  sourceId: string;
  sceneId: string;
  bus: AudioBusId;
  role: AudioEventRole;
  startMs: number;
  endMs: number;
  gainDb: number;
  priority: number;
  label?: string;
  fadeInMs?: number;
  fadeOutMs?: number;
  duckedUnderSpeech?: boolean;
}

export interface AudioConflictRecord {
  conflictId: string;
  severity: 'critical' | 'warning';
  type:
    | 'narration_overlap'
    | 'narration_tight_gap'
    | 'narration_truncated'
    | 'narration_vs_gameplay_dialogue'
    | 'sfx_masking_speech'
    | 'music_unducked_over_speech';
  startMs: number;
  endMs: number;
  sources: string[];
  sceneIds: string[];
  origin: string;
  description: string;
  correctiveAction: string;
}

export interface SoundDirectorAuditReport {
  approved: boolean;
  totalDurationMs: number;
  minGapMs: number;
  blockedReasons: string[];
  conflicts: AudioConflictRecord[];
  busesSummary: Record<AudioBusId, { eventCount: number; totalActiveMs: number }>;
}

export class SoundDirectorBlockedError extends Error {
  readonly report: SoundDirectorAuditReport;

  constructor(report: SoundDirectorAuditReport) {
    super(
      `Diretor de Som bloqueou a renderização: ${report.blockedReasons.join(' | ')}`,
    );
    this.name = 'SoundDirectorBlockedError';
    this.report = report;
  }
}

export async function measureAudioDurationMs(filePath: string): Promise<number> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=noprint_wrappers=1:nokey=1',
    filePath,
  ]);
  const sec = Number(stdout.trim());
  if (!Number.isFinite(sec) || sec <= 0) {
    throw new Error(`Duração de áudio inválida em ${filePath}: "${stdout.trim()}"`);
  }
  return Math.round(sec * 1000);
}

function overlapRange(a: AudioTimelineEvent, b: AudioTimelineEvent): { startMs: number; endMs: number } | null {
  const startMs = Math.max(a.startMs, b.startMs);
  const endMs = Math.min(a.endMs, b.endMs);
  return endMs > startMs ? { startMs, endMs } : null;
}

export function auditAudioTimeline(
  events: AudioTimelineEvent[],
  totalDurationMs: number,
  options?: { minNarrationGapMs?: number },
): SoundDirectorAuditReport {
  const minGapMs = options?.minNarrationGapMs ?? 180;
  const conflicts: AudioConflictRecord[] = [];
  const busesSummary: Record<AudioBusId, { eventCount: number; totalActiveMs: number }> = {
    A1_narration: { eventCount: 0, totalActiveMs: 0 },
    A2_gameplay_dialogue: { eventCount: 0, totalActiveMs: 0 },
    A3_music: { eventCount: 0, totalActiveMs: 0 },
    A4_sfx: { eventCount: 0, totalActiveMs: 0 },
    A5_ambience: { eventCount: 0, totalActiveMs: 0 },
  };

  for (const ev of events) {
    const dur = Math.max(0, ev.endMs - ev.startMs);
    busesSummary[ev.bus].eventCount += 1;
    busesSummary[ev.bus].totalActiveMs += dur;
  }

  const narrations = events
    .filter((e) => e.bus === 'A1_narration')
    .sort((a, b) => a.startMs - b.startMs);

  const dialogues = events.filter((e) => e.bus === 'A2_gameplay_dialogue');
  const sfxEvents = events.filter((e) => e.bus === 'A4_sfx');
  const musicEvents = events.filter((e) => e.bus === 'A3_music');

  // 1. Check consecutive narrations for overlap or insufficient breathing gap
  for (let i = 0; i < narrations.length; i += 1) {
    const cur = narrations[i];
    if (!cur) continue;
    if (cur.endMs > totalDurationMs) {
      conflicts.push({
        conflictId: `nar_trunc_${i + 1}`,
        severity: 'critical',
        type: 'narration_truncated',
        startMs: totalDurationMs,
        endMs: cur.endMs,
        sources: [cur.sourceId],
        sceneIds: [cur.sceneId],
        origin: 'A1_narration',
        description: `Narração "${cur.sourceId}" (${cur.endMs}ms) ultrapassa a duração total do vídeo (${totalDurationMs}ms) e será cortada.`,
        correctiveAction: 'Encurtar o texto da cena ou estender a duração da cena antes da renderização.',
      });
    }

    const next = narrations[i + 1];
    if (next) {
      const ov = overlapRange(cur, next);
      if (ov) {
        conflicts.push({
          conflictId: `nar_overlap_${i + 1}_${i + 2}`,
          severity: 'critical',
          type: 'narration_overlap',
          startMs: ov.startMs,
          endMs: ov.endMs,
          sources: [cur.sourceId, next.sourceId],
          sceneIds: [cur.sceneId, next.sceneId],
          origin: 'A1_narration',
          description: `Sobreposição de falas entre "${cur.sourceId}" e "${next.sourceId}" (${ov.startMs}ms–${ov.endMs}ms, ${ov.endMs - ov.startMs}ms).`,
          correctiveAction: 'Ajustar roteiro, antecipar início ou ampliar duração da cena anterior até zerar sobreposição.',
        });
      } else {
        const gap = next.startMs - cur.endMs;
        if (gap < minGapMs) {
          conflicts.push({
            conflictId: `nar_tight_${i + 1}_${i + 2}`,
            severity: 'warning',
            type: 'narration_tight_gap',
            startMs: cur.endMs,
            endMs: next.startMs,
            sources: [cur.sourceId, next.sourceId],
            sceneIds: [cur.sceneId, next.sceneId],
            origin: 'A1_narration',
            description: `Respiro curto entre "${cur.sourceId}" e "${next.sourceId}": ${gap}ms (mínimo recomendado ${minGapMs}ms).`,
            correctiveAction: 'Adicionar pausa mínima de 180–250ms entre falas consecutivas.',
          });
        }
      }
    }

    // 2. Check A1 narration vs A2 gameplay dialogue
    for (const dlg of dialogues) {
      const ov = overlapRange(cur, dlg);
      if (ov) {
        conflicts.push({
          conflictId: `nar_dlg_${cur.sourceId}_${dlg.sourceId}`,
          severity: 'critical',
          type: 'narration_vs_gameplay_dialogue',
          startMs: ov.startMs,
          endMs: ov.endMs,
          sources: [cur.sourceId, dlg.sourceId],
          sceneIds: [cur.sceneId, dlg.sceneId],
          origin: 'A1_narration + A2_gameplay_dialogue',
          description: `Diálogo do gameplay "${dlg.sourceId}" compete com a narração "${cur.sourceId}" (${ov.startMs}ms–${ov.endMs}ms).`,
          correctiveAction: 'Silenciar/atenuar A2 durante a fala ou reposicionar a narração fora da janela do diálogo.',
        });
      }
    }

    // 3. Check A4 SFX masking speech if loud
    for (const sfx of sfxEvents) {
      const ov = overlapRange(cur, sfx);
      if (ov && sfx.gainDb > -6) {
        conflicts.push({
          conflictId: `sfx_mask_${sfx.sourceId}_${cur.sourceId}`,
          severity: 'warning',
          type: 'sfx_masking_speech',
          startMs: ov.startMs,
          endMs: ov.endMs,
          sources: [sfx.sourceId, cur.sourceId],
          sceneIds: [sfx.sceneId, cur.sceneId],
          origin: 'A4_sfx',
          description: `SFX "${sfx.sourceId}" (${sfx.gainDb} dB) coincide com narração "${cur.sourceId}" sem atenuação.`,
          correctiveAction: 'Atenuar SFX para <= -8 dB durante fala ou deslocar para a transição entre cenas.',
        });
      }
    }

    // 4. Check A3 music without ducking
    for (const mus of musicEvents) {
      const ov = overlapRange(cur, mus);
      if (ov && !mus.duckedUnderSpeech) {
        conflicts.push({
          conflictId: `mus_unducked_${mus.sourceId}_${cur.sourceId}`,
          severity: 'warning',
          type: 'music_unducked_over_speech',
          startMs: ov.startMs,
          endMs: ov.endMs,
          sources: [mus.sourceId, cur.sourceId],
          sceneIds: [mus.sceneId, cur.sceneId],
          origin: 'A3_music',
          description: `Trilha musical "${mus.sourceId}" está sem sidechain ducking sob a narração "${cur.sourceId}".`,
          correctiveAction: 'Ativar sidechaincompress na trilha A3 controlado pelo bus A1.',
        });
      }
    }
  }

  const criticals = conflicts.filter((c) => c.severity === 'critical');
  return {
    approved: criticals.length === 0,
    totalDurationMs,
    minGapMs,
    blockedReasons: criticals.map((c) => c.description),
    conflicts,
    busesSummary,
  };
}

export function assertSoundDirectorApproval(report: SoundDirectorAuditReport): void {
  if (!report.approved) {
    throw new SoundDirectorBlockedError(report);
  }
}
