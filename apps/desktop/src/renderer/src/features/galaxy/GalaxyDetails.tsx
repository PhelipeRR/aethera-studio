import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Crosshair, ExternalLink, Sparkles, X } from 'lucide-react';
import { Link } from 'react-router';
import type { GalaxyMemory } from '@neuralbridge/shared/brain3d';
import { Button } from '@/components/ui/button';
import { Chip, GlassPanel, SectionLabel } from '@/components/ui/glass';
import { CONFIDENCE_LABEL, SOURCE_LABEL, TRUST_LABEL, TYPE_LABEL } from '@/features/brain/labels';
import { formatWhen } from '@/features/brain/format';
import { plainText } from '@/features/brain/snippet';

/** Right-panel details of the selected star (lote 50.06): real fields, real links, real neighbours by meaning. */
export function GalaxyDetails({
  memory,
  colour,
  groupLabel,
  nearest,
  byId,
  onSelect,
  onFocus,
  onClose,
}: {
  memory: GalaxyMemory;
  colour: string;
  groupLabel: string;
  nearest: (id: string) => Promise<{ id: string; score: number }[]>;
  byId: ReadonlyMap<string, GalaxyMemory>;
  onSelect: (id: string) => void;
  onFocus: () => void;
  onClose: () => void;
}) {
  const detail = useQuery({ queryKey: ['galaxy', 'memory', memory.id], queryFn: () => window.neuralbridge.brain.get(memory.id), retry: false });
  const neighbours = useQuery({ queryKey: ['galaxy', 'nearest', memory.id], queryFn: () => nearest(memory.id), retry: false });
  const excerpt = detail.data ? plainText(detail.data.content).slice(0, 320) : '';
  const related = detail.data ? [...detail.data.outgoing, ...detail.data.backlinks] : [];

  return (
    <>
      <GlassPanel tone="active" className="sg-enter space-y-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs text-primary"><Sparkles className="size-3.5" aria-hidden="true" />Memória selecionada</p>
          <Button variant="ghost" size="icon" className="-mt-1 -mr-1 size-7" aria-label="Fechar seleção" onClick={onClose}><X /></Button>
        </div>
        <h2 className="text-lg leading-snug text-foreground">{memory.title}</h2>
        <div className="flex flex-wrap gap-1.5">
          <Chip selected><span className="size-1.5 rounded-full" style={{ background: colour }} aria-hidden="true" />{TYPE_LABEL[memory.type]}</Chip>
          <Chip>{memory.projectName ?? 'Global'}</Chip>
          {memory.tags.slice(0, 6).map((tag) => <Chip key={tag}>#{tag}</Chip>)}
        </div>
        <p className="min-h-10 text-sm text-muted-foreground">
          {detail.isLoading ? 'Carregando conteúdo…' : detail.data ? excerpt || 'Sem conteúdo de texto.' : 'Conteúdo indisponível.'}
          {detail.data && plainText(detail.data.content).length > 320 && '…'}
        </p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Grupo</dt><dd className="text-foreground">{groupLabel}</dd>
          <dt className="text-muted-foreground">Origem</dt><dd className="text-foreground">{SOURCE_LABEL[memory.sourceKind]}</dd>
          <dt className="text-muted-foreground">Confiança</dt><dd className="text-foreground">{CONFIDENCE_LABEL[memory.confidence]} · {TRUST_LABEL[memory.trust]}</dd>
          <dt className="text-muted-foreground">Criada</dt><dd className="text-foreground">{formatWhen(memory.createdAt)}</dd>
          <dt className="text-muted-foreground">Atualizada</dt><dd className="text-foreground">{formatWhen(memory.updatedAt)}</dd>
        </dl>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button asChild size="sm"><Link to={`/memory/${encodeURIComponent(memory.id)}`}><ExternalLink />Abrir e editar</Link></Button>
          <Button size="sm" variant="outline" onClick={onFocus}><Crosshair />Centralizar</Button>
        </div>
      </GlassPanel>

      <GlassPanel className="space-y-2 p-4">
        <SectionLabel as="h3">Mais próximas por significado</SectionLabel>
        {neighbours.isLoading ? <p className="text-sm text-muted-foreground">Calculando…</p> : (neighbours.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem embedding: a proximidade por significado fica indisponível.</p>
        ) : (
          <ul className="space-y-1">
            {(neighbours.data ?? []).map((entry) => {
              const other = byId.get(entry.id);
              if (!other) return null;
              return (
                <li key={entry.id}>
                  <button type="button" onClick={() => onSelect(entry.id)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring">
                    <span className="min-w-0 flex-1 truncate">{other.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{Math.round(entry.score * 100)}%</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </GlassPanel>

      <GlassPanel className="space-y-2 p-4">
        <SectionLabel as="h3">Ligações registradas</SectionLabel>
        {related.length === 0 ? <p className="text-sm text-muted-foreground">Nenhuma ligação com outras memórias.</p> : (
          <ul className="space-y-1">
            {related.slice(0, 8).map((link, i) => {
              const target = link.id;
              return (
              <li key={`${target ?? link.title}-${i}`}>
                {target && byId.has(target) ? (
                  <button type="button" onClick={() => onSelect(target)} className="w-full truncate rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-secondary focus-visible:ring-2 focus-visible:ring-ring">{link.title}</button>
                ) : <span className="block truncate px-2 py-1.5 text-sm text-muted-foreground">{link.title}</span>}
              </li>
              );
            })}
          </ul>
        )}
      </GlassPanel>
    </>
  );
}
