/**
 * View model for the per-scene media diagnostics: what was searched, found, acquired, rejected (and why), approved,
 * how many seconds are covered by verified footage, what rights are pending and the best next alternative.
 * Pure data shaping so the panel stays dumb and the rules are testable.
 */

export type RightsStatusView = 'licensed' | 'official_promotional' | 'unresolved_third_party';

export interface SceneMediaDiagnosticView {
  segmentId: string;
  subject: string;
  queries: string[];
  sourcesConsulted: string[];
  candidatesFound: number;
  acquired: number;
  approved: Array<{ mediaId: string; title: string; origin: string; sourceUrl: string; rightsStatus: RightsStatusView }>;
  rejected: Array<{
    mediaId: string;
    title: string;
    origin: string;
    url?: string;
    thumbnailUrl?: string;
    localPath?: string;
    rejectionCode?: string;
    reason: string;
    evidence?: Array<{ timestampSec: number; description: string }>;
  }>;
  failedDownloads: Array<{ title: string; url: string; reasonCode: string; detail: string }>;
  coveredSec: number;
  expectedSec: number;
  bestAlternative?: { kind: 'unused_verified_media' | 'pending_rights_media' | 'graphic_recovery' | 'manual_import'; detail: string };
  pendingRights: number;
}

export interface SceneAssemblyView {
  sceneId: string;
  timelineSec: number;
  realFootageSec: number;
  graphicRecoverySec: number;
  status: 'real_footage' | 'partial' | 'graphic_recovery';
  pendingReason?: string;
}

export type SceneDiagnosticStatus = 'covered' | 'partial' | 'missing';

export interface SceneDiagnosticRow {
  sceneId: string;
  subject: string;
  status: SceneDiagnosticStatus;
  statusLabel: string;
  /** Verified footage seconds (assembly when available, else acquisition coverage). */
  realSec: number;
  /** Seconds the scene needs (timeline slot when assembled, else narration estimate). */
  neededSec: number;
  graphicRecoverySec: number;
  candidatesFound: number;
  acquired: number;
  approvedCount: number;
  rejected: SceneMediaDiagnosticView['rejected'];
  failedDownloads: SceneMediaDiagnosticView['failedDownloads'];
  sourcesConsulted: string[];
  queries: string[];
  pendingRights: number;
  bestAlternative?: string;
  pendingReason?: string;
}

const ALTERNATIVE_LABEL: Record<NonNullable<SceneMediaDiagnosticView['bestAlternative']>['kind'], string> = {
  unused_verified_media: 'Mídia verificada ainda não usada',
  pending_rights_media: 'Mídia verificada aguardando revisão de direitos',
  graphic_recovery: 'Composição gráfica rotulada',
  manual_import: 'Importar mídia manualmente',
};

export const RIGHTS_LABEL: Record<RightsStatusView, string> = {
  licensed: 'Licenciada',
  official_promotional: 'Promocional oficial',
  unresolved_third_party: 'Direitos não resolvidos',
};

export function buildSceneDiagnosticRows(
  diagnostics: readonly SceneMediaDiagnosticView[] | undefined,
  assembly?: readonly SceneAssemblyView[],
): SceneDiagnosticRow[] {
  const assemblyByScene = new Map<string, { timelineSec: number; realSec: number; recoverySec: number; reasons: string[] }>();
  for (const a of assembly ?? []) {
    const cur = assemblyByScene.get(a.sceneId) ?? { timelineSec: 0, realSec: 0, recoverySec: 0, reasons: [] };
    cur.timelineSec += a.timelineSec;
    cur.realSec += a.realFootageSec;
    cur.recoverySec += a.graphicRecoverySec;
    if (a.pendingReason) cur.reasons.push(a.pendingReason);
    assemblyByScene.set(a.sceneId, cur);
  }
  return (diagnostics ?? []).map((d) => {
    const asm = assemblyByScene.get(d.segmentId);
    const realSec = asm ? asm.realSec : d.coveredSec;
    const neededSec = asm ? asm.timelineSec : d.expectedSec;
    const ratio = neededSec > 0 ? realSec / neededSec : 0;
    const status: SceneDiagnosticStatus = realSec <= 0.05 ? 'missing' : ratio >= 0.97 ? 'covered' : 'partial';
    return {
      sceneId: d.segmentId,
      subject: d.subject,
      status,
      statusLabel: status === 'covered' ? 'Coberta' : status === 'partial' ? 'Parcial' : 'Sem footage verificada',
      realSec: round1(realSec),
      neededSec: round1(neededSec),
      graphicRecoverySec: round1(asm?.recoverySec ?? 0),
      candidatesFound: d.candidatesFound,
      acquired: d.acquired,
      approvedCount: d.approved.length,
      rejected: d.rejected,
      failedDownloads: d.failedDownloads,
      sourcesConsulted: d.sourcesConsulted,
      queries: d.queries,
      pendingRights: d.pendingRights,
      ...(status !== 'covered' && d.bestAlternative
        ? { bestAlternative: `${ALTERNATIVE_LABEL[d.bestAlternative.kind]}: ${d.bestAlternative.detail}` }
        : {}),
      ...(asm?.reasons.length ? { pendingReason: asm.reasons[0] } : {}),
    };
  });
}

export function summarizeSceneRows(rows: readonly SceneDiagnosticRow[]): {
  covered: number;
  partial: number;
  missing: number;
  realSec: number;
  neededSec: number;
  pendingRights: number;
} {
  return rows.reduce(
    (acc, r) => ({
      covered: acc.covered + (r.status === 'covered' ? 1 : 0),
      partial: acc.partial + (r.status === 'partial' ? 1 : 0),
      missing: acc.missing + (r.status === 'missing' ? 1 : 0),
      realSec: round1(acc.realSec + r.realSec),
      neededSec: round1(acc.neededSec + r.neededSec),
      pendingRights: acc.pendingRights + r.pendingRights,
    }),
    { covered: 0, partial: 0, missing: 0, realSec: 0, neededSec: 0, pendingRights: 0 },
  );
}

/** Only http(s) thumbnails are rendered; anything else (file://, javascript:) is ignored. */
export function safeThumbnailUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
