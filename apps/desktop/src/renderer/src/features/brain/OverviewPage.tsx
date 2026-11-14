import { useQuery } from '@tanstack/react-query';
import { Brain } from 'lucide-react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { useOverview } from './api';
import { errorMessage, formatWhen } from './format';
import { TYPE_LABEL } from './labels';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

function Bars({ rows, label }: { rows: { key: string; label: string; count: number }[]; label: string }) {
  const max = Math.max(1, ...rows.map((row) => row.count));
  return (
    <ul aria-label={label} className="space-y-2">
      {rows.map((row) => (
        <li key={row.key} className="grid grid-cols-[minmax(0,11rem)_1fr_2.5rem] items-center gap-3 text-[13px]">
          <span className="truncate">{row.label}</span>
          <span className="h-1.5 rounded-full bg-muted" aria-hidden="true">
            <span className="block h-full rounded-full bg-primary/70" style={{ width: `${(row.count / max) * 100}%` }} />
          </span>
          <span className="text-right font-mono tabular-nums">{row.count}</span>
        </li>
      ))}
    </ul>
  );
}

export function OverviewPage() {
  const overview = useOverview();
  const mcp = useQuery({ queryKey: ['mcp', 'status'], queryFn: () => window.neuralbridge.mcp.status(), staleTime: 60_000 });

  if (overview.isError) {
    return (
      <p role="alert" className="px-8 py-7 text-destructive">
        Não foi possível carregar a memória. {errorMessage(overview.error)}
      </p>
    );
  }
  if (!overview.data) return <p className="px-8 py-7 text-muted-foreground">Carregando…</p>;

  const data = overview.data;
  if (data.total === 0) {
    return (
      <section data-tour="memory-search" aria-label="Memória vazia" className="flex justify-center px-8 py-20">
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="mb-5 grid size-12 place-items-center rounded-full border border-dashed border-input text-muted-foreground">
            <Brain className="size-5" aria-hidden="true" />
          </div>
          <h2 className="text-base font-medium">O cérebro ainda está vazio</h2>
          <p className="mt-1.5 text-muted-foreground">
            Memórias chegam quando Claude ou Codex usam <span className="font-mono text-[13px]">brain_store</span> pelo MCP, ou quando você cria uma aqui.
          </p>
          <Button asChild className="mt-5">
            <Link to="/memory/new">Criar a primeira memória</Link>
          </Button>
        </div>
      </section>
    );
  }

  const registered = mcp.data?.clients.filter((client) => client.registered && client.matches).map((client) => (client.id === 'claude' ? 'Claude Code' : 'Codex'));
  const semantic = data.embeddings;
  const global = data.byProject.find((row) => row.projectId === null)?.count ?? 0;
  const projectRows = data.byProject.filter((row) => row.projectId !== null);
  const where = [
    global > 0 && plural(global, 'global', 'globais'),
    projectRows.length > 0 && `${data.total - global} em ${plural(projectRows.length, 'projeto', 'projetos')}`,
  ].filter(Boolean);

  return (
    <div className="max-w-4xl space-y-10 px-8 py-7">
      <p className="max-w-[72ch] text-[15px] leading-7">
        {plural(data.total, 'memória', 'memórias')} ({where.join(' e ')}), com {plural(data.links.resolved, 'link resolvido', 'links resolvidos')}
        {data.links.pending > 0 && <> e {plural(data.links.pending, 'pendente', 'pendentes')}</>}.{' '}
        {semantic.indexed > 0 || semantic.pending > 0 ? (
          <>
            Busca por significado: {semantic.indexed} indexadas
            {semantic.pending > 0 && `, ${semantic.pending} na fila`}
            {semantic.failed > 0 && `, ${semantic.failed} com erro`}.
          </>
        ) : null}
      </p>

      <div className="grid gap-10 md:grid-cols-2">
        <section aria-labelledby="by-type">
          <h2 id="by-type" className="mb-3 text-base font-medium">
            Por tipo
          </h2>
          <Bars label="Memórias por tipo" rows={data.byType.map((row) => ({ key: row.type, label: TYPE_LABEL[row.type], count: row.count }))} />
        </section>
        <section aria-labelledby="by-project">
          <h2 id="by-project" className="mb-3 text-base font-medium">
            Por projeto
          </h2>
          <Bars
            label="Memórias por projeto"
            rows={data.byProject.map((row) => ({ key: row.projectId ?? 'global', label: row.name ?? 'Global (todos os projetos)', count: row.count }))}
          />
        </section>
      </div>

      <section aria-labelledby="recent">
        <h2 id="recent" className="mb-2 text-base font-medium">
          Atualizadas recentemente
        </h2>
        <ul className="divide-y">
          {data.recent.map((memory) => (
            <li key={memory.id}>
              <Link to={`/memory/${memory.id}`} className="flex items-baseline justify-between gap-6 py-2.5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                <span className="truncate font-medium">{memory.title}</span>
                <span className="shrink-0 text-[13px] text-muted-foreground">
                  {TYPE_LABEL[memory.type]} · {formatWhen(memory.updatedAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="mcp-status">
        <h2 id="mcp-status" className="text-base font-medium">
          Acesso dos agentes
        </h2>
        <p className="mt-1 text-muted-foreground">
          {!mcp.data
            ? 'Verificando os clientes MCP…'
            : registered && registered.length
              ? `Registrado em ${registered.join(' e ')}: esses agentes leem e gravam nesta memória.`
              : 'Nenhum cliente registrado ainda: os agentes só usam esta memória pelas tarefas do Singularity.'}{' '}
          <Link to="/mcp" className="text-primary underline-offset-4 hover:underline">
            Gerenciar MCP
          </Link>
        </p>
      </section>
    </div>
  );
}
