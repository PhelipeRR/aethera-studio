import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import type { ProductionDerivative } from '@neuralbridge/shared/velix-derivatives';

const STATUS: Record<ProductionDerivative['status'], string> = { candidate: 'Sugestão', approved: 'Aprovado', rejected: 'Recusado', created: 'Produção criada' };
const FORMAT: Record<string, string> = { 'youtube-short': 'YouTube Short', 'instagram-reels': 'Instagram Reel', tiktok: 'TikTok' };

export function ProductionDerivatives({ runId }: { runId: string }) {
  const client = useQueryClient();
  const api = window.neuralbridge.video;
  const query = useQuery({ queryKey: ['velix-derivatives', runId], queryFn: () => api.productionDerivatives(runId) });
  const refresh = () => void client.invalidateQueries({ queryKey: ['velix-derivatives', runId] });
  const generate = useMutation({ mutationFn: () => api.productionDerivativesGenerate({ runId, formatId: 'youtube-short' }), onSuccess: refresh });
  const decide = useMutation({ mutationFn: (input: { id: string; decision: 'approved' | 'rejected' }) => api.productionDerivativeDecide(input), onSuccess: refresh });
  const create = useMutation({ mutationFn: (id: string) => api.productionDerivativeCreate({ id }), onSuccess: refresh });
  const render = useMutation({ mutationFn: () => api.productionDerivativesRender(runId), onSuccess: refresh });
  const exportAll = useMutation({ mutationFn: () => api.productionDerivativesExport(runId), onSuccess: refresh });
  const items = query.data ?? [];
  return <section aria-labelledby="velix-derivatives-title" className="space-y-3 sg-panel rounded-lg p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 id="velix-derivatives-title" className="font-medium">Derivados para Shorts</h3><p className="text-xs text-muted-foreground">Sugestões baseadas nas cenas medidas e na identidade aprovada do canal.</p></div><div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => generate.mutate()} disabled={generate.isPending}>{generate.isPending ? 'Analisando…' : 'Gerar sugestões'}</Button><Button size="sm" variant="outline" onClick={() => render.mutate()} disabled={render.isPending || !items.some((item) => item.status === 'created')}>Renderizar aprovados</Button><Button size="sm" onClick={() => exportAll.mutate()} disabled={exportAll.isPending || !items.some((item) => item.exportable)}>Exportar prontos</Button></div></div>
    {items.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma sugestão gerada. Sincronize a narração antes de gerar derivados.</p>}
    <div className="grid gap-2">{items.map((item) => <article key={item.id} className="rounded border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="font-medium">{item.title}</span><span className="ml-2 text-xs text-muted-foreground">{FORMAT[item.formatId] ?? item.formatId} · nota {item.score.toFixed(2)} · {STATUS[item.status]}</span></div><span className="text-xs text-muted-foreground">{(item.endMs - item.startMs) / 1000}s</span></div><p className="mt-1 text-xs text-muted-foreground">{item.reason}</p><div className="mt-2 flex flex-wrap gap-2">{item.status === 'candidate' && <><Button size="sm" className="min-h-9" onClick={() => decide.mutate({ id: item.id, decision: 'approved' })}>Aprovar</Button><Button size="sm" variant="outline" className="min-h-9" onClick={() => decide.mutate({ id: item.id, decision: 'rejected' })}>Descartar</Button></>}{item.status === 'approved' && <Button size="sm" className="min-h-9" onClick={() => create.mutate(item.id)} disabled={create.isPending}>Criar produção</Button>}{item.status === 'created' && <span className="self-center text-xs text-muted-foreground">Filha: {item.childRunId?.slice(0, 8)}</span>}{item.exportable && <span className="self-center text-xs text-success">Pronto para exportar</span>}</div></article>)}</div>
    {(query.isError || generate.isError || decide.isError || create.isError || render.isError || exportAll.isError) && <p role="alert" className="text-sm text-destructive">{errorMessage(query.error ?? generate.error ?? decide.error ?? create.error ?? render.error ?? exportAll.error)}</p>}
  </section>;
}
