import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gamepad2, KeyRound, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';
import type { VerifiedSubject } from '@neuralbridge/shared/aethera-studio';
import type { ProductionState } from '@neuralbridge/shared/velix-production';

const VERIFICATION: Record<VerifiedSubject['verification'], { label: string; tone: string }> = {
  confirmed: { label: 'Confirmado', tone: 'border-emerald-500/40 text-emerald-300' },
  unconfirmed: { label: 'Não confirmado', tone: 'border-amber-500/40 text-amber-200' },
  conflicting: { label: 'Fontes em conflito', tone: 'border-destructive/60 text-destructive' },
};
const PRECISION: Record<VerifiedSubject['datePrecision'], string> = { day: '', month: ' (mês)', quarter: ' (trimestre)', year: ' (ano)' };
const inputClass = 'min-h-11 w-full rounded border bg-background px-3 text-sm';

/** IGDB and RAWG credentials: stored encrypted in the main process; the renderer only learns whether they exist. */
function GameSourceCredentials() {
  const api = window.neuralbridge.video;
  const client = useQueryClient();
  const igdb = useQuery({ queryKey: ['aethera-igdb-status'], queryFn: () => api.studioIgdbStatus() });
  const rawg = useQuery({ queryKey: ['aethera-rawg-status'], queryFn: () => api.studioRawgStatus() });
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [rawgKey, setRawgKey] = useState('');
  const refresh = () => { void client.invalidateQueries({ queryKey: ['aethera-igdb-status'] }); void client.invalidateQueries({ queryKey: ['aethera-rawg-status'] }); };
  const saveIgdb = useMutation({ mutationFn: () => api.studioIgdbSave({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }), onSuccess: () => { setClientId(''); setClientSecret(''); refresh(); } });
  const clearIgdb = useMutation({ mutationFn: () => api.studioIgdbClear(), onSuccess: refresh });
  const saveRawg = useMutation({ mutationFn: () => api.studioRawgSave(rawgKey.trim()), onSuccess: () => { setRawgKey(''); refresh(); } });
  const clearRawg = useMutation({ mutationFn: () => api.studioRawgClear(), onSuccess: refresh });
  const error = saveIgdb.error ?? clearIgdb.error ?? saveRawg.error ?? clearRawg.error;
  return (
    <details className="rounded border p-3" open={igdb.data ? !igdb.data.configured : false}>
      <summary className="cursor-pointer text-sm font-medium"><KeyRound aria-hidden className="mr-1 inline size-4" />Fontes de dados dos jogos</summary>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); saveIgdb.mutate(); }}>
          <p className="text-xs text-muted-foreground">IGDB (obrigatório): crie um app em dev.twitch.tv e informe o Client ID e o Client Secret. Ficam cifrados neste computador.</p>
          <p role="status" className="text-xs">{igdb.data?.configured ? `Configurado (${igdb.data.clientIdHint ?? ''})` : 'Não configurado'}</p>
          <label className="block text-xs">Client ID<input className={inputClass} autoComplete="off" value={clientId} onChange={(event) => setClientId(event.target.value)} /></label>
          <label className="block text-xs">Client Secret<input className={inputClass} type="password" autoComplete="off" value={clientSecret} onChange={(event) => setClientSecret(event.target.value)} /></label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" className="min-h-11" disabled={!clientId.trim() || !clientSecret.trim() || saveIgdb.isPending}>Salvar IGDB</Button>
            {igdb.data?.configured && <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={clearIgdb.isPending} onClick={() => clearIgdb.mutate()}><Trash2 aria-hidden />Remover</Button>}
          </div>
        </form>
        <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); saveRawg.mutate(); }}>
          <p className="text-xs text-muted-foreground">RAWG (opcional): segunda fonte para confirmar datas.</p>
          <p role="status" className="text-xs">{rawg.data?.configured ? 'Configurado' : 'Não configurado'}</p>
          <label className="block text-xs">Chave da API RAWG<input className={inputClass} type="password" autoComplete="off" value={rawgKey} onChange={(event) => setRawgKey(event.target.value)} /></label>
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" className="min-h-11" disabled={!rawgKey.trim() || saveRawg.isPending}>Salvar RAWG</Button>
            {rawg.data?.configured && <Button type="button" size="sm" variant="outline" className="min-h-11" disabled={clearRawg.isPending} onClick={() => clearRawg.mutate()}><Trash2 aria-hidden />Remover</Button>}
          </div>
        </form>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-destructive">{errorMessage(error)}</p>}
    </details>
  );
}

/** AS-03: research games by title or release period; every game shows how well its data is confirmed. */
export function ProductionGameResearch({ state, onState }: { state: ProductionState; onState: (next: ProductionState) => void }) {
  const api = window.neuralbridge.video;
  const client = useQueryClient();
  const runId = state.run.id;
  const stage = state.stages.filter((item) => item.kind === 'game_research').at(-1);
  const key = ['aethera-subjects', runId];
  const subjects = useQuery({ queryKey: key, queryFn: () => api.productionRunSubjects(runId) });
  useEffect(() => { void client.invalidateQueries({ queryKey: key }); }, [stage?.status, stage?.progress]); // eslint-disable-line react-hooks/exhaustive-deps
  const [mode, setMode] = useState<'titles' | 'period'>('titles');
  const [titles, setTitles] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [count, setCount] = useState(10);
  const [web, setWeb] = useState(true);
  const list = titles.split('\n').map((title) => title.trim()).filter(Boolean);
  const start = useMutation({
    mutationFn: () => api.productionRunGameResearch(mode === 'titles' ? { runId, titles: list, web } : { runId, period: { from, to }, count, web }),
    onSuccess: onState,
  });
  const finished = state.run.status === 'cancelled' || state.run.status === 'completed';
  const busy = stage?.status === 'running' || stage?.status === 'pending';
  const ready = mode === 'titles' ? list.length > 0 : Boolean(from && to && from < to);
  return (
    <div aria-label="Pesquisa de jogos" className="space-y-3 rounded border p-3 text-sm">
      <p className="font-medium"><Gamepad2 aria-hidden className="mr-1 inline size-4" />Pesquisa de jogos</p>
      <GameSourceCredentials />
      <form className="space-y-2" onSubmit={(event) => { event.preventDefault(); start.mutate(); }}>
        <fieldset className="flex flex-wrap gap-4 text-xs">
          <legend className="sr-only">Como escolher os jogos</legend>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="game-mode" checked={mode === 'titles'} onChange={() => setMode('titles')} />Por títulos</label>
          <label className="flex min-h-11 items-center gap-2"><input type="radio" name="game-mode" checked={mode === 'period'} onChange={() => setMode('period')} />Por período de lançamento</label>
        </fieldset>
        {mode === 'titles' ? (
          <label className="block text-xs">Títulos (um por linha)<textarea className="min-h-24 w-full rounded border bg-background p-2 text-sm" value={titles} onChange={(event) => setTitles(event.target.value)} /></label>
        ) : (
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="block text-xs">De<input className={inputClass} type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label className="block text-xs">Até (exclusivo)<input className={inputClass} type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
            <label className="block text-xs">Quantidade<input className={inputClass} type="number" min={1} max={50} value={count} onChange={(event) => setCount(Math.max(1, Math.min(50, Number(event.target.value) || 1)))} /></label>
          </div>
        )}
        <label className="flex min-h-11 items-center gap-2 text-xs"><input type="checkbox" checked={web} onChange={(event) => setWeb(event.target.checked)} />Confirmar em páginas oficiais (o agente sugere, o app abre e confere cada página)</label>
        <Button type="submit" size="sm" className="min-h-11" disabled={finished || busy || !ready || start.isPending}>{busy ? 'Pesquisando…' : 'Pesquisar jogos'}</Button>
      </form>
      {start.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(start.error)}</p>}
      {stage?.status === 'failed' && stage.error && <p role="alert" className="text-sm text-destructive">{stage.error.message}</p>}
      {subjects.data && subjects.data.length > 0 && (
        <ul aria-label="Jogos pesquisados" className="space-y-2">
          {subjects.data.map((subject) => (
            <li key={subject.id} className="rounded border p-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{subject.title}</span>
                <span className={`rounded border px-2 py-0.5 text-xs ${VERIFICATION[subject.verification].tone}`}>{VERIFICATION[subject.verification].label}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Lançamento: {subject.releaseDate ? `${subject.releaseDate}${PRECISION[subject.datePrecision]}` : 'sem data confirmada'}
                {subject.platforms.length ? ` · ${subject.platforms.join(', ')}` : ''}
                {subject.externalIds.igdb ? ` · IGDB ${subject.externalIds.igdb}` : ' · não encontrado no IGDB'}
                {` · consultado em ${new Date(subject.checkedAt).toLocaleString('pt-BR')}`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
