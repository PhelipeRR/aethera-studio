import * as React from 'react';
import type { SpotifyControlBlock, SpotifyErrorCode, SpotifyStatus } from '@neuralbridge/shared/spotify';

export const SPOTIFY_ERRORS: Record<SpotifyErrorCode, string> = {
  auth_denied: 'A autorização foi recusada no Spotify.',
  auth_invalid: 'O Spotify recusou a autorização. Confira o Client ID e a redirect URI.',
  auth_timeout: 'A autorização foi cancelada ou expirou.',
  port_in_use: 'Outro programa está usando a porta do retorno do Spotify.',
  revoked: 'A conexão foi revogada. Conecte novamente.',
  forbidden: 'O Spotify recusou o acesso para esta conta.',
  premium_required: 'Este controle exige Spotify Premium.',
  no_device: 'Nenhum dispositivo ativo no Spotify.',
  rate_limited: 'Limite de requisições atingido. Tentando de novo em instantes.',
  quota_exceeded: 'Cota do app no Spotify esgotada. Tentando de novo mais tarde.',
  network: 'Não foi possível falar com o Spotify.',
  unknown: 'O Spotify devolveu um erro inesperado.',
};

export const SPOTIFY_BLOCKS: Record<SpotifyControlBlock, string> = {
  disabled: 'Controles desligados em Configurações',
  reauthorize: 'Conecte de novo para autorizar os controles',
  no_device: 'Nenhum dispositivo ativo',
  restricted: 'Este dispositivo não aceita controle remoto',
};

/** Pushed by the main process; the renderer never talks to Spotify and never sees a token. */
export function useSpotify(): SpotifyStatus | null {
  const [status, setStatus] = React.useState<SpotifyStatus | null>(null);
  React.useEffect(() => {
    let disposed = false;
    const stop = window.neuralbridge.spotify.onChange(setStatus);
    void window.neuralbridge.spotify.status().then((value) => { if (!disposed) setStatus(value); }).catch(() => undefined);
    return () => { disposed = true; stop(); };
  }, []);
  return status;
}
