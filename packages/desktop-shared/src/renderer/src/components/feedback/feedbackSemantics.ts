export type FeedbackKind = 'loading' | 'empty' | 'error' | 'success' | 'offline' | 'approval' | 'progress' | 'cancelled';

export function feedbackSemantics(kind: FeedbackKind) {
  return {
    role: kind === 'error' || kind === 'offline' || kind === 'approval' ? 'alert' : 'status',
    live: kind === 'error' || kind === 'offline' || kind === 'approval' ? 'assertive' : 'polite',
  } as const;
}
