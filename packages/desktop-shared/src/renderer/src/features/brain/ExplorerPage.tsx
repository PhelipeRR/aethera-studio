import { useEffect, useState } from 'react';
import { LoaderCircle, Search } from 'lucide-react';
import { Link, useSearchParams } from 'react-router';
import type { MemoryType } from '@neuralbridge/shared/domain';
import { Input, Select } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { useMemoryList, useProjects, useSearch, useTags } from './api';
import { errorMessage, formatWhen } from './format';
import { CONFIDENCE_LABEL, MEMORY_TYPES, TRUST_LABEL, TYPE_LABEL } from './labels';
import { snippetParts } from './snippet';

const DEGRADED: Record<string, string> = {
  disabled: 'Busca por significado desativada: resultados só por palavras-chave.',
  model_missing: 'O modelo de busca por significado não está instalado: resultados só por palavras-chave.',
  model_error: 'O modelo de busca por significado falhou: resultados só por palavras-chave.',
};

/** Snippet with keyword matches highlighted and Markdown noise removed. */
function Highlighted({ text }: { text: string }) {
  return (
    <>
      {snippetParts(text).map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded-sm bg-primary/20 px-0.5 text-foreground">
            {part.text}
          </mark>
        ) : (
          part.text
        ),
      )}
    </>
  );
}

interface Row {
  id: string;
  title: string;
  type: MemoryType;
  projectId: string | null;
  tags: string[];
  text: string;
  meta?: string;
  matchedBy?: ('text' | 'semantic')[];
}

function ResultList({ rows, projectName }: { rows: Row[]; projectName: (id: string | null) => string }) {
  return (
    <ul className="divide-y rounded-lg border">
      {rows.map((row) => (
        <li key={row.id}>
          <Link to={`/memory/${row.id}`} className="block px-4 py-3.5 outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h3 className="min-w-0 font-medium break-words">{row.title}</h3>
              <span className="text-[12.5px] text-muted-foreground">
                {TYPE_LABEL[row.type]} · {projectName(row.projectId)}
                {row.meta && ` · ${row.meta}`}
              </span>
            </div>
            <p className="mt-1 line-clamp-2 text-[13.5px] text-muted-foreground">
              <Highlighted text={row.text} />
            </p>
            {(row.tags.length > 0 || row.matchedBy) && (
              <p className="mt-2 flex flex-wrap gap-1.5 text-xs">
                {row.matchedBy?.map((by) => (
                  <span key={by} className="rounded border border-primary/40 px-1.5 py-0.5 text-primary">
                    {by === 'text' ? 'palavras' : 'significado'}
                  </span>
                ))}
                {row.tags.map((tag) => (
                  <span key={tag} className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">
                    #{tag}
                  </span>
                ))}
              </p>
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ExplorerPage() {
  const [params, setParams] = useSearchParams();
  const query = params.get('q') ?? '';
  const type = (params.get('type') ?? '') as MemoryType | '';
  const project = params.get('project') ?? '';
  const tag = params.get('tag') ?? '';
  const [draft, setDraft] = useState(query);

  // Debounce typing into the URL, which drives the query.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (draft.trim() !== query) {
        setParams(
          (current) => {
            const next = new URLSearchParams(current);
            if (draft.trim()) next.set('q', draft.trim());
            else next.delete('q');
            return next;
          },
          { replace: true },
        );
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [draft, query, setParams]);

  const setFilter = (key: string, value: string) =>
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );

  const projects = useProjects();
  const tags = useTags();
  const projectId = project === '' ? undefined : project === 'global' ? null : project;
  const filters = { ...(type ? { type } : {}), ...(tag ? { tags: [tag] } : {}) };
  const searching = query.length > 0;
  const search = useSearch({ query, ...filters, ...(projectId !== undefined ? { projectId } : {}), limit: 20 }, searching);
  const list = useMemoryList({ ...filters, ...(projectId !== undefined ? { projectId } : {}), limit: 20 }, !searching);

  const projectName = (id: string | null) => (id === null ? 'Global' : (projects.data?.find((entry) => entry.id === id)?.name ?? id));
  const error = searching ? search.error : list.error;
  const rows: Row[] | undefined = searching
    ? search.data?.hits.map((hit) => ({ ...hit, text: hit.snippet, matchedBy: hit.matchedBy }))
    : list.data?.pages.flatMap((page) => page.items.map((item) => ({ ...item, text: item.excerpt, meta: `${TRUST_LABEL[item.trust]}${item.confidence === 'unverified' ? '' : ` · ${CONFIDENCE_LABEL[item.confidence]}`} · ${formatWhen(item.updatedAt)}` })));
  const loading = searching ? search.isFetching : list.isFetching && !list.isFetchingNextPage;

  return (
    <div className="max-w-4xl space-y-5 px-8 py-6">
      <div data-tour="memory-search" role="search" className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input type="search" aria-label="Buscar memórias" placeholder="Buscar por palavras ou pelo significado…" value={draft} onChange={(event) => setDraft(event.target.value)} className="h-10 pl-9 text-[15px]" />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select aria-label="Filtrar por tipo" value={type} onChange={(event) => setFilter('type', event.target.value)} className="w-auto">
            <option value="">Todos os tipos</option>
            {MEMORY_TYPES.map((value) => (
              <option key={value} value={value}>
                {TYPE_LABEL[value]}
              </option>
            ))}
          </Select>
          <Select aria-label="Filtrar por projeto" value={project} onChange={(event) => setFilter('project', event.target.value)} className="w-auto">
            <option value="">Todos os projetos</option>
            <option value="global">Somente globais</option>
            {projects.data?.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Filtrar por tag" value={tag} onChange={(event) => setFilter('tag', event.target.value)} className="w-auto">
            <option value="">Todas as tags</option>
            {tags.data?.map((entry) => (
              <option key={entry.name} value={entry.name}>
                #{entry.name} ({entry.count})
              </option>
            ))}
          </Select>
          {loading && <LoaderCircle className="size-4 animate-spin self-center text-muted-foreground" aria-label="Carregando" />}
        </div>
      </div>

      {searching && search.data?.degraded && (
        <p className="text-[13px] text-muted-foreground">
          {DEGRADED[search.data.degraded]}{' '}
          {search.data.degraded !== 'model_error' && (
            <Link to="/settings" className="text-primary underline-offset-4 hover:underline">
              Ativar em Configurações
            </Link>
          )}
        </p>
      )}

      {error && (
        <p role="alert" className="text-destructive">
          {errorMessage(error)}
        </p>
      )}

      <p aria-live="polite" className="sr-only">
        {rows ? (rows.length === 1 ? '1 memória encontrada' : `${rows.length} memórias encontradas`) : ''}
      </p>
      {rows && rows.length === 0 && (
        <p className="py-10 text-center text-muted-foreground">
          {searching ? `Nada encontrado para "${query}".` : 'Nenhuma memória com esses filtros.'}
        </p>
      )}
      {rows && rows.length > 0 && <ResultList rows={rows} projectName={projectName} />}

      {!searching && list.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" disabled={list.isFetchingNextPage} onClick={() => list.fetchNextPage()}>
            {list.isFetchingNextPage && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            Carregar mais
          </Button>
        </div>
      )}
    </div>
  );
}
