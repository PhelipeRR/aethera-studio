import type { MeetingCapabilities, MeetingPlatform } from '@neuralbridge/shared';
import type { MeetingSource, MeetingSourceHandle } from '../src/meeting/meeting-input.js';

export const transcriptOnly: MeetingCapabilities = { transcript: true, audio: false, diarization: true, nativeIntegration: false };

/** A scripted transcript provider: tests call `say` to deliver what a real source would push. */
export class FakeMeetingSource implements MeetingSource {
  handles: MeetingSourceHandle[] = [];
  stopped: string[] = [];
  failStart = false;
  failStop = false;

  constructor(readonly id = 'generic-transcript', readonly platform: MeetingPlatform = 'generic', private readonly caps: MeetingCapabilities = transcriptOnly) {}

  capabilities(): MeetingCapabilities { return this.caps; }

  start(handle: MeetingSourceHandle): Promise<void> {
    if (this.failStart) return Promise.reject(new Error('device busy'));
    this.handles.push(handle);
    return Promise.resolve();
  }

  stop(sessionId: string): Promise<void> {
    this.stopped.push(sessionId);
    return this.failStop ? Promise.reject(new Error('stuck')) : Promise.resolve();
  }

  say(text: string, overrides: Record<string, unknown> = {}): void {
    this.handles.at(-1)?.emit({ speaker: 'Dana', text, language: null, languageConfidence: 0, startedAt: '2026-11-02T12:00:00.000Z', endedAt: '2026-11-02T12:00:02.000Z', final: true, ...overrides });
  }
}
