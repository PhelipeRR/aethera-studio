import * as React from 'react';
import { Send } from 'lucide-react';
import type { NeuraState } from '@neuralbridge/shared/neura-state';
import { neuraError } from './neura-state';

/** Always at hand on the main panel: talking to Neura takes neither a project nor another screen. */
export function NeuraChat({ state }: { state: NeuraState }) {
  const [text, setText] = React.useState('');
  const [asked, setAsked] = React.useState<string | null>(null);
  const [waiting, setWaiting] = React.useState(false);
  const [baselineCorrelation, setBaselineCorrelation] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const freshResponse = asked && state.lastResponse?.correlationId !== baselineCorrelation ? state.lastResponse : null;
  // Progress events arrive through the same state channel while the TaskEngine
  // is still running. Do not hide those events behind a permanent “Pensando”.
  // A voice request answered in silent mode has no bubble while the panel is open, so its answer shows here too.
  const voiceAnswer = state.lastResponse?.speak && state.lastResponse.correlationId !== baselineCorrelation ? state.lastResponse : null;
  const reply = waiting ? (freshResponse?.message ?? 'Pensando…') : error ?? (asked || voiceAnswer ? state.lastResponse?.message ?? null : null);
  const shownAsk = voiceAnswer && !waiting ? 'Por voz' : asked;
  const timing = !waiting && asked ? state.lastResponse?.timing : undefined;
  const measured = timing ? `${reply ?? ''} (primeiro texto: ${timing.firstTextMs ?? '—'} ms; total: ${timing.totalMs} ms)` : reply ?? undefined;
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const value = text.trim();
    if (!value || waiting) return;
    setText('');
    setAsked(value);
    setBaselineCorrelation(state.lastResponse?.correlationId ?? null);
    setError(null);
    setWaiting(true);
    void window.neuralbridge.neura.input({ text: value }).catch((failure: unknown) => setError(neuraError(failure))).finally(() => setWaiting(false));
  };
  return <section className="companion-chat" aria-label="Conversar com o Void">
    <p className="companion-chat__context">Conversa geral • sem projeto obrigatório</p>
    {shownAsk && reply && <p className="companion-chat__reply" role="status" data-testid="neura-chat-reply" data-hud-scroll title={measured}><span>{shownAsk}</span>{reply}</p>}
    <form onSubmit={submit}>
      <input aria-label="Falar com o Void" value={text} maxLength={4_000} disabled={state.paused} placeholder={state.paused ? 'Void pausado' : 'Fale com o Void…'} onChange={(event) => setText(event.target.value)} />
      <button type="submit" aria-label="Enviar para o Void" disabled={state.paused || waiting || !text.trim()}><Send className="size-4" aria-hidden="true" /></button>
    </form>
  </section>;
}
