import { describe, expect, it } from 'vitest';
import { ChannelApprovalGate, summaryValue, type ChannelWriteRequest } from '../src/main/channel-approval.js';

const request: ChannelWriteRequest = { action: 'publish', title: 'Enviar este vídeo ao YouTube?', summary: ['Título: Teste'] };

describe('ChannelApprovalGate', () => {
  it('asks again for every write, so one approval never covers a second execution', async () => {
    const answers = [true, false];
    const asked: ChannelWriteRequest[] = [];
    const gate = new ChannelApprovalGate(async (item) => { asked.push(item); return answers.shift() ?? false; });
    await expect(gate.require(request)).resolves.toBeUndefined();
    await expect(gate.require(request)).rejects.toThrow(/confirmation_required/);
    expect(asked).toHaveLength(2);
    expect(gate.audit().map((entry) => entry.outcome)).toEqual(['approved', 'rejected']);
  });

  it('treats a failing prompt as a rejection and audits only the action and outcome', async () => {
    const gate = new ChannelApprovalGate(async () => { throw new Error('no window'); });
    await expect(gate.require({ ...request, summary: ['token-secreto'] })).rejects.toThrow(/confirmation_required/);
    expect(JSON.stringify(gate.audit())).not.toContain('token-secreto');
    expect(gate.audit()[0]).toMatchObject({ action: 'publish', outcome: 'rejected' });
  });

  it('renders untrusted text on one bounded line', () => {
    expect(summaryValue('linha\nquebrada\u0007')).toBe('linha quebrada');
    expect(summaryValue('x'.repeat(200), 10)).toHaveLength(10);
  });
});
