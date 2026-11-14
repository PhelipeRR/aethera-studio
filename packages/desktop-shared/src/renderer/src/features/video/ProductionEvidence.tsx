import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { SearchCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import { CLAIM_KIND_LABELS, claimKinds, type ClaimKind, type ProductionClaim, type ProductionClaims } from '@neuralbridge/shared/velix-evidence';
import type { ProductionState } from '@neuralbridge/shared/velix-production';

const CLASSIFICATION_LABEL: Record<ProductionClaim['evidence'][number]['classification'], string> = { evidence: 'Referência aprovada', discovery: 'Encontrada, não autorizada', media_candidate: 'Mídia candidata', unusable: 'Inutilizável' };
const STATUS_LABEL: Record<ProductionClaim['evidence'][number]['status'], string> = { candidate: 'Aguardando revisão', approved: 'Aprovada', rejected: 'Rejeitada' };

/** Claims of the run with their evidence: found is shown apart from authorized, and only a person approves evidence. */
export function ProductionEvidence({ state, onState }: { state: ProductionState; onState: (next: ProductionState) => void }) {
  const api = window.neuralbridge.video;
  const client = useQueryClient();
  const runId = state.run.id;
  const research = state.stages.filter((stage) => stage.kind === 'research').at(-1);
  const key = ['velix-production-claims', runId];
  const claims = useQuery({ queryKey: key, queryFn: () => api.productionRunClaims(runId) });
  useEffect(() => { void client.invalidateQueries({ queryKey: key }); }, [research?.status, research?.progress]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next: ProductionClaims) => client.setQueryData(key, next);
  const start = useMutation({ mutationFn: () => api.productionRunResearch({ runId }), onSuccess: onState });
  const decide = useMutation({ mutationFn: (input: { evidenceId: string; decision: 'approved' | 'rejected' }) => api.productionEvidenceDecide(input), onSuccess: set });
  const relabel = useMutation({ mutationFn: (input: { claimId: string; kind: ClaimKind }) => api.productionClaimKind(input), onSuccess: set });
  const data = claims.data;
  const finished = state.run.status === 'cancelled' || state.run.status === 'completed';
  return (
    <div aria-label="Evidências do roteiro" className="space-y-3 rounded border p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">Evidências</p>
        {(!research || research.status === 'cancelled') && <Button size="sm" className="min-h-11" disabled={finished || start.isPending} onClick={() => start.mutate()}><SearchCheck aria-hidden />{start.isPending ? 'Agendando…' : 'Verificar evidências'}</Button>}
      </div>
      {start.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(start.error)}</p>}
      {data && data.claims.length > 0 && (
        <p role="status" aria-label="Situação das evidências" className={data.gate.passed ? 'text-xs text-muted-foreground' : 'text-xs font-medium text-destructive'}>
          {data.gate.passed ? `Todas as ${data.gate.facts} afirmação(ões) factual(is) têm evidência aprovada.` : `${data.gate.unsupported.length} de ${data.gate.facts} afirmação(ões) factual(is) sem evidência aprovada: a exportação fica bloqueada.`}
          {data.gate.labelled > 0 ? ` ${data.gate.labelled} marcada(s) como opinião, estimativa ou previsão.` : ''}
        </p>
      )}
      {data && data.candidates > 0 && <p className="text-xs text-muted-foreground">{data.candidates} fonte(s) ou mídia(s) encontrada(s) aguardam revisão na Descoberta. Até lá são só candidatas e não entram no vídeo.</p>}
      {data?.claims.length === 0 && research?.status === 'completed' && <p className="text-xs text-muted-foreground">Nenhuma afirmação verificável encontrada no roteiro.</p>}
      {data && data.claims.length > 0 && (
        <ol className="space-y-2" aria-label="Afirmações do roteiro">
          {data.claims.map((claim) => (
            <li key={claim.id} className="space-y-2 rounded border p-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className="min-w-0 flex-1">{claim.chapter ? <span className="text-xs text-muted-foreground">Cap. {claim.chapter} · </span> : null}{claim.text}</p>
                <select aria-label={`Tipo da afirmação: ${claim.text}`} className="min-h-11 rounded border bg-background px-2 text-xs" value={claim.kind} disabled={relabel.isPending} onChange={(event) => relabel.mutate({ claimId: claim.id, kind: event.target.value as ClaimKind })}>{claimKinds.map((kind) => <option key={kind} value={kind}>{CLAIM_KIND_LABELS[kind]}</option>)}</select>
              </div>
              {claim.kind === 'fact' && claim.evidence.length === 0 && <p className="text-xs text-destructive">Sem fonte: aprove uma referência na Descoberta ou marque como opinião, estimativa ou previsão.</p>}
              {claim.evidence.length > 0 && (
                <ul className="space-y-1">
                  {claim.evidence.map((item) => (
                    <li key={item.id} className="rounded bg-muted/30 p-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2">
                        <a href={item.url} target="_blank" rel="noreferrer" className="underline">{item.publisher}: {item.title}</a>
                        <span className="rounded-full border px-2 py-0.5">{CLASSIFICATION_LABEL[item.classification]}</span>
                        <span className="text-muted-foreground">{STATUS_LABEL[item.status]}</span>
                      </div>
                      {item.excerpt && <p className="mt-1 text-muted-foreground">“{item.excerpt}” <span className="italic">(trecho informado pelo agente; confira na fonte)</span></p>}
                      {item.classification === 'evidence' && item.status === 'candidate' && (
                        <div className="mt-1 flex gap-2">
                          <Button size="sm" variant="outline" className="min-h-11" disabled={decide.isPending} onClick={() => decide.mutate({ evidenceId: item.id, decision: 'approved' })}>Aprovar evidência</Button>
                          <Button size="sm" variant="ghost" className="min-h-11" disabled={decide.isPending} onClick={() => decide.mutate({ evidenceId: item.id, decision: 'rejected' })}>Rejeitar</Button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      {(decide.isError || relabel.isError || claims.isError) && <p role="alert" className="text-sm text-destructive">{errorMessage(decide.error ?? relabel.error ?? claims.error)}</p>}
    </div>
  );
}
