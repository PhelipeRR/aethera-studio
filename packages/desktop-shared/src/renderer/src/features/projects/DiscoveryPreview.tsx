import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { GitBranch, LoaderCircle } from 'lucide-react';
import { DISCOVERY_LABEL, type DiscoveryCandidate, type DiscoveryClassification, type DiscoveryReport } from '@neuralbridge/shared/projects';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';

type Line = DiscoveryCandidate;

/** Shows what a folder holds and saves only what the person confirms. */
export function DiscoveryPreview({ path, onClose }: { path: string; onClose: () => void }) {
  const client = useQueryClient();
  const [report, setReport] = useState<DiscoveryReport | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [scanned, setScanned] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const stop = window.neuralbridge.projects.onDiscoveryProgress(setScanned);
    let live = true;
    window.neuralbridge.projects.discover(path)
      .then((result) => { if (live) { setReport(result); setLines(result.candidates); } })
      .catch((error: unknown) => { if (live) setProblem(errorMessage(error)); });
    return () => { live = false; stop(); };
  }, [path]);

  const change = (linePath: string, patch: Partial<Line>) => setLines((current) => current.map((line) => (line.path === linePath ? { ...line, ...patch } : line)));
  const setAll = (value: boolean) => setLines((current) => current.map((line) => (line.classification === 'AUXILIARY_DIRECTORY' || line.classification === 'UNKNOWN' ? line : { ...line, selected: value })));
  const confirm = async () => {
    if (!report) return;
    setSaving(true);
    setProblem(null);
    try {
      await window.neuralbridge.projects.confirmDiscovery(report.root, lines.map(({ path: linePath, selected, classification, parentPath }) => ({ path: linePath, selected, classification, parentPath })));
      await client.invalidateQueries({ queryKey: ['projects'] });
      onClose();
    } catch (error) {
      setProblem(errorMessage(error));
    } finally {
      setSaving(false);
    }
  };
  const row = (line: Line) => (
    <li key={line.path} className="flex flex-wrap items-start gap-2 px-3 py-2">
      <input type="checkbox" className="mt-1" aria-label={`Incluir ${line.name}`} checked={line.selected} onChange={(event) => change(line.path, { selected: event.target.checked })} />
      <div className="min-w-0 flex-1">
        <p className="font-medium break-words">{line.relativePath || line.name}{line.existingProjectId && <span className="ml-2 text-xs font-normal text-muted-foreground">já cadastrado</span>}</p>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          {line.git && <span className="flex items-center gap-1"><GitBranch className="size-3" aria-hidden="true" />{line.git.branch ?? line.git.kind}</span>}
          {line.technologies.map((item) => <span key={item} className="rounded bg-muted px-1.5 py-0.5">{item}</span>)}
          <span>{line.evidence.map((item) => item.detail).join(' · ')}</span>
        </p>
      </div>
      <select aria-label={`Tipo de ${line.name}`} className="h-8 rounded border bg-background px-2 text-xs" value={line.classification} onChange={(event) => change(line.path, { classification: event.target.value as DiscoveryClassification })}>{Object.entries(DISCOVERY_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </li>
  );
  const main = lines.filter((line) => line.classification !== 'AUXILIARY_DIRECTORY' && line.classification !== 'UNKNOWN');
  const auxiliary = lines.filter((line) => line.classification === 'AUXILIARY_DIRECTORY' || line.classification === 'UNKNOWN');

  return (
    <section aria-label="Prévia da descoberta" className="space-y-3 rounded-lg border p-4">
      <div>
        <h2 className="font-medium">Projetos em {path}</h2>
        <p className="text-[13px] text-muted-foreground">A análise só lê a pasta. Nada é salvo antes de você confirmar.</p>
      </div>
      {!report && !problem && (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Analisando… {scanned} pastas <Button size="sm" variant="ghost" onClick={() => void window.neuralbridge.projects.cancelDiscovery()}>Cancelar análise</Button></p>
      )}
      {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
      {report && (
        <>
          {report.limited && <p className="text-[13px] text-warning">A análise parou no limite de profundidade, tempo ou arquivos. Pode haver mais projetos.</p>}
          {report.skipped.length > 0 && <p className="text-[13px] text-warning">{report.skipped.length} pasta(s) não puderam ser lidas.</p>}
          <div className="flex gap-2"><Button size="sm" variant="outline" onClick={() => setAll(true)}>Marcar todos</Button><Button size="sm" variant="outline" onClick={() => setAll(false)}>Desmarcar todos</Button></div>
          <h3 className="text-sm font-medium">Projetos detectados</h3>
          <ul aria-label="Projetos detectados" className="divide-y rounded border">{main.map(row)}</ul>
          {auxiliary.length > 0 && <><h3 className="text-sm font-medium">Pastas auxiliares</h3><ul aria-label="Pastas auxiliares" className="divide-y rounded border">{auxiliary.map(row)}</ul></>}
          <div className="flex gap-2"><Button onClick={() => void confirm()} disabled={saving}>Confirmar seleção</Button><Button variant="ghost" onClick={onClose}>Fechar</Button></div>
        </>
      )}
      {!report && problem && <Button variant="ghost" onClick={onClose}>Fechar</Button>}
    </section>
  );
}
