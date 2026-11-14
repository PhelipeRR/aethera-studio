import { z } from 'zod';
import { applyTimelineOps, avoidableFlatBackgroundSceneIds, timelineChangeSchema, timelineOpSchema, type TimelineChange, type TimelineDocument, type TimelineOp } from './aethera-timeline.js';

export const aetheraReviewFindingSchema = z.strictObject({ id: z.string().min(1), code: z.enum(['missing-visual', 'overlap', 'rights-review', 'unverified-media', 'flat-background']), severity: z.enum(['blocking', 'warning']), message: z.string().min(1), clipIds: z.array(z.string()), correction: z.array(timelineOpSchema).optional() });
export type AetheraReviewFinding = z.infer<typeof aetheraReviewFindingSchema>;

/** Persisted AP-10 evidence. The hash/version pair binds findings to the exact Player/render document reviewed. */
export const aetheraReviewReportSchema = z.strictObject({
  schemaVersion: z.literal(1), runId: z.string().min(1), timelineVersion: z.number().int().positive(), timelineHash: z.string().min(1),
  requestedCycles: z.number().int().nonnegative(), cycles: z.number().int().nonnegative(), findings: z.array(aetheraReviewFindingSchema), changes: z.array(timelineChangeSchema),
});
export type AetheraReviewReport = z.infer<typeof aetheraReviewReportSchema>;

export const aetheraReviewReportRecordSchema = z.strictObject({
  id: z.string().uuid(), runId: z.string().uuid(), timelineVersion: z.number().int().positive(), timelineHash: z.string().min(1),
  requestedCycles: z.number().int().nonnegative(), cycles: z.number().int().nonnegative(), findings: z.array(aetheraReviewFindingSchema), changes: z.array(timelineChangeSchema), createdAt: z.string(),
});
export type AetheraReviewReportRecord = z.infer<typeof aetheraReviewReportRecordSchema>;

const clips = (timeline: TimelineDocument) => timeline.tracks.flatMap((track) => track.items.map((clip) => ({ track, clip })));

/** Finds deterministic timeline defects. Pixel/audio measurements remain the Quality Director's FFmpeg responsibility. */
export function reviewAetheraTimeline(timeline: TimelineDocument): AetheraReviewFinding[] {
  const findings: AetheraReviewFinding[] = [];
  const byScene = new Map<string, Set<string>>();
  for (const { track, clip } of clips(timeline)) for (const sceneId of clip.sceneIds) byScene.set(sceneId, new Set([...(byScene.get(sceneId) ?? []), track.kind]));
  for (const clip of timeline.tracks.find((track) => track.kind === 'narration')?.items ?? []) {
    if (!clip.sceneIds.some((sceneId) => ['video', 'graphics', 'text'].some((kind) => byScene.get(sceneId)?.has(kind)))) {
      findings.push({ id: `missing-visual:${clip.sceneIds[0] ?? clip.id}`, code: 'missing-visual', severity: 'blocking', message: `A cena ${clip.sceneIds[0] ?? clip.id} tem narração, mas não tem vídeo, gráfico ou texto de cobertura.`, clipIds: [clip.id], correction: [{ op: 'insertGraphic', trackId: 'graphics', atMs: clip.startMs, durationMs: clip.durationMs, component: 'title', version: 1, props: { impact: 'medium', title: 'Cobertura da cena' }, sceneIds: clip.sceneIds, ...(clip.subjectId ? { subjectId: clip.subjectId } : {}) }] });
    }
  }
  for (const track of timeline.tracks) {
    const sorted = [...track.items].sort((left, right) => left.startMs - right.startMs || left.id.localeCompare(right.id));
    for (let index = 1; index < sorted.length; index++) {
      const previous = sorted[index - 1];
      const current = sorted[index];
      if (!previous || !current) continue;
      if (current.startMs < previous.startMs + previous.durationMs && ['video', 'graphics', 'text'].includes(track.kind)) findings.push({ id: `overlap:${track.id}:${current.id}`, code: 'overlap', severity: 'blocking', message: `Clipes sobrepostos na faixa ${track.label}; a correção move o segundo clipe para o fim do anterior.`, clipIds: [previous.id, current.id], correction: [{ op: 'move', selector: { clipIds: [current.id] }, startMs: previous.startMs + previous.durationMs }] });
    }
  }
  for (const { clip } of clips(timeline)) {
    if (clip.provenance && clip.provenance.legalClearance !== 'approved') findings.push({ id: `rights:${clip.id}`, code: 'rights-review', severity: 'warning', message: `A proveniência de ${clip.id} não tem legalClearance aprovado; a revisão humana continua obrigatória.`, clipIds: [clip.id] });
    if (clip.source.kind === 'media' && !clip.source.proxyPath) findings.push({ id: `proxy:${clip.id}`, code: 'unverified-media', severity: 'warning', message: `O clipe ${clip.id} ainda não tem proxy registrado para a prévia.`, clipIds: [clip.id] });
  }
  for (const sceneId of avoidableFlatBackgroundSceneIds(timeline)) {
    const clipIds = clips(timeline).filter(({ track, clip }) => (track.kind === 'graphics' || track.kind === 'text') && clip.sceneIds.includes(sceneId)).map(({ clip }) => clip.id);
    findings.push({ id: `flat-background:${sceneId}`, code: 'flat-background', severity: 'warning', message: `A cena ${sceneId} mostra texto sobre fundo chapado, mas há imagens do mesmo assunto na timeline (D-AP-17); coloque um trecho relacionado por trás.`, clipIds });
  }
  return aetheraReviewFindingSchema.array().parse(findings);
}

export function runAetheraReviewCycles(timeline: TimelineDocument, requestedCycles = 2): { document: TimelineDocument; cycles: number; findings: AetheraReviewFinding[]; changes: TimelineChange[] } {
  let document = timeline;
  let findings = reviewAetheraTimeline(document);
  const changes: TimelineChange[] = [];
  const maxCycles = Math.min(2, Math.max(0, Math.floor(requestedCycles)));
  let cycles = 0;
  while (cycles < maxCycles) {
    const corrections = findings.flatMap((finding) => finding.correction ?? []).filter((op, index, all) => all.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(op)) === index);
    if (!corrections.length) break;
    const applied = applyTimelineOps(document, corrections as TimelineOp[], { author: 'review', command: `Revisão automática ciclo ${cycles + 1}` });
    document = applied.document;
    changes.push(applied.change);
    cycles += 1;
    findings = reviewAetheraTimeline(document);
  }
  return { document, cycles, findings, changes };
}
