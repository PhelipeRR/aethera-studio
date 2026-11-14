import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { SemanticStatus } from '@neuralbridge/shared/channels';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const MODEL_SIZE = 'cerca de 130 MB';
const MODEL_SOURCE = 'huggingface.co';

function summary(status: SemanticStatus): string {
  if (!status.enabled) {
    return status.downloaded
      ? 'Desativada. O modelo já está no computador; a busca usa apenas palavras-chave.'
      : 'Desativada. A busca usa apenas palavras-chave, sem reconhecer sinônimos nem outros idiomas.';
  }
  const queue = status.pending ? `, ${status.pending} na fila` : '';
  const failed = status.failed ? `, ${status.failed} com erro` : '';
  return `Ativa. ${status.indexed} memórias indexadas${queue}${failed}.`;
}

/** Semantic search: consent before the one-time model download (decision A6). */
export function SemanticSearchSection() {
  const [status, setStatus] = useState<SemanticStatus | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    window.neuralbridge.semantic.status().then(setStatus, () => setError('Não foi possível ler o estado da busca semântica.'));
  }, []);

  useEffect(refresh, [refresh]);

  const run = (action: () => Promise<SemanticStatus>, failure: string) => {
    setBusy(true);
    setError(null);
    action()
      .then(setStatus, (cause: unknown) => setError(`${failure} ${cause instanceof Error ? cause.message : ''}`.trim()))
      .finally(() => setBusy(false));
  };

  const enable = () => run(() => window.neuralbridge.semantic.enable(), 'Não foi possível ativar a busca semântica.');

  return (
    <section aria-labelledby="semantic-heading">
      <h2 id="semantic-heading" className="text-base font-medium">
        Busca semântica
      </h2>
      <p className="mt-1 max-w-[68ch] text-muted-foreground">
        Encontra memórias pelo significado, inclusive entre português e inglês. Roda no seu computador; o conteúdo das memórias não sai daqui.
      </p>
      {status && <p className="mt-3">{summary(status)}</p>}
      {busy && (
        <p role="status" className="mt-3 flex items-center gap-2 text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          {status?.downloaded ? 'Aplicando…' : 'Baixando o modelo. Pode levar alguns minutos.'}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-destructive">
          {error}
        </p>
      )}
      {status && (
        <div className="mt-4 flex gap-2">
          {status.enabled ? (
            <Button variant="outline" disabled={busy} onClick={() => run(() => window.neuralbridge.semantic.disable(), 'Não foi possível desativar.')}>
              Desativar busca semântica
            </Button>
          ) : (
            <Button disabled={busy} onClick={() => (status.downloaded ? enable() : setConfirming(true))}>
              Ativar busca semântica
            </Button>
          )}
        </div>
      )}

      {confirming && status && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setConfirming(false)}
          title="Baixar o modelo de busca semântica?"
          confirmLabel="Baixar e ativar"
          onConfirm={() => {
            setConfirming(false);
            enable();
          }}
        >
          <p>
            O Singularity vai baixar o modelo <span className="font-mono text-[12.5px] text-foreground">{status.model}</span> ({MODEL_SIZE}) de{' '}
            {MODEL_SOURCE}, uma única vez, para:
          </p>
          <p className="font-mono text-[12.5px] break-all text-foreground">{status.modelsDir}</p>
          <p>Depois disso tudo roda no seu computador. Nenhuma memória é enviada para fora.</p>
        </ConfirmDialog>
      )}
    </section>
  );
}
