import { useCallback, useEffect, useState } from 'react';
import type { CoreDevice, CorePairingOffer, CorePendingPairing, CoreRemoteStatus, CoreRuntime } from '@neuralbridge/shared/core-desktop';

/*
 * CORE-07: remote access and paired devices. Remote access is off by default and goes only through Tailscale serve
 * (inside the user's tailnet); pairing needs a confirmation here; revoking is immediate. No token reaches this screen.
 */

const REMOTE_STATE: Record<CoreRemoteStatus['state'], string> = {
  'not-installed': 'Tailscale não encontrado neste computador.',
  'logged-out': 'Entre na sua conta do Tailscale para usar o acesso remoto.',
  stopped: 'Tailscale parado.',
  ready: 'Tailscale pronto.',
  blocked: 'Bloqueado: o Funnel do Tailscale está ligado, e o Singularity não aceita exposição pública.',
  unavailable: 'O Singularity Core não está em execução.',
};

const BASE_GRANT = { scopes: ['read', 'chat'] as const, projects: { projects: 'all' as const, includePrivate: false } };
const fmt = (value: string | null) => (value ? new Date(value).toLocaleString('pt-BR') : 'nunca');

export function DevicesSettingsSection() {
  const core = window.neuralbridge.core;
  const [status, setStatus] = useState<CoreRemoteStatus | null>(null);
  const [runtime, setRuntime] = useState<CoreRuntime | null>(null);
  const [devices, setDevices] = useState<CoreDevice[]>([]);
  const [pending, setPending] = useState<CorePendingPairing[]>([]);
  const [offer, setOffer] = useState<CorePairingOffer | null>(null);
  const [allowTasks, setAllowTasks] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const next = await core.status().catch(() => null);
    setStatus(next);
    setRuntime(await core.runtime().catch(() => null));
    if (next?.supervisor === 'running') {
      setDevices(await core.devices().catch(() => []));
      setPending(await core.pairings().catch(() => []));
    }
  }, [core]);

  useEffect(() => {
    const first = setTimeout(() => void refresh(), 0);
    // While a code is on screen, poll for the phone's claim so the confirmation appears on its own.
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, offer ? 2_000 : 15_000);
    return () => { clearTimeout(first); clearInterval(timer); };
  }, [refresh, offer]);

  const run = async (work: () => Promise<unknown>) => {
    setError(null);
    try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '').replace(/^[a-z_]+: /, '') : 'Não foi possível concluir.'); }
    await refresh();
  };

  if (!status) return null;
  const active = devices.filter((device) => !device.revokedAt);

  return (
    <section aria-labelledby="devices-heading" data-testid="core-devices">
      <h2 id="devices-heading" className="text-base font-medium">Dispositivos e acesso remoto</h2>
      <p className="mt-1 text-muted-foreground">Use o Singularity pelo celular de forma privada, pela sua rede Tailscale. Nada fica exposto na internet ou na rede local.</p>

      <div className="mt-4 space-y-3">
        <div className="px-3" data-testid="core-runtime">
          <h3 className="font-medium">Singularity Core</h3>
          <p className="mt-1 text-muted-foreground" role="status">
            {runtime?.mode ? `${runtime.mode === 'standalone' ? 'Independente (continua com a janela fechada)' : 'Junto com a janela'} · ${runtime.tasksRunning ?? 0} tarefa(s) em execução · ${Math.round((runtime.memoryBytes ?? 0) / 1048576)} MB · ativo há ${Math.round((runtime.uptimeMs ?? 0) / 60_000)} min` : 'O Core não está em execução; as tarefas rodam no aplicativo.'}
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 hover:bg-accent">
          <input type="checkbox" checked={runtime?.standaloneEnabled ?? false} disabled={!runtime} onChange={(event) => { const enabled = event.target.checked; void run(() => core.setStandalone(enabled)); }} />
          <span className="font-medium">Manter o Singularity Core ativo com a janela fechada (inicia ao entrar no Windows)</span>
        </label>
        <p className="px-3 text-muted-foreground">Usa uma tarefa agendada só do seu usuário, sem privilégios de administrador. Desligar remove a tarefa e o Core volta a rodar só com a janela.</p>
        <label className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 hover:bg-accent">
          <input type="checkbox" checked={status.enabled} disabled={status.supervisor !== 'running' || (!status.enabled && status.state !== 'ready')} onChange={(event) => { const enabled = event.target.checked; void run(() => core.setRemote(enabled)); }} />
          <span className="font-medium">Permitir acesso remoto pelo Tailscale</span>
        </label>
        <p className="px-3 text-muted-foreground" role="status">
          {REMOTE_STATE[status.state]}
          {status.state === 'ready' && status.hostname ? ` Endereço: ${status.hostname}${status.serving ? ' (publicado na sua rede Tailscale)' : ''}.` : ''}
          {status.detail && status.state !== 'ready' ? ` ${status.detail}` : ''}
        </p>
        {status.state === 'not-installed' && <p className="px-3 text-muted-foreground">Instale o Tailscale pelo site oficial, entre na sua conta e volte aqui. O Singularity não instala nada por você.</p>}

        <div className="space-y-2 px-3">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={allowTasks} onChange={(event) => setAllowTasks(event.target.checked)} />
            <span>Permitir que o aparelho crie e cancele tarefas (somente leitura por padrão)</span>
          </label>
          <button type="button" className="rounded-md border px-3 py-1.5 hover:bg-accent disabled:opacity-50" disabled={!status.serving} onClick={() => void run(async () => setOffer(await core.startPairing({ scopes: [...BASE_GRANT.scopes, ...(allowTasks ? (['task:create', 'task:cancel'] as const) : [])], projects: BASE_GRANT.projects })))}>
            Parear um aparelho
          </button>
          {!status.serving && <p className="text-muted-foreground">Ative o acesso remoto para parear.</p>}
        </div>

        {offer && (
          <div className="mx-3 space-y-1 rounded-md border p-3" data-testid="core-pairing-offer">
            <p>No app Singularity do celular, digite o código e confira a impressão digital:</p>
            <p className="font-mono text-2xl tracking-widest select-all">{offer.code}</p>
            <p className="text-muted-foreground">Endereço: <span className="font-mono">{offer.endpoint}</span> · válido até {new Date(offer.expiresAt).toLocaleTimeString('pt-BR')}</p>
            <p className="text-muted-foreground">Impressão digital: <span className="font-mono">{offer.fingerprint.slice(0, 16).match(/.{4}/g)?.join(' ')}</span></p>
            <button type="button" className="rounded-md px-2 py-1 hover:bg-accent" onClick={() => setOffer(null)}>Fechar</button>
          </div>
        )}

        {pending.map((request) => (
          <div key={request.pairingId} className="mx-3 flex flex-wrap items-center gap-2 rounded-md border p-3" role="alert">
            <span className="flex-1">Parear {request.platform === 'ios' ? 'o iPhone' : 'o Android'} “{request.deviceName}” (app {request.appVersion})?</span>
            <button type="button" className="rounded-md border px-3 py-1.5 hover:bg-accent" onClick={() => void run(async () => { await core.decidePairing(request.pairingId, 'approve'); setOffer(null); })}>Parear</button>
            <button type="button" className="rounded-md px-3 py-1.5 hover:bg-accent" onClick={() => void run(() => core.decidePairing(request.pairingId, 'reject'))}>Recusar</button>
          </div>
        ))}

        <div className="px-3">
          <h3 className="font-medium">Aparelhos pareados</h3>
          {active.length === 0 ? <p className="mt-1 text-muted-foreground">Nenhum aparelho pareado.</p> : (
            <ul className="mt-2 space-y-2">
              {active.map((device) => (
                <li key={device.id} className="flex flex-wrap items-center gap-2 rounded-md border p-3">
                  <span className="flex-1"><span className="font-medium">{device.name}</span> · {device.platform} · último acesso: {fmt(device.lastSeenAt)} · {device.grant.scopes.join(', ')}</span>
                  <button type="button" className="rounded-md border px-3 py-1.5 hover:bg-accent" onClick={() => void run(() => core.revoke({ target: 'device', deviceId: device.id }))}>Revogar</button>
                </li>
              ))}
            </ul>
          )}
          {active.length > 1 && <button type="button" className="mt-2 rounded-md border px-3 py-1.5 hover:bg-accent" onClick={() => void run(() => core.revoke({ target: 'all' }))}>Revogar todos</button>}
        </div>
        {error && <p className="px-3 text-destructive" role="alert">{error}</p>}
      </div>
    </section>
  );
}
