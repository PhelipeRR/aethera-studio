export interface GmailMessageRef { id: string; threadId?: string; }
export interface GmailSearchResult { ids: GmailMessageRef[]; estimate: number; }
export interface GmailMessageMetadata extends GmailMessageRef { subject?: string; }
export interface GmailProfile { emailAddress: string; messagesTotal?: number; threadsTotal?: number; }
export interface GmailHistoryResult { historyId: string; messages: GmailMessageRef[]; }
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

/** Minimal Gmail adapter. It exposes metadata and deliberately has no persistence or prompt integration. */
export class GmailClient {
  private readonly fetcher: FetchLike;
  constructor(private readonly accessToken: string, fetcher: FetchLike = fetch) { this.fetcher = fetcher; }

  async search(query: string): Promise<GmailSearchResult> {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages');
    url.searchParams.set('q', query);
    const response = await this.fetcher(url, { headers: { authorization: `Bearer ${this.accessToken}`, accept: 'application/json' } });
    if (!response.ok) throw new Error(`Gmail ${response.status}`);
    const data = await response.json() as { messages?: Array<{ id?: unknown; threadId?: unknown }>; resultSizeEstimate?: unknown };
    const ids = (data.messages ?? []).flatMap((message) => typeof message.id === 'string' ? [{ id: message.id, ...(typeof message.threadId === 'string' ? { threadId: message.threadId } : {}) }] : []);
    return { ids, estimate: typeof data.resultSizeEstimate === 'number' ? data.resultSizeEstimate : ids.length };
  }

  async profile(): Promise<GmailProfile> {
    const response = await this.fetcher('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { authorization: `Bearer ${this.accessToken}`, accept: 'application/json' } });
    if (!response.ok) throw new Error(`Gmail ${response.status}`);
    const data = await response.json() as { emailAddress?: unknown; messagesTotal?: unknown; threadsTotal?: unknown };
    if (typeof data.emailAddress !== 'string' || !data.emailAddress.includes('@')) throw new Error('Gmail profile missing email address');
    return { emailAddress: data.emailAddress, ...(typeof data.messagesTotal === 'number' ? { messagesTotal: data.messagesTotal } : {}), ...(typeof data.threadsTotal === 'number' ? { threadsTotal: data.threadsTotal } : {}) };
  }

  async history(startHistoryId: string): Promise<GmailHistoryResult> {
    const url = new URL('https://gmail.googleapis.com/gmail/v1/users/me/history'); url.searchParams.set('startHistoryId', startHistoryId); url.searchParams.set('historyTypes', 'messageAdded');
    const response = await this.fetcher(url, { headers: { authorization: `Bearer ${this.accessToken}`, accept: 'application/json' } });
    if (!response.ok) throw new Error(`Gmail ${response.status}`);
    const data = await response.json() as { historyId?: unknown; history?: Array<{ messagesAdded?: Array<{ message?: { id?: unknown; threadId?: unknown } }> }> };
    if (typeof data.historyId !== 'string') throw new Error('Gmail history missing history id');
    const messages = (data.history ?? []).flatMap((entry) => (entry.messagesAdded ?? []).flatMap(({ message }) => typeof message?.id === 'string' ? [{ id: message.id, ...(typeof message.threadId === 'string' ? { threadId: message.threadId } : {}) }] : []));
    return { historyId: data.historyId, messages };
  }

  async read(messageId: string): Promise<GmailMessageMetadata> {
    const response = await this.fetcher(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}?format=metadata&metadataHeaders=Subject`, { headers: { authorization: `Bearer ${this.accessToken}`, accept: 'application/json' } });
    if (!response.ok) throw new Error(`Gmail ${response.status}`);
    const data = await response.json() as { id?: unknown; threadId?: unknown; payload?: { headers?: Array<{ name?: unknown; value?: unknown }> } };
    const subject = data.payload?.headers?.find((header) => header.name === 'Subject')?.value;
    if (typeof data.id !== 'string') throw new Error('Gmail response missing message id');
    return { id: data.id, ...(typeof data.threadId === 'string' ? { threadId: data.threadId } : {}), ...(typeof subject === 'string' ? { subject } : {}) };
  }

  async send(input: { to: string[]; subject: string; body: string }): Promise<{ id: string }> {
    const raw = Buffer.from(`To: ${input.to.join(', ')}\r\nSubject: ${input.subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${input.body}`).toString('base64url');
    const response = await this.fetcher('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', { method: 'POST', headers: { authorization: `Bearer ${this.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw }) });
    if (!response.ok) throw new Error(`Gmail ${response.status}`);
    const data = await response.json() as { id?: unknown };
    if (typeof data.id !== 'string') throw new Error('Gmail send response missing message id');
    return { id: data.id };
  }
}
