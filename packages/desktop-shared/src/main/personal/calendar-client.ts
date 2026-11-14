export interface CalendarEventSummary { id: string; summary: string; start: string; end: string; }
export interface CalendarEventInput { summary: string; start: string; end: string; }
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export class GoogleCalendarClient {
  private readonly fetcher: FetchLike;
  constructor(private readonly accessToken: string, fetcher: FetchLike = fetch) { this.fetcher = fetcher; }

  async listEvents(timeMin: string, timeMax: string): Promise<CalendarEventSummary[]> {
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events');
    url.searchParams.set('timeMin', timeMin); url.searchParams.set('timeMax', timeMax); url.searchParams.set('singleEvents', 'true'); url.searchParams.set('orderBy', 'startTime');
    const response = await this.fetcher(url, { headers: { authorization: `Bearer ${this.accessToken}`, accept: 'application/json' } });
    if (!response.ok) throw new Error(`Google Calendar ${response.status}`);
    const data = await response.json() as { items?: Array<{ id?: unknown; summary?: unknown; start?: { dateTime?: unknown; date?: unknown }; end?: { dateTime?: unknown; date?: unknown } }> };
    return (data.items ?? []).flatMap((event) => {
      const start = event.start?.dateTime ?? event.start?.date;
      const end = event.end?.dateTime ?? event.end?.date;
      return typeof event.id === 'string' && typeof event.summary === 'string' && typeof start === 'string' && typeof end === 'string' ? [{ id: event.id, summary: event.summary, start, end }] : [];
    });
  }

  async sync(syncToken: string): Promise<{ syncToken: string; events: CalendarEventSummary[] }> {
    const url = new URL('https://www.googleapis.com/calendar/v3/calendars/primary/events'); url.searchParams.set('syncToken', syncToken); url.searchParams.set('singleEvents', 'true');
    const response = await this.fetcher(url, { headers: { authorization: `Bearer ${this.accessToken}`, accept: 'application/json' } });
    if (!response.ok) throw new Error(`Google Calendar ${response.status}`);
    const data = await response.json() as { nextSyncToken?: unknown; items?: Array<{ id?: unknown; summary?: unknown; start?: { dateTime?: unknown; date?: unknown }; end?: { dateTime?: unknown; date?: unknown } }> };
    if (typeof data.nextSyncToken !== 'string') throw new Error('Google Calendar response missing sync token');
    const events = (data.items ?? []).flatMap((event) => { const start = event.start?.dateTime ?? event.start?.date; const end = event.end?.dateTime ?? event.end?.date; return typeof event.id === 'string' && typeof event.summary === 'string' && typeof start === 'string' && typeof end === 'string' ? [{ id: event.id, summary: event.summary, start, end }] : []; });
    return { syncToken: data.nextSyncToken, events };
  }

  async createEvent(input: CalendarEventInput): Promise<CalendarEventSummary> {
    const response = await this.fetcher('https://www.googleapis.com/calendar/v3/calendars/primary/events', { method: 'POST', headers: { authorization: `Bearer ${this.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ summary: input.summary, start: { dateTime: input.start }, end: { dateTime: input.end } }) });
    if (!response.ok) throw new Error(`Google Calendar ${response.status}`);
    const data = await response.json() as { id?: unknown; summary?: unknown; start?: { dateTime?: unknown }; end?: { dateTime?: unknown } };
    if (typeof data.id !== 'string' || typeof data.summary !== 'string' || typeof data.start?.dateTime !== 'string' || typeof data.end?.dateTime !== 'string') throw new Error('Google Calendar response missing event fields');
    return { id: data.id, summary: data.summary, start: data.start.dateTime, end: data.end.dateTime };
  }

  async cancelEvent(eventId: string): Promise<boolean> {
    const response = await this.fetcher(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: 'DELETE', headers: { authorization: `Bearer ${this.accessToken}` } });
    if (!response.ok && response.status !== 410) throw new Error(`Google Calendar ${response.status}`);
    return true;
  }
}
