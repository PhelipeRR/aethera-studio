import { z } from 'zod';
import { applyTimelineOps, timelineOpSchema, type TimelineDocument, type TimelineOp } from './aethera-timeline.js';

export const aetheraAssistantStatusSchema = z.enum(['ready', 'needs_review', 'unsupported']);
export type AetheraAssistantStatus = z.infer<typeof aetheraAssistantStatusSchema>;

export const aetheraTimelineDiffSchema = z.strictObject({ clipId: z.string(), kind: z.enum(['inserted', 'changed', 'deleted']), before: z.unknown().nullable(), after: z.unknown().nullable() });
export type AetheraTimelineDiff = z.infer<typeof aetheraTimelineDiffSchema>;

export const aetheraTimelineAssistantPlanSchema = z.strictObject({ schemaVersion: z.literal(1), status: aetheraAssistantStatusSchema, command: z.string(), summary: z.string(), ops: z.array(timelineOpSchema), affectedClipIds: z.array(z.string()), diff: z.array(aetheraTimelineDiffSchema) });
export type AetheraTimelineAssistantPlan = z.infer<typeof aetheraTimelineAssistantPlanSchema>;

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/gu, '').toLocaleLowerCase('pt-BR');
const clips = (timeline: TimelineDocument) => timeline.tracks.flatMap((track) => track.items.map((clip) => ({ track, clip })));
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function diff(before: TimelineDocument, after: TimelineDocument): AetheraTimelineDiff[] {
  const beforeById = new Map(clips(before).map(({ clip }) => [clip.id, clip]));
  const afterById = new Map(clips(after).map(({ clip }) => [clip.id, clip]));
  const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
  return [...ids].filter((id) => !equal(beforeById.get(id), afterById.get(id))).map((clipId) => ({ clipId, kind: !beforeById.has(clipId) ? 'inserted' : !afterById.has(clipId) ? 'deleted' : 'changed', before: beforeById.get(clipId) ?? null, after: afterById.get(clipId) ?? null }));
}

function unsupported(command: string, summary: string): AetheraTimelineAssistantPlan {
  return aetheraTimelineAssistantPlanSchema.parse({ schemaVersion: 1, status: 'unsupported', command, summary, ops: [], affectedClipIds: [], diff: [] });
}

/** Turns the first AP-09 natural-language editing command into safe, reviewable operations. */
export function planAetheraTimelineCommand(input: { timeline: TimelineDocument; command: string }): AetheraTimelineAssistantPlan {
  const command = input.command.trim();
  const normalized = normalize(command);
  const requested = normalized.includes('terceiro jogo') || normalized.includes('terceiro game') || normalized.includes('jogo 3');
  if (!requested || !normalized.includes('troque') || !normalized.includes('titulo') || !normalized.includes('musica')) return unsupported(command, 'Comando não reconhecido com segurança; nenhuma alteração foi proposta.');

  const subjectIds = [...new Set(clips(input.timeline).map(({ clip }) => clip.subjectId).filter((id): id is string => Boolean(id)))];
  const targetSubject = subjectIds[2];
  const videoClips = clips(input.timeline).filter(({ track, clip }) => track.kind === 'video' && clip.subjectId === targetSubject && clip.source.kind === 'media');
  const replacement = videoClips[1] ?? clips(input.timeline).find(({ track, clip }) => track.kind === 'video' && clip.source.kind === 'media' && clip.subjectId !== targetSubject);
  const target = videoClips[0];
  if (!targetSubject || !target || !replacement) return aetheraTimelineAssistantPlanSchema.parse({ schemaVersion: 1, status: 'needs_review', command, summary: 'O terceiro jogo não tem dois trechos existentes para trocar sem adquirir mídia nova.', ops: [], affectedClipIds: [], diff: [] });

  const ops: TimelineOp[] = [
    { op: 'replaceSource', selector: { clipIds: [target.clip.id] }, source: replacement.clip.source },
    { op: 'insertGraphic', trackId: 'graphics', atMs: target.clip.startMs, durationMs: Math.min(target.clip.durationMs, 1_600), component: 'title', version: 1, props: { impact: 'high', title: `Impacto · ${targetSubject}` }, sceneIds: target.clip.sceneIds, subjectId: targetSubject },
  ];
  const musicClips = clips(input.timeline).filter(({ track, clip }) => track.kind === 'music' && clip.source.kind === 'audio');
  for (const { clip } of musicClips) ops.push({ op: 'setGain', selector: { clipIds: [clip.id] }, gainDb: clip.source.kind === 'audio' ? clip.source.gainDb - 6 : -6 });
  if (!musicClips.length) return aetheraTimelineAssistantPlanSchema.parse({ schemaVersion: 1, status: 'needs_review', command, summary: 'O terceiro jogo tem trechos existentes, mas não há música persistida para reduzir durante a narração.', ops: [], affectedClipIds: [], diff: [] });

  const applied = applyTimelineOps(input.timeline, ops, { author: 'agent', command });
  return aetheraTimelineAssistantPlanSchema.parse({ schemaVersion: 1, status: 'ready', command, summary: 'Trocar gameplay do terceiro jogo, aumentar o impacto do título e reduzir a música em 6 dB durante a narração.', ops, affectedClipIds: applied.change.affectedClipIds, diff: diff(input.timeline, applied.document) });
}

/** Applies only a plan previously shown to a person; callers keep the prior document for undo. */
export function applyAetheraTimelineAssistantPlan(timeline: TimelineDocument, plan: AetheraTimelineAssistantPlan): { document: TimelineDocument; change: ReturnType<typeof applyTimelineOps>['change'] } {
  if (plan.status !== 'ready') throw new Error('invalid: o plano precisa estar pronto e revisado antes de aplicar.');
  return applyTimelineOps(timeline, plan.ops, { author: 'user', command: plan.command });
}
