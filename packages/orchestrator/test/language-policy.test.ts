import { describe, expect, it } from 'vitest';
import { languageDecisionSchema } from '@neuralbridge/shared';
import { LanguagePolicy, type LanguagePolicyInput } from '../src/meeting/language-policy.js';

const base: LanguagePolicyInput = { meetingLanguage: 'en', meetingConfidence: 0.9, utteranceLanguage: 'en', utteranceConfidence: 0.9, userPreferredLanguage: 'pt-BR', translationEnabled: false };
const policy = new LanguagePolicy();

describe('LanguagePolicy', () => {
  it('answers in English in a predominantly English meeting', () => {
    const decision = policy.decide(base);
    expect(decision).toMatchObject({ responseLanguage: 'en', reason: 'utterance', confidence: 0.9 });
    expect(languageDecisionSchema.safeParse(decision).success).toBe(true);
  });

  it('follows a confident Portuguese question inside an English meeting', () => {
    expect(policy.decide({ ...base, utteranceLanguage: 'pt', utteranceConfidence: 0.92 })).toMatchObject({ responseLanguage: 'pt', reason: 'utterance', meetingLanguage: 'en', utteranceLanguage: 'pt' });
  });

  it('does not switch on a single low-confidence phrase', () => {
    expect(policy.decide({ ...base, utteranceLanguage: 'pt', utteranceConfidence: 0.74 })).toMatchObject({ responseLanguage: 'en', reason: 'meeting', utteranceLanguage: 'pt', utteranceConfidence: 0.74, confidence: 0.9 });
  });

  it('wins exactly at the threshold', () => {
    expect(policy.decide({ ...base, utteranceLanguage: 'pt', utteranceConfidence: 0.75 }).responseLanguage).toBe('pt');
  });

  it('never lets an undetermined utterance win, however confident', () => {
    expect(policy.decide({ ...base, utteranceLanguage: 'und', utteranceConfidence: 1 }).responseLanguage).toBe('en');
    expect(policy.decide({ ...base, utteranceLanguage: null, utteranceConfidence: 1 }).reason).toBe('meeting');
    expect(policy.decide({ ...base, utteranceLanguage: 'UND', utteranceConfidence: 1 }).reason).toBe('meeting');
  });

  it('falls back to the user preference when the meeting language is unknown or weak', () => {
    const weak = { ...base, utteranceLanguage: 'und', utteranceConfidence: 0.2 };
    expect(policy.decide({ ...weak, meetingLanguage: null, meetingConfidence: 0 })).toMatchObject({ responseLanguage: 'pt-BR', reason: 'user_preference', confidence: 0 });
    expect(policy.decide({ ...weak, meetingLanguage: 'und', meetingConfidence: 0.9 }).reason).toBe('user_preference');
    expect(policy.decide({ ...weak, meetingConfidence: 0.49 }).reason).toBe('user_preference');
  });

  it('keeps every language value separate in the decision', () => {
    expect(policy.decide({ ...base, utteranceLanguage: 'es', utteranceConfidence: 0.3 })).toMatchObject({ meetingLanguage: 'en', utteranceLanguage: 'es', userPreferredLanguage: 'pt-BR' });
  });

  it('asks for a translation only when toggled on and different from the answer', () => {
    expect(policy.decide(base).translationLanguage).toBeNull();
    expect(policy.decide({ ...base, translationEnabled: true }).translationLanguage).toBe('pt-BR');
    expect(policy.decide({ ...base, translationEnabled: true, utteranceLanguage: 'pt', utteranceConfidence: 0.9 }).translationLanguage).toBeNull();
  });

  it('accepts a configured threshold', () => {
    expect(new LanguagePolicy({ utteranceThreshold: 0.95 }).decide({ ...base, utteranceLanguage: 'pt', utteranceConfidence: 0.9 }).responseLanguage).toBe('en');
  });
});
