import { useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { LoaderCircle, RefreshCw, Search } from 'lucide-react';
import { Link } from 'react-router';
import type { GitSearchHit } from '@neuralbridge/shared/projects';
import { Button } from '@/components/ui/button';
import { errorMessage, formatWhen } from '@/features/brain/format';
import { CONFIDENCE_LABEL } from '@/features/brain/labels';

/** Phase 25: the project's indexed Git history — find how something was solved before, with the commit. */

function Relations({ projectId, hash }: { projectId: string; hash: string }) {
  const relations = useQuery({ queryKey: ['projects', 'git-relations', projectId, hash], queryFn: () => window.neuralbridge.projects.commitRelations(projectId, hash) });
  if (relations.isPending) return <p className="text-muted-foreground">Carregando…</p>;
  if (relations.error) return <p className="text-destructive">{errorMessage(relations.error)}</p>;
  const data = relations.data;
  return (
    <div className="space-y-1 text-[12.5px]">
      <p>
        <span className="text-muted-foreground">Arquivos:</span> <span className="font-mono">{data.files.join(', ') || '—'}</span>
      </p>
      <p>
        <span className="text-muted-foreground">Memórias sobre esses arquivos:</span>{' '}
        {data.memories.length
          ? data.memories.map((memory, index) => (
              <span key={memory.id}>
                {index > 0 && ', '}
                <Link to={`/memory/${memory.id}`} className="underline-offset-2 hover:underline">
                  {memory.title}
                </Link>{' '}
                <span className="text-muted-foreground">({CONFIDENCE_LABEL[memory.confidence].toLowerCase()})</span>
              </span>
            ))
          : 'nenhuma'}
      </p>
      <p>
        <span className="text-muted-foreground">Tarefas que mexeram neles na mesma época:</span>{' '}
        {data.tasks.length
          ? data.tasks.map((task, index) => (
              <span key={task.id}>
                {index > 0 && ', '}
                <Link to={`/runs/${task.id}`} className="underline-offset-2 hover:underline">
                  {task.prompt.slice(0, 60)}
                </Link>
              </span>
            ))
          : 'nenhuma'}
      </p>
    </div>
  );
}

function Hit({ projectId, hit }: { projectId: string; hit: GitSearchHit }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="border-b border-border/60 py-2 last:border-b-0" data-testid="git-hit">
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="w-full rounded text-left outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="font-mono text-[12px] text-muted-foreground">{hit.hash.slice(0, 8)}</span> <span className="font-medium">{hit.subject}</span>
        <span className="block text-xs text-muted-foreground">
          {hit.author} · {formatWhen(hit.date)}
          {hit.file && (
            <>
              {' '}
              · <span className="font-mono">{hit.reference.replace(/^git:\/\/[0-9a-f]+\//, '')}</span>
            </>
          )}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 pl-2">
          <pre className="max-h-48 overflow-auto rounded border bg-background px-2 py-1 font-mono text-[11.5px] whitespace-pre-wrap">{hit.excerpt}</pre>
          <Relations projectId={projectId} hash={hit.hash} />
        </div>
      )}
    </li>
  );
}

export function GitHistorySection({ projectId, exists }: { projectId: string; exists: boolean }) {
  const index = useMutation({ mutationFn: () => window.neuralbridge.projects.indexGit(projectId) });
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const search = useQuery({ queryKey: ['projects', 'git-search', projectId, submitted, index.data], queryFn: () => window.neuralbridge.projects.searchGit(projectId, submitted), enabled: submitted !== '' });
  const report = index.data;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(query.trim());
  };
  return (
    <div className="space-y-3 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground">Mensagens e alterações dos commits das branches locais, só leitura. Linhas com possível segredo e arquivos sensíveis ficam de fora.</p>
        <Button variant="outline" size="sm" disabled={index.isPending || !exists} onClick={() => index.mutate()}>
          {index.isPending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
          Indexar histórico
        </Button>
      </div>
      {index.error && (
        <p role="alert" className="text-destructive">
          {errorMessage(index.error)}
        </p>
      )}
      {report && (
        <p role="status" data-testid="git-index-report">
          {!report.isRepo
            ? 'A pasta não é um repositório Git.'
            : `${report.commits === 1 ? '1 commit novo indexado' : `${report.commits} commits novos indexados`} (${report.files} alterações de arquivo) em ${report.branches === 1 ? '1 branch' : `${report.branches} branches`}.${report.limited ? ' Há mais commits: indexe de novo para continuar.' : ''}`}
        </p>
      )}
      <form onSubmit={submit} role="search" aria-label="Buscar no histórico Git" className="flex gap-2">
        <input
          type="search"
          aria-label="Buscar no histórico Git"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Ex.: timeout no checkout"
          className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2.5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40"
        />
        <Button type="submit" size="sm" variant="outline" disabled={!query.trim()}>
          <Search aria-hidden="true" /> Buscar
        </Button>
      </form>
      {search.error && <p className="text-destructive">{errorMessage(search.error)}</p>}
      {search.data &&
        (search.data.length === 0 ? (
          <p className="text-muted-foreground">Nada encontrado no histórico indexado.</p>
        ) : (
          <ul aria-label="Commits encontrados">
            {search.data.map((hit) => (
              <Hit key={hit.reference} projectId={projectId} hit={hit} />
            ))}
          </ul>
        ))}
    </div>
  );
}
