import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type VelixClaimRepository, type VelixDerivativeRepository, type VelixDerivativeRow, type VelixProductionRepository, type VelixStoryboardRepository } from '@neuralbridge/database';
import {
  type ProductionDerivative,
  VIDEO_FORMATS,
  derivativeScenes,
  narrationManifestSchema,
  productionBriefSchema,
  shortCandidates,
  storyboardNarration,
  textKey,
} from '@neuralbridge/shared';
import { type ProductionRunService } from './velix-production.js';
import { type RenderService } from './velix-render-stage.js';

export type DerivativeFormatId = 'youtube-short' | 'instagram-reels' | 'tiktok';

export interface DerivativeDeps {
  production: VelixProductionRepository;
  storyboards: VelixStoryboardRepository;
  claims: VelixClaimRepository;
  derivatives: VelixDerivativeRepository;
  runs: ProductionRunService;
  renders: RenderService;
  identity?(projectId: string): { name: string | null } | null;
}

const parse = (row: VelixDerivativeRow) => ({ sceneIds: JSON.parse(row.sceneIds) as string[], claimIds: JSON.parse(row.claimIds) as string[] });

/**
 * Turns a measured production into Shorts: narrative candidates, a decision per candidate, a production of its own per
 * approved one (same measured clips, claims and evidence decisions copied, origin kept), then render and export in batch.
 */
export class DerivativeService {
  constructor(private readonly deps: DerivativeDeps) {}

  generate(parentRunId: string, formatId: DerivativeFormatId = 'youtube-short'): ProductionDerivative[] {
    const latest = this.deps.storyboards.latest(parentRunId);
    if (!latest) throw new Error('invalid: gere o storyboard antes dos derivados.');
    if (latest.storyboard.timing !== 'measured' || !latest.storyboard.scenes.every((scene) => scene.audio)) throw new Error('invalid: sincronize a narração antes dos derivados: cada cena precisa do seu clipe medido.');
    if (this.deps.derivatives.byChild(parentRunId)) throw new Error('invalid: um derivado não gera derivados.');
    const unsupported = new Set(this.deps.claims.gate(parentRunId).unsupported.map((claim) => claim.id));
    const claims = this.deps.claims.list(parentRunId).map((claim) => ({ id: claim.id, kind: claim.kind, supported: !unsupported.has(claim.id) }));
    this.deps.derivatives.saveCandidates(parentRunId, latest.version, formatId, shortCandidates(latest.storyboard.scenes, claims));
    return this.view(parentRunId);
  }

  decide(id: string, decision: 'approved' | 'rejected'): string {
    const row = this.deps.derivatives.get(id);
    if (!row) throw new Error('not_found: derivado não encontrado.');
    this.deps.derivatives.decide(id, decision);
    return row.parentRunId;
  }

  /** Creates the child production of an approved derivative, exactly from the storyboard version it was cut from. */
  create(id: string): string {
    const row = this.deps.derivatives.get(id);
    if (!row) throw new Error('not_found: derivado não encontrado.');
    if (row.status !== 'approved') throw new Error('invalid: aprove o derivado antes de criar a produção.');
    const parent = this.deps.production.getRun(row.parentRunId);
    const source = this.deps.storyboards.get(row.parentRunId, row.storyboardVersion);
    if (!parent || !source) throw new Error('not_found: a origem do derivado não existe mais.');
    const { sceneIds, claimIds } = parse(row);
    const brief = productionBriefSchema.parse(JSON.parse(parent.brief));
    const format = VIDEO_FORMATS[row.formatId as DerivativeFormatId];
    if (!format) throw new Error('invalid: formato de derivado inválido.');
    const { id: formatId, width, height, fps, aspectRatio, safeArea } = format;
    const identity = this.deps.identity?.(parent.projectId) ?? null;
    const child = this.deps.runs.create(parent.projectId, { ...brief, format: { id: formatId, width, height, fps, aspectRatio, safeArea }, topic: `Short: ${row.title}`.slice(0, 200), targetDurationSeconds: Math.max(1, Math.round((row.endMs - row.startMs) / 1_000)), budgetUsd: 0 });
    const copied = this.deps.claims.copyClaims(row.parentRunId, child.id, parent.projectId, claimIds);
    const scenes = derivativeScenes(source.storyboard.scenes, { sceneIds, title: row.title }, identity?.name ?? null).map((scene) => ({ ...scene, claimIds: scene.claimIds.flatMap((claim) => { const next = copied.get(claim); return next ? [next] : []; }) }));
    this.deps.storyboards.save({ runId: child.id, storyboard: { schemaVersion: 1, timing: 'measured', narrationKey: textKey(storyboardNarration(scenes)), scenes }, source: 'generated', baseVersion: null });
    this.deps.derivatives.setChild(id, child.id);
    return child.id;
  }

  /** Schedules a render for every created derivative whose current storyboard has no render in its format yet. */
  async renderAll(parentRunId: string): Promise<number> {
    let scheduled = 0;
    for (const row of this.deps.derivatives.list(parentRunId)) {
      if (row.status !== 'created' || !row.childRunId) continue;
      const latest = this.deps.storyboards.latest(row.childRunId);
      const child = this.deps.production.getRun(row.childRunId);
      if (!latest || !child || child.status === 'cancelled') continue;
      if (this.deps.renders.view(row.childRunId).renders.some((render) => render.storyboardVersion === latest.version && render.formatId === row.formatId)) continue;
      await this.deps.runs.scheduleAdapterStage({ runId: row.childRunId, kind: 'render', taskProjectId: child.projectId, input: { formatId: row.formatId, storyboard: latest.version, derivative: row.id } });
      scheduled += 1;
    }
    return scheduled;
  }

  /** Exports every derivative whose latest render passed quality control; the others are left for review. */
  async exportAll(parentRunId: string): Promise<number> {
    let scheduled = 0;
    for (const row of this.deps.derivatives.list(parentRunId)) {
      if (row.status !== 'created' || !row.childRunId) continue;
      const child = this.deps.production.getRun(row.childRunId);
      const render = this.deps.renders.view(row.childRunId).renders[0];
      if (!child || !render || !render.exportable || render.exported) continue;
      await this.deps.runs.scheduleAdapterStage({ runId: row.childRunId, kind: 'export', taskProjectId: child.projectId, input: { renderArtifactId: render.artifactId, report: render.reportId ?? '' } });
      scheduled += 1;
    }
    return scheduled;
  }

  view(parentRunId: string): ProductionDerivative[] {
    return this.deps.derivatives.list(parentRunId).map((row) => {
      const { sceneIds, claimIds } = parse(row);
      const child = row.childRunId ? this.deps.production.getRun(row.childRunId) : undefined;
      const render = row.childRunId ? this.deps.renders.view(row.childRunId).renders[0] : undefined;
      return { id: row.id, parentRunId: row.parentRunId, childRunId: row.childRunId, storyboardVersion: row.storyboardVersion, formatId: row.formatId, sceneIds, startMs: row.startMs, endMs: row.endMs, title: row.title, score: row.score, reason: row.reason, claimIds, status: row.status as ProductionDerivative['status'], childStatus: child?.status ?? null, exportable: render?.exportable ?? false, exported: render?.exported ?? null };
    });
  }

  /** The link back to the source passage, for the child's export manifest. */
  origin(childRunId: string): Record<string, unknown> | null {
    const row = this.deps.derivatives.byChild(childRunId);
    if (!row) return null;
    const parent = this.deps.production.getRun(row.parentRunId);
    const topic = parent ? productionBriefSchema.parse(JSON.parse(parent.brief)).topic : null;
    return { derivativeId: row.id, parentRunId: row.parentRunId, parentTopic: topic, storyboardVersion: row.storyboardVersion, startMs: row.startMs, endMs: row.endMs, sceneIds: parse(row).sceneIds, reason: row.reason };
  }

  /** The parent's narration manifest: the base a derivative's clips are re-joined from. */
  inheritedNarration(childRunId: string) {
    const row = this.deps.derivatives.byChild(childRunId);
    const parent = row ? this.deps.production.getRun(row.parentRunId) : undefined;
    const root = parent ? this.deps.production.projectRoot(parent.projectId) : undefined;
    const artifact = row ? this.deps.production.listArtifacts(row.parentRunId).filter((item) => item.kind === 'narration-manifest' && item.relativePath).at(-1) : undefined;
    if (!root || !artifact?.relativePath) return null;
    const file = join(root, artifact.relativePath);
    if (!existsSync(file)) return null;
    const parsed = narrationManifestSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
    return parsed.success ? parsed.data : null;
  }
}
