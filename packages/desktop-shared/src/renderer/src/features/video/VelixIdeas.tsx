import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { VideoIdeaView } from '@neuralbridge/shared/channels';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';

const INPUT = 'mt-1.5 w-full rounded-md border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring';
const CLAIM_LABELS = { fact: 'Fato', hypothesis: 'Hipótese', opinion: 'Opinião' } as const;
const STATUS_LABELS: Record<string, string> = { draft: 'rascunho', saved: 'salva', converted: 'convertida em vídeo' };

function IdeaCard({ idea, projectId, agent, onChanged }: { idea: VideoIdeaView; projectId: string; agent: 'claude' | 'codex'; onChanged: () => void }) {
  const [name, setName] = useState(''); const [notice, setNotice] = useState<string | null>(null);
  const save = useMutation({ mutationFn: () => window.neuralbridge.video.ideaSave({ projectId, id: idea.id }), onSuccess: onChanged });
  const investigate = useMutation({ mutationFn: () => window.neuralbridge.video.ideaInvestigate({ projectId, id: idea.id, agent }), onSuccess: (result) => { setNotice(`${result.agent === 'codex' ? 'Codex' : 'Claude'} encontrou ${result.added} fonte(s) nova(s) para revisar${result.rejected ? ` e ${result.rejected} fora do contrato` : ''}. Execução ${result.executionId ?? 'não informada'}.`); onChanged(); } });
  const decide = useMutation({ mutationFn: (input: { id: string; decision: 'approved' | 'rejected' }) => window.neuralbridge.video.ideaReference({ projectId, ...input }), onSuccess: onChanged });
  const convert = useMutation({ mutationFn: () => window.neuralbridge.video.ideaConvert({ projectId, id: idea.id, name: name.trim() }), onSuccess: (result) => { setNotice(`Vídeo criado em ${result.folder}, com ${result.references} referência(s) e o brief salvo.`); onChanged(); } });
  const error = save.error ?? investigate.error ?? decide.error ?? convert.error;
  return (
    <article aria-label={`Ideia: ${idea.title}`} className="space-y-3 sg-panel rounded-lg p-5">
      <div><h3 className="font-medium">{idea.title}</h3><p className="mt-1 text-xs text-muted-foreground">{STATUS_LABELS[idea.status] ?? idea.status} · {idea.durationSeconds} s · {idea.audience}</p></div>
      <p className="text-sm font-medium">{idea.hook}</p>
      <p className="text-sm text-muted-foreground">{idea.synopsis}</p>
      <details className="text-sm"><summary className="cursor-pointer font-medium">Roteiro preliminar e plano de mídia</summary><p className="mt-2 whitespace-pre-wrap">{idea.draftScript}</p><p className="mt-2 whitespace-pre-wrap text-muted-foreground">{idea.mediaPlan}</p></details>
      {idea.claims.length > 0 && <ul aria-label="Afirmações" className="space-y-1 text-sm">{idea.claims.map((claim, index) => <li key={index}><span className="font-medium">{CLAIM_LABELS[claim.type]}:</span> {claim.text}{claim.referenceUrl && <> · <a className="underline" href={claim.referenceUrl} target="_blank" rel="noreferrer">fonte</a></>}</li>)}</ul>}
      {idea.referenceUrls.length > 0 ? <ul aria-label="Referências da ideia" className="space-y-1 text-xs">{idea.referenceUrls.map((url) => <li key={url} className="truncate"><a className="underline" href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul> : <p className="text-xs text-muted-foreground">Sem referências verificáveis.</p>}
      <p className="text-xs text-muted-foreground">Sugestão editorial, não tendência medida · {idea.evidence.references} referência(s) citada(s), {idea.evidence.recent} publicada(s) em 7 dias · pesquisa em {idea.evidence.researchedAt ?? 'data não registrada'} · {idea.generation.agent ?? 'agente não registrado'}{idea.generation.model ? ` · ${idea.generation.model}` : ''}</p>
      {idea.pendingReferences.length > 0 && <ul aria-label="Fontes aguardando revisão" className="space-y-2 rounded border p-3 text-xs"><li className="font-medium">Fontes aguardando revisão: só entram na ideia depois de aprovadas.</li>{idea.pendingReferences.map((reference) => <li key={reference.id} className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0"><a className="block truncate underline" href={reference.url} target="_blank" rel="noreferrer">{reference.title}</a><span className="text-muted-foreground">origem: {reference.agent ?? 'agente não registrado'} · execução {reference.executionId ?? 'não informada'}</span></span><span className="flex gap-1"><Button size="sm" variant="outline" aria-label={`Aprovar fonte ${reference.title}`} disabled={decide.isPending} onClick={() => decide.mutate({ id: reference.id, decision: 'approved' })}>Aprovar</Button><Button size="sm" variant="ghost" aria-label={`Rejeitar fonte ${reference.title}`} disabled={decide.isPending} onClick={() => decide.mutate({ id: reference.id, decision: 'rejected' })}>Rejeitar</Button></span></li>)}</ul>}
      <div className="flex flex-wrap items-end gap-2">
        {idea.status === 'draft' && <Button size="sm" variant="outline" onClick={() => save.mutate()} disabled={save.isPending}>Salvar</Button>}
        {idea.status !== 'converted' && <Button size="sm" variant="outline" onClick={() => investigate.mutate()} disabled={investigate.isPending}>{investigate.isPending ? 'Investigando…' : 'Investigar'}</Button>}
        {idea.status !== 'converted' && <><label className="min-w-48 flex-1 text-xs font-medium">Nome do vídeo<input aria-label={`Nome do vídeo para ${idea.title}`} className={INPUT} value={name} onChange={(event) => setName(event.target.value)} /></label><Button size="sm" onClick={() => convert.mutate()} disabled={convert.isPending || !name.trim()}>Criar projeto Video</Button></>}
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{errorMessage(error)}</p>}
      {notice && <p role="status" className="text-sm text-muted-foreground">{notice}</p>}
    </article>
  );
}

function RadarPanel({ projectId }: { projectId: string }) {
  const [days, setDays] = useState(7);
  const radar = useQuery({ queryKey: ['velix-radar', projectId, days], queryFn: () => window.neuralbridge.video.radar({ projectId, days }) });
  const data = radar.data;
  return (
    <section aria-label="Radar de fontes" className="space-y-2 sg-panel rounded-lg p-4">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium">Radar de fontes</h3><label className="text-xs font-medium">Janela <select aria-label="Janela do radar" className="rounded border bg-background px-2 py-1" value={days} onChange={(event) => setDays(Number(event.target.value))}>{[7, 30, 90].map((value) => <option key={value} value={value}>{value} dias</option>)}</select></label></div>
      <p className="text-xs text-muted-foreground">Mede apenas o que as fontes deste projeto publicaram, não uma tendência da plataforma.</p>
      {data && <p className="text-sm">{data.inWindow} publicação(ões) na janela · {data.previousWindow} na janela anterior · {data.undated} sem data de {data.total} no total</p>}
      {data && data.publishers.length > 0 && <ul aria-label="Fontes mais ativas" className="flex flex-wrap gap-2 text-xs">{data.publishers.map((item) => <li key={item.publisher} className="rounded border px-2 py-1">{item.publisher}: {item.count}</li>)}</ul>}
    </section>
  );
}

export function VelixIdeas({ projectId }: { projectId: string | null }) {
  const client = useQueryClient();
  const [niche, setNiche] = useState(''); const [agent, setAgent] = useState<'claude' | 'codex'>('claude');
  const list = useQuery({ queryKey: ['velix-ideas', projectId], queryFn: () => window.neuralbridge.video.ideaList(projectId ?? ''), enabled: !!projectId });
  const refresh = () => { void client.invalidateQueries({ queryKey: ['velix-ideas', projectId] }); void client.invalidateQueries({ queryKey: ['velix-discovery', projectId] }); void client.invalidateQueries({ queryKey: ['velix-production-list', projectId] }); void client.invalidateQueries({ queryKey: ['velix-radar', projectId] }); };
  const generate = useMutation({ mutationFn: (mode: 'generate' | 'more' | 'surprise') => window.neuralbridge.video.ideaGenerate({ projectId: projectId ?? '', niche: niche.trim(), mode, agent }), onSuccess: refresh });
  if (!projectId) return <section aria-label="Ideias Aethera" className="sg-panel rounded-lg p-5 text-sm text-muted-foreground">Escolha o projeto Video para gerar ideias.</section>;
  const ideas = list.data ?? [];
  return (
    <section aria-label="Ideias Aethera" className="space-y-5">
      <RadarPanel projectId={projectId} />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
        <label className="text-sm font-medium">Pauta das ideias<input aria-label="Pauta das ideias" className={INPUT} value={niche} onChange={(event) => setNiche(event.target.value)} placeholder="ex.: ciência do cotidiano" /></label>
        <label className="text-sm font-medium">Agente<select aria-label="Agente das ideias" className={INPUT} value={agent} onChange={(event) => setAgent(event.target.value as 'claude' | 'codex')}><option value="claude">Claude</option><option value="codex">Codex</option></select></label>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => generate.mutate('generate')} disabled={generate.isPending || !niche.trim()}>{generate.isPending ? 'Gerando…' : 'Gerar ideias'}</Button>
        <Button variant="outline" onClick={() => generate.mutate('more')} disabled={generate.isPending || !niche.trim() || ideas.length === 0}>Gerar mais</Button>
        <Button variant="outline" onClick={() => generate.mutate('surprise')} disabled={generate.isPending}>Surpreenda-me</Button>
        {generate.isPending && <Button variant="ghost" onClick={() => void window.neuralbridge.video.ideaCancel(projectId)}>Cancelar</Button>}
      </div>
      <p className="text-xs text-muted-foreground">As ideias usam as referências persistidas neste projeto como dados. Sem métrica real, o resultado é rotulado como sugestão editorial.</p>
      {generate.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(generate.error)}</p>}
      {list.isSuccess && ideas.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma ideia neste projeto.</p>}
      <div className="grid gap-4 lg:grid-cols-2">{ideas.map((idea) => <IdeaCard key={idea.id} idea={idea} projectId={projectId} agent={agent} onChanged={refresh} />)}</div>
    </section>
  );
}
