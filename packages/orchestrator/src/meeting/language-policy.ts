import type { LanguageDecision, LanguageDecisionReason } from '@neuralbridge/shared';

const DEFAULT_UTTERANCE_THRESHOLD = 0.75;
const DEFAULT_MEETING_THRESHOLD = 0.5;
const UNDETERMINED = 'und';

export interface LanguagePolicyOptions { utteranceThreshold?: number; meetingThreshold?: number; }
export interface LanguagePolicyInput {
  meetingLanguage: string | null;
  meetingConfidence: number;
  utteranceLanguage: string | null;
  utteranceConfidence: number;
  userPreferredLanguage: string;
  translationEnabled: boolean;
}

const known = (language: string | null): language is string => language !== null && language.toLowerCase() !== UNDETERMINED;
const base = (language: string): string => language.split('-')[0]?.toLowerCase() ?? language;

/** The utterance wins only on solid evidence, so one noisy phrase cannot flip the language of a whole meeting. */
export class LanguagePolicy {
  private readonly utteranceThreshold: number;
  readonly meetingThreshold: number;

  constructor(options: LanguagePolicyOptions = {}) {
    this.utteranceThreshold = options.utteranceThreshold ?? DEFAULT_UTTERANCE_THRESHOLD;
    this.meetingThreshold = options.meetingThreshold ?? DEFAULT_MEETING_THRESHOLD;
  }

  decide(input: LanguagePolicyInput): LanguageDecision {
    const { meetingLanguage, meetingConfidence, utteranceLanguage, utteranceConfidence, userPreferredLanguage, translationEnabled } = input;
    let responseLanguage = userPreferredLanguage;
    let reason: LanguageDecisionReason = 'user_preference';
    let confidence = 0;
    if (known(utteranceLanguage) && utteranceConfidence >= this.utteranceThreshold) {
      [responseLanguage, reason, confidence] = [utteranceLanguage, 'utterance', utteranceConfidence];
    } else if (known(meetingLanguage) && meetingConfidence >= this.meetingThreshold) {
      [responseLanguage, reason, confidence] = [meetingLanguage, 'meeting', meetingConfidence];
    }
    const translationLanguage = translationEnabled && base(responseLanguage) !== base(userPreferredLanguage) ? userPreferredLanguage : null;
    return { meetingLanguage, meetingConfidence, utteranceLanguage, utteranceConfidence, userPreferredLanguage, responseLanguage, reason, confidence, translationLanguage };
  }
}
