import { describe, expect, it } from 'vitest';
import { feedbackSemantics } from '../src/renderer/src/components/feedback/feedbackSemantics';

describe('feedback primitives', () => {
  it('announces blocking states assertively and informational states politely', () => {
    expect(feedbackSemantics('error')).toEqual({ role: 'alert', live: 'assertive' });
    expect(feedbackSemantics('offline')).toEqual({ role: 'alert', live: 'assertive' });
    expect(feedbackSemantics('approval')).toEqual({ role: 'alert', live: 'assertive' });
    expect(feedbackSemantics('loading')).toEqual({ role: 'status', live: 'polite' });
    expect(feedbackSemantics('success')).toEqual({ role: 'status', live: 'polite' });
  });
});
