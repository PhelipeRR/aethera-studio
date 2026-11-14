import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clapperboard, PackageCheck, RefreshCw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import { VIDEO_FORMATS, type ProductionState } from '@neuralbridge/shared/velix-production';

type FormatId = keyof typeof VIDEO_FORMATS;
/** Mirrors the main process: format, file, audio, rights and claims are never waived. */
const NEVER_WAIVED = new Set(['file', 'resolution', 'aspect', 'audio', 'rights', 'claims']);
const SEVERITY: Record<string, string> = { blocking: 'Bloqueante', warning: 'Aviso', info: 'Informação' };
const GATE_LABEL: Record<'technical' | 'factual' | 'editorial' | 'publication', string> = { technical: 'G1 técnico', factual: 'G2 factual', editorial: 'G3 editorial', publication: 'G4 publicação' };

/** Renders the measured storyboard per format, shows quality control and lets an export happen only when allowed. */
export function ProductionRender({ state, onState }: { state: ProductionState; onState: (next: ProductionState) => void }) {
  const api = window.neuralbridge.video;
  const client = useQueryClient();
  const runId = state.run.id;
  const [formatId, setFormatId] = useState<FormatId>(state.brief.format.id === 'custom' ? 'youtube-long' : state.brief.format.id);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const renderStage = state.stages.filter((stage) => stage.kind === 'render').at(-1);
  const exportStage = state.stages.filter((stage) => stage.kind === 'export').at(-1);
  const key = ['velix-production-renders', runId];
  const renders = useQuery({ queryKey: key, queryFn: () => api.productionRenders(runId) });
  useEffect(() => { void client.invalidateQueries({ queryKey: key }); }, [renderStage?.status, exportStage?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next: Awaited<ReturnType<typeof api.productionRenders>>) => client.setQueryData(key, next);
  const render = useMutation({ mutationFn: () => api.productionRunRender({ runId, formatId }), onSuccess: onState });
  const recheck = useMutation({ mutationFn: (renderArtifactId: string) => api.productionRenderRecheck({ runId, renderArtifactId }), onSuccess: set });
  const approve = useMutation({ mutationFn: (input: { renderArtifactId: string; checkId: string; note: string }) => api.productionQualityApprove({ runId, ...input }), onSuccess: set });
  const approveGate = useMutation({ mutationFn: (input: { renderArtifactId: string; gate: 'editorial' | 'publication'; note: string }) => api.productionGateApprove({ runId, ...input }), onSuccess: set });
  const exportRender = useMutation({ mutationFn: (renderArtifactId: string) => api.productionRunExport({ runId, renderArtifactId }), onSuccess: onState });
  const busy = renderStage?.status === 'running' || exportStage?.status === 'running';
  const cancelled = state.run.status === 'cancelled';
  return (
    <div aria-label="Render e qualidade" className="space-y-3 rounded border p-3 text-sm">
      <p className="font-medium">Render e qualidade</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="block text-xs font-medium">Formato<select aria-label="Formato do render" className="mt-1 min-h-11 rounded border bg-background px-2 text-sm" value={formatId} onChange={(event) => setFormatId(event.target.value as FormatId)}>{Object.values(VIDEO_FORMATS).map((format) => <option key={format.id} value={format.id}>{format.label}</option>)}</select></label>
        <Button size="sm" className="min-h-11" disabled={cancelled || busy || render.isPending} onClick={() => render.mutate()}><Clapperboard aria-hidden />{renderStage?.status === 'running' ? 'Renderizando…' : 'Renderizar'}</Button>
      </div>
      {renderStage?.status === 'failed' && renderStage.error && <p role="alert" className="text-xs text-destructive">{renderStage.error.message}</p>}
      {renders.data && renders.data.renders.length > 0 && (
        <ol className="space-y-2" aria-label="Renders da produção">
          {renders.data.renders.map((item) => {
            const label = VIDEO_FORMATS[item.formatId as FormatId]?.label ?? item.formatId;
            return (
              <li key={item.artifactId} aria-label={`Render ${label} versão ${item.storyboardVersion}`} className="space-y-2 rounded border p-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-medium">{label} · {item.width}x{item.height} · {(item.durationMs / 1_000).toFixed(1)} s · storyboard v{item.storyboardVersion}</span>
                  <span role="status" className={item.exportable ? 'text-xs text-muted-foreground' : 'text-xs font-medium text-destructive'}>{item.exportable ? 'Pode ser exportado' : 'Exportação bloqueada'}</span>
                </div>
                <ul className="space-y-1 text-xs" aria-label="Verificações de qualidade">
                  {item.checks.map((check) => (
                    <li key={check.id} className="flex flex-wrap items-start gap-2">
                      {check.passed || check.approved ? <Check aria-hidden className="size-4 text-muted-foreground" /> : <X aria-hidden className="size-4 text-destructive" />}
                      <span className="min-w-0 flex-1">{check.label} <span className="text-muted-foreground">· {SEVERITY[check.severity]}{check.approved ? ' · aceito por você' : ''}{check.evidence ? ` · ${check.evidence}` : ''}</span></span>
                      {!check.passed && !check.approved && check.severity === 'blocking' && !NEVER_WAIVED.has(check.id) && (
                        <span className="flex w-full flex-wrap gap-2 sm:w-auto">
                          <input aria-label={`Motivo para aceitar: ${check.label}`} className="min-h-11 flex-1 rounded border bg-background px-2" placeholder="Por que aceitar" value={notes[`${item.artifactId}:${check.id}`] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [`${item.artifactId}:${check.id}`]: event.target.value }))} />
                          <Button size="sm" variant="outline" className="min-h-11" disabled={approve.isPending || !(notes[`${item.artifactId}:${check.id}`] ?? '').trim()} onClick={() => approve.mutate({ renderArtifactId: item.artifactId, checkId: check.id, note: notes[`${item.artifactId}:${check.id}`] ?? '' })}>Aceitar</Button>
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
                {item.gates && <div aria-label="Gates de aprovação" className="space-y-2 rounded bg-muted/30 p-2 text-xs">
                  <div className="flex flex-wrap gap-x-3 gap-y-1">{(['technical', 'factual', 'editorial', 'publication'] as const).map((gate) => <span key={gate}>{GATE_LABEL[gate]}: {item.gates?.[gate] === 'approved' ? 'aprovado' : item.gates?.[gate] === 'rejected' ? 'rejeitado' : 'pendente'}</span>)}</div>
                  {(['editorial', 'publication'] as const).filter((gate) => item.gates?.[gate] !== 'approved').map((gate) => {
                    const noteKey = `${item.artifactId}:gate:${gate}`;
                    return <div key={gate} className="flex flex-wrap gap-2"><input aria-label={`Nota para ${GATE_LABEL[gate]}`} className="min-h-11 flex-1 rounded border bg-background px-2" placeholder={`Nota para ${GATE_LABEL[gate]}`} value={notes[noteKey] ?? ''} onChange={(event) => setNotes((current) => ({ ...current, [noteKey]: event.target.value }))} /><Button size="sm" variant="outline" className="min-h-11" disabled={approveGate.isPending || !(notes[noteKey] ?? '').trim()} onClick={() => approveGate.mutate({ renderArtifactId: item.artifactId, gate, note: notes[noteKey] ?? '' })}>Aprovar {GATE_LABEL[gate]}</Button></div>;
                  })}
                </div>}
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="ghost" className="min-h-11" disabled={recheck.isPending || busy} onClick={() => recheck.mutate(item.artifactId)}><RefreshCw aria-hidden />Verificar de novo</Button>
                  <Button size="sm" className="min-h-11" disabled={!item.exportable || busy || exportRender.isPending || cancelled} onClick={() => exportRender.mutate(item.artifactId)}><PackageCheck aria-hidden />Exportar</Button>
                </div>
                {item.exported && <p className="text-xs text-muted-foreground">Exportado com legendas, créditos e manifesto de fontes e licenças em {item.exported.replace(/\/[^/]+$/u, '')}.</p>}
              </li>
            );
          })}
        </ol>
      )}
      {exportStage?.status === 'failed' && exportStage.error && <p role="alert" className="text-xs text-destructive">{exportStage.error.message}</p>}
      {(render.isError || recheck.isError || approve.isError || approveGate.isError || exportRender.isError || renders.isError) && <p role="alert" className="text-sm text-destructive">{errorMessage(render.error ?? recheck.error ?? approve.error ?? approveGate.error ?? exportRender.error ?? renders.error)}</p>}
    </div>
  );
}
