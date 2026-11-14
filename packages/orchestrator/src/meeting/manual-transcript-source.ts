import type { MeetingCapabilities, MeetingTranscriptInput } from '@neuralbridge/shared';
import type { MeetingSource, MeetingSourceHandle } from './meeting-input.js';

export const MANUAL_TRANSCRIPT_SOURCE_ID = 'manual-transcript';
const MAX_LINES = 50;
const MAX_LINE = 4_000;

/** Text the user pasted, such as live captions. It captures nothing and claims no platform. */
export class ManualTranscriptSource implements MeetingSource {
  readonly id = MANUAL_TRANSCRIPT_SOURCE_ID;
  readonly platform = 'generic' as const;
  private readonly handles = new Map<string, MeetingSourceHandle>();

  capabilities(): MeetingCapabilities { return { transcript: true, audio: false, diarization: false, nativeIntegration: false }; }

  start(handle: MeetingSourceHandle): Promise<void> {
    this.handles.set(handle.sessionId, handle);
    return Promise.resolve();
  }

  stop(sessionId: string): Promise<void> {
    this.handles.delete(sessionId);
    return Promise.resolve();
  }

  /** Each line is one utterance. Returns false when the session is not listening. */
  push(input: MeetingTranscriptInput): boolean {
    const handle = this.handles.get(input.sessionId);
    if (!handle) return false;
    const at = new Date().toISOString();
    const lines = input.text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean).slice(-MAX_LINES);
    for (const line of lines) handle.emit({ speaker: input.speaker, text: line.slice(0, MAX_LINE), language: null, languageConfidence: 0, startedAt: at, endedAt: at, final: true });
    return true;
  }
}
