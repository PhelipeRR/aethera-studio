import * as React from 'react';
import { Check, Copy, Pencil, Volume2, X } from 'lucide-react';
import type { Suggestion, SuggestionDecision } from '@neuralbridge/shared/neura-state';
import { languageBadge, neuraError } from './neura-state';
import { speak } from './useNeura';

/** Every action stays on the user's side: this card can copy or say the text, and nothing here reaches the meeting. */
export function NeuraSuggestionCard({ suggestion }: { suggestion: Suggestion }) {
  const [draft, setDraft] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const decide = (input: SuggestionDecision) => window.neuralbridge.neura.decideSuggestion(input).then(() => setError(null), (failure: unknown) => setError(neuraError(failure)));
  const { suggestionId } = suggestion;
  return <article className="neura-suggestion" aria-label="Sugestão de resposta">
    <header><span className="companion-pill">{languageBadge(suggestion)}</span><span className="companion-muted">{Math.round(suggestion.confidence * 100)}% de confiança</span></header>
    <blockquote title={suggestion.sourceExcerpt}>{suggestion.sourceExcerpt}</blockquote>
    {draft === null ? <p className="neura-suggestion__text" data-hud-scroll>{suggestion.text}</p> : <textarea aria-label="Editar sugestão" value={draft} maxLength={4_000} onChange={(event) => setDraft(event.target.value)} />}
    {suggestion.translation && <p className="companion-muted">{suggestion.translation}</p>}
    {error && <p role="alert" className="neura-error">{error}</p>}
    <div className="neura-actions">
      {draft === null ? <>
        <button type="button" onClick={() => void decide({ suggestionId, decision: 'accept' })}><Check className="size-4" aria-hidden="true" /> Aceitar</button>
        <button type="button" onClick={() => setDraft(suggestion.text)}><Pencil className="size-4" aria-hidden="true" /> Editar</button>
        <button type="button" onClick={() => void navigator.clipboard.writeText(suggestion.text).then(() => decide({ suggestionId, decision: 'copy' }))}><Copy className="size-4" aria-hidden="true" /> Copiar</button>
        <button type="button" onClick={() => { speak(suggestion.text, suggestion.decision.responseLanguage); void decide({ suggestionId, decision: 'speak' }); }}><Volume2 className="size-4" aria-hidden="true" /> Falar</button>
        <button type="button" onClick={() => void decide({ suggestionId, decision: 'reject' })} aria-label="Descartar sugestão"><X className="size-4" aria-hidden="true" /></button>
      </> : <>
        <button type="button" disabled={!draft.trim()} onClick={() => { void decide({ suggestionId, decision: 'edit', text: draft }); setDraft(null); }}>Salvar edição</button>
        <button type="button" onClick={() => setDraft(null)}>Cancelar</button>
      </>}
    </div>
  </article>;
}
