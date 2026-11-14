import { CirclePause, Mic, MicOff, Play } from 'lucide-react';
import type { NeuraSettings, NeuraState } from '@neuralbridge/shared/neura-state';
import { neuraActivity } from './neura-state';

const LABELS = { off: 'Desligada', paused: 'Pausada', meeting: 'Acompanhando reunião', listening: 'Ouvindo “Neura”', idle: 'Em espera' };

function Provider({ label, status }: { label: string; status: NeuraState['providers']['voice'] }) {
  return <li title={status.detail}><span className={`companion-dot companion-dot--${status.available ? 'live' : 'off'}`} aria-hidden="true" />{label}: {status.available ? 'pronto' : 'indisponível'}<span className="sr-only">. {status.detail}</span></li>;
}

export function NeuraVoiceState({ state, settings, onError, compact = false }: { state: NeuraState; settings: NeuraSettings | null; onError: (error: unknown) => void; compact?: boolean }) {
  const { neura } = window.neuralbridge;
  const activity = neuraActivity(state);
  // Keep the retry action enabled while the provider is unavailable: starting
  // it performs a fresh probe and reports the actionable failure in the HUD.
  const canListen = settings?.voiceConsent === true && !state.paused;
  // The worker is optional, so only voice and agent count as a problem worth a word in the header.
  const trouble = !state.providers.voice.available ? { label: 'Voz', detail: state.providers.voice.detail } : !state.providers.model.available ? { label: 'Agente', detail: state.providers.model.detail } : null;
  const toggleVoice = () => {
    const action = state.voice ? neura.stopVoice({ sessionId: state.voice.sessionId }) : neura.startVoice({ consent: true, preferredLanguage: settings?.preferredLanguage ?? 'pt-BR' });
    action.catch(onError);
  };
  return <section className={`companion-card neura-status${compact ? ' neura-status--compact' : ''}`} aria-labelledby={compact ? undefined : 'neura-status-title'}>
    <div className="neura-status__title">
      <h2 id={compact ? undefined : 'neura-status-title'}>{compact ? 'Void' : 'Estado da voz'}</h2>
      <p role="status" data-testid={compact ? 'neura-activity' : undefined}>{LABELS[activity]}{compact && trouble ? <span className="neura-status__trouble" title={trouble.detail}> • {trouble.label} indisponível</span> : null}</p>
    </div>
    {compact && <button type="button" className="neura-control" disabled={!canListen && !state.voice} onClick={toggleVoice} aria-pressed={state.voice !== null}>{state.voice ? <MicOff className="size-4" aria-hidden="true" /> : <Mic className="size-4" aria-hidden="true" />}{state.voice ? 'Parar de ouvir' : 'Ouvir'}</button>}
    {compact && (state.paused
      ? <button type="button" className="neura-control" onClick={() => void neura.resume().catch(onError)}><Play className="size-4" aria-hidden="true" /> Retomar</button>
      : <button type="button" className="neura-control neura-control--stop" aria-label="Pausar tudo" onClick={() => void neura.pauseAll().catch(onError)}><CirclePause className="size-4" aria-hidden="true" /> Pausar</button>)}
    {/* The compact header is one row; the details live in the Neura tab, where there is room for them. */}
    {!compact && <>
      <p className="neura-voice-detail" data-testid="neura-voice-detail">{state.providers.voice.detail}</p>
      <ul>
        <Provider label="Voz" status={state.providers.voice} />
        <Provider label="Agente" status={state.providers.model} />
        <Provider label="Worker" status={state.providers.worker} />
      </ul>
    </>}
  </section>;
}
