import * as React from 'react';
import { ExternalLink, MonitorSpeaker, Music2, Pause, Play, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import type { SpotifyControl, SpotifyDevice, SpotifyStatus } from '@neuralbridge/shared/spotify';
import { followsPlayback, HUD_MS } from './companion-motion';
import { SPOTIFY_BLOCKS, SPOTIFY_ERRORS } from './useSpotify';

const FADE = { duration: HUD_MS.content / 1000 };
const SWAP = { duration: HUD_MS.micro / 1000 };
const TEXT_OFFSET_PX = 6;

function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function playbackPosition(playback: NonNullable<SpotifyStatus['playback']>, now: number): number {
  if (!playback.isPlaying) return playback.progressMs;
  return Math.min(playback.durationMs, playback.progressMs + Math.max(0, now - playback.sampledAt));
}

/** Waits for the new cover to decode, so the swap is always from one picture to another and never through a gap. */
function CoverCrossfade({ cover }: { cover: string | null }) {
  const [decoded, setShown] = React.useState(cover);
  const shown = cover ? decoded : null;
  React.useEffect(() => {
    if (!cover) return;
    let disposed = false;
    const image = new Image();
    image.src = cover;
    void image.decode().catch(() => undefined).then(() => { if (!disposed) setShown(cover); });
    return () => { disposed = true; };
  }, [cover]);
  return <span className="companion-player__art">
    <AnimatePresence initial={false}>{shown ? <m.img key={shown} src={shown} alt="" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE} /> : <span key="none" className="companion-player__cover"><Music2 className="size-4" aria-hidden="true" /></span>}</AnimatePresence>
  </span>;
}

const PlaybackProgress = React.memo(function PlaybackProgress({ position, durationMs, isPlaying }: { position: number; durationMs: number; isPlaying: boolean }) {
  const [{ at, glide }, setStep] = React.useState({ at: position, glide: false });
  if (at !== position) setStep({ at: position, glide: followsPlayback(at, position, isPlaying) });
  return <div className="companion-player__bar" role="progressbar" aria-label="Progresso da faixa" aria-valuemin={0} aria-valuemax={durationMs} aria-valuenow={position} aria-valuetext={`${clock(position)} de ${clock(durationMs)}`}><i style={{ transform: `scaleX(${durationMs ? position / durationMs : 0})`, transition: glide ? undefined : 'none' }} /></div>;
});

/** Where the music plays. Asked for on opening: the list is only needed here, and each request counts against the quota. */
function DevicePicker({ current, disabled, onPick }: { current: string | null; disabled: boolean; onPick: (deviceId: string) => void }) {
  const [devices, setDevices] = React.useState<SpotifyDevice[] | null>(null);
  const toggle = () => {
    if (devices) { setDevices(null); return; }
    void window.neuralbridge.spotify.devices().then(setDevices, () => setDevices([]));
  };
  return <div className="companion-player__device">
    <button type="button" onClick={toggle} disabled={disabled} aria-expanded={devices !== null} aria-label={`Dispositivo: ${current ?? 'nenhum'}`} title={current ?? 'Escolher dispositivo'}><MonitorSpeaker className="size-3.5 shrink-0" aria-hidden="true" /><span>{current ?? 'Sem dispositivo'}</span></button>
    {devices && <ul aria-label="Dispositivos" data-hud-scroll>
      {devices.length ? devices.map((device) => <li key={device.id}><button type="button" aria-current={device.isActive} onClick={() => { setDevices(null); onPick(device.id); }}>{device.name}</button></li>) : <li className="companion-muted">Abra o Spotify em algum aparelho, ou toque em Play para abrir neste PC.</li>}
    </ul>}
  </div>;
}

/** Uncontrolled, because a poll must not move the thumb under a finger; it follows the real volume between gestures. */
function VolumeSlider({ volume, disabled, title, onChange }: { volume: number; disabled: boolean; title: string; onChange: (volume: number) => void }) {
  const input = React.useRef<HTMLInputElement>(null);
  const held = React.useRef(false);
  React.useEffect(() => { if (input.current && !held.current) input.current.value = String(volume); }, [volume]);
  return <label className="companion-player__volume" title={title}><Volume2 className="size-3.5 shrink-0" aria-hidden="true" /><input ref={input} type="range" min={0} max={100} defaultValue={volume} disabled={disabled} aria-label="Volume" onPointerDown={() => { held.current = true; }} onPointerUp={(event) => { held.current = false; onChange(Number(event.currentTarget.value)); }} onPointerCancel={() => { held.current = false; }} onKeyUp={(event) => onChange(Number(event.currentTarget.value))} /></label>;
}

export function SpotifyPlayer({ status, now }: { status: SpotifyStatus; now: number }) {
  const { playback, controlBlock, error } = status;
  const send = (control: SpotifyControl) => void window.neuralbridge.spotify.control(control);
  const message = error ? SPOTIFY_ERRORS[error] : null;
  if (!playback) return <section className="companion-player companion-player--empty" aria-label="Spotify"><Music2 className="size-4 shrink-0" aria-hidden="true" /><span role="status">{message ?? 'Nada tocando no Spotify'}</span></section>;

  const position = playbackPosition(playback, now);
  const reason = controlBlock ? SPOTIFY_BLOCKS[controlBlock] : null;
  const unavailable = (allowed: boolean, label: string) => reason ?? (allowed ? label : 'Indisponível neste momento');
  const canToggle = playback.isPlaying ? playback.canPause : playback.canResume;
  return <section className="companion-player" aria-label="Spotify">
    <div className="companion-player__track">
      <CoverCrossfade cover={playback.cover} />
      <AnimatePresence mode="wait" initial={false}><m.div key={playback.trackId ?? playback.title} className="min-w-0" initial={{ opacity: 0, y: TEXT_OFFSET_PX }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -TEXT_OFFSET_PX }} transition={SWAP}><strong title={playback.title}>{playback.title}</strong><span title={playback.artists}>{playback.artists || 'Artista desconhecido'}</span></m.div></AnimatePresence>
      {playback.hasLink && <button type="button" onClick={() => void window.neuralbridge.spotify.openTrack()} aria-label="Abrir no Spotify" title="Abrir no Spotify"><ExternalLink className="size-3.5" aria-hidden="true" /></button>}
    </div>
    <PlaybackProgress position={position} durationMs={playback.durationMs} isPlaying={playback.isPlaying} />
    <div className="companion-player__meta"><time>{clock(position)}</time><DevicePicker current={playback.device} disabled={reason !== null} onPick={(deviceId) => send({ action: 'transfer', deviceId })} /><time>{clock(playback.durationMs)}</time></div>
    <div className="companion-player__controls">
      <button type="button" disabled={reason !== null || !playback.canPrevious} onClick={() => send({ action: 'previous' })} aria-label="Faixa anterior" title={unavailable(playback.canPrevious, 'Faixa anterior')}><SkipBack className="size-4" aria-hidden="true" /></button>
      <button type="button" disabled={reason !== null || !canToggle} onClick={() => send({ action: playback.isPlaying ? 'pause' : 'play' })} aria-label={playback.isPlaying ? 'Pausar' : 'Tocar'} title={unavailable(canToggle, playback.isPlaying ? 'Pausar' : 'Tocar')}><AnimatePresence mode="wait" initial={false}><m.span key={playback.isPlaying ? 'pause' : 'play'} className="grid" initial={{ opacity: 0, scale: .8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: .8 }} transition={{ duration: SWAP.duration / 2 }}>{playback.isPlaying ? <Pause className="size-4" aria-hidden="true" /> : <Play className="size-4" aria-hidden="true" />}</m.span></AnimatePresence></button>
      <button type="button" disabled={reason !== null || !playback.canNext} onClick={() => send({ action: 'next' })} aria-label="Próxima faixa" title={unavailable(playback.canNext, 'Próxima faixa')}><SkipForward className="size-4" aria-hidden="true" /></button>
      {playback.volume !== null && <VolumeSlider volume={playback.volume} disabled={reason !== null} title={reason ?? 'Volume'} onChange={(volume) => send({ action: 'volume', volume })} />}
    </div>
    {(reason || message) && <p className="companion-player__note" role="status">{message ?? reason}</p>}
  </section>;
}
