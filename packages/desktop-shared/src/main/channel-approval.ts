export type ChannelWriteAction = 'branding' | 'publish' | 'publish-resume' | 'reschedule';

export interface ChannelWriteRequest { action: ChannelWriteAction; title: string; summary: string[]; }
export interface ChannelAuditEntry { action: ChannelWriteAction; outcome: 'approved' | 'rejected'; at: string; }

/** Asks the person on a surface the renderer cannot answer for (the native dialog). Resolves true only on an explicit approve. */
export type ChannelApprovalPrompt = (request: ChannelWriteRequest) => Promise<boolean>;

/**
 * Main-process gate for every write to the YouTube channel. Each call asks again: an approval covers exactly one
 * execution and cannot be replayed. The summary is built by the main process from the validated input, so what the
 * person approves is what is sent. The audit keeps the action and the outcome only, never titles, tokens or URLs.
 */
export class ChannelApprovalGate {
  private readonly auditLog: ChannelAuditEntry[] = [];

  constructor(private readonly prompt: ChannelApprovalPrompt) {}

  async require(request: ChannelWriteRequest): Promise<void> {
    const approved = await this.prompt(request).catch(() => false);
    this.auditLog.push({ action: request.action, outcome: approved ? 'approved' : 'rejected', at: new Date().toISOString() });
    if (!approved) throw new Error('confirmation_required: a escrita no canal não foi aprovada.');
  }

  audit(): readonly ChannelAuditEntry[] { return this.auditLog.slice(); }
}

/** Single-line, bounded rendering of untrusted text for the approval summary. */
export function summaryValue(value: string, max = 120): string {
  const line = Array.from(value, (char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char)).join('').replace(/ {2,}/gu, ' ').trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
