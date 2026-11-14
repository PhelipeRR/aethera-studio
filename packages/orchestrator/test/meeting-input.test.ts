import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { meetingSessionSchema, type MeetingStartInput, type MeetingUtterance } from '@neuralbridge/shared';
import { MeetingInput, MeetingInputError } from '../src/meeting/meeting-input.js';
import { FakeMeetingSource, transcriptOnly } from './fake-meeting-source.js';

const start: MeetingStartInput = { sourceId: 'generic-transcript', platform: 'generic', consent: true, userPreferredLanguage: 'pt-BR', translationEnabled: false };
const failure = (promise: Promise<unknown>): Promise<string> => promise.then(() => 'resolved', (error: unknown) => (error instanceof MeetingInputError ? error.code : `other: ${String(error)}`));

let source: FakeMeetingSource;
let input: MeetingInput;
beforeEach(() => {
  source = new FakeMeetingSource();
  input = new MeetingInput([source]);
});
afterEach(() => { input.dispose(); });

describe('MeetingInput sessions', () => {
  it('starts an opted-in session that passes the contract', async () => {
    const session = await input.start(start);
    expect(meetingSessionSchema.safeParse(session).success).toBe(true);
    expect(session).toMatchObject({ status: 'active', platform: 'generic', stoppedAt: null });
    expect(input.session(session.sessionId)).toEqual(session);
  });

  it('refuses to start without consent, before touching the source', async () => {
    await expect(input.start({ ...start, consent: false } as unknown as MeetingStartInput)).rejects.toThrow();
    expect(source.handles).toEqual([]);
  });

  it('refuses an unknown source and reports a source that fails to start', async () => {
    expect(await failure(input.start({ ...start, sourceId: 'nope' }))).toBe('unknown_source');
    source.failStart = true;
    expect(await failure(input.start(start))).toBe('source_failed');
    expect(input.activeSessions()).toEqual([]);
  });

  it('stops, tells the source, forgets the transcript and is idempotent', async () => {
    const session = await input.start(start);
    source.say('Hello there');
    await input.stop(session.sessionId);
    await input.stop(session.sessionId);
    expect(source.stopped).toEqual([session.sessionId]);
    expect(input.session(session.sessionId)).toMatchObject({ status: 'stopped' });
    expect(input.session(session.sessionId)?.stoppedAt).not.toBeNull();
    expect(input.recent(session.sessionId)).toEqual([]);
  });

  it('stops even when the source refuses', async () => {
    source.failStop = true;
    const session = await input.start(start);
    await input.stop(session.sessionId);
    expect(input.session(session.sessionId)?.status).toBe('stopped');
  });

  it('stops a source that finishes starting after the session was stopped', async () => {
    let finishStart: () => void = () => undefined;
    const slow = new FakeMeetingSource();
    slow.start = (handle) => { slow.handles.push(handle); return new Promise((done) => { finishStart = done; }); };
    const meeting = new MeetingInput([slow]);
    const starting = meeting.start(start);
    await vi.waitFor(() => { expect(slow.handles).toHaveLength(1); });
    await meeting.stopAll();
    finishStart();
    expect(await starting).toMatchObject({ status: 'stopped' });
    expect(slow.stopped).toHaveLength(2);
  });

  it('survives a source whose stop throws synchronously', async () => {
    source.stop = () => { throw new Error('stuck'); };
    const session = await input.start(start);
    await expect(input.stop(session.sessionId)).resolves.toBeUndefined();
  });

  it('remembers the meeting language and ignores updates after stop', async () => {
    const session = await input.start(start);
    input.updateLanguage(session.sessionId, 'en', 0.8);
    expect(input.session(session.sessionId)).toMatchObject({ meetingLanguage: 'en', meetingConfidence: 0.8 });
    await input.stop(session.sessionId);
    input.updateLanguage(session.sessionId, 'pt', 0.9);
    expect(input.session(session.sessionId)?.meetingLanguage).toBe('en');
  });

  it('pause stops every active session', async () => {
    await input.start(start);
    await input.start(start);
    expect(await input.stopAll()).toBe(2);
    expect(input.activeSessions()).toEqual([]);
  });

  it('ends a session at the duration limit', async () => {
    vi.useFakeTimers();
    try {
      const bounded = new MeetingInput([source], { maxDurationMs: 1_000 });
      const session = await bounded.start(start);
      await vi.advanceTimersByTimeAsync(1_001);
      expect(bounded.session(session.sessionId)?.status).toBe('stopped');
      bounded.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('MeetingInput capabilities', () => {
  it('does not claim Teams when only a generic source backs the request', async () => {
    const session = await input.start({ ...start, platform: 'teams' });
    expect(session.platform).toBe('generic');
    expect(session.capabilities.nativeIntegration).toBe(false);
    expect(session.degradations).toContain('native_integration_unavailable');
    expect(session.status).toBe('degraded');
  });

  it('does not take a source word for it without the native capability', async () => {
    const claims = new FakeMeetingSource('teams-export', 'teams', transcriptOnly);
    const session = await new MeetingInput([claims]).start({ ...start, sourceId: 'teams-export', platform: 'teams' });
    expect(session.platform).toBe('generic');
  });

  it('reports Teams for a real native source', async () => {
    const native = new FakeMeetingSource('teams', 'teams', { transcript: true, audio: true, diarization: true, nativeIntegration: true });
    const meeting = new MeetingInput([native]);
    const session = await meeting.start({ ...start, sourceId: 'teams', platform: 'teams' });
    expect(session).toMatchObject({ platform: 'teams', status: 'active', degradations: [] });
    meeting.dispose();
  });

  it('degrades a transcript without audio only by noting it, since text is enough', async () => {
    const session = await input.start(start);
    expect(session.degradations).toEqual(['audio_unavailable']);
    expect(session.status).toBe('active');
  });

  it('degrades audio without a transcript and drops anything such a source pushes as text', async () => {
    const audio = new FakeMeetingSource('mic', 'generic', { transcript: false, audio: true, diarization: false, nativeIntegration: false });
    const meeting = new MeetingInput([audio]);
    const heard: MeetingUtterance[] = [];
    meeting.onUtterance((utterance) => heard.push(utterance));
    const session = await meeting.start({ ...start, sourceId: 'mic' });
    expect(session).toMatchObject({ status: 'degraded' });
    expect(session.degradations).toContain('transcript_unavailable');
    audio.say('should not surface');
    expect(heard).toEqual([]);
    meeting.dispose();
  });

  it('refuses a source with no input at all', async () => {
    const empty = new FakeMeetingSource('none', 'generic', { transcript: false, audio: false, diarization: false, nativeIntegration: false });
    expect(await failure(new MeetingInput([empty]).start({ ...start, sourceId: 'none' }))).toBe('no_input');
  });
});

describe('MeetingInput utterances', () => {
  it('delivers final utterances and keeps a bounded buffer', async () => {
    const meeting = new MeetingInput([source], { maxBuffered: 2 });
    const heard: MeetingUtterance[] = [];
    const unsubscribe = meeting.onUtterance((utterance) => heard.push(utterance));
    const session = await meeting.start(start);
    source.say('one');
    source.say('partial', { final: false });
    source.say('two');
    source.say('three');
    expect(heard.map((item) => item.text)).toEqual(['one', 'two', 'three']);
    expect(heard[0]?.sessionId).toBe(session.sessionId);
    expect(meeting.recent(session.sessionId).map((item) => item.text)).toEqual(['two', 'three']);
    unsubscribe();
    source.say('four');
    expect(heard).toHaveLength(3);
    meeting.dispose();
  });

  it('never accepts raw audio or malformed events, and counts them', async () => {
    const session = await input.start(start);
    const heard: MeetingUtterance[] = [];
    input.onUtterance((utterance) => heard.push(utterance));
    source.say('hello', { audio: 'UklGRg==' });
    source.say('x'.repeat(4_001));
    source.handles[0]?.emit('not an object');
    expect(heard).toEqual([]);
    expect(input.recent(session.sessionId)).toEqual([]);
    expect(input.droppedUtterances(session.sessionId)).toBe(3);
  });

  it('ignores events after the session stops', async () => {
    const session = await input.start(start);
    await input.stop(session.sessionId);
    source.say('late');
    expect(input.recent(session.sessionId)).toEqual([]);
  });

  it('isolates a failing observer', async () => {
    const heard: string[] = [];
    input.onUtterance(() => { throw new Error('observer bug'); });
    input.onUtterance((utterance) => heard.push(utterance.text));
    await input.start(start);
    source.say('hello');
    expect(heard).toEqual(['hello']);
  });
});
