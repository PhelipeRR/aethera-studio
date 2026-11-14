import { Bot, GitBranch, GitCommitHorizontal, Route, Search, Sparkles, SquareTerminal, TestTube, UserCheck, Wrench, type LucideIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NODE_CATALOG, NODE_DRAG_TYPE, type NodeKind } from './model';

const ICONS: Record<NodeKind, LucideIcon> = { claude: Sparkles, codex: SquareTerminal, generic: Route, skill: Wrench, approval: UserCheck, condition: GitBranch, rag: Search, validation: TestTube, git: GitCommitHorizontal };
const GROUPS = ['Agentes', 'Controle', 'Ferramentas'] as const;

/** The blocks of a workflow: drag one to the canvas, or activate it to add it there. */
export function BlockPalette({ onAdd }: { onAdd: (kind: NodeKind) => void }) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => NODE_CATALOG.filter((entry) => `${entry.label} ${entry.hint} ${entry.group}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())), [query]);
  return (
    <div role="group" aria-label="Blocos" className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" aria-hidden="true" />
        <input aria-label="Buscar blocos" placeholder="Buscar etapas" value={query} onChange={(event) => setQuery(event.target.value)} className="h-9 w-full rounded-md border bg-background pl-8 pr-2 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/40" />
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">Adicione uma etapa pelo teclado ou arraste-a para o canvas. As conexões definem a ordem real de execução.</p>
      {GROUPS.map((group) => (
        <div key={group}>
          {visible.some((entry) => entry.group === group) && <p className="mb-1 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">{group}</p>}
          {visible.filter((entry) => entry.group === group).map((entry) => {
            const Icon = ICONS[entry.kind] ?? Bot;
            return (
              <button key={entry.kind} type="button" draggable aria-label={`Adicionar ${entry.label}`} title={entry.hint} onClick={() => onAdd(entry.kind)} onDragStart={(event) => event.dataTransfer.setData(NODE_DRAG_TYPE, entry.kind)} className="group flex min-h-11 w-full cursor-grab items-center gap-2 rounded-md px-2 text-left text-[13px] outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/15 group-hover:text-primary"><Icon className="size-4" aria-hidden="true" /></span>
                <span className="min-w-0"><span className="block truncate">{entry.label}</span><span className="block truncate text-[11px] text-muted-foreground">{entry.hint}</span></span>
              </button>
            );
          })}
        </div>
      ))}
      {!visible.length && <div className="rounded-md border border-dashed px-3 py-5 text-center text-xs text-muted-foreground"><Search className="mx-auto size-4" aria-hidden="true" /><p className="mt-2 font-medium text-foreground">Nenhum bloco encontrado</p><p className="mt-1">Busque uma etapa suportada pelo TaskEngine.</p></div>}
      <p className="text-xs text-muted-foreground">Para rodar em paralelo, ligue uma etapa a várias. Para juntar, ligue várias a uma.</p>
    </div>
  );
}
