import { z } from 'zod';

export const optimizerInputSchema = z.strictObject({ title: z.string().max(100), description: z.string().max(5_000), tags: z.array(z.string().max(100)).max(500), keyword: z.string().trim().max(100), timezone: z.string().trim().min(1).max(80), from: z.string().datetime() });
export type OptimizerInput = z.infer<typeof optimizerInputSchema>;
export type OptimizerScores = { title: number; description: number; tags: number };
export const optimizerSuggestionSchema = z.strictObject({ titles: z.array(z.string().trim().min(1).max(100)).length(5), description: z.string().trim().max(5_000), tags: z.array(z.string().trim().min(1).max(100)).max(50) });
export type OptimizerSuggestion = z.infer<typeof optimizerSuggestionSchema>;
const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
const wholeWord = (text: string, keyword: string) => keyword ? new RegExp(`(^|[^\\p{L}\\p{N}])${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'iu').test(text) : false;
export function scorePublication(input: Pick<OptimizerInput, 'title' | 'description' | 'tags' | 'keyword'>): OptimizerScores {
  const titleLength = input.title.length >= 35 && input.title.length <= 70 ? 25 : input.title.length > 0 && input.title.length <= 100 ? 15 : 0;
  const titleKeyword = wholeWord(input.title, input.keyword) ? 20 : 0;
  const titleKeywordStart = input.keyword ? new RegExp(`^\\s*${input.keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'iu').test(input.title) ? 10 : 0 : 0;
  const titleNumber = /\d/u.test(input.title) ? 15 : 0;
  const titleTrigger = /\?|!|como|por que|erros?|segredos?|guia/iu.test(input.title) ? 10 : 0;
  const titleUppercase = /\p{Lu}{3,}/u.test(input.title) ? 5 : 0;
  const descriptionLength = input.description.length >= 150 ? 20 : input.description.length > 0 ? 10 : 0;
  const descriptionHashtag = (input.description.match(/#[\p{L}\p{N}_]+/gu) ?? []).length;
  const descriptionChapters = /\b\d{1,2}:\d{2}\b/u.test(input.description) ? 10 : 0;
  const descriptionCta = /\b(comente|inscreva-se|saiba mais|acesse|compartilhe)\b/iu.test(input.description) ? 10 : 0;
  const tagLength = input.tags.join(',').length;
  return { title: clamp(titleLength + titleKeyword + titleKeywordStart + titleNumber + titleTrigger + titleUppercase), description: clamp(descriptionLength + (input.description.slice(0, 150).length >= 150 ? 10 : 0) + (descriptionHashtag > 15 ? 20 : Math.min(descriptionHashtag, 15)) + descriptionChapters + descriptionCta), tags: clamp(tagLength > 0 ? (tagLength <= 500 ? 70 : 20) + Math.min(input.tags.length, 5) * 6 : 0) };
}
export function suggestLocalTimes(from: string, timezone: string): string[] {
  const base = new Date(from); if (Number.isNaN(base.getTime())) throw new Error('invalid: data inicial inválida.');
  let baseParts: Intl.DateTimeFormatPart[];
  try { baseParts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(base); } catch { throw new Error('invalid: fuso horário inválido.'); }
  const valueOf = (parts: Intl.DateTimeFormatPart[], type: string) => Number(parts.find((part) => part.type === type)?.value);
  const baseUtc = Date.UTC(valueOf(baseParts, 'year'), valueOf(baseParts, 'month') - 1, valueOf(baseParts, 'day'));
  const localParts = (value: Date) => new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23', minute: 'numeric' }).formatToParts(value);
  // These are transparent local-time slots, not predictions. Convert the desired wall-clock time to UTC with the zone's actual offset (including DST).
  return [1, 2, 4].map((days, index) => { const localDate = new Date(baseUtc + days * 86_400_000); const desired = Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), localDate.getUTCDate(), 18 + index, 0); let guess = new Date(desired); const actual = localParts(guess); const actualAsUtc = Date.UTC(valueOf(actual, 'year'), valueOf(actual, 'month') - 1, valueOf(actual, 'day'), valueOf(actual, 'hour'), valueOf(actual, 'minute')); guess = new Date(desired + (desired - actualAsUtc)); return `${guess.toISOString()} [${timezone}]`; });
}
