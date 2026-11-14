import * as React from 'react';
import { Copy, Maximize2, X } from 'lucide-react';
import { m } from 'motion/react';
import type { Suggestion } from '@neuralbridge/shared/neura-state';
import { HUD_MS, HUD_SPRING, type BubblePlacement } from '@/features/companion/companion-motion';
import { neuraError } from './neura-state';
import { playBubbleTick } from './wake-beep';

const ENTRY_SCALE = .92;

/**
 * A suggestion for a call: it has to be read at a glance, so it comes to the mascot instead of waiting in the panel. It stays
 * silent and never takes focus, because the user is talking. Nothing here reaches the meeting.
 */
export function NeuraSuggestionBubble({ suggestion, waiting, placement, reduced, onOpen }: { suggestion: Suggestion; waiting: number; placement: BubblePlacement; reduced: boolean; onOpen: () => void }) {
  const [error, setError] = React.useState<string | null>(null);
  const { suggestionId } = suggestion;
  const fail = (failure: unknown) => setError(neuraError(failure));
  const tail = placement.opens === 'up' ? 'bottom' : 'top';
  return <m.article
    className={`companion-bubble companion-bubble--${placement.opens} companion-bubble--${placement.side}`}
    style={{ [placement.side]: placement.horizontal, [tail]: placement.vertical, originX: placement.side === 'right' ? 1 : 0, originY: placement.opens === 'up' ? 1 : 0 }}
    initial={reduced ? { opacity: 0 } : { opacity: 0, scale: ENTRY_SCALE }}
    animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
    exit={{ opacity: 0, transition: { duration: HUD_MS.micro / 1000 } }}
    transition={reduced ? { duration: HUD_MS.micro / 1000 } : { type: 'spring', ...HUD_SPRING.expand }}
    aria-label="Sugestão de resposta"
    data-hud-hit
    data-hud-scroll
  >
    <p className="companion-bubble__text" role="status">{suggestion.text}</p>
    {error && <p role="alert" className="neura-error">{error}</p>}
    <div className="companion-bubble__actions">
      <button type="button" onClick={() => { void window.neuralbridge.neura.copySuggestion({ suggestionId }).catch(fail); }}><Copy className="size-3.5" aria-hidden="true" /> Copiar</button>
      <button type="button" onClick={onOpen}><Maximize2 className="size-3.5" aria-hidden="true" /> {waiting > 1 ? `Ver todas (${waiting})` : 'Ver tudo'}</button>
      <button type="button" className="companion-bubble__dismiss" onClick={() => { void window.neuralbridge.neura.decideSuggestion({ suggestionId, decision: 'reject' }).catch(fail); }} aria-label="Descartar sugestão" title="Descartar"><X className="size-3.5" aria-hidden="true" /></button>
    </div>
  </m.article>;
}

/** Silence after a question feels like not being heard. It has no actions, so the pointer passes through it. */
export function NeuraThinkingBubble({ label, placement, reduced }: { label: string; placement: BubblePlacement; reduced: boolean }) {
  React.useEffect(playBubbleTick, []);
  const tail = placement.opens === 'up' ? 'bottom' : 'top';
  return <m.div
    className={`companion-bubble companion-bubble--thinking companion-bubble--${placement.opens} companion-bubble--${placement.side}`}
    style={{ [placement.side]: placement.horizontal, [tail]: placement.vertical, originX: placement.side === 'right' ? 1 : 0, originY: placement.opens === 'up' ? 1 : 0 }}
    initial={reduced ? { opacity: 0 } : { opacity: 0, scale: ENTRY_SCALE }}
    animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
    exit={{ opacity: 0, transition: { duration: HUD_MS.micro / 1000 } }}
    transition={reduced ? { duration: HUD_MS.micro / 1000 } : { type: 'spring', ...HUD_SPRING.expand }}
    role="status"
    data-testid="neura-thinking"
  >
    <p className="companion-bubble__text">{label}<span className="companion-bubble__dots" aria-hidden="true"><i /><i /><i /></span></p>
  </m.div>;
}

/** Modo silencioso: the answer a voice request would have spoken, as a comic speech bubble. */
export function NeuraReplyBubble({ text, placement, reduced, onDismiss }: { text: string; placement: BubblePlacement; reduced: boolean; onDismiss: () => void }) {
  React.useEffect(playBubbleTick, []);
  const tail = placement.opens === 'up' ? 'bottom' : 'top';
  return <m.article
    className={`companion-bubble companion-bubble--reply companion-bubble--${placement.opens} companion-bubble--${placement.side}`}
    style={{ [placement.side]: placement.horizontal, [tail]: placement.vertical, originX: placement.side === 'right' ? 1 : 0, originY: placement.opens === 'up' ? 1 : 0 }}
    initial={reduced ? { opacity: 0 } : { opacity: 0, scale: ENTRY_SCALE }}
    animate={reduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
    exit={{ opacity: 0, transition: { duration: HUD_MS.micro / 1000 } }}
    transition={reduced ? { duration: HUD_MS.micro / 1000 } : { type: 'spring', ...HUD_SPRING.expand }}
    aria-label="Resposta do Void"
    data-testid="neura-reply-bubble"
    data-hud-hit
    data-hud-scroll
  >
    <p className="companion-bubble__text" role="status">{text}</p>
    <button type="button" className="companion-bubble__close" onClick={onDismiss} aria-label="Fechar resposta" title="Fechar"><X className="size-3.5" aria-hidden="true" /></button>
  </m.article>;
}

