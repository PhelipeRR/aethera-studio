import { useState } from 'react';
import { Compass } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';

const COMPOSITION_LABELS: Record<string, string> = {
  single_shot: 'tomada', continue_previous: 'continua a imagem', multi_panel: 'painéis', picture_in_picture: 'imagem na imagem',
  typographic_card: 'cartão tipográfico', kinetic_type: 'tipografia cinética', diagram: 'diagrama', data_chart: 'gráfico', map_timeline: 'mapa/linha do tempo',
};

/**
 * Smart Director in the editor: the AI director proposes a versioned plan for the measured script; a person reads it and
 * approves that exact version; only then can it be executed on the timeline (a new timeline version, reversible by undo).
 */
export function AetheraEditorialPlanPanel({ runId, timelineVersion }: { runId: string; timelineVersion: number | null }) {
  const api = window.neuralbridge.video;
  const client = useQueryClient();
  const [approver, setApprover] = useState('');
  const plan = useQuery({ queryKey: ['aethera-editorial-plan', runId], queryFn: () => api.aetheraEditorialPlanGet(runId) });
  const refresh = (next: unknown) => client.setQueryData(['aethera-editorial-plan', runId], next);
  const direct = useMutation({ mutationFn: () => api.aetheraEditorialPlanDirect({ runId }), onSuccess: refresh });
  const approve = useMutation({ mutationFn: () => { const current = plan.data?.plan; if (!current) throw new Error('Nenhum plano para aprovar.'); return api.aetheraEditorialPlanApprove({ runId, version: current.version, hash: current.hash, approvedBy: approver.trim() }); }, onSuccess: refresh });
  const apply = useMutation({ mutationFn: () => api.aetheraEditorialPlanApply({ runId, baseVersion: timelineVersion ?? 0 }), onSuccess: () => client.invalidateQueries({ queryKey: ['aethera-timeline', runId] }) });
  const current = plan.data?.plan;
  const error = direct.error ?? approve.error ?? apply.error ?? plan.error;
  return (
    <section className="aethera-editor__assistant sg-panel" aria-label="Plano editorial">
      <div className="aethera-editor__panel-title"><div><p className="aethera-workspace__eyebrow">Smart Director</p><h3>Plano editorial</h3></div><Compass aria-hidden="true" className="size-5 text-[var(--aethera-signal)]" /></div>
      <p className="aethera-editor__scene-copy">O diretor decide a composição de cada trecho pela intenção da narração. O plano só é executado na timeline depois de aprovado por uma pessoa.</p>
      <Button size="sm" variant="outline" onClick={() => direct.mutate()} disabled={direct.isPending}>{direct.isPending ? 'Dirigindo…' : current ? 'Gerar nova versão' : 'Gerar plano'}</Button>
      {current && (
        <div className="mt-3 space-y-2" role="status">
          <p className="aethera-editor__scene-copy">v{current.version} · {current.status === 'approved' ? `aprovado por ${plan.data?.approval?.approvedBy ?? '—'}` : 'rascunho'} · {current.segments.length} trecho(s) · {current.director.model}</p>
          <p className="text-sm">{current.concept.summary}</p>
          <ol className="space-y-1 text-sm">{current.segments.map((segment) => <li key={segment.segmentId}><span className="font-semibold">{COMPOSITION_LABELS[segment.composition.kind] ?? segment.composition.kind}</span> — {segment.communicates}</li>)}</ol>
          {(plan.data?.issues.length ?? 0) > 0 && <ul className="space-y-1 text-sm">{plan.data?.issues.map((issue, index) => <li key={index}>{issue.severity === 'error' ? 'Erro' : 'Aviso'}: {issue.message}</li>)}</ul>}
          {current.status === 'draft' && <div className="aethera-editor__assistant-form"><input aria-label="Quem aprova o plano" value={approver} onChange={(event) => setApprover(event.target.value)} placeholder="Seu nome" /><Button size="sm" onClick={() => approve.mutate()} disabled={!approver.trim() || approve.isPending}>Aprovar v{current.version}</Button></div>}
          {current.status === 'approved' && <Button size="sm" onClick={() => apply.mutate()} disabled={apply.isPending || !timelineVersion}>{apply.isPending ? 'Aplicando…' : 'Aplicar na timeline'}</Button>}
          {apply.data && <p className="aethera-editor__scene-copy">Timeline v{apply.data.timeline.version} · {apply.data.fallbacks.length} composição(ões) em fallback · {apply.data.gaps.length} lacuna(s).</p>}
        </div>
      )}
      {error && <p role="alert" className="aethera-workspace__error">{errorMessage(error)}</p>}
    </section>
  );
}
