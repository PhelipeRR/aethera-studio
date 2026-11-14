const CLEAR_CONFIDENCE = .9;
const LEANING_CONFIDENCE = .8;

const ENGLISH = new Set(['a', 'about', 'all', 'an', 'and', 'any', 'are', 'at', 'be', 'by', 'can', 'could', 'did', 'do', 'does', 'for', 'from', 'have', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'our', 'should', 'that', 'the', 'this', 'to', 'today', 'update', 'we', 'what', 'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your']);
const PORTUGUESE = new Set(['a', 'ao', 'as', 'com', 'como', 'consegue', 'da', 'de', 'do', 'e', 'é', 'ela', 'ele', 'em', 'essa', 'esse', 'está', 'eu', 'fica', 'hoje', 'isso', 'já', 'mais', 'me', 'meu', 'na', 'nesse', 'no', 'nós', 'o', 'onde', 'os', 'ou', 'para', 'pode', 'por', 'pra', 'qual', 'quais', 'quando', 'quanto', 'que', 'quem', 'se', 'sua', 'seu', 'tem', 'um', 'uma', 'vai', 'vamos', 'vocês', 'você']);

export interface QuestionLanguage { language: 'en' | 'pt'; confidence: number; }

/**
 * Which of the two languages this is, from the small words people cannot avoid. It runs when the local worker is absent, and
 * says nothing rather than guess: an answer in the wrong language is worse in a call than a moment's doubt left to the model.
 */
export function questionLanguage(text: string): QuestionLanguage | null {
  const words = text.normalize('NFC').toLowerCase().match(/\p{L}+/gu) ?? [];
  let english = 0;
  let portuguese = 0;
  for (const word of words) {
    if (ENGLISH.has(word)) english += 1;
    if (PORTUGUESE.has(word)) portuguese += 1;
  }
  if (english === portuguese) return null;
  const language = english > portuguese ? 'en' : 'pt';
  return { language, confidence: Math.min(english, portuguese) === 0 ? CLEAR_CONFIDENCE : LEANING_CONFIDENCE };
}
