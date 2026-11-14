import { randomUUID } from 'node:crypto';
import { confidenceSchema, languageTagSchema, meetingSessionSchema, meetingStartInputSchema, meetingUtteranceSchema, type MeetingCapabilities, type MeetingDegradation, type MeetingPlatform, type MeetingSession, type MeetingStartInput, type MeetingUtterance } from '@neuralbridge/shared';

const DEFAULT_MAX_DURATION_MS = 4 * 60 * 60_000;
const DEFAULT_MAX_BUFFERED = 200;

export type MeetingInputErrorCode = 'unknown_source' | 'no_input' | 'source_failed';
export class MeetingInputError extends Error {
  constructor(readonly code: MeetingInputErrorCode, options?: ErrorOptions) { super(`meeting_input_${code}`, options); this.name = 'MeetingInputError'; }
}

export interface MeetingSourceHandle {
  sessionId: string;
  /** Takes whatever the provider produced: it is validated here, and audio or malformed events are dropped. */
  emit(event: unknown): void;
}

/** A provider of meeting text. Capabilities say what it really offers; the session is built from them, not from the request. */
export interface MeetingSource {
  readonly id: string;
  readonly platform: MeetingPlatform;
  capabilities(): MeetingCapabilities;
  start(handle: MeetingSourceHandle): Promise<void>;
  stop(sessionId: string): Promise<void>;
}

export interface MeetingInputOptions { maxDurationMs?: number; maxBuffered?: number; }
export type MeetingUtteranceObserver = (utterance: MeetingUtterance) => void;

interface ActiveMeeting { session: MeetingSession; source: MeetingSource; buffer: MeetingUtterance[]; dropped: number; timer: NodeJS.Timeout | null; live: boolean; }

const sourceEventSchema = meetingUtteranceSchema.omit({ utteranceId: true, sessionId: true });

function degradationsOf(requested: MeetingPlatform, source: MeetingSource, capabilities: MeetingCapabilities): MeetingDegradation[] {
  const degradations: MeetingDegradation[] = [];
  if (!capabilities.transcript) degradations.push('transcript_unavailable');
  if (!capabilities.audio) degradations.push('audio_unavailable');
  if (!capabilities.diarization) degradations.push('diarization_unavailable');
  if (requested !== 'generic' && (source.platform !== requested || !capabilities.nativeIntegration)) degradations.push('native_integration_unavailable');
  return degradations;
}

/** Opted-in, bounded meeting text. The transcript lives only in this rolling buffer and goes when the session stops. */
export class MeetingInput {
  private readonly sources: ReadonlyMap<string, MeetingSource>;
  private readonly meetings = new Map<string, ActiveMeeting>();
  private readonly observers = new Set<MeetingUtteranceObserver>();
  private readonly maxDurationMs: number;
  private readonly maxBuffered: number;

  constructor(sources: readonly MeetingSource[], options: MeetingInputOptions = {}) {
    this.sources = new Map(sources.map((source) => [source.id, source]));
    this.maxDurationMs = options.maxDurationMs ?? DEFAULT_MAX_DURATION_MS;
    this.maxBuffered = options.maxBuffered ?? DEFAULT_MAX_BUFFERED;
  }

  async start(input: MeetingStartInput): Promise<MeetingSession> {
    const { sourceId, platform, consent, userPreferredLanguage, translationEnabled } = meetingStartInputSchema.parse(input);
    const source = this.sources.get(sourceId);
    if (!source) throw new MeetingInputError('unknown_source');
    const capabilities = source.capabilities();
    if (!capabilities.transcript && !capabilities.audio) throw new MeetingInputError('no_input');
    const degradations = degradationsOf(platform, source, capabilities);
    const blocked = degradations.includes('transcript_unavailable') || degradations.includes('native_integration_unavailable');
    const session = meetingSessionSchema.parse({
      sessionId: randomUUID(),
      sourceId,
      platform: platform === 'generic' || degradations.includes('native_integration_unavailable') ? 'generic' : platform,
      status: blocked ? 'degraded' : 'active',
      consent,
      capabilities,
      degradations,
      meetingLanguage: null,
      meetingConfidence: 0,
      userPreferredLanguage,
      translationEnabled,
      startedAt: new Date().toISOString(),
      stoppedAt: null,
    });
    const meeting: ActiveMeeting = { session, source, buffer: [], dropped: 0, timer: null, live: false };
    this.meetings.set(session.sessionId, meeting);
    try {
      await source.start({ sessionId: session.sessionId, emit: (event) => this.receive(meeting, event) });
    } catch (error) {
      this.meetings.delete(session.sessionId);
      throw new MeetingInputError('source_failed', { cause: error });
    }
    if (meeting.session.status === 'stopped') {
      // Pause arrived while the source was starting, when it could not act on the first stop yet.
      await this.stopSource(meeting);
      return { ...meeting.session };
    }
    meeting.live = true;
    meeting.timer = setTimeout(() => { void this.stop(session.sessionId); }, this.maxDurationMs);
    meeting.timer.unref();
    return { ...meeting.session };
  }

  async stop(sessionId: string): Promise<void> {
    const meeting = this.meetings.get(sessionId);
    if (!meeting || meeting.session.status === 'stopped') return;
    if (meeting.timer) clearTimeout(meeting.timer);
    meeting.session = { ...meeting.session, status: 'stopped', stoppedAt: new Date().toISOString() };
    meeting.buffer = [];
    await this.stopSource(meeting);
  }

  /** A source that refuses to stop must not keep the session alive: nothing it emits is accepted from here on. */
  private async stopSource(meeting: ActiveMeeting): Promise<void> {
    await Promise.resolve().then(() => meeting.source.stop(meeting.session.sessionId)).catch(() => undefined);
  }

  async stopAll(): Promise<number> {
    const active = this.activeSessions();
    await Promise.all(active.map((session) => this.stop(session.sessionId)));
    return active.length;
  }

  session(sessionId: string): MeetingSession | null {
    const meeting = this.meetings.get(sessionId);
    return meeting ? { ...meeting.session } : null;
  }

  /** A source still opening cannot be heard yet, so the app must not say that it is. */
  liveSessions(): MeetingSession[] {
    return [...this.meetings.values()].filter((meeting) => meeting.live && meeting.session.status !== 'stopped').map((meeting) => ({ ...meeting.session }));
  }

  activeSessions(): MeetingSession[] {
    return [...this.meetings.values()].filter((meeting) => meeting.session.status !== 'stopped').map((meeting) => ({ ...meeting.session }));
  }

  /** Keeps what a suggestion learned, so the meeting language survives a short window or a worker outage. */
  updateLanguage(sessionId: string, language: string, confidence: number): void {
    const meeting = this.meetings.get(sessionId);
    if (!meeting || meeting.session.status === 'stopped') return;
    meeting.session = { ...meeting.session, meetingLanguage: languageTagSchema.parse(language), meetingConfidence: confidenceSchema.parse(confidence) };
  }

  recent(sessionId: string): MeetingUtterance[] { return [...(this.meetings.get(sessionId)?.buffer ?? [])]; }
  droppedUtterances(sessionId: string): number { return this.meetings.get(sessionId)?.dropped ?? 0; }

  onUtterance(observer: MeetingUtteranceObserver): () => void {
    this.observers.add(observer);
    return () => { this.observers.delete(observer); };
  }

  dispose(): void {
    void this.stopAll();
    this.observers.clear();
  }

  private receive(meeting: ActiveMeeting, event: unknown): void {
    if (meeting.session.status === 'stopped' || !meeting.session.capabilities.transcript) return;
    const parsed = sourceEventSchema.safeParse(event);
    if (!parsed.success) { meeting.dropped += 1; return; }
    if (!parsed.data.final) return;
    const utterance: MeetingUtterance = { ...parsed.data, utteranceId: randomUUID(), sessionId: meeting.session.sessionId };
    meeting.buffer.push(utterance);
    if (meeting.buffer.length > this.maxBuffered) meeting.buffer.shift();
    for (const observer of [...this.observers]) {
      try { observer(utterance); } catch { /* One consumer's bug must not stop the transcript reaching the others. */ }
    }
  }
}
