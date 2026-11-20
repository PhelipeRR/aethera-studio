import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, LoaderCircle } from 'lucide-react';
import type { McpClientId, McpClientStatus, McpStatus } from '@neuralbridge/shared/channels';
import { PageHeader } from '@/app/PageHeader';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';

const LABELS: Record<McpClientId, string> = { claude: 'Claude Code', codex: 'Codex CLI', 'claude-gateway': 'Claude Gateway' };

type Pending = { client: McpClientStatus; action: 'register' | 'unregister' | 'register-alias' } | null;
type Outcome = { kind: 'ok' | 'error'; text: string } | null;

function statusOf(client: McpClientStatus): { label: string; tone: 'ok' | 'warn' | 'muted' | 'error' } {
  if (client.error) return { label: 'Não foi possível verificar', tone: 'error' };
  if (!client.installed) return { label: 'Não encontrado no PATH', tone: 'muted' };
  if (!client.registered) return { label: 'Não registrado', tone: 'muted' };
  if (!client.matches) return { label: 'Registrado com outro caminho', tone: 'warn' };
  return { label: 'Registrado nesta instalação', tone: 'ok' };
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () =>
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => setCopied(false),
    );
  return (
    <Button variant="ghost" size="sm" onClick={copy} aria-label={label}>
      {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
      {copied ? 'Copiado' : 'Copiar'}
    </Button>
  );
}

function CommandLine({ label, command }: { label: string; command: string }) {
  return (
    <div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{label}</span>
        <CopyButton text={command} label={`Copiar: ${label}`} />
      </div>
      <pre className="overflow-x-auto rounded-md border bg-background px-3 py-2 font-mono text-[12.5px] leading-relaxed whitespace-pre-wrap break-all">{command}</pre>
    </div>
  );
}

function ClientRow({ client, busy, onAction }: { client: McpClientStatus; busy: boolean; onAction: (action: 'register' | 'unregister' | 'register-alias') => void }) {
  const status = statusOf(client);
  const name = LABELS[client.id];
  return (
    <li className="py-5" aria-label={name}>
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 font-medium">
            <span className={cn('size-2 rounded-full', client.id === 'claude' ? 'bg-agent-claude' : 'bg-agent-codex')} aria-hidden="true" />
            {name}
          </h3>
          <p
            className={cn(
              'mt-1',
              status.tone === 'ok' && 'text-primary',
              status.tone === 'warn' && 'text-warning',
              status.tone === 'error' && 'text-destructive',
              status.tone === 'muted' && 'text-muted-foreground',
            )}
          >
            {status.label}
          </p>
          {client.error && <p className="mt-1 text-muted-foreground">{client.error}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            Configuração: <span className="font-mono break-all">{client.configFile}</span>
          </p>
        </div>
        {client.installed && (
          <div className="flex shrink-0 gap-2">
            {client.registered && (
              <Button variant="outline" disabled={busy} onClick={() => onAction('unregister')}>
                Remover
              </Button>
            )}
            {!client.matches && (
              <Button disabled={busy} onClick={() => onAction('register')}>
                {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                {client.registered ? 'Atualizar registro' : 'Registrar'}
              </Button>
            )}
            <Button variant="ghost" disabled={busy} onClick={() => onAction('register-alias')}>Adicionar alias Singularity</Button>
          </div>
        )}
      </div>
      <details className="mt-3">
        <summary className="cursor-pointer text-[13px] text-muted-foreground hover:text-foreground">Comandos equivalentes para o terminal</summary>
        <div className="mt-3 space-y-3">
          <CommandLine label="Registrar" command={client.addCommand} />
          <CommandLine label="Remover" command={client.removeCommand} />
        </div>
      </details>
    </li>
  );
}

export function McpPage({ description }: { description: string }) {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState<McpClientId | null>(null);
  const [outcome, setOutcome] = useState<Outcome>(null);

  const refresh = useCallback(() => {
    window.neuralbridge.mcp.status().then(
      (next) => {
        setStatus(next);
        setLoadError(null);
      },
      () => setLoadError('Não foi possível verificar os clientes MCP.'),
    );
  }, []);

  useEffect(refresh, [refresh]);

  const confirm = () => {
    if (!pending) return;
    const { client, action } = pending;
    const name = LABELS[client.id];
    setPending(null);
    setBusy(client.id);
    setOutcome(null);
    const request = action === 'register' ? window.neuralbridge.mcp.register(client.id) : action === 'register-alias' ? window.neuralbridge.mcp.registerAlias(client.id) : window.neuralbridge.mcp.unregister(client.id);
    request
      .then(
        ({ changed, backup }) => {
          const done = action === 'register' ? `Registrado no ${name}.` : action === 'register-alias' ? `Alias Singularity adicionado no ${name}.` : `Removido do ${name}.`;
          const text = !changed ? `Nada a alterar no ${name}.` : backup ? `${done} Cópia da configuração anterior: ${backup}` : done;
          setOutcome({ kind: 'ok', text });
        },
        (error: unknown) => setOutcome({ kind: 'error', text: `Não foi possível concluir no ${name}. ${error instanceof Error ? error.message : ''}`.trim() }),
      )
      .finally(() => {
        setBusy(null);
        refresh();
      });
  };

  const commandLine = status ? [status.server.command, ...status.server.args].map((part) => (/\s/.test(part) ? `"${part}"` : part)).join(' ') : '';

  return (
    <>
      <PageHeader title="MCPs" description={description} />
      <div className="max-w-3xl space-y-10 px-8 py-7">
        <section data-tour="mcp-status" aria-labelledby="server-heading">
          <h2 id="server-heading" className="text-base font-medium">
            Servidor do Singularity
          </h2>
          <p className="mt-1 max-w-[68ch] text-muted-foreground">
            Cada cliente inicia o servidor quando precisa da memória. O Singularity não precisa estar aberto; todos os clientes usam o mesmo banco.
          </p>
          {status && (
            <div className="mt-4 space-y-3">
              <CommandLine label="Comando do servidor (stdio)" command={commandLine} />
              <p className="text-xs text-muted-foreground">
                Variáveis de ambiente:{' '}
                <span className="font-mono">
                  {Object.entries(status.server.env)
                    .map(([key, value]) => `${key}=${value}`)
                    .join('  ')}
                </span>
              </p>
            </div>
          )}
        </section>

        <section data-tour="mcp-register" aria-labelledby="clients-heading">
          <h2 id="clients-heading" className="text-base font-medium">
            Clientes
          </h2>
          <p className="mt-1 max-w-[68ch] text-muted-foreground">
            Registrar usa o comando oficial de cada cliente no escopo do usuário, para valer em todos os projetos. Antes de qualquer mudança, o arquivo de
            configuração é copiado para a pasta de backups do Singularity.
          </p>
          {outcome && (
            <p role={outcome.kind === 'error' ? 'alert' : 'status'} className={cn('mt-4 break-all', outcome.kind === 'error' ? 'text-destructive' : 'text-primary')}>
              {outcome.text}
            </p>
          )}
          {loadError && (
            <p role="alert" className="mt-4 text-destructive">
              {loadError}
            </p>
          )}
          {!status && !loadError && (
            <p className="mt-4 flex items-center gap-2 text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> Verificando Claude Code e Codex…
            </p>
          )}
          {status && (
            <ul className="mt-2 divide-y">
              {status.clients.map((client) => (
                <ClientRow key={client.id} client={client} busy={busy === client.id} onAction={(action) => setPending({ client, action })} />
              ))}
            </ul>
          )}
        </section>
      </div>

      {pending && status && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setPending(null)}
          title={pending.action === 'register' ? `Registrar no ${LABELS[pending.client.id]}?` : `Remover do ${LABELS[pending.client.id]}?`}
          confirmLabel={pending.action === 'register' ? 'Registrar' : 'Remover'}
          destructive={pending.action === 'unregister'}
          onConfirm={confirm}
        >
          <p>O Singularity vai executar:</p>
          <pre className="rounded-md border bg-background px-3 py-2 font-mono text-[12px] whitespace-pre-wrap break-all text-foreground">
            {pending.action === 'register' ? pending.client.addCommand : pending.client.removeCommand}
          </pre>
          <p>
            Isso altera <span className="font-mono text-[12.5px] break-all text-foreground">{pending.client.configFile}</span>. Uma cópia é salva antes em{' '}
            <span className="font-mono text-[12.5px] break-all text-foreground">{status.backupDir}</span>.
          </p>
        </ConfirmDialog>
      )}
    </>
  );
}
