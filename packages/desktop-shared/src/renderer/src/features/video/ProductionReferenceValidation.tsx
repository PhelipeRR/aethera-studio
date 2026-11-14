import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { ClipboardCheck } from 'lucide-react';
import type { ProductionState } from '@neuralbridge/shared/velix-production';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/features/brain/format';

const DEFAULT_ROOT = 'C:/dev/aethera-reference-media';
const STATUS_LABEL = { pass: 'Aprovado', blocked: 'Bloqueado', fail: 'Falhou' } as const;

/** AS-10: read-only validation of the user-provided real reference folder. */
export function ProductionReferenceValidation({ state }: { state: ProductionState }) {
  const api = window.neuralbridge.video;
  const [root, setRoot] = useState(DEFAULT_ROOT);
  const isAethera = state.stages.some((item) => item.kind === 'game_research' || item.kind === 'media_acquisition' || item.kind === 'visual_index');
  const check = useMutation({ mutationFn: () => api.productionReferenceValidation(root.trim()) });
  if (!isAethera) return null;
  return (
    <div aria-label="Validação AS-10" className="space-y-3 rounded border p-3 text-sm">
      <div className="flex items-start gap-2">
        <ClipboardCheck aria-hidden className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="font-medium">Validação de referência AS-10</p>
          <p className="text-xs text-muted-foreground">Lê o envelope e confere os artefatos reais; não baixa, altera ou cria arquivos.</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="flex-1 text-xs font-medium">Pasta de referência<input aria-label="Pasta de referência AS-10" className="mt-1.5 min-h-11 w-full rounded-md border bg-background px-3 py-2 text-sm font-normal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" value={root} onChange={(event) => setRoot(event.target.value)} /></label>
        <Button className="min-h-11 self-end" disabled={!root.trim() || check.isPending} onClick={() => check.mutate()}>{check.isPending ? 'Verificando…' : 'Verificar evidências'}</Button>
      </div>
      {check.data && (
        <div role="status" aria-label="Resultado da validação AS-10" className="space-y-2 rounded border p-3">
          <p className={check.data.status === 'pass' ? 'font-medium text-primary' : check.data.status === 'fail' ? 'font-medium text-destructive' : 'font-medium'}>{STATUS_LABEL[check.data.status]}</p>
          {check.data.blockers.length > 0 && <ul aria-label="Bloqueios AS-10" className="list-disc space-y-1 pl-5 text-xs">{check.data.blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>}
          <ul aria-label="Checks AS-10" className="space-y-1 text-xs text-muted-foreground">{check.data.checks.map((item) => <li key={item.id}><span className="font-medium">{item.id}</span>: {STATUS_LABEL[item.status]} — {item.evidence[0]}</li>)}</ul>
        </div>
      )}
      {check.isError && <p role="alert" className="text-sm text-destructive">{errorMessage(check.error)}</p>}
    </div>
  );
}
