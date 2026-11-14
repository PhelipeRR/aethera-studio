import { LoaderCircle, RefreshCw } from 'lucide-react';
import { AgentList } from '@/app/AgentList';
import { PageHeader } from '@/app/PageHeader';
import { useAgents } from '@/app/useAgents';
import { Button } from '@/components/ui/button';

export function AgentsPage({ description }: { description: string }) {
  const { agents, checking, error, refresh } = useAgents();
  return (
    <>
      <PageHeader
        title="Agentes"
        description={description}
        actions={
          <Button variant="outline" disabled={checking} onClick={refresh}>
            {checking ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
            Verificar novamente
          </Button>
        }
      />
      <div className="max-w-3xl space-y-4 px-8 py-7">
        <p className="max-w-[68ch] text-muted-foreground">
          O Singularity usa os CLIs instalados com o login que você já fez neles. Nenhuma chave de API é pedida ou guardada.
        </p>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {!agents && checking && (
          <p className="flex items-center gap-2 text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Verificando…
          </p>
        )}
        {agents && <div data-tour="agents-list"><AgentList agents={agents} detailed /></div>}
      </div>
    </>
  );
}
