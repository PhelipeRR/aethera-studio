import { useState } from 'react';
import { SPOTIFY_REDIRECT_URI, spotifyClientIdSchema } from '@neuralbridge/shared/spotify';
import { SPOTIFY_ERRORS, useSpotify } from './useSpotify';

const CONNECTION_LABELS = { disabled: 'Desligado', unconfigured: 'Falta o Client ID', disconnected: 'Desconectado', connecting: 'Aguardando autorização no navegador', connected: 'Conectado' };

/** Optional integration: off by default, and with no network activity until it is on and connected. */
export function SpotifySettingsSection() {
  const status = useSpotify();
  const [draft, setDraft] = useState<string | null>(null);
  if (!status) return null;
  const { spotify } = window.neuralbridge;
  const clientId = draft ?? status.clientId ?? '';
  const valid = spotifyClientIdSchema.safeParse(clientId.trim()).success;
  const enabled = status.connection !== 'disabled';
  const changed = clientId.trim() !== (status.clientId ?? '');

  return (
    <section aria-labelledby="spotify-heading">
      <h2 id="spotify-heading" className="text-base font-medium">
        Spotify
      </h2>
      <p className="mt-1 text-muted-foreground">Mostra no Companion o que está tocando. Opcional, e o Singularity não reproduz áudio.</p>
      <div className="mt-4 space-y-3">
        <label className="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 hover:bg-accent">
          <input type="checkbox" checked={enabled} onChange={(event) => void spotify.configure({ enabled: event.target.checked })} />
          <span className="font-medium">Ativar integração com o Spotify</span>
        </label>
        {enabled && (
          <div className="space-y-3 px-3">
            <div>
              <label htmlFor="spotify-client-id" className="font-medium">Client ID</label>
              <div className="mt-1 flex gap-2">
                <input id="spotify-client-id" className="min-w-0 flex-1 rounded-md border bg-transparent px-3 py-1.5 font-mono text-sm" value={clientId} spellCheck={false} autoComplete="off" onChange={(event) => setDraft(event.target.value)} aria-invalid={clientId !== '' && !valid} />
                <button type="button" className="rounded-md border px-3 py-1.5 hover:bg-accent disabled:opacity-50" disabled={!valid || !changed} onClick={() => { void spotify.configure({ clientId: clientId.trim() }); setDraft(null); }}>Salvar</button>
              </div>
              {clientId !== '' && !valid && <p className="mt-1 text-destructive">O Client ID tem 32 caracteres hexadecimais.</p>}
            </div>
            <p className="text-muted-foreground">
              Crie um app em developer.spotify.com, marque a Web API e registre esta redirect URI: <code className="font-mono select-all">{SPOTIFY_REDIRECT_URI}</code>. Não use Client Secret. O dono de um app em modo de desenvolvimento precisa de Spotify Premium.
            </p>
            <label className="flex cursor-pointer items-center gap-3">
              <input type="checkbox" checked={status.controlsEnabled} onChange={(event) => void spotify.configure({ controlsEnabled: event.target.checked })} />
              <span>Permitir controlar a reprodução pelo Companion</span>
            </label>
            {status.controlBlock === 'reauthorize' && status.connection === 'connected' && <p className="text-muted-foreground">Conecte novamente para autorizar os controles.</p>}
            <div className="flex flex-wrap items-center gap-2">
              {status.connection === 'connecting' ? (
                <button type="button" className="rounded-md border px-3 py-1.5 hover:bg-accent" onClick={() => void spotify.cancelConnect()}>Cancelar</button>
              ) : (
                <button type="button" className="rounded-md border px-3 py-1.5 hover:bg-accent disabled:opacity-50" disabled={status.connection === 'unconfigured'} onClick={() => void spotify.connect()}>{status.connection === 'connected' ? 'Conectar novamente' : 'Conectar'}</button>
              )}
              {status.connection === 'connected' && <button type="button" className="rounded-md border px-3 py-1.5 hover:bg-accent" onClick={() => void spotify.disconnect()}>Desconectar</button>}
              <span role="status" className="text-muted-foreground">{CONNECTION_LABELS[status.connection]}</span>
            </div>
            {status.error && <p role="alert" className="text-destructive">{SPOTIFY_ERRORS[status.error]}</p>}
            {status.connection === 'connected' && !status.persistent && <p className="text-muted-foreground">Este sistema não oferece armazenamento seguro; a conexão dura até fechar o app.</p>}
          </div>
        )}
      </div>
    </section>
  );
}
