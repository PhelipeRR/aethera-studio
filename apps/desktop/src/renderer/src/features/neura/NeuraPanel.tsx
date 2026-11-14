import * as React from 'react';
import { Headphones, Send, Square, Users } from 'lucide-react';
import type { NeuraSettings, NeuraState } from '@neuralbridge/shared/neura-state';
import { neuraError } from './neura-state';
import { NeuraSuggestionCard } from './NeuraSuggestionCard';
import { NeuraVoiceState } from './NeuraVoiceState';

const MANUAL_SOURCE = 'manual-transcript';
const SYSTEM_AUDIO_SOURCE = 'system-audio';
type NeuraTab = 'assistant' | 'suggestions' | 'neura';

export function NeuraPanel({ state }: { state: NeuraState }) {
  const { neura } = window.neuralbridge;
  const [activeTab, setActiveTab] = React.useState<NeuraTab>('assistant');
  const [settings, setSettings] = React.useState<NeuraSettings | null>(null);
  const [text, setText] = React.useState('');
  const [transcript, setTranscript] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const fail = React.useCallback((failure: unknown) => setError(neuraError(failure)), []);
  React.useEffect(() => { void neura.settings().then(setSettings).catch(fail); }, [neura, fail, state.enabled, state.providers.model.detail]);
  const response = state.lastResponse;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value) return;
    setError(null);
    setText('');
    neura.input({ text: value }).catch(fail);
  };
  const addTranscript = (event: React.FormEvent) => {
    event.preventDefault();
    const value = transcript.trim();
    if (!value || !state.meeting) return;
    setError(null);
    setTranscript('');
    neura.addMeetingTranscript({ sessionId: state.meeting.sessionId, speaker: null, text: value }).catch(fail);
  };
  const hearing = state.meeting?.capabilities.audio === true;
  const startMeeting = (sourceId: string) => {
    setError(null);
    neura.startMeeting({ sourceId, platform: 'generic', consent: true, userPreferredLanguage: settings?.preferredLanguage ?? 'pt-BR', translationEnabled: settings?.translationEnabled ?? false }).catch(fail);
  };

  const tabs: readonly { id: NeuraTab; label: string; count?: number }[] = [
    { id: 'assistant', label: 'Assistente' },
    { id: 'suggestions', label: 'Sugestões', count: state.suggestions.length + state.pendingActions.length },
    { id: 'neura', label: 'Void' },
  ];
  const panelId = `neura-panel-${activeTab}`;

  return <div className="neura-panel">
    <NeuraVoiceState state={state} settings={settings} onError={fail} compact />
    {state.pendingActions.length > 0 && <div className="neura-approvals" aria-label="Ações que aguardam confirmação">
      {state.pendingActions.map((action) => <div key={action.actionId} className="neura-approval" role="group" aria-label="Confirmar ação">
        <span>{action.summary}?</span>
        <div className="neura-actions">
          <button type="button" onClick={() => void neura.decideAction({ actionId: action.actionId, decision: 'allow' }).catch(fail)}>Permitir</button>
          <button type="button" onClick={() => void neura.decideAction({ actionId: action.actionId, decision: 'deny' }).catch(fail)}>Negar</button>
        </div>
      </div>)}
    </div>}
    <div className="neura-tabs" role="tablist" aria-label="Seções do Void">
      {tabs.map((tab) => <button key={tab.id} id={`neura-tab-${tab.id}`} type="button" role="tab" aria-label={tab.label} aria-selected={activeTab === tab.id} aria-controls={`neura-panel-${tab.id}`} className="neura-tab" onClick={() => setActiveTab(tab.id)}>
        {tab.label}{tab.count ? <span className="neura-tab__count" aria-label={`${tab.count} pendente(s)`}>{tab.count}</span> : null}
      </button>)}
    </div>
    <div className="neura-tab-content" data-hud-scroll>
      {activeTab === 'neura' && <section id={panelId} className="neura-tab-panel" role="tabpanel" tabIndex={0} aria-labelledby="neura-tab-neura"><NeuraVoiceState state={state} settings={settings} onError={fail} /></section>}
      {activeTab === 'suggestions' && <section id={panelId} className="companion-card neura-feed neura-tab-panel" role="tabpanel" tabIndex={0} aria-labelledby="neura-tab-suggestions">
        <h2 id="neura-feed-title">Sugestões</h2>
        <div className="neura-feed__list" data-hud-scroll>
          {state.suggestions.map((suggestion) => <NeuraSuggestionCard key={suggestion.suggestionId} suggestion={suggestion} />)}
          {!state.suggestions.length && !state.pendingActions.length && <p className="companion-muted">{state.drafting ? 'Preparando uma sugestão…' : hearing ? 'Ouvindo a call. As sugestões aparecem aqui e no balão.' : state.meeting ? 'Cole um trecho da reunião para receber uma sugestão.' : 'Nada pendente.'}</p>}
        </div>
      </section>}
      {activeTab === 'assistant' && <section id={panelId} className="companion-card neura-input neura-tab-panel" role="tabpanel" tabIndex={0} aria-labelledby="neura-tab-assistant">
        <h2 id="neura-input-title">Pedir ao Void</h2>
        <p className="neura-context" data-testid="neura-context">Conversa geral • {settings?.projectId ? 'projeto selecionado como contexto adicional' : 'sem projeto obrigatório'}</p>
        <form onSubmit={submit}>
          <input aria-label="Mensagem para o Void" value={text} maxLength={4_000} disabled={state.paused} placeholder="Próxima música, abre o Teams…" onChange={(event) => setText(event.target.value)} />
          <button type="submit" aria-label="Enviar" disabled={state.paused || !text.trim()}><Send className="size-4" aria-hidden="true" /></button>
        </form>
        <p className="neura-response" role="status" data-testid="neura-response">{error ?? response?.message ?? ''}</p>
        {state.meeting ? <form className="neura-meeting" onSubmit={addTranscript}>
          {!hearing && <textarea aria-label="Trecho da reunião" value={transcript} placeholder="Cole aqui a legenda ou a fala" onChange={(event) => setTranscript(event.target.value)} />}
          <div className="neura-actions">
            {!hearing && <button type="submit" disabled={!transcript.trim()}>Sugerir resposta</button>}
            <button type="button" onClick={() => { if (state.meeting) neura.stopMeeting({ sessionId: state.meeting.sessionId }).catch(fail); }}><Square className="size-3.5" aria-hidden="true" /> Encerrar</button>
          </div>
        </form> : <div className="neura-meeting-start">
          <button type="button" className="neura-control" disabled={state.paused || settings?.meetingConsent !== true || settings.meetingAudioConsent !== true} onClick={() => startMeeting(SYSTEM_AUDIO_SOURCE)} title={settings?.meetingAudioConsent ? undefined : 'Autorize em Configurações'}><Headphones className="size-4" aria-hidden="true" /> Ouvir a call</button>
          <button type="button" className="neura-control" disabled={state.paused || settings?.meetingConsent !== true} onClick={() => startMeeting(MANUAL_SOURCE)}><Users className="size-4" aria-hidden="true" /> Acompanhar reunião</button>
        </div>}
      </section>}
    </div>
  </div>;
}
