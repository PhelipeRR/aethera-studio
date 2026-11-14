import { type RefObject, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';

type Change = { path: string; changeType: string; objectId: string | null; url: string | null; content: string | null; baseContent: string | null; targetContent: string | null };

function SideBySide({ change }: { change: Change }) {
  const beforeRef = useRef<HTMLPreElement>(null);
  const afterRef = useRef<HTMLPreElement>(null);
  const syncing = useRef(false);
  if (!change.baseContent && !change.targetContent) return <p className="p-4 text-sm text-muted-foreground">O TFS não retornou o código deste arquivo. Apenas os metadados da alteração estão disponíveis.</p>;
  const before = (change.baseContent ?? '').split(/\r?\n/);
  const after = (change.targetContent ?? '').split(/\r?\n/);
  const syncScroll = (source: HTMLPreElement, target: HTMLPreElement | null) => {
    if (!target || syncing.current) return;
    syncing.current = true;
    target.scrollTop = source.scrollTop;
    target.scrollLeft = source.scrollLeft;
    window.requestAnimationFrame(() => { syncing.current = false; });
  };
  const renderLines = (lines: string[], other: string[], tone: 'before' | 'after', ref: RefObject<HTMLPreElement | null>, target: React.RefObject<HTMLPreElement | null>) => <pre ref={ref} onScroll={(event) => syncScroll(event.currentTarget, target.current)} className="max-h-[28rem] overflow-y-auto overflow-x-auto p-4 font-mono text-xs leading-5">{lines.map((line, index) => {
    const changed = line !== other[index];
    const toneClass = changed ? tone === 'before' ? 'bg-destructive/20 text-destructive' : 'bg-success/20 text-success' : 'text-foreground';
    return <code key={index} className="block whitespace-pre"><span className="mr-3 inline-block w-8 select-none text-right text-muted-foreground">{index + 1}</span><span className={toneClass}>{line}</span>\n</code>;
  })}</pre>;
  return <div className="grid min-w-full grid-cols-2 gap-3">
    <section className="min-w-0 overflow-hidden sg-panel rounded-lg"><header className="border-b px-3 py-2 font-semibold text-destructive">Antes</header>{renderLines(before, after, 'before', beforeRef, afterRef)}</section>
    <section className="min-w-0 overflow-hidden sg-panel rounded-lg"><header className="border-b px-3 py-2 font-semibold text-success">Depois</header>{renderLines(after, before, 'after', afterRef, beforeRef)}</section>
  </div>;
}

export function AzureDevOpsDiffPanel({ changes, onClose }: { changes: Change[]; onClose: () => void }) {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const selected = changes[selectedIndex] ?? null;
  return <div className="fixed inset-0 z-[60] flex min-w-0 items-center justify-center overflow-hidden bg-black/60 p-4"><section role="dialog" aria-modal="true" aria-label="Diff da Pull Request" className="flex min-w-0 max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden sg-panel rounded-xl shadow-2xl"><header className="flex shrink-0 items-center justify-between border-b p-4"><div className="min-w-0"><h3 className="font-semibold">Diff da Pull Request</h3><p className="text-xs text-muted-foreground">Selecione um arquivo para carregar o diff. Remoções em vermelho e adições em verde.</p></div><Button className="shrink-0" variant="ghost" onClick={onClose}>Fechar</Button></header><div className="grid min-h-0 min-w-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[16rem_minmax(0,1fr)]">{changes.length ? <><nav className="min-h-0 overflow-y-auto rounded-lg border bg-background" aria-label="Arquivos do diff">{changes.map((change, index) => <button key={`${change.path}-${change.objectId ?? ''}`} type="button" onClick={() => setSelectedIndex(index)} className={`flex w-full items-center justify-between gap-2 border-b px-3 py-3 text-left text-xs last:border-b-0 ${index === selectedIndex ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted'}`}><span className="min-w-0 truncate">{change.path}</span><span className="shrink-0">{change.changeType}</span></button>)}</nav><div className="min-h-0 min-w-0 overflow-auto">{selected ? <article className="min-w-0 overflow-hidden rounded-lg border"><header className="flex items-center justify-between gap-3 border-b bg-muted/30 px-3 py-2 text-sm"><span className="min-w-0 truncate font-medium">{selected.path}</span><span className="shrink-0 text-xs text-muted-foreground">{selected.changeType} · {selectedIndex + 1}/{changes.length}</span></header><SideBySide change={selected} /></article> : <p className="p-8 text-center text-sm text-muted-foreground">Selecione um arquivo.</p>}</div></> : <p className="p-8 text-center text-sm text-muted-foreground">Nenhuma alteração retornada.</p>}</div></section></div>;
}

