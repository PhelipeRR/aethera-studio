import { type VelixProductionRepository } from '@neuralbridge/database';
import { type ProductionStageAdapter } from './velix-production.js';

/**
 * AP-11 keeps the Quality Director as the source of truth. The quality stage does not waive or
 * recalculate a report; it makes the persisted report an explicit dependency of the preview.
 */
export function createAetheraQualityStageAdapter(deps: { production: VelixProductionRepository }): ProductionStageAdapter {
  return {
    kind: 'quality',
    async run(context) {
      const report = deps.production.listQualityReports(context.runId).at(-1);
      if (!report) throw new Error('invalid: o render ainda não possui relatório do Quality Director.');
      context.writeArtifact({
        kind: 'aethera-quality-summary',
        relativePath: `producoes/${context.runId}/qualidade/plano.json`,
        content: `${JSON.stringify({ schemaVersion: 1, reportId: report.id, blocking: report.blocking, exportable: report.exportable, checks: JSON.parse(report.checks) }, null, 2)}\n`,
        mime: 'application/json',
        metadata: { reportId: report.id, blocking: report.blocking, exportable: report.exportable },
      });
      context.progress(1);
    },
  };
}

/**
 * A preview is a durable pointer to the already-rendered, quality-checked video. It is deliberately
 * not an export and never changes publication or Rights Manager state.
 */
export function createAetheraPreviewStageAdapter(deps: { production: VelixProductionRepository }): ProductionStageAdapter {
  return {
    kind: 'preview',
    async run(context) {
      const render = deps.production.listArtifacts(context.runId).filter((artifact) => artifact.kind === 'render' && artifact.relativePath).at(-1);
      const quality = deps.production.listQualityReports(context.runId).at(-1);
      if (!render?.relativePath || !quality) throw new Error('invalid: a prévia exige render e Quality Director concluídos.');
      context.writeArtifact({
        kind: 'aethera-preview',
        relativePath: `producoes/${context.runId}/preview/preview.json`,
        content: `${JSON.stringify({ schemaVersion: 1, renderArtifactId: render.id, relativePath: render.relativePath, qualityReportId: quality.id, exportable: quality.exportable && !quality.blocking, publishable: false }, null, 2)}\n`,
        mime: 'application/json',
        metadata: { renderArtifactId: render.id, qualityReportId: quality.id, publishable: false },
      });
      context.progress(1);
    },
  };
}
