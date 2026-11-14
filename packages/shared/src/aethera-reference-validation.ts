import { z } from 'zod';

/** Evidence contract for the real three-game AS-10 gate (§6 and §5). It records observations only; it never creates a metric. */
export const aetheraReferenceStageKinds = ['research', 'acquisition', 'frames', 'classification', 'timestamp_clips', 'scene_matching', 'narration_sync', 'render', 'scene_swap', 'quality'] as const;
export type AetheraReferenceStage = (typeof aetheraReferenceStageKinds)[number];

const evidenceStatus = z.enum(['pass', 'blocked', 'fail']);
const nullablePath = z.string().trim().min(1).nullable();
const stageEvidenceSchema = z.strictObject({ stage: z.enum(aetheraReferenceStageKinds), status: evidenceStatus, evidence: z.array(z.string().trim().min(1)) });
const mediaEvidenceSchema = z.strictObject({ path: nullablePath, present: z.boolean(), provenancePath: nullablePath });
const metricsSchema = z.strictObject({
  stageDurationsMs: z.record(z.string().min(1), z.number().int().nonnegative()),
  totalDurationMs: z.number().int().nonnegative().nullable(),
  downloadedBytes: z.number().int().nonnegative().nullable(),
  diskBytes: z.number().int().nonnegative().nullable(),
  providerCalls: z.array(z.strictObject({ provider: z.string().min(1), calls: z.number().int().nonnegative(), costUsd: z.number().nonnegative().nullable() })),
  matching: z.strictObject({ correct: z.number().int().nonnegative(), total: z.number().int().positive() }).nullable(),
  defects: z.strictObject({ detected: z.number().int().nonnegative(), total: z.number().int().positive() }).nullable(),
  peakMemoryMb: z.number().nonnegative().nullable(),
  segmentsReused: z.number().int().nonnegative().nullable(),
});

export const aetheraReferenceValidationInputSchema = z.strictObject({
  schemaVersion: z.literal(1), runId: z.string().min(1), sourceRoot: z.string().min(1),
  games: z.array(z.strictObject({
    title: z.string().trim().min(1), igdbId: z.string().trim().min(1).nullable(),
    research: z.strictObject({ status: z.enum(['confirmed', 'unconfirmed', 'conflicting']), sourceCount: z.number().int().nonnegative(), evidencePath: nullablePath }),
    media: z.strictObject({ trailer: mediaEvidenceSchema, gameplay: mediaEvidenceSchema }),
  })).length(3),
  labels: z.strictObject({ path: nullablePath, calibrationCount: z.number().int().nonnegative(), testCount: z.number().int().nonnegative() }),
  stages: z.array(stageEvidenceSchema).length(aetheraReferenceStageKinds.length).superRefine((stages, context) => {
    const seen = new Set<string>();
    for (const item of stages) {
      if (seen.has(item.stage)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Etapa duplicada: ${item.stage}.`, path: ['stages'] });
      seen.add(item.stage);
    }
    for (const stage of aetheraReferenceStageKinds) if (!seen.has(stage)) context.addIssue({ code: z.ZodIssueCode.custom, message: `Etapa ausente: ${stage}.`, path: ['stages'] });
  }),
  render: z.strictObject({ outputPath: nullablePath, ffprobe: z.strictObject({ valid: z.boolean(), format: z.enum(['mp4']).nullable(), width: z.number().int().positive().nullable(), height: z.number().int().positive().nullable() }) }),
  sceneSwap: z.strictObject({ affectedSceneIds: z.array(z.string().min(1)), rerenderedSegmentIds: z.array(z.string().min(1)), reusedSegmentIds: z.array(z.string().min(1)), reconstructionAvoided: z.boolean() }),
  quality: z.strictObject({ reportPath: nullablePath, blockingIssues: z.number().int().nonnegative(), passed: z.boolean() }),
  metrics: metricsSchema,
});
export type AetheraReferenceValidationInput = z.infer<typeof aetheraReferenceValidationInputSchema>;
export type AetheraReferenceMetrics = z.infer<typeof metricsSchema>;

const checkSchema = z.strictObject({ id: z.string().min(1), status: evidenceStatus, evidence: z.array(z.string().min(1)) });
export const aetheraReferenceValidationReportSchema = z.strictObject({
  schemaVersion: z.literal(1), runId: z.string().min(1), sourceRoot: z.string().min(1), generatedAt: z.string().min(1),
  status: z.enum(['pass', 'blocked', 'fail']), checks: z.array(checkSchema), blockers: z.array(z.string().min(1)), metrics: metricsSchema,
});
export type AetheraReferenceValidationReport = z.infer<typeof aetheraReferenceValidationReportSchema>;

export const emptyAetheraReferenceMetrics = (): AetheraReferenceMetrics => ({ stageDurationsMs: {}, totalDurationMs: null, downloadedBytes: null, diskBytes: null, providerCalls: [], matching: null, defects: null, peakMemoryMb: null, segmentsReused: null });
const check = (id: string, status: z.infer<typeof evidenceStatus>, evidence: string[]): z.infer<typeof checkSchema> => ({ id, status, evidence: evidence.length ? evidence : ['Nenhuma evidência registrada.'] });

function aggregateStatuses(items: readonly { status: z.infer<typeof evidenceStatus> }[]): z.infer<typeof evidenceStatus> {
  return items.some((item) => item.status === 'fail') ? 'fail' : items.some((item) => item.status === 'blocked') ? 'blocked' : 'pass';
}

/**
 * Decides the AS-10 gate from persisted evidence. Missing real artifacts stay blocked; explicit defects stay failed;
 * a passing result is impossible without all three games, both media kinds, the render proof and the QA report.
 */
export function validateAetheraReference(input: unknown, now = new Date()): AetheraReferenceValidationReport {
  const parsed = aetheraReferenceValidationInputSchema.safeParse(input);
  if (!parsed.success) {
    return aetheraReferenceValidationReportSchema.parse({ schemaVersion: 1, runId: 'unknown', sourceRoot: 'unknown', generatedAt: now.toISOString(), status: 'blocked', checks: [check('input-schema', 'blocked', parsed.error.issues.map((issue) => issue.message))], blockers: ['input-schema'], metrics: emptyAetheraReferenceMetrics() });
  }
  const value = parsed.data;
  const checks: Array<z.infer<typeof checkSchema>> = [];

  const researchStatuses = value.games.map((game) => {
    if (game.research.status === 'conflicting') return check('research-verification', 'fail', [`${game.title}: fontes conflitantes.`]);
    if (!game.igdbId || game.research.status !== 'confirmed' || game.research.sourceCount < 2 || !game.research.evidencePath) return check('research-verification', 'blocked', [`${game.title}: IGDB, confirmação e pelo menos duas fontes são obrigatórios.`]);
    return check('research-verification', 'pass', [`${game.title}: IGDB ${game.igdbId}, ${game.research.sourceCount} fontes, ${game.research.evidencePath}.`]);
  });
  checks.push(check('research-verification', aggregateStatuses(researchStatuses), researchStatuses.flatMap((item) => item.evidence)));

  const mediaStatuses = value.games.map((game) => {
    const media = [game.media.trailer, game.media.gameplay];
    if (media.some((item) => item.present && (!item.path || !item.provenancePath))) return check('media-provenance', 'fail', [`${game.title}: mídia presente sem caminho ou proveniência.`]);
    if (media.some((item) => !item.present || !item.path || !item.provenancePath)) return check('media-provenance', 'blocked', [`${game.title}: trailer e gameplay com proveniência ainda não estão disponíveis.`]);
    return check('media-provenance', 'pass', [`${game.title}: trailer e gameplay registrados.`]);
  });
  checks.push(check('media-provenance', aggregateStatuses(mediaStatuses), mediaStatuses.flatMap((item) => item.evidence)));

  if (!value.labels.path || value.labels.calibrationCount === 0 || value.labels.testCount === 0) checks.push(check('labels-calibration-test', 'blocked', ['Labels manuais, calibração e teste ainda não estão disponíveis.']));
  else checks.push(check('labels-calibration-test', 'pass', [`${value.labels.calibrationCount} labels de calibração e ${value.labels.testCount} de teste em ${value.labels.path}.`]));

  const stages = new Map(value.stages.map((stage) => [stage.stage, stage]));
  const stageItems = aetheraReferenceStageKinds.map((stage) => stages.get(stage) ?? { status: 'blocked' as const, evidence: [`Etapa ausente: ${stage}.`] });
  checks.push(check('pipeline-evidence', aggregateStatuses(stageItems), stageItems.flatMap((item) => item.evidence)));

  const probe = value.render.ffprobe;
  if (!value.render.outputPath || !probe.valid || probe.format === null || probe.width === null || probe.height === null) checks.push(check('render-1080p', 'blocked', ['Render final ou evidência FFprobe ainda não está disponível.']));
  else if (probe.format !== 'mp4' || probe.width !== 1920 || probe.height !== 1080) checks.push(check('render-1080p', 'fail', [`FFprobe: ${probe.format} ${probe.width}x${probe.height}; esperado MP4 1920x1080.`]));
  else checks.push(check('render-1080p', 'pass', [`${value.render.outputPath}: MP4 1920x1080 confirmado por FFprobe.`]));

  if (!value.sceneSwap.affectedSceneIds.length || !value.sceneSwap.reusedSegmentIds.length || !value.sceneSwap.reconstructionAvoided) checks.push(check('scene-swap-reuse', 'blocked', ['A troca de cena e a reutilização incremental ainda não têm evidência suficiente.']));
  else if (value.sceneSwap.rerenderedSegmentIds.length > value.sceneSwap.affectedSceneIds.length) checks.push(check('scene-swap-reuse', 'fail', [`${value.sceneSwap.rerenderedSegmentIds.length} segmentos re-renderizados para ${value.sceneSwap.affectedSceneIds.length} cena(s) afetada(s).`]));
  else checks.push(check('scene-swap-reuse', 'pass', [`${value.sceneSwap.rerenderedSegmentIds.length} segmento(s) re-renderizado(s), ${value.sceneSwap.reusedSegmentIds.length} reutilizado(s).`]));

  if (!value.quality.reportPath) checks.push(check('quality-report', 'blocked', ['Relatório do Quality Director ainda não está disponível.']));
  else if (!value.quality.passed || value.quality.blockingIssues > 0) checks.push(check('quality-report', 'fail', [`Quality Director registrou ${value.quality.blockingIssues} bloqueio(s).`]));
  else checks.push(check('quality-report', 'pass', [`QA sem bloqueios em ${value.quality.reportPath}.`]));

  const metricMissing = [
    value.metrics.totalDurationMs === null ? 'duração total' : null,
    value.metrics.downloadedBytes === null ? 'bytes baixados' : null,
    value.metrics.diskBytes === null ? 'bytes em disco' : null,
    value.metrics.peakMemoryMb === null ? 'pico de memória' : null,
    value.metrics.segmentsReused === null ? 'segmentos reutilizados' : null,
    value.metrics.matching === null ? 'precisão de matching' : null,
    value.metrics.defects === null ? 'defeitos detectados' : null,
    value.metrics.providerCalls.length === 0 ? 'chamadas por provedor' : null,
    aetheraReferenceStageKinds.some((stage) => value.metrics.stageDurationsMs[stage] === undefined) ? 'tempo por etapa' : null,
  ].filter((item): item is string => item !== null);
  checks.push(metricMissing.length ? check('metrics', 'blocked', [`Métricas ausentes: ${metricMissing.join(', ')}.`]) : check('metrics', 'pass', ['Métricas de duração, recursos, provedores, matching, defeitos e reuso registradas.']));

  const blockers = checks.filter((item) => item.status !== 'pass').map((item) => item.id);
  return aetheraReferenceValidationReportSchema.parse({ schemaVersion: 1, runId: value.runId, sourceRoot: value.sourceRoot, generatedAt: now.toISOString(), status: checks.some((item) => item.status === 'fail') ? 'fail' : blockers.length ? 'blocked' : 'pass', checks, blockers: [...new Set(blockers)], metrics: value.metrics });
}
