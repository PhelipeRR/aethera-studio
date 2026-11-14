import type { MeetingSession } from '@neuralbridge/shared';
import { MANUAL_TRANSCRIPT_SOURCE_ID } from './manual-transcript-source.js';

/** A clause after a comma is a statement that happens to open like a question: "quando eu cheguei, ...". */
const OPENS_A_QUESTION = /^(e\s+)?(quando|qual|quais|quem|onde|como|quanto|quantos|quantas|por\s*que|porque|o\s+que|what|when|where|who|why|how|which|can|could|would|will|should|do|does|did|is|are|pode|poderia|consegue|conseguiria|tem\s+como)\s/;
const ASKS_THE_LISTENER = /(^|[\s,])((você|vc|tu|vocês)\s+(pode|podem|poderia|consegue|conseguem|conseguiria|acha|acham|concorda|sabe|sabem|tem|têm|revise|revisa|mande|manda|envie|olhe)|me\s+(diz|diga|fala|fale|manda|mande|envia|envie|explica|explique|ajuda|ajude)|(can|could|would|will|do|did|are)\s+you)(\s|[.,!]|$)/;

/**
 * Cheap and local, because each draft costs a model run and a call never stops talking. It leans towards yes: a missed
 * question costs the user an answer, and a false alarm costs one draft.
 */
export function needsReply(text: string): boolean {
  const said = text.normalize('NFC').trim().toLowerCase();
  if (!/\p{L}/u.test(said)) return false;
  if (said.endsWith('?')) return true;
  if (ASKS_THE_LISTENER.test(said)) return true;
  return OPENS_A_QUESTION.test(said) && !said.includes(',');
}

/** What the user pasted is a request in itself. Only what was picked up on its own has to earn a draft. */
export function shouldDraft(session: Pick<MeetingSession, 'sourceId'> | null, text: string): boolean {
  return session?.sourceId === MANUAL_TRANSCRIPT_SOURCE_ID || needsReply(text);
}
