import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, CircleSlash, Scale } from 'lucide-react';
import {
  RIGHTS_LABEL,
  buildSceneDiagnosticRows,
  safeThumbnailUrl,
  summarizeSceneRows,
  type RightsStatusView,
  type SceneAssemblyView,
  type SceneDiagnosticRow,
  type SceneMediaDiagnosticView,
} from './scene-media-diagnostics-model';

interface SceneMediaDiagnosticsPanelProps {
  diagnostics?: SceneMediaDiagnosticView[] | null;
  assembly?: SceneAssemblyView[] | null;
  rightsReview?: Array<{ mediaId: string; title: string; sourceUrl: string; rightsStatus: RightsStatusView; note: string }> | null;
}

const STATUS_STYLE: Record<SceneDiagnosticRow['status'], string> = {
  covered: 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300',
  partial: 'border-amber-500/40 bg-amber-500/10 text-amber-300',
  missing: 'border-rose-500/40 bg-rose-500/10 text-rose-300',
};

/**
 * Per-scene media diagnostics: candidates, acquisitions, rejections with evidence, verified seconds, sources,
 * rights pending and the best alternative. Nothing is hidden behind a single "coverage %".
 */
export function SceneMediaDiagnosticsPanel({ diagnostics, assembly, rightsReview }: SceneMediaDiagnosticsPanelProps) {
  const [openScene, setOpenScene] = useState<string | null>(null);
  const rows = buildSceneDiagnosticRows(diagnostics ?? [], assembly ?? []);
  if (rows.length === 0) return null;
  const summary = summarizeSceneRows(rows);
  const pendingRights = (rightsReview ?? []).filter((r) => r.rightsStatus !== 'licensed');

  return (
    <section className="space-y-3 border-t border-border pt-4" aria-labelledby="scene-media-diagnostics-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 id="scene-media-diagnostics-title" className="text-sm font-medium">
          Diagnóstico de mídia por cena
        </h4>
        <p className="text-xs text-muted-foreground">
          {summary.covered} cobertas · {summary.partial} parciais · {summary.missing} sem footage · {summary.realSec}s verificados de{' '}
          {summary.neededSec}s
        </p>
      </div>

      {pendingRights.length > 0 && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200">
          <p className="flex items-center gap-1.5 font-medium">
            <Scale className="size-3.5" aria-hidden />
            {pendingRights.length} mídia(s) usadas no rascunho aguardam revisão de direitos antes da publicação
          </p>
          <ul className="mt-1.5 space-y-0.5">
            {pendingRights.slice(0, 8).map((r) => (
              <li key={r.mediaId}>
                {RIGHTS_LABEL[r.rightsStatus]} — {r.title}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ul className="space-y-2">
        {rows.map((row) => {
          const open = openScene === row.sceneId;
          return (
            <li key={row.sceneId} className="rounded-xl border border-border bg-background/40">
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpenScene(open ? null : row.sceneId)}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              >
                {open ? <ChevronDown className="size-3.5 shrink-0" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0" aria-hidden />}
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{row.subject}</span>
                <span className="tabular-nums text-muted-foreground">
                  {row.realSec}s / {row.neededSec}s
                </span>
                <span className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 ${STATUS_STYLE[row.status]}`}>
                  {row.status === 'covered' ? (
                    <CheckCircle2 className="size-3" aria-hidden />
                  ) : row.status === 'partial' ? (
                    <AlertTriangle className="size-3" aria-hidden />
                  ) : (
                    <CircleSlash className="size-3" aria-hidden />
                  )}
                  {row.statusLabel}
                </span>
              </button>

              {open && (
                <div className="space-y-3 border-t border-border px-3 py-3 text-xs text-muted-foreground">
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
                    <Stat label="Candidatos" value={row.candidatesFound} />
                    <Stat label="Adquiridas" value={row.acquired} />
                    <Stat label="Aprovadas" value={row.approvedCount} />
                    <Stat label="Rejeitadas" value={row.rejected.length} />
                    <Stat label="Composição gráfica" value={`${row.graphicRecoverySec}s`} />
                    <Stat label="Direitos pendentes" value={row.pendingRights} />
                  </dl>
                  <p>
                    <span className="text-foreground">Fontes consultadas:</span> {row.sourcesConsulted.join(', ') || 'nenhuma'}
                  </p>
                  {row.queries.length > 0 && (
                    <p>
                      <span className="text-foreground">Consultas:</span> {row.queries.slice(0, 6).join(' · ')}
                    </p>
                  )}
                  {row.pendingReason && <p className="text-amber-200">{row.pendingReason}</p>}
                  {row.bestAlternative && (
                    <p>
                      <span className="text-foreground">Melhor alternativa:</span> {row.bestAlternative}
                    </p>
                  )}

                  {row.failedDownloads.length > 0 && (
                    <div>
                      <p className="font-medium text-foreground">Falhas de aquisição</p>
                      <ul className="mt-1 space-y-0.5">
                        {row.failedDownloads.slice(0, 6).map((f, i) => (
                          <li key={`${f.url}_${i}`} className="text-rose-300">
                            [{f.reasonCode}] {f.title}: {f.detail}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {row.rejected.length > 0 && (
                    <div>
                      <p className="font-medium text-foreground">Candidatos rejeitados</p>
                      <ul className="mt-1.5 space-y-2">
                        {row.rejected.slice(0, 8).map((r) => {
                          const thumb = safeThumbnailUrl(r.thumbnailUrl);
                          return (
                            <li key={r.mediaId} className="flex gap-3 rounded-lg border border-border p-2">
                              {thumb ? (
                                <img src={thumb} alt={`Miniatura de ${r.title}`} loading="lazy" className="h-14 w-24 shrink-0 rounded object-cover" />
                              ) : (
                                <div className="flex h-14 w-24 shrink-0 items-center justify-center rounded bg-muted text-[10px]">sem miniatura</div>
                              )}
                              <div className="min-w-0 space-y-0.5">
                                <p className="truncate text-foreground" title={r.title}>
                                  {r.title}
                                </p>
                                <p>
                                  {r.origin}
                                  {r.rejectionCode ? ` · ${r.rejectionCode}` : ''}
                                </p>
                                <p className="text-rose-300">{r.reason}</p>
                                {r.evidence && r.evidence.length > 0 && (
                                  <ul className="space-y-0.5">
                                    {r.evidence.slice(0, 3).map((e) => (
                                      <li key={e.timestampSec}>
                                        <span className="tabular-nums">{e.timestampSec.toFixed(1)}s</span> — {e.description}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className="tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
