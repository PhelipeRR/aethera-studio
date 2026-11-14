import { describe, expect, it, vi } from 'vitest';
import type { MeetingSession, MeetingUtterance } from '@neuralbridge/shared';
import { questionLanguage } from '../src/meeting/question-language.js';
import { SuggestionEngine, type SuggestionModel } from '../src/meeting/suggestion-engine.js';

describe('questionLanguage', () => {
  it('tells English from Portuguese in a short question', () => {
    for (const text of ['Could you tell me when the project delivery will be ready?', 'What is the biggest risk with this timeline?', 'Can you send me the report by Friday?', 'Any update?']) expect(questionLanguage(text)?.language).toBe('en');
    for (const text of ['Você consegue me dizer quando a entrega fica pronta?', 'Qual é o maior risco nesse prazo?', 'Quando fica pronto?', 'E o orçamento?']) expect(questionLanguage(text)?.language).toBe('pt');
  });

  it('is sure enough to win over the language of the meeting', () => {
    expect(questionLanguage('What is the biggest risk with this timeline?')?.confidence).toBeGreaterThanOrEqual(.75);
  });

  it('does not guess from words that belong to neither', () => {
    expect(questionLanguage('OK')).toBeNull();
    expect(questionLanguage('Kubernetes')).toBeNull();
  });

  it('follows the question when one borrowed word comes along', () => {
    expect(questionLanguage('Você pode revisar o deploy hoje?')?.language).toBe('pt');
    expect(questionLanguage('Can you check the orçamento today?')?.language).toBe('en');
  });
});

describe('SuggestionEngine language', () => {
  const session = { sessionId: '00000000-0000-4000-8000-000000000001', status: 'active', meetingLanguage: 'pt', meetingConfidence: .9, userPreferredLanguage: 'pt-BR', translationEnabled: false } as MeetingSession;
  const utterance = (text: string) => ({ utteranceId: '00000000-0000-4000-8000-000000000002', sessionId: session.sessionId, speaker: null, text, language: null, languageConfidence: 0, startedAt: '2026-11-02T12:00:00.000Z', endedAt: '2026-11-02T12:00:00.000Z', final: true }) as MeetingUtterance;
  const answer = (text: string) => ({ text, translation: null, confidence: .9 });

  it('answers in the language of the question, even in a Portuguese meeting of a Portuguese speaker', async () => {
    const generate = vi.fn<SuggestionModel['generate']>().mockResolvedValue(answer('I will confirm the date today.'));
    const engine = new SuggestionEngine({ model: { generate }, worker: null });
    const suggestion = await engine.suggest({ session, utterance: utterance('When will the delivery be ready?'), recent: [] });
    expect(generate.mock.calls[0]?.[0].responseLanguage).toBe('en');
    expect(generate.mock.calls[0]?.[0].languageAmbiguous).toBe(false);
    expect(suggestion.decision.reason).toBe('utterance');
  });

  it('asks again when the reply comes back in another language', async () => {
    const generate = vi.fn<SuggestionModel['generate']>().mockResolvedValueOnce(answer('Ainda não tenho a data confirmada da entrega.')).mockResolvedValueOnce(answer('I do not have the date confirmed yet.'));
    const engine = new SuggestionEngine({ model: { generate }, worker: null });
    const suggestion = await engine.suggest({ session, utterance: utterance('When will the delivery be ready?'), recent: [] });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(generate.mock.calls[1]?.[0].instructions).toMatch(/english|en/i);
    expect(suggestion.text).toBe('I do not have the date confirmed yet.');
  });

  it('tells the model the rule in every request', async () => {
    const generate = vi.fn<SuggestionModel['generate']>().mockResolvedValue(answer('Sexta.'));
    await new SuggestionEngine({ model: { generate }, worker: null }).suggest({ session, utterance: utterance('Quando fica pronto?'), recent: [] });
    expect(generate.mock.calls[0]?.[0].instructions).toMatch(/same language as the question/i);
  });
});
