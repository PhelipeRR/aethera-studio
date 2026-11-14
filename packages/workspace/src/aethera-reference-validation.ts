import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import { aetheraReferenceValidationReportSchema, emptyAetheraReferenceMetrics, validateAetheraReference, type AetheraReferenceValidationReport } from '@neuralbridge/shared';
import { isInsideProject } from './project-paths.js';

/** Relative, user-auditable envelope written by the AS-10 runner; this loader never writes or downloads it. */
export const AETHERA_REFERENCE_EVIDENCE_PATH = 'validation/as-10-evidence.json';

const blocked = (root: string, evidence: string, now: Date): AetheraReferenceValidationReport => aetheraReferenceValidationReportSchema.parse({
  schemaVersion: 1, runId: 'unknown', sourceRoot: root, generatedAt: now.toISOString(), status: 'blocked',
  checks: [{ id: 'evidence-file', status: 'blocked', evidence: [evidence] }], blockers: ['evidence-file'], metrics: emptyAetheraReferenceMetrics(),
});

type ReferenceInput = Parameters<typeof validateAetheraReference>[0] & {
  sourceRoot: string;
  games: Array<{ research: { evidencePath: string | null }; media: { trailer: { path: string | null; provenancePath: string | null }; gameplay: { path: string | null; provenancePath: string | null } } }>;
  labels: { path: string | null };
  render: { outputPath: string | null };
  quality: { reportPath: string | null };
};

async function missingArtifacts(root: string, input: ReferenceInput): Promise<string[]> {
  const issues: string[] = [];
  if (resolve(input.sourceRoot).toLowerCase() !== root.toLowerCase()) issues.push('sourceRoot do envelope não corresponde à pasta validada.');
  const paths: Array<{ label: string; value: string | null }> = [
    { label: 'manifest.json', value: 'manifest.json' },
    ...input.games.flatMap((game, index) => [
      { label: `games[${index}].research.evidencePath`, value: game.research.evidencePath },
      { label: `games[${index}].media.trailer.path`, value: game.media.trailer.path },
      { label: `games[${index}].media.trailer.provenancePath`, value: game.media.trailer.provenancePath },
      { label: `games[${index}].media.gameplay.path`, value: game.media.gameplay.path },
      { label: `games[${index}].media.gameplay.provenancePath`, value: game.media.gameplay.provenancePath },
    ]),
    { label: 'labels.path', value: input.labels.path },
    { label: 'render.outputPath', value: input.render.outputPath },
    { label: 'quality.reportPath', value: input.quality.reportPath },
  ];
  for (const item of paths) {
    if (!item.value) continue;
    if (!isInsideProject(root, item.value)) {
      issues.push(`${item.label}: caminho fora da pasta de referência.`);
      continue;
    }
    try {
      if (!(await stat(resolve(root, item.value))).isFile()) issues.push(`${item.label}: o caminho não é um arquivo.`);
    } catch {
      issues.push(`${item.label}: arquivo não encontrado.`);
    }
  }
  return issues;
}

/** Loads a persisted AS-10 envelope under `root`; malformed or missing external evidence remains blocked. */
export async function loadAetheraReferenceValidation(root: string, now = new Date()): Promise<AetheraReferenceValidationReport> {
  const sourceRoot = resolve(root);
  const file = resolve(sourceRoot, AETHERA_REFERENCE_EVIDENCE_PATH);
  const inside = relative(sourceRoot, file);
  if (!inside || inside.startsWith('..') || isAbsolute(inside)) return blocked(sourceRoot, 'O caminho da evidência está fora da pasta de referência.', now);
  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return blocked(sourceRoot, `Envelope AS-10 ausente: ${AETHERA_REFERENCE_EVIDENCE_PATH}.`, now);
  }
  let input: unknown;
  try {
    input = JSON.parse(raw) as unknown;
  } catch {
    return blocked(sourceRoot, `Envelope AS-10 inválido: ${AETHERA_REFERENCE_EVIDENCE_PATH} não é JSON.`, now);
  }
  const report = validateAetheraReference(input, now);
  if (report.runId === 'unknown') return report;
  const artifacts = await missingArtifacts(sourceRoot, input as ReferenceInput);
  if (!artifacts.length) return report;
  const integrity = { id: 'artifact-integrity', status: 'blocked' as const, evidence: artifacts };
  return aetheraReferenceValidationReportSchema.parse({
    ...report,
    status: report.status === 'fail' ? 'fail' : 'blocked',
    checks: [...report.checks, integrity],
    blockers: [...new Set([...report.blockers, integrity.id])],
  });
}
