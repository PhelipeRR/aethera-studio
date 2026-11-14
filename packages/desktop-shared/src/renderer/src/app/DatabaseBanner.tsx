import { useEffect, useState } from 'react';
import type { AppStatus, DatabaseRecoveryBackup, DatabaseStatus } from '@neuralbridge/shared/channels';
import { OfflineState } from '@/components/feedback/FeedbackState';
import { Button } from '@/components/ui/button';

type Failure = Extract<DatabaseStatus, { ok: false }>;

const REASONS: Record<Failure['reason'], string> = {
  corrupt: 'O arquivo do banco de dados está corrompido.',
  locked: 'O banco de dados está bloqueado por outro processo.',
  'disk-full': 'Não há espaço em disco para abrir o banco de dados.',
  migration: 'A atualização do banco de dados falhou.',
  io: 'Não foi possível acessar a pasta do banco de dados.',
  unknown: 'O banco de dados não pôde ser aberto.',
};
const ACTIONS: Record<Failure['recovery'], string> = {
  retry: 'Feche outros processos do Singularity e tente novamente.',
  'restore-backup': 'Restaure um backup verificado; o arquivo atual é guardado, não apagado.',
  'free-disk-space': 'Libere espaço no disco e tente novamente.',
  'check-permissions': 'Verifique as permissões da pasta de dados e o espaço disponível.',
  'export-diagnostics': 'Exporte os diagnósticos locais e encaminhe o arquivo ao suporte.',
};

const dateFormat = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/** Degraded mode: the app stays usable, but nothing is persisted until the database opens. */
export function DatabaseBanner() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [backups, setBackups] = useState<DatabaseRecoveryBackup[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  useEffect(() => {
    window.neuralbridge.app.status().then(setStatus, () => setStatus(null));
  }, []);

  if (!status) return null;
  const database = status.database.ok ? null : status.database;
  const configuration = status.configuration.ok ? null : status.configuration;
  if (!database && !configuration) return null;

  const run = async (work: () => Promise<string | null>) => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage(await work());
    } catch (error) {
      setMessage(error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'A ação falhou.');
    } finally {
      setBusy(false);
    }
  };
  const retry = () => void run(async () => { await window.neuralbridge.app.relaunch(); return 'Reiniciando o Singularity…'; });
  const exportDiagnostics = () => void run(async () => `Diagnóstico salvo em ${(await window.neuralbridge.app.exportDiagnostics()).file}`);
  const showBackups = () => void run(async () => { setBackups(await window.neuralbridge.databaseRecovery.backups()); return null; });
  const restore = (name: string) => void run(async () => {
    const { preservedAs } = await window.neuralbridge.databaseRecovery.restore(name);
    return `Backup restaurado. O arquivo anterior foi guardado em ${preservedAs}. Reiniciando…`;
  });

  const primary = database
    ? database.recovery === 'restore-backup' ? { label: 'Restaurar backup', onClick: showBackups }
      : database.recovery === 'export-diagnostics' ? { label: 'Exportar diagnósticos', onClick: exportDiagnostics }
        : { label: 'Tentar novamente', onClick: retry }
    : undefined;
  const secondary = database
    ? database.recovery === 'export-diagnostics' ? { label: 'Tentar novamente', onClick: retry } : { label: 'Exportar diagnósticos', onClick: exportDiagnostics }
    : undefined;

  return (
    <div className="border-b border-border">
      {database && (
        <OfflineState
          className="rounded-none border-0 px-8 py-3"
          title={REASONS[database.reason]}
          description={<>Memórias e histórico não serão salvos nesta sessão. {ACTIONS[database.recovery]} <span className="mt-1 block font-mono text-[13px] break-all">{database.file}</span></>}
          {...(primary && !busy ? { action: primary } : {})}
          {...(secondary && !busy ? { secondaryAction: secondary } : {})}
        />
      )}
      {database && backups && (
        <section aria-label="Backups disponíveis" className="px-8 pb-3">
          {backups.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum backup encontrado. Exporte os diagnósticos e procure o suporte.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {backups.map((backup) => (
                <li key={backup.name} className="flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1">
                    {dateFormat.format(new Date(backup.createdAt))} · {(backup.sizeBytes / 1024 / 1024).toFixed(1)} MB · {backup.kind}
                    {!backup.valid && <span className="block text-destructive">Não pode ser usado: {backup.problem}</span>}
                  </span>
                  {backup.valid && (confirming === backup.name ? (
                    <span className="flex gap-2">
                      <Button type="button" size="sm" disabled={busy} onClick={() => restore(backup.name)}>Confirmar restauração</Button>
                      <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(null)}>Cancelar</Button>
                    </span>
                  ) : (
                    <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setConfirming(backup.name)}>Restaurar este</Button>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {configuration && (
        <OfflineState
          className="rounded-none border-0 px-8 py-3"
          title="As preferências salvas estavam inválidas."
          description={<>O Singularity usou as configurações padrão. {configuration.preservedAs ? <>Uma cópia do arquivo original foi guardada em <span className="font-mono text-[13px] break-all">{configuration.preservedAs}</span>.</> : 'Não foi possível guardar uma cópia do arquivo original.'} Revise as Configurações.</>}
        />
      )}
      {message && <p role="status" aria-live="polite" className="px-8 pb-3 text-sm break-all">{message}</p>}
    </div>
  );
}
